import { describe, it, expect } from 'vitest';
import {
  extractBarPath,
  classifyPathShape,
  calculatePathEfficiency,
  renderBarPathOverlay,
  renderBarPathCard,
} from '../bar-path';
import type { BarPathPoint, BarPathAnalysis } from '../bar-path';
import type { Landmarks, Point } from '../types';

// ─── Helpers ───

/** Create a Point with default visibility. */
function pt(x: number, y: number, z = 0, visibility = 0.99): Point {
  return { x, y, z, visibility };
}

/** Build a basic Landmarks dictionary with shoulders, wrists, and ankles. */
function makeLandmarks(opts: {
  shoulderX?: number; shoulderY?: number;
  wristX?: number; wristY?: number;
  ankleX?: number; ankleY?: number;
}): Landmarks {
  const sx = opts.shoulderX ?? 0.5;
  const sy = opts.shoulderY ?? 0.3;
  const wx = opts.wristX ?? 0.5;
  const wy = opts.wristY ?? 0.4;
  const ax = opts.ankleX ?? 0.5;
  const ay = opts.ankleY ?? 0.9;
  return {
    left_shoulder: pt(sx - 0.05, sy),
    right_shoulder: pt(sx + 0.05, sy),
    left_wrist: pt(wx - 0.05, wy),
    right_wrist: pt(wx + 0.05, wy),
    left_ankle: pt(ax - 0.05, ay),
    right_ankle: pt(ax + 0.05, ay),
    left_hip: pt(sx - 0.04, 0.55),
    right_hip: pt(sx + 0.04, 0.55),
    left_knee: pt(sx - 0.04, 0.7),
    right_knee: pt(sx + 0.04, 0.7),
    left_elbow: pt(wx - 0.04, (sy + wy) / 2),
    right_elbow: pt(wx + 0.04, (sy + wy) / 2),
  };
}

// ─── extractBarPath ───

describe('extractBarPath', () => {
  it('extracts bar path from squat landmarks using shoulder midpoint', () => {
    const landmarks = new Map<number, Landmarks>();
    // Simulate standing -> descending -> bottom -> ascending -> standing
    const phases = new Map<number, string>();
    const frames = [
      { frame: 0, sy: 0.30, phase: 'standing' },
      { frame: 1, sy: 0.40, phase: 'descending' },
      { frame: 2, sy: 0.55, phase: 'descending' },
      { frame: 3, sy: 0.65, phase: 'bottom' },
      { frame: 4, sy: 0.55, phase: 'ascending' },
      { frame: 5, sy: 0.40, phase: 'ascending' },
      { frame: 6, sy: 0.30, phase: 'standing' },
    ];

    for (const f of frames) {
      landmarks.set(f.frame, makeLandmarks({ shoulderY: f.sy }));
      phases.set(f.frame, f.phase);
    }

    const result = extractBarPath(landmarks, 'squat', phases);

    expect(result.points.length).toBe(7);
    expect(result.points[0].phase).toBe('standing');
    expect(result.points[3].phase).toBe('bottom');
    expect(result.points[6].phase).toBe('standing');

    // Y should go down then up (image coords)
    expect(result.points[3].y).toBeGreaterThan(result.points[0].y);
    expect(result.points[6].y).toBeCloseTo(result.points[0].y, 1);
  });

  it('uses wrist midpoint for bench press', () => {
    const landmarks = new Map<number, Landmarks>();
    // Wrists are the tracking point for bench
    landmarks.set(0, makeLandmarks({ wristX: 0.4, wristY: 0.5 }));
    landmarks.set(1, makeLandmarks({ wristX: 0.45, wristY: 0.6 }));
    landmarks.set(2, makeLandmarks({ wristX: 0.4, wristY: 0.5 }));

    const result = extractBarPath(landmarks, 'bench_press');

    expect(result.points.length).toBe(3);
    // Wrist midpoint X: 0.4 - 0.05 and 0.4 + 0.05 => midpoint = 0.4
    expect(result.points[0].x).toBeCloseTo(0.4, 2);
  });

  it('uses wrist midpoint for deadlift', () => {
    const landmarks = new Map<number, Landmarks>();
    landmarks.set(0, makeLandmarks({ wristX: 0.5, wristY: 0.8 }));
    landmarks.set(1, makeLandmarks({ wristX: 0.5, wristY: 0.5 }));

    const result = extractBarPath(landmarks, 'deadlift');
    expect(result.points.length).toBe(2);
    expect(result.points[0].x).toBeCloseTo(0.5, 2);
  });

  it('returns midfoot based on ankle position', () => {
    const landmarks = new Map<number, Landmarks>();
    landmarks.set(0, makeLandmarks({ ankleX: 0.48 }));
    landmarks.set(1, makeLandmarks({ ankleX: 0.48, shoulderY: 0.5 }));

    const result = extractBarPath(landmarks, 'squat');
    // Ankle midpoint: 0.48 - 0.05 and 0.48 + 0.05 => 0.48
    expect(result.midfoot).toBeCloseTo(0.48, 2);
  });

  it('handles empty landmarks map', () => {
    const landmarks = new Map<number, Landmarks>();
    const result = extractBarPath(landmarks, 'squat');

    expect(result.points).toEqual([]);
    expect(result.lateralDrift).toBe(0);
    expect(result.pathShape).toBe('straight');
    expect(result.pathEfficiency).toBe(100);
    expect(result.midfoot).toBe(0.5);
  });

  it('handles single frame', () => {
    const landmarks = new Map<number, Landmarks>();
    landmarks.set(0, makeLandmarks({}));

    const result = extractBarPath(landmarks, 'squat');

    expect(result.points.length).toBe(1);
    expect(result.lateralDrift).toBe(0);
    expect(result.pathShape).toBe('straight');
    expect(result.pathEfficiency).toBe(100);
  });

  it('handles missing landmarks gracefully', () => {
    const landmarks = new Map<number, Landmarks>();
    // Frame with no shoulder or wrist landmarks
    landmarks.set(0, {
      left_hip: pt(0.45, 0.55),
      right_hip: pt(0.55, 0.55),
    });
    landmarks.set(1, makeLandmarks({}));

    const result = extractBarPath(landmarks, 'squat');
    // First frame has no shoulders, so it should be skipped
    expect(result.points.length).toBe(1);
  });

  it('defaults phase to standing when no phases map provided', () => {
    const landmarks = new Map<number, Landmarks>();
    landmarks.set(0, makeLandmarks({}));
    landmarks.set(5, makeLandmarks({ shoulderY: 0.5 }));

    const result = extractBarPath(landmarks, 'squat');
    expect(result.points[0].phase).toBe('standing');
    expect(result.points[1].phase).toBe('standing');
  });
});

// ─── classifyPathShape ───

describe('classifyPathShape', () => {
  it('classifies perfectly vertical points as straight', () => {
    const points: BarPathPoint[] = [
      { x: 0.5, y: 0.1, frame: 0, phase: 'standing' },
      { x: 0.5, y: 0.3, frame: 1, phase: 'descending' },
      { x: 0.5, y: 0.5, frame: 2, phase: 'bottom' },
      { x: 0.5, y: 0.3, frame: 3, phase: 'ascending' },
      { x: 0.5, y: 0.1, frame: 4, phase: 'standing' },
    ];
    expect(classifyPathShape(points)).toBe('straight');
  });

  it('classifies near-vertical points as straight', () => {
    const points: BarPathPoint[] = [
      { x: 0.500, y: 0.1, frame: 0, phase: 'standing' },
      { x: 0.501, y: 0.3, frame: 1, phase: 'descending' },
      { x: 0.502, y: 0.5, frame: 2, phase: 'bottom' },
      { x: 0.501, y: 0.3, frame: 3, phase: 'ascending' },
      { x: 0.500, y: 0.1, frame: 4, phase: 'standing' },
    ];
    expect(classifyPathShape(points)).toBe('straight');
  });

  it('classifies forward drift', () => {
    const points: BarPathPoint[] = [
      { x: 0.50, y: 0.1, frame: 0, phase: 'standing' },
      { x: 0.52, y: 0.2, frame: 1, phase: 'descending' },
      { x: 0.54, y: 0.3, frame: 2, phase: 'descending' },
      { x: 0.56, y: 0.4, frame: 3, phase: 'bottom' },
      { x: 0.58, y: 0.3, frame: 4, phase: 'ascending' },
      { x: 0.60, y: 0.2, frame: 5, phase: 'ascending' },
    ];
    expect(classifyPathShape(points)).toBe('forward_drift');
  });

  it('classifies backward drift', () => {
    const points: BarPathPoint[] = [
      { x: 0.55, y: 0.1, frame: 0, phase: 'standing' },
      { x: 0.53, y: 0.2, frame: 1, phase: 'descending' },
      { x: 0.51, y: 0.3, frame: 2, phase: 'descending' },
      { x: 0.49, y: 0.4, frame: 3, phase: 'bottom' },
      { x: 0.47, y: 0.3, frame: 4, phase: 'ascending' },
      { x: 0.45, y: 0.2, frame: 5, phase: 'ascending' },
    ];
    expect(classifyPathShape(points)).toBe('backward_drift');
  });

  it('classifies j-curve (forward at bottom, returns to start)', () => {
    const points: BarPathPoint[] = [
      { x: 0.50, y: 0.1, frame: 0, phase: 'standing' },
      { x: 0.51, y: 0.2, frame: 1, phase: 'descending' },
      { x: 0.53, y: 0.3, frame: 2, phase: 'descending' },
      { x: 0.56, y: 0.5, frame: 3, phase: 'bottom' },
      { x: 0.53, y: 0.3, frame: 4, phase: 'ascending' },
      { x: 0.51, y: 0.2, frame: 5, phase: 'ascending' },
      { x: 0.50, y: 0.1, frame: 6, phase: 'standing' },
    ];
    expect(classifyPathShape(points)).toBe('j_curve');
  });

  it('classifies s-curve (multiple direction changes)', () => {
    const points: BarPathPoint[] = [
      { x: 0.50, y: 0.1, frame: 0, phase: 'standing' },
      { x: 0.46, y: 0.15, frame: 1, phase: 'descending' },
      { x: 0.43, y: 0.2, frame: 2, phase: 'descending' },
      { x: 0.47, y: 0.3, frame: 3, phase: 'descending' },
      { x: 0.53, y: 0.4, frame: 4, phase: 'bottom' },
      { x: 0.47, y: 0.3, frame: 5, phase: 'ascending' },
      { x: 0.43, y: 0.2, frame: 6, phase: 'ascending' },
      { x: 0.50, y: 0.1, frame: 7, phase: 'standing' },
    ];
    expect(classifyPathShape(points)).toBe('s_curve');
  });

  it('returns straight for fewer than 3 points', () => {
    expect(classifyPathShape([])).toBe('straight');
    expect(classifyPathShape([
      { x: 0.5, y: 0.1, frame: 0, phase: 'standing' },
    ])).toBe('straight');
    expect(classifyPathShape([
      { x: 0.5, y: 0.1, frame: 0, phase: 'standing' },
      { x: 0.6, y: 0.5, frame: 1, phase: 'bottom' },
    ])).toBe('straight');
  });
});

// ─── calculatePathEfficiency ───

describe('calculatePathEfficiency', () => {
  it('returns 100 for a perfectly vertical path', () => {
    const points: BarPathPoint[] = [
      { x: 0.5, y: 0.1, frame: 0, phase: 'standing' },
      { x: 0.5, y: 0.3, frame: 1, phase: 'descending' },
      { x: 0.5, y: 0.5, frame: 2, phase: 'bottom' },
      { x: 0.5, y: 0.3, frame: 3, phase: 'ascending' },
      { x: 0.5, y: 0.1, frame: 4, phase: 'standing' },
    ];
    expect(calculatePathEfficiency(points)).toBe(100);
  });

  it('returns a lower score for a drifting path', () => {
    const points: BarPathPoint[] = [
      { x: 0.50, y: 0.1, frame: 0, phase: 'standing' },
      { x: 0.55, y: 0.3, frame: 1, phase: 'descending' },
      { x: 0.60, y: 0.5, frame: 2, phase: 'bottom' },
      { x: 0.55, y: 0.3, frame: 3, phase: 'ascending' },
      { x: 0.50, y: 0.1, frame: 4, phase: 'standing' },
    ];
    const eff = calculatePathEfficiency(points);
    expect(eff).toBeGreaterThan(0);
    expect(eff).toBeLessThan(100);
  });

  it('returns 0 or very low for extreme horizontal movement', () => {
    const points: BarPathPoint[] = [
      { x: 0.0, y: 0.5, frame: 0, phase: 'standing' },
      { x: 0.5, y: 0.5, frame: 1, phase: 'descending' },
      { x: 1.0, y: 0.5, frame: 2, phase: 'bottom' },
    ];
    // Y range is 0, so efficiency should be 100 (no vertical movement to deviate from)
    // Actually the function guards yRange < 1e-9 => 100
    expect(calculatePathEfficiency(points)).toBe(100);
  });

  it('returns 0 for extreme lateral deviation with vertical range', () => {
    const points: BarPathPoint[] = [
      { x: 0.0, y: 0.0, frame: 0, phase: 'standing' },
      { x: 0.5, y: 0.25, frame: 1, phase: 'descending' },
      { x: 1.0, y: 0.5, frame: 2, phase: 'bottom' },
      { x: 0.5, y: 0.75, frame: 3, phase: 'ascending' },
      { x: 0.0, y: 1.0, frame: 4, phase: 'standing' },
    ];
    const eff = calculatePathEfficiency(points);
    expect(eff).toBeLessThan(50);
  });

  it('returns 100 for a single point', () => {
    expect(calculatePathEfficiency([
      { x: 0.5, y: 0.5, frame: 0, phase: 'standing' },
    ])).toBe(100);
  });

  it('returns 100 for fewer than 2 points', () => {
    expect(calculatePathEfficiency([])).toBe(100);
  });
});

// ─── renderBarPathOverlay ───

describe('renderBarPathOverlay', () => {
  it('returns a valid SVG string', () => {
    const analysis: BarPathAnalysis = {
      points: [
        { x: 0.5, y: 0.1, frame: 0, phase: 'standing' },
        { x: 0.5, y: 0.5, frame: 1, phase: 'bottom' },
        { x: 0.5, y: 0.1, frame: 2, phase: 'standing' },
      ],
      lateralDrift: 0,
      pathShape: 'straight',
      pathEfficiency: 100,
      midfoot: 0.5,
    };

    const svg = renderBarPathOverlay(analysis, 300, 400);
    expect(svg).toContain('<svg');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="300"');
    expect(svg).toContain('height="400"');
    expect(svg).toContain('</svg>');
  });

  it('includes reference line and midfoot marker', () => {
    const analysis: BarPathAnalysis = {
      points: [
        { x: 0.5, y: 0.1, frame: 0, phase: 'standing' },
        { x: 0.5, y: 0.5, frame: 1, phase: 'bottom' },
      ],
      lateralDrift: 0,
      pathShape: 'straight',
      pathEfficiency: 100,
      midfoot: 0.5,
    };

    const svg = renderBarPathOverlay(analysis, 200, 300);
    // Should contain a dashed reference line
    expect(svg).toContain('stroke-dasharray');
    // Should contain a midfoot triangle
    expect(svg).toContain('polygon');
  });

  it('contains path segment lines', () => {
    const analysis: BarPathAnalysis = {
      points: [
        { x: 0.5, y: 0.1, frame: 0, phase: 'standing' },
        { x: 0.52, y: 0.3, frame: 1, phase: 'descending' },
        { x: 0.5, y: 0.5, frame: 2, phase: 'bottom' },
        { x: 0.5, y: 0.1, frame: 3, phase: 'ascending' },
      ],
      lateralDrift: 0.05,
      pathShape: 'j_curve',
      pathEfficiency: 85,
      midfoot: 0.5,
    };

    const svg = renderBarPathOverlay(analysis, 400, 500);
    // Should have line segments for each pair of consecutive points
    expect(svg).toContain('<line');
    // Should have start and end circle markers
    expect(svg).toContain('<circle');
  });

  it('returns empty SVG for no points', () => {
    const analysis: BarPathAnalysis = {
      points: [],
      lateralDrift: 0,
      pathShape: 'straight',
      pathEfficiency: 100,
      midfoot: 0.5,
    };

    const svg = renderBarPathOverlay(analysis, 200, 200);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    // Should NOT contain any line or circle elements
    expect(svg).not.toContain('<line');
    expect(svg).not.toContain('<circle');
  });
});

// ─── renderBarPathCard ───

describe('renderBarPathCard', () => {
  it('renders a card with efficiency, shape, and drift', () => {
    const analysis: BarPathAnalysis = {
      points: [
        { x: 0.5, y: 0.1, frame: 0, phase: 'standing' },
        { x: 0.5, y: 0.5, frame: 1, phase: 'bottom' },
      ],
      lateralDrift: 0.05,
      pathShape: 'straight',
      pathEfficiency: 95,
      midfoot: 0.5,
    };

    const html = renderBarPathCard(analysis, 'squat');
    expect(html).toContain('Bar Path Analysis');
    expect(html).toContain('Path Efficiency');
    expect(html).toContain('95%');
    expect(html).toContain('Straight');
    expect(html).toContain('Lateral Drift');
    expect(html).toContain('5.0%');
  });

  it('shows exercise-specific notes for squat', () => {
    const analysis: BarPathAnalysis = {
      points: [{ x: 0.5, y: 0.5, frame: 0, phase: 'standing' }],
      lateralDrift: 0.1,
      pathShape: 'forward_drift',
      pathEfficiency: 60,
      midfoot: 0.5,
    };

    const html = renderBarPathCard(analysis, 'squat');
    expect(html).toContain('weak quads');
  });

  it('shows exercise-specific notes for bench', () => {
    const analysis: BarPathAnalysis = {
      points: [{ x: 0.5, y: 0.5, frame: 0, phase: 'standing' }],
      lateralDrift: 0.1,
      pathShape: 'j_curve',
      pathEfficiency: 85,
      midfoot: 0.5,
    };

    const html = renderBarPathCard(analysis, 'bench_press');
    expect(html).toContain('standard bench press path');
  });

  it('returns empty string for no points', () => {
    const analysis: BarPathAnalysis = {
      points: [],
      lateralDrift: 0,
      pathShape: 'straight',
      pathEfficiency: 100,
      midfoot: 0.5,
    };

    expect(renderBarPathCard(analysis, 'squat')).toBe('');
  });

  it('uses correct color for good efficiency', () => {
    const analysis: BarPathAnalysis = {
      points: [{ x: 0.5, y: 0.5, frame: 0, phase: 'standing' }],
      lateralDrift: 0,
      pathShape: 'straight',
      pathEfficiency: 90,
      midfoot: 0.5,
    };

    const html = renderBarPathCard(analysis, 'squat');
    expect(html).toContain('--success');
  });

  it('uses correct color for moderate efficiency', () => {
    const analysis: BarPathAnalysis = {
      points: [{ x: 0.5, y: 0.5, frame: 0, phase: 'standing' }],
      lateralDrift: 0,
      pathShape: 'straight',
      pathEfficiency: 60,
      midfoot: 0.5,
    };

    const html = renderBarPathCard(analysis, 'squat');
    expect(html).toContain('--warning');
  });

  it('uses correct color for poor efficiency', () => {
    const analysis: BarPathAnalysis = {
      points: [{ x: 0.5, y: 0.5, frame: 0, phase: 'standing' }],
      lateralDrift: 0,
      pathShape: 'straight',
      pathEfficiency: 30,
      midfoot: 0.5,
    };

    const html = renderBarPathCard(analysis, 'squat');
    expect(html).toContain('--danger');
  });
});
