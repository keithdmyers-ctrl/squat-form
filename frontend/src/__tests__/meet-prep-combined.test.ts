import { describe, it, expect } from 'vitest';
import {
  getMeetDayFactor,
  generateAttemptPlan,
} from '../meet-prep';
import type { MeetDayStrategy, AttemptPlan } from '../meet-prep';
import { generateMeetPrepPlan } from '../meet-prep-plan';
import type { MeetPrepPlan } from '../meet-prep-plan';
import type { SessionRecord } from '../types';

// ─── Helpers ───

function makeSessions(count: number): SessionRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `session-${i}`,
    date: new Date(Date.now() - i * 86400000).toISOString(),
    squat_type: 'high_bar',
    experience_level: 'intermediate',
    rep_count: 5,
    overall_score: 80,
    grade: 'B',
    top_issue: null,
    positive_count: 2,
    exercise_type: 'squat',
  }));
}

// ══════════════════════════════════════════════════════════════
//  getMeetDayFactor
// ══════════════════════════════════════════════════════════════

describe('getMeetDayFactor', () => {
  it('conservative returns 1.0', () => {
    expect(getMeetDayFactor('conservative')).toBe(1.0);
  });

  it('moderate returns 1.03', () => {
    expect(getMeetDayFactor('moderate')).toBe(1.03);
  });

  it('aggressive returns 1.05', () => {
    expect(getMeetDayFactor('aggressive')).toBe(1.05);
  });
});

// ══════════════════════════════════════════════════════════════
//  generateAttemptPlan — standard plans
// ══════════════════════════════════════════════════════════════

describe('generateAttemptPlan', () => {
  describe('standard plan generation', () => {
    it('generates a plan with opener ~87%, second ~93%, third ~100%', () => {
      const plan = generateAttemptPlan(makeSessions(6), 400, 'lbs', 'conservative');
      expect(plan).not.toBeNull();
      // 400 * 0.87 = 348 -> rounds to 350 (nearest 5)
      expect(plan!.opener).toBe(350);
      // 400 * 0.93 = 372 -> rounds to 370
      expect(plan!.second).toBe(370);
      // 400 * 1.0 = 400
      expect(plan!.third).toBe(400);
    });

    it('opener < second < third (always ascending)', () => {
      const plan = generateAttemptPlan(makeSessions(3), 300, 'lbs', 'moderate');
      expect(plan).not.toBeNull();
      expect(plan!.opener).toBeLessThan(plan!.second);
      expect(plan!.second).toBeLessThan(plan!.third);
    });

    it('all attempts rounded to 5 lbs increments', () => {
      const plan = generateAttemptPlan(makeSessions(3), 317, 'lbs');
      expect(plan).not.toBeNull();
      expect(plan!.opener % 5).toBe(0);
      expect(plan!.second % 5).toBe(0);
      expect(plan!.third % 5).toBe(0);
    });

    it('all attempts rounded to 2.5 kg increments', () => {
      const plan = generateAttemptPlan(makeSessions(3), 180, 'kg');
      expect(plan).not.toBeNull();
      expect(plan!.opener % 2.5).toBe(0);
      expect(plan!.second % 2.5).toBe(0);
      expect(plan!.third % 2.5).toBe(0);
    });
  });

  describe('1RM edge cases', () => {
    it('1RM = 0 returns null', () => {
      expect(generateAttemptPlan(makeSessions(3), 0, 'lbs')).toBeNull();
    });

    it('negative 1RM returns null', () => {
      expect(generateAttemptPlan(makeSessions(3), -100, 'lbs')).toBeNull();
    });

    it('1RM = NaN returns null', () => {
      expect(generateAttemptPlan(makeSessions(3), NaN, 'lbs')).toBeNull();
    });

    it('1RM = Infinity returns null', () => {
      expect(generateAttemptPlan(makeSessions(3), Infinity, 'lbs')).toBeNull();
    });

    it('very light 1RM (100 lbs) produces a valid ascending plan', () => {
      const plan = generateAttemptPlan(makeSessions(3), 100, 'lbs', 'moderate');
      expect(plan).not.toBeNull();
      expect(plan!.opener).toBeGreaterThan(0);
      expect(plan!.opener).toBeLessThan(plan!.second);
      expect(plan!.second).toBeLessThan(plan!.third);
      expect(plan!.opener % 5).toBe(0);
    });

    it('very heavy 1RM (800 lbs) produces a valid ascending plan', () => {
      const plan = generateAttemptPlan(makeSessions(3), 800, 'lbs', 'moderate');
      expect(plan).not.toBeNull();
      expect(plan!.opener).toBeLessThan(plan!.second);
      expect(plan!.second).toBeLessThan(plan!.third);
      // 800 * 0.87 = 696 -> 695
      expect(plan!.opener).toBe(695);
    });
  });

  describe('unit handling', () => {
    it('lbs rounds to nearest 5', () => {
      const plan = generateAttemptPlan(makeSessions(3), 227, 'lbs');
      expect(plan).not.toBeNull();
      expect(plan!.opener % 5).toBe(0);
      expect(plan!.second % 5).toBe(0);
      expect(plan!.third % 5).toBe(0);
    });

    it('kg rounds to nearest 2.5', () => {
      const plan = generateAttemptPlan(makeSessions(3), 103, 'kg');
      expect(plan).not.toBeNull();
      expect(plan!.opener % 2.5).toBe(0);
      expect(plan!.second % 2.5).toBe(0);
      expect(plan!.third % 2.5).toBe(0);
    });

    it('same 1RM yields different weights for lbs vs kg due to rounding', () => {
      // Use a 1RM where rounding actually differs between lbs (5) and kg (2.5)
      // 100 * 0.93 = 93 -> lbs: round(93/5)*5 = 95, kg: round(93/2.5)*2.5 = 92.5
      const lbsPlan = generateAttemptPlan(makeSessions(3), 100, 'lbs', 'conservative');
      const kgPlan = generateAttemptPlan(makeSessions(3), 100, 'kg', 'conservative');
      expect(lbsPlan).not.toBeNull();
      expect(kgPlan).not.toBeNull();
      expect(lbsPlan!.second).toBe(95);
      expect(kgPlan!.second).toBe(92.5);
    });
  });

  describe('meet-day strategy applied to third attempt', () => {
    it('conservative: third = 100% of 1RM', () => {
      const plan = generateAttemptPlan(makeSessions(3), 400, 'lbs', 'conservative');
      expect(plan).not.toBeNull();
      // 400 * 1.0 = 400
      expect(plan!.third).toBe(400);
      expect(plan!.meetDayFactor).toBe(1.0);
    });

    it('moderate: third = 103% of 1RM', () => {
      const plan = generateAttemptPlan(makeSessions(3), 400, 'lbs', 'moderate');
      expect(plan).not.toBeNull();
      // 400 * 1.03 = 412 -> 410
      expect(plan!.third).toBe(410);
      expect(plan!.meetDayFactor).toBe(1.03);
    });

    it('aggressive: third = 105% of 1RM', () => {
      const plan = generateAttemptPlan(makeSessions(3), 400, 'lbs', 'aggressive');
      expect(plan).not.toBeNull();
      // 400 * 1.05 = 420
      expect(plan!.third).toBe(420);
      expect(plan!.meetDayFactor).toBe(1.05);
    });

    it('opener and second are the same regardless of strategy', () => {
      const conservative = generateAttemptPlan(makeSessions(3), 400, 'lbs', 'conservative');
      const moderate = generateAttemptPlan(makeSessions(3), 400, 'lbs', 'moderate');
      const aggressive = generateAttemptPlan(makeSessions(3), 400, 'lbs', 'aggressive');
      expect(conservative!.opener).toBe(moderate!.opener);
      expect(moderate!.opener).toBe(aggressive!.opener);
      expect(conservative!.second).toBe(moderate!.second);
      expect(moderate!.second).toBe(aggressive!.second);
    });

    it('default strategy is moderate', () => {
      const plan = generateAttemptPlan(makeSessions(3), 400, 'lbs');
      expect(plan!.meetDayStrategy).toBe('moderate');
      expect(plan!.meetDayFactor).toBe(1.03);
    });
  });

  describe('confidence levels', () => {
    it('6+ sessions -> high confidence', () => {
      const plan = generateAttemptPlan(makeSessions(6), 300, 'lbs');
      expect(plan!.confidence).toBe('high');
    });

    it('3-5 sessions -> moderate confidence', () => {
      expect(generateAttemptPlan(makeSessions(3), 300, 'lbs')!.confidence).toBe('moderate');
      expect(generateAttemptPlan(makeSessions(5), 300, 'lbs')!.confidence).toBe('moderate');
    });

    it('0-2 sessions -> low confidence', () => {
      expect(generateAttemptPlan(makeSessions(0), 300, 'lbs')!.confidence).toBe('low');
      expect(generateAttemptPlan(makeSessions(2), 300, 'lbs')!.confidence).toBe('low');
    });
  });

  describe('RPE labels', () => {
    it('includes correct RPE labels for all three attempts', () => {
      const plan = generateAttemptPlan(makeSessions(3), 300, 'lbs');
      expect(plan!.openerRPE).toBe('~7');
      expect(plan!.secondRPE).toBe('~8.5-9');
      expect(plan!.thirdRPE).toBe('~9.5-10');
    });
  });

  describe('rationale', () => {
    it('includes estimated 1RM in rationale', () => {
      const plan = generateAttemptPlan(makeSessions(3), 400, 'lbs');
      expect(plan!.rationale).toContain('400');
    });

    it('includes session count in rationale', () => {
      const plan = generateAttemptPlan(makeSessions(7), 400, 'lbs');
      expect(plan!.rationale).toContain('7 recent training sessions');
    });

    it('single session uses singular form', () => {
      const plan = generateAttemptPlan(makeSessions(1), 400, 'lbs');
      expect(plan!.rationale).toContain('1 recent training session.');
      // The phrase "1 recent training session" should NOT be followed by 's'
      expect(plan!.rationale).not.toContain('1 recent training sessions');
    });

    it('conservative strategy mentions no adrenaline boost', () => {
      const plan = generateAttemptPlan(makeSessions(3), 400, 'lbs', 'conservative');
      expect(plan!.rationale).toContain('conservative');
      expect(plan!.rationale).toContain('no adrenaline boost');
    });

    it('moderate strategy mentions adrenaline factor', () => {
      const plan = generateAttemptPlan(makeSessions(3), 400, 'lbs', 'moderate');
      expect(plan!.rationale).toContain('moderate');
      expect(plan!.rationale).toContain('+3%');
    });

    it('aggressive strategy mentions 5% boost', () => {
      const plan = generateAttemptPlan(makeSessions(3), 400, 'lbs', 'aggressive');
      expect(plan!.rationale).toContain('aggressive');
      expect(plan!.rationale).toContain('+5%');
    });

    it('low confidence rationale warns about limited data', () => {
      const plan = generateAttemptPlan(makeSessions(1), 400, 'lbs');
      expect(plan!.rationale).toContain('Confidence is low');
      expect(plan!.rationale).toContain('limited training data');
    });

    it('high confidence rationale encourages trust', () => {
      const plan = generateAttemptPlan(makeSessions(10), 400, 'lbs');
      expect(plan!.rationale).toContain('Confidence is high');
      expect(plan!.rationale).toContain('Trust the process');
    });
  });
});

// ══════════════════════════════════════════════════════════════
//  generateMeetPrepPlan
// ══════════════════════════════════════════════════════════════

describe('generateMeetPrepPlan', () => {
  const CURRENT_DATE = '2026-03-01';

  describe('standard plans', () => {
    it('8 weeks out produces 8 weeks including meet week', () => {
      const meetDate = '2026-04-26'; // ~8 weeks from March 1
      const plan = generateMeetPrepPlan(meetDate, 400, 'lbs', CURRENT_DATE);
      expect(plan.weeksOut).toBe(8);
      expect(plan.weeks).toHaveLength(8);
    });

    it('4 weeks out produces a 4-week taper plan', () => {
      const meetDate = '2026-03-29'; // ~4 weeks from March 1
      const plan = generateMeetPrepPlan(meetDate, 400, 'lbs', CURRENT_DATE);
      expect(plan.weeksOut).toBe(4);
      expect(plan.weeks).toHaveLength(4);
    });

    it('16 weeks out produces full plan with strength + taper', () => {
      const meetDate = '2026-06-21'; // ~16 weeks from March 1
      const plan = generateMeetPrepPlan(meetDate, 400, 'lbs', CURRENT_DATE);
      expect(plan.weeksOut).toBe(16);
      expect(plan.weeks).toHaveLength(16);
    });

    it('weeks are in chronological order (earliest first)', () => {
      const meetDate = '2026-04-26';
      const plan = generateMeetPrepPlan(meetDate, 400, 'lbs', CURRENT_DATE);
      // weekNumber should be descending in the reversed array (farthest from meet first)
      // The first week has the highest weekNumber (farthest from meet)
      for (let i = 0; i < plan.weeks.length - 1; i++) {
        expect(plan.weeks[i].weekNumber).toBeGreaterThan(plan.weeks[i + 1].weekNumber);
      }
    });
  });

  describe('taper structure', () => {
    it('meet week (week 1) is opener only at 87% of projected meet max', () => {
      const plan = generateMeetPrepPlan('2026-03-29', 400, 'lbs', CURRENT_DATE, 'conservative');
      const meetWeek = plan.weeks.find(w => w.weekNumber === 1);
      expect(meetWeek).toBeDefined();
      expect(meetWeek!.label).toContain('Meet week');
      expect(meetWeek!.sets).toBe(1);
      expect(meetWeek!.reps).toBe('1');
      expect(meetWeek!.intensityPct).toBe(87);
    });

    it('taper weeks have increasing intensity closer to meet', () => {
      const plan = generateMeetPrepPlan('2026-03-29', 400, 'lbs', CURRENT_DATE);
      // weekNumber counts backwards from meet: week 2 is closest to meet, week 4 farthest
      // w=2 -> taperIdx=0 -> Heavy singles 93%
      // w=3 -> taperIdx=1 -> Heavy doubles 90%
      // w=4 -> taperIdx=2 -> Moderate triples 85%
      const week4 = plan.weeks.find(w => w.weekNumber === 4);
      const week3 = plan.weeks.find(w => w.weekNumber === 3);
      const week2 = plan.weeks.find(w => w.weekNumber === 2);
      expect(week4!.intensityPct).toBe(85);
      expect(week3!.intensityPct).toBe(90);
      expect(week2!.intensityPct).toBe(93);
    });

    it('volume decreases across taper weeks (sets decrease closer to meet)', () => {
      const plan = generateMeetPrepPlan('2026-03-29', 400, 'lbs', CURRENT_DATE);
      const week4 = plan.weeks.find(w => w.weekNumber === 4);
      const week3 = plan.weeks.find(w => w.weekNumber === 3);
      const week2 = plan.weeks.find(w => w.weekNumber === 2);
      const week1 = plan.weeks.find(w => w.weekNumber === 1);
      // week4: 4 sets, week3: 4 sets, week2: 3 sets, week1: 1 set (meet-week opener)
      expect(week4!.sets).toBeGreaterThanOrEqual(week3!.sets);
      expect(week3!.sets).toBeGreaterThanOrEqual(week2!.sets);
      expect(week2!.sets).toBeGreaterThan(week1!.sets);
    });
  });

  describe('strength phase (beyond 4 weeks)', () => {
    it('weeks beyond 4 are strength phase at 80%', () => {
      const plan = generateMeetPrepPlan('2026-04-26', 400, 'lbs', CURRENT_DATE);
      const strengthWeeks = plan.weeks.filter(w => w.weekNumber > 4);
      expect(strengthWeeks.length).toBeGreaterThan(0);
      for (const w of strengthWeeks) {
        expect(w.intensityPct).toBe(80);
        expect(w.sets).toBe(4);
        expect(w.reps).toBe('4-5');
        expect(w.label).toContain('Strength phase');
      }
    });
  });

  describe('weight rounding', () => {
    it('all week weights rounded to 5 lbs increments', () => {
      const plan = generateMeetPrepPlan('2026-04-26', 317, 'lbs', CURRENT_DATE);
      for (const w of plan.weeks) {
        if (w.weight !== undefined) {
          expect(w.weight % 5).toBe(0);
        }
      }
    });

    it('all week weights rounded to 2.5 kg increments', () => {
      const plan = generateMeetPrepPlan('2026-04-26', 143, 'kg', CURRENT_DATE);
      for (const w of plan.weeks) {
        if (w.weight !== undefined) {
          expect(w.weight % 2.5).toBe(0);
        }
      }
    });
  });

  describe('meet-day strategy effects', () => {
    it('conservative projected meet max equals gym 1RM', () => {
      const plan = generateMeetPrepPlan('2026-03-29', 400, 'lbs', CURRENT_DATE, 'conservative');
      expect(plan.projectedMeetMax).toBe(400);
      expect(plan.meetDayFactor).toBe(1.0);
    });

    it('moderate projected meet max is 3% above gym 1RM', () => {
      const plan = generateMeetPrepPlan('2026-03-29', 400, 'lbs', CURRENT_DATE, 'moderate');
      expect(plan.projectedMeetMax).toBe(412);
      expect(plan.meetDayFactor).toBe(1.03);
    });

    it('aggressive projected meet max is 5% above gym 1RM', () => {
      const plan = generateMeetPrepPlan('2026-03-29', 400, 'lbs', CURRENT_DATE, 'aggressive');
      expect(plan.projectedMeetMax).toBe(420);
      expect(plan.meetDayFactor).toBe(1.05);
    });

    it('meet-week opener weight is based on projected meet max', () => {
      const conserv = generateMeetPrepPlan('2026-03-29', 400, 'lbs', CURRENT_DATE, 'conservative');
      const aggress = generateMeetPrepPlan('2026-03-29', 400, 'lbs', CURRENT_DATE, 'aggressive');
      const conservMeetWeek = conserv.weeks.find(w => w.weekNumber === 1);
      const aggressMeetWeek = aggress.weeks.find(w => w.weekNumber === 1);
      // Aggressive opener should be higher because projected meet max is higher
      expect(aggressMeetWeek!.weight).toBeGreaterThan(conservMeetWeek!.weight!);
    });

    it('taper weeks (2-4) use gym 1RM, not projected meet max', () => {
      const conserv = generateMeetPrepPlan('2026-03-29', 400, 'lbs', CURRENT_DATE, 'conservative');
      const aggress = generateMeetPrepPlan('2026-03-29', 400, 'lbs', CURRENT_DATE, 'aggressive');
      // Taper weeks should be the same regardless of strategy
      for (let wn = 2; wn <= 4; wn++) {
        const cw = conserv.weeks.find(w => w.weekNumber === wn);
        const aw = aggress.weeks.find(w => w.weekNumber === wn);
        expect(cw!.weight).toBe(aw!.weight);
      }
    });

    it('default strategy is moderate', () => {
      const plan = generateMeetPrepPlan('2026-03-29', 400, 'lbs', CURRENT_DATE);
      expect(plan.meetDayStrategy).toBe('moderate');
    });
  });

  describe('edge cases', () => {
    it('meet date tomorrow -> weeksOut = 1', () => {
      const tomorrow = '2026-03-02';
      const plan = generateMeetPrepPlan(tomorrow, 400, 'lbs', CURRENT_DATE);
      expect(plan.weeksOut).toBe(1);
      expect(plan.weeks).toHaveLength(1);
      expect(plan.weeks[0].label).toContain('Meet week');
    });

    it('meet date today -> weeksOut = 1 (clamped by Math.max)', () => {
      const plan = generateMeetPrepPlan(CURRENT_DATE, 400, 'lbs', CURRENT_DATE);
      // diffMs is 0 or negative -> Math.ceil(0) = 0 -> Math.max(1, 0) = 1
      expect(plan.weeksOut).toBe(1);
      expect(plan.weeks).toHaveLength(1);
    });

    it('meet date in the past -> weeksOut = 1 (clamped)', () => {
      const plan = generateMeetPrepPlan('2026-01-01', 400, 'lbs', CURRENT_DATE);
      // diffMs is negative -> Math.ceil(negative) -> negative -> Math.max(1, negative) = 1
      expect(plan.weeksOut).toBe(1);
      expect(plan.weeks).toHaveLength(1);
    });

    it('very far future (52 weeks) generates a full plan', () => {
      const plan = generateMeetPrepPlan('2027-02-28', 400, 'lbs', CURRENT_DATE);
      expect(plan.weeksOut).toBe(52);
      expect(plan.weeks).toHaveLength(52);
      // First 48 weeks should be strength phase, last 4 taper
      const strengthWeeks = plan.weeks.filter(w => w.weekNumber > 4);
      expect(strengthWeeks).toHaveLength(48);
    });

    it('plan preserves meetDate in result', () => {
      const plan = generateMeetPrepPlan('2026-04-26', 400, 'lbs', CURRENT_DATE);
      expect(plan.meetDate).toBe('2026-04-26');
    });

    it('very light 1RM produces valid weights', () => {
      const plan = generateMeetPrepPlan('2026-03-29', 50, 'lbs', CURRENT_DATE);
      for (const w of plan.weeks) {
        if (w.weight !== undefined) {
          expect(w.weight).toBeGreaterThanOrEqual(0);
          expect(w.weight % 5).toBe(0);
        }
      }
    });

    it('1RM = 0 produces zero weights', () => {
      const plan = generateMeetPrepPlan('2026-03-29', 0, 'lbs', CURRENT_DATE);
      for (const w of plan.weeks) {
        expect(w.weight).toBe(0);
      }
    });
  });
});
