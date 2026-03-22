/**
 * Shared exercise analysis utilities: common patterns extracted from
 * analyzer.ts, deadlift.ts, and bench.ts to reduce duplication.
 *
 * This module provides reusable helpers for:
 * - Fatigue detection across reps
 * - Top issue aggregation and ranking
 * - Set-level scoring from rep scores
 * - Empty analysis construction
 *
 * Each exercise analyzer uses these instead of duplicating the logic.
 */

import { severityRank } from './types';
import type { ExerciseType } from './types';
import type {
  FormIssue,
  RepScore,
  BaseExerciseConfig,
  SetAnalysis,
  CalibrationData,
} from './types';
import { clamp, scoreToGrade } from './scorer';

// ─── Fatigue Detection ───

/**
 * Detect fatigue by comparing first 2 reps to last 2 reps.
 * A drop of more than 15 points indicates fatigue.
 * (Based on Gonzalez-Badillo et al. 2017: velocity-based fatigue thresholds)
 */
export function detectFatigue(repScores: RepScore[]): boolean {
  if (repScores.length < 4) return false;
  const first2 = (repScores[0].overallScore + repScores[1].overallScore) / 2;
  const last2 = (
    repScores[repScores.length - 2].overallScore +
    repScores[repScores.length - 1].overallScore
  ) / 2;
  return first2 - last2 > 15;
}

// ─── Issue Aggregation ───

/**
 * Aggregate issues across all reps, ranking by severity then frequency.
 * Returns the top N most significant issues.
 */
export function aggregateTopIssues(
  repScores: RepScore[],
  maxIssues: number = 3,
): FormIssue[] {
  const allIssues = repScores.flatMap(r => r.issues);
  const issueCountMap = new Map<string, { issue: FormIssue; count: number }>();

  for (const issue of allIssues) {
    const existing = issueCountMap.get(issue.name);
    if (existing) {
      existing.count++;
      if (severityRank(issue.severity) > severityRank(existing.issue.severity)) {
        existing.issue = issue;
      }
    } else {
      issueCountMap.set(issue.name, { issue, count: 1 });
    }
  }

  return Array.from(issueCountMap.values())
    .sort((a, b) => {
      const sevDiff = severityRank(b.issue.severity) - severityRank(a.issue.severity);
      return sevDiff !== 0 ? sevDiff : b.count - a.count;
    })
    .slice(0, maxIssues)
    .map(e => e.issue);
}

// ─── Positive Feedback Aggregation ───

/**
 * Collect unique positive feedback strings across all reps.
 */
export function aggregatePositiveFeedback(repScores: RepScore[]): string[] {
  const positiveSet = new Set<string>();
  for (const rep of repScores) {
    for (const fb of rep.positiveFeedback) {
      positiveSet.add(fb);
    }
  }
  return Array.from(positiveSet);
}

// ─── Set-Level Scoring ───

/**
 * Compute overall set score from individual rep scores.
 */
export function computeSetScore(repScores: RepScore[]): number {
  if (repScores.length === 0) return 0;
  const avg = repScores.reduce((s, r) => s + r.overallScore, 0) / repScores.length;
  return clamp(Math.round(avg), 0, 100);
}

// ─── Empty Analysis Factory ───

/**
 * Create an empty SetAnalysis for when no reps are detected.
 */
export function createEmptyAnalysis(
  config: BaseExerciseConfig,
  calibration: CalibrationData | null = null,
  overrides: Partial<SetAnalysis> = {},
): SetAnalysis {
  return {
    repCount: 0,
    reps: [],
    overallScore: 0,
    grade: scoreToGrade(0, config.experienceLevel),
    fatigueDetected: false,
    topIssues: [],
    topCues: [],
    calibration,
    config,
    repFrameMap: new Map(),
    repStartFrames: [],
    positiveHighlights: [],
    mobilityFindings: [],
    warmupProtocol: [],
    competitionMode: config.competitionMode,
    ...overrides,
  };
}

// ─── Rep Frame Map Builder ───

/**
 * Build the frame-to-rep mapping from rep ranges.
 */
export function buildRepFrameMap(
  repRanges: { start: number; end: number }[],
  frameIndices: number[],
): { repFrameMap: Map<number, number>; repStartFrames: number[] } {
  const repFrameMap = new Map<number, number>();
  const repStartFrames: number[] = [];

  for (let r = 0; r < repRanges.length; r++) {
    const range = repRanges[r];
    repStartFrames.push(frameIndices[range.start] ?? 0);
    for (let i = range.start; i <= range.end && i < frameIndices.length; i++) {
      repFrameMap.set(frameIndices[i], r);
    }
  }

  return { repFrameMap, repStartFrames };
}

// ─── Score Dimension Labels ───

/**
 * Exercise-specific score dimension labels for UI display.
 * Maps the generic RepScore fields to exercise-appropriate names.
 */
export interface ScoreDimensionLabels {
  depth: string;
  kneeTracking: string;
  trunk: string;
  symmetry: string;
  tempo: string;
  lockout: string;
}

export const SQUAT_LABELS: ScoreDimensionLabels = {
  depth: 'Depth',
  kneeTracking: 'Knee Tracking',
  trunk: 'Torso Position',
  symmetry: 'Symmetry',
  tempo: 'Tempo',
  lockout: 'Lockout',
};

export const DEADLIFT_LABELS: ScoreDimensionLabels = {
  depth: 'Hip Hinge',
  kneeTracking: 'Control',
  trunk: 'Back Position',
  symmetry: 'Symmetry',
  tempo: 'Tempo',
  lockout: 'Lockout',
};

export const BENCH_LABELS: ScoreDimensionLabels = {
  depth: 'Range of Motion',
  kneeTracking: 'Control',
  trunk: 'Pause',
  symmetry: 'Symmetry',
  tempo: 'Tempo',
  lockout: 'Lockout',
};

export const OHP_LABELS: ScoreDimensionLabels = {
  depth: 'Range of Motion',
  kneeTracking: 'Press Path',
  trunk: 'Overhead Stability',
  symmetry: 'Symmetry',
  tempo: 'Tempo',
  lockout: 'Lockout',
};

export const ROW_LABELS: ScoreDimensionLabels = {
  depth: 'Row ROM',
  kneeTracking: 'Control',
  trunk: 'Back Position',
  symmetry: 'Symmetry',
  tempo: 'Tempo',
  lockout: 'Torso Stability',
};

export const LUNGE_LABELS: ScoreDimensionLabels = {
  depth: 'Depth',
  kneeTracking: 'Knee Tracking',
  trunk: 'Torso Position',
  symmetry: 'Balance',
  tempo: 'Tempo',
  lockout: 'Lockout',
};

/**
 * Get the appropriate dimension labels for an exercise type.
 */
export function getDimensionLabels(exerciseType: ExerciseType | string): ScoreDimensionLabels {
  switch (exerciseType) {
    case 'deadlift': return DEADLIFT_LABELS;
    case 'bench_press': return BENCH_LABELS;
    case 'overhead_press': return OHP_LABELS;
    case 'barbell_row': return ROW_LABELS;
    case 'lunge': return LUNGE_LABELS;
    default: return SQUAT_LABELS;
  }
}
