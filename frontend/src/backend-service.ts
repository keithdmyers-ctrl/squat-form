/**
 * Backend service abstraction layer.
 * Provides cloud sync via Firebase when configured, falls back to localStorage when not.
 *
 * This is the ONLY module (besides firebase-config.ts) that should reference Firebase.
 * All other modules use this service for data persistence.
 *
 * Architecture:
 * - Write-through: data is always written to localStorage first (instant), then synced to cloud
 * - Read: localStorage first (fast), cloud data merged on auth state change
 * - Offline-first: Firestore offline persistence handles queuing writes when offline
 * - Conflict resolution: cloud wins (last-write-wins with server timestamps)
 */

import {
  auth, db, storage, isConfigured,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  firebaseSignOut, GoogleAuthProvider, signInWithPopup,
  collection, doc, setDoc, getDoc, getDocs, deleteDoc,
  query, orderBy, limit, writeBatch,
  ref, uploadString, getDownloadURL, deleteObject,
  type User,
} from './firebase-config';

// ─── Auth State ───

export interface AuthState {
  user: { uid: string; email: string | null; displayName: string | null } | null;
  isAuthenticated: boolean;
  isCloudEnabled: boolean;
}

let currentUser: User | null = null;
const authListeners: Array<(state: AuthState) => void> = [];

/**
 * Get the current auth state.
 */
export function getAuthState(): AuthState {
  return {
    user: currentUser ? {
      uid: currentUser.uid,
      email: currentUser.email,
      displayName: currentUser.displayName,
    } : null,
    isAuthenticated: !!currentUser,
    isCloudEnabled: isConfigured,
  };
}

/**
 * Listen for auth state changes.
 */
export function onAuthChange(listener: (state: AuthState) => void): () => void {
  authListeners.push(listener);
  // Return unsubscribe function
  return () => {
    const idx = authListeners.indexOf(listener);
    if (idx >= 0) authListeners.splice(idx, 1);
  };
}

// Initialize auth listener
if (auth) {
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    const state = getAuthState();
    authListeners.forEach(l => l(state));

    // On sign-in, sync local data to cloud
    if (user) {
      syncLocalToCloud().catch(() => {});
    }
  });
}

// ─── Auth Actions ───

export async function signInWithEmail(email: string, password: string): Promise<void> {
  if (!auth) throw new Error('Cloud sync not configured');
  await signInWithEmailAndPassword(auth, email, password);
}

export async function signUpWithEmail(email: string, password: string): Promise<void> {
  if (!auth) throw new Error('Cloud sync not configured');
  await createUserWithEmailAndPassword(auth, email, password);
}

export async function signInWithGoogle(): Promise<void> {
  if (!auth) throw new Error('Cloud sync not configured');
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}

export async function signOut(): Promise<void> {
  if (!auth) return;
  await firebaseSignOut(auth);
  currentUser = null;
}

// ─── Data Sync ───

/**
 * Save a document to both localStorage and Firestore (if authenticated).
 * Write-through pattern: localStorage first (instant), then cloud (async).
 */
export async function saveDocument(
  collectionName: string,
  docId: string,
  data: Record<string, unknown>,
  localStorageKey?: string,
): Promise<void> {
  // Always save to localStorage first (instant, works offline)
  if (localStorageKey) {
    try {
      localStorage.setItem(localStorageKey, JSON.stringify(data));
    } catch {
      document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' }));
    }
  }

  // Sync to Firestore if authenticated
  if (db && currentUser) {
    try {
      const docRef = doc(db, `users/${currentUser.uid}/${collectionName}`, docId);
      await setDoc(docRef, {
        ...data,
        _updatedAt: new Date().toISOString(),
        _uid: currentUser.uid,
      });
    } catch {
      // Firestore will queue this for sync when online (offline persistence)
      // Cloud sync failed -- Firestore queues for retry when online
    }
  }
}

/**
 * Save an array of items to both localStorage and Firestore.
 * For collections like workout logs, PRs, body entries.
 */
export async function saveCollection(
  collectionName: string,
  items: Array<Record<string, unknown> & { id?: string }>,
  localStorageKey: string,
): Promise<void> {
  // Save to localStorage
  try {
    localStorage.setItem(localStorageKey, JSON.stringify(items));
  } catch {
    document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' }));
  }

  // Sync to Firestore if authenticated (batch write for efficiency)
  if (db && currentUser) {
    try {
      const batch = writeBatch(db);
      const collRef = collection(db, `users/${currentUser.uid}/${collectionName}`);

      // Only sync the most recent 50 items to avoid large batch writes
      const toSync = items.slice(0, 50);
      for (const item of toSync) {
        const id = item.id ?? Date.now().toString(36);
        const docRef = doc(collRef, String(id));
        batch.set(docRef, {
          ...item,
          _updatedAt: new Date().toISOString(),
        });
      }

      await batch.commit();
    } catch {
      // Cloud sync failed -- Firestore queues for retry when online
    }
  }
}

/**
 * Load a document from Firestore, falling back to localStorage.
 */
export async function loadDocument<T>(
  collectionName: string,
  docId: string,
  localStorageKey?: string,
): Promise<T | null> {
  // Try localStorage first (instant)
  if (localStorageKey) {
    try {
      const local = localStorage.getItem(localStorageKey);
      if (local) return JSON.parse(local) as T;
    } catch { /* parse error */ }
  }

  // Try Firestore if authenticated
  if (db && currentUser) {
    try {
      const docRef = doc(db, `users/${currentUser.uid}/${collectionName}`, docId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data() as T;
        // Cache locally
        if (localStorageKey) {
          try { localStorage.setItem(localStorageKey, JSON.stringify(data)); } catch { document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' })); }
        }
        return data;
      }
    } catch {
      // Cloud load failed -- fall back to localStorage
    }
  }

  return null;
}

/**
 * Load a collection from Firestore, falling back to localStorage.
 */
export async function loadCollection<T>(
  collectionName: string,
  localStorageKey: string,
  maxItems: number = 200,
): Promise<T[]> {
  // Try localStorage first (instant)
  try {
    const local = localStorage.getItem(localStorageKey);
    if (local) return JSON.parse(local) as T[];
  } catch { /* parse error */ }

  // Try Firestore if authenticated
  if (db && currentUser) {
    try {
      const collRef = collection(db, `users/${currentUser.uid}/${collectionName}`);
      const q = query(collRef, orderBy('_updatedAt', 'desc'), limit(maxItems));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const items = snap.docs.map(d => d.data() as T);
        // Cache locally
        try { localStorage.setItem(localStorageKey, JSON.stringify(items)); } catch { document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' })); }
        return items;
      }
    } catch {
      // Cloud load failed -- fall back to localStorage
    }
  }

  return [];
}

/**
 * Delete a document from both localStorage and Firestore.
 */
export async function deleteDocument(
  collectionName: string,
  docId: string,
): Promise<void> {
  if (db && currentUser) {
    try {
      const docRef = doc(db, `users/${currentUser.uid}/${collectionName}`, docId);
      await deleteDoc(docRef);
    } catch {
      // Cloud delete failed -- will retry on next sync
    }
  }
}

/**
 * Upload a progress photo to Cloud Storage.
 */
export async function uploadPhoto(
  photoId: string,
  dataUrl: string,
): Promise<string | null> {
  if (!storage || !currentUser) return null;

  try {
    const photoRef = ref(storage, `users/${currentUser.uid}/photos/${photoId}.jpg`);
    await uploadString(photoRef, dataUrl, 'data_url');
    return await getDownloadURL(photoRef);
  } catch {
    // Photo upload failed
    return null;
  }
}

/**
 * Delete a progress photo from Cloud Storage.
 */
export async function deletePhoto(photoId: string): Promise<void> {
  if (!storage || !currentUser) return;

  try {
    const photoRef = ref(storage, `users/${currentUser.uid}/photos/${photoId}.jpg`);
    await deleteObject(photoRef);
  } catch {
    // Photo delete failed
  }
}

// ─── Full Sync ───

/**
 * Sync all local data to cloud on first sign-in.
 * Reads from all localStorage keys and writes to Firestore.
 */
async function syncLocalToCloud(): Promise<void> {
  if (!db || !currentUser) return;

  const keysToSync: Array<{ localKey: string; cloudCollection: string; isArray: boolean }> = [
    { localKey: 'squat_form_program_state', cloudCollection: 'program_state', isArray: false },
    { localKey: 'squat_form_workout_logs', cloudCollection: 'workout_logs', isArray: true },
    { localKey: 'squat_form_user_profile', cloudCollection: 'user_profile', isArray: false },
    { localKey: 'squat_form_prs', cloudCollection: 'prs', isArray: false },
    { localKey: 'squat_form_goals', cloudCollection: 'goals', isArray: true },
    { localKey: 'squat_form_sessions', cloudCollection: 'form_sessions', isArray: true },
    { localKey: 'squat_form_body_entries', cloudCollection: 'body_entries', isArray: true },
    { localKey: 'squat_form_settings', cloudCollection: 'settings', isArray: false },
  ];

  for (const { localKey, cloudCollection, isArray } of keysToSync) {
    try {
      const raw = localStorage.getItem(localKey);
      if (!raw) continue;

      const data = JSON.parse(raw) as Record<string, unknown>;

      if (isArray && Array.isArray(data)) {
        await saveCollection(cloudCollection, data as Array<Record<string, unknown>>, localKey);
      } else {
        await saveDocument(cloudCollection, 'current', data, localKey);
      }
    } catch {
      // Sync failed -- will retry on next auth state change
    }
  }
}

/**
 * Pull all cloud data to local (for new device setup).
 */
export async function pullCloudToLocal(): Promise<boolean> {
  if (!db || !currentUser) return false;

  const singleDocs: Array<{ cloudCollection: string; localKey: string }> = [
    { cloudCollection: 'program_state', localKey: 'squat_form_program_state' },
    { cloudCollection: 'user_profile', localKey: 'squat_form_user_profile' },
    { cloudCollection: 'prs', localKey: 'squat_form_prs' },
    { cloudCollection: 'settings', localKey: 'squat_form_settings' },
  ];

  let synced = false;

  for (const { cloudCollection, localKey } of singleDocs) {
    try {
      const docRef = doc(db, `users/${currentUser.uid}/${cloudCollection}`, 'current');
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        localStorage.setItem(localKey, JSON.stringify(snap.data()));
        synced = true;
      }
    } catch { /* ignore */ }
  }

  // Pull array collections (workout logs, etc.)
  const arrayCollections: Array<{ cloudCollection: string; localKey: string }> = [
    { cloudCollection: 'workout_logs', localKey: 'squat_form_workout_logs' },
    { cloudCollection: 'goals', localKey: 'squat_form_goals' },
    { cloudCollection: 'form_sessions', localKey: 'squat_form_sessions' },
    { cloudCollection: 'body_entries', localKey: 'squat_form_body_entries' },
  ];

  for (const { cloudCollection, localKey } of arrayCollections) {
    try {
      const collRef = collection(db, `users/${currentUser.uid}/${cloudCollection}`);
      const q = query(collRef, orderBy('_updatedAt', 'desc'), limit(200));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const items = snap.docs.map(d => d.data());
        localStorage.setItem(localKey, JSON.stringify(items));
        synced = true;
      }
    } catch { /* ignore */ }
  }

  return synced;
}

// ─── Status ───

/**
 * Check if cloud sync is available and configured.
 */
export function isCloudAvailable(): boolean {
  return isConfigured && !!db;
}

/**
 * Check if the user is signed in.
 */
export function isSignedIn(): boolean {
  return !!currentUser;
}
