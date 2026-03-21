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

// ─── Wilks-2 (2020 revision) ───

/**
 * Wilks-2 (2020 revision) coefficient calculation.
 * Used by USPA and many local federations for relative strength comparison.
 * Returns Wilks-2 score, or null for invalid inputs.
 *
 * Formula: score = total * 600 / (a + b*x + c*x^2 + d*x^3 + e*x^4 + f*x^5)
 * where x = bodyweight in kg.
 *
 * Coefficients from the 2020 Wilks revision by Robert Wilks.
 */
export function calculateWilks2(total: number, bodyweight: number, sex: 'male' | 'female'): number | null {
  if (total <= 0 || bodyweight <= 0) return null;
  // Clamp to physiologically reasonable range for polynomial stability
  if (bodyweight < 30 || bodyweight > 300) return null;

  const coeffs = sex === 'male'
    ? { a: -216.0475144, b: 16.2606339, c: -0.002388645, d: -0.00113732, e: 7.01863e-06, f: -1.291e-08 }
    : { a: 594.31747775582, b: -27.23842536447, c: 0.82112226871, d: -0.00930733913, e: 4.731582e-05, f: -9.054e-08 };

  const x = bodyweight;
  const denom = coeffs.a
    + coeffs.b * x
    + coeffs.c * x ** 2
    + coeffs.d * x ** 3
    + coeffs.e * x ** 4
    + coeffs.f * x ** 5;

  if (Math.abs(denom) < 1e-9) return null;

  const score = Math.round((600 / denom) * total * 100) / 100;
  return score > 0 ? score : null;
}

// ─── IPF GL (Goodlift) Points ───

/**
 * IPF GL (Goodlift) Points calculation.
 * Used by IPF for Best Lifter awards alongside DOTS.
 * Returns GL points, or null for invalid inputs.
 *
 * Formula: total * 100 / (A - B * e^(-C * bodyweight))
 *
 * Coefficients from the International Powerlifting Federation.
 */
export function calculateGLPoints(total: number, bodyweight: number, sex: 'male' | 'female'): number | null {
  if (total <= 0 || bodyweight <= 0) return null;
  if (bodyweight < 30 || bodyweight > 300) return null;

  const coeffs = sex === 'male'
    ? { A: 1199.72839, B: 1025.18162, C: 0.009210 }
    : { A: 610.32796, B: 1045.59282, C: 0.03048 };

  const denom = coeffs.A - coeffs.B * Math.exp(-coeffs.C * bodyweight);

  if (Math.abs(denom) < 1e-9) return null;

  const score = Math.round((total * 100 / denom) * 100) / 100;
  return score > 0 ? score : null;
}

// ─── 1RM Safety Check ───

/**
 * Approximate world records (in kg) by lift for plausibility checking.
 * Includes a generous margin above current records to account for future records.
 * Sources: IPF/WRPF/ATPL records as of 2025.
 */
const WORLD_RECORDS_KG: Record<string, { male: number; female: number }> = {
  squat:    { male: 505, female: 310 },
  bench:    { male: 355, female: 210 },
  deadlift: { male: 505, female: 315 },
  ohp:      { male: 220, female: 120 },
  total:    { male: 1310, female: 780 },
};

/**
 * Check whether an estimated 1RM is plausible, flagging values that exceed
 * known world records or extreme bodyweight multiples.
 *
 * @param estimatedMax - The estimated 1RM in kg (convert lbs to kg before calling)
 * @param lift - The lift name (squat, bench, deadlift, ohp, total)
 * @param bodyweight - Optional bodyweight in kg for bodyweight-multiple check
 */
export function check1RMSafety(
  estimatedMax: number,
  lift: string,
  bodyweight?: number,
): { plausible: boolean; warning?: string; worldRecordPct?: number } {
  if (estimatedMax <= 0) {
    return { plausible: false, warning: 'Estimated max must be greater than zero.' };
  }

  const liftKey = lift.toLowerCase().replace(/[-_ ]/g, '');
  const normalizedLift = liftKey === 'overheadpress' || liftKey === 'ohp' ? 'ohp'
    : liftKey === 'benchpress' ? 'bench'
    : liftKey;

  const records = WORLD_RECORDS_KG[normalizedLift];

  // If we don't have records for this lift, we can't check
  if (!records) {
    return { plausible: true };
  }

  // Use male records as the upper bound (higher of the two)
  const worldRecord = records.male;
  const worldRecordPct = Math.round((estimatedMax / worldRecord) * 100);

  // Flag if above world record
  if (estimatedMax > worldRecord) {
    return {
      plausible: false,
      warning: `This estimated max (${Math.round(estimatedMax)} kg) exceeds the world record of ${worldRecord} kg for ${normalizedLift}. Double-check your input.`,
      worldRecordPct,
    };
  }

  // Flag if above 90% of world record (extremely elite territory)
  if (estimatedMax > worldRecord * 0.9) {
    return {
      plausible: true,
      warning: `This estimated max (${Math.round(estimatedMax)} kg) is ${worldRecordPct}% of the world record. Make sure this is accurate.`,
      worldRecordPct,
    };
  }

  // Bodyweight multiple check
  if (bodyweight && bodyweight > 0) {
    const multiple = estimatedMax / bodyweight;
    const extremeMultiples: Record<string, number> = {
      squat: 4.5,
      bench: 3.5,
      deadlift: 5.0,
      ohp: 2.0,
      total: 12.0,
    };
    const extremeLimit = extremeMultiples[normalizedLift];
    if (extremeLimit && multiple > extremeLimit) {
      return {
        plausible: false,
        warning: `This estimated max is ${multiple.toFixed(1)}x bodyweight for ${normalizedLift}, which is beyond known human performance. Double-check your input.`,
        worldRecordPct,
      };
    }
  }

  return { plausible: true, worldRecordPct };
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
