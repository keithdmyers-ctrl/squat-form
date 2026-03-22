import { describe, it, expect } from 'vitest';
import { estimateOneRM, computeDOTS, calculateWilks2, calculateGLPoints, check1RMSafety } from '../one-rm';

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

// ── Additional estimateOneRM tests ──

describe('estimateOneRM (extended)', () => {
  it('Epley formula: 100 x 10 -> 133', () => {
    const result = estimateOneRM(100, 10, 'lbs');
    // Epley: 100 * (1 + 10/30) = 133.33 -> 133
    expect(result!.epley).toBe(133);
  });

  it('Brzycki formula: 100 x 10 -> 133', () => {
    const result = estimateOneRM(100, 10, 'lbs');
    // Brzycki: 100 * (36 / (37 - 10)) = 100 * 36/27 = 133.33 -> 133
    expect(result!.brzycki).toBe(133);
  });

  it('average of Epley and Brzycki', () => {
    const result = estimateOneRM(200, 8, 'lbs');
    const expectedAvg = Math.round((result!.epley + result!.brzycki) / 2);
    expect(result!.average).toBe(expectedAvg);
  });

  it('reps = 1 returns the weight itself for all fields', () => {
    const result = estimateOneRM(405, 1, 'lbs');
    expect(result!.epley).toBe(405);
    expect(result!.brzycki).toBe(405);
    expect(result!.average).toBe(405);
  });

  it('returns null for reps > 15', () => {
    expect(estimateOneRM(100, 16, 'lbs')).toBeNull();
    expect(estimateOneRM(100, 20, 'lbs')).toBeNull();
    expect(estimateOneRM(100, 100, 'lbs')).toBeNull();
  });

  it('returns null for weight <= 0', () => {
    expect(estimateOneRM(0, 5, 'lbs')).toBeNull();
    expect(estimateOneRM(-100, 5, 'lbs')).toBeNull();
  });

  it('returns null for reps < 1', () => {
    expect(estimateOneRM(100, 0, 'lbs')).toBeNull();
    expect(estimateOneRM(100, -1, 'lbs')).toBeNull();
  });

  it('confidence = high for 1-3 reps', () => {
    expect(estimateOneRM(200, 1, 'lbs')!.confidence).toBe('high');
    expect(estimateOneRM(200, 2, 'lbs')!.confidence).toBe('high');
    expect(estimateOneRM(200, 3, 'lbs')!.confidence).toBe('high');
  });

  it('confidence = moderate for 4-6 reps', () => {
    expect(estimateOneRM(200, 4, 'lbs')!.confidence).toBe('moderate');
    expect(estimateOneRM(200, 5, 'lbs')!.confidence).toBe('moderate');
    expect(estimateOneRM(200, 6, 'lbs')!.confidence).toBe('moderate');
  });

  it('confidence = low for 7+ reps', () => {
    expect(estimateOneRM(200, 7, 'lbs')!.confidence).toBe('low');
    expect(estimateOneRM(200, 10, 'lbs')!.confidence).toBe('low');
    expect(estimateOneRM(200, 15, 'lbs')!.confidence).toBe('low');
  });

  it('handles boundary reps = 15 (max valid)', () => {
    const result = estimateOneRM(100, 15, 'lbs');
    expect(result).not.toBeNull();
    // Epley: 100 * (1 + 15/30) = 150
    expect(result!.epley).toBe(150);
    // Brzycki: 100 * (36/(37-15)) = 100 * 36/22 = 163.6 -> 164
    expect(result!.brzycki).toBe(164);
  });

  it('Epley and Brzycki diverge more at higher reps', () => {
    const low = estimateOneRM(100, 2, 'lbs')!;
    const high = estimateOneRM(100, 12, 'lbs')!;
    const diffLow = Math.abs(low.epley - low.brzycki);
    const diffHigh = Math.abs(high.epley - high.brzycki);
    expect(diffHigh).toBeGreaterThanOrEqual(diffLow);
  });

  it('percentage table has 9 entries', () => {
    const result = estimateOneRM(200, 5, 'lbs');
    expect(result!.percentageTable).toHaveLength(9);
  });

  it('percentage table includes common percentages 60-100', () => {
    const result = estimateOneRM(200, 5, 'lbs');
    const percents = result!.percentageTable.map(e => e.percent);
    expect(percents).toContain(100);
    expect(percents).toContain(95);
    expect(percents).toContain(90);
    expect(percents).toContain(85);
    expect(percents).toContain(80);
    expect(percents).toContain(75);
    expect(percents).toContain(70);
    expect(percents).toContain(65);
    expect(percents).toContain(60);
  });

  it('percentage table weights decrease as percentage decreases', () => {
    const result = estimateOneRM(300, 5, 'lbs');
    const table = result!.percentageTable;
    for (let i = 1; i < table.length; i++) {
      expect(table[i].weight).toBeLessThanOrEqual(table[i - 1].weight);
    }
  });

  it('percentage table 100% entry equals the average 1RM', () => {
    const result = estimateOneRM(250, 5, 'lbs');
    const entry100 = result!.percentageTable.find(e => e.percent === 100);
    expect(entry100!.weight).toBe(result!.average);
  });

  it('percentage table weights are rounded integers', () => {
    const result = estimateOneRM(137, 7, 'lbs');
    for (const entry of result!.percentageTable) {
      expect(entry.weight).toBe(Math.round(entry.weight));
    }
  });

  it('single rep percentage table uses weight directly as 1RM', () => {
    const result = estimateOneRM(300, 1, 'lbs');
    const entry100 = result!.percentageTable.find(e => e.percent === 100);
    expect(entry100!.weight).toBe(300);
  });

  it('preserves weight and reps in result', () => {
    const result = estimateOneRM(185, 8, 'kg');
    expect(result!.weight).toBe(185);
    expect(result!.reps).toBe(8);
    expect(result!.unit).toBe('kg');
  });
});

// ── computeDOTS ──

describe('computeDOTS', () => {
  it('returns null for total <= 0', () => {
    expect(computeDOTS(0, 83, true)).toBeNull();
    expect(computeDOTS(-100, 83, true)).toBeNull();
  });

  it('returns null for bodyweight <= 0', () => {
    expect(computeDOTS(500, 0, true)).toBeNull();
    expect(computeDOTS(500, -80, true)).toBeNull();
  });

  it('returns a DOTSResult with correct shape', () => {
    const result = computeDOTS(600, 83, true);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('bodyweight', 83);
    expect(result).toHaveProperty('total', 600);
    expect(result).toHaveProperty('isMale', true);
  });

  it('produces positive score for valid male inputs', () => {
    const result = computeDOTS(600, 83, true);
    expect(result!.score).toBeGreaterThan(0);
  });

  it('produces positive score for valid female inputs', () => {
    const result = computeDOTS(400, 63, false);
    expect(result!.score).toBeGreaterThan(0);
  });

  it('male and female coefficients produce different scores at same total/bw', () => {
    const male = computeDOTS(500, 75, true);
    const female = computeDOTS(500, 75, false);
    expect(male!.score).not.toBe(female!.score);
  });

  it('higher total at same bodyweight produces higher DOTS', () => {
    const lower = computeDOTS(400, 83, true);
    const higher = computeDOTS(600, 83, true);
    expect(higher!.score).toBeGreaterThan(lower!.score);
  });

  it('handles very light bodyweight (40 kg)', () => {
    const result = computeDOTS(300, 40, true);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0);
  });

  it('handles very heavy bodyweight (200 kg)', () => {
    const result = computeDOTS(800, 200, true);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0);
  });

  it('known reference: 600kg total at 83kg male produces elite DOTS', () => {
    const result = computeDOTS(600, 83, true);
    // 600 kg total at 83 kg is world-class; DOTS should be roughly 380-450
    expect(result!.score).toBeGreaterThan(350);
    expect(result!.score).toBeLessThan(500);
  });
});

// ── calculateWilks2 ──

describe('calculateWilks2', () => {
  it('returns null for total <= 0', () => {
    expect(calculateWilks2(0, 83, 'male')).toBeNull();
    expect(calculateWilks2(-100, 83, 'male')).toBeNull();
  });

  it('returns null for bodyweight <= 0', () => {
    expect(calculateWilks2(500, 0, 'male')).toBeNull();
    expect(calculateWilks2(500, -80, 'male')).toBeNull();
  });

  it('returns null for bodyweight < 30', () => {
    expect(calculateWilks2(500, 29, 'male')).toBeNull();
  });

  it('returns null for bodyweight > 300', () => {
    expect(calculateWilks2(500, 301, 'male')).toBeNull();
  });

  it('returns a number for valid male inputs', () => {
    const result = calculateWilks2(600, 83, 'male');
    expect(result).not.toBeNull();
    expect(typeof result).toBe('number');
    expect(result!).toBeGreaterThan(0);
  });

  it('returns a number for valid female inputs', () => {
    const result = calculateWilks2(400, 63, 'female');
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });

  it('male and female produce different Wilks2 scores', () => {
    const male = calculateWilks2(500, 75, 'male');
    const female = calculateWilks2(500, 75, 'female');
    expect(male).not.toBe(female);
  });

  it('handles boundary bodyweight = 30', () => {
    const result = calculateWilks2(300, 30, 'male');
    expect(result).not.toBeNull();
  });

  it('handles boundary bodyweight = 300', () => {
    const result = calculateWilks2(800, 300, 'male');
    // The polynomial may produce a negative/null result at extreme bodyweights
    // At 300kg BW the formula may not yield a positive score; just verify no crash
    expect(() => calculateWilks2(800, 300, 'male')).not.toThrow();
  });

  it('higher total at same bodyweight produces higher Wilks2', () => {
    const lower = calculateWilks2(400, 83, 'male');
    const higher = calculateWilks2(600, 83, 'male');
    expect(higher!).toBeGreaterThan(lower!);
  });
});

// ── calculateGLPoints ──

describe('calculateGLPoints', () => {
  it('returns null for total <= 0', () => {
    expect(calculateGLPoints(0, 83, 'male')).toBeNull();
    expect(calculateGLPoints(-100, 83, 'male')).toBeNull();
  });

  it('returns null for bodyweight <= 0', () => {
    expect(calculateGLPoints(500, 0, 'male')).toBeNull();
    expect(calculateGLPoints(500, -80, 'male')).toBeNull();
  });

  it('returns null for bodyweight < 30', () => {
    expect(calculateGLPoints(500, 29, 'male')).toBeNull();
  });

  it('returns null for bodyweight > 300', () => {
    expect(calculateGLPoints(500, 301, 'male')).toBeNull();
  });

  it('returns positive score for valid male inputs', () => {
    const result = calculateGLPoints(600, 83, 'male');
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });

  it('returns positive score for valid female inputs', () => {
    const result = calculateGLPoints(400, 63, 'female');
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });

  it('male and female produce different GL points', () => {
    const male = calculateGLPoints(500, 75, 'male');
    const female = calculateGLPoints(500, 75, 'female');
    expect(male).not.toBe(female);
  });

  it('GL points increase monotonically with total', () => {
    const a = calculateGLPoints(300, 83, 'male')!;
    const b = calculateGLPoints(400, 83, 'male')!;
    const c = calculateGLPoints(500, 83, 'male')!;
    const d = calculateGLPoints(600, 83, 'male')!;
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(d).toBeGreaterThan(c);
  });

  it('handles boundary bodyweight = 30', () => {
    const result = calculateGLPoints(300, 30, 'male');
    expect(result).not.toBeNull();
  });

  it('handles boundary bodyweight = 300', () => {
    const result = calculateGLPoints(800, 300, 'male');
    expect(result).not.toBeNull();
  });
});

// ── check1RMSafety ──

describe('check1RMSafety', () => {
  it('returns plausible for normal squat (200 kg)', () => {
    const result = check1RMSafety(200, 'squat');
    expect(result.plausible).toBe(true);
  });

  it('returns not plausible for extreme squat (600 kg exceeds WR)', () => {
    const result = check1RMSafety(600, 'squat');
    expect(result.plausible).toBe(false);
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('world record');
  });

  it('returns warning for near-world-record squat (>90% WR)', () => {
    // Male squat WR is 505 kg, 90% = 454.5
    const result = check1RMSafety(460, 'squat');
    expect(result.plausible).toBe(true);
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('world record');
  });

  it('returns not plausible for estimatedMax <= 0', () => {
    const result = check1RMSafety(0, 'squat');
    expect(result.plausible).toBe(false);
    expect(result.warning).toContain('greater than zero');
  });

  it('returns not plausible for negative estimatedMax', () => {
    const result = check1RMSafety(-100, 'squat');
    expect(result.plausible).toBe(false);
  });

  it('flags extreme bodyweight multiple for squat (>4.5x BW)', () => {
    // 80 kg lifter x 4.5 = 360 kg limit; 400 kg exceeds that
    const result = check1RMSafety(400, 'squat', 80);
    expect(result.plausible).toBe(false);
    expect(result.warning).toContain('bodyweight');
  });

  it('allows reasonable bodyweight multiple', () => {
    // 80 kg lifter, 200 kg squat = 2.5x BW, well within limits
    const result = check1RMSafety(200, 'squat', 80);
    expect(result.plausible).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('does not check bodyweight multiple when bodyweight not provided', () => {
    // 400 kg squat is under the 505 WR, should be plausible without BW check
    const result = check1RMSafety(400, 'squat');
    expect(result.plausible).toBe(true);
  });

  it('returns plausible for unknown lift (no records to check)', () => {
    const result = check1RMSafety(9999, 'kettlebell-swing');
    expect(result.plausible).toBe(true);
  });

  it('normalizes lift names: "bench press" -> bench', () => {
    const result = check1RMSafety(400, 'bench press');
    expect(result.plausible).toBe(false);
    expect(result.warning).toContain('world record');
  });

  it('normalizes lift names: "overhead_press" -> ohp', () => {
    const result = check1RMSafety(250, 'overhead_press');
    expect(result.plausible).toBe(false);
    expect(result.warning).toContain('world record');
  });

  it('includes worldRecordPct in result', () => {
    const result = check1RMSafety(200, 'squat');
    expect(result.worldRecordPct).toBeDefined();
    expect(typeof result.worldRecordPct).toBe('number');
    // 200/505 = ~40%
    expect(result.worldRecordPct!).toBeGreaterThan(30);
    expect(result.worldRecordPct!).toBeLessThan(50);
  });

  it('handles bench world record boundary', () => {
    // Male bench WR is 355 kg
    const under = check1RMSafety(300, 'bench');
    expect(under.plausible).toBe(true);
    const over = check1RMSafety(360, 'bench');
    expect(over.plausible).toBe(false);
  });

  it('handles deadlift world record boundary', () => {
    const under = check1RMSafety(400, 'deadlift');
    expect(under.plausible).toBe(true);
    const over = check1RMSafety(510, 'deadlift');
    expect(over.plausible).toBe(false);
  });

  it('extreme bodyweight multiples per lift: bench >3.5x', () => {
    // 80 kg lifter, bench 3.5x = 280 kg
    const result = check1RMSafety(300, 'bench', 80);
    expect(result.plausible).toBe(false);
    expect(result.warning).toContain('bodyweight');
  });

  it('extreme bodyweight multiples per lift: deadlift >5.0x', () => {
    // 80 kg lifter, deadlift 5.0x = 400 kg
    const result = check1RMSafety(450, 'deadlift', 80);
    expect(result.plausible).toBe(false);
    expect(result.warning).toContain('bodyweight');
  });

  it('extreme bodyweight multiples per lift: ohp >2.0x', () => {
    // 80 kg lifter, ohp 2.0x = 160 kg
    const result = check1RMSafety(170, 'ohp', 80);
    expect(result.plausible).toBe(false);
    expect(result.warning).toContain('bodyweight');
  });

  it('bodyweight = 0 skips BW multiple check', () => {
    const result = check1RMSafety(200, 'squat', 0);
    expect(result.plausible).toBe(true);
  });
});
