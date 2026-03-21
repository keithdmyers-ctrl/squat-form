/**
 * Tests for the ML-driven programming personalization engine.
 *
 * Covers:
 * - Linear regression on known data
 * - Pearson correlation (perfect positive, negative, zero)
 * - buildPersonalModel with varying volume/RPE patterns
 * - Volume landmark personalization
 * - Recommendation generation at different confidence levels
 * - Program transition intelligence
 * - Edge cases: empty logs, single workout, all same RPE
 * - Storage save/load round-trip
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  linearRegression,
  pearsonCorrelation,
  buildPersonalModel,
  getPersonalizedRecommendations,
  getPersonalizedVolumeLandmarks,
  getSmartTransitionRecommendation,
  savePersonalModel,
  loadPersonalModel,
} from '../ml-personalization';
import type {
  TrainingResponse,
  PersonalizedRecommendation,
} from '../ml-personalization';
import type { WorkoutLog, ProgramState, WorkoutSet, ReadinessData } from '../workout-storage';

// ─── Test Helpers ───

function makeWorkoutLog(overrides: Partial<WorkoutLog> = {}): WorkoutLog {
  return {
    id: Math.random().toString(36).slice(2),
    date: new Date().toISOString(),
    programId: 'starting_strength',
    workoutDayIndex: 0,
    workoutDayName: 'Day A',
    sets: [],
    completed: true,
    ...overrides,
  };
}

function makeWorkoutSet(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    exerciseName: 'Squat',
    exerciseSlot: 'squat',
    setNumber: 1,
    targetReps: '5',
    targetWeight: 200,
    actualReps: 5,
    actualWeight: 200,
    rpe: 7,
    completed: true,
    ...overrides,
  };
}

function makeProgramState(overrides: Partial<ProgramState> = {}): ProgramState {
  return {
    programId: 'starting_strength',
    startDate: '2025-01-01',
    currentWeek: 1,
    currentDay: 0,
    trainingMaxes: {},
    liftProgress: {},
    workoutsCompleted: 0,
    cycleNumber: 1,
    weekInCycle: 1,
    equipment: 'full_gym',
    weightUnit: 'lbs',
    ...overrides,
  };
}

function makeReadiness(overrides: Partial<ReadinessData> = {}): ReadinessData {
  return {
    sleepHours: 8,
    sleepQuality: 4,
    stress: 2,
    soreness: 2,
    motivation: 4,
    ...overrides,
  };
}

/**
 * Generate a series of workout logs spanning multiple weeks.
 * Each week gets 3 sessions with the specified parameters.
 */
function generateWeeklyLogs(
  weeks: number,
  opts: {
    setsPerSession?: number;
    baseWeight?: number;
    weightIncrement?: number;
    rpe?: number | ((week: number) => number);
    formScore?: number | ((week: number) => number);
    difficulty?: string | ((week: number) => string);
    readiness?: ReadinessData | ((week: number) => ReadinessData);
  } = {},
): WorkoutLog[] {
  const {
    setsPerSession = 9,
    baseWeight = 200,
    weightIncrement = 5,
    rpe = 7,
    formScore,
    difficulty,
    readiness,
  } = opts;

  const logs: WorkoutLog[] = [];
  const startDate = new Date('2025-01-06'); // Monday

  for (let week = 0; week < weeks; week++) {
    for (let session = 0; session < 3; session++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + week * 7 + session * 2);

      const currentRPE = typeof rpe === 'function' ? rpe(week) : rpe;
      const currentFormScore = typeof formScore === 'function' ? formScore(week) : formScore;
      const currentDifficulty = typeof difficulty === 'function' ? difficulty(week) : difficulty;
      const currentReadiness = typeof readiness === 'function' ? readiness(week) : readiness;
      const weight = baseWeight + week * weightIncrement;

      const sets: WorkoutSet[] = [];
      for (let s = 0; s < setsPerSession; s++) {
        sets.push(makeWorkoutSet({
          setNumber: s + 1,
          targetWeight: weight,
          actualWeight: weight,
          actualReps: 5,
          rpe: currentRPE,
          formScore: currentFormScore,
          exerciseSlot: s < 3 ? 'squat' : s < 6 ? 'bench' : 'deadlift',
          exerciseName: s < 3 ? 'Squat' : s < 6 ? 'Bench' : 'Deadlift',
        }));
      }

      logs.push(makeWorkoutLog({
        date: date.toISOString(),
        sets,
        sessionDifficulty: (currentDifficulty ?? 'just_right') as any,
        readiness: currentReadiness ?? undefined,
      }));
    }
  }

  return logs;
}

// ─── Linear Regression Tests ───

describe('linearRegression', () => {
  it('returns zero slope and intercept for empty input', () => {
    const result = linearRegression([]);
    expect(result.slope).toBe(0);
    expect(result.intercept).toBe(0);
    expect(result.r2).toBe(0);
  });

  it('returns zero slope for a single point', () => {
    const result = linearRegression([[3, 7]]);
    expect(result.slope).toBe(0);
    expect(result.intercept).toBe(7);
    expect(result.r2).toBe(0);
  });

  it('fits a perfect positive line (y = 2x + 1)', () => {
    const points: [number, number][] = [
      [0, 1], [1, 3], [2, 5], [3, 7], [4, 9],
    ];
    const result = linearRegression(points);
    expect(result.slope).toBeCloseTo(2, 5);
    expect(result.intercept).toBeCloseTo(1, 5);
    expect(result.r2).toBeCloseTo(1, 5);
  });

  it('fits a perfect negative line (y = -3x + 10)', () => {
    const points: [number, number][] = [
      [0, 10], [1, 7], [2, 4], [3, 1],
    ];
    const result = linearRegression(points);
    expect(result.slope).toBeCloseTo(-3, 5);
    expect(result.intercept).toBeCloseTo(10, 5);
    expect(result.r2).toBeCloseTo(1, 5);
  });

  it('fits noisy data with reasonable R²', () => {
    // y ≈ 1.5x + 2 with noise
    const points: [number, number][] = [
      [0, 2.1], [1, 3.8], [2, 4.9], [3, 6.7],
      [4, 8.1], [5, 9.3], [6, 11.2], [7, 12.8],
    ];
    const result = linearRegression(points);
    expect(result.slope).toBeGreaterThan(1.3);
    expect(result.slope).toBeLessThan(1.7);
    expect(result.r2).toBeGreaterThan(0.95);
  });

  it('handles horizontal line (all same y)', () => {
    const points: [number, number][] = [
      [0, 5], [1, 5], [2, 5], [3, 5],
    ];
    const result = linearRegression(points);
    expect(result.slope).toBeCloseTo(0);
    expect(result.intercept).toBeCloseTo(5);
    // R² is undefined for constant y (ssTot = 0), we return 0
    expect(result.r2).toBe(0);
  });

  it('handles vertical-ish data (all same x)', () => {
    const points: [number, number][] = [
      [2, 1], [2, 3], [2, 5], [2, 7],
    ];
    const result = linearRegression(points);
    // Degenerate: denom = 0, should return slope 0 with mean y as intercept
    expect(result.slope).toBe(0);
    expect(result.intercept).toBeCloseTo(4);
  });

  it('handles two points exactly', () => {
    const points: [number, number][] = [[1, 2], [3, 8]];
    const result = linearRegression(points);
    expect(result.slope).toBeCloseTo(3);
    expect(result.intercept).toBeCloseTo(-1);
    expect(result.r2).toBeCloseTo(1);
  });
});

// ─── Pearson Correlation Tests ───

describe('pearsonCorrelation', () => {
  it('returns 1 for perfect positive correlation', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 6, 8, 10];
    expect(pearsonCorrelation(x, y)).toBeCloseTo(1, 5);
  });

  it('returns -1 for perfect negative correlation', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [10, 8, 6, 4, 2];
    expect(pearsonCorrelation(x, y)).toBeCloseTo(-1, 5);
  });

  it('returns ~0 for uncorrelated data', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 1, 5, 3]; // no clear trend
    const r = pearsonCorrelation(x, y);
    expect(Math.abs(r)).toBeLessThan(0.5);
  });

  it('returns 0 for constant x', () => {
    const x = [5, 5, 5, 5];
    const y = [1, 2, 3, 4];
    expect(pearsonCorrelation(x, y)).toBe(0);
  });

  it('returns 0 for constant y', () => {
    const x = [1, 2, 3, 4];
    const y = [7, 7, 7, 7];
    expect(pearsonCorrelation(x, y)).toBe(0);
  });

  it('returns 0 for fewer than 2 data points', () => {
    expect(pearsonCorrelation([1], [2])).toBe(0);
    expect(pearsonCorrelation([], [])).toBe(0);
  });

  it('handles arrays of different lengths (uses minimum)', () => {
    const x = [1, 2, 3, 4, 5, 6, 7];
    const y = [2, 4, 6]; // only 3 usable points
    const r = pearsonCorrelation(x, y);
    expect(r).toBeCloseTo(1, 5);
  });
});

// ─── buildPersonalModel Tests ───

describe('buildPersonalModel', () => {
  it('returns null for fewer than 10 workouts', () => {
    const logs = generateWeeklyLogs(1); // 3 sessions
    const state = makeProgramState();
    expect(buildPersonalModel(logs, state)).toBeNull();
  });

  it('returns null for exactly 9 workouts', () => {
    const logs = generateWeeklyLogs(3); // 9 sessions
    const state = makeProgramState();
    expect(buildPersonalModel(logs, state)).toBeNull();
  });

  it('builds a model with 10+ workouts', () => {
    const logs = generateWeeklyLogs(4); // 12 sessions
    const state = makeProgramState();
    const model = buildPersonalModel(logs, state);
    expect(model).not.toBeNull();
    expect(model!.dataPoints).toBe(12);
    expect(model!.confidence).toBeCloseTo(12 / 50);
  });

  it('confidence increases with more data points', () => {
    const state = makeProgramState();
    const logs20 = generateWeeklyLogs(7); // 21 sessions
    const logs50 = generateWeeklyLogs(17); // 51 sessions

    const model20 = buildPersonalModel(logs20, state)!;
    const model50 = buildPersonalModel(logs50, state)!;

    expect(model20.confidence).toBeLessThan(model50.confidence);
    expect(model50.confidence).toBe(1); // 51 >= 50 threshold
  });

  it('detects volume sensitivity with increasing RPE at higher volume', () => {
    // Simulate: weeks 0-5 have 9 sets/session + RPE 6, weeks 6-11 have 18 sets/session + RPE 9
    const logs: WorkoutLog[] = [
      ...generateWeeklyLogs(6, { setsPerSession: 9, rpe: 6 }),
      ...generateWeeklyLogs(6, { setsPerSession: 18, rpe: 9 }),
    ];
    // Shift the dates of the second batch to be after the first
    const offset = 6 * 7 * 24 * 60 * 60 * 1000;
    for (let i = 18; i < logs.length; i++) {
      const d = new Date(logs[i].date);
      d.setTime(d.getTime() + offset);
      logs[i].date = d.toISOString();
    }

    const state = makeProgramState();
    const model = buildPersonalModel(logs, state);
    expect(model).not.toBeNull();
    // Higher volume + higher RPE → negative volume sensitivity (volume-sensitive)
    expect(model!.volumeSensitivity).toBeLessThan(0);
  });

  it('detects positive volume sensitivity when more volume = lower RPE', () => {
    // Simulate: weeks 0-5 have 18 sets/session + RPE 6 (high vol + low RPE)
    // weeks 6-11 have 9 sets/session + RPE 9 (low vol + high RPE)
    const logs: WorkoutLog[] = [
      ...generateWeeklyLogs(6, { setsPerSession: 18, rpe: 6 }),
      ...generateWeeklyLogs(6, { setsPerSession: 9, rpe: 9 }),
    ];
    const offset = 6 * 7 * 24 * 60 * 60 * 1000;
    for (let i = 18; i < logs.length; i++) {
      const d = new Date(logs[i].date);
      d.setTime(d.getTime() + offset);
      logs[i].date = d.toISOString();
    }

    const state = makeProgramState();
    const model = buildPersonalModel(logs, state);
    expect(model).not.toBeNull();
    // Higher volume + lower RPE → positive volume sensitivity
    expect(model!.volumeSensitivity).toBeGreaterThan(0);
  });

  it('computes progression rates per lift', () => {
    // Squat: 200 + 10/week = 2x expected (5/week)
    // Bench: 150 + 2.5/week = 1x expected
    const logs = generateWeeklyLogs(8, {
      baseWeight: 200,
      weightIncrement: 10,
    });
    // Override bench weights to use a different progression
    for (const log of logs) {
      for (const set of log.sets) {
        if (set.exerciseSlot === 'bench') {
          // Bench progresses at 2.5 lbs/week (1x expected)
          const weekIndex = Math.floor(
            (new Date(log.date).getTime() - new Date('2025-01-06').getTime()) /
            (7 * 24 * 60 * 60 * 1000),
          );
          set.actualWeight = 150 + weekIndex * 2.5;
          set.targetWeight = set.actualWeight;
        }
      }
    }

    const state = makeProgramState();
    const model = buildPersonalModel(logs, state);
    expect(model).not.toBeNull();
    // Squat: 10 lbs/week actual vs 5 expected → ~2.0 rate
    expect(model!.progressionRate['squat']).toBeGreaterThan(1.5);
    // Bench: 2.5 lbs/week actual vs 2.5 expected → ~1.0 rate
    expect(model!.progressionRate['bench']).toBeCloseTo(1, 0.5);
  });

  it('detects deload frequency from too_hard sessions', () => {
    // Every 3rd week has "too_hard" sessions
    const logs = generateWeeklyLogs(12, {
      difficulty: (week) => week % 3 === 2 ? 'too_hard' : 'just_right',
    });
    const state = makeProgramState();
    const model = buildPersonalModel(logs, state);
    expect(model).not.toBeNull();
    // Should detect ~3 week deload frequency
    expect(model!.deloadFrequency).toBeLessThan(4);
    expect(model!.deloadFrequency).toBeGreaterThan(1.5);
  });

  it('uses default deload frequency when no hard sessions detected', () => {
    const logs = generateWeeklyLogs(6, { difficulty: 'just_right', rpe: 6 });
    const state = makeProgramState();
    const model = buildPersonalModel(logs, state);
    expect(model).not.toBeNull();
    expect(model!.deloadFrequency).toBeGreaterThanOrEqual(4);
  });

  it('handles all same RPE without crashing', () => {
    const logs = generateWeeklyLogs(4, { rpe: 7 });
    const state = makeProgramState();
    const model = buildPersonalModel(logs, state);
    expect(model).not.toBeNull();
    // With constant RPE, volume sensitivity should be near zero
    expect(Math.abs(model!.volumeSensitivity)).toBeLessThan(0.5);
  });

  it('computes recovery capacity from readiness data', () => {
    const logsHighRecovery = generateWeeklyLogs(6, {
      readiness: () => makeReadiness({
        sleepQuality: 5, motivation: 5, stress: 1, soreness: 1,
      }),
      difficulty: 'just_right',
      rpe: 6,
    });
    const state = makeProgramState();
    const modelHigh = buildPersonalModel(logsHighRecovery, state);
    expect(modelHigh).not.toBeNull();
    expect(modelHigh!.recoveryCapacity).toBe('high');

    const logsLowRecovery = generateWeeklyLogs(6, {
      readiness: () => makeReadiness({
        sleepQuality: 1, motivation: 1, stress: 5, soreness: 5,
      }),
      difficulty: (w) => w % 2 === 0 ? 'too_hard' : 'could_not_finish',
      rpe: 10,
    });
    const modelLow = buildPersonalModel(logsLowRecovery, state);
    expect(modelLow).not.toBeNull();
    expect(modelLow!.recoveryCapacity).toBe('low');
  });

  it('sets lastUpdated to a valid ISO date string', () => {
    const logs = generateWeeklyLogs(4);
    const state = makeProgramState();
    const model = buildPersonalModel(logs, state);
    expect(model).not.toBeNull();
    expect(model!.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── getPersonalizedRecommendations Tests ───

describe('getPersonalizedRecommendations', () => {
  function makeModel(overrides: Partial<TrainingResponse> = {}): TrainingResponse {
    return {
      volumeSensitivity: 0,
      progressionRate: {},
      deloadFrequency: 4,
      intensityPreference: 0.5,
      recoveryCapacity: 'normal',
      confidence: 0.6,
      dataPoints: 30,
      lastUpdated: new Date().toISOString(),
      ...overrides,
    };
  }

  it('returns no recommendations for neutral model', () => {
    const model = makeModel();
    const recs = getPersonalizedRecommendations(model);
    // Neutral model should produce no or few recommendations
    // (only recovery capacity = 'normal' which generates nothing)
    expect(recs.length).toBeLessThanOrEqual(1);
  });

  it('generates volume recommendation for volume-sensitive user', () => {
    const model = makeModel({ volumeSensitivity: -0.5 });
    const recs = getPersonalizedRecommendations(model);
    const volumeRec = recs.find(r => r.category === 'volume');
    expect(volumeRec).toBeDefined();
    expect(volumeRec!.recommendation).toContain('volume-sensitive');
  });

  it('generates volume recommendation for volume-tolerant user', () => {
    const model = makeModel({ volumeSensitivity: 0.5 });
    const recs = getPersonalizedRecommendations(model);
    const volumeRec = recs.find(r => r.category === 'volume');
    expect(volumeRec).toBeDefined();
    expect(volumeRec!.recommendation).toContain('tolerate higher training volume');
  });

  it('generates intensity recommendation for intensity-preferring user', () => {
    const model = makeModel({ intensityPreference: 0.8 });
    const recs = getPersonalizedRecommendations(model);
    const intensityRec = recs.find(r => r.category === 'intensity');
    expect(intensityRec).toBeDefined();
    expect(intensityRec!.recommendation).toContain('higher intensity');
  });

  it('generates deload recommendation for frequent deloaders', () => {
    const model = makeModel({ deloadFrequency: 2.5 });
    const recs = getPersonalizedRecommendations(model);
    const deloadRec = recs.find(r => r.category === 'deload');
    expect(deloadRec).toBeDefined();
    expect(deloadRec!.recommendation).toContain('2.5 weeks');
  });

  it('generates deload recommendation for infrequent deloaders', () => {
    const model = makeModel({ deloadFrequency: 6 });
    const recs = getPersonalizedRecommendations(model);
    const deloadRec = recs.find(r => r.category === 'deload');
    expect(deloadRec).toBeDefined();
    expect(deloadRec!.recommendation).toContain('6.0 weeks');
  });

  it('generates progression recommendation for fast progressors', () => {
    const model = makeModel({
      progressionRate: { squat: 1.5, bench: 1.1, deadlift: 1.8 },
      confidence: 0.5,
    });
    const recs = getPersonalizedRecommendations(model);
    const progRecs = recs.filter(r => r.category === 'progression');
    // Should have recommendations for squat (1.5x) and deadlift (1.8x) but not bench (1.1x)
    expect(progRecs.length).toBe(2);
    expect(progRecs.some(r => r.recommendation.includes('squat'))).toBe(true);
    expect(progRecs.some(r => r.recommendation.includes('deadlift'))).toBe(true);
  });

  it('generates progression recommendation for slow progressors', () => {
    const model = makeModel({
      progressionRate: { squat: 0.3 },
      confidence: 0.5,
    });
    const recs = getPersonalizedRecommendations(model);
    const progRec = recs.find(r => r.category === 'progression');
    expect(progRec).toBeDefined();
    expect(progRec!.recommendation).toContain('squat');
    expect(progRec!.recommendation).toContain('0.3x');
  });

  it('generates recovery recommendation for low recovery', () => {
    const model = makeModel({ recoveryCapacity: 'low' });
    const recs = getPersonalizedRecommendations(model);
    const freqRec = recs.find(r => r.category === 'frequency');
    expect(freqRec).toBeDefined();
    expect(freqRec!.recommendation).toContain('below-average recovery');
  });

  it('generates recovery recommendation for high recovery', () => {
    const model = makeModel({ recoveryCapacity: 'high' });
    const recs = getPersonalizedRecommendations(model);
    const freqRec = recs.find(r => r.category === 'frequency');
    expect(freqRec).toBeDefined();
    expect(freqRec!.recommendation).toContain('above average');
  });

  it('filters out recommendations with confidence below 0.2', () => {
    const model = makeModel({
      volumeSensitivity: -0.5,
      confidence: 0.1, // too low
      dataPoints: 5,
    });
    const recs = getPersonalizedRecommendations(model);
    expect(recs.length).toBe(0);
  });

  it('includes program-specific suggestions when currentProgram is provided', () => {
    const model = makeModel({
      volumeSensitivity: 0.5,
      confidence: 0.6,
    });
    const recs = getPersonalizedRecommendations(model, 'texas_method');
    const volumeRec = recs.find(r => r.category === 'volume');
    expect(volumeRec).toBeDefined();
    expect(volumeRec!.reasoning).toContain('BBB');
  });

  it('all recommendations include confidence and data points', () => {
    const model = makeModel({
      volumeSensitivity: -0.5,
      intensityPreference: 0.8,
      deloadFrequency: 2.5,
      recoveryCapacity: 'low',
      confidence: 0.7,
      dataPoints: 35,
    });
    const recs = getPersonalizedRecommendations(model);
    expect(recs.length).toBeGreaterThan(0);
    for (const rec of recs) {
      expect(rec.confidence).toBe(0.7);
      expect(rec.dataPoints).toBe(35);
    }
  });
});

// ─── getPersonalizedVolumeLandmarks Tests ───

describe('getPersonalizedVolumeLandmarks', () => {
  const baseLandmarks = { mev: 8, mav: 15, mrv: 20 };

  it('returns population values when confidence is below threshold', () => {
    const model: TrainingResponse = {
      volumeSensitivity: 0.5,
      progressionRate: {},
      deloadFrequency: 4,
      intensityPreference: 0.5,
      recoveryCapacity: 'normal',
      confidence: 0.1,
      dataPoints: 5,
      lastUpdated: new Date().toISOString(),
    };
    const result = getPersonalizedVolumeLandmarks(model, 'quads', baseLandmarks);
    expect(result.source).toBe('population');
    expect(result.mev).toBe(8);
    expect(result.mav).toBe(15);
    expect(result.mrv).toBe(20);
  });

  it('increases MRV for volume-tolerant user', () => {
    const model: TrainingResponse = {
      volumeSensitivity: 0.8,
      progressionRate: {},
      deloadFrequency: 4,
      intensityPreference: 0.5,
      recoveryCapacity: 'normal',
      confidence: 0.6,
      dataPoints: 30,
      lastUpdated: new Date().toISOString(),
    };
    const result = getPersonalizedVolumeLandmarks(model, 'quads', baseLandmarks);
    expect(result.source).toBe('personal');
    expect(result.mrv).toBeGreaterThan(baseLandmarks.mrv);
  });

  it('decreases MRV for volume-sensitive user', () => {
    const model: TrainingResponse = {
      volumeSensitivity: -0.8,
      progressionRate: {},
      deloadFrequency: 4,
      intensityPreference: 0.5,
      recoveryCapacity: 'normal',
      confidence: 0.6,
      dataPoints: 30,
      lastUpdated: new Date().toISOString(),
    };
    const result = getPersonalizedVolumeLandmarks(model, 'quads', baseLandmarks);
    expect(result.source).toBe('personal');
    expect(result.mrv).toBeLessThan(baseLandmarks.mrv);
  });

  it('further reduces volume for low recovery capacity', () => {
    const model: TrainingResponse = {
      volumeSensitivity: 0,
      progressionRate: {},
      deloadFrequency: 4,
      intensityPreference: 0.5,
      recoveryCapacity: 'low',
      confidence: 0.6,
      dataPoints: 30,
      lastUpdated: new Date().toISOString(),
    };
    const result = getPersonalizedVolumeLandmarks(model, 'quads', baseLandmarks);
    expect(result.source).toBe('personal');
    expect(result.mrv).toBeLessThan(baseLandmarks.mrv);
    expect(result.mav).toBeLessThan(baseLandmarks.mav);
  });

  it('increases volume for high recovery capacity', () => {
    const model: TrainingResponse = {
      volumeSensitivity: 0,
      progressionRate: {},
      deloadFrequency: 4,
      intensityPreference: 0.5,
      recoveryCapacity: 'high',
      confidence: 0.6,
      dataPoints: 30,
      lastUpdated: new Date().toISOString(),
    };
    const result = getPersonalizedVolumeLandmarks(model, 'quads', baseLandmarks);
    expect(result.source).toBe('personal');
    expect(result.mrv).toBeGreaterThan(baseLandmarks.mrv);
  });

  it('maintains mev <= mav <= mrv ordering', () => {
    const model: TrainingResponse = {
      volumeSensitivity: -1,
      progressionRate: {},
      deloadFrequency: 4,
      intensityPreference: 0.5,
      recoveryCapacity: 'low',
      confidence: 0.6,
      dataPoints: 30,
      lastUpdated: new Date().toISOString(),
    };
    const result = getPersonalizedVolumeLandmarks(model, 'quads', baseLandmarks);
    expect(result.mev).toBeLessThanOrEqual(result.mav);
    expect(result.mav).toBeLessThanOrEqual(result.mrv);
  });

  it('works with small baseline landmarks', () => {
    const smallBaseline = { mev: 2, mav: 4, mrv: 6 };
    const model: TrainingResponse = {
      volumeSensitivity: -0.5,
      progressionRate: {},
      deloadFrequency: 4,
      intensityPreference: 0.5,
      recoveryCapacity: 'low',
      confidence: 0.6,
      dataPoints: 30,
      lastUpdated: new Date().toISOString(),
    };
    const result = getPersonalizedVolumeLandmarks(model, 'core', smallBaseline);
    expect(result.mev).toBeGreaterThanOrEqual(1);
    expect(result.mev).toBeLessThanOrEqual(result.mav);
    expect(result.mav).toBeLessThanOrEqual(result.mrv);
  });
});

// ─── getSmartTransitionRecommendation Tests ───

describe('getSmartTransitionRecommendation', () => {
  function makeModel(overrides: Partial<TrainingResponse> = {}): TrainingResponse {
    return {
      volumeSensitivity: 0,
      progressionRate: { squat: 1.0, bench: 1.0, deadlift: 1.0 },
      deloadFrequency: 4,
      intensityPreference: 0.5,
      recoveryCapacity: 'normal',
      confidence: 0.6,
      dataPoints: 30,
      lastUpdated: new Date().toISOString(),
      ...overrides,
    };
  }

  it('returns null when confidence is too low', () => {
    const model = makeModel({ confidence: 0.1 });
    const result = getSmartTransitionRecommendation(model, 'starting_strength', []);
    expect(result).toBeNull();
  });

  it('advises staying on beginner program when progression is fast', () => {
    const model = makeModel({
      progressionRate: { squat: 1.5, bench: 1.3, deadlift: 1.4 },
    });
    const result = getSmartTransitionRecommendation(model, 'starting_strength', []);
    expect(result).not.toBeNull();
    expect(result!.shouldTransition).toBe(false);
    expect(result!.reasoning).toContain('faster than average');
  });

  it('recommends transition when progression is very slow on beginner program', () => {
    const model = makeModel({
      progressionRate: { squat: 0.2, bench: 0.3, deadlift: 0.2 },
      confidence: 0.5,
    });
    const result = getSmartTransitionRecommendation(model, 'starting_strength', []);
    expect(result).not.toBeNull();
    expect(result!.shouldTransition).toBe(true);
    expect(result!.recommendedProgram).toBeDefined();
    expect(result!.reasoning).toContain('stalling');
  });

  it('recommends intensity program for volume-sensitive user on volume program', () => {
    const model = makeModel({
      volumeSensitivity: -0.5,
      progressionRate: { squat: 0.8 }, // not fast enough to trigger "stay" advice
    });
    const result = getSmartTransitionRecommendation(model, 'sbs_hypertrophy', []);
    expect(result).not.toBeNull();
    expect(result!.shouldTransition).toBe(true);
    expect(result!.reasoning).toContain('volume-sensitive');
  });

  it('recommends volume program for volume-tolerant user on intensity program', () => {
    const model = makeModel({
      volumeSensitivity: 0.5,
      progressionRate: { squat: 0.8 },
    });
    const result = getSmartTransitionRecommendation(model, 'texas_method', []);
    expect(result).not.toBeNull();
    expect(result!.shouldTransition).toBe(true);
    expect(result!.reasoning).toContain('tolerate volume');
  });

  it('returns no transition for well-matched program', () => {
    const model = makeModel({
      volumeSensitivity: 0,
      progressionRate: { squat: 0.8 },
    });
    const result = getSmartTransitionRecommendation(model, 'hlm_split', []);
    expect(result).not.toBeNull();
    expect(result!.shouldTransition).toBe(false);
  });

  it('prefers programs not yet tried', () => {
    const model = makeModel({
      volumeSensitivity: -0.5,
      progressionRate: { squat: 0.8 },
    });
    // User has already tried texas_method
    const result = getSmartTransitionRecommendation(model, 'sbs_hypertrophy', ['texas_method']);
    expect(result).not.toBeNull();
    if (result!.recommendedProgram) {
      expect(result!.recommendedProgram).not.toBe('texas_method');
    }
  });
});

// ─── Storage Tests ───

describe('savePersonalModel / loadPersonalModel', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => { storage[key] = value; }),
      removeItem: vi.fn((key: string) => { delete storage[key]; }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips a model through save/load', () => {
    const model: TrainingResponse = {
      volumeSensitivity: -0.3,
      progressionRate: { squat: 1.2, bench: 0.8 },
      deloadFrequency: 3.5,
      intensityPreference: 0.7,
      recoveryCapacity: 'high',
      confidence: 0.6,
      dataPoints: 30,
      lastUpdated: '2025-06-15T12:00:00.000Z',
    };
    savePersonalModel(model);
    const loaded = loadPersonalModel();
    expect(loaded).toEqual(model);
  });

  it('returns null when nothing is stored', () => {
    expect(loadPersonalModel()).toBeNull();
  });

  it('returns null for corrupted JSON', () => {
    storage['squat_form_personal_model'] = 'not valid json{{{';
    expect(loadPersonalModel()).toBeNull();
  });

  it('returns null for invalid model structure', () => {
    storage['squat_form_personal_model'] = JSON.stringify({ foo: 'bar' });
    expect(loadPersonalModel()).toBeNull();
  });

  it('handles localStorage.setItem throwing (storage full)', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw new Error('QuotaExceededError'); }),
      removeItem: vi.fn(),
    });
    const model: TrainingResponse = {
      volumeSensitivity: 0,
      progressionRate: {},
      deloadFrequency: 4,
      intensityPreference: 0.5,
      recoveryCapacity: 'normal',
      confidence: 0.5,
      dataPoints: 25,
      lastUpdated: new Date().toISOString(),
    };
    // Should not throw
    expect(() => savePersonalModel(model)).not.toThrow();
  });
});

// ─── Edge Cases ───

describe('edge cases', () => {
  it('buildPersonalModel handles empty logs', () => {
    const state = makeProgramState();
    expect(buildPersonalModel([], state)).toBeNull();
  });

  it('buildPersonalModel handles logs with no completed sets', () => {
    const logs: WorkoutLog[] = [];
    for (let i = 0; i < 12; i++) {
      logs.push(makeWorkoutLog({
        date: new Date(2025, 0, 6 + i * 2).toISOString(),
        sets: [makeWorkoutSet({ completed: false, rpe: undefined, actualWeight: undefined })],
      }));
    }
    const state = makeProgramState();
    const model = buildPersonalModel(logs, state);
    // Should still produce a model (12 logs), just with default/neutral values
    expect(model).not.toBeNull();
    expect(model!.dataPoints).toBe(12);
  });

  it('buildPersonalModel handles logs with no RPE data', () => {
    const logs: WorkoutLog[] = [];
    for (let i = 0; i < 12; i++) {
      logs.push(makeWorkoutLog({
        date: new Date(2025, 0, 6 + i * 2).toISOString(),
        sets: [makeWorkoutSet({ rpe: undefined })],
      }));
    }
    const state = makeProgramState();
    const model = buildPersonalModel(logs, state);
    expect(model).not.toBeNull();
    // Volume sensitivity defaults to 0 without RPE data
    expect(model!.volumeSensitivity).toBe(0);
  });

  it('getPersonalizedRecommendations handles empty progressionRate', () => {
    const model: TrainingResponse = {
      volumeSensitivity: 0,
      progressionRate: {},
      deloadFrequency: 4,
      intensityPreference: 0.5,
      recoveryCapacity: 'normal',
      confidence: 0.6,
      dataPoints: 30,
      lastUpdated: new Date().toISOString(),
    };
    // Should not throw
    const recs = getPersonalizedRecommendations(model);
    expect(Array.isArray(recs)).toBe(true);
  });

  it('getSmartTransitionRecommendation handles unknown program', () => {
    const model: TrainingResponse = {
      volumeSensitivity: 0,
      progressionRate: {},
      deloadFrequency: 4,
      intensityPreference: 0.5,
      recoveryCapacity: 'normal',
      confidence: 0.6,
      dataPoints: 30,
      lastUpdated: new Date().toISOString(),
    };
    // Should not throw even with unknown program
    const result = getSmartTransitionRecommendation(model, 'custom_program_xyz', []);
    expect(result).not.toBeNull();
  });
});
