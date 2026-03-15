/**
 * Before/after video snapshot capture for session comparison.
 * Captures key frames (bottom of rep and lockout) as JPEG data URLs.
 */

export interface FrameSnapshot {
  dataUrl: string;  // JPEG data URL (~20KB each)
  phase: string;    // 'bottom' | 'lockout'
  repIndex: number;
  timestamp: number;  // frame index
}

/**
 * Capture video frames at key positions (bottom of rep and lockout).
 * Uses a canvas to extract JPEG data URLs from the video element.
 *
 * @param video The video element (must be loaded and seekable)
 * @param repBottomFrames Array of frame indices for the bottom position of each rep
 * @param repEndFrames Array of frame indices for the lockout position of each rep
 * @param fps Video processing frame rate
 * @param maxReps Limit to first N reps to save storage (default 2)
 * @returns Array of snapshots
 */
export async function captureSnapshots(
  video: HTMLVideoElement,
  repBottomFrames: number[],
  repEndFrames: number[],
  fps: number,
  maxReps: number = 2,
): Promise<FrameSnapshot[]> {
  if (fps <= 0 || repBottomFrames.length === 0) return [];

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  const snapshots: FrameSnapshot[] = [];
  const repsToCapture = Math.min(repBottomFrames.length, repEndFrames.length, maxReps);

  for (let i = 0; i < repsToCapture; i++) {
    const bottomFrame = repBottomFrames[i];
    const endFrame = repEndFrames[i];

    // Capture bottom position
    const bottomSnapshot = await seekAndCapture(video, canvas, ctx, bottomFrame, fps, 'bottom', i);
    if (bottomSnapshot) snapshots.push(bottomSnapshot);

    // Capture lockout position
    const lockoutSnapshot = await seekAndCapture(video, canvas, ctx, endFrame, fps, 'lockout', i);
    if (lockoutSnapshot) snapshots.push(lockoutSnapshot);
  }

  return snapshots;
}

/**
 * Seek video to a specific frame and capture it as a JPEG data URL.
 */
async function seekAndCapture(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  frameIndex: number,
  fps: number,
  phase: string,
  repIndex: number,
): Promise<FrameSnapshot | null> {
  try {
    const time = frameIndex / fps;
    // Clamp to video duration
    const clampedTime = Math.min(time, Math.max(0, video.duration - 0.01));

    await seekVideo(video, clampedTime);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);

    return {
      dataUrl,
      phase,
      repIndex,
      timestamp: frameIndex,
    };
  } catch {
    return null;
  }
}

/**
 * Seek the video element to a specific time, returning a promise that
 * resolves when the seek is complete.
 */
function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      clearTimeout(timeout);
      resolve();
    };

    // Timeout after 3 seconds to avoid hanging
    const timeout = setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      reject(new Error('Video seek timed out'));
    }, 3000);

    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
  });
}

/**
 * Create a compact snapshot record for storage.
 * Only store first 2 reps to keep localStorage small (2 reps x 2 phases = 4 snapshots max).
 */
export function createSnapshotRecord(snapshots: FrameSnapshot[]): FrameSnapshot[] {
  return snapshots.slice(0, 4);  // 2 reps x 2 phases = 4 snapshots max
}

/**
 * Extract bottom and lockout frame indices from a SetAnalysis-compatible structure.
 * Used to determine which frames to capture snapshots from.
 *
 * @param reps Array of rep score objects with minKneeAngle data
 * @param repStartFrames Start frame for each rep
 * @param repFrameMap Map from frame index to rep index
 * @param frameAnglesMap Map from frame index to angles (for finding bottom frame)
 * @returns Object with bottomFrames and endFrames arrays
 */
export function extractRepKeyFrames(
  repStartFrames: number[],
  repEndFrames: number[],
  bottomFrames: number[],
): { bottomFrames: number[]; endFrames: number[] } {
  return {
    bottomFrames: [...bottomFrames],
    endFrames: [...repEndFrames],
  };
}

/**
 * Validate that a snapshot has the expected structure.
 */
export function isValidSnapshot(snapshot: unknown): snapshot is FrameSnapshot {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const s = snapshot as Record<string, unknown>;
  return (
    typeof s.dataUrl === 'string' &&
    s.dataUrl.length > 0 &&
    typeof s.phase === 'string' &&
    (s.phase === 'bottom' || s.phase === 'lockout') &&
    typeof s.repIndex === 'number' &&
    s.repIndex >= 0 &&
    typeof s.timestamp === 'number' &&
    s.timestamp >= 0
  );
}

/**
 * Estimate storage size of snapshots in bytes.
 * Useful for checking if snapshots will fit in localStorage.
 */
export function estimateSnapshotSize(snapshots: FrameSnapshot[]): number {
  return snapshots.reduce((total, s) => total + s.dataUrl.length, 0);
}

/**
 * Filter snapshots by phase.
 */
export function filterByPhase(snapshots: FrameSnapshot[], phase: string): FrameSnapshot[] {
  return snapshots.filter(s => s.phase === phase);
}

/**
 * Get snapshots for a specific rep index.
 */
export function getSnapshotsForRep(snapshots: FrameSnapshot[], repIndex: number): FrameSnapshot[] {
  return snapshots.filter(s => s.repIndex === repIndex);
}
