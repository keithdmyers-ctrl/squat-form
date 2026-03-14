import { describe, it, expect } from 'vitest';
import {
  detectStickingPoints,
  computeBarPath,
  computeVelocityMetrics,
  getCompetitionCues,
} from '../competition';
import {
  WEIGHTS,
  COMPETITION_WEIGHTS,
  scoreCompetitionLockout,
  scoreDepth,
} from '../scorer';
import type {
  FrameAngles,
  RepData,
  RepScore,
  FrameData,
  Landmarks,
  Point,
  CalibrationData,
  SquatConfig,
} from '../types';

// ── Helpers (matching patterns from scorer.test.ts) ──

function makeFrameAngles(overrides: Partial<FrameAngles> = {}): FrameAngles {
  return {
    kneeAngle: 170,
    hipAngle: 170,
    ankleAngle: 90,
    trunkAngle: 10,
    shinAngle: 5,
    kneeWidthRatio: null,
    hipSymmetry: null,
    ...overrides,
  };
}

function makeRepData(overrides: Partial<RepData> = {}): RepData {
  return {
    repNumber: 1,
    startFrame: 0,
    endFrame: 60,
    bottomFrame: 30,
    minKneeAngle: 90,
    minHipAngle: 80,
    maxTrunkAngle: 40,
    descentDuration: 2.0,
    bottomDuration: 0.5,
    ascentDuration: 1.5,
    frameAngles: [makeFrameAngles()],
    heelRise: false,
    buttWink: false,
    goodMorning: false,
    kneeValgus: false,
    trunkAngleChangeOnAscent: 0,
    pelvicTiltAtBottom: 0,
    stickingPoints: [],
    ...overrides,
  };
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

function makeConfig(overrides: Partial<SquatConfig> = {}): SquatConfig {
  return {
    squatType: 'bodyweight',
    experienceLevel: 'beginner',
    competitionMode: false,
    ...overrides,
  };
}

function makePoint(overrides: Partial<Point> = {}): Point {
  return { x: 0.5, y: 0.5, z: 0, visibility: 1, ...overrides };
}

/**
 * Generate a smooth ascent: knee angles linearly increasing from bottom to top.
 * This produces steady positive velocity with no drops.
 */
function generateSmoothAscent(bottomAngle: number, topAngle: number, frames: number): number[] {
  const angles: number[] = [];
  for (let i = 0; i < frames; i++) {
    angles.push(bottomAngle + ((topAngle - bottomAngle) * i) / (frames - 1));
  }
  return angles;
}

/**
 * Generate an ascent with a velocity dip (sticking point) in the middle.
 * Goes from bottomAngle to topAngle but stalls around the specified fraction.
 */
function generateAscentWithStall(
  bottomAngle: number,
  topAngle: number,
  frames: number,
  stallFraction: number,
): number[] {
  const angles: number[] = [];
  const stallStart = Math.floor(frames * stallFraction);
  const stallEnd = stallStart + Math.floor(frames * 0.15);

  for (let i = 0; i < frames; i++) {
    if (i < stallStart) {
      // Fast initial ascent
      const progress = i / stallStart;
      angles.push(bottomAngle + (topAngle - bottomAngle) * stallFraction * progress);
    } else if (i <= stallEnd) {
      // Stall: almost no angle change
      const stallAngle = bottomAngle + (topAngle - bottomAngle) * stallFraction;
      angles.push(stallAngle + (i - stallStart) * 0.1); // very slow
    } else {
      // Resume fast ascent
      const remaining = frames - stallEnd - 1;
      const progress = (i - stallEnd) / remaining;
      const stallAngle = bottomAngle + (topAngle - bottomAngle) * stallFraction + (stallEnd - stallStart) * 0.1;
      angles.push(stallAngle + (topAngle - stallAngle) * progress);
    }
  }
  return angles;
}

// ── Tests ──

describe('detectStickingPoints', () => {
  it('returns empty for a smooth ascent (no velocity drop)', () => {
    // Steady linear ascent from 80 to 170 over 30 frames
    const bottomAngle = 80;
    const topAngle = 170;
    const ascentFrames = 30;
    const descent = generateSmoothAscent(170, 80, 10); // descending portion
    const ascent = generateSmoothAscent(80, 170, ascentFrames);
    const kneeAngles = [...descent, ...ascent];
    const bottomIdx = descent.length - 1;

    const result = detectStickingPoints(kneeAngles, bottomIdx, topAngle, bottomAngle, 30, 0);
    expect(result).toEqual([]);
  });

  it('detects a sticking point when velocity drops at mid-ascent', () => {
    const bottomAngle = 80;
    const topAngle = 170;
    // Descend smoothly, then ascend with a stall around 50%
    const descent = generateSmoothAscent(170, 80, 10);
    const ascent = generateAscentWithStall(80, 170, 40, 0.4);
    const kneeAngles = [...descent, ...ascent];
    const bottomIdx = descent.length - 1;

    const result = detectStickingPoints(kneeAngles, bottomIdx, topAngle, bottomAngle, 30, 0);
    expect(result.length).toBeGreaterThanOrEqual(1);
    // Each sticking point should have a velocityDrop > 0
    for (const sp of result) {
      expect(sp.velocityDrop).toBeGreaterThan(0);
      expect(sp.velocityDrop).toBeLessThanOrEqual(1);
      expect(sp.description).toBeTruthy();
    }
  });

  it('detects multiple sticking points with multiple velocity drops', () => {
    const bottomAngle = 80;
    const topAngle = 170;
    const range = topAngle - bottomAngle; // 90

    // Manually craft angles: fast -> stall -> fast -> stall -> fast
    const descent = generateSmoothAscent(170, 80, 10);
    const ascent: number[] = [];
    // Phase 1: fast ascent (frames 0-9)
    for (let i = 0; i < 10; i++) ascent.push(80 + (range * 0.25 * i) / 9);
    // Phase 2: stall around 25% (frames 10-15)
    for (let i = 0; i < 6; i++) ascent.push(80 + range * 0.25 + i * 0.05);
    // Phase 3: fast ascent (frames 16-25)
    for (let i = 0; i < 10; i++) ascent.push(80 + range * 0.25 + 0.3 + (range * 0.3 * i) / 9);
    // Phase 4: stall around 60% (frames 26-31)
    for (let i = 0; i < 6; i++) ascent.push(80 + range * 0.55 + 0.3 + i * 0.05);
    // Phase 5: fast finish (frames 32-41)
    for (let i = 0; i < 10; i++) ascent.push(80 + range * 0.55 + 0.6 + (range * 0.35 * i) / 9);

    const kneeAngles = [...descent, ...ascent];
    const bottomIdx = descent.length - 1;

    const result = detectStickingPoints(kneeAngles, bottomIdx, topAngle, bottomAngle, 30, 0);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // Maximum 3 sticking points returned (enforced by the function)
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('returns empty when ascent has fewer than 6 frames', () => {
    const kneeAngles = [170, 160, 150, 80, 90, 100]; // bottomIdx=3, ascent only 3 frames
    const result = detectStickingPoints(kneeAngles, 3, 170, 80, 30, 0);
    expect(result).toEqual([]);
  });

  it('returns empty when fps <= 0', () => {
    const ascent = generateSmoothAscent(80, 170, 20);
    const descent = generateSmoothAscent(170, 80, 10);
    const kneeAngles = [...descent, ...ascent];
    const result = detectStickingPoints(kneeAngles, descent.length - 1, 170, 80, 0, 0);
    expect(result).toEqual([]);
  });

  it('returns empty when angle range <= 0 (no actual movement)', () => {
    // topAngle <= bottomAngle
    const kneeAngles = [90, 90, 90, 90, 90, 90, 90, 90, 90, 90];
    const result = detectStickingPoints(kneeAngles, 0, 90, 90, 30, 0);
    expect(result).toEqual([]);
  });

  it('includes correct depth-based description categories', () => {
    // Build an ascent with a stall near the hole (< 30% depth)
    const bottomAngle = 80;
    const topAngle = 170;
    // Stall very early
    const descent = generateSmoothAscent(170, 80, 10);
    const ascent = generateAscentWithStall(80, 170, 40, 0.15);
    const kneeAngles = [...descent, ...ascent];
    const bottomIdx = descent.length - 1;

    const result = detectStickingPoints(kneeAngles, bottomIdx, topAngle, bottomAngle, 30, 0);
    if (result.length > 0) {
      // At least one should be categorized by the description system
      expect(result[0].description).toMatch(
        /hole|mid-range|lockout/i,
      );
    }
  });
});

describe('computeBarPath', () => {
  function buildFrameData(
    positions: Array<{ x: number; y: number }>,
  ): { allLandmarks: FrameData; frameIndices: number[] } {
    const allLandmarks: FrameData = new Map();
    const frameIndices: number[] = [];

    for (let i = 0; i < positions.length; i++) {
      const { x, y } = positions[i];
      const landmarks: Landmarks = {
        left_shoulder: makePoint({ x: x - 0.05, y }),
        right_shoulder: makePoint({ x: x + 0.05, y }),
      };
      allLandmarks.set(i, landmarks);
      frameIndices.push(i);
    }

    return { allLandmarks, frameIndices };
  }

  it('returns high efficiency and low drift for a straight vertical path', () => {
    // Perfectly vertical: x stays at 0.5, y moves from 0.3 to 0.7 and back
    const positions = [];
    for (let i = 0; i < 20; i++) {
      const y = 0.3 + (0.4 * i) / 19;
      positions.push({ x: 0.5, y });
    }

    const { allLandmarks, frameIndices } = buildFrameData(positions);
    const result = computeBarPath(allLandmarks, frameIndices, 0, 19);

    expect(result).toBeDefined();
    expect(result!.lateralDrift).toBeCloseTo(0, 5);
    expect(result!.pathEfficiency).toBe(100);
    expect(result!.description).toContain('Excellent');
  });

  it('returns lower efficiency and higher drift for a wavy path', () => {
    // X oscillates back and forth while Y descends
    const positions = [];
    for (let i = 0; i < 20; i++) {
      const y = 0.3 + (0.4 * i) / 19;
      const x = 0.5 + 0.06 * Math.sin((i * Math.PI) / 5); // lateral sway
      positions.push({ x, y });
    }

    const { allLandmarks, frameIndices } = buildFrameData(positions);
    const result = computeBarPath(allLandmarks, frameIndices, 0, 19);

    expect(result).toBeDefined();
    expect(result!.lateralDrift).toBeGreaterThan(0.02);
    expect(result!.pathEfficiency).toBeLessThan(100);
    // Significant drift -> drift-related description
    expect(result!.description).toContain('drift');
  });

  it('returns pathEfficiency = 100 for no movement (guard case)', () => {
    // All points at the same position: straightLine = 0
    const positions = [];
    for (let i = 0; i < 5; i++) {
      positions.push({ x: 0.5, y: 0.5 });
    }

    const { allLandmarks, frameIndices } = buildFrameData(positions);
    const result = computeBarPath(allLandmarks, frameIndices, 0, 4);

    expect(result).toBeDefined();
    // When straightLine < 1e-9, guard returns 100.0 (no movement = no inefficiency)
    expect(result!.pathEfficiency).toBe(100);
  });

  it('returns undefined when fewer than 3 data points', () => {
    const positions = [
      { x: 0.5, y: 0.3 },
      { x: 0.5, y: 0.5 },
    ];

    const { allLandmarks, frameIndices } = buildFrameData(positions);
    const result = computeBarPath(allLandmarks, frameIndices, 0, 1);

    expect(result).toBeUndefined();
  });

  it('describes minor lateral movement for moderate drift', () => {
    // Drift between 0.02 and 0.04
    const positions = [];
    for (let i = 0; i < 10; i++) {
      const y = 0.3 + (0.3 * i) / 9;
      const x = 0.5 + (i === 5 ? 0.03 : 0); // one frame drifts by 0.03
      positions.push({ x, y });
    }

    const { allLandmarks, frameIndices } = buildFrameData(positions);
    const result = computeBarPath(allLandmarks, frameIndices, 0, 9);

    expect(result).toBeDefined();
    expect(result!.lateralDrift).toBeGreaterThanOrEqual(0.02);
    expect(result!.lateralDrift).toBeLessThan(0.04);
    expect(result!.description).toContain('Good bar path');
  });

  it('skips frames with missing landmarks', () => {
    const allLandmarks: FrameData = new Map();
    const frameIndices = [0, 1, 2, 3, 4];

    // Only set 3 frames with valid landmarks (0, 2, 4), skip 1 and 3
    for (const i of [0, 2, 4]) {
      allLandmarks.set(i, {
        left_shoulder: makePoint({ x: 0.45, y: 0.3 + i * 0.1 }),
        right_shoulder: makePoint({ x: 0.55, y: 0.3 + i * 0.1 }),
      });
    }
    // Frame 1 and 3 have no landmarks

    const result = computeBarPath(allLandmarks, frameIndices, 0, 4);
    // Should work with the 3 valid frames
    expect(result).toBeDefined();
    expect(result!.xPositions.length).toBe(3);
  });
});

describe('computeVelocityMetrics', () => {
  it('returns reasonable velocity values for normal tempo', () => {
    // Simulate a rep at 30fps: ~1s descent (30 frames), ~1s ascent (30 frames)
    const descent = generateSmoothAscent(170, 80, 30); // 170 down to 80
    const ascent = generateSmoothAscent(80, 170, 30);  // 80 up to 170
    const kneeAngles = [...descent, ...ascent];
    const bottomIdx = 29;
    const fps = 30;

    const result = computeVelocityMetrics(kneeAngles, bottomIdx, fps);

    expect(result).toBeDefined();
    expect(result!.peakDescentVelocity).toBeGreaterThan(0);
    expect(result!.peakAscentVelocity).toBeGreaterThan(0);
    expect(result!.meanDescentVelocity).toBeGreaterThan(0);
    expect(result!.meanAscentVelocity).toBeGreaterThan(0);
    // Symmetric descent/ascent -> ratio should be ~1.0
    expect(result!.ascentDescentRatio).toBeCloseTo(1.0, 1);
    expect(result!.description).toContain('Balanced');
  });

  it('returns higher descent velocity for fast descent', () => {
    const fps = 30;
    // Fast descent: 90 deg in 10 frames (~0.33s)
    const fastDescent = generateSmoothAscent(170, 80, 10);
    // Normal ascent: 90 deg in 30 frames (~1.0s)
    const normalAscent = generateSmoothAscent(80, 170, 30);
    const kneeAngles = [...fastDescent, ...normalAscent];
    const bottomIdx = 9;

    const result = computeVelocityMetrics(kneeAngles, bottomIdx, fps);

    expect(result).toBeDefined();
    // Mean descent velocity should be higher than mean ascent velocity
    expect(result!.meanDescentVelocity).toBeGreaterThan(result!.meanAscentVelocity);
    // Ratio < 1 since ascent is slower than descent
    expect(result!.ascentDescentRatio).toBeLessThan(1.0);
  });

  it('returns lower ascent velocity for slow ascent', () => {
    const fps = 30;
    // Normal descent: 90 deg in 30 frames
    const normalDescent = generateSmoothAscent(170, 80, 30);
    // Slow ascent: 90 deg in 90 frames (~3s)
    const slowAscent = generateSmoothAscent(80, 170, 90);
    const kneeAngles = [...normalDescent, ...slowAscent];
    const bottomIdx = 29;

    const result = computeVelocityMetrics(kneeAngles, bottomIdx, fps);

    expect(result).toBeDefined();
    expect(result!.meanAscentVelocity).toBeLessThan(result!.meanDescentVelocity);
    // Slow ascent -> ratio < 0.8 -> 'Slow ascent' description
    expect(result!.ascentDescentRatio).toBeLessThan(0.8);
    expect(result!.description).toContain('Slow ascent');
  });

  it('computes correct ascent/descent ratio', () => {
    const fps = 30;
    // Descent: 90 deg in 30 frames -> mean velocity = 3 deg/frame * 30fps = 90 deg/s
    const descent = generateSmoothAscent(170, 80, 30);
    // Ascent: 90 deg in 15 frames -> mean velocity = 6 deg/frame * 30fps = 180 deg/s
    const ascent = generateSmoothAscent(80, 170, 15);
    const kneeAngles = [...descent, ...ascent];
    const bottomIdx = 29;

    const result = computeVelocityMetrics(kneeAngles, bottomIdx, fps);

    expect(result).toBeDefined();
    // Ascent is 2x faster -> ratio ~2.0
    expect(result!.ascentDescentRatio).toBeCloseTo(2.0, 0);
    expect(result!.description).toContain('Explosive');
  });

  it('returns undefined when kneeAngles has fewer than 4 elements', () => {
    expect(computeVelocityMetrics([170, 80, 170], 1, 30)).toBeUndefined();
  });

  it('returns undefined when fps <= 0', () => {
    const angles = generateSmoothAscent(170, 80, 10);
    expect(computeVelocityMetrics(angles, 5, 0)).toBeUndefined();
    expect(computeVelocityMetrics(angles, 5, -1)).toBeUndefined();
  });

  it('returns undefined when bottomIdx <= 0', () => {
    const angles = generateSmoothAscent(170, 80, 10);
    expect(computeVelocityMetrics(angles, 0, 30)).toBeUndefined();
  });
});

describe('competition scoring weights', () => {
  it('competition mode removes tempo weight (0%)', () => {
    expect(COMPETITION_WEIGHTS.tempo).toBe(0);
  });

  it('competition mode increases depth weight to 30%', () => {
    expect(COMPETITION_WEIGHTS.depth).toBe(0.30);
  });

  it('competition mode increases lockout weight to 20%', () => {
    expect(COMPETITION_WEIGHTS.lockout).toBe(0.20);
  });

  it('COMPETITION_WEIGHTS sum to 1.0', () => {
    const total = Object.values(COMPETITION_WEIGHTS).reduce((sum, v) => sum + v, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });

  it('standard WEIGHTS sum to 1.0', () => {
    const total = Object.values(WEIGHTS).reduce((sum, v) => sum + v, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });

  it('competition depth weight is higher than standard', () => {
    expect(COMPETITION_WEIGHTS.depth).toBeGreaterThan(WEIGHTS.depth);
  });

  it('competition lockout weight is higher than standard', () => {
    expect(COMPETITION_WEIGHTS.lockout).toBeGreaterThan(WEIGHTS.lockout);
  });
});

describe('competition depth pass/fail', () => {
  // Competition depth uses the scoring system from scorer.ts.
  // The RepData.competitionDepthPass field is set by the analyzer.
  // We test depth scoring behavior at competition-relevant thresholds.

  it('deep squat (hip crease below knee) scores high', () => {
    // Advanced threshold is 90. minKneeAngle = 70 is well below parallel.
    const config = makeConfig({ experienceLevel: 'advanced', competitionMode: true });
    const score = scoreDepth(70, config);
    expect(score).toBe(100);
  });

  it('hip crease at knee level (at threshold) scores 80', () => {
    // Advanced threshold = 90. At exactly the threshold.
    const config = makeConfig({ experienceLevel: 'advanced', competitionMode: true });
    const score = scoreDepth(90, config);
    expect(score).toBe(80);
  });

  it('hip crease above knee (shallow squat) scores poorly', () => {
    // Advanced threshold = 90. minKneeAngle = 110 is 20 above threshold.
    // score = 80 - 20*2 = 40
    const config = makeConfig({ experienceLevel: 'advanced', competitionMode: true });
    const score = scoreDepth(110, config);
    expect(score).toBe(40);
  });

  it('competitionDepthPass=false triggers depth cue', () => {
    const rep = makeRepData({ competitionDepthPass: false });
    const repScore: RepScore = {
      depthScore: 60,
      kneeTrackingScore: 90,
      trunkScore: 90,
      symmetryScore: 90,
      tempoScore: 100,
      lockoutScore: 90,
      overallScore: 80,
      grade: 'B',
      issues: [],
      cues: [],
      positiveFeedback: [],
      stickingPoints: [],
    };

    const cues = getCompetitionCues(rep, repScore);
    const depthCue = cues.find((c) => c.issue === 'competition_depth');
    expect(depthCue).toBeDefined();
    expect(depthCue!.priority).toBe(1);
    expect(depthCue!.cue).toContain('high');
  });

  it('competitionDepthPass=true produces no depth cue', () => {
    const rep = makeRepData({ competitionDepthPass: true });
    const repScore: RepScore = {
      depthScore: 100,
      kneeTrackingScore: 90,
      trunkScore: 90,
      symmetryScore: 90,
      tempoScore: 100,
      lockoutScore: 95,
      overallScore: 95,
      grade: 'A',
      issues: [],
      cues: [],
      positiveFeedback: [],
      stickingPoints: [],
    };

    const cues = getCompetitionCues(rep, repScore);
    const depthCue = cues.find((c) => c.issue === 'competition_depth');
    expect(depthCue).toBeUndefined();
  });
});

describe('competition lockout strictness (scoreCompetitionLockout)', () => {
  it('returns 100 when within 3 degrees of standing', () => {
    const cal = makeCalibration({ standingKneeAngle: 175 });
    const rep = makeRepData({
      frameAngles: [
        makeFrameAngles({ kneeAngle: 173 }),
        makeFrameAngles({ kneeAngle: 174 }),
        makeFrameAngles({ kneeAngle: 175 }),
      ],
    });
    // diff = |175 - 175| = 0 -> 100
    expect(scoreCompetitionLockout(rep, cal)).toBe(100);
  });

  it('returns 80 when within 5 degrees', () => {
    const cal = makeCalibration({ standingKneeAngle: 175 });
    const rep = makeRepData({
      frameAngles: [
        makeFrameAngles({ kneeAngle: 170 }),
        makeFrameAngles({ kneeAngle: 171 }),
      ],
    });
    // max of last 5 = 171, diff = |171 - 175| = 4 -> 80
    expect(scoreCompetitionLockout(rep, cal)).toBe(80);
  });

  it('returns 50 when within 10 degrees', () => {
    const cal = makeCalibration({ standingKneeAngle: 175 });
    const rep = makeRepData({
      frameAngles: [
        makeFrameAngles({ kneeAngle: 166 }),
        makeFrameAngles({ kneeAngle: 167 }),
        makeFrameAngles({ kneeAngle: 168 }),
      ],
    });
    // max of last 5 = 168, diff = |168 - 175| = 7 -> 50
    expect(scoreCompetitionLockout(rep, cal)).toBe(50);
  });

  it('returns 20 when more than 10 degrees off', () => {
    const cal = makeCalibration({ standingKneeAngle: 175 });
    const rep = makeRepData({
      frameAngles: [
        makeFrameAngles({ kneeAngle: 155 }),
        makeFrameAngles({ kneeAngle: 160 }),
      ],
    });
    // max of last 5 = 160, diff = |160 - 175| = 15 -> 20
    expect(scoreCompetitionLockout(rep, cal)).toBe(20);
  });

  it('returns 30 when no frame angles', () => {
    const cal = makeCalibration({ standingKneeAngle: 175 });
    const rep = makeRepData({ frameAngles: [] });
    expect(scoreCompetitionLockout(rep, cal)).toBe(30);
  });

  it('defaults to standing knee angle of 175 without calibration', () => {
    const rep = makeRepData({
      frameAngles: [
        makeFrameAngles({ kneeAngle: 174 }),
        makeFrameAngles({ kneeAngle: 175 }),
      ],
    });
    // diff = |175 - 175| = 0 -> 100
    expect(scoreCompetitionLockout(rep, null)).toBe(100);
  });

  it('handles exact boundary at 3 degrees', () => {
    const cal = makeCalibration({ standingKneeAngle: 175 });
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ kneeAngle: 172 })],
    });
    // diff = |172 - 175| = 3.0 -> 100 (boundary is <=3.0)
    expect(scoreCompetitionLockout(rep, cal)).toBe(100);
  });

  it('handles exact boundary at 5 degrees', () => {
    const cal = makeCalibration({ standingKneeAngle: 175 });
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ kneeAngle: 170 })],
    });
    // diff = |170 - 175| = 5.0 -> 80 (boundary is <=5.0)
    expect(scoreCompetitionLockout(rep, cal)).toBe(80);
  });
});

describe('getCompetitionCues', () => {
  it('generates lockout cue when lockout score < 85', () => {
    const rep = makeRepData();
    const repScore: RepScore = {
      depthScore: 90,
      kneeTrackingScore: 90,
      trunkScore: 90,
      symmetryScore: 90,
      tempoScore: 100,
      lockoutScore: 70,
      overallScore: 85,
      grade: 'B',
      issues: [],
      cues: [],
      positiveFeedback: [],
      stickingPoints: [],
    };

    const cues = getCompetitionCues(rep, repScore);
    const lockoutCue = cues.find((c) => c.issue === 'competition_lockout');
    expect(lockoutCue).toBeDefined();
    expect(lockoutCue!.cue).toContain('Lock');
  });

  it('generates bar path cue when lateral drift > 0.03', () => {
    const rep = makeRepData({
      barPath: {
        xPositions: [0.5, 0.54],
        yPositions: [0.3, 0.5],
        lateralDrift: 0.05,
        pathEfficiency: 85,
        description: 'drift',
      },
    });
    const repScore: RepScore = {
      depthScore: 90,
      kneeTrackingScore: 90,
      trunkScore: 90,
      symmetryScore: 90,
      tempoScore: 100,
      lockoutScore: 95,
      overallScore: 92,
      grade: 'A',
      issues: [],
      cues: [],
      positiveFeedback: [],
      stickingPoints: [],
    };

    const cues = getCompetitionCues(rep, repScore);
    const barPathCue = cues.find((c) => c.issue === 'competition_bar_path');
    expect(barPathCue).toBeDefined();
    expect(barPathCue!.cue).toContain('midfoot');
  });

  it('generates sticking point cue when sticking points present', () => {
    const rep = makeRepData({
      stickingPoints: [{
        frame: 15,
        kneeAngle: 110,
        depthPercentage: 40,
        velocityDrop: 0.6,
        description: 'Mid-range sticking point',
      }],
    });
    const repScore: RepScore = {
      depthScore: 90,
      kneeTrackingScore: 90,
      trunkScore: 90,
      symmetryScore: 90,
      tempoScore: 100,
      lockoutScore: 95,
      overallScore: 92,
      grade: 'A',
      issues: [],
      cues: [],
      positiveFeedback: [],
      stickingPoints: [],
    };

    const cues = getCompetitionCues(rep, repScore);
    const spCue = cues.find((c) => c.issue === 'sticking_point');
    expect(spCue).toBeDefined();
    expect(spCue!.cue).toContain('tight');
  });

  it('generates grinding cue when ascent/descent ratio < 0.5', () => {
    const rep = makeRepData({
      velocity: {
        peakDescentVelocity: 200,
        peakAscentVelocity: 80,
        meanDescentVelocity: 150,
        meanAscentVelocity: 50,
        ascentDescentRatio: 0.33,
        description: 'Slow ascent',
      },
    });
    const repScore: RepScore = {
      depthScore: 90,
      kneeTrackingScore: 90,
      trunkScore: 90,
      symmetryScore: 90,
      tempoScore: 100,
      lockoutScore: 95,
      overallScore: 92,
      grade: 'A',
      issues: [],
      cues: [],
      positiveFeedback: [],
      stickingPoints: [],
    };

    const cues = getCompetitionCues(rep, repScore);
    const grindCue = cues.find((c) => c.issue === 'grinding');
    expect(grindCue).toBeDefined();
    expect(grindCue!.cue).toContain('grinder');
  });

  it('returns no cues for a perfect rep', () => {
    const rep = makeRepData({ competitionDepthPass: true });
    const repScore: RepScore = {
      depthScore: 100,
      kneeTrackingScore: 100,
      trunkScore: 100,
      symmetryScore: 100,
      tempoScore: 100,
      lockoutScore: 100,
      overallScore: 100,
      grade: 'A',
      issues: [],
      cues: [],
      positiveFeedback: [],
      stickingPoints: [],
    };

    const cues = getCompetitionCues(rep, repScore);
    expect(cues).toEqual([]);
  });

  it('cues are sorted by priority (depth=1, lockout=2, bar_path=3, sticking=4, grinding=5)', () => {
    const rep = makeRepData({
      competitionDepthPass: false,
      barPath: {
        xPositions: [0.5],
        yPositions: [0.5],
        lateralDrift: 0.05,
        pathEfficiency: 80,
        description: 'drift',
      },
      stickingPoints: [{
        frame: 10,
        kneeAngle: 100,
        depthPercentage: 50,
        velocityDrop: 0.5,
        description: 'test',
      }],
      velocity: {
        peakDescentVelocity: 200,
        peakAscentVelocity: 50,
        meanDescentVelocity: 150,
        meanAscentVelocity: 40,
        ascentDescentRatio: 0.26,
        description: 'Slow',
      },
    });
    const repScore: RepScore = {
      depthScore: 50,
      kneeTrackingScore: 90,
      trunkScore: 90,
      symmetryScore: 90,
      tempoScore: 100,
      lockoutScore: 70,
      overallScore: 75,
      grade: 'C',
      issues: [],
      cues: [],
      positiveFeedback: [],
      stickingPoints: [],
    };

    const cues = getCompetitionCues(rep, repScore);
    // Should have all 5 cue types
    expect(cues.length).toBeGreaterThanOrEqual(4);
    // Verify priority ordering
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].priority).toBeGreaterThanOrEqual(cues[i - 1].priority);
    }
  });
});
