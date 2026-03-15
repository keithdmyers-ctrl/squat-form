import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadGoals,
  saveGoals,
  createGoal,
  removeGoal,
  checkGoals,
  getActiveGoals,
  getCurrentAvgForGoal,
  getSessionDimensionScore,
  GOALS_STORAGE_KEY,
  MAX_ACTIVE_GOALS,
  CONSECUTIVE_HITS_REQUIRED,
} from '../goals';
import type { GoalRecord } from '../goals';
import type { SessionRecord } from '../types';

// ─── Helpers ───

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'test-session-1',
    date: new Date().toISOString(),
    squat_type: 'high_bar',
    experience_level: 'intermediate',
    rep_count: 5,
    overall_score: 75,
    grade: 'B',
    top_issue: null,
    positive_count: 2,
    exercise_type: 'squat',
    avg_depth: 80,
    avg_knee_tracking: 70,
    avg_trunk: 85,
    avg_symmetry: 90,
    avg_tempo: 65,
    avg_lockout: 75,
    ...overrides,
  };
}

function makeGoal(overrides: Partial<GoalRecord> = {}): GoalRecord {
  return {
    id: 'goal-1',
    dimension: 'depth',
    targetScore: 80,
    exerciseType: 'squat',
    createdAt: new Date().toISOString(),
    status: 'active',
    consecutiveHits: 0,
    ...overrides,
  };
}

// ─── localStorage mock ───

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

// ─── Tests ───

describe('Goals module', () => {
  beforeEach(() => {
    const mockStorage = createLocalStorageMock();
    vi.stubGlobal('localStorage', mockStorage);
    vi.stubGlobal('crypto', {
      randomUUID: () => 'mock-uuid-' + Math.random().toString(36).slice(2, 8),
    });
  });

  // ─── Load / Save ───

  describe('loadGoals', () => {
    it('returns empty array when no goals saved', () => {
      expect(loadGoals()).toEqual([]);
    });

    it('returns saved goals', () => {
      const goals = [makeGoal()];
      localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(goals));
      expect(loadGoals()).toEqual(goals);
    });

    it('returns empty array for corrupted JSON', () => {
      localStorage.setItem(GOALS_STORAGE_KEY, 'not json');
      expect(loadGoals()).toEqual([]);
    });
  });

  describe('saveGoals', () => {
    it('persists goals to localStorage', () => {
      const goals = [makeGoal()];
      saveGoals(goals);
      const stored = JSON.parse(localStorage.getItem(GOALS_STORAGE_KEY)!);
      expect(stored).toEqual(goals);
    });

    it('overwrites existing goals', () => {
      saveGoals([makeGoal({ id: 'old' })]);
      saveGoals([makeGoal({ id: 'new' })]);
      const stored = JSON.parse(localStorage.getItem(GOALS_STORAGE_KEY)!);
      expect(stored.length).toBe(1);
      expect(stored[0].id).toBe('new');
    });
  });

  // ─── Create Goal ───

  describe('createGoal', () => {
    it('creates a new active goal', () => {
      const goal = createGoal('depth', 80, 'squat');
      expect(goal).not.toBeNull();
      expect(goal!.dimension).toBe('depth');
      expect(goal!.targetScore).toBe(80);
      expect(goal!.exerciseType).toBe('squat');
      expect(goal!.status).toBe('active');
      expect(goal!.consecutiveHits).toBe(0);
    });

    it('clamps target score to 60-100', () => {
      const low = createGoal('depth', 30, 'squat');
      expect(low!.targetScore).toBe(60);

      localStorage.clear();
      const high = createGoal('depth', 150, 'squat');
      expect(high!.targetScore).toBe(100);
    });

    it('saves goal to localStorage', () => {
      createGoal('depth', 80, 'squat');
      const stored = loadGoals();
      expect(stored.length).toBe(1);
    });

    it('returns null when max active goals reached', () => {
      for (let i = 0; i < MAX_ACTIVE_GOALS; i++) {
        createGoal('depth', 80 + i, 'squat');
      }
      const result = createGoal('overall', 90, 'squat');
      expect(result).toBeNull();
    });

    it('allows creating goal when existing goals are achieved/abandoned', () => {
      // Fill up with achieved goals
      saveGoals([
        makeGoal({ id: 'a1', status: 'achieved' }),
        makeGoal({ id: 'a2', status: 'achieved' }),
        makeGoal({ id: 'a3', status: 'abandoned' }),
      ]);
      const goal = createGoal('overall', 85, 'squat');
      expect(goal).not.toBeNull();
    });
  });

  // ─── Remove Goal ───

  describe('removeGoal', () => {
    it('marks goal as abandoned', () => {
      saveGoals([makeGoal({ id: 'g1' })]);
      removeGoal('g1');
      const goals = loadGoals();
      expect(goals[0].status).toBe('abandoned');
    });

    it('does nothing for non-existent goal id', () => {
      saveGoals([makeGoal({ id: 'g1' })]);
      removeGoal('nonexistent');
      const goals = loadGoals();
      expect(goals[0].status).toBe('active');
    });
  });

  // ─── getSessionDimensionScore ───

  describe('getSessionDimensionScore', () => {
    it('returns correct scores for each dimension', () => {
      const session = makeSession({
        avg_depth: 85,
        avg_knee_tracking: 72,
        avg_trunk: 90,
        avg_symmetry: 88,
        avg_tempo: 60,
        avg_lockout: 77,
        overall_score: 79,
      });

      expect(getSessionDimensionScore(session, 'depth')).toBe(85);
      expect(getSessionDimensionScore(session, 'kneeTracking')).toBe(72);
      expect(getSessionDimensionScore(session, 'trunk')).toBe(90);
      expect(getSessionDimensionScore(session, 'symmetry')).toBe(88);
      expect(getSessionDimensionScore(session, 'tempo')).toBe(60);
      expect(getSessionDimensionScore(session, 'lockout')).toBe(77);
      expect(getSessionDimensionScore(session, 'overall')).toBe(79);
    });

    it('returns undefined for unknown dimension', () => {
      expect(getSessionDimensionScore(makeSession(), 'nonexistent')).toBeUndefined();
    });

    it('returns undefined when session lacks the field', () => {
      const session = makeSession({ avg_depth: undefined });
      expect(getSessionDimensionScore(session, 'depth')).toBeUndefined();
    });
  });

  // ─── Check Goals ───

  describe('checkGoals', () => {
    it('increments consecutiveHits on score meeting target', () => {
      const goals = [makeGoal({ dimension: 'depth', targetScore: 80 })];
      const session = makeSession({ avg_depth: 85 });
      const { updatedGoals, celebrations } = checkGoals(goals, session);
      expect(updatedGoals[0].consecutiveHits).toBe(1);
      expect(celebrations).toEqual([]);
    });

    it('resets consecutiveHits on score missing target', () => {
      const goals = [makeGoal({ dimension: 'depth', targetScore: 80, consecutiveHits: 2 })];
      const session = makeSession({ avg_depth: 70 });
      const { updatedGoals } = checkGoals(goals, session);
      expect(updatedGoals[0].consecutiveHits).toBe(0);
    });

    it('achieves goal after 3 consecutive hits', () => {
      const goals = [makeGoal({ dimension: 'depth', targetScore: 80, consecutiveHits: 2 })];
      const session = makeSession({ avg_depth: 85 });
      const { updatedGoals, celebrations } = checkGoals(goals, session);
      expect(updatedGoals[0].status).toBe('achieved');
      expect(updatedGoals[0].achievedAt).toBeDefined();
      expect(celebrations.length).toBe(1);
      expect(celebrations[0]).toContain('Goal Achieved');
      expect(celebrations[0]).toContain('Depth');
    });

    it('produces celebration with dimension name', () => {
      const goals = [makeGoal({ dimension: 'overall', targetScore: 90, consecutiveHits: 2 })];
      const session = makeSession({ overall_score: 95 });
      const { celebrations } = checkGoals(goals, session);
      expect(celebrations[0]).toContain('Overall');
      expect(celebrations[0]).toContain('90');
    });

    it('skips goals with non-matching exercise type', () => {
      const goals = [makeGoal({ exerciseType: 'deadlift', consecutiveHits: 0 })];
      const session = makeSession({ exercise_type: 'squat', avg_depth: 95 });
      const { updatedGoals } = checkGoals(goals, session);
      expect(updatedGoals[0].consecutiveHits).toBe(0);
    });

    it('skips already achieved goals', () => {
      const goals = [makeGoal({ status: 'achieved', consecutiveHits: 3 })];
      const session = makeSession({ avg_depth: 95 });
      const { updatedGoals, celebrations } = checkGoals(goals, session);
      expect(updatedGoals[0].consecutiveHits).toBe(3);
      expect(celebrations).toEqual([]);
    });

    it('skips abandoned goals', () => {
      const goals = [makeGoal({ status: 'abandoned' })];
      const session = makeSession({ avg_depth: 95 });
      const { updatedGoals } = checkGoals(goals, session);
      expect(updatedGoals[0].status).toBe('abandoned');
    });

    it('handles no active goals', () => {
      const { updatedGoals, celebrations } = checkGoals([], makeSession());
      expect(updatedGoals).toEqual([]);
      expect(celebrations).toEqual([]);
    });

    it('handles session with default exercise_type', () => {
      const goals = [makeGoal({ exerciseType: 'squat' })];
      const session = makeSession({ exercise_type: undefined, avg_depth: 90 });
      const { updatedGoals } = checkGoals(goals, session);
      // exercise_type defaults to 'squat'
      expect(updatedGoals[0].consecutiveHits).toBe(1);
    });

    it('handles exact target score (boundary)', () => {
      const goals = [makeGoal({ dimension: 'depth', targetScore: 80 })];
      const session = makeSession({ avg_depth: 80 });
      const { updatedGoals } = checkGoals(goals, session);
      expect(updatedGoals[0].consecutiveHits).toBe(1);
    });

    it('handles score just below target', () => {
      const goals = [makeGoal({ dimension: 'depth', targetScore: 80 })];
      const session = makeSession({ avg_depth: 79 });
      const { updatedGoals } = checkGoals(goals, session);
      expect(updatedGoals[0].consecutiveHits).toBe(0);
    });

    it('checks multiple goals independently', () => {
      const goals = [
        makeGoal({ id: 'g1', dimension: 'depth', targetScore: 80 }),
        makeGoal({ id: 'g2', dimension: 'overall', targetScore: 90 }),
      ];
      const session = makeSession({ avg_depth: 85, overall_score: 70 });
      const { updatedGoals } = checkGoals(goals, session);
      expect(updatedGoals[0].consecutiveHits).toBe(1); // depth hit
      expect(updatedGoals[1].consecutiveHits).toBe(0); // overall missed
    });

    it('achieves multiple goals simultaneously', () => {
      const goals = [
        makeGoal({ id: 'g1', dimension: 'depth', targetScore: 80, consecutiveHits: 2 }),
        makeGoal({ id: 'g2', dimension: 'trunk', targetScore: 80, consecutiveHits: 2 }),
      ];
      const session = makeSession({ avg_depth: 90, avg_trunk: 85 });
      const { celebrations } = checkGoals(goals, session);
      expect(celebrations.length).toBe(2);
    });
  });

  // ─── getActiveGoals ───

  describe('getActiveGoals', () => {
    it('returns only active goals', () => {
      const goals = [
        makeGoal({ id: 'g1', status: 'active' }),
        makeGoal({ id: 'g2', status: 'achieved' }),
        makeGoal({ id: 'g3', status: 'abandoned' }),
        makeGoal({ id: 'g4', status: 'active' }),
      ];
      const active = getActiveGoals(goals);
      expect(active.length).toBe(2);
      expect(active.map(g => g.id)).toEqual(['g1', 'g4']);
    });
  });

  // ─── getCurrentAvgForGoal ───

  describe('getCurrentAvgForGoal', () => {
    it('returns average from matching sessions', () => {
      const goal = makeGoal({ dimension: 'depth', exerciseType: 'squat' });
      const sessions = [
        makeSession({ avg_depth: 80 }),
        makeSession({ avg_depth: 90 }),
        makeSession({ avg_depth: 70 }),
      ];
      expect(getCurrentAvgForGoal(goal, sessions, 5)).toBe(80);
    });

    it('returns undefined when no matching sessions', () => {
      const goal = makeGoal({ exerciseType: 'deadlift' });
      const sessions = [makeSession({ exercise_type: 'squat' })];
      expect(getCurrentAvgForGoal(goal, sessions)).toBeUndefined();
    });

    it('filters by exercise type', () => {
      const goal = makeGoal({ dimension: 'depth', exerciseType: 'deadlift' });
      const sessions = [
        makeSession({ exercise_type: 'squat', avg_depth: 50 }),
        makeSession({ exercise_type: 'deadlift', avg_depth: 90 }),
        makeSession({ exercise_type: 'deadlift', avg_depth: 80 }),
      ];
      expect(getCurrentAvgForGoal(goal, sessions)).toBe(85);
    });

    it('uses at most count sessions', () => {
      const goal = makeGoal({ dimension: 'overall', exerciseType: 'squat' });
      const sessions = Array.from({ length: 10 }, (_, i) =>
        makeSession({ overall_score: i < 3 ? 90 : 60 }),
      );
      // With count=3, only first 3 sessions (score=90) should be used
      expect(getCurrentAvgForGoal(goal, sessions, 3)).toBe(90);
    });

    it('returns undefined when dimension data missing from sessions', () => {
      const goal = makeGoal({ dimension: 'depth', exerciseType: 'squat' });
      const sessions = [makeSession({ avg_depth: undefined })];
      expect(getCurrentAvgForGoal(goal, sessions)).toBeUndefined();
    });
  });

  // ─── CONSECUTIVE_HITS_REQUIRED constant ───

  describe('constants', () => {
    it('requires 3 consecutive hits', () => {
      expect(CONSECUTIVE_HITS_REQUIRED).toBe(3);
    });

    it('allows max 3 active goals', () => {
      expect(MAX_ACTIVE_GOALS).toBe(3);
    });
  });
});
