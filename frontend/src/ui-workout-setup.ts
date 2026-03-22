/**
 * Workout programming UI: setup wizard, program recommendations, and program selection.
 * Extracted from ui-workout.ts for modularity.
 */

import type { UserProfile, EquipmentLevel, ProgramLevel } from './workout-programs';
import { PROGRAMS, recommendPrograms } from './workout-programs';
import {
  saveUserProfile,
  initializeProgram,
  saveProgramState,
} from './program-generator';
import type { ProgramState } from './program-generator';
import { escapeHtml } from './ui-utilities';
import { parseProgramText, buildCustomProgram, saveCustomProgram } from './custom-program';
import { getBeginnerGuide } from './beginner-guide';
import { CONDITIONS_DATABASE, savePreExistingConditions, loadPreExistingConditions } from './safety-screening';

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

function gatherProfile(card: HTMLElement): UserProfile {
  const experience = (card.querySelector('#wp-experience') as HTMLSelectElement).value as ProgramLevel;
  const days = parseInt((card.querySelector('#wp-days') as HTMLSelectElement).value, 10);
  const equipment = (card.querySelector('#wp-equipment') as HTMLSelectElement).value as EquipmentLevel;
  const goal = (card.querySelector('#wp-goal') as HTMLSelectElement).value as UserProfile['goal'];
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
  renderActiveProgramFn: (container: HTMLElement, state: ProgramState) => void,
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

  const isBeginner = profile.experienceLevel === 'beginner';
  const BEGINNER_CAP = 3;
  const visibleCount = isBeginner ? Math.min(BEGINNER_CAP, programs.length) : programs.length;

  let html = '<h4 class="section-heading-sm wp-recs-heading">Recommended Programs</h4>';

  for (let i = 0; i < programs.length; i++) {
    const program = programs[i];
    const levelClass = `wp-level-${program.level}`;
    const isBestMatch = i === 0;
    const isHidden = isBeginner && i >= BEGINNER_CAP;

    html += `
      <div class="card program-rec-card${isBestMatch ? ' wp-best-match' : ''}${isHidden ? ' wp-rec-hidden' : ''}" data-program-id="${escapeHtml(program.id)}" tabindex="${isHidden ? -1 : 0}" role="button" aria-label="${isBestMatch ? 'Best match: ' : ''}Select ${escapeHtml(program.name)}: ${escapeHtml(program.description)}"${isHidden ? ' style="display:none"' : ''}>
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

  // Add beginner note and "See all programs" link when capped
  if (isBeginner && programs.length > BEGINNER_CAP) {
    html += `
      <p class="wp-beginner-recs-note">Showing the ${visibleCount} best programs for beginners.</p>
      <button class="wp-see-all-link" id="wp-see-all-programs" type="button">See all ${programs.length} programs</button>
    `;
  }

  container.innerHTML = html;
  container.style.display = 'block';

  // Wire up "See all programs" expander for beginners
  const seeAllBtn = container.querySelector('#wp-see-all-programs') as HTMLButtonElement | null;
  if (seeAllBtn) {
    seeAllBtn.addEventListener('click', () => {
      container.querySelectorAll<HTMLElement>('.wp-rec-hidden').forEach(el => {
        el.style.display = '';
        el.classList.remove('wp-rec-hidden');
        el.setAttribute('tabindex', '0');
      });
      seeAllBtn.remove();
      const note = container.querySelector('.wp-beginner-recs-note');
      if (note) note.remove();
    });
  }

  // Wire up program selection
  container.querySelectorAll<HTMLElement>('.program-rec-card').forEach(card => {
    const handler = () => {
      const programId = card.dataset.programId;
      if (!programId) return;
      selectProgram(programId, profile, parentContainer, renderActiveProgramFn);
    };
    card.addEventListener('click', handler);
    card.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
    });
  });
}

export function selectProgram(
  programId: string,
  profile: UserProfile,
  parentContainer: HTMLElement,
  renderActiveProgramFn: (container: HTMLElement, state: ProgramState) => void,
): void {
  const unit = (document.querySelector('input[name="wp-unit"]:checked') as HTMLInputElement)?.value ?? 'lbs';
  const state = initializeProgram(programId, profile, unit);
  saveProgramState(state);
  renderActiveProgramFn(parentContainer, state);
}

// ─── Program Setup ───

export function renderProgramSetup(
  container: HTMLElement,
  existingProfile: UserProfile | null,
  renderActiveProgramFn: (container: HTMLElement, state: ProgramState) => void,
): void {
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

  // Hide conditions section for beginners
  const experienceSelect = card.querySelector('#wp-experience') as HTMLSelectElement;
  const conditionsGroup = card.querySelector('#wp-conditions-group') as HTMLElement;
  if (experienceSelect && conditionsGroup) {
    const updateConditionsVisibility = () => {
      conditionsGroup.style.display = experienceSelect.value === 'beginner' ? 'none' : '';
    };
    updateConditionsVisibility(); // Apply on initial render
    experienceSelect.addEventListener('change', updateConditionsVisibility);
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
    renderProgramRecommendations(recsContainer, profile, container, renderActiveProgramFn);
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
        renderActiveProgramFn(container, state);
      });
    }
  });
}
