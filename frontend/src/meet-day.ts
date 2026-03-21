/**
 * Meet-Day Mode: dedicated interface for use AT a powerlifting competition.
 *
 * Provides attempt tracking, running total, warm-up scheduling with plate
 * loading, referee light recording, next-attempt suggestions, and a
 * competition-day checklist.
 *
 * Design goals:
 * - BIG text for handler readability (10+ feet away)
 * - Large tap targets for GOOD LIFT / NO LIFT
 * - Color-coded by lift: squat=blue, bench=red, deadlift=green
 * - Countdown-style warm-up schedule with plate loading
 */

import { calculatePlates, formatPlateResult } from './plate-calculator';
import { computeDOTS } from './one-rm';

// ─── Types ───

export interface MeetAttempt {
  lift: 'squat' | 'bench' | 'deadlift';
  attemptNumber: 1 | 2 | 3;
  weight: number;
  unit: string;
  result: 'pending' | 'good' | 'no_lift';
  lights?: { left: boolean; center: boolean; right: boolean };
  notes?: string;
}

export interface MeetDayState {
  id: string;
  meetName: string;
  date: string;
  federation: string;
  weightClass: string;
  bodyweight: number;
  flightNumber?: string;
  lotNumber?: number;
  attempts: MeetAttempt[];
  currentLift: 'squat' | 'bench' | 'deadlift';
  currentAttemptNumber: 1 | 2 | 3;
  runningTotal: number;
  isComplete: boolean;
  warmupStartTime?: number;
}

export interface ChecklistItem {
  id: string;
  category: 'equipment' | 'nutrition' | 'admin' | 'warmup';
  text: string;
  checked: boolean;
  required: boolean;
}

// ─── Constants ───

const MEET_DAY_STORAGE_KEY = 'squat_form_meet_day';
const LIFT_ORDER: Array<'squat' | 'bench' | 'deadlift'> = ['squat', 'bench', 'deadlift'];
const LIFT_COLORS: Record<string, string> = {
  squat: '#3b82f6',   // blue
  bench: '#ef4444',   // red
  deadlift: '#22c55e', // green
};

// ─── Meet Setup ───

export function createMeetDayState(config: {
  meetName: string;
  federation: string;
  weightClass: string;
  bodyweight: number;
  openers: { squat: number; bench: number; deadlift: number };
  unit: string;
}): MeetDayState {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2);

  const attempts: MeetAttempt[] = [];

  for (const lift of LIFT_ORDER) {
    for (let num = 1; num <= 3; num++) {
      attempts.push({
        lift,
        attemptNumber: num as 1 | 2 | 3,
        weight: num === 1 ? config.openers[lift] : 0,
        unit: config.unit,
        result: 'pending',
      });
    }
  }

  return {
    id,
    meetName: config.meetName,
    date: new Date().toISOString().slice(0, 10),
    federation: config.federation,
    weightClass: config.weightClass,
    bodyweight: config.bodyweight,
    attempts,
    currentLift: 'squat',
    currentAttemptNumber: 1,
    runningTotal: 0,
    isComplete: false,
  };
}

// ─── Attempt Management ───

/**
 * Record the result of the current attempt.
 * Returns a new state with the attempt updated and total recalculated.
 */
export function recordAttemptResult(
  state: MeetDayState,
  result: 'good' | 'no_lift',
  lights?: { left: boolean; center: boolean; right: boolean },
): MeetDayState {
  const newState = deepCloneState(state);

  const attempt = newState.attempts.find(
    a => a.lift === newState.currentLift && a.attemptNumber === newState.currentAttemptNumber,
  );
  if (!attempt) return newState;

  attempt.result = result;
  if (lights) attempt.lights = lights;

  newState.runningTotal = calculateRunningTotal(newState);

  // Advance to next attempt or next lift
  if (newState.currentAttemptNumber < 3) {
    newState.currentAttemptNumber = (newState.currentAttemptNumber + 1) as 1 | 2 | 3;
  } else {
    // End of 3 attempts for this lift
    const liftIdx = LIFT_ORDER.indexOf(newState.currentLift);
    if (liftIdx < 2) {
      newState.currentLift = LIFT_ORDER[liftIdx + 1];
      newState.currentAttemptNumber = 1;
    } else {
      newState.isComplete = true;
    }
  }

  return newState;
}

/**
 * Set the weight for the next attempt.
 */
export function setNextAttemptWeight(
  state: MeetDayState,
  weight: number,
): MeetDayState {
  const newState = deepCloneState(state);

  const attempt = newState.attempts.find(
    a => a.lift === newState.currentLift && a.attemptNumber === newState.currentAttemptNumber,
  );
  if (attempt) {
    attempt.weight = weight;
  }

  return newState;
}

/**
 * Get suggestion for next attempt weight based on how the last one moved.
 */
export function suggestNextAttempt(state: MeetDayState): {
  suggested: number;
  conservative: number;
  aggressive: number;
  reasoning: string;
} {
  const unit = state.attempts[0]?.unit ?? 'kg';
  const increment = unit === 'lbs' ? 5 : 2.5;
  const bigIncrement = unit === 'lbs' ? 10 : 5;

  // Find the previous attempt (most recently completed)
  const completedAttempts = state.attempts.filter(
    a => a.lift === state.currentLift && a.result !== 'pending',
  );

  if (completedAttempts.length === 0) {
    // No previous attempt — we're on the opener
    const opener = state.attempts.find(
      a => a.lift === state.currentLift && a.attemptNumber === 1,
    );
    const w = opener?.weight ?? 0;
    return {
      suggested: w,
      conservative: w,
      aggressive: w,
      reasoning: 'First attempt — use your planned opener.',
    };
  }

  const lastAttempt = completedAttempts[completedAttempts.length - 1];
  const lastWeight = lastAttempt.weight;

  if (lastAttempt.result === 'good') {
    return {
      suggested: lastWeight + bigIncrement,
      conservative: lastWeight + increment,
      aggressive: lastWeight + bigIncrement * 2,
      reasoning: `Good lift at ${lastWeight}${unit}. Standard jump is +${bigIncrement}${unit}.`,
    };
  } else {
    // No lift — suggest same weight or slight decrease
    return {
      suggested: lastWeight,
      conservative: lastWeight - increment,
      aggressive: lastWeight + increment,
      reasoning: `Missed at ${lastWeight}${unit}. Retaking the same weight is safest.`,
    };
  }
}

/**
 * Advance to the next lift (squat -> bench -> deadlift).
 */
export function advanceToNextLift(state: MeetDayState): MeetDayState {
  const newState = deepCloneState(state);
  const liftIdx = LIFT_ORDER.indexOf(newState.currentLift);

  if (liftIdx < 2) {
    newState.currentLift = LIFT_ORDER[liftIdx + 1];
    newState.currentAttemptNumber = 1;
  } else {
    newState.isComplete = true;
  }

  newState.runningTotal = calculateRunningTotal(newState);
  return newState;
}

/**
 * Calculate running total from good lifts.
 * Total = best successful attempt from each completed lift.
 */
export function calculateRunningTotal(state: MeetDayState): number {
  let total = 0;

  for (const lift of LIFT_ORDER) {
    const goodAttempts = state.attempts.filter(
      a => a.lift === lift && a.result === 'good',
    );
    if (goodAttempts.length > 0) {
      total += Math.max(...goodAttempts.map(a => a.weight));
    }
  }

  return total;
}

/**
 * Check if the lifter has bombed out (all 3 attempts failed on one lift).
 */
export function hasBombedOut(state: MeetDayState): boolean {
  for (const lift of LIFT_ORDER) {
    const liftAttempts = state.attempts.filter(a => a.lift === lift);
    const allAttempted = liftAttempts.every(a => a.result !== 'pending');
    const allFailed = liftAttempts.every(a => a.result === 'no_lift');

    if (allAttempted && allFailed) return true;
  }

  return false;
}

// ─── Warm-Up Timer ───

/**
 * Calculate when to start warm-ups based on flight position.
 * Rule of thumb: start warming up ~20 minutes before expected platform time.
 * Each lifter takes ~1 minute on the platform.
 */
export function calculateWarmupStartTime(
  flightStartTime: number,
  liftersBeforeYou: number,
  minutesPerLifter: number = 1.0,
): { warmupStart: number; minutesUntilWarmup: number; minutesUntilPlatform: number } {
  const minutesUntilPlatform = liftersBeforeYou * minutesPerLifter;
  const platformTime = flightStartTime + minutesUntilPlatform * 60 * 1000;

  // Start warming up ~20 minutes before platform time, minimum 10 minutes
  const warmupMinutes = Math.max(10, Math.min(20, minutesUntilPlatform));
  const warmupStart = platformTime - warmupMinutes * 60 * 1000;

  const now = Date.now();
  const minutesUntilWarmup = Math.max(0, (warmupStart - now) / (60 * 1000));

  return {
    warmupStart,
    minutesUntilWarmup: Math.round(minutesUntilWarmup * 10) / 10,
    minutesUntilPlatform: Math.round(((platformTime - now) / (60 * 1000)) * 10) / 10,
  };
}

/**
 * Generate warm-up weights and timing for a given opener.
 * Follows standard powerlifting warm-up progressions:
 * - Start with empty bar
 * - Gradually increase in ~20% jumps
 * - Final warm-up at ~92% of opener
 * - Decreasing reps as weight increases
 */
export function generateMeetWarmupSchedule(
  opener: number,
  unit: string,
  minutesBeforePlatform: number,
): Array<{
  minutesBefore: number;
  weight: number;
  reps: number;
  plates: string;
}> {
  const barWeight = unit === 'kg' ? 20 : 45;
  const increment = unit === 'kg' ? 2.5 : 5;

  if (opener <= barWeight) {
    return [{
      minutesBefore: minutesBeforePlatform,
      weight: barWeight,
      reps: 5,
      plates: `Empty bar (${barWeight} ${unit})`,
    }];
  }

  // Build warm-up percentages
  const warmupPcts = [0, 0.30, 0.50, 0.70, 0.85, 0.92];
  const warmupReps = [5, 3, 2, 1, 1, 1];

  const schedule: Array<{
    minutesBefore: number;
    weight: number;
    reps: number;
    plates: string;
  }> = [];

  // Filter out percentages that result in weights below or equal to bar
  const usableSets: Array<{ weight: number; reps: number }> = [];

  for (let i = 0; i < warmupPcts.length; i++) {
    const rawWeight = warmupPcts[i] === 0 ? barWeight : opener * warmupPcts[i];
    const roundedWeight = Math.round(rawWeight / increment) * increment;
    const weight = Math.max(barWeight, roundedWeight);

    // Skip duplicate weights
    if (usableSets.length > 0 && usableSets[usableSets.length - 1].weight === weight) {
      continue;
    }

    usableSets.push({ weight, reps: warmupReps[i] });
  }

  // Distribute timing evenly across available minutes
  const timePerSet = minutesBeforePlatform / (usableSets.length + 1);

  for (let i = 0; i < usableSets.length; i++) {
    const minutesBefore = Math.round((minutesBeforePlatform - i * timePerSet) * 10) / 10;
    const plateResult = calculatePlates(usableSets[i].weight, unit);

    schedule.push({
      minutesBefore: Math.max(1, minutesBefore),
      weight: usableSets[i].weight,
      reps: usableSets[i].reps,
      plates: formatPlateResult(plateResult),
    });
  }

  return schedule;
}

// ─── Meet Day Checklist ───

export function getMeetDayChecklist(): ChecklistItem[] {
  return [
    // Equipment
    { id: 'eq-singlet', category: 'equipment', text: 'Singlet', checked: false, required: true },
    { id: 'eq-belt', category: 'equipment', text: 'Belt', checked: false, required: true },
    { id: 'eq-shoes', category: 'equipment', text: 'Lifting shoes', checked: false, required: true },
    { id: 'eq-knee-sleeves', category: 'equipment', text: 'Knee sleeves/wraps', checked: false, required: false },
    { id: 'eq-wrist-wraps', category: 'equipment', text: 'Wrist wraps', checked: false, required: false },
    { id: 'eq-chalk', category: 'equipment', text: 'Chalk', checked: false, required: true },
    { id: 'eq-ammonia', category: 'equipment', text: 'Ammonia (optional)', checked: false, required: false },
    { id: 'eq-deadlift-socks', category: 'equipment', text: 'Deadlift socks (long)', checked: false, required: true },

    // Nutrition
    { id: 'nut-water', category: 'nutrition', text: 'Water (2L+)', checked: false, required: true },
    { id: 'nut-carbs', category: 'nutrition', text: 'Carbs (rice cakes, gummy bears, fruit)', checked: false, required: true },
    { id: 'nut-protein', category: 'nutrition', text: 'Protein (shakes, bars)', checked: false, required: false },
    { id: 'nut-caffeine', category: 'nutrition', text: 'Caffeine (optional)', checked: false, required: false },
    { id: 'nut-snacks', category: 'nutrition', text: 'Snacks for between lifts', checked: false, required: false },
    { id: 'nut-electrolytes', category: 'nutrition', text: 'Electrolytes', checked: false, required: false },

    // Admin
    { id: 'adm-card', category: 'admin', text: 'Federation membership card', checked: false, required: true },
    { id: 'adm-registration', category: 'admin', text: 'Meet registration confirmation', checked: false, required: true },
    { id: 'adm-handler', category: 'admin', text: 'Handler contact info', checked: false, required: false },
    { id: 'adm-attempt-cards', category: 'admin', text: 'Attempt cards / attempt sheet', checked: false, required: true },
    { id: 'adm-id', category: 'admin', text: 'Government-issued ID', checked: false, required: true },

    // Warmup
    { id: 'wu-roller', category: 'warmup', text: 'Foam roller', checked: false, required: false },
    { id: 'wu-bands', category: 'warmup', text: 'Resistance bands', checked: false, required: false },
    { id: 'wu-lacrosse', category: 'warmup', text: 'Lacrosse ball', checked: false, required: false },
    { id: 'wu-warmup-gear', category: 'warmup', text: 'Light warmup clothes', checked: false, required: false },
  ];
}

// ─── UI Rendering ───

export function renderMeetDaySetup(): string {
  return `
    <div class="meet-day-setup card">
      <h2 class="fs-xl fw-bold">Meet Day Setup</h2>
      <form id="meet-day-form" class="form-stack">
        <div class="form-group">
          <label for="meet-name">Meet Name</label>
          <input type="text" id="meet-name" placeholder="e.g., State Championship" required />
        </div>
        <div class="form-group">
          <label for="meet-federation">Federation</label>
          <select id="meet-federation">
            <option value="USAPL">USAPL</option>
            <option value="IPF">IPF</option>
            <option value="USPA">USPA</option>
            <option value="WRPF">WRPF</option>
            <option value="RPS">RPS</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="meet-weight-class">Weight Class</label>
            <input type="text" id="meet-weight-class" placeholder="e.g., 83kg" required />
          </div>
          <div class="form-group">
            <label for="meet-bodyweight">Bodyweight</label>
            <input type="number" id="meet-bodyweight" step="0.1" required />
          </div>
        </div>
        <div class="form-group">
          <label for="meet-unit">Unit</label>
          <select id="meet-unit">
            <option value="kg">kg</option>
            <option value="lbs">lbs</option>
          </select>
        </div>
        <h3 class="fs-lg fw-bold">Openers</h3>
        <div class="form-row">
          <div class="form-group">
            <label for="meet-squat-opener" style="color: ${LIFT_COLORS.squat}">Squat</label>
            <input type="number" id="meet-squat-opener" step="2.5" required />
          </div>
          <div class="form-group">
            <label for="meet-bench-opener" style="color: ${LIFT_COLORS.bench}">Bench</label>
            <input type="number" id="meet-bench-opener" step="2.5" required />
          </div>
          <div class="form-group">
            <label for="meet-deadlift-opener" style="color: ${LIFT_COLORS.deadlift}">Deadlift</label>
            <input type="number" id="meet-deadlift-opener" step="2.5" required />
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-lg">Start Meet Day</button>
      </form>
    </div>
  `;
}

export function renderMeetDayDashboard(state: MeetDayState): string {
  const liftColor = LIFT_COLORS[state.currentLift] ?? '#fff';
  const unit = state.attempts[0]?.unit ?? 'kg';

  const currentAttempt = state.attempts.find(
    a => a.lift === state.currentLift && a.attemptNumber === state.currentAttemptNumber,
  );
  const currentWeight = currentAttempt?.weight ?? 0;
  const plateResult = currentWeight > 0 ? calculatePlates(currentWeight, unit) : null;

  const bombedOut = hasBombedOut(state);

  const liftSections = LIFT_ORDER.map(lift => {
    const liftAttempts = state.attempts.filter(a => a.lift === lift);
    const isCurrent = state.currentLift === lift && !state.isComplete;
    return `
      <div class="meet-lift-section ${isCurrent ? 'meet-lift-current' : ''}" style="border-color: ${LIFT_COLORS[lift]}">
        <h3 class="fs-lg fw-bold" style="color: ${LIFT_COLORS[lift]}">${lift.toUpperCase()}</h3>
        <div class="meet-attempts-row">
          ${liftAttempts.map(a => renderAttemptCard(a, isCurrent && a.attemptNumber === state.currentAttemptNumber)).join('')}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="meet-day-dashboard">
      <div class="meet-header">
        <h2 class="fs-xl fw-bold">${escapeHtml(state.meetName)}</h2>
        <span class="meet-federation badge">${escapeHtml(state.federation)}</span>
        <span class="meet-weight-class">${escapeHtml(state.weightClass)}</span>
      </div>

      ${bombedOut ? '<div class="meet-bombed-out alert alert-error fs-xl fw-bold">BOMBED OUT</div>' : ''}

      ${state.isComplete ? `
        <div class="meet-complete alert alert-success">
          <span class="fs-xxl fw-bold">MEET COMPLETE</span>
        </div>
      ` : `
        <div class="meet-current-attempt" style="border-color: ${liftColor}">
          <div class="meet-current-lift fs-lg" style="color: ${liftColor}">${state.currentLift.toUpperCase()}</div>
          <div class="meet-current-weight fs-xxl fw-bold">${currentWeight} ${unit}</div>
          <div class="meet-attempt-number fs-lg">Attempt ${state.currentAttemptNumber} of 3</div>
          ${plateResult ? `<div class="meet-plates fs-sm">${formatPlateResult(plateResult)}</div>` : ''}
          <div class="meet-result-buttons">
            <button class="btn meet-btn-good btn-lg" data-result="good" style="background: #22c55e; color: white; min-height: 60px; font-size: 1.5rem;">
              GOOD LIFT
            </button>
            <button class="btn meet-btn-no-lift btn-lg" data-result="no_lift" style="background: #ef4444; color: white; min-height: 60px; font-size: 1.5rem;">
              NO LIFT
            </button>
          </div>
        </div>
      `}

      <div class="meet-running-total">
        <span class="fs-sm">Running Total</span>
        <span class="fs-xxl fw-bold">${state.runningTotal} ${unit}</span>
      </div>

      ${liftSections}
    </div>
  `;
}

export function renderAttemptCard(attempt: MeetAttempt, isCurrent: boolean): string {
  const resultClass = attempt.result === 'good' ? 'meet-attempt-good'
    : attempt.result === 'no_lift' ? 'meet-attempt-no-lift'
    : 'meet-attempt-pending';

  const lightsDots = attempt.lights
    ? `<div class="meet-lights">
        <span class="meet-light ${attempt.lights.left ? 'meet-light-white' : 'meet-light-red'}"></span>
        <span class="meet-light ${attempt.lights.center ? 'meet-light-white' : 'meet-light-red'}"></span>
        <span class="meet-light ${attempt.lights.right ? 'meet-light-white' : 'meet-light-red'}"></span>
      </div>`
    : '';

  return `
    <div class="meet-attempt-card ${resultClass} ${isCurrent ? 'meet-attempt-active' : ''}">
      <div class="meet-attempt-num fs-sm">Attempt ${attempt.attemptNumber}</div>
      <div class="meet-attempt-weight fs-lg fw-bold">${attempt.weight > 0 ? `${attempt.weight} ${attempt.unit}` : '---'}</div>
      <div class="meet-attempt-result fs-sm">${
        attempt.result === 'good' ? 'GOOD' :
        attempt.result === 'no_lift' ? 'NO LIFT' :
        'PENDING'
      }</div>
      ${lightsDots}
    </div>
  `;
}

export function renderWarmupTimeline(
  schedule: ReturnType<typeof generateMeetWarmupSchedule>,
  currentTime: number,
): string {
  const rows = schedule.map(entry => {
    const targetTime = currentTime + entry.minutesBefore * 60 * 1000;
    const isPast = Date.now() > targetTime;
    const timeStr = `-${entry.minutesBefore} min`;

    return `
      <div class="warmup-row ${isPast ? 'warmup-past' : ''}">
        <span class="warmup-time fs-sm fw-bold">${timeStr}</span>
        <span class="warmup-weight fs-md fw-bold">${entry.weight} ${schedule[0]?.plates.includes('kg') ? 'kg' : ''}</span>
        <span class="warmup-reps">&times;${entry.reps}</span>
        <span class="warmup-plates fs-xs">${entry.plates}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="meet-warmup-timeline card">
      <h3 class="fs-lg fw-bold">Warm-Up Schedule</h3>
      ${rows}
    </div>
  `;
}

export function renderChecklist(items: ChecklistItem[]): string {
  const categories: Array<{ key: ChecklistItem['category']; label: string }> = [
    { key: 'equipment', label: 'Equipment' },
    { key: 'nutrition', label: 'Nutrition' },
    { key: 'admin', label: 'Admin / Registration' },
    { key: 'warmup', label: 'Warm-Up Gear' },
  ];

  const sections = categories.map(cat => {
    const catItems = items.filter(i => i.category === cat.key);
    const rows = catItems.map(item => `
      <label class="checklist-item ${item.checked ? 'checklist-checked' : ''} ${item.required ? 'checklist-required' : ''}">
        <input type="checkbox" data-checklist-id="${item.id}" ${item.checked ? 'checked' : ''} />
        <span>${escapeHtml(item.text)}${item.required ? ' *' : ''}</span>
      </label>
    `).join('');

    return `
      <div class="checklist-category">
        <h4 class="fs-md fw-bold">${cat.label}</h4>
        ${rows}
      </div>
    `;
  }).join('');

  const totalRequired = items.filter(i => i.required).length;
  const checkedRequired = items.filter(i => i.required && i.checked).length;

  return `
    <div class="meet-checklist card">
      <h3 class="fs-lg fw-bold">Meet Day Checklist</h3>
      <div class="checklist-progress fs-sm">${checkedRequired}/${totalRequired} required items packed</div>
      ${sections}
    </div>
  `;
}

export function renderMeetSummary(state: MeetDayState): string {
  const unit = state.attempts[0]?.unit ?? 'kg';
  const total = calculateRunningTotal(state);
  const bombedOut = hasBombedOut(state);

  // Best attempts per lift
  const bestLifts = LIFT_ORDER.map(lift => {
    const good = state.attempts.filter(a => a.lift === lift && a.result === 'good');
    const best = good.length > 0 ? Math.max(...good.map(a => a.weight)) : 0;
    return { lift, best };
  });

  // DOTS calculation (needs kg bodyweight)
  const bwKg = unit === 'lbs' ? state.bodyweight / 2.20462 : state.bodyweight;
  const totalKg = unit === 'lbs' ? total / 2.20462 : total;
  const dots = total > 0 ? computeDOTS(totalKg, bwKg, true) : null;

  const liftRows = bestLifts.map(({ lift, best }) => `
    <div class="meet-summary-lift">
      <span class="fs-md fw-bold" style="color: ${LIFT_COLORS[lift]}">${lift.toUpperCase()}</span>
      <span class="fs-lg fw-bold">${best > 0 ? `${best} ${unit}` : 'Bombed'}</span>
    </div>
  `).join('');

  return `
    <div class="meet-summary card">
      <h2 class="fs-xl fw-bold">Meet Summary</h2>
      <div class="meet-summary-header">
        <div>${escapeHtml(state.meetName)} &mdash; ${escapeHtml(state.federation)}</div>
        <div>${escapeHtml(state.weightClass)} | BW: ${state.bodyweight} ${unit}</div>
      </div>
      ${bombedOut ? '<div class="alert alert-error">Bombed Out</div>' : ''}
      ${liftRows}
      <div class="meet-summary-total">
        <span class="fs-md">Total</span>
        <span class="fs-xxl fw-bold">${total > 0 ? `${total} ${unit}` : 'N/A'}</span>
      </div>
      ${dots ? `
        <div class="meet-summary-dots">
          <span class="fs-md">DOTS Score</span>
          <span class="fs-lg fw-bold">${dots.score}</span>
        </div>
      ` : ''}
      <div class="meet-all-attempts">
        <h3 class="fs-lg fw-bold">All Attempts</h3>
        ${state.attempts.map(a => renderAttemptCard(a, false)).join('')}
      </div>
    </div>
  `;
}

// ─── Storage ───

export function saveMeetDayState(state: MeetDayState): void {
  try {
    localStorage.setItem(MEET_DAY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full — silently fail
  }
}

export function loadMeetDayState(): MeetDayState | null {
  try {
    const raw = localStorage.getItem(MEET_DAY_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MeetDayState;
  } catch {
    return null;
  }
}

export function clearMeetDayState(): void {
  try {
    localStorage.removeItem(MEET_DAY_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

// ─── Internal Helpers ───

function deepCloneState(state: MeetDayState): MeetDayState {
  return JSON.parse(JSON.stringify(state));
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
