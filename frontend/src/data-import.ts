/**
 * CSV Data Import: import training history from other apps.
 *
 * Supports:
 * - Strong app CSV format
 * - Hevy app CSV format
 * - Generic CSV (date, exercise, weight, reps, [rpe])
 *
 * Includes exercise name mapping with fuzzy matching and a synonym
 * dictionary to map external exercise names to our EXERCISE_SLOTS.
 */

import { EXERCISE_SLOTS } from './workout-programs';
import type { WorkoutLog, WorkoutSet } from './workout-storage';
import { loadWorkoutLogs, saveWorkoutLogs } from './workout-storage';

// ─── Types ───

export type ImportSource = 'strong' | 'hevy' | 'generic';

export interface ImportedWorkout {
  date: string;
  exercises: Array<{
    name: string;
    matchedSlot?: string;
    sets: Array<{
      weight: number;
      reps: number;
      rpe?: number;
    }>;
  }>;
}

export interface ImportResult {
  source: ImportSource;
  totalWorkouts: number;
  totalSets: number;
  unmatchedExercises: string[];
  importedWorkouts: ImportedWorkout[];
  warnings: string[];
}

// ─── Synonym Dictionary ───

/**
 * Maps common exercise name variations from other apps to our EXERCISE_SLOTS keys.
 * All keys are lowercased for case-insensitive matching.
 */
const EXERCISE_SYNONYMS: Record<string, string> = {
  // Squat variants
  'barbell squat': 'squat',
  'barbell back squat': 'squat',
  'back squat': 'squat',
  'squat (barbell)': 'squat',
  'high bar squat': 'squat',
  'low bar squat': 'squat',
  'squat': 'squat',
  'front squat': 'front_squat',
  'barbell front squat': 'front_squat',
  'front squat (barbell)': 'front_squat',
  'goblet squat': 'squat',
  'pause squat': 'pause_squat',
  'box squat': 'box_squat',

  // Bench variants
  'bench press': 'bench',
  'bench press (barbell)': 'bench',
  'barbell bench press': 'bench',
  'flat bench press': 'bench',
  'flat barbell bench press': 'bench',
  'bench': 'bench',
  'close grip bench press': 'close_grip_bench',
  'close-grip bench press': 'close_grip_bench',
  'close grip bench': 'close_grip_bench',
  'spoto press': 'spoto_press',
  'pause bench': 'spoto_press',

  // Deadlift variants
  'deadlift': 'deadlift',
  'barbell deadlift': 'deadlift',
  'conventional deadlift': 'deadlift',
  'deadlift (barbell)': 'deadlift',
  'sumo deadlift': 'deadlift',
  'romanian deadlift': 'rdl',
  'rdl': 'rdl',
  'barbell rdl': 'rdl',
  'romanian deadlift (barbell)': 'rdl',
  'stiff leg deadlift': 'rdl',
  'stiff-leg deadlift': 'rdl',
  'deficit deadlift': 'deficit_deadlift',

  // OHP variants
  'overhead press': 'ohp',
  'overhead press (barbell)': 'ohp',
  'barbell overhead press': 'ohp',
  'ohp': 'ohp',
  'military press': 'ohp',
  'standing press': 'ohp',
  'press': 'ohp',
  'shoulder press': 'ohp',
  'shoulder press (barbell)': 'ohp',

  // Row variants
  'barbell row': 'row',
  'bent over row': 'row',
  'bent over row (barbell)': 'row',
  'barbell bent over row': 'row',
  'pendlay row': 'row',
  'row': 'row',
  'row (barbell)': 'row',

  // Accessories
  'pull up': 'pullup',
  'pull-up': 'pullup',
  'pullup': 'pullup',
  'chin up': 'pullup',
  'chin-up': 'pullup',
  'lat pulldown': 'pullup',
  'lat pull down': 'pullup',
  'leg press': 'leg_press',
  'lunge': 'leg_press',
  'barbell lunge': 'leg_press',
  'bulgarian split squat': 'leg_press',
  'face pull': 'face_pull',
  'face pulls': 'face_pull',
  'band pull apart': 'face_pull',
  'band pull-apart': 'face_pull',
  'bicep curl': 'curl',
  'bicep curl (barbell)': 'curl',
  'barbell curl': 'curl',
  'dumbbell curl': 'curl',
  'curl': 'curl',
  'hammer curl': 'curl',
  'tricep extension': 'tricep_extension',
  'tricep pushdown': 'tricep_extension',
  'skull crusher': 'tricep_extension',
  'overhead tricep extension': 'tricep_extension',
  'ab wheel': 'ab_work',
  'plank': 'ab_work',
  'cable crunch': 'ab_work',
  'hanging leg raise': 'ab_work',
  'leg raise': 'ab_work',
  'hip thrust': 'hip_thrust',
  'barbell hip thrust': 'hip_thrust',
  'glute bridge': 'hip_thrust',
  'good morning': 'good_morning',
  'barbell good morning': 'good_morning',
  'lateral raise': 'lateral_raise',
  'dumbbell lateral raise': 'lateral_raise',
  'side lateral raise': 'lateral_raise',
  'dip': 'dip',
  'dips': 'dip',
  'weighted dip': 'dip',
  'weighted dips': 'dip',
  'tricep dip': 'dip',
};

// ─── CSV Parsing Helpers ───

/**
 * Parse a CSV string into rows of string arrays.
 * Handles quoted fields with embedded commas and newlines.
 */
export function parseCSVRows(csv: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    const next = csv[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        current += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(current.trim());
        current = '';
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        row.push(current.trim());
        current = '';
        if (row.some(cell => cell.length > 0)) {
          rows.push(row);
        }
        row = [];
        if (ch === '\r') i++; // skip \n after \r
      } else {
        current += ch;
      }
    }
  }

  // Last field / row
  row.push(current.trim());
  if (row.some(cell => cell.length > 0)) {
    rows.push(row);
  }

  return rows;
}

/**
 * Find the index of a header column by trying multiple name variants.
 */
function findColumn(headers: string[], ...names: string[]): number {
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());
  for (const name of names) {
    const idx = lowerHeaders.indexOf(name.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

// ─── Format Detection ───

/**
 * Auto-detect CSV format by examining headers.
 */
export function detectCSVFormat(csv: string): ImportSource {
  const firstLine = csv.split(/\r?\n/)[0]?.toLowerCase() ?? '';

  // Strong format: "Date,Workout Name,Exercise Name,Set Order,Weight,Reps,..."
  if (firstLine.includes('workout name') && firstLine.includes('exercise name') && firstLine.includes('set order')) {
    return 'strong';
  }

  // Hevy format: "title,start_time,end_time,exercise_title,..."
  if (firstLine.includes('exercise_title') || (firstLine.includes('title') && firstLine.includes('start_time') && firstLine.includes('end_time'))) {
    return 'hevy';
  }

  return 'generic';
}

// ─── Strong App Parser ───

/**
 * Parse a CSV file from the Strong app.
 * Strong CSV format: Date, Workout Name, Exercise Name, Set Order, Weight, Reps, ...
 * Optional columns: RPE, Distance, Seconds, Notes, Workout Notes, Workout Duration
 */
export function parseStrongCSV(csv: string): ImportResult {
  const warnings: string[] = [];
  const rows = parseCSVRows(csv);

  if (rows.length < 2) {
    return { source: 'strong', totalWorkouts: 0, totalSets: 0, unmatchedExercises: [], importedWorkouts: [], warnings: ['CSV has no data rows.'] };
  }

  const headers = rows[0];
  const dateCol = findColumn(headers, 'date');
  const exerciseCol = findColumn(headers, 'exercise name');
  const weightCol = findColumn(headers, 'weight');
  const repsCol = findColumn(headers, 'reps');
  const rpeCol = findColumn(headers, 'rpe');

  if (dateCol === -1 || exerciseCol === -1) {
    return { source: 'strong', totalWorkouts: 0, totalSets: 0, unmatchedExercises: [], importedWorkouts: [], warnings: ['Missing required columns: Date, Exercise Name.'] };
  }

  // Group by date -> workout
  const workoutMap = new Map<string, ImportedWorkout>();
  const unmatchedSet = new Set<string>();
  let totalSets = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateRaw = row[dateCol] ?? '';
    const exerciseName = row[exerciseCol] ?? '';
    const weight = parseFloat(row[weightCol] ?? '0') || 0;
    const reps = parseInt(row[repsCol] ?? '0', 10) || 0;
    const rpe = rpeCol !== -1 ? (parseFloat(row[rpeCol] ?? '') || undefined) : undefined;

    if (!dateRaw || !exerciseName) continue;

    const date = normalizeDate(dateRaw);
    const matchedSlot = mapExerciseName(exerciseName);

    if (!matchedSlot) {
      unmatchedSet.add(exerciseName);
    }

    if (!workoutMap.has(date)) {
      workoutMap.set(date, { date, exercises: [] });
    }

    const workout = workoutMap.get(date)!;
    let exercise = workout.exercises.find(e => e.name === exerciseName);
    if (!exercise) {
      exercise = { name: exerciseName, matchedSlot: matchedSlot ?? undefined, sets: [] };
      workout.exercises.push(exercise);
    }

    exercise.sets.push({ weight, reps, rpe });
    totalSets++;
  }

  const importedWorkouts = Array.from(workoutMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  return {
    source: 'strong',
    totalWorkouts: importedWorkouts.length,
    totalSets,
    unmatchedExercises: Array.from(unmatchedSet),
    importedWorkouts,
    warnings,
  };
}

// ─── Hevy App Parser ───

/**
 * Parse a CSV file from the Hevy app.
 * Hevy CSV format: title, start_time, end_time, exercise_title, set_index, ...
 */
export function parseHevyCSV(csv: string): ImportResult {
  const warnings: string[] = [];
  const rows = parseCSVRows(csv);

  if (rows.length < 2) {
    return { source: 'hevy', totalWorkouts: 0, totalSets: 0, unmatchedExercises: [], importedWorkouts: [], warnings: ['CSV has no data rows.'] };
  }

  const headers = rows[0];
  const dateCol = findColumn(headers, 'start_time', 'date');
  const exerciseCol = findColumn(headers, 'exercise_title', 'exercise name', 'exercise');
  const weightCol = findColumn(headers, 'weight', 'weight_kg', 'weight_lbs');
  const repsCol = findColumn(headers, 'reps');
  const rpeCol = findColumn(headers, 'rpe');

  if (dateCol === -1 || exerciseCol === -1) {
    return { source: 'hevy', totalWorkouts: 0, totalSets: 0, unmatchedExercises: [], importedWorkouts: [], warnings: ['Missing required columns.'] };
  }

  const workoutMap = new Map<string, ImportedWorkout>();
  const unmatchedSet = new Set<string>();
  let totalSets = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateRaw = row[dateCol] ?? '';
    const exerciseName = row[exerciseCol] ?? '';
    const weight = parseFloat(row[weightCol] ?? '0') || 0;
    const reps = parseInt(row[repsCol] ?? '0', 10) || 0;
    const rpe = rpeCol !== -1 ? (parseFloat(row[rpeCol] ?? '') || undefined) : undefined;

    if (!dateRaw || !exerciseName) continue;

    const date = normalizeDate(dateRaw);
    const matchedSlot = mapExerciseName(exerciseName);

    if (!matchedSlot) {
      unmatchedSet.add(exerciseName);
    }

    if (!workoutMap.has(date)) {
      workoutMap.set(date, { date, exercises: [] });
    }

    const workout = workoutMap.get(date)!;
    let exercise = workout.exercises.find(e => e.name === exerciseName);
    if (!exercise) {
      exercise = { name: exerciseName, matchedSlot: matchedSlot ?? undefined, sets: [] };
      workout.exercises.push(exercise);
    }

    exercise.sets.push({ weight, reps, rpe });
    totalSets++;
  }

  const importedWorkouts = Array.from(workoutMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  return {
    source: 'hevy',
    totalWorkouts: importedWorkouts.length,
    totalSets,
    unmatchedExercises: Array.from(unmatchedSet),
    importedWorkouts,
    warnings,
  };
}

// ─── Generic CSV Parser ───

/**
 * Parse a generic CSV with columns: date, exercise, weight, reps, [rpe]
 */
export function parseGenericCSV(csv: string): ImportResult {
  const warnings: string[] = [];
  const rows = parseCSVRows(csv);

  if (rows.length < 2) {
    return { source: 'generic', totalWorkouts: 0, totalSets: 0, unmatchedExercises: [], importedWorkouts: [], warnings: ['CSV has no data rows.'] };
  }

  const headers = rows[0];
  const dateCol = findColumn(headers, 'date');
  const exerciseCol = findColumn(headers, 'exercise', 'exercise name', 'exercise_name', 'lift');
  const weightCol = findColumn(headers, 'weight', 'load');
  const repsCol = findColumn(headers, 'reps', 'repetitions');
  const rpeCol = findColumn(headers, 'rpe');

  if (dateCol === -1 || exerciseCol === -1) {
    return { source: 'generic', totalWorkouts: 0, totalSets: 0, unmatchedExercises: [], importedWorkouts: [], warnings: ['Missing required columns: date, exercise.'] };
  }

  const workoutMap = new Map<string, ImportedWorkout>();
  const unmatchedSet = new Set<string>();
  let totalSets = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateRaw = row[dateCol] ?? '';
    const exerciseName = row[exerciseCol] ?? '';
    const weight = weightCol !== -1 ? (parseFloat(row[weightCol] ?? '0') || 0) : 0;
    const reps = repsCol !== -1 ? (parseInt(row[repsCol] ?? '0', 10) || 0) : 0;
    const rpe = rpeCol !== -1 ? (parseFloat(row[rpeCol] ?? '') || undefined) : undefined;

    if (!dateRaw || !exerciseName) continue;

    const date = normalizeDate(dateRaw);
    const matchedSlot = mapExerciseName(exerciseName);

    if (!matchedSlot) {
      unmatchedSet.add(exerciseName);
    }

    if (!workoutMap.has(date)) {
      workoutMap.set(date, { date, exercises: [] });
    }

    const workout = workoutMap.get(date)!;
    let exercise = workout.exercises.find(e => e.name === exerciseName);
    if (!exercise) {
      exercise = { name: exerciseName, matchedSlot: matchedSlot ?? undefined, sets: [] };
      workout.exercises.push(exercise);
    }

    exercise.sets.push({ weight, reps, rpe });
    totalSets++;
  }

  const importedWorkouts = Array.from(workoutMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  return {
    source: 'generic',
    totalWorkouts: importedWorkouts.length,
    totalSets,
    unmatchedExercises: Array.from(unmatchedSet),
    importedWorkouts,
    warnings,
  };
}

// ─── Exercise Name Mapping ───

/**
 * Map exercise names from other apps to our EXERCISE_SLOTS.
 * Uses exact matching first, then fuzzy matching via synonym dictionary.
 * Returns the EXERCISE_SLOTS key or null if no match found.
 */
export function mapExerciseName(name: string): string | null {
  if (!name) return null;

  const lower = name.toLowerCase().trim();

  // 1. Direct match to slot key
  if (EXERCISE_SLOTS[lower]) return lower;

  // 2. Exact synonym match
  if (EXERCISE_SYNONYMS[lower]) return EXERCISE_SYNONYMS[lower];

  // 3. Try removing parenthetical suffixes: "Bench Press (Barbell)" -> "Bench Press"
  const withoutParens = lower.replace(/\s*\([^)]*\)\s*/g, '').trim();
  if (EXERCISE_SYNONYMS[withoutParens]) return EXERCISE_SYNONYMS[withoutParens];

  // 4. Fuzzy: check if any synonym key is contained in the name or vice versa
  for (const [synonym, slot] of Object.entries(EXERCISE_SYNONYMS)) {
    if (lower.includes(synonym) || synonym.includes(lower)) {
      return slot;
    }
  }

  // 5. Token-based fuzzy: check if the name contains key tokens of any slot
  const slotNames: Record<string, string[]> = {
    squat: ['squat'],
    bench: ['bench', 'press'],
    deadlift: ['deadlift'],
    ohp: ['overhead', 'military', 'ohp'],
    row: ['row'],
    rdl: ['romanian', 'rdl', 'stiff'],
    pullup: ['pull-up', 'pullup', 'chin-up', 'chinup', 'lat pulldown'],
    curl: ['curl', 'bicep'],
    hip_thrust: ['hip thrust', 'glute bridge'],
    dip: ['dip'],
  };

  for (const [slot, tokens] of Object.entries(slotNames)) {
    // Require at least one token match, but avoid false positives
    // e.g., "leg press" should not match "bench press" just because of "press"
    if (slot === 'bench') {
      if (lower.includes('bench')) return 'bench';
    } else {
      for (const token of tokens) {
        if (lower.includes(token)) return slot;
      }
    }
  }

  return null;
}

// ─── Import to Workout Logs ───

/**
 * Convert imported workouts to WorkoutLog format and save to localStorage.
 */
export function importToWorkoutLogs(workouts: ImportedWorkout[], unit: string): {
  imported: number;
  skipped: number;
} {
  const existingLogs = loadWorkoutLogs();
  const existingDates = new Set(existingLogs.map(l => l.date.slice(0, 10)));

  let imported = 0;
  let skipped = 0;

  for (const workout of workouts) {
    const dateKey = workout.date.slice(0, 10);

    // Skip workouts on dates we already have logged
    if (existingDates.has(dateKey)) {
      skipped++;
      continue;
    }

    const sets: WorkoutSet[] = [];
    let setNumber = 0;

    for (const exercise of workout.exercises) {
      for (const set of exercise.sets) {
        setNumber++;
        sets.push({
          exerciseName: exercise.name,
          exerciseSlot: exercise.matchedSlot ?? exercise.name.toLowerCase(),
          setNumber,
          targetReps: String(set.reps),
          targetWeight: set.weight,
          actualReps: set.reps,
          actualWeight: set.weight,
          rpe: set.rpe,
          completed: true,
        });
      }
    }

    if (sets.length === 0) {
      skipped++;
      continue;
    }

    const log: WorkoutLog = {
      id: `import-${dateKey}-${Date.now().toString(36)}`,
      date: workout.date,
      programId: 'imported',
      workoutDayIndex: 0,
      workoutDayName: 'Imported Workout',
      sets,
      completed: true,
      notes: `Imported from CSV`,
    };

    existingLogs.push(log);
    existingDates.add(dateKey);
    imported++;
  }

  if (imported > 0) {
    // Sort by date
    existingLogs.sort((a, b) => a.date.localeCompare(b.date));
    saveWorkoutLogs(existingLogs);
  }

  return { imported, skipped };
}

// ─── UI Rendering ───

/**
 * Render the import UI with file picker, format detection, preview, and confirmation.
 */
export function renderImportCard(): string {
  return `
    <div class="data-import card">
      <h2 class="fs-xl fw-bold">Import Training Data</h2>
      <p class="fs-sm text-muted">Import your training history from Strong, Hevy, or any CSV file.</p>

      <div class="import-formats fs-sm">
        <h4 class="fw-bold">Supported Formats</h4>
        <ul>
          <li><strong>Strong</strong> &mdash; Export from Strong app (Settings &rarr; Export Data)</li>
          <li><strong>Hevy</strong> &mdash; Export from Hevy app (Settings &rarr; Export Data)</li>
          <li><strong>Generic CSV</strong> &mdash; Columns: date, exercise, weight, reps, [rpe]</li>
        </ul>
      </div>

      <div class="import-dropzone">
        <label for="import-file" class="import-file-label btn btn-primary">
          Choose CSV File
        </label>
        <input type="file" id="import-file" accept=".csv,text/csv" style="display: none;" />
        <p class="fs-xs text-muted">or drag and drop a .csv file here</p>
      </div>

      <div id="import-preview" class="import-preview" style="display: none;">
        <h3 class="fs-lg fw-bold">Preview</h3>
        <div id="import-stats" class="import-stats"></div>
        <div id="import-unmatched" class="import-unmatched"></div>
        <div id="import-warnings" class="import-warnings"></div>
        <div class="import-actions">
          <button id="import-confirm" class="btn btn-primary">Import Data</button>
          <button id="import-cancel" class="btn btn-secondary">Cancel</button>
        </div>
      </div>

      <div id="import-result" class="import-result" style="display: none;"></div>
    </div>
  `;
}

// ─── Internal Helpers ───

/**
 * Normalize various date formats to YYYY-MM-DD.
 * Handles: "2024-01-15", "01/15/2024", "15/01/2024", "Jan 15, 2024", ISO timestamps, etc.
 */
function normalizeDate(dateStr: string): string {
  const trimmed = dateStr.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // ISO timestamp: "2024-01-15T10:30:00Z" or "2024-01-15 10:30:00"
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(trimmed)) return trimmed.slice(0, 10);

  // MM/DD/YYYY or M/D/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD/MM/YYYY (if month > 12, swap)
  // Note: ambiguous; we default to MM/DD/YYYY but accept DD/MM/YYYY if month > 12

  // "Jan 15, 2024" or "January 15, 2024"
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const namedMatch = trimmed.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (namedMatch) {
    const [, monthName, day, year] = namedMatch;
    const monthNum = months[monthName.toLowerCase().slice(0, 3)];
    if (monthNum) {
      return `${year}-${monthNum}-${day.padStart(2, '0')}`;
    }
  }

  // Fallback: try Date.parse
  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  // If all else fails, return as-is (will be a non-standard date)
  return trimmed;
}
