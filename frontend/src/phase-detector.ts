/**
 * Generic phase detection for all exercises. Parameterized by
 * the primary angle accessor and exercise-specific thresholds.
 * Eliminates ~400 lines of duplication across 8 exercise files.
 */

import { SquatPhase } from './types';
import type { RepRange } from './types';

export interface PhaseDetectorConfig {
  /** Angle threshold above which the lifter is considered "standing" / at rest */
  standingAngle: number;
  /** Cumulative delta threshold to detect descending movement */
  descendingThreshold: number;
  /** Per-frame velocity threshold below which we consider the bar "stopped" (bottom detection) */
  bottomVelocityThreshold: number;
  /** Cumulative delta threshold to detect ascending movement */
  ascendingThreshold: number;
  /** Minimum frames for a movement to count as a rep */
  minRepFrames: number;
  /** Number of frames in the smoothing window (default 5) */
  smoothingWindow?: number;
  /** Number of frames in the history window for cumulative delta (default 3) */
  historyWindow?: number;
  /**
   * When true, enables the ascending->descending re-descent check
   * (delta < -3) which is useful for real-time webcam analysis.
   */
  liveMode?: boolean;
}

/** Smooth an angle value using a rolling average buffer. */
export function smoothAngle(buffer: number[], newValue: number, windowSize = 5): number {
  buffer.push(newValue);
  if (buffer.length > windowSize) {
    buffer.shift();
  }
  return buffer.reduce((sum, v) => sum + v, 0) / buffer.length;
}

/**
 * Generic phase detector that works for any exercise.
 * The caller provides the angle values; the detector handles
 * phase transitions, rep counting, and rep segmentation.
 */
export class GenericPhaseDetector {
  private phase: SquatPhase = SquatPhase.STANDING;
  private smoothBuffer: number[] = [];
  private smoothedHistory: number[] = [];
  private prevSmoothedAngle: number | null = null;
  private bottomHoldCount = 0;
  private readonly config: Required<Pick<PhaseDetectorConfig,
    'standingAngle' | 'descendingThreshold' | 'bottomVelocityThreshold' |
    'ascendingThreshold' | 'minRepFrames' | 'smoothingWindow' | 'historyWindow' | 'liveMode'>>;

  constructor(config: PhaseDetectorConfig) {
    this.config = {
      standingAngle: config.standingAngle,
      descendingThreshold: config.descendingThreshold,
      bottomVelocityThreshold: config.bottomVelocityThreshold,
      ascendingThreshold: config.ascendingThreshold,
      minRepFrames: config.minRepFrames,
      smoothingWindow: config.smoothingWindow ?? 5,
      historyWindow: config.historyWindow ?? 3,
      liveMode: config.liveMode ?? false,
    };
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
   * Update the phase detector with a new angle reading.
   * @returns The current phase after processing.
   */
  update(angle: number): SquatPhase {
    // Guard against NaN/Infinity poisoning the smoothing buffer
    if (!isFinite(angle)) return this.phase;

    const { standingAngle, descendingThreshold, bottomVelocityThreshold,
            ascendingThreshold, smoothingWindow, historyWindow, liveMode } = this.config;

    const smoothed = smoothAngle(this.smoothBuffer, angle, smoothingWindow);

    // Maintain history window (maxlen = historyWindow + 1)
    this.smoothedHistory.push(smoothed);
    if (this.smoothedHistory.length > historyWindow + 1) {
      this.smoothedHistory.shift();
    }

    const delta = this.prevSmoothedAngle !== null
      ? smoothed - this.prevSmoothedAngle
      : 0;
    const cumDelta = this.cumulativeDelta();

    switch (this.phase) {
      case SquatPhase.STANDING:
        this.bottomHoldCount = 0;
        if (smoothed < standingAngle && cumDelta < -descendingThreshold) {
          this.phase = SquatPhase.DESCENDING;
          this.bottomHoldCount = 0;
        }
        break;

      case SquatPhase.DESCENDING:
        if (Math.abs(delta) < bottomVelocityThreshold) {
          this.bottomHoldCount++;
          if (this.bottomHoldCount >= 2) {
            this.phase = SquatPhase.BOTTOM;
            this.bottomHoldCount = 0;
          }
        } else if (delta > 0) {
          this.phase = SquatPhase.BOTTOM;
          this.bottomHoldCount = 0;
        } else {
          this.bottomHoldCount = 0;
        }
        break;

      case SquatPhase.BOTTOM:
        if (cumDelta > ascendingThreshold) {
          this.phase = SquatPhase.ASCENDING;
        }
        break;

      case SquatPhase.ASCENDING:
        if (smoothed >= standingAngle) {
          this.phase = SquatPhase.STANDING;
        } else if (liveMode && delta < -3) {
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
 * Detect individual reps from a sequence of angles using a GenericPhaseDetector.
 * Returns ranges [start, end] and the index of the bottom (min angle) for each rep.
 */
export function detectRepsGeneric(angles: number[], config: PhaseDetectorConfig): RepRange[] {
  const detector = new GenericPhaseDetector(config);
  const reps: RepRange[] = [];
  let repStart = -1;
  let bottomIdx = -1;
  let minAngleInRep = 180;

  for (let i = 0; i < angles.length; i++) {
    const prevPhase = detector.getCurrentPhase();
    const phase = detector.update(angles[i]);

    // Rep starts when we begin descending
    if (prevPhase === SquatPhase.STANDING && phase === SquatPhase.DESCENDING) {
      repStart = i;
      minAngleInRep = angles[i];
      bottomIdx = i;
    }

    // Track the bottom
    if (repStart >= 0 && (phase === SquatPhase.DESCENDING || phase === SquatPhase.BOTTOM)) {
      if (angles[i] < minAngleInRep) {
        minAngleInRep = angles[i];
        bottomIdx = i;
      }
    }

    // Rep ends when we return to standing
    if (
      prevPhase === SquatPhase.ASCENDING && phase === SquatPhase.STANDING &&
      repStart >= 0
    ) {
      if ((i - repStart) >= config.minRepFrames) {
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
