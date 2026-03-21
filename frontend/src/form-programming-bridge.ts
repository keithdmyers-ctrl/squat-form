/**
 * Form analysis → Programming feedback loop.
 *
 * The form checker identifies sticking points and weaknesses. The programming
 * engine recommends accessories. This module connects them automatically by
 * analyzing recent form sessions, mapping weaknesses to accessory exercises,
 * and identifying gaps in current programming.
 *
 * Evidence basis:
 * - Helms et al. (2016), Strength & Conditioning Research
 * - Nuckols, Stronger by Science
 * - Contreras et al. (2011), hip thrust research
 * - Rippetoe (2011), Starting Strength
 */

// ─── Types ───

export interface FormWeakness {
  exercise: string;
  weakness: string;
  severity: 'low' | 'moderate' | 'high';
  frequency: number;
  trend: 'improving' | 'stable' | 'worsening';
  stickingPoint?: string;
}

export interface AccessoryRecommendation {
  exercise: string;
  slot: string;
  targetWeakness: string;
  sets: number;
  reps: string;
  priority: 'high' | 'medium' | 'low';
  rationale: string;
  citation?: string;
}

export interface AccessoryGap {
  weakness: string;
  exercise: string;
  missingAccessory: string;
  priority: 'high' | 'medium' | 'low';
}

// ─── Session Data Interface ───

interface FormSession {
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

// ─── Constants ───

const SESSIONS_STORAGE_KEY = 'squat_form_sessions';
const MAX_SESSIONS_TO_ANALYZE = 5;

/**
 * Dimension-to-weakness mapping.
 * Links low form dimension scores to specific weakness identifiers.
 */
const DIMENSION_WEAKNESS_MAP: Record<string, Record<string, { weakness: string; threshold: number }>> = {
  squat: {
    avg_depth: { weakness: 'depth_insufficient', threshold: 70 },
    avg_knee_tracking: { weakness: 'knee_valgus', threshold: 70 },
    avg_trunk: { weakness: 'good_morning', threshold: 70 },
    avg_symmetry: { weakness: 'lateral_shift', threshold: 70 },
    avg_lockout: { weakness: 'weak_lockout', threshold: 75 },
  },
  deadlift: {
    avg_trunk: { weakness: 'rounded_back', threshold: 70 },
    avg_lockout: { weakness: 'hitching', threshold: 75 },
    avg_depth: { weakness: 'hip_shoot', threshold: 70 },
  },
  bench_press: {
    avg_depth: { weakness: 'no_pause', threshold: 70 },
    avg_lockout: { weakness: 'weak_lockout_bench', threshold: 75 },
    avg_trunk: { weakness: 'excessive_arch', threshold: 70 },
  },
};

/**
 * Sticking point labels mapped from top_issue strings.
 */
const STICKING_POINT_MAP: Record<string, string> = {
  depth_insufficient: 'out_of_hole',
  good_morning: 'mid_range',
  weak_lockout: 'lockout',
  hip_shoot: 'out_of_hole',
  rounded_back: 'mid_range',
  hitching: 'lockout',
  no_pause: 'out_of_hole',
  weak_lockout_bench: 'lockout',
};

/**
 * Weakness → accessory exercise mappings.
 * Each weakness maps to a list of accessories with full prescriptions.
 */
const WEAKNESS_ACCESSORY_MAP: Record<string, AccessoryRecommendation[]> = {
  // Squat weaknesses
  knee_valgus: [
    {
      exercise: 'Banded Squats',
      slot: 'squat',
      targetWeakness: 'knee_valgus',
      sets: 3,
      reps: '10-12',
      priority: 'high',
      rationale: 'Banded squats provide proprioceptive feedback to keep knees tracking over toes, strengthening hip abductors under load.',
      citation: 'Escamilla 2001; Powers 2010',
    },
    {
      exercise: 'Monster Walks',
      slot: 'hip_thrust',
      targetWeakness: 'knee_valgus',
      sets: 3,
      reps: '15-20',
      priority: 'medium',
      rationale: 'Lateral band walks activate the gluteus medius, the primary muscle preventing knee valgus.',
      citation: 'Hewett et al. 2005',
    },
    {
      exercise: 'Clamshells',
      slot: 'hip_thrust',
      targetWeakness: 'knee_valgus',
      sets: 3,
      reps: '15-20',
      priority: 'low',
      rationale: 'Isolates hip external rotators which control femoral rotation and prevent knee collapse.',
    },
  ],
  good_morning: [
    {
      exercise: 'Front Squat',
      slot: 'front_squat',
      targetWeakness: 'good_morning',
      sets: 3,
      reps: '5-8',
      priority: 'high',
      rationale: 'Front squats enforce an upright torso position by making excessive forward lean mechanically impossible.',
      citation: 'Gullett et al. 2009',
    },
    {
      exercise: 'SSB Squat',
      slot: 'squat',
      targetWeakness: 'good_morning',
      sets: 3,
      reps: '6-8',
      priority: 'medium',
      rationale: 'Safety squat bar shifts load forward, training upper back to resist forward lean.',
    },
    {
      exercise: 'Tempo Squat',
      slot: 'pause_squat',
      targetWeakness: 'good_morning',
      sets: 3,
      reps: '5 (3-0-1-0)',
      priority: 'medium',
      rationale: 'Slow eccentrics develop positional awareness and strengthen the trunk stabilizers through the full range.',
      citation: 'Rippetoe 2011',
    },
  ],
  butt_wink: [
    {
      exercise: 'Box Squat',
      slot: 'box_squat',
      targetWeakness: 'butt_wink',
      sets: 3,
      reps: '5-8',
      priority: 'high',
      rationale: 'Box squats set a consistent depth target and train the lifter to reverse direction before pelvic tuck occurs.',
      citation: 'McGill 2010',
    },
    {
      exercise: 'Hip Mobility Work',
      slot: 'hip_thrust',
      targetWeakness: 'butt_wink',
      sets: 3,
      reps: '30s holds',
      priority: 'medium',
      rationale: 'Improving hip flexion ROM allows deeper squats without lumbar compensation.',
    },
    {
      exercise: 'Goblet Squat',
      slot: 'front_squat',
      targetWeakness: 'butt_wink',
      sets: 3,
      reps: '10-12',
      priority: 'low',
      rationale: 'Goblet squats provide a counterbalance that allows a more upright torso and reduces pelvic tilt demands.',
    },
  ],
  depth_insufficient: [
    {
      exercise: 'Pause Squat',
      slot: 'pause_squat',
      targetWeakness: 'depth_insufficient',
      sets: 3,
      reps: '3-5',
      priority: 'high',
      rationale: 'Pause squats develop confidence and strength at the bottom by eliminating the stretch-shortening cycle.',
      citation: 'Helms et al. 2016',
    },
    {
      exercise: 'Goblet Squat',
      slot: 'front_squat',
      targetWeakness: 'depth_insufficient',
      sets: 3,
      reps: '10-12',
      priority: 'medium',
      rationale: 'Light goblet squats are a safe way to practice full-depth squatting with proper mechanics.',
    },
    {
      exercise: 'Ankle Mobility Drills',
      slot: 'calf_raise',
      targetWeakness: 'depth_insufficient',
      sets: 3,
      reps: '30s holds',
      priority: 'medium',
      rationale: 'Limited ankle dorsiflexion is a common cause of insufficient squat depth.',
    },
  ],
  heel_rise: [
    {
      exercise: 'Elevated Heel Squat',
      slot: 'squat',
      targetWeakness: 'heel_rise',
      sets: 3,
      reps: '8-10',
      priority: 'high',
      rationale: 'Heel elevation accommodates limited ankle ROM while allowing full depth, and can be used as a teaching tool.',
    },
    {
      exercise: 'Ankle Mobility Drills',
      slot: 'calf_raise',
      targetWeakness: 'heel_rise',
      sets: 3,
      reps: '30s holds',
      priority: 'medium',
      rationale: 'Targeted ankle dorsiflexion stretching addresses the root cause of heel rise during squats.',
    },
    {
      exercise: 'Front Squat',
      slot: 'front_squat',
      targetWeakness: 'heel_rise',
      sets: 3,
      reps: '5-8',
      priority: 'low',
      rationale: 'Front squats require and develop better ankle mobility due to the upright torso position.',
    },
  ],
  lateral_shift: [
    {
      exercise: 'Bulgarian Split Squat',
      slot: 'leg_press',
      targetWeakness: 'lateral_shift',
      sets: 3,
      reps: '8-10/side',
      priority: 'high',
      rationale: 'Unilateral work addresses side-to-side strength imbalances that cause lateral shifting.',
      citation: 'Helms et al. 2016',
    },
    {
      exercise: 'Single-leg Leg Press',
      slot: 'leg_press',
      targetWeakness: 'lateral_shift',
      sets: 3,
      reps: '10-12/side',
      priority: 'medium',
      rationale: 'Isolates each leg to identify and correct strength discrepancies.',
    },
  ],

  // Bench weaknesses
  no_pause: [
    {
      exercise: 'Paused Bench Press',
      slot: 'spoto_press',
      targetWeakness: 'no_pause',
      sets: 3,
      reps: '3-5',
      priority: 'high',
      rationale: 'Paused bench develops strength at the chest and teaches the control needed for competition bench pressing.',
      citation: 'IPF Technical Rules',
    },
    {
      exercise: 'Spoto Press',
      slot: 'spoto_press',
      targetWeakness: 'no_pause',
      sets: 3,
      reps: '5-8',
      priority: 'medium',
      rationale: 'Holding the bar 1 inch off the chest develops isometric strength at the weakest point of the bench press.',
    },
    {
      exercise: 'Tempo Bench',
      slot: 'bench',
      targetWeakness: 'no_pause',
      sets: 3,
      reps: '5 (3-1-1-0)',
      priority: 'low',
      rationale: 'Slow eccentrics develop control throughout the entire ROM and build time under tension.',
    },
  ],
  weak_lockout_bench: [
    {
      exercise: 'Close-grip Bench',
      slot: 'close_grip_bench',
      targetWeakness: 'weak_lockout_bench',
      sets: 3,
      reps: '6-8',
      priority: 'high',
      rationale: 'Close-grip bench emphasizes triceps which are the primary movers in the lockout portion.',
      citation: 'Lehman 2005',
    },
    {
      exercise: 'JM Press',
      slot: 'tricep_extension',
      targetWeakness: 'weak_lockout_bench',
      sets: 3,
      reps: '8-10',
      priority: 'medium',
      rationale: 'JM press isolates the triceps through a bench-specific ROM pattern.',
    },
    {
      exercise: 'Tricep Dips',
      slot: 'dip',
      targetWeakness: 'weak_lockout_bench',
      sets: 3,
      reps: '8-12',
      priority: 'low',
      rationale: 'Weighted dips develop pressing strength through the lockout range with heavy loads.',
    },
  ],

  // Deadlift weaknesses
  rounded_back: [
    {
      exercise: 'Deficit Deadlift (light)',
      slot: 'deficit_deadlift',
      targetWeakness: 'rounded_back',
      sets: 3,
      reps: '5-8',
      priority: 'high',
      rationale: 'Light deficit deadlifts force a strong starting position and develop positional strength off the floor.',
      citation: 'Nuckols, Stronger by Science',
    },
    {
      exercise: 'Pause Deadlift',
      slot: 'deadlift',
      targetWeakness: 'rounded_back',
      sets: 3,
      reps: '3-5',
      priority: 'high',
      rationale: 'Pausing below the knee forces maintenance of a neutral spine under isometric load.',
    },
    {
      exercise: 'Back Extension',
      slot: 'good_morning',
      targetWeakness: 'rounded_back',
      sets: 3,
      reps: '12-15',
      priority: 'medium',
      rationale: 'Develops erector spinae endurance needed to maintain a flat back under fatigue.',
    },
  ],
  hitching: [
    {
      exercise: 'Block Pulls',
      slot: 'deadlift',
      targetWeakness: 'hitching',
      sets: 3,
      reps: '3-5',
      priority: 'high',
      rationale: 'Block pulls overload the lockout portion and develop the ability to finish the pull smoothly.',
      citation: 'Contreras et al. 2011',
    },
    {
      exercise: 'Romanian Deadlift',
      slot: 'rdl',
      targetWeakness: 'hitching',
      sets: 3,
      reps: '8-10',
      priority: 'medium',
      rationale: 'RDLs develop the hamstring and glute strength needed for a smooth hip extension lockout.',
    },
    {
      exercise: 'Hip Thrust',
      slot: 'hip_thrust',
      targetWeakness: 'hitching',
      sets: 3,
      reps: '8-12',
      priority: 'medium',
      rationale: 'Hip thrusts isolate hip extension at the top of the movement where hitching occurs.',
      citation: 'Contreras et al. 2011',
    },
  ],
  hip_shoot: [
    {
      exercise: 'Tempo Deadlift',
      slot: 'deadlift',
      targetWeakness: 'hip_shoot',
      sets: 3,
      reps: '3-5 (3-0-1-0)',
      priority: 'high',
      rationale: 'Slow eccentrics develop the quadriceps and positional awareness to maintain hip-shoulder coordination.',
    },
    {
      exercise: 'Pause at Knee Deadlift',
      slot: 'deadlift',
      targetWeakness: 'hip_shoot',
      sets: 3,
      reps: '3-5',
      priority: 'medium',
      rationale: 'Pausing at the knee reinforces proper back angle and prevents premature hip rise.',
    },
    {
      exercise: 'Front Squat',
      slot: 'front_squat',
      targetWeakness: 'hip_shoot',
      sets: 3,
      reps: '5-8',
      priority: 'medium',
      rationale: 'Front squats develop quad strength, which is the limiting factor when hips shoot up before shoulders.',
      citation: 'Rippetoe 2011',
    },
  ],
  excessive_arch: [
    {
      exercise: 'Feet-up Bench',
      slot: 'bench',
      targetWeakness: 'excessive_arch',
      sets: 3,
      reps: '8-10',
      priority: 'medium',
      rationale: 'Benching with feet elevated eliminates excessive arch and develops raw pressing strength.',
    },
  ],

  // Sticking point accessories (cross-exercise)
  sticking_point_hole: [
    {
      exercise: 'Pin Squat',
      slot: 'pause_squat',
      targetWeakness: 'sticking_point_hole',
      sets: 3,
      reps: '3-5',
      priority: 'high',
      rationale: 'Pin squats develop concentric-only strength from the weakest position, directly addressing the sticking point.',
      citation: 'Simmons 2007',
    },
    {
      exercise: 'Pause Squat',
      slot: 'pause_squat',
      targetWeakness: 'sticking_point_hole',
      sets: 3,
      reps: '3-5',
      priority: 'high',
      rationale: 'Pausing at the bottom eliminates the stretch-shortening cycle, building pure strength at the sticking point.',
    },
    {
      exercise: 'Front Squat',
      slot: 'front_squat',
      targetWeakness: 'sticking_point_hole',
      sets: 3,
      reps: '5-8',
      priority: 'medium',
      rationale: 'Front squats develop quad strength and upright position out of the hole.',
    },
  ],
  sticking_point_mid: [
    {
      exercise: 'Anderson Squat',
      slot: 'pause_squat',
      targetWeakness: 'sticking_point_mid',
      sets: 3,
      reps: '3-5',
      priority: 'high',
      rationale: 'Anderson squats from pins at the mid-range sticking point develop concentric-only strength at the exact weak point.',
    },
    {
      exercise: 'Tempo Squat',
      slot: 'pause_squat',
      targetWeakness: 'sticking_point_mid',
      sets: 3,
      reps: '5 (3-0-1-0)',
      priority: 'medium',
      rationale: 'Slow eccentrics develop positional strength through the mid-range.',
    },
  ],
  sticking_point_lockout: [
    {
      exercise: 'Hip Thrust',
      slot: 'hip_thrust',
      targetWeakness: 'sticking_point_lockout',
      sets: 3,
      reps: '8-12',
      priority: 'high',
      rationale: 'Hip thrusts develop peak hip extension force at the top of the movement.',
      citation: 'Contreras et al. 2011',
    },
    {
      exercise: 'Glute Bridge',
      slot: 'hip_thrust',
      targetWeakness: 'sticking_point_lockout',
      sets: 3,
      reps: '12-15',
      priority: 'medium',
      rationale: 'Glute bridges isolate the lockout pattern for the squat and deadlift.',
    },
    {
      exercise: 'Banded Squat',
      slot: 'squat',
      targetWeakness: 'sticking_point_lockout',
      sets: 3,
      reps: '5-8',
      priority: 'medium',
      rationale: 'Band tension increases at lockout, overloading the weak point with accommodating resistance.',
      citation: 'Simmons 2007',
    },
  ],
  sticking_point_chest: [
    {
      exercise: 'Close-grip Bench',
      slot: 'close_grip_bench',
      targetWeakness: 'sticking_point_chest',
      sets: 3,
      reps: '5-8',
      priority: 'high',
      rationale: 'Close-grip bench strengthens the pressing muscles through a larger ROM off the chest.',
    },
    {
      exercise: 'Floor Press',
      slot: 'bench',
      targetWeakness: 'sticking_point_chest',
      sets: 3,
      reps: '5-8',
      priority: 'medium',
      rationale: 'Floor press develops strength from a dead stop at the bottom of the press.',
    },
    {
      exercise: 'Dumbbell Press',
      slot: 'bench',
      targetWeakness: 'sticking_point_chest',
      sets: 3,
      reps: '8-10',
      priority: 'low',
      rationale: 'Dumbbell pressing allows a greater ROM at the bottom, developing chest and shoulder strength off the chest.',
    },
  ],
  sticking_point_floor: [
    {
      exercise: 'Deficit Deadlift',
      slot: 'deficit_deadlift',
      targetWeakness: 'sticking_point_floor',
      sets: 3,
      reps: '3-5',
      priority: 'high',
      rationale: 'Deficit deadlifts increase ROM and develop starting strength off the floor.',
      citation: 'Nuckols, Stronger by Science',
    },
    {
      exercise: 'Front Squat',
      slot: 'front_squat',
      targetWeakness: 'sticking_point_floor',
      sets: 3,
      reps: '5-8',
      priority: 'medium',
      rationale: 'Front squats build the quad strength needed for a strong initial pull.',
    },
    {
      exercise: 'Leg Press',
      slot: 'leg_press',
      targetWeakness: 'sticking_point_floor',
      sets: 3,
      reps: '8-12',
      priority: 'low',
      rationale: 'Leg press builds quad volume to support a stronger break from the floor.',
    },
  ],
  sticking_point_knee: [
    {
      exercise: 'Pause Deadlift',
      slot: 'deadlift',
      targetWeakness: 'sticking_point_knee',
      sets: 3,
      reps: '3-5',
      priority: 'high',
      rationale: 'Pausing at the knee builds positional strength at the exact sticking point.',
    },
    {
      exercise: 'Romanian Deadlift',
      slot: 'rdl',
      targetWeakness: 'sticking_point_knee',
      sets: 3,
      reps: '8-10',
      priority: 'medium',
      rationale: 'RDLs develop hamstring and posterior chain strength through the knee-passing range.',
    },
    {
      exercise: 'Good Morning',
      slot: 'good_morning',
      targetWeakness: 'sticking_point_knee',
      sets: 3,
      reps: '8-12',
      priority: 'medium',
      rationale: 'Good mornings develop the erectors and hamstrings that maintain back angle at the knee.',
      citation: 'Rippetoe 2011',
    },
  ],
  sticking_point_dl_lockout: [
    {
      exercise: 'Block Pulls',
      slot: 'deadlift',
      targetWeakness: 'sticking_point_dl_lockout',
      sets: 3,
      reps: '3-5',
      priority: 'high',
      rationale: 'Block pulls overload the top portion of the deadlift, building lockout strength.',
    },
    {
      exercise: 'Hip Thrust',
      slot: 'hip_thrust',
      targetWeakness: 'sticking_point_dl_lockout',
      sets: 3,
      reps: '8-12',
      priority: 'medium',
      rationale: 'Hip thrusts develop peak hip extension force needed for a strong deadlift lockout.',
      citation: 'Contreras et al. 2011',
    },
    {
      exercise: 'Barbell Row',
      slot: 'row',
      targetWeakness: 'sticking_point_dl_lockout',
      sets: 3,
      reps: '6-8',
      priority: 'medium',
      rationale: 'Heavy rows develop the upper back strength needed to keep the bar close at lockout.',
    },
  ],
};

// ─── Core Analysis Functions ───

/**
 * Load form sessions from localStorage.
 * Exported for testing.
 */
export function loadFormSessions(): FormSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Analyze recent form check sessions to identify persistent weaknesses.
 * Looks at the last 5 sessions per exercise.
 */
export function analyzeFormWeaknesses(sessions?: FormSession[]): FormWeakness[] {
  const allSessions = sessions ?? loadFormSessions();
  if (allSessions.length === 0) return [];

  const weaknesses: FormWeakness[] = [];

  // Group sessions by exercise type
  const byExercise = new Map<string, FormSession[]>();
  for (const session of allSessions) {
    const exerciseType = session.exercise_type ?? 'squat';
    if (!byExercise.has(exerciseType)) {
      byExercise.set(exerciseType, []);
    }
    byExercise.get(exerciseType)!.push(session);
  }

  for (const [exerciseType, exerciseSessions] of byExercise) {
    // Take the most recent sessions (up to MAX_SESSIONS_TO_ANALYZE)
    const recentSessions = exerciseSessions.slice(0, MAX_SESSIONS_TO_ANALYZE);
    const dimensionMap = DIMENSION_WEAKNESS_MAP[exerciseType];
    if (!dimensionMap) continue;

    for (const [dimKey, config] of Object.entries(dimensionMap)) {
      // Get scores for this dimension across recent sessions
      const scores: number[] = [];
      for (const session of recentSessions) {
        const value = (session as Record<string, unknown>)[dimKey] as number | undefined;
        if (value !== undefined) {
          scores.push(value);
        }
      }

      if (scores.length === 0) continue;

      // Count how many sessions fall below the threshold
      const belowThreshold = scores.filter(s => s < config.threshold).length;
      if (belowThreshold === 0) continue;

      // Calculate average score for severity
      const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
      let severity: FormWeakness['severity'];
      if (avgScore < config.threshold - 20) severity = 'high';
      else if (avgScore < config.threshold - 5) severity = 'moderate';
      else severity = 'low';

      // Determine trend by comparing first half vs second half
      const trend = determineTrend(scores);

      // Determine sticking point from top_issue if available
      const stickingPoint = STICKING_POINT_MAP[config.weakness];

      weaknesses.push({
        exercise: exerciseType,
        weakness: config.weakness,
        severity,
        frequency: belowThreshold,
        trend,
        stickingPoint,
      });
    }

    // Also check top_issue patterns for sticking point detection
    const topIssues = recentSessions
      .map(s => s.top_issue)
      .filter((issue): issue is string => issue != null && issue !== '');

    // Detect sticking point patterns from top issues
    for (const issue of new Set(topIssues)) {
      const issueCount = topIssues.filter(i => i === issue).length;
      // Only include if it appears in at least 2 sessions
      if (issueCount < 2) continue;
      // Skip if we already have this weakness from dimension analysis
      if (weaknesses.some(w => w.exercise === exerciseType && w.weakness === issue)) continue;

      const stickingPoint = STICKING_POINT_MAP[issue];
      weaknesses.push({
        exercise: exerciseType,
        weakness: issue,
        severity: issueCount >= 4 ? 'high' : issueCount >= 3 ? 'moderate' : 'low',
        frequency: issueCount,
        trend: 'stable',
        stickingPoint,
      });
    }
  }

  // Sort by severity (high first) then by frequency (most frequent first)
  const severityOrder: Record<string, number> = { high: 3, moderate: 2, low: 1 };
  weaknesses.sort((a, b) => {
    const sevDiff = (severityOrder[b.severity] ?? 0) - (severityOrder[a.severity] ?? 0);
    if (sevDiff !== 0) return sevDiff;
    return b.frequency - a.frequency;
  });

  return weaknesses;
}

/**
 * Determine the trend of scores (improving, stable, worsening).
 * Compares the earlier scores to the later scores.
 */
function determineTrend(scores: number[]): FormWeakness['trend'] {
  if (scores.length < 2) return 'stable';

  const mid = Math.floor(scores.length / 2);
  // Note: scores are ordered most-recent first, so the first half is newer
  const recentHalf = scores.slice(0, mid);
  const olderHalf = scores.slice(mid);

  if (recentHalf.length === 0 || olderHalf.length === 0) return 'stable';

  const recentAvg = recentHalf.reduce((s, v) => s + v, 0) / recentHalf.length;
  const olderAvg = olderHalf.reduce((s, v) => s + v, 0) / olderHalf.length;

  const diff = recentAvg - olderAvg;
  if (diff > 5) return 'improving';
  if (diff < -5) return 'worsening';
  return 'stable';
}

/**
 * Map detected weaknesses to specific accessory exercises.
 */
export function getAccessoryRecommendations(
  weaknesses: FormWeakness[],
  _equipment?: string,
): AccessoryRecommendation[] {
  const recommendations: AccessoryRecommendation[] = [];
  const seenExercises = new Set<string>();

  for (const weakness of weaknesses) {
    const accessories = WEAKNESS_ACCESSORY_MAP[weakness.weakness];
    if (!accessories) continue;

    for (const accessory of accessories) {
      // Avoid duplicate exercise recommendations
      const key = `${accessory.exercise}-${accessory.targetWeakness}`;
      if (seenExercises.has(key)) continue;
      seenExercises.add(key);

      // Elevate priority based on weakness severity
      let priority = accessory.priority;
      if (weakness.severity === 'high' && priority === 'medium') priority = 'high';
      if (weakness.severity === 'high' && priority === 'low') priority = 'medium';

      recommendations.push({
        ...accessory,
        priority,
      });
    }
  }

  // Sort by priority
  const priorityOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
  recommendations.sort(
    (a, b) => (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0)
  );

  return recommendations;
}

/**
 * Generate a prioritized "weak point report" summarizing form issues
 * and recommended accessories.
 */
export function renderWeakPointReport(
  weaknesses: FormWeakness[],
  recommendations: AccessoryRecommendation[],
): string {
  if (weaknesses.length === 0) {
    return `<div class="fpb-report fpb-report-empty">
  <h4 class="fpb-report-title">Weak Point Report</h4>
  <p class="fpb-report-message">No persistent weaknesses detected. Keep training consistently and checking your form.</p>
</div>`;
  }

  const trendIcons: Record<string, string> = {
    improving: '&#x2191;',
    stable: '&#x2194;',
    worsening: '&#x2193;',
  };

  const priorityClasses: Record<string, string> = {
    high: 'fpb-priority-high',
    medium: 'fpb-priority-medium',
    low: 'fpb-priority-low',
  };

  // Weaknesses section
  const weaknessRows = weaknesses.map(w => {
    const trendIcon = trendIcons[w.trend] ?? '';
    const trendClass = `fpb-trend-${w.trend}`;
    const severityClass = priorityClasses[w.severity] ?? '';
    const exerciseLabel = formatExerciseName(w.exercise);
    const weaknessLabel = formatWeaknessName(w.weakness);
    const stickingLabel = w.stickingPoint ? ` (${formatStickingPoint(w.stickingPoint)})` : '';

    return `<tr class="${severityClass}">
  <td class="fpb-cell">${exerciseLabel}</td>
  <td class="fpb-cell">${weaknessLabel}${stickingLabel}</td>
  <td class="fpb-cell fpb-severity">${w.severity}</td>
  <td class="fpb-cell">${w.frequency}/${MAX_SESSIONS_TO_ANALYZE}</td>
  <td class="fpb-cell ${trendClass}">${trendIcon} ${w.trend}</td>
</tr>`;
  }).join('\n');

  // Recommendations section
  let recsHtml = '';
  if (recommendations.length > 0) {
    const recCards = recommendations.map(r => {
      const priorityClass = priorityClasses[r.priority] ?? '';
      return `<div class="fpb-rec-card ${priorityClass}">
  <div class="fpb-rec-header">
    <span class="fpb-rec-name">${r.exercise}</span>
    <span class="fpb-rec-priority">${r.priority}</span>
  </div>
  <div class="fpb-rec-body">
    <div class="fpb-rec-prescription">${r.sets} x ${r.reps}</div>
    <div class="fpb-rec-target">Targets: ${formatWeaknessName(r.targetWeakness)}</div>
    <div class="fpb-rec-rationale">${r.rationale}</div>
    ${r.citation ? `<div class="fpb-rec-citation">${r.citation}</div>` : ''}
  </div>
</div>`;
    }).join('\n');

    recsHtml = `<h5 class="fpb-section-title">Recommended Accessories</h5>
<div class="fpb-rec-grid">${recCards}</div>`;
  }

  return `<div class="fpb-report">
  <h4 class="fpb-report-title">Weak Point Report</h4>
  <table class="fpb-weakness-table">
    <thead>
      <tr>
        <th>Exercise</th>
        <th>Weakness</th>
        <th>Severity</th>
        <th>Frequency</th>
        <th>Trend</th>
      </tr>
    </thead>
    <tbody>
      ${weaknessRows}
    </tbody>
  </table>
  ${recsHtml}
</div>`;
}

/**
 * Check if the current program's accessories address the detected weaknesses.
 * Returns gaps where weaknesses exist but no matching accessory is programmed.
 */
export function findAccessoryGaps(
  weaknesses: FormWeakness[],
  currentAccessories: string[],
): AccessoryGap[] {
  const gaps: AccessoryGap[] = [];
  const accessorySet = new Set(currentAccessories.map(a => a.toLowerCase()));

  for (const weakness of weaknesses) {
    const recommendedAccessories = WEAKNESS_ACCESSORY_MAP[weakness.weakness];
    if (!recommendedAccessories || recommendedAccessories.length === 0) continue;

    // Check if any of the recommended accessories are in the current program
    const hasCoverage = recommendedAccessories.some(rec =>
      accessorySet.has(rec.slot.toLowerCase()) ||
      accessorySet.has(rec.exercise.toLowerCase())
    );

    if (!hasCoverage) {
      // Suggest the highest-priority missing accessory
      const topRec = recommendedAccessories[0];
      gaps.push({
        weakness: weakness.weakness,
        exercise: weakness.exercise,
        missingAccessory: topRec.exercise,
        priority: weakness.severity === 'high' ? 'high' : weakness.severity === 'moderate' ? 'medium' : 'low',
      });
    }
  }

  return gaps;
}

// ─── Formatting Helpers ───

function formatExerciseName(exercise: string): string {
  const labels: Record<string, string> = {
    squat: 'Squat',
    deadlift: 'Deadlift',
    bench_press: 'Bench Press',
    overhead_press: 'Overhead Press',
    barbell_row: 'Barbell Row',
    lunge: 'Lunge',
  };
  return labels[exercise] ?? exercise;
}

function formatWeaknessName(weakness: string): string {
  const labels: Record<string, string> = {
    knee_valgus: 'Knee Valgus',
    good_morning: 'Excessive Forward Lean',
    butt_wink: 'Butt Wink',
    depth_insufficient: 'Insufficient Depth',
    heel_rise: 'Heel Rise',
    lateral_shift: 'Lateral Shift',
    weak_lockout: 'Weak Lockout',
    weak_lockout_bench: 'Weak Lockout',
    no_pause: 'No Pause at Chest',
    excessive_arch: 'Excessive Arch',
    rounded_back: 'Rounded Back',
    hitching: 'Hitching',
    hip_shoot: 'Hip Shoot',
    sticking_point_hole: 'Sticking Point (Hole)',
    sticking_point_mid: 'Sticking Point (Mid-range)',
    sticking_point_lockout: 'Sticking Point (Lockout)',
    sticking_point_chest: 'Sticking Point (Off Chest)',
    sticking_point_floor: 'Sticking Point (Off Floor)',
    sticking_point_knee: 'Sticking Point (At Knee)',
    sticking_point_dl_lockout: 'Sticking Point (DL Lockout)',
  };
  return labels[weakness] ?? weakness.replace(/_/g, ' ');
}

function formatStickingPoint(point: string): string {
  const labels: Record<string, string> = {
    out_of_hole: 'Out of the Hole',
    mid_range: 'Mid-range',
    lockout: 'Lockout',
  };
  return labels[point] ?? point.replace(/_/g, ' ');
}
