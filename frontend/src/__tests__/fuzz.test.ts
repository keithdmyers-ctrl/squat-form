import { describe, it, expect } from 'vitest';
import { calculateAngle, angleFromVertical } from '../angles';
import {
  scoreDepth,
  scoreTrunk,
  scoreSymmetry,
  scoreTempo,
  scoreLockout,
  scoreKneeTracking,
  clamp,
} from '../scorer';
import type { SquatConfig, RepData, FrameAngles } from '../types';

// ── Helpers ──

const FUZZ_ITERATIONS = 100;

/** Generate a random number in [min, max]. */
function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/** Generate a random 3D coordinate tuple. */
function randPoint(scale = 1.0): [number, number, number] {
  return [rand(-scale, scale), rand(-scale, scale), rand(-scale, scale)];
}

function makeConfig(overrides: Partial<SquatConfig> = {}): SquatConfig {
  return {
    squatType: 'bodyweight',
    experienceLevel: 'beginner',
    competitionMode: false,
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

// ── Angle Calculations: Fuzz Tests ──

describe('calculateAngle fuzz tests', () => {
  it('random 3D coordinates always return [0, 180] and never NaN', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const a = randPoint();
      const b = randPoint();
      const c = randPoint();
      const result = calculateAngle(a, b, c);

      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(180);
    }
  });

  it('coincident points (a === b) do not crash', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const p = randPoint();
      const c = randPoint();
      const result = calculateAngle(p, p, c);

      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(180);
    }
  });

  it('coincident points (b === c) do not crash', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const a = randPoint();
      const p = randPoint();
      const result = calculateAngle(a, p, p);

      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(180);
    }
  });

  it('all three points coincident does not crash', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const p = randPoint();
      const result = calculateAngle(p, p, p);

      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(180);
    }
  });

  it('very large coordinates (1e6) produce valid results', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const a = randPoint(1e6);
      const b = randPoint(1e6);
      const c = randPoint(1e6);
      const result = calculateAngle(a, b, c);

      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(180);
    }
  });

  it('very small coordinates (1e-12) produce valid results', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const a = randPoint(1e-12);
      const b = randPoint(1e-12);
      const c = randPoint(1e-12);
      const result = calculateAngle(a, b, c);

      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(180);
    }
  });

  it('zero vectors return 180 (documented behavior)', () => {
    const origin: [number, number, number] = [0, 0, 0];
    const result = calculateAngle(origin, origin, origin);

    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBe(180);
  });
});

// ── angleFromVertical: Fuzz Tests ──

describe('angleFromVertical fuzz tests', () => {
  it('random coordinates always return [0, 180] and never NaN', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const top = randPoint();
      const bottom = randPoint();
      const result = angleFromVertical(top, bottom);

      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(180);
    }
  });

  it('zero-length segment returns 0', () => {
    const p: [number, number, number] = [0.5, 0.3, 0.1];
    const result = angleFromVertical(p, p);

    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBe(0);
  });

  it('very large coordinates produce valid results', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const top = randPoint(1e6);
      const bottom = randPoint(1e6);
      const result = angleFromVertical(top, bottom);

      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(180);
    }
  });

  it('very small coordinates produce valid results', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const top = randPoint(1e-12);
      const bottom = randPoint(1e-12);
      const result = angleFromVertical(top, bottom);

      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(180);
    }
  });
});

// ── Scoring Functions: Fuzz Tests ──

describe('scoreDepth fuzz tests', () => {
  it('random angles [0, 360] always return [0, 100]', () => {
    const levels: Array<'beginner' | 'intermediate' | 'advanced'> = [
      'beginner', 'intermediate', 'advanced',
    ];
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const angle = rand(0, 360);
      const level = levels[Math.floor(Math.random() * levels.length)];
      const config = makeConfig({ experienceLevel: level });
      const result = scoreDepth(angle, config);

      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    }
  });
});

describe('scoreTrunk fuzz tests', () => {
  it('random angles always return [0, 100]', () => {
    const squatTypes: Array<'bodyweight' | 'high_bar' | 'low_bar' | 'front' | 'goblet' | 'overhead'> = [
      'bodyweight', 'high_bar', 'low_bar', 'front', 'goblet', 'overhead',
    ];
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const angle = rand(0, 360);
      const sqType = squatTypes[Math.floor(Math.random() * squatTypes.length)];
      const config = makeConfig({ squatType: sqType });
      const result = scoreTrunk(angle, config, null);

      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    }
  });
});

describe('scoreSymmetry fuzz tests', () => {
  it('random symmetry values [0, 1] always return [0, 100]', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const symmetryValue = rand(0, 1);
      const rep = makeRepData({
        frameAngles: [makeFrameAngles({ hipSymmetry: symmetryValue })],
      });
      const result = scoreSymmetry(rep);

      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    }
  });
});

describe('scoreTempo fuzz tests', () => {
  it('random durations [0, 30] always return [0, 100]', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const descent = rand(0, 30);
      const bottom = rand(0, 30);
      const ascent = rand(0, 30);
      const result = scoreTempo(descent, bottom, ascent);

      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    }
  });
});

describe('scoreLockout fuzz tests', () => {
  it('random knee angles always return [0, 100]', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const kneeAngle = rand(0, 360);
      const rep = makeRepData({
        frameAngles: [makeFrameAngles({ kneeAngle })],
      });
      const result = scoreLockout(rep, null);

      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    }
  });
});

describe('scoreKneeTracking fuzz tests', () => {
  it('random knee width ratios and FPPA always return [0, 100]', () => {
    const levels: Array<'beginner' | 'intermediate' | 'advanced'> = [
      'beginner', 'intermediate', 'advanced',
    ];
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const kneeWidthRatio = rand(0, 2);
      const fppa = rand(0, 45);
      const level = levels[Math.floor(Math.random() * levels.length)];
      const config = makeConfig({ experienceLevel: level });
      const rep = makeRepData({
        frameAngles: [makeFrameAngles({ kneeWidthRatio, fppa })],
        kneeValgus: Math.random() > 0.5,
      });
      const result = scoreKneeTracking(rep, config);

      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    }
  });

  it('null knee width ratio returns valid score', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const config = makeConfig();
      const rep = makeRepData({
        frameAngles: [makeFrameAngles({ kneeWidthRatio: null })],
        kneeValgus: Math.random() > 0.5,
      });
      const result = scoreKneeTracking(rep, config);

      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    }
  });
});

// ── Edge Cases: NaN, Infinity, Negative Inputs ──

describe('edge cases: NaN inputs', () => {
  it('calculateAngle with NaN does not crash', () => {
    const nan: [number, number, number] = [NaN, NaN, NaN];
    const normal: [number, number, number] = [1, 2, 3];

    // NaN propagates through math operations, so the result may be NaN.
    // The key assertion is that these calls do not throw.
    expect(() => calculateAngle(nan, normal, normal)).not.toThrow();
    expect(() => calculateAngle(normal, nan, normal)).not.toThrow();
    expect(() => calculateAngle(normal, normal, nan)).not.toThrow();
    expect(() => calculateAngle(nan, nan, nan)).not.toThrow();

    // All results should be typeof number (NaN is typeof number)
    expect(typeof calculateAngle(nan, normal, normal)).toBe('number');
    expect(typeof calculateAngle(normal, nan, normal)).toBe('number');
    expect(typeof calculateAngle(normal, normal, nan)).toBe('number');
    expect(typeof calculateAngle(nan, nan, nan)).toBe('number');
  });

  it('angleFromVertical with NaN does not crash', () => {
    const nan: [number, number, number] = [NaN, NaN, NaN];
    const normal: [number, number, number] = [1, 2, 3];

    // NaN propagates through math operations, so the result may be NaN.
    // The key assertion is that these calls do not throw.
    expect(() => angleFromVertical(nan, normal)).not.toThrow();
    expect(() => angleFromVertical(normal, nan)).not.toThrow();
    expect(() => angleFromVertical(nan, nan)).not.toThrow();

    expect(typeof angleFromVertical(nan, normal)).toBe('number');
    expect(typeof angleFromVertical(normal, nan)).toBe('number');
    expect(typeof angleFromVertical(nan, nan)).toBe('number');
  });

  it('scoreDepth with NaN does not crash', () => {
    const config = makeConfig();
    const result = scoreDepth(NaN, config);
    // clamp handles NaN -- Math.max/Math.min with NaN returns NaN but the function should not throw
    expect(() => scoreDepth(NaN, config)).not.toThrow();
    expect(typeof result).toBe('number');
  });

  it('scoreTempo with NaN does not crash', () => {
    expect(() => scoreTempo(NaN, NaN, NaN)).not.toThrow();
    const result = scoreTempo(NaN, NaN, NaN);
    expect(typeof result).toBe('number');
  });
});

describe('edge cases: Infinity inputs', () => {
  it('calculateAngle with Infinity does not crash', () => {
    const inf: [number, number, number] = [Infinity, Infinity, Infinity];
    const normal: [number, number, number] = [1, 2, 3];

    expect(() => calculateAngle(inf, normal, normal)).not.toThrow();
    expect(() => calculateAngle(normal, inf, normal)).not.toThrow();
    expect(() => calculateAngle(inf, inf, inf)).not.toThrow();
  });

  it('angleFromVertical with Infinity does not crash', () => {
    const inf: [number, number, number] = [Infinity, 0, 0];
    const normal: [number, number, number] = [1, 2, 3];

    expect(() => angleFromVertical(inf, normal)).not.toThrow();
    expect(() => angleFromVertical(normal, inf)).not.toThrow();
  });

  it('scoreDepth with Infinity does not crash', () => {
    const config = makeConfig();
    expect(() => scoreDepth(Infinity, config)).not.toThrow();
    expect(() => scoreDepth(-Infinity, config)).not.toThrow();
  });

  it('scoreTempo with Infinity does not crash', () => {
    expect(() => scoreTempo(Infinity, Infinity, Infinity)).not.toThrow();
    expect(() => scoreTempo(-Infinity, -Infinity, -Infinity)).not.toThrow();
  });
});

describe('edge cases: negative inputs', () => {
  it('calculateAngle with negative coordinates produces valid output', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const a: [number, number, number] = [rand(-100, 0), rand(-100, 0), rand(-100, 0)];
      const b: [number, number, number] = [rand(-100, 0), rand(-100, 0), rand(-100, 0)];
      const c: [number, number, number] = [rand(-100, 0), rand(-100, 0), rand(-100, 0)];
      const result = calculateAngle(a, b, c);

      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(180);
    }
  });

  it('scoreDepth with negative angles returns valid score', () => {
    const config = makeConfig();
    const result = scoreDepth(-50, config);

    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('scoreTempo with negative durations returns valid score', () => {
    const result = scoreTempo(-1, -1, -1);

    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('scoreSymmetry with negative hipSymmetry returns valid score', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ hipSymmetry: -0.5 })],
    });
    const result = scoreSymmetry(rep);

    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('scoreKneeTracking with negative kneeWidthRatio returns valid score', () => {
    const config = makeConfig();
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ kneeWidthRatio: -0.5 })],
    });
    const result = scoreKneeTracking(rep, config);

    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });
});
