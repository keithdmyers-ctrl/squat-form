import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RestTimer, formatRestTime } from '../rest-timer';
import type { RestTimerState, RestTimerCallbacks } from '../rest-timer';

// ── Helpers ──

function makeCallbacks() {
  return {
    onTick: vi.fn() as unknown as RestTimerCallbacks['onTick'] & ReturnType<typeof vi.fn>,
    onComplete: vi.fn() as unknown as RestTimerCallbacks['onComplete'] & ReturnType<typeof vi.fn>,
  };
}

// ── Constructor & Initial State ──

describe('RestTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor and initial state', () => {
    it('starts with isRunning=false', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      const state = timer.getState();
      expect(state.isRunning).toBe(false);
      expect(state.isPaused).toBe(false);
      expect(state.timeRemaining).toBe(0);
      expect(state.totalTime).toBe(0);
    });

    it('accepts callbacks without error', () => {
      const cb = makeCallbacks();
      expect(() => new RestTimer(cb)).not.toThrow();
    });
  });

  // ── start ──

  describe('start', () => {
    it('starts a timer with the given duration', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(120);
      const state = timer.getState();
      expect(state.isRunning).toBe(true);
      expect(state.isPaused).toBe(false);
      expect(state.timeRemaining).toBe(120);
      expect(state.totalTime).toBe(120);
    });

    it('calls onTick immediately on start', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(60);
      expect(cb.onTick).toHaveBeenCalledTimes(1);
      const tickState: RestTimerState = cb.onTick.mock.calls[0][0];
      expect(tickState.timeRemaining).toBe(60);
      expect(tickState.isRunning).toBe(true);
    });

    it('starts a timer with a small duration (1 second)', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(1);
      expect(timer.getState().timeRemaining).toBe(1);
    });

    it('calling start when already running stops the previous timer first', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(120);
      cb.onTick.mockClear();
      timer.start(60);
      const state = timer.getState();
      expect(state.timeRemaining).toBe(60);
      expect(state.totalTime).toBe(60);
      expect(state.isRunning).toBe(true);
    });

    it('calling start when paused resets and starts fresh', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(120);
      timer.pause();
      timer.start(30);
      const state = timer.getState();
      expect(state.timeRemaining).toBe(30);
      expect(state.isPaused).toBe(false);
      expect(state.isRunning).toBe(true);
    });
  });

  // ── tick (via interval) ──

  describe('tick countdown', () => {
    it('decrements timeRemaining every second', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(10);
      cb.onTick.mockClear();

      vi.advanceTimersByTime(1000);
      expect(timer.getState().timeRemaining).toBe(9);
      expect(cb.onTick).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000);
      expect(timer.getState().timeRemaining).toBe(8);
    });

    it('calls onComplete when timer reaches zero', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(3);

      vi.advanceTimersByTime(3000);
      expect(cb.onComplete).toHaveBeenCalledTimes(1);
      expect(timer.getState().isRunning).toBe(false);
      expect(timer.getState().timeRemaining).toBe(0);
    });

    it('does not call onComplete more than once', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(2);

      vi.advanceTimersByTime(5000);
      expect(cb.onComplete).toHaveBeenCalledTimes(1);
    });

    it('calls onTick on each second until completion', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(3);
      cb.onTick.mockClear();

      vi.advanceTimersByTime(3000);
      // 3 ticks: at 2, 1, 0
      expect(cb.onTick).toHaveBeenCalledTimes(3);
    });
  });

  // ── stop ──

  describe('stop', () => {
    it('stops a running timer', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(60);
      timer.stop();
      const state = timer.getState();
      expect(state.isRunning).toBe(false);
      expect(state.timeRemaining).toBe(0);
    });

    it('stop when already stopped is a no-op', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      expect(() => timer.stop()).not.toThrow();
      expect(timer.getState().isRunning).toBe(false);
    });

    it('does not call onComplete', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(60);
      timer.stop();
      expect(cb.onComplete).not.toHaveBeenCalled();
    });

    it('prevents future ticks after stop', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(60);
      timer.stop();
      cb.onTick.mockClear();
      vi.advanceTimersByTime(5000);
      expect(cb.onTick).not.toHaveBeenCalled();
    });
  });

  // ── pause / resume ──

  describe('pause and resume', () => {
    it('pauses a running timer', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(60);
      timer.pause();
      const state = timer.getState();
      expect(state.isRunning).toBe(true);
      expect(state.isPaused).toBe(true);
    });

    it('calls onTick when pausing', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(60);
      cb.onTick.mockClear();
      timer.pause();
      expect(cb.onTick).toHaveBeenCalledTimes(1);
    });

    it('timeRemaining does not change while paused', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(60);
      vi.advanceTimersByTime(2000); // 58 remaining
      timer.pause();
      const remaining = timer.getState().timeRemaining;

      vi.advanceTimersByTime(10000);
      expect(timer.getState().timeRemaining).toBe(remaining);
    });

    it('resume restarts the countdown', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(60);
      vi.advanceTimersByTime(2000);
      timer.pause();
      const remaining = timer.getState().timeRemaining;

      timer.resume();
      expect(timer.getState().isPaused).toBe(false);

      cb.onTick.mockClear();
      vi.advanceTimersByTime(1000);
      expect(timer.getState().timeRemaining).toBe(remaining - 1);
    });

    it('pause when not running is a no-op', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      cb.onTick.mockClear();
      timer.pause();
      expect(cb.onTick).not.toHaveBeenCalled();
    });

    it('pause when already paused is a no-op', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(60);
      timer.pause();
      cb.onTick.mockClear();
      timer.pause();
      expect(cb.onTick).not.toHaveBeenCalled();
    });

    it('resume when not paused is a no-op', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(60);
      cb.onTick.mockClear();
      timer.resume(); // not paused
      expect(cb.onTick).not.toHaveBeenCalled();
    });

    it('resume when not running is a no-op', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      cb.onTick.mockClear();
      timer.resume();
      expect(cb.onTick).not.toHaveBeenCalled();
    });
  });

  // ── skip ──

  describe('skip', () => {
    it('stops the timer and calls onComplete', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(120);
      timer.skip();
      expect(timer.getState().isRunning).toBe(false);
      expect(cb.onComplete).toHaveBeenCalledTimes(1);
    });

    it('works when timer is paused', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(120);
      timer.pause();
      timer.skip();
      expect(timer.getState().isRunning).toBe(false);
      expect(cb.onComplete).toHaveBeenCalledTimes(1);
    });
  });

  // ── adjust ──

  describe('adjust', () => {
    it('adds 30 seconds', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(60);
      timer.adjust(30);
      expect(timer.getState().timeRemaining).toBe(90);
    });

    it('subtracts 30 seconds', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(60);
      timer.adjust(-30);
      expect(timer.getState().timeRemaining).toBe(30);
    });

    it('updates totalTime when adjustment exceeds original', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(60);
      timer.adjust(60);
      expect(timer.getState().totalTime).toBe(120);
    });

    it('clamps timeRemaining to zero (no negative time)', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(10);
      timer.adjust(-30);
      expect(timer.getState().timeRemaining).toBe(0);
    });

    it('calls onComplete when adjustment brings time to zero', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(10);
      timer.adjust(-20);
      expect(cb.onComplete).toHaveBeenCalledTimes(1);
      expect(timer.getState().isRunning).toBe(false);
    });

    it('does nothing when timer is not running', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      cb.onTick.mockClear();
      timer.adjust(30);
      expect(cb.onTick).not.toHaveBeenCalled();
    });

    it('calls onTick after adjustment', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(60);
      cb.onTick.mockClear();
      timer.adjust(30);
      expect(cb.onTick).toHaveBeenCalledTimes(1);
    });

    it('multiple adjustments accumulate', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(60);
      timer.adjust(30);
      timer.adjust(30);
      timer.adjust(-10);
      expect(timer.getState().timeRemaining).toBe(110);
    });
  });

  // ── checkBackground ──

  describe('checkBackground', () => {
    it('completes the timer if wall clock passed endTime', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(10);
      // Simulate app being backgrounded for 15 seconds
      vi.setSystemTime(Date.now() + 15000);
      timer.checkBackground();
      expect(cb.onComplete).toHaveBeenCalledTimes(1);
      expect(timer.getState().isRunning).toBe(false);
      expect(timer.getState().timeRemaining).toBe(0);
    });

    it('resyncs timeRemaining when app resumes before completion', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(60);
      cb.onTick.mockClear();
      // Simulate being backgrounded for 20 seconds
      vi.setSystemTime(Date.now() + 20000);
      timer.checkBackground();
      expect(timer.getState().timeRemaining).toBe(40);
      expect(cb.onTick).toHaveBeenCalledTimes(1);
    });

    it('does nothing if timer is not running', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      cb.onTick.mockClear();
      timer.checkBackground();
      expect(cb.onTick).not.toHaveBeenCalled();
      expect(cb.onComplete).not.toHaveBeenCalled();
    });

    it('does nothing if timer is paused', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(60);
      timer.pause();
      cb.onTick.mockClear();
      cb.onComplete.mockClear();
      vi.setSystemTime(Date.now() + 120000);
      timer.checkBackground();
      expect(cb.onTick).not.toHaveBeenCalled();
      expect(cb.onComplete).not.toHaveBeenCalled();
    });
  });

  // ── getState ──

  describe('getState', () => {
    it('returns a snapshot with all fields', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(90);
      const state = timer.getState();
      expect(state).toHaveProperty('timeRemaining');
      expect(state).toHaveProperty('totalTime');
      expect(state).toHaveProperty('isRunning');
      expect(state).toHaveProperty('isPaused');
    });

    it('reflects current pause state', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(90);
      timer.pause();
      expect(timer.getState().isPaused).toBe(true);
      timer.resume();
      expect(timer.getState().isPaused).toBe(false);
    });
  });

  // ── full lifecycle ──

  describe('full lifecycle', () => {
    it('start → tick → pause → resume → complete', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);

      timer.start(5);
      expect(timer.getState().isRunning).toBe(true);

      vi.advanceTimersByTime(2000);
      expect(timer.getState().timeRemaining).toBe(3);

      timer.pause();
      vi.advanceTimersByTime(5000);
      expect(timer.getState().timeRemaining).toBe(3);

      timer.resume();
      vi.advanceTimersByTime(3000);
      expect(cb.onComplete).toHaveBeenCalled();
      expect(timer.getState().isRunning).toBe(false);
    });

    it('start → adjust(+30) → countdown completes', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(5);
      timer.adjust(5);
      expect(timer.getState().timeRemaining).toBe(10);

      vi.advanceTimersByTime(10000);
      expect(cb.onComplete).toHaveBeenCalled();
    });

    it('start → skip immediately', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);
      timer.start(300);
      timer.skip();
      expect(cb.onComplete).toHaveBeenCalledTimes(1);
      expect(timer.getState().isRunning).toBe(false);
    });

    it('multiple start/stop cycles work correctly', () => {
      const cb = makeCallbacks();
      const timer = new RestTimer(cb);

      timer.start(10);
      vi.advanceTimersByTime(3000);
      timer.stop();

      timer.start(20);
      expect(timer.getState().timeRemaining).toBe(20);
      vi.advanceTimersByTime(20000);
      expect(cb.onComplete).toHaveBeenCalled();
    });
  });
});

// ── formatRestTime ──

describe('formatRestTime', () => {
  it('formats 0 seconds as 0:00', () => {
    expect(formatRestTime(0)).toBe('0:00');
  });

  it('formats 5 seconds as 0:05', () => {
    expect(formatRestTime(5)).toBe('0:05');
  });

  it('formats 59 seconds as 0:59', () => {
    expect(formatRestTime(59)).toBe('0:59');
  });

  it('formats 60 seconds as 1:00', () => {
    expect(formatRestTime(60)).toBe('1:00');
  });

  it('formats 90 seconds as 1:30', () => {
    expect(formatRestTime(90)).toBe('1:30');
  });

  it('formats 120 seconds as 2:00', () => {
    expect(formatRestTime(120)).toBe('2:00');
  });

  it('formats 301 seconds as 5:01', () => {
    expect(formatRestTime(301)).toBe('5:01');
  });

  it('formats 600 seconds as 10:00', () => {
    expect(formatRestTime(600)).toBe('10:00');
  });

  it('pads single-digit seconds with leading zero', () => {
    expect(formatRestTime(61)).toBe('1:01');
    expect(formatRestTime(69)).toBe('1:09');
  });

  it('handles large values correctly', () => {
    expect(formatRestTime(3600)).toBe('60:00');
  });
});
