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
import { generateMeetPrepPlan } from './meet-prep-plan';
import type { MeetPrepPlan } from './meet-prep-plan';

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

  // Attempt plan: show whenever 1RM data is available and weight was entered
  let attemptHtml = '';
  const compModeCheckbox = document.getElementById('competition-mode') as HTMLInputElement | null;
  const weightInputEl = document.getElementById('weight-input') as HTMLInputElement | null;
  const hasWeight = weightInputEl && parseFloat(weightInputEl.value) > 0;
  if (hasWeight && estimate.average > 0) {
    const plan = generateAttemptPlan(estimate.average, estimate.unit);
    const isCompMode = compModeCheckbox?.checked ?? false;
    const planLabel = isCompMode ? 'Competition Meet Attempts' : 'Estimated Meet Attempts';
    attemptHtml = `
      <div class="one-rm-panel">
        <div class="one-rm-panel-heading">${escapeHtml(planLabel)}</div>
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

// ─── Meet Prep Week Planner (E4) ───

const MEET_PREP_STORAGE_KEY = 'squat_form_meet_prep';

function loadMeetPrepDate(): string {
  try {
    return localStorage.getItem(MEET_PREP_STORAGE_KEY) ?? '';
  } catch { return ''; }
}

function saveMeetPrepDate(date: string): void {
  try {
    localStorage.setItem(MEET_PREP_STORAGE_KEY, date);
  } catch { /* ignore */ }
}

export function renderMeetPrepPlan(
  phase?: TrainingPhase,
  oneRMEstimate?: OneRMEstimate | null,
): void {
  const existing = document.getElementById('meet-prep-plan');
  if (existing) existing.remove();

  // Only show when peaking and 1RM is available
  if (phase !== 'peaking' || !oneRMEstimate || oneRMEstimate.average <= 0) return;

  const section = document.getElementById('results-section');
  if (!section) return;

  const card = document.createElement('div');
  card.id = 'meet-prep-plan';
  card.className = 'card card--static';
  card.setAttribute('aria-label', 'Meet prep plan');

  const heading = document.createElement('h4');
  heading.className = 'section-heading-sm';
  heading.textContent = 'Meet Prep Plan';
  card.appendChild(heading);

  const desc = document.createElement('p');
  desc.className = 'training-rec-desc';
  desc.textContent = 'Set your meet date to generate a periodized taper plan based on your estimated 1RM.';
  card.appendChild(desc);

  const dateRow = document.createElement('div');
  dateRow.style.cssText = 'display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;';

  const dateLabel = document.createElement('label');
  dateLabel.textContent = 'Meet date:';
  dateLabel.style.cssText = 'font-size: var(--font-sm, 0.875rem); color: var(--text-secondary, #b0b0b0);';
  dateLabel.setAttribute('for', 'meet-date-input');

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.id = 'meet-date-input';
  dateInput.style.cssText = 'padding: 0.3rem 0.5rem; border-radius: var(--radius-sm, 6px); border: 1px solid var(--border, #333); background: var(--bg-input, #1e1e1e); color: var(--text-primary, #e0e0e0); font-size: var(--font-sm, 0.875rem);';

  // Restore saved date
  const savedDate = loadMeetPrepDate();
  if (savedDate) dateInput.value = savedDate;

  // Set min to tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  dateInput.min = tomorrow.toISOString().slice(0, 10);

  dateRow.appendChild(dateLabel);
  dateRow.appendChild(dateInput);
  card.appendChild(dateRow);

  const gridContainer = document.createElement('div');
  gridContainer.id = 'meet-prep-grid';
  card.appendChild(gridContainer);

  function renderGrid(): void {
    const meetDate = dateInput.value;
    if (!meetDate || !oneRMEstimate) {
      gridContainer.innerHTML = '';
      return;
    }

    saveMeetPrepDate(meetDate);
    const plan = generateMeetPrepPlan(meetDate, oneRMEstimate.average, oneRMEstimate.unit);

    if (plan.weeks.length === 0) {
      gridContainer.innerHTML = '<p style="font-size: var(--font-sm); color: var(--text-muted);">Meet date must be in the future.</p>';
      return;
    }

    let html = `<div style="font-size: var(--font-xs, 0.75rem); color: var(--text-muted, #808080); margin-bottom: 0.5rem;">${plan.weeksOut} weeks out</div>`;
    html += '<div style="display: grid; gap: 0.35rem;">';

    for (const week of plan.weeks) {
      const isCurrentWeek = week.weekNumber === plan.weeksOut;
      const highlightStyle = isCurrentWeek ? 'border: 1px solid var(--accent, #00d4ff); background: var(--accent-glow, rgba(0,212,255,0.15));' : 'border: 1px solid var(--border, #333);';
      html += `
        <div style="padding: 0.4rem 0.6rem; border-radius: var(--radius-sm, 6px); ${highlightStyle} display: flex; justify-content: space-between; align-items: center; font-size: var(--font-sm, 0.875rem);">
          <span style="color: var(--text-secondary, #b0b0b0);">${escapeHtml(week.label)}</span>
          <span style="color: var(--text-primary, #e0e0e0); font-weight: 600;">
            ${week.sets}x${escapeHtml(week.reps)} @ ${week.intensityPct}%${week.weight ? ` (${week.weight} ${escapeHtml(oneRMEstimate.unit)})` : ''}
          </span>
        </div>
      `;
    }

    html += '</div>';
    gridContainer.innerHTML = html;
  }

  dateInput.addEventListener('change', renderGrid);

  // Render immediately if saved date exists
  if (savedDate) renderGrid();

  // Insert after training recommendations
  const trainingRec = document.getElementById('training-recommendations');
  if (trainingRec?.parentNode) {
    trainingRec.parentNode.insertBefore(card, trainingRec.nextSibling);
  } else {
    section.appendChild(card);
  }
}
