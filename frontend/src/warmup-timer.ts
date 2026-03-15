/**
 * Warmup timer engine for guided countdown warmup sessions.
 * Manages step-by-step countdown with pause/resume/skip/stop controls.
 */

import type { WarmUpStep } from './types';

export interface TimerState {
  currentStepIndex: number;
  timeRemaining: number; // seconds
  totalSteps: number;
  isRunning: boolean;
  isPaused: boolean;
  currentStep: WarmUpStep;
}

/** Default duration in seconds when a WarmUpStep has no durationSeconds. */
const DEFAULT_DURATION_SECONDS = 30;

/**
 * Parse a duration string like "5 min", "2 min", "3-5 min" into seconds.
 * Falls back to DEFAULT_DURATION_SECONDS if unparseable.
 */
export function parseDurationString(duration: string): number {
  const match = duration.match(/(\d+)/);
  if (match) {
    return parseInt(match[1], 10) * 60;
  }
  return DEFAULT_DURATION_SECONDS;
}

/** Get the effective duration in seconds for a WarmUpStep. */
export function getStepDuration(step: WarmUpStep): number {
  if (step.durationSeconds != null && step.durationSeconds > 0) {
    return step.durationSeconds;
  }
  return parseDurationString(step.duration);
}

export interface WarmupTimerCallbacks {
  onTick: (state: TimerState) => void;
  onStepChange: (step: WarmUpStep, index: number) => void;
  onComplete: () => void;
}

export class WarmupTimer {
  private steps: WarmUpStep[];
  private currentStepIndex: number = 0;
  private timeRemaining: number = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _isRunning: boolean = false;
  private _isPaused: boolean = false;
  private onTick: (state: TimerState) => void;
  private onStepChange: (step: WarmUpStep, index: number) => void;
  private onComplete: () => void;

  constructor(steps: WarmUpStep[], callbacks: WarmupTimerCallbacks) {
    this.steps = steps;
    this.onTick = callbacks.onTick;
    this.onStepChange = callbacks.onStepChange;
    this.onComplete = callbacks.onComplete;
  }

  start(): void {
    if (this.steps.length === 0) {
      this.onComplete();
      return;
    }

    this.currentStepIndex = 0;
    this.timeRemaining = getStepDuration(this.steps[0]);
    this._isRunning = true;
    this._isPaused = false;

    this.onStepChange(this.steps[0], 0);
    this.onTick(this.getState());
    this.startInterval();
  }

  pause(): void {
    if (!this._isRunning || this._isPaused) return;
    this._isPaused = true;
    this.clearInterval();
    this.onTick(this.getState());
  }

  resume(): void {
    if (!this._isRunning || !this._isPaused) return;
    this._isPaused = false;
    this.startInterval();
    this.onTick(this.getState());
  }

  skip(): void {
    if (!this._isRunning) return;
    this.advanceStep();
  }

  stop(): void {
    this.clearInterval();
    this._isRunning = false;
    this._isPaused = false;
    this.onTick(this.getState());
  }

  getState(): TimerState {
    return {
      currentStepIndex: this.currentStepIndex,
      timeRemaining: this.timeRemaining,
      totalSteps: this.steps.length,
      isRunning: this._isRunning,
      isPaused: this._isPaused,
      currentStep: this.steps[this.currentStepIndex] ?? this.steps[0],
    };
  }

  private startInterval(): void {
    this.clearInterval();
    this.intervalId = setInterval(() => {
      this.tick();
    }, 1000);
  }

  private clearInterval(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private tick(): void {
    if (this._isPaused) return;

    this.timeRemaining--;
    this.onTick(this.getState());

    if (this.timeRemaining <= 0) {
      this.advanceStep();
    }
  }

  private advanceStep(): void {
    this.currentStepIndex++;

    if (this.currentStepIndex >= this.steps.length) {
      // All steps complete
      this.clearInterval();
      this._isRunning = false;
      this._isPaused = false;
      this.onComplete();
      return;
    }

    this.timeRemaining = getStepDuration(this.steps[this.currentStepIndex]);
    this.onStepChange(this.steps[this.currentStepIndex], this.currentStepIndex);
    this.onTick(this.getState());

    // Restart interval if it was stopped (e.g. after skip while paused)
    if (!this._isPaused && this.intervalId === null) {
      this.startInterval();
    }
  }
}
