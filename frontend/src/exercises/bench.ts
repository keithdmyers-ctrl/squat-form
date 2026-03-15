/**
 * Bench press form analysis: phase detection, issue detection, scoring, and cues.
 * Uses elbow angle as the primary movement driver.
 * Note: Person is lying horizontally — trunk angle from vertical is not meaningful.
 * Camera should be positioned at the side for best results.
 */

import { computeFrameAngles, pickSide } from '../angles';
import { calibrateFromStanding, detectCameraView } from '../calibration';
import { SquatPhase } from '../types';
import type {
  BenchType,
  ExperienceLevel,
  FrameAngles,
  CalibrationData,
  FormIssue,
  CoachingCue,
  RepData,
  RepScore,
  SetAnalysis,
  FrameData,
  RepRange,
  BaseExerciseConfig,
} from '../types';
import { clamp, scoreToGrade } from '../scorer';
import { computeVelocityMetrics } from '../competition';
import { detectFatigue, aggregateTopIssues, aggregatePositiveFeedback, computeSetScore, createEmptyAnalysis, buildRepFrameMap } from '../exercise-core';

// ─── Bench Config ───

export interface BenchConfig {
  benchType: BenchType;
  experienceLevel: ExperienceLevel;
  competitionMode: boolean;
}

// ─── Phase Detection (elbow angle driven) ───

const EXTENDED_ELBOW_ANGLE = 155;   // Arms mostly straight
const DESCENDING_THRESHOLD = 2.0;
const BOTTOM_VELOCITY_THRESHOLD = 1.5;
const ASCENDING_THRESHOLD = 2.0;
const MIN_REP_FRAMES = 6;
const SMOOTHING_WINDOW = 5;
const HISTORY_WINDOW = 3;

function smoothAngle(buffer: number[], newValue: number, windowSize: number): number {
  buffer.push(newValue);
  if (buffer.length > windowSize) buffer.shift();
  return buffer.reduce((sum, v) => sum + v, 0) / buffer.length;
}

class BenchPhaseDetector {
  private phase: SquatPhase = SquatPhase.STANDING; // STANDING = arms extended
  private smoothBuffer: number[] = [];
  private smoothedHistory: number[] = [];
  private prevSmoothedAngle: number | null = null;
  private bottomHoldCount = 0;

  reset(): void {
    this.phase = SquatPhase.STANDING;
    this.smoothBuffer = [];
    this.smoothedHistory = [];
    this.prevSmoothedAngle = null;
    this.bottomHoldCount = 0;
  }

  private cumulativeDelta(): number {
    if (this.smoothedHistory.length < 2) return 0;
    return this.smoothedHistory[this.smoothedHistory.length - 1] - this.smoothedHistory[0];
  }

  update(elbowAngle: number): SquatPhase {
    const smoothed = smoothAngle(this.smoothBuffer, elbowAngle, SMOOTHING_WINDOW);
    this.smoothedHistory.push(smoothed);
    if (this.smoothedHistory.length > HISTORY_WINDOW + 1) this.smoothedHistory.shift();

    const delta = this.prevSmoothedAngle !== null ? smoothed - this.prevSmoothedAngle : 0;
    const cumDelta = this.cumulativeDelta();

    switch (this.phase) {
      case SquatPhase.STANDING: // Arms extended
        this.bottomHoldCount = 0;
        if (smoothed < EXTENDED_ELBOW_ANGLE && cumDelta < -DESCENDING_THRESHOLD) {
          this.phase = SquatPhase.DESCENDING; // Lowering bar
        }
        break;

      case SquatPhase.DESCENDING: // Lowering
        if (Math.abs(delta) < BOTTOM_VELOCITY_THRESHOLD) {
          this.bottomHoldCount++;
          if (this.bottomHoldCount >= 2) {
            this.phase = SquatPhase.BOTTOM; // Bar on chest
            this.bottomHoldCount = 0;
          }
        } else if (delta > 0) {
          this.phase = SquatPhase.BOTTOM;
          this.bottomHoldCount = 0;
        } else {
          this.bottomHoldCount = 0;
        }
        break;

      case SquatPhase.BOTTOM: // Bar on chest
        if (cumDelta > ASCENDING_THRESHOLD) {
          this.phase = SquatPhase.ASCENDING; // Pressing
        }
        break;

      case SquatPhase.ASCENDING: // Pressing
        if (smoothed >= EXTENDED_ELBOW_ANGLE) {
          this.phase = SquatPhase.STANDING; // Lockout
        }
        break;
    }

    this.prevSmoothedAngle = smoothed;
    return this.phase;
  }

  getCurrentPhase(): SquatPhase {
    return this.phase;
  }
}

function detectBenchReps(elbowAngles: number[]): RepRange[] {
  const detector = new BenchPhaseDetector();
  const reps: RepRange[] = [];
  let repStart = -1;
  let bottomIdx = -1;
  let minAngleInRep = 180;

  for (let i = 0; i < elbowAngles.length; i++) {
    const prevPhase = detector.getCurrentPhase();
    const phase = detector.update(elbowAngles[i]);

    if (prevPhase === SquatPhase.STANDING && phase === SquatPhase.DESCENDING) {
      repStart = i;
      minAngleInRep = elbowAngles[i];
      bottomIdx = i;
    }

    if (repStart >= 0 && (phase === SquatPhase.DESCENDING || phase === SquatPhase.BOTTOM)) {
      if (elbowAngles[i] < minAngleInRep) {
        minAngleInRep = elbowAngles[i];
        bottomIdx = i;
      }
    }

    if (prevPhase === SquatPhase.ASCENDING && phase === SquatPhase.STANDING && repStart >= 0) {
      if ((i - repStart) >= MIN_REP_FRAMES) {
        reps.push({ start: repStart, end: i, bottomIndex: bottomIdx });
      }
      repStart = -1;
      bottomIdx = -1;
      minAngleInRep = 180;
    }
  }

  return reps;
}

// ─── Bench Scoring ───

export const BENCH_WEIGHTS = {
  rom: 0.25,
  lockout: 0.20,
  control: 0.20,
  symmetry: 0.15,
  tempo: 0.10,
  pause: 0.10,
};

export const BENCH_COMPETITION_WEIGHTS = {
  rom: 0.25,
  lockout: 0.25,
  control: 0.15,
  symmetry: 0.10,
  tempo: 0.00,
  pause: 0.25,
};

/** Minimum elbow angle thresholds (lower = deeper ROM). */
export const BENCH_ROM_THRESHOLDS: Record<ExperienceLevel, number> = {
  beginner: 100,       // Partial range OK
  intermediate: 85,    // Near chest
  advanced: 75,        // Touch chest / full ROM
};

export function scoreBenchROM(minElbowAngle: number, config: BenchConfig): number {
  const threshold = BENCH_ROM_THRESHOLDS[config.experienceLevel];
  if (minElbowAngle <= threshold - 15) return 100;
  if (minElbowAngle <= threshold) {
    const frac = (minElbowAngle - (threshold - 15)) / 15;
    return clamp(100 - frac * 20, 0, 100);
  }
  const over = minElbowAngle - threshold;
  return clamp(80 - over * 2, 0, 100);
}

export function scoreBenchLockout(rep: RepData): number {
  const lastAngles = rep.frameAngles.slice(-5);
  if (lastAngles.length === 0) return 50;

  const finalElbow = Math.max(...lastAngles.map(fa => fa.elbowAngle ?? 0));
  if (finalElbow >= 170) return 100;
  if (finalElbow >= 155) return clamp(100 - ((170 - finalElbow) / 15) * 25, 0, 100);
  return clamp(75 - (155 - finalElbow) * 1.5, 0, 100);
}

/** Control score: smooth press without jerking. */
export function scoreBenchControl(rep: RepData): number {
  const elbowAngles = rep.frameAngles.map(fa => fa.elbowAngle ?? 180);
  const bottomRelIdx = elbowAngles.reduce((minI, a, i, arr) => a < arr[minI] ? i : minI, 0);
  const ascentAngles = elbowAngles.slice(bottomRelIdx);

  let reversals = 0;
  for (let i = 2; i < ascentAngles.length; i++) {
    const prev = ascentAngles[i - 1] - ascentAngles[i - 2];
    const curr = ascentAngles[i] - ascentAngles[i - 1];
    if (prev > 1 && curr < -2) reversals++;
  }

  if (reversals === 0) return 100;
  if (reversals === 1) return 85;
  return clamp(65 - (reversals - 1) * 15, 0, 100);
}

/** Symmetry: left vs right shoulder/elbow evenness (uses hip symmetry as proxy). */
export function scoreBenchSymmetry(rep: RepData): number {
  const symmetryValues = rep.frameAngles.map(fa => fa.hipSymmetry).filter((v): v is number => v !== null);
  if (symmetryValues.length === 0) return 90;
  const maxAsymmetry = Math.max(...symmetryValues);
  if (maxAsymmetry < 0.05) return 100;
  if (maxAsymmetry < 0.10) return clamp(100 - ((maxAsymmetry - 0.05) / 0.05) * 15, 0, 100);
  if (maxAsymmetry < 0.20) return clamp(85 - ((maxAsymmetry - 0.10) / 0.10) * 25, 0, 100);
  return clamp(60 - (maxAsymmetry - 0.20) * 100, 0, 100);
}

/** Tempo score for bench press. */
export function scoreBenchTempo(descentDuration: number, ascentDuration: number): number {
  let score = 100;
  // Descent: ideal 1.0-3.0s
  if (descentDuration < 0.8) score -= Math.min(20, (0.8 - descentDuration) * 25);
  else if (descentDuration > 4.0) score -= Math.min(10, (descentDuration - 4.0) * 5);
  // Very fast ascent: suspicious
  if (ascentDuration < 0.2) score -= 5;
  return clamp(score, 0, 100);
}

/** Pause at bottom score (competition: must have a clear pause). */
export function scoreBenchPause(bottomDuration: number, config: BenchConfig): number {
  if (config.competitionMode) {
    // Competition requires a clear pause
    if (bottomDuration >= 0.5) return 100;
    if (bottomDuration >= 0.2) return 75;
    return 30;
  }
  // Non-competition: brief touch is fine, bouncing is bad
  if (bottomDuration >= 0.1 && bottomDuration <= 2.0) return 100;
  if (bottomDuration < 0.1) return 70; // bouncing
  return clamp(90 - (bottomDuration - 2.0) * 10, 0, 100);
}

// ─── Bench Issue Detection ───

export function detectBenchIssues(
  rep: RepData,
  config: BenchConfig,
): FormIssue[] {
  const issues: FormIssue[] = [];

  // 1. Insufficient range of motion
  const minElbow = Math.min(...rep.frameAngles.map(fa => fa.elbowAngle ?? 180));
  const romThreshold = BENCH_ROM_THRESHOLDS[config.experienceLevel];
  if (minElbow > romThreshold) {
    issues.push({
      name: 'insufficient_rom',
      severity: minElbow > romThreshold + 15 ? 'moderate' : 'low',
      description: 'Didn\'t lower the bar far enough — try to touch or get close to your chest',
      value: minElbow,
      threshold: romThreshold,
      phase: SquatPhase.BOTTOM,
      frame: rep.bottomFrame,
    });
  }

  // 2. Incomplete lockout
  const lastElbow = Math.max(...rep.frameAngles.slice(-5).map(fa => fa.elbowAngle ?? 0));
  if (lastElbow < 160) {
    issues.push({
      name: 'incomplete_lockout',
      severity: lastElbow < 145 ? 'moderate' : 'low',
      description: 'Arms not fully extended at the top',
      value: lastElbow,
      threshold: 160,
      phase: SquatPhase.STANDING,
      frame: rep.endFrame,
    });
  }

  // 3. Bouncing off chest
  if (rep.bottomDuration < 0.05) {
    issues.push({
      name: 'bouncing',
      severity: config.competitionMode ? 'high' : 'moderate',
      description: 'Bar bounced off your chest — pause briefly at the bottom',
      value: rep.bottomDuration,
      threshold: 0.1,
      phase: SquatPhase.BOTTOM,
      frame: rep.bottomFrame,
    });
  }

  // 4. No pause in competition mode
  if (config.competitionMode && rep.bottomDuration < 0.3) {
    issues.push({
      name: 'no_pause',
      severity: 'high',
      description: 'Competition bench requires a clear pause on the chest before pressing',
      value: rep.bottomDuration,
      threshold: 0.3,
      phase: SquatPhase.BOTTOM,
      frame: rep.bottomFrame,
    });
  }

  // 5. Uneven press (asymmetry)
  const symmetryValues = rep.frameAngles.map(fa => fa.hipSymmetry).filter((v): v is number => v !== null);
  if (symmetryValues.length > 0) {
    const maxAsym = Math.max(...symmetryValues);
    if (maxAsym > 0.12) {
      issues.push({
        name: 'uneven_press',
        severity: maxAsym > 0.25 ? 'moderate' : 'low',
        description: 'One arm pressed faster than the other',
        value: maxAsym,
        threshold: 0.12,
        phase: SquatPhase.ASCENDING,
        frame: rep.bottomFrame,
      });
    }
  }

  // 6. Fast/uncontrolled descent
  if (rep.descentDuration < 0.6) {
    issues.push({
      name: 'fast_descent',
      severity: 'low',
      description: `Descent was ${rep.descentDuration.toFixed(1)}s — lower the bar under control`,
      value: rep.descentDuration,
      threshold: 0.8,
      phase: SquatPhase.DESCENDING,
      frame: rep.startFrame,
    });
  }

  // 7. Press stalling (control issues during press)
  const elbowAngles = rep.frameAngles.map(fa => fa.elbowAngle ?? 180);
  const bottomRelIdx = elbowAngles.reduce((minI, a, i, arr) => a < arr[minI] ? i : minI, 0);
  const ascentAngles = elbowAngles.slice(bottomRelIdx);
  let reversals = 0;
  for (let i = 2; i < ascentAngles.length; i++) {
    const prev = ascentAngles[i - 1] - ascentAngles[i - 2];
    const curr = ascentAngles[i] - ascentAngles[i - 1];
    if (prev > 1 && curr < -2) reversals++;
  }
  if (reversals > 0) {
    issues.push({
      name: 'press_stall',
      severity: reversals > 1 ? 'moderate' : 'low',
      description: 'The bar stalled or wobbled during the press',
      value: reversals,
      threshold: 0,
      phase: SquatPhase.ASCENDING,
      frame: rep.bottomFrame,
    });
  }

  return issues;
}

// ─── Bench Coaching Cues ───

const BENCH_CUE_DATABASE: Record<string, { cue: string; priority: number; explanation: string; explanationBeginner?: string }> = {
  insufficient_rom: {
    cue: 'Lower the bar to your chest — touch and press',
    priority: 3,
    explanation: 'Full range of motion builds more strength and muscle. Lower the bar until it touches your chest (or gets very close). If mobility limits your range, work on shoulder stretches and start with lighter weight.',
    explanationBeginner: 'You\'re not lowering the bar far enough — try to bring it all the way down to touch your chest (or get really close). Going through the full range of motion builds more strength. Start with a lighter weight if the bar feels hard to control near your chest.',
  },
  incomplete_lockout: {
    cue: 'Press all the way up — lock your elbows at the top',
    priority: 3,
    explanation: 'Finish each rep with arms fully extended. In competition, the press command isn\'t given until lockout is complete. Practice with lighter weight to build the habit.',
    explanationBeginner: 'You\'re not pushing the bar all the way up. Make sure your arms are fully straight at the top of each rep before lowering again. This ensures you get the full benefit of the exercise.',
  },
  bouncing: {
    cue: 'Control the bar to your chest — no bouncing',
    priority: 2,
    explanation: 'Bouncing the bar off your chest uses momentum instead of muscle strength and can injure your sternum. Lower under control and pause briefly before pressing.',
    explanationBeginner: 'You\'re bouncing the bar off your chest, which can hurt and doesn\'t build as much strength. Lower the bar gently to your chest, let it touch, and then press it back up using your muscles, not momentum.',
  },
  no_pause: {
    cue: 'Pause on the chest — wait for the press command',
    priority: 1,
    explanation: 'In competition, you must hold the bar motionless on your chest until the head judge gives the "press" command. Practice paused reps in training.',
    explanationBeginner: 'Try pausing the bar on your chest for a quick count of "one" before pressing it back up. This builds much more strength than bouncing it, and it\'s how the exercise is done in competitions.',
  },
  uneven_press: {
    cue: 'Press evenly — both arms should lock out together',
    priority: 4,
    explanation: 'One arm is pressing faster than the other, which can cause the bar to tilt. This often indicates a strength imbalance. Add dumbbell pressing to build equal strength on both sides.',
    explanationBeginner: 'One arm is pushing faster than the other, making the bar tilt. This is really common! Try using dumbbells sometimes instead of a barbell — each arm has to work equally, which helps your weaker side catch up.',
  },
  fast_descent: {
    cue: 'Control the bar on the way down — 1-2 seconds',
    priority: 5,
    explanation: 'Lowering the bar too fast reduces muscle tension and makes it harder to be precise with your touch point. Aim for a 1-2 second controlled descent.',
    explanationBeginner: 'You\'re lowering the bar too fast. Take about 1-2 seconds to bring it down to your chest — nice and controlled. This helps you stay precise and actually builds more strength.',
  },
  press_stall: {
    cue: 'Drive through the sticking point — push your feet into the floor',
    priority: 4,
    explanation: 'The bar stalled during the press, which usually happens about 2-3 inches off the chest. Build strength at this point with pause reps, Spoto press, or board press.',
    explanationBeginner: 'The bar got stuck partway up. This is the hardest point in the bench press and totally normal! Try to push as fast as you can right from the start — the extra speed helps carry you through. If it keeps happening, use a slightly lighter weight.',
  },
};

export function getBenchCues(issues: FormIssue[], experienceLevel?: string): CoachingCue[] {
  const cueMap = new Map<string, CoachingCue>();
  for (const issue of issues) {
    const entry = BENCH_CUE_DATABASE[issue.name];
    if (!entry || cueMap.has(issue.name)) continue;
    const explanation = (experienceLevel === 'beginner' && entry.explanationBeginner)
      ? entry.explanationBeginner : entry.explanation;
    cueMap.set(issue.name, { issue: issue.name, cue: entry.cue, priority: entry.priority, explanation });
  }
  return Array.from(cueMap.values()).sort((a, b) => a.priority - b.priority);
}

// ─── Positive Feedback ───

export function getBenchPositiveFeedback(scores: {
  rom: number;
  lockout: number;
  control: number;
  symmetry: number;
  tempo: number;
  pause: number;
}): string[] {
  const feedback: string[] = [];
  if (scores.rom >= 90) feedback.push('Great range of motion — bar touched the chest');
  if (scores.lockout >= 90) feedback.push('Strong lockout at the top');
  if (scores.control >= 90) feedback.push('Smooth, controlled press');
  if (scores.symmetry >= 90) feedback.push('Even pressing — nice and balanced');
  if (scores.tempo >= 90) feedback.push('Good tempo and control');
  if (scores.pause >= 90) feedback.push('Good pause on the chest');
  return feedback;
}

// ─── Rep Building & Scoring ───

function buildBenchRepData(
  repRange: RepRange,
  frameAnglesMap: Map<number, FrameAngles>,
  frameIndices: number[],
  fps: number,
): RepData {
  const { start, end, bottomIndex } = repRange;
  const repFrameAngles: FrameAngles[] = [];
  for (let i = start; i <= end && i < frameIndices.length; i++) {
    const fa = frameAnglesMap.get(frameIndices[i]);
    if (fa) repFrameAngles.push(fa);
  }

  const elbowAngles = repFrameAngles.map(fa => fa.elbowAngle ?? 180);
  const minElbowAngle = elbowAngles.length > 0 ? Math.min(...elbowAngles) : 180;

  const descentFrames = bottomIndex - start;
  const ascentFrames = end - bottomIndex;
  const descentDuration = fps > 0 ? descentFrames / fps : 0;
  const ascentDuration = fps > 0 ? ascentFrames / fps : 0;

  let bottomFrameCount = 0;
  for (const ea of elbowAngles) {
    if (ea <= minElbowAngle + 5) bottomFrameCount++;
  }
  const bottomDuration = fps > 0 ? bottomFrameCount / fps : 0;

  // Velocity metrics based on elbow angles
  const bottomRelIdx = bottomIndex - start;
  const velocity = computeVelocityMetrics(elbowAngles, bottomRelIdx, fps);

  return {
    repNumber: 0,
    startFrame: frameIndices[start] ?? 0,
    endFrame: frameIndices[end] ?? 0,
    bottomFrame: frameIndices[bottomIndex] ?? 0,
    minKneeAngle: 180,  // Not relevant for bench
    minHipAngle: 180,
    maxTrunkAngle: 0,
    descentDuration,
    bottomDuration,
    ascentDuration,
    frameAngles: repFrameAngles,
    heelRise: false,
    buttWink: false,
    goodMorning: false,
    kneeValgus: false,
    trunkAngleChangeOnAscent: 0,
    pelvicTiltAtBottom: 0,
    stickingPoints: [],
    velocity,
  };
}

function scoreBenchRep(
  rep: RepData,
  config: BenchConfig,
): RepScore {
  const minElbow = Math.min(...rep.frameAngles.map(fa => fa.elbowAngle ?? 180));
  const rom = scoreBenchROM(minElbow, config);
  const lockout = scoreBenchLockout(rep);
  const control = scoreBenchControl(rep);
  const symmetry = scoreBenchSymmetry(rep);
  const tempo = config.competitionMode ? 100 : scoreBenchTempo(rep.descentDuration, rep.ascentDuration);
  const pause = scoreBenchPause(rep.bottomDuration, config);

  const w = config.competitionMode ? BENCH_COMPETITION_WEIGHTS : BENCH_WEIGHTS;

  const overall = clamp(
    Math.round(
      rom * w.rom +
      lockout * w.lockout +
      control * w.control +
      symmetry * w.symmetry +
      tempo * w.tempo +
      pause * w.pause,
    ),
    0, 100,
  );

  const issues = detectBenchIssues(rep, config);
  const cues = getBenchCues(issues, config.experienceLevel);
  const positiveFeedback = getBenchPositiveFeedback({
    rom, lockout, control, symmetry, tempo, pause,
  });

  let totalScore = overall;
  const highCount = issues.filter(i => i.severity === 'high').length;
  if (highCount > 0) totalScore = Math.max(0, totalScore - highCount * 5);

  // Aggregate landmark confidence across all frames in this rep
  const confidenceValues = rep.frameAngles
    .map(fa => fa.landmarkConfidence)
    .filter((v): v is number => v !== undefined);
  const avgConfidence = confidenceValues.length > 0
    ? confidenceValues.reduce((s, v) => s + v, 0) / confidenceValues.length
    : undefined;

  return {
    depthScore: rom,
    kneeTrackingScore: control,
    trunkScore: pause,
    symmetryScore: symmetry,
    tempoScore: tempo,
    lockoutScore: lockout,
    overallScore: totalScore,
    grade: scoreToGrade(totalScore, config.experienceLevel),
    issues,
    cues,
    positiveFeedback,
    stickingPoints: [],
    velocity: rep.velocity,
    avgConfidence,
    minKneeAngle: rep.minKneeAngle,
    maxTrunkAngle: rep.maxTrunkAngle,
    minHipAngle: rep.minHipAngle,
    descentDuration: rep.descentDuration,
    ascentDuration: rep.ascentDuration,
    bottomDuration: rep.bottomDuration,
  };
}

// ─── Main Entry Point ───

export function analyzeBenchSequence(
  frames: FrameData,
  fps: number,
  config: BenchConfig,
): SetAnalysis {
  const sqConfig = {
    squatType: 'bodyweight' as const,
    experienceLevel: config.experienceLevel,
    competitionMode: config.competitionMode,
  };

  if (frames.size === 0) return createEmptyAnalysis(sqConfig);

  const frameIndices = Array.from(frames.keys()).sort((a, b) => a - b);

  // Compute frame angles (calibration is minimal for bench — no standing frame required)
  const frameAnglesMap = new Map<number, FrameAngles>();
  const elbowAnglesOrdered: number[] = [];
  for (const fi of frameIndices) {
    const lm = frames.get(fi)!;
    const fa = computeFrameAngles(lm);
    frameAnglesMap.set(fi, fa);
    elbowAnglesOrdered.push(fa.elbowAngle ?? 180);
  }

  // Check if elbow data is available
  const hasElbowData = elbowAnglesOrdered.some(a => a < 175);
  if (!hasElbowData) {
    // Likely wrist landmarks aren't visible — warn user
    const result = createEmptyAnalysis(sqConfig);
    result.sideViewWarning = 'Could not detect elbow/wrist landmarks clearly. For bench press analysis, position the camera at the side with your full arms visible.';
    return result;
  }

  // Detect camera view
  let detectedCameraView: 'side' | 'front' | 'unknown' = 'unknown';
  const calibCandidates = frameIndices.slice(0, Math.min(30, frameIndices.length));
  for (const ci of calibCandidates) {
    const lm = frames.get(ci);
    if (!lm) continue;
    const view = detectCameraView(lm);
    if (view !== 'unknown') { detectedCameraView = view; break; }
  }

  // Detect reps via elbow angle
  const repRanges = detectBenchReps(elbowAnglesOrdered);
  if (repRanges.length === 0) return createEmptyAnalysis(sqConfig);

  const repScores: RepScore[] = [];

  for (let r = 0; r < repRanges.length; r++) {
    const range = repRanges[r];
    const repData = buildBenchRepData(range, frameAnglesMap, frameIndices, fps);
    repData.repNumber = r + 1;
    const score = scoreBenchRep(repData, config);
    repScores.push(score);
  }

  const overallScore = computeSetScore(repScores);
  const fatigueDetected = detectFatigue(repScores);
  const topIssues = aggregateTopIssues(repScores);
  const topCues = getBenchCues(topIssues, config.experienceLevel);
  const positiveHighlights = aggregatePositiveFeedback(repScores);
  const { repFrameMap: rfm, repStartFrames: rsf } = buildRepFrameMap(repRanges, frameIndices);

  return {
    repCount: repRanges.length,
    reps: repScores,
    overallScore,
    grade: scoreToGrade(overallScore, config.experienceLevel),
    fatigueDetected,
    topIssues,
    topCues,
    calibration: null,
    config: sqConfig,
    repFrameMap: rfm,
    repStartFrames: rsf,
    detectedCameraView,
    positiveHighlights,
    mobilityFindings: [],
    warmupProtocol: [],
    competitionMode: config.competitionMode,
  };
}
