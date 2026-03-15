/**
 * Video playback with skeleton overlay: play/pause, speed controls,
 * frame-by-frame navigation, rep selector, keyboard shortcuts,
 * and optional frame-by-frame angle data viewer with sparkline.
 */

import type { SetAnalysis, FrameData, FormIssue, FrameAngles } from './types';
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

// ─── Angle Data Panel Helpers ───

/** Inject CSS for the angle data panel (idempotent). */
function injectAngleDataStyles(): void {
  if (document.getElementById('angle-data-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'angle-data-panel-styles';
  style.textContent = `
    .angle-data-wrapper {
      display: none;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }
    .angle-data-wrapper.visible {
      display: flex;
    }

    .angle-data-readout {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      padding: 0.5rem 0.75rem;
      background: var(--bg-card, #121212);
      border: 1px solid var(--border, #333333);
      border-radius: 6px;
      font: 0.75rem / 1.4 monospace;
      color: var(--text-primary, #e0e0e0);
    }
    .angle-data-readout .angle-label {
      color: var(--text-muted, #808080);
      margin-right: 0.25rem;
    }
    .angle-data-readout .angle-value {
      color: var(--accent, #00d4ff);
      font-weight: 600;
    }

    .angle-sparkline-container {
      position: relative;
      width: 100%;
      height: 60px;
      background: rgba(18, 18, 18, 0.85);
      border: 1px solid var(--border, #333333);
      border-radius: 6px;
      overflow: hidden;
    }
    .angle-sparkline-container canvas {
      display: block;
      width: 100%;
      height: 100%;
    }

    .angle-data-toggle {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.8rem;
      color: var(--text-muted, #808080);
      cursor: pointer;
      user-select: none;
      margin-top: 0.25rem;
    }
    .angle-data-toggle input {
      accent-color: var(--accent, #00d4ff);
    }
  `;
  document.head.appendChild(style);
}

/** Create (or find existing) angle data DOM elements under the video panel. */
function ensureAngleDataPanel(videoContainer: Element): {
  wrapper: HTMLElement;
  readout: HTMLElement;
  sparkCanvas: HTMLCanvasElement;
  toggle: HTMLInputElement;
} {
  let wrapper = videoContainer.parentElement?.querySelector('.angle-data-wrapper') as HTMLElement | null;
  if (wrapper) {
    // Re-use existing DOM from a prior analysis
    const readout = wrapper.querySelector('.angle-data-readout') as HTMLElement;
    const sparkCanvas = wrapper.querySelector('.angle-sparkline-container canvas') as HTMLCanvasElement;
    const toggle = videoContainer.parentElement!.querySelector<HTMLInputElement>('.angle-data-toggle input')!;
    return { wrapper, readout, sparkCanvas, toggle };
  }

  const parent = videoContainer.parentElement!;

  // Toggle checkbox
  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'angle-data-toggle';
  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.setAttribute('aria-label', 'Show frame-by-frame angle data');
  toggleLabel.appendChild(toggleInput);
  toggleLabel.appendChild(document.createTextNode('Show Angle Data'));

  // Wrapper (hidden by default)
  wrapper = document.createElement('div');
  wrapper.className = 'angle-data-wrapper';

  // Readout panel
  const readout = document.createElement('div');
  readout.className = 'angle-data-readout';
  readout.setAttribute('aria-live', 'polite');
  wrapper.appendChild(readout);

  // Sparkline container + canvas
  const sparkContainer = document.createElement('div');
  sparkContainer.className = 'angle-sparkline-container';
  const sparkCanvas = document.createElement('canvas');
  sparkCanvas.setAttribute('aria-hidden', 'true');
  sparkContainer.appendChild(sparkCanvas);
  wrapper.appendChild(sparkContainer);

  // Insert after the video container
  parent.appendChild(toggleLabel);
  parent.appendChild(wrapper);

  // Toggle visibility
  toggleInput.addEventListener('change', () => {
    wrapper!.classList.toggle('visible', toggleInput.checked);
  });

  return { wrapper, readout, sparkCanvas, toggle: toggleInput };
}

/** Update the text readout with angles for the given frame. */
function updateAngleReadout(readout: HTMLElement, angles: FrameAngles): void {
  const entries: { label: string; value: string }[] = [
    { label: 'Knee', value: `${Math.round(angles.kneeAngle)}\u00B0` },
    { label: 'Hip', value: `${Math.round(angles.hipAngle)}\u00B0` },
    { label: 'Trunk', value: `${Math.round(angles.trunkAngle)}\u00B0` },
  ];
  if (angles.elbowAngle !== undefined) {
    entries.push({ label: 'Elbow', value: `${Math.round(angles.elbowAngle)}\u00B0` });
  }

  readout.innerHTML = entries
    .map((e) => `<span><span class="angle-label">${e.label}:</span><span class="angle-value">${e.value}</span></span>`)
    .join('');
}

/** Draw the knee-angle sparkline and a vertical cursor at the current position. */
function drawSparkline(
  canvas: HTMLCanvasElement,
  kneeAngles: number[],
  currentIndex: number,
): void {
  const rect = canvas.getBoundingClientRect();
  const w = Math.round(rect.width * devicePixelRatio);
  const h = Math.round(rect.height * devicePixelRatio);
  if (w === 0 || h === 0) return;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, w, h);

  const n = kneeAngles.length;
  if (n < 2) return;

  // Determine Y range with padding
  let minA = Infinity, maxA = -Infinity;
  for (const a of kneeAngles) {
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
  }
  const range = maxA - minA || 1;
  const pad = 6 * devicePixelRatio;

  const toX = (i: number) => (i / (n - 1)) * w;
  const toY = (a: number) => pad + ((maxA - a) / range) * (h - 2 * pad);

  // Draw guide lines at min/max
  ctx.strokeStyle = 'rgba(128,128,128,0.3)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, toY(minA));
  ctx.lineTo(w, toY(minA));
  ctx.moveTo(0, toY(maxA));
  ctx.lineTo(w, toY(maxA));
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw min/max labels
  ctx.font = `${10 * devicePixelRatio}px monospace`;
  ctx.fillStyle = 'rgba(128,128,128,0.6)';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(maxA)}\u00B0`, w - 4 * devicePixelRatio, toY(maxA) + 12 * devicePixelRatio);
  ctx.fillText(`${Math.round(minA)}\u00B0`, w - 4 * devicePixelRatio, toY(minA) - 4 * devicePixelRatio);

  // Draw knee angle trace
  ctx.strokeStyle = '#00d4ff';
  ctx.lineWidth = 1.5 * devicePixelRatio;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = toX(i);
    const y = toY(kneeAngles[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Draw vertical cursor at current frame
  if (currentIndex >= 0 && currentIndex < n) {
    const cx = toX(currentIndex);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5 * devicePixelRatio;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.stroke();

    // Draw dot at current angle value
    const cy = toY(kneeAngles[currentIndex]);
    ctx.fillStyle = '#00d4ff';
    ctx.beginPath();
    ctx.arc(cx, cy, 3 * devicePixelRatio, 0, Math.PI * 2);
    ctx.fill();
  }
}

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

  // Pre-compute full angles for each frame (used by angle data panel)
  const frameAnglesMap = new Map<number, FrameAngles>();
  for (const fi of sortedFrameIndices) {
    const lm = frameData.get(fi)!;
    frameAnglesMap.set(fi, computeFrameAngles(lm));
  }

  // Build issue map: frame -> issues
  const frameIssues = new Map<number, FormIssue[]>();
  for (const rep of analysis.reps) {
    for (const issue of rep.issues) {
      const existing = frameIssues.get(issue.frame) ?? [];
      existing.push(issue);
      frameIssues.set(issue.frame, existing);
    }
  }

  // ─── Angle Data Panel Setup ───
  injectAngleDataStyles();
  const videoContainerEl = canvasEl.closest('.video-container');
  let anglePanel: ReturnType<typeof ensureAngleDataPanel> | null = null;
  if (videoContainerEl) {
    anglePanel = ensureAngleDataPanel(videoContainerEl);
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

    // Update angle data panel if visible
    if (anglePanel && anglePanel.toggle.checked) {
      const angles = frameAnglesMap.get(frameNum);
      if (angles) {
        updateAngleReadout(anglePanel.readout, angles);
        drawSparkline(anglePanel.sparkCanvas, kneeAngles, arrIdx);
      }
    }
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
