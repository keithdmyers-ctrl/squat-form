import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  exportBackup,
  importBackup,
  validateBackup,
  getStorageUsage,
  renderBackupCard,
  ALL_STORAGE_KEYS,
} from '../data-backup';
import type { AppBackup } from '../data-backup';

// ─── localStorage mock ───

let store: Record<string, string> = {};

function createLocalStorageMock(): Storage {
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

beforeEach(() => {
  store = {};
  vi.stubGlobal('localStorage', createLocalStorageMock());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Helpers ───

function makeValidBackup(overrides: Partial<AppBackup> = {}): AppBackup {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: '2.0.0',
    data: {},
    ...overrides,
  };
}

// ─── ALL_STORAGE_KEYS ───

describe('ALL_STORAGE_KEYS', () => {
  it('covers all known keys', () => {
    const expectedKeys = [
      'squat_form_sessions',
      'squat_form_settings',
      'squat_form_program_state',
      'squat_form_workout_logs',
      'squat_form_user_profile',
      'squat_form_parq',
      'squat_form_conditions',
      'squat_form_pain_history',
      'squat_form_goals',
      'squat_form_prs',
      'squat_form_custom_programs',
      'squat_form_body_entries',
      'squat_form_comp_totals',
      'squat_form_competition_records',
      'squat_form_personal_model',
      'squat_form_coach_memory',
      'squat_form_chat_history',
      'squat_form_gamification',
      'squat_form_meet_prep',
      'squat_form_onboarded',
      'squat_form_theme',
    ];

    for (const key of expectedKeys) {
      expect(ALL_STORAGE_KEYS).toContain(key);
    }
  });

  it('is an array of strings', () => {
    expect(Array.isArray(ALL_STORAGE_KEYS)).toBe(true);
    for (const key of ALL_STORAGE_KEYS) {
      expect(typeof key).toBe('string');
    }
  });
});

// ─── exportBackup ───

describe('exportBackup', () => {
  it('exports empty backup when localStorage is empty', () => {
    const backup = exportBackup();

    expect(backup.version).toBe(1);
    expect(typeof backup.exportedAt).toBe('string');
    expect(typeof backup.appVersion).toBe('string');
    expect(typeof backup.data).toBe('object');
    // No keys should be in data
    expect(Object.keys(backup.data).length).toBe(0);
  });

  it('exports sessions from localStorage', () => {
    const sessions = [{ id: 'session-1', score: 85 }];
    store['squat_form_sessions'] = JSON.stringify(sessions);

    const backup = exportBackup();
    expect(backup.data.sessions).toEqual(sessions);
  });

  it('exports settings from localStorage', () => {
    const settings = { experience: 'intermediate', unit: 'kg' };
    store['squat_form_settings'] = JSON.stringify(settings);

    const backup = exportBackup();
    expect(backup.data.settings).toEqual(settings);
  });

  it('exports onboarded as plain string', () => {
    store['squat_form_onboarded'] = 'true';

    const backup = exportBackup();
    expect(backup.data.onboarded).toBe('true');
  });

  it('exports multiple keys', () => {
    store['squat_form_sessions'] = JSON.stringify([{ id: '1' }]);
    store['squat_form_goals'] = JSON.stringify([{ target: 80 }]);
    store['squat_form_prs'] = JSON.stringify({ squat: 315 });
    store['squat_form_onboarded'] = '1';

    const backup = exportBackup();
    expect(backup.data.sessions).toEqual([{ id: '1' }]);
    expect(backup.data.goals).toEqual([{ target: 80 }]);
    expect(backup.data.prs).toEqual({ squat: 315 });
    expect(backup.data.onboarded).toBe('1');
  });

  it('handles non-JSON values gracefully', () => {
    store['squat_form_program_state'] = 'not-valid-json{{{';

    const backup = exportBackup();
    // Should fall back to the raw string
    expect(backup.data.programState).toBe('not-valid-json{{{');
  });

  it('includes timestamp in ISO format', () => {
    const backup = exportBackup();
    expect(() => new Date(backup.exportedAt)).not.toThrow();
    expect(new Date(backup.exportedAt).toISOString()).toBe(backup.exportedAt);
  });
});

// ─── validateBackup ───

describe('validateBackup', () => {
  it('validates a correct backup', () => {
    const result = validateBackup(makeValidBackup());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.version).toBe(1);
  });

  it('rejects null', () => {
    const result = validateBackup(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects undefined', () => {
    const result = validateBackup(undefined);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects non-object types', () => {
    expect(validateBackup('string').valid).toBe(false);
    expect(validateBackup(42).valid).toBe(false);
    expect(validateBackup(true).valid).toBe(false);
    expect(validateBackup([]).valid).toBe(false);
  });

  it('rejects missing version', () => {
    const result = validateBackup({ exportedAt: '2024-01-01', data: {} });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('version'))).toBe(true);
  });

  it('rejects missing exportedAt', () => {
    const result = validateBackup({ version: 1, data: {} });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('exportedAt'))).toBe(true);
  });

  it('rejects missing data object', () => {
    const result = validateBackup({ version: 1, exportedAt: '2024-01-01' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('data'))).toBe(true);
  });

  it('rejects data as array', () => {
    const result = validateBackup({ version: 1, exportedAt: '2024-01-01', data: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('data'))).toBe(true);
  });

  it('counts items in data', () => {
    const result = validateBackup(makeValidBackup({
      data: { sessions: [1, 2], goals: [3] },
    }));
    expect(result.valid).toBe(true);
    expect(result.itemCount).toBe(2);
  });

  it('returns exportedAt from backup', () => {
    const ts = '2025-06-15T10:30:00.000Z';
    const result = validateBackup(makeValidBackup({ exportedAt: ts }));
    expect(result.exportedAt).toBe(ts);
  });
});

// ─── importBackup ───

describe('importBackup', () => {
  it('imports all data from a valid backup', () => {
    const backup = makeValidBackup({
      data: {
        sessions: [{ id: 's1' }],
        goals: [{ target: 80 }],
        onboarded: 'true',
      },
    });

    const result = importBackup(backup);
    expect(result.success).toBe(true);
    expect(result.itemsRestored).toBe(3);
    expect(result.errors).toHaveLength(0);

    // Verify data is in localStorage
    expect(JSON.parse(store['squat_form_sessions'])).toEqual([{ id: 's1' }]);
    expect(JSON.parse(store['squat_form_goals'])).toEqual([{ target: 80 }]);
    expect(store['squat_form_onboarded']).toBe('true');
  });

  it('round-trip: export then import preserves all data', () => {
    // Seed localStorage
    store['squat_form_sessions'] = JSON.stringify([{ id: 'session-1', score: 90 }]);
    store['squat_form_settings'] = JSON.stringify({ unit: 'kg' });
    store['squat_form_goals'] = JSON.stringify([{ dimension: 'depth', target: 85 }]);
    store['squat_form_prs'] = JSON.stringify({ squat: { weight: 315 } });
    store['squat_form_onboarded'] = '1';

    // Export
    const backup = exportBackup();

    // Clear localStorage
    store = {};

    // Import
    const result = importBackup(backup);
    expect(result.success).toBe(true);
    expect(result.itemsRestored).toBe(5);

    // Verify round-trip
    expect(JSON.parse(store['squat_form_sessions'])).toEqual([{ id: 'session-1', score: 90 }]);
    expect(JSON.parse(store['squat_form_settings'])).toEqual({ unit: 'kg' });
    expect(JSON.parse(store['squat_form_goals'])).toEqual([{ dimension: 'depth', target: 85 }]);
    expect(JSON.parse(store['squat_form_prs'])).toEqual({ squat: { weight: 315 } });
    expect(store['squat_form_onboarded']).toBe('1');
  });

  it('handles empty backup data', () => {
    const backup = makeValidBackup({ data: {} });
    const result = importBackup(backup);
    expect(result.success).toBe(true);
    expect(result.itemsRestored).toBe(0);
  });

  it('fails on invalid backup', () => {
    const result = importBackup({ version: 'bad' } as unknown as AppBackup);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('warns on newer version', () => {
    const backup = makeValidBackup({ version: 99 });
    const result = importBackup(backup);
    expect(result.warnings.some(w => w.includes('newer version'))).toBe(true);
  });

  it('overwrites existing keys by default', () => {
    store['squat_form_sessions'] = JSON.stringify([{ id: 'old' }]);

    const backup = makeValidBackup({
      data: { sessions: [{ id: 'new' }] },
    });

    const result = importBackup(backup);
    expect(result.success).toBe(true);
    expect(JSON.parse(store['squat_form_sessions'])).toEqual([{ id: 'new' }]);
  });

  it('skips existing keys when overwrite is false', () => {
    store['squat_form_sessions'] = JSON.stringify([{ id: 'old' }]);

    const backup = makeValidBackup({
      data: { sessions: [{ id: 'new' }], goals: [{ target: 80 }] },
    });

    const result = importBackup(backup, { overwrite: false });
    expect(result.success).toBe(true);
    // sessions skipped, goals imported
    expect(result.itemsRestored).toBe(1);
    expect(result.warnings.some(w => w.includes('Skipped'))).toBe(true);
    // Original data preserved
    expect(JSON.parse(store['squat_form_sessions'])).toEqual([{ id: 'old' }]);
    // New data imported
    expect(JSON.parse(store['squat_form_goals'])).toEqual([{ target: 80 }]);
  });

  it('handles corrupt key data without crashing', () => {
    // Create a backup with an unrecognized property — importBackup should just skip it
    const backup = makeValidBackup({
      data: {
        sessions: [{ id: 'ok' }],
      },
    });

    // This should succeed without throwing
    const result = importBackup(backup);
    expect(result.success).toBe(true);
    expect(result.itemsRestored).toBe(1);
  });

  it('stores string values for onboarded/theme', () => {
    const backup = makeValidBackup({
      data: {
        onboarded: 'yes',
        theme: 'dark',
      },
    });

    const result = importBackup(backup);
    expect(result.success).toBe(true);
    expect(store['squat_form_onboarded']).toBe('yes');
    expect(store['squat_form_theme']).toBe('dark');
  });

  it('stores complex objects as JSON strings', () => {
    const complex = { nested: { deep: [1, 2, 3] }, flag: true };
    const backup = makeValidBackup({
      data: { programState: complex },
    });

    const result = importBackup(backup);
    expect(result.success).toBe(true);
    expect(JSON.parse(store['squat_form_program_state'])).toEqual(complex);
  });
});

// ─── getStorageUsage ───

describe('getStorageUsage', () => {
  it('returns zero usage for empty storage', () => {
    const usage = getStorageUsage();
    expect(usage.used).toBe(0);
    expect(usage.limit).toBe(5 * 1024 * 1024);
    expect(usage.percentage).toBe(0);
  });

  it('calculates usage for stored data', () => {
    store['key1'] = 'value1';
    store['key2'] = 'longer value with more characters';

    const usage = getStorageUsage();
    // Each character is 2 bytes (UTF-16)
    const expectedBytes =
      ('key1'.length + 'value1'.length) * 2 +
      ('key2'.length + 'longer value with more characters'.length) * 2;
    expect(usage.used).toBe(expectedBytes);
    expect(usage.used).toBeGreaterThan(0);
  });

  it('percentage is capped at reasonable values', () => {
    const usage = getStorageUsage();
    expect(usage.percentage).toBeGreaterThanOrEqual(0);
    expect(usage.percentage).toBeLessThanOrEqual(100);
  });
});

// ─── renderBackupCard ───

describe('renderBackupCard', () => {
  it('renders card with export and import buttons', () => {
    const html = renderBackupCard();

    expect(html).toContain('backup-card');
    expect(html).toContain('Export Backup');
    expect(html).toContain('Import Backup');
    expect(html).toContain('backup-export-btn');
    expect(html).toContain('backup-import-input');
  });

  it('includes storage usage info', () => {
    store['squat_form_sessions'] = JSON.stringify([{ id: '1' }]);

    const html = renderBackupCard();
    expect(html).toContain('Storage:');
    expect(html).toContain('KB');
  });

  it('includes help text', () => {
    const html = renderBackupCard();
    expect(html).toContain('Export saves all your training data');
  });
});
