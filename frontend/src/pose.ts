/**
 * MediaPipe Web integration for browser-based pose estimation.
 * Uses @mediapipe/tasks-vision PoseLandmarker API.
 */

import {
  PoseLandmarker,
  FilesetResolver,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { Point, Landmarks, FrameData } from './types';
import { LandmarkSmoother } from './smoothing';

/** Callback type for LIVE_STREAM results. */
export type LiveStreamResultCallback = (landmarks: Landmarks | null, timestampMs: number) => void;

/**
 * MediaPipe's LIVE_STREAM mode and detectAsync() exist at runtime but are
 * missing from the published type definitions in @mediapipe/tasks-vision 0.10.14.
 * We extend the types here to avoid `any` casts throughout.
 */
interface PoseLandmarkerWithLiveStream extends PoseLandmarker {
  detectAsync(image: HTMLVideoElement, timestampMs: number): void;
}

/** Map of MediaPipe landmark indices to named keys (same as Python backend). */
const LANDMARK_NAMES: Record<number, string> = {
  // Ear landmarks needed for cervical hyperextension detection (computeNeckAngle)
  7: 'left_ear',
  8: 'right_ear',
  11: 'left_shoulder',
  12: 'right_shoulder',
  13: 'left_elbow',
  14: 'right_elbow',
  15: 'left_wrist',
  16: 'right_wrist',
  17: 'left_pinky',
  18: 'right_pinky',
  19: 'left_index',
  20: 'right_index',
  21: 'left_thumb',
  22: 'right_thumb',
  23: 'left_hip',
  24: 'right_hip',
  25: 'left_knee',
  26: 'right_knee',
  27: 'left_ankle',
  28: 'right_ankle',
  29: 'left_heel',
  30: 'right_heel',
  31: 'left_foot_index',
  32: 'right_foot_index',
};

/** Local WASM path (copied by postinstall script) */
const LOCAL_WASM_URL = './mediapipe/wasm';
/** Pinned CDN version as fallback */
const CDN_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

/** Local model paths (copied by postinstall script if available) */
const LOCAL_MODEL_PATH_FULL = './mediapipe/models/pose_landmarker_full.task';
const LOCAL_MODEL_PATH_LITE = './mediapipe/models/pose_landmarker_lite.task';
/** CDN model paths as fallback */
const CDN_MODEL_PATH_FULL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const CDN_MODEL_PATH_LITE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

/**
 * Resolve the best available WASM URL: try local first, fall back to CDN.
 */
async function resolveWasmUrl(): Promise<string> {
  try {
    const response = await fetch(`${LOCAL_WASM_URL}/vision_wasm_internal.js`, { method: 'HEAD' });
    if (response.ok) {
      return LOCAL_WASM_URL;
    }
  } catch {
    // Local not available
  }
  // Local WASM not found, falling back to CDN
  return CDN_WASM_URL;
}

/**
 * Resolve the best available model URL: try local first, fall back to CDN.
 * @param lite Use the lighter/faster model (for live mode) vs full (for video upload).
 */
async function resolveModelUrl(lite = false): Promise<string> {
  const localPath = lite ? LOCAL_MODEL_PATH_LITE : LOCAL_MODEL_PATH_FULL;
  const cdnPath = lite ? CDN_MODEL_PATH_LITE : CDN_MODEL_PATH_FULL;
  try {
    const response = await fetch(localPath, { method: 'HEAD' });
    if (response.ok) {
      return localPath;
    }
  } catch {
    // Local not available
  }
  // Local model not found, falling back to CDN
  return cdnPath;
}

/**
 * Load WASM fileset with local-then-CDN fallback.
 */
async function loadVisionFileset(wasmUrl: string): Promise<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>> {
  try {
    return await FilesetResolver.forVisionTasks(wasmUrl);
  } catch (err) {
    if (wasmUrl !== CDN_WASM_URL) {
      // Local WASM load failed, retrying with CDN
      return await FilesetResolver.forVisionTasks(CDN_WASM_URL);
    }
    throw new Error(
      'Could not load the AI model. Check your internet connection, or try again later. ' +
      'The model needs to download once (~30MB) and is then cached by your browser.'
    );
  }
}

/** Cached WASM fileset and model URLs from pre-warming. */
let prewarmedVision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;
let prewarmedModelUrlFull: string | null = null;
let prewarmedModelUrlLite: string | null = null;
let prewarmPromise: Promise<void> | null = null;

/**
 * Pre-warm MediaPipe: download WASM + models in the background on page load.
 * Subsequent init() calls reuse the cached assets, skipping the download wait.
 */
export function prewarmMediaPipe(): void {
  if (prewarmPromise) return;
  prewarmPromise = (async () => {
    try {
      const [wasmUrl, liteModelUrl] = await Promise.all([
        resolveWasmUrl(),
        resolveModelUrl(true),
      ]);
      prewarmedVision = await loadVisionFileset(wasmUrl);
      prewarmedModelUrlLite = liteModelUrl;
      // Pre-fetch only the lite model (for live mode); full model loads on-demand for video upload
      await fetch(liteModelUrl);
      // Pre-warm complete
    } catch (err) {
      // Pre-warm failed (will retry on init)
    }
  })();
}

export class PoseProcessor {
  private landmarker: PoseLandmarker | null = null;
  private liveStreamLandmarker: PoseLandmarkerWithLiveStream | null = null;
  private liveStreamCallback: LiveStreamResultCallback | null = null;
  private smoother = new LandmarkSmoother(0.7);
  private liveStreamSmoother = new LandmarkSmoother(0.7);

  /**
   * Initialize PoseLandmarker in VIDEO mode for upload processing.
   * Tries local WASM/model files first, falls back to CDN.
   */
  async init(): Promise<void> {
    // Wait for pre-warm if in progress, then reuse cached assets
    if (prewarmPromise) await prewarmPromise;
    const vision = prewarmedVision ?? await loadVisionFileset(await resolveWasmUrl());
    // Video upload uses the full (more accurate) model
    const modelUrl = prewarmedModelUrlFull ?? await resolveModelUrl(false);

    try {
      this.landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelUrl,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 2, // Detect up to 2 poses for multi-person rejection
        minTrackingConfidence: 0.7,
      });
    } catch (err) {
      if (modelUrl !== CDN_MODEL_PATH_FULL) {
        // Local model load failed, retrying with CDN
        this.landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: CDN_MODEL_PATH_FULL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 2,
          minTrackingConfidence: 0.7,
        });
      } else {
        throw new Error(
          'Could not load the AI model. Check your internet connection, or try again later. ' +
          'The model needs to download once (~30MB) and is then cached by your browser.'
        );
      }
    }
    this.smoother.reset();
  }

  /**
   * Initialize PoseLandmarker in LIVE_STREAM mode for real-time webcam analysis.
   * Results are delivered asynchronously via the callback.
   * Tries local WASM/model files first, falls back to CDN.
   */
  async initLiveStream(callback: LiveStreamResultCallback): Promise<void> {
    this.liveStreamCallback = callback;
    this.liveStreamSmoother.reset();
    // Live mode uses the lite (faster) model with single-person detection
    if (prewarmPromise) await prewarmPromise;
    const vision = prewarmedVision ?? await loadVisionFileset(await resolveWasmUrl());
    const modelUrl = prewarmedModelUrlLite ?? await resolveModelUrl(true);

    const createLandmarker = async (path: string) => {
      // Cast needed: LIVE_STREAM mode and resultListener exist at runtime
      // but are missing from @mediapipe/tasks-vision 0.10.14 type defs.
      const options = {
        baseOptions: {
          modelAssetPath: path,
          delegate: 'GPU',
        },
        runningMode: 'LIVE_STREAM',
        numPoses: 1, // Single person for faster inference in live mode
        minTrackingConfidence: 0.5,
        resultListener: (result: PoseLandmarkerResult) => {
          let landmarks = this.extractLandmarks(result);
          if (landmarks) {
            landmarks = this.liveStreamSmoother.smooth(landmarks);
          }
          this.liveStreamCallback?.(landmarks, Date.now());
        },
      };
      this.liveStreamLandmarker = await PoseLandmarker.createFromOptions(
        vision,
        options as Parameters<typeof PoseLandmarker.createFromOptions>[1],
      ) as unknown as PoseLandmarkerWithLiveStream;
    };

    try {
      await createLandmarker(modelUrl);
    } catch (err) {
      if (modelUrl !== CDN_MODEL_PATH_LITE) {
        // Local model load failed, retrying with CDN
        await createLandmarker(CDN_MODEL_PATH_LITE);
      } else {
        throw new Error(
          'Could not load the AI model. Check your internet connection, or try again later. ' +
          'The model needs to download once (~30MB) and is then cached by your browser.'
        );
      }
    }
  }

  /**
   * Send a live video frame for async pose detection.
   * Results arrive via the callback passed to initLiveStream().
   */
  processLiveFrame(videoElement: HTMLVideoElement, timestampMs: number): void {
    if (!this.liveStreamLandmarker) {
      throw new Error('Live stream not initialized. Call initLiveStream() first.');
    }
    try {
      this.liveStreamLandmarker.detectAsync(videoElement, timestampMs);
    } catch {
      // Silently skip frames that fail (e.g., timestamp ordering issues)
    }
  }

  /** Extract named landmarks from a PoseLandmarkerResult. */
  private extractLandmarks(result: PoseLandmarkerResult): Landmarks | null {
    if (!result.landmarks || result.landmarks.length === 0) {
      return null;
    }

    const rawLandmarks = result.landmarks[0];
    const worldLandmarks = result.worldLandmarks?.[0];
    const landmarks: Landmarks = {};

    for (let i = 0; i < rawLandmarks.length; i++) {
      const name = LANDMARK_NAMES[i];
      if (!name) continue;

      const lm = rawLandmarks[i];
      const wlm = worldLandmarks?.[i];
      const rawVisibility = lm.visibility ?? 1.0;

      landmarks[name] = {
        x: lm.x,
        y: lm.y,
        z: wlm?.z ?? lm.z ?? 0,
        // If visibility is below threshold, mark as low-confidence
        // but don't skip (would break downstream code)
        visibility: rawVisibility < 0.5 ? rawVisibility * 0.5 : rawVisibility,
      };
    }

    return landmarks;
  }

  /**
   * Process a single video frame and return named landmarks with EMA smoothing.
   * @returns Object with smoothed landmarks and multi-person flag, or null if no pose detected.
   */
  processFrame(
    videoElement: HTMLVideoElement,
    timestampMs: number,
  ): { landmarks: Landmarks; multiPerson: boolean } | null {
    if (!this.landmarker) {
      throw new Error('PoseProcessor not initialized. Call init() first.');
    }

    let result: PoseLandmarkerResult;
    try {
      result = this.landmarker.detectForVideo(videoElement, timestampMs);
    } catch {
      return null;
    }

    const multiPerson = (result.landmarks?.length ?? 0) > 1;
    let landmarks = this.extractLandmarks(result);
    if (!landmarks) return null;

    landmarks = this.smoother.smooth(landmarks);
    return { landmarks, multiPerson };
  }

  /**
   * Process an entire video by seeking frame by frame.
   *
   * @param videoEl The video element with the source loaded.
   * @param progressCallback Called with a percentage (0-100) and status text.
   * @returns Map of frame_number -> landmarks.
   */
  async processVideo(
    videoEl: HTMLVideoElement,
    progressCallback: (percent: number, status: string) => void,
  ): Promise<FrameData> {
    if (!this.landmarker) {
      throw new Error('PoseProcessor not initialized. Call init() first.');
    }

    // Reset smoother for the new video
    this.smoother.reset();

    const frameData: FrameData = new Map();
    const duration = videoEl.duration;

    if (!isFinite(duration) || duration <= 0) {
      throw new Error('Video has invalid duration. The file may be corrupted or unsupported.');
    }

    // Estimate FPS -- target processing at ~10 fps for performance
    const processingFps = 10;
    const frameInterval = 1 / processingFps;
    const totalFrames = Math.ceil(duration * processingFps);

    progressCallback(0, 'Extracting poses...');

    let frameNumber = 0;
    let currentTime = 0;
    let multiPersonFrames = 0;
    let totalProcessedFrames = 0;

    // Process frames by seeking through the video
    while (currentTime < duration) {
      // Seek to the target time
      videoEl.currentTime = currentTime;
      await waitForSeek(videoEl);

      // Give the video element a moment to render the frame
      await waitForFrame();

      const timestampMs = Math.round(currentTime * 1000);
      const frameResult = this.processFrame(videoEl, timestampMs);

      if (frameResult) {
        frameData.set(frameNumber, frameResult.landmarks);
        totalProcessedFrames++;
        if (frameResult.multiPerson) {
          multiPersonFrames++;
        }
      }

      frameNumber++;
      currentTime += frameInterval;

      const percent = Math.min(
        95,
        Math.round((frameNumber / totalFrames) * 95),
      );
      progressCallback(percent, `Extracting poses... (frame ${frameNumber}/${totalFrames})`);
    }

    // Warn if >50% of processed frames had multiple people
    if (totalProcessedFrames > 0 && multiPersonFrames / totalProcessedFrames > 0.5) {
      // Multiple people detected -- set warning for UI
      this._multiPersonWarning = 'Multiple people detected in the video. Results may be inaccurate -- please ensure only one person is visible.';
    } else {
      this._multiPersonWarning = null;
    }

    progressCallback(95, 'Pose extraction complete.');
    return frameData;
  }

  /** Warning message if multiple people were detected in >50% of frames. */
  private _multiPersonWarning: string | null = null;

  /** Get multi-person warning (set after processVideo completes). Null if no issue. */
  getMultiPersonWarning(): string | null {
    return this._multiPersonWarning;
  }

  /** Get the processing FPS used for frame extraction. */
  getProcessingFps(): number {
    return 10;
  }

  /** Cleanup resources. */
  close(): void {
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
    }
    this.closeLiveStream();
  }

  /** Cleanup live stream resources only. */
  closeLiveStream(): void {
    if (this.liveStreamLandmarker) {
      this.liveStreamLandmarker.close();
      this.liveStreamLandmarker = null;
    }
    this.liveStreamCallback = null;
    this.liveStreamSmoother.reset();
  }
}

/** Wait for a video seek to complete. */
function waitForSeek(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if (!video.seeking) {
      resolve();
      return;
    }
    const handler = () => {
      video.removeEventListener('seeked', handler);
      resolve();
    };
    video.addEventListener('seeked', handler);
  });
}

/** Wait one animation frame. */
function waitForFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}
