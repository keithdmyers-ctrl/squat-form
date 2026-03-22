/**
 * Workout completion UI: post-workout feedback, workout completion, accessory recommendations,
 * adaptation display, and weight recommendation rendering.
 * Extracted from ui-workout.ts for modularity.
 */

import { PROGRAMS, EXERCISE_SLOTS } from './workout-programs';
import {
  loadWorkoutLogs,
  loadUserProfile,
  recordSetResult, advanceWorkout,
  recommendAccessories,
  processAdaptations,
  getRecentFormScores,
  getRecentWeakDimensions,
  getEstimated1RMs,
} from './program-generator';
import type {
  ProgramState, WorkoutLog, WorkoutSet, GeneratedWorkout,
  PostWorkoutFeedback,
  AdaptationDecision,
  WeightRecommendation,
} from './program-generator';
import { escapeHtml } from './ui-utilities';
import { safeSaveProgramState, safeSaveWorkoutLogs } from './ui-workout';
import { getAllPRsByLift } from './pr-tracker';
import { calculateCompTotal, saveCompTotal, renderCompTotalCard } from './competition';
import { calculateWilks2, calculateGLPoints, computeDOTS } from './one-rm';
import { renderSessionMusclesSummary, injectMuscleMapStyles, attachMuscleMapListeners } from './muscle-map';
import { stopActiveRestTimer, clearInProgressWorkout } from './ui-workout-session';

const INJURY_AREAS = ['lower back', 'knees', 'shoulders', 'elbows', 'hips', 'wrists'];
const INJURY_SEVERITIES = ['minor discomfort', 'pain during exercise', 'pain after exercise', 'cannot perform'];

// ─── Accessory Recommendations from Form Analysis ───

export function renderAccessoryRecommendations(state: ProgramState): string {
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

// ─── Post-Workout Feedback Form ───

function renderFeedbackForm(
  container: HTMLElement,
  state: ProgramState,
  workout: GeneratedWorkout,
  sets: WorkoutSet[],
  log: WorkoutLog,
  progressMessages: string[],
  renderActiveProgramFn: (container: HTMLElement, state: ProgramState) => void,
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
    renderWorkoutComplete(container, state, workout, progressMessages, renderActiveProgramFn, adaptationResult.decisions, adaptationResult.recommendations);
  });
}

// ─── Complete Workout ───

export function completeWorkout(
  container: HTMLElement,
  state: ProgramState,
  workout: GeneratedWorkout,
  renderActiveProgramFn: (container: HTMLElement, state: ProgramState) => void,
): void {
  // Clear in-progress auto-save data
  clearInProgressWorkout();

  // Stop any running rest timer
  stopActiveRestTimer();

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
  const READINESS_KEY = 'squat_form_readiness';
  let readiness: import('./program-generator').ReadinessData | undefined;
  try {
    const raw = localStorage.getItem(READINESS_KEY);
    if (raw) {
      const data = JSON.parse(raw) as { date: string; readiness: import('./program-generator').ReadinessData };
      if (data.date === new Date().toISOString().slice(0, 10)) readiness = data.readiness;
    }
  } catch { /* ignore */ }

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
    const mainLiftKeys = ['squat', 'bench', 'deadlift', 'ohp'];
    for (const liftKey of mainLiftKeys) {
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
  renderFeedbackForm(container, state, workout, sets, log, progressMessages, renderActiveProgramFn);
}

// ─── Workout Complete Screen ───

function renderWorkoutComplete(
  container: HTMLElement,
  state: ProgramState,
  workout: GeneratedWorkout,
  progressMessages: string[],
  renderActiveProgramFn: (container: HTMLElement, state: ProgramState) => void,
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

  // Show session muscle map
  {
    const sessionSets: Array<{ exerciseSlot: string; completed: boolean }> = [];
    for (const ex of workout.exercises) {
      for (const _s of ex.sets) {
        sessionSets.push({ exerciseSlot: ex.exerciseSlot, completed: true });
      }
    }
    html += `<div class="card card--static">${renderSessionMusclesSummary(sessionSets)}</div>`;
  }

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

  // Wire up muscle map interactivity
  injectMuscleMapStyles();
  const mmContainers = container.querySelectorAll<HTMLElement>('.mm-container');
  mmContainers.forEach(mc => attachMuscleMapListeners(mc));

  const nextBtn = container.querySelector('#wp-next-workout') as HTMLButtonElement;
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      renderActiveProgramFn(container, state);
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
