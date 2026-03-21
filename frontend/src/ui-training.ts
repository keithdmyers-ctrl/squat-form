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
import { computeDOTS, calculateWilks2, calculateGLPoints, check1RMSafety } from './one-rm';
import { generateAttemptPlan } from './competition';
import { generateMeetPrepPlan } from './meet-prep-plan';
import type { MeetPrepPlan } from './meet-prep-plan';
import { getStrengthLevel, getNextMilestone, renderStrengthCard } from './strength-standards';

// ─── Styles ───

const UT_STYLES = `
.ut-dots-panel-spaced { margin-top: var(--space-sm); }
.ut-milestone-hint { margin-top: var(--space-xs); color: var(--accent); }
.ut-safety-panel { border-color: var(--warning); background: rgba(251, 191, 36, 0.08); margin-top: var(--space-sm); }
.ut-safety-heading { color: var(--warning); }
.ut-safety-text { color: var(--warning); }
.ut-score-row { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.35rem; }
.ut-score-chip { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.2rem 0.5rem; border-radius: var(--radius-sm, 6px); background: var(--bg-card, #1a1a1a); border: 1px solid var(--border, #333); font-size: var(--font-xs, 0.75rem); color: var(--text-secondary, #b0b0b0); }
.ut-score-chip strong { color: var(--accent, #00d4ff); font-weight: 700; }
.ut-collapsible { margin-top: var(--space-sm); }
.ut-collapsible-summary { cursor: pointer; font-size: var(--font-sm, 0.875rem); font-weight: 600; color: var(--text-secondary, #b0b0b0); padding: 0.35rem 0; list-style: none; }
.ut-collapsible-summary::-webkit-details-marker { display: none; }
.ut-collapsible-summary::before { content: '\\25B6'; display: inline-block; margin-right: 0.4rem; font-size: 0.65rem; transition: transform 0.15s ease; }
.ut-collapsible[open] > .ut-collapsible-summary::before { transform: rotate(90deg); }
.ut-meet-future-msg { font-size: var(--font-sm); color: var(--text-muted); }
.ut-meet-weeks-out { font-size: var(--font-xs, 0.75rem); color: var(--text-muted, #808080); margin-bottom: 0.5rem; }
.ut-meet-grid { display: grid; gap: 0.35rem; }
.ut-meet-week-row { padding: 0.4rem 0.6rem; border-radius: var(--radius-sm, 6px); border: 1px solid var(--border, #333); display: flex; justify-content: space-between; align-items: center; font-size: var(--font-sm, 0.875rem); }
.ut-meet-week-row--current { border: 1px solid var(--accent, #00d4ff); background: var(--accent-glow, rgba(0,212,255,0.15)); }
.ut-meet-week-label { color: var(--text-secondary, #b0b0b0); }
.ut-meet-week-value { color: var(--text-primary, #e0e0e0); font-weight: 600; }
.ut-date-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; }
.ut-date-label { font-size: var(--font-sm, 0.875rem); color: var(--text-secondary, #b0b0b0); }
.ut-date-input { padding: 0.3rem 0.5rem; border-radius: var(--radius-sm, 6px); border: 1px solid var(--border, #333); background: var(--bg-input, #1e1e1e); color: var(--text-primary, #e0e0e0); font-size: var(--font-sm, 0.875rem); }
`;

function injectUTStyles(): void {
  if (document.getElementById('ut-extra-styles')) return;
  const style = document.createElement('style');
  style.id = 'ut-extra-styles';
  style.textContent = UT_STYLES;
  document.head.appendChild(style);
}

// ─── Training Recommendations ───

export function renderTrainingRecommendations(
  phase?: TrainingPhase,
  oneRMEstimate?: OneRMEstimate | null,
  sessions?: SessionRecord[],
  exerciseType?: string,
): void {
  injectUTStyles();

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
  injectUTStyles();

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

  // Read bodyweight and sex from DOM (shared by strength + scoring sections)
  let strengthClassHtml = '';
  let strengthScoresHtml = '';
  const bwInput = document.getElementById('bodyweight-input') as HTMLInputElement | null;
  const bwUnitSelect = document.getElementById('bodyweight-unit') as HTMLSelectElement | null;
  const rawBw = bwInput ? parseFloat(bwInput.value) : 0;
  const bwUnit = bwUnitSelect?.value ?? 'kg';
  if (rawBw > 0 && estimate.average > 0) {
    const isMaleBtn = document.querySelector('.sex-toggle-btn.active') as HTMLElement | null;
    const isMale = isMaleBtn?.dataset.sex !== 'female';
    const sex: 'male' | 'female' = isMale ? 'male' : 'female';
    // Convert to kg if needed for DOTS computation
    const bwKg = bwUnit === 'lbs' ? rawBw * 0.453592 : rawBw;
    const totalKg = estimate.unit === 'lbs' ? estimate.average * 0.453592 : estimate.average;
    const dotsResult = computeDOTS(totalKg, bwKg, isMale);

    // Calculate all scoring systems
    const wilks2 = calculateWilks2(totalKg, bwKg, sex);
    const glPoints = calculateGLPoints(totalKg, bwKg, sex);

    // --- Strength Classification (shown FIRST, most meaningful to users) ---
    const exerciseType = document.getElementById('exercise-type')?.querySelector('input:checked')?.getAttribute('value')
      ?? (document.querySelector('[name="exercise-type"]:checked') as HTMLInputElement)?.value
      ?? 'squat';
    const liftKey = exerciseType === 'bench_press' ? 'bench' : exerciseType === 'overhead_press' ? 'ohp' : exerciseType;
    if (['squat', 'bench', 'deadlift', 'ohp'].includes(liftKey)) {
      const weightInLift = estimate.average;
      const strengthLevel = getStrengthLevel(weightInLift, rawBw, liftKey, sex);
      const milestone = getNextMilestone(weightInLift, rawBw, liftKey, sex);
      const levelColors: Record<string, string> = {
        untrained: '#9e9e9e', beginner: '#81c784', novice: '#4fc3f7',
        intermediate: '#7c4dff', advanced: '#ff9800', elite: '#f44336',
      };
      strengthClassHtml = `
        <div class="dots-panel">
          <div class="dots-heading">Strength Classification</div>
          <div class="dots-score-row">
            <span class="dots-score-value" style="color: ${levelColors[strengthLevel] ?? 'var(--text-primary)'}; font-size: 1.25rem;">${strengthLevel.charAt(0).toUpperCase() + strengthLevel.slice(1)}</span>
          </div>
          <div class="dots-subtitle">At ${rawBw} ${escapeHtml(bwUnit)} bodyweight (${sex})</div>
          ${milestone ? `<div class="dots-subtitle ut-milestone-hint">Next: ${milestone.level.charAt(0).toUpperCase() + milestone.level.slice(1)} at ${Math.round(milestone.targetWeight)} ${escapeHtml(estimate.unit)} (+${Math.round(milestone.deficit)})</div>` : ''}
        </div>
      `;
    }

    // --- Relative Strength Scores (compact row: DOTS / Wilks / GL) ---
    if (dotsResult) {
      const scoreParts: string[] = [];
      scoreParts.push(`<span class="ut-score-chip">DOTS <strong>${dotsResult.score.toFixed(1)}</strong></span>`);
      if (wilks2 !== null) {
        scoreParts.push(`<span class="ut-score-chip">Wilks-2 <strong>${wilks2.toFixed(1)}</strong></span>`);
      }
      if (glPoints !== null) {
        scoreParts.push(`<span class="ut-score-chip">GL <strong>${glPoints.toFixed(1)}</strong></span>`);
      }

      strengthScoresHtml = `
        <div class="dots-panel ut-dots-panel-spaced">
          <div class="dots-heading">Relative Strength Scores</div>
          <div class="ut-score-row">${scoreParts.join('')}</div>
        </div>
      `;
    }
  }

  // 1RM safety check
  let safetyHtml = '';
  if (estimate.average > 0) {
    const exerciseType = document.getElementById('exercise-type')?.querySelector('input:checked')?.getAttribute('value')
      ?? (document.querySelector('[name="exercise-type"]:checked') as HTMLInputElement)?.value
      ?? 'squat';
    const liftKey = exerciseType === 'bench_press' ? 'bench' : exerciseType === 'overhead_press' ? 'ohp' : exerciseType;
    const safetyCheck = check1RMSafety(estimate.average, liftKey, rawBw > 0 ? rawBw : undefined);
    if (!safetyCheck.plausible && safetyCheck.warning) {
      safetyHtml = `
        <div class="dots-panel ut-safety-panel">
          <div class="dots-heading ut-safety-heading">Safety Notice</div>
          <div class="dots-subtitle ut-safety-text">${escapeHtml(safetyCheck.warning)}</div>
        </div>
      `;
    }
  }

  // Attempt plan: collapsed by default inside a <details>
  let attemptHtml = '';
  const compModeCheckbox = document.getElementById('competition-mode') as HTMLInputElement | null;
  const weightInputEl = document.getElementById('weight-input') as HTMLInputElement | null;
  const hasWeight = weightInputEl && parseFloat(weightInputEl.value) > 0;
  if (hasWeight && estimate.average > 0) {
    const plan = generateAttemptPlan(estimate.average, estimate.unit);
    const isCompMode = compModeCheckbox?.checked ?? false;
    const planLabel = isCompMode ? 'Competition Meet Attempts' : 'Estimated Meet Attempts';
    attemptHtml = `
      <details class="ut-collapsible">
        <summary class="ut-collapsible-summary">${escapeHtml(planLabel)}</summary>
        <div class="one-rm-panel">
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
      </details>
    `;
  }

  // Training percentages: collapsed by default inside a <details>
  const percentagesHtml = `
    <details class="ut-collapsible">
      <summary class="ut-collapsible-summary">Training Percentages</summary>
      <div class="one-rm-panel">
        ${tableRows}
      </div>
    </details>
  `;

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
        ${safetyHtml}
        ${strengthClassHtml}
        ${strengthScoresHtml}
        ${percentagesHtml}
        ${attemptHtml}
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
  injectUTStyles();

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
  dateRow.className = 'ut-date-row';

  const dateLabel = document.createElement('label');
  dateLabel.textContent = 'Meet date:';
  dateLabel.className = 'ut-date-label';
  dateLabel.setAttribute('for', 'meet-date-input');

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.id = 'meet-date-input';
  dateInput.className = 'ut-date-input';

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
      gridContainer.innerHTML = '<p class="ut-meet-future-msg">Meet date must be in the future.</p>';
      return;
    }

    let html = `<div class="ut-meet-weeks-out">${plan.weeksOut} weeks out</div>`;
    html += '<div class="ut-meet-grid">';

    for (const week of plan.weeks) {
      const isCurrentWeek = week.weekNumber === plan.weeksOut;
      const rowClass = isCurrentWeek ? 'ut-meet-week-row ut-meet-week-row--current' : 'ut-meet-week-row';
      html += `
        <div class="${rowClass}">
          <span class="ut-meet-week-label">${escapeHtml(week.label)}</span>
          <span class="ut-meet-week-value">
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
