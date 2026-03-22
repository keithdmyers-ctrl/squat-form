/**
 * Workout session UI: workout card rendering, set logging, rest timer integration.
 * Extracted from ui-workout.ts for modularity.
 */

import { PROGRAMS, EXERCISE_SLOTS } from './workout-programs';
import {
  loadWorkoutLogs,
} from './program-generator';
import type { ProgramState, GeneratedWorkout } from './program-generator';
import { escapeHtml } from './ui-utilities';
import { addTermTooltips } from './ui-workout';
import { RestTimer, formatRestTime } from './rest-timer';
import { checkForPR } from './pr-tracker';
import { calculatePlates, formatPlateResult } from './plate-calculator';
import { getExerciseDemo } from './exercise-demos';
import { generateWarmupPlan, renderWarmupPlan } from './warmup-calculator';

// ─── PR Toast ───

export function showPRToast(container: HTMLElement, message: string): void {
  // Remove any existing toast
  container.querySelector('.wp-pr-toast')?.remove();

  const toast = document.createElement('div');
  toast.className = 'wp-pr-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'assertive');
  toast.textContent = message;
  container.prepend(toast);

  // Vibrate for celebration
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate([100, 50, 100, 50, 200]);
  }

  // Auto-remove after 5 seconds
  setTimeout(() => toast.remove(), 5000);
}

// ─── Active Rest Timer ───

/** Active rest timer instance (shared across sets) */
let activeRestTimer: RestTimer | null = null;

export function getActiveRestTimer(): RestTimer | null {
  return activeRestTimer;
}

export function stopActiveRestTimer(): void {
  activeRestTimer?.stop();
}

const IN_PROGRESS_KEY = 'squat_form_in_progress_workout';

export function clearInProgressWorkout(): void {
  localStorage.removeItem(IN_PROGRESS_KEY);
}

function saveInProgressWorkout(container: HTMLElement, _workout: GeneratedWorkout): void {
  const sets: Array<{ exercise: string; set: number; weight: string; reps: string; rpe: string; logged: boolean }> = [];
  container.querySelectorAll<HTMLElement>('.wp-set-tracker-row').forEach(row => {
    const setId = `set-${row.dataset.exercise}-${row.dataset.set}`;
    sets.push({
      exercise: row.dataset.exercise ?? '',
      set: parseInt(row.dataset.set ?? '0', 10),
      weight: (document.getElementById(`${setId}-weight`) as HTMLInputElement)?.value ?? '',
      reps: (document.getElementById(`${setId}-reps`) as HTMLInputElement)?.value ?? '',
      rpe: (document.getElementById(`${setId}-rpe`) as HTMLSelectElement)?.value ?? '',
      logged: row.dataset.status === 'logged',
    });
  });
  try {
    localStorage.setItem(IN_PROGRESS_KEY, JSON.stringify({ date: new Date().toISOString(), sets }));
  } catch {
    document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' }));
  }
}

export function restoreInProgressWorkout(_container: HTMLElement): void {
  try {
    const raw = localStorage.getItem(IN_PROGRESS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    // Only restore if saved today (not stale)
    if (!saved.date || new Date(saved.date).toDateString() !== new Date().toDateString()) {
      localStorage.removeItem(IN_PROGRESS_KEY);
      return;
    }
    for (const set of saved.sets) {
      const setId = `set-${set.exercise}-${set.set}`;
      const weightInput = document.getElementById(`${setId}-weight`) as HTMLInputElement;
      const repsInput = document.getElementById(`${setId}-reps`) as HTMLInputElement;
      const rpeSelect = document.getElementById(`${setId}-rpe`) as HTMLSelectElement;
      const row = document.getElementById(`${setId}-row`) as HTMLElement;
      if (weightInput && set.weight) weightInput.value = set.weight;
      if (repsInput && set.reps) repsInput.value = set.reps;
      if (rpeSelect && set.rpe) rpeSelect.value = set.rpe;
      if (row && set.logged) {
        row.dataset.status = 'logged';
        row.classList.add('wp-set-logged');
        const btn = row.querySelector('.wp-log-set-btn') as HTMLButtonElement;
        if (btn) { btn.textContent = '\u2713'; btn.disabled = true; btn.classList.add('wp-logged-check'); }
        if (weightInput) weightInput.readOnly = true;
        if (repsInput) repsInput.readOnly = true;
        if (rpeSelect) rpeSelect.disabled = true;
      }
    }
  } catch { /* ignore restore errors */ }
}

// Catch background return: sync timer with actual elapsed time
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && activeRestTimer) {
    activeRestTimer.checkBackground();
  }
});

export function wireUpSetLogging(container: HTMLElement, state: ProgramState, workout: GeneratedWorkout): void {
  // Wire up "Log" buttons for each set
  container.querySelectorAll<HTMLButtonElement>('.wp-log-set-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const setId = btn.dataset.setId;
      if (!setId) return;
      const row = document.getElementById(`${setId}-row`) as HTMLElement;
      if (!row || row.dataset.status === 'logged') return;

      // Read user inputs
      const weightInput = document.getElementById(`${setId}-weight`) as HTMLInputElement;
      const repsInput = document.getElementById(`${setId}-reps`) as HTMLInputElement;
      const rpeSelect = document.getElementById(`${setId}-rpe`) as HTMLSelectElement;

      const weight = parseFloat(weightInput?.value) || 0;
      const reps = parseInt(repsInput?.value) || 0;

      // Validate weight for main lifts (must be > 0)
      const exerciseSlotName = row.dataset.exercise ?? '';
      const slotInfo = EXERCISE_SLOTS[exerciseSlotName];
      if (slotInfo?.isMainLift && weight <= 0) {
        weightInput?.classList.add('wp-input-error');
        setTimeout(() => weightInput?.classList.remove('wp-input-error'), 1500);
        weightInput?.focus();
        return;
      }

      if (reps <= 0) {
        repsInput?.focus();
        repsInput?.classList.add('wp-input-error');
        setTimeout(() => repsInput?.classList.remove('wp-input-error'), 1500);
        return;
      }

      // Mark set as logged
      row.dataset.status = 'logged';
      row.classList.add('wp-set-logged');
      btn.textContent = '\u2713'; // checkmark
      btn.disabled = true;
      btn.classList.add('wp-logged-check');

      // Check for personal records
      const exerciseSlot = row.dataset.exercise ?? '';
      if (weight > 0 && reps > 0) {
        const prs = checkForPR(exerciseSlot, weight, reps, state.weightUnit);
        if (prs.length > 0) {
          showPRToast(container, prs[0].message ?? 'New PR!');
        }
      }

      // Disable inputs (read-only feel)
      weightInput.readOnly = true;
      repsInput.readOnly = true;
      rpeSelect.disabled = true;

      // Vibrate on log (mobile haptic feedback)
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(50);
      }

      // Start rest timer for this set's rest period
      const restSeconds = parseInt(row.dataset.rest ?? '120', 10);
      startRestTimer(container, restSeconds);

      // Auto-fill next set's weight from this set
      const exercise = row.dataset.exercise;
      const setNum = parseInt(row.dataset.set ?? '0', 10);
      const nextRow = document.getElementById(`set-${exercise}-${setNum + 1}-row`);
      if (nextRow && nextRow.dataset.status === 'pending') {
        const nextWeightInput = document.getElementById(`set-${exercise}-${setNum + 1}-weight`) as HTMLInputElement;
        if (nextWeightInput && !nextWeightInput.value) {
          nextWeightInput.value = String(weight);
        }
      }

      // Auto-save in-progress workout after each set is logged
      saveInProgressWorkout(container, workout);
    });
  });

  // Wire up stepper buttons for weight/reps
  container.querySelectorAll<HTMLButtonElement>('.wp-step-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const step = parseFloat(btn.dataset.step ?? '0');
      if (!targetId || step === 0) return;
      const input = document.getElementById(targetId) as HTMLInputElement | null;
      if (!input || input.readOnly) return;
      const current = parseFloat(input.value) || 0;
      const newVal = Math.max(0, current + step);
      input.value = String(newVal);
    });
  });

  // Allow logging by pressing Enter in any set input
  container.querySelectorAll<HTMLInputElement>('.wp-input-weight, .wp-input-reps').forEach(input => {
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const row = input.closest('.wp-set-tracker-row') as HTMLElement;
        const btn = row?.querySelector('.wp-log-set-btn') as HTMLButtonElement;
        btn?.click();
      }
    });
  });
}

function startRestTimer(container: HTMLElement, seconds: number): void {
  // Stop any existing timer
  activeRestTimer?.stop();

  const timerBar = container.querySelector('#wp-rest-timer-bar') as HTMLElement;
  const timerSpacer = container.querySelector('#wp-timer-spacer') as HTMLElement;
  const timeDisplay = container.querySelector('#wp-timer-time') as HTMLElement;
  const progressFill = container.querySelector('#wp-timer-progress') as HTMLElement;
  const pauseBtn = container.querySelector('#wp-timer-pause') as HTMLButtonElement;
  if (!timerBar || !timeDisplay || !progressFill) return;

  timerBar.classList.remove('wp-hidden', 'wp-timer-done');
  timerBar.classList.add('wp-timer-active');
  timerSpacer?.classList.add('wp-timer-spacer-active');
  progressFill.style.width = '0%';
  progressFill.classList.remove('wp-timer-warning', 'wp-timer-urgent');

  activeRestTimer = new RestTimer({
    onTick: (st) => {
      timeDisplay.textContent = formatRestTime(st.timeRemaining);
      const pct = st.totalTime > 0 ? ((st.totalTime - st.timeRemaining) / st.totalTime) * 100 : 100;
      progressFill.style.width = `${pct}%`;

      // Color changes: green -> yellow -> red
      if (st.timeRemaining <= 10) {
        progressFill.classList.add('wp-timer-urgent');
      } else if (st.timeRemaining <= 30) {
        progressFill.classList.add('wp-timer-warning');
        progressFill.classList.remove('wp-timer-urgent');
      } else {
        progressFill.classList.remove('wp-timer-warning', 'wp-timer-urgent');
      }

      if (pauseBtn) {
        pauseBtn.textContent = st.isPaused ? 'Resume' : 'Pause';
      }
    },
    onComplete: () => {
      timerBar.classList.remove('wp-timer-active');
      timerBar.classList.add('wp-timer-done');
      timeDisplay.textContent = 'GO!';
      progressFill.style.width = '100%';
      progressFill.classList.remove('wp-timer-warning', 'wp-timer-urgent');
      // Stay visible with "GO!" until the next startRestTimer call clears it
    },
  });

  activeRestTimer.start(seconds);

  // Wire timer control buttons
  const minus30 = container.querySelector('#wp-timer-minus30') as HTMLButtonElement;
  const plus30 = container.querySelector('#wp-timer-plus30') as HTMLButtonElement;
  const skipBtn = container.querySelector('#wp-timer-skip') as HTMLButtonElement;

  // Remove old listeners by cloning
  const replaceBtn = (old: HTMLButtonElement | null, handler: () => void) => {
    if (!old) return;
    const btn = old.cloneNode(true) as HTMLButtonElement;
    old.replaceWith(btn);
    btn.addEventListener('click', handler);
  };

  replaceBtn(minus30, () => activeRestTimer?.adjust(-30));
  replaceBtn(plus30, () => activeRestTimer?.adjust(30));
  replaceBtn(pauseBtn, () => {
    if (!activeRestTimer) return;
    const st = activeRestTimer.getState();
    if (st.isPaused) activeRestTimer.resume();
    else activeRestTimer.pause();
  });
  replaceBtn(skipBtn, () => {
    activeRestTimer?.skip();
    timerBar.classList.add('wp-hidden');
    timerSpacer?.classList.remove('wp-timer-spacer-active');
  });
}

// ─── Workout Card (In-Workout Tracker) ───

/** Get previous workout data for the same day type to pre-fill suggestions */
function getPreviousWorkoutData(state: ProgramState): Record<string, { weight: number; reps: number; rpe?: number }> {
  const logs = loadWorkoutLogs();
  const prevLog = logs.find(l =>
    l.programId === state.programId && l.workoutDayIndex === (state.currentDay % (PROGRAMS[state.programId]?.workouts.length ?? 1))
  );
  if (!prevLog) return {};

  const data: Record<string, { weight: number; reps: number; rpe?: number }> = {};
  for (const set of prevLog.sets) {
    if (!data[set.exerciseSlot] && set.completed && set.actualWeight && set.actualWeight > 0) {
      data[set.exerciseSlot] = {
        weight: set.actualWeight,
        reps: set.actualReps ?? 0,
        rpe: set.rpe,
      };
    }
  }
  return data;
}

export function renderWorkoutCard(workout: GeneratedWorkout, state: ProgramState): string {
  // Hide RPE column for beginners (first 5 workouts) to reduce cognitive load
  const showRPE = state.workoutsCompleted >= 5;
  const gridCols = showRPE ? '3.5rem 1fr 1fr 3rem 3rem' : '3.5rem 1fr 1fr 3rem';

  // Load previous workout data for weight/reps suggestions
  const prevData = getPreviousWorkoutData(state);

  // Texas Method day-purpose banner
  let txBanner = '';
  if (state.programId === 'texas_method') {
    const dayIdx = state.currentDay % (PROGRAMS[state.programId]?.workouts.length ?? 3);
    if (dayIdx === 0) {
      txBanner = `<div class="wp-purpose-banner wp-purpose-volume">VOLUME DAY &mdash; High volume drives adaptation. These sets should feel challenging but completable.</div>`;
    } else if (dayIdx === 1) {
      txBanner = `<div class="wp-purpose-banner wp-purpose-recovery">RECOVERY DAY &mdash; Light weights, focus on movement quality. Don&rsquo;t chase heavy loads.</div>`;
    } else if (dayIdx === 2) {
      txBanner = `<div class="wp-purpose-banner wp-purpose-intensity">INTENSITY DAY &mdash; PR attempt! This single set of 5 is the most important set of your week.</div>`;
    }
  }

  // Conjugate ME variation picker
  let conjugateVariationHtml = '';
  if (state.programId === 'conjugate' && (state.currentDay % 4 === 0 || state.currentDay % 4 === 1)) {
    const isLower = state.currentDay % 4 === 0;
    const variations = isLower
      ? ['Box Squat', 'Front Squat', 'SSB Squat', 'Pin Squat', 'Pause Squat', 'Deficit Deadlift']
      : ['Close-Grip Bench', 'Floor Press', 'Incline Bench', 'Board Press', 'Spoto Press'];
    conjugateVariationHtml = `
      <div class="wp-variation-picker">
        <label class="form-label">Today's ME variation:</label>
        <select class="form-select wp-variation-select" id="wp-me-variation">
          ${variations.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}
        </select>
      </div>
    `;
  }

  let html = `
    <div class="card card--static wp-workout-card">
      <h4 class="section-heading-sm wp-day-heading">
        Today: ${escapeHtml(workout.dayLabel)}
      </h4>
      ${txBanner}
      ${conjugateVariationHtml}
  `;

  for (const exercise of workout.exercises) {
    const isAccessory = !EXERCISE_SLOTS[exercise.exerciseSlot]?.isMainLift;
    const prevExData = prevData[exercise.exerciseSlot];

    // Exercise demo lookup
    const demo = getExerciseDemo(exercise.exerciseSlot);

    html += `
      <div class="wp-exercise-block">
        <div class="wp-exercise-header">
          <strong class="wp-exercise-name">${escapeHtml(exercise.name)}</strong>
          <span class="wp-exercise-header-right">
            ${isAccessory ? '<span class="wp-accessory-badge">ACCESSORY</span>' : ''}
            ${demo ? `<button class="wp-demo-info-btn" aria-label="How to: ${escapeHtml(exercise.name)}" data-demo-target="demo-${escapeHtml(exercise.exerciseSlot)}" type="button">?</button>` : ''}
          </span>
        </div>
    `;

    // Exercise demo (expandable, toggled by ? button)
    if (demo) {
      html += `
        <details class="wp-exercise-demo" id="demo-${escapeHtml(exercise.exerciseSlot)}">
          <summary class="wp-demo-toggle">How to do this exercise</summary>
          <div class="wp-demo-content">
            ${demo.gifUrl ? `<img src="${escapeHtml(demo.gifUrl)}" alt="${escapeHtml(demo.name)} demonstration" class="wp-demo-gif" loading="lazy" />` : ''}
            <div class="wp-demo-steps">
              <strong>Setup &amp; Execution:</strong>
              <ol class="wp-demo-steps-list">
                ${demo.steps.slice(0, 4).map(s => `<li>${escapeHtml(s)}</li>`).join('')}
              </ol>
            </div>
            <div class="wp-demo-mistakes">
              <strong>Common Mistakes:</strong>
              <ul class="wp-demo-mistakes-list">
                ${demo.commonMistakes.slice(0, 3).map(m => `<li>${escapeHtml(m)}</li>`).join('')}
              </ul>
            </div>
            <div class="wp-demo-cues">
              <strong>Key Cues:</strong>
              ${demo.cues.slice(0, 3).map(c => `<span class="wp-demo-cue">${escapeHtml(c)}</span>`).join('')}
            </div>
            ${demo.youtubeUrl ? `<a href="${escapeHtml(demo.youtubeUrl)}" target="_blank" rel="noopener" class="wp-demo-video-link">${escapeHtml(demo.youtubeTitle ?? 'Watch full tutorial')}</a>` : ''}
          </div>
        </details>
      `;
    }

    if (exercise.notes) {
      html += `<p class="wp-exercise-notes">${addTermTooltips(exercise.notes)}</p>`;
    }

    // Previous performance hint
    if (prevExData) {
      html += `<div class="wp-prev-hint">Last: ${prevExData.weight} ${escapeHtml(state.weightUnit)} \u00d7 ${prevExData.reps} ${prevExData.rpe ? `@ RPE ${prevExData.rpe}` : ''}</div>`;
    }

    // Warm-up sets with plate loading
    if (exercise.warmupSets && exercise.warmupSets.length > 0) {
      html += `<div class="wp-warmup-section">`;
      html += `<div class="wp-warmup-label">Warm-up</div>`;
      for (const ws of exercise.warmupSets) {
        const note = ws.notes?.replace('Warm-up: ', '') ?? '';
        html += `
          <div class="wp-warmup-row">
            <span>${ws.targetWeight} ${escapeHtml(state.weightUnit)} \u00d7 ${escapeHtml(ws.targetReps)}</span>
            ${note ? `<span class="wp-warmup-note">${escapeHtml(note)}</span>` : ''}
          </div>
        `;
      }
      html += `</div>`;
    } else if (!isAccessory && exercise.sets.length > 0) {
      // Generate warm-up plan for main lifts without predefined warm-ups
      const firstWorkingWeight = exercise.sets[0]?.targetWeight ?? 0;
      if (firstWorkingWeight > 0) {
        const warmup = generateWarmupPlan(firstWorkingWeight, (state.weightUnit ?? 'lbs') as 'lbs' | 'kg', {
          exercise: exercise.exerciseSlot,
        });
        if (warmup.sets.length > 0) {
          html += renderWarmupPlan(warmup);
        }
      }
    }

    // Sets table header
    html += `
      <div class="wp-sets-tracker">
        <div class="wp-sets-header" style="grid-template-columns: ${gridCols}">
          <span class="wp-sh-set">Set</span>
          <span class="wp-sh-weight">Weight</span>
          <span class="wp-sh-reps">Reps</span>
          ${showRPE ? '<span class="wp-sh-rpe">RPE</span>' : ''}
          <span class="wp-sh-log"></span>
        </div>
    `;

    for (const set of exercise.sets) {
      const setId = `set-${escapeHtml(exercise.exerciseSlot)}-${set.setNumber}`;
      const targetWeight = set.targetWeight > 0 ? set.targetWeight : (prevExData?.weight ?? 0);
      const targetReps = set.targetReps.replace('+', '');
      const pctLabel = set.intensityPct ? `${set.intensityPct}%` : '';
      const amrapBadge = set.isAmrap ? '<span class="wp-amrap-badge">AMRAP</span>' : '';
      const restSec = set.restSeconds;

      const weightStep = state.weightUnit === 'kg' ? 2.5 : 5;
      html += `
        <div class="wp-set-tracker-row" id="${setId}-row" data-exercise="${escapeHtml(exercise.exerciseSlot)}" data-set="${set.setNumber}" data-rest="${restSec}" data-status="pending" style="grid-template-columns: ${gridCols}">
          <span class="wp-st-set">${set.setNumber} ${amrapBadge}${pctLabel ? `<span class="wp-pct-label">${pctLabel}</span>` : ''}</span>
          <span class="wp-st-weight">
            <div class="wp-stepper">
              <button class="wp-step-btn wp-step-minus" data-target="${setId}-weight" data-step="${-weightStep}" aria-label="Decrease weight by ${weightStep}">\u2212</button>
              <input type="number" class="wp-input-weight" id="${setId}-weight" value="${targetWeight || ''}" min="0" max="2000" step="${weightStep}" placeholder="${escapeHtml(state.weightUnit)}" aria-label="Weight for set ${set.setNumber}" />
              <button class="wp-step-btn wp-step-plus" data-target="${setId}-weight" data-step="${weightStep}" aria-label="Increase weight by ${weightStep}">+</button>
            </div>
          </span>
          <span class="wp-st-reps">
            <div class="wp-stepper">
              <button class="wp-step-btn wp-step-minus" data-target="${setId}-reps" data-step="-1" aria-label="Decrease reps by 1">\u2212</button>
              <input type="number" class="wp-input-reps" id="${setId}-reps" value="${targetReps}" min="0" max="99" step="1" aria-label="Reps for set ${set.setNumber}" />
              <button class="wp-step-btn wp-step-plus" data-target="${setId}-reps" data-step="1" aria-label="Increase reps by 1">+</button>
            </div>
          </span>
          ${showRPE ? `<span class="wp-st-rpe">
            <select class="wp-input-rpe" id="${setId}-rpe" aria-label="RPE for set ${set.setNumber}">
              <option value="">-</option>
              <option value="6"${set.rpe === 6 ? ' selected' : ''}>6</option>
              <option value="6.5">6.5</option>
              <option value="7"${set.rpe === 7 ? ' selected' : ''}>7</option>
              <option value="7.5">7.5</option>
              <option value="8"${set.rpe === 8 ? ' selected' : ''}>8</option>
              <option value="8.5">8.5</option>
              <option value="9"${set.rpe === 9 ? ' selected' : ''}>9</option>
              <option value="9.5">9.5</option>
              <option value="10"${set.rpe === 10 ? ' selected' : ''}>10</option>
            </select>
          </span>` : ''}
          <span class="wp-st-log">
            <button class="wp-log-set-btn" id="${setId}-log" data-set-id="${setId}" aria-label="Log set ${set.setNumber}">Log</button>
          </span>
        </div>
      `;

      // Plate calculator hint for loaded barbell exercises
      if (targetWeight > 0) {
        const plateResult = calculatePlates(targetWeight, state.weightUnit);
        const plateHint = formatPlateResult(plateResult);
        if (plateHint) {
          html += `<div class="wp-plate-hint">${escapeHtml(plateHint)}</div>`;
        }
      }

      if (set.notes) {
        html += `<div class="wp-set-note">${addTermTooltips(set.notes)}</div>`;
      }
    }

    html += `</div></div>`; // close wp-sets-tracker + wp-exercise-block
  }

  html += `
      <button id="wp-complete-workout" class="btn btn-primary wp-full-width-btn wp-complete-btn">
        Finish Workout
      </button>
    </div>
  `;

  return html;
}
