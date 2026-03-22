/**
 * Competition-specific analysis: sticking points, bar path, velocity, competition cues,
 * competition total tracking, and competition commands reference.
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

// ─── Competition Total Tracking ───

export interface CompTotal {
  squat: number;
  bench: number;
  deadlift: number;
  total: number;
  bodyweight: number;
  date: string;
  dots?: number;
  wilks2?: number;
  glPoints?: number;
  isCompetition: boolean; // gym total vs meet total
}

const COMP_TOTALS_KEY = 'squat_form_comp_totals';

/**
 * Calculate the powerlifting total from the three competition lifts.
 * Returns 0 if any lift is zero (bombed out on that lift).
 */
export function calculateCompTotal(squat: number, bench: number, deadlift: number): number {
  if (squat <= 0 || bench <= 0 || deadlift <= 0) return 0;
  return squat + bench + deadlift;
}

/**
 * Save a competition total to localStorage.
 */
export function saveCompTotal(total: CompTotal): void {
  try {
    const existing = loadCompTotals();
    existing.push(total);
    // Sort by date descending (most recent first)
    existing.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    // Cap at 100 entries to prevent unbounded growth
    if (existing.length > 100) existing.length = 100;
    localStorage.setItem(COMP_TOTALS_KEY, JSON.stringify(existing));
  } catch {
    // Storage full or unavailable — silently continue
  }
}

/**
 * Load all saved competition totals from localStorage.
 */
export function loadCompTotals(): CompTotal[] {
  try {
    const raw = localStorage.getItem(COMP_TOTALS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Get the best total by type ('competition', 'gym', or 'all').
 * Returns the highest total matching the filter, or null if none exist.
 */
export function getBestTotal(type?: 'competition' | 'gym' | 'all'): CompTotal | null {
  const totals = loadCompTotals();
  if (totals.length === 0) return null;

  const filtered = type === 'competition'
    ? totals.filter(t => t.isCompetition)
    : type === 'gym'
      ? totals.filter(t => !t.isCompetition)
      : totals;

  if (filtered.length === 0) return null;

  return filtered.reduce((best, current) =>
    current.total > best.total ? current : best
  );
}

/**
 * Render an HTML card showing a competition total with all scoring systems.
 */
export function renderCompTotalCard(total: CompTotal): string {
  const typeLabel = total.isCompetition ? 'Meet Total' : 'Gym Total';
  const dateStr = new Date(total.date).toLocaleDateString();

  const scores: string[] = [];
  if (total.dots != null) scores.push(`DOTS: ${total.dots}`);
  if (total.wilks2 != null) scores.push(`Wilks-2: ${total.wilks2}`);
  if (total.glPoints != null) scores.push(`GL: ${total.glPoints}`);

  return `<div class="comp-total-card">
  <div class="comp-total-header">
    <span class="comp-total-type">${typeLabel}</span>
    <span class="comp-total-date">${dateStr}</span>
  </div>
  <div class="comp-total-lifts">
    <div class="comp-lift"><span class="comp-lift-label">Squat</span><span class="comp-lift-value">${total.squat} kg</span></div>
    <div class="comp-lift"><span class="comp-lift-label">Bench</span><span class="comp-lift-value">${total.bench} kg</span></div>
    <div class="comp-lift"><span class="comp-lift-label">Deadlift</span><span class="comp-lift-value">${total.deadlift} kg</span></div>
  </div>
  <div class="comp-total-total">
    <span class="comp-total-label">Total</span>
    <span class="comp-total-value">${total.total} kg</span>
  </div>
  <div class="comp-total-bw">BW: ${total.bodyweight} kg</div>
  ${scores.length > 0 ? `<div class="comp-total-scores">${scores.join(' | ')}</div>` : ''}
</div>`;
}

// ─── Competition Commands Reference ───

export interface CompetitionCommand {
  lift: 'squat' | 'bench' | 'deadlift';
  command: string;
  timing: string;
  description: string;
  failureConsequence: string;
}

export const COMPETITION_COMMANDS: CompetitionCommand[] = [
  {
    lift: 'squat',
    command: 'SQUAT',
    timing: 'After walkout and setup, when lifter is motionless',
    description: 'Begin the squat descent',
    failureConsequence: 'Red light — lift not initiated on command',
  },
  {
    lift: 'squat',
    command: 'RACK',
    timing: 'After standing up with locked knees and hips',
    description: 'Return the bar to the rack',
    failureConsequence: 'Must wait for command — racking early is a no-lift',
  },
  {
    lift: 'bench',
    command: 'START',
    timing: 'After lifter takes the bar and arms are locked',
    description: 'Begin the descent to chest',
    failureConsequence: 'Red light if you start pressing before command',
  },
  {
    lift: 'bench',
    command: 'PRESS',
    timing: 'After bar is motionless on chest',
    description: 'Press the bar upward',
    failureConsequence: 'Most common failure — pressing before command is a no-lift',
  },
  {
    lift: 'bench',
    command: 'RACK',
    timing: 'After arms are locked at the top',
    description: 'Return bar to rack with spotter help',
    failureConsequence: 'Must wait — racking early is a no-lift',
  },
  {
    lift: 'deadlift',
    command: 'DOWN',
    timing: 'After standing erect with locked knees and hips',
    description: 'Return bar to platform under control',
    failureConsequence: 'Dropping the bar intentionally is a no-lift',
  },
];

/**
 * Get competition commands for a specific lift.
 */
export function getCommandsForLift(lift: 'squat' | 'bench' | 'deadlift'): CompetitionCommand[] {
  return COMPETITION_COMMANDS.filter(cmd => cmd.lift === lift);
}

/**
 * Render an HTML reference card showing competition commands.
 * Uses a responsive card layout that works on mobile (< 500px).
 * If a lift is specified, shows only that lift's commands. Otherwise shows all.
 */
export function renderCommandsReference(lift?: string): string {
  const validLifts = ['squat', 'bench', 'deadlift'] as const;
  const liftsToShow = lift && validLifts.includes(lift as typeof validLifts[number])
    ? [lift as typeof validLifts[number]]
    : validLifts;

  const sections = liftsToShow.map(l => {
    const commands = getCommandsForLift(l);
    const liftTitle = l.charAt(0).toUpperCase() + l.slice(1);
    const cards = commands.map(cmd => `
      <div class="cmd-card">
        <div class="cmd-card-header">
          <span class="cmd-card-name">"${cmd.command}"</span>
          <span class="cmd-card-lift-badge">${liftTitle}</span>
        </div>
        <div class="cmd-card-body">
          <div class="cmd-card-row">
            <span class="cmd-card-label">When given:</span>
            <span class="cmd-card-value">${cmd.timing}</span>
          </div>
          <div class="cmd-card-row">
            <span class="cmd-card-label">What to do:</span>
            <span class="cmd-card-value">${cmd.description}</span>
          </div>
          <div class="cmd-card-row cmd-card-warning">
            <span class="cmd-card-label">If missed:</span>
            <span class="cmd-card-value">${cmd.failureConsequence}</span>
          </div>
        </div>
      </div>`).join('');

    return `<div class="cmd-section">
      <h4 class="cmd-lift-title">${liftTitle}</h4>
      <div class="cmd-cards-grid">${cards}</div>
    </div>`;
  });

  const styleId = 'cmd-ref-styles';
  const styles = `<style id="${styleId}">
    .cmd-cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .cmd-card {
      border: 1px solid var(--border, #ddd);
      border-radius: 8px;
      overflow: hidden;
      background: var(--bg-card, #fff);
    }
    .cmd-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: var(--bg-secondary, #f5f5f5);
      border-bottom: 1px solid var(--border, #ddd);
    }
    .cmd-card-name {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text-primary, #111);
      letter-spacing: 0.02em;
    }
    .cmd-card-lift-badge {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--accent, #2563eb);
      color: var(--bg-primary, #fff);
    }
    .cmd-card-body {
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .cmd-card-row {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .cmd-card-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted, #888);
    }
    .cmd-card-value {
      font-size: 0.875rem;
      line-height: 1.4;
      color: var(--text-primary, #111);
    }
    .cmd-card-warning .cmd-card-value {
      color: var(--danger, #dc2626);
      font-weight: 600;
    }
    .cmd-lift-title {
      margin: 16px 0 8px;
    }
    @media (max-width: 500px) {
      .cmd-cards-grid {
        grid-template-columns: 1fr;
      }
      .cmd-card-name {
        font-size: 1.5rem;
      }
    }
  </style>`;

  return `${styles}
<div class="competition-commands-reference">
  <h3>Competition Commands Reference</h3>
  <p class="cmd-intro">In IPF/USAPL competitions, the head referee issues verbal commands that the lifter must follow. Failure to wait for or obey a command results in a red light (failed lift).</p>
  ${sections.join('\n')}
</div>`;
}

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

// ─── Meet Attempt Plan ───

/**
 * Generate a three-attempt plan for a competition based on estimated 1RM.
 * Uses standard powerlifting strategy: opener ~88%, second ~94%, third ~100%.
 * Rounds to nearest plate increment (2.5 kg or 5 lbs).
 */
export function generateAttemptPlan(estimated1RM: number, unit: string): { opener: number; second: number; third: number } {
  const increment = unit === 'kg' ? 2.5 : 5;
  return {
    opener: Math.round(estimated1RM * 0.88 / increment) * increment,
    second: Math.round(estimated1RM * 0.94 / increment) * increment,
    third: Math.round(estimated1RM * 1.00 / increment) * increment,
  };
}

// ─── RPE/RIR Estimation ───

/**
 * Estimate RPE (Rate of Perceived Exertion) and RIR (Reps in Reserve) from
 * angular velocity metrics. Uses the ascent/descent angular velocity ratio as
 * a heuristic proxy for proximity to failure. This is NOT equivalent to
 * validated velocity-based training (VBT) measurements using linear position
 * transducers or accelerometers (Helms et al. 2016, Sports Med; Zourdos et al.
 * 2016, J Strength Cond Res). The thresholds below are approximate and should
 * be treated as rough estimates — the lifter's own subjective RPE is always
 * more authoritative than this computed estimate.
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
  if (rpe >= 9.5) description = 'Estimated maximum effort — little to nothing left in the tank';
  else if (rpe >= 8.5) description = 'Estimated very hard — maybe 1 rep left';
  else if (rpe >= 7.5) description = 'Estimated hard — could do 2-3 more reps';
  else description = 'Estimated moderate effort — room to spare';

  return { rpe, rir, description };
}
