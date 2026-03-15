/**
 * Per-rep clip export using MediaRecorder API.
 * Records the composite canvas (video + skeleton overlay) for a single rep's duration.
 */

export interface ClipExportOptions {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement; // overlay canvas with skeleton
  startTime: number; // seconds
  endTime: number; // seconds
  fps: number;
  quality?: number; // 0-1, default 0.8
}

export interface ExportedClip {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  repIndex: number;
}

/**
 * Get the best supported MIME type for recording.
 */
export function getSupportedMimeType(): string {
  const types = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  for (const type of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return 'video/webm';
}

/**
 * Export a clip for a specific rep time range.
 * Uses MediaRecorder on a canvas stream for broad browser support.
 *
 * Composites the video frame and skeleton overlay onto an offscreen canvas,
 * then records the canvas stream from startTime to endTime.
 */
export async function exportRepClip(
  options: ClipExportOptions,
  repIndex: number,
): Promise<ExportedClip> {
  const { video, canvas, startTime, endTime, fps, quality = 0.8 } = options;

  if (startTime >= endTime) {
    throw new Error(`Invalid time range: startTime (${startTime}) must be less than endTime (${endTime})`);
  }
  if (fps <= 0) {
    throw new Error(`Invalid fps: ${fps}`);
  }

  const mimeType = getSupportedMimeType();
  const durationMs = (endTime - startTime) * 1000;

  // Create offscreen canvas that composites video + skeleton overlay
  const offscreen = document.createElement('canvas');
  offscreen.width = video.videoWidth || canvas.width;
  offscreen.height = video.videoHeight || canvas.height;
  const ctx = offscreen.getContext('2d')!;

  // Capture stream from the offscreen canvas
  const stream = offscreen.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: Math.round(2_500_000 * quality),
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  return new Promise<ExportedClip>((resolve, reject) => {
    recorder.onerror = () => reject(new Error('MediaRecorder error'));

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      resolve({
        blob,
        mimeType,
        durationMs,
        repIndex,
      });
    };

    // Seek to start, then begin recording
    const frameInterval = 1 / fps;
    let cancelled = false;

    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      recorder.start();

      const drawAndAdvance = () => {
        if (cancelled) return;

        // Composite: draw video frame, then overlay
        ctx.clearRect(0, 0, offscreen.width, offscreen.height);
        ctx.drawImage(video, 0, 0, offscreen.width, offscreen.height);
        ctx.drawImage(canvas, 0, 0, offscreen.width, offscreen.height);

        if (video.currentTime < endTime - frameInterval / 2) {
          video.currentTime = Math.min(video.currentTime + frameInterval, endTime);
          // Wait for the seek to complete before drawing the next frame
          video.addEventListener('seeked', drawAndAdvance, { once: true });
        } else {
          // Done — stop recorder after a small delay to flush last frame
          setTimeout(() => {
            if (recorder.state === 'recording') {
              recorder.stop();
            }
            stream.getTracks().forEach((t) => t.stop());
          }, 100);
        }
      };

      drawAndAdvance();
    };

    // Timeout safety to prevent hanging forever
    const timeout = setTimeout(() => {
      cancelled = true;
      if (recorder.state === 'recording') {
        recorder.stop();
      }
      stream.getTracks().forEach((t) => t.stop());
      reject(new Error('Clip export timed out'));
    }, Math.max(durationMs * 3, 30_000));

    recorder.onstop = () => {
      clearTimeout(timeout);
      const blob = new Blob(chunks, { type: mimeType });
      resolve({
        blob,
        mimeType,
        durationMs,
        repIndex,
      });
    };

    video.currentTime = startTime;
    video.addEventListener('seeked', onSeeked, { once: true });
  });
}

/**
 * Trigger download of a clip blob.
 */
export function downloadClip(clip: ExportedClip, filename: string): void {
  const url = URL.createObjectURL(clip.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Share a clip using Web Share API (mobile).
 * Falls back to download if sharing not supported.
 */
export async function shareClip(clip: ExportedClip, title: string): Promise<boolean> {
  if (navigator.share && navigator.canShare) {
    const file = new File([clip.blob], `${title}.webm`, { type: clip.mimeType });
    if (navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return true;
    }
  }
  downloadClip(clip, `${title}.webm`);
  return false;
}
