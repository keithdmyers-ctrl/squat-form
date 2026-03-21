/**
 * SVG anatomical muscle map visualization.
 * Colors muscle groups by training volume zone (MEV/MAV/MRV).
 * Front/back views with hover tooltips and interactive toggle.
 *
 * References:
 * - Israetel M. Scientific Principles of Hypertrophy Training (2020)
 * - Schoenfeld et al. (2017) dose-response for volume
 */

import type { MuscleVolume } from './volume-tracker';
import { EXERCISE_SLOTS } from './workout-programs';

// ─── Types ───

export type MuscleMapView = 'front' | 'back';
export type MuscleIntensity = 'none' | 'low' | 'moderate' | 'optimal' | 'high' | 'excessive';

export interface MuscleMapData {
  muscleGroup: string;
  label: string;
  intensity: MuscleIntensity;
  sets: number;
  zone: string;
  tooltip: string;
}

// ─── SVG Region Definitions ───

interface MuscleRegion {
  muscle: string;
  label: string;
  /** SVG path data for the muscle region */
  path: string;
}

/**
 * Front-view muscle regions positioned within a 200x400 viewBox.
 * Each path is a simplified geometric shape representing the muscle group.
 */
const FRONT_REGIONS: MuscleRegion[] = [
  // Head (decorative, no muscle data)
  // Chest — two pec shapes
  {
    muscle: 'chest',
    label: 'Chest',
    path: 'M70,105 Q72,95 85,93 Q100,91 100,105 Q100,115 85,117 Q72,115 70,105 Z M130,105 Q128,95 115,93 Q100,91 100,105 Q100,115 115,117 Q128,115 130,105 Z',
  },
  // Front delts — small caps on shoulders
  {
    muscle: 'front_delts',
    label: 'Front Delts',
    path: 'M58,88 Q55,82 60,78 Q68,76 72,82 Q74,90 70,95 Q64,96 58,88 Z M142,88 Q145,82 140,78 Q132,76 128,82 Q126,90 130,95 Q136,96 142,88 Z',
  },
  // Shoulders — deltoid cap (combined view, overlaps with front_delts slightly)
  {
    muscle: 'shoulders',
    label: 'Shoulders',
    path: 'M55,86 Q52,78 58,74 Q66,72 70,78 Q72,84 68,90 Q62,92 55,86 Z M145,86 Q148,78 142,74 Q134,72 130,78 Q128,84 132,90 Q138,92 145,86 Z',
  },
  // Biceps — front of upper arm
  {
    muscle: 'biceps',
    label: 'Biceps',
    path: 'M50,102 Q46,108 44,120 Q42,135 44,148 Q48,152 52,148 Q56,135 56,120 Q55,108 50,102 Z M150,102 Q154,108 156,120 Q158,135 156,148 Q152,152 148,148 Q144,135 144,120 Q145,108 150,102 Z',
  },
  // Core / Abs — central torso
  {
    muscle: 'core',
    label: 'Core',
    path: 'M82,120 Q80,125 80,140 Q80,160 82,175 Q85,185 100,185 Q115,185 118,175 Q120,160 120,140 Q120,125 118,120 Q110,118 100,118 Q90,118 82,120 Z',
  },
  // Quads — front of thigh
  {
    muscle: 'quads',
    label: 'Quads',
    path: 'M72,195 Q68,210 66,235 Q65,255 67,275 Q70,285 82,288 Q88,286 90,275 Q92,255 90,235 Q88,210 85,195 Z M128,195 Q132,210 134,235 Q135,255 133,275 Q130,285 118,288 Q112,286 110,275 Q108,255 110,235 Q112,210 115,195 Z',
  },
  // Calves (front view) — lower leg
  {
    muscle: 'calves',
    label: 'Calves',
    path: 'M72,305 Q70,315 70,330 Q70,345 73,355 Q76,360 82,358 Q86,352 85,340 Q84,325 82,310 Q80,305 72,305 Z M128,305 Q130,315 130,330 Q130,345 127,355 Q124,360 118,358 Q114,352 115,340 Q116,325 118,310 Q120,305 128,305 Z',
  },
];

/**
 * Back-view muscle regions positioned within a 200x400 viewBox.
 */
const BACK_REGIONS: MuscleRegion[] = [
  // Upper back / traps — broad upper back
  {
    muscle: 'upper_back',
    label: 'Upper Back',
    path: 'M75,80 Q78,75 90,74 Q100,73 110,74 Q122,75 125,80 Q128,88 125,96 Q120,100 100,100 Q80,100 75,96 Q72,88 75,80 Z',
  },
  // Back / lats — mid back
  {
    muscle: 'back',
    label: 'Back',
    path: 'M72,100 Q70,110 70,125 Q70,140 74,150 Q80,158 90,160 Q95,158 95,145 Q94,130 92,115 Q90,105 80,100 Z M128,100 Q130,110 130,125 Q130,140 126,150 Q120,158 110,160 Q105,158 105,145 Q106,130 108,115 Q110,105 120,100 Z',
  },
  // Rear delts — back of shoulder
  {
    muscle: 'rear_delts',
    label: 'Rear Delts',
    path: 'M58,88 Q55,82 60,78 Q68,76 72,82 Q74,90 70,95 Q64,96 58,88 Z M142,88 Q145,82 140,78 Q132,76 128,82 Q126,90 130,95 Q136,96 142,88 Z',
  },
  // Triceps — back of upper arm
  {
    muscle: 'triceps',
    label: 'Triceps',
    path: 'M50,102 Q46,108 44,120 Q42,135 44,148 Q48,152 52,148 Q56,135 56,120 Q55,108 50,102 Z M150,102 Q154,108 156,120 Q158,135 156,148 Q152,152 148,148 Q144,135 144,120 Q145,108 150,102 Z',
  },
  // Lower back — erectors
  {
    muscle: 'lower_back',
    label: 'Lower Back',
    path: 'M85,155 Q82,165 82,178 Q82,188 88,192 Q95,194 100,192 Q105,194 112,192 Q118,188 118,178 Q118,165 115,155 Q108,150 100,150 Q92,150 85,155 Z',
  },
  // Glutes — rear
  {
    muscle: 'glutes',
    label: 'Glutes',
    path: 'M72,192 Q68,200 68,212 Q70,224 78,228 Q88,230 98,228 Q100,226 100,218 Q98,206 92,196 Q84,192 72,192 Z M128,192 Q132,200 132,212 Q130,224 122,228 Q112,230 102,228 Q100,226 100,218 Q102,206 108,196 Q116,192 128,192 Z',
  },
  // Hamstrings — back of thigh
  {
    muscle: 'hamstrings',
    label: 'Hamstrings',
    path: 'M72,235 Q68,250 66,270 Q66,285 70,295 Q76,300 82,298 Q88,292 90,275 Q90,255 88,240 Q85,232 72,235 Z M128,235 Q132,250 134,270 Q134,285 130,295 Q124,300 118,298 Q112,292 110,275 Q110,255 112,240 Q115,232 128,235 Z',
  },
  // Calves (back view)
  {
    muscle: 'calves',
    label: 'Calves',
    path: 'M72,305 Q68,315 68,330 Q68,345 73,355 Q78,362 84,358 Q88,350 86,335 Q84,320 80,308 Q78,305 72,305 Z M128,305 Q132,315 132,330 Q132,345 127,355 Q122,362 116,358 Q112,350 114,335 Q116,320 120,308 Q122,305 128,305 Z',
  },
];

/**
 * Body silhouette outline for front view.
 * A simplified human body contour (no muscle data).
 */
const BODY_OUTLINE_FRONT = `
  M100,18 Q112,18 116,26 Q120,34 118,44 Q116,50 112,54
  Q118,56 130,72 Q138,72 148,74 Q156,78 160,90
  Q164,102 162,118 Q160,132 156,148 Q152,158 148,160
  Q144,166 140,170 Q136,174 134,180 Q132,186 130,190
  Q128,194 128,195 Q134,210 136,235 Q138,260 134,280
  Q130,295 128,305 Q132,318 132,335 Q132,350 128,360
  Q124,370 118,375 Q112,378 108,380 Q104,382 100,382
  Q96,382 92,380 Q88,378 82,375
  Q76,370 72,360 Q68,350 68,335
  Q68,318 72,305 Q70,295 66,280
  Q62,260 64,235 Q66,210 72,195
  Q72,194 70,190 Q68,186 66,180
  Q64,174 60,170 Q56,166 52,160
  Q48,158 44,148 Q40,132 38,118
  Q36,102 40,90 Q44,78 52,74
  Q62,72 70,72 Q82,56 88,54
  Q84,50 82,44 Q80,34 84,26
  Q88,18 100,18 Z
`;

/**
 * Body silhouette outline for back view (mirrored).
 */
const BODY_OUTLINE_BACK = `
  M100,18 Q112,18 116,26 Q120,34 118,44 Q116,50 112,54
  Q118,56 130,72 Q138,72 148,74 Q156,78 160,90
  Q164,102 162,118 Q160,132 156,148 Q152,158 148,160
  Q144,166 140,170 Q136,174 134,180 Q132,186 130,190
  Q128,194 128,195 Q134,210 136,235 Q138,260 134,280
  Q130,295 128,305 Q132,318 132,335 Q132,350 128,360
  Q124,370 118,375 Q112,378 108,380 Q104,382 100,382
  Q96,382 92,380 Q88,378 82,375
  Q76,370 72,360 Q68,350 68,335
  Q68,318 72,305 Q70,295 66,280
  Q62,260 64,235 Q66,210 72,195
  Q72,194 70,190 Q68,186 66,180
  Q64,174 60,170 Q56,166 52,160
  Q48,158 44,148 Q40,132 38,118
  Q36,102 40,90 Q44,78 52,74
  Q62,72 70,72 Q82,56 88,54
  Q84,50 82,44 Q80,34 84,26
  Q88,18 100,18 Z
`;

// ─── Layout ───

/**
 * Get the SVG muscle region layout for front and back views.
 */
export function getMuscleMapLayout(): {
  front: MuscleRegion[];
  back: MuscleRegion[];
} {
  return {
    front: FRONT_REGIONS,
    back: BACK_REGIONS,
  };
}

// ─── Color Mapping ───

/**
 * Get the fill color for a muscle based on its training intensity zone.
 * Colors are chosen to match the app's design system (CSS variable equivalents).
 */
export function getMuscleColor(intensity: MuscleIntensity): string {
  switch (intensity) {
    case 'none':       return 'rgba(128,128,128,0.15)';
    case 'low':        return 'rgba(96,165,250,0.4)';
    case 'moderate':   return 'rgba(74,222,128,0.5)';
    case 'optimal':    return 'rgba(74,222,128,0.8)';
    case 'high':       return 'rgba(251,191,36,0.7)';
    case 'excessive':  return 'rgba(248,113,113,0.7)';
    default:           return 'rgba(128,128,128,0.15)';
  }
}

// ─── Volume → Map Data ───

/**
 * Determine the MuscleIntensity from a volume zone.
 * Maps the 4 volume zones to 6 intensity levels by distinguishing
 * how far into the "optimal" zone the lifter is.
 */
export function zoneToIntensity(zone: string, sets: number, mev: number, mav: number): MuscleIntensity {
  if (sets === 0) return 'none';
  switch (zone) {
    case 'under':
      // Under MEV but non-zero → "low"
      return 'low';
    case 'optimal': {
      // MEV to MAV: split into "moderate" (lower half) and "optimal" (upper half)
      const mid = (mev + mav) / 2;
      return sets < mid ? 'moderate' : 'optimal';
    }
    case 'high':
      return 'high';
    case 'excessive':
      return 'excessive';
    default:
      return 'none';
  }
}

/**
 * Convert MuscleVolume data from the volume tracker to MuscleMapData for rendering.
 */
export function volumeToMapData(volumes: MuscleVolume[]): MuscleMapData[] {
  return volumes.map(v => {
    const intensity = zoneToIntensity(v.zone, v.weeklySets, v.mev, v.mav);
    const zoneLabel = v.zone === 'under' ? 'under MEV' :
                      v.zone === 'optimal' ? 'optimal zone' :
                      v.zone === 'high' ? 'approaching MRV' :
                      v.zone === 'excessive' ? 'over MRV' : 'untrained';
    return {
      muscleGroup: v.muscleGroup,
      label: v.label,
      intensity,
      sets: v.weeklySets,
      zone: v.zone,
      tooltip: `${v.label}: ${v.weeklySets} sets (${zoneLabel})`,
    };
  });
}

// ─── Rendering ───

/**
 * Build the SVG string for a single view (front or back).
 */
function buildSvg(
  regions: MuscleRegion[],
  dataMap: Map<string, MuscleMapData>,
  outline: string,
): string {
  let paths = '';

  for (const region of regions) {
    const data = dataMap.get(region.muscle);
    const color = data ? getMuscleColor(data.intensity) : getMuscleColor('none');
    const tooltip = data ? data.tooltip : `${region.label}: 0 sets`;
    const escapedTooltip = tooltip.replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    paths += `
      <path
        class="mm-muscle"
        d="${region.path}"
        fill="${color}"
        stroke="rgba(255,255,255,0.3)"
        stroke-width="0.5"
        data-muscle="${region.muscle}"
        data-tooltip="${escapedTooltip}"
        role="img"
        aria-label="${escapedTooltip}"
      />
    `;
  }

  return `
    <svg class="mm-svg" viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Muscle map">
      <path class="mm-body-outline" d="${outline.trim()}" fill="rgba(128,128,128,0.08)" stroke="rgba(128,128,128,0.3)" stroke-width="1" />
      ${paths}
    </svg>
  `;
}

/**
 * Render the complete muscle map HTML with SVG, toggle buttons, tooltip, and legend.
 *
 * @param data - Volume data for each muscle group
 * @param view - 'front' or 'back' (default: 'front')
 * @param mode - 'session' (today's workout) or 'week' (weekly aggregate)
 * @returns Complete HTML string
 */
export function renderMuscleMap(
  data: MuscleMapData[],
  view: MuscleMapView = 'front',
  mode: 'session' | 'week' = 'week',
): string {
  const dataMap = new Map<string, MuscleMapData>();
  for (const d of data) {
    dataMap.set(d.muscleGroup, d);
  }

  const frontSvg = buildSvg(FRONT_REGIONS, dataMap, BODY_OUTLINE_FRONT);
  const backSvg = buildSvg(BACK_REGIONS, dataMap, BODY_OUTLINE_BACK);

  const modeLabel = mode === 'session' ? 'This Session' : 'This Week';

  return `
    <div class="mm-container" data-view="${view}">
      <div class="mm-mode-label">${modeLabel}</div>
      <div class="mm-toggle" role="tablist" aria-label="Muscle map view">
        <button class="mm-toggle-btn${view === 'front' ? ' mm-toggle-active' : ''}"
                data-view="front" role="tab" aria-selected="${view === 'front'}"
                aria-controls="mm-view-front">Front</button>
        <button class="mm-toggle-btn${view === 'back' ? ' mm-toggle-active' : ''}"
                data-view="back" role="tab" aria-selected="${view === 'back'}"
                aria-controls="mm-view-back">Back</button>
      </div>
      <div class="mm-views">
        <div id="mm-view-front" class="mm-view${view === 'front' ? ' mm-view-active' : ''}" role="tabpanel">
          ${frontSvg}
        </div>
        <div id="mm-view-back" class="mm-view${view === 'back' ? ' mm-view-active' : ''}" role="tabpanel">
          ${backSvg}
        </div>
      </div>
      <div class="mm-tooltip" aria-live="polite"></div>
      <div class="mm-legend">
        <span class="mm-legend-item"><span class="mm-legend-dot" style="background:${getMuscleColor('none')}"></span>Untrained</span>
        <span class="mm-legend-item"><span class="mm-legend-dot" style="background:${getMuscleColor('low')}"></span>Under MEV</span>
        <span class="mm-legend-item"><span class="mm-legend-dot" style="background:${getMuscleColor('optimal')}"></span>Optimal</span>
        <span class="mm-legend-item"><span class="mm-legend-dot" style="background:${getMuscleColor('high')}"></span>High</span>
        <span class="mm-legend-item"><span class="mm-legend-dot" style="background:${getMuscleColor('excessive')}"></span>Over MRV</span>
      </div>
    </div>
  `;
}

// ─── Session Summary ───

/**
 * Given a set of exercise slots from a completed workout,
 * determine which muscle groups were worked and return a compact summary.
 */
export function renderSessionMusclesSummary(
  sets: Array<{ exerciseSlot: string; completed: boolean }>,
): string {
  // Collect muscles worked from completed sets
  const muscleSetCounts = new Map<string, number>();
  const muscleLabels = new Map<string, string>();

  for (const set of sets) {
    if (!set.completed) continue;
    const slot = EXERCISE_SLOTS[set.exerciseSlot];
    if (!slot) continue;
    for (const muscle of slot.muscleGroups) {
      muscleSetCounts.set(muscle, (muscleSetCounts.get(muscle) ?? 0) + 1);
      if (!muscleLabels.has(muscle)) {
        muscleLabels.set(muscle, formatMuscleLabel(muscle));
      }
    }
  }

  if (muscleSetCounts.size === 0) {
    return '<div class="mm-session-empty">No muscles tracked this session.</div>';
  }

  // Build simple map data for session view
  const sessionData: MuscleMapData[] = [];
  for (const [muscle, count] of muscleSetCounts.entries()) {
    const label = muscleLabels.get(muscle) ?? muscle;
    // For session view, use simple intensity based on set count
    let intensity: MuscleIntensity;
    if (count <= 2) intensity = 'low';
    else if (count <= 4) intensity = 'moderate';
    else if (count <= 6) intensity = 'optimal';
    else if (count <= 8) intensity = 'high';
    else intensity = 'excessive';

    sessionData.push({
      muscleGroup: muscle,
      label,
      intensity,
      sets: count,
      zone: 'session',
      tooltip: `${label}: ${count} sets`,
    });
  }

  // Build the muscle tag list
  let tags = '';
  const sorted = [...sessionData].sort((a, b) => b.sets - a.sets);
  for (const d of sorted) {
    const color = getMuscleColor(d.intensity);
    tags += `<span class="mm-session-tag" style="background:${color}">${d.label} (${d.sets})</span>`;
  }

  // Also render a compact muscle map
  const mapHtml = renderMuscleMap(sessionData, 'front', 'session');

  return `
    <div class="mm-session-summary">
      <h4 class="section-heading-sm mm-session-heading">Muscles Worked</h4>
      <div class="mm-session-tags">${tags}</div>
      ${mapHtml}
    </div>
  `;
}

/**
 * Convert a muscle group key to a human-readable label.
 */
function formatMuscleLabel(key: string): string {
  const labels: Record<string, string> = {
    quads: 'Quads',
    hamstrings: 'Hamstrings',
    glutes: 'Glutes',
    chest: 'Chest',
    back: 'Back',
    shoulders: 'Shoulders',
    front_delts: 'Front Delts',
    rear_delts: 'Rear Delts',
    upper_back: 'Upper Back',
    triceps: 'Triceps',
    biceps: 'Biceps',
    core: 'Core',
    lower_back: 'Lower Back',
    calves: 'Calves',
  };
  return labels[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Styles ───

/**
 * Inject muscle map CSS styles into the document head.
 * Uses an idempotent style element with id 'muscle-map-styles'.
 */
export function injectMuscleMapStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('muscle-map-styles')) return;

  const style = document.createElement('style');
  style.id = 'muscle-map-styles';
  style.textContent = `
    .mm-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-sm, 8px);
      padding: var(--space-sm, 8px);
      position: relative;
    }

    .mm-mode-label {
      font-size: var(--font-xs, 11px);
      color: var(--text-muted, #888);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }

    .mm-toggle {
      display: flex;
      gap: 0;
      border-radius: var(--radius-sm, 6px);
      overflow: hidden;
      border: 1px solid var(--border, #333);
    }

    .mm-toggle-btn {
      padding: var(--space-xs, 4px) var(--space-md, 16px);
      border: none;
      background: var(--bg-card, #1a1a1a);
      color: var(--text-secondary, #aaa);
      font-size: var(--font-sm, 13px);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      font-weight: 500;
    }

    .mm-toggle-btn:hover {
      background: var(--bg-hover, #252525);
    }

    .mm-toggle-active {
      background: var(--accent, #3b82f6);
      color: #fff;
    }

    .mm-views {
      width: 100%;
      max-width: 220px;
      position: relative;
    }

    .mm-view {
      display: none;
    }

    .mm-view-active {
      display: block;
    }

    .mm-svg {
      width: 100%;
      height: auto;
    }

    .mm-body-outline {
      pointer-events: none;
    }

    .mm-muscle {
      cursor: pointer;
      transition: opacity 0.15s, filter 0.15s;
    }

    .mm-muscle:hover {
      opacity: 0.85;
      filter: brightness(1.2);
    }

    .mm-tooltip {
      position: absolute;
      bottom: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-card, #1a1a1a);
      color: var(--text-primary, #fff);
      border: 1px solid var(--border, #333);
      border-radius: var(--radius-sm, 6px);
      padding: var(--space-xs, 4px) var(--space-sm, 8px);
      font-size: var(--font-sm, 13px);
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s;
      z-index: 10;
    }

    .mm-tooltip-visible {
      opacity: 1;
    }

    .mm-legend {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-sm, 8px);
      justify-content: center;
      font-size: var(--font-xs, 11px);
      color: var(--text-secondary, #aaa);
    }

    .mm-legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .mm-legend-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 2px;
      border: 1px solid rgba(255,255,255,0.1);
    }

    /* Session summary */
    .mm-session-summary {
      margin-top: var(--space-sm, 8px);
    }

    .mm-session-heading {
      margin-bottom: var(--space-sm, 8px);
    }

    .mm-session-tags {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs, 4px);
      margin-bottom: var(--space-sm, 8px);
    }

    .mm-session-tag {
      display: inline-block;
      padding: 2px 8px;
      border-radius: var(--radius-sm, 6px);
      font-size: var(--font-xs, 11px);
      color: #fff;
      font-weight: 500;
    }

    .mm-session-empty {
      font-size: var(--font-sm, 13px);
      color: var(--text-muted, #888);
      text-align: center;
      padding: var(--space-md, 16px);
    }
  `;
  document.head.appendChild(style);
}

/**
 * Wire up interactive event listeners on a rendered muscle map container.
 * Call this after inserting the rendered HTML into the DOM.
 *
 * @param container - The DOM element containing the muscle map
 */
export function attachMuscleMapListeners(container: HTMLElement): void {
  // Toggle buttons
  const toggleBtns = container.querySelectorAll<HTMLButtonElement>('.mm-toggle-btn');
  const views = container.querySelectorAll<HTMLElement>('.mm-view');
  const tooltip = container.querySelector<HTMLElement>('.mm-tooltip');

  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.dataset.view;
      if (!targetView) return;

      // Update button states
      toggleBtns.forEach(b => {
        b.classList.toggle('mm-toggle-active', b.dataset.view === targetView);
        b.setAttribute('aria-selected', String(b.dataset.view === targetView));
      });

      // Show/hide views
      views.forEach(v => {
        v.classList.toggle('mm-view-active', v.id === `mm-view-${targetView}`);
      });

      // Update container data attribute
      const mmContainer = btn.closest('.mm-container');
      if (mmContainer) {
        (mmContainer as HTMLElement).dataset.view = targetView;
      }
    });
  });

  // Muscle hover/tap tooltips
  const muscles = container.querySelectorAll<SVGPathElement>('.mm-muscle');
  muscles.forEach(muscle => {
    const showTooltip = () => {
      if (!tooltip) return;
      const text = muscle.dataset.tooltip ?? '';
      tooltip.textContent = text;
      tooltip.classList.add('mm-tooltip-visible');
    };

    const hideTooltip = () => {
      if (!tooltip) return;
      tooltip.classList.remove('mm-tooltip-visible');
    };

    muscle.addEventListener('mouseenter', showTooltip);
    muscle.addEventListener('mouseleave', hideTooltip);
    muscle.addEventListener('touchstart', (e) => {
      e.preventDefault();
      showTooltip();
      // Auto-hide after 2 seconds on mobile
      setTimeout(hideTooltip, 2000);
    }, { passive: false });
  });
}
