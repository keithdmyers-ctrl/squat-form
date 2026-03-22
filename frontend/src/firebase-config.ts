/**
 * Firebase configuration and initialization.
 * This is the ONLY file that imports from 'firebase/*' directly.
 *
 * Setup instructions:
 * 1. Go to https://console.firebase.google.com
 * 2. Create a new project (e.g., "lift-coach")
 * 3. Enable Authentication (Email/Password + Google + Apple)
 * 4. Create a Firestore database (start in test mode, lock down with rules later)
 * 5. Enable Cloud Storage
 * 6. Copy the config object below from Project Settings → General → Your Apps → Web App
 * 7. Replace the placeholder values below
 */

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  enableIndexedDbPersistence,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  limit,
  writeBatch,
} from 'firebase/firestore';
import {
  getStorage,
  ref,
  uploadString,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';

// ─── Firebase Configuration ───
// Replace these with your actual Firebase project config
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// Check if Firebase is configured
const isConfigured = firebaseConfig.apiKey !== "YOUR_API_KEY";

// Initialize Firebase (only if configured)
let app: ReturnType<typeof initializeApp> | null = null;
let auth: ReturnType<typeof getAuth> | null = null;
let db: ReturnType<typeof getFirestore> | null = null;
let storage: ReturnType<typeof getStorage> | null = null;

if (isConfigured) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);

    // Enable offline persistence for Firestore
    enableIndexedDbPersistence(db).catch((err) => {
      if (err.code === 'failed-precondition') {
        // Multiple tabs open, offline persistence only works in one
        // Firestore offline persistence unavailable (multiple tabs)
      } else if (err.code === 'unimplemented') {
        // Browser doesn't support offline persistence
        // Firestore offline persistence not supported in this browser
      }
    });
  } catch {
    // Firebase initialization failed -- app will work in offline-only mode
  }
}

export { app, auth, db, storage, isConfigured };
export {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  firebaseSignOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  collection, doc, setDoc, getDoc, getDocs, deleteDoc,
  query, orderBy, limit, writeBatch,
  ref, uploadString, getDownloadURL, deleteObject,
};
export type { User };
