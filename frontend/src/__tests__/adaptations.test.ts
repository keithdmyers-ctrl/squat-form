/**
 * Tests for the auto-adaptive feedback system.
 * Validates that the tool automatically adjusts plans based on:
 * - Session difficulty feedback (too easy / just right / too hard / couldn't finish)
 * - Per-lift RPE
 * - Injury reports
 * - Form scores from CV analysis
 * - Readiness data
 * - Accumulated fatigue detection
 * - Phase advancement
 * - Program transitions
 */

import { describe, it, expect } from 'vitest';
import {
  initializeProgram,
  processAdaptations,
  roundToPlate,
  getRecentFormScores,
  getRecentWeakDimensions,
} from '../program-generator';
import type {
  ProgramState,
  PostWorkoutFeedback,
  ReadinessData,
  WorkoutLog,
  AdaptationDecision,
} from '../program-generator';
import type { UserProfile } from '../workout-programs';

// ─── Test Helpers ───

function makeState(programId = 'starting_strength'): ProgramState {
  const profile: UserProfile = {
    experienceLevel: 'beginner',
    daysPerWeek: 3,
    equipment: 'barbell_home',
    goal: 'strength',
    maxes: { squat: 200, bench: 150, deadlift: 250, ohp: 100 },
  };
  return initializeProgram(programId, profile);
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

// ─── Session Difficulty Tests ───

describe('Session Difficulty Feedback', () => {
  it('should increase weights when session is "too easy"', () => {
    const state = makeState();
    const originalSquatWeight = state.liftProgress.squat.currentWeight;
    const feedback = makeBaseFeedback({ sessionDifficulty: 'too_easy' });

    const decisions = processAdaptations(state, feedback, undefined, [], undefined);

    // Should have a weight increase decision
    const increase = decisions.find(d => d.type === 'weight_increase');
    expect(increase).toBeDefined();
    expect(increase!.applied).toBe(true);
    expect(increase!.citation).toContain('Progressive overload');

    // Squat weight should have increased
    expect(state.liftProgress.squat.currentWeight).toBeGreaterThan(originalSquatWeight);
  });

  it('should not reduce weights on first "too hard" session', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;
    const feedback = makeBaseFeedback({ sessionDifficulty: 'too_hard' });

    const decisions = processAdaptations(state, feedback, undefined, [], undefined);

    // Should be informational, not applied
    const info = decisions.find(d => d.type === 'info' && d.description.includes('too hard'));
    expect(info).toBeDefined();
    expect(state.liftProgress.squat.currentWeight).toBe(originalWeight);
  });

  it('should force deload when "could not finish"', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;
    const feedback = makeBaseFeedback({ sessionDifficulty: 'could_not_finish' });

    const decisions = processAdaptations(state, feedback, undefined, [], undefined);

    const deload = decisions.find(d => d.type === 'force_deload');
    expect(deload).toBeDefined();
    expect(deload!.applied).toBe(true);
    // Weight should be reduced by 10%
    expect(state.liftProgress.squat.currentWeight).toBe(
      roundToPlate(originalWeight * 0.9, 'lbs')
    );
  });

  it('should make no changes on "just right"', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;
    const feedback = makeBaseFeedback({ sessionDifficulty: 'just_right' });

    const decisions = processAdaptations(state, feedback, undefined, [], undefined);

    // No difficulty-based decisions
    const difficultyDecisions = decisions.filter(d =>
      d.type === 'weight_increase' || d.type === 'weight_decrease' || d.type === 'force_deload'
    );
    expect(difficultyDecisions.length).toBe(0);
    expect(state.liftProgress.squat.currentWeight).toBe(originalWeight);
  });
});

// ─── Per-Lift RPE Tests ───

describe('Per-Lift RPE Autoregulation', () => {
  it('should increase weight when RPE is very low (≤6)', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;
    const feedback = makeBaseFeedback({
      liftRPE: { squat: 5 },
    });

    const decisions = processAdaptations(state, feedback, undefined, [], undefined);

    const increase = decisions.find(d => d.type === 'weight_increase' && d.lift === 'squat');
    expect(increase).toBeDefined();
    expect(increase!.applied).toBe(true);
    expect(increase!.citation).toContain('Zourdos');
    expect(state.liftProgress.squat.currentWeight).toBeGreaterThan(originalWeight);
  });

  it('should warn about RPE 10 (max effort)', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({
      liftRPE: { squat: 10 },
    });

    const decisions = processAdaptations(state, feedback, undefined, [], undefined);

    const warning = decisions.find(d => d.type === 'info' && d.lift === 'squat' && d.description.includes('RPE 10'));
    expect(warning).toBeDefined();
    expect(warning!.citation).toContain('Tuchscherer');
  });
});

// ─── Injury Handling Tests ───

describe('Injury Handling', () => {
  it('should recommend exercise substitution for pain during exercise', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({
      injuries: [{
        bodyArea: 'lower_back',
        status: 'pain_during_exercise',
        aggravatingExercises: ['squat'],
      }],
    });

    const decisions = processAdaptations(state, feedback, undefined, [], undefined);

    const substitution = decisions.find(d => d.type === 'exercise_substitution');
    expect(substitution).toBeDefined();
    expect(substitution!.description).toContain('Lower back');
    expect(substitution!.description).toContain('squat');
    expect(substitution!.citation).toContain('ACSM');
  });

  it('should reduce volume for "cannot perform" injury', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({
      injuries: [{
        bodyArea: 'knees',
        status: 'cannot_perform',
        aggravatingExercises: ['squat', 'lunge'],
      }],
    });

    const decisions = processAdaptations(state, feedback, undefined, [], undefined);

    // Should have both substitution and volume decrease
    const sub = decisions.find(d => d.type === 'exercise_substitution');
    const vol = decisions.find(d => d.type === 'volume_decrease');
    expect(sub).toBeDefined();
    expect(vol).toBeDefined();
    expect(vol!.applied).toBe(true);
    expect(vol!.citation).toContain('ACSM');
  });

  it('should monitor minor discomfort without immediate changes', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({
      injuries: [{
        bodyArea: 'shoulders',
        status: 'minor_discomfort',
        aggravatingExercises: ['ohp'],
      }],
    });

    const decisions = processAdaptations(state, feedback, undefined, [], undefined);

    const monitor = decisions.find(d => d.type === 'info' && d.description.includes('Monitoring'));
    expect(monitor).toBeDefined();
    expect(monitor!.description).toContain('3+ sessions');
    expect(monitor!.citation).toContain('Grandou');
  });
});

// ─── Form Score Integration Tests ───

describe('Form Score Autoregulation', () => {
  it('should recommend (not auto-apply) weight reduction on very low form score (<60)', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;
    const feedback = makeBaseFeedback();

    const decisions = processAdaptations(state, feedback, undefined, [], { squat: 55 });

    const decrease = decisions.find(d => d.type === 'weight_decrease' && d.lift === 'squat');
    expect(decrease).toBeDefined();
    // Form-score reductions are now recommendations, not auto-applied
    expect(decrease!.applied).toBe(false);
    expect(decrease!.description).toContain('-12%');
    expect(decrease!.citation).toContain('Helms');
    // Weight should NOT be auto-reduced — it's a recommendation
    expect(state.liftProgress.squat.currentWeight).toBe(originalWeight);
  });

  it('should recommend (not auto-apply) weight reduction on low form score (60-69)', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;
    const feedback = makeBaseFeedback();

    const decisions = processAdaptations(state, feedback, undefined, [], { squat: 65 });

    const decrease = decisions.find(d => d.type === 'weight_decrease' && d.lift === 'squat');
    expect(decrease).toBeDefined();
    expect(decrease!.description).toContain('-8%');
    // Weight should NOT be auto-reduced — it's a recommendation
    expect(state.liftProgress.squat.currentWeight).toBe(originalWeight);
  });

  it('should confirm good form scores without changes', () => {
    const state = makeState();
    const originalWeight = state.liftProgress.squat.currentWeight;
    const feedback = makeBaseFeedback();

    const decisions = processAdaptations(state, feedback, undefined, [], { squat: 92 });

    const info = decisions.find(d => d.type === 'info' && d.lift === 'squat');
    expect(info).toBeDefined();
    expect(info!.description).toContain('excellent');
    expect(state.liftProgress.squat.currentWeight).toBe(originalWeight);
  });
});

// ─── Readiness Tests ───

describe('Readiness-Based Autoregulation', () => {
  it('should suggest light session on very low readiness', () => {
    const state = makeState();
    const readiness = makeReadiness({
      sleepHours: 4,
      sleepQuality: 1,
      stress: 5,
      soreness: 4,
      motivation: 1,
    });
    const feedback = makeBaseFeedback();

    const decisions = processAdaptations(state, feedback, readiness, [], undefined);

    const volumeDecrease = decisions.find(d => d.type === 'volume_decrease');
    expect(volumeDecrease).toBeDefined();
    expect(volumeDecrease!.description).toContain('Low readiness');
    expect(volumeDecrease!.citation).toContain('PMC10511399');
  });

  it('should warn about low sleep', () => {
    const state = makeState();
    const readiness = makeReadiness({ sleepHours: 5 });
    const feedback = makeBaseFeedback();

    const decisions = processAdaptations(state, feedback, readiness, [], undefined);

    const sleepWarning = decisions.find(d => d.description.includes('Sleep'));
    expect(sleepWarning).toBeDefined();
    expect(sleepWarning!.citation).toContain('Milewski');
  });

  it('should warn about severe soreness', () => {
    const state = makeState();
    const readiness = makeReadiness({ soreness: 4 });
    const feedback = makeBaseFeedback();

    const decisions = processAdaptations(state, feedback, readiness, [], undefined);

    const sorenessWarning = decisions.find(d => d.description.includes('Soreness level'));
    expect(sorenessWarning).toBeDefined();
    expect(sorenessWarning!.citation).toContain('Cheung');
  });

  it('should not trigger warnings on good readiness', () => {
    const state = makeState();
    const readiness = makeReadiness(); // defaults are all good
    const feedback = makeBaseFeedback();

    const decisions = processAdaptations(state, feedback, readiness, [], undefined);

    const readinessDecisions = decisions.filter(d =>
      d.description.includes('readiness') || d.description.includes('Sleep') || d.description.includes('Soreness level')
    );
    expect(readinessDecisions.length).toBe(0);
  });
});

// ─── Forced Deload Detection Tests ───

describe('Forced Deload Detection', () => {
  it('should force deload when multiple fatigue signals accumulate', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({
      sessionDifficulty: 'too_hard',
      sessionRPE: 9.5,
      soreness: 'severe',
    });

    // Create recent logs with high RPE
    const logs = makeLogs(5, {
      sets: [
        { exerciseName: 'Squat', exerciseSlot: 'squat', setNumber: 1, targetReps: '5', targetWeight: 200, rpe: 9.5, completed: true },
      ],
      readiness: { sleepHours: 6, sleepQuality: 2, stress: 4, soreness: 4, motivation: 2 },
    });

    const decisions = processAdaptations(state, feedback, undefined, logs, undefined);

    const forceDeload = decisions.find(d => d.type === 'force_deload' && d.description.includes('Accumulated fatigue'));
    expect(forceDeload).toBeDefined();
    expect(forceDeload!.applied).toBe(true);
    expect(forceDeload!.citation).toContain('PMC10948666');
  });

  it('should not force deload on a single bad session', () => {
    const state = makeState();
    const feedback = makeBaseFeedback({
      sessionDifficulty: 'too_hard',
      sessionRPE: 8,
      soreness: 'mild',
    });

    const decisions = processAdaptations(state, feedback, undefined, makeLogs(1), undefined);

    const forceDeload = decisions.filter(d => d.type === 'force_deload' && d.description.includes('Accumulated fatigue'));
    expect(forceDeload.length).toBe(0);
  });
});

// ─── Phase Advancement Tests ───

describe('Phase Advancement', () => {
  it('should advance block periodization from hypertrophy to strength at week 5', () => {
    const profile: UserProfile = {
      experienceLevel: 'advanced',
      daysPerWeek: 4,
      equipment: 'barbell_home',
      goal: 'powerlifting',
      maxes: { squat: 400, bench: 300, deadlift: 500, ohp: 200 },
    };
    const state = initializeProgram('block_periodization', profile);
    state.currentWeek = 5; // End of hypertrophy block

    const feedback = makeBaseFeedback();
    const decisions = processAdaptations(state, feedback, undefined, [], undefined);

    const advance = decisions.find(d => d.type === 'phase_advance');
    expect(advance).toBeDefined();
    expect(advance!.description).toContain('Strength block');
    expect(advance!.citation).toContain('Issurin');
  });

  it('should recommend program transition when past max duration', () => {
    const state = makeState();
    state.currentWeek = 40; // Way past SS typical max of 36 weeks

    const feedback = makeBaseFeedback();
    const decisions = processAdaptations(state, feedback, undefined, [], undefined);

    const transition = decisions.find(d => d.type === 'program_transition');
    expect(transition).toBeDefined();
    expect(transition!.description).toContain('40 weeks');
    expect(transition!.citation).toContain('Zatsiorsky');
  });
});

// ─── Science Citations Tests ───

describe('Science Citations', () => {
  it('every adaptation decision should have a non-empty citation', () => {
    const state = makeState();

    // Trigger multiple different adaptation types
    const scenarios: Array<[PostWorkoutFeedback, ReadinessData | undefined, Record<string, number> | undefined]> = [
      [makeBaseFeedback({ sessionDifficulty: 'too_easy' }), undefined, undefined],
      [makeBaseFeedback({ sessionDifficulty: 'could_not_finish' }), undefined, undefined],
      [makeBaseFeedback({ liftRPE: { squat: 10 } }), undefined, undefined],
      [makeBaseFeedback(), makeReadiness({ sleepHours: 4, sleepQuality: 1, stress: 5, soreness: 5, motivation: 1 }), undefined],
      [makeBaseFeedback(), undefined, { squat: 55 }],
      [makeBaseFeedback({
        injuries: [{ bodyArea: 'lower_back', status: 'pain_during_exercise', aggravatingExercises: ['squat'] }],
      }), undefined, undefined],
    ];

    for (const [feedback, readiness, formScores] of scenarios) {
      // Re-initialize state for each scenario
      const s = makeState();
      const decisions = processAdaptations(s, feedback, readiness, [], formScores);
      for (const decision of decisions) {
        expect(decision.citation.length).toBeGreaterThan(10);
      }
    }
  });
});

// ─── Integration: Full Adaptive Cycle ───

describe('Full Adaptive Cycle', () => {
  it('should grow the plan with a beginner lifter over multiple sessions', () => {
    const state = makeState();
    const initialSquatWeight = state.liftProgress.squat.currentWeight;

    // Session 1: Too easy → weights go up
    let decisions = processAdaptations(
      state,
      makeBaseFeedback({ sessionDifficulty: 'too_easy' }),
      makeReadiness(),
      [],
      { squat: 88 },
    );
    expect(state.liftProgress.squat.currentWeight).toBeGreaterThan(initialSquatWeight);
    const afterEasyWeight = state.liftProgress.squat.currentWeight;

    // Session 2: Just right with good form → no change
    decisions = processAdaptations(
      state,
      makeBaseFeedback({ sessionDifficulty: 'just_right', sessionRPE: 8 }),
      makeReadiness(),
      [],
      { squat: 85 },
    );
    expect(state.liftProgress.squat.currentWeight).toBe(afterEasyWeight);

    // Session 3: Form breaks down → weight reduction RECOMMENDED (not auto-applied)
    decisions = processAdaptations(
      state,
      makeBaseFeedback({ sessionDifficulty: 'just_right' }),
      makeReadiness(),
      [],
      { squat: 58 },
    );
    // Form-score reductions are recommendations, not auto-applied
    const formDecision = decisions.find(d => d.type === 'weight_decrease' && d.lift === 'squat');
    expect(formDecision).toBeDefined();
    expect(formDecision!.applied).toBe(false);
    // Weight stays the same until user confirms the recommendation
    expect(state.liftProgress.squat.currentWeight).toBe(afterEasyWeight);
    const afterFormSessionWeight = state.liftProgress.squat.currentWeight;

    // Session 4: Knee pain → substitution recommended
    decisions = processAdaptations(
      state,
      makeBaseFeedback({
        injuries: [{ bodyArea: 'knees', status: 'pain_during_exercise', aggravatingExercises: ['squat'] }],
      }),
      makeReadiness(),
      [],
      undefined,
    );
    expect(decisions.some(d => d.type === 'exercise_substitution')).toBe(true);

    // Session 5: Couldn't finish → forced deload
    decisions = processAdaptations(
      state,
      makeBaseFeedback({ sessionDifficulty: 'could_not_finish' }),
      makeReadiness({ sleepHours: 5, sleepQuality: 2, stress: 4, soreness: 4, motivation: 2 }),
      [],
      undefined,
    );
    expect(decisions.some(d => d.type === 'force_deload')).toBe(true);
    expect(state.liftProgress.squat.currentWeight).toBeLessThan(afterFormSessionWeight);
  });
});
