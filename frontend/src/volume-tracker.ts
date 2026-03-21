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
