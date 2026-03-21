/**
 * Shared localStorage versioning and migration utilities.
 * Used by storage.ts and workout-storage.ts to version persisted data
 * and run migrations transparently on load.
 */

export interface VersionedData<T> {
  version: number;
  data: T;
  migratedAt?: string;
}

export type MigrationFn = (data: any) => any;

/**
 * Migrate stored data from its current version to the target version
 * by running migration functions sequentially.
 *
 * @param stored - The raw parsed JSON from localStorage
 * @param currentVersion - The target version to migrate to
 * @param migrations - Registry of migration functions keyed by source version
 * @returns The migrated data, whether migration occurred, and the original version
 */
export function migrateData<T>(
  stored: any,
  currentVersion: number,
  migrations: Record<number, MigrationFn>,
): { data: T; migrated: boolean; fromVersion: number } {
  const fromVersion = stored.version ?? 0;
  let version = fromVersion;
  let data = stored.version !== undefined ? stored.data : stored;

  while (version < currentVersion) {
    const migrate = migrations[version];
    if (migrate) {
      data = migrate(data);
    }
    version++;
  }

  return {
    data: data as T,
    migrated: version !== fromVersion || fromVersion !== currentVersion,
    fromVersion,
  };
}
