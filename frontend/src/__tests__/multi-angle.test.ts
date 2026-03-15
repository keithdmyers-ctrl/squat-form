/**
 * Tests for multi-angle video analysis merging.
 * Covers: rep alignment, score merging, cue deduplication,
 * alignment quality detection, and fallback behavior.
 */
import { describe, it, expect } from 'vitest';

import {
  mergeMultiAngleAnalysis,
  mergeRepScores,
  computeMergedOverall,
  deduplicateCues,
  alignReps,
} from '../multi-angle';
import type { MultiAngleResult } from '../multi-angle';
import type {
  SetAnalysis,
  RepScore,
  FormIssue,
  CoachingCue,
  CalibrationData,
  BaseExerciseConfig,
} from '../types';

// ════════════════════════════════════════════════════════════════════════
// Test Helpers
// ════════════════════════════════════════════════════════════════════════

/** Create a minimal RepScore with specified dimension scores. */
function makeRepScore(overrides: Partial<RepScore> = {}): RepScore {
  return {
    depthScore: 85,
    kneeTrackingScore: 70,
    trunkScore: 90,
    symmetryScore: 75,
    tempoScore: 80,
    lockoutScore: 95,
    overallScore: 82,
    grade: 'B',
    issues: [],
    cues: [],
    positiveFeedback: [],
    stickingPoints: [],
    minKneeAngle: 85,
    maxTrunkAngle: 25,
    minHipAngle: 80,
    descentDuration: 2.0,
    ascentDuration: 1.5,
    bottomDuration: 0.3,
    ...overrides,
  };
}

/** Create a minimal SetAnalysis with the specified reps. */
function makeSetAnalysis(
  reps: RepScore[],
  overrides: Partial<SetAnalysis> = {},
): SetAnalysis {
  const config: BaseExerciseConfig = {
    squatType: 'high_bar',
    experienceLevel: 'intermediate',
    competitionMode: false,
  };
  return {
    repCount: reps.length,
    reps,
    overallScore: reps.length > 0
      ? Math.round(reps.reduce((s, r) => s + r.overallScore, 0) / reps.length)
      : 0,
    grade: 'B',
    fatigueDetected: false,
    topIssues: [],
    topCues: [],
    calibration: null,
    config,
    repFrameMap: new Map(),
    repStartFrames: reps.map((_, i) => i * 90),
    positiveHighlights: [],
    mobilityFindings: [],
    warmupProtocol: [],
    competitionMode: false,
    ...overrides,
  };
}

/** Create a FormIssue with the given name and severity. */
function makeIssue(name: string, severity: 'high' | 'moderate' | 'low' = 'moderate'): FormIssue {
  return {
    name,
    severity,
    description: `Issue: ${name}`,
    value: 1,
    threshold: 0.5,
    phase: 'descending',
    frame: 10,
  };
}

/** Create a CoachingCue. */
function makeCue(issue: string, priority: number = 1): CoachingCue {
  return {
    issue,
    cue: `Fix ${issue}`,
    priority,
    explanation: `Explanation for ${issue}`,
  };
}

// ════════════════════════════════════════════════════════════════════════
// alignReps
// ════════════════════════════════════════════════════════════════════════

describe('alignReps', () => {
  it('returns 1:1 mapping when rep counts match', () => {
    const sideReps = [makeRepScore(), makeRepScore(), makeRepScore()];
    const frontReps = [makeRepScore(), makeRepScore(), makeRepScore()];
    const mapping = alignReps(sideReps, frontReps, [0, 90, 180], [0, 90, 180]);

    expect(mapping).not.toBeNull();
    expect(mapping!.size).toBe(3);
    expect(mapping!.get(0)).toBe(0);
    expect(mapping!.get(1)).toBe(1);
    expect(mapping!.get(2)).toBe(2);
  });

  it('returns 1:1 mapping for single rep on each side', () => {
    const sideReps = [makeRepScore()];
    const frontReps = [makeRepScore()];
    const mapping = alignReps(sideReps, frontReps, [0], [0]);

    expect(mapping).not.toBeNull();
    expect(mapping!.size).toBe(1);
    expect(mapping!.get(0)).toBe(0);
  });

  it('handles off-by-one when side has extra rep', () => {
    const sideReps = [makeRepScore(), makeRepScore(), makeRepScore()];
    const frontReps = [makeRepScore(), makeRepScore()];
    // Side frames: 0, 90, 180; Front frames: 0, 90
    const mapping = alignReps(sideReps, frontReps, [0, 90, 180], [0, 90]);

    expect(mapping).not.toBeNull();
    // Should map 2 reps (front has 2)
    expect(mapping!.size).toBe(2);
  });

  it('handles off-by-one when front has extra rep', () => {
    const sideReps = [makeRepScore(), makeRepScore()];
    const frontReps = [makeRepScore(), makeRepScore(), makeRepScore()];
    const mapping = alignReps(sideReps, frontReps, [0, 90], [0, 90, 180]);

    expect(mapping).not.toBeNull();
    expect(mapping!.size).toBe(2);
  });

  it('returns null when rep counts differ by more than 1', () => {
    const sideReps = [makeRepScore(), makeRepScore(), makeRepScore(), makeRepScore()];
    const frontReps = [makeRepScore()];
    const mapping = alignReps(sideReps, frontReps, [0, 90, 180, 270], [0]);

    expect(mapping).toBeNull();
  });

  it('returns null when either rep list is empty', () => {
    expect(alignReps([], [makeRepScore()], [], [0])).toBeNull();
    expect(alignReps([makeRepScore()], [], [0], [])).toBeNull();
    expect(alignReps([], [], [], [])).toBeNull();
  });

  it('uses timing information to find best offset', () => {
    // Side: reps at frames 0, 80, 200, 350 (non-uniform spacing: 80, 120, 150)
    // Front: reps at frames 0, 120, 270 (non-uniform spacing: 120, 150)
    // Offset=0: side gaps [80, 120] vs front gaps [120, 150] => diff = |80-120| + |120-150| = 70
    // Offset=1: side gaps [120, 150] vs front gaps [120, 150] => diff = 0 + 0 = 0
    // So offset=1 wins, mapping side[1]->front[0], side[2]->front[1], side[3]->front[2]
    const sideReps = [makeRepScore(), makeRepScore(), makeRepScore(), makeRepScore()];
    const frontReps = [makeRepScore(), makeRepScore(), makeRepScore()];
    const mapping = alignReps(
      sideReps, frontReps,
      [0, 80, 200, 350],
      [0, 120, 270],
    );

    expect(mapping).not.toBeNull();
    expect(mapping!.size).toBe(3);
    // With best offset=1, should map side[1]->front[0], side[2]->front[1], side[3]->front[2]
    expect(mapping!.get(1)).toBe(0);
    expect(mapping!.get(2)).toBe(1);
    expect(mapping!.get(3)).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════
// computeMergedOverall
// ════════════════════════════════════════════════════════════════════════

describe('computeMergedOverall', () => {
  it('computes weighted average from side depth/trunk/tempo/lockout and front knee/symmetry', () => {
    const sideRep = makeRepScore({
      depthScore: 100,
      trunkScore: 100,
      tempoScore: 100,
      lockoutScore: 100,
      kneeTrackingScore: 50, // Should be ignored
      symmetryScore: 50,    // Should be ignored
    });
    const frontRep = makeRepScore({
      kneeTrackingScore: 100,
      symmetryScore: 100,
      depthScore: 50,       // Should be ignored
      trunkScore: 50,       // Should be ignored
    });

    const score = computeMergedOverall(sideRep, frontRep);
    // depth*0.25 + knee*0.20 + trunk*0.20 + symmetry*0.10 + tempo*0.10 + lockout*0.15
    // = 100*0.25 + 100*0.20 + 100*0.20 + 100*0.10 + 100*0.10 + 100*0.15 = 100
    expect(score).toBe(100);
  });

  it('uses side scores for depth and front scores for knee tracking', () => {
    const sideRep = makeRepScore({
      depthScore: 90,
      trunkScore: 80,
      tempoScore: 70,
      lockoutScore: 85,
      kneeTrackingScore: 30, // Intentionally bad, should be overridden
      symmetryScore: 30,
    });
    const frontRep = makeRepScore({
      kneeTrackingScore: 95,
      symmetryScore: 90,
    });

    const score = computeMergedOverall(sideRep, frontRep);
    // = 90*0.25 + 95*0.20 + 80*0.20 + 90*0.10 + 70*0.10 + 85*0.15
    // = 22.5 + 19 + 16 + 9 + 7 + 12.75 = 86.25 -> 86
    expect(score).toBe(86);
  });

  it('clamps to 0-100 range', () => {
    const lowRep = makeRepScore({
      depthScore: 0, trunkScore: 0, tempoScore: 0, lockoutScore: 0,
    });
    const lowFront = makeRepScore({
      kneeTrackingScore: 0, symmetryScore: 0,
    });
    expect(computeMergedOverall(lowRep, lowFront)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════
// mergeRepScores
// ════════════════════════════════════════════════════════════════════════

describe('mergeRepScores', () => {
  it('takes depth and trunk from side, knee tracking and symmetry from front', () => {
    const sideRep = makeRepScore({
      depthScore: 95,
      trunkScore: 88,
      tempoScore: 82,
      lockoutScore: 90,
      kneeTrackingScore: 50,
      symmetryScore: 60,
    });
    const frontRep = makeRepScore({
      kneeTrackingScore: 92,
      symmetryScore: 85,
      depthScore: 40,
      trunkScore: 30,
    });

    const merged = mergeRepScores(sideRep, frontRep);

    expect(merged.depthScore).toBe(95);     // from side
    expect(merged.trunkScore).toBe(88);     // from side
    expect(merged.tempoScore).toBe(82);     // from side
    expect(merged.lockoutScore).toBe(90);   // from side
    expect(merged.kneeTrackingScore).toBe(92); // from front
    expect(merged.symmetryScore).toBe(85);     // from front
  });

  it('merges issues: side non-frontal + front frontal issues', () => {
    const sideRep = makeRepScore({
      issues: [
        makeIssue('insufficient_depth', 'moderate'),
        makeIssue('excessive_trunk_lean', 'low'),
      ],
    });
    const frontRep = makeRepScore({
      issues: [
        makeIssue('knee_valgus', 'high'),
        makeIssue('hip_asymmetry', 'moderate'),
        makeIssue('insufficient_depth', 'low'), // Duplicate, not a front issue
      ],
    });

    const merged = mergeRepScores(sideRep, frontRep);

    // Should include side issues (non-frontal) + front issues (frontal only)
    const issueNames = merged.issues.map(i => i.name);
    expect(issueNames).toContain('insufficient_depth');
    expect(issueNames).toContain('excessive_trunk_lean');
    expect(issueNames).toContain('knee_valgus');
    expect(issueNames).toContain('hip_asymmetry');
  });

  it('deduplicates coaching cues from both views', () => {
    const sideRep = makeRepScore({
      cues: [makeCue('depth', 3), makeCue('trunk_lean', 2)],
    });
    const frontRep = makeRepScore({
      cues: [makeCue('depth', 1), makeCue('knee_valgus', 5)],
    });

    const merged = mergeRepScores(sideRep, frontRep);

    // 'depth' should appear only once, with higher priority (3)
    const depthCues = merged.cues.filter(c => c.issue === 'depth');
    expect(depthCues.length).toBe(1);
    expect(depthCues[0].priority).toBe(3);

    // All unique cues should be present
    const cueIssues = merged.cues.map(c => c.issue);
    expect(cueIssues).toContain('trunk_lean');
    expect(cueIssues).toContain('knee_valgus');
  });

  it('preserves side view sticking points and bar path', () => {
    const stickingPoint = {
      frame: 50,
      kneeAngle: 95,
      depthPercentage: 60,
      velocityDrop: 30,
      description: 'Sticking at parallel',
    };
    const sideRep = makeRepScore({ stickingPoints: [stickingPoint] });
    const frontRep = makeRepScore({ stickingPoints: [] });

    const merged = mergeRepScores(sideRep, frontRep);
    expect(merged.stickingPoints).toEqual([stickingPoint]);
  });

  it('merges positive feedback from both views', () => {
    const sideRep = makeRepScore({
      positiveFeedback: ['Great depth', 'Good tempo'],
    });
    const frontRep = makeRepScore({
      positiveFeedback: ['Great depth', 'Excellent knee tracking'],
    });

    const merged = mergeRepScores(sideRep, frontRep);
    expect(merged.positiveFeedback).toContain('Great depth');
    expect(merged.positiveFeedback).toContain('Good tempo');
    expect(merged.positiveFeedback).toContain('Excellent knee tracking');
    // 'Great depth' should only appear once
    expect(merged.positiveFeedback.filter(f => f === 'Great depth').length).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════
// deduplicateCues
// ════════════════════════════════════════════════════════════════════════

describe('deduplicateCues', () => {
  it('removes duplicate cues by issue name, keeping higher priority', () => {
    const cues: CoachingCue[] = [
      makeCue('depth', 1),
      makeCue('depth', 5),
      makeCue('knee', 3),
    ];

    const deduped = deduplicateCues(cues);
    expect(deduped.length).toBe(2);

    const depthCue = deduped.find(c => c.issue === 'depth');
    expect(depthCue!.priority).toBe(5);
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateCues([])).toEqual([]);
  });

  it('sorts by priority descending', () => {
    const cues: CoachingCue[] = [
      makeCue('a', 1),
      makeCue('b', 10),
      makeCue('c', 5),
    ];
    const deduped = deduplicateCues(cues);
    expect(deduped[0].issue).toBe('b');
    expect(deduped[1].issue).toBe('c');
    expect(deduped[2].issue).toBe('a');
  });
});

// ════════════════════════════════════════════════════════════════════════
// mergeMultiAngleAnalysis
// ════════════════════════════════════════════════════════════════════════

describe('mergeMultiAngleAnalysis', () => {
  it('returns good alignment quality when rep counts match', () => {
    const sideReps = [makeRepScore(), makeRepScore(), makeRepScore()];
    const frontReps = [makeRepScore(), makeRepScore(), makeRepScore()];
    const side = makeSetAnalysis(sideReps);
    const front = makeSetAnalysis(frontReps);

    const result = mergeMultiAngleAnalysis(side, front);

    expect(result.alignmentQuality).toBe('good');
    expect(result.merged.repCount).toBe(3);
    expect(result.merged.multiAngleUsed).toBe(true);
    expect(result.merged.multiAngleAlignmentQuality).toBe('good');
  });

  it('returns fair alignment quality when rep counts differ by 1', () => {
    const sideReps = [makeRepScore(), makeRepScore(), makeRepScore()];
    const frontReps = [makeRepScore(), makeRepScore()];
    const side = makeSetAnalysis(sideReps);
    const front = makeSetAnalysis(frontReps);

    const result = mergeMultiAngleAnalysis(side, front);

    expect(result.alignmentQuality).toBe('fair');
    expect(result.merged.repCount).toBe(3); // preserves all side reps
  });

  it('returns failed alignment when rep counts differ by more than 1', () => {
    const sideReps = [makeRepScore(), makeRepScore(), makeRepScore(), makeRepScore()];
    const frontReps = [makeRepScore()];
    const side = makeSetAnalysis(sideReps);
    const front = makeSetAnalysis(frontReps);

    const result = mergeMultiAngleAnalysis(side, front);

    expect(result.alignmentQuality).toBe('failed');
    // Should fall back to side analysis
    expect(result.merged.reps).toEqual(side.reps);
  });

  it('falls back to side analysis when alignment fails', () => {
    const sideReps = [
      makeRepScore({ depthScore: 95, overallScore: 88 }),
      makeRepScore({ depthScore: 90, overallScore: 85 }),
      makeRepScore({ depthScore: 92, overallScore: 87 }),
    ];
    const frontReps = [makeRepScore()]; // Only 1 front rep vs 3 side reps

    const side = makeSetAnalysis(sideReps);
    const front = makeSetAnalysis(frontReps);

    const result = mergeMultiAngleAnalysis(side, front);

    expect(result.alignmentQuality).toBe('failed');
    // Merged should be essentially the side analysis
    expect(result.merged.reps.length).toBe(3);
    expect(result.merged.sideViewWarning).toContain('alignment failed');
  });

  it('produces merged scores combining best dimensions from each view', () => {
    const sideReps = [
      makeRepScore({
        depthScore: 95,
        trunkScore: 88,
        tempoScore: 82,
        lockoutScore: 90,
        kneeTrackingScore: 50, // Bad from side view
        symmetryScore: 60,
      }),
    ];
    const frontReps = [
      makeRepScore({
        kneeTrackingScore: 92,
        symmetryScore: 85,
        depthScore: 40,  // Bad from front view
        trunkScore: 30,
      }),
    ];

    const side = makeSetAnalysis(sideReps);
    const front = makeSetAnalysis(frontReps);

    const result = mergeMultiAngleAnalysis(side, front);

    expect(result.alignmentQuality).toBe('good');
    const mergedRep = result.merged.reps[0];
    expect(mergedRep.depthScore).toBe(95);      // from side
    expect(mergedRep.kneeTrackingScore).toBe(92); // from front
    expect(mergedRep.trunkScore).toBe(88);       // from side
    expect(mergedRep.symmetryScore).toBe(85);     // from front
  });

  it('preserves side analysis and front analysis in result', () => {
    const side = makeSetAnalysis([makeRepScore()]);
    const front = makeSetAnalysis([makeRepScore()]);

    const result = mergeMultiAngleAnalysis(side, front);

    expect(result.sideAnalysis).toBe(side);
    expect(result.frontAnalysis).toBe(front);
  });

  it('handles zero-rep front analysis gracefully', () => {
    const sideReps = [makeRepScore(), makeRepScore()];
    const side = makeSetAnalysis(sideReps);
    const front = makeSetAnalysis([]); // No reps detected in front view

    const result = mergeMultiAngleAnalysis(side, front);

    expect(result.alignmentQuality).toBe('failed');
    expect(result.merged.repCount).toBe(2);
  });

  it('detects fatigue from merged scores', () => {
    // Need distinct dimension scores so merged overall scores differ by >15
    const goodRep = makeRepScore({
      depthScore: 95, trunkScore: 95, tempoScore: 95, lockoutScore: 95,
      kneeTrackingScore: 50, symmetryScore: 50,
    });
    const badRep = makeRepScore({
      depthScore: 40, trunkScore: 40, tempoScore: 40, lockoutScore: 40,
      kneeTrackingScore: 50, symmetryScore: 50,
    });
    const goodFront = makeRepScore({ kneeTrackingScore: 95, symmetryScore: 95 });
    const badFront = makeRepScore({ kneeTrackingScore: 40, symmetryScore: 40 });

    // 4 reps: first 2 good, last 2 bad -> should detect fatigue
    const sideReps = [goodRep, goodRep, badRep, badRep];
    const frontReps = [goodFront, goodFront, badFront, badFront];

    const side = makeSetAnalysis(sideReps);
    const front = makeSetAnalysis(frontReps);

    const result = mergeMultiAngleAnalysis(side, front);

    // Fatigue should be detected since merged scores differ significantly
    expect(result.merged.fatigueDetected).toBe(true);
  });

  it('computes correct overall set score from merged reps', () => {
    const sideReps = [
      makeRepScore({ depthScore: 100, trunkScore: 100, tempoScore: 100, lockoutScore: 100, kneeTrackingScore: 50, symmetryScore: 50 }),
      makeRepScore({ depthScore: 80, trunkScore: 80, tempoScore: 80, lockoutScore: 80, kneeTrackingScore: 50, symmetryScore: 50 }),
    ];
    const frontReps = [
      makeRepScore({ kneeTrackingScore: 100, symmetryScore: 100 }),
      makeRepScore({ kneeTrackingScore: 80, symmetryScore: 80 }),
    ];

    const side = makeSetAnalysis(sideReps);
    const front = makeSetAnalysis(frontReps);

    const result = mergeMultiAngleAnalysis(side, front);

    // Rep 1: 100*0.25 + 100*0.20 + 100*0.20 + 100*0.10 + 100*0.10 + 100*0.15 = 100
    // Rep 2: 80*0.25 + 80*0.20 + 80*0.20 + 80*0.10 + 80*0.10 + 80*0.15 = 80
    // Average: (100 + 80) / 2 = 90
    expect(result.merged.overallScore).toBe(90);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Edge Cases
// ════════════════════════════════════════════════════════════════════════

describe('edge cases', () => {
  it('handles high-severity issue penalty in merged scores', () => {
    const sideRep = makeRepScore({
      issues: [makeIssue('good_morning', 'high')],
    });
    const frontRep = makeRepScore({
      issues: [makeIssue('knee_valgus', 'high')],
    });

    const merged = mergeRepScores(sideRep, frontRep);
    // Two high-severity issues: -10 from overall
    const rawOverall = computeMergedOverall(sideRep, frontRep);
    expect(merged.overallScore).toBe(Math.max(0, rawOverall - 10));
  });
});
