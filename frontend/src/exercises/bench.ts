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

// ─── Bench Pause Detection ───

export interface BenchPauseResult {
  /** Was there a discernible pause at the bottom? */
  detected: boolean;
  /** How long the pause lasted in milliseconds. */
  durationMs: number;
  /** How many frames the bar was stationary at the bottom. */
  durationFrames: number;
  /** Is the pause long enough for competition (>= ~1 second)? */
  isCompetitionLegal: boolean;
  /** The elbow angle during the pause (average across pause frames). */
  elbowAngleAtPause: number;
  /** 0-100 stability score — less angular change during pause = higher. */
  stability: number;
}

/** Minimum angular change per frame (degrees) to be considered "motionless". */
const PAUSE_VELOCITY_THRESHOLD = 1.5;
/** Minimum number of consecutive low-velocity frames to count as a pause. */
const MIN_PAUSE_FRAMES = 2;
/** Minimum pause duration in seconds to be considered "detected". */
const MIN_PAUSE_DURATION_S = 0.1;
/** Minimum pause duration for competition legality (seconds). */
const COMPETITION_LEGAL_PAUSE_S = 1.0;

/**
 * Detect a pause at the bottom of a bench press rep.
 *
 * Scans the elbow angle sequence around the bottom position. A pause is
 * a contiguous run of frames where the per-frame angular change stays
 * below PAUSE_VELOCITY_THRESHOLD. The longest such run within the bottom
 * region is used.
 */
export function detectBenchPause(
  elbowAngles: number[],
  bottomRelIdx: number,
  fps: number,
): BenchPauseResult {
  const noPause: BenchPauseResult = {
    detected: false,
    durationMs: 0,
    durationFrames: 0,
    isCompetitionLegal: false,
    elbowAngleAtPause: elbowAngles[bottomRelIdx] ?? 0,
    stability: 0,
  };

  if (elbowAngles.length < 3 || fps <= 0) return noPause;

  // Define the search region: from when we're near the bottom until the
  // elbow starts clearly opening. We look from a few frames before the
  // bottom index to a window after it.
  const minAngle = elbowAngles[bottomRelIdx] ?? 180;
  const nearBottomThreshold = minAngle + 10; // within 10 degrees of minimum

  // Find the start of the bottom region (first frame within threshold before bottomRelIdx)
  let regionStart = bottomRelIdx;
  for (let i = bottomRelIdx - 1; i >= 0; i--) {
    if (elbowAngles[i] <= nearBottomThreshold) {
      regionStart = i;
    } else {
      break;
    }
  }

  // Find the end of the bottom region (last frame within threshold after bottomRelIdx)
  let regionEnd = bottomRelIdx;
  for (let i = bottomRelIdx + 1; i < elbowAngles.length; i++) {
    if (elbowAngles[i] <= nearBottomThreshold) {
      regionEnd = i;
    } else {
      break;
    }
  }

  if (regionEnd - regionStart < MIN_PAUSE_FRAMES) return noPause;

  // Scan the bottom region for the longest run of low-velocity frames
  let bestRunStart = -1;
  let bestRunLen = 0;
  let currentRunStart = regionStart;
  let currentRunLen = 1; // first frame in region always counts

  for (let i = regionStart + 1; i <= regionEnd; i++) {
    const delta = Math.abs(elbowAngles[i] - elbowAngles[i - 1]);
    if (delta < PAUSE_VELOCITY_THRESHOLD) {
      currentRunLen++;
    } else {
      if (currentRunLen > bestRunLen) {
        bestRunLen = currentRunLen;
        bestRunStart = currentRunStart;
      }
      currentRunStart = i;
      currentRunLen = 1;
    }
  }
  // Check final run
  if (currentRunLen > bestRunLen) {
    bestRunLen = currentRunLen;
    bestRunStart = currentRunStart;
  }

  if (bestRunLen < MIN_PAUSE_FRAMES || bestRunStart < 0) return noPause;

  const durationS = bestRunLen / fps;
  if (durationS < MIN_PAUSE_DURATION_S) return noPause;

  // Compute average elbow angle and stability during the pause
  const pauseAngles = elbowAngles.slice(bestRunStart, bestRunStart + bestRunLen);
  const avgAngle = pauseAngles.reduce((s, v) => s + v, 0) / pauseAngles.length;

  // Stability: average absolute per-frame change during the pause
  let totalDelta = 0;
  for (let i = 1; i < pauseAngles.length; i++) {
    totalDelta += Math.abs(pauseAngles[i] - pauseAngles[i - 1]);
  }
  const avgDelta = pauseAngles.length > 1 ? totalDelta / (pauseAngles.length - 1) : 0;
  // Map avg delta to 0-100 stability: 0 delta = 100, threshold delta = 0
  const stability = clamp(Math.round((1 - avgDelta / PAUSE_VELOCITY_THRESHOLD) * 100), 0, 100);

  return {
    detected: true,
    durationMs: Math.round(durationS * 1000),
    durationFrames: bestRunLen,
    isCompetitionLegal: durationS >= COMPETITION_LEGAL_PAUSE_S,
    elbowAngleAtPause: Math.round(avgAngle * 10) / 10,
    stability,
  };
}

// ─── Phase Detection (elbow angle driven) ───

import { detectRepsGeneric } from '../phase-detector';
import type { PhaseDetectorConfig } from '../phase-detector';

const BENCH_PHASE_CONFIG: PhaseDetectorConfig = {
  standingAngle: 155,       // Arms mostly straight
  descendingThreshold: 2.0,
  bottomVelocityThreshold: 1.5,
  ascendingThreshold: 2.0,
  minRepFrames: 6,
};

function detectBenchReps(elbowAngles: number[]): RepRange[] {
  return detectRepsGeneric(elbowAngles, BENCH_PHASE_CONFIG);
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

/**
 * Score the bench pause using the detailed BenchPauseResult.
 * Provides finer-grained scoring than the simple duration-based version.
 *
 * Score tiers:
 *   No detectable pause (< 0.3s): 0
 *   Brief pause (0.3-0.7s):       40
 *   Adequate pause (0.7-1.2s):    70
 *   Good pause (1.2-2.0s):        90
 *   Long pause (2.0-4.0s):        95  (diminishing returns)
 *   Excessive pause (> 4.0s):     80  (energy leak)
 *
 * In competition mode, no pause caps the total rep score at 50 ("No Lift").
 */
export function scoreBenchPauseDetailed(
  pauseResult: BenchPauseResult,
  config: BenchConfig,
): number {
  const durationS = pauseResult.durationMs / 1000;

  if (!pauseResult.detected || durationS < 0.3) return 0;
  if (durationS < 0.7) return 40;
  if (durationS < 1.2) return 70;
  if (durationS < 2.0) return 90;
  if (durationS <= 4.0) return 95;
  // Excessively long pause — energy leak
  return 80;
}

// ─── Bench Issue Detection ───

export function detectBenchIssues(
  rep: RepData,
  config: BenchConfig,
  pauseResult?: BenchPauseResult,
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

  // 8. No pause at chest (detailed pause detection)
  if (pauseResult) {
    const pauseDurationS = pauseResult.durationMs / 1000;
    if (!pauseResult.detected || pauseDurationS < 0.3) {
      issues.push({
        name: 'no_pause_bench',
        severity: config.competitionMode ? 'high' : 'low',
        description: config.competitionMode
          ? 'No pause detected at the chest — this would be a "No Lift" in competition'
          : 'The bar should come to a complete stop on the chest before pressing',
        value: pauseDurationS,
        threshold: config.competitionMode ? 1.0 : 0.3,
        phase: SquatPhase.BOTTOM,
        frame: rep.bottomFrame,
      });
    }

    // 9. Unstable pause (pause detected but bar was moving)
    if (pauseResult.detected && pauseResult.stability < 50) {
      issues.push({
        name: 'unstable_pause_bench',
        severity: 'low',
        description: 'The bar is moving slightly during the pause — in competition, the bar must be "motionless on the chest"',
        value: pauseResult.stability,
        threshold: 50,
        phase: SquatPhase.BOTTOM,
        frame: rep.bottomFrame,
      });
    }
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
  no_pause_bench: {
    cue: 'Touch and hold — imagine gluing the bar to your chest for a beat',
    priority: 1,
    explanation: 'In competition, you must hold the bar motionless on your chest until the head judge gives the "Press" command. Even in training, a brief pause builds strength off the chest and teaches control.',
    explanationBeginner: 'In competition, you have to hold the bar still on your chest and wait for the judge to say "Press." Even in training, a brief pause helps build strength off the chest. Try counting "one" before you push.',
  },
  unstable_pause_bench: {
    cue: 'Squeeze the bar into your chest — lock your lats and hold',
    priority: 5,
    explanation: 'The bar is moving slightly during the pause. In competition, the bar must be "motionless on the chest." Pull the bar down into your chest with your lats and think about absorbing it before you explode up.',
    explanationBeginner: 'Try to keep the bar completely still on your chest. Think about squeezing the bar into your chest with your back muscles (lats). Once it is totally still, then push it up.',
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

/** Result from buildBenchRepData including the pause detection. */
interface BenchRepBuildResult {
  repData: RepData;
  pauseResult: BenchPauseResult;
}

function buildBenchRepData(
  repRange: RepRange,
  frameAnglesMap: Map<number, FrameAngles>,
  frameIndices: number[],
  fps: number,
): BenchRepBuildResult {
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

  // Pause detection
  const pauseResult = detectBenchPause(elbowAngles, bottomRelIdx, fps);

  return {
    repData: {
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
    },
    pauseResult,
  };
}

function scoreBenchRep(
  rep: RepData,
  config: BenchConfig,
  pauseResult?: BenchPauseResult,
): RepScore {
  const minElbow = Math.min(...rep.frameAngles.map(fa => fa.elbowAngle ?? 180));
  const rom = scoreBenchROM(minElbow, config);
  const lockout = scoreBenchLockout(rep);
  const control = scoreBenchControl(rep);
  const symmetry = scoreBenchSymmetry(rep);
  const tempo = config.competitionMode ? 100 : scoreBenchTempo(rep.descentDuration, rep.ascentDuration);

  // Use detailed pause scoring when available, otherwise fall back to duration-based
  const pause = pauseResult
    ? scoreBenchPauseDetailed(pauseResult, config)
    : scoreBenchPause(rep.bottomDuration, config);

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

  const issues = detectBenchIssues(rep, config, pauseResult);
  const cues = getBenchCues(issues, config.experienceLevel);
  const positiveFeedback = getBenchPositiveFeedback({
    rom, lockout, control, symmetry, tempo, pause,
  });

  let totalScore = overall;
  const highCount = issues.filter(i => i.severity === 'high').length;
  if (highCount > 0) totalScore = Math.max(0, totalScore - highCount * 5);

  // Competition mode: cap score at 50 if no pause detected (like depth gate for squats)
  if (config.competitionMode && pauseResult && (!pauseResult.detected || pauseResult.durationMs < 300)) {
    totalScore = Math.min(totalScore, 50);
  }

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
    dimensions: { rom, lockout, control, symmetry, tempo, pause },
    exerciseType: 'bench_press',
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
    const { repData, pauseResult } = buildBenchRepData(range, frameAnglesMap, frameIndices, fps);
    repData.repNumber = r + 1;
    const score = scoreBenchRep(repData, config, pauseResult);
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
