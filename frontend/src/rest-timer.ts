/**
 * Rest timer for between-set rest periods.
 * Auto-starts after logging a set, counts down with audio/vibration alerts.
 * Supports pause/resume/skip and +30s/-30s adjustments.
 */

export interface RestTimerState {
  timeRemaining: number;
  totalTime: number;
  isRunning: boolean;
  isPaused: boolean;
}

export interface RestTimerCallbacks {
  onTick: (state: RestTimerState) => void;
  onComplete: () => void;
}

export class RestTimer {
  private timeRemaining: number = 0;
  private totalTime: number = 0;
  private endTime: number = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _isRunning: boolean = false;
  private _isPaused: boolean = false;
  private onTick: (state: RestTimerState) => void;
  private onComplete: () => void;

  constructor(callbacks: RestTimerCallbacks) {
    this.onTick = callbacks.onTick;
    this.onComplete = callbacks.onComplete;
  }

  start(seconds: number): void {
    this.stop();
    this.totalTime = seconds;
    this.timeRemaining = seconds;
    this.endTime = Date.now() + seconds * 1000;
    this._isRunning = true;
    this._isPaused = false;
    this.onTick(this.getState());
    this.startInterval();
  }

  /** Check if timer completed while the app was backgrounded. Call on visibility change. */
  checkBackground(): void {
    if (!this._isRunning || this._isPaused) return;
    const now = Date.now();
    if (now >= this.endTime) {
      this.timeRemaining = 0;
      this.clearInterval();
      this._isRunning = false;
      this._isPaused = false;
      // Play audio and vibrate
      try {
        const ctx = new (window.AudioContext || (window as unknown as Record<string, typeof AudioContext>).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.3;
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } catch { /* audio not available */ }
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([300, 100, 300]);
      }
      this.onComplete();
    } else {
      this.timeRemaining = Math.ceil((this.endTime - now) / 1000);
      this.onTick(this.getState());
    }
  }

  pause(): void {
    if (!this._isRunning || this._isPaused) return;
    this._isPaused = true;
    this.clearInterval();
    this.onTick(this.getState());
  }

  resume(): void {
    if (!this._isRunning || !this._isPaused) return;
    this._isPaused = false;
    this.startInterval();
    this.onTick(this.getState());
  }

  skip(): void {
    this.stop();
    this.onComplete();
  }

  stop(): void {
    this.clearInterval();
    this._isRunning = false;
    this._isPaused = false;
    this.timeRemaining = 0;
  }

  /** Add or subtract seconds (e.g., +30, -30) */
  adjust(seconds: number): void {
    if (!this._isRunning) return;
    this.timeRemaining = Math.max(0, this.timeRemaining + seconds);
    this.totalTime = Math.max(this.totalTime, this.timeRemaining);
    this.onTick(this.getState());
    if (this.timeRemaining <= 0) {
      this.stop();
      this.onComplete();
    }
  }

  getState(): RestTimerState {
    return {
      timeRemaining: this.timeRemaining,
      totalTime: this.totalTime,
      isRunning: this._isRunning,
      isPaused: this._isPaused,
    };
  }

  private startInterval(): void {
    this.clearInterval();
    this.intervalId = setInterval(() => this.tick(), 1000);
  }

  private clearInterval(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private tick(): void {
    if (this._isPaused) return;
    this.timeRemaining--;
    this.onTick(this.getState());

    // Vibrate at 10 seconds remaining
    if (this.timeRemaining === 10 && typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(200);
    }

    // Vibrate + audio alert on complete
    if (this.timeRemaining <= 0) {
      this.stop();
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([300, 100, 300]);
      }
      // Play a short beep using Web Audio API
      try {
        const ctx = new (window.AudioContext || (window as unknown as Record<string, typeof AudioContext>).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880; // A5 note
        gain.gain.value = 0.3;
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } catch { /* audio not available */ }
      this.onComplete();
    }
  }
}

/** Format seconds as M:SS */
export function formatRestTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
