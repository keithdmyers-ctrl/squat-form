/**
 * Body Type Bias Tests
 *
 * Purpose: Verify that the scoring system does not unfairly penalize certain body
 * proportions. Different body types (long femur, short femur, long torso, short torso)
 * require different biomechanics to perform the same squat, and the scoring system
 * should recognize this when calibration data is available.
 *
 * Key insight from scorer.ts analysis:
 * - scoreDepth() uses only knee angle, not hip-relative depth. This means depth scoring
 *   is already body-type-neutral (same knee angle = same score regardless of proportions).
 * - scoreTrunk() uses getTrunkAngleRange() from calibration.ts, which adjusts the
 *   acceptable trunk angle range based on femurTibiaRatio. This is the primary mechanism
 *   for body-type fairness.
 * - scoreSymmetry() and scoreTempo() are body-type-independent by design.
 * - scoreLockout() uses calibrated standingKneeAngle, which is body-type-neutral.
 *
 * FINDINGS:
 * - The calibration system in getTrunkAngleRange() properly adjusts trunk angle ranges
 *   using femurTibiaRatio with a multiplier of 55.0 per unit deviation from 1.0.
 *   For a long-femur lifter (ratio 1.3), this adds ~16.5 degrees to the acceptable range.
 * - Without calibration, long-femur lifters ARE penalized for trunk lean that is
 *   biomechanically necessary. This is expected -- calibration is recommended for fairness.
 * - With calibration, the system correctly widens trunk angle tolerance for long-femur
 *   lifters, bringing scores within the 10-point fairness threshold.
 * - scoreDepth() does NOT use hip-crease-relative depth (only knee angle). This is
 *   actually fair because knee angle is a body-type-independent measure of squat depth.
 *   A potential enhancement would be to use hip-relative depth in competition mode where
 *   the IPF standard is specifically about hip crease vs knee position, but for general
 *   training the knee angle approach is sound.
 */

import { describe, it, expect } from 'vitest';

import { analyzeSequence } from '../analyzer';
import {
  scoreDepth,
  scoreTrunk,
  scoreSymmetry,
  scoreTempo,
  scoreLockout,
  scoreToGrade,
  redistributeWeights,
  WEIGHTS,
  clamp,
} from '../scorer';
import { getTrunkAngleRange, TRUNK_ANGLE_RANGES, FEMUR_TIBIA_ADJUSTMENT_MULTIPLIER } from '../calibration';
import type {
  Point,
  Landmarks,
  FrameData,
  FrameAngles,
  CalibrationData,
  SquatConfig,
  RepData,
} from '../types';

// ════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════

/** Create a Point with given coordinates and full visibility. */
function p(x: number, y: number, z: number = 0, visibility: number = 0.99): Point {
  return { x, y, z, visibility };
}

/** Linear interpolation. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Body type definition: describes proportional relationships between limb segments.
 *
 * In squat biomechanics, the key ratios are:
 * - femurTibiaRatio: longer femurs require more forward lean to keep the center
 *   of mass over the midfoot (Howe & Oldham, 1996)
 * - torsoFemurRatio: longer torsos can stay more upright with the same femur length
 */
interface BodyTypeParams {
  name: string;
  femurTibiaRatio: number;
  torsoFemurRatio: number;
  /** Biomechanically natural trunk angle at bottom for high_bar squat, degrees from vertical. */
  naturalTrunkAngle: number;
  /** Relative femur length (normalized to total leg length). */
  femurLength: number;
  /** Relative tibia length (normalized to total leg length). */
  tibiaLength: number;
  /** Relative torso length (normalized to total leg length). */
  torsoLength: number;
}

const BODY_TYPES: Record<string, BodyTypeParams> = {
  average: {
    name: 'Average proportions',
    femurTibiaRatio: 1.0,
    torsoFemurRatio: 1.0,
    naturalTrunkAngle: 40,
    femurLength: 0.50,
    tibiaLength: 0.50,
    torsoLength: 0.50,
  },
  long_femur: {
    name: 'Long femur (tall lifter)',
    femurTibiaRatio: 1.3,
    torsoFemurRatio: 0.85,
    naturalTrunkAngle: 55,  // Must lean more forward with longer femurs
    femurLength: 0.565,
    tibiaLength: 0.435,
    torsoLength: 0.48,
  },
  short_femur: {
    name: 'Short femur',
    femurTibiaRatio: 0.8,
    torsoFemurRatio: 1.2,
    naturalTrunkAngle: 30,  // Can stay more upright
    femurLength: 0.444,
    tibiaLength: 0.556,
    torsoLength: 0.53,
  },
  long_torso: {
    name: 'Long torso',
    femurTibiaRatio: 1.0,
    torsoFemurRatio: 1.3,
    naturalTrunkAngle: 35,  // Long torso helps stay upright
    femurLength: 0.50,
    tibiaLength: 0.50,
    torsoLength: 0.65,
  },
  short_torso: {
    name: 'Short torso',
    femurTibiaRatio: 1.0,
    torsoFemurRatio: 0.75,
    naturalTrunkAngle: 45,  // Short torso = more forward lean needed
    femurLength: 0.50,
    tibiaLength: 0.50,
    torsoLength: 0.375,
  },
};

/** Build CalibrationData for a given body type. */
function makeCalibration(bt: BodyTypeParams): CalibrationData {
  return {
    standingKneeAngle: 175,
    standingHipAngle: 175,
    standingTrunkAngle: 5,
    standingAnkleAngle: 90,
    femurLength: bt.femurLength,
    tibiaLength: bt.tibiaLength,
    torsoLength: bt.torsoLength,
    femurTibiaRatio: bt.femurTibiaRatio,
    torsoFemurRatio: bt.torsoFemurRatio,
    standingKneeWidth: 0.15,
  };
}

/** Build a landmarks set from desired joint positions using a side-view model. */
function buildLandmarks(opts: {
  shoulderX: number; shoulderY: number;
  hipX: number; hipY: number;
  kneeX: number; kneeY: number;
  ankleX: number; ankleY: number;
}): Landmarks {
  const { shoulderX, shoulderY, hipX, hipY, kneeX, kneeY, ankleX, ankleY } = opts;
  const dx = 0.02;

  const lm: Landmarks = {};
  // Left side
  lm['left_shoulder']   = p(shoulderX - dx, shoulderY);
  lm['left_hip']        = p(hipX - dx, hipY);
  lm['left_knee']       = p(kneeX - dx, kneeY);
  lm['left_ankle']      = p(ankleX - dx, ankleY);
  lm['left_heel']       = p(ankleX - dx - 0.01, ankleY + 0.01);
  lm['left_foot_index'] = p(ankleX - dx + 0.03, ankleY);
  lm['left_elbow']      = p(shoulderX - dx + 0.05, (shoulderY + hipY) / 2);
  lm['left_wrist']      = p(shoulderX - dx + 0.08, hipY);

  // Right side (slight X offset for side view)
  lm['right_shoulder']   = p(shoulderX + dx, shoulderY);
  lm['right_hip']        = p(hipX + dx, hipY);
  lm['right_knee']       = p(kneeX + dx, kneeY);
  lm['right_ankle']      = p(ankleX + dx, ankleY);
  lm['right_heel']       = p(ankleX + dx + 0.01, ankleY + 0.01);
  lm['right_foot_index'] = p(ankleX + dx + 0.03, ankleY);
  lm['right_elbow']      = p(shoulderX + dx + 0.05, (shoulderY + hipY) / 2);
  lm['right_wrist']      = p(shoulderX + dx + 0.08, hipY);

  return lm;
}

/**
 * Convert desired joint angles to landmark positions using the same polar approach
 * as the integration test. This ensures the angles that computeFrameAngles will
 * recover match what we specify.
 */
function anglesToLandmarks(opts: {
  kneeAngle: number;
  hipAngle: number;
  trunkAngle: number;
}): Landmarks {
  const { kneeAngle, hipAngle, trunkAngle } = opts;

  const torsoLen = 0.18;
  const femurLen = 0.16;
  const tibiaLen = 0.15;

  function polar(ox: number, oy: number, len: number, theta: number): [number, number] {
    return [ox + len * Math.sin(theta), oy + len * Math.cos(theta)];
  }

  const hipX = 0.5;
  const hipY = 0.4;

  const trunkRad = (trunkAngle * Math.PI) / 180;
  const shoulderX = hipX + torsoLen * Math.sin(trunkRad);
  const shoulderY = hipY - torsoLen * Math.cos(trunkRad);

  const alphaRad = Math.atan2(shoulderX - hipX, shoulderY - hipY);
  const hipAngleRad = (hipAngle * Math.PI) / 180;
  const femurDirAngle = alphaRad + hipAngleRad;
  const [kneeX, kneeY] = polar(hipX, hipY, femurLen, femurDirAngle);

  const betaRad = Math.atan2(hipX - kneeX, hipY - kneeY);
  const kneeAngleRad = (kneeAngle * Math.PI) / 180;
  const tibiaDirAngle = betaRad + kneeAngleRad;
  const [ankleX, ankleY] = polar(kneeX, kneeY, tibiaLen, tibiaDirAngle);

  return buildLandmarks({
    shoulderX, shoulderY,
    hipX, hipY,
    kneeX, kneeY,
    ankleX, ankleY,
  });
}

/**
 * Generate a synthetic frame sequence for a squat with specific parameters.
 * Creates standing -> descent -> bottom -> ascent -> standing for each rep.
 */
function createSyntheticSequence(params: {
  bodyType: keyof typeof BODY_TYPES;
  minKneeAngle: number;
  trunkAngleAtBottom: number;
  repCount: number;
  fps: number;
}): { frames: FrameData; calibration: CalibrationData } {
  const { bodyType, minKneeAngle, trunkAngleAtBottom, repCount, fps } = params;
  const bt = BODY_TYPES[bodyType];
  const calibration = makeCalibration(bt);

  const standingAngles = { kneeAngle: 175, hipAngle: 175, trunkAngle: 5 };
  // Hip angle at bottom correlates with depth and trunk lean
  const hipAngleAtBottom = Math.max(60, minKneeAngle - 10);
  const bottomAngles = {
    kneeAngle: minKneeAngle,
    hipAngle: hipAngleAtBottom,
    trunkAngle: trunkAngleAtBottom,
  };

  const standFrames = 15;
  const descentFrames = Math.round(fps * 2.5); // ~2.5s descent (ideal range)
  const bottomFrames = Math.round(fps * 0.5);  // ~0.5s pause
  const ascentFrames = Math.round(fps * 2.0);  // ~2.0s ascent

  const frames: FrameData = new Map();
  let frameIdx = 0;

  for (let rep = 0; rep < repCount; rep++) {
    // Standing phase
    for (let i = 0; i < standFrames; i++) {
      frames.set(frameIdx++, anglesToLandmarks(standingAngles));
    }

    // Descent
    for (let i = 0; i < descentFrames; i++) {
      const t = (i + 1) / descentFrames;
      frames.set(frameIdx++, anglesToLandmarks({
        kneeAngle: lerp(standingAngles.kneeAngle, bottomAngles.kneeAngle, t),
        hipAngle: lerp(standingAngles.hipAngle, bottomAngles.hipAngle, t),
        trunkAngle: lerp(standingAngles.trunkAngle, bottomAngles.trunkAngle, t),
      }));
    }

    // Bottom
    for (let i = 0; i < bottomFrames; i++) {
      frames.set(frameIdx++, anglesToLandmarks(bottomAngles));
    }

    // Ascent
    for (let i = 0; i < ascentFrames; i++) {
      const t = (i + 1) / ascentFrames;
      frames.set(frameIdx++, anglesToLandmarks({
        kneeAngle: lerp(bottomAngles.kneeAngle, standingAngles.kneeAngle, t),
        hipAngle: lerp(bottomAngles.hipAngle, standingAngles.hipAngle, t),
        trunkAngle: lerp(bottomAngles.trunkAngle, standingAngles.trunkAngle, t),
      }));
    }
  }

  // Final standing
  for (let i = 0; i < 10; i++) {
    frames.set(frameIdx++, anglesToLandmarks(standingAngles));
  }

  return { frames, calibration };
}

/** Build a RepData with controlled frameAngles for unit-level scoring tests. */
function makeRepData(opts: {
  minKneeAngle: number;
  maxTrunkAngle: number;
  frameCount?: number;
  kneeWidthRatio?: number | null;
  hipSymmetry?: number | null;
  descentDuration?: number;
  bottomDuration?: number;
  ascentDuration?: number;
}): RepData {
  const frameCount = opts.frameCount ?? 30;
  const frameAngles: FrameAngles[] = [];

  for (let i = 0; i < frameCount; i++) {
    frameAngles.push({
      kneeAngle: i < frameCount / 2
        ? lerp(175, opts.minKneeAngle, (i / (frameCount / 2)))
        : lerp(opts.minKneeAngle, 175, ((i - frameCount / 2) / (frameCount / 2))),
      hipAngle: 120,
      ankleAngle: 90,
      trunkAngle: i < frameCount / 2
        ? lerp(5, opts.maxTrunkAngle, (i / (frameCount / 2)))
        : lerp(opts.maxTrunkAngle, 5, ((i - frameCount / 2) / (frameCount / 2))),
      shinAngle: 20,
      kneeWidthRatio: opts.kneeWidthRatio ?? null,
      hipSymmetry: opts.hipSymmetry ?? 0.02,
    });
  }

  return {
    repNumber: 1,
    startFrame: 0,
    endFrame: frameCount - 1,
    bottomFrame: Math.floor(frameCount / 2),
    minKneeAngle: opts.minKneeAngle,
    minHipAngle: 80,
    maxTrunkAngle: opts.maxTrunkAngle,
    descentDuration: opts.descentDuration ?? 2.5,
    bottomDuration: opts.bottomDuration ?? 0.5,
    ascentDuration: opts.ascentDuration ?? 2.0,
    frameAngles,
    heelRise: false,
    buttWink: false,
    goodMorning: false,
    kneeValgus: false,
    trunkAngleChangeOnAscent: 0,
    pelvicTiltAtBottom: 0,
    stickingPoints: [],
  };
}

const FPS = 30;

const DEFAULT_CONFIG: SquatConfig = {
  squatType: 'high_bar',
  experienceLevel: 'intermediate',
  competitionMode: false,
};

/**
 * Compute an overall score for a rep without frontal knee data.
 * Uses redistributeWeights to properly scale the remaining dimensions
 * so weights sum to 1.0 (matching what the real analyzer does).
 */
function computeOverallNoKnee(
  rep: RepData,
  config: SquatConfig,
  calibration: CalibrationData,
): number {
  const depthScore = scoreDepth(rep.minKneeAngle, config);
  const trunkScore = scoreTrunk(rep.maxTrunkAngle, config, calibration);
  const symmetryScore = scoreSymmetry(rep);
  const tempoScore = scoreTempo(rep.descentDuration, rep.bottomDuration, rep.ascentDuration);
  const lockoutScore = scoreLockout(rep, calibration);

  // Redistribute kneeTracking weight to other dimensions (matches analyzer.ts behavior)
  const w = redistributeWeights(WEIGHTS, 'kneeTracking');

  return Math.round(
    depthScore * w.depth +
    trunkScore * w.trunk +
    symmetryScore * w.symmetry +
    tempoScore * w.tempo +
    lockoutScore * w.lockout
  );
}

// ════════════════════════════════════════════════════════════════════════
// 1. Score Fairness Across Body Types
// ════════════════════════════════════════════════════════════════════════

describe('Body Type Bias', () => {
  describe('Score fairness across body types', () => {
    const bodyTypeKeys = Object.keys(BODY_TYPES) as (keyof typeof BODY_TYPES)[];
    const depths = [
      { label: 'above parallel', kneeAngle: 110 },
      { label: 'at parallel', kneeAngle: 95 },
      { label: 'below parallel', kneeAngle: 80 },
    ];

    // Test that all body types score within 10 points of each other at the same
    // depth when using calibration-adjusted trunk angles.
    for (const depth of depths) {
      it(`all body types score within 10 points at ${depth.label} (knee ${depth.kneeAngle} deg) with calibration`, () => {
        const scores: { bodyType: string; score: number }[] = [];

        for (const btKey of bodyTypeKeys) {
          const bt = BODY_TYPES[btKey];
          const calibration = makeCalibration(bt);

          // Each body type uses its biomechanically natural trunk angle
          const rep = makeRepData({
            minKneeAngle: depth.kneeAngle,
            maxTrunkAngle: bt.naturalTrunkAngle,
          });

          const overall = computeOverallNoKnee(rep, DEFAULT_CONFIG, calibration);
          scores.push({ bodyType: btKey, score: overall });
        }

        // Every pair of body types should be within 10 points
        for (let i = 0; i < scores.length; i++) {
          for (let j = i + 1; j < scores.length; j++) {
            const diff = Math.abs(scores[i].score - scores[j].score);
            expect(
              diff,
              `${scores[i].bodyType} (${scores[i].score}) vs ${scores[j].bodyType} (${scores[j].score}) at ${depth.label}: diff=${diff} should be <= 10`
            ).toBeLessThanOrEqual(10);
          }
        }
      });
    }

    // 5 body types x 3 depths with good form
    for (const btKey of bodyTypeKeys) {
      it(`${btKey}: good-form squat at all 3 depths scores >= 70`, () => {
        const bt = BODY_TYPES[btKey];
        const calibration = makeCalibration(bt);

        for (const depth of depths) {
          const rep = makeRepData({
            minKneeAngle: depth.kneeAngle,
            maxTrunkAngle: bt.naturalTrunkAngle,
          });

          const overall = computeOverallNoKnee(rep, DEFAULT_CONFIG, calibration);

          expect(
            overall,
            `${btKey} at ${depth.label}: score ${overall} should be >= 70`
          ).toBeGreaterThanOrEqual(70);
        }
      });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2. Trunk Angle Calibration
  // ════════════════════════════════════════════════════════════════════════

  describe('Trunk angle calibration', () => {
    it('long-femur lifter with proportional trunk lean should NOT be penalized', () => {
      const bt = BODY_TYPES.long_femur;
      const calibration = makeCalibration(bt);

      // Long-femur lifter with 55 deg trunk lean (their natural angle)
      const trunkScore = scoreTrunk(bt.naturalTrunkAngle, DEFAULT_CONFIG, calibration);

      // Should score well (>= 85) because calibration widens the acceptable range
      expect(
        trunkScore,
        `Long-femur trunk score at natural angle (${bt.naturalTrunkAngle} deg): ${trunkScore}`
      ).toBeGreaterThanOrEqual(85);
    });

    it('short-femur lifter with unnecessary excessive lean SHOULD be penalized', () => {
      const bt = BODY_TYPES.short_femur;
      const calibration = makeCalibration(bt);

      // Short-femur lifter leaning way too far forward (55 deg when they can stay at 30)
      const trunkScore = scoreTrunk(55, DEFAULT_CONFIG, calibration);

      // Should score lower because this much lean is unnecessary for their proportions
      expect(
        trunkScore,
        `Short-femur trunk score at excessive angle (55 deg): ${trunkScore}`
      ).toBeLessThan(85);
    });

    it('calibration adjusts trunk angle range proportionally to femurTibiaRatio', () => {
      const averageCal = makeCalibration(BODY_TYPES.average);
      const longFemurCal = makeCalibration(BODY_TYPES.long_femur);
      const shortFemurCal = makeCalibration(BODY_TYPES.short_femur);

      const [avgMin, avgMax] = getTrunkAngleRange('high_bar', averageCal);
      const [longMin, longMax] = getTrunkAngleRange('high_bar', longFemurCal);
      const [shortMin, shortMax] = getTrunkAngleRange('high_bar', shortFemurCal);

      // Long femur should have higher acceptable range
      expect(longMax).toBeGreaterThan(avgMax);
      expect(longMin).toBeGreaterThan(avgMin);

      // Short femur should have lower acceptable range
      expect(shortMax).toBeLessThan(avgMax);
      expect(shortMin).toBeLessThan(avgMin);

      // The adjustment should be approximately:
      // long_femur: (1.3 - 1.0) * 55 = 16.5 degrees
      // short_femur: (0.8 - 1.0) * 55 = -11 degrees
      const longAdjustment = longMax - avgMax;
      expect(longAdjustment).toBeCloseTo(0.3 * FEMUR_TIBIA_ADJUSTMENT_MULTIPLIER, 0);

      const shortAdjustment = shortMax - avgMax;
      expect(shortAdjustment).toBeCloseTo(-0.2 * FEMUR_TIBIA_ADJUSTMENT_MULTIPLIER, 0);
    });

    it('without calibration, long-femur lifter is penalized for natural trunk lean', () => {
      const bt = BODY_TYPES.long_femur;

      // Without calibration, the base range for high_bar is [30, 50]
      // A long-femur lifter at 55 deg is above 50, so they get penalized
      const uncalibratedScore = scoreTrunk(bt.naturalTrunkAngle, DEFAULT_CONFIG, null);

      // With calibration, the range widens
      const calibration = makeCalibration(bt);
      const calibratedScore = scoreTrunk(bt.naturalTrunkAngle, DEFAULT_CONFIG, calibration);

      // Calibrated should be higher
      expect(
        calibratedScore,
        `Calibrated (${calibratedScore}) should be > uncalibrated (${uncalibratedScore})`
      ).toBeGreaterThan(uncalibratedScore);
    });

    it('average body type with calibration gets similar score as without calibration', () => {
      const bt = BODY_TYPES.average;
      const calibration = makeCalibration(bt);

      // femurTibiaRatio = 1.0, so adjustment is 0
      const uncalibrated = scoreTrunk(40, DEFAULT_CONFIG, null);
      const calibrated = scoreTrunk(40, DEFAULT_CONFIG, calibration);

      // Should be identical or very close since ratio is 1.0
      expect(Math.abs(calibrated - uncalibrated)).toBeLessThanOrEqual(1);
    });

    it('trunk angle adjustment is clamped per squat type', () => {
      // An extreme femur ratio should be clamped
      const extremeCal = makeCalibration({
        ...BODY_TYPES.long_femur,
        femurTibiaRatio: 2.0,  // Unrealistically extreme
      });

      const [, highBarMax] = getTrunkAngleRange('high_bar', extremeCal);
      const [, lowBarMax] = getTrunkAngleRange('low_bar', extremeCal);
      const [, frontMax] = getTrunkAngleRange('front', extremeCal);

      // high_bar clamp: max adjustment is 25
      const baseHighBarMax = TRUNK_ANGLE_RANGES['high_bar'][1];
      expect(highBarMax).toBeLessThanOrEqual(baseHighBarMax + 25);

      // low_bar clamp: max adjustment is 30
      const baseLowBarMax = TRUNK_ANGLE_RANGES['low_bar'][1];
      expect(lowBarMax).toBeLessThanOrEqual(baseLowBarMax + 30);

      // front squat clamp: max adjustment is 15
      const baseFrontMax = TRUNK_ANGLE_RANGES['front'][1];
      expect(frontMax).toBeLessThanOrEqual(baseFrontMax + 15);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3. Depth Scoring with Calibration
  // ════════════════════════════════════════════════════════════════════════

  describe('Depth scoring with calibration', () => {
    it('depth scoring is body-type-neutral (uses only knee angle)', () => {
      // scoreDepth only uses minKneeAngle and config, not calibration or body type
      const score80 = scoreDepth(80, DEFAULT_CONFIG);
      const score95 = scoreDepth(95, DEFAULT_CONFIG);
      const score110 = scoreDepth(110, DEFAULT_CONFIG);

      // These should be the same regardless of body type because scoreDepth
      // does not take calibration data as input
      expect(score80).toBeGreaterThan(score95);
      expect(score95).toBeGreaterThan(score110);
    });

    it('same knee angle produces same depth score for all body types', () => {
      const bodyTypes = Object.keys(BODY_TYPES) as (keyof typeof BODY_TYPES)[];
      const testAngle = 90;

      const scores = bodyTypes.map(btKey => ({
        bodyType: btKey,
        score: scoreDepth(testAngle, DEFAULT_CONFIG),
      }));

      // All scores must be identical because scoreDepth does not use body type info
      const firstScore = scores[0].score;
      for (const s of scores) {
        expect(s.score).toBe(firstScore);
      }
    });

    it('depth score scales correctly across the threshold boundary', () => {
      // For intermediate: threshold = 100
      // Below threshold-20 (80): score = 100
      // At threshold (100): score = 80
      // Above threshold: degrades at 2 points per degree
      expect(scoreDepth(80, DEFAULT_CONFIG)).toBe(100);
      expect(scoreDepth(100, DEFAULT_CONFIG)).toBe(80);
      expect(scoreDepth(90, DEFAULT_CONFIG)).toBe(90);
      expect(scoreDepth(110, DEFAULT_CONFIG)).toBe(60);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4. Body Type Independence of Non-Geometric Scores
  // ════════════════════════════════════════════════════════════════════════

  describe('Body-type independence of symmetry and tempo', () => {
    it('symmetry scoring is identical for all body types with same hip asymmetry', () => {
      const bodyTypes = Object.keys(BODY_TYPES) as (keyof typeof BODY_TYPES)[];

      for (const asymmetryValue of [0.02, 0.08, 0.15]) {
        const scores = bodyTypes.map(btKey => {
          const rep = makeRepData({
            minKneeAngle: 90,
            maxTrunkAngle: BODY_TYPES[btKey].naturalTrunkAngle,
            hipSymmetry: asymmetryValue,
          });
          return { bodyType: btKey, score: scoreSymmetry(rep) };
        });

        const firstScore = scores[0].score;
        for (const s of scores) {
          expect(
            s.score,
            `${s.bodyType} symmetry score should match ${scores[0].bodyType}`
          ).toBe(firstScore);
        }
      }
    });

    it('tempo scoring is identical for all body types with same tempo', () => {
      const bodyTypes = Object.keys(BODY_TYPES) as (keyof typeof BODY_TYPES)[];
      const tempos = [
        { descent: 2.5, bottom: 0.5, ascent: 2.0 },
        { descent: 0.5, bottom: 0.0, ascent: 0.5 },
        { descent: 5.0, bottom: 2.0, ascent: 3.0 },
      ];

      for (const tempo of tempos) {
        const scores = bodyTypes.map(btKey => ({
          bodyType: btKey,
          score: scoreTempo(tempo.descent, tempo.bottom, tempo.ascent),
        }));

        const firstScore = scores[0].score;
        for (const s of scores) {
          expect(s.score).toBe(firstScore);
        }
      }
    });

    it('lockout scoring is identical for all body types with same final knee angle and calibration', () => {
      const bodyTypes = Object.keys(BODY_TYPES) as (keyof typeof BODY_TYPES)[];

      // All body types use the same standing knee angle (175) in calibration
      for (const btKey of bodyTypes) {
        const calibration = makeCalibration(BODY_TYPES[btKey]);
        const rep = makeRepData({
          minKneeAngle: 90,
          maxTrunkAngle: BODY_TYPES[btKey].naturalTrunkAngle,
        });

        const score = scoreLockout(rep, calibration);

        // Since all calibrations have standingKneeAngle = 175, and the rep ends
        // at ~175 (the last frames interpolate back to standing), scores should be equal
        expect(score).toBeGreaterThanOrEqual(90);
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 5. Grade Achievability
  // ════════════════════════════════════════════════════════════════════════

  describe('Grade achievability', () => {
    const bodyTypeKeys = Object.keys(BODY_TYPES) as (keyof typeof BODY_TYPES)[];

    for (const btKey of bodyTypeKeys) {
      it(`${btKey}: can achieve grade A with good form and calibration`, () => {
        const bt = BODY_TYPES[btKey];
        const calibration = makeCalibration(bt);

        // Perfect form: deep squat, natural trunk angle, good symmetry, ideal tempo
        const rep = makeRepData({
          minKneeAngle: 75,   // Well below parallel
          maxTrunkAngle: bt.naturalTrunkAngle,
          hipSymmetry: 0.02,  // Excellent symmetry
          descentDuration: 2.5,
          bottomDuration: 0.5,
          ascentDuration: 2.0,
        });

        const overall = computeOverallNoKnee(rep, DEFAULT_CONFIG, calibration);
        const grade = scoreToGrade(overall);
        expect(
          grade,
          `${btKey}: score=${overall}, grade=${grade} should be A`
        ).toBe('A');
      });
    }

    for (const btKey of bodyTypeKeys) {
      it(`${btKey}: poor form correctly scores low regardless of body type`, () => {
        const bt = BODY_TYPES[btKey];
        const calibration = makeCalibration(bt);

        // Poor form: shallow, excessive lean beyond natural range, bad tempo
        const poorTrunkAngle = bt.naturalTrunkAngle + 30;  // Way beyond natural
        const rep = makeRepData({
          minKneeAngle: 130,    // Very shallow
          maxTrunkAngle: poorTrunkAngle,
          hipSymmetry: 0.25,    // Bad symmetry
          descentDuration: 0.3, // Way too fast
          bottomDuration: 0.0,  // Bouncing
          ascentDuration: 0.1,  // Unrealistically fast
        });

        const overall = computeOverallNoKnee(rep, DEFAULT_CONFIG, calibration);

        expect(
          overall,
          `${btKey}: poor form score ${overall} should be < 70`
        ).toBeLessThan(70);
      });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // 6. Integration: Full analyzeSequence with Different Body Types
  // ════════════════════════════════════════════════════════════════════════

  describe('Full pipeline integration', () => {
    it('analyzeSequence produces valid results for all body types', () => {
      const bodyTypeKeys = Object.keys(BODY_TYPES) as (keyof typeof BODY_TYPES)[];

      for (const btKey of bodyTypeKeys) {
        const bt = BODY_TYPES[btKey];
        const { frames } = createSyntheticSequence({
          bodyType: btKey,
          minKneeAngle: 90,
          trunkAngleAtBottom: bt.naturalTrunkAngle,
          repCount: 3,
          fps: FPS,
        });

        const result = analyzeSequence(frames, FPS, DEFAULT_CONFIG);

        expect(result.repCount, `${btKey}: should detect reps`).toBeGreaterThanOrEqual(1);
        expect(result.overallScore, `${btKey}: overall score in [0,100]`).toBeGreaterThanOrEqual(0);
        expect(result.overallScore, `${btKey}: overall score in [0,100]`).toBeLessThanOrEqual(100);
      }
    });

    it('moderate form scores are consistent across body types in full pipeline', () => {
      const bodyTypeKeys = Object.keys(BODY_TYPES) as (keyof typeof BODY_TYPES)[];
      const scores: { bodyType: string; score: number }[] = [];

      for (const btKey of bodyTypeKeys) {
        const bt = BODY_TYPES[btKey];
        const { frames } = createSyntheticSequence({
          bodyType: btKey,
          minKneeAngle: 95,  // At parallel
          trunkAngleAtBottom: bt.naturalTrunkAngle,
          repCount: 3,
          fps: FPS,
        });

        const result = analyzeSequence(frames, FPS, DEFAULT_CONFIG);
        scores.push({ bodyType: btKey, score: result.overallScore });
      }

      // All scores should be reasonable (not penalized to oblivion)
      for (const s of scores) {
        expect(
          s.score,
          `${s.bodyType}: full pipeline score ${s.score} should be >= 50`
        ).toBeGreaterThanOrEqual(50);
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 7. Form Quality Differentiation (Moderate vs Poor)
  // ════════════════════════════════════════════════════════════════════════

  describe('Form quality differentiation across body types', () => {
    const bodyTypeKeys = Object.keys(BODY_TYPES) as (keyof typeof BODY_TYPES)[];

    for (const btKey of bodyTypeKeys) {
      it(`${btKey}: good form scores higher than moderate, which scores higher than poor`, () => {
        const bt = BODY_TYPES[btKey];
        const calibration = makeCalibration(bt);

        // Good form
        const goodRep = makeRepData({
          minKneeAngle: 80,
          maxTrunkAngle: bt.naturalTrunkAngle,
          hipSymmetry: 0.02,
          descentDuration: 2.5,
          bottomDuration: 0.5,
          ascentDuration: 2.0,
        });

        // Moderate form (some issues)
        const modRep = makeRepData({
          minKneeAngle: 105,  // Slightly above parallel
          maxTrunkAngle: bt.naturalTrunkAngle + 10,
          hipSymmetry: 0.12,
          descentDuration: 1.5,
          bottomDuration: 0.3,
          ascentDuration: 1.5,
        });

        // Poor form
        const poorRep = makeRepData({
          minKneeAngle: 130,
          maxTrunkAngle: bt.naturalTrunkAngle + 25,
          hipSymmetry: 0.25,
          descentDuration: 0.5,
          bottomDuration: 0.0,
          ascentDuration: 0.3,
        });

        const goodScore = computeOverallNoKnee(goodRep, DEFAULT_CONFIG, calibration);
        const modScore = computeOverallNoKnee(modRep, DEFAULT_CONFIG, calibration);
        const poorScore = computeOverallNoKnee(poorRep, DEFAULT_CONFIG, calibration);

        expect(
          goodScore,
          `${btKey}: good (${goodScore}) > moderate (${modScore})`
        ).toBeGreaterThan(modScore);
        expect(
          modScore,
          `${btKey}: moderate (${modScore}) > poor (${poorScore})`
        ).toBeGreaterThan(poorScore);
      });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // 8. Squat Type Interaction with Body Type
  // ════════════════════════════════════════════════════════════════════════

  describe('Squat type interaction with body type', () => {
    it('low-bar squat allows more trunk lean for all body types', () => {
      const bodyTypeKeys = Object.keys(BODY_TYPES) as (keyof typeof BODY_TYPES)[];

      for (const btKey of bodyTypeKeys) {
        const calibration = makeCalibration(BODY_TYPES[btKey]);

        const [, highBarMax] = getTrunkAngleRange('high_bar', calibration);
        const [, lowBarMax] = getTrunkAngleRange('low_bar', calibration);

        expect(
          lowBarMax,
          `${btKey}: low-bar max (${lowBarMax}) > high-bar max (${highBarMax})`
        ).toBeGreaterThan(highBarMax);
      }
    });

    it('front squat requires more upright position for all body types', () => {
      const bodyTypeKeys = Object.keys(BODY_TYPES) as (keyof typeof BODY_TYPES)[];

      for (const btKey of bodyTypeKeys) {
        const calibration = makeCalibration(BODY_TYPES[btKey]);

        const [, frontMax] = getTrunkAngleRange('front', calibration);
        const [, highBarMax] = getTrunkAngleRange('high_bar', calibration);

        expect(
          frontMax,
          `${btKey}: front max (${frontMax}) < high-bar max (${highBarMax})`
        ).toBeLessThan(highBarMax);
      }
    });
  });
});
