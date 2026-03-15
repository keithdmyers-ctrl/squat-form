/**
 * Multi-angle video analysis: merge results from two camera angles (side + front)
 * for more accurate scoring.
 *
 * Side view provides better data for: depth, trunk, tempo, lockout
 * Front view provides better data for: knee tracking (FPPA, valgus), symmetry
 *
 * When both views are available, the merged analysis combines the strongest
 * scoring dimensions from each view for a more complete assessment.
 */

import type {
  SetAnalysis,
  RepScore,
  FormIssue,
  CoachingCue,
} from './types';
import { WEIGHTS, clamp, scoreToGrade } from './scorer';

// ─── Public Types ───

export interface MultiAngleResult {
  /** The merged analysis combining best dimensions from each view. */
  merged: SetAnalysis;
  /** The analysis from the side camera (primary). */
  sideAnalysis: SetAnalysis;
  /** The analysis from the front camera (secondary). */
  frontAnalysis: SetAnalysis | null;
  /** Quality of the rep alignment between the two views. */
  alignmentQuality: 'good' | 'fair' | 'poor' | 'failed';
}

// ─── Alignment ───

/**
 * Attempt to align reps between two analyses by matching rep timing.
 *
 * Strategy:
 * - If rep counts match exactly, pair 1:1.
 * - If counts differ by 1, try shifting the shorter set to find the best
 *   alignment (by matching bottom-frame timing patterns).
 * - If counts differ by more than 1, alignment fails.
 *
 * @returns Map from side rep index (0-based) to front rep index (0-based),
 *          or null if alignment is not possible.
 */
export function alignReps(
  sideReps: RepScore[],
  frontReps: RepScore[],
  sideStartFrames: number[],
  frontStartFrames: number[],
): Map<number, number> | null {
  const sideCount = sideReps.length;
  const frontCount = frontReps.length;
  const diff = Math.abs(sideCount - frontCount);

  if (sideCount === 0 || frontCount === 0) {
    return null;
  }

  // Exact match: pair 1:1
  if (diff === 0) {
    const mapping = new Map<number, number>();
    for (let i = 0; i < sideCount; i++) {
      mapping.set(i, i);
    }
    return mapping;
  }

  // Off by 1: find best offset alignment
  if (diff === 1) {
    // The longer sequence has one extra rep. Try all possible offsets.
    if (sideCount > frontCount) {
      // Side has one extra rep. Try pairing front[0] with side[0] or side[1].
      return findBestOffset(sideStartFrames, frontStartFrames, sideCount, frontCount, 'side-longer');
    } else {
      // Front has one extra rep. Try pairing side[0] with front[0] or front[1].
      return findBestOffset(sideStartFrames, frontStartFrames, sideCount, frontCount, 'front-longer');
    }
  }

  // Off by more than 1: alignment fails
  return null;
}

/**
 * Find the best offset when rep counts differ by 1.
 * Returns a mapping from side rep index to front rep index.
 */
function findBestOffset(
  sideStartFrames: number[],
  frontStartFrames: number[],
  sideCount: number,
  frontCount: number,
  mode: 'side-longer' | 'front-longer',
): Map<number, number> | null {
  const mapping = new Map<number, number>();

  if (mode === 'side-longer') {
    // Side has sideCount reps, front has sideCount-1 reps.
    // Try offset=0: pair front[i] with side[i] (skip last side rep)
    // Try offset=1: pair front[i] with side[i+1] (skip first side rep)
    let bestOffset = 0;
    let bestScore = Infinity;

    for (let offset = 0; offset <= 1; offset++) {
      let totalDiff = 0;
      for (let fi = 0; fi < frontCount; fi++) {
        const si = fi + offset;
        if (si < sideCount && fi < frontStartFrames.length && si < sideStartFrames.length) {
          // Compare inter-rep spacing patterns (gaps between consecutive reps)
          // This is more robust than absolute timing since videos may not start simultaneously
          if (fi > 0 && si > 0) {
            const sideGap = sideStartFrames[si] - sideStartFrames[si - 1];
            const frontGap = frontStartFrames[fi] - frontStartFrames[fi - 1];
            totalDiff += Math.abs(sideGap - frontGap);
          }
        }
      }
      if (totalDiff < bestScore) {
        bestScore = totalDiff;
        bestOffset = offset;
      }
    }

    for (let fi = 0; fi < frontCount; fi++) {
      mapping.set(fi + bestOffset, fi);
    }
  } else {
    // Front has frontCount reps, side has frontCount-1 reps.
    // Try offset=0: pair side[i] with front[i] (skip last front rep)
    // Try offset=1: pair side[i] with front[i+1] (skip first front rep)
    let bestOffset = 0;
    let bestScore = Infinity;

    for (let offset = 0; offset <= 1; offset++) {
      let totalDiff = 0;
      for (let si = 0; si < sideCount; si++) {
        const fi = si + offset;
        if (fi < frontCount && si < sideStartFrames.length && fi < frontStartFrames.length) {
          // Compare inter-rep spacing patterns
          if (si > 0 && fi > 0) {
            const sideGap = sideStartFrames[si] - sideStartFrames[si - 1];
            const frontGap = frontStartFrames[fi] - frontStartFrames[fi - 1];
            totalDiff += Math.abs(sideGap - frontGap);
          }
        }
      }
      if (totalDiff < bestScore) {
        bestScore = totalDiff;
        bestOffset = offset;
      }
    }

    for (let si = 0; si < sideCount; si++) {
      mapping.set(si, si + bestOffset);
    }
  }

  return mapping;
}

// ─── Score Merging ───

/**
 * Compute the weighted overall score from merged dimension scores.
 * Uses the standard WEIGHTS from scorer.ts.
 */
export function computeMergedOverall(sideRep: RepScore, frontRep: RepScore): number {
  // Side view is authoritative for: depth, trunk, tempo, lockout
  // Front view is authoritative for: kneeTracking, symmetry
  const depth = sideRep.depthScore;
  const kneeTracking = frontRep.kneeTrackingScore;
  const trunk = sideRep.trunkScore;
  const symmetry = frontRep.symmetryScore;
  const tempo = sideRep.tempoScore;
  const lockout = sideRep.lockoutScore;

  return clamp(
    Math.round(
      depth * WEIGHTS.depth +
      kneeTracking * WEIGHTS.kneeTracking +
      trunk * WEIGHTS.trunk +
      symmetry * WEIGHTS.symmetry +
      tempo * WEIGHTS.tempo +
      lockout * WEIGHTS.lockout,
    ),
    0,
    100,
  );
}

/**
 * Deduplicate coaching cues by issue name, keeping the higher-priority version.
 */
export function deduplicateCues(cues: CoachingCue[]): CoachingCue[] {
  const seen = new Map<string, CoachingCue>();
  for (const cue of cues) {
    const existing = seen.get(cue.issue);
    if (!existing || cue.priority > existing.priority) {
      seen.set(cue.issue, cue);
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.priority - a.priority);
}

/** Issue names that are best detected from a front view. */
const FRONT_VIEW_ISSUE_NAMES = [
  'knee_valgus',
  'knee_cave',
  'valgus',
  'asymmetric',
  'asymmetry',
  'hip_shift',
  'hip_asymmetry',
  'lateral_shift',
  'frontal_plane',
  'fppa',
  'symmetry',
];

/**
 * Check if a form issue is better detected from a front view.
 */
function isFrontViewIssue(issue: FormIssue): boolean {
  const nameLower = issue.name.toLowerCase();
  return FRONT_VIEW_ISSUE_NAMES.some(keyword => nameLower.includes(keyword));
}

/**
 * Merge scores from a side rep and a front rep.
 *
 * Side view provides: depth, trunk, tempo, lockout scores.
 * Front view provides: knee tracking (FPPA), symmetry scores.
 */
export function mergeRepScores(sideRep: RepScore, frontRep: RepScore, experienceLevel?: string): RepScore {
  const overallScore = computeMergedOverall(sideRep, frontRep);

  // Merge issues: take all side issues + front-view-specific issues from front
  const sideIssues = sideRep.issues.filter(i => !isFrontViewIssue(i));
  const frontIssues = frontRep.issues.filter(i => isFrontViewIssue(i));
  const mergedIssues = [...sideIssues, ...frontIssues];

  // Merge cues from both views, deduplicating by issue name
  const mergedCues = deduplicateCues([...sideRep.cues, ...frontRep.cues]);

  // Merge positive feedback, deduplicating
  const positiveSet = new Set([...sideRep.positiveFeedback, ...frontRep.positiveFeedback]);

  // Apply high-severity penalty (same logic as analyzer.ts)
  let totalScore = overallScore;
  const highCount = mergedIssues.filter(i => i.severity === 'high').length;
  if (highCount > 0) {
    totalScore = Math.max(0, totalScore - highCount * 5);
  }

  return {
    depthScore: sideRep.depthScore,
    kneeTrackingScore: frontRep.kneeTrackingScore,
    trunkScore: sideRep.trunkScore,
    symmetryScore: frontRep.symmetryScore,
    tempoScore: sideRep.tempoScore,
    lockoutScore: sideRep.lockoutScore,
    overallScore: totalScore,
    grade: scoreToGrade(totalScore, experienceLevel as 'beginner' | 'intermediate' | 'advanced' | undefined),
    issues: mergedIssues,
    cues: mergedCues,
    positiveFeedback: Array.from(positiveSet),
    stickingPoints: sideRep.stickingPoints,
    barPath: sideRep.barPath,
    velocity: sideRep.velocity,
    competitionDepthPass: sideRep.competitionDepthPass,
    competitionDepthMargin: sideRep.competitionDepthMargin,
    avgConfidence: sideRep.avgConfidence,
    minKneeAngle: sideRep.minKneeAngle,
    maxTrunkAngle: sideRep.maxTrunkAngle,
    minHipAngle: sideRep.minHipAngle,
    descentDuration: sideRep.descentDuration,
    ascentDuration: sideRep.ascentDuration,
    bottomDuration: sideRep.bottomDuration,
  };
}

// ─── Main Entry Point ───

/**
 * Determine the alignment quality based on rep count difference and whether
 * alignment was successful.
 */
function determineAlignmentQuality(
  sideCount: number,
  frontCount: number,
  mapping: Map<number, number> | null,
): 'good' | 'fair' | 'poor' | 'failed' {
  if (!mapping) return 'failed';
  const diff = Math.abs(sideCount - frontCount);
  if (diff === 0 && mapping.size === sideCount) return 'good';
  if (diff <= 1 && mapping.size > 0) return 'fair';
  return 'poor';
}

/**
 * Merge analysis results from two camera angles (side + front) for more
 * accurate scoring.
 *
 * Time-aligns the two video analyses by matching phase transitions.
 * - Side view is authoritative for: depth, trunk, tempo, lockout scores
 * - Front view is authoritative for: knee tracking, symmetry, FPPA scores
 *
 * If alignment fails, returns the side analysis as primary with a warning.
 *
 * @param sideAnalysis Analysis from the side camera view
 * @param frontAnalysis Analysis from the front camera view
 * @returns Merged result with alignment quality indicator
 */
export function mergeMultiAngleAnalysis(
  sideAnalysis: SetAnalysis,
  frontAnalysis: SetAnalysis,
): MultiAngleResult {
  // Attempt to align reps
  const mapping = alignReps(
    sideAnalysis.reps,
    frontAnalysis.reps,
    sideAnalysis.repStartFrames,
    frontAnalysis.repStartFrames,
  );

  const alignmentQuality = determineAlignmentQuality(
    sideAnalysis.reps.length,
    frontAnalysis.reps.length,
    mapping,
  );

  // If alignment failed, return side analysis as primary
  if (!mapping || mapping.size === 0) {
    const merged = { ...sideAnalysis };
    merged.sideViewWarning = 'Multi-angle alignment failed -- using side view only. Ensure both videos show the same set.';
    return {
      merged,
      sideAnalysis,
      frontAnalysis,
      alignmentQuality: 'failed',
    };
  }

  // Merge aligned reps
  const mergedReps: RepScore[] = [];
  for (let si = 0; si < sideAnalysis.reps.length; si++) {
    const fi = mapping.get(si);
    if (fi !== undefined && fi < frontAnalysis.reps.length) {
      mergedReps.push(mergeRepScores(sideAnalysis.reps[si], frontAnalysis.reps[fi], sideAnalysis.config?.experienceLevel));
    } else {
      // No front rep for this side rep -- use side only
      mergedReps.push(sideAnalysis.reps[si]);
    }
  }

  // Compute overall set score from merged reps
  const avgScore = mergedReps.length > 0
    ? mergedReps.reduce((s, r) => s + r.overallScore, 0) / mergedReps.length
    : 0;
  const overallScore = clamp(Math.round(avgScore), 0, 100);

  // Fatigue detection from merged scores
  let fatigueDetected = false;
  if (mergedReps.length >= 4) {
    const first2Avg = (mergedReps[0].overallScore + mergedReps[1].overallScore) / 2;
    const last2Avg = (
      mergedReps[mergedReps.length - 2].overallScore +
      mergedReps[mergedReps.length - 1].overallScore
    ) / 2;
    fatigueDetected = first2Avg - last2Avg > 15;
  }

  // Merge top issues from both views
  const allIssues = mergedReps.flatMap(r => r.issues);
  const issueCountMap = new Map<string, { issue: FormIssue; count: number }>();
  for (const issue of allIssues) {
    const existing = issueCountMap.get(issue.name);
    if (existing) {
      existing.count++;
    } else {
      issueCountMap.set(issue.name, { issue, count: 1 });
    }
  }
  const topIssues = Array.from(issueCountMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(e => e.issue);

  // Merge top cues
  const allCues = mergedReps.flatMap(r => r.cues);
  const topCues = deduplicateCues(allCues).slice(0, 5);

  // Merge positive highlights
  const positiveSet = new Set<string>();
  for (const rep of mergedReps) {
    for (const fb of rep.positiveFeedback) {
      positiveSet.add(fb);
    }
  }

  // Build merged analysis, using side analysis as the base
  const experienceLevel = (sideAnalysis.config as { experienceLevel?: string })?.experienceLevel;
  const merged: SetAnalysis = {
    repCount: mergedReps.length,
    reps: mergedReps,
    overallScore,
    grade: scoreToGrade(overallScore, experienceLevel as 'beginner' | 'intermediate' | 'advanced' | undefined),
    fatigueDetected,
    topIssues,
    topCues,
    calibration: sideAnalysis.calibration,
    config: sideAnalysis.config,
    repFrameMap: sideAnalysis.repFrameMap,
    repStartFrames: sideAnalysis.repStartFrames,
    positiveHighlights: Array.from(positiveSet),
    mobilityFindings: sideAnalysis.mobilityFindings,
    warmupProtocol: sideAnalysis.warmupProtocol,
    competitionMode: sideAnalysis.competitionMode,
    detectedCameraView: 'side',
    multiAngleUsed: true,
    multiAngleAlignmentQuality: alignmentQuality,
  };

  return {
    merged,
    sideAnalysis,
    frontAnalysis,
    alignmentQuality,
  };
}
