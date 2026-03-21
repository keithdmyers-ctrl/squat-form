/**
 * Form score bridge: connects the form analysis system (squat_form_sessions)
 * with the workout programming engine.
 *
 * No dependencies on other program-generator submodules.
 * Reads directly from localStorage.
 */

// ─── Form Score Bridge ───

/**
 * Get the most recent form analysis scores for each main lift.
 * Bridges the form analysis system (squat_form_sessions) with the workout planner.
 *
 * Returns a map of exercise slot → average dimension score from the most recent
 * matching form analysis session.
 */
export function getRecentFormScores(): Record<string, number> {
  try {
    const raw = localStorage.getItem('squat_form_sessions');
    if (!raw) return {};
    const sessions = JSON.parse(raw) as Array<{
      exercise_type?: string;
      overall_score?: number;
      date?: string;
    }>;

    const scores: Record<string, number> = {};
    const exerciseMap: Record<string, string> = {
      squat: 'squat',
      deadlift: 'deadlift',
      bench_press: 'bench',
      overhead_press: 'ohp',
      barbell_row: 'row',
      lunge: 'lunge',
    };

    // Get most recent score per exercise type
    for (const session of sessions) {
      const slotKey = exerciseMap[session.exercise_type ?? 'squat'];
      if (slotKey && session.overall_score !== undefined && !scores[slotKey]) {
        scores[slotKey] = session.overall_score;
      }
    }

    return scores;
  } catch {
    return {};
  }
}

/**
 * Get weak dimensions from the most recent form analysis for accessory recommendations.
 */
export function getRecentWeakDimensions(exerciseType: string): Record<string, number> {
  try {
    const raw = localStorage.getItem('squat_form_sessions');
    if (!raw) return {};
    const sessions = JSON.parse(raw) as Array<{
      exercise_type?: string;
      avg_depth?: number;
      avg_knee_tracking?: number;
      avg_trunk?: number;
      avg_symmetry?: number;
      avg_tempo?: number;
      avg_lockout?: number;
    }>;

    // Find most recent session for this exercise type
    const session = sessions.find(s => (s.exercise_type ?? 'squat') === exerciseType);
    if (!session) return {};

    const dims: Record<string, number> = {};
    if (session.avg_depth !== undefined) dims.depth = session.avg_depth;
    if (session.avg_knee_tracking !== undefined) dims.kneeTracking = session.avg_knee_tracking;
    if (session.avg_trunk !== undefined) dims.trunk = session.avg_trunk;
    if (session.avg_symmetry !== undefined) dims.symmetry = session.avg_symmetry;
    if (session.avg_tempo !== undefined) dims.tempo = session.avg_tempo;
    if (session.avg_lockout !== undefined) dims.lockout = session.avg_lockout;

    return dims;
  } catch {
    return {};
  }
}
