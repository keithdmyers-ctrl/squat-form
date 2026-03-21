/**
 * Tests for PR tracker, plate calculator, workout calendar, and volume tracker.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkForPR, loadPRs, getAllPRsByLift, getBestE1RMs } from '../pr-tracker';
import { calculatePlates, formatPlateResult } from '../plate-calculator';
import { buildCalendarMonth, calculateStreak } from '../workout-calendar';
import { calculateWeeklyVolume, getUndertrainedMuscles, getOvertrainedMuscles } from '../volume-tracker';

// ─── PR Tracker ───

// localStorage mock for tests
function createLocalStorageMock(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

describe('PR Tracker', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageMock());
  });

  it('should detect a new weight PR', () => {
    const results = checkForPR('squat', 315, 1, 'lbs');
    expect(results.some(r => r.record?.type === 'weight')).toBe(true);
    expect(results[0].message).toContain('315');
  });

  it('should detect e1RM PR from rep set', () => {
    const results = checkForPR('bench', 225, 5, 'lbs');
    const e1rmPR = results.find(r => r.record?.type === 'e1rm');
    expect(e1rmPR).toBeDefined();
    // Epley: 225 * (1 + 5/30) = 262.5 → 263
    expect(e1rmPR!.record!.value).toBe(263);
  });

  it('should detect rep PR at a specific weight', () => {
    // First time at 225
    checkForPR('squat', 225, 3, 'lbs');
    // New rep PR at 225
    const results = checkForPR('squat', 225, 5, 'lbs');
    const repPR = results.find(r => r.record?.type === 'reps');
    expect(repPR).toBeDefined();
    expect(repPR!.record!.value).toBe(5);
  });

  it('should detect form score PR on second call', () => {
    checkForPR('deadlift', 405, 1, 'lbs', 80); // Set initial
    const results = checkForPR('deadlift', 405, 1, 'lbs', 92); // New form PR
    const formPR = results.find(r => r.record?.type === 'form_score');
    expect(formPR).toBeDefined();
    expect(formPR!.record!.value).toBe(92);
  });

  it('should not fire weight PR on lower values', () => {
    checkForPR('ohp', 135, 5, 'lbs'); // Set initial
    const results = checkForPR('ohp', 115, 5, 'lbs'); // Lower weight
    const weightPR = results.find(r => r.record?.type === 'weight');
    expect(weightPR).toBeUndefined();
  });

  it('getBestE1RMs should return latest e1RM per lift', () => {
    checkForPR('squat', 300, 5, 'lbs');
    const e1rms = getBestE1RMs();
    expect(e1rms['squat']).toBeGreaterThan(300);
  });
});

// ─── Plate Calculator ───

describe('Plate Calculator', () => {
  it('should calculate plates for 225 lbs', () => {
    const result = calculatePlates(225, 'lbs');
    expect(result.barWeight).toBe(45);
    expect(result.perSide).toEqual([{ plate: 45, count: 2 }]);
    expect(result.totalLoaded).toBe(225);
    expect(result.achievable).toBe(true);
  });

  it('should calculate plates for 315 lbs', () => {
    const result = calculatePlates(315, 'lbs');
    expect(result.perSide).toEqual([{ plate: 45, count: 3 }]);
    expect(result.totalLoaded).toBe(315);
  });

  it('should calculate plates for 185 lbs', () => {
    const result = calculatePlates(185, 'lbs');
    // 185 - 45 = 140, per side = 70: 45 + 25
    expect(result.perSide).toEqual([
      { plate: 45, count: 1 },
      { plate: 25, count: 1 },
    ]);
    expect(result.totalLoaded).toBe(185);
  });

  it('should handle empty bar', () => {
    const result = calculatePlates(45, 'lbs');
    expect(result.perSide).toEqual([]);
    expect(result.achievable).toBe(true);
  });

  it('should handle kg plates', () => {
    const result = calculatePlates(100, 'kg');
    // 100 - 20 = 80, per side = 40: 25 + 15
    expect(result.barWeight).toBe(20);
    expect(result.perSide).toEqual([
      { plate: 25, count: 1 },
      { plate: 15, count: 1 },
    ]);
    expect(result.totalLoaded).toBe(100);
  });

  it('should format result as human-readable string', () => {
    const result = calculatePlates(225, 'lbs');
    const formatted = formatPlateResult(result);
    expect(formatted).toContain('45×2');
    expect(formatted).toContain('/side');
  });

  it('should format empty bar', () => {
    const result = calculatePlates(45, 'lbs');
    expect(formatPlateResult(result)).toContain('Empty bar');
  });
});

// ─── Workout Calendar ───

describe('Workout Calendar', () => {
  it('should build a calendar month with correct days', () => {
    const cal = buildCalendarMonth(2026, 2, []); // March 2026
    expect(cal.label).toBe('March 2026');
    expect(cal.days.length % 7).toBe(0); // Full weeks
    expect(cal.days.filter(d => d.isCurrentMonth).length).toBe(31); // March has 31 days
  });

  it('should mark workout days', () => {
    const logs = [
      { date: '2026-03-15T10:00:00Z', programId: 'starting_strength', workoutDayName: 'Day A', sets: [{ completed: true }] },
      { date: '2026-03-17T10:00:00Z', programId: 'starting_strength', workoutDayName: 'Day B', sets: [{ completed: true }] },
    ];
    const cal = buildCalendarMonth(2026, 2, logs);
    const march15 = cal.days.find(d => d.date === '2026-03-15');
    expect(march15?.workouts.length).toBe(1);
    expect(cal.workoutCount).toBe(2);
  });
});

describe('Streak Calculator', () => {
  it('should calculate streak from consecutive weekly workouts', () => {
    const now = new Date();
    const logs = [];
    // Create 4 weeks of 3 workouts each
    for (let week = 0; week < 4; week++) {
      for (let day = 0; day < 3; day++) {
        const d = new Date(now.getTime() - (week * 7 + day) * 86400000);
        logs.push({ date: d.toISOString() });
      }
    }
    const streak = calculateStreak(logs, 3);
    expect(streak.totalWorkouts).toBe(12);
    expect(streak.workoutsThisWeek).toBeGreaterThanOrEqual(1);
    expect(streak.currentStreak).toBeGreaterThanOrEqual(1);
  });

  it('should return zero streak for no logs', () => {
    const streak = calculateStreak([], 3);
    expect(streak.currentStreak).toBe(0);
    expect(streak.totalWorkouts).toBe(0);
  });
});

// ─── Volume Tracker ───

describe('Volume Tracker', () => {
  it('should calculate weekly volume from workout logs', () => {
    const now = new Date();
    const logs = [{
      date: now.toISOString(),
      sets: [
        { exerciseSlot: 'squat', completed: true },
        { exerciseSlot: 'squat', completed: true },
        { exerciseSlot: 'squat', completed: true },
        { exerciseSlot: 'bench', completed: true },
        { exerciseSlot: 'bench', completed: true },
        { exerciseSlot: 'deadlift', completed: true },
        { exerciseSlot: 'pullup', completed: true },
        { exerciseSlot: 'pullup', completed: true },
      ],
    }];

    const volumes = calculateWeeklyVolume(logs, 1);
    // Quads should have volume from squat (3 sets)
    const quads = volumes.find(v => v.muscleGroup === 'quads');
    expect(quads).toBeDefined();
    expect(quads!.weeklySets).toBe(3);

    // Chest from bench (2 sets)
    const chest = volumes.find(v => v.muscleGroup === 'chest');
    expect(chest!.weeklySets).toBe(2);
  });

  it('should identify undertrained muscles', () => {
    const volumes = calculateWeeklyVolume([], 1);
    const under = getUndertrainedMuscles(volumes);
    // With no training, most muscles should be undertrained
    expect(under.length).toBeGreaterThan(0);
  });

  it('should identify excessive volume', () => {
    const now = new Date();
    // Create a log with excessive squat volume (30 sets)
    const sets = Array.from({ length: 30 }, () => ({ exerciseSlot: 'squat', completed: true }));
    const volumes = calculateWeeklyVolume([{ date: now.toISOString(), sets }], 1);
    const quads = volumes.find(v => v.muscleGroup === 'quads');
    expect(quads!.zone).toBe('excessive');
    const over = getOvertrainedMuscles(volumes);
    expect(over.length).toBeGreaterThan(0);
  });

  it('should have volume landmarks from peer-reviewed sources', () => {
    // Verify key muscle groups have reasonable MEV/MAV/MRV
    const volumes = calculateWeeklyVolume([], 1);
    const quads = volumes.find(v => v.muscleGroup === 'quads');
    expect(quads!.mev).toBe(8);
    expect(quads!.mav).toBe(15);
    expect(quads!.mrv).toBe(20);
  });
});
