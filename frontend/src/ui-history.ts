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

  // Render chart
  const chartContainer = document.getElementById('history-chart');
  if (chartContainer) {
    chartContainer.innerHTML = renderHistoryChart(sessions);
  }

  // Render list
  const listContainer = document.getElementById('history-list');
  if (listContainer) {
    renderHistoryList(listContainer, sessions);
  }
}

function renderHistoryChart(sessions: SessionRecord[]): string {
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
    gridHtml += `<line x1="${padL}" y1="${y}" x2="${svgWidth - padR}" y2="${y}" stroke="#333" stroke-width="0.5" />`;
    gridHtml += `<text x="${padL - 5}" y="${y + 4}" text-anchor="end" fill="#888" font-size="9">${val}</text>`;
  }

  // Data points
  let dotsHtml = '';
  for (const p of points) {
    const color = p.score >= 80 ? 'var(--success)' : p.score >= 60 ? 'var(--warning)' : 'var(--danger)';
    dotsHtml += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="${color}" stroke="#0f0f0f" stroke-width="1.5"><title>Score: ${p.score} (${p.grade})</title></circle>`;
  }

  // X-axis labels (first and last date)
  const firstDate = formatShortDate(recent[0].date);
  const lastDate = formatShortDate(recent[recent.length - 1].date);

  return `
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Score trend over last ${recent.length} sessions" style="width: 100%; height: auto;">
      ${gridHtml}
      <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      ${dotsHtml}
      <text x="${padL}" y="${svgHeight - 5}" fill="#888" font-size="9">${firstDate}</text>
      <text x="${svgWidth - padR}" y="${svgHeight - 5}" text-anchor="end" fill="#888" font-size="9">${lastDate}</text>
    </svg>
  `;
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

    html += `
      <div class="history-item" data-compare-idx="${idx}" style="cursor: pointer;" role="button" tabindex="0" aria-label="Session ${dateStr}: ${exerciseLabel}, ${s.grade}, ${s.overall_score} points">
        <span class="history-date">${escapeHtml(dateStr)}</span>
        <span style="font-size: 0.7rem; color: var(--accent-dim); font-weight: 600;">${exerciseLabel}</span>
        <span class="history-grade" style="color: ${color}; font-weight: 700;">${escapeHtml(s.grade)}</span>
        <span class="history-score">${s.overall_score}</span>
        <span class="history-reps">${s.rep_count} reps</span>
        <span class="history-issue">${escapeHtml(topIssue)}</span>
      </div>
    `;
  }

  html += '</div>';
  html += '<div style="display: flex; gap: 0.5rem; margin-top: 1rem; flex-wrap: wrap;">';
  html += `<button id="compare-btn" class="btn btn-sm" style="font-size: 0.8rem; background: var(--accent); color: var(--bg-primary);${displaySessions.length < 2 ? ' opacity: 0.4; cursor: not-allowed;' : ''}" aria-label="Compare selected sessions" disabled>Compare (0/2)</button>`;
  html += '<button id="export-csv-btn" class="btn btn-sm" style="font-size: 0.8rem; background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary);" aria-label="Export session history as CSV">Export CSV</button>';
  html += '<button id="clear-history-btn" class="btn btn-sm" style="font-size: 0.8rem; background: #222; border: 1px solid #444; color: var(--text-muted);" aria-label="Clear session history">Clear History</button>';
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
