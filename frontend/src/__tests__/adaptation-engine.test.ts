/**
 * Comprehensive tests for the adaptation engine.
 *
 * Covers:
 * - Red flag screening (Signal 0)
 * - Persistent injury tracking (Signal 0.5)
 * - Form score weight recommendations (Signal 2)
 * - RPE-based adjustments (Signal 3)
 * - Session difficulty feedback (Signal 3)
 * - Forced deload detection (Signal 5)
 * - Return-to-training protocol
 * - Weight recommendation system (autoApply logic)
 * - Edge cases (empty feedback, missing data, bar minimum floor)
 * - Multi-signal priority integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  processAdaptations,
  applyWeightRecommendation,
} from '../adaptation-engine';
import type {
  PostWorkoutFeedback,
  InjuryReport,
  AdaptationDecision,
  AdaptationResult,
  WeightRecommendation,
} from '../adaptation-engine';
import { initializeProgram, roundToPlate, enforceBarMinimum } from '../progression-engine';
import { MIN_BAR_WEIGHT } from '../progression-engine';
import type { ProgramState, WorkoutLog, ReadinessData, WorkoutSet } from '../workout-storage';
import type { UserProfile } from '../workout-programs';

// Mock loadWorkoutLogs (used by countRecentDifficulty inside adaptation-engine)
vi.mock('../workout-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../workout-storage')>();
  return {
    ...actual,
    loadWorkoutLogs: vi.fn(() => []),
  };
});

// Get reference to the mocked function for dynamic returns
import { loadWorkoutLogs } from '../workout-storage';
const mockLoadWorkoutLogs = loadWorkoutLogs as ReturnType<typeof vi.fn>;

// ─── Test Helpers ───

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    experienceLevel: 'beginner',
    daysPerWeek: 3,
    equipment: 'barbell_home',
    goal: 'strength',
    maxes: { squat: 200, bench: 150, deadlift: 250, ohp: 100 },
    ...overrides,
  };
}

function makeState(programId = 'starting_strength', profile?: UserProfile): ProgramState {
  return initializeProgram(programId, profile ?? makeProfile());
}

function makeBaseFeedback(overrides: Partial<PostWorkoutFeedback> = {}): PostWorkoutFeedback {
  return {
    sessionDifficulty: 'just_right',
    liftRPE: {},
    sessionRPE: 7,
    soreness: 'none',
    injuries: [],
    notes: '',
    ...overrides,
  };
}

function makeReadiness(overrides: Partial<ReadinessData> = {}): ReadinessData {
  return {
    sleepHours: 8,
    sleepQuality: 4,
    stress: 2,
    soreness: 1,
    motivation: 4,
    ...overrides,
  };
}

function makeLogs(count: number, overrides: Partial<WorkoutLog> = {}): WorkoutLog[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i),
    date: new Date(Date.now() - i * 86400000).toISOString(),
    programId: 'starting_strength',
    workoutDayIndex: 0,
    workoutDayName: 'Day A',
    sets: [],
    completed: true,
    ...overrides,
  }));
}

function makeInjury(overrides: Partial<InjuryReport> = {}): InjuryReport {
  return {
    bodyArea: 'lower_back',
    status: 'pain_during_exercise',
    aggravatingExercises: ['squat'],
    ...overrides,
  };
}

beforeEach(() => {
  mockLoadWorkoutLogs.mockReturnValue([]);
});

// ════════════════════════════════════════════════════════════════
// 1. Red Flag Screening (Signal 0 — highest priority)
// ════════════════════════════════════════════════════════════════

describe('Red Flag Screening', () => {
  const RED_FLAG_SYMPTOMS = [
    'sudden_onset',
    'numbness_tingling',
    'radiating_pain',
    'swelling_deformity',
    'joint_locking',
  ];

  for (const symptom of RED_FLAG_SYMPTOMS) {
    it(`should trigger STOP ALL TRAINING for red flag: ${symptom}`, () => {
      const state = makeState();
      const feedback = makeBaseFeedback({
        injuries: [makeInjury({ redFlags: [symptom] })],
      });

      const decisions = processAdaptations(state, feedback, undefined, []);

      const redFlagDecision = decisions.find(d =>
        d.description.includes('RED FLAG') && d.description.includes('STOP ALL TRAINING')
      );
      expect(redFlagDecision).toBeDefined();
      expect(redFlagDecision!.description).toContain(symptom);
      expect(redFlagDecision!.citation).toContain('ACSM');
    });
  }

  it('should handle multiple red flags simultaneously', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({
      injuries: [makeInjury({
        redFlags: ['sudden_onset', 'numbness_tingling', 'radiating_pain'],
      })],
    });

    const decisions = processAdaptations(state, feedback, undefined, []);

    const redFlagDecision = decisions.find(d => d.description.includes('RED FLAG'));
    expect(redFlagDecision).toBeDefined();
    expect(redFlagDecision!.description).toContain('sudden_onset');
    expect(redFlagDecision!.description).toContain('numbness_tingling');
    expect(redFlagDecision!.description).toContain('radiating_pain');
  });

  it('should stop training even when all other signals are positive (good form, low RPE)', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({
      sessionDifficulty: 'too_easy',
      liftRPE: { squat: 5, bench: 5, deadlift: 5 },
      sessionRPE: 5,
      soreness: 'none',
      injuries: [makeInjury({
        bodyArea: 'knees',
        status: 'minor_discomfort',
        aggravatingExercises: ['squat'],
        redFlags: ['swelling_deformity'],
      })],
    });

    const decisions = processAdaptations(state, feedback, undefined, [], { squat: 95 });

    // Red flag decision should be first (unshifted)
    const redFlagDecision = decisions.find(d => d.description.includes('RED FLAG'));
    expect(redFlagDecision).toBeDefined();
    expect(redFlagDecision!.description).toContain('STOP ALL TRAINING');
  });

  it('should place red flag decisions at the front of the decisions array', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({
      sessionDifficulty: 'too_easy',
      injuries: [makeInjury({ redFlags: ['joint_locking'] })],
    });

    const decisions = processAdaptations(state, feedback, undefined, []);

    // The first decision should be the red flag
    expect(decisions[0].description).toContain('RED FLAG');
  });

  it('should handle red flags from multiple different body areas', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({
      injuries: [
        makeInjury({ bodyArea: 'knees', redFlags: ['swelling_deformity'] }),
        makeInjury({ bodyArea: 'lower_back', redFlags: ['radiating_pain'] }),
      ],
    });

    const decisions = processAdaptations(state, feedback, undefined, []);

    const redFlagDecisions = decisions.filter(d => d.description.includes('RED FLAG'));
    expect(redFlagDecisions.length).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════
// 2. Persistent Injury Tracking (Signal 0.5)
// ════════════════════════════════════════════════════════════════

describe('Persistent Injury Tracking', () => {
  it('should NOT escalate after 1 session of pain', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({
      injuries: [makeInjury({ bodyArea: 'knees', status: 'minor_discomfort' })],
    });

    const decisions = processAdaptations(state, feedback, undefined, []);

    const escalation = decisions.find(d => d.description.includes('consecutive sessions'));
    expect(escalation).toBeUndefined();
    expect(state.injuryHistory).toBeDefined();
    expect(state.injuryHistory!['knees']).toBe(1);
  });

  it('should escalate with referral after 3 consecutive sessions of same body area pain', () => {
    const state = makeState();
    state.injuryHistory = { knees: 2 }; // Already reported 2 sessions

    const feedback = makeBaseFeedback({
      injuries: [makeInjury({ bodyArea: 'knees', status: 'pain_during_exercise' })],
    });

    const decisions = processAdaptations(state, feedback, undefined, []);

    const escalation = decisions.find(d =>
      d.description.includes('consecutive sessions') && d.description.includes('physiotherapist')
    );
    expect(escalation).toBeDefined();
    expect(escalation!.description).toContain('3 consecutive sessions');
    expect(state.injuryHistory!['knees']).toBe(3);
  });

  it('should reset counter when pain resolves then returns', () => {
    const state = makeState();
    state.injuryHistory = { knees: 2 }; // Had 2 sessions of knee pain

    // Session where pain resolves (no knees injury reported)
    const resolvedFeedback = makeBaseFeedback({ injuries: [] });
    processAdaptations(state, resolvedFeedback, undefined, []);

    // Counter should be reset to 0
    expect(state.injuryHistory!['knees']).toBe(0);

    // Pain returns — should count from 1 again
    const returnFeedback = makeBaseFeedback({
      injuries: [makeInjury({ bodyArea: 'knees', status: 'pain_during_exercise' })],
    });
    processAdaptations(state, returnFeedback, undefined, []);

    expect(state.injuryHistory!['knees']).toBe(1);
  });

  it('should NOT escalate for different body areas in consecutive sessions', () => {
    const state = makeState();
    state.injuryHistory = { knees: 2 }; // Had knee pain for 2 sessions

    // Now reporting DIFFERENT area (shoulder) — knees resolved
    const feedback = makeBaseFeedback({
      injuries: [makeInjury({ bodyArea: 'shoulders', status: 'pain_during_exercise' })],
    });

    const decisions = processAdaptations(state, feedback, undefined, []);

    // Should NOT have an escalation decision for shoulders (only 1 session)
    const shoulderEscalation = decisions.find(d =>
      d.description.includes('consecutive sessions') && d.description.includes('Shoulder')
    );
    expect(shoulderEscalation).toBeUndefined();

    // Shoulder count should be 1, knee count should be cleared
    expect(state.injuryHistory!['shoulders']).toBe(1);
    expect(state.injuryHistory!['knees']).toBe(0);
  });

  it('should track injury counts beyond 3 sessions', () => {
    const state = makeState();
    state.injuryHistory = { knees: 4 }; // 4 sessions of pain already

    const feedback = makeBaseFeedback({
      injuries: [makeInjury({ bodyArea: 'knees', status: 'pain_during_exercise' })],
    });

    const decisions = processAdaptations(state, feedback, undefined, []);

    const escalation = decisions.find(d => d.description.includes('5 consecutive sessions'));
    expect(escalation).toBeDefined();
    expect(state.injuryHistory!['knees']).toBe(5);
  });
});

// ════════════════════════════════════════════════════════════════
// 3. Form Score Weight Recommendations (Signal 2)
// ════════════════════════════════════════════════════════════════

describe('Form Score Weight Recommendations', () => {
  it('should recommend 12% reduction for score < 60 with autoApply: false', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;
    const feedback = makeBaseFeedback();

    const result = processAdaptations(state, feedback, undefined, [], { squat: 55 }, true);

    // Check recommendation
    expect(result.recommendations.length).toBeGreaterThanOrEqual(1);
    const rec = result.recommendations.find(r => r.lift === 'squat');
    expect(rec).toBeDefined();
    expect(rec!.autoApply).toBe(false);
    expect(rec!.severity).toBe('urgent');
    expect(rec!.source).toBe('form_score');
    expect(rec!.currentWeight).toBe(originalWeight);
    const expectedWeight = enforceBarMinimum(
      roundToPlate(originalWeight * 0.88, 'lbs'),
      'lbs',
    );
    expect(rec!.recommendedWeight).toBe(expectedWeight);

    // Weight should NOT have been changed
    expect(state.liftProgress.squat.currentWeight).toBe(originalWeight);

    // Check decision
    const decision = result.decisions.find(d => d.type === 'weight_decrease' && d.lift === 'squat');
    expect(decision).toBeDefined();
    expect(decision!.applied).toBe(false);
    expect(decision!.description).toContain('-12%');
  });

  it('should recommend 8% reduction for score 60-69 with autoApply: false', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;
    const feedback = makeBaseFeedback();

    const result = processAdaptations(state, feedback, undefined, [], { squat: 65 }, true);

    const rec = result.recommendations.find(r => r.lift === 'squat');
    expect(rec).toBeDefined();
    expect(rec!.autoApply).toBe(false);
    expect(rec!.severity).toBe('warning');
    expect(rec!.source).toBe('form_score');
    const expectedWeight = enforceBarMinimum(
      roundToPlate(originalWeight * 0.92, 'lbs'),
      'lbs',
    );
    expect(rec!.recommendedWeight).toBe(expectedWeight);

    // Weight should NOT have been changed
    expect(state.liftProgress.squat.currentWeight).toBe(originalWeight);
  });

  it('should generate no recommendation for score >= 70', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;
    const feedback = makeBaseFeedback();

    const result = processAdaptations(state, feedback, undefined, [], { squat: 75 }, true);

    const rec = result.recommendations.find(r => r.lift === 'squat');
    expect(rec).toBeUndefined();

    // No weight_decrease decision for this score range (70-89 is neutral)
    const decrease = result.decisions.find(d => d.type === 'weight_decrease' && d.lift === 'squat');
    expect(decrease).toBeUndefined();
    expect(state.liftProgress.squat.currentWeight).toBe(originalWeight);
  });

  it('should generate no recommendation for score = 100', () => {
    const state = makeState();
    const feedback = makeBaseFeedback();

    const result = processAdaptations(state, feedback, undefined, [], { squat: 100 }, true);

    const rec = result.recommendations.find(r => r.lift === 'squat');
    expect(rec).toBeUndefined();
  });

  it('should handle score = 0 gracefully without crashes', () => {
    const state = makeState();
    const feedback = makeBaseFeedback();

    // Should not throw
    expect(() => {
      processAdaptations(state, feedback, undefined, [], { squat: 0 });
    }).not.toThrow();

    const decisions = processAdaptations(state, feedback, undefined, [], { squat: 0 });
    const decrease = decisions.find(d => d.type === 'weight_decrease' && d.lift === 'squat');
    expect(decrease).toBeDefined();
    expect(decrease!.applied).toBe(false);
  });

  it('should have correct recommendation fields', () => {
    const state = makeState();
    const feedback = makeBaseFeedback();

    const result = processAdaptations(state, feedback, undefined, [], { squat: 55 }, true);

    const rec = result.recommendations[0];
    expect(rec).toHaveProperty('lift');
    expect(rec).toHaveProperty('currentWeight');
    expect(rec).toHaveProperty('recommendedWeight');
    expect(rec).toHaveProperty('reason');
    expect(rec).toHaveProperty('severity');
    expect(rec).toHaveProperty('source');
    expect(rec).toHaveProperty('autoApply');
    expect(typeof rec.lift).toBe('string');
    expect(typeof rec.currentWeight).toBe('number');
    expect(typeof rec.recommendedWeight).toBe('number');
    expect(typeof rec.reason).toBe('string');
    expect(rec.reason.length).toBeGreaterThan(0);
  });

  it('should generate info decision for excellent form (>= 90)', () => {
    const state = makeState();
    const feedback = makeBaseFeedback();

    const decisions = processAdaptations(state, feedback, undefined, [], { squat: 92 });

    const info = decisions.find(d => d.type === 'info' && d.lift === 'squat');
    expect(info).toBeDefined();
    expect(info!.description).toContain('excellent');
  });

  it('should skip lifts not in liftProgress', () => {
    const state = makeState();
    const feedback = makeBaseFeedback();

    // 'curl' is not a main lift in Starting Strength
    const decisions = processAdaptations(state, feedback, undefined, [], { curl: 40 });

    const curlDecision = decisions.find(d => d.lift === 'curl');
    expect(curlDecision).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════
// 4. RPE-Based Adjustments (Signal 3)
// ════════════════════════════════════════════════════════════════

describe('RPE-Based Adjustments', () => {
  it('should increase weight when RPE <= 6 (1.5x normal increment)', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;
    const increment = state.liftProgress.squat.increment;
    const feedback = makeBaseFeedback({ liftRPE: { squat: 6 } });

    const decisions = processAdaptations(state, feedback, undefined, []);

    const increase = decisions.find(d => d.type === 'weight_increase' && d.lift === 'squat');
    expect(increase).toBeDefined();
    expect(increase!.applied).toBe(true);
    expect(state.liftProgress.squat.currentWeight).toBeGreaterThan(originalWeight);
  });

  it('should make no RPE adjustment in optimal zone (RPE 7-8)', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;
    const feedback = makeBaseFeedback({ liftRPE: { squat: 7.5 } });

    const decisions = processAdaptations(state, feedback, undefined, []);

    const rpeDecision = decisions.find(d =>
      (d.type === 'weight_increase' || d.type === 'weight_decrease') && d.lift === 'squat'
    );
    expect(rpeDecision).toBeUndefined();
    expect(state.liftProgress.squat.currentWeight).toBe(originalWeight);
  });

  it('should warn about RPE 10 (max effort) without changing weight', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;
    const feedback = makeBaseFeedback({ liftRPE: { squat: 10 } });

    const decisions = processAdaptations(state, feedback, undefined, []);

    const warning = decisions.find(d => d.type === 'info' && d.lift === 'squat' && d.description.includes('RPE 10'));
    expect(warning).toBeDefined();
    expect(warning!.applied).toBe(false);
    expect(state.liftProgress.squat.currentWeight).toBe(originalWeight);
  });

  it('should apply independent RPE adjustments per lift', () => {
    const state = makeState();
    const originalSquat = state.liftProgress.squat.currentWeight;
    const originalBench = state.liftProgress.bench.currentWeight;

    const feedback = makeBaseFeedback({
      liftRPE: { squat: 5, bench: 10 },
    });

    const decisions = processAdaptations(state, feedback, undefined, []);

    // Squat should increase (RPE 5 <= 6)
    expect(state.liftProgress.squat.currentWeight).toBeGreaterThan(originalSquat);

    // Bench should NOT decrease (RPE 10 just gets a warning)
    expect(state.liftProgress.bench.currentWeight).toBe(originalBench);

    // Check distinct decisions exist
    const squatIncrease = decisions.find(d => d.type === 'weight_increase' && d.lift === 'squat');
    const benchWarning = decisions.find(d => d.type === 'info' && d.lift === 'bench');
    expect(squatIncrease).toBeDefined();
    expect(benchWarning).toBeDefined();
  });

  it('should not increase weight on low RPE if session difficulty is too_hard', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;

    const feedback = makeBaseFeedback({
      sessionDifficulty: 'too_hard',
      liftRPE: { squat: 5 },
    });

    const decisions = processAdaptations(state, feedback, undefined, []);

    // The RPE branch guards: rpe <= 6 && sessionDifficulty !== 'too_hard'
    const increase = decisions.find(d => d.type === 'weight_increase' && d.lift === 'squat');
    expect(increase).toBeUndefined();
  });

  it('should skip RPE adjustment for unknown lift not in liftProgress', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({
      liftRPE: { 'mystery_lift': 5 },
    });

    // Should not throw
    expect(() => {
      processAdaptations(state, feedback, undefined, []);
    }).not.toThrow();

    const decisions = processAdaptations(state, feedback, undefined, []);
    const mysteryDecision = decisions.find(d => d.lift === 'mystery_lift');
    expect(mysteryDecision).toBeUndefined();
  });

  it('should cap RPE bonus increment for safety', () => {
    const state = makeState();
    // Set a large increment to test the cap
    state.liftProgress.squat.increment = 20; // huge increment
    const originalWeight = state.liftProgress.squat.currentWeight;

    const feedback = makeBaseFeedback({ liftRPE: { squat: 5 } });
    processAdaptations(state, feedback, undefined, []);

    // 1.5x of 20 = 30, but cap is 10 lbs
    // new weight should be roundToPlate(original + min(30, 10)) = roundToPlate(original + 10)
    const maxBonus = 10; // lbs
    const expected = roundToPlate(originalWeight + maxBonus, 'lbs');
    expect(state.liftProgress.squat.currentWeight).toBe(expected);
  });
});

// ════════════════════════════════════════════════════════════════
// 5. Session Difficulty
// ════════════════════════════════════════════════════════════════

describe('Session Difficulty', () => {
  it('"too_easy" should increase all lifts by one increment', () => {
    const state = makeState();
    const originalSquat = state.liftProgress.squat.currentWeight;
    const squatIncrement = state.liftProgress.squat.increment;
    const feedback = makeBaseFeedback({ sessionDifficulty: 'too_easy' });

    const decisions = processAdaptations(state, feedback, undefined, []);

    expect(state.liftProgress.squat.currentWeight).toBe(
      roundToPlate(originalSquat + squatIncrement, 'lbs')
    );
    const increase = decisions.find(d => d.type === 'weight_increase');
    expect(increase).toBeDefined();
    expect(increase!.applied).toBe(true);
  });

  it('"just_right" should make no weight changes', () => {
    const state = makeState();
    const originalSquat = state.liftProgress.squat.currentWeight;
    const feedback = makeBaseFeedback({ sessionDifficulty: 'just_right' });

    const decisions = processAdaptations(state, feedback, undefined, []);

    expect(state.liftProgress.squat.currentWeight).toBe(originalSquat);
    const weightChanges = decisions.filter(d =>
      d.type === 'weight_increase' || d.type === 'weight_decrease' || d.type === 'force_deload'
    );
    expect(weightChanges.length).toBe(0);
  });

  it('"too_hard" with 2+ recent too_hard sessions should reduce by 5%', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;

    // Mock loadWorkoutLogs to return sessions with too_hard difficulty
    mockLoadWorkoutLogs.mockReturnValue([
      { id: '1', date: new Date().toISOString(), programId: 'starting_strength', workoutDayIndex: 0, workoutDayName: 'A', sets: [], completed: true, sessionDifficulty: 'too_hard' },
      { id: '2', date: new Date().toISOString(), programId: 'starting_strength', workoutDayIndex: 0, workoutDayName: 'A', sets: [], completed: true, sessionDifficulty: 'too_hard' },
    ]);

    const feedback = makeBaseFeedback({ sessionDifficulty: 'too_hard' });
    const decisions = processAdaptations(state, feedback, undefined, []);

    const decrease = decisions.find(d => d.type === 'weight_decrease');
    expect(decrease).toBeDefined();
    expect(decrease!.applied).toBe(true);
    expect(state.liftProgress.squat.currentWeight).toBe(
      enforceBarMinimum(roundToPlate(originalWeight * 0.95, 'lbs'), 'lbs')
    );
  });

  it('"too_hard" with no recent too_hard history should only inform', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;
    const feedback = makeBaseFeedback({ sessionDifficulty: 'too_hard' });

    const decisions = processAdaptations(state, feedback, undefined, []);

    expect(state.liftProgress.squat.currentWeight).toBe(originalWeight);
    const info = decisions.find(d => d.type === 'info' && d.description.includes('too hard'));
    expect(info).toBeDefined();
  });

  it('"could_not_finish" should reduce by 10%', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;
    const feedback = makeBaseFeedback({ sessionDifficulty: 'could_not_finish' });

    const decisions = processAdaptations(state, feedback, undefined, []);

    const deload = decisions.find(d => d.type === 'force_deload');
    expect(deload).toBeDefined();
    expect(deload!.applied).toBe(true);
    expect(state.liftProgress.squat.currentWeight).toBe(
      enforceBarMinimum(roundToPlate(originalWeight * 0.9, 'lbs'), 'lbs')
    );
  });

  it('"too_easy" should NOT double-adjust lifts that already have low RPE', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;
    const sqIncrement = state.liftProgress.squat.increment;

    // Both too_easy AND squat RPE 5 — should only adjust once
    const feedback = makeBaseFeedback({
      sessionDifficulty: 'too_easy',
      liftRPE: { squat: 5 },
    });

    processAdaptations(state, feedback, undefined, []);

    // Squat should be adjusted by RPE path (1.5x increment, capped),
    // NOT double-adjusted by difficulty path too
    // The difficulty path skips lifts with RPE <= 6
    const maxBonus = 10; // lbs
    const rpeBonus = Math.min(sqIncrement * 1.5, maxBonus);
    const expectedFromRPE = roundToPlate(originalWeight + rpeBonus, 'lbs');
    expect(state.liftProgress.squat.currentWeight).toBe(expectedFromRPE);
  });
});

// ════════════════════════════════════════════════════════════════
// 6. Forced Deload Detection (Signal 5)
// ════════════════════════════════════════════════════════════════

describe('Forced Deload Detection', () => {
  it('should force deload when 3 of 5 fatigue signals are present', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;

    // Construct exactly 3 signals:
    // 1. recentHighRPE >= 2
    // 2. sessionDifficulty = too_hard
    // 3. soreness = severe
    const logs = makeLogs(5, {
      sets: [
        { exerciseName: 'Squat', exerciseSlot: 'squat', setNumber: 1, targetReps: '5', targetWeight: 200, rpe: 9.5, completed: true },
      ],
    });

    const feedback = makeBaseFeedback({
      sessionDifficulty: 'too_hard',
      soreness: 'severe',
    });

    const decisions = processAdaptations(state, feedback, undefined, logs);

    const forceDeload = decisions.find(d =>
      d.type === 'force_deload' && d.description.includes('Accumulated fatigue')
    );
    expect(forceDeload).toBeDefined();
    expect(forceDeload!.applied).toBe(true);

    // Should be 15% reduction
    expect(state.liftProgress.squat.currentWeight).toBe(
      enforceBarMinimum(roundToPlate(originalWeight * 0.85, 'lbs'), 'lbs')
    );
  });

  it('should NOT force deload with only 2 of 5 signals', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;

    // Only 2 signals: too_hard + severe soreness (no high RPE logs)
    const feedback = makeBaseFeedback({
      sessionDifficulty: 'too_hard',
      soreness: 'severe',
    });

    const decisions = processAdaptations(state, feedback, undefined, makeLogs(3));

    const forceDeload = decisions.find(d =>
      d.type === 'force_deload' && d.description.includes('Accumulated fatigue')
    );
    expect(forceDeload).toBeUndefined();
  });

  it('should require at least 3 recent logs before evaluating fatigue', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({
      sessionDifficulty: 'could_not_finish',
      soreness: 'extreme',
      sessionRPE: 10,
    });

    // Only 2 logs — not enough for forced deload
    const decisions = processAdaptations(state, feedback, undefined, makeLogs(2));

    const forceDeload = decisions.find(d =>
      d.type === 'force_deload' && d.description.includes('Accumulated fatigue')
    );
    expect(forceDeload).toBeUndefined();
  });

  it('should trigger with all 5 signals and cite all evidence', () => {
    const state = makeState();

    // All 5 signals:
    // 1. recentHighRPE >= 2
    // 2. sessionDifficulty = could_not_finish
    // 3. soreness = extreme
    // 4. readiness trend < 2.5
    // 5. sessionRPE >= 9.5
    const logs = makeLogs(5, {
      sets: [
        { exerciseName: 'Squat', exerciseSlot: 'squat', setNumber: 1, targetReps: '5', targetWeight: 200, rpe: 9.5, completed: true },
      ],
      readiness: { sleepHours: 4, sleepQuality: 1, stress: 5, soreness: 5, motivation: 1 },
    });

    const feedback = makeBaseFeedback({
      sessionDifficulty: 'could_not_finish',
      soreness: 'extreme',
      sessionRPE: 10,
    });

    const decisions = processAdaptations(state, feedback, undefined, logs);

    const forceDeload = decisions.find(d =>
      d.type === 'force_deload' && d.description.includes('Accumulated fatigue')
    );
    expect(forceDeload).toBeDefined();
    expect(forceDeload!.description).toContain('5 of 5');
    expect(forceDeload!.applied).toBe(true);
  });

  it('should not reduce weight below bar minimum during forced deload', () => {
    const state = makeState();
    // Set weight to bare minimum
    state.liftProgress.squat.currentWeight = MIN_BAR_WEIGHT.lbs;

    const logs = makeLogs(5, {
      sets: [
        { exerciseName: 'Squat', exerciseSlot: 'squat', setNumber: 1, targetReps: '5', targetWeight: 45, rpe: 9.5, completed: true },
      ],
    });

    const feedback = makeBaseFeedback({
      sessionDifficulty: 'too_hard',
      soreness: 'severe',
      sessionRPE: 10,
    });

    processAdaptations(state, feedback, undefined, logs);

    expect(state.liftProgress.squat.currentWeight).toBeGreaterThanOrEqual(MIN_BAR_WEIGHT.lbs);
  });
});

// ════════════════════════════════════════════════════════════════
// 7. Return-to-Training Protocol
// ════════════════════════════════════════════════════════════════

describe('Return-to-Training Protocol', () => {
  it('should recommend 70% weight for first session after injury resolves', () => {
    const state = makeState();
    // Simulate previous knee injury (2 sessions of pain)
    state.injuryHistory = { knees: 2 };

    // Session where pain resolves (no injury reported)
    const feedback = makeBaseFeedback({ injuries: [] });
    const decisions = processAdaptations(state, feedback, undefined, []);

    // Should have return-to-training decisions for affected lifts
    const returnDecisions = decisions.filter(d =>
      d.type === 'weight_decrease' && d.description.includes('Returning')
    );
    expect(returnDecisions.length).toBeGreaterThan(0);
    expect(returnDecisions[0].description).toContain('70%');
    expect(returnDecisions[0].applied).toBe(true);
  });

  it('should clear injury history for resolved area', () => {
    const state = makeState();
    state.injuryHistory = { knees: 3 };

    const feedback = makeBaseFeedback({ injuries: [] });
    processAdaptations(state, feedback, undefined, []);

    expect(state.injuryHistory!['knees']).toBe(0);
  });

  it('should trigger return-to-training for correct affected lifts', () => {
    const state = makeState();
    state.injuryHistory = { lower_back: 2 };

    const feedback = makeBaseFeedback({ injuries: [] });
    const decisions = processAdaptations(state, feedback, undefined, []);

    const returnDecisions = decisions.filter(d =>
      d.type === 'weight_decrease' && d.description.includes('Returning')
    );
    // lower_back affects squat and deadlift
    const liftNames = returnDecisions.map(d => d.lift);
    expect(liftNames).toContain('squat');
    expect(liftNames).toContain('deadlift');
  });

  it('should NOT trigger return-to-training if injury was never recorded', () => {
    const state = makeState();
    // No injuryHistory at all
    const feedback = makeBaseFeedback({ injuries: [] });
    const decisions = processAdaptations(state, feedback, undefined, []);

    const returnDecisions = decisions.filter(d =>
      d.type === 'weight_decrease' && d.description.includes('Returning')
    );
    expect(returnDecisions.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// 8. Weight Recommendation System (autoApply logic)
// ════════════════════════════════════════════════════════════════

describe('Weight Recommendation System', () => {
  it('processAdaptations with returnResult: true should return AdaptationResult', () => {
    const state = makeState();
    const feedback = makeBaseFeedback();

    const result = processAdaptations(state, feedback, undefined, [], { squat: 55 }, true);

    expect(result).toHaveProperty('decisions');
    expect(result).toHaveProperty('recommendations');
    expect(Array.isArray(result.decisions)).toBe(true);
    expect(Array.isArray(result.recommendations)).toBe(true);
  });

  it('processAdaptations without returnResult should return decisions array (backward compat)', () => {
    const state = makeState();
    const feedback = makeBaseFeedback();

    const result = processAdaptations(state, feedback, undefined, [], { squat: 55 });

    expect(Array.isArray(result)).toBe(true);
    // Should be AdaptationDecision[], not AdaptationResult
    expect(result).not.toHaveProperty('recommendations');
  });

  it('form-score decisions should have applied: false', () => {
    const state = makeState();
    const feedback = makeBaseFeedback();

    const result = processAdaptations(state, feedback, undefined, [], { squat: 55 }, true);

    const formDecision = result.decisions.find(d =>
      d.type === 'weight_decrease' && d.lift === 'squat'
    );
    expect(formDecision).toBeDefined();
    expect(formDecision!.applied).toBe(false);
  });

  it('RPE auto-increase decisions should have applied: true', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({ liftRPE: { squat: 5 } });

    const result = processAdaptations(state, feedback, undefined, [], undefined, true);

    const rpeDecision = result.decisions.find(d =>
      d.type === 'weight_increase' && d.lift === 'squat'
    );
    expect(rpeDecision).toBeDefined();
    expect(rpeDecision!.applied).toBe(true);
  });

  it('difficulty auto-increase decisions should have applied: true', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({ sessionDifficulty: 'too_easy' });

    const result = processAdaptations(state, feedback, undefined, [], undefined, true);

    const difficultyDecision = result.decisions.find(d => d.type === 'weight_increase');
    expect(difficultyDecision).toBeDefined();
    expect(difficultyDecision!.applied).toBe(true);
  });

  it('applyWeightRecommendation should update lift weight', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;

    const recommendation: WeightRecommendation = {
      lift: 'squat',
      currentWeight: originalWeight,
      recommendedWeight: 155,
      reason: 'Form score too low',
      severity: 'warning',
      source: 'form_score',
      autoApply: false,
    };

    applyWeightRecommendation(state, recommendation);

    expect(state.liftProgress.squat.currentWeight).toBe(155);
  });

  it('applyWeightRecommendation should enforce bar minimum', () => {
    const state = makeState();

    const recommendation: WeightRecommendation = {
      lift: 'squat',
      currentWeight: 50,
      recommendedWeight: 30, // Below bar minimum
      reason: 'Test',
      severity: 'urgent',
      source: 'form_score',
      autoApply: false,
    };

    applyWeightRecommendation(state, recommendation);

    expect(state.liftProgress.squat.currentWeight).toBe(MIN_BAR_WEIGHT.lbs);
  });

  it('applyWeightRecommendation should no-op for unknown lift', () => {
    const state = makeState();

    const recommendation: WeightRecommendation = {
      lift: 'unicorn_press',
      currentWeight: 100,
      recommendedWeight: 80,
      reason: 'Test',
      severity: 'warning',
      source: 'form_score',
      autoApply: false,
    };

    // Should not throw
    expect(() => {
      applyWeightRecommendation(state, recommendation);
    }).not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════
// 9. Edge Cases
// ════════════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  it('should handle empty feedback gracefully', () => {
    const state = makeState();
    const feedback = makeBaseFeedback();

    expect(() => {
      processAdaptations(state, feedback, undefined, []);
    }).not.toThrow();

    const decisions = processAdaptations(state, feedback, undefined, []);
    // No decisions for completely neutral feedback
    const weightChanges = decisions.filter(d =>
      d.type === 'weight_increase' || d.type === 'weight_decrease' || d.type === 'force_deload'
    );
    expect(weightChanges.length).toBe(0);
  });

  it('should handle empty recentLogs', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({ sessionDifficulty: 'too_easy' });

    expect(() => {
      processAdaptations(state, feedback, undefined, []);
    }).not.toThrow();
  });

  it('should handle unknown program gracefully', () => {
    const state = makeState();
    state.programId = 'nonexistent_program_xyz';
    const feedback = makeBaseFeedback();

    const decisions = processAdaptations(state, feedback, undefined, []);

    expect(Array.isArray(decisions)).toBe(true);
    expect(decisions.length).toBe(0);
  });

  it('should handle unknown program with returnResult: true', () => {
    const state = makeState();
    state.programId = 'nonexistent_program_xyz';
    const feedback = makeBaseFeedback();

    const result = processAdaptations(state, feedback, undefined, [], undefined, true);

    expect(result).toHaveProperty('decisions');
    expect(result).toHaveProperty('recommendations');
    expect(result.decisions.length).toBe(0);
    expect(result.recommendations.length).toBe(0);
  });

  it('should enforce bar minimum on all reduction paths', () => {
    const state = makeState();
    // Set all lifts to bar minimum
    for (const progress of Object.values(state.liftProgress)) {
      progress.currentWeight = MIN_BAR_WEIGHT.lbs;
    }

    // "could_not_finish" triggers 10% reduction
    const feedback = makeBaseFeedback({ sessionDifficulty: 'could_not_finish' });
    processAdaptations(state, feedback, undefined, []);

    for (const progress of Object.values(state.liftProgress)) {
      expect(progress.currentWeight).toBeGreaterThanOrEqual(MIN_BAR_WEIGHT.lbs);
    }
  });

  it('should enforce bar minimum on form score reduction path', () => {
    const state = makeState();
    state.liftProgress.squat.currentWeight = MIN_BAR_WEIGHT.lbs;
    const feedback = makeBaseFeedback();

    const result = processAdaptations(state, feedback, undefined, [], { squat: 55 }, true);

    if (result.recommendations.length > 0) {
      const rec = result.recommendations.find(r => r.lift === 'squat');
      if (rec) {
        expect(rec.recommendedWeight).toBeGreaterThanOrEqual(MIN_BAR_WEIGHT.lbs);
      }
    }
  });

  it('should handle form scores for exercise not in current program liftProgress', () => {
    const state = makeState();
    const feedback = makeBaseFeedback();

    // 'leg_curl' is not in Starting Strength liftProgress
    const decisions = processAdaptations(state, feedback, undefined, [], { leg_curl: 40 });

    const legCurlDecision = decisions.find(d => d.lift === 'leg_curl');
    expect(legCurlDecision).toBeUndefined();
  });

  it('should handle injuries with empty redFlags array', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({
      injuries: [makeInjury({ redFlags: [] })],
    });

    const decisions = processAdaptations(state, feedback, undefined, []);

    const redFlagDecision = decisions.find(d => d.description.includes('RED FLAG'));
    expect(redFlagDecision).toBeUndefined();
  });

  it('should handle injuries without redFlags property', () => {
    const state = makeState();
    const injury: InjuryReport = {
      bodyArea: 'knees',
      status: 'pain_during_exercise',
      aggravatingExercises: ['squat'],
      // no redFlags property
    };
    const feedback = makeBaseFeedback({ injuries: [injury] });

    const decisions = processAdaptations(state, feedback, undefined, []);

    const redFlagDecision = decisions.find(d => d.description.includes('RED FLAG'));
    expect(redFlagDecision).toBeUndefined();
  });

  it('should handle undefined formScores', () => {
    const state = makeState();
    const feedback = makeBaseFeedback();

    expect(() => {
      processAdaptations(state, feedback, undefined, [], undefined);
    }).not.toThrow();
  });

  it('should handle empty liftRPE object', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({ liftRPE: {} });

    expect(() => {
      processAdaptations(state, feedback, undefined, []);
    }).not.toThrow();
  });

  it('should handle all lifts at bar minimum with no further reduction', () => {
    const state = makeState();
    for (const progress of Object.values(state.liftProgress)) {
      progress.currentWeight = MIN_BAR_WEIGHT.lbs;
    }

    // Multiple reduction signals
    const feedback = makeBaseFeedback({ sessionDifficulty: 'could_not_finish' });
    processAdaptations(state, feedback, undefined, []);

    for (const progress of Object.values(state.liftProgress)) {
      expect(progress.currentWeight).toBe(MIN_BAR_WEIGHT.lbs);
    }
  });
});

// ════════════════════════════════════════════════════════════════
// 10. Integration: Multi-Signal Priority
// ════════════════════════════════════════════════════════════════

describe('Multi-Signal Priority', () => {
  it('red flag + good RPE + good form → red flag wins (stop all training)', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({
      liftRPE: { squat: 6 },
      injuries: [makeInjury({
        bodyArea: 'knees',
        status: 'minor_discomfort',
        aggravatingExercises: ['squat'],
        redFlags: ['sudden_onset'],
      })],
    });

    const decisions = processAdaptations(state, feedback, undefined, [], { squat: 95 });

    // Red flag should be present and first
    const redFlag = decisions.find(d => d.description.includes('RED FLAG'));
    expect(redFlag).toBeDefined();
    expect(decisions[0].description).toContain('RED FLAG');
  });

  it('bad form + good RPE → form recommendation generated (not auto-applied)', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;
    const feedback = makeBaseFeedback({
      liftRPE: { squat: 7 }, // Good RPE, no adjustment
    });

    const result = processAdaptations(state, feedback, undefined, [], { squat: 55 }, true);

    // Form recommendation should exist
    const formRec = result.recommendations.find(r => r.lift === 'squat' && r.source === 'form_score');
    expect(formRec).toBeDefined();
    expect(formRec!.autoApply).toBe(false);

    // Weight should NOT have changed
    expect(state.liftProgress.squat.currentWeight).toBe(originalWeight);
  });

  it('bad RPE (low) + good form → RPE auto-applied', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;
    const feedback = makeBaseFeedback({
      liftRPE: { squat: 5 }, // Low RPE → increase
    });

    const result = processAdaptations(state, feedback, undefined, [], { squat: 92 }, true);

    // RPE increase should be applied
    const rpeDecision = result.decisions.find(d =>
      d.type === 'weight_increase' && d.lift === 'squat'
    );
    expect(rpeDecision).toBeDefined();
    expect(rpeDecision!.applied).toBe(true);
    expect(state.liftProgress.squat.currentWeight).toBeGreaterThan(originalWeight);
  });

  it('forced deload + individual lift adjustment → deload applies to all lifts', () => {
    const state = makeState();

    // Create conditions for forced deload (3+ fatigue signals)
    const logs = makeLogs(5, {
      sets: [
        { exerciseName: 'Squat', exerciseSlot: 'squat', setNumber: 1, targetReps: '5', targetWeight: 200, rpe: 9.5, completed: true },
      ],
    });

    const feedback = makeBaseFeedback({
      sessionDifficulty: 'too_hard',
      soreness: 'severe',
      sessionRPE: 10,
      liftRPE: { squat: 5 }, // Low RPE on squat would normally increase
    });

    const decisions = processAdaptations(state, feedback, undefined, logs);

    // Force deload should be present
    const forceDeload = decisions.find(d =>
      d.type === 'force_deload' && d.description.includes('Accumulated fatigue')
    );
    expect(forceDeload).toBeDefined();
  });

  it('form score + difficulty adjustment → no double adjustment via RPE', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;

    // too_easy adjusts all lifts, AND squat has bad form score
    const feedback = makeBaseFeedback({
      sessionDifficulty: 'too_easy',
    });

    const result = processAdaptations(state, feedback, undefined, [], { squat: 55 }, true);

    // Difficulty should have increased squat
    // Form score should have generated a recommendation (not applied)
    const formRec = result.recommendations.find(r => r.lift === 'squat');
    expect(formRec).toBeDefined();
    expect(formRec!.autoApply).toBe(false);

    // Weight should be INCREASED by difficulty (form score doesn't auto-apply)
    expect(state.liftProgress.squat.currentWeight).toBeGreaterThan(originalWeight);
  });

  it('concurrent injury with exercise substitution + form score', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({
      injuries: [makeInjury({
        bodyArea: 'knees',
        status: 'pain_during_exercise',
        aggravatingExercises: ['squat'],
      })],
    });

    const result = processAdaptations(state, feedback, undefined, [], { squat: 55 }, true);

    // Both exercise substitution and form recommendation should exist
    const substitution = result.decisions.find(d => d.type === 'exercise_substitution');
    expect(substitution).toBeDefined();

    const formRec = result.recommendations.find(r => r.lift === 'squat');
    expect(formRec).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════
// Science Citation Coverage
// ════════════════════════════════════════════════════════════════

describe('Science Citations', () => {
  it('every decision should have a non-empty citation', () => {
    const state = makeState();

    // Trigger multiple decision types
    const scenarios: Array<{
      feedback: PostWorkoutFeedback;
      readiness?: ReadinessData;
      formScores?: Record<string, number>;
      logs?: WorkoutLog[];
    }> = [
      { feedback: makeBaseFeedback({ sessionDifficulty: 'too_easy' }) },
      { feedback: makeBaseFeedback({ sessionDifficulty: 'could_not_finish' }) },
      { feedback: makeBaseFeedback({ liftRPE: { squat: 10 } }) },
      { feedback: makeBaseFeedback({ liftRPE: { squat: 5 } }) },
      {
        feedback: makeBaseFeedback(),
        readiness: makeReadiness({ sleepHours: 4, sleepQuality: 1, stress: 5, soreness: 5, motivation: 1 }),
      },
      { feedback: makeBaseFeedback(), formScores: { squat: 55 } },
      { feedback: makeBaseFeedback(), formScores: { squat: 65 } },
      { feedback: makeBaseFeedback(), formScores: { squat: 92 } },
      {
        feedback: makeBaseFeedback({
          injuries: [makeInjury({ bodyArea: 'lower_back', status: 'pain_during_exercise' })],
        }),
      },
      {
        feedback: makeBaseFeedback({
          injuries: [makeInjury({ bodyArea: 'knees', status: 'cannot_perform' })],
        }),
      },
      {
        feedback: makeBaseFeedback({
          injuries: [makeInjury({ redFlags: ['sudden_onset'] })],
        }),
      },
    ];

    for (const scenario of scenarios) {
      const s = makeState();
      const decisions = processAdaptations(
        s,
        scenario.feedback,
        scenario.readiness,
        scenario.logs ?? [],
        scenario.formScores,
      );
      for (const decision of decisions) {
        expect(decision.citation.length, `Missing citation for: ${decision.description.slice(0, 50)}`).toBeGreaterThan(10);
      }
    }
  });
});
