/**
 * Side-by-side session comparison view.
 * Compares two sessions across overall score and per-dimension averages.
 * Includes before/after snapshot comparison when available.
 */

import type { SessionRecord } from './types';
import { escapeHtml, gradeColor, scoreColor, formatShortDate } from './ui-utilities';

/** Phase display labels for snapshot images. */
const PHASE_LABELS: Record<string, string> = {
  bottom: 'Bottom Position',
  lockout: 'Lockout',
};

/** Build snapshot comparison HTML for two sessions. */
function buildSnapshotComparison(sessionA: SessionRecord, sessionB: SessionRecord): string {
  const snapsA = sessionA.snapshots;
  const snapsB = sessionB.snapshots;
  const hasA = snapsA && snapsA.length > 0;
  const hasB = snapsB && snapsB.length > 0;

  if (!hasA && !hasB) return '';

  const dateA = formatShortDate(sessionA.date);
  const dateB = formatShortDate(sessionB.date);

  const phases = ['bottom', 'lockout'] as const;
  let rows = '';

  for (const phase of phases) {
    const snapA = hasA ? snapsA!.find(s => s.phase === phase) : undefined;
    const snapB = hasB ? snapsB!.find(s => s.phase === phase) : undefined;

    if (!snapA && !snapB) continue;

    const phaseLabel = PHASE_LABELS[phase] ?? phase;

    const imgA = snapA
      ? `<img src="${snapA.dataUrl}" alt="${escapeHtml(phaseLabel)} - ${escapeHtml(dateA)}" style="width: 100%; height: auto; border-radius: 6px; border: 1px solid var(--border);" loading="lazy" />`
      : `<div style="width: 100%; aspect-ratio: 16/9; background: var(--bg-input); border-radius: 6px; border: 1px dashed var(--border); display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 0.75rem;">No snapshot</div>`;

    const imgB = snapB
      ? `<img src="${snapB.dataUrl}" alt="${escapeHtml(phaseLabel)} - ${escapeHtml(dateB)}" style="width: 100%; height: auto; border-radius: 6px; border: 1px solid var(--border);" loading="lazy" />`
      : `<div style="width: 100%; aspect-ratio: 16/9; background: var(--bg-input); border-radius: 6px; border: 1px dashed var(--border); display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 0.75rem;">No snapshot</div>`;

    rows += `
      <div style="margin-bottom: 0.75rem;">
        <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.35rem; font-weight: 600;">${escapeHtml(phaseLabel)}</div>
        <div class="snapshot-comparison-pair" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
          <div>
            <div style="font-size: 0.65rem; color: var(--text-muted); margin-bottom: 0.2rem; text-align: center;">Before (${escapeHtml(dateA)})</div>
            ${imgA}
          </div>
          <div>
            <div style="font-size: 0.65rem; color: var(--text-muted); margin-bottom: 0.2rem; text-align: center;">After (${escapeHtml(dateB)})</div>
            ${imgB}
          </div>
        </div>
      </div>
    `;
  }

  if (!rows) return '';

  return `
    <div style="margin-top: 1rem; border-top: 1px solid var(--border); padding-top: 0.75rem;">
      <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem; font-weight: 600;">Form Snapshots</div>
      ${rows}
    </div>
  `;
}

/** Render a comparison view between two sessions. */
export function renderComparisonView(sessionA: SessionRecord, sessionB: SessionRecord): void {
  const section = document.getElementById('results-section');
  if (!section) return;

  // Remove existing comparison
  const existing = document.getElementById('comparison-view');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.id = 'comparison-view';
  container.className = 'card';
  container.setAttribute('aria-label', 'Session comparison');

  const dateA = formatShortDate(sessionA.date);
  const dateB = formatShortDate(sessionB.date);
  const colorA = gradeColor(sessionA.grade);
  const colorB = gradeColor(sessionB.grade);

  const scoreDelta = sessionB.overall_score - sessionA.overall_score;
  const deltaColor = scoreDelta > 0 ? 'var(--success)' : scoreDelta < 0 ? 'var(--danger)' : 'var(--text-muted)';
  const deltaSign = scoreDelta > 0 ? '+' : '';

  // Dimension comparison bars
  const dims: { label: string; keyA: keyof SessionRecord; keyB: keyof SessionRecord }[] = [
    { label: 'Depth', keyA: 'avg_depth', keyB: 'avg_depth' },
    { label: 'Knee Tracking', keyA: 'avg_knee_tracking', keyB: 'avg_knee_tracking' },
    { label: 'Torso', keyA: 'avg_trunk', keyB: 'avg_trunk' },
    { label: 'Symmetry', keyA: 'avg_symmetry', keyB: 'avg_symmetry' },
    { label: 'Tempo', keyA: 'avg_tempo', keyB: 'avg_tempo' },
    { label: 'Lockout', keyA: 'avg_lockout', keyB: 'avg_lockout' },
  ];

  let dimRows = '';
  for (const dim of dims) {
    const valA = (sessionA as any)[dim.keyA] as number | undefined;
    const valB = (sessionB as any)[dim.keyB] as number | undefined;
    if (valA === undefined && valB === undefined) continue;

    const a = valA ?? 0;
    const b = valB ?? 0;
    const diff = b - a;
    const diffColor = diff > 0 ? 'var(--success)' : diff < 0 ? 'var(--danger)' : 'var(--text-muted)';
    const diffSign = diff > 0 ? '+' : '';

    dimRows += `
      <div class="comparison-dim-row" style="display: grid; grid-template-columns: 80px 1fr 40px 1fr 50px; gap: 0.5rem; align-items: center; margin-bottom: 0.35rem; font-size: 0.85rem;">
        <span style="color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(dim.label)}</span>
        <div style="background: var(--bg-input); border-radius: 4px; height: 8px; overflow: hidden; min-width: 0;">
          <div style="width: ${a}%; height: 100%; background: ${scoreColor(a)}; border-radius: 4px;"></div>
        </div>
        <span style="text-align: center; color: var(--text-secondary); font-size: 0.8rem;">${a}</span>
        <div style="background: var(--bg-input); border-radius: 4px; height: 8px; overflow: hidden; min-width: 0;">
          <div style="width: ${b}%; height: 100%; background: ${scoreColor(b)}; border-radius: 4px;"></div>
        </div>
        <span style="text-align: right; font-size: 0.8rem;">
          <span style="color: var(--text-secondary);">${b}</span>
          <span style="color: ${diffColor}; font-size: 0.7rem;"> ${diffSign}${diff} ${diff > 0 ? '\u2191' : diff < 0 ? '\u2193' : '\u2014'}</span>
        </span>
      </div>
    `;
  }

  // Per-rep score comparison (if available)
  let repChart = '';
  if (sessionA.rep_scores && sessionB.rep_scores) {
    const maxReps = Math.max(sessionA.rep_scores.length, sessionB.rep_scores.length);
    if (maxReps > 0) {
      const svgW = 300;
      const svgH = 100;
      const pad = 20;

      const makePoints = (scores: number[]) =>
        scores.map((s, i) => {
          const x = pad + (i / Math.max(scores.length - 1, 1)) * (svgW - 2 * pad);
          const y = pad + ((100 - s) / 100) * (svgH - 2 * pad);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        });

      const pointsA = makePoints(sessionA.rep_scores);
      const pointsB = makePoints(sessionB.rep_scores);
      const pathA = pointsA.map((p, i) => `${i === 0 ? 'M' : 'L'}${p}`).join(' ');
      const pathB = pointsB.map((p, i) => `${i === 0 ? 'M' : 'L'}${p}`).join(' ');

      repChart = `
        <div style="margin-top: 1rem;">
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem; font-weight: 600;">Rep-by-Rep Scores</div>
          <svg viewBox="0 0 ${svgW} ${svgH}" style="width: 100%; height: auto;" role="img" aria-label="Per-rep score comparison">
            <path d="${pathA}" fill="none" stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.7" />
            <path d="${pathB}" fill="none" stroke="var(--accent)" stroke-width="2" />
            ${pointsA.map(p => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="3" fill="var(--text-muted)" opacity="0.7" />`).join('')}
            ${pointsB.map(p => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="3" fill="var(--accent)" />`).join('')}
          </svg>
          <div style="display: flex; gap: 1rem; justify-content: center; font-size: 0.75rem; color: var(--text-muted);">
            <span><span style="display: inline-block; width: 16px; border-top: 2px dashed var(--text-muted); vertical-align: middle; margin-right: 4px;"></span>${escapeHtml(dateA)}</span>
            <span><span style="display: inline-block; width: 16px; border-top: 2px solid var(--accent); vertical-align: middle; margin-right: 4px;"></span>${escapeHtml(dateB)}</span>
          </div>
        </div>
      `;
    }
  }

  // Snapshot comparison section
  const snapshotSection = buildSnapshotComparison(sessionA, sessionB);

  // Inject responsive styles once
  if (!document.getElementById('comparison-responsive-styles')) {
    const style = document.createElement('style');
    style.id = 'comparison-responsive-styles';
    style.textContent = `
      @media (max-width: 480px) {
        .comparison-scores-grid {
          grid-template-columns: 1fr 1fr !important;
          gap: 0.5rem !important;
        }
        .comparison-scores-grid .comparison-delta {
          grid-column: 1 / -1;
        }
        .comparison-dim-row {
          grid-template-columns: 60px 1fr 30px 1fr 40px !important;
          gap: 0.25rem !important;
          font-size: 0.75rem !important;
        }
        .snapshot-comparison-pair {
          grid-template-columns: 1fr !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
      <h3 style="font-size: 0.9rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Session Comparison</h3>
      <button id="close-comparison" class="btn btn-sm" style="font-size: 0.75rem; background: var(--bg-input); border: 1px solid var(--border); color: var(--text-muted);">Close</button>
    </div>
    <div class="comparison-scores-grid" style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 1rem; text-align: center; margin-bottom: 1.5rem;">
      <div>
        <div style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(dateA)}</div>
        <div style="font-size: 2rem; font-weight: 800; color: ${colorA};">${sessionA.grade}</div>
        <div style="font-size: 1.2rem; color: var(--text-secondary);">${sessionA.overall_score}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">${sessionA.rep_count} reps</div>
      </div>
      <div class="comparison-delta" style="display: flex; align-items: center; justify-content: center;">
        <div style="font-size: 1.1rem; font-weight: 700; color: ${deltaColor};">${deltaSign}${scoreDelta}</div>
      </div>
      <div>
        <div style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(dateB)}</div>
        <div style="font-size: 2rem; font-weight: 800; color: ${colorB};">${sessionB.grade}</div>
        <div style="font-size: 1.2rem; color: var(--text-secondary);">${sessionB.overall_score}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">${sessionB.rep_count} reps</div>
      </div>
    </div>
    ${dimRows ? `<div style="margin-bottom: 0.5rem; max-width: 100%; overflow-x: auto;">${dimRows}</div>` : ''}
    ${repChart}
    ${snapshotSection}
  `;

  section.style.display = 'block';
  section.prepend(container);
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('close-comparison')?.addEventListener('click', () => {
    container.remove();
  });
}
