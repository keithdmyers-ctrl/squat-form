/**
 * Body tracking: bodyweight, measurements, and progress photos over time.
 * Uses localStorage for measurements and IndexedDB for photos (too large for localStorage).
 *
 * Tracks:
 * - Bodyweight (daily/weekly entries)
 * - Body measurements (arms, chest, waist, hips, thighs, neck)
 * - Progress photos (front/side/back, stored as compressed blobs in IndexedDB)
 * - Strength metrics (e1RM per lift from PR tracker)
 */

// ─── Types ───

export interface BodyEntry {
  id: string;
  date: string; // YYYY-MM-DD
  bodyweight?: number;
  bodyweightUnit?: string;
  /** Measurements in cm or inches */
  measurements?: {
    neck?: number;
    chest?: number;
    waist?: number;
    hips?: number;
    leftArm?: number;
    rightArm?: number;
    leftThigh?: number;
    rightThigh?: number;
  };
  measurementUnit?: 'cm' | 'in';
  notes?: string;
}

export interface ProgressPhoto {
  id: string;
  date: string;
  pose: 'front' | 'side' | 'back';
  /** Stored as data URL (compressed JPEG) */
  dataUrl: string;
}

// ─── Storage ───

const BODY_ENTRIES_KEY = 'squat_form_body_entries';
const PROGRESS_PHOTOS_KEY = 'squat_form_progress_photos';
const PHOTO_COUNT_KEY = 'squat_form_photo_count';

// ─── IndexedDB for Progress Photos ───

const PHOTOS_DB_NAME = 'lift_coach_photos';
const PHOTOS_STORE_NAME = 'progress_photos';

function openPhotoDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PHOTOS_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PHOTOS_STORE_NAME)) {
        db.createObjectStore(PHOTOS_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function loadBodyEntries(): BodyEntry[] {
  try {
    return JSON.parse(localStorage.getItem(BODY_ENTRIES_KEY) ?? '[]');
  } catch { return []; }
}

export function saveBodyEntries(entries: BodyEntry[]): void {
  try {
    // Keep last 365 entries max
    if (entries.length > 365) entries.length = 365;
    localStorage.setItem(BODY_ENTRIES_KEY, JSON.stringify(entries));
  } catch {
    document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' }));
  }
}

export function addBodyEntry(entry: Omit<BodyEntry, 'id'>): BodyEntry {
  const entries = loadBodyEntries();
  const fullEntry: BodyEntry = {
    ...entry,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  };

  // Replace existing entry for the same date if it exists
  const existingIdx = entries.findIndex(e => e.date === entry.date);
  if (existingIdx >= 0) {
    entries[existingIdx] = fullEntry;
  } else {
    entries.unshift(fullEntry);
  }

  // Sort by date descending (most recent first)
  entries.sort((a, b) => b.date.localeCompare(a.date));
  saveBodyEntries(entries);
  return fullEntry;
}

export function getLatestBodyweight(): { weight: number; unit: string; date: string } | null {
  const entries = loadBodyEntries();
  const withBW = entries.find(e => e.bodyweight && e.bodyweight > 0);
  if (!withBW || !withBW.bodyweight) return null;
  return { weight: withBW.bodyweight, unit: withBW.bodyweightUnit ?? 'lbs', date: withBW.date };
}

/**
 * Get bodyweight trend for charting.
 */
export function getBodyweightTrend(maxEntries: number = 30): Array<{ date: string; weight: number }> {
  const entries = loadBodyEntries();
  return entries
    .filter(e => e.bodyweight && e.bodyweight > 0)
    .slice(0, maxEntries)
    .map(e => ({ date: e.date, weight: e.bodyweight! }))
    .reverse(); // chronological order
}

/**
 * Get measurement trend for a specific measurement.
 */
export function getMeasurementTrend(
  measurement: keyof NonNullable<BodyEntry['measurements']>,
  maxEntries: number = 20,
): Array<{ date: string; value: number }> {
  const entries = loadBodyEntries();
  return entries
    .filter(e => e.measurements?.[measurement] != null)
    .slice(0, maxEntries)
    .map(e => ({ date: e.date, value: e.measurements![measurement]! }))
    .reverse();
}

// ─── Progress Photos (IndexedDB primary, localStorage fallback) ───

export async function loadProgressPhotos(): Promise<ProgressPhoto[]> {
  try {
    const db = await openPhotoDB();
    return new Promise((resolve) => {
      const tx = db.transaction(PHOTOS_STORE_NAME, 'readonly');
      const store = tx.objectStore(PHOTOS_STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const photos = (request.result ?? []) as ProgressPhoto[];
        // Sort by date descending (most recent first)
        photos.sort((a, b) => b.date.localeCompare(a.date));
        resolve(photos);
      };
      request.onerror = () => resolve([]);
    });
  } catch {
    // Fallback to localStorage
    try { return JSON.parse(localStorage.getItem(PROGRESS_PHOTOS_KEY) ?? '[]'); } catch { return []; }
  }
}

export async function saveProgressPhoto(photo: Omit<ProgressPhoto, 'id'>): Promise<boolean> {
  const fullPhoto: ProgressPhoto = {
    ...photo,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  };
  try {
    const db = await openPhotoDB();
    return new Promise((resolve) => {
      const tx = db.transaction(PHOTOS_STORE_NAME, 'readwrite');
      const store = tx.objectStore(PHOTOS_STORE_NAME);
      store.put(fullPhoto);
      tx.oncomplete = () => {
        // Increment photo count in localStorage for quick summary access
        const count = getPhotoCount() + 1;
        try { localStorage.setItem(PHOTO_COUNT_KEY, count.toString()); } catch { document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' })); }
        resolve(true);
      };
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/** Get photo count from localStorage (fast, no IndexedDB needed). */
export function getPhotoCount(): number {
  try { return parseInt(localStorage.getItem(PHOTO_COUNT_KEY) ?? '0', 10); } catch { return 0; }
}

/**
 * Compress an image file to a JPEG data URL at reduced resolution.
 * Targets ~100KB per image for localStorage efficiency.
 */
export function compressPhoto(file: File, maxWidth: number = 600): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, maxWidth / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;

        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas not supported')); return; }

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6); // 60% quality
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Get photos grouped by date for comparison view.
 */
export async function getPhotosByDate(): Promise<Record<string, ProgressPhoto[]>> {
  const photos = await loadProgressPhotos();
  const grouped: Record<string, ProgressPhoto[]> = {};
  for (const photo of photos) {
    if (!grouped[photo.date]) grouped[photo.date] = [];
    grouped[photo.date].push(photo);
  }
  return grouped;
}

// ─── Combined Progress Summary ───

export interface ProgressSummary {
  bodyweight: { current?: number; change30d?: number; unit: string };
  measurements: Record<string, { current?: number; change30d?: number }>;
  photoCount: number;
  latestPhotoDate?: string;
}

/**
 * Get a summary of body tracking progress.
 */
export function getProgressSummary(): ProgressSummary {
  const entries = loadBodyEntries();

  // Bodyweight
  const bwEntries = entries.filter(e => e.bodyweight && e.bodyweight > 0);
  const currentBW = bwEntries[0]?.bodyweight;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const oldBW = bwEntries.find(e => e.date <= thirtyDaysAgo)?.bodyweight;
  const bwChange = currentBW && oldBW ? Math.round((currentBW - oldBW) * 10) / 10 : undefined;

  // Measurements
  const measurementKeys = ['neck', 'chest', 'waist', 'hips', 'leftArm', 'rightArm', 'leftThigh', 'rightThigh'] as const;
  const measurements: Record<string, { current?: number; change30d?: number }> = {};

  for (const key of measurementKeys) {
    const mEntries = entries.filter(e => e.measurements?.[key] != null);
    const current = mEntries[0]?.measurements?.[key];
    const old = mEntries.find(e => e.date <= thirtyDaysAgo)?.measurements?.[key];
    measurements[key] = {
      current,
      change30d: current && old ? Math.round((current - old) * 10) / 10 : undefined,
    };
  }

  return {
    bodyweight: {
      current: currentBW,
      change30d: bwChange,
      unit: bwEntries[0]?.bodyweightUnit ?? 'lbs',
    },
    measurements,
    photoCount: getPhotoCount(),
    latestPhotoDate: undefined, // Photo dates are now in IndexedDB; use loadProgressPhotos() for date info
  };
}

// ─── Storage Usage Warning ───

/**
 * Get localStorage usage as a percentage of the estimated 5MB limit.
 */
export function getStorageUsagePercent(): number {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) total += (localStorage.getItem(key) ?? '').length;
    }
    // Most browsers allow 5-10MB. Use 5MB as conservative estimate.
    return Math.round((total / (5 * 1024 * 1024)) * 100);
  } catch { return 0; }
}
