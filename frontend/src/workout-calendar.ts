/**
 * Workout calendar: monthly grid view of training history + streak tracking.
 * Every competitor app (Hevy, Strong, JEFIT, Boostcamp, Juggernaut) has this.
 */

export interface CalendarDay {
  date: string;       // YYYY-MM-DD
  dayOfMonth: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  workouts: Array<{
    programName: string;
    dayName: string;
    exerciseCount: number;
    setCount: number;
  }>;
}

export interface CalendarMonth {
  year: number;
  month: number;       // 0-11
  label: string;       // "March 2026"
  days: CalendarDay[];
  workoutCount: number;
  totalDays: number;
}

export interface StreakData {
  currentStreak: number;       // consecutive weeks with target workouts met
  longestStreak: number;
  workoutsThisWeek: number;
  targetPerWeek: number;
  totalWorkouts: number;
  averagePerWeek: number;
  /** Consistency score: % of weeks that met target */
  consistencyPercent: number;
}

/**
 * Build a calendar month from workout logs.
 */
export function buildCalendarMonth(
  year: number,
  month: number,
  logs: Array<{ date: string; programId?: string; workoutDayName?: string; sets?: Array<{ completed?: boolean }> }>,
): CalendarMonth {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // Build day-to-workouts map
  const workoutsByDate: Record<string, CalendarDay['workouts']> = {};
  for (const log of logs) {
    const dateStr = log.date.slice(0, 10);
    if (!workoutsByDate[dateStr]) workoutsByDate[dateStr] = [];
    workoutsByDate[dateStr].push({
      programName: log.programId ?? '',
      dayName: log.workoutDayName ?? '',
      exerciseCount: 0,
      setCount: log.sets?.filter(s => s.completed).length ?? 0,
    });
  }

  const days: CalendarDay[] = [];
  let workoutCount = 0;

  // Pad start of month to begin on Sunday
  const startPad = firstDay.getDay();
  for (let i = startPad - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    const dateStr = d.toISOString().slice(0, 10);
    days.push({
      date: dateStr,
      dayOfMonth: d.getDate(),
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      workouts: workoutsByDate[dateStr] ?? [],
    });
  }

  // Days of the month
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date = new Date(year, month, d);
    const dateStr = date.toISOString().slice(0, 10);
    const workouts = workoutsByDate[dateStr] ?? [];
    if (workouts.length > 0) workoutCount++;
    days.push({
      date: dateStr,
      dayOfMonth: d,
      isCurrentMonth: true,
      isToday: dateStr === todayStr,
      workouts,
    });
  }

  // Pad end to complete the week
  const endPad = 7 - (days.length % 7);
  if (endPad < 7) {
    for (let i = 1; i <= endPad; i++) {
      const d = new Date(year, month + 1, i);
      const dateStr = d.toISOString().slice(0, 10);
      days.push({
        date: dateStr,
        dayOfMonth: d.getDate(),
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
        workouts: workoutsByDate[dateStr] ?? [],
      });
    }
  }

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  return {
    year,
    month,
    label: `${monthNames[month]} ${year}`,
    days,
    workoutCount,
    totalDays: lastDay.getDate(),
  };
}

/**
 * Calculate training streak and consistency data.
 */
export function calculateStreak(
  logs: Array<{ date: string }>,
  targetPerWeek: number = 3,
): StreakData {
  if (logs.length === 0) {
    return {
      currentStreak: 0, longestStreak: 0, workoutsThisWeek: 0,
      targetPerWeek, totalWorkouts: 0, averagePerWeek: 0, consistencyPercent: 0,
    };
  }

  // Group workouts by ISO week
  const weekMap: Record<string, number> = {};
  const now = new Date();
  let earliestDate = now;

  for (const log of logs) {
    const d = new Date(log.date);
    if (d < earliestDate) earliestDate = d;
    const weekKey = getISOWeekKey(d);
    weekMap[weekKey] = (weekMap[weekKey] ?? 0) + 1;
  }

  // Current week workouts
  const thisWeekKey = getISOWeekKey(now);
  const workoutsThisWeek = weekMap[thisWeekKey] ?? 0;

  // Calculate streaks (consecutive weeks meeting target)
  const totalWeeks = Math.max(1, Math.ceil((now.getTime() - earliestDate.getTime()) / (7 * 86400000)));

  // Current streak: count consecutive weeks meeting target, starting from this week
  let currentStreak = 0;
  for (let i = 0; i < totalWeeks; i++) {
    const weekDate = new Date(now.getTime() - i * 7 * 86400000);
    const weekKey = getISOWeekKey(weekDate);
    if ((weekMap[weekKey] ?? 0) >= targetPerWeek) {
      currentStreak++;
    } else {
      break; // Streak broken
    }
  }

  // Longest streak: scan all weeks
  let longestStreak = 0;
  let tempStreak = 0;
  let weeksMetTarget = 0;
  for (let i = 0; i < totalWeeks; i++) {
    const weekDate = new Date(now.getTime() - i * 7 * 86400000);
    const weekKey = getISOWeekKey(weekDate);
    if ((weekMap[weekKey] ?? 0) >= targetPerWeek) {
      tempStreak++;
      weeksMetTarget++;
      longestStreak = Math.max(longestStreak, tempStreak);
    } else {
      tempStreak = 0;
    }
  }

  return {
    currentStreak,
    longestStreak,
    workoutsThisWeek,
    targetPerWeek,
    totalWorkouts: logs.length,
    averagePerWeek: Math.round((logs.length / Math.max(totalWeeks, 1)) * 10) / 10,
    consistencyPercent: Math.round((weeksMetTarget / Math.max(totalWeeks, 1)) * 100),
  };
}

function getISOWeekKey(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}
