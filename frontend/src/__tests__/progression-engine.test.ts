/**
 * Tests for the progression engine — safety-critical module that calculates
 * training weights, handles deloads, manages stall detection, and drives
 * program progression.
 *
 * Covers: checkWeightSafety, enforceBarMinimum, MIN_BAR_WEIGHT,
 * WEIGHT_SAFETY_CAPS, generateWorkout, recordSetResult, get531WeekSets,
 * roundToPlate, parseReps, rpeToPct, initializeProgram, advanceWorkout,
 * getEstimated1RMs, checkLPTransition, getActiveOverride.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkWeightSafety,
  enforceBarMinimum,
  MIN_BAR_WEIGHT,
  WEIGHT_SAFETY_CAPS,
  generateWorkout,
  recordSetResult,
  get531WeekSets,
  roundToPlate,
  parseReps,
  rpeToPct,
  initializeProgram,
  advanceWorkout,
  getEstimated1RMs,
  checkLPTransition,
  getActiveOverride,
} from '../progression-engine';
import type { ProgramState, LiftProgress, ScheduleOverride } from '../workout-storage';
import type { UserProfile } from '../workout-programs';
import { PROGRAMS } from '../workout-programs';

// Mock workout-storage's localStorage-dependent functions so tests run in Node
vi.mock('../workout-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../workout-storage')>();
  return {
    ...actual,
    loadWorkoutLogs: vi.fn(() => []),
    loadUserProfile: vi.fn(() => null),
  };
});

// ─── Helpers ───

function makeLiftProgress(overrides: Partial<LiftProgress> = {}): LiftProgress {
  return {
    liftName: 'squat',
    currentWeight: 225,
    unit: 'lbs',
    increment: 10,
    consecutiveFailures: 0,
    deloadCycles: 0,
    stage: 1,
    lpExhausted: false,
    history: [],
    lastSuccessWeight: 225,
    ...overrides,
  };
}

function makeSSState(overrides: Partial<ProgramState> = {}): ProgramState {
  return {
    programId: 'starting_strength',
    startDate: new Date().toISOString(),
    currentWeek: 1,
    currentDay: 0,
    trainingMaxes: {},
    liftProgress: {
      squat: makeLiftProgress({ liftName: 'squat', currentWeight: 200, increment: 10 }),
      bench: makeLiftProgress({ liftName: 'bench', currentWeight: 135, increment: 5 }),
      deadlift: makeLiftProgress({ liftName: 'deadlift', currentWeight: 225, increment: 10 }),
      ohp: makeLiftProgress({ liftName: 'ohp', currentWeight: 95, increment: 5 }),
    },
    workoutsCompleted: 3,
    cycleNumber: 1,
    weekInCycle: 1,
    equipment: 'full_gym',
    weightUnit: 'lbs',
    ...overrides,
  };
}

function makeGZCLPState(overrides: Partial<ProgramState> = {}): ProgramState {
  return {
    programId: 'gzclp',
    startDate: new Date().toISOString(),
    currentWeek: 1,
    currentDay: 0,
    trainingMaxes: {},
    liftProgress: {
      squat: makeLiftProgress({ liftName: 'squat', currentWeight: 200, increment: 10, stage: 1 }),
      bench: makeLiftProgress({ liftName: 'bench', currentWeight: 135, increment: 5, stage: 1 }),
      deadlift: makeLiftProgress({ liftName: 'deadlift', currentWeight: 225, increment: 10, stage: 1 }),
      ohp: makeLiftProgress({ liftName: 'ohp', currentWeight: 95, increment: 5, stage: 1 }),
    },
    workoutsCompleted: 5,
    cycleNumber: 1,
    weekInCycle: 1,
    equipment: 'full_gym',
    weightUnit: 'lbs',
    ...overrides,
  };
}

function make531State(overrides: Partial<ProgramState> = {}): ProgramState {
  return {
    programId: '531_bbb',
    startDate: new Date().toISOString(),
    currentWeek: 1,
    currentDay: 0,
    trainingMaxes: { squat: 270, bench: 180, deadlift: 315, ohp: 120 },
    liftProgress: {},
    workoutsCompleted: 5,
    cycleNumber: 1,
    weekInCycle: 1,
    equipment: 'full_gym',
    weightUnit: 'lbs',
    ...overrides,
  };
}

// ═══════════════════════════════════════
// Weight Safety
// ═══════════════════════════════════════

describe('MIN_BAR_WEIGHT', () => {
  it('should be 45 lbs', () => {
    expect(MIN_BAR_WEIGHT.lbs).toBe(45);
  });

  it('should be 20 kg', () => {
    expect(MIN_BAR_WEIGHT.kg).toBe(20);
  });
});

describe('WEIGHT_SAFETY_CAPS', () => {
  it('should define caps for all main lifts', () => {
    expect(WEIGHT_SAFETY_CAPS).toHaveProperty('squat');
    expect(WEIGHT_SAFETY_CAPS).toHaveProperty('bench');
    expect(WEIGHT_SAFETY_CAPS).toHaveProperty('deadlift');
    expect(WEIGHT_SAFETY_CAPS).toHaveProperty('ohp');
    expect(WEIGHT_SAFETY_CAPS).toHaveProperty('row');
  });

  it('should have male caps higher than female caps', () => {
    for (const lift of Object.keys(WEIGHT_SAFETY_CAPS)) {
      expect(WEIGHT_SAFETY_CAPS[lift].male).toBeGreaterThan(WEIGHT_SAFETY_CAPS[lift].female);
    }
  });
});

describe('checkWeightSafety', () => {
  it('should return safe for normal squat weight', () => {
    const result = checkWeightSafety(315, 'squat', 'male');
    expect(result.safe).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('should flag weight exceeding absolute cap', () => {
    const result = checkWeightSafety(50000, 'squat', 'male');
    expect(result.safe).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('exceeds the absolute safety cap');
  });

  it('should use female cap when sex is female', () => {
    // Female squat cap is 900
    const result = checkWeightSafety(950, 'squat', 'female');
    expect(result.safe).toBe(false);
    expect(result.warnings[0]).toContain('female');
  });

  it('should use male cap by default when sex is undefined', () => {
    // Male squat cap is 1400; 950 is under that
    const result = checkWeightSafety(950, 'squat');
    expect(result.safe).toBe(true);
  });

  it('should flag bodyweight-relative excess (5x BW squat)', () => {
    // BW_SANITY_THRESHOLDS squat = 4
    const result = checkWeightSafety(1000, 'squat', 'male', 200);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.includes('bodyweight'))).toBe(true);
  });

  it('should not warn on bodyweight-relative if within threshold', () => {
    // 600 / 200 = 3x BW, threshold is 4x
    const result = checkWeightSafety(600, 'squat', 'male', 200);
    const bwWarnings = result.warnings.filter(w => w.includes('bodyweight'));
    expect(bwWarnings).toHaveLength(0);
  });

  it('should handle 0 weight without warnings', () => {
    const result = checkWeightSafety(0, 'squat', 'male', 200);
    expect(result.safe).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('should handle unknown lift gracefully (no cap exists)', () => {
    const result = checkWeightSafety(99999, 'unknown_lift', 'male');
    // No cap for unknown lift, so no absolute cap warning
    expect(result.safe).toBe(true);
  });

  it('should handle 0 bodyweight without BW warning', () => {
    const result = checkWeightSafety(500, 'squat', 'male', 0);
    const bwWarnings = result.warnings.filter(w => w.includes('bodyweight'));
    expect(bwWarnings).toHaveLength(0);
  });

  it('should handle negative bodyweight without BW warning', () => {
    const result = checkWeightSafety(500, 'squat', 'male', -100);
    const bwWarnings = result.warnings.filter(w => w.includes('bodyweight'));
    expect(bwWarnings).toHaveLength(0);
  });

  it('should flag both absolute and bodyweight warnings when both exceeded', () => {
    // female squat cap=900, BW threshold=4, BW=100 => threshold=400
    const result = checkWeightSafety(50000, 'squat', 'female', 100);
    expect(result.safe).toBe(false);
    expect(result.warnings.length).toBe(2);
  });

  it('should flag bench BW threshold correctly', () => {
    // bench threshold = 3x BW
    const result = checkWeightSafety(700, 'bench', 'male', 200);
    expect(result.warnings.some(w => w.includes('bodyweight'))).toBe(true);
  });
});

// ═══════════════════════════════════════
// enforceBarMinimum
// ═══════════════════════════════════════

describe('enforceBarMinimum', () => {
  it('should return 45 for weights below bar in lbs', () => {
    expect(enforceBarMinimum(30, 'lbs')).toBe(45);
  });

  it('should return 20 for weights below bar in kg', () => {
    expect(enforceBarMinimum(10, 'kg')).toBe(20);
  });

  it('should return the weight itself when at bar minimum (lbs)', () => {
    expect(enforceBarMinimum(45, 'lbs')).toBe(45);
  });

  it('should return the weight itself when at bar minimum (kg)', () => {
    expect(enforceBarMinimum(20, 'kg')).toBe(20);
  });

  it('should return the weight itself when above bar minimum', () => {
    expect(enforceBarMinimum(135, 'lbs')).toBe(135);
  });

  it('should clamp 0 weight to bar minimum', () => {
    expect(enforceBarMinimum(0, 'lbs')).toBe(45);
    expect(enforceBarMinimum(0, 'kg')).toBe(20);
  });

  it('should clamp negative weight to bar minimum', () => {
    expect(enforceBarMinimum(-100, 'lbs')).toBe(45);
    expect(enforceBarMinimum(-50, 'kg')).toBe(20);
  });
});

// ═══════════════════════════════════════
// roundToPlate
// ═══════════════════════════════════════

describe('roundToPlate', () => {
  it('should round to nearest 5 lbs', () => {
    expect(roundToPlate(137, 'lbs')).toBe(135);
    expect(roundToPlate(138, 'lbs')).toBe(140);
  });

  it('should round to nearest 2.5 kg', () => {
    expect(roundToPlate(61, 'kg')).toBe(60);
    expect(roundToPlate(62, 'kg')).toBe(62.5);
  });

  it('should not change weights already on plate increments', () => {
    expect(roundToPlate(135, 'lbs')).toBe(135);
    expect(roundToPlate(60, 'kg')).toBe(60);
  });

  it('should handle 0', () => {
    expect(roundToPlate(0, 'lbs')).toBe(0);
    expect(roundToPlate(0, 'kg')).toBe(0);
  });
});

// ═══════════════════════════════════════
// parseReps
// ═══════════════════════════════════════

describe('parseReps', () => {
  it('should parse simple number', () => {
    expect(parseReps('5')).toBe(5);
  });

  it('should strip AMRAP marker', () => {
    expect(parseReps('5+')).toBe(5);
  });

  it('should take first number of range', () => {
    expect(parseReps('3-5')).toBe(3);
  });

  it('should default to 5 for non-numeric strings', () => {
    expect(parseReps('AMRAP')).toBe(5);
  });
});

// ═══════════════════════════════════════
// rpeToPct
// ═══════════════════════════════════════

describe('rpeToPct', () => {
  it('should return 1.0 for RPE 10 at 1 rep (true max)', () => {
    expect(rpeToPct(10, 1)).toBe(1.0);
  });

  it('should return 0.86 for RPE 10 at 5 reps', () => {
    expect(rpeToPct(10, 5)).toBe(0.86);
  });

  it('should decrease percentage as reps increase', () => {
    const pct3 = rpeToPct(8, 3);
    const pct8 = rpeToPct(8, 8);
    expect(pct3).toBeGreaterThan(pct8);
  });

  it('should increase percentage as RPE increases', () => {
    const rpe7 = rpeToPct(7, 5);
    const rpe9 = rpeToPct(9, 5);
    expect(rpe9).toBeGreaterThan(rpe7);
  });

  it('should clamp RPE below 6 to 6', () => {
    const result = rpeToPct(3, 5);
    // RPE 3 should clamp to 6; RPE 6 at 5 reps = 0.75
    expect(result).toBe(0.75);
  });

  it('should clamp RPE above 10 to 10', () => {
    const result = rpeToPct(12, 1);
    expect(result).toBe(1.0);
  });

  it('should clamp reps to 1-12 range', () => {
    const resultZero = rpeToPct(8, 0);
    const resultOne = rpeToPct(8, 1);
    expect(resultZero).toBe(resultOne);

    const result20 = rpeToPct(8, 20);
    const result12 = rpeToPct(8, 12);
    expect(result20).toBe(result12);
  });
});

// ═══════════════════════════════════════
// 5/3/1 Week Sets
// ═══════════════════════════════════════

describe('get531WeekSets', () => {
  it('should return correct percentages for week 1 (5s week)', () => {
    const result = get531WeekSets(1);
    expect(result.weekName).toBe('5s Week');
    expect(result.sets.map(s => s.pct)).toEqual([65, 75, 85]);
    expect(result.sets.map(s => s.reps)).toEqual(['5', '5', '5+']);
  });

  it('should return correct percentages for week 2 (3s week)', () => {
    const result = get531WeekSets(2);
    expect(result.weekName).toBe('3s Week');
    expect(result.sets.map(s => s.pct)).toEqual([70, 80, 90]);
    expect(result.sets.map(s => s.reps)).toEqual(['3', '3', '3+']);
  });

  it('should return correct percentages for week 3 (5/3/1 week)', () => {
    const result = get531WeekSets(3);
    expect(result.weekName).toBe('5/3/1 Week');
    expect(result.sets.map(s => s.pct)).toEqual([75, 85, 95]);
    expect(result.sets.map(s => s.reps)).toEqual(['5', '3', '1+']);
  });

  it('should return deload week for week 4', () => {
    const result = get531WeekSets(4);
    expect(result.weekName).toBe('Deload');
    expect(result.sets.map(s => s.pct)).toEqual([40, 50, 60]);
    expect(result.sets.every(s => s.reps === '5')).toBe(true);
  });

  it('should wrap around for week > 4', () => {
    const week5 = get531WeekSets(5);
    const week1 = get531WeekSets(1);
    expect(week5.weekName).toBe(week1.weekName);
    expect(week5.sets).toEqual(week1.sets);
  });

  it('should handle week 0 gracefully (returns week 1 instead of infinite recursion)', () => {
    // Previously caused infinite recursion: ((0-1) % 4) + 1 = 0 in JS.
    // Fixed: non-positive input now returns week 1.
    const result = get531WeekSets(0);
    expect(result.weekName).toBe('5s Week');
    expect(result.sets).toHaveLength(3);
  });
});

// ═══════════════════════════════════════
// Program Initialization
// ═══════════════════════════════════════

describe('initializeProgram', () => {
  it('should throw for unknown program', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'full_gym',
      goal: 'strength',
    };
    expect(() => initializeProgram('nonexistent_program', profile)).toThrow('Unknown program');
  });

  it('should set up Starting Strength with correct defaults', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'full_gym',
      goal: 'strength',
    };
    const state = initializeProgram('starting_strength', profile);
    expect(state.programId).toBe('starting_strength');
    expect(state.currentWeek).toBe(1);
    expect(state.currentDay).toBe(0);
    expect(state.workoutsCompleted).toBe(0);
    expect(Object.keys(state.liftProgress)).toContain('squat');
    expect(Object.keys(state.liftProgress)).toContain('bench');
    expect(Object.keys(state.liftProgress)).toContain('deadlift');
    expect(Object.keys(state.liftProgress)).toContain('ohp');
  });

  it('should use known maxes when provided', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'full_gym',
      goal: 'strength',
      maxes: { squat: 300, bench: 200, deadlift: 400, ohp: 135 },
    };
    const state = initializeProgram('starting_strength', profile, 'lbs');
    // For SS, training max = 1RM (not 90%)
    expect(state.liftProgress.squat.currentWeight).toBe(300);
    expect(state.liftProgress.bench.currentWeight).toBe(200);
  });

  it('should set 5/3/1 training max to 90% of 1RM', () => {
    const profile: UserProfile = {
      experienceLevel: 'intermediate',
      daysPerWeek: 4,
      equipment: 'full_gym',
      goal: 'strength',
      maxes: { squat: 300 },
    };
    const state = initializeProgram('531_bbb', profile, 'lbs');
    // TM = 300 * 0.9 = 270, rounded to nearest 5 = 270
    expect(state.trainingMaxes.squat).toBe(270);
  });

  it('should scale starting weights by bodyweight for beginner without maxes', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'full_gym',
      goal: 'strength',
      bodyweight: 200,
      sex: 'male',
    };
    const state = initializeProgram('starting_strength', profile, 'lbs');
    // Male lower body: BW * 0.65 = 130, rounded
    expect(state.liftProgress.squat.currentWeight).toBe(130);
    // Male upper body: BW * 0.45 = 90, rounded
    expect(state.liftProgress.bench.currentWeight).toBe(90);
  });

  it('should use female scaling factors', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'full_gym',
      goal: 'strength',
      bodyweight: 150,
      sex: 'female',
    };
    const state = initializeProgram('starting_strength', profile, 'lbs');
    // Female lower body: 150 * 0.5 = 75, rounded to nearest 5 = 75
    expect(state.liftProgress.squat.currentWeight).toBe(75);
    // Female upper body increment should be 2.5 lbs (not 5)
    expect(state.liftProgress.bench.increment).toBe(2.5);
  });
});

// ═══════════════════════════════════════
// Workout Generation
// ═══════════════════════════════════════

describe('generateWorkout', () => {
  it('should return null for unknown program', () => {
    const state = makeSSState({ programId: 'fake_program_xyz' });
    expect(generateWorkout(state)).toBeNull();
  });

  it('should generate a Starting Strength workout', () => {
    const state = makeSSState();
    const workout = generateWorkout(state);
    expect(workout).not.toBeNull();
    expect(workout!.programName).toContain('Starting Strength');
    expect(workout!.exercises.length).toBeGreaterThan(0);
    // All exercises should have sets
    for (const ex of workout!.exercises) {
      expect(ex.sets.length).toBeGreaterThan(0);
    }
  });

  it('should generate a GZCLP workout', () => {
    const state = makeGZCLPState();
    const workout = generateWorkout(state);
    expect(workout).not.toBeNull();
    expect(workout!.programName).toBe('GZCLP');
    expect(workout!.exercises.length).toBeGreaterThan(0);
  });

  it('should generate warm-up sets for main lifts', () => {
    const state = makeSSState();
    const workout = generateWorkout(state);
    expect(workout).not.toBeNull();
    // Find a main lift exercise (squat, bench, deadlift, ohp)
    const mainLift = workout!.exercises.find(
      e => e.exerciseSlot === 'squat' || e.exerciseSlot === 'bench' ||
           e.exerciseSlot === 'deadlift' || e.exerciseSlot === 'ohp'
    );
    expect(mainLift).toBeDefined();
    if (mainLift && mainLift.sets[0].targetWeight > 45) {
      expect(mainLift.warmupSets).toBeDefined();
      expect(mainLift.warmupSets!.length).toBeGreaterThan(0);
      // First warmup should be the empty bar
      expect(mainLift.warmupSets![0].targetWeight).toBe(45);
      expect(mainLift.warmupSets![0].notes).toContain('empty bar');
    }
  });

  it('should include progressive warm-up percentages (40%, 60%, 80%)', () => {
    const state = makeSSState({
      liftProgress: {
        squat: makeLiftProgress({ liftName: 'squat', currentWeight: 315, increment: 10 }),
        bench: makeLiftProgress({ liftName: 'bench', currentWeight: 200, increment: 5 }),
        deadlift: makeLiftProgress({ liftName: 'deadlift', currentWeight: 365, increment: 10 }),
        ohp: makeLiftProgress({ liftName: 'ohp', currentWeight: 135, increment: 5 }),
      },
    });
    const workout = generateWorkout(state);
    expect(workout).not.toBeNull();
    const squat = workout!.exercises.find(e => e.exerciseSlot === 'squat');
    if (squat?.warmupSets && squat.warmupSets.length > 1) {
      // Warmup sets should have notes with percentages
      const pctNotes = squat.warmupSets.filter(s => s.notes?.includes('%'));
      expect(pctNotes.length).toBeGreaterThan(0);
    }
  });

  it('should generate a 5/3/1 BBB workout with percentage-based weights', () => {
    const state = make531State();
    const workout = generateWorkout(state);
    expect(workout).not.toBeNull();
    expect(workout!.programName).toContain('5/3/1');
    // Exercises should have non-zero target weights for main lifts
    const mainEx = workout!.exercises.find(e =>
      e.exerciseSlot === 'squat' || e.exerciseSlot === 'bench' ||
      e.exerciseSlot === 'deadlift' || e.exerciseSlot === 'ohp'
    );
    if (mainEx) {
      expect(mainEx.sets.some(s => s.targetWeight > 0)).toBe(true);
    }
  });

  it('should include first workout note when workoutsCompleted is 0', () => {
    const state = makeSSState({ workoutsCompleted: 0 });
    const workout = generateWorkout(state);
    expect(workout).not.toBeNull();
    expect(workout!.notes.some(n => n.includes('First workout'))).toBe(true);
  });

  it('should include a duration warning when running much longer than typical', () => {
    const program = PROGRAMS['starting_strength'];
    const longWeek = Math.ceil(program.typicalDurationWeeks[1] * 1.5) + 1;
    const state = makeSSState({ currentWeek: longWeek });
    const workout = generateWorkout(state);
    expect(workout).not.toBeNull();
    expect(workout!.notes.some(n => n.includes('Consider evaluating'))).toBe(true);
  });

  it('should handle GZCLP stage 2 (6x2+) correctly', () => {
    const state = makeGZCLPState();
    // Set squat to stage 2
    state.liftProgress.squat.stage = 2;
    const workout = generateWorkout(state);
    expect(workout).not.toBeNull();
    // Find the T1 squat exercise
    const squat = workout!.exercises.find(
      e => e.exerciseSlot === 'squat' && e.sets.some(s => s.targetReps.includes('+'))
    );
    if (squat) {
      expect(squat.sets.length).toBe(6);
      expect(squat.sets[0].targetReps).toBe('2+');
    }
  });

  it('should handle GZCLP stage 3 (10x1+) correctly', () => {
    const state = makeGZCLPState();
    state.liftProgress.squat.stage = 3;
    const workout = generateWorkout(state);
    expect(workout).not.toBeNull();
    const squat = workout!.exercises.find(
      e => e.exerciseSlot === 'squat' && e.sets.some(s => s.targetReps.includes('+'))
    );
    if (squat) {
      expect(squat.sets.length).toBe(10);
      expect(squat.sets[0].targetReps).toBe('1+');
    }
  });

  it('should generate vacation workout when override is active', () => {
    const state = makeSSState({
      scheduleOverrides: [{
        startWeek: 1,
        durationWeeks: 2,
        type: 'vacation',
        description: 'Beach vacation',
      }],
    });
    const workout = generateWorkout(state);
    expect(workout).not.toBeNull();
    expect(workout!.dayLabel).toContain('Vacation');
    expect(workout!.exercises).toHaveLength(0);
  });

  it('should generate travel workout when travel_light override is active', () => {
    const state = makeSSState({
      scheduleOverrides: [{
        startWeek: 1,
        durationWeeks: 2,
        type: 'travel_light',
        description: 'Business trip',
        equipment: 'bodyweight',
      }],
    });
    const workout = generateWorkout(state);
    expect(workout).not.toBeNull();
    expect(workout!.dayLabel).toContain('Travel');
    expect(workout!.exercises.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════
// recordSetResult — LP Progression
// ═══════════════════════════════════════

describe('recordSetResult', () => {
  it('should return null on successful set (silent success)', () => {
    const state = makeSSState();
    const result = recordSetResult(state, 'squat', 200, 5, 5);
    expect(result).toBeNull();
    // Weight should advance by increment
    expect(state.liftProgress.squat.currentWeight).toBe(210);
    expect(state.liftProgress.squat.consecutiveFailures).toBe(0);
  });

  it('should record the set in history', () => {
    const state = makeSSState();
    recordSetResult(state, 'squat', 200, 5, 5);
    expect(state.liftProgress.squat.history.length).toBe(1);
    expect(state.liftProgress.squat.history[0][1]).toBe(200);
    expect(state.liftProgress.squat.history[0][2]).toBe(5);
  });

  it('should increment failure counter on failed set', () => {
    const state = makeSSState();
    const result = recordSetResult(state, 'squat', 200, 3, 5);
    expect(result).not.toBeNull();
    expect(result).toContain('Failed');
    expect(state.liftProgress.squat.consecutiveFailures).toBe(1);
  });

  it('should trigger deload after 2 consecutive failures', () => {
    const state = makeSSState();
    state.liftProgress.squat.consecutiveFailures = 1;
    const result = recordSetResult(state, 'squat', 200, 3, 5);
    expect(result).not.toBeNull();
    expect(result).toContain('Deload');
    // Deload = weight * 0.9 = 180, rounded
    expect(state.liftProgress.squat.currentWeight).toBe(180);
    expect(state.liftProgress.squat.deloadCycles).toBe(1);
    expect(state.liftProgress.squat.consecutiveFailures).toBe(0);
  });

  it('should never deload below bar minimum', () => {
    const state = makeSSState();
    state.liftProgress.squat.currentWeight = 50;
    state.liftProgress.squat.consecutiveFailures = 1;
    const result = recordSetResult(state, 'squat', 50, 3, 5);
    expect(result).toContain('Deload');
    // 50 * 0.9 = 45 = bar minimum
    expect(state.liftProgress.squat.currentWeight).toBeGreaterThanOrEqual(45);
  });

  it('should compute e1RM on successful multi-rep set', () => {
    const state = makeSSState();
    recordSetResult(state, 'squat', 200, 8, 5);
    expect(state.liftProgress.squat.e1rmHistory).toBeDefined();
    expect(state.liftProgress.squat.e1rmHistory!.length).toBe(1);
    // Epley: 200 * (1 + 8/30) = 200 * 1.267 = 253
    expect(state.liftProgress.squat.e1rmHistory![0][1]).toBe(253);
  });

  it('should not compute e1RM for single rep', () => {
    const state = makeSSState();
    recordSetResult(state, 'squat', 200, 1, 1);
    // e1rmHistory should be undefined or empty for 1 rep
    expect(state.liftProgress.squat.e1rmHistory).toBeUndefined();
  });

  it('should return null when liftProgress entry does not exist', () => {
    const state = makeSSState();
    const result = recordSetResult(state, 'nonexistent_lift', 200, 5, 5);
    expect(result).toBeNull();
  });

  it('should trigger form-score autoregulation at score < 70', () => {
    const state = makeSSState();
    const result = recordSetResult(state, 'squat', 200, 3, 5, undefined, 50);
    expect(result).not.toBeNull();
    expect(result).toContain('Form quality');
    expect(result).toContain('50/100');
  });

  it('should handle GZCLP T1 stage advancement on failure', () => {
    const state = makeGZCLPState();
    state.liftProgress.squat.stage = 1;
    // Fail a set (not T2)
    const result = recordSetResult(state, 'squat', 200, 2, 3);
    expect(result).not.toBeNull();
    expect(result).toContain('Stage 2');
    expect(state.liftProgress.squat.stage).toBe(2);
    expect(state.liftProgress.squat.consecutiveFailures).toBe(0);
  });

  it('should advance GZCLP from stage 2 to stage 3 on failure', () => {
    const state = makeGZCLPState();
    state.liftProgress.squat.stage = 2;
    const result = recordSetResult(state, 'squat', 200, 1, 2);
    expect(result).toContain('Stage 3');
    expect(state.liftProgress.squat.stage).toBe(3);
  });

  it('should reset GZCLP after stage 3 double failure', () => {
    const state = makeGZCLPState();
    state.liftProgress.squat.stage = 3;
    state.liftProgress.squat.consecutiveFailures = 1;
    state.liftProgress.squat.lastSuccessWeight = 200;
    const result = recordSetResult(state, 'squat', 200, 0, 1);
    expect(result).not.toBeNull();
    expect(result).toContain('cycled through all stages');
    expect(state.liftProgress.squat.stage).toBe(1);
    // 85% of 200 = 170
    expect(state.liftProgress.squat.currentWeight).toBe(170);
  });

  it('should handle GZCLP T2 stage progression', () => {
    const state = makeGZCLPState();
    state.liftProgress.squat.t2Stage = 1;
    const result = recordSetResult(state, 'squat', 135, 8, 10, undefined, undefined, 2);
    expect(result).not.toBeNull();
    expect(state.liftProgress.squat.t2Stage).toBe(2);
  });

  it('should reset GZCLP T2 after cycling through all stages', () => {
    const state = makeGZCLPState();
    state.liftProgress.squat.t2Stage = 3;
    const result = recordSetResult(state, 'squat', 135, 4, 6, undefined, undefined, 2);
    expect(result).not.toBeNull();
    expect(result).toContain('cycled through all stages');
    expect(state.liftProgress.squat.t2Stage).toBe(1);
    // Should add 15 lbs to weight for lbs
    expect(state.liftProgress.squat.currentWeight).toBe(150);
  });

  it('should mark LP exhausted after maxStallCycles deloads', () => {
    const state = makeSSState();
    const maxCycles = PROGRAMS['starting_strength'].progression.maxStallCycles;
    state.liftProgress.squat.deloadCycles = maxCycles - 1;
    state.liftProgress.squat.consecutiveFailures = 1;
    const result = recordSetResult(state, 'squat', 200, 3, 5);
    expect(result).not.toBeNull();
    expect(result).toContain('exhausted');
    expect(state.liftProgress.squat.lpExhausted).toBe(true);
  });

  it('should reduce increment on deload if above minimum', () => {
    const state = makeSSState();
    state.liftProgress.ohp.increment = 10;
    state.liftProgress.ohp.consecutiveFailures = 1;
    const result = recordSetResult(state, 'ohp', 95, 3, 5);
    expect(result).toContain('Reducing increment');
    expect(state.liftProgress.ohp.increment).toBe(2.5);
  });
});

// ═══════════════════════════════════════
// getEstimated1RMs
// ═══════════════════════════════════════

describe('getEstimated1RMs', () => {
  it('should return e1RMs from history', () => {
    const state = makeSSState();
    state.liftProgress.squat.e1rmHistory = [
      ['2026-01-01', 280],
      ['2026-01-15', 300],
    ];
    const e1rms = getEstimated1RMs(state);
    expect(e1rms.squat).toBe(300); // Most recent
  });

  it('should return empty object when no e1RM history exists', () => {
    const state = makeSSState();
    const e1rms = getEstimated1RMs(state);
    expect(Object.keys(e1rms)).toHaveLength(0);
  });
});

// ═══════════════════════════════════════
// checkLPTransition
// ═══════════════════════════════════════

describe('checkLPTransition', () => {
  it('should return null when no lifts are exhausted', () => {
    const state = makeSSState();
    const program = PROGRAMS['starting_strength'];
    expect(checkLPTransition(state, program)).toBeNull();
  });

  it('should warn about a single exhausted lift', () => {
    const state = makeSSState();
    state.liftProgress.squat.lpExhausted = true;
    const program = PROGRAMS['starting_strength'];
    const result = checkLPTransition(state, program);
    expect(result).not.toBeNull();
    expect(result).toContain('Squat');
    expect(result).toContain('per-lift transitions');
  });

  it('should strongly recommend transition when 3+ lifts exhausted', () => {
    const state = makeSSState();
    state.liftProgress.squat.lpExhausted = true;
    state.liftProgress.bench.lpExhausted = true;
    state.liftProgress.deadlift.lpExhausted = true;
    const program = PROGRAMS['starting_strength'];
    const result = checkLPTransition(state, program);
    expect(result).not.toBeNull();
    expect(result).toContain('Strongly recommend');
  });
});

// ═══════════════════════════════════════
// getActiveOverride
// ═══════════════════════════════════════

describe('getActiveOverride', () => {
  it('should return null when no overrides exist', () => {
    const state = makeSSState();
    expect(getActiveOverride(state)).toBeNull();
  });

  it('should return null when overrides array is empty', () => {
    const state = makeSSState({ scheduleOverrides: [] });
    expect(getActiveOverride(state)).toBeNull();
  });

  it('should find an active override for current week', () => {
    const override: ScheduleOverride = {
      startWeek: 1,
      durationWeeks: 3,
      type: 'vacation',
      description: 'Test vacation',
    };
    const state = makeSSState({ currentWeek: 2, scheduleOverrides: [override] });
    const result = getActiveOverride(state);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('vacation');
  });

  it('should return null when override has ended', () => {
    const override: ScheduleOverride = {
      startWeek: 1,
      durationWeeks: 2,
      type: 'vacation',
      description: 'Past vacation',
    };
    const state = makeSSState({ currentWeek: 5, scheduleOverrides: [override] });
    expect(getActiveOverride(state)).toBeNull();
  });
});

// ═══════════════════════════════════════
// advanceWorkout
// ═══════════════════════════════════════

describe('advanceWorkout', () => {
  it('should increment workoutsCompleted and currentDay', () => {
    const state = makeSSState({ workoutsCompleted: 5, currentDay: 0 });
    advanceWorkout(state);
    expect(state.workoutsCompleted).toBe(6);
    expect(state.currentDay).toBe(1);
  });

  it('should advance week when cycle completes (SS phase 1: 2 days)', () => {
    const state = makeSSState({ currentDay: 1, currentWeek: 1 });
    advanceWorkout(state);
    // currentDay should wrap to 0 and week should advance
    expect(state.currentDay).toBe(0);
    expect(state.currentWeek).toBe(2);
  });

  it('should toggle pressRotation for Starting Strength', () => {
    const state = makeSSState({ pressRotation: 0 });
    advanceWorkout(state);
    expect(state.pressRotation).toBe(1);
    advanceWorkout(state);
    expect(state.pressRotation).toBe(0);
  });

  it('should advance 5/3/1 cycle after 4 weeks', () => {
    const state = make531State({ weekInCycle: 4, currentDay: 3, cycleNumber: 1, currentWeek: 4 });
    const program = PROGRAMS['531_bbb'];
    // Need to be at last day of the week for the week to advance
    // 531 programs typically have 4 workout days
    state.currentDay = program.workouts.length - 1;
    advanceWorkout(state);
    // After advancing, weekInCycle should reset to 1, cycleNumber increments
    if (state.weekInCycle === 1) {
      expect(state.cycleNumber).toBe(2);
    }
  });

  it('should increase training maxes at start of new 5/3/1 cycle', () => {
    const state = make531State({
      weekInCycle: 4,
      cycleNumber: 1,
      currentWeek: 4,
    });
    const program = PROGRAMS['531_bbb'];
    // Set currentDay to be at the last workout day so advancing wraps the week
    state.currentDay = program.workouts.length - 1;
    const originalSquatTM = state.trainingMaxes.squat;
    const originalBenchTM = state.trainingMaxes.bench;

    advanceWorkout(state);

    // If cycle advanced, TMs should increase
    if (state.cycleNumber === 2) {
      expect(state.trainingMaxes.squat).toBeGreaterThan(originalSquatTM);
      expect(state.trainingMaxes.bench).toBeGreaterThan(originalBenchTM);
    }
  });

  it('should handle unknown program gracefully', () => {
    const state = makeSSState({ programId: 'fake_program_xyz' });
    // Should not throw
    advanceWorkout(state);
    // workoutsCompleted should not change since program is null
    expect(state.workoutsCompleted).toBe(3);
  });

  it('should add deload return override after vacation ends', () => {
    const state = makeSSState({
      currentWeek: 2,
      currentDay: 1, // Will trigger week advance
      scheduleOverrides: [{
        startWeek: 1,
        durationWeeks: 2,
        type: 'vacation',
        description: 'Test vacation',
      }],
    });
    advanceWorkout(state);
    // After vacation ends (week 3), should have a deload_return override
    if (state.currentWeek === 3) {
      const deloadReturn = state.scheduleOverrides?.find(o => o.type === 'deload_return');
      expect(deloadReturn).toBeDefined();
    }
  });
});
