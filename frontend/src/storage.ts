/**
 * localStorage operations for session history and settings persistence.
 */

import type { SetAnalysis } from './types';
import type { SessionRecord } from './types';

export const STORAGE_KEY = 'squat_form_sessions';
export const SETTINGS_KEY = 'squat_form_settings';
export const ONBOARDED_KEY = 'squat_form_onboarded';
export const PRESCREEN_KEY = 'squat_form_prescreen';
export const MAX_SESSIONS = 50;

export function saveSession(
  analysis: SetAnalysis,
  squatType: string,
  experienceLevel: string,
  weight?: number,
  weightUnit?: string,
  estimated1rm?: number,
  exerciseType?: string,
  exerciseVariant?: string,
): void {
  const sessions = getSessions();

  // Compute per-dimension averages for comparison feature
  const reps = analysis.reps;
  const avg = (key: 'depthScore' | 'kneeTrackingScore' | 'trunkScore' | 'symmetryScore' | 'tempoScore' | 'lockoutScore') =>
    reps.length > 0 ? Math.round(reps.reduce((s, r) => s + r[key], 0) / reps.length) : undefined;

  sessions.unshift({
    id: (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2),
    date: new Date().toISOString(),
    squat_type: squatType,
    experience_level: experienceLevel,
    rep_count: analysis.repCount,
    overall_score: analysis.overallScore,
    grade: analysis.grade,
    top_issue: analysis.topIssues[0]?.name ?? null,
    positive_count: analysis.positiveHighlights.length,
    exercise_type: exerciseType ?? 'squat',
    exercise_variant: exerciseVariant,
    weight: weight && weight > 0 ? weight : undefined,
    weight_unit: weightUnit,
    rep_scores: reps.map(r => r.overallScore),
    avg_depth: avg('depthScore'),
    avg_knee_tracking: avg('kneeTrackingScore'),
    avg_trunk: avg('trunkScore'),
    avg_symmetry: avg('symmetryScore'),
    avg_tempo: avg('tempoScore'),
    avg_lockout: avg('lockoutScore'),
    estimated_1rm: estimated1rm,
  });
  if (sessions.length > MAX_SESSIONS) sessions.length = MAX_SESSIONS;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Show a non-blocking warning
    const warning = document.getElementById('storage-warning');
    if (warning) {
      warning.style.display = 'block';
    } else {
      console.warn('Session could not be saved: storage quota exceeded');
    }
  }
}

export function getSessions(): SessionRecord[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

export function saveSettings(
  squatType: string, experienceLevel: string, weight?: string, weightUnit?: string,
  exerciseType?: string, deadliftType?: string, benchType?: string,
): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      squat_type: squatType,
      experience_level: experienceLevel,
      weight: weight ?? '',
      weight_unit: weightUnit ?? 'lbs',
      exercise_type: exerciseType ?? 'squat',
      deadlift_type: deadliftType ?? 'conventional',
      bench_type: benchType ?? 'flat',
    }));
  } catch {
    // localStorage full -- silently continue
  }
}

export function loadSettings(): {
  squat_type: string; experience_level: string; weight?: string; weight_unit?: string;
  exercise_type?: string; deadlift_type?: string; bench_type?: string;
} | null {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
  } catch { return null; }
}

export function hasCompletedPrescreen(): boolean {
  try {
    return localStorage.getItem(PRESCREEN_KEY) === '1';
  } catch { return false; }
}

export function savePrescreen(): void {
  try {
    localStorage.setItem(PRESCREEN_KEY, '1');
  } catch {
    // localStorage full -- silently continue
  }
}
