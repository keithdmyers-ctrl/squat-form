/**
 * Periodized programming recommendations.
 * Generates training prescriptions (sets, reps, intensity, rest) based on
 * the selected training phase and optional 1RM estimate. Also adjusts
 * scoring weights per phase and suggests the next phase from recent history.
 */

export type TrainingPhase = 'hypertrophy' | 'strength' | 'peaking' | 'deload';

export interface ProgrammingRecommendation {
  phase: TrainingPhase;
  sets: number;
  reps: string;          // e.g., "8-12" or "1-3"
  intensity: string;     // e.g., "65-75% 1RM" or "RPE 7-8"
  restMinutes: string;   // e.g., "1-2" or "3-5"
  focusAreas: string[];
  notes: string[];
  /** Optional weight range when 1RM is known (e.g., [185, 210]). */
  weightRange?: [number, number];
  /** Unit for weightRange (e.g., "lbs" or "kg"). */
  weightUnit?: string;
}

export const PHASE_DESCRIPTIONS: Record<TrainingPhase, string> = {
  hypertrophy: 'Build muscle and work capacity with moderate loads and higher volume',
  strength: 'Build maximal strength with heavier loads and lower reps',
  peaking: 'Prepare for competition or testing with near-maximal loads',
  deload: 'Recovery week with reduced volume and intensity',
};

// ─── Phase-specific prescription templates ───

interface PhaseTemplate {
  sets: number;
  reps: string;
  intensityPercent: [number, number]; // min/max % of 1RM
  rpe: string;
  restMinutes: string;
  focusAreas: string[];
  notes: string[];
}

const PHASE_TEMPLATES: Record<TrainingPhase, PhaseTemplate> = {
  hypertrophy: {
    sets: 4,
    reps: '8-12',
    intensityPercent: [65, 75],
    rpe: 'RPE 7-8',
    restMinutes: '1-2',
    focusAreas: [
      'Full range of motion (depth)',
      'Controlled tempo (2-3s eccentric)',
      'Mind-muscle connection',
      'Symmetrical movement pattern',
    ],
    notes: [
      'Focus on time under tension with controlled reps',
      'Use a tempo that allows you to feel the muscles working',
      'Prioritize proper form over heavier weight',
    ],
  },
  strength: {
    sets: 5,
    reps: '3-5',
    intensityPercent: [80, 90],
    rpe: 'RPE 8-9',
    restMinutes: '3-5',
    focusAreas: [
      'Trunk stability under heavy load',
      'Strong lockout at the top',
      'Bracing and breathing pattern',
      'Bar path efficiency',
    ],
    notes: [
      'Take full rest between sets to maintain intensity',
      'Focus on explosive concentric movement',
      'Technique consistency is critical at these loads',
    ],
  },
  peaking: {
    sets: 4,
    reps: '1-3',
    intensityPercent: [90, 100],
    rpe: 'RPE 9-10',
    restMinutes: '5+',
    focusAreas: [
      'Competition depth (at or below parallel)',
      'Complete lockout (knees and hips)',
      'Command readiness (pause and rack commands)',
      'Mental preparation and confidence',
    ],
    notes: [
      'Reduce total volume while maintaining or increasing intensity',
      'Practice competition commands if preparing for a meet',
      'Monitor recovery closely -- fatigue can mask fitness',
    ],
  },
  deload: {
    sets: 3,
    reps: '5-8',
    intensityPercent: [50, 60],
    rpe: 'RPE 5-6',
    restMinutes: '2-3',
    focusAreas: [
      'Movement quality and technique refinement',
      'Mobility and flexibility work',
      'Identifying and correcting imbalances',
      'Active recovery',
    ],
    notes: [
      'Keep weights light -- this week is about recovery',
      'Use this time to address any nagging aches or mobility issues',
      'A good deload sets you up for stronger training in the next block',
    ],
  },
};

/**
 * Generate programming recommendations based on phase and optional 1RM.
 * When exerciseType is provided, focus areas are slightly tailored.
 */
export function getRecommendation(
  phase: TrainingPhase,
  estimated1RM?: number,
  exerciseType?: string,
  weightUnit?: string,
): ProgrammingRecommendation {
  const template = PHASE_TEMPLATES[phase];
  const intensity = estimated1RM && estimated1RM > 0
    ? `${template.intensityPercent[0]}-${template.intensityPercent[1]}% 1RM`
    : template.rpe;

  const recommendation: ProgrammingRecommendation = {
    phase,
    sets: template.sets,
    reps: template.reps,
    intensity,
    restMinutes: template.restMinutes,
    focusAreas: [...template.focusAreas],
    notes: [...template.notes],
  };

  // Add weight range if 1RM is available
  if (estimated1RM && estimated1RM > 0) {
    const low = Math.round(estimated1RM * template.intensityPercent[0] / 100);
    const high = Math.round(estimated1RM * template.intensityPercent[1] / 100);
    recommendation.weightRange = [low, high];
    recommendation.weightUnit = weightUnit ?? 'lbs';
  }

  // Exercise-specific focus area tweaks
  if (exerciseType === 'deadlift') {
    recommendation.focusAreas = recommendation.focusAreas.map(area =>
      area.replace('Trunk stability under heavy load', 'Back position and hip hinge mechanics')
        .replace('Full range of motion (depth)', 'Full hip extension at lockout')
        .replace('Competition depth (at or below parallel)', 'Smooth pull from floor to lockout'),
    );
  } else if (exerciseType === 'bench_press') {
    recommendation.focusAreas = recommendation.focusAreas.map(area =>
      area.replace('Trunk stability under heavy load', 'Shoulder retraction and arch position')
        .replace('Full range of motion (depth)', 'Full range of motion (bar to chest)')
        .replace('Competition depth (at or below parallel)', 'Pause at chest, explosive press'),
    );
  }

  return recommendation;
}

// ─── Phase-adjusted scoring weights ───

/**
 * Get adjusted scoring weights for a training phase.
 *
 * - Hypertrophy: tempo and depth matter more (controlled reps, full ROM)
 * - Strength: trunk stability and lockout matter more
 * - Peaking: competition-like weights (depth + lockout critical)
 * - Deload: equal weights, focus on overall movement quality
 */
export function getPhaseWeights(phase: TrainingPhase): Record<string, number> {
  switch (phase) {
    case 'hypertrophy':
      return {
        depth: 0.25,
        kneeTracking: 0.15,
        trunk: 0.15,
        symmetry: 0.10,
        tempo: 0.20,
        lockout: 0.15,
      };
    case 'strength':
      return {
        depth: 0.20,
        kneeTracking: 0.20,
        trunk: 0.25,
        symmetry: 0.10,
        tempo: 0.05,
        lockout: 0.20,
      };
    case 'peaking':
      return {
        depth: 0.30,
        kneeTracking: 0.15,
        trunk: 0.15,
        symmetry: 0.10,
        tempo: 0.00,
        lockout: 0.30,
      };
    case 'deload':
      return {
        depth: 0.17,
        kneeTracking: 0.17,
        trunk: 0.17,
        symmetry: 0.16,
        tempo: 0.17,
        lockout: 0.16,
      };
  }
}

// ─── Phase suggestion based on recent history ───

export interface PhaseSessionData {
  score: number;
  rpe?: number;
  date: string;
}

/**
 * Suggest the next training phase based on recent session history.
 * Uses score trends and RPE data to determine readiness for each phase.
 *
 * Logic:
 * - Few sessions (<3): start with hypertrophy to build a base
 * - High RPE trend (avg > 8.5): suggest deload
 * - Declining scores with moderate sessions (5-10): suggest deload then re-evaluate
 * - Stable high scores (>80 avg) with enough sessions: progress to strength/peaking
 * - After strength block with good scores: advance to peaking
 */
export function suggestNextPhase(
  sessions: PhaseSessionData[],
): { phase: TrainingPhase; reason: string } {
  if (sessions.length === 0) {
    return {
      phase: 'hypertrophy',
      reason: 'Starting with hypertrophy to build a solid movement foundation and work capacity.',
    };
  }

  if (sessions.length < 3) {
    return {
      phase: 'hypertrophy',
      reason: 'Building a training base with higher volume work. Keep training to unlock phase suggestions.',
    };
  }

  // Analyze recent sessions (last 5 or all if fewer)
  const recent = sessions.slice(0, Math.min(sessions.length, 5));
  const avgScore = recent.reduce((sum, s) => sum + s.score, 0) / recent.length;

  // Check RPE trend
  const rpeSessions = recent.filter(s => s.rpe !== undefined && s.rpe > 0);
  const avgRpe = rpeSessions.length > 0
    ? rpeSessions.reduce((sum, s) => sum + (s.rpe ?? 0), 0) / rpeSessions.length
    : null;

  // Check score trend (are scores declining?)
  const scoresTrend = recent.map(s => s.score);
  const firstHalf = scoresTrend.slice(Math.floor(scoresTrend.length / 2));
  const secondHalf = scoresTrend.slice(0, Math.floor(scoresTrend.length / 2));
  const avgFirstHalf = firstHalf.length > 0
    ? firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length : avgScore;
  const avgSecondHalf = secondHalf.length > 0
    ? secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length : avgScore;
  const scoreDeclining = avgSecondHalf < avgFirstHalf - 5;

  // High RPE signals need for deload
  if (avgRpe !== null && avgRpe > 8.5) {
    return {
      phase: 'deload',
      reason: `Your recent average RPE is ${avgRpe.toFixed(1)}, indicating high fatigue. A deload week will help you recover and come back stronger.`,
    };
  }

  // Declining scores suggest fatigue or overreaching
  if (scoreDeclining && sessions.length >= 5) {
    return {
      phase: 'deload',
      reason: `Your form scores have been declining (recent avg ${Math.round(avgSecondHalf)} vs prior ${Math.round(avgFirstHalf)}). A deload week can help reset and improve quality.`,
    };
  }

  // Strong scores with enough training history
  if (avgScore >= 85 && sessions.length >= 8) {
    return {
      phase: 'peaking',
      reason: `Excellent form consistency (avg score ${Math.round(avgScore)}). You may be ready to test heavier loads or prepare for competition.`,
    };
  }

  if (avgScore >= 75 && sessions.length >= 5) {
    return {
      phase: 'strength',
      reason: `Good form foundation (avg score ${Math.round(avgScore)}) with ${sessions.length} sessions logged. Time to build maximal strength with heavier loads.`,
    };
  }

  // Default: keep building the base
  return {
    phase: 'hypertrophy',
    reason: `Continue building movement quality and work capacity. Average score is ${Math.round(avgScore)} -- aim for consistent 75+ before progressing to heavier loads.`,
  };
}
