import { describe, it, expect } from 'vitest';
import {
  isBluetoothAvailable,
  VELOCITY_ZONES,
  classifyVelocityZone,
  estimateRPEFromVelocity,
  detectVelocityLoss,
  estimate1RMFromVelocity,
  getMinVelocityThreshold,
  startVBTSession,
  endVBTSession,
  getActiveSession,
  renderVBTConnectButton,
  renderVelocityFeedback,
  renderVelocityLossIndicator,
  renderLoadVelocityChart,
} from '../bluetooth-vbt';
import type { VelocityReading } from '../bluetooth-vbt';
import { isHealthSyncAvailable } from '../health-sync';

// ─── Helpers ───

function makeReading(overrides: Partial<VelocityReading> = {}): VelocityReading {
  return {
    timestamp: Date.now(),
    meanVelocity: 0.5,
    peakVelocity: 0.7,
    rom: 500,
    duration: 800,
    ...overrides,
  };
}

// ─── Bluetooth Availability ───

describe('isBluetoothAvailable', () => {
  it('returns false in test environment (no navigator.bluetooth)', () => {
    expect(isBluetoothAvailable()).toBe(false);
  });
});

// ─── Health Sync Availability ───

describe('isHealthSyncAvailable', () => {
  it('returns false in test environment (no Capacitor native)', () => {
    expect(isHealthSyncAvailable()).toBe(false);
  });
});

// ─── Velocity Zones ───

describe('VELOCITY_ZONES', () => {
  it('has exactly 4 zones', () => {
    expect(VELOCITY_ZONES).toHaveLength(4);
  });

  it('zones cover the full velocity range without gaps', () => {
    const sorted = [...VELOCITY_ZONES].sort((a, b) => a.minVelocity - b.minVelocity);
    // Lowest zone starts at 0
    expect(sorted[0].minVelocity).toBe(0);
    // Highest zone ends at 1.0
    expect(sorted[sorted.length - 1].maxVelocity).toBe(1.0);
    // No gaps between zones
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].minVelocity).toBe(sorted[i - 1].maxVelocity);
    }
  });

  it('each zone has valid RPE estimate and %1RM range', () => {
    for (const zone of VELOCITY_ZONES) {
      expect(zone.rpeEstimate).toBeGreaterThanOrEqual(5);
      expect(zone.rpeEstimate).toBeLessThanOrEqual(10);
      expect(zone.percentOf1RM[0]).toBeLessThan(zone.percentOf1RM[1]);
      expect(zone.percentOf1RM[0]).toBeGreaterThanOrEqual(0);
      expect(zone.percentOf1RM[1]).toBeLessThanOrEqual(100);
    }
  });
});

describe('classifyVelocityZone', () => {
  it('classifies strength-speed zone (0.75-1.0 m/s)', () => {
    expect(classifyVelocityZone(0.85).zone).toBe('strength_speed');
    expect(classifyVelocityZone(0.75).zone).toBe('strength_speed');
  });

  it('classifies speed-strength zone (0.5-0.75 m/s)', () => {
    expect(classifyVelocityZone(0.6).zone).toBe('speed_strength');
    expect(classifyVelocityZone(0.5).zone).toBe('speed_strength');
  });

  it('classifies strength zone (0.3-0.5 m/s)', () => {
    expect(classifyVelocityZone(0.4).zone).toBe('strength');
    expect(classifyVelocityZone(0.3).zone).toBe('strength');
  });

  it('classifies maximal strength zone (<0.3 m/s)', () => {
    expect(classifyVelocityZone(0.2).zone).toBe('maximal_strength');
    expect(classifyVelocityZone(0.1).zone).toBe('maximal_strength');
    expect(classifyVelocityZone(0.0).zone).toBe('maximal_strength');
  });

  it('handles velocities above 1.0 m/s as strength-speed', () => {
    expect(classifyVelocityZone(1.2).zone).toBe('strength_speed');
    expect(classifyVelocityZone(1.5).zone).toBe('strength_speed');
  });

  it('handles negative velocity as maximal strength', () => {
    expect(classifyVelocityZone(-0.1).zone).toBe('maximal_strength');
  });
});

// ─── RPE Estimation ───

describe('estimateRPEFromVelocity', () => {
  it('returns RPE 10 at or below the minimum velocity threshold', () => {
    expect(estimateRPEFromVelocity(0.30, 'squat')).toBe(10);
    expect(estimateRPEFromVelocity(0.15, 'deadlift')).toBe(10);
    expect(estimateRPEFromVelocity(0.17, 'bench_press')).toBe(10);
    expect(estimateRPEFromVelocity(0.10, 'squat')).toBe(10);
    expect(estimateRPEFromVelocity(0.0, 'squat')).toBe(10);
  });

  it('returns RPE 5 at 1.0 m/s or above', () => {
    expect(estimateRPEFromVelocity(1.0, 'squat')).toBe(5);
    expect(estimateRPEFromVelocity(1.3, 'squat')).toBe(5);
  });

  it('returns intermediate RPE for intermediate velocities', () => {
    // Squat MVT = 0.30, so 0.65 m/s is exactly halfway → RPE 7.5
    const rpe = estimateRPEFromVelocity(0.65, 'squat');
    expect(rpe).toBeGreaterThan(5);
    expect(rpe).toBeLessThan(10);
  });

  it('higher velocity → lower RPE', () => {
    const rpeFast = estimateRPEFromVelocity(0.8, 'squat');
    const rpeSlow = estimateRPEFromVelocity(0.4, 'squat');
    expect(rpeFast).toBeLessThan(rpeSlow);
  });

  it('exercise-specific: bench_press has lower MVT than squat', () => {
    // Same velocity should map to lower RPE for bench (MVT=0.17) than squat (MVT=0.30)
    // because bench lifters can still grind slower
    const rpeBench = estimateRPEFromVelocity(0.25, 'bench_press');
    const rpeSquat = estimateRPEFromVelocity(0.25, 'squat');
    expect(rpeBench).toBeLessThan(rpeSquat);
  });

  it('uses default MVT (0.25) for unknown exercises', () => {
    const rpe = estimateRPEFromVelocity(0.25, 'some_unknown_exercise');
    expect(rpe).toBe(10);
  });
});

// ─── Minimum Velocity Thresholds ───

describe('getMinVelocityThreshold', () => {
  it('returns 0.30 for squat', () => {
    expect(getMinVelocityThreshold('squat')).toBe(0.30);
  });

  it('returns 0.17 for bench_press', () => {
    expect(getMinVelocityThreshold('bench_press')).toBe(0.17);
  });

  it('returns 0.15 for deadlift', () => {
    expect(getMinVelocityThreshold('deadlift')).toBe(0.15);
  });

  it('returns 0.25 for overhead_press', () => {
    expect(getMinVelocityThreshold('overhead_press')).toBe(0.25);
  });

  it('returns 0.20 for barbell_row', () => {
    expect(getMinVelocityThreshold('barbell_row')).toBe(0.20);
  });

  it('returns 0.28 for lunge', () => {
    expect(getMinVelocityThreshold('lunge')).toBe(0.28);
  });

  it('returns default 0.25 for unknown exercise', () => {
    expect(getMinVelocityThreshold('kettlebell_swing')).toBe(0.25);
  });
});

// ─── Velocity Loss Detection ───

describe('detectVelocityLoss', () => {
  it('returns zero loss for empty readings', () => {
    const result = detectVelocityLoss([]);
    expect(result.velocityLoss).toBe(0);
    expect(result.shouldStop).toBe(false);
    expect(result.repsSinceThreshold).toBe(0);
  });

  it('returns zero loss for a single reading', () => {
    const result = detectVelocityLoss([makeReading({ meanVelocity: 0.6 })]);
    expect(result.velocityLoss).toBe(0);
    expect(result.shouldStop).toBe(false);
    expect(result.firstRepVelocity).toBe(0.6);
    expect(result.lastRepVelocity).toBe(0.6);
  });

  it('detects no loss when velocity is consistent', () => {
    const readings = [
      makeReading({ meanVelocity: 0.60 }),
      makeReading({ meanVelocity: 0.59 }),
      makeReading({ meanVelocity: 0.58 }),
    ];
    const result = detectVelocityLoss(readings);
    expect(result.velocityLoss).toBeCloseTo(3.3, 0);
    expect(result.shouldStop).toBe(false);
  });

  it('detects significant loss but below threshold', () => {
    const readings = [
      makeReading({ meanVelocity: 0.60 }),
      makeReading({ meanVelocity: 0.55 }),
      makeReading({ meanVelocity: 0.50 }),
    ];
    const result = detectVelocityLoss(readings);
    expect(result.velocityLoss).toBeCloseTo(16.7, 0);
    expect(result.shouldStop).toBe(false);
  });

  it('triggers stop when velocity drops >20%', () => {
    const readings = [
      makeReading({ meanVelocity: 0.60 }),
      makeReading({ meanVelocity: 0.55 }),
      makeReading({ meanVelocity: 0.50 }),
      makeReading({ meanVelocity: 0.45 }),
    ];
    const result = detectVelocityLoss(readings);
    expect(result.velocityLoss).toBe(25);
    expect(result.shouldStop).toBe(true);
    expect(result.firstRepVelocity).toBe(0.60);
    expect(result.lastRepVelocity).toBe(0.45);
  });

  it('tracks reps since threshold was crossed', () => {
    const readings = [
      makeReading({ meanVelocity: 0.60 }),
      makeReading({ meanVelocity: 0.55 }),
      makeReading({ meanVelocity: 0.47 }), // 21.7% loss — crosses threshold
      makeReading({ meanVelocity: 0.44 }),
      makeReading({ meanVelocity: 0.40 }),
    ];
    const result = detectVelocityLoss(readings);
    expect(result.shouldStop).toBe(true);
    expect(result.repsSinceThreshold).toBe(3); // reps 3, 4, 5 are past threshold
  });

  it('exactly at 20% loss triggers stop', () => {
    const readings = [
      makeReading({ meanVelocity: 0.50 }),
      makeReading({ meanVelocity: 0.40 }), // exactly 20%
    ];
    const result = detectVelocityLoss(readings);
    expect(result.velocityLoss).toBe(20);
    expect(result.shouldStop).toBe(true);
  });

  it('handles zero first-rep velocity gracefully', () => {
    const readings = [
      makeReading({ meanVelocity: 0 }),
      makeReading({ meanVelocity: 0.5 }),
    ];
    const result = detectVelocityLoss(readings);
    expect(result.velocityLoss).toBe(0);
    expect(result.shouldStop).toBe(false);
  });
});

// ─── 1RM Estimation from Load-Velocity Profile ───

describe('estimate1RMFromVelocity', () => {
  it('returns zero with insufficient data (< 2 points)', () => {
    const result = estimate1RMFromVelocity([{ weight: 100, velocity: 0.8 }], 'squat');
    expect(result.estimated1RM).toBe(0);
    expect(result.confidence).toBe('low');
  });

  it('estimates 1RM from a 2-point load-velocity profile', () => {
    // Squat MVT = 0.30
    // Two points: 60kg @ 0.80 m/s, 100kg @ 0.40 m/s
    // Linear: velocity = 1.40 - 0.01 * weight
    // At MVT 0.30: weight = (0.30 - 1.40) / -0.01 = 110
    const result = estimate1RMFromVelocity(
      [
        { weight: 60, velocity: 0.80 },
        { weight: 100, velocity: 0.40 },
      ],
      'squat',
    );
    expect(result.estimated1RM).toBe(110);
    expect(result.r2).toBe(1); // perfect fit with 2 points
    expect(result.confidence).toBe('medium'); // r2=1 but only 2 points
  });

  it('estimates 1RM from a multi-point profile with high confidence', () => {
    // Perfect linear data: velocity = 1.20 - 0.006 * weight
    // MVT for squat = 0.30
    // At MVT: weight = (0.30 - 1.20) / -0.006 = 150
    const pairs = [
      { weight: 60, velocity: 0.84 },
      { weight: 80, velocity: 0.72 },
      { weight: 100, velocity: 0.60 },
      { weight: 120, velocity: 0.48 },
      { weight: 140, velocity: 0.36 },
    ];
    const result = estimate1RMFromVelocity(pairs, 'squat');
    expect(result.estimated1RM).toBe(150);
    expect(result.r2).toBeGreaterThanOrEqual(0.99);
    expect(result.confidence).toBe('high');
  });

  it('uses exercise-specific MVT for bench_press', () => {
    // Bench MVT = 0.17, different from squat's 0.30
    // velocity = 1.00 - 0.01 * weight
    // At MVT 0.17: weight = (0.17 - 1.00) / -0.01 = 83
    const pairs = [
      { weight: 40, velocity: 0.60 },
      { weight: 60, velocity: 0.40 },
      { weight: 80, velocity: 0.20 },
    ];
    const result = estimate1RMFromVelocity(pairs, 'bench_press');
    expect(result.estimated1RM).toBe(83);
    expect(result.r2).toBeGreaterThanOrEqual(0.99);
    expect(result.confidence).toBe('high');
  });

  it('returns low confidence for noisy data', () => {
    // Noisy data with poor linear fit
    const pairs = [
      { weight: 60, velocity: 0.80 },
      { weight: 80, velocity: 0.90 }, // goes UP — not realistic
      { weight: 100, velocity: 0.30 },
    ];
    const result = estimate1RMFromVelocity(pairs, 'squat');
    // The slope may or may not be negative depending on the regression
    // but r2 should be low
    expect(result.r2).toBeLessThan(0.95);
  });

  it('handles invalid data where velocity increases with weight', () => {
    // Positive slope — physically impossible
    const pairs = [
      { weight: 60, velocity: 0.30 },
      { weight: 100, velocity: 0.80 },
    ];
    const result = estimate1RMFromVelocity(pairs, 'squat');
    expect(result.estimated1RM).toBe(0);
    expect(result.confidence).toBe('low');
  });

  it('handles identical weights gracefully', () => {
    const pairs = [
      { weight: 100, velocity: 0.50 },
      { weight: 100, velocity: 0.48 },
    ];
    const result = estimate1RMFromVelocity(pairs, 'squat');
    // ssXX = 0 → should return 0
    expect(result.estimated1RM).toBe(0);
    expect(result.confidence).toBe('low');
  });
});

// ─── Session Management ───

describe('VBT session management', () => {
  it('starts a session with exercise', () => {
    const session = startVBTSession('squat');
    expect(session).not.toBeNull();
    expect(session.exercise).toBe('squat');
    expect(session.readings).toEqual([]);
    expect(session.startTime).toBeGreaterThan(0);
    // Manual placeholder device since nothing is connected
    expect(session.device.name).toBe('Manual Entry');
  });

  it('getActiveSession returns the current session', () => {
    startVBTSession('deadlift');
    const active = getActiveSession();
    expect(active).not.toBeNull();
    expect(active!.exercise).toBe('deadlift');
  });

  it('endVBTSession returns and clears the session', () => {
    startVBTSession('bench_press');
    const ended = endVBTSession();
    expect(ended).not.toBeNull();
    expect(ended!.exercise).toBe('bench_press');
    expect(getActiveSession()).toBeNull();
  });

  it('endVBTSession returns null when no session is active', () => {
    // Ensure no session is active
    endVBTSession();
    expect(endVBTSession()).toBeNull();
  });
});

// ─── UI Rendering ───

describe('renderVBTConnectButton', () => {
  it('returns unavailable message when bluetooth is not available', () => {
    const html = renderVBTConnectButton();
    expect(html).toContain('vbt-unavailable');
    expect(html).toContain('Chrome');
  });
});

describe('renderVelocityFeedback', () => {
  it('renders velocity reading with zone and RPE', () => {
    const reading = makeReading({ meanVelocity: 0.55, peakVelocity: 0.72, rom: 450, duration: 900 });
    const html = renderVelocityFeedback(reading, 'squat');
    expect(html).toContain('0.55');
    expect(html).toContain('0.72');
    expect(html).toContain('450');
    expect(html).toContain('900');
    expect(html).toContain('vbt-velocity-feedback');
    expect(html).toContain('Est. RPE');
  });

  it('includes power when available', () => {
    const reading = makeReading({ meanVelocity: 0.6, power: 500 });
    const html = renderVelocityFeedback(reading, 'squat');
    expect(html).toContain('500');
    expect(html).toContain('W');
  });

  it('omits power when not available', () => {
    const reading = makeReading({ meanVelocity: 0.6, power: undefined });
    const html = renderVelocityFeedback(reading, 'squat');
    expect(html).not.toContain('vbt-power');
  });
});

describe('renderVelocityLossIndicator', () => {
  it('shows message for insufficient reps', () => {
    const html = renderVelocityLossIndicator([makeReading()]);
    expect(html).toContain('Need 2+ reps');
  });

  it('shows loss percentage for multiple reps', () => {
    const readings = [
      makeReading({ meanVelocity: 0.60 }),
      makeReading({ meanVelocity: 0.55 }),
      makeReading({ meanVelocity: 0.50 }),
    ];
    const html = renderVelocityLossIndicator(readings);
    expect(html).toContain('velocity loss');
    expect(html).toContain('0.60');
    expect(html).toContain('0.50');
  });

  it('shows stop warning when loss exceeds 20%', () => {
    const readings = [
      makeReading({ meanVelocity: 0.60 }),
      makeReading({ meanVelocity: 0.45 }),
    ];
    const html = renderVelocityLossIndicator(readings);
    expect(html).toContain('loss-critical');
    expect(html).toContain('Stop set');
  });
});

describe('renderLoadVelocityChart', () => {
  it('renders empty state for no data', () => {
    const html = renderLoadVelocityChart([]);
    expect(html).toContain('No load-velocity data');
  });

  it('renders table rows sorted by weight', () => {
    const pairs = [
      { weight: 100, velocity: 0.60 },
      { weight: 60, velocity: 0.80 },
      { weight: 80, velocity: 0.70 },
    ];
    const html = renderLoadVelocityChart(pairs);
    expect(html).toContain('vbt-lv-chart');
    // Check all weights appear
    expect(html).toContain('60');
    expect(html).toContain('80');
    expect(html).toContain('100');
    // Verify sort order: 60 should appear before 100
    const idx60 = html.indexOf('60');
    const idx100 = html.indexOf('100');
    expect(idx60).toBeLessThan(idx100);
  });
});
