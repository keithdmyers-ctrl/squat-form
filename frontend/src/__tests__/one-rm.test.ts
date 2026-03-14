import { describe, it, expect } from 'vitest';
import { estimateOneRM } from '../one-rm';

describe('estimateOneRM', () => {
  it('returns null for invalid inputs', () => {
    expect(estimateOneRM(0, 5, 'lbs')).toBeNull();
    expect(estimateOneRM(100, 0, 'lbs')).toBeNull();
    expect(estimateOneRM(100, 16, 'lbs')).toBeNull(); // extended to 15 reps
    expect(estimateOneRM(-50, 5, 'lbs')).toBeNull();
  });

  it('returns weight as 1RM for single rep', () => {
    const result = estimateOneRM(315, 1, 'lbs');
    expect(result).not.toBeNull();
    expect(result!.average).toBe(315);
    expect(result!.epley).toBe(315);
    expect(result!.brzycki).toBe(315);
  });

  it('estimates correctly for 5 reps at 225 lbs', () => {
    const result = estimateOneRM(225, 5, 'lbs');
    expect(result).not.toBeNull();
    // Epley: 225 * (1 + 5/30) = 225 * 1.1667 = 262.5
    expect(result!.epley).toBe(263);
    // Brzycki: 225 * (36 / (37 - 5)) = 225 * 36/32 = 253.125
    expect(result!.brzycki).toBe(253);
    expect(result!.average).toBe(258);
  });

  it('generates percentage table', () => {
    const result = estimateOneRM(200, 5, 'kg');
    expect(result).not.toBeNull();
    expect(result!.percentageTable.length).toBe(9);
    expect(result!.percentageTable[0].percent).toBe(100);
    expect(result!.percentageTable[0].weight).toBe(result!.average);
  });

  it('preserves unit in result', () => {
    const result = estimateOneRM(100, 3, 'kg');
    expect(result!.unit).toBe('kg');
  });
});
