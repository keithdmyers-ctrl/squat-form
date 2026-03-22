/**
 * Tests for issue detection — safety-critical module that identifies form
 * problems. Incorrect thresholds could miss dangerous form or create false alarms.
 *
 * Covers: detectRepIssues (all 14 issue types), getCuesForIssues,
 * CUE_DATABASE, severity system, experience-level adaptations, competition mode.
 */

import { describe, it, expect } from 'vitest';
import {
  detectRepIssues,
  getCuesForIssues,
  CUE_DATABASE,
} from '../issues';
import type {
  RepData,
  FrameAngles,
  SquatConfig,
  FormIssue,
  CalibrationData,
} from '../types';
import {
  SquatType,
  SquatPhase,
  IssueSeverity,
} from '../types';
import {
  DEPTH_THRESHOLDS,
  ANGLE_TOLERANCES,
  VALGUS_THRESHOLDS,
} from '../scorer';

// ─── Helpers ───

function makeFrameAngles(overrides: Partial<FrameAngles> = {}): FrameAngles {
  return {
    kneeAngle: 90,
    hipAngle: 90,
    ankleAngle: 80,
    trunkAngle: 35,
    shinAngle: 25,
    kneeWidthRatio: 0.95,
    hipSymmetry: 0.02,
    ...overrides,
  };
}

function makeRepData(overrides: Partial<RepData> = {}): RepData {
  return {
    repNumber: 1,
    startFrame: 0,
    endFrame: 100,
    bottomFrame: 50,
    minKneeAngle: 85,
    minHipAngle: 70,
    maxTrunkAngle: 40,
    descentDuration: 2.0,
    bottomDuration: 0.5,
    ascentDuration: 1.5,
    frameAngles: [makeFrameAngles()],
    heelRise: false,
    buttWink: false,
    goodMorning: false,
    kneeValgus: false,
    trunkAngleChangeOnAscent: 5,
    pelvicTiltAtBottom: 3,
    stickingPoints: [],
    ...overrides,
  };
}

function makeConfig(overrides: Partial<SquatConfig> = {}): SquatConfig {
  return {
    squatType: SquatType.HIGH_BAR,
    experienceLevel: 'intermediate',
    competitionMode: false,
    ...overrides,
  };
}

// ═══════════════════════════════════════
// 1. Depth Check
// ═══════════════════════════════════════

describe('depth_insufficient', () => {
  it('should flag high squat (120 degrees) for intermediate as LOW', () => {
    // intermediate threshold=100, MODERATE when > 100+20=120. 120 is not > 120, so LOW.
    const rep = makeRepData({ minKneeAngle: 120 });
    const config = makeConfig({ experienceLevel: 'intermediate' });
    const issues = detectRepIssues(rep, config, null);
    const depthIssue = issues.find(i => i.name === 'insufficient_depth');
    expect(depthIssue).toBeDefined();
    expect(depthIssue!.severity).toBe(IssueSeverity.LOW);
  });

  it('should not flag deep squat (80 degrees) for advanced', () => {
    const rep = makeRepData({ minKneeAngle: 80 });
    const config = makeConfig({ experienceLevel: 'advanced' });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'insufficient_depth')).toBeUndefined();
  });

  it('should not flag parallel squat (100 degrees) for intermediate', () => {
    const rep = makeRepData({ minKneeAngle: 100 });
    const config = makeConfig({ experienceLevel: 'intermediate' });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'insufficient_depth')).toBeUndefined();
  });

  it('should use beginner threshold (110 degrees) for beginners', () => {
    // 111 > 110 threshold, but only by 1 degree => LOW
    const rep = makeRepData({ minKneeAngle: 111 });
    const config = makeConfig({ experienceLevel: 'beginner' });
    const issues = detectRepIssues(rep, config, null);
    const depthIssue = issues.find(i => i.name === 'insufficient_depth');
    expect(depthIssue).toBeDefined();
    expect(depthIssue!.severity).toBe(IssueSeverity.LOW);
  });

  it('should use advanced threshold (90 degrees) for advanced', () => {
    const rep = makeRepData({ minKneeAngle: 95 });
    const config = makeConfig({ experienceLevel: 'advanced' });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'insufficient_depth')).toBeDefined();
  });

  it('should have MODERATE severity when well above threshold', () => {
    // intermediate threshold=100, +20=120. 125 > 120 => MODERATE
    const rep = makeRepData({ minKneeAngle: 125 });
    const config = makeConfig({ experienceLevel: 'intermediate' });
    const issues = detectRepIssues(rep, config, null);
    const depthIssue = issues.find(i => i.name === 'insufficient_depth');
    expect(depthIssue).toBeDefined();
    expect(depthIssue!.severity).toBe(IssueSeverity.MODERATE);
  });
});

// ═══════════════════════════════════════
// 2. Knee Valgus
// ═══════════════════════════════════════

describe('knee_valgus', () => {
  it('should flag valgus when kneeValgus is true', () => {
    const rep = makeRepData({
      kneeValgus: true,
      frameAngles: [makeFrameAngles({ kneeWidthRatio: 0.55 })],
    });
    const config = makeConfig({ experienceLevel: 'intermediate' });
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'knee_valgus');
    expect(issue).toBeDefined();
  });

  it('should not flag valgus when kneeValgus is false', () => {
    const rep = makeRepData({ kneeValgus: false });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'knee_valgus')).toBeUndefined();
  });

  it('should assign HIGH severity for severe valgus (ratio far below threshold)', () => {
    // intermediate threshold=0.75, ratio=0.55 => distance=0.20 > 0.15 => HIGH
    const rep = makeRepData({
      kneeValgus: true,
      frameAngles: [makeFrameAngles({ kneeWidthRatio: 0.55 })],
    });
    const config = makeConfig({ experienceLevel: 'intermediate' });
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'knee_valgus');
    expect(issue!.severity).toBe(IssueSeverity.HIGH);
  });

  it('should assign MODERATE severity for moderate valgus', () => {
    // intermediate threshold=0.75, ratio=0.65 => distance=0.10 > 0.05 but <= 0.15 => MODERATE
    const rep = makeRepData({
      kneeValgus: true,
      frameAngles: [makeFrameAngles({ kneeWidthRatio: 0.65 })],
    });
    const config = makeConfig({ experienceLevel: 'intermediate' });
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'knee_valgus');
    expect(issue!.severity).toBe(IssueSeverity.MODERATE);
  });

  it('should assign LOW severity for mild valgus', () => {
    // intermediate threshold=0.75, ratio=0.73 => distance=0.02 <= 0.05 => LOW
    const rep = makeRepData({
      kneeValgus: true,
      frameAngles: [makeFrameAngles({ kneeWidthRatio: 0.73 })],
    });
    const config = makeConfig({ experienceLevel: 'intermediate' });
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'knee_valgus');
    expect(issue!.severity).toBe(IssueSeverity.LOW);
  });

  it('should use worst knee width ratio from all frames', () => {
    const rep = makeRepData({
      kneeValgus: true,
      frameAngles: [
        makeFrameAngles({ kneeWidthRatio: 0.90 }),
        makeFrameAngles({ kneeWidthRatio: 0.55 }),
        makeFrameAngles({ kneeWidthRatio: 0.85 }),
      ],
    });
    const config = makeConfig({ experienceLevel: 'intermediate' });
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'knee_valgus');
    expect(issue).toBeDefined();
    expect(issue!.value).toBe(0.55);
    expect(issue!.severity).toBe(IssueSeverity.HIGH);
  });
});

// ═══════════════════════════════════════
// 3. Excessive Forward Lean
// ═══════════════════════════════════════

describe('excessive_forward_lean', () => {
  it('should flag excessive trunk angle', () => {
    // High bar max expected = 50 (from TRUNK_ANGLE_RANGES), tolerance intermediate=15
    // maxTrunkAngle > 50 + 15 = 65
    const rep = makeRepData({ maxTrunkAngle: 70 });
    const config = makeConfig({ squatType: SquatType.HIGH_BAR, experienceLevel: 'intermediate' });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'excessive_forward_lean')).toBeDefined();
  });

  it('should not flag normal trunk angle for high-bar', () => {
    const rep = makeRepData({ maxTrunkAngle: 45 });
    const config = makeConfig({ squatType: SquatType.HIGH_BAR, experienceLevel: 'intermediate' });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'excessive_forward_lean')).toBeUndefined();
  });

  it('should allow more forward lean for low-bar squats', () => {
    // Low bar max expected = 60, intermediate tolerance = 15
    // 70 < 60 + 15 = 75, so no issue
    const rep = makeRepData({ maxTrunkAngle: 70 });
    const config = makeConfig({ squatType: SquatType.LOW_BAR, experienceLevel: 'intermediate' });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'excessive_forward_lean')).toBeUndefined();
  });

  it('should flag HIGH severity for extreme forward lean', () => {
    // high bar max = 50, tolerance = 15, so threshold = 65
    // HIGH when > 50 + 15 * 3 = 95
    const rep = makeRepData({ maxTrunkAngle: 100 });
    const config = makeConfig({ squatType: SquatType.HIGH_BAR, experienceLevel: 'intermediate' });
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'excessive_forward_lean');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe(IssueSeverity.HIGH);
  });
});

// ═══════════════════════════════════════
// 4. Good Morning Pattern
// ═══════════════════════════════════════

describe('good_morning', () => {
  it('should flag good morning when trunk angle increases on ascent', () => {
    const rep = makeRepData({ trunkAngleChangeOnAscent: 20 });
    const config = makeConfig({ squatType: SquatType.HIGH_BAR });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'good_morning')).toBeDefined();
  });

  it('should not flag slight trunk change', () => {
    const rep = makeRepData({ trunkAngleChangeOnAscent: 10 });
    const config = makeConfig({ squatType: SquatType.HIGH_BAR });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'good_morning')).toBeUndefined();
  });

  it('should use higher threshold (20 degrees) for low-bar squats', () => {
    const rep = makeRepData({ trunkAngleChangeOnAscent: 18 });
    const config = makeConfig({ squatType: SquatType.LOW_BAR });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'good_morning')).toBeUndefined();
  });

  it('should flag low-bar at 25 degrees (above 20 threshold)', () => {
    const rep = makeRepData({ trunkAngleChangeOnAscent: 25 });
    const config = makeConfig({ squatType: SquatType.LOW_BAR });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'good_morning')).toBeDefined();
  });

  it('should assign HIGH severity for extreme good morning', () => {
    // high bar threshold=15, HIGH when > 15 + 15 = 30
    const rep = makeRepData({ trunkAngleChangeOnAscent: 35 });
    const config = makeConfig({ squatType: SquatType.HIGH_BAR });
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'good_morning');
    expect(issue!.severity).toBe(IssueSeverity.HIGH);
  });
});

// ═══════════════════════════════════════
// 5. Butt Wink
// ═══════════════════════════════════════

describe('butt_wink', () => {
  it('should flag butt wink when detected', () => {
    const rep = makeRepData({ buttWink: true, pelvicTiltAtBottom: 12 });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'butt_wink');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe(IssueSeverity.MODERATE);
  });

  it('should not flag when butt wink is false', () => {
    const rep = makeRepData({ buttWink: false });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'butt_wink')).toBeUndefined();
  });

  it('should record pelvic tilt value', () => {
    const rep = makeRepData({ buttWink: true, pelvicTiltAtBottom: 15 });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'butt_wink');
    expect(issue!.value).toBe(15);
    expect(issue!.threshold).toBe(8);
  });
});

// ═══════════════════════════════════════
// 6. Heel Rise
// ═══════════════════════════════════════

describe('heel_rise', () => {
  it('should flag when heelRise is true', () => {
    const rep = makeRepData({ heelRise: true });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'heel_rise');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe(IssueSeverity.MODERATE);
  });

  it('should not flag when heelRise is false', () => {
    const rep = makeRepData({ heelRise: false });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'heel_rise')).toBeUndefined();
  });
});

// ═══════════════════════════════════════
// 7. Fast Descent
// ═══════════════════════════════════════

describe('fast_descent', () => {
  it('should flag descent under 1.2 seconds', () => {
    const rep = makeRepData({ descentDuration: 0.8 });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'fast_descent');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe(IssueSeverity.LOW);
  });

  it('should not flag descent of 2 seconds', () => {
    const rep = makeRepData({ descentDuration: 2.0 });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'fast_descent')).toBeUndefined();
  });

  it('should not flag descent of exactly 1.2 seconds', () => {
    const rep = makeRepData({ descentDuration: 1.2 });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'fast_descent')).toBeUndefined();
  });
});

// ═══════════════════════════════════════
// 8. Incomplete Lockout
// ═══════════════════════════════════════

describe('incomplete_lockout', () => {
  it('should flag when final knee angles are below 160 degrees', () => {
    const frames = [
      makeFrameAngles({ kneeAngle: 140 }),
      makeFrameAngles({ kneeAngle: 145 }),
      makeFrameAngles({ kneeAngle: 150 }),
      makeFrameAngles({ kneeAngle: 152 }),
      makeFrameAngles({ kneeAngle: 155 }),
    ];
    const rep = makeRepData({ frameAngles: frames });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'incomplete_lockout')).toBeDefined();
  });

  it('should not flag when final knee angles are above 160 degrees', () => {
    const frames = [
      makeFrameAngles({ kneeAngle: 160 }),
      makeFrameAngles({ kneeAngle: 165 }),
      makeFrameAngles({ kneeAngle: 170 }),
      makeFrameAngles({ kneeAngle: 172 }),
      makeFrameAngles({ kneeAngle: 175 }),
    ];
    const rep = makeRepData({ frameAngles: frames });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'incomplete_lockout')).toBeUndefined();
  });
});

// ═══════════════════════════════════════
// 9. Bouncing
// ═══════════════════════════════════════

describe('bouncing', () => {
  it('should flag bouncing for beginner with very short bottom duration', () => {
    const rep = makeRepData({ bottomDuration: 0.05 });
    const config = makeConfig({ experienceLevel: 'beginner' });
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'bouncing');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe(IssueSeverity.MODERATE);
  });

  it('should flag bouncing for intermediate', () => {
    const rep = makeRepData({ bottomDuration: 0.05 });
    const config = makeConfig({ experienceLevel: 'intermediate' });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'bouncing')).toBeDefined();
  });

  it('should exempt advanced lifters in training mode', () => {
    const rep = makeRepData({ bottomDuration: 0.05 });
    const config = makeConfig({ experienceLevel: 'advanced', competitionMode: false });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'bouncing')).toBeUndefined();
  });

  it('should flag advanced lifters in competition mode with LOW severity', () => {
    const rep = makeRepData({ bottomDuration: 0.05 });
    const config = makeConfig({ experienceLevel: 'advanced', competitionMode: true });
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'bouncing');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe(IssueSeverity.LOW);
  });

  it('should not flag adequate bottom duration', () => {
    const rep = makeRepData({ bottomDuration: 0.5 });
    const config = makeConfig({ experienceLevel: 'beginner' });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'bouncing')).toBeUndefined();
  });
});

// ═══════════════════════════════════════
// 10. Asymmetric Shift
// ═══════════════════════════════════════

describe('asymmetric_shift', () => {
  it('should flag high asymmetry for beginner (threshold 0.10)', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ hipSymmetry: 0.15 })],
    });
    const config = makeConfig({ experienceLevel: 'beginner' });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'asymmetric_shift')).toBeDefined();
  });

  it('should flag moderate asymmetry for advanced (threshold 0.05)', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ hipSymmetry: 0.08 })],
    });
    const config = makeConfig({ experienceLevel: 'advanced' });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'asymmetric_shift')).toBeDefined();
  });

  it('should not flag low asymmetry for beginner', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ hipSymmetry: 0.05 })],
    });
    const config = makeConfig({ experienceLevel: 'beginner' });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'asymmetric_shift')).toBeUndefined();
  });

  it('should have MODERATE severity for high asymmetry (>0.30)', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ hipSymmetry: 0.35 })],
    });
    const config = makeConfig({ experienceLevel: 'intermediate' });
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'asymmetric_shift');
    expect(issue!.severity).toBe(IssueSeverity.MODERATE);
  });

  it('should skip when hipSymmetry is null', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ hipSymmetry: null })],
    });
    const config = makeConfig({ experienceLevel: 'advanced' });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'asymmetric_shift')).toBeUndefined();
  });
});

// ═══════════════════════════════════════
// 11. Excessive Forward Knee Travel
// ═══════════════════════════════════════

describe('excessive_forward_knee_travel', () => {
  it('should only flag for low-bar squats', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ shinAngle: 50 })],
    });
    const lowBar = makeConfig({ squatType: SquatType.LOW_BAR });
    const highBar = makeConfig({ squatType: SquatType.HIGH_BAR });

    const lowBarIssues = detectRepIssues(rep, lowBar, null);
    const highBarIssues = detectRepIssues(rep, highBar, null);

    expect(lowBarIssues.find(i => i.name === 'excessive_forward_knee_travel')).toBeDefined();
    expect(highBarIssues.find(i => i.name === 'excessive_forward_knee_travel')).toBeUndefined();
  });

  it('should not flag shin angle at or below 45 degrees', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ shinAngle: 45 })],
    });
    const config = makeConfig({ squatType: SquatType.LOW_BAR });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'excessive_forward_knee_travel')).toBeUndefined();
  });
});

// ═══════════════════════════════════════
// 12. Bracing Reminder
// ═══════════════════════════════════════

describe('bracing_reminder', () => {
  it('should trigger when good morning pattern detected', () => {
    const rep = makeRepData({ goodMorning: true, trunkAngleChangeOnAscent: 12 });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'bracing_reminder');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe(IssueSeverity.LOW);
  });

  it('should trigger when trunk angle change exceeds 10 degrees', () => {
    const rep = makeRepData({ goodMorning: false, trunkAngleChangeOnAscent: 12 });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'bracing_reminder')).toBeDefined();
  });

  it('should trigger on poor trunk score (large overshoot)', () => {
    // high bar max expected = 50, intermediate tolerance = 15
    // trunk overshoot > tolerance * 2 = 30
    // so maxTrunkAngle > 50 + 30 = 80
    const rep = makeRepData({ maxTrunkAngle: 85, trunkAngleChangeOnAscent: 5 });
    const config = makeConfig({ squatType: SquatType.HIGH_BAR, experienceLevel: 'intermediate' });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'bracing_reminder')).toBeDefined();
  });

  it('should always be LOW severity', () => {
    const rep = makeRepData({ goodMorning: true, trunkAngleChangeOnAscent: 50 });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'bracing_reminder');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe(IssueSeverity.LOW);
  });

  it('should not trigger when trunk is stable', () => {
    const rep = makeRepData({
      goodMorning: false,
      trunkAngleChangeOnAscent: 5,
      maxTrunkAngle: 40,
    });
    const config = makeConfig({ squatType: SquatType.HIGH_BAR, experienceLevel: 'intermediate' });
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'bracing_reminder')).toBeUndefined();
  });
});

// ═══════════════════════════════════════
// 13. Lateral Shift
// ═══════════════════════════════════════

describe('lateral_shift', () => {
  it('should flag shift above 0.03 threshold', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ lateralShift: 0.05 })],
    });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'lateral_shift');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe(IssueSeverity.LOW);
  });

  it('should assign MODERATE severity for shift > 0.06', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ lateralShift: 0.08 })],
    });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'lateral_shift');
    expect(issue!.severity).toBe(IssueSeverity.MODERATE);
  });

  it('should assign HIGH severity for shift > 0.10', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ lateralShift: 0.15 })],
    });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'lateral_shift');
    expect(issue!.severity).toBe(IssueSeverity.HIGH);
  });

  it('should not flag shift at or below 0.03', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ lateralShift: 0.02 })],
    });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'lateral_shift')).toBeUndefined();
  });

  it('should handle negative lateral shift (shift to left)', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ lateralShift: -0.12 })],
    });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'lateral_shift');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe(IssueSeverity.HIGH);
  });

  it('should skip when lateralShift is undefined', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ lateralShift: undefined })],
    });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'lateral_shift')).toBeUndefined();
  });
});

// ═══════════════════════════════════════
// 14. Cervical Hyperextension
// ═══════════════════════════════════════

describe('cervical_hyperextension', () => {
  it('should flag neck angle above 15 degrees', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ neckAngle: 18 })],
    });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'cervical_hyperextension');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe(IssueSeverity.LOW);
  });

  it('should assign MODERATE severity for angle > 25', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ neckAngle: 30 })],
    });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'cervical_hyperextension');
    expect(issue!.severity).toBe(IssueSeverity.MODERATE);
  });

  it('should assign HIGH severity for angle > 35', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ neckAngle: 40 })],
    });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    const issue = issues.find(i => i.name === 'cervical_hyperextension');
    expect(issue!.severity).toBe(IssueSeverity.HIGH);
  });

  it('should not flag neutral neck (angle <= 15)', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ neckAngle: 12 })],
    });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'cervical_hyperextension')).toBeUndefined();
  });

  it('should skip when neckAngle is undefined', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ neckAngle: undefined })],
    });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    expect(issues.find(i => i.name === 'cervical_hyperextension')).toBeUndefined();
  });
});

// ═══════════════════════════════════════
// Edge Cases
// ═══════════════════════════════════════

describe('edge cases', () => {
  it('should handle empty frameAngles array', () => {
    const rep = makeRepData({ frameAngles: [] });
    const config = makeConfig();
    // Should not throw
    const issues = detectRepIssues(rep, config, null);
    expect(Array.isArray(issues)).toBe(true);
  });

  it('should handle single frame rep', () => {
    const rep = makeRepData({
      frameAngles: [makeFrameAngles({ kneeAngle: 170 })],
    });
    const config = makeConfig();
    const issues = detectRepIssues(rep, config, null);
    expect(Array.isArray(issues)).toBe(true);
  });

  it('should handle rep with no issues (perfect form)', () => {
    const rep = makeRepData({
      minKneeAngle: 80,
      maxTrunkAngle: 35,
      descentDuration: 2.5,
      bottomDuration: 0.8,
      trunkAngleChangeOnAscent: 3,
      heelRise: false,
      buttWink: false,
      goodMorning: false,
      kneeValgus: false,
      pelvicTiltAtBottom: 2,
      frameAngles: [
        makeFrameAngles({
          kneeAngle: 170,
          hipSymmetry: 0.01,
          lateralShift: 0.01,
          neckAngle: 5,
          shinAngle: 20,
        }),
        makeFrameAngles({
          kneeAngle: 175,
          hipSymmetry: 0.01,
          lateralShift: 0.01,
          neckAngle: 5,
          shinAngle: 20,
        }),
        makeFrameAngles({
          kneeAngle: 172,
          hipSymmetry: 0.01,
          lateralShift: 0.01,
          neckAngle: 5,
          shinAngle: 20,
        }),
        makeFrameAngles({
          kneeAngle: 174,
          hipSymmetry: 0.01,
          lateralShift: 0.01,
          neckAngle: 5,
          shinAngle: 20,
        }),
        makeFrameAngles({
          kneeAngle: 176,
          hipSymmetry: 0.01,
          lateralShift: 0.01,
          neckAngle: 5,
          shinAngle: 20,
        }),
      ],
    });
    const config = makeConfig({ experienceLevel: 'beginner' });
    const issues = detectRepIssues(rep, config, null);
    expect(issues).toHaveLength(0);
  });

  it('should produce multiple issues from a single bad rep', () => {
    const rep = makeRepData({
      minKneeAngle: 130,           // high squat
      maxTrunkAngle: 100,          // excessive lean
      descentDuration: 0.5,        // fast descent
      bottomDuration: 0.01,        // bouncing
      trunkAngleChangeOnAscent: 25, // good morning
      heelRise: true,              // heel rise
      buttWink: true,              // butt wink
      kneeValgus: true,            // knee valgus
      pelvicTiltAtBottom: 15,
      frameAngles: [
        makeFrameAngles({
          kneeAngle: 140,
          kneeWidthRatio: 0.50,
          hipSymmetry: 0.40,
          lateralShift: 0.15,
          neckAngle: 40,
          shinAngle: 50,
        }),
      ],
    });
    const config = makeConfig({ squatType: SquatType.LOW_BAR, experienceLevel: 'intermediate' });
    const issues = detectRepIssues(rep, config, null);
    // Should detect many issues from this terrible rep
    expect(issues.length).toBeGreaterThanOrEqual(6);
    const issueNames = issues.map(i => i.name);
    expect(issueNames).toContain('insufficient_depth');
    expect(issueNames).toContain('heel_rise');
    expect(issueNames).toContain('buttWink' in issueNames ? 'butt_wink' : 'butt_wink');
    expect(issueNames).toContain('knee_valgus');
    expect(issueNames).toContain('fast_descent');
    expect(issueNames).toContain('bouncing');
  });
});

// ═══════════════════════════════════════
// Coaching Cues
// ═══════════════════════════════════════

describe('getCuesForIssues', () => {
  it('should return cues for detected issues', () => {
    const issues: FormIssue[] = [
      {
        name: 'knee_valgus',
        severity: IssueSeverity.MODERATE,
        description: 'Test',
        value: 0.65,
        threshold: 0.75,
        phase: SquatPhase.ASCENDING,
        frame: 50,
      },
    ];
    const cues = getCuesForIssues(issues);
    expect(cues.length).toBe(1);
    expect(cues[0].issue).toBe('knee_valgus');
    expect(cues[0].cue).toBe(CUE_DATABASE.knee_valgus.cue);
  });

  it('should use beginner explanation when experienceLevel is beginner', () => {
    const issues: FormIssue[] = [
      {
        name: 'knee_valgus',
        severity: IssueSeverity.MODERATE,
        description: 'Test',
        value: 0.65,
        threshold: 0.75,
        phase: SquatPhase.ASCENDING,
        frame: 50,
      },
    ];
    const cues = getCuesForIssues(issues, 'beginner');
    expect(cues[0].explanation).toContain('caving inward');
  });

  it('should use LOW explanation for low severity', () => {
    const issues: FormIssue[] = [
      {
        name: 'knee_valgus',
        severity: IssueSeverity.LOW,
        description: 'Test',
        value: 0.73,
        threshold: 0.75,
        phase: SquatPhase.ASCENDING,
        frame: 50,
      },
    ];
    const cues = getCuesForIssues(issues, 'intermediate');
    expect(cues[0].explanation).toContain('Minor');
  });

  it('should use HIGH explanation for high severity', () => {
    const issues: FormIssue[] = [
      {
        name: 'knee_valgus',
        severity: IssueSeverity.HIGH,
        description: 'Test',
        value: 0.50,
        threshold: 0.75,
        phase: SquatPhase.ASCENDING,
        frame: 50,
      },
    ];
    const cues = getCuesForIssues(issues, 'advanced');
    expect(cues[0].explanation).toContain('Significant');
  });

  it('should strip citations for beginners', () => {
    const issues: FormIssue[] = [
      {
        name: 'knee_valgus',
        severity: IssueSeverity.MODERATE,
        description: 'Test',
        value: 0.65,
        threshold: 0.75,
        phase: SquatPhase.ASCENDING,
        frame: 50,
      },
    ];
    const cues = getCuesForIssues(issues, 'beginner');
    // Beginner explanation shouldn't have academic citations
    expect(cues[0].explanation).not.toMatch(/et al\./);
  });

  it('should sort cues by priority (lower number first)', () => {
    const issues: FormIssue[] = [
      {
        name: 'insufficient_depth',
        severity: IssueSeverity.LOW,
        description: 'Test',
        value: 105,
        threshold: 100,
        phase: SquatPhase.BOTTOM,
        frame: 50,
      },
      {
        name: 'knee_valgus',
        severity: IssueSeverity.MODERATE,
        description: 'Test',
        value: 0.65,
        threshold: 0.75,
        phase: SquatPhase.ASCENDING,
        frame: 50,
      },
    ];
    const cues = getCuesForIssues(issues);
    // knee_valgus has priority 1, insufficient_depth has priority 5
    expect(cues[0].issue).toBe('knee_valgus');
    expect(cues[1].issue).toBe('insufficient_depth');
  });

  it('should deduplicate issues by name', () => {
    const issues: FormIssue[] = [
      {
        name: 'heel_rise',
        severity: IssueSeverity.MODERATE,
        description: 'First',
        value: 1,
        threshold: 0,
        phase: SquatPhase.DESCENDING,
        frame: 20,
      },
      {
        name: 'heel_rise',
        severity: IssueSeverity.HIGH,
        description: 'Second',
        value: 1,
        threshold: 0,
        phase: SquatPhase.DESCENDING,
        frame: 40,
      },
    ];
    const cues = getCuesForIssues(issues);
    const heelCues = cues.filter(c => c.issue === 'heel_rise');
    expect(heelCues).toHaveLength(1);
  });

  it('should return empty array for empty issues', () => {
    const cues = getCuesForIssues([]);
    expect(cues).toHaveLength(0);
  });

  it('should skip unknown issue names gracefully', () => {
    const issues: FormIssue[] = [
      {
        name: 'unknown_issue_xyz',
        severity: IssueSeverity.LOW,
        description: 'Test',
        value: 0,
        threshold: 0,
        phase: SquatPhase.STANDING,
        frame: 0,
      },
    ];
    const cues = getCuesForIssues(issues);
    expect(cues).toHaveLength(0);
  });
});

// ═══════════════════════════════════════
// CUE_DATABASE Integrity
// ═══════════════════════════════════════

describe('CUE_DATABASE', () => {
  it('should have entries for all squat issue types', () => {
    const squat_issues = [
      'knee_valgus', 'butt_wink', 'excessive_forward_lean', 'good_morning',
      'heel_rise', 'insufficient_depth', 'fast_descent', 'slow_descent',
      'bouncing', 'incomplete_lockout', 'asymmetric_hips', 'asymmetric_shift',
    ];
    for (const issue of squat_issues) {
      expect(CUE_DATABASE).toHaveProperty(issue);
    }
  });

  it('should have entries for deadlift issue types', () => {
    expect(CUE_DATABASE).toHaveProperty('rounded_back');
    expect(CUE_DATABASE).toHaveProperty('hip_shoot');
    expect(CUE_DATABASE).toHaveProperty('hitching');
  });

  it('should have entries for bench issue types', () => {
    expect(CUE_DATABASE).toHaveProperty('no_pause');
    expect(CUE_DATABASE).toHaveProperty('uneven_press');
  });

  it('should have entries for cross-exercise issue types', () => {
    expect(CUE_DATABASE).toHaveProperty('bracing_reminder');
    expect(CUE_DATABASE).toHaveProperty('lateral_shift');
    expect(CUE_DATABASE).toHaveProperty('cervical_hyperextension');
  });

  it('every entry should have cue, priority, and explanation', () => {
    for (const [key, entry] of Object.entries(CUE_DATABASE)) {
      expect(entry.cue).toBeTruthy();
      expect(typeof entry.priority).toBe('number');
      expect(entry.explanation).toBeTruthy();
    }
  });

  it('every entry should have beginner explanation', () => {
    for (const [key, entry] of Object.entries(CUE_DATABASE)) {
      expect(entry.explanationBeginner).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════
// Severity Threshold Consistency
// ═══════════════════════════════════════

describe('severity thresholds', () => {
  it('beginner depth threshold should be more lenient than advanced', () => {
    expect(DEPTH_THRESHOLDS.beginner).toBeGreaterThan(DEPTH_THRESHOLDS.advanced);
  });

  it('beginner valgus threshold should be more lenient than advanced', () => {
    expect(VALGUS_THRESHOLDS.beginner).toBeLessThan(VALGUS_THRESHOLDS.advanced);
  });

  it('beginner angle tolerance should be more lenient than advanced', () => {
    expect(ANGLE_TOLERANCES.beginner).toBeGreaterThan(ANGLE_TOLERANCES.advanced);
  });
});
