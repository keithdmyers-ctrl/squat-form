import { describe, it, expect } from 'vitest';
import {
  detectFatigue,
  aggregateTopIssues,
  aggregatePositiveFeedback,
  computeSetScore,
  createEmptyAnalysis,
  buildRepFrameMap,
  getDimensionLabels,
  SQUAT_LABELS,
  DEADLIFT_LABELS,
  BENCH_LABELS,
  OHP_LABELS,
  ROW_LABELS,
  LUNGE_LABELS,
} from '../exercise-core';
import type { ScoreDimensionLabels } from '../exercise-core';
import type { RepScore, FormIssue, BaseExerciseConfig, SetAnalysis } from '../types';

// ── Helpers ──

function makeRepScore(overrides: Partial<RepScore> = {}): RepScore {
  return {
    depthScore: 80,
    kneeTrackingScore: 75,
    trunkScore: 85,
    symmetryScore: 90,
    tempoScore: 70,
    lockoutScore: 80,
    overallScore: 80,
    grade: 'B',
    issues: [],
    cues: [],
    positiveFeedback: [],
    stickingPoints: [],
    ...overrides,
  };
}

function makeIssue(overrides: Partial<FormIssue> = {}): FormIssue {
  return {
    name: 'Knee Valgus',
    severity: 'moderate',
    description: 'Knees caving in',
    value: 0.65,
    threshold: 0.75,
    phase: 'ascending',
    frame: 42,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<BaseExerciseConfig> = {}): BaseExerciseConfig {
  return {
    squatType: 'high_bar',
    experienceLevel: 'intermediate',
    competitionMode: false,
    ...overrides,
  };
}

// ── detectFatigue ──

describe('detectFatigue', () => {
  it('returns false when fewer than 4 reps', () => {
    const reps = [makeRepScore({ overallScore: 90 }), makeRepScore({ overallScore: 60 })];
    expect(detectFatigue(reps)).toBe(false);
  });

  it('returns false with exactly 3 reps', () => {
    const reps = [
      makeRepScore({ overallScore: 90 }),
      makeRepScore({ overallScore: 85 }),
      makeRepScore({ overallScore: 60 }),
    ];
    expect(detectFatigue(reps)).toBe(false);
  });

  it('returns true when last 2 reps are >15 points below first 2', () => {
    const reps = [
      makeRepScore({ overallScore: 90 }),
      makeRepScore({ overallScore: 88 }),
      makeRepScore({ overallScore: 75 }),
      makeRepScore({ overallScore: 70 }),
    ];
    // first2 avg = 89, last2 avg = 72.5, diff = 16.5 > 15
    expect(detectFatigue(reps)).toBe(true);
  });

  it('returns false when drop is exactly 15 (not greater)', () => {
    const reps = [
      makeRepScore({ overallScore: 85 }),
      makeRepScore({ overallScore: 85 }),
      makeRepScore({ overallScore: 70 }),
      makeRepScore({ overallScore: 70 }),
    ];
    // first2 avg = 85, last2 avg = 70, diff = 15 (not > 15)
    expect(detectFatigue(reps)).toBe(false);
  });

  it('returns false when scores are stable', () => {
    const reps = [
      makeRepScore({ overallScore: 80 }),
      makeRepScore({ overallScore: 82 }),
      makeRepScore({ overallScore: 79 }),
      makeRepScore({ overallScore: 78 }),
    ];
    expect(detectFatigue(reps)).toBe(false);
  });

  it('returns true with many reps and fatigue at the end', () => {
    const reps = [
      makeRepScore({ overallScore: 90 }),
      makeRepScore({ overallScore: 88 }),
      makeRepScore({ overallScore: 85 }),
      makeRepScore({ overallScore: 80 }),
      makeRepScore({ overallScore: 75 }),
      makeRepScore({ overallScore: 65 }),
      makeRepScore({ overallScore: 60 }),
    ];
    // first2 avg = 89, last2 avg = 62.5, diff = 26.5
    expect(detectFatigue(reps)).toBe(true);
  });

  it('returns false when scores improve', () => {
    const reps = [
      makeRepScore({ overallScore: 60 }),
      makeRepScore({ overallScore: 65 }),
      makeRepScore({ overallScore: 75 }),
      makeRepScore({ overallScore: 80 }),
    ];
    expect(detectFatigue(reps)).toBe(false);
  });

  it('handles empty rep array', () => {
    expect(detectFatigue([])).toBe(false);
  });

  it('handles single rep', () => {
    expect(detectFatigue([makeRepScore()])).toBe(false);
  });
});

// ── aggregateTopIssues ──

describe('aggregateTopIssues', () => {
  it('returns empty array when no reps have issues', () => {
    const reps = [makeRepScore(), makeRepScore()];
    expect(aggregateTopIssues(reps)).toEqual([]);
  });

  it('returns empty array for empty rep list', () => {
    expect(aggregateTopIssues([])).toEqual([]);
  });

  it('returns unique issues sorted by severity', () => {
    const highIssue = makeIssue({ name: 'Butt Wink', severity: 'high' });
    const lowIssue = makeIssue({ name: 'Slow Tempo', severity: 'low' });
    const reps = [
      makeRepScore({ issues: [lowIssue] }),
      makeRepScore({ issues: [highIssue] }),
    ];
    const result = aggregateTopIssues(reps);
    expect(result[0].name).toBe('Butt Wink');
    expect(result[1].name).toBe('Slow Tempo');
  });

  it('deduplicates issues by name, keeping highest severity', () => {
    const modIssue = makeIssue({ name: 'Knee Valgus', severity: 'moderate' });
    const highIssue = makeIssue({ name: 'Knee Valgus', severity: 'high' });
    const reps = [
      makeRepScore({ issues: [modIssue] }),
      makeRepScore({ issues: [highIssue] }),
    ];
    const result = aggregateTopIssues(reps);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('high');
  });

  it('limits results to maxIssues (default 3)', () => {
    const issues = [
      makeIssue({ name: 'Issue1', severity: 'high' }),
      makeIssue({ name: 'Issue2', severity: 'high' }),
      makeIssue({ name: 'Issue3', severity: 'moderate' }),
      makeIssue({ name: 'Issue4', severity: 'low' }),
      makeIssue({ name: 'Issue5', severity: 'low' }),
    ];
    const reps = [makeRepScore({ issues })];
    expect(aggregateTopIssues(reps).length).toBeLessThanOrEqual(3);
  });

  it('respects custom maxIssues', () => {
    const issues = [
      makeIssue({ name: 'A', severity: 'high' }),
      makeIssue({ name: 'B', severity: 'high' }),
      makeIssue({ name: 'C', severity: 'moderate' }),
    ];
    const reps = [makeRepScore({ issues })];
    expect(aggregateTopIssues(reps, 1)).toHaveLength(1);
    expect(aggregateTopIssues(reps, 5)).toHaveLength(3);
  });

  it('breaks severity ties by frequency', () => {
    const frequent = makeIssue({ name: 'Frequent Issue', severity: 'moderate' });
    const rare = makeIssue({ name: 'Rare Issue', severity: 'moderate' });
    const reps = [
      makeRepScore({ issues: [frequent, rare] }),
      makeRepScore({ issues: [frequent] }),
      makeRepScore({ issues: [frequent] }),
    ];
    const result = aggregateTopIssues(reps, 2);
    expect(result[0].name).toBe('Frequent Issue');
  });

  it('collects issues across all reps', () => {
    const reps = [
      makeRepScore({ issues: [makeIssue({ name: 'A', severity: 'low' })] }),
      makeRepScore({ issues: [makeIssue({ name: 'B', severity: 'low' })] }),
      makeRepScore({ issues: [makeIssue({ name: 'C', severity: 'low' })] }),
    ];
    expect(aggregateTopIssues(reps)).toHaveLength(3);
  });
});

// ── aggregatePositiveFeedback ──

describe('aggregatePositiveFeedback', () => {
  it('returns empty array for no reps', () => {
    expect(aggregatePositiveFeedback([])).toEqual([]);
  });

  it('returns empty array when reps have no positive feedback', () => {
    const reps = [makeRepScore(), makeRepScore()];
    expect(aggregatePositiveFeedback(reps)).toEqual([]);
  });

  it('collects unique positive feedback across reps', () => {
    const reps = [
      makeRepScore({ positiveFeedback: ['Great depth', 'Good tempo'] }),
      makeRepScore({ positiveFeedback: ['Great depth', 'Solid lockout'] }),
    ];
    const result = aggregatePositiveFeedback(reps);
    expect(result).toHaveLength(3);
    expect(result).toContain('Great depth');
    expect(result).toContain('Good tempo');
    expect(result).toContain('Solid lockout');
  });

  it('deduplicates identical feedback strings', () => {
    const reps = [
      makeRepScore({ positiveFeedback: ['Great depth'] }),
      makeRepScore({ positiveFeedback: ['Great depth'] }),
      makeRepScore({ positiveFeedback: ['Great depth'] }),
    ];
    const result = aggregatePositiveFeedback(reps);
    expect(result).toHaveLength(1);
  });
});

// ── computeSetScore ──

describe('computeSetScore', () => {
  it('returns 0 for empty rep array', () => {
    expect(computeSetScore([])).toBe(0);
  });

  it('returns the score of a single rep', () => {
    expect(computeSetScore([makeRepScore({ overallScore: 85 })])).toBe(85);
  });

  it('computes average of multiple reps (rounded)', () => {
    const reps = [
      makeRepScore({ overallScore: 80 }),
      makeRepScore({ overallScore: 90 }),
    ];
    expect(computeSetScore(reps)).toBe(85);
  });

  it('rounds the average correctly', () => {
    const reps = [
      makeRepScore({ overallScore: 81 }),
      makeRepScore({ overallScore: 82 }),
      makeRepScore({ overallScore: 83 }),
    ];
    // avg = 82
    expect(computeSetScore(reps)).toBe(82);
  });

  it('clamps to 0 minimum', () => {
    const reps = [makeRepScore({ overallScore: 0 })];
    expect(computeSetScore(reps)).toBe(0);
  });

  it('clamps to 100 maximum', () => {
    const reps = [makeRepScore({ overallScore: 100 }), makeRepScore({ overallScore: 100 })];
    expect(computeSetScore(reps)).toBe(100);
  });

  it('handles fractional averages', () => {
    const reps = [
      makeRepScore({ overallScore: 70 }),
      makeRepScore({ overallScore: 71 }),
      makeRepScore({ overallScore: 72 }),
    ];
    // avg = 71
    expect(computeSetScore(reps)).toBe(71);
  });
});

// ── createEmptyAnalysis ──

describe('createEmptyAnalysis', () => {
  it('creates an analysis with zero reps and zero score', () => {
    const config = makeConfig();
    const analysis = createEmptyAnalysis(config);
    expect(analysis.repCount).toBe(0);
    expect(analysis.reps).toEqual([]);
    expect(analysis.overallScore).toBe(0);
    expect(analysis.fatigueDetected).toBe(false);
    expect(analysis.topIssues).toEqual([]);
    expect(analysis.topCues).toEqual([]);
    expect(analysis.positiveHighlights).toEqual([]);
    expect(analysis.mobilityFindings).toEqual([]);
    expect(analysis.warmupProtocol).toEqual([]);
  });

  it('includes the provided config', () => {
    const config = makeConfig({ experienceLevel: 'advanced', competitionMode: true });
    const analysis = createEmptyAnalysis(config);
    expect(analysis.config).toBe(config);
    expect(analysis.competitionMode).toBe(true);
  });

  it('includes calibration when provided', () => {
    const config = makeConfig();
    const calibration = {
      standingKneeAngle: 175,
      standingHipAngle: 170,
      standingTrunkAngle: 10,
      standingAnkleAngle: 85,
      femurLength: 0.4,
      tibiaLength: 0.35,
      torsoLength: 0.5,
      femurTibiaRatio: 1.14,
      torsoFemurRatio: 1.25,
      standingKneeWidth: 0.25,
    };
    const analysis = createEmptyAnalysis(config, calibration);
    expect(analysis.calibration).toBe(calibration);
  });

  it('defaults calibration to null', () => {
    const analysis = createEmptyAnalysis(makeConfig());
    expect(analysis.calibration).toBeNull();
  });

  it('applies overrides', () => {
    const config = makeConfig();
    const analysis = createEmptyAnalysis(config, null, { repCount: 5, overallScore: 85 });
    expect(analysis.repCount).toBe(5);
    expect(analysis.overallScore).toBe(85);
  });

  it('has a grade property', () => {
    const analysis = createEmptyAnalysis(makeConfig());
    expect(typeof analysis.grade).toBe('string');
  });

  it('has an empty repFrameMap', () => {
    const analysis = createEmptyAnalysis(makeConfig());
    expect(analysis.repFrameMap.size).toBe(0);
  });

  it('uses beginner-friendly grade for beginners', () => {
    const config = makeConfig({ experienceLevel: 'beginner' });
    const analysis = createEmptyAnalysis(config);
    // score=0 for beginner should give "Keep Working" not "F"
    expect(analysis.grade).toBe('Keep Working');
  });
});

// ── buildRepFrameMap ──

describe('buildRepFrameMap', () => {
  it('maps frame indices to rep numbers', () => {
    const repRanges = [{ start: 0, end: 2 }, { start: 3, end: 5 }];
    const frameIndices = [10, 20, 30, 40, 50, 60];
    const { repFrameMap, repStartFrames } = buildRepFrameMap(repRanges, frameIndices);

    expect(repFrameMap.get(10)).toBe(0);
    expect(repFrameMap.get(20)).toBe(0);
    expect(repFrameMap.get(30)).toBe(0);
    expect(repFrameMap.get(40)).toBe(1);
    expect(repFrameMap.get(50)).toBe(1);
    expect(repFrameMap.get(60)).toBe(1);
  });

  it('returns repStartFrames for each rep', () => {
    const repRanges = [{ start: 0, end: 2 }, { start: 4, end: 6 }];
    const frameIndices = [10, 20, 30, 40, 50, 60, 70];
    const { repStartFrames } = buildRepFrameMap(repRanges, frameIndices);

    expect(repStartFrames[0]).toBe(10);
    expect(repStartFrames[1]).toBe(50);
  });

  it('handles empty repRanges', () => {
    const { repFrameMap, repStartFrames } = buildRepFrameMap([], [10, 20, 30]);
    expect(repFrameMap.size).toBe(0);
    expect(repStartFrames).toEqual([]);
  });

  it('handles empty frameIndices', () => {
    const { repFrameMap, repStartFrames } = buildRepFrameMap([{ start: 0, end: 2 }], []);
    expect(repFrameMap.size).toBe(0);
    expect(repStartFrames[0]).toBe(0); // defaults to 0 when index out of bounds
  });

  it('does not go beyond frameIndices length', () => {
    const repRanges = [{ start: 0, end: 10 }]; // end exceeds frameIndices
    const frameIndices = [5, 10, 15];
    const { repFrameMap } = buildRepFrameMap(repRanges, frameIndices);
    expect(repFrameMap.size).toBe(3);
  });

  it('handles single-frame reps', () => {
    const repRanges = [{ start: 0, end: 0 }];
    const frameIndices = [42];
    const { repFrameMap, repStartFrames } = buildRepFrameMap(repRanges, frameIndices);
    expect(repFrameMap.get(42)).toBe(0);
    expect(repStartFrames[0]).toBe(42);
  });
});

// ── getDimensionLabels ──

describe('getDimensionLabels', () => {
  it('returns squat labels for "squat"', () => {
    expect(getDimensionLabels('squat')).toBe(SQUAT_LABELS);
  });

  it('returns deadlift labels for "deadlift"', () => {
    expect(getDimensionLabels('deadlift')).toBe(DEADLIFT_LABELS);
  });

  it('returns bench labels for "bench_press"', () => {
    expect(getDimensionLabels('bench_press')).toBe(BENCH_LABELS);
  });

  it('returns OHP labels for "overhead_press"', () => {
    expect(getDimensionLabels('overhead_press')).toBe(OHP_LABELS);
  });

  it('returns row labels for "barbell_row"', () => {
    expect(getDimensionLabels('barbell_row')).toBe(ROW_LABELS);
  });

  it('returns lunge labels for "lunge"', () => {
    expect(getDimensionLabels('lunge')).toBe(LUNGE_LABELS);
  });

  it('defaults to squat labels for unknown exercise', () => {
    expect(getDimensionLabels('unknown_exercise')).toBe(SQUAT_LABELS);
  });

  it('defaults to squat labels for empty string', () => {
    expect(getDimensionLabels('')).toBe(SQUAT_LABELS);
  });
});

// ── Score Dimension Label structure ──

describe('ScoreDimensionLabels', () => {
  const allLabels: [string, ScoreDimensionLabels][] = [
    ['SQUAT_LABELS', SQUAT_LABELS],
    ['DEADLIFT_LABELS', DEADLIFT_LABELS],
    ['BENCH_LABELS', BENCH_LABELS],
    ['OHP_LABELS', OHP_LABELS],
    ['ROW_LABELS', ROW_LABELS],
    ['LUNGE_LABELS', LUNGE_LABELS],
  ];

  for (const [name, labels] of allLabels) {
    it(`${name} has all 6 dimension keys`, () => {
      expect(labels).toHaveProperty('depth');
      expect(labels).toHaveProperty('kneeTracking');
      expect(labels).toHaveProperty('trunk');
      expect(labels).toHaveProperty('symmetry');
      expect(labels).toHaveProperty('tempo');
      expect(labels).toHaveProperty('lockout');
    });

    it(`${name} has non-empty string values`, () => {
      for (const val of Object.values(labels)) {
        expect(typeof val).toBe('string');
        expect(val.length).toBeGreaterThan(0);
      }
    });
  }

  it('squat depth label is "Depth"', () => {
    expect(SQUAT_LABELS.depth).toBe('Depth');
  });

  it('deadlift depth label is "Hip Hinge"', () => {
    expect(DEADLIFT_LABELS.depth).toBe('Hip Hinge');
  });

  it('bench depth label is "Range of Motion"', () => {
    expect(BENCH_LABELS.depth).toBe('Range of Motion');
  });

  it('lunge symmetry label is "Balance"', () => {
    expect(LUNGE_LABELS.symmetry).toBe('Balance');
  });

  it('row lockout label is "Torso Stability"', () => {
    expect(ROW_LABELS.lockout).toBe('Torso Stability');
  });
});
