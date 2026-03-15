import { describe, it, expect } from 'vitest';
import {
  getRecommendation,
  getPhaseWeights,
  suggestNextPhase,
  PHASE_DESCRIPTIONS,
  type TrainingPhase,
  type PhaseSessionData,
} from '../programming';

describe('getRecommendation', () => {
  it('returns hypertrophy prescription with correct sets/reps', () => {
    const rec = getRecommendation('hypertrophy');
    expect(rec.phase).toBe('hypertrophy');
    expect(rec.sets).toBe(4);
    expect(rec.reps).toBe('8-12');
    expect(rec.restMinutes).toBe('1-2');
  });

  it('returns strength prescription with correct sets/reps', () => {
    const rec = getRecommendation('strength');
    expect(rec.phase).toBe('strength');
    expect(rec.sets).toBe(5);
    expect(rec.reps).toBe('3-5');
    expect(rec.restMinutes).toBe('3-5');
  });

  it('returns peaking prescription with correct sets/reps', () => {
    const rec = getRecommendation('peaking');
    expect(rec.phase).toBe('peaking');
    expect(rec.sets).toBe(4);
    expect(rec.reps).toBe('1-3');
    expect(rec.restMinutes).toBe('5+');
  });

  it('returns deload prescription with correct sets/reps', () => {
    const rec = getRecommendation('deload');
    expect(rec.phase).toBe('deload');
    expect(rec.sets).toBe(3);
    expect(rec.reps).toBe('5-8');
    expect(rec.restMinutes).toBe('2-3');
  });

  it('uses RPE when no 1RM is provided', () => {
    const rec = getRecommendation('strength');
    expect(rec.intensity).toBe('RPE 8-9');
    expect(rec.weightRange).toBeUndefined();
  });

  it('uses percentage-based intensity when 1RM is provided', () => {
    const rec = getRecommendation('strength', 300);
    expect(rec.intensity).toBe('80-90% 1RM');
  });

  it('calculates weight range from 1RM for hypertrophy', () => {
    const rec = getRecommendation('hypertrophy', 300, 'squat', 'lbs');
    expect(rec.weightRange).toBeDefined();
    // 65% of 300 = 195, 75% of 300 = 225
    expect(rec.weightRange![0]).toBe(195);
    expect(rec.weightRange![1]).toBe(225);
    expect(rec.weightUnit).toBe('lbs');
  });

  it('calculates weight range from 1RM for peaking', () => {
    const rec = getRecommendation('peaking', 200, 'squat', 'kg');
    // 90% of 200 = 180, 100% of 200 = 200
    expect(rec.weightRange![0]).toBe(180);
    expect(rec.weightRange![1]).toBe(200);
    expect(rec.weightUnit).toBe('kg');
  });

  it('calculates weight range from 1RM for deload', () => {
    const rec = getRecommendation('deload', 400);
    // 50% of 400 = 200, 60% of 400 = 240
    expect(rec.weightRange![0]).toBe(200);
    expect(rec.weightRange![1]).toBe(240);
  });

  it('does not add weight range when 1RM is zero', () => {
    const rec = getRecommendation('strength', 0);
    expect(rec.weightRange).toBeUndefined();
  });

  it('tailors focus areas for deadlift', () => {
    const rec = getRecommendation('strength', 300, 'deadlift');
    expect(rec.focusAreas.some(a => a.includes('hip hinge'))).toBe(true);
  });

  it('tailors focus areas for bench press', () => {
    const rec = getRecommendation('strength', 200, 'bench_press');
    expect(rec.focusAreas.some(a => a.includes('Shoulder retraction'))).toBe(true);
  });

  it('includes notes array', () => {
    const rec = getRecommendation('hypertrophy');
    expect(rec.notes.length).toBeGreaterThan(0);
    expect(rec.focusAreas.length).toBeGreaterThan(0);
  });

  it('defaults weight unit to lbs when not specified', () => {
    const rec = getRecommendation('strength', 300);
    expect(rec.weightUnit).toBe('lbs');
  });
});

describe('getPhaseWeights', () => {
  const phases: TrainingPhase[] = ['hypertrophy', 'strength', 'peaking', 'deload'];

  for (const phase of phases) {
    it(`returns weights that sum to ~1.0 for ${phase}`, () => {
      const weights = getPhaseWeights(phase);
      const sum = Object.values(weights).reduce((s, v) => s + v, 0);
      expect(sum).toBeCloseTo(1.0, 1);
    });
  }

  it('emphasizes tempo for hypertrophy', () => {
    const hyp = getPhaseWeights('hypertrophy');
    const str = getPhaseWeights('strength');
    expect(hyp.tempo).toBeGreaterThan(str.tempo);
  });

  it('emphasizes trunk for strength', () => {
    const str = getPhaseWeights('strength');
    const hyp = getPhaseWeights('hypertrophy');
    expect(str.trunk).toBeGreaterThan(hyp.trunk);
  });

  it('emphasizes lockout for peaking', () => {
    const peak = getPhaseWeights('peaking');
    expect(peak.lockout).toBe(0.30);
  });

  it('sets tempo to zero for peaking', () => {
    const peak = getPhaseWeights('peaking');
    expect(peak.tempo).toBe(0);
  });

  it('uses roughly equal weights for deload', () => {
    const deload = getPhaseWeights('deload');
    const values = Object.values(deload);
    const min = Math.min(...values);
    const max = Math.max(...values);
    // All weights should be within 0.02 of each other
    expect(max - min).toBeLessThanOrEqual(0.02);
  });

  it('has all six scoring dimensions', () => {
    const weights = getPhaseWeights('hypertrophy');
    expect(Object.keys(weights)).toEqual(
      expect.arrayContaining(['depth', 'kneeTracking', 'trunk', 'symmetry', 'tempo', 'lockout']),
    );
  });
});

describe('suggestNextPhase', () => {
  it('suggests hypertrophy for empty session history', () => {
    const result = suggestNextPhase([]);
    expect(result.phase).toBe('hypertrophy');
    expect(result.reason).toBeTruthy();
  });

  it('suggests hypertrophy for fewer than 3 sessions', () => {
    const sessions: PhaseSessionData[] = [
      { score: 70, date: '2026-03-10' },
      { score: 75, date: '2026-03-08' },
    ];
    const result = suggestNextPhase(sessions);
    expect(result.phase).toBe('hypertrophy');
  });

  it('suggests deload when RPE is very high', () => {
    const sessions: PhaseSessionData[] = [
      { score: 80, rpe: 9.0, date: '2026-03-14' },
      { score: 78, rpe: 9.5, date: '2026-03-12' },
      { score: 75, rpe: 9.0, date: '2026-03-10' },
      { score: 77, rpe: 8.5, date: '2026-03-08' },
    ];
    const result = suggestNextPhase(sessions);
    expect(result.phase).toBe('deload');
    expect(result.reason).toContain('RPE');
  });

  it('suggests deload when scores are declining with enough sessions', () => {
    const sessions: PhaseSessionData[] = [
      { score: 60, date: '2026-03-14' },
      { score: 62, date: '2026-03-13' },
      { score: 70, date: '2026-03-12' },
      { score: 75, date: '2026-03-11' },
      { score: 80, date: '2026-03-10' },
    ];
    const result = suggestNextPhase(sessions);
    expect(result.phase).toBe('deload');
    expect(result.reason).toContain('declining');
  });

  it('suggests peaking with high scores and many sessions', () => {
    const sessions: PhaseSessionData[] = [];
    for (let i = 0; i < 10; i++) {
      sessions.push({ score: 88, date: `2026-03-${14 - i}` });
    }
    const result = suggestNextPhase(sessions);
    expect(result.phase).toBe('peaking');
  });

  it('suggests strength with good scores and moderate sessions', () => {
    const sessions: PhaseSessionData[] = [];
    for (let i = 0; i < 6; i++) {
      sessions.push({ score: 78, date: `2026-03-${14 - i}` });
    }
    const result = suggestNextPhase(sessions);
    expect(result.phase).toBe('strength');
  });

  it('suggests hypertrophy when scores are below threshold', () => {
    const sessions: PhaseSessionData[] = [];
    for (let i = 0; i < 6; i++) {
      sessions.push({ score: 60, date: `2026-03-${14 - i}` });
    }
    const result = suggestNextPhase(sessions);
    expect(result.phase).toBe('hypertrophy');
    expect(result.reason).toContain('75+');
  });

  it('ignores sessions without RPE for RPE calculations', () => {
    const sessions: PhaseSessionData[] = [
      { score: 80, date: '2026-03-14' },
      { score: 78, date: '2026-03-12' },
      { score: 75, date: '2026-03-10' },
    ];
    // No RPE data -- should not suggest deload based on RPE
    const result = suggestNextPhase(sessions);
    expect(result.phase).toBe('hypertrophy');
  });

  it('always returns a reason string', () => {
    const scenarios: PhaseSessionData[][] = [
      [],
      [{ score: 50, date: '2026-01-01' }],
      Array.from({ length: 10 }, (_, i) => ({ score: 90, date: `2026-03-${i + 1}` })),
    ];
    for (const sessions of scenarios) {
      const result = suggestNextPhase(sessions);
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('PHASE_DESCRIPTIONS', () => {
  it('has descriptions for all four phases', () => {
    expect(PHASE_DESCRIPTIONS.hypertrophy).toBeTruthy();
    expect(PHASE_DESCRIPTIONS.strength).toBeTruthy();
    expect(PHASE_DESCRIPTIONS.peaking).toBeTruthy();
    expect(PHASE_DESCRIPTIONS.deload).toBeTruthy();
  });
});
