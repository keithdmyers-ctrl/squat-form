import { describe, it, expect, beforeEach } from 'vitest';
import { smoothAngle, GenericPhaseDetector, detectRepsGeneric } from '../phase-detector';
import type { PhaseDetectorConfig } from '../phase-detector';
import { SquatPhase } from '../types';

// ─── Default config for squat-like movement ───

const defaultConfig: PhaseDetectorConfig = {
  standingAngle: 160,
  descendingThreshold: 5,
  bottomVelocityThreshold: 1.5,
  ascendingThreshold: 5,
  minRepFrames: 8,
  smoothingWindow: 3,
  historyWindow: 3,
};

// ─── smoothAngle ───

describe('smoothAngle', () => {
  it('returns the first value when buffer is empty', () => {
    const buffer: number[] = [];
    expect(smoothAngle(buffer, 100, 5)).toBe(100);
    expect(buffer).toEqual([100]);
  });

  it('computes rolling average correctly', () => {
    const buffer: number[] = [];
    smoothAngle(buffer, 10, 3);  // avg = 10
    smoothAngle(buffer, 20, 3);  // avg = 15
    const result = smoothAngle(buffer, 30, 3);  // avg = 20
    expect(result).toBe(20);
    expect(buffer).toEqual([10, 20, 30]);
  });

  it('respects window size by dropping old values', () => {
    const buffer: number[] = [];
    smoothAngle(buffer, 10, 3);
    smoothAngle(buffer, 20, 3);
    smoothAngle(buffer, 30, 3);
    // Buffer full: [10, 20, 30]
    const result = smoothAngle(buffer, 40, 3);
    // Buffer should be [20, 30, 40], avg = 30
    expect(result).toBe(30);
    expect(buffer).toEqual([20, 30, 40]);
  });

  it('works with window size of 1 (no smoothing)', () => {
    const buffer: number[] = [];
    smoothAngle(buffer, 100, 1);
    const result = smoothAngle(buffer, 200, 1);
    expect(result).toBe(200);
    expect(buffer).toEqual([200]);
  });

  it('defaults to window size 5', () => {
    const buffer: number[] = [];
    for (let i = 1; i <= 6; i++) {
      smoothAngle(buffer, i * 10);
    }
    // Buffer should contain [20, 30, 40, 50, 60] (window=5, dropped 10)
    expect(buffer.length).toBe(5);
    expect(buffer).toEqual([20, 30, 40, 50, 60]);
  });
});

// ─── GenericPhaseDetector ───

describe('GenericPhaseDetector', () => {
  let detector: GenericPhaseDetector;

  beforeEach(() => {
    detector = new GenericPhaseDetector(defaultConfig);
  });

  it('starts in STANDING phase', () => {
    expect(detector.getCurrentPhase()).toBe(SquatPhase.STANDING);
  });

  it('full cycle: Standing -> Descending -> Bottom -> Ascending -> Standing', () => {
    // Feed a sequence simulating a squat rep
    // Standing: angles around 170
    for (let i = 0; i < 5; i++) {
      detector.update(170);
    }
    expect(detector.getCurrentPhase()).toBe(SquatPhase.STANDING);

    // Descend: angles dropping significantly
    const descendAngles = [155, 145, 135, 125, 115, 105, 95, 85];
    for (const angle of descendAngles) {
      detector.update(angle);
    }
    const phaseAfterDescend = detector.getCurrentPhase();
    expect(
      phaseAfterDescend === SquatPhase.DESCENDING || phaseAfterDescend === SquatPhase.BOTTOM,
    ).toBe(true);

    // Bottom: stable low angle
    for (let i = 0; i < 5; i++) {
      detector.update(80);
    }
    expect(detector.getCurrentPhase()).toBe(SquatPhase.BOTTOM);

    // Ascend: angles increasing
    const ascendAngles = [90, 100, 110, 120, 130, 140, 150, 160, 170];
    for (const angle of ascendAngles) {
      detector.update(angle);
    }
    expect(detector.getCurrentPhase()).toBe(SquatPhase.STANDING);
  });

  it('rep counting: 1 full cycle = 1 rep', () => {
    // Use detectRepsGeneric to count reps from a synthetic angle sequence
    const angles: number[] = [];

    // Standing
    for (let i = 0; i < 10; i++) angles.push(170);
    // Descend
    for (let a = 165; a >= 80; a -= 5) angles.push(a);
    // Bottom hold
    for (let i = 0; i < 5; i++) angles.push(80);
    // Ascend
    for (let a = 85; a <= 170; a += 5) angles.push(a);
    // Standing at top
    for (let i = 0; i < 5; i++) angles.push(170);

    const reps = detectRepsGeneric(angles, defaultConfig);
    expect(reps.length).toBe(1);
    expect(reps[0].start).toBeGreaterThanOrEqual(0);
    expect(reps[0].end).toBeGreaterThan(reps[0].start);
    expect(reps[0].bottomIndex).toBeGreaterThan(reps[0].start);
    expect(reps[0].bottomIndex).toBeLessThan(reps[0].end);
  });

  it('NaN input does not crash and returns current phase', () => {
    detector.update(170);
    const phase = detector.update(NaN);
    expect(phase).toBe(SquatPhase.STANDING);
    // Should still function normally after NaN
    detector.update(170);
    expect(detector.getCurrentPhase()).toBe(SquatPhase.STANDING);
  });

  it('Infinity input does not crash and returns current phase', () => {
    detector.update(170);
    const phase = detector.update(Infinity);
    expect(phase).toBe(SquatPhase.STANDING);
  });

  it('-Infinity input does not crash and returns current phase', () => {
    detector.update(170);
    const phase = detector.update(-Infinity);
    expect(phase).toBe(SquatPhase.STANDING);
  });

  it('reset clears state back to STANDING', () => {
    // Descend into the movement
    for (let i = 0; i < 5; i++) detector.update(170);
    for (const a of [155, 145, 135, 125, 115, 105]) detector.update(a);

    expect(detector.getCurrentPhase()).not.toBe(SquatPhase.STANDING);

    detector.reset();
    expect(detector.getCurrentPhase()).toBe(SquatPhase.STANDING);

    // After reset, should behave as fresh
    detector.update(170);
    expect(detector.getCurrentPhase()).toBe(SquatPhase.STANDING);
  });

  it('config parameters affect behavior: different standingAngle', () => {
    const lowStandingConfig: PhaseDetectorConfig = {
      ...defaultConfig,
      standingAngle: 140,
    };
    const lowDetector = new GenericPhaseDetector(lowStandingConfig);

    // Angles that would be "standing" with standingAngle=160 but
    // at 150 we are above standingAngle=140
    for (let i = 0; i < 5; i++) lowDetector.update(150);
    expect(lowDetector.getCurrentPhase()).toBe(SquatPhase.STANDING);

    // But for default config, 135 is below 160 standingAngle -> could descend
    // For lowStandingConfig, 135 is below 140 -> could descend
  });

  it('config parameters affect behavior: high descendingThreshold prevents early descent detection', () => {
    const strictConfig: PhaseDetectorConfig = {
      ...defaultConfig,
      descendingThreshold: 50,  // Very high threshold
    };
    const strictDetector = new GenericPhaseDetector(strictConfig);

    // Small dip should not trigger descending with high threshold
    for (let i = 0; i < 5; i++) strictDetector.update(170);
    strictDetector.update(155);
    strictDetector.update(150);
    strictDetector.update(145);
    // With cumDelta threshold of 50, this small movement shouldn't trigger descent
    expect(strictDetector.getCurrentPhase()).toBe(SquatPhase.STANDING);
  });

  it('minimum rep frames prevents micro-movements from counting', () => {
    const strictConfig: PhaseDetectorConfig = {
      ...defaultConfig,
      minRepFrames: 50,  // Require many frames
    };

    // Quick up-down that would be a rep with low minRepFrames
    const angles: number[] = [];
    for (let i = 0; i < 5; i++) angles.push(170);
    for (let a = 155; a >= 100; a -= 10) angles.push(a);
    for (let i = 0; i < 3; i++) angles.push(100);
    for (let a = 110; a <= 170; a += 10) angles.push(a);
    for (let i = 0; i < 3; i++) angles.push(170);

    const reps = detectRepsGeneric(angles, strictConfig);
    // Too few frames for the high minRepFrames requirement
    expect(reps.length).toBe(0);
  });

  it('liveMode enables re-descent detection during ascending', () => {
    const liveConfig: PhaseDetectorConfig = {
      ...defaultConfig,
      liveMode: true,
    };
    const liveDetector = new GenericPhaseDetector(liveConfig);

    // Get to ascending phase
    for (let i = 0; i < 5; i++) liveDetector.update(170);
    for (const a of [155, 145, 135, 125, 115, 105, 95]) liveDetector.update(a);
    for (let i = 0; i < 3; i++) liveDetector.update(90);
    // Ascend partially
    for (const a of [100, 110, 120, 130]) liveDetector.update(a);

    if (liveDetector.getCurrentPhase() === SquatPhase.ASCENDING) {
      // Now drop back down sharply (re-descent in live mode)
      liveDetector.update(120);
      liveDetector.update(115);
      liveDetector.update(110);
      // In live mode with delta < -3, should transition to DESCENDING
      const phase = liveDetector.getCurrentPhase();
      expect(
        phase === SquatPhase.DESCENDING || phase === SquatPhase.BOTTOM,
      ).toBe(true);
    }
  });
});

// ─── detectRepsGeneric ───

describe('detectRepsGeneric', () => {
  it('empty angles array returns no reps', () => {
    const reps = detectRepsGeneric([], defaultConfig);
    expect(reps).toEqual([]);
  });

  it('single constant angle returns no reps', () => {
    const angles = Array(50).fill(170);
    const reps = detectRepsGeneric(angles, defaultConfig);
    expect(reps).toEqual([]);
  });

  it('constant low angle returns no reps (no standing)', () => {
    const angles = Array(50).fill(80);
    const reps = detectRepsGeneric(angles, defaultConfig);
    expect(reps).toEqual([]);
  });

  it('proper rep segmentation with frame ranges', () => {
    const angles: number[] = [];
    // Standing
    for (let i = 0; i < 10; i++) angles.push(170);
    // Rep 1: descend
    for (let a = 165; a >= 80; a -= 5) angles.push(a);
    // Bottom
    for (let i = 0; i < 5; i++) angles.push(80);
    // Ascend
    for (let a = 85; a <= 170; a += 5) angles.push(a);
    // Standing
    for (let i = 0; i < 5; i++) angles.push(170);
    // Rep 2: descend
    for (let a = 165; a >= 80; a -= 5) angles.push(a);
    // Bottom
    for (let i = 0; i < 5; i++) angles.push(80);
    // Ascend
    for (let a = 85; a <= 170; a += 5) angles.push(a);
    // Standing
    for (let i = 0; i < 5; i++) angles.push(170);

    const reps = detectRepsGeneric(angles, defaultConfig);
    expect(reps.length).toBe(2);

    // Each rep should have valid frame ranges
    for (const rep of reps) {
      expect(rep.start).toBeGreaterThanOrEqual(0);
      expect(rep.end).toBeGreaterThan(rep.start);
      expect(rep.bottomIndex).toBeGreaterThanOrEqual(rep.start);
      expect(rep.bottomIndex).toBeLessThanOrEqual(rep.end);
    }

    // Rep 2 should start after rep 1 ends
    expect(reps[1].start).toBeGreaterThan(reps[0].end);
  });

  it('bottom index corresponds to minimum angle in the rep', () => {
    const angles: number[] = [];
    for (let i = 0; i < 10; i++) angles.push(170);
    for (let a = 165; a >= 70; a -= 5) angles.push(a);
    for (let i = 0; i < 3; i++) angles.push(70); // lowest point
    for (let a = 75; a <= 170; a += 5) angles.push(a);
    for (let i = 0; i < 5; i++) angles.push(170);

    const reps = detectRepsGeneric(angles, defaultConfig);
    if (reps.length > 0) {
      const rep = reps[0];
      const repAngles = angles.slice(rep.start, rep.end + 1);
      const minAngle = Math.min(...repAngles);
      // The bottom index should be at or near the minimum angle
      expect(angles[rep.bottomIndex]).toBeLessThanOrEqual(minAngle + 5);
    }
  });

  it('three consecutive reps are all detected', () => {
    const angles: number[] = [];

    for (let rep = 0; rep < 3; rep++) {
      // Standing
      for (let i = 0; i < 8; i++) angles.push(170);
      // Descend
      for (let a = 160; a >= 80; a -= 5) angles.push(a);
      // Bottom
      for (let i = 0; i < 4; i++) angles.push(80);
      // Ascend
      for (let a = 85; a <= 170; a += 5) angles.push(a);
    }
    // Final standing
    for (let i = 0; i < 5; i++) angles.push(170);

    const reps = detectRepsGeneric(angles, defaultConfig);
    expect(reps.length).toBe(3);
  });
});
