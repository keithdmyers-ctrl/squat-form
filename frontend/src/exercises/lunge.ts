/**
 * Lunge form analysis: phase detection, issue detection, scoring, and cues.
 * Uses front knee angle as the primary movement driver (single-leg pattern).
 * Supports forward, reverse, walking, and Bulgarian split squat variants.
 */

import { computeFrameAngles, pickSide } from '../angles';
import { calibrateFromStanding, detectCameraView } from '../calibration';
import { SquatPhase } from '../types';
import type {
  LungeType,
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
} from '../types';
import { clamp, scoreToGrade, scoreTempo } from '../scorer';
import { computeVelocityMetrics } from '../competition';
import { assessMobility, generateWarmupProtocol } from '../mobility';
import { detectFatigue, aggregateTopIssues, aggregatePositiveFeedback, computeSetScore, createEmptyAnalysis, buildRepFrameMap } from '../exercise-core';

// ─── Lunge Config ───

export interface LungeConfig {
  lungeType: LungeType;
  experienceLevel: ExperienceLevel;
  competitionMode: boolean;
}

// ─── Phase Detection (knee angle driven) ───

const STANDING_KNEE_ANGLE = 155;
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

class LungePhaseDetector {
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

  update(kneeAngle: number): SquatPhase {
    const smoothed = smoothAngle(this.smoothBuffer, kneeAngle, SMOOTHING_WINDOW);
    this.smoothedHistory.push(smoothed);
    if (this.smoothedHistory.length > HISTORY_WINDOW + 1) this.smoothedHistory.shift();

    const delta = this.prevSmoothedAngle !== null ? smoothed - this.prevSmoothedAngle : 0;
    const cumDelta = this.cumulativeDelta();

    switch (this.phase) {
      case SquatPhase.STANDING:
        this.bottomHoldCount = 0;
        if (smoothed < STANDING_KNEE_ANGLE && cumDelta < -DESCENDING_THRESHOLD) {
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
        if (smoothed >= STANDING_KNEE_ANGLE) {
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

function detectLungeReps(kneeAngles: number[]): RepRange[] {
  const detector = new LungePhaseDetector();
  const reps: RepRange[] = [];
  let repStart = -1;
  let bottomIdx = -1;
  let minAngleInRep = 180;

  for (let i = 0; i < kneeAngles.length; i++) {
    const prevPhase = detector.getCurrentPhase();
    const phase = detector.update(kneeAngles[i]);

    if (prevPhase === SquatPhase.STANDING && phase === SquatPhase.DESCENDING) {
      repStart = i;
      minAngleInRep = kneeAngles[i];
      bottomIdx = i;
    }

    if (repStart >= 0 && (phase === SquatPhase.DESCENDING || phase === SquatPhase.BOTTOM)) {
      if (kneeAngles[i] < minAngleInRep) {
        minAngleInRep = kneeAngles[i];
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

// ─── Lunge Scoring ───

/** Scoring weights for lunge. */
const LUNGE_WEIGHTS = {
  depth: 0.25,
  kneeTracking: 0.20,
  trunk: 0.20,
  balance: 0.15,
  tempo: 0.10,
  lockout: 0.10,
};

/** Depth thresholds: min knee angle at bottom (lower = deeper). */
const LUNGE_DEPTH_THRESHOLDS: Record<ExperienceLevel, number> = {
  beginner: 110,       // Partial lunge OK
  intermediate: 100,   // Near 90 degrees
  advanced: 90,        // Full depth (90 degrees or below)
};

function scoreLungeDepth(minKneeAngle: number, config: LungeConfig): number {
  const threshold = LUNGE_DEPTH_THRESHOLDS[config.experienceLevel];

  // Below threshold - 20 degrees: perfect score
  if (minKneeAngle <= threshold - 20) return 100;
  // Between threshold-20 and threshold: minor deduction
  if (minKneeAngle <= threshold) {
    const frac = (minKneeAngle - (threshold - 20)) / 20;
    return clamp(100 - frac * 20, 0, 100);
  }
  // Above threshold: significant deduction
  const over = minKneeAngle - threshold;
  return clamp(80 - over * 2, 0, 100);
}

/** Knee tracking: shin angle should be < 80 degrees from vertical (knee not excessively past toes). */
function scoreLungeKneeTracking(rep: RepData): number {
  const shinAngles = rep.frameAngles.map(fa => fa.shinAngle);
  if (shinAngles.length === 0) return 90;

  const maxShinAngle = Math.max(...shinAngles);

  // Shin angle < 70: excellent tracking
  if (maxShinAngle <= 70) return 100;
  // 70-80: minor concern
  if (maxShinAngle <= 80) return clamp(100 - ((maxShinAngle - 70) / 10) * 20, 0, 100);
  // Above 80: excessive forward travel
  return clamp(80 - (maxShinAngle - 80) * 2, 0, 100);
}

/** Trunk score: torso should stay upright (trunk angle from vertical < 20 ideal). */
function scoreLungeTrunk(maxTrunkAngle: number): number {
  if (maxTrunkAngle <= 15) return 100;
  if (maxTrunkAngle <= 20) return clamp(100 - ((maxTrunkAngle - 15) / 5) * 10, 0, 100);
  if (maxTrunkAngle <= 30) return clamp(90 - ((maxTrunkAngle - 20) / 10) * 20, 0, 100);
  return clamp(70 - (maxTrunkAngle - 30) * 1.5, 0, 100);
}

/** Balance score: hip symmetry as proxy for lateral sway. */
function scoreLungeBalance(rep: RepData): number {
  const symmetryValues = rep.frameAngles.map(fa => fa.hipSymmetry).filter((v): v is number => v !== null);
  if (symmetryValues.length === 0) return 90;

  const maxAsymmetry = Math.max(...symmetryValues);
  if (maxAsymmetry < 0.05) return 100;
  if (maxAsymmetry < 0.10) return clamp(100 - ((maxAsymmetry - 0.05) / 0.05) * 15, 0, 100);
  if (maxAsymmetry < 0.20) return clamp(85 - ((maxAsymmetry - 0.10) / 0.10) * 25, 0, 100);
  return clamp(60 - (maxAsymmetry - 0.20) * 100, 0, 100);
}

/** Lockout score: full standing between reps (knee angle near standing). */
function scoreLungeLockout(rep: RepData, calibration: CalibrationData | null): number {
  const lastAngles = rep.frameAngles.slice(-5);
  if (lastAngles.length === 0) return 50;

  const finalKneeAngle = Math.max(...lastAngles.map(fa => fa.kneeAngle));
  const standingKnee = calibration?.standingKneeAngle ?? 175;
  const diff = Math.abs(finalKneeAngle - standingKnee);

  if (diff <= 10) return 100;
  if (diff <= 20) return clamp(100 - ((diff - 10) / 10) * 25, 0, 100);
  return clamp(75 - (diff - 20) * 1.5, 0, 100);
}

// ─── Lunge Issue Detection ───

function detectLungeIssues(
  rep: RepData,
  config: LungeConfig,
  calibration: CalibrationData | null,
): FormIssue[] {
  const issues: FormIssue[] = [];

  // 1. Knee past toes: shin angle > 80 degrees
  // Note: forward knee travel is not inherently harmful (Schoenfeld 2010; Hartmann et al. 2013),
  // but very excessive forward shin angles can increase patellofemoral loading. Capped at
  // MODERATE severity since this is position-dependent, not a direct injury mechanism.
  const shinAngles = rep.frameAngles.map(fa => fa.shinAngle);
  const maxShinAngle = shinAngles.length > 0 ? Math.max(...shinAngles) : 0;
  if (maxShinAngle > 80) {
    issues.push({
      name: 'knee_past_toes_lunge',
      severity: maxShinAngle > 90 ? 'moderate' : 'low',
      description: 'Front knee is traveling far past your toes — a longer stride may shift more work to your glutes',
      value: maxShinAngle,
      threshold: 80,
      phase: SquatPhase.BOTTOM,
      frame: rep.bottomFrame,
    });
  }

  // 2. Insufficient depth: knee angle too high at bottom
  const depthThreshold = LUNGE_DEPTH_THRESHOLDS[config.experienceLevel];
  if (rep.minKneeAngle > depthThreshold) {
    issues.push({
      name: 'insufficient_depth_lunge',
      severity: rep.minKneeAngle > depthThreshold + 15 ? 'moderate' : 'low',
      description: 'Didn\'t lunge deep enough — aim to get your front thigh parallel to the floor',
      value: rep.minKneeAngle,
      threshold: depthThreshold,
      phase: SquatPhase.BOTTOM,
      frame: rep.bottomFrame,
    });
  }

  // 3. Forward lean: trunk angle too large (> 25 degrees from vertical)
  if (rep.maxTrunkAngle > 25) {
    issues.push({
      name: 'forward_lean_lunge',
      severity: rep.maxTrunkAngle > 35 ? 'moderate' : 'low',
      description: 'Your torso is leaning too far forward — keep your chest tall and upright',
      value: rep.maxTrunkAngle,
      threshold: 25,
      phase: SquatPhase.BOTTOM,
      frame: rep.bottomFrame,
    });
  }

  // 4. Knee valgus: front knee caving inward
  // Use FPPA or kneeWidthRatio as proxy
  let worstKneeRatio = 1.0;
  for (const fa of rep.frameAngles) {
    if (fa.kneeWidthRatio !== null && fa.kneeWidthRatio < worstKneeRatio) {
      worstKneeRatio = fa.kneeWidthRatio;
    }
  }
  if (worstKneeRatio < 0.85) {
    issues.push({
      name: 'knee_valgus_lunge',
      severity: worstKneeRatio < 0.70 ? 'high' : 'moderate',
      description: 'Your front knee is caving inward — push your knee out over your pinky toe',
      value: worstKneeRatio,
      threshold: 0.85,
      phase: SquatPhase.BOTTOM,
      frame: rep.bottomFrame,
    });
  }

  // 5. Incomplete lockout
  const lastAngles = rep.frameAngles.slice(-5);
  const finalKneeAngle = lastAngles.length > 0 ? Math.max(...lastAngles.map(fa => fa.kneeAngle)) : 0;
  if (finalKneeAngle < 155) {
    issues.push({
      name: 'incomplete_lockout_lunge',
      severity: finalKneeAngle < 140 ? 'moderate' : 'low',
      description: 'Didn\'t fully stand up between reps — extend your legs completely',
      value: finalKneeAngle,
      threshold: 155,
      phase: SquatPhase.STANDING,
      frame: rep.endFrame,
    });
  }

  // 6. Fast descent (uncontrolled lunge)
  if (rep.descentDuration < 0.6) {
    issues.push({
      name: 'fast_descent',
      severity: 'low',
      description: `Descent was ${rep.descentDuration.toFixed(1)}s — lower yourself with more control`,
      value: rep.descentDuration,
      threshold: 0.6,
      phase: SquatPhase.DESCENDING,
      frame: rep.startFrame,
    });
  }

  return issues;
}

// ─── Lunge Coaching Cues ───

const LUNGE_CUE_DATABASE: Record<string, { cue: string; priority: number; explanation: string; explanationBeginner?: string }> = {
  knee_past_toes_lunge: {
    cue: 'Take a longer stride — keep your shin closer to vertical',
    priority: 2,
    explanation: 'Your front knee is traveling well past your toes. While some forward knee travel is normal and not inherently harmful (Schoenfeld 2010), a very forward shin angle can increase patellofemoral loading and shifts work away from your glutes and hamstrings. If you have no knee pain, this is a preference — but a longer stride often feels stronger and trains the posterior chain more effectively. Think about dropping straight down rather than lunging forward.',
    explanationBeginner: 'Your front knee is going pretty far past your toes. This isn\'t necessarily bad, but taking a bigger step usually lets you work your glutes and hamstrings more. At the bottom of the lunge, try to keep your shin (the front of your lower leg) roughly straight up and down. Think about going DOWN, not forward. If your knees feel fine, don\'t stress about this too much!',
  },
  insufficient_depth_lunge: {
    cue: 'Drop your back knee toward the floor — aim for 90° at both knees',
    priority: 2,
    explanation: 'You\'re not lunging deep enough to fully engage your glutes and quads. Aim to lower your back knee until it nearly touches the floor, which should create roughly 90-degree angles at both knees. If mobility limits your depth, work on hip flexor stretches.',
    explanationBeginner: 'You\'re not going low enough. Try to lower your body until your back knee almost touches the floor. Imagine there\'s a pillow under your back knee that you\'re trying to gently touch. Both knees should be bent to about 90 degrees.',
  },
  forward_lean_lunge: {
    cue: 'Keep your chest tall — look straight ahead',
    priority: 3,
    explanation: 'Your torso is leaning too far forward, which shifts the load onto your lower back instead of your legs. Keep your chest up and proud, and look straight ahead rather than down. Engage your core to maintain an upright posture throughout the movement.',
    explanationBeginner: 'Your upper body is leaning forward too much. Stand up straighter! Imagine a string pulling the top of your head toward the ceiling. Look straight ahead (not at the floor) and keep your chest puffed up throughout the whole lunge.',
  },
  knee_valgus_lunge: {
    cue: 'Push your front knee out over your pinky toe',
    priority: 1,
    explanation: 'Your front knee is collapsing inward during the lunge, which indicates hip abductor weakness and can lead to knee injury. Actively push your knee outward so it tracks over your 4th-5th toes. Banded lateral walks and clamshells will help strengthen the muscles responsible.',
    explanationBeginner: 'Your front knee is caving inward, which can hurt your knee over time. When you lunge, actively push your knee outward — it should point the same direction as your toes. Strengthening your hip muscles with exercises like side-lying leg raises will help fix this.',
  },
  incomplete_lockout_lunge: {
    cue: 'Stand all the way up between reps — lock your knees',
    priority: 5,
    explanation: 'You\'re not fully returning to a standing position between reps. Complete each rep by driving through your front heel and fully extending both legs. This ensures you get the full range of motion benefit and resets your balance for the next rep.',
    explanationBeginner: 'Make sure you stand all the way up after each lunge before starting the next one. Push through your front foot and straighten both legs completely. This gives you a chance to reset your balance and makes each rep count more.',
  },
  fast_descent: {
    cue: 'Control the descent — lower yourself over 1-2 seconds',
    priority: 6,
    explanation: 'You\'re dropping into the lunge too quickly, which reduces muscle engagement and makes it harder to maintain balance. Aim for a controlled 1-2 second descent.',
    explanationBeginner: 'You\'re going down too fast! Take 1-2 seconds to lower yourself into the lunge. Going slower builds more strength and helps you keep your balance. Think about it as a controlled drop, not a fall.',
  },
};

function getLungeCues(issues: FormIssue[], experienceLevel?: string): CoachingCue[] {
  const cueMap = new Map<string, CoachingCue>();
  for (const issue of issues) {
    const entry = LUNGE_CUE_DATABASE[issue.name];
    if (!entry || cueMap.has(issue.name)) continue;
    const explanation = (experienceLevel === 'beginner' && entry.explanationBeginner)
      ? entry.explanationBeginner : entry.explanation;
    cueMap.set(issue.name, { issue: issue.name, cue: entry.cue, priority: entry.priority, explanation });
  }
  return Array.from(cueMap.values()).sort((a, b) => a.priority - b.priority);
}

// ─── Positive Feedback ───

function getLungePositiveFeedback(scores: {
  depth: number;
  kneeTracking: number;
  trunk: number;
  balance: number;
  tempo: number;
  lockout: number;
}): string[] {
  const feedback: string[] = [];
  if (scores.depth >= 90) feedback.push('Great lunge depth — good range of motion');
  if (scores.kneeTracking >= 90) feedback.push('Excellent knee tracking — shin stays vertical');
  if (scores.trunk >= 90) feedback.push('Upright torso — nice and tall');
  if (scores.balance >= 90) feedback.push('Steady balance — well controlled');
  if (scores.lockout >= 90) feedback.push('Full lockout between reps');
  if (scores.tempo >= 90) feedback.push('Good tempo and control');
  return feedback;
}

// ─── Rep Building & Scoring ───

function buildLungeRepData(
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

  const kneeAngles = repFrameAngles.map(fa => fa.kneeAngle);
  const trunkAngles = repFrameAngles.map(fa => fa.trunkAngle);
  const hipAngles = repFrameAngles.map(fa => fa.hipAngle);

  const minKneeAngle = kneeAngles.length > 0 ? Math.min(...kneeAngles) : 180;
  const minHipAngle = hipAngles.length > 0 ? Math.min(...hipAngles) : 180;
  const maxTrunkAngle = trunkAngles.length > 0 ? Math.max(...trunkAngles) : 0;

  const descentFrames = bottomIndex - start;
  const ascentFrames = end - bottomIndex;
  const descentDuration = fps > 0 ? descentFrames / fps : 0;
  const ascentDuration = fps > 0 ? ascentFrames / fps : 0;

  let bottomFrameCount = 0;
  for (const ka of kneeAngles) {
    if (ka <= minKneeAngle + 5) bottomFrameCount++;
  }
  const bottomDuration = fps > 0 ? bottomFrameCount / fps : 0;

  // Velocity metrics based on knee angles
  const bottomRelIdx = bottomIndex - start;
  const topAngle = kneeAngles.length > 0 ? Math.max(...kneeAngles) : 180;
  const velocity = computeVelocityMetrics(kneeAngles, bottomRelIdx, fps);

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
    stickingPoints: [],
    velocity,
  };
}

function scoreLungeRep(
  rep: RepData,
  config: LungeConfig,
  calibration: CalibrationData | null,
): RepScore {
  const depth = scoreLungeDepth(rep.minKneeAngle, config);
  const kneeTracking = scoreLungeKneeTracking(rep);
  const trunk = scoreLungeTrunk(rep.maxTrunkAngle);
  const balance = scoreLungeBalance(rep);
  const tempo = scoreTempo(rep.descentDuration, rep.bottomDuration, rep.ascentDuration);
  const lockout = scoreLungeLockout(rep, calibration);

  const w = LUNGE_WEIGHTS;

  const overall = clamp(
    Math.round(
      depth * w.depth +
      kneeTracking * w.kneeTracking +
      trunk * w.trunk +
      balance * w.balance +
      tempo * w.tempo +
      lockout * w.lockout,
    ),
    0, 100,
  );

  const issues = detectLungeIssues(rep, config, calibration);
  const cues = getLungeCues(issues, config.experienceLevel);
  const positiveFeedback = getLungePositiveFeedback({
    depth, kneeTracking, trunk, balance, tempo, lockout,
  });

  // Soft penalty for HIGH severity issues
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
    depthScore: depth,
    kneeTrackingScore: kneeTracking,
    trunkScore: trunk,
    symmetryScore: balance,
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
    dimensions: { depth, kneeTracking, trunk, balance, tempo, lockout },
    exerciseType: 'lunge',
  };
}

// ─── Uneven Stride Detection (cross-rep) ───

function detectUnevenStride(repScores: RepScore[]): FormIssue | null {
  if (repScores.length < 2) return null;

  const depthScores = repScores.map(r => r.depthScore);
  const maxScore = Math.max(...depthScores);
  const minScore = Math.min(...depthScores);
  const variance = maxScore - minScore;

  if (variance > 15) {
    return {
      name: 'uneven_stride',
      severity: variance > 25 ? 'moderate' : 'low',
      description: `Inconsistent depth between reps — ${variance.toFixed(0)} point variance. Try to lunge to the same depth each rep.`,
      value: variance,
      threshold: 15,
      phase: SquatPhase.BOTTOM,
      frame: repScores[repScores.length - 1].minKneeAngle !== undefined
        ? 0 : 0,
    };
  }

  return null;
}

// ─── Main Entry Point ───

export function analyzeLungeSequence(
  frames: FrameData,
  fps: number,
  config: LungeConfig,
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
  const kneeAnglesOrdered: number[] = [];
  for (const fi of frameIndices) {
    const lm = frames.get(fi)!;
    const fa = computeFrameAngles(lm, calibration?.standingKneeWidth ?? undefined);
    frameAnglesMap.set(fi, fa);
    kneeAnglesOrdered.push(fa.kneeAngle);
  }

  // Detect reps via knee angle
  const repRanges = detectLungeReps(kneeAnglesOrdered);
  if (repRanges.length === 0) return createEmptyAnalysis(sqConfig, calibration);

  // Score each rep
  const repScores: RepScore[] = [];

  for (let r = 0; r < repRanges.length; r++) {
    const range = repRanges[r];
    const repData = buildLungeRepData(range, frameAnglesMap, frameIndices, fps, calibration, frames);
    repData.repNumber = r + 1;
    const score = scoreLungeRep(repData, config, calibration);
    repScores.push(score);
  }

  // Cross-rep: uneven stride detection
  const unevenStride = detectUnevenStride(repScores);
  if (unevenStride) {
    // Append to each rep's issues
    for (const rs of repScores) {
      rs.issues.push(unevenStride);
    }
  }

  const overallScore = computeSetScore(repScores);
  const fatigueDetected = detectFatigue(repScores);
  const topIssues = aggregateTopIssues(repScores);
  const topCues = getLungeCues(topIssues, config.experienceLevel);

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
