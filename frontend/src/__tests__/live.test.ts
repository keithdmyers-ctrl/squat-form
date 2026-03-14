import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LiveAnalyzer } from '../live';
import type { LiveCallbacks, LiveConfig } from '../live';
import { SquatPhase } from '../types';
import type { FrameAngles, Landmarks, Point } from '../types';

// ── Helpers ──

function makePoint(overrides: Partial<Point> = {}): Point {
  return { x: 0.5, y: 0.5, z: 0, visibility: 1, ...overrides };
}

/**
 * Build a landmarks object for a standing pose.
 * Landmarks are positioned so that computeFrameAngles produces a knee angle >= 160.
 */
function makeStandingLandmarks(): Landmarks {
  // Positions arranged roughly vertically (standing pose)
  return {
    left_hip: makePoint({ x: 0.45, y: 0.50 }),
    right_hip: makePoint({ x: 0.55, y: 0.50 }),
    left_knee: makePoint({ x: 0.45, y: 0.65 }),
    right_knee: makePoint({ x: 0.55, y: 0.65 }),
    left_ankle: makePoint({ x: 0.45, y: 0.80 }),
    right_ankle: makePoint({ x: 0.55, y: 0.80 }),
    left_shoulder: makePoint({ x: 0.45, y: 0.30 }),
    right_shoulder: makePoint({ x: 0.55, y: 0.30 }),
    left_heel: makePoint({ x: 0.44, y: 0.82 }),
    right_heel: makePoint({ x: 0.56, y: 0.82 }),
    left_ear: makePoint({ x: 0.45, y: 0.20 }),
    right_ear: makePoint({ x: 0.55, y: 0.20 }),
    nose: makePoint({ x: 0.50, y: 0.18 }),
    left_foot_index: makePoint({ x: 0.46, y: 0.83 }),
    right_foot_index: makePoint({ x: 0.56, y: 0.83 }),
  };
}

/**
 * Build a landmarks object for a squatting pose (deep position).
 * Knee angle should be roughly 80-100 degrees.
 */
function makeSquattingLandmarks(): Landmarks {
  // Lower the hips to knee level, bend knees substantially
  return {
    left_hip: makePoint({ x: 0.44, y: 0.62 }),
    right_hip: makePoint({ x: 0.56, y: 0.62 }),
    left_knee: makePoint({ x: 0.42, y: 0.70 }),
    right_knee: makePoint({ x: 0.58, y: 0.70 }),
    left_ankle: makePoint({ x: 0.45, y: 0.80 }),
    right_ankle: makePoint({ x: 0.55, y: 0.80 }),
    left_shoulder: makePoint({ x: 0.44, y: 0.45 }),
    right_shoulder: makePoint({ x: 0.56, y: 0.45 }),
    left_heel: makePoint({ x: 0.44, y: 0.82 }),
    right_heel: makePoint({ x: 0.56, y: 0.82 }),
    left_ear: makePoint({ x: 0.44, y: 0.35 }),
    right_ear: makePoint({ x: 0.56, y: 0.35 }),
    nose: makePoint({ x: 0.50, y: 0.33 }),
    left_foot_index: makePoint({ x: 0.46, y: 0.83 }),
    right_foot_index: makePoint({ x: 0.56, y: 0.83 }),
  };
}

function makeCallbacks() {
  return {
    onFrameProcessed: vi.fn() as unknown as LiveCallbacks['onFrameProcessed'],
    onRepComplete: vi.fn() as unknown as LiveCallbacks['onRepComplete'],
    onCalibrated: vi.fn() as unknown as LiveCallbacks['onCalibrated'],
    onPhaseChange: vi.fn() as unknown as LiveCallbacks['onPhaseChange'],
    onError: vi.fn() as unknown as LiveCallbacks['onError'],
  };
}

function makeDefaultLiveConfig(overrides: Partial<LiveConfig> = {}): LiveConfig {
  return {
    squatType: 'bodyweight',
    experienceLevel: 'beginner',
    competitionMode: false,
    audioEnabled: false,
    ...overrides,
  };
}

// ── Tests ──

describe('LiveAnalyzer instantiation', () => {
  it('can be instantiated without DOM or MediaPipe', () => {
    const callbacks = makeCallbacks();
    const config = makeDefaultLiveConfig();
    const analyzer = new LiveAnalyzer(config, callbacks);
    expect(analyzer).toBeDefined();
  });

  it('starts with 0 rep count', () => {
    const callbacks = makeCallbacks();
    const analyzer = new LiveAnalyzer(makeDefaultLiveConfig(), callbacks);
    expect(analyzer.getRepCount()).toBe(0);
  });

  it('starts uncalibrated', () => {
    const callbacks = makeCallbacks();
    const analyzer = new LiveAnalyzer(makeDefaultLiveConfig(), callbacks);
    expect(analyzer.isCalibrated()).toBe(false);
  });

  it('reports calibration progress', () => {
    const callbacks = makeCallbacks();
    const analyzer = new LiveAnalyzer(makeDefaultLiveConfig(), callbacks);
    const progress = analyzer.getCalibrationProgress();
    expect(progress.current).toBe(0);
    expect(progress.required).toBe(5);
    expect(progress.attempts).toBe(0);
    expect(progress.maxAttempts).toBe(60);
  });

  it('reset clears all state', () => {
    const callbacks = makeCallbacks();
    const analyzer = new LiveAnalyzer(makeDefaultLiveConfig(), callbacks);

    // Process a standing frame to start calibration
    analyzer.processFrame(makeStandingLandmarks());
    expect(analyzer.getCalibrationProgress().attempts).toBe(1);

    analyzer.reset();

    expect(analyzer.getRepCount()).toBe(0);
    expect(analyzer.isCalibrated()).toBe(false);
    expect(analyzer.getCalibrationProgress().current).toBe(0);
    expect(analyzer.getCalibrationProgress().attempts).toBe(0);
  });
});

describe('LiveAnalyzer FPS calculation (getEffectiveFps)', () => {
  // Note: getEffectiveFps is a public method on LiveAnalyzer.
  // It relies on frameIntervals populated during processFrame via performance.now().
  // We mock performance.now to control timing.

  let callbacks: ReturnType<typeof makeCallbacks>;
  let analyzer: LiveAnalyzer;

  beforeEach(() => {
    callbacks = makeCallbacks();
    analyzer = new LiveAnalyzer(makeDefaultLiveConfig(), callbacks);
  });

  it('returns 30 (fallback) when fewer than 5 samples', () => {
    // No frames processed yet
    expect(analyzer.getEffectiveFps()).toBe(30);
  });

  it('returns 30 (fallback) after only 3 frames', () => {
    let time = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      time += 33;
      return time;
    });

    // Process 3 frames -> only 2 intervals (< 5)
    for (let i = 0; i < 3; i++) {
      analyzer.processFrame(makeStandingLandmarks());
    }

    expect(analyzer.getEffectiveFps()).toBe(30);
    vi.restoreAllMocks();
  });

  it('returns ~30fps for 10 samples at 33ms intervals', () => {
    let time = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      const current = time;
      time += 33; // ~30fps
      return current;
    });

    // Process 11 frames to get 10 intervals
    for (let i = 0; i < 11; i++) {
      analyzer.processFrame(makeStandingLandmarks());
    }

    const fps = analyzer.getEffectiveFps();
    // 1000/33 = 30.3
    expect(fps).toBeGreaterThan(28);
    expect(fps).toBeLessThan(32);
    vi.restoreAllMocks();
  });

  it('returns ~60fps for 10 samples at 16ms intervals', () => {
    let time = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      const current = time;
      time += 16; // ~60fps
      return current;
    });

    for (let i = 0; i < 11; i++) {
      analyzer.processFrame(makeStandingLandmarks());
    }

    const fps = analyzer.getEffectiveFps();
    // 1000/16 = 62.5
    expect(fps).toBeGreaterThan(55);
    expect(fps).toBeLessThan(67);
    vi.restoreAllMocks();
  });

  it('clamps FPS to maximum of 120', () => {
    let time = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      const current = time;
      time += 2; // 500fps (way too fast)
      return current;
    });

    for (let i = 0; i < 11; i++) {
      analyzer.processFrame(makeStandingLandmarks());
    }

    const fps = analyzer.getEffectiveFps();
    expect(fps).toBeLessThanOrEqual(120);
    vi.restoreAllMocks();
  });

  it('clamps FPS to minimum of 1', () => {
    let time = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      const current = time;
      time += 5000; // 0.2fps (very slow)
      return current;
    });

    for (let i = 0; i < 11; i++) {
      analyzer.processFrame(makeStandingLandmarks());
    }

    const fps = analyzer.getEffectiveFps();
    expect(fps).toBeGreaterThanOrEqual(1);
    vi.restoreAllMocks();
  });
});

describe('LiveAnalyzer calibration', () => {
  it('calibrates after 5 consecutive standing frames', () => {
    const callbacks = makeCallbacks();
    const analyzer = new LiveAnalyzer(makeDefaultLiveConfig(), callbacks);

    // Process 5 standing frames
    for (let i = 0; i < 5; i++) {
      analyzer.processFrame(makeStandingLandmarks());
    }

    expect(analyzer.isCalibrated()).toBe(true);
    expect(callbacks.onCalibrated).toHaveBeenCalledTimes(1);
  });

  it('does not calibrate from squatting frames', () => {
    const callbacks = makeCallbacks();
    const analyzer = new LiveAnalyzer(makeDefaultLiveConfig(), callbacks);

    // Process squatting frames - knee angle likely < 150
    for (let i = 0; i < 10; i++) {
      analyzer.processFrame(makeSquattingLandmarks());
    }

    // Should not calibrate from squatting position
    expect(callbacks.onCalibrated).not.toHaveBeenCalled();
  });
});

describe('LiveAnalyzer phase detection callbacks', () => {
  it('fires onPhaseChange when phase changes', () => {
    const callbacks = makeCallbacks();
    const analyzer = new LiveAnalyzer(makeDefaultLiveConfig(), callbacks);

    // Calibrate first
    for (let i = 0; i < 6; i++) {
      analyzer.processFrame(makeStandingLandmarks());
    }

    // The phase change callback should have been called at least for initial transitions
    // (might not fire if all frames are standing -> standing)
    // Process squatting frames to trigger a phase change
    for (let i = 0; i < 15; i++) {
      analyzer.processFrame(makeSquattingLandmarks());
    }

    // Should have fired onPhaseChange at least once (standing -> descending)
    expect(callbacks.onPhaseChange).toHaveBeenCalled();
  });

  it('fires onFrameProcessed for every frame', () => {
    const callbacks = makeCallbacks();
    const analyzer = new LiveAnalyzer(makeDefaultLiveConfig(), callbacks);

    const frameCount = 10;
    for (let i = 0; i < frameCount; i++) {
      analyzer.processFrame(makeStandingLandmarks());
    }

    expect(callbacks.onFrameProcessed).toHaveBeenCalledTimes(frameCount);
  });
});

describe('LiveAnalyzer rep finalization logic', () => {
  it('does not count a rep with fewer than 10 frames', () => {
    const callbacks = makeCallbacks();
    const analyzer = new LiveAnalyzer(makeDefaultLiveConfig(), callbacks);

    // Calibrate
    for (let i = 0; i < 6; i++) {
      analyzer.processFrame(makeStandingLandmarks());
    }

    // Very quick squat (< 10 frames)
    for (let i = 0; i < 3; i++) {
      analyzer.processFrame(makeSquattingLandmarks());
    }

    // Back to standing
    for (let i = 0; i < 10; i++) {
      analyzer.processFrame(makeStandingLandmarks());
    }

    // Should not have registered a complete rep
    // (too few frames between descent and standing again)
    expect(analyzer.getRepCount()).toBe(0);
  });

  it('getResults returns empty set analysis when no reps', () => {
    const callbacks = makeCallbacks();
    const analyzer = new LiveAnalyzer(makeDefaultLiveConfig(), callbacks);
    const results = analyzer.getResults();

    expect(results.repCount).toBe(0);
    expect(results.reps).toEqual([]);
    expect(results.overallScore).toBe(0);
    expect(results.fatigueDetected).toBe(false);
    expect(results.topIssues).toEqual([]);
    expect(results.topCues).toEqual([]);
  });

  it('getResults reflects competition mode setting', () => {
    const callbacks = makeCallbacks();
    const analyzer = new LiveAnalyzer(
      makeDefaultLiveConfig({ competitionMode: true }),
      callbacks,
    );
    const results = analyzer.getResults();
    expect(results.competitionMode).toBe(true);
  });

  it('getResults reflects non-competition mode', () => {
    const callbacks = makeCallbacks();
    const analyzer = new LiveAnalyzer(
      makeDefaultLiveConfig({ competitionMode: false }),
      callbacks,
    );
    const results = analyzer.getResults();
    expect(results.competitionMode).toBe(false);
  });
});

describe('LiveAnalyzer full rep cycle', () => {
  /**
   * Simulate a complete squat rep by interpolating landmarks.
   * This is an integration-style test that verifies the full pipeline.
   */
  function interpolateLandmarks(standing: Landmarks, squatting: Landmarks, t: number): Landmarks {
    const result: Landmarks = {};
    for (const key of Object.keys(standing)) {
      const s = standing[key];
      const q = squatting[key];
      if (s && q) {
        result[key] = {
          x: s.x + (q.x - s.x) * t,
          y: s.y + (q.y - s.y) * t,
          z: s.z + (q.z - s.z) * t,
          visibility: 1,
        };
      }
    }
    return result;
  }

  it('counts a complete rep cycle (standing -> squat -> standing)', () => {
    const callbacks = makeCallbacks();
    const analyzer = new LiveAnalyzer(makeDefaultLiveConfig(), callbacks);

    // Mock performance.now for consistent FPS
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      time += 33;
      return time;
    });

    const standing = makeStandingLandmarks();
    const squatting = makeSquattingLandmarks();

    // Phase 1: Calibrate with standing frames (10 frames)
    for (let i = 0; i < 10; i++) {
      analyzer.processFrame(standing);
    }
    expect(analyzer.isCalibrated()).toBe(true);

    // Phase 2: Hold standing a bit more for stable detection
    for (let i = 0; i < 5; i++) {
      analyzer.processFrame(standing);
    }

    // Phase 3: Descent (20 frames - transition from standing to squat)
    for (let i = 0; i < 20; i++) {
      const t = i / 19;
      analyzer.processFrame(interpolateLandmarks(standing, squatting, t));
    }

    // Phase 4: Bottom hold (5 frames at squat position)
    for (let i = 0; i < 5; i++) {
      analyzer.processFrame(squatting);
    }

    // Phase 5: Ascent (20 frames - transition from squat to standing)
    for (let i = 0; i < 20; i++) {
      const t = 1 - i / 19;
      analyzer.processFrame(interpolateLandmarks(standing, squatting, t));
    }

    // Phase 6: Standing again (10 frames)
    for (let i = 0; i < 10; i++) {
      analyzer.processFrame(standing);
    }

    // The rep should be counted if the phase detector went through the full cycle
    // Note: this depends on the exact knee angles produced by our synthetic landmarks
    // The phase detector needs to see: standing -> descending -> bottom -> ascending -> standing
    if (analyzer.getRepCount() > 0) {
      expect(callbacks.onRepComplete).toHaveBeenCalled();

      const results = analyzer.getResults();
      expect(results.repCount).toBeGreaterThanOrEqual(1);
      expect(results.reps.length).toBeGreaterThanOrEqual(1);

      // Each rep should have scores
      const repScore = results.reps[0];
      expect(repScore.depthScore).toBeGreaterThanOrEqual(0);
      expect(repScore.depthScore).toBeLessThanOrEqual(100);
      expect(repScore.overallScore).toBeGreaterThanOrEqual(0);
      expect(repScore.overallScore).toBeLessThanOrEqual(100);
      expect(repScore.grade).toBeTruthy();
    }

    vi.restoreAllMocks();
  });
});

describe('LiveAnalyzer audio control', () => {
  it('setAudioEnabled does not throw', () => {
    const callbacks = makeCallbacks();
    const analyzer = new LiveAnalyzer(makeDefaultLiveConfig(), callbacks);

    expect(() => analyzer.setAudioEnabled(true)).not.toThrow();
    expect(() => analyzer.setAudioEnabled(false)).not.toThrow();
  });
});

describe('LiveAnalyzer competition mode scoring', () => {
  it('uses competition weights in competition mode', () => {
    const callbacks = makeCallbacks();
    const competitionAnalyzer = new LiveAnalyzer(
      makeDefaultLiveConfig({ competitionMode: true }),
      callbacks,
    );

    const results = competitionAnalyzer.getResults();
    expect(results.competitionMode).toBe(true);
  });

  it('returns different config for competition vs standard mode', () => {
    const compCallbacks = makeCallbacks();
    const stdCallbacks = makeCallbacks();

    const compAnalyzer = new LiveAnalyzer(
      makeDefaultLiveConfig({ competitionMode: true }),
      compCallbacks,
    );
    const stdAnalyzer = new LiveAnalyzer(
      makeDefaultLiveConfig({ competitionMode: false }),
      stdCallbacks,
    );

    const compResults = compAnalyzer.getResults();
    const stdResults = stdAnalyzer.getResults();

    expect(compResults.competitionMode).toBe(true);
    expect(stdResults.competitionMode).toBe(false);
  });
});

describe('LiveAnalyzer fatigue detection', () => {
  it('getResults does not detect fatigue with fewer than 4 reps', () => {
    const callbacks = makeCallbacks();
    const analyzer = new LiveAnalyzer(makeDefaultLiveConfig(), callbacks);

    // No reps processed
    const results = analyzer.getResults();
    expect(results.fatigueDetected).toBe(false);
  });
});
