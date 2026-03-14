/**
 * Competition-specific analysis: sticking points, bar path, velocity, competition cues.
 * Extracted from analyzer.ts — no behavior changes.
 */

import type {
  FrameData,
  StickingPoint,
  BarPathData,
  VelocityMetrics,
  CoachingCue,
  RepData,
  RepScore,
} from './types';

// ─── Sticking Point Detection ───

/**
 * Detect sticking points during the ascent phase of a rep.
 * A sticking point is where angular velocity drops significantly.
 */
export function detectStickingPoints(
  kneeAngles: number[],
  bottomIdx: number,
  topAngle: number,
  bottomAngle: number,
  fps: number,
  startFrame: number,
  exerciseType?: string,
): StickingPoint[] {
  const stickingPoints: StickingPoint[] = [];
  const ascentAngles = kneeAngles.slice(bottomIdx);

  if (ascentAngles.length < 6 || fps <= 0) return stickingPoints;

  const angleRange = topAngle - bottomAngle;
  if (angleRange <= 0) return stickingPoints;

  // Compute angular velocity (degrees per frame)
  const velocities: number[] = [];
  for (let i = 1; i < ascentAngles.length; i++) {
    velocities.push(ascentAngles[i] - ascentAngles[i - 1]);
  }

  // 3-frame rolling average for smoothing
  const smoothedVelocities: number[] = [];
  for (let i = 0; i < velocities.length; i++) {
    const start = Math.max(0, i - 1);
    const end = Math.min(velocities.length, i + 2);
    const slice = velocities.slice(start, end);
    smoothedVelocities.push(slice.reduce((s, v) => s + v, 0) / slice.length);
  }

  // Find peak velocity
  const peakVelocity = Math.max(...smoothedVelocities, 0.01);

  // Find frames where velocity drops below 50% of peak
  for (let i = 1; i < smoothedVelocities.length - 1; i++) {
    const vel = smoothedVelocities[i];
    if (vel < peakVelocity * 0.5 && vel >= 0) {
      const frameIdx = bottomIdx + i + 1;
      const kneeAngle = kneeAngles[frameIdx] ?? ascentAngles[i + 1];
      const depthPct = angleRange > 0
        ? Math.round(((kneeAngle - bottomAngle) / angleRange) * 100)
        : 0;

      let description = '';
      const isDL = exerciseType === 'deadlift';
      if (depthPct < 30) {
        description = isDL
          ? 'Sticking point off the floor -- strengthen quads with deficit deadlifts'
          : 'Sticking point out of the hole -- strengthen quads and practice pause squats';
      } else if (depthPct < 60) {
        description = isDL
          ? 'Sticking point at the knee -- focus on back position and hip drive'
          : 'Sticking point at mid-range -- focus on maintaining torso position';
      } else {
        description = isDL
          ? 'Sticking point near lockout -- strengthen glutes and practice block pulls'
          : 'Sticking point near lockout -- strengthen glutes and practice top-half squats';
      }

      stickingPoints.push({
        frame: startFrame + frameIdx,
        kneeAngle,
        depthPercentage: depthPct,
        velocityDrop: 1 - (vel / peakVelocity),
        description,
      });
    }
  }

  // Deduplicate: keep only the most significant sticking point per 15% depth range
  const deduped: StickingPoint[] = [];
  const seenRanges = new Set<number>();
  const sorted = stickingPoints.sort((a, b) => b.velocityDrop - a.velocityDrop);
  for (const sp of sorted) {
    const rangeKey = Math.floor(sp.depthPercentage / 15);
    if (!seenRanges.has(rangeKey)) {
      deduped.push(sp);
      seenRanges.add(rangeKey);
    }
  }

  return deduped.slice(0, 3);
}

// ─── Bar Path Computation ───

/**
 * Compute bar path from shoulder landmarks (proxy for bar position).
 * Only meaningful for loaded squat types.
 */
export function computeBarPath(
  allLandmarks: FrameData,
  frameIndices: number[],
  startIdx: number,
  endIdx: number,
): BarPathData | undefined {
  const xPositions: number[] = [];
  const yPositions: number[] = [];

  for (let i = startIdx; i <= endIdx && i < frameIndices.length; i++) {
    const fi = frameIndices[i];
    const lm = allLandmarks.get(fi);
    if (!lm) continue;

    const ls = lm['left_shoulder'];
    const rs = lm['right_shoulder'];
    if (!ls || !rs) continue;

    // Mid-shoulder as bar position proxy
    xPositions.push((ls.x + rs.x) / 2);
    yPositions.push((ls.y + rs.y) / 2);
  }

  if (xPositions.length < 3) return undefined;

  // Compute lateral drift: max X deviation from starting X
  const startX = xPositions[0];
  const lateralDrift = Math.max(...xPositions.map(x => Math.abs(x - startX)));

  // Compute path efficiency: straight-line distance / actual path length
  const startY = yPositions[0];
  const endY = yPositions[yPositions.length - 1];
  const straightLine = Math.sqrt(
    Math.pow(xPositions[xPositions.length - 1] - startX, 2) +
    Math.pow(endY - startY, 2),
  );

  let actualPath = 0;
  for (let i = 1; i < xPositions.length; i++) {
    actualPath += Math.sqrt(
      Math.pow(xPositions[i] - xPositions[i - 1], 2) +
      Math.pow(yPositions[i] - yPositions[i - 1], 2),
    );
  }

  const pathEfficiency = straightLine < 1e-9 ? 100.0 : actualPath > 0 ? (straightLine / actualPath) * 100 : 100;

  let description = '';
  if (lateralDrift < 0.02) {
    description = 'Excellent bar path -- very straight and efficient';
  } else if (lateralDrift < 0.04) {
    description = 'Good bar path -- minor lateral movement';
  } else {
    description = 'Bar path shows significant drift -- focus on keeping the bar over midfoot';
  }

  return {
    xPositions,
    yPositions,
    lateralDrift,
    pathEfficiency: Math.round(pathEfficiency),
    description,
  };
}

// ─── Movement Tempo Metrics (Angular Velocity) ───

/**
 * Compute movement tempo metrics for a rep based on angular velocity (deg/s).
 * Note: These are angular velocity metrics derived from joint angles,
 * NOT linear bar velocity (VBT). Values represent movement tempo, not bar speed.
 */
export function computeVelocityMetrics(
  kneeAngles: number[],
  bottomIdx: number,
  fps: number,
): VelocityMetrics | undefined {
  if (kneeAngles.length < 4 || fps <= 0 || bottomIdx <= 0) return undefined;

  const descentAngles = kneeAngles.slice(0, bottomIdx + 1);
  const ascentAngles = kneeAngles.slice(bottomIdx);

  // Angular velocity in degrees/second
  const descentVelocities: number[] = [];
  for (let i = 1; i < descentAngles.length; i++) {
    descentVelocities.push(Math.abs(descentAngles[i] - descentAngles[i - 1]) * fps);
  }

  const ascentVelocities: number[] = [];
  for (let i = 1; i < ascentAngles.length; i++) {
    ascentVelocities.push(Math.abs(ascentAngles[i] - ascentAngles[i - 1]) * fps);
  }

  if (descentVelocities.length === 0 || ascentVelocities.length === 0) return undefined;

  const peakDescentVelocity = Math.max(...descentVelocities);
  const peakAscentVelocity = Math.max(...ascentVelocities);
  const meanDescentVelocity = descentVelocities.reduce((s, v) => s + v, 0) / descentVelocities.length;
  const meanAscentVelocity = ascentVelocities.reduce((s, v) => s + v, 0) / ascentVelocities.length;
  const ascentDescentRatio = meanDescentVelocity > 0 ? meanAscentVelocity / meanDescentVelocity : 1;

  let description = '';
  if (ascentDescentRatio >= 1.2) {
    description = 'Explosive ascent tempo -- good power output';
  } else if (ascentDescentRatio >= 0.8) {
    description = 'Balanced movement tempo -- controlled throughout';
  } else {
    description = 'Slow ascent tempo relative to descent -- consider reducing weight or building strength';
  }

  return {
    peakDescentVelocity: Math.round(peakDescentVelocity),
    peakAscentVelocity: Math.round(peakAscentVelocity),
    meanDescentVelocity: Math.round(meanDescentVelocity),
    meanAscentVelocity: Math.round(meanAscentVelocity),
    ascentDescentRatio: Math.round(ascentDescentRatio * 100) / 100,
    description,
  };
}

// ─── Competition-Specific Cues ───

export function getCompetitionCues(rep: RepData, repScore: RepScore): CoachingCue[] {
  const cues: CoachingCue[] = [];

  // Depth fail
  if (rep.competitionDepthPass === false) {
    cues.push({
      issue: 'competition_depth',
      cue: 'The judges would call this high -- sink it one more inch',
      priority: 1,
      explanation: 'In competition, the hip crease must pass below the top of the knee. Your squat did not reach the required depth for a white light.',
    });
  }

  // Lockout fail
  if (repScore.lockoutScore < 85) {
    cues.push({
      issue: 'competition_lockout',
      cue: 'Lock your knees and squeeze your glutes at the top',
      priority: 2,
      explanation: 'The judges need to see full knee and hip extension at the top of the lift before you rack. Incomplete lockout will result in a red light.',
    });
  }

  // Bar path drift
  if (rep.barPath && rep.barPath.lateralDrift > 0.03) {
    cues.push({
      issue: 'competition_bar_path',
      cue: 'Keep the bar over your midfoot throughout the lift',
      priority: 3,
      explanation: 'Excessive bar path deviation wastes energy and can cause you to miss heavier attempts. A straight bar path is the most efficient path.',
    });
  }

  // Sticking point cues
  if (rep.stickingPoints.length > 0) {
    const sp = rep.stickingPoints[0];
    let cue = '';
    if (sp.depthPercentage < 30) {
      cue = 'Drive hard out of the hole -- push your back into the bar';
    } else if (sp.depthPercentage < 60) {
      cue = 'Stay tight through the midrange -- keep your chest up';
    } else {
      cue = 'Finish strong at the top -- drive your hips through';
    }

    cues.push({
      issue: 'sticking_point',
      cue,
      priority: 4,
      explanation: `You have a sticking point at approximately ${sp.depthPercentage}% of the way up. ${sp.description}`,
    });
  }

  // Downward motion during ascent (IPF Technical Rules 2024, Section A.1.c:
  // "Any deliberate downward movement during the upward phase results in a failed lift")
  if (rep.velocity) {
    const repKneeAngles = rep.frameAngles.map(fa => fa.kneeAngle);
    const bottomRelIdx = repKneeAngles.reduce((minI, a, i, arr) => a < arr[minI] ? i : minI, 0);
    const ascentAngles = repKneeAngles.slice(bottomRelIdx);
    let hasDownwardMotion = false;
    for (let i = 3; i < ascentAngles.length - 2; i++) {
      // 3-frame window showing decrease > 5 degrees indicates bar moving down
      // (threshold of 5° reduces false positives from MediaPipe pose jitter)
      if (ascentAngles[i] - ascentAngles[i - 3] < -5) {
        hasDownwardMotion = true;
        break;
      }
    }
    if (hasDownwardMotion) {
      cues.push({
        issue: 'downward_motion',
        cue: 'The bar moved downward during the ascent — that\'s a red light in competition',
        priority: 1,
        explanation: 'IPF rules state that any deliberate downward movement of the bar during the upward phase results in a failed lift. Practice consistent drive through the sticking point without hesitation.',
      });
    }
  }

  // Grinding detection
  if (rep.velocity && rep.velocity.ascentDescentRatio < 0.5) {
    cues.push({
      issue: 'grinding',
      cue: 'That was a grinder -- you fought hard for that rep',
      priority: 5,
      explanation: 'Your ascent velocity was very low relative to your descent. This rep required maximum effort. In competition, know your limits to make strategic attempt selections.',
    });
  }

  return cues;
}

// ─── RPE/RIR Estimation ───

/**
 * Estimate RPE (Rate of Perceived Exertion) and RIR (Reps in Reserve) from
 * velocity metrics. Based on VBT research (Helms et al. 2016, Sports Med;
 * Zourdos et al. 2016, J Strength Cond Res): the ratio of ascent velocity to
 * descent velocity correlates with proximity to failure.
 */
export interface RPEEstimate {
  rpe: number;
  rir: number;
  description: string;
}

export function estimateRPE(velocity: VelocityMetrics): RPEEstimate | null {
  if (!velocity) return null;

  const ratio = velocity.ascentDescentRatio;

  let rpe: number;
  if (ratio < 0.3) rpe = 10;
  else if (ratio < 0.5) rpe = 9.5;
  else if (ratio < 0.7) rpe = 9;
  else if (ratio < 0.9) rpe = 8;
  else if (ratio < 1.1) rpe = 7;
  else rpe = 6;

  const rir = Math.max(0, Math.round((10 - rpe) * 2) / 2);

  let description: string;
  if (rpe >= 9.5) description = 'Maximum effort — little to nothing left in the tank';
  else if (rpe >= 8.5) description = 'Very hard — maybe 1 rep left';
  else if (rpe >= 7.5) description = 'Hard — could do 2-3 more reps';
  else description = 'Moderate effort — room to spare';

  return { rpe, rir, description };
}
