/**
 * Results display: overall score, score breakdown, rep cards, milestones,
 * gamification, share buttons. Orchestrator for all results sub-modules.
 */

import type {
  SetAnalysis,
  FrameData,
  RepScore,
  StickingPoint,
  BarPathData,
  VelocityMetrics,
  SessionRecord,
} from './types';
import type { OneRMEstimate } from './one-rm';
import { WEIGHTS, COMPETITION_WEIGHTS } from './scorer';
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
import { exportAnalysisCSV, downloadCSV } from './csv-export';
import { loadGoals, saveGoals, checkGoals } from './goals';
import { exportRepClip, downloadClip, shareClip } from './gif-export';
import type { ClipExportOptions } from './gif-export';

// ─── Imports from sub-modules ───

import {
  renderCoachingCues,
  renderPositiveFeedback,
  renderBeginnerSummary,
  renderFocusSection,
  BEGINNER_DIMENSION_LABELS,
  beginnerSeverity,
} from './ui-coaching';
import { renderTrainingRecommendations, renderOneRMEstimate, renderMeetPrepPlan } from './ui-training';
import { renderMobilityAssessment, renderWarmUpProtocol } from './ui-warmup-mobility';

// ─── Re-exports from sub-modules ───

export { renderCoachingCues, renderPositiveFeedback, renderBeginnerSummary, renderFocusSection, BEGINNER_DIMENSION_LABELS, beginnerSeverity } from './ui-coaching';
export { renderTrainingRecommendations, renderOneRMEstimate, renderMeetPrepPlan } from './ui-training';
export { renderMobilityAssessment, renderWarmUpProtocol } from './ui-warmup-mobility';

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
  insightsDiv.className = 'card card--static progress-insights-card';

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
  wrapper.className = 'card card--static collapsible-section';

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
  content.className = 'collapsible-content';

  // Move the target element into the collapsible content
  target.parentNode?.insertBefore(wrapper, target);
  content.appendChild(target);
  details.appendChild(summary);
  details.appendChild(content);
  wrapper.appendChild(details);
}

// Module-level state for clip export (set by showResults)
let _clipExportFps = 0;
let _clipExportAnalysis: SetAnalysis | null = null;

// ─── Results Display ───

export function showResults(analysis: SetAnalysis, frameData: FrameData, sessions: SessionRecord[] = [], oneRMEstimate?: OneRMEstimate | null, fps: number = 0, trainingPhase?: TrainingPhase, exerciseType?: string): void {
  hideProgress();
  hideError();
  hideSkeletonLoading();

  // Store for clip export handlers
  _clipExportFps = fps;
  _clipExportAnalysis = analysis;

  const section = $('results-section');
  section.classList.remove('visible');
  section.style.display = 'block';
  requestAnimationFrame(() => section.classList.add('visible'));

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

  if (isBeginner) {
    // --- Beginner: "What to Do Next" CTA ---
    renderBeginnerNextSteps();

    // --- Beginner: Collapsible "Detailed Analysis" wrapping focus, mobility, warmup ---
    renderFocusSection(analysis, fps);
    renderProgressInsights(analysis, sessions);
    if (oneRMEstimate) {
      renderOneRMEstimate(oneRMEstimate);
      wrapInCollapsible('onerm-collapse', 'Max Lift Estimate', 'one-rm-section');
    }
    renderMobilityAssessment(analysis);
    wrapInCollapsible('mobility-collapse', 'Stretches & Flexibility Check', 'mobility-section');
    renderWarmUpProtocol(analysis);

    // Wrap all the detailed sections in a single collapsible
    wrapBeginnerDetailedAnalysis();

    // Show full report toggle for advanced data (score breakdown, rep cards, etc.)
    renderBeginnerFullReportToggle(analysis, fps, sessions);
  } else {
    // --- Non-beginner: Tier 2: Action Items (what to do next) ---
    renderFocusSection(analysis, fps);
    renderCoachingCues(analysis, fps);
    renderProgressInsights(analysis, sessions);
    renderTrainingRecommendations(trainingPhase, oneRMEstimate, sessions, exerciseType);
    renderMeetPrepPlan(trainingPhase, oneRMEstimate);

    // --- Non-beginner: Tier 3: Details ---
    const isAdvanced = analysis.config.experienceLevel === 'advanced';
    renderScoreBreakdown(analysis);
    if (!isAdvanced) {
      wrapInCollapsible('breakdown-collapse', 'Score Breakdown', 'score-breakdown');
    }
    if (oneRMEstimate) {
      renderOneRMEstimate(oneRMEstimate);
    }
    renderRepCards(analysis);
    if (!isAdvanced) {
      wrapInCollapsible('rep-detail-collapse', 'Per-Rep Detail', 'rep-cards-section');
    }
    renderVelocityChart(analysis);
    renderMobilityAssessment(analysis);
    wrapInCollapsible('mobility-collapse', 'Mobility Assessment', 'mobility-section');
    renderWarmUpProtocol(analysis);
  }

  // --- Tier 4: Actions ---
  renderReanalyzeButton();
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

// ─── B1: Ideal vs Yours Angle Comparison SVG ───

/** Ideal angles for common scoring dimensions (degrees). */
const IDEAL_ANGLES: Record<string, number> = {
  'Depth': 70,                // knee angle at parallel depth
  'How Deep You Went': 70,
  'Torso Position': 25,       // trunk lean angle from vertical
  'Upper Body Position': 25,
  'Back Position': 15,        // deadlift back angle
  'Lockout': 175,             // standing fully upright
  'Standing Up Fully': 175,
};

/**
 * Render a small inline SVG (60x80) showing a stick figure at the ideal angle
 * overlaid with the user's actual angle. Returns empty string if no angle data
 * is available for this dimension.
 */
function renderAngleComparison(idealAngle: number, actualAngle: number, label: string): string {
  const diff = Math.abs(idealAngle - actualAngle);
  const color = diff <= 8 ? 'var(--success, #4ade80)' : diff <= 18 ? 'var(--warning, #fbbf24)' : 'var(--danger, #f87171)';
  const ghostColor = 'var(--text-muted, #808080)';

  // Build a simple thigh-shin stick figure (pivot at center)
  // We draw from a hip point down. Angles are knee angles for depth,
  // trunk angles for torso position.
  const isKneeBased = label === 'Depth' || label === 'How Deep You Went';
  const cx = 30;
  const pivotY = isKneeBased ? 30 : 20;

  if (isKneeBased) {
    // Draw thigh going down and shin at knee angle
    const thighLen = 22;
    const shinLen = 22;
    const thighEndY = pivotY + thighLen;

    // For the ideal: knee angle determines shin direction
    const idealRad = (idealAngle * Math.PI) / 180;
    const idealShinX = cx + Math.sin(Math.PI - idealRad) * shinLen;
    const idealShinY = thighEndY + Math.cos(Math.PI - idealRad) * shinLen;

    const actualRad = (actualAngle * Math.PI) / 180;
    const actualShinX = cx + Math.sin(Math.PI - actualRad) * shinLen;
    const actualShinY = thighEndY + Math.cos(Math.PI - actualRad) * shinLen;

    return `<svg class="dimension-visual" width="60" height="80" viewBox="0 0 60 80" xmlns="http://www.w3.org/2000/svg" aria-label="${escapeHtml(label)}: ideal ${idealAngle} degrees vs yours ${Math.round(actualAngle)} degrees">
      <!-- Ghost (ideal) -->
      <line x1="${cx}" y1="${pivotY}" x2="${cx}" y2="${thighEndY}" stroke="${ghostColor}" stroke-width="2" opacity="0.4" stroke-linecap="round"/>
      <line x1="${cx}" y1="${thighEndY}" x2="${idealShinX.toFixed(1)}" y2="${idealShinY.toFixed(1)}" stroke="${ghostColor}" stroke-width="2" opacity="0.4" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${thighEndY}" r="2" fill="${ghostColor}" opacity="0.4"/>
      <!-- User (actual) -->
      <line x1="${cx}" y1="${pivotY}" x2="${cx}" y2="${thighEndY}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="${cx}" y1="${thighEndY}" x2="${actualShinX.toFixed(1)}" y2="${actualShinY.toFixed(1)}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${thighEndY}" r="2.5" fill="${color}"/>
      <!-- Angle label -->
      <text x="30" y="76" text-anchor="middle" fill="${color}" font-size="9" font-weight="600">${Math.round(actualAngle)}&deg;</text>
    </svg>`;
  } else {
    // Trunk lean: draw a vertical line (ideal) and an angled line (actual) from hip
    const trunkLen = 30;

    const idealRad = (idealAngle * Math.PI) / 180;
    const idealTopX = cx + Math.sin(idealRad) * trunkLen;
    const idealTopY = pivotY + trunkLen - Math.cos(idealRad) * trunkLen;

    const actualRad = (actualAngle * Math.PI) / 180;
    const actualTopX = cx + Math.sin(actualRad) * trunkLen;
    const actualTopY = pivotY + trunkLen - Math.cos(actualRad) * trunkLen;

    const legY = pivotY + trunkLen;

    return `<svg class="dimension-visual" width="60" height="80" viewBox="0 0 60 80" xmlns="http://www.w3.org/2000/svg" aria-label="${escapeHtml(label)}: ideal ${idealAngle} degrees vs yours ${Math.round(actualAngle)} degrees">
      <!-- Legs (shared) -->
      <line x1="${cx - 8}" y1="${legY + 18}" x2="${cx}" y2="${legY}" stroke="${ghostColor}" stroke-width="1.5" opacity="0.3" stroke-linecap="round"/>
      <line x1="${cx + 8}" y1="${legY + 18}" x2="${cx}" y2="${legY}" stroke="${ghostColor}" stroke-width="1.5" opacity="0.3" stroke-linecap="round"/>
      <!-- Ghost (ideal trunk) -->
      <line x1="${cx}" y1="${legY}" x2="${idealTopX.toFixed(1)}" y2="${idealTopY.toFixed(1)}" stroke="${ghostColor}" stroke-width="2" opacity="0.4" stroke-linecap="round"/>
      <circle cx="${idealTopX.toFixed(1)}" cy="${(idealTopY - 4).toFixed(1)}" r="3" fill="${ghostColor}" opacity="0.4"/>
      <!-- User (actual trunk) -->
      <line x1="${cx}" y1="${legY}" x2="${actualTopX.toFixed(1)}" y2="${actualTopY.toFixed(1)}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="${actualTopX.toFixed(1)}" cy="${(actualTopY - 4).toFixed(1)}" r="3.5" fill="${color}"/>
      <!-- Angle label -->
      <text x="30" y="76" text-anchor="middle" fill="${color}" font-size="9" font-weight="600">${Math.round(actualAngle)}&deg;</text>
    </svg>`;
  }
}

/**
 * Get the average actual angle for a dimension from analysis reps.
 * Returns null if no angle data makes sense for this dimension.
 */
function getActualAngleForDimension(label: string, analysis: SetAnalysis): number | null {
  if (analysis.reps.length === 0) return null;

  switch (label) {
    case 'Depth':
    case 'How Deep You Went': {
      const angles = analysis.reps.map(r => r.minKneeAngle).filter((a): a is number => a != null);
      return angles.length > 0 ? angles.reduce((s, v) => s + v, 0) / angles.length : null;
    }
    case 'Torso Position':
    case 'Upper Body Position':
    case 'Back Position': {
      const angles = analysis.reps.map(r => r.maxTrunkAngle).filter((a): a is number => a != null);
      return angles.length > 0 ? angles.reduce((s, v) => s + v, 0) / angles.length : null;
    }
    default:
      return null;
  }
}

/** Map a camelCase dimension key to a human-readable label. */
function dimensionKeyToLabel(key: string): string {
  const DIMENSION_KEY_LABELS: Record<string, string> = {
    depth: 'Depth', kneeTracking: 'Knee Tracking', trunk: 'Torso Position',
    symmetry: 'Symmetry', tempo: 'Tempo', lockout: 'Lockout',
    backPosition: 'Back Position', hipHinge: 'Hip Hinge', control: 'Control',
    rom: 'Range of Motion', pause: 'Pause', overheadStability: 'Overhead Stability',
    pressPath: 'Press Path', rowRom: 'Row ROM', torsoStability: 'Torso Stability',
    balance: 'Balance',
  };
  return DIMENSION_KEY_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
}

export function renderScoreBreakdown(analysis: SetAnalysis): void {
  const container = $('score-breakdown');

  // Use semantic dimensions if available, otherwise legacy fields
  const hasDimensions = analysis.reps.length > 0 && analysis.reps[0].dimensions != null;
  let avgScores: { label: string; score: number }[];

  if (hasDimensions) {
    const dimKeys = Object.keys(analysis.reps[0].dimensions!);
    avgScores = dimKeys
      .filter(k => !(analysis.competitionMode && k === 'tempo'))
      .map(k => {
        const avg = analysis.reps.reduce((s, r) => s + (r.dimensions?.[k] ?? 0), 0) / analysis.reps.length;
        return { label: dimensionKeyToLabel(k), score: Math.round(avg) };
      });
  } else {
    type ScoreKey = 'depthScore' | 'kneeTrackingScore' | 'trunkScore' | 'symmetryScore' | 'tempoScore' | 'lockoutScore';
    const dims: { label: string; key: ScoreKey }[] = [
      { label: 'Depth', key: 'depthScore' },
      { label: 'Knee Tracking', key: 'kneeTrackingScore' },
      { label: 'Torso Position', key: 'trunkScore' },
      { label: 'Balance', key: 'symmetryScore' },
      ...(analysis.competitionMode ? [] : [{ label: 'Control', key: 'tempoScore' as ScoreKey }]),
      { label: 'Lockout', key: 'lockoutScore' },
    ];
    avgScores = dims.map((d) => {
      if (analysis.reps.length === 0) return { label: d.label, score: 0 };
      const avg = analysis.reps.reduce((s, r) => s + (r[d.key] as number), 0) / analysis.reps.length;
      return { label: d.label, score: Math.round(avg) };
    });
  }

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
      ? `<div class="confidence-note">${escapeHtml(noteText)}</div>`
      : '';
    const displayLabel = isBegExp ? (BEGINNER_DIMENSION_LABELS[label] ?? label) : label;

    // B1: Generate angle comparison SVG for applicable dimensions
    let angleSvg = '';
    const idealAngle = IDEAL_ANGLES[label] ?? IDEAL_ANGLES[displayLabel];
    if (idealAngle != null) {
      const actualAngle = getActualAngleForDimension(label, analysis);
      if (actualAngle != null) {
        angleSvg = renderAngleComparison(idealAngle, actualAngle, displayLabel);
      }
    }

    html += `
      <div class="score-bar-row">
        <span class="score-bar-label">${escapeHtml(displayLabel)}</span>
        <div class="score-bar-track" role="progressbar" aria-valuenow="${score}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(label)} score: ${score} out of 100, ${level}${noteText ? '. ' + noteText : ''}">
          <div class="score-bar-fill" style="width: ${score}%; background: ${color}"></div>
        </div>
        <span class="score-bar-value" style="color: ${color}">${score}</span>
        <span class="score-bar-level" style="color: ${color}">${level}</span>
        ${angleSvg}
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
      issueLabelsHtml += `<span class="issue-indicator" style="color: ${sColor};" title="${escapeHtml(displayName)} (${severityLabel})"><span class="issue-dot" style="background: ${sColor}" aria-hidden="true"></span>${escapeHtml(shortName)}<span class="issue-severity-text">(${severityLabel})</span></span>`;
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
    <div class="sticking-point-indicator sticking-indicator" title="${escapeHtml(sp.description)}">
      <div class="sticking-bar-container">
        <div class="sticking-bar">
          <div class="sticking-marker" style="bottom: ${pct}%;" aria-hidden="true"></div>
        </div>
        <span class="sticking-label">Stick ${pct}%</span>
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
    <div class="bar-path-display" title="Bar path: ${barPath.pathEfficiency}% efficient, ${(barPath.lateralDrift * 100).toFixed(1)}cm drift">
      <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Bar path visualization">
        <line x1="${midX}" y1="${padding}" x2="${midX}" y2="${height - padding}" stroke="var(--border, #333)" stroke-width="0.5" stroke-dasharray="2,2" />
        <polyline points="${points.join(' ')}" fill="none" stroke="${driftColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <div class="bar-path-drift-label">${(barPath.lateralDrift * 100).toFixed(0)}% drift</div>
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
    grindWarning = `<span class="grind-warning">Grinding</span>`;
  }

  return `
    <div class="rep-tempo-info">
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
  container.className = 'card card--static velocity-chart-card';

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
    <div class="velocity-data-grid" style="grid-template-columns: repeat(${velocities.length}, 1fr);">
      ${analysis.reps.map((r, i) => {
        const v = r.velocity;
        const rpe = rpeLabels[i] || '';
        const velColor = i === 0 ? 'var(--success)' : i === velocities.length - 1 ? (velocityLoss > 30 ? 'var(--danger)' : 'var(--accent)') : 'var(--text-secondary)';
        return `<div>
          <div class="velocity-rep-label">R${i + 1}</div>
          <div style="color: ${velColor};" title="Mean ascent angular velocity">${v?.meanAscentVelocity ?? '-'}</div>
          <div class="velocity-rep-ratio" title="Ascent/descent ratio">${v ? v.ascentDescentRatio.toFixed(1) + 'x' : '-'}</div>
          ${rpe ? `<div class="velocity-rpe-est">${rpe}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
    <div class="velocity-footer">deg/s | ratio | est. RPE</div>
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
    rpeCompDiv.className = 'velocity-rpe-compare';
    rpeCompDiv.innerHTML = `
      <div>
        <span class="velocity-rpe-label">Your RPE:</span> <span class="velocity-rpe-value">${userRpe}</span>
        <span class="velocity-rpe-label velocity-rpe-separator">|</span>
        <span class="velocity-rpe-label">Estimated:</span> <span class="velocity-rpe-value">${estRpe}</span>
      </div>
      <div class="velocity-calibration" style="color: ${diffAbs <= 0.5 ? 'var(--success)' : 'var(--warning)'};">${calibrationNote}</div>
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
  badge.innerHTML = 'Competition Mode &mdash; IPF/USAPL Standards';

  // Insert at the very top of the scores panel
  scoresPanel.prepend(badge);
}

// ─── Competition Depth Judgment ───

export function renderCompetitionDepthJudgment(rep: RepScore, repIdx: number): string {
  // Use actual competition depth check if available, fall back to score proxy
  const depthPassed = rep.competitionDepthPass !== undefined ? rep.competitionDepthPass : rep.depthScore >= 80;

  if (depthPassed) {
    return `<div class="competition-judgment good-lift" aria-label="Good lift">
      <span class="judgment-text">GOOD LIFT</span>
    </div>`;
  } else {
    return `<div class="competition-judgment depth-call" aria-label="Depth call">
      <span class="judgment-text">DEPTH</span>
    </div>`;
  }
}

// ─── Re-analyze Button (G3) ───

function renderReanalyzeButton(): void {
  const existing = document.getElementById('reanalyze-section');
  if (existing) existing.remove();

  // Check if cached poses are available via the global hook
  const win = window as unknown as Record<string, unknown>;
  const hasCached = typeof win.__hasCachedPoses === 'function'
    && (win.__hasCachedPoses as () => boolean)();
  if (!hasCached) return;

  const scoresPanel = document.querySelector('.scores-panel');
  if (!scoresPanel) return;

  const container = document.createElement('div');
  container.id = 'reanalyze-section';
  container.style.cssText = 'text-align: center; margin: 0.75rem 0;';

  const btn = document.createElement('button');
  btn.className = 'btn btn-sm';
  btn.style.cssText = 'font-size: var(--font-xs, 0.75rem); background: var(--bg-input, #1e1e1e); border: 1px solid var(--accent, #00d4ff); color: var(--accent, #00d4ff);';
  btn.textContent = 'Re-analyze with Different Settings';
  btn.setAttribute('aria-label', 'Re-analyze the same video with different settings');

  btn.addEventListener('click', () => {
    // Scroll to settings panel and expand it
    const settingsContent = document.getElementById('settings-content');
    const showSettingsBtn = document.getElementById('show-settings-btn');
    if (settingsContent) settingsContent.style.display = 'block';
    if (showSettingsBtn) showSettingsBtn.textContent = 'Hide settings';
    settingsContent?.scrollIntoView({ behavior: 'smooth' });

    // Add a temporary "Run Re-analysis" button near settings
    const existingRunBtn = document.getElementById('reanalyze-run-btn');
    if (existingRunBtn) existingRunBtn.remove();

    const runBtn = document.createElement('button');
    runBtn.id = 'reanalyze-run-btn';
    runBtn.className = 'btn btn-primary';
    runBtn.style.cssText = 'margin-top: 0.5rem; width: 100%;';
    runBtn.textContent = 'Run Re-analysis (skip pose detection)';
    runBtn.addEventListener('click', () => {
      runBtn.remove();
      const reanalyze = (window as unknown as Record<string, unknown>).__reanalyzeWithCachedPoses as (() => Promise<void>) | undefined;
      if (reanalyze) reanalyze();
    });

    if (settingsContent) {
      settingsContent.appendChild(runBtn);
    }
  });

  container.appendChild(btn);
  scoresPanel.appendChild(container);
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
  section.className = 'share-buttons-row';

  section.innerHTML = `
    <button class="btn btn-sm share-btn" id="share-result-btn" aria-label="Share result image">Share Result</button>
    <button class="btn btn-sm share-btn" id="share-link-btn" aria-label="Copy shareable link">Share Link</button>
    <button class="btn btn-sm share-btn" id="save-image-btn" aria-label="Save result as image">Save Image</button>
    <button class="btn btn-sm share-btn" id="export-analysis-csv-btn" aria-label="Export this analysis as CSV">Export CSV</button>
    <button class="btn btn-sm share-btn" id="copy-report-btn" aria-label="Copy text report to clipboard">Copy Report</button>
    <button class="btn btn-sm share-btn" id="print-report-btn" aria-label="Print or save report as PDF">Print Report</button>
  `;

  scoresPanel.appendChild(section);

  // Share Result (Web Share API on mobile, fallback to download)
  document.getElementById('share-result-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('share-result-btn');
    if (btn) btn.textContent = 'Generating...';
    try {
      const blob = await generateShareCard(analysis, 'story');
      const file = new File([blob], 'form-score.png', { type: 'image/png' });

      // Try Web Share API (mobile)
      if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
        const shareData = { files: [file], title: `Lift Form: ${analysis.grade} (${analysis.overallScore}/100)` };
        if (navigator.canShare(shareData)) {
          await navigator.share(shareData);
          if (btn) { btn.textContent = 'Shared!'; setTimeout(() => { btn.textContent = 'Share Result'; }, 2000); }
          return;
        }
      }

      // Fallback: download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `form-score-${analysis.grade}-${analysis.overallScore}.png`;
      a.click();
      URL.revokeObjectURL(url);
      if (btn) { btn.textContent = 'Saved!'; setTimeout(() => { btn.textContent = 'Share Result'; }, 2000); }
    } catch (err) {
      // User cancelled share or error
      if (btn) { btn.textContent = 'Share Result'; }
    }
  });

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

// ─── Beginner UX Styles ───

let _beginnerStylesInjected = false;

function injectBeginnerStyles(): void {
  if (_beginnerStylesInjected) return;
  _beginnerStylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .beginner-next-steps {
      text-align: center;
      padding: var(--space-lg, 1.5rem);
      margin: var(--space-md, 1rem) 0;
      border: 1px solid var(--accent, #00d4ff);
      background: var(--bg-card, #1a1a2e);
    }
    .beginner-next-steps .section-heading-sm {
      margin-bottom: var(--space-md, 1rem);
      color: var(--text-primary, #fff);
    }
    .beginner-next-steps-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-sm, 0.5rem);
      justify-content: center;
    }
    .beginner-next-steps-buttons .btn {
      min-width: 160px;
      padding: 0.625rem var(--space-lg, 1.5rem);
      font-size: var(--font-sm, 0.875rem);
    }
    .beginner-detailed-analysis {
      margin: var(--space-md, 1rem) 0;
    }
    .beginner-detailed-content {
      padding-top: var(--space-sm, 0.5rem);
    }
    .beginner-detailed-content > * {
      margin-bottom: var(--space-sm, 0.5rem);
    }
  `;
  document.head.appendChild(style);
}

// ─── Beginner "What to Do Next" CTA ───

function renderBeginnerNextSteps(): void {
  // Inject styles once
  injectBeginnerStyles();

  const section = $('results-section');
  const existing = document.getElementById('beginner-next-steps');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.id = 'beginner-next-steps';
  container.className = 'card card--static beginner-next-steps';

  const heading = document.createElement('h3');
  heading.className = 'section-heading-sm';
  heading.textContent = 'What to Do Next';
  container.appendChild(heading);

  const btnRow = document.createElement('div');
  btnRow.className = 'beginner-next-steps-buttons';

  // "Analyze Another Set" button
  const analyzeBtn = document.createElement('button');
  analyzeBtn.className = 'btn btn-primary';
  analyzeBtn.textContent = 'Analyze Another Set';
  analyzeBtn.setAttribute('aria-label', 'Upload and analyze another video');
  analyzeBtn.addEventListener('click', () => {
    const videoInput = document.getElementById('video-input') as HTMLInputElement | null;
    if (videoInput) videoInput.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // "Get a Training Program" button
  const programBtn = document.createElement('button');
  programBtn.className = 'btn btn-secondary';
  programBtn.textContent = 'Get a Training Program';
  programBtn.setAttribute('aria-label', 'Switch to the Training Program tab');
  programBtn.addEventListener('click', () => {
    const trainingTab = document.querySelector('[data-tab="workout"]') as HTMLElement | null;
    if (trainingTab) trainingTab.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // "Learn More" button expands collapsed detailed analysis
  const learnBtn = document.createElement('button');
  learnBtn.className = 'btn btn-secondary';
  learnBtn.textContent = 'Learn More';
  learnBtn.setAttribute('aria-label', 'Show detailed analysis breakdown');
  learnBtn.addEventListener('click', () => {
    const detailsEl = document.querySelector('#beginner-detailed-analysis details') as HTMLDetailsElement | null;
    if (detailsEl) {
      detailsEl.open = true;
      detailsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  btnRow.appendChild(analyzeBtn);
  btnRow.appendChild(programBtn);
  btnRow.appendChild(learnBtn);
  container.appendChild(btnRow);

  // Insert into scores panel
  const scoresPanel = section.querySelector('.scores-panel');
  if (scoresPanel) {
    scoresPanel.appendChild(container);
  } else {
    section.appendChild(container);
  }
}

// ─── Beginner Detailed Analysis Wrapper ───

/**
 * Wraps the focus section, mobility assessment, and warmup protocol
 * in a single collapsible "Detailed Analysis" block for beginners.
 */
function wrapBeginnerDetailedAnalysis(): void {
  const scoresPanel = document.querySelector('.scores-panel');
  if (!scoresPanel) return;

  const existingWrapper = document.getElementById('beginner-detailed-analysis');
  if (existingWrapper) existingWrapper.remove();

  // Gather the sections to wrap
  const sectionIds = ['focus-section', 'progress-insights', 'onerm-collapse', 'one-rm-section', 'mobility-collapse', 'mobility-section', 'warmup-section'];
  const elements: Element[] = [];
  for (const id of sectionIds) {
    const el = document.getElementById(id);
    if (el) elements.push(el);
  }

  if (elements.length === 0) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'beginner-detailed-analysis';
  wrapper.className = 'card card--static beginner-detailed-analysis';

  const details = document.createElement('details');
  details.setAttribute('aria-label', 'Detailed Analysis');

  const summary = document.createElement('summary');
  summary.className = 'collapsible-summary';
  summary.innerHTML = '<span class="collapse-chevron">&#9654;</span> Detailed Analysis';

  details.addEventListener('toggle', () => {
    const chevron = summary.querySelector('.collapse-chevron') as HTMLElement | null;
    if (chevron) {
      chevron.style.transform = details.open ? 'rotate(90deg)' : 'rotate(0deg)';
    }
  });

  const content = document.createElement('div');
  content.className = 'collapsible-content beginner-detailed-content';

  // Move collected elements into the collapsible
  for (const el of elements) {
    content.appendChild(el);
  }

  details.appendChild(summary);
  details.appendChild(content);
  wrapper.appendChild(details);

  // Insert before the beginner-full-report or share section
  const shareSection = document.getElementById('share-section');
  const fullReport = document.getElementById('beginner-full-report');
  const insertBefore = fullReport || shareSection;
  if (insertBefore && insertBefore.parentNode) {
    insertBefore.parentNode.insertBefore(wrapper, insertBefore);
  } else {
    scoresPanel.appendChild(wrapper);
  }
}

// ─── Beginner Full Report Toggle ───

function renderBeginnerFullReportToggle(analysis: SetAnalysis, fps: number, sessions: SessionRecord[]): void {
  const section = $('results-section');
  const existing = document.getElementById('beginner-full-report');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.id = 'beginner-full-report';
  container.className = 'beginner-full-report-toggle';

  const btn = document.createElement('button');
  btn.className = 'btn btn-secondary';
  btn.textContent = 'Show Full Detailed Report';

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
  container.className = 'milestone-banner gamification-section';

  container.innerHTML = badges.map(b =>
    `<div class="gamification-badge-item">&#127942; ${escapeHtml(b)}</div>`
  ).join('');

  // Insert after overall score
  const overallCard = document.getElementById('overall-score-card');
  if (overallCard?.nextSibling) {
    section.insertBefore(container, overallCard.nextSibling);
  } else {
    section.appendChild(container);
  }
}
