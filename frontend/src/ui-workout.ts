/**
 * Workout programming UI: program selection, daily workout display,
 * set logging, transition recommendations, and progress tracking.
 */

import type { ProgramDefinition, UserProfile, EquipmentLevel, ProgramLevel } from './workout-programs';
import { PROGRAMS, recommendPrograms, EXERCISE_SLOTS, getExerciseName } from './workout-programs';
import {
  loadProgramState, saveProgramState, loadUserProfile, saveUserProfile,
  loadWorkoutLogs, saveWorkoutLogs,
  initializeProgram, generateWorkout, recordSetResult, advanceWorkout,
  autoregulate, getTransitionRecommendations, recommendAccessories,
  roundToPlate, get531WeekSets,
  processAdaptations,
  getRecentFormScores,
  getRecentWeakDimensions,
  getEstimated1RMs,
} from './program-generator';
import type {
  ProgramState, WorkoutLog, WorkoutSet, GeneratedWorkout, TransitionRecommendation,
  PostWorkoutFeedback,
  AdaptationDecision,
  ReadinessData,
  ScheduleOverride,
} from './program-generator';
import { escapeHtml } from './ui-utilities';
import { parseProgramText, buildCustomProgram, saveCustomProgram } from './custom-program';
import { RestTimer, formatRestTime } from './rest-timer';
import { checkForPR, getAllPRsByLift } from './pr-tracker';
import { calculatePlates, formatPlateResult } from './plate-calculator';
import { calculateE1RMFromRPE, calculateWeightForTarget, getRPEDescription, generatePrescriptionTable } from './rpe-calculator';
import { buildCalendarMonth, calculateStreak } from './workout-calendar';
import { calculateWeeklyVolume, getUndertrainedMuscles, getOvertrainedMuscles } from './volume-tracker';
import { getExerciseDemo } from './exercise-demos';
import { getBeginnerGuide } from './beginner-guide';
import { renderStrengthCard } from './strength-standards';
import { renderCompTotalCard, calculateCompTotal, saveCompTotal, loadCompTotals, renderCommandsReference } from './competition';
import { calculateWilks2, calculateGLPoints, computeDOTS } from './one-rm';
import { renderPainPrompt, handlePainReport, shouldShowPainPrompt, savePainReport, checkPainRedFlags, CONDITIONS_DATABASE, savePreExistingConditions, loadPreExistingConditions } from './safety-screening';
import type { WeightRecommendation, AdaptationResult } from './program-generator';

// ─── Terminology Glossary ───

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
function addTermTooltips(text: string): string {
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

// ─── Pre-Existing Conditions Checkbox Renderer ───

function renderConditionCheckboxes(): string {
  const existingConditions = loadPreExistingConditions();
  const categoryLabels: Record<string, string> = {
    joint: 'Joint',
    spine: 'Spine',
    shoulder: 'Shoulder',
    cardiovascular: 'Cardiovascular',
    neurological: 'Neurological',
    other: 'Other',
  };

  const grouped = new Map<string, typeof CONDITIONS_DATABASE>();
  for (const condition of CONDITIONS_DATABASE) {
    const group = grouped.get(condition.category) || [];
    group.push(condition);
    grouped.set(condition.category, group);
  }

  let html = '';
  for (const [category, conditions] of grouped) {
    const label = categoryLabels[category] || category;
    html += `<div class="wp-condition-group"><span class="wp-condition-group-label">${escapeHtml(label)}</span>`;
    for (const condition of conditions) {
      const isChecked = existingConditions.includes(condition.id) ? 'checked' : '';
      html += `
        <label class="wp-condition-checkbox-label">
          <input type="checkbox" name="wp-condition" value="${escapeHtml(condition.id)}" ${isChecked} class="wp-condition-cb" />
          <span>${escapeHtml(condition.name)}</span>
        </label>
      `;
    }
    html += `</div>`;
  }
  return html;
}

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
const INJURY_AREAS = ['lower back', 'knees', 'shoulders', 'elbows', 'hips', 'wrists'];
const INJURY_SEVERITIES = ['minor discomfort', 'pain during exercise', 'pain after exercise', 'cannot perform'];

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
function safeSaveProgramState(state: ProgramState, container?: HTMLElement): boolean {
  try {
    localStorage.setItem('squat_form_program_state', JSON.stringify(state));
    return true;
  } catch {
    if (container) showStorageWarning(container);
    return false;
  }
}

function safeSaveWorkoutLogs(logs: WorkoutLog[], container?: HTMLElement): boolean {
  try {
    if (logs.length > 200) logs.length = 200;
    localStorage.setItem('squat_form_workout_logs', JSON.stringify(logs));
    return true;
  } catch {
    if (container) showStorageWarning(container);
    return false;
  }
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
    renderProgramSetup(container, profile);
  }
}

// ─── Program Setup ───

function renderProgramSetup(container: HTMLElement, existingProfile: UserProfile | null): void {
  container.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'card card--static';
  card.setAttribute('role', 'region');
  card.setAttribute('aria-label', 'Program setup');

  card.innerHTML = `
    <h3 class="section-heading-sm wp-setup-heading">Get Your Training Program</h3>
    <p class="training-rec-desc wp-setup-desc">
      Answer 3 questions and we'll match you with a proven strength program.
    </p>

    <details class="wp-beginner-guide-toggle">
      <summary class="wp-guide-link">New to lifting? Read the 80/20 beginner guide first</summary>
      <div class="wp-beginner-guide" id="wp-beginner-guide"></div>
    </details>

    <p class="training-rec-desc wp-setup-desc" style="margin-top: var(--space-md);">&nbsp;
      Includes automatic progression, deload scheduling, and adjustments based on your feedback.
    </p>

    <div class="wp-setup-form">
      <div class="form-group">
        <label for="wp-goal" class="form-label">What's your goal?</label>
        <select id="wp-goal" class="form-select">
          <option value="strength">Build strength</option>
          <option value="hypertrophy">Build muscle (hypertrophy)</option>
          <option value="powerbuilding">Strength + muscle (powerbuilding)</option>
          <option value="general">General fitness</option>
          <option value="powerlifting">Compete in powerlifting</option>
        </select>
      </div>

      <div class="form-group">
        <label for="wp-experience" class="form-label">How long have you been training?</label>
        <select id="wp-experience" class="form-select">
          <option value="beginner" ${existingProfile?.experienceLevel === 'beginner' ? 'selected' : ''}>Beginner (0-12 months)</option>
          <option value="intermediate" ${existingProfile?.experienceLevel === 'intermediate' ? 'selected' : ''}>Intermediate (1-3 years)</option>
          <option value="advanced" ${existingProfile?.experienceLevel === 'advanced' ? 'selected' : ''}>Advanced (3+ years)</option>
        </select>
      </div>

      <div class="form-group">
        <label for="wp-days" class="form-label">How many days per week can you train?</label>
        <select id="wp-days" class="form-select">
          <option value="2" ${existingProfile?.daysPerWeek === 2 ? 'selected' : ''}>2 days/week (minimal but effective)</option>
          <option value="3" ${existingProfile?.daysPerWeek === 3 ? 'selected' : ''}>3 days/week</option>
          <option value="4" ${existingProfile?.daysPerWeek === 4 ? 'selected' : ''}>4 days/week</option>
          <option value="5">5 days/week</option>
          <option value="6">6 days/week</option>
        </select>
      </div>

      <div class="form-group">
        <label class="wp-never-lifted-label">
          <input type="checkbox" id="wp-never-lifted" class="wp-never-lifted-cb" />
          <span>I've never barbell trained before</span>
        </label>
        <p class="wp-help-text">No problem -- we'll start you with the empty bar and build from there.</p>
      </div>

      <details id="wp-advanced-options" class="wp-advanced-options">
        <summary class="wp-advanced-summary">More options (equipment, bodyweight, maxes)</summary>
        <div class="wp-advanced-grid">
          <div class="form-group">
            <label for="wp-equipment" class="form-label">Equipment Access</label>
            <select id="wp-equipment" class="form-select">
              <option value="full_gym">Full gym (barbells, dumbbells, machines, cables)</option>
              <option value="barbell_home">Home gym (barbell + squat rack)</option>
              <option value="dumbbells">Dumbbells only</option>
              <option value="bodyweight">Bodyweight only</option>
              <option value="mixed">Mixed (barbell for main lifts + dumbbells)</option>
            </select>
          </div>

          <div class="form-group">
            <label for="wp-sex" class="form-label">Biological Sex</label>
            <select id="wp-sex" class="form-select">
              <option value="male"${existingProfile?.sex === 'male' ? ' selected' : ''}>Male</option>
              <option value="female"${existingProfile?.sex === 'female' ? ' selected' : ''}>Female</option>
            </select>
          </div>

          <div class="form-group">
            <label for="wp-bodyweight" class="form-label">Bodyweight (optional)</label>
            <div class="wp-bw-row">
              <input id="wp-bodyweight" type="number" class="form-input" placeholder="e.g. 180" min="50" max="500" step="1" value="${existingProfile?.bodyweight ?? ''}" />
              <span id="wp-bw-unit" class="wp-bw-unit">lbs</span>
            </div>
            <p class="wp-help-text">Helps set better starting weights.</p>
          </div>

          <div class="form-group">
            <label for="wp-session-duration" class="form-label">Session Duration</label>
            <select id="wp-session-duration" class="form-select">
              <option value="30">30 min (minimal)</option>
              <option value="45">45 min (efficient)</option>
              <option value="60" selected>60 min (standard)</option>
              <option value="75">75 min (extended)</option>
              <option value="90">90 min (long)</option>
              <option value="120">120 min (full session)</option>
            </select>
          </div>

          <div class="form-group">
            <label for="wp-planned-duration" class="form-label">Program Commitment</label>
            <select id="wp-planned-duration" class="form-select">
              <option value="">No specific timeframe</option>
              <option value="4">4 weeks (try it out)</option>
              <option value="8">8 weeks (one training block)</option>
              <option value="12">12 weeks (recommended)</option>
              <option value="16">16 weeks (full cycle)</option>
              <option value="24">24+ weeks (long-term)</option>
            </select>
            <p class="wp-help-text">Most programs need 8-12 weeks to see results. You can always change later.</p>
          </div>

          <div class="form-group">
            <label for="wp-meet-date" class="form-label">Competition Date (optional)</label>
            <input id="wp-meet-date" type="date" class="form-input" value="${existingProfile?.meetDate ?? ''}" min="${new Date().toISOString().slice(0, 10)}" />
            <p class="wp-help-text">Enables automatic peaking. Leave blank if not competing.</p>
          </div>

          <div class="form-group" id="wp-conditions-group">
            <label class="form-label">Pre-existing conditions (optional)</label>
            <p class="wp-help-text">Select any that apply — we'll modify exercise recommendations accordingly.</p>
            <div class="wp-conditions-list" id="wp-conditions-list">
              ${renderConditionCheckboxes()}
            </div>
          </div>

          <div class="form-group" id="wp-maxes-group">
            <label class="form-label">Current Maxes (optional)</label>
            <p class="wp-help-text" style="margin-bottom: var(--space-xs);">The heaviest weight you've lifted for 1 rep with good form. Leave blank if unsure.</p>
            <div class="wp-maxes-grid">
              <div>
                <label for="wp-squat-max" class="form-label-sm">Squat</label>
                <input id="wp-squat-max" type="number" class="form-input" placeholder="lbs" min="0" max="1500" step="5" />
              </div>
              <div>
                <label for="wp-bench-max" class="form-label-sm">Bench</label>
                <input id="wp-bench-max" type="number" class="form-input" placeholder="lbs" min="0" max="1500" step="5" />
              </div>
              <div>
                <label for="wp-deadlift-max" class="form-label-sm">Deadlift</label>
                <input id="wp-deadlift-max" type="number" class="form-input" placeholder="lbs" min="0" max="1500" step="5" />
              </div>
              <div>
                <label for="wp-ohp-max" class="form-label-sm">OHP</label>
                <input id="wp-ohp-max" type="number" class="form-input" placeholder="lbs" min="0" max="1500" step="5" />
              </div>
            </div>
            <div class="wp-unit-row">
              <span class="form-label-sm">Unit:</span>
              <label class="wp-radio-label"><input type="radio" name="wp-unit" value="lbs" checked /> lbs</label>
              <label class="wp-radio-label"><input type="radio" name="wp-unit" value="kg" /> kg</label>
            </div>
          </div>
        </div>
      </details>

      <button id="wp-find-programs" class="btn btn-primary wp-find-btn">
        Find My Program
      </button>
    </div>

    <details class="wp-custom-section-details">
      <summary class="wp-custom-divider-summary">
        <span>Or build your own program</span>
      </summary>

      <div class="wp-custom-section">
        <p class="wp-custom-desc">Describe your program in plain text. Include exercises, sets, reps, and progression rules.</p>

        <textarea id="wp-custom-input" class="wp-custom-textarea" rows="8" placeholder="Example:
name: My Strength Program
4 days/week, deload every 4 weeks

Squat 3x5 @ RPE 8, 2x/week, start 185 lbs, increase 5 lbs/week
Bench Press 3x5 @ RPE 8, 2x/week, start 135 lbs, increase 5 lbs/week
Deadlift 1x5 @ RPE 9, 1x/week, start 225 lbs, increase 5 lbs/week
OHP 3x5 @ RPE 7, 1x/week, start 95 lbs, increase 2.5 lbs/week"></textarea>

        <div class="wp-custom-options">
          <div class="form-group">
            <label class="form-label-sm">Auto-progression:</label>
            <select id="wp-custom-auto-progress" class="form-select">
              <option value="auto_increase">Auto-increase weight when RPE target is easy</option>
              <option value="auto_deload">Auto-deload when fatigue is detected</option>
              <option value="both" selected>Both (recommended)</option>
              <option value="manual">Manual only (I'll decide)</option>
            </select>
          </div>
        </div>

        <button id="wp-custom-generate" class="btn btn-primary wp-full-width-btn">
          Generate Program
        </button>

        <div id="wp-custom-preview" style="display:none;"></div>
      </div>
    </details>

    <div id="wp-recommendations" class="wp-recommendations" aria-live="polite"></div>
  `;

  container.appendChild(card);

  // Render beginner guide content
  const guideContainer = card.querySelector('#wp-beginner-guide') as HTMLElement;
  if (guideContainer) {
    const guide = getBeginnerGuide();
    let guideHtml = '';
    for (const section of guide) {
      guideHtml += `
        <div class="wp-guide-section">
          <h4 class="wp-guide-section-title">${section.icon} ${escapeHtml(section.title)}</h4>
          <div class="wp-guide-section-content">${section.content}</div>
          <div class="wp-guide-takeaway">
            <strong>Key takeaway:</strong> ${escapeHtml(section.takeaway)}
          </div>
          ${section.source ? `<div class="wp-guide-source">Source: ${escapeHtml(section.source)}</div>` : ''}
        </div>
      `;
    }
    guideContainer.innerHTML = guideHtml;
  }

  // Auto-expand advanced options for returning users who have saved profiles
  if (existingProfile && (existingProfile.maxes || existingProfile.bodyweight || existingProfile.meetDate)) {
    const advancedDetails = card.querySelector('#wp-advanced-options') as HTMLDetailsElement;
    if (advancedDetails) advancedDetails.open = true;
  }

  // "Never lifted" checkbox: hide maxes when checked
  const neverLiftedCb = card.querySelector('#wp-never-lifted') as HTMLInputElement;
  const maxesGroup = card.querySelector('#wp-maxes-group') as HTMLElement;
  if (neverLiftedCb && maxesGroup) {
    neverLiftedCb.addEventListener('change', () => {
      maxesGroup.style.display = neverLiftedCb.checked ? 'none' : '';
    });
  }

  // Wire up "Find My Program"
  const findBtn = card.querySelector('#wp-find-programs') as HTMLButtonElement;
  findBtn.addEventListener('click', () => {
    const profile = gatherProfile(card);
    saveUserProfile(profile);
    // Save pre-existing conditions
    const selectedConditions: string[] = [];
    card.querySelectorAll<HTMLInputElement>('.wp-condition-cb:checked').forEach(cb => {
      selectedConditions.push(cb.value);
    });
    savePreExistingConditions(selectedConditions);
    const recsContainer = card.querySelector('#wp-recommendations') as HTMLElement;
    renderProgramRecommendations(recsContainer, profile, container);
  });

  // Wire up "Generate Program" (custom program builder)
  const generateBtn = card.querySelector('#wp-custom-generate') as HTMLButtonElement;
  generateBtn?.addEventListener('click', () => {
    const text = (card.querySelector('#wp-custom-input') as HTMLTextAreaElement)?.value;
    if (!text?.trim()) return;

    const config = parseProgramText(text);
    if (config.exercises.length === 0) {
      const preview = card.querySelector('#wp-custom-preview') as HTMLElement;
      if (preview) {
        preview.style.display = 'block';
        preview.innerHTML = `<p class="wp-error-text" style="margin-top:var(--space-sm)">No exercises detected. Each exercise needs a sets x reps pattern (e.g. "Squat 3x5").</p>`;
      }
      return;
    }

    const program = buildCustomProgram(config);

    // Apply equipment level from the setup form
    const equipment = (card.querySelector('#wp-equipment') as HTMLSelectElement)?.value as EquipmentLevel;
    program.equipmentMin = equipment;

    // Store auto-progression preference in the program description
    const autoProgress = (card.querySelector('#wp-custom-auto-progress') as HTMLSelectElement)?.value;
    if (autoProgress && autoProgress !== 'both') {
      const labels: Record<string, string> = {
        auto_increase: 'Auto-increase only',
        auto_deload: 'Auto-deload only',
        manual: 'Manual progression',
      };
      program.description += ` Progression mode: ${labels[autoProgress] ?? autoProgress}.`;
    }

    // Show preview
    const preview = card.querySelector('#wp-custom-preview') as HTMLElement;
    if (preview) {
      preview.style.display = 'block';
      let previewHtml = `
        <div class="card card--static wp-custom-preview-card">
          <h4 class="section-heading-sm">Program Preview: ${escapeHtml(program.name)}</h4>
          <div class="wp-custom-meta">${config.daysPerWeek} days/week · ${config.exercises.length} exercises · Deload every ${config.deloadFrequency} weeks</div>
      `;

      for (const day of program.workouts) {
        previewHtml += `
          <div class="wp-preview-day">
            <strong>${escapeHtml(day.dayLabel)}</strong>
            <ul class="wp-preview-exercises">
        `;
        for (const ex of day.exercises) {
          const set = ex.sets[0];
          previewHtml += `<li>${escapeHtml(ex.exerciseSlot)} — ${set.sets}\u00d7${set.reps}${set.rpe ? ` @ RPE ${set.rpe}` : ''}${set.notes ? ` (${escapeHtml(set.notes)})` : ''}</li>`;
        }
        previewHtml += `</ul></div>`;
      }

      previewHtml += `
          <button id="wp-custom-start" class="btn btn-primary wp-full-width-btn" style="margin-top:var(--space-md)">Start This Program</button>
        </div>
      `;
      preview.innerHTML = previewHtml;

      // Wire "Start This Program" button
      card.querySelector('#wp-custom-start')?.addEventListener('click', () => {
        saveCustomProgram(program);

        // Register in the runtime PROGRAMS map so initializeProgram can find it
        PROGRAMS[program.id] = program;

        const profile = gatherProfile(card);
        const unit = (card.querySelector('input[name="wp-unit"]:checked') as HTMLInputElement)?.value ?? 'lbs';

        // Save pre-existing conditions
        const customSelectedConditions: string[] = [];
        card.querySelectorAll<HTMLInputElement>('.wp-condition-cb:checked').forEach(cb => {
          customSelectedConditions.push(cb.value);
        });
        savePreExistingConditions(customSelectedConditions);

        // Override maxes with custom exercise starting weights
        const maxes: Partial<Record<string, number>> = { ...(profile.maxes ?? {}) };
        for (const ex of config.exercises) {
          if (ex.startWeight) {
            maxes[ex.slot] = ex.startWeight;
          }
        }
        profile.maxes = Object.keys(maxes).length > 0 ? maxes : undefined;

        saveUserProfile(profile);
        const state = initializeProgram(program.id, profile, unit);
        saveProgramState(state);
        renderActiveProgram(container, state);
      });
    }
  });
}

function gatherProfile(card: HTMLElement): UserProfile {
  const experience = (card.querySelector('#wp-experience') as HTMLSelectElement).value as ProgramLevel;
  const days = parseInt((card.querySelector('#wp-days') as HTMLSelectElement).value, 10);
  const equipment = (card.querySelector('#wp-equipment') as HTMLSelectElement).value as EquipmentLevel;
  const goal = (card.querySelector('#wp-goal') as HTMLSelectElement).value as any;
  const unit = (card.querySelector('input[name="wp-unit"]:checked') as HTMLInputElement)?.value ?? 'lbs';

  const sex = (card.querySelector('#wp-sex') as HTMLSelectElement)?.value as 'male' | 'female' | undefined;
  const rawBw = parseFloat((card.querySelector('#wp-bodyweight') as HTMLInputElement)?.value ?? '');
  const bodyweight = isFinite(rawBw) && rawBw > 0 ? rawBw : undefined;
  const meetDate = (card.querySelector('#wp-meet-date') as HTMLInputElement)?.value || undefined;
  const sessionDuration = parseInt((card.querySelector('#wp-session-duration') as HTMLSelectElement)?.value ?? '60', 10);
  const plannedDuration = parseInt((card.querySelector('#wp-planned-duration') as HTMLSelectElement)?.value ?? '0', 10);

  const neverLifted = (card.querySelector('#wp-never-lifted') as HTMLInputElement)?.checked ?? false;

  const maxes: Record<string, number> = {};
  if (neverLifted) {
    const barWeight = unit === 'kg' ? 20 : 45;
    maxes.squat = barWeight;
    maxes.bench = barWeight;
    maxes.deadlift = barWeight;
    maxes.ohp = barWeight;
  } else {
    const squatMax = parseFloat((card.querySelector('#wp-squat-max') as HTMLInputElement).value);
    const benchMax = parseFloat((card.querySelector('#wp-bench-max') as HTMLInputElement).value);
    const deadliftMax = parseFloat((card.querySelector('#wp-deadlift-max') as HTMLInputElement).value);
    const ohpMax = parseFloat((card.querySelector('#wp-ohp-max') as HTMLInputElement).value);
    if (squatMax > 0) maxes.squat = squatMax;
    if (benchMax > 0) maxes.bench = benchMax;
    if (deadliftMax > 0) maxes.deadlift = deadliftMax;
    if (ohpMax > 0) maxes.ohp = ohpMax;
  }

  return {
    experienceLevel: experience,
    daysPerWeek: days,
    equipment,
    goal,
    maxes: Object.keys(maxes).length > 0 ? maxes : undefined,
    sex,
    bodyweight,
    meetDate,
    sessionDurationMinutes: sessionDuration,
    plannedDurationWeeks: plannedDuration || undefined,
  };
}

// ─── Program Recommendations ───

function renderProgramRecommendations(
  container: HTMLElement,
  profile: UserProfile,
  parentContainer: HTMLElement,
): void {
  const programs = recommendPrograms(profile);

  if (programs.length === 0) {
    container.innerHTML = `
      <div class="card wp-no-match-card">
        <p class="wp-note-text">No programs match your criteria. Try adjusting your equipment level or training days.</p>
      </div>
    `;
    container.style.display = 'block';
    return;
  }

  let html = '<h4 class="section-heading-sm wp-recs-heading">Recommended Programs</h4>';

  for (let i = 0; i < programs.length; i++) {
    const program = programs[i];
    const levelClass = `wp-level-${program.level}`;
    const isBestMatch = i === 0;

    html += `
      <div class="card program-rec-card${isBestMatch ? ' wp-best-match' : ''}" data-program-id="${escapeHtml(program.id)}" tabindex="0" role="button" aria-label="${isBestMatch ? 'Best match: ' : ''}Select ${escapeHtml(program.name)}: ${escapeHtml(program.description)}">
        ${isBestMatch ? '<div class="wp-best-match-badge">Best Match</div>' : ''}
        <div class="wp-rec-header">
          <h5 class="wp-rec-name">${escapeHtml(program.name)}</h5>
          <span class="phase-badge-inline ${levelClass}">${escapeHtml(program.level)}</span>
        </div>
        <div class="wp-rec-meta">
          by ${escapeHtml(program.author)} &middot; ${program.daysPerWeek.join('-')} days/week &middot; ${program.typicalDurationWeeks[0]}-${program.typicalDurationWeeks[1]} weeks
        </div>
        <p class="wp-rec-desc">${escapeHtml(program.description)}</p>
        <details class="wp-science-details">
          <summary class="wp-science-summary">Why this works (science)</summary>
          <p class="wp-science-text">${escapeHtml(program.scienceBasis)}</p>
        </details>
      </div>
    `;
  }

  container.innerHTML = html;
  container.style.display = 'block';

  // Wire up program selection
  container.querySelectorAll<HTMLElement>('.program-rec-card').forEach(card => {
    const handler = () => {
      const programId = card.dataset.programId;
      if (!programId) return;
      selectProgram(programId, profile, parentContainer);
    };
    card.addEventListener('click', handler);
    card.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
    });
  });
}

function selectProgram(programId: string, profile: UserProfile, parentContainer: HTMLElement): void {
  const unit = (document.querySelector('input[name="wp-unit"]:checked') as HTMLInputElement)?.value ?? 'lbs';
  const state = initializeProgram(programId, profile, unit);
  saveProgramState(state);
  renderActiveProgram(parentContainer, state);
}

// ─── Active Program View ───

function renderActiveProgram(container: HTMLElement, state: ProgramState): void {
  // Clean up any active timer before re-rendering
  activeRestTimer?.stop();

  container.innerHTML = '';

  const program = PROGRAMS[state.programId];
  if (!program) {
    renderProgramSetup(container, loadUserProfile());
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
      renderProgramSetup(container, loadUserProfile());
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

  // Today's workout
  html += renderWorkoutCard(workout, state);

  // Notes
  if (workout.notes.length > 0) {
    html += `<div class="card card--static wp-notes-card">`;
    for (const note of workout.notes) {
      html += `<p class="wp-note-text">${addTermTooltips(note)}</p>`;
    }
    html += `</div>`;
  }

  // Accessory recommendations from form analysis
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

  // Training calendar — only show after 3 workouts (need some data to be useful)
  if (state.workoutsCompleted >= 3) {
    const calNow = new Date();
    const calMonth = buildCalendarMonth(calNow.getFullYear(), calNow.getMonth(), logs);
    const streak = calculateStreak(logs, program.daysPerWeek[0]);
    html += renderCalendarCard(calMonth, streak);
  }

  // Muscle volume tracker — only show after 10 workouts
  if (state.workoutsCompleted >= 10) {
    const volumeLogs = logs.map(l => ({
      date: l.date,
      sets: l.sets.map(s => ({ exerciseSlot: s.exerciseSlot, completed: s.completed })),
    }));
    const volumes = calculateWeeklyVolume(volumeLogs, 1);
    const undertrained = getUndertrainedMuscles(volumes);
    const overtrained = getOvertrainedMuscles(volumes);
    html += renderVolumeCard(volumes, undertrained, overtrained);
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

  container.innerHTML = html;

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
          renderProgramSetup(container, loadUserProfile());
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
          <div class="wp-rpe-result-detail">From ${weightVal} ${escapeHtml(unit)} × ${repsVal} @ RPE ${rpeVal} (${calc.percentOf1RM}% of 1RM)</div>
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

  // Wire up set completion
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
          () => completeWorkout(container, state, workout),
        );
      } else if (checkedCount < totalCount) {
        showConfirmDialog(
          container,
          'Incomplete Workout',
          `You completed ${checkedCount} of ${totalCount} sets. Unchecked sets will be recorded as skipped. Continue?`,
          'Complete Workout',
          () => completeWorkout(container, state, workout),
        );
      } else {
        completeWorkout(container, state, workout);
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

// ─── Post-Workout Feedback Form ───

function renderFeedbackForm(
  container: HTMLElement,
  state: ProgramState,
  workout: GeneratedWorkout,
  sets: WorkoutSet[],
  log: WorkoutLog,
  progressMessages: string[],
): void {
  // Progressive disclosure: first 3 workouts show simplified feedback
  const isEarlyWorkout = state.workoutsCompleted <= 3;

  // Find main lifts in this workout for per-lift RPE
  const mainLifts = workout.exercises.filter(e => {
    const slot = EXERCISE_SLOTS[e.exerciseSlot];
    return slot?.isMainLift;
  });

  let html = `
    <div class="card card--static wp-feedback-card">
      <h3 class="section-heading-sm">How'd It Go?</h3>
      <p class="wp-note-text">${isEarlyWorkout ? 'Quick check-in -- this helps us adjust your next workout.' : 'Your feedback directly adjusts your next workout.'}</p>

      <form id="wp-feedback-form">
        <div class="form-group">
          <label class="form-label">How did this session feel?</label>
          <div class="wp-difficulty-btns">
            <button type="button" class="wp-difficulty-btn" data-difficulty="too_easy">Too Easy</button>
            <button type="button" class="wp-difficulty-btn" data-difficulty="just_right">Just Right</button>
            <button type="button" class="wp-difficulty-btn" data-difficulty="too_hard">Too Hard</button>
            <button type="button" class="wp-difficulty-btn" data-difficulty="could_not_finish">Couldn't Finish</button>
          </div>
          <p class="wp-fb-error-text wp-hidden" id="wp-fb-difficulty-error">Please select how the workout felt.</p>
          <input type="hidden" id="wp-fb-difficulty" value="" />
        </div>
  `;

  // Per-lift RPE -- only after 3 workouts
  if (!isEarlyWorkout && mainLifts.length > 0) {
    html += `<div class="form-group">
      <label class="form-label">Rate of Perceived Exertion (per lift)</label>`;
    for (const lift of mainLifts) {
      html += `
        <div class="wp-rpe-row">
          <span class="wp-rpe-lift-name">${escapeHtml(lift.name)}</span>
          <select class="form-select wp-rpe-select" data-exercise="${escapeHtml(lift.exerciseSlot)}">
            <option value="">Select RPE</option>
            <option value="6">RPE 6 — Could do 4+ more reps</option>
            <option value="7">RPE 7 — Could do 3 more reps</option>
            <option value="8">RPE 8 — Could do 2 more reps</option>
            <option value="9">RPE 9 — Could do 1 more rep</option>
            <option value="10">RPE 10 — Maximum effort</option>
          </select>
        </div>
      `;
    }
    html += `</div>`;
  }

  // Soreness -- only after 3 workouts
  if (!isEarlyWorkout) {
    html += `
      <div class="form-group">
        <label for="wp-fb-soreness" class="form-label">Current soreness level</label>
        <select id="wp-fb-soreness" class="form-select">
          <option value="none">None</option>
          <option value="mild">Mild</option>
          <option value="moderate">Moderate</option>
          <option value="severe">Severe</option>
          <option value="extreme">Extreme</option>
        </select>
      </div>
    `;
  }

  // Injury check -- always shown (safety-critical)
  html += `
    <div class="form-group wp-injury-section">
      <label class="form-label">Any pain or discomfort?</label>
      <div class="wp-readiness-scale" role="radiogroup" aria-label="Pain check">
        <input type="radio" name="wp-fb-injury" id="wp-inj-no" value="no" checked class="wp-scale-input" />
        <label for="wp-inj-no" class="wp-scale-label" tabindex="-1">No</label>
        <input type="radio" name="wp-fb-injury" id="wp-inj-yes" value="yes" class="wp-scale-input" />
        <label for="wp-inj-yes" class="wp-scale-label" tabindex="-1">Yes</label>
      </div>
      <div id="wp-injury-details" class="wp-hidden">
        <label class="form-label-sm">Body area(s) affected</label>
        <div class="wp-injury-areas">
  `;
  for (const area of INJURY_AREAS) {
    html += `
      <label class="wp-radio-label">
        <input type="checkbox" class="wp-injury-area-cb" value="${escapeHtml(area)}" /> ${escapeHtml(area)}
      </label>
    `;
  }
  html += `
        </div>
        <label for="wp-injury-severity" class="form-label-sm">Severity</label>
        <select id="wp-injury-severity" class="form-select">
  `;
  for (const sev of INJURY_SEVERITIES) {
    html += `<option value="${escapeHtml(sev)}">${escapeHtml(sev)}</option>`;
  }
  html += `
        </select>
      </div>
    </div>
  `;

  // Notes
  html += `
    <div class="form-group">
      <label for="wp-fb-notes" class="form-label">Notes (optional)</label>
      <textarea id="wp-fb-notes" class="form-input wp-feedback-textarea" rows="2" placeholder="Anything else noteworthy..."></textarea>
    </div>

    <button type="submit" class="btn btn-primary wp-full-width-btn">
      ${isEarlyWorkout ? 'Submit &amp; Continue' : 'Submit &amp; See What Changes'}
    </button>
      </form>
    </div>
  `;

  container.innerHTML = html;

  // Wire up difficulty buttons
  container.querySelectorAll<HTMLButtonElement>('.wp-difficulty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.wp-difficulty-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      (container.querySelector('#wp-fb-difficulty') as HTMLInputElement).value = btn.dataset.difficulty ?? '';
      // Clear any existing error state
      container.querySelector('.wp-difficulty-btns')?.classList.remove('wp-field-error');
      const errorText = container.querySelector('#wp-fb-difficulty-error');
      if (errorText) errorText.classList.add('wp-hidden');
    });
  });

  // Wire up injury toggle
  container.querySelectorAll<HTMLInputElement>('input[name="wp-fb-injury"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const details = container.querySelector('#wp-injury-details') as HTMLElement;
      if (details) {
        if (radio.value === 'yes' && radio.checked) {
          details.classList.remove('wp-hidden');
        } else {
          details.classList.add('wp-hidden');
        }
      }
    });
  });

  // Wire up form submission
  const form = container.querySelector('#wp-feedback-form') as HTMLFormElement;
  form.addEventListener('submit', (e: Event) => {
    e.preventDefault();

    const difficulty = (container.querySelector('#wp-fb-difficulty') as HTMLInputElement).value as PostWorkoutFeedback['sessionDifficulty'];
    if (!difficulty) {
      // Highlight difficulty buttons and show error text
      const btns = container.querySelector('.wp-difficulty-btns') as HTMLElement;
      if (btns) btns.classList.add('wp-field-error');
      const errorText = container.querySelector('#wp-fb-difficulty-error');
      if (errorText) errorText.classList.remove('wp-hidden');
      btns?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const liftRPEs: Record<string, number> = {};
    container.querySelectorAll<HTMLSelectElement>('.wp-rpe-select').forEach(sel => {
      const slot = sel.dataset.exercise ?? '';
      const val = parseInt(sel.value, 10);
      if (slot && val) liftRPEs[slot] = val;
    });

    const soreness = (container.querySelector('#wp-fb-soreness') as HTMLSelectElement).value as PostWorkoutFeedback['soreness'];

    const injuryReported = (container.querySelector('#wp-inj-yes') as HTMLInputElement)?.checked ?? false;
    const injuryAreas: string[] = [];
    container.querySelectorAll<HTMLInputElement>('.wp-injury-area-cb:checked').forEach(cb => {
      injuryAreas.push(cb.value);
    });
    const injurySeverity = (container.querySelector('#wp-injury-severity') as HTMLSelectElement)?.value;

    const notes = (container.querySelector('#wp-fb-notes') as HTMLTextAreaElement)?.value || undefined;

    // Build injury reports from checkboxes
    const injuries: Array<{ bodyArea: string; status: 'none' | 'minor_discomfort' | 'pain_during_exercise' | 'pain_after_exercise' | 'cannot_perform'; aggravatingExercises: string[] }> = [];
    if (injuryReported && injuryAreas.length > 0) {
      const statusMap: Record<string, 'minor_discomfort' | 'pain_during_exercise' | 'pain_after_exercise' | 'cannot_perform'> = {
        'minor discomfort': 'minor_discomfort',
        'pain during exercise': 'pain_during_exercise',
        'pain after exercise': 'pain_after_exercise',
        'cannot perform': 'cannot_perform',
      };
      const mappedStatus = statusMap[injurySeverity ?? ''] ?? 'minor_discomfort';
      // Associate injuries with the exercises in this workout
      const workoutExercises = workout.exercises.map(ex => ex.exerciseSlot);
      for (const area of injuryAreas) {
        injuries.push({
          bodyArea: area.replace(/ /g, '_'),
          status: mappedStatus,
          aggravatingExercises: workoutExercises,
        });
      }
    }

    const feedback: PostWorkoutFeedback = {
      sessionDifficulty: difficulty,
      liftRPE: liftRPEs,
      sessionRPE: Object.values(liftRPEs).length > 0
        ? Math.round(Object.values(liftRPEs).reduce((a, b) => a + b, 0) / Object.values(liftRPEs).length)
        : 7,
      soreness,
      injuries,
      notes: notes ?? '',
    };

    // Save sessionDifficulty to the workout log
    const recentLogs = loadWorkoutLogs();
    if (recentLogs.length > 0 && recentLogs[0].id === log.id) {
      recentLogs[0].sessionDifficulty = feedback.sessionDifficulty;
      safeSaveWorkoutLogs(recentLogs, container);
    }

    // Process adaptations (use returnResult overload to get recommendations)
    const formScores = getRecentFormScores();
    const adaptationResult = processAdaptations(state, feedback, state.liftProgress ? recentLogs[0]?.readiness : undefined, recentLogs, Object.keys(formScores).length > 0 ? formScores : undefined, true);
    safeSaveProgramState(state, container);

    // Show completion with adaptations and weight recommendations
    renderWorkoutComplete(container, state, workout, progressMessages, adaptationResult.decisions, adaptationResult.recommendations);
  });
}

// ─── Accessory Recommendations from Form Analysis ───

function renderAccessoryRecommendations(state: ProgramState): string {
  // Determine primary exercise from recent scores
  const recentScores = getRecentFormScores();
  const primaryExercise = Object.keys(recentScores).length > 0 ? Object.keys(recentScores)[0] : 'squat';

  const weakDimensions = getRecentWeakDimensions(primaryExercise);
  if (Object.keys(weakDimensions).length === 0) return '';
  const accessories = recommendAccessories(weakDimensions, primaryExercise, state.equipment);
  if (accessories.length === 0) return '';

  let html = `
    <div class="card card--static wp-notes-card">
      <h4 class="section-heading-sm">Recommended Accessories (from Form Analysis)</h4>
      <p class="wp-note-text">Based on your recent form analysis, these accessories target your weak points:</p>
  `;

  for (const acc of accessories) {
    html += `
      <div class="wp-exercise-block">
        <strong class="wp-exercise-name">${escapeHtml(acc.weakPoint)}</strong>
        <div class="wp-exercise-notes">${escapeHtml(acc.exercises.join(' / '))} — ${escapeHtml(acc.setsReps)}</div>
        <details class="wp-science-details">
          <summary class="wp-science-summary">Why?</summary>
          <p class="wp-science-text">${escapeHtml(acc.scienceBasis)}</p>
        </details>
      </div>
    `;
  }

  html += `</div>`;
  return html;
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

// ─── Workout Card (In-Workout Tracker) ───

function renderWorkoutCard(workout: GeneratedWorkout, state: ProgramState): string {
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
      html += `<div class="wp-prev-hint">Last: ${prevExData.weight} ${escapeHtml(state.weightUnit)} × ${prevExData.reps} ${prevExData.rpe ? `@ RPE ${prevExData.rpe}` : ''}</div>`;
    }

    // Warm-up sets (non-interactive, greyed out)
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

// ─── Transition Card Wiring ───

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

// ─── PR Toast ───

function showPRToast(container: HTMLElement, message: string): void {
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

// ─── In-Workout Set Logging with Rest Timer ───

/** Active rest timer instance (shared across sets) */
let activeRestTimer: RestTimer | null = null;

const IN_PROGRESS_KEY = 'squat_form_in_progress_workout';

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

function restoreInProgressWorkout(container: HTMLElement): void {
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

function wireUpSetLogging(container: HTMLElement, state: ProgramState, workout: GeneratedWorkout): void {
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

      // Color changes: green → yellow → red
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

function completeWorkout(container: HTMLElement, state: ProgramState, workout: GeneratedWorkout): void {
  // Clear in-progress auto-save data
  localStorage.removeItem(IN_PROGRESS_KEY);

  // Stop any running rest timer
  activeRestTimer?.stop();

  // Gather logged sets from the tracker
  const sets: WorkoutSet[] = [];
  container.querySelectorAll<HTMLElement>('.wp-set-tracker-row').forEach(row => {
    const exerciseSlot = row.dataset.exercise ?? '';
    const setNum = parseInt(row.dataset.set ?? '0', 10);
    const exercise = workout.exercises.find(e => e.exerciseSlot === exerciseSlot);
    const setData = exercise?.sets.find(s => s.setNumber === setNum);

    if (setData) {
      const isLogged = row.dataset.status === 'logged';
      const setId = `set-${exerciseSlot}-${setNum}`;

      // Read actual values from input fields
      const weightInput = document.getElementById(`${setId}-weight`) as HTMLInputElement | null;
      const repsInput = document.getElementById(`${setId}-reps`) as HTMLInputElement | null;
      const rpeSelect = document.getElementById(`${setId}-rpe`) as HTMLSelectElement | null;

      const actualWeight = parseFloat(weightInput?.value ?? '') || setData.targetWeight;
      const actualReps = isLogged ? (parseInt(repsInput?.value ?? '') || 0) : 0;
      const rpe = parseFloat(rpeSelect?.value ?? '') || undefined;

      sets.push({
        exerciseName: exercise!.name,
        exerciseSlot,
        setNumber: setNum,
        targetReps: setData.targetReps,
        targetWeight: setData.targetWeight,
        actualReps,
        actualWeight,
        rpe,
        completed: isLogged,
      });
    }
  });

  // Save workout log with today's readiness data
  const readiness = loadTodayReadiness() ?? undefined;
  const log: WorkoutLog = {
    id: crypto.randomUUID?.() ?? Date.now().toString(36),
    date: new Date().toISOString(),
    programId: state.programId,
    workoutDayIndex: state.currentDay,
    workoutDayName: workout.dayName,
    sets,
    readiness,
    completed: true,
  };

  const logs = loadWorkoutLogs();
  logs.unshift(log);
  safeSaveWorkoutLogs(logs, container);

  // Process LP progression for completed main lift sets
  const program = PROGRAMS[state.programId];
  const progressMessages: string[] = [];

  if (program && (program.progression.type === 'linear_session' || program.progression.type === 'amrap_driven')) {
    const mainLifts = ['squat', 'bench', 'deadlift', 'ohp'];
    for (const liftKey of mainLifts) {
      const liftSets = sets.filter(s => s.exerciseSlot === liftKey && s.completed);
      if (liftSets.length === 0) continue;

      // Majority-of-sets logic: if most sets hit target, count as success
      const targetReps = parseInt(liftSets[0].targetReps.replace('+', ''), 10);
      const setsHitTarget = liftSets.filter(s => (s.actualReps ?? 0) >= targetReps).length;
      const majorityHit = setsHitTarget >= Math.ceil(liftSets.length / 2);

      const representativeSet = majorityHit
        ? liftSets.find(s => (s.actualReps ?? 0) >= targetReps) ?? liftSets[0]
        : liftSets.reduce((worst, s) =>
            (s.actualReps ?? 0) < (worst.actualReps ?? 0) ? s : worst
          );

      const msg = recordSetResult(
        state,
        liftKey,
        representativeSet.actualWeight ?? 0,
        representativeSet.actualReps ?? 0,
        targetReps,
        representativeSet.rpe,
        representativeSet.formScore,
      );
      if (msg) progressMessages.push(msg);
    }
  }

  // Advance to next workout
  advanceWorkout(state);
  safeSaveProgramState(state, container);

  // Show post-workout feedback form instead of going directly to completion
  renderFeedbackForm(container, state, workout, sets, log, progressMessages);
}

function renderWorkoutComplete(
  container: HTMLElement,
  state: ProgramState,
  workout: GeneratedWorkout,
  progressMessages: string[],
  adaptations?: AdaptationDecision[],
  weightRecommendations?: WeightRecommendation[],
): void {
  let html = `
    <div class="card card--static wp-complete-card" role="status" aria-live="polite">
      <h3 class="wp-complete-heading">Workout Complete</h3>
      <div class="wp-complete-subtitle">${escapeHtml(workout.dayLabel)} — ${escapeHtml(workout.weekLabel)}</div>
      <div class="wp-complete-count">
        Total workouts: ${state.workoutsCompleted}
      </div>
    </div>
  `;

  // Show PRs set during this session
  const prsByLift = getAllPRsByLift();
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayPRs = Object.values(prsByLift).flat().filter(pr => pr.date.slice(0, 10) === todayStr);
  if (todayPRs.length > 0) {
    html += `<div class="card card--static wp-pr-card">`;
    html += `<h4 class="section-heading-sm wp-pr-heading">Personal Records Set Today</h4>`;
    for (const pr of todayPRs) {
      html += `<p class="wp-progress-msg wp-progress-success">${escapeHtml(pr.context)} (${escapeHtml(pr.type.replace(/_/g, ' '))})</p>`;
    }
    html += `</div>`;
  }

  if (progressMessages.length > 0) {
    html += `<div class="card card--static wp-progress-card">`;
    html += `<h4 class="section-heading-sm">Progression Updates</h4>`;
    for (const msg of progressMessages) {
      const isWarning = msg.includes('stall') || msg.includes('exhausted') || msg.includes('Deloading') || msg.includes('Failed');
      const msgClass = isWarning ? 'wp-progress-warning' : 'wp-progress-success';
      html += `<p class="wp-progress-msg ${msgClass}">${escapeHtml(msg)}</p>`;
    }
    html += `</div>`;
  }

  // Adaptation decisions
  if (adaptations && adaptations.length > 0) {
    const userProfile = loadUserProfile();
    const isBeginnerUser = userProfile?.experienceLevel === 'beginner';
    const adaptationHeading = isBeginnerUser ? 'How your next workout will change' : 'Training Adaptations';
    html += `<div class="card card--static wp-adaptation-card">`;
    html += `<h4 class="section-heading-sm">${escapeHtml(adaptationHeading)}</h4>`;
    html += `<p class="wp-note-text">Based on your feedback, here's how your next workout will change:</p>`;

    for (const decision of adaptations) {
      const colorClass = getAdaptationColorClass(decision.type);
      html += `
        <div class="wp-adaptation-item ${colorClass}">
          <span class="wp-adaptation-badge">${escapeHtml(formatAdaptationType(decision.type, isBeginnerUser))}</span>
          <p class="wp-adaptation-msg">${escapeHtml(decision.description)}</p>
          <details class="wp-adaptation-citation">
            <summary class="wp-science-summary">Evidence</summary>
            <p class="wp-science-text">${escapeHtml(decision.citation)}</p>
          </details>
        </div>
      `;
    }
    html += `</div>`;
  }

  // Weight recommendations (form-score-based, not auto-applied)
  if (weightRecommendations && weightRecommendations.length > 0) {
    html += `<div class="card card--static wp-adaptation-card" style="border-color: var(--warning);">`;
    html += `<h4 class="section-heading-sm" style="color: var(--warning);">Form-Based Weight Suggestions</h4>`;
    html += `<p class="wp-note-text">Your form analysis suggests these weight adjustments. These are recommendations, not automatic changes.</p>`;
    for (const rec of weightRecommendations) {
      const liftName = rec.lift.charAt(0).toUpperCase() + rec.lift.slice(1);
      const severityColor = rec.severity === 'urgent' ? 'var(--danger)' : rec.severity === 'warning' ? 'var(--warning)' : 'var(--text-secondary)';
      html += `
        <div class="wp-adaptation-item wp-adapt-decrease" data-rec-lift="${escapeHtml(rec.lift)}" data-rec-weight="${rec.recommendedWeight}">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <span class="wp-adaptation-badge" style="color: ${severityColor};">${escapeHtml(liftName)}</span>
              <p class="wp-adaptation-msg">${escapeHtml(rec.reason)}</p>
              <p class="wp-adaptation-msg" style="font-size: var(--font-sm); color: var(--text-muted);">${rec.currentWeight} → ${rec.recommendedWeight} ${escapeHtml(state.weightUnit ?? 'lbs')}</p>
            </div>
            <button class="btn wp-ghost-btn wp-accept-rec-btn" style="white-space: nowrap;">Accept</button>
          </div>
        </div>
      `;
    }
    html += `</div>`;
  }

  // Show e1RM estimates from AMRAP performance
  const e1rms = getEstimated1RMs(state);
  if (Object.keys(e1rms).length > 0) {
    html += `<div class="card card--static wp-progress-card">`;
    html += `<h4 class="section-heading-sm">Estimated 1RMs</h4>`;
    for (const [lift, e1rm] of Object.entries(e1rms)) {
      const liftName = lift.charAt(0).toUpperCase() + lift.slice(1);
      const progress = state.liftProgress[lift];
      const lastEntry = progress?.e1rmHistory?.length ? progress.e1rmHistory[progress.e1rmHistory.length - 1] : null;
      const weightStr = `${Math.round(e1rm)} ${escapeHtml(state.weightUnit)}`;
      let detail = '';
      if (lastEntry && progress?.currentWeight) {
        const lastReps = progress.history?.length ? progress.history[progress.history.length - 1]?.[2] : undefined;
        if (lastReps) {
          detail = ` (from ${progress.currentWeight} \u00d7 ${lastReps} reps, Epley formula)`;
        }
      }
      html += `<p class="wp-progress-msg wp-progress-success">${escapeHtml(liftName)} e1RM: ${weightStr}${escapeHtml(detail)}</p>`;
    }
    html += `</div>`;
  }

  // Gym total tracking (S+B+D)
  if (Object.keys(e1rms).length >= 2) {
    const squat1RM = e1rms['squat'] ?? 0;
    const bench1RM = e1rms['bench'] ?? 0;
    const deadlift1RM = e1rms['deadlift'] ?? 0;
    if (squat1RM > 0 && bench1RM > 0 && deadlift1RM > 0) {
      const total = calculateCompTotal(squat1RM, bench1RM, deadlift1RM);
      const userProfile = loadUserProfile();
      const bw = userProfile?.bodyweight ?? 0;
      const sex = (userProfile?.sex ?? 'male') as 'male' | 'female';
      const unit = state.weightUnit ?? 'lbs';
      const bwKg = unit === 'lbs' ? bw * 0.453592 : bw;
      const totalKg = unit === 'lbs' ? total * 0.453592 : total;

      const compTotal = {
        squat: Math.round(squat1RM),
        bench: Math.round(bench1RM),
        deadlift: Math.round(deadlift1RM),
        total: Math.round(total),
        bodyweight: bw,
        date: new Date().toISOString(),
        dots: bw > 0 ? (computeDOTS(totalKg, bwKg, sex === 'male')?.score ?? undefined) : undefined,
        wilks2: bw > 0 ? (calculateWilks2(totalKg, bwKg, sex) ?? undefined) : undefined,
        glPoints: bw > 0 ? (calculateGLPoints(totalKg, bwKg, sex) ?? undefined) : undefined,
        isCompetition: false,
      };
      saveCompTotal(compTotal);
      html += renderCompTotalCard(compTotal);
    }
  }

  html += `
    <button id="wp-next-workout" class="btn btn-primary wp-full-width-btn">
      See Next Workout
    </button>
  `;

  container.innerHTML = html;

  const nextBtn = container.querySelector('#wp-next-workout') as HTMLButtonElement;
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      renderActiveProgram(container, state);
    });
  }

  // Wire up weight recommendation accept buttons
  container.querySelectorAll('.wp-accept-rec-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.wp-adaptation-item') as HTMLElement;
      if (!item) return;
      const lift = item.dataset.recLift;
      const recWeight = parseFloat(item.dataset.recWeight ?? '0');
      if (lift && recWeight > 0 && state.liftProgress[lift]) {
        state.liftProgress[lift].currentWeight = recWeight;
        safeSaveProgramState(state, container);
        item.innerHTML = `<p class="wp-adaptation-msg" style="color: var(--success);">Applied: ${lift.charAt(0).toUpperCase() + lift.slice(1)} weight set to ${recWeight} ${escapeHtml(state.weightUnit ?? 'lbs')}</p>`;
      }
    });
  });
}

function getAdaptationColorClass(type: AdaptationDecision['type']): string {
  switch (type) {
    case 'weight_increase': return 'wp-adapt-increase';
    case 'weight_decrease': return 'wp-adapt-decrease';
    case 'volume_decrease': return 'wp-adapt-decrease';
    case 'force_deload': return 'wp-adapt-deload';
    case 'program_transition': return 'wp-adapt-info';
    case 'exercise_substitution': return 'wp-adapt-substitution';
    case 'increment_change': return 'wp-adapt-info';
    case 'phase_advance': return 'wp-adapt-increase';
    case 'info': return 'wp-adapt-info';
    default: return 'wp-adapt-info';
  }
}

function formatAdaptationType(type: AdaptationDecision['type'], isBeginner = false): string {
  switch (type) {
    case 'weight_increase': return isBeginner ? 'Adding Weight' : 'Weight Increase';
    case 'weight_decrease': return isBeginner ? 'Reducing Weight' : 'Weight Decrease';
    case 'volume_decrease': return isBeginner ? 'Fewer Sets' : 'Volume Decrease';
    case 'force_deload': return isBeginner ? 'Recovery Week Recommended' : 'Deload';
    case 'program_transition': return isBeginner ? 'Program Change' : 'Program Transition';
    case 'exercise_substitution': return isBeginner ? 'Exercise Swap' : 'Exercise Substitution';
    case 'increment_change': return isBeginner ? 'Step Size Change' : 'Increment Change';
    case 'phase_advance': return isBeginner ? 'Moving to Next Phase' : 'Phase Advance';
    case 'info': return 'Info';
    default: return type;
  }
}

// ─── Calendar Card ───

function renderCalendarCard(
  cal: ReturnType<typeof buildCalendarMonth>,
  streak: ReturnType<typeof calculateStreak>,
): string {
  let html = `
    <details class="card card--static wp-calendar-card">
      <summary class="wp-calendar-summary">
        <span>Training Calendar</span>
        <span class="wp-streak-badge">${streak.currentStreak}wk streak &middot; ${streak.workoutsThisWeek}/${streak.targetPerWeek} this week</span>
      </summary>
      <div class="wp-calendar-content">
        <div class="wp-cal-header">${escapeHtml(cal.label)}</div>
        <div class="wp-cal-grid">
          <div class="wp-cal-dow">S</div><div class="wp-cal-dow">M</div><div class="wp-cal-dow">T</div>
          <div class="wp-cal-dow">W</div><div class="wp-cal-dow">T</div><div class="wp-cal-dow">F</div><div class="wp-cal-dow">S</div>
  `;

  for (const day of cal.days) {
    const hasWorkout = day.workouts.length > 0;
    const classes = [
      'wp-cal-day',
      !day.isCurrentMonth ? 'wp-cal-other-month' : '',
      day.isToday ? 'wp-cal-today' : '',
      hasWorkout ? 'wp-cal-trained' : '',
    ].filter(Boolean).join(' ');

    html += `<div class="${classes}">${day.dayOfMonth}${hasWorkout ? '<span class="wp-cal-dot"></span>' : ''}</div>`;
  }

  html += `</div>
        <div class="wp-cal-stats">
          <span>${cal.workoutCount} workouts this month</span>
          <span>&middot;</span>
          <span>${streak.consistencyPercent}% consistency</span>
          <span>&middot;</span>
          <span>Best streak: ${streak.longestStreak}wk</span>
        </div>
      </div>
    </details>
  `;
  return html;
}

// ─── Volume Card ───

function renderVolumeCard(
  volumes: ReturnType<typeof calculateWeeklyVolume>,
  under: ReturnType<typeof getUndertrainedMuscles>,
  over: ReturnType<typeof getOvertrainedMuscles>,
): string {
  // Only show muscle groups with > 0 sets or those that are undertrained
  const relevant = volumes.filter(v => v.weeklySets > 0 || v.mev > 0);
  if (relevant.length === 0) return '';

  let html = `
    <details class="card card--static wp-volume-card">
      <summary class="wp-volume-summary">
        <span>Muscle Volume</span>
        ${under.length > 0 ? `<span class="wp-volume-warn">${under.length} undertrained</span>` : ''}
        ${over.length > 0 ? `<span class="wp-volume-alert">${over.length} excessive</span>` : ''}
      </summary>
      <div class="wp-volume-content">
  `;

  for (const v of relevant) {
    const pct = Math.min(100, (v.weeklySets / v.mrv) * 100);
    const zoneColors: Record<string, string> = {
      under: 'var(--text-muted)',
      optimal: 'var(--success)',
      high: 'var(--warning)',
      excessive: 'var(--danger)',
    };
    const color = zoneColors[v.zone] ?? 'var(--text-muted)';

    html += `
      <div class="wp-vol-row">
        <span class="wp-vol-label">${escapeHtml(v.label)}</span>
        <div class="wp-vol-bar-track">
          <div class="wp-vol-bar" style="width:${pct}%;background:${color}"></div>
          <div class="wp-vol-mev-mark" style="left:${(v.mev / v.mrv) * 100}%"></div>
          <div class="wp-vol-mav-mark" style="left:${(v.mav / v.mrv) * 100}%"></div>
        </div>
        <span class="wp-vol-count">${v.weeklySets}</span>
      </div>
    `;
  }

  html += `
        <div class="wp-vol-legend">
          <span class="wp-vol-leg-item"><span class="wp-vol-leg-dot" style="background:var(--text-muted)"></span>Under MEV</span>
          <span class="wp-vol-leg-item"><span class="wp-vol-leg-dot" style="background:var(--success)"></span>Optimal</span>
          <span class="wp-vol-leg-item"><span class="wp-vol-leg-dot" style="background:var(--warning)"></span>High</span>
          <span class="wp-vol-leg-item"><span class="wp-vol-leg-dot" style="background:var(--danger)"></span>Over MRV</span>
        </div>
      </div>
    </details>
  `;
  return html;
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
    .wp-setup-heading {
      margin-bottom: var(--space-md);
      font-size: var(--font-lg);
      color: var(--text-primary);
    }
    .wp-setup-desc {
      margin-bottom: var(--space-lg);
    }
    .wp-setup-form {
      display: grid;
      gap: var(--space-md);
    }
    .wp-maxes-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-sm);
    }
    .wp-unit-row {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      margin-top: var(--space-xs);
    }
    .wp-radio-label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 44px;
      padding: var(--space-xs) var(--space-sm);
      cursor: pointer;
      font-size: var(--font-sm);
      color: var(--text-secondary);
      border-radius: var(--radius-sm);
      transition: background var(--transition-fast);
    }
    .wp-radio-label:hover {
      background: var(--bg-card-hover);
    }
    .wp-bw-row {
      display: flex;
      gap: var(--space-sm);
      align-items: center;
    }
    .wp-bw-unit {
      color: var(--text-muted);
      font-size: var(--font-sm);
    }
    .wp-readiness-early-msg {
      margin-top: var(--space-sm);
    }
    .wp-find-btn {
      margin-top: var(--space-sm);
    }
    .wp-advanced-options {
      margin-top: var(--space-xs);
    }
    .wp-advanced-summary {
      cursor: pointer;
      color: var(--accent);
      font-size: var(--font-sm);
      font-weight: 500;
      padding: var(--space-sm) 0;
      list-style: none;
    }
    .wp-advanced-summary::-webkit-details-marker {
      display: none;
    }
    .wp-advanced-summary::before {
      content: '+ ';
    }
    .wp-advanced-options[open] > .wp-advanced-summary::before {
      content: '- ';
    }
    .wp-advanced-grid {
      display: grid;
      gap: var(--space-md);
      margin-top: var(--space-sm);
    }
    .wp-custom-section-details {
      margin-top: var(--space-lg);
    }
    .wp-custom-divider-summary {
      cursor: pointer;
      color: var(--text-muted);
      font-size: var(--font-sm);
      font-weight: 500;
      text-align: center;
      padding: var(--space-sm) 0;
      list-style: none;
      border-top: 1px solid var(--border);
      padding-top: var(--space-md);
    }
    .wp-custom-divider-summary::-webkit-details-marker {
      display: none;
    }

    /* ===== Recommendations ===== */
    .wp-recommendations {
      display: none;
      margin-top: var(--space-lg);
    }
    .wp-recs-heading {
      margin-bottom: var(--space-md);
    }
    .wp-no-match-card {
      border-color: var(--warning);
    }
    .program-rec-card {
      margin-bottom: var(--space-md);
      cursor: pointer;
      border: 1px solid var(--border);
      transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }
    .program-rec-card:hover,
    .program-rec-card:focus-visible {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent);
    }
    .wp-rec-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: var(--space-xs);
    }
    .wp-rec-name {
      color: var(--text-primary);
      font-size: var(--font-lg);
      font-weight: 600;
    }
    .wp-rec-meta {
      color: var(--text-muted);
      font-size: var(--font-xs);
      margin-bottom: var(--space-xs);
    }
    .wp-rec-desc {
      color: var(--text-secondary);
      font-size: var(--font-sm);
      margin-bottom: var(--space-sm);
    }
    .wp-best-match {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent), 0 2px 12px var(--accent-glow);
    }
    .wp-best-match-badge {
      display: inline-block;
      font-size: var(--font-2xs);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--bg-primary);
      background: var(--accent);
      padding: 2px var(--space-sm);
      border-radius: var(--radius-sm);
      margin-bottom: var(--space-xs);
    }
    .wp-level-beginner { background: var(--success); }
    .wp-level-intermediate { background: var(--warning); }
    .wp-level-advanced { background: var(--danger); }

    /* ===== Science Details ===== */
    .wp-science-details {
      font-size: var(--font-xs);
      color: var(--text-muted);
    }
    .wp-science-summary {
      cursor: pointer;
      color: var(--accent);
      font-size: var(--font-sm);
    }
    .wp-science-text {
      margin-top: var(--space-xs);
      line-height: 1.5;
    }
    .wp-science-card {
      margin-top: var(--space-md);
    }
    .wp-science-body {
      margin-top: var(--space-sm);
      font-size: var(--font-sm);
      color: var(--text-secondary);
      line-height: 1.6;
    }
    .wp-science-detail {
      margin-top: var(--space-xs);
      font-size: var(--font-xs);
      color: var(--text-muted);
    }

    /* ===== Program Header ===== */
    .wp-program-header {
      margin-bottom: var(--space-md);
    }
    .wp-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--space-sm);
    }
    .wp-program-name {
      margin: 0;
      font-size: var(--font-lg);
      color: var(--text-primary);
    }
    .wp-header-meta {
      color: var(--text-muted);
      font-size: var(--font-xs);
    }
    .wp-header-details {
      display: flex;
      gap: var(--space-sm);
      flex-wrap: wrap;
      font-size: var(--font-xs);
      color: var(--text-secondary);
    }
    .wp-ghost-btn {
      background: transparent;
      color: var(--accent);
      border: 1px solid var(--accent);
      padding: var(--space-xs) var(--space-sm);
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-size: var(--font-xs);
      transition: background var(--transition-fast);
    }
    .wp-ghost-btn:hover {
      background: var(--accent-glow);
    }

    /* ===== Alert Cards ===== */
    .wp-alert-card {
      margin-bottom: var(--space-md);
    }
    .wp-alert-warning {
      border-color: var(--warning);
    }
    .wp-alert-danger {
      border-color: var(--danger);
    }
    .wp-alert-heading {
      color: inherit;
    }
    .wp-alert-warning .wp-alert-heading { color: var(--warning); }
    .wp-alert-danger .wp-alert-heading { color: var(--danger); }

    /* ===== Workout Card ===== */
    .wp-workout-card {
      margin-top: var(--space-md);
    }
    .wp-day-heading {
      margin-bottom: var(--space-sm);
    }
    .wp-exercise-block {
      margin-bottom: var(--space-md);
      padding: var(--space-sm);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
    }
    .wp-exercise-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--space-xs);
    }
    .wp-exercise-name {
      color: var(--text-primary);
      font-size: var(--font-sm);
    }
    .wp-accessory-badge {
      font-size: var(--font-2xs);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .wp-exercise-notes {
      font-size: var(--font-xs);
      color: var(--text-muted);
      margin-bottom: var(--space-xs);
    }
    .wp-exercise-demo {
      margin: var(--space-xs) 0;
    }
    .wp-demo-toggle {
      cursor: pointer;
      color: var(--accent);
      font-size: var(--font-xs);
      padding: 2px 0;
    }
    .wp-demo-toggle:hover { text-decoration: underline; }
    .wp-demo-content {
      padding: var(--space-sm);
      background: var(--bg-input);
      border-radius: var(--radius-sm);
      margin-top: var(--space-xs);
      font-size: var(--font-xs);
    }
    .wp-demo-gif {
      width: 100%;
      max-width: 300px;
      border-radius: var(--radius-sm);
      margin-bottom: var(--space-sm);
      display: block;
    }
    .wp-demo-steps-list {
      padding-left: 1.2rem;
      line-height: 1.6;
      color: var(--text-secondary);
      margin: var(--space-xs) 0;
    }
    .wp-demo-cues {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
      margin: var(--space-sm) 0;
    }
    .wp-demo-cue {
      padding: 2px 8px;
      background: var(--accent-glow);
      border: 1px solid var(--accent-dim);
      border-radius: 999px;
      color: var(--accent);
      font-size: var(--font-2xs);
      white-space: nowrap;
    }
    .wp-demo-video-link {
      display: inline-block;
      margin-top: var(--space-xs);
      color: var(--accent);
      font-size: var(--font-xs);
      text-decoration: none;
    }
    .wp-demo-video-link:hover { text-decoration: underline; }
    .wp-demo-video-link::before { content: '\\25B6 '; }
    .wp-demo-mistakes-list {
      padding-left: 1.2rem;
      line-height: 1.6;
      color: var(--text-secondary);
      margin: var(--space-xs) 0;
      list-style: disc;
    }
    .wp-demo-mistakes-list li {
      margin-bottom: 2px;
    }
    .wp-demo-mistakes {
      margin: var(--space-sm) 0;
    }
    .wp-exercise-header-right {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
    }
    .wp-demo-info-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 1px solid var(--accent-dim);
      background: var(--accent-glow);
      color: var(--accent);
      font-size: var(--font-2xs);
      font-weight: 700;
      cursor: pointer;
      padding: 0;
      line-height: 1;
      flex-shrink: 0;
    }
    .wp-demo-info-btn:hover {
      background: var(--accent);
      color: var(--bg-primary);
    }
    .wp-condition-group {
      margin-bottom: var(--space-xs);
    }
    .wp-condition-group-label {
      font-size: var(--font-2xs);
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: block;
      margin-bottom: 2px;
    }
    .wp-condition-checkbox-label {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      font-size: var(--font-xs);
      color: var(--text-secondary);
      cursor: pointer;
      padding: 2px 0;
    }
    .wp-condition-cb {
      accent-color: var(--accent);
    }
    .wp-conditions-list {
      max-height: 200px;
      overflow-y: auto;
      padding: var(--space-xs);
      background: var(--bg-input);
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
    }
    .wp-sets-list {
      display: grid;
      gap: 2px;
    }

    /* ===== Set Rows ===== */
    .wp-set-row {
      display: grid;
      grid-template-columns: 28px 1fr auto;
      gap: var(--space-sm);
      align-items: center;
      padding: var(--space-xs) var(--space-xs);
      font-size: var(--font-sm);
      cursor: pointer;
      border-radius: var(--radius-sm);
      transition: opacity var(--transition-fast), background var(--transition-fast);
      min-height: 44px;
    }
    .wp-set-row:hover {
      background: var(--bg-card-hover);
    }
    .wp-set-completed {
      opacity: 0.5;
      text-decoration: line-through;
    }

    /* ===== In-Workout Set Tracker ===== */
    .wp-sets-tracker {
      margin-top: var(--space-xs);
    }
    .wp-sets-header {
      display: grid;
      grid-template-columns: 3.5rem 1fr 1fr 3rem 3rem;
      gap: var(--space-xs);
      padding: var(--space-xs) 0;
      font-size: var(--font-2xs);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border);
    }
    .wp-set-tracker-row {
      display: grid;
      grid-template-columns: 3.5rem 1fr 1fr 3rem 3rem;
      gap: var(--space-xs);
      align-items: center;
      padding: var(--space-xs) 0;
      border-bottom: 1px solid var(--border);
      min-height: 48px;
      transition: background var(--transition-fast), opacity var(--transition-fast);
    }
    .wp-set-tracker-row[data-status="logged"] {
      background: var(--accent-glow);
    }
    .wp-set-logged {
      opacity: 0.7;
    }
    .wp-st-set {
      font-size: var(--font-sm);
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 2px;
      flex-wrap: wrap;
    }
    .wp-pct-label {
      font-size: var(--font-2xs);
      color: var(--text-muted);
      display: block;
    }
    .wp-input-weight, .wp-input-reps {
      width: 100%;
      padding: 6px 8px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--bg-input);
      color: var(--text-primary);
      font-size: var(--font-sm);
      font-weight: 600;
      text-align: center;
      -moz-appearance: textfield;
      min-height: 44px;
    }
    .wp-input-weight::-webkit-inner-spin-button,
    .wp-input-reps::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .wp-input-weight:focus, .wp-input-reps:focus {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
      border-color: var(--accent);
    }
    .wp-input-weight[readonly], .wp-input-reps[readonly] {
      opacity: 0.6;
      background: transparent;
      border-color: transparent;
    }
    .wp-input-error {
      border-color: var(--danger);
      animation: wp-shake 0.3s;
    }
    @keyframes wp-shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-4px); }
      75% { transform: translateX(4px); }
    }

    /* ===== Stepper Controls ===== */
    .wp-stepper {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .wp-step-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 44px;
      min-height: 44px;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--bg-card);
      color: var(--text-secondary);
      font-size: var(--font-lg);
      font-weight: 700;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      transition: background var(--transition-fast), border-color var(--transition-fast);
      flex-shrink: 0;
    }
    .wp-step-btn:hover {
      background: var(--bg-card-hover);
      border-color: var(--accent);
    }
    .wp-step-btn:active {
      background: var(--accent-glow);
      transform: scale(0.95);
    }
    .wp-stepper .wp-input-weight,
    .wp-stepper .wp-input-reps {
      flex: 1;
      min-width: 0;
    }

    .wp-input-rpe {
      width: 100%;
      padding: 4px 2px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--bg-input);
      color: var(--text-primary);
      font-size: var(--font-xs);
      text-align: center;
      min-height: 44px;
      cursor: pointer;
    }
    .wp-log-set-btn {
      width: 100%;
      min-height: 44px;
      padding: 4px;
      border: none;
      border-radius: var(--radius-sm);
      background: var(--accent);
      color: var(--bg-primary);
      font-size: var(--font-sm);
      font-weight: 700;
      cursor: pointer;
      transition: background var(--transition-fast), transform var(--transition-fast);
    }
    .wp-log-set-btn:hover:not(:disabled) {
      background: var(--accent-hover);
      transform: scale(1.05);
    }
    .wp-log-set-btn:active:not(:disabled) {
      transform: scale(0.95);
    }
    .wp-logged-check {
      background: var(--success);
      cursor: default;
    }
    .wp-prev-hint {
      font-size: var(--font-xs);
      color: var(--text-muted);
      padding: 2px 0 4px;
      font-style: italic;
    }

    /* ===== Rest Timer Bar ===== */
    .wp-hidden {
      display: none !important;
    }
    .wp-rest-timer-bar {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      padding: var(--space-sm) var(--space-md);
      margin: var(--space-sm) 0;
      border-radius: var(--radius-md);
      background: var(--bg-input);
      border: 1px solid var(--accent-dim);
      position: static;
      z-index: 10;
    }
    .wp-rest-timer-bar.wp-timer-active,
    .wp-rest-timer-bar.wp-timer-done {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      margin: 0;
      border-radius: 0;
      z-index: 50;
      padding-top: env(safe-area-inset-top);
    }
    /* Push content below fixed timer bar */
    .wp-timer-spacer {
      height: 0;
      transition: height var(--transition-fast);
    }
    .wp-timer-spacer.wp-timer-spacer-active {
      height: 90px;
    }
    .wp-timer-active {
      border-color: var(--accent);
      box-shadow: 0 0 12px var(--accent-glow);
    }
    .wp-timer-done {
      border-color: var(--success);
      background: rgba(74, 222, 128, 0.1);
    }
    .wp-timer-display {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-sm);
    }
    .wp-timer-label {
      font-size: var(--font-xs);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .wp-timer-time {
      font-size: var(--font-xl);
      font-weight: 700;
      color: var(--accent);
      font-variant-numeric: tabular-nums;
      min-width: 4ch;
      text-align: center;
    }
    .wp-timer-done .wp-timer-time {
      color: var(--success);
      animation: wp-pulse 0.6s ease-in-out 3;
    }
    @keyframes wp-pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.15); }
    }
    .wp-timer-progress-track {
      height: 4px;
      border-radius: 2px;
      background: var(--border);
      overflow: hidden;
    }
    .wp-timer-progress-fill {
      height: 100%;
      border-radius: 2px;
      background: var(--accent);
      transition: width 1s linear;
    }
    .wp-timer-progress-fill.wp-timer-warning {
      background: var(--warning);
    }
    .wp-timer-progress-fill.wp-timer-urgent {
      background: var(--danger);
      animation: wp-pulse-bar 0.5s infinite;
    }
    @keyframes wp-pulse-bar {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
    .wp-timer-controls {
      display: flex;
      justify-content: center;
      gap: var(--space-xs);
    }
    .wp-timer-btn {
      padding: 4px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--bg-card);
      color: var(--text-secondary);
      font-size: var(--font-xs);
      cursor: pointer;
      min-height: 44px;
      min-width: 44px;
      transition: background var(--transition-fast);
    }
    .wp-timer-btn:hover {
      background: var(--bg-card-hover);
    }
    .wp-timer-skip {
      color: var(--accent);
      border-color: var(--accent-dim);
    }

    /* ===== Mobile Optimization for Tracker ===== */
    @media (max-width: 500px) {
      .wp-sets-header {
        grid-template-columns: 2.5rem 1fr 1fr 3rem;
        font-size: 0.55rem;
      }
      .wp-sh-rpe {
        display: none;
      }
      .wp-set-tracker-row {
        grid-template-columns: 2.5rem 1fr 1fr 3rem;
        flex-wrap: wrap;
      }
      .wp-st-rpe {
        display: none;
      }
      .wp-input-weight, .wp-input-reps {
        padding: 4px 4px;
        font-size: var(--font-sm);
        min-width: 0;
      }
      .wp-log-set-btn {
        font-size: var(--font-xs);
        padding: 4px 2px;
      }
      .wp-timer-controls {
        flex-wrap: wrap;
      }
      .wp-step-btn {
        min-width: 44px;
        min-height: 44px;
        padding: 2px;
        font-size: var(--font-sm);
      }
      .wp-stepper {
        gap: 2px;
      }
    }

    .wp-set-meta {
      color: var(--text-muted);
      font-size: var(--font-xs);
      white-space: nowrap;
      grid-column: 3;
    }
    .wp-set-note {
      font-size: var(--font-2xs);
      color: var(--text-muted);
      padding-left: calc(28px + var(--space-sm));
      margin-bottom: 2px;
    }
    .wp-amrap-badge {
      color: var(--accent);
      font-weight: 600;
    }
    .wp-amrap-input {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: var(--space-xs) 0 var(--space-xs) calc(28px + var(--space-sm));
    }
    .wp-amrap-reps-input {
      width: 80px;
      text-align: center;
    }

    /* ===== Complete Workout Button ===== */
    .wp-full-width-btn {
      width: 100%;
    }
    .wp-complete-btn {
      margin-top: var(--space-md);
    }

    /* ===== Notes Card ===== */
    .wp-notes-card {
      margin-top: var(--space-md);
    }
    .wp-note-text {
      font-size: var(--font-sm);
      color: var(--text-secondary);
      margin-bottom: var(--space-xs);
      line-height: 1.5;
    }

    /* ===== Transition Cards ===== */
    .wp-transition-reason {
      font-size: var(--font-sm);
      color: var(--text-secondary);
      margin-bottom: var(--space-md);
    }
    .wp-transition-options {
      display: grid;
      gap: var(--space-sm);
    }
    .wp-transition-card {
      padding: var(--space-sm);
    }
    .wp-transition-fit {
      font-size: var(--font-xs);
      color: var(--text-secondary);
      margin-top: var(--space-xs);
    }

    /* ===== Completion Screen ===== */
    .wp-complete-card {
      text-align: center;
      margin-bottom: var(--space-lg);
    }
    .wp-complete-heading {
      font-size: var(--font-2xl);
      margin-bottom: var(--space-sm);
      font-weight: 700;
      color: var(--text-primary);
    }
    .wp-complete-subtitle {
      color: var(--text-secondary);
      font-size: var(--font-sm);
    }
    .wp-complete-count {
      color: var(--text-muted);
      font-size: var(--font-xs);
      margin-top: var(--space-xs);
    }

    /* ===== Progression Messages ===== */
    .wp-progress-card {
      margin-bottom: var(--space-md);
    }
    .wp-progress-msg {
      font-size: var(--font-sm);
      margin-bottom: var(--space-sm);
      line-height: 1.5;
      border-left: 3px solid currentColor;
      padding-left: var(--space-sm);
    }
    .wp-progress-success {
      color: var(--success);
    }
    .wp-progress-warning {
      color: var(--warning);
    }

    /* ===== Terminology Tooltips ===== */
    .wp-term {
      border-bottom: 1px dotted var(--text-muted);
      cursor: help;
      position: relative;
    }
    .wp-term:hover,
    .wp-term:focus {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }

    /* ===== Confirm Dialog ===== */
    .wp-confirm-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      padding: var(--space-md);
    }
    .wp-confirm-dialog {
      background: var(--bg-card);
      border-radius: var(--radius);
      padding: var(--space-lg);
      max-width: 400px;
      width: 100%;
      box-shadow: var(--shadow-elevated);
      border: 1px solid var(--border);
    }
    .wp-confirm-title {
      font-size: var(--font-lg);
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: var(--space-sm);
    }
    .wp-confirm-message {
      font-size: var(--font-sm);
      color: var(--text-secondary);
      line-height: 1.5;
      margin-bottom: var(--space-lg);
    }
    .wp-confirm-actions {
      display: flex;
      gap: var(--space-sm);
      justify-content: flex-end;
    }
    .wp-confirm-cancel {
      background: transparent;
      color: var(--text-secondary);
      border: 1px solid var(--border);
    }
    .wp-confirm-cancel:hover {
      background: var(--bg-card-hover);
    }

    /* ===== Field Validation Error ===== */
    .wp-field-error {
      outline: 2px solid var(--danger);
      outline-offset: 2px;
      border-radius: var(--radius-sm);
    }
    .wp-error-text {
      color: var(--danger);
    }
    .wp-fb-error-text {
      color: var(--danger);
      font-size: var(--font-xs);
      margin-top: var(--space-xs);
    }

    /* ===== Storage Warning ===== */
    .wp-storage-warning {
      background: var(--bg-card);
      border: 1px solid var(--warning);
      border-radius: var(--radius-sm);
      padding: var(--space-sm) var(--space-md);
      margin-bottom: var(--space-md);
      color: var(--warning);
    }

    /* ===== Readiness Card ===== */
    .wp-readiness-card {
      margin-bottom: var(--space-md);
      border-color: var(--accent);
    }
    .wp-readiness-form {
      display: grid;
      gap: var(--space-md);
      margin-top: var(--space-md);
    }
    .wp-readiness-scale {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    .wp-scale-input {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
    }
    .wp-scale-label {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-width: 56px;
      min-height: 44px;
      padding: var(--space-xs) var(--space-sm);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-size: var(--font-sm);
      font-weight: 600;
      color: var(--text-secondary);
      transition: all var(--transition-fast);
      text-align: center;
      /* Allow focus for arrow-key navigation */
      outline: none;
    }
    .wp-scale-label:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .wp-scale-label:hover {
      border-color: var(--accent);
      background: var(--bg-card-hover);
    }
    .wp-scale-input:checked + .wp-scale-label {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
    }
    .wp-scale-hint {
      font-size: var(--font-2xs);
      font-weight: 400;
      opacity: 0.8;
      margin-top: 1px;
    }

    /* ===== Feedback Card ===== */
    .wp-feedback-card {
      margin-bottom: var(--space-md);
    }
    .wp-feedback-card .form-group {
      margin-bottom: var(--space-md);
    }
    .wp-feedback-textarea {
      resize: vertical;
      min-height: 60px;
    }
    .wp-difficulty-btns {
      display: flex;
      gap: var(--space-xs);
      flex-wrap: wrap;
    }
    .wp-difficulty-btn {
      flex: 1 1 auto;
      min-width: 100px;
      min-height: 44px;
      padding: var(--space-sm) var(--space-md);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--bg-card);
      color: var(--text-secondary);
      cursor: pointer;
      font-size: var(--font-sm);
      transition: all var(--transition-fast);
    }
    .wp-difficulty-btn:hover {
      border-color: var(--accent);
      background: var(--bg-card-hover);
    }
    .wp-difficulty-btn.selected {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
      font-weight: 600;
    }

    /* ===== RPE Row ===== */
    .wp-rpe-row {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      margin-bottom: var(--space-xs);
    }
    .wp-rpe-lift-name {
      min-width: 120px;
      font-size: var(--font-sm);
      font-weight: 500;
      color: var(--text-primary);
    }
    .wp-rpe-select {
      flex: 1;
    }

    /* ===== Injury Section ===== */
    .wp-injury-section {
      margin-bottom: var(--space-md);
    }
    .wp-injury-areas {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
      margin-bottom: var(--space-sm);
    }

    /* ===== Adaptation Card ===== */
    .wp-adaptation-card {
      margin-bottom: var(--space-md);
    }
    .wp-adaptation-item {
      padding: var(--space-sm) var(--space-md);
      border-left: 4px solid var(--border);
      margin-bottom: var(--space-sm);
      border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      background: var(--bg-card);
    }
    .wp-adaptation-badge {
      display: inline-block;
      font-size: var(--font-2xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 2px var(--space-xs);
      border-radius: var(--radius-sm);
      margin-bottom: var(--space-xs);
    }
    .wp-adaptation-msg {
      font-size: var(--font-sm);
      color: var(--text-secondary);
      line-height: 1.5;
      margin-bottom: var(--space-xs);
    }
    .wp-adaptation-citation {
      font-size: var(--font-xs);
      color: var(--text-muted);
    }
    .wp-adapt-increase {
      border-left-color: var(--success);
    }
    .wp-adapt-increase .wp-adaptation-badge {
      background: var(--success);
      color: white;
    }
    .wp-adapt-decrease {
      border-left-color: var(--warning);
    }
    .wp-adapt-decrease .wp-adaptation-badge {
      background: var(--warning);
      color: white;
    }
    .wp-adapt-deload {
      border-left-color: var(--orange);
    }
    .wp-adapt-deload .wp-adaptation-badge {
      background: var(--orange);
      color: white;
    }
    .wp-adapt-substitution {
      border-left-color: var(--danger);
    }
    .wp-adapt-substitution .wp-adaptation-badge {
      background: var(--danger);
      color: white;
    }
    .wp-adapt-info {
      border-left-color: var(--accent);
    }
    .wp-adapt-info .wp-adaptation-badge {
      background: var(--accent);
      color: white;
      opacity: 0.8;
    }

    /* ===== Warm-up Section ===== */
    .wp-warmup-section {
      margin-bottom: var(--space-sm);
      padding: var(--space-xs) var(--space-sm);
      border: 1px dashed var(--border);
      border-radius: var(--radius-sm);
      opacity: 0.75;
    }
    .wp-warmup-label {
      font-size: var(--font-2xs);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: var(--space-xs);
      font-weight: 600;
    }
    .wp-warmup-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 2px 0;
      font-size: var(--font-xs);
      color: var(--text-muted);
    }
    .wp-warmup-note {
      font-style: italic;
      font-size: var(--font-2xs);
      color: var(--text-muted);
    }

    /* ===== Texas Method Purpose Banners ===== */
    .wp-purpose-banner {
      padding: var(--space-sm) var(--space-md);
      border-radius: var(--radius-sm);
      font-size: var(--font-sm);
      font-weight: 500;
      margin-bottom: var(--space-md);
      line-height: 1.5;
    }
    .wp-purpose-volume {
      background: rgba(59, 130, 246, 0.12);
      border: 1px solid rgba(59, 130, 246, 0.3);
      color: #93bbfd;
    }
    .wp-purpose-recovery {
      background: rgba(74, 222, 128, 0.12);
      border: 1px solid rgba(74, 222, 128, 0.3);
      color: #6ee7a0;
    }
    .wp-purpose-intensity {
      background: rgba(251, 146, 60, 0.12);
      border: 1px solid rgba(251, 146, 60, 0.3);
      color: #fdba74;
    }
    /* Light mode banner colors (AA-contrast against white bg) */
    :root[data-theme="light"] .wp-purpose-volume {
      background: rgba(59, 130, 246, 0.08);
      border-color: rgba(37, 99, 235, 0.4);
      color: #1d4ed8;
    }
    :root[data-theme="light"] .wp-purpose-recovery {
      background: rgba(22, 163, 74, 0.08);
      border-color: rgba(22, 163, 74, 0.4);
      color: #15803d;
    }
    :root[data-theme="light"] .wp-purpose-intensity {
      background: rgba(234, 88, 12, 0.08);
      border-color: rgba(234, 88, 12, 0.4);
      color: #c2410c;
    }

    /* ===== Conjugate Variation Picker ===== */
    .wp-variation-picker {
      margin-bottom: var(--space-md);
      padding: var(--space-sm);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--bg-card);
    }
    .wp-variation-select {
      margin-top: var(--space-xs);
    }

    /* ===== Never Lifted Checkbox ===== */
    .wp-never-lifted-label {
      display: inline-flex;
      align-items: center;
      gap: var(--space-sm);
      cursor: pointer;
      font-size: var(--font-sm);
      color: var(--text-primary);
      min-height: 44px;
    }
    .wp-never-lifted-cb {
      width: 18px;
      height: 18px;
      cursor: pointer;
    }
    .wp-help-text {
      font-size: var(--font-xs);
      color: var(--text-muted);
      margin-top: var(--space-xs);
      font-style: italic;
    }

    /* ===== Meet Date Countdown ===== */
    .wp-meet-countdown {
      font-size: var(--font-xs);
      color: var(--accent);
      font-weight: 600;
      margin-top: 2px;
    }

    /* ===== PR Toast ===== */
    .wp-pr-toast {
      background: linear-gradient(135deg, var(--success), #16a34a);
      color: #fff;
      padding: var(--space-sm) var(--space-md);
      border-radius: var(--radius-md);
      text-align: center;
      font-weight: 700;
      font-size: var(--font-sm);
      animation: wp-toast-in 0.4s ease-out;
      margin-bottom: var(--space-sm);
      box-shadow: 0 4px 12px rgba(74, 222, 128, 0.3);
    }
    @keyframes wp-toast-in {
      0% { transform: translateY(-20px) scale(0.9); opacity: 0; }
      100% { transform: translateY(0) scale(1); opacity: 1; }
    }

    /* ===== PR Card (Completion Screen) ===== */
    .wp-pr-card {
      margin-bottom: var(--space-md);
      border-color: var(--success);
    }
    .wp-pr-heading {
      color: var(--success);
    }

    /* ===== Plate Calculator Hint ===== */
    .wp-plate-hint {
      font-size: var(--font-2xs);
      color: var(--text-muted);
      padding-left: 3.5rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 2px;
    }

    /* ===== Training Calendar ===== */
    .wp-calendar-card {
      margin-top: var(--space-md);
    }
    .wp-calendar-summary {
      cursor: pointer;
      color: var(--accent);
      font-size: var(--font-sm);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .wp-streak-badge {
      font-size: var(--font-2xs);
      color: var(--text-muted);
      font-weight: 400;
    }
    .wp-calendar-content {
      margin-top: var(--space-sm);
    }
    .wp-cal-header {
      text-align: center;
      font-weight: 600;
      font-size: var(--font-sm);
      color: var(--text-primary);
      margin-bottom: var(--space-sm);
    }
    .wp-cal-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
      text-align: center;
    }
    .wp-cal-dow {
      font-size: var(--font-2xs);
      color: var(--text-muted);
      font-weight: 600;
      padding: 4px 0;
      text-transform: uppercase;
    }
    .wp-cal-day {
      position: relative;
      padding: 6px 2px;
      font-size: var(--font-xs);
      color: var(--text-secondary);
      border-radius: var(--radius-sm);
      min-height: 32px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .wp-cal-other-month {
      opacity: 0.3;
    }
    .wp-cal-today {
      font-weight: 700;
      color: var(--accent);
      border: 1px solid var(--accent);
    }
    .wp-cal-trained {
      background: var(--accent-glow);
    }
    .wp-cal-dot {
      display: block;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--success);
      margin-top: 2px;
    }
    .wp-cal-stats {
      display: flex;
      gap: var(--space-sm);
      justify-content: center;
      flex-wrap: wrap;
      margin-top: var(--space-sm);
      font-size: var(--font-2xs);
      color: var(--text-muted);
    }

    /* ===== Volume Tracker ===== */
    .wp-volume-card {
      margin-top: var(--space-md);
    }
    .wp-volume-summary {
      cursor: pointer;
      color: var(--accent);
      font-size: var(--font-sm);
      display: flex;
      align-items: center;
      gap: var(--space-sm);
    }
    .wp-volume-warn {
      font-size: var(--font-2xs);
      color: var(--warning);
      font-weight: 600;
    }
    .wp-volume-alert {
      font-size: var(--font-2xs);
      color: var(--danger);
      font-weight: 600;
    }
    .wp-volume-content {
      margin-top: var(--space-sm);
    }
    .wp-vol-row {
      display: grid;
      grid-template-columns: 5.5rem 1fr 2rem;
      gap: var(--space-xs);
      align-items: center;
      padding: 3px 0;
    }
    .wp-vol-label {
      font-size: var(--font-xs);
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wp-vol-bar-track {
      position: relative;
      height: 8px;
      background: var(--border);
      border-radius: 4px;
      overflow: visible;
    }
    .wp-vol-bar {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s ease;
    }
    .wp-vol-mev-mark, .wp-vol-mav-mark {
      position: absolute;
      top: -2px;
      width: 1px;
      height: 12px;
      background: var(--text-muted);
      opacity: 0.4;
    }
    .wp-vol-count {
      font-size: var(--font-xs);
      color: var(--text-muted);
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .wp-vol-legend {
      display: flex;
      gap: var(--space-md);
      justify-content: center;
      flex-wrap: wrap;
      margin-top: var(--space-sm);
      padding-top: var(--space-sm);
      border-top: 1px solid var(--border);
    }
    .wp-vol-leg-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: var(--font-2xs);
      color: var(--text-muted);
    }
    .wp-vol-leg-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    /* ===== Mobile Responsive ===== */
    @media (max-width: 500px) {
      .wp-set-row {
        grid-template-columns: 28px 1fr;
        gap: var(--space-xs);
      }
      .wp-set-weight {
        grid-column: 2;
        font-size: var(--font-xs);
      }
      .wp-set-meta {
        grid-column: 2;
        font-size: var(--font-2xs);
      }
      .wp-maxes-grid {
        grid-template-columns: 1fr;
      }
      .wp-header-row {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-sm);
      }
      .wp-rec-header {
        flex-direction: column;
        gap: var(--space-xs);
      }
      .wp-confirm-dialog {
        margin: var(--space-md);
      }
      .wp-difficulty-btns {
        flex-direction: column;
      }
      .wp-rpe-row {
        flex-direction: column;
        align-items: flex-start;
      }
      .wp-rpe-lift-name {
        min-width: unset;
      }
      .wp-scale-label {
        min-width: 44px;
        padding: var(--space-xs);
      }
      .wp-scale-hint {
        display: none;
      }
      /* Hide plate hints on mobile to save space */
      .wp-plate-hint {
        display: none;
      }
      /* Compact calendar on mobile */
      .wp-cal-day {
        padding: 4px 1px;
        font-size: var(--font-2xs);
        min-height: 28px;
      }
      .wp-cal-stats {
        flex-direction: column;
        align-items: center;
        gap: 2px;
      }
      /* Compact volume bars on mobile */
      .wp-vol-row {
        grid-template-columns: 4.5rem 1fr 1.5rem;
      }
      .wp-vol-legend {
        gap: var(--space-sm);
      }
    }

    /* ===== Custom Program Builder ===== */
    .wp-custom-divider {
      text-align: center;
      margin: var(--space-lg) 0;
      position: relative;
    }
    .wp-custom-divider::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 0;
      right: 0;
      height: 1px;
      background: var(--border);
    }
    .wp-custom-divider span {
      background: var(--bg-card);
      padding: 0 var(--space-md);
      position: relative;
      color: var(--text-muted);
      font-size: var(--font-sm);
    }
    .wp-custom-section {
      margin-top: var(--space-sm);
    }
    .wp-custom-textarea {
      width: 100%;
      min-height: 200px;
      padding: var(--space-sm) var(--space-md);
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--bg-input);
      color: var(--text-primary);
      font-size: var(--font-sm);
      font-family: monospace;
      resize: vertical;
      line-height: 1.6;
      box-sizing: border-box;
    }
    .wp-custom-textarea:focus {
      outline: 2px solid var(--accent);
      border-color: var(--accent);
    }
    .wp-custom-textarea::placeholder {
      color: var(--text-muted);
      opacity: 0.7;
    }
    .wp-custom-options {
      margin: var(--space-md) 0;
    }
    .wp-custom-desc {
      font-size: var(--font-sm);
      color: var(--text-secondary);
      margin-bottom: var(--space-sm);
    }
    .wp-custom-meta {
      font-size: var(--font-xs);
      color: var(--text-muted);
      margin-bottom: var(--space-sm);
    }
    .wp-custom-preview-card {
      margin-top: var(--space-md);
    }
    .wp-preview-day {
      padding: var(--space-xs) 0;
      border-bottom: 1px solid var(--border);
    }
    .wp-preview-day:last-child {
      border-bottom: none;
    }
    .wp-preview-exercises {
      list-style: none;
      padding: var(--space-xs) 0 0 var(--space-md);
      margin: 0;
      font-size: var(--font-sm);
      color: var(--text-secondary);
    }
    .wp-preview-exercises li {
      padding: 2px 0;
    }

    /* ===== Schedule Modification Panel ===== */
    .wp-header-btns {
      display: flex;
      gap: var(--space-xs);
      flex-wrap: wrap;
    }
    .wp-modify-card { margin-bottom: var(--space-md); }
    .wp-modify-desc {
      font-size: var(--font-sm);
      color: var(--text-secondary);
      margin-bottom: var(--space-sm);
    }
    .wp-modify-options { display: grid; gap: var(--space-sm); margin: var(--space-md) 0; }
    .wp-modify-option {
      display: grid;
      grid-template-columns: 2rem 1fr;
      grid-template-rows: auto auto;
      gap: 0 var(--space-sm);
      padding: var(--space-sm) var(--space-md);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--bg-input);
      cursor: pointer;
      text-align: left;
      transition: border-color var(--transition-fast);
    }
    .wp-modify-option:hover { border-color: var(--accent); }
    .wp-modify-icon { font-size: var(--font-lg); grid-row: span 2; align-self: center; }
    .wp-modify-label { font-weight: 600; color: var(--text-primary); font-size: var(--font-sm); }
    .wp-modify-detail { color: var(--text-muted); font-size: var(--font-xs); }
    .wp-modify-subform { margin-top: var(--space-md); display: grid; gap: var(--space-sm); }
    .wp-modify-note { font-size: var(--font-xs); color: var(--text-muted); line-height: 1.5; }
    .wp-override-banner {
      border-color: var(--warning);
      background: rgba(251, 191, 36, 0.08);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-sm);
      font-size: var(--font-sm);
    }
    .wp-override-remaining { color: var(--text-muted); font-size: var(--font-xs); }

    /* ===== Beginner Guide ===== */
    .wp-beginner-guide-toggle {
      margin: var(--space-sm) 0;
    }
    .wp-guide-link {
      cursor: pointer;
      color: var(--accent);
      font-size: var(--font-sm);
      font-weight: 500;
    }
    .wp-guide-link:hover { text-decoration: underline; }
    .wp-beginner-guide {
      margin-top: var(--space-md);
      display: grid;
      gap: var(--space-md);
    }
    .wp-guide-section {
      padding: var(--space-md);
      background: var(--bg-input);
      border-radius: var(--radius-md);
      border-left: 3px solid var(--accent);
    }
    .wp-guide-section-title {
      font-size: var(--font-lg);
      color: var(--text-primary);
      margin-bottom: var(--space-sm);
    }
    .wp-guide-section-content {
      font-size: var(--font-sm);
      color: var(--text-secondary);
      line-height: 1.8;
    }
    .wp-guide-section-content strong {
      color: var(--text-primary);
    }
    .wp-guide-takeaway {
      margin-top: var(--space-sm);
      padding: var(--space-sm) var(--space-md);
      background: var(--accent-glow);
      border-radius: var(--radius-sm);
      font-size: var(--font-sm);
      color: var(--accent);
      font-weight: 500;
    }
    .wp-guide-source {
      margin-top: var(--space-xs);
      font-size: var(--font-2xs);
      color: var(--text-muted);
      font-style: italic;
    }

    /* ===== RPE Calculator ===== */
    .wp-rpe-calc-summary {
      cursor: pointer;
      color: var(--accent);
      font-size: var(--font-sm);
      font-weight: 600;
    }
    .wp-rpe-calc-desc {
      font-size: var(--font-xs);
      color: var(--text-muted);
      margin-bottom: var(--space-sm);
    }
    .wp-rpe-calc-inputs {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr auto;
      gap: var(--space-sm);
      align-items: end;
      margin-bottom: var(--space-md);
    }
    .wp-rpe-calc-field { display: flex; flex-direction: column; }
    .wp-rpe-calc-btn { min-height: 38px; white-space: nowrap; }
    .wp-rpe-result-hero {
      text-align: center;
      padding: var(--space-md);
      background: var(--accent-glow);
      border-radius: var(--radius-md);
      margin-bottom: var(--space-md);
    }
    .wp-rpe-result-label {
      font-size: var(--font-xs);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .wp-rpe-result-value {
      font-size: var(--font-2xl);
      font-weight: 700;
      color: var(--accent);
    }
    .wp-rpe-result-detail {
      font-size: var(--font-sm);
      color: var(--text-secondary);
      margin-top: var(--space-xs);
    }
    .wp-rpe-result-desc {
      font-size: var(--font-xs);
      color: var(--text-muted);
      margin-top: 2px;
    }
    .wp-rpe-table-label {
      font-size: var(--font-xs);
      color: var(--text-muted);
      margin-bottom: var(--space-xs);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .wp-rpe-table {
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      overflow: hidden;
      font-size: var(--font-sm);
    }
    .wp-rpe-table-header {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1.5fr;
      padding: var(--space-xs) var(--space-sm);
      background: var(--bg-input);
      font-size: var(--font-2xs);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border);
    }
    .wp-rpe-row {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1.5fr;
      padding: var(--space-xs) var(--space-sm);
      border-bottom: 1px solid var(--border);
      color: var(--text-secondary);
    }
    .wp-rpe-row:last-child { border-bottom: none; }
    .wp-rpe-row-current {
      background: var(--accent-glow);
      font-weight: 600;
      color: var(--text-primary);
    }
    .wp-rpe-row-weight {
      font-weight: 600;
      color: var(--text-primary);
    }
    @media (max-width: 500px) {
      .wp-rpe-calc-inputs {
        grid-template-columns: 1fr 1fr;
      }
      .wp-rpe-calc-btn {
        grid-column: span 2;
      }
    }
  `;
  document.head.appendChild(style);
}
