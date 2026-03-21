/**
 * Health data sync: Apple Health / Google Fit integration via Capacitor.
 *
 * All functions gracefully handle the plugin not being available.
 * In web-only mode (no Capacitor), functions return sensible defaults
 * or `false` so the rest of the app can function normally.
 *
 * Requires @nicejob/capacitor-health-connect (Android) or
 * @nicejob/capacitor-apple-health (iOS) — both optional.
 */

import { Capacitor } from '@capacitor/core';

// ─── Types ───

export interface HealthDataPoint {
  type: 'bodyweight' | 'body_fat' | 'heart_rate' | 'sleep_hours' | 'steps' | 'active_calories';
  value: number;
  unit: string;
  date: string;   // ISO-8601
  source: 'apple_health' | 'google_fit' | 'manual';
}

/** Opaque handle for a Capacitor health plugin. */
interface HealthPlugin {
  isAvailable?(): Promise<{ available: boolean }>;
  requestAuthorization?(options: unknown): Promise<{ authorized: boolean }>;
  queryQuantityData?(options: unknown): Promise<{ data: Array<{ value: number; date: string; unit?: string }> }>;
  querySleepData?(options: unknown): Promise<{ data: Array<{ value: number; date: string }> }>;
  saveWorkout?(options: unknown): Promise<{ saved: boolean }>;
}

// ─── Plugin Loader ───

/**
 * Dynamically import the health plugin for the current platform.
 * Returns null if no plugin is available (web, or plugin not installed).
 */
async function getHealthPlugin(): Promise<HealthPlugin | null> {
  if (!Capacitor.isNativePlatform()) return null;

  const platform = Capacitor.getPlatform();

  // Dynamic import paths are assigned to variables so TypeScript does not
  // attempt static module resolution for optional native-only plugins.
  try {
    if (platform === 'ios') {
      const pkgName = '@nicejob/capacitor-apple-health';
      const mod: Record<string, HealthPlugin> = await import(/* @vite-ignore */ pkgName);
      return mod.AppleHealth ?? null;
    }
    if (platform === 'android') {
      const pkgName = '@nicejob/capacitor-health-connect';
      const mod: Record<string, HealthPlugin> = await import(/* @vite-ignore */ pkgName);
      return mod.HealthConnect ?? null;
    }
  } catch {
    // Plugin not installed — that's expected on web builds
  }
  return null;
}

/**
 * Determine the health data source label based on the platform.
 */
function getSourceLabel(): HealthDataPoint['source'] {
  const platform = Capacitor.getPlatform();
  if (platform === 'ios') return 'apple_health';
  if (platform === 'android') return 'google_fit';
  return 'manual';
}

// ─── Public API ───

/**
 * Check if health data sync is available (requires Capacitor + native plugin).
 * Returns false on web-only deployments.
 */
export function isHealthSyncAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Request authorization to read/write health data.
 * Returns true if the user granted permission, false otherwise.
 */
export async function requestHealthAuthorization(): Promise<boolean> {
  const plugin = await getHealthPlugin();
  if (!plugin?.requestAuthorization) return false;

  try {
    const result = await plugin.requestAuthorization({
      read: ['bodyMass', 'bodyFatPercentage', 'heartRate', 'sleepAnalysis', 'stepCount', 'activeEnergyBurned'],
      write: ['workout'],
    });
    return result?.authorized ?? false;
  } catch {
    return false;
  }
}

/**
 * Read bodyweight history from the health platform.
 * Useful for auto-updating bodyweight in the app for DOTS/strength standards.
 */
export async function readBodyweightHistory(days: number): Promise<HealthDataPoint[]> {
  const plugin = await getHealthPlugin();
  if (!plugin?.queryQuantityData) return [];

  const source = getSourceLabel();
  const endDate = new Date().toISOString();
  const startDate = new Date(Date.now() - days * 86_400_000).toISOString();

  try {
    const result = await plugin.queryQuantityData({
      type: 'bodyMass',
      startDate,
      endDate,
      unit: 'kg',
    });

    return (result?.data ?? []).map((d) => ({
      type: 'bodyweight' as const,
      value: d.value,
      unit: d.unit ?? 'kg',
      date: d.date,
      source,
    }));
  } catch {
    return [];
  }
}

/**
 * Read sleep data for recovery/readiness integration.
 * Returns sleep hours per night.
 */
export async function readSleepData(days: number): Promise<HealthDataPoint[]> {
  const plugin = await getHealthPlugin();
  if (!plugin?.querySleepData) return [];

  const source = getSourceLabel();
  const endDate = new Date().toISOString();
  const startDate = new Date(Date.now() - days * 86_400_000).toISOString();

  try {
    const result = await plugin.querySleepData({
      startDate,
      endDate,
    });

    return (result?.data ?? []).map((d) => ({
      type: 'sleep_hours' as const,
      value: d.value,
      unit: 'hours',
      date: d.date,
      source,
    }));
  } catch {
    return [];
  }
}

/**
 * Write a workout summary to the health platform.
 */
export async function writeWorkoutToHealth(workout: {
  startDate: string;
  endDate: string;
  exerciseType: string;
  totalSets: number;
  caloriesEstimate?: number;
}): Promise<boolean> {
  const plugin = await getHealthPlugin();
  if (!plugin?.saveWorkout) return false;

  try {
    const result = await plugin.saveWorkout({
      activityType: 'traditionalStrengthTraining',
      startDate: workout.startDate,
      endDate: workout.endDate,
      energyBurned: workout.caloriesEstimate ?? estimateCalories(workout.totalSets),
      energyBurnedUnit: 'kcal',
      metadata: {
        exercise: workout.exerciseType,
        sets: workout.totalSets,
      },
    });
    return result?.saved ?? false;
  } catch {
    return false;
  }
}

/**
 * Rough calorie estimate for a strength session: ~6 kcal per set.
 * Reference: Haltom et al. (1999) — circuit resistance training expenditure.
 */
function estimateCalories(totalSets: number): number {
  return Math.round(totalSets * 6);
}

/**
 * Sync bodyweight from health platform into the app's body tracker.
 * Reads the most recent bodyweight entry and returns it.
 */
export async function syncBodyweight(): Promise<{
  synced: boolean;
  latestWeight?: number;
  unit?: string;
}> {
  const history = await readBodyweightHistory(30); // last 30 days
  if (history.length === 0) {
    return { synced: false };
  }

  // Sort by date descending and take the most recent
  const sorted = [...history].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  const latest = sorted[0];

  return {
    synced: true,
    latestWeight: latest.value,
    unit: latest.unit,
  };
}

/**
 * Get readiness data from health platform (sleep, HRV, resting HR).
 * Returns data compatible with the adaptation engine's ReadinessData format.
 */
export async function getHealthReadiness(): Promise<{
  sleepHours?: number;
  sleepQuality?: number;  // 1-5
  restingHR?: number;
  hrv?: number;
}> {
  const plugin = await getHealthPlugin();
  if (!plugin) return {};

  const result: {
    sleepHours?: number;
    sleepQuality?: number;
    restingHR?: number;
    hrv?: number;
  } = {};

  // Read last night's sleep
  try {
    const sleepData = await readSleepData(1);
    if (sleepData.length > 0) {
      result.sleepHours = sleepData[sleepData.length - 1].value;
      // Map sleep hours to 1-5 quality scale
      const hours = result.sleepHours;
      if (hours >= 8) result.sleepQuality = 5;
      else if (hours >= 7) result.sleepQuality = 4;
      else if (hours >= 6) result.sleepQuality = 3;
      else if (hours >= 5) result.sleepQuality = 2;
      else result.sleepQuality = 1;
    }
  } catch {
    // Sleep data not available
  }

  // Read resting heart rate (last 24h)
  if (plugin.queryQuantityData) {
    try {
      const hrResult = await plugin.queryQuantityData({
        type: 'restingHeartRate',
        startDate: new Date(Date.now() - 86_400_000).toISOString(),
        endDate: new Date().toISOString(),
        unit: 'bpm',
      });
      if (hrResult?.data?.length) {
        result.restingHR = hrResult.data[hrResult.data.length - 1].value;
      }
    } catch {
      // HR data not available
    }

    // Read HRV (last 24h)
    try {
      const hrvResult = await plugin.queryQuantityData({
        type: 'heartRateVariabilitySDNN',
        startDate: new Date(Date.now() - 86_400_000).toISOString(),
        endDate: new Date().toISOString(),
        unit: 'ms',
      });
      if (hrvResult?.data?.length) {
        result.hrv = hrvResult.data[hrvResult.data.length - 1].value;
      }
    } catch {
      // HRV data not available
    }
  }

  return result;
}

// ─── UI Rendering ───

/**
 * Render a health sync status card for the settings / profile area.
 */
export function renderHealthSyncCard(): string {
  if (!isHealthSyncAvailable()) {
    return `<div class="health-sync-card unavailable">
      <h4>Health Sync</h4>
      <p>Health data sync is available on the iOS and Android apps.
         Install the native app to sync with Apple Health or Google Fit.</p>
    </div>`;
  }

  const platform = Capacitor.getPlatform();
  const serviceName = platform === 'ios' ? 'Apple Health' : 'Google Fit';

  return `<div class="health-sync-card available">
    <h4>Health Sync</h4>
    <p>Connect to ${serviceName} to sync bodyweight, sleep, and workout data.</p>
    <button class="btn btn-sm btn-primary health-authorize-btn"
            onclick="window.__healthAuthorize?.()">
      Connect ${serviceName}
    </button>
    <button class="btn btn-sm btn-outline health-sync-weight-btn"
            onclick="window.__healthSyncWeight?.()">
      Sync Bodyweight
    </button>
  </div>`;
}

/**
 * Render a compact health status line (for the workout view).
 */
export function renderHealthStatus(): string {
  if (!isHealthSyncAvailable()) {
    return '';
  }

  const platform = Capacitor.getPlatform();
  const serviceName = platform === 'ios' ? 'Apple Health' : 'Google Fit';

  return `<div class="health-status">
    <span class="health-status-dot"></span>
    <span class="health-status-label">${serviceName}</span>
  </div>`;
}
