import { describe, it, expect } from 'vitest';
import {
  getPercentOf1RM,
  calculateE1RMFromRPE,
  calculateWeightForTarget,
  generatePrescriptionTable,
  getRPEDescription,
  rpeToRIR,
  rirToRPE,
} from '../rpe-calculator';
import type { RPECalculation, PrescriptionRow } from '../rpe-calculator';

// ─── getPercentOf1RM ───

describe('getPercentOf1RM', () => {
  it('returns 1.00 for 1 rep at RPE 10 (true 1RM)', () => {
    expect(getPercentOf1RM(1, 10)).toBe(1.00);
  });

  it('returns correct value for 5 reps at RPE 8', () => {
    expect(getPercentOf1RM(5, 8)).toBe(0.81);
  });

  it('returns correct value for 8 reps at RPE 8', () => {
    expect(getPercentOf1RM(8, 8)).toBe(0.73);
  });

  it('clamps RPE below 6 to 6', () => {
    expect(getPercentOf1RM(5, 4)).toBe(getPercentOf1RM(5, 6));
  });

  it('clamps RPE above 10 to 10', () => {
    expect(getPercentOf1RM(5, 12)).toBe(getPercentOf1RM(5, 10));
  });

  it('clamps reps below 1 to 1', () => {
    expect(getPercentOf1RM(0, 8)).toBe(getPercentOf1RM(1, 8));
  });

  it('clamps reps above 12 to 12', () => {
    expect(getPercentOf1RM(15, 8)).toBe(getPercentOf1RM(12, 8));
  });

  it('handles half-step RPE values (e.g., 8.5)', () => {
    const pct = getPercentOf1RM(5, 8.5);
    expect(pct).toBe(0.82);
  });

  it('rounds non-standard RPE to nearest half-step', () => {
    // 8.3 should round to 8.5 (nearest half-step)
    const pct83 = getPercentOf1RM(5, 8.3);
    const pct85 = getPercentOf1RM(5, 8.5);
    expect(pct83).toBe(pct85);
  });

  // Monotonicity checks
  it('returns higher %1RM for higher RPE at fixed reps', () => {
    for (let reps = 1; reps <= 12; reps++) {
      for (let rpe = 6.5; rpe <= 10; rpe += 0.5) {
        const current = getPercentOf1RM(reps, rpe);
        const lower = getPercentOf1RM(reps, rpe - 0.5);
        expect(current).toBeGreaterThanOrEqual(lower);
      }
    }
  });

  it('returns lower %1RM for more reps at fixed RPE', () => {
    for (let rpe = 6; rpe <= 10; rpe += 0.5) {
      for (let reps = 2; reps <= 12; reps++) {
        const current = getPercentOf1RM(reps, rpe);
        const fewer = getPercentOf1RM(reps - 1, rpe);
        expect(current).toBeLessThanOrEqual(fewer);
      }
    }
  });

  it('covers RPE range 6-10 in 0.5 increments', () => {
    const expectedRPEs = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
    for (const rpe of expectedRPEs) {
      const result = getPercentOf1RM(5, rpe);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  });

  it('covers reps 1-12', () => {
    for (let reps = 1; reps <= 12; reps++) {
      const result = getPercentOf1RM(reps, 8);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  });
});

// ─── calculateE1RMFromRPE ───

describe('calculateE1RMFromRPE', () => {
  it('estimates ~123 e1RM from 100kg x 5 @ RPE 8', () => {
    // %1RM for 5 reps @ RPE 8 = 0.81
    // e1RM = 100 / 0.81 = 123.456... → rounded to 123
    const result = calculateE1RMFromRPE(100, 5, 8, 'kg');
    expect(result.estimated1RM).toBe(123);
  });

  it('returns weight as 1RM for 1 rep at RPE 10', () => {
    // %1RM = 1.00, e1RM = 315 / 1.00 = 315
    const result = calculateE1RMFromRPE(315, 1, 10, 'lbs');
    expect(result.estimated1RM).toBe(315);
  });

  it('returns higher e1RM for lower RPE (lighter relative load)', () => {
    // RPE 6, 5 reps: %1RM = 0.75 → e1RM = 100 / 0.75 = 133
    const rpe6 = calculateE1RMFromRPE(100, 5, 6, 'kg');
    const rpe8 = calculateE1RMFromRPE(100, 5, 8, 'kg');
    expect(rpe6.estimated1RM).toBeGreaterThan(rpe8.estimated1RM);
  });

  it('clamps RPE < 6 to 6', () => {
    const result = calculateE1RMFromRPE(100, 5, 3, 'kg');
    const expected = calculateE1RMFromRPE(100, 5, 6, 'kg');
    expect(result.estimated1RM).toBe(expected.estimated1RM);
  });

  it('clamps RPE > 10 to 10', () => {
    const result = calculateE1RMFromRPE(100, 5, 12, 'kg');
    const expected = calculateE1RMFromRPE(100, 5, 10, 'kg');
    expect(result.estimated1RM).toBe(expected.estimated1RM);
  });

  it('clamps reps < 1 to 1', () => {
    const result = calculateE1RMFromRPE(100, 0, 8, 'kg');
    const expected = calculateE1RMFromRPE(100, 1, 8, 'kg');
    expect(result.estimated1RM).toBe(expected.estimated1RM);
  });

  it('clamps reps > 12 to 12', () => {
    const result = calculateE1RMFromRPE(100, 20, 8, 'kg');
    const expected = calculateE1RMFromRPE(100, 12, 8, 'kg');
    expect(result.estimated1RM).toBe(expected.estimated1RM);
  });

  it('returns 0 e1RM for weight = 0', () => {
    const result = calculateE1RMFromRPE(0, 5, 8, 'kg');
    expect(result.estimated1RM).toBe(0);
  });

  it('returns correct percentOf1RM field', () => {
    const result = calculateE1RMFromRPE(100, 5, 8, 'kg');
    expect(result.percentOf1RM).toBe(81); // 0.81 * 100
  });

  it('preserves unit in result', () => {
    const lbs = calculateE1RMFromRPE(225, 5, 8, 'lbs');
    expect(lbs.unit).toBe('lbs');
    const kg = calculateE1RMFromRPE(100, 5, 8, 'kg');
    expect(kg.unit).toBe('kg');
  });

  it('includes a prescription table in the result', () => {
    const result = calculateE1RMFromRPE(225, 5, 8, 'lbs');
    expect(result.prescriptionTable).toBeDefined();
    expect(result.prescriptionTable.length).toBeGreaterThan(0);
  });

  it('preserves input weight, reps, rpe in result', () => {
    const result = calculateE1RMFromRPE(225, 8, 9, 'lbs');
    expect(result.weight).toBe(225);
    expect(result.reps).toBe(8);
    expect(result.rpe).toBe(9);
  });

  it('defaults unit to "lbs" when not specified', () => {
    const result = calculateE1RMFromRPE(225, 5, 8);
    expect(result.unit).toBe('lbs');
  });
});

// ─── calculateWeightForTarget ───

describe('calculateWeightForTarget', () => {
  it('calculates correct weight for 5 reps @ RPE 8 given 1RM', () => {
    // 1RM = 315, 5 reps @ RPE 8 → 315 * 0.81 = 255.15 → rounded to plate increment
    const weight = calculateWeightForTarget(315, 5, 8, 'lbs');
    // 255.15 / 5 = 51.03, round = 51, * 5 = 255
    expect(weight).toBe(255);
  });

  it('returns higher weight for higher RPE at same reps', () => {
    const e1rm = 315;
    const rpe8 = calculateWeightForTarget(e1rm, 5, 8, 'lbs');
    const rpe9 = calculateWeightForTarget(e1rm, 5, 9, 'lbs');
    expect(rpe9).toBeGreaterThan(rpe8);
  });

  it('returns lower weight for more reps at same RPE', () => {
    const e1rm = 315;
    const reps5 = calculateWeightForTarget(e1rm, 5, 8, 'lbs');
    const reps8 = calculateWeightForTarget(e1rm, 8, 8, 'lbs');
    expect(reps8).toBeLessThan(reps5);
  });

  it('rounds to 5 lb increments for lbs unit', () => {
    const weight = calculateWeightForTarget(315, 5, 8, 'lbs');
    expect(weight % 5).toBe(0);
  });

  it('rounds to 2.5 kg increments for kg unit', () => {
    const weight = calculateWeightForTarget(140, 5, 8, 'kg');
    expect(weight % 2.5).toBe(0);
  });

  it('returns 0 for 0 e1RM', () => {
    expect(calculateWeightForTarget(0, 5, 8, 'lbs')).toBe(0);
  });

  it('handles 1 rep @ RPE 10 (should be ≈ e1RM)', () => {
    const weight = calculateWeightForTarget(315, 1, 10, 'lbs');
    // 315 * 1.00 = 315, rounded to 5 = 315
    expect(weight).toBe(315);
  });

  it('defaults unit to "lbs"', () => {
    const weight = calculateWeightForTarget(315, 5, 8);
    expect(weight % 5).toBe(0);
  });
});

// ─── generatePrescriptionTable ───

describe('generatePrescriptionTable', () => {
  it('returns an array of prescription rows', () => {
    const table = generatePrescriptionTable(315, 'lbs');
    expect(table.length).toBeGreaterThan(0);
    expect(Array.isArray(table)).toBe(true);
  });

  it('all rows have positive weights for positive e1RM', () => {
    const table = generatePrescriptionTable(315, 'lbs');
    for (const row of table) {
      expect(row.weight).toBeGreaterThan(0);
    }
  });

  it('all weights are rounded to plate increments (5 lbs)', () => {
    const table = generatePrescriptionTable(315, 'lbs');
    for (const row of table) {
      expect(row.weight % 5).toBe(0);
    }
  });

  it('all weights are rounded to plate increments (2.5 kg)', () => {
    const table = generatePrescriptionTable(140, 'kg');
    for (const row of table) {
      expect(row.weight % 2.5).toBe(0);
    }
  });

  it('higher RPE → higher weight for same reps in the table', () => {
    const table = generatePrescriptionTable(315, 'lbs');
    // Find rows for 5 reps at different RPEs
    const fiveReps = table.filter(r => r.reps === 5);
    if (fiveReps.length >= 2) {
      const sorted = [...fiveReps].sort((a, b) => a.rpe - b.rpe);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].weight).toBeGreaterThanOrEqual(sorted[i - 1].weight);
      }
    }
  });

  it('more reps → lower weight for same RPE in the table', () => {
    const table = generatePrescriptionTable(315, 'lbs');
    // Find rows at RPE 9
    const rpe9 = table.filter(r => r.rpe === 9);
    if (rpe9.length >= 2) {
      const sorted = [...rpe9].sort((a, b) => a.reps - b.reps);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].weight).toBeLessThanOrEqual(sorted[i - 1].weight);
      }
    }
  });

  it('includes the true 1RM row (1 rep @ RPE 10)', () => {
    const table = generatePrescriptionTable(315, 'lbs');
    const oneRepMax = table.find(r => r.reps === 1 && r.rpe === 10);
    expect(oneRepMax).toBeDefined();
    expect(oneRepMax!.percent).toBe(100);
    expect(oneRepMax!.weight).toBe(315);
  });

  it('each row has reps, rpe, percent, and weight fields', () => {
    const table = generatePrescriptionTable(315, 'lbs');
    for (const row of table) {
      expect(typeof row.reps).toBe('number');
      expect(typeof row.rpe).toBe('number');
      expect(typeof row.percent).toBe('number');
      expect(typeof row.weight).toBe('number');
    }
  });

  it('returns zero-weight rows for 0 e1RM', () => {
    const table = generatePrescriptionTable(0, 'lbs');
    for (const row of table) {
      expect(row.weight).toBe(0);
    }
  });
});

// ─── getRPEDescription ───

describe('getRPEDescription', () => {
  it('returns "Maximum effort" for RPE 10', () => {
    const desc = getRPEDescription(10);
    expect(desc.toLowerCase()).toContain('maximum');
  });

  it('mentions "2 more reps" or "2 RIR" for RPE 8', () => {
    const desc = getRPEDescription(8);
    expect(desc).toMatch(/2 more reps|2 RIR/i);
  });

  it('mentions "4+" or "4 more reps" for RPE 6', () => {
    const desc = getRPEDescription(6);
    expect(desc).toMatch(/4\+|4 more/i);
  });

  it('returns descriptions for half-step values', () => {
    expect(getRPEDescription(7.5)).toBeTruthy();
    expect(getRPEDescription(8.5)).toBeTruthy();
    expect(getRPEDescription(9.5)).toBeTruthy();
  });

  it('mentions "1 more rep" or "1 RIR" for RPE 9', () => {
    const desc = getRPEDescription(9);
    expect(desc).toMatch(/1 more rep|1 RIR/i);
  });

  it('mentions "3 more reps" or "3 RIR" for RPE 7', () => {
    const desc = getRPEDescription(7);
    expect(desc).toMatch(/3 more reps|3 RIR/i);
  });

  it('clamps RPE below 6 and returns a valid description', () => {
    const desc = getRPEDescription(3);
    expect(desc).toBeTruthy();
    expect(desc).toBe(getRPEDescription(6));
  });

  it('clamps RPE above 10 and returns a valid description', () => {
    const desc = getRPEDescription(12);
    expect(desc).toBeTruthy();
    expect(desc).toBe(getRPEDescription(10));
  });
});

// ─── rpeToRIR / rirToRPE ───

describe('rpeToRIR', () => {
  it('RPE 10 → 0 RIR', () => {
    expect(rpeToRIR(10)).toBe(0);
  });

  it('RPE 8 → 2 RIR', () => {
    expect(rpeToRIR(8)).toBe(2);
  });

  it('RPE 6 → 4 RIR', () => {
    expect(rpeToRIR(6)).toBe(4);
  });

  it('RPE 9.5 → 0.5 RIR', () => {
    expect(rpeToRIR(9.5)).toBe(0.5);
  });

  it('RPE > 10 → 0 RIR (clamped)', () => {
    expect(rpeToRIR(12)).toBe(0);
  });
});

describe('rirToRPE', () => {
  it('0 RIR → RPE 10', () => {
    expect(rirToRPE(0)).toBe(10);
  });

  it('2 RIR → RPE 8', () => {
    expect(rirToRPE(2)).toBe(8);
  });

  it('4 RIR → RPE 6', () => {
    expect(rirToRPE(4)).toBe(6);
  });

  it('clamps result to minimum RPE 6', () => {
    expect(rirToRPE(10)).toBe(6);
  });

  it('clamps result to maximum RPE 10', () => {
    expect(rirToRPE(-2)).toBe(10);
  });

  it('round-trips with rpeToRIR', () => {
    for (let rpe = 6; rpe <= 10; rpe += 0.5) {
      const rir = rpeToRIR(rpe);
      expect(rirToRPE(rir)).toBe(rpe);
    }
  });
});
