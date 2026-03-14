/**
 * Annotated video export: composites the video with the skeleton overlay
 * and records the result as a downloadable WebM file using MediaRecorder.
 */

/** Check if the browser supports MediaRecorder with a WebM video codec. */
export function supportsVideoExport(): boolean {
  if (typeof MediaRecorder === 'undefined') return false;
  try {
    return MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      || MediaRecorder.isTypeSupported('video/webm');
  } catch {
    return false;
  }
}

/**
 * Export the video with its skeleton overlay baked in.
 *
 * Creates a hidden composite canvas, plays the video at 1x while drawing
 * each frame (video + overlay) and recording via MediaRecorder.
 *
 * @returns A blob URL pointing to the finished WebM file.
 */
export function exportAnnotatedVideo(
  videoEl: HTMLVideoElement,
  overlayCanvas: HTMLCanvasElement,
  onProgress: (pct: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!supportsVideoExport()) {
      reject(new Error('MediaRecorder API is not supported in this browser.'));
      return;
    }

    const width = videoEl.videoWidth || overlayCanvas.width || 640;
    const height = videoEl.videoHeight || overlayCanvas.height || 480;

    // Create a hidden composite canvas
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = width;
    compositeCanvas.height = height;
    const ctx = compositeCanvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Could not create canvas context for export.'));
      return;
    }

    // Set up MediaRecorder on the canvas stream
    const stream = compositeCanvas.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8'
      : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      resolve(url);
    };

    recorder.onerror = () => {
      reject(new Error('MediaRecorder encountered an error during export.'));
    };

    const duration = videoEl.duration;
    if (!isFinite(duration) || duration <= 0) {
      reject(new Error('Video duration is not available.'));
      return;
    }

    // Composite draw: video frame + overlay
    function drawComposite(): void {
      if (!ctx) return;
      ctx.drawImage(videoEl, 0, 0, width, height);
      // Draw the overlay canvas scaled to the composite size
      ctx.drawImage(overlayCanvas, 0, 0, width, height);
    }

    let animFrameId: number | null = null;

    function onTimeUpdate(): void {
      const pct = Math.min(100, Math.round((videoEl.currentTime / duration) * 100));
      onProgress(pct);
      drawComposite();
    }

    function onEnded(): void {
      cleanup();
      // Draw the final frame
      drawComposite();
      recorder.stop();
      onProgress(100);
    }

    function cleanup(): void {
      videoEl.removeEventListener('timeupdate', onTimeUpdate);
      videoEl.removeEventListener('ended', onEnded);
      if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
    }

    // Also run a rAF loop to capture frames more smoothly
    function animLoop(): void {
      if (videoEl.paused || videoEl.ended) return;
      drawComposite();
      animFrameId = requestAnimationFrame(animLoop);
    }

    videoEl.addEventListener('timeupdate', onTimeUpdate);
    videoEl.addEventListener('ended', onEnded);

    // Start from beginning, play at 1x
    videoEl.currentTime = 0;
    videoEl.playbackRate = 1;
    videoEl.muted = true;

    // Wait for seek to complete before starting
    const onSeeked = () => {
      videoEl.removeEventListener('seeked', onSeeked);
      drawComposite();
      recorder.start(100); // collect data every 100ms
      videoEl.play().then(() => {
        animLoop();
      }).catch((err) => {
        cleanup();
        reject(err);
      });
    };
    videoEl.addEventListener('seeked', onSeeked);
  });
}
