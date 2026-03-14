/**
 * Deadlift form analysis: phase detection, issue detection, scoring, and cues.
 * Uses hip angle as the primary movement driver (hip hinge pattern).
 * Supports conventional, sumo, and Romanian deadlift variants.
 */

import { computeFrameAngles, pickSide, segmentLength } from '../angles';
import { calibrateFromStanding, detectCameraView } from '../calibration';
import { SquatPhase } from '../types';
import type {
  DeadliftType,
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
  Landmarks,
  BaseExerciseConfig,
} from '../types';
import { clamp, scoreToGrade, redistributeWeights, scoreTempo } from '../scorer';
import { detectStickingPoints, computeVelocityMetrics } from '../competition';
import { assessMobility, generateWarmupProtocol } from '../mobility';
import { detectFatigue, aggregateTopIssues, aggregatePositiveFeedback, computeSetScore, createEmptyAnalysis, buildRepFrameMap } from '../exercise-core';

// ─── Deadlift Config ───

export interface DeadliftConfig {
  deadliftType: DeadliftType;
  experienceLevel: ExperienceLevel;
  competitionMode: boolean;
}

// ─── Phase Detection (hip angle driven) ───

const STANDING_HIP_ANGLE = 160;
const DESCENDING_THRESHOLD = 2.0;
const BOTTOM_VELOCITY_THRESHOLD = 1.5;
const ASCENDING_THRESHOLD = 2.0;
const MIN_REP_FRAMES = 8;
const SMOOTHING_WINDOW = 5;
const HISTORY_WINDOW = 3;

function smoothAngle(buffer: number[], newValue: number, windowSize: number): number {
  buffer.push(newValue);
  if (buffer.length > windowSize) buffer.shift();
  return buffer.reduce((sum, v) => sum + v, 0) / buffer.length;
}

class DeadliftPhaseDetector {
  private phase: SquatPhase = SquatPhase.STANDING;
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

  update(hipAngle: number): SquatPhase {
    const smoothed = smoothAngle(this.smoothBuffer, hipAngle, SMOOTHING_WINDOW);
    this.smoothedHistory.push(smoothed);
    if (this.smoothedHistory.length > HISTORY_WINDOW + 1) this.smoothedHistory.shift();

    const delta = this.prevSmoothedAngle !== null ? smoothed - this.prevSmoothedAngle : 0;
    const cumDelta = this.cumulativeDelta();

    switch (this.phase) {
      case SquatPhase.STANDING:
        this.bottomHoldCount = 0;
        if (smoothed < STANDING_HIP_ANGLE && cumDelta < -DESCENDING_THRESHOLD) {
          this.phase = SquatPhase.DESCENDING;
        }
        break;

      case SquatPhase.DESCENDING:
        if (Math.abs(delta) < BOTTOM_VELOCITY_THRESHOLD) {
          this.bottomHoldCount++;
          if (this.bottomHoldCount >= 2) {
            this.phase = SquatPhase.BOTTOM;
            this.bottomHoldCount = 0;
          }
        } else if (delta > 0) {
          this.phase = SquatPhase.BOTTOM;
          this.bottomHoldCount = 0;
        } else {
          this.bottomHoldCount = 0;
        }
        break;

      case SquatPhase.BOTTOM:
        if (cumDelta > ASCENDING_THRESHOLD) {
          this.phase = SquatPhase.ASCENDING;
        }
        break;

      case SquatPhase.ASCENDING:
        if (smoothed >= STANDING_HIP_ANGLE) {
          this.phase = SquatPhase.STANDING;
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

function detectDeadliftReps(hipAngles: number[]): RepRange[] {
  const detector = new DeadliftPhaseDetector();
  const reps: RepRange[] = [];
  let repStart = -1;
  let bottomIdx = -1;
  let minAngleInRep = 180;

  for (let i = 0; i < hipAngles.length; i++) {
    const prevPhase = detector.getCurrentPhase();
    const phase = detector.update(hipAngles[i]);

    if (prevPhase === SquatPhase.STANDING && phase === SquatPhase.DESCENDING) {
      repStart = i;
      minAngleInRep = hipAngles[i];
      bottomIdx = i;
    }

    if (repStart >= 0 && (phase === SquatPhase.DESCENDING || phase === SquatPhase.BOTTOM)) {
      if (hipAngles[i] < minAngleInRep) {
        minAngleInRep = hipAngles[i];
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

// ─── Deadlift Scoring ───

/** Ideal trunk angles from vertical per deadlift type [min, max]. */
const DEADLIFT_TRUNK_RANGES: Record<DeadliftType, [number, number]> = {
  conventional: [35, 65],  // More horizontal torso
  sumo: [25, 50],          // More upright
  romanian: [30, 55],      // Moderate
};

/** Scoring weights for deadlift. */
const DEADLIFT_WEIGHTS = {
  backPosition: 0.25,
  hipHinge: 0.20,
  lockout: 0.20,
  symmetry: 0.10,
  tempo: 0.10,
  control: 0.15,
};

const DEADLIFT_COMPETITION_WEIGHTS = {
  backPosition: 0.25,
  hipHinge: 0.20,
  lockout: 0.30,
  symmetry: 0.10,
  tempo: 0.00,
  control: 0.15,
};

/** Hip hinge depth thresholds (min hip angle — lower = deeper hinge). */
const HIP_HINGE_THRESHOLDS: Record<ExperienceLevel, number> = {
  beginner: 100,       // Partial range OK
  intermediate: 85,    // Near full hinge
  advanced: 75,        // Full ROM
};

function scoreBackPosition(
  maxTrunkAngle: number,
  config: DeadliftConfig,
  calibration: CalibrationData | null,
): number {
  const [minExpected, maxExpected] = DEADLIFT_TRUNK_RANGES[config.deadliftType];
  const tolerance = config.experienceLevel === 'advanced' ? 10 : config.experienceLevel === 'intermediate' ? 15 : 20;

  if (maxTrunkAngle >= minExpected && maxTrunkAngle <= maxExpected) return 100;

  let deviation: number;
  if (maxTrunkAngle < minExpected) deviation = minExpected - maxTrunkAngle;
  else deviation = maxTrunkAngle - maxExpected;

  if (deviation <= tolerance) return clamp(100 - (deviation / tolerance) * 15, 0, 100);
  return clamp(85 - (deviation - tolerance) * 1.5, 0, 100);
}

function scoreHipHinge(minHipAngle: number, config: DeadliftConfig): number {
  const threshold = HIP_HINGE_THRESHOLDS[config.experienceLevel];

  if (minHipAngle <= threshold - 20) return 100;
  if (minHipAngle <= threshold) {
    const frac = (minHipAngle - (threshold - 20)) / 20;
    return clamp(100 - frac * 20, 0, 100);
  }
  const over = minHipAngle - threshold;
  return clamp(80 - over * 2, 0, 100);
}

function scoreDeadliftLockout(rep: RepData, calibration: CalibrationData | null): number {
  const lastAngles = rep.frameAngles.slice(-5);
  if (lastAngles.length === 0) return 50;

  // For deadlift, lockout = hips fully extended (hip angle near standing)
  const finalHipAngle = Math.max(...lastAngles.map(fa => fa.hipAngle));
  const standingHip = calibration?.standingHipAngle ?? 175;
  const diff = Math.abs(finalHipAngle - standingHip);

  if (diff <= 10) return 100;
  if (diff <= 20) return clamp(100 - ((diff - 10) / 10) * 25, 0, 100);
  return clamp(75 - (diff - 20) * 1.5, 0, 100);
}

function scoreDeadliftSymmetry(rep: RepData): number {
  const symmetryValues = rep.frameAngles.map(fa => fa.hipSymmetry).filter((v): v is number => v !== null);
  if (symmetryValues.length === 0) return 90;
  const maxAsymmetry = Math.max(...symmetryValues);
  if (maxAsymmetry < 0.05) return 100;
  if (maxAsymmetry < 0.10) return clamp(100 - ((maxAsymmetry - 0.05) / 0.05) * 15, 0, 100);
  if (maxAsymmetry < 0.20) return clamp(85 - ((maxAsymmetry - 0.10) / 0.10) * 25, 0, 100);
  return clamp(60 - (maxAsymmetry - 0.20) * 100, 0, 100);
}

/** Control score: smoothness of the pull (no hitching). */
function scoreDeadliftControl(rep: RepData): number {
  // Check for velocity reversals during ascent (hitching)
  const bottomRelIdx = rep.frameAngles.length > 0
    ? rep.frameAngles.reduce((minI, fa, i, arr) => fa.hipAngle < arr[minI].hipAngle ? i : minI, 0)
    : 0;
  const ascentAngles = rep.frameAngles.slice(bottomRelIdx).map(fa => fa.hipAngle);

  let reversals = 0;
  for (let i = 2; i < ascentAngles.length; i++) {
    const prev = ascentAngles[i - 1] - ascentAngles[i - 2];
    const curr = ascentAngles[i] - ascentAngles[i - 1];
    // Reversal: was increasing, now decreasing significantly
    if (prev > 1 && curr < -2) reversals++;
  }

  if (reversals === 0) return 100;
  if (reversals === 1) return 80;
  return clamp(60 - (reversals - 1) * 15, 0, 100);
}

// ─── Deadlift Issue Detection ───

function detectDeadliftIssues(
  rep: RepData,
  config: DeadliftConfig,
  calibration: CalibrationData | null,
): FormIssue[] {
  const issues: FormIssue[] = [];

  // 1. Rounded back: trunk angle too far forward
  const [, maxExpected] = DEADLIFT_TRUNK_RANGES[config.deadliftType];
  const tolerance = config.experienceLevel === 'advanced' ? 10 : 15;
  if (rep.maxTrunkAngle > maxExpected + tolerance) {
    issues.push({
      name: 'rounded_back',
      severity: rep.maxTrunkAngle > maxExpected + tolerance * 2 ? 'high' : 'moderate',
      description: 'Your back rounded excessively during the lift',
      value: rep.maxTrunkAngle,
      threshold: maxExpected + tolerance,
      phase: SquatPhase.ASCENDING,
      frame: rep.bottomFrame,
    });
  }

  // 2. Hip shoot / early hip rise (trunk angle increases during initial pull)
  const bottomRelIdx = rep.frameAngles.reduce((minI, fa, i, arr) =>
    fa.hipAngle < arr[minI].hipAngle ? i : minI, 0);
  const ascentTrunkAngles = rep.frameAngles.slice(bottomRelIdx).map(fa => fa.trunkAngle);
  if (ascentTrunkAngles.length >= 3) {
    const trunkAtStart = ascentTrunkAngles[0] ?? 0;
    const earlyTrunk = ascentTrunkAngles.slice(0, Math.ceil(ascentTrunkAngles.length * 0.4));
    const maxEarlyTrunk = earlyTrunk.length > 0 ? Math.max(...earlyTrunk) : trunkAtStart;
    const trunkIncrease = maxEarlyTrunk - trunkAtStart;
    if (trunkIncrease > 10) {
      issues.push({
        name: 'hip_shoot',
        severity: trunkIncrease > 20 ? 'high' : 'moderate',
        description: 'Your hips shot up before your shoulders during the pull',
        value: trunkIncrease,
        threshold: 10,
        phase: SquatPhase.ASCENDING,
        frame: rep.bottomFrame,
      });
    }
  }

  // 3. Hitching (bar stops or reverses during ascent)
  const ascentHipAngles = rep.frameAngles.slice(bottomRelIdx).map(fa => fa.hipAngle);
  let hitchCount = 0;
  for (let i = 2; i < ascentHipAngles.length; i++) {
    const prev = ascentHipAngles[i - 1] - ascentHipAngles[i - 2];
    const curr = ascentHipAngles[i] - ascentHipAngles[i - 1];
    if (prev > 1 && curr < -2) hitchCount++;
  }
  if (hitchCount > 0) {
    issues.push({
      name: 'hitching',
      severity: hitchCount > 1 ? 'high' : 'moderate',
      description: 'The bar stopped or reversed direction during the pull',
      value: hitchCount,
      threshold: 0,
      phase: SquatPhase.ASCENDING,
      frame: rep.bottomFrame,
    });
  }

  // 4. Incomplete lockout
  const lastAngles = rep.frameAngles.slice(-5);
  const finalHipAngle = lastAngles.length > 0 ? Math.max(...lastAngles.map(fa => fa.hipAngle)) : 0;
  if (finalHipAngle < 160) {
    issues.push({
      name: 'incomplete_lockout',
      severity: finalHipAngle < 145 ? 'moderate' : 'low',
      description: 'Didn\'t fully lock out at the top — hips should be fully extended',
      value: finalHipAngle,
      threshold: 160,
      phase: SquatPhase.STANDING,
      frame: rep.endFrame,
    });
  }

  // 5. Insufficient range of motion
  const hingeThreshold = HIP_HINGE_THRESHOLDS[config.experienceLevel];
  if (rep.minHipAngle > hingeThreshold) {
    issues.push({
      name: 'insufficient_rom',
      severity: rep.minHipAngle > hingeThreshold + 15 ? 'moderate' : 'low',
      description: config.deadliftType === 'romanian'
        ? 'Didn\'t hinge deep enough — lower the bar until you feel a hamstring stretch'
        : 'Didn\'t hinge down far enough to the bar',
      value: rep.minHipAngle,
      threshold: hingeThreshold,
      phase: SquatPhase.BOTTOM,
      frame: rep.bottomFrame,
    });
  }

  // 6. Asymmetric pull
  const symmetryValues = rep.frameAngles.map(fa => fa.hipSymmetry).filter((v): v is number => v !== null);
  if (symmetryValues.length > 0) {
    const maxAsymmetry = Math.max(...symmetryValues);
    if (maxAsymmetry > 0.10) {
      issues.push({
        name: 'asymmetric_pull',
        severity: maxAsymmetry > 0.25 ? 'moderate' : 'low',
        description: `${(maxAsymmetry * 100).toFixed(0)}% imbalance between left and right sides`,
        value: maxAsymmetry,
        threshold: 0.10,
        phase: SquatPhase.ASCENDING,
        frame: rep.bottomFrame,
      });
    }
  }

  // 7. Fast descent (slamming the bar down on eccentric)
  if (rep.descentDuration < 0.8 && config.deadliftType !== 'romanian') {
    issues.push({
      name: 'fast_descent',
      severity: 'low',
      description: `Descent was ${rep.descentDuration.toFixed(1)}s — control the bar on the way down`,
      value: rep.descentDuration,
      threshold: 0.8,
      phase: SquatPhase.DESCENDING,
      frame: rep.startFrame,
    });
  }

  // 8. Sumo-specific: knee cave detection (Escamilla et al. 2001, Med Sci Sports Exerc:
  // sumo stance requires greater hip abduction and external rotation; knee valgus
  // during sumo pulls indicates inadequate hip abductor strength)
  if (config.deadliftType === 'sumo') {
    let worstKneeRatio = 1.0;
    for (const fa of rep.frameAngles) {
      if (fa.kneeWidthRatio !== null && fa.kneeWidthRatio < worstKneeRatio) {
        worstKneeRatio = fa.kneeWidthRatio;
      }
    }
    if (worstKneeRatio < 0.85) {
      issues.push({
        name: 'knee_valgus',
        severity: worstKneeRatio < 0.70 ? 'high' : 'moderate',
        description: 'Knees caved inward during sumo pull — push knees out over toes',
        value: worstKneeRatio,
        threshold: 0.85,
        phase: SquatPhase.ASCENDING,
        frame: rep.bottomFrame,
      });
    }
  }

  return issues;
}

// ─── Deadlift Coaching Cues ───

const DEADLIFT_CUE_DATABASE: Record<string, { cue: string; priority: number; explanation: string }> = {
  rounded_back: {
    cue: 'Pack your lats — pull the bar into your body',
    priority: 1,
    explanation: 'Your back is rounding during the pull, which puts your spine at risk under load. Before pulling, brace your core, pull your shoulders back and down, and think about "bending the bar" around your legs. If you can\'t maintain a neutral spine, the weight is likely too heavy.',
  },
  hip_shoot: {
    cue: 'Push the floor away — don\'t lift the bar, push your feet through the floor',
    priority: 2,
    explanation: 'Your hips rose faster than your shoulders, turning the deadlift into a stiff-leg pull. Think about pushing the floor away from you rather than pulling the bar up. Your hips and shoulders should rise at the same rate.',
  },
  hitching: {
    cue: 'Drive your hips through in one smooth motion',
    priority: 1,
    explanation: 'The bar stopped or reversed during the pull. In competition, hitching is a disqualification. Practice lighter weights focusing on a smooth, continuous pull from floor to lockout.',
  },
  incomplete_lockout: {
    cue: 'Squeeze your glutes and stand tall at the top',
    priority: 3,
    explanation: 'You didn\'t fully extend your hips at the top. A complete lockout means your hips are fully forward, shoulders are back, and knees are straight. Squeeze your glutes hard at the top.',
  },
  insufficient_rom: {
    cue: 'Hinge deeper — push your hips back further',
    priority: 4,
    explanation: 'You\'re not hinging deep enough to get the full benefit. For conventional deadlifts, the bar should start on the floor. For RDLs, lower until you feel a strong hamstring stretch.',
  },
  asymmetric_pull: {
    cue: 'Pull evenly on both sides — check your grip width',
    priority: 4,
    explanation: 'One side is working harder than the other. This can develop into injury over time. Check that your hands are evenly spaced on the bar, and try single-leg RDLs to build balanced strength.',
  },
  fast_descent: {
    cue: 'Control the weight on the way down',
    priority: 6,
    explanation: 'Dropping the bar quickly skips the eccentric portion and can be dangerous. Lower under control in 1-2 seconds.',
  },
};

function getDeadliftCues(issues: FormIssue[]): CoachingCue[] {
  const cueMap = new Map<string, CoachingCue>();
  for (const issue of issues) {
    const entry = DEADLIFT_CUE_DATABASE[issue.name];
    if (!entry || cueMap.has(issue.name)) continue;
    cueMap.set(issue.name, { issue: issue.name, cue: entry.cue, priority: entry.priority, explanation: entry.explanation });
  }
  return Array.from(cueMap.values()).sort((a, b) => a.priority - b.priority);
}

// ─── Positive Feedback ───

function getDeadliftPositiveFeedback(scores: {
  backPosition: number;
  hipHinge: number;
  lockout: number;
  symmetry: number;
  tempo: number;
  control: number;
}): string[] {
  const feedback: string[] = [];
  if (scores.backPosition >= 90) feedback.push('Great back position — stayed neutral throughout');
  if (scores.hipHinge >= 90) feedback.push('Good hip hinge depth');
  if (scores.lockout >= 90) feedback.push('Strong lockout at the top');
  if (scores.symmetry >= 90) feedback.push('Even pull — nice and balanced');
  if (scores.control >= 90) feedback.push('Smooth, controlled pull — no hitching');
  if (scores.tempo >= 90) feedback.push('Good tempo and control');
  return feedback;
}

// ─── Rep Building & Scoring ───

function buildDeadliftRepData(
  repRange: RepRange,
  frameAnglesMap: Map<number, FrameAngles>,
  frameIndices: number[],
  fps: number,
  calibration: CalibrationData | null,
  allLandmarks: FrameData,
): RepData {
  const { start, end, bottomIndex } = repRange;
  const repFrameAngles: FrameAngles[] = [];
  for (let i = start; i <= end && i < frameIndices.length; i++) {
    const fa = frameAnglesMap.get(frameIndices[i]);
    if (fa) repFrameAngles.push(fa);
  }

  const hipAngles = repFrameAngles.map(fa => fa.hipAngle);
  const trunkAngles = repFrameAngles.map(fa => fa.trunkAngle);
  const kneeAngles = repFrameAngles.map(fa => fa.kneeAngle);

  const minHipAngle = hipAngles.length > 0 ? Math.min(...hipAngles) : 180;
  const minKneeAngle = kneeAngles.length > 0 ? Math.min(...kneeAngles) : 180;
  const maxTrunkAngle = trunkAngles.length > 0 ? Math.max(...trunkAngles) : 0;

  const descentFrames = bottomIndex - start;
  const ascentFrames = end - bottomIndex;
  const descentDuration = fps > 0 ? descentFrames / fps : 0;
  const ascentDuration = fps > 0 ? ascentFrames / fps : 0;

  let bottomFrameCount = 0;
  for (const ha of hipAngles) {
    if (ha <= minHipAngle + 5) bottomFrameCount++;
  }
  const bottomDuration = fps > 0 ? bottomFrameCount / fps : 0;

  // Sticking points based on hip angles
  const bottomRelIdx = bottomIndex - start;
  const topAngle = hipAngles.length > 0 ? Math.max(...hipAngles) : 180;
  const stickingPoints = detectStickingPoints(hipAngles, bottomRelIdx, topAngle, minHipAngle, fps, frameIndices[start] ?? 0, 'deadlift');
  const velocity = computeVelocityMetrics(hipAngles, bottomRelIdx, fps);

  return {
    repNumber: 0,
    startFrame: frameIndices[start] ?? 0,
    endFrame: frameIndices[end] ?? 0,
    bottomFrame: frameIndices[bottomIndex] ?? 0,
    minKneeAngle,
    minHipAngle,
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
    stickingPoints,
    velocity,
  };
}

function scoreDeadliftRep(
  rep: RepData,
  config: DeadliftConfig,
  calibration: CalibrationData | null,
): RepScore {
  const backPosition = scoreBackPosition(rep.maxTrunkAngle, config, calibration);
  const hipHinge = scoreHipHinge(rep.minHipAngle, config);
  const lockout = scoreDeadliftLockout(rep, calibration);
  const symmetry = scoreDeadliftSymmetry(rep);
  const tempo = config.competitionMode ? 100 : scoreTempo(rep.descentDuration, rep.bottomDuration, rep.ascentDuration);
  const control = scoreDeadliftControl(rep);

  const w = config.competitionMode ? DEADLIFT_COMPETITION_WEIGHTS : DEADLIFT_WEIGHTS;

  const overall = clamp(
    Math.round(
      backPosition * w.backPosition +
      hipHinge * w.hipHinge +
      lockout * w.lockout +
      symmetry * w.symmetry +
      tempo * w.tempo +
      control * w.control,
    ),
    0, 100,
  );

  const issues = detectDeadliftIssues(rep, config, calibration);
  const cues = getDeadliftCues(issues);
  const positiveFeedback = getDeadliftPositiveFeedback({
    backPosition, hipHinge, lockout, symmetry, tempo, control,
  });

  // Soft penalty for HIGH severity issues
  let totalScore = overall;
  const highCount = issues.filter(i => i.severity === 'high').length;
  if (highCount > 0) totalScore = Math.max(0, totalScore - highCount * 5);

  return {
    depthScore: hipHinge,
    kneeTrackingScore: control,
    trunkScore: backPosition,
    symmetryScore: symmetry,
    tempoScore: tempo,
    lockoutScore: lockout,
    overallScore: totalScore,
    grade: scoreToGrade(totalScore, config.experienceLevel),
    issues,
    cues,
    positiveFeedback,
    stickingPoints: rep.stickingPoints,
    velocity: rep.velocity,
    minKneeAngle: rep.minKneeAngle,
    maxTrunkAngle: rep.maxTrunkAngle,
    minHipAngle: rep.minHipAngle,
    descentDuration: rep.descentDuration,
    ascentDuration: rep.ascentDuration,
    bottomDuration: rep.bottomDuration,
  };
}

// ─── Main Entry Point ───

export function analyzeDeadliftSequence(
  frames: FrameData,
  fps: number,
  config: DeadliftConfig,
): SetAnalysis {
  const sqConfig = {
    squatType: 'bodyweight' as const,
    experienceLevel: config.experienceLevel,
    competitionMode: config.competitionMode,
  };

  if (frames.size === 0) {
    return createEmptyAnalysis(sqConfig);
  }

  const frameIndices = Array.from(frames.keys()).sort((a, b) => a - b);

  // Calibrate from standing
  let calibration: CalibrationData | null = null;
  const calibrationCandidates = frameIndices.slice(0, Math.min(30, frameIndices.length));
  for (const ci of calibrationCandidates) {
    const lm = frames.get(ci);
    if (!lm) continue;
    const fa = computeFrameAngles(lm);
    if (fa.hipAngle >= 150 && fa.kneeAngle >= 150) {
      calibration = calibrateFromStanding(lm);
      break;
    }
  }

  // Detect camera view
  let detectedCameraView: 'side' | 'front' | 'unknown' = 'unknown';
  for (const ci of calibrationCandidates) {
    const lm = frames.get(ci);
    if (!lm) continue;
    const view = detectCameraView(lm);
    if (view !== 'unknown') { detectedCameraView = view; break; }
  }

  // Compute frame angles
  const frameAnglesMap = new Map<number, FrameAngles>();
  const hipAnglesOrdered: number[] = [];
  for (const fi of frameIndices) {
    const lm = frames.get(fi)!;
    const fa = computeFrameAngles(lm, calibration?.standingKneeWidth ?? undefined);
    frameAnglesMap.set(fi, fa);
    hipAnglesOrdered.push(fa.hipAngle);
  }

  // Detect reps via hip angle
  const repRanges = detectDeadliftReps(hipAnglesOrdered);
  if (repRanges.length === 0) return createEmptyAnalysis(sqConfig, calibration);

  // Score each rep
  const repScores: RepScore[] = [];

  for (let r = 0; r < repRanges.length; r++) {
    const range = repRanges[r];
    const repData = buildDeadliftRepData(range, frameAnglesMap, frameIndices, fps, calibration, frames);
    repData.repNumber = r + 1;
    const score = scoreDeadliftRep(repData, config, calibration);
    repScores.push(score);
  }

  const overallScore = computeSetScore(repScores);
  const fatigueDetected = detectFatigue(repScores);
  const topIssues = aggregateTopIssues(repScores);
  const topCues = getDeadliftCues(topIssues);

  const positiveHighlights = aggregatePositiveFeedback(repScores);
  const mobilityFindings = assessMobility(topIssues, config.experienceLevel);
  const warmupProtocol = generateWarmupProtocol(topIssues, config.experienceLevel);
  const { repFrameMap: rfm, repStartFrames: rsf } = buildRepFrameMap(repRanges, frameIndices);

  return {
    repCount: repRanges.length,
    reps: repScores,
    overallScore,
    grade: scoreToGrade(overallScore, config.experienceLevel),
    fatigueDetected,
    topIssues,
    topCues,
    calibration,
    config: sqConfig,
    repFrameMap: rfm,
    repStartFrames: rsf,
    detectedCameraView,
    positiveHighlights,
    mobilityFindings,
    warmupProtocol,
    competitionMode: config.competitionMode,
  };
}
