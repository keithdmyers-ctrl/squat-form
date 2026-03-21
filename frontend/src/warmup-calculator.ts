/**
 * Warm-Up Set Calculator: generates a structured warm-up ramp
 * before working sets based on standard powerlifting protocols.
 *
 * Evidence basis:
 * - NSCA warm-up guidelines (Haff & Triplett, 2016)
 * - General powerlifting convention: bar -> 40% -> 60% -> 75% -> 85% -> 90%
 */

// ─── Interfaces ───

export interface WarmupSet {
  setNumber: number;
  weight: number;
  reps: number;
  percentage: number;
  plates: string;
  isBarOnly: boolean;
  rest: number;
}

export interface WarmupPlan {
  workingWeight: number;
  unit: string;
  sets: WarmupSet[];
  totalWarmupSets: number;
  estimatedTime: number;
}

// ─── Constants ───

const PLATES_LBS = [45, 35, 25, 10, 5, 2.5];
const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25];

const DEFAULT_BAR_LBS = 45;
const DEFAULT_BAR_KG = 20;

/** Standard warm-up tiers with percentage, rep count, and rest seconds */
interface WarmupTier {
  pct: number;
  reps: number;
  rest: number;
  /** Minimum working weight (in lbs equivalent) for this tier to apply */
  minWorkingWeightLbs: number;
  /** Whether this tier is only included with includeHeavySingle */
  heavyOnly?: boolean;
}

const WARMUP_TIERS: WarmupTier[] = [
  { pct: 0.40, reps: 5, rest: 60,  minWorkingWeightLbs: 135 },
  { pct: 0.60, reps: 3, rest: 60,  minWorkingWeightLbs: 0 },
  { pct: 0.75, reps: 2, rest: 90,  minWorkingWeightLbs: 0 },
  { pct: 0.85, reps: 1, rest: 120, minWorkingWeightLbs: 0 },
  { pct: 0.90, reps: 1, rest: 120, minWorkingWeightLbs: 0, heavyOnly: true },
];

// ─── Weight Rounding ───

function roundToPlateIncrement(weight: number, unit: 'lbs' | 'kg'): number {
  const increment = unit === 'kg' ? 2.5 : 5;
  return Math.round(weight / increment) * increment;
}

// ─── Plate Loading ───

/**
 * Calculate plate loading per side for a given weight.
 * Returns a human-readable string like "45+25+10 per side" or "empty bar".
 */
export function describePlateLoading(
  weight: number,
  unit: 'lbs' | 'kg',
  barWeight?: number,
): string {
  const bar = barWeight ?? (unit === 'kg' ? DEFAULT_BAR_KG : DEFAULT_BAR_LBS);

  if (weight <= bar) {
    return 'empty bar';
  }

  const plates = unit === 'kg' ? PLATES_KG : PLATES_LBS;
  let remaining = (weight - bar) / 2;
  const perSide: string[] = [];

  for (const plate of plates) {
    while (remaining >= plate - 0.001) {
      perSide.push(String(plate));
      remaining -= plate;
    }
  }

  if (perSide.length === 0) {
    return 'empty bar';
  }

  return perSide.join('+') + ' per side';
}

// ─── Warm-up Plan Generation ───

/**
 * Generate a structured warm-up ramp for a given working weight.
 *
 * Standard powerlifting warm-up protocol:
 * - Empty bar x 5-10 reps (always, unless working weight IS the bar)
 * - ~40% x 5 reps (skip if working weight < 135 lbs / 60 kg)
 * - ~60% x 3-5 reps
 * - ~75% x 2-3 reps
 * - ~85% x 1-2 reps
 * - ~90% x 1 (optional, for heavy days only)
 *
 * Rules:
 * - Never include a warm-up set equal to or heavier than the working weight
 * - Round all weights to nearest plate increment (5 lbs / 2.5 kg)
 * - Skip redundant sets (e.g., if 40% rounds to the bar, skip the 40% set)
 * - Minimum 2 warm-up sets (bar + one intermediate), maximum 6
 * - Rest between warm-up sets: 30s for bar, 60s for light, 90s for moderate, 120s for heavy
 */
export function generateWarmupPlan(
  workingWeight: number,
  unit: 'lbs' | 'kg',
  options?: {
    barWeight?: number;
    includeHeavySingle?: boolean;
    exercise?: string;
  },
): WarmupPlan {
  const bar = options?.barWeight ?? (unit === 'kg' ? DEFAULT_BAR_KG : DEFAULT_BAR_LBS);
  const includeHeavy = options?.includeHeavySingle ?? false;

  // If working weight is at or below the bar, no warm-up needed
  if (workingWeight <= bar) {
    return {
      workingWeight,
      unit,
      sets: [],
      totalWarmupSets: 0,
      estimatedTime: 0,
    };
  }

  const sets: WarmupSet[] = [];
  let setNumber = 1;

  // Convert working weight to lbs equivalent for tier thresholds
  const workingWeightLbs = unit === 'kg' ? workingWeight * 2.2046 : workingWeight;

  // Set 1: empty bar
  const barReps = options?.exercise === 'deadlift' ? 5 : (workingWeightLbs >= 225 ? 10 : 5);
  sets.push({
    setNumber: setNumber++,
    weight: bar,
    reps: barReps,
    percentage: Math.round((bar / workingWeight) * 100),
    plates: 'empty bar',
    isBarOnly: true,
    rest: 30,
  });

  // Track unique weights to avoid duplicates
  const usedWeights = new Set<number>([bar]);

  // Intermediate warm-up sets from tiers
  for (const tier of WARMUP_TIERS) {
    if (tier.heavyOnly && !includeHeavy) continue;
    if (workingWeightLbs < tier.minWorkingWeightLbs) continue;

    const rawWeight = workingWeight * tier.pct;
    const rounded = roundToPlateIncrement(rawWeight, unit);

    // Skip if rounds to bar or to a weight we already used
    if (rounded <= bar) continue;
    if (usedWeights.has(rounded)) continue;

    // Never include a warm-up set >= working weight
    if (rounded >= workingWeight) continue;

    usedWeights.add(rounded);

    sets.push({
      setNumber: setNumber++,
      weight: rounded,
      reps: tier.reps,
      percentage: Math.round((rounded / workingWeight) * 100),
      plates: describePlateLoading(rounded, unit, bar),
      isBarOnly: false,
      rest: tier.rest,
    });
  }

  // Enforce maximum 6 sets (trim from the lighter end, keeping bar set)
  while (sets.length > 6) {
    sets.splice(1, 1);
    // Re-number
    sets.forEach((s, i) => { s.setNumber = i + 1; });
  }

  // Estimate total warmup time: sum of rest periods + ~30s per set execution
  const totalRestSeconds = sets.reduce((sum, s) => sum + s.rest, 0);
  const totalExecutionSeconds = sets.length * 30;
  const estimatedTime = Math.round((totalRestSeconds + totalExecutionSeconds) / 60);

  return {
    workingWeight,
    unit,
    sets,
    totalWarmupSets: sets.length,
    estimatedTime: Math.max(1, estimatedTime),
  };
}

// ─── HTML Rendering ───

/**
 * Render a warm-up plan as an HTML card suitable for display above working sets.
 */
export function renderWarmupPlan(plan: WarmupPlan): string {
  if (plan.sets.length === 0) {
    return '<div class="warmup-card"><p>No warm-up needed — working weight is the empty bar.</p></div>';
  }

  const rows = plan.sets.map(set => {
    const weightLabel = set.isBarOnly
      ? `${set.weight} ${plan.unit} (bar)`
      : `${set.weight} ${plan.unit}`;
    const restLabel = set.rest < 60 ? `${set.rest}s` : `${Math.round(set.rest / 60)}min`;

    return `<tr>
      <td>${set.setNumber}</td>
      <td>${weightLabel}</td>
      <td>${set.reps}</td>
      <td>${set.percentage}%</td>
      <td class="warmup-plates">${set.plates}</td>
      <td>${restLabel}</td>
    </tr>`;
  }).join('\n');

  return `<div class="warmup-card">
  <h4>Warm-Up Ramp</h4>
  <p class="warmup-meta">${plan.totalWarmupSets} sets &middot; ~${plan.estimatedTime} min</p>
  <table class="warmup-table">
    <thead>
      <tr>
        <th>#</th>
        <th>Weight</th>
        <th>Reps</th>
        <th>% Work</th>
        <th>Plates</th>
        <th>Rest</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</div>`;
}
