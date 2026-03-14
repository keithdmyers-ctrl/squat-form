import { describe, it, expect } from 'vitest';
import {
  scoreDepth,
  scoreTrunk,
  scoreSymmetry,
  scoreTempo,
  scoreLockout,
  scoreToGrade,
  redistributeWeights,
  clamp,
  DEPTH_THRESHOLDS,
  WEIGHTS,
} from '../scorer';
import type { SquatConfig, CalibrationData, RepData, FrameAngles } from '../types';

// ── Helpers ──

function makeConfig(overrides: Partial<SquatConfig> = {}): SquatConfig {
  return {
    squatType: 'bodyweight',
    experienceLevel: 'beginner',
    competitionMode: false,
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

// ── Tests ──

describe('clamp', () => {
  it('returns the value when within range', () => {
    expect(clamp(50, 0, 100)).toBe(50);
  });

  it('clamps to min', () => {
    expect(clamp(-5, 0, 100)).toBe(0);
  });

  it('clamps to max', () => {
    expect(clamp(150, 0, 100)).toBe(100);
  });

  it('returns boundary values unchanged', () => {
    expect(clamp(0, 0, 100)).toBe(0);
    expect(clamp(100, 0, 100)).toBe(100);
  });
});

describe('scoreDepth', () => {
  it('returns 100 for perfect depth (well below threshold)', () => {
    const config = makeConfig({ experienceLevel: 'beginner' });
    // threshold is 100 for beginner, threshold-20 = 80
    expect(scoreDepth(70, config)).toBe(100);
    expect(scoreDepth(80, config)).toBe(100);
  });

  it('returns 80 at exactly the threshold', () => {
    const config = makeConfig({ experienceLevel: 'beginner' });
    // beginner threshold = 110
    expect(scoreDepth(110, config)).toBe(80);
  });

  it('interpolates linearly between threshold-20 and threshold', () => {
    const config = makeConfig({ experienceLevel: 'beginner' });
    // beginner threshold = 110, threshold-20 = 90
    // midpoint: angle = 100, frac = (100-90)/20 = 0.5, score = 100 - 0.5*20 = 90
    expect(scoreDepth(100, config)).toBe(90);
  });

  it('degrades above threshold', () => {
    const config = makeConfig({ experienceLevel: 'beginner' });
    // threshold=110, angle=120, over=10, score = 80 - 10*2 = 60
    expect(scoreDepth(120, config)).toBe(60);
  });

  it('uses advanced threshold (90)', () => {
    const config = makeConfig({ experienceLevel: 'advanced' });
    expect(DEPTH_THRESHOLDS['advanced']).toBe(90);
    expect(scoreDepth(70, config)).toBe(100); // 90-20=70, at or below
    expect(scoreDepth(90, config)).toBe(80);  // at threshold
  });

  it('never returns below 0', () => {
    const config = makeConfig({ experienceLevel: 'beginner' });
    expect(scoreDepth(160, config)).toBe(0);
  });
});

describe('scoreTrunk', () => {
  it('returns 100 within expected range', () => {
    const config = makeConfig({ squatType: 'bodyweight' });
    // bodyweight range is [25, 45]
    expect(scoreTrunk(35, config, null)).toBe(100);
    expect(scoreTrunk(25, config, null)).toBe(100);
    expect(scoreTrunk(45, config, null)).toBe(100);
  });

  it('degrades linearly within tolerance', () => {
    const config = makeConfig({ squatType: 'bodyweight', experienceLevel: 'beginner' });
    // range [25, 45], tolerance 20 for beginner
    // angle=50, deviation=5 from maxExpected(45), within tolerance(20)
    // score = 100 - (5/20)*15 = 100 - 3.75 = 96.25
    const score = scoreTrunk(50, config, null);
    expect(score).toBeCloseTo(96.25, 1);
  });

  it('degrades beyond tolerance', () => {
    const config = makeConfig({ squatType: 'bodyweight', experienceLevel: 'advanced' });
    // range [25, 45], tolerance 10 for advanced
    // angle=60, deviation=15, beyond tolerance by 5, score = 85 - 5*1.5 = 77.5
    expect(scoreTrunk(60, config, null)).toBeCloseTo(77.5, 1);
  });

  it('applies calibration adjustment', () => {
    const config = makeConfig({ squatType: 'bodyweight' });
    // femurTibiaRatio = 1.2, deviation = 0.2, adjustment = 0.2*55 = 11
    // bodyweight clamp: Math.max(-15, Math.min(20, 11)) = 11
    // adjusted range: [25+11, 45+11] = [36, 56]
    const cal = makeCalibration({ femurTibiaRatio: 1.2 });
    expect(scoreTrunk(48, config, cal)).toBe(100); // within [36, 56]
    // 30 is below 36 by 6, beginner tolerance = 20, score = 100 - (6/20)*15 = 95.5
    expect(scoreTrunk(30, config, cal)).toBeCloseTo(95.5, 1);
  });
});

describe('scoreSymmetry', () => {
  it('returns 100 for perfectly symmetric (< 0.02 asymmetry)', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ hipSymmetry: 0.01 })],
    });
    expect(scoreSymmetry(rep)).toBe(100);
  });

  it('returns 90 (default) when no symmetry data available', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ hipSymmetry: null })],
    });
    expect(scoreSymmetry(rep)).toBe(90);
  });

  it('returns 100 below noise threshold (< 0.05)', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ hipSymmetry: 0.035 })],
    });
    // 0.035 < 0.05 = within noise, returns 100
    expect(scoreSymmetry(rep)).toBe(100);
  });

  it('interpolates between 0.05 and 0.10', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ hipSymmetry: 0.075 })],
    });
    // frac = (0.075 - 0.05) / 0.05 = 0.5, score = 100 - 0.5*15 = 92.5
    expect(scoreSymmetry(rep)).toBeCloseTo(92.5, 1);
  });

  it('degrades between 0.10 and 0.20', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ hipSymmetry: 0.15 })],
    });
    // frac = (0.15 - 0.10) / 0.10 = 0.5, score = 85 - 0.5*25 = 72.5
    expect(scoreSymmetry(rep)).toBeCloseTo(72.5, 1);
  });

  it('uses the max asymmetry across all frames', () => {
    const rep = makeRepData({
      frameAngles: [
        makeFrameAngles({ hipSymmetry: 0.01 }),
        makeFrameAngles({ hipSymmetry: 0.04 }),
        makeFrameAngles({ hipSymmetry: 0.02 }),
      ],
    });
    // max = 0.04, < 0.05, returns 100
    expect(scoreSymmetry(rep)).toBe(100);
  });
});

describe('scoreTempo', () => {
  it('returns 100 for ideal tempo', () => {
    expect(scoreTempo(2.0, 0.5, 1.0)).toBe(100);
  });

  it('penalizes too-fast descent', () => {
    // descent=0.5, below IDEAL_DESCENT_MIN=1.0, penalty = min(20, (1.0-0.5)*20) = 10
    expect(scoreTempo(0.5, 0.5, 1.0)).toBe(90);
  });

  it('penalizes too-slow descent', () => {
    // descent=7.0, above IDEAL_DESCENT_MAX=4.0, penalty = min(10, (7.0-4.0)*5) = 10 (capped)
    expect(scoreTempo(7.0, 0.5, 1.0)).toBe(90);
  });

  it('penalizes bouncing (bottom < 0.1s)', () => {
    // bottom=0.05 -> -10
    expect(scoreTempo(2.0, 0.05, 1.0)).toBe(90);
  });

  it('penalizes long bottom pause', () => {
    // bottom=2.0, penalty = min(10, (2.0-1.5)*5) = 2.5
    expect(scoreTempo(2.0, 2.0, 1.0)).toBeCloseTo(97.5, 1);
  });

  it('penalizes very fast ascent', () => {
    // ascent=0.1 (< 0.2) -> -5
    expect(scoreTempo(2.0, 0.5, 0.1)).toBe(95);
  });

  it('accumulates multiple penalties', () => {
    // fast descent (0.5): min(20, (1.0-0.5)*20)=10, bouncing (0.05): -10, fast ascent (0.1): -5
    expect(scoreTempo(0.5, 0.05, 0.1)).toBe(75);
  });

  it('never returns below 0', () => {
    expect(scoreTempo(0, 0, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('scoreLockout', () => {
  it('returns 100 for full lockout (within 5 degrees)', () => {
    const rep = makeRepData({
      frameAngles: [
        makeFrameAngles({ kneeAngle: 168 }),
        makeFrameAngles({ kneeAngle: 170 }),
        makeFrameAngles({ kneeAngle: 172 }),
      ],
    });
    const cal = makeCalibration({ standingKneeAngle: 170 });
    expect(scoreLockout(rep, cal)).toBe(100);
  });

  it('returns interpolated score for partial lockout (5-15 deg below threshold)', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ kneeAngle: 160 })],
    });
    const cal = makeCalibration({ standingKneeAngle: 170 });
    // threshold = standingKnee - 5 = 165, diff = 165 - 160 = 5
    // frac = 5/10 = 0.5, score = 100 - 0.5*25 = 87.5
    expect(scoreLockout(rep, cal)).toBeCloseTo(87.5, 1);
  });

  it('degrades beyond 10 degrees below threshold', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ kneeAngle: 150 })],
    });
    const cal = makeCalibration({ standingKneeAngle: 170 });
    // threshold = 165, diff = 165 - 150 = 15, beyond 10 by 5
    // score = 75 - 5*1.5 = 67.5
    expect(scoreLockout(rep, cal)).toBeCloseTo(67.5, 1);
  });

  it('defaults to 175 standing knee angle without calibration', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ kneeAngle: 170 })],
    });
    // standingKnee defaults to 175, threshold = 170, finalKnee = 170 >= 170
    expect(scoreLockout(rep, null)).toBe(100);
  });

  it('returns 50 when no frame angles', () => {
    const rep = makeRepData({ frameAngles: [] });
    expect(scoreLockout(rep, null)).toBe(50);
  });

  it('uses last 5 frames and picks max knee angle', () => {
    const rep = makeRepData({
      frameAngles: [
        // earlier frames ignored (only last 5 used)
        makeFrameAngles({ kneeAngle: 100 }),
        makeFrameAngles({ kneeAngle: 100 }),
        makeFrameAngles({ kneeAngle: 100 }),
        makeFrameAngles({ kneeAngle: 100 }),
        makeFrameAngles({ kneeAngle: 100 }),
        // last 5:
        makeFrameAngles({ kneeAngle: 155 }),
        makeFrameAngles({ kneeAngle: 160 }),
        makeFrameAngles({ kneeAngle: 165 }),
        makeFrameAngles({ kneeAngle: 168 }),
        makeFrameAngles({ kneeAngle: 170 }),
      ],
    });
    // max of last 5 = 170, diff from 170 = 0
    expect(scoreLockout(rep, null)).toBe(100);
  });
});

describe('scoreToGrade', () => {
  it('returns A for score >= 90', () => {
    expect(scoreToGrade(90)).toBe('A');
    expect(scoreToGrade(100)).toBe('A');
  });

  it('returns B for score >= 80', () => {
    expect(scoreToGrade(80)).toBe('B');
    expect(scoreToGrade(89)).toBe('B');
  });

  it('returns C for score >= 70', () => {
    expect(scoreToGrade(70)).toBe('C');
    expect(scoreToGrade(79)).toBe('C');
  });

  it('returns D for score >= 60', () => {
    expect(scoreToGrade(60)).toBe('D');
    expect(scoreToGrade(69)).toBe('D');
  });

  it('returns F for score < 60 (non-beginner)', () => {
    expect(scoreToGrade(59)).toBe('F');
    expect(scoreToGrade(0)).toBe('F');
    expect(scoreToGrade(59, 'intermediate')).toBe('F');
    expect(scoreToGrade(59, 'advanced')).toBe('F');
  });

  it('returns "Keep Working" for score < 60 with beginner level', () => {
    expect(scoreToGrade(59, 'beginner')).toBe('Keep Working');
    expect(scoreToGrade(0, 'beginner')).toBe('Keep Working');
  });
});

describe('redistributeWeights', () => {
  it('sums to 1.0 when a dimension is excluded', () => {
    const result = redistributeWeights(WEIGHTS, 'tempo');
    const total = Object.values(result).reduce((sum, v) => sum + v, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });

  it('sets excluded dimension to 0', () => {
    const result = redistributeWeights(WEIGHTS, 'depth');
    expect(result['depth']).toBe(0);
  });

  it('scales remaining weights proportionally', () => {
    const result = redistributeWeights(WEIGHTS, 'symmetry');
    // symmetry was 0.10, remaining total was 0.90
    // scale = 1.0 / 0.90 = 1.111...
    expect(result['depth']).toBeCloseTo(WEIGHTS.depth * (1.0 / 0.90), 6);
    expect(result['trunk']).toBeCloseTo(WEIGHTS.trunk * (1.0 / 0.90), 6);
  });

  it('returns original weights when excluding non-existent key', () => {
    const result = redistributeWeights(WEIGHTS, 'nonexistent');
    // excludedWeight = 0, so scale = totalRemaining/totalRemaining = 1
    expect(result['depth']).toBe(WEIGHTS.depth);
    // nonexistent gets set to 0
    expect(result['nonexistent']).toBe(0);
  });

  it('preserves all keys except excluded', () => {
    const result = redistributeWeights(WEIGHTS, 'lockout');
    expect(Object.keys(result)).toContain('depth');
    expect(Object.keys(result)).toContain('kneeTracking');
    expect(Object.keys(result)).toContain('trunk');
    expect(Object.keys(result)).toContain('symmetry');
    expect(Object.keys(result)).toContain('tempo');
    expect(Object.keys(result)).toContain('lockout');
  });
});
