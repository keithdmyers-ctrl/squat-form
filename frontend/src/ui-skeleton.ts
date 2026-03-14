/**
 * Skeleton drawing: pose overlay, angle labels, phase indicators.
 */

import { severityRank } from './types';
import type { Landmarks, FormIssue, IssueSeverity, SquatPhase } from './types';
import { computeFrameAngles } from './angles';
import { CANVAS_COLORS, severityColorCanvas } from './ui-utilities';

// ─── Skeleton Connection Pairs (landmark name pairs) ───
export const CONNECTIONS: [string, string][] = [
  // Torso
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  // Left arm
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  // Right arm
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  // Left leg
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['left_ankle', 'left_heel'],
  ['left_ankle', 'left_foot_index'],
  ['left_heel', 'left_foot_index'],
  // Right leg
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
  ['right_ankle', 'right_heel'],
  ['right_ankle', 'right_foot_index'],
  ['right_heel', 'right_foot_index'],
];

// Key joints to draw with larger circles and angle labels
export const KEY_JOINTS = new Set([
  'left_shoulder',
  'right_shoulder',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
]);

// Set of all landmark names for reference (face landmarks excluded)
export const LANDMARK_NAMES_SET = new Set([
  'left_shoulder', 'right_shoulder',
  'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist',
  'left_pinky', 'right_pinky',
  'left_index', 'right_index',
  'left_thumb', 'right_thumb',
  'left_hip', 'right_hip',
  'left_knee', 'right_knee',
  'left_ankle', 'right_ankle',
  'left_heel', 'right_heel',
  'left_foot_index', 'right_foot_index',
]);

/**
 * Draw the pose skeleton on the canvas.
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmarks,
  issues: FormIssue[],
  width: number,
  height: number,
): void {
  // Build a set of joints with issues for coloring
  const issueJoints = new Map<string, IssueSeverity>();
  for (const issue of issues) {
    const joints = issueToJoints(issue.name);
    for (const j of joints) {
      const existing = issueJoints.get(j);
      if (!existing || severityRank(issue.severity) > severityRank(existing)) {
        issueJoints.set(j, issue.severity);
      }
    }
  }

  // Draw connection lines
  for (const [a, b] of CONNECTIONS) {
    const pa = landmarks[a];
    const pb = landmarks[b];
    if (!pa || !pb) continue;
    if (pa.visibility < 0.3 || pb.visibility < 0.3) continue;

    const hasIssue = issueJoints.has(a) || issueJoints.has(b);

    ctx.beginPath();
    ctx.moveTo(pa.x * width, pa.y * height);
    ctx.lineTo(pb.x * width, pb.y * height);
    ctx.strokeStyle = hasIssue ? CANVAS_COLORS.lineHighlight : CANVAS_COLORS.line;
    ctx.lineWidth = hasIssue ? 3 : 2;
    ctx.stroke();
  }

  // Draw joint circles
  for (const [name, point] of Object.entries(landmarks)) {
    if (point.visibility < 0.3) continue;
    if (!KEY_JOINTS.has(name) && !LANDMARK_NAMES_SET.has(name)) continue;

    const isKey = KEY_JOINTS.has(name);
    const radius = isKey ? 6 : 3;

    let color = CANVAS_COLORS.accent;
    const severity = issueJoints.get(name);
    if (severity) {
      color = severityColorCanvas(severity);
    }

    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    if (isKey) {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

/** Map issue names to relevant joint landmarks for highlighting. */
export function issueToJoints(issueName: string): string[] {
  switch (issueName) {
    case 'knee_valgus':
      return ['left_knee', 'right_knee'];
    case 'insufficient_depth':
      return ['left_hip', 'right_hip', 'left_knee', 'right_knee'];
    case 'excessive_forward_lean':
    case 'good_morning':
    case 'trunk_angle_increase_on_ascent':
      return ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'];
    case 'butt_wink':
      return ['left_hip', 'right_hip'];
    case 'heel_rise':
      return ['left_ankle', 'right_ankle'];
    case 'incomplete_lockout':
      return ['left_knee', 'right_knee', 'left_hip', 'right_hip'];
    case 'asymmetric_hips':
    case 'asymmetric_shift':
      return ['left_hip', 'right_hip'];
    default:
      return [];
  }
}

/** Draw phase and rep count overlay. */
export function drawPhaseOverlay(
  ctx: CanvasRenderingContext2D,
  phase: SquatPhase,
  repIdx: number,
  width: number,
): void {
  const padding = 10;
  const phaseLabel = phase.charAt(0).toUpperCase() + phase.slice(1);

  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'left';

  // Phase badge
  let badgeColor = CANVAS_COLORS.accent;
  if (phase === 'bottom') badgeColor = CANVAS_COLORS.green;
  if (phase === 'descending') badgeColor = CANVAS_COLORS.yellow;
  if (phase === 'ascending') badgeColor = CANVAS_COLORS.orange;

  const text = repIdx >= 0 ? `Rep ${repIdx + 1} - ${phaseLabel}` : phaseLabel;
  const metrics = ctx.measureText(text);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(padding, padding, metrics.width + 16, 28);

  ctx.fillStyle = badgeColor;
  ctx.fillText(text, padding + 8, padding + 19);
}

/** Draw angle labels at key joints. */
export function drawAngleLabels(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmarks,
  width: number,
  height: number,
): void {
  const angles = computeFrameAngles(landmarks);

  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';

  // Pick better visibility side
  const leftVis = (landmarks['left_knee']?.visibility ?? 0);
  const rightVis = (landmarks['right_knee']?.visibility ?? 0);
  const side = leftVis >= rightVis ? 'left' : 'right';

  // Knee angle
  const knee = landmarks[`${side}_knee`];
  if (knee && knee.visibility > 0.3) {
    drawAngleLabel(ctx, knee.x * width, knee.y * height, `${Math.round(angles.kneeAngle)}`, -25, 0);
  }

  // Hip angle
  const hip = landmarks[`${side}_hip`];
  if (hip && hip.visibility > 0.3) {
    drawAngleLabel(ctx, hip.x * width, hip.y * height, `${Math.round(angles.hipAngle)}`, -25, 0);
  }

  // Trunk angle (at shoulder)
  const shoulder = landmarks[`${side}_shoulder`];
  if (shoulder && shoulder.visibility > 0.3) {
    drawAngleLabel(
      ctx,
      shoulder.x * width,
      shoulder.y * height,
      `T:${Math.round(angles.trunkAngle)}`,
      -30,
      -10,
    );
  }
}

export function drawAngleLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  offsetX: number,
  offsetY: number,
): void {
  const lx = x + offsetX;
  const ly = y + offsetY;
  const metrics = ctx.measureText(text);
  const pad = 3;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(
    lx - metrics.width / 2 - pad,
    ly - 10 - pad,
    metrics.width + pad * 2,
    14 + pad * 2,
  );

  ctx.fillStyle = CANVAS_COLORS.text;
  ctx.fillText(text, lx, ly);
}
