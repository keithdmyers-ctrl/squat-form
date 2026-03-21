/**
 * Meet prep week planner: generates a periodized taper plan
 * leading into a powerlifting meet, with meet-day adrenaline factor support.
 */

import type { MeetDayStrategy } from './meet-prep';
import { getMeetDayFactor } from './meet-prep';

export interface MeetPrepPlan {
  meetDate: string;
  weeksOut: number;
  weeks: MeetPrepWeek[];
  meetDayStrategy?: MeetDayStrategy;
  meetDayFactor?: number;
  projectedMeetMax?: number;
}

export interface MeetPrepWeek {
  weekNumber: number;
  label: string;
  sets: number;
  reps: string;
  intensityPct: number;
  weight?: number;
}

/**
 * Generate a meet prep plan with a 4-week taper.
 * If >4 weeks out, fill earlier weeks with a strength phase.
 *
 * The meetDayStrategy parameter projects a meet-day performance boost:
 * - conservative (1.0): no boost — plan conservatively
 * - moderate (1.03): 3% boost — typical for experienced lifters
 * - aggressive (1.05): 5% boost — for peaked, confident lifters
 *
 * The adrenaline factor affects the projected meet max shown in the plan
 * and the meet-week opener weight (opener is based on projected meet max).
 */
export function generateMeetPrepPlan(
  meetDate: string,
  estimated1RM: number,
  unit: string,
  currentDate?: string,
  meetDayStrategy: MeetDayStrategy = 'moderate',
): MeetPrepPlan {
  const now = currentDate ? new Date(currentDate) : new Date();
  const meet = new Date(meetDate);
  const diffMs = meet.getTime() - now.getTime();
  const weeksOut = Math.max(1, Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000)));

  const factor = getMeetDayFactor(meetDayStrategy);
  const projectedMeetMax = Math.round(estimated1RM * factor * 10) / 10;

  const weeks: MeetPrepWeek[] = [];

  // Round weight to nearest plate increment
  const round = (w: number): number => {
    const increment = unit === 'lbs' ? 5 : 2.5;
    return Math.round(w / increment) * increment;
  };

  // 4-week taper template (intensities based on gym 1RM)
  const taper: Omit<MeetPrepWeek, 'weekNumber' | 'weight'>[] = [
    { label: 'Heavy singles', sets: 2, reps: '1', intensityPct: 93 },
    { label: 'Heavy doubles', sets: 3, reps: '2', intensityPct: 90 },
    { label: 'Moderate triples', sets: 4, reps: '3', intensityPct: 85 },
    // Earliest taper week (farthest from meet)
    { label: 'Volume block', sets: 4, reps: '3', intensityPct: 82 },
  ];

  // Build week plan from meet backwards
  for (let w = 1; w <= weeksOut; w++) {
    if (w === 1) {
      // Meet week: opener only, based on projected meet max
      const openerPct = 87;
      weeks.push({
        weekNumber: w,
        label: 'Meet week - opener only',
        sets: 1,
        reps: '1',
        intensityPct: openerPct,
        weight: round(projectedMeetMax * openerPct / 100),
      });
    } else if (w <= 4) {
      // Taper weeks based on gym 1RM (not boosted — training is done pre-adrenaline)
      const taperIdx = w - 2;
      const t = taper[taperIdx];
      weeks.push({
        weekNumber: w,
        label: `Week -${w - 1}: ${t.label}`,
        sets: t.sets,
        reps: t.reps,
        intensityPct: t.intensityPct,
        weight: round(estimated1RM * t.intensityPct / 100),
      });
    } else {
      // Strength phase (before taper)
      const pct = 80;
      weeks.push({
        weekNumber: w,
        label: `Week -${w - 1}: Strength phase`,
        sets: 4,
        reps: '4-5',
        intensityPct: pct,
        weight: round(estimated1RM * pct / 100),
      });
    }
  }

  // Reverse so earliest week first (chronological order)
  weeks.reverse();

  return {
    meetDate,
    weeksOut,
    weeks,
    meetDayStrategy,
    meetDayFactor: factor,
    projectedMeetMax,
  };
}
