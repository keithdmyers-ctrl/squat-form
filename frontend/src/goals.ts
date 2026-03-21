/**
 * Goal-setting and progress tracking for the Lift Form Analyzer.
 *
 * Users can set up to 3 active goals targeting specific score dimensions
 * (e.g. depth >= 80, overall >= 90). A goal is marked "achieved" after
 * 3 consecutive sessions that meet or exceed the target.
 */

import type { SessionRecord } from './types';

export const GOALS_STORAGE_KEY = 'squat_form_goals';
export const MAX_ACTIVE_GOALS = 3;
export const CONSECUTIVE_HITS_REQUIRED = 3;

export interface GoalRecord {
  id: string;
  dimension: string;  // 'depth' | 'kneeTracking' | 'trunk' | 'symmetry' | 'tempo' | 'lockout' | 'overall'
  targetScore: number;  // 0-100
  exerciseType: string;
  createdAt: string;  // ISO date
  status: 'active' | 'achieved' | 'abandoned';
  achievedAt?: string;
  consecutiveHits: number;  // need 3 consecutive to mark achieved
}

/** Map dimension keys to the SessionRecord average field names. */
const DIMENSION_SESSION_KEY: Record<string, keyof SessionRecord> = {
  depth: 'avg_depth',
  kneeTracking: 'avg_knee_tracking',
  trunk: 'avg_trunk',
  symmetry: 'avg_symmetry',
  tempo: 'avg_tempo',
  lockout: 'avg_lockout',
  overall: 'overall_score',
};

/** Human-readable dimension labels (generic fallback; exercise-specific labels come from exercise-core). */
export const DIMENSION_LABELS: Record<string, string> = {
  depth: 'Depth',
  kneeTracking: 'Knee Tracking',
  trunk: 'Torso Position',
  symmetry: 'Symmetry',
  tempo: 'Tempo',
  lockout: 'Lockout',
  overall: 'Overall',
};

/** Load goals from localStorage. */
export function loadGoals(): GoalRecord[] {
  try {
    return JSON.parse(localStorage.getItem(GOALS_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

/** Save goals to localStorage. */
export function saveGoals(goals: GoalRecord[]): void {
  try {
    localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(goals));
  } catch {
    document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' }));
  }
}

/** Create a new goal. Returns the goal or null if max active goals reached. */
export function createGoal(
  dimension: string,
  targetScore: number,
  exerciseType: string,
): GoalRecord | null {
  const goals = loadGoals();
  const activeCount = goals.filter(g => g.status === 'active').length;
  if (activeCount >= MAX_ACTIVE_GOALS) return null;

  // Clamp target score to 60-100
  const clampedTarget = Math.max(60, Math.min(100, Math.round(targetScore)));

  const goal: GoalRecord = {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2),
    dimension,
    targetScore: clampedTarget,
    exerciseType,
    createdAt: new Date().toISOString(),
    status: 'active',
    consecutiveHits: 0,
  };

  goals.push(goal);
  saveGoals(goals);
  return goal;
}

/** Remove (abandon) a goal by id. */
export function removeGoal(goalId: string): void {
  const goals = loadGoals();
  const idx = goals.findIndex(g => g.id === goalId);
  if (idx >= 0) {
    goals[idx].status = 'abandoned';
    saveGoals(goals);
  }
}

/**
 * Get the score for a specific dimension from a session.
 * Uses the session's avg_* fields for dimensions, or overall_score for 'overall'.
 */
export function getSessionDimensionScore(
  session: SessionRecord,
  dimension: string,
): number | undefined {
  const key = DIMENSION_SESSION_KEY[dimension];
  if (!key) return undefined;
  const val = session[key];
  return typeof val === 'number' ? val : undefined;
}

/**
 * Check all active goals against a new session.
 * Updates consecutive hit counts, marks goals as achieved after 3 consecutive hits,
 * and returns celebrations for newly achieved goals.
 */
export function checkGoals(
  goals: GoalRecord[],
  session: SessionRecord,
): { updatedGoals: GoalRecord[]; celebrations: string[] } {
  const celebrations: string[] = [];
  const updatedGoals = goals.map(g => ({ ...g }));

  for (const goal of updatedGoals) {
    if (goal.status !== 'active') continue;

    // Check exercise type match
    const sessionExType = session.exercise_type ?? 'squat';
    if (goal.exerciseType !== sessionExType) continue;

    const score = getSessionDimensionScore(session, goal.dimension);
    if (score === undefined) continue;

    if (score >= goal.targetScore) {
      goal.consecutiveHits += 1;
      if (goal.consecutiveHits >= CONSECUTIVE_HITS_REQUIRED) {
        goal.status = 'achieved';
        goal.achievedAt = new Date().toISOString();
        const label = DIMENSION_LABELS[goal.dimension] ?? goal.dimension;
        celebrations.push(
          `Goal Achieved! ${label} reached ${goal.targetScore}+ for ${CONSECUTIVE_HITS_REQUIRED} consecutive sessions!`,
        );
      }
    } else {
      // Reset consecutive counter on miss
      goal.consecutiveHits = 0;
    }
  }

  return { updatedGoals, celebrations };
}

/** Get only active goals. */
export function getActiveGoals(goals: GoalRecord[]): GoalRecord[] {
  return goals.filter(g => g.status === 'active');
}

/** Get the current average score for a goal's dimension from recent sessions. */
export function getCurrentAvgForGoal(
  goal: GoalRecord,
  sessions: SessionRecord[],
  count: number = 5,
): number | undefined {
  const matching = sessions
    .filter(s => (s.exercise_type ?? 'squat') === goal.exerciseType)
    .slice(0, count);

  if (matching.length === 0) return undefined;

  const scores = matching
    .map(s => getSessionDimensionScore(s, goal.dimension))
    .filter((v): v is number => v !== undefined);

  if (scores.length === 0) return undefined;

  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}
