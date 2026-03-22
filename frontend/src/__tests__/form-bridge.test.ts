import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getRecentFormScores, getRecentWeakDimensions } from '../form-bridge';

// ── localStorage mock ──

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

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

beforeEach(() => {
  localStorageMock.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
});

// ── Helpers ──

interface MockSession {
  exercise_type?: string;
  overall_score?: number;
  date?: string;
  avg_depth?: number;
  avg_knee_tracking?: number;
  avg_trunk?: number;
  avg_symmetry?: number;
  avg_tempo?: number;
  avg_lockout?: number;
}

function storeSessions(sessions: MockSession[]): void {
  localStorageMock.setItem('squat_form_sessions', JSON.stringify(sessions));
}

// ── getRecentFormScores ──

describe('getRecentFormScores', () => {
  it('returns empty object when no sessions stored', () => {
    expect(getRecentFormScores()).toEqual({});
  });

  it('returns empty object when localStorage key is missing', () => {
    expect(getRecentFormScores()).toEqual({});
    expect(localStorageMock.getItem).toHaveBeenCalledWith('squat_form_sessions');
  });

  it('returns empty object on corrupted JSON', () => {
    localStorageMock.setItem('squat_form_sessions', '{invalid json');
    expect(getRecentFormScores()).toEqual({});
  });

  it('maps squat session to "squat" key', () => {
    storeSessions([{ exercise_type: 'squat', overall_score: 85 }]);
    const scores = getRecentFormScores();
    expect(scores.squat).toBe(85);
  });

  it('maps deadlift session to "deadlift" key', () => {
    storeSessions([{ exercise_type: 'deadlift', overall_score: 78 }]);
    const scores = getRecentFormScores();
    expect(scores.deadlift).toBe(78);
  });

  it('maps bench_press session to "bench" key', () => {
    storeSessions([{ exercise_type: 'bench_press', overall_score: 90 }]);
    const scores = getRecentFormScores();
    expect(scores.bench).toBe(90);
  });

  it('maps overhead_press session to "ohp" key', () => {
    storeSessions([{ exercise_type: 'overhead_press', overall_score: 72 }]);
    const scores = getRecentFormScores();
    expect(scores.ohp).toBe(72);
  });

  it('maps barbell_row session to "row" key', () => {
    storeSessions([{ exercise_type: 'barbell_row', overall_score: 80 }]);
    const scores = getRecentFormScores();
    expect(scores.row).toBe(80);
  });

  it('maps lunge session to "lunge" key', () => {
    storeSessions([{ exercise_type: 'lunge', overall_score: 88 }]);
    const scores = getRecentFormScores();
    expect(scores.lunge).toBe(88);
  });

  it('returns most recent score per exercise (first encountered)', () => {
    storeSessions([
      { exercise_type: 'squat', overall_score: 90, date: '2026-03-20' },
      { exercise_type: 'squat', overall_score: 70, date: '2026-03-19' },
    ]);
    const scores = getRecentFormScores();
    expect(scores.squat).toBe(90);
  });

  it('returns scores for multiple exercises', () => {
    storeSessions([
      { exercise_type: 'squat', overall_score: 85 },
      { exercise_type: 'deadlift', overall_score: 78 },
      { exercise_type: 'bench_press', overall_score: 92 },
    ]);
    const scores = getRecentFormScores();
    expect(scores.squat).toBe(85);
    expect(scores.deadlift).toBe(78);
    expect(scores.bench).toBe(92);
  });

  it('defaults to "squat" when exercise_type is undefined', () => {
    storeSessions([{ overall_score: 75 }]);
    const scores = getRecentFormScores();
    expect(scores.squat).toBe(75);
  });

  it('skips sessions without overall_score', () => {
    storeSessions([
      { exercise_type: 'squat' }, // no overall_score
      { exercise_type: 'squat', overall_score: 80 },
    ]);
    const scores = getRecentFormScores();
    expect(scores.squat).toBe(80);
  });

  it('handles overall_score of 0', () => {
    storeSessions([{ exercise_type: 'squat', overall_score: 0 }]);
    const scores = getRecentFormScores();
    // 0 !== undefined, so it should be included
    expect(scores.squat).toBe(0);
  });

  it('ignores unknown exercise types', () => {
    storeSessions([{ exercise_type: 'zumba', overall_score: 99 }]);
    const scores = getRecentFormScores();
    expect(Object.keys(scores)).toHaveLength(0);
  });

  it('handles empty sessions array', () => {
    storeSessions([]);
    expect(getRecentFormScores()).toEqual({});
  });
});

// ── getRecentWeakDimensions ──

describe('getRecentWeakDimensions', () => {
  it('returns empty object when no sessions stored', () => {
    expect(getRecentWeakDimensions('squat')).toEqual({});
  });

  it('returns empty object when localStorage key is missing', () => {
    expect(getRecentWeakDimensions('squat')).toEqual({});
  });

  it('returns empty object on corrupted JSON', () => {
    localStorageMock.setItem('squat_form_sessions', 'not-json!');
    expect(getRecentWeakDimensions('squat')).toEqual({});
  });

  it('returns dimension scores for matching exercise type', () => {
    storeSessions([{
      exercise_type: 'squat',
      avg_depth: 85,
      avg_knee_tracking: 70,
      avg_trunk: 90,
      avg_symmetry: 80,
      avg_tempo: 65,
      avg_lockout: 75,
    }]);
    const dims = getRecentWeakDimensions('squat');
    expect(dims.depth).toBe(85);
    expect(dims.kneeTracking).toBe(70);
    expect(dims.trunk).toBe(90);
    expect(dims.symmetry).toBe(80);
    expect(dims.tempo).toBe(65);
    expect(dims.lockout).toBe(75);
  });

  it('returns empty object when no matching exercise type', () => {
    storeSessions([{ exercise_type: 'deadlift', avg_depth: 80 }]);
    expect(getRecentWeakDimensions('squat')).toEqual({});
  });

  it('returns first matching session (most recent)', () => {
    storeSessions([
      { exercise_type: 'squat', avg_depth: 95 },
      { exercise_type: 'squat', avg_depth: 60 },
    ]);
    const dims = getRecentWeakDimensions('squat');
    expect(dims.depth).toBe(95);
  });

  it('only includes dimensions that are present', () => {
    storeSessions([{
      exercise_type: 'bench_press',
      avg_depth: 80,
      // no other dimension scores
    }]);
    const dims = getRecentWeakDimensions('bench_press');
    expect(dims.depth).toBe(80);
    expect(dims.kneeTracking).toBeUndefined();
    expect(dims.trunk).toBeUndefined();
  });

  it('defaults exercise_type to "squat" for sessions without explicit type', () => {
    storeSessions([{
      avg_depth: 75,
      avg_trunk: 80,
    }]);
    const dims = getRecentWeakDimensions('squat');
    expect(dims.depth).toBe(75);
    expect(dims.trunk).toBe(80);
  });

  it('handles empty sessions array', () => {
    storeSessions([]);
    expect(getRecentWeakDimensions('squat')).toEqual({});
  });

  it('handles sessions with only some dimension scores', () => {
    storeSessions([{
      exercise_type: 'deadlift',
      avg_depth: 88,
      avg_lockout: 92,
    }]);
    const dims = getRecentWeakDimensions('deadlift');
    expect(dims.depth).toBe(88);
    expect(dims.lockout).toBe(92);
    expect(Object.keys(dims)).toHaveLength(2);
  });

  it('handles dimension score of 0', () => {
    storeSessions([{
      exercise_type: 'squat',
      avg_depth: 0,
    }]);
    const dims = getRecentWeakDimensions('squat');
    // 0 !== undefined, so it should be included
    expect(dims.depth).toBe(0);
  });
});
