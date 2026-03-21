/**
 * Bar path tracking and visualization.
 *
 * Tracks the barbell's trajectory during a lift using MediaPipe landmarks
 * as a proxy for the bar position. Produces an analysis of lateral drift,
 * path shape classification, and path efficiency, plus SVG overlay and
 * summary card renderers.
 *
 * Landmark proxies by exercise:
 * - Squat / OHP (below shoulders): midpoint of left/right shoulders (11, 12)
 * - Bench / Deadlift / OHP (above shoulders): midpoint of left/right wrists (15, 16)
 */

import type { Landmarks, Point } from './types';

// ─── Public Types ───

export interface BarPathPoint {
  /** Normalized X position (0-1, left to right). */
  x: number;
  /** Normalized Y position (0-1, top to bottom). */
  y: number;
  /** Source frame index. */
  frame: number;
  /** Phase at this frame (standing / descending / bottom / ascending). */
  phase: string;
}

export interface BarPathAnalysis {
  /** Ordered bar-path points. */
  points: BarPathPoint[];
  /** Horizontal displacement range as fraction of vertical range (0 = perfectly vertical). */
  lateralDrift: number;
  /** Shape classification of the path. */
  pathShape: 'straight' | 'forward_drift' | 'backward_drift' | 'j_curve' | 's_curve';
  /** Path efficiency score 0-100 (100 = perfectly vertical). */
  pathEfficiency: number;
  /** Midfoot reference X position (normalized 0-1). */
  midfoot: number;
}

// ─── Helpers ───

/** Return the midpoint of two Points, or null if either is missing. */
function midpoint(a: Point | undefined, b: Point | undefined): { x: number; y: number } | null {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Determine whether the wrists are above the shoulders at a given frame.
 * Used for OHP to decide which proxy to use.
 */
function wristsAboveShoulders(lm: Landmarks): boolean {
  const ls = lm['left_shoulder'];
  const rs = lm['right_shoulder'];
  const lw = lm['left_wrist'];
  const rw = lm['right_wrist'];
  if (!ls || !rs || !lw || !rw) return false;
  const shoulderY = (ls.y + rs.y) / 2;
  const wristY = (lw.y + rw.y) / 2;
  // In image coords y increases downward, so wrists above => smaller y
  return wristY < shoulderY;
}

/**
 * Get the bar proxy position for a single frame depending on exercise type.
 */
function getBarProxy(lm: Landmarks, exercise: string): { x: number; y: number } | null {
  const normExercise = exercise.toLowerCase().replace(/[\s_-]/g, '');

  if (normExercise.includes('bench') || normExercise.includes('deadlift') || normExercise.includes('row')) {
    return midpoint(lm['left_wrist'], lm['right_wrist']);
  }

  if (normExercise.includes('overhead') || normExercise.includes('ohp') || normExercise.includes('press')) {
    // For OHP: wrists when above shoulders, otherwise shoulders
    if (wristsAboveShoulders(lm)) {
      return midpoint(lm['left_wrist'], lm['right_wrist']);
    }
    return midpoint(lm['left_shoulder'], lm['right_shoulder']);
  }

  // Default (squat, lunge, etc.): shoulders
  return midpoint(lm['left_shoulder'], lm['right_shoulder']);
}

// ─── Core Analysis Functions ───

/**
 * Extract the bar path from landmark data across frames.
 *
 * @param landmarks  Map of frame index to Landmarks dictionary.
 * @param exercise   Exercise type string (e.g. "squat", "bench_press").
 * @param phases     Optional map of frame index to phase string.
 * @returns          Full bar-path analysis.
 */
export function extractBarPath(
  landmarks: Map<number, Landmarks>,
  exercise: string,
  phases?: Map<number, string>,
): BarPathAnalysis {
  const sortedFrames = Array.from(landmarks.keys()).sort((a, b) => a - b);

  const points: BarPathPoint[] = [];

  for (const frame of sortedFrames) {
    const lm = landmarks.get(frame)!;
    const pos = getBarProxy(lm, exercise);
    if (!pos) continue;
    const phase = phases?.get(frame) ?? 'standing';
    points.push({ x: pos.x, y: pos.y, frame, phase });
  }

  if (points.length === 0) {
    return { points: [], lateralDrift: 0, pathShape: 'straight', pathEfficiency: 100, midfoot: 0.5 };
  }

  // Midfoot reference: ankle midpoint at the first standing frame
  let midfoot = points[0].x;
  const firstFrame = sortedFrames[0];
  const firstLm = landmarks.get(firstFrame);
  if (firstLm) {
    const ankleMid = midpoint(firstLm['left_ankle'], firstLm['right_ankle']);
    if (ankleMid) midfoot = ankleMid.x;
  }

  const lateralDrift = computeLateralDrift(points);
  const pathShape = classifyPathShape(points);
  const pathEfficiency = calculatePathEfficiency(points);

  return { points, lateralDrift, pathShape, pathEfficiency, midfoot };
}

// ─── Lateral Drift ───

function computeLateralDrift(points: BarPathPoint[]): number {
  if (points.length < 2) return 0;

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);

  const xRange = Math.max(...xs) - Math.min(...xs);
  const yRange = Math.max(...ys) - Math.min(...ys);

  if (yRange < 1e-9) return 0;
  return xRange / yRange;
}

// ─── Path Shape Classification ───

/**
 * Classify the bar path shape based on the trajectory of points.
 *
 * - straight: minimal lateral movement (< 3% of vertical range)
 * - j_curve: forward at bottom, back on ascent (common in squats)
 * - s_curve: back then forward then back (common in bench)
 * - forward_drift: progressive forward movement
 * - backward_drift: progressive backward movement
 */
export function classifyPathShape(points: BarPathPoint[]): BarPathAnalysis['pathShape'] {
  if (points.length < 3) return 'straight';

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);

  const yRange = Math.max(...ys) - Math.min(...ys);
  if (yRange < 1e-9) return 'straight';

  const xRange = Math.max(...xs) - Math.min(...xs);
  const driftRatio = xRange / yRange;

  // Very small lateral movement => straight
  if (driftRatio < 0.03) return 'straight';

  // Find the deepest point (max y in image coords)
  let deepestIdx = 0;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    if (points[i].y > maxY) {
      maxY = points[i].y;
      deepestIdx = i;
    }
  }

  const startX = points[0].x;
  const endX = points[points.length - 1].x;
  const deepX = points[deepestIdx].x;

  // S-curve: check for direction changes (at least 2 inflection points).
  // Must be checked BEFORE j_curve since s_curve is more specific.
  let directionChanges = 0;
  for (let i = 2; i < points.length; i++) {
    const prev = points[i - 1].x - points[i - 2].x;
    const curr = points[i].x - points[i - 1].x;
    if (Math.abs(prev) > 0.002 && Math.abs(curr) > 0.002 && Math.sign(prev) !== Math.sign(curr)) {
      directionChanges++;
    }
  }
  if (directionChanges >= 2) return 's_curve';

  // Check for J-curve: bar moves forward at bottom then returns
  // (forward = positive X direction typically, but we compare relative displacement)
  const bottomForwardShift = deepX - startX;
  const returnShift = endX - deepX;

  // J-curve: forward at bottom, returns near start
  if (Math.abs(bottomForwardShift) > 0.01 && Math.sign(bottomForwardShift) !== Math.sign(returnShift)) {
    const returnRatio = Math.abs(endX - startX) / Math.abs(bottomForwardShift);
    if (returnRatio < 0.7) {
      return 'j_curve';
    }
  }

  // Monotonic drift
  const netDrift = endX - startX;
  if (netDrift > 0.02) return 'forward_drift';
  if (netDrift < -0.02) return 'backward_drift';

  return 'straight';
}

// ─── Path Efficiency ───

/**
 * Calculate path efficiency: how close the actual path is to a perfectly
 * vertical line from start to the deepest point and back.
 *
 * 100 = perfectly vertical, 0 = extreme horizontal deviation.
 */
export function calculatePathEfficiency(points: BarPathPoint[]): number {
  if (points.length < 2) return 100;

  const refX = points[0].x;
  const ys = points.map(p => p.y);
  const yRange = Math.max(...ys) - Math.min(...ys);

  if (yRange < 1e-9) return 100;

  // Sum of absolute horizontal deviations from the reference vertical line,
  // normalized by the vertical range and number of points.
  let totalDeviation = 0;
  for (const p of points) {
    totalDeviation += Math.abs(p.x - refX);
  }
  const avgDeviation = totalDeviation / points.length;
  const normalizedDeviation = avgDeviation / yRange;

  // Map to 0-100 scale. A normalizedDeviation of 0.5 or more => efficiency 0.
  const efficiency = Math.max(0, Math.min(100, (1 - normalizedDeviation / 0.5) * 100));
  return Math.round(efficiency);
}

// ─── SVG Overlay Rendering ───

/**
 * Render the bar path as an SVG overlay string.
 *
 * Shows:
 * - Actual path as a polyline colored by phase
 * - Dashed vertical reference line from the starting position
 * - Midfoot marker (small triangle at the bottom)
 * - Color indicates efficiency: green (good), yellow (moderate), red (poor)
 */
export function renderBarPathOverlay(
  analysis: BarPathAnalysis,
  width: number,
  height: number,
): string {
  if (analysis.points.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`;
  }

  const pad = 10;
  const drawW = width - pad * 2;
  const drawH = height - pad * 2;

  // Find data bounds for scaling
  const xs = analysis.points.map(p => p.x);
  const ys = analysis.points.map(p => p.y);
  const minX = Math.min(...xs, analysis.midfoot);
  const maxX = Math.max(...xs, analysis.midfoot);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const xRange = maxX - minX || 0.01;
  const yRange = maxY - minY || 0.01;

  const toSvgX = (x: number) => pad + ((x - minX) / xRange) * drawW;
  const toSvgY = (y: number) => pad + ((y - minY) / yRange) * drawH;

  // Overall color based on efficiency
  const effColor = analysis.pathEfficiency >= 80 ? '#4caf50'
    : analysis.pathEfficiency >= 50 ? '#ff9800'
    : '#f44336';

  // Phase colors
  const phaseColor: Record<string, string> = {
    standing: '#90a4ae',
    descending: '#42a5f5',
    bottom: '#ef5350',
    ascending: '#66bb6a',
  };

  // Reference vertical line from start
  const refX = toSvgX(analysis.points[0].x);
  let elements = `<line x1="${refX}" y1="${pad}" x2="${refX}" y2="${height - pad}" stroke="#ffffff" stroke-width="1" stroke-dasharray="4,4" opacity="0.4"/>`;

  // Midfoot marker (small triangle)
  const mfX = toSvgX(analysis.midfoot);
  const mfY = height - pad;
  elements += `<polygon points="${mfX - 5},${mfY} ${mfX + 5},${mfY} ${mfX},${mfY - 8}" fill="#ff9800" opacity="0.7"/>`;

  // Draw path segments colored by phase
  for (let i = 1; i < analysis.points.length; i++) {
    const p0 = analysis.points[i - 1];
    const p1 = analysis.points[i];
    const color = phaseColor[p1.phase] ?? effColor;
    elements += `<line x1="${toSvgX(p0.x)}" y1="${toSvgY(p0.y)}" x2="${toSvgX(p1.x)}" y2="${toSvgY(p1.y)}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`;
  }

  // Start and end markers
  const startP = analysis.points[0];
  const endP = analysis.points[analysis.points.length - 1];
  elements += `<circle cx="${toSvgX(startP.x)}" cy="${toSvgY(startP.y)}" r="4" fill="#ffffff" opacity="0.9"/>`;
  elements += `<circle cx="${toSvgX(endP.x)}" cy="${toSvgY(endP.y)}" r="4" fill="${effColor}" opacity="0.9"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${elements}</svg>`;
}

// ─── Summary Card Rendering ───

const SHAPE_LABELS: Record<BarPathAnalysis['pathShape'], string> = {
  straight: 'Straight',
  forward_drift: 'Forward Drift',
  backward_drift: 'Backward Drift',
  j_curve: 'J-Curve',
  s_curve: 'S-Curve',
};

const SHAPE_NOTES: Record<string, Record<BarPathAnalysis['pathShape'], string>> = {
  squat: {
    straight: 'Ideal bar path. Minimal energy loss.',
    forward_drift: 'Bar drifts forward — may indicate weak quads or excessive forward lean.',
    backward_drift: 'Bar drifts backward — uncommon, check stance width.',
    j_curve: 'Slight forward shift at the bottom — common and generally acceptable.',
    s_curve: 'Multiple direction changes — suggests instability through the lift.',
  },
  deadlift: {
    straight: 'Ideal bar path. Minimal energy loss.',
    forward_drift: 'Bar drifts away from the body — keep lats tight.',
    backward_drift: 'Bar moves too far back — risk of overextension.',
    j_curve: 'Bar swings around the knees — work on pulling back off the floor.',
    s_curve: 'Bar path has multiple bends — common in conventional, focus on lats.',
  },
  bench_press: {
    straight: 'Pressing in a straight line — acceptable for close-grip.',
    forward_drift: 'Bar drifts toward the face — maintain shoulder stability.',
    backward_drift: 'Bar drifts toward the belly — check touch point.',
    j_curve: 'Slight arc from chest to lockout — the standard bench press path.',
    s_curve: 'Reverse arc pattern — common with a leg drive tuck.',
  },
  _default: {
    straight: 'Minimal lateral deviation.',
    forward_drift: 'Bar drifts forward through the lift.',
    backward_drift: 'Bar drifts backward through the lift.',
    j_curve: 'J-shaped path detected.',
    s_curve: 'S-shaped path detected.',
  },
};

function getNoteForExercise(exercise: string, shape: BarPathAnalysis['pathShape']): string {
  const normalized = exercise.toLowerCase().replace(/[\s_-]/g, '');
  if (normalized.includes('squat') || normalized.includes('lunge')) {
    return SHAPE_NOTES['squat'][shape];
  }
  if (normalized.includes('deadlift') || normalized.includes('row')) {
    return SHAPE_NOTES['deadlift'][shape];
  }
  if (normalized.includes('bench')) {
    return SHAPE_NOTES['bench_press'][shape];
  }
  return SHAPE_NOTES['_default'][shape];
}

/**
 * Render a compact bar path summary card for results display.
 */
export function renderBarPathCard(analysis: BarPathAnalysis, exercise: string): string {
  if (analysis.points.length === 0) {
    return '';
  }

  const effColor = analysis.pathEfficiency >= 80 ? 'var(--success, #4caf50)'
    : analysis.pathEfficiency >= 50 ? 'var(--warning, #ff9800)'
    : 'var(--danger, #f44336)';

  const shapeLabel = SHAPE_LABELS[analysis.pathShape];
  const note = getNoteForExercise(exercise, analysis.pathShape);
  const driftPct = (analysis.lateralDrift * 100).toFixed(1);

  return `
    <div class="bar-path-card">
      <div class="bar-path-heading">Bar Path Analysis</div>
      <div class="bar-path-stats">
        <div class="bar-path-stat">
          <span class="bar-path-stat-label">Path Efficiency</span>
          <span class="bar-path-stat-value" style="color: ${effColor};">${analysis.pathEfficiency}%</span>
        </div>
        <div class="bar-path-stat">
          <span class="bar-path-stat-label">Shape</span>
          <span class="bar-path-stat-value">${shapeLabel}</span>
        </div>
        <div class="bar-path-stat">
          <span class="bar-path-stat-label">Lateral Drift</span>
          <span class="bar-path-stat-value">${driftPct}%</span>
        </div>
      </div>
      <div class="bar-path-note">${note}</div>
    </div>
  `;
}
