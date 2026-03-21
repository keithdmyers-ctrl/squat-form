/**
 * RPE Calculator: converts between weight/reps/RPE and estimated 1RM.
 *
 * Given any two of: weight, reps, RPE → calculates estimated 1RM and
 * generates a full prescription table.
 *
 * Source: Zourdos et al. (2016, PMID: 26666744); Helms et al. (2016);
 * Tuchscherer M. (Reactive Training Systems RPE chart)
 *
 * Examples:
 *   225 lbs × 8 reps @ RPE 8 → e1RM = 225 / 0.73 = 308 lbs
 *   315 lbs × 5 reps @ RPE 9 → e1RM = 315 / 0.84 = 375 lbs
 */

// ─── RPE-to-%1RM Table ───
// Complete table: reps 1-12, RPE 6-10 in 0.5 increments
// Values represent the percentage of true 1RM that a lifter can handle
// for the given reps at the given RPE.

const RPE_TABLE: Record<number, Record<number, number>> = {
  10:   { 1: 1.00, 2: 0.96, 3: 0.92, 4: 0.89, 5: 0.86, 6: 0.84, 7: 0.81, 8: 0.79, 9: 0.76, 10: 0.74, 11: 0.71, 12: 0.69 },
  9.5:  { 1: 0.98, 2: 0.94, 3: 0.91, 4: 0.88, 5: 0.85, 6: 0.82, 7: 0.80, 8: 0.77, 9: 0.75, 10: 0.72, 11: 0.70, 12: 0.67 },
  9:    { 1: 0.96, 2: 0.92, 3: 0.89, 4: 0.86, 5: 0.84, 6: 0.81, 7: 0.79, 8: 0.76, 9: 0.74, 10: 0.71, 11: 0.69, 12: 0.66 },
  8.5:  { 1: 0.94, 2: 0.91, 3: 0.88, 4: 0.85, 5: 0.82, 6: 0.79, 7: 0.77, 8: 0.74, 9: 0.72, 10: 0.69, 11: 0.67, 12: 0.64 },
  8:    { 1: 0.92, 2: 0.89, 3: 0.86, 4: 0.84, 5: 0.81, 6: 0.78, 7: 0.76, 8: 0.73, 9: 0.71, 10: 0.68, 11: 0.66, 12: 0.63 },
  7.5:  { 1: 0.91, 2: 0.88, 3: 0.85, 4: 0.82, 5: 0.79, 6: 0.76, 7: 0.74, 8: 0.71, 9: 0.69, 10: 0.66, 11: 0.64, 12: 0.61 },
  7:    { 1: 0.89, 2: 0.86, 3: 0.84, 4: 0.81, 5: 0.78, 6: 0.75, 7: 0.73, 8: 0.70, 9: 0.68, 10: 0.65, 11: 0.63, 12: 0.60 },
  6.5:  { 1: 0.88, 2: 0.85, 3: 0.82, 4: 0.80, 5: 0.77, 6: 0.74, 7: 0.71, 8: 0.69, 9: 0.66, 10: 0.64, 11: 0.61, 12: 0.59 },
  6:    { 1: 0.86, 2: 0.84, 3: 0.81, 4: 0.78, 5: 0.75, 6: 0.72, 7: 0.70, 8: 0.67, 9: 0.65, 10: 0.62, 11: 0.60, 12: 0.57 },
};

// ─── Types ───

export interface RPECalculation {
  /** Input weight used */
  weight: number;
  /** Input reps */
  reps: number;
  /** Input RPE */
  rpe: number;
  /** The percentage of 1RM this set represents */
  percentOf1RM: number;
  /** Estimated 1RM from this set */
  estimated1RM: number;
  /** Unit (lbs or kg) */
  unit: string;
  /** Full prescription table: what weight to use for different rep/RPE combos */
  prescriptionTable: PrescriptionRow[];
}

export interface PrescriptionRow {
  reps: number;
  rpe: number;
  percent: number;
  weight: number;
}

// ─── Calculator Functions ───

/**
 * Get the %1RM for a given reps × RPE combination.
 */
export function getPercentOf1RM(reps: number, rpe: number): number {
  const rpeKey = Math.round(Math.max(6, Math.min(10, rpe)) * 2) / 2;
  const row = RPE_TABLE[rpeKey] ?? RPE_TABLE[8];
  const clampedReps = Math.max(1, Math.min(12, Math.round(reps)));
  return row[clampedReps] ?? 0.75;
}

/**
 * Calculate estimated 1RM from weight × reps @ RPE.
 *
 * Formula: e1RM = weight / %1RM
 * Example: 225 × 8 @ RPE 8 → %1RM = 0.73 → e1RM = 225 / 0.73 = 308
 */
export function calculateE1RMFromRPE(
  weight: number,
  reps: number,
  rpe: number,
  unit: string = 'lbs',
): RPECalculation {
  const pct = getPercentOf1RM(reps, rpe);
  const e1rm = pct > 0 ? Math.round(weight / pct) : weight;

  // Generate prescription table
  const prescriptionTable = generatePrescriptionTable(e1rm, unit);

  return {
    weight,
    reps,
    rpe,
    percentOf1RM: Math.round(pct * 100),
    estimated1RM: e1rm,
    unit,
    prescriptionTable,
  };
}

/**
 * Calculate what weight to use for a target reps × RPE.
 *
 * Example: 1RM is 315, want to do 5 reps @ RPE 8 → 315 × 0.81 = 255
 */
export function calculateWeightForTarget(
  estimated1RM: number,
  targetReps: number,
  targetRPE: number,
  unit: string = 'lbs',
): number {
  const pct = getPercentOf1RM(targetReps, targetRPE);
  const increment = unit === 'kg' ? 2.5 : 5;
  return Math.round((estimated1RM * pct) / increment) * increment;
}

/**
 * Generate a full prescription table from an estimated 1RM.
 * Shows what weight to use for common rep/RPE combinations.
 */
export function generatePrescriptionTable(
  estimated1RM: number,
  unit: string = 'lbs',
): PrescriptionRow[] {
  const rows: PrescriptionRow[] = [];
  const increment = unit === 'kg' ? 2.5 : 5;
  const commonCombos: Array<[number, number]> = [
    // [reps, RPE] — most useful training prescriptions
    [1, 10],   // True 1RM
    [1, 9],    // Heavy single
    [1, 8],    // Moderate single
    [2, 9],    // Heavy doubles
    [3, 9],    // Heavy triples
    [3, 8],    // Moderate triples
    [5, 9],    // Heavy fives
    [5, 8],    // Moderate fives (most common work set)
    [5, 7],    // Light fives
    [8, 9],    // Heavy eights
    [8, 8],    // Moderate eights
    [8, 7],    // Light eights
    [10, 9],   // Heavy tens
    [10, 8],   // Moderate tens
    [12, 8],   // Hypertrophy range
  ];

  for (const [reps, rpe] of commonCombos) {
    const pct = getPercentOf1RM(reps, rpe);
    const weight = Math.round((estimated1RM * pct) / increment) * increment;
    rows.push({ reps, rpe, percent: Math.round(pct * 100), weight });
  }

  return rows;
}

/**
 * Get the RPE description (how many reps in reserve).
 */
export function getRPEDescription(rpe: number): string {
  const descriptions: Record<number, string> = {
    10: 'Maximum effort — could not do another rep',
    9.5: 'Could maybe do 1 more rep',
    9: 'Could definitely do 1 more rep (1 RIR)',
    8.5: 'Could maybe do 2 more reps',
    8: 'Could do 2 more reps (2 RIR)',
    7.5: 'Could maybe do 3 more reps',
    7: 'Could do 3 more reps (3 RIR)',
    6.5: 'Could do 3-4 more reps',
    6: 'Could do 4+ more reps (warm-up territory)',
  };
  const key = Math.round(Math.max(6, Math.min(10, rpe)) * 2) / 2;
  return descriptions[key] ?? `RPE ${rpe}`;
}

/**
 * Convert between RPE and RIR (Reps In Reserve).
 */
export function rpeToRIR(rpe: number): number {
  return Math.max(0, 10 - rpe);
}

export function rirToRPE(rir: number): number {
  return Math.max(6, Math.min(10, 10 - rir));
}
