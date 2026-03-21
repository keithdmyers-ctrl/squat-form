import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseCSVRows,
  detectCSVFormat,
  parseStrongCSV,
  parseHevyCSV,
  parseGenericCSV,
  mapExerciseName,
  importToWorkoutLogs,
  renderImportCard,
} from '../data-import';
import type { ImportedWorkout, ImportResult } from '../data-import';

// ─── localStorage Mock ───

function createLocalStorageMock(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

let storageMock: Storage;

beforeEach(() => {
  storageMock = createLocalStorageMock();
  vi.stubGlobal('localStorage', storageMock);
});

// ─── parseCSVRows ───

describe('parseCSVRows', () => {
  it('parses simple CSV', () => {
    const rows = parseCSVRows('a,b,c\n1,2,3\n4,5,6');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('handles quoted fields with commas', () => {
    const rows = parseCSVRows('name,desc\n"Smith, John","A, B, C"');
    expect(rows[1]).toEqual(['Smith, John', 'A, B, C']);
  });

  it('handles escaped quotes', () => {
    const rows = parseCSVRows('val\n"He said ""hello"""');
    expect(rows[1][0]).toBe('He said "hello"');
  });

  it('handles CRLF line endings', () => {
    const rows = parseCSVRows('a,b\r\n1,2\r\n3,4');
    expect(rows).toHaveLength(3);
  });

  it('handles empty CSV', () => {
    const rows = parseCSVRows('');
    expect(rows).toHaveLength(0);
  });

  it('trims whitespace from fields', () => {
    const rows = parseCSVRows('a , b \n 1 , 2 ');
    expect(rows[0]).toEqual(['a', 'b']);
    expect(rows[1]).toEqual(['1', '2']);
  });
});

// ─── detectCSVFormat ───

describe('detectCSVFormat', () => {
  it('detects Strong format', () => {
    const csv = 'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds\n2024-01-15,Morning,Squat,1,100,5,,';
    expect(detectCSVFormat(csv)).toBe('strong');
  });

  it('detects Hevy format', () => {
    const csv = 'title,start_time,end_time,exercise_title,set_index,weight_kg,reps\nPush,2024-01-15,2024-01-15,Squat,1,100,5';
    expect(detectCSVFormat(csv)).toBe('hevy');
  });

  it('detects Hevy format with exercise_title keyword', () => {
    const csv = 'date,exercise_title,weight,reps\n2024-01-15,Squat,100,5';
    expect(detectCSVFormat(csv)).toBe('hevy');
  });

  it('defaults to generic for unknown format', () => {
    const csv = 'date,exercise,weight,reps\n2024-01-15,Squat,100,5';
    expect(detectCSVFormat(csv)).toBe('generic');
  });

  it('handles empty CSV', () => {
    expect(detectCSVFormat('')).toBe('generic');
  });
});

// ─── parseStrongCSV ───

describe('parseStrongCSV', () => {
  const STRONG_HEADER = 'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,Workout Duration,RPE';

  function makeStrongCSV(rows: string[]): string {
    return [STRONG_HEADER, ...rows].join('\n');
  }

  it('parses a basic Strong CSV', () => {
    const csv = makeStrongCSV([
      '2024-01-15,Morning,Barbell Squat,1,100,5,,,,,00:45:00,',
      '2024-01-15,Morning,Barbell Squat,2,100,5,,,,,00:45:00,',
      '2024-01-15,Morning,Barbell Squat,3,100,5,,,,,00:45:00,',
    ]);
    const result = parseStrongCSV(csv);

    expect(result.source).toBe('strong');
    expect(result.totalWorkouts).toBe(1);
    expect(result.totalSets).toBe(3);
    expect(result.importedWorkouts[0].exercises[0].name).toBe('Barbell Squat');
    expect(result.importedWorkouts[0].exercises[0].matchedSlot).toBe('squat');
  });

  it('groups exercises within the same date', () => {
    const csv = makeStrongCSV([
      '2024-01-15,Morning,Barbell Squat,1,100,5,,,,,,',
      '2024-01-15,Morning,Bench Press (Barbell),1,80,5,,,,,,',
    ]);
    const result = parseStrongCSV(csv);

    expect(result.totalWorkouts).toBe(1);
    expect(result.importedWorkouts[0].exercises).toHaveLength(2);
  });

  it('separates workouts on different dates', () => {
    const csv = makeStrongCSV([
      '2024-01-15,Morning,Barbell Squat,1,100,5,,,,,,',
      '2024-01-17,Evening,Barbell Squat,1,105,5,,,,,,',
    ]);
    const result = parseStrongCSV(csv);

    expect(result.totalWorkouts).toBe(2);
  });

  it('parses RPE when available', () => {
    const csv = makeStrongCSV([
      '2024-01-15,Morning,Barbell Squat,1,100,5,,,,,00:45:00,8.5',
    ]);
    const result = parseStrongCSV(csv);

    expect(result.importedWorkouts[0].exercises[0].sets[0].rpe).toBe(8.5);
  });

  it('tracks unmatched exercises', () => {
    const csv = makeStrongCSV([
      '2024-01-15,Morning,Reverse Hyper Machine,1,50,10,,,,,,',
    ]);
    const result = parseStrongCSV(csv);

    expect(result.unmatchedExercises).toContain('Reverse Hyper Machine');
  });

  it('handles empty CSV', () => {
    const result = parseStrongCSV('');
    expect(result.totalWorkouts).toBe(0);
    expect(result.warnings).toHaveLength(1);
  });

  it('handles CSV with only headers', () => {
    const result = parseStrongCSV(STRONG_HEADER);
    expect(result.totalWorkouts).toBe(0);
  });

  it('sorts workouts by date', () => {
    const csv = makeStrongCSV([
      '2024-01-20,Session,Squat,1,100,5,,,,,,',
      '2024-01-15,Session,Squat,1,90,5,,,,,,',
      '2024-01-18,Session,Squat,1,95,5,,,,,,',
    ]);
    const result = parseStrongCSV(csv);

    expect(result.importedWorkouts[0].date).toBe('2024-01-15');
    expect(result.importedWorkouts[1].date).toBe('2024-01-18');
    expect(result.importedWorkouts[2].date).toBe('2024-01-20');
  });

  it('handles missing weight gracefully', () => {
    const csv = makeStrongCSV([
      '2024-01-15,Morning,Plank,1,,0,,60,,,00:45:00,',
    ]);
    const result = parseStrongCSV(csv);
    expect(result.totalSets).toBe(1);
    expect(result.importedWorkouts[0].exercises[0].sets[0].weight).toBe(0);
  });
});

// ─── parseHevyCSV ───

describe('parseHevyCSV', () => {
  const HEVY_HEADER = 'title,start_time,end_time,exercise_title,set_index,weight,reps,rpe';

  function makeHevyCSV(rows: string[]): string {
    return [HEVY_HEADER, ...rows].join('\n');
  }

  it('parses a basic Hevy CSV', () => {
    const csv = makeHevyCSV([
      'Push Day,2024-01-15 08:00,2024-01-15 09:00,Bench Press,1,80,5,8',
      'Push Day,2024-01-15 08:00,2024-01-15 09:00,Bench Press,2,80,5,8.5',
    ]);
    const result = parseHevyCSV(csv);

    expect(result.source).toBe('hevy');
    expect(result.totalWorkouts).toBe(1);
    expect(result.totalSets).toBe(2);
  });

  it('maps Hevy exercise names to slots', () => {
    const csv = makeHevyCSV([
      'Day,2024-01-15,2024-01-15,Barbell Back Squat,1,100,5,',
    ]);
    const result = parseHevyCSV(csv);

    expect(result.importedWorkouts[0].exercises[0].matchedSlot).toBe('squat');
  });

  it('parses RPE values', () => {
    const csv = makeHevyCSV([
      'Day,2024-01-15,2024-01-15,Squat,1,100,5,9',
    ]);
    const result = parseHevyCSV(csv);

    expect(result.importedWorkouts[0].exercises[0].sets[0].rpe).toBe(9);
  });

  it('handles empty Hevy CSV', () => {
    const result = parseHevyCSV('');
    expect(result.totalWorkouts).toBe(0);
  });
});

// ─── parseGenericCSV ───

describe('parseGenericCSV', () => {
  it('parses a generic CSV', () => {
    const csv = 'date,exercise,weight,reps,rpe\n2024-01-15,Squat,100,5,8\n2024-01-15,Bench Press,80,5,';
    const result = parseGenericCSV(csv);

    expect(result.source).toBe('generic');
    expect(result.totalWorkouts).toBe(1);
    expect(result.totalSets).toBe(2);
  });

  it('handles missing weight and reps columns gracefully', () => {
    const csv = 'date,exercise\n2024-01-15,Squat';
    const result = parseGenericCSV(csv);

    expect(result.totalSets).toBe(1);
    expect(result.importedWorkouts[0].exercises[0].sets[0].weight).toBe(0);
    expect(result.importedWorkouts[0].exercises[0].sets[0].reps).toBe(0);
  });

  it('handles alternative column names', () => {
    const csv = 'date,lift,load,repetitions,rpe\n2024-01-15,Squat,100,5,8';
    const result = parseGenericCSV(csv);

    expect(result.totalSets).toBe(1);
    expect(result.importedWorkouts[0].exercises[0].sets[0].weight).toBe(100);
  });

  it('returns warning for CSV without required columns', () => {
    const csv = 'foo,bar,baz\n1,2,3';
    const result = parseGenericCSV(csv);

    expect(result.totalWorkouts).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('parses various date formats', () => {
    const csv = [
      'date,exercise,weight,reps',
      '01/15/2024,Squat,100,5',
      '2024-01-16,Squat,105,5',
      '2024-01-17T10:00:00Z,Squat,110,5',
    ].join('\n');
    const result = parseGenericCSV(csv);

    expect(result.totalWorkouts).toBe(3);
    expect(result.importedWorkouts[0].date).toBe('2024-01-15');
    expect(result.importedWorkouts[1].date).toBe('2024-01-16');
    expect(result.importedWorkouts[2].date).toBe('2024-01-17');
  });
});

// ─── mapExerciseName ───

describe('mapExerciseName', () => {
  // Exact synonym matches
  it('maps "Barbell Squat" to squat', () => {
    expect(mapExerciseName('Barbell Squat')).toBe('squat');
  });

  it('maps "Bench Press (Barbell)" to bench', () => {
    expect(mapExerciseName('Bench Press (Barbell)')).toBe('bench');
  });

  it('maps "Conventional Deadlift" to deadlift', () => {
    expect(mapExerciseName('Conventional Deadlift')).toBe('deadlift');
  });

  it('maps "Overhead Press (Barbell)" to ohp', () => {
    expect(mapExerciseName('Overhead Press (Barbell)')).toBe('ohp');
  });

  it('maps "Barbell Row" to row', () => {
    expect(mapExerciseName('Barbell Row')).toBe('row');
  });

  it('maps "Romanian Deadlift" to rdl', () => {
    expect(mapExerciseName('Romanian Deadlift')).toBe('rdl');
  });

  it('maps "Military Press" to ohp', () => {
    expect(mapExerciseName('Military Press')).toBe('ohp');
  });

  // Case insensitivity
  it('handles case insensitively', () => {
    expect(mapExerciseName('BARBELL SQUAT')).toBe('squat');
    expect(mapExerciseName('bench press')).toBe('bench');
  });

  // Direct slot key match
  it('matches direct slot keys', () => {
    expect(mapExerciseName('squat')).toBe('squat');
    expect(mapExerciseName('bench')).toBe('bench');
    expect(mapExerciseName('deadlift')).toBe('deadlift');
    expect(mapExerciseName('ohp')).toBe('ohp');
  });

  // Fuzzy matching
  it('fuzzy matches exercise names containing keywords', () => {
    expect(mapExerciseName('Barbell Back Squat (High Bar)')).toBe('squat');
  });

  it('maps accessories', () => {
    expect(mapExerciseName('Pull Up')).toBe('pullup');
    expect(mapExerciseName('Chin-Up')).toBe('pullup');
    expect(mapExerciseName('Lat Pulldown')).toBe('pullup');
    expect(mapExerciseName('Barbell Curl')).toBe('curl');
    expect(mapExerciseName('Dumbbell Curl')).toBe('curl');
    expect(mapExerciseName('Hip Thrust')).toBe('hip_thrust');
    expect(mapExerciseName('Dip')).toBe('dip');
    expect(mapExerciseName('Weighted Dips')).toBe('dip');
  });

  // Null for unrecognized
  it('returns null for unrecognized exercises', () => {
    expect(mapExerciseName('Calf Raise Machine')).toBeNull();
    expect(mapExerciseName('Leg Extension')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(mapExerciseName('')).toBeNull();
  });

  // Parenthetical removal
  it('handles parenthetical variants', () => {
    expect(mapExerciseName('Squat (Barbell)')).toBe('squat');
    expect(mapExerciseName('Deadlift (Barbell)')).toBe('deadlift');
  });

  // Pause/specialty variants
  it('maps specialty lifts', () => {
    expect(mapExerciseName('Pause Squat')).toBe('pause_squat');
    expect(mapExerciseName('Front Squat')).toBe('front_squat');
    expect(mapExerciseName('Close Grip Bench Press')).toBe('close_grip_bench');
    expect(mapExerciseName('Deficit Deadlift')).toBe('deficit_deadlift');
    expect(mapExerciseName('Good Morning')).toBe('good_morning');
    expect(mapExerciseName('Box Squat')).toBe('box_squat');
  });
});

// ─── importToWorkoutLogs ───

describe('importToWorkoutLogs', () => {
  it('imports workouts to localStorage', () => {
    const workouts: ImportedWorkout[] = [{
      date: '2024-01-15',
      exercises: [{
        name: 'Squat',
        matchedSlot: 'squat',
        sets: [
          { weight: 100, reps: 5 },
          { weight: 100, reps: 5 },
          { weight: 100, reps: 5 },
        ],
      }],
    }];

    const result = importToWorkoutLogs(workouts, 'kg');
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('skips duplicate dates', () => {
    // First import
    const workouts: ImportedWorkout[] = [{
      date: '2024-01-15',
      exercises: [{
        name: 'Squat',
        matchedSlot: 'squat',
        sets: [{ weight: 100, reps: 5 }],
      }],
    }];
    importToWorkoutLogs(workouts, 'kg');

    // Second import with same date
    const result = importToWorkoutLogs(workouts, 'kg');
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('skips workouts with no sets', () => {
    const workouts: ImportedWorkout[] = [{
      date: '2024-01-15',
      exercises: [],
    }];

    const result = importToWorkoutLogs(workouts, 'kg');
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('imports multiple workouts', () => {
    const workouts: ImportedWorkout[] = [
      {
        date: '2024-01-15',
        exercises: [{ name: 'Squat', matchedSlot: 'squat', sets: [{ weight: 100, reps: 5 }] }],
      },
      {
        date: '2024-01-17',
        exercises: [{ name: 'Bench', matchedSlot: 'bench', sets: [{ weight: 80, reps: 5 }] }],
      },
      {
        date: '2024-01-19',
        exercises: [{ name: 'Deadlift', matchedSlot: 'deadlift', sets: [{ weight: 140, reps: 5 }] }],
      },
    ];

    const result = importToWorkoutLogs(workouts, 'kg');
    expect(result.imported).toBe(3);
    expect(result.skipped).toBe(0);
  });

  it('preserves RPE data', () => {
    const workouts: ImportedWorkout[] = [{
      date: '2024-01-15',
      exercises: [{
        name: 'Squat',
        matchedSlot: 'squat',
        sets: [{ weight: 100, reps: 5, rpe: 8 }],
      }],
    }];

    importToWorkoutLogs(workouts, 'kg');

    const stored = JSON.parse(localStorage.getItem('squat_form_workout_logs') ?? '{}');
    const logs = stored.data ?? stored;
    const sets = Array.isArray(logs) ? logs[0]?.sets : [];
    expect(sets[0]?.rpe).toBe(8);
  });
});

// ─── renderImportCard ───

describe('renderImportCard', () => {
  it('renders import UI', () => {
    const html = renderImportCard();

    expect(html).toContain('Import Training Data');
    expect(html).toContain('import-file');
    expect(html).toContain('Strong');
    expect(html).toContain('Hevy');
    expect(html).toContain('Generic CSV');
  });

  it('includes file picker input', () => {
    const html = renderImportCard();
    expect(html).toContain('type="file"');
    expect(html).toContain('.csv');
  });

  it('includes preview area', () => {
    const html = renderImportCard();
    expect(html).toContain('import-preview');
    expect(html).toContain('import-confirm');
    expect(html).toContain('import-cancel');
  });
});

// ─── Integration: full pipeline ───

describe('full import pipeline', () => {
  it('detects format, parses, and imports Strong CSV', () => {
    const csv = [
      'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,Workout Duration',
      '2024-01-15,Morning,Barbell Squat,1,100,5,,,,,,',
      '2024-01-15,Morning,Barbell Squat,2,100,5,,,,,,',
      '2024-01-15,Morning,Bench Press (Barbell),1,80,5,,,,,,',
      '2024-01-17,Evening,Barbell Squat,1,105,5,,,,,,',
    ].join('\n');

    // Detect
    expect(detectCSVFormat(csv)).toBe('strong');

    // Parse
    const result = parseStrongCSV(csv);
    expect(result.totalWorkouts).toBe(2);
    expect(result.totalSets).toBe(4);
    expect(result.unmatchedExercises).toHaveLength(0);

    // Import
    const importResult = importToWorkoutLogs(result.importedWorkouts, 'kg');
    expect(importResult.imported).toBe(2);
  });

  it('handles malformed CSV gracefully', () => {
    const csv = 'this is not,a valid csv\nwithout proper,structure';
    const result = parseGenericCSV(csv);

    // Should not crash
    expect(result.source).toBe('generic');
  });

  it('handles CSV with only empty rows', () => {
    const csv = 'date,exercise,weight,reps\n\n\n';
    const result = parseGenericCSV(csv);

    expect(result.totalWorkouts).toBe(0);
  });
});
