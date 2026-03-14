/**
 * Temporal landmark smoothing using a One Euro Filter.
 * Adaptively adjusts smoothing based on movement speed:
 * less jitter when standing still, less lag during fast movements.
 * Causal (uses only past frames) so it works in both upload and live modes.
 *
 * Reference: Casiez, Roussel, Vogel, "1euro Filter: A Simple Speed-based
 * Low-pass Filter for Noisy Input in Interactive Systems", CHI 2012.
 */

import type { Landmarks, Point } from './types';

/** One Euro Filter for a single scalar value. */
class OneEuroScalar {
  private freq: number;
  private mincutoff: number;
  private beta: number;
  private dcutoff: number;

  private xPrev: number | null = null;
  private dxPrev: number | null = null;

  constructor(freq: number, mincutoff: number, beta: number, dcutoff: number) {
    this.freq = freq;
    this.mincutoff = mincutoff;
    this.beta = beta;
    this.dcutoff = dcutoff;
  }

  /** Compute smoothing alpha from cutoff frequency and sample rate. */
  private alpha(cutoff: number): number {
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    const te = 1.0 / this.freq;
    return 1.0 / (1.0 + tau / te);
  }

  /** Filter a new value and return the smoothed result. */
  filter(x: number): number {
    if (this.xPrev === null || this.dxPrev === null) {
      this.xPrev = x;
      this.dxPrev = 0;
      return x;
    }

    // Estimate derivative (speed of change)
    const dx = (x - this.xPrev) * this.freq;
    // Smooth the derivative with a low-pass filter using dcutoff
    const adx = this.alpha(this.dcutoff);
    const dxSmoothed = adx * dx + (1 - adx) * this.dxPrev;

    // Adaptive cutoff based on speed of change
    const cutoff = this.mincutoff + this.beta * Math.abs(dxSmoothed);
    // Smooth the value with the adaptive cutoff
    const ax = this.alpha(cutoff);
    const xSmoothed = ax * x + (1 - ax) * this.xPrev;

    this.xPrev = xSmoothed;
    this.dxPrev = dxSmoothed;

    return xSmoothed;
  }

  /** Reset filter state. */
  reset(): void {
    this.xPrev = null;
    this.dxPrev = null;
  }
}

/** One Euro Filter for a single 3D landmark point (x, y, z). */
class OneEuroPoint {
  private xFilter: OneEuroScalar;
  private yFilter: OneEuroScalar;
  private zFilter: OneEuroScalar;

  constructor(freq: number, mincutoff: number, beta: number, dcutoff: number) {
    this.xFilter = new OneEuroScalar(freq, mincutoff, beta, dcutoff);
    this.yFilter = new OneEuroScalar(freq, mincutoff, beta, dcutoff);
    this.zFilter = new OneEuroScalar(freq, mincutoff, beta, dcutoff);
  }

  filter(p: Point): Point {
    return {
      x: this.xFilter.filter(p.x),
      y: this.yFilter.filter(p.y),
      z: this.zFilter.filter(p.z),
      visibility: p.visibility, // Don't smooth visibility
    };
  }

  reset(): void {
    this.xFilter.reset();
    this.yFilter.reset();
    this.zFilter.reset();
  }
}

/**
 * One Euro Filter smoother for landmark sequences.
 * Reduces frame-to-frame jitter in MediaPipe landmark positions
 * while preserving responsiveness during fast movements.
 *
 * Drop-in replacement for the previous EMA LandmarkSmoother.
 * Constructor accepts an optional alpha parameter for API compatibility
 * (ignored internally — One Euro Filter uses its own parameters).
 */
export class LandmarkSmoother {
  private freq: number;
  private mincutoff: number;
  private beta: number;
  private dcutoff: number;
  private filters: Map<string, OneEuroPoint> = new Map();

  /**
   * @param _alpha - Ignored (kept for API compatibility with previous EMA smoother).
   * @param freq - Estimated sample rate in Hz (default 15, typical for squat analysis).
   * @param mincutoff - Minimum cutoff frequency: smoothing at rest (default 1.0).
   * @param beta - Speed coefficient: responsiveness to fast movements (default 0.007).
   * @param dcutoff - Derivative cutoff frequency (default 1.0).
   */
  constructor(
    _alpha = 0.7,
    freq = 15,
    mincutoff = 1.0,
    beta = 0.007,
    dcutoff = 1.0,
  ) {
    this.freq = freq;
    this.mincutoff = mincutoff;
    this.beta = beta;
    this.dcutoff = dcutoff;
  }

  /** Apply One Euro Filter smoothing to a frame's landmarks. */
  smooth(current: Landmarks): Landmarks {
    const smoothed: Landmarks = {};

    for (const key of Object.keys(current)) {
      let filter = this.filters.get(key);
      if (!filter) {
        filter = new OneEuroPoint(this.freq, this.mincutoff, this.beta, this.dcutoff);
        this.filters.set(key, filter);
      }
      smoothed[key] = filter.filter(current[key]);
    }

    return smoothed;
  }

  /** Reset the smoother state (call when starting a new video/session). */
  reset(): void {
    this.filters.clear();
  }
}
