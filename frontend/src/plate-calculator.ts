/**
 * Plate calculator: shows which plates to load on each side of the bar.
 * Standard plate sizes: 45, 35, 25, 10, 5, 2.5 lbs / 25, 20, 15, 10, 5, 2.5, 1.25 kg
 */

export interface PlateResult {
  targetWeight: number;
  barWeight: number;
  perSide: Array<{ plate: number; count: number }>;
  totalLoaded: number;
  unit: string;
  achievable: boolean;
  /** If not exact, the closest achievable weight */
  closestWeight: number;
}

const PLATES_LBS = [45, 35, 25, 10, 5, 2.5];
const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25];

export function calculatePlates(
  targetWeight: number,
  unit: string = 'lbs',
  barWeight?: number,
): PlateResult {
  const bar = barWeight ?? (unit === 'kg' ? 20 : 45);
  const plates = unit === 'kg' ? PLATES_KG : PLATES_LBS;

  if (targetWeight <= bar) {
    return {
      targetWeight, barWeight: bar, perSide: [],
      totalLoaded: bar, unit, achievable: targetWeight === bar,
      closestWeight: bar,
    };
  }

  let remaining = (targetWeight - bar) / 2; // per side
  const perSide: Array<{ plate: number; count: number }> = [];

  for (const plate of plates) {
    if (remaining >= plate) {
      const count = Math.floor(remaining / plate);
      perSide.push({ plate, count });
      remaining -= count * plate;
    }
  }

  const totalPerSide = perSide.reduce((s, p) => s + p.plate * p.count, 0);
  const totalLoaded = bar + totalPerSide * 2;

  return {
    targetWeight,
    barWeight: bar,
    perSide,
    totalLoaded,
    unit,
    achievable: Math.abs(totalLoaded - targetWeight) < 0.01,
    closestWeight: totalLoaded,
  };
}

/**
 * Format plate result as a human-readable string.
 * Example: "Each side: 45 + 25 + 10 = 80 lbs per side"
 */
export function formatPlateResult(result: PlateResult): string {
  if (result.perSide.length === 0) {
    return `Empty bar (${result.barWeight} ${result.unit})`;
  }

  const parts = result.perSide.map(p =>
    p.count === 1 ? `${p.plate}` : `${p.plate}×${p.count}`
  );
  const perSideTotal = result.perSide.reduce((s, p) => s + p.plate * p.count, 0);

  let text = `Each side: ${parts.join(' + ')}`;
  if (perSideTotal > 0) text += ` (${perSideTotal} ${result.unit}/side)`;
  if (!result.achievable) {
    text += ` — closest: ${result.closestWeight} ${result.unit}`;
  }
  return text;
}
