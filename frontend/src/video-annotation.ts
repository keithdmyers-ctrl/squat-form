/**
 * Canvas-based video annotation tools for drawing on analyzed video frames,
 * measuring angles, adding text notes, and comparing sessions side-by-side.
 */

// ─── Types ───

export type AnnotationTool = 'pen' | 'line' | 'arrow' | 'circle' | 'angle' | 'text' | 'eraser';

export interface AnnotationStyle {
  color: string;
  lineWidth: number;
  fontSize?: number;
  opacity: number;
}

export interface Annotation {
  id: string;
  tool: AnnotationTool;
  points: Array<{ x: number; y: number }>; // normalized 0-1 coordinates
  style: AnnotationStyle;
  text?: string;       // for text annotations
  angle?: number;      // computed angle for angle tool
  timestamp?: number;  // video timestamp in seconds
  frameIndex?: number;
}

export interface AnnotationSession {
  id: string;
  videoId: string;
  annotations: Annotation[];
  createdAt: string;
  updatedAt: string;
}

export interface ComparisonView {
  leftVideoUrl: string;
  rightVideoUrl: string;
  leftLabel: string;
  rightLabel: string;
  syncPlayback: boolean;
}

// ─── Constants ───

/** Default annotation colors matching the app's design system. */
export const ANNOTATION_COLORS: string[] = [
  '#00d4ff', // accent
  '#4ade80', // success
  '#fbbf24', // warning
  '#f87171', // danger
  '#ffffff', // white
];

const DEFAULT_STYLE: AnnotationStyle = {
  color: '#00d4ff',
  lineWidth: 2,
  fontSize: 16,
  opacity: 1,
};

const MAX_UNDO_STACK = 50;
const ERASER_HIT_RADIUS = 20; // pixels (at canvas scale)

const ANNOTATION_STORAGE_PREFIX = 'squat-annotation-';

// ─── Utility Functions ───

/** Generate a unique ID. */
function generateId(): string {
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Normalize a pixel coordinate to 0-1 range. */
export function normalizePoint(
  px: number,
  py: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: width > 0 ? px / width : 0,
    y: height > 0 ? py / height : 0,
  };
}

/** Denormalize a 0-1 coordinate to pixel coordinates. */
export function denormalizePoint(
  nx: number,
  ny: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: nx * width,
    y: ny * height,
  };
}

// ─── Angle Measurement ───

/**
 * Calculate the angle between three points (vertex at the middle point).
 * Returns the angle in degrees (0-360 range mapped to 0-180 interior angle).
 */
export function measureAngle(
  p1: { x: number; y: number },
  p2: { x: number; y: number }, // vertex
  p3: { x: number; y: number },
): number {
  const v1x = p1.x - p2.x;
  const v1y = p1.y - p2.y;
  const v2x = p3.x - p2.x;
  const v2y = p3.y - p2.y;

  const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const len2 = Math.sqrt(v2x * v2x + v2y * v2y);

  if (len1 < 1e-9 || len2 < 1e-9) {
    return 0;
  }

  const dot = v1x * v2x + v1y * v2y;
  let cosAngle = dot / (len1 * len2);
  cosAngle = Math.max(-1, Math.min(1, cosAngle));
  return (Math.acos(cosAngle) * 180) / Math.PI;
}

/**
 * Render the angle measurement visualization:
 * - Lines from vertex to both points
 * - Arc showing the angle
 * - Degree label at the vertex
 */
export function drawAngleMeasurement(
  ctx: CanvasRenderingContext2D,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  style: AnnotationStyle,
  canvasWidth: number,
  canvasHeight: number,
): void {
  // Denormalize points
  const dp1 = denormalizePoint(p1.x, p1.y, canvasWidth, canvasHeight);
  const dp2 = denormalizePoint(p2.x, p2.y, canvasWidth, canvasHeight);
  const dp3 = denormalizePoint(p3.x, p3.y, canvasWidth, canvasHeight);

  ctx.save();
  ctx.globalAlpha = style.opacity;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Draw lines from vertex to both endpoints
  ctx.beginPath();
  ctx.moveTo(dp1.x, dp1.y);
  ctx.lineTo(dp2.x, dp2.y);
  ctx.lineTo(dp3.x, dp3.y);
  ctx.stroke();

  // Draw arc at vertex
  const angle = measureAngle(p1, p2, p3);
  const startAngle = Math.atan2(dp1.y - dp2.y, dp1.x - dp2.x);
  const endAngle = Math.atan2(dp3.y - dp2.y, dp3.x - dp2.x);

  const arcRadius = Math.min(30, canvasWidth * 0.04);
  ctx.beginPath();
  // Determine sweep direction for the smaller arc
  let sa = startAngle;
  let ea = endAngle;
  // Normalize angles
  if (sa < 0) sa += 2 * Math.PI;
  if (ea < 0) ea += 2 * Math.PI;

  let diff = ea - sa;
  if (diff < 0) diff += 2 * Math.PI;
  const counterclockwise = diff > Math.PI;

  ctx.arc(dp2.x, dp2.y, arcRadius, startAngle, endAngle, counterclockwise);
  ctx.stroke();

  // Draw degree label
  const midAngle = (startAngle + endAngle) / 2;
  // Adjust midAngle if counterclockwise
  const labelRadius = arcRadius + 14;
  const labelX = dp2.x + Math.cos(counterclockwise ? midAngle + Math.PI : midAngle) * labelRadius;
  const labelY = dp2.y + Math.sin(counterclockwise ? midAngle + Math.PI : midAngle) * labelRadius;

  const fontSize = style.fontSize ?? 14;
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.fillStyle = style.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.round(angle)}\u00B0`, labelX, labelY);

  // Draw small dots at each point
  for (const dp of [dp1, dp2, dp3]) {
    ctx.beginPath();
    ctx.arc(dp.x, dp.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = style.color;
    ctx.fill();
  }

  ctx.restore();
}

// ─── Hit Testing ───

/** Distance from a point to a line segment. */
function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) {
    return Math.sqrt((px - ax) * (px - ax) + (py - ay) * (py - ay));
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.sqrt((px - projX) * (px - projX) + (py - projY) * (py - projY));
}

/**
 * Hit-test: check if a pixel point is within hitRadius of an annotation.
 * Coordinates are in pixel space (denormalized).
 */
export function hitTestAnnotation(
  annotation: Annotation,
  px: number,
  py: number,
  canvasWidth: number,
  canvasHeight: number,
  hitRadius: number = ERASER_HIT_RADIUS,
): boolean {
  const points = annotation.points.map((p) => denormalizePoint(p.x, p.y, canvasWidth, canvasHeight));

  switch (annotation.tool) {
    case 'pen': {
      for (let i = 0; i < points.length - 1; i++) {
        const dist = pointToSegmentDistance(px, py, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
        if (dist <= hitRadius) return true;
      }
      // Also check single-point pens
      if (points.length === 1) {
        const dist = Math.sqrt((px - points[0].x) ** 2 + (py - points[0].y) ** 2);
        return dist <= hitRadius;
      }
      return false;
    }

    case 'line':
    case 'arrow': {
      if (points.length < 2) return false;
      const dist = pointToSegmentDistance(px, py, points[0].x, points[0].y, points[1].x, points[1].y);
      return dist <= hitRadius;
    }

    case 'circle': {
      if (points.length < 2) return false;
      const cx = points[0].x;
      const cy = points[0].y;
      const r = Math.sqrt((points[1].x - cx) ** 2 + (points[1].y - cy) ** 2);
      const dist = Math.abs(Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) - r);
      return dist <= hitRadius;
    }

    case 'angle': {
      // Check distance to each line segment (vertex is points[1])
      if (points.length < 3) return false;
      const d1 = pointToSegmentDistance(px, py, points[0].x, points[0].y, points[1].x, points[1].y);
      const d2 = pointToSegmentDistance(px, py, points[1].x, points[1].y, points[2].x, points[2].y);
      return Math.min(d1, d2) <= hitRadius;
    }

    case 'text': {
      if (points.length < 1) return false;
      const dist = Math.sqrt((px - points[0].x) ** 2 + (py - points[0].y) ** 2);
      return dist <= hitRadius * 2; // larger hit area for text
    }

    default:
      return false;
  }
}

// ─── Rendering Annotations ───

/** Render a single annotation onto a canvas context. */
function renderAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const points = annotation.points.map((p) => denormalizePoint(p.x, p.y, canvasWidth, canvasHeight));
  const style = annotation.style;

  ctx.save();
  ctx.globalAlpha = style.opacity;
  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (annotation.tool) {
    case 'pen': {
      if (points.length < 1) break;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
      break;
    }

    case 'line': {
      if (points.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[1].x, points[1].y);
      ctx.stroke();
      break;
    }

    case 'arrow': {
      if (points.length < 2) break;
      const start = points[0];
      const end = points[1];

      // Draw line
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      // Draw arrowhead
      const headLen = Math.max(10, style.lineWidth * 5);
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(
        end.x - headLen * Math.cos(angle - Math.PI / 6),
        end.y - headLen * Math.sin(angle - Math.PI / 6),
      );
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(
        end.x - headLen * Math.cos(angle + Math.PI / 6),
        end.y - headLen * Math.sin(angle + Math.PI / 6),
      );
      ctx.stroke();
      break;
    }

    case 'circle': {
      if (points.length < 2) break;
      const cx = points[0].x;
      const cy = points[0].y;
      const r = Math.sqrt((points[1].x - cx) ** 2 + (points[1].y - cy) ** 2);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case 'angle': {
      if (points.length < 3) break;
      drawAngleMeasurement(
        ctx,
        annotation.points[0],
        annotation.points[1],
        annotation.points[2],
        style,
        canvasWidth,
        canvasHeight,
      );
      break;
    }

    case 'text': {
      if (points.length < 1 || !annotation.text) break;
      const fontSize = style.fontSize ?? 16;
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(annotation.text, points[0].x, points[0].y);
      break;
    }

    // eraser is handled via removal, not rendering
  }

  ctx.restore();
}

/** Render all annotations onto a canvas context. */
export function renderAllAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  canvasWidth: number,
  canvasHeight: number,
): void {
  for (const ann of annotations) {
    renderAnnotation(ctx, ann, canvasWidth, canvasHeight);
  }
}

// ─── AnnotationCanvas Class ───

export class AnnotationCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private videoElement: HTMLVideoElement;

  private activeTool: AnnotationTool = 'pen';
  private activeStyle: AnnotationStyle = { ...DEFAULT_STYLE };
  private enabled = false;

  private annotations: Annotation[] = [];
  private undoStack: Annotation[][] = [];
  private redoStack: Annotation[][] = [];

  // Drawing state
  private isDrawing = false;
  private currentPoints: Array<{ x: number; y: number }> = [];
  private angleClickCount = 0;
  private textInputActive = false;
  private textInputPosition: { x: number; y: number } | null = null;

  // Bound event handlers (for removal)
  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundResize: () => void;
  private animFrameId: number | null = null;

  constructor(canvas: HTMLCanvasElement, videoElement: HTMLVideoElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context from annotation canvas');
    this.ctx = ctx;
    this.videoElement = videoElement;

    // Bind event handlers
    this.boundPointerDown = this.onPointerDown.bind(this);
    this.boundPointerMove = this.onPointerMove.bind(this);
    this.boundPointerUp = this.onPointerUp.bind(this);
    this.boundKeyDown = this.onKeyDown.bind(this);
    this.boundResize = this.onResize.bind(this);

    // Attach listeners
    this.canvas.addEventListener('pointerdown', this.boundPointerDown);
    this.canvas.addEventListener('pointermove', this.boundPointerMove);
    this.canvas.addEventListener('pointerup', this.boundPointerUp);
    this.canvas.addEventListener('pointerleave', this.boundPointerUp);
    document.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('resize', this.boundResize);

    // Initial canvas sizing
    this.syncCanvasSize();
  }

  /** Set the active drawing tool. */
  setTool(tool: AnnotationTool): void {
    // If switching away from angle tool mid-draw, discard partial
    if (this.activeTool === 'angle' && this.angleClickCount > 0) {
      this.angleClickCount = 0;
      this.currentPoints = [];
    }
    this.activeTool = tool;
    this.canvas.style.cursor = tool === 'eraser' ? 'crosshair' : 'default';
  }

  /** Set the drawing style (partial update). */
  setStyle(style: Partial<AnnotationStyle>): void {
    Object.assign(this.activeStyle, style);
  }

  /** Enable/disable annotation mode. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.canvas.style.pointerEvents = enabled ? 'auto' : 'none';
    if (!enabled) {
      this.isDrawing = false;
      this.currentPoints = [];
      this.angleClickCount = 0;
    }
    this.redraw();
  }

  /** Undo the last annotation. */
  undo(): void {
    if (this.undoStack.length === 0) return;
    this.pushRedoState();
    this.annotations = this.undoStack.pop()!;
    this.redraw();
  }

  /** Redo the last undone annotation. */
  redo(): void {
    if (this.redoStack.length === 0) return;
    this.pushUndoState();
    const state = this.redoStack.pop()!;
    this.annotations = state;
    this.redraw();
  }

  /** Clear all annotations. */
  clearAll(): void {
    if (this.annotations.length === 0) return;
    this.pushUndoState();
    this.redoStack = [];
    this.annotations = [];
    this.redraw();
  }

  /** Get all annotations. */
  getAnnotations(): Annotation[] {
    return [...this.annotations];
  }

  /** Load annotations (e.g., from storage). */
  loadAnnotations(annotations: Annotation[]): void {
    this.annotations = [...annotations];
    this.undoStack = [];
    this.redoStack = [];
    this.redraw();
  }

  /** Export the current frame with annotations as a data URL. */
  exportFrame(): string {
    // Create a temporary canvas with the video frame + annotations
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.videoElement.videoWidth || this.canvas.width;
    tempCanvas.height = this.videoElement.videoHeight || this.canvas.height;
    const tempCtx = tempCanvas.getContext('2d')!;

    // Draw video frame
    tempCtx.drawImage(this.videoElement, 0, 0, tempCanvas.width, tempCanvas.height);

    // Draw annotations
    renderAllAnnotations(tempCtx, this.annotations, tempCanvas.width, tempCanvas.height);

    return tempCanvas.toDataURL('image/png');
  }

  /** Destroy the canvas and remove event listeners. */
  destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.boundPointerDown);
    this.canvas.removeEventListener('pointermove', this.boundPointerMove);
    this.canvas.removeEventListener('pointerup', this.boundPointerUp);
    this.canvas.removeEventListener('pointerleave', this.boundPointerUp);
    document.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('resize', this.boundResize);
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
    }
  }

  // ─── Internal Methods ───

  private syncCanvasSize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.canvas.width = rect.width;
      this.canvas.height = rect.height;
    }
  }

  private pushUndoState(): void {
    this.undoStack.push([...this.annotations]);
    if (this.undoStack.length > MAX_UNDO_STACK) {
      this.undoStack.shift();
    }
  }

  private pushRedoState(): void {
    this.redoStack.push([...this.annotations]);
    if (this.redoStack.length > MAX_UNDO_STACK) {
      this.redoStack.shift();
    }
  }

  private getCanvasPoint(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private getNormalizedPoint(e: PointerEvent): { x: number; y: number } {
    const pt = this.getCanvasPoint(e);
    return normalizePoint(pt.x, pt.y, this.canvas.width, this.canvas.height);
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.enabled) return;
    e.preventDefault();

    const norm = this.getNormalizedPoint(e);
    const pt = this.getCanvasPoint(e);

    switch (this.activeTool) {
      case 'eraser': {
        this.handleEraser(pt.x, pt.y);
        break;
      }

      case 'angle': {
        this.currentPoints.push(norm);
        this.angleClickCount++;
        if (this.angleClickCount === 3) {
          this.pushUndoState();
          this.redoStack = [];
          const angle = measureAngle(this.currentPoints[0], this.currentPoints[1], this.currentPoints[2]);
          this.annotations.push({
            id: generateId(),
            tool: 'angle',
            points: [...this.currentPoints],
            style: { ...this.activeStyle },
            angle,
            timestamp: this.videoElement.currentTime,
          });
          this.currentPoints = [];
          this.angleClickCount = 0;
        }
        this.redraw();
        break;
      }

      case 'text': {
        this.textInputPosition = norm;
        this.textInputActive = true;
        this.showTextInput(pt.x, pt.y);
        break;
      }

      default: {
        this.isDrawing = true;
        this.currentPoints = [norm];
        break;
      }
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.enabled || !this.isDrawing) return;
    e.preventDefault();

    const norm = this.getNormalizedPoint(e);

    if (this.activeTool === 'pen') {
      this.currentPoints.push(norm);
      this.scheduleDraw();
    } else if (this.activeTool === 'line' || this.activeTool === 'arrow' || this.activeTool === 'circle') {
      // Update the end point for preview
      if (this.currentPoints.length >= 2) {
        this.currentPoints[1] = norm;
      } else {
        this.currentPoints.push(norm);
      }
      this.scheduleDraw();
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.enabled || !this.isDrawing) return;
    e.preventDefault();

    const norm = this.getNormalizedPoint(e);

    if (this.activeTool === 'pen') {
      if (this.currentPoints.length > 0) {
        this.pushUndoState();
        this.redoStack = [];
        this.annotations.push({
          id: generateId(),
          tool: 'pen',
          points: [...this.currentPoints],
          style: { ...this.activeStyle },
          timestamp: this.videoElement.currentTime,
        });
      }
    } else if (this.activeTool === 'line' || this.activeTool === 'arrow' || this.activeTool === 'circle') {
      if (this.currentPoints.length >= 1) {
        if (this.currentPoints.length < 2) {
          this.currentPoints.push(norm);
        } else {
          this.currentPoints[1] = norm;
        }
        this.pushUndoState();
        this.redoStack = [];
        this.annotations.push({
          id: generateId(),
          tool: this.activeTool,
          points: [...this.currentPoints],
          style: { ...this.activeStyle },
          timestamp: this.videoElement.currentTime,
        });
      }
    }

    this.isDrawing = false;
    this.currentPoints = [];
    this.redraw();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.enabled) return;

    // Ctrl+Z / Cmd+Z for undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    }
    // Ctrl+Shift+Z / Cmd+Shift+Z for redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
      e.preventDefault();
      this.redo();
    }
    // Ctrl+Y for redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      e.preventDefault();
      this.redo();
    }
  }

  private onResize(): void {
    this.syncCanvasSize();
    this.redraw();
  }

  private handleEraser(px: number, py: number): void {
    const idx = this.annotations.findIndex((ann) =>
      hitTestAnnotation(ann, px, py, this.canvas.width, this.canvas.height, ERASER_HIT_RADIUS),
    );
    if (idx >= 0) {
      this.pushUndoState();
      this.redoStack = [];
      this.annotations.splice(idx, 1);
      this.redraw();
    }
  }

  private showTextInput(px: number, py: number): void {
    // Create a temporary input overlaying the canvas
    const input = document.createElement('input');
    input.type = 'text';
    input.style.position = 'absolute';
    input.style.left = `${this.canvas.offsetLeft + px}px`;
    input.style.top = `${this.canvas.offsetTop + py}px`;
    input.style.background = 'rgba(0,0,0,0.7)';
    input.style.color = this.activeStyle.color;
    input.style.border = `1px solid ${this.activeStyle.color}`;
    input.style.borderRadius = '4px';
    input.style.padding = '2px 6px';
    input.style.fontSize = `${this.activeStyle.fontSize ?? 16}px`;
    input.style.outline = 'none';
    input.style.zIndex = '10000';
    input.style.minWidth = '100px';

    const parent = this.canvas.parentElement ?? document.body;
    parent.appendChild(input);
    input.focus();

    const commit = (): void => {
      const text = input.value.trim();
      if (text && this.textInputPosition) {
        this.pushUndoState();
        this.redoStack = [];
        this.annotations.push({
          id: generateId(),
          tool: 'text',
          points: [this.textInputPosition],
          style: { ...this.activeStyle },
          text,
          timestamp: this.videoElement.currentTime,
        });
      }
      input.remove();
      this.textInputActive = false;
      this.textInputPosition = null;
      this.redraw();
    };

    input.addEventListener('keydown', (ke) => {
      if (ke.key === 'Enter') {
        ke.preventDefault();
        commit();
      }
      if (ke.key === 'Escape') {
        input.remove();
        this.textInputActive = false;
        this.textInputPosition = null;
      }
    });
    input.addEventListener('blur', commit);
  }

  private scheduleDraw(): void {
    if (this.animFrameId !== null) return;
    this.animFrameId = requestAnimationFrame(() => {
      this.animFrameId = null;
      this.redraw();
    });
  }

  private redraw(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Render committed annotations
    renderAllAnnotations(this.ctx, this.annotations, this.canvas.width, this.canvas.height);

    // Render in-progress drawing
    if (this.isDrawing && this.currentPoints.length > 0) {
      const preview: Annotation = {
        id: 'preview',
        tool: this.activeTool,
        points: [...this.currentPoints],
        style: this.activeStyle,
      };
      renderAnnotation(this.ctx, preview, this.canvas.width, this.canvas.height);
    }

    // Render in-progress angle points
    if (this.activeTool === 'angle' && this.angleClickCount > 0 && this.currentPoints.length > 0) {
      this.ctx.save();
      this.ctx.fillStyle = this.activeStyle.color;
      this.ctx.globalAlpha = this.activeStyle.opacity;
      for (const np of this.currentPoints) {
        const dp = denormalizePoint(np.x, np.y, this.canvas.width, this.canvas.height);
        this.ctx.beginPath();
        this.ctx.arc(dp.x, dp.y, 5, 0, Math.PI * 2);
        this.ctx.fill();
      }
      // Draw connecting lines for placed points
      if (this.currentPoints.length === 2) {
        const dp0 = denormalizePoint(this.currentPoints[0].x, this.currentPoints[0].y, this.canvas.width, this.canvas.height);
        const dp1 = denormalizePoint(this.currentPoints[1].x, this.currentPoints[1].y, this.canvas.width, this.canvas.height);
        this.ctx.strokeStyle = this.activeStyle.color;
        this.ctx.lineWidth = this.activeStyle.lineWidth;
        this.ctx.beginPath();
        this.ctx.moveTo(dp0.x, dp0.y);
        this.ctx.lineTo(dp1.x, dp1.y);
        this.ctx.stroke();
      }
      this.ctx.restore();
    }
  }
}

// ─── Frame Navigation ───

/**
 * Render frame navigation controls HTML.
 */
export function renderFrameControls(_videoElement: HTMLVideoElement, _fps: number): string {
  return `
    <div class="frame-controls" role="group" aria-label="Frame navigation">
      <button class="btn-sm frame-step-back" aria-label="Previous frame" title="Previous frame">&laquo; Frame</button>
      <span class="frame-counter" aria-live="polite"></span>
      <button class="btn-sm frame-step-fwd" aria-label="Next frame" title="Next frame">Frame &raquo;</button>
    </div>
  `.trim();
}

/**
 * Step the video forward or backward by one frame.
 */
export function stepFrame(
  video: HTMLVideoElement,
  fps: number,
  direction: 'forward' | 'backward',
): void {
  if (fps <= 0) return;
  const frameTime = 1 / fps;
  if (direction === 'forward') {
    video.currentTime = Math.min(video.duration || Infinity, video.currentTime + frameTime);
  } else {
    video.currentTime = Math.max(0, video.currentTime - frameTime);
  }
}

/**
 * Capture the current video frame as a canvas.
 */
export function captureFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || video.clientWidth || 640;
  canvas.height = video.videoHeight || video.clientHeight || 480;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// ─── Side-by-Side Comparison ───

/**
 * Render a side-by-side comparison container HTML.
 */
export function renderComparisonView(config: ComparisonView): string {
  return `
    <div class="comparison-view" role="region" aria-label="Side-by-side video comparison">
      <div class="comparison-panel comparison-left">
        <div class="comparison-label">${escapeHtml(config.leftLabel)}</div>
        <div class="comparison-video-wrapper">
          <video class="comparison-video comparison-video-left" src="${escapeHtml(config.leftVideoUrl)}" preload="metadata" playsinline></video>
          <canvas class="comparison-annotation-canvas comparison-canvas-left"></canvas>
        </div>
      </div>
      <div class="comparison-panel comparison-right">
        <div class="comparison-label">${escapeHtml(config.rightLabel)}</div>
        <div class="comparison-video-wrapper">
          <video class="comparison-video comparison-video-right" src="${escapeHtml(config.rightVideoUrl)}" preload="metadata" playsinline></video>
          <canvas class="comparison-annotation-canvas comparison-canvas-right"></canvas>
        </div>
      </div>
      <div class="comparison-controls">
        <button class="btn-sm comparison-play" aria-label="Play both videos">Play</button>
        <button class="btn-sm comparison-pause" aria-label="Pause both videos">Pause</button>
        <input type="range" class="comparison-seek" min="0" max="100" value="0" aria-label="Seek both videos" />
      </div>
    </div>
  `.trim();
}

/** Escape HTML special characters. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Sync playback of two video elements.
 */
export function syncVideos(
  video1: HTMLVideoElement,
  video2: HTMLVideoElement,
): {
  play: () => void;
  pause: () => void;
  seekTo: (time: number) => void;
  destroy: () => void;
} {
  let destroyed = false;

  const onPlay1 = (): void => {
    if (destroyed) return;
    if (video2.paused) video2.play();
  };
  const onPause1 = (): void => {
    if (destroyed) return;
    if (!video2.paused) video2.pause();
  };
  const onSeeked1 = (): void => {
    if (destroyed) return;
    if (Math.abs(video2.currentTime - video1.currentTime) > 0.1) {
      video2.currentTime = video1.currentTime;
    }
  };

  video1.addEventListener('play', onPlay1);
  video1.addEventListener('pause', onPause1);
  video1.addEventListener('seeked', onSeeked1);

  return {
    play: () => {
      video1.play();
      video2.play();
    },
    pause: () => {
      video1.pause();
      video2.pause();
    },
    seekTo: (time: number) => {
      video1.currentTime = time;
      video2.currentTime = time;
    },
    destroy: () => {
      destroyed = true;
      video1.removeEventListener('play', onPlay1);
      video1.removeEventListener('pause', onPause1);
      video1.removeEventListener('seeked', onSeeked1);
    },
  };
}

// ─── Storage ───

/**
 * Save an annotation session to localStorage.
 */
export function saveAnnotationSession(session: AnnotationSession): void {
  session.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(
      `${ANNOTATION_STORAGE_PREFIX}${session.videoId}`,
      JSON.stringify(session),
    );
  } catch {
    console.warn('Failed to save annotation session to localStorage');
  }
}

/**
 * Load an annotation session from localStorage.
 */
export function loadAnnotationSession(videoId: string): AnnotationSession | null {
  try {
    const raw = localStorage.getItem(`${ANNOTATION_STORAGE_PREFIX}${videoId}`);
    if (!raw) return null;
    return JSON.parse(raw) as AnnotationSession;
  } catch {
    return null;
  }
}

/**
 * Delete an annotation session from localStorage.
 */
export function deleteAnnotationSession(videoId: string): void {
  try {
    localStorage.removeItem(`${ANNOTATION_STORAGE_PREFIX}${videoId}`);
  } catch {
    // Ignore
  }
}

/**
 * Export annotated frame as PNG data URL.
 */
export function exportAnnotatedFrame(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  annotations: Annotation[],
): string {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = video.videoWidth || canvas.width;
  tempCanvas.height = video.videoHeight || canvas.height;
  const tempCtx = tempCanvas.getContext('2d')!;

  // Draw video frame
  tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

  // Draw annotations
  renderAllAnnotations(tempCtx, annotations, tempCanvas.width, tempCanvas.height);

  return tempCanvas.toDataURL('image/png');
}

/**
 * Export all annotations as JSON for sharing.
 */
export function exportAnnotationsJSON(session: AnnotationSession): string {
  return JSON.stringify(session, null, 2);
}

// ─── Toolbar UI ───

/**
 * Render the annotation toolbar HTML.
 */
export function renderAnnotationToolbar(): string {
  const toolButtons = [
    { tool: 'pen', label: 'Pen', icon: '\u270F' },
    { tool: 'line', label: 'Line', icon: '\u2014' },
    { tool: 'arrow', label: 'Arrow', icon: '\u2192' },
    { tool: 'circle', label: 'Circle', icon: '\u25CB' },
    { tool: 'angle', label: 'Angle', icon: '\u2220' },
    { tool: 'text', label: 'Text', icon: 'T' },
    { tool: 'eraser', label: 'Eraser', icon: '\u2421' },
  ];

  const colorSwatches = ANNOTATION_COLORS.map(
    (c) => `<button class="annotation-color-swatch" data-color="${c}" style="background:${c};" aria-label="Color ${c}" title="${c}"></button>`,
  ).join('');

  const tools = toolButtons.map(
    (t) => `<button class="btn-sm annotation-tool-btn" data-tool="${t.tool}" aria-label="${t.label}" title="${t.label}">${t.icon}</button>`,
  ).join('');

  return `
    <div class="annotation-toolbar" role="toolbar" aria-label="Annotation tools">
      <div class="annotation-tools-group">
        ${tools}
      </div>
      <div class="annotation-colors-group">
        ${colorSwatches}
      </div>
      <div class="annotation-size-group">
        <label class="annotation-size-label">
          <span>Width</span>
          <input type="range" class="annotation-line-width" min="1" max="10" value="2" aria-label="Line width" />
        </label>
      </div>
      <div class="annotation-actions-group">
        <button class="btn-sm annotation-undo-btn" aria-label="Undo" title="Undo">Undo</button>
        <button class="btn-sm annotation-redo-btn" aria-label="Redo" title="Redo">Redo</button>
        <button class="btn-sm annotation-clear-btn" aria-label="Clear all" title="Clear all annotations">Clear</button>
        <button class="btn-sm annotation-export-btn" aria-label="Export frame" title="Export annotated frame">Export</button>
      </div>
    </div>
  `.trim();
}
