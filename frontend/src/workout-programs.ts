/**
 * Powerlifting program definitions with evidence-based progression schemes.
 * Each program follows its original methodology source (cited in-line).
 * All programs are adapted for equipment availability.
 *
 * References:
 * - Rippetoe M. Starting Strength, 3rd ed. (2011)
 * - Lefever C. GZCL Method (2014)
 * - Wendler J. 5/3/1 Forever (2017)
 * - Baker A. The Texas Method (2015)
 * - Simmons L. Westside Barbell Book of Methods (2007)
 * - Zourdos et al. (2016) RPE autoregulation
 * - Rhea et al. (2002) DUP meta-analysis
 * - Israetel M. Renaissance Periodization volume landmarks
 * - Nippard J. Powerbuilding System (2022)
 * - Krapf S. (SSC, Ground Zero Strength) 4-Day Upper-Lower framework (2024)
 * - Nippard J. The Essentials Program (2023)
 * - Sheiko B. Powerlifting: A Guide for Coaches and Athletes (2018)
 * - Candito J. Linear/Periodization Strength Program (canditotraininghq.com)
 * - Lewis B. / Calgary Barbell (calgarybarbell.com)
 * - Nuckols G. Stronger by Science (2020)
 * - Metallicadpa / r/Fitness PPL Program
 */

// ─── Types ───

export type ProgramLevel = 'beginner' | 'intermediate' | 'advanced';
export type EquipmentLevel = 'full_gym' | 'barbell_home' | 'dumbbells' | 'bodyweight' | 'mixed';
export type ProgressionType = 'linear_session' | 'linear_weekly' | 'percentage_wave' | 'rpe_autoregulated' | 'amrap_driven' | 'block';
export type ProgramGoal = 'strength' | 'hypertrophy' | 'powerlifting' | 'powerbuilding' | 'general';

export interface ExerciseSlot {
  name: string;
  /** Primary barbell movement */
  barbell: string;
  /** Home gym barbell alternative (if different) */
  barbellHome?: string;
  /** Dumbbell alternative */
  dumbbell: string;
  /** Bodyweight alternative */
  bodyweight: string;
  /** Whether this is a main compound lift */
  isMainLift: boolean;
  /** Target muscle groups */
  muscleGroups: string[];
}

export interface SetScheme {
  sets: number;
  reps: string;           // "5", "3-5", "5+", "AMRAP"
  /** Intensity as % of 1RM or training max */
  intensityPct?: number;
  /** Target RPE */
  rpe?: number;
  /** Rest period in seconds */
  restSeconds: number;
  /** Description for the user */
  notes?: string;
}

export interface WorkoutDay {
  name: string;
  dayLabel: string;       // "Day A", "Monday", "Upper", etc.
  exercises: WorkoutExercise[];
}

export interface WorkoutExercise {
  exerciseSlot: string;   // Key into EXERCISE_SLOTS
  sets: SetScheme[];
  notes?: string;
}

export interface ProgressionRule {
  type: ProgressionType;
  /** Weight increment per progression event (lbs) */
  incrementLbs: { upper: number; lower: number };
  /** Description of when/how progression happens */
  description: string;
  /** How to handle stalls */
  stallProtocol: string;
  /** Number of stall cycles before recommending transition */
  maxStallCycles: number;
}

export interface DeloadProtocol {
  frequency: string;      // "Every 4 weeks", "As needed", etc.
  method: string;         // "Reduce volume 50%", "Reduce intensity 10%"
  duration: string;       // "1 week"
  /** Science citation */
  citation: string;
}

export interface ProgramDefinition {
  id: string;
  name: string;
  shortName: string;
  author: string;
  description: string;
  level: ProgramLevel;
  goals: ProgramGoal[];
  daysPerWeek: number[];  // Supported days (e.g., [3] or [4, 5, 6])
  equipmentMin: EquipmentLevel;
  workouts: WorkoutDay[];
  progression: ProgressionRule;
  deload: DeloadProtocol;
  /** When should the lifter transition away from this program? */
  transitionCriteria: string;
  /** Recommended next programs */
  transitionOptions: string[];  // Program IDs
  /** Why this program works (science summary) */
  scienceBasis: string;
  /** Typical duration before transitioning */
  typicalDurationWeeks: [number, number]; // min, max
  /** Estimated session duration in minutes */
  sessionMinutes?: number;
  /**
   * Weekly percentage waves within block programs.
   * Maps block index (0-based) to per-week overrides.
   * Each week within a block can override intensity, rep scheme, and volume.
   *
   * Used by block periodization programs (Calgary Barbell, Candito, Sheiko, etc.)
   * to provide week-to-week variation within each mesocycle block.
   */
  weeklyWaves?: {
    [blockIndex: number]: {
      [weekInBlock: number]: WeeklyWaveEntry;
    };
  };
}

export interface WeeklyWaveEntry {
  /** Override the block's default intensity percentage (of 1RM or training max). */
  intensityPct: number;
  /** Override rep scheme if different from block default (e.g., "4x8", "3x3", "1x1"). */
  repTarget?: string;
  /** Volume multiplier: 1.0 = normal, 0.5 = deload. Scales set count. */
  volumeMultiplier?: number;
}

// ─── Exercise Slot Definitions ───

export const EXERCISE_SLOTS: Record<string, ExerciseSlot> = {
  squat: {
    name: 'Squat',
    barbell: 'Barbell Back Squat',
    dumbbell: 'Goblet Squat',
    bodyweight: 'Bodyweight Squat → Pistol Squat Progression',
    isMainLift: true,
    muscleGroups: ['quads', 'glutes', 'core'],
  },
  bench: {
    name: 'Bench Press',
    barbell: 'Barbell Bench Press',
    dumbbell: 'Dumbbell Bench Press',
    bodyweight: 'Push-up → Weighted Push-up Progression',
    isMainLift: true,
    muscleGroups: ['chest', 'triceps', 'front_delts'],
  },
  deadlift: {
    name: 'Deadlift',
    barbell: 'Barbell Deadlift',
    dumbbell: 'Dumbbell Romanian Deadlift',
    bodyweight: 'Nordic Curl + Glute Bridge Progression',
    isMainLift: true,
    muscleGroups: ['hamstrings', 'glutes', 'back', 'core'],
  },
  ohp: {
    name: 'Overhead Press',
    barbell: 'Barbell Overhead Press',
    dumbbell: 'Dumbbell Overhead Press',
    bodyweight: 'Pike Push-up → Handstand Push-up Progression',
    isMainLift: true,
    muscleGroups: ['shoulders', 'triceps', 'core'],
  },
  row: {
    name: 'Row',
    barbell: 'Barbell Row',
    dumbbell: 'Dumbbell Row',
    bodyweight: 'Inverted Row → Pull-up',
    isMainLift: false,
    muscleGroups: ['back', 'biceps', 'rear_delts'],
  },
  front_squat: {
    name: 'Front Squat',
    barbell: 'Barbell Front Squat',
    dumbbell: 'Goblet Squat',
    bodyweight: 'Sissy Squat',
    isMainLift: false,
    muscleGroups: ['quads', 'core'],
  },
  rdl: {
    name: 'Romanian Deadlift',
    barbell: 'Barbell RDL',
    dumbbell: 'Dumbbell RDL',
    bodyweight: 'Single-leg RDL (bodyweight)',
    isMainLift: false,
    muscleGroups: ['hamstrings', 'glutes'],
  },
  close_grip_bench: {
    name: 'Close-Grip Bench',
    barbell: 'Close-Grip Barbell Bench',
    dumbbell: 'Close-Grip Dumbbell Press',
    bodyweight: 'Diamond Push-ups',
    isMainLift: false,
    muscleGroups: ['triceps', 'chest'],
  },
  pullup: {
    name: 'Pull-up / Lat Pulldown',
    barbell: 'Lat Pulldown',
    barbellHome: 'Pull-ups',
    dumbbell: 'Dumbbell Pullover',
    bodyweight: 'Pull-up Progression (negatives → full)',
    isMainLift: false,
    muscleGroups: ['back', 'biceps'],
  },
  leg_press: {
    name: 'Leg Press / Lunge',
    barbell: 'Leg Press',
    barbellHome: 'Barbell Lunge',
    dumbbell: 'Dumbbell Bulgarian Split Squat',
    bodyweight: 'Bulgarian Split Squat',
    isMainLift: false,
    muscleGroups: ['quads', 'glutes'],
  },
  face_pull: {
    name: 'Face Pull / Band Pull-apart',
    barbell: 'Cable Face Pull',
    barbellHome: 'Band Pull-apart',
    dumbbell: 'Dumbbell Rear Delt Fly',
    bodyweight: 'Band Pull-apart',
    isMainLift: false,
    muscleGroups: ['rear_delts', 'upper_back'],
  },
  curl: {
    name: 'Bicep Curl',
    barbell: 'Barbell Curl',
    dumbbell: 'Dumbbell Curl',
    bodyweight: 'Chin-up (underhand)',
    isMainLift: false,
    muscleGroups: ['biceps'],
  },
  tricep_extension: {
    name: 'Tricep Extension',
    barbell: 'Tricep Pushdown',
    barbellHome: 'Overhead Barbell Tricep Extension',
    dumbbell: 'Dumbbell Overhead Tricep Extension',
    bodyweight: 'Bench Dips',
    isMainLift: false,
    muscleGroups: ['triceps'],
  },
  ab_work: {
    name: 'Ab / Core Work',
    barbell: 'Cable Crunch / Ab Wheel',
    barbellHome: 'Ab Wheel / Hanging Leg Raise',
    dumbbell: 'Dumbbell Side Bend + Plank',
    bodyweight: 'Plank + Leg Raise + Ab Wheel',
    isMainLift: false,
    muscleGroups: ['core'],
  },
  hip_thrust: {
    name: 'Hip Thrust',
    barbell: 'Barbell Hip Thrust',
    dumbbell: 'Dumbbell Hip Thrust',
    bodyweight: 'Glute Bridge (single-leg)',
    isMainLift: false,
    muscleGroups: ['glutes', 'hamstrings'],
  },
  pause_squat: {
    name: 'Pause Squat',
    barbell: 'Pause Squat (3-sec hold at bottom)',
    dumbbell: 'Pause Goblet Squat',
    bodyweight: 'Pause Bodyweight Squat',
    isMainLift: false,
    muscleGroups: ['quads', 'glutes', 'core'],
  },
  deficit_deadlift: {
    name: 'Deficit Deadlift',
    barbell: 'Deficit Deadlift (1-2" platform)',
    dumbbell: 'Deficit Dumbbell RDL',
    bodyweight: 'Single-leg Deadlift',
    isMainLift: false,
    muscleGroups: ['hamstrings', 'glutes', 'back'],
  },
  spoto_press: {
    name: 'Spoto Press / Pause Bench',
    barbell: 'Spoto Press (pause 1" off chest)',
    dumbbell: 'Pause Dumbbell Bench',
    bodyweight: 'Pause Push-ups',
    isMainLift: false,
    muscleGroups: ['chest', 'triceps'],
  },
  good_morning: {
    name: 'Good Morning',
    barbell: 'Barbell Good Morning',
    dumbbell: 'Dumbbell Good Morning',
    bodyweight: 'Bodyweight Good Morning',
    isMainLift: false,
    muscleGroups: ['hamstrings', 'lower_back'],
  },
  box_squat: {
    name: 'Box Squat',
    barbell: 'Box Squat',
    dumbbell: 'Goblet Box Squat',
    bodyweight: 'Box Squat (bodyweight)',
    isMainLift: false,
    muscleGroups: ['quads', 'glutes'],
  },
  lateral_raise: {
    name: 'Lateral Raise',
    barbell: 'Cable Lateral Raise',
    dumbbell: 'Dumbbell Lateral Raise',
    bodyweight: 'Band Lateral Raise',
    isMainLift: false,
    muscleGroups: ['shoulders'],
  },
  dip: {
    name: 'Dip',
    barbell: 'Weighted Dip',
    dumbbell: 'Bench Dip (weighted)',
    bodyweight: 'Bodyweight Dip',
    isMainLift: false,
    muscleGroups: ['chest', 'triceps', 'front_delts'],
  },
  chest_fly: {
    name: 'Chest Fly',
    barbell: 'Cable Fly',
    dumbbell: 'Dumbbell Fly',
    bodyweight: 'Band Chest Fly',
    isMainLift: false,
    muscleGroups: ['chest'],
  },
  hamstring_curl: {
    name: 'Hamstring Curl',
    barbell: 'Lying Leg Curl',
    barbellHome: 'Nordic Curl',
    dumbbell: 'Dumbbell Hamstring Curl',
    bodyweight: 'Nordic Curl',
    isMainLift: false,
    muscleGroups: ['hamstrings'],
  },
  calf_raise: {
    name: 'Calf Raise',
    barbell: 'Standing Calf Raise (machine)',
    barbellHome: 'Barbell Calf Raise',
    dumbbell: 'Dumbbell Calf Raise',
    bodyweight: 'Bodyweight Calf Raise',
    isMainLift: false,
    muscleGroups: ['calves'],
  },
  rear_delt_fly: {
    name: 'Rear Delt Fly',
    barbell: 'Reverse Pec Deck',
    dumbbell: 'Dumbbell Rear Delt Fly',
    bodyweight: 'Band Pull-apart',
    isMainLift: false,
    muscleGroups: ['rear_delts'],
  },
};

// ─── Helper to get exercise name for equipment level ───

export function getExerciseName(slotKey: string, equipment: EquipmentLevel): string {
  const slot = EXERCISE_SLOTS[slotKey];
  if (!slot) return slotKey;
  switch (equipment) {
    case 'full_gym': return slot.barbell;
    case 'barbell_home': return slot.barbellHome ?? slot.barbell;
    case 'dumbbells': return slot.dumbbell;
    case 'bodyweight': return slot.bodyweight;
    case 'mixed': return slot.barbellHome ?? slot.barbell;
    default: return slot.barbell;
  }
}

// ─── Program Definitions ───

export const PROGRAMS: Record<string, ProgramDefinition> = {
  // ═══════════════════════════════════════════
  // BEGINNER PROGRAMS
  // ═══════════════════════════════════════════

  starting_strength: {
    id: 'starting_strength',
    name: 'Starting Strength Linear Progression',
    shortName: 'Starting Strength',
    author: 'Mark Rippetoe',
    description: 'The full novice linear progression system (~65 min sessions including warm-up). Starts simple (Phase 1) and automatically evolves through 5 phases as your body demands more sophisticated stress management. Each phase introduces the minimum change needed to continue progress.',
    level: 'beginner',
    goals: ['strength', 'powerlifting'],
    daysPerWeek: [2, 3],
    equipmentMin: 'barbell_home',
    workouts: [
      // ═══ Phase 1: True Novice LP ═══
      // A: Squat 3x5, Press 3x5, Deadlift 1x5
      // B: Squat 3x5, Bench 3x5, Deadlift 1x5
      {
        name: 'Phase 1 — Workout A',
        dayLabel: 'Day A — Squat / Press / Deadlift',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '5', restSeconds: 180, notes: 'Work sets across (same weight all sets)' }] },
          { exerciseSlot: 'ohp', sets: [{ sets: 3, reps: '5', restSeconds: 180 }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 1, reps: '5', restSeconds: 180, notes: 'One heavy set of 5' }] },
        ],
      },
      {
        name: 'Phase 1 — Workout B',
        dayLabel: 'Day B — Squat / Bench / Deadlift',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '5', restSeconds: 180 }] },
          { exerciseSlot: 'bench', sets: [{ sets: 3, reps: '5', restSeconds: 180 }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 1, reps: '5', restSeconds: 180, notes: 'One heavy set of 5' }] },
        ],
      },
      // ═══ Phase 2: Light Pull Introduced ═══
      // A: Squat 3x5, Press 3x5, Deadlift 1x5
      // B: Squat 3x5, Bench 3x5, Row 3x5 (or Power Clean 5x3)
      {
        name: 'Phase 2 — Workout A',
        dayLabel: 'Day A — Squat / Press / Deadlift',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '5', restSeconds: 180 }] },
          { exerciseSlot: 'ohp', sets: [{ sets: 3, reps: '5', restSeconds: 180 }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 1, reps: '5', restSeconds: 180 }] },
        ],
      },
      {
        name: 'Phase 2 — Workout B',
        dayLabel: 'Day B — Squat / Bench / Rows',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '5', restSeconds: 180 }] },
          { exerciseSlot: 'bench', sets: [{ sets: 3, reps: '5', restSeconds: 180 }] },
          { exerciseSlot: 'row', sets: [{ sets: 3, reps: '5', restSeconds: 120, notes: 'Barbell rows (replaces deadlift to manage back fatigue)' }] },
        ],
      },
      // ═══ Phase 3: HLM for Squats + Pull Rotation ═══
      // A (Heavy): Squat 3x5, Press/Bench 3x5, Deadlift 1x5
      // B (Light): Squat 3x5 @ 80%, Press/Bench 3x5, Chin-ups 3xAMRAP
      // C (Medium): Squat 3x5, Press/Bench 3x5, Row 3x5
      {
        name: 'Phase 3 — Heavy Day',
        dayLabel: 'Heavy — Squat / Press / Deadlift',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '5', restSeconds: 240, notes: 'Heavy squat — full work weight' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 3, reps: '5', restSeconds: 180, notes: 'Alternate bench/press each week' }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 1, reps: '5', restSeconds: 300 }] },
        ],
      },
      {
        name: 'Phase 3 — Light Day',
        dayLabel: 'Light — Squat (80%) / Press / Chin-ups',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '5', restSeconds: 120, notes: 'Light squat — 80% of Heavy day. Focus on speed and technique.' }] },
          { exerciseSlot: 'ohp', sets: [{ sets: 3, reps: '5', restSeconds: 180, notes: 'Alternate bench/press each week' }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 3, reps: 'AMRAP', restSeconds: 90, notes: 'Chin-ups or lat pulldowns' }] },
        ],
      },
      {
        name: 'Phase 3 — Medium Day',
        dayLabel: 'Medium — Squat / Bench / Rows',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '5', restSeconds: 180, notes: 'Medium squat — full work weight (still progressing)' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 3, reps: '5', restSeconds: 180, notes: 'Alternate bench/press each week' }] },
          { exerciseSlot: 'row', sets: [{ sets: 3, reps: '5', restSeconds: 120 }] },
        ],
      },
      // ═══ Phase 4: Back-Off Sets + Squat Intensity Manipulation ═══
      // A (Heavy): Squat 1x5 top + 2x5 @ 90%, Press/Bench, Deadlift 1x5 + 2x5 @ 90%
      // B (Light): Squat 3x5 @ 80%, Press/Bench, Chin-ups
      // C (Medium/Back-off): Squat 1x5 top + 2x5 @ 90%, Press/Bench, Row
      {
        name: 'Phase 4 — Heavy + Back-offs',
        dayLabel: 'Heavy — Top Set + Back-offs',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 1, reps: '5', restSeconds: 300, notes: 'Top set — PR attempt' },
            { sets: 2, reps: '5', restSeconds: 180, notes: 'Back-off sets @ 90% of top set' },
          ] },
          { exerciseSlot: 'ohp', sets: [{ sets: 3, reps: '5', restSeconds: 180, notes: 'Alternate bench/press' }] },
          { exerciseSlot: 'deadlift', sets: [
            { sets: 1, reps: '5', restSeconds: 300, notes: 'Top set' },
            { sets: 2, reps: '5', restSeconds: 180, notes: 'Back-off sets @ 90% of top set' },
          ] },
        ],
      },
      {
        name: 'Phase 4 — Light Day',
        dayLabel: 'Light — Recovery',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '5', restSeconds: 120, notes: 'Light squat — 80% of heavy day' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 3, reps: '5', restSeconds: 180, notes: 'Alternate bench/press' }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 3, reps: '8', restSeconds: 90, notes: 'Chin-ups for back volume' }] },
        ],
      },
      {
        name: 'Phase 4 — Medium + Back-offs',
        dayLabel: 'Medium — Top Set + Back-offs',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 1, reps: '5', restSeconds: 240, notes: 'Top set (medium — may equal heavy day)' },
            { sets: 2, reps: '5', restSeconds: 180, notes: 'Back-off sets @ 90%' },
          ] },
          { exerciseSlot: 'ohp', sets: [{ sets: 3, reps: '5', restSeconds: 180, notes: 'Alternate bench/press' }] },
          { exerciseSlot: 'row', sets: [{ sets: 3, reps: '5', restSeconds: 120 }] },
        ],
      },
      // ═══ Phase 5: Full HLM Squat & Pull Rotation ═══
      // Same as Phase 4 but deadlift reduced to 1x/week, full stress rotation
      {
        name: 'Phase 5 — Heavy',
        dayLabel: 'Heavy — Full HLM',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '5', restSeconds: 300, notes: 'Heavy squat — top weight' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 3, reps: '5', restSeconds: 180, notes: 'Alternate bench/press' }] },
          { exerciseSlot: 'row', sets: [{ sets: 3, reps: '5', restSeconds: 120, notes: 'Heavy rows or power cleans 5x3' }] },
        ],
      },
      {
        name: 'Phase 5 — Light',
        dayLabel: 'Light — Recovery',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '5', restSeconds: 120, notes: 'Light squat — 80% of heavy day' }] },
          { exerciseSlot: 'ohp', sets: [{ sets: 3, reps: '5', restSeconds: 180, notes: 'Alternate bench/press' }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 3, reps: '10', restSeconds: 90, notes: 'Chin-ups for volume' }] },
        ],
      },
      {
        name: 'Phase 5 — Medium',
        dayLabel: 'Medium — Moderate Intensity',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 1, reps: '5', restSeconds: 240, notes: 'Top set' },
            { sets: 2, reps: '5', restSeconds: 180, notes: 'Back-off @ 90%' },
          ] },
          { exerciseSlot: 'bench', sets: [{ sets: 3, reps: '5', restSeconds: 180, notes: 'Alternate bench/press' }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 1, reps: '5', restSeconds: 300, notes: 'Only heavy deadlift of the week' }] },
        ],
      },
    ],
    progression: {
      type: 'linear_session',
      incrementLbs: { upper: 5, lower: 10 },
      description: 'Add weight every session. Start with +10 lb/session for squat/deadlift, +5 lb for bench/OHP. When first stall occurs, reduce increments to +5 lb lower body, +2.5 lb upper body (microplates recommended). The program automatically evolves through 5 phases as recovery demands increase.',
      stallProtocol: 'Fail to complete 3x5 → repeat same weight next session. Fail again → deload 10% and work back up. Stall patterns also trigger phase advancement (e.g., deadlift stalls trigger Phase 1→2). After Phase 5 is exhausted, transition to intermediate programming.',
      maxStallCycles: 3,
    },
    deload: {
      frequency: 'Reactive (after stall)',
      method: 'Reduce weight 10%, work back up with current increment size',
      duration: '1-2 weeks to regain previous weight',
      citation: 'Rippetoe M. Starting Strength, 3rd ed. (2011), Ch. 8; Practical Guide to the Novice Linear Progression (SS coaching staff)',
    },
    transitionCriteria: 'After Phase 5 (Full HLM): when weekly PRs are no longer possible despite HLM stress management and adequate recovery. Transition to Texas Method, 4-Day HLM Split, or 5/3/1. Each lift may transition independently.',
    transitionOptions: ['texas_method', 'hlm_split', '531_bbb', 'gzcl_jt2', 'upper_lower_split'],
    scienceBasis: 'Novice lifters recover within 48-72 hours, allowing session-to-session progression. The stress-recovery-adaptation cycle (Selye 1956, General Adaptation Syndrome) supports frequent exposure to progressively heavier loads at this stage. Kraemer & Ratamess (2004, PMID: 14636100) confirmed that progressive overload is the foundational driver of strength adaptation. When recovery between sessions is no longer sufficient, weekly or multi-week periodization is needed (Rippetoe, Practical Programming 3rd ed. 2013).',
    typicalDurationWeeks: [12, 36],
    sessionMinutes: 65,
  },

  gzclp: {
    id: 'gzclp',
    name: 'GZCLP',
    shortName: 'GZCLP',
    author: 'Cody Lefever',
    description: 'Tiered linear progression with built-in failure management (~60 min sessions). 3 tiers: T1 (heavy compound), T2 (moderate compound), T3 (light accessory). When you fail at a stage, the rep scheme adapts automatically.',
    level: 'beginner',
    goals: ['strength', 'powerlifting', 'powerbuilding'],
    daysPerWeek: [3, 4],
    equipmentMin: 'barbell_home',
    workouts: [
      {
        name: 'Day A1',
        dayLabel: 'Day A1',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 5, reps: '3+', restSeconds: 180, notes: 'T1 — last set AMRAP (stop 1-2 reps from failure)' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 3, reps: '10', restSeconds: 90, notes: 'T2 — moderate weight' }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 3, reps: '15+', restSeconds: 60, notes: 'T3 — last set AMRAP' }] },
        ],
      },
      {
        name: 'Day B1',
        dayLabel: 'Day B1',
        exercises: [
          { exerciseSlot: 'ohp', sets: [{ sets: 5, reps: '3+', restSeconds: 180, notes: 'T1' }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 3, reps: '10', restSeconds: 90, notes: 'T2' }] },
          { exerciseSlot: 'row', sets: [{ sets: 3, reps: '15+', restSeconds: 60, notes: 'T3' }] },
        ],
      },
      {
        name: 'Day A2',
        dayLabel: 'Day A2',
        exercises: [
          { exerciseSlot: 'bench', sets: [{ sets: 5, reps: '3+', restSeconds: 180, notes: 'T1' }] },
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '10', restSeconds: 90, notes: 'T2' }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 3, reps: '15+', restSeconds: 60, notes: 'T3' }] },
        ],
      },
      {
        name: 'Day B2',
        dayLabel: 'Day B2',
        exercises: [
          { exerciseSlot: 'deadlift', sets: [{ sets: 5, reps: '3+', restSeconds: 180, notes: 'T1' }] },
          { exerciseSlot: 'ohp', sets: [{ sets: 3, reps: '10', restSeconds: 90, notes: 'T2' }] },
          { exerciseSlot: 'row', sets: [{ sets: 3, reps: '15+', restSeconds: 60, notes: 'T3' }] },
        ],
      },
    ],
    progression: {
      type: 'linear_session',
      incrementLbs: { upper: 5, lower: 10 },
      description: 'T1: Add weight each session. When you fail to complete required reps, advance to next stage: Stage 1 (5×3+) → Stage 2 (6×2+) → Stage 3 (10×1+). After Stage 3 failure, test new 5RM, restart at 85%. T2: Add weight each session. Fail → advance stage: 3×10 → 3×8 → 3×6, then add 15-20 lbs and restart at 3×10. T3: When AMRAP set hits 25+ total reps, add weight next session.',
      stallProtocol: 'T1 stage progression (automatic). T2 stage progression. After T1 Stage 3 failure on all lifts, transition to intermediate programming.',
      maxStallCycles: 3,
    },
    deload: {
      frequency: 'Built into stage progression (auto-resets at 85%)',
      method: 'T1: Reset to 85% of new test max. T2: Reset with +15-20 lbs added to original starting weight.',
      duration: '1-2 weeks during ramp-up',
      citation: 'Lefever C. GZCL Method (swoleateveryheight.blogspot.com, 2014)',
    },
    transitionCriteria: 'All T1 lifts have cycled through all 3 stages at least once and you have tested new maxes. Typical sign: you can no longer add weight session-to-session even with stage cycling.',
    transitionOptions: ['texas_method', 'hlm_split', '531_bbb', '531_fsl', 'gzcl_jt2'],
    scienceBasis: 'The tiered approach (heavy/moderate/light) trains multiple strength qualities simultaneously, consistent with the principle of training specificity across intensity zones (Kraemer & Ratamess 2004, PMID: 14636100). The AMRAP "+" sets provide autoregulation — you can exceed minimums on good days and hit minimums on bad days, aligning with RPE-based methods shown superior to fixed percentages (Zourdos et al. 2016, PMID: 26666744; meta-analysis PMC12336695). Stage progression acts as automatic periodization, systematically adjusting volume and intensity to continue driving adaptation. (Lefever 2014, swoleateveryheight.blogspot.com)',
    typicalDurationWeeks: [12, 40],
    sessionMinutes: 60,
  },

  '531_beginner': {
    id: '531_beginner',
    name: '5/3/1 for Beginners',
    shortName: '5/3/1 Beginner',
    author: 'Jim Wendler',
    description: '3-day beginner variant of 5/3/1 (~70 min sessions including warm-up). Uses a Training Max (90% of true 1RM) for all percentages. Each lift trained 2x/week with FSL 5x5 supplemental work plus 50-100 reps of push/pull/single-leg assistance.',
    level: 'beginner',
    goals: ['strength', 'powerlifting', 'general'],
    daysPerWeek: [3],
    equipmentMin: 'barbell_home',
    workouts: [
      {
        name: 'Day 1: Squat + Bench',
        dayLabel: 'Day 1',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 1, reps: '5', intensityPct: 65, restSeconds: 120, notes: 'Warm-up set @ 65% TM' },
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120, notes: 'Work set @ 75% TM' },
            { sets: 1, reps: '5+', intensityPct: 85, restSeconds: 180, notes: 'Top set AMRAP @ 85% TM (Week 1)' },
            { sets: 5, reps: '5', intensityPct: 65, restSeconds: 90, notes: 'FSL 5×5 @ first set weight' },
          ] },
          { exerciseSlot: 'bench', sets: [
            { sets: 1, reps: '5', intensityPct: 65, restSeconds: 120 },
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120 },
            { sets: 1, reps: '5+', intensityPct: 85, restSeconds: 180, notes: 'AMRAP @ 85% TM' },
            { sets: 5, reps: '5', intensityPct: 65, restSeconds: 90, notes: 'FSL 5×5' },
          ] },
          { exerciseSlot: 'pullup', sets: [{ sets: 5, reps: '10', restSeconds: 60, notes: 'Assistance: 50-100 reps total push/pull/legs' }] },
        ],
      },
      {
        name: 'Day 2: Deadlift + OHP',
        dayLabel: 'Day 2',
        exercises: [
          { exerciseSlot: 'deadlift', sets: [
            { sets: 1, reps: '5', intensityPct: 65, restSeconds: 120 },
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120 },
            { sets: 1, reps: '5+', intensityPct: 85, restSeconds: 180, notes: 'AMRAP' },
            { sets: 5, reps: '5', intensityPct: 65, restSeconds: 90, notes: 'FSL 5×5' },
          ] },
          { exerciseSlot: 'ohp', sets: [
            { sets: 1, reps: '5', intensityPct: 65, restSeconds: 120 },
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120 },
            { sets: 1, reps: '5+', intensityPct: 85, restSeconds: 180, notes: 'AMRAP' },
            { sets: 5, reps: '5', intensityPct: 65, restSeconds: 90, notes: 'FSL 5×5' },
          ] },
          { exerciseSlot: 'row', sets: [{ sets: 5, reps: '10', restSeconds: 60, notes: 'Assistance: 50-100 reps' }] },
        ],
      },
      {
        name: 'Day 3: Squat + OHP',
        dayLabel: 'Day 3',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 1, reps: '5', intensityPct: 65, restSeconds: 120 },
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120 },
            { sets: 1, reps: '5+', intensityPct: 85, restSeconds: 180, notes: 'AMRAP' },
            { sets: 5, reps: '5', intensityPct: 65, restSeconds: 90, notes: 'FSL 5×5' },
          ] },
          { exerciseSlot: 'ohp', sets: [
            { sets: 1, reps: '5', intensityPct: 65, restSeconds: 120 },
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120 },
            { sets: 1, reps: '5+', intensityPct: 85, restSeconds: 180, notes: 'AMRAP' },
            { sets: 5, reps: '5', intensityPct: 65, restSeconds: 90, notes: 'FSL 5×5' },
          ] },
          { exerciseSlot: 'leg_press', sets: [{ sets: 3, reps: '15', restSeconds: 60, notes: 'Assistance: 50-100 reps push/pull/legs' }] },
        ],
      },
    ],
    progression: {
      type: 'percentage_wave',
      incrementLbs: { upper: 5, lower: 10 },
      description: '3-week wave: Week 1 (5s week): 65/75/85% × 5/5/5+. Week 2 (3s week): 70/80/90% × 3/3/3+. Week 3 (5/3/1 week): 75/85/95% × 5/3/1+. Week 4: Deload 40/50/60% × 5. After each 3-week cycle, increase Training Max: +5 lbs upper body, +10 lbs lower body. All percentages based on Training Max (90% of actual 1RM).',
      stallProtocol: 'If AMRAP set yields fewer than the required reps (5/3/1), your Training Max is too high. Reset TM to 90% of a new tested or estimated max. 5/3/1 is designed to be run indefinitely with TM resets — Jim Wendler recommends "5 forward, 3 back" (5 cycles forward, reset TM 3 cycles back) for long-term progress.',
      maxStallCycles: 2,
    },
    deload: {
      frequency: 'Every 4th week (7th week protocol also acceptable: 2 leaders + 1 anchor)',
      method: 'Week 4: 40% × 5, 50% × 5, 60% × 5 of Training Max. No AMRAP, no supplemental.',
      duration: '1 week',
      citation: 'Wendler J. 5/3/1 Forever (2017), "5/3/1 for Beginners" template',
    },
    transitionCriteria: 'After 6-12 months, if training 3 days/week feels insufficient (recovery is too fast between sessions), transition to a 4-day 5/3/1 template or other intermediate program.',
    transitionOptions: ['531_bbb', '531_fsl', 'texas_method', 'hlm_split', 'gzcl_jt2'],
    scienceBasis: '5/3/1 uses submaximal training (Training Max = 90% of 1RM) to build strength without grinding. The AMRAP "+" sets provide autoregulation (per Zourdos et al. 2016) and allow rep PRs even during lighter weeks. FSL 5×5 provides hypertrophy stimulus. The 3-week wave provides undulating periodization, and the slow, steady TM increases ensure long-term sustainability. Wendler (2017) reports this system works for decades, not months.',
    typicalDurationWeeks: [24, 52],
    sessionMinutes: 70,
  },

  // ═══════════════════════════════════════════
  // INTERMEDIATE PROGRAMS
  // ═══════════════════════════════════════════

  texas_method: {
    id: 'texas_method',
    name: 'Texas Method',
    shortName: 'Texas Method',
    author: 'Mark Rippetoe / Glenn Pendlay',
    description: 'Weekly periodization (~80 min sessions). Volume day (Monday) drives adaptation, Recovery day (Wednesday) maintains fitness, Intensity day (Friday) tests new PRs. Progress is weekly instead of session-to-session.',
    level: 'intermediate',
    goals: ['strength', 'powerlifting'],
    daysPerWeek: [3],
    equipmentMin: 'barbell_home',
    workouts: [
      {
        name: 'Volume Day (Monday)',
        dayLabel: 'Monday — Volume',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 5, reps: '5', restSeconds: 240, notes: '5×5 @ 90% of Friday\'s 5RM. All sets same weight.' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 5, reps: '5', restSeconds: 240, notes: '5×5 @ 90% of Friday\'s 5RM (bench weeks). Alternate with OHP.' }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 1, reps: '5', restSeconds: 180, notes: 'Optional light deadlift or skip (heavy DL on Friday)' }] },
        ],
      },
      {
        name: 'Recovery Day (Wednesday)',
        dayLabel: 'Wednesday — Recovery',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 2, reps: '5', restSeconds: 120, notes: '2×5 @ 80% of Monday\'s weight' }] },
          { exerciseSlot: 'ohp', sets: [{ sets: 3, reps: '5', restSeconds: 120, notes: '3×5 moderate (OHP weeks) or lighter bench work' }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 3, reps: '10', restSeconds: 60, notes: 'Chin-ups or pull-ups for back volume' }] },
        ],
      },
      {
        name: 'Intensity Day (Friday)',
        dayLabel: 'Friday — Intensity',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 1, reps: '5', restSeconds: 300, notes: 'New 5RM PR attempt! This is THE set of the week.' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 1, reps: '5', restSeconds: 300, notes: 'New 5RM PR (bench weeks). Alternate with OHP.' }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 1, reps: '5', restSeconds: 300, notes: 'Heavy deadlift — new 5RM' }] },
        ],
      },
    ],
    progression: {
      type: 'linear_weekly',
      incrementLbs: { upper: 5, lower: 5 },
      description: 'Weekly linear progression. Add ~5 lbs to Friday\'s PR set each week. Bench/OHP alternate, so each pressing movement gets a PR attempt every 2 weeks. Monday volume adjusts to stay at ~90% of Friday\'s weight.',
      stallProtocol: 'If you fail Friday\'s PR: 1) Reduce Monday volume to 3×5 (from 5×5). 2) If still stalling, reduce Friday to triples (1×3) for a cycle. 3) If still stalling after 2-3 resets, move to more advanced periodization.',
      maxStallCycles: 3,
    },
    deload: {
      frequency: 'Reactive — deload when Friday PR fails after volume adjustment',
      method: 'Drop all weights 10%, rebuild over 2-3 weeks',
      duration: '2-3 weeks',
      citation: 'Rippetoe M. Practical Programming for Strength Training, 3rd ed. (2013); Baker A. The Texas Method (2015)',
    },
    transitionCriteria: 'When weekly PRs are no longer achievable despite volume/intensity adjustments. Typical sign: Friday PRs stall across multiple deload cycles even with good recovery.',
    transitionOptions: ['531_bbb', '531_fsl', 'block_periodization', 'dup', 'gzcl_jt2'],
    scienceBasis: 'The Texas Method separates the volume stimulus (Monday) from the intensity expression (Friday) by 4 days, allowing 96 hours of recovery. This matches the intermediate recovery timeline where daily adaptation is too fast (novice) but weekly periodization still works. The Volume-Recovery-Intensity structure is a practical implementation of Selye\'s General Adaptation Syndrome (1956) applied to weekly cycles. (Rippetoe M. & Baker A. Practical Programming for Strength Training, 3rd ed. 2013; Baker A. The Texas Method 2015). Weekly periodization is well-supported for intermediate lifters by Rhea et al. (2003, PMID: 14636104) meta-analysis on periodized vs non-periodized training.',
    typicalDurationWeeks: [12, 48],
    sessionMinutes: 80,
  },

  hlm_split: {
    id: 'hlm_split',
    name: 'Heavy / Light / Medium Split',
    shortName: 'HLM',
    author: 'Andy Baker / Bill Starr',
    description: 'Each training day has a different stress level (~70 min sessions): Heavy (top sets at RPE 8-9), Light (70-75%), Medium (80-85%). Manages weekly fatigue while still training each lift 3x/week. Highly customizable.',
    level: 'intermediate',
    goals: ['strength', 'powerlifting', 'general'],
    daysPerWeek: [3, 4],
    equipmentMin: 'barbell_home',
    workouts: [
      {
        name: 'Heavy Day',
        dayLabel: 'Monday — Heavy',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '5', rpe: 8.5, restSeconds: 300, notes: 'Top sets — heaviest of the week' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 3, reps: '5', rpe: 8.5, restSeconds: 300, notes: 'Heavy bench work' }] },
          { exerciseSlot: 'row', sets: [{ sets: 3, reps: '8', restSeconds: 90, notes: 'Moderate accessory work' }] },
        ],
      },
      {
        name: 'Light Day',
        dayLabel: 'Wednesday — Light',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '5', rpe: 6, restSeconds: 120, notes: '70-75% of Heavy day weight' }] },
          { exerciseSlot: 'ohp', sets: [{ sets: 3, reps: '5', rpe: 7, restSeconds: 120, notes: 'Moderate pressing' }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 3, reps: 'AMRAP', restSeconds: 90, notes: 'Bodyweight pull-ups' }] },
        ],
      },
      {
        name: 'Medium Day',
        dayLabel: 'Friday — Medium',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '5', rpe: 7.5, restSeconds: 180, notes: '80-85% of Heavy day weight' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 3, reps: '5', rpe: 7.5, restSeconds: 180, notes: 'Medium bench — build volume' }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 1, reps: '5', rpe: 8, restSeconds: 300, notes: 'Heavy deadlift (only pulled heavy once/week)' }] },
        ],
      },
    ],
    progression: {
      type: 'rpe_autoregulated',
      incrementLbs: { upper: 5, lower: 5 },
      description: 'RPE-autoregulated: Heavy day targets RPE 8-9. When RPE 8 feels easy (bar speed fast), add 5 lbs next week. Light and Medium days scale proportionally. This is the key advantage of HLM — progression is driven by readiness, not fixed percentages (Zourdos et al. 2016, PMID: 26666744; Helms et al. 2016: RIR-based RPE autoregulation for strength athletes).',
      stallProtocol: 'If Heavy day RPE consistently exceeds 9.5 for 2+ weeks without weight increase, take a deload week. If progress stalls after deload, adjust volume (add/remove sets) or vary rep ranges (triples on heavy day, sets of 8 on medium day).',
      maxStallCycles: 3,
    },
    deload: {
      frequency: 'Every 4-6 weeks or when RPE exceeds targets for 2+ weeks',
      method: 'Reduce all weights to Light day levels for 1 week. All days at RPE 5-6.',
      duration: '1 week',
      citation: 'Baker A. (andybaker.com); Starr B. The Strongest Shall Survive (1976); Zourdos et al. (2016) RPE autoregulation',
    },
    transitionCriteria: 'HLM can be run indefinitely with modifications. Transition to block periodization or DUP when: weekly progress is no longer sufficient, or you want to specialize for competition.',
    transitionOptions: ['block_periodization', 'dup', '531_bbb', 'conjugate'],
    scienceBasis: 'HLM manages intra-week fatigue by varying training stress. This matches the dose-response relationship: Heavy days provide the strength stimulus, Light days promote active recovery without adding fatigue, Medium days provide moderate additional stimulus. The RPE-based approach uses autoregulation (Zourdos et al. 2016; Helms et al. 2016) which is superior to fixed percentages for intermediate lifters. (Baker 2015; meta-analysis: PMC12336695)',
    typicalDurationWeeks: [16, 104],
    sessionMinutes: 70,
  },

  '531_bbb': {
    id: '531_bbb',
    name: '5/3/1 Boring But Big',
    shortName: '5/3/1 BBB',
    author: 'Jim Wendler',
    description: 'The classic hypertrophy-focused 5/3/1 template (~80 min sessions). After the main 5/3/1 sets, perform 5×10 of the same lift at 50-60% Training Max. High volume builds muscle mass to support future strength gains.',
    level: 'intermediate',
    goals: ['hypertrophy', 'powerbuilding', 'strength'],
    daysPerWeek: [4],
    equipmentMin: 'barbell_home',
    workouts: [
      {
        name: 'Day 1: Squat',
        dayLabel: 'Day 1 — Squat',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 1, reps: '5', intensityPct: 65, restSeconds: 120 },
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120 },
            { sets: 1, reps: '5+', intensityPct: 85, restSeconds: 180, notes: 'AMRAP top set' },
            { sets: 5, reps: '10', intensityPct: 50, restSeconds: 90, notes: 'BBB sets @ 50-60% TM' },
          ] },
          { exerciseSlot: 'leg_press', sets: [{ sets: 5, reps: '10', restSeconds: 60, notes: 'Assistance: 50-100 reps legs' }] },
          { exerciseSlot: 'ab_work', sets: [{ sets: 3, reps: '15', restSeconds: 60, notes: 'Core work' }] },
        ],
      },
      {
        name: 'Day 2: Bench',
        dayLabel: 'Day 2 — Bench',
        exercises: [
          { exerciseSlot: 'bench', sets: [
            { sets: 1, reps: '5', intensityPct: 65, restSeconds: 120 },
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120 },
            { sets: 1, reps: '5+', intensityPct: 85, restSeconds: 180, notes: 'AMRAP' },
            { sets: 5, reps: '10', intensityPct: 50, restSeconds: 90, notes: 'BBB 5×10' },
          ] },
          { exerciseSlot: 'row', sets: [{ sets: 5, reps: '10', restSeconds: 60, notes: 'Assistance: 50-100 reps pull' }] },
          { exerciseSlot: 'face_pull', sets: [{ sets: 3, reps: '20', restSeconds: 45, notes: 'Shoulder health' }] },
        ],
      },
      {
        name: 'Day 3: Deadlift',
        dayLabel: 'Day 3 — Deadlift',
        exercises: [
          { exerciseSlot: 'deadlift', sets: [
            { sets: 1, reps: '5', intensityPct: 65, restSeconds: 120 },
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120 },
            { sets: 1, reps: '5+', intensityPct: 85, restSeconds: 180, notes: 'AMRAP' },
            { sets: 5, reps: '10', intensityPct: 50, restSeconds: 90, notes: 'BBB 5×10' },
          ] },
          { exerciseSlot: 'leg_press', sets: [{ sets: 3, reps: '15', restSeconds: 60, notes: 'Quad accessory' }] },
          { exerciseSlot: 'ab_work', sets: [{ sets: 3, reps: '15', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Day 4: OHP',
        dayLabel: 'Day 4 — OHP',
        exercises: [
          { exerciseSlot: 'ohp', sets: [
            { sets: 1, reps: '5', intensityPct: 65, restSeconds: 120 },
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120 },
            { sets: 1, reps: '5+', intensityPct: 85, restSeconds: 180, notes: 'AMRAP' },
            { sets: 5, reps: '10', intensityPct: 50, restSeconds: 90, notes: 'BBB 5×10' },
          ] },
          { exerciseSlot: 'pullup', sets: [{ sets: 5, reps: '10', restSeconds: 60, notes: '50-100 reps pull' }] },
          { exerciseSlot: 'curl', sets: [{ sets: 3, reps: '15', restSeconds: 45, notes: 'Assistance' }] },
        ],
      },
    ],
    progression: {
      type: 'percentage_wave',
      incrementLbs: { upper: 5, lower: 10 },
      description: 'Same 5/3/1 wave as beginner template. Week 1: 65/75/85%, Week 2: 70/80/90%, Week 3: 75/85/95%. After each 3-week cycle, +5 lbs upper TM, +10 lbs lower TM. BBB sets stay at 50-60% TM (increase % gradually over mesocycles: start at 50%, work up to 60% across cycles).',
      stallProtocol: 'If AMRAP top set yields fewer reps than required, TM is too high. Reset: TM = 90% of new estimated max, or use "5 forward, 3 back" — after 5 TM increases, reset TM back to where it was 3 cycles ago.',
      maxStallCycles: 2,
    },
    deload: {
      frequency: 'Every 4th week',
      method: '40/50/60% TM × 5 reps. No BBB sets. Assistance cut to 25-50 reps total.',
      duration: '1 week',
      citation: 'Wendler J. 5/3/1 Forever (2017), "Boring But Big" template',
    },
    transitionCriteria: 'BBB can be run for 2-3 cycles (6-9 weeks), then switch to another 5/3/1 template (FSL, BBS) or a different program. Wendler recommends alternating Leaders (volume-focused like BBB) and Anchors (intensity-focused like PR sets + jokers).',
    transitionOptions: ['531_fsl', 'block_periodization', 'dup', 'conjugate'],
    scienceBasis: 'The 5×10 supplemental work at 50-60% provides significant mechanical tension and metabolic stress for hypertrophy (Schoenfeld 2010). Combined with the heavy AMRAP set, BBB trains both the neural and muscular components of strength. Volume is ~15-20 sets per muscle group per week for the main lifts, which falls within the optimal hypertrophy range (Schoenfeld et al. 2017: 10+ sets/week per muscle group).',
    typicalDurationWeeks: [6, 18],
    sessionMinutes: 80,
  },

  '531_fsl': {
    id: '531_fsl',
    name: '5/3/1 First Set Last',
    shortName: '5/3/1 FSL',
    author: 'Jim Wendler',
    description: 'Strength-focused 5/3/1 template (~70 min sessions). After the main 5/3/1 work, perform 5×5 at the first working set\'s percentage. Less fatiguing than BBB, emphasizes strength over hypertrophy.',
    level: 'intermediate',
    goals: ['strength', 'powerlifting'],
    daysPerWeek: [4],
    equipmentMin: 'barbell_home',
    workouts: [
      {
        name: 'Day 1: Squat',
        dayLabel: 'Day 1 — Squat',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 1, reps: '5', intensityPct: 65, restSeconds: 120 },
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120 },
            { sets: 1, reps: '5+', intensityPct: 85, restSeconds: 180, notes: 'AMRAP top set' },
            { sets: 5, reps: '5', intensityPct: 65, restSeconds: 90, notes: 'FSL 5×5 @ first set weight' },
          ] },
          { exerciseSlot: 'pullup', sets: [{ sets: 5, reps: '10', restSeconds: 60, notes: '50-100 reps pull' }] },
          { exerciseSlot: 'ab_work', sets: [{ sets: 3, reps: '15', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Day 2: Bench',
        dayLabel: 'Day 2 — Bench',
        exercises: [
          { exerciseSlot: 'bench', sets: [
            { sets: 1, reps: '5', intensityPct: 65, restSeconds: 120 },
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120 },
            { sets: 1, reps: '5+', intensityPct: 85, restSeconds: 180, notes: 'AMRAP' },
            { sets: 5, reps: '5', intensityPct: 65, restSeconds: 90, notes: 'FSL 5×5' },
          ] },
          { exerciseSlot: 'row', sets: [{ sets: 5, reps: '10', restSeconds: 60, notes: '50-100 reps pull' }] },
          { exerciseSlot: 'face_pull', sets: [{ sets: 3, reps: '20', restSeconds: 45 }] },
        ],
      },
      {
        name: 'Day 3: Deadlift',
        dayLabel: 'Day 3 — Deadlift',
        exercises: [
          { exerciseSlot: 'deadlift', sets: [
            { sets: 1, reps: '5', intensityPct: 65, restSeconds: 120 },
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120 },
            { sets: 1, reps: '5+', intensityPct: 85, restSeconds: 180, notes: 'AMRAP' },
            { sets: 5, reps: '5', intensityPct: 65, restSeconds: 90, notes: 'FSL 5×5' },
          ] },
          { exerciseSlot: 'leg_press', sets: [{ sets: 3, reps: '15', restSeconds: 60 }] },
          { exerciseSlot: 'ab_work', sets: [{ sets: 3, reps: '15', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Day 4: OHP',
        dayLabel: 'Day 4 — OHP',
        exercises: [
          { exerciseSlot: 'ohp', sets: [
            { sets: 1, reps: '5', intensityPct: 65, restSeconds: 120 },
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120 },
            { sets: 1, reps: '5+', intensityPct: 85, restSeconds: 180, notes: 'AMRAP' },
            { sets: 5, reps: '5', intensityPct: 65, restSeconds: 90, notes: 'FSL 5×5' },
          ] },
          { exerciseSlot: 'pullup', sets: [{ sets: 5, reps: '10', restSeconds: 60 }] },
          { exerciseSlot: 'tricep_extension', sets: [{ sets: 3, reps: '15', restSeconds: 45 }] },
        ],
      },
    ],
    progression: {
      type: 'percentage_wave',
      incrementLbs: { upper: 5, lower: 10 },
      description: 'Identical to 5/3/1 BBB progression: 3-week wave, TM increases +5 upper / +10 lower per cycle. FSL weight changes automatically as the first working set percentage increases across the wave.',
      stallProtocol: 'Same as BBB: reset TM when AMRAP underperforms. "5 forward, 3 back" for long-term cycling.',
      maxStallCycles: 2,
    },
    deload: {
      frequency: 'Every 4th week',
      method: '40/50/60% TM × 5, no supplemental, reduced assistance.',
      duration: '1 week',
      citation: 'Wendler J. 5/3/1 Forever (2017), "First Set Last" template',
    },
    transitionCriteria: 'FSL can be run indefinitely. Switch to BBB for hypertrophy phases, or to an Anchor template for peaking/testing.',
    transitionOptions: ['531_bbb', 'block_periodization', 'dup'],
    scienceBasis: 'FSL provides moderate supplemental volume at submaximal intensity, reinforcing technique while building strength endurance. The 5x5 at ~65-75% TM (~58-68% actual 1RM) falls in the optimal mechanical tension zone for strength without excessive fatigue (Schoenfeld 2010, PMID: 20847704). Lower total volume than BBB makes FSL better for caloric deficits or when pairing with other stressors. Wendler (2017, 5/3/1 Forever) specifically recommends FSL as the default supplemental template for most lifters. The submaximal approach aligns with Androulakis-Korakakis et al. (2020, PMC8435792) showing minimum effective dose is lower than commonly programmed.',
    typicalDurationWeeks: [6, 24],
    sessionMinutes: 70,
  },

  gzcl_jt2: {
    id: 'gzcl_jt2',
    name: 'GZCL Jacked & Tan 2.0',
    shortName: 'J&T 2.0',
    author: 'Cody Lefever',
    description: '12-week intermediate powerbuilding program (~75 min sessions). Uses a daily rep max (RM) finder methodology: work up to a target RM, then perform back-off sets at a percentage of that RM. Weeks 1-6 (Volume Block): RM target decreases each week (10RM → 8RM → 6RM → 4RM → 3RM → 2RM) while back-off volume accumulates. Weeks 7-12 (Intensity Block): heavier RM targets with reduced volume, culminating in a 1RM test in week 12.',
    level: 'intermediate',
    goals: ['powerbuilding', 'strength', 'hypertrophy'],
    daysPerWeek: [4],
    equipmentMin: 'barbell_home',
    workouts: [
      {
        name: 'Day 1: Squat Focus',
        dayLabel: 'Day 1 — Squat',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 1, reps: '10', restSeconds: 180, notes: 'T1: Work up to a daily RM (Wk1: 10RM, Wk2: 8RM, Wk3: 6RM, Wk4: 4RM, Wk5: 3RM, Wk6: 2RM)' },
            { sets: 3, reps: '6', restSeconds: 120, notes: 'T1 back-offs: 3 sets at ~65-70% of today\'s RM. Reduce reps as RM target drops across weeks.' },
          ] },
          { exerciseSlot: 'front_squat', sets: [
            { sets: 1, reps: '10', restSeconds: 120, notes: 'T2a: Find daily RM at target reps (follows same weekly RM progression)' },
            { sets: 3, reps: '8', restSeconds: 90, notes: 'T2a back-offs at ~65% of RM' },
          ] },
          { exerciseSlot: 'leg_press', sets: [{ sets: 3, reps: '15', restSeconds: 90, notes: 'T2b: Straight sets' }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 4, reps: '15+', restSeconds: 60, notes: 'T3: Last set AMRAP' }] },
        ],
      },
      {
        name: 'Day 2: Bench Focus',
        dayLabel: 'Day 2 — Bench',
        exercises: [
          { exerciseSlot: 'bench', sets: [
            { sets: 1, reps: '10', restSeconds: 180, notes: 'T1: Work up to daily RM (Wk1: 10RM → Wk6: 2RM)' },
            { sets: 3, reps: '6', restSeconds: 120, notes: 'T1 back-offs at ~65-70% of RM' },
          ] },
          { exerciseSlot: 'close_grip_bench', sets: [
            { sets: 1, reps: '10', restSeconds: 120, notes: 'T2a: Find daily RM' },
            { sets: 3, reps: '8', restSeconds: 90, notes: 'T2a back-offs at ~65% of RM' },
          ] },
          { exerciseSlot: 'row', sets: [{ sets: 4, reps: '12', restSeconds: 90, notes: 'T2b' }] },
          { exerciseSlot: 'face_pull', sets: [{ sets: 4, reps: '20', restSeconds: 45, notes: 'T3' }] },
        ],
      },
      {
        name: 'Day 3: Deadlift Focus',
        dayLabel: 'Day 3 — Deadlift',
        exercises: [
          { exerciseSlot: 'deadlift', sets: [
            { sets: 1, reps: '10', restSeconds: 180, notes: 'T1: Work up to daily RM (Wk1: 10RM → Wk6: 2RM)' },
            { sets: 2, reps: '6', restSeconds: 120, notes: 'T1 back-offs at ~65-70% of RM' },
          ] },
          { exerciseSlot: 'rdl', sets: [
            { sets: 1, reps: '10', restSeconds: 120, notes: 'T2a: Find daily RM' },
            { sets: 2, reps: '8', restSeconds: 90, notes: 'T2a back-offs at ~65% of RM' },
          ] },
          { exerciseSlot: 'hip_thrust', sets: [{ sets: 3, reps: '12', restSeconds: 90, notes: 'T2b' }] },
          { exerciseSlot: 'ab_work', sets: [{ sets: 3, reps: '15', restSeconds: 60, notes: 'T3' }] },
        ],
      },
      {
        name: 'Day 4: OHP Focus',
        dayLabel: 'Day 4 — OHP',
        exercises: [
          { exerciseSlot: 'ohp', sets: [
            { sets: 1, reps: '10', restSeconds: 180, notes: 'T1: Work up to daily RM (Wk1: 10RM → Wk6: 2RM)' },
            { sets: 3, reps: '6', restSeconds: 120, notes: 'T1 back-offs at ~65-70% of RM' },
          ] },
          { exerciseSlot: 'bench', sets: [
            { sets: 1, reps: '10', restSeconds: 120, notes: 'T2a: Volume bench — find daily RM' },
            { sets: 3, reps: '8', restSeconds: 90, notes: 'T2a back-offs at ~65% of RM' },
          ] },
          { exerciseSlot: 'pullup', sets: [{ sets: 4, reps: '10', restSeconds: 90, notes: 'T2b' }] },
          { exerciseSlot: 'curl', sets: [{ sets: 3, reps: '15', restSeconds: 45, notes: 'T3' }] },
        ],
      },
    ],
    progression: {
      type: 'block',
      incrementLbs: { upper: 5, lower: 10 },
      description: 'Rep Max Finder methodology: Weeks 1-6 (Volume Block) — T1 RM target decreases weekly: 10RM → 8RM → 6RM → 4RM → 3RM → 2RM. Work up to that RM, then do back-off sets at 65-70% of the RM weight. Back-off reps also decrease as intensity increases. Weeks 7-12 (Intensity Block) — use Week 6 results to set working weights. Continue RM progression: 4RM → 3RM → 2RM → 1RM over weeks 9-12. T2/T3 volume tapers as T1 intensity peaks. Week 12: test 1RM on all main lifts.',
      stallProtocol: 'The 12-week structure is self-contained. If a rep max test yields lower than expected, adjust back-off set percentages down 5%. After completing the full 12 weeks, evaluate results and choose next program.',
      maxStallCycles: 1,
    },
    deload: {
      frequency: 'Built into the periodization (volume naturally tapers in weeks 7-12)',
      method: 'Auto-taper: as RM target drops to 2RM/1RM, back-off volume decreases. Take 1 week off after the 12-week cycle.',
      duration: 'Take 1 week off after the 12-week cycle before starting next program.',
      citation: 'Lefever C. Jacked & Tan 2.0 (swoleateveryheight.blogspot.com, 2016)',
    },
    transitionCriteria: 'Complete the 12-week cycle. Results from week 12 1RM tests inform next program selection.',
    transitionOptions: ['531_bbb', '531_fsl', 'block_periodization', 'dup', 'texas_method'],
    scienceBasis: 'J&T 2.0 implements linear periodization within a mesocycle (high reps → low reps) using a daily RM finder, which is well-supported for strength development (Rhea & Alderman 2004). The RM + back-off structure autoregulates intensity daily — your RM is your RM for that day, accounting for readiness. The tiered exercise structure provides both specificity (T1 compounds) and variety (T2/T3), addressing the repeated-bout effect while accumulating volume. The 12-week timeframe matches research on optimal mesocycle length for strength and hypertrophy gains.',
    typicalDurationWeeks: [12, 12],
    sessionMinutes: 75,
  },

  nsuns: {
    id: 'nsuns',
    name: 'nSuns 5/3/1 LP',
    shortName: 'nSuns',
    author: 'nSuns (Reddit)',
    description: 'High-volume 5/3/1 variant with weekly linear progression (~80 min sessions). Each session has a T1 lift (8-9 sets with pyramid + AMRAP) and a T2 secondary lift (8 sets with its own descending percentage scheme). AMRAP performance on the T1 "1+" set drives weekly weight increases.',
    level: 'intermediate',
    goals: ['strength', 'powerlifting'],
    daysPerWeek: [4, 5],
    equipmentMin: 'barbell_home',
    workouts: [
      {
        name: 'Day 1: Bench (T1) + OHP (T2)',
        dayLabel: 'Day 1 — Bench/OHP',
        exercises: [
          { exerciseSlot: 'bench', sets: [
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120, notes: 'T1 set 1' },
            { sets: 1, reps: '3', intensityPct: 85, restSeconds: 120, notes: 'T1 set 2' },
            { sets: 1, reps: '1+', intensityPct: 95, restSeconds: 180, notes: 'T1 AMRAP — performance here drives progression' },
            { sets: 1, reps: '3', intensityPct: 90, restSeconds: 120, notes: 'T1 set 4' },
            { sets: 1, reps: '5', intensityPct: 85, restSeconds: 120, notes: 'T1 set 5' },
            { sets: 1, reps: '3', intensityPct: 80, restSeconds: 120, notes: 'T1 set 6' },
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120, notes: 'T1 set 7' },
            { sets: 1, reps: '5+', intensityPct: 70, restSeconds: 120, notes: 'T1 set 8 — volume AMRAP' },
          ] },
          { exerciseSlot: 'ohp', sets: [
            { sets: 1, reps: '6', intensityPct: 50, restSeconds: 90, notes: 'T2 set 1 — OHP uses its own TM' },
            { sets: 1, reps: '5', intensityPct: 60, restSeconds: 90, notes: 'T2 set 2' },
            { sets: 1, reps: '3', intensityPct: 70, restSeconds: 90, notes: 'T2 set 3' },
            { sets: 1, reps: '5', intensityPct: 70, restSeconds: 90, notes: 'T2 set 4' },
            { sets: 1, reps: '7', intensityPct: 70, restSeconds: 90, notes: 'T2 set 5' },
            { sets: 1, reps: '4', intensityPct: 65, restSeconds: 90, notes: 'T2 set 6' },
            { sets: 1, reps: '6', intensityPct: 60, restSeconds: 90, notes: 'T2 set 7' },
            { sets: 1, reps: '8', intensityPct: 55, restSeconds: 90, notes: 'T2 set 8' },
          ] },
        ],
      },
      {
        name: 'Day 2: Squat (T1) + RDL (T2)',
        dayLabel: 'Day 2 — Squat',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120, notes: 'T1 set 1' },
            { sets: 1, reps: '3', intensityPct: 85, restSeconds: 120, notes: 'T1 set 2' },
            { sets: 1, reps: '1+', intensityPct: 95, restSeconds: 180, notes: 'T1 AMRAP' },
            { sets: 1, reps: '3', intensityPct: 90, restSeconds: 120, notes: 'T1 set 4' },
            { sets: 1, reps: '5', intensityPct: 85, restSeconds: 120, notes: 'T1 set 5' },
            { sets: 1, reps: '3', intensityPct: 80, restSeconds: 120, notes: 'T1 set 6' },
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120, notes: 'T1 set 7' },
            { sets: 1, reps: '5+', intensityPct: 70, restSeconds: 120, notes: 'T1 set 8 — volume AMRAP' },
          ] },
          { exerciseSlot: 'rdl', sets: [
            { sets: 1, reps: '5', intensityPct: 50, restSeconds: 90, notes: 'T2 set 1 — deadlift variant' },
            { sets: 1, reps: '5', intensityPct: 60, restSeconds: 90, notes: 'T2 set 2' },
            { sets: 1, reps: '3', intensityPct: 70, restSeconds: 90, notes: 'T2 set 3' },
            { sets: 1, reps: '5', intensityPct: 70, restSeconds: 90, notes: 'T2 set 4' },
            { sets: 1, reps: '7', intensityPct: 70, restSeconds: 90, notes: 'T2 set 5' },
            { sets: 1, reps: '4', intensityPct: 65, restSeconds: 90, notes: 'T2 set 6' },
            { sets: 1, reps: '6', intensityPct: 60, restSeconds: 90, notes: 'T2 set 7' },
            { sets: 1, reps: '8', intensityPct: 55, restSeconds: 90, notes: 'T2 set 8' },
          ] },
        ],
      },
      {
        name: 'Day 3: OHP (T1) + CG Bench (T2)',
        dayLabel: 'Day 3 — OHP',
        exercises: [
          { exerciseSlot: 'ohp', sets: [
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120, notes: 'T1 set 1' },
            { sets: 1, reps: '3', intensityPct: 85, restSeconds: 120, notes: 'T1 set 2' },
            { sets: 1, reps: '1+', intensityPct: 95, restSeconds: 180, notes: 'T1 AMRAP' },
            { sets: 1, reps: '3', intensityPct: 90, restSeconds: 120, notes: 'T1 set 4' },
            { sets: 1, reps: '5', intensityPct: 85, restSeconds: 120, notes: 'T1 set 5' },
            { sets: 1, reps: '3', intensityPct: 80, restSeconds: 120, notes: 'T1 set 6' },
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120, notes: 'T1 set 7' },
            { sets: 1, reps: '5+', intensityPct: 70, restSeconds: 120, notes: 'T1 set 8 — volume AMRAP' },
          ] },
          { exerciseSlot: 'close_grip_bench', sets: [
            { sets: 1, reps: '6', intensityPct: 50, restSeconds: 90, notes: 'T2 set 1 — bench variant (CG bench)' },
            { sets: 1, reps: '5', intensityPct: 60, restSeconds: 90, notes: 'T2 set 2' },
            { sets: 1, reps: '3', intensityPct: 70, restSeconds: 90, notes: 'T2 set 3' },
            { sets: 1, reps: '5', intensityPct: 70, restSeconds: 90, notes: 'T2 set 4' },
            { sets: 1, reps: '7', intensityPct: 70, restSeconds: 90, notes: 'T2 set 5' },
            { sets: 1, reps: '4', intensityPct: 65, restSeconds: 90, notes: 'T2 set 6' },
            { sets: 1, reps: '6', intensityPct: 60, restSeconds: 90, notes: 'T2 set 7' },
            { sets: 1, reps: '8', intensityPct: 55, restSeconds: 90, notes: 'T2 set 8' },
          ] },
        ],
      },
      {
        name: 'Day 4: Deadlift (T1) + Front Squat (T2)',
        dayLabel: 'Day 4 — Deadlift',
        exercises: [
          { exerciseSlot: 'deadlift', sets: [
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120, notes: 'T1 set 1' },
            { sets: 1, reps: '3', intensityPct: 85, restSeconds: 120, notes: 'T1 set 2' },
            { sets: 1, reps: '1+', intensityPct: 95, restSeconds: 180, notes: 'T1 AMRAP' },
            { sets: 1, reps: '3', intensityPct: 90, restSeconds: 180, notes: 'T1 set 4' },
            { sets: 1, reps: '3', intensityPct: 85, restSeconds: 120, notes: 'T1 set 5' },
            { sets: 1, reps: '3', intensityPct: 80, restSeconds: 120, notes: 'T1 set 6' },
            { sets: 1, reps: '5', intensityPct: 75, restSeconds: 120, notes: 'T1 set 7' },
            { sets: 1, reps: '5+', intensityPct: 70, restSeconds: 120, notes: 'T1 set 8 — volume AMRAP' },
          ] },
          { exerciseSlot: 'front_squat', sets: [
            { sets: 1, reps: '5', intensityPct: 40, restSeconds: 90, notes: 'T2 set 1 — squat variant' },
            { sets: 1, reps: '5', intensityPct: 50, restSeconds: 90, notes: 'T2 set 2' },
            { sets: 1, reps: '3', intensityPct: 60, restSeconds: 90, notes: 'T2 set 3' },
            { sets: 1, reps: '5', intensityPct: 60, restSeconds: 90, notes: 'T2 set 4' },
            { sets: 1, reps: '7', intensityPct: 60, restSeconds: 90, notes: 'T2 set 5' },
            { sets: 1, reps: '4', intensityPct: 55, restSeconds: 90, notes: 'T2 set 6' },
            { sets: 1, reps: '6', intensityPct: 50, restSeconds: 90, notes: 'T2 set 7' },
            { sets: 1, reps: '8', intensityPct: 45, restSeconds: 90, notes: 'T2 set 8' },
          ] },
        ],
      },
    ],
    progression: {
      type: 'amrap_driven',
      incrementLbs: { upper: 5, lower: 10 },
      description: 'Based on T1 AMRAP "1+" set performance: 0-1 reps = no increase; 2-3 reps = +5 lbs; 4-5 reps = +5-10 lbs; 5+ reps = +10-15 lbs. Progression is weekly. T1 and T2 lifts each track their own Training Max — T2 percentages are based on the T2 lift\'s TM. Each lift progresses independently.',
      stallProtocol: 'If AMRAP yields 0 reps at the prescribed weight, deload TM by 10% and rebuild. If stalling persists across 2-3 cycles, switch to a non-LP program (5/3/1 standard, block periodization).',
      maxStallCycles: 2,
    },
    deload: {
      frequency: 'Every 6-8 weeks or when AMRAP performance consistently declines',
      method: 'Reduce all TMs by 10%. Take 1 easy week with all weights at 60-70% of normal.',
      duration: '1 week',
      citation: 'nSuns (r/nSuns subreddit); derivative of Wendler J. 5/3/1 Forever (2017). Deload protocol follows PMC10948666: reactive deloads when performance markers decline. TM reduction of 10% aligns with Pritchard et al. (2015, PMID: 26200193) recommendations for programmed resets.',
    },
    transitionCriteria: 'When AMRAP-driven weekly progression stalls repeatedly despite deloads. nSuns is very high volume and aggressive; most lifters transition after 3-6 months to a more periodized program.',
    transitionOptions: ['531_bbb', '531_fsl', 'block_periodization', 'gzcl_jt2', 'dup'],
    scienceBasis: 'nSuns applies high volume (16-17 working sets per session) across T1 pyramid and T2 descending percentage schemes, providing a strong dose of both mechanical tension and metabolic stress. The T2 uses its own percentage pyramid (ascending then descending) to build volume on the secondary lift without excessive fatigue. The AMRAP-driven progression provides autoregulation (superior to fixed percentages per meta-analysis PMC12336695). The weekly LP structure allows faster progression than standard 5/3/1.',
    typicalDurationWeeks: [12, 24],
    sessionMinutes: 80,
  },

  nippard_powerbuilding: {
    id: 'nippard_powerbuilding',
    name: 'Powerbuilding Full Body 5x/Week',
    shortName: 'Powerbuilding 5x',
    author: 'Jeff Nippard (methodology)',
    description: '10-week full-body powerbuilding program (~75 min sessions). Train 5 days per week with each session built around a primary compound lift (squat, bench, or deadlift) plus targeted accessories for size. Combines the "Big 3" strength work with hypertrophy-focused isolation. Uses %1RM with RPE caps for dual autoregulation. Includes built-in semi-deload at week 5 and taper at week 9.',
    level: 'intermediate',
    goals: ['powerbuilding', 'strength', 'hypertrophy'],
    daysPerWeek: [5],
    equipmentMin: 'full_gym',
    workouts: [
      {
        name: 'Full Body 1 — Squat Focus',
        dayLabel: 'Day 1 — Squat Primary',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 1, reps: '1', intensityPct: 85, rpe: 7, restSeconds: 300, notes: 'Top single — technique and explosive power. Do NOT grind.' },
            { sets: 3, reps: '5', intensityPct: 75, rpe: 8, restSeconds: 240, notes: 'Back-off volume sets' },
          ] },
          { exerciseSlot: 'ohp', sets: [{ sets: 2, reps: '8', intensityPct: 70, rpe: 6, restSeconds: 150, notes: 'Light pressing for shoulder stability. Do not push hard — big bench day tomorrow.' }] },
          { exerciseSlot: 'good_morning', sets: [{ sets: 2, reps: '10', restSeconds: 150, notes: 'Posterior chain accessory' }] },
          { exerciseSlot: 'row', sets: [{ sets: 1, reps: '10', restSeconds: 90, notes: 'Upper back volume' }] },
        ],
      },
      {
        name: 'Full Body 2 — Bench Focus',
        dayLabel: 'Day 2 — Bench Primary',
        exercises: [
          { exerciseSlot: 'bench', sets: [
            { sets: 1, reps: '1', intensityPct: 87, rpe: 8, restSeconds: 300, notes: 'Top single — strict pause on chest. Execute perfectly.' },
            { sets: 3, reps: '3', intensityPct: 82, rpe: 8, restSeconds: 240, notes: 'Working sets — quick pause, explode up' },
          ] },
          { exerciseSlot: 'pullup', sets: [{ sets: 3, reps: '10', restSeconds: 120, notes: 'Pull volume for balance' }] },
          { exerciseSlot: 'curl', sets: [{ sets: 4, reps: '8', restSeconds: 90, notes: 'Strict form, squeeze hard' }] },
          { exerciseSlot: 'face_pull', sets: [{ sets: 3, reps: '15', restSeconds: 60, notes: 'Shoulder health and rear delts' }] },
        ],
      },
      {
        name: 'Full Body 3 — Accessories',
        dayLabel: 'Day 3 — Squat/Bench Accessories',
        exercises: [
          { exerciseSlot: 'pause_squat', sets: [{ sets: 3, reps: '8', restSeconds: 150, notes: 'Anderson/pin squat or pause squat variant' }] },
          { exerciseSlot: 'close_grip_bench', sets: [{ sets: 3, reps: '8', restSeconds: 150, notes: 'Tricep emphasis pressing' }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 4, reps: '8', restSeconds: 120 }] },
          { exerciseSlot: 'tricep_extension', sets: [{ sets: 3, reps: '10', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Full Body 4 — Deadlift Focus',
        dayLabel: 'Day 4 — Deadlift Primary',
        exercises: [
          { exerciseSlot: 'deadlift', sets: [
            { sets: 1, reps: '4', intensityPct: 85, rpe: 8, restSeconds: 300, notes: 'Heavy top set. Brace hard, pull slack, explode.' },
          ] },
          { exerciseSlot: 'rdl', sets: [{ sets: 2, reps: '8', intensityPct: 67, rpe: 7, restSeconds: 180, notes: 'Pause deadlift or touch-and-go variant for volume' }] },
          { exerciseSlot: 'face_pull', sets: [{ sets: 4, reps: '15', restSeconds: 60, notes: 'Rear delt and upper back health' }] },
          { exerciseSlot: 'curl', sets: [{ sets: 4, reps: '10', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Full Body 5 — Volume Day',
        dayLabel: 'Day 5 — Squat/Bench Volume',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 4, reps: '6', intensityPct: 72, rpe: 7, restSeconds: 240, notes: 'Moderate volume squats. Focus on bar speed and depth.' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 4, reps: '6', intensityPct: 72, rpe: 7, restSeconds: 240, notes: 'Volume bench. Perfect arch, perfect pause.' }] },
          { exerciseSlot: 'row', sets: [{ sets: 3, reps: '10', restSeconds: 120, notes: 'Helms row or cable row — stay light, mind-muscle connection' }] },
          { exerciseSlot: 'hip_thrust', sets: [{ sets: 3, reps: '12', restSeconds: 90, notes: 'Glute and hip accessory' }] },
        ],
      },
    ],
    progression: {
      type: 'percentage_wave',
      incrementLbs: { upper: 5, lower: 5 },
      description: '10-week linear periodization within the mesocycle. Weeks 1-4: Intensity increases 2.5% per week while reps decrease (5\u21924\u21924\u21922 for back-off sets). Week 5: Semi-deload (reduce RPE by 2, keep %1RM). Weeks 6-8: Second loading phase at higher intensity. Week 9: Taper (reduce volume 50%, maintain intensity). Week 10: Max testing (work to 1RM on the Big 3). Based on Nippard\'s block periodization framework (Issurin 2008; Nippard 2022).',
      stallProtocol: 'If you miss the target RPE bracket (e.g., prescribed RPE 8 but need RPE 10), reduce your training max by 5%. If this persists for 2+ weeks, evaluate recovery (sleep, nutrition, life stress) before making program changes.',
      maxStallCycles: 2,
    },
    deload: {
      frequency: 'Built-in at Week 5 (semi-deload) and Week 9 (taper)',
      method: 'Week 5: Same exercises, same %1RM, but reduce RPE by 2 (stop further from failure). Week 9: Cut volume in half, maintain top-set intensity.',
      duration: '1 week each',
      citation: 'Nippard J. Powerbuilding System (2022); Issurin V. Block Periodization (2008); PMC7552788 taper meta-analysis',
    },
    transitionCriteria: 'After the 10-week cycle, retest maxes and start a new cycle with updated 1RMs. Alternate with a hypertrophy-focused mesocycle (Powerbuilding Phase 2 style) for long-term development.',
    transitionOptions: ['531_bbb', 'block_periodization', 'dup', 'gzcl_jt2'],
    scienceBasis: 'Full-body training 5x/week distributes volume across more sessions, allowing higher weekly frequency per muscle group. Schoenfeld et al. (2015, PMID: 25932981) found training muscles 2+ times per week produces superior hypertrophy vs 1x/week. The dual autoregulation system (%1RM + RPE cap) prevents overreaching while ensuring sufficient stimulus. The top-single approach on primary lifts develops neuromuscular efficiency at high loads without excessive fatigue (Androulakis-Korakakis et al. 2020, PMC8435792). Block periodization within the 10-week mesocycle (accumulation \u2192 transmutation \u2192 peaking) follows Issurin (2008).',
    typicalDurationWeeks: [10, 10],
    sessionMinutes: 75,
  },

  upper_lower_split: {
    id: 'upper_lower_split',
    name: '4-Day Upper/Lower Split',
    shortName: 'Upper/Lower',
    author: 'Sam Krapf / Andy Baker',
    description: 'The primary intermediate template for lifters who have exhausted novice LP (~70 min sessions). 4 days per week: 2 upper body days, 2 lower body days. Heavy and light days rotate stress within each week. Simple, flexible, and sustainable — designed to be run for months or years. Based on Sam Krapf\'s (SSC) intermediate coaching framework.',
    level: 'intermediate',
    goals: ['strength', 'powerlifting', 'general'],
    daysPerWeek: [4],
    equipmentMin: 'barbell_home',
    workouts: [
      {
        name: 'Lower Heavy',
        dayLabel: 'Mon — Lower Heavy',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '5', rpe: 8.5, restSeconds: 300, notes: 'Heavy squat — top weight of the week. PR attempts here.' }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 1, reps: '5', rpe: 8.5, restSeconds: 300, notes: 'Heavy deadlift — one top set of 5' }] },
          { exerciseSlot: 'leg_press', sets: [{ sets: 3, reps: '10', restSeconds: 120, notes: 'Quad accessory — leg press or lunge' }] },
          { exerciseSlot: 'ab_work', sets: [{ sets: 3, reps: '15', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Upper Heavy',
        dayLabel: 'Tue — Upper Heavy',
        exercises: [
          { exerciseSlot: 'bench', sets: [{ sets: 3, reps: '5', rpe: 8.5, restSeconds: 300, notes: 'Heavy bench — PR attempts here' }] },
          { exerciseSlot: 'ohp', sets: [{ sets: 3, reps: '5', rpe: 7, restSeconds: 180, notes: 'Moderate pressing — alternate bench/press week to week' }] },
          { exerciseSlot: 'row', sets: [{ sets: 3, reps: '8', restSeconds: 120, notes: 'Heavy barbell rows' }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 3, reps: 'AMRAP', restSeconds: 90, notes: 'Chin-ups or lat pulldowns' }] },
          { exerciseSlot: 'curl', sets: [{ sets: 2, reps: '12', restSeconds: 60, notes: 'Arm work' }] },
        ],
      },
      {
        name: 'Lower Light',
        dayLabel: 'Thu — Lower Light',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '5', rpe: 6, restSeconds: 180, notes: 'Light squat — 80% of Monday\'s weight. Speed and technique focus.' }] },
          { exerciseSlot: 'rdl', sets: [{ sets: 3, reps: '8', restSeconds: 180, notes: 'Romanian deadlift — hamstring and glute volume' }] },
          { exerciseSlot: 'hip_thrust', sets: [{ sets: 3, reps: '10', restSeconds: 90, notes: 'Glute accessory' }] },
          { exerciseSlot: 'ab_work', sets: [{ sets: 3, reps: '15', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Upper Light',
        dayLabel: 'Fri — Upper Light',
        exercises: [
          { exerciseSlot: 'bench', sets: [{ sets: 3, reps: '8', rpe: 7, restSeconds: 180, notes: 'Volume bench — lighter than Tuesday, more reps' }] },
          { exerciseSlot: 'ohp', sets: [{ sets: 3, reps: '8', rpe: 7, restSeconds: 180, notes: 'Volume pressing' }] },
          { exerciseSlot: 'row', sets: [{ sets: 3, reps: '10', restSeconds: 120, notes: 'Light rows — mind-muscle connection' }] },
          { exerciseSlot: 'face_pull', sets: [{ sets: 3, reps: '15', restSeconds: 60, notes: 'Shoulder health' }] },
          { exerciseSlot: 'tricep_extension', sets: [{ sets: 3, reps: '12', restSeconds: 60, notes: 'Tricep isolation' }] },
        ],
      },
    ],
    progression: {
      type: 'rpe_autoregulated',
      incrementLbs: { upper: 5, lower: 5 },
      description: 'RPE-based autoregulation: Heavy days target RPE 8-9. When RPE 8 feels easy (bar speed fast, form score high), add 5 lbs next week. Light days are 80% of heavy day weight and should feel easy (RPE 6-7). This manages weekly stress by distributing intensity across the week rather than accumulating it. Per Sam Krapf (SSC): "Simple, Flexible, Sustainable." Per Andy Baker: Heavy/Light stress management is the foundation of intermediate programming.',
      stallProtocol: 'If heavy day RPE exceeds 9.5 for 2+ weeks without weight increase, take a deload week. If still stalling after deload, consider adding a 5th day or switching to a block periodization approach.',
      maxStallCycles: 3,
    },
    deload: {
      frequency: 'Every 4-6 weeks or when RPE exceeds targets for 2+ weeks',
      method: 'Reduce all weights to Light day levels for 1 week. All days at RPE 5-6.',
      duration: '1 week',
      citation: 'Baker A. (andybaker.com); Krapf S. (SSC, Ground Zero Strength, 2024 — 4-Day Upper-Lower framework); Zourdos et al. (2016, PMID: 26666744) RPE autoregulation',
    },
    transitionCriteria: 'Can be run indefinitely with modifications. If weekly PRs stall across all lifts for 3+ weeks despite deloads, consider block periodization or DUP for more advanced stress management.',
    transitionOptions: ['531_bbb', 'block_periodization', 'dup', 'nippard_powerbuilding'],
    scienceBasis: 'The upper/lower split trains each muscle group 2x/week, which Schoenfeld et al. (2016, PMID: 27102172) found produces significantly greater hypertrophy than 1x/week when volume is equated. The heavy/light structure within each week manages fatigue accumulation — heavy days drive adaptation while light days provide recovery-promoting volume without exceeding recovery capacity. Sam Krapf (SSC) uses this as his primary intermediate template with online coaching clients. Andy Baker describes it as the natural evolution from the novice HLM pattern. RPE-based autoregulation (Zourdos et al. 2016) ensures daily readiness drives load selection, which is superior to fixed percentages for intermediate lifters (meta-analysis PMC12336695).',
    typicalDurationWeeks: [16, 104],
    sessionMinutes: 70,
  },

  // ═══════════════════════════════════════════
  // ADVANCED PROGRAMS
  // ═══════════════════════════════════════════

  block_periodization: {
    id: 'block_periodization',
    name: 'Block Periodization',
    shortName: 'Block',
    author: 'Various (Issurin, Verkoshansky, adapted by JTS/Helms)',
    description: 'Training divided into sequential mesocycles (blocks), each with a specific physiological target (~75 min sessions). Hypertrophy → Strength → Peaking. 12-16 weeks total. Best for competition preparation.',
    level: 'advanced',
    goals: ['powerlifting', 'strength'],
    daysPerWeek: [3, 4, 5],
    equipmentMin: 'barbell_home',
    workouts: [
      // Hypertrophy Block
      {
        name: 'Hypertrophy Block — Day A',
        dayLabel: 'Hyp: Squat + Bench',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 4, reps: '8-10', intensityPct: 65, rpe: 7, restSeconds: 120, notes: 'Hypertrophy block: high reps, moderate weight, focus on time under tension' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 4, reps: '8-10', intensityPct: 65, rpe: 7, restSeconds: 120 }] },
          { exerciseSlot: 'row', sets: [{ sets: 4, reps: '10-12', restSeconds: 90 }] },
          { exerciseSlot: 'leg_press', sets: [{ sets: 3, reps: '12-15', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Hypertrophy Block — Day B',
        dayLabel: 'Hyp: Deadlift + OHP',
        exercises: [
          { exerciseSlot: 'deadlift', sets: [{ sets: 3, reps: '8-10', intensityPct: 65, rpe: 7, restSeconds: 120 }] },
          { exerciseSlot: 'ohp', sets: [{ sets: 4, reps: '8-10', intensityPct: 65, rpe: 7, restSeconds: 120 }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 4, reps: '10-12', restSeconds: 90 }] },
          { exerciseSlot: 'hip_thrust', sets: [{ sets: 3, reps: '12-15', restSeconds: 60 }] },
        ],
      },
      // Strength Block
      {
        name: 'Strength Block — Day A',
        dayLabel: 'Str: Squat + Bench',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 4, reps: '4-6', intensityPct: 78, rpe: 8, restSeconds: 240, notes: 'Strength block: heavier loads, lower reps, focus on force production' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 4, reps: '4-6', intensityPct: 78, rpe: 8, restSeconds: 240 }] },
          { exerciseSlot: 'pause_squat', sets: [{ sets: 3, reps: '3-5', restSeconds: 180, notes: 'Pause work for competition prep' }] },
        ],
      },
      {
        name: 'Strength Block — Day B',
        dayLabel: 'Str: Deadlift + OHP',
        exercises: [
          { exerciseSlot: 'deadlift', sets: [{ sets: 3, reps: '3-5', intensityPct: 80, rpe: 8, restSeconds: 300 }] },
          { exerciseSlot: 'ohp', sets: [{ sets: 4, reps: '4-6', intensityPct: 78, rpe: 8, restSeconds: 240 }] },
          { exerciseSlot: 'deficit_deadlift', sets: [{ sets: 3, reps: '3-5', restSeconds: 180, notes: 'Weak point accessory' }] },
        ],
      },
      // Peaking Block
      {
        name: 'Peaking Block — Day A',
        dayLabel: 'Peak: Squat + Bench',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '1-3', intensityPct: 88, rpe: 9, restSeconds: 360, notes: 'Peaking block: near-max singles/doubles, full rest, competition prep' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 3, reps: '1-3', intensityPct: 88, rpe: 9, restSeconds: 360 }] },
        ],
      },
      {
        name: 'Peaking Block — Day B',
        dayLabel: 'Peak: Deadlift',
        exercises: [
          { exerciseSlot: 'deadlift', sets: [{ sets: 2, reps: '1-3', intensityPct: 90, rpe: 9, restSeconds: 360 }] },
          { exerciseSlot: 'spoto_press', sets: [{ sets: 3, reps: '3', restSeconds: 180, notes: 'Light technique work' }] },
        ],
      },
    ],
    progression: {
      type: 'block',
      incrementLbs: { upper: 5, lower: 5 },
      description: 'Hypertrophy block (4-6 weeks): Increase weight 2-5% per week at same reps. Strength block (4-6 weeks): Increase weight or reduce reps weekly. Peaking block (2-4 weeks): Volume tapers 30-50%, intensity stays high or increases. Each block builds on the previous — hypertrophy builds muscle, strength increases neural drive, peaking realizes maximal performance.',
      stallProtocol: 'If a block\'s target is not met (e.g., hypertrophy block shows no rep improvements), extend the block 1-2 weeks. If still stalling, reassess recovery (sleep, nutrition, life stress). After a complete macrocycle, adjust block durations and intensity ranges based on results.',
      maxStallCycles: 1,
    },
    deload: {
      frequency: 'Between blocks (bridge weeks) and during peaking taper',
      method: 'Bridge week: 50% volume, 80% intensity. Peaking taper: gradual volume reduction (30-50%) over 1-2 weeks before competition. (PMC7552788: 2-5% performance improvement from optimal taper)',
      duration: '1 week between blocks; 1-2 weeks for competition taper',
      citation: 'Issurin V. Block Periodization (2008); EliteFTS practical guide; PMC7552788 taper meta-analysis',
    },
    transitionCriteria: 'Run as a complete 12-16 week macrocycle. After competition, restart with a hypertrophy block using updated maxes. Adjust block durations based on what worked.',
    transitionOptions: ['block_periodization', 'dup', 'conjugate'],
    scienceBasis: 'Block periodization concentrates training on one primary quality per mesocycle, maximizing the dose-response for that quality while allowing other qualities to be maintained with minimal work. Research by Issurin (2008) shows this approach is superior to traditional (concurrent) periodization for trained athletes. The sequential development of hypertrophy → strength → peaking follows the biological principle of directed adaptation and has produced the majority of modern powerlifting world records.',
    typicalDurationWeeks: [12, 20],
    sessionMinutes: 75,
    weeklyWaves: {
      // Block 0: Hypertrophy (workouts 0-1)
      0: {
        1: { intensityPct: 63, repTarget: '4x10', volumeMultiplier: 1.0 },
        2: { intensityPct: 65, repTarget: '4x8', volumeMultiplier: 1.0 },
        3: { intensityPct: 68, repTarget: '4x8', volumeMultiplier: 1.0 },
        4: { intensityPct: 58, repTarget: '3x10', volumeMultiplier: 0.6 },
      },
      // Block 1: Strength (workouts 2-3)
      1: {
        1: { intensityPct: 75, repTarget: '4x5', volumeMultiplier: 1.0 },
        2: { intensityPct: 78, repTarget: '4x4', volumeMultiplier: 1.0 },
        3: { intensityPct: 82, repTarget: '3x3', volumeMultiplier: 0.85 },
        4: { intensityPct: 70, repTarget: '3x5', volumeMultiplier: 0.6 },
      },
      // Block 2: Peaking (workouts 4-5)
      2: {
        1: { intensityPct: 85, repTarget: '3x3', volumeMultiplier: 1.0 },
        2: { intensityPct: 88, repTarget: '3x2', volumeMultiplier: 0.85 },
        3: { intensityPct: 90, repTarget: '2x2', volumeMultiplier: 0.7 },
        4: { intensityPct: 78, repTarget: '2x3', volumeMultiplier: 0.5 },
      },
    },
  },

  dup: {
    id: 'dup',
    name: 'Daily Undulating Periodization',
    shortName: 'DUP',
    author: 'Various (Rhea et al. 2002; Zourdos et al. 2016)',
    description: 'Varies intensity and volume every training session (~80 min sessions). Each day targets a different stimulus (power/strength/hypertrophy). Research shows superior strength gains vs linear periodization in both trained and untrained populations.',
    level: 'advanced',
    goals: ['strength', 'powerlifting', 'powerbuilding'],
    daysPerWeek: [3, 4, 5],
    equipmentMin: 'barbell_home',
    workouts: [
      {
        name: 'Strength Day',
        dayLabel: 'Day 1 — Strength',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 5, reps: '3-5', intensityPct: 82, rpe: 8, restSeconds: 300, notes: 'Heavy day: focus on force production' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 5, reps: '3-5', intensityPct: 82, rpe: 8, restSeconds: 300 }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 3, reps: '3-5', intensityPct: 82, rpe: 8, restSeconds: 300, notes: 'Heavy deadlift' }] },
          { exerciseSlot: 'row', sets: [{ sets: 3, reps: '6-8', restSeconds: 120 }] },
        ],
      },
      {
        name: 'Hypertrophy Day',
        dayLabel: 'Day 2 — Hypertrophy',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 4, reps: '8-12', intensityPct: 68, rpe: 7, restSeconds: 120, notes: 'Volume day: accumulate reps' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 4, reps: '8-12', intensityPct: 68, rpe: 7, restSeconds: 120 }] },
          { exerciseSlot: 'rdl', sets: [{ sets: 3, reps: '8-10', intensityPct: 65, rpe: 7, restSeconds: 120, notes: 'Deadlift volume (RDL variant)' }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 4, reps: '10-12', restSeconds: 90 }] },
          { exerciseSlot: 'face_pull', sets: [{ sets: 3, reps: '20', restSeconds: 45 }] },
        ],
      },
      {
        name: 'Power/Technique Day',
        dayLabel: 'Day 3 — Power',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 6, reps: '2-3', intensityPct: 75, rpe: 7, restSeconds: 180, notes: 'Moderate weight, maximum bar speed. Focus on explosive concentric.' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 6, reps: '2-3', intensityPct: 75, rpe: 7, restSeconds: 180 }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 4, reps: '3-5', intensityPct: 78, rpe: 8, restSeconds: 300 }] },
        ],
      },
    ],
    progression: {
      type: 'rpe_autoregulated',
      incrementLbs: { upper: 5, lower: 5 },
      description: 'RPE-driven (per Zourdos et al. 2016, PMID: 26666744; Helms et al. 2016: RIR-based autoregulation): When target RPE feels easy (form score high, bar speed fast), increase weight next week by 2-5 lbs. Each day type progresses independently. Weekly total volume should increase by ~5-10% across a mesocycle before deloading.',
      stallProtocol: 'If strength day RPE exceeds 9.5 for 2+ weeks without weight increase, deload. If progress stalls after 2 deload cycles, adjust the day structure (add a 4th day, change rep ranges, or swap exercises).',
      maxStallCycles: 2,
    },
    deload: {
      frequency: 'Every 4-6 weeks',
      method: 'Reduce volume 40-50%, keep intensity at 80%. All days at RPE 6-7.',
      duration: '1 week',
      citation: 'Rhea et al. (2002, PMID: 11991778): DUP produced 28.8% strength increase vs 14.4% for LP; Zourdos et al. (2016, PMID: 26332783): Modified HPS DUP configuration; PMC10948666: deload practices in resistance-trained individuals',
    },
    transitionCriteria: 'DUP can be run indefinitely. Transition to block periodization when preparing for a specific competition date that requires a defined peaking phase.',
    transitionOptions: ['block_periodization', 'conjugate', '531_bbb'],
    scienceBasis: 'Rhea et al. (2002, PMID: 11991778) found DUP produced nearly double the 1RM improvement vs linear periodization over 12 weeks when total volume was equated. Note: the 28.8% vs 14.4% finding (Rhea et al. 2002) was in untrained subjects. For trained powerlifters, Zourdos et al. (2016, PMID: 26332783) confirmed DUP\'s superiority with more modest but significant gains. A modified HPS (Hypertrophy-Power-Strength) configuration showed enhanced squat (+15-18 kg), bench (+6.5-8.8 kg), and deadlift (+13.6-14.8 kg) gains in 9 weeks in trained powerlifters (Zourdos et al. 2016, PMID: 26332783). The daily variation prevents accommodation while providing frequent practice of the competition lifts.',
    typicalDurationWeeks: [8, 52],
    sessionMinutes: 80,
  },

  conjugate: {
    id: 'conjugate',
    name: 'Conjugate / Westside Method',
    shortName: 'Conjugate',
    author: 'Louie Simmons / Westside Barbell',
    description: 'Two upper and two lower days per week (~90 min sessions). Max Effort days work to a 1-3RM on a variation (rotated weekly). Dynamic Effort days use submaximal weights at maximum speed. Exercise variation prevents accommodation.',
    level: 'advanced',
    goals: ['strength', 'powerlifting'],
    daysPerWeek: [4],
    equipmentMin: 'full_gym',
    workouts: [
      {
        name: 'Max Effort Lower',
        dayLabel: 'Monday — ME Lower',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 1, reps: '1-3', rpe: 10, restSeconds: 300, notes: 'Work up to a 1-3RM on a squat or deadlift VARIATION. Rotate the exercise every 1-3 weeks (e.g., box squat, front squat, SSB squat, deficit deadlift, block pull).' }] },
          { exerciseSlot: 'rdl', sets: [{ sets: 4, reps: '8-12', restSeconds: 90, notes: 'Accessory: target weak points' }] },
          { exerciseSlot: 'hip_thrust', sets: [{ sets: 4, reps: '10-15', restSeconds: 60, notes: 'Repeated effort work' }] },
          { exerciseSlot: 'ab_work', sets: [{ sets: 3, reps: '15-20', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Max Effort Upper',
        dayLabel: 'Wednesday — ME Upper',
        exercises: [
          { exerciseSlot: 'bench', sets: [{ sets: 1, reps: '1-3', rpe: 10, restSeconds: 300, notes: 'Work up to a 1-3RM on a bench VARIATION (close-grip, floor press, board press, incline). Rotate weekly.' }] },
          { exerciseSlot: 'close_grip_bench', sets: [{ sets: 4, reps: '8-12', restSeconds: 90, notes: 'Accessory for lockout/triceps' }] },
          { exerciseSlot: 'row', sets: [{ sets: 4, reps: '10-15', restSeconds: 90, notes: 'Heavy rows for back mass' }] },
          { exerciseSlot: 'face_pull', sets: [{ sets: 3, reps: '20', restSeconds: 45 }] },
        ],
      },
      {
        name: 'Dynamic Effort Lower',
        dayLabel: 'Friday — DE Lower',
        exercises: [
          { exerciseSlot: 'box_squat', sets: [{ sets: 12, reps: '2', intensityPct: 55, restSeconds: 60, notes: 'Dynamic effort: 50-60% 1RM + bands/chains if available. Maximum bar speed on every rep. Sets should be fast and crisp.' }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 8, reps: '1', intensityPct: 60, restSeconds: 60, notes: 'Speed pulls: fast singles at 60-70%' }] },
          { exerciseSlot: 'good_morning', sets: [{ sets: 4, reps: '8-12', restSeconds: 90, notes: 'Posterior chain work' }] },
          { exerciseSlot: 'leg_press', sets: [{ sets: 3, reps: '15', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Dynamic Effort Upper',
        dayLabel: 'Saturday — DE Upper',
        exercises: [
          { exerciseSlot: 'bench', sets: [{ sets: 9, reps: '3', intensityPct: 55, restSeconds: 60, notes: 'Speed bench: 50-60% + bands/chains. Maximum velocity. Switch grips every 3 sets (close/medium/wide).' }] },
          { exerciseSlot: 'ohp', sets: [{ sets: 4, reps: '8-10', restSeconds: 90, notes: 'Overhead volume' }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 4, reps: '10-12', restSeconds: 90 }] },
          { exerciseSlot: 'tricep_extension', sets: [{ sets: 4, reps: '12-15', restSeconds: 60, notes: 'Tricep volume for lockout strength' }] },
        ],
      },
    ],
    progression: {
      type: 'rpe_autoregulated',
      incrementLbs: { upper: 5, lower: 5 },
      description: 'ME days: Attempt to exceed your previous record on the same variation. Since variations rotate, you\'re setting PRs on different movements. Track PRs by variation. DE days: Add 5% to bar weight every 3 weeks within a 3-week wave, then reset. Bands/chains: maintain or increase over cycles. ME day load selection is effectively RPE-based (Zourdos et al. 2016, PMID: 26666744; Helms et al. 2016), working to daily maxes based on readiness.',
      stallProtocol: 'Rotate exercise variations. If ME day PRs stall on all variations, deload for 1 week. Assess weak points from form analysis and choose variations that target those weak points.',
      maxStallCycles: 2,
    },
    deload: {
      frequency: 'Every 4th week',
      method: 'ME days: work to 90% of recent max (no true max). DE days: reduce speed sets to 6-8 (from 10-12). Accessories cut in half.',
      duration: '1 week',
      citation: 'Simmons L. Westside Barbell Book of Methods (2007); Baker A. Guide to Conjugate Training (andybaker.com)',
    },
    transitionCriteria: 'Conjugate can be run indefinitely — it\'s a training philosophy more than a fixed program. If you want to focus on competition peaking, transition to block periodization 8-12 weeks before a meet.',
    transitionOptions: ['block_periodization', 'dup'],
    scienceBasis: 'The conjugate method trains three strength qualities simultaneously: maximal strength (ME), speed-strength (DE), and muscle endurance (repeated effort accessories). Exercise rotation prevents accommodation — the principle that the body adapts to a repeated stimulus (Zatsiorsky & Kraemer 2006, Science and Practice of Strength Training). The DE method develops rate of force development (Suchomel et al. 2018, PMID: 29401195: force-velocity training for sport performance). Simmons L. (Westside Barbell Book of Methods 2007) reports this system has produced over 100 all-time world records at Westside Barbell. Mangine et al. (2015, PMID: 26403469) confirmed that combining heavy and explosive training produces superior strength and power outcomes.',
    typicalDurationWeeks: [12, 104],
    sessionMinutes: 90,
  },

  essentials_45min: {
    id: 'essentials_45min',
    name: 'Essentials 45-Min Upper/Lower',
    shortName: 'Essentials 45min',
    author: 'Jeff Nippard (methodology)',
    description: 'Time-efficient 45-50 minute workouts, 4 days per week. Uses 1-2 hard working sets per exercise instead of 3-4 easy ones — maximum intensity, minimum fluff. Supersets isolation exercises to save time. Perfect for busy lifters who want results without living in the gym. "Beat the logbook" each week by adding weight or reps.',
    level: 'intermediate',
    goals: ['hypertrophy', 'powerbuilding', 'general'],
    daysPerWeek: [4],
    equipmentMin: 'full_gym',
    workouts: [
      {
        name: 'Upper 1 — Press Focus',
        dayLabel: 'Upper 1 — Press Focus (45 min)',
        exercises: [
          { exerciseSlot: 'bench', sets: [
            { sets: 1, reps: '4-6', rpe: 8.5, restSeconds: 180, notes: 'Heavy set — focus on strength. Add weight or reps each week.' },
            { sets: 1, reps: '8-10', rpe: 9, restSeconds: 180, notes: 'Back-off set — drop weight, focus on mind-muscle connection with pecs' },
          ] },
          { exerciseSlot: 'pullup', sets: [{ sets: 2, reps: '10-12', rpe: 9, restSeconds: 120, notes: 'Lat pulldown or pull-up. Wide overhand first set, narrow underhand second set.' }] },
          { exerciseSlot: 'ohp', sets: [{ sets: 2, reps: '10-12', rpe: 9, restSeconds: 120, notes: 'Seated DB shoulder press. Full ROM, all the way down.' }] },
          { exerciseSlot: 'row', sets: [{ sets: 2, reps: '10-12', rpe: 9, restSeconds: 120, notes: 'Seated cable row — squeeze shoulder blades. Last set: dropset (do 10-12, drop 50%, do 10-12 more)' }] },
          { exerciseSlot: 'tricep_extension', sets: [{ sets: 2, reps: '12-15', rpe: 10, restSeconds: 10, notes: 'A1: Superset with curls — go straight to curls with no real rest. Go to true failure.' }] },
          { exerciseSlot: 'curl', sets: [{ sets: 2, reps: '12-15', rpe: 10, restSeconds: 90, notes: 'A2: Superset with triceps. Squeeze hard. Rest 90s then repeat.' }] },
        ],
      },
      {
        name: 'Lower 1 — Squat Focus',
        dayLabel: 'Lower 1 — Squat Focus (45 min)',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 1, reps: '4-6', rpe: 8.5, restSeconds: 180, notes: 'Heavy set — focus on strength. Add weight or reps each week.' },
            { sets: 1, reps: '8-10', rpe: 9, restSeconds: 180, notes: 'Back-off set — control the negative, full depth' },
          ] },
          { exerciseSlot: 'rdl', sets: [{ sets: 1, reps: '10-12', rpe: 9, restSeconds: 90, notes: 'Hamstring focus. Last set: dropset (do 10-12, drop 50%, do 10-12 more)' }] },
          { exerciseSlot: 'leg_press', sets: [{ sets: 2, reps: '10-12', rpe: 10, restSeconds: 10, notes: 'A1: Superset with calf raises — go straight to next exercise. Push to true failure on last set.' }] },
          { exerciseSlot: 'ab_work', sets: [{ sets: 2, reps: '10-12', rpe: 9, restSeconds: 90, notes: 'A2: Hanging leg raise or cable crunch. Controlled reps.' }] },
        ],
      },
      {
        name: 'Upper 2 — Row Focus',
        dayLabel: 'Upper 2 — Row Focus (45 min)',
        exercises: [
          { exerciseSlot: 'row', sets: [{ sets: 2, reps: '8-10', rpe: 9, restSeconds: 120, notes: 'Pendlay row or T-bar row. Squeeze shoulder blades, initiate from back not arms.' }] },
          { exerciseSlot: 'ohp', sets: [{ sets: 2, reps: '10-12', rpe: 9, restSeconds: 120, notes: 'Machine shoulder press — constant tension, no lockout at top' }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 2, reps: '8-10', rpe: 9, restSeconds: 120, notes: 'Weighted pull-up or lat pulldown. Pull elbows down and in.' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 2, reps: '10-12', rpe: 9, restSeconds: 120, notes: 'Cable chest press or DB press — squeeze chest. Last set: dropset' }] },
          { exerciseSlot: 'curl', sets: [{ sets: 2, reps: '12-15', rpe: 10, restSeconds: 10, notes: 'A1: Bayesian cable curl or incline DB curl. Superset with triceps — go straight to next exercise.' }] },
          { exerciseSlot: 'tricep_extension', sets: [{ sets: 2, reps: '12-15', rpe: 10, restSeconds: 90, notes: 'A2: Tricep pressdown. Focus on squeeze. Rest 90s then repeat.' }] },
        ],
      },
      {
        name: 'Lower 2 — Deadlift Focus',
        dayLabel: 'Lower 2 — Deadlift Focus (45 min)',
        exercises: [
          { exerciseSlot: 'deadlift', sets: [{ sets: 2, reps: '10-12', rpe: 8.5, restSeconds: 120, notes: 'Romanian deadlift or conventional — neutral spine, hip hinge. Moderate weight, good form.' }] },
          { exerciseSlot: 'leg_press', sets: [{ sets: 3, reps: '10-12', rpe: 8.5, restSeconds: 120, notes: 'Leg press — medium width feet. Don\'t let lower back round at bottom.' }] },
          { exerciseSlot: 'rdl', sets: [{ sets: 1, reps: '10-12', rpe: 9, restSeconds: 90, notes: 'Leg extension or leg curl — single exercise, dropset on last set' }] },
          { exerciseSlot: 'ab_work', sets: [{ sets: 2, reps: '12-15', rpe: 10, restSeconds: 10, notes: 'A1: Seated calf raise. Superset with core work — go straight to next exercise.' }] },
          { exerciseSlot: 'hip_thrust', sets: [{ sets: 2, reps: '12-15', rpe: 10, restSeconds: 90, notes: 'A2: Cable crunch or hanging leg raise. Rest 90s then repeat.' }] },
        ],
      },
    ],
    progression: {
      type: 'rpe_autoregulated',
      incrementLbs: { upper: 5, lower: 5 },
      description: '"Beat the logbook" progression: Each week, aim to add weight OR reps to every exercise. With only 1-2 working sets, every set must count — take sets close to failure (RPE 8-10). When you hit the top of the rep range for all sets (e.g., 2 sets of 12), increase weight next week and aim for the bottom of the range (e.g., 2 sets of 10). Per Nippard: "The reduction in set quantity creates the opportunity to focus on the quality of every set you perform."',
      stallProtocol: 'If you cannot add weight or reps for 2+ weeks on an exercise, swap it for a substitution exercise and start fresh. Exercise variation every 4 weeks helps avoid accommodation.',
      maxStallCycles: 2,
    },
    deload: {
      frequency: 'Every 4-6 weeks, or when RPE consistently hits 10 on most exercises',
      method: 'Reduce RPE to 6-7 for 1 week (same exercises, same reps, leave 3-4 reps in reserve). Do NOT skip sessions — light training promotes recovery better than complete rest.',
      duration: '1 week',
      citation: 'Nippard J. The Essentials Program (2023); Schoenfeld et al. (2017, PMID: 28834797): even 1-4 sets/week per muscle group stimulates measurable hypertrophy; Androulakis-Korakakis et al. (2020, PMC8435792): minimum effective dose for strength',
    },
    transitionCriteria: 'Run for 12 weeks (three 4-week blocks). After 12 weeks, either repeat with updated weights or transition to a higher-volume program for a growth phase.',
    transitionOptions: ['531_bbb', 'upper_lower_split', 'nippard_powerbuilding', 'gzcl_jt2'],
    scienceBasis: 'Low volume, high intensity training has strong evidence for both beginners and experienced lifters. Schoenfeld et al. (2017, PMID: 28834797) found that even 1-4 sets per muscle group per week is sufficient for measurable hypertrophy. Two 2019 meta-analyses found trained lifters can make significant strength gains with just 1 set taken to failure 2-3x/week per exercise. The key is proximity to failure — with fewer sets, each set must be maximally stimulating (RPE 9-10). Supersets of antagonist muscle groups (e.g., triceps + biceps) save time without compromising performance, as fatigue from one exercise does not interfere with the opposing muscle group (Robbins et al. 2010, PMID: 20300020). This program fits under 45 minutes by using 1-2 working sets, short rest periods (60-120s for isolation), and superset pairing.',
    typicalDurationWeeks: [12, 24],
    sessionMinutes: 50,
  },

  // ═══════════════════════════════════════════
  // SHEIKO COMPETITION PREP PROGRAMS
  // ═══════════════════════════════════════════

  sheiko_29: {
    id: 'sheiko_29',
    name: 'Sheiko #29 (Prep Cycle 1)',
    shortName: 'Sheiko #29',
    author: 'Boris Sheiko',
    description: 'High-volume, high-specificity competition prep program (~90 min sessions). Prep Cycle 1: moderate-heavy weights (70-85% of competition max) with high frequency of SBD — each competition lift trained 2-3x/week. Each session includes 2-3 competition lifts with 3-6 sets of 2-5 reps. Accessories include good mornings, dips, flys, and back work.',
    level: 'advanced',
    goals: ['powerlifting', 'strength'],
    daysPerWeek: [3, 4],
    equipmentMin: 'full_gym',
    workouts: [
      {
        name: 'Day 1: Squat + Bench',
        dayLabel: 'Day 1 — Squat / Bench',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 1, reps: '5', intensityPct: 70, restSeconds: 180, notes: 'Competition squat — focus on competition commands' },
            { sets: 1, reps: '4', intensityPct: 75, restSeconds: 180 },
            { sets: 2, reps: '3', intensityPct: 80, restSeconds: 240 },
            { sets: 1, reps: '3', intensityPct: 75, restSeconds: 180 },
          ] },
          { exerciseSlot: 'bench', sets: [
            { sets: 1, reps: '5', intensityPct: 70, restSeconds: 180, notes: 'Competition bench — pause on chest' },
            { sets: 1, reps: '4', intensityPct: 75, restSeconds: 180 },
            { sets: 2, reps: '3', intensityPct: 80, restSeconds: 240 },
            { sets: 2, reps: '3', intensityPct: 75, restSeconds: 180 },
          ] },
          { exerciseSlot: 'good_morning', sets: [{ sets: 4, reps: '5', restSeconds: 120, notes: 'Posterior chain accessory' }] },
          { exerciseSlot: 'ab_work', sets: [{ sets: 3, reps: '10', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Day 2: Deadlift + Bench',
        dayLabel: 'Day 2 — Deadlift / Bench',
        exercises: [
          { exerciseSlot: 'deadlift', sets: [
            { sets: 1, reps: '5', intensityPct: 70, restSeconds: 180, notes: 'Competition deadlift — full setup each rep' },
            { sets: 1, reps: '4', intensityPct: 75, restSeconds: 240 },
            { sets: 2, reps: '3', intensityPct: 80, restSeconds: 300 },
            { sets: 1, reps: '3', intensityPct: 75, restSeconds: 180 },
          ] },
          { exerciseSlot: 'bench', sets: [
            { sets: 1, reps: '5', intensityPct: 70, restSeconds: 120 },
            { sets: 3, reps: '4', intensityPct: 75, restSeconds: 180 },
          ] },
          { exerciseSlot: 'dip', sets: [{ sets: 3, reps: '6', restSeconds: 90, notes: 'Weighted dips for lockout strength' }] },
          { exerciseSlot: 'row', sets: [{ sets: 4, reps: '8', restSeconds: 90, notes: 'Back volume' }] },
        ],
      },
      {
        name: 'Day 3: Squat + Bench Light',
        dayLabel: 'Day 3 — Squat / Bench (Light)',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 1, reps: '5', intensityPct: 70, restSeconds: 180, notes: 'Technique squats — moderate weight' },
            { sets: 3, reps: '4', intensityPct: 75, restSeconds: 180 },
            { sets: 1, reps: '3', intensityPct: 80, restSeconds: 240 },
          ] },
          { exerciseSlot: 'bench', sets: [
            { sets: 1, reps: '5', intensityPct: 70, restSeconds: 120 },
            { sets: 2, reps: '4', intensityPct: 75, restSeconds: 180 },
            { sets: 1, reps: '3', intensityPct: 80, restSeconds: 240 },
          ] },
          { exerciseSlot: 'chest_fly', sets: [{ sets: 3, reps: '10', restSeconds: 60, notes: 'Pec accessory' }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 3, reps: '8', restSeconds: 90 }] },
        ],
      },
    ],
    progression: {
      type: 'block',
      incrementLbs: { upper: 5, lower: 5 },
      description: 'Sheiko programs use fixed percentages based on your competition max (not a training max). Percentages are prescribed per session across the 4-week cycle. Volume undulates within each week (heavier and lighter days alternate). Progression comes from completing the full 4-week cycle and then moving to the next cycle (#31) with updated maxes.',
      stallProtocol: 'If prescribed weights feel too heavy (RPE consistently above 9 on sets that should be moderate), reduce your competition max estimate by 5%. If too easy, increase by 2.5%. The percentages are precisely calibrated — trust the process.',
      maxStallCycles: 1,
    },
    deload: {
      frequency: 'Built into the undulating weekly structure (lighter sessions alternate with heavier ones)',
      method: 'The program self-regulates volume through session variation. Between cycles (#29 → #31), take 3-5 rest days.',
      duration: '3-5 days between cycles',
      citation: 'Sheiko B. Powerlifting: A Guide for Coaches and Athletes (2018); Verkhoshansky Y. & Siff M. Supertraining (2009) — conjugate-sequence periodization for advanced athletes',
    },
    transitionCriteria: 'After completing #29, proceed directly to #31 (Competition Cycle) for peaking. Can repeat #29 if not preparing for a competition.',
    transitionOptions: ['sheiko_31', 'block_periodization', 'dup'],
    scienceBasis: 'Sheiko programs use high-frequency, moderate-intensity training to accumulate enormous volumes of competition lift practice. The approach is rooted in Soviet sport science: Verkhoshansky\'s principle of concentrated loading and delayed training effect. Each session practices 2-3 competition lifts to develop movement efficiency through repetition. The 70-85% intensity range provides high mechanical tension without excessive neural fatigue. Sheiko\'s methodology has produced multiple IPF world champions and is the standard for Russian competitive powerlifting (Sheiko 2018).',
    typicalDurationWeeks: [4, 4],
    sessionMinutes: 90,
    weeklyWaves: {
      // Sheiko #29 is a single 4-week prep block — sub-maximal wave loading
      0: {
        1: { intensityPct: 72, repTarget: '5x3-5', volumeMultiplier: 1.0 },
        2: { intensityPct: 76, repTarget: '5x3-4', volumeMultiplier: 1.0 },
        3: { intensityPct: 80, repTarget: '4x2-3', volumeMultiplier: 0.9 },
        4: { intensityPct: 74, repTarget: '4x3-4', volumeMultiplier: 0.7 },
      },
    },
  },

  sheiko_31: {
    id: 'sheiko_31',
    name: 'Sheiko #31 (Competition Cycle)',
    shortName: 'Sheiko #31',
    author: 'Boris Sheiko',
    description: 'Competition peaking program (~85 min sessions). Intensity increases and volume decreases across 4 weeks: Week 1 at 75-80%, Week 2 at 80-85%, Week 3 at 85-90%, Week 4 is deload/meet week with planned openers. Designed to follow #29 prep cycle. Peaks you for a 1RM performance on meet day.',
    level: 'advanced',
    goals: ['powerlifting', 'strength'],
    daysPerWeek: [3, 4],
    equipmentMin: 'full_gym',
    workouts: [
      {
        name: 'Day 1: Squat + Bench (Heavy)',
        dayLabel: 'Day 1 — Squat / Bench',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 1, reps: '4', intensityPct: 75, restSeconds: 180, notes: 'Competition squat — Wk1: 75-80%, Wk2: 80-85%, Wk3: 85-90%, Wk4: openers' },
            { sets: 2, reps: '3', intensityPct: 80, restSeconds: 240 },
            { sets: 2, reps: '2', intensityPct: 85, restSeconds: 300 },
          ] },
          { exerciseSlot: 'bench', sets: [
            { sets: 1, reps: '4', intensityPct: 75, restSeconds: 180, notes: 'Competition bench — match squat\'s weekly intensity progression' },
            { sets: 2, reps: '3', intensityPct: 80, restSeconds: 240 },
            { sets: 2, reps: '2', intensityPct: 85, restSeconds: 300 },
          ] },
          { exerciseSlot: 'good_morning', sets: [{ sets: 3, reps: '5', restSeconds: 120, notes: 'Light posterior chain — reduce across weeks' }] },
        ],
      },
      {
        name: 'Day 2: Deadlift + Bench',
        dayLabel: 'Day 2 — Deadlift / Bench',
        exercises: [
          { exerciseSlot: 'deadlift', sets: [
            { sets: 1, reps: '4', intensityPct: 75, restSeconds: 240, notes: 'Competition deadlift — intensity increases weekly' },
            { sets: 2, reps: '3', intensityPct: 80, restSeconds: 300 },
            { sets: 1, reps: '2', intensityPct: 85, restSeconds: 300 },
          ] },
          { exerciseSlot: 'bench', sets: [
            { sets: 1, reps: '4', intensityPct: 75, restSeconds: 180 },
            { sets: 2, reps: '3', intensityPct: 80, restSeconds: 180 },
          ] },
          { exerciseSlot: 'row', sets: [{ sets: 3, reps: '6', restSeconds: 90, notes: 'Light back work — maintain only' }] },
        ],
      },
      {
        name: 'Day 3: Squat + Bench (Moderate)',
        dayLabel: 'Day 3 — Squat / Bench (Moderate)',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 1, reps: '4', intensityPct: 70, restSeconds: 180, notes: 'Moderate practice — lower intensity than Day 1' },
            { sets: 2, reps: '3', intensityPct: 75, restSeconds: 180 },
            { sets: 1, reps: '2', intensityPct: 80, restSeconds: 240 },
          ] },
          { exerciseSlot: 'bench', sets: [
            { sets: 1, reps: '4', intensityPct: 70, restSeconds: 120 },
            { sets: 2, reps: '3', intensityPct: 75, restSeconds: 180 },
            { sets: 1, reps: '2', intensityPct: 80, restSeconds: 240 },
          ] },
          { exerciseSlot: 'dip', sets: [{ sets: 2, reps: '6', restSeconds: 90, notes: 'Light accessory — reduce in weeks 3-4' }] },
        ],
      },
    ],
    progression: {
      type: 'block',
      incrementLbs: { upper: 5, lower: 5 },
      description: 'Prescribed percentages increase across the 4-week cycle: Week 1 at 75-80%, Week 2 at 80-85%, Week 3 at 85-90%, Week 4 (meet week) at opener weight only. Volume tapers: Week 1 has the most sets, Week 4 the least. All percentages are based on your expected competition max (what you plan to hit on the platform).',
      stallProtocol: 'If a set at prescribed intensity cannot be completed, reduce your competition max estimate by 2.5-5%. In week 4, practice openers only — do not attempt heavy singles before the meet.',
      maxStallCycles: 1,
    },
    deload: {
      frequency: 'Week 4 is the built-in taper/deload (meet week)',
      method: 'Week 4: practice openers only (2-3 singles at ~90% of planned opener). No accessory work. Full rest 2 days before competition.',
      duration: 'Week 4 (final week of cycle)',
      citation: 'Sheiko B. Powerlifting: A Guide for Coaches and Athletes (2018); PMC7552788 taper meta-analysis — 2-5% performance improvement from optimal taper strategy',
    },
    transitionCriteria: 'After competition, take 1-2 weeks off, then restart with #29 using updated maxes. If not competing, can transition to any general strength program.',
    transitionOptions: ['sheiko_29', 'block_periodization', 'dup', 'conjugate'],
    scienceBasis: 'The competition cycle applies the delayed training effect from the high-volume prep cycle (#29). As volume drops and intensity rises, the accumulated fatigue dissipates while the adaptation (increased strength) is expressed. This follows Verkhoshansky\'s concentrated loading → realization model. The taper in week 4 aligns with meta-analysis findings (PMC7552788): a 2-week taper with volume reduction of 40-60% while maintaining intensity produces 2-5% performance improvement. Sheiko\'s system has produced numerous IPF world champions (Sheiko 2018).',
    typicalDurationWeeks: [4, 4],
    sessionMinutes: 85,
    weeklyWaves: {
      // Sheiko #31 is a single 4-week competition cycle — rising intensity, tapering volume
      0: {
        1: { intensityPct: 78, repTarget: '5x3-4', volumeMultiplier: 1.0 },
        2: { intensityPct: 83, repTarget: '4x2-3', volumeMultiplier: 0.85 },
        3: { intensityPct: 88, repTarget: '3x1-2', volumeMultiplier: 0.6 },
        4: { intensityPct: 90, repTarget: 'openers only', volumeMultiplier: 0.3 },
      },
    },
  },

  // ═══════════════════════════════════════════
  // CANDITO 6-WEEK STRENGTH PROGRAM
  // ═══════════════════════════════════════════

  candito_6week: {
    id: 'candito_6week',
    name: 'Candito 6-Week Strength Program',
    shortName: 'Candito 6-Wk',
    author: 'Jonnie Candito',
    description: 'Self-contained 6-week block with built-in periodization, peaking, and testing (~70 min sessions). Upper/Lower split, 4 days per week. Phase 1 (Wk 1-2): Muscular Development (8-12 reps). Phase 2 (Wk 3-4): Strength (3-6 reps, heavy). Phase 3 (Wk 5): Peaking (heavy singles/doubles). Phase 4 (Wk 6): Test/Deload (test new maxes). Repeat with updated maxes.',
    level: 'intermediate',
    goals: ['strength', 'powerlifting'],
    daysPerWeek: [4],
    equipmentMin: 'barbell_home',
    workouts: [
      {
        name: 'Lower Body A',
        dayLabel: 'Lower A — Squat Focus',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 4, reps: '10', intensityPct: 65, restSeconds: 120, notes: 'Wk1-2: 4x8-12 @ 65-70%. Wk3-4: 4x3-6 @ 80-87%. Wk5: 3x1-2 @ 90-95%. Wk6: test 1RM.' },
          ] },
          { exerciseSlot: 'rdl', sets: [{ sets: 3, reps: '10', restSeconds: 120, notes: 'Wk1-2: moderate volume. Wk3-5: reduce to 2x6-8. Wk6: skip.' }] },
          { exerciseSlot: 'leg_press', sets: [{ sets: 3, reps: '12', restSeconds: 90, notes: 'Accessory — Wk1-2 only. Drop in Wk3+.' }] },
          { exerciseSlot: 'ab_work', sets: [{ sets: 3, reps: '15', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Upper Body A',
        dayLabel: 'Upper A — Bench Focus',
        exercises: [
          { exerciseSlot: 'bench', sets: [
            { sets: 4, reps: '10', intensityPct: 65, restSeconds: 120, notes: 'Wk1-2: 4x8-12 @ 65-70%. Wk3-4: 4x3-6 @ 80-87%. Wk5: 3x1-2 @ 90-95%. Wk6: test 1RM.' },
          ] },
          { exerciseSlot: 'ohp', sets: [{ sets: 3, reps: '10', restSeconds: 120, notes: 'Wk1-2: moderate volume. Wk3-4: 3x6. Wk5-6: reduce.' }] },
          { exerciseSlot: 'row', sets: [{ sets: 3, reps: '10', restSeconds: 90 }] },
          { exerciseSlot: 'face_pull', sets: [{ sets: 3, reps: '15', restSeconds: 60, notes: 'Shoulder health' }] },
        ],
      },
      {
        name: 'Lower Body B',
        dayLabel: 'Lower B — Deadlift Focus',
        exercises: [
          { exerciseSlot: 'deadlift', sets: [
            { sets: 4, reps: '10', intensityPct: 65, restSeconds: 120, notes: 'Wk1-2: 4x8-12 @ 65-70%. Wk3-4: 4x3-6 @ 80-87%. Wk5: 3x1-2 @ 90-95%. Wk6: test 1RM.' },
          ] },
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '8', intensityPct: 60, restSeconds: 120, notes: 'Light squat volume — technique focus' }] },
          { exerciseSlot: 'hip_thrust', sets: [{ sets: 3, reps: '12', restSeconds: 90, notes: 'Wk1-2 accessory. Reduce in Wk3+.' }] },
        ],
      },
      {
        name: 'Upper Body B',
        dayLabel: 'Upper B — Volume Press',
        exercises: [
          { exerciseSlot: 'bench', sets: [{ sets: 3, reps: '8', intensityPct: 65, restSeconds: 120, notes: 'Volume bench — lighter than Upper A' }] },
          { exerciseSlot: 'ohp', sets: [{ sets: 3, reps: '8', restSeconds: 120, notes: 'Volume pressing' }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 4, reps: '10', restSeconds: 90, notes: 'Pull volume' }] },
          { exerciseSlot: 'curl', sets: [{ sets: 3, reps: '12', restSeconds: 60 }] },
          { exerciseSlot: 'tricep_extension', sets: [{ sets: 3, reps: '12', restSeconds: 60 }] },
        ],
      },
    ],
    progression: {
      type: 'block',
      incrementLbs: { upper: 5, lower: 10 },
      description: 'Phase 1 (Wk 1-2, Muscular Development): 4x8-12 at 65-70% 1RM. Focus on muscle and work capacity. Phase 2 (Wk 3-4, Strength): 4x3-6 at 80-87% 1RM. Reduce accessories, increase intensity. Phase 3 (Wk 5, Peaking): Work up to heavy singles/doubles at 90-95%. Minimal accessories. Phase 4 (Wk 6, Test/Deload): Test new 1RM on SBD, then deload. Use Week 6 results to set next cycle maxes.',
      stallProtocol: 'If Week 6 tests do not improve over the previous cycle, add an extra week of Phase 1 volume in the next cycle. If tests are significantly lower, evaluate recovery (sleep, nutrition, stress).',
      maxStallCycles: 2,
    },
    deload: {
      frequency: 'Built into Week 6 (after testing, remaining days are light)',
      method: 'Week 6: Test 1RM on SBD (Monday/Tuesday), then take remaining days at 50-60% for recovery. Take 2-3 rest days before starting the next 6-week cycle.',
      duration: '3-5 days after testing',
      citation: 'Candito J. Linear/Periodization Strength Program (free program, canditotraininghq.com); block periodization concepts from Issurin (2008)',
    },
    transitionCriteria: 'Can be repeated indefinitely. If progress stalls across 2-3 cycles despite good recovery, transition to a more advanced periodization scheme.',
    transitionOptions: ['block_periodization', '531_bbb', 'dup', 'gzcl_jt2'],
    scienceBasis: 'Candito\'s program applies classic Western periodization (hypertrophy → strength → peaking) in a compressed 6-week format. The phase structure ensures each quality is trained in sequence: Phase 1 builds work capacity and muscle mass (Schoenfeld 2010), Phase 2 converts that mass into strength via neural adaptation (Sale 1988), and Phase 3 peaks performance through intensity realization (Issurin 2008). The built-in testing in Week 6 provides objective feedback for auto-regulation of the next cycle. This compressed periodization has been widely adopted in the intermediate powerlifting community due to its simplicity and effectiveness.',
    typicalDurationWeeks: [6, 24],
    sessionMinutes: 70,
    weeklyWaves: {
      // Phase 1: Muscular Development (Weeks 1-2)
      0: {
        1: { intensityPct: 65, repTarget: '4x10', volumeMultiplier: 1.0 },
        2: { intensityPct: 70, repTarget: '3x8', volumeMultiplier: 0.9 },
      },
      // Phase 2: Strength (Weeks 3-4)
      1: {
        3: { intensityPct: 80, repTarget: '4x5', volumeMultiplier: 1.0 },
        4: { intensityPct: 85, repTarget: '3x3', volumeMultiplier: 0.85 },
      },
      // Phase 3: Peaking (Week 5)
      2: {
        5: { intensityPct: 92, repTarget: '1-2RM work-up', volumeMultiplier: 0.5 },
      },
      // Phase 4: Test/Deload (Week 6)
      3: {
        6: { intensityPct: 100, repTarget: 'test maxes or deload', volumeMultiplier: 0.3 },
      },
    },
  },

  // ═══════════════════════════════════════════
  // CALGARY BARBELL PROGRAMS
  // ═══════════════════════════════════════════

  calgary_barbell_16: {
    id: 'calgary_barbell_16',
    name: 'Calgary Barbell 16-Week',
    shortName: 'CalgaryBB 16wk',
    author: 'Bryce Lewis / Calgary Barbell',
    description: 'Full 16-week competition prep program (~80 min sessions). 4 blocks of 4 weeks: Block 1 (Hypertrophy) → Block 2 (Strength) → Block 3 (Peaking) → Block 4 (Competition/Taper). SBD each session with 2x frequency on weak lifts. Accessories decrease across blocks as intensity rises.',
    level: 'advanced',
    goals: ['powerlifting', 'strength'],
    daysPerWeek: [4],
    equipmentMin: 'barbell_home',
    workouts: [
      // Block 1: Hypertrophy (Weeks 1-4)
      {
        name: 'Block 1 Hyp — Day A: SBD',
        dayLabel: 'Hyp A — Squat / Bench / Deadlift',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 4, reps: '8-10', intensityPct: 65, rpe: 7, restSeconds: 120, notes: 'Block 1 (Hypertrophy): 4x8-12 @ 65-72%. Build work capacity.' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 4, reps: '8-10', intensityPct: 67, rpe: 7, restSeconds: 120 }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 3, reps: '8', intensityPct: 65, rpe: 7, restSeconds: 150, notes: 'Moderate DL volume' }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 3, reps: '12', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Block 1 Hyp — Day B: SBD',
        dayLabel: 'Hyp B — Squat / Bench / Deadlift',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '10-12', intensityPct: 62, rpe: 7, restSeconds: 120, notes: 'Volume squat — lighter intensity' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 4, reps: '10-12', intensityPct: 63, rpe: 7, restSeconds: 120 }] },
          { exerciseSlot: 'rdl', sets: [{ sets: 3, reps: '10', restSeconds: 120, notes: 'Deadlift accessory for hamstring volume' }] },
          { exerciseSlot: 'row', sets: [{ sets: 3, reps: '12', restSeconds: 90 }] },
          { exerciseSlot: 'face_pull', sets: [{ sets: 3, reps: '15', restSeconds: 45 }] },
        ],
      },
      // Block 2: Strength (Weeks 5-8)
      {
        name: 'Block 2 Str — Day A: SBD',
        dayLabel: 'Str A — Squat / Bench / Deadlift',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 4, reps: '5-6', intensityPct: 77, rpe: 8, restSeconds: 240, notes: 'Block 2 (Strength): 4x5-6 @ 75-82%. Heavier loads, lower reps.' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 4, reps: '5-6', intensityPct: 78, rpe: 8, restSeconds: 240 }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 3, reps: '5', intensityPct: 78, rpe: 8, restSeconds: 300 }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 3, reps: '8', restSeconds: 90 }] },
        ],
      },
      {
        name: 'Block 2 Str — Day B: SBD',
        dayLabel: 'Str B — Squat / Bench / Deadlift',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '6-8', intensityPct: 73, rpe: 7, restSeconds: 180, notes: 'Moderate squat — technique focus' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 3, reps: '6-8', intensityPct: 74, rpe: 7, restSeconds: 180 }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 2, reps: '5', intensityPct: 72, rpe: 7, restSeconds: 240, notes: 'Light deadlift work' }] },
          { exerciseSlot: 'row', sets: [{ sets: 3, reps: '8', restSeconds: 90 }] },
        ],
      },
      // Block 3: Peaking (Weeks 9-12)
      {
        name: 'Block 3 Peak — Day A: SBD',
        dayLabel: 'Peak A — Squat / Bench / Deadlift',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '3-4', intensityPct: 85, rpe: 8.5, restSeconds: 300, notes: 'Block 3 (Peaking): 3x3-4 @ 82-90%. Near-max work.' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 3, reps: '3-4', intensityPct: 85, rpe: 8.5, restSeconds: 300 }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 2, reps: '3', intensityPct: 87, rpe: 8.5, restSeconds: 360 }] },
        ],
      },
      {
        name: 'Block 3 Peak — Day B: SBD',
        dayLabel: 'Peak B — Squat / Bench / Deadlift',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 2, reps: '4-5', intensityPct: 78, rpe: 7, restSeconds: 240, notes: 'Light practice day — maintain technique' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 2, reps: '4-5', intensityPct: 78, rpe: 7, restSeconds: 240 }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 1, reps: '3', intensityPct: 78, rpe: 7, restSeconds: 240, notes: 'Maintenance pull' }] },
        ],
      },
      // Block 4: Competition Taper (Weeks 13-16)
      {
        name: 'Block 4 Comp — Day A: Openers',
        dayLabel: 'Comp A — Opener Practice',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 2, reps: '1-2', intensityPct: 90, rpe: 8, restSeconds: 360, notes: 'Block 4 (Competition): 2x1-2 @ 90-95%. Practice openers. Taper volume.' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 2, reps: '1-2', intensityPct: 90, rpe: 8, restSeconds: 360 }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 1, reps: '1-2', intensityPct: 90, rpe: 8, restSeconds: 360 }] },
        ],
      },
      {
        name: 'Block 4 Comp — Day B: Light',
        dayLabel: 'Comp B — Light Maintenance',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 2, reps: '3', intensityPct: 70, restSeconds: 180, notes: 'Light movement prep — maintain neural patterns' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 2, reps: '3', intensityPct: 70, restSeconds: 180 }] },
        ],
      },
    ],
    progression: {
      type: 'block',
      incrementLbs: { upper: 5, lower: 5 },
      description: 'Block 1 (Hypertrophy, Wk 1-4): 4x8-12 @ 65-72%. Build muscle and work capacity. Block 2 (Strength, Wk 5-8): 4x5-6 @ 75-82%. Convert hypertrophy into strength. Block 3 (Peaking, Wk 9-12): 3x3-4 @ 82-90%. Near-max work, reduced volume. Block 4 (Competition, Wk 13-16): 2x1-2 @ 90-100%. Taper volume, practice openers, compete. SBD trained in every session across all blocks.',
      stallProtocol: 'If peaking weights in Block 3 feel heavier than expected, extend Block 2 by 1-2 weeks. If Block 1 hypertrophy work shows no improvement, increase volume by 1-2 sets per exercise.',
      maxStallCycles: 1,
    },
    deload: {
      frequency: 'Bridge week between blocks (reduce volume 40%), plus Block 4 taper',
      method: 'Bridge weeks: 50% volume, 80% intensity. Block 4 taper: volume drops 50-60% while intensity stays at 90%+.',
      duration: '1 week between blocks; Block 4 is the final taper',
      citation: 'Lewis B. / Calgary Barbell (calgarybarbell.com); Issurin V. Block Periodization (2008); PMC7552788 taper meta-analysis',
    },
    transitionCriteria: 'Complete the 16-week macrocycle. After competition, take 1-2 weeks off, then restart at Block 1 with updated maxes.',
    transitionOptions: ['calgary_barbell_16', 'sheiko_29', 'block_periodization'],
    scienceBasis: 'Calgary Barbell\'s 16-week program follows classic block periodization (Issurin 2008) with SBD practiced in every session for maximum specificity. The 4-block structure (hypertrophy → strength → peaking → competition) aligns with directed adaptation theory: each block develops a specific quality while maintaining others. High SBD frequency (4x/week) provides more practice opportunities for technical refinement. The progressive volume decrease and intensity increase across blocks creates a supercompensation peak for competition day. Bryce Lewis has used this framework to coach numerous national-level competitors.',
    typicalDurationWeeks: [16, 16],
    sessionMinutes: 80,
    weeklyWaves: {
      // Block 0: Hypertrophy (Weeks 1-4)
      0: {
        1: { intensityPct: 65, repTarget: '4x8', volumeMultiplier: 1.0 },
        2: { intensityPct: 68, repTarget: '4x7', volumeMultiplier: 1.0 },
        3: { intensityPct: 72, repTarget: '4x6', volumeMultiplier: 1.0 },
        4: { intensityPct: 60, repTarget: '3x8', volumeMultiplier: 0.6 },
      },
      // Block 1: Strength (Weeks 5-8)
      1: {
        1: { intensityPct: 75, repTarget: '4x5', volumeMultiplier: 1.0 },
        2: { intensityPct: 78, repTarget: '4x4', volumeMultiplier: 1.0 },
        3: { intensityPct: 82, repTarget: '3x3', volumeMultiplier: 0.85 },
        4: { intensityPct: 70, repTarget: '3x5', volumeMultiplier: 0.6 },
      },
      // Block 2: Peaking (Weeks 9-12)
      2: {
        1: { intensityPct: 82, repTarget: '3x3', volumeMultiplier: 1.0 },
        2: { intensityPct: 85, repTarget: '3x2', volumeMultiplier: 0.85 },
        3: { intensityPct: 90, repTarget: '2x2', volumeMultiplier: 0.7 },
        4: { intensityPct: 75, repTarget: '2x3', volumeMultiplier: 0.5 },
      },
      // Block 3: Competition (Weeks 13-16)
      3: {
        1: { intensityPct: 90, repTarget: '2x2', volumeMultiplier: 0.7 },
        2: { intensityPct: 93, repTarget: '2x1', volumeMultiplier: 0.5 },
        3: { intensityPct: 95, repTarget: '1x1', volumeMultiplier: 0.3 },
        4: { intensityPct: 90, repTarget: 'opener only', volumeMultiplier: 0.2 },
      },
    },
  },

  calgary_barbell_8: {
    id: 'calgary_barbell_8',
    name: 'Calgary Barbell 8-Week',
    shortName: 'CalgaryBB 8wk',
    author: 'Bryce Lewis / Calgary Barbell',
    description: 'Condensed 8-week competition prep (~75 min sessions). 2 blocks of 4 weeks: Block 1 (Strength) → Block 2 (Peaking/Competition). Ideal when you have less than 12 weeks to prepare, or as a follow-up to a hypertrophy phase. SBD each session.',
    level: 'intermediate',
    goals: ['powerlifting', 'strength'],
    daysPerWeek: [4],
    equipmentMin: 'barbell_home',
    workouts: [
      // Block 1: Strength (Weeks 1-4)
      {
        name: 'Strength — Day A: SBD Heavy',
        dayLabel: 'Str A — Squat / Bench / Deadlift',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 4, reps: '4-6', intensityPct: 78, rpe: 8, restSeconds: 240, notes: 'Block 1 (Strength): build to heavy working sets' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 4, reps: '4-6', intensityPct: 78, rpe: 8, restSeconds: 240 }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 3, reps: '4', intensityPct: 80, rpe: 8, restSeconds: 300 }] },
          { exerciseSlot: 'row', sets: [{ sets: 3, reps: '8', restSeconds: 90 }] },
        ],
      },
      {
        name: 'Strength — Day B: SBD Volume',
        dayLabel: 'Str B — Squat / Bench / Deadlift',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '6-8', intensityPct: 72, rpe: 7, restSeconds: 180, notes: 'Moderate squat volume' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 3, reps: '6-8', intensityPct: 72, rpe: 7, restSeconds: 180 }] },
          { exerciseSlot: 'rdl', sets: [{ sets: 3, reps: '8', restSeconds: 120, notes: 'Deadlift accessory' }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 3, reps: '10', restSeconds: 90 }] },
        ],
      },
      // Block 2: Peaking + Competition (Weeks 5-8)
      {
        name: 'Peaking — Day A: SBD Heavy',
        dayLabel: 'Peak A — Squat / Bench / Deadlift',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '2-3', intensityPct: 87, rpe: 8.5, restSeconds: 300, notes: 'Block 2 (Peaking): heavy singles/doubles/triples' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 3, reps: '2-3', intensityPct: 87, rpe: 8.5, restSeconds: 300 }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 2, reps: '2-3', intensityPct: 88, rpe: 8.5, restSeconds: 360 }] },
        ],
      },
      {
        name: 'Peaking — Day B: SBD Light',
        dayLabel: 'Peak B — Squat / Bench / Deadlift (Light)',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 2, reps: '4', intensityPct: 75, rpe: 7, restSeconds: 180, notes: 'Light practice — maintain technique' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 2, reps: '4', intensityPct: 75, rpe: 7, restSeconds: 180 }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 1, reps: '3', intensityPct: 73, rpe: 7, restSeconds: 240 }] },
        ],
      },
    ],
    progression: {
      type: 'block',
      incrementLbs: { upper: 5, lower: 5 },
      description: 'Block 1 (Strength, Wk 1-4): 4x4-6 @ 75-82%. Heavy working sets with moderate volume. Block 2 (Peaking, Wk 5-8): 3x2-3 @ 82-92%. Volume tapers as intensity rises. Final week: practice openers at 90% for singles. Use after completing a hypertrophy phase or when preparation time is limited.',
      stallProtocol: 'If Block 2 weights feel too heavy, extend Block 1 by 1 week. Use RPE to auto-regulate: if sets are consistently RPE 9.5+, reduce intensity by 2-3%.',
      maxStallCycles: 1,
    },
    deload: {
      frequency: 'Bridge day between blocks + final week taper',
      method: 'Take 2-3 lighter days between Block 1 and Block 2. Final week: opener singles only.',
      duration: '2-3 days between blocks',
      citation: 'Lewis B. / Calgary Barbell (calgarybarbell.com); Issurin V. Block Periodization (2008)',
    },
    transitionCriteria: 'After competition or testing, take 1 week off, then either repeat or transition to a full 16-week cycle for more comprehensive preparation.',
    transitionOptions: ['calgary_barbell_16', 'sheiko_29', '531_bbb', 'block_periodization'],
    scienceBasis: 'This condensed program applies the same block periodization principles as the 16-week version but skips the initial hypertrophy block, making it suitable for lifters who have already completed a volume phase or have limited preparation time. The 2-block structure (strength → peaking) has been shown effective for competition preparation when baseline muscle mass is adequate (Issurin 2008). Calgary Barbell\'s emphasis on SBD in every session maximizes competition lift specificity.',
    typicalDurationWeeks: [8, 8],
    sessionMinutes: 75,
    weeklyWaves: {
      // Block 0: Strength (Weeks 1-4)
      0: {
        1: { intensityPct: 75, repTarget: '4x5', volumeMultiplier: 1.0 },
        2: { intensityPct: 78, repTarget: '4x4', volumeMultiplier: 1.0 },
        3: { intensityPct: 82, repTarget: '3x3', volumeMultiplier: 0.85 },
        4: { intensityPct: 70, repTarget: '3x5', volumeMultiplier: 0.6 },
      },
      // Block 1: Peaking/Competition (Weeks 5-8)
      1: {
        1: { intensityPct: 85, repTarget: '3x3', volumeMultiplier: 1.0 },
        2: { intensityPct: 88, repTarget: '3x2', volumeMultiplier: 0.85 },
        3: { intensityPct: 92, repTarget: '2x1', volumeMultiplier: 0.6 },
        4: { intensityPct: 90, repTarget: 'opener only', volumeMultiplier: 0.3 },
      },
    },
  },

  // ═══════════════════════════════════════════
  // STRONGER BY SCIENCE (SBS) PROGRAMS
  // ═══════════════════════════════════════════

  sbs_hypertrophy: {
    id: 'sbs_hypertrophy',
    name: 'SBS Hypertrophy (AMRAP-Driven)',
    shortName: 'SBS Hypertrophy',
    author: 'Greg Nuckols',
    description: 'Autoregulated hypertrophy program (~70 min sessions). Each main lift has target reps with an AMRAP set — if you exceed the target, weight increases more aggressively next week. Rep ranges of 8-12 for main lifts, higher for accessories. Optional overwarm single before working sets builds confidence at heavier loads without adding fatigue.',
    level: 'intermediate',
    goals: ['hypertrophy', 'powerbuilding', 'general'],
    daysPerWeek: [3, 4],
    equipmentMin: 'barbell_home',
    workouts: [
      {
        name: 'Day 1: Squat + Bench',
        dayLabel: 'Day 1 — Squat / Bench',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 1, reps: '1', intensityPct: 85, restSeconds: 180, notes: 'Overwarm single (optional) — practice heavy weight. Should feel smooth, not grindy.' },
            { sets: 3, reps: '10', intensityPct: 68, rpe: 8, restSeconds: 120, notes: 'Working sets — target 10 reps per set' },
            { sets: 1, reps: '10+', intensityPct: 68, rpe: 10, restSeconds: 120, notes: 'AMRAP set — more reps = more weight added next week' },
          ] },
          { exerciseSlot: 'bench', sets: [
            { sets: 1, reps: '1', intensityPct: 85, restSeconds: 180, notes: 'Overwarm single (optional)' },
            { sets: 3, reps: '10', intensityPct: 68, rpe: 8, restSeconds: 120 },
            { sets: 1, reps: '10+', intensityPct: 68, rpe: 10, restSeconds: 120, notes: 'AMRAP — drives progression' },
          ] },
          { exerciseSlot: 'row', sets: [{ sets: 3, reps: '12', restSeconds: 90 }] },
          { exerciseSlot: 'face_pull', sets: [{ sets: 3, reps: '15', restSeconds: 45 }] },
        ],
      },
      {
        name: 'Day 2: Deadlift + OHP',
        dayLabel: 'Day 2 — Deadlift / OHP',
        exercises: [
          { exerciseSlot: 'deadlift', sets: [
            { sets: 1, reps: '1', intensityPct: 85, restSeconds: 180, notes: 'Overwarm single (optional)' },
            { sets: 3, reps: '8', intensityPct: 70, rpe: 8, restSeconds: 150 },
            { sets: 1, reps: '8+', intensityPct: 70, rpe: 10, restSeconds: 150, notes: 'AMRAP — drives progression' },
          ] },
          { exerciseSlot: 'ohp', sets: [
            { sets: 3, reps: '10', intensityPct: 65, rpe: 8, restSeconds: 120 },
            { sets: 1, reps: '10+', intensityPct: 65, rpe: 10, restSeconds: 120, notes: 'AMRAP' },
          ] },
          { exerciseSlot: 'pullup', sets: [{ sets: 3, reps: '10', restSeconds: 90 }] },
          { exerciseSlot: 'curl', sets: [{ sets: 3, reps: '12', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Day 3: Squat + Bench (Volume)',
        dayLabel: 'Day 3 — Squat / Bench (Volume)',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 3, reps: '10', intensityPct: 65, rpe: 7, restSeconds: 120, notes: 'Volume day — lighter than Day 1' },
            { sets: 1, reps: '10+', intensityPct: 65, rpe: 10, restSeconds: 120, notes: 'AMRAP' },
          ] },
          { exerciseSlot: 'bench', sets: [
            { sets: 3, reps: '10', intensityPct: 65, rpe: 7, restSeconds: 120 },
            { sets: 1, reps: '10+', intensityPct: 65, rpe: 10, restSeconds: 120, notes: 'AMRAP' },
          ] },
          { exerciseSlot: 'rdl', sets: [{ sets: 3, reps: '10', restSeconds: 120 }] },
          { exerciseSlot: 'ab_work', sets: [{ sets: 3, reps: '15', restSeconds: 60 }] },
        ],
      },
    ],
    progression: {
      type: 'amrap_driven',
      incrementLbs: { upper: 5, lower: 5 },
      description: 'AMRAP-driven autoregulation: each exercise has a target rep count. If you hit the target, weight increases by the standard increment. If you exceed the target by 3+ reps, weight increases double. If you fall short, weight stays the same or decreases. This self-adjusting mechanism ensures you are always training at the right intensity for your current recovery state. Per Greg Nuckols: "The program adjusts itself to you."',
      stallProtocol: 'If AMRAP sets consistently fail to hit target reps for 2+ weeks, reduce working weight by 5-7%. If stalling persists, take a deload week. After 2 deload cycles without progress, transition to SBS Strength or a different approach.',
      maxStallCycles: 2,
    },
    deload: {
      frequency: 'Every 6-8 weeks, or when AMRAP performance declines for 2+ consecutive weeks',
      method: 'Reduce all weights to 85-90% of current working weights. Perform prescribed sets/reps but no AMRAP sets (stop at target). Resume normal progression the following week.',
      duration: '1 week',
      citation: 'Nuckols G. Stronger by Science (2020, strongerbyscience.com); AMRAP-driven autoregulation aligns with Zourdos et al. (2016, PMID: 26666744) findings on RPE-based programming; Helms et al. (2016) on autoregulation for strength athletes',
    },
    transitionCriteria: 'Can be run indefinitely. Transition to SBS Strength for a lower-rep phase, or to a peaking program before competition.',
    transitionOptions: ['sbs_strength', '531_bbb', 'block_periodization', 'gzcl_jt2'],
    scienceBasis: 'SBS Hypertrophy uses AMRAP-driven autoregulation to adjust training loads to daily readiness, which is superior to fixed-percentage programming (meta-analysis PMC12336695). The 8-12 rep range is optimal for hypertrophy (Schoenfeld 2010; Schoenfeld et al. 2017 PMID: 28834797). The overwarm single maintains neuromuscular efficiency at heavy loads without adding significant fatigue (Androulakis-Korakakis et al. 2020, PMC8435792). Greg Nuckols\' programming philosophy emphasizes the minimum effective dose with autoregulation — training hard enough to drive adaptation, but not so hard that it compromises recovery (Nuckols 2020).',
    typicalDurationWeeks: [12, 52],
    sessionMinutes: 70,
  },

  sbs_strength: {
    id: 'sbs_strength',
    name: 'SBS Strength (RTF)',
    shortName: 'SBS Strength',
    author: 'Greg Nuckols',
    description: 'Strength-focused AMRAP-driven program (~75 min sessions). Same autoregulation as SBS Hypertrophy but with heavier weights and lower reps (3-6 for main lifts). "RTF" = Reps to Failure. AMRAP performance on the last set drives weekly weight adjustments. Ideal for lifters who want to build strength without a fixed peaking date.',
    level: 'intermediate',
    goals: ['strength', 'powerlifting'],
    daysPerWeek: [3, 4],
    equipmentMin: 'barbell_home',
    workouts: [
      {
        name: 'Day 1: Squat + Bench',
        dayLabel: 'Day 1 — Squat / Bench',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 1, reps: '1', intensityPct: 88, restSeconds: 240, notes: 'Overwarm single — heavier than working sets. Build confidence.' },
            { sets: 3, reps: '5', intensityPct: 78, rpe: 8, restSeconds: 180, notes: 'Working sets — heavy fives' },
            { sets: 1, reps: '5+', intensityPct: 78, rpe: 10, restSeconds: 180, notes: 'AMRAP — drives progression' },
          ] },
          { exerciseSlot: 'bench', sets: [
            { sets: 1, reps: '1', intensityPct: 88, restSeconds: 240, notes: 'Overwarm single' },
            { sets: 3, reps: '5', intensityPct: 78, rpe: 8, restSeconds: 180 },
            { sets: 1, reps: '5+', intensityPct: 78, rpe: 10, restSeconds: 180, notes: 'AMRAP' },
          ] },
          { exerciseSlot: 'row', sets: [{ sets: 3, reps: '8', restSeconds: 90 }] },
        ],
      },
      {
        name: 'Day 2: Deadlift + OHP',
        dayLabel: 'Day 2 — Deadlift / OHP',
        exercises: [
          { exerciseSlot: 'deadlift', sets: [
            { sets: 1, reps: '1', intensityPct: 90, restSeconds: 300, notes: 'Overwarm single' },
            { sets: 3, reps: '4', intensityPct: 80, rpe: 8, restSeconds: 240 },
            { sets: 1, reps: '4+', intensityPct: 80, rpe: 10, restSeconds: 240, notes: 'AMRAP' },
          ] },
          { exerciseSlot: 'ohp', sets: [
            { sets: 3, reps: '5', intensityPct: 75, rpe: 8, restSeconds: 180 },
            { sets: 1, reps: '5+', intensityPct: 75, rpe: 10, restSeconds: 180, notes: 'AMRAP' },
          ] },
          { exerciseSlot: 'pullup', sets: [{ sets: 3, reps: '8', restSeconds: 90 }] },
          { exerciseSlot: 'ab_work', sets: [{ sets: 3, reps: '12', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Day 3: Squat + Bench (Moderate)',
        dayLabel: 'Day 3 — Squat / Bench (Moderate)',
        exercises: [
          { exerciseSlot: 'squat', sets: [
            { sets: 3, reps: '6', intensityPct: 73, rpe: 7, restSeconds: 150, notes: 'Moderate day — slightly lighter than Day 1' },
            { sets: 1, reps: '6+', intensityPct: 73, rpe: 10, restSeconds: 150, notes: 'AMRAP' },
          ] },
          { exerciseSlot: 'bench', sets: [
            { sets: 3, reps: '6', intensityPct: 73, rpe: 7, restSeconds: 150 },
            { sets: 1, reps: '6+', intensityPct: 73, rpe: 10, restSeconds: 150, notes: 'AMRAP' },
          ] },
          { exerciseSlot: 'rdl', sets: [{ sets: 3, reps: '8', restSeconds: 120, notes: 'Hamstring accessory' }] },
          { exerciseSlot: 'face_pull', sets: [{ sets: 3, reps: '15', restSeconds: 45 }] },
        ],
      },
    ],
    progression: {
      type: 'amrap_driven',
      incrementLbs: { upper: 5, lower: 5 },
      description: 'Same AMRAP-driven autoregulation as SBS Hypertrophy, but with heavier loads (3-6 rep range for main lifts). Hit target reps → standard increment. Exceed target by 3+ → double increment. Fall short → maintain or decrease. The overwarm single is heavier (88-90% of 1RM) to build confidence and neural drive at competition-range loads.',
      stallProtocol: 'If AMRAP consistently falls short of target for 2+ weeks, reduce working weight by 5-7%. After 2 deload cycles without improvement, switch to SBS Hypertrophy for a volume phase before returning.',
      maxStallCycles: 2,
    },
    deload: {
      frequency: 'Every 6-8 weeks, or when AMRAP performance declines consistently',
      method: 'Reduce all weights to 85-90% of current working weights. No AMRAP sets — stop at target reps. Skip overwarm singles.',
      duration: '1 week',
      citation: 'Nuckols G. Stronger by Science (2020, strongerbyscience.com); Zourdos et al. (2016, PMID: 26666744) autoregulation',
    },
    transitionCriteria: 'Can be run indefinitely. Transition to SBS Hypertrophy for a volume phase, to Sheiko or Calgary Barbell for competition prep, or to any peaking program.',
    transitionOptions: ['sbs_hypertrophy', 'sheiko_29', 'calgary_barbell_8', 'block_periodization'],
    scienceBasis: 'SBS Strength applies the same AMRAP-driven autoregulation as the Hypertrophy template but at higher intensities (75-80% 1RM working sets). The 3-6 rep range targets maximal strength development through high mechanical tension (Schoenfeld 2010, PMID: 20847704). The overwarm single at 88-90% maintains peak force production capacity without meaningful fatigue (Androulakis-Korakakis et al. 2020). The combination of moderate-volume working sets plus AMRAP autoregulation has been shown to produce comparable or superior results to fixed-percentage programming (meta-analysis PMC12336695). Greg Nuckols\' approach is grounded in the principle that the best program is one that adjusts to your daily readiness.',
    typicalDurationWeeks: [12, 52],
    sessionMinutes: 75,
  },

  // ═══════════════════════════════════════════
  // PPL (PUSH/PULL/LEGS)
  // ═══════════════════════════════════════════

  ppl: {
    id: 'ppl',
    name: 'Push/Pull/Legs (PPL)',
    shortName: 'PPL',
    author: 'Various (Reddit PPL / Metallicadpa)',
    description: 'High-frequency 6-day split (~60 min sessions): Push/Pull/Legs repeated twice per week. Each muscle group trained 2x/week. Push days: bench + OHP + triceps + lateral raises. Pull days: rows + pull-ups + deadlift + biceps + rear delts. Leg days: squat + leg press + hamstrings + calves. Compound lifts use linear progression (3-5 reps), accessories use double progression (add weight when you hit the top of the rep range).',
    level: 'intermediate',
    goals: ['hypertrophy', 'powerbuilding', 'general'],
    daysPerWeek: [6],
    equipmentMin: 'full_gym',
    workouts: [
      {
        name: 'Push A — Bench Focus',
        dayLabel: 'Push A — Bench Focus',
        exercises: [
          { exerciseSlot: 'bench', sets: [{ sets: 4, reps: '5', rpe: 8, restSeconds: 180, notes: 'Strength: add weight when you hit 4x5' }] },
          { exerciseSlot: 'ohp', sets: [{ sets: 3, reps: '8-12', rpe: 8, restSeconds: 120, notes: 'Hypertrophy: add weight when you hit 3x12' }] },
          { exerciseSlot: 'dip', sets: [{ sets: 3, reps: '8-12', restSeconds: 90, notes: 'Weighted dips for chest/tricep mass' }] },
          { exerciseSlot: 'lateral_raise', sets: [{ sets: 3, reps: '15-20', restSeconds: 60, notes: 'Side delt isolation' }] },
          { exerciseSlot: 'tricep_extension', sets: [{ sets: 3, reps: '12-15', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Pull A — Row Focus',
        dayLabel: 'Pull A — Row Focus',
        exercises: [
          { exerciseSlot: 'row', sets: [{ sets: 4, reps: '5', rpe: 8, restSeconds: 180, notes: 'Strength: add weight when you hit 4x5' }] },
          { exerciseSlot: 'pullup', sets: [{ sets: 3, reps: '8-12', restSeconds: 120, notes: 'Weighted pull-ups or lat pulldowns' }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 1, reps: '5', rpe: 8, restSeconds: 300, notes: 'Heavy deadlift — 1 top set of 5' }] },
          { exerciseSlot: 'rear_delt_fly', sets: [{ sets: 3, reps: '15-20', restSeconds: 60, notes: 'Rear delt isolation' }] },
          { exerciseSlot: 'curl', sets: [{ sets: 3, reps: '10-12', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Legs A — Squat Focus',
        dayLabel: 'Legs A — Squat Focus',
        exercises: [
          { exerciseSlot: 'squat', sets: [{ sets: 4, reps: '5', rpe: 8, restSeconds: 240, notes: 'Strength: add weight when you hit 4x5' }] },
          { exerciseSlot: 'rdl', sets: [{ sets: 3, reps: '8-10', restSeconds: 120, notes: 'Hamstring volume' }] },
          { exerciseSlot: 'leg_press', sets: [{ sets: 3, reps: '10-12', restSeconds: 120, notes: 'Quad accessory' }] },
          { exerciseSlot: 'hamstring_curl', sets: [{ sets: 3, reps: '10-12', restSeconds: 60 }] },
          { exerciseSlot: 'calf_raise', sets: [{ sets: 4, reps: '12-15', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Push B — OHP Focus',
        dayLabel: 'Push B — OHP Focus',
        exercises: [
          { exerciseSlot: 'ohp', sets: [{ sets: 4, reps: '5', rpe: 8, restSeconds: 180, notes: 'Strength: add weight when you hit 4x5' }] },
          { exerciseSlot: 'bench', sets: [{ sets: 3, reps: '8-12', rpe: 8, restSeconds: 120, notes: 'Volume bench — lighter than Push A' }] },
          { exerciseSlot: 'chest_fly', sets: [{ sets: 3, reps: '12-15', restSeconds: 60, notes: 'Pec isolation' }] },
          { exerciseSlot: 'lateral_raise', sets: [{ sets: 3, reps: '15-20', restSeconds: 60 }] },
          { exerciseSlot: 'tricep_extension', sets: [{ sets: 3, reps: '12-15', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Pull B — Pullup Focus',
        dayLabel: 'Pull B — Pullup Focus',
        exercises: [
          { exerciseSlot: 'pullup', sets: [{ sets: 4, reps: '5', rpe: 8, restSeconds: 180, notes: 'Strength: weighted pull-ups, add weight when you hit 4x5' }] },
          { exerciseSlot: 'row', sets: [{ sets: 3, reps: '8-12', restSeconds: 120, notes: 'Volume rows' }] },
          { exerciseSlot: 'deadlift', sets: [{ sets: 3, reps: '8', intensityPct: 65, restSeconds: 120, notes: 'Volume deadlift — lighter than Pull A' }] },
          { exerciseSlot: 'face_pull', sets: [{ sets: 3, reps: '15-20', restSeconds: 60, notes: 'Rear delt and rotator cuff' }] },
          { exerciseSlot: 'curl', sets: [{ sets: 3, reps: '10-12', restSeconds: 60 }] },
        ],
      },
      {
        name: 'Legs B — Deadlift Focus',
        dayLabel: 'Legs B — Deadlift Focus',
        exercises: [
          { exerciseSlot: 'deadlift', sets: [{ sets: 3, reps: '3-5', rpe: 8.5, restSeconds: 300, notes: 'Heavy deadlift — main pull day' }] },
          { exerciseSlot: 'squat', sets: [{ sets: 3, reps: '8-10', intensityPct: 65, rpe: 7, restSeconds: 120, notes: 'Volume squat — lighter than Legs A' }] },
          { exerciseSlot: 'hip_thrust', sets: [{ sets: 3, reps: '10-12', restSeconds: 90, notes: 'Glute emphasis' }] },
          { exerciseSlot: 'hamstring_curl', sets: [{ sets: 3, reps: '10-12', restSeconds: 60 }] },
          { exerciseSlot: 'calf_raise', sets: [{ sets: 4, reps: '12-15', restSeconds: 60 }] },
        ],
      },
    ],
    progression: {
      type: 'linear_session',
      incrementLbs: { upper: 5, lower: 5 },
      description: 'Dual progression system: Compounds (bench, squat, deadlift, OHP, rows, pull-ups) use linear progression — add 5 lbs when you complete all prescribed sets at the target rep count. Accessories use double progression — when you hit the top of the rep range (e.g., 3x12) at a given weight, increase weight and aim for the bottom of the range (3x8). Each muscle group is trained 2x/week for optimal growth (Schoenfeld et al. 2016).',
      stallProtocol: 'If a compound lift stalls for 2 sessions, deload 10% and rebuild. If stalling persists after 2 deload cycles, switch to a 5/3/1-based progression for that lift while keeping linear progression on others.',
      maxStallCycles: 3,
    },
    deload: {
      frequency: 'Every 6-8 weeks, or after 2 consecutive failed sessions on a lift',
      method: 'Reduce all working weights to 85% for 1 week. Maintain normal volume and exercise selection.',
      duration: '1 week',
      citation: 'Metallicadpa / r/Fitness PPL program; Schoenfeld et al. (2016, PMID: 27102172) — training each muscle 2x/week is superior for hypertrophy',
    },
    transitionCriteria: 'PPL can be run indefinitely as a hypertrophy/general program. If powerlifting-specific peaking is needed, transition to a competition prep program. If 6 days/week is unsustainable, switch to an Upper/Lower or 5/3/1 template.',
    transitionOptions: ['531_bbb', 'upper_lower_split', 'nippard_powerbuilding', 'gzcl_jt2'],
    scienceBasis: 'PPL provides high training frequency (each muscle 2x/week) which Schoenfeld et al. (2016, PMID: 27102172) demonstrated produces significantly greater hypertrophy than 1x/week when volume is equated. The 6-day split allows high weekly volume to be distributed across more sessions, reducing per-session fatigue and allowing higher quality sets. The push/pull/legs organization groups synergistic muscles together while providing recovery between antagonist groups. The "Reddit PPL" (Metallicadpa) is one of the most recommended programs on r/Fitness for intermediate lifters pursuing hypertrophy. Compound progression (3-5 reps) builds strength while isolation work (12-20 reps) maximizes metabolic stress for muscle growth (Schoenfeld 2010, PMID: 20847704).',
    typicalDurationWeeks: [12, 104],
    sessionMinutes: 60,
  },
};

// ─── Program Selection Logic ───

export interface UserProfile {
  experienceLevel: ProgramLevel;
  daysPerWeek: number;
  equipment: EquipmentLevel;
  goal: ProgramGoal;
  /** Known 1RMs in lbs: { squat, bench, deadlift, ohp } */
  maxes?: Partial<Record<string, number>>;
  /** Competition date if goal is powerlifting */
  meetDate?: string;
  /** Biological sex for weight defaults and DOTS scoring */
  sex?: 'male' | 'female';
  /** Bodyweight in the user's selected unit */
  bodyweight?: number;
  /** Target session duration in minutes */
  sessionDurationMinutes?: number;
  /** How many weeks the user plans to train this program */
  plannedDurationWeeks?: number;
}

/**
 * Returns a frequency-specific training note for the user.
 *
 * Frequency recommendations:
 * - 1 day/week:  Suboptimal but better than nothing — squat + press + deadlift in one session
 * - 2 days/week: Can work for maintenance or slow progress (SS Phase 1 A/B)
 * - 3 days/week: All beginner programs, Texas Method, HLM
 * - 4 days/week: 5/3/1 BBB/FSL, Upper-Lower Split, J&T 2.0, nSuns
 * - 5 days/week: nSuns (5-day), Powerbuilding 5x, DUP
 * - 6 days/week: PPL (Push/Pull/Legs)
 */
export function getFrequencyNote(daysPerWeek: number): string | null {
  switch (daysPerWeek) {
    case 1:
      return '1 day/week is suboptimal but better than nothing — focus on squat + press + deadlift in one session.';
    case 2:
      return '2 days/week can work for maintenance or slow progress. Consider an A/B alternating full-body split.';
    case 6:
      return '6 days/week suits a Push/Pull/Legs (PPL) split — each muscle group trained 2x/week for optimal growth.';
    default:
      return null;
  }
}

/**
 * Recommend programs for a user based on their profile.
 * Returns programs sorted by relevance (best fit first).
 *
 * Selection logic:
 * - Filter by experience level
 * - Filter by days per week (programs that support <= user's available days)
 * - Filter by equipment
 * - Score by goal alignment and frequency fit
 *
 * Frequency recommendations:
 * - 1 day/week:  Only SS Phase 1 (with a note)
 * - 2 days/week: SS Phase 1 A/B, or a 2-day full body
 * - 3 days/week: All beginner programs, Texas Method, HLM
 * - 4 days/week: 5/3/1 BBB/FSL, Upper-Lower Split, J&T 2.0, nSuns
 * - 5 days/week: nSuns (5-day), Powerbuilding 5x, DUP
 * - 6 days/week: PPL (Push/Pull/Legs)
 */
export function recommendPrograms(profile: UserProfile): ProgramDefinition[] {
  let candidates = Object.values(PROGRAMS).filter(p => {
    // Experience level match
    if (p.level !== profile.experienceLevel) return false;
    // Days per week match
    if (!p.daysPerWeek.some(d => d <= profile.daysPerWeek)) return false;
    // Equipment compatibility
    const equipmentRank: Record<EquipmentLevel, number> = {
      bodyweight: 0,
      dumbbells: 1,
      mixed: 2,
      barbell_home: 3,
      full_gym: 4,
    };
    if (equipmentRank[profile.equipment] < equipmentRank[p.equipmentMin]) return false;
    return true;
  });

  // Filter by session duration (if specified, exclude programs that take too long)
  if (profile.sessionDurationMinutes) {
    candidates = candidates.filter(p =>
      !p.sessionMinutes || p.sessionMinutes <= profile.sessionDurationMinutes! + 15 // 15 min tolerance
    );
  }

  // Filter by planned duration (exclude programs too long for the user's timeframe)
  if (profile.plannedDurationWeeks) {
    candidates = candidates.filter(p =>
      p.typicalDurationWeeks[0] <= profile.plannedDurationWeeks!
    );
  }

  // Score by goal alignment + frequency fit (prefer programs whose daysPerWeek
  // includes the user's exact frequency, not just those that fit within it)
  return candidates.sort((a, b) => {
    let scoreA = a.goals.includes(profile.goal) ? 2 : 0;
    let scoreB = b.goals.includes(profile.goal) ? 2 : 0;
    // Bonus for exact frequency match
    if (a.daysPerWeek.includes(profile.daysPerWeek)) scoreA += 1;
    if (b.daysPerWeek.includes(profile.daysPerWeek)) scoreB += 1;
    // Additional scoring: session duration match (closer = better)
    if (profile.sessionDurationMinutes && a.sessionMinutes) {
      const timeDiff = Math.abs(a.sessionMinutes - profile.sessionDurationMinutes);
      if (timeDiff <= 10) scoreA += 1; // close match bonus
    }
    if (profile.sessionDurationMinutes && b.sessionMinutes) {
      const timeDiff = Math.abs(b.sessionMinutes - profile.sessionDurationMinutes);
      if (timeDiff <= 10) scoreB += 1; // close match bonus
    }
    return scoreB - scoreA;
  });
}

/**
 * Get a single best program recommendation for a user profile.
 */
export function getBestProgram(profile: UserProfile): ProgramDefinition | null {
  const recommendations = recommendPrograms(profile);
  return recommendations[0] ?? null;
}
