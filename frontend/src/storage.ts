/**
 * localStorage operations for session history and settings persistence.
 */

import type { SetAnalysis } from './types';
import type { SessionRecord } from './types';
import type { VersionedData, MigrationFn } from './storage-migration';
import { migrateData } from './storage-migration';

// ─── Storage Versioning ───

const SESSION_STORAGE_VERSION = 1;
const SETTINGS_STORAGE_VERSION = 1;

// ─── Migration Registries ───

const SESSION_MIGRATIONS: Record<number, MigrationFn> = {
  // version 0 -> 1: ensure each session has all expected fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  0: (data: any) => {
    if (Array.isArray(data)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data.map((session: any) => ({
        ...session,
        id: session.id ?? Date.now().toString(36) + Math.random().toString(36).slice(2),
        date: session.date ?? new Date().toISOString(),
        squat_type: session.squat_type ?? 'high_bar',
        experience_level: session.experience_level ?? 'beginner',
        rep_count: session.rep_count ?? 0,
        overall_score: session.overall_score ?? 0,
        grade: session.grade ?? 'N/A',
        top_issue: session.top_issue ?? null,
        positive_count: session.positive_count ?? 0,
        exercise_type: session.exercise_type ?? 'squat',
        exercise_variant: session.exercise_variant ?? undefined,
        competition: session.competition ?? false,
      }));
    }
    return data;
  },
};

const SETTINGS_MIGRATIONS: Record<number, MigrationFn> = {
  // version 0 -> 1: ensure all settings fields exist with defaults
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  0: (data: any) => ({
    ...data,
    squat_type: data.squat_type ?? 'high_bar',
    experience_level: data.experience_level ?? 'beginner',
    weight: data.weight ?? '',
    weight_unit: data.weight_unit ?? 'lbs',
    exercise_type: data.exercise_type ?? 'squat',
    deadlift_type: data.deadlift_type ?? 'conventional',
    bench_type: data.bench_type ?? 'flat',
    ohp_type: data.ohp_type ?? 'strict',
    row_type: data.row_type ?? 'bent_over',
    lunge_type: data.lunge_type ?? 'forward',
    bodyweight: data.bodyweight ?? '',
    bodyweight_unit: data.bodyweight_unit ?? 'lbs',
    rpe: data.rpe ?? '',
    training_phase: data.training_phase ?? '',
  }),
};

// ─── Storage Keys and Constants ───

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
  bodyweight?: number,
  bodyweightUnit?: string,
  rpe?: number,
  snapshots?: Array<{ dataUrl: string; phase: string; repIndex: number }>,
  dotsScore?: number,
  notes?: string,
  tags?: string[],
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
    bodyweight: bodyweight && bodyweight > 0 ? bodyweight : undefined,
    bodyweight_unit: bodyweightUnit,
    rpe: rpe && rpe >= 6 && rpe <= 10 ? rpe : undefined,
    snapshots: snapshots && snapshots.length > 0 ? snapshots : undefined,
    dots_score: dotsScore && dotsScore > 0 ? dotsScore : undefined,
    notes: notes || undefined,
    tags: tags && tags.length > 0 ? tags : undefined,
  });
  if (sessions.length > MAX_SESSIONS) sessions.length = MAX_SESSIONS;
  try {
    const wrapped: VersionedData<SessionRecord[]> = {
      version: SESSION_STORAGE_VERSION,
      data: sessions,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wrapped));
  } catch {
    // Storage quota exceeded -- strip snapshots and retry
    for (const s of sessions) {
      if (s.snapshots) delete s.snapshots;
    }
    try {
      const wrapped: VersionedData<SessionRecord[]> = {
        version: SESSION_STORAGE_VERSION,
        data: sessions,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(wrapped));
    } catch {
      // Still full -- show warning
      const warning = document.getElementById('storage-warning');
      if (warning) {
        warning.style.display = 'block';
      } else {
        document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' }));
      }
    }
  }
}

export function getSessions(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    const { data, migrated, fromVersion } = migrateData<SessionRecord[]>(
      parsed, SESSION_STORAGE_VERSION, SESSION_MIGRATIONS
    );

    if (migrated) {
      console.info(`Migrated session storage from v${fromVersion} to v${SESSION_STORAGE_VERSION}`);
      // Re-save in versioned format so migration only runs once
      try {
        const wrapped: VersionedData<SessionRecord[]> = {
          version: SESSION_STORAGE_VERSION,
          data,
          migratedAt: new Date().toISOString(),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(wrapped));
      } catch { /* ignore save failure during migration */ }
    }

    return data;
  } catch {
    return [];
  }
}

export function saveSettings(
  squatType: string, experienceLevel: string, weight?: string, weightUnit?: string,
  exerciseType?: string, deadliftType?: string, benchType?: string,
  bodyweight?: string, bodyweightUnit?: string, rpe?: string,
  ohpType?: string, rowType?: string, lungeType?: string,
  trainingPhase?: string,
): void {
  try {
    const settings = {
      squat_type: squatType,
      experience_level: experienceLevel,
      weight: weight ?? '',
      weight_unit: weightUnit ?? 'lbs',
      exercise_type: exerciseType ?? 'squat',
      deadlift_type: deadliftType ?? 'conventional',
      bench_type: benchType ?? 'flat',
      ohp_type: ohpType ?? 'strict',
      row_type: rowType ?? 'bent_over',
      lunge_type: lungeType ?? 'forward',
      bodyweight: bodyweight ?? '',
      bodyweight_unit: bodyweightUnit ?? 'lbs',
      rpe: rpe ?? '',
      training_phase: trainingPhase ?? '',
    };
    const wrapped: VersionedData<typeof settings> = {
      version: SETTINGS_STORAGE_VERSION,
      data: settings,
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(wrapped));
  } catch {
    document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' }));
  }
}

export function loadSettings(): {
  squat_type: string; experience_level: string; weight?: string; weight_unit?: string;
  exercise_type?: string; deadlift_type?: string; bench_type?: string; ohp_type?: string;
  row_type?: string; lunge_type?: string;
  bodyweight?: string; bodyweight_unit?: string; rpe?: string;
  training_phase?: string;
} | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const { data, migrated, fromVersion } = migrateData<ReturnType<typeof loadSettings> & object>(
      parsed, SETTINGS_STORAGE_VERSION, SETTINGS_MIGRATIONS
    );

    if (migrated) {
      console.info(`Migrated settings storage from v${fromVersion} to v${SETTINGS_STORAGE_VERSION}`);
      // Re-save in versioned format so migration only runs once
      try {
        const wrapped: VersionedData<typeof data> = {
          version: SETTINGS_STORAGE_VERSION,
          data,
          migratedAt: new Date().toISOString(),
        };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(wrapped));
      } catch { /* ignore save failure during migration */ }
    }

    return data;
  } catch {
    return null;
  }
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
    document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' }));
  }
}
