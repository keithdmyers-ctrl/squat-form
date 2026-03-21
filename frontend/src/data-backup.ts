/**
 * Full state backup and restore for the Lift Coach app.
 * Exports all localStorage data as a portable JSON file and
 * provides import with validation.
 */

// ─── Interfaces ───

export interface AppBackup {
  version: number;
  exportedAt: string;
  appVersion: string;
  data: {
    sessions?: unknown;
    settings?: unknown;
    programState?: unknown;
    workoutLogs?: unknown;
    userProfile?: unknown;
    parq?: unknown;
    conditions?: unknown;
    painHistory?: unknown;
    goals?: unknown;
    prs?: unknown;
    customPrograms?: unknown;
    bodyEntries?: unknown;
    compTotals?: unknown;
    competitionRecords?: unknown;
    personalModel?: unknown;
    coachMemory?: unknown;
    chatHistory?: unknown;
    gamification?: unknown;
    meetPrep?: unknown;
    onboarded?: string;
    theme?: string;
  };
}

export interface ImportResult {
  success: boolean;
  itemsRestored: number;
  errors: string[];
  warnings: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  version?: number;
  exportedAt?: string;
  itemCount?: number;
}

export interface StorageUsage {
  used: number;
  limit: number;
  percentage: number;
}

// ─── Constants ───

/** Current backup format version */
const BACKUP_VERSION = 1;

/** App version identifier */
const APP_VERSION = '2.0.0';

/**
 * Mapping from AppBackup data keys to localStorage keys.
 * This is the single source of truth for all storage keys the app uses.
 */
const KEY_MAP: Record<string, string> = {
  sessions: 'squat_form_sessions',
  settings: 'squat_form_settings',
  programState: 'squat_form_program_state',
  workoutLogs: 'squat_form_workout_logs',
  userProfile: 'squat_form_user_profile',
  parq: 'squat_form_parq',
  conditions: 'squat_form_conditions',
  painHistory: 'squat_form_pain_history',
  goals: 'squat_form_goals',
  prs: 'squat_form_prs',
  customPrograms: 'squat_form_custom_programs',
  bodyEntries: 'squat_form_body_entries',
  compTotals: 'squat_form_comp_totals',
  competitionRecords: 'squat_form_competition_records',
  personalModel: 'squat_form_personal_model',
  coachMemory: 'squat_form_coach_memory',
  chatHistory: 'squat_form_chat_history',
  gamification: 'squat_form_gamification',
  meetPrep: 'squat_form_meet_prep',
  onboarded: 'squat_form_onboarded',
  theme: 'squat_form_theme',
};

/** All localStorage keys used by the app */
export const ALL_STORAGE_KEYS: string[] = Object.values(KEY_MAP);

// ─── Export ───

/**
 * Export all app data as a JSON backup.
 */
export function exportBackup(): AppBackup {
  const data: AppBackup['data'] = {};

  for (const [prop, storageKey] of Object.entries(KEY_MAP)) {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) continue;

    // For onboarded/theme, store as plain strings
    if (prop === 'onboarded' || prop === 'theme') {
      (data as Record<string, unknown>)[prop] = raw;
      continue;
    }

    // Try to parse as JSON; fall back to raw string
    try {
      (data as Record<string, unknown>)[prop] = JSON.parse(raw);
    } catch {
      (data as Record<string, unknown>)[prop] = raw;
    }
  }

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    data,
  };
}

// ─── Validation ───

/**
 * Validate a backup file before importing.
 */
export function validateBackup(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (data === null || data === undefined) {
    return { valid: false, errors: ['Backup data is null or undefined'] };
  }

  if (typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, errors: ['Backup must be a JSON object'] };
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.version !== 'number') {
    errors.push('Missing or invalid "version" field (must be a number)');
  }

  if (typeof obj.exportedAt !== 'string') {
    errors.push('Missing or invalid "exportedAt" field (must be a string)');
  }

  if (obj.data === undefined || obj.data === null || typeof obj.data !== 'object' || Array.isArray(obj.data)) {
    errors.push('Missing or invalid "data" field (must be an object)');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const dataObj = obj.data as Record<string, unknown>;
  const itemCount = Object.keys(dataObj).filter(k => dataObj[k] !== undefined && dataObj[k] !== null).length;

  return {
    valid: true,
    errors: [],
    version: obj.version as number,
    exportedAt: obj.exportedAt as string,
    itemCount,
  };
}

// ─── Import ───

/**
 * Import a backup, restoring all app data.
 * Returns a summary of what was restored.
 */
export function importBackup(
  backup: AppBackup,
  options?: { overwrite?: boolean },
): ImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let itemsRestored = 0;

  // Validate first
  const validation = validateBackup(backup);
  if (!validation.valid) {
    return { success: false, itemsRestored: 0, errors: validation.errors, warnings };
  }

  // Version check
  if (backup.version > BACKUP_VERSION) {
    warnings.push(
      `Backup is from a newer version (v${backup.version} vs current v${BACKUP_VERSION}). Some data may not be recognized.`
    );
  }

  const shouldOverwrite = options?.overwrite ?? true;

  for (const [prop, storageKey] of Object.entries(KEY_MAP)) {
    const value = (backup.data as Record<string, unknown>)[prop];
    if (value === undefined || value === null) continue;

    // Check if key already exists
    if (!shouldOverwrite && localStorage.getItem(storageKey) !== null) {
      warnings.push(`Skipped "${storageKey}" — already exists (overwrite disabled)`);
      continue;
    }

    try {
      // Plain strings for onboarded/theme, JSON-serialize everything else
      if (typeof value === 'string') {
        localStorage.setItem(storageKey, value);
      } else {
        localStorage.setItem(storageKey, JSON.stringify(value));
      }
      itemsRestored++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to restore "${storageKey}": ${message}`);
    }
  }

  return {
    success: errors.length === 0,
    itemsRestored,
    errors,
    warnings,
  };
}

// ─── Download ───

/**
 * Trigger a file download of the backup as JSON.
 */
export function downloadBackup(): void {
  const backup = exportBackup();
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `lift-coach-backup-${dateStr}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  // Cleanup
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

// ─── Storage Usage ───

/**
 * Get the total localStorage usage in bytes.
 */
export function getStorageUsage(): StorageUsage {
  let used = 0;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      const value = localStorage.getItem(key);
      // Each character is 2 bytes in UTF-16 (JavaScript string encoding)
      used += (key.length + (value?.length ?? 0)) * 2;
    }
  }

  // Most browsers limit localStorage to 5 MB (5,242,880 bytes)
  const limit = 5 * 1024 * 1024;
  const percentage = limit > 0 ? Math.round((used / limit) * 100) : 0;

  return { used, limit, percentage };
}

// ─── HTML Rendering ───

/**
 * Render a backup/restore card with export and import buttons.
 */
export function renderBackupCard(): string {
  const usage = getStorageUsage();
  const usedKB = (usage.used / 1024).toFixed(1);
  const limitKB = (usage.limit / 1024).toFixed(0);

  return `<div class="backup-card">
  <h4>Data Backup &amp; Restore</h4>
  <p class="backup-usage">Storage: ${usedKB} KB / ${limitKB} KB (${usage.percentage}%)</p>
  <div class="backup-actions">
    <button class="btn backup-export-btn" id="backup-export-btn" type="button">
      Export Backup
    </button>
    <label class="btn backup-import-btn" for="backup-import-input">
      Import Backup
      <input type="file" id="backup-import-input" accept=".json" style="display:none" />
    </label>
  </div>
  <p class="backup-hint">Export saves all your training data, settings, and programs as a JSON file.</p>
</div>`;
}
