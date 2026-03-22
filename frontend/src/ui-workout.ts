/**
 * Workout programming UI orchestrator: entry point, active program view,
 * shared helpers, and CSS injection.
 *
 * Sub-modules:
 * - ui-workout-setup.ts — setup wizard, program recommendations
 * - ui-workout-session.ts — workout card, set logging, rest timer
 * - ui-workout-analytics.ts — calendar, volume tracker
 * - ui-workout-completion.ts — post-workout feedback, completion screen
 */

import { PROGRAMS } from './workout-programs';
import {
  loadProgramState, saveProgramState, loadUserProfile,
  loadWorkoutLogs, saveWorkoutLogs,
  initializeProgram, generateWorkout,
  autoregulate, getTransitionRecommendations,
  roundToPlate,
} from './program-generator';
import type {
  ProgramState, WorkoutLog, TransitionRecommendation,
  ReadinessData,
  ScheduleOverride,
} from './program-generator';
import { escapeHtml } from './ui-utilities';
import { calculateE1RMFromRPE, getRPEDescription } from './rpe-calculator';
import { buildCalendarMonth, calculateStreak } from './workout-calendar';
import { calculateWeeklyVolume, getUndertrainedMuscles, getOvertrainedMuscles } from './volume-tracker';
import { renderStrengthCard } from './strength-standards';
import { renderCommandsReference } from './competition';
import { renderMuscleMap, volumeToMapData, injectMuscleMapStyles, attachMuscleMapListeners } from './muscle-map';
import { renderBackupCard } from './data-backup';
import { renderProgressionDashboard, injectChartStyles } from './progression-charts';
import { renderWeakPointReport, analyzeFormWeaknesses, getAccessoryRecommendations } from './form-programming-bridge';

// Sub-modules
import { renderProgramSetup } from './ui-workout-setup';
import { renderWorkoutCard, wireUpSetLogging, restoreInProgressWorkout, getActiveRestTimer } from './ui-workout-session';
import { renderCalendarCard, renderVolumeCard } from './ui-workout-analytics';
import { completeWorkout, renderAccessoryRecommendations } from './ui-workout-completion';

// ─── Terminology Glossary (shared across sub-modules) ───

const TERM_GLOSSARY: Record<string, string> = {
  RPE: 'Rate of Perceived Exertion (1-10 scale). RPE 8 means you could do 2 more reps.',
  AMRAP: 'As Many Reps As Possible. Do as many good reps as you can, stopping 1-2 short of failure.',
  TM: 'Training Max. A conservative max (usually 90% of your true 1RM) used to calculate working weights.',
  FSL: 'First Set Last. After your top sets, do additional sets at the weight of your first working set.',
  '1RM': 'One-Rep Max. The heaviest weight you can lift for a single repetition with good form.',
  T1: 'Tier 1: Your heaviest main lift of the day. Low reps, high intensity.',
  T2: 'Tier 2: A secondary compound lift. Moderate weight, moderate reps.',
  T3: 'Tier 3: Accessory/isolation work. Lighter weight, higher reps.',
  DUP: 'Daily Undulating Periodization. Varying rep ranges across training days for the same lift.',
  LP: 'Linear Progression. Adding weight every session (beginner programs).',
  set: 'One group of consecutive reps. "3 sets of 5" means: do 5 reps, rest, 5 reps, rest, 5 reps.',
  rep: 'One complete movement — lowering and pressing the bar counts as 1 rep.',
  deload: 'A planned easy week with lighter weights to let your body recover and come back stronger.',
  rest: 'Time to recover between sets. Just breathe and stay focused.',
  'work set': 'Your main heavy sets for the day (not warm-ups).',
  failure: 'When you can\'t complete the target number of reps with good form. This triggers a progression adjustment.',
};

/** Replace known acronyms in text with tooltip-wrapped versions */
export function addTermTooltips(text: string): string {
  let result = escapeHtml(text);
  for (const [term, definition] of Object.entries(TERM_GLOSSARY)) {
    // Match whole-word occurrences (case sensitive for acronyms)
    const regex = new RegExp(`\\b${term}\\b`, 'g');
    result = result.replace(regex,
      `<span class="wp-term" tabindex="0" role="note" aria-label="${escapeHtml(definition)}" title="${escapeHtml(definition)}">${term}</span>`
    );
  }
  return result;
}

/** Human-readable progression type labels */
const PROGRESSION_LABELS: Record<string, string> = {
  linear_session: 'Add weight every session',
  linear_weekly: 'Add weight every week',
  percentage_wave: 'Percentage-based waves',
  rpe_autoregulated: 'RPE-based autoregulation',
  amrap_driven: 'AMRAP-driven progression',
  block: 'Block periodization',
};

// ─── Readiness Helpers ───

const READINESS_KEY = 'squat_form_readiness';

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadTodayReadiness(): ReadinessData | null {
  try {
    const raw = localStorage.getItem(READINESS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { date: string; readiness: ReadinessData };
    if (data.date === getTodayKey()) return data.readiness;
    return null;
  } catch { return null; }
}

function saveTodayReadiness(readiness: ReadinessData): void {
  try {
    localStorage.setItem(READINESS_KEY, JSON.stringify({ date: getTodayKey(), readiness }));
  } catch {
    document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' }));
  }
}

const SORENESS_LABELS = ['None', 'Mild', 'Moderate', 'Severe', 'Extreme'];

// ─── Storage Warning ───

function showStorageWarning(container: HTMLElement): void {
  const existing = container.querySelector('.wp-storage-warning');
  if (existing) return;
  const warning = document.createElement('div');
  warning.className = 'wp-storage-warning';
  warning.setAttribute('role', 'alert');
  warning.innerHTML = `
    <p class="wp-note-text">Storage is full. Your workout data may not be saved.
    Try clearing old session history from the History tab.</p>
  `;
  container.prepend(warning);
}

/** Safely save to localStorage with user feedback */
export function safeSaveProgramState(state: ProgramState, container?: HTMLElement): boolean {
  try {
    saveProgramState(state);
    return true;
  } catch {
    if (container) showStorageWarning(container);
    return false;
  }
}

export function safeSaveWorkoutLogs(logs: WorkoutLog[], container?: HTMLElement): boolean {
  try {
    if (logs.length > 200) logs.length = 200;
    saveWorkoutLogs(logs);
    return true;
  } catch {
    if (container) showStorageWarning(container);
    return false;
  }
}

// ─── Styled Confirm Dialog ───

function showConfirmDialog(
  container: HTMLElement,
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void,
): void {
  // Remove any existing dialog
  container.querySelector('.wp-confirm-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'wp-confirm-overlay';
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', title);

  overlay.innerHTML = `
    <div class="wp-confirm-dialog">
      <h4 class="wp-confirm-title">${escapeHtml(title)}</h4>
      <p class="wp-confirm-message">${escapeHtml(message)}</p>
      <div class="wp-confirm-actions">
        <button class="btn wp-confirm-cancel">Cancel</button>
        <button class="btn btn-primary wp-confirm-ok">${escapeHtml(confirmLabel)}</button>
      </div>
    </div>
  `;

  container.appendChild(overlay);

  const okBtn = overlay.querySelector('.wp-confirm-ok') as HTMLButtonElement;
  const cancelBtn = overlay.querySelector('.wp-confirm-cancel') as HTMLButtonElement;

  okBtn.focus();

  const dismiss = () => overlay.remove();
  cancelBtn.addEventListener('click', dismiss);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
  overlay.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); });

  okBtn.addEventListener('click', () => {
    dismiss();
    onConfirm();
  });
}

// ─── Transition Card ───

function renderTransitionCard(transition: TransitionRecommendation): string {
  const isUrgent = transition.urgency === 'now';
  const urgencyClass = isUrgent ? 'wp-alert-danger' : 'wp-alert-warning';
  const heading = isUrgent ? 'Time to Level Up' : 'Transition Available';

  let html = `
    <div class="card card--static wp-alert-card ${urgencyClass}">
      <h4 class="section-heading-sm wp-alert-heading">${heading}</h4>
      <p class="wp-transition-reason">${escapeHtml(transition.reason)}</p>
  `;

  if (transition.recommendations.length > 0) {
    html += '<div class="wp-transition-options">';
    for (const rec of transition.recommendations) {
      html += `
        <div class="card program-rec-card wp-transition-card" data-program-id="${escapeHtml(rec.program.id)}" tabindex="0" role="button" aria-label="Switch to ${escapeHtml(rec.program.shortName)}">
          <strong class="wp-rec-name">${escapeHtml(rec.program.shortName)}</strong>
          <span class="wp-rec-meta"> &middot; ${rec.program.daysPerWeek.join('-')} days/wk</span>
          <p class="wp-transition-fit">${escapeHtml(rec.fitReason)}</p>
        </div>
      `;
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function wireUpTransitionCards(container: HTMLElement, state: ProgramState): void {
  container.querySelectorAll<HTMLElement>('.wp-transition-card').forEach(card => {
    const handler = () => {
      const programId = card.dataset.programId;
      if (!programId || !PROGRAMS[programId]) return;
      const profile = loadUserProfile();
      if (!profile) return;
      showConfirmDialog(
        container,
        'Switch Program',
        `Switch to ${PROGRAMS[programId].shortName}? Your current progress will be saved in workout history.`,
        'Switch Program',
        () => {
          const unit = state.weightUnit;
          const newState = initializeProgram(programId, profile, unit);
          // Carry over training maxes from current program
          for (const [lift, tm] of Object.entries(state.trainingMaxes)) {
            if (tm > 0 && !newState.trainingMaxes[lift]) {
              newState.trainingMaxes[lift] = tm;
            }
          }
          saveProgramState(newState);
          renderActiveProgram(container, newState);
        },
      );
    };
    card.addEventListener('click', handler);
    card.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
    });
  });
}

// ─── Schedule Modification Panel ───

function showModificationPanel(container: HTMLElement, state: ProgramState): void {
  const html = `
    <div class="card card--static wp-modify-card">
      <h4 class="section-heading-sm">Modify Your Schedule</h4>
      <p class="wp-modify-desc">Life happens. Adjust your program temporarily without losing progress.</p>

      <div class="wp-modify-options">
        <button class="wp-modify-option" data-modify="vacation">
          <span class="wp-modify-icon">\u2708</span>
          <span class="wp-modify-label">Going on vacation</span>
          <span class="wp-modify-detail">Pause training, auto-deload on return</span>
        </button>

        <button class="wp-modify-option" data-modify="travel">
          <span class="wp-modify-icon">\uD83C\uDFCB</span>
          <span class="wp-modify-label">Limited equipment</span>
          <span class="wp-modify-detail">Switch to bodyweight/dumbbell workouts temporarily</span>
        </button>

        <button class="wp-modify-option" data-modify="frequency">
          <span class="wp-modify-icon">\uD83D\uDCC5</span>
          <span class="wp-modify-label">Fewer days this week</span>
          <span class="wp-modify-detail">Reduce frequency temporarily, keep key lifts</span>
        </button>

        <button class="wp-modify-option" data-modify="deload">
          <span class="wp-modify-icon">\uD83D\uDD04</span>
          <span class="wp-modify-label">I need a deload week</span>
          <span class="wp-modify-detail">Reduce all weights 30-40%, focus on recovery</span>
        </button>
      </div>

      <div id="wp-modify-form" style="display:none;"></div>
    </div>
  `;

  // Insert after program header
  const existing = container.querySelector('.wp-modify-card');
  if (existing) { existing.remove(); return; }

  const header = container.querySelector('.wp-program-header') ?? container.firstElementChild;
  if (header) {
    header.insertAdjacentHTML('afterend', html);
  }

  // Wire up option buttons
  container.querySelectorAll<HTMLButtonElement>('.wp-modify-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.modify;
      showModifyForm(container, state, type ?? '');
    });
  });
}

function showModifyForm(container: HTMLElement, state: ProgramState, type: string): void {
  const formEl = container.querySelector('#wp-modify-form') as HTMLElement;
  if (!formEl) return;
  formEl.style.display = 'block';

  switch (type) {
    case 'vacation': {
      formEl.innerHTML = `
        <div class="wp-modify-subform">
          <label class="form-label">How many weeks?</label>
          <select id="wp-vacation-weeks" class="form-select">
            <option value="1">1 week</option>
            <option value="2" selected>2 weeks</option>
            <option value="3">3 weeks</option>
            <option value="4">4 weeks</option>
          </select>
          <p class="wp-modify-note">Your program will pause. When you return, you'll start with a deload week at 80% to rebuild safely.</p>
          <button id="wp-apply-vacation" class="btn btn-primary wp-full-width-btn">Apply Vacation</button>
        </div>
      `;
      document.getElementById('wp-apply-vacation')?.addEventListener('click', () => {
        const weeks = parseInt((document.getElementById('wp-vacation-weeks') as HTMLSelectElement).value, 10);
        applyScheduleOverride(state, {
          startWeek: state.currentWeek,
          durationWeeks: weeks,
          type: 'vacation',
          description: `Vacation: ${weeks} week(s) off training`,
        });
        renderActiveProgram(container, state);
      });
      break;
    }

    case 'travel': {
      formEl.innerHTML = `
        <div class="wp-modify-subform">
          <label class="form-label">What equipment do you have?</label>
          <select id="wp-travel-equipment" class="form-select">
            <option value="bodyweight">Bodyweight only</option>
            <option value="dumbbells">Dumbbells / hotel gym</option>
            <option value="barbell_home">Barbell + rack</option>
          </select>
          <label class="form-label">How many weeks?</label>
          <select id="wp-travel-weeks" class="form-select">
            <option value="1">1 week</option>
            <option value="2" selected>2 weeks</option>
            <option value="3">3 weeks</option>
            <option value="4">4 weeks</option>
            <option value="6">6 weeks</option>
            <option value="8">8 weeks</option>
          </select>
          <p class="wp-modify-note">Your workouts will switch to full-body sessions using available equipment. Higher reps compensate for lighter loads. Normal program resumes automatically.</p>
          <button id="wp-apply-travel" class="btn btn-primary wp-full-width-btn">Apply Equipment Change</button>
        </div>
      `;
      document.getElementById('wp-apply-travel')?.addEventListener('click', () => {
        const equipment = (document.getElementById('wp-travel-equipment') as HTMLSelectElement).value;
        const weeks = parseInt((document.getElementById('wp-travel-weeks') as HTMLSelectElement).value, 10);
        applyScheduleOverride(state, {
          startWeek: state.currentWeek,
          durationWeeks: weeks,
          type: 'travel_light',
          equipment,
          description: `Travel mode: ${equipment} for ${weeks} week(s)`,
        });
        renderActiveProgram(container, state);
      });
      break;
    }

    case 'frequency': {
      formEl.innerHTML = `
        <div class="wp-modify-subform">
          <label class="form-label">How many days can you train this week?</label>
          <select id="wp-freq-days" class="form-select">
            <option value="1">1 day</option>
            <option value="2" selected>2 days</option>
            <option value="3">3 days</option>
          </select>
          <p class="wp-modify-note">We'll prioritize the most important lifts for your reduced schedule. Compound movements first.</p>
          <button id="wp-apply-freq" class="btn btn-primary wp-full-width-btn">Apply for This Week</button>
        </div>
      `;
      document.getElementById('wp-apply-freq')?.addEventListener('click', () => {
        const days = parseInt((document.getElementById('wp-freq-days') as HTMLSelectElement).value, 10);
        applyScheduleOverride(state, {
          startWeek: state.currentWeek,
          durationWeeks: 1,
          type: 'reduced_frequency',
          daysPerWeek: days,
          description: `Reduced to ${days} day(s) this week`,
        });
        renderActiveProgram(container, state);
      });
      break;
    }

    case 'deload': {
      // Immediately apply deload
      for (const progress of Object.values(state.liftProgress)) {
        progress.currentWeight = roundToPlate(progress.currentWeight * 0.65, progress.unit);
      }
      saveProgramState(state);
      renderActiveProgram(container, state);
      break;
    }
  }
}

function applyScheduleOverride(state: ProgramState, override: ScheduleOverride): void {
  if (!state.scheduleOverrides) state.scheduleOverrides = [];
  state.scheduleOverrides.push(override);
  saveProgramState(state);
}

// ─── Readiness Questionnaire ───

function renderReadinessCard(existingReadiness: ReadinessData | null, workoutsCompleted: number = 0): string {
  const tooEarlyForReadiness = workoutsCompleted < 5 && existingReadiness === null;
  const isOpen = !tooEarlyForReadiness && existingReadiness === null;
  const summaryText = existingReadiness
    ? `Pre-Workout Readiness (completed: sleep ${existingReadiness.sleepHours}h, quality ${existingReadiness.sleepQuality}/5)`
    : 'Pre-Workout Readiness Check';

  if (tooEarlyForReadiness) {
    return `
      <details class="card card--static wp-readiness-card">
        <summary class="wp-science-summary">${escapeHtml(summaryText)}</summary>
        <p class="wp-note-text wp-readiness-early-msg">Track your readiness after your first 5 workouts.</p>
      </details>
    `;
  }

  let html = `
    <details class="card card--static wp-readiness-card" ${isOpen ? 'open' : ''}>
      <summary class="wp-science-summary">${escapeHtml(summaryText)}</summary>
      <form id="wp-readiness-form" class="wp-readiness-form">
        <div class="form-group">
          <label for="wp-sleep-hours" class="form-label">Hours of sleep last night</label>
          <input type="number" id="wp-sleep-hours" class="form-input" min="0" max="14" step="0.5"
            value="${existingReadiness?.sleepHours ?? ''}" placeholder="e.g. 7.5" />
        </div>

        <div class="form-group">
          <label class="form-label">Sleep quality</label>
          <div class="wp-readiness-scale" role="radiogroup" aria-label="Sleep quality">
  `;
  for (let i = 1; i <= 5; i++) {
    const labels = ['Poor', 'Below avg', 'Average', 'Good', 'Excellent'];
    const checked = existingReadiness?.sleepQuality === i ? 'checked' : '';
    html += `
      <input type="radio" name="wp-sleep-quality" id="wp-sq-${i}" value="${i}" ${checked} class="wp-scale-input" />
      <label for="wp-sq-${i}" class="wp-scale-label" tabindex="-1">${i}<span class="wp-scale-hint">${labels[i - 1]}</span></label>
    `;
  }
  html += `</div></div>

        <div class="form-group">
          <label class="form-label">Stress level</label>
          <div class="wp-readiness-scale" role="radiogroup" aria-label="Stress level">
  `;
  for (let i = 1; i <= 5; i++) {
    const labels = ['Very low', 'Low', 'Moderate', 'High', 'Very high'];
    const checked = existingReadiness?.stress === i ? 'checked' : '';
    html += `
      <input type="radio" name="wp-stress" id="wp-st-${i}" value="${i}" ${checked} class="wp-scale-input" />
      <label for="wp-st-${i}" class="wp-scale-label" tabindex="-1">${i}<span class="wp-scale-hint">${labels[i - 1]}</span></label>
    `;
  }
  html += `</div></div>

        <div class="form-group">
          <label class="form-label">Muscle soreness</label>
          <div class="wp-readiness-scale" role="radiogroup" aria-label="Muscle soreness">
  `;
  for (let i = 1; i <= 5; i++) {
    const checked = existingReadiness?.soreness === i ? 'checked' : '';
    html += `
      <input type="radio" name="wp-soreness" id="wp-so-${i}" value="${i}" ${checked} class="wp-scale-input" />
      <label for="wp-so-${i}" class="wp-scale-label" tabindex="-1">${i}<span class="wp-scale-hint">${SORENESS_LABELS[i - 1]}</span></label>
    `;
  }
  html += `</div></div>

        <div class="form-group">
          <label class="form-label">Motivation to train</label>
          <div class="wp-readiness-scale" role="radiogroup" aria-label="Motivation">
  `;
  for (let i = 1; i <= 5; i++) {
    const labels = ['Very low', 'Low', 'Moderate', 'High', 'Fired up'];
    const checked = existingReadiness?.motivation === i ? 'checked' : '';
    html += `
      <input type="radio" name="wp-motivation" id="wp-mo-${i}" value="${i}" ${checked} class="wp-scale-input" />
      <label for="wp-mo-${i}" class="wp-scale-label" tabindex="-1">${i}<span class="wp-scale-hint">${labels[i - 1]}</span></label>
    `;
  }
  html += `</div></div>

        <button type="submit" class="btn btn-primary wp-full-width-btn">
          ${existingReadiness ? 'Update Readiness' : 'Save Readiness'}
        </button>
      </form>
    </details>
  `;

  return html;
}

function wireUpReadinessForm(container: HTMLElement): void {
  const form = container.querySelector('#wp-readiness-form') as HTMLFormElement | null;
  if (!form) return;

  form.addEventListener('submit', (e: Event) => {
    e.preventDefault();

    const sleepHours = parseFloat((form.querySelector('#wp-sleep-hours') as HTMLInputElement).value) || 0;
    const sleepQuality = parseInt(
      (form.querySelector('input[name="wp-sleep-quality"]:checked') as HTMLInputElement | null)?.value ?? '0', 10,
    );
    const stress = parseInt(
      (form.querySelector('input[name="wp-stress"]:checked') as HTMLInputElement | null)?.value ?? '0', 10,
    );
    const soreness = parseInt(
      (form.querySelector('input[name="wp-soreness"]:checked') as HTMLInputElement | null)?.value ?? '0', 10,
    );
    const motivation = parseInt(
      (form.querySelector('input[name="wp-motivation"]:checked') as HTMLInputElement | null)?.value ?? '0', 10,
    );

    if (!sleepQuality || !stress || !soreness || !motivation) {
      // Highlight missing field groups
      const fields: Array<[string, number]> = [
        ['wp-sleep-quality', sleepQuality],
        ['wp-stress', stress],
        ['wp-soreness', soreness],
        ['wp-motivation', motivation],
      ];
      for (const [name, val] of fields) {
        const group = form.querySelector(`input[name="${name}"]`)?.closest('.form-group');
        if (group) {
          if (!val) {
            (group as HTMLElement).classList.add('wp-field-error');
          } else {
            (group as HTMLElement).classList.remove('wp-field-error');
          }
        }
      }
      // Show validation message
      let msg = form.querySelector('.wp-readiness-error');
      if (!msg) {
        msg = document.createElement('p');
        msg.className = 'wp-readiness-error wp-note-text wp-error-text';
        form.querySelector('button[type="submit"]')?.before(msg);
      }
      msg.textContent = 'Please complete all rating scales before saving.';
      return;
    }

    const readiness: ReadinessData = { sleepHours, sleepQuality, stress, soreness, motivation };
    saveTodayReadiness(readiness);

    // Collapse and update summary
    const details = form.closest('details') as HTMLDetailsElement;
    if (details) {
      details.open = false;
      const summary = details.querySelector('summary');
      if (summary) {
        summary.textContent = `Pre-Workout Readiness (completed: sleep ${sleepHours}h, quality ${sleepQuality}/5)`;
      }
    }
  });

  // WAI-ARIA radio group arrow-key navigation
  wireUpRadioGroupArrowKeys(form);
}

/** Add arrow-key navigation within [role="radiogroup"] containers (WAI-ARIA pattern) */
function wireUpRadioGroupArrowKeys(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('[role="radiogroup"]').forEach(group => {
    const radios = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    if (radios.length === 0) return;

    group.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();

      const currentIdx = radios.findIndex(r => r === document.activeElement || r === (document.activeElement as HTMLElement)?.previousElementSibling);
      const checkedIdx = radios.findIndex(r => r.checked);
      const baseIdx = currentIdx >= 0 ? currentIdx : checkedIdx >= 0 ? checkedIdx : 0;

      let nextIdx: number;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        nextIdx = (baseIdx + 1) % radios.length;
      } else {
        nextIdx = (baseIdx - 1 + radios.length) % radios.length;
      }

      radios[nextIdx].checked = true;
      radios[nextIdx].dispatchEvent(new Event('change', { bubbles: true }));
      // Focus the visible label (next sibling)
      const label = radios[nextIdx].nextElementSibling as HTMLElement | null;
      if (label) label.focus();
    });
  });
}

// ─── Main Initialization ───

export function initWorkoutPlanner(): void {
  const container = document.getElementById('workout-planner-section');
  if (!container) return;

  const state = loadProgramState();
  const profile = loadUserProfile();

  if (state && PROGRAMS[state.programId]) {
    renderActiveProgram(container, state);
  } else {
    renderProgramSetup(container, profile, renderActiveProgram);
  }
}

// ─── Active Program View ───

function renderActiveProgram(container: HTMLElement, state: ProgramState): void {
  // Clean up any active timer before re-rendering
  getActiveRestTimer()?.stop();

  container.innerHTML = '';

  const program = PROGRAMS[state.programId];
  if (!program) {
    renderProgramSetup(container, loadUserProfile(), renderActiveProgram);
    return;
  }

  const workout = generateWorkout(state);
  if (!workout) {
    container.innerHTML = `
      <div class="card card--static">
        <h3 class="section-heading-sm">Unable to Generate Workout</h3>
        <p class="wp-note-text">Something went wrong generating today's workout. Try changing your program.</p>
        <button id="wp-reset-program" class="btn btn-primary wp-full-width-btn">Choose New Program</button>
      </div>
    `;
    const resetBtn = container.querySelector('#wp-reset-program');
    resetBtn?.addEventListener('click', () => {
      localStorage.removeItem('squat_form_program_state');
      renderProgramSetup(container, loadUserProfile(), renderActiveProgram);
    });
    return;
  }

  // Check for autoregulation messages
  const logs = loadWorkoutLogs();
  const autoregMessages = autoregulate(state, logs);
  safeSaveProgramState(state, container);

  // Check for transition recommendations
  const profile = loadUserProfile();
  const transition = profile ? getTransitionRecommendations(state, profile) : null;

  // Build the UI
  let html = '';

  // Program header
  const progressionLabel = PROGRESSION_LABELS[program.progression.type] ?? program.progression.type.replace(/_/g, ' ');

  // Meet date countdown
  let meetCountdownHtml = '';
  if (profile?.meetDate) {
    const now = new Date();
    const meet = new Date(profile.meetDate);
    const diffMs = meet.getTime() - now.getTime();
    const weeksOut = Math.max(0, Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000)));
    if (weeksOut > 0) {
      meetCountdownHtml = `<div class="wp-meet-countdown">${weeksOut} week${weeksOut !== 1 ? 's' : ''} to competition</div>`;
    }
  }

  html += `
    <div class="card card--static wp-program-header">
      <div class="wp-header-row">
        <div>
          <h3 class="section-heading-sm wp-program-name">${escapeHtml(program.shortName)}</h3>
          <div class="wp-header-meta">
            ${escapeHtml(workout.weekLabel)} &middot; Workout ${state.workoutsCompleted + 1}
          </div>
          ${meetCountdownHtml}
        </div>
        <div class="wp-header-btns">
          <button id="wp-modify-schedule" class="btn wp-ghost-btn">Modify Schedule</button>
          <button id="wp-change-program" class="btn wp-ghost-btn">Change Program</button>
        </div>
      </div>
      <div class="wp-header-details">
        <span>${profile?.experienceLevel === 'beginner' ? 'How you progress' : 'Progression'}: ${escapeHtml(progressionLabel)}</span>
        <span>&middot;</span>
        <span>${profile?.experienceLevel === 'beginner' ? 'Recovery week' : 'Deload'}: ${escapeHtml(program.deload.frequency)}</span>
      </div>
    </div>
  `;

  // First-workout walkthrough guide
  if (state.workoutsCompleted === 0) {
    html += `
      <div class="card card--static wp-first-workout-guide" style="border-color: var(--accent); background: var(--accent-glow);">
        <h4 class="section-heading-sm" style="color: var(--accent);">Your First Workout</h4>
        <ol style="font-size: var(--font-sm); color: var(--text-secondary); line-height: 1.8; padding-left: 1.5rem;">
          <li><strong>Warm up</strong> — Grey rows are warm-up sets. Do them to prepare your body.</li>
          <li><strong>Enter weight</strong> — Use the +/- buttons or type directly. The app suggests weights based on your profile.</li>
          <li><strong>Do your set</strong> — Perform the prescribed reps with good form.</li>
          <li><strong>Tap "Log"</strong> — Records the set and starts your rest timer automatically.</li>
          <li><strong>Rest</strong> — The timer counts down. When it says "GO!", start your next set.</li>
          <li><strong>Finish</strong> — After all sets, tap "Finish Workout" to save and see your progress.</li>
        </ol>
        <p style="font-size: var(--font-xs); color: var(--text-muted); margin-top: var(--space-xs);">This guide won't show again after your first workout. You've got this!</p>
      </div>
    `;
  }

  // Autoregulation alerts
  if (autoregMessages.length > 0) {
    const isBeginner = profile?.experienceLevel === 'beginner';
    const autoregHeading = isBeginner
      ? 'We adjusted your weights based on your recent performance'
      : 'Autoregulation Adjustments';
    html += `<div class="card card--static wp-alert-card wp-alert-warning" role="alert">`;
    html += `<h4 class="section-heading-sm wp-alert-heading">${escapeHtml(autoregHeading)}</h4>`;
    for (const msg of autoregMessages) {
      html += `<p class="wp-note-text">${escapeHtml(msg)}</p>`;
    }
    html += `</div>`;
  }

  // Check for active schedule overrides
  if (state.scheduleOverrides?.length) {
    const activeOverride = state.scheduleOverrides.find(o =>
      state.currentWeek >= o.startWeek && state.currentWeek < o.startWeek + o.durationWeeks
    );
    if (activeOverride) {
      const weeksRemaining = (activeOverride.startWeek + activeOverride.durationWeeks) - state.currentWeek;
      html += `
        <div class="card card--static wp-override-banner">
          <strong>${escapeHtml(activeOverride.description)}</strong>
          <span class="wp-override-remaining">${weeksRemaining} week(s) remaining</span>
          <button class="wp-clear-override btn wp-ghost-btn" style="margin-top: var(--space-xs);">End Early &amp; Return to Normal</button>
        </div>
      `;
    }
  }

  // Transition recommendation
  if (transition && transition.urgency !== 'informational') {
    html += renderTransitionCard(transition);
  }

  // Readiness questionnaire (before workout card) — only auto-open after 5 workouts
  const existingReadiness = loadTodayReadiness();
  html += renderReadinessCard(existingReadiness, state.workoutsCompleted);

  // Rest timer bar (rendered as a sibling before the workout card for fixed positioning)
  html += `<div id="wp-timer-spacer" class="wp-timer-spacer"></div>`;
  html += `<div id="wp-rest-timer-bar" class="wp-rest-timer-bar wp-hidden">
    <div class="wp-timer-display">
      <span class="wp-timer-label">Rest</span>
      <span id="wp-timer-time" class="wp-timer-time">0:00</span>
    </div>
    <div class="wp-timer-progress-track">
      <div id="wp-timer-progress" class="wp-timer-progress-fill"></div>
    </div>
    <div class="wp-timer-controls">
      <button class="wp-timer-btn" id="wp-timer-minus30" aria-label="Subtract 30 seconds">-30s</button>
      <button class="wp-timer-btn" id="wp-timer-pause" aria-label="Pause timer">Pause</button>
      <button class="wp-timer-btn" id="wp-timer-plus30" aria-label="Add 30 seconds">+30s</button>
      <button class="wp-timer-btn wp-timer-skip" id="wp-timer-skip" aria-label="Skip rest">Skip</button>
    </div>
  </div>`;

  // Today's workout (from session sub-module)
  html += renderWorkoutCard(workout, state);

  // Notes
  if (workout.notes.length > 0) {
    html += `<div class="card card--static wp-notes-card">`;
    for (const note of workout.notes) {
      html += `<p class="wp-note-text">${addTermTooltips(note)}</p>`;
    }
    html += `</div>`;
  }

  // Accessory recommendations from form analysis (from completion sub-module)
  html += renderAccessoryRecommendations(state);

  // Science basis (collapsible)
  html += `
    <details class="card card--static wp-science-card">
      <summary class="wp-science-summary">Why this program works (evidence basis)</summary>
      <p class="wp-science-body">${escapeHtml(workout.scienceNote)}</p>
      <p class="wp-science-detail">
        Progression: ${escapeHtml(program.progression.description)}
      </p>
      <p class="wp-science-detail">
        Deload: ${escapeHtml(program.deload.method)} (${escapeHtml(program.deload.citation)})
      </p>
    </details>
  `;

  // Training calendar — only show after 3 workouts (from analytics sub-module)
  if (state.workoutsCompleted >= 3) {
    const calNow = new Date();
    const calMonth = buildCalendarMonth(calNow.getFullYear(), calNow.getMonth(), logs);
    const streak = calculateStreak(logs, program.daysPerWeek[0]);
    html += renderCalendarCard(calMonth, streak);
  }

  // Muscle volume tracker — only show after 10 workouts (from analytics sub-module)
  if (state.workoutsCompleted >= 10) {
    const volumeLogs = logs.map(l => ({
      date: l.date,
      sets: l.sets.map(s => ({ exerciseSlot: s.exerciseSlot, completed: s.completed })),
    }));
    const volumes = calculateWeeklyVolume(volumeLogs, 1);
    const undertrained = getUndertrainedMuscles(volumes);
    const overtrained = getOvertrainedMuscles(volumes);
    html += renderVolumeCard(volumes, undertrained, overtrained);

    // Muscle map companion view
    const mapData = volumeToMapData(volumes);
    html += `
      <details class="card card--static wp-volume-card">
        <summary class="wp-volume-summary">
          <span>Muscle Map</span>
        </summary>
        <div class="wp-volume-content">
          ${renderMuscleMap(mapData, 'front', 'week')}
        </div>
      </details>
    `;
  }

  // Progression charts — show after 5 workouts
  if (state.workoutsCompleted >= 5) {
    injectChartStyles();
    const chartLogs = logs.map(l => ({
      date: l.date,
      sets: l.sets.map(s => ({ exerciseSlot: s.exerciseSlot, actualWeight: s.actualWeight, actualReps: s.actualReps, completed: s.completed })),
    }));
    html += `
      <details class="card card--static wp-science-card">
        <summary class="wp-science-summary">Strength Progression</summary>
        <div>${renderProgressionDashboard(chartLogs)}</div>
      </details>
    `;
  }

  // Form weakness report — show if form data exists
  const formWeaknesses = analyzeFormWeaknesses();
  if (formWeaknesses.length > 0) {
    const accessories = getAccessoryRecommendations(formWeaknesses, state.equipment);
    html += `
      <details class="card card--static wp-science-card">
        <summary class="wp-science-summary">Weak Point Analysis</summary>
        <div>${renderWeakPointReport(formWeaknesses, accessories)}</div>
      </details>
    `;
  }

  // Strength Standards card (show if bodyweight known)
  const strengthProfile = loadUserProfile();
  if (strengthProfile?.bodyweight && strengthProfile.bodyweight > 0) {
    const sex = (strengthProfile.sex ?? 'male') as 'male' | 'female';
    const lifts: Record<string, number> = {};
    for (const lift of ['squat', 'bench', 'deadlift', 'ohp']) {
      const tm = state.trainingMaxes?.[lift];
      if (tm && tm > 0) {
        lifts[lift] = Math.round(tm / 0.9); // Convert TM back to estimated 1RM
      }
    }
    if (Object.keys(lifts).length > 0) {
      html += renderStrengthCard(lifts, strengthProfile.bodyweight, sex);
    }
  }

  // Competition Commands reference (collapsible)
  html += `
    <details class="card card--static wp-science-card">
      <summary class="wp-science-summary">Competition Commands Reference</summary>
      <div style="padding: var(--space-sm) 0;">${renderCommandsReference()}</div>
    </details>
  `;

  // RPE Calculator tool
  html += `
    <details class="card card--static wp-rpe-calc-card">
      <summary class="wp-rpe-calc-summary">RPE Calculator</summary>
      <div class="wp-rpe-calc-content">
        <p class="wp-rpe-calc-desc">Enter a set you completed to estimate your 1RM, or enter your 1RM to see target weights for any rep/RPE combo.</p>
        <div class="wp-rpe-calc-inputs">
          <div class="wp-rpe-calc-field">
            <label class="form-label-sm" for="rpe-calc-weight">Weight</label>
            <input type="number" id="rpe-calc-weight" class="form-input" placeholder="225" min="1" max="2000" step="5" />
          </div>
          <div class="wp-rpe-calc-field">
            <label class="form-label-sm" for="rpe-calc-reps">Reps</label>
            <input type="number" id="rpe-calc-reps" class="form-input" placeholder="5" min="1" max="12" step="1" />
          </div>
          <div class="wp-rpe-calc-field">
            <label class="form-label-sm" for="rpe-calc-rpe">RPE</label>
            <select id="rpe-calc-rpe" class="form-select">
              <option value="10">10 (max effort)</option>
              <option value="9.5">9.5</option>
              <option value="9">9 (1 RIR)</option>
              <option value="8.5">8.5</option>
              <option value="8" selected>8 (2 RIR)</option>
              <option value="7.5">7.5</option>
              <option value="7">7 (3 RIR)</option>
              <option value="6.5">6.5</option>
              <option value="6">6 (4+ RIR)</option>
            </select>
          </div>
          <button id="rpe-calc-btn" class="btn btn-primary wp-rpe-calc-btn">Calculate</button>
        </div>
        <div id="rpe-calc-result" class="wp-rpe-calc-result"></div>
      </div>
    </details>
  `;

  // Form Check cross-link card
  html += `
    <div class="card card--static wp-form-check-card">
      <h4 class="section-heading-sm">Form Check</h4>
      <p class="wp-form-check-desc">Upload a video of any lift to get AI-powered form analysis. Results automatically feed into your program adjustments.</p>
      <button id="wp-form-check-btn" class="btn btn-primary wp-full-width-btn">Check My Form</button>
    </div>
  `;

  // Data backup card
  html += `
    <details class="card card--static wp-science-card">
      <summary class="wp-science-summary">Data Backup &amp; Storage</summary>
      <div>${renderBackupCard()}</div>
    </details>
  `;

  container.innerHTML = html;

  // Wire up muscle map interactivity in active program view
  injectMuscleMapStyles();
  container.querySelectorAll<HTMLElement>('.mm-container').forEach(mc => attachMuscleMapListeners(mc));

  // Wire up readiness form
  wireUpReadinessForm(container);

  // Wire up change program button with styled confirmation
  const changeBtn = container.querySelector('#wp-change-program') as HTMLButtonElement;
  if (changeBtn) {
    changeBtn.addEventListener('click', () => {
      showConfirmDialog(
        container,
        'Change Program',
        'Your current progress will be saved in workout history. Start a new program?',
        'Change Program',
        () => {
          localStorage.removeItem('squat_form_program_state');
          renderProgramSetup(container, loadUserProfile(), renderActiveProgram);
        },
      );
    });
  }

  // Wire up modify schedule button
  document.getElementById('wp-modify-schedule')?.addEventListener('click', () => {
    showModificationPanel(container, state);
  });

  // Wire up "End Early" override clear button
  container.querySelector('.wp-clear-override')?.addEventListener('click', () => {
    state.scheduleOverrides = [];
    saveProgramState(state);
    renderActiveProgram(container, state);
  });

  // Wire up RPE calculator
  const rpeCalcBtn = container.querySelector('#rpe-calc-btn');
  if (rpeCalcBtn) {
    rpeCalcBtn.addEventListener('click', () => {
      const weightVal = parseFloat((container.querySelector('#rpe-calc-weight') as HTMLInputElement)?.value ?? '');
      const repsVal = parseInt((container.querySelector('#rpe-calc-reps') as HTMLInputElement)?.value ?? '', 10);
      const rpeVal = parseFloat((container.querySelector('#rpe-calc-rpe') as HTMLSelectElement)?.value ?? '8');
      const resultEl = container.querySelector('#rpe-calc-result') as HTMLElement;
      if (!resultEl) return;

      if (!weightVal || weightVal <= 0 || !repsVal || repsVal < 1) {
        resultEl.innerHTML = '<p style="color:var(--danger);font-size:var(--font-sm);">Enter a weight and reps to calculate.</p>';
        return;
      }

      if (weightVal > 2000) {
        resultEl.innerHTML = '<p style="color:var(--danger);font-size:var(--font-sm);">Weight must be 2000 or less.</p>';
        return;
      }

      if (repsVal > 12) {
        resultEl.innerHTML = '<p style="color:var(--warning);font-size:var(--font-sm);">RPE-based calculations are most accurate for 1\u201312 reps. Results above 12 may be unreliable.</p>';
        return;
      }

      const unit = state.weightUnit ?? 'lbs';
      const calc = calculateE1RMFromRPE(weightVal, repsVal, rpeVal, unit);
      const rpeDesc = getRPEDescription(rpeVal);

      let resultHtml = `
        <div class="wp-rpe-result-hero">
          <div class="wp-rpe-result-label">Estimated 1RM</div>
          <div class="wp-rpe-result-value">${calc.estimated1RM} ${escapeHtml(unit)}</div>
          <div class="wp-rpe-result-detail">From ${weightVal} ${escapeHtml(unit)} \u00d7 ${repsVal} @ RPE ${rpeVal} (${calc.percentOf1RM}% of 1RM)</div>
          <div class="wp-rpe-result-desc">${escapeHtml(rpeDesc)}</div>
        </div>
        <div class="wp-rpe-table-label">What weight for different rep/RPE targets:</div>
        <div class="wp-rpe-table">
          <div class="wp-rpe-table-header">
            <span>Reps</span><span>RPE</span><span>%1RM</span><span>Weight</span>
          </div>
      `;

      for (const row of calc.prescriptionTable) {
        const isCurrentCombo = row.reps === repsVal && row.rpe === rpeVal;
        const rowClass = isCurrentCombo ? 'wp-rpe-row wp-rpe-row-current' : 'wp-rpe-row';
        resultHtml += `
          <div class="${rowClass}">
            <span>${row.reps}</span>
            <span>${row.rpe}</span>
            <span>${row.percent}%</span>
            <span class="wp-rpe-row-weight">${row.weight} ${escapeHtml(unit)}</span>
          </div>
        `;
      }

      resultHtml += `</div>`;
      resultEl.innerHTML = resultHtml;
    });
  }

  // Wire up set completion (from session sub-module)
  wireUpSetLogging(container, state, workout);

  // Wire up "?" demo info buttons to toggle the corresponding <details>
  container.querySelectorAll<HTMLButtonElement>('.wp-demo-info-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.demoTarget;
      if (!targetId) return;
      const details = container.querySelector(`#${targetId}`) as HTMLDetailsElement | null;
      if (details) {
        details.open = !details.open;
      }
    });
  });

  // Restore in-progress workout data (if any)
  restoreInProgressWorkout(container);

  // Wire up complete workout button
  const completeBtn = container.querySelector('#wp-complete-workout') as HTMLButtonElement;
  if (completeBtn) {
    completeBtn.addEventListener('click', () => {
      const checkedCount = container.querySelectorAll<HTMLInputElement>('.set-complete-cb:checked').length;
      const totalCount = container.querySelectorAll('.set-complete-cb').length;
      if (checkedCount === 0) {
        showConfirmDialog(
          container,
          'No Sets Logged',
          'You haven\'t checked off any sets. Are you sure you want to complete this workout with no sets recorded?',
          'Complete Anyway',
          () => completeWorkout(container, state, workout, renderActiveProgram),
        );
      } else if (checkedCount < totalCount) {
        showConfirmDialog(
          container,
          'Incomplete Workout',
          `You completed ${checkedCount} of ${totalCount} sets. Unchecked sets will be recorded as skipped. Continue?`,
          'Complete Workout',
          () => completeWorkout(container, state, workout, renderActiveProgram),
        );
      } else {
        completeWorkout(container, state, workout, renderActiveProgram);
      }
    });
  }

  // Wire up transition option cards
  wireUpTransitionCards(container, state);

  // Wire up "Check My Form" button to switch to upload tab
  const formCheckBtn = container.querySelector('#wp-form-check-btn');
  if (formCheckBtn) {
    formCheckBtn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('switch-mode', { detail: 'upload' }));
    });
  }
}

// ─── CSS for Workout Planner ───

export function injectWorkoutPlannerStyles(): void {
  if (document.getElementById('workout-planner-styles')) return;

  const style = document.createElement('style');
  style.id = 'workout-planner-styles';
  style.textContent = `
    /* ===== Form Elements ===== */
    .form-label {
      display: block;
      font-size: var(--font-sm);
      color: var(--text-secondary);
      margin-bottom: var(--space-xs);
      font-weight: 500;
    }
    .form-label-sm {
      display: block;
      font-size: var(--font-xs);
      color: var(--text-muted);
      margin-bottom: 2px;
    }
    .form-select {
      width: 100%;
      padding: var(--space-sm) var(--space-md);
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--bg-input);
      color: var(--text-primary);
      font-size: var(--font-sm);
      appearance: none;
      cursor: pointer;
    }
    .form-select:focus {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
    .form-input {
      width: 100%;
      padding: var(--space-xs) var(--space-sm);
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--bg-input);
      color: var(--text-primary);
      font-size: var(--font-sm);
    }
    .form-input:focus {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
    }

    /* ===== Setup Form ===== */
    .wp-setup-heading { margin-bottom: var(--space-md); font-size: var(--font-lg); color: var(--text-primary); }
    .wp-setup-desc { margin-bottom: var(--space-lg); }
    .wp-setup-form { display: grid; gap: var(--space-md); }
    .wp-maxes-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-sm); }
    .wp-unit-row { display: flex; align-items: center; gap: var(--space-sm); margin-top: var(--space-xs); }
    .wp-radio-label { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; padding: var(--space-xs) var(--space-sm); cursor: pointer; font-size: var(--font-sm); color: var(--text-secondary); border-radius: var(--radius-sm); transition: background var(--transition-fast); }
    .wp-radio-label:hover { background: var(--bg-card-hover); }
    .wp-bw-row { display: flex; gap: var(--space-sm); align-items: center; }
    .wp-bw-unit { color: var(--text-muted); font-size: var(--font-sm); }
    .wp-readiness-early-msg { margin-top: var(--space-sm); }
    .wp-find-btn { margin-top: var(--space-sm); }
    .wp-advanced-options { margin-top: var(--space-xs); }
    .wp-advanced-summary { cursor: pointer; color: var(--accent); font-size: var(--font-sm); font-weight: 500; padding: var(--space-sm) 0; list-style: none; }
    .wp-advanced-summary::-webkit-details-marker { display: none; }
    .wp-advanced-summary::before { content: '+ '; }
    .wp-advanced-options[open] > .wp-advanced-summary::before { content: '- '; }
    .wp-advanced-grid { display: grid; gap: var(--space-md); margin-top: var(--space-sm); }
    .wp-custom-section-details { margin-top: var(--space-lg); }
    .wp-custom-divider-summary { cursor: pointer; color: var(--text-muted); font-size: var(--font-sm); font-weight: 500; text-align: center; padding: var(--space-sm) 0; list-style: none; border-top: 1px solid var(--border); padding-top: var(--space-md); }
    .wp-custom-divider-summary::-webkit-details-marker { display: none; }

    /* ===== Recommendations ===== */
    .wp-recommendations { display: none; margin-top: var(--space-lg); }
    .wp-recs-heading { margin-bottom: var(--space-md); }
    .wp-no-match-card { border-color: var(--warning); }
    .program-rec-card { margin-bottom: var(--space-md); cursor: pointer; border: 1px solid var(--border); transition: border-color var(--transition-fast), box-shadow var(--transition-fast); }
    .program-rec-card:hover, .program-rec-card:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
    .wp-rec-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--space-xs); }
    .wp-rec-name { color: var(--text-primary); font-size: var(--font-lg); font-weight: 600; }
    .wp-rec-meta { color: var(--text-muted); font-size: var(--font-xs); margin-bottom: var(--space-xs); }
    .wp-rec-desc { color: var(--text-secondary); font-size: var(--font-sm); margin-bottom: var(--space-sm); }
    .wp-best-match { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 2px 12px var(--accent-glow); }
    .wp-best-match-badge { display: inline-block; font-size: var(--font-2xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--bg-primary); background: var(--accent); padding: 2px var(--space-sm); border-radius: var(--radius-sm); margin-bottom: var(--space-xs); }
    .wp-level-beginner { background: var(--success); }
    .wp-level-intermediate { background: var(--warning); }
    .wp-level-advanced { background: var(--danger); }
    .wp-beginner-recs-note { color: var(--text-muted); font-size: var(--font-sm); text-align: center; margin: var(--space-sm) 0 var(--space-xs); }
    .wp-see-all-link { display: block; margin: 0 auto var(--space-md); background: none; border: none; color: var(--accent); font-size: var(--font-sm); cursor: pointer; text-decoration: underline; padding: var(--space-xs) var(--space-sm); }
    .wp-see-all-link:hover { color: var(--text-primary); }

    /* ===== Science Details ===== */
    .wp-science-details { font-size: var(--font-xs); color: var(--text-muted); }
    .wp-science-summary { cursor: pointer; color: var(--accent); font-size: var(--font-sm); }
    .wp-science-text { margin-top: var(--space-xs); line-height: 1.5; }
    .wp-science-card { margin-top: var(--space-md); }
    .wp-science-body { margin-top: var(--space-sm); font-size: var(--font-sm); color: var(--text-secondary); line-height: 1.6; }
    .wp-science-detail { margin-top: var(--space-xs); font-size: var(--font-xs); color: var(--text-muted); }

    /* ===== Program Header ===== */
    .wp-program-header { margin-bottom: var(--space-md); }
    .wp-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-sm); }
    .wp-program-name { margin: 0; font-size: var(--font-lg); color: var(--text-primary); }
    .wp-header-meta { color: var(--text-muted); font-size: var(--font-xs); }
    .wp-header-details { display: flex; gap: var(--space-sm); flex-wrap: wrap; font-size: var(--font-xs); color: var(--text-secondary); }
    .wp-ghost-btn { background: transparent; color: var(--accent); border: 1px solid var(--accent); padding: var(--space-xs) var(--space-sm); border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-xs); transition: background var(--transition-fast); }
    .wp-ghost-btn:hover { background: var(--accent-glow); }

    /* ===== Alert Cards ===== */
    .wp-alert-card { margin-bottom: var(--space-md); }
    .wp-alert-warning { border-color: var(--warning); }
    .wp-alert-danger { border-color: var(--danger); }
    .wp-alert-heading { color: inherit; }
    .wp-alert-warning .wp-alert-heading { color: var(--warning); }
    .wp-alert-danger .wp-alert-heading { color: var(--danger); }

    /* ===== Workout Card ===== */
    .wp-workout-card { margin-top: var(--space-md); }
    .wp-day-heading { margin-bottom: var(--space-sm); }
    .wp-exercise-block { margin-bottom: var(--space-md); padding: var(--space-sm); border: 1px solid var(--border); border-radius: var(--radius-sm); }
    .wp-exercise-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-xs); }
    .wp-exercise-name { color: var(--text-primary); font-size: var(--font-sm); }
    .wp-accessory-badge { font-size: var(--font-2xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .wp-exercise-notes { font-size: var(--font-xs); color: var(--text-muted); margin-bottom: var(--space-xs); }
    .wp-exercise-demo { margin: var(--space-xs) 0; }
    .wp-demo-toggle { cursor: pointer; color: var(--accent); font-size: var(--font-xs); padding: 2px 0; }
    .wp-demo-toggle:hover { text-decoration: underline; }
    .wp-demo-content { padding: var(--space-sm); background: var(--bg-input); border-radius: var(--radius-sm); margin-top: var(--space-xs); font-size: var(--font-xs); }
    .wp-demo-gif { width: 100%; max-width: 300px; border-radius: var(--radius-sm); margin-bottom: var(--space-sm); display: block; }
    .wp-demo-steps-list { padding-left: 1.2rem; line-height: 1.6; color: var(--text-secondary); margin: var(--space-xs) 0; }
    .wp-demo-cues { display: flex; flex-wrap: wrap; gap: var(--space-xs); margin: var(--space-sm) 0; }
    .wp-demo-cue { padding: 2px 8px; background: var(--accent-glow); border: 1px solid var(--accent-dim); border-radius: 999px; color: var(--accent); font-size: var(--font-2xs); white-space: nowrap; }
    .wp-demo-video-link { display: inline-block; margin-top: var(--space-xs); color: var(--accent); font-size: var(--font-xs); text-decoration: none; }
    .wp-demo-video-link:hover { text-decoration: underline; }
    .wp-demo-video-link::before { content: '\\25B6 '; }
    .wp-demo-mistakes-list { padding-left: 1.2rem; line-height: 1.6; color: var(--text-secondary); margin: var(--space-xs) 0; list-style: disc; }
    .wp-demo-mistakes-list li { margin-bottom: 2px; }
    .wp-demo-mistakes { margin: var(--space-sm) 0; }
    .wp-exercise-header-right { display: flex; align-items: center; gap: var(--space-xs); }
    .wp-demo-info-btn { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--accent-dim); background: var(--accent-glow); color: var(--accent); font-size: var(--font-sm); font-weight: 700; cursor: pointer; padding: 0; line-height: 1; flex-shrink: 0; -webkit-tap-highlight-color: transparent; }
    .wp-demo-info-btn:hover { background: var(--accent); color: var(--bg-primary); }
    .wp-condition-group { margin-bottom: var(--space-xs); }
    .wp-condition-group-label { font-size: var(--font-2xs); font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 2px; }
    .wp-condition-checkbox-label { display: flex; align-items: center; gap: var(--space-xs); font-size: var(--font-xs); color: var(--text-secondary); cursor: pointer; padding: 2px 0; }
    .wp-condition-cb { accent-color: var(--accent); }
    .wp-conditions-list { max-height: 200px; overflow-y: auto; padding: var(--space-xs); background: var(--bg-input); border-radius: var(--radius-sm); border: 1px solid var(--border); }
    .wp-sets-list { display: grid; gap: 2px; }

    /* ===== Set Rows ===== */
    .wp-set-row { display: grid; grid-template-columns: 28px 1fr auto; gap: var(--space-sm); align-items: center; padding: var(--space-xs) var(--space-xs); font-size: var(--font-sm); cursor: pointer; border-radius: var(--radius-sm); transition: opacity var(--transition-fast), background var(--transition-fast); min-height: 44px; }
    .wp-set-row:hover { background: var(--bg-card-hover); }
    .wp-set-completed { opacity: 0.5; text-decoration: line-through; }

    /* ===== In-Workout Set Tracker ===== */
    .wp-sets-tracker { margin-top: var(--space-xs); }
    .wp-sets-header { display: grid; grid-template-columns: 3.5rem 1fr 1fr 3rem 3rem; gap: var(--space-xs); padding: var(--space-xs) 0; font-size: var(--font-2xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); }
    .wp-set-tracker-row { display: grid; grid-template-columns: 3.5rem 1fr 1fr 3rem 3rem; gap: var(--space-xs); align-items: center; padding: var(--space-xs) 0; border-bottom: 1px solid var(--border); min-height: 48px; transition: background var(--transition-fast), opacity var(--transition-fast); }
    .wp-set-tracker-row[data-status="logged"] { background: var(--accent-glow); }
    .wp-set-logged { opacity: 0.7; }
    .wp-st-set { font-size: var(--font-sm); color: var(--text-secondary); display: flex; align-items: center; gap: 2px; flex-wrap: wrap; }
    .wp-pct-label { font-size: var(--font-2xs); color: var(--text-muted); display: block; }
    .wp-input-weight, .wp-input-reps { width: 100%; padding: 6px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); font-size: var(--font-sm); font-weight: 600; text-align: center; -moz-appearance: textfield; min-height: 44px; }
    .wp-input-weight::-webkit-inner-spin-button, .wp-input-reps::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .wp-input-weight:focus, .wp-input-reps:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
    .wp-input-weight[readonly], .wp-input-reps[readonly] { opacity: 0.6; background: transparent; border-color: transparent; }
    .wp-input-error { border-color: var(--danger); animation: wp-shake 0.3s; }
    @keyframes wp-shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }

    /* ===== Stepper Controls ===== */
    .wp-stepper { display: flex; align-items: center; gap: 2px; }
    .wp-step-btn { display: flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; padding: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-card); color: var(--text-secondary); font-size: var(--font-lg); font-weight: 700; cursor: pointer; user-select: none; -webkit-user-select: none; transition: background var(--transition-fast), border-color var(--transition-fast); flex-shrink: 0; }
    .wp-step-btn:hover { background: var(--bg-card-hover); border-color: var(--accent); }
    .wp-step-btn:active { background: var(--accent-glow); transform: scale(0.95); }
    .wp-stepper .wp-input-weight, .wp-stepper .wp-input-reps { flex: 1; min-width: 0; }
    .wp-input-rpe { width: 100%; padding: 4px 2px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); font-size: var(--font-xs); text-align: center; min-height: 44px; cursor: pointer; }
    .wp-log-set-btn { width: 100%; min-height: 44px; padding: 4px; border: none; border-radius: var(--radius-sm); background: var(--accent); color: var(--bg-primary); font-size: var(--font-sm); font-weight: 700; cursor: pointer; transition: background var(--transition-fast), transform var(--transition-fast); }
    .wp-log-set-btn:hover:not(:disabled) { background: var(--accent-hover); transform: scale(1.05); }
    .wp-log-set-btn:active:not(:disabled) { transform: scale(0.95); }
    .wp-logged-check { background: var(--success); cursor: default; }
    .wp-prev-hint { font-size: var(--font-xs); color: var(--text-muted); padding: 2px 0 4px; font-style: italic; }

    /* ===== Rest Timer Bar ===== */
    .wp-hidden { display: none !important; }
    .wp-rest-timer-bar { display: flex; flex-direction: column; gap: var(--space-xs); padding: var(--space-sm) var(--space-md); margin: var(--space-sm) 0; border-radius: var(--radius-md); background: var(--bg-input); border: 1px solid var(--accent-dim); position: static; z-index: 10; }
    .wp-rest-timer-bar.wp-timer-active, .wp-rest-timer-bar.wp-timer-done { position: fixed; top: 0; left: 0; right: 0; margin: 0; border-radius: 0; z-index: 50; padding-top: env(safe-area-inset-top); }
    .wp-timer-spacer { height: 0; transition: height var(--transition-fast); }
    .wp-timer-spacer.wp-timer-spacer-active { height: 90px; }
    .wp-timer-active { border-color: var(--accent); box-shadow: 0 0 12px var(--accent-glow); }
    .wp-timer-done { border-color: var(--success); background: rgba(74, 222, 128, 0.1); }
    .wp-timer-display { display: flex; align-items: center; justify-content: center; gap: var(--space-sm); }
    .wp-timer-label { font-size: var(--font-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; }
    .wp-timer-time { font-size: var(--font-xl); font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; min-width: 4ch; text-align: center; }
    .wp-timer-done .wp-timer-time { color: var(--success); animation: wp-pulse 0.6s ease-in-out 3; }
    @keyframes wp-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.15); } }
    .wp-timer-progress-track { height: 4px; border-radius: 2px; background: var(--border); overflow: hidden; }
    .wp-timer-progress-fill { height: 100%; border-radius: 2px; background: var(--accent); transition: width 1s linear; }
    .wp-timer-progress-fill.wp-timer-warning { background: var(--warning); }
    .wp-timer-progress-fill.wp-timer-urgent { background: var(--danger); animation: wp-pulse-bar 0.5s infinite; }
    @keyframes wp-pulse-bar { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
    .wp-timer-controls { display: flex; justify-content: center; gap: var(--space-xs); }
    .wp-timer-btn { padding: 4px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-card); color: var(--text-secondary); font-size: var(--font-xs); cursor: pointer; min-height: 44px; min-width: 44px; transition: background var(--transition-fast); }
    .wp-timer-btn:hover { background: var(--bg-card-hover); }
    .wp-timer-skip { color: var(--accent); border-color: var(--accent-dim); }

    /* ===== Mobile Optimization for Tracker ===== */
    @media (max-width: 500px) {
      .wp-sets-header { grid-template-columns: 2.5rem 1fr 1fr 3rem; font-size: 0.55rem; }
      .wp-sh-rpe { display: none; }
      .wp-set-tracker-row { grid-template-columns: 2.5rem 1fr 1fr 3rem; flex-wrap: wrap; }
      .wp-st-rpe { display: none; }
      .wp-input-weight, .wp-input-reps { padding: 4px 4px; font-size: var(--font-sm); min-width: 0; }
      .wp-log-set-btn { font-size: var(--font-xs); padding: 4px 2px; }
      .wp-timer-controls { flex-wrap: wrap; }
      .wp-step-btn { min-width: 44px; min-height: 44px; padding: 2px; font-size: var(--font-sm); }
      .wp-stepper { gap: 2px; }
    }

    .wp-set-meta { color: var(--text-muted); font-size: var(--font-xs); white-space: nowrap; grid-column: 3; }
    .wp-set-note { font-size: var(--font-2xs); color: var(--text-muted); padding-left: calc(28px + var(--space-sm)); margin-bottom: 2px; }
    .wp-amrap-badge { color: var(--accent); font-weight: 600; }
    .wp-amrap-input { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-xs) 0 var(--space-xs) calc(28px + var(--space-sm)); }
    .wp-amrap-reps-input { width: 80px; text-align: center; }

    /* ===== Complete Workout Button ===== */
    .wp-full-width-btn { width: 100%; }
    .wp-complete-btn { margin-top: var(--space-md); }

    /* ===== Notes Card ===== */
    .wp-notes-card { margin-top: var(--space-md); }
    .wp-note-text { font-size: var(--font-sm); color: var(--text-secondary); margin-bottom: var(--space-xs); line-height: 1.5; }

    /* ===== Transition Cards ===== */
    .wp-transition-reason { font-size: var(--font-sm); color: var(--text-secondary); margin-bottom: var(--space-md); }
    .wp-transition-options { display: grid; gap: var(--space-sm); }
    .wp-transition-card { padding: var(--space-sm); }
    .wp-transition-fit { font-size: var(--font-xs); color: var(--text-secondary); margin-top: var(--space-xs); }

    /* ===== Completion Screen ===== */
    .wp-complete-card { text-align: center; margin-bottom: var(--space-lg); }
    .wp-complete-heading { font-size: var(--font-2xl); margin-bottom: var(--space-sm); font-weight: 700; color: var(--text-primary); }
    .wp-complete-subtitle { color: var(--text-secondary); font-size: var(--font-sm); }
    .wp-complete-count { color: var(--text-muted); font-size: var(--font-xs); margin-top: var(--space-xs); }

    /* ===== Progression Messages ===== */
    .wp-progress-card { margin-bottom: var(--space-md); }
    .wp-progress-msg { font-size: var(--font-sm); margin-bottom: var(--space-sm); line-height: 1.5; border-left: 3px solid currentColor; padding-left: var(--space-sm); }
    .wp-progress-success { color: var(--success); }
    .wp-progress-warning { color: var(--warning); }

    /* ===== Terminology Tooltips ===== */
    .wp-term { border-bottom: 1px dotted var(--text-muted); cursor: help; position: relative; }
    .wp-term:hover, .wp-term:focus { color: var(--accent); border-bottom-color: var(--accent); }

    /* ===== Confirm Dialog ===== */
    .wp-confirm-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.6); display: flex; align-items: center; justify-content: center; z-index: 100; padding: var(--space-md); }
    .wp-confirm-dialog { background: var(--bg-card); border-radius: var(--radius); padding: var(--space-lg); max-width: 400px; width: 100%; box-shadow: var(--shadow-elevated); border: 1px solid var(--border); }
    .wp-confirm-title { font-size: var(--font-lg); font-weight: 600; color: var(--text-primary); margin-bottom: var(--space-sm); }
    .wp-confirm-message { font-size: var(--font-sm); color: var(--text-secondary); line-height: 1.5; margin-bottom: var(--space-lg); }
    .wp-confirm-actions { display: flex; gap: var(--space-sm); justify-content: flex-end; }
    .wp-confirm-cancel { background: transparent; color: var(--text-secondary); border: 1px solid var(--border); }
    .wp-confirm-cancel:hover { background: var(--bg-card-hover); }

    /* ===== Field Validation Error ===== */
    .wp-field-error { outline: 2px solid var(--danger); outline-offset: 2px; border-radius: var(--radius-sm); }
    .wp-error-text { color: var(--danger); }
    .wp-fb-error-text { color: var(--danger); font-size: var(--font-xs); margin-top: var(--space-xs); }

    /* ===== Storage Warning ===== */
    .wp-storage-warning { background: var(--bg-card); border: 1px solid var(--warning); border-radius: var(--radius-sm); padding: var(--space-sm) var(--space-md); margin-bottom: var(--space-md); color: var(--warning); }

    /* ===== Readiness Card ===== */
    .wp-readiness-card { margin-bottom: var(--space-md); border-color: var(--accent); }
    .wp-readiness-form { display: grid; gap: var(--space-md); margin-top: var(--space-md); }
    .wp-readiness-scale { display: flex; gap: 4px; flex-wrap: wrap; }
    .wp-scale-input { position: absolute; opacity: 0; width: 0; height: 0; }
    .wp-scale-label { display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 56px; min-height: 44px; padding: var(--space-xs) var(--space-sm); border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-sm); font-weight: 600; color: var(--text-secondary); transition: all var(--transition-fast); text-align: center; outline: none; }
    .wp-scale-label:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .wp-scale-label:hover { border-color: var(--accent); background: var(--bg-card-hover); }
    .wp-scale-input:checked + .wp-scale-label { background: var(--accent); color: white; border-color: var(--accent); }
    .wp-scale-hint { font-size: var(--font-2xs); font-weight: 400; opacity: 0.8; margin-top: 1px; }

    /* ===== Feedback Card ===== */
    .wp-feedback-card { margin-bottom: var(--space-md); }
    .wp-feedback-card .form-group { margin-bottom: var(--space-md); }
    .wp-feedback-textarea { resize: vertical; min-height: 60px; }
    .wp-difficulty-btns { display: flex; gap: var(--space-xs); flex-wrap: wrap; }
    .wp-difficulty-btn { flex: 1 1 auto; min-width: 100px; min-height: 44px; padding: var(--space-sm) var(--space-md); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-card); color: var(--text-secondary); cursor: pointer; font-size: var(--font-sm); transition: all var(--transition-fast); }
    .wp-difficulty-btn:hover { border-color: var(--accent); background: var(--bg-card-hover); }
    .wp-difficulty-btn.selected { background: var(--accent); color: white; border-color: var(--accent); font-weight: 600; }

    /* ===== RPE Row ===== */
    .wp-rpe-row { display: flex; align-items: center; gap: var(--space-sm); margin-bottom: var(--space-xs); }
    .wp-rpe-lift-name { min-width: 120px; font-size: var(--font-sm); font-weight: 500; color: var(--text-primary); }
    .wp-rpe-select { flex: 1; }

    /* ===== Injury Section ===== */
    .wp-injury-section { margin-bottom: var(--space-md); }
    .wp-injury-areas { display: flex; flex-wrap: wrap; gap: var(--space-xs); margin-bottom: var(--space-sm); }

    /* ===== Adaptation Card ===== */
    .wp-adaptation-card { margin-bottom: var(--space-md); }
    .wp-adaptation-item { padding: var(--space-sm) var(--space-md); border-left: 4px solid var(--border); margin-bottom: var(--space-sm); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; background: var(--bg-card); }
    .wp-adaptation-badge { display: inline-block; font-size: var(--font-2xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 2px var(--space-xs); border-radius: var(--radius-sm); margin-bottom: var(--space-xs); }
    .wp-adaptation-msg { font-size: var(--font-sm); color: var(--text-secondary); line-height: 1.5; margin-bottom: var(--space-xs); }
    .wp-adaptation-citation { font-size: var(--font-xs); color: var(--text-muted); }
    .wp-adapt-increase { border-left-color: var(--success); }
    .wp-adapt-increase .wp-adaptation-badge { background: var(--success); color: white; }
    .wp-adapt-decrease { border-left-color: var(--warning); }
    .wp-adapt-decrease .wp-adaptation-badge { background: var(--warning); color: white; }
    .wp-adapt-deload { border-left-color: var(--orange); }
    .wp-adapt-deload .wp-adaptation-badge { background: var(--orange); color: white; }
    .wp-adapt-substitution { border-left-color: var(--danger); }
    .wp-adapt-substitution .wp-adaptation-badge { background: var(--danger); color: white; }
    .wp-adapt-info { border-left-color: var(--accent); }
    .wp-adapt-info .wp-adaptation-badge { background: var(--accent); color: white; opacity: 0.8; }

    /* ===== Warm-up Section ===== */
    .wp-warmup-section { margin-bottom: var(--space-sm); padding: var(--space-xs) var(--space-sm); border: 1px dashed var(--border); border-radius: var(--radius-sm); opacity: 0.75; }
    .wp-warmup-label { font-size: var(--font-2xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: var(--space-xs); font-weight: 600; }
    .wp-warmup-row { display: flex; justify-content: space-between; align-items: center; padding: 2px 0; font-size: var(--font-xs); color: var(--text-muted); }
    .wp-warmup-note { font-style: italic; font-size: var(--font-2xs); color: var(--text-muted); }

    /* ===== Texas Method Purpose Banners ===== */
    .wp-purpose-banner { padding: var(--space-sm) var(--space-md); border-radius: var(--radius-sm); font-size: var(--font-sm); font-weight: 500; margin-bottom: var(--space-md); line-height: 1.5; }
    .wp-purpose-volume { background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.3); color: #93bbfd; }
    .wp-purpose-recovery { background: rgba(74, 222, 128, 0.12); border: 1px solid rgba(74, 222, 128, 0.3); color: #6ee7a0; }
    .wp-purpose-intensity { background: rgba(251, 146, 60, 0.12); border: 1px solid rgba(251, 146, 60, 0.3); color: #fdba74; }
    :root[data-theme="light"] .wp-purpose-volume { background: rgba(59, 130, 246, 0.08); border-color: rgba(37, 99, 235, 0.4); color: #1d4ed8; }
    :root[data-theme="light"] .wp-purpose-recovery { background: rgba(22, 163, 74, 0.08); border-color: rgba(22, 163, 74, 0.4); color: #15803d; }
    :root[data-theme="light"] .wp-purpose-intensity { background: rgba(234, 88, 12, 0.08); border-color: rgba(234, 88, 12, 0.4); color: #c2410c; }

    /* ===== Conjugate Variation Picker ===== */
    .wp-variation-picker { margin-bottom: var(--space-md); padding: var(--space-sm); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-card); }
    .wp-variation-select { margin-top: var(--space-xs); }

    /* ===== Never Lifted Checkbox ===== */
    .wp-never-lifted-label { display: inline-flex; align-items: center; gap: var(--space-sm); cursor: pointer; font-size: var(--font-sm); color: var(--text-primary); min-height: 44px; }
    .wp-never-lifted-cb { width: 18px; height: 18px; cursor: pointer; }
    .wp-help-text { font-size: var(--font-xs); color: var(--text-muted); margin-top: var(--space-xs); font-style: italic; }

    /* ===== Meet Date Countdown ===== */
    .wp-meet-countdown { font-size: var(--font-xs); color: var(--accent); font-weight: 600; margin-top: 2px; }

    /* ===== PR Toast ===== */
    .wp-pr-toast { background: linear-gradient(135deg, var(--success), #16a34a); color: #fff; padding: var(--space-sm) var(--space-md); border-radius: var(--radius-md); text-align: center; font-weight: 700; font-size: var(--font-sm); animation: wp-toast-in 0.4s ease-out; margin-bottom: var(--space-sm); box-shadow: 0 4px 12px rgba(74, 222, 128, 0.3); }
    @keyframes wp-toast-in { 0% { transform: translateY(-20px) scale(0.9); opacity: 0; } 100% { transform: translateY(0) scale(1); opacity: 1; } }

    /* ===== PR Card (Completion Screen) ===== */
    .wp-pr-card { margin-bottom: var(--space-md); border-color: var(--success); }
    .wp-pr-heading { color: var(--success); }

    /* ===== Plate Calculator Hint ===== */
    .wp-plate-hint { font-size: var(--font-2xs); color: var(--text-muted); padding-left: 3.5rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; }

    /* ===== Training Calendar ===== */
    .wp-calendar-card { margin-top: var(--space-md); }
    .wp-calendar-summary { cursor: pointer; color: var(--accent); font-size: var(--font-sm); display: flex; justify-content: space-between; align-items: center; }
    .wp-streak-badge { font-size: var(--font-2xs); color: var(--text-muted); font-weight: 400; }
    .wp-calendar-content { margin-top: var(--space-sm); }
    .wp-cal-header { text-align: center; font-weight: 600; font-size: var(--font-sm); color: var(--text-primary); margin-bottom: var(--space-sm); }
    .wp-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; }
    .wp-cal-dow { font-size: var(--font-2xs); color: var(--text-muted); font-weight: 600; padding: 4px 0; text-transform: uppercase; }
    .wp-cal-day { position: relative; padding: 6px 2px; font-size: var(--font-xs); color: var(--text-secondary); border-radius: var(--radius-sm); min-height: 32px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .wp-cal-other-month { opacity: 0.3; }
    .wp-cal-today { font-weight: 700; color: var(--accent); border: 1px solid var(--accent); }
    .wp-cal-trained { background: var(--accent-glow); }
    .wp-cal-dot { display: block; width: 5px; height: 5px; border-radius: 50%; background: var(--success); margin-top: 2px; }
    .wp-cal-stats { display: flex; gap: var(--space-sm); justify-content: center; flex-wrap: wrap; margin-top: var(--space-sm); font-size: var(--font-2xs); color: var(--text-muted); }

    /* ===== Volume Tracker ===== */
    .wp-volume-card { margin-top: var(--space-md); }
    .wp-volume-summary { cursor: pointer; color: var(--accent); font-size: var(--font-sm); display: flex; align-items: center; gap: var(--space-sm); }
    .wp-volume-warn { font-size: var(--font-2xs); color: var(--warning); font-weight: 600; }
    .wp-volume-alert { font-size: var(--font-2xs); color: var(--danger); font-weight: 600; }
    .wp-volume-content { margin-top: var(--space-sm); }
    .wp-vol-row { display: grid; grid-template-columns: 5.5rem 1fr 2rem; gap: var(--space-xs); align-items: center; padding: 3px 0; }
    .wp-vol-label { font-size: var(--font-xs); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .wp-vol-bar-track { position: relative; height: 8px; background: var(--border); border-radius: 4px; overflow: visible; }
    .wp-vol-bar { height: 100%; border-radius: 4px; transition: width 0.3s ease; }
    .wp-vol-mev-mark, .wp-vol-mav-mark { position: absolute; top: -2px; width: 1px; height: 12px; background: var(--text-muted); opacity: 0.4; }
    .wp-vol-count { font-size: var(--font-xs); color: var(--text-muted); text-align: right; font-variant-numeric: tabular-nums; }
    .wp-vol-legend { display: flex; gap: var(--space-md); justify-content: center; flex-wrap: wrap; margin-top: var(--space-sm); padding-top: var(--space-sm); border-top: 1px solid var(--border); }
    .wp-vol-leg-item { display: flex; align-items: center; gap: 4px; font-size: var(--font-2xs); color: var(--text-muted); }
    .wp-vol-leg-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }

    /* ===== Mobile Responsive ===== */
    @media (max-width: 500px) {
      .wp-set-row { grid-template-columns: 28px 1fr; gap: var(--space-xs); }
      .wp-set-weight { grid-column: 2; font-size: var(--font-xs); }
      .wp-set-meta { grid-column: 2; font-size: var(--font-2xs); }
      .wp-maxes-grid { grid-template-columns: 1fr; }
      .wp-header-row { flex-direction: column; align-items: flex-start; gap: var(--space-sm); }
      .wp-rec-header { flex-direction: column; gap: var(--space-xs); }
      .wp-confirm-dialog { margin: var(--space-md); }
      .wp-difficulty-btns { flex-direction: column; }
      .wp-rpe-row { flex-direction: column; align-items: flex-start; }
      .wp-rpe-lift-name { min-width: unset; }
      .wp-scale-label { min-width: 44px; padding: var(--space-xs); }
      .wp-scale-hint { display: none; }
      .wp-plate-hint { display: none; }
      .wp-cal-day { padding: 4px 1px; font-size: var(--font-2xs); min-height: 28px; }
      .wp-cal-stats { flex-direction: column; align-items: center; gap: 2px; }
      .wp-vol-row { grid-template-columns: 4.5rem 1fr 1.5rem; }
      .wp-vol-legend { gap: var(--space-sm); }
    }

    /* ===== Custom Program Builder ===== */
    .wp-custom-divider { text-align: center; margin: var(--space-lg) 0; position: relative; }
    .wp-custom-divider::before { content: ''; position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: var(--border); }
    .wp-custom-divider span { background: var(--bg-card); padding: 0 var(--space-md); position: relative; color: var(--text-muted); font-size: var(--font-sm); }
    .wp-custom-section { margin-top: var(--space-sm); }
    .wp-custom-textarea { width: 100%; min-height: 200px; padding: var(--space-sm) var(--space-md); border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); font-size: var(--font-sm); font-family: monospace; resize: vertical; line-height: 1.6; box-sizing: border-box; }
    .wp-custom-textarea:focus { outline: 2px solid var(--accent); border-color: var(--accent); }
    .wp-custom-textarea::placeholder { color: var(--text-muted); opacity: 0.7; }
    .wp-custom-options { margin: var(--space-md) 0; }
    .wp-custom-desc { font-size: var(--font-sm); color: var(--text-secondary); margin-bottom: var(--space-sm); }
    .wp-custom-meta { font-size: var(--font-xs); color: var(--text-muted); margin-bottom: var(--space-sm); }
    .wp-custom-preview-card { margin-top: var(--space-md); }
    .wp-preview-day { padding: var(--space-xs) 0; border-bottom: 1px solid var(--border); }
    .wp-preview-day:last-child { border-bottom: none; }
    .wp-preview-exercises { list-style: none; padding: var(--space-xs) 0 0 var(--space-md); margin: 0; font-size: var(--font-sm); color: var(--text-secondary); }
    .wp-preview-exercises li { padding: 2px 0; }

    /* ===== Schedule Modification Panel ===== */
    .wp-header-btns { display: flex; gap: var(--space-xs); flex-wrap: wrap; }
    .wp-modify-card { margin-bottom: var(--space-md); }
    .wp-modify-desc { font-size: var(--font-sm); color: var(--text-secondary); margin-bottom: var(--space-sm); }
    .wp-modify-options { display: grid; gap: var(--space-sm); margin: var(--space-md) 0; }
    .wp-modify-option { display: grid; grid-template-columns: 2rem 1fr; grid-template-rows: auto auto; gap: 0 var(--space-sm); padding: var(--space-sm) var(--space-md); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-input); cursor: pointer; text-align: left; transition: border-color var(--transition-fast); }
    .wp-modify-option:hover { border-color: var(--accent); }
    .wp-modify-icon { font-size: var(--font-lg); grid-row: span 2; align-self: center; }
    .wp-modify-label { font-weight: 600; color: var(--text-primary); font-size: var(--font-sm); }
    .wp-modify-detail { color: var(--text-muted); font-size: var(--font-xs); }
    .wp-modify-subform { margin-top: var(--space-md); display: grid; gap: var(--space-sm); }
    .wp-modify-note { font-size: var(--font-xs); color: var(--text-muted); line-height: 1.5; }
    .wp-override-banner { border-color: var(--warning); background: rgba(251, 191, 36, 0.08); display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); font-size: var(--font-sm); }
    .wp-override-remaining { color: var(--text-muted); font-size: var(--font-xs); }

    /* ===== Beginner Guide ===== */
    .wp-beginner-guide-toggle { margin: var(--space-sm) 0; }
    .wp-guide-link { cursor: pointer; color: var(--accent); font-size: var(--font-sm); font-weight: 500; }
    .wp-guide-link:hover { text-decoration: underline; }
    .wp-beginner-guide { margin-top: var(--space-md); display: grid; gap: var(--space-md); }
    .wp-guide-section { padding: var(--space-md); background: var(--bg-input); border-radius: var(--radius-md); border-left: 3px solid var(--accent); }
    .wp-guide-section-title { font-size: var(--font-lg); color: var(--text-primary); margin-bottom: var(--space-sm); }
    .wp-guide-section-content { font-size: var(--font-sm); color: var(--text-secondary); line-height: 1.8; }
    .wp-guide-section-content strong { color: var(--text-primary); }
    .wp-guide-takeaway { margin-top: var(--space-sm); padding: var(--space-sm) var(--space-md); background: var(--accent-glow); border-radius: var(--radius-sm); font-size: var(--font-sm); color: var(--accent); font-weight: 500; }
    .wp-guide-source { margin-top: var(--space-xs); font-size: var(--font-2xs); color: var(--text-muted); font-style: italic; }

    /* ===== RPE Calculator ===== */
    .wp-rpe-calc-summary { cursor: pointer; color: var(--accent); font-size: var(--font-sm); font-weight: 600; }
    .wp-rpe-calc-desc { font-size: var(--font-xs); color: var(--text-muted); margin-bottom: var(--space-sm); }
    .wp-rpe-calc-inputs { display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: var(--space-sm); align-items: end; margin-bottom: var(--space-md); }
    .wp-rpe-calc-field { display: flex; flex-direction: column; }
    .wp-rpe-calc-btn { min-height: 38px; white-space: nowrap; }
    .wp-rpe-result-hero { text-align: center; padding: var(--space-md); background: var(--accent-glow); border-radius: var(--radius-md); margin-bottom: var(--space-md); }
    .wp-rpe-result-label { font-size: var(--font-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; }
    .wp-rpe-result-value { font-size: var(--font-2xl); font-weight: 700; color: var(--accent); }
    .wp-rpe-result-detail { font-size: var(--font-sm); color: var(--text-secondary); margin-top: var(--space-xs); }
    .wp-rpe-result-desc { font-size: var(--font-xs); color: var(--text-muted); margin-top: 2px; }
    .wp-rpe-table-label { font-size: var(--font-xs); color: var(--text-muted); margin-bottom: var(--space-xs); text-transform: uppercase; letter-spacing: 0.5px; }
    .wp-rpe-table { border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; font-size: var(--font-sm); }
    .wp-rpe-table-header { display: grid; grid-template-columns: 1fr 1fr 1fr 1.5fr; padding: var(--space-xs) var(--space-sm); background: var(--bg-input); font-size: var(--font-2xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); }
    .wp-rpe-row { display: grid; grid-template-columns: 1fr 1fr 1fr 1.5fr; padding: var(--space-xs) var(--space-sm); border-bottom: 1px solid var(--border); color: var(--text-secondary); }
    .wp-rpe-row:last-child { border-bottom: none; }
    .wp-rpe-row-current { background: var(--accent-glow); font-weight: 600; color: var(--text-primary); }
    .wp-rpe-row-weight { font-weight: 600; color: var(--text-primary); }
    @media (max-width: 500px) {
      .wp-rpe-calc-inputs { grid-template-columns: 1fr 1fr; }
      .wp-rpe-calc-btn { grid-column: span 2; }
    }
  `;
  document.head.appendChild(style);
}
