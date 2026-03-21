/**
 * Workout storage: localStorage persistence for program state,
 * workout logs, and user profiles.
 *
 * No dependencies on other program-generator submodules.
 */

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
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveProgramState(state: ProgramState): void {
  try {
    localStorage.setItem(PROGRAM_STATE_KEY, JSON.stringify(state));
  } catch {
    document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' }));
  }
}

export function loadWorkoutLogs(): WorkoutLog[] {
  try {
    const raw = localStorage.getItem(WORKOUT_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
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
    localStorage.setItem(WORKOUT_LOG_KEY, JSON.stringify(logs));
  } catch {
    document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' }));
  }
}

export function loadUserProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(USER_PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveUserProfile(profile: UserProfile): void {
  try {
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' }));
  }
}

import type { UserProfile } from './workout-programs';
