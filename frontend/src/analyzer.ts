/**
 * Form analysis engine: thin orchestrator that delegates to focused modules.
 * Re-exports public API for backward compatibility.
 */

import { computeFrameAngles, segmentLength, pickSide } from './angles';
import { detectReps } from './phases';
import {
  severityRank,
} from './types';
import type {
  FrameAngles,
  CalibrationData,
  SquatConfig,
  FormIssue,
  RepData,
  RepScore,
  SetAnalysis,
  RepRange,
  FrameData,
} from './types';

// ─── Import from focused modules ───
import { calibrateFromStanding, detectCameraView } from './calibration';
import {
  WEIGHTS,
  COMPETITION_WEIGHTS,
  VALGUS_THRESHOLDS,
  clamp,
  scoreDepth,
  scoreKneeTracking,
  scoreTrunk,
  scoreSymmetry,
  scoreTempo,
  scoreLockout,
  scoreCompetitionLockout,
  scoreToGrade,
  redistributeWeights,
  getPositiveFeedback,
  generateSpecificPositives,
} from './scorer';
import { detectRepIssues, getCuesForIssues } from './issues';
import { detectStickingPoints, computeBarPath, computeVelocityMetrics, getCompetitionCues } from './competition';
import { assessMobility, generateWarmupProtocol } from './mobility';

// ─── Re-exports for backward compatibility ───
export { WEIGHTS, COMPETITION_WEIGHTS } from './scorer';
export { getCorrectiveExercises, getExerciseProgressions } from './cues';
export type { CorrectiveExercise } from './cues';
export { calibrateFromStanding } from './calibration';
export { assessMobility, generateWarmupProtocol } from './mobility';
export { detectStickingPoints, computeBarPath, computeVelocityMetrics } from './competition';

// ─── Rep Analysis ───

function buildRepData(
  repRange: RepRange,
  frameAnglesMap: Map<number, FrameAngles>,
  frameIndices: number[],
  fps: number,
  calibration: CalibrationData | null,
  allLandmarks: FrameData,
  config?: SquatConfig,
): RepData {
  const { start, end, bottomIndex } = repRange;

  const repFrameAngles: FrameAngles[] = [];
  for (let i = start; i <= end && i < frameIndices.length; i++) {
    const fi = frameIndices[i];
    const fa = frameAnglesMap.get(fi);
    if (fa) {
      repFrameAngles.push(fa);
    }
  }

  const kneeAngles = repFrameAngles.map((fa) => fa.kneeAngle);
  const trunkAngles = repFrameAngles.map((fa) => fa.trunkAngle);
  const hipAngles = repFrameAngles.map((fa) => fa.hipAngle);

  const minKneeAngle = kneeAngles.length > 0 ? Math.min(...kneeAngles) : 180;
  const minHipAngle = hipAngles.length > 0 ? Math.min(...hipAngles) : 180;
  const maxTrunkAngle = trunkAngles.length > 0 ? Math.max(...trunkAngles) : 0;

  // Duration calculations
  const descentFrames = bottomIndex - start;
  const ascentFrames = end - bottomIndex;
  const descentDuration = fps > 0 ? descentFrames / fps : 0;
  const ascentDuration = fps > 0 ? ascentFrames / fps : 0;

  // Bottom duration: frames within 5 degrees of min knee angle
  let bottomFrameCount = 0;
  for (const ka of kneeAngles) {
    if (ka <= minKneeAngle + 5) {
      bottomFrameCount++;
    }
  }
  const bottomDuration = fps > 0 ? bottomFrameCount / fps : 0;

  // Detect heel rise: track heel Y position — if heel Y rises more than 2% of leg length during descent
  let heelRise = false;
  const side = pickSide(allLandmarks.get(frameIndices[start]) ?? {});
  const startLm = allLandmarks.get(frameIndices[start]);
  if (startLm) {
    const heelKey = `${side}_heel`;
    const kneeKey = `${side}_knee`;
    const ankleKey = `${side}_ankle`;
    const startHeel = startLm[heelKey];
    const startKnee = startLm[kneeKey];
    const startAnkle = startLm[ankleKey];

    if (startHeel && startKnee && startAnkle) {
      const legLength = segmentLength(startKnee, startAnkle);
      const heelRiseThreshold = legLength * 0.035;
      const standingHeelY = startHeel.y;

      // Check heel position during descent (start to bottom)
      // Require 3 consecutive frames of heel rise to reduce false positives from MediaPipe jitter
      let consecutiveHeelRiseFrames = 0;
      for (let i = start; i <= Math.min(bottomIndex, end) && i < frameIndices.length; i++) {
        const fi = frameIndices[i];
        const lm = allLandmarks.get(fi);
        if (!lm) { consecutiveHeelRiseFrames = 0; continue; }
        const heel = lm[heelKey];
        if (!heel) { consecutiveHeelRiseFrames = 0; continue; }
        // In image coords, Y increases downward, so heel rising = Y decreasing
        if (standingHeelY - heel.y > heelRiseThreshold) {
          consecutiveHeelRiseFrames++;
          if (consecutiveHeelRiseFrames >= 3) {
            heelRise = true;
            break;
          }
        } else {
          consecutiveHeelRiseFrames = 0;
        }
      }
    }
  }

  // Detect butt wink: pelvic tilt change at bottom
  let pelvicTiltAtBottom = 0;
  const bottomRelIdx = bottomIndex - start;
  if (bottomRelIdx >= 0 && bottomRelIdx < repFrameAngles.length) {
    const hipAngleAtBottom = repFrameAngles[bottomRelIdx]?.hipAngle ?? 0;
    const earlyHipAngles = repFrameAngles.slice(0, Math.max(1, Math.floor(repFrameAngles.length * 0.3)));
    const avgEarlyHip = earlyHipAngles.length > 0
      ? earlyHipAngles.reduce((s, fa) => s + fa.hipAngle, 0) / earlyHipAngles.length
      : hipAngleAtBottom;
    pelvicTiltAtBottom = Math.abs(hipAngleAtBottom - avgEarlyHip);
  }
  const buttWink = pelvicTiltAtBottom > 8;

  // Detect good morning pattern: trunk angle increases on ascent + hip-knee lag check
  const ascStartIdx = bottomIndex - start;
  let trunkAngleChangeOnAscent = 0;
  let hipKneeLagDetected = false;
  if (ascStartIdx >= 0 && ascStartIdx < trunkAngles.length) {
    const trunkAtBottom = trunkAngles[ascStartIdx] ?? 0;
    const ascentTrunkAngles = trunkAngles.slice(ascStartIdx);
    const maxTrunkOnAscent = ascentTrunkAngles.length > 0
      ? Math.max(...ascentTrunkAngles)
      : trunkAtBottom;
    trunkAngleChangeOnAscent = maxTrunkOnAscent - trunkAtBottom;

    // Hip-knee angular velocity lag: if hip extension rate exceeds knee extension
    // rate by >50% for the first 40% of ascent, flag as good morning pattern
    const ascentHipAngles = hipAngles.slice(ascStartIdx);
    const ascentKneeAngles = kneeAngles.slice(ascStartIdx);
    const first40pct = Math.max(2, Math.floor(ascentKneeAngles.length * 0.4));
    if (first40pct >= 2 && ascentHipAngles.length >= first40pct && ascentKneeAngles.length >= first40pct) {
      const hipDelta = ascentHipAngles[first40pct - 1] - ascentHipAngles[0];
      const kneeDelta = ascentKneeAngles[first40pct - 1] - ascentKneeAngles[0];
      // Both should be positive (extending), hip extending much faster = good morning
      if (kneeDelta > 0 && hipDelta > kneeDelta * 1.5) {
        hipKneeLagDetected = true;
      }
    }
  }
  const goodMorningThreshold = config?.squatType === 'low_bar' ? 20 : 15;
  const goodMorning = trunkAngleChangeOnAscent > goodMorningThreshold || hipKneeLagDetected;

  // Detect knee valgus: knee width ratio drops below threshold
  const valgusThreshold = config ? VALGUS_THRESHOLDS[config.experienceLevel] : 0.85;
  let kneeValgus = false;
  for (const fa of repFrameAngles) {
    if (fa.kneeWidthRatio !== null && fa.kneeWidthRatio < valgusThreshold) {
      kneeValgus = true;
      break;
    }
  }

  // Sticking point detection
  const repKneeAngles = repFrameAngles.map(fa => fa.kneeAngle);
  const bottomRelativeIdx = bottomIndex - start;
  const topAngle = repKneeAngles.length > 0 ? Math.max(...repKneeAngles) : 180;
  const stickingPoints = detectStickingPoints(
    repKneeAngles, bottomRelativeIdx, topAngle, minKneeAngle, fps, frameIndices[start] ?? 0,
  );

  // Bar path (only for loaded squat types)
  const isLoaded = config && (config.squatType === 'high_bar' || config.squatType === 'low_bar');
  const barPath = isLoaded ? computeBarPath(allLandmarks, frameIndices, start, end) : undefined;

  // Velocity metrics
  const velocity = computeVelocityMetrics(repKneeAngles, bottomRelativeIdx, fps);

  // Competition depth check (hip crease Y vs knee Y at bottom)
  let competitionDepthPass: boolean | undefined;
  let competitionDepthMargin: number | undefined;
  if (config?.competitionMode) {
    const bottomFi = frameIndices[bottomIndex];
    const bottomLm = bottomFi !== undefined ? allLandmarks.get(bottomFi) : undefined;
    if (bottomLm) {
      const lhip = bottomLm['left_hip'];
      const rhip = bottomLm['right_hip'];
      const lknee = bottomLm['left_knee'];
      const rknee = bottomLm['right_knee'];
      if (lhip && rhip && lknee && rknee) {
        const hipY = (lhip.y + rhip.y) / 2;
        const kneeY = (lknee.y + rknee.y) / 2;
        // In image coords, Y increases downward; hip crease below knee = hipY > kneeY
        competitionDepthPass = hipY > kneeY;
        competitionDepthMargin = (hipY - kneeY) * 100; // positive = good depth
      }
    }
  }

  return {
    repNumber: 0, // Set by caller
    startFrame: frameIndices[start] ?? 0,
    endFrame: frameIndices[end] ?? 0,
    bottomFrame: frameIndices[bottomIndex] ?? 0,
    minKneeAngle,
    minHipAngle,
    maxTrunkAngle,
    descentDuration,
    bottomDuration,
    ascentDuration,
    frameAngles: repFrameAngles,
    heelRise,
    buttWink,
    goodMorning,
    kneeValgus,
    trunkAngleChangeOnAscent,
    pelvicTiltAtBottom,
    stickingPoints,
    barPath,
    velocity,
    competitionDepthPass,
    competitionDepthMargin,
  };
}

function scoreRep(
  rep: RepData,
  config: SquatConfig,
  calibration: CalibrationData | null,
): RepScore {
  const depth = scoreDepth(rep.minKneeAngle, config);
  const kneeTracking = scoreKneeTracking(rep, config);
  const trunk = scoreTrunk(rep.maxTrunkAngle, config, calibration);
  const symmetry = scoreSymmetry(rep);
  const tempo = config.competitionMode ? 100 : scoreTempo(rep.descentDuration, rep.bottomDuration, rep.ascentDuration);
  const lockout = scoreLockout(rep, calibration);

  // Use competition weights if in competition mode
  const baseW = config.competitionMode ? COMPETITION_WEIGHTS : WEIGHTS;

  // If no frontal knee data, redistribute kneeTracking weight to other dimensions
  const hasFrontalData = rep.frameAngles.some((fa) => fa.kneeWidthRatio !== null);
  const w = hasFrontalData ? baseW : redistributeWeights(baseW, 'kneeTracking');

  // Stricter lockout scoring in competition mode
  const effectiveLockout = config.competitionMode ? scoreCompetitionLockout(rep, calibration) : lockout;

  const overall = clamp(
    Math.round(
      depth * w.depth +
        kneeTracking * w.kneeTracking +
        trunk * w.trunk +
        symmetry * w.symmetry +
        tempo * w.tempo +
        effectiveLockout * w.lockout,
    ),
    0,
    100,
  );

  const issues = detectRepIssues(rep, config, calibration);
  let cues = getCuesForIssues(issues, config.experienceLevel);
  const positiveFeedback = getPositiveFeedback({
    depth,
    kneeTracking,
    trunk,
    symmetry,
    tempo,
    lockout: config.competitionMode ? effectiveLockout : lockout,
  });

  // Soft penalty for HIGH severity issues (instead of hard cap)
  let totalScore = overall;
  const highCount = issues.filter((i) => i.severity === 'high').length;
  if (highCount > 0) {
    totalScore = Math.max(0, totalScore - highCount * 5);
  }

  // In competition mode, a high squat is a failed lift regardless of form quality
  // (IPF Technical Rules 2024, Section A.1.a: hip crease must pass below top of knee)
  if (config.competitionMode && rep.competitionDepthPass === false) {
    totalScore = Math.min(totalScore, 40);
  }

  const result: RepScore = {
    depthScore: depth,
    kneeTrackingScore: kneeTracking,
    trunkScore: trunk,
    symmetryScore: symmetry,
    tempoScore: tempo,
    lockoutScore: config.competitionMode ? effectiveLockout : lockout,
    overallScore: totalScore,
    grade: config.competitionMode && rep.competitionDepthPass === false
      ? 'No Lift' : scoreToGrade(totalScore, config.experienceLevel),
    issues,
    cues,
    positiveFeedback,
    stickingPoints: rep.stickingPoints,
    barPath: rep.barPath,
    velocity: rep.velocity,
    competitionDepthPass: rep.competitionDepthPass,
    competitionDepthMargin: rep.competitionDepthMargin,
    minKneeAngle: rep.minKneeAngle,
    maxTrunkAngle: rep.maxTrunkAngle,
    minHipAngle: rep.minHipAngle,
    descentDuration: rep.descentDuration,
    ascentDuration: rep.ascentDuration,
    bottomDuration: rep.bottomDuration,
    dimensions: { depth, kneeTracking, trunk, symmetry, tempo, lockout: config.competitionMode ? effectiveLockout : lockout },
    exerciseType: 'squat',
  };

  // Aggregate landmark confidence across all frames in this rep
  const confidenceValues = rep.frameAngles
    .map(fa => fa.landmarkConfidence)
    .filter((v): v is number => v !== undefined);
  if (confidenceValues.length > 0) {
    result.avgConfidence = confidenceValues.reduce((s, v) => s + v, 0) / confidenceValues.length;
  }

  // Add competition-specific cues
  if (config.competitionMode) {
    const compCues = getCompetitionCues(rep, result);
    cues = [...compCues, ...cues];
    result.cues = cues;
  }

  return result;
}

function emptyAnalysis(
  config: SquatConfig,
  calibration: CalibrationData | null = null,
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
  };
}

// ─── Main Analysis Entry Point ───

/**
 * Analyze a sequence of pose landmarks for an entire set.
 *
 * @param frames Map of frame_number -> landmarks dict
 * @param fps Video frame rate
 * @param config Squat configuration (type + experience level)
 * @returns Full set analysis with per-rep scores and coaching cues
 */
export function analyzeSequence(
  frames: FrameData,
  fps: number,
  config: SquatConfig,
): SetAnalysis {
  if (frames.size === 0) {
    return emptyAnalysis(config);
  }

  // Sort frame indices
  const frameIndices = Array.from(frames.keys()).sort((a, b) => a - b);

  // Calibrate from the first standing frame (validate posture: knee > 150 degrees)
  let calibration: CalibrationData | null = null;
  const calibrationCandidates = frameIndices.slice(0, Math.min(30, frameIndices.length));
  for (const ci of calibrationCandidates) {
    const lm = frames.get(ci);
    if (!lm) continue;
    const fa = computeFrameAngles(lm);
    if (fa.kneeAngle >= 150) {
      calibration = calibrateFromStanding(lm);
      break;
    }
  }

  // Detect camera view from an early frame with good landmark visibility
  let detectedCameraView: 'side' | 'front' | 'unknown' = 'unknown';
  for (const ci of calibrationCandidates) {
    const lm = frames.get(ci);
    if (!lm) continue;
    const view = detectCameraView(lm);
    if (view !== 'unknown') {
      detectedCameraView = view;
      break;
    }
  }

  // Compute frame angles for every frame
  // Pick side once from first available frame and reuse for all frames
  const firstLm = frames.get(frameIndices[0]);
  const cachedSide = firstLm ? pickSide(firstLm) : undefined;

  const frameAnglesMap = new Map<number, FrameAngles>();
  const kneeAnglesOrdered: number[] = [];

  for (const fi of frameIndices) {
    const lm = frames.get(fi)!;
    const fa = computeFrameAngles(lm, calibration?.standingKneeWidth ?? undefined, cachedSide);
    frameAnglesMap.set(fi, fa);
    kneeAnglesOrdered.push(fa.kneeAngle);
  }

  // Detect reps
  const repRanges = detectReps(kneeAnglesOrdered);

  if (repRanges.length === 0) {
    return emptyAnalysis(config, calibration);
  }

  // Check for side-view warning: if no frontal knee data is available
  let sideViewWarning: string | undefined;
  let hasFrontalKneeData = false;
  for (const fi of frameIndices) {
    const fa = frameAnglesMap.get(fi);
    if (fa && fa.kneeWidthRatio !== null) {
      hasFrontalKneeData = true;
      break;
    }
  }
  if (!hasFrontalKneeData) {
    sideViewWarning = 'Side view detected -- knee tracking assessment is limited. For full knee valgus analysis, try a front-angle recording.';
  }

  // Build rep data and score each rep
  const repScores: RepScore[] = [];
  const repStartFrames: number[] = [];
  const repFrameMap = new Map<number, number>();

  for (let r = 0; r < repRanges.length; r++) {
    const range = repRanges[r];
    const repData = buildRepData(range, frameAnglesMap, frameIndices, fps, calibration, frames, config);
    repData.repNumber = r + 1;

    const score = scoreRep(repData, config, calibration);

    // Add side-view warning as a LOW-severity FormIssue on each rep if applicable
    if (!hasFrontalKneeData) {
      score.issues.push({
        name: 'limited_knee_tracking',
        severity: 'low' as const,
        description: 'Side view detected -- knee tracking assessment is limited',
        value: 0,
        threshold: 0,
        phase: 'standing' as const,
        frame: repData.startFrame,
      });
    }

    repScores.push(score);
    repStartFrames.push(frameIndices[range.start] ?? 0);

    // Map frames to rep index
    for (let i = range.start; i <= range.end && i < frameIndices.length; i++) {
      repFrameMap.set(frameIndices[i], r);
    }
  }

  // Overall set score
  const avgScore =
    repScores.reduce((s, r) => s + r.overallScore, 0) / repScores.length;

  // Fatigue detection: last 2 reps score > 15 points below first 2
  let fatigueDetected = false;
  if (repScores.length >= 4) {
    const first2Avg =
      (repScores[0].overallScore + repScores[1].overallScore) / 2;
    const last2Avg =
      (repScores[repScores.length - 2].overallScore +
        repScores[repScores.length - 1].overallScore) /
      2;
    fatigueDetected = first2Avg - last2Avg > 15;
  }

  // No fatigue penalty on overall score (matches backend) -- flag only
  const overallScore = clamp(Math.round(avgScore), 0, 100);

  // Collect all issues and pick top ones
  const allIssues = repScores.flatMap((r) => r.issues);
  const issueCountMap = new Map<string, { issue: FormIssue; count: number }>();
  for (const issue of allIssues) {
    const existing = issueCountMap.get(issue.name);
    if (existing) {
      existing.count++;
      // Keep the highest severity version
      if (severityRank(issue.severity) > severityRank(existing.issue.severity)) {
        existing.issue = issue;
      }
    } else {
      issueCountMap.set(issue.name, { issue, count: 1 });
    }
  }

  const topIssues = Array.from(issueCountMap.values())
    .sort((a, b) => {
      const sevDiff = severityRank(b.issue.severity) - severityRank(a.issue.severity);
      if (sevDiff !== 0) return sevDiff;
      return b.count - a.count;
    })
    .slice(0, 3)
    .map((e) => e.issue);

  const topCues = getCuesForIssues(topIssues, config.experienceLevel);

  // Collect positive highlights across all reps
  const positiveSet = new Set<string>();
  for (const rep of repScores) {
    for (const fb of rep.positiveFeedback) {
      positiveSet.add(fb);
    }
  }

  // Generate specific numbered positives and replace generic ones where applicable
  const specificPositives = generateSpecificPositives(repScores, calibration);
  for (const sp of specificPositives) {
    positiveSet.add(sp);
  }

  const positiveHighlights = Array.from(positiveSet);

  // Generate mobility findings from top issues (adjusted by experience level)
  const mobilityFindings = assessMobility(topIssues, config.experienceLevel);

  // Generate warm-up protocol (adjusted by experience level)
  const warmupProtocol = generateWarmupProtocol(topIssues, config.experienceLevel);

  return {
    repCount: repRanges.length,
    reps: repScores,
    overallScore,
    grade: scoreToGrade(overallScore, config.experienceLevel),
    fatigueDetected,
    topIssues,
    topCues,
    calibration,
    config,
    repFrameMap,
    repStartFrames,
    sideViewWarning,
    detectedCameraView,
    positiveHighlights,
    mobilityFindings,
    warmupProtocol,
    competitionMode: config.competitionMode,
  };
}
