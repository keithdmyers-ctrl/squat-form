/**
 * Live webcam mode: camera access, real-time pose overlay,
 * rep counting, and session result display.
 */

import { PoseProcessor } from './pose';
import { LiveAnalyzer } from './live';
import type { LiveConfig, LiveCallbacks } from './live';
import { SquatPhase } from './types';
import type { SquatType, ExperienceLevel, Landmarks, FrameAngles } from './types';
import {
  hideError,
  showResults,
  drawSkeleton,
  scoreColor,
} from './ui';
import { showErrorCard } from './ui-progress';
import { getSessions, saveSession, saveSettings } from './storage';

/** Phase labels for the overlay */
const PHASE_LABELS: Record<string, string> = {
  standing: 'Standing',
  descending: 'Going Down',
  bottom: 'Bottom',
  ascending: 'Coming Up',
};

const PHASE_CSS_CLASS: Record<string, string> = {
  standing: 'phase-standing',
  descending: 'phase-descending',
  bottom: 'phase-bottom',
  ascending: 'phase-ascending',
};

function drawLiveOverlay(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmarks,
  phase: string,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);

  // Draw skeleton (no issues during live -- issues are computed per rep)
  drawSkeleton(ctx, landmarks, [], width, height);

  // Draw phase text overlay in bottom center
  const phaseLabel = PHASE_LABELS[phase] ?? phase;
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  const metrics = ctx.measureText(phaseLabel);
  const textX = width / 2;
  const textY = height - 20;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(textX - metrics.width / 2 - 10, textY - 16, metrics.width + 20, 24);

  let phaseColor = '#00d4ff';
  if (phase === 'descending') phaseColor = '#fbbf24';
  if (phase === 'bottom') phaseColor = '#4ade80';
  if (phase === 'ascending') phaseColor = '#fb923c';

  ctx.fillStyle = phaseColor;
  ctx.fillText(phaseLabel, textX, textY);
}

/** Update mirror transform based on current facing mode. Only mirror front camera. */
function updateMirror(currentFacingMode: 'user' | 'environment'): void {
  const wrapper = document.querySelector('.live-video-wrapper') as HTMLElement | null;
  if (!wrapper) return;
  const videoEl = wrapper.querySelector('video') as HTMLVideoElement | null;
  const canvasEl = wrapper.querySelector('canvas') as HTMLCanvasElement | null;
  const mirror = currentFacingMode === 'user';
  if (videoEl) videoEl.style.transform = mirror ? 'scaleX(-1)' : 'none';
  if (canvasEl) canvasEl.style.transform = mirror ? 'scaleX(-1)' : 'none';
}

/** Dependencies that live mode needs from the main module. */
export interface LiveModeDeps {
  squatTypeSelect: HTMLSelectElement;
  experienceSelect: HTMLSelectElement;
  initHistorySection: () => void;
}

/** Initialize all live mode DOM references and event listeners. */
export function initLiveMode(deps: LiveModeDeps): void {
  const liveVideo = document.getElementById('live-video') as HTMLVideoElement | null;
  const liveOverlay = document.getElementById('live-overlay') as HTMLCanvasElement | null;
  const liveStartBtn = document.getElementById('live-start') as HTMLButtonElement | null;
  const liveStopBtn = document.getElementById('live-stop') as HTMLButtonElement | null;
  const livePhaseBadge = document.getElementById('live-phase');
  const liveRepCountBadge = document.getElementById('live-rep-count');
  const liveScoreDisplay = document.getElementById('live-score-display');
  const liveScoreValue = document.getElementById('live-score-value');
  const liveScoreGrade = document.getElementById('live-score-grade');
  const audioEnabledCheckbox = document.getElementById('audio-enabled') as HTMLInputElement | null;
  const liveFeedback = document.getElementById('live-feedback');
  const liveFeedbackText = document.getElementById('live-feedback-text');
  const liveSquatTypeSelect = document.getElementById('live-squat-type') as HTMLSelectElement | null;
  const liveExperienceSelect = document.getElementById('live-experience-level') as HTMLSelectElement | null;

  let livePoseProcessor: PoseProcessor | null = null;
  let liveAnalyzer: LiveAnalyzer | null = null;
  let liveAnimFrameId: number | null = null;
  let liveStream: MediaStream | null = null;
  let lastLiveProcessTime = 0;
  let currentFacingMode: 'user' | 'environment' = 'environment';
  let calibrationTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let currentPhaseKey: string = 'standing';
  let overlayResizeObserver: ResizeObserver | null = null;
  let observedOverlayWidth = 0;
  let observedOverlayHeight = 0;
  let wakeLockSentinel: any = null;

  // Target ~20 fps for pose processing (50ms interval) — feasible with lite model
  const LIVE_FRAME_INTERVAL_MS = 50;
  // When standing idle, process less often to save CPU/battery
  const LIVE_FRAME_INTERVAL_IDLE_MS = 132;

  // Wire audio toggle once (Fix: prevent listener leak from repeated startLiveSession calls)
  audioEnabledCheckbox?.addEventListener('change', () => {
    liveAnalyzer?.setAudioEnabled(audioEnabledCheckbox.checked);
  });

  // ─── Sync Live Settings with Upload Settings ───

  // Initialize live settings from saved settings or upload panel values
  if (liveSquatTypeSelect) {
    liveSquatTypeSelect.value = deps.squatTypeSelect.value;
  }
  if (liveExperienceSelect) {
    liveExperienceSelect.value = deps.experienceSelect.value;
  }

  // Sync upload -> live settings
  deps.squatTypeSelect.addEventListener('change', () => {
    if (liveSquatTypeSelect) liveSquatTypeSelect.value = deps.squatTypeSelect.value;
  });
  deps.experienceSelect.addEventListener('change', () => {
    if (liveExperienceSelect) liveExperienceSelect.value = deps.experienceSelect.value;
  });

  // Sync live -> upload settings
  liveSquatTypeSelect?.addEventListener('change', () => {
    deps.squatTypeSelect.value = liveSquatTypeSelect.value;
    saveSettings(deps.squatTypeSelect.value, deps.experienceSelect.value);
  });
  liveExperienceSelect?.addEventListener('change', () => {
    deps.experienceSelect.value = liveExperienceSelect.value;
    saveSettings(deps.squatTypeSelect.value, deps.experienceSelect.value);
  });

  /** Switch camera between front and rear. */
  async function switchCamera(): Promise<void> {
    if (!liveVideo) return;

    // Stop current stream
    if (liveStream) {
      for (const track of liveStream.getTracks()) {
        track.stop();
      }
      liveStream = null;
    }

    // Toggle facing mode
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

    try {
      liveStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: currentFacingMode,
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });

      liveVideo.srcObject = liveStream;
      await new Promise<void>((resolve) => {
        liveVideo!.onloadedmetadata = () => resolve();
      });

      updateMirror(currentFacingMode);
    } catch (err) {
      showErrorCard(
        'Could not switch camera. Your device may only have one camera.',
        'generic',
        () => { switchCamera(); },
        null,
      );
      // Try to revert
      currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    }
  }

  const liveSwitchCameraBtn = document.getElementById('live-switch-camera') as HTMLButtonElement | null;
  liveSwitchCameraBtn?.addEventListener('click', () => {
    switchCamera();
  });

  async function startLiveSession(): Promise<void> {
    if (!liveVideo || !liveOverlay) return;

    // Clean up any previous session resources to prevent listener/resource accumulation
    stopLiveSession(false);

    // Reset UI
    hideError();
    const resultsSection = document.getElementById('results-section');
    if (resultsSection) resultsSection.style.display = 'none';

    if (liveStartBtn) liveStartBtn.style.display = 'none';
    if (liveStopBtn) liveStopBtn.style.display = '';
    if (liveSwitchCameraBtn) liveSwitchCameraBtn.style.display = '';
    if (livePhaseBadge) {
      livePhaseBadge.textContent = 'Starting...';
      livePhaseBadge.className = 'phase-badge';
    }
    if (liveRepCountBadge) liveRepCountBadge.textContent = '0 reps';
    if (liveScoreDisplay) liveScoreDisplay.style.display = 'none';
    if (liveFeedback) liveFeedback.style.display = 'none';

    // Disable settings during active session
    if (liveSquatTypeSelect) {
      liveSquatTypeSelect.disabled = true;
      liveSquatTypeSelect.title = 'Settings locked during session';
    }
    if (liveExperienceSelect) {
      liveExperienceSelect.disabled = true;
      liveExperienceSelect.title = 'Settings locked during session';
    }

    try {
      // Request camera
      liveStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: currentFacingMode,
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });

      liveVideo.srcObject = liveStream;

      // Mirror only front-facing camera
      updateMirror(currentFacingMode);
      await new Promise<void>((resolve) => {
        liveVideo!.onloadedmetadata = () => resolve();
      });

      // Keep screen on during live session (mobile gym use)
      try {
        if ('wakeLock' in navigator) {
          wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        }
      } catch {
        // Wake Lock not supported or denied -- not critical
      }

      // Initialize PoseProcessor in live stream mode
      livePoseProcessor = new PoseProcessor();

      const compToggle = document.getElementById('competition-mode') as HTMLInputElement | null;
      const liveConfig: LiveConfig = {
        squatType: (liveSquatTypeSelect?.value ?? deps.squatTypeSelect.value) as SquatType,
        experienceLevel: (liveExperienceSelect?.value ?? deps.experienceSelect.value) as ExperienceLevel,
        competitionMode: compToggle?.checked ?? false,
        audioEnabled: audioEnabledCheckbox?.checked ?? true,
      };

      const callbacks: LiveCallbacks = {
        onFrameProcessed: (_landmarks: Landmarks, _angles: FrameAngles, _phase: SquatPhase) => {
          // Update calibration progress indicator
          if (liveAnalyzer && !liveAnalyzer.isCalibrated() && livePhaseBadge) {
            const progress = liveAnalyzer.getCalibrationProgress();
            if (progress.current > 0) {
              livePhaseBadge.textContent = `Calibrating... ${progress.current}/${progress.required} frames`;
            }
          }
        },
        onRepComplete: (repScore, repNumber) => {
          // Haptic feedback on rep complete (mobile)
          if ('vibrate' in navigator) {
            if (repScore.issues.length > 0) {
              navigator.vibrate([100, 50, 100]); // double pulse for form issue
            } else {
              navigator.vibrate(150); // single pulse for good rep
            }
          }

          // Update rep count
          if (liveRepCountBadge) {
            liveRepCountBadge.textContent = `${repNumber} rep${repNumber !== 1 ? 's' : ''}`;
          }

          // Show live score with animation
          if (liveScoreDisplay && liveScoreValue && liveScoreGrade) {
            liveScoreValue.textContent = String(repScore.overallScore);
            liveScoreValue.style.color = scoreColor(repScore.overallScore);
            liveScoreGrade.textContent = repScore.grade;
            liveScoreGrade.style.color = scoreColor(repScore.overallScore);
            liveScoreDisplay.style.display = '';
            // Re-trigger animation
            liveScoreDisplay.style.animation = 'none';
            // Force reflow
            void liveScoreDisplay.offsetHeight;
            liveScoreDisplay.style.animation = '';
          }

          // Show feedback card with top cue or positive feedback
          if (liveFeedback && liveFeedbackText) {
            let feedbackMsg = '';
            if (repScore.cues.length > 0) {
              feedbackMsg = repScore.cues[0].cue;
            } else if (repScore.positiveFeedback.length > 0) {
              feedbackMsg = repScore.positiveFeedback[0];
            }
            if (feedbackMsg) {
              liveFeedbackText.textContent = feedbackMsg;
              liveFeedback.style.display = '';
            }
          }
        },
        onCalibrated: () => {
          if (calibrationTimeoutId !== null) {
            clearTimeout(calibrationTimeoutId);
            calibrationTimeoutId = null;
          }
          if (livePhaseBadge) {
            livePhaseBadge.textContent = 'Calibrated -- Go!';
            livePhaseBadge.className = 'phase-badge phase-calibrated';
          }
        },
        onPhaseChange: (phase: SquatPhase) => {
          currentPhaseKey = phase;
          if (livePhaseBadge) {
            livePhaseBadge.textContent = PHASE_LABELS[phase] ?? phase;
            livePhaseBadge.className = `phase-badge ${PHASE_CSS_CLASS[phase] ?? ''}`;
          }
        },
        onError: (message: string) => {
          showErrorCard(
            message,
            'generic',
            () => { startLiveSession(); },
            null,
          );
        },
      };

      liveAnalyzer = new LiveAnalyzer(liveConfig, callbacks);

      // Store latest landmarks for drawing
      let latestLandmarks: Landmarks | null = null;

      await livePoseProcessor.initLiveStream((landmarks, _timestampMs) => {
        if (landmarks) {
          liveAnalyzer?.processFrame(landmarks);
          latestLandmarks = landmarks;
        }
      });

      if (livePhaseBadge) {
        livePhaseBadge.textContent = 'Stand Still to Calibrate';
        livePhaseBadge.className = 'phase-badge';
      }

      // Calibration timeout: show help message after 30 seconds
      calibrationTimeoutId = setTimeout(() => {
        if (liveAnalyzer && !liveAnalyzer.isCalibrated() && livePhaseBadge) {
          livePhaseBadge.textContent = 'Having trouble? Make sure your full body is visible and you\'re standing upright.';
          livePhaseBadge.className = 'phase-badge';
        }
        calibrationTimeoutId = null;
      }, 30000);

      // Animation loop: process frames and draw overlay
      function liveLoop(timestamp: number): void {
        if (!liveVideo || !liveOverlay || !livePoseProcessor) return;

        // Adaptive frame skipping: process less often when standing idle
        const interval = currentPhaseKey === 'standing'
          ? LIVE_FRAME_INTERVAL_IDLE_MS
          : LIVE_FRAME_INTERVAL_MS;
        if (timestamp - lastLiveProcessTime >= interval) {
          lastLiveProcessTime = timestamp;
          livePoseProcessor.processLiveFrame(liveVideo, Math.round(performance.now()));
        }

        // Draw overlay every frame for smooth rendering
        const ctx = liveOverlay.getContext('2d');
        if (ctx && latestLandmarks) {
          if (liveOverlay.width !== observedOverlayWidth || liveOverlay.height !== observedOverlayHeight) {
            liveOverlay.width = observedOverlayWidth;
            liveOverlay.height = observedOverlayHeight;
          }
          drawLiveOverlay(ctx, latestLandmarks, currentPhaseKey, liveOverlay.width, liveOverlay.height);
        }

        if (currentPhaseKey === 'standing') {
          liveAnimFrameId = window.setTimeout(() => {
            liveAnimFrameId = requestAnimationFrame(liveLoop);
          }, LIVE_FRAME_INTERVAL_IDLE_MS) as unknown as number;
        } else {
          liveAnimFrameId = requestAnimationFrame(liveLoop);
        }
      }

      // Track overlay size via ResizeObserver (avoids getBoundingClientRect every frame)
      observedOverlayWidth = liveOverlay.clientWidth;
      observedOverlayHeight = liveOverlay.clientHeight;
      overlayResizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          observedOverlayWidth = entry.contentRect.width;
          observedOverlayHeight = entry.contentRect.height;
        }
      });
      overlayResizeObserver.observe(liveOverlay);

      liveAnimFrameId = requestAnimationFrame(liveLoop);

    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        showErrorCard(
          'Camera permission denied. Please allow camera access in your browser settings, then try again.',
          'generic',
          () => { startLiveSession(); },
          null,
        );
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        showErrorCard(
          'No camera found. Make sure your device has a webcam connected.',
          'generic',
          () => { startLiveSession(); },
          () => {
            // Switch to upload mode
            const uploadTab = document.getElementById('mode-upload') as HTMLButtonElement | null;
            uploadTab?.click();
          },
          'Switch to Upload Mode',
        );
      } else {
        showErrorCard(
          err instanceof Error
            ? err.message
            : 'Could not access camera. Make sure no other app is using it.',
          'generic',
          () => { startLiveSession(); },
          () => {
            const uploadTab = document.getElementById('mode-upload') as HTMLButtonElement | null;
            uploadTab?.click();
          },
          'Switch to Upload Mode',
        );
      }
      stopLiveSession();
    }
  }

  function stopLiveSession(showResultsOnStop = true): void {
    // Release wake lock
    if (wakeLockSentinel) {
      wakeLockSentinel.release().catch(() => {});
      wakeLockSentinel = null;
    }

    // Clear calibration timeout
    if (calibrationTimeoutId !== null) {
      clearTimeout(calibrationTimeoutId);
      calibrationTimeoutId = null;
    }

    // Stop animation loop (handle both RAF and setTimeout scheduling)
    if (liveAnimFrameId !== null) {
      cancelAnimationFrame(liveAnimFrameId);
      clearTimeout(liveAnimFrameId);
      liveAnimFrameId = null;
    }

    // Disconnect overlay resize observer
    if (overlayResizeObserver) {
      overlayResizeObserver.disconnect();
      overlayResizeObserver = null;
    }

    // Stop camera
    if (liveStream) {
      for (const track of liveStream.getTracks()) {
        track.stop();
      }
      liveStream = null;
    }

    if (liveVideo) {
      liveVideo.srcObject = null;
    }

    // Cleanup pose processor
    livePoseProcessor?.closeLiveStream();
    livePoseProcessor?.close();
    livePoseProcessor = null;

    // Clear overlay
    if (liveOverlay) {
      const ctx = liveOverlay.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, liveOverlay.width, liveOverlay.height);
    }

    // Reset buttons
    if (liveStartBtn) liveStartBtn.style.display = '';
    if (liveStopBtn) liveStopBtn.style.display = 'none';
    if (liveSwitchCameraBtn) liveSwitchCameraBtn.style.display = 'none';

    // Re-enable settings after session
    if (liveSquatTypeSelect) {
      liveSquatTypeSelect.disabled = false;
      liveSquatTypeSelect.title = '';
    }
    if (liveExperienceSelect) {
      liveExperienceSelect.disabled = false;
      liveExperienceSelect.title = '';
    }

    // If we have results, show them (skip when called as cleanup before restart)
    if (showResultsOnStop) {
      if (liveAnalyzer && liveAnalyzer.getRepCount() > 0) {
        const analysis = liveAnalyzer.getResults();
        const previousSessions = getSessions();
        saveSession(analysis, liveSquatTypeSelect?.value ?? deps.squatTypeSelect.value, liveExperienceSelect?.value ?? deps.experienceSelect.value);
        showResults(analysis, new Map(), previousSessions);
        deps.initHistorySection();
      } else if (liveAnalyzer && liveAnalyzer.getRepCount() === 0) {
        showErrorCard(
          'No reps detected. Make sure you complete full squats \u2014 standing, down, and back to standing.',
          'no_reps',
          () => { startLiveSession(); },
          null,
        );
      }
    }

    liveAnalyzer = null;
  }

  liveStartBtn?.addEventListener('click', () => {
    startLiveSession().catch((err) => {
      console.error('Live session start failed:', err);
      if (livePhaseBadge) {
        livePhaseBadge.textContent = 'Failed to start -- please try again';
        livePhaseBadge.className = 'phase-badge';
      }
      stopLiveSession();
    });
  });

  liveStopBtn?.addEventListener('click', () => {
    stopLiveSession();
  });
}
