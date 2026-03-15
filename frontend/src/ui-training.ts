/**
 * Training recommendations and 1RM estimation display (with DOTS + attempt plan).
 * Extracted from ui-results.ts for better module boundaries.
 */

import type { SessionRecord } from './types';
import type { OneRMEstimate } from './one-rm';
import { escapeHtml, $ } from './ui-utilities';
import type { TrainingPhase } from './programming';
import {
  getRecommendation,
  suggestNextPhase,
  PHASE_DESCRIPTIONS,
} from './programming';
import { computeDOTS } from './one-rm';
import { generateAttemptPlan } from './competition';

// ─── Training Recommendations ───

export function renderTrainingRecommendations(
  phase?: TrainingPhase,
  oneRMEstimate?: OneRMEstimate | null,
  sessions?: SessionRecord[],
  exerciseType?: string,
): void {
  const existing = document.getElementById('training-recommendations');
  if (existing) existing.remove();

  const activePhase = phase ?? 'hypertrophy';
  const rec = getRecommendation(activePhase, oneRMEstimate?.average, exerciseType, oneRMEstimate?.unit);

  const recDiv = document.createElement('div');
  recDiv.id = 'training-recommendations';
  recDiv.className = 'card card--static training-rec-card';
  recDiv.setAttribute('aria-label', 'Training recommendations');

  const phaseColors: Record<string, string> = {
    hypertrophy: 'var(--accent)',
    strength: 'var(--warning)',
    peaking: 'var(--danger)',
    deload: 'var(--success)',
  };
  const phaseColor = phaseColors[activePhase] ?? 'var(--accent)';

  const heading = document.createElement('h4');
  heading.className = 'section-heading-sm';
  heading.textContent = 'Training Recommendations';
  recDiv.appendChild(heading);

  const phaseBadge = document.createElement('div');
  phaseBadge.className = 'phase-badge-inline';
  phaseBadge.style.background = phaseColor;
  phaseBadge.textContent = activePhase.charAt(0).toUpperCase() + activePhase.slice(1) + ' Phase';
  recDiv.appendChild(phaseBadge);

  const desc = document.createElement('p');
  desc.className = 'training-rec-desc';
  desc.textContent = PHASE_DESCRIPTIONS[activePhase];
  recDiv.appendChild(desc);

  const grid = document.createElement('div');
  grid.className = 'training-rec-grid';
  for (const item of [
    { label: 'Sets', value: String(rec.sets) },
    { label: 'Reps', value: rec.reps },
    { label: 'Intensity', value: rec.intensity },
    { label: 'Rest', value: rec.restMinutes + ' min' },
  ]) {
    const cell = document.createElement('div');
    cell.className = 'training-rec-cell';
    cell.innerHTML = `<div class="training-rec-cell-label">${escapeHtml(item.label)}</div><div class="training-rec-cell-value">${escapeHtml(item.value)}</div>`;
    grid.appendChild(cell);
  }
  recDiv.appendChild(grid);

  if (rec.weightRange) {
    const weightInfo = document.createElement('div');
    weightInfo.className = 'training-rec-weight';
    weightInfo.innerHTML = `<span class="training-rec-weight-label">Target weight:</span> <span class="training-rec-weight-value">${rec.weightRange[0]}-${rec.weightRange[1]} ${escapeHtml(rec.weightUnit ?? 'lbs')}</span>`;
    recDiv.appendChild(weightInfo);
  }

  if (rec.focusAreas.length > 0) {
    const focusHeading = document.createElement('div');
    focusHeading.className = 'section-heading-xs';
    focusHeading.textContent = 'Focus Areas';
    recDiv.appendChild(focusHeading);
    const focusList = document.createElement('ul');
    focusList.className = 'training-rec-focus-list';
    for (const area of rec.focusAreas) {
      const li = document.createElement('li');
      li.textContent = area;
      focusList.appendChild(li);
    }
    recDiv.appendChild(focusList);
  }

  if (sessions && sessions.length > 0) {
    const suggestion = suggestNextPhase(sessions.map(s => ({ score: s.overall_score, date: s.date })));
    const suggestionDiv = document.createElement('div');
    suggestionDiv.className = 'training-rec-suggestion';
    const nextPhaseLabel = suggestion.phase.charAt(0).toUpperCase() + suggestion.phase.slice(1);
    suggestionDiv.innerHTML = `<div class="training-rec-suggestion-label">Suggested Next Phase</div><div class="training-rec-phase-label">${escapeHtml(nextPhaseLabel)}</div><div class="training-rec-reason">${escapeHtml(suggestion.reason)}</div>`;
    recDiv.appendChild(suggestionDiv);
  }

  const section = document.getElementById('results-section');
  if (section) {
    const progressInsights = document.getElementById('progress-insights');
    const coachingSection = document.getElementById('coaching-section');
    const insertAfter = progressInsights ?? coachingSection;
    if (insertAfter?.parentNode) {
      insertAfter.parentNode.insertBefore(recDiv, insertAfter.nextSibling);
    } else {
      section.appendChild(recDiv);
    }
  }
}

// ─── 1RM Estimation Card ───

export function renderOneRMEstimate(estimate: OneRMEstimate): void {
  const scoresPanel = document.querySelector('.scores-panel');
  if (!scoresPanel) return;

  // Remove existing
  const existing = document.getElementById('one-rm-section');
  if (existing) existing.remove();

  const section = document.createElement('div');
  section.id = 'one-rm-section';
  section.className = 'card card--static';
  section.setAttribute('aria-label', `Estimated one rep max: ${estimate.average} ${escapeHtml(estimate.unit)}`);

  const tableRows = estimate.percentageTable
    .filter(row => row.percent <= 95 && row.percent >= 60)
    .map(row => `
      <div class="one-rm-row">
        <span class="one-rm-row-label">${row.percent}%</span>
        <span class="one-rm-row-value">${row.weight} ${escapeHtml(estimate.unit)}</span>
      </div>
    `).join('');

  // DOTS score: read bodyweight and sex from DOM
  let dotsHtml = '';
  const bwInput = document.getElementById('bodyweight-input') as HTMLInputElement | null;
  const bwUnitSelect = document.getElementById('bodyweight-unit') as HTMLSelectElement | null;
  const rawBw = bwInput ? parseFloat(bwInput.value) : 0;
  const bwUnit = bwUnitSelect?.value ?? 'kg';
  if (rawBw > 0 && estimate.average > 0) {
    const isMaleBtn = document.querySelector('.sex-toggle-btn.active') as HTMLElement | null;
    const isMale = isMaleBtn?.dataset.sex !== 'female';
    // Convert to kg if needed for DOTS computation
    const bwKg = bwUnit === 'lbs' ? rawBw * 0.453592 : rawBw;
    const totalKg = estimate.unit === 'lbs' ? estimate.average * 0.453592 : estimate.average;
    const dotsResult = computeDOTS(totalKg, bwKg, isMale);
    if (dotsResult) {
      const level = dotsResult.score >= 500 ? 'Elite' : dotsResult.score >= 400 ? 'Advanced' : dotsResult.score >= 300 ? 'Intermediate' : 'Novice';
      const levelColor = dotsResult.score >= 500 ? 'var(--danger)' : dotsResult.score >= 400 ? 'var(--warning)' : dotsResult.score >= 300 ? 'var(--accent)' : 'var(--text-muted)';
      dotsHtml = `
        <div class="dots-panel">
          <div class="dots-heading">DOTS Score</div>
          <div class="dots-score-row">
            <span class="dots-score-value">${dotsResult.score.toFixed(1)}</span>
            <span class="dots-level" style="color: ${levelColor};">${level}</span>
          </div>
          <div class="dots-subtitle">Relative strength at ${rawBw} ${escapeHtml(bwUnit)} (${isMale ? 'male' : 'female'})</div>
        </div>
      `;
    }
  }

  // Competition attempt plan
  let attemptHtml = '';
  const compModeCheckbox = document.getElementById('competition-mode') as HTMLInputElement | null;
  if (compModeCheckbox?.checked && estimate.average > 0) {
    const plan = generateAttemptPlan(estimate.average, estimate.unit);
    attemptHtml = `
      <div class="one-rm-panel">
        <div class="one-rm-panel-heading">Meet Attempt Plan</div>
        <div class="one-rm-row">
          <span class="attempt-row-label">Opener (~88%)</span>
          <span class="attempt-opener">${plan.opener} ${escapeHtml(estimate.unit)}</span>
        </div>
        <div class="one-rm-row">
          <span class="attempt-row-label">2nd Attempt (~94%)</span>
          <span class="attempt-second">${plan.second} ${escapeHtml(estimate.unit)}</span>
        </div>
        <div class="one-rm-row">
          <span class="attempt-row-label">3rd Attempt (~100%)</span>
          <span class="attempt-third">${plan.third} ${escapeHtml(estimate.unit)}</span>
        </div>
      </div>
    `;
  }

  section.innerHTML = `
    <details>
      <summary class="one-rm-summary">
        <span class="collapse-chevron">&#9654;</span>
        Estimated 1RM
      </summary>
      <div class="one-rm-content">
        <div class="one-rm-hero">
          <div class="one-rm-hero-value">${estimate.average} ${escapeHtml(estimate.unit)}</div>
          <div class="one-rm-subtitle">Based on ${estimate.reps} reps at ${estimate.weight} ${escapeHtml(estimate.unit)}</div>
          <div class="one-rm-methods">Epley: ${estimate.epley} | Brzycki: ${estimate.brzycki}</div>
        </div>
        ${dotsHtml}
        ${attemptHtml}
        <div class="one-rm-panel">
          <div class="one-rm-panel-heading">Training Percentages</div>
          ${tableRows}
        </div>
      </div>
    </details>
  `;

  // Toggle chevron
  const details = section.querySelector('details');
  if (details) {
    details.addEventListener('toggle', () => {
      const chevron = section.querySelector('.collapse-chevron') as HTMLElement | null;
      if (chevron) {
        chevron.style.transform = details.open ? 'rotate(90deg)' : 'rotate(0deg)';
      }
    });
  }

  // Insert after breakdown collapse
  const breakdownCollapse = document.getElementById('breakdown-collapse');
  if (breakdownCollapse) {
    breakdownCollapse.parentNode?.insertBefore(section, breakdownCollapse.nextSibling);
  } else {
    scoresPanel.appendChild(section);
  }
}
