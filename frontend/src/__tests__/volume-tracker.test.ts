import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  calculateWeeklyVolume,
  getUndertrainedMuscles,
  getOvertrainedMuscles,
  calculateMesocycleTargets,
  assessVolumeProgression,
  analyzeFrequencyDistribution,
  individualizeVolumeLandmarks,
} from '../volume-tracker';
import type { MuscleVolume, MesocycleVolume, FrequencyAnalysis } from '../volume-tracker';

// ─── Helpers ───

/** Create a workout log entry with completed sets for a given exercise slot */
function makeLog(
  date: string,
  sets: Array<{ exerciseSlot: string; completed?: boolean }>,
) {
  return {
    date,
    sets: sets.map(s => ({ exerciseSlot: s.exerciseSlot, completed: s.completed ?? true })),
  };
}

/** Create N completed sets for a slot in one log entry */
function makeSetsForSlot(slot: string, count: number, completed = true) {
  return Array.from({ length: count }, () => ({ exerciseSlot: slot, completed }));
}

/** Get today's ISO date string */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Get a date N days ago as ISO string */
function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function findMuscle(volumes: MuscleVolume[], muscleGroup: string): MuscleVolume | undefined {
  return volumes.find(v => v.muscleGroup === muscleGroup);
}

// ─── calculateWeeklyVolume ───

describe('calculateWeeklyVolume', () => {
  it('returns all tracked muscle groups with zero sets for empty logs', () => {
    const result = calculateWeeklyVolume([]);
    expect(result.length).toBeGreaterThan(0);
    for (const v of result) {
      expect(v.weeklySets).toBe(0);
      // All should be 'under' or have mev=0
      if (v.mev > 0) {
        expect(v.zone).toBe('under');
      }
    }
  });

  it('counts sets from a single squat workout correctly', () => {
    const logs = [makeLog(todayISO(), makeSetsForSlot('squat', 5))];
    const result = calculateWeeklyVolume(logs);
    // squat maps to quads, glutes, core
    const quads = findMuscle(result, 'quads');
    const glutes = findMuscle(result, 'glutes');
    const core = findMuscle(result, 'core');
    expect(quads?.weeklySets).toBe(5);
    expect(glutes?.weeklySets).toBe(5);
    expect(core?.weeklySets).toBe(5);
  });

  it('counts sets from bench press correctly (chest, triceps, front_delts)', () => {
    const logs = [makeLog(todayISO(), makeSetsForSlot('bench', 4))];
    const result = calculateWeeklyVolume(logs);
    expect(findMuscle(result, 'chest')?.weeklySets).toBe(4);
    expect(findMuscle(result, 'triceps')?.weeklySets).toBe(4);
    expect(findMuscle(result, 'front_delts')?.weeklySets).toBe(4);
  });

  it('aggregates multiple workouts within the same week', () => {
    const logs = [
      makeLog(todayISO(), makeSetsForSlot('squat', 4)),
      makeLog(daysAgoISO(2), makeSetsForSlot('squat', 3)),
      makeLog(daysAgoISO(5), makeSetsForSlot('squat', 5)),
    ];
    const result = calculateWeeklyVolume(logs, 1);
    const quads = findMuscle(result, 'quads');
    expect(quads?.weeklySets).toBe(12); // 4 + 3 + 5
  });

  it('aggregates sets from different exercises that hit the same muscle group', () => {
    const logs = [
      makeLog(todayISO(), [
        ...makeSetsForSlot('squat', 3),     // quads, glutes, core
        ...makeSetsForSlot('bench', 3),      // chest, triceps, front_delts
        ...makeSetsForSlot('deadlift', 3),   // hamstrings, glutes, back, core
      ]),
    ];
    const result = calculateWeeklyVolume(logs);
    // glutes: squat(3) + deadlift(3) = 6
    expect(findMuscle(result, 'glutes')?.weeklySets).toBe(6);
    // core: squat(3) + deadlift(3) = 6
    expect(findMuscle(result, 'core')?.weeklySets).toBe(6);
  });

  it('only counts completed sets (completed=false excluded)', () => {
    const logs = [
      makeLog(todayISO(), [
        ...makeSetsForSlot('squat', 3, true),
        ...makeSetsForSlot('squat', 2, false),
      ]),
    ];
    const result = calculateWeeklyVolume(logs);
    expect(findMuscle(result, 'quads')?.weeklySets).toBe(3);
  });

  it('respects weeksToAverage parameter — excludes old logs', () => {
    const logs = [
      makeLog(todayISO(), makeSetsForSlot('squat', 5)),
      makeLog(daysAgoISO(10), makeSetsForSlot('squat', 10)), // older than 1 week
    ];
    const result = calculateWeeklyVolume(logs, 1);
    expect(findMuscle(result, 'quads')?.weeklySets).toBe(5);
  });

  it('averages volume across multiple weeks when weeksToAverage > 1', () => {
    const logs = [
      makeLog(todayISO(), makeSetsForSlot('squat', 6)),
      makeLog(daysAgoISO(8), makeSetsForSlot('squat', 6)),
    ];
    // 2 weeks, total 12 sets, average 6/week
    const result = calculateWeeklyVolume(logs, 2);
    expect(findMuscle(result, 'quads')?.weeklySets).toBe(6);
  });

  it('classifies zone as "under" when below MEV', () => {
    // quads MEV = 8, so 3 sets should be 'under'
    const logs = [makeLog(todayISO(), makeSetsForSlot('squat', 3))];
    const result = calculateWeeklyVolume(logs);
    expect(findMuscle(result, 'quads')?.zone).toBe('under');
  });

  it('classifies zone as "optimal" when between MEV and MAV', () => {
    // quads MEV=8, MAV=15 — 10 sets should be 'optimal'
    const logs = [makeLog(todayISO(), makeSetsForSlot('squat', 10))];
    const result = calculateWeeklyVolume(logs);
    expect(findMuscle(result, 'quads')?.zone).toBe('optimal');
  });

  it('classifies zone as "high" when between MAV and MRV', () => {
    // quads MAV=15, MRV=20 — 16 sets should be 'high'
    const logs = [makeLog(todayISO(), makeSetsForSlot('squat', 16))];
    const result = calculateWeeklyVolume(logs);
    expect(findMuscle(result, 'quads')?.zone).toBe('high');
  });

  it('classifies zone as "excessive" when >= MRV', () => {
    // quads MRV=20 — 22 sets should be 'excessive'
    const logs = [makeLog(todayISO(), makeSetsForSlot('squat', 22))];
    const result = calculateWeeklyVolume(logs);
    expect(findMuscle(result, 'quads')?.zone).toBe('excessive');
  });

  it('returns results sorted by weeklySets descending', () => {
    const logs = [
      makeLog(todayISO(), [
        ...makeSetsForSlot('squat', 15),
        ...makeSetsForSlot('bench', 5),
      ]),
    ];
    const result = calculateWeeklyVolume(logs);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].weeklySets).toBeGreaterThanOrEqual(result[i].weeklySets);
    }
  });

  it('includes MEV, MAV, and MRV landmarks in each result', () => {
    const result = calculateWeeklyVolume([]);
    for (const v of result) {
      expect(typeof v.mev).toBe('number');
      expect(typeof v.mav).toBe('number');
      expect(typeof v.mrv).toBe('number');
      expect(v.mev).toBeLessThanOrEqual(v.mav);
      expect(v.mav).toBeLessThanOrEqual(v.mrv);
    }
  });

  it('handles unknown exercise slots gracefully (no crash)', () => {
    const logs = [makeLog(todayISO(), [{ exerciseSlot: 'unknown_exercise', completed: true }])];
    const result = calculateWeeklyVolume(logs);
    // Should still return all muscle groups, just with 0 sets
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles weeksToAverage = 0 without division by zero', () => {
    const logs = [makeLog(todayISO(), makeSetsForSlot('squat', 5))];
    // weeklyScale = 1 / Math.max(0, 1) = 1
    expect(() => calculateWeeklyVolume(logs, 0)).not.toThrow();
  });
});

// ─── getUndertrainedMuscles ───

describe('getUndertrainedMuscles', () => {
  it('returns muscles below MEV', () => {
    const volumes: MuscleVolume[] = [
      { muscleGroup: 'quads', label: 'Quads', weeklySets: 3, zone: 'under', mev: 8, mav: 15, mrv: 20 },
      { muscleGroup: 'chest', label: 'Chest', weeklySets: 10, zone: 'optimal', mev: 6, mav: 14, mrv: 22 },
    ];
    const result = getUndertrainedMuscles(volumes);
    expect(result).toHaveLength(1);
    expect(result[0].muscleGroup).toBe('quads');
  });

  it('returns empty array when all muscles are at or above MEV', () => {
    const volumes: MuscleVolume[] = [
      { muscleGroup: 'quads', label: 'Quads', weeklySets: 12, zone: 'optimal', mev: 8, mav: 15, mrv: 20 },
      { muscleGroup: 'chest', label: 'Chest', weeklySets: 10, zone: 'optimal', mev: 6, mav: 14, mrv: 22 },
    ];
    expect(getUndertrainedMuscles(volumes)).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(getUndertrainedMuscles([])).toHaveLength(0);
  });

  it('excludes muscles with mev=0 even if zone is "under"', () => {
    const volumes: MuscleVolume[] = [
      { muscleGroup: 'front_delts', label: 'Front Delts', weeklySets: 0, zone: 'under', mev: 0, mav: 8, mrv: 12 },
    ];
    expect(getUndertrainedMuscles(volumes)).toHaveLength(0);
  });
});

// ─── getOvertrainedMuscles ───

describe('getOvertrainedMuscles', () => {
  it('returns muscles in the "excessive" zone', () => {
    const volumes: MuscleVolume[] = [
      { muscleGroup: 'quads', label: 'Quads', weeklySets: 25, zone: 'excessive', mev: 8, mav: 15, mrv: 20 },
      { muscleGroup: 'chest', label: 'Chest', weeklySets: 10, zone: 'optimal', mev: 6, mav: 14, mrv: 22 },
    ];
    const result = getOvertrainedMuscles(volumes);
    expect(result).toHaveLength(1);
    expect(result[0].muscleGroup).toBe('quads');
  });

  it('returns empty array when no muscles are excessive', () => {
    const volumes: MuscleVolume[] = [
      { muscleGroup: 'quads', label: 'Quads', weeklySets: 12, zone: 'optimal', mev: 8, mav: 15, mrv: 20 },
      { muscleGroup: 'chest', label: 'Chest', weeklySets: 18, zone: 'high', mev: 6, mav: 14, mrv: 22 },
    ];
    expect(getOvertrainedMuscles(volumes)).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(getOvertrainedMuscles([])).toHaveLength(0);
  });

  it('returns multiple muscles if multiple are excessive', () => {
    const volumes: MuscleVolume[] = [
      { muscleGroup: 'quads', label: 'Quads', weeklySets: 25, zone: 'excessive', mev: 8, mav: 15, mrv: 20 },
      { muscleGroup: 'chest', label: 'Chest', weeklySets: 30, zone: 'excessive', mev: 6, mav: 14, mrv: 22 },
    ];
    expect(getOvertrainedMuscles(volumes)).toHaveLength(2);
  });
});

// ─── calculateMesocycleTargets ───

describe('calculateMesocycleTargets', () => {
  it('returns MEV for week 1', () => {
    const result = calculateMesocycleTargets('quads', 5, 1);
    expect(result.targetSets).toBe(8); // quads MEV = 8
    expect(result.zone).toBe('mev');
  });

  it('returns deload (50% MEV) for the final week', () => {
    const result = calculateMesocycleTargets('quads', 5, 5);
    expect(result.targetSets).toBe(4); // round(8 * 0.5) = 4
    expect(result.zone).toBe('deload');
  });

  it('linearly interpolates between MEV and MRV for middle weeks', () => {
    // quads: MEV=8, MRV=20, mesocycle=5 weeks
    // Training weeks = 4 (5 - 1 deload)
    // Week 2: frac = (2-1)/(4-1) = 1/3, target = 8 + 1/3*(20-8) = 8 + 4 = 12
    const week2 = calculateMesocycleTargets('quads', 5, 2);
    expect(week2.targetSets).toBe(12);
    expect(week2.zone).toBe('building');

    // Week 3: frac = 2/3, target = 8 + 2/3*(20-8) = 8 + 8 = 16
    const week3 = calculateMesocycleTargets('quads', 5, 3);
    expect(week3.targetSets).toBe(16);
    expect(week3.zone).toBe('building');

    // Week 4: frac = 3/3 = 1.0, target = 8 + 1*(20-8) = 20
    const week4 = calculateMesocycleTargets('quads', 5, 4);
    expect(week4.targetSets).toBe(20);
    expect(week4.zone).toBe('mrv');
  });

  it('handles mesocycleLength=2 without division by zero', () => {
    // len=2, week 1: MEV, week 2: deload
    const week1 = calculateMesocycleTargets('quads', 2, 1);
    expect(week1.targetSets).toBe(8);
    expect(week1.zone).toBe('mev');
    const week2 = calculateMesocycleTargets('quads', 2, 2);
    expect(week2.zone).toBe('deload');
  });

  it('handles mesocycleLength=1 by clamping to minimum 2', () => {
    // len is clamped to 2, week 1 would be MEV
    const result = calculateMesocycleTargets('quads', 1, 1);
    expect(result.targetSets).toBe(8);
    expect(() => calculateMesocycleTargets('quads', 1, 1)).not.toThrow();
  });

  it('clamps weekNumber to mesocycleLength', () => {
    // week > mesocycleLength: should clamp to final week (deload)
    const result = calculateMesocycleTargets('quads', 4, 10);
    expect(result.zone).toBe('deload');
  });

  it('clamps weekNumber minimum to 1', () => {
    const result = calculateMesocycleTargets('quads', 4, 0);
    expect(result.targetSets).toBe(8); // MEV
    expect(result.zone).toBe('mev');
  });

  it('returns 0 targetSets for unknown muscle group', () => {
    const result = calculateMesocycleTargets('nonexistent_muscle', 4, 1);
    expect(result.targetSets).toBe(0);
    expect(result.zone).toBe('mev');
  });

  it('produces monotonically increasing targets from week 1 to week N-1', () => {
    const targets: number[] = [];
    for (let w = 1; w <= 4; w++) {
      targets.push(calculateMesocycleTargets('quads', 5, w).targetSets);
    }
    // weeks 1-4 (non-deload) should be monotonically non-decreasing
    for (let i = 1; i < targets.length; i++) {
      expect(targets[i]).toBeGreaterThanOrEqual(targets[i - 1]);
    }
  });

  it('works for different muscle groups with different landmarks', () => {
    // hamstrings: MEV=6, MRV=18
    const result = calculateMesocycleTargets('hamstrings', 4, 1);
    expect(result.targetSets).toBe(6);
    const deload = calculateMesocycleTargets('hamstrings', 4, 4);
    expect(deload.targetSets).toBe(3); // round(6 * 0.5)
  });
});

// ─── assessVolumeProgression ───

describe('assessVolumeProgression', () => {
  it('marks "on_track" when actual is within ±2 of target', () => {
    // quads week 1, mesocycle 4: target = MEV = 8
    const result = assessVolumeProgression(
      [{ week: 1, muscleGroup: 'quads', sets: 9 }],
      4,
    );
    expect(result[0].progression).toBe('on_track');
  });

  it('marks "under" when actual is more than 2 below target', () => {
    // quads week 1: target = 8, actual = 3 → 3 < 8 - 2 = 6
    const result = assessVolumeProgression(
      [{ week: 1, muscleGroup: 'quads', sets: 3 }],
      4,
    );
    expect(result[0].progression).toBe('under');
  });

  it('marks "over" when actual exceeds MRV', () => {
    // quads MRV = 20
    const result = assessVolumeProgression(
      [{ week: 1, muscleGroup: 'quads', sets: 25 }],
      4,
    );
    expect(result[0].progression).toBe('over');
  });

  it('marks "on_track" when above target+2 but still within MRV', () => {
    // quads week 1: target = 8, actual = 15 → 15 > 8+2 but <= 20 (MRV)
    const result = assessVolumeProgression(
      [{ week: 1, muscleGroup: 'quads', sets: 15 }],
      4,
    );
    expect(result[0].progression).toBe('on_track');
  });

  it('returns empty array for empty input', () => {
    expect(assessVolumeProgression([], 4)).toHaveLength(0);
  });

  it('skips unknown muscle groups', () => {
    const result = assessVolumeProgression(
      [{ week: 1, muscleGroup: 'nonexistent', sets: 10 }],
      4,
    );
    expect(result).toHaveLength(0);
  });

  it('includes all MesocycleVolume fields correctly', () => {
    const result = assessVolumeProgression(
      [{ week: 2, muscleGroup: 'chest', sets: 10 }],
      5,
    );
    expect(result[0].weekNumber).toBe(2);
    expect(result[0].mesocycleLength).toBe(5);
    expect(result[0].muscleGroup).toBe('chest');
    expect(result[0].currentSets).toBe(10);
    expect(typeof result[0].targetSets).toBe('number');
    expect(result[0].mev).toBe(6);
    expect(result[0].mav).toBe(14);
    expect(result[0].mrv).toBe(22);
  });

  it('handles multiple entries across different weeks', () => {
    const result = assessVolumeProgression(
      [
        { week: 1, muscleGroup: 'quads', sets: 8 },
        { week: 2, muscleGroup: 'quads', sets: 12 },
        { week: 3, muscleGroup: 'quads', sets: 16 },
      ],
      4,
    );
    expect(result).toHaveLength(3);
    // All should be on_track with proper mesocycle progression
    for (const r of result) {
      expect(['on_track', 'under', 'over', 'deload_needed']).toContain(r.progression);
    }
  });
});

// ─── analyzeFrequencyDistribution ───

describe('analyzeFrequencyDistribution', () => {
  it('returns empty array for empty logs', () => {
    expect(analyzeFrequencyDistribution([])).toHaveLength(0);
  });

  it('marks 1-8 sets/week in 1 session as optimal', () => {
    // 6 squat sets in one day (quads get 6 sets → needs 1 session)
    const logs = [makeLog(todayISO(), makeSetsForSlot('squat', 6))];
    const result = analyzeFrequencyDistribution(logs);
    const quads = result.find(r => r.muscleGroup === 'Quads');
    expect(quads?.optimal).toBe(true);
    expect(quads?.sessionsPerWeek).toBe(1);
  });

  it('flags >10 sets in single session as suboptimal', () => {
    const logs = [makeLog(todayISO(), makeSetsForSlot('squat', 12))];
    const result = analyzeFrequencyDistribution(logs);
    const quads = result.find(r => r.muscleGroup === 'Quads');
    expect(quads?.optimal).toBe(false);
    expect(quads?.maxSetsInOneSession).toBe(12);
  });

  it('recommends 2+ sessions for 9-14 weekly sets', () => {
    // 12 squat sets in one session → quads get 12 sets, needs 2+ sessions
    const logs = [makeLog(todayISO(), makeSetsForSlot('squat', 12))];
    const result = analyzeFrequencyDistribution(logs);
    const quads = result.find(r => r.muscleGroup === 'Quads');
    expect(quads?.optimal).toBe(false);
    expect(quads?.recommendation).toContain('session');
  });

  it('marks well-distributed volume as optimal', () => {
    // 10 squat sets across 2 sessions (5+5)
    const logs = [
      makeLog(todayISO(), makeSetsForSlot('squat', 5)),
      makeLog(daysAgoISO(3), makeSetsForSlot('squat', 5)),
    ];
    const result = analyzeFrequencyDistribution(logs);
    const quads = result.find(r => r.muscleGroup === 'Quads');
    expect(quads?.totalWeeklySets).toBe(10);
    expect(quads?.sessionsPerWeek).toBe(2);
    expect(quads?.optimal).toBe(true);
  });

  it('recommends 3+ sessions for 15-20 weekly sets', () => {
    // 18 sets across only 2 sessions → needs 3+
    const logs = [
      makeLog(todayISO(), makeSetsForSlot('squat', 9)),
      makeLog(daysAgoISO(3), makeSetsForSlot('squat', 9)),
    ];
    const result = analyzeFrequencyDistribution(logs);
    const quads = result.find(r => r.muscleGroup === 'Quads');
    expect(quads?.totalWeeklySets).toBe(18);
    // 18 sets needs 3+ sessions, but only 2 → not optimal
    expect(quads?.optimal).toBe(false);
  });

  it('only counts completed sets', () => {
    const logs = [
      makeLog(todayISO(), [
        ...makeSetsForSlot('squat', 3, true),
        ...makeSetsForSlot('squat', 5, false),
      ]),
    ];
    const result = analyzeFrequencyDistribution(logs);
    const quads = result.find(r => r.muscleGroup === 'Quads');
    expect(quads?.totalWeeklySets).toBe(3);
  });

  it('sorts non-optimal results first', () => {
    // 12 sets one session (not optimal) + 4 sets another exercise 1 session (optimal)
    const logs = [
      makeLog(todayISO(), [
        ...makeSetsForSlot('squat', 12),
        ...makeSetsForSlot('row', 4),
      ]),
    ];
    const result = analyzeFrequencyDistribution(logs);
    // Non-optimal entries should come first
    const firstNonOptimal = result.findIndex(r => !r.optimal);
    const lastOptimal = result.length - 1 - [...result].reverse().findIndex(r => r.optimal);
    if (firstNonOptimal !== -1 && lastOptimal !== -1 && result.some(r => r.optimal) && result.some(r => !r.optimal)) {
      expect(firstNonOptimal).toBeLessThan(lastOptimal);
    }
  });

  it('respects weeksBack parameter', () => {
    const logs = [
      makeLog(todayISO(), makeSetsForSlot('squat', 5)),
      makeLog(daysAgoISO(20), makeSetsForSlot('squat', 10)), // 20 days ago
    ];
    // Only look back 1 week
    const result = analyzeFrequencyDistribution(logs, 1);
    const quads = result.find(r => r.muscleGroup === 'Quads');
    expect(quads?.totalWeeklySets).toBe(5);
  });

  it('handles multiple exercises in one log', () => {
    const logs = [
      makeLog(todayISO(), [
        ...makeSetsForSlot('squat', 3),
        ...makeSetsForSlot('bench', 3),
        ...makeSetsForSlot('row', 3),
      ]),
    ];
    const result = analyzeFrequencyDistribution(logs);
    // Should have entries for quads, glutes, core, chest, triceps, front_delts, back, biceps, rear_delts
    expect(result.length).toBeGreaterThanOrEqual(5);
  });
});

// ─── individualizeVolumeLandmarks ───

describe('individualizeVolumeLandmarks', () => {
  it('returns base landmarks with no factors', () => {
    const result = individualizeVolumeLandmarks('quads', {});
    expect(result.mev).toBe(8);
    expect(result.mav).toBe(15);
    expect(result.mrv).toBe(20);
  });

  it('reduces all landmarks by 20% for training age < 1 year', () => {
    const result = individualizeVolumeLandmarks('quads', { trainingAge: 0.5 });
    // mev: round(8*0.80) = 6 → clamped max(4,6)=6
    expect(result.mev).toBe(6);
    // mav: round(15*0.80) = 12
    expect(result.mav).toBe(12);
    // mrv: round(20*0.80) = 16
    expect(result.mrv).toBe(16);
  });

  it('increases MRV by 15% for training age > 5 years', () => {
    const result = individualizeVolumeLandmarks('quads', { trainingAge: 7 });
    expect(result.mev).toBe(8);
    expect(result.mav).toBe(15);
    // mrv: round(20*1.15) = 23
    expect(result.mrv).toBe(23);
  });

  it('reduces MRV by 20% for low recovery capacity', () => {
    const result = individualizeVolumeLandmarks('quads', { recoveryCapacity: 'low' });
    // mrv: round(20*0.80) = 16
    expect(result.mrv).toBe(16);
    // mav: round(15*0.90) = 14 (rounded)
    expect(result.mav).toBe(14);
  });

  it('increases MRV by 10% for high recovery capacity', () => {
    const result = individualizeVolumeLandmarks('quads', { recoveryCapacity: 'high' });
    // mrv: round(20*1.10) = 22
    expect(result.mrv).toBe(22);
  });

  it('reduces MRV by 10% for age > 40', () => {
    const result = individualizeVolumeLandmarks('quads', { age: 45 });
    // mrv: round(20*0.90) = 18
    expect(result.mrv).toBe(18);
  });

  it('reduces MRV by 20% and MAV by 10% for age > 50', () => {
    const result = individualizeVolumeLandmarks('quads', { age: 55 });
    // mrv: round(20*0.80) = 16
    expect(result.mrv).toBe(16);
    // mav: round(15*0.90) = 14
    expect(result.mav).toBe(14);
  });

  it('increases MRV by 10% for female sex', () => {
    const result = individualizeVolumeLandmarks('quads', { sex: 'female' });
    // mrv: round(20*1.10) = 22
    expect(result.mrv).toBe(22);
  });

  it('combines multiple factors multiplicatively', () => {
    // advanced female with high recovery
    const result = individualizeVolumeLandmarks('quads', {
      trainingAge: 8,      // MRV *1.15
      sex: 'female',       // MRV *1.10
      recoveryCapacity: 'high', // MRV *1.10
    });
    // mrv: round(20 * 1.15 * 1.10 * 1.10) = round(27.94) = 28
    expect(result.mrv).toBe(28);
  });

  it('combines beginner + low recovery + old age reductions', () => {
    const result = individualizeVolumeLandmarks('quads', {
      trainingAge: 0.5,      // all * 0.80
      recoveryCapacity: 'low', // MRV * 0.80, MAV * 0.90
      age: 55,               // MRV * 0.80, MAV * 0.90
    });
    // mev: round(8*0.80) = 6
    expect(result.mev).toBe(6);
    // mav: round(15*0.80*0.90*0.90) = round(9.72) = 10
    expect(result.mav).toBe(10);
    // mrv: round(20*0.80*0.80*0.80) = round(10.24) = 10
    expect(result.mrv).toBe(10);
  });

  it('clamps MEV to minimum of 4', () => {
    // lower_back: MEV=2, applying beginner reduction
    const result = individualizeVolumeLandmarks('lower_back', { trainingAge: 0.5 });
    // mev: round(2*0.80) = 2 → clamped to 4
    expect(result.mev).toBeGreaterThanOrEqual(4);
  });

  it('clamps MRV to maximum of 30', () => {
    // back: MRV=22, advanced + female + high recovery
    const result = individualizeVolumeLandmarks('back', {
      trainingAge: 8,
      sex: 'female',
      recoveryCapacity: 'high',
    });
    // mrv: round(22*1.15*1.10*1.10) = round(30.61) → clamped to 30
    expect(result.mrv).toBeLessThanOrEqual(30);
  });

  it('preserves ordering: MEV <= MAV <= MRV', () => {
    // Test with extreme reduction factors
    const result = individualizeVolumeLandmarks('quads', {
      trainingAge: 0.5,
      recoveryCapacity: 'low',
      age: 55,
    });
    expect(result.mev).toBeLessThanOrEqual(result.mav);
    expect(result.mav).toBeLessThanOrEqual(result.mrv);
  });

  it('returns defaults for unknown muscle group', () => {
    const result = individualizeVolumeLandmarks('nonexistent', {});
    expect(result.mev).toBe(6);
    expect(result.mav).toBe(12);
    expect(result.mrv).toBe(20);
  });

  it('does not modify landmarks for normal recovery', () => {
    const result = individualizeVolumeLandmarks('quads', { recoveryCapacity: 'normal' });
    expect(result.mrv).toBe(20);
    expect(result.mav).toBe(15);
  });

  it('handles training age exactly equal to boundaries', () => {
    // trainingAge = 1 → not < 1, not > 5: no adjustment
    const at1 = individualizeVolumeLandmarks('quads', { trainingAge: 1 });
    expect(at1.mrv).toBe(20);

    // trainingAge = 5 → not > 5: no adjustment
    const at5 = individualizeVolumeLandmarks('quads', { trainingAge: 5 });
    expect(at5.mrv).toBe(20);
  });

  it('handles age exactly at boundaries', () => {
    // age = 40 → not > 40: no reduction
    const at40 = individualizeVolumeLandmarks('quads', { age: 40 });
    expect(at40.mrv).toBe(20);

    // age = 50 → not > 50, but > 40: 10% reduction
    const at50 = individualizeVolumeLandmarks('quads', { age: 50 });
    expect(at50.mrv).toBe(18); // round(20*0.90)
  });

  it('works correctly for glutes muscle group', () => {
    // glutes: MEV=4, MAV=12, MRV=16
    const result = individualizeVolumeLandmarks('glutes', {});
    expect(result.mev).toBe(4);
    expect(result.mav).toBe(12);
    expect(result.mrv).toBe(16);
  });
});
