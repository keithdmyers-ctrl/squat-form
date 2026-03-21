/**
 * Workout analytics UI: training calendar and muscle volume tracker cards.
 * Extracted from ui-workout.ts for modularity.
 */

import { escapeHtml } from './ui-utilities';
import type { buildCalendarMonth, calculateStreak } from './workout-calendar';
import type { calculateWeeklyVolume, getUndertrainedMuscles, getOvertrainedMuscles } from './volume-tracker';

// ─── Calendar Card ───

export function renderCalendarCard(
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

export function renderVolumeCard(
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
