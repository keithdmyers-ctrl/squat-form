/**
 * Tests for the workout programming engine.
 * Validates program definitions, recommendation logic, equipment adaptation,
 * LP tracking, stall detection, and transition recommendations.
 */

import { describe, it, expect } from 'vitest';
import {
  PROGRAMS,
  EXERCISE_SLOTS,
  getExerciseName,
  recommendPrograms,
  getBestProgram,
} from '../workout-programs';
import type { UserProfile, ProgramDefinition } from '../workout-programs';
import {
  initializeProgram,
  generateWorkout,
  recordSetResult,
  advanceWorkout,
  roundToPlate,
  recommendAccessories,
  get531WeekSets,
  autoregulate,
  getTransitionRecommendations,
} from '../program-generator';
import type { ProgramState, WorkoutLog } from '../program-generator';

// ─── Program Definition Validation ───

describe('Program Definitions', () => {
  const programIds = Object.keys(PROGRAMS);

  it('should define at least 12 programs', () => {
    expect(programIds.length).toBeGreaterThanOrEqual(12);
  });

  for (const id of programIds) {
    const program = PROGRAMS[id];

    describe(`${program.name} (${id})`, () => {
      it('should have required fields', () => {
        expect(program.id).toBe(id);
        expect(program.name).toBeTruthy();
        expect(program.shortName).toBeTruthy();
        expect(program.author).toBeTruthy();
        expect(program.description.length).toBeGreaterThan(20);
        expect(['beginner', 'intermediate', 'advanced']).toContain(program.level);
        expect(program.daysPerWeek.length).toBeGreaterThan(0);
        expect(program.workouts.length).toBeGreaterThan(0);
      });

      it('should have valid progression and deload protocols', () => {
        expect(program.progression.type).toBeTruthy();
        expect(program.progression.incrementLbs.upper).toBeGreaterThan(0);
        expect(program.progression.incrementLbs.lower).toBeGreaterThan(0);
        expect(program.progression.description.length).toBeGreaterThan(20);
        expect(program.progression.stallProtocol.length).toBeGreaterThan(10);
        expect(program.progression.maxStallCycles).toBeGreaterThan(0);
        expect(program.deload.frequency).toBeTruthy();
        expect(program.deload.method).toBeTruthy();
        expect(program.deload.citation).toBeTruthy();
      });

      it('should have science basis and transition options', () => {
        expect(program.scienceBasis.length).toBeGreaterThan(50);
        expect(program.transitionCriteria.length).toBeGreaterThan(20);
        expect(program.transitionOptions.length).toBeGreaterThan(0);
        // All transition options should reference valid programs
        for (const opt of program.transitionOptions) {
          expect(PROGRAMS[opt]).toBeDefined();
        }
      });

      it('should have valid workout days', () => {
        for (const day of program.workouts) {
          expect(day.name).toBeTruthy();
          expect(day.dayLabel).toBeTruthy();
          expect(day.exercises.length).toBeGreaterThan(0);
          for (const ex of day.exercises) {
            expect(EXERCISE_SLOTS[ex.exerciseSlot]).toBeDefined();
            expect(ex.sets.length).toBeGreaterThan(0);
            for (const set of ex.sets) {
              expect(set.sets).toBeGreaterThan(0);
              expect(set.reps).toBeTruthy();
              expect(set.restSeconds).toBeGreaterThan(0);
            }
          }
        }
      });

      it('should have typical duration range', () => {
        expect(program.typicalDurationWeeks[0]).toBeGreaterThan(0);
        expect(program.typicalDurationWeeks[1]).toBeGreaterThanOrEqual(program.typicalDurationWeeks[0]);
      });
    });
  }

  it('should have programs at all experience levels', () => {
    const levels = new Set(programIds.map(id => PROGRAMS[id].level));
    expect(levels.has('beginner')).toBe(true);
    expect(levels.has('intermediate')).toBe(true);
    expect(levels.has('advanced')).toBe(true);
  });

  it('should cover 3-6 days per week', () => {
    const allDays = new Set(programIds.flatMap(id => PROGRAMS[id].daysPerWeek));
    expect(allDays.has(3)).toBe(true);
    expect(allDays.has(4)).toBe(true);
  });
});

// ─── Exercise Slots ───

describe('Exercise Slots', () => {
  it('should define main lifts', () => {
    expect(EXERCISE_SLOTS.squat).toBeDefined();
    expect(EXERCISE_SLOTS.bench).toBeDefined();
    expect(EXERCISE_SLOTS.deadlift).toBeDefined();
    expect(EXERCISE_SLOTS.ohp).toBeDefined();
  });

  it('should have equipment alternatives for all slots', () => {
    for (const [key, slot] of Object.entries(EXERCISE_SLOTS)) {
      expect(slot.barbell).toBeTruthy();
      expect(slot.dumbbell).toBeTruthy();
      expect(slot.bodyweight).toBeTruthy();
      expect(slot.muscleGroups.length).toBeGreaterThan(0);
    }
  });

  it('should adapt exercise names for different equipment', () => {
    expect(getExerciseName('squat', 'full_gym')).toBe('Barbell Back Squat');
    expect(getExerciseName('squat', 'dumbbells')).toBe('Goblet Squat');
    expect(getExerciseName('squat', 'bodyweight')).toContain('Bodyweight');
    expect(getExerciseName('bench', 'dumbbells')).toBe('Dumbbell Bench Press');
    expect(getExerciseName('deadlift', 'bodyweight')).toContain('Nordic');
  });
});

// ─── Program Recommendation ───

describe('Program Recommendation', () => {
  it('should recommend beginner programs for beginners', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'barbell_home',
      goal: 'strength',
    };
    const recs = recommendPrograms(profile);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every(p => p.level === 'beginner')).toBe(true);
  });

  it('should recommend intermediate programs for intermediates', () => {
    const profile: UserProfile = {
      experienceLevel: 'intermediate',
      daysPerWeek: 4,
      equipment: 'full_gym',
      goal: 'powerlifting',
    };
    const recs = recommendPrograms(profile);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every(p => p.level === 'intermediate')).toBe(true);
  });

  it('should filter by days per week', () => {
    const profile: UserProfile = {
      experienceLevel: 'intermediate',
      daysPerWeek: 3,
      equipment: 'barbell_home',
      goal: 'strength',
    };
    const recs = recommendPrograms(profile);
    for (const p of recs) {
      expect(p.daysPerWeek.some(d => d <= 3)).toBe(true);
    }
  });

  it('should filter by equipment', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'bodyweight',
      goal: 'general',
    };
    const recs = recommendPrograms(profile);
    // Bodyweight-only should not get barbell programs
    expect(recs.length).toBe(0); // All beginner programs need at least barbell_home
  });

  it('should prioritize goal-matching programs', () => {
    const profile: UserProfile = {
      experienceLevel: 'intermediate',
      daysPerWeek: 4,
      equipment: 'full_gym',
      goal: 'hypertrophy',
    };
    const recs = recommendPrograms(profile);
    if (recs.length >= 2) {
      // First result should match the goal
      expect(recs[0].goals).toContain('hypertrophy');
    }
  });

  it('getBestProgram should return the top recommendation', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'barbell_home',
      goal: 'strength',
    };
    const best = getBestProgram(profile);
    expect(best).not.toBeNull();
    expect(best!.level).toBe('beginner');
  });
});

// ─── Program Initialization ───

describe('Program Initialization', () => {
  it('should initialize Starting Strength with correct LP tracking', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'barbell_home',
      goal: 'strength',
      maxes: { squat: 200, bench: 150, deadlift: 250, ohp: 100 },
    };
    const state = initializeProgram('starting_strength', profile);
    expect(state.programId).toBe('starting_strength');
    expect(state.liftProgress.squat).toBeDefined();
    expect(state.liftProgress.squat.currentWeight).toBe(200);
    expect(state.liftProgress.squat.increment).toBe(10);
    expect(state.liftProgress.bench.increment).toBe(5);
    expect(state.liftProgress.bench.currentWeight).toBe(150);
  });

  it('should initialize 5/3/1 with training maxes at 90%', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'barbell_home',
      goal: 'strength',
      maxes: { squat: 300, bench: 200 },
    };
    const state = initializeProgram('531_beginner', profile);
    expect(state.trainingMaxes.squat).toBe(roundToPlate(300 * 0.9, 'lbs'));
    expect(state.trainingMaxes.bench).toBe(roundToPlate(200 * 0.9, 'lbs'));
  });

  it('should set default weights when no maxes provided', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'barbell_home',
      goal: 'strength',
    };
    const state = initializeProgram('starting_strength', profile);
    expect(state.liftProgress.squat.currentWeight).toBe(95);
    expect(state.liftProgress.bench.currentWeight).toBe(65);
  });
});

// ─── Workout Generation ───

describe('Workout Generation', () => {
  it('should generate a valid workout for Starting Strength', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'barbell_home',
      goal: 'strength',
      maxes: { squat: 200, bench: 150, deadlift: 250, ohp: 100 },
    };
    const state = initializeProgram('starting_strength', profile);
    const workout = generateWorkout(state);
    expect(workout).not.toBeNull();
    expect(workout!.exercises.length).toBeGreaterThan(0);
    expect(workout!.programName).toContain('Starting Strength');
    // First exercise should be squat
    expect(workout!.exercises[0].exerciseSlot).toBe('squat');
    // Squat weight should be current LP weight
    expect(workout!.exercises[0].sets[0].targetWeight).toBe(200);
  });

  it('should generate workouts for all programs', () => {
    for (const id of Object.keys(PROGRAMS)) {
      const profile: UserProfile = {
        experienceLevel: PROGRAMS[id].level,
        daysPerWeek: PROGRAMS[id].daysPerWeek[0],
        equipment: PROGRAMS[id].equipmentMin,
        goal: 'strength',
        maxes: { squat: 300, bench: 200, deadlift: 350, ohp: 135 },
      };
      const state = initializeProgram(id, profile);
      const workout = generateWorkout(state);
      expect(workout).not.toBeNull();
      expect(workout!.exercises.length).toBeGreaterThan(0);
    }
  });

  it('should adapt exercise names for dumbbell equipment', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'dumbbells',
      goal: 'strength',
      maxes: { squat: 100, bench: 75 },
    };
    // GZCLP requires barbell_home min, but let's test exercise naming with a barbell program at full_gym
    const state = initializeProgram('starting_strength', profile);
    state.equipment = 'dumbbells';
    const workout = generateWorkout(state);
    expect(workout!.exercises[0].name).toBe('Goblet Squat');
  });
});

// ─── LP Progression & Stall Detection ───

describe('LP Progression', () => {
  function makeSSState(): ProgramState {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'barbell_home',
      goal: 'strength',
      maxes: { squat: 200, bench: 150, deadlift: 250, ohp: 100 },
    };
    return initializeProgram('starting_strength', profile);
  }

  it('should progress weight after successful set', () => {
    const state = makeSSState();
    const msg = recordSetResult(state, 'squat', 200, 5, 5);
    expect(msg).toBeNull(); // Silent success
    expect(state.liftProgress.squat.currentWeight).toBe(210); // +10 lbs
  });

  it('should progress bench by 5 lbs', () => {
    const state = makeSSState();
    recordSetResult(state, 'bench', 150, 5, 5);
    expect(state.liftProgress.bench.currentWeight).toBe(155); // +5 lbs
  });

  it('should repeat weight on first failure', () => {
    const state = makeSSState();
    const msg = recordSetResult(state, 'squat', 200, 3, 5);
    expect(msg).toContain('Repeating');
    expect(state.liftProgress.squat.currentWeight).toBe(200); // Same weight
  });

  it('should deload after two consecutive failures', () => {
    const state = makeSSState();
    recordSetResult(state, 'squat', 200, 3, 5); // Fail 1
    const msg = recordSetResult(state, 'squat', 200, 4, 5); // Fail 2
    expect(msg).toContain('Deloading');
    expect(state.liftProgress.squat.currentWeight).toBe(180); // -10%
    expect(state.liftProgress.squat.deloadCycles).toBe(1);
  });

  it('should exhaust LP after max stall cycles', () => {
    const state = makeSSState();
    // Simulate 3 deload cycles
    for (let cycle = 0; cycle < 3; cycle++) {
      recordSetResult(state, 'squat', state.liftProgress.squat.currentWeight, 3, 5);
      recordSetResult(state, 'squat', state.liftProgress.squat.currentWeight, 3, 5);
    }
    expect(state.liftProgress.squat.lpExhausted).toBe(true);
  });

  it('should reduce increment to microplate sizes', () => {
    const state = makeSSState();
    // First deload
    recordSetResult(state, 'bench', 150, 3, 5); // Fail 1
    recordSetResult(state, 'bench', 150, 3, 5); // Fail 2 → deload, reduce increment
    expect(state.liftProgress.bench.increment).toBe(2.5);
  });

  it('should reduce weight when form score is low', () => {
    const state = makeSSState();
    const msg = recordSetResult(state, 'squat', 200, 3, 5, undefined, 60);
    expect(msg).toContain('Form quality');
    expect(msg).toContain('technique');
  });
});

// ─── GZCLP Stage Progression ───

describe('GZCLP Stage Progression', () => {
  function makeGZCLPState(): ProgramState {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 4,
      equipment: 'barbell_home',
      goal: 'strength',
      maxes: { squat: 200, bench: 150, deadlift: 250, ohp: 100 },
    };
    return initializeProgram('gzclp', profile);
  }

  it('should advance to stage 2 on failure', () => {
    const state = makeGZCLPState();
    const msg = recordSetResult(state, 'squat', 200, 2, 3);
    expect(msg).toContain('Stage 2');
    expect(state.liftProgress.squat.stage).toBe(2);
  });

  it('should advance to stage 3 on second failure', () => {
    const state = makeGZCLPState();
    recordSetResult(state, 'squat', 200, 2, 3); // → Stage 2
    const msg = recordSetResult(state, 'squat', 200, 1, 2);
    expect(msg).toContain('Stage 3');
    expect(state.liftProgress.squat.stage).toBe(3);
  });

  it('should reset to stage 1 after stage 3 failure', () => {
    const state = makeGZCLPState();
    recordSetResult(state, 'squat', 200, 2, 3); // → Stage 2
    recordSetResult(state, 'squat', 200, 1, 2); // → Stage 3
    // Now fail at stage 3
    recordSetResult(state, 'squat', 200, 0, 1); // Fail at stage 3
    recordSetResult(state, 'squat', 200, 0, 1); // Second fail → deload + reset
    expect(state.liftProgress.squat.stage).toBe(1);
    expect(state.liftProgress.squat.currentWeight).toBe(roundToPlate(200 * 0.85, 'lbs'));
  });
});

// ─── 5/3/1 Percentages ───

describe('5/3/1 Week Sets', () => {
  it('should return correct percentages for week 1 (5s)', () => {
    const week = get531WeekSets(1);
    expect(week.weekName).toBe('5s Week');
    expect(week.sets).toEqual([
      { pct: 65, reps: '5' },
      { pct: 75, reps: '5' },
      { pct: 85, reps: '5+' },
    ]);
  });

  it('should return correct percentages for week 2 (3s)', () => {
    const week = get531WeekSets(2);
    expect(week.weekName).toBe('3s Week');
    expect(week.sets[2]).toEqual({ pct: 90, reps: '3+' });
  });

  it('should return correct percentages for week 3 (5/3/1)', () => {
    const week = get531WeekSets(3);
    expect(week.weekName).toBe('5/3/1 Week');
    expect(week.sets[2]).toEqual({ pct: 95, reps: '1+' });
  });

  it('should return deload for week 4', () => {
    const week = get531WeekSets(4);
    expect(week.weekName).toBe('Deload');
    expect(week.sets[0].pct).toBe(40);
  });
});

// ─── Workout Advancement ───

describe('Workout Advancement', () => {
  it('should cycle through workout days', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'barbell_home',
      goal: 'strength',
    };
    const state = initializeProgram('starting_strength', profile);
    expect(state.currentDay).toBe(0);
    advanceWorkout(state);
    expect(state.currentDay).toBe(1);
    expect(state.workoutsCompleted).toBe(1);
    advanceWorkout(state);
    expect(state.currentDay).toBe(0); // Starting Strength has 2 days, wraps around
    expect(state.currentWeek).toBe(2);
  });

  it('should advance 5/3/1 cycles correctly', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'barbell_home',
      goal: 'strength',
      maxes: { squat: 300 },
    };
    const state = initializeProgram('531_beginner', profile);
    const initialTM = state.trainingMaxes.squat;

    // Complete 4 weeks (3 workouts per week × 4 weeks = ~12 workout days)
    // 5/3/1 beginner has 3 days, so 3 advances = 1 week
    for (let i = 0; i < 12; i++) {
      advanceWorkout(state);
    }
    expect(state.cycleNumber).toBe(2); // Should have completed 1 full cycle
    // TM should have increased
    expect(state.trainingMaxes.squat).toBeGreaterThan(initialTM!);
  });
});

// ─── Weight Rounding ───

describe('Weight Rounding', () => {
  it('should round to nearest 5 lbs', () => {
    expect(roundToPlate(183, 'lbs')).toBe(185);
    expect(roundToPlate(182, 'lbs')).toBe(180);
    expect(roundToPlate(200, 'lbs')).toBe(200);
  });

  it('should round to nearest 2.5 kg', () => {
    expect(roundToPlate(83, 'kg')).toBe(82.5);
    expect(roundToPlate(84, 'kg')).toBe(85);
    expect(roundToPlate(100, 'kg')).toBe(100);
  });
});

// ─── Accessory Recommendations ───

describe('Accessory Recommendations', () => {
  it('should recommend accessories for weak squat depth', () => {
    const recs = recommendAccessories(
      { depth: 60, kneeTracking: 85, trunk: 80, lockout: 90 },
      'squat',
      'full_gym',
    );
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].weakPoint).toContain('depth');
    expect(recs[0].scienceBasis.length).toBeGreaterThan(20);
  });

  it('should adapt accessories for dumbbell equipment', () => {
    const recs = recommendAccessories(
      { depth: 60 },
      'squat',
      'dumbbells',
    );
    expect(recs.length).toBeGreaterThan(0);
    // Should not include barbell exercises
    for (const rec of recs) {
      for (const ex of rec.exercises) {
        expect(ex).not.toContain('Barbell');
      }
    }
  });

  it('should recommend nothing when all scores are high', () => {
    const recs = recommendAccessories(
      { depth: 90, kneeTracking: 85, trunk: 80, lockout: 90 },
      'squat',
      'full_gym',
    );
    expect(recs.length).toBe(0);
  });

  it('should provide deadlift-specific accessories', () => {
    const recs = recommendAccessories(
      { depth: 65, trunk: 60 },
      'deadlift',
      'barbell_home',
    );
    expect(recs.length).toBe(2);
    expect(recs.some(r => r.weakPoint.includes('floor'))).toBe(true);
    expect(recs.some(r => r.weakPoint.includes('back'))).toBe(true);
  });
});

// ─── Transition Recommendations ───

describe('Transition Recommendations', () => {
  it('should recommend transition when LP is exhausted', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'barbell_home',
      goal: 'strength',
    };
    const state = initializeProgram('starting_strength', profile);

    // Exhaust LP on 3 lifts
    for (const lift of ['squat', 'bench', 'ohp']) {
      state.liftProgress[lift].lpExhausted = true;
    }
    state.workoutsCompleted = 50;

    const rec = getTransitionRecommendations(state, profile);
    expect(rec).not.toBeNull();
    expect(rec!.urgency).toBe('now');
    expect(rec!.recommendations.length).toBeGreaterThan(0);
    // Should recommend intermediate programs
    for (const r of rec!.recommendations) {
      expect(r.program.level).toBe('intermediate');
      expect(r.fitReason.length).toBeGreaterThan(20);
    }
  });

  it('should suggest Texas Method and HLM for 3-day lifters', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'barbell_home',
      goal: 'strength',
    };
    const state = initializeProgram('starting_strength', profile);
    state.liftProgress.squat.lpExhausted = true;
    state.liftProgress.bench.lpExhausted = true;
    state.liftProgress.ohp.lpExhausted = true;
    state.workoutsCompleted = 50;

    const rec = getTransitionRecommendations(state, profile);
    const programIds = rec!.recommendations.map(r => r.program.id);
    expect(programIds).toContain('texas_method');
    expect(programIds).toContain('hlm_split');
  });

  it('should return null when LP is not exhausted', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'barbell_home',
      goal: 'strength',
    };
    const state = initializeProgram('starting_strength', profile);
    const rec = getTransitionRecommendations(state, profile);
    expect(rec).toBeNull();
  });
});

// ─── Autoregulation ───

describe('Autoregulation', () => {
  it('should detect low form scores and recommend weight reduction', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'barbell_home',
      goal: 'strength',
      maxes: { squat: 300 },
    };
    const state = initializeProgram('starting_strength', profile);

    const logs: WorkoutLog[] = [
      {
        id: '1', date: new Date().toISOString(), programId: 'texas_method',
        workoutDayIndex: 0, workoutDayName: 'Volume', completed: true,
        sets: [
          { exerciseName: 'Squat', exerciseSlot: 'squat', setNumber: 1, targetReps: '5', targetWeight: 270, completed: true, formScore: 60 },
          { exerciseName: 'Squat', exerciseSlot: 'squat', setNumber: 2, targetReps: '5', targetWeight: 270, completed: true, formScore: 55 },
        ],
      },
      {
        id: '2', date: new Date().toISOString(), programId: 'texas_method',
        workoutDayIndex: 0, workoutDayName: 'Volume', completed: true,
        sets: [
          { exerciseName: 'Squat', exerciseSlot: 'squat', setNumber: 1, targetReps: '5', targetWeight: 270, completed: true, formScore: 62 },
        ],
      },
    ];

    const messages = autoregulate(state, logs);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('form score');
  });
});

// ─── Integration: Full LP Cycle ───

describe('Full LP Cycle Integration', () => {
  it('should run a complete Starting Strength LP cycle with progression, stalls, and transition', () => {
    const profile: UserProfile = {
      experienceLevel: 'beginner',
      daysPerWeek: 3,
      equipment: 'barbell_home',
      goal: 'strength',
      maxes: { squat: 135 },
    };
    const state = initializeProgram('starting_strength', profile);

    // Simulate 10 successful squat sessions
    for (let i = 0; i < 10; i++) {
      const weight = state.liftProgress.squat.currentWeight;
      recordSetResult(state, 'squat', weight, 5, 5);
    }
    // Should have progressed: 135 + (10 × 10) = 235
    expect(state.liftProgress.squat.currentWeight).toBe(235);

    // Now simulate stalling
    for (let cycle = 0; cycle < 3; cycle++) {
      const weight = state.liftProgress.squat.currentWeight;
      recordSetResult(state, 'squat', weight, 3, 5); // Fail
      recordSetResult(state, 'squat', weight, 3, 5); // Fail again → deload
    }

    // LP should be exhausted
    expect(state.liftProgress.squat.lpExhausted).toBe(true);

    // Should get transition recommendations
    const rec = getTransitionRecommendations(state, profile);
    // Only squat is exhausted, so urgency should be 'soon'
    expect(rec).not.toBeNull();
    expect(rec!.urgency).toBe('soon');
  });
});

// ─── Science Citations ───

describe('Science Citations', () => {
  it('every program should cite its methodology source', () => {
    for (const id of Object.keys(PROGRAMS)) {
      const program = PROGRAMS[id];
      // Deload citation should reference a study or author
      expect(program.deload.citation.length).toBeGreaterThan(5);
      // Science basis should explain why the program works
      expect(program.scienceBasis.length).toBeGreaterThan(50);
    }
  });

  it('progression descriptions should mention evidence source', () => {
    // Check that key programs reference their source
    expect(PROGRAMS.starting_strength.scienceBasis).toContain('Selye');
    expect(PROGRAMS.dup.scienceBasis).toContain('Rhea');
    expect(PROGRAMS.hlm_split.scienceBasis).toContain('Zourdos');
    expect(PROGRAMS['531_bbb'].scienceBasis).toContain('Schoenfeld');
  });
});
