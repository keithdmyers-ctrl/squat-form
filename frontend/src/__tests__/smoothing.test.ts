import { describe, it, expect } from 'vitest';
import { LandmarkSmoother } from '../smoothing';
import type { Point, Landmarks } from '../types';

// ── Helpers ──

function makePoint(x: number, y: number, z: number = 0, visibility: number = 1.0): Point {
  return { x, y, z, visibility };
}

function makeLandmarks(overrides: Record<string, Point> = {}): Landmarks {
  return {
    nose: makePoint(0.5, 0.3),
    left_hip: makePoint(0.45, 0.55),
    right_hip: makePoint(0.55, 0.55),
    left_knee: makePoint(0.44, 0.75),
    right_knee: makePoint(0.56, 0.75),
    left_ankle: makePoint(0.43, 0.95),
    right_ankle: makePoint(0.57, 0.95),
    ...overrides,
  };
}

// ── Constructor ──

describe('LandmarkSmoother', () => {
  describe('constructor', () => {
    it('creates a smoother with default parameters', () => {
      const smoother = new LandmarkSmoother();
      expect(smoother).toBeDefined();
    });

    it('accepts legacy alpha parameter (ignored internally)', () => {
      const smoother = new LandmarkSmoother(0.5);
      expect(smoother).toBeDefined();
    });

    it('accepts custom frequency and filter parameters', () => {
      const smoother = new LandmarkSmoother(0.7, 30, 1.5, 0.01, 1.0);
      expect(smoother).toBeDefined();
    });
  });

  // ── First sample passthrough ──

  describe('first sample', () => {
    it('passes through the first sample unchanged', () => {
      const smoother = new LandmarkSmoother();
      const landmarks = makeLandmarks();
      const result = smoother.smooth(landmarks);

      for (const key of Object.keys(landmarks)) {
        expect(result[key].x).toBeCloseTo(landmarks[key].x, 10);
        expect(result[key].y).toBeCloseTo(landmarks[key].y, 10);
        expect(result[key].z).toBeCloseTo(landmarks[key].z, 10);
      }
    });

    it('preserves visibility on first sample', () => {
      const smoother = new LandmarkSmoother();
      const landmarks = makeLandmarks({ nose: makePoint(0.5, 0.3, 0, 0.95) });
      const result = smoother.smooth(landmarks);
      expect(result.nose.visibility).toBe(0.95);
    });
  });

  // ── Low-pass filtering at rest ──

  describe('low-pass filtering at rest', () => {
    it('stable values converge to the input', () => {
      const smoother = new LandmarkSmoother();
      const point = makeLandmarks();

      // Feed the same landmarks 20 times
      let result: Landmarks = point;
      for (let i = 0; i < 20; i++) {
        result = smoother.smooth(point);
      }

      // After many identical samples, output should be very close to input
      expect(result.nose.x).toBeCloseTo(point.nose.x, 3);
      expect(result.nose.y).toBeCloseTo(point.nose.y, 3);
    });

    it('reduces jitter on noisy but stationary input', () => {
      const smoother = new LandmarkSmoother();
      const baseX = 0.5;
      const results: number[] = [];

      // Feed slightly noisy data around baseX
      for (let i = 0; i < 30; i++) {
        const noise = (Math.random() - 0.5) * 0.02; // +/- 0.01
        const landmarks = makeLandmarks({ nose: makePoint(baseX + noise, 0.3) });
        const result = smoother.smooth(landmarks);
        results.push(result.nose.x);
      }

      // Smoothed output should have less variance than raw noise
      const rawVariance = 0.01; // approx noise amplitude
      const smoothedValues = results.slice(5); // skip initial transient
      const smoothedMean = smoothedValues.reduce((a, b) => a + b, 0) / smoothedValues.length;
      const smoothedStd = Math.sqrt(
        smoothedValues.reduce((s, v) => s + (v - smoothedMean) ** 2, 0) / smoothedValues.length,
      );

      // Smoothed standard deviation should be less than raw noise
      expect(smoothedStd).toBeLessThan(rawVariance);
    });
  });

  // ── Responsive during movement ──

  describe('responsive during movement', () => {
    it('follows a moving signal with low lag', () => {
      const smoother = new LandmarkSmoother(0.7, 15, 1.0, 0.007, 1.0);

      // Move from x=0.3 to x=0.7 over 10 frames
      for (let i = 0; i < 5; i++) {
        smoother.smooth(makeLandmarks({ nose: makePoint(0.3, 0.3) }));
      }

      // Now move quickly
      let result: Landmarks = makeLandmarks();
      for (let i = 0; i < 10; i++) {
        const x = 0.3 + (0.4 * (i + 1)) / 10;
        result = smoother.smooth(makeLandmarks({ nose: makePoint(x, 0.3) }));
      }

      // After moving to 0.7 over 10 frames, smoothed value should be close
      expect(result.nose.x).toBeGreaterThan(0.55);
    });

    it('does not smooth visibility', () => {
      const smoother = new LandmarkSmoother();

      // First frame with high visibility
      smoother.smooth(makeLandmarks({ nose: makePoint(0.5, 0.3, 0, 1.0) }));

      // Second frame with low visibility - should pass through directly
      const result = smoother.smooth(makeLandmarks({ nose: makePoint(0.5, 0.3, 0, 0.2) }));
      expect(result.nose.visibility).toBe(0.2);
    });
  });

  // ── Multiple landmarks ──

  describe('multiple landmarks', () => {
    it('smooths each landmark independently', () => {
      const smoother = new LandmarkSmoother();

      // First sample
      smoother.smooth(makeLandmarks({
        nose: makePoint(0.5, 0.3),
        left_knee: makePoint(0.4, 0.7),
      }));

      // Second sample with different movements per landmark
      const result = smoother.smooth(makeLandmarks({
        nose: makePoint(0.5, 0.3), // nose stays still
        left_knee: makePoint(0.3, 0.7), // knee moves a lot
      }));

      // Nose should be close to original (barely moved)
      expect(result.nose.x).toBeCloseTo(0.5, 1);
      // Knee should be somewhere between old and new
      expect(result.left_knee.x).toBeLessThan(0.4);
      expect(result.left_knee.x).toBeGreaterThan(0.29);
    });

    it('handles new landmarks appearing mid-stream', () => {
      const smoother = new LandmarkSmoother();

      // First frame only has nose
      smoother.smooth({ nose: makePoint(0.5, 0.3) });

      // Second frame has nose + new landmark
      const result = smoother.smooth({
        nose: makePoint(0.5, 0.3),
        left_wrist: makePoint(0.2, 0.4),
      });

      // New landmark should pass through on first appearance
      expect(result.left_wrist.x).toBeCloseTo(0.2, 10);
    });
  });

  // ── reset ──

  describe('reset', () => {
    it('clears all filter state', () => {
      const smoother = new LandmarkSmoother();

      // Build up filter state
      for (let i = 0; i < 10; i++) {
        smoother.smooth(makeLandmarks({ nose: makePoint(0.5, 0.3) }));
      }

      smoother.reset();

      // After reset, feeding a very different value should pass through (first sample behavior)
      const result = smoother.smooth(makeLandmarks({ nose: makePoint(0.9, 0.8) }));
      expect(result.nose.x).toBeCloseTo(0.9, 10);
      expect(result.nose.y).toBeCloseTo(0.8, 10);
    });

    it('can be called multiple times safely', () => {
      const smoother = new LandmarkSmoother();
      smoother.reset();
      smoother.reset();
      expect(() => smoother.smooth(makeLandmarks())).not.toThrow();
    });

    it('allows the filter to be reused after reset', () => {
      const smoother = new LandmarkSmoother();

      // First session
      for (let i = 0; i < 5; i++) {
        smoother.smooth(makeLandmarks({ nose: makePoint(0.1, 0.1) }));
      }

      smoother.reset();

      // Second session - should act like fresh filter
      const result = smoother.smooth(makeLandmarks({ nose: makePoint(0.9, 0.9) }));
      expect(result.nose.x).toBeCloseTo(0.9, 10);
    });
  });

  // ── Edge cases ──

  describe('edge cases', () => {
    it('handles zero-valued coordinates', () => {
      const smoother = new LandmarkSmoother();
      const result = smoother.smooth({ origin: makePoint(0, 0, 0) });
      expect(result.origin.x).toBe(0);
      expect(result.origin.y).toBe(0);
      expect(result.origin.z).toBe(0);
    });

    it('handles negative coordinates', () => {
      const smoother = new LandmarkSmoother();
      const result = smoother.smooth({ p: makePoint(-0.5, -0.3, -0.1) });
      expect(result.p.x).toBeCloseTo(-0.5, 10);
    });

    it('handles very large coordinate values', () => {
      const smoother = new LandmarkSmoother();
      const result = smoother.smooth({ p: makePoint(1000, 2000, 3000) });
      expect(result.p.x).toBeCloseTo(1000, 5);
    });

    it('handles empty landmarks object', () => {
      const smoother = new LandmarkSmoother();
      const result = smoother.smooth({});
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('handles single landmark', () => {
      const smoother = new LandmarkSmoother();
      const result = smoother.smooth({ solo: makePoint(0.5, 0.5) });
      expect(result.solo.x).toBeCloseTo(0.5, 10);
    });

    it('smooths z coordinate as well', () => {
      const smoother = new LandmarkSmoother();

      smoother.smooth({ p: makePoint(0.5, 0.5, 0.1) });
      const result = smoother.smooth({ p: makePoint(0.5, 0.5, 0.9) });

      // z should be smoothed (not exactly 0.9 after just 2 frames)
      expect(result.p.z).toBeLessThan(0.9);
      expect(result.p.z).toBeGreaterThan(0.1);
    });

    it('handles high-frequency filter configuration', () => {
      const smoother = new LandmarkSmoother(0.7, 60, 1.0, 0.007, 1.0); // 60 Hz
      const result = smoother.smooth(makeLandmarks());
      expect(result.nose.x).toBeCloseTo(0.5, 5);
    });

    it('handles very low beta (maximum smoothing)', () => {
      const smoother = new LandmarkSmoother(0.7, 15, 0.5, 0, 1.0); // beta=0 -> constant cutoff
      smoother.smooth({ p: makePoint(0, 0) });
      const result = smoother.smooth({ p: makePoint(1, 1) });
      // With beta=0, smoothing is always at mincutoff level
      expect(result.p.x).toBeLessThan(1);
      expect(result.p.x).toBeGreaterThan(0);
    });

    it('handles very high beta (minimum smoothing)', () => {
      const smoother = new LandmarkSmoother(0.7, 15, 1.0, 100, 1.0); // very high beta
      smoother.smooth({ p: makePoint(0, 0) });
      const result = smoother.smooth({ p: makePoint(1, 1) });
      // With very high beta, cutoff increases rapidly -> alpha closer to 1 -> less smoothing
      expect(result.p.x).toBeGreaterThan(0.5);
    });
  });
});
