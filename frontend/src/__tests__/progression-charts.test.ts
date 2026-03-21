/**
 * Tests for progression charts: SVG rendering, data extraction,
 * trend line calculation, and dashboard assembly.
 */

import { describe, it, expect } from 'vitest';
import {
  renderLineChart,
  renderMultiLineChart,
  buildE1RMProgression,
  buildVolumeProgression,
  buildBodyweightProgression,
  renderProgressionDashboard,
  linearRegression,
  LIFT_COLORS,
} from '../progression-charts';
import type { ChartConfig, ChartDataPoint, ChartWorkoutLog } from '../progression-charts';

// ─── Helpers ───

function mockLogs(count: number, startDate: string = '2025-01-01'): ChartWorkoutLog[] {
  const logs: ChartWorkoutLog[] = [];
  const start = new Date(startDate);
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i * 3); // every 3 days
    logs.push({
      date: d.toISOString().slice(0, 10),
      sets: [
        { exerciseSlot: 'squat', actualWeight: 200 + i * 5, actualReps: 5, completed: true },
        { exerciseSlot: 'bench', actualWeight: 135 + i * 2.5, actualReps: 5, completed: true },
        { exerciseSlot: 'deadlift', actualWeight: 250 + i * 5, actualReps: 3, completed: true },
        { exerciseSlot: 'ohp', actualWeight: 95 + i * 2.5, actualReps: 5, completed: true },
        // Incomplete set — should be skipped
        { exerciseSlot: 'squat', actualWeight: 300, actualReps: 5, completed: false },
      ],
    });
  }
  return logs;
}

function mockBodyEntries(count: number): Array<{ date: string; weight: number }> {
  const entries: Array<{ date: string; weight: number }> = [];
  for (let i = 0; i < count; i++) {
    const d = new Date('2025-01-01');
    d.setDate(d.getDate() + i * 7); // weekly weigh-ins
    entries.push({
      date: d.toISOString().slice(0, 10),
      weight: 180 + Math.sin(i / 3) * 2 + i * 0.1,
    });
  }
  return entries;
}

// ─── renderLineChart ───

describe('renderLineChart', () => {
  it('renders empty state with 0 data points', () => {
    const config: ChartConfig = {
      title: 'Test',
      yAxisLabel: 'lbs',
      color: '#4fc3f7',
      points: [],
    };
    const html = renderLineChart(config);
    expect(html).toContain('Not enough data yet');
    expect(html).toContain('chart-empty');
    expect(html).not.toContain('<svg');
  });

  it('renders single-point state with 1 data point', () => {
    const config: ChartConfig = {
      title: 'Test',
      yAxisLabel: 'lbs',
      color: '#4fc3f7',
      points: [{ date: '2025-01-01', value: 225 }],
    };
    const html = renderLineChart(config);
    expect(html).toContain('225');
    expect(html).toContain('Log more workouts');
    expect(html).not.toContain('<svg');
  });

  it('renders SVG chart with 3 data points', () => {
    const config: ChartConfig = {
      title: 'Squat e1RM',
      yAxisLabel: 'lbs',
      color: '#4fc3f7',
      points: [
        { date: '2025-01-01', value: 200 },
        { date: '2025-01-15', value: 210 },
        { date: '2025-02-01', value: 225 },
      ],
    };
    const svg = renderLineChart(config);
    expect(svg).toContain('<svg');
    expect(svg).toContain('polyline');
    expect(svg).toContain('circle');
    expect(svg).toContain('Squat e1RM');
    // Should have exactly 3 data circles
    const circleMatches = svg.match(/<circle /g);
    expect(circleMatches).not.toBeNull();
    expect(circleMatches!.length).toBe(3);
  });

  it('renders SVG chart with 50 data points without errors', () => {
    const points: ChartDataPoint[] = [];
    for (let i = 0; i < 50; i++) {
      const d = new Date('2025-01-01');
      d.setDate(d.getDate() + i);
      points.push({ date: d.toISOString().slice(0, 10), value: 200 + i * 2 + Math.random() * 5 });
    }
    const config: ChartConfig = {
      title: 'Many Points',
      yAxisLabel: 'lbs',
      color: '#4fc3f7',
      points,
      showTrend: true,
      highlightPRs: true,
    };
    const svg = renderLineChart(config);
    expect(svg).toContain('<svg');
    expect(svg).toContain('polyline');
    // Should contain at least some PR circles with gold color
    expect(svg).toContain('#fbbf24');
    // Should contain a dashed trend line
    expect(svg).toContain('stroke-dasharray');
  });

  it('handles trend line with showTrend=true', () => {
    const config: ChartConfig = {
      title: 'Trend Test',
      yAxisLabel: 'lbs',
      color: '#f87171',
      points: [
        { date: '2025-01-01', value: 100 },
        { date: '2025-01-08', value: 110 },
        { date: '2025-01-15', value: 120 },
      ],
      showTrend: true,
    };
    const svg = renderLineChart(config);
    // Trend line should be a dashed line element (separate from gridlines)
    expect(svg).toContain('stroke-dasharray="6,4"');
  });

  it('marks PR points when highlightPRs=true', () => {
    const config: ChartConfig = {
      title: 'PR Test',
      yAxisLabel: 'lbs',
      color: '#4fc3f7',
      points: [
        { date: '2025-01-01', value: 200 },
        { date: '2025-01-08', value: 195 }, // not a PR
        { date: '2025-01-15', value: 210 }, // PR
      ],
      highlightPRs: true,
    };
    const svg = renderLineChart(config);
    // PRs should have gold (#fbbf24) fill
    expect(svg).toContain('#fbbf24');
    // Should contain "PR!" in at least one title
    expect(svg).toContain('PR!');
  });

  it('renders with custom width and height', () => {
    const config: ChartConfig = {
      title: 'Custom Size',
      yAxisLabel: 'kg',
      color: '#4ade80',
      points: [
        { date: '2025-01-01', value: 100 },
        { date: '2025-02-01', value: 120 },
      ],
    };
    const svg = renderLineChart(config, 800, 400);
    expect(svg).toContain('viewBox="0 0 800 400"');
  });

  it('renders accessible SVG with role and aria-label', () => {
    const config: ChartConfig = {
      title: 'Accessible Chart',
      yAxisLabel: 'lbs',
      color: '#4fc3f7',
      points: [
        { date: '2025-01-01', value: 100 },
        { date: '2025-02-01', value: 120 },
      ],
    };
    const svg = renderLineChart(config);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Accessible Chart"');
  });

  it('includes tooltip titles on data points', () => {
    const config: ChartConfig = {
      title: 'Tooltip Test',
      yAxisLabel: 'lbs',
      color: '#4fc3f7',
      points: [
        { date: '2025-01-01', value: 200, label: 'First session' },
        { date: '2025-02-01', value: 215 },
      ],
    };
    const svg = renderLineChart(config);
    expect(svg).toContain('<title>First session</title>');
    expect(svg).toContain('<title>2025-02-01: 215</title>');
  });
});

// ─── renderMultiLineChart ───

describe('renderMultiLineChart', () => {
  it('renders empty state when no configs have enough data', () => {
    const html = renderMultiLineChart([], 'Empty');
    expect(html).toContain('Not enough data yet');
  });

  it('renders multiple series on one chart', () => {
    const configs: ChartConfig[] = [
      {
        title: 'Squat',
        yAxisLabel: 'e1RM',
        color: '#4fc3f7',
        points: [
          { date: '2025-01-01', value: 300 },
          { date: '2025-02-01', value: 315 },
          { date: '2025-03-01', value: 330 },
        ],
      },
      {
        title: 'Bench',
        yAxisLabel: 'e1RM',
        color: '#f87171',
        points: [
          { date: '2025-01-01', value: 200 },
          { date: '2025-02-01', value: 210 },
          { date: '2025-03-01', value: 220 },
        ],
      },
    ];
    const svg = renderMultiLineChart(configs, 'SBD Trends');
    expect(svg).toContain('<svg');
    expect(svg).toContain('SBD Trends');
    // Should have 2 polylines (one per series)
    const polylines = svg.match(/<polyline /g);
    expect(polylines).not.toBeNull();
    expect(polylines!.length).toBe(2);
    // Should have legend entries
    expect(svg).toContain('Squat');
    expect(svg).toContain('Bench');
    expect(svg).toContain('#4fc3f7');
    expect(svg).toContain('#f87171');
  });

  it('skips series with fewer than 2 points', () => {
    const configs: ChartConfig[] = [
      {
        title: 'Enough',
        yAxisLabel: 'val',
        color: '#4fc3f7',
        points: [
          { date: '2025-01-01', value: 100 },
          { date: '2025-02-01', value: 110 },
        ],
      },
      {
        title: 'NotEnough',
        yAxisLabel: 'val',
        color: '#f87171',
        points: [{ date: '2025-01-01', value: 50 }],
      },
    ];
    const svg = renderMultiLineChart(configs, 'Mixed');
    // Should only have 1 polyline
    const polylines = svg.match(/<polyline /g);
    expect(polylines!.length).toBe(1);
    // Legend should only show the valid series
    expect(svg).toContain('Enough');
    expect(svg).not.toContain('NotEnough');
  });
});

// ─── buildE1RMProgression ───

describe('buildE1RMProgression', () => {
  it('returns empty record for empty logs', () => {
    const result = buildE1RMProgression([]);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('extracts e1RM data from workout logs', () => {
    const logs = mockLogs(5);
    const result = buildE1RMProgression(logs);

    expect(result['squat']).toBeDefined();
    expect(result['bench']).toBeDefined();
    expect(result['deadlift']).toBeDefined();
    expect(result['ohp']).toBeDefined();

    // 5 log entries => 5 data points per lift
    expect(result['squat']).toHaveLength(5);
    expect(result['bench']).toHaveLength(5);
  });

  it('computes correct e1RM values using Epley formula', () => {
    const logs: ChartWorkoutLog[] = [{
      date: '2025-01-01',
      sets: [
        { exerciseSlot: 'squat', actualWeight: 225, actualReps: 5, completed: true },
      ],
    }];
    const result = buildE1RMProgression(logs);
    // Epley: 225 * (1 + 5/30) = 225 * 7/6 = 262.5 -> 263
    expect(result['squat'][0].value).toBe(263);
  });

  it('handles single-rep sets (e1RM = weight)', () => {
    const logs: ChartWorkoutLog[] = [{
      date: '2025-01-01',
      sets: [
        { exerciseSlot: 'squat', actualWeight: 315, actualReps: 1, completed: true },
      ],
    }];
    const result = buildE1RMProgression(logs);
    expect(result['squat'][0].value).toBe(315);
  });

  it('skips incomplete sets', () => {
    const logs: ChartWorkoutLog[] = [{
      date: '2025-01-01',
      sets: [
        { exerciseSlot: 'squat', actualWeight: 300, actualReps: 5, completed: false },
        { exerciseSlot: 'bench', actualWeight: 185, actualReps: 5, completed: true },
      ],
    }];
    const result = buildE1RMProgression(logs);
    expect(result['squat']).toBeUndefined();
    expect(result['bench']).toBeDefined();
  });

  it('skips sets with zero or missing weights/reps', () => {
    const logs: ChartWorkoutLog[] = [{
      date: '2025-01-01',
      sets: [
        { exerciseSlot: 'squat', actualWeight: 0, actualReps: 5, completed: true },
        { exerciseSlot: 'bench', actualWeight: 135, actualReps: 0, completed: true },
        { exerciseSlot: 'deadlift', completed: true },
      ],
    }];
    const result = buildE1RMProgression(logs);
    expect(result['squat']).toBeUndefined();
    expect(result['bench']).toBeUndefined();
    expect(result['deadlift']).toBeUndefined();
  });

  it('takes best e1RM of the day when multiple sets exist', () => {
    const logs: ChartWorkoutLog[] = [{
      date: '2025-01-01',
      sets: [
        { exerciseSlot: 'squat', actualWeight: 200, actualReps: 5, completed: true }, // e1RM = 233
        { exerciseSlot: 'squat', actualWeight: 225, actualReps: 3, completed: true }, // e1RM = 248
        { exerciseSlot: 'squat', actualWeight: 250, actualReps: 1, completed: true }, // e1RM = 250
      ],
    }];
    const result = buildE1RMProgression(logs);
    expect(result['squat']).toHaveLength(1);
    expect(result['squat'][0].value).toBe(250);
  });

  it('sorts output chronologically', () => {
    const logs: ChartWorkoutLog[] = [
      { date: '2025-02-01', sets: [{ exerciseSlot: 'squat', actualWeight: 250, actualReps: 5, completed: true }] },
      { date: '2025-01-01', sets: [{ exerciseSlot: 'squat', actualWeight: 200, actualReps: 5, completed: true }] },
      { date: '2025-03-01', sets: [{ exerciseSlot: 'squat', actualWeight: 275, actualReps: 5, completed: true }] },
    ];
    const result = buildE1RMProgression(logs);
    const dates = result['squat'].map(p => p.date);
    expect(dates).toEqual(['2025-01-01', '2025-02-01', '2025-03-01']);
    // Values should be in chronological order
    expect(result['squat'][0].value).toBeLessThan(result['squat'][1].value);
  });
});

// ─── buildVolumeProgression ───

describe('buildVolumeProgression', () => {
  it('returns empty array for no logs', () => {
    const result = buildVolumeProgression([]);
    expect(result).toHaveLength(0);
  });

  it('aggregates sets by week', () => {
    // All in the same week (2025-01-06 is a Monday)
    const logs = [
      { date: '2025-01-06', sets: [{ completed: true }, { completed: true }, { completed: false }] },
      { date: '2025-01-08', sets: [{ completed: true }, { completed: true }] },
    ];
    const result = buildVolumeProgression(logs);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(4); // 2 + 2 completed sets
  });

  it('separates weeks correctly', () => {
    const logs = [
      { date: '2025-01-06', sets: [{ completed: true }, { completed: true }] }, // Week 1
      { date: '2025-01-13', sets: [{ completed: true }] }, // Week 2
      { date: '2025-01-20', sets: [{ completed: true }, { completed: true }, { completed: true }] }, // Week 3
    ];
    const result = buildVolumeProgression(logs);
    expect(result).toHaveLength(3);
    expect(result[0].value).toBe(2);
    expect(result[1].value).toBe(1);
    expect(result[2].value).toBe(3);
  });

  it('only counts completed sets', () => {
    const logs = [
      { date: '2025-01-06', sets: [
        { completed: true },
        { completed: false },
        { completed: true },
        { completed: false },
      ] },
    ];
    const result = buildVolumeProgression(logs);
    expect(result[0].value).toBe(2);
  });
});

// ─── buildBodyweightProgression ───

describe('buildBodyweightProgression', () => {
  it('returns empty array for no entries', () => {
    expect(buildBodyweightProgression([])).toHaveLength(0);
  });

  it('filters out zero-weight entries', () => {
    const entries = [
      { date: '2025-01-01', weight: 180 },
      { date: '2025-01-08', weight: 0 },
      { date: '2025-01-15', weight: 182 },
    ];
    const result = buildBodyweightProgression(entries);
    expect(result).toHaveLength(2);
  });

  it('sorts chronologically', () => {
    const entries = [
      { date: '2025-02-01', weight: 185 },
      { date: '2025-01-01', weight: 180 },
    ];
    const result = buildBodyweightProgression(entries);
    expect(result[0].date).toBe('2025-01-01');
    expect(result[1].date).toBe('2025-02-01');
  });

  it('produces correct data points', () => {
    const entries = mockBodyEntries(5);
    const result = buildBodyweightProgression(entries);
    expect(result).toHaveLength(5);
    expect(result[0].value).toBeCloseTo(entries[0].weight, 1);
  });
});

// ─── linearRegression ───

describe('linearRegression', () => {
  it('returns flat line for a single point', () => {
    const [slope, intercept] = linearRegression([{ x: 0, y: 100 }]);
    expect(slope).toBe(0);
    expect(intercept).toBe(100);
  });

  it('computes correct slope for linear data', () => {
    const points = [
      { x: 0, y: 100 },
      { x: 1, y: 110 },
      { x: 2, y: 120 },
      { x: 3, y: 130 },
    ];
    const [slope, intercept] = linearRegression(points);
    expect(slope).toBeCloseTo(10, 5);
    expect(intercept).toBeCloseTo(100, 5);
  });

  it('computes trend for noisy data', () => {
    const points = [
      { x: 0, y: 100 },
      { x: 1, y: 115 },
      { x: 2, y: 108 },
      { x: 3, y: 125 },
      { x: 4, y: 120 },
    ];
    const [slope] = linearRegression(points);
    expect(slope).toBeGreaterThan(0); // upward trend
  });

  it('handles flat data', () => {
    const points = [
      { x: 0, y: 200 },
      { x: 1, y: 200 },
      { x: 2, y: 200 },
    ];
    const [slope, intercept] = linearRegression(points);
    expect(slope).toBeCloseTo(0, 5);
    expect(intercept).toBeCloseTo(200, 5);
  });
});

// ─── SVG Output Validation ───

describe('SVG output structure', () => {
  const threePointConfig: ChartConfig = {
    title: 'Structure Test',
    yAxisLabel: 'lbs',
    color: '#4fc3f7',
    points: [
      { date: '2025-01-01', value: 200 },
      { date: '2025-02-01', value: 220 },
      { date: '2025-03-01', value: 235 },
    ],
    showTrend: true,
    highlightPRs: true,
  };

  it('contains expected SVG elements', () => {
    const svg = renderLineChart(threePointConfig);
    // Main structure
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('viewBox');

    // Data visualization
    expect(svg).toContain('<polyline');
    expect(svg).toContain('<circle');

    // Labels
    expect(svg).toContain('<text');

    // Gridlines
    expect(svg).toContain('<line');
  });

  it('contains Y-axis label', () => {
    const svg = renderLineChart(threePointConfig);
    expect(svg).toContain('lbs');
  });

  it('contains X-axis date labels', () => {
    const svg = renderLineChart(threePointConfig);
    // Should contain month abbreviations
    expect(svg).toMatch(/Jan|Feb|Mar/);
  });

  it('uses responsive width style', () => {
    const svg = renderLineChart(threePointConfig);
    expect(svg).toContain('width:100%');
  });
});

// ─── renderProgressionDashboard ───

describe('renderProgressionDashboard', () => {
  it('renders dashboard with tabs', () => {
    const logs = mockLogs(10);
    const body = mockBodyEntries(5);
    const html = renderProgressionDashboard(logs, body);

    expect(html).toContain('progression-dashboard');
    expect(html).toContain('chart-tabs');
    expect(html).toContain('e1RM');
    expect(html).toContain('Volume');
    expect(html).toContain('Bodyweight');
  });

  it('renders with empty logs', () => {
    const html = renderProgressionDashboard([]);
    expect(html).toContain('Not enough data yet');
  });

  it('renders without body entries', () => {
    const logs = mockLogs(5);
    const html = renderProgressionDashboard(logs);
    expect(html).toContain('progression-dashboard');
    // Bodyweight tab should show empty state
    expect(html).toContain('Bodyweight');
  });

  it('contains chart panels', () => {
    const logs = mockLogs(10);
    const html = renderProgressionDashboard(logs, mockBodyEntries(5));
    expect(html).toContain('chart-panel');
    // First panel should be active
    expect(html).toContain('chart-panel active');
  });
});

// ─── LIFT_COLORS ───

describe('LIFT_COLORS', () => {
  it('defines colors for the 4 main lifts', () => {
    expect(LIFT_COLORS.squat).toBe('#4fc3f7');
    expect(LIFT_COLORS.bench).toBe('#f87171');
    expect(LIFT_COLORS.deadlift).toBe('#4ade80');
    expect(LIFT_COLORS.ohp).toBe('#fbbf24');
  });
});
