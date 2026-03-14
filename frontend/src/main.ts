/**
 * Main entry point for the Squat Form Analyzer frontend.
 * Wires up all UI event listeners and orchestrates the analysis pipeline.
 * Includes session history persistence, settings memory, and onboarding.
 */

import { PoseProcessor, prewarmMediaPipe } from './pose';
import { analyzeSequence } from './analyzer';
import { analyzeExercise } from './exercises/index';
import type { ExerciseConfig } from './exercises/index';
import {
  showProgress,
  hideProgress,
  showResults,
  showError,
  showErrorCard,
  hideError,
  setupVideoPlayback,
  renderHistorySection,
  showSkeletonLoading,
  hideSkeletonLoading,
  drawSkeleton,
} from './ui';
import { showValidationWarning, hideValidationWarnings } from './ui-progress';
import type { SquatConfig, SquatType, ExperienceLevel, ExerciseType, DeadliftType, BenchType, FrameData } from './types';
import {
  ONBOARDED_KEY,
  PRESCREEN_KEY,
  saveSession,
  getSessions,
  saveSettings,
  loadSettings,
} from './storage';
import { initLiveMode } from './live-mode';
import { estimateOneRM } from './one-rm';
import { decodeAnalysisUrl } from './share';

// ─── DOM Elements ───
const videoInput = document.getElementById('video-input') as HTMLInputElement;
const analyzeBtn = document.getElementById('analyze-btn') as HTMLButtonElement;
const exerciseTypeSelect = document.getElementById('exercise-type') as HTMLSelectElement | null;
const squatTypeSelect = document.getElementById('squat-type') as HTMLSelectElement;
const deadliftTypeSelect = document.getElementById('deadlift-type') as HTMLSelectElement | null;
const benchTypeSelect = document.getElementById('bench-type') as HTMLSelectElement | null;
const experienceSelect = document.getElementById('experience-level') as HTMLSelectElement;
const resultVideo = document.getElementById('result-video') as HTMLVideoElement;
const overlayCanvas = document.getElementById('overlay-canvas') as HTMLCanvasElement;
const weightInput = document.getElementById('weight-input') as HTMLInputElement;
const liveWeightInput = document.getElementById('live-weight-input') as HTMLInputElement;

let selectedFile: File | null = null;
let quickStartPending = false;
let analysisCancelled = false;

/** Track the current object URL to revoke it when done. */
let currentObjectUrl: string | null = null;

// ─── Restore Settings on Load ───

const savedSettings = loadSettings();
if (savedSettings) {
  if (savedSettings.exercise_type && exerciseTypeSelect) {
    exerciseTypeSelect.value = savedSettings.exercise_type;
    // Sync exercise tab buttons with restored setting
    document.querySelectorAll<HTMLButtonElement>('.exercise-tab').forEach((t) => {
      const isActive = t.dataset.exercise === savedSettings.exercise_type;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-checked', String(isActive));
    });
  }
  if (savedSettings.squat_type) squatTypeSelect.value = savedSettings.squat_type;
  if (savedSettings.deadlift_type && deadliftTypeSelect) deadliftTypeSelect.value = savedSettings.deadlift_type;
  if (savedSettings.bench_type && benchTypeSelect) benchTypeSelect.value = savedSettings.bench_type;
  if (savedSettings.experience_level) experienceSelect.value = savedSettings.experience_level;
  if (savedSettings.weight) {
    weightInput.value = savedSettings.weight;
    if (liveWeightInput) liveWeightInput.value = savedSettings.weight;
  }
  if (savedSettings.weight_unit) {
    setWeightUnit(savedSettings.weight_unit);
  }
}

/** Get the currently selected weight unit from the upload settings panel. */
function getWeightUnit(): string {
  const active = document.querySelector('.weight-unit-btn.active') as HTMLElement | null;
  return active?.dataset.unit ?? 'lbs';
}

/** Set weight unit toggle state in both upload and live panels. */
function setWeightUnit(unit: string): void {
  document.querySelectorAll<HTMLButtonElement>('.weight-unit-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.unit === unit);
  });
  document.querySelectorAll<HTMLButtonElement>('.live-weight-unit-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.unit === unit);
  });
}

/** Persist all current settings. */
function persistSettings(): void {
  saveSettings(
    squatTypeSelect.value, experienceSelect.value, weightInput.value, getWeightUnit(),
    exerciseTypeSelect?.value, deadliftTypeSelect?.value, benchTypeSelect?.value,
  );
}

// ─── Exercise Type Toggle ───

function getExerciseType(): ExerciseType {
  return (exerciseTypeSelect?.value ?? 'squat') as ExerciseType;
}

function updateExerciseVariantVisibility(): void {
  const exercise = getExerciseType();
  const sqGroup = document.getElementById('squat-type-group');
  const dlGroup = document.getElementById('deadlift-type-group');
  const bpGroup = document.getElementById('bench-type-group');

  if (sqGroup) sqGroup.classList.toggle('visible', exercise === 'squat');
  if (dlGroup) dlGroup.classList.toggle('visible', exercise === 'deadlift');
  if (bpGroup) bpGroup.classList.toggle('visible', exercise === 'bench_press');
}

if (exerciseTypeSelect) {
  exerciseTypeSelect.addEventListener('change', () => {
    updateExerciseVariantVisibility();
    persistSettings();
  });
  updateExerciseVariantVisibility();
}

// ─── Exercise Tab Buttons (segmented control) ───

document.querySelectorAll<HTMLButtonElement>('.exercise-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    // Toggle active class and aria-checked
    document.querySelectorAll<HTMLButtonElement>('.exercise-tab').forEach((t) => {
      t.classList.remove('active');
      t.setAttribute('aria-checked', 'false');
    });
    tab.classList.add('active');
    tab.setAttribute('aria-checked', 'true');

    // Update hidden select value
    if (exerciseTypeSelect) {
      exerciseTypeSelect.value = tab.dataset.exercise ?? 'squat';
    }

    updateExerciseVariantVisibility();
    persistSettings();
  });
});

// Save settings when user changes dropdowns or weight
squatTypeSelect.addEventListener('change', persistSettings);
if (deadliftTypeSelect) deadliftTypeSelect.addEventListener('change', persistSettings);
if (benchTypeSelect) benchTypeSelect.addEventListener('change', persistSettings);
experienceSelect.addEventListener('change', persistSettings);
weightInput.addEventListener('input', persistSettings);

// Update experience hint when selection changes
const experienceHints: Record<string, string> = {
  beginner: 'New to squatting or <6 months of consistent practice',
  intermediate: '6 months to 2 years, comfortable with the movement',
  advanced: '2+ years, competing or training with specific goals',
};

function updateExperienceHint(): void {
  const hint = document.getElementById('experience-hint');
  if (hint) {
    hint.textContent = experienceHints[experienceSelect.value] ?? '';
  }
}

experienceSelect.addEventListener('change', updateExperienceHint);
// Set initial hint based on current selection
updateExperienceHint();

// Weight unit toggle buttons (upload panel)
document.querySelectorAll<HTMLButtonElement>('.weight-unit-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    setWeightUnit(btn.dataset.unit ?? 'lbs');
    persistSettings();
  });
});

// Weight unit toggle buttons (live panel)
document.querySelectorAll<HTMLButtonElement>('.live-weight-unit-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    setWeightUnit(btn.dataset.unit ?? 'lbs');
    persistSettings();
  });
});

// Sync live weight input with main weight input
if (liveWeightInput) {
  liveWeightInput.addEventListener('input', () => {
    weightInput.value = liveWeightInput.value;
    persistSettings();
  });
}

// ─── Onboarding ───

function initOnboarding(): void {
  const overlay = document.getElementById('onboarding-overlay');
  if (!overlay) return;

  if (localStorage.getItem(ONBOARDED_KEY)) {
    overlay.style.display = 'none';
    return;
  }

  overlay.style.display = 'flex';

  const dismissBtn = document.getElementById('onboarding-dismiss');

  // Focus trap handler -- stored so it can be removed on dismiss
  function onboardingKeydownHandler(e: KeyboardEvent): void {
    if (overlay!.style.display === 'none') return;

    if (e.key === 'Escape') {
      closeOnboarding();
      return;
    }

    // Focus trap: cycle Tab/Shift+Tab within the modal
    if (e.key === 'Tab') {
      const card = overlay!.querySelector('.onboarding-card');
      if (!card) return;
      const focusable = card.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }

  function closeOnboarding(): void {
    try {
      localStorage.setItem(ONBOARDED_KEY, '1');
      localStorage.setItem(PRESCREEN_KEY, '1');
    } catch {
      // localStorage full -- silently continue
    }
    overlay!.style.display = 'none';
    // Remove the focus trap listener
    document.removeEventListener('keydown', onboardingKeydownHandler);
    // Return focus to the quick-start button
    const quickStartBtn = document.getElementById('quick-start-btn');
    if (quickStartBtn) quickStartBtn.focus();
  }

  if (dismissBtn) {
    dismissBtn.addEventListener('click', closeOnboarding);
    // Focus the dismiss button on open
    setTimeout(() => dismissBtn.focus(), 100);
  }

  // Close X button in top-right
  const closeXBtn = document.getElementById('onboarding-close-x');
  if (closeXBtn) {
    closeXBtn.addEventListener('click', closeOnboarding);
  }

  // Also dismiss on overlay click (outside card)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeOnboarding();
    }
  });

  // Focus trapping and Escape handling
  document.addEventListener('keydown', onboardingKeydownHandler);
}

// ─── Quick Start ───

function initQuickStart(): void {
  const quickStartBtn = document.getElementById('quick-start-btn');
  const showSettingsBtn = document.getElementById('show-settings-btn');
  const settingsContent = document.getElementById('settings-content');

  if (quickStartBtn) {
    quickStartBtn.addEventListener('click', () => {
      // Use defaults or saved settings
      if (!savedSettings) {
        squatTypeSelect.value = 'bodyweight';
        experienceSelect.value = 'beginner';
      }
      // Mark quick start pending so file selection auto-starts analysis
      quickStartPending = true;
      // Show loading feedback
      quickStartBtn.textContent = 'Opening...';
      (quickStartBtn as HTMLButtonElement).disabled = true;
      // Reset button if user dismisses file picker without selecting
      const resetQuickStart = () => {
        quickStartBtn.textContent = 'Quick Analyze My Lift';
        (quickStartBtn as HTMLButtonElement).disabled = false;
        window.removeEventListener('focus', resetQuickStart);
      };
      window.addEventListener('focus', resetQuickStart);
      // Trigger file picker
      videoInput.click();
    });
  }

  if (showSettingsBtn && settingsContent) {
    // If user has saved settings, show their settings label
    if (savedSettings) {
      showSettingsBtn.textContent = 'Customize settings';
    }

    showSettingsBtn.addEventListener('click', () => {
      const isHidden = settingsContent.style.display === 'none';
      settingsContent.style.display = isHidden ? 'block' : 'none';
      showSettingsBtn.textContent = isHidden ? 'Hide settings' : 'Customize settings';
    });
  }
}

// ─── Try Example Video ───

function initExampleVideo(): void {
  const tryExampleBtn = document.getElementById('try-example-btn') as HTMLButtonElement | null;
  if (!tryExampleBtn) return;

  tryExampleBtn.addEventListener('click', async () => {
    tryExampleBtn.textContent = 'Loading example...';
    tryExampleBtn.disabled = true;

    try {
      const response = await fetch('/example_squat.mp4');
      if (!response.ok) throw new Error('Failed to load example video');
      const blob = await response.blob();
      const file = new File([blob], 'example_squat.mp4', { type: 'video/mp4' });

      // Use beginner bodyweight defaults for the example
      squatTypeSelect.value = 'high_bar';
      experienceSelect.value = 'beginner';

      selectedFile = file;
      analyzeBtn.disabled = false;
      await runAnalysis(file);
    } catch (err) {
      console.error('Failed to load example video:', err);
      tryExampleBtn.textContent = 'Example not available — try uploading your own video';
    } finally {
      tryExampleBtn.textContent = 'Try Example Video';
      tryExampleBtn.disabled = false;
    }
  });
}

// ─── Session History Display ───

function initHistorySection(): void {
  const sessions = getSessions();
  renderHistorySection(sessions);
}

// ─── Event Listeners ───

// ─── File Drop Zone Enhancement ───

const fileDropZone = document.getElementById('file-drop-zone');
const dropLabel = document.getElementById('drop-label');

if (fileDropZone) {
  fileDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileDropZone.classList.add('drag-over');
  });
  fileDropZone.addEventListener('dragleave', () => {
    fileDropZone.classList.remove('drag-over');
  });
  fileDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    fileDropZone.classList.remove('drag-over');
    const files = (e as DragEvent).dataTransfer?.files;
    if (files && files.length > 0 && files[0].type.startsWith('video/')) {
      // Transfer the dropped file to the input
      const dt = new DataTransfer();
      dt.items.add(files[0]);
      videoInput.files = dt.files;
      videoInput.dispatchEvent(new Event('change'));
    }
  });
}

videoInput.addEventListener('change', () => {
  // Reset Quick Start button on file selection
  const quickStartBtn = document.getElementById('quick-start-btn');
  if (quickStartBtn) {
    quickStartBtn.textContent = 'Quick Analyze My Lift';
    (quickStartBtn as HTMLButtonElement).disabled = false;
  }

  const files = videoInput.files;
  if (files && files.length > 0) {
    selectedFile = files[0];
    analyzeBtn.disabled = false;
    analyzeBtn.removeAttribute('title');

    // Update drop zone to show selected file name
    if (dropLabel) {
      dropLabel.textContent = selectedFile.name;
      dropLabel.classList.add('file-name');
    }

    // If Quick Start triggered this, show filename confirmation and auto-start
    if (quickStartPending) {
      quickStartPending = false;
      if (quickStartBtn) {
        quickStartBtn.textContent = `Analyzing: ${selectedFile.name}`;
        (quickStartBtn as HTMLButtonElement).disabled = true;
      }
      runAnalysis(selectedFile);
    }
  } else {
    selectedFile = null;
    analyzeBtn.disabled = true;
    analyzeBtn.title = 'Select a video file first';
    // Reset drop zone label
    if (dropLabel) {
      dropLabel.textContent = 'Tap to select or drag a video here';
      dropLabel.classList.remove('file-name');
    }
  }
});

analyzeBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  await runAnalysis(selectedFile);
});

// ─── Analysis Pipeline ───

async function runAnalysis(file: File): Promise<void> {
  // Reset UI
  hideError();
  const resultsSection = document.getElementById('results-section');
  if (resultsSection) resultsSection.style.display = 'none';

  analyzeBtn.disabled = true;
  analysisCancelled = false;
  hideValidationWarnings();
  showProgress(0, 'Initializing...');

  // Show cancel button
  const cancelBtn = document.getElementById('cancel-btn');
  if (cancelBtn) {
    cancelBtn.style.display = 'inline-block';
    cancelBtn.onclick = () => { analysisCancelled = true; };
  }

  // Show skeleton loading state
  showSkeletonLoading();

  let poseProcessor: PoseProcessor | null = null;

  try {
    // Revoke previous object URL if any (fix memory leak)
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }

    // Step 1: Load video into a hidden video element
    showProgress(2, 'Loading video...');
    const videoUrl = URL.createObjectURL(file);
    currentObjectUrl = videoUrl;
    await loadVideo(resultVideo, videoUrl);

    // ─── Video Validation ───

    // Duration validation
    if (!isFinite(resultVideo.duration) || resultVideo.duration <= 0) {
      throw new Error(
        'Could not determine video duration. The file may be corrupted or in an unsupported format.',
      );
    }

    if (resultVideo.duration < 2) {
      throw new Error(
        'Video is too short (minimum 2 seconds). Please record at least one full squat -- standing, down, and back up.',
      );
    }

    if (resultVideo.duration > 300) {
      throw new Error(
        'Video is too long (maximum 5 minutes). Please trim to a single set for best results.',
      );
    }

    if (resultVideo.duration > 60) {
      console.warn(`[Validation] Long video detected: ${Math.round(resultVideo.duration)}s. Analysis may take a while.`);
      showValidationWarning(`Long video detected (${Math.round(resultVideo.duration)}s) -- analysis may take a moment.`);
      showProgress(3, 'Long video detected -- analysis may take a moment...');
    }

    // Resolution validation
    const videoWidth = resultVideo.videoWidth;
    const videoHeight = resultVideo.videoHeight;
    if (videoWidth > 0 && videoHeight > 0) {
      const minDim = Math.min(videoWidth, videoHeight);
      if (minDim < 240) {
        console.warn(`[Validation] Low resolution video: ${videoWidth}x${videoHeight}`);
        showValidationWarning(`Low resolution video (${videoWidth}x${videoHeight}) -- results may be less accurate.`);
        showProgress(3, 'Low resolution detected -- results may be less accurate...');
      }
    }

    // File size validation
    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > 500) {
      throw new Error(
        `Video file is very large (${Math.round(fileSizeMB)} MB). Please compress or trim it before uploading.`,
      );
    }

    // Portrait orientation detection
    if (videoWidth > 0 && videoHeight > 0 && videoHeight > videoWidth * 1.5) {
      showValidationWarning('Portrait video detected — landscape (sideways) orientation works better. Results may still work, but try filming sideways next time.');
    }

    // Step 2: Initialize MediaPipe PoseProcessor
    showProgress(5, 'Downloading AI model (first time only, ~5 MB)...');
    poseProcessor = new PoseProcessor();
    await poseProcessor.init();

    // Step 3: Process all frames
    showProgress(10, 'Extracting poses...');
    const frameData: FrameData = await poseProcessor.processVideo(
      resultVideo,
      (percent, status) => {
        if (analysisCancelled) {
          throw new Error('Analysis cancelled');
        }
        // Scale to 10-90% range
        const scaledPercent = 10 + Math.round(percent * 0.8);
        showProgress(scaledPercent, status);
      },
    );

    if (frameData.size === 0) {
      throw new AnalysisError(
        'no_poses',
        "We couldn't detect your body in the video. Make sure your full body is visible and the lighting is good.",
      );
    }

    // Step 4: Build config and analyze
    showProgress(92, 'Analyzing form...');
    const compToggle = document.getElementById('competition-mode') as HTMLInputElement | null;
    const exerciseType = getExerciseType();

    const exerciseConfig: ExerciseConfig = {
      exerciseType,
      experienceLevel: experienceSelect.value as ExperienceLevel,
      competitionMode: compToggle?.checked ?? false,
      squatType: squatTypeSelect.value as SquatType,
      deadliftType: (deadliftTypeSelect?.value ?? 'conventional') as DeadliftType,
      benchType: (benchTypeSelect?.value ?? 'flat') as BenchType,
    };

    const fps = poseProcessor.getProcessingFps();
    const analysis = analyzeExercise(frameData, fps, exerciseConfig);

    // Attach multi-person warning from pose processor if detected
    const multiPersonWarning = poseProcessor.getMultiPersonWarning();
    if (multiPersonWarning) {
      analysis.multiPersonWarning = multiPersonWarning;
    }

    if (analysis.repCount === 0) {
      throw new AnalysisError(
        'no_reps',
        "Your video needs to show at least one complete squat — from standing, down, and back to standing. Make sure your full body is visible and you complete at least one full rep.",
      );
    }

    // Step 5: 1RM estimation (if weight provided and valid rep count)
    const rawWeight = parseFloat(weightInput.value);
    const weight = isFinite(rawWeight) ? rawWeight : 0;
    const unit = getWeightUnit();
    const oneRMEstimate = estimateOneRM(weight, analysis.repCount, unit);

    // Step 6: Save session and get previous sessions for milestone detection
    const previousSessions = getSessions();
    const variantName = exerciseType === 'deadlift' ? (deadliftTypeSelect?.value ?? 'conventional')
      : exerciseType === 'bench_press' ? (benchTypeSelect?.value ?? 'flat')
      : squatTypeSelect.value;
    saveSession(
      analysis, squatTypeSelect.value, experienceSelect.value,
      weight, unit, oneRMEstimate?.average,
      exerciseType, variantName,
    );

    // Step 7: Display results with session context
    showProgress(97, 'Rendering results...');
    hideSkeletonLoading();
    showResults(analysis, frameData, previousSessions, oneRMEstimate, fps);

    // Step 8: Setup annotated playback
    resultVideo.currentTime = 0;
    setupVideoPlayback(resultVideo, overlayCanvas, frameData, analysis, fps);

    showProgress(100, 'Complete!');
    hideValidationWarnings();
    // Hide cancel button on success
    if (cancelBtn) cancelBtn.style.display = 'none';
    setTimeout(hideProgress, 500);

    // Update history section
    initHistorySection();

  } catch (err) {
    hideProgress();
    hideValidationWarnings();
    hideSkeletonLoading();

    // Hide cancel button
    const cancelBtnCleanup = document.getElementById('cancel-btn');
    if (cancelBtnCleanup) cancelBtnCleanup.style.display = 'none';

    // Helper: show settings panel
    const scrollToSettings = () => {
      const settingsContent = document.getElementById('settings-content');
      const showSettingsBtn = document.getElementById('show-settings-btn');
      if (settingsContent) settingsContent.style.display = 'block';
      if (showSettingsBtn) showSettingsBtn.textContent = 'Hide settings';
      settingsContent?.scrollIntoView({ behavior: 'smooth' });
    };

    // Helper: scroll to camera tips section
    const scrollToCameraTips = () => {
      const tips = document.getElementById('camera-tips') || document.querySelector('.camera-guide');
      if (tips) {
        tips.scrollIntoView({ behavior: 'smooth' });
      } else {
        scrollToSettings();
      }
    };

    // Handle user cancellation
    if (analysisCancelled || (err instanceof Error && err.message === 'Analysis cancelled')) {
      showErrorCard('Analysis cancelled. You can try again whenever you\'re ready.', 'generic', () => {
        videoInput.click();
      }, scrollToSettings, 'Adjust Settings');
      analyzeBtn.disabled = false;
      if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = null;
      }
      return;
    }

    if (err instanceof AnalysisError) {
      // Contextual secondary action per error type
      if (err.type === 'no_poses') {
        showErrorCard(err.message, err.type, () => {
          videoInput.click();
        }, scrollToCameraTips, 'See Camera Tips');
      } else if (err.type === 'no_reps') {
        showErrorCard(err.message, err.type, () => {
          videoInput.click();
        }, scrollToSettings, 'Adjust Settings');
      } else {
        showErrorCard(err.message, err.type, () => {
          videoInput.click();
        }, scrollToSettings, 'Adjust Settings');
      }
    } else {
      const message =
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred during analysis.';
      // Detect network/CDN errors and show a specific message
      const isNetworkError = message.includes('fetch') || message.includes('network') ||
        message.includes('Failed to fetch') || message.includes('NetworkError') ||
        message.includes('ERR_') || message.includes('Load failed');
      const displayMessage = isNetworkError
        ? 'This app needs an internet connection to load the pose estimation model (first time only). Please check your Wi-Fi and try again.'
        : message;
      if (isNetworkError) {
        // Network errors: no useful secondary action
        showErrorCard(displayMessage, 'generic', () => {
          videoInput.click();
        }, null);
      } else {
        showErrorCard(displayMessage, 'generic', () => {
          videoInput.click();
        }, scrollToSettings, 'Adjust Settings');
      }
    }
    console.error('Analysis error:', err);

    // Revoke object URL on error too
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
  } finally {
    poseProcessor?.close();
    analyzeBtn.disabled = false;
  }
}

/** Custom error class for analysis-specific errors with categorization. */
class AnalysisError extends Error {
  type: 'no_poses' | 'no_reps' | 'generic';
  constructor(type: 'no_poses' | 'no_reps' | 'generic', message: string) {
    super(message);
    this.type = type;
    this.name = 'AnalysisError';
  }
}

/**
 * Load a video URL into a video element and wait for metadata.
 */
function loadVideo(video: HTMLVideoElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(
        new Error(
          'Failed to load video. The file may be corrupted or in an unsupported format.',
        ),
      );
    };

    const cleanup = () => {
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('error', onError);
    video.src = url;
    video.load();
  });
}

// Pre-screen modal removed -- merged into onboarding

// ─── Header History Link ───

function initHeaderHistoryLink(): void {
  const link = document.getElementById('header-history-link');
  if (!link) return;

  link.addEventListener('click', () => {
    const section = document.getElementById('history-section');
    if (section) {
      section.scrollIntoView({ behavior: 'smooth' });
    }
  });
}

// ─── Initialize ───

// Pre-warm MediaPipe model in background (downloads WASM + model early)
prewarmMediaPipe();

// Show onboarding for first-time visitors (prescreen merged in)
initOnboarding();
initQuickStart();
initExampleVideo();
initHistorySection();
initHeaderHistoryLink();

// ─── Storage Warning Clear Button ───

const clearStorageBtn = document.getElementById('clear-storage-btn');
if (clearStorageBtn) {
  clearStorageBtn.addEventListener('click', () => {
    localStorage.clear();
    const warning = document.getElementById('storage-warning');
    if (warning) warning.style.display = 'none';
  });
}

// ─── Gate Competition Mode on Experience Level ───

const expSelect = document.getElementById('experience-level') as HTMLSelectElement;
const compToggle = document.getElementById('competition-toggle-container');
if (expSelect && compToggle) {
  expSelect.addEventListener('change', () => {
    compToggle.style.display = (expSelect.value === 'advanced' || expSelect.value === 'intermediate') ? '' : 'none';
  });
}

// ─── Reshow Onboarding ───

const reshowBtn = document.getElementById('reshow-onboarding');
if (reshowBtn) {
  reshowBtn.addEventListener('click', () => {
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay) overlay.style.display = 'flex';
  });
}

// ─── Mode Toggle ───

const modeUploadBtn = document.getElementById('mode-upload') as HTMLButtonElement | null;
const modeLiveBtn = document.getElementById('mode-live') as HTMLButtonElement | null;
const uploadPanel = document.getElementById('upload-panel');
const livePanel = document.getElementById('live-panel');

function setMode(mode: 'upload' | 'live'): void {
  if (!uploadPanel || !livePanel || !modeUploadBtn || !modeLiveBtn) return;

  if (mode === 'upload') {
    uploadPanel.style.display = '';
    livePanel.style.display = 'none';
    modeUploadBtn.classList.add('active');
    modeUploadBtn.setAttribute('aria-selected', 'true');
    modeLiveBtn.classList.remove('active');
    modeLiveBtn.setAttribute('aria-selected', 'false');
  } else {
    uploadPanel.style.display = 'none';
    livePanel.style.display = '';
    modeUploadBtn.classList.remove('active');
    modeUploadBtn.setAttribute('aria-selected', 'false');
    modeLiveBtn.classList.add('active');
    modeLiveBtn.setAttribute('aria-selected', 'true');
  }
}

modeUploadBtn?.addEventListener('click', () => setMode('upload'));
modeLiveBtn?.addEventListener('click', () => setMode('live'));

// Arrow key navigation for mode toggle tabs (WAI-ARIA Tab Pattern)
modeUploadBtn?.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    setMode('live');
    modeLiveBtn?.focus();
  }
});
modeLiveBtn?.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    setMode('upload');
    modeUploadBtn?.focus();
  }
});

// ─── Live Mode ───

initLiveMode({
  squatTypeSelect,
  experienceSelect,
  initHistorySection,
});

// ─── Shared Link Handling ───

const shared = decodeAnalysisUrl(location.hash);
if (shared) {
  const section = document.getElementById('results-section');
  if (section) {
    section.style.display = 'block';
    // Remove existing shared view
    document.getElementById('shared-result-view')?.remove();

    const view = document.createElement('div');
    view.id = 'shared-result-view';
    view.className = 'card';
    view.setAttribute('aria-label', 'Shared result');

    // Sanitize all shared data to prevent XSS via crafted share URLs
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const safeGrade = esc(String(shared.grade));
    const safeDate = esc(String(shared.date));
    const safeType = esc(String(shared.squatType).replace('_', ' '));
    const safeLevel = esc(String(shared.experienceLevel));
    const safeScore = Number(shared.score) || 0;
    const safeReps = Number(shared.reps) || 0;
    const safeIssues = Array.isArray(shared.topIssues)
      ? shared.topIssues.map((i: unknown) => esc(String(i).replace(/_/g, ' '))).join(', ')
      : '';

    const gradeColor = safeGrade === 'A' ? 'var(--grade-a)' : safeGrade === 'B' ? 'var(--grade-b)' : safeGrade === 'C' ? 'var(--grade-c)' : 'var(--grade-d)';
    const weightInfo = shared.weight ? `${Number(shared.weight)} ${esc(String(shared.unit ?? 'lbs'))}` : '';
    const rmInfo = shared.estimated1rm ? `Est. 1RM: ${Number(shared.estimated1rm)} ${esc(String(shared.unit ?? 'lbs'))}` : '';

    view.innerHTML = `
      <div style="text-align: center; padding: 1rem 0;">
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">Shared Result -- ${safeDate}</div>
        <div style="width: 100px; height: 100px; border-radius: 50%; border: 4px solid ${gradeColor}; display: inline-flex; flex-direction: column; align-items: center; justify-content: center; margin-bottom: 1rem;">
          <div style="font-size: 2.4rem; font-weight: 800; color: ${gradeColor};">${safeGrade}</div>
          <div style="font-size: 0.9rem; font-weight: 600; color: ${gradeColor};">${safeScore}/100</div>
        </div>
        <div style="font-size: 0.9rem; color: var(--text-secondary);">
          ${safeReps} reps | ${safeType} | ${safeLevel}
          ${weightInfo ? ` | ${weightInfo}` : ''}
        </div>
        ${rmInfo ? `<div style="font-size: 0.85rem; color: var(--accent); margin-top: 0.25rem;">${rmInfo}</div>` : ''}
        ${safeIssues ? `<div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.5rem;">Top issues: ${safeIssues}</div>` : ''}
        <div style="margin-top: 1rem;">
          <button class="btn btn-primary shared-analyze-btn">Analyze Your Own Squat</button>
        </div>
      </div>
    `;

    // Wire up button via addEventListener (no inline onclick)
    const sharedBtn = view.querySelector('.shared-analyze-btn');
    if (sharedBtn) {
      sharedBtn.addEventListener('click', () => {
        location.hash = '';
        location.reload();
      });
    }

    section.prepend(view);
    section.scrollIntoView({ behavior: 'smooth' });
  }
}
