import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createMeetDayState,
  recordAttemptResult,
  setNextAttemptWeight,
  suggestNextAttempt,
  advanceToNextLift,
  calculateRunningTotal,
  hasBombedOut,
  calculateWarmupStartTime,
  generateMeetWarmupSchedule,
  getMeetDayChecklist,
  saveMeetDayState,
  loadMeetDayState,
  clearMeetDayState,
  renderMeetDaySetup,
  renderMeetDayDashboard,
  renderAttemptCard,
  renderWarmupTimeline,
  renderChecklist,
  renderMeetSummary,
} from '../meet-day';
import type { MeetDayState, MeetAttempt, ChecklistItem } from '../meet-day';

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

// ─── Helpers ───

function makeDefaultConfig() {
  return {
    meetName: 'State Championship',
    federation: 'USAPL',
    weightClass: '83kg',
    bodyweight: 81.5,
    openers: { squat: 200, bench: 130, deadlift: 240 },
    unit: 'kg',
  };
}

// ─── createMeetDayState ───

describe('createMeetDayState', () => {
  it('creates state with 9 attempts (3 per lift)', () => {
    const state = createMeetDayState(makeDefaultConfig());
    expect(state.attempts).toHaveLength(9);
  });

  it('sets opener weights for first attempts', () => {
    const state = createMeetDayState(makeDefaultConfig());
    const squatOpener = state.attempts.find(a => a.lift === 'squat' && a.attemptNumber === 1);
    const benchOpener = state.attempts.find(a => a.lift === 'bench' && a.attemptNumber === 1);
    const deadliftOpener = state.attempts.find(a => a.lift === 'deadlift' && a.attemptNumber === 1);

    expect(squatOpener?.weight).toBe(200);
    expect(benchOpener?.weight).toBe(130);
    expect(deadliftOpener?.weight).toBe(240);
  });

  it('sets second and third attempts to 0 (to be filled in later)', () => {
    const state = createMeetDayState(makeDefaultConfig());
    const squatSecond = state.attempts.find(a => a.lift === 'squat' && a.attemptNumber === 2);
    const squatThird = state.attempts.find(a => a.lift === 'squat' && a.attemptNumber === 3);

    expect(squatSecond?.weight).toBe(0);
    expect(squatThird?.weight).toBe(0);
  });

  it('starts on squat attempt 1', () => {
    const state = createMeetDayState(makeDefaultConfig());
    expect(state.currentLift).toBe('squat');
    expect(state.currentAttemptNumber).toBe(1);
  });

  it('starts with running total of 0', () => {
    const state = createMeetDayState(makeDefaultConfig());
    expect(state.runningTotal).toBe(0);
  });

  it('starts not complete', () => {
    const state = createMeetDayState(makeDefaultConfig());
    expect(state.isComplete).toBe(false);
  });

  it('includes meet metadata', () => {
    const state = createMeetDayState(makeDefaultConfig());
    expect(state.meetName).toBe('State Championship');
    expect(state.federation).toBe('USAPL');
    expect(state.weightClass).toBe('83kg');
    expect(state.bodyweight).toBe(81.5);
  });

  it('generates a unique id', () => {
    const state1 = createMeetDayState(makeDefaultConfig());
    const state2 = createMeetDayState(makeDefaultConfig());
    expect(state1.id).not.toBe(state2.id);
  });

  it('all attempts start as pending', () => {
    const state = createMeetDayState(makeDefaultConfig());
    expect(state.attempts.every(a => a.result === 'pending')).toBe(true);
  });
});

// ─── recordAttemptResult ───

describe('recordAttemptResult', () => {
  it('records a good lift on current attempt', () => {
    let state = createMeetDayState(makeDefaultConfig());
    state = recordAttemptResult(state, 'good');

    const squatOpener = state.attempts.find(a => a.lift === 'squat' && a.attemptNumber === 1);
    expect(squatOpener?.result).toBe('good');
  });

  it('records referee lights', () => {
    let state = createMeetDayState(makeDefaultConfig());
    const lights = { left: true, center: true, right: false };
    state = recordAttemptResult(state, 'good', lights);

    const squatOpener = state.attempts.find(a => a.lift === 'squat' && a.attemptNumber === 1);
    expect(squatOpener?.lights).toEqual(lights);
  });

  it('advances to next attempt number', () => {
    let state = createMeetDayState(makeDefaultConfig());
    state = recordAttemptResult(state, 'good');

    expect(state.currentLift).toBe('squat');
    expect(state.currentAttemptNumber).toBe(2);
  });

  it('advances from squat to bench after 3rd squat attempt', () => {
    let state = createMeetDayState(makeDefaultConfig());
    state = setNextAttemptWeight(state, 200);
    state = recordAttemptResult(state, 'good'); // squat 1
    state = setNextAttemptWeight(state, 210);
    state = recordAttemptResult(state, 'good'); // squat 2
    state = setNextAttemptWeight(state, 220);
    state = recordAttemptResult(state, 'good'); // squat 3

    expect(state.currentLift).toBe('bench');
    expect(state.currentAttemptNumber).toBe(1);
  });

  it('advances from bench to deadlift after 3rd bench attempt', () => {
    let state = createMeetDayState(makeDefaultConfig());

    // Complete all squats
    for (let i = 0; i < 3; i++) {
      state = setNextAttemptWeight(state, 200 + i * 10);
      state = recordAttemptResult(state, 'good');
    }
    // Complete all bench
    for (let i = 0; i < 3; i++) {
      state = setNextAttemptWeight(state, 130 + i * 5);
      state = recordAttemptResult(state, 'good');
    }

    expect(state.currentLift).toBe('deadlift');
    expect(state.currentAttemptNumber).toBe(1);
  });

  it('marks meet as complete after 3rd deadlift attempt', () => {
    let state = createMeetDayState(makeDefaultConfig());

    // Complete all 9 attempts
    for (let lift = 0; lift < 3; lift++) {
      for (let attempt = 0; attempt < 3; attempt++) {
        state = setNextAttemptWeight(state, 100 + attempt * 10);
        state = recordAttemptResult(state, 'good');
      }
    }

    expect(state.isComplete).toBe(true);
  });

  it('records a no_lift result', () => {
    let state = createMeetDayState(makeDefaultConfig());
    state = recordAttemptResult(state, 'no_lift');

    const squatOpener = state.attempts.find(a => a.lift === 'squat' && a.attemptNumber === 1);
    expect(squatOpener?.result).toBe('no_lift');
  });

  it('updates running total after good lift', () => {
    let state = createMeetDayState(makeDefaultConfig());
    state = recordAttemptResult(state, 'good');

    expect(state.runningTotal).toBe(200);
  });

  it('does not update running total after no_lift', () => {
    let state = createMeetDayState(makeDefaultConfig());
    state = recordAttemptResult(state, 'no_lift');

    expect(state.runningTotal).toBe(0);
  });

  it('does not mutate original state', () => {
    const state = createMeetDayState(makeDefaultConfig());
    const original = JSON.parse(JSON.stringify(state));
    recordAttemptResult(state, 'good');

    expect(state).toEqual(original);
  });
});

// ─── setNextAttemptWeight ───

describe('setNextAttemptWeight', () => {
  it('sets the weight for the current pending attempt', () => {
    let state = createMeetDayState(makeDefaultConfig());
    state = recordAttemptResult(state, 'good'); // complete attempt 1
    state = setNextAttemptWeight(state, 215);

    const squatSecond = state.attempts.find(a => a.lift === 'squat' && a.attemptNumber === 2);
    expect(squatSecond?.weight).toBe(215);
  });

  it('does not mutate original state', () => {
    const state = createMeetDayState(makeDefaultConfig());
    const original = JSON.parse(JSON.stringify(state));
    setNextAttemptWeight(state, 300);

    expect(state).toEqual(original);
  });
});

// ─── suggestNextAttempt ───

describe('suggestNextAttempt', () => {
  it('suggests opener weight when no attempts have been completed', () => {
    const state = createMeetDayState(makeDefaultConfig());
    const suggestion = suggestNextAttempt(state);

    expect(suggestion.suggested).toBe(200);
    expect(suggestion.reasoning).toContain('opener');
  });

  it('suggests a jump after a good lift (kg)', () => {
    let state = createMeetDayState(makeDefaultConfig());
    state = recordAttemptResult(state, 'good');
    const suggestion = suggestNextAttempt(state);

    // Standard kg jump is 5kg
    expect(suggestion.suggested).toBe(205);
    expect(suggestion.conservative).toBe(202.5);
    expect(suggestion.aggressive).toBe(210);
  });

  it('suggests same weight after a missed lift', () => {
    let state = createMeetDayState(makeDefaultConfig());
    state = recordAttemptResult(state, 'no_lift');
    const suggestion = suggestNextAttempt(state);

    expect(suggestion.suggested).toBe(200);
    expect(suggestion.reasoning).toContain('Missed');
  });

  it('suggests correct increment for lbs', () => {
    let state = createMeetDayState({
      ...makeDefaultConfig(),
      unit: 'lbs',
      openers: { squat: 405, bench: 275, deadlift: 500 },
    });
    state = recordAttemptResult(state, 'good');
    const suggestion = suggestNextAttempt(state);

    expect(suggestion.suggested).toBe(415); // +10 lbs
    expect(suggestion.conservative).toBe(410); // +5 lbs
    expect(suggestion.aggressive).toBe(425); // +20 lbs
  });
});

// ─── advanceToNextLift ───

describe('advanceToNextLift', () => {
  it('advances from squat to bench', () => {
    let state = createMeetDayState(makeDefaultConfig());
    state = advanceToNextLift(state);

    expect(state.currentLift).toBe('bench');
    expect(state.currentAttemptNumber).toBe(1);
  });

  it('advances from bench to deadlift', () => {
    let state = createMeetDayState(makeDefaultConfig());
    state = advanceToNextLift(state);
    state = advanceToNextLift(state);

    expect(state.currentLift).toBe('deadlift');
  });

  it('marks complete when advancing past deadlift', () => {
    let state = createMeetDayState(makeDefaultConfig());
    state = advanceToNextLift(state);
    state = advanceToNextLift(state);
    state = advanceToNextLift(state);

    expect(state.isComplete).toBe(true);
  });
});

// ─── calculateRunningTotal ───

describe('calculateRunningTotal', () => {
  it('returns 0 with no good lifts', () => {
    const state = createMeetDayState(makeDefaultConfig());
    expect(calculateRunningTotal(state)).toBe(0);
  });

  it('uses best successful attempt per lift', () => {
    let state = createMeetDayState(makeDefaultConfig());
    // Squat: good at 200, good at 210, no_lift at 220
    state = recordAttemptResult(state, 'good');     // squat 1 = 200
    state = setNextAttemptWeight(state, 210);
    state = recordAttemptResult(state, 'good');      // squat 2 = 210
    state = setNextAttemptWeight(state, 220);
    state = recordAttemptResult(state, 'no_lift');   // squat 3 = miss

    // Bench: good at 130
    state = recordAttemptResult(state, 'good');      // bench 1 = 130

    expect(calculateRunningTotal(state)).toBe(210 + 130);
  });

  it('calculates full total from 3 lifts', () => {
    let state = createMeetDayState(makeDefaultConfig());

    // Complete all squats
    state = recordAttemptResult(state, 'good'); // squat 1 = 200
    state = setNextAttemptWeight(state, 210);
    state = recordAttemptResult(state, 'good'); // squat 2 = 210
    state = setNextAttemptWeight(state, 220);
    state = recordAttemptResult(state, 'good'); // squat 3 = 220

    // Complete all bench
    state = recordAttemptResult(state, 'good'); // bench 1 = 130
    state = setNextAttemptWeight(state, 140);
    state = recordAttemptResult(state, 'good'); // bench 2 = 140
    state = setNextAttemptWeight(state, 145);
    state = recordAttemptResult(state, 'good'); // bench 3 = 145

    // Complete all deadlift
    state = recordAttemptResult(state, 'good'); // deadlift 1 = 240
    state = setNextAttemptWeight(state, 260);
    state = recordAttemptResult(state, 'good'); // deadlift 2 = 260
    state = setNextAttemptWeight(state, 275);
    state = recordAttemptResult(state, 'good'); // deadlift 3 = 275

    expect(calculateRunningTotal(state)).toBe(220 + 145 + 275);
  });
});

// ─── hasBombedOut ───

describe('hasBombedOut', () => {
  it('returns false with no completed attempts', () => {
    const state = createMeetDayState(makeDefaultConfig());
    expect(hasBombedOut(state)).toBe(false);
  });

  it('returns false with some misses but not all on one lift', () => {
    let state = createMeetDayState(makeDefaultConfig());
    state = recordAttemptResult(state, 'no_lift');
    state = setNextAttemptWeight(state, 200);
    state = recordAttemptResult(state, 'good');

    expect(hasBombedOut(state)).toBe(false);
  });

  it('returns true when all 3 attempts on a lift are no_lift', () => {
    let state = createMeetDayState(makeDefaultConfig());
    state = recordAttemptResult(state, 'no_lift');
    state = setNextAttemptWeight(state, 200);
    state = recordAttemptResult(state, 'no_lift');
    state = setNextAttemptWeight(state, 200);
    state = recordAttemptResult(state, 'no_lift');

    expect(hasBombedOut(state)).toBe(true);
  });

  it('detects bomb out on bench', () => {
    let state = createMeetDayState(makeDefaultConfig());

    // Complete squats successfully
    for (let i = 0; i < 3; i++) {
      state = setNextAttemptWeight(state, 200);
      state = recordAttemptResult(state, 'good');
    }

    // Fail all 3 bench attempts
    for (let i = 0; i < 3; i++) {
      state = setNextAttemptWeight(state, 130);
      state = recordAttemptResult(state, 'no_lift');
    }

    expect(hasBombedOut(state)).toBe(true);
  });
});

// ─── calculateWarmupStartTime ───

describe('calculateWarmupStartTime', () => {
  it('calculates warm-up start based on flight position', () => {
    const now = Date.now();
    const flightStart = now + 30 * 60 * 1000; // 30 min from now
    const result = calculateWarmupStartTime(flightStart, 10, 1.0);

    // 10 lifters * 1 min = 10 min until platform
    // Warm-up starts ~10 min before platform (min 10)
    expect(result.minutesUntilPlatform).toBeGreaterThan(30);
    expect(result.warmupStart).toBeLessThan(flightStart + 10 * 60 * 1000);
  });

  it('uses default 1 minute per lifter if not specified', () => {
    const flightStart = Date.now() + 60 * 60 * 1000;
    const result = calculateWarmupStartTime(flightStart, 15);

    expect(result.minutesUntilPlatform).toBeGreaterThan(60);
  });

  it('returns non-negative minutesUntilWarmup', () => {
    const pastStart = Date.now() - 60 * 60 * 1000;
    const result = calculateWarmupStartTime(pastStart, 5);

    expect(result.minutesUntilWarmup).toBeGreaterThanOrEqual(0);
  });
});

// ─── generateMeetWarmupSchedule ───

describe('generateMeetWarmupSchedule', () => {
  it('generates a warm-up schedule with increasing weights', () => {
    const schedule = generateMeetWarmupSchedule(200, 'kg', 15);

    expect(schedule.length).toBeGreaterThanOrEqual(3);

    // Weights should increase
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].weight).toBeGreaterThanOrEqual(schedule[i - 1].weight);
    }
  });

  it('starts with empty bar', () => {
    const schedule = generateMeetWarmupSchedule(200, 'kg', 15);
    expect(schedule[0].weight).toBe(20); // kg bar
  });

  it('starts with 45 lbs for lbs unit', () => {
    const schedule = generateMeetWarmupSchedule(405, 'lbs', 15);
    expect(schedule[0].weight).toBe(45);
  });

  it('ends with a weight near but below the opener', () => {
    const schedule = generateMeetWarmupSchedule(200, 'kg', 15);
    const lastWeight = schedule[schedule.length - 1].weight;

    expect(lastWeight).toBeLessThan(200);
    expect(lastWeight).toBeGreaterThan(150);
  });

  it('decreases reps as weight increases', () => {
    const schedule = generateMeetWarmupSchedule(200, 'kg', 15);

    // First set should have more reps than last set
    expect(schedule[0].reps).toBeGreaterThanOrEqual(schedule[schedule.length - 1].reps);
  });

  it('includes plate loading info', () => {
    const schedule = generateMeetWarmupSchedule(200, 'kg', 15);

    for (const entry of schedule) {
      expect(entry.plates).toBeTruthy();
      expect(typeof entry.plates).toBe('string');
    }
  });

  it('handles opener equal to bar weight', () => {
    const schedule = generateMeetWarmupSchedule(20, 'kg', 15);
    expect(schedule.length).toBe(1);
    expect(schedule[0].weight).toBe(20);
  });

  it('handles opener below bar weight', () => {
    const schedule = generateMeetWarmupSchedule(15, 'kg', 15);
    expect(schedule.length).toBe(1);
    expect(schedule[0].weight).toBe(20); // bar weight minimum
  });

  it('times are in decreasing order (furthest from platform first)', () => {
    const schedule = generateMeetWarmupSchedule(200, 'kg', 15);

    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].minutesBefore).toBeLessThanOrEqual(schedule[i - 1].minutesBefore);
    }
  });
});

// ─── getMeetDayChecklist ───

describe('getMeetDayChecklist', () => {
  it('returns all 4 categories', () => {
    const checklist = getMeetDayChecklist();
    const categories = new Set(checklist.map(i => i.category));

    expect(categories.has('equipment')).toBe(true);
    expect(categories.has('nutrition')).toBe(true);
    expect(categories.has('admin')).toBe(true);
    expect(categories.has('warmup')).toBe(true);
  });

  it('includes required items', () => {
    const checklist = getMeetDayChecklist();
    const required = checklist.filter(i => i.required);

    expect(required.length).toBeGreaterThan(5);
  });

  it('includes singlet in equipment', () => {
    const checklist = getMeetDayChecklist();
    const singlet = checklist.find(i => i.text.toLowerCase().includes('singlet'));

    expect(singlet).toBeDefined();
    expect(singlet?.category).toBe('equipment');
    expect(singlet?.required).toBe(true);
  });

  it('includes water in nutrition', () => {
    const checklist = getMeetDayChecklist();
    const water = checklist.find(i => i.text.toLowerCase().includes('water'));

    expect(water).toBeDefined();
    expect(water?.category).toBe('nutrition');
  });

  it('includes federation card in admin', () => {
    const checklist = getMeetDayChecklist();
    const card = checklist.find(i => i.text.toLowerCase().includes('federation') || i.text.toLowerCase().includes('membership'));

    expect(card).toBeDefined();
    expect(card?.category).toBe('admin');
  });

  it('all items start unchecked', () => {
    const checklist = getMeetDayChecklist();
    expect(checklist.every(i => !i.checked)).toBe(true);
  });

  it('each item has a unique id', () => {
    const checklist = getMeetDayChecklist();
    const ids = checklist.map(i => i.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });
});

// ─── Storage ───

describe('storage', () => {
  it('saves and loads meet day state', () => {
    const state = createMeetDayState(makeDefaultConfig());
    saveMeetDayState(state);
    const loaded = loadMeetDayState();

    expect(loaded).toEqual(state);
  });

  it('returns null when no state is saved', () => {
    expect(loadMeetDayState()).toBeNull();
  });

  it('clears meet day state', () => {
    const state = createMeetDayState(makeDefaultConfig());
    saveMeetDayState(state);
    clearMeetDayState();

    expect(loadMeetDayState()).toBeNull();
  });

  it('handles corrupted storage gracefully', () => {
    localStorage.setItem('squat_form_meet_day', 'not valid json');
    expect(loadMeetDayState()).toBeNull();
  });
});

// ─── Full Meet Simulation ───

describe('full meet simulation', () => {
  it('simulates a complete 9-for-9 meet', () => {
    let state = createMeetDayState(makeDefaultConfig());

    // Squat: 200 -> 210 -> 220
    expect(state.currentLift).toBe('squat');
    state = recordAttemptResult(state, 'good');
    state = setNextAttemptWeight(state, 210);
    state = recordAttemptResult(state, 'good');
    state = setNextAttemptWeight(state, 220);
    state = recordAttemptResult(state, 'good');

    // Bench: 130 -> 137.5 -> 145
    expect(state.currentLift).toBe('bench');
    state = recordAttemptResult(state, 'good');
    state = setNextAttemptWeight(state, 137.5);
    state = recordAttemptResult(state, 'good');
    state = setNextAttemptWeight(state, 145);
    state = recordAttemptResult(state, 'good');

    // Deadlift: 240 -> 260 -> 275
    expect(state.currentLift).toBe('deadlift');
    state = recordAttemptResult(state, 'good');
    state = setNextAttemptWeight(state, 260);
    state = recordAttemptResult(state, 'good');
    state = setNextAttemptWeight(state, 275);
    state = recordAttemptResult(state, 'good');

    expect(state.isComplete).toBe(true);
    expect(state.runningTotal).toBe(220 + 145 + 275);
    expect(hasBombedOut(state)).toBe(false);
  });

  it('simulates a meet with some misses', () => {
    let state = createMeetDayState(makeDefaultConfig());

    // Squat: good at 200, miss 215, good at 215
    state = recordAttemptResult(state, 'good');
    state = setNextAttemptWeight(state, 215);
    state = recordAttemptResult(state, 'no_lift');
    state = setNextAttemptWeight(state, 215);
    state = recordAttemptResult(state, 'good');

    // Bench: good at 130, good at 140, miss 150
    state = recordAttemptResult(state, 'good');
    state = setNextAttemptWeight(state, 140);
    state = recordAttemptResult(state, 'good');
    state = setNextAttemptWeight(state, 150);
    state = recordAttemptResult(state, 'no_lift');

    // Deadlift: good at 240, good at 260, good at 275
    state = recordAttemptResult(state, 'good');
    state = setNextAttemptWeight(state, 260);
    state = recordAttemptResult(state, 'good');
    state = setNextAttemptWeight(state, 275);
    state = recordAttemptResult(state, 'good');

    expect(state.isComplete).toBe(true);
    // Best squat: 215, best bench: 140, best deadlift: 275
    expect(calculateRunningTotal(state)).toBe(215 + 140 + 275);
    expect(hasBombedOut(state)).toBe(false);
  });
});

// ─── UI Rendering ───

describe('renderMeetDaySetup', () => {
  it('renders setup form HTML', () => {
    const html = renderMeetDaySetup();
    expect(html).toContain('meet-day-form');
    expect(html).toContain('meet-name');
    expect(html).toContain('meet-federation');
    expect(html).toContain('meet-squat-opener');
    expect(html).toContain('meet-bench-opener');
    expect(html).toContain('meet-deadlift-opener');
  });
});

describe('renderMeetDayDashboard', () => {
  it('renders dashboard with current attempt info', () => {
    const state = createMeetDayState(makeDefaultConfig());
    const html = renderMeetDayDashboard(state);

    expect(html).toContain('SQUAT');
    expect(html).toContain('200');
    expect(html).toContain('Attempt 1');
    expect(html).toContain('GOOD LIFT');
    expect(html).toContain('NO LIFT');
  });

  it('shows running total', () => {
    let state = createMeetDayState(makeDefaultConfig());
    state = recordAttemptResult(state, 'good');
    const html = renderMeetDayDashboard(state);

    expect(html).toContain('Running Total');
    expect(html).toContain('200');
  });

  it('shows BOMBED OUT warning when applicable', () => {
    let state = createMeetDayState(makeDefaultConfig());
    state = recordAttemptResult(state, 'no_lift');
    state = setNextAttemptWeight(state, 200);
    state = recordAttemptResult(state, 'no_lift');
    state = setNextAttemptWeight(state, 200);
    state = recordAttemptResult(state, 'no_lift');

    const html = renderMeetDayDashboard(state);
    expect(html).toContain('BOMBED OUT');
  });

  it('shows MEET COMPLETE when done', () => {
    let state = createMeetDayState(makeDefaultConfig());
    for (let i = 0; i < 9; i++) {
      state = setNextAttemptWeight(state, 100);
      state = recordAttemptResult(state, 'good');
    }
    const html = renderMeetDayDashboard(state);
    expect(html).toContain('MEET COMPLETE');
  });
});

describe('renderAttemptCard', () => {
  it('renders pending attempt', () => {
    const attempt: MeetAttempt = {
      lift: 'squat', attemptNumber: 1, weight: 200, unit: 'kg', result: 'pending',
    };
    const html = renderAttemptCard(attempt, false);

    expect(html).toContain('200 kg');
    expect(html).toContain('PENDING');
    expect(html).toContain('meet-attempt-pending');
  });

  it('renders good attempt with green styling', () => {
    const attempt: MeetAttempt = {
      lift: 'squat', attemptNumber: 1, weight: 200, unit: 'kg', result: 'good',
    };
    const html = renderAttemptCard(attempt, false);

    expect(html).toContain('GOOD');
    expect(html).toContain('meet-attempt-good');
  });

  it('renders no_lift attempt', () => {
    const attempt: MeetAttempt = {
      lift: 'bench', attemptNumber: 2, weight: 140, unit: 'kg', result: 'no_lift',
    };
    const html = renderAttemptCard(attempt, false);

    expect(html).toContain('NO LIFT');
    expect(html).toContain('meet-attempt-no-lift');
  });

  it('renders lights when present', () => {
    const attempt: MeetAttempt = {
      lift: 'squat', attemptNumber: 1, weight: 200, unit: 'kg', result: 'good',
      lights: { left: true, center: true, right: false },
    };
    const html = renderAttemptCard(attempt, false);

    expect(html).toContain('meet-lights');
    expect(html).toContain('meet-light-white');
    expect(html).toContain('meet-light-red');
  });

  it('marks current attempt as active', () => {
    const attempt: MeetAttempt = {
      lift: 'squat', attemptNumber: 1, weight: 200, unit: 'kg', result: 'pending',
    };
    const html = renderAttemptCard(attempt, true);

    expect(html).toContain('meet-attempt-active');
  });

  it('shows --- for weight of 0', () => {
    const attempt: MeetAttempt = {
      lift: 'squat', attemptNumber: 2, weight: 0, unit: 'kg', result: 'pending',
    };
    const html = renderAttemptCard(attempt, false);

    expect(html).toContain('---');
  });
});

describe('renderWarmupTimeline', () => {
  it('renders warm-up entries', () => {
    const schedule = generateMeetWarmupSchedule(200, 'kg', 15);
    const html = renderWarmupTimeline(schedule, Date.now());

    expect(html).toContain('Warm-Up Schedule');
    expect(html).toContain('warmup-row');
  });
});

describe('renderChecklist', () => {
  it('renders checklist with categories', () => {
    const items = getMeetDayChecklist();
    const html = renderChecklist(items);

    expect(html).toContain('Equipment');
    expect(html).toContain('Nutrition');
    expect(html).toContain('Admin');
    expect(html).toContain('Warm-Up Gear');
  });

  it('shows progress count', () => {
    const items = getMeetDayChecklist();
    items[0].checked = true;
    const html = renderChecklist(items);

    expect(html).toContain('required items packed');
  });
});

describe('renderMeetSummary', () => {
  it('renders meet summary with total', () => {
    let state = createMeetDayState(makeDefaultConfig());
    for (let i = 0; i < 9; i++) {
      state = setNextAttemptWeight(state, 100);
      state = recordAttemptResult(state, 'good');
    }

    const html = renderMeetSummary(state);
    expect(html).toContain('Meet Summary');
    expect(html).toContain('State Championship');
    expect(html).toContain('Total');
  });

  it('shows Bombed Out in summary when applicable', () => {
    let state = createMeetDayState(makeDefaultConfig());
    for (let i = 0; i < 3; i++) {
      state = setNextAttemptWeight(state, 200);
      state = recordAttemptResult(state, 'no_lift');
    }

    const html = renderMeetSummary(state);
    expect(html).toContain('Bombed Out');
  });
});
