import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  measureAngle,
  normalizePoint,
  denormalizePoint,
  hitTestAnnotation,
  renderAllAnnotations,
  renderAnnotationToolbar,
  renderComparisonView,
  renderFrameControls,
  stepFrame,
  exportAnnotationsJSON,
  saveAnnotationSession,
  loadAnnotationSession,
  deleteAnnotationSession,
  syncVideos,
  drawAngleMeasurement,
  ANNOTATION_COLORS,
  AnnotationCanvas,
} from '../video-annotation';
import type {
  Annotation,
  AnnotationSession,
  AnnotationStyle,
  ComparisonView,
} from '../video-annotation';

// ─── Helpers ───

function makeStyle(overrides: Partial<AnnotationStyle> = {}): AnnotationStyle {
  return {
    color: '#00d4ff',
    lineWidth: 2,
    fontSize: 16,
    opacity: 1,
    ...overrides,
  };
}

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'test-1',
    tool: 'pen',
    points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }],
    style: makeStyle(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<AnnotationSession> = {}): AnnotationSession {
  return {
    id: 'session-1',
    videoId: 'video-abc',
    annotations: [makeAnnotation()],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ─── localStorage mock ───

function createLocalStorageMock(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

// ─── measureAngle ───

describe('measureAngle', () => {
  it('computes 90 degrees for a right angle', () => {
    const p1 = { x: 1, y: 0 };
    const vertex = { x: 0, y: 0 };
    const p3 = { x: 0, y: 1 };
    const angle = measureAngle(p1, vertex, p3);
    expect(angle).toBeCloseTo(90, 1);
  });

  it('computes 180 degrees for a straight line', () => {
    const p1 = { x: -1, y: 0 };
    const vertex = { x: 0, y: 0 };
    const p3 = { x: 1, y: 0 };
    const angle = measureAngle(p1, vertex, p3);
    expect(angle).toBeCloseTo(180, 1);
  });

  it('computes 45 degrees', () => {
    const p1 = { x: 1, y: 0 };
    const vertex = { x: 0, y: 0 };
    const p3 = { x: 1, y: 1 };
    const angle = measureAngle(p1, vertex, p3);
    expect(angle).toBeCloseTo(45, 1);
  });

  it('returns 0 for coincident points', () => {
    const p = { x: 0.5, y: 0.5 };
    const angle = measureAngle(p, p, p);
    expect(angle).toBe(0);
  });

  it('computes 60 degrees for equilateral triangle', () => {
    const p1 = { x: 1, y: 0 };
    const vertex = { x: 0, y: 0 };
    const p3 = { x: 0.5, y: Math.sqrt(3) / 2 };
    const angle = measureAngle(p1, vertex, p3);
    expect(angle).toBeCloseTo(60, 1);
  });

  it('computes 120 degrees', () => {
    const p1 = { x: 1, y: 0 };
    const vertex = { x: 0, y: 0 };
    const p3 = { x: -0.5, y: Math.sqrt(3) / 2 };
    const angle = measureAngle(p1, vertex, p3);
    expect(angle).toBeCloseTo(120, 1);
  });

  it('is symmetric: same result regardless of point order', () => {
    const p1 = { x: 1, y: 0 };
    const vertex = { x: 0, y: 0 };
    const p3 = { x: 0, y: 1 };
    const a1 = measureAngle(p1, vertex, p3);
    const a2 = measureAngle(p3, vertex, p1);
    expect(a1).toBeCloseTo(a2, 5);
  });

  it('handles vertex with one coincident point', () => {
    const p1 = { x: 1, y: 0 };
    const vertex = { x: 0, y: 0 };
    const p3 = { x: 0, y: 0 }; // same as vertex
    const angle = measureAngle(p1, vertex, p3);
    expect(angle).toBe(0);
  });
});

// ─── Coordinate normalization/denormalization ───

describe('normalizePoint', () => {
  it('normalizes to 0-1 range', () => {
    const result = normalizePoint(320, 240, 640, 480);
    expect(result.x).toBeCloseTo(0.5);
    expect(result.y).toBeCloseTo(0.5);
  });

  it('normalizes origin to (0, 0)', () => {
    const result = normalizePoint(0, 0, 640, 480);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it('normalizes max to (1, 1)', () => {
    const result = normalizePoint(640, 480, 640, 480);
    expect(result.x).toBeCloseTo(1);
    expect(result.y).toBeCloseTo(1);
  });

  it('handles zero-dimension canvas gracefully', () => {
    const result = normalizePoint(100, 100, 0, 0);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });
});

describe('denormalizePoint', () => {
  it('denormalizes from 0-1 to pixel coordinates', () => {
    const result = denormalizePoint(0.5, 0.5, 640, 480);
    expect(result.x).toBeCloseTo(320);
    expect(result.y).toBeCloseTo(240);
  });

  it('round-trips with normalizePoint', () => {
    const norm = normalizePoint(123, 456, 800, 600);
    const denorm = denormalizePoint(norm.x, norm.y, 800, 600);
    expect(denorm.x).toBeCloseTo(123);
    expect(denorm.y).toBeCloseTo(456);
  });

  it('denormalizes (0, 0) to origin', () => {
    const result = denormalizePoint(0, 0, 640, 480);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });
});

// ─── Annotation serialization ───

describe('annotation serialization (JSON round-trip)', () => {
  it('serializes and deserializes an annotation', () => {
    const ann = makeAnnotation({
      tool: 'arrow',
      text: 'watch this',
      angle: 42,
      timestamp: 1.5,
      frameIndex: 45,
    });

    const json = JSON.stringify(ann);
    const parsed = JSON.parse(json) as Annotation;

    expect(parsed.id).toBe(ann.id);
    expect(parsed.tool).toBe('arrow');
    expect(parsed.text).toBe('watch this');
    expect(parsed.angle).toBe(42);
    expect(parsed.timestamp).toBe(1.5);
    expect(parsed.frameIndex).toBe(45);
    expect(parsed.points).toEqual(ann.points);
    expect(parsed.style).toEqual(ann.style);
  });

  it('serializes and deserializes an annotation session', () => {
    const session = makeSession({
      annotations: [
        makeAnnotation({ id: 'a1', tool: 'pen' }),
        makeAnnotation({ id: 'a2', tool: 'angle', angle: 90 }),
        makeAnnotation({ id: 'a3', tool: 'text', text: 'hello' }),
      ],
    });

    const json = JSON.stringify(session);
    const parsed = JSON.parse(json) as AnnotationSession;

    expect(parsed.id).toBe(session.id);
    expect(parsed.videoId).toBe(session.videoId);
    expect(parsed.annotations).toHaveLength(3);
    expect(parsed.annotations[1].angle).toBe(90);
    expect(parsed.annotations[2].text).toBe('hello');
    expect(parsed.createdAt).toBe(session.createdAt);
  });

  it('handles empty annotations array', () => {
    const session = makeSession({ annotations: [] });
    const json = JSON.stringify(session);
    const parsed = JSON.parse(json) as AnnotationSession;
    expect(parsed.annotations).toHaveLength(0);
  });
});

// ─── exportAnnotationsJSON ───

describe('exportAnnotationsJSON', () => {
  it('produces valid JSON', () => {
    const session = makeSession();
    const json = exportAnnotationsJSON(session);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('produces pretty-printed JSON', () => {
    const session = makeSession();
    const json = exportAnnotationsJSON(session);
    expect(json).toContain('\n');
    expect(json).toContain('  ');
  });

  it('includes all session fields', () => {
    const session = makeSession({
      id: 'sess-x',
      videoId: 'vid-y',
      annotations: [makeAnnotation({ id: 'a-z', tool: 'circle' })],
    });
    const json = exportAnnotationsJSON(session);
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe('sess-x');
    expect(parsed.videoId).toBe('vid-y');
    expect(parsed.annotations[0].tool).toBe('circle');
  });
});

// ─── Hit testing for eraser ───

describe('hitTestAnnotation', () => {
  const canvasW = 640;
  const canvasH = 480;

  it('detects hit on a pen annotation within radius', () => {
    const ann = makeAnnotation({
      tool: 'pen',
      points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }],
    });
    // Point right on the line
    const hit = hitTestAnnotation(ann, 352, 240, canvasW, canvasH, 20);
    expect(hit).toBe(true);
  });

  it('misses a pen annotation outside radius', () => {
    const ann = makeAnnotation({
      tool: 'pen',
      points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }],
    });
    // Point far away
    const hit = hitTestAnnotation(ann, 10, 10, canvasW, canvasH, 20);
    expect(hit).toBe(false);
  });

  it('detects hit on a line annotation', () => {
    const ann = makeAnnotation({
      tool: 'line',
      points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    });
    // Point near the midpoint of the diagonal
    const hit = hitTestAnnotation(ann, 320, 240, canvasW, canvasH, 20);
    expect(hit).toBe(true);
  });

  it('misses a line annotation', () => {
    const ann = makeAnnotation({
      tool: 'line',
      points: [{ x: 0, y: 0 }, { x: 0.1, y: 0.1 }],
    });
    const hit = hitTestAnnotation(ann, 600, 400, canvasW, canvasH, 20);
    expect(hit).toBe(false);
  });

  it('detects hit on a circle annotation perimeter', () => {
    const ann = makeAnnotation({
      tool: 'circle',
      // center at (0.5, 0.5), radius to (0.6, 0.5) = 0.1 * 640 = 64px
      points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }],
    });
    // Point right on the circle perimeter (right side)
    const hit = hitTestAnnotation(ann, 320 + 64, 240, canvasW, canvasH, 20);
    expect(hit).toBe(true);
  });

  it('misses a circle annotation far from perimeter', () => {
    const ann = makeAnnotation({
      tool: 'circle',
      points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }],
    });
    // Center of circle (distance from perimeter = 64px > 20px)
    const hit = hitTestAnnotation(ann, 320, 240, canvasW, canvasH, 20);
    expect(hit).toBe(false);
  });

  it('detects hit on an arrow annotation', () => {
    const ann = makeAnnotation({
      tool: 'arrow',
      points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }],
    });
    // Point near the middle of the arrow line
    const hit = hitTestAnnotation(ann, 320, 48, canvasW, canvasH, 20);
    expect(hit).toBe(true);
  });

  it('detects hit on an angle annotation', () => {
    const ann = makeAnnotation({
      tool: 'angle',
      points: [
        { x: 0.3, y: 0.3 },
        { x: 0.5, y: 0.5 }, // vertex
        { x: 0.7, y: 0.3 },
      ],
      angle: 90,
    });
    // Point near the vertex
    const hit = hitTestAnnotation(ann, 320, 240, canvasW, canvasH, 20);
    expect(hit).toBe(true);
  });

  it('detects hit on a text annotation', () => {
    const ann = makeAnnotation({
      tool: 'text',
      points: [{ x: 0.5, y: 0.5 }],
      text: 'test',
    });
    const hit = hitTestAnnotation(ann, 325, 245, canvasW, canvasH, 20);
    expect(hit).toBe(true);
  });

  it('misses text annotation far away', () => {
    const ann = makeAnnotation({
      tool: 'text',
      points: [{ x: 0.5, y: 0.5 }],
      text: 'test',
    });
    const hit = hitTestAnnotation(ann, 10, 10, canvasW, canvasH, 20);
    expect(hit).toBe(false);
  });

  it('returns false for annotation with insufficient points (line)', () => {
    const ann = makeAnnotation({
      tool: 'line',
      points: [{ x: 0.5, y: 0.5 }], // needs 2
    });
    const hit = hitTestAnnotation(ann, 320, 240, canvasW, canvasH, 20);
    expect(hit).toBe(false);
  });

  it('returns false for annotation with insufficient points (angle)', () => {
    const ann = makeAnnotation({
      tool: 'angle',
      points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 }], // needs 3
    });
    const hit = hitTestAnnotation(ann, 320, 240, canvasW, canvasH, 20);
    expect(hit).toBe(false);
  });

  it('handles single-point pen annotation', () => {
    const ann = makeAnnotation({
      tool: 'pen',
      points: [{ x: 0.5, y: 0.5 }],
    });
    const hit = hitTestAnnotation(ann, 320, 240, canvasW, canvasH, 20);
    expect(hit).toBe(true);
  });
});

// ─── Frame stepping calculations ───

describe('stepFrame', () => {
  function makeVideo(currentTime: number, duration: number): HTMLVideoElement {
    return {
      currentTime,
      duration,
    } as unknown as HTMLVideoElement;
  }

  it('steps forward by one frame at 30fps', () => {
    const video = makeVideo(1.0, 10.0);
    stepFrame(video, 30, 'forward');
    expect(video.currentTime).toBeCloseTo(1.0 + 1 / 30, 5);
  });

  it('steps backward by one frame at 30fps', () => {
    const video = makeVideo(1.0, 10.0);
    stepFrame(video, 30, 'backward');
    expect(video.currentTime).toBeCloseTo(1.0 - 1 / 30, 5);
  });

  it('clamps backward step at 0', () => {
    const video = makeVideo(0.01, 10.0);
    stepFrame(video, 30, 'backward');
    expect(video.currentTime).toBe(0);
  });

  it('clamps forward step at duration', () => {
    const video = makeVideo(9.99, 10.0);
    stepFrame(video, 30, 'forward');
    expect(video.currentTime).toBe(10.0);
  });

  it('does nothing when fps is 0', () => {
    const video = makeVideo(5.0, 10.0);
    stepFrame(video, 0, 'forward');
    expect(video.currentTime).toBe(5.0);
  });

  it('does nothing when fps is negative', () => {
    const video = makeVideo(5.0, 10.0);
    stepFrame(video, -1, 'forward');
    expect(video.currentTime).toBe(5.0);
  });

  it('steps correctly at 60fps', () => {
    const video = makeVideo(2.0, 10.0);
    stepFrame(video, 60, 'forward');
    expect(video.currentTime).toBeCloseTo(2.0 + 1 / 60, 5);
  });
});

// ─── Storage ───

describe('annotation session storage', () => {
  let storageMock: Storage;

  beforeEach(() => {
    storageMock = createLocalStorageMock();
    vi.stubGlobal('localStorage', storageMock);
  });

  it('saves and loads a session', () => {
    const session = makeSession();
    saveAnnotationSession(session);
    const loaded = loadAnnotationSession('video-abc');
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(session.id);
    expect(loaded!.annotations).toHaveLength(1);
  });

  it('returns null for missing session', () => {
    const loaded = loadAnnotationSession('nonexistent');
    expect(loaded).toBeNull();
  });

  it('deletes a session', () => {
    const session = makeSession();
    saveAnnotationSession(session);
    deleteAnnotationSession('video-abc');
    const loaded = loadAnnotationSession('video-abc');
    expect(loaded).toBeNull();
  });

  it('updates the updatedAt timestamp on save', () => {
    const session = makeSession({ updatedAt: '2000-01-01T00:00:00.000Z' });
    saveAnnotationSession(session);
    const loaded = loadAnnotationSession('video-abc');
    expect(loaded!.updatedAt).not.toBe('2000-01-01T00:00:00.000Z');
  });

  it('handles corrupted localStorage gracefully', () => {
    storageMock.setItem('squat-annotation-bad', 'not json at all');
    const loaded = loadAnnotationSession('bad');
    expect(loaded).toBeNull();
  });
});

// ─── syncVideos ───

describe('syncVideos', () => {
  function makeVideoEl(): HTMLVideoElement {
    const el = {
      currentTime: 0,
      paused: true,
      play: vi.fn(() => { el.paused = false; }),
      pause: vi.fn(() => { el.paused = true; }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    return el as unknown as HTMLVideoElement;
  }

  it('play() calls play on both videos', () => {
    const v1 = makeVideoEl();
    const v2 = makeVideoEl();
    const sync = syncVideos(v1, v2);
    sync.play();
    expect(v1.play).toHaveBeenCalled();
    expect(v2.play).toHaveBeenCalled();
    sync.destroy();
  });

  it('pause() calls pause on both videos', () => {
    const v1 = makeVideoEl();
    const v2 = makeVideoEl();
    const sync = syncVideos(v1, v2);
    sync.pause();
    expect(v1.pause).toHaveBeenCalled();
    expect(v2.pause).toHaveBeenCalled();
    sync.destroy();
  });

  it('seekTo() sets currentTime on both videos', () => {
    const v1 = makeVideoEl();
    const v2 = makeVideoEl();
    const sync = syncVideos(v1, v2);
    sync.seekTo(5.5);
    expect(v1.currentTime).toBe(5.5);
    expect(v2.currentTime).toBe(5.5);
    sync.destroy();
  });

  it('destroy() removes event listeners', () => {
    const v1 = makeVideoEl();
    const v2 = makeVideoEl();
    const sync = syncVideos(v1, v2);
    sync.destroy();
    expect(v1.removeEventListener).toHaveBeenCalledWith('play', expect.any(Function));
    expect(v1.removeEventListener).toHaveBeenCalledWith('pause', expect.any(Function));
    expect(v1.removeEventListener).toHaveBeenCalledWith('seeked', expect.any(Function));
  });
});

// ─── UI rendering ───

describe('renderAnnotationToolbar', () => {
  it('returns HTML string with tool buttons', () => {
    const html = renderAnnotationToolbar();
    expect(html).toContain('annotation-toolbar');
    expect(html).toContain('data-tool="pen"');
    expect(html).toContain('data-tool="line"');
    expect(html).toContain('data-tool="arrow"');
    expect(html).toContain('data-tool="circle"');
    expect(html).toContain('data-tool="angle"');
    expect(html).toContain('data-tool="text"');
    expect(html).toContain('data-tool="eraser"');
  });

  it('contains color swatches', () => {
    const html = renderAnnotationToolbar();
    for (const color of ANNOTATION_COLORS) {
      expect(html).toContain(`data-color="${color}"`);
    }
  });

  it('contains undo/redo/clear/export buttons', () => {
    const html = renderAnnotationToolbar();
    expect(html).toContain('annotation-undo-btn');
    expect(html).toContain('annotation-redo-btn');
    expect(html).toContain('annotation-clear-btn');
    expect(html).toContain('annotation-export-btn');
  });

  it('contains a line width slider', () => {
    const html = renderAnnotationToolbar();
    expect(html).toContain('annotation-line-width');
    expect(html).toContain('type="range"');
  });
});

describe('renderComparisonView', () => {
  it('renders side-by-side comparison HTML', () => {
    const config: ComparisonView = {
      leftVideoUrl: 'video1.mp4',
      rightVideoUrl: 'video2.mp4',
      leftLabel: 'March 1 - Score: 72',
      rightLabel: 'March 15 - Score: 85',
      syncPlayback: true,
    };
    const html = renderComparisonView(config);
    expect(html).toContain('comparison-view');
    expect(html).toContain('comparison-left');
    expect(html).toContain('comparison-right');
    expect(html).toContain('March 1 - Score: 72');
    expect(html).toContain('March 15 - Score: 85');
    expect(html).toContain('video1.mp4');
    expect(html).toContain('video2.mp4');
  });

  it('escapes HTML in labels', () => {
    const config: ComparisonView = {
      leftVideoUrl: 'a.mp4',
      rightVideoUrl: 'b.mp4',
      leftLabel: '<script>alert(1)</script>',
      rightLabel: 'safe',
      syncPlayback: false,
    };
    const html = renderComparisonView(config);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderFrameControls', () => {
  it('renders frame navigation HTML', () => {
    const video = {} as HTMLVideoElement;
    const html = renderFrameControls(video, 30);
    expect(html).toContain('frame-controls');
    expect(html).toContain('frame-step-back');
    expect(html).toContain('frame-step-fwd');
  });
});

// ─── ANNOTATION_COLORS ───

describe('ANNOTATION_COLORS', () => {
  it('has at least 5 colors', () => {
    expect(ANNOTATION_COLORS.length).toBeGreaterThanOrEqual(5);
  });

  it('contains valid hex color strings', () => {
    for (const c of ANNOTATION_COLORS) {
      expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

// ─── drawAngleMeasurement ───

describe('drawAngleMeasurement', () => {
  it('calls canvas drawing methods without errors', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
      set globalAlpha(_v: number) { /* no-op */ },
      set strokeStyle(_v: string) { /* no-op */ },
      set fillStyle(_v: string) { /* no-op */ },
      set lineWidth(_v: number) { /* no-op */ },
      set lineCap(_v: string) { /* no-op */ },
      set lineJoin(_v: string) { /* no-op */ },
      set font(_v: string) { /* no-op */ },
      set textAlign(_v: string) { /* no-op */ },
      set textBaseline(_v: string) { /* no-op */ },
    } as unknown as CanvasRenderingContext2D;

    const p1 = { x: 0.3, y: 0.3 };
    const p2 = { x: 0.5, y: 0.5 };
    const p3 = { x: 0.7, y: 0.3 };

    expect(() => {
      drawAngleMeasurement(ctx, p1, p2, p3, makeStyle(), 640, 480);
    }).not.toThrow();

    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });
});

// ─── renderAllAnnotations ───

describe('renderAllAnnotations', () => {
  it('renders without errors on empty array', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
      set globalAlpha(_v: number) { /* no-op */ },
      set strokeStyle(_v: string) { /* no-op */ },
      set fillStyle(_v: string) { /* no-op */ },
      set lineWidth(_v: number) { /* no-op */ },
      set lineCap(_v: string) { /* no-op */ },
      set lineJoin(_v: string) { /* no-op */ },
      set font(_v: string) { /* no-op */ },
      set textAlign(_v: string) { /* no-op */ },
      set textBaseline(_v: string) { /* no-op */ },
    } as unknown as CanvasRenderingContext2D;

    expect(() => renderAllAnnotations(ctx, [], 640, 480)).not.toThrow();
    expect(ctx.save).not.toHaveBeenCalled(); // no annotations = no save calls
  });

  it('renders each annotation type without errors', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
      set globalAlpha(_v: number) { /* no-op */ },
      set strokeStyle(_v: string) { /* no-op */ },
      set fillStyle(_v: string) { /* no-op */ },
      set lineWidth(_v: number) { /* no-op */ },
      set lineCap(_v: string) { /* no-op */ },
      set lineJoin(_v: string) { /* no-op */ },
      set font(_v: string) { /* no-op */ },
      set textAlign(_v: string) { /* no-op */ },
      set textBaseline(_v: string) { /* no-op */ },
    } as unknown as CanvasRenderingContext2D;

    const annotations: Annotation[] = [
      makeAnnotation({ tool: 'pen', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] }),
      makeAnnotation({ tool: 'line', points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }] }),
      makeAnnotation({ tool: 'arrow', points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }] }),
      makeAnnotation({ tool: 'circle', points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }] }),
      makeAnnotation({
        tool: 'angle',
        points: [{ x: 0.3, y: 0.3 }, { x: 0.5, y: 0.5 }, { x: 0.7, y: 0.3 }],
        angle: 90,
      }),
      makeAnnotation({ tool: 'text', points: [{ x: 0.5, y: 0.5 }], text: 'hello' }),
    ];

    expect(() => renderAllAnnotations(ctx, annotations, 640, 480)).not.toThrow();
    // Each annotation triggers save + restore
    expect(ctx.save).toHaveBeenCalledTimes(7); // 6 + 1 from drawAngleMeasurement nested save
    expect(ctx.restore).toHaveBeenCalledTimes(7);
  });
});

// ─── AnnotationCanvas (unit-level) ───

describe('AnnotationCanvas', () => {
  // Stub document and window for the constructor which attaches keydown/resize listeners
  beforeEach(() => {
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createElement: vi.fn(() => ({
        type: '',
        style: {},
        focus: vi.fn(),
        addEventListener: vi.fn(),
        remove: vi.fn(),
      })),
      body: { appendChild: vi.fn() },
    });
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  function createMockCanvas(): HTMLCanvasElement {
    const listeners: Record<string, Function[]> = {};
    return {
      getContext: () => ({
        clearRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        fillText: vi.fn(),
        globalAlpha: 1,
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 1,
        lineCap: 'butt',
        lineJoin: 'miter',
        font: '',
        textAlign: 'start',
        textBaseline: 'alphabetic',
      }),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }),
      width: 640,
      height: 480,
      style: {} as CSSStyleDeclaration,
      offsetLeft: 0,
      offsetTop: 0,
      parentElement: {
        appendChild: vi.fn(),
      },
      addEventListener: vi.fn((type: string, fn: Function) => {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(fn);
      }),
      removeEventListener: vi.fn(),
      closest: vi.fn(() => null),
    } as unknown as HTMLCanvasElement;
  }

  function createMockVideo(): HTMLVideoElement {
    return {
      currentTime: 0,
      duration: 10,
      videoWidth: 640,
      videoHeight: 480,
      clientWidth: 640,
      clientHeight: 480,
    } as unknown as HTMLVideoElement;
  }

  it('creates without error', () => {
    const canvas = createMockCanvas();
    const video = createMockVideo();
    const ac = new AnnotationCanvas(canvas, video);
    expect(ac).toBeDefined();
    ac.destroy();
  });

  it('starts with empty annotations', () => {
    const canvas = createMockCanvas();
    const video = createMockVideo();
    const ac = new AnnotationCanvas(canvas, video);
    expect(ac.getAnnotations()).toHaveLength(0);
    ac.destroy();
  });

  it('loadAnnotations populates annotations', () => {
    const canvas = createMockCanvas();
    const video = createMockVideo();
    const ac = new AnnotationCanvas(canvas, video);

    const anns = [
      makeAnnotation({ id: 'a1' }),
      makeAnnotation({ id: 'a2' }),
    ];
    ac.loadAnnotations(anns);
    expect(ac.getAnnotations()).toHaveLength(2);
    ac.destroy();
  });

  it('clearAll removes all annotations', () => {
    const canvas = createMockCanvas();
    const video = createMockVideo();
    const ac = new AnnotationCanvas(canvas, video);

    ac.loadAnnotations([makeAnnotation(), makeAnnotation()]);
    expect(ac.getAnnotations()).toHaveLength(2);
    ac.clearAll();
    expect(ac.getAnnotations()).toHaveLength(0);
    ac.destroy();
  });

  it('clearAll on empty is a no-op', () => {
    const canvas = createMockCanvas();
    const video = createMockVideo();
    const ac = new AnnotationCanvas(canvas, video);

    ac.clearAll(); // should not throw
    expect(ac.getAnnotations()).toHaveLength(0);
    ac.destroy();
  });

  it('undo restores previous state', () => {
    const canvas = createMockCanvas();
    const video = createMockVideo();
    const ac = new AnnotationCanvas(canvas, video);

    ac.loadAnnotations([makeAnnotation({ id: 'first' })]);
    // Manually add a second annotation by loading a new set after load clears undo
    // We'll test undo on clearAll
    ac.clearAll();
    expect(ac.getAnnotations()).toHaveLength(0);
    ac.undo();
    expect(ac.getAnnotations()).toHaveLength(1);
    ac.destroy();
  });

  it('redo restores after undo', () => {
    const canvas = createMockCanvas();
    const video = createMockVideo();
    const ac = new AnnotationCanvas(canvas, video);

    ac.loadAnnotations([makeAnnotation({ id: 'first' })]);
    ac.clearAll();
    ac.undo(); // restores 1 annotation
    ac.redo(); // back to 0
    expect(ac.getAnnotations()).toHaveLength(0);
    ac.destroy();
  });

  it('undo on empty is a no-op', () => {
    const canvas = createMockCanvas();
    const video = createMockVideo();
    const ac = new AnnotationCanvas(canvas, video);

    ac.undo(); // should not throw
    expect(ac.getAnnotations()).toHaveLength(0);
    ac.destroy();
  });

  it('redo on empty redo stack is a no-op', () => {
    const canvas = createMockCanvas();
    const video = createMockVideo();
    const ac = new AnnotationCanvas(canvas, video);

    ac.redo(); // should not throw
    expect(ac.getAnnotations()).toHaveLength(0);
    ac.destroy();
  });

  it('setTool does not throw', () => {
    const canvas = createMockCanvas();
    const video = createMockVideo();
    const ac = new AnnotationCanvas(canvas, video);
    expect(() => ac.setTool('pen')).not.toThrow();
    expect(() => ac.setTool('angle')).not.toThrow();
    expect(() => ac.setTool('eraser')).not.toThrow();
    ac.destroy();
  });

  it('setStyle does not throw', () => {
    const canvas = createMockCanvas();
    const video = createMockVideo();
    const ac = new AnnotationCanvas(canvas, video);
    expect(() => ac.setStyle({ color: '#ff0000', lineWidth: 5 })).not.toThrow();
    ac.destroy();
  });

  it('setEnabled toggles pointer events', () => {
    const canvas = createMockCanvas();
    const video = createMockVideo();
    const ac = new AnnotationCanvas(canvas, video);

    ac.setEnabled(true);
    expect((canvas.style as unknown as Record<string, unknown>).pointerEvents).toBe('auto');

    ac.setEnabled(false);
    expect((canvas.style as unknown as Record<string, unknown>).pointerEvents).toBe('none');
    ac.destroy();
  });

  it('getAnnotations returns a copy', () => {
    const canvas = createMockCanvas();
    const video = createMockVideo();
    const ac = new AnnotationCanvas(canvas, video);

    ac.loadAnnotations([makeAnnotation()]);
    const anns = ac.getAnnotations();
    anns.push(makeAnnotation({ id: 'extra' }));
    // Original should be unaffected
    expect(ac.getAnnotations()).toHaveLength(1);
    ac.destroy();
  });

  it('destroy removes event listeners', () => {
    const canvas = createMockCanvas();
    const video = createMockVideo();
    const ac = new AnnotationCanvas(canvas, video);

    ac.destroy();
    expect(canvas.removeEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    expect(canvas.removeEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(canvas.removeEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
    expect(canvas.removeEventListener).toHaveBeenCalledWith('pointerleave', expect.any(Function));
  });
});
