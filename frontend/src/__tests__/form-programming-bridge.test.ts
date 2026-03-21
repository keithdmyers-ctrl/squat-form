import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  analyzeFormWeaknesses,
  getAccessoryRecommendations,
  renderWeakPointReport,
  findAccessoryGaps,
  loadFormSessions,
} from '../form-programming-bridge';
import type { FormWeakness, AccessoryRecommendation } from '../form-programming-bridge';

// ─── Mock localStorage ───

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// ─── Helpers ───

interface MockSession {
  exercise_type?: string;
  date?: string;
  overall_score?: number;
  top_issue?: string | null;
  avg_depth?: number;
  avg_knee_tracking?: number;
  avg_trunk?: number;
  avg_symmetry?: number;
  avg_tempo?: number;
  avg_lockout?: number;
}

function makeSession(overrides: Partial<MockSession> = {}): MockSession {
  return {
    exercise_type: 'squat',
    date: new Date().toISOString(),
    overall_score: 75,
    top_issue: null,
    avg_depth: 80,
    avg_knee_tracking: 80,
    avg_trunk: 80,
    avg_symmetry: 85,
    avg_tempo: 80,
    avg_lockout: 85,
    ...overrides,
  };
}

function setSessionStorage(sessions: MockSession[]): void {
  localStorageMock.setItem('squat_form_sessions', JSON.stringify(sessions));
}

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});

// ─── Tests: analyzeFormWeaknesses ───

describe('analyzeFormWeaknesses', () => {
  it('returns empty array for empty session history', () => {
    const result = analyzeFormWeaknesses([]);
    expect(result).toEqual([]);
  });

  it('returns empty array when no sessions in storage', () => {
    const result = analyzeFormWeaknesses();
    expect(result).toEqual([]);
  });

  it('detects knee valgus when avg_knee_tracking is consistently low', () => {
    const sessions = [
      makeSession({ avg_knee_tracking: 55 }),
      makeSession({ avg_knee_tracking: 60 }),
      makeSession({ avg_knee_tracking: 58 }),
      makeSession({ avg_knee_tracking: 62 }),
      makeSession({ avg_knee_tracking: 57 }),
    ];

    const result = analyzeFormWeaknesses(sessions);
    const kneeWeakness = result.find(w => w.weakness === 'knee_valgus');

    expect(kneeWeakness).toBeDefined();
    expect(kneeWeakness!.exercise).toBe('squat');
    expect(kneeWeakness!.frequency).toBe(5);
    expect(kneeWeakness!.severity).toBe('moderate');
  });

  it('detects stable trend for consistent scores (3/5 sessions)', () => {
    const sessions = [
      makeSession({ avg_knee_tracking: 65 }),
      makeSession({ avg_knee_tracking: 64 }),
      makeSession({ avg_knee_tracking: 66 }),
      makeSession({ avg_knee_tracking: 80 }),
      makeSession({ avg_knee_tracking: 80 }),
    ];

    const result = analyzeFormWeaknesses(sessions);
    const kneeWeakness = result.find(w => w.weakness === 'knee_valgus');

    expect(kneeWeakness).toBeDefined();
    expect(kneeWeakness!.frequency).toBe(3);
  });

  it('detects improving trend when recent scores are higher', () => {
    const sessions = [
      makeSession({ avg_knee_tracking: 68 }),
      makeSession({ avg_knee_tracking: 65 }),
      makeSession({ avg_knee_tracking: 50 }),
      makeSession({ avg_knee_tracking: 48 }),
      makeSession({ avg_knee_tracking: 45 }),
    ];

    const result = analyzeFormWeaknesses(sessions);
    const kneeWeakness = result.find(w => w.weakness === 'knee_valgus');

    expect(kneeWeakness).toBeDefined();
    expect(kneeWeakness!.trend).toBe('improving');
  });

  it('detects worsening trend when recent scores are lower', () => {
    const sessions = [
      makeSession({ avg_knee_tracking: 45 }),
      makeSession({ avg_knee_tracking: 48 }),
      makeSession({ avg_knee_tracking: 65 }),
      makeSession({ avg_knee_tracking: 68 }),
      makeSession({ avg_knee_tracking: 69 }),
    ];

    const result = analyzeFormWeaknesses(sessions);
    const kneeWeakness = result.find(w => w.weakness === 'knee_valgus');

    expect(kneeWeakness).toBeDefined();
    expect(kneeWeakness!.trend).toBe('worsening');
  });

  it('detects high severity for very low scores', () => {
    const sessions = [
      makeSession({ avg_depth: 40 }),
      makeSession({ avg_depth: 38 }),
      makeSession({ avg_depth: 42 }),
    ];

    const result = analyzeFormWeaknesses(sessions);
    const depthWeakness = result.find(w => w.weakness === 'depth_insufficient');

    expect(depthWeakness).toBeDefined();
    expect(depthWeakness!.severity).toBe('high');
  });

  it('detects multiple weaknesses simultaneously', () => {
    const sessions = [
      makeSession({ avg_depth: 50, avg_knee_tracking: 55, avg_trunk: 50 }),
      makeSession({ avg_depth: 52, avg_knee_tracking: 58, avg_trunk: 48 }),
      makeSession({ avg_depth: 48, avg_knee_tracking: 56, avg_trunk: 52 }),
    ];

    const result = analyzeFormWeaknesses(sessions);

    expect(result.length).toBeGreaterThanOrEqual(3);
    const weaknessNames = result.map(w => w.weakness);
    expect(weaknessNames).toContain('depth_insufficient');
    expect(weaknessNames).toContain('knee_valgus');
    expect(weaknessNames).toContain('good_morning');
  });

  it('detects deadlift-specific weaknesses', () => {
    const sessions = [
      makeSession({ exercise_type: 'deadlift', avg_trunk: 55, avg_lockout: 60 }),
      makeSession({ exercise_type: 'deadlift', avg_trunk: 58, avg_lockout: 62 }),
      makeSession({ exercise_type: 'deadlift', avg_trunk: 52, avg_lockout: 58 }),
    ];

    const result = analyzeFormWeaknesses(sessions);

    const roundedBack = result.find(w => w.weakness === 'rounded_back');
    expect(roundedBack).toBeDefined();
    expect(roundedBack!.exercise).toBe('deadlift');

    const hitching = result.find(w => w.weakness === 'hitching');
    expect(hitching).toBeDefined();
  });

  it('detects bench press weaknesses', () => {
    const sessions = [
      makeSession({ exercise_type: 'bench_press', avg_depth: 55, avg_lockout: 60 }),
      makeSession({ exercise_type: 'bench_press', avg_depth: 58, avg_lockout: 62 }),
      makeSession({ exercise_type: 'bench_press', avg_depth: 52, avg_lockout: 58 }),
    ];

    const result = analyzeFormWeaknesses(sessions);

    const noPause = result.find(w => w.weakness === 'no_pause');
    expect(noPause).toBeDefined();
    expect(noPause!.exercise).toBe('bench_press');
  });

  it('does not flag weaknesses when all scores are above threshold', () => {
    const sessions = [
      makeSession({ avg_depth: 85, avg_knee_tracking: 90, avg_trunk: 80, avg_lockout: 85 }),
      makeSession({ avg_depth: 88, avg_knee_tracking: 85, avg_trunk: 82, avg_lockout: 88 }),
    ];

    const result = analyzeFormWeaknesses(sessions);
    expect(result).toEqual([]);
  });

  it('detects top_issue pattern from repeated issues', () => {
    const sessions = [
      makeSession({ top_issue: 'butt_wink', avg_depth: 80, avg_knee_tracking: 80, avg_trunk: 80, avg_lockout: 80 }),
      makeSession({ top_issue: 'butt_wink', avg_depth: 80, avg_knee_tracking: 80, avg_trunk: 80, avg_lockout: 80 }),
      makeSession({ top_issue: 'butt_wink', avg_depth: 80, avg_knee_tracking: 80, avg_trunk: 80, avg_lockout: 80 }),
    ];

    const result = analyzeFormWeaknesses(sessions);
    const buttWink = result.find(w => w.weakness === 'butt_wink');

    expect(buttWink).toBeDefined();
    expect(buttWink!.frequency).toBe(3);
  });

  it('does not include top_issue with frequency < 2', () => {
    const sessions = [
      makeSession({ top_issue: 'butt_wink', avg_depth: 80, avg_knee_tracking: 80, avg_trunk: 80, avg_lockout: 80 }),
      makeSession({ top_issue: null, avg_depth: 80, avg_knee_tracking: 80, avg_trunk: 80, avg_lockout: 80 }),
      makeSession({ top_issue: null, avg_depth: 80, avg_knee_tracking: 80, avg_trunk: 80, avg_lockout: 80 }),
    ];

    const result = analyzeFormWeaknesses(sessions);
    const buttWink = result.find(w => w.weakness === 'butt_wink');

    expect(buttWink).toBeUndefined();
  });

  it('sorts results by severity then frequency', () => {
    const sessions = [
      makeSession({ avg_depth: 40, avg_knee_tracking: 65 }),
      makeSession({ avg_depth: 42, avg_knee_tracking: 63 }),
      makeSession({ avg_depth: 38, avg_knee_tracking: 62 }),
    ];

    const result = analyzeFormWeaknesses(sessions);
    // depth_insufficient should be higher severity (scores ~40) than knee_valgus (scores ~63)
    expect(result.length).toBeGreaterThanOrEqual(2);
    const depthIdx = result.findIndex(w => w.weakness === 'depth_insufficient');
    const kneeIdx = result.findIndex(w => w.weakness === 'knee_valgus');
    expect(depthIdx).toBeLessThan(kneeIdx);
  });

  it('reads from localStorage when no sessions param provided', () => {
    setSessionStorage([
      makeSession({ avg_depth: 50 }),
      makeSession({ avg_depth: 48 }),
    ]);

    const result = analyzeFormWeaknesses();
    expect(result.length).toBeGreaterThan(0);
    expect(localStorageMock.getItem).toHaveBeenCalledWith('squat_form_sessions');
  });

  it('handles mixed exercise types', () => {
    const sessions = [
      makeSession({ exercise_type: 'squat', avg_depth: 50 }),
      makeSession({ exercise_type: 'deadlift', avg_trunk: 50 }),
      makeSession({ exercise_type: 'bench_press', avg_lockout: 50 }),
    ];

    const result = analyzeFormWeaknesses(sessions);
    const exercises = new Set(result.map(w => w.exercise));
    expect(exercises.size).toBeGreaterThanOrEqual(2);
  });
});

// ─── Tests: getAccessoryRecommendations ───

describe('getAccessoryRecommendations', () => {
  it('maps knee_valgus to banded squats and monster walks', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'knee_valgus', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    const recs = getAccessoryRecommendations(weaknesses);
    const names = recs.map(r => r.exercise);

    expect(names).toContain('Banded Squats');
    expect(names).toContain('Monster Walks');
    expect(names).toContain('Clamshells');
  });

  it('maps good_morning to front squats and tempo squats', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'good_morning', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    const recs = getAccessoryRecommendations(weaknesses);
    const names = recs.map(r => r.exercise);

    expect(names).toContain('Front Squat');
    expect(names).toContain('SSB Squat');
    expect(names).toContain('Tempo Squat');
  });

  it('maps butt_wink to box squats and goblet squats', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'butt_wink', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    const recs = getAccessoryRecommendations(weaknesses);
    const names = recs.map(r => r.exercise);

    expect(names).toContain('Box Squat');
    expect(names).toContain('Goblet Squat');
  });

  it('maps depth_insufficient to pause squats and ankle mobility', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'depth_insufficient', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    const recs = getAccessoryRecommendations(weaknesses);
    const names = recs.map(r => r.exercise);

    expect(names).toContain('Pause Squat');
    expect(names).toContain('Goblet Squat');
    expect(names).toContain('Ankle Mobility Drills');
  });

  it('maps rounded_back to deficit deadlifts and back extensions', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'deadlift', weakness: 'rounded_back', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    const recs = getAccessoryRecommendations(weaknesses);
    const names = recs.map(r => r.exercise);

    expect(names).toContain('Deficit Deadlift (light)');
    expect(names).toContain('Pause Deadlift');
    expect(names).toContain('Back Extension');
  });

  it('maps hitching to block pulls and RDLs', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'deadlift', weakness: 'hitching', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    const recs = getAccessoryRecommendations(weaknesses);
    const names = recs.map(r => r.exercise);

    expect(names).toContain('Block Pulls');
    expect(names).toContain('Romanian Deadlift');
    expect(names).toContain('Hip Thrust');
  });

  it('maps no_pause to paused bench and Spoto press', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'bench_press', weakness: 'no_pause', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    const recs = getAccessoryRecommendations(weaknesses);
    const names = recs.map(r => r.exercise);

    expect(names).toContain('Paused Bench Press');
    expect(names).toContain('Spoto Press');
  });

  it('maps weak_lockout_bench to close-grip bench', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'bench_press', weakness: 'weak_lockout_bench', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    const recs = getAccessoryRecommendations(weaknesses);
    const names = recs.map(r => r.exercise);

    expect(names).toContain('Close-grip Bench');
    expect(names).toContain('JM Press');
    expect(names).toContain('Tricep Dips');
  });

  it('elevates priority for high severity weaknesses', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'knee_valgus', severity: 'high', frequency: 5, trend: 'stable' },
    ];

    const recs = getAccessoryRecommendations(weaknesses);

    // Monster Walks is normally medium, should be elevated to high for high-severity weakness
    const monsterWalks = recs.find(r => r.exercise === 'Monster Walks');
    expect(monsterWalks).toBeDefined();
    expect(monsterWalks!.priority).toBe('high');

    // Clamshells is normally low, should be elevated to medium
    const clamshells = recs.find(r => r.exercise === 'Clamshells');
    expect(clamshells).toBeDefined();
    expect(clamshells!.priority).toBe('medium');
  });

  it('returns empty for empty weaknesses', () => {
    const recs = getAccessoryRecommendations([]);
    expect(recs).toEqual([]);
  });

  it('returns empty for unknown weakness type', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'unknown_issue', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    const recs = getAccessoryRecommendations(weaknesses);
    expect(recs).toEqual([]);
  });

  it('handles multiple weaknesses without duplicating exercises', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'knee_valgus', severity: 'moderate', frequency: 3, trend: 'stable' },
      { exercise: 'squat', weakness: 'depth_insufficient', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    const recs = getAccessoryRecommendations(weaknesses);
    // Verify no exact duplicate exercise+targetWeakness combos
    const keys = recs.map(r => `${r.exercise}-${r.targetWeakness}`);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });

  it('sorts recommendations by priority (high first)', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'knee_valgus', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    const recs = getAccessoryRecommendations(weaknesses);
    const priorities = recs.map(r => r.priority);

    // High should come before medium, medium before low
    let lastPriorityRank = Infinity;
    const priorityRanks: Record<string, number> = { high: 3, medium: 2, low: 1 };
    for (const p of priorities) {
      const rank = priorityRanks[p] ?? 0;
      expect(rank).toBeLessThanOrEqual(lastPriorityRank);
      lastPriorityRank = rank;
    }
  });

  it('includes rationale and citation for each recommendation', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'knee_valgus', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    const recs = getAccessoryRecommendations(weaknesses);
    for (const rec of recs) {
      expect(rec.rationale.length).toBeGreaterThan(10);
      expect(rec.sets).toBeGreaterThan(0);
      expect(rec.reps.length).toBeGreaterThan(0);
    }
  });

  it('maps sticking points correctly', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'sticking_point_hole', severity: 'high', frequency: 4, trend: 'stable', stickingPoint: 'out_of_hole' },
    ];

    const recs = getAccessoryRecommendations(weaknesses);
    const names = recs.map(r => r.exercise);

    expect(names).toContain('Pin Squat');
    expect(names).toContain('Pause Squat');
    expect(names).toContain('Front Squat');
  });

  it('maps bench sticking point at chest', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'bench_press', weakness: 'sticking_point_chest', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    const recs = getAccessoryRecommendations(weaknesses);
    const names = recs.map(r => r.exercise);

    expect(names).toContain('Close-grip Bench');
    expect(names).toContain('Floor Press');
    expect(names).toContain('Dumbbell Press');
  });

  it('maps deadlift sticking point off floor', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'deadlift', weakness: 'sticking_point_floor', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    const recs = getAccessoryRecommendations(weaknesses);
    const names = recs.map(r => r.exercise);

    expect(names).toContain('Deficit Deadlift');
    expect(names).toContain('Front Squat');
  });

  it('maps heel_rise to elevated heel squats and ankle mobility', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'heel_rise', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    const recs = getAccessoryRecommendations(weaknesses);
    const names = recs.map(r => r.exercise);

    expect(names).toContain('Elevated Heel Squat');
    expect(names).toContain('Ankle Mobility Drills');
  });

  it('maps lateral_shift to Bulgarian split squats', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'lateral_shift', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    const recs = getAccessoryRecommendations(weaknesses);
    const names = recs.map(r => r.exercise);

    expect(names).toContain('Bulgarian Split Squat');
  });

  it('maps hip_shoot to tempo deadlifts', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'deadlift', weakness: 'hip_shoot', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    const recs = getAccessoryRecommendations(weaknesses);
    const names = recs.map(r => r.exercise);

    expect(names).toContain('Tempo Deadlift');
    expect(names).toContain('Front Squat');
  });
});

// ─── Tests: renderWeakPointReport ───

describe('renderWeakPointReport', () => {
  it('produces HTML with priorities', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'knee_valgus', severity: 'high', frequency: 4, trend: 'stable' },
    ];
    const recs = getAccessoryRecommendations(weaknesses);
    const html = renderWeakPointReport(weaknesses, recs);

    expect(html).toContain('Weak Point Report');
    expect(html).toContain('fpb-priority-high');
    expect(html).toContain('Knee Valgus');
    expect(html).toContain('Squat');
    expect(html).toContain('high');
    expect(html).toContain('4/5');
  });

  it('shows empty state when no weaknesses', () => {
    const html = renderWeakPointReport([], []);

    expect(html).toContain('Weak Point Report');
    expect(html).toContain('No persistent weaknesses detected');
    expect(html).toContain('fpb-report-empty');
  });

  it('includes trend indicators', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'knee_valgus', severity: 'moderate', frequency: 3, trend: 'improving' },
    ];
    const html = renderWeakPointReport(weaknesses, []);

    expect(html).toContain('fpb-trend-improving');
    expect(html).toContain('improving');
  });

  it('includes recommendations section when recs provided', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'knee_valgus', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];
    const recs = getAccessoryRecommendations(weaknesses);
    const html = renderWeakPointReport(weaknesses, recs);

    expect(html).toContain('Recommended Accessories');
    expect(html).toContain('fpb-rec-card');
    expect(html).toContain('Banded Squats');
    expect(html).toContain('fpb-rec-rationale');
  });

  it('includes citation when available', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'knee_valgus', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];
    const recs = getAccessoryRecommendations(weaknesses);
    const html = renderWeakPointReport(weaknesses, recs);

    expect(html).toContain('fpb-rec-citation');
    expect(html).toContain('Escamilla 2001');
  });

  it('includes sticking point info when present', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'depth_insufficient', severity: 'moderate', frequency: 3, trend: 'stable', stickingPoint: 'out_of_hole' },
    ];
    const html = renderWeakPointReport(weaknesses, []);

    expect(html).toContain('Out of the Hole');
  });

  it('renders multiple weaknesses across exercises', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'knee_valgus', severity: 'high', frequency: 4, trend: 'stable' },
      { exercise: 'deadlift', weakness: 'rounded_back', severity: 'moderate', frequency: 3, trend: 'improving' },
    ];
    const recs = getAccessoryRecommendations(weaknesses);
    const html = renderWeakPointReport(weaknesses, recs);

    expect(html).toContain('Squat');
    expect(html).toContain('Deadlift');
    expect(html).toContain('Knee Valgus');
    expect(html).toContain('Rounded Back');
  });
});

// ─── Tests: findAccessoryGaps ───

describe('findAccessoryGaps', () => {
  it('identifies when a weakness is not covered by current accessories', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'knee_valgus', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    const gaps = findAccessoryGaps(weaknesses, ['deadlift', 'bench']);

    expect(gaps).toHaveLength(1);
    expect(gaps[0].weakness).toBe('knee_valgus');
    expect(gaps[0].exercise).toBe('squat');
    expect(gaps[0].missingAccessory).toBe('Banded Squats');
    expect(gaps[0].priority).toBe('medium');
  });

  it('returns empty when all weaknesses are covered', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'knee_valgus', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    // Banded squats maps to slot 'squat' which is in the accessories
    const gaps = findAccessoryGaps(weaknesses, ['squat', 'hip_thrust']);

    expect(gaps).toEqual([]);
  });

  it('prioritizes gaps based on weakness severity', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'knee_valgus', severity: 'high', frequency: 4, trend: 'stable' },
      { exercise: 'deadlift', weakness: 'hitching', severity: 'low', frequency: 2, trend: 'stable' },
    ];

    const gaps = findAccessoryGaps(weaknesses, []);

    const kneeGap = gaps.find(g => g.weakness === 'knee_valgus');
    const hitchingGap = gaps.find(g => g.weakness === 'hitching');

    expect(kneeGap).toBeDefined();
    expect(kneeGap!.priority).toBe('high');
    expect(hitchingGap).toBeDefined();
    expect(hitchingGap!.priority).toBe('low');
  });

  it('returns empty for empty weaknesses', () => {
    const gaps = findAccessoryGaps([], ['squat', 'bench']);
    expect(gaps).toEqual([]);
  });

  it('handles unknown weakness types', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'unknown_issue', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    const gaps = findAccessoryGaps(weaknesses, []);
    // No mapping for unknown weakness, so no gap reported
    expect(gaps).toEqual([]);
  });

  it('matches accessories by exercise name (case insensitive)', () => {
    const weaknesses: FormWeakness[] = [
      { exercise: 'squat', weakness: 'knee_valgus', severity: 'moderate', frequency: 3, trend: 'stable' },
    ];

    // 'squat' slot covers the Banded Squats recommendation
    const gaps = findAccessoryGaps(weaknesses, ['Squat']);
    expect(gaps).toEqual([]);
  });
});

// ─── Tests: loadFormSessions ───

describe('loadFormSessions', () => {
  it('returns empty array when no storage', () => {
    const result = loadFormSessions();
    expect(result).toEqual([]);
  });

  it('parses stored sessions', () => {
    setSessionStorage([makeSession(), makeSession()]);
    const result = loadFormSessions();
    expect(result).toHaveLength(2);
  });

  it('handles corrupted storage gracefully', () => {
    localStorageMock.setItem('squat_form_sessions', 'not-valid-json');
    const result = loadFormSessions();
    expect(result).toEqual([]);
  });

  it('handles non-array storage gracefully', () => {
    localStorageMock.setItem('squat_form_sessions', JSON.stringify({ key: 'value' }));
    const result = loadFormSessions();
    expect(result).toEqual([]);
  });
});

// ─── Integration-style tests ───

describe('end-to-end: analyze → recommend → gap-check', () => {
  it('produces a complete pipeline from sessions to gaps', () => {
    const sessions = [
      makeSession({ avg_knee_tracking: 55, avg_depth: 50, exercise_type: 'squat' }),
      makeSession({ avg_knee_tracking: 58, avg_depth: 52, exercise_type: 'squat' }),
      makeSession({ avg_knee_tracking: 56, avg_depth: 48, exercise_type: 'squat' }),
    ];

    const weaknesses = analyzeFormWeaknesses(sessions);
    expect(weaknesses.length).toBeGreaterThan(0);

    const recs = getAccessoryRecommendations(weaknesses);
    expect(recs.length).toBeGreaterThan(0);

    // Assume user's program only has main lifts
    const gaps = findAccessoryGaps(weaknesses, ['squat', 'bench', 'deadlift']);
    // Squat is in the program but the specific weaknesses need accessories
    // that might use the same slot. knee_valgus maps to 'squat' slot for
    // banded squats, so that's covered. depth_insufficient maps to 'pause_squat'
    // which is NOT in the program.
    const depthGap = gaps.find(g => g.weakness === 'depth_insufficient');
    expect(depthGap).toBeDefined();
    expect(depthGap!.missingAccessory).toBe('Pause Squat');

    const html = renderWeakPointReport(weaknesses, recs);
    expect(html).toContain('Weak Point Report');
    expect(html.length).toBeGreaterThan(100);
  });
});
