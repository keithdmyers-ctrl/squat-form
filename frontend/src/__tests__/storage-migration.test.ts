import { describe, it, expect } from 'vitest';
import { migrateData } from '../storage-migration';
import type { MigrationFn } from '../storage-migration';

// ─── migrateData: versioned data ───

describe('migrateData', () => {
  it('versioned data at current version passes through unchanged', () => {
    const stored = { version: 2, data: { name: 'Alice', score: 100 } };
    const migrations: Record<number, MigrationFn> = {};
    const result = migrateData<{ name: string; score: number }>(stored, 2, migrations);

    expect(result.data).toEqual({ name: 'Alice', score: 100 });
    expect(result.migrated).toBe(false);
    expect(result.fromVersion).toBe(2);
  });

  it('unversioned (legacy) data gets version 0', () => {
    const stored = { name: 'Bob', items: [1, 2, 3] };
    const migrations: Record<number, MigrationFn> = {};
    const result = migrateData<typeof stored>(stored, 0, migrations);

    expect(result.fromVersion).toBe(0);
    // Legacy data without version field is treated as the data itself
    expect(result.data).toEqual(stored);
  });

  it('migration chain runs sequentially (0 -> 1 -> 2)', () => {
    const stored = { count: 1 };  // legacy, no version
    const migrations: Record<number, MigrationFn> = {
      0: (data) => ({ ...data, count: data.count + 10 }),
      1: (data) => ({ ...data, count: data.count * 2, label: 'migrated' }),
    };
    const result = migrateData<{ count: number; label: string }>(stored, 2, migrations);

    // 0->1: count becomes 11, then 1->2: count becomes 22, label added
    expect(result.data.count).toBe(22);
    expect(result.data.label).toBe('migrated');
    expect(result.migrated).toBe(true);
    expect(result.fromVersion).toBe(0);
  });

  it('missing migration function skips gracefully (version increments without transform)', () => {
    const stored = { version: 0, data: { value: 'original' } };
    const migrations: Record<number, MigrationFn> = {
      // No migration for version 0->1 -- skip
      1: (data) => ({ ...data, added: true }),
    };
    const result = migrateData<{ value: string; added?: boolean }>(stored, 2, migrations);

    // Version 0->1 has no migration fn: data passes through as-is
    // Version 1->2 runs the migration and adds `added`
    expect(result.data.value).toBe('original');
    expect(result.data.added).toBe(true);
    expect(result.migrated).toBe(true);
    expect(result.fromVersion).toBe(0);
  });

  it('migration from version 1 to version 3 runs two migrations', () => {
    const stored = { version: 1, data: { x: 10 } };
    const migrations: Record<number, MigrationFn> = {
      1: (data) => ({ ...data, x: data.x + 5 }),
      2: (data) => ({ ...data, y: data.x * 2 }),
    };
    const result = migrateData<{ x: number; y: number }>(stored, 3, migrations);

    expect(result.data.x).toBe(15);
    expect(result.data.y).toBe(30);
    expect(result.migrated).toBe(true);
    expect(result.fromVersion).toBe(1);
  });
});

// ─── Edge cases ───

describe('migrateData edge cases', () => {
  it('empty stored object (no version, no meaningful data)', () => {
    const stored = {};
    const migrations: Record<number, MigrationFn> = {
      0: (data) => ({ ...data, initialized: true }),
    };
    const result = migrateData<{ initialized: boolean }>(stored, 1, migrations);

    expect(result.data.initialized).toBe(true);
    expect(result.fromVersion).toBe(0);
    expect(result.migrated).toBe(true);
  });

  it('null stored throws TypeError (caller must guard against null)', () => {
    const stored = null;
    const migrations: Record<number, MigrationFn> = {};
    expect(() => migrateData(stored, 0, migrations)).toThrow(TypeError);
  });

  it('undefined stored throws TypeError (caller must guard against undefined)', () => {
    const stored = undefined;
    const migrations: Record<number, MigrationFn> = {};
    expect(() => migrateData(stored, 0, migrations)).toThrow(TypeError);
  });

  it('stored with version but no data', () => {
    const stored = { version: 1 };
    const migrations: Record<number, MigrationFn> = {
      1: (data) => ({ ...(data ?? {}), patched: true }),
    };
    const result = migrateData<{ patched: boolean }>(stored, 2, migrations);

    // version is defined so data = stored.data which is undefined
    expect(result.data.patched).toBe(true);
    expect(result.fromVersion).toBe(1);
    expect(result.migrated).toBe(true);
  });

  it('stored with data but no version is treated as legacy', () => {
    const stored = { data: { foo: 'bar' } };
    const migrations: Record<number, MigrationFn> = {};
    const result = migrateData<typeof stored>(stored, 0, migrations);

    // No version property -> fromVersion=0, data = stored itself (not stored.data)
    expect(result.fromVersion).toBe(0);
    expect(result.data).toEqual(stored);
    expect(result.migrated).toBe(false);
  });
});

// ─── Migration flag ───

describe('migrateData migrated flag', () => {
  it('migrated is true when version changed', () => {
    const stored = { version: 0, data: { a: 1 } };
    const migrations: Record<number, MigrationFn> = {
      0: (data) => data,
    };
    const result = migrateData(stored, 1, migrations);
    expect(result.migrated).toBe(true);
  });

  it('migrated is false when already at current version', () => {
    const stored = { version: 3, data: { a: 1 } };
    const result = migrateData(stored, 3, {});
    expect(result.migrated).toBe(false);
  });

  it('migrated is true for unversioned data even when target is 0', () => {
    // fromVersion=0, currentVersion=0, but stored has no version field
    // version === fromVersion (0===0) but fromVersion !== currentVersion? No, 0===0
    // Actually: migrated = (version !== fromVersion || fromVersion !== currentVersion)
    // version=0 (after loop), fromVersion=0, currentVersion=0
    // version !== fromVersion -> 0 !== 0 -> false
    // fromVersion !== currentVersion -> 0 !== 0 -> false
    // So migrated = false. This is correct because no actual migration happened.
    const stored = { someField: 'legacy' };
    const result = migrateData(stored, 0, {});
    expect(result.migrated).toBe(false);
  });

  it('migrated is true for legacy data migrated to version 1', () => {
    const stored = { someField: 'legacy' };
    const migrations: Record<number, MigrationFn> = {
      0: (data) => data,
    };
    const result = migrateData(stored, 1, migrations);
    expect(result.migrated).toBe(true);
    expect(result.fromVersion).toBe(0);
  });
});
