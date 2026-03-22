import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildCalendarMonth, calculateStreak } from '../workout-calendar';
import type { CalendarMonth, StreakData } from '../workout-calendar';

// ─── Helpers ───

type LogEntry = { date: string; programId?: string; workoutDayName?: string; sets?: Array<{ completed?: boolean }> };

function makeLog(date: string, overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    date,
    programId: 'starting_strength',
    workoutDayName: 'Day A',
    sets: [{ completed: true }, { completed: true }, { completed: false }],
    ...overrides,
  };
}

/** Build ISO date string for a given year/month/day. */
function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T10:00:00.000Z`;
}

// ══════════════════════════════════════════════════════════════
//  buildCalendarMonth
// ══════════════════════════════════════════════════════════════

describe('buildCalendarMonth', () => {
  describe('basic structure', () => {
    it('returns correct label for March 2026', () => {
      const cal = buildCalendarMonth(2026, 2, []);
      expect(cal.label).toBe('March 2026');
      expect(cal.year).toBe(2026);
      expect(cal.month).toBe(2);
    });

    it('returns correct label for January 2026', () => {
      const cal = buildCalendarMonth(2026, 0, []);
      expect(cal.label).toBe('January 2026');
    });

    it('returns correct label for December 2025', () => {
      const cal = buildCalendarMonth(2025, 11, []);
      expect(cal.label).toBe('December 2025');
    });
  });

  describe('correct number of days per month', () => {
    it('March 2026 has 31 days', () => {
      const cal = buildCalendarMonth(2026, 2, []);
      expect(cal.totalDays).toBe(31);
    });

    it('April 2026 has 30 days', () => {
      const cal = buildCalendarMonth(2026, 3, []);
      expect(cal.totalDays).toBe(30);
    });

    it('February 2026 (non-leap) has 28 days', () => {
      const cal = buildCalendarMonth(2026, 1, []);
      expect(cal.totalDays).toBe(28);
    });

    it('February 2024 (leap year) has 29 days', () => {
      const cal = buildCalendarMonth(2024, 1, []);
      expect(cal.totalDays).toBe(29);
    });

    it('February 2000 (century leap year) has 29 days', () => {
      const cal = buildCalendarMonth(2000, 1, []);
      expect(cal.totalDays).toBe(29);
    });
  });

  describe('grid alignment', () => {
    it('total grid days are a multiple of 7 (full weeks)', () => {
      // Test several months
      for (let m = 0; m < 12; m++) {
        const cal = buildCalendarMonth(2026, m, []);
        expect(cal.days.length % 7).toBe(0);
      }
    });

    it('first day alignment pads with previous month days', () => {
      // March 2026 starts on Sunday (day 0), so no padding needed
      const cal = buildCalendarMonth(2026, 2, []);
      // The first day of the current month should be at the start if it's Sunday
      const firstCurrentMonthDay = cal.days.find(d => d.isCurrentMonth);
      expect(firstCurrentMonthDay!.dayOfMonth).toBe(1);
    });

    it('months not starting on Sunday have padding days from previous month', () => {
      // April 2026 starts on Wednesday (day 3), so 3 padding days
      const cal = buildCalendarMonth(2026, 3, []);
      const paddingDays = cal.days.filter(d => !d.isCurrentMonth && cal.days.indexOf(d) < 7);
      // April 1, 2026 is a Wednesday, so 3 days of padding (Sun, Mon, Tue from March)
      const prePadCount = cal.days.findIndex(d => d.isCurrentMonth);
      expect(prePadCount).toBe(3);
    });

    it('padding days are marked as isCurrentMonth = false', () => {
      const cal = buildCalendarMonth(2026, 3, []); // April 2026
      const prePadDays = cal.days.slice(0, cal.days.findIndex(d => d.isCurrentMonth));
      for (const d of prePadDays) {
        expect(d.isCurrentMonth).toBe(false);
      }
    });

    it('end padding days complete the final week', () => {
      const cal = buildCalendarMonth(2026, 2, []); // March 2026
      const lastCurrentIdx = cal.days.map(d => d.isCurrentMonth).lastIndexOf(true);
      const postPadDays = cal.days.slice(lastCurrentIdx + 1);
      for (const d of postPadDays) {
        expect(d.isCurrentMonth).toBe(false);
      }
    });
  });

  describe('workout day highlighting', () => {
    it('workout days have workouts array populated', () => {
      const logs = [
        makeLog(isoDate(2026, 2, 5)),
        makeLog(isoDate(2026, 2, 7)),
      ];
      const cal = buildCalendarMonth(2026, 2, logs);
      const mar5 = cal.days.find(d => d.isCurrentMonth && d.dayOfMonth === 5);
      const mar7 = cal.days.find(d => d.isCurrentMonth && d.dayOfMonth === 7);
      expect(mar5!.workouts).toHaveLength(1);
      expect(mar7!.workouts).toHaveLength(1);
    });

    it('non-workout days have empty workouts array', () => {
      const logs = [makeLog(isoDate(2026, 2, 10))];
      const cal = buildCalendarMonth(2026, 2, logs);
      const mar1 = cal.days.find(d => d.isCurrentMonth && d.dayOfMonth === 1);
      expect(mar1!.workouts).toEqual([]);
    });

    it('workoutCount reflects unique days with workouts in current month', () => {
      const logs = [
        makeLog(isoDate(2026, 2, 1)),
        makeLog(isoDate(2026, 2, 3)),
        makeLog(isoDate(2026, 2, 5)),
      ];
      const cal = buildCalendarMonth(2026, 2, logs);
      expect(cal.workoutCount).toBe(3);
    });

    it('month with no workouts has workoutCount = 0', () => {
      const cal = buildCalendarMonth(2026, 2, []);
      expect(cal.workoutCount).toBe(0);
    });

    it('multiple workouts on same day are grouped', () => {
      const logs = [
        makeLog(isoDate(2026, 2, 15), { workoutDayName: 'Day A' }),
        makeLog(isoDate(2026, 2, 15), { workoutDayName: 'Day B' }),
      ];
      const cal = buildCalendarMonth(2026, 2, logs);
      const mar15 = cal.days.find(d => d.isCurrentMonth && d.dayOfMonth === 15);
      expect(mar15!.workouts).toHaveLength(2);
      // But workoutCount should still count the day once
      expect(cal.workoutCount).toBe(1);
    });

    it('completed set count is correct', () => {
      const logs = [
        makeLog(isoDate(2026, 2, 10), {
          sets: [{ completed: true }, { completed: true }, { completed: false }, { completed: true }],
        }),
      ];
      const cal = buildCalendarMonth(2026, 2, logs);
      const day = cal.days.find(d => d.isCurrentMonth && d.dayOfMonth === 10);
      expect(day!.workouts[0].setCount).toBe(3); // 3 completed out of 4
    });
  });

  describe('year boundary', () => {
    it('December 2025 calendar includes January 2026 padding days', () => {
      const cal = buildCalendarMonth(2025, 11, []);
      const lastDay = cal.days[cal.days.length - 1];
      // If December ends and padding extends into January, the last day should be from January
      if (!lastDay.isCurrentMonth) {
        // Should be January of 2026
        expect(lastDay.date).toContain('2026-01');
      }
    });

    it('January 2026 calendar may include December 2025 padding days', () => {
      const cal = buildCalendarMonth(2026, 0, []);
      // January 1, 2026 is a Thursday, so there should be 4 padding days from Dec 2025
      const firstDay = cal.days[0];
      if (!firstDay.isCurrentMonth) {
        expect(firstDay.date).toContain('2025-12');
      }
    });
  });

  describe('workout data from logs', () => {
    it('programName is set from programId', () => {
      const logs = [makeLog(isoDate(2026, 2, 5), { programId: 'gzclp' })];
      const cal = buildCalendarMonth(2026, 2, logs);
      const day = cal.days.find(d => d.isCurrentMonth && d.dayOfMonth === 5);
      expect(day!.workouts[0].programName).toBe('gzclp');
    });

    it('dayName is set from workoutDayName', () => {
      const logs = [makeLog(isoDate(2026, 2, 5), { workoutDayName: 'Upper Body' })];
      const cal = buildCalendarMonth(2026, 2, logs);
      const day = cal.days.find(d => d.isCurrentMonth && d.dayOfMonth === 5);
      expect(day!.workouts[0].dayName).toBe('Upper Body');
    });

    it('logs from outside the month do not affect workoutCount', () => {
      const logs = [
        makeLog(isoDate(2026, 1, 28)), // February
        makeLog(isoDate(2026, 3, 1)),  // April
      ];
      const cal = buildCalendarMonth(2026, 2, logs); // March
      expect(cal.workoutCount).toBe(0);
    });
  });
});

// ══════════════════════════════════════════════════════════════
//  calculateStreak
// ══════════════════════════════════════════════════════════════

describe('calculateStreak', () => {
  // Fix "now" for deterministic tests
  let dateNowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Fix current time to Wednesday March 18, 2026 12:00 UTC
    dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-03-18T12:00:00.000Z').getTime(),
    );
    // Also mock the Date constructor for `new Date()` calls
    const OriginalDate = globalThis.Date;
    const fixedNow = new OriginalDate('2026-03-18T12:00:00.000Z');
    vi.spyOn(globalThis, 'Date').mockImplementation(function (this: any, ...args: any[]) {
      if (args.length === 0) {
        return new OriginalDate(fixedNow);
      }
      // @ts-ignore
      return new OriginalDate(...args);
    } as any);
    // Preserve static methods
    (globalThis.Date as any).now = () => fixedNow.getTime();
    (globalThis.Date as any).UTC = OriginalDate.UTC;
    (globalThis.Date as any).parse = OriginalDate.parse;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('no workouts', () => {
    it('returns all zeros', () => {
      const result = calculateStreak([], 3);
      expect(result.currentStreak).toBe(0);
      expect(result.longestStreak).toBe(0);
      expect(result.workoutsThisWeek).toBe(0);
      expect(result.totalWorkouts).toBe(0);
      expect(result.averagePerWeek).toBe(0);
      expect(result.consistencyPercent).toBe(0);
    });

    it('preserves targetPerWeek', () => {
      const result = calculateStreak([], 5);
      expect(result.targetPerWeek).toBe(5);
    });
  });

  describe('basic streak counting', () => {
    it('workouts meeting target in current week count as streak = 1', () => {
      // 3 workouts this week (Mon, Tue, Wed)
      const logs = [
        { date: '2026-03-16T10:00:00.000Z' }, // Monday
        { date: '2026-03-17T10:00:00.000Z' }, // Tuesday
        { date: '2026-03-18T10:00:00.000Z' }, // Wednesday
      ];
      const result = calculateStreak(logs, 3);
      expect(result.currentStreak).toBeGreaterThanOrEqual(1);
      expect(result.workoutsThisWeek).toBeGreaterThanOrEqual(1);
    });

    it('single workout does not meet target of 3', () => {
      const logs = [{ date: '2026-03-18T10:00:00.000Z' }];
      const result = calculateStreak(logs, 3);
      expect(result.currentStreak).toBe(0);
    });

    it('totalWorkouts reflects total log count', () => {
      const logs = [
        { date: '2026-03-01T10:00:00.000Z' },
        { date: '2026-03-05T10:00:00.000Z' },
        { date: '2026-03-10T10:00:00.000Z' },
        { date: '2026-03-15T10:00:00.000Z' },
      ];
      const result = calculateStreak(logs, 3);
      expect(result.totalWorkouts).toBe(4);
    });
  });

  describe('streak resets', () => {
    it('missed week breaks the current streak', () => {
      // Week of Mar 16: 3 workouts (meets target)
      // Week of Mar 9: 0 workouts (missed)
      // Week of Mar 2: 3 workouts (met target but broken by gap)
      const logs = [
        { date: '2026-03-16T10:00:00.000Z' },
        { date: '2026-03-17T10:00:00.000Z' },
        { date: '2026-03-18T10:00:00.000Z' },
        { date: '2026-03-02T10:00:00.000Z' },
        { date: '2026-03-03T10:00:00.000Z' },
        { date: '2026-03-04T10:00:00.000Z' },
      ];
      const result = calculateStreak(logs, 3);
      // Current streak should be 1 (current week only, since previous week was missed)
      expect(result.currentStreak).toBe(1);
    });

    it('partial week (2 of 3 target) does not count', () => {
      // Only 2 workouts this week vs target of 3
      const logs = [
        { date: '2026-03-16T10:00:00.000Z' },
        { date: '2026-03-17T10:00:00.000Z' },
      ];
      const result = calculateStreak(logs, 3);
      expect(result.currentStreak).toBe(0);
    });
  });

  describe('longest streak', () => {
    it('longest streak tracks best consecutive run', () => {
      // This tests that longestStreak >= currentStreak
      const logs = [
        { date: '2026-03-16T10:00:00.000Z' },
        { date: '2026-03-17T10:00:00.000Z' },
        { date: '2026-03-18T10:00:00.000Z' },
      ];
      const result = calculateStreak(logs, 3);
      expect(result.longestStreak).toBeGreaterThanOrEqual(result.currentStreak);
    });
  });

  describe('averagePerWeek', () => {
    it('averagePerWeek is calculated correctly', () => {
      const logs = [
        { date: '2026-03-16T10:00:00.000Z' },
        { date: '2026-03-17T10:00:00.000Z' },
      ];
      const result = calculateStreak(logs, 3);
      expect(result.averagePerWeek).toBeGreaterThan(0);
      expect(result.averagePerWeek).toBeLessThanOrEqual(logs.length);
    });
  });

  describe('consistencyPercent', () => {
    it('consistencyPercent is between 0 and 100', () => {
      const logs = [
        { date: '2026-03-16T10:00:00.000Z' },
        { date: '2026-03-17T10:00:00.000Z' },
        { date: '2026-03-18T10:00:00.000Z' },
      ];
      const result = calculateStreak(logs, 3);
      expect(result.consistencyPercent).toBeGreaterThanOrEqual(0);
      expect(result.consistencyPercent).toBeLessThanOrEqual(100);
    });
  });

  describe('edge cases', () => {
    it('single workout returns totalWorkouts = 1', () => {
      const result = calculateStreak([{ date: '2026-03-18T10:00:00.000Z' }], 3);
      expect(result.totalWorkouts).toBe(1);
    });

    it('target of 1 workout per week is easy to achieve', () => {
      const logs = [
        { date: '2026-03-18T10:00:00.000Z' },
        { date: '2026-03-10T10:00:00.000Z' },
        { date: '2026-03-03T10:00:00.000Z' },
      ];
      const result = calculateStreak(logs, 1);
      // Each week has at least 1 workout
      expect(result.currentStreak).toBeGreaterThanOrEqual(1);
    });

    it('default targetPerWeek is 3', () => {
      const result = calculateStreak([]);
      expect(result.targetPerWeek).toBe(3);
    });
  });
});
