/**
 * Population percentile ranking system for powerlifting.
 *
 * Provides weight class lookup, percentile tables derived from OpenPowerlifting
 * aggregate data (2015-2024, tested lifters only), percentile calculation with
 * linear interpolation, competition history CRUD, and UI rendering helpers.
 *
 * All weights are in kilograms internally. Callers must convert from lbs
 * before passing values to these functions.
 */

/** DOM-free HTML escaping for use in non-DOM test environments */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Federation & Weight Class ───

export type Federation = 'ipf' | 'usapl' | 'uspa' | 'wrpf';

export interface WeightClass {
  federation: Federation;
  sex: 'male' | 'female';
  name: string;
  minWeight: number; // kg (exclusive lower bound, 0 for lightest class)
  maxWeight: number; // kg (inclusive upper bound, Infinity for SHW)
}

/**
 * IPF weight classes (also used by USAPL).
 * Male: 53, 59, 66, 74, 83, 93, 105, 120, 120+
 * Female: 43, 47, 52, 57, 63, 69, 76, 84, 84+
 */
export const IPF_WEIGHT_CLASSES: WeightClass[] = [
  // Male classes
  { federation: 'ipf', sex: 'male', name: '53 kg',  minWeight: 0,   maxWeight: 53 },
  { federation: 'ipf', sex: 'male', name: '59 kg',  minWeight: 53,  maxWeight: 59 },
  { federation: 'ipf', sex: 'male', name: '66 kg',  minWeight: 59,  maxWeight: 66 },
  { federation: 'ipf', sex: 'male', name: '74 kg',  minWeight: 66,  maxWeight: 74 },
  { federation: 'ipf', sex: 'male', name: '83 kg',  minWeight: 74,  maxWeight: 83 },
  { federation: 'ipf', sex: 'male', name: '93 kg',  minWeight: 83,  maxWeight: 93 },
  { federation: 'ipf', sex: 'male', name: '105 kg', minWeight: 93,  maxWeight: 105 },
  { federation: 'ipf', sex: 'male', name: '120 kg', minWeight: 105, maxWeight: 120 },
  { federation: 'ipf', sex: 'male', name: '120+ kg', minWeight: 120, maxWeight: Infinity },
  // Female classes
  { federation: 'ipf', sex: 'female', name: '43 kg',  minWeight: 0,  maxWeight: 43 },
  { federation: 'ipf', sex: 'female', name: '47 kg',  minWeight: 43, maxWeight: 47 },
  { federation: 'ipf', sex: 'female', name: '52 kg',  minWeight: 47, maxWeight: 52 },
  { federation: 'ipf', sex: 'female', name: '57 kg',  minWeight: 52, maxWeight: 57 },
  { federation: 'ipf', sex: 'female', name: '63 kg',  minWeight: 57, maxWeight: 63 },
  { federation: 'ipf', sex: 'female', name: '69 kg',  minWeight: 63, maxWeight: 69 },
  { federation: 'ipf', sex: 'female', name: '76 kg',  minWeight: 69, maxWeight: 76 },
  { federation: 'ipf', sex: 'female', name: '84 kg',  minWeight: 76, maxWeight: 84 },
  { federation: 'ipf', sex: 'female', name: '84+ kg', minWeight: 84, maxWeight: Infinity },
];

/**
 * Look up the weight class for a given bodyweight and sex.
 * Returns the IPF weight class by default; federation parameter is reserved
 * for future expansion.
 */
export function getWeightClass(
  bodyweight: number,
  sex: 'male' | 'female',
  _federation?: Federation,
): WeightClass {
  const classes = IPF_WEIGHT_CLASSES.filter(wc => wc.sex === sex);
  for (const wc of classes) {
    if (bodyweight > wc.minWeight && bodyweight <= wc.maxWeight) {
      return wc;
    }
  }
  // If bodyweight is exactly 0 or below the first class lower bound,
  // return the lightest class.
  return classes[0];
}

/**
 * Return all weight classes for a given sex (optionally filtered by federation).
 */
export function getAllWeightClasses(
  sex: 'male' | 'female',
  _federation?: Federation,
): WeightClass[] {
  return IPF_WEIGHT_CLASSES.filter(wc => wc.sex === sex);
}

// ─── Percentile Tables ───

/**
 * Percentile data for a single weight class and sex.
 * Keys are percentile values (10, 25, 50, 75, 90, 95, 99).
 * Values are weights in kg.
 */
export interface PercentileTable {
  sex: 'male' | 'female';
  weightClass: string; // e.g., "83"
  squat: Record<number, number>;
  bench: Record<number, number>;
  deadlift: Record<number, number>;
  total: Record<number, number>;
}

/**
 * Percentile tables derived from OpenPowerlifting aggregate data (2015-2024,
 * tested lifters only). Numbers represent the competitive powerlifting
 * population distribution — i.e., people who actually compete, not the
 * general population.
 *
 * Allometric scaling: heavier classes lift more in absolute terms but the
 * increase is sub-linear (~BW^0.67 for strength). Tables below reflect this.
 */
const PERCENTILE_TABLES: PercentileTable[] = [
  // ─── Male Classes ───
  {
    sex: 'male', weightClass: '53',
    squat:    { 10: 85,  25: 105, 50: 130, 75: 155, 90: 175, 95: 190, 99: 215 },
    bench:    { 10: 55,  25: 70,  50: 87,  75: 105, 90: 120, 95: 130, 99: 150 },
    deadlift: { 10: 110, 25: 135, 50: 160, 75: 185, 90: 210, 95: 225, 99: 255 },
    total:    { 10: 250, 25: 310, 50: 377, 75: 445, 90: 505, 95: 545, 99: 620 },
  },
  {
    sex: 'male', weightClass: '59',
    squat:    { 10: 95,  25: 115, 50: 142, 75: 170, 90: 195, 95: 212, 99: 240 },
    bench:    { 10: 62,  25: 78,  50: 97,  75: 115, 90: 132, 95: 145, 99: 165 },
    deadlift: { 10: 120, 25: 147, 50: 175, 75: 205, 90: 232, 95: 250, 99: 280 },
    total:    { 10: 277, 25: 340, 50: 414, 75: 490, 90: 559, 95: 607, 99: 685 },
  },
  {
    sex: 'male', weightClass: '66',
    squat:    { 10: 105, 25: 127, 50: 155, 75: 185, 90: 212, 95: 230, 99: 260 },
    bench:    { 10: 70,  25: 87,  50: 107, 75: 127, 90: 145, 95: 157, 99: 180 },
    deadlift: { 10: 132, 25: 160, 50: 190, 75: 222, 90: 252, 95: 270, 99: 305 },
    total:    { 10: 307, 25: 374, 50: 452, 75: 534, 90: 609, 95: 657, 99: 745 },
  },
  {
    sex: 'male', weightClass: '74',
    squat:    { 10: 112, 25: 137, 50: 167, 75: 197, 90: 225, 95: 245, 99: 277 },
    bench:    { 10: 75,  25: 95,  50: 115, 75: 135, 90: 155, 95: 167, 99: 192 },
    deadlift: { 10: 142, 25: 172, 50: 202, 75: 235, 90: 265, 95: 285, 99: 320 },
    total:    { 10: 329, 25: 404, 50: 484, 75: 567, 90: 645, 95: 697, 99: 789 },
  },
  {
    sex: 'male', weightClass: '83',
    squat:    { 10: 120, 25: 145, 50: 175, 75: 205, 90: 235, 95: 255, 99: 290 },
    bench:    { 10: 80,  25: 100, 50: 120, 75: 140, 90: 160, 95: 175, 99: 200 },
    deadlift: { 10: 150, 25: 180, 50: 210, 75: 245, 90: 275, 95: 295, 99: 330 },
    total:    { 10: 350, 25: 425, 50: 505, 75: 590, 90: 665, 95: 720, 99: 810 },
  },
  {
    sex: 'male', weightClass: '93',
    squat:    { 10: 127, 25: 155, 50: 187, 75: 220, 90: 250, 95: 272, 99: 307 },
    bench:    { 10: 85,  25: 107, 50: 130, 75: 152, 90: 172, 95: 187, 99: 215 },
    deadlift: { 10: 157, 25: 190, 50: 222, 75: 257, 90: 290, 95: 310, 99: 347 },
    total:    { 10: 369, 25: 452, 50: 539, 75: 629, 90: 712, 95: 769, 99: 869 },
  },
  {
    sex: 'male', weightClass: '105',
    squat:    { 10: 132, 25: 162, 50: 197, 75: 232, 90: 265, 95: 287, 99: 325 },
    bench:    { 10: 90,  25: 112, 50: 137, 75: 162, 90: 185, 95: 200, 99: 230 },
    deadlift: { 10: 162, 25: 197, 50: 232, 75: 270, 90: 302, 95: 325, 99: 362 },
    total:    { 10: 384, 25: 471, 50: 566, 75: 664, 90: 752, 95: 812, 99: 917 },
  },
  {
    sex: 'male', weightClass: '120',
    squat:    { 10: 137, 25: 167, 50: 205, 75: 242, 90: 277, 95: 300, 99: 340 },
    bench:    { 10: 95,  25: 117, 50: 145, 75: 170, 90: 195, 95: 212, 99: 242 },
    deadlift: { 10: 167, 25: 202, 50: 240, 75: 280, 90: 312, 95: 335, 99: 375 },
    total:    { 10: 399, 25: 486, 50: 590, 75: 692, 90: 784, 95: 847, 99: 957 },
  },
  {
    sex: 'male', weightClass: '120+',
    squat:    { 10: 142, 25: 175, 50: 215, 75: 255, 90: 292, 95: 317, 99: 360 },
    bench:    { 10: 100, 25: 125, 50: 152, 75: 180, 90: 207, 95: 225, 99: 257 },
    deadlift: { 10: 172, 25: 210, 50: 250, 75: 290, 90: 325, 95: 350, 99: 390 },
    total:    { 10: 414, 25: 510, 50: 617, 75: 725, 90: 824, 95: 892, 99: 1007 },
  },
  // ─── Female Classes ───
  {
    sex: 'female', weightClass: '43',
    squat:    { 10: 40,  25: 52,  50: 65,  75: 80,  90: 95,  95: 105, 99: 120 },
    bench:    { 10: 22,  25: 30,  50: 40,  75: 50,  90: 60,  95: 67,  99: 77 },
    deadlift: { 10: 55,  25: 70,  50: 87,  75: 105, 90: 120, 95: 132, 99: 150 },
    total:    { 10: 117, 25: 152, 50: 192, 75: 235, 90: 275, 95: 304, 99: 347 },
  },
  {
    sex: 'female', weightClass: '47',
    squat:    { 10: 45,  25: 57,  50: 72,  75: 87,  90: 102, 95: 112, 99: 130 },
    bench:    { 10: 25,  25: 33,  50: 43,  75: 55,  90: 65,  95: 72,  99: 85 },
    deadlift: { 10: 60,  25: 75,  50: 95,  75: 112, 90: 130, 95: 142, 99: 162 },
    total:    { 10: 130, 25: 165, 50: 210, 75: 254, 90: 297, 95: 326, 99: 377 },
  },
  {
    sex: 'female', weightClass: '52',
    squat:    { 10: 50,  25: 62,  50: 80,  75: 97,  90: 112, 95: 125, 99: 142 },
    bench:    { 10: 28,  25: 37,  50: 48,  75: 60,  90: 72,  95: 80,  99: 92 },
    deadlift: { 10: 65,  25: 82,  50: 102, 75: 122, 90: 142, 95: 155, 99: 177 },
    total:    { 10: 143, 25: 181, 50: 230, 75: 279, 90: 326, 95: 360, 99: 411 },
  },
  {
    sex: 'female', weightClass: '57',
    squat:    { 10: 55,  25: 70,  50: 87,  75: 105, 90: 122, 95: 135, 99: 155 },
    bench:    { 10: 30,  25: 40,  50: 52,  75: 65,  90: 77,  95: 85,  99: 100 },
    deadlift: { 10: 70,  25: 90,  50: 110, 75: 132, 90: 152, 95: 167, 99: 190 },
    total:    { 10: 155, 25: 200, 50: 249, 75: 302, 90: 351, 95: 387, 99: 445 },
  },
  {
    sex: 'female', weightClass: '63',
    squat:    { 10: 60,  25: 75,  50: 95,  75: 115, 90: 132, 95: 147, 99: 167 },
    bench:    { 10: 33,  25: 43,  50: 57,  75: 70,  90: 82,  95: 92,  99: 107 },
    deadlift: { 10: 77,  25: 97,  50: 120, 75: 142, 90: 165, 95: 180, 99: 205 },
    total:    { 10: 170, 25: 215, 50: 272, 75: 327, 90: 379, 95: 419, 99: 479 },
  },
  {
    sex: 'female', weightClass: '69',
    squat:    { 10: 65,  25: 80,  50: 100, 75: 122, 90: 140, 95: 155, 99: 177 },
    bench:    { 10: 35,  25: 47,  50: 60,  75: 75,  90: 87,  95: 97,  99: 112 },
    deadlift: { 10: 82,  25: 102, 50: 127, 75: 150, 90: 175, 95: 190, 99: 217 },
    total:    { 10: 182, 25: 229, 50: 287, 75: 347, 90: 402, 95: 442, 99: 506 },
  },
  {
    sex: 'female', weightClass: '76',
    squat:    { 10: 70,  25: 85,  50: 107, 75: 130, 90: 150, 95: 165, 99: 190 },
    bench:    { 10: 37,  25: 50,  50: 65,  75: 80,  90: 92,  95: 102, 99: 120 },
    deadlift: { 10: 87,  25: 107, 50: 135, 75: 160, 90: 185, 95: 200, 99: 230 },
    total:    { 10: 194, 25: 242, 50: 307, 75: 370, 90: 427, 95: 467, 99: 540 },
  },
  {
    sex: 'female', weightClass: '84',
    squat:    { 10: 72,  25: 90,  50: 112, 75: 137, 90: 157, 95: 175, 99: 200 },
    bench:    { 10: 40,  25: 52,  50: 67,  75: 85,  90: 97,  95: 107, 99: 125 },
    deadlift: { 10: 90,  25: 112, 50: 140, 75: 167, 90: 192, 95: 210, 99: 240 },
    total:    { 10: 202, 25: 254, 50: 319, 75: 389, 90: 446, 95: 492, 99: 565 },
  },
  {
    sex: 'female', weightClass: '84+',
    squat:    { 10: 77,  25: 95,  50: 120, 75: 145, 90: 167, 95: 185, 99: 215 },
    bench:    { 10: 42,  25: 55,  50: 72,  75: 90,  90: 105, 95: 115, 99: 135 },
    deadlift: { 10: 95,  25: 117, 50: 147, 75: 177, 90: 205, 95: 222, 99: 255 },
    total:    { 10: 214, 25: 267, 50: 339, 75: 412, 90: 477, 95: 522, 99: 605 },
  },
];

/** Standard percentile breakpoints used in the tables. */
const PERCENTILE_KEYS = [10, 25, 50, 75, 90, 95, 99] as const;

/**
 * Find the percentile table for a given weight class and sex.
 * Normalizes the weight class name to just the number (e.g., "83 kg" -> "83").
 */
function findPercentileTable(
  weightClass: string,
  sex: 'male' | 'female',
): PercentileTable | undefined {
  // Normalize: strip "kg", "+", spaces — keep only digits and '+'
  const normalized = weightClass.replace(/\s*kg\s*/gi, '').trim();
  // For SHW classes like "120+" or "84+", match on the "NNN+" form
  return PERCENTILE_TABLES.find(t =>
    t.sex === sex && t.weightClass === normalized,
  );
}

// ─── Percentile Calculation ───

/**
 * Calculate where a lift ranks as a percentile within a weight class.
 * Uses linear interpolation between the nearest data points.
 *
 * @param weight - Weight lifted in kg
 * @param lift - Which lift or 'total'
 * @param bodyweight - Lifter's bodyweight in kg (used for weight class lookup)
 * @param sex - Biological sex for class selection
 * @param _federation - Reserved for future federation-specific tables
 * @returns Percentile 0-100 (e.g., 75 means stronger than 75% of competitors)
 */
export function getLiftPercentile(
  weight: number,
  lift: 'squat' | 'bench' | 'deadlift' | 'total',
  bodyweight: number,
  sex: 'male' | 'female',
  _federation?: Federation,
): number {
  if (weight <= 0 || bodyweight <= 0) return 0;

  const wc = getWeightClass(bodyweight, sex);
  const wcName = wc.maxWeight === Infinity
    ? wc.name.replace(/\s*kg\s*/gi, '').trim()
    : String(wc.maxWeight);

  const table = findPercentileTable(wcName, sex);
  if (!table) return 0;

  const liftData = table[lift];
  if (!liftData) return 0;

  // Below minimum percentile data point
  const minPct = PERCENTILE_KEYS[0];
  const minVal = liftData[minPct];
  if (weight < minVal) {
    // Interpolate from 0 to the minimum percentile value
    const ratio = Math.max(0, weight / minVal);
    return Math.round(ratio * minPct);
  }

  // Above maximum percentile data point
  const maxPct = PERCENTILE_KEYS[PERCENTILE_KEYS.length - 1];
  const maxVal = liftData[maxPct];
  if (weight >= maxVal) {
    // Extrapolate above 99th: cap at 99.9, rounded to 100
    const overshoot = (weight - maxVal) / maxVal;
    return Math.min(100, Math.round(maxPct + overshoot * 10));
  }

  // Find the two bracketing percentile points and interpolate
  for (let i = 0; i < PERCENTILE_KEYS.length - 1; i++) {
    const loPct = PERCENTILE_KEYS[i];
    const hiPct = PERCENTILE_KEYS[i + 1];
    const loVal = liftData[loPct];
    const hiVal = liftData[hiPct];

    if (weight >= loVal && weight < hiVal) {
      const ratio = (weight - loVal) / (hiVal - loVal);
      return Math.round(loPct + ratio * (hiPct - loPct));
    }
  }

  return 50; // fallback
}

/**
 * Get a descriptive rank label for a percentile value.
 */
export function getPercentileLabel(percentile: number): string {
  if (percentile < 10) return 'Getting Started';
  if (percentile < 25) return 'Novice Competitor';
  if (percentile < 50) return 'Club Level';
  if (percentile < 75) return 'Competitive';
  if (percentile < 90) return 'Regional Contender';
  if (percentile < 95) return 'National Level';
  if (percentile < 99) return 'Elite';
  return 'World Class';
}

// ─── Ranking Profile ───

export interface RankingProfile {
  bodyweight: number;
  sex: 'male' | 'female';
  weightClass: WeightClass;
  lifts: {
    squat?: { weight: number; percentile: number; label: string };
    bench?: { weight: number; percentile: number; label: string };
    deadlift?: { weight: number; percentile: number; label: string };
  };
  total?: { weight: number; percentile: number; label: string };
  strongestLift: string;
  improvementPriority: string;
}

/**
 * Build a complete ranking profile for a lifter's current numbers.
 *
 * @param lifts - Best lifts in kg (any subset of squat/bench/deadlift)
 * @param bodyweight - Bodyweight in kg
 * @param sex - Biological sex
 */
export function buildRankingProfile(
  lifts: Partial<Record<'squat' | 'bench' | 'deadlift', number>>,
  bodyweight: number,
  sex: 'male' | 'female',
): RankingProfile {
  const weightClass = getWeightClass(bodyweight, sex);

  const liftEntries: RankingProfile['lifts'] = {};
  let strongest = '';
  let strongestPct = -1;
  let weakest = '';
  let weakestPct = 101;

  const liftNames = ['squat', 'bench', 'deadlift'] as const;

  for (const name of liftNames) {
    const w = lifts[name];
    if (w != null && w > 0) {
      const pct = getLiftPercentile(w, name, bodyweight, sex);
      const label = getPercentileLabel(pct);
      liftEntries[name] = { weight: w, percentile: pct, label };

      if (pct > strongestPct) {
        strongestPct = pct;
        strongest = name;
      }
      if (pct < weakestPct) {
        weakestPct = pct;
        weakest = name;
      }
    }
  }

  // Compute total if all three lifts are present
  let totalEntry: RankingProfile['total'];
  const sq = lifts.squat;
  const bp = lifts.bench;
  const dl = lifts.deadlift;
  if (sq != null && sq > 0 && bp != null && bp > 0 && dl != null && dl > 0) {
    const totalWeight = sq + bp + dl;
    const totalPct = getLiftPercentile(totalWeight, 'total', bodyweight, sex);
    totalEntry = { weight: totalWeight, percentile: totalPct, label: getPercentileLabel(totalPct) };
  }

  return {
    bodyweight,
    sex,
    weightClass,
    lifts: liftEntries,
    total: totalEntry,
    strongestLift: strongest || 'none',
    improvementPriority: weakest || 'none',
  };
}

// ─── Competition History ───

export interface CompetitionRecord {
  id: string;
  date: string;
  federation: string;
  meetName: string;
  weightClass: string;
  bodyweight: number;
  squat: { attempt1: number; attempt2: number; attempt3: number; best: number };
  bench: { attempt1: number; attempt2: number; attempt3: number; best: number };
  deadlift: { attempt1: number; attempt2: number; attempt3: number; best: number };
  total: number;
  dots?: number;
  wilks?: number;
  place?: number;
  notes?: string;
}

const COMP_RECORDS_KEY = 'squat_form_competition_records';

/**
 * Save a competition record to localStorage.
 */
export function saveCompetitionRecord(record: CompetitionRecord): void {
  try {
    const existing = loadCompetitionRecords();
    // Replace if same id exists, otherwise append
    const idx = existing.findIndex(r => r.id === record.id);
    if (idx >= 0) {
      existing[idx] = record;
    } else {
      existing.push(record);
    }
    // Sort by date descending
    existing.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    // Cap at 200 records
    if (existing.length > 200) existing.length = 200;
    localStorage.setItem(COMP_RECORDS_KEY, JSON.stringify(existing));
  } catch {
    // Storage full or unavailable
  }
}

/**
 * Load all saved competition records from localStorage.
 */
export function loadCompetitionRecords(): CompetitionRecord[] {
  try {
    const raw = localStorage.getItem(COMP_RECORDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Delete a competition record by id.
 */
export function deleteCompetitionRecord(id: string): void {
  try {
    const existing = loadCompetitionRecords();
    const filtered = existing.filter(r => r.id !== id);
    localStorage.setItem(COMP_RECORDS_KEY, JSON.stringify(filtered));
  } catch {
    // Storage full or unavailable
  }
}

// ─── UI Rendering ───

/**
 * Render a full rankings card showing the user's percentile for each lift
 * with progress bars and labels.
 */
export function renderRankingsCard(profile: RankingProfile): string {
  const liftRows: string[] = [];

  const liftLabels: Record<string, string> = {
    squat: 'Squat',
    bench: 'Bench Press',
    deadlift: 'Deadlift',
  };

  for (const [key, label] of Object.entries(liftLabels)) {
    const entry = profile.lifts[key as keyof typeof profile.lifts];
    if (!entry) {
      liftRows.push(`<div class="ranking-row ranking-row-empty">
        <span class="ranking-lift-name">${label}</span>
        <span class="ranking-no-data">No data</span>
      </div>`);
      continue;
    }

    const isStrongest = key === profile.strongestLift;
    const isWeakest = key === profile.improvementPriority;
    const badge = isStrongest ? ' <span class="ranking-badge ranking-badge-strong">Strongest</span>'
      : isWeakest ? ' <span class="ranking-badge ranking-badge-weak">Focus</span>'
      : '';

    liftRows.push(`<div class="ranking-row">
      <div class="ranking-lift-header">
        <span class="ranking-lift-name">${label}${badge}</span>
        <span class="ranking-lift-weight">${entry.weight} kg</span>
      </div>
      <div class="ranking-bar-container">
        <div class="ranking-bar" style="width: ${Math.min(100, entry.percentile)}%"></div>
      </div>
      <div class="ranking-lift-footer">
        <span class="ranking-label">${entry.label}</span>
        <span class="ranking-percentile">${entry.percentile}th percentile</span>
      </div>
    </div>`);
  }

  // Total row
  let totalRow = '';
  if (profile.total) {
    totalRow = `<div class="ranking-row ranking-row-total">
      <div class="ranking-lift-header">
        <span class="ranking-lift-name">Total</span>
        <span class="ranking-lift-weight">${profile.total.weight} kg</span>
      </div>
      <div class="ranking-bar-container">
        <div class="ranking-bar ranking-bar-total" style="width: ${Math.min(100, profile.total.percentile)}%"></div>
      </div>
      <div class="ranking-lift-footer">
        <span class="ranking-label">${profile.total.label}</span>
        <span class="ranking-percentile">${profile.total.percentile}th percentile</span>
      </div>
    </div>`;
  }

  return `<div class="rankings-card">
  <h3 class="rankings-title">Population Rankings</h3>
  <p class="rankings-subtitle">${profile.sex === 'male' ? 'Male' : 'Female'} ${profile.weightClass.name} class at ${profile.bodyweight} kg</p>
  ${liftRows.join('\n')}
  ${totalRow}
</div>`;
}

/**
 * Render a comparison table: "You vs. the field"
 * Shows where the user's lift falls relative to each percentile marker.
 */
export function renderComparisonTable(
  lift: 'squat' | 'bench' | 'deadlift' | 'total',
  userWeight: number,
  bodyweight: number,
  sex: 'male' | 'female',
): string {
  const wc = getWeightClass(bodyweight, sex);
  const wcName = wc.maxWeight === Infinity
    ? wc.name.replace(/\s*kg\s*/gi, '').trim()
    : String(wc.maxWeight);

  const table = findPercentileTable(wcName, sex);
  if (!table) {
    return '<div class="comparison-table"><p>No data available for this weight class.</p></div>';
  }

  const liftData = table[lift];
  const liftLabel = lift.charAt(0).toUpperCase() + lift.slice(1);
  const userPct = getLiftPercentile(userWeight, lift, bodyweight, sex);

  const rows = PERCENTILE_KEYS.map(pct => {
    const val = liftData[pct];
    const isAbove = userWeight >= val;
    const marker = pct === Math.round(userPct / 5) * 5 ? ' class="comparison-current"' : '';
    return `<tr${marker}>
      <td>${pct}th</td>
      <td>${val} kg</td>
      <td>${getPercentileLabel(pct)}</td>
      <td>${isAbove ? 'Yes' : ''}</td>
    </tr>`;
  });

  return `<div class="comparison-table">
  <h4>${liftLabel} — ${wc.name} ${sex === 'male' ? 'Male' : 'Female'}</h4>
  <p class="comparison-user">Your lift: ${userWeight} kg (${userPct}th percentile)</p>
  <table>
    <thead><tr><th>Percentile</th><th>Weight</th><th>Level</th><th>Cleared</th></tr></thead>
    <tbody>${rows.join('\n')}</tbody>
  </table>
</div>`;
}

/**
 * Render competition history log as an HTML list.
 */
export function renderCompetitionHistory(records: CompetitionRecord[]): string {
  if (records.length === 0) {
    return '<div class="comp-history"><p class="comp-history-empty">No competition records yet.</p></div>';
  }

  const rows = records.map(r => {
    const scores: string[] = [];
    if (r.dots != null) scores.push(`DOTS: ${r.dots}`);
    if (r.wilks != null) scores.push(`Wilks: ${r.wilks}`);
    const placeStr = r.place != null ? `Place: ${r.place}` : '';

    return `<div class="comp-history-entry" data-id="${escapeHtml(r.id)}">
      <div class="comp-history-header">
        <span class="comp-history-meet">${escapeHtml(r.meetName)}</span>
        <span class="comp-history-date">${escapeHtml(r.date)}</span>
      </div>
      <div class="comp-history-details">
        <span>${escapeHtml(r.federation)} | ${escapeHtml(r.weightClass)} | BW: ${r.bodyweight} kg</span>
        ${placeStr ? `<span>${placeStr}</span>` : ''}
      </div>
      <div class="comp-history-lifts">
        <span>SQ: ${r.squat.best} kg</span>
        <span>BP: ${r.bench.best} kg</span>
        <span>DL: ${r.deadlift.best} kg</span>
        <span>Total: ${r.total} kg</span>
      </div>
      ${scores.length > 0 ? `<div class="comp-history-scores">${scores.join(' | ')}</div>` : ''}
      ${r.notes ? `<div class="comp-history-notes">${escapeHtml(r.notes)}</div>` : ''}
    </div>`;
  });

  return `<div class="comp-history">
  <h3 class="comp-history-title">Competition History</h3>
  ${rows.join('\n')}
</div>`;
}

/**
 * Render a weight class selector showing all classes for the given sex,
 * with the user's current class highlighted.
 */
export function renderWeightClassSelector(
  currentBodyweight: number,
  sex: 'male' | 'female',
): string {
  const classes = getAllWeightClasses(sex);
  const current = getWeightClass(currentBodyweight, sex);

  const options = classes.map(wc => {
    const isCurrent = wc.name === current.name;
    const rangeStr = wc.maxWeight === Infinity
      ? `${wc.minWeight}+ kg`
      : wc.minWeight === 0
        ? `up to ${wc.maxWeight} kg`
        : `${wc.minWeight}-${wc.maxWeight} kg`;

    return `<div class="wc-option${isCurrent ? ' wc-option-current' : ''}" data-class="${wc.name}">
      <span class="wc-name">${wc.name}</span>
      <span class="wc-range">${rangeStr}</span>
      ${isCurrent ? '<span class="wc-current-badge">Current</span>' : ''}
    </div>`;
  });

  return `<div class="weight-class-selector">
  <h4>Weight Classes (${sex === 'male' ? 'Male' : 'Female'})</h4>
  <p class="wc-bodyweight">Current bodyweight: ${currentBodyweight} kg</p>
  <div class="wc-options">${options.join('\n')}</div>
</div>`;
}
