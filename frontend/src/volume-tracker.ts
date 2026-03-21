/**
 * Muscle group volume tracker.
 * Aggregates weekly sets per muscle group from workout logs.
 * Used for heat map visualization and balance analysis.
 *
 * Volume landmarks per Israetel/RP (Schoenfeld et al. 2017):
 * - MEV (Minimum Effective Volume): ~6-8 sets/week
 * - MAV (Maximum Adaptive Volume): ~12-20 sets/week
 * - MRV (Maximum Recoverable Volume): ~20-25 sets/week
 */

import { EXERCISE_SLOTS } from './workout-programs';

export interface MuscleVolume {
  muscleGroup: string;
  label: string;
  weeklySets: number;
  /** Volume zone: under (< MEV), optimal (MEV-MAV), high (MAV-MRV), excessive (> MRV) */
  zone: 'under' | 'optimal' | 'high' | 'excessive';
  mev: number;
  mav: number;
  mrv: number;
}

/** Volume landmarks by muscle group (sets per week).
 * Source: Israetel, Hoffmann, & Smith (2021). Scientific Principles of Hypertrophy Training.
 * Schoenfeld et al. (2017, PMID: 28834797): dose-response for volume.
 */
const VOLUME_LANDMARKS: Record<string, { label: string; mev: number; mav: number; mrv: number }> = {
  quads:       { label: 'Quads',         mev: 8,  mav: 15, mrv: 20 },
  hamstrings:  { label: 'Hamstrings',    mev: 6,  mav: 12, mrv: 18 },
  glutes:      { label: 'Glutes',        mev: 4,  mav: 12, mrv: 16 },
  chest:       { label: 'Chest',         mev: 6,  mav: 14, mrv: 22 },
  back:        { label: 'Back',          mev: 8,  mav: 16, mrv: 22 },
  shoulders:   { label: 'Shoulders',     mev: 6,  mav: 14, mrv: 20 },
  front_delts: { label: 'Front Delts',   mev: 0,  mav: 8,  mrv: 12 },
  rear_delts:  { label: 'Rear Delts',    mev: 6,  mav: 16, mrv: 22 },
  upper_back:  { label: 'Upper Back',    mev: 6,  mav: 14, mrv: 20 },
  triceps:     { label: 'Triceps',       mev: 4,  mav: 12, mrv: 18 },
  biceps:      { label: 'Biceps',        mev: 5,  mav: 14, mrv: 20 },
  core:        { label: 'Core',          mev: 4,  mav: 12, mrv: 16 },
  lower_back:  { label: 'Lower Back',    mev: 2,  mav: 8,  mrv: 12 },
};

/**
 * Calculate weekly sets per muscle group from recent workout logs.
 */
export function calculateWeeklyVolume(
  logs: Array<{ date: string; sets: Array<{ exerciseSlot: string; completed: boolean }> }>,
  weeksToAverage: number = 1,
): MuscleVolume[] {
  const now = new Date();
  const cutoff = new Date(now.getTime() - weeksToAverage * 7 * 86400000);

  // Count completed sets per exercise slot in the time window
  const setsPerSlot: Record<string, number> = {};
  const recentLogs = logs.filter(l => new Date(l.date) >= cutoff);

  for (const log of recentLogs) {
    for (const set of log.sets) {
      if (set.completed) {
        setsPerSlot[set.exerciseSlot] = (setsPerSlot[set.exerciseSlot] ?? 0) + 1;
      }
    }
  }

  // Map exercise slots to muscle groups
  const setsPerMuscle: Record<string, number> = {};
  for (const [slot, count] of Object.entries(setsPerSlot)) {
    const exerciseSlot = EXERCISE_SLOTS[slot];
    if (exerciseSlot) {
      for (const muscle of exerciseSlot.muscleGroups) {
        setsPerMuscle[muscle] = (setsPerMuscle[muscle] ?? 0) + count;
      }
    }
  }

  // Normalize to per-week
  const weeklyScale = 1 / Math.max(weeksToAverage, 1);

  // Build volume data for all tracked muscle groups
  const result: MuscleVolume[] = [];
  for (const [key, landmarks] of Object.entries(VOLUME_LANDMARKS)) {
    const weeklySets = Math.round((setsPerMuscle[key] ?? 0) * weeklyScale);
    let zone: MuscleVolume['zone'] = 'under';
    if (weeklySets >= landmarks.mrv) zone = 'excessive';
    else if (weeklySets >= landmarks.mav) zone = 'high';
    else if (weeklySets >= landmarks.mev) zone = 'optimal';

    result.push({
      muscleGroup: key,
      label: landmarks.label,
      weeklySets,
      zone,
      mev: landmarks.mev,
      mav: landmarks.mav,
      mrv: landmarks.mrv,
    });
  }

  // Sort: most volume first
  result.sort((a, b) => b.weeklySets - a.weeklySets);
  return result;
}

/**
 * Get muscle groups that are below MEV (potential weak points).
 */
export function getUndertrainedMuscles(volumes: MuscleVolume[]): MuscleVolume[] {
  return volumes.filter(v => v.zone === 'under' && v.mev > 0);
}

/**
 * Get muscle groups that are above MRV (risk of overtraining).
 */
export function getOvertrainedMuscles(volumes: MuscleVolume[]): MuscleVolume[] {
  return volumes.filter(v => v.zone === 'excessive');
}

// ─── Task 6.4: Mesocycle Volume Progression ───

/**
 * Track volume progression across a mesocycle (typically 4-6 weeks).
 * Volume should start near MEV in week 1 and build toward MRV by the final week,
 * then deload.
 *
 * Reference: Israetel, "Scientific Principles of Hypertrophy Training" (2020)
 */
export interface MesocycleVolume {
  weekNumber: number;         // 1-based week within the mesocycle
  mesocycleLength: number;    // total weeks (typically 4-6)
  muscleGroup: string;
  currentSets: number;        // actual sets this week
  targetSets: number;         // recommended sets this week
  mev: number;                // minimum effective volume
  mav: number;                // maximum adaptive volume
  mrv: number;                // maximum recoverable volume
  progression: 'on_track' | 'under' | 'over' | 'deload_needed';
}

/**
 * Calculate progressive volume targets for each week of a mesocycle.
 * Week 1 starts at MEV, builds linearly to MRV by week N-1, week N is deload.
 *
 * Reference: Israetel, "Scientific Principles of Hypertrophy Training" (2020)
 */
export function calculateMesocycleTargets(
  muscleGroup: string,
  mesocycleLength: number,
  weekNumber: number,
): { targetSets: number; zone: 'mev' | 'building' | 'mrv' | 'deload' } {
  const landmarks = VOLUME_LANDMARKS[muscleGroup];
  if (!landmarks) {
    return { targetSets: 0, zone: 'mev' };
  }

  const { mev, mrv } = landmarks;

  // Clamp inputs
  const len = Math.max(2, mesocycleLength);
  const week = Math.max(1, Math.min(weekNumber, len));

  // Week N (final week) is deload: half of MEV
  if (week === len) {
    return { targetSets: Math.round(mev * 0.5), zone: 'deload' };
  }

  // Week 1: MEV
  if (week === 1) {
    return { targetSets: mev, zone: 'mev' };
  }

  // Week 2 through N-1: linearly interpolate between MEV and MRV
  // At week 1 -> MEV, at week (N-1) -> MRV
  const trainingWeeks = len - 1; // number of non-deload weeks
  if (trainingWeeks <= 1) return { targetSets: mev, zone: 'mev' };
  const frac = (week - 1) / (trainingWeeks - 1);
  const target = Math.round(mev + frac * (mrv - mev));

  // Determine zone
  if (frac >= 0.95) {
    return { targetSets: target, zone: 'mrv' };
  }
  return { targetSets: target, zone: 'building' };
}

/**
 * Assess whether current training volume is progressing appropriately
 * within the mesocycle.
 *
 * Reference: Israetel, "Scientific Principles of Hypertrophy Training" (2020)
 */
export function assessVolumeProgression(
  weeklyVolumes: Array<{ week: number; muscleGroup: string; sets: number }>,
  mesocycleLength: number,
): MesocycleVolume[] {
  const results: MesocycleVolume[] = [];

  for (const entry of weeklyVolumes) {
    const landmarks = VOLUME_LANDMARKS[entry.muscleGroup];
    if (!landmarks) continue;

    const { mev, mav, mrv } = landmarks;
    const { targetSets } = calculateMesocycleTargets(
      entry.muscleGroup,
      mesocycleLength,
      entry.week,
    );

    let progression: MesocycleVolume['progression'];
    if (entry.sets > mrv) {
      progression = 'over';
    } else if (entry.sets < targetSets - 2) {
      progression = 'under';
    } else if (entry.sets >= targetSets - 2 && entry.sets <= targetSets + 2) {
      progression = 'on_track';
    } else {
      // sets > targetSets + 2 but <= mrv: still on track (doing more is fine if under MRV)
      progression = 'on_track';
    }

    results.push({
      weekNumber: entry.week,
      mesocycleLength,
      muscleGroup: entry.muscleGroup,
      currentSets: entry.sets,
      targetSets,
      mev,
      mav,
      mrv,
      progression,
    });
  }

  return results;
}

// ─── Task 6.5: Frequency Distribution Analysis ───

/**
 * Analyze how training volume is distributed across the week.
 * 10 sets in one session is inferior to 5 sets across two sessions.
 *
 * Reference: Schoenfeld et al. (2016) - Effects of Resistance Training Frequency
 */
export interface FrequencyAnalysis {
  muscleGroup: string;
  totalWeeklySets: number;
  sessionsPerWeek: number;
  setsPerSession: number;    // average
  maxSetsInOneSession: number;
  recommendation: string;
  optimal: boolean;          // true if frequency is adequate for the volume
}

export function analyzeFrequencyDistribution(
  weeklyLogs: Array<{ date: string; sets: Array<{ exerciseSlot: string; completed: boolean }> }>,
  weeksBack: number = 1,
): FrequencyAnalysis[] {
  const now = new Date();
  const cutoff = new Date(now.getTime() - weeksBack * 7 * 86400000);
  const recentLogs = weeklyLogs.filter(l => new Date(l.date) >= cutoff);

  // Build per-muscle-group per-session counts
  // muscleGroup -> date -> sets count
  const muscleSessionMap: Record<string, Record<string, number>> = {};

  for (const log of recentLogs) {
    const dateKey = log.date.slice(0, 10); // YYYY-MM-DD
    for (const set of log.sets) {
      if (!set.completed) continue;
      const exerciseSlot = EXERCISE_SLOTS[set.exerciseSlot];
      if (!exerciseSlot) continue;
      for (const muscle of exerciseSlot.muscleGroups) {
        if (!muscleSessionMap[muscle]) muscleSessionMap[muscle] = {};
        muscleSessionMap[muscle][dateKey] = (muscleSessionMap[muscle][dateKey] ?? 0) + 1;
      }
    }
  }

  const results: FrequencyAnalysis[] = [];
  const weeklyScale = 1 / Math.max(weeksBack, 1);

  for (const [muscle, sessionMap] of Object.entries(muscleSessionMap)) {
    const sessions = Object.values(sessionMap);
    const totalSets = sessions.reduce((s, n) => s + n, 0);
    const weeklySets = Math.round(totalSets * weeklyScale);
    const sessionsPerWeek = Math.round(sessions.length * weeklyScale);
    const maxInOneSession = Math.max(...sessions);
    const avgPerSession = sessionsPerWeek > 0 ? weeklySets / sessionsPerWeek : weeklySets;

    // Determine optimal frequency per Schoenfeld (2016)
    let minSessions: number;
    if (weeklySets <= 8) {
      minSessions = 1;
    } else if (weeklySets <= 14) {
      minSessions = 2;
    } else if (weeklySets <= 20) {
      minSessions = 3;
    } else {
      minSessions = 4;
    }

    const tooManySetsPerSession = maxInOneSession > 10;
    const optimal = sessionsPerWeek >= minSessions && !tooManySetsPerSession;

    let recommendation: string;
    if (optimal) {
      recommendation = `Volume is well-distributed across ${sessionsPerWeek} session${sessionsPerWeek !== 1 ? 's' : ''}.`;
    } else if (tooManySetsPerSession && sessionsPerWeek < minSessions) {
      recommendation = `${maxInOneSession} sets in one session is excessive. Split across ${minSessions}+ sessions for better recovery and growth.`;
    } else if (tooManySetsPerSession) {
      recommendation = `${maxInOneSession} sets in one session is high. Distribute more evenly across your training days.`;
    } else {
      recommendation = `${weeklySets} weekly sets would benefit from ${minSessions}+ sessions per week (currently ${sessionsPerWeek}).`;
    }

    const label = VOLUME_LANDMARKS[muscle]?.label ?? muscle;
    results.push({
      muscleGroup: label,
      totalWeeklySets: weeklySets,
      sessionsPerWeek,
      setsPerSession: Math.round(avgPerSession * 10) / 10,
      maxSetsInOneSession: maxInOneSession,
      recommendation,
      optimal,
    });
  }

  // Sort by least optimal first (problems at top)
  results.sort((a, b) => {
    if (a.optimal !== b.optimal) return a.optimal ? 1 : -1;
    return b.totalWeeklySets - a.totalWeeklySets;
  });

  return results;
}

// ─── Task 6.8: Individualize Volume Landmarks ───

/**
 * Adjust volume landmarks based on individual factors.
 *
 * References:
 * - Israetel, "Scientific Principles of Hypertrophy Training" (2020)
 * - Schoenfeld et al. (2017) - Dose-response relationship
 */
export function individualizeVolumeLandmarks(
  muscleGroup: string,
  factors: {
    trainingAge?: number;      // years of consistent training (0-10+)
    bodyweight?: number;       // in whatever unit
    recoveryCapacity?: 'low' | 'normal' | 'high';
    age?: number;              // chronological age
    sex?: 'male' | 'female';
  },
): { mev: number; mav: number; mrv: number } {
  const landmarks = VOLUME_LANDMARKS[muscleGroup];
  if (!landmarks) {
    return { mev: 6, mav: 12, mrv: 20 };
  }

  let mev = landmarks.mev;
  let mav = landmarks.mav;
  let mrv = landmarks.mrv;

  // Training age adjustments
  if (factors.trainingAge !== undefined) {
    if (factors.trainingAge < 1) {
      // Beginners need less volume: reduce all by 20%
      mev *= 0.80;
      mav *= 0.80;
      mrv *= 0.80;
    } else if (factors.trainingAge > 5) {
      // Advanced lifters can handle more: increase MRV by 15%
      mrv *= 1.15;
    }
  }

  // Recovery capacity adjustments
  if (factors.recoveryCapacity === 'low') {
    mrv *= 0.80;
    mav *= 0.90;
  } else if (factors.recoveryCapacity === 'high') {
    mrv *= 1.10;
  }

  // Chronological age adjustments
  if (factors.age !== undefined) {
    if (factors.age > 50) {
      mrv *= 0.80;
      mav *= 0.90;
    } else if (factors.age > 40) {
      mrv *= 0.90;
    }
  }

  // Sex adjustment
  if (factors.sex === 'female') {
    mrv *= 1.10;
  }

  // Round to integers
  mev = Math.round(mev);
  mav = Math.round(mav);
  mrv = Math.round(mrv);

  // Clamp: MEV >= 4, MRV <= 30
  mev = Math.max(4, mev);
  mrv = Math.min(30, mrv);

  // Ensure ordering: mev <= mav <= mrv
  if (mav < mev) mav = mev;
  if (mrv < mav) mrv = mav;

  return { mev, mav, mrv };
}
