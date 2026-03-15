/**
 * Meet prep week planner: generates a periodized taper plan
 * leading into a powerlifting meet.
 */

export interface MeetPrepPlan {
  meetDate: string;
  weeksOut: number;
  weeks: MeetPrepWeek[];
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
 */
export function generateMeetPrepPlan(
  meetDate: string,
  estimated1RM: number,
  unit: string,
  currentDate?: string,
): MeetPrepPlan {
  const now = currentDate ? new Date(currentDate) : new Date();
  const meet = new Date(meetDate);
  const diffMs = meet.getTime() - now.getTime();
  const weeksOut = Math.max(1, Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000)));

  const weeks: MeetPrepWeek[] = [];

  // Round weight to nearest plate increment
  const round = (w: number): number => {
    const increment = unit === 'lbs' ? 5 : 2.5;
    return Math.round(w / increment) * increment;
  };

  // 4-week taper template
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
      // Meet week: opener only
      weeks.push({
        weekNumber: w,
        label: 'Meet week - opener only',
        sets: 1,
        reps: '1',
        intensityPct: 87,
        weight: round(estimated1RM * 0.87),
      });
    } else if (w <= 4) {
      // Taper weeks (w=2 is week -1, w=3 is week -2, etc.)
      const taperIdx = w - 2; // 0=heavy singles, 1=heavy doubles, 2=mod triples
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

  return { meetDate, weeksOut, weeks };
}
