/**
 * Strength progression charts: SVG-based line charts for visualizing
 * training progress over time (e1RM trends, volume, bodyweight).
 *
 * Data sources:
 * - WorkoutLog sets (workout-storage.ts) for e1RM and volume
 * - BodyEntry (body-tracker.ts) for bodyweight trends
 * - PR records (pr-tracker.ts) for highlighting PRs
 */

// ─── Types ───

export interface ChartDataPoint {
  date: string;    // ISO date (YYYY-MM-DD or ISO string)
  value: number;
  label?: string;  // tooltip text
}

export interface ChartConfig {
  title: string;
  yAxisLabel: string;
  color: string;
  points: ChartDataPoint[];
  showTrend?: boolean;    // overlay linear trend line
  highlightPRs?: boolean; // mark PR points with a larger dot
}

// ─── Lift Colors ───

export const LIFT_COLORS: Record<string, string> = {
  squat: '#4fc3f7',
  bench: '#f87171',
  deadlift: '#4ade80',
  ohp: '#fbbf24',
};

// ─── Internal Helpers ───

/** Normalize a date string to YYYY-MM-DD. */
function normalizeDate(d: string): string {
  return d.slice(0, 10);
}

/** Parse YYYY-MM-DD to a Date for x-axis positioning. */
function parseDate(d: string): Date {
  const parts = normalizeDate(d).split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

/** Format a date as "Jan", "Feb 15", etc. depending on density. */
function formatMonthLabel(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[d.getMonth()];
}

function formatDateLabel(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

/** Escape text for SVG XML. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Linear regression: returns [slope, intercept]. */
export function linearRegression(points: Array<{ x: number; y: number }>): [number, number] {
  const n = points.length;
  if (n < 2) return [0, points[0]?.y ?? 0];

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }

  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return [0, sumY / n];

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return [slope, intercept];
}

/** Compute nice Y-axis ticks. */
function computeYTicks(minVal: number, maxVal: number, targetTicks: number = 5): number[] {
  if (minVal === maxVal) {
    const v = minVal;
    return [v - 10, v - 5, v, v + 5, v + 10];
  }
  const range = maxVal - minVal;
  const rawStep = range / (targetTicks - 1);
  // Round step to a nice number
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  let niceStep: number;
  if (residual <= 1.5) niceStep = magnitude;
  else if (residual <= 3) niceStep = 2 * magnitude;
  else if (residual <= 7) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;

  const start = Math.floor(minVal / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let v = start; v <= maxVal + niceStep * 0.01; v += niceStep) {
    ticks.push(Math.round(v * 100) / 100);
  }
  // Ensure we have at least 2 ticks
  if (ticks.length < 2) {
    ticks.unshift(ticks[0] - niceStep);
  }
  return ticks;
}

// ─── Core SVG Rendering ───

/**
 * Render an SVG line chart.
 * Responsive width, fixed aspect ratio.
 * Handles: empty data, single point, many points (100+).
 */
export function renderLineChart(config: ChartConfig, width: number = 600, height: number = 300): string {
  const { title, yAxisLabel, color, points, showTrend, highlightPRs } = config;

  // Empty state
  if (!points || points.length === 0) {
    return `<div class="chart-empty" style="width:100%;aspect-ratio:${width}/${height};display:flex;align-items:center;justify-content:center;border:1px dashed var(--border,#555);border-radius:8px;color:var(--text-muted,#999);font-size:14px;padding:16px;box-sizing:border-box;">` +
      `Not enough data yet — log 3+ workouts to see trends</div>`;
  }

  // Single point
  if (points.length === 1) {
    const p = points[0];
    return `<div class="chart-empty" style="width:100%;aspect-ratio:${width}/${height};display:flex;align-items:center;justify-content:center;border:1px dashed var(--border,#555);border-radius:8px;color:var(--text-muted,#999);font-size:14px;padding:16px;box-sizing:border-box;flex-direction:column;">` +
      `<span style="font-size:24px;color:${color};font-weight:600;">${p.value}</span>` +
      `<span>${esc(yAxisLabel)} on ${normalizeDate(p.date)}</span>` +
      `<span style="margin-top:4px;">Log more workouts to see trends</span></div>`;
  }

  // Layout constants
  const padLeft = 55;
  const padRight = 20;
  const padTop = 30;
  const padBottom = 40;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  // Compute date range
  const dates = points.map(p => parseDate(p.date).getTime());
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const dateRange = maxDate - minDate || 1;

  // Compute value range
  const values = points.map(p => p.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const yTicks = computeYTicks(rawMin, rawMax);
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const valRange = yMax - yMin || 1;

  // Map data to SVG coordinates
  function toX(dateMs: number): number {
    return padLeft + ((dateMs - minDate) / dateRange) * plotW;
  }
  function toY(val: number): number {
    return padTop + plotH - ((val - yMin) / valRange) * plotH;
  }

  // Build polyline points string
  const polyPoints = points.map(p => {
    const x = toX(parseDate(p.date).getTime());
    const y = toY(p.value);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  // Find PR points (running maximum)
  let prIndices: Set<number> = new Set();
  if (highlightPRs) {
    let maxSoFar = -Infinity;
    for (let i = 0; i < points.length; i++) {
      if (points[i].value > maxSoFar) {
        maxSoFar = points[i].value;
        prIndices.add(i);
      }
    }
  }

  // Build SVG
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" class="progression-chart" style="width:100%;height:auto;" role="img" aria-label="${esc(title)}">`;

  // Title
  svg += `<text x="${width / 2}" y="18" text-anchor="middle" fill="var(--text,#eee)" font-size="14" font-weight="600">${esc(title)}</text>`;

  // Y-axis gridlines and labels
  for (const tick of yTicks) {
    const y = toY(tick);
    svg += `<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" stroke="var(--border,#333)" stroke-width="0.5" stroke-dasharray="4,4"/>`;
    svg += `<text x="${padLeft - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="var(--text-muted,#999)" font-size="11">${tick}</text>`;
  }

  // Y-axis label
  svg += `<text x="14" y="${padTop + plotH / 2}" text-anchor="middle" fill="var(--text-muted,#999)" font-size="11" transform="rotate(-90, 14, ${padTop + plotH / 2})">${esc(yAxisLabel)}</text>`;

  // X-axis date labels (distribute evenly, avoid overlap)
  const maxLabels = Math.min(points.length, Math.floor(plotW / 60));
  const labelStep = Math.max(1, Math.floor(points.length / maxLabels));
  for (let i = 0; i < points.length; i += labelStep) {
    const d = parseDate(points[i].date);
    const x = toX(d.getTime());
    const label = points.length > 20 ? formatMonthLabel(d) : formatDateLabel(d);
    svg += `<text x="${x.toFixed(1)}" y="${height - 8}" text-anchor="middle" fill="var(--text-muted,#999)" font-size="10">${esc(label)}</text>`;
  }

  // Data line
  svg += `<polyline points="${polyPoints}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;

  // Trend line
  if (showTrend && points.length >= 3) {
    const regressionPoints = points.map((p, i) => ({ x: i, y: p.value }));
    const [slope, intercept] = linearRegression(regressionPoints);
    const trendStart = toY(intercept);
    const trendEnd = toY(slope * (points.length - 1) + intercept);
    const x1 = toX(parseDate(points[0].date).getTime());
    const x2 = toX(parseDate(points[points.length - 1].date).getTime());
    svg += `<line x1="${x1.toFixed(1)}" y1="${trendStart.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${trendEnd.toFixed(1)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="6,4" opacity="0.5"/>`;
  }

  // Data points
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = toX(parseDate(p.date).getTime());
    const y = toY(p.value);
    const isPR = prIndices.has(i);
    const radius = isPR ? 5 : 3;
    const tooltip = p.label || `${normalizeDate(p.date)}: ${p.value}`;

    if (isPR) {
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius}" fill="#fbbf24" stroke="#fff" stroke-width="1.5">`;
      svg += `<title>${esc(tooltip)} (PR!)</title></circle>`;
    } else {
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius}" fill="${color}" stroke="none" opacity="0.8" class="chart-point">`;
      svg += `<title>${esc(tooltip)}</title></circle>`;
    }
  }

  svg += '</svg>';
  return svg;
}

/**
 * Render a multi-line chart (e.g., SBD e1RMs on one chart).
 */
export function renderMultiLineChart(
  configs: ChartConfig[],
  title: string,
  width: number = 600,
  height: number = 300,
): string {
  // Filter to configs with data
  const validConfigs = configs.filter(c => c.points.length >= 2);

  if (validConfigs.length === 0) {
    return `<div class="chart-empty" style="width:100%;aspect-ratio:${width}/${height};display:flex;align-items:center;justify-content:center;border:1px dashed var(--border,#555);border-radius:8px;color:var(--text-muted,#999);font-size:14px;padding:16px;box-sizing:border-box;">` +
      `Not enough data yet — log 3+ workouts to see trends</div>`;
  }

  // Layout
  const padLeft = 55;
  const padRight = 20;
  const padTop = 30;
  const padBottom = 50; // extra for legend
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  // Global date and value ranges across all series
  const allDates = validConfigs.flatMap(c => c.points.map(p => parseDate(p.date).getTime()));
  const allValues = validConfigs.flatMap(c => c.points.map(p => p.value));
  const minDate = Math.min(...allDates);
  const maxDate = Math.max(...allDates);
  const dateRange = maxDate - minDate || 1;
  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const yTicks = computeYTicks(rawMin, rawMax);
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const valRange = yMax - yMin || 1;

  function toX(dateMs: number): number {
    return padLeft + ((dateMs - minDate) / dateRange) * plotW;
  }
  function toY(val: number): number {
    return padTop + plotH - ((val - yMin) / valRange) * plotH;
  }

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" class="progression-chart" style="width:100%;height:auto;" role="img" aria-label="${esc(title)}">`;

  // Title
  svg += `<text x="${width / 2}" y="18" text-anchor="middle" fill="var(--text,#eee)" font-size="14" font-weight="600">${esc(title)}</text>`;

  // Y-axis gridlines
  for (const tick of yTicks) {
    const y = toY(tick);
    svg += `<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" stroke="var(--border,#333)" stroke-width="0.5" stroke-dasharray="4,4"/>`;
    svg += `<text x="${padLeft - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="var(--text-muted,#999)" font-size="11">${tick}</text>`;
  }

  // X-axis labels (from first valid config, shared axis)
  const allPointsSorted = validConfigs.flatMap(c => c.points)
    .sort((a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime());
  const uniqueDates = [...new Set(allPointsSorted.map(p => normalizeDate(p.date)))];
  const maxLabels = Math.min(uniqueDates.length, Math.floor(plotW / 60));
  const labelStep = Math.max(1, Math.floor(uniqueDates.length / maxLabels));
  for (let i = 0; i < uniqueDates.length; i += labelStep) {
    const d = parseDate(uniqueDates[i]);
    const x = toX(d.getTime());
    const label = uniqueDates.length > 20 ? formatMonthLabel(d) : formatDateLabel(d);
    svg += `<text x="${x.toFixed(1)}" y="${padTop + plotH + 16}" text-anchor="middle" fill="var(--text-muted,#999)" font-size="10">${esc(label)}</text>`;
  }

  // Draw each series
  for (const config of validConfigs) {
    const { color, points, showTrend } = config;

    // Polyline
    const polyPoints = points.map(p => {
      const x = toX(parseDate(p.date).getTime());
      const y = toY(p.value);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    svg += `<polyline points="${polyPoints}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;

    // Trend line
    if (showTrend && points.length >= 3) {
      const regressionPoints = points.map((p, i) => ({ x: i, y: p.value }));
      const [slope, intercept] = linearRegression(regressionPoints);
      const trendStartY = toY(intercept);
      const trendEndY = toY(slope * (points.length - 1) + intercept);
      const x1 = toX(parseDate(points[0].date).getTime());
      const x2 = toX(parseDate(points[points.length - 1].date).getTime());
      svg += `<line x1="${x1.toFixed(1)}" y1="${trendStartY.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${trendEndY.toFixed(1)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="6,4" opacity="0.4"/>`;
    }

    // Points
    for (const p of points) {
      const x = toX(parseDate(p.date).getTime());
      const y = toY(p.value);
      const tooltip = p.label || `${normalizeDate(p.date)}: ${p.value}`;
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${color}" stroke="none" opacity="0.8" class="chart-point">`;
      svg += `<title>${esc(tooltip)}</title></circle>`;
    }
  }

  // Legend
  const legendY = height - 10;
  const legendItemW = Math.min(120, plotW / validConfigs.length);
  const legendStartX = padLeft + (plotW - validConfigs.length * legendItemW) / 2;
  for (let i = 0; i < validConfigs.length; i++) {
    const c = validConfigs[i];
    const x = legendStartX + i * legendItemW;
    svg += `<rect x="${x}" y="${legendY - 8}" width="12" height="8" rx="2" fill="${c.color}"/>`;
    svg += `<text x="${x + 16}" y="${legendY}" fill="var(--text-muted,#ccc)" font-size="10">${esc(c.title)}</text>`;
  }

  svg += '</svg>';
  return svg;
}

// ─── Data Extraction ───

/** Log shape expected by chart builders (subset of WorkoutLog). */
export interface ChartWorkoutLog {
  date: string;
  sets: Array<{
    exerciseSlot: string;
    actualWeight?: number;
    actualReps?: number;
    completed: boolean;
  }>;
}

/**
 * Build e1RM progression data from workout logs.
 * Extracts the estimated 1RM for each lift over time.
 * Uses Epley formula: e1RM = weight * (1 + reps/30) for reps > 1.
 */
export function buildE1RMProgression(
  logs: ChartWorkoutLog[],
): Record<string, ChartDataPoint[]> {
  const result: Record<string, ChartDataPoint[]> = {};

  // Sort logs chronologically
  const sorted = [...logs].sort((a, b) =>
    normalizeDate(a.date).localeCompare(normalizeDate(b.date))
  );

  for (const log of sorted) {
    // For each day, find the best e1RM per lift
    const dayBest: Record<string, { e1rm: number; weight: number; reps: number }> = {};

    for (const set of log.sets) {
      if (!set.completed || !set.actualWeight || !set.actualReps) continue;
      if (set.actualWeight <= 0 || set.actualReps <= 0 || set.actualReps > 15) continue;

      const w = set.actualWeight;
      const r = set.actualReps;
      const e1rm = r === 1 ? w : Math.round(w * (1 + r / 30));
      const slot = set.exerciseSlot;

      if (!dayBest[slot] || e1rm > dayBest[slot].e1rm) {
        dayBest[slot] = { e1rm, weight: w, reps: r };
      }
    }

    for (const [slot, best] of Object.entries(dayBest)) {
      if (!result[slot]) result[slot] = [];
      result[slot].push({
        date: normalizeDate(log.date),
        value: best.e1rm,
        label: `e1RM: ${best.e1rm} (${best.weight} x ${best.reps})`,
      });
    }
  }

  return result;
}

/**
 * Build weekly volume progression (total completed sets per week).
 * Groups by ISO week (Monday-Sunday).
 */
export function buildVolumeProgression(
  logs: Array<{ date: string; sets: Array<{ completed: boolean }> }>,
): ChartDataPoint[] {
  // Group sets by week
  const weekMap = new Map<string, number>();

  for (const log of logs) {
    const d = parseDate(log.date);
    // Get Monday of the week
    const day = d.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + mondayOffset);
    const weekKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;

    const completedSets = log.sets.filter(s => s.completed).length;
    weekMap.set(weekKey, (weekMap.get(weekKey) ?? 0) + completedSets);
  }

  // Sort by week and convert
  const weeks = [...weekMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return weeks.map(([weekStart, totalSets]) => ({
    date: weekStart,
    value: totalSets,
    label: `Week of ${weekStart}: ${totalSets} sets`,
  }));
}

/**
 * Build bodyweight progression from body tracker data.
 */
export function buildBodyweightProgression(
  entries: Array<{ date: string; weight: number }>,
): ChartDataPoint[] {
  // Sort chronologically
  const sorted = [...entries]
    .filter(e => e.weight > 0)
    .sort((a, b) => normalizeDate(a.date).localeCompare(normalizeDate(b.date)));

  return sorted.map(e => ({
    date: normalizeDate(e.date),
    value: e.weight,
    label: `${e.weight} on ${normalizeDate(e.date)}`,
  }));
}

/**
 * Render a complete progression dashboard card with tabbed charts:
 * - Tab 1: e1RM trends (SBD + OHP on one chart, color-coded)
 * - Tab 2: Volume trend (weekly total sets)
 * - Tab 3: Bodyweight trend
 */
export function renderProgressionDashboard(
  logs: ChartWorkoutLog[],
  bodyEntries?: Array<{ date: string; weight: number }>,
): string {
  const e1rmData = buildE1RMProgression(logs);
  const volumeData = buildVolumeProgression(logs);
  const bwData = bodyEntries ? buildBodyweightProgression(bodyEntries) : [];

  // Build e1RM multi-line chart configs
  const mainLifts = ['squat', 'bench', 'deadlift', 'ohp'];
  const e1rmConfigs: ChartConfig[] = mainLifts
    .filter(lift => (e1rmData[lift]?.length ?? 0) >= 2)
    .map(lift => ({
      title: lift.charAt(0).toUpperCase() + lift.slice(1),
      yAxisLabel: 'e1RM',
      color: LIFT_COLORS[lift] || '#ccc',
      points: e1rmData[lift],
      showTrend: true,
      highlightPRs: true,
    }));

  const e1rmChart = e1rmConfigs.length > 0
    ? renderMultiLineChart(e1rmConfigs, 'Estimated 1RM Trends')
    : renderLineChart({ title: 'Estimated 1RM Trends', yAxisLabel: 'e1RM', color: '#4fc3f7', points: [], showTrend: false });

  const volumeChart = renderLineChart({
    title: 'Weekly Volume (Completed Sets)',
    yAxisLabel: 'Sets',
    color: '#a78bfa',
    points: volumeData,
    showTrend: true,
  });

  const bwChart = renderLineChart({
    title: 'Bodyweight',
    yAxisLabel: 'Weight',
    color: '#fb923c',
    points: bwData,
    showTrend: true,
  });

  // Generate unique ID suffix for this dashboard instance
  const uid = Math.random().toString(36).slice(2, 8);

  return `<div class="progression-dashboard">
  <div class="chart-tabs" role="tablist">
    <button class="chart-tab active" role="tab" data-chart-tab="${uid}-e1rm" aria-selected="true">e1RM</button>
    <button class="chart-tab" role="tab" data-chart-tab="${uid}-volume" aria-selected="false">Volume</button>
    <button class="chart-tab" role="tab" data-chart-tab="${uid}-bw" aria-selected="false">Bodyweight</button>
  </div>
  <div class="chart-panel active" data-chart-panel="${uid}-e1rm">${e1rmChart}</div>
  <div class="chart-panel" data-chart-panel="${uid}-volume" style="display:none;">${volumeChart}</div>
  <div class="chart-panel" data-chart-panel="${uid}-bw" style="display:none;">${bwChart}</div>
</div>`;
}

// ─── Styles ───

let stylesInjected = false;

/**
 * Inject chart styles into the document head.
 */
export function injectChartStyles(): void {
  if (stylesInjected) return;
  if (typeof document === 'undefined') return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .progression-dashboard {
      border: 1px solid var(--border, #333);
      border-radius: 12px;
      overflow: hidden;
      background: var(--bg-card, #1a1a2e);
    }
    .chart-tabs {
      display: flex;
      border-bottom: 1px solid var(--border, #333);
    }
    .chart-tab {
      flex: 1;
      padding: 10px 12px;
      background: none;
      border: none;
      color: var(--text-muted, #999);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: color 0.2s, border-color 0.2s;
    }
    .chart-tab.active {
      color: var(--accent, #4fc3f7);
      border-bottom-color: var(--accent, #4fc3f7);
    }
    .chart-tab:hover:not(.active) {
      color: var(--text, #eee);
    }
    .chart-panel {
      padding: 12px;
    }
    .chart-empty {
      text-align: center;
    }
    .progression-chart .chart-point:hover {
      r: 5;
      opacity: 1;
    }
  `;
  document.head.appendChild(style);
}
