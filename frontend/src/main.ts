/**
 * Main entry point for the Squat Form Analyzer frontend.
 * Wires up all UI event listeners and orchestrates the analysis pipeline.
 * Includes session history persistence, settings memory, and onboarding.
 */

import { PoseProcessor, prewarmMediaPipe } from './pose';
import { analyzeSequence } from './analyzer';
import { computeFrameAngles } from './angles';
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
import type { SquatConfig, SquatType, ExperienceLevel, ExerciseType, DeadliftType, BenchType, OverheadPressType, BarBellRowType, LungeType, FrameData } from './types';
import {
  ONBOARDED_KEY,
  PRESCREEN_KEY,
  saveSession,
  getSessions,
} from './storage';
import { initLiveMode } from './live-mode';
import { estimateOneRM, computeDOTS } from './one-rm';
import { decodeAnalysisUrl } from './share';
import { launchWarmupOverlay } from './ui-warmup-mobility';
import { mergeMultiAngleAnalysis } from './multi-angle';
import type { MultiAngleResult } from './multi-angle';
import type { TrainingPhase } from './programming';
import { suggestNextPhase } from './programming';
import { captureSnapshots, createSnapshotRecord } from './snapshot';
import {
  initSettings,
  getSavedSettings,
  getWeightUnit,
  getExerciseType,
  persistSettings,
} from './settings';
import {
  initUploadMode,
  getSelectedFile,
  getSelectedFrontFile,
  setSelectedFile,
  setQuickStartPending,
} from './upload-mode';
import { initNativePlatform, hapticNotification } from './native';

// ─── DOM Elements ───
const videoInput = document.getElementById('video-input') as HTMLInputElement;
const analyzeBtn = document.getElementById('analyze-btn') as HTMLButtonElement;
const squatTypeSelect = document.getElementById('squat-type') as HTMLSelectElement;
const deadliftTypeSelect = document.getElementById('deadlift-type') as HTMLSelectElement | null;
const benchTypeSelect = document.getElementById('bench-type') as HTMLSelectElement | null;
const ohpTypeSelect = document.getElementById('ohp-type') as HTMLSelectElement | null;
const rowTypeSelect = document.getElementById('row-type') as HTMLSelectElement | null;
const lungeTypeSelect = document.getElementById('lunge-type') as HTMLSelectElement | null;
const experienceSelect = document.getElementById('experience-level') as HTMLSelectElement;
const resultVideo = document.getElementById('result-video') as HTMLVideoElement;
const overlayCanvas = document.getElementById('overlay-canvas') as HTMLCanvasElement;
const weightInput = document.getElementById('weight-input') as HTMLInputElement;
const bodyweightInput = document.getElementById('bodyweight-input') as HTMLInputElement | null;
const bodyweightUnitSelect = document.getElementById('bodyweight-unit') as HTMLSelectElement | null;
const rpeInput = document.getElementById('rpe-input') as HTMLSelectElement | null;
const trainingPhaseSelect = document.getElementById('training-phase') as HTMLSelectElement | null;

let analysisCancelled = false;

/** Track the current object URL to revoke it when done. */
let currentObjectUrl: string | null = null;

/** Cached frame data and fps for re-analysis without re-running pose detection. */
let cachedFrameData: FrameData | null = null;
let cachedFps: number = 0;

// ─── Initialize Native Platform ───

initNativePlatform();

// ─── Initialize Settings ───

initSettings();
const savedSettings = getSavedSettings();

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

// ─── B2: Pre-Analysis Warmup Card ───

function initWarmupCard(): void {
  const warmupCard = document.getElementById('warmup-card');
  const warmupBtn = document.getElementById('warmup-card-btn');
  if (!warmupCard || !warmupBtn) return;

  // Show only for beginners
  const updateVisibility = () => {
    warmupCard.style.display = experienceSelect.value === 'beginner' ? '' : 'none';
  };
  updateVisibility();
  experienceSelect.addEventListener('change', updateVisibility);

  // Generic 5-step beginner warmup protocol
  const beginnerWarmup = [
    { name: 'Light Cardio', description: 'Jog in place, jumping jacks, or march in place to raise your heart rate.', duration: '2 min', purpose: 'Raise core body temperature', durationSeconds: 120 },
    { name: 'Hip Circles', description: 'Stand on one leg and make large circles with the other. 30 seconds each direction, each side.', duration: '2 min', purpose: 'Loosen hip joint', durationSeconds: 120 },
    { name: 'Leg Swings', description: 'Hold onto something for balance. Swing one leg forward and back, then side to side. 30 seconds each side.', duration: '1 min', purpose: 'Dynamic hip flexibility', durationSeconds: 60 },
    { name: 'Bodyweight Squats', description: 'Perform 10 slow bodyweight squats focusing on controlled depth and upright torso.', duration: '1 min', purpose: 'Groove the movement pattern', durationSeconds: 60 },
    { name: 'Ankle Mobility', description: 'In a half-kneeling position, push your knee over your toes. 30 seconds each ankle.', duration: '1 min', purpose: 'Improve ankle dorsiflexion', durationSeconds: 60 },
  ];

  warmupBtn.addEventListener('click', () => {
    launchWarmupOverlay(beginnerWarmup);
  });
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
      setQuickStartPending(true);
      // Show loading feedback
      quickStartBtn.textContent = 'Opening...';
      (quickStartBtn as HTMLButtonElement).disabled = true;
      // Reset button if user dismisses file picker without selecting
      const resetQuickStart = () => {
        quickStartBtn.textContent = 'Check My Form';
        (quickStartBtn as HTMLButtonElement).disabled = false;
        window.removeEventListener('focus', resetQuickStart);
      };
      window.addEventListener('focus', resetQuickStart);
      // Trigger file picker
      videoInput.click();
    });
  }

  if (showSettingsBtn && settingsContent) {
    // Auto-expand settings for returning users (they have saved settings)
    // or for intermediate/advanced users who need to configure
    const autoExpand = savedSettings && (
      savedSettings.experience_level === 'intermediate' ||
      savedSettings.experience_level === 'advanced'
    );
    if (autoExpand) {
      settingsContent.style.display = 'block';
      showSettingsBtn.textContent = 'Hide settings';
    } else if (savedSettings) {
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

      setSelectedFile(file);
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

// ─── Upload Mode ───

initUploadMode((file: File) => {
  // Clear cached data from previous analysis when new video is uploaded
  cachedFrameData = null;
  cachedFps = 0;
  runAnalysis(file);
});

// ─── Analysis Pipeline ───

async function runAnalysis(file: File): Promise<void> {
  // Reset UI
  hideError();
  const resultsSection = document.getElementById('results-section');
  if (resultsSection) {
    resultsSection.classList.remove('visible');
    resultsSection.style.display = 'none';
  }

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
      ohpType: (ohpTypeSelect?.value ?? 'strict') as OverheadPressType,
      rowType: (rowTypeSelect?.value ?? 'bent_over') as BarBellRowType,
      lungeType: (lungeTypeSelect?.value ?? 'forward') as LungeType,
    };

    const fps = poseProcessor.getProcessingFps();
    let analysis = analyzeExercise(frameData, fps, exerciseConfig);

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

    // Step 4b: Multi-angle merge (if front video provided)
    const selectedFrontFile = getSelectedFrontFile();
    let multiAngleResult: MultiAngleResult | null = null;
    if (selectedFrontFile) {
      try {
        showProgress(93, 'Processing front-view video...');

        // Load front video into a temporary video element
        const frontVideo = document.createElement('video');
        frontVideo.muted = true;
        frontVideo.playsInline = true;
        const frontUrl = URL.createObjectURL(selectedFrontFile);
        try {
          await loadVideo(frontVideo, frontUrl);

          // Process front video with a fresh pose processor
          const frontPoseProcessor = new PoseProcessor();
          await frontPoseProcessor.init();
          try {
            showProgress(94, 'Extracting front-view poses...');
            const frontFrameData: FrameData = await frontPoseProcessor.processVideo(
              frontVideo,
              (percent, _status) => {
                if (analysisCancelled) {
                  throw new Error('Analysis cancelled');
                }
                const scaledPercent = 94 + Math.round(percent * 0.04);
                showProgress(scaledPercent, 'Processing front view...');
              },
            );

            if (frontFrameData.size > 0) {
              showProgress(98, 'Merging multi-angle results...');
              const frontFps = frontPoseProcessor.getProcessingFps();
              const frontAnalysis = analyzeExercise(frontFrameData, frontFps, exerciseConfig);

              if (frontAnalysis.repCount > 0) {
                multiAngleResult = mergeMultiAngleAnalysis(analysis, frontAnalysis);
                analysis = multiAngleResult.merged;
              }
            }
          } finally {
            frontPoseProcessor.close();
          }
        } finally {
          URL.revokeObjectURL(frontUrl);
        }
      } catch (err) {
        // Front video processing failed -- continue with side-only analysis
        console.warn('Front video processing failed, using side view only:', err);
        analysis.sideViewWarning = 'Front view video could not be processed -- using side view only.';
      }
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
      : exerciseType === 'overhead_press' ? (ohpTypeSelect?.value ?? 'strict')
      : exerciseType === 'barbell_row' ? (rowTypeSelect?.value ?? 'bent_over')
      : exerciseType === 'lunge' ? (lungeTypeSelect?.value ?? 'forward')
      : squatTypeSelect.value;
    const rawBodyweight = bodyweightInput ? parseFloat(bodyweightInput.value) : 0;
    const bodyweight = isFinite(rawBodyweight) ? rawBodyweight : 0;
    const bwUnit = bodyweightUnitSelect?.value ?? 'lbs';
    const rawRpe = rpeInput ? parseFloat(rpeInput.value) : 0;
    const rpe = isFinite(rawRpe) && rawRpe >= 6 && rawRpe <= 10 ? rawRpe : undefined;

    // Step 6b: Capture video snapshots at key positions (bottom + lockout per rep)
    let sessionSnapshots: Array<{ dataUrl: string; phase: string; repIndex: number }> | undefined;
    try {
      // Build bottom frame and end frame arrays from repFrameMap
      const repBottomFrames: number[] = [];
      const repEndFrames: number[] = [];
      const repFramesByRep = new Map<number, number[]>();
      for (const [frame, repIdx] of analysis.repFrameMap) {
        if (repIdx < 0) continue;
        if (!repFramesByRep.has(repIdx)) repFramesByRep.set(repIdx, []);
        repFramesByRep.get(repIdx)!.push(frame);
      }
      for (let r = 0; r < analysis.repCount; r++) {
        const frames = repFramesByRep.get(r);
        if (!frames || frames.length === 0) continue;
        frames.sort((a, b) => a - b);
        // Find bottom frame: frame with minimum knee angle in this rep
        let minAngle = Infinity;
        let bottomFrame = frames[0];
        for (const f of frames) {
          const lm = frameData.get(f);
          if (!lm) continue;
          const fa = computeFrameAngles(lm);
          if (fa.kneeAngle < minAngle) {
            minAngle = fa.kneeAngle;
            bottomFrame = f;
          }
        }
        repBottomFrames.push(bottomFrame);
        repEndFrames.push(frames[frames.length - 1]);
      }

      const rawSnapshots = await captureSnapshots(
        resultVideo, repBottomFrames, repEndFrames, fps, 2,
      );
      if (rawSnapshots.length > 0) {
        const compactSnapshots = createSnapshotRecord(rawSnapshots);
        sessionSnapshots = compactSnapshots.map(s => ({
          dataUrl: s.dataUrl,
          phase: s.phase,
          repIndex: s.repIndex,
        }));
      }
    } catch (err) {
      // Snapshot capture is optional -- continue without them
      console.warn('Snapshot capture failed:', err);
    }

    // Compute DOTS score for session record (if bodyweight and 1RM available)
    let dotsScore: number | undefined;
    if (bodyweight > 0 && oneRMEstimate && oneRMEstimate.average > 0) {
      const isMaleBtn = document.querySelector('.sex-toggle-btn.active') as HTMLElement | null;
      const isMale = isMaleBtn?.dataset.sex !== 'female';
      const bwKg = bwUnit === 'lbs' ? bodyweight * 0.453592 : bodyweight;
      const totalKg = unit === 'lbs' ? oneRMEstimate.average * 0.453592 : oneRMEstimate.average;
      const dotsResult = computeDOTS(totalKg, bwKg, isMale);
      if (dotsResult) dotsScore = dotsResult.score;
    }

    saveSession(
      analysis, squatTypeSelect.value, experienceSelect.value,
      weight, unit, oneRMEstimate?.average,
      exerciseType, variantName,
      bodyweight, bwUnit, rpe,
      sessionSnapshots,
      dotsScore,
    );

    // Step 7: Determine training phase (user-selected or auto-detected)
    const selectedPhase = trainingPhaseSelect?.value as TrainingPhase | '' | undefined;
    const trainingPhase: TrainingPhase | undefined = selectedPhase
      ? selectedPhase as TrainingPhase
      : suggestNextPhase(
          previousSessions.map(s => ({ score: s.overall_score, date: s.date })),
        ).phase;

    // Cache frame data and fps for re-analysis
    cachedFrameData = frameData;
    cachedFps = fps;

    // Step 8: Display results with session context and training phase
    showProgress(97, 'Rendering results...');
    hideSkeletonLoading();
    showResults(analysis, frameData, previousSessions, oneRMEstimate, fps, trainingPhase, exerciseType);

    // Show multi-angle alignment quality indicator if applicable
    if (multiAngleResult) {
      const alignIndicator = document.getElementById('multi-angle-indicator');
      if (alignIndicator) {
        alignIndicator.remove();
      }
      const resultsSection = document.getElementById('results-section');
      if (resultsSection) {
        const indicator = document.createElement('div');
        indicator.id = 'multi-angle-indicator';
        indicator.className = 'multi-angle-indicator';
        const qualityColors: Record<string, string> = {
          good: 'var(--success)',
          fair: 'var(--warning)',
          poor: 'var(--danger)',
          failed: 'var(--danger)',
        };
        const qualityLabels: Record<string, string> = {
          good: 'Good -- reps aligned perfectly',
          fair: 'Fair -- reps aligned with minor offset',
          poor: 'Poor -- partial alignment only',
          failed: 'Failed -- using side view only',
        };
        const q = multiAngleResult.alignmentQuality;
        indicator.style.setProperty('--multi-angle-color', qualityColors[q]);
        indicator.innerHTML = `
          <span class="multi-angle-indicator-label">Multi-Angle</span>
          <span>${qualityLabels[q]}</span>
        `;
        // Insert at top of results section
        resultsSection.insertBefore(indicator, resultsSection.firstChild);
      }
    }

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

    // Show session notes prompt (E5)
    renderSessionNotePrompt();

    // Show exercise suggestion (G5)
    renderExerciseSuggestion(exerciseType);

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

// ─── Session Notes Prompt (E5) ───

function renderSessionNotePrompt(): void {
  const existing = document.getElementById('session-note-prompt');
  if (existing) existing.remove();

  const section = document.getElementById('results-section');
  if (!section) return;

  const container = document.createElement('div');
  container.id = 'session-note-prompt';
  container.className = 'card card--static';
  container.style.cssText = 'margin-top: 0.75rem; padding: 0.75rem;';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'session-note';
  input.placeholder = 'Add a note (optional)';
  input.style.cssText = 'width: 100%; padding: 0.4rem 0.6rem; border-radius: var(--radius-sm, 6px); border: 1px solid var(--border, #333); background: var(--bg-input, #1e1e1e); color: var(--text-primary, #e0e0e0); font-size: var(--font-sm, 0.875rem); margin-bottom: 0.5rem;';

  const tagsDiv = document.createElement('div');
  tagsDiv.style.cssText = 'display: flex; flex-wrap: wrap; gap: 0.35rem;';
  const quickTags = ['Belt', 'Sleeves', 'Wraps', 'No belt', 'Fatigued', 'Fresh'];
  const activeTagSet = new Set<string>();

  for (const tag of quickTags) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = tag;
    btn.className = 'btn btn-sm';
    btn.style.cssText = 'font-size: var(--font-2xs, 0.65rem); padding: 0.15rem 0.5rem; border-radius: 10px; background: var(--bg-input, #1e1e1e); border: 1px solid var(--border, #333); color: var(--text-muted, #808080); cursor: pointer;';
    btn.addEventListener('click', () => {
      if (activeTagSet.has(tag)) {
        activeTagSet.delete(tag);
        btn.style.background = 'var(--bg-input, #1e1e1e)';
        btn.style.borderColor = 'var(--border, #333)';
        btn.style.color = 'var(--text-muted, #808080)';
      } else {
        activeTagSet.add(tag);
        btn.style.background = 'var(--accent, #00d4ff)';
        btn.style.borderColor = 'var(--accent, #00d4ff)';
        btn.style.color = 'var(--bg-primary, #0a0a0a)';
      }
      saveNoteAndTags();
    });
    tagsDiv.appendChild(btn);
  }

  function saveNoteAndTags(): void {
    try {
      const sessions = JSON.parse(localStorage.getItem('squat_form_sessions') || '[]');
      if (sessions.length > 0) {
        const note = input.value.trim();
        const tags = Array.from(activeTagSet);
        if (note) sessions[0].notes = note;
        else delete sessions[0].notes;
        if (tags.length > 0) sessions[0].tags = tags;
        else delete sessions[0].tags;
        localStorage.setItem('squat_form_sessions', JSON.stringify(sessions));
      }
    } catch { /* ignore storage errors */ }
  }

  input.addEventListener('blur', saveNoteAndTags);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveNoteAndTags();
  });

  container.appendChild(input);
  container.appendChild(tagsDiv);

  // Insert after the share section or at end of results
  const shareSection = document.getElementById('share-section');
  if (shareSection?.parentNode) {
    shareSection.parentNode.insertBefore(container, shareSection.nextSibling);
  } else {
    section.appendChild(container);
  }
}

// ─── Exercise Suggestion Engine (G5) ───

function renderExerciseSuggestion(currentExercise: string): void {
  const existing = document.getElementById('exercise-suggestion');
  if (existing) existing.remove();

  const sessions = getSessions();
  if (sessions.length < 3) return; // Need enough history

  const section = document.getElementById('results-section');
  if (!section) return;

  const exerciseCounts: Record<string, number> = {};
  for (const s of sessions) {
    const ex = s.exercise_type ?? 'squat';
    exerciseCounts[ex] = (exerciseCounts[ex] ?? 0) + 1;
  }

  const total = sessions.length;
  let suggestion = '';

  const allExercises = ['squat', 'deadlift', 'bench_press'];
  const missing = allExercises.filter(ex => (exerciseCounts[ex] ?? 0) === 0);

  // Check if >80% are one exercise and another has 0 sessions
  for (const ex of allExercises) {
    if ((exerciseCounts[ex] ?? 0) / total > 0.8 && missing.length > 0) {
      const label = missing[0] === 'deadlift' ? 'deadlift' : missing[0] === 'bench_press' ? 'bench press' : 'squat';
      suggestion = `You have ${exerciseCounts[ex]} ${ex.replace('_', ' ')} sessions but none for ${label}. Try analyzing a ${label} set to check your form across lifts.`;
      break;
    }
  }

  // If no strong imbalance, check depth
  if (!suggestion) {
    const recentSquats = sessions.filter(s => (s.exercise_type ?? 'squat') === 'squat').slice(0, 5);
    const lowDepth = recentSquats.filter(s => s.avg_depth !== undefined && s.avg_depth < 60);
    if (lowDepth.length >= 3) {
      suggestion = 'Your depth scores have been consistently low. Consider adding mobility work -- ankle and hip stretches before squatting can help.';
    }
  }

  // All squats? Suggest deadlift
  if (!suggestion && (exerciseCounts['squat'] ?? 0) === total && total >= 5) {
    suggestion = 'All your sessions are squats. Try analyzing a deadlift set to check your hip hinge pattern.';
  }

  if (!suggestion) return;

  const card = document.createElement('div');
  card.id = 'exercise-suggestion';
  card.className = 'card card--static';
  card.style.cssText = 'margin-top: 0.75rem; padding: 0.75rem; border-left: 3px solid var(--info, #60a5fa);';
  card.innerHTML = `
    <div style="font-size: var(--font-xs, 0.75rem); font-weight: 600; color: var(--info, #60a5fa); margin-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.5px;">Suggestion</div>
    <div style="font-size: var(--font-sm, 0.875rem); color: var(--text-secondary, #b0b0b0);">${suggestion}</div>
  `;

  // Insert at end of results, before post-results CTA
  const cta = document.getElementById('post-results-cta');
  if (cta?.parentNode) {
    cta.parentNode.insertBefore(card, cta);
  } else {
    section.appendChild(card);
  }
}

// ─── Re-analyze with Cached Poses (G3) ───

/** Re-run analysis using cached pose data (skips pose detection). */
async function reanalyzeWithCachedPoses(): Promise<void> {
  if (!cachedFrameData || cachedFps <= 0) return;

  const compToggle = document.getElementById('competition-mode') as HTMLInputElement | null;
  const exerciseType = getExerciseType();

  const exerciseConfig: ExerciseConfig = {
    exerciseType,
    experienceLevel: experienceSelect.value as ExperienceLevel,
    competitionMode: compToggle?.checked ?? false,
    squatType: squatTypeSelect.value as SquatType,
    deadliftType: (deadliftTypeSelect?.value ?? 'conventional') as DeadliftType,
    benchType: (benchTypeSelect?.value ?? 'flat') as BenchType,
    ohpType: (ohpTypeSelect?.value ?? 'strict') as OverheadPressType,
    rowType: (rowTypeSelect?.value ?? 'bent_over') as BarBellRowType,
    lungeType: (lungeTypeSelect?.value ?? 'forward') as LungeType,
  };

  const analysis = analyzeExercise(cachedFrameData, cachedFps, exerciseConfig);
  if (analysis.repCount === 0) return;

  const rawWeight = parseFloat(weightInput.value);
  const weight = isFinite(rawWeight) ? rawWeight : 0;
  const unit = getWeightUnit();
  const oneRMEstimate = estimateOneRM(weight, analysis.repCount, unit);

  const previousSessions = getSessions();
  const selectedPhase = trainingPhaseSelect?.value as TrainingPhase | '' | undefined;
  const trainingPhase: TrainingPhase | undefined = selectedPhase
    ? selectedPhase as TrainingPhase
    : suggestNextPhase(
        previousSessions.map(s => ({ score: s.overall_score, date: s.date })),
      ).phase;

  showResults(analysis, cachedFrameData, previousSessions, oneRMEstimate, cachedFps, trainingPhase, exerciseType);

  // Setup annotated playback
  resultVideo.currentTime = 0;
  setupVideoPlayback(resultVideo, overlayCanvas, cachedFrameData, analysis, cachedFps);
}

// Export for use in ui-results.ts
(window as unknown as Record<string, unknown>).__reanalyzeWithCachedPoses = reanalyzeWithCachedPoses;
(window as unknown as Record<string, unknown>).__hasCachedPoses = () => cachedFrameData !== null && cachedFps > 0;

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

// ─── Offline Status Indicator (G1) ───

function initOfflineStatus(): void {
  const statusEl = document.getElementById('offline-status');
  if (!statusEl) return;

  function updateStatus(): void {
    if (!navigator.onLine) {
      statusEl!.textContent = 'Offline';
      statusEl!.className = 'offline-status offline';
    } else if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      statusEl!.textContent = 'Ready offline';
      statusEl!.className = 'offline-status ready';
    } else {
      statusEl!.textContent = 'Loading AI model...';
      statusEl!.className = 'offline-status loading';
    }
  }

  // Initial state
  updateStatus();

  // When model pre-warm finishes (PoseProcessor init succeeded), mark as ready
  // We observe the service worker registration as a proxy
  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);

  // Check periodically if model has been cached (short-lived interval)
  let checkCount = 0;
  const checkInterval = setInterval(() => {
    checkCount++;
    if (checkCount > 30) {
      clearInterval(checkInterval);
      return;
    }
    // If service worker is controlling the page, the model is cached
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      statusEl.textContent = 'Ready offline';
      statusEl.className = 'offline-status ready';
      clearInterval(checkInterval);
    }
  }, 2000);

  // Also update when service worker becomes active
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      statusEl.textContent = 'Ready offline';
      statusEl.className = 'offline-status ready';
    });
  }
}

initOfflineStatus();

// Show onboarding for first-time visitors (prescreen merged in)
initOnboarding();
initWarmupCard();
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

// Competition mode visibility is managed by updateAdvancedSettingsVisibility()
// which shows it for intermediate/advanced and hides it for beginners.

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

// ─── Keyboard Shortcuts ───

document.addEventListener('keydown', (e: KeyboardEvent) => {
  // Guard: don't fire when user is typing in an input/select/textarea
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

  switch (e.key) {
    case 'h':
    case 'H': {
      const historySection = document.getElementById('history-section');
      if (historySection && historySection.style.display !== 'none') {
        historySection.scrollIntoView({ behavior: 'smooth' });
      }
      break;
    }
    case 'n':
    case 'N': {
      // Focus the file input / start new analysis
      const uploadSection = document.getElementById('upload-section');
      if (uploadSection) {
        uploadSection.scrollIntoView({ behavior: 'smooth' });
        videoInput?.focus();
      }
      break;
    }
    case 'Escape': {
      // Close any open modal/overlay
      const overlays = document.querySelectorAll<HTMLElement>(
        '#confirm-modal-overlay, #goal-modal-overlay, .warmup-overlay, #goal-celebration-overlay',
      );
      for (const overlay of overlays) {
        overlay.remove();
      }
      break;
    }
    case '1': case '2': case '3': case '4': case '5':
    case '6': case '7': case '8': case '9': {
      // Jump to rep N in results
      const repIndex = parseInt(e.key) - 1;
      const repCards = document.querySelectorAll<HTMLElement>('.rep-card');
      if (repCards[repIndex]) {
        repCards[repIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
        repCards[repIndex].click();
      }
      break;
    }
  }
});

// ─── Shared Link Handling ───

const shared = decodeAnalysisUrl(location.hash);
if (shared) {
  const section = document.getElementById('results-section');
  if (section) {
    section.style.display = 'block';
    requestAnimationFrame(() => section.classList.add('visible'));
    // Remove existing shared view
    document.getElementById('shared-result-view')?.remove();

    const view = document.createElement('div');
    view.id = 'shared-result-view';
    view.className = 'card card--static';
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

    const gradeColorVal = safeGrade === 'A' ? 'var(--grade-a)' : safeGrade === 'B' ? 'var(--grade-b)' : safeGrade === 'C' ? 'var(--grade-c)' : 'var(--grade-d)';
    const weightInfo = shared.weight ? `${Number(shared.weight)} ${esc(String(shared.unit ?? 'lbs'))}` : '';
    const rmInfo = shared.estimated1rm ? `Est. 1RM: ${Number(shared.estimated1rm)} ${esc(String(shared.unit ?? 'lbs'))}` : '';

    view.style.setProperty('--grade-color', gradeColorVal);
    view.innerHTML = `
      <div class="shared-result-wrapper">
        <div class="shared-result-date">Shared Result -- ${safeDate}</div>
        <div class="shared-result-circle">
          <div class="shared-result-grade">${safeGrade}</div>
          <div class="shared-result-score">${safeScore}/100</div>
        </div>
        <div class="shared-result-meta">
          ${safeReps} reps | ${safeType} | ${safeLevel}
          ${weightInfo ? ` | ${weightInfo}` : ''}
        </div>
        ${rmInfo ? `<div class="shared-result-1rm">${rmInfo}</div>` : ''}
        ${safeIssues ? `<div class="shared-result-issues">Top issues: ${safeIssues}</div>` : ''}
        <div class="shared-result-action">
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
