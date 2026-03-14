/**
 * Squat phase detection and rep counting.
 * Port of Python phases.py to TypeScript.
 * Uses smoothing + history-window cumulative delta to match backend algorithm.
 */

import { SquatPhase } from './types';
import type { RepRange } from './types';

// Thresholds for phase transitions (matched to backend phases.py)
const STANDING_KNEE_ANGLE = 160;
const DESCENDING_THRESHOLD = 2.0;        // cumulative delta to detect descent
const BOTTOM_VELOCITY_THRESHOLD = 1.0;   // synced with backend (was 0.5)
const ASCENDING_THRESHOLD = 2.0;         // cumulative delta to detect ascent
const MIN_REP_FRAMES = 10;
const SMOOTHING_WINDOW = 5;
const HISTORY_WINDOW = 3;                // frames to look back for cumulative delta

// Re-export constants for testing
export {
  STANDING_KNEE_ANGLE,
  DESCENDING_THRESHOLD,
  BOTTOM_VELOCITY_THRESHOLD,
  ASCENDING_THRESHOLD,
  MIN_REP_FRAMES,
  SMOOTHING_WINDOW,
  HISTORY_WINDOW,
};

/**
 * Smooth a knee angle value using a rolling buffer of the last N readings.
 */
function smoothAngle(buffer: number[], newValue: number, windowSize: number): number {
  buffer.push(newValue);
  if (buffer.length > windowSize) {
    buffer.shift();
  }
  return buffer.reduce((sum, v) => sum + v, 0) / buffer.length;
}

/**
 * State machine for detecting squat phases from a stream of knee angles.
 * Uses 5-frame smoothing buffer and history-window cumulative delta for
 * transitions (matches Python backend).
 *
 * @param liveMode When true, enables the ascending->descending re-descent
 *   check (delta < -3) which is useful for real-time webcam analysis but
 *   not part of the backend's post-processing algorithm.
 */
export class PhaseDetector {
  private phase: SquatPhase = SquatPhase.STANDING;
  private smoothBuffer: number[] = [];
  private smoothedHistory: number[] = [];  // matches backend _smoothed_history
  private prevSmoothedAngle: number | null = null;
  private bottomHoldCount = 0;
  private liveMode: boolean;

  constructor(liveMode = false) {
    this.liveMode = liveMode;
  }

  reset(): void {
    this.phase = SquatPhase.STANDING;
    this.smoothBuffer = [];
    this.smoothedHistory = [];
    this.prevSmoothedAngle = null;
    this.bottomHoldCount = 0;
  }

  /**
   * Compute cumulative delta over the history window.
   * Matches backend: smoothed_history[-1] - smoothed_history[0]
   */
  private cumulativeDelta(): number {
    if (this.smoothedHistory.length < 2) return 0;
    return this.smoothedHistory[this.smoothedHistory.length - 1] - this.smoothedHistory[0];
  }

  /**
   * Update the phase detector with a new knee angle reading.
   * @returns The current phase after processing.
   */
  update(kneeAngle: number): SquatPhase {
    const smoothed = smoothAngle(this.smoothBuffer, kneeAngle, SMOOTHING_WINDOW);

    // Maintain history window (maxlen = HISTORY_WINDOW + 1)
    this.smoothedHistory.push(smoothed);
    if (this.smoothedHistory.length > HISTORY_WINDOW + 1) {
      this.smoothedHistory.shift();
    }

    const delta = this.prevSmoothedAngle !== null
      ? smoothed - this.prevSmoothedAngle
      : 0;
    const cumDelta = this.cumulativeDelta();

    switch (this.phase) {
      case SquatPhase.STANDING:
        this.bottomHoldCount = 0;
        // Use cumulative delta over the history window for robust detection
        if (smoothed < STANDING_KNEE_ANGLE && cumDelta < -DESCENDING_THRESHOLD) {
          this.phase = SquatPhase.DESCENDING;
          this.bottomHoldCount = 0;
        }
        break;

      case SquatPhase.DESCENDING:
        // Transition to bottom: velocity near zero or angle starts increasing
        if (Math.abs(delta) < BOTTOM_VELOCITY_THRESHOLD) {
          this.bottomHoldCount++;
          if (this.bottomHoldCount >= 2) {
            this.phase = SquatPhase.BOTTOM;
            this.bottomHoldCount = 0;
          }
        } else if (delta > 0) {
          // Angle started increasing -- we passed the bottom
          this.phase = SquatPhase.BOTTOM;
          this.bottomHoldCount = 0;
        } else {
          this.bottomHoldCount = 0;
        }
        break;

      case SquatPhase.BOTTOM:
        // Use cumulative delta over history window for ascending detection
        if (cumDelta > ASCENDING_THRESHOLD) {
          this.phase = SquatPhase.ASCENDING;
        }
        break;

      case SquatPhase.ASCENDING:
        // Standing (rep complete): smoothed angle >= STANDING_KNEE_ANGLE
        if (smoothed >= STANDING_KNEE_ANGLE) {
          this.phase = SquatPhase.STANDING;
        } else if (this.liveMode && delta < -3) {
          // Live mode only: going back down -- re-entering descent
          this.phase = SquatPhase.DESCENDING;
          this.bottomHoldCount = 0;
        }
        break;
    }

    this.prevSmoothedAngle = smoothed;
    return this.phase;
  }

  getCurrentPhase(): SquatPhase {
    return this.phase;
  }
}

/**
 * Detect individual reps from a sequence of knee angles.
 * Returns ranges [start, end] and the index of the bottom (min angle) for each rep.
 */
export function detectReps(kneeAngles: number[]): RepRange[] {
  const detector = new PhaseDetector();
  const reps: RepRange[] = [];
  let repStart = -1;
  let bottomIdx = -1;
  let minAngleInRep = 180;

  for (let i = 0; i < kneeAngles.length; i++) {
    const prevPhase = detector.getCurrentPhase();
    const phase = detector.update(kneeAngles[i]);

    // Rep starts when we begin descending
    if (prevPhase === SquatPhase.STANDING && phase === SquatPhase.DESCENDING) {
      repStart = i;
      minAngleInRep = kneeAngles[i];
      bottomIdx = i;
    }

    // Track the bottom
    if (
      repStart >= 0 &&
      (phase === SquatPhase.DESCENDING || phase === SquatPhase.BOTTOM)
    ) {
      if (kneeAngles[i] < minAngleInRep) {
        minAngleInRep = kneeAngles[i];
        bottomIdx = i;
      }
    }

    // Rep ends when we return to standing
    if (
      (prevPhase === SquatPhase.ASCENDING && phase === SquatPhase.STANDING) &&
      repStart >= 0
    ) {
      // Enforce minimum rep frames
      if ((i - repStart) >= MIN_REP_FRAMES) {
        reps.push({
          start: repStart,
          end: i,
          bottomIndex: bottomIdx,
        });
      }
      repStart = -1;
      bottomIdx = -1;
      minAngleInRep = 180;
    }
  }

  return reps;
}

/**
 * Get the phase for every frame in a knee angle sequence.
 */
export function getPhases(kneeAngles: number[]): SquatPhase[] {
  const detector = new PhaseDetector();
  return kneeAngles.map((angle) => detector.update(angle));
}
