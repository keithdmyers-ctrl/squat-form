import { describe, it, expect } from 'vitest';
import {
  calibrateFromStanding,
  getTrunkAngleRange,
  detectCameraView,
  TRUNK_ANGLE_RANGES,
  FEMUR_TIBIA_ADJUSTMENT_MULTIPLIER,
} from '../calibration';
import type { Point, CalibrationData, Landmarks } from '../types';

// ── Helpers ──

function makePoint(x: number, y: number, visibility = 1.0): Point {
  return { x, y, z: 0, visibility };
}

function makeCalibration(overrides: Partial<CalibrationData> = {}): CalibrationData {
  return {
    standingKneeAngle: 170,
    standingHipAngle: 170,
    standingTrunkAngle: 5,
    standingAnkleAngle: 90,
    femurLength: 0.4,
    tibiaLength: 0.4,
    torsoLength: 0.5,
    femurTibiaRatio: 1.0,
    torsoFemurRatio: 1.25,
    standingKneeWidth: 0.2,
    ...overrides,
  };
}

// ── Tests ──

describe('calibrateFromStanding', () => {
  it('computes femur/tibia ratio from standing landmarks', () => {
    // Standing person: vertical alignment
    const landmarks: Landmarks = {
      left_shoulder: makePoint(0.5, 0.2, 0.9),
      left_hip: makePoint(0.5, 0.5, 0.9),
      left_knee: makePoint(0.5, 0.75, 0.9),
      left_ankle: makePoint(0.5, 1.0, 0.9),
      right_shoulder: makePoint(0.5, 0.2, 0.5),
      right_hip: makePoint(0.5, 0.5, 0.5),
      right_knee: makePoint(0.5, 0.75, 0.5),
      right_ankle: makePoint(0.5, 1.0, 0.5),
    };

    const cal = calibrateFromStanding(landmarks);

    // raw femur = hip-to-knee distance = |0.5 - 0.75| = 0.25
    // raw tibia = knee-to-ankle distance = |0.75 - 1.0| = 0.25
    // totalLeg = 0.25 + 0.25 = 0.50
    // femurLength = 0.25 / 0.50 = 0.5 (normalized)
    // tibiaLength = 0.25 / 0.50 = 0.5 (normalized)
    // ratio = 0.25 / 0.25 = 1.0 (computed from raw values)
    expect(cal.femurTibiaRatio).toBeCloseTo(1.0, 5);
    expect(cal.femurLength).toBeCloseTo(0.5, 5);
    expect(cal.tibiaLength).toBeCloseTo(0.5, 5);
  });

  it('computes torso length', () => {
    const landmarks: Landmarks = {
      left_shoulder: makePoint(0.5, 0.2, 0.9),
      left_hip: makePoint(0.5, 0.5, 0.9),
      left_knee: makePoint(0.5, 0.75, 0.9),
      left_ankle: makePoint(0.5, 1.0, 0.9),
      right_shoulder: makePoint(0.5, 0.2, 0.5),
      right_hip: makePoint(0.5, 0.5, 0.5),
      right_knee: makePoint(0.5, 0.75, 0.5),
      right_ankle: makePoint(0.5, 1.0, 0.5),
    };

    const cal = calibrateFromStanding(landmarks);
    // raw torso = shoulder-to-hip = 0.3
    // totalLeg = 0.25 + 0.25 = 0.50
    // torsoLength = 0.3 / 0.50 = 0.6 (normalized by total leg length)
    expect(cal.torsoLength).toBeCloseTo(0.6, 5);
    // torsoFemurRatio = 0.3 / 0.25 = 1.2 (computed from raw values)
    expect(cal.torsoFemurRatio).toBeCloseTo(1.2, 5);
  });

  it('measures standingKneeWidth when both knees present', () => {
    const landmarks: Landmarks = {
      left_shoulder: makePoint(0.4, 0.2, 0.9),
      left_hip: makePoint(0.4, 0.5, 0.9),
      left_knee: makePoint(0.35, 0.75, 0.9),
      left_ankle: makePoint(0.4, 1.0, 0.9),
      right_shoulder: makePoint(0.6, 0.2, 0.8),
      right_hip: makePoint(0.6, 0.5, 0.8),
      right_knee: makePoint(0.65, 0.75, 0.8),
      right_ankle: makePoint(0.6, 1.0, 0.8),
    };

    const cal = calibrateFromStanding(landmarks);
    expect(cal.standingKneeWidth).toBeCloseTo(0.3, 5);
  });

  it('returns null standingKneeWidth when one knee is missing', () => {
    const landmarks: Landmarks = {
      left_shoulder: makePoint(0.5, 0.2, 0.9),
      left_hip: makePoint(0.5, 0.5, 0.9),
      left_knee: makePoint(0.5, 0.75, 0.9),
      left_ankle: makePoint(0.5, 1.0, 0.9),
      right_shoulder: makePoint(0.5, 0.2, 0.5),
      right_hip: makePoint(0.5, 0.5, 0.5),
      right_ankle: makePoint(0.5, 1.0, 0.5),
    };

    const cal = calibrateFromStanding(landmarks);
    expect(cal.standingKneeWidth).toBeNull();
  });

  it('records standing knee angle', () => {
    const landmarks: Landmarks = {
      left_shoulder: makePoint(0.5, 0.2, 0.9),
      left_hip: makePoint(0.5, 0.5, 0.9),
      left_knee: makePoint(0.5, 0.75, 0.9),
      left_ankle: makePoint(0.5, 1.0, 0.9),
      right_shoulder: makePoint(0.5, 0.2, 0.5),
      right_hip: makePoint(0.5, 0.5, 0.5),
      right_knee: makePoint(0.5, 0.75, 0.5),
      right_ankle: makePoint(0.5, 1.0, 0.5),
    };

    const cal = calibrateFromStanding(landmarks);
    // Vertically aligned = straight leg = 180 degrees
    expect(cal.standingKneeAngle).toBeCloseTo(180, 0);
  });
});

describe('getTrunkAngleRange', () => {
  it('returns base range for each squat type without calibration', () => {
    expect(getTrunkAngleRange('bodyweight', null)).toEqual([25, 45]);
    expect(getTrunkAngleRange('high_bar', null)).toEqual([30, 50]);
    expect(getTrunkAngleRange('low_bar', null)).toEqual([40, 60]);
    expect(getTrunkAngleRange('front', null)).toEqual([10, 25]);
    expect(getTrunkAngleRange('goblet', null)).toEqual([15, 30]);
    expect(getTrunkAngleRange('overhead', null)).toEqual([10, 25]);
  });

  it('adjusts range for long femurs (ratio > 1)', () => {
    const cal = makeCalibration({ femurTibiaRatio: 1.2 });
    // deviation = 0.2, adjustment = 0.2 * 55 = 11
    // bodyweight clamp: Math.max(-15, Math.min(20, 11)) = 11
    const [min, max] = getTrunkAngleRange('bodyweight', cal);
    expect(min).toBeCloseTo(36, 1);  // 25 + 11
    expect(max).toBeCloseTo(56, 1);  // 45 + 11
  });

  it('adjusts range for short femurs (ratio < 1)', () => {
    const cal = makeCalibration({ femurTibiaRatio: 0.8 });
    // deviation = -0.2, adjustment = -0.2 * 55 = -11
    // bodyweight clamp: Math.max(-15, Math.min(20, -11)) = -11
    const [min, max] = getTrunkAngleRange('bodyweight', cal);
    expect(min).toBeCloseTo(14, 1);  // 25 + (-11)
    expect(max).toBeCloseTo(34, 1);  // 45 + (-11)
  });

  it('clamps adjustment per squat type', () => {
    // Very long femurs: ratio=1.6, deviation=0.6, raw adjustment=33
    // bodyweight clamp: Math.max(-15, Math.min(20, 33)) = 20
    const longCal = makeCalibration({ femurTibiaRatio: 1.6 });
    const [min1, max1] = getTrunkAngleRange('bodyweight', longCal);
    expect(min1).toBeCloseTo(45, 1);  // 25 + 20
    expect(max1).toBeCloseTo(65, 1);  // 45 + 20

    // Very short femurs: ratio=0.4, deviation=-0.6, raw adjustment=-33
    // bodyweight clamp: Math.max(-15, Math.min(20, -33)) = -15
    const shortCal = makeCalibration({ femurTibiaRatio: 0.4 });
    const [min2, max2] = getTrunkAngleRange('bodyweight', shortCal);
    expect(min2).toBeCloseTo(10, 1);  // 25 + (-15)
    expect(max2).toBeCloseTo(30, 1);  // 45 + (-15)
  });

  it('returns base range for ratio=1.0 (no adjustment)', () => {
    const cal = makeCalibration({ femurTibiaRatio: 1.0 });
    expect(getTrunkAngleRange('bodyweight', cal)).toEqual([25, 45]);
  });
});

describe('detectCameraView', () => {
  it('detects side view when shoulders have small X difference', () => {
    const landmarks: Landmarks = {
      left_shoulder: makePoint(0.50, 0.3, 0.9),
      right_shoulder: makePoint(0.53, 0.3, 0.9),
    };
    expect(detectCameraView(landmarks)).toBe('side');
  });

  it('detects front view when shoulders are spread apart', () => {
    const landmarks: Landmarks = {
      left_shoulder: makePoint(0.35, 0.3, 0.9),
      right_shoulder: makePoint(0.65, 0.3, 0.9),
    };
    expect(detectCameraView(landmarks)).toBe('front');
  });

  it('returns unknown for intermediate shoulder spread', () => {
    const landmarks: Landmarks = {
      left_shoulder: makePoint(0.45, 0.3, 0.9),
      right_shoulder: makePoint(0.55, 0.3, 0.9),
    };
    // diff = 0.10, which is between 0.08 and 0.12
    expect(detectCameraView(landmarks)).toBe('unknown');
  });

  it('returns unknown when shoulder visibility is low', () => {
    const landmarks: Landmarks = {
      left_shoulder: makePoint(0.35, 0.3, 0.3),
      right_shoulder: makePoint(0.65, 0.3, 0.9),
    };
    expect(detectCameraView(landmarks)).toBe('unknown');
  });

  it('returns unknown when shoulders are missing', () => {
    const landmarks: Landmarks = {};
    expect(detectCameraView(landmarks)).toBe('unknown');
  });
});
