/**
 * Progress display: loading bars, error messages, skeleton loading state.
 */

import { escapeHtml, $ } from './ui-utilities';

// ─── Progress Display ───

let startTime: number | null = null;

function formatEta(seconds: number): string {
  if (seconds < 10) return 'almost done';
  if (seconds >= 60) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `~${mins}m ${secs}s remaining`;
  }
  return `~${Math.round(seconds)}s remaining`;
}

export function showProgress(percent: number, status: string): void {
  const section = $('progress-section');
  section.style.display = 'block';

  const bar = $('progress-bar') as HTMLElement;
  bar.style.width = `${percent}%`;

  // Update aria-valuenow for accessibility
  const track = bar.parentElement;
  if (track) {
    track.setAttribute('aria-valuenow', String(percent));
  }

  ($('progress-percent') as HTMLElement).textContent = `${percent}%`;
  ($('progress-status') as HTMLElement).textContent = status;

  // Track timing and display ETA
  const etaEl = document.getElementById('progress-eta');
  if (percent > 0 && startTime === null) {
    startTime = Date.now();
  }

  if (etaEl) {
    if (percent >= 15 && percent < 100 && startTime !== null) {
      const elapsedMs = Date.now() - startTime;
      const elapsedSec = elapsedMs / 1000;
      const totalEstSec = (elapsedSec / percent) * 100;
      const remainingSec = totalEstSec - elapsedSec;
      etaEl.textContent = formatEta(remainingSec);
    } else if (percent >= 100) {
      etaEl.textContent = '';
    } else {
      etaEl.textContent = '';
    }
  }
}

export function hideProgress(): void {
  ($('progress-section') as HTMLElement).style.display = 'none';
  startTime = null;
  const etaEl = document.getElementById('progress-eta');
  if (etaEl) etaEl.textContent = '';
}

export function showError(message: string): void {
  const section = $('error-section');
  section.style.display = 'block';
  ($('error-message') as HTMLElement).textContent = message;
}

/** Show a styled error card with action buttons. */
export function showErrorCard(
  message: string,
  errorType: 'no_poses' | 'no_reps' | 'generic',
  onTryAgain: () => void,
  onSecondary: (() => void) | null,
  secondaryLabel?: string,
): void {
  const section = $('error-section');
  section.style.display = 'block';

  const container = $('error-message');

  let icon = '!';
  let title = 'Something went wrong';
  let tips = '';
  if (errorType === 'no_poses') {
    title = 'No body detected';
    icon = '?';
    tips = `<ul class="error-tips">
      <li>Make sure your <strong>full body</strong> is visible (head to feet)</li>
      <li>Film from the <strong>side</strong> for best results</li>
      <li>Ensure good lighting -- avoid backlighting</li>
      <li>Try standing 6-10 feet from the camera</li>
    </ul>`;
  } else if (errorType === 'no_reps') {
    title = 'No reps detected';
    icon = '?';
    tips = `<ul class="error-tips">
      <li>Complete <strong>full reps</strong>: stand, squat down, stand back up</li>
      <li>Stand still for 1-2 seconds before your first rep</li>
      <li>Make sure knees are visible throughout the movement</li>
      <li>Video should be at least 3 seconds long</li>
    </ul>`;
  }

  const btnLabel = secondaryLabel ?? 'Adjust Settings';
  const secondaryBtnHtml = onSecondary !== null
    ? `<button class="btn error-adjust" aria-label="${escapeHtml(btnLabel)}" style="background: var(--bg-input, #1e1e1e); color: var(--text-primary, #e0e0e0); border: 1px solid var(--border, #333333);">${escapeHtml(btnLabel)}</button>`
    : '';

  container.innerHTML = `
    <div class="error-card-content" role="alert" aria-label="Error: ${escapeHtml(title)}">
      <div class="error-icon" aria-hidden="true">${escapeHtml(icon)}</div>
      <div class="error-title">${escapeHtml(title)}</div>
      <div class="error-detail">${escapeHtml(message)}</div>
      ${tips}
      <div class="error-actions">
        <button class="btn btn-primary error-try-again" aria-label="Try again with a different video">Try Again</button>
        ${secondaryBtnHtml}
      </div>
    </div>
  `;

  const tryAgainBtn = container.querySelector('.error-try-again');
  const adjustBtn = container.querySelector('.error-adjust');

  if (tryAgainBtn) {
    tryAgainBtn.addEventListener('click', () => {
      hideError();
      onTryAgain();
    });
  }

  if (adjustBtn && onSecondary) {
    adjustBtn.addEventListener('click', () => {
      hideError();
      onSecondary();
    });
  }
}

export function hideError(): void {
  ($('error-section') as HTMLElement).style.display = 'none';
}

// ─── Validation Warnings ───

/** Show a visible warning banner above the progress bar for video validation issues. */
export function showValidationWarning(message: string): void {
  const section = document.getElementById('progress-section');
  if (!section) return;

  const warning = document.createElement('div');
  warning.className = 'validation-warning';
  warning.setAttribute('role', 'alert');
  warning.textContent = message;
  section.insertBefore(warning, section.firstChild);
}

/** Remove all validation warning banners. */
export function hideValidationWarnings(): void {
  const warnings = document.querySelectorAll('.validation-warning');
  for (const w of warnings) w.remove();
}

// ─── Skeleton Loading State ───

export function showSkeletonLoading(): void {
  const resultsSection = document.getElementById('results-section');
  if (!resultsSection) return;

  // Remove existing skeleton
  hideSkeletonLoading();

  resultsSection.style.display = 'block';

  const skeleton = document.createElement('div');
  skeleton.id = 'skeleton-loading';
  skeleton.className = 'skeleton-results';
  skeleton.setAttribute('aria-label', 'Loading results');
  skeleton.innerHTML = `
    <div class="skeleton-score-circle skeleton-pulse"></div>
    <div class="skeleton-bar skeleton-pulse" style="width: 80%"></div>
    <div class="skeleton-bar skeleton-pulse" style="width: 60%"></div>
    <div class="skeleton-bar skeleton-pulse" style="width: 90%"></div>
    <div class="skeleton-bar skeleton-pulse" style="width: 70%"></div>
  `;

  // Insert at the top of results
  resultsSection.prepend(skeleton);
}

export function hideSkeletonLoading(): void {
  const skeleton = document.getElementById('skeleton-loading');
  if (skeleton) skeleton.remove();
}
