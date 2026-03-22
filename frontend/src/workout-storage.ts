/**
 * Workout storage: localStorage persistence for program state,
 * workout logs, and user profiles.
 *
 * No dependencies on other program-generator submodules.
 */

import type { VersionedData, MigrationFn } from './storage-migration';
import { migrateData } from './storage-migration';

// ─── Storage Versioning ───

const WORKOUT_STORAGE_VERSION = 1;
const WORKOUT_LOG_STORAGE_VERSION = 1;
const USER_PROFILE_STORAGE_VERSION = 1;

// ─── Migration Registries ───

const PROGRAM_STATE_MIGRATIONS: Record<number, MigrationFn> = {
  // version 0 -> 1: ensure all expected fields exist with defaults
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  0: (data: any) => ({
    ...data,
    programId: data.programId ?? '',
    startDate: data.startDate ?? new Date().toISOString().slice(0, 10),
    currentWeek: data.currentWeek ?? 1,
    currentDay: data.currentDay ?? 0,
    trainingMaxes: data.trainingMaxes ?? {},
    liftProgress: data.liftProgress ?? {},
    workoutsCompleted: data.workoutsCompleted ?? 0,
    cycleNumber: data.cycleNumber ?? 1,
    weekInCycle: data.weekInCycle ?? 1,
    equipment: data.equipment ?? 'full',
    weightUnit: data.weightUnit ?? 'lbs',
    lpPhase: data.lpPhase ?? 1,
    scheduleOverrides: data.scheduleOverrides ?? [],
    equipmentOverride: data.equipmentOverride ?? undefined,
    injuryHistory: data.injuryHistory ?? {},
    formScoreHistory: data.formScoreHistory ?? {},
  }),
};

const WORKOUT_LOG_MIGRATIONS: Record<number, MigrationFn> = {
  // version 0 -> 1: ensure each log entry has all expected fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  0: (data: any) => {
    if (Array.isArray(data)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data.map((log: any) => ({
        ...log,
        id: log.id ?? Date.now().toString(36) + Math.random().toString(36).slice(2),
        date: log.date ?? new Date().toISOString(),
        programId: log.programId ?? '',
        workoutDayIndex: log.workoutDayIndex ?? 0,
        workoutDayName: log.workoutDayName ?? '',
        sets: log.sets ?? [],
        completed: log.completed ?? false,
      }));
    }
    return data;
  },
};

const USER_PROFILE_MIGRATIONS: Record<number, MigrationFn> = {
  // version 0 -> 1: ensure all expected fields exist
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  0: (data: any) => ({
    ...data,
    experienceLevel: data.experienceLevel ?? 'beginner',
    daysPerWeek: data.daysPerWeek ?? 3,
    equipment: data.equipment ?? 'full',
    goal: data.goal ?? 'general_strength',
  }),
};

// ─── Workout Log Types ───

export interface WorkoutSet {
  exerciseName: string;
  exerciseSlot: string;
  setNumber: number;
  targetReps: string;
  targetWeight: number;
  actualReps?: number;
  actualWeight?: number;
  rpe?: number;
  formScore?: number;
  completed: boolean;
  notes?: string;
}

export interface WorkoutLog {
  id: string;
  date: string;
  programId: string;
  workoutDayIndex: number;
  workoutDayName: string;
  sets: WorkoutSet[];
  readiness?: ReadinessData;
  completed: boolean;
  notes?: string;
  sessionDifficulty?: SessionDifficulty;
}

export interface ReadinessData {
  sleepHours: number;
  sleepQuality: number;   // 1-5
  stress: number;         // 1-5 (1=low, 5=high)
  soreness: number;       // 1-5 (1=none, 5=severe)
  motivation: number;     // 1-5
}

// Forward-declare SessionDifficulty here so WorkoutLog can reference it
// without a circular dependency on adaptation-engine.
export type SessionDifficulty = 'too_easy' | 'just_right' | 'too_hard' | 'could_not_finish';

// ─── Storage Keys ───

const PROGRAM_STATE_KEY = 'squat_form_program_state';
const WORKOUT_LOG_KEY = 'squat_form_workout_logs';
const USER_PROFILE_KEY = 'squat_form_user_profile';

// ─── LP Tracking ───

export interface LiftProgress {
  liftName: string;       // 'squat', 'bench', 'deadlift', 'ohp'
  currentWeight: number;
  unit: string;
  /** Session-to-session increment (lbs) */
  increment: number;
  /** Number of consecutive failures at current weight */
  consecutiveFailures: number;
  /** Number of completed deload cycles */
  deloadCycles: number;
  /** Current stage for GZCLP-style programs (1=default, 2, 3) */
  stage: number;
  /** Whether LP is exhausted for this lift */
  lpExhausted: boolean;
  /** History of weight attempts: [date, weight, reps_completed, reps_target] */
  history: Array<[string, number, number, number]>;
  /** Last successful weight (for deload calculation) */
  lastSuccessWeight: number;
  /** Estimated 1RM history from AMRAP performance: [date, e1rm] */
  e1rmHistory?: Array<[string, number]>;
  /** T2 stage for GZCLP (1=3x10, 2=3x8, 3=3x6) */
  t2Stage?: number;
}

export interface ScheduleOverride {
  /** Week number this override starts */
  startWeek: number;
  /** How many weeks this override lasts */
  durationWeeks: number;
  /** Type of override */
  type: 'vacation' | 'travel_light' | 'reduced_frequency' | 'equipment_change' | 'deload_return';
  /** For equipment changes: the temporary equipment level */
  equipment?: string;
  /** For frequency changes: temporary days per week */
  daysPerWeek?: number;
  /** Description for the user */
  description: string;
}

export interface ProgramState {
  programId: string;
  startDate: string;
  currentWeek: number;
  currentDay: number;       // Index into program's workout array
  /** For 5/3/1: training maxes per lift (lbs) */
  trainingMaxes: Record<string, number>;
  /** For LP programs: per-lift progress tracking */
  liftProgress: Record<string, LiftProgress>;
  /** Completed workout count */
  workoutsCompleted: number;
  /** Current 5/3/1 cycle number (1-based) */
  cycleNumber: number;
  /** Current week within cycle (1-4 for 5/3/1, 1-3 for others) */
  weekInCycle: number;
  /** Equipment level */
  equipment: EquipmentLevel;
  /** User's weight unit preference */
  weightUnit: string;
  /** Competition/meet date for block periodization */
  meetDate?: string;
  /** Block boundaries: week numbers where each block starts */
  blockBoundaries?: { hyp: number; str: number; peak: number };
  /** Persistent injury reports: bodyArea → consecutive session count */
  injuryHistory?: Record<string, number>;
  /** Date (YYYY-MM-DD) when autoregulate() last applied weight changes */
  lastAutoregulatedDate?: string;
  /** Temporary schedule modifications (vacation, travel, equipment change) */
  scheduleOverrides?: ScheduleOverride[];
  /** Temporary equipment override (e.g., bodyweight-only during travel) */
  equipmentOverride?: { equipment: string; untilWeek: number; reason: string };
  /** Current LP phase for Starting Strength (1-5). Auto-advances based on recovery signals.
   * Phase 1: True NLP (A/B alternating, DL every session)
   * Phase 2: Light pull introduced (one DL swapped for rows/chin-ups)
   * Phase 3: Light squat mid-week (Heavy/Light/Medium squat, pull rotation)
   * Phase 4: Back-off sets for squat & deadlift (1x5 top + 2x5 @ 90%)
   * Phase 5: Full HLM for squats & pulls (each day has a distinct purpose)
   * Source: Practical Guide to the Novice Linear Progression (Sam/SS coaching)
   */
  lpPhase?: number;
  /** Tracks press/bench alternation for Starting Strength.
   * SS prescribes alternating bench and press across sessions:
   * Even (0, 2, 4...): use exercises as defined in the template
   * Odd (1, 3, 5...): swap bench↔ohp slots
   */
  pressRotation?: number;
}

import type { EquipmentLevel } from './workout-programs';

// ─── Storage Functions ───

export function loadProgramState(): ProgramState | null {
  try {
    const raw = localStorage.getItem(PROGRAM_STATE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const { data, migrated, fromVersion } = migrateData<ProgramState>(
      parsed, WORKOUT_STORAGE_VERSION, PROGRAM_STATE_MIGRATIONS
    );

    if (migrated) {
      console.info(`Migrated workout storage from v${fromVersion} to v${WORKOUT_STORAGE_VERSION}`);
      // Re-save in versioned format so migration only runs once
      try {
        const wrapped: VersionedData<ProgramState> = {
          version: WORKOUT_STORAGE_VERSION,
          data,
          migratedAt: new Date().toISOString(),
        };
        localStorage.setItem(PROGRAM_STATE_KEY, JSON.stringify(wrapped));
      } catch { /* ignore save failure during migration */ }
    }

    return data;
  } catch {
    return null;
  }
}

export function saveProgramState(state: ProgramState): void {
  try {
    const wrapped: VersionedData<ProgramState> = {
      version: WORKOUT_STORAGE_VERSION,
      data: state,
    };
    localStorage.setItem(PROGRAM_STATE_KEY, JSON.stringify(wrapped));
  } catch {
    document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' }));
  }
}

export function loadWorkoutLogs(): WorkoutLog[] {
  try {
    const raw = localStorage.getItem(WORKOUT_LOG_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    const { data, migrated, fromVersion } = migrateData<WorkoutLog[]>(
      parsed, WORKOUT_LOG_STORAGE_VERSION, WORKOUT_LOG_MIGRATIONS
    );

    if (migrated) {
      console.info(`Migrated workout logs from v${fromVersion} to v${WORKOUT_LOG_STORAGE_VERSION}`);
      // Re-save in versioned format so migration only runs once
      try {
        const wrapped: VersionedData<WorkoutLog[]> = {
          version: WORKOUT_LOG_STORAGE_VERSION,
          data,
          migratedAt: new Date().toISOString(),
        };
        localStorage.setItem(WORKOUT_LOG_KEY, JSON.stringify(wrapped));
      } catch { /* ignore save failure during migration */ }
    }

    return data;
  } catch {
    return [];
  }
}

export function saveWorkoutLogs(logs: WorkoutLog[]): void {
  try {
    // Keep last 200 logs max
    if (logs.length > 200) {
      logs.length = 200;
      document.dispatchEvent(new CustomEvent('storage-warning', {
        detail: 'Workout history exceeds 200 entries. Oldest entries have been archived. Export your data regularly.'
      }));
    }
    const wrapped: VersionedData<WorkoutLog[]> = {
      version: WORKOUT_LOG_STORAGE_VERSION,
      data: logs,
    };
    localStorage.setItem(WORKOUT_LOG_KEY, JSON.stringify(wrapped));
  } catch {
    document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' }));
  }
}

export function loadUserProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(USER_PROFILE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const { data, migrated, fromVersion } = migrateData<UserProfile>(
      parsed, USER_PROFILE_STORAGE_VERSION, USER_PROFILE_MIGRATIONS
    );

    if (migrated) {
      console.info(`Migrated user profile from v${fromVersion} to v${USER_PROFILE_STORAGE_VERSION}`);
      // Re-save in versioned format so migration only runs once
      try {
        const wrapped: VersionedData<UserProfile> = {
          version: USER_PROFILE_STORAGE_VERSION,
          data,
          migratedAt: new Date().toISOString(),
        };
        localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(wrapped));
      } catch { /* ignore save failure during migration */ }
    }

    return data;
  } catch {
    return null;
  }
}

export function saveUserProfile(profile: UserProfile): void {
  try {
    const wrapped: VersionedData<UserProfile> = {
      version: USER_PROFILE_STORAGE_VERSION,
      data: profile,
    };
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(wrapped));
  } catch {
    document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' }));
  }
}

import type { UserProfile } from './workout-programs';
