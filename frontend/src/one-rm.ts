/**
 * 1RM estimation using rep-based formulas.
 * Uses weight + rep count to estimate one-rep max.
 */

export type OneRMConfidence = 'high' | 'moderate' | 'low';

export interface OneRMEstimate {
  epley: number;
  brzycki: number;
  average: number;
  weight: number;
  reps: number;
  unit: string;
  confidence: OneRMConfidence;
  percentageTable: { percent: number; weight: number }[];
}

/** Determine confidence level based on rep count. */
function getConfidence(reps: number): OneRMConfidence {
  if (reps <= 3) return 'high';
  if (reps <= 6) return 'moderate';
  return 'low';
}

/**
 * Estimate 1RM from weight and reps performed. Valid for 1-15 reps.
 * Uses Epley (1985) and Brzycki (1993) formulas; accuracy decreases above 10 reps.
 */
export function estimateOneRM(weight: number, reps: number, unit: string): OneRMEstimate | null {
  if (weight <= 0 || reps < 1 || reps > 15) return null;

  const confidence = getConfidence(reps);

  // Single rep = weight IS the 1RM
  if (reps === 1) {
    const table = generatePercentageTable(weight);
    return { epley: weight, brzycki: weight, average: weight, weight, reps, unit, confidence, percentageTable: table };
  }

  const epley = weight * (1 + reps / 30);
  const brzycki = weight * (36 / (37 - reps));
  const average = Math.round((epley + brzycki) / 2);

  return {
    epley: Math.round(epley),
    brzycki: Math.round(brzycki),
    average,
    weight,
    reps,
    unit,
    confidence,
    percentageTable: generatePercentageTable(average),
  };
}

function generatePercentageTable(oneRM: number): { percent: number; weight: number }[] {
  return [100, 95, 90, 85, 80, 75, 70, 65, 60].map(percent => ({
    percent,
    weight: Math.round(oneRM * percent / 100),
  }));
}

// ─── DOTS Score (IPF-adopted relative strength metric, adopted 2019) ───

export interface DOTSResult {
  score: number;
  bodyweight: number;
  total: number;
  isMale: boolean;
}

/**
 * Compute DOTS coefficient for relative strength comparison.
 * DOTS replaced Wilks as the IPF's official formula, adopted in 2019.
 * Coefficients from the International Powerlifting Federation.
 */
export function computeDOTS(total: number, bodyweight: number, isMale: boolean): DOTSResult | null {
  if (total <= 0 || bodyweight <= 0) return null;

  const c = isMale
    ? [-307.75076, 24.0900756, -0.1918759221, 0.0007391293, -0.000001093]
    : [-57.96288, 13.6175032, -0.1126655495, 0.0005158568, -0.0000010706];

  const bw = bodyweight;
  const denom = c[0] + c[1] * bw + c[2] * bw ** 2 + c[3] * bw ** 3 + c[4] * bw ** 4;

  if (Math.abs(denom) < 1e-9) return null;

  const score = Math.round((500 / denom) * total * 100) / 100;
  return { score, bodyweight, total, isMale };
}
