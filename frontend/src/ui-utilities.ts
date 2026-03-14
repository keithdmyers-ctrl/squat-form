/**
 * UI utility functions: DOM helpers, color functions, formatting.
 */

import type { IssueSeverity } from './types';

// ─── Colors (canvas-only, for 2D context drawing where CSS vars don't work) ───
export const CANVAS_COLORS = {
  accent: '#4cc9f0',
  line: 'rgba(76, 201, 240, 0.6)',
  lineHighlight: 'rgba(239, 71, 111, 0.8)',
  text: '#e8e8e8',
  green: '#4ade80',
  yellow: '#fbbf24',
  orange: '#fb923c',
  red: '#f87171',
};

// ─── Issue Display Names (plain English, matched to backend) ───
export const ISSUE_DISPLAY_NAMES: Record<string, string> = {
  insufficient_depth: 'Not Deep Enough',
  knee_valgus: 'Knees Caving In',
  butt_wink: 'Hips Tucking Under',
  excessive_forward_lean: 'Too Much Forward Lean',
  good_morning: 'Hips Rising First',
  heel_rise: 'Heels Coming Up',
  fast_descent: 'Dropping Too Fast',
  bouncing: 'Bouncing at Bottom',
  asymmetric_shift: 'Shifting to One Side',
  asymmetric_hips: 'Shifting to One Side',
  incomplete_lockout: 'Not Fully Standing Up',
  trunk_angle_increase_on_ascent: 'Hips Rising First',
  excessive_forward_knee: 'Knees Too Far Forward',
  excessive_forward_knee_travel: 'Knees Too Far Forward',
  side_view_limitation: 'Limited Knee View',
  limited_knee_tracking: 'Limited Knee View',
  slow_descent: 'Descending Too Slowly',
  // Deadlift-specific
  rounded_back: 'Back Rounding',
  hip_shoot: 'Hips Rising First',
  hitching: 'Hitching',
  insufficient_rom: 'Not Enough Range',
  asymmetric_pull: 'Shifting to One Side',
  // Bench press-specific
  no_pause: 'No Pause on Chest',
  uneven_press: 'Uneven Press',
  press_stall: 'Press Stalling',
};

// ─── DOM Helpers ───

/** Escape dynamic text for safe interpolation into innerHTML. */
export function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el;
}

export function scoreColor(score: number): string {
  if (score >= 90) return 'var(--grade-a)';
  if (score >= 80) return 'var(--grade-b)';
  if (score >= 70) return 'var(--warning)';
  if (score >= 60) return 'var(--orange)';
  return 'var(--grade-kw)';
}

export function severityColor(severity: IssueSeverity): string {
  switch (severity) {
    case 'high':
      return 'var(--danger)';
    case 'moderate':
      return 'var(--orange)';
    case 'low':
      return 'var(--warning)';
  }
}

/** Severity color for canvas 2D context (hardcoded hex, CSS vars don't work in canvas). */
export function severityColorCanvas(severity: IssueSeverity): string {
  switch (severity) {
    case 'high':
      return CANVAS_COLORS.red;
    case 'moderate':
      return CANVAS_COLORS.orange;
    case 'low':
      return CANVAS_COLORS.yellow;
  }
}

export function gradeColor(grade: string): string {
  switch (grade) {
    case 'A':
      return 'var(--grade-a)';
    case 'B':
      return 'var(--grade-b)';
    case 'C':
      return 'var(--grade-c)';
    case 'D':
      return 'var(--grade-d)';
    case 'Keep Working':
      return 'var(--grade-kw)';
    default:
      return 'var(--grade-kw)';
  }
}

export function formatIssueName(name: string): string {
  // Check display names map first, then fall back to title case
  if (ISSUE_DISPLAY_NAMES[name]) return ISSUE_DISPLAY_NAMES[name];
  return name
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Get short display name for issue indicators. */
export function formatShortIssueName(name: string): string {
  const shortNames: Record<string, string> = {
    insufficient_depth: 'Depth',
    knee_valgus: 'Knee',
    excessive_forward_lean: 'Lean',
    good_morning: 'GM',
    butt_wink: 'Wink',
    heel_rise: 'Heel',
    fast_descent: 'Fast',
    slow_descent: 'Slow',
    incomplete_lockout: 'Lock',
    asymmetric_hips: 'Asym',
    trunk_angle_increase_on_ascent: 'Trunk',
    limited_knee_tracking: 'Side',
    bouncing: 'Bounce',
    asymmetric_shift: 'Asym',
    excessive_forward_knee_travel: 'Knee',
    // Deadlift
    rounded_back: 'Back',
    hip_shoot: 'Hips',
    hitching: 'Hitch',
    insufficient_rom: 'ROM',
    asymmetric_pull: 'Asym',
    // Bench
    no_pause: 'Pause',
    uneven_press: 'Uneven',
    press_stall: 'Stall',
  };
  return shortNames[name] ?? name.split('_')[0] ?? '';
}

export function formatShortDate(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return isoDate.slice(0, 10);
  }
}
