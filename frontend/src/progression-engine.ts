/**
 * Progression engine: program initialization, workout generation,
 * set result recording, LP stall detection, and week/cycle advancement.
 *
 * Evidence basis:
 * - LP exhaustion criteria: Rippetoe (2011), Baker (2015)
 * - Autoregulation: Zourdos et al. (2016), Helms et al. (2016)
 * - Deload protocols: PMC10948666, PMC10511399
 */

import type { ProgramDefinition, UserProfile, EquipmentLevel } from './workout-programs';
import { PROGRAMS, EXERCISE_SLOTS, getExerciseName } from './workout-programs';
import type { ProgramState, LiftProgress, WorkoutLog, SessionDifficulty, ScheduleOverride } from './workout-storage';
import { loadWorkoutLogs, loadUserProfile } from './workout-storage';

// ─── Weight Safety Caps ───

/**
 * Absolute weight ceilings per lift, by sex (lbs).
 * Based on all-time world records plus a margin.
 * Any calculated weight exceeding these is clamped.
 */
export const WEIGHT_SAFETY_CAPS: Record<string, { male: number; female: number }> = {
  squat: { male: 1400, female: 900 },      // World records ~1306/882 lbs
  bench: { male: 800, female: 600 },        // World records ~783/457 lbs
  deadlift: { male: 1200, female: 700 },    // World records ~1105/636 lbs
  ohp: { male: 500, female: 300 },          // Reasonable ceiling
  row: { male: 600, female: 400 },          // Reasonable ceiling
};

/**
 * Minimum bar weight — weight recommendations should never go below
 * an empty barbell.
 */
export const MIN_BAR_WEIGHT = { lbs: 45, kg: 20 };

/**
 * Bodyweight-relative sanity thresholds.
 * If a recommended weight exceeds these multiples of bodyweight,
 * a warning is generated.
 */
const BW_SANITY_THRESHOLDS: Record<string, number> = {
  squat: 4,
  deadlift: 4,
  bench: 3,
  ohp: 2,
  row: 2.5,
};

/**
 * Check whether a recommended weight is within safe bounds.
 * Returns warnings if the weight exceeds absolute caps or
 * bodyweight-relative sanity thresholds.
 */
export function checkWeightSafety(
  weight: number,
  lift: string,
  sex?: string,
  bodyweight?: number,
): { safe: boolean; warnings: string[] } {
  const warnings: string[] = [];
  let safe = true;

  // Absolute cap check
  const caps = WEIGHT_SAFETY_CAPS[lift];
  if (caps) {
    const capForSex = sex === 'female' ? caps.female : caps.male;
    if (weight > capForSex) {
      safe = false;
      warnings.push(
        `${lift} weight ${weight} lbs exceeds the absolute safety cap of ${capForSex} lbs ` +
        `(based on ${sex === 'female' ? 'female' : 'male'} world records). Weight has been clamped.`
      );
    }
  }

  // Bodyweight-relative sanity check
  if (bodyweight && bodyweight > 0) {
    const threshold = BW_SANITY_THRESHOLDS[lift];
    if (threshold && weight > bodyweight * threshold) {
      warnings.push(
        `${lift} weight ${weight} lbs exceeds ${threshold}x bodyweight (${bodyweight} lbs). ` +
        `This is an unusually high ratio — verify the weight is correct.`
      );
    }
  }

  return { safe, warnings };
}

/**
 * Clamp a weight to the safety cap for a given lift and sex.
 * Returns the clamped weight and whether clamping occurred.
 */
function clampToSafetyCap(weight: number, lift: string, sex?: string): { weight: number; clamped: boolean } {
  const caps = WEIGHT_SAFETY_CAPS[lift];
  if (!caps) return { weight, clamped: false };
  const capForSex = sex === 'female' ? caps.female : caps.male;
  if (weight > capForSex) {
    return { weight: capForSex, clamped: true };
  }
  return { weight, clamped: false };
}

/**
 * Ensure a weight never goes below the empty bar.
 */
export function enforceBarMinimum(weight: number, unit: string): number {
  const minWeight = unit === 'kg' ? MIN_BAR_WEIGHT.kg : MIN_BAR_WEIGHT.lbs;
  return Math.max(weight, minWeight);
}

// ─── Generated Workout Types ───

export interface GeneratedWorkout {
  dayName: string;
  dayLabel: string;
  exercises: GeneratedExercise[];
  programName: string;
  weekLabel: string;
  notes: string[];
  /** Science basis for today's prescription */
  scienceNote: string;
}

export interface GeneratedExercise {
  name: string;
  exerciseSlot: string;
  sets: GeneratedSet[];
  warmupSets?: GeneratedSet[];
  notes?: string;
}

export interface GeneratedSet {
  setNumber: number;
  targetReps: string;
  targetWeight: number;
  intensityPct?: number;
  rpe?: number;
  restSeconds: number;
  notes?: string;
  isAmrap: boolean;
}

// ─── 5/3/1 Percentage Helpers (for UI display) ───

export interface FiveThirtyOneWeekSets {
  weekName: string;
  sets: Array<{ pct: number; reps: string }>;
}

export function get531WeekSets(weekInCycle: number): FiveThirtyOneWeekSets {
  switch (weekInCycle) {
    case 1: return { weekName: '5s Week', sets: [
      { pct: 65, reps: '5' }, { pct: 75, reps: '5' }, { pct: 85, reps: '5+' },
    ] };
    case 2: return { weekName: '3s Week', sets: [
      { pct: 70, reps: '3' }, { pct: 80, reps: '3' }, { pct: 90, reps: '3+' },
    ] };
    case 3: return { weekName: '5/3/1 Week', sets: [
      { pct: 75, reps: '5' }, { pct: 85, reps: '3' }, { pct: 95, reps: '1+' },
    ] };
    case 4: return { weekName: 'Deload', sets: [
      { pct: 40, reps: '5' }, { pct: 50, reps: '5' }, { pct: 60, reps: '5' },
    ] };
    default: return get531WeekSets(((weekInCycle - 1) % 4) + 1);
  }
}

// ─── Weight Rounding ───

export function roundToPlate(weight: number, unit: string): number {
  const increment = unit === 'kg' ? 2.5 : 5;
  return Math.round(weight / increment) * increment;
}

// ─── Utilities ───

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Program Initialization ───

/**
 * Initialize a new program state from a selected program and user profile.
 */
export function initializeProgram(
  programId: string,
  profile: UserProfile,
  weightUnit: string = 'lbs',
): ProgramState {
  const program = PROGRAMS[programId];
  if (!program) throw new Error(`Unknown program: ${programId}`);

  const state: ProgramState = {
    programId,
    startDate: new Date().toISOString(),
    currentWeek: 1,
    currentDay: 0,
    trainingMaxes: {},
    liftProgress: {},
    workoutsCompleted: 0,
    cycleNumber: 1,
    weekInCycle: 1,
    equipment: profile.equipment,
    weightUnit,
  };

  // Set up training maxes from known 1RMs (TM = 90% of 1RM for 5/3/1)
  const mainLifts = ['squat', 'bench', 'deadlift', 'ohp'];
  for (const lift of mainLifts) {
    const known1RM = profile.maxes?.[lift];
    if (known1RM && known1RM > 0) {
      // 5/3/1 uses 90% of 1RM as Training Max; nSuns uses 100%
      if (programId.startsWith('531')) {
        state.trainingMaxes[lift] = roundToPlate(known1RM * 0.9, weightUnit);
      } else if (programId === 'nsuns') {
        state.trainingMaxes[lift] = roundToPlate(known1RM, weightUnit);
      } else {
        state.trainingMaxes[lift] = roundToPlate(known1RM, weightUnit);
      }
    }
  }

  // Set up LP progress tracking for beginner programs
  if (program.level === 'beginner' || program.progression.type === 'linear_session') {
    const defaultLower = weightUnit === 'kg' ? 40 : 95;
    const defaultUpper = weightUnit === 'kg' ? 30 : 65;
    for (const lift of mainLifts) {
      const isLower = lift === 'squat' || lift === 'deadlift';
      const progress: LiftProgress = {
        liftName: lift,
        currentWeight: state.trainingMaxes[lift] ?? (isLower ? defaultLower : defaultUpper),
        unit: weightUnit,
        increment: isLower
          ? program.progression.incrementLbs.lower
          : program.progression.incrementLbs.upper,
        consecutiveFailures: 0,
        deloadCycles: 0,
        stage: 1,
        lpExhausted: false,
        history: [],
        lastSuccessWeight: state.trainingMaxes[lift] ?? (isLower ? defaultLower : defaultUpper),
      };

      // Scale default weights by bodyweight and sex when no known maxes
      if (profile.bodyweight && profile.bodyweight > 0 && !profile.maxes?.[lift]) {
        const bw = profile.bodyweight;
        const isFemale = profile.sex === 'female';
        // Conservative starting percentages of bodyweight
        if (isLower) {
          progress.currentWeight = roundToPlate(bw * (isFemale ? 0.5 : 0.65), weightUnit);
        } else {
          progress.currentWeight = roundToPlate(bw * (isFemale ? 0.3 : 0.45), weightUnit);
        }
        progress.lastSuccessWeight = progress.currentWeight;
        // Female upper body increment: 2.5 instead of 5
        if (isFemale && !isLower) {
          progress.increment = weightUnit === 'kg' ? 1.25 : 2.5;
        }
      }

      state.liftProgress[lift] = progress;
    }
  }

  // Meet date integration for block periodization
  if (programId === 'block_periodization' && profile.meetDate) {
    const today = new Date();
    const meet = new Date(profile.meetDate);
    const totalWeeks = Math.max(4, Math.ceil((meet.getTime() - today.getTime()) / (7 * 86400000)));
    const peakWeeks = Math.max(2, Math.round(totalWeeks * 0.2));
    const strWeeks = Math.round((totalWeeks - peakWeeks) * 0.5);
    const hypWeeks = totalWeeks - strWeeks - peakWeeks;
    state.meetDate = profile.meetDate;
    state.blockBoundaries = { hyp: 1, str: hypWeeks + 1, peak: hypWeeks + strWeeks + 1 };
  }

  return state;
}

// ─── Warm-up Set Generation ───

function generateWarmupSets(workWeight: number, unit: string): GeneratedSet[] {
  if (workWeight <= 0) return [];
  const barWeight = unit === 'kg' ? 20 : 45;
  if (workWeight <= barWeight) return [];

  const warmups: GeneratedSet[] = [];
  // Empty bar
  warmups.push({ setNumber: 0, targetReps: '5', targetWeight: barWeight, restSeconds: 60, isAmrap: false, notes: 'Warm-up: empty bar' });

  // Progressive warm-up sets at 40%, 60%, 80% of working weight
  const pcts = [0.4, 0.6, 0.8];
  const reps = ['5', '3', '2'];
  for (let i = 0; i < pcts.length; i++) {
    const w = roundToPlate(workWeight * pcts[i], unit);
    if (w > barWeight) {
      warmups.push({ setNumber: 0, targetReps: reps[i], targetWeight: w, restSeconds: 60, isAmrap: false, notes: `Warm-up: ${Math.round(pcts[i] * 100)}%` });
    }
  }
  return warmups;
}

// ─── Workout Generation ───

/**
 * Generate today's workout from the current program state.
 */
export function generateWorkout(state: ProgramState): GeneratedWorkout | null {
  const program = PROGRAMS[state.programId];
  if (!program) return null;

  // Check for active schedule overrides
  const activeOverride = getActiveOverride(state);
  if (activeOverride) {
    // Vacation mode: generate a minimal maintenance workout
    if (activeOverride.type === 'vacation') {
      return generateVacationWorkout(state, program);
    }

    // Travel light mode: bodyweight/dumbbell workout
    if (activeOverride.type === 'travel_light') {
      return generateTravelWorkout(state, program, activeOverride);
    }
  }

  // Determine which workout day to do
  let dayIndex: number;
  if (program.id === 'starting_strength') {
    // Phase-aware day selection: each phase has its own set of workout templates
    const phase = state.lpPhase ?? 1;
    let dayOffset: number;
    let daysInPhase: number;
    if (phase <= 2) {
      dayOffset = (phase - 1) * 2; // Phase 1: 0-1, Phase 2: 2-3
      daysInPhase = 2;
    } else {
      dayOffset = 4 + (phase - 3) * 3; // Phase 3: 4-6, Phase 4: 7-9, Phase 5: 10-12
      daysInPhase = 3;
    }
    dayIndex = dayOffset + (state.currentDay % daysInPhase);
  } else if (program.id === 'block_periodization') {
    // Block-aware day selection: restrict to current block's workouts
    const bounds = state.blockBoundaries ?? { hyp: 1, str: 6, peak: 11 };
    const blockDayOffset = state.currentWeek < bounds.str ? 0 : state.currentWeek < bounds.peak ? 2 : 4;
    const blockDays = 2; // Each block has 2 days (Day A and Day B)
    dayIndex = blockDayOffset + (state.currentDay % blockDays);
  } else if (program.id === 'calgary_barbell_16') {
    // 4 blocks of 4 weeks, each with 2 workout templates (8 total)
    const blockIdx = state.currentWeek <= 4 ? 0 : state.currentWeek <= 8 ? 1 : state.currentWeek <= 12 ? 2 : 3;
    const blockDayOffset = blockIdx * 2;
    dayIndex = blockDayOffset + (state.currentDay % 2);
  } else if (program.id === 'calgary_barbell_8') {
    // 2 blocks of 4 weeks, each with 2 workout templates (4 total)
    const blockIdx = state.currentWeek <= 4 ? 0 : 1;
    const blockDayOffset = blockIdx * 2;
    dayIndex = blockDayOffset + (state.currentDay % 2);
  } else {
    dayIndex = state.currentDay % program.workouts.length;
  }
  const workoutDay = program.workouts[dayIndex];

  // Calculate week label
  const weekLabel = getWeekLabel(state, program);

  // Generate exercises with calculated weights
  const exercises: GeneratedExercise[] = workoutDay.exercises.map(ex => {
    const exerciseName = getExerciseName(ex.exerciseSlot, state.equipment);

    const sets: GeneratedSet[] = [];
    let setNum = 1;

    for (const setScheme of ex.sets) {
      for (let i = 0; i < setScheme.sets; i++) {
        const targetWeight = calculateTargetWeight(
          ex.exerciseSlot, setScheme, state, program,
        );

        const isAmrap = setScheme.reps.includes('+');

        const adjustedPct = (setScheme.intensityPct && (state.programId.startsWith('531')))
          ? get531WeekPercentage(setScheme.intensityPct, state)
          : setScheme.intensityPct;

        sets.push({
          setNumber: setNum++,
          targetReps: setScheme.reps,
          targetWeight,
          intensityPct: adjustedPct,
          rpe: setScheme.rpe,
          restSeconds: setScheme.restSeconds,
          notes: setScheme.notes,
          isAmrap,
        });
      }
    }

    const slot = EXERCISE_SLOTS[ex.exerciseSlot];
    const genEx: GeneratedExercise = {
      name: exerciseName,
      exerciseSlot: ex.exerciseSlot,
      sets,
      notes: ex.notes,
    };

    // Generate warm-up sets for main lifts
    if (slot?.isMainLift && sets.length > 0 && sets[0].targetWeight > 0) {
      genEx.warmupSets = generateWarmupSets(sets[0].targetWeight, state.weightUnit);
    }

    return genEx;
  });

  // GZCLP: adjust T1 sets/reps based on current lift stage.
  // Stage 1: 5×3+, Stage 2: 6×2+, Stage 3: 10×1+
  if (program.id === 'gzclp') {
    for (const ex of exercises) {
      const slot = EXERCISE_SLOTS[ex.exerciseSlot];
      if (!slot?.isMainLift) continue;

      // Only adjust T1 exercises (first main lift in each workout — identified by having 5x3+ pattern)
      const isT1 = ex.sets.some(s => s.targetReps === '3+' || s.targetReps === '2+' || s.targetReps === '1+');
      if (!isT1) continue;

      const liftKey = ex.exerciseSlot;
      const progress = state.liftProgress[liftKey];
      if (!progress) continue;

      const stage = progress.stage ?? 1;
      const stageConfig: Record<number, { sets: number; reps: string; notes: string }> = {
        1: { sets: 5, reps: '3+', notes: 'T1 Stage 1 — last set AMRAP (stop 1-2 reps from failure)' },
        2: { sets: 6, reps: '2+', notes: 'T1 Stage 2 — last set AMRAP. Advanced to this stage after failing to complete Stage 1.' },
        3: { sets: 10, reps: '1+', notes: 'T1 Stage 3 — last set AMRAP. Final stage before testing new 5RM and resetting.' },
      };

      const config = stageConfig[stage] ?? stageConfig[1];
      const weight = ex.sets[0]?.targetWeight ?? 0;
      const restSeconds = ex.sets[0]?.restSeconds ?? 180;

      // Rebuild sets for this exercise based on current stage
      ex.sets = [];
      for (let i = 0; i < config.sets; i++) {
        const isLast = i === config.sets - 1;
        ex.sets.push({
          setNumber: i + 1,
          targetReps: config.reps,
          targetWeight: weight,
          restSeconds,
          isAmrap: isLast,
          notes: isLast ? config.notes : undefined,
        });
      }
    }
  }

  // Starting Strength: alternate press/bench across sessions.
  // SS prescribes that bench and press swap each session (A has press, B has bench,
  // then next time A has bench, B has press). pressRotation tracks this.
  if (program.id === 'starting_strength') {
    const rotation = state.pressRotation ?? 0;
    if (rotation % 2 === 1) {
      for (const ex of exercises) {
        if (ex.exerciseSlot === 'bench') {
          ex.exerciseSlot = 'ohp';
          ex.name = getExerciseName('ohp', state.equipment);
        } else if (ex.exerciseSlot === 'ohp') {
          ex.exerciseSlot = 'bench';
          ex.name = getExerciseName('bench', state.equipment);
        }
      }
    }
  }

  // Build notes
  const notes: string[] = [];
  if (state.workoutsCompleted === 0) {
    notes.push('First workout! Start conservative — you can always add weight next session.');
  }

  // Check for deload return override
  if (activeOverride?.type === 'deload_return') {
    notes.push('RETURN FROM BREAK: Starting at 80% of previous weights. Rebuild over 1-2 weeks.');
  }

  // Check for deload week
  if (isDeloadWeek(state, program)) {
    notes.push('DELOAD WEEK: Reduce all weights to 50-60% of normal. Focus on movement quality and recovery.');
  }

  // Add transition warnings for LP programs
  const transitionWarning = checkLPTransition(state, program);
  if (transitionWarning) {
    notes.push(transitionWarning);
  }

  // Warn if program has been running significantly longer than typical
  if (program && state.currentWeek > program.typicalDurationWeeks[1] * 1.5) {
    notes.push(`You've been on ${program.shortName} for ${state.currentWeek} weeks (typical: ${program.typicalDurationWeeks[0]}-${program.typicalDurationWeeks[1]} weeks). Consider evaluating whether a program change would provide a fresh stimulus.`);
  }

  return {
    dayName: workoutDay.name,
    dayLabel: workoutDay.dayLabel,
    exercises,
    programName: program.name,
    weekLabel,
    notes,
    scienceNote: program.scienceBasis,
  };
}

// ─── Schedule Override Helpers ───

export function getActiveOverride(state: ProgramState): ScheduleOverride | null {
  if (!state.scheduleOverrides?.length) return null;
  return state.scheduleOverrides.find(o =>
    state.currentWeek >= o.startWeek &&
    state.currentWeek < o.startWeek + o.durationWeeks
  ) ?? null;
}

function generateVacationWorkout(state: ProgramState, program: ProgramDefinition): GeneratedWorkout {
  return {
    dayName: 'Rest Week',
    dayLabel: 'Vacation — Active Recovery',
    exercises: [],
    programName: program.name,
    weekLabel: `Week ${state.currentWeek} — Vacation`,
    notes: [
      'You\'re on vacation! Enjoy the break.',
      'Light activity is fine: walking, swimming, bodyweight stretching.',
      'When you return, the app will automatically schedule a deload return week at 80% of your previous weights.',
      'Rest is where adaptation happens — you\'ll come back stronger.',
    ],
    scienceNote: 'Planned training breaks of 1-3 weeks do not result in significant strength loss. Ogasawara et al. (2013) found that periodic training breaks actually produced similar long-term hypertrophy to continuous training. Your strength will return within 1-2 sessions of resuming.',
  };
}

function generateTravelWorkout(
  state: ProgramState,
  program: ProgramDefinition,
  override: ScheduleOverride,
): GeneratedWorkout {
  const equipment = (override.equipment ?? 'bodyweight') as EquipmentLevel;

  // Generate a minimal full-body workout with available equipment
  const travelExercises: GeneratedExercise[] = [
    {
      name: getExerciseName('squat', equipment),
      exerciseSlot: 'squat',
      sets: [
        { setNumber: 1, targetReps: '10-15', targetWeight: 0, rpe: 8, restSeconds: 90, isAmrap: false, notes: 'Maintain movement quality' },
        { setNumber: 2, targetReps: '10-15', targetWeight: 0, rpe: 8, restSeconds: 90, isAmrap: false },
        { setNumber: 3, targetReps: '10-15', targetWeight: 0, rpe: 9, restSeconds: 90, isAmrap: true, notes: 'Last set AMRAP' },
      ],
    },
    {
      name: getExerciseName('bench', equipment),
      exerciseSlot: 'bench',
      sets: [
        { setNumber: 1, targetReps: '10-20', targetWeight: 0, rpe: 8, restSeconds: 60, isAmrap: false },
        { setNumber: 2, targetReps: '10-20', targetWeight: 0, rpe: 8, restSeconds: 60, isAmrap: false },
        { setNumber: 3, targetReps: '10-20', targetWeight: 0, rpe: 9, restSeconds: 60, isAmrap: true },
      ],
    },
    {
      name: getExerciseName('row', equipment),
      exerciseSlot: 'row',
      sets: [
        { setNumber: 1, targetReps: '10-15', targetWeight: 0, rpe: 8, restSeconds: 60, isAmrap: false },
        { setNumber: 2, targetReps: '10-15', targetWeight: 0, rpe: 9, restSeconds: 60, isAmrap: true },
      ],
    },
    {
      name: getExerciseName('deadlift', equipment),
      exerciseSlot: 'deadlift',
      sets: [
        { setNumber: 1, targetReps: '10-15', targetWeight: 0, rpe: 8, restSeconds: 90, isAmrap: false },
        { setNumber: 2, targetReps: '10-15', targetWeight: 0, rpe: 9, restSeconds: 90, isAmrap: true },
      ],
    },
  ];

  return {
    dayName: 'Travel Workout',
    dayLabel: `Travel — ${equipment === 'bodyweight' ? 'Bodyweight' : 'Light Equipment'} Workout`,
    exercises: travelExercises,
    programName: program.name,
    weekLabel: `Week ${state.currentWeek} — Travel Mode`,
    notes: [
      `Using ${equipment} alternatives for all exercises.`,
      'Focus on maintaining movement patterns and muscle activation.',
      'Higher reps compensate for lighter loads — train close to failure (RPE 8-9).',
      'Your normal program will resume automatically when this period ends.',
    ],
    scienceNote: 'Androulakis-Korakakis et al. (2020, PMC8435792): Even minimal training (1-4 sets per muscle group per week) is sufficient to maintain strength in trained lifters. Bodyweight and light equipment training preserves neuromuscular patterns during travel.',
  };
}

// ─── Weight Calculation ───

function calculateTargetWeight(
  exerciseSlot: string,
  setScheme: { sets: number; reps: string; intensityPct?: number; rpe?: number; notes?: string },
  state: ProgramState,
  program: ProgramDefinition,
): number {
  const slot = EXERCISE_SLOTS[exerciseSlot];
  if (!slot?.isMainLift) return 0; // Accessories: user picks weight

  const liftKey = exerciseSlot === 'front_squat' ? 'squat'
    : exerciseSlot === 'close_grip_bench' ? 'bench'
    : exerciseSlot === 'rdl' ? 'deadlift'
    : exerciseSlot;

  // Helper: apply safety cap before returning any calculated weight
  const safeCap = (w: number): number => {
    if (w <= 0) return w;
    const { weight: capped } = clampToSafetyCap(w, liftKey);
    return capped;
  };

  // LP programs: use current weight from progress tracker
  if (program.progression.type === 'linear_session' || program.progression.type === 'linear_weekly') {
    const progress = state.liftProgress[liftKey];
    if (progress) {
      // Texas Method: adjust weight based on the workout day
      // Volume (Mon) = 90% of 5RM, Recovery (Wed) = 80% of Volume (~72% of 5RM), Intensity (Fri) = 5RM
      if (program.id === 'texas_method') {
        const dayIdx = state.currentDay % program.workouts.length;
        if (dayIdx === 0) return safeCap(roundToPlate(progress.currentWeight * 0.90, progress.unit)); // Volume day
        if (dayIdx === 1) return safeCap(roundToPlate(progress.currentWeight * 0.72, progress.unit)); // Recovery day
        return safeCap(progress.currentWeight); // Intensity day: actual 5RM
      }

      // Starting Strength phase-aware weight calculation
      if (program.id === 'starting_strength') {
        const phase = state.lpPhase ?? 1;

        // Back-off sets at 90% of top set (Phases 4-5)
        if (setScheme.notes?.includes('Back-off')) {
          return safeCap(roundToPlate(progress.currentWeight * 0.90, progress.unit));
        }

        // Light squat day at 80% of heavy day (Phases 3-5)
        if (phase >= 3 && exerciseSlot === 'squat') {
          const daysInPhase = 3; // Phases 3-5 all have 3 days
          const dayInPhase = state.currentDay % daysInPhase;
          // Light day is day index 1 in phases 3-5
          if (dayInPhase === 1) {
            return safeCap(roundToPlate(progress.currentWeight * 0.80, progress.unit));
          }
        }
      }

      return safeCap(progress.currentWeight);
    }
  }

  // Percentage-based programs: use training max
  if (setScheme.intensityPct && state.trainingMaxes[liftKey]) {
    const tm = state.trainingMaxes[liftKey];
    // Adjust percentage based on current week in cycle (for 5/3/1)
    const adjustedPct = get531WeekPercentage(setScheme.intensityPct, state);
    return safeCap(roundToPlate(tm * adjustedPct / 100, state.weightUnit));
  }

  // RPE-based: estimate from training max using RPE-to-% table
  if (setScheme.rpe && state.trainingMaxes[liftKey]) {
    const pct = rpeToPct(setScheme.rpe, parseReps(setScheme.reps));
    return safeCap(roundToPlate(state.trainingMaxes[liftKey] * pct, state.weightUnit));
  }

  return 0;
}

/**
 * Adjust 5/3/1 percentages based on the current week in the cycle.
 * Week 1 (5s): 65/75/85%, Week 2 (3s): 70/80/90%, Week 3 (531): 75/85/95%
 */
function get531WeekPercentage(basePct: number, state: ProgramState): number {
  if (!state.programId.startsWith('531')) {
    return basePct;
  }

  const weekMod = ((state.weekInCycle - 1) % 3);
  // Map base percentages: Week 1=0, Week 2=+5%, Week 3=+10%
  const weekOffset = weekMod * 5;

  // Only adjust the main working sets (65%, 75%, 85%)
  if (basePct === 65 || basePct === 75 || basePct === 85) {
    return basePct + weekOffset;
  }

  // FSL/BBB supplemental stays at base percentage
  if (basePct <= 60) return basePct;

  return basePct;
}

export function parseReps(reps: string): number {
  const num = parseInt(reps.replace('+', '').split('-')[0], 10);
  return isNaN(num) ? 5 : num;
}

/**
 * RPE to %1RM lookup table.
 * Source: Zourdos et al. (2016); Helms et al. (2016); Tuchscherer (RTS)
 */
export function rpeToPct(rpe: number, reps: number): number {
  // Full RPE-to-%1RM table (reps 1-12 for all RPE values)
  // Source: Zourdos et al. (2016); Helms et al. (2016); Tuchscherer (RTS)
  const table: Record<number, Record<number, number>> = {
    10:  { 1: 1.00, 2: 0.96, 3: 0.92, 4: 0.89, 5: 0.86, 6: 0.84, 7: 0.81, 8: 0.79, 9: 0.76, 10: 0.74, 11: 0.71, 12: 0.69 },
    9.5: { 1: 0.98, 2: 0.94, 3: 0.91, 4: 0.88, 5: 0.85, 6: 0.82, 7: 0.80, 8: 0.77, 9: 0.75, 10: 0.72, 11: 0.70, 12: 0.67 },
    9:   { 1: 0.96, 2: 0.92, 3: 0.89, 4: 0.86, 5: 0.84, 6: 0.81, 7: 0.79, 8: 0.76, 9: 0.74, 10: 0.71, 11: 0.69, 12: 0.66 },
    8.5: { 1: 0.94, 2: 0.91, 3: 0.88, 4: 0.85, 5: 0.82, 6: 0.79, 7: 0.77, 8: 0.74, 9: 0.72, 10: 0.69, 11: 0.67, 12: 0.64 },
    8:   { 1: 0.92, 2: 0.89, 3: 0.86, 4: 0.84, 5: 0.81, 6: 0.78, 7: 0.76, 8: 0.73, 9: 0.71, 10: 0.68, 11: 0.66, 12: 0.63 },
    7.5: { 1: 0.91, 2: 0.88, 3: 0.85, 4: 0.82, 5: 0.79, 6: 0.76, 7: 0.74, 8: 0.71, 9: 0.69, 10: 0.66, 11: 0.64, 12: 0.61 },
    7:   { 1: 0.89, 2: 0.86, 3: 0.84, 4: 0.81, 5: 0.78, 6: 0.75, 7: 0.73, 8: 0.70, 9: 0.68, 10: 0.65, 11: 0.63, 12: 0.60 },
    6:   { 1: 0.86, 2: 0.84, 3: 0.81, 4: 0.78, 5: 0.75, 6: 0.72, 7: 0.70, 8: 0.67, 9: 0.65, 10: 0.62, 11: 0.60, 12: 0.57 },
  };

  const rpeKey = Math.round(Math.max(6, Math.min(10, rpe)) * 2) / 2;
  const rpeRow = table[rpeKey] ?? table[8];

  // Clamp reps to 1-12 range
  const clampedReps = Math.max(1, Math.min(12, Math.round(reps)));
  return rpeRow[clampedReps] ?? 0.75;
}

// ─── Week Labels ───

function getWeekLabel(state: ProgramState, program: ProgramDefinition): string {
  if (program.id === 'starting_strength') {
    const phase = state.lpPhase ?? 1;
    const phaseNames = ['', 'True NLP', 'Light Pull', 'HLM Squats', 'Back-Off Sets', 'Full HLM'];
    return `Phase ${phase}: ${phaseNames[phase]} — Week ${state.currentWeek}`;
  }
  if (program.id.startsWith('531') || program.id === 'nsuns') {
    const weekNames = ['5s Week', '3s Week', '5/3/1 Week', 'Deload Week'];
    const weekIdx = (state.weekInCycle - 1) % 4;
    return `Cycle ${state.cycleNumber}, ${weekNames[weekIdx]}`;
  }
  if (program.id === 'gzcl_jt2') {
    if (state.currentWeek <= 6) {
      const rmTargets = ['', '10RM', '8RM', '6RM', '4RM', '3RM', '2RM'];
      return `Volume Phase — Week ${state.currentWeek}/6 (Find ${rmTargets[state.currentWeek]})`;
    }
    if (state.currentWeek <= 12) {
      const rmTargets = ['', '', '', '', '', '', '', '4RM', '3RM', '2RM', '1RM', '1RM', '1RM Test'];
      return `Intensity Phase — Week ${state.currentWeek - 6}/6 (${rmTargets[state.currentWeek] ?? 'Peaking'})`;
    }
    return `Intensity Phase — Week ${state.currentWeek - 6}/6`;
  }
  if (program.id === 'candito_6week') {
    const weekInCycle = ((state.currentWeek - 1) % 6) + 1;
    const phaseNames: Record<number, string> = {
      1: 'Muscular Development',
      2: 'Muscular Development',
      3: 'Strength',
      4: 'Strength',
      5: 'Peaking',
      6: 'Test / Deload',
    };
    return `Phase: ${phaseNames[weekInCycle]} — Week ${weekInCycle}/6`;
  }
  if (program.id === 'calgary_barbell_16') {
    if (state.currentWeek <= 4) return `Hypertrophy Block — Week ${state.currentWeek}/4`;
    if (state.currentWeek <= 8) return `Strength Block — Week ${state.currentWeek - 4}/4`;
    if (state.currentWeek <= 12) return `Peaking Block — Week ${state.currentWeek - 8}/4`;
    return `Competition Block — Week ${state.currentWeek - 12}/4`;
  }
  if (program.id === 'calgary_barbell_8') {
    if (state.currentWeek <= 4) return `Strength Block — Week ${state.currentWeek}/4`;
    return `Peaking Block — Week ${state.currentWeek - 4}/4`;
  }
  if (program.id === 'sheiko_29') return `Prep Cycle 1 — Week ${state.currentWeek}/4`;
  if (program.id === 'sheiko_31') {
    const weekNames = ['Loading 75-80%', 'Loading 80-85%', 'Loading 85-90%', 'Meet Week / Taper'];
    const weekIdx = Math.min(state.currentWeek - 1, 3);
    return `Competition Cycle — ${weekNames[weekIdx]}`;
  }
  if (program.id === 'block_periodization') {
    const bounds = state.blockBoundaries ?? { hyp: 1, str: 6, peak: 11 };
    let label: string;
    if (state.currentWeek < bounds.str) {
      label = `Hypertrophy Block — Week ${state.currentWeek - bounds.hyp + 1}`;
    } else if (state.currentWeek < bounds.peak) {
      label = `Strength Block — Week ${state.currentWeek - bounds.str + 1}`;
    } else {
      label = `Peaking Block — Week ${state.currentWeek - bounds.peak + 1}`;
    }
    if (state.meetDate) {
      const now = new Date();
      const meet = new Date(state.meetDate);
      const weeksOut = Math.max(0, Math.ceil((meet.getTime() - now.getTime()) / (7 * 86400000)));
      label += ` (${weeksOut} week${weeksOut !== 1 ? 's' : ''} to meet)`;
    }
    return label;
  }
  return `Week ${state.currentWeek}`;
}

function isDeloadWeek(state: ProgramState, program: ProgramDefinition): boolean {
  if (program.id.startsWith('531') || program.id === 'nsuns') {
    return state.weekInCycle === 4;
  }
  // General programs: every 4-6 weeks
  return state.currentWeek > 0 && state.currentWeek % 5 === 0;
}

// ─── Starting Strength Phase Advancement ───

/**
 * Detect whether the Starting Strength LP should advance to the next phase.
 * Based on "The Practical Guide to the Novice Linear Progression."
 *
 * Phase transitions:
 * 1→2: Deadlifts become grindy (DL weight > 1.2x squat, or DL stalls while squat progresses)
 *      OR back soreness persists between sessions
 * 2→3: Squats > ~250 lbs (or proportional), knee/back soreness, recovery lagging between sessions
 *      OR squat has stalled once
 * 3→4: Deadlift stalls at heavy 1x5, squat grinding at top weight
 *      OR deadlift has had 1+ deload cycle
 * 4→5: Deadlift not tolerable weekly at 1x5 top sets, Friday squats too aggressive
 *      OR squat has had 1+ deload cycle with back-offs
 * 5→done: Full LP exhaustion → transition to Texas Method or HLM
 */
export function detectSSPhaseAdvancement(state: ProgramState): { newPhase: number; reason: string } | null {
  const phase = state.lpPhase ?? 1;
  if (phase >= 5) return null; // Already at max phase; LP exhaustion handled elsewhere

  const dlProgress = state.liftProgress.deadlift;
  const sqProgress = state.liftProgress.squat;
  if (!dlProgress || !sqProgress) return null;

  // Check recent readiness data for soreness signals
  const recentLogs = loadWorkoutLogs().filter(l => l.programId === 'starting_strength').slice(0, 6);
  const recentSoreness = recentLogs
    .filter(l => l.readiness?.soreness != null)
    .map(l => l.readiness!.soreness);
  const avgSoreness = recentSoreness.length > 0
    ? recentSoreness.reduce((a, b) => a + b, 0) / recentSoreness.length
    : 0;
  const highSoreness = avgSoreness >= 3.5;

  // Check recent difficulty ratings
  const recentDifficulty = recentLogs
    .filter(l => l.sessionDifficulty != null)
    .map(l => l.sessionDifficulty!);
  const tooHardCount = recentDifficulty.filter(d => d === 'too_hard' || d === 'could_not_finish').length;
  const recoveryLagging = tooHardCount >= 2;

  switch (phase) {
    case 1: {
      // Phase 1→2: DL becoming disproportionately heavy or DL stalling
      // Require at least some training history (6+ workouts) before considering ratio-based advancement
      const hasEnoughHistory = state.workoutsCompleted >= 6;
      const dlOutpacingSquat = hasEnoughHistory && dlProgress.currentWeight > sqProgress.currentWeight * 1.2;
      const dlStalling = dlProgress.deloadCycles >= 1;
      const backSoreness = hasEnoughHistory && highSoreness;

      if (dlOutpacingSquat || dlStalling || backSoreness) {
        const reasons: string[] = [];
        if (dlOutpacingSquat) reasons.push(`deadlift (${dlProgress.currentWeight}) is outpacing squat (${sqProgress.currentWeight})`);
        if (dlStalling) reasons.push('deadlift progress has stalled');
        if (backSoreness) reasons.push('persistent soreness between sessions');
        return {
          newPhase: 2,
          reason: `Advancing to Phase 2 (Light Pull): ${reasons.join(', ')}. One deadlift session is now replaced with barbell rows to manage back fatigue.`,
        };
      }
      break;
    }
    case 2: {
      // Phase 2→3: Squats getting heavy, recovery between sessions lagging
      // Use bodyweight-relative threshold if available, otherwise absolute
      const profile = loadUserProfile();
      const bw = profile?.bodyweight ?? 0;
      const sqThreshold = bw > 0
        ? (profile?.sex === 'female' ? bw * 1.2 : bw * 1.5)  // 1.5x BW male, 1.2x BW female
        : (sqProgress.unit === 'kg' ? 115 : 250);  // Fallback to absolute
      const squatHeavy = sqProgress.currentWeight >= sqThreshold;
      const squatStalled = sqProgress.deloadCycles >= 1 || sqProgress.consecutiveFailures >= 2;

      if (squatStalled || (squatHeavy && recoveryLagging) || (squatHeavy && highSoreness)) {
        const reasons: string[] = [];
        if (squatStalled) reasons.push('squat has stalled');
        if (squatHeavy) reasons.push(`squat weight (${sqProgress.currentWeight} ${sqProgress.unit}) is demanding`);
        if (recoveryLagging) reasons.push('recovery lagging between sessions');
        if (highSoreness) reasons.push('persistent soreness');
        return {
          newPhase: 3,
          reason: `Advancing to Phase 3 (HLM Squats): ${reasons.join(', ')}. Mid-week squat is now a light day (80%) to manage fatigue.`,
        };
      }
      break;
    }
    case 3: {
      // Phase 3→4: Deadlift stalling at heavy 1x5, or DL has had a deload cycle
      // DL deload cycles accumulate: Phase 3→4 triggers at 1+
      const dlDeloaded = dlProgress.deloadCycles >= 1;
      const squatGrinding = sqProgress.consecutiveFailures >= 1 && recoveryLagging;

      if (dlDeloaded || squatGrinding) {
        const reasons: string[] = [];
        if (dlDeloaded) reasons.push(`deadlift has completed ${dlProgress.deloadCycles} deload cycle(s)`);
        if (squatGrinding) reasons.push('squat grinding at top weight with recovery issues');
        return {
          newPhase: 4,
          reason: `Advancing to Phase 4 (Back-Off Sets): ${reasons.join(', ')}. Squat and deadlift now use 1x5 top set + 2x5 back-off sets at 90%.`,
        };
      }
      break;
    }
    case 4: {
      // Phase 4→5: Squat has deloaded with back-offs, or DL not tolerable weekly
      // Higher thresholds since deload cycles are cumulative across phases:
      // Squat deload threshold = 2+ (at least one new deload since entering Phase 4)
      // DL threshold = 2+ deload cycles or consecutive failures + recovery lagging
      const squatDeloadedWithBackoffs = sqProgress.deloadCycles >= 2;
      const dlStrugglingWeekly = dlProgress.deloadCycles >= 2 || (dlProgress.consecutiveFailures >= 2 && recoveryLagging);

      if (squatDeloadedWithBackoffs || dlStrugglingWeekly) {
        const reasons: string[] = [];
        if (squatDeloadedWithBackoffs) reasons.push(`squat has deloaded ${sqProgress.deloadCycles} time(s) even with back-off sets`);
        if (dlStrugglingWeekly) reasons.push('deadlift struggling with weekly heavy pulls');
        return {
          newPhase: 5,
          reason: `Advancing to Phase 5 (Full HLM): ${reasons.join(', ')}. Deadlift reduced to once per week. Full Heavy/Light/Medium rotation for all lifts.`,
        };
      }
      break;
    }
  }

  return null;
}

// ─── LP Stall Detection & Progression ───

/**
 * Record a set result and update LP progression.
 * Returns a message if significant (stall, deload, PR, transition).
 */
export function recordSetResult(
  state: ProgramState,
  liftKey: string,
  weight: number,
  repsCompleted: number,
  repsTarget: number,
  rpe?: number,
  formScore?: number,
  tier?: number,
): string | null {
  const progress = state.liftProgress[liftKey];
  if (!progress) return null;

  const program = PROGRAMS[state.programId];
  if (!program) return null;

  const today = new Date().toISOString().slice(0, 10);
  progress.history.push([today, weight, repsCompleted, repsTarget]);

  // Check if set was completed successfully
  if (repsCompleted >= repsTarget) {
    // Success! Reset failure counter and progress
    progress.consecutiveFailures = 0;
    progress.lastSuccessWeight = weight;

    // Compute e1RM from completed reps (Epley formula)
    if (repsCompleted > 1 && repsCompleted <= 15) {
      const e1rm = Math.round(weight * (1 + repsCompleted / 30));
      if (!progress.e1rmHistory) progress.e1rmHistory = [];
      progress.e1rmHistory.push([today, e1rm]);
      if (progress.e1rmHistory.length > 50) progress.e1rmHistory.length = 50;
    }

    // AMRAP-driven progression (nSuns 4-tier table)
    if (program.progression.type === 'amrap_driven') {
      const repsOverTarget = repsCompleted - repsTarget;
      let bonusIncrement: number;
      if (repsOverTarget >= 5) {
        // 5+ reps over target: aggressive jump (+10-15 lbs / +5-7.5 kg)
        bonusIncrement = Math.min(15, progress.unit === 'kg' ? 7.5 : 15);
      } else if (repsOverTarget >= 3) {
        // 3-4 reps over: moderate jump (+5-10 lbs / +2.5-5 kg)
        bonusIncrement = Math.min(10, progress.unit === 'kg' ? 5 : 10);
      } else if (repsOverTarget >= 1) {
        // 1-2 reps over: standard increment
        bonusIncrement = progress.increment;
      } else {
        // 0 reps over: just met target, still progress by standard increment
        bonusIncrement = progress.increment;
      }

      progress.currentWeight = roundToPlate(weight + bonusIncrement, progress.unit);
      if (repsOverTarget >= 3) {
        return `AMRAP: ${repsCompleted} reps (${repsOverTarget} over target). Adding ${bonusIncrement} ${progress.unit} → ${progress.currentWeight} ${progress.unit}.`;
      }
      // For 0-2 over, standard silent progression (falls through to return null below)
    } else {
      // Standard LP progression
      progress.currentWeight = roundToPlate(weight + progress.increment, progress.unit);
    }

    // Check for Starting Strength phase advancement after successful progression
    // (e.g., DL weight outpacing squat after a successful DL increment)
    if (program.id === 'starting_strength') {
      const phaseAdvance = detectSSPhaseAdvancement(state);
      if (phaseAdvance) {
        state.lpPhase = phaseAdvance.newPhase;
        state.currentDay = 0; // Reset day counter for new phase
        return phaseAdvance.reason;
      }
    }

    return null; // Silent success
  }

  // Failed to complete target reps
  progress.consecutiveFailures++;

  // Form-score-driven autoregulation
  if (formScore !== undefined && formScore < 70) {
    const reducedWeight = roundToPlate(weight * 0.92, progress.unit);
    return `Form quality dropped to ${formScore}/100 at ${weight} ${progress.unit}. ` +
      `Recommending ${reducedWeight} ${progress.unit} next session to reinforce technique. ` +
      `(Based on: Helms et al. 2016 — technique degradation under heavy load indicates insufficient neural adaptation at this intensity.)`;
  }

  // GZCLP T1 stage progression
  if (program.id === 'gzclp' && tier !== 2 && progress.stage < 3) {
    progress.stage++;
    progress.consecutiveFailures = 0;
    const stageNames = ['', '5×3+', '6×2+', '10×1+'];
    return `Advancing ${progress.liftName} to Stage ${progress.stage} (${stageNames[progress.stage]}). ` +
      `This is normal — GZCLP's stage system automatically adjusts when progress stalls at a given rep range.`;
  }

  // GZCLP T2 stage progression
  if (program.id === 'gzclp' && tier === 2) {
    const t2Stage = progress.t2Stage ?? 1;
    if (t2Stage < 3) {
      progress.t2Stage = t2Stage + 1;
      progress.consecutiveFailures = 0;
      const t2Names = ['', '3\u00d710', '3\u00d78', '3\u00d76'];
      return `Advancing ${progress.liftName} T2 to ${t2Names[progress.t2Stage ?? 1]}. ` +
        `When you can complete all sets at ${t2Names[progress.t2Stage ?? 1]}, add weight and restart at 3\u00d710.`;
    } else {
      // Reset T2 with appropriate increment for unit system
      progress.t2Stage = 1;
      const t2ResetIncrement = progress.unit === 'kg' ? 7.5 : 15;
      progress.currentWeight = roundToPlate(weight + t2ResetIncrement, progress.unit);
      progress.consecutiveFailures = 0;
      return `${capitalize(progress.liftName)} T2 cycled through all stages. Adding ${t2ResetIncrement} ${progress.unit} and restarting at 3\u00d710.`;
    }
  }

  // Deload protocol
  if (progress.consecutiveFailures >= 2) {
    progress.deloadCycles++;
    progress.consecutiveFailures = 0;

    // Starting Strength: deload cycles are a primary trigger for phase advancement
    if (program.id === 'starting_strength') {
      const phaseAdvance = detectSSPhaseAdvancement(state);
      if (phaseAdvance) {
        // Still apply the deload, but also advance phase
        const deloadWeight = enforceBarMinimum(roundToPlate(weight * 0.9, progress.unit), progress.unit);
        progress.currentWeight = deloadWeight;
        state.lpPhase = phaseAdvance.newPhase;
        state.currentDay = 0; // Reset day counter for new phase
        return `Deloading ${progress.liftName} to ${deloadWeight} ${progress.unit} (−10%). ` +
          phaseAdvance.reason;
      }
    }

    // Reset GZCLP stages
    if (program.id === 'gzclp' && progress.stage === 3) {
      progress.stage = 1;
      // Test new 5RM → restart at 85%
      const new5RM = progress.lastSuccessWeight;
      progress.currentWeight = enforceBarMinimum(roundToPlate(new5RM * 0.85, progress.unit), progress.unit);
      return `${progress.liftName} has cycled through all stages. Testing new 5RM at ${new5RM} ${progress.unit}, ` +
        `restarting at 85% (${progress.currentWeight} ${progress.unit}).`;
    }

    // Standard deload: -10%
    const deloadWeight = enforceBarMinimum(roundToPlate(weight * 0.9, progress.unit), progress.unit);
    progress.currentWeight = deloadWeight;

    // Check if LP is exhausted
    if (progress.deloadCycles >= program.progression.maxStallCycles) {
      progress.lpExhausted = true;
      return `${capitalize(progress.liftName)} has stalled through ${progress.deloadCycles} deload cycles. ` +
        `Linear progression is exhausted for this lift. Time to consider intermediate programming. ` +
        `(Reference: Rippetoe, Practical Programming 3rd ed. — when session-to-session adaptation ` +
        `is no longer possible, weekly or block periodization is needed.)`;
    }

    // Reduce increment if not already at minimum
    const isLower = liftKey === 'squat' || liftKey === 'deadlift';
    const minIncrement = isLower ? 5 : 2.5;
    if (progress.increment > minIncrement) {
      progress.increment = minIncrement;
      return `Deloading ${progress.liftName} to ${deloadWeight} ${progress.unit} (−10%). ` +
        `Reducing increment to ${minIncrement} ${progress.unit}/session. ` +
        `Microplates (1.25 lb each) recommended for upper body lifts.`;
    }

    return `Deloading ${progress.liftName} to ${deloadWeight} ${progress.unit} (−10%). ` +
      `This is deload cycle ${progress.deloadCycles}/${program.progression.maxStallCycles}. ` +
      `${program.progression.maxStallCycles - progress.deloadCycles === 0
        ? 'LP exhausted — consider transition.'
        : `${program.progression.maxStallCycles - progress.deloadCycles} more cycle(s) before recommending transition.`}`;
  }

  // Check for Starting Strength phase advancement after any failure
  if (program.id === 'starting_strength') {
    const phaseAdvance = detectSSPhaseAdvancement(state);
    if (phaseAdvance) {
      state.lpPhase = phaseAdvance.newPhase;
      state.currentDay = 0; // Reset day counter for new phase
      return `Failed ${repsTarget} reps at ${weight} ${progress.unit} (got ${repsCompleted}). ` +
        phaseAdvance.reason;
    }
  }

  return `Failed ${repsTarget} reps at ${weight} ${progress.unit} (got ${repsCompleted}). ` +
    `Repeating this weight next session. Ensure adequate sleep (7-9 hrs) and protein intake (1.6-2.2 g/kg/day, per Morton et al. 2018).`;
}

// ─── Estimated 1RM Lookup ───

export function getEstimated1RMs(state: ProgramState): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [lift, progress] of Object.entries(state.liftProgress)) {
    const history = progress.e1rmHistory;
    if (history && history.length > 0) {
      result[lift] = history[history.length - 1][1];
    }
  }
  return result;
}

// ─── LP Transition Check ───

/**
 * Check if any lift has exhausted LP and return a warning string.
 */
export function checkLPTransition(
  state: ProgramState,
  program: ProgramDefinition,
): string | null {
  const exhaustedLifts = Object.values(state.liftProgress)
    .filter(p => p.lpExhausted)
    .map(p => p.liftName);

  if (exhaustedLifts.length === 0) return null;

  const liftList = exhaustedLifts.map(capitalize).join(', ');

  if (exhaustedLifts.length >= 3) {
    return `LP exhausted on ${liftList}. Strongly recommend transitioning to intermediate programming. ` +
      `See the "Change Program" section for recommendations tailored to your schedule and equipment.`;
  }

  return `LP exhausted on ${liftList}. You can continue LP on other lifts while running ` +
    `intermediate programming for stalled lifts, or transition fully. ` +
    `(Baker 2015: per-lift transitions are valid — your squat may need weekly periodization ` +
    `while your deadlift still has room for daily LP.)`;
}

// ─── Advance State ───

/**
 * Advance to the next workout day.
 */
export function advanceWorkout(state: ProgramState): void {
  const program = PROGRAMS[state.programId];
  if (!program) return;

  state.workoutsCompleted++;
  state.currentDay++;

  // Toggle press/bench alternation for Starting Strength
  if (program.id === 'starting_strength') {
    state.pressRotation = ((state.pressRotation ?? 0) + 1) % 2;
  }

  // Phase/block-aware day cycling
  let daysPerCycle: number;
  if (program.id === 'starting_strength') {
    const phase = state.lpPhase ?? 1;
    daysPerCycle = phase <= 2 ? 2 : 3;
  } else if (program.id === 'block_periodization' || program.id === 'calgary_barbell_16' || program.id === 'calgary_barbell_8') {
    // Block-based programs: each block has 2 workout days (Day A + Day B),
    // so advance the week after every 2 workouts, not after all templates.
    daysPerCycle = 2;
  } else {
    daysPerCycle = program.workouts.length;
  }
  if (state.currentDay >= daysPerCycle) {
    state.currentDay = 0;
    advanceWeek(state, program);
  }
}

function advanceWeek(state: ProgramState, program: ProgramDefinition): void {
  state.currentWeek++;

  // Check if a schedule override just ended
  if (state.scheduleOverrides?.length) {
    const justEnded = state.scheduleOverrides.find(o =>
      state.currentWeek === o.startWeek + o.durationWeeks
    );
    if (justEnded && (justEnded.type === 'vacation' || justEnded.type === 'travel_light')) {
      // Auto-add a deload return week
      state.scheduleOverrides.push({
        startWeek: state.currentWeek,
        durationWeeks: 1,
        type: 'deload_return',
        description: 'Return from break — rebuilding at 80% of previous weights',
      });
      // Reduce all lift weights to 80%
      for (const progress of Object.values(state.liftProgress)) {
        progress.currentWeight = enforceBarMinimum(
          roundToPlate(progress.currentWeight * 0.8, progress.unit),
          progress.unit,
        );
      }
    }
    // Clean up expired overrides
    state.scheduleOverrides = state.scheduleOverrides.filter(o =>
      state.currentWeek < o.startWeek + o.durationWeeks
    );
  }

  if (program.id.startsWith('531') || program.id === 'nsuns') {
    state.weekInCycle++;
    if (state.weekInCycle > 4) {
      // New cycle
      state.weekInCycle = 1;
      state.cycleNumber++;

      // Increase training maxes
      for (const lift of Object.keys(state.trainingMaxes)) {
        const isLower = lift === 'squat' || lift === 'deadlift';
        const increment = isLower
          ? program.progression.incrementLbs.lower
          : program.progression.incrementLbs.upper;
        state.trainingMaxes[lift] = roundToPlate(
          state.trainingMaxes[lift] + increment,
          state.weightUnit,
        );
      }
    }
  }
}
