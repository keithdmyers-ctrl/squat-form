/**
 * Session history display: trend chart and history list.
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

// ─── Chart Mode State ───

type ChartMode = 'score' | 'weight' | 'rpe' | 'bodyweight';
let currentChartMode: ChartMode = 'score';

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
  const modes: { key: ChartMode; label: string }[] = [
    { key: 'score', label: 'Score' },
    { key: 'weight', label: 'Weight' },
    { key: 'rpe', label: 'RPE' },
    { key: 'bodyweight', label: 'Bodyweight' },
  ];

  let toggleHtml = '<div class="chart-mode-toggle" role="group" aria-label="Chart metric">';
  for (const mode of modes) {
    const active = mode.key === currentChartMode ? ' active' : '';
    toggleHtml += `<button type="button" class="chart-mode-btn${active}" data-chart-mode="${mode.key}" aria-pressed="${mode.key === currentChartMode}">${mode.label}</button>`;
  }
  toggleHtml += '</div>';

  const chartSvg = renderHistoryChart(sessions, currentChartMode);
  container.innerHTML = toggleHtml + '<div id="history-chart-svg">' + chartSvg + '</div>';

  // Wire up toggle buttons
  container.querySelectorAll<HTMLButtonElement>('.chart-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentChartMode = (btn.dataset.chartMode ?? 'score') as ChartMode;
      // Update active states
      container.querySelectorAll<HTMLButtonElement>('.chart-mode-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.chartMode === currentChartMode);
        b.setAttribute('aria-pressed', String(b.dataset.chartMode === currentChartMode));
      });
      // Re-render just the chart SVG
      const svgContainer = document.getElementById('history-chart-svg');
      if (svgContainer) {
        svgContainer.innerHTML = renderHistoryChart(sessions, currentChartMode);
      }
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
    }
  };

  const getLabel = (): string => {
    switch (mode) {
      case 'weight': return 'Weight';
      case 'rpe': return 'RPE';
      case 'bodyweight': return 'Bodyweight';
    }
  };

  const getUnit = (s: SessionRecord): string => {
    switch (mode) {
      case 'weight': return s.weight_unit ?? '';
      case 'rpe': return '';
      case 'bodyweight': return s.bodyweight_unit ?? '';
    }
  };

  const filtered = sessions.slice(0, 10).filter(s => getData(s) != null);

  if (filtered.length < 2) {
    return `<p style="color: var(--text-muted); font-size: 0.875rem; text-align: center; padding: 1rem;">Need 2+ sessions with ${getLabel().toLowerCase()} data to show this chart.</p>`;
  }

  const recent = filtered.reverse(); // oldest first for left-to-right

  if (mode === 'rpe') {
    return renderRpeChart(recent);
  }

  return renderAutoScaleChart(recent, mode, getData, getUnit, getLabel());
}

function renderScoreChart(sessions: SessionRecord[]): string {
  const recent = sessions.slice(0, 10).reverse(); // oldest first for left-to-right
  if (recent.length < 2) {
    return '<p style="color: var(--text-muted); font-size: 0.875rem; text-align: center; padding: 1rem;">Complete 2+ sessions to see your trend chart.</p>';
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
    dotsHtml += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="${color}" stroke="var(--bg-primary, #0f0f0f)" stroke-width="1.5"><title>Score: ${p.score} (${p.grade})</title></circle>`;
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
    gridHtml += `<line x1="${padL}" y1="${y}" x2="${svgWidth - padR}" y2="${y}" stroke="#333" stroke-width="0.5" />`;
    gridHtml += `<text x="${padL - 5}" y="${y + 4}" text-anchor="end" fill="#888" font-size="9">${val}</text>`;
  }

  let dotsHtml = '';
  for (const p of points) {
    const color = p.value >= 9 ? 'var(--danger)' : p.value >= 8 ? 'var(--warning)' : 'var(--success)';
    dotsHtml += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="${color}" stroke="#0f0f0f" stroke-width="1.5"><title>RPE: ${p.value}</title></circle>`;
  }

  const firstDate = formatShortDate(recent[0].date);
  const lastDate = formatShortDate(recent[recent.length - 1].date);

  return `
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="RPE trend over last ${recent.length} sessions" style="width: 100%; height: auto;">
      ${gridHtml}
      <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      ${dotsHtml}
      <text x="${padL}" y="${svgHeight - 5}" fill="#888" font-size="9">${firstDate}</text>
      <text x="${svgWidth - padR}" y="${svgHeight - 5}" text-anchor="end" fill="#888" font-size="9">${lastDate}</text>
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
    gridHtml += `<line x1="${padL}" y1="${y}" x2="${svgWidth - padR}" y2="${y}" stroke="#333" stroke-width="0.5" />`;
    gridHtml += `<text x="${padL - 5}" y="${y + 4}" text-anchor="end" fill="#888" font-size="9">${Math.round(val)}</text>`;
  }

  let dotsHtml = '';
  for (const p of points) {
    const color = 'var(--accent)';
    const unitStr = p.unit ? ` ${p.unit}` : '';
    dotsHtml += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="${color}" stroke="#0f0f0f" stroke-width="1.5"><title>${label}: ${p.value}${unitStr}</title></circle>`;
  }

  const firstDate = formatShortDate(recent[0].date);
  const lastDate = formatShortDate(recent[recent.length - 1].date);

  return `
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label} trend over last ${recent.length} sessions" style="width: 100%; height: auto;">
      ${gridHtml}
      <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      ${dotsHtml}
      <text x="${padL}" y="${svgHeight - 5}" fill="#888" font-size="9">${firstDate}</text>
      <text x="${svgWidth - padR}" y="${svgHeight - 5}" text-anchor="end" fill="#888" font-size="9">${lastDate}</text>
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

function renderHistoryList(container: HTMLElement, sessions: SessionRecord[]): void {
  const displaySessions = sessions.slice(0, 10);
  let html = '';

  if (displaySessions.length >= 2) {
    html += '<div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.5rem;">Select two sessions to compare</div>';
  }

  html += '<div class="history-list-items">';

  for (let idx = 0; idx < displaySessions.length; idx++) {
    const s = displaySessions[idx];
    const color = gradeColor(s.grade);
    const dateStr = formatShortDate(s.date);
    const topIssue = s.top_issue ? (ISSUE_DISPLAY_NAMES[s.top_issue] ?? formatIssueName(s.top_issue)) : 'None';
    const exerciseLabel = s.exercise_type === 'deadlift' ? 'DL'
      : s.exercise_type === 'bench_press' ? 'BP'
      : 'SQ';

    // Build extra metric info based on current chart mode
    let metricHtml = '';
    if (currentChartMode === 'weight' && s.weight != null) {
      metricHtml = `<span style="font-size: 0.7rem; color: var(--accent);">${s.weight}${s.weight_unit ?? ''}</span>`;
    } else if (currentChartMode === 'rpe' && s.rpe != null) {
      metricHtml = `<span style="font-size: 0.7rem; color: var(--accent);">RPE ${s.rpe}</span>`;
    } else if (currentChartMode === 'bodyweight' && s.bodyweight != null) {
      metricHtml = `<span style="font-size: 0.7rem; color: var(--accent);">${s.bodyweight}${s.bodyweight_unit ?? ''}</span>`;
    }

    html += `
      <div class="history-item" data-compare-idx="${idx}" style="cursor: pointer;" role="button" tabindex="0" aria-label="Session ${dateStr}: ${exerciseLabel}, ${s.grade}, ${s.overall_score} points">
        <span class="history-date">${escapeHtml(dateStr)}</span>
        <span style="font-size: 0.7rem; color: var(--accent-dim); font-weight: 600;">${exerciseLabel}</span>
        <span class="history-grade" style="color: ${color}; font-weight: 700;">${escapeHtml(s.grade)}</span>
        <span class="history-score">${s.overall_score}</span>
        <span class="history-reps">${s.rep_count} reps${metricHtml ? ' ' : ''}${metricHtml}</span>
        <span class="history-issue">${escapeHtml(topIssue)}</span>
      </div>
    `;
  }

  html += '</div>';
  html += '<div style="display: flex; gap: 0.5rem; margin-top: 1rem; flex-wrap: wrap;">';
  html += `<button id="compare-btn" class="btn btn-sm" style="font-size: 0.8rem; background: var(--accent); color: var(--bg-primary);${displaySessions.length < 2 ? ' opacity: 0.4; cursor: not-allowed;' : ''}" aria-label="Compare selected sessions" disabled>Compare (0/2)</button>`;
  html += '<button id="export-csv-btn" class="btn btn-sm" style="font-size: 0.8rem; background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary);" aria-label="Export session history as CSV">Export CSV</button>';
  html += '<button id="clear-history-btn" class="btn btn-sm" style="font-size: 0.8rem; background: var(--bg-input, #222); border: 1px solid var(--border-hover, #444); color: var(--text-muted);" aria-label="Clear session history">Clear History</button>';
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
      compareBtn.style.opacity = '1';
      compareBtn.style.cursor = 'pointer';
      compareBtn.textContent = 'Compare';
    } else {
      compareBtn.disabled = true;
      compareBtn.style.opacity = '0.4';
      compareBtn.style.cursor = 'not-allowed';
      compareBtn.textContent = `Compare (${selectedIndices.size}/2)`;
    }
  }

  historyItems.forEach((item) => {
    const handler = () => {
      const idx = parseInt(item.dataset.compareIdx ?? '0');
      if (selectedIndices.has(idx)) {
        selectedIndices.delete(idx);
        item.classList.remove('selected');
      } else if (selectedIndices.size < 2) {
        selectedIndices.add(idx);
        item.classList.add('selected');
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
