/**
 * Calibration: body proportion measurement and trunk angle range computation.
 * Extracted from analyzer.ts — no behavior changes.
 */

import { computeFrameAngles, segmentLength, pickSide } from './angles';
import type {
  SquatType,
  Landmarks,
  CalibrationData,
} from './types';

// ─── Trunk angle ranges per squat type [min, max] degrees from vertical ───
// Based on: Stronger by Science, Squat University, PMC biomechanics reviews
export const TRUNK_ANGLE_RANGES: Record<SquatType, [number, number]> = {
  bodyweight: [25, 45],   // Upright to moderate lean
  high_bar: [30, 50],     // Research: 30-45° typical (Nuckols 2.0)
  low_bar: [40, 60],      // Research: 40-55° typical, ~10-15° more than high-bar
  front: [10, 25],        // Research: 10-20° (most upright loaded variation)
  goblet: [15, 30],       // Similar to front squat
  overhead: [10, 25],     // Must stay very upright to keep bar overhead
};

// ─── Femur/tibia adjustment: backend uses ratio_deviation * 5.5 * 10.0 = effective 55.0 ───
export const FEMUR_TIBIA_ADJUSTMENT_MULTIPLIER = 55.0;

/**
 * Calibrate from standing-position landmarks.
 * Measures body proportions and resting angles to personalize thresholds.
 */
export function calibrateFromStanding(landmarks: Landmarks): CalibrationData {
  const angles = computeFrameAngles(landmarks);

  // Pick better-visibility side for segment lengths
  const side = pickSide(landmarks);
  const shoulder = landmarks[`${side}_shoulder`];
  const hip = landmarks[`${side}_hip`];
  const knee = landmarks[`${side}_knee`];
  const ankle = landmarks[`${side}_ankle`];

  const rawTorso = segmentLength(shoulder, hip);
  const rawFemur = segmentLength(hip, knee);
  const rawTibia = segmentLength(knee, ankle);

  // Normalize segment lengths by total leg length (synced with backend calibration.py)
  let totalLeg = rawFemur + rawTibia;
  if (totalLeg < 1e-9) {
    totalLeg = 1.0; // prevent division by zero
  }

  const femurLength = rawFemur / totalLeg;
  const tibiaLength = rawTibia / totalLeg;
  const torsoLength = rawTorso / totalLeg;

  let standingKneeWidth: number | null = null;
  if (landmarks['left_knee'] && landmarks['right_knee']) {
    standingKneeWidth = Math.abs(landmarks['left_knee'].x - landmarks['right_knee'].x);
  }

  return {
    standingKneeAngle: angles.kneeAngle,
    standingHipAngle: angles.hipAngle,
    standingTrunkAngle: angles.trunkAngle,
    standingAnkleAngle: angles.ankleAngle,
    femurLength,
    tibiaLength,
    torsoLength,
    femurTibiaRatio: rawTibia > 1e-9 ? rawFemur / rawTibia : 1.0,
    torsoFemurRatio: rawFemur > 1e-9 ? rawTorso / rawFemur : 1.0,
    standingKneeWidth,
  };
}

/** Detected camera view angle. */
export type CameraView = 'side' | 'front' | 'unknown';

/**
 * Detect camera view from landmark geometry.
 * Side view: left/right shoulders overlap in X (small difference).
 * Front view: left/right shoulders are spread apart in X (large difference).
 *
 * Uses normalized image coordinates where X ranges 0-1 across the frame width.
 */
export function detectCameraView(landmarks: Landmarks): CameraView {
  const leftShoulder = landmarks['left_shoulder'];
  const rightShoulder = landmarks['right_shoulder'];

  if (!leftShoulder || !rightShoulder) return 'unknown';
  if (leftShoulder.visibility < 0.5 || rightShoulder.visibility < 0.5) return 'unknown';

  const shoulderXDiff = Math.abs(leftShoulder.x - rightShoulder.x);

  // In side view, both shoulders overlap (small X difference)
  // In front view, shoulders are spread apart (large X difference)
  // Threshold: ~0.08 normalized units for side view boundary
  if (shoulderXDiff < 0.08) return 'side';
  if (shoulderXDiff > 0.12) return 'front';
  return 'unknown';
}

/**
 * Get adjusted trunk angle range based on squat type and body proportions.
 * Synced with backend: ratio_deviation * PROPORTION_ADJUSTMENT_PER_RATIO * 10.0
 * where PROPORTION_ADJUSTMENT_PER_RATIO = 5.5, so effective multiplier = 55.0.
 * e.g. ratio 1.3 => deviation 0.3 => 0.3 * 55 = 16.5 degrees
 */
export function getTrunkAngleRange(
  squatType: SquatType,
  calibration: CalibrationData | null,
): [number, number] {
  const base = TRUNK_ANGLE_RANGES[squatType];
  if (!calibration) return base;

  // Adjust for femur/tibia ratio deviation from 1.0
  // Higher ratio (longer femurs) -> more forward lean allowed
  const ratioDeviation = calibration.femurTibiaRatio - 1.0;
  let adjustment = ratioDeviation * FEMUR_TIBIA_ADJUSTMENT_MULTIPLIER;

  // Squat-type-specific clamps for trunk angle adjustment
  switch (squatType) {
    case 'low_bar':
      adjustment = Math.max(-20, Math.min(30, adjustment));
      break;
    case 'high_bar':
      adjustment = Math.max(-15, Math.min(25, adjustment));
      break;
    case 'front':
    case 'overhead':
    case 'goblet':
      adjustment = Math.max(-10, Math.min(15, adjustment));
      break;
    case 'bodyweight':
    default:
      adjustment = Math.max(-15, Math.min(20, adjustment));
      break;
  }

  return [base[0] + adjustment, base[1] + adjustment];
}
