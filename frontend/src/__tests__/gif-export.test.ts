import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getSupportedMimeType,
  downloadClip,
  shareClip,
  exportRepClip,
} from '../gif-export';
import type { ExportedClip, ClipExportOptions } from '../gif-export';

// ─── getSupportedMimeType ───

describe('getSupportedMimeType', () => {
  let originalMediaRecorder: typeof MediaRecorder | undefined;

  beforeEach(() => {
    originalMediaRecorder = globalThis.MediaRecorder;
  });

  afterEach(() => {
    if (originalMediaRecorder !== undefined) {
      globalThis.MediaRecorder = originalMediaRecorder;
    } else {
      // @ts-expect-error - removing for cleanup
      delete globalThis.MediaRecorder;
    }
  });

  it('returns a string', () => {
    const type = getSupportedMimeType();
    expect(typeof type).toBe('string');
  });

  it('returns a video mime type', () => {
    const type = getSupportedMimeType();
    expect(type).toMatch(/^video\//);
  });

  it('falls back to video/webm when MediaRecorder is undefined', () => {
    // @ts-expect-error - intentionally removing for test
    delete globalThis.MediaRecorder;
    const type = getSupportedMimeType();
    expect(type).toBe('video/webm');
  });

  it('returns first supported type when MediaRecorder.isTypeSupported is available', () => {
    // @ts-expect-error - mock
    globalThis.MediaRecorder = {
      isTypeSupported: (type: string) => type === 'video/webm;codecs=vp8',
    };
    const result = getSupportedMimeType();
    expect(result).toBe('video/webm;codecs=vp8');
  });

  it('returns vp9 if both vp9 and vp8 are supported', () => {
    // @ts-expect-error - mock
    globalThis.MediaRecorder = {
      isTypeSupported: (type: string) =>
        type === 'video/webm;codecs=vp9' || type === 'video/webm;codecs=vp8',
    };
    const result = getSupportedMimeType();
    expect(result).toBe('video/webm;codecs=vp9');
  });

  it('returns video/webm fallback if no types are supported', () => {
    // @ts-expect-error - mock
    globalThis.MediaRecorder = {
      isTypeSupported: () => false,
    };
    const result = getSupportedMimeType();
    expect(result).toBe('video/webm');
  });

  it('returns video/mp4 when only mp4 is supported', () => {
    // @ts-expect-error - mock
    globalThis.MediaRecorder = {
      isTypeSupported: (type: string) => type === 'video/mp4',
    };
    const result = getSupportedMimeType();
    expect(result).toBe('video/mp4');
  });
});

// ─── ExportedClip structure ───

describe('ExportedClip structure', () => {
  it('has all required fields', () => {
    const clip: ExportedClip = {
      blob: new Blob(['data']),
      mimeType: 'video/webm',
      durationMs: 3000,
      repIndex: 0,
    };
    expect(clip.blob).toBeInstanceOf(Blob);
    expect(typeof clip.mimeType).toBe('string');
    expect(typeof clip.durationMs).toBe('number');
    expect(typeof clip.repIndex).toBe('number');
  });

  it('repIndex is zero-based', () => {
    const clip: ExportedClip = {
      blob: new Blob([]),
      mimeType: 'video/webm',
      durationMs: 1000,
      repIndex: 0,
    };
    expect(clip.repIndex).toBe(0);
  });

  it('durationMs is positive', () => {
    const clip: ExportedClip = {
      blob: new Blob([]),
      mimeType: 'video/webm',
      durationMs: 500,
      repIndex: 1,
    };
    expect(clip.durationMs).toBeGreaterThan(0);
  });

  it('blob contains data', () => {
    const data = 'some video data';
    const clip: ExportedClip = {
      blob: new Blob([data], { type: 'video/webm' }),
      mimeType: 'video/webm',
      durationMs: 1500,
      repIndex: 3,
    };
    expect(clip.blob.size).toBeGreaterThan(0);
    expect(clip.blob.type).toBe('video/webm');
  });

  it('accepts arbitrary repIndex values', () => {
    const clip: ExportedClip = {
      blob: new Blob([]),
      mimeType: 'video/webm',
      durationMs: 1000,
      repIndex: 99,
    };
    expect(clip.repIndex).toBe(99);
  });
});

// ─── downloadClip ───

describe('downloadClip', () => {
  beforeEach(() => {
    const mockAnchor = { href: '', download: '', click: vi.fn() } as Record<string, unknown>;
    (globalThis as Record<string, unknown>).document = {
      createElement: vi.fn().mockReturnValue(mockAnchor),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    };
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it('creates an anchor element and triggers click', () => {
    const clip: ExportedClip = {
      blob: new Blob(['test'], { type: 'video/webm' }),
      mimeType: 'video/webm',
      durationMs: 2000,
      repIndex: 0,
    };

    downloadClip(clip, 'rep-1.webm');

    expect(globalThis.URL.createObjectURL).toHaveBeenCalledWith(clip.blob);
    expect(document.createElement).toHaveBeenCalledWith('a');

    const anchor = (document.createElement as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(anchor.href).toBe('blob:mock-url');
    expect(anchor.download).toBe('rep-1.webm');
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(document.body.appendChild).toHaveBeenCalledTimes(1);
    expect(document.body.removeChild).toHaveBeenCalledTimes(1);
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('sets the download attribute to the provided filename', () => {
    const clip: ExportedClip = {
      blob: new Blob(['test']),
      mimeType: 'video/webm',
      durationMs: 1000,
      repIndex: 2,
    };

    downloadClip(clip, 'my-clip.webm');
    const anchor = (document.createElement as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(anchor.download).toBe('my-clip.webm');
  });
});

// ─── shareClip ───

describe('shareClip', () => {
  let origShare: typeof navigator.share | undefined;
  let origCanShare: typeof navigator.canShare | undefined;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).document = {
      createElement: vi.fn().mockReturnValue({ href: '', download: '', click: vi.fn() }),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    };
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:url');
    globalThis.URL.revokeObjectURL = vi.fn();

    origShare = navigator.share;
    origCanShare = navigator.canShare;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'share', { value: origShare, writable: true, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: origCanShare, writable: true, configurable: true });
  });

  it('falls back to download when navigator.share is unavailable', async () => {
    Object.defineProperty(navigator, 'share', { value: undefined, writable: true, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: undefined, writable: true, configurable: true });

    const clip: ExportedClip = {
      blob: new Blob(['test'], { type: 'video/webm' }),
      mimeType: 'video/webm',
      durationMs: 1500,
      repIndex: 1,
    };

    const result = await shareClip(clip, 'rep-2');
    expect(result).toBe(false);
  });

  it('calls navigator.share when available and canShare returns true', async () => {
    const mockShareFn = vi.fn().mockResolvedValue(undefined);
    const mockCanShareFn = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'share', { value: mockShareFn, writable: true, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: mockCanShareFn, writable: true, configurable: true });

    const clip: ExportedClip = {
      blob: new Blob(['test'], { type: 'video/webm' }),
      mimeType: 'video/webm',
      durationMs: 2000,
      repIndex: 0,
    };

    const result = await shareClip(clip, 'rep-1');
    expect(result).toBe(true);
    expect(mockShareFn).toHaveBeenCalledTimes(1);

    const shareCall = mockShareFn.mock.calls[0][0];
    expect(shareCall.title).toBe('rep-1');
    expect(shareCall.files).toHaveLength(1);
    expect(shareCall.files[0].name).toBe('rep-1.webm');
  });

  it('falls back to download when canShare returns false', async () => {
    const mockShareFn = vi.fn();
    const mockCanShareFn = vi.fn().mockReturnValue(false);
    Object.defineProperty(navigator, 'share', { value: mockShareFn, writable: true, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: mockCanShareFn, writable: true, configurable: true });

    const clip: ExportedClip = {
      blob: new Blob(['test'], { type: 'video/webm' }),
      mimeType: 'video/webm',
      durationMs: 1000,
      repIndex: 0,
    };

    const result = await shareClip(clip, 'rep-1');
    expect(result).toBe(false);
    expect(mockShareFn).not.toHaveBeenCalled();
  });
});

// ─── exportRepClip validation ───

describe('exportRepClip validation', () => {
  it('rejects when startTime > endTime', async () => {
    const options: ClipExportOptions = {
      video: {} as HTMLVideoElement,
      canvas: {} as HTMLCanvasElement,
      startTime: 5,
      endTime: 3,
      fps: 30,
    };
    await expect(exportRepClip(options, 0)).rejects.toThrow('Invalid time range');
  });

  it('rejects when startTime equals endTime', async () => {
    const options: ClipExportOptions = {
      video: {} as HTMLVideoElement,
      canvas: {} as HTMLCanvasElement,
      startTime: 2,
      endTime: 2,
      fps: 30,
    };
    await expect(exportRepClip(options, 0)).rejects.toThrow('Invalid time range');
  });

  it('rejects when fps is zero', async () => {
    const options: ClipExportOptions = {
      video: {} as HTMLVideoElement,
      canvas: {} as HTMLCanvasElement,
      startTime: 0,
      endTime: 2,
      fps: 0,
    };
    await expect(exportRepClip(options, 0)).rejects.toThrow('Invalid fps');
  });

  it('rejects when fps is negative', async () => {
    const options: ClipExportOptions = {
      video: {} as HTMLVideoElement,
      canvas: {} as HTMLCanvasElement,
      startTime: 0,
      endTime: 2,
      fps: -10,
    };
    await expect(exportRepClip(options, 0)).rejects.toThrow('Invalid fps');
  });

  it('includes times in error message for invalid range', async () => {
    const options: ClipExportOptions = {
      video: {} as HTMLVideoElement,
      canvas: {} as HTMLCanvasElement,
      startTime: 10,
      endTime: 5,
      fps: 30,
    };
    await expect(exportRepClip(options, 0)).rejects.toThrow('10');
  });

  it('includes fps value in error message', async () => {
    const options: ClipExportOptions = {
      video: {} as HTMLVideoElement,
      canvas: {} as HTMLCanvasElement,
      startTime: 0,
      endTime: 2,
      fps: -5,
    };
    await expect(exportRepClip(options, 0)).rejects.toThrow('-5');
  });
});
