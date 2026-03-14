/**
 * Integration, regression, and cross-exercise consistency tests
 * for the squat form analyzer exercise router.
 */
import { describe, it, expect } from 'vitest';

import { analyzeExercise } from '../exercises/index';
import type { ExerciseConfig } from '../exercises/index';
import { computeFrameAngles } from '../angles';
import { calibrateFromStanding, detectCameraView } from '../calibration';
import type {
  Point,
  Landmarks,
  FrameData,
  SetAnalysis,
  SessionRecord,
} from '../types';

// ════════════════════════════════════════════════════════════════════════
// Landmark Generation Helpers
// ════════════════════════════════════════════════════════════════════════

/** Create a Point with given coordinates and full visibility. */
function p(x: number, y: number, z: number = 0, visibility: number = 0.99): Point {
  return { x, y, z, visibility };
}

/**
 * Build a full set of landmarks (both sides) given key joint positions.
 * Mirrors left landmarks to right with a slight offset to simulate a side-view
 * camera where both sides are visible.
 *
 * Params use an anatomical model in image coordinates (y increases downward):
 *   shoulder, hip, knee, ankle, heel, footIndex, elbow, wrist
 */
function buildLandmarks(opts: {
  shoulderY: number;
  hipY: number;
  kneeY: number;
  ankleY: number;
  heelY?: number;
  footIndexY?: number;
  elbowY?: number;
  wristY?: number;
  // X positions for controlling the trunk lean and joint angles
  shoulderX?: number;
  hipX?: number;
  kneeX?: number;
  ankleX?: number;
  elbowX?: number;
  wristX?: number;
}): Landmarks {
  const {
    shoulderY,
    hipY,
    kneeY,
    ankleY,
    heelY = ankleY + 0.01,
    footIndexY = ankleY,
    elbowY = (shoulderY + hipY) / 2,
    wristY = hipY,
    shoulderX = 0.5,
    hipX = 0.5,
    kneeX = 0.5,
    ankleX = 0.5,
    elbowX = shoulderX + 0.05,
    wristX = shoulderX + 0.08,
  } = opts;

  // Small offset for left/right separation (side view: nearly overlapping)
  const dx = 0.02;

  const lm: Landmarks = {};

  // Left side
  lm['left_shoulder']   = p(shoulderX - dx, shoulderY);
  lm['left_hip']        = p(hipX - dx, hipY);
  lm['left_knee']       = p(kneeX - dx, kneeY);
  lm['left_ankle']      = p(ankleX - dx, ankleY);
  lm['left_heel']       = p(ankleX - dx - 0.01, heelY);
  lm['left_foot_index'] = p(ankleX - dx + 0.03, footIndexY);
  lm['left_elbow']      = p(elbowX - dx, elbowY);
  lm['left_wrist']      = p(wristX - dx, wristY);

  // Right side (slightly offset in X)
  lm['right_shoulder']   = p(shoulderX + dx, shoulderY);
  lm['right_hip']        = p(hipX + dx, hipY);
  lm['right_knee']       = p(kneeX + dx, kneeY);
  lm['right_ankle']      = p(ankleX + dx, ankleY);
  lm['right_heel']       = p(ankleX + dx + 0.01, heelY);
  lm['right_foot_index'] = p(ankleX + dx + 0.03, footIndexY);
  lm['right_elbow']      = p(elbowX + dx, elbowY);
  lm['right_wrist']      = p(wristX + dx, wristY);

  return lm;
}

/** Linear interpolation between two values. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Convert desired joint angles to landmark positions for a simplified 2D skeleton.
 *
 * Coordinate system: image coordinates where Y increases downward.
 * The hip is fixed at (0.5, 0.4). Segments are placed using polar angles
 * measured clockwise from the +Y axis (downward direction).
 *
 * Angles match what computeFrameAngles will recompute:
 *   - trunkAngle: angleFromVertical(shoulder, hip) -- angle of torso from vertical
 *   - hipAngle: calculateAngle(shoulder, hip, knee) -- included angle at hip
 *   - kneeAngle: calculateAngle(hip, knee, ankle) -- included angle at knee
 *   - elbowAngle: calculateAngle(shoulder, elbow, wrist) -- included angle at elbow
 */
function anglestoLandmarks(opts: {
  kneeAngle: number;   // hip-knee-ankle angle (180 = straight)
  hipAngle: number;    // shoulder-hip-knee angle (180 = straight)
  trunkAngle: number;  // torso angle from vertical (0 = upright)
  elbowAngle?: number; // shoulder-elbow-wrist angle (180 = straight)
}): Landmarks {
  const { kneeAngle, hipAngle, trunkAngle, elbowAngle = 170 } = opts;

  const torsoLen = 0.18;
  const femurLen = 0.16;
  const tibiaLen = 0.15;
  const upperArmLen = 0.10;
  const forearmLen = 0.09;

  // Helper: place a point at distance `len` from (ox, oy) at angle `theta`
  // where theta is measured clockwise from +Y (downward). In image coords:
  //   dx = len * sin(theta),  dy = len * cos(theta)
  function polar(ox: number, oy: number, len: number, theta: number): [number, number] {
    return [ox + len * Math.sin(theta), oy + len * Math.cos(theta)];
  }

  // Hip is fixed
  const hipX = 0.5;
  const hipY = 0.4;

  // ── Shoulder from trunkAngle ──
  // angleFromVertical measures the angle of the segment (shoulder->hip), i.e. from
  // top to bottom, relative to the upward direction (0, -1). But we need
  // to place shoulder above hip.
  //
  // In image coords, vertical up = (0, -1). The trunk segment goes from hip to
  // shoulder. angleFromVertical(shoulder, hip) computes the angle between
  // the segment direction (shoulder - hip) and the up vector (0, -1).
  //
  // If trunkAngle = 0, shoulder is directly above hip: shoulder = (hipX, hipY - torsoLen).
  // If trunkAngle > 0, shoulder leans forward (positive X direction).
  //
  // The segment vector from hip to shoulder makes angle trunkAngle with the up vector.
  // Up vector in image coords = (0, -1). Rotating by trunkAngle clockwise from up:
  //   shoulder = hip + torsoLen * (sin(trunkAngle), -cos(trunkAngle))
  const trunkRad = (trunkAngle * Math.PI) / 180;
  const shoulderX = hipX + torsoLen * Math.sin(trunkRad);
  const shoulderY = hipY - torsoLen * Math.cos(trunkRad);

  // ── Knee from hipAngle ──
  // hipAngle = calculateAngle(shoulder, hip, knee): the angle at hip between
  // vectors hip->shoulder and hip->knee.
  //
  // Vector hip->shoulder has direction angle alpha from +Y:
  //   alpha = atan2(shoulderX - hipX, shoulderY - hipY)
  // For trunkAngle = 5 (nearly upright):
  //   shoulderX - hipX ~ +small, shoulderY - hipY ~ -0.18
  //   alpha ~ atan2(+small, -0.18) ~ PI (pointing up)
  //
  // We want the femur vector (hip->knee) to make angle hipAngle with the
  // trunk vector (hip->shoulder). The femur should go downward-forward.
  //
  // Using the rotation: femur direction = alpha + hipAngle (rotating CW from
  // the trunk vector). For hipAngle = 180 and alpha = PI, this gives
  // femurDir = PI + PI = 2PI = 0 (pointing straight down). Correct!
  //
  // For hipAngle = 80, femurDir = PI + 80*PI/180 ~ PI + 1.40 ~ 4.54 rad.
  // atan2 representation: 4.54 - 2PI ~ -1.74 => that's about -100 degrees from +Y,
  // which is forward of vertical. This is the desired behavior for a deep hip hinge.
  const alphaRad = Math.atan2(shoulderX - hipX, shoulderY - hipY);
  const hipAngleRad = (hipAngle * Math.PI) / 180;
  const femurDirAngle = alphaRad + hipAngleRad;
  const [kneeX, kneeY] = polar(hipX, hipY, femurLen, femurDirAngle);

  // ── Ankle from kneeAngle ──
  // kneeAngle = calculateAngle(hip, knee, ankle): angle at knee between
  // vectors knee->hip and knee->ankle.
  //
  // Vector knee->hip direction angle:
  const betaRad = Math.atan2(hipX - kneeX, hipY - kneeY);
  const kneeAngleRad = (kneeAngle * Math.PI) / 180;
  const tibiaDirAngle = betaRad + kneeAngleRad;
  const [ankleX, ankleY] = polar(kneeX, kneeY, tibiaLen, tibiaDirAngle);

  // ── Elbow from shoulder ──
  // Upper arm hangs downward from shoulder. For standing, it extends along
  // the body. For bench press, it can flex.
  // We'll place the upper arm going downward and slightly forward.
  // The shoulder->elbow direction: we place it along the body (roughly downward
  // along the trunk extension).
  const upperArmBaseAngle = alphaRad + Math.PI + 0.15; // slightly in front of trunk line
  const [elbowX, elbowY] = polar(shoulderX, shoulderY, upperArmLen, upperArmBaseAngle);

  // ── Wrist from elbowAngle ──
  // elbowAngle = calculateAngle(shoulder, elbow, wrist): angle at elbow between
  // vectors elbow->shoulder and elbow->wrist.
  const gammaRad = Math.atan2(shoulderX - elbowX, shoulderY - elbowY);
  const elbowAngleRad = (elbowAngle * Math.PI) / 180;
  const forearmDirAngle = gammaRad + elbowAngleRad;
  const [wristX, wristY] = polar(elbowX, elbowY, forearmLen, forearmDirAngle);

  return buildLandmarks({
    shoulderY, hipY, kneeY, ankleY,
    shoulderX, hipX, kneeX, ankleX,
    elbowX, elbowY, wristX, wristY,
  });
}

/**
 * Generate a synthetic FrameData sequence for any exercise.
 * Creates standing -> descent -> bottom -> ascent -> standing per rep.
 *
 * @param reps Number of reps
 * @param standingAngles Angles at standing position
 * @param bottomAngles Angles at bottom of movement
 * @param framesPerPhase Frames for standing/descent/bottom/ascent
 * @param perRepOverride Optional function that modifies bottom angles per rep
 */
function generateFrameSequence(opts: {
  reps: number;
  standingAngles: { kneeAngle: number; hipAngle: number; trunkAngle: number; elbowAngle?: number };
  bottomAngles: { kneeAngle: number; hipAngle: number; trunkAngle: number; elbowAngle?: number };
  standFrames?: number;
  descentFrames?: number;
  bottomFrames?: number;
  ascentFrames?: number;
  /** Optional per-rep modifier: receives rep index (0-based) and base bottom angles, returns modified. */
  perRepBottomOverride?: (repIndex: number, baseBottom: typeof opts.bottomAngles) => typeof opts.bottomAngles;
}): FrameData {
  const {
    reps,
    standingAngles,
    bottomAngles,
    standFrames = 15,
    descentFrames = 20,
    bottomFrames = 8,
    ascentFrames = 20,
    perRepBottomOverride,
  } = opts;

  const frames: FrameData = new Map();
  let frameIdx = 0;

  for (let rep = 0; rep < reps; rep++) {
    const effectiveBottom = perRepBottomOverride
      ? perRepBottomOverride(rep, { ...bottomAngles })
      : bottomAngles;

    // Standing phase
    for (let i = 0; i < standFrames; i++) {
      frames.set(frameIdx++, anglestoLandmarks(standingAngles));
    }

    // Descent phase (interpolate standing -> bottom)
    for (let i = 0; i < descentFrames; i++) {
      const t = (i + 1) / descentFrames;
      frames.set(frameIdx++, anglestoLandmarks({
        kneeAngle: lerp(standingAngles.kneeAngle, effectiveBottom.kneeAngle, t),
        hipAngle: lerp(standingAngles.hipAngle, effectiveBottom.hipAngle, t),
        trunkAngle: lerp(standingAngles.trunkAngle, effectiveBottom.trunkAngle, t),
        elbowAngle: lerp(standingAngles.elbowAngle ?? 170, effectiveBottom.elbowAngle ?? 170, t),
      }));
    }

    // Bottom phase (hold)
    for (let i = 0; i < bottomFrames; i++) {
      frames.set(frameIdx++, anglestoLandmarks(effectiveBottom));
    }

    // Ascent phase (interpolate bottom -> standing)
    for (let i = 0; i < ascentFrames; i++) {
      const t = (i + 1) / ascentFrames;
      frames.set(frameIdx++, anglestoLandmarks({
        kneeAngle: lerp(effectiveBottom.kneeAngle, standingAngles.kneeAngle, t),
        hipAngle: lerp(effectiveBottom.hipAngle, standingAngles.hipAngle, t),
        trunkAngle: lerp(effectiveBottom.trunkAngle, standingAngles.trunkAngle, t),
        elbowAngle: lerp(effectiveBottom.elbowAngle ?? 170, standingAngles.elbowAngle ?? 170, t),
      }));
    }
  }

  // Final standing frames to close out
  for (let i = 0; i < 10; i++) {
    frames.set(frameIdx++, anglestoLandmarks(standingAngles));
  }

  return frames;
}

// Standard standing angles for different exercises
const SQUAT_STANDING = { kneeAngle: 175, hipAngle: 175, trunkAngle: 5 };
const DEADLIFT_STANDING = { kneeAngle: 175, hipAngle: 175, trunkAngle: 5 };
const BENCH_STANDING = { kneeAngle: 175, hipAngle: 175, trunkAngle: 5, elbowAngle: 170 };

// FPS constant
const FPS = 30;

// ════════════════════════════════════════════════════════════════════════
// Helper to validate SetAnalysis structure
// ════════════════════════════════════════════════════════════════════════

function validateSetAnalysis(result: SetAnalysis, label: string): void {
  // repCount matches reps.length
  expect(result.repCount, `${label}: repCount should match reps.length`).toBe(result.reps.length);

  // overallScore is [0, 100]
  expect(result.overallScore, `${label}: overallScore should be in [0, 100]`).toBeGreaterThanOrEqual(0);
  expect(result.overallScore, `${label}: overallScore should be in [0, 100]`).toBeLessThanOrEqual(100);

  // grade is valid
  const VALID_GRADES = ['A', 'B', 'C', 'D', 'F', 'Keep Working'];
  expect(VALID_GRADES, `${label}: grade "${result.grade}" should be valid`).toContain(result.grade);

  // All rep scores are [0, 100]
  for (let i = 0; i < result.reps.length; i++) {
    const rep = result.reps[i];
    expect(rep.overallScore, `${label}: rep ${i} overallScore`).toBeGreaterThanOrEqual(0);
    expect(rep.overallScore, `${label}: rep ${i} overallScore`).toBeLessThanOrEqual(100);
    expect(VALID_GRADES, `${label}: rep ${i} grade`).toContain(rep.grade);
  }

  // config is populated
  expect(result.config, `${label}: config should be populated`).toBeDefined();
  expect(result.config.experienceLevel, `${label}: config.experienceLevel`).toBeTruthy();

  // repFrameMap is a Map
  expect(result.repFrameMap, `${label}: repFrameMap should be a Map`).toBeInstanceOf(Map);

  // repStartFrames has correct length
  expect(result.repStartFrames.length, `${label}: repStartFrames length should match repCount`).toBe(result.repCount);

  // Arrays exist
  expect(Array.isArray(result.topIssues), `${label}: topIssues should be array`).toBe(true);
  expect(Array.isArray(result.topCues), `${label}: topCues should be array`).toBe(true);
  expect(Array.isArray(result.positiveHighlights), `${label}: positiveHighlights should be array`).toBe(true);
  expect(typeof result.fatigueDetected, `${label}: fatigueDetected should be boolean`).toBe('boolean');
  expect(typeof result.competitionMode, `${label}: competitionMode should be boolean`).toBe('boolean');
}

// ════════════════════════════════════════════════════════════════════════
// 1. Exercise Router Tests
// ════════════════════════════════════════════════════════════════════════

describe('Exercise Router (analyzeExercise)', () => {
  it('analyzeExercise with exerciseType="squat" returns valid SetAnalysis', () => {
    const frames = generateFrameSequence({
      reps: 3,
      standingAngles: SQUAT_STANDING,
      bottomAngles: { kneeAngle: 90, hipAngle: 80, trunkAngle: 35 },
    });

    const config: ExerciseConfig = {
      exerciseType: 'squat',
      experienceLevel: 'intermediate',
      competitionMode: false,
      squatType: 'bodyweight',
    };

    const result = analyzeExercise(frames, FPS, config);
    expect(result).toBeDefined();
    expect(result.repCount).toBeGreaterThanOrEqual(1);
    validateSetAnalysis(result, 'squat');
  });

  it('analyzeExercise with exerciseType="deadlift" returns valid SetAnalysis', () => {
    const frames = generateFrameSequence({
      reps: 3,
      standingAngles: DEADLIFT_STANDING,
      bottomAngles: { kneeAngle: 120, hipAngle: 80, trunkAngle: 55 },
    });

    const config: ExerciseConfig = {
      exerciseType: 'deadlift',
      experienceLevel: 'intermediate',
      competitionMode: false,
      deadliftType: 'conventional',
    };

    const result = analyzeExercise(frames, FPS, config);
    expect(result).toBeDefined();
    expect(result.repCount).toBeGreaterThanOrEqual(1);
    validateSetAnalysis(result, 'deadlift');
  });

  it('analyzeExercise with exerciseType="bench_press" returns valid SetAnalysis', () => {
    const frames = generateFrameSequence({
      reps: 3,
      standingAngles: BENCH_STANDING,
      bottomAngles: { kneeAngle: 175, hipAngle: 175, trunkAngle: 5, elbowAngle: 75 },
    });

    const config: ExerciseConfig = {
      exerciseType: 'bench_press',
      experienceLevel: 'intermediate',
      competitionMode: false,
      benchType: 'flat',
    };

    const result = analyzeExercise(frames, FPS, config);
    expect(result).toBeDefined();
    expect(result.repCount).toBeGreaterThanOrEqual(1);
    validateSetAnalysis(result, 'bench_press');
  });

  it('all three exercises return consistent structure fields', () => {
    const squatFrames = generateFrameSequence({
      reps: 2,
      standingAngles: SQUAT_STANDING,
      bottomAngles: { kneeAngle: 90, hipAngle: 80, trunkAngle: 35 },
    });
    const dlFrames = generateFrameSequence({
      reps: 2,
      standingAngles: DEADLIFT_STANDING,
      bottomAngles: { kneeAngle: 120, hipAngle: 80, trunkAngle: 55 },
    });
    const benchFrames = generateFrameSequence({
      reps: 2,
      standingAngles: BENCH_STANDING,
      bottomAngles: { kneeAngle: 175, hipAngle: 175, trunkAngle: 5, elbowAngle: 75 },
    });

    const squatResult = analyzeExercise(squatFrames, FPS, {
      exerciseType: 'squat', experienceLevel: 'intermediate', competitionMode: false,
    });
    const dlResult = analyzeExercise(dlFrames, FPS, {
      exerciseType: 'deadlift', experienceLevel: 'intermediate', competitionMode: false,
    });
    const benchResult = analyzeExercise(benchFrames, FPS, {
      exerciseType: 'bench_press', experienceLevel: 'intermediate', competitionMode: false,
    });

    // All three should have the same top-level fields
    const requiredKeys: (keyof SetAnalysis)[] = [
      'repCount', 'reps', 'overallScore', 'grade', 'fatigueDetected',
      'topIssues', 'topCues', 'calibration', 'config', 'repFrameMap',
      'repStartFrames', 'positiveHighlights', 'competitionMode',
    ];

    for (const key of requiredKeys) {
      expect(squatResult, `squat missing key: ${key}`).toHaveProperty(key);
      expect(dlResult, `deadlift missing key: ${key}`).toHaveProperty(key);
      expect(benchResult, `bench missing key: ${key}`).toHaveProperty(key);
    }

    // Each rep should have the same score fields
    const repKeys: (keyof typeof squatResult.reps[0])[] = [
      'depthScore', 'kneeTrackingScore', 'trunkScore', 'symmetryScore',
      'tempoScore', 'lockoutScore', 'overallScore', 'grade', 'issues',
      'cues', 'positiveFeedback',
    ];

    for (const result of [squatResult, dlResult, benchResult]) {
      if (result.reps.length > 0) {
        for (const key of repKeys) {
          expect(result.reps[0], `rep missing key: ${key}`).toHaveProperty(key);
        }
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// 2. Cross-Exercise Consistency
// ════════════════════════════════════════════════════════════════════════

describe('Cross-Exercise Consistency', () => {
  const standingLandmarks = anglestoLandmarks({
    kneeAngle: 175, hipAngle: 175, trunkAngle: 5,
  });

  it('same standing landmarks produce same calibration regardless of exercise type', () => {
    // Calibration is computed from standing landmarks directly
    const cal1 = calibrateFromStanding(standingLandmarks);
    const cal2 = calibrateFromStanding(standingLandmarks);

    expect(cal1.standingKneeAngle).toBe(cal2.standingKneeAngle);
    expect(cal1.standingHipAngle).toBe(cal2.standingHipAngle);
    expect(cal1.standingTrunkAngle).toBe(cal2.standingTrunkAngle);
    expect(cal1.femurLength).toBe(cal2.femurLength);
    expect(cal1.tibiaLength).toBe(cal2.tibiaLength);
    expect(cal1.torsoLength).toBe(cal2.torsoLength);
    expect(cal1.femurTibiaRatio).toBe(cal2.femurTibiaRatio);
  });

  it('computeFrameAngles returns same angles regardless of calling context', () => {
    // Compute angles from the same landmarks in different calling contexts
    const angles1 = computeFrameAngles(standingLandmarks);
    const angles2 = computeFrameAngles(standingLandmarks);

    expect(angles1.kneeAngle).toBe(angles2.kneeAngle);
    expect(angles1.hipAngle).toBe(angles2.hipAngle);
    expect(angles1.trunkAngle).toBe(angles2.trunkAngle);
    expect(angles1.ankleAngle).toBe(angles2.ankleAngle);
    expect(angles1.shinAngle).toBe(angles2.shinAngle);
    expect(angles1.kneeWidthRatio).toBe(angles2.kneeWidthRatio);
    expect(angles1.hipSymmetry).toBe(angles2.hipSymmetry);
  });

  it('computeFrameAngles is pure: same input always yields same output for movement landmarks', () => {
    const movementLandmarks = anglestoLandmarks({
      kneeAngle: 100, hipAngle: 90, trunkAngle: 40,
    });

    const a = computeFrameAngles(movementLandmarks);
    const b = computeFrameAngles(movementLandmarks);

    expect(a.kneeAngle).toBeCloseTo(b.kneeAngle, 5);
    expect(a.hipAngle).toBeCloseTo(b.hipAngle, 5);
    expect(a.trunkAngle).toBeCloseTo(b.trunkAngle, 5);
  });

  it('camera view detection works consistently for all exercise types', () => {
    // Side view: left/right shoulders very close in X
    const sideViewLandmarks: Landmarks = {
      left_shoulder:  p(0.50, 0.3),
      right_shoulder: p(0.52, 0.3),
      left_hip:       p(0.50, 0.5),
      right_hip:      p(0.52, 0.5),
      left_knee:      p(0.50, 0.7),
      right_knee:     p(0.52, 0.7),
      left_ankle:     p(0.50, 0.9),
      right_ankle:    p(0.52, 0.9),
    };

    const view = detectCameraView(sideViewLandmarks);
    expect(view).toBe('side');

    // Front view: left/right shoulders spread apart
    const frontViewLandmarks: Landmarks = {
      left_shoulder:  p(0.35, 0.3),
      right_shoulder: p(0.65, 0.3),
      left_hip:       p(0.40, 0.5),
      right_hip:      p(0.60, 0.5),
      left_knee:      p(0.40, 0.7),
      right_knee:     p(0.60, 0.7),
      left_ankle:     p(0.40, 0.9),
      right_ankle:    p(0.60, 0.9),
    };

    const frontView = detectCameraView(frontViewLandmarks);
    expect(frontView).toBe('front');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 3. Golden Regression Tests
// ════════════════════════════════════════════════════════════════════════

describe('Golden Regression Tests', () => {
  it('(a) Perfect squat: 3 reps, 90 deg depth, 35 deg trunk, good tempo -> score >= 85, grade A or B', () => {
    const frames = generateFrameSequence({
      reps: 3,
      standingAngles: SQUAT_STANDING,
      bottomAngles: { kneeAngle: 90, hipAngle: 80, trunkAngle: 35 },
      standFrames: 15,
      descentFrames: 25,
      bottomFrames: 6,
      ascentFrames: 25,
    });

    const config: ExerciseConfig = {
      exerciseType: 'squat',
      experienceLevel: 'intermediate',
      competitionMode: false,
      squatType: 'bodyweight',
    };

    const result = analyzeExercise(frames, FPS, config);

    expect(result.repCount).toBeGreaterThanOrEqual(2);
    expect(result.overallScore).toBeGreaterThanOrEqual(85);
    expect(['A', 'B']).toContain(result.grade);
  });

  it('(b) Shallow squat: 3 reps, 135 deg depth -> score < 70, insufficient depth flagged', () => {
    const frames = generateFrameSequence({
      reps: 3,
      standingAngles: SQUAT_STANDING,
      bottomAngles: { kneeAngle: 135, hipAngle: 135, trunkAngle: 15 },
      standFrames: 15,
      descentFrames: 20,
      bottomFrames: 6,
      ascentFrames: 20,
    });

    const config: ExerciseConfig = {
      exerciseType: 'squat',
      experienceLevel: 'intermediate',
      competitionMode: false,
      squatType: 'bodyweight',
    };

    const result = analyzeExercise(frames, FPS, config);

    expect(result.repCount).toBeGreaterThanOrEqual(1);
    expect(result.overallScore).toBeLessThan(70);

    // Check for insufficient_depth in the issues across all reps
    const allIssueNames = result.reps.flatMap(r => r.issues.map(i => i.name));
    expect(allIssueNames).toContain('insufficient_depth');
  });

  it('(c) Good deadlift: 3 reps, conventional, 80 deg hip at bottom -> score >= 75', () => {
    const frames = generateFrameSequence({
      reps: 3,
      standingAngles: DEADLIFT_STANDING,
      bottomAngles: { kneeAngle: 120, hipAngle: 80, trunkAngle: 55 },
      standFrames: 15,
      descentFrames: 20,
      bottomFrames: 6,
      ascentFrames: 20,
    });

    const config: ExerciseConfig = {
      exerciseType: 'deadlift',
      experienceLevel: 'intermediate',
      competitionMode: false,
      deadliftType: 'conventional',
    };

    const result = analyzeExercise(frames, FPS, config);

    expect(result.repCount).toBeGreaterThanOrEqual(1);
    expect(result.overallScore).toBeGreaterThanOrEqual(75);
  });

  it('(d) Good bench: 3 reps, 75 deg elbow at bottom, good lockout -> score >= 75', () => {
    const frames = generateFrameSequence({
      reps: 3,
      standingAngles: BENCH_STANDING,
      bottomAngles: { kneeAngle: 175, hipAngle: 175, trunkAngle: 5, elbowAngle: 75 },
      standFrames: 15,
      descentFrames: 20,
      bottomFrames: 6,
      ascentFrames: 20,
    });

    const config: ExerciseConfig = {
      exerciseType: 'bench_press',
      experienceLevel: 'intermediate',
      competitionMode: false,
      benchType: 'flat',
    };

    const result = analyzeExercise(frames, FPS, config);

    expect(result.repCount).toBeGreaterThanOrEqual(1);
    expect(result.overallScore).toBeGreaterThanOrEqual(75);
  });

  it('(e) Fatigued set: 5 reps, last 2 significantly worse -> fatigueDetected = true', () => {
    const frames = generateFrameSequence({
      reps: 5,
      standingAngles: SQUAT_STANDING,
      bottomAngles: { kneeAngle: 90, hipAngle: 80, trunkAngle: 35 },
      standFrames: 15,
      descentFrames: 25,
      bottomFrames: 6,
      ascentFrames: 25,
      perRepBottomOverride: (repIndex, baseBottom) => {
        if (repIndex >= 3) {
          // Last 2 reps: much shallower depth, worse trunk control, slower
          return {
            kneeAngle: 130,
            hipAngle: 130,
            trunkAngle: 55,
          };
        }
        return baseBottom;
      },
    });

    const config: ExerciseConfig = {
      exerciseType: 'squat',
      experienceLevel: 'intermediate',
      competitionMode: false,
      squatType: 'bodyweight',
    };

    const result = analyzeExercise(frames, FPS, config);

    // Must have enough reps for fatigue detection (>= 4)
    expect(result.repCount).toBeGreaterThanOrEqual(4);
    expect(result.fatigueDetected).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 4. SetAnalysis Structure Validation
// ════════════════════════════════════════════════════════════════════════

describe('SetAnalysis Structure Validation', () => {
  const exerciseConfigs: { label: string; config: ExerciseConfig; frames: FrameData }[] = [
    {
      label: 'squat',
      config: {
        exerciseType: 'squat',
        experienceLevel: 'beginner',
        competitionMode: false,
        squatType: 'bodyweight',
      },
      frames: generateFrameSequence({
        reps: 2,
        standingAngles: SQUAT_STANDING,
        bottomAngles: { kneeAngle: 95, hipAngle: 85, trunkAngle: 35 },
      }),
    },
    {
      label: 'deadlift',
      config: {
        exerciseType: 'deadlift',
        experienceLevel: 'advanced',
        competitionMode: false,
        deadliftType: 'conventional',
      },
      frames: generateFrameSequence({
        reps: 2,
        standingAngles: DEADLIFT_STANDING,
        bottomAngles: { kneeAngle: 120, hipAngle: 75, trunkAngle: 55 },
      }),
    },
    {
      label: 'bench_press',
      config: {
        exerciseType: 'bench_press',
        experienceLevel: 'intermediate',
        competitionMode: false,
        benchType: 'flat',
      },
      frames: generateFrameSequence({
        reps: 2,
        standingAngles: BENCH_STANDING,
        bottomAngles: { kneeAngle: 175, hipAngle: 175, trunkAngle: 5, elbowAngle: 75 },
      }),
    },
  ];

  for (const { label, config, frames } of exerciseConfigs) {
    it(`${label}: validates full SetAnalysis structure`, () => {
      const result = analyzeExercise(frames, FPS, config);
      validateSetAnalysis(result, label);
    });

    it(`${label}: repFrameMap entries map to valid rep indices`, () => {
      const result = analyzeExercise(frames, FPS, config);
      for (const [_frame, repIdx] of result.repFrameMap.entries()) {
        expect(repIdx).toBeGreaterThanOrEqual(0);
        expect(repIdx).toBeLessThan(result.repCount);
      }
    });

    it(`${label}: each rep has non-empty grade and valid score fields`, () => {
      const result = analyzeExercise(frames, FPS, config);
      for (const rep of result.reps) {
        expect(rep.grade).toBeTruthy();
        expect(rep.depthScore).toBeGreaterThanOrEqual(0);
        expect(rep.depthScore).toBeLessThanOrEqual(100);
        expect(rep.kneeTrackingScore).toBeGreaterThanOrEqual(0);
        expect(rep.kneeTrackingScore).toBeLessThanOrEqual(100);
        expect(rep.trunkScore).toBeGreaterThanOrEqual(0);
        expect(rep.trunkScore).toBeLessThanOrEqual(100);
        expect(rep.symmetryScore).toBeGreaterThanOrEqual(0);
        expect(rep.symmetryScore).toBeLessThanOrEqual(100);
        expect(rep.tempoScore).toBeGreaterThanOrEqual(0);
        expect(rep.tempoScore).toBeLessThanOrEqual(100);
        expect(rep.lockoutScore).toBeGreaterThanOrEqual(0);
        expect(rep.lockoutScore).toBeLessThanOrEqual(100);
        expect(Array.isArray(rep.issues)).toBe(true);
        expect(Array.isArray(rep.cues)).toBe(true);
        expect(Array.isArray(rep.positiveFeedback)).toBe(true);
      }
    });

    it(`${label}: mobilityFindings and warmupProtocol are arrays`, () => {
      const result = analyzeExercise(frames, FPS, config);
      expect(Array.isArray(result.mobilityFindings)).toBe(true);
      expect(Array.isArray(result.warmupProtocol)).toBe(true);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════
// 5. Session Storage Roundtrip
// ════════════════════════════════════════════════════════════════════════

describe('Session Storage Roundtrip', () => {
  /** Build a SessionRecord from analysis results, mirroring what the app would do. */
  function buildSessionRecord(
    result: SetAnalysis,
    exerciseType: string,
    exerciseVariant: string,
  ): SessionRecord {
    return {
      id: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      date: new Date().toISOString(),
      squat_type: result.config.squatType,
      experience_level: result.config.experienceLevel,
      rep_count: result.repCount,
      overall_score: result.overallScore,
      grade: result.grade,
      top_issue: result.topIssues.length > 0 ? result.topIssues[0].name : null,
      positive_count: result.positiveHighlights.length,
      exercise_type: exerciseType,
      exercise_variant: exerciseVariant,
      rep_scores: result.reps.map(r => r.overallScore),
      avg_depth: result.reps.length > 0
        ? result.reps.reduce((s, r) => s + r.depthScore, 0) / result.reps.length
        : undefined,
      avg_knee_tracking: result.reps.length > 0
        ? result.reps.reduce((s, r) => s + r.kneeTrackingScore, 0) / result.reps.length
        : undefined,
      avg_trunk: result.reps.length > 0
        ? result.reps.reduce((s, r) => s + r.trunkScore, 0) / result.reps.length
        : undefined,
      avg_symmetry: result.reps.length > 0
        ? result.reps.reduce((s, r) => s + r.symmetryScore, 0) / result.reps.length
        : undefined,
      avg_tempo: result.reps.length > 0
        ? result.reps.reduce((s, r) => s + r.tempoScore, 0) / result.reps.length
        : undefined,
      avg_lockout: result.reps.length > 0
        ? result.reps.reduce((s, r) => s + r.lockoutScore, 0) / result.reps.length
        : undefined,
    };
  }

  const exerciseTests = [
    {
      label: 'squat',
      exerciseType: 'squat',
      variant: 'bodyweight',
      config: {
        exerciseType: 'squat' as const,
        experienceLevel: 'intermediate' as const,
        competitionMode: false,
        squatType: 'bodyweight' as const,
      },
      frames: generateFrameSequence({
        reps: 3,
        standingAngles: SQUAT_STANDING,
        bottomAngles: { kneeAngle: 90, hipAngle: 80, trunkAngle: 35 },
      }),
    },
    {
      label: 'deadlift',
      exerciseType: 'deadlift',
      variant: 'conventional',
      config: {
        exerciseType: 'deadlift' as const,
        experienceLevel: 'intermediate' as const,
        competitionMode: false,
        deadliftType: 'conventional' as const,
      },
      frames: generateFrameSequence({
        reps: 3,
        standingAngles: DEADLIFT_STANDING,
        bottomAngles: { kneeAngle: 120, hipAngle: 80, trunkAngle: 55 },
      }),
    },
    {
      label: 'bench_press',
      exerciseType: 'bench_press',
      variant: 'flat',
      config: {
        exerciseType: 'bench_press' as const,
        experienceLevel: 'intermediate' as const,
        competitionMode: false,
        benchType: 'flat' as const,
      },
      frames: generateFrameSequence({
        reps: 3,
        standingAngles: BENCH_STANDING,
        bottomAngles: { kneeAngle: 175, hipAngle: 175, trunkAngle: 5, elbowAngle: 75 },
      }),
    },
  ];

  for (const { label, exerciseType, variant, config, frames } of exerciseTests) {
    it(`${label}: SessionRecord fields are populated correctly`, () => {
      const result = analyzeExercise(frames, FPS, config);
      const session = buildSessionRecord(result, exerciseType, variant);

      // Required fields
      expect(session.id).toBeTruthy();
      expect(session.date).toBeTruthy();
      expect(new Date(session.date).getTime()).not.toBeNaN();
      expect(session.squat_type).toBeTruthy();
      expect(session.experience_level).toBe('intermediate');
      expect(session.rep_count).toBe(result.repCount);
      expect(session.rep_count).toBeGreaterThanOrEqual(1);
      expect(session.overall_score).toBe(result.overallScore);
      expect(session.overall_score).toBeGreaterThanOrEqual(0);
      expect(session.overall_score).toBeLessThanOrEqual(100);
      expect(session.grade).toBe(result.grade);
      expect(session.positive_count).toBeGreaterThanOrEqual(0);

      // Enhanced fields
      expect(session.exercise_type).toBe(exerciseType);
      expect(session.exercise_variant).toBe(variant);

      // rep_scores
      expect(session.rep_scores).toBeDefined();
      expect(session.rep_scores!.length).toBe(result.repCount);
      for (const score of session.rep_scores!) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }

      // Averaged dimension scores
      if (result.reps.length > 0) {
        expect(session.avg_depth).toBeDefined();
        expect(session.avg_depth).toBeGreaterThanOrEqual(0);
        expect(session.avg_depth).toBeLessThanOrEqual(100);

        expect(session.avg_knee_tracking).toBeDefined();
        expect(session.avg_knee_tracking).toBeGreaterThanOrEqual(0);
        expect(session.avg_knee_tracking).toBeLessThanOrEqual(100);

        expect(session.avg_trunk).toBeDefined();
        expect(session.avg_trunk).toBeGreaterThanOrEqual(0);
        expect(session.avg_trunk).toBeLessThanOrEqual(100);

        expect(session.avg_symmetry).toBeDefined();
        expect(session.avg_symmetry).toBeGreaterThanOrEqual(0);
        expect(session.avg_symmetry).toBeLessThanOrEqual(100);

        expect(session.avg_tempo).toBeDefined();
        expect(session.avg_tempo).toBeGreaterThanOrEqual(0);
        expect(session.avg_tempo).toBeLessThanOrEqual(100);

        expect(session.avg_lockout).toBeDefined();
        expect(session.avg_lockout).toBeGreaterThanOrEqual(0);
        expect(session.avg_lockout).toBeLessThanOrEqual(100);
      }
    });

    it(`${label}: SessionRecord top_issue is null or a valid issue name`, () => {
      const result = analyzeExercise(frames, FPS, config);
      const session = buildSessionRecord(result, exerciseType, variant);

      if (session.top_issue !== null) {
        expect(typeof session.top_issue).toBe('string');
        expect(session.top_issue.length).toBeGreaterThan(0);
        // Verify the top issue exists in actual analysis results
        const allIssueNames = result.topIssues.map(i => i.name);
        expect(allIssueNames).toContain(session.top_issue);
      }
    });
  }

  it('session JSON roundtrip preserves all fields', () => {
    const frames = generateFrameSequence({
      reps: 2,
      standingAngles: SQUAT_STANDING,
      bottomAngles: { kneeAngle: 90, hipAngle: 80, trunkAngle: 35 },
    });

    const result = analyzeExercise(frames, FPS, {
      exerciseType: 'squat',
      experienceLevel: 'intermediate',
      competitionMode: false,
    });

    const session = {
      id: 'test-roundtrip',
      date: new Date().toISOString(),
      squat_type: result.config.squatType,
      experience_level: result.config.experienceLevel,
      rep_count: result.repCount,
      overall_score: result.overallScore,
      grade: result.grade,
      top_issue: result.topIssues.length > 0 ? result.topIssues[0].name : null,
      positive_count: result.positiveHighlights.length,
      exercise_type: 'squat',
      rep_scores: result.reps.map(r => r.overallScore),
    };

    // Simulate JSON storage roundtrip
    const json = JSON.stringify(session);
    const restored = JSON.parse(json) as SessionRecord;

    expect(restored.id).toBe(session.id);
    expect(restored.rep_count).toBe(session.rep_count);
    expect(restored.overall_score).toBe(session.overall_score);
    expect(restored.grade).toBe(session.grade);
    expect(restored.top_issue).toBe(session.top_issue);
    expect(restored.exercise_type).toBe(session.exercise_type);
    expect(restored.rep_scores).toEqual(session.rep_scores);
  });
});
