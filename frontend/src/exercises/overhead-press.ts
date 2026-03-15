/**
 * Overhead press (OHP) form analysis: phase detection, issue detection, scoring, and cues.
 * Uses shoulder angle as the primary movement driver.
 * Supports strict press, push press, and behind-the-neck variants.
 * Camera should be positioned at the side for best results.
 */

import { computeFrameAngles, pickSide } from '../angles';
import { calibrateFromStanding, detectCameraView } from '../calibration';
import { SquatPhase } from '../types';
import type {
  OverheadPressType,
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

// ─── OHP Config ───

export interface OverheadPressConfig {
  ohpType: OverheadPressType;
  experienceLevel: ExperienceLevel;
  competitionMode: boolean;
}

// ─── Phase Detection (shoulder angle driven) ───

const STANDING_SHOULDER_ANGLE = 160;  // Arms overhead = lockout
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

class OHPPhaseDetector {
  private phase: SquatPhase = SquatPhase.STANDING; // STANDING = arms overhead (lockout)
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

  update(shoulderAngle: number): SquatPhase {
    const smoothed = smoothAngle(this.smoothBuffer, shoulderAngle, SMOOTHING_WINDOW);
    this.smoothedHistory.push(smoothed);
    if (this.smoothedHistory.length > HISTORY_WINDOW + 1) this.smoothedHistory.shift();

    const delta = this.prevSmoothedAngle !== null ? smoothed - this.prevSmoothedAngle : 0;
    const cumDelta = this.cumulativeDelta();

    switch (this.phase) {
      case SquatPhase.STANDING: // Arms overhead (lockout)
        this.bottomHoldCount = 0;
        if (smoothed < STANDING_SHOULDER_ANGLE && cumDelta < -DESCENDING_THRESHOLD) {
          this.phase = SquatPhase.DESCENDING; // Lowering bar to shoulders
        }
        break;

      case SquatPhase.DESCENDING: // Lowering
        if (Math.abs(delta) < BOTTOM_VELOCITY_THRESHOLD) {
          this.bottomHoldCount++;
          if (this.bottomHoldCount >= 2) {
            this.phase = SquatPhase.BOTTOM; // Bar at shoulder level
            this.bottomHoldCount = 0;
          }
        } else if (delta > 0) {
          this.phase = SquatPhase.BOTTOM;
          this.bottomHoldCount = 0;
        } else {
          this.bottomHoldCount = 0;
        }
        break;

      case SquatPhase.BOTTOM: // Bar at shoulders
        if (cumDelta > ASCENDING_THRESHOLD) {
          this.phase = SquatPhase.ASCENDING; // Pressing up
        }
        break;

      case SquatPhase.ASCENDING: // Pressing up
        if (smoothed >= STANDING_SHOULDER_ANGLE) {
          this.phase = SquatPhase.STANDING; // Lockout overhead
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

function detectOHPReps(shoulderAngles: number[]): RepRange[] {
  const detector = new OHPPhaseDetector();
  const reps: RepRange[] = [];
  let repStart = -1;
  let bottomIdx = -1;
  let minAngleInRep = 180;

  for (let i = 0; i < shoulderAngles.length; i++) {
    const prevPhase = detector.getCurrentPhase();
    const phase = detector.update(shoulderAngles[i]);

    if (prevPhase === SquatPhase.STANDING && phase === SquatPhase.DESCENDING) {
      repStart = i;
      minAngleInRep = shoulderAngles[i];
      bottomIdx = i;
    }

    if (repStart >= 0 && (phase === SquatPhase.DESCENDING || phase === SquatPhase.BOTTOM)) {
      if (shoulderAngles[i] < minAngleInRep) {
        minAngleInRep = shoulderAngles[i];
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

// ─── OHP Scoring ───

const OHP_WEIGHTS = {
  overheadStability: 0.25,
  lockout: 0.20,
  pressPath: 0.20,
  symmetry: 0.10,
  tempo: 0.10,
  rom: 0.15,
};

const OHP_COMPETITION_WEIGHTS = {
  overheadStability: 0.25,
  lockout: 0.30,
  pressPath: 0.20,
  symmetry: 0.10,
  tempo: 0.00,
  rom: 0.15,
};

/** Bottom shoulder angle thresholds per experience level (lower = deeper ROM). */
const OHP_ROM_THRESHOLDS: Record<ExperienceLevel, number> = {
  beginner: 100,       // Partial range OK
  intermediate: 90,    // Bar near shoulders
  advanced: 80,        // Full ROM, bar at shoulders/upper chest
};

function scoreOHPROM(minShoulderAngle: number, config: OverheadPressConfig): number {
  const threshold = OHP_ROM_THRESHOLDS[config.experienceLevel];
  if (minShoulderAngle <= threshold - 15) return 100;
  if (minShoulderAngle <= threshold) {
    const frac = (minShoulderAngle - (threshold - 15)) / 15;
    return clamp(100 - frac * 20, 0, 100);
  }
  const over = minShoulderAngle - threshold;
  return clamp(80 - over * 2, 0, 100);
}

/** Overhead stability: how consistent the shoulder angle is at the top. */
function scoreOverheadStability(rep: RepData): number {
  const lastAngles = rep.frameAngles.slice(-8);
  if (lastAngles.length === 0) return 50;

  const shoulderAngles = lastAngles
    .map(fa => fa.shoulderAngle)
    .filter((v): v is number => v !== undefined);
  if (shoulderAngles.length < 2) return 80;

  const mean = shoulderAngles.reduce((s, v) => s + v, 0) / shoulderAngles.length;
  const variance = shoulderAngles.reduce((s, v) => s + (v - mean) ** 2, 0) / shoulderAngles.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev < 2) return 100;
  if (stdDev < 5) return clamp(100 - ((stdDev - 2) / 3) * 20, 0, 100);
  return clamp(80 - (stdDev - 5) * 5, 0, 100);
}

function scoreOHPLockout(rep: RepData): number {
  const lastAngles = rep.frameAngles.slice(-5);
  if (lastAngles.length === 0) return 50;

  const finalShoulder = Math.max(
    ...lastAngles.map(fa => fa.shoulderAngle ?? 0),
  );
  if (finalShoulder >= 170) return 100;
  if (finalShoulder >= 155) return clamp(100 - ((170 - finalShoulder) / 15) * 25, 0, 100);
  return clamp(75 - (155 - finalShoulder) * 1.5, 0, 100);
}

/** Press path: how stable the trunk angle stays during the press (minimal lean-back). */
function scorePressPath(rep: RepData): number {
  const trunkAngles = rep.frameAngles.map(fa => fa.trunkAngle);
  if (trunkAngles.length < 3) return 80;

  // Compute the range of trunk angle deviation during the rep
  const minTrunk = Math.min(...trunkAngles);
  const maxTrunk = Math.max(...trunkAngles);
  const trunkRange = maxTrunk - minTrunk;

  if (trunkRange <= 5) return 100;
  if (trunkRange <= 10) return clamp(100 - ((trunkRange - 5) / 5) * 15, 0, 100);
  if (trunkRange <= 20) return clamp(85 - ((trunkRange - 10) / 10) * 25, 0, 100);
  return clamp(60 - (trunkRange - 20) * 2, 0, 100);
}

/** Symmetry: left vs right shoulder/hip evenness. */
function scoreOHPSymmetry(rep: RepData): number {
  const symmetryValues = rep.frameAngles.map(fa => fa.hipSymmetry).filter((v): v is number => v !== null);
  if (symmetryValues.length === 0) return 90;
  const maxAsymmetry = Math.max(...symmetryValues);
  if (maxAsymmetry < 0.05) return 100;
  if (maxAsymmetry < 0.10) return clamp(100 - ((maxAsymmetry - 0.05) / 0.05) * 15, 0, 100);
  if (maxAsymmetry < 0.20) return clamp(85 - ((maxAsymmetry - 0.10) / 0.10) * 25, 0, 100);
  return clamp(60 - (maxAsymmetry - 0.20) * 100, 0, 100);
}

/** Tempo score for overhead press. */
function scoreOHPTempo(descentDuration: number, ascentDuration: number): number {
  let score = 100;
  // Descent: ideal 1.0-3.0s
  if (descentDuration < 0.8) score -= Math.min(20, (0.8 - descentDuration) * 25);
  else if (descentDuration > 4.0) score -= Math.min(10, (descentDuration - 4.0) * 5);
  // Very fast ascent: suspicious
  if (ascentDuration < 0.2) score -= 5;
  return clamp(score, 0, 100);
}

// ─── OHP Issue Detection ───

function detectOHPIssues(
  rep: RepData,
  config: OverheadPressConfig,
): FormIssue[] {
  const issues: FormIssue[] = [];

  // 1. Excessive lean-back: trunk angle deviates > 15 degrees during press
  const trunkAngles = rep.frameAngles.map(fa => fa.trunkAngle);
  if (trunkAngles.length >= 3) {
    const standingTrunk = trunkAngles[0] ?? 0;
    const maxTrunk = Math.max(...trunkAngles);
    const trunkDeviation = maxTrunk - standingTrunk;
    if (trunkDeviation > 15) {
      issues.push({
        name: 'excessive_lean_back',
        severity: trunkDeviation > 25 ? 'high' : 'moderate',
        description: 'You\'re leaning back too far during the press — brace your core',
        value: trunkDeviation,
        threshold: 15,
        phase: SquatPhase.ASCENDING,
        frame: rep.bottomFrame,
      });
    }
  }

  // 2. Partial ROM: bottom position shoulder angle too high
  const shoulderAngles = rep.frameAngles
    .map(fa => fa.shoulderAngle)
    .filter((v): v is number => v !== undefined);
  const minShoulder = shoulderAngles.length > 0 ? Math.min(...shoulderAngles) : 180;
  const romThreshold = OHP_ROM_THRESHOLDS[config.experienceLevel];
  if (minShoulder > romThreshold + 10) {
    issues.push({
      name: 'partial_rom',
      severity: minShoulder > romThreshold + 25 ? 'moderate' : 'low',
      description: 'Didn\'t lower the bar far enough — bring it to your shoulders/upper chest',
      value: minShoulder,
      threshold: romThreshold + 10,
      phase: SquatPhase.BOTTOM,
      frame: rep.bottomFrame,
    });
  }

  // 3. Forward press: trunk angle changes significantly (bar drifts forward)
  if (trunkAngles.length >= 3) {
    const minTrunk = Math.min(...trunkAngles);
    const maxTrunk = Math.max(...trunkAngles);
    const trunkRange = maxTrunk - minTrunk;
    if (trunkRange > 12) {
      issues.push({
        name: 'forward_press',
        severity: trunkRange > 20 ? 'moderate' : 'low',
        description: 'Bar path is drifting — press straight up, then push your head through',
        value: trunkRange,
        threshold: 12,
        phase: SquatPhase.ASCENDING,
        frame: rep.bottomFrame,
      });
    }
  }

  // 4. Asymmetric press: left/right symmetry
  const symmetryValues = rep.frameAngles.map(fa => fa.hipSymmetry).filter((v): v is number => v !== null);
  if (symmetryValues.length > 0) {
    const maxAsym = Math.max(...symmetryValues);
    if (maxAsym > 0.12) {
      issues.push({
        name: 'asymmetric_press',
        severity: maxAsym > 0.25 ? 'moderate' : 'low',
        description: 'One arm pressed unevenly — use dumbbells to identify the weaker side',
        value: maxAsym,
        threshold: 0.12,
        phase: SquatPhase.ASCENDING,
        frame: rep.bottomFrame,
      });
    }
  }

  // 5. Incomplete lockout: shoulder angle at top < 165
  const lastShoulderAngles = rep.frameAngles.slice(-5)
    .map(fa => fa.shoulderAngle)
    .filter((v): v is number => v !== undefined);
  const finalShoulder = lastShoulderAngles.length > 0 ? Math.max(...lastShoulderAngles) : 0;
  if (finalShoulder < 165) {
    issues.push({
      name: 'incomplete_lockout_ohp',
      severity: finalShoulder < 150 ? 'moderate' : 'low',
      description: 'Arms not fully extended overhead — push your head through at the top',
      value: finalShoulder,
      threshold: 165,
      phase: SquatPhase.STANDING,
      frame: rep.endFrame,
    });
  }

  // 6. Fast descent: descent too fast (< 0.8s)
  if (rep.descentDuration < 0.8) {
    issues.push({
      name: 'fast_descent_ohp',
      severity: 'low',
      description: `Descent was ${rep.descentDuration.toFixed(1)}s — lower the bar under control`,
      value: rep.descentDuration,
      threshold: 0.8,
      phase: SquatPhase.DESCENDING,
      frame: rep.startFrame,
    });
  }

  return issues;
}

// ─── OHP Coaching Cues ───

const OHP_CUE_DATABASE: Record<string, { cue: string; priority: number; explanation: string; explanationBeginner?: string }> = {
  excessive_lean_back: {
    cue: 'Brace your core hard before pressing — squeeze your glutes',
    priority: 1,
    explanation: 'Leaning back excessively turns the overhead press into an incline press and puts your lower back at risk. Brace your core, squeeze your glutes, and think about pressing straight up. If you can\'t press without leaning, the weight is too heavy.',
    explanationBeginner: 'You\'re leaning way back when you press, which is hard on your lower back. Before you press, take a big breath, tighten your belly, and squeeze your butt muscles. Press the bar straight up — if you have to lean back, the weight is probably too heavy.',
  },
  partial_rom: {
    cue: 'Start with the bar touching your shoulders — get your head through the window',
    priority: 2,
    explanation: 'You\'re not lowering the bar far enough. Start each rep with the bar resting on your front shoulders/upper chest. Think about getting your head "through the window" at the top.',
    explanationBeginner: 'You\'re not bringing the bar down far enough between reps. Start each rep with the bar on your shoulders (touching your collarbone area), then press it all the way up. This gives you the most benefit from the exercise.',
  },
  forward_press: {
    cue: 'Press straight up, then push your head through — keep the bar over midfoot',
    priority: 3,
    explanation: 'The bar is drifting forward during the press, which is inefficient and puts more stress on your shoulders. Press the bar up in a slight arc around your face, then push your head forward once the bar clears it. The bar should end up directly over the middle of your foot.',
    explanationBeginner: 'The bar is moving forward as you press it up, which makes it harder. Try to press the bar straight up — you\'ll need to move your head back slightly as the bar passes your face, then push your head forward once it\'s past. The bar should end up right over your feet.',
  },
  asymmetric_press: {
    cue: 'Press evenly — use dumbbells to identify and fix the weaker side',
    priority: 4,
    explanation: 'One arm is pressing harder than the other, causing the bar to tilt. This usually indicates a strength imbalance. Use dumbbell overhead presses to build equal strength on both sides.',
    explanationBeginner: 'One arm is pushing harder than the other, making the bar tilt. This is really common! Try using dumbbells sometimes instead of a barbell — each arm has to work equally, which helps your weaker side catch up.',
  },
  incomplete_lockout_ohp: {
    cue: 'Push your head through at the top — fully extend your elbows overhead',
    priority: 3,
    explanation: 'You\'re not fully locking out the weight overhead. A complete lockout means your elbows are straight, your shoulders are active (pushing up into the bar), and your head is pushed forward through the "window" of your arms.',
    explanationBeginner: 'You\'re not pushing the bar all the way up. At the top, your arms should be completely straight with the bar directly over your head. Push your head forward slightly so it\'s between your arms — coaches call this "pushing your head through the window."',
  },
  fast_descent_ohp: {
    cue: 'Control the bar on the way down — 1-2 seconds',
    priority: 5,
    explanation: 'Lowering the bar too fast reduces muscle tension and makes it harder to press from a stable position. Aim for a 1-2 second controlled descent back to your shoulders.',
    explanationBeginner: 'You\'re lowering the bar too fast. Take about 1-2 seconds to bring it back down to your shoulders — nice and controlled. This helps you stay balanced and actually builds more strength.',
  },
};

function getOHPCues(issues: FormIssue[], experienceLevel?: string): CoachingCue[] {
  const cueMap = new Map<string, CoachingCue>();
  for (const issue of issues) {
    const entry = OHP_CUE_DATABASE[issue.name];
    if (!entry || cueMap.has(issue.name)) continue;
    const explanation = (experienceLevel === 'beginner' && entry.explanationBeginner)
      ? entry.explanationBeginner : entry.explanation;
    cueMap.set(issue.name, { issue: issue.name, cue: entry.cue, priority: entry.priority, explanation });
  }
  return Array.from(cueMap.values()).sort((a, b) => a.priority - b.priority);
}

// ─── Positive Feedback ───

function getOHPPositiveFeedback(scores: {
  overheadStability: number;
  lockout: number;
  pressPath: number;
  symmetry: number;
  tempo: number;
  rom: number;
}): string[] {
  const feedback: string[] = [];
  if (scores.overheadStability >= 90) feedback.push('Stable lockout overhead — great control');
  if (scores.lockout >= 90) feedback.push('Strong lockout — full arm extension');
  if (scores.pressPath >= 90) feedback.push('Clean press path — minimal drift');
  if (scores.symmetry >= 90) feedback.push('Even pressing — nice and balanced');
  if (scores.tempo >= 90) feedback.push('Good tempo and control');
  if (scores.rom >= 90) feedback.push('Full range of motion — bar to shoulders');
  return feedback;
}

// ─── Rep Building & Scoring ───

function buildOHPRepData(
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

  const shoulderAngles = repFrameAngles
    .map(fa => fa.shoulderAngle ?? 180);
  const minShoulderAngle = shoulderAngles.length > 0 ? Math.min(...shoulderAngles) : 180;

  const trunkAngles = repFrameAngles.map(fa => fa.trunkAngle);
  const maxTrunkAngle = trunkAngles.length > 0 ? Math.max(...trunkAngles) : 0;

  const descentFrames = bottomIndex - start;
  const ascentFrames = end - bottomIndex;
  const descentDuration = fps > 0 ? descentFrames / fps : 0;
  const ascentDuration = fps > 0 ? ascentFrames / fps : 0;

  let bottomFrameCount = 0;
  for (const sa of shoulderAngles) {
    if (sa <= minShoulderAngle + 5) bottomFrameCount++;
  }
  const bottomDuration = fps > 0 ? bottomFrameCount / fps : 0;

  // Velocity metrics based on shoulder angles
  const bottomRelIdx = bottomIndex - start;
  const velocity = computeVelocityMetrics(shoulderAngles, bottomRelIdx, fps);

  return {
    repNumber: 0,
    startFrame: frameIndices[start] ?? 0,
    endFrame: frameIndices[end] ?? 0,
    bottomFrame: frameIndices[bottomIndex] ?? 0,
    minKneeAngle: 180,  // Not primary for OHP
    minHipAngle: 180,
    maxTrunkAngle,
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

function scoreOHPRep(
  rep: RepData,
  config: OverheadPressConfig,
): RepScore {
  const shoulderAngles = rep.frameAngles
    .map(fa => fa.shoulderAngle)
    .filter((v): v is number => v !== undefined);
  const minShoulder = shoulderAngles.length > 0 ? Math.min(...shoulderAngles) : 180;

  const overheadStability = scoreOverheadStability(rep);
  const lockout = scoreOHPLockout(rep);
  const pressPath = scorePressPath(rep);
  const symmetry = scoreOHPSymmetry(rep);
  const tempo = config.competitionMode ? 100 : scoreOHPTempo(rep.descentDuration, rep.ascentDuration);
  const rom = scoreOHPROM(minShoulder, config);

  const w = config.competitionMode ? OHP_COMPETITION_WEIGHTS : OHP_WEIGHTS;

  const overall = clamp(
    Math.round(
      overheadStability * w.overheadStability +
      lockout * w.lockout +
      pressPath * w.pressPath +
      symmetry * w.symmetry +
      tempo * w.tempo +
      rom * w.rom,
    ),
    0, 100,
  );

  const issues = detectOHPIssues(rep, config);
  const cues = getOHPCues(issues, config.experienceLevel);
  const positiveFeedback = getOHPPositiveFeedback({
    overheadStability, lockout, pressPath, symmetry, tempo, rom,
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
    kneeTrackingScore: pressPath,
    trunkScore: overheadStability,
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

export function analyzeOHPSequence(
  frames: FrameData,
  fps: number,
  config: OverheadPressConfig,
): SetAnalysis {
  const sqConfig = {
    squatType: 'bodyweight' as const,
    experienceLevel: config.experienceLevel,
    competitionMode: config.competitionMode,
  };

  if (frames.size === 0) return createEmptyAnalysis(sqConfig);

  const frameIndices = Array.from(frames.keys()).sort((a, b) => a - b);

  // Compute frame angles
  const frameAnglesMap = new Map<number, FrameAngles>();
  const shoulderAnglesOrdered: number[] = [];
  for (const fi of frameIndices) {
    const lm = frames.get(fi)!;
    const fa = computeFrameAngles(lm);
    frameAnglesMap.set(fi, fa);
    shoulderAnglesOrdered.push(fa.shoulderAngle ?? 180);
  }

  // Check if shoulder data is available
  const hasShoulderData = shoulderAnglesOrdered.some(a => a < 170);
  if (!hasShoulderData) {
    const result = createEmptyAnalysis(sqConfig);
    result.sideViewWarning = 'Could not detect shoulder/elbow landmarks clearly. For overhead press analysis, position the camera at the side with your full arms visible.';
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

  // Detect reps via shoulder angle
  const repRanges = detectOHPReps(shoulderAnglesOrdered);
  if (repRanges.length === 0) return createEmptyAnalysis(sqConfig);

  const repScores: RepScore[] = [];

  for (let r = 0; r < repRanges.length; r++) {
    const range = repRanges[r];
    const repData = buildOHPRepData(range, frameAnglesMap, frameIndices, fps);
    repData.repNumber = r + 1;
    const score = scoreOHPRep(repData, config);
    repScores.push(score);
  }

  const overallScore = computeSetScore(repScores);
  const fatigueDetected = detectFatigue(repScores);
  const topIssues = aggregateTopIssues(repScores);
  const topCues = getOHPCues(topIssues, config.experienceLevel);
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
