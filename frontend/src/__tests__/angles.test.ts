import { describe, it, expect } from 'vitest';
import {
  calculateAngle,
  angleFromVertical,
  segmentLength,
  computeFrameAngles,
} from '../angles';
import type { Point } from '../types';

// ── Helpers ──

function makePoint(x: number, y: number, visibility = 1.0): Point {
  return { x, y, z: 0, visibility };
}

// ── Tests ──

describe('calculateAngle', () => {
  it('returns 90 for a right angle', () => {
    // Points forming an L: a=(1,0,0), b=(0,0,0), c=(0,1,0)
    const angle = calculateAngle([1, 0, 0], [0, 0, 0], [0, 1, 0]);
    expect(angle).toBeCloseTo(90, 5);
  });

  it('returns 180 for a straight line', () => {
    // Points in a line: a=(-1,0,0), b=(0,0,0), c=(1,0,0)
    const angle = calculateAngle([-1, 0, 0], [0, 0, 0], [1, 0, 0]);
    expect(angle).toBeCloseTo(180, 5);
  });

  it('returns close to 0 for a sharp angle', () => {
    // Very acute: a=(1,0.01,0), b=(0,0,0), c=(1,-0.01,0)
    const angle = calculateAngle([1, 0.01, 0], [0, 0, 0], [1, -0.01, 0]);
    expect(angle).toBeLessThan(5);
    expect(angle).toBeGreaterThan(0);
  });

  it('returns 180 for degenerate (zero length) segments', () => {
    const angle = calculateAngle([0, 0, 0], [0, 0, 0], [1, 0, 0]);
    expect(angle).toBe(180);
  });

  it('computes obtuse angles correctly', () => {
    // a=(1,1,0), b=(0,0,0), c=(-1,0,0) -> angle between (1,1) and (-1,0) at origin
    // dot = 1*-1 + 1*0 = -1, |ba|=sqrt(2), |bc|=1
    // cos = -1/sqrt(2), angle = 135
    const angle = calculateAngle([1, 1, 0], [0, 0, 0], [-1, 0, 0]);
    expect(angle).toBeCloseTo(135, 4);
  });

  it('computes 45-degree angle', () => {
    // a=(1,0,0), b=(0,0,0), c=(1,1,0) -> angle at origin
    // dot = 1*1 + 0*1 = 1, |ba|=1, |bc|=sqrt(2)
    // cos = 1/sqrt(2), angle = 45
    const angle = calculateAngle([1, 0, 0], [0, 0, 0], [1, 1, 0]);
    expect(angle).toBeCloseTo(45, 4);
  });

  it('computes 60-degree angle', () => {
    // Equilateral triangle: a=(1,0,0), b=(0,0,0), c=(0.5, sqrt(3)/2, 0)
    const angle = calculateAngle([1, 0, 0], [0, 0, 0], [0.5, Math.sqrt(3) / 2, 0]);
    expect(angle).toBeCloseTo(60, 4);
  });

  it('computes 3D angle correctly with z-coordinates', () => {
    // 90-degree angle in 3D: a=(1,0,0), b=(0,0,0), c=(0,0,1)
    const angle = calculateAngle([1, 0, 0], [0, 0, 0], [0, 0, 1]);
    expect(angle).toBeCloseTo(90, 5);
  });

  it('computes 3D angle with all axes involved', () => {
    // a=(1,0,0), b=(0,0,0), c=(0,1,1) -> dot=0, angle=90
    const angle = calculateAngle([1, 0, 0], [0, 0, 0], [0, 1, 1]);
    expect(angle).toBeCloseTo(90, 5);
  });
});

describe('angleFromVertical', () => {
  it('returns 0 for a vertical segment (pointing straight up)', () => {
    // top is above bottom in image coords (lower y = higher on screen)
    const angle = angleFromVertical([0, 0, 0], [0, 1, 0]);
    expect(angle).toBeCloseTo(0, 5);
  });

  it('returns 90 for a horizontal segment', () => {
    const angle = angleFromVertical([1, 0, 0], [0, 0, 0]);
    expect(angle).toBeCloseTo(90, 5);
  });

  it('returns 45 for a 45-degree tilt', () => {
    // Segment from (0,1,0) to (1,0,0): direction is (1,-1,0), normalize
    // dot with (0,-1,0) = 1, len = sqrt(2), cos = 1/sqrt(2) -> 45 deg
    const angle = angleFromVertical([1, 0, 0], [0, 1, 0]);
    expect(angle).toBeCloseTo(45, 4);
  });

  it('returns 180 when segment points down', () => {
    // top below bottom: top=(0,2,0), bottom=(0,0,0)
    // direction = (0,2,0), vertical = (0,-1,0), dot = -2, len=2, cos=-1 -> 180
    const angle = angleFromVertical([0, 2, 0], [0, 0, 0]);
    expect(angle).toBeCloseTo(180, 5);
  });

  it('returns 0 for degenerate (zero length) segment', () => {
    const angle = angleFromVertical([5, 5, 0], [5, 5, 0]);
    expect(angle).toBe(0);
  });

  it('accounts for z-axis tilt from vertical', () => {
    // Segment with z-offset: top=(0, 0, 1), bottom=(0, 1, 0)
    // direction = (0, -1, 1), len = sqrt(2)
    // dot with (0,-1,0) = 1, cos = 1/sqrt(2) -> 45 deg
    const angle = angleFromVertical([0, 0, 1], [0, 1, 0]);
    expect(angle).toBeCloseTo(45, 4);
  });
});

describe('segmentLength', () => {
  it('computes distance between two points', () => {
    const a = makePoint(0, 0);
    const b = makePoint(3, 4);
    expect(segmentLength(a, b)).toBeCloseTo(5, 10);
  });

  it('returns 0 for same point', () => {
    const a = makePoint(5, 5);
    expect(segmentLength(a, a)).toBe(0);
  });

  it('handles negative coordinates', () => {
    const a = makePoint(-3, -4);
    const b = makePoint(0, 0);
    expect(segmentLength(a, b)).toBeCloseTo(5, 10);
  });

  it('handles unit distance', () => {
    const a = makePoint(0, 0);
    const b = makePoint(1, 0);
    expect(segmentLength(a, b)).toBe(1);
  });
});

describe('computeFrameAngles', () => {
  it('returns safe defaults when core landmarks are missing', () => {
    const result = computeFrameAngles({});
    expect(result.kneeAngle).toBe(180);
    expect(result.hipAngle).toBe(180);
    expect(result.trunkAngle).toBe(0);
    expect(result.kneeWidthRatio).toBeNull();
    expect(result.hipSymmetry).toBeNull();
  });

  it('computes angles from a standing position (side view)', () => {
    // Standing person (approx side view with left side having higher visibility)
    const landmarks: Record<string, Point> = {
      left_shoulder: makePoint(0.5, 0.2, 0.9),
      left_hip: makePoint(0.5, 0.5, 0.9),
      left_knee: makePoint(0.5, 0.75, 0.9),
      left_ankle: makePoint(0.5, 1.0, 0.9),
      left_heel: makePoint(0.48, 1.0, 0.9),
      left_foot_index: makePoint(0.55, 1.0, 0.9),
      right_shoulder: makePoint(0.5, 0.2, 0.5),
      right_hip: makePoint(0.5, 0.5, 0.5),
      right_knee: makePoint(0.5, 0.75, 0.5),
      right_ankle: makePoint(0.5, 1.0, 0.5),
    };

    const result = computeFrameAngles(landmarks);

    // Standing: knee should be near 180 (straight leg)
    expect(result.kneeAngle).toBeCloseTo(180, 0);
    // Trunk should be near vertical (near 0)
    expect(result.trunkAngle).toBeCloseTo(0, 0);
  });

  it('picks the side with better visibility', () => {
    const landmarks: Record<string, Point> = {
      left_shoulder: makePoint(0.3, 0.2, 0.3),
      left_hip: makePoint(0.3, 0.5, 0.3),
      left_knee: makePoint(0.3, 0.75, 0.3),
      left_ankle: makePoint(0.3, 1.0, 0.3),
      right_shoulder: makePoint(0.7, 0.2, 0.9),
      right_hip: makePoint(0.7, 0.5, 0.9),
      right_knee: makePoint(0.7, 0.75, 0.9),
      right_ankle: makePoint(0.7, 1.0, 0.9),
    };

    // Right side has higher visibility so right side should be used
    // With identical geometry (vertically aligned), angles should still be computed
    const result = computeFrameAngles(landmarks);
    expect(result.kneeAngle).toBeCloseTo(180, 0);
  });

  it('computes kneeWidthRatio when both knees and standingKneeWidth provided', () => {
    const landmarks: Record<string, Point> = {
      left_shoulder: makePoint(0.4, 0.2, 0.9),
      left_hip: makePoint(0.4, 0.5, 0.9),
      left_knee: makePoint(0.35, 0.75, 0.9),
      left_ankle: makePoint(0.4, 1.0, 0.9),
      right_shoulder: makePoint(0.6, 0.2, 0.8),
      right_hip: makePoint(0.6, 0.5, 0.8),
      right_knee: makePoint(0.65, 0.75, 0.8),
      right_ankle: makePoint(0.6, 1.0, 0.8),
    };

    const standingKneeWidth = 0.3;
    const result = computeFrameAngles(landmarks, standingKneeWidth);
    // current width = |0.35 - 0.65| = 0.30, ratio = 0.30 / 0.30 = 1.0
    expect(result.kneeWidthRatio).toBeCloseTo(1.0, 5);
  });

  it('computes hipSymmetry when both hips are present', () => {
    const landmarks: Record<string, Point> = {
      left_shoulder: makePoint(0.4, 0.2, 0.9),
      left_hip: makePoint(0.4, 0.50, 0.9),
      left_knee: makePoint(0.4, 0.75, 0.9),
      left_ankle: makePoint(0.4, 1.0, 0.9),
      right_shoulder: makePoint(0.6, 0.2, 0.8),
      right_hip: makePoint(0.6, 0.52, 0.8),
      right_knee: makePoint(0.6, 0.75, 0.8),
      right_ankle: makePoint(0.6, 1.0, 0.8),
    };

    const result = computeFrameAngles(landmarks);
    // hipWidth = |0.4 - 0.6| = 0.2
    // yDiff = |0.50 - 0.52| = 0.02
    // symmetry = 0.02 / 0.2 = 0.1
    expect(result.hipSymmetry).toBeCloseTo(0.1, 5);
  });
});
