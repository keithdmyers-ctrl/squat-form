/**
 * Strength standards based on Symmetric Strength, ExRx, and Lon Kilgore research.
 * Provides bodyweight-relative strength classifications for the four main
 * competition lifts (squat, bench, deadlift, OHP).
 */

export type StrengthLevel = 'untrained' | 'beginner' | 'novice' | 'intermediate' | 'advanced' | 'elite';

export interface StrengthStandard {
  level: StrengthLevel;
  label: string;
  description: string;
  color: string;
  multipliers: {
    squat: { male: number; female: number };
    bench: { male: number; female: number };
    deadlift: { male: number; female: number };
    ohp: { male: number; female: number };
  };
}

/**
 * Strength standards ordered from untrained to elite.
 * Multipliers represent bodyweight multiples for each lift at each level.
 *
 * Sources:
 * - Lon Kilgore, "Defining Strength" (2016)
 * - ExRx.net Strength Standards
 * - Symmetric Strength percentile data
 */
export const STRENGTH_STANDARDS: StrengthStandard[] = [
  {
    level: 'untrained',
    label: 'Untrained',
    description: 'No formal training experience. Baseline level before structured programming.',
    color: '#9e9e9e',
    multipliers: {
      squat:    { male: 0.75, female: 0.5 },
      bench:    { male: 0.5,  female: 0.3 },
      deadlift: { male: 1.0,  female: 0.65 },
      ohp:      { male: 0.35, female: 0.2 },
    },
  },
  {
    level: 'beginner',
    label: 'Beginner',
    description: 'A few months of consistent training. Basic movement patterns established.',
    color: '#4caf50',
    multipliers: {
      squat:    { male: 1.0,  female: 0.65 },
      bench:    { male: 0.75, female: 0.45 },
      deadlift: { male: 1.25, female: 0.85 },
      ohp:      { male: 0.5,  female: 0.3 },
    },
  },
  {
    level: 'novice',
    label: 'Novice',
    description: '6-12 months of consistent training. Linear progression completed or near completion.',
    color: '#2196f3',
    multipliers: {
      squat:    { male: 1.25, female: 0.85 },
      bench:    { male: 1.0,  female: 0.6 },
      deadlift: { male: 1.5,  female: 1.0 },
      ohp:      { male: 0.65, female: 0.4 },
    },
  },
  {
    level: 'intermediate',
    label: 'Intermediate',
    description: '1-3 years of serious training. Weekly or block periodization needed for progress.',
    color: '#ff9800',
    multipliers: {
      squat:    { male: 1.5,  female: 1.1 },
      bench:    { male: 1.25, female: 0.8 },
      deadlift: { male: 1.75, female: 1.25 },
      ohp:      { male: 0.8,  female: 0.55 },
    },
  },
  {
    level: 'advanced',
    label: 'Advanced',
    description: '3-5+ years of dedicated training. Monthly periodization and meet-competitive numbers.',
    color: '#f44336',
    multipliers: {
      squat:    { male: 2.0,  female: 1.5 },
      bench:    { male: 1.5,  female: 1.0 },
      deadlift: { male: 2.25, female: 1.65 },
      ohp:      { male: 1.0,  female: 0.7 },
    },
  },
  {
    level: 'elite',
    label: 'Elite',
    description: '5+ years of optimized training. Competitive at national/international level.',
    color: '#9c27b0',
    multipliers: {
      squat:    { male: 2.5,  female: 1.85 },
      bench:    { male: 1.75, female: 1.25 },
      deadlift: { male: 2.75, female: 2.0 },
      ohp:      { male: 1.2,  female: 0.85 },
    },
  },
];

/** Valid lift names for strength standard lookups. */
type LiftName = 'squat' | 'bench' | 'deadlift' | 'ohp';

const VALID_LIFTS = new Set<string>(['squat', 'bench', 'deadlift', 'ohp']);

/**
 * Normalize a lift name to one of the four standard lifts.
 * Handles common aliases like 'overhead press', 'bench press', etc.
 */
function normalizeLift(lift: string): LiftName | null {
  const lower = lift.toLowerCase().replace(/[-_ ]/g, '');
  if (lower === 'squat' || lower === 'backsquat') return 'squat';
  if (lower === 'bench' || lower === 'benchpress') return 'bench';
  if (lower === 'deadlift') return 'deadlift';
  if (lower === 'ohp' || lower === 'overheadpress' || lower === 'press' || lower === 'shoulderpress') return 'ohp';
  if (VALID_LIFTS.has(lower)) return lower as LiftName;
  return null;
}

/**
 * Get the multiplier for a specific lift, level, and sex.
 */
function getMultiplier(standard: StrengthStandard, lift: LiftName, sex: 'male' | 'female'): number {
  return standard.multipliers[lift][sex];
}

/**
 * Determine the strength level for a given weight, bodyweight, lift, and sex.
 *
 * The level is the highest standard whose bodyweight multiplier the lifter
 * meets or exceeds. For example, if a male lifter squats 1.6x bodyweight,
 * they surpass intermediate (1.5x) but not advanced (2.0x), so they are
 * classified as intermediate.
 */
export function getStrengthLevel(
  weight: number,
  bodyweight: number,
  lift: string,
  sex: 'male' | 'female',
): StrengthLevel {
  if (weight <= 0 || bodyweight <= 0) return 'untrained';

  const normalizedLift = normalizeLift(lift);
  if (!normalizedLift) return 'untrained';

  const multiple = weight / bodyweight;

  // Walk from elite down to untrained, return first level the lifter meets
  for (let i = STRENGTH_STANDARDS.length - 1; i >= 0; i--) {
    const standard = STRENGTH_STANDARDS[i];
    const threshold = getMultiplier(standard, normalizedLift, sex);
    if (multiple >= threshold) {
      return standard.level;
    }
  }

  return 'untrained';
}

/**
 * Estimate a strength percentile (0-100) based on where the lifter falls
 * within the strength standards spectrum.
 *
 * The percentile is interpolated linearly between levels:
 * - Untrained: 5th percentile
 * - Beginner: 20th percentile
 * - Novice: 40th percentile
 * - Intermediate: 60th percentile
 * - Advanced: 80th percentile
 * - Elite: 95th percentile
 * - Above elite: 99th percentile
 */
export function getStrengthPercentile(
  weight: number,
  bodyweight: number,
  lift: string,
  sex: 'male' | 'female',
): number {
  if (weight <= 0 || bodyweight <= 0) return 0;

  const normalizedLift = normalizeLift(lift);
  if (!normalizedLift) return 0;

  const multiple = weight / bodyweight;

  // Percentile anchors for each level
  const anchors = [
    { level: 0, percentile: 5 },   // untrained
    { level: 1, percentile: 20 },  // beginner
    { level: 2, percentile: 40 },  // novice
    { level: 3, percentile: 60 },  // intermediate
    { level: 4, percentile: 80 },  // advanced
    { level: 5, percentile: 95 },  // elite
  ];

  // Get the multiplier thresholds
  const thresholds = STRENGTH_STANDARDS.map(s => getMultiplier(s, normalizedLift, sex));

  // Below untrained
  if (multiple < thresholds[0]) {
    // Interpolate from 0 to 5 (untrained percentile)
    const ratio = Math.max(0, multiple / thresholds[0]);
    return Math.round(ratio * anchors[0].percentile);
  }

  // Find which two levels the lifter falls between
  for (let i = 0; i < thresholds.length - 1; i++) {
    if (multiple >= thresholds[i] && multiple < thresholds[i + 1]) {
      // Interpolate between the two anchor percentiles
      const ratio = (multiple - thresholds[i]) / (thresholds[i + 1] - thresholds[i]);
      const pctLow = anchors[i].percentile;
      const pctHigh = anchors[i + 1].percentile;
      return Math.round(pctLow + ratio * (pctHigh - pctLow));
    }
  }

  // At or above elite
  if (multiple >= thresholds[thresholds.length - 1]) {
    // Above elite: cap at 99
    const eliteMultiple = thresholds[thresholds.length - 1];
    const overshoot = (multiple - eliteMultiple) / eliteMultiple;
    return Math.min(99, Math.round(95 + overshoot * 20));
  }

  return 50; // fallback
}

/**
 * Get the next strength milestone — the next level above the lifter's
 * current classification, with the target weight and deficit needed.
 */
export function getNextMilestone(
  weight: number,
  bodyweight: number,
  lift: string,
  sex: 'male' | 'female',
): { level: StrengthLevel; targetWeight: number; deficit: number } {
  const normalizedLift = normalizeLift(lift);
  if (!normalizedLift || bodyweight <= 0) {
    return { level: 'beginner', targetWeight: 0, deficit: 0 };
  }

  const currentLevel = getStrengthLevel(weight, bodyweight, lift, sex);

  // Find the index of the current level
  const currentIdx = STRENGTH_STANDARDS.findIndex(s => s.level === currentLevel);

  // If already elite, return elite targets
  if (currentIdx >= STRENGTH_STANDARDS.length - 1) {
    const eliteMultiple = getMultiplier(STRENGTH_STANDARDS[STRENGTH_STANDARDS.length - 1], normalizedLift, sex);
    const targetWeight = Math.ceil(eliteMultiple * bodyweight);
    return {
      level: 'elite',
      targetWeight,
      deficit: Math.max(0, targetWeight - weight),
    };
  }

  // Next level
  const nextStandard = STRENGTH_STANDARDS[currentIdx + 1];
  const nextMultiple = getMultiplier(nextStandard, normalizedLift, sex);
  const targetWeight = Math.ceil(nextMultiple * bodyweight);
  const deficit = Math.max(0, targetWeight - weight);

  return {
    level: nextStandard.level,
    targetWeight,
    deficit,
  };
}

/**
 * Render an HTML card showing all lifts with their strength levels,
 * progress bars, and next milestones.
 */
export function renderStrengthCard(
  lifts: Record<string, number>,
  bodyweight: number,
  sex: 'male' | 'female',
): string {
  if (bodyweight <= 0) {
    return '<div class="strength-card"><p>Enter your bodyweight to see strength standards.</p></div>';
  }

  const liftNames: Array<{ key: string; label: string }> = [
    { key: 'squat', label: 'Squat' },
    { key: 'bench', label: 'Bench Press' },
    { key: 'deadlift', label: 'Deadlift' },
    { key: 'ohp', label: 'Overhead Press' },
  ];

  const rows = liftNames.map(({ key, label }) => {
    const weight = lifts[key] ?? 0;
    if (weight <= 0) {
      return `<div class="strength-row strength-row-empty">
        <span class="strength-lift-name">${label}</span>
        <span class="strength-no-data">No data</span>
      </div>`;
    }

    const level = getStrengthLevel(weight, bodyweight, key, sex);
    const percentile = getStrengthPercentile(weight, bodyweight, key, sex);
    const milestone = getNextMilestone(weight, bodyweight, key, sex);
    const standard = STRENGTH_STANDARDS.find(s => s.level === level);
    const color = standard?.color ?? '#9e9e9e';
    const multiple = (weight / bodyweight).toFixed(2);

    const milestoneText = milestone.deficit > 0
      ? `${milestone.deficit} kg to ${milestone.level}`
      : `At ${milestone.level} level`;

    return `<div class="strength-row">
      <div class="strength-lift-header">
        <span class="strength-lift-name">${label}</span>
        <span class="strength-lift-weight">${weight} kg (${multiple}x BW)</span>
      </div>
      <div class="strength-bar-container">
        <div class="strength-bar" style="width: ${percentile}%; background-color: ${color}"></div>
      </div>
      <div class="strength-lift-footer">
        <span class="strength-level" style="color: ${color}">${standard?.label ?? level}</span>
        <span class="strength-percentile">${percentile}th percentile</span>
        <span class="strength-milestone">${milestoneText}</span>
      </div>
    </div>`;
  });

  return `<div class="strength-card">
  <h3 class="strength-card-title">Strength Standards</h3>
  <p class="strength-card-subtitle">${sex === 'male' ? 'Male' : 'Female'} at ${bodyweight} kg bodyweight</p>
  ${rows.join('\n')}
</div>`;
}
