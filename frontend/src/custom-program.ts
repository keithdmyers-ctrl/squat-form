/**
 * Custom program builder: lets users define their own training program
 * from structured text input or form fields. The builder generates a
 * valid ProgramDefinition that works with the existing workout generation,
 * tracking, and adaptation systems.
 *
 * Example input:
 * "Squat 3x5 @ RPE 8, 2x/week, start 185 lbs, increase 5 lbs/week
 *  Bench 3x5 @ RPE 8, 2x/week, start 135 lbs, increase 5 lbs/week
 *  Deadlift 1x5 @ RPE 8, 1x/week, start 225 lbs, increase 5 lbs/week
 *  OHP 3x5 @ RPE 7, 1x/week, start 95 lbs, increase 2.5 lbs/week
 *  Rows 3x8, 2x/week
 *  4 days/week, deload every 4 weeks"
 */

import type { ProgramDefinition, ProgramLevel, ProgramGoal, EquipmentLevel } from './workout-programs';

// ─── Parsed Exercise Definition ───

export interface CustomExercise {
  name: string;
  /** Exercise slot key (squat, bench, deadlift, ohp, row, etc.) */
  slot: string;
  sets: number;
  reps: string;
  rpe?: number;
  /** Percentage of 1RM (alternative to RPE) */
  intensityPct?: number;
  /** Times per week this exercise appears */
  frequency: number;
  /** Starting weight (optional) */
  startWeight?: number;
  /** Weight unit */
  unit?: string;
  /** Weekly weight increase */
  weeklyIncrease?: number;
  /** Notes/instructions */
  notes?: string;
}

export interface CustomProgramConfig {
  name: string;
  daysPerWeek: number;
  exercises: CustomExercise[];
  deloadFrequency: number; // weeks between deloads
  level: ProgramLevel;
  goal: ProgramGoal;
}

// ─── Exercise Slot Mapping ───

const EXERCISE_NAME_TO_SLOT: Record<string, string> = {
  // Squat variants
  'squat': 'squat', 'back squat': 'squat', 'barbell squat': 'squat',
  'front squat': 'front_squat', 'goblet squat': 'squat',
  'pause squat': 'pause_squat', 'box squat': 'box_squat',
  // Bench variants
  'bench': 'bench', 'bench press': 'bench', 'barbell bench': 'bench', 'barbell bench press': 'bench',
  'close grip bench': 'close_grip_bench', 'cgbp': 'close_grip_bench',
  'spoto press': 'spoto_press', 'floor press': 'spoto_press',
  // Deadlift variants
  'deadlift': 'deadlift', 'conventional deadlift': 'deadlift',
  'sumo deadlift': 'deadlift', 'rdl': 'rdl', 'romanian deadlift': 'rdl',
  'deficit deadlift': 'deficit_deadlift',
  // Press variants
  'ohp': 'ohp', 'overhead press': 'ohp', 'press': 'ohp', 'shoulder press': 'ohp',
  'barbell press': 'ohp', 'military press': 'ohp',
  // Row variants
  'row': 'row', 'barbell row': 'row', 'pendlay row': 'row', 'bent over row': 'row',
  'rows': 'row', 'bb row': 'row',
  // Accessories
  'pull-up': 'pullup', 'pullup': 'pullup', 'pull up': 'pullup', 'chin-up': 'pullup',
  'chinup': 'pullup', 'chin up': 'pullup', 'lat pulldown': 'pullup',
  'hip thrust': 'hip_thrust', 'glute bridge': 'hip_thrust',
  'good morning': 'good_morning',
  'face pull': 'face_pull', 'face pulls': 'face_pull',
  'curl': 'curl', 'curls': 'curl', 'bicep curl': 'curl', 'bicep curls': 'curl',
  'tricep extension': 'tricep_extension', 'triceps': 'tricep_extension',
  'skull crusher': 'tricep_extension', 'skull crushers': 'tricep_extension',
  'abs': 'ab_work', 'ab work': 'ab_work', 'core': 'ab_work',
  'leg press': 'leg_press', 'lunge': 'leg_press', 'lunges': 'leg_press',
};

/**
 * Map a user-typed exercise name to an exercise slot key.
 */
export function resolveExerciseSlot(name: string): string {
  const normalized = name.toLowerCase().trim();
  return EXERCISE_NAME_TO_SLOT[normalized] ?? normalized;
}

// ─── Text Parser ───

/**
 * Parse a single line of exercise description.
 * Supports formats like:
 *   "Squat 3x5 @ RPE 8, 2x/week, start 185 lbs, increase 5 lbs/week"
 *   "Bench Press 3x5 @80% 1RM, 2x/week"
 *   "Deadlift 1x5 RPE 9"
 *   "Rows 3x8-10"
 */
export function parseExerciseLine(line: string): CustomExercise | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return null;

  // Extract sets x reps pattern: "3x5", "3×5", "3x5-8", "3x5+"
  const setsRepsMatch = trimmed.match(/(\d+)\s*[x×]\s*(\d+(?:-\d+)?(?:\+)?)/i);
  if (!setsRepsMatch) return null;

  const sets = parseInt(setsRepsMatch[1], 10);
  const reps = setsRepsMatch[2];

  // Everything before the sets x reps is the exercise name
  const nameEnd = trimmed.indexOf(setsRepsMatch[0]);
  const exerciseName = trimmed.slice(0, nameEnd).replace(/[,;:]+$/, '').trim();
  if (!exerciseName) return null;

  // Parse remaining text after sets x reps
  const remainder = trimmed.slice(nameEnd + setsRepsMatch[0].length);

  // RPE: "@ RPE 8", "RPE 8", "@RPE8"
  const rpeMatch = remainder.match(/@?\s*RPE\s*(\d+(?:\.\d+)?)/i);
  const rpe = rpeMatch ? parseFloat(rpeMatch[1]) : undefined;

  // Intensity %1RM: "@80%", "@ 80% 1RM", "@80%1RM"
  const pctMatch = remainder.match(/@?\s*(\d+(?:\.\d+)?)\s*%\s*(?:1RM)?/i);
  const intensityPct = pctMatch ? parseFloat(pctMatch[1]) : undefined;

  // Frequency: "2x/week", "2x per week", "twice/week"
  const freqMatch = remainder.match(/(\d+)\s*x?\s*\/?\s*(?:per\s*)?week/i);
  const frequency = freqMatch ? parseInt(freqMatch[1], 10) : 1;

  // Starting weight: "start 185", "start 185 lbs", "starting at 185"
  const startMatch = remainder.match(/start(?:ing)?\s*(?:at\s*)?(\d+(?:\.\d+)?)\s*(lbs?|kg)?/i);
  const startWeight = startMatch ? parseFloat(startMatch[1]) : undefined;
  const unit = startMatch?.[2]?.toLowerCase().replace(/^lbs?$/, 'lbs') ?? undefined;

  // Weekly increase: "increase 5 lbs/week", "+5/week", "add 5 lbs per week"
  const incMatch = remainder.match(/(?:increase|add|\+)\s*(\d+(?:\.\d+)?)\s*(?:lbs?|kg)?\s*\/?\s*(?:per\s*)?week/i);
  const weeklyIncrease = incMatch ? parseFloat(incMatch[1]) : undefined;

  // Notes: anything after a dash or in parentheses
  const notesMatch = remainder.match(/[-–]\s*(.+)$/) ?? remainder.match(/\((.+)\)/);
  const notes = notesMatch?.[1]?.trim();

  return {
    name: exerciseName,
    slot: resolveExerciseSlot(exerciseName),
    sets,
    reps,
    rpe,
    intensityPct,
    frequency,
    startWeight,
    unit,
    weeklyIncrease,
    notes,
  };
}

/**
 * Parse multi-line program description text.
 * Also extracts global settings like "4 days/week" and "deload every 4 weeks".
 */
export function parseProgramText(text: string): CustomProgramConfig {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const exercises: CustomExercise[] = [];
  let daysPerWeek = 3;
  let deloadFrequency = 4;
  let name = 'Custom Program';
  let level: ProgramLevel = 'intermediate';
  let goal: ProgramGoal = 'strength';

  for (const line of lines) {
    // Check for global settings
    const daysMatch = line.match(/(\d+)\s*days?\s*\/?\s*(?:per\s*)?week/i);
    if (daysMatch && !line.match(/\d+\s*[x×]\s*\d+/)) {
      daysPerWeek = parseInt(daysMatch[1], 10);
      continue;
    }

    const deloadMatch = line.match(/deload\s*(?:every\s*)?(\d+)\s*weeks?/i);
    if (deloadMatch) {
      deloadFrequency = parseInt(deloadMatch[1], 10);
      continue;
    }

    const nameMatch = line.match(/^(?:name|program)\s*:\s*(.+)/i);
    if (nameMatch) {
      name = nameMatch[1].trim();
      continue;
    }

    const levelMatch = line.match(/^level\s*:\s*(beginner|intermediate|advanced)/i);
    if (levelMatch) {
      level = levelMatch[1].toLowerCase() as ProgramLevel;
      continue;
    }

    const goalMatch = line.match(/^goal\s*:\s*(strength|hypertrophy|powerlifting|powerbuilding|general)/i);
    if (goalMatch) {
      goal = goalMatch[1].toLowerCase() as ProgramGoal;
      continue;
    }

    // Try to parse as exercise line
    const exercise = parseExerciseLine(line);
    if (exercise) {
      exercises.push(exercise);
    }
  }

  return { name, daysPerWeek, exercises, deloadFrequency, level, goal };
}

// ─── Program Generation ───

/**
 * Convert a CustomProgramConfig into a valid ProgramDefinition.
 * Distributes exercises across workout days based on frequency and movement patterns.
 */
export function buildCustomProgram(config: CustomProgramConfig): ProgramDefinition {
  const { name, daysPerWeek, exercises, deloadFrequency, level, goal } = config;

  // Distribute exercises across days
  const days = distributeExercises(exercises, daysPerWeek);

  // Build workout day definitions
  const workouts = days.map((dayExercises, i) => ({
    name: `Day ${i + 1}`,
    dayLabel: `Day ${i + 1}`,
    exercises: dayExercises.map(ex => ({
      exerciseSlot: ex.slot,
      sets: [{
        sets: ex.sets,
        reps: ex.reps,
        rpe: ex.rpe,
        intensityPct: ex.intensityPct,
        restSeconds: getDefaultRest(ex),
        notes: ex.notes ?? (ex.startWeight ? `Start at ${ex.startWeight} ${ex.unit ?? 'lbs'}` : undefined),
      }],
    })),
  }));

  // Determine progression type from exercise configs
  const hasWeeklyIncrease = exercises.some(e => e.weeklyIncrease);
  const hasRPE = exercises.some(e => e.rpe);
  const hasPercentage = exercises.some(e => e.intensityPct);
  const progressionType = hasPercentage ? 'percentage_wave' as const
    : hasRPE ? 'rpe_autoregulated' as const
    : 'linear_session' as const;

  // Calculate typical increment
  const exercisesWithIncrease = exercises.filter(e => e.weeklyIncrease);
  const avgIncrement = exercisesWithIncrease.reduce((s, e) => s + (e.weeklyIncrease ?? 5), 0)
    / Math.max(exercisesWithIncrease.length, 1);

  const program: ProgramDefinition = {
    id: 'custom_' + Date.now().toString(36),
    name,
    shortName: name.length > 20 ? name.slice(0, 20) + '...' : name,
    author: 'Custom',
    description: `Custom program: ${exercises.length} exercises, ${daysPerWeek} days/week. ` +
      `${progressionType === 'rpe_autoregulated' ? 'RPE-autoregulated' : progressionType === 'percentage_wave' ? 'Percentage-based' : 'Linear progression'}.`,
    level,
    goals: [goal],
    daysPerWeek: [daysPerWeek],
    equipmentMin: 'barbell_home' as EquipmentLevel,
    workouts,
    progression: {
      type: progressionType,
      incrementLbs: { upper: Math.round(avgIncrement) || 5, lower: Math.round(avgIncrement) || 5 },
      description: hasWeeklyIncrease
        ? `Add weight each week as specified per exercise. ${exercisesWithIncrease.map(e => `${e.name}: +${e.weeklyIncrease} ${e.unit ?? 'lbs'}/week`).join('. ')}.`
        : hasRPE
          ? 'RPE-autoregulated: increase weight when target RPE feels easy. Maintain prescribed RPE across sessions.'
          : 'Linear progression: add weight each session when all sets are completed at target reps.',
      stallProtocol: 'If progress stalls for 2+ weeks, reduce weight by 10% and rebuild. After 3 deload cycles, consider modifying the program.',
      maxStallCycles: 3,
    },
    deload: {
      frequency: `Every ${deloadFrequency} weeks`,
      method: 'Reduce all weights by 30-40%, maintain same sets and reps. Focus on movement quality.',
      duration: '1 week',
      citation: 'User-defined program with evidence-based deload protocol (PMC10948666)',
    },
    transitionCriteria: 'Evaluate after 8-12 weeks. If progress has stalled across multiple lifts despite deloads, consider switching to a structured program.',
    transitionOptions: ['531_bbb', 'upper_lower_split', 'texas_method'],
    scienceBasis: 'Custom program built from user-specified parameters. The adaptation engine still applies: RPE tracking, form score integration, readiness checks, and injury management all function normally regardless of program template.',
    typicalDurationWeeks: [8, 24],
  };

  return program;
}

// ─── Exercise Distribution ───

/** Distribute exercises across N days based on frequency and movement patterns */
function distributeExercises(exercises: CustomExercise[], daysPerWeek: number): CustomExercise[][] {
  const days: CustomExercise[][] = Array.from({ length: daysPerWeek }, () => []);

  // Sort exercises: higher frequency first, compounds before accessories
  const mainSlots = new Set(['squat', 'bench', 'deadlift', 'ohp']);
  const sorted = [...exercises].sort((a, b) => {
    // Main lifts first
    const aMain = mainSlots.has(a.slot) ? 1 : 0;
    const bMain = mainSlots.has(b.slot) ? 1 : 0;
    if (bMain !== aMain) return bMain - aMain;
    // Higher frequency first
    return b.frequency - a.frequency;
  });

  for (const exercise of sorted) {
    // Place exercise on the N days with fewest exercises, spread evenly
    const freq = Math.min(exercise.frequency, daysPerWeek);
    const daysByLoad = days
      .map((d, i) => ({ index: i, count: d.length }))
      .sort((a, b) => a.count - b.count);

    for (let i = 0; i < freq; i++) {
      days[daysByLoad[i].index].push(exercise);
    }
  }

  return days;
}

/** Get default rest seconds based on exercise type */
function getDefaultRest(ex: CustomExercise): number {
  const mainSlots = new Set(['squat', 'bench', 'deadlift', 'ohp']);
  if (mainSlots.has(ex.slot)) {
    const repNum = parseInt(ex.reps, 10);
    if (repNum <= 3) return 300; // 5 min for heavy singles/doubles/triples
    if (repNum <= 6) return 240; // 4 min for strength work
    return 180; // 3 min for moderate compounds
  }
  // Accessories
  return 120;
}

// ─── Storage ───

const CUSTOM_PROGRAMS_KEY = 'squat_form_custom_programs';

export function saveCustomProgram(program: ProgramDefinition): void {
  try {
    const existing = loadCustomPrograms();
    existing[program.id] = program;
    localStorage.setItem(CUSTOM_PROGRAMS_KEY, JSON.stringify(existing));
  } catch {
    document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' }));
  }
}

export function loadCustomPrograms(): Record<string, ProgramDefinition> {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_PROGRAMS_KEY) ?? '{}');
  } catch { return {}; }
}

export function deleteCustomProgram(programId: string): void {
  try {
    const existing = loadCustomPrograms();
    delete existing[programId];
    localStorage.setItem(CUSTOM_PROGRAMS_KEY, JSON.stringify(existing));
  } catch {
    document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' }));
  }
}
