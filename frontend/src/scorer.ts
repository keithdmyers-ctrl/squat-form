/**
 * Scoring functions: depth, knee tracking, trunk, symmetry, tempo, lockout.
 * Extracted from analyzer.ts — no behavior changes.
 */

import type {
  ExperienceLevel,
  SquatConfig,
  CalibrationData,
  RepData,
} from './types';
import { getTrunkAngleRange } from './calibration';

// ─── Depth thresholds (included knee angle — lower = deeper) ───
// Research: parallel ≈ 80-90° included angle (110-120° flexion from extension)
// Thresholds are lenient to account for MediaPipe measurement variance (~±5°)
export const DEPTH_THRESHOLDS: Record<ExperienceLevel, number> = {
  beginner: 110,      // Above parallel (learning form safely)
  intermediate: 100,  // Near parallel
  advanced: 90,       // At/below parallel (NSCA/IPF standard)
};

// ─── Angle tolerances per experience level ───
export const ANGLE_TOLERANCES: Record<ExperienceLevel, number> = {
  beginner: 20,
  intermediate: 15,
  advanced: 10,
};

// ─── Valgus sensitivity (knee width ratio vs standing width) ───
// Research: <5° FPPA is minimal concern, 10-15° moderate, >15° significant
// These ratios approximate those angular thresholds via knee-width measurement
export const VALGUS_THRESHOLDS: Record<ExperienceLevel, number> = {
  beginner: 0.70,
  intermediate: 0.75,
  advanced: 0.80,
};

// ─── Ideal tempo range in seconds ───
// Research (Wilk et al. 2021, J Hum Kinet): 2-4s eccentric optimal for strength;
// <1s = uncontrolled, >4s = excessive time under tension with diminishing returns
export const IDEAL_DESCENT_MIN = 1.0;
export const IDEAL_DESCENT_MAX = 4.0;

// ─── Scoring weights ───
export const WEIGHTS = {
  depth: 0.25,
  kneeTracking: 0.20,
  trunk: 0.20,
  symmetry: 0.10,
  tempo: 0.10,
  lockout: 0.15,
};

// Competition mode weights: no tempo scoring, emphasis on depth and lockout
export const COMPETITION_WEIGHTS = {
  depth: 0.30,
  kneeTracking: 0.25,
  trunk: 0.15,
  symmetry: 0.10,
  tempo: 0.00,
  lockout: 0.20,
};

/** Redistribute weights when a dimension cannot be measured. */
export function redistributeWeights(
  baseWeights: Record<string, number>,
  exclude: string,
): Record<string, number> {
  const excludedWeight = baseWeights[exclude] ?? 0;
  const remaining: Record<string, number> = {};
  let totalRemaining = 0;
  for (const [k, v] of Object.entries(baseWeights)) {
    if (k !== exclude) {
      remaining[k] = v;
      totalRemaining += v;
    }
  }
  if (totalRemaining <= 0) return baseWeights;
  const scale = (totalRemaining + excludedWeight) / totalRemaining;
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(remaining)) {
    result[k] = v * scale;
  }
  result[exclude] = 0;
  return result;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Score depth using linear interpolation (synced with backend scorer.py).
 * threshold-20 -> 100, threshold -> 80, above threshold -> 80 - over*2
 */
export function scoreDepth(minKneeAngle: number, config: SquatConfig): number {
  const threshold = DEPTH_THRESHOLDS[config.experienceLevel];

  if (minKneeAngle <= threshold - 20) {
    return 100;
  }

  if (minKneeAngle <= threshold) {
    // Linear from 100 at (threshold-20) to 80 at threshold
    const frac = (minKneeAngle - (threshold - 20)) / 20;
    return clamp(100 - frac * 20, 0, 100);
  }

  // Above threshold -- score degrades
  const over = minKneeAngle - threshold;
  return clamp(80 - over * 2, 0, 100);
}

/**
 * Score knee tracking (synced with backend scorer.py score_knee_tracking).
 * Uses continuous interpolation with configurable valgus threshold.
 */
export function scoreKneeTracking(rep: RepData, config: SquatConfig): number {
  const valgusThreshold = VALGUS_THRESHOLDS[config.experienceLevel];

  // Find worst knee width ratio in the rep
  let minKneeWidthRatio: number | null = null;
  for (const fa of rep.frameAngles) {
    if (fa.kneeWidthRatio !== null) {
      if (minKneeWidthRatio === null || fa.kneeWidthRatio < minKneeWidthRatio) {
        minKneeWidthRatio = fa.kneeWidthRatio;
      }
    }
  }

  if (minKneeWidthRatio === null) {
    // No frontal data available -- reduced confidence
    if (rep.kneeValgus) return 60;
    return 75;
  }

  let score: number;
  if (minKneeWidthRatio >= 0.95) {
    score = 100;
  } else if (minKneeWidthRatio >= valgusThreshold) {
    // Linear from 100 at 0.95 to 80 at valgusThreshold
    const frac = (0.95 - minKneeWidthRatio) / (0.95 - valgusThreshold);
    score = clamp(100 - frac * 20, 0, 100);
  } else {
    // Gradual penalty below threshold
    const distance = valgusThreshold - minKneeWidthRatio;
    score = clamp(80 - distance * 150, 0, 100);
  }

  if (rep.kneeValgus) {
    score -= 5;
  }

  // FPPA-based penalty: additional valgus detection from frontal plane projection angle
  let maxFppa = 0;
  for (const fa of rep.frameAngles) {
    if (fa.fppa !== undefined && fa.fppa > maxFppa) {
      maxFppa = fa.fppa;
    }
  }
  if (maxFppa > 20) {
    score -= 25;
  } else if (maxFppa > 15) {
    score -= 15;
  } else if (maxFppa > 10) {
    score -= 5;
  }
  // 0-10° is good, no penalty

  return clamp(score, 0, 100);
}

/**
 * Score trunk position (synced with backend scorer.py score_trunk).
 * Continuous linear interpolation within tolerance, then degrades beyond.
 */
export function scoreTrunk(
  maxTrunkAngle: number,
  config: SquatConfig,
  calibration: CalibrationData | null,
): number {
  const [minExpected, maxExpected] = getTrunkAngleRange(config.squatType, calibration);
  const tolerance = ANGLE_TOLERANCES[config.experienceLevel];

  // Within acceptable range
  if (maxTrunkAngle >= minExpected && maxTrunkAngle <= maxExpected) {
    return 100;
  }

  // Compute deviation from nearest bound
  let deviation: number;
  if (maxTrunkAngle < minExpected) {
    deviation = minExpected - maxTrunkAngle;
  } else {
    deviation = maxTrunkAngle - maxExpected;
  }

  if (deviation <= tolerance) {
    // Continuous linear: 100 at deviation=0, 85 at deviation=tolerance
    return clamp(100 - (deviation / tolerance) * 15, 0, 100);
  } else {
    // Beyond tolerance: degrades from 85 gradually
    return clamp(85 - (deviation - tolerance) * 1.5, 0, 100);
  }
}

/**
 * Score symmetry (synced with backend scorer.py score_symmetry).
 * Continuous interpolation across four bands.
 */
export function scoreSymmetry(rep: RepData): number {
  // Check hip symmetry from frame angles
  const symmetryValues = rep.frameAngles
    .map((fa) => fa.hipSymmetry)
    .filter((v): v is number => v !== null);

  if (symmetryValues.length === 0) return 90; // No data -- assume decent (matches backend)

  const maxAsymmetry = Math.max(...symmetryValues);

  if (maxAsymmetry < 0.05) {
    return 100; // Within MediaPipe measurement noise
  } else if (maxAsymmetry < 0.10) {
    // Linear from 100 at 0.05 to 85 at 0.10
    const frac = (maxAsymmetry - 0.05) / 0.05;
    return clamp(100 - frac * 15, 0, 100);
  } else if (maxAsymmetry < 0.20) {
    // Linear from 85 at 0.10 to 60 at 0.20
    const frac = (maxAsymmetry - 0.10) / 0.10;
    return clamp(85 - frac * 25, 0, 100);
  } else {
    // Beyond 0.20: degrades from 60
    return clamp(60 - (maxAsymmetry - 0.20) * 100, 0, 100);
  }
}

/**
 * Score tempo (synced with backend scorer.py score_tempo).
 * Checks descent_duration, bottom_pause, AND ascent_duration independently.
 * Starts at 100, subtracts penalties.
 */
export function scoreTempo(
  descentDuration: number,
  bottomDuration: number,
  ascentDuration: number,
): number {
  let score = 100;

  // Descent scoring: ideal 1.0-4.0s
  if (descentDuration >= IDEAL_DESCENT_MIN && descentDuration <= IDEAL_DESCENT_MAX) {
    // Perfect -- no penalty
  } else if (descentDuration < IDEAL_DESCENT_MIN) {
    score -= Math.min(20, (IDEAL_DESCENT_MIN - descentDuration) * 20);
  } else {
    score -= Math.min(10, (descentDuration - IDEAL_DESCENT_MAX) * 5);
  }

  // Bottom pause scoring: ideal 0.1-1.5s
  if (bottomDuration >= 0.1 && bottomDuration <= 1.5) {
    // Perfect -- no penalty
  } else if (bottomDuration < 0.1) {
    score -= 10; // Bouncing
  } else {
    score -= Math.min(10, (bottomDuration - 1.5) * 5);
  }

  // Very fast ascent: if < 0.2s, suspicious
  if (ascentDuration < 0.2) {
    score -= 5;
  }

  return clamp(score, 0, 100);
}

/**
 * Score lockout (synced with backend scorer.py score_lockout).
 * Compares final knee angle to calibrated standing knee angle.
 * Within 5 deg = 100, within 15 deg = 70-100 linear, beyond degrades.
 */
export function scoreLockout(rep: RepData, calibration: CalibrationData | null): number {
  const lastAngles = rep.frameAngles.slice(-5);
  if (lastAngles.length === 0) return 50;

  const finalKnee = Math.max(...lastAngles.map((fa) => fa.kneeAngle));
  const standingKnee = calibration?.standingKneeAngle ?? 175;

  // Allow slight hyperextension: if finalKnee >= (standingKnee - 5), score 100
  if (finalKnee >= standingKnee - 5) {
    return 100;
  }

  // Only penalize when finalKnee < standingKnee - 5
  const diff = (standingKnee - 5) - finalKnee;

  if (diff <= 10) {
    // Linear from 100 at diff=0 to 75 at diff=10
    const frac = diff / 10;
    return clamp(100 - frac * 25, 0, 100);
  } else {
    // Beyond 10 degrees below threshold
    return clamp(75 - (diff - 10) * 1.5, 0, 100);
  }
}

/** Stricter lockout scoring for competition mode (synced with backend score_lockout_competition). */
export function scoreCompetitionLockout(rep: RepData, calibration: CalibrationData | null): number {
  const lastAngles = rep.frameAngles.slice(-5);
  if (lastAngles.length === 0) return 30;

  const finalKnee = Math.max(...lastAngles.map((fa) => fa.kneeAngle));
  const standingKnee = calibration?.standingKneeAngle ?? 175;
  const diff = Math.abs(finalKnee - standingKnee);

  if (diff <= 3.0) return 100;
  if (diff <= 5.0) return 80;
  if (diff <= 10.0) return 50;
  return 20;
}

export function scoreToGrade(score: number, experienceLevel?: ExperienceLevel): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  // Never show "F" to beginners — show "Keep Working" instead
  if (experienceLevel === 'beginner') return 'Keep Working';
  return 'F';
}

// ─── Positive Feedback (synced with backend get_positive_feedback_from_scores) ───

export interface PositiveFeedbackScores {
  depth: number;
  kneeTracking: number;
  trunk: number;
  symmetry: number;
  tempo: number;
  lockout: number;
}

export function getPositiveFeedback(scores: PositiveFeedbackScores): string[] {
  const feedback: string[] = [];

  if (scores.depth >= 90) {
    feedback.push('Great depth -- you hit well below parallel');
  } else if (scores.depth >= 80) {
    feedback.push('Good depth -- you reached parallel');
  }

  if (scores.kneeTracking >= 90) {
    feedback.push('Excellent knee tracking -- knees stayed right over your toes');
  }

  if (scores.trunk >= 90) {
    feedback.push('Nice upright torso position');
  }

  if (scores.tempo >= 90) {
    feedback.push('Good controlled tempo');
  }

  if (scores.symmetry >= 90) {
    feedback.push('Even weight distribution -- nice and balanced');
  }

  if (scores.lockout >= 90) {
    feedback.push('Strong lockout at the top');
  }

  return feedback;
}

// ─── Specific Positive Reinforcement with Numbers ───

import type { RepScore } from './types';

/**
 * Generate specific positive feedback with numerical scores for high-performing dimensions.
 * Returns feedback strings that include the actual averaged score values for transparency.
 */
export function generateSpecificPositives(reps: RepScore[], _calibration: CalibrationData | null): string[] {
  const positives: string[] = [];
  if (reps.length === 0) return positives;

  // Average dimension scores
  const avgDepth = reps.reduce((s, r) => s + r.depthScore, 0) / reps.length;
  const avgKnee = reps.reduce((s, r) => s + r.kneeTrackingScore, 0) / reps.length;
  const avgTrunk = reps.reduce((s, r) => s + r.trunkScore, 0) / reps.length;
  const avgSymmetry = reps.reduce((s, r) => s + r.symmetryScore, 0) / reps.length;
  const avgTempo = reps.reduce((s, r) => s + r.tempoScore, 0) / reps.length;
  const avgLockout = reps.reduce((s, r) => s + r.lockoutScore, 0) / reps.length;

  if (avgDepth >= 90) positives.push(`Depth averaged ${Math.round(avgDepth)} — well below parallel.`);
  if (avgKnee >= 90) positives.push(`Knee tracking scored ${Math.round(avgKnee)} — knees stayed well aligned.`);
  if (avgTrunk >= 90) positives.push(`Torso position scored ${Math.round(avgTrunk)} — great upper body control.`);
  if (avgSymmetry >= 90) positives.push(`Left/right balance scored ${Math.round(avgSymmetry)} — very symmetric.`);
  if (avgTempo >= 90) positives.push(`Tempo control scored ${Math.round(avgTempo)} — smooth, controlled movement.`);
  if (avgLockout >= 90) positives.push(`Lockout scored ${Math.round(avgLockout)} — full extension every rep.`);

  // Consistency
  const scores = reps.map(r => r.overallScore);
  const range = Math.max(...scores) - Math.min(...scores);
  if (range <= 5 && reps.length >= 3) {
    positives.push(`Only ${range}-point spread across ${reps.length} reps — excellent consistency.`);
  }

  return positives;
}

// ─── Task 6.6: Butt Wink Severity Assessment ───

/**
 * Determine butt wink severity based on context.
 *
 * Per DPT review: "Mild posterior pelvic tilt at the very bottom of a deep squat
 * is often a benign finding related to hip morphology (Vigotsky et al. 2019, Sports Med).
 * For unloaded squats, butt wink at MODERATE severity may alarm beginners unnecessarily."
 *
 * Rules:
 * - Beginners with mild butt wink (< 10 degrees pelvic tilt): not flagged at all
 * - Unloaded (weight = 0 or not provided): downgrade MODERATE to LOW
 * - Add contextual note about hip structure
 */
export interface ButtWinkAssessment {
  /** Whether to flag the butt wink as an issue at all */
  shouldFlag: boolean;
  /** Adjusted severity: 'high' | 'moderate' | 'low' */
  severity: 'high' | 'moderate' | 'low';
  /** Explanation string, potentially including the reassuring note */
  explanation: string;
  /** The reassuring note about hip morphology */
  note: string;
}

export function assessButtWinkSeverity(
  pelvicTiltDegrees: number,
  options: {
    experienceLevel: ExperienceLevel;
    weight?: number;          // 0 or undefined = bodyweight/unloaded
    hasButtWink: boolean;     // whether the threshold was crossed
  },
): ButtWinkAssessment {
  const morphologyNote = 'Note: Some hip tucking at the bottom is normal and related to your hip structure. It\'s only a concern under heavy loading.';
  const isUnloaded = !options.weight || options.weight === 0;
  const isBeginner = options.experienceLevel === 'beginner';
  const isMild = pelvicTiltDegrees < 10;

  // Not flagged at all: butt wink wasn't detected
  if (!options.hasButtWink) {
    return {
      shouldFlag: false,
      severity: 'low',
      explanation: '',
      note: morphologyNote,
    };
  }

  // Beginners with mild butt wink (< 10 degrees): don't flag at all
  if (isBeginner && isMild) {
    return {
      shouldFlag: false,
      severity: 'low',
      explanation: '',
      note: morphologyNote,
    };
  }

  // Determine base severity
  let severity: 'high' | 'moderate' | 'low';
  if (pelvicTiltDegrees > 20) {
    severity = 'high';
  } else if (pelvicTiltDegrees > 8) {
    severity = 'moderate';
  } else {
    severity = 'low';
  }

  // Unloaded squats: downgrade MODERATE to LOW
  if (isUnloaded && severity === 'moderate') {
    severity = 'low';
  }

  // Build explanation based on severity
  let explanation: string;
  if (severity === 'high') {
    explanation = `Pronounced lower back rounding at the bottom (${Math.round(pelvicTiltDegrees)}° pelvic tilt). Under heavier loads this becomes a concern for disc health. Limit your depth to where your back stays neutral.`;
  } else if (severity === 'moderate') {
    explanation = `Pelvis tucked under at the bottom position (${Math.round(pelvicTiltDegrees)}° pelvic tilt). ${morphologyNote}`;
  } else {
    explanation = `Slight pelvic tilt at the bottom (${Math.round(pelvicTiltDegrees)}°). ${morphologyNote}`;
  }

  return {
    shouldFlag: true,
    severity,
    explanation,
    note: morphologyNote,
  };
}
