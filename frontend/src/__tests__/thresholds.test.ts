/**
 * Threshold boundary tests for the squat form analyzer.
 *
 * Each test exercises the exact boundary value for a threshold, testing
 * just below and just above to verify correct classification/scoring.
 */

import { describe, it, expect } from 'vitest';
import {
  scoreDepth,
  scoreKneeTracking,
  scoreTrunk,
  scoreSymmetry,
  scoreTempo,
  scoreLockout,
  scoreCompetitionLockout,
  DEPTH_THRESHOLDS,
  VALGUS_THRESHOLDS,
  ANGLE_TOLERANCES,
  IDEAL_DESCENT_MIN,
  IDEAL_DESCENT_MAX,
} from '../scorer';
import { detectRepIssues } from '../issues';
import type {
  SquatConfig,
  CalibrationData,
  RepData,
  FrameAngles,
} from '../types';

// ─── Helpers ───

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
    standingKneeAngle: 175,
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
    maxTrunkAngle: 35,
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

// ════════════════════════════════════════════════════════════════════
// 1. Depth thresholds (scoreDepth)
// ════════════════════════════════════════════════════════════════════

describe('Depth threshold boundaries', () => {
  describe('Beginner (threshold=110)', () => {
    const config = makeConfig({ experienceLevel: 'beginner' });

    it('at threshold (110) scores exactly 80', () => {
      expect(scoreDepth(110, config)).toBe(80);
    });

    it('just below threshold (109.9) scores above 80', () => {
      expect(scoreDepth(109.9, config)).toBeGreaterThan(80);
    });

    it('just above threshold (110.1) scores below 80', () => {
      expect(scoreDepth(110.1, config)).toBeLessThan(80);
    });

    it('at threshold-20 (90) scores exactly 100', () => {
      expect(scoreDepth(90, config)).toBe(100);
    });

    it('just above threshold-20 (90.1) scores just below 100', () => {
      expect(scoreDepth(90.1, config)).toBeLessThan(100);
    });

    it('below threshold-20 (89) still scores 100', () => {
      expect(scoreDepth(89, config)).toBe(100);
    });
  });

  describe('Intermediate (threshold=100)', () => {
    const config = makeConfig({ experienceLevel: 'intermediate' });

    it('at threshold (100) scores exactly 80', () => {
      expect(scoreDepth(100, config)).toBe(80);
    });

    it('just below threshold (99.9) scores above 80', () => {
      expect(scoreDepth(99.9, config)).toBeGreaterThan(80);
    });

    it('just above threshold (100.1) scores below 80', () => {
      expect(scoreDepth(100.1, config)).toBeLessThan(80);
    });

    it('at threshold-20 (80) scores exactly 100', () => {
      expect(scoreDepth(80, config)).toBe(100);
    });
  });

  describe('Advanced (threshold=90)', () => {
    const config = makeConfig({ experienceLevel: 'advanced' });

    it('at threshold (90) scores exactly 80', () => {
      expect(scoreDepth(90, config)).toBe(80);
    });

    it('just below threshold (89.9) scores above 80', () => {
      expect(scoreDepth(89.9, config)).toBeGreaterThan(80);
    });

    it('just above threshold (90.1) scores below 80', () => {
      expect(scoreDepth(90.1, config)).toBeLessThan(80);
    });

    it('at threshold-20 (70) scores exactly 100', () => {
      expect(scoreDepth(70, config)).toBe(100);
    });
  });

  describe('Above-threshold degradation formula', () => {
    const config = makeConfig({ experienceLevel: 'beginner' });

    it('1 degree over threshold: score = 80 - 2 = 78', () => {
      expect(scoreDepth(111, config)).toBe(78);
    });

    it('10 degrees over threshold: score = 80 - 20 = 60', () => {
      expect(scoreDepth(120, config)).toBe(60);
    });

    it('40 degrees over threshold: score = 80 - 80 = 0', () => {
      expect(scoreDepth(150, config)).toBe(0);
    });

    it('50 degrees over threshold: clamped at 0', () => {
      expect(scoreDepth(160, config)).toBe(0);
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. FPPA penalty tiers (scoreKneeTracking)
// ════════════════════════════════════════════════════════════════════

describe('FPPA penalty tier boundaries', () => {
  // Use high kneeWidthRatio (0.95+) so baseline score=100, then test FPPA impact
  const config = makeConfig({ experienceLevel: 'beginner' });

  function repWithFppa(fppaValue: number): RepData {
    return makeRepData({
      kneeValgus: false,
      frameAngles: [
        makeFrameAngles({ kneeWidthRatio: 0.96, fppa: fppaValue }),
      ],
    });
  }

  it('FPPA=10 (at boundary): no penalty', () => {
    const score = scoreKneeTracking(repWithFppa(10), config);
    expect(score).toBe(100);
  });

  it('FPPA=10.01 (just above 10): minor penalty of -5', () => {
    const score = scoreKneeTracking(repWithFppa(10.01), config);
    expect(score).toBe(95);
  });

  it('FPPA=15 (at boundary): still minor penalty of -5', () => {
    const score = scoreKneeTracking(repWithFppa(15), config);
    expect(score).toBe(95);
  });

  it('FPPA=15.01 (just above 15): moderate penalty of -15', () => {
    const score = scoreKneeTracking(repWithFppa(15.01), config);
    expect(score).toBe(85);
  });

  it('FPPA=20 (at boundary): still moderate penalty of -15', () => {
    const score = scoreKneeTracking(repWithFppa(20), config);
    expect(score).toBe(85);
  });

  it('FPPA=20.01 (just above 20): high penalty of -25', () => {
    const score = scoreKneeTracking(repWithFppa(20.01), config);
    expect(score).toBe(75);
  });

  it('FPPA=0: no penalty (good range)', () => {
    const score = scoreKneeTracking(repWithFppa(0), config);
    expect(score).toBe(100);
  });

  it('FPPA=5: no penalty (within 0-10 good range)', () => {
    const score = scoreKneeTracking(repWithFppa(5), config);
    expect(score).toBe(100);
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. Valgus ratio thresholds (scoreKneeTracking)
// ════════════════════════════════════════════════════════════════════

describe('Valgus ratio threshold boundaries', () => {
  function repWithKneeWidth(ratio: number): RepData {
    return makeRepData({
      kneeValgus: false,
      frameAngles: [makeFrameAngles({ kneeWidthRatio: ratio })],
    });
  }

  describe('Beginner (valgusThreshold=0.70)', () => {
    const config = makeConfig({ experienceLevel: 'beginner' });

    it('at 0.95: perfect score (100)', () => {
      expect(scoreKneeTracking(repWithKneeWidth(0.95), config)).toBe(100);
    });

    it('just below 0.95 (0.949): interpolated below 100', () => {
      const score = scoreKneeTracking(repWithKneeWidth(0.949), config);
      expect(score).toBeLessThan(100);
      expect(score).toBeGreaterThan(80);
    });

    it('at threshold (0.70): score equals 80', () => {
      // frac = (0.95 - 0.70) / (0.95 - 0.70) = 1.0, score = 100 - 1.0*20 = 80
      expect(scoreKneeTracking(repWithKneeWidth(0.70), config)).toBe(80);
    });

    it('just above threshold (0.701): score just above 80', () => {
      const score = scoreKneeTracking(repWithKneeWidth(0.701), config);
      expect(score).toBeGreaterThan(79.9);
      expect(score).toBeLessThanOrEqual(80.1);
    });

    it('just below threshold (0.699): enters penalty zone below 80', () => {
      const score = scoreKneeTracking(repWithKneeWidth(0.699), config);
      expect(score).toBeLessThan(80);
    });
  });

  describe('Intermediate (valgusThreshold=0.75)', () => {
    const config = makeConfig({ experienceLevel: 'intermediate' });

    it('at threshold (0.75): score equals 80', () => {
      expect(scoreKneeTracking(repWithKneeWidth(0.75), config)).toBe(80);
    });

    it('just above threshold (0.751): score just above 80', () => {
      const score = scoreKneeTracking(repWithKneeWidth(0.751), config);
      expect(score).toBeGreaterThan(79.9);
    });

    it('just below threshold (0.749): enters penalty zone below 80', () => {
      const score = scoreKneeTracking(repWithKneeWidth(0.749), config);
      expect(score).toBeLessThan(80);
    });
  });

  describe('Advanced (valgusThreshold=0.80)', () => {
    const config = makeConfig({ experienceLevel: 'advanced' });

    it('at threshold (0.80): score equals 80', () => {
      expect(scoreKneeTracking(repWithKneeWidth(0.80), config)).toBe(80);
    });

    it('just above threshold (0.801): score just above 80', () => {
      const score = scoreKneeTracking(repWithKneeWidth(0.801), config);
      expect(score).toBeGreaterThan(79.9);
    });

    it('just below threshold (0.799): enters penalty zone below 80', () => {
      const score = scoreKneeTracking(repWithKneeWidth(0.799), config);
      expect(score).toBeLessThan(80);
    });
  });

  describe('Below-threshold penalty formula (distance * 150)', () => {
    const config = makeConfig({ experienceLevel: 'beginner' });

    it('0.10 below threshold: score = 80 - 0.10*150 = 65', () => {
      // beginner threshold = 0.70, ratio = 0.60
      expect(scoreKneeTracking(repWithKneeWidth(0.60), config)).toBe(65);
    });

    it('far below threshold: clamped at 0', () => {
      expect(scoreKneeTracking(repWithKneeWidth(0.10), config)).toBe(0);
    });
  });

  describe('kneeValgus flag applies -5 penalty', () => {
    const config = makeConfig({ experienceLevel: 'beginner' });

    it('perfect ratio with kneeValgus flag: 100 - 5 = 95', () => {
      const rep = makeRepData({
        kneeValgus: true,
        frameAngles: [makeFrameAngles({ kneeWidthRatio: 0.96 })],
      });
      expect(scoreKneeTracking(rep, config)).toBe(95);
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. Symmetry bands (scoreSymmetry)
// ════════════════════════════════════════════════════════════════════

describe('Symmetry band boundaries', () => {
  function repWithSymmetry(value: number): RepData {
    return makeRepData({
      frameAngles: [makeFrameAngles({ hipSymmetry: value })],
    });
  }

  describe('Band 1: <0.05 = 100', () => {
    it('at 0.049 (just below 0.05): score is 100', () => {
      expect(scoreSymmetry(repWithSymmetry(0.049))).toBe(100);
    });

    it('at exactly 0.05: enters interpolation band (below 100)', () => {
      // maxAsymmetry = 0.05, NOT < 0.05, so enters second band
      // frac = (0.05 - 0.05) / 0.05 = 0, score = 100 - 0*15 = 100
      expect(scoreSymmetry(repWithSymmetry(0.05))).toBe(100);
    });

    it('at 0.0501 (just above 0.05): slightly below 100', () => {
      const score = scoreSymmetry(repWithSymmetry(0.0501));
      // frac = (0.0501 - 0.05) / 0.05 = 0.002, score = 100 - 0.002*15 = 99.97
      expect(score).toBeLessThan(100);
      expect(score).toBeCloseTo(99.97, 1);
    });
  });

  describe('Band 2: 0.05-0.10 interpolated (100 to 85)', () => {
    it('at 0.075 (midpoint): score = 92.5', () => {
      // frac = (0.075 - 0.05) / 0.05 = 0.5, score = 100 - 0.5*15 = 92.5
      expect(scoreSymmetry(repWithSymmetry(0.075))).toBeCloseTo(92.5, 1);
    });

    it('at 0.099 (just below 0.10): score near 85', () => {
      // frac = (0.099 - 0.05) / 0.05 = 0.98, score = 100 - 0.98*15 = 85.3
      const score = scoreSymmetry(repWithSymmetry(0.099));
      expect(score).toBeCloseTo(85.3, 0);
    });

    it('at exactly 0.10: enters third band, score = 85', () => {
      // 0.10 is NOT < 0.10, so enters third band
      // frac = (0.10 - 0.10) / 0.10 = 0, score = 85 - 0*25 = 85
      expect(scoreSymmetry(repWithSymmetry(0.10))).toBe(85);
    });
  });

  describe('Band 3: 0.10-0.20 interpolated (85 to 60)', () => {
    it('at 0.15 (midpoint): score = 72.5', () => {
      // frac = (0.15 - 0.10) / 0.10 = 0.5, score = 85 - 0.5*25 = 72.5
      expect(scoreSymmetry(repWithSymmetry(0.15))).toBeCloseTo(72.5, 1);
    });

    it('at 0.199 (just below 0.20): score near 60', () => {
      // frac = (0.199 - 0.10) / 0.10 = 0.99, score = 85 - 0.99*25 = 60.25
      const score = scoreSymmetry(repWithSymmetry(0.199));
      expect(score).toBeCloseTo(60.25, 0);
    });

    it('at exactly 0.20: enters fourth band, score = 60', () => {
      // 0.20 is NOT < 0.20, so enters fourth band
      // score = 60 - (0.20 - 0.20) * 100 = 60
      expect(scoreSymmetry(repWithSymmetry(0.20))).toBe(60);
    });
  });

  describe('Band 4: >0.20 degrades from 60', () => {
    it('at 0.25: score = 60 - 5 = 55', () => {
      // score = 60 - (0.25 - 0.20) * 100 = 60 - 5 = 55
      expect(scoreSymmetry(repWithSymmetry(0.25))).toBe(55);
    });

    it('at 0.80: clamped at 0', () => {
      // score = 60 - (0.80 - 0.20) * 100 = 60 - 60 = 0
      expect(scoreSymmetry(repWithSymmetry(0.80))).toBe(0);
    });

    it('at 1.0: clamped at 0', () => {
      expect(scoreSymmetry(repWithSymmetry(1.0))).toBe(0);
    });
  });

  it('no symmetry data returns 90', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ hipSymmetry: null })],
    });
    expect(scoreSymmetry(rep)).toBe(90);
  });
});

// ════════════════════════════════════════════════════════════════════
// 5. Tempo thresholds (scoreTempo)
// ════════════════════════════════════════════════════════════════════

describe('Tempo threshold boundaries', () => {
  // All tests use ideal values for non-tested parameters

  describe('Descent min boundary (1.0s)', () => {
    it('at exactly IDEAL_DESCENT_MIN (1.0): no penalty', () => {
      expect(scoreTempo(1.0, 0.5, 1.0)).toBe(100);
    });

    it('just below IDEAL_DESCENT_MIN (0.99): penalty applied', () => {
      // penalty = min(20, (1.0 - 0.99) * 20) = 0.2
      const score = scoreTempo(0.99, 0.5, 1.0);
      expect(score).toBeLessThan(100);
      expect(score).toBeCloseTo(99.8, 1);
    });

    it('far below IDEAL_DESCENT_MIN (0.0): max penalty of 20', () => {
      // penalty = min(20, (1.0 - 0.0) * 20) = min(20, 20) = 20
      expect(scoreTempo(0.0, 0.5, 1.0)).toBe(80);
    });
  });

  describe('Descent max boundary (4.0s)', () => {
    it('at exactly IDEAL_DESCENT_MAX (4.0): no penalty', () => {
      expect(scoreTempo(4.0, 0.5, 1.0)).toBe(100);
    });

    it('just above IDEAL_DESCENT_MAX (4.01): penalty applied', () => {
      // penalty = min(10, (4.01 - 4.0) * 5) = 0.05
      const score = scoreTempo(4.01, 0.5, 1.0);
      expect(score).toBeLessThan(100);
      expect(score).toBeCloseTo(99.95, 1);
    });

    it('far above IDEAL_DESCENT_MAX (6.0): max penalty of 10', () => {
      // penalty = min(10, (6.0 - 4.0) * 5) = min(10, 10) = 10
      expect(scoreTempo(6.0, 0.5, 1.0)).toBe(90);
    });

    it('very far above max: penalty capped at 10', () => {
      // penalty = min(10, (20.0 - 4.0) * 5) = min(10, 80) = 10
      expect(scoreTempo(20.0, 0.5, 1.0)).toBe(90);
    });
  });

  describe('Bottom pause lower boundary (0.1s)', () => {
    it('at exactly 0.1: no penalty', () => {
      expect(scoreTempo(2.0, 0.1, 1.0)).toBe(100);
    });

    it('just below 0.1 (0.099): bouncing penalty of -10', () => {
      expect(scoreTempo(2.0, 0.099, 1.0)).toBe(90);
    });

    it('at 0.0: bouncing penalty of -10', () => {
      expect(scoreTempo(2.0, 0.0, 1.0)).toBe(90);
    });
  });

  describe('Bottom pause upper boundary (1.5s)', () => {
    it('at exactly 1.5: no penalty', () => {
      expect(scoreTempo(2.0, 1.5, 1.0)).toBe(100);
    });

    it('just above 1.5 (1.51): gradual penalty', () => {
      // penalty = min(10, (1.51 - 1.5) * 5) = 0.05
      const score = scoreTempo(2.0, 1.51, 1.0);
      expect(score).toBeLessThan(100);
      expect(score).toBeCloseTo(99.95, 1);
    });

    it('far above 1.5 (3.5): max penalty of 10', () => {
      // penalty = min(10, (3.5 - 1.5) * 5) = min(10, 10) = 10
      expect(scoreTempo(2.0, 3.5, 1.0)).toBe(90);
    });
  });

  describe('Fast ascent boundary (0.2s)', () => {
    it('at exactly 0.2: no penalty', () => {
      expect(scoreTempo(2.0, 0.5, 0.2)).toBe(100);
    });

    it('just below 0.2 (0.19): penalty of -5', () => {
      expect(scoreTempo(2.0, 0.5, 0.19)).toBe(95);
    });

    it('at 0.0: penalty of -5', () => {
      expect(scoreTempo(2.0, 0.5, 0.0)).toBe(95);
    });
  });

  describe('Multiple penalties accumulate', () => {
    it('too fast descent + bouncing + fast ascent', () => {
      // descent 0.0: penalty = min(20, 1.0*20) = 20
      // bottom 0.0: penalty = 10
      // ascent 0.0: penalty = 5
      // total = 100 - 35 = 65
      expect(scoreTempo(0.0, 0.0, 0.0)).toBe(65);
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// 6. Lockout threshold (scoreLockout) -- standing knee angle - 5
// ════════════════════════════════════════════════════════════════════

describe('Lockout threshold boundaries', () => {
  const cal = makeCalibration({ standingKneeAngle: 175 });
  // Effective threshold = 175 - 5 = 170

  function repWithFinalKnee(angle: number): RepData {
    return makeRepData({
      frameAngles: [makeFrameAngles({ kneeAngle: angle })],
    });
  }

  it('at threshold (170): score is 100', () => {
    expect(scoreLockout(repWithFinalKnee(170), cal)).toBe(100);
  });

  it('above threshold (172): score is 100', () => {
    expect(scoreLockout(repWithFinalKnee(172), cal)).toBe(100);
  });

  it('just below threshold (169.9): score just below 100', () => {
    const score = scoreLockout(repWithFinalKnee(169.9), cal);
    // diff = 170 - 169.9 = 0.1, frac = 0.1/10 = 0.01, score = 100 - 0.01*25 = 99.75
    expect(score).toBeLessThan(100);
    expect(score).toBeCloseTo(99.75, 1);
  });

  it('10 degrees below threshold (160): score is 75', () => {
    // diff = 170 - 160 = 10, frac = 10/10 = 1.0, score = 100 - 1.0*25 = 75
    expect(scoreLockout(repWithFinalKnee(160), cal)).toBe(75);
  });

  it('11 degrees below threshold (159): enters degradation zone', () => {
    // diff = 170 - 159 = 11, beyond 10 by 1, score = 75 - 1*1.5 = 73.5
    expect(scoreLockout(repWithFinalKnee(159), cal)).toBeCloseTo(73.5, 1);
  });

  it('without calibration defaults to standingKnee=175', () => {
    // threshold = 175 - 5 = 170
    expect(scoreLockout(repWithFinalKnee(170), null)).toBe(100);
    expect(scoreLockout(repWithFinalKnee(169), null)).toBeLessThan(100);
  });

  it('uses max of last 5 frames', () => {
    const rep = makeRepData({
      frameAngles: [
        makeFrameAngles({ kneeAngle: 100 }),
        makeFrameAngles({ kneeAngle: 100 }),
        makeFrameAngles({ kneeAngle: 100 }),
        makeFrameAngles({ kneeAngle: 150 }),
        makeFrameAngles({ kneeAngle: 160 }),
        makeFrameAngles({ kneeAngle: 165 }),
        makeFrameAngles({ kneeAngle: 170 }),
        makeFrameAngles({ kneeAngle: 168 }),
      ],
    });
    // last 5: [160, 165, 170, 168] => wait, 8 frames, last 5 = indices 3-7
    // last 5: [150, 160, 165, 170, 168], max = 170 >= 170 => score = 100
    expect(scoreLockout(rep, cal)).toBe(100);
  });
});

// ════════════════════════════════════════════════════════════════════
// 7. Trunk angle tolerance bands (scoreTrunk)
// ════════════════════════════════════════════════════════════════════

describe('Trunk angle tolerance band boundaries', () => {
  // bodyweight range = [25, 45], no calibration (femurTibiaRatio=1.0 => no adjustment)

  describe('Within expected range', () => {
    const config = makeConfig({ experienceLevel: 'beginner' });

    it('at min expected (25): score is 100', () => {
      expect(scoreTrunk(25, config, null)).toBe(100);
    });

    it('at max expected (45): score is 100', () => {
      expect(scoreTrunk(45, config, null)).toBe(100);
    });

    it('within range (35): score is 100', () => {
      expect(scoreTrunk(35, config, null)).toBe(100);
    });
  });

  describe('Beginner tolerance (20 degrees)', () => {
    const config = makeConfig({ experienceLevel: 'beginner' });

    it('1 degree above maxExpected (46): slight penalty', () => {
      // deviation = 1, within tolerance(20)
      // score = 100 - (1/20)*15 = 100 - 0.75 = 99.25
      expect(scoreTrunk(46, config, null)).toBeCloseTo(99.25, 1);
    });

    it('at tolerance boundary (45+20=65): score is 85', () => {
      // deviation = 20, exactly at tolerance
      // score = 100 - (20/20)*15 = 100 - 15 = 85
      expect(scoreTrunk(65, config, null)).toBe(85);
    });

    it('just beyond tolerance (66): enters degradation', () => {
      // deviation = 21, beyond tolerance by 1
      // score = 85 - 1*1.5 = 83.5
      expect(scoreTrunk(66, config, null)).toBeCloseTo(83.5, 1);
    });

    it('1 degree below minExpected (24): slight penalty', () => {
      // deviation = 1 from min
      // score = 100 - (1/20)*15 = 99.25
      expect(scoreTrunk(24, config, null)).toBeCloseTo(99.25, 1);
    });
  });

  describe('Advanced tolerance (10 degrees)', () => {
    const config = makeConfig({ experienceLevel: 'advanced' });

    it('at tolerance boundary (45+10=55): score is 85', () => {
      expect(scoreTrunk(55, config, null)).toBe(85);
    });

    it('just beyond tolerance (56): enters degradation', () => {
      // deviation = 11, beyond tolerance(10) by 1
      // score = 85 - 1*1.5 = 83.5
      expect(scoreTrunk(56, config, null)).toBeCloseTo(83.5, 1);
    });
  });

  describe('Intermediate tolerance (15 degrees)', () => {
    const config = makeConfig({ experienceLevel: 'intermediate' });

    it('at tolerance boundary (45+15=60): score is 85', () => {
      expect(scoreTrunk(60, config, null)).toBe(85);
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// 8. Butt wink threshold (analyzer.ts: pelvicTiltAtBottom > 8)
// ════════════════════════════════════════════════════════════════════

describe('Butt wink threshold boundaries (pelvicTiltAtBottom > 8)', () => {
  const config = makeConfig({ experienceLevel: 'beginner' });

  it('at 7.9 degrees: no butt_wink issue', () => {
    const rep = makeRepData({
      buttWink: false,
      pelvicTiltAtBottom: 7.9,
    });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'butt_wink')).toBeUndefined();
  });

  it('at exactly 8.0 degrees: no butt_wink issue (not > 8)', () => {
    const rep = makeRepData({
      buttWink: false,
      pelvicTiltAtBottom: 8.0,
    });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'butt_wink')).toBeUndefined();
  });

  it('at 8.1 degrees: butt_wink issue triggered', () => {
    const rep = makeRepData({
      buttWink: true,
      pelvicTiltAtBottom: 8.1,
    });
    const issues = detectRepIssues(rep, config, null);
    const bwIssue = issues.find(i => i.name === 'butt_wink');
    expect(bwIssue).toBeDefined();
    expect(bwIssue!.severity).toBe('moderate');
    expect(bwIssue!.threshold).toBe(8);
  });

  it('at 20 degrees: butt_wink issue triggered', () => {
    const rep = makeRepData({
      buttWink: true,
      pelvicTiltAtBottom: 20,
    });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'butt_wink')).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════
// 9. Heel rise threshold (analyzer.ts: legLength * 0.035)
// ════════════════════════════════════════════════════════════════════

describe('Heel rise threshold boundaries (3.5% of leg length, 3 consecutive frames)', () => {
  const config = makeConfig({ experienceLevel: 'beginner' });

  it('heelRise=false when below threshold: no issue', () => {
    const rep = makeRepData({ heelRise: false });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'heel_rise')).toBeUndefined();
  });

  it('heelRise=true: issue triggered', () => {
    const rep = makeRepData({ heelRise: true });
    const issues = detectRepIssues(rep, config, null);
    const hrIssue = issues.find(i => i.name === 'heel_rise');
    expect(hrIssue).toBeDefined();
    expect(hrIssue!.severity).toBe('moderate');
  });

  // Note: The actual heel rise detection (3.5% threshold + 3 consecutive frames)
  // happens in buildRepData in analyzer.ts which requires full landmark data.
  // We test the threshold detection behavior through the boolean flag.
  it('heelRise flag correctly propagates to issues', () => {
    const rep = makeRepData({ heelRise: true });
    const issues = detectRepIssues(rep, config, null);
    const hrIssue = issues.find(i => i.name === 'heel_rise');
    expect(hrIssue).toBeDefined();
    expect(hrIssue!.value).toBe(1);
    expect(hrIssue!.threshold).toBe(0);
    expect(hrIssue!.phase).toBe('descending');
  });
});

// ════════════════════════════════════════════════════════════════════
// 10. Good morning pattern (analyzer.ts: hip extension > 1.5x knee extension)
// ════════════════════════════════════════════════════════════════════

describe('Good morning pattern threshold boundaries', () => {
  const config = makeConfig({ experienceLevel: 'beginner' });

  describe('Trunk angle change thresholds', () => {
    it('trunkAngleChangeOnAscent at 14.9 (below 15 for non-low-bar): no issue', () => {
      const rep = makeRepData({
        goodMorning: false,
        trunkAngleChangeOnAscent: 14.9,
      });
      const issues = detectRepIssues(rep, config, null);
      expect(issues.find(i => i.name === 'good_morning')).toBeUndefined();
    });

    it('trunkAngleChangeOnAscent at 15.0 (at threshold for non-low-bar): no issue (not > 15)', () => {
      const rep = makeRepData({
        goodMorning: false,
        trunkAngleChangeOnAscent: 15.0,
      });
      const issues = detectRepIssues(rep, config, null);
      expect(issues.find(i => i.name === 'good_morning')).toBeUndefined();
    });

    it('trunkAngleChangeOnAscent at 15.1 (above threshold): issue triggered', () => {
      const rep = makeRepData({
        goodMorning: true,
        trunkAngleChangeOnAscent: 15.1,
      });
      const issues = detectRepIssues(rep, config, null);
      const gmIssue = issues.find(i => i.name === 'good_morning');
      expect(gmIssue).toBeDefined();
      expect(gmIssue!.threshold).toBe(15);
    });
  });

  describe('Low-bar squat has higher threshold (20 degrees)', () => {
    const lowBarConfig = makeConfig({ squatType: 'low_bar', experienceLevel: 'beginner' });

    it('trunkAngleChangeOnAscent at 19.9 (below 20): no issue', () => {
      const rep = makeRepData({
        goodMorning: false,
        trunkAngleChangeOnAscent: 19.9,
      });
      const issues = detectRepIssues(rep, lowBarConfig, null);
      expect(issues.find(i => i.name === 'good_morning')).toBeUndefined();
    });

    it('trunkAngleChangeOnAscent at 20.0: no issue (not > 20)', () => {
      const rep = makeRepData({
        goodMorning: false,
        trunkAngleChangeOnAscent: 20.0,
      });
      const issues = detectRepIssues(rep, lowBarConfig, null);
      expect(issues.find(i => i.name === 'good_morning')).toBeUndefined();
    });

    it('trunkAngleChangeOnAscent at 20.1: issue triggered', () => {
      const rep = makeRepData({
        goodMorning: true,
        trunkAngleChangeOnAscent: 20.1,
      });
      const issues = detectRepIssues(rep, lowBarConfig, null);
      const gmIssue = issues.find(i => i.name === 'good_morning');
      expect(gmIssue).toBeDefined();
      expect(gmIssue!.threshold).toBe(20);
    });
  });

  describe('Severity tiers for good morning pattern', () => {
    const config2 = makeConfig({ experienceLevel: 'beginner' });

    it('just above threshold: severity is MODERATE', () => {
      const rep = makeRepData({
        goodMorning: true,
        trunkAngleChangeOnAscent: 16,
      });
      const issues = detectRepIssues(rep, config2, null);
      const gmIssue = issues.find(i => i.name === 'good_morning');
      expect(gmIssue).toBeDefined();
      expect(gmIssue!.severity).toBe('moderate');
    });

    it('threshold + 15.1 (>30.1 for non-low-bar): severity is HIGH', () => {
      const rep = makeRepData({
        goodMorning: true,
        trunkAngleChangeOnAscent: 30.1,
      });
      const issues = detectRepIssues(rep, config2, null);
      const gmIssue = issues.find(i => i.name === 'good_morning');
      expect(gmIssue).toBeDefined();
      expect(gmIssue!.severity).toBe('high');
    });

    it('at threshold + 15 (=30 for non-low-bar): severity is still MODERATE', () => {
      const rep = makeRepData({
        goodMorning: true,
        trunkAngleChangeOnAscent: 30.0,
      });
      const issues = detectRepIssues(rep, config2, null);
      const gmIssue = issues.find(i => i.name === 'good_morning');
      expect(gmIssue).toBeDefined();
      expect(gmIssue!.severity).toBe('moderate');
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// 11. Asymmetry by experience (issues.ts)
// ════════════════════════════════════════════════════════════════════

describe('Asymmetry threshold boundaries by experience level', () => {
  function repWithAsymmetry(value: number): RepData {
    return makeRepData({
      frameAngles: [makeFrameAngles({ hipSymmetry: value })],
    });
  }

  describe('Beginner (threshold=0.10)', () => {
    const config = makeConfig({ experienceLevel: 'beginner' });

    it('at 0.099 (below threshold): no asymmetric_shift issue', () => {
      const issues = detectRepIssues(repWithAsymmetry(0.099), config, null);
      expect(issues.find(i => i.name === 'asymmetric_shift')).toBeUndefined();
    });

    it('at exactly 0.10: no issue (not > 0.10)', () => {
      const issues = detectRepIssues(repWithAsymmetry(0.10), config, null);
      expect(issues.find(i => i.name === 'asymmetric_shift')).toBeUndefined();
    });

    it('at 0.101 (above threshold): asymmetric_shift issue', () => {
      const issues = detectRepIssues(repWithAsymmetry(0.101), config, null);
      const issue = issues.find(i => i.name === 'asymmetric_shift');
      expect(issue).toBeDefined();
      expect(issue!.threshold).toBe(0.10);
    });
  });

  describe('Intermediate (threshold=0.07)', () => {
    const config = makeConfig({ experienceLevel: 'intermediate' });

    it('at 0.069 (below threshold): no asymmetric_shift issue', () => {
      const issues = detectRepIssues(repWithAsymmetry(0.069), config, null);
      expect(issues.find(i => i.name === 'asymmetric_shift')).toBeUndefined();
    });

    it('at exactly 0.07: no issue (not > 0.07)', () => {
      const issues = detectRepIssues(repWithAsymmetry(0.07), config, null);
      expect(issues.find(i => i.name === 'asymmetric_shift')).toBeUndefined();
    });

    it('at 0.071 (above threshold): asymmetric_shift issue', () => {
      const issues = detectRepIssues(repWithAsymmetry(0.071), config, null);
      const issue = issues.find(i => i.name === 'asymmetric_shift');
      expect(issue).toBeDefined();
      expect(issue!.threshold).toBe(0.07);
    });
  });

  describe('Advanced (threshold=0.05)', () => {
    const config = makeConfig({ experienceLevel: 'advanced' });

    it('at 0.049 (below threshold): no asymmetric_shift issue', () => {
      const issues = detectRepIssues(repWithAsymmetry(0.049), config, null);
      expect(issues.find(i => i.name === 'asymmetric_shift')).toBeUndefined();
    });

    it('at exactly 0.05: no issue (not > 0.05)', () => {
      const issues = detectRepIssues(repWithAsymmetry(0.05), config, null);
      expect(issues.find(i => i.name === 'asymmetric_shift')).toBeUndefined();
    });

    it('at 0.051 (above threshold): asymmetric_shift issue', () => {
      const issues = detectRepIssues(repWithAsymmetry(0.051), config, null);
      const issue = issues.find(i => i.name === 'asymmetric_shift');
      expect(issue).toBeDefined();
      expect(issue!.threshold).toBe(0.05);
    });
  });

  describe('Asymmetry severity tiers', () => {
    const config = makeConfig({ experienceLevel: 'beginner' });

    it('at 0.29 (below 0.30): severity is LOW', () => {
      const issues = detectRepIssues(repWithAsymmetry(0.29), config, null);
      const issue = issues.find(i => i.name === 'asymmetric_shift');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('low');
    });

    it('at 0.31 (above 0.30): severity is MODERATE', () => {
      const issues = detectRepIssues(repWithAsymmetry(0.31), config, null);
      const issue = issues.find(i => i.name === 'asymmetric_shift');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('moderate');
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// Additional boundary tests: Competition lockout, depth issue severity
// ════════════════════════════════════════════════════════════════════

describe('Competition lockout boundaries', () => {
  const cal = makeCalibration({ standingKneeAngle: 175 });

  function repWithFinalKnee(angle: number): RepData {
    return makeRepData({
      frameAngles: [makeFrameAngles({ kneeAngle: angle })],
    });
  }

  it('diff <= 3.0: score = 100', () => {
    expect(scoreCompetitionLockout(repWithFinalKnee(172), cal)).toBe(100);
    expect(scoreCompetitionLockout(repWithFinalKnee(175), cal)).toBe(100);
    expect(scoreCompetitionLockout(repWithFinalKnee(178), cal)).toBe(100);
  });

  it('diff = 3.01: score = 80', () => {
    // standingKnee=175, diff=|171.99-175|=3.01 > 3.0
    expect(scoreCompetitionLockout(repWithFinalKnee(171.99), cal)).toBe(80);
  });

  it('diff <= 5.0: score = 80', () => {
    expect(scoreCompetitionLockout(repWithFinalKnee(170), cal)).toBe(80);
  });

  it('diff = 5.01: score = 50', () => {
    expect(scoreCompetitionLockout(repWithFinalKnee(169.99), cal)).toBe(50);
  });

  it('diff <= 10.0: score = 50', () => {
    expect(scoreCompetitionLockout(repWithFinalKnee(165), cal)).toBe(50);
  });

  it('diff = 10.01: score = 20', () => {
    expect(scoreCompetitionLockout(repWithFinalKnee(164.99), cal)).toBe(20);
  });

  it('empty frames: score = 30', () => {
    const rep = makeRepData({ frameAngles: [] });
    expect(scoreCompetitionLockout(rep, cal)).toBe(30);
  });
});

describe('Depth issue severity boundaries', () => {
  const config = makeConfig({ experienceLevel: 'beginner' });
  // threshold=110

  it('just above threshold (111): LOW severity, "very close" description', () => {
    const rep = makeRepData({ minKneeAngle: 111 });
    const issues = detectRepIssues(rep, config, null);
    const depthIssue = issues.find(i => i.name === 'insufficient_depth');
    expect(depthIssue).toBeDefined();
    expect(depthIssue!.severity).toBe('low');
    expect(depthIssue!.description).toContain('very close');
  });

  it('10-20 over threshold (121): LOW severity, "almost there" description', () => {
    const rep = makeRepData({ minKneeAngle: 121 });
    const issues = detectRepIssues(rep, config, null);
    const depthIssue = issues.find(i => i.name === 'insufficient_depth');
    expect(depthIssue).toBeDefined();
    expect(depthIssue!.severity).toBe('low');
    expect(depthIssue!.description).toContain('Almost there');
  });

  it('>20 over threshold (131): MODERATE severity', () => {
    const rep = makeRepData({ minKneeAngle: 131 });
    const issues = detectRepIssues(rep, config, null);
    const depthIssue = issues.find(i => i.name === 'insufficient_depth');
    expect(depthIssue).toBeDefined();
    expect(depthIssue!.severity).toBe('moderate');
  });

  it('at threshold (110): no depth issue', () => {
    const rep = makeRepData({ minKneeAngle: 110 });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'insufficient_depth')).toBeUndefined();
  });

  it('below threshold (109): no depth issue', () => {
    const rep = makeRepData({ minKneeAngle: 109 });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'insufficient_depth')).toBeUndefined();
  });
});

describe('Bouncing threshold boundary (bottomDuration < 0.10)', () => {
  const config = makeConfig({ experienceLevel: 'beginner' });

  it('at 0.10: no bouncing issue', () => {
    const rep = makeRepData({ bottomDuration: 0.10 });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'bouncing')).toBeUndefined();
  });

  it('at 0.099: bouncing issue triggered', () => {
    const rep = makeRepData({ bottomDuration: 0.099 });
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'bouncing');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('moderate');
  });

  it('at 0.0: bouncing issue triggered', () => {
    const rep = makeRepData({ bottomDuration: 0.0 });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'bouncing')).toBeDefined();
  });

  it('advanced level non-competition: bouncing NOT flagged (stretch reflex is intentional)', () => {
    const advConfig = makeConfig({ experienceLevel: 'advanced' });
    const rep = makeRepData({ bottomDuration: 0.05 });
    const issues = detectRepIssues(rep, advConfig, null);
    const issue = issues.find(i => i.name === 'bouncing');
    expect(issue).toBeUndefined();
  });

  it('advanced level competition mode: bouncing IS flagged as LOW', () => {
    const advConfig = makeConfig({ experienceLevel: 'advanced', competitionMode: true });
    const rep = makeRepData({ bottomDuration: 0.05 });
    const issues = detectRepIssues(rep, advConfig, null);
    const issue = issues.find(i => i.name === 'bouncing');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('low');
  });
});

describe('Fast descent threshold boundary (descentDuration < 1.2)', () => {
  const config = makeConfig({ experienceLevel: 'beginner' });

  it('at 1.2: no fast_descent issue', () => {
    const rep = makeRepData({ descentDuration: 1.2 });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'fast_descent')).toBeUndefined();
  });

  it('at 1.19: fast_descent issue triggered', () => {
    const rep = makeRepData({ descentDuration: 1.19 });
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'fast_descent');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('low');
  });
});

describe('Incomplete lockout threshold boundary (maxLockout < 160)', () => {
  const config = makeConfig({ experienceLevel: 'beginner' });

  it('at 160: no incomplete_lockout issue', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ kneeAngle: 160 })],
    });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'incomplete_lockout')).toBeUndefined();
  });

  it('at 159: incomplete_lockout issue triggered', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ kneeAngle: 159 })],
    });
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'incomplete_lockout');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('low');
  });
});

describe('Excessive forward knee travel (low-bar only, shin > 45)', () => {
  it('low-bar at shinAngle=45: no issue', () => {
    const config = makeConfig({ squatType: 'low_bar', experienceLevel: 'beginner' });
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ shinAngle: 45 })],
    });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'excessive_forward_knee_travel')).toBeUndefined();
  });

  it('low-bar at shinAngle=45.1: issue triggered', () => {
    const config = makeConfig({ squatType: 'low_bar', experienceLevel: 'beginner' });
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ shinAngle: 45.1 })],
    });
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'excessive_forward_knee_travel');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('low');
  });

  it('non-low-bar at shinAngle=50: no issue (only flagged for low-bar)', () => {
    const config = makeConfig({ squatType: 'high_bar', experienceLevel: 'beginner' });
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ shinAngle: 50 })],
    });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'excessive_forward_knee_travel')).toBeUndefined();
  });
});
