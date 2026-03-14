#!/usr/bin/env node
/**
 * Copies MediaPipe WASM files from node_modules to public/mediapipe/wasm/
 * so they can be served locally as a fallback (avoids CDN dependency).
 *
 * Run automatically via postinstall and prebuild scripts.
 */

import { copyFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const wasmSrc = join(projectRoot, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDest = join(projectRoot, 'public', 'mediapipe', 'wasm');
const modelDest = join(projectRoot, 'public', 'mediapipe', 'models');

// Copy WASM files
if (existsSync(wasmSrc)) {
  mkdirSync(wasmDest, { recursive: true });
  const files = readdirSync(wasmSrc);
  let copied = 0;
  for (const file of files) {
    try {
      copyFileSync(join(wasmSrc, file), join(wasmDest, file));
      copied++;
    } catch (err) {
      console.warn(`  Warning: Could not copy ${file}:`, err.message);
    }
  }
  console.log(`[copy-mediapipe] Copied ${copied} WASM files to public/mediapipe/wasm/`);
} else {
  console.warn('[copy-mediapipe] WASM source not found at', wasmSrc);
  console.warn('  Run "npm install" first to download @mediapipe/tasks-vision');
}

// Ensure model directory exists (models must be downloaded separately)
mkdirSync(modelDest, { recursive: true });
const models = [
  { file: 'pose_landmarker_lite.task', use: 'live webcam mode' },
  { file: 'pose_landmarker_full.task', use: 'video upload mode' },
];
for (const { file, use } of models) {
  if (!existsSync(join(modelDest, file))) {
    console.log(`[copy-mediapipe] ${file} not found (used for ${use})`);
    console.log('  The app will fall back to the CDN for this model.');
  }
}
