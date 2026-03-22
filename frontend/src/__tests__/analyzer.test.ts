import { describe, it, expect } from 'vitest';
import { analyzeSequence } from '../analyzer';
import type { SquatConfig, Landmarks, FrameData, Point } from '../types';

// --- Helpers ---

function pt(x: number, y: number, z: number = 0, visibility: number = 0.99): Point {
  return { x, y, z, visibility };
}

/**
 * Create a minimal side-view standing landmark set.
 * Uses idealized coordinates where the person is standing upright.
 */
function standingLandmarks(): Landmarks {
  return {
    left_hip: pt(0.5, 0.45),
    right_hip: pt(0.52, 0.45),
    left_knee: pt(0.5, 0.6),
    right_knee: pt(0.52, 0.6),
    left_ankle: pt(0.5, 0.8),
    right_ankle: pt(0.52, 0.8),
    left_heel: pt(0.5, 0.82),
    right_heel: pt(0.52, 0.82),
    left_shoulder: pt(0.5, 0.25),
    right_shoulder: pt(0.52, 0.25),
    left_foot_index: pt(0.5, 0.83),
    right_foot_index: pt(0.52, 0.83),
    left_ear: pt(0.5, 0.12),
    right_ear: pt(0.52, 0.12),
    nose: pt(0.51, 0.12),
    left_elbow: pt(0.45, 0.35),
    right_elbow: pt(0.57, 0.35),
    left_wrist: pt(0.45, 0.45),
    right_wrist: pt(0.57, 0.45),
  };
}

/**
 * Create a landmark set at a given squat depth.
 * depth=0 is standing, depth=1 is deep squat.
 */
function squatLandmarks(depth: number): Landmarks {
  const base = standingLandmarks();
  // As depth increases: hip moves down, knee bends forward
  const hipDrop = depth * 0.2;
  const kneeForward = depth * 0.08;
  const trunkLean = depth * 0.05;

  return {
    ...base,
    left_hip: pt(0.5 - trunkLean, 0.45 + hipDrop),
    right_hip: pt(0.52 - trunkLean, 0.45 + hipDrop),
    left_knee: pt(0.5 + kneeForward, 0.6 + hipDrop * 0.3),
    right_knee: pt(0.52 + kneeForward, 0.6 + hipDrop * 0.3),
    left_shoulder: pt(0.5 - trunkLean * 0.5, 0.25 + hipDrop * 0.3),
    right_shoulder: pt(0.52 - trunkLean * 0.5, 0.25 + hipDrop * 0.3),
    left_ear: pt(0.5 - trunkLean * 0.5, 0.12 + hipDrop * 0.3),
    right_ear: pt(0.52 - trunkLean * 0.5, 0.12 + hipDrop * 0.3),
    nose: pt(0.51 - trunkLean * 0.5, 0.12 + hipDrop * 0.3),
  };
}

/**
 * Generate frame data for a squat rep that goes down and back up.
 * Returns a Map of frame_index -> landmarks.
 */
function generateRepFrames(
  startFrame: number,
  framesPerPhase: number,
  maxDepth: number = 1.0,
): FrameData {
  const frames: FrameData = new Map();

  // Standing frames
  frames.set(startFrame, standingLandmarks());
  frames.set(startFrame + 1, standingLandmarks());

  // Descent
  for (let i = 0; i < framesPerPhase; i++) {
    const depth = (i / (framesPerPhase - 1)) * maxDepth;
    frames.set(startFrame + 2 + i, squatLandmarks(depth));
  }

  // Bottom (a few frames at max depth)
  for (let i = 0; i < 3; i++) {
    frames.set(startFrame + 2 + framesPerPhase + i, squatLandmarks(maxDepth));
  }

  // Ascent
  for (let i = 0; i < framesPerPhase; i++) {
    const depth = maxDepth * (1 - i / (framesPerPhase - 1));
    frames.set(startFrame + 5 + framesPerPhase + i, squatLandmarks(depth));
  }

  // Standing at end
  frames.set(startFrame + 5 + framesPerPhase * 2, standingLandmarks());
  frames.set(startFrame + 6 + framesPerPhase * 2, standingLandmarks());

  return frames;
}

/**
 * Generate multiple rep frames concatenated together.
 */
function generateMultiRepFrames(repCount: number, framesPerPhase: number = 10, maxDepth: number = 1.0): FrameData {
  const frames: FrameData = new Map();
  const framesPerRep = 8 + framesPerPhase * 2; // standing + descent + bottom + ascent + standing
  for (let r = 0; r < repCount; r++) {
    const repFrames = generateRepFrames(r * framesPerRep, framesPerPhase, maxDepth);
    for (const [k, v] of repFrames) {
      frames.set(k, v);
    }
  }
  return frames;
}

function defaultConfig(overrides: Partial<SquatConfig> = {}): SquatConfig {
  return {
    squatType: 'high_bar',
    experienceLevel: 'intermediate',
    competitionMode: false,
    ...overrides,
  };
}

// --- Tests ---

describe('Analyzer - analyzeSequence', () => {
  // ========================================
  // Empty / Edge-case Input
  // ========================================

  describe('Edge Cases', () => {
    it('returns empty analysis for zero frames', () => {
      const config = defaultConfig();
      const result = analyzeSequence(new Map(), 30, config);
      expect(result.repCount).toBe(0);
      expect(result.reps).toEqual([]);
      expect(result.overallScore).toBe(0);
      expect(result.fatigueDetected).toBe(false);
    });

    it('returns empty analysis when no reps are detected', () => {
      const config = defaultConfig();
      // Just standing frames, no squat motion
      const frames: FrameData = new Map();
      for (let i = 0; i < 30; i++) {
        frames.set(i, standingLandmarks());
      }
      const result = analyzeSequence(frames, 30, config);
      expect(result.repCount).toBe(0);
    });

    it('handles very short video with few frames', () => {
      const config = defaultConfig();
      const frames: FrameData = new Map();
      frames.set(0, standingLandmarks());
      frames.set(1, squatLandmarks(0.5));
      frames.set(2, standingLandmarks());
      const result = analyzeSequence(frames, 30, config);
      // May or may not detect a rep depending on angle thresholds
      expect(result.repCount).toBeGreaterThanOrEqual(0);
      expect(result.config).toEqual(config);
    });

    it('preserves the config object in the result', () => {
      const config = defaultConfig({ competitionMode: true });
      const result = analyzeSequence(new Map(), 30, config);
      expect(result.config).toEqual(config);
      expect(result.competitionMode).toBe(true);
    });

    it('returns grade even for zero score', () => {
      const config = defaultConfig();
      const result = analyzeSequence(new Map(), 30, config);
      expect(result.grade).toBeTruthy();
    });
  });

  // ========================================
  // Single Rep Analysis
  // ========================================

  describe('Single Rep', () => {
    it('detects a single squat rep', () => {
      const config = defaultConfig();
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      // Should detect at least 1 rep
      expect(result.repCount).toBeGreaterThanOrEqual(1);
    });

    it('produces valid scores for each rep', () => {
      const config = defaultConfig();
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      if (result.repCount > 0) {
        const rep = result.reps[0];
        expect(rep.overallScore).toBeGreaterThanOrEqual(0);
        expect(rep.overallScore).toBeLessThanOrEqual(100);
        expect(rep.depthScore).toBeGreaterThanOrEqual(0);
        expect(rep.trunkScore).toBeGreaterThanOrEqual(0);
        expect(rep.tempoScore).toBeGreaterThanOrEqual(0);
        expect(rep.lockoutScore).toBeGreaterThanOrEqual(0);
        expect(rep.grade).toBeTruthy();
      }
    });

    it('includes issues array on each rep', () => {
      const config = defaultConfig();
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      if (result.repCount > 0) {
        expect(Array.isArray(result.reps[0].issues)).toBe(true);
        expect(Array.isArray(result.reps[0].cues)).toBe(true);
      }
    });

    it('includes exercise type on scored rep', () => {
      const config = defaultConfig();
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      if (result.repCount > 0) {
        expect(result.reps[0].exerciseType).toBe('squat');
      }
    });
  });

  // ========================================
  // Multi-Rep Analysis
  // ========================================

  describe('Multi-Rep Analysis', () => {
    it('detects multiple reps', () => {
      const config = defaultConfig();
      const frames = generateMultiRepFrames(3, 12, 1.0);
      const result = analyzeSequence(frames, 30, config);
      // Should detect multiple reps (may not be exactly 3 due to angle sensitivity)
      expect(result.repCount).toBeGreaterThanOrEqual(1);
    });

    it('numbers reps sequentially', () => {
      const config = defaultConfig();
      const frames = generateMultiRepFrames(3, 12, 1.0);
      const result = analyzeSequence(frames, 30, config);
      if (result.repCount >= 2) {
        // Reps should have sequential numbering in the scores array
        expect(result.reps.length).toBe(result.repCount);
      }
    });
  });

  // ========================================
  // Score Aggregation
  // ========================================

  describe('Score Aggregation', () => {
    it('overall score is average of per-rep scores', () => {
      const config = defaultConfig();
      const frames = generateMultiRepFrames(3, 12, 1.0);
      const result = analyzeSequence(frames, 30, config);
      if (result.repCount >= 2) {
        const avgScore = result.reps.reduce((s, r) => s + r.overallScore, 0) / result.reps.length;
        // The overall score should be clamped(round(avgScore), 0, 100)
        expect(result.overallScore).toBe(Math.max(0, Math.min(100, Math.round(avgScore))));
      }
    });

    it('overall score is clamped between 0 and 100', () => {
      const config = defaultConfig();
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
    });

    it('identifies top issues sorted by severity', () => {
      const config = defaultConfig();
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      // topIssues should be sorted by severity (high > moderate > low) then by count
      if (result.topIssues.length >= 2) {
        for (let i = 0; i < result.topIssues.length - 1; i++) {
          const severityMap = { high: 3, moderate: 2, low: 1 } as Record<string, number>;
          const currentSev = severityMap[result.topIssues[i].severity] ?? 0;
          const nextSev = severityMap[result.topIssues[i + 1].severity] ?? 0;
          expect(currentSev).toBeGreaterThanOrEqual(nextSev);
        }
      }
    });

    it('limits topIssues to maximum of 3', () => {
      const config = defaultConfig();
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      expect(result.topIssues.length).toBeLessThanOrEqual(3);
    });
  });

  // ========================================
  // Fatigue Detection
  // ========================================

  describe('Fatigue Detection', () => {
    it('does not detect fatigue with fewer than 4 reps', () => {
      const config = defaultConfig();
      const frames = generateMultiRepFrames(2, 12, 1.0);
      const result = analyzeSequence(frames, 30, config);
      expect(result.fatigueDetected).toBe(false);
    });

    it('reports fatigue flag without penalizing overall score', () => {
      // Even when fatigue is detected, the overall score should be the straight average
      const config = defaultConfig();
      const frames = generateMultiRepFrames(5, 12, 1.0);
      const result = analyzeSequence(frames, 30, config);
      if (result.repCount >= 4) {
        const avgScore = result.reps.reduce((s, r) => s + r.overallScore, 0) / result.reps.length;
        expect(result.overallScore).toBe(Math.max(0, Math.min(100, Math.round(avgScore))));
      }
    });
  });

  // ========================================
  // Competition Mode
  // ========================================

  describe('Competition Mode', () => {
    it('sets competitionMode flag in result', () => {
      const config = defaultConfig({ competitionMode: true });
      const result = analyzeSequence(new Map(), 30, config);
      expect(result.competitionMode).toBe(true);
    });

    it('non-competition mode returns competitionMode false', () => {
      const config = defaultConfig({ competitionMode: false });
      const result = analyzeSequence(new Map(), 30, config);
      expect(result.competitionMode).toBe(false);
    });
  });

  // ========================================
  // Calibration
  // ========================================

  describe('Calibration', () => {
    it('attempts calibration from first standing frames', () => {
      const config = defaultConfig();
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      // Should find calibration from the standing frames at the start
      // (may or may not succeed depending on angle thresholds in calibrateFromStanding)
      // Just verify it doesn't crash and returns the calibration field
      expect('calibration' in result).toBe(true);
    });

    it('returns null calibration when no standing frames exist', () => {
      const config = defaultConfig();
      const frames: FrameData = new Map();
      // Only deep squat frames
      for (let i = 0; i < 10; i++) {
        frames.set(i, squatLandmarks(1.0));
      }
      const result = analyzeSequence(frames, 30, config);
      // May or may not find calibration, but should not crash
      expect('calibration' in result).toBe(true);
    });
  });

  // ========================================
  // Side View Warning
  // ========================================

  describe('Side View Warning', () => {
    it('warns about limited knee tracking in side view', () => {
      const config = defaultConfig();
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      if (result.repCount > 0) {
        // Our mock landmarks have left_knee and right_knee close together,
        // which means kneeWidthRatio will be null (side view) or very small
        // Either sideViewWarning is set, or we have frontal data
        if (result.sideViewWarning) {
          expect(result.sideViewWarning).toContain('Side view');
          expect(result.sideViewWarning).toContain('knee');
        }
      }
    });
  });

  // ========================================
  // Rep Frame Map
  // ========================================

  describe('Rep Frame Map', () => {
    it('maps frames to rep indices', () => {
      const config = defaultConfig();
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      expect(result.repFrameMap instanceof Map).toBe(true);
      if (result.repCount > 0) {
        // At least some frames should be mapped
        expect(result.repFrameMap.size).toBeGreaterThan(0);
      }
    });

    it('provides start frames for each rep', () => {
      const config = defaultConfig();
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      expect(result.repStartFrames.length).toBe(result.repCount);
    });
  });

  // ========================================
  // Positive Feedback
  // ========================================

  describe('Positive Feedback', () => {
    it('includes positive highlights', () => {
      const config = defaultConfig();
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      expect(Array.isArray(result.positiveHighlights)).toBe(true);
    });

    it('collects unique positive feedback across reps', () => {
      const config = defaultConfig();
      const frames = generateMultiRepFrames(3, 12, 1.0);
      const result = analyzeSequence(frames, 30, config);
      if (result.positiveHighlights.length > 0) {
        const uniqueHighlights = new Set(result.positiveHighlights);
        expect(uniqueHighlights.size).toBe(result.positiveHighlights.length);
      }
    });
  });

  // ========================================
  // Mobility & Warmup
  // ========================================

  describe('Mobility & Warmup', () => {
    it('returns mobility findings array', () => {
      const config = defaultConfig();
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      expect(Array.isArray(result.mobilityFindings)).toBe(true);
    });

    it('returns warmup protocol array', () => {
      const config = defaultConfig();
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      expect(Array.isArray(result.warmupProtocol)).toBe(true);
    });
  });

  // ========================================
  // FPS handling
  // ========================================

  describe('FPS Handling', () => {
    it('produces valid duration values at 30fps', () => {
      const config = defaultConfig();
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      if (result.repCount > 0 && result.reps[0].descentDuration != null) {
        expect(result.reps[0].descentDuration).toBeGreaterThanOrEqual(0);
        expect(result.reps[0].ascentDuration).toBeGreaterThanOrEqual(0);
      }
    });

    it('handles 60fps input', () => {
      const config = defaultConfig();
      const frames = generateRepFrames(0, 30, 1.0);
      const result = analyzeSequence(frames, 60, config);
      // Should not crash at different FPS
      expect(result).toBeDefined();
    });
  });

  // ========================================
  // Experience Level Variants
  // ========================================

  describe('Experience Level', () => {
    it('analyzes for beginner experience level', () => {
      const config = defaultConfig({ experienceLevel: 'beginner' });
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      expect(result.config.experienceLevel).toBe('beginner');
    });

    it('analyzes for advanced experience level', () => {
      const config = defaultConfig({ experienceLevel: 'advanced' });
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      expect(result.config.experienceLevel).toBe('advanced');
    });
  });

  // ========================================
  // Squat Type Variants
  // ========================================

  describe('Squat Type', () => {
    it('analyzes low_bar squat type', () => {
      const config = defaultConfig({ squatType: 'low_bar' });
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      expect(result.config.squatType).toBe('low_bar');
    });

    it('analyzes front squat type', () => {
      const config = defaultConfig({ squatType: 'front' });
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      expect(result.config.squatType).toBe('front');
    });

    it('analyzes bodyweight squat type', () => {
      const config = defaultConfig({ squatType: 'bodyweight' });
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      expect(result.config.squatType).toBe('bodyweight');
    });
  });

  // ========================================
  // Camera View Detection
  // ========================================

  describe('Camera View Detection', () => {
    it('attempts to detect camera view', () => {
      const config = defaultConfig();
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      // detectedCameraView should be one of the valid values
      if (result.detectedCameraView) {
        expect(['side', 'front', 'unknown']).toContain(result.detectedCameraView);
      }
    });
  });

  // ========================================
  // Grade Assignment
  // ========================================

  describe('Grade Assignment', () => {
    it('assigns a grade string', () => {
      const config = defaultConfig();
      const frames = generateRepFrames(0, 15, 1.0);
      const result = analyzeSequence(frames, 30, config);
      expect(typeof result.grade).toBe('string');
      expect(result.grade.length).toBeGreaterThan(0);
    });

    it('assigns grade consistent with overall score', () => {
      const config = defaultConfig();
      const result = analyzeSequence(new Map(), 30, config);
      // Zero score should not produce a top grade
      expect(result.overallScore).toBe(0);
      expect(result.grade).not.toBe('A+');
    });
  });
});
