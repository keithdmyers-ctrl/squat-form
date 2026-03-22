import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadProgramState,
  saveProgramState,
  loadWorkoutLogs,
  saveWorkoutLogs,
  loadUserProfile,
  saveUserProfile,
} from '../workout-storage';
import type {
  ProgramState,
  WorkoutLog,
  WorkoutSet,
  LiftProgress,
} from '../workout-storage';
import type { UserProfile } from '../workout-programs';

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

// Mock document for CustomEvent dispatching in storage error handlers
function createDocumentMock() {
  const listeners: Record<string, Function[]> = {};
  return {
    addEventListener: (type: string, fn: Function) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    removeEventListener: (type: string, fn: Function) => {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter(f => f !== fn);
      }
    },
    dispatchEvent: (event: any) => {
      const fns = listeners[event.type] ?? [];
      for (const fn of fns) fn(event);
      return true;
    },
  };
}

beforeEach(() => {
  storageMock = createLocalStorageMock();
  vi.stubGlobal('localStorage', storageMock);
  vi.stubGlobal('document', createDocumentMock());
  vi.stubGlobal('CustomEvent', class CustomEvent {
    type: string;
    detail: any;
    constructor(type: string, init?: { detail?: any }) {
      this.type = type;
      this.detail = init?.detail;
    }
  });
});

// ─── Helpers ───

function makeMinimalProgramState(overrides: Partial<ProgramState> = {}): ProgramState {
  return {
    programId: 'starting_strength',
    startDate: '2026-03-01',
    currentWeek: 1,
    currentDay: 0,
    trainingMaxes: { squat: 300, bench: 200, deadlift: 350, ohp: 135 },
    liftProgress: {},
    workoutsCompleted: 0,
    cycleNumber: 1,
    weekInCycle: 1,
    equipment: 'full_gym',
    weightUnit: 'lbs',
    ...overrides,
  };
}

function makeMinimalWorkoutLog(overrides: Partial<WorkoutLog> = {}): WorkoutLog {
  return {
    id: 'log-1',
    date: '2026-03-01T10:00:00.000Z',
    programId: 'starting_strength',
    workoutDayIndex: 0,
    workoutDayName: 'Day A',
    sets: [],
    completed: true,
    ...overrides,
  };
}

function makeMinimalUserProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    experienceLevel: 'intermediate',
    daysPerWeek: 3,
    equipment: 'full_gym',
    goal: 'strength',
    maxes: { squat: 300, bench: 200, deadlift: 350, ohp: 135 },
    bodyweight: 180,
    sex: 'male',
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════
//  saveProgramState / loadProgramState
// ══════════════════════════════════════════════════════════════

describe('saveProgramState / loadProgramState', () => {
  it('round-trip: save then load returns same data', () => {
    const state = makeMinimalProgramState();
    saveProgramState(state);
    const loaded = loadProgramState();
    expect(loaded).toEqual(state);
  });

  it('versioned wrapper applied (version field present)', () => {
    const state = makeMinimalProgramState();
    saveProgramState(state);
    const raw = JSON.parse(localStorage.getItem('squat_form_program_state')!);
    expect(raw.version).toBe(1);
    expect(raw.data).toEqual(state);
  });

  it('preserves all program state fields', () => {
    const state = makeMinimalProgramState({
      currentWeek: 5,
      currentDay: 2,
      workoutsCompleted: 15,
      cycleNumber: 3,
      weekInCycle: 2,
      equipment: 'barbell_home',
      weightUnit: 'kg',
      lpPhase: 3,
      pressRotation: 2,
      meetDate: '2026-06-15',
    });
    saveProgramState(state);
    const loaded = loadProgramState();
    expect(loaded).toEqual(state);
  });

  it('preserves liftProgress with full LP tracking data', () => {
    const lp: LiftProgress = {
      liftName: 'squat',
      currentWeight: 315,
      unit: 'lbs',
      increment: 5,
      consecutiveFailures: 0,
      deloadCycles: 0,
      stage: 1,
      lpExhausted: false,
      history: [['2026-03-01', 315, 5, 5]],
      lastSuccessWeight: 315,
      e1rmHistory: [['2026-03-01', 365]],
    };
    const state = makeMinimalProgramState({
      liftProgress: { squat: lp },
    });
    saveProgramState(state);
    const loaded = loadProgramState();
    expect(loaded!.liftProgress.squat).toEqual(lp);
  });

  it('empty storage returns null', () => {
    expect(loadProgramState()).toBeNull();
  });

  it('corrupted JSON returns null', () => {
    localStorage.setItem('squat_form_program_state', 'not valid json {{{');
    expect(loadProgramState()).toBeNull();
  });

  it('legacy (unversioned) data migrated on load', () => {
    // Simulate legacy data without version wrapper
    const legacyData = { programId: 'ss', currentWeek: 2 };
    localStorage.setItem('squat_form_program_state', JSON.stringify(legacyData));
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const loaded = loadProgramState();
    expect(loaded).not.toBeNull();
    // Migration should fill defaults
    expect(loaded!.programId).toBe('ss');
    expect(loaded!.currentWeek).toBe(2);
    expect(loaded!.currentDay).toBe(0);
    expect(loaded!.trainingMaxes).toEqual({});
    expect(loaded!.liftProgress).toEqual({});
    expect(loaded!.workoutsCompleted).toBe(0);
    expect(loaded!.cycleNumber).toBe(1);
    expect(loaded!.equipment).toBe('full');
    expect(loaded!.weightUnit).toBe('lbs');
    consoleSpy.mockRestore();
  });

  it('console.info logged on migration', () => {
    const legacyData = { programId: 'ss' };
    localStorage.setItem('squat_form_program_state', JSON.stringify(legacyData));
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    loadProgramState();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Migrated workout storage'));
    consoleSpy.mockRestore();
  });

  it('already versioned v1 data loads without re-migration', () => {
    const state = makeMinimalProgramState();
    saveProgramState(state);
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const loaded = loadProgramState();
    expect(loaded).toEqual(state);
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('storage full dispatches storage-warning event', () => {
    const errorStorage = createLocalStorageMock();
    errorStorage.setItem = () => { throw new DOMException('QuotaExceededError'); };
    vi.stubGlobal('localStorage', errorStorage);

    const eventSpy = vi.fn();
    document.addEventListener('storage-warning', eventSpy);
    saveProgramState(makeMinimalProgramState());
    expect(eventSpy).toHaveBeenCalled();
    document.removeEventListener('storage-warning', eventSpy);
  });
});

// ══════════════════════════════════════════════════════════════
//  saveWorkoutLogs / loadWorkoutLogs
// ══════════════════════════════════════════════════════════════

describe('saveWorkoutLogs / loadWorkoutLogs', () => {
  it('round-trip preservation', () => {
    const logs = [
      makeMinimalWorkoutLog({ id: 'log-1', date: '2026-03-01T10:00:00.000Z' }),
      makeMinimalWorkoutLog({ id: 'log-2', date: '2026-03-02T10:00:00.000Z' }),
    ];
    saveWorkoutLogs(logs);
    const loaded = loadWorkoutLogs();
    expect(loaded).toEqual(logs);
  });

  it('versioned wrapper applied', () => {
    saveWorkoutLogs([makeMinimalWorkoutLog()]);
    const raw = JSON.parse(localStorage.getItem('squat_form_workout_logs')!);
    expect(raw.version).toBe(1);
    expect(Array.isArray(raw.data)).toBe(true);
  });

  it('200-entry cap enforced', () => {
    const logs = Array.from({ length: 210 }, (_, i) =>
      makeMinimalWorkoutLog({ id: `log-${i}`, date: `2026-01-01T${String(i).padStart(2, '0')}:00:00.000Z` }),
    );
    const eventSpy = vi.fn();
    document.addEventListener('storage-warning', eventSpy);
    saveWorkoutLogs(logs);
    const loaded = loadWorkoutLogs();
    expect(loaded).toHaveLength(200);
    expect(eventSpy).toHaveBeenCalled();
    document.removeEventListener('storage-warning', eventSpy);
  });

  it('exactly 200 logs does not trigger warning', () => {
    const logs = Array.from({ length: 200 }, (_, i) =>
      makeMinimalWorkoutLog({ id: `log-${i}` }),
    );
    const eventSpy = vi.fn();
    document.addEventListener('storage-warning', eventSpy);
    saveWorkoutLogs(logs);
    expect(eventSpy).not.toHaveBeenCalled();
    document.removeEventListener('storage-warning', eventSpy);
  });

  it('empty storage returns empty array', () => {
    expect(loadWorkoutLogs()).toEqual([]);
  });

  it('corrupted JSON returns empty array', () => {
    localStorage.setItem('squat_form_workout_logs', '{{invalid');
    expect(loadWorkoutLogs()).toEqual([]);
  });

  it('legacy (unversioned) log data migrated on load', () => {
    const legacyLogs = [{ date: '2026-03-01T10:00:00.000Z' }];
    localStorage.setItem('squat_form_workout_logs', JSON.stringify(legacyLogs));
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const loaded = loadWorkoutLogs();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].date).toBe('2026-03-01T10:00:00.000Z');
    expect(loaded[0].programId).toBe('');
    expect(loaded[0].workoutDayIndex).toBe(0);
    expect(loaded[0].sets).toEqual([]);
    expect(loaded[0].completed).toBe(false);
    expect(loaded[0].id).toBeDefined();
    consoleSpy.mockRestore();
  });

  it('preserves workout sets with all fields', () => {
    const set: WorkoutSet = {
      exerciseName: 'Squat',
      exerciseSlot: 'main_squat',
      setNumber: 1,
      targetReps: '5',
      targetWeight: 315,
      actualReps: 5,
      actualWeight: 315,
      rpe: 8,
      formScore: 85,
      completed: true,
      notes: 'Felt good',
    };
    const log = makeMinimalWorkoutLog({ sets: [set] });
    saveWorkoutLogs([log]);
    const loaded = loadWorkoutLogs();
    expect(loaded[0].sets[0]).toEqual(set);
  });

  it('preserves readiness data', () => {
    const log = makeMinimalWorkoutLog({
      readiness: { sleepHours: 7, sleepQuality: 4, stress: 2, soreness: 3, motivation: 4 },
    });
    saveWorkoutLogs([log]);
    const loaded = loadWorkoutLogs();
    expect(loaded[0].readiness).toEqual({
      sleepHours: 7, sleepQuality: 4, stress: 2, soreness: 3, motivation: 4,
    });
  });

  it('preserves sessionDifficulty field', () => {
    const log = makeMinimalWorkoutLog({ sessionDifficulty: 'just_right' });
    saveWorkoutLogs([log]);
    const loaded = loadWorkoutLogs();
    expect(loaded[0].sessionDifficulty).toBe('just_right');
  });

  it('storage full dispatches storage-warning event', () => {
    const errorStorage = createLocalStorageMock();
    errorStorage.setItem = () => { throw new DOMException('QuotaExceededError'); };
    vi.stubGlobal('localStorage', errorStorage);

    const eventSpy = vi.fn();
    document.addEventListener('storage-warning', eventSpy);
    saveWorkoutLogs([makeMinimalWorkoutLog()]);
    expect(eventSpy).toHaveBeenCalled();
    document.removeEventListener('storage-warning', eventSpy);
  });
});

// ══════════════════════════════════════════════════════════════
//  saveUserProfile / loadUserProfile
// ══════════════════════════════════════════════════════════════

describe('saveUserProfile / loadUserProfile', () => {
  it('round-trip', () => {
    const profile = makeMinimalUserProfile();
    saveUserProfile(profile);
    const loaded = loadUserProfile();
    expect(loaded).toEqual(profile);
  });

  it('versioned wrapper applied', () => {
    saveUserProfile(makeMinimalUserProfile());
    const raw = JSON.parse(localStorage.getItem('squat_form_user_profile')!);
    expect(raw.version).toBe(1);
    expect(raw.data.experienceLevel).toBe('intermediate');
  });

  it('all fields preserved', () => {
    const profile = makeMinimalUserProfile({
      experienceLevel: 'advanced',
      daysPerWeek: 5,
      equipment: 'dumbbells',
      goal: 'hypertrophy',
      bodyweight: 200,
      sex: 'female',
      meetDate: '2026-09-01',
      maxes: { squat: 400, bench: 250, deadlift: 500, ohp: 175 },
      sessionDurationMinutes: 90,
      plannedDurationWeeks: 12,
    });
    saveUserProfile(profile);
    const loaded = loadUserProfile();
    expect(loaded).toEqual(profile);
  });

  it('empty storage returns null', () => {
    expect(loadUserProfile()).toBeNull();
  });

  it('corrupted JSON returns null', () => {
    localStorage.setItem('squat_form_user_profile', '{{invalid');
    expect(loadUserProfile()).toBeNull();
  });

  it('legacy (unversioned) profile data migrated with defaults', () => {
    const legacyProfile = { bodyweight: 180, sex: 'male' };
    localStorage.setItem('squat_form_user_profile', JSON.stringify(legacyProfile));
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const loaded = loadUserProfile();
    expect(loaded).not.toBeNull();
    expect(loaded!.experienceLevel).toBe('beginner');
    expect(loaded!.daysPerWeek).toBe(3);
    expect(loaded!.equipment).toBe('full');
    expect(loaded!.goal).toBe('general_strength');
    expect((loaded as any).bodyweight).toBe(180);
    expect((loaded as any).sex).toBe('male');
    consoleSpy.mockRestore();
  });

  it('console.info logged on migration', () => {
    localStorage.setItem('squat_form_user_profile', JSON.stringify({ bodyweight: 180 }));
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    loadUserProfile();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Migrated user profile'));
    consoleSpy.mockRestore();
  });

  it('already versioned v1 data loads without re-migration', () => {
    const profile = makeMinimalUserProfile();
    saveUserProfile(profile);
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const loaded = loadUserProfile();
    expect(loaded).toEqual(profile);
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('storage full dispatches storage-warning event', () => {
    const errorStorage = createLocalStorageMock();
    errorStorage.setItem = () => { throw new DOMException('QuotaExceededError'); };
    vi.stubGlobal('localStorage', errorStorage);

    const eventSpy = vi.fn();
    document.addEventListener('storage-warning', eventSpy);
    saveUserProfile(makeMinimalUserProfile());
    expect(eventSpy).toHaveBeenCalled();
    document.removeEventListener('storage-warning', eventSpy);
  });
});

// ══════════════════════════════════════════════════════════════
//  Cross-function interactions
// ══════════════════════════════════════════════════════════════

describe('cross-function interactions', () => {
  it('program state and workout logs are stored independently', () => {
    saveProgramState(makeMinimalProgramState());
    saveWorkoutLogs([makeMinimalWorkoutLog()]);
    saveUserProfile(makeMinimalUserProfile());

    expect(loadProgramState()).not.toBeNull();
    expect(loadWorkoutLogs()).toHaveLength(1);
    expect(loadUserProfile()).not.toBeNull();

    // Clear one, others remain
    localStorage.removeItem('squat_form_program_state');
    expect(loadProgramState()).toBeNull();
    expect(loadWorkoutLogs()).toHaveLength(1);
    expect(loadUserProfile()).not.toBeNull();
  });

  it('saving overwrites previous data', () => {
    saveProgramState(makeMinimalProgramState({ currentWeek: 1 }));
    saveProgramState(makeMinimalProgramState({ currentWeek: 5 }));
    const loaded = loadProgramState();
    expect(loaded!.currentWeek).toBe(5);
  });

  it('save then load multiple times is idempotent', () => {
    const state = makeMinimalProgramState();
    saveProgramState(state);
    const first = loadProgramState();
    const second = loadProgramState();
    expect(first).toEqual(second);
  });
});
