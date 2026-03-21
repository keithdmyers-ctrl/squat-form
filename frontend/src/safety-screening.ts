/**
 * PAR-Q+ pre-participation screening, pre-existing condition management,
 * and post-set pain prompts. Based on the PAR-Q+ 2020 standard with
 * powerlifting-specific additions.
 *
 * References:
 * - PAR-Q+ (Warburton et al., 2011; updated 2020)
 * - ACSM Guidelines for Exercise Testing and Prescription (11th ed.)
 * - NSCA Essentials of Strength Training and Conditioning (4th ed.)
 */

import type {
  PARQQuestion,
  PARQResult,
  PreExistingCondition,
  ExerciseModification,
  PainReport,
} from './types';

// Re-export types for convenience
export type {
  PARQQuestion,
  PARQResult,
  PreExistingCondition,
  ExerciseModification,
  PainReport,
};

// ─── Styles ───

const SS_STYLES = `
.ss-skip-top-spaced { margin-top: var(--space-sm); }
`;

function injectSSStyles(): void {
  if (document.getElementById('ss-extra-styles')) return;
  const style = document.createElement('style');
  style.id = 'ss-extra-styles';
  style.textContent = SS_STYLES;
  document.head.appendChild(style);
}

// ─── Storage Keys ───

const PARQ_STORAGE_KEY = 'squat_form_parq';
const CONDITIONS_STORAGE_KEY = 'squat_form_conditions';
const PAIN_HISTORY_KEY = 'squat_form_pain_history';
const PAIN_SET_COUNTER_KEY = 'squat_form_pain_set_counter';

/** ACSM recommends annual re-screening. */
const PARQ_EXPIRY_MONTHS = 12;

// ─── PAR-Q+ Questions ───

export const PARQ_QUESTIONS: PARQQuestion[] = [
  // Standard PAR-Q+ 2020 questions
  {
    id: 'heart_condition',
    text: 'Has your doctor ever said that you have a heart condition OR high blood pressure?',
    category: 'cardiovascular',
    followUp: 'Please describe your condition and any medications you take.',
    referralUrgency: 'immediate',
  },
  {
    id: 'chest_pain',
    text: 'Do you feel pain in your chest at rest, during your daily activities of living, OR when you do physical activity?',
    category: 'cardiovascular',
    followUp: 'When does the pain occur? Has it been evaluated by a physician?',
    referralUrgency: 'immediate',
  },
  {
    id: 'dizziness',
    text: 'Do you lose balance because of dizziness OR have you lost consciousness in the last 12 months?',
    category: 'cardiovascular',
    followUp: 'How frequently does this occur? Under what circumstances?',
    referralUrgency: 'immediate',
  },
  {
    id: 'bone_joint',
    text: 'Have you ever been diagnosed with another chronic medical condition (other than heart disease or high blood pressure)?',
    category: 'musculoskeletal',
    followUp: 'Please select the condition(s) from the pre-existing conditions list below.',
    referralUrgency: 'recommended',
  },
  {
    id: 'medication',
    text: 'Are you currently taking prescribed medications for a chronic medical condition?',
    category: 'cardiovascular',
    followUp: 'Some medications affect heart rate and blood pressure response to exercise. Consider consulting your prescribing physician.',
    referralUrgency: 'recommended',
  },
  {
    id: 'physical_reason',
    text: 'Do you currently have (or have had within the past 12 months) a bone, joint, or soft tissue problem that could be made worse by becoming more physically active?',
    category: 'musculoskeletal',
    followUp: 'Please identify the affected area(s) and select any applicable conditions below.',
    referralUrgency: 'recommended',
  },
  {
    id: 'doctor_advised',
    text: 'Has your doctor ever said that you should only do medically supervised physical activity?',
    category: 'general',
    followUp: 'We recommend obtaining written clearance from your physician before proceeding.',
    referralUrgency: 'immediate',
  },
  // Powerlifting-specific additions
  {
    id: 'orthopedic_surgery',
    text: 'Have you had any orthopedic surgery (joint replacement, ligament repair, spinal surgery) in the past 2 years?',
    category: 'musculoskeletal',
    followUp: 'What type of surgery and when? Have you been cleared for heavy resistance training?',
    referralUrgency: 'recommended',
  },
  {
    id: 'disc_herniation',
    text: 'Have you ever been diagnosed with a herniated, bulging, or degenerative disc?',
    category: 'musculoskeletal',
    followUp: 'Which level(s) are affected? We will modify deadlift and squat setup accordingly.',
    referralUrgency: 'recommended',
  },
  {
    id: 'shoulder_impingement',
    text: 'Do you have a history of shoulder impingement, instability, or rotator cuff injury?',
    category: 'musculoskeletal',
    followUp: 'Which shoulder(s)? We will adjust bench and overhead pressing recommendations.',
    referralUrgency: 'informational',
  },
  {
    id: 'hypertension',
    text: 'Have you been diagnosed with hypertension (high blood pressure), even if currently managed with medication?',
    category: 'cardiovascular',
    followUp: 'The Valsalva maneuver may be contraindicated. We will recommend controlled breathing and lighter loads.',
    referralUrgency: 'recommended',
  },
  {
    id: 'pregnancy',
    text: 'Are you currently pregnant?',
    category: 'general',
    followUp: 'Resistance training can be safe and beneficial during pregnancy with appropriate modifications. We will adjust intensity limits and exercise recommendations per ACOG 2020 guidelines. Consult your OB-GYN or midwife before continuing.',
    referralUrgency: 'recommended',
  },
];

// ─── Pre-Existing Conditions Database ───

export const CONDITIONS_DATABASE: PreExistingCondition[] = [
  {
    id: 'knee_replacement',
    name: 'Knee Replacement (Total or Partial)',
    category: 'joint',
    modifications: [
      {
        exercise: 'squat',
        modification: 'Limit depth to parallel or above (90-degree knee angle). Use box squats for depth control. Avoid bouncing out of the bottom.',
        contraindicated: false,
      },
      {
        exercise: 'lunge',
        modification: 'Avoid deep lunges and walking lunges.',
        contraindicated: true,
        substitute: 'Step-ups to a low box or leg press with limited ROM',
      },
      {
        exercise: 'deadlift',
        modification: 'Prefer trap bar or sumo stance to reduce knee flexion demand.',
        contraindicated: false,
      },
    ],
  },
  {
    id: 'disc_herniation',
    name: 'Herniated / Bulging Disc',
    category: 'spine',
    modifications: [
      {
        exercise: 'deadlift',
        modification: 'Start from blocks or elevated position to reduce spinal flexion at the bottom. Maintain strict neutral spine throughout. Avoid conventional pulls from the floor until cleared.',
        contraindicated: false,
      },
      {
        exercise: 'squat',
        modification: 'Emphasize neutral spine throughout. Use safety squat bar or front squat to reduce spinal loading. Avoid loaded spinal flexion (buttwink).',
        contraindicated: false,
      },
      {
        exercise: 'barbell_row',
        modification: 'Avoid unsupported bent-over rows with heavy loads.',
        contraindicated: true,
        substitute: 'Chest-supported rows, cable rows, or machine rows',
      },
      {
        exercise: 'overhead_press',
        modification: 'Seated press with back support to reduce axial loading. Avoid excessive lumbar extension.',
        contraindicated: false,
      },
    ],
  },
  {
    id: 'shoulder_impingement',
    name: 'Shoulder Impingement / Instability',
    category: 'shoulder',
    modifications: [
      {
        exercise: 'bench_press',
        modification: 'Use a moderate grip width (hands at 1.5x shoulder width or narrower). Keep elbows at 45-degree angle, not flared to 90. Add external rotation warm-ups.',
        contraindicated: false,
      },
      {
        exercise: 'overhead_press',
        modification: 'Limit range of motion to pain-free range. Avoid behind-the-neck press entirely.',
        contraindicated: false,
      },
      {
        exercise: 'squat',
        modification: 'Use a higher bar position or safety squat bar if low-bar causes shoulder pain. Widen grip on the bar.',
        contraindicated: false,
      },
    ],
  },
  {
    id: 'patellofemoral_syndrome',
    name: 'Patellofemoral Pain Syndrome (Runner\'s Knee)',
    category: 'joint',
    modifications: [
      {
        exercise: 'squat',
        modification: 'Limit depth to parallel. Avoid deep squats below parallel until pain-free. Focus on controlled tempo (3-second eccentric).',
        contraindicated: false,
      },
      {
        exercise: 'lunge',
        modification: 'Avoid knee-dominant lunges and deep forward lunges.',
        contraindicated: true,
        substitute: 'Reverse lunges with shorter stride, hip thrusts, or Romanian deadlifts',
      },
      {
        exercise: 'deadlift',
        modification: 'Prefer hip-dominant variations (Romanian deadlift, stiff-leg). Avoid excessive knee flexion at the start.',
        contraindicated: false,
      },
    ],
  },
  {
    id: 'spondylolisthesis',
    name: 'Spondylolisthesis / Spondylolysis',
    category: 'spine',
    modifications: [
      {
        exercise: 'squat',
        modification: 'Avoid deep flexion under heavy load. Limit depth to parallel. Use belt and brace core aggressively.',
        contraindicated: false,
      },
      {
        exercise: 'deadlift',
        modification: 'Avoid heavy conventional deadlifts from the floor. Limit hyperextension at lockout.',
        contraindicated: false,
      },
      {
        exercise: 'overhead_press',
        modification: 'Avoid excessive lumbar hyperextension. Perform seated with back support.',
        contraindicated: false,
      },
      {
        exercise: 'barbell_row',
        modification: 'Avoid heavy unsupported bent-over positions.',
        contraindicated: true,
        substitute: 'Chest-supported rows or seated cable rows',
      },
    ],
  },
  {
    id: 'hypertension',
    name: 'Hypertension (High Blood Pressure)',
    category: 'cardiovascular',
    modifications: [
      {
        exercise: 'squat',
        modification: 'Avoid the Valsalva maneuver. Use controlled rhythmic breathing (exhale on exertion). Keep loads moderate (RPE 6-7). Take longer rest periods (3-5 minutes).',
        contraindicated: false,
      },
      {
        exercise: 'deadlift',
        modification: 'Avoid the Valsalva maneuver. Use controlled breathing. Avoid maximal or near-maximal attempts without physician clearance.',
        contraindicated: false,
      },
      {
        exercise: 'bench_press',
        modification: 'Avoid the Valsalva maneuver. Controlled breathing throughout. Avoid heavy isometric holds.',
        contraindicated: false,
      },
      {
        exercise: 'overhead_press',
        modification: 'Seated preferred to reduce blood pressure spike. Controlled breathing, moderate loads only.',
        contraindicated: false,
      },
      {
        exercise: 'barbell_row',
        modification: 'Avoid breath-holding. Moderate loads with controlled breathing.',
        contraindicated: false,
      },
      {
        exercise: 'lunge',
        modification: 'Moderate loads, controlled breathing. Longer rest periods between sets.',
        contraindicated: false,
      },
    ],
  },
  {
    id: 'pregnancy',
    name: 'Pregnancy',
    category: 'other',
    modifications: [
      {
        exercise: 'squat',
        modification: 'Use lighter loads (RPE 6-7 max). Avoid maximal efforts. Use controlled breathing instead of Valsalva.',
        contraindicated: false,
      },
      {
        exercise: 'deadlift',
        modification: 'Use lighter loads. Switch to sumo or trap bar if conventional becomes uncomfortable. Avoid Valsalva.',
        contraindicated: false,
      },
      {
        exercise: 'bench_press',
        modification: 'After first trimester, use incline bench instead of flat to avoid supine hypotension. Limit to RPE 6-7.',
        contraindicated: false,
        substitute: 'Incline dumbbell press',
      },
      {
        exercise: 'overhead_press',
        modification: 'Keep loads moderate. Avoid heavy overhead work if experiencing dizziness or balance issues.',
        contraindicated: false,
      },
      {
        exercise: 'barbell_row',
        modification: 'Switch to cable rows or supported chest rows as belly grows. Avoid bent-over position in late pregnancy.',
        contraindicated: false,
        substitute: 'Seated cable row',
      },
      {
        exercise: 'lunge',
        modification: 'Use shorter range of motion. Hold dumbbells instead of barbell for better balance. Stop if experiencing pelvic pain.',
        contraindicated: false,
      },
    ],
  },
];

// ─── PAR-Q Storage Functions ───

/**
 * Save a completed PAR-Q result to localStorage.
 */
export function savePARQResult(result: PARQResult): void {
  try {
    localStorage.setItem(PARQ_STORAGE_KEY, JSON.stringify(result));
  } catch {
    document.dispatchEvent(
      new CustomEvent('storage-warning', {
        detail: 'Storage is full. PAR-Q result may not be saved.',
      }),
    );
  }
}

/**
 * Load previously saved PAR-Q result, or null if none exists.
 */
export function loadPARQResult(): PARQResult | null {
  try {
    const raw = localStorage.getItem(PARQ_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PARQResult) : null;
  } catch {
    return null;
  }
}

/**
 * Check whether the PAR-Q has been completed (regardless of expiration).
 */
export function isPARQComplete(): boolean {
  const result = loadPARQResult();
  return result !== null && result.completed;
}

/**
 * Check whether the PAR-Q has expired (>12 months since completion per ACSM).
 */
export function isPARQExpired(): boolean {
  const result = loadPARQResult();
  if (!result || !result.completed || !result.completedDate) return true;

  const completedDate = new Date(result.completedDate);
  const expiryDate = new Date(completedDate);
  expiryDate.setMonth(expiryDate.getMonth() + PARQ_EXPIRY_MONTHS);

  return new Date() > expiryDate;
}

// ─── Pre-Existing Conditions Storage ───

/**
 * Save the user's selected pre-existing condition IDs.
 */
export function savePreExistingConditions(conditions: string[]): void {
  try {
    localStorage.setItem(CONDITIONS_STORAGE_KEY, JSON.stringify(conditions));
  } catch {
    document.dispatchEvent(
      new CustomEvent('storage-warning', {
        detail: 'Storage is full. Condition data may not be saved.',
      }),
    );
  }
}

/**
 * Load previously saved pre-existing condition IDs.
 */
export function loadPreExistingConditions(): string[] {
  try {
    const raw = localStorage.getItem(CONDITIONS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Get all applicable exercise modifications for a given exercise and set of conditions.
 */
export function getExerciseModifications(
  exercise: string,
  conditions: string[],
): ExerciseModification[] {
  const modifications: ExerciseModification[] = [];

  for (const conditionId of conditions) {
    const condition = CONDITIONS_DATABASE.find((c) => c.id === conditionId);
    if (!condition) continue;

    for (const mod of condition.modifications) {
      if (mod.exercise === exercise) {
        modifications.push(mod);
      }
    }
  }

  return modifications;
}

// ─── PAR-Q Processing ───

/**
 * Process PAR-Q form submission and return a structured result.
 */
export function handlePARQSubmit(formData: FormData): PARQResult {
  const responses: Record<string, boolean> = {};
  const referralReasons: string[] = [];
  const restrictions: string[] = [];
  let referralRecommended = false;
  let hasImmediateReferral = false;

  for (const question of PARQ_QUESTIONS) {
    const answer = formData.get(`parq_${question.id}`);
    const isYes = answer === 'yes';
    responses[question.id] = isYes;

    if (isYes) {
      referralRecommended = true;

      if (question.referralUrgency === 'immediate') {
        hasImmediateReferral = true;
        referralReasons.push(
          `${question.text} -- Medical clearance strongly recommended before beginning a resistance training program.`,
        );
      } else if (question.referralUrgency === 'recommended') {
        referralReasons.push(
          `${question.text} -- Consider consulting a healthcare professional.`,
        );
      }
    }
  }

  // Generate restrictions from positive responses
  if (responses['hypertension']) {
    restrictions.push(
      'Avoid Valsalva maneuver until cleared for hypertension',
    );
    restrictions.push('Use controlled rhythmic breathing during all lifts');
    restrictions.push('Keep intensity moderate (RPE 6-7) until physician clearance');
    restrictions.push('Take longer rest periods (3-5 minutes between sets)');
  }
  if (responses['disc_herniation']) {
    restrictions.push(
      'Avoid loaded spinal flexion -- maintain neutral spine on all lifts',
    );
    restrictions.push('Start deadlifts from blocks or elevated surface');
    restrictions.push('Use safety squat bar or front squat to reduce spinal loading');
  }
  if (responses['shoulder_impingement']) {
    restrictions.push('Avoid behind-the-neck movements entirely');
    restrictions.push(
      'Use moderate grip width on bench press (1.5x shoulder width or narrower)',
    );
    restrictions.push('Perform external rotation warm-ups before pressing');
  }
  if (responses['orthopedic_surgery']) {
    restrictions.push(
      'Obtain surgical clearance for heavy resistance training if not already done',
    );
    restrictions.push(
      'Start with conservative loads and progress gradually over 8-12 weeks',
    );
  }
  if (responses['heart_condition'] || responses['chest_pain']) {
    restrictions.push('Obtain physician clearance before any high-intensity exercise');
    restrictions.push('Avoid maximal attempts until cleared by a cardiologist');
  }
  if (responses['dizziness']) {
    restrictions.push('Always train with a spotter or safety pins');
    restrictions.push('Avoid exercises where loss of balance could cause injury');
  }
  if (responses['pregnancy']) {
    restrictions.push('Do not perform Valsalva maneuver -- use controlled breathing instead');
    restrictions.push('Keep intensity moderate (RPE 6-7). Avoid maximal or near-maximal efforts');
    restrictions.push('Avoid supine exercises after the first trimester (ACOG 2020)');
    restrictions.push('Stay hydrated and avoid overheating');
    restrictions.push('Consult your OB-GYN or midwife before continuing training');
  }

  const acknowledgedRisks = formData.get('parq_acknowledge') === 'yes';

  const result: PARQResult = {
    completed: true,
    completedDate: new Date().toISOString(),
    passed: !hasImmediateReferral,
    responses,
    referralRecommended,
    referralReasons,
    restrictions,
    acknowledgedRisks,
  };

  return result;
}

// ─── PAR-Q Dialog Rendering ───

/**
 * Render the complete PAR-Q screening dialog as an HTML string.
 * Uses the project's CSS design system (card, form-group, form-label, etc.).
 */
export function renderPARQDialog(): string {
  injectSSStyles();

  const existingResult = loadPARQResult();
  const existingConditions = loadPreExistingConditions();

  let html = `
    <div class="ss-parq-overlay" id="ss-parq-overlay" role="dialog" aria-modal="true" aria-label="Pre-Participation Health Screening">
      <div class="card card--static ss-parq-dialog">
        <div class="ss-parq-header">
          <h2 class="section-heading-sm">Health Screening (PAR-Q+)</h2>
          <p class="ss-parq-desc">
            Before starting any exercise program, please complete this brief health screening.
            Your answers help us provide safe, personalized recommendations.
            All data stays on your device.
          </p>
          <button type="button" class="btn btn-secondary ss-parq-skip-top ss-skip-top-spaced" id="ss-parq-cancel-btn">
            Skip for now — I'll do this later
          </button>
        </div>

        <form id="ss-parq-form" class="ss-parq-form">
  `;

  // Group questions by category
  const categories: Array<{
    key: PARQQuestion['category'];
    label: string;
  }> = [
    { key: 'cardiovascular', label: 'Heart & Circulation' },
    { key: 'musculoskeletal', label: 'Bones, Joints & Muscles' },
    { key: 'general', label: 'General Health' },
  ];

  for (const cat of categories) {
    const questions = PARQ_QUESTIONS.filter((q) => q.category === cat.key);
    if (questions.length === 0) continue;

    html += `
      <fieldset class="ss-parq-fieldset">
        <legend class="ss-parq-legend">${cat.label}</legend>
    `;

    for (const q of questions) {
      const prevAnswer = existingResult?.responses?.[q.id];
      const yesChecked = prevAnswer === true ? 'checked' : '';
      const noChecked = prevAnswer === false ? 'checked' : '';

      html += `
        <div class="form-group ss-parq-question" data-question-id="${q.id}">
          <label class="form-label ss-parq-question-text">${q.text}</label>
          <div class="ss-parq-answer-group" role="radiogroup" aria-label="${q.text}">
            <label class="ss-parq-radio-label">
              <input type="radio" name="parq_${q.id}" value="no" ${noChecked} class="ss-parq-radio" />
              <span class="ss-parq-radio-text">No</span>
            </label>
            <label class="ss-parq-radio-label">
              <input type="radio" name="parq_${q.id}" value="yes" ${yesChecked} class="ss-parq-radio" />
              <span class="ss-parq-radio-text">Yes</span>
            </label>
          </div>
          ${q.followUp ? `<p class="ss-parq-followup ss-hidden" data-followup="${q.id}">${q.followUp}</p>` : ''}
        </div>
      `;
    }

    html += `</fieldset>`;
  }

  // Pre-existing conditions section
  html += renderConditionSelectorInner(existingConditions);

  // Acknowledgement
  const ackChecked = existingResult?.acknowledgedRisks ? 'checked' : '';
  html += `
        <div class="form-group ss-parq-ack">
          <label class="ss-parq-ack-label">
            <input type="checkbox" name="parq_acknowledge" value="yes" ${ackChecked} id="ss-parq-ack-input" />
            <span>I understand that this screening is not a substitute for professional medical advice.
            If I answered "Yes" to any question, I acknowledge the recommendation to consult a
            healthcare professional before beginning or continuing a resistance training program.</span>
          </label>
        </div>

        <div class="ss-parq-actions">
          <button type="submit" class="btn btn-primary ss-parq-submit" id="ss-parq-submit-btn">
            Complete Screening
          </button>
          <button type="button" class="btn btn-secondary ss-parq-cancel ss-parq-skip-bottom">
            Skip for Now
          </button>
        </div>
      </form>
    </div>
  </div>
  `;

  return html;
}

/**
 * Render the condition selector as a standalone HTML string.
 */
export function renderConditionSelector(): string {
  const existingConditions = loadPreExistingConditions();
  return `
    <div class="card card--static ss-conditions-card">
      <h3 class="section-heading-sm">Pre-Existing Conditions</h3>
      <p class="ss-parq-desc">Select any conditions that apply. This helps us provide safer exercise modifications.</p>
      <form id="ss-conditions-form">
        ${renderConditionSelectorInner(existingConditions)}
        <div class="ss-parq-actions">
          <button type="submit" class="btn btn-primary">Save Conditions</button>
        </div>
      </form>
    </div>
  `;
}

/**
 * Inner HTML for the condition checklist (used by both PAR-Q dialog and standalone selector).
 */
function renderConditionSelectorInner(selectedIds: string[]): string {
  const categoryLabels: Record<string, string> = {
    joint: 'Joint Conditions',
    spine: 'Spinal Conditions',
    shoulder: 'Shoulder Conditions',
    cardiovascular: 'Cardiovascular',
    neurological: 'Neurological',
    other: 'Other',
  };

  // Group conditions by category
  const grouped = new Map<string, PreExistingCondition[]>();
  for (const condition of CONDITIONS_DATABASE) {
    const group = grouped.get(condition.category) || [];
    group.push(condition);
    grouped.set(condition.category, group);
  }

  let html = `
    <fieldset class="ss-parq-fieldset ss-conditions-fieldset">
      <legend class="ss-parq-legend">Pre-Existing Conditions (select all that apply)</legend>
  `;

  for (const [category, conditions] of grouped) {
    const label = categoryLabels[category] || category;
    html += `<div class="ss-condition-group">
      <span class="ss-condition-group-label">${label}</span>`;

    for (const condition of conditions) {
      const isChecked = selectedIds.includes(condition.id) ? 'checked' : '';
      html += `
        <label class="ss-condition-checkbox-label">
          <input type="checkbox" name="condition" value="${condition.id}" ${isChecked} class="ss-condition-checkbox" />
          <span>${condition.name}</span>
        </label>
      `;
    }
    html += `</div>`;
  }

  html += `</fieldset>`;
  return html;
}

// ─── PAR-Q Result Display ───

/**
 * Render a summary of the PAR-Q result for display in settings or a summary card.
 */
export function renderPARQResultSummary(result: PARQResult): string {
  const completedDate = new Date(result.completedDate);
  const dateStr = completedDate.toLocaleDateString();
  const expired = isPARQExpired();

  let statusClass = 'ss-status-pass';
  let statusText = 'Cleared';
  if (!result.passed) {
    statusClass = 'ss-status-referral';
    statusText = 'Medical Referral Recommended';
  } else if (result.referralRecommended) {
    statusClass = 'ss-status-caution';
    statusText = 'Cleared with Cautions';
  }
  if (expired) {
    statusClass = 'ss-status-expired';
    statusText = 'Expired -- Please Re-Screen';
  }

  let html = `
    <div class="card card--static ss-result-card">
      <div class="ss-result-header">
        <h4 class="ss-result-title">Health Screening</h4>
        <span class="ss-status-badge ${statusClass}">${statusText}</span>
      </div>
      <p class="ss-result-date">Completed: ${dateStr}</p>
  `;

  if (result.restrictions.length > 0) {
    html += `
      <div class="ss-restrictions">
        <h5 class="ss-restrictions-title">Active Restrictions</h5>
        <ul class="ss-restrictions-list">
          ${result.restrictions.map((r) => `<li>${r}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  if (result.referralReasons.length > 0 && !expired) {
    html += `
      <details class="ss-referral-details">
        <summary>Referral Details (${result.referralReasons.length})</summary>
        <ul class="ss-referral-list">
          ${result.referralReasons.map((r) => `<li>${r}</li>`).join('')}
        </ul>
      </details>
    `;
  }

  html += `
      <button type="button" class="btn btn-secondary ss-retake-btn" id="ss-retake-parq">
        ${expired ? 'Re-Screen Now' : 'Retake Screening'}
      </button>
    </div>
  `;

  return html;
}

// ─── Pain Report Storage ───

/**
 * Save a pain report to the history log.
 */
export function savePainReport(report: PainReport): void {
  try {
    const history = getAllPainHistory();
    history.push(report);
    // Keep last 200 reports to avoid storage bloat
    if (history.length > 200) {
      history.splice(0, history.length - 200);
    }
    localStorage.setItem(PAIN_HISTORY_KEY, JSON.stringify(history));
  } catch {
    document.dispatchEvent(
      new CustomEvent('storage-warning', {
        detail: 'Storage is full. Pain report may not be saved.',
      }),
    );
  }
}

/**
 * Get all pain history (across all exercises).
 */
function getAllPainHistory(): PainReport[] {
  try {
    const raw = localStorage.getItem(PAIN_HISTORY_KEY);
    return raw ? (JSON.parse(raw) as PainReport[]) : [];
  } catch {
    return [];
  }
}

/**
 * Get pain history filtered by exercise.
 */
export function getPainHistory(exercise: string): PainReport[] {
  return getAllPainHistory().filter((r) => r.exercise === exercise);
}

// ─── Pain Prompt Logic ───

/** How often to show the pain prompt (every N sets) when no previous pain. */
const PAIN_PROMPT_INTERVAL = 3;

/**
 * Check if pain prompt should be shown (PURE — no side effects).
 * Does NOT increment the set counter. Call incrementPainSetCounter()
 * separately when a set is actually completed.
 */
export function shouldShowPainPrompt(exercise: string): boolean {
  // Always show if there was recent pain for this exercise
  const history = getPainHistory(exercise);
  const recentPain = history.filter((r) => {
    const reportDate = new Date(r.timestamp);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return reportDate > sevenDaysAgo && r.type !== 'none' && r.intensity > 0;
  });
  if (recentPain.length > 0) return true;

  // Otherwise, show every N sets (read-only — does NOT increment)
  const counterKey = `${PAIN_SET_COUNTER_KEY}_${exercise}`;
  try {
    const raw = localStorage.getItem(counterKey);
    const count = raw ? parseInt(raw, 10) : 0;
    // Check what the NEXT count will be (after incrementPainSetCounter is called)
    const nextCount = count + 1;
    return nextCount % PAIN_PROMPT_INTERVAL === 0;
  } catch {
    return false;
  }
}

/**
 * Increment the set counter for pain prompt frequency tracking.
 * Call this ONLY when a set is actually completed, not during UI rendering.
 */
export function incrementPainSetCounter(exercise: string): void {
  const counterKey = `${PAIN_SET_COUNTER_KEY}_${exercise}`;
  try {
    const raw = localStorage.getItem(counterKey);
    const count = raw ? parseInt(raw, 10) : 0;
    localStorage.setItem(counterKey, String(count + 1));
  } catch {
    // Storage unavailable — silently continue
  }
}

/**
 * Check for red flag pain indicators that warrant immediate exercise cessation.
 * Includes pregnancy-specific checks when pregnancy mode is active.
 */
export function checkPainRedFlags(report: PainReport): {
  isRedFlag: boolean;
  message: string;
  action: 'stop' | 'modify' | 'continue';
} {
  // Red flags: sharp pain >= 7, any mention of numbness/tingling patterns,
  // or radiating pain indicators
  if (report.type === 'none' || report.intensity === 0) {
    return {
      isRedFlag: false,
      message: '',
      action: 'continue',
    };
  }

  const pregnant = isPregnancyMode();

  // Pregnancy-specific red flags
  if (pregnant) {
    const abdominalPelvicAreas = [
      'Abdomen', 'Left Hip', 'Right Hip',
    ];
    const isAbdominalPelvic = abdominalPelvicAreas.some(
      (area) => report.location.toLowerCase().includes(area.toLowerCase()),
    );

    // Abdominal/pelvic pain during pregnancy is always urgent
    if (isAbdominalPelvic) {
      return {
        isRedFlag: true,
        message:
          'STOP exercising immediately. Abdominal or pelvic pain during pregnancy requires immediate medical evaluation. ' +
          'Contact your OB-GYN or midwife. If you experience vaginal bleeding, regular contractions, or decreased fetal movement, seek emergency care.',
        action: 'stop',
      };
    }

    // Lower the pain threshold during pregnancy -- any pain > 5 warrants stopping
    if (report.intensity > 5) {
      return {
        isRedFlag: true,
        message:
          'STOP exercising. During pregnancy, pain above moderate intensity warrants caution. ' +
          'Relaxin hormone increases joint laxity and injury risk. Consult your OB-GYN or midwife before resuming.',
        action: 'stop',
      };
    }

    // Any pain during pregnancy warrants at least a modification
    if (report.intensity >= 3) {
      return {
        isRedFlag: false,
        message:
          'During pregnancy, err on the side of caution. Reduce weight significantly or switch to a modified exercise. ' +
          'If pain persists, stop training and consult your OB-GYN or midwife.',
        action: 'modify',
      };
    }
  }

  // Sharp pain at high intensity
  if (report.type === 'sharp' && report.intensity >= 7) {
    return {
      isRedFlag: true,
      message:
        'STOP exercising immediately. Sharp pain at this intensity may indicate an acute injury. ' +
        'We strongly recommend seeing a healthcare professional before resuming this exercise.',
      action: 'stop',
    };
  }

  // Any burning/nerve-type pain at moderate+ intensity (possible nerve involvement)
  if (report.type === 'burning' && report.intensity >= 5) {
    return {
      isRedFlag: true,
      message:
        'STOP exercising. Burning pain may indicate nerve irritation or compression. ' +
        'Please consult a healthcare professional before continuing.',
      action: 'stop',
    };
  }

  // Any pain type at very high intensity
  if (report.intensity >= 8) {
    return {
      isRedFlag: true,
      message:
        'STOP exercising. Pain at this level warrants medical evaluation. ' +
        'Do not attempt to push through significant pain.',
      action: 'stop',
    };
  }

  // Moderate pain - suggest modification
  if (report.intensity >= 4) {
    return {
      isRedFlag: false,
      message:
        'Consider reducing weight or modifying the exercise. ' +
        'If pain persists across multiple sessions, consult a healthcare professional.',
      action: 'modify',
    };
  }

  // Mild discomfort
  if (report.intensity >= 1) {
    return {
      isRedFlag: false,
      message:
        'Mild discomfort noted. Monitor across your next few sets. ' +
        'If it worsens, stop and consider modifying the exercise.',
      action: 'continue',
    };
  }

  return {
    isRedFlag: false,
    message: '',
    action: 'continue',
  };
}

// ─── Pain Prompt Rendering ───

/** Body areas for the pain location selector. */
const BODY_AREAS = [
  'Lower Back',
  'Upper Back',
  'Neck',
  'Left Shoulder',
  'Right Shoulder',
  'Left Elbow',
  'Right Elbow',
  'Left Wrist',
  'Right Wrist',
  'Left Hip',
  'Right Hip',
  'Left Knee',
  'Right Knee',
  'Left Ankle',
  'Right Ankle',
  'Chest',
  'Abdomen',
  'Other',
];

/**
 * Render the post-set pain prompt dialog as an HTML string.
 * Designed to be brief and non-intrusive with quick-select options.
 */
export function renderPainPrompt(exercise: string): string {
  const exerciseLabel = formatExerciseLabel(exercise);

  return `
    <div class="ss-pain-overlay" id="ss-pain-overlay" role="dialog" aria-modal="true" aria-label="Post-set check-in">
      <div class="card card--static ss-pain-dialog">
        <h3 class="ss-pain-title">How did that feel?</h3>
        <p class="ss-pain-subtitle">${exerciseLabel} set complete</p>

        <div class="ss-pain-quick-options" id="ss-pain-quick">
          <button type="button" class="btn ss-pain-quick-btn ss-pain-fine" data-response="fine">
            Fine
          </button>
          <button type="button" class="btn ss-pain-quick-btn ss-pain-discomfort" data-response="discomfort">
            Some Discomfort
          </button>
          <button type="button" class="btn ss-pain-quick-btn ss-pain-pain" data-response="pain">
            Pain
          </button>
        </div>

        <form id="ss-pain-form" class="ss-pain-detail-form ss-hidden" data-exercise="${exercise}">
          <div class="form-group">
            <label for="ss-pain-location" class="form-label">Where do you feel it?</label>
            <select id="ss-pain-location" name="pain_location" class="form-select" required>
              <option value="">Select area</option>
              ${BODY_AREAS.map((area) => `<option value="${area}">${area}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">What type of sensation?</label>
            <div class="ss-pain-type-group" role="radiogroup" aria-label="Pain type">
              <label class="ss-pain-type-label">
                <input type="radio" name="pain_type" value="sharp" class="ss-pain-type-radio" />
                <span>Sharp</span>
              </label>
              <label class="ss-pain-type-label">
                <input type="radio" name="pain_type" value="dull" class="ss-pain-type-radio" checked />
                <span>Dull / Aching</span>
              </label>
              <label class="ss-pain-type-label">
                <input type="radio" name="pain_type" value="burning" class="ss-pain-type-radio" />
                <span>Burning / Tingling</span>
              </label>
              <label class="ss-pain-type-label">
                <input type="radio" name="pain_type" value="pressure" class="ss-pain-type-radio" />
                <span>Pressure / Tightness</span>
              </label>
            </div>
          </div>

          <div class="form-group">
            <label for="ss-pain-intensity" class="form-label">
              Intensity: <span id="ss-pain-intensity-value" class="ss-pain-intensity-display">0</span>/10
            </label>
            <input type="range" id="ss-pain-intensity" name="pain_intensity"
              min="0" max="10" value="0" step="1"
              class="ss-pain-slider"
              aria-label="Pain intensity from 0 to 10" />
            <div class="ss-pain-scale-labels">
              <span>0 - None</span>
              <span>5 - Moderate</span>
              <span>10 - Worst</span>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">When did it start?</label>
            <div class="ss-pain-onset-group" role="radiogroup" aria-label="Pain onset">
              <label class="ss-pain-onset-label">
                <input type="radio" name="pain_onset" value="during_set" class="ss-pain-onset-radio" checked />
                <span>During the set</span>
              </label>
              <label class="ss-pain-onset-label">
                <input type="radio" name="pain_onset" value="after_set" class="ss-pain-onset-radio" />
                <span>After the set</span>
              </label>
              <label class="ss-pain-onset-label">
                <input type="radio" name="pain_onset" value="pre_existing" class="ss-pain-onset-radio" />
                <span>Was already there</span>
              </label>
            </div>
          </div>

          <div class="ss-pain-actions">
            <button type="submit" class="btn btn-primary ss-pain-submit">Log &amp; Continue</button>
            <button type="button" class="btn btn-secondary ss-pain-dismiss" id="ss-pain-dismiss-btn">Dismiss</button>
          </div>
        </form>

        <div id="ss-pain-result" class="ss-pain-result ss-hidden"></div>
      </div>
    </div>
  `;
}

/**
 * Process pain prompt form submission and return a structured report.
 */
export function handlePainReport(
  formData: FormData,
  exercise: string,
): PainReport {
  const location = (formData.get('pain_location') as string) || 'Unknown';
  const type = (formData.get('pain_type') as PainReport['type']) || 'dull';
  const intensityStr = formData.get('pain_intensity') as string;
  const intensity = intensityStr ? parseInt(intensityStr, 10) : 0;
  const onset =
    (formData.get('pain_onset') as PainReport['onset']) || 'during_set';

  return {
    timestamp: new Date().toISOString(),
    exercise,
    location,
    type,
    intensity,
    onset,
  };
}

// ─── Pregnancy Mode ───

/**
 * Check if pregnancy is in the user's saved conditions.
 */
export function isPregnancyMode(): boolean {
  const conditions = loadPreExistingConditions();
  return conditions.includes('pregnancy');
}

/**
 * Return a list of general pregnancy training guidelines based on ACOG 2020 and
 * current sports medicine evidence.
 */
export function getPregnancyGuidelines(): string[] {
  return [
    'Avoid supine exercises after the first trimester (ACOG 2020)',
    'Do not perform Valsalva maneuver -- use controlled breathing instead',
    'Keep intensity moderate (RPE 6-7). Avoid maximal or near-maximal efforts',
    'Stay hydrated and avoid overheating',
    'Stop immediately if experiencing: vaginal bleeding, dizziness, headache, chest pain, calf pain/swelling, regular contractions, decreased fetal movement',
    'Relaxin hormone increases joint laxity -- be cautious with deep stretches and heavy loads',
    'Consult your OB-GYN or midwife before continuing training',
  ];
}

/**
 * Render a persistent info banner for pregnancy mode.
 * Shown at the top of workout/analysis views when pregnancy mode is active.
 */
export function renderPregnancyBanner(): string {
  const guidelines = getPregnancyGuidelines();

  return `
    <div class="ss-pregnancy-banner" role="alert">
      <div class="ss-pregnancy-banner-header">
        <span class="ss-pregnancy-banner-icon" aria-hidden="true">&#9888;</span>
        <strong>Pregnancy Mode Active</strong>
      </div>
      <p class="ss-pregnancy-banner-text">
        Exercise modifications are applied. Keep intensity at RPE 6-7 max.
        Avoid supine exercises after the first trimester.
      </p>
      <details class="ss-pregnancy-banner-details">
        <summary>Full guidelines</summary>
        <ul class="ss-pregnancy-guidelines-list">
          ${guidelines.map((g) => `<li>${g}</li>`).join('')}
        </ul>
      </details>
    </div>
  `;
}

// ─── Helpers ───

/**
 * Convert exercise type slug to a human-readable label.
 */
function formatExerciseLabel(exercise: string): string {
  const labels: Record<string, string> = {
    squat: 'Squat',
    deadlift: 'Deadlift',
    bench_press: 'Bench Press',
    overhead_press: 'Overhead Press',
    barbell_row: 'Barbell Row',
    lunge: 'Lunge',
  };
  return labels[exercise] || exercise;
}
