/**
 * Session history display: trend chart, history list, and goal setting.
 */

import type { SessionRecord } from './types';
import {
  escapeHtml,
  gradeColor,
  formatIssueName,
  formatShortDate,
  ISSUE_DISPLAY_NAMES,
} from './ui-utilities';
import { exportSessionsCSV, downloadCSV } from './csv-export';
import { renderComparisonView } from './ui-comparison';
import {
  loadGoals,
  createGoal,
  removeGoal,
  getActiveGoals,
  getCurrentAvgForGoal,
  DIMENSION_LABELS,
  MAX_ACTIVE_GOALS,
  CONSECUTIVE_HITS_REQUIRED,
} from './goals';
import { getDimensionLabels } from './exercise-core';

// ─── Chart Mode State ───

type ChartMode = 'score' | 'weight' | 'rpe' | 'bodyweight' | 'depth' | 'knee' | 'trunk' | 'dots';
let currentChartMode: ChartMode = 'score';
let currentExerciseFilter: string = 'all';

/** Filter sessions by exercise type if a filter is active. */
function filterByExercise(sessions: SessionRecord[]): SessionRecord[] {
  if (currentExerciseFilter === 'all') return sessions;
  return sessions.filter(s => (s.exercise_type ?? 'squat') === currentExerciseFilter);
}

// ─── B4: Plain-Language Progress Narrative ───

function renderProgressSummary(sessions: SessionRecord[]): string {
  if (sessions.length <= 1) {
    return '<div class="progress-narrative"><ul><li>Welcome! After your next session, you\'ll see your progress here.</li></ul></div>';
  }

  const bullets: string[] = [];
  const latest = sessions[0];
  const first = sessions[sessions.length - 1];
  const scoreDiff = latest.overall_score - first.overall_score;

  if (scoreDiff > 0) {
    bullets.push(
      `Your overall score improved by ${scoreDiff} point${scoreDiff !== 1 ? 's' : ''} over ${sessions.length} session${sessions.length !== 1 ? 's' : ''}.`,
    );
  } else if (scoreDiff < 0) {
    // Declining scores
    const topIssue = latest.top_issue
      ? (ISSUE_DISPLAY_NAMES[latest.top_issue] ?? formatIssueName(latest.top_issue))
      : null;
    const focusMsg = topIssue ? ` Focus on ${topIssue}.` : '';
    bullets.push(
      `Your scores dipped this session -- this can happen when you're trying heavier weights.${focusMsg}`,
    );
  } else {
    bullets.push(`Your score is holding steady at ${latest.overall_score}. Consistency is key!`);
  }

  // Find biggest dimension improvement if we have per-dimension data
  if (sessions.length >= 2) {
    const dimChecks: { name: string; key: keyof SessionRecord }[] = [
      { name: 'Depth', key: 'avg_depth' },
      { name: 'Knee Tracking', key: 'avg_knee_tracking' },
      { name: 'Trunk Position', key: 'avg_trunk' },
    ];

    let bestDim = '';
    let bestImprovement = 0;

    for (const dim of dimChecks) {
      const latestVal = latest[dim.key] as number | undefined;
      const firstVal = first[dim.key] as number | undefined;
      if (latestVal != null && firstVal != null) {
        const improvement = latestVal - firstVal;
        if (improvement > bestImprovement) {
          bestImprovement = improvement;
          bestDim = dim.name;
        }
      }
    }

    if (bestDim && bestImprovement >= 3) {
      bullets.push(
        `${bestDim} improved ${Math.round(bestImprovement)} points over ${sessions.length} sessions.`,
      );
    }

    // Consistency check: look at standard deviation of scores
    const scores = sessions.slice(0, 5).map(s => s.overall_score);
    if (scores.length >= 3) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((s, v) => s + (v - avg) ** 2, 0) / scores.length;
      const stdDev = Math.sqrt(variance);
      if (stdDev <= 5) {
        // Find most consistent dimension
        for (const dim of dimChecks) {
          const vals = sessions.slice(0, 5).map(s => s[dim.key] as number | undefined).filter((v): v is number => v != null);
          if (vals.length >= 3) {
            const dAvg = vals.reduce((a, b) => a + b, 0) / vals.length;
            const dVar = vals.reduce((s, v) => s + (v - dAvg) ** 2, 0) / vals.length;
            if (Math.sqrt(dVar) <= 4) {
              bullets.push(`${dim.name} is your most consistent dimension.`);
              break;
            }
          }
        }
      }
    }
  }

  if (bullets.length === 0) return '';

  return `<div class="progress-narrative"><ul>${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul></div>`;
}

// ─── Session History View ───

export function renderHistorySection(sessions: SessionRecord[]): void {
  const section = document.getElementById('history-section');
  if (!section) return;

  // Update header history badge
  const headerLink = document.getElementById('header-history-link');
  const headerCount = document.getElementById('header-history-count');
  if (headerLink && headerCount) {
    if (sessions.length > 0) {
      headerLink.style.display = 'inline-flex';
      headerCount.textContent = String(sessions.length);
    } else {
      headerLink.style.display = 'none';
    }
  }

  if (sessions.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';

  // B4: Render progress narrative above the chart
  const existingNarrative = section.querySelector('.progress-narrative');
  if (existingNarrative) existingNarrative.remove();
  const narrativeHtml = renderProgressSummary(sessions);
  if (narrativeHtml) {
    const chartContainer = document.getElementById('history-chart');
    if (chartContainer) {
      chartContainer.insertAdjacentHTML('beforebegin', narrativeHtml);
    }
  }

  // Render chart with mode toggle
  const chartContainer = document.getElementById('history-chart');
  if (chartContainer) {
    renderChartWithToggle(chartContainer, sessions);
  }

  // Render list
  const listContainer = document.getElementById('history-list');
  if (listContainer) {
    renderHistoryList(listContainer, sessions);
  }
}

function renderChartWithToggle(container: HTMLElement, sessions: SessionRecord[]): void {
  // Build mode toggle buttons
  // Check if per-dimension data exists
  const hasDepthData = sessions.filter(s => s.avg_depth != null).length >= 2;
  const hasKneeData = sessions.filter(s => s.avg_knee_tracking != null).length >= 2;
  const hasTrunkData = sessions.filter(s => s.avg_trunk != null).length >= 2;
  const hasDotsData = sessions.filter(s => s.dots_score != null).length >= 2;

  const modes: { key: ChartMode; label: string }[] = [
    { key: 'score', label: 'Score' },
    { key: 'weight', label: 'Weight' },
    { key: 'rpe', label: 'RPE' },
    { key: 'bodyweight', label: 'Bodyweight' },
    ...(hasDotsData ? [{ key: 'dots' as ChartMode, label: 'DOTS' }] : []),
    ...(hasDepthData ? [{ key: 'depth' as ChartMode, label: 'Depth' }] : []),
    ...(hasKneeData ? [{ key: 'knee' as ChartMode, label: 'Knee' }] : []),
    ...(hasTrunkData ? [{ key: 'trunk' as ChartMode, label: 'Trunk' }] : []),
  ];

  let toggleHtml = '<div class="chart-mode-toggle" role="group" aria-label="Chart metric">';
  for (const mode of modes) {
    const active = mode.key === currentChartMode ? ' active' : '';
    toggleHtml += `<button type="button" class="chart-mode-btn${active}" data-chart-mode="${mode.key}" aria-pressed="${mode.key === currentChartMode}">${mode.label}</button>`;
  }
  toggleHtml += '</div>';

  // Exercise filter (only show if multiple exercise types exist)
  const exerciseTypes = new Set(sessions.map(s => s.exercise_type ?? 'squat'));
  let filterHtml = '';
  if (exerciseTypes.size > 1) {
    const filters: { key: string; label: string }[] = [
      { key: 'all', label: 'All' },
      ...Array.from(exerciseTypes).map(t => ({
        key: t,
        label: t === 'deadlift' ? 'DL' : t === 'bench_press' ? 'BP' : t === 'overhead_press' ? 'OHP' : t === 'barbell_row' ? 'ROW' : t === 'lunge' ? 'LU' : 'SQ',
      })),
    ];
    filterHtml = '<div class="chart-mode-toggle chart-exercise-filter" role="group" aria-label="Exercise filter">';
    for (const f of filters) {
      const active = f.key === currentExerciseFilter ? ' active' : '';
      filterHtml += `<button type="button" class="chart-mode-btn exercise-filter-btn${active}" data-exercise-filter="${f.key}" aria-pressed="${f.key === currentExerciseFilter}">${f.label}</button>`;
    }
    filterHtml += '</div>';
  }

  const filtered = filterByExercise(sessions);
  const chartSvg = renderHistoryChart(filtered, currentChartMode);
  container.innerHTML = filterHtml + toggleHtml + '<div id="history-chart-svg">' + chartSvg + '</div>';

  function rerenderChart(): void {
    const svgContainer = document.getElementById('history-chart-svg');
    if (svgContainer) {
      svgContainer.innerHTML = renderHistoryChart(filterByExercise(sessions), currentChartMode);
    }
  }

  // Wire up toggle buttons
  container.querySelectorAll<HTMLButtonElement>('.chart-mode-btn:not(.exercise-filter-btn)').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentChartMode = (btn.dataset.chartMode ?? 'score') as ChartMode;
      // Update active states
      container.querySelectorAll<HTMLButtonElement>('.chart-mode-btn:not(.exercise-filter-btn)').forEach((b) => {
        b.classList.toggle('active', b.dataset.chartMode === currentChartMode);
        b.setAttribute('aria-pressed', String(b.dataset.chartMode === currentChartMode));
      });
      rerenderChart();
    });
  });

  // Wire up exercise filter buttons
  container.querySelectorAll<HTMLButtonElement>('.exercise-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentExerciseFilter = btn.dataset.exerciseFilter ?? 'all';
      container.querySelectorAll<HTMLButtonElement>('.exercise-filter-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.exerciseFilter === currentExerciseFilter);
        b.setAttribute('aria-pressed', String(b.dataset.exerciseFilter === currentExerciseFilter));
      });
      rerenderChart();
    });
  });
}

function renderHistoryChart(sessions: SessionRecord[], mode: ChartMode): string {
  if (mode === 'score') {
    return renderScoreChart(sessions);
  }

  // For other modes, filter sessions to those with data
  const getData = (s: SessionRecord): number | undefined => {
    switch (mode) {
      case 'weight': return s.weight;
      case 'rpe': return s.rpe;
      case 'bodyweight': return s.bodyweight;
      case 'dots': return s.dots_score;
      case 'depth': return s.avg_depth;
      case 'knee': return s.avg_knee_tracking;
      case 'trunk': return s.avg_trunk;
    }
  };

  const getLabel = (): string => {
    switch (mode) {
      case 'weight': return 'Weight';
      case 'rpe': return 'RPE';
      case 'bodyweight': return 'Bodyweight';
      case 'dots': return 'DOTS Score';
      case 'depth': return 'Depth Score';
      case 'knee': return 'Knee Tracking';
      case 'trunk': return 'Trunk Score';
    }
  };

  const getUnit = (s: SessionRecord): string => {
    switch (mode) {
      case 'weight': return s.weight_unit ?? '';
      case 'rpe': return '';
      case 'bodyweight': return s.bodyweight_unit ?? '';
      case 'dots': return '';
      case 'depth': return '';
      case 'knee': return '';
      case 'trunk': return '';
    }
  };

  const filtered = sessions.slice(0, 20).filter(s => getData(s) != null);

  if (filtered.length < 2) {
    return `<p class="chart-empty-message">Need 2+ sessions with ${getLabel().toLowerCase()} data to show this chart.</p>`;
  }

  const recent = filtered.reverse(); // oldest first for left-to-right

  if (mode === 'rpe') {
    return renderRpeChart(recent);
  }

  return renderAutoScaleChart(recent, mode, getData, getUnit, getLabel());
}

function renderScoreChart(sessions: SessionRecord[]): string {
  const recent = sessions.slice(0, 20).reverse(); // oldest first for left-to-right
  if (recent.length < 2) {
    return '<p class="chart-empty-message">Complete 2+ sessions to see your trend chart.</p>';
  }

  const svgWidth = 400;
  const svgHeight = 160;
  const padL = 35;
  const padR = 15;
  const padT = 20;
  const padB = 35;
  const chartW = svgWidth - padL - padR;
  const chartH = svgHeight - padT - padB;

  const points = recent.map((s, i) => {
    const x = padL + (i / (recent.length - 1)) * chartW;
    const y = padT + ((100 - s.overall_score) / 100) * chartH;
    return { x, y, score: s.overall_score, date: s.date, grade: s.grade };
  });

  // Build SVG path
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Y-axis lines
  const yLines = [0, 25, 50, 75, 100];
  let gridHtml = '';
  for (const val of yLines) {
    const y = padT + ((100 - val) / 100) * chartH;
    gridHtml += `<line x1="${padL}" y1="${y}" x2="${svgWidth - padR}" y2="${y}" stroke="var(--border, #333)" stroke-width="0.5" />`;
    gridHtml += `<text x="${padL - 5}" y="${y + 4}" text-anchor="end" fill="var(--text-muted, #888)" font-size="9">${val}</text>`;
  }

  // Data points
  let dotsHtml = '';
  for (const p of points) {
    const color = p.score >= 80 ? 'var(--success)' : p.score >= 60 ? 'var(--warning)' : 'var(--danger)';
    dotsHtml += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="${color}" stroke="var(--bg-primary)" stroke-width="1.5"><title>Score: ${p.score} (${p.grade})</title></circle>`;
  }

  // X-axis labels (first and last date)
  const firstDate = formatShortDate(recent[0].date);
  const lastDate = formatShortDate(recent[recent.length - 1].date);

  return `
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Score trend over last ${recent.length} sessions" style="width: 100%; height: auto;">
      ${gridHtml}
      <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      ${dotsHtml}
      <text x="${padL}" y="${svgHeight - 5}" fill="var(--text-muted, #888)" font-size="9">${firstDate}</text>
      <text x="${svgWidth - padR}" y="${svgHeight - 5}" text-anchor="end" fill="var(--text-muted, #888)" font-size="9">${lastDate}</text>
    </svg>
  `;
}

function renderRpeChart(recent: SessionRecord[]): string {
  const svgWidth = 400;
  const svgHeight = 160;
  const padL = 35;
  const padR = 15;
  const padT = 20;
  const padB = 35;
  const chartW = svgWidth - padL - padR;
  const chartH = svgHeight - padT - padB;

  const minY = 6;
  const maxY = 10;
  const range = maxY - minY;

  const points = recent.map((s, i) => {
    const val = s.rpe ?? 6;
    const x = padL + (i / (recent.length - 1)) * chartW;
    const y = padT + ((maxY - val) / range) * chartH;
    return { x, y, value: val, date: s.date };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Y-axis gridlines at 6, 7, 8, 9, 10
  const yLines = [6, 7, 8, 9, 10];
  let gridHtml = '';
  for (const val of yLines) {
    const y = padT + ((maxY - val) / range) * chartH;
    gridHtml += `<line x1="${padL}" y1="${y}" x2="${svgWidth - padR}" y2="${y}" stroke="var(--border, #333)" stroke-width="0.5" />`;
    gridHtml += `<text x="${padL - 5}" y="${y + 4}" text-anchor="end" fill="var(--text-muted, #888)" font-size="9">${val}</text>`;
  }

  let dotsHtml = '';
  for (const p of points) {
    const color = p.value >= 9 ? 'var(--danger)' : p.value >= 8 ? 'var(--warning)' : 'var(--success)';
    dotsHtml += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="${color}" stroke="var(--bg-primary)" stroke-width="1.5"><title>RPE: ${p.value}</title></circle>`;
  }

  const firstDate = formatShortDate(recent[0].date);
  const lastDate = formatShortDate(recent[recent.length - 1].date);

  return `
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="RPE trend over last ${recent.length} sessions" style="width: 100%; height: auto;">
      ${gridHtml}
      <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      ${dotsHtml}
      <text x="${padL}" y="${svgHeight - 5}" fill="var(--text-muted, #888)" font-size="9">${firstDate}</text>
      <text x="${svgWidth - padR}" y="${svgHeight - 5}" text-anchor="end" fill="var(--text-muted, #888)" font-size="9">${lastDate}</text>
    </svg>
  `;
}

function renderAutoScaleChart(
  recent: SessionRecord[],
  mode: ChartMode,
  getData: (s: SessionRecord) => number | undefined,
  getUnit: (s: SessionRecord) => string,
  label: string,
): string {
  const svgWidth = 400;
  const svgHeight = 160;
  const padL = 45;
  const padR = 15;
  const padT = 20;
  const padB = 35;
  const chartW = svgWidth - padL - padR;
  const chartH = svgHeight - padT - padB;

  const values = recent.map(s => getData(s) ?? 0);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);

  // Add some padding to the range
  const rangePad = (dataMax - dataMin) * 0.1 || 5;
  const minY = Math.max(0, Math.floor(dataMin - rangePad));
  const maxY = Math.ceil(dataMax + rangePad);
  const range = maxY - minY || 1;

  const points = recent.map((s, i) => {
    const val = getData(s) ?? 0;
    const x = padL + (i / (recent.length - 1)) * chartW;
    const y = padT + ((maxY - val) / range) * chartH;
    const unit = getUnit(s);
    return { x, y, value: val, date: s.date, unit };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Y-axis: ~5 gridlines
  const step = niceStep(range, 5);
  let gridHtml = '';
  for (let val = Math.ceil(minY / step) * step; val <= maxY; val += step) {
    const y = padT + ((maxY - val) / range) * chartH;
    gridHtml += `<line x1="${padL}" y1="${y}" x2="${svgWidth - padR}" y2="${y}" stroke="var(--border, #333)" stroke-width="0.5" />`;
    gridHtml += `<text x="${padL - 5}" y="${y + 4}" text-anchor="end" fill="var(--text-muted, #888)" font-size="9">${Math.round(val)}</text>`;
  }

  let dotsHtml = '';
  for (const p of points) {
    const color = 'var(--accent)';
    const unitStr = p.unit ? ` ${p.unit}` : '';
    dotsHtml += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="${color}" stroke="var(--bg-primary)" stroke-width="1.5"><title>${label}: ${p.value}${unitStr}</title></circle>`;
  }

  const firstDate = formatShortDate(recent[0].date);
  const lastDate = formatShortDate(recent[recent.length - 1].date);

  return `
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label} trend over last ${recent.length} sessions" style="width: 100%; height: auto;">
      ${gridHtml}
      <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      ${dotsHtml}
      <text x="${padL}" y="${svgHeight - 5}" fill="var(--text-muted, #888)" font-size="9">${firstDate}</text>
      <text x="${svgWidth - padR}" y="${svgHeight - 5}" text-anchor="end" fill="var(--text-muted, #888)" font-size="9">${lastDate}</text>
    </svg>
  `;
}

/** Compute a "nice" step size for gridlines given a data range and desired count. */
function niceStep(range: number, targetLines: number): number {
  const rough = range / targetLines;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const residual = rough / magnitude;
  if (residual <= 1.5) return magnitude;
  if (residual <= 3) return 2 * magnitude;
  if (residual <= 7) return 5 * magnitude;
  return 10 * magnitude;
}

function renderHistoryList(container: HTMLElement, sessions: SessionRecord[], showCount: number = 20): void {
  const displaySessions = sessions.slice(0, showCount);
  let html = '';

  if (displaySessions.length >= 2) {
    html += '<div class="history-compare-hint">Select two sessions to compare</div>';
  }

  html += '<div class="history-list-items">';

  for (let idx = 0; idx < displaySessions.length; idx++) {
    const s = displaySessions[idx];
    const color = gradeColor(s.grade);
    const dateStr = formatShortDate(s.date);
    const topIssue = s.top_issue ? (ISSUE_DISPLAY_NAMES[s.top_issue] ?? formatIssueName(s.top_issue)) : 'None';
    const exerciseLabel = s.exercise_type === 'deadlift' ? 'DL'
      : s.exercise_type === 'bench_press' ? 'BP'
      : s.exercise_type === 'overhead_press' ? 'OHP'
      : s.exercise_type === 'barbell_row' ? 'ROW'
      : s.exercise_type === 'lunge' ? 'LU'
      : 'SQ';

    // Build extra metric info based on current chart mode
    let metricHtml = '';
    if (currentChartMode === 'weight' && s.weight != null) {
      metricHtml = `<span class="history-metric">${s.weight}${s.weight_unit ?? ''}</span>`;
    } else if (currentChartMode === 'rpe' && s.rpe != null) {
      metricHtml = `<span class="history-metric">RPE ${s.rpe}</span>`;
    } else if (currentChartMode === 'bodyweight' && s.bodyweight != null) {
      metricHtml = `<span class="history-metric">${s.bodyweight}${s.bodyweight_unit ?? ''}</span>`;
    } else if (currentChartMode === 'dots' && s.dots_score != null) {
      metricHtml = `<span class="history-metric">DOTS ${s.dots_score.toFixed(1)}</span>`;
    }

    // Notes and tags (E5)
    let notesHtml = '';
    if (s.notes || (s.tags && s.tags.length > 0)) {
      const parts: string[] = [];
      if (s.tags && s.tags.length > 0) {
        parts.push(s.tags.map(t => escapeHtml(t)).join(', '));
      }
      if (s.notes) {
        parts.push(escapeHtml(s.notes));
      }
      notesHtml = `<div style="font-size: var(--font-2xs, 0.65rem); color: var(--text-muted, #808080); grid-column: 1 / -1; margin-top: -0.15rem;">${parts.join(' -- ')}</div>`;
    }

    html += `
      <div class="history-item" data-compare-idx="${idx}" style="cursor: pointer;" role="checkbox" aria-checked="false" tabindex="0" aria-label="Session ${dateStr}: ${exerciseLabel}, ${s.grade}, ${s.overall_score} points">
        <span class="history-date">${escapeHtml(dateStr)}</span>
        <span class="history-exercise-label">${exerciseLabel}</span>
        <span class="history-grade" style="color: ${color}; font-weight: 700;">${escapeHtml(s.grade)}</span>
        <span class="history-score">${s.overall_score}</span>
        <span class="history-reps">${s.rep_count} reps${metricHtml ? ' ' : ''}${metricHtml}</span>
        <span class="history-issue">${escapeHtml(topIssue)}</span>
        <button class="history-delete-btn" data-delete-idx="${idx}" aria-label="Delete session from ${dateStr}" title="Delete this session">&times;</button>
        ${notesHtml}
      </div>
    `;
  }

  html += '</div>';
  html += '<div class="history-actions">';
  html += `<button id="compare-btn" class="btn btn-sm history-action-btn history-action-btn--primary${displaySessions.length < 2 ? ' history-action-btn--disabled' : ''}" aria-label="Compare selected sessions" disabled>Compare (0/2)</button>`;
  html += '<button id="set-goals-btn" class="btn btn-sm history-action-btn history-action-btn--outline" aria-label="Set performance goals">Set Goals</button>';
  html += '<button id="export-csv-btn" class="btn btn-sm history-action-btn history-action-btn--default" aria-label="Export session history as CSV">Export CSV</button>';
  html += '<button id="clear-history-btn" class="btn btn-sm history-action-btn history-action-btn--muted" aria-label="Clear session history">Clear History</button>';
  html += '</div>';

  container.innerHTML = html;

  // Wire up comparison selection
  const selectedIndices = new Set<number>();
  const compareBtn = document.getElementById('compare-btn') as HTMLButtonElement | null;
  const historyItems = container.querySelectorAll<HTMLElement>('[data-compare-idx]');

  function updateCompareState(): void {
    if (!compareBtn) return;
    if (selectedIndices.size === 2) {
      compareBtn.disabled = false;
      compareBtn.classList.remove('history-action-btn--disabled');
      compareBtn.classList.add('history-action-btn--enabled');
      compareBtn.textContent = 'Compare';
    } else {
      compareBtn.disabled = true;
      compareBtn.classList.remove('history-action-btn--enabled');
      compareBtn.classList.add('history-action-btn--disabled');
      compareBtn.textContent = `Compare (${selectedIndices.size}/2)`;
    }
  }

  historyItems.forEach((item) => {
    const handler = () => {
      const idx = parseInt(item.dataset.compareIdx ?? '0');
      if (selectedIndices.has(idx)) {
        selectedIndices.delete(idx);
        item.classList.remove('selected');
        item.setAttribute('aria-checked', 'false');
      } else if (selectedIndices.size < 2) {
        selectedIndices.add(idx);
        item.classList.add('selected');
        item.setAttribute('aria-checked', 'true');
      }
      updateCompareState();
    };
    item.addEventListener('click', handler);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
    });
  });

  if (compareBtn) {
    compareBtn.addEventListener('click', () => {
      const indices = Array.from(selectedIndices).sort((a, b) => a - b);
      if (indices.length === 2) {
        const older = displaySessions[Math.max(indices[0], indices[1])];
        const newer = displaySessions[Math.min(indices[0], indices[1])];
        renderComparisonView(older, newer);
      }
    });
  }

  // Wire up per-session delete buttons
  container.querySelectorAll<HTMLButtonElement>('.history-delete-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // prevent triggering compare selection
      const deleteIdx = parseInt(btn.dataset.deleteIdx ?? '0');
      const session = displaySessions[deleteIdx];
      if (!session) return;
      const dateStr = formatShortDate(session.date);
      showConfirmModal(
        'Delete Session',
        `Delete this session from ${dateStr}?`,
        'Delete',
        () => {
          try {
            const stored = JSON.parse(localStorage.getItem('squat_form_sessions') || '[]') as SessionRecord[];
            // Find and remove the matching session by date + score
            const removeIdx = stored.findIndex(
              s => s.date === session.date && s.overall_score === session.overall_score && s.rep_count === session.rep_count
            );
            if (removeIdx !== -1) {
              stored.splice(removeIdx, 1);
              localStorage.setItem('squat_form_sessions', JSON.stringify(stored));
            }
            renderHistorySection(stored);
          } catch {
            // Ignore storage errors
          }
        },
      );
    });
  });

  // Wire up export button
  const exportBtn = document.getElementById('export-csv-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const csv = exportSessionsCSV(sessions);
      const date = new Date().toISOString().slice(0, 10);
      downloadCSV(csv, `squat-form-history-${date}.csv`);
      exportBtn.textContent = 'Exported!';
      setTimeout(() => { exportBtn.textContent = 'Export CSV'; }, 2000);
    });
  }

  // Wire up clear button
  const clearBtn = document.getElementById('clear-history-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      showConfirmModal(
        'Clear Session History',
        'This will permanently delete all your saved sessions. This cannot be undone.',
        'Clear History',
        () => {
          localStorage.removeItem('squat_form_sessions');
          renderHistorySection([]);
        },
      );
    });
  }

  // Wire up Set Goals button
  const goalsBtn = document.getElementById('set-goals-btn');
  if (goalsBtn) {
    goalsBtn.addEventListener('click', () => {
      showGoalModal(sessions);
    });
  }
}

// ─── Custom Confirm Modal ───

/** Show a themed confirmation modal instead of native confirm(). */
function showConfirmModal(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void,
): void {
  // Remove any existing modal
  document.getElementById('confirm-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'confirm-modal-overlay';
  overlay.className = 'confirm-overlay';
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', title);

  const card = document.createElement('div');
  card.className = 'confirm-card';

  const h3 = document.createElement('h3');
  h3.textContent = title;

  const p = document.createElement('p');
  p.textContent = message;

  const actions = document.createElement('div');
  actions.className = 'confirm-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-cancel-action';
  cancelBtn.textContent = 'Cancel';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn btn-danger';
  confirmBtn.textContent = confirmLabel;

  function dismiss(): void {
    overlay.remove();
    document.removeEventListener('keydown', keyHandler);
  }

  function keyHandler(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    }
  }

  cancelBtn.addEventListener('click', dismiss);
  confirmBtn.addEventListener('click', () => {
    dismiss();
    onConfirm();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismiss();
  });
  document.addEventListener('keydown', keyHandler);

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  card.appendChild(h3);
  card.appendChild(p);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Focus the cancel button (safer default for destructive actions)
  setTimeout(() => cancelBtn.focus(), 50);
}

// ─── Goal Modal ───

/** Show the goal-setting modal with current goals and an add form. */
function showGoalModal(sessions: SessionRecord[]): void {
  // Remove any existing goal modal
  document.getElementById('goal-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'goal-modal-overlay';
  overlay.className = 'goal-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Set Performance Goals');

  const card = document.createElement('div');
  card.className = 'goal-modal-card';

  function renderModalContent(): void {
    const goals = loadGoals();
    const activeGoals = getActiveGoals(goals);
    const achievedGoals = goals.filter(g => g.status === 'achieved');

    let html = '<h3>Performance Goals</h3>';

    // Active goals
    if (activeGoals.length > 0) {
      html += '<div class="goal-modal-section">';
      for (const goal of activeGoals) {
        const labels = getDimensionLabels(goal.exerciseType);
        const dimKey = goal.dimension as keyof typeof labels;
        const label = (dimKey in labels ? labels[dimKey] : null) ?? DIMENSION_LABELS[goal.dimension] ?? goal.dimension;
        const currentAvg = getCurrentAvgForGoal(goal, sessions);
        const progress = currentAvg !== undefined
          ? Math.min(100, Math.round((currentAvg / goal.targetScore) * 100))
          : 0;
        const progressHit = currentAvg !== undefined && currentAvg >= goal.targetScore;

        const exerciseLabel = goal.exerciseType === 'deadlift' ? 'Deadlift'
          : goal.exerciseType === 'bench_press' ? 'Bench Press'
          : goal.exerciseType === 'overhead_press' ? 'OHP'
          : goal.exerciseType === 'barbell_row' ? 'Row'
          : goal.exerciseType === 'lunge' ? 'Lunge'
          : 'Squat';

        // Consecutive hits dots
        let dotsHtml = '<div class="goal-consecutive-dots">';
        for (let i = 0; i < CONSECUTIVE_HITS_REQUIRED; i++) {
          dotsHtml += `<div class="dot${i < goal.consecutiveHits ? ' filled' : ''}"></div>`;
        }
        dotsHtml += `<span class="dot-label">${goal.consecutiveHits}/${CONSECUTIVE_HITS_REQUIRED} consecutive</span>`;
        dotsHtml += '</div>';

        html += `
          <div class="goal-card">
            <div class="goal-card-header">
              <span>${escapeHtml(label)}</span>
              <span class="goal-status-badge active">Active</span>
            </div>
            <div class="goal-target">${escapeHtml(exerciseLabel)} &mdash; Target: ${goal.targetScore}${currentAvg !== undefined ? ` &bull; Current avg: ${currentAvg}` : ''}</div>
            <div class="goal-progress-bar">
              <div class="goal-progress-bar-fill${progressHit ? ' goal-hit' : ''}" style="width: ${progress}%;"></div>
            </div>
            ${dotsHtml}
            <button class="goal-remove-btn" data-goal-id="${escapeHtml(goal.id)}">Remove</button>
          </div>
        `;
      }
      html += '</div>';
    } else if (achievedGoals.length === 0) {
      html += '<p class="goal-modal-empty">No goals set yet. Add a goal below to track your progress.</p>';
    }

    // Recently achieved goals (show last 2)
    if (achievedGoals.length > 0) {
      html += '<div class="goal-modal-section">';
      html += '<div class="goal-modal-heading">Achieved</div>';
      for (const goal of achievedGoals.slice(0, 2)) {
        const label = DIMENSION_LABELS[goal.dimension] ?? goal.dimension;
        html += `
          <div class="goal-card goal-modal-achieved">
            <div class="goal-card-header">
              <span>${escapeHtml(label)}</span>
              <span class="goal-status-badge achieved">Achieved</span>
            </div>
            <div class="goal-target">Target: ${goal.targetScore}</div>
          </div>
        `;
      }
      html += '</div>';
    }

    // Add goal form (only if under max)
    if (activeGoals.length < MAX_ACTIVE_GOALS) {
      html += `
        <div class="goal-form" id="goal-add-form">
          <div class="goal-modal-form-title">Add Goal</div>
          <label for="goal-dimension">Dimension</label>
          <select id="goal-dimension">
            <option value="overall">Overall</option>
            <option value="depth">Depth</option>
            <option value="kneeTracking">Knee Tracking</option>
            <option value="trunk">Torso Position</option>
            <option value="symmetry">Symmetry</option>
            <option value="tempo">Tempo</option>
            <option value="lockout">Lockout</option>
          </select>
          <label for="goal-target-score">Target Score (60-100)</label>
          <input type="number" id="goal-target-score" min="60" max="100" value="80" step="1" />
          <label for="goal-exercise-type">Exercise</label>
          <select id="goal-exercise-type">
            <option value="squat">Squat</option>
            <option value="deadlift">Deadlift</option>
            <option value="bench_press">Bench Press</option>
            <option value="overhead_press">OHP</option>
            <option value="barbell_row">Row</option>
            <option value="lunge">Lunge</option>
          </select>
          <div class="goal-form-actions">
            <button id="goal-add-btn" class="btn btn-sm history-action-btn history-action-btn--primary">Add Goal</button>
          </div>
        </div>
      `;
    } else {
      html += '<p class="goal-modal-max-note">Maximum of 3 active goals reached. Remove a goal to add a new one.</p>';
    }

    // Close button
    html += '<div class="goal-modal-close-wrapper"><button id="goal-close-btn" class="btn btn-sm history-action-btn history-action-btn--default">Close</button></div>';

    card.innerHTML = html;

    // Wire up remove buttons
    card.querySelectorAll<HTMLButtonElement>('.goal-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const goalId = btn.dataset.goalId;
        if (goalId) {
          removeGoal(goalId);
          renderModalContent();
        }
      });
    });

    // Wire up add button
    const addBtn = card.querySelector<HTMLButtonElement>('#goal-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const dimSelect = card.querySelector<HTMLSelectElement>('#goal-dimension');
        const scoreInput = card.querySelector<HTMLInputElement>('#goal-target-score');
        const exSelect = card.querySelector<HTMLSelectElement>('#goal-exercise-type');
        if (!dimSelect || !scoreInput || !exSelect) return;

        const target = parseInt(scoreInput.value);
        if (!isFinite(target)) return;

        const result = createGoal(dimSelect.value, target, exSelect.value);
        if (result) {
          renderModalContent();
        }
      });
    }

    // Wire up close button
    const closeBtn = card.querySelector<HTMLButtonElement>('#goal-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', dismiss);
    }
  }

  function dismiss(): void {
    overlay.remove();
    document.removeEventListener('keydown', keyHandler);
  }

  function keyHandler(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    }
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismiss();
  });
  document.addEventListener('keydown', keyHandler);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  renderModalContent();
}
