import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WarmupTimer, getStepDuration, parseDurationString } from '../warmup-timer';
import type { TimerState } from '../warmup-timer';
import type { WarmUpStep } from '../types';

// ── Helpers ──

function makeStep(overrides: Partial<WarmUpStep> = {}): WarmUpStep {
  return {
    name: 'Test Step',
    description: 'A test warm-up step',
    duration: '2 min',
    purpose: 'Testing',
    ...overrides,
  };
}

function makeCallbacks() {
  return {
    onTick: vi.fn(),
    onStepChange: vi.fn(),
    onComplete: vi.fn(),
  };
}

// ── parseDurationString ──

describe('parseDurationString', () => {
  it('parses "5 min" to 300 seconds', () => {
    expect(parseDurationString('5 min')).toBe(300);
  });

  it('parses "2 min" to 120 seconds', () => {
    expect(parseDurationString('2 min')).toBe(120);
  });

  it('parses "3-5 min" to 180 seconds (first number)', () => {
    expect(parseDurationString('3-5 min')).toBe(180);
  });

  it('returns default 30 for unparseable strings', () => {
    expect(parseDurationString('some time')).toBe(30);
  });
});

// ── getStepDuration ──

describe('getStepDuration', () => {
  it('uses durationSeconds when provided', () => {
    const step = makeStep({ durationSeconds: 45 });
    expect(getStepDuration(step)).toBe(45);
  });

  it('falls back to parsing duration string when durationSeconds not set', () => {
    const step = makeStep({ duration: '3 min' });
    expect(getStepDuration(step)).toBe(180);
  });

  it('falls back to parsing when durationSeconds is 0', () => {
    const step = makeStep({ durationSeconds: 0, duration: '2 min' });
    expect(getStepDuration(step)).toBe(120);
  });

  it('falls back to parsing when durationSeconds is undefined', () => {
    const step = makeStep({ durationSeconds: undefined, duration: '1 min' });
    expect(getStepDuration(step)).toBe(60);
  });
});

// ── WarmupTimer ──

describe('WarmupTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onComplete immediately for empty steps', () => {
    const cbs = makeCallbacks();
    const timer = new WarmupTimer([], cbs);
    timer.start();
    expect(cbs.onComplete).toHaveBeenCalledTimes(1);
    expect(cbs.onTick).not.toHaveBeenCalled();
    expect(cbs.onStepChange).not.toHaveBeenCalled();
  });

  it('starts with the first step and fires onStepChange', () => {
    const steps = [makeStep({ name: 'Step A', durationSeconds: 10 })];
    const cbs = makeCallbacks();
    const timer = new WarmupTimer(steps, cbs);
    timer.start();

    expect(cbs.onStepChange).toHaveBeenCalledTimes(1);
    expect(cbs.onStepChange).toHaveBeenCalledWith(steps[0], 0);
  });

  it('fires onTick on start with correct initial state', () => {
    const steps = [makeStep({ name: 'Step A', durationSeconds: 10 })];
    const cbs = makeCallbacks();
    const timer = new WarmupTimer(steps, cbs);
    timer.start();

    expect(cbs.onTick).toHaveBeenCalledTimes(1);
    const state: TimerState = cbs.onTick.mock.calls[0][0];
    expect(state.currentStepIndex).toBe(0);
    expect(state.timeRemaining).toBe(10);
    expect(state.totalSteps).toBe(1);
    expect(state.isRunning).toBe(true);
    expect(state.isPaused).toBe(false);
  });

  it('counts down each second', () => {
    const steps = [makeStep({ durationSeconds: 5 })];
    const cbs = makeCallbacks();
    const timer = new WarmupTimer(steps, cbs);
    timer.start();

    // Initial tick
    expect(cbs.onTick).toHaveBeenCalledTimes(1);

    // Advance 1 second
    vi.advanceTimersByTime(1000);
    expect(cbs.onTick).toHaveBeenCalledTimes(2);
    const state: TimerState = cbs.onTick.mock.calls[1][0];
    expect(state.timeRemaining).toBe(4);
  });

  it('transitions to next step when time runs out', () => {
    const steps = [
      makeStep({ name: 'Step 1', durationSeconds: 3 }),
      makeStep({ name: 'Step 2', durationSeconds: 5 }),
    ];
    const cbs = makeCallbacks();
    const timer = new WarmupTimer(steps, cbs);
    timer.start();

    // Advance through all of step 1 (3 seconds)
    vi.advanceTimersByTime(3000);

    // onStepChange should have been called for step 2
    expect(cbs.onStepChange).toHaveBeenCalledTimes(2);
    expect(cbs.onStepChange).toHaveBeenCalledWith(steps[1], 1);
  });

  it('calls onComplete after the last step finishes', () => {
    const steps = [makeStep({ durationSeconds: 2 })];
    const cbs = makeCallbacks();
    const timer = new WarmupTimer(steps, cbs);
    timer.start();

    // Advance through full duration
    vi.advanceTimersByTime(2000);

    expect(cbs.onComplete).toHaveBeenCalledTimes(1);
  });

  it('pause stops countdown, resume restarts it', () => {
    const steps = [makeStep({ durationSeconds: 10 })];
    const cbs = makeCallbacks();
    const timer = new WarmupTimer(steps, cbs);
    timer.start();

    // Advance 2 seconds
    vi.advanceTimersByTime(2000);
    const afterTwo: TimerState = cbs.onTick.mock.calls[cbs.onTick.mock.calls.length - 1][0];
    expect(afterTwo.timeRemaining).toBe(8);

    // Pause
    timer.pause();
    const pauseState = timer.getState();
    expect(pauseState.isPaused).toBe(true);
    expect(pauseState.isRunning).toBe(true);

    // Advance 5 seconds while paused — time should not change
    const tickCountBeforePause = cbs.onTick.mock.calls.length;
    vi.advanceTimersByTime(5000);
    // No additional countdown ticks (interval is cleared)
    expect(timer.getState().timeRemaining).toBe(8);

    // Resume
    timer.resume();
    expect(timer.getState().isPaused).toBe(false);

    // Advance 1 second
    vi.advanceTimersByTime(1000);
    expect(timer.getState().timeRemaining).toBe(7);
  });

  it('skip advances to the next step immediately', () => {
    const steps = [
      makeStep({ name: 'Step 1', durationSeconds: 60 }),
      makeStep({ name: 'Step 2', durationSeconds: 30 }),
    ];
    const cbs = makeCallbacks();
    const timer = new WarmupTimer(steps, cbs);
    timer.start();

    // Skip step 1
    timer.skip();
    expect(cbs.onStepChange).toHaveBeenCalledWith(steps[1], 1);
    expect(timer.getState().currentStepIndex).toBe(1);
    expect(timer.getState().timeRemaining).toBe(30);
  });

  it('skip on last step triggers onComplete', () => {
    const steps = [makeStep({ durationSeconds: 60 })];
    const cbs = makeCallbacks();
    const timer = new WarmupTimer(steps, cbs);
    timer.start();

    timer.skip();
    expect(cbs.onComplete).toHaveBeenCalledTimes(1);
  });

  it('stop terminates the timer', () => {
    const steps = [makeStep({ durationSeconds: 60 })];
    const cbs = makeCallbacks();
    const timer = new WarmupTimer(steps, cbs);
    timer.start();

    timer.stop();
    const state = timer.getState();
    expect(state.isRunning).toBe(false);
    expect(state.isPaused).toBe(false);

    // Advancing time should not trigger more ticks after stop
    const tickCount = cbs.onTick.mock.calls.length;
    vi.advanceTimersByTime(5000);
    expect(cbs.onTick.mock.calls.length).toBe(tickCount);
  });

  it('getState returns current timer state', () => {
    const steps = [
      makeStep({ name: 'A', durationSeconds: 10 }),
      makeStep({ name: 'B', durationSeconds: 20 }),
    ];
    const cbs = makeCallbacks();
    const timer = new WarmupTimer(steps, cbs);
    timer.start();

    const state = timer.getState();
    expect(state.currentStepIndex).toBe(0);
    expect(state.totalSteps).toBe(2);
    expect(state.isRunning).toBe(true);
    expect(state.currentStep.name).toBe('A');
  });

  it('handles single step that completes', () => {
    const steps = [makeStep({ durationSeconds: 1 })];
    const cbs = makeCallbacks();
    const timer = new WarmupTimer(steps, cbs);
    timer.start();

    vi.advanceTimersByTime(1000);
    expect(cbs.onComplete).toHaveBeenCalledTimes(1);
  });

  it('handles multiple steps sequentially', () => {
    const steps = [
      makeStep({ name: 'A', durationSeconds: 2 }),
      makeStep({ name: 'B', durationSeconds: 2 }),
      makeStep({ name: 'C', durationSeconds: 2 }),
    ];
    const cbs = makeCallbacks();
    const timer = new WarmupTimer(steps, cbs);
    timer.start();

    // Complete step A
    vi.advanceTimersByTime(2000);
    expect(cbs.onStepChange).toHaveBeenCalledWith(steps[1], 1);

    // Complete step B
    vi.advanceTimersByTime(2000);
    expect(cbs.onStepChange).toHaveBeenCalledWith(steps[2], 2);

    // Complete step C
    vi.advanceTimersByTime(2000);
    expect(cbs.onComplete).toHaveBeenCalledTimes(1);
  });

  it('pause before start has no effect', () => {
    const steps = [makeStep({ durationSeconds: 10 })];
    const cbs = makeCallbacks();
    const timer = new WarmupTimer(steps, cbs);

    // pause before start should not crash
    timer.pause();
    expect(timer.getState().isPaused).toBe(false);
  });

  it('resume before pause has no effect', () => {
    const steps = [makeStep({ durationSeconds: 10 })];
    const cbs = makeCallbacks();
    const timer = new WarmupTimer(steps, cbs);
    timer.start();

    // resume when not paused should be a no-op
    timer.resume();
    expect(timer.getState().isPaused).toBe(false);
    expect(timer.getState().isRunning).toBe(true);
  });

  it('skip when not running has no effect', () => {
    const steps = [makeStep({ durationSeconds: 10 })];
    const cbs = makeCallbacks();
    const timer = new WarmupTimer(steps, cbs);

    // skip before start — no crash, no callbacks
    timer.skip();
    expect(cbs.onStepChange).not.toHaveBeenCalled();
    expect(cbs.onComplete).not.toHaveBeenCalled();
  });

  it('stop fires onTick with isRunning=false', () => {
    const steps = [makeStep({ durationSeconds: 10 })];
    const cbs = makeCallbacks();
    const timer = new WarmupTimer(steps, cbs);
    timer.start();

    timer.stop();
    const lastCall = cbs.onTick.mock.calls[cbs.onTick.mock.calls.length - 1][0];
    expect(lastCall.isRunning).toBe(false);
  });

  it('uses parsed duration string when durationSeconds is not set', () => {
    const steps = [makeStep({ duration: '1 min' })];  // no durationSeconds
    const cbs = makeCallbacks();
    const timer = new WarmupTimer(steps, cbs);
    timer.start();

    const state = timer.getState();
    expect(state.timeRemaining).toBe(60);
  });
});
