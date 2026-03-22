import { describe, it, expect } from 'vitest';
import { calculatePlates, formatPlateResult, type PlateResult } from '../plate-calculator';

describe('Plate Calculator', () => {
  describe('calculatePlates (lbs)', () => {
    it('calculates 135 lbs (one 45 per side)', () => {
      const result = calculatePlates(135, 'lbs');
      expect(result.barWeight).toBe(45);
      expect(result.perSide).toEqual([{ plate: 45, count: 1 }]);
      expect(result.totalLoaded).toBe(135);
      expect(result.achievable).toBe(true);
    });

    it('calculates 225 lbs (two 45s per side)', () => {
      const result = calculatePlates(225, 'lbs');
      expect(result.perSide).toEqual([{ plate: 45, count: 2 }]);
      expect(result.totalLoaded).toBe(225);
      expect(result.achievable).toBe(true);
    });

    it('calculates 315 lbs (three 45s per side)', () => {
      const result = calculatePlates(315, 'lbs');
      expect(result.perSide).toEqual([{ plate: 45, count: 3 }]);
      expect(result.totalLoaded).toBe(315);
      expect(result.achievable).toBe(true);
    });

    it('calculates 185 lbs (45+25+5 per side via greedy)', () => {
      const result = calculatePlates(185, 'lbs');
      // Per side: (185-45)/2 = 70 → 45+25=70
      expect(result.perSide).toEqual([
        { plate: 45, count: 1 },
        { plate: 25, count: 1 },
      ]);
      expect(result.totalLoaded).toBe(185);
      expect(result.achievable).toBe(true);
    });

    it('calculates 145 lbs (45+5+2.5 per side)', () => {
      const result = calculatePlates(145, 'lbs');
      // Per side: (145-45)/2 = 50 → 45+5=50
      expect(result.perSide).toEqual([
        { plate: 45, count: 1 },
        { plate: 5, count: 1 },
      ]);
      expect(result.totalLoaded).toBe(145);
      expect(result.achievable).toBe(true);
    });

    it('calculates 50 lbs (2.5 per side)', () => {
      const result = calculatePlates(50, 'lbs');
      // Per side: (50-45)/2 = 2.5
      expect(result.perSide).toEqual([{ plate: 2.5, count: 1 }]);
      expect(result.totalLoaded).toBe(50);
      expect(result.achievable).toBe(true);
    });

    it('returns empty bar for 45 lbs (bar weight)', () => {
      const result = calculatePlates(45, 'lbs');
      expect(result.perSide).toEqual([]);
      expect(result.totalLoaded).toBe(45);
      expect(result.achievable).toBe(true);
    });

    it('returns empty plates for 0 lbs (below bar weight)', () => {
      const result = calculatePlates(0, 'lbs');
      expect(result.perSide).toEqual([]);
      expect(result.totalLoaded).toBe(45);
      expect(result.achievable).toBe(false);
      expect(result.closestWeight).toBe(45);
    });

    it('handles weight below bar weight', () => {
      const result = calculatePlates(30, 'lbs');
      expect(result.perSide).toEqual([]);
      expect(result.achievable).toBe(false);
    });

    it('handles odd weight that does not divide evenly', () => {
      const result = calculatePlates(151, 'lbs');
      // Per side: (151-45)/2 = 53 → 45+5+2.5=52.5 (closest)
      expect(result.achievable).toBe(false);
      expect(result.closestWeight).toBe(150); // 45 + 52.5*2
    });

    it('calculates 405 lbs (four 45s per side)', () => {
      const result = calculatePlates(405, 'lbs');
      expect(result.perSide).toEqual([{ plate: 45, count: 4 }]);
      expect(result.totalLoaded).toBe(405);
      expect(result.achievable).toBe(true);
    });

    it('calculates very heavy weight (585 lbs)', () => {
      const result = calculatePlates(585, 'lbs');
      // Per side: (585-45)/2 = 270 → 45*6=270
      expect(result.perSide).toEqual([{ plate: 45, count: 6 }]);
      expect(result.totalLoaded).toBe(585);
      expect(result.achievable).toBe(true);
    });

    it('handles negative weight gracefully', () => {
      const result = calculatePlates(-50, 'lbs');
      expect(result.perSide).toEqual([]);
      expect(result.achievable).toBe(false);
    });

    it('handles weight exactly equal to bar weight', () => {
      const result = calculatePlates(45, 'lbs');
      expect(result.targetWeight).toBe(45);
      expect(result.achievable).toBe(true);
      expect(result.closestWeight).toBe(45);
    });

    it('uses default lbs unit when not specified', () => {
      const result = calculatePlates(135);
      expect(result.barWeight).toBe(45);
      expect(result.unit).toBe('lbs');
    });

    it('calculates with custom bar weight (35 lbs womens bar)', () => {
      const result = calculatePlates(125, 'lbs', 35);
      // Per side: (125-35)/2 = 45
      expect(result.barWeight).toBe(35);
      expect(result.perSide).toEqual([{ plate: 45, count: 1 }]);
      expect(result.totalLoaded).toBe(125);
      expect(result.achievable).toBe(true);
    });

    it('calculates with custom bar weight (15 lbs training bar)', () => {
      const result = calculatePlates(60, 'lbs', 15);
      // Per side: (60-15)/2 = 22.5 → 10+10+2.5=22.5
      expect(result.barWeight).toBe(15);
      expect(result.perSide).toEqual([
        { plate: 10, count: 2 },
        { plate: 2.5, count: 1 },
      ]);
      expect(result.totalLoaded).toBe(60);
      expect(result.achievable).toBe(true);
    });

    it('returns complete PlateResult shape', () => {
      const result = calculatePlates(225, 'lbs');
      expect(result).toHaveProperty('targetWeight', 225);
      expect(result).toHaveProperty('barWeight', 45);
      expect(result).toHaveProperty('perSide');
      expect(result).toHaveProperty('totalLoaded');
      expect(result).toHaveProperty('unit', 'lbs');
      expect(result).toHaveProperty('achievable');
      expect(result).toHaveProperty('closestWeight');
    });

    it('calculates 500 lbs (mixed plates)', () => {
      const result = calculatePlates(500, 'lbs');
      // Per side: (500-45)/2 = 227.5 → 45*5=225 + 2.5 = 227.5
      expect(result.perSide).toEqual([
        { plate: 45, count: 5 },
        { plate: 2.5, count: 1 },
      ]);
      expect(result.totalLoaded).toBe(500);
      expect(result.achievable).toBe(true);
    });
  });

  describe('calculatePlates (kg)', () => {
    it('calculates 60 kg (20 per side)', () => {
      const result = calculatePlates(60, 'kg');
      expect(result.barWeight).toBe(20);
      expect(result.perSide).toEqual([{ plate: 20, count: 1 }]);
      expect(result.totalLoaded).toBe(60);
      expect(result.achievable).toBe(true);
    });

    it('calculates 100 kg (greedy: 25+15 per side)', () => {
      const result = calculatePlates(100, 'kg');
      // Per side: (100-20)/2 = 40 -> greedy with kg plates [25,20,15,10,5,2.5,1.25]: 25+15=40
      expect(result.perSide).toEqual([
        { plate: 25, count: 1 },
        { plate: 15, count: 1 },
      ]);
      expect(result.totalLoaded).toBe(100);
      expect(result.achievable).toBe(true);
    });

    it('calculates 62.5 kg (20+1.25 per side)', () => {
      const result = calculatePlates(62.5, 'kg');
      // Per side: (62.5-20)/2 = 21.25 → 20+1.25=21.25
      expect(result.perSide).toEqual([
        { plate: 20, count: 1 },
        { plate: 1.25, count: 1 },
      ]);
      expect(result.totalLoaded).toBe(62.5);
      expect(result.achievable).toBe(true);
    });

    it('returns empty bar for 20 kg', () => {
      const result = calculatePlates(20, 'kg');
      expect(result.perSide).toEqual([]);
      expect(result.achievable).toBe(true);
    });

    it('uses 20 kg bar by default for kg', () => {
      const result = calculatePlates(20, 'kg');
      expect(result.barWeight).toBe(20);
    });

    it('handles kg fractional plates', () => {
      const result = calculatePlates(22.5, 'kg');
      // Per side: (22.5-20)/2 = 1.25
      expect(result.perSide).toEqual([{ plate: 1.25, count: 1 }]);
      expect(result.achievable).toBe(true);
    });

    it('calculates 140 kg (25+20+15 per side)', () => {
      const result = calculatePlates(140, 'kg');
      // Per side: (140-20)/2 = 60 → 25*2=50 + 10=60
      expect(result.perSide).toEqual([
        { plate: 25, count: 2 },
        { plate: 10, count: 1 },
      ]);
      expect(result.totalLoaded).toBe(140);
      expect(result.achievable).toBe(true);
    });
  });

  describe('formatPlateResult', () => {
    it('formats empty bar', () => {
      const result = calculatePlates(45, 'lbs');
      const text = formatPlateResult(result);
      expect(text).toContain('Empty bar');
      expect(text).toContain('45');
    });

    it('formats single plate type', () => {
      const result = calculatePlates(135, 'lbs');
      const text = formatPlateResult(result);
      expect(text).toContain('Each side');
      expect(text).toContain('45');
    });

    it('formats multiple plate types with +', () => {
      const result = calculatePlates(185, 'lbs');
      const text = formatPlateResult(result);
      expect(text).toContain('+');
    });

    it('shows per-side total', () => {
      const result = calculatePlates(225, 'lbs');
      const text = formatPlateResult(result);
      expect(text).toContain('90');
      expect(text).toContain('lbs/side');
    });

    it('shows closest weight for non-achievable weights', () => {
      const result = calculatePlates(151, 'lbs');
      const text = formatPlateResult(result);
      expect(text).toContain('closest');
    });

    it('does not show closest for achievable weights', () => {
      const result = calculatePlates(135, 'lbs');
      const text = formatPlateResult(result);
      expect(text).not.toContain('closest');
    });

    it('uses multiplication symbol for multiple identical plates', () => {
      const result = calculatePlates(225, 'lbs');
      const text = formatPlateResult(result);
      // Two 45s per side → "45x2"
      expect(text).toMatch(/45/);
    });

    it('formats kg results', () => {
      const result = calculatePlates(60, 'kg');
      const text = formatPlateResult(result);
      expect(text).toContain('kg');
    });
  });
});
