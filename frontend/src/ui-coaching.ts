/**
 * Coaching cues, positive feedback, and beginner summary rendering.
 * Extracted from ui-results.ts for better module boundaries.
 */

import type { SetAnalysis } from './types';
import { getCorrectiveExercises, getExerciseProgressions } from './cues';
import type { CorrectiveExercise } from './cues';
import {
  escapeHtml,
  $,
  formatIssueName,
  ISSUE_DISPLAY_NAMES,
} from './ui-utilities';
import { CUE_DATABASE } from './issues';

// ─── Beginner-Friendly Labels ───

const BEGINNER_DIMENSION_LABELS: Record<string, string> = {
  'Depth': 'How Deep You Went',
  'Knee Tracking': 'Knee Position',
  'Trunk Position': 'Upper Body Position',
  'Trunk': 'Upper Body Position',
  'Torso Position': 'Upper Body Position',
  'Symmetry': 'Balance (Left vs Right)',
  'Tempo': 'Speed Control',
  'Lockout': 'Standing Up Fully',
  'ROM': 'Range of Motion',
  'Back Position': 'Back Position',
  'Row ROM': 'Pull Range',
  'Control': 'Movement Control',
  'Torso Stability': 'Core Stability',
  'Overhead Stability': 'Overhead Control',
  'Press Path': 'Bar Path',
  'Balance': 'Balance',
};

export { BEGINNER_DIMENSION_LABELS };

/** Convert technical severity labels to beginner-friendly ones. */
export function beginnerSeverity(priority: number): string {
  if (priority <= 1) return 'Fix First';
  if (priority <= 3) return 'Work On';
  return 'Minor';
}

// ─── Video Timestamp Helpers ───

/** Convert a frame number to a formatted timestamp string like "0:12". */
function formatTimestamp(frame: number, fps: number): string {
  if (fps <= 0) return '';
  const totalSeconds = Math.round(frame / fps);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Find the frame number for a given issue name from the analysis topIssues array. */
function findIssueFrame(analysis: SetAnalysis, issueName: string): number | null {
  const issue = analysis.topIssues.find((i) => i.name === issueName);
  return issue ? issue.frame : null;
}

/** Create a clickable timestamp element that seeks the video to a specific frame. */
function createTimestampLink(frame: number, fps: number): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'cue-timestamp';
  el.dataset.frame = String(frame);
  el.textContent = `[${formatTimestamp(frame, fps)}]`;
  el.title = 'Click to see this moment in the video';
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.addEventListener('click', () => {
    const video = document.getElementById('result-video') as HTMLVideoElement | null;
    if (video && fps > 0) {
      video.currentTime = frame / fps;
      video.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      el.click();
    }
  });
  return el;
}

// ─── Focus Section ("What to Work on Next") ───

export function renderFocusSection(analysis: SetAnalysis, fps: number = 0): void {
  const scoresPanel = document.querySelector('.scores-panel');
  if (!scoresPanel) return;

  // Remove existing focus section
  const existing = document.getElementById('focus-section');
  if (existing) existing.remove();

  const focusDiv = document.createElement('div');
  focusDiv.id = 'focus-section';

  if (analysis.topCues.length === 0) {
    focusDiv.className = 'focus-section focus-great';
    focusDiv.setAttribute('aria-label', 'Your form looks great');
    focusDiv.innerHTML = '<h3>Your #1 Focus</h3><p>Your form looks great! Keep practicing to maintain it.</p>';
  } else {
    focusDiv.className = 'focus-section';
    focusDiv.setAttribute('aria-label', 'Your top priority this session');

    const topCue = analysis.topCues[0];
    const exercises = getCorrectiveExercises(topCue.issue);

    let exercisesHtml = '';
    if (exercises.length > 0) {
      exercisesHtml = `
        <div class="focus-exercises">
          <h4>Try These Exercises</h4>
          ${exercises.map((ex: CorrectiveExercise) => `
            <div class="exercise-card corrective-exercise-card">
              ${ex.svg ? `<div class="corrective-exercise-svg">${ex.svg}</div>` : ''}
              <div>
                <strong>${escapeHtml(ex.name)}</strong> <span class="exercise-sets">${escapeHtml(ex.sets)}</span>${ex.videoUrl ? ` <a href="${escapeHtml(ex.videoUrl)}" target="_blank" rel="noopener" class="video-link" title="Watch demo video">&#9654; Watch</a>` : ''}
                <p>${escapeHtml(ex.description)}</p>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    focusDiv.innerHTML = `
      <h3>Your #1 Focus</h3>
      <p class="focus-cue">${escapeHtml(topCue.cue)}</p>
      <p class="focus-why">${escapeHtml(topCue.explanation)}</p>
      ${exercisesHtml}
    `;

    // Add video timestamp link if fps is available
    const focusFrame = findIssueFrame(analysis, topCue.issue);
    if (focusFrame !== null && fps > 0) {
      const timestampP = document.createElement('p');
      timestampP.className = 'focus-timestamp';
      timestampP.textContent = 'See this at ';
      timestampP.appendChild(createTimestampLink(focusFrame, fps));
      const focusWhy = focusDiv.querySelector('.focus-why');
      if (focusWhy) {
        focusWhy.after(timestampP);
      } else {
        focusDiv.appendChild(timestampP);
      }
    }
  }

  // Insert before coaching section (Tier 2: action items grouped together)
  const coachingSection = $('coaching-section');
  coachingSection.parentNode?.insertBefore(focusDiv, coachingSection);
}

// ─── Coaching Cues ───

export function renderCoachingCues(analysis: SetAnalysis, fps: number = 0): void {
  const container = $('coaching-cues');
  container.innerHTML = '';

  if (analysis.topCues.length === 0) {
    container.innerHTML = '<div class="cue-card"><div class="cue-text">Great form! No major issues detected.</div></div>';
    return;
  }

  for (let cueIdx = 0; cueIdx < analysis.topCues.length; cueIdx++) {
    const cue = analysis.topCues[cueIdx];
    const card = document.createElement('div');
    card.className = 'cue-card';
    card.style.borderLeftColor = cue.priority <= 1 ? 'var(--danger)' : cue.priority <= 3 ? 'var(--orange)' : 'var(--accent)';

    const displayName = ISSUE_DISPLAY_NAMES[cue.issue] ?? formatIssueName(cue.issue);

    // Exercise progressions
    const progressions = getExerciseProgressions(cue.issue);
    let progressionHtml = '';
    if (progressions.length > 0) {
      progressionHtml = `
        <details class="progression-details">
          <summary>Progression Path</summary>
          <div class="progression-path">
            ${progressions.map((p, idx) => `
              <div class="progression-step">
                <div class="progression-step-num" style="background: ${idx === 0 ? 'var(--accent)' : idx === progressions.length - 1 ? 'var(--success)' : 'var(--warning)'};">${idx + 1}</div>
                <div>
                  <div class="progression-level">${escapeHtml(p.level)}</div>
                  <div class="progression-exercise">${escapeHtml(p.exercise)}</div>
                  <div class="progression-criteria">${escapeHtml(p.criteria)}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </details>
      `;
    }

    // Alternate cue variants (only for top 2 cues)
    let alternatesHtml = '';
    if (cueIdx < 2) {
      const dbEntry = CUE_DATABASE[cue.issue];
      if (dbEntry?.alternateCues && dbEntry.alternateCues.length > 0) {
        const altText = dbEntry.alternateCues.map((alt) => `"${escapeHtml(alt)}"`).join(' or ');
        alternatesHtml = `
          <div class="cue-alternates">
            Also try: ${altText}
          </div>
        `;
      }
    }

    const isBeginnerCues = analysis.config.experienceLevel === 'beginner';
    const severityText = isBeginnerCues ? beginnerSeverity(cue.priority) : (cue.priority <= 1 ? 'HIGH' : cue.priority <= 3 ? 'MED' : 'LOW');
    const severitySColor = cue.priority <= 1 ? 'var(--danger)' : cue.priority <= 3 ? 'var(--orange)' : 'var(--accent)';

    card.innerHTML = `
      <div class="cue-text">${escapeHtml(cue.cue)}</div>
      ${alternatesHtml}
      <div class="cue-explanation">${escapeHtml(cue.explanation)}</div>
      <div class="cue-issue">
        <span class="issue-indicator">
          <span class="issue-dot" style="background: ${severitySColor}" aria-hidden="true"></span>
          <span class="cue-priority" style="color: ${severitySColor};">${severityText}</span>
        </span>
        Issue: ${escapeHtml(displayName)}
      </div>
      ${progressionHtml}
    `;

    // Add clickable video timestamp link after the cue text
    const issueFrame = findIssueFrame(analysis, cue.issue);
    if (issueFrame !== null && fps > 0) {
      const cueTextEl = card.querySelector('.cue-text');
      if (cueTextEl) {
        cueTextEl.appendChild(createTimestampLink(issueFrame, fps));
      }
    }

    container.appendChild(card);
  }
}

// ─── Positive Feedback ───

/** Render "What You Did Well" section immediately after the overall score card. */
export function renderPositiveFeedback(analysis: SetAnalysis): void {
  // Find or create the positive feedback section
  let positiveSection = document.getElementById('positive-feedback-section');
  if (!positiveSection) {
    // Create it right after the overall score card (lead with encouragement)
    const overallScoreCard = $('overall-score-card');
    positiveSection = document.createElement('div');
    positiveSection.id = 'positive-feedback-section';
    positiveSection.className = 'card card--static positive-section';
    positiveSection.setAttribute('aria-label', 'What you did well');
    overallScoreCard.parentNode?.insertBefore(positiveSection, overallScoreCard.nextSibling);
  }

  const highlights = analysis.positiveHighlights;
  positiveSection.style.display = 'block';

  let html = '<h3 class="section-heading-sm">What You Did Well</h3>';

  if (highlights.length === 0) {
    html += `
      <div class="positive-item">
        <span class="positive-item-icon" aria-hidden="true">&#10003;</span>
        <span class="positive-item-text">You completed this set well across all dimensions. Keep it up!</span>
      </div>
    `;
  } else {
    for (const item of highlights) {
      html += `
        <div class="positive-item">
          <span class="positive-item-icon" aria-hidden="true">&#10003;</span>
          <span class="positive-item-text">${escapeHtml(item)}</span>
        </div>
      `;
    }
  }

  positiveSection.innerHTML = html;
}

// ─── Beginner Summary Section ───

/** Render a simplified summary card for beginners with positives and one focus item. */
export function renderBeginnerSummary(analysis: SetAnalysis): void {
  const existing = document.getElementById('beginner-summary-section');
  if (existing) existing.remove();

  if (analysis.config.experienceLevel !== 'beginner') return;

  const overallScoreCard = $('overall-score-card');
  const summaryDiv = document.createElement('div');
  summaryDiv.id = 'beginner-summary-section';
  summaryDiv.className = 'card card--static beginner-summary';
  summaryDiv.setAttribute('aria-label', 'Session summary for beginners');

  // Positives: top 2-3 highlights
  const highlights = analysis.positiveHighlights.slice(0, 3);
  let positivesHtml = '';
  if (highlights.length > 0) {
    positivesHtml = '<div class="beginner-positives-group"><h4 class="section-heading-sm">What you did well</h4>';
    for (const item of highlights) {
      positivesHtml += `<div class="positive-item"><span class="positive-item-icon" aria-hidden="true">&#10003;</span><span class="positive-item-text">${escapeHtml(item)}</span></div>`;
    }
    positivesHtml += '</div>';
  }

  // One thing to focus on
  let focusHtml = '';
  if (analysis.topCues.length > 0) {
    const topCue = analysis.topCues[0];
    focusHtml = `<div class="beginner-focus"><h4 class="section-heading-sm">One thing to focus on</h4><div class="focus-cue">${escapeHtml(topCue.cue)}</div></div>`;
  }

  summaryDiv.innerHTML = positivesHtml + focusHtml;

  // Insert right after the overall score card
  overallScoreCard.parentNode?.insertBefore(summaryDiv, overallScoreCard.nextSibling);
}
