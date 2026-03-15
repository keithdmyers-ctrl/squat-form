/**
 * Results display: overall score, score breakdown, coaching cues,
 * rep cards, milestones, mobility, warm-up, share buttons.
 */

import type {
  SetAnalysis,
  FrameData,
  RepScore,
  StickingPoint,
  BarPathData,
  VelocityMetrics,
  SessionRecord,
  WarmUpStep,
} from './types';
import type { OneRMEstimate } from './one-rm';
import { WEIGHTS, COMPETITION_WEIGHTS } from './scorer';
import { getCorrectiveExercises, getExerciseProgressions } from './cues';
import type { CorrectiveExercise } from './cues';
import {
  escapeHtml,
  $,
  scoreColor,
  severityColor,
  gradeColor,
  formatIssueName,
  formatShortIssueName,
  ISSUE_DISPLAY_NAMES,
} from './ui-utilities';
import { hideProgress, hideError, hideSkeletonLoading } from './ui-progress';
import { encodeAnalysisUrl, generateShareCard } from './share';
import type { TrainingPhase } from './programming';
import {
  getRecommendation,
  suggestNextPhase,
  PHASE_DESCRIPTIONS,
} from './programming';
import { exportAnalysisCSV, downloadCSV } from './csv-export';
import { CUE_DATABASE } from './issues';
import { loadGoals, saveGoals, checkGoals } from './goals';
import { WarmupTimer, getStepDuration } from './warmup-timer';
import type { TimerState } from './warmup-timer';
import { exportRepClip, downloadClip, shareClip } from './gif-export';
import type { ClipExportOptions } from './gif-export';
import { computeDOTS } from './one-rm';
import { generateAttemptPlan } from './competition';

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

/** Convert technical severity labels to beginner-friendly ones. */
function beginnerSeverity(priority: number): string {
  if (priority <= 1) return 'Fix First';
  if (priority <= 3) return 'Work On';
  return 'Minor';
}

// Module-level state for clip export (set by showResults)
let _clipExportFps = 0;
let _clipExportAnalysis: SetAnalysis | null = null;

// ─── Progress Insights (session-history-aware coaching) ───

export function generateProgressInsights(
  currentAnalysis: SetAnalysis,
  sessions: SessionRecord[],
): string[] {
  if (sessions.length === 0) return [];
  const insights: string[] = [];

  // Score trend
  const recentScores = sessions.slice(0, 5).map(s => s.overall_score);
  const avgRecent = recentScores.reduce((s, v) => s + v, 0) / recentScores.length;
  const diff = currentAnalysis.overallScore - avgRecent;
  if (diff > 10) {
    insights.push(`Your score is ${Math.round(diff)} points above your recent average — great session!`);
  } else if (diff < -10) {
    insights.push(`Score is ${Math.round(Math.abs(diff))} points below your recent average. Fatigue or new weight?`);
  }

  // Recurring issue detection
  const currentTopIssue = currentAnalysis.topIssues[0]?.name;
  if (currentTopIssue) {
    const issueCount = sessions.filter(s => s.top_issue === currentTopIssue).length;
    if (issueCount >= 3) {
      insights.push(`This is session ${issueCount + 1} where "${formatIssueName(currentTopIssue)}" is your top issue. The corrective exercises may take 2-4 weeks of consistent practice to show results.`);
    } else if (issueCount >= 1) {
      insights.push(`"${formatIssueName(currentTopIssue)}" showed up in your last ${issueCount} session${issueCount > 1 ? 's' : ''} too — keep working the corrective exercises.`);
    }
  }

  // Dimension improvement tracking
  if (sessions.length >= 2 && sessions[0].avg_depth !== undefined) {
    const prevSession = sessions[0];
    // Compare each dimension
    const dims = [
      { name: 'Depth', curr: currentAnalysis.reps.length > 0 ? currentAnalysis.reps.reduce((s, r) => s + r.depthScore, 0) / currentAnalysis.reps.length : 0, prev: prevSession.avg_depth },
      { name: 'Knee Tracking', curr: currentAnalysis.reps.length > 0 ? currentAnalysis.reps.reduce((s, r) => s + r.kneeTrackingScore, 0) / currentAnalysis.reps.length : 0, prev: prevSession.avg_knee_tracking },
    ];
    for (const d of dims) {
      if (d.prev !== undefined && d.curr - d.prev > 15) {
        insights.push(`${d.name} improved by ${Math.round(d.curr - d.prev)} points since last session!`);
      }
    }
  }

  // Issue resolved
  if (sessions.length >= 2) {
    const prevTopIssue = sessions[0].top_issue;
    if (prevTopIssue && !currentAnalysis.topIssues.some(i => i.name === prevTopIssue)) {
      insights.push(`"${formatIssueName(prevTopIssue)}" from your last session is no longer a top concern — good work!`);
    }
  }

  return insights;
}

function renderProgressInsights(analysis: SetAnalysis, sessions: SessionRecord[]): void {
  // Remove existing progress insights if present
  const existing = document.getElementById('progress-insights');
  if (existing) existing.remove();

  const insights = generateProgressInsights(analysis, sessions);
  if (insights.length === 0) return;

  const insightsDiv = document.createElement('div');
  insightsDiv.id = 'progress-insights';
  insightsDiv.className = 'card progress-insights-card';

  const heading = document.createElement('h4');
  heading.className = 'section-heading-sm';
  heading.textContent = 'Progress Notes';
  insightsDiv.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'progress-insights-list';
  for (const insight of insights) {
    const li = document.createElement('li');
    li.textContent = insight;
    list.appendChild(li);
  }
  insightsDiv.appendChild(list);

  // Insert after coaching section, before the tier separator
  const coachingSection = document.getElementById('coaching-section');
  if (coachingSection?.parentNode) {
    coachingSection.parentNode.insertBefore(insightsDiv, coachingSection.nextSibling);
  }
}

// ─── Training Recommendations ───

function renderTrainingRecommendations(
  phase?: TrainingPhase,
  oneRMEstimate?: OneRMEstimate | null,
  sessions?: SessionRecord[],
  exerciseType?: string,
): void {
  const existing = document.getElementById('training-recommendations');
  if (existing) existing.remove();

  const activePhase = phase ?? 'hypertrophy';
  const rec = getRecommendation(activePhase, oneRMEstimate?.average, exerciseType, oneRMEstimate?.unit);

  const recDiv = document.createElement('div');
  recDiv.id = 'training-recommendations';
  recDiv.className = 'card training-rec-card';
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
  desc.style.cssText = 'font-size: 0.85rem; color: var(--text-secondary); margin: 0.25rem 0 0.75rem;';
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
    weightInfo.innerHTML = `<span style="color: var(--text-muted);">Target weight:</span> <span style="color: var(--accent); font-weight: 700;">${rec.weightRange[0]}-${rec.weightRange[1]} ${escapeHtml(rec.weightUnit ?? 'lbs')}</span>`;
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
    suggestionDiv.innerHTML = `<div class="training-rec-suggestion-label">Suggested Next Phase</div><div style="color: var(--text-primary); font-weight: 600;">${escapeHtml(nextPhaseLabel)}</div><div style="color: var(--text-secondary); margin-top: 0.2rem;">${escapeHtml(suggestion.reason)}</div>`;
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

// ─── Score count-up animation ───

export function animateScoreCountUp(
  element: HTMLElement,
  targetScore: number,
  durationMs: number = 1000,
): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    element.textContent = String(Math.round(targetScore));
    return;
  }

  const startTime = performance.now();
  const startValue = 0;

  function step(currentTime: number): void {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / durationMs, 1);

    // Ease-out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const currentValue = Math.round(startValue + (targetScore - startValue) * eased);

    element.textContent = `${currentValue}`;

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

// ─── Collapsible Section Helper ───

/** Wrap an existing DOM element in a collapsible details/summary, collapsed by default. */
export function wrapInCollapsible(wrapperId: string, title: string, targetId: string): void {
  const target = document.getElementById(targetId);
  if (!target) return;

  // Don't double-wrap
  const existing = document.getElementById(wrapperId);
  if (existing) existing.remove();

  const wrapper = document.createElement('div');
  wrapper.id = wrapperId;
  wrapper.className = 'card collapsible-section';

  const details = document.createElement('details');
  details.setAttribute('aria-label', title);

  const summary = document.createElement('summary');
  summary.className = 'collapsible-summary';
  summary.innerHTML = `<span class="collapse-chevron">&#9654;</span> ${escapeHtml(title)}`;

  // Toggle chevron rotation on open/close
  details.addEventListener('toggle', () => {
    const chevron = summary.querySelector('.collapse-chevron') as HTMLElement | null;
    if (chevron) {
      chevron.style.transform = details.open ? 'rotate(90deg)' : 'rotate(0deg)';
    }
  });

  const content = document.createElement('div');
  content.style.marginTop = '0.75rem';

  // Move the target element into the collapsible content
  target.parentNode?.insertBefore(wrapper, target);
  content.appendChild(target);
  details.appendChild(summary);
  details.appendChild(content);
  wrapper.appendChild(details);
}

// ─── Results Display ───

export function showResults(analysis: SetAnalysis, frameData: FrameData, sessions: SessionRecord[] = [], oneRMEstimate?: OneRMEstimate | null, fps: number = 0, trainingPhase?: TrainingPhase, exerciseType?: string): void {
  hideProgress();
  hideError();
  hideSkeletonLoading();

  // Store for clip export handlers
  _clipExportFps = fps;
  _clipExportAnalysis = analysis;

  const section = $('results-section');
  section.style.display = 'block';

  // Add results-section class for staggered animations
  const scoresPanel = section.querySelector('.scores-panel');
  if (scoresPanel) scoresPanel.classList.add('results-section');

  // Make results focusable and move focus for accessibility
  section.setAttribute('tabindex', '-1');

  // Scroll to results
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Apply competition mode class to results section only (not global accent)
  if (analysis.competitionMode) {
    section.classList.add('competition-mode');
  } else {
    section.classList.remove('competition-mode');
  }

  const isBeginner = analysis.config.experienceLevel === 'beginner';

  // --- Tier 1: Primary (always visible, prominent) ---
  renderOverallScore(analysis);
  renderCompetitionBadge(analysis);
  renderTierMessage(analysis);
  if (!isBeginner) renderScoreLegend(analysis);
  renderFatigueWarning(analysis); // Safety-critical: show right after score
  renderGamification(analysis.overallScore, sessions);
  renderMilestones(analysis.overallScore, sessions);
  renderPositiveFeedback(analysis);
  if (isBeginner) renderBeginnerSummary(analysis);

  // --- Tier 2: Action Items (what to do next) ---
  renderFocusSection(analysis, fps);
  if (!isBeginner) renderCoachingCues(analysis, fps);
  renderProgressInsights(analysis, sessions);
  if (!isBeginner) {
    renderTrainingRecommendations(trainingPhase, oneRMEstimate, sessions, exerciseType);
  }

  // --- Tier 3: Details (collapsed for beginners, expanded for advanced) ---
  const isAdvanced = analysis.config.experienceLevel === 'advanced';
  if (!isBeginner) {
    renderScoreBreakdown(analysis);
    if (!isAdvanced) {
      wrapInCollapsible('breakdown-collapse', 'Score Breakdown', 'score-breakdown');
    }
  }
  if (oneRMEstimate) {
    renderOneRMEstimate(oneRMEstimate);
    if (isBeginner) wrapInCollapsible('onerm-collapse', 'Max Lift Estimate', 'one-rm-section');
  }
  if (!isBeginner) {
    renderRepCards(analysis);
    if (!isAdvanced) {
      wrapInCollapsible('rep-detail-collapse', 'Per-Rep Detail', 'rep-cards-section');
    }
  }
  if (!isBeginner) {
    renderVelocityChart(analysis);
  }
  renderMobilityAssessment(analysis);
  wrapInCollapsible('mobility-collapse', isBeginner ? 'Stretches & Flexibility Check' : 'Mobility Assessment', 'mobility-section');
  renderWarmUpProtocol(analysis);

  // Show full report toggle for beginners
  if (isBeginner) {
    renderBeginnerFullReportToggle(analysis, fps, sessions);
  }

  // --- Tier 4: Actions ---
  renderShareButtons(analysis);
  renderPostResultsCTA();
  renderAboutAnalysisLink();

  // Move focus to results after rendering for screen reader users
  setTimeout(() => {
    section.focus({ preventScroll: false });
  }, 100);

  // Announce key result for screen readers
  const liveRegion = document.getElementById('sr-live-region') || (() => {
    const el = document.createElement('div');
    el.id = 'sr-live-region';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'assertive');
    el.className = 'sr-only';
    document.body.appendChild(el);
    return el;
  })();
  liveRegion.textContent = `Analysis complete. Grade: ${escapeHtml(analysis.grade)}. Score: ${analysis.overallScore} out of 100. ${analysis.repCount} reps analyzed.`;

  // --- Goal checking ---
  checkAndCelebrateGoals(analysis, sessions);
}

// ─── Goal Celebration ───

/**
 * Check active goals against the most recently saved session.
 * If any goals are newly achieved, show a celebration banner with confetti.
 */
function checkAndCelebrateGoals(analysis: SetAnalysis, sessions: SessionRecord[]): void {
  const goals = loadGoals();
  if (goals.length === 0) return;

  // Build a synthetic session record from the current analysis for checking
  // Use the most recently saved session from localStorage (which was saved before showResults)
  const allSessions = (() => {
    try {
      return JSON.parse(localStorage.getItem('squat_form_sessions') || '[]') as SessionRecord[];
    } catch { return []; }
  })();

  if (allSessions.length === 0) return;
  const latestSession = allSessions[0]; // most recent is first

  const { updatedGoals, celebrations } = checkGoals(goals, latestSession);
  saveGoals(updatedGoals);

  if (celebrations.length > 0) {
    showGoalCelebration(celebrations);
  }
}

/** Show a celebration banner with confetti animation for achieved goals. */
function showGoalCelebration(celebrations: string[]): void {
  // Remove any existing celebration
  document.getElementById('goal-celebration-overlay')?.remove();
  document.getElementById('goal-celebration-confetti')?.remove();

  // Confetti container
  const confettiDiv = document.createElement('div');
  confettiDiv.id = 'goal-celebration-confetti';
  confettiDiv.className = 'goal-celebration-confetti';
  for (let i = 0; i < 12; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    confettiDiv.appendChild(piece);
  }
  document.body.appendChild(confettiDiv);

  // Banner
  const celebration = document.createElement('div');
  celebration.id = 'goal-celebration-overlay';
  celebration.className = 'goal-celebration';

  for (const msg of celebrations) {
    const banner = document.createElement('div');
    banner.className = 'goal-celebration-banner';
    banner.textContent = msg;
    celebration.appendChild(banner);
  }

  document.body.appendChild(celebration);

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    celebration.style.transition = 'opacity 0.5s ease';
    celebration.style.opacity = '0';
    setTimeout(() => {
      celebration.remove();
      confettiDiv.remove();
    }, 500);
  }, 5000);
}

/** Render post-results call-to-action buttons. */
export function renderPostResultsCTA(): void {
  // Remove existing CTA if present
  const existing = document.getElementById('post-results-cta');
  if (existing) existing.remove();

  const section = $('results-section');
  const ctaDiv = document.createElement('div');
  ctaDiv.id = 'post-results-cta';
  ctaDiv.className = 'post-results-cta';

  const analyzeBtn = document.createElement('button');
  analyzeBtn.className = 'btn btn-primary';
  analyzeBtn.textContent = 'Analyze Another Set';
  analyzeBtn.setAttribute('aria-label', 'Analyze another squat video');
  analyzeBtn.addEventListener('click', () => {
    const videoInput = document.getElementById('video-input') as HTMLInputElement | null;
    if (videoInput) videoInput.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const liveBtn = document.createElement('button');
  liveBtn.className = 'btn btn-secondary';
  liveBtn.textContent = 'Try Live Mode';
  liveBtn.setAttribute('aria-label', 'Switch to live mode');
  liveBtn.addEventListener('click', () => {
    const modeLiveBtn = document.getElementById('mode-live') as HTMLButtonElement | null;
    if (modeLiveBtn) modeLiveBtn.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  ctaDiv.appendChild(analyzeBtn);
  ctaDiv.appendChild(liveBtn);
  section.appendChild(ctaDiv);
}

/** Render "About this analysis" link at the bottom of results that opens the transparency section. */
function renderAboutAnalysisLink(): void {
  const scoresPanel = document.querySelector('.scores-panel');
  if (!scoresPanel) return;

  // Remove existing link if present
  const existing = document.getElementById('about-analysis-link');
  if (existing) existing.remove();

  const link = document.createElement('button');
  link.id = 'about-analysis-link';
  link.className = 'about-analysis-link';
  link.type = 'button';
  link.innerHTML = '\u2139\uFE0F About this analysis';
  link.setAttribute('aria-label', 'Learn what this analysis can and cannot detect');
  link.addEventListener('click', () => {
    const details = document.getElementById('transparency-section') as HTMLDetailsElement | null;
    if (details) {
      details.open = true;
      details.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  scoresPanel.appendChild(link);
}

export function renderOverallScore(analysis: SetAnalysis): void {
  const circle = $('score-circle');
  const color = gradeColor(analysis.grade);
  circle.style.borderColor = color;

  // Add accessibility label
  circle.setAttribute('aria-label', `Overall score: ${analysis.overallScore}, Grade: ${analysis.grade}`);

  const gradeEl = $('overall-grade');
  gradeEl.textContent = analysis.grade;
  gradeEl.style.color = color;

  const scoreEl = $('overall-score-value');
  scoreEl.style.color = color;

  // Animate score count-up from 0 to final score
  animateScoreCountUp(scoreEl, analysis.overallScore, 1000);

  // Overall set confidence indicator
  renderSetConfidence(analysis);
}

/** Render an overall set-level confidence indicator near the main score display. */
function renderSetConfidence(analysis: SetAnalysis): void {
  const container = $('overall-score-card');

  // Remove existing confidence indicator
  const existing = container.querySelector('.set-confidence');
  if (existing) existing.remove();

  // Compute average confidence across all reps that have it
  const repsWithConf = analysis.reps.filter(r => r.avgConfidence !== undefined && r.avgConfidence !== null);
  if (repsWithConf.length === 0) return;

  const avgConf = repsWithConf.reduce((sum, r) => sum + (r.avgConfidence ?? 0), 0) / repsWithConf.length;
  const tier = confidenceTier(avgConf);

  const el = document.createElement('div');
  el.className = 'set-confidence';
  el.setAttribute('aria-label', `Pose detection confidence: ${tier.label} (${Math.round(avgConf * 100)}%)`);
  el.innerHTML = `<span class="set-confidence-dot" style="color: ${tier.color};" aria-hidden="true">&#9679;</span> <span class="set-confidence-label" style="color: ${tier.color};">${tier.label} confidence</span> <span class="set-confidence-pct">(${Math.round(avgConf * 100)}%)</span>`;

  container.appendChild(el);
}

export function renderScoreBreakdown(analysis: SetAnalysis): void {
  const container = $('score-breakdown');

  // Calculate average dimension scores across all reps
  // In competition mode, skip tempo display
  type ScoreKey = 'depthScore' | 'kneeTrackingScore' | 'trunkScore' | 'symmetryScore' | 'tempoScore' | 'lockoutScore';
  const dims: { label: string; key: ScoreKey }[] = [
    { label: 'Depth', key: 'depthScore' },
    { label: 'Knee Tracking', key: 'kneeTrackingScore' },
    { label: 'Torso Position', key: 'trunkScore' },
    { label: 'Balance', key: 'symmetryScore' },
    ...(analysis.competitionMode ? [] : [{ label: 'Control', key: 'tempoScore' as ScoreKey }]),
    { label: 'Lockout', key: 'lockoutScore' },
  ];

  const avgScores = dims.map((d) => {
    if (analysis.reps.length === 0) return { ...d, score: 0 };
    const avg =
      analysis.reps.reduce((s, r) => s + (r[d.key] as number), 0) / analysis.reps.length;
    return { ...d, score: Math.round(avg) };
  });

  // Keep the title
  let html = '<h3>Score Breakdown</h3>';

  // Camera confidence notes per dimension based on detected view
  const cameraView = analysis.detectedCameraView;
  const confidenceNotes: Record<string, string> = {};

  if (cameraView === 'side') {
    confidenceNotes['Knee Tracking'] = 'Filmed from the side — knee inward/outward tracking is less precise from this angle';
    confidenceNotes['Balance'] = 'Filmed from the side — left/right balance is harder to measure from this angle';
  } else if (cameraView === 'front') {
    confidenceNotes['Torso Position'] = 'Filmed from the front — forward lean measurement is less precise from this angle';
  } else {
    // unknown view
    confidenceNotes['Knee Tracking'] = 'Camera angle unclear — knee tracking may be less precise';
  }

  const isBegExp = analysis.config.experienceLevel === 'beginner';

  for (const { label, score } of avgScores) {
    const color = scoreColor(score);
    const level = score >= 90 ? 'Excellent' : score >= 80 ? 'Good' : score >= 70 ? 'Fair' : score >= 60 ? 'Needs Work' : 'Focus Here';
    const noteText = confidenceNotes[label] ?? '';
    const noteHtml = noteText
      ? `<div class="confidence-note" style="font-size: 0.7rem; color: var(--text-muted); font-style: italic; margin-top: 0.15rem;">${escapeHtml(noteText)}</div>`
      : '';
    const displayLabel = isBegExp ? (BEGINNER_DIMENSION_LABELS[label] ?? label) : label;
    html += `
      <div class="score-bar-row">
        <span class="score-bar-label">${escapeHtml(displayLabel)}</span>
        <div class="score-bar-track" role="progressbar" aria-valuenow="${score}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(label)} score: ${score} out of 100, ${level}${noteText ? '. ' + noteText : ''}">
          <div class="score-bar-fill" style="width: ${score}%; background: ${color}"></div>
        </div>
        <span class="score-bar-value" style="color: ${color}">${score}</span>
        <span class="score-bar-level" style="color: ${color}; font-size: 0.7rem; min-width: 5.5em; text-align: left;">${level}</span>
      </div>
      ${noteHtml}
    `;
  }

  // Overall camera confidence note
  let overallConfidenceNote = '';
  if (cameraView === 'side') {
    overallConfidenceNote = 'Filmed from the side — depth and trunk scores are most reliable. Film from the front for better knee tracking and symmetry data.';
  } else if (cameraView === 'front') {
    overallConfidenceNote = 'Filmed from the front — knee tracking and symmetry scores are most reliable. Film from the side for better depth and trunk data.';
  } else {
    overallConfidenceNote = 'Camera angle was unclear — scores may be less precise. Try positioning your camera directly to your side or front.';
  }

  html += `
    <div class="camera-confidence-note">
      <span class="camera-confidence-text">${escapeHtml(overallConfidenceNote)}</span>
    </div>
  `;

  container.innerHTML = html;
}

// ─── 1RM Estimation Card ───

export function renderOneRMEstimate(estimate: OneRMEstimate): void {
  const scoresPanel = document.querySelector('.scores-panel');
  if (!scoresPanel) return;

  // Remove existing
  const existing = document.getElementById('one-rm-section');
  if (existing) existing.remove();

  const section = document.createElement('div');
  section.id = 'one-rm-section';
  section.className = 'card';
  section.setAttribute('aria-label', `Estimated one rep max: ${estimate.average} ${escapeHtml(estimate.unit)}`);

  const tableRows = estimate.percentageTable
    .filter(row => row.percent <= 95 && row.percent >= 60)
    .map(row => `
      <div style="display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.85rem;">
        <span style="color: var(--text-muted);">${row.percent}%</span>
        <span style="color: var(--text-primary); font-weight: 600;">${row.weight} ${escapeHtml(estimate.unit)}</span>
      </div>
    `).join('');

  // DOTS score: read bodyweight and sex from DOM
  let dotsHtml = '';
  const bwInput = document.getElementById('bodyweight-input') as HTMLInputElement | null;
  const bwUnitSelect = document.getElementById('bodyweight-unit') as HTMLSelectElement | null;
  const rawBw = bwInput ? parseFloat(bwInput.value) : 0;
  const bwUnit = bwUnitSelect?.value ?? 'kg';
  if (rawBw > 0 && estimate.average > 0) {
    const isMaleBtn = document.querySelector('.sex-toggle-btn.active') as HTMLElement | null;
    const isMale = isMaleBtn?.dataset.sex !== 'female';
    // Convert to kg if needed for DOTS computation
    const bwKg = bwUnit === 'lbs' ? rawBw * 0.453592 : rawBw;
    const totalKg = estimate.unit === 'lbs' ? estimate.average * 0.453592 : estimate.average;
    const dotsResult = computeDOTS(totalKg, bwKg, isMale);
    if (dotsResult) {
      const level = dotsResult.score >= 500 ? 'Elite' : dotsResult.score >= 400 ? 'Advanced' : dotsResult.score >= 300 ? 'Intermediate' : 'Novice';
      const levelColor = dotsResult.score >= 500 ? 'var(--danger)' : dotsResult.score >= 400 ? 'var(--warning)' : dotsResult.score >= 300 ? 'var(--accent)' : 'var(--text-muted)';
      dotsHtml = `
        <div style="background: var(--bg-input); border-radius: var(--radius-sm); padding: 0.75rem; margin-top: 0.75rem;">
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.25rem; font-weight: 600;">DOTS Score</div>
          <div style="display: flex; align-items: baseline; gap: 0.5rem;">
            <span style="font-size: 1.5rem; font-weight: 800; color: var(--accent);">${dotsResult.score.toFixed(1)}</span>
            <span style="font-size: 0.85rem; font-weight: 600; color: ${levelColor};">${level}</span>
          </div>
          <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.15rem;">Relative strength at ${rawBw} ${escapeHtml(bwUnit)} (${isMale ? 'male' : 'female'})</div>
        </div>
      `;
    }
  }

  // Competition attempt plan
  let attemptHtml = '';
  const compModeCheckbox = document.getElementById('competition-mode') as HTMLInputElement | null;
  if (compModeCheckbox?.checked && estimate.average > 0) {
    const plan = generateAttemptPlan(estimate.average, estimate.unit);
    attemptHtml = `
      <div style="background: var(--bg-input); border-radius: var(--radius-sm); padding: 0.75rem; margin-top: 0.75rem;">
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem; font-weight: 600;">Meet Attempt Plan</div>
        <div style="display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.85rem;">
          <span style="color: var(--text-secondary);">Opener (~88%)</span>
          <span style="color: var(--success); font-weight: 700;">${plan.opener} ${escapeHtml(estimate.unit)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.85rem;">
          <span style="color: var(--text-secondary);">2nd Attempt (~94%)</span>
          <span style="color: var(--warning); font-weight: 700;">${plan.second} ${escapeHtml(estimate.unit)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.85rem;">
          <span style="color: var(--text-secondary);">3rd Attempt (~100%)</span>
          <span style="color: var(--danger); font-weight: 700;">${plan.third} ${escapeHtml(estimate.unit)}</span>
        </div>
      </div>
    `;
  }

  section.innerHTML = `
    <details>
      <summary style="cursor: pointer; font-size: 0.9rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; list-style: none; display: flex; align-items: center; gap: 0.35rem; user-select: none;">
        <span style="font-size: 0.6rem; transition: transform 0.2s; display: inline-block;" class="collapse-chevron">&#9654;</span>
        Estimated 1RM
      </summary>
      <div style="margin-top: 0.75rem;">
        <div style="text-align: center; margin-bottom: 1rem;">
          <div style="font-size: 2rem; font-weight: 800; color: var(--accent);">${estimate.average} ${escapeHtml(estimate.unit)}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">Based on ${estimate.reps} reps at ${estimate.weight} ${escapeHtml(estimate.unit)}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">Epley: ${estimate.epley} | Brzycki: ${estimate.brzycki}</div>
        </div>
        ${dotsHtml}
        ${attemptHtml}
        <div style="background: var(--bg-input); border-radius: var(--radius-sm); padding: 0.75rem; margin-top: 0.75rem;">
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem; font-weight: 600;">Training Percentages</div>
          ${tableRows}
        </div>
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

// ─── Score Legend (collapsible) ───

export function renderScoreLegend(analysis: SetAnalysis): void {
  const container = $('overall-score-card');

  // Remove existing legend
  const existing = container.querySelector('.score-legend');
  if (existing) existing.remove();

  const w = analysis.competitionMode ? COMPETITION_WEIGHTS : WEIGHTS;

  const details = document.createElement('details');
  details.className = 'score-legend';
  details.setAttribute('aria-label', 'Score explanation');

  const tempoNote = analysis.competitionMode
    ? '<div class="legend-row"><strong>Control (0%)</strong> -- Not scored in competition mode.</div>'
    : `<div class="legend-row"><strong>Control (${Math.round(w.tempo * 100)}%)</strong> -- Smooth, controlled movement speed.</div>`;

  details.innerHTML = `
    <summary>What do these scores mean?</summary>
    <div class="legend-content">
      <div class="legend-row"><strong>Depth (${Math.round(w.depth * 100)}%)</strong> -- How deep you squat.${analysis.competitionMode ? ' Must break parallel for a good lift.' : ' Deeper = more muscle activation.'}</div>
      <div class="legend-row"><strong>Knee Tracking (${Math.round(w.kneeTracking * 100)}%)</strong> -- Whether your knees stay over your toes. Most important for injury prevention.</div>
      <div class="legend-row"><strong>Torso Position (${Math.round(w.trunk * 100)}%)</strong> -- Your upper body angle. Varies by squat style and body type.</div>
      <div class="legend-row"><strong>Balance (${Math.round(w.symmetry * 100)}%)</strong> -- Even weight on both legs.</div>
      ${tempoNote}
      <div class="legend-row"><strong>Lockout (${Math.round(w.lockout * 100)}%)</strong> -- Fully standing up between reps.${analysis.competitionMode ? ' Stricter in competition mode.' : ''}</div>
      <p class="legend-note">${analysis.competitionMode ? 'Competition mode: IPF/USAPL standards applied.' : 'Scores are personalized to your body proportions and experience level.'}</p>
    </div>
  `;

  container.appendChild(details);
}

// ─── Focus Section ("What to Work on Next") ───

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
            <div class="exercise-card" style="display: flex; gap: 0.5rem; align-items: flex-start;">
              ${ex.svg ? `<div style="flex-shrink: 0;">${ex.svg}</div>` : ''}
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
      timestampP.style.cssText = 'font-size: 0.85rem; color: var(--text-muted); margin-top: 0.5rem;';
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

// ─── Milestone Detection ───

export function checkMilestones(currentScore: number, sessions: SessionRecord[]): string[] {
  const milestones: string[] = [];

  if (sessions.length === 0) {
    milestones.push('First session complete! Your form journey starts here.');
    if (currentScore < 75) {
      milestones.push('Most people score 50-70 on their first try -- you\'re right on track.');
    }
  }

  if (sessions.length > 0) {
    const lastScore = sessions[0].overall_score; // most recent previous
    const diff = currentScore - lastScore;
    if (diff >= 15) {
      milestones.push('Major improvement! Keep it up!');
    } else if (diff >= 5) {
      milestones.push(`Up ${diff.toFixed(0)} points from your last session!`);
    }
  }

  if (sessions.length >= 2) {
    const recentScores = sessions.slice(0, 3).map(s => s.overall_score);
    const allImproving = recentScores.every((s, i) => i === 0 || s <= recentScores[i - 1]);
    if (allImproving) {
      milestones.push(`${sessions.length + 1} sessions and counting -- consistency is key!`);
    }
  }

  if (currentScore >= 90 && (!sessions.length || sessions.every(s => s.overall_score < 90))) {
    milestones.push('First A grade! Excellent work!');
  }

  if (currentScore >= 80 && currentScore < 90 && (!sessions.length || sessions.every(s => s.overall_score < 80))) {
    milestones.push('First B grade! Your form is looking solid!');
  }

  return milestones;
}

export function renderMilestones(currentScore: number, sessions: SessionRecord[]): void {
  // Remove existing milestone banner
  const existing = document.getElementById('milestone-banner');
  if (existing) existing.remove();

  const milestones = checkMilestones(currentScore, sessions);
  if (milestones.length === 0) return;

  const banner = document.createElement('div');
  banner.id = 'milestone-banner';
  banner.className = 'milestone-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-label', 'Milestones achieved');

  banner.innerHTML = milestones.map(m => `<div class="milestone-item">${escapeHtml(m)}</div>`).join('');

  // Insert after overall score card
  const overallCard = $('overall-score-card');
  overallCard.parentNode?.insertBefore(banner, overallCard.nextSibling);
}

/** Render tier-based message after score display. */
export function renderTierMessage(analysis: SetAnalysis): void {
  const container = $('overall-score-card');

  // Remove any existing tier message
  const existing = container.querySelector('.tier-message');
  if (existing) existing.remove();

  const msgEl = document.createElement('div');
  msgEl.className = 'tier-message';
  msgEl.setAttribute('role', 'status');

  const score = analysis.overallScore;
  const topCue = analysis.topCues.length > 0 ? analysis.topCues[0].cue : '';

  // Gather specific positives
  const positives = analysis.positiveHighlights;
  const specificPraise = positives.length > 0 ? positives[0] : 'Your effort is paying off';

  if (score >= 90) {
    msgEl.innerHTML = `<span class="tier-msg tier-excellent">Excellent form! ${escapeHtml(specificPraise)}.</span>`;
    msgEl.style.color = 'var(--success)';
  } else if (score >= 70) {
    const focusTip = topCue ? ` Here is one thing to focus on: ${escapeHtml(topCue)}` : '';
    msgEl.innerHTML = `<span class="tier-msg tier-solid">Solid set! ${escapeHtml(specificPraise)}.${focusTip}</span>`;
    msgEl.style.color = 'var(--warning)';
  } else {
    const focusTip = topCue ? ` Focus on: ${escapeHtml(topCue)}` : '';
    msgEl.innerHTML = `<span class="tier-msg tier-working">Great that you are working on your form!${focusTip}</span>`;
    msgEl.style.color = 'var(--orange)';
  }

  // Styling handled by .tier-message CSS class

  container.appendChild(msgEl);
}

/** Render "What You Did Well" section immediately after the overall score card. */
export function renderPositiveFeedback(analysis: SetAnalysis): void {
  // Find or create the positive feedback section
  let positiveSection = document.getElementById('positive-feedback-section');
  if (!positiveSection) {
    // Create it right after the overall score card (lead with encouragement)
    const overallScoreCard = $('overall-score-card');
    positiveSection = document.createElement('div');
    positiveSection.id = 'positive-feedback-section';
    positiveSection.className = 'card positive-section';
    positiveSection.setAttribute('aria-label', 'What you did well');
    overallScoreCard.parentNode?.insertBefore(positiveSection, overallScoreCard.nextSibling);
  }

  const highlights = analysis.positiveHighlights;
  positiveSection.style.display = 'block';

  let html = '<h3 class="section-heading-sm" style="margin-bottom: 0.75rem;">What You Did Well</h3>';

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
  summaryDiv.className = 'card beginner-summary';
  summaryDiv.setAttribute('aria-label', 'Session summary for beginners');

  // Positives: top 2-3 highlights
  const highlights = analysis.positiveHighlights.slice(0, 3);
  let positivesHtml = '';
  if (highlights.length > 0) {
    positivesHtml = '<div style="margin-bottom: 0.75rem;"><h4 class="section-heading-sm" style="margin-bottom: 0.5rem;">What you did well</h4>';
    for (const item of highlights) {
      positivesHtml += `<div class="positive-item"><span class="positive-item-icon" aria-hidden="true">&#10003;</span><span class="positive-item-text">${escapeHtml(item)}</span></div>`;
    }
    positivesHtml += '</div>';
  }

  // One thing to focus on
  let focusHtml = '';
  if (analysis.topCues.length > 0) {
    const topCue = analysis.topCues[0];
    focusHtml = `<div class="beginner-focus"><h4 class="section-heading-sm" style="margin-bottom: 0.5rem;">One thing to focus on</h4><div class="focus-cue">${escapeHtml(topCue.cue)}</div></div>`;
  }

  summaryDiv.innerHTML = positivesHtml + focusHtml;

  // Insert right after the overall score card
  overallScoreCard.parentNode?.insertBefore(summaryDiv, overallScoreCard.nextSibling);
}

// ─── Confidence Badge Helpers ───

/** Return confidence tier info (label, CSS color variable) from a 0-1 confidence value. */
function confidenceTier(confidence: number): { label: string; color: string; className: string } {
  if (confidence >= 0.7) {
    return { label: 'High', color: 'var(--success, #4ade80)', className: 'confidence-high' };
  } else if (confidence >= 0.4) {
    return { label: 'Medium', color: 'var(--warning, #fbbf24)', className: 'confidence-medium' };
  } else {
    return { label: 'Low', color: 'var(--danger, #f87171)', className: 'confidence-low' };
  }
}

/** Generate HTML for a small confidence badge/pill. */
function renderConfidenceBadge(confidence: number | undefined): string {
  if (confidence === undefined || confidence === null) return '';
  const tier = confidenceTier(confidence);
  return `<span class="confidence-badge ${tier.className}" style="color: ${tier.color};" title="Pose detection confidence: ${Math.round(confidence * 100)}%"><span class="confidence-dot" aria-hidden="true">&#9679;</span> ${tier.label}</span>`;
}

// ─── Per-Rep Narrative ───

/** Dimension labels for per-rep best dimension display. */
const DIMENSION_LABELS: { key: keyof RepScore; label: string }[] = [
  { key: 'depthScore', label: 'Depth' },
  { key: 'kneeTrackingScore', label: 'Knee Tracking' },
  { key: 'trunkScore', label: 'Torso' },
  { key: 'symmetryScore', label: 'Balance' },
  { key: 'tempoScore', label: 'Control' },
  { key: 'lockoutScore', label: 'Lockout' },
];

/** Generate short narrative statements summarizing per-rep performance. */
export function generateRepNarrative(reps: RepScore[]): string[] {
  if (reps.length === 0) return [];
  const narratives: string[] = [];

  // Find best rep
  const bestIdx = reps.reduce((best, r, i) => r.overallScore > reps[best].overallScore ? i : best, 0);
  narratives.push(`Rep ${bestIdx + 1} was your best (${reps[bestIdx].overallScore} points) \u2014 try to match that feel.`);

  // Per-rep issues (only mention reps with HIGH severity issues)
  for (let i = 0; i < reps.length; i++) {
    const highIssues = reps[i].issues.filter(iss => iss.severity === 'high');
    if (highIssues.length > 0) {
      const issueNames = highIssues.map(iss => formatIssueName(iss.name)).join(', ');
      narratives.push(`Rep ${i + 1}: ${issueNames} detected.`);
    }
  }

  // Improvement within set (compare first half to second half)
  if (reps.length >= 4) {
    const firstHalf = reps.slice(0, Math.floor(reps.length / 2));
    const secondHalf = reps.slice(Math.floor(reps.length / 2));
    const avgFirst = firstHalf.reduce((s, r) => s + r.overallScore, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, r) => s + r.overallScore, 0) / secondHalf.length;
    const diff = avgSecond - avgFirst;
    if (diff > 5) {
      narratives.push('Your form improved as the set went on \u2014 nice warm-up effect.');
    } else if (diff < -10) {
      narratives.push('Form dropped in the second half \u2014 consider shorter sets or lighter weight.');
    }
  }

  // Consistency
  if (reps.length >= 3) {
    const scores = reps.map(r => r.overallScore);
    const range = Math.max(...scores) - Math.min(...scores);
    if (range <= 5) {
      narratives.push('Very consistent form across all reps \u2014 great control.');
    }
  }

  return narratives;
}

/** Get the best scoring dimension for a single rep. */
function getBestDimension(rep: RepScore): { label: string; score: number } {
  let best = { label: 'Depth', score: 0 };
  for (const dim of DIMENSION_LABELS) {
    const score = rep[dim.key] as number;
    if (score > best.score) {
      best = { label: dim.label, score };
    }
  }
  return best;
}

/** Render the rep-by-rep narrative section inside the rep cards area. */
function renderRepNarrative(reps: RepScore[]): void {
  const section = document.getElementById('rep-cards-section');
  if (!section) return;

  // Remove existing narrative if present
  const existing = document.getElementById('rep-narrative');
  if (existing) existing.remove();

  const narratives = generateRepNarrative(reps);
  if (narratives.length === 0) return;

  const narrativeDiv = document.createElement('div');
  narrativeDiv.id = 'rep-narrative';
  narrativeDiv.className = 'rep-narrative-card';
  narrativeDiv.setAttribute('aria-label', 'Rep-by-rep feedback');

  const title = document.createElement('h4');
  title.className = 'rep-narrative-heading';
  title.textContent = 'Rep-by-Rep';
  narrativeDiv.appendChild(title);

  const ul = document.createElement('ul');
  ul.className = 'rep-narrative-list';
  for (const text of narratives) {
    const li = document.createElement('li');
    li.textContent = text;
    ul.appendChild(li);
  }
  narrativeDiv.appendChild(ul);

  // Insert before the grid
  const grid = document.getElementById('rep-cards-grid');
  if (grid) {
    section.insertBefore(narrativeDiv, grid);
  } else {
    section.appendChild(narrativeDiv);
  }
}

function renderRepCards(analysis: SetAnalysis): void {
  const grid = $('rep-cards-grid');
  grid.innerHTML = '';

  // Render narrative summary above rep cards
  renderRepNarrative(analysis.reps);

  analysis.reps.forEach((rep, i) => {
    const card = document.createElement('div');
    card.className = 'rep-card';
    card.dataset.repIndex = String(i);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Rep ${i + 1}: Grade ${rep.grade}, Score ${rep.overallScore}`);

    const color = gradeColor(rep.grade);

    // Use text labels alongside color dots instead of color-only indicators
    let issueLabelsHtml = '';
    for (const issue of rep.issues.slice(0, 4)) {
      const sColor = severityColor(issue.severity);
      const shortName = formatShortIssueName(issue.name);
      const displayName = ISSUE_DISPLAY_NAMES[issue.name] ?? formatIssueName(issue.name);
      const severityLabel = issue.severity === 'high' ? 'H' : issue.severity === 'moderate' ? 'M' : 'L';
      issueLabelsHtml += `<span class="issue-indicator" style="display: inline-flex; align-items: center; gap: 2px; font-size: 0.7rem; color: ${sColor};" title="${escapeHtml(displayName)} (${severityLabel})"><span class="issue-dot" style="background: ${sColor}" aria-hidden="true"></span>${escapeHtml(shortName)}<span style="font-size: 0.65rem; opacity: 0.8;">(${severityLabel})</span></span>`;
    }

    // Competition depth judgment
    let competitionHtml = '';
    if (analysis.competitionMode) {
      competitionHtml = renderCompetitionDepthJudgment(rep, i);
    }

    // Sticking point indicator
    let stickingHtml = '';
    if (rep.stickingPoints.length > 0) {
      const sp = rep.stickingPoints[0];
      stickingHtml = renderStickingPointIndicator(sp);
    }

    // Bar path mini SVG (for loaded squats)
    let barPathHtml = '';
    if (rep.barPath && (analysis.config.squatType === 'high_bar' || analysis.config.squatType === 'low_bar')) {
      barPathHtml = renderBarPathMini(rep.barPath);
    }

    // Movement tempo metrics (angular velocity, not linear bar velocity)
    let velocityHtml = '';
    if (rep.velocity) {
      velocityHtml = renderVelocityMini(rep.velocity, analysis.competitionMode);
    }

    // Confidence badge for this rep
    const confidenceHtml = renderConfidenceBadge(rep.avgConfidence);

    // Best dimension for this rep
    const bestDim = getBestDimension(rep);
    const bestDimHtml = `<div class="rep-best-dim" title="Strongest dimension this rep">Best: ${escapeHtml(bestDim.label)} (${bestDim.score})</div>`;

    // Top positive feedback for this rep (first item if available)
    let positiveLine = '';
    if (rep.positiveFeedback.length > 0) {
      positiveLine = `<div class="rep-positive-line" title="${escapeHtml(rep.positiveFeedback[0])}">${escapeHtml(rep.positiveFeedback[0])}</div>`;
    }

    card.innerHTML = `
      <div class="rep-label">Rep ${i + 1}</div>
      <div class="rep-grade" style="color: ${color}">${rep.grade}</div>
      <div class="rep-score">${rep.overallScore}</div>
      ${confidenceHtml}
      ${bestDimHtml}
      ${positiveLine}
      <div class="rep-issues">${issueLabelsHtml}</div>
      ${competitionHtml}
      ${stickingHtml}
      ${barPathHtml}
      ${velocityHtml}
      <button class="btn btn-sm rep-export-btn" data-rep-index="${i}" title="Export video clip for this rep">Export Clip</button>
    `;

    // Wire up clip export button (stop propagation so card click/seek doesn't fire)
    const exportBtn = card.querySelector('.rep-export-btn') as HTMLButtonElement;
    if (exportBtn) {
      exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleRepExport(exportBtn, i, analysis);
      });
    }

    // Support keyboard activation
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
      }
    });

    grid.appendChild(card);
  });
}

// ─── Rep Clip Export Handler ───

async function handleRepExport(
  btn: HTMLButtonElement,
  repIndex: number,
  analysis: SetAnalysis,
): Promise<void> {
  const fps = _clipExportFps;
  if (fps <= 0) return;

  const video = document.getElementById('result-video') as HTMLVideoElement | null;
  const canvas = document.getElementById('overlay-canvas') as HTMLCanvasElement | null;
  if (!video || !canvas) return;

  // Calculate time range from repStartFrames
  const frameInterval = 1 / fps;
  const startFrame = analysis.repStartFrames[repIndex];
  if (startFrame === undefined) return;

  // End frame: either the start of the next rep, or infer from repFrameMap
  let endFrame: number;
  if (repIndex < analysis.repStartFrames.length - 1) {
    endFrame = analysis.repStartFrames[repIndex + 1];
  } else {
    // Last rep: find the max frame in repFrameMap that belongs to this rep
    let maxFrame = startFrame;
    for (const [frame, idx] of analysis.repFrameMap) {
      if (idx === repIndex && frame > maxFrame) {
        maxFrame = frame;
      }
    }
    endFrame = maxFrame + 1; // include the last frame
  }

  const startTime = startFrame * frameInterval;
  const endTime = endFrame * frameInterval;

  if (startTime >= endTime) return;

  // Show loading state
  const originalText = btn.textContent;
  btn.textContent = 'Exporting...';
  btn.classList.add('exporting');

  // Save current video time to restore after export
  const savedTime = video.currentTime;
  const wasPaused = video.paused;

  try {
    const clip = await exportRepClip(
      { video, canvas, startTime, endTime, fps },
      repIndex,
    );

    // Use share on mobile, download on desktop
    const filename = `rep-${repIndex + 1}.webm`;
    await shareClip(clip, `rep-${repIndex + 1}`);

    btn.textContent = 'Exported!';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.classList.remove('exporting');
    }, 2000);
  } catch (err) {
    console.error('Clip export failed:', err);
    btn.textContent = 'Failed';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.classList.remove('exporting');
    }, 2000);
  } finally {
    // Restore video position
    video.currentTime = savedTime;
    if (!wasPaused) video.play();
  }
}

// ─── Sticking Point Indicator ───

export function renderStickingPointIndicator(sp: StickingPoint): string {
  const pct = Math.max(0, Math.min(100, sp.depthPercentage));
  return `
    <div class="sticking-point-indicator" style="margin-top: 0.35rem; position: relative;" title="${escapeHtml(sp.description)}">
      <div style="display: flex; align-items: center; gap: 0.25rem;">
        <div style="width: 4px; height: 30px; background: var(--bg-input, #222); border-radius: 2px; position: relative;">
          <div style="position: absolute; left: -2px; width: 8px; height: 3px; background: var(--danger, #f87171); border-radius: 1px; bottom: ${pct}%;" aria-hidden="true"></div>
        </div>
        <span style="font-size: 0.7rem; color: var(--text-muted, #888);">Stick ${pct}%</span>
      </div>
    </div>
  `;
}

// ─── Bar Path Mini SVG ───

export function renderBarPathMini(barPath: BarPathData): string {
  if (barPath.xPositions.length < 3) return '';

  const width = 30;
  const height = 40;
  const padding = 4;

  const xMin = Math.min(...barPath.xPositions);
  const xMax = Math.max(...barPath.xPositions);
  const yMin = Math.min(...barPath.yPositions);
  const yMax = Math.max(...barPath.yPositions);

  const xRange = xMax - xMin || 0.01;
  const yRange = yMax - yMin || 0.01;

  const points = barPath.xPositions.map((x, i) => {
    const px = padding + ((x - xMin) / xRange) * (width - 2 * padding);
    const py = padding + ((barPath.yPositions[i] - yMin) / yRange) * (height - 2 * padding);
    return `${px.toFixed(1)},${py.toFixed(1)}`;
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p}`).join(' ');

  // Ideal straight line (vertical)
  const midX = width / 2;

  const driftColor = barPath.lateralDrift < 0.02 ? 'var(--success)' : barPath.lateralDrift < 0.04 ? 'var(--warning)' : 'var(--danger)';

  return `
    <div style="margin-top: 0.35rem; text-align: center;" title="Bar path: ${barPath.pathEfficiency}% efficient, ${(barPath.lateralDrift * 100).toFixed(1)}cm drift">
      <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Bar path visualization">
        <line x1="${midX}" y1="${padding}" x2="${midX}" y2="${height - padding}" stroke="var(--border, #333)" stroke-width="0.5" stroke-dasharray="2,2" />
        <polyline points="${points.join(' ')}" fill="none" stroke="${driftColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <div style="font-size: 0.7rem; color: var(--text-muted, #888);">${(barPath.lateralDrift * 100).toFixed(0)}% drift</div>
    </div>
  `;
}

// ─── Movement Tempo Mini Display ───

export function renderVelocityMini(vel: VelocityMetrics, competitionMode: boolean): string {
  const ratio = vel.ascentDescentRatio;
  let ratioColor = 'var(--success)';
  if (ratio < 0.5) ratioColor = 'var(--danger)';
  else if (ratio < 0.8) ratioColor = 'var(--warning)';

  let grindWarning = '';
  if (competitionMode && ratio < 0.5) {
    grindWarning = `<span style="font-size: 0.7rem; color: var(--danger, #f87171);">Grinding</span>`;
  }

  return `
    <div style="margin-top: 0.25rem; font-size: 0.7rem; color: var(--text-muted, #888);">
      <span title="Descent angular tempo">&darr;${vel.meanDescentVelocity}&deg;/s</span>
      <span title="Ascent angular tempo">&uarr;${vel.meanAscentVelocity}&deg;/s</span>
      <span style="color: ${ratioColor};" title="Tempo ratio">${ratio.toFixed(1)}x</span>
      ${grindWarning}
    </div>
  `;
}

// ─── Velocity Profile Chart (per-rep velocity decay visualization) ───

export function renderVelocityChart(analysis: SetAnalysis): void {
  const section = $('results-section');
  const existing = document.getElementById('velocity-chart-section');
  if (existing) existing.remove();

  // Only show if we have velocity data for at least 3 reps
  const repsWithVelocity = analysis.reps.filter(r => r.velocity);
  if (repsWithVelocity.length < 3) return;

  const container = document.createElement('div');
  container.id = 'velocity-chart-section';
  container.className = 'card velocity-chart-card';

  const velocities = analysis.reps.map(r => r.velocity?.meanAscentVelocity ?? 0);
  const maxVel = Math.max(...velocities, 1);
  const minVel = Math.min(...velocities);

  // Calculate velocity loss
  const firstRepVel = velocities[0] ?? 0;
  const lastRepVel = velocities[velocities.length - 1] ?? 0;
  const velocityLoss = firstRepVel > 0 ? Math.round((1 - lastRepVel / firstRepVel) * 100) : 0;
  const lossColor = velocityLoss > 30 ? 'var(--danger)' : velocityLoss > 15 ? 'var(--warning)' : 'var(--success)';

  // SVG sparkline
  const chartWidth = 280;
  const chartHeight = 60;
  const padding = 4;
  const points = velocities.map((v, i) => {
    const x = padding + (i / (velocities.length - 1)) * (chartWidth - padding * 2);
    const y = padding + (1 - (v - minVel * 0.8) / (maxVel - minVel * 0.8 + 1)) * (chartHeight - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  // RPE estimation for each rep
  const rpeLabels = analysis.reps.map(r => {
    if (!r.velocity) return '';
    const ratio = r.velocity.ascentDescentRatio;
    if (ratio < 0.3) return 'RPE 10';
    if (ratio < 0.5) return '9.5';
    if (ratio < 0.7) return '9';
    if (ratio < 0.9) return '8';
    if (ratio < 1.1) return '7';
    return '6';
  });

  container.innerHTML = `
    <div class="velocity-header">
      <strong class="velocity-title">Velocity Profile</strong>
      <span class="velocity-loss" style="color: ${lossColor};">
        ${velocityLoss > 0 ? `${velocityLoss}% velocity loss` : 'Consistent velocity'}
      </span>
    </div>
    <svg viewBox="0 0 ${chartWidth} ${chartHeight}" style="width: 100%; height: ${chartHeight}px; background: var(--bg-input, #1e1e1e); border-radius: var(--radius-sm, 6px);">
      <polyline points="${points}" fill="none" stroke="var(--accent, #00d4ff)" stroke-width="2" stroke-linejoin="round" />
      ${velocities.map((v, i) => {
        const x = padding + (i / (velocities.length - 1)) * (chartWidth - padding * 2);
        const y = padding + (1 - (v - minVel * 0.8) / (maxVel - minVel * 0.8 + 1)) * (chartHeight - padding * 2);
        const color = i === 0 ? 'var(--success)' : i === velocities.length - 1 ? (velocityLoss > 30 ? 'var(--danger)' : 'var(--accent)') : 'var(--accent)';
        return `<circle cx="${x}" cy="${y}" r="3" fill="${color}" />`;
      }).join('')}
    </svg>
    <div style="display: grid; grid-template-columns: repeat(${velocities.length}, 1fr); font-size: 0.65rem; text-align: center; margin-top: 0.35rem; gap: 2px;">
      ${analysis.reps.map((r, i) => {
        const v = r.velocity;
        const rpe = rpeLabels[i] || '';
        const velColor = i === 0 ? 'var(--success)' : i === velocities.length - 1 ? (velocityLoss > 30 ? 'var(--danger)' : 'var(--accent)') : 'var(--text-secondary)';
        return `<div>
          <div style="font-weight: 700; color: var(--text-muted);">R${i + 1}</div>
          <div style="color: ${velColor};" title="Mean ascent angular velocity">${v?.meanAscentVelocity ?? '-'}</div>
          <div style="color: var(--text-muted);" title="Ascent/descent ratio">${v ? v.ascentDescentRatio.toFixed(1) + 'x' : '-'}</div>
          ${rpe ? `<div style="color: var(--accent); font-size: 0.6rem;">${rpe}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
    <div style="font-size: 0.6rem; color: var(--text-muted); text-align: right; margin-top: 0.15rem;">deg/s | ratio | est. RPE</div>
    ${velocityLoss > 20 ? `<div class="velocity-advice">
      ${velocityLoss > 30
        ? 'Significant velocity drop — consider stopping 1-2 reps earlier next set for better quality reps.'
        : 'Moderate velocity drop across the set — form held well but fatigue is accumulating.'}
    </div>` : ''}
  `;

  // Compare user-entered RPE vs velocity-estimated RPE (last rep = most representative)
  const rpeInput = document.getElementById('rpe-input') as HTMLSelectElement | null;
  const userRpe = rpeInput ? parseFloat(rpeInput.value) : NaN;
  const lastRepVelocity = analysis.reps[analysis.reps.length - 1]?.velocity;
  if (isFinite(userRpe) && lastRepVelocity) {
    const lastRatio = lastRepVelocity.ascentDescentRatio;
    let estRpe: number;
    if (lastRatio < 0.3) estRpe = 10;
    else if (lastRatio < 0.5) estRpe = 9.5;
    else if (lastRatio < 0.7) estRpe = 9;
    else if (lastRatio < 0.9) estRpe = 8;
    else if (lastRatio < 1.1) estRpe = 7;
    else estRpe = 6;

    const diff = estRpe - userRpe;
    const diffAbs = Math.abs(diff);
    let calibrationNote = '';
    if (diffAbs <= 0.5) {
      calibrationNote = 'Your RPE calibration is dialed in.';
    } else if (diff > 0) {
      calibrationNote = `You rated this easier than the velocity suggests. You may be underestimating effort by ~${diff.toFixed(1)} RPE.`;
    } else {
      calibrationNote = `You rated this harder than the velocity suggests. You may be overestimating effort by ~${diffAbs.toFixed(1)} RPE.`;
    }

    const rpeCompDiv = document.createElement('div');
    rpeCompDiv.style.cssText = 'margin-top: 0.5rem; padding: 0.4rem 0.6rem; background: var(--bg-input); border-radius: var(--radius-sm, 6px); font-size: 0.8rem; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;';
    rpeCompDiv.innerHTML = `
      <div>
        <span style="color: var(--text-muted);">Your RPE:</span> <span style="color: var(--accent); font-weight: 700;">${userRpe}</span>
        <span style="color: var(--text-muted); margin: 0 0.25rem;">|</span>
        <span style="color: var(--text-muted);">Estimated:</span> <span style="color: var(--accent); font-weight: 700;">${estRpe}</span>
      </div>
      <div style="font-size: 0.7rem; color: ${diffAbs <= 0.5 ? 'var(--success)' : 'var(--warning)'};">${calibrationNote}</div>
    `;
    container.appendChild(rpeCompDiv);
  }

  // Insert after score breakdown or after focus section
  const breakdown = document.getElementById('score-breakdown');
  const focus = document.getElementById('focus-section');
  const insertAfter = breakdown ?? focus;
  if (insertAfter?.nextSibling) {
    section.insertBefore(container, insertAfter.nextSibling);
  } else {
    section.appendChild(container);
  }
}

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
        <details style="margin-top: 0.5rem;">
          <summary style="cursor: pointer; font-size: 0.75rem; color: var(--accent, #00d4ff); font-weight: 500;">Progression Path</summary>
          <div class="progression-path" style="margin-top: 0.5rem; padding-left: 0.5rem; border-left: 2px solid var(--border, #333333);">
            ${progressions.map((p, idx) => `
              <div style="display: flex; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.5rem; position: relative;">
                <div style="width: 22px; height: 22px; border-radius: 50%; background: ${idx === 0 ? 'var(--accent, #00d4ff)' : idx === progressions.length - 1 ? 'var(--success, #4ade80)' : 'var(--warning, #fbbf24)'}; color: var(--bg-primary, #0a0a0a); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.65rem; flex-shrink: 0;">${idx + 1}</div>
                <div>
                  <div style="font-size: 0.75rem; color: var(--text-muted, #888); font-weight: 600;">${escapeHtml(p.level)}</div>
                  <div style="font-size: 0.8rem; color: var(--text, #e0e0e0); font-weight: 600;">${escapeHtml(p.exercise)}</div>
                  <div style="font-size: 0.7rem; color: var(--text-muted, #888);">${escapeHtml(p.criteria)}</div>
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
          <div class="cue-alternates" style="font-size: 0.8rem; color: var(--text-muted, #888); margin-top: 0.25rem;">
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
      <div class="cue-issue" style="display: flex; align-items: center; gap: 0.5rem;">
        <span style="display: inline-flex; align-items: center; gap: 4px;">
          <span style="width: 8px; height: 8px; border-radius: 50%; background: ${severitySColor}; display: inline-block;" aria-hidden="true"></span>
          <span class="cue-priority" style="font-weight: 700; color: ${severitySColor};">${severityText}</span>
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

export function renderFatigueWarning(analysis: SetAnalysis): void {
  const warning = $('fatigue-warning');
  warning.style.display = analysis.fatigueDetected ? 'block' : 'none';
}

// ─── Competition Mode Badge ───

export function renderCompetitionBadge(analysis: SetAnalysis): void {
  // Remove existing badge
  const existing = document.getElementById('competition-badge');
  if (existing) existing.remove();

  if (!analysis.competitionMode) return;

  // Full-width competition banner above the score card for authoritative presence
  const scoresPanel = document.querySelector('.scores-panel');
  if (!scoresPanel) return;

  const badge = document.createElement('div');
  badge.id = 'competition-badge';
  badge.className = 'competition-badge';
  badge.setAttribute('aria-label', 'Competition mode active: IPF/USAPL judging standards applied');
  badge.style.cssText = 'background: linear-gradient(135deg, #e11d48, #be123c); color: white; font-size: 0.85rem; font-weight: 700; padding: 0.65rem 1rem; border-radius: var(--radius-sm, 6px); text-transform: uppercase; letter-spacing: 1px; text-align: center; margin-bottom: 0.75rem; box-shadow: 0 2px 8px rgba(225, 29, 72, 0.3);';
  badge.innerHTML = 'Competition Mode &mdash; IPF/USAPL Standards';

  // Insert at the very top of the scores panel
  scoresPanel.prepend(badge);
}

// ─── Competition Depth Judgment ───

export function renderCompetitionDepthJudgment(rep: RepScore, repIdx: number): string {
  // Use actual competition depth check if available, fall back to score proxy
  const depthPassed = rep.competitionDepthPass !== undefined ? rep.competitionDepthPass : rep.depthScore >= 80;

  if (depthPassed) {
    return `<div class="competition-judgment good-lift" style="background: rgba(74, 222, 128, 0.1); border: 1px solid var(--success, #4ade80); border-radius: var(--radius-sm, 6px); padding: 0.5rem; text-align: center; margin-top: 0.5rem;" aria-label="Good lift">
      <span style="color: var(--success, #4ade80); font-weight: 700; font-size: 1rem;">GOOD LIFT</span>
    </div>`;
  } else {
    return `<div class="competition-judgment depth-call" style="background: rgba(248, 113, 113, 0.1); border: 1px solid var(--danger, #f87171); border-radius: var(--radius-sm, 6px); padding: 0.5rem; text-align: center; margin-top: 0.5rem;" aria-label="Depth call">
      <span style="color: var(--danger, #f87171); font-weight: 700; font-size: 1rem;">DEPTH</span>
    </div>`;
  }
}

// ─── Mobility Assessment Section ───

export function renderMobilityAssessment(analysis: SetAnalysis): void {
  const scoresPanel = document.querySelector('.scores-panel');
  if (!scoresPanel) return;

  // Remove existing
  const existing = document.getElementById('mobility-section');
  if (existing) existing.remove();

  const findings = analysis.mobilityFindings;
  if (findings.length === 0) return;

  const section = document.createElement('div');
  section.id = 'mobility-section';
  section.className = 'card mobility-section';
  section.setAttribute('aria-label', 'Mobility assessment');

  let html = `
    <h3 style="font-size: 0.9rem; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.25rem;">Mobility Assessment</h3>
    <p style="font-size: 0.8rem; color: var(--text-muted, #888); margin-bottom: 1rem;">Based on your form, here are areas to work on</p>
  `;

  for (const f of findings) {
    html += `
      <div class="mobility-finding mobility-card" style="padding: 0.85rem;">
        <div style="font-weight: 700; color: var(--accent, #00d4ff); font-size: 0.95rem; margin-bottom: 0.25rem;">${escapeHtml(f.area)}</div>
        <p style="font-size: 0.85rem; color: var(--text, #e0e0e0); margin-bottom: 0.5rem;">${escapeHtml(f.limitation)}</p>
        <details style="margin-bottom: 0.5rem;">
          <summary style="cursor: pointer; font-size: 0.8rem; color: var(--accent, #00d4ff); font-weight: 500;">Self-test: Can you pass this?</summary>
          <p style="font-size: 0.8rem; color: var(--text-muted, #888); margin-top: 0.35rem; padding: 0.5rem; background: var(--bg-input, #1e1e1e); border-radius: 6px;">${escapeHtml(f.test)}</p>
        </details>
        <div>
          <strong style="font-size: 0.8rem; color: var(--text-muted, #888);">Recommended:</strong>
          <ul style="margin: 0.25rem 0 0 1.25rem; font-size: 0.8rem; color: var(--text, #e0e0e0);">
            ${f.stretches.map(s => `<li style="margin-bottom: 0.15rem;">${escapeHtml(s)}</li>`).join('')}
          </ul>
          <p style="font-size: 0.75rem; color: var(--accent, #00d4ff); margin-top: 0.35rem; font-weight: 500;">${escapeHtml(f.frequency)}</p>
        </div>
      </div>
    `;
  }

  section.innerHTML = html;
  scoresPanel.appendChild(section);
}

// ─── Warm-Up Protocol Section ───

export function renderWarmUpProtocol(analysis: SetAnalysis): void {
  const scoresPanel = document.querySelector('.scores-panel');
  if (!scoresPanel) return;

  // Remove existing
  const existing = document.getElementById('warmup-section');
  if (existing) existing.remove();

  const protocol = analysis.warmupProtocol;
  if (protocol.length === 0) return;

  const totalMinutes = protocol.reduce((sum, step) => {
    const match = step.duration.match(/(\d+)/);
    return sum + (match ? parseInt(match[1]) : 2);
  }, 0);

  const section = document.createElement('div');
  section.id = 'warmup-section';
  section.className = 'card';
  section.setAttribute('aria-label', 'Recommended warm-up');

  let html = `
    <details>
      <summary style="cursor: pointer; font-size: 0.9rem; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; list-style: none; display: flex; align-items: center; gap: 0.35rem;">
        <span style="font-size: 0.6rem; transition: transform 0.2s;">&#9654;</span>
        Recommended Warm-Up (~${totalMinutes} min)
      </summary>
      <div style="margin-top: 0.75rem;">
  `;

  protocol.forEach((step, i) => {
    html += `
      <div class="warmup-step" style="margin-bottom: 0.65rem; padding: 0.5rem 0.65rem; background: var(--bg-input, #1e1e1e); border-radius: var(--radius-sm, 8px);">
        <div style="width: 28px; height: 28px; border-radius: 50%; background: var(--accent, #00d4ff); color: var(--bg-primary, #0a0a0a); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.8rem; flex-shrink: 0;">${i + 1}</div>
        <div style="flex: 1;">
          <div style="font-weight: 600; font-size: 0.875rem; color: var(--text, #e0e0e0);">${escapeHtml(step.name)} <span style="color: var(--accent, #00d4ff); font-size: 0.75rem; font-weight: 500;">${escapeHtml(step.duration)}</span></div>
          <p style="font-size: 0.8rem; color: var(--text-muted, #888); margin-top: 0.1rem;">${escapeHtml(step.description)}</p>
        </div>
      </div>
    `;
  });

  html += `
      </div>
      <button id="start-warmup-btn" style="margin-top: 0.75rem; width: 100%; padding: 0.5rem; background: var(--accent, #00d4ff); color: var(--bg-primary, #0a0a0a); border: none; border-radius: var(--radius-sm, 8px); font-weight: 600; font-size: 0.875rem; cursor: pointer; transition: opacity 0.2s;">
        Start Guided Warmup
      </button>
    </details>
  `;
  section.innerHTML = html;
  scoresPanel.appendChild(section);

  // Attach warmup timer launcher
  document.getElementById('start-warmup-btn')?.addEventListener('click', () => {
    launchWarmupOverlay(protocol);
  });
}

// ─── Warmup Timer Overlay ───

/** Format seconds as MM:SS. */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Announce a step name via Web Speech API, if available. */
function announceStep(stepName: string): void {
  if (typeof speechSynthesis === 'undefined') return;
  try {
    // Cancel any ongoing speech
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(stepName);
    utterance.rate = 0.9;
    utterance.volume = 0.8;
    speechSynthesis.speak(utterance);
  } catch {
    // Speech not available — silently ignore
  }
}

/** Trigger a vibration pattern for step transitions. */
function vibrateStepTransition(): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([100, 50, 100]);
    } catch {
      // Vibration not available — silently ignore
    }
  }
}

function launchWarmupOverlay(protocol: WarmUpStep[]): void {
  // Remove existing overlay if any
  document.getElementById('warmup-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'warmup-overlay';
  overlay.className = 'warmup-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Guided warmup timer');

  // Build dots HTML
  const dotsHtml = protocol
    .map((_, i) => `<div class="warmup-dot" data-dot="${i}"></div>`)
    .join('');

  overlay.innerHTML = `
    <div class="warmup-countdown" id="warmup-time">0:00</div>
    <div class="warmup-step-name" id="warmup-step-name"></div>
    <div class="warmup-step-desc" id="warmup-step-desc"></div>
    <div class="warmup-step-counter" id="warmup-step-counter"></div>
    <div class="warmup-progress">
      <div class="warmup-progress-fill" id="warmup-progress-fill" style="width: 0%"></div>
    </div>
    <div class="warmup-dots" id="warmup-dots">${dotsHtml}</div>
    <div class="warmup-controls">
      <button id="warmup-pause-btn">Pause</button>
      <button id="warmup-skip-btn">Skip</button>
      <button id="warmup-stop-btn" class="warmup-stop-btn">Stop</button>
    </div>
  `;

  document.body.appendChild(overlay);

  const timeEl = document.getElementById('warmup-time')!;
  const nameEl = document.getElementById('warmup-step-name')!;
  const descEl = document.getElementById('warmup-step-desc')!;
  const counterEl = document.getElementById('warmup-step-counter')!;
  const progressFill = document.getElementById('warmup-progress-fill')!;
  const pauseBtn = document.getElementById('warmup-pause-btn')!;
  const skipBtn = document.getElementById('warmup-skip-btn')!;
  const stopBtn = document.getElementById('warmup-stop-btn')!;

  let stepDuration = 0;

  const updateDots = (currentIndex: number) => {
    const dots = overlay.querySelectorAll('.warmup-dot');
    dots.forEach((dot, i) => {
      dot.classList.remove('active', 'completed');
      if (i < currentIndex) dot.classList.add('completed');
      else if (i === currentIndex) dot.classList.add('active');
    });
  };

  const timer = new WarmupTimer(protocol, {
    onTick: (state: TimerState) => {
      timeEl.textContent = formatTime(state.timeRemaining);
      counterEl.textContent = `Step ${state.currentStepIndex + 1} of ${state.totalSteps}`;
      // Progress within current step
      const elapsed = stepDuration - state.timeRemaining;
      const pct = stepDuration > 0 ? (elapsed / stepDuration) * 100 : 0;
      progressFill.style.width = `${Math.min(100, pct)}%`;
      updateDots(state.currentStepIndex);
    },
    onStepChange: (step: WarmUpStep, index: number) => {
      stepDuration = getStepDuration(step);
      nameEl.textContent = step.name;
      descEl.textContent = step.description;
      progressFill.style.width = '0%';
      announceStep(step.name);
      if (index > 0) vibrateStepTransition();
    },
    onComplete: () => {
      timeEl.textContent = 'Done!';
      nameEl.textContent = 'Warmup Complete';
      descEl.textContent = 'You are ready to lift.';
      counterEl.textContent = '';
      progressFill.style.width = '100%';
      // Mark all dots completed
      overlay.querySelectorAll('.warmup-dot').forEach(dot => dot.classList.add('completed'));
      pauseBtn.style.display = 'none';
      skipBtn.style.display = 'none';
      stopBtn.textContent = 'Close';
      stopBtn.classList.remove('warmup-stop-btn');
      announceStep('Warmup complete');
      vibrateStepTransition();
    },
  });

  pauseBtn.addEventListener('click', () => {
    const state = timer.getState();
    if (state.isPaused) {
      timer.resume();
      pauseBtn.textContent = 'Pause';
    } else {
      timer.pause();
      pauseBtn.textContent = 'Resume';
    }
  });

  skipBtn.addEventListener('click', () => timer.skip());

  stopBtn.addEventListener('click', () => {
    timer.stop();
    // Cancel any speech
    if (typeof speechSynthesis !== 'undefined') {
      try { speechSynthesis.cancel(); } catch { /* ignore */ }
    }
    overlay.remove();
  });

  // Start the timer
  timer.start();
}

// ─── Share / Print Report ───

export function renderShareButtons(analysis: SetAnalysis): void {
  const scoresPanel = document.querySelector('.scores-panel');
  if (!scoresPanel) return;

  // Remove existing
  const existing = document.getElementById('share-section');
  if (existing) existing.remove();

  const section = document.createElement('div');
  section.id = 'share-section';
  section.style.cssText = 'display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem;';

  const btnStyle = 'background: var(--bg-input, #1e1e1e); border: 1px solid var(--border, #333333); color: var(--text, #e0e0e0); font-size: 0.8rem; cursor: pointer;';

  section.innerHTML = `
    <button class="btn btn-sm" id="share-link-btn" aria-label="Copy shareable link" style="${btnStyle}">Share Link</button>
    <button class="btn btn-sm" id="save-image-btn" aria-label="Save result as image" style="${btnStyle}">Save Image</button>
    <button class="btn btn-sm" id="export-analysis-csv-btn" aria-label="Export this analysis as CSV" style="${btnStyle}">Export CSV</button>
    <button class="btn btn-sm" id="copy-report-btn" aria-label="Copy text report to clipboard" style="${btnStyle}">Copy Report</button>
    <button class="btn btn-sm" id="print-report-btn" aria-label="Print or save report as PDF" style="${btnStyle}">Print Report</button>
  `;

  scoresPanel.appendChild(section);

  // Share link
  document.getElementById('share-link-btn')?.addEventListener('click', () => {
    const weightEl = document.getElementById('weight-input') as HTMLInputElement | null;
    const weight = weightEl ? parseFloat(weightEl.value) : undefined;
    const unitEl = document.querySelector('.weight-unit-btn.active') as HTMLElement | null;
    const unit = unitEl?.dataset.unit;
    const url = encodeAnalysisUrl(analysis, weight, unit);
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.getElementById('share-link-btn');
      if (btn) { btn.textContent = 'Link Copied!'; setTimeout(() => { btn.textContent = 'Share Link'; }, 2000); }
    }).catch(() => {});
  });

  // Save image
  document.getElementById('save-image-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('save-image-btn');
    if (btn) btn.textContent = 'Generating...';
    try {
      const blob = await generateShareCard(analysis);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `squat-form-${analysis.grade}-${analysis.overallScore}.png`;
      a.click();
      URL.revokeObjectURL(url);
      if (btn) { btn.textContent = 'Saved!'; setTimeout(() => { btn.textContent = 'Save Image'; }, 2000); }
    } catch {
      if (btn) btn.textContent = 'Save Image';
    }
  });

  // Export CSV
  document.getElementById('export-analysis-csv-btn')?.addEventListener('click', () => {
    const csv = exportAnalysisCSV(analysis);
    const date = new Date().toISOString().slice(0, 10);
    downloadCSV(csv, `squat-analysis-${date}.csv`);
    const btn = document.getElementById('export-analysis-csv-btn');
    if (btn) { btn.textContent = 'Exported!'; setTimeout(() => { btn.textContent = 'Export CSV'; }, 2000); }
  });

  // Copy report
  document.getElementById('copy-report-btn')?.addEventListener('click', () => {
    const text = generateTextReport(analysis);
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('copy-report-btn');
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy Report'; }, 2000); }
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = generateTextReport(analysis);
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
  });

  // Print
  document.getElementById('print-report-btn')?.addEventListener('click', () => {
    window.print();
  });
}

export function generateTextReport(analysis: SetAnalysis): string {
  let report = 'SQUAT FORM ANALYSIS REPORT\n';
  report += '='.repeat(40) + '\n';
  report += `Date: ${new Date().toLocaleDateString()}\n`;
  report += `Type: ${analysis.config.squatType} | Level: ${analysis.config.experienceLevel}`;
  if (analysis.competitionMode) report += ' | COMPETITION MODE';
  report += '\n';

  // Include weight if provided
  const weightEl = document.getElementById('weight-input') as HTMLInputElement | null;
  const weightUnitEl = document.querySelector('.weight-unit-btn.active') as HTMLElement | null;
  if (weightEl && weightEl.value && parseFloat(weightEl.value) > 0) {
    const unit = weightUnitEl?.dataset.unit ?? 'lbs';
    report += `Weight: ${weightEl.value} ${unit}\n`;
  }

  report += '\n';
  report += `Overall Score: ${analysis.overallScore}/100 (${analysis.grade})\n`;
  report += `Reps: ${analysis.repCount}\n`;
  if (analysis.fatigueDetected) report += 'Fatigue: Detected\n';
  report += '\n';

  // Score breakdown by dimension
  if (analysis.reps.length > 0) {
    type ScoreKey = 'depthScore' | 'kneeTrackingScore' | 'trunkScore' | 'symmetryScore' | 'tempoScore' | 'lockoutScore';
    const dims: { label: string; key: ScoreKey }[] = [
      { label: 'Depth', key: 'depthScore' },
      { label: 'Knee Tracking', key: 'kneeTrackingScore' },
      { label: 'Torso Position', key: 'trunkScore' },
      { label: 'Balance', key: 'symmetryScore' },
      ...(analysis.competitionMode ? [] : [{ label: 'Control', key: 'tempoScore' as ScoreKey }]),
      { label: 'Lockout', key: 'lockoutScore' },
    ];

    report += 'SCORE BREAKDOWN\n';
    report += '-'.repeat(30) + '\n';
    for (const d of dims) {
      const avg = Math.round(
        analysis.reps.reduce((s, r) => s + (r[d.key] as number), 0) / analysis.reps.length
      );
      report += `${d.label}:${' '.repeat(16 - d.label.length)}${avg}/100\n`;
    }
    report += '\n';
  }

  // Per-rep breakdown
  report += 'PER-REP BREAKDOWN\n';
  report += '-'.repeat(30) + '\n';
  analysis.reps.forEach((rep, i) => {
    report += `Rep ${i + 1}: ${rep.overallScore}/100 (${rep.grade})`;
    if (rep.issues.length > 0) {
      const issueNames = rep.issues.map(iss => ISSUE_DISPLAY_NAMES[iss.name] ?? iss.name).join(', ');
      report += ` -- Issues: ${issueNames}`;
    }
    report += '\n';
  });
  report += '\n';

  // Coaching cues
  if (analysis.topCues.length > 0) {
    report += 'COACHING CUES\n';
    report += '-'.repeat(30) + '\n';
    for (const cue of analysis.topCues) {
      report += `- ${cue.cue}\n  ${cue.explanation}\n\n`;
    }
  }

  // Positive highlights
  if (analysis.positiveHighlights.length > 0) {
    report += 'WHAT YOU DID WELL\n';
    report += '-'.repeat(30) + '\n';
    for (const h of analysis.positiveHighlights) {
      report += `+ ${h}\n`;
    }
    report += '\n';
  }

  // Mobility findings
  if (analysis.mobilityFindings.length > 0) {
    report += 'MOBILITY ASSESSMENT\n';
    report += '-'.repeat(30) + '\n';
    for (const f of analysis.mobilityFindings) {
      report += `${f.area}: ${f.limitation}\n`;
      report += `  Stretches: ${f.stretches.join('; ')}\n`;
      report += `  Frequency: ${f.frequency}\n\n`;
    }
  }

  report += '\nGenerated by Squat Form Analyzer\n';
  return report;
}

// ─── Beginner Full Report Toggle ───

function renderBeginnerFullReportToggle(analysis: SetAnalysis, fps: number, sessions: SessionRecord[]): void {
  const section = $('results-section');
  const existing = document.getElementById('beginner-full-report');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.id = 'beginner-full-report';
  container.style.cssText = 'text-align: center; margin: 1rem 0;';

  const btn = document.createElement('button');
  btn.className = 'btn btn-secondary';
  btn.textContent = 'Show Full Detailed Report';
  btn.style.cssText = 'font-size: 0.85rem;';

  btn.addEventListener('click', () => {
    // Render the hidden sections
    renderScoreLegend(analysis);
    renderCoachingCues(analysis, fps);
    renderScoreBreakdown(analysis);
    wrapInCollapsible('breakdown-collapse', 'Score Breakdown', 'score-breakdown');
    renderRepCards(analysis);
    wrapInCollapsible('rep-detail-collapse', 'Per-Rep Detail', 'rep-cards-section');
    container.remove();
  });

  container.appendChild(btn);

  // Insert before share buttons
  const shareSection = document.getElementById('share-section');
  if (shareSection) {
    section.insertBefore(container, shareSection);
  } else {
    section.appendChild(container);
  }
}

// ─── Gamification: Streaks, Issue Resolution, Progress Path ───

const GAMIFICATION_KEY = 'squat_form_gamification';

interface GamificationState {
  totalSessions: number;
  currentStreak: number;
  lastSessionDate: string;
  resolvedIssues: string[];
  bestGrade: string;
  bestScore: number;
}

function loadGamificationState(): GamificationState {
  try {
    const stored = localStorage.getItem(GAMIFICATION_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return { totalSessions: 0, currentStreak: 0, lastSessionDate: '', resolvedIssues: [], bestGrade: '', bestScore: 0 };
}

function saveGamificationState(state: GamificationState): void {
  try { localStorage.setItem(GAMIFICATION_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function renderGamification(score: number, sessions: SessionRecord[]): void {
  const section = $('results-section');
  const existing = document.getElementById('gamification-section');
  if (existing) existing.remove();

  const state = loadGamificationState();
  const badges: string[] = [];

  // Update state
  state.totalSessions++;
  if (score > state.bestScore) state.bestScore = score;

  const gradeOrder = ['F', 'Keep Working', 'D', 'C', 'B', 'A'];
  const currentGradeIdx = gradeOrder.indexOf(sessions.length > 0 ? sessions[0]?.grade ?? '' : '');
  const bestGradeIdx = gradeOrder.indexOf(state.bestGrade);
  if (currentGradeIdx > bestGradeIdx) state.bestGrade = gradeOrder[currentGradeIdx] ?? state.bestGrade;

  // Streak calculation
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (state.lastSessionDate === today) {
    // Same day, streak unchanged
  } else if (state.lastSessionDate === yesterday || state.lastSessionDate === '') {
    state.currentStreak++;
  } else {
    state.currentStreak = 1;
  }
  state.lastSessionDate = today;

  // Issue resolution detection
  if (sessions.length >= 2) {
    const prevIssues = new Set(sessions.slice(1, 4).flatMap(s => s.top_issue ? [s.top_issue] : []));
    const currentIssue = sessions[0]?.top_issue;
    for (const prev of prevIssues) {
      if (prev !== currentIssue && !state.resolvedIssues.includes(prev)) {
        state.resolvedIssues.push(prev);
        badges.push(`You fixed "${prev.replace(/_/g, ' ')}"!`);
      }
    }
  }

  // Generate badges
  if (state.totalSessions === 1) badges.unshift('First analysis complete!');
  if (state.currentStreak >= 3) badges.push(`${state.currentStreak}-day streak!`);
  if (state.currentStreak >= 7) badges.push('One week consistent!');
  if (score >= 90 && state.bestScore >= 90) badges.push('First A grade achieved!');
  if (state.totalSessions === 5) badges.push('5 sessions and counting!');
  if (state.totalSessions === 10) badges.push('10 sessions — you\'re committed!');
  if (state.totalSessions === 25) badges.push('25 sessions — true dedication!');

  saveGamificationState(state);

  if (badges.length === 0) return;

  const container = document.createElement('div');
  container.id = 'gamification-section';
  container.className = 'milestone-banner';
  container.style.cssText = 'background: rgba(74, 222, 128, 0.06); border: 1px solid rgba(74, 222, 128, 0.2); border-radius: var(--radius-md, 10px); padding: 0.75rem 1rem; margin: 0.5rem 0; text-align: center;';

  container.innerHTML = badges.map(b =>
    `<div style="color: var(--success, #4ade80); font-size: 0.85rem; font-weight: 600; margin: 0.15rem 0;">&#127942; ${escapeHtml(b)}</div>`
  ).join('');

  // Insert after overall score
  const overallCard = document.getElementById('overall-score-card');
  if (overallCard?.nextSibling) {
    section.insertBefore(container, overallCard.nextSibling);
  } else {
    section.appendChild(container);
  }
}
