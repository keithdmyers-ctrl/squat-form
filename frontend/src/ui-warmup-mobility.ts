/**
 * Mobility assessment, warm-up protocol rendering, and warmup timer launcher.
 * Extracted from ui-results.ts for better module boundaries.
 */

import type { SetAnalysis, WarmUpStep } from './types';
import { escapeHtml } from './ui-utilities';
import { WarmupTimer, getStepDuration } from './warmup-timer';
import type { TimerState } from './warmup-timer';

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
  section.className = 'card card--static mobility-section';
  section.setAttribute('aria-label', 'Mobility assessment');

  let html = `
    <h3 class="mobility-heading">Mobility Assessment</h3>
    <p class="mobility-subheading">Based on your form, here are areas to work on</p>
  `;

  for (const f of findings) {
    html += `
      <div class="mobility-finding mobility-card mobility-finding-card">
        <div class="mobility-area-title">${escapeHtml(f.area)}</div>
        <p class="mobility-limitation">${escapeHtml(f.limitation)}</p>
        <details class="mobility-test-details">
          <summary class="mobility-test-summary">Self-test: Can you pass this?</summary>
          <p class="mobility-test-content">${escapeHtml(f.test)}</p>
        </details>
        <div>
          <strong class="mobility-rec-heading">Recommended:</strong>
          <ul class="mobility-stretch-list">
            ${f.stretches.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
          </ul>
          <p class="mobility-frequency">${escapeHtml(f.frequency)}</p>
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
  section.className = 'card card--static';
  section.setAttribute('aria-label', 'Recommended warm-up');

  let html = `
    <details>
      <summary class="warmup-summary">
        <span class="collapse-chevron">&#9654;</span>
        Recommended Warm-Up (~${totalMinutes} min)
      </summary>
      <div class="warmup-content">
  `;

  protocol.forEach((step, i) => {
    html += `
      <div class="warmup-step warmup-step-card">
        <div class="warmup-step-number">${i + 1}</div>
        <div class="warmup-step-flex">
          <div class="warmup-step-name-text">${escapeHtml(step.name)} <span class="warmup-step-duration">${escapeHtml(step.duration)}</span></div>
          <p class="warmup-step-desc-text">${escapeHtml(step.description)}</p>
        </div>
      </div>
    `;
  });

  html += `
      </div>
      <button id="start-warmup-btn" class="warmup-start-btn">
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

export function launchWarmupOverlay(protocol: WarmUpStep[]): void {
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
