/**
 * Settings persistence/restore, variant visibility, exercise tab toggling,
 * weight unit management, and advanced settings visibility.
 * Extracted from main.ts for better module boundaries.
 */

import type { ExerciseType } from './types';
import { saveSettings, loadSettings } from './storage';

// ─── DOM Element References ───

const exerciseTypeSelect = document.getElementById('exercise-type') as HTMLSelectElement | null;
const squatTypeSelect = document.getElementById('squat-type') as HTMLSelectElement;
const deadliftTypeSelect = document.getElementById('deadlift-type') as HTMLSelectElement | null;
const benchTypeSelect = document.getElementById('bench-type') as HTMLSelectElement | null;
const ohpTypeSelect = document.getElementById('ohp-type') as HTMLSelectElement | null;
const rowTypeSelect = document.getElementById('row-type') as HTMLSelectElement | null;
const lungeTypeSelect = document.getElementById('lunge-type') as HTMLSelectElement | null;
const experienceSelect = document.getElementById('experience-level') as HTMLSelectElement;
const weightInput = document.getElementById('weight-input') as HTMLInputElement;
const liveWeightInput = document.getElementById('live-weight-input') as HTMLInputElement;
const bodyweightInput = document.getElementById('bodyweight-input') as HTMLInputElement | null;
const bodyweightUnitSelect = document.getElementById('bodyweight-unit') as HTMLSelectElement | null;
const rpeInput = document.getElementById('rpe-input') as HTMLSelectElement | null;
const trainingPhaseSelect = document.getElementById('training-phase') as HTMLSelectElement | null;

// ─── Weight Unit Management ───

/** Get the currently selected weight unit from the upload settings panel. */
export function getWeightUnit(): string {
  const active = document.querySelector('.weight-unit-btn.active') as HTMLElement | null;
  return active?.dataset.unit ?? 'lbs';
}

/** Set weight unit toggle state in both upload and live panels. */
export function setWeightUnit(unit: string): void {
  document.querySelectorAll<HTMLButtonElement>('.weight-unit-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.unit === unit);
  });
  document.querySelectorAll<HTMLButtonElement>('.live-weight-unit-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.unit === unit);
  });
}

// ─── Settings Persistence ───

/** Persist all current settings. */
export function persistSettings(): void {
  saveSettings(
    squatTypeSelect.value, experienceSelect.value, weightInput.value, getWeightUnit(),
    exerciseTypeSelect?.value, deadliftTypeSelect?.value, benchTypeSelect?.value,
    bodyweightInput?.value, bodyweightUnitSelect?.value, rpeInput?.value,
    ohpTypeSelect?.value, rowTypeSelect?.value, lungeTypeSelect?.value,
    trainingPhaseSelect?.value,
  );
}

// ─── Exercise Type ───

export function getExerciseType(): ExerciseType {
  return (exerciseTypeSelect?.value ?? 'squat') as ExerciseType;
}

// ─── Variant Visibility ───

export function updateExerciseVariantVisibility(): void {
  const exercise = getExerciseType();
  const sqGroup = document.getElementById('squat-type-group');
  const dlGroup = document.getElementById('deadlift-type-group');
  const bpGroup = document.getElementById('bench-type-group');
  const ohpGroup = document.getElementById('ohp-type-group');
  const rowGroup = document.getElementById('row-type-group');
  const lungeGroup = document.getElementById('lunge-type-group');

  if (sqGroup) sqGroup.classList.toggle('visible', exercise === 'squat');
  if (dlGroup) dlGroup.classList.toggle('visible', exercise === 'deadlift');
  if (bpGroup) bpGroup.classList.toggle('visible', exercise === 'bench_press');
  if (ohpGroup) ohpGroup.classList.toggle('visible', exercise === 'overhead_press');
  if (rowGroup) rowGroup.classList.toggle('visible', exercise === 'barbell_row');
  if (lungeGroup) lungeGroup.classList.toggle('visible', exercise === 'lunge');
}

// ─── Advanced Settings Visibility ───

/** Hide advanced settings (RPE, Training Phase, Bodyweight) for beginners. */
export function updateAdvancedSettingsVisibility(): void {
  const isBeginner = experienceSelect.value === 'beginner';
  document.querySelectorAll<HTMLElement>('.advanced-setting').forEach((el) => {
    el.classList.toggle('beginner-hidden', isBeginner);
  });
  // Hide competition mode for beginners — unnecessary cognitive load
  const compToggle = document.getElementById('competition-toggle-container');
  if (compToggle) {
    if (isBeginner) {
      compToggle.style.display = 'none';
      // Turn off competition mode if it was on when switching to beginner
      const compCheckbox = compToggle.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      if (compCheckbox && compCheckbox.checked) {
        compCheckbox.checked = false;
        compCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      compToggle.style.display = '';
    }
  }
  // Progressive disclosure: collapse "More options" for beginners, open for intermediate/advanced
  const moreSettings = document.getElementById('more-settings') as HTMLDetailsElement | null;
  if (moreSettings) {
    if (isBeginner) {
      moreSettings.removeAttribute('open');
    } else {
      moreSettings.setAttribute('open', '');
    }
  }
}

// ─── Experience Hints ───

const experienceHints: Record<string, string> = {
  beginner: 'New to squatting or <6 months of consistent practice',
  intermediate: '6 months to 2 years, comfortable with the movement',
  advanced: '2+ years, competing or training with specific goals',
};

function updateExperienceHint(): void {
  const hint = document.getElementById('experience-hint');
  if (hint) {
    hint.textContent = experienceHints[experienceSelect.value] ?? '';
  }
}

// ─── Initialize Settings ───

/** Restore saved settings and wire up all settings-related event listeners. */
export function initSettings(): void {
  const savedSettings = loadSettings();
  if (savedSettings) {
    if (savedSettings.exercise_type && exerciseTypeSelect) {
      exerciseTypeSelect.value = savedSettings.exercise_type;
      // Sync exercise tab buttons with restored setting
      document.querySelectorAll<HTMLButtonElement>('.exercise-tab').forEach((t) => {
        const isActive = t.dataset.exercise === savedSettings.exercise_type;
        t.classList.toggle('active', isActive);
        t.setAttribute('aria-checked', String(isActive));
      });
    }
    if (savedSettings.squat_type) squatTypeSelect.value = savedSettings.squat_type;
    if (savedSettings.deadlift_type && deadliftTypeSelect) deadliftTypeSelect.value = savedSettings.deadlift_type;
    if (savedSettings.bench_type && benchTypeSelect) benchTypeSelect.value = savedSettings.bench_type;
    if (savedSettings.ohp_type && ohpTypeSelect) ohpTypeSelect.value = savedSettings.ohp_type;
    if (savedSettings.row_type && rowTypeSelect) rowTypeSelect.value = savedSettings.row_type;
    if (savedSettings.lunge_type && lungeTypeSelect) lungeTypeSelect.value = savedSettings.lunge_type;
    if (savedSettings.experience_level) experienceSelect.value = savedSettings.experience_level;
    if (savedSettings.weight) {
      weightInput.value = savedSettings.weight;
      if (liveWeightInput) liveWeightInput.value = savedSettings.weight;
    }
    if (savedSettings.weight_unit) {
      setWeightUnit(savedSettings.weight_unit);
    }
    if (savedSettings.bodyweight && bodyweightInput) {
      bodyweightInput.value = savedSettings.bodyweight;
    }
    if (savedSettings.bodyweight_unit && bodyweightUnitSelect) {
      bodyweightUnitSelect.value = savedSettings.bodyweight_unit;
    }
    if (savedSettings.rpe && rpeInput) {
      rpeInput.value = savedSettings.rpe;
    }
    if (savedSettings.training_phase && trainingPhaseSelect) {
      trainingPhaseSelect.value = savedSettings.training_phase;
    }
  }

  // Exercise type select change listener
  if (exerciseTypeSelect) {
    exerciseTypeSelect.addEventListener('change', () => {
      updateExerciseVariantVisibility();
      persistSettings();
    });
    updateExerciseVariantVisibility();
  }

  // Exercise Tab Buttons (segmented control)
  document.querySelectorAll<HTMLButtonElement>('.exercise-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      // Toggle active class and aria-checked
      document.querySelectorAll<HTMLButtonElement>('.exercise-tab').forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-checked', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-checked', 'true');

      // Update hidden select value
      if (exerciseTypeSelect) {
        exerciseTypeSelect.value = tab.dataset.exercise ?? 'squat';
      }

      updateExerciseVariantVisibility();
      persistSettings();
    });
  });

  // Save settings when user changes dropdowns or weight
  squatTypeSelect.addEventListener('change', persistSettings);
  if (deadliftTypeSelect) deadliftTypeSelect.addEventListener('change', persistSettings);
  if (benchTypeSelect) benchTypeSelect.addEventListener('change', persistSettings);
  if (ohpTypeSelect) ohpTypeSelect.addEventListener('change', persistSettings);
  if (rowTypeSelect) rowTypeSelect.addEventListener('change', persistSettings);
  if (lungeTypeSelect) lungeTypeSelect.addEventListener('change', persistSettings);
  experienceSelect.addEventListener('change', persistSettings);
  weightInput.addEventListener('input', persistSettings);
  if (bodyweightInput) bodyweightInput.addEventListener('input', persistSettings);
  if (bodyweightUnitSelect) bodyweightUnitSelect.addEventListener('change', persistSettings);
  if (rpeInput) rpeInput.addEventListener('change', persistSettings);
  if (trainingPhaseSelect) trainingPhaseSelect.addEventListener('change', persistSettings);

  // Experience hint and advanced settings
  experienceSelect.addEventListener('change', () => {
    updateExperienceHint();
    updateAdvancedSettingsVisibility();
  });
  // Set initial state based on current selection
  updateExperienceHint();
  updateAdvancedSettingsVisibility();

  // Weight unit toggle buttons (upload panel)
  document.querySelectorAll<HTMLButtonElement>('.weight-unit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setWeightUnit(btn.dataset.unit ?? 'lbs');
      persistSettings();
    });
  });

  // Weight unit toggle buttons (live panel)
  document.querySelectorAll<HTMLButtonElement>('.live-weight-unit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setWeightUnit(btn.dataset.unit ?? 'lbs');
      persistSettings();
    });
  });

  // Sync live weight input with main weight input
  if (liveWeightInput) {
    liveWeightInput.addEventListener('input', () => {
      weightInput.value = liveWeightInput.value;
      persistSettings();
    });
  }

  // Sex Toggle Buttons
  document.querySelectorAll<HTMLButtonElement>('.sex-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll<HTMLButtonElement>('.sex-toggle-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-checked', String(b === btn));
      });
      persistSettings();
    });
  });

  // Exercise Tab Arrow Key Navigation (ARIA-compliant)
  const exerciseToggleContainer = document.querySelector('.exercise-toggle');
  if (exerciseToggleContainer) {
    const exerciseTabs = Array.from(exerciseToggleContainer.querySelectorAll<HTMLButtonElement>('.exercise-tab'));

    // Set initial roving tabindex: active tab gets tabindex=0, others get -1
    exerciseTabs.forEach((tab) => {
      tab.setAttribute('tabindex', tab.classList.contains('active') ? '0' : '-1');
    });

    exerciseToggleContainer.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      const currentIdx = exerciseTabs.findIndex(t => t === document.activeElement);
      if (currentIdx < 0) return;

      let nextIdx: number | null = null;

      if (ke.key === 'ArrowRight' || ke.key === 'ArrowDown') {
        ke.preventDefault();
        nextIdx = (currentIdx + 1) % exerciseTabs.length;
      } else if (ke.key === 'ArrowLeft' || ke.key === 'ArrowUp') {
        ke.preventDefault();
        nextIdx = (currentIdx - 1 + exerciseTabs.length) % exerciseTabs.length;
      } else if (ke.key === 'Home') {
        ke.preventDefault();
        nextIdx = 0;
      } else if (ke.key === 'End') {
        ke.preventDefault();
        nextIdx = exerciseTabs.length - 1;
      }

      if (nextIdx !== null) {
        // Roving tabindex: move tabindex=0 to the new tab
        exerciseTabs.forEach(t => t.setAttribute('tabindex', '-1'));
        exerciseTabs[nextIdx].setAttribute('tabindex', '0');
        exerciseTabs[nextIdx].focus();
        exerciseTabs[nextIdx].click();
      }
    });
  }

  return;
}

/** Return the saved settings (for use by main.ts during init). */
export function getSavedSettings() {
  return loadSettings();
}
