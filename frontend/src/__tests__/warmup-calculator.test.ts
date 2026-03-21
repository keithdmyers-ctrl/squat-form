import { describe, it, expect } from 'vitest';
import {
  generateWarmupPlan,
  describePlateLoading,
  renderWarmupPlan,
} from '../warmup-calculator';
import type { WarmupPlan } from '../warmup-calculator';

// ─── describePlateLoading ───

describe('describePlateLoading', () => {
  it('returns "empty bar" for bar weight', () => {
    expect(describePlateLoading(45, 'lbs')).toBe('empty bar');
    expect(describePlateLoading(20, 'kg')).toBe('empty bar');
  });

  it('returns "empty bar" for weight below bar', () => {
    expect(describePlateLoading(30, 'lbs')).toBe('empty bar');
    expect(describePlateLoading(10, 'kg')).toBe('empty bar');
  });

  it('describes simple loading in lbs', () => {
    // 135 lbs = 45 bar + 45 per side
    expect(describePlateLoading(135, 'lbs')).toBe('45 per side');
  });

  it('describes complex loading in lbs', () => {
    // 225 lbs = 45 bar + 90 per side = 45+45 per side
    expect(describePlateLoading(225, 'lbs')).toBe('45+45 per side');
  });

  it('describes loading in kg', () => {
    // 60 kg = 20 bar + 20 per side = 20 per side
    expect(describePlateLoading(60, 'kg')).toBe('20 per side');
  });

  it('handles custom bar weight', () => {
    // 65 lbs with 25 lb bar = 20 per side
    expect(describePlateLoading(65, 'lbs', 25)).toBe('10+10 per side');
  });

  it('handles mixed plates in lbs', () => {
    // 185 lbs = 45 bar + 70 per side = 45+25 per side
    expect(describePlateLoading(185, 'lbs')).toBe('45+25 per side');
  });

  it('handles mixed plates in kg', () => {
    // 100 kg = 20 bar + 40 per side = 25+15 per side
    expect(describePlateLoading(100, 'kg')).toBe('25+15 per side');
  });

  it('handles 2.5 lb plates', () => {
    // 50 lbs = 45 bar + 2.5 per side
    expect(describePlateLoading(50, 'lbs')).toBe('2.5 per side');
  });

  it('handles 315 lbs', () => {
    // 315 = 45 bar + 135 per side = 45+45+45 per side
    expect(describePlateLoading(315, 'lbs')).toBe('45+45+45 per side');
  });
});

// ─── generateWarmupPlan ───

describe('generateWarmupPlan', () => {
  it('returns 0 warm-up sets when working weight is the bar', () => {
    const plan = generateWarmupPlan(45, 'lbs');
    expect(plan.sets).toHaveLength(0);
    expect(plan.totalWarmupSets).toBe(0);
    expect(plan.estimatedTime).toBe(0);
  });

  it('returns 0 warm-up sets when working weight is below the bar', () => {
    const plan = generateWarmupPlan(30, 'lbs');
    expect(plan.sets).toHaveLength(0);
  });

  it('returns 0 warm-up sets for kg bar weight', () => {
    const plan = generateWarmupPlan(20, 'kg');
    expect(plan.sets).toHaveLength(0);
  });

  it('generates warm-up for 135 lbs', () => {
    const plan = generateWarmupPlan(135, 'lbs');
    // Should have bar set + intermediate sets
    expect(plan.sets.length).toBeGreaterThanOrEqual(2);
    expect(plan.sets[0].isBarOnly).toBe(true);
    expect(plan.sets[0].weight).toBe(45);
    expect(plan.sets[0].reps).toBe(5);

    // No warm-up set should be >= working weight
    for (const set of plan.sets) {
      expect(set.weight).toBeLessThan(135);
    }

    // 40% of 135 = 54, rounds to 55, should be included
    // 60% of 135 = 81, rounds to 80
    // 75% of 135 = 101.25, rounds to 100
    // 85% of 135 = 114.75, rounds to 115
    // Check that we skip 40% since working weight < 135 lbs threshold...
    // actually 135 lbs = 135, meets threshold exactly
    // But 40% of 135 = 54 -> rounds to 55, which is > bar so it should appear
  });

  it('generates warm-up for 315 lbs', () => {
    const plan = generateWarmupPlan(315, 'lbs');

    // Should include bar + several intermediate sets
    expect(plan.sets.length).toBeGreaterThanOrEqual(4);
    expect(plan.sets.length).toBeLessThanOrEqual(6);

    // First set is always the bar
    expect(plan.sets[0].weight).toBe(45);
    expect(plan.sets[0].isBarOnly).toBe(true);

    // Verify weights are ascending
    for (let i = 1; i < plan.sets.length; i++) {
      expect(plan.sets[i].weight).toBeGreaterThan(plan.sets[i - 1].weight);
    }

    // No set >= working weight
    for (const set of plan.sets) {
      expect(set.weight).toBeLessThan(315);
    }

    // Check specific expected weights:
    // 40% of 315 = 126 -> rounds to 125
    // 60% of 315 = 189 -> rounds to 190
    // 75% of 315 = 236.25 -> rounds to 235
    // 85% of 315 = 267.75 -> rounds to 270
    const weights = plan.sets.map(s => s.weight);
    expect(weights).toContain(45);  // bar
    expect(weights).toContain(125); // ~40%
    expect(weights).toContain(190); // ~60%
    expect(weights).toContain(235); // ~75%
    expect(weights).toContain(270); // ~85%
  });

  it('generates warm-up for 500 lbs with heavy single', () => {
    const plan = generateWarmupPlan(500, 'lbs', { includeHeavySingle: true });

    // Should include up to 6 sets with the 90% single
    expect(plan.sets.length).toBeGreaterThanOrEqual(5);
    expect(plan.sets.length).toBeLessThanOrEqual(6);

    // First set: bar
    expect(plan.sets[0].weight).toBe(45);

    // Last set should be ~90% = 450
    const lastSet = plan.sets[plan.sets.length - 1];
    expect(lastSet.weight).toBe(450);
    expect(lastSet.reps).toBe(1);

    // No set >= working weight
    for (const set of plan.sets) {
      expect(set.weight).toBeLessThan(500);
    }
  });

  it('handles kg weights correctly', () => {
    const plan = generateWarmupPlan(140, 'kg');

    expect(plan.unit).toBe('kg');
    expect(plan.sets[0].weight).toBe(20); // kg bar
    expect(plan.sets[0].isBarOnly).toBe(true);

    // All weights should be rounded to 2.5 kg increments
    for (const set of plan.sets) {
      expect(set.weight % 2.5).toBe(0);
    }

    // No set >= working weight
    for (const set of plan.sets) {
      expect(set.weight).toBeLessThan(140);
    }
  });

  it('no warm-up set equals or exceeds working weight', () => {
    // Test with a variety of working weights
    const weights = [50, 65, 95, 135, 185, 225, 275, 315, 405, 500];
    for (const w of weights) {
      const plan = generateWarmupPlan(w, 'lbs');
      for (const set of plan.sets) {
        expect(set.weight).toBeLessThan(w);
      }
    }
  });

  it('skips redundant sets that round to the same weight', () => {
    // 55 lbs: 40% = 22 -> rounds to 20, which is below bar (45)
    // 60% = 33 -> rounds to 35, which is below bar
    // 75% = 41.25 -> rounds to 40, below bar
    // 85% = 46.75 -> rounds to 45, which IS the bar (skip)
    // Should just have bar set + 50 lbs (if 85% rounds up to 50?)
    // Actually: 85% of 55 = 46.75 -> rounds to 45 = bar, skip
    // Only the bar set will be generated, but we need at least the bar
    const plan = generateWarmupPlan(55, 'lbs');
    expect(plan.sets.length).toBeGreaterThanOrEqual(1);

    // No duplicate weights
    const weights = plan.sets.map(s => s.weight);
    const uniqueWeights = new Set(weights);
    expect(uniqueWeights.size).toBe(weights.length);
  });

  it('includes plate descriptions for each set', () => {
    const plan = generateWarmupPlan(225, 'lbs');

    for (const set of plan.sets) {
      expect(typeof set.plates).toBe('string');
      expect(set.plates.length).toBeGreaterThan(0);
    }

    // Bar set should say "empty bar"
    expect(plan.sets[0].plates).toBe('empty bar');
  });

  it('assigns correct rest periods', () => {
    const plan = generateWarmupPlan(315, 'lbs');

    // Bar set: 30s rest
    expect(plan.sets[0].rest).toBe(30);

    // Heavier sets should have longer rest
    const lastSet = plan.sets[plan.sets.length - 1];
    expect(lastSet.rest).toBeGreaterThanOrEqual(90);
  });

  it('includes percentage of working weight', () => {
    const plan = generateWarmupPlan(200, 'lbs');

    for (const set of plan.sets) {
      expect(set.percentage).toBeGreaterThan(0);
      expect(set.percentage).toBeLessThanOrEqual(100);
    }
  });

  it('sets are numbered sequentially', () => {
    const plan = generateWarmupPlan(300, 'lbs');

    for (let i = 0; i < plan.sets.length; i++) {
      expect(plan.sets[i].setNumber).toBe(i + 1);
    }
  });

  it('provides estimated time in minutes', () => {
    const plan = generateWarmupPlan(315, 'lbs');
    expect(plan.estimatedTime).toBeGreaterThanOrEqual(1);
  });

  it('respects custom bar weight', () => {
    const plan = generateWarmupPlan(100, 'lbs', { barWeight: 25 });
    expect(plan.sets[0].weight).toBe(25);
    expect(plan.sets[0].isBarOnly).toBe(true);
  });

  it('heavy single option adds a 90% set', () => {
    const planWithout = generateWarmupPlan(400, 'lbs', { includeHeavySingle: false });
    const planWith = generateWarmupPlan(400, 'lbs', { includeHeavySingle: true });

    expect(planWith.sets.length).toBeGreaterThanOrEqual(planWithout.sets.length);

    // The plan with heavy single should have a ~90% weight
    const heavyWeights = planWith.sets.map(s => s.weight);
    const ninetyPct = Math.round(400 * 0.9 / 5) * 5; // 360
    expect(heavyWeights).toContain(ninetyPct);
  });

  it('enforces maximum of 6 warmup sets', () => {
    const plan = generateWarmupPlan(600, 'lbs', { includeHeavySingle: true });
    expect(plan.sets.length).toBeLessThanOrEqual(6);
  });

  it('weights are always in ascending order', () => {
    const testWeights = [100, 135, 200, 315, 405, 500];
    for (const w of testWeights) {
      const plan = generateWarmupPlan(w, 'lbs');
      for (let i = 1; i < plan.sets.length; i++) {
        expect(plan.sets[i].weight).toBeGreaterThan(plan.sets[i - 1].weight);
      }
    }
  });
});

// ─── renderWarmupPlan ───

describe('renderWarmupPlan', () => {
  it('renders empty plan message', () => {
    const plan: WarmupPlan = {
      workingWeight: 45,
      unit: 'lbs',
      sets: [],
      totalWarmupSets: 0,
      estimatedTime: 0,
    };
    const html = renderWarmupPlan(plan);
    expect(html).toContain('No warm-up needed');
    expect(html).toContain('warmup-card');
  });

  it('renders plan with sets', () => {
    const plan = generateWarmupPlan(225, 'lbs');
    const html = renderWarmupPlan(plan);

    expect(html).toContain('Warm-Up Ramp');
    expect(html).toContain('warmup-table');
    expect(html).toContain('warmup-card');
    // Should contain set count info
    expect(html).toContain(`${plan.totalWarmupSets} sets`);
    // Should contain weight values
    expect(html).toContain('45 lbs (bar)');
  });

  it('includes plate loading info', () => {
    const plan = generateWarmupPlan(315, 'lbs');
    const html = renderWarmupPlan(plan);

    expect(html).toContain('empty bar');
    expect(html).toContain('per side');
  });
});
