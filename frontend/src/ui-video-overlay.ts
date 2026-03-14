/**
 * Video playback with skeleton overlay: play/pause, speed controls,
 * frame-by-frame navigation, rep selector, keyboard shortcuts.
 */

import type { SetAnalysis, FrameData, FormIssue } from './types';
import { computeFrameAngles } from './angles';
import { getPhases } from './phases';
import { drawSkeleton, drawPhaseOverlay, drawAngleLabels } from './ui-skeleton';
import { supportsVideoExport, exportAnnotatedVideo } from './video-export';

export interface PlaybackState {
  animFrameId: number | null;
  isPlaying: boolean;
  currentSpeed: number;
  keyboardListenerAttached: boolean;
}

// Track if keyboard listeners are already attached globally
let _globalKeyboardAttached = false;

// Track active animation frame for cancellation across calls
let _activeAnimFrameId: number | null = null;

// AbortController to clean up video event listeners between calls
let _videoListenerController: AbortController | null = null;

/**
 * Set up annotated video playback with skeleton overlay.
 */
export function setupVideoPlayback(
  videoEl: HTMLVideoElement,
  canvasEl: HTMLCanvasElement,
  frameData: FrameData,
  analysis: SetAnalysis,
  processingFps: number,
): void {
  const ctx = canvasEl.getContext('2d');
  if (!ctx) return;

  // Cancel any previously running animation frame from a prior analysis
  if (_activeAnimFrameId !== null) {
    cancelAnimationFrame(_activeAnimFrameId);
    _activeAnimFrameId = null;
  }

  const state: PlaybackState = {
    animFrameId: null,
    isPlaying: false,
    currentSpeed: 1,
    keyboardListenerAttached: false,
  };

  // Build a sorted array of frame times for fast lookup
  const sortedFrameIndices = Array.from(frameData.keys()).sort((a, b) => a - b);
  const frameInterval = 1 / processingFps;

  // Build knee angle array for phase detection overlay
  const kneeAngles = sortedFrameIndices.map((fi) => {
    const lm = frameData.get(fi)!;
    return computeFrameAngles(lm).kneeAngle;
  });
  const phases = getPhases(kneeAngles);

  // Build issue map: frame -> issues
  const frameIssues = new Map<number, FormIssue[]>();
  for (const rep of analysis.reps) {
    for (const issue of rep.issues) {
      const existing = frameIssues.get(issue.frame) ?? [];
      existing.push(issue);
      frameIssues.set(issue.frame, existing);
    }
  }

  /** Find the closest processed frame index for a given video time (binary search). */
  function closestFrame(time: number): number {
    const target = Math.round(time / frameInterval);
    if (sortedFrameIndices.length === 0) return 0;
    let lo = 0, hi = sortedFrameIndices.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedFrameIndices[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    // Check if lo-1 is closer than lo
    if (lo > 0 && Math.abs(sortedFrameIndices[lo - 1] - target) <= Math.abs(sortedFrameIndices[lo] - target)) {
      return sortedFrameIndices[lo - 1];
    }
    return sortedFrameIndices[lo];
  }

  /** Find the array index of a frame in sortedFrameIndices. */
  function frameArrayIndex(frameNum: number): number {
    return sortedFrameIndices.indexOf(frameNum);
  }

  /** Draw the overlay for the current video time. */
  function drawOverlay(): void {
    if (!ctx) return;

    // Match canvas resolution to its display size
    const rect = canvasEl.getBoundingClientRect();
    if (canvasEl.width !== rect.width || canvasEl.height !== rect.height) {
      canvasEl.width = rect.width;
      canvasEl.height = rect.height;
    }

    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    const frameNum = closestFrame(videoEl.currentTime);
    const landmarks = frameData.get(frameNum);
    if (!landmarks) return;

    const issues = frameIssues.get(frameNum) ?? [];
    const arrIdx = frameArrayIndex(frameNum);
    const phase = arrIdx >= 0 && arrIdx < phases.length ? phases[arrIdx] : 'standing';

    // Determine current rep
    const repIdx = analysis.repFrameMap.get(frameNum) ?? -1;

    drawSkeleton(ctx, landmarks, issues, canvasEl.width, canvasEl.height);
    drawPhaseOverlay(ctx, phase, repIdx, canvasEl.width);
    drawAngleLabels(ctx, landmarks, canvasEl.width, canvasEl.height);
  }

  /** Animation loop for playback. */
  function animate(): void {
    drawOverlay();
    if (state.isPlaying) {
      const id = requestAnimationFrame(animate);
      state.animFrameId = id;
      _activeAnimFrameId = id;
    }
  }

  // Wire up play/pause -- clone-and-replace to strip stale listeners from previous analyses
  const playBtnOld = document.getElementById('play-pause-btn');
  const playBtn = playBtnOld ? playBtnOld.cloneNode(true) as HTMLElement : null;
  if (playBtnOld && playBtn) {
    playBtnOld.replaceWith(playBtn);
  }
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (state.isPlaying) {
        videoEl.pause();
        state.isPlaying = false;
        playBtn.textContent = 'Play';
        if (state.animFrameId !== null) {
          cancelAnimationFrame(state.animFrameId);
          _activeAnimFrameId = null;
        }
      } else {
        videoEl.play();
        state.isPlaying = true;
        playBtn.textContent = 'Pause';
        animate();
      }
    });
  }

  // Speed controls -- clone-and-replace each to strip stale listeners
  document.querySelectorAll<HTMLButtonElement>('.speed-btn').forEach((oldBtn) => {
    const newBtn = oldBtn.cloneNode(true) as HTMLButtonElement;
    oldBtn.replaceWith(newBtn);
    newBtn.addEventListener('click', () => {
      const speed = parseFloat(newBtn.dataset.speed ?? '1');
      videoEl.playbackRate = speed;
      state.currentSpeed = speed;
      document.querySelectorAll<HTMLButtonElement>('.speed-btn').forEach((b) => b.classList.remove('active'));
      newBtn.classList.add('active');
    });
  });

  // Frame-by-frame navigation -- clone-and-replace to strip stale listeners
  const prevBtnOld = document.getElementById('prev-frame-btn');
  const prevBtn = prevBtnOld ? prevBtnOld.cloneNode(true) as HTMLElement : null;
  if (prevBtnOld && prevBtn) prevBtnOld.replaceWith(prevBtn);

  const nextBtnOld = document.getElementById('next-frame-btn');
  const nextBtn = nextBtnOld ? nextBtnOld.cloneNode(true) as HTMLElement : null;
  if (nextBtnOld && nextBtn) nextBtnOld.replaceWith(nextBtn);

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      videoEl.pause();
      state.isPlaying = false;
      if (playBtn) playBtn.textContent = 'Play';
      videoEl.currentTime = Math.max(0, videoEl.currentTime - frameInterval);
      setTimeout(drawOverlay, 50);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      videoEl.pause();
      state.isPlaying = false;
      if (playBtn) playBtn.textContent = 'Play';
      videoEl.currentTime = Math.min(videoEl.duration, videoEl.currentTime + frameInterval);
      setTimeout(drawOverlay, 50);
    });
  }

  // Keyboard shortcuts -- scoped to the video container to avoid breaking page interaction
  const videoContainer = document.querySelector('.video-container') || document.querySelector('.results-layout');
  if (videoContainer && !_globalKeyboardAttached) {
    _globalKeyboardAttached = true;
    (videoContainer as HTMLElement).setAttribute('tabindex', '-1');
    (videoContainer as HTMLElement).addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevBtn?.click();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextBtn?.click();
      } else if (e.key === ' ') {
        e.preventDefault();
        playBtn?.click();
      }
    });
  }

  // Download annotated video button
  const videoControls = document.querySelector('.video-controls');
  if (videoControls && supportsVideoExport()) {
    // Remove existing download button from prior analyses
    const existingDlBtn = document.getElementById('download-video-btn');
    if (existingDlBtn) existingDlBtn.remove();

    const dlBtn = document.createElement('button');
    dlBtn.id = 'download-video-btn';
    dlBtn.textContent = 'Download Video';
    dlBtn.setAttribute('aria-label', 'Download video with skeleton overlay');
    videoControls.appendChild(dlBtn);

    dlBtn.addEventListener('click', async () => {
      dlBtn.disabled = true;
      dlBtn.textContent = 'Exporting 0%...';

      try {
        const blobUrl = await exportAnnotatedVideo(
          videoEl,
          canvasEl,
          (pct) => {
            dlBtn.textContent = `Exporting ${pct}%...`;
          },
        );

        // Trigger download
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = 'squat-annotated.webm';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // Clean up blob after a short delay
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);

        dlBtn.textContent = 'Download Video';
        dlBtn.disabled = false;

        // Reset playback state
        videoEl.pause();
        state.isPlaying = false;
        if (playBtn) playBtn.textContent = 'Play';
        videoEl.currentTime = 0;
      } catch (err) {
        dlBtn.textContent = 'Export Failed';
        dlBtn.disabled = false;
        setTimeout(() => { dlBtn.textContent = 'Download Video'; }, 3000);
        console.error('Video export error:', err);
      }
    });
  }

  // Rep selector buttons
  const repSelector = document.getElementById('rep-selector');
  if (repSelector) {
    // Clear existing buttons (from previous analysis runs)
    const existingBtns = repSelector.querySelectorAll('button');
    existingBtns.forEach((b) => b.remove());

    for (let i = 0; i < analysis.repStartFrames.length; i++) {
      const btn = document.createElement('button');
      btn.className = 'btn-sm';
      btn.textContent = `${i + 1}`;
      btn.setAttribute('aria-label', `Jump to rep ${i + 1}`);
      btn.addEventListener('click', () => {
        const frameNum = analysis.repStartFrames[i];
        const time = frameNum * frameInterval;
        videoEl.currentTime = time;
        videoEl.pause();
        state.isPlaying = false;
        if (playBtn) playBtn.textContent = 'Play';
        setTimeout(drawOverlay, 50);

        // Highlight active rep card
        document.querySelectorAll('.rep-card').forEach((card) => {
          card.classList.remove('active');
        });
        const repCard = document.querySelector(`.rep-card[data-rep-index="${i}"]`);
        if (repCard) repCard.classList.add('active');
      });
      repSelector.appendChild(btn);
    }
  }

  // Rep card click -> seek to rep
  document.querySelectorAll('.rep-card').forEach((card) => {
    card.addEventListener('click', () => {
      const idx = parseInt((card as HTMLElement).dataset.repIndex ?? '0', 10);
      if (idx < analysis.repStartFrames.length) {
        const frameNum = analysis.repStartFrames[idx];
        const time = frameNum * frameInterval;
        videoEl.currentTime = time;
        videoEl.pause();
        state.isPlaying = false;
        if (playBtn) playBtn.textContent = 'Play';
        setTimeout(drawOverlay, 50);

        document.querySelectorAll('.rep-card').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
      }
    });
  });

  // Clean up previous video listeners to prevent accumulation
  if (_videoListenerController) _videoListenerController.abort();
  _videoListenerController = new AbortController();
  const signal = _videoListenerController.signal;

  // Draw overlay on seek / time update
  videoEl.addEventListener('seeked', () => {
    drawOverlay();
  }, { signal });

  videoEl.addEventListener('timeupdate', () => {
    if (!state.isPlaying) {
      drawOverlay();
    }
  }, { signal });

  videoEl.addEventListener('ended', () => {
    state.isPlaying = false;
    if (playBtn) playBtn.textContent = 'Play';
    if (state.animFrameId !== null) {
      cancelAnimationFrame(state.animFrameId);
    }
  }, { signal });

  // Initial draw
  videoEl.currentTime = 0;
  setTimeout(drawOverlay, 100);
}
