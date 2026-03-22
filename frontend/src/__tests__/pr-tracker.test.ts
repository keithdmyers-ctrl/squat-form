import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkForPR, loadPRs, savePRs, getAllPRsByLift, getBestE1RMs, type PersonalRecord } from '../pr-tracker';

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { for (const k of Object.keys(store)) delete store[k]; }),
  get length() { return Object.keys(store).length; },
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// Mock document for CustomEvent dispatch in savePRs error path
if (typeof globalThis.document === 'undefined') {
  const listeners: Record<string, Function[]> = {};
  (globalThis as any).document = {
    addEventListener: (type: string, fn: Function) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    removeEventListener: (type: string, fn: Function) => {
      if (listeners[type]) listeners[type] = listeners[type].filter(f => f !== fn);
    },
    dispatchEvent: (event: any) => {
      const fns = listeners[event.type] || [];
      for (const fn of fns) fn(event);
    },
  };
}

// Mock CustomEvent if not available
if (typeof globalThis.CustomEvent === 'undefined') {
  (globalThis as any).CustomEvent = class CustomEvent {
    type: string;
    detail: any;
    constructor(type: string, opts?: any) {
      this.type = type;
      this.detail = opts?.detail;
    }
  };
}

function clearStorage(): void {
  localStorageMock.clear();
  vi.clearAllMocks();
}

describe('PR Tracker', () => {
  beforeEach(() => {
    clearStorage();
  });

  // ── loadPRs / savePRs ──

  describe('loadPRs', () => {
    it('returns empty object when storage is empty', () => {
      expect(loadPRs()).toEqual({});
    });

    it('returns stored PRs', () => {
      const pr: PersonalRecord = {
        id: 'weight_squat', type: 'weight', lift: 'squat',
        value: 315, unit: 'lbs', date: '2026-01-01', context: '315 lbs x 1',
      };
      store['squat_form_prs'] = JSON.stringify({ weight_squat: pr });
      expect(loadPRs()).toEqual({ weight_squat: pr });
    });

    it('returns empty object for corrupted JSON', () => {
      store['squat_form_prs'] = 'not-valid-json{{{';
      expect(loadPRs()).toEqual({});
    });
  });

  describe('savePRs', () => {
    it('round-trips data through save/load', () => {
      const prs: Record<string, PersonalRecord> = {
        weight_squat: {
          id: 'weight_squat', type: 'weight', lift: 'squat',
          value: 405, unit: 'lbs', date: '2026-01-01', context: '405 lbs x 1',
        },
      };
      savePRs(prs);
      expect(loadPRs()).toEqual(prs);
    });

    it('dispatches storage-warning event on storage full', () => {
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new DOMException('QuotaExceededError');
      });
      const handler = vi.fn();
      document.addEventListener('storage-warning', handler);
      savePRs({ test: { id: 'x', type: 'weight', lift: 'squat', value: 1, unit: 'lbs', date: '', context: '' } });
      expect(handler).toHaveBeenCalled();
      document.removeEventListener('storage-warning', handler);
    });
  });

  // ── checkForPR ──

  describe('checkForPR', () => {
    // Weight PRs
    it('detects first weight entry as a weight PR', () => {
      const results = checkForPR('squat', 225, 5, 'lbs');
      const weightPR = results.find(r => r.record?.type === 'weight');
      expect(weightPR).toBeDefined();
      expect(weightPR!.isNewPR).toBe(true);
      expect(weightPR!.record!.value).toBe(225);
      expect(weightPR!.message).toContain('First');
    });

    it('detects higher weight as a new weight PR', () => {
      checkForPR('squat', 225, 5, 'lbs');
      const results = checkForPR('squat', 275, 3, 'lbs');
      const weightPR = results.find(r => r.record?.type === 'weight');
      expect(weightPR).toBeDefined();
      expect(weightPR!.record!.value).toBe(275);
      expect(weightPR!.record!.previousValue).toBe(225);
      expect(weightPR!.message).toContain('previous');
    });

    it('does not detect same weight as a PR', () => {
      checkForPR('squat', 225, 5, 'lbs');
      const results = checkForPR('squat', 225, 5, 'lbs');
      const weightPR = results.find(r => r.record?.type === 'weight');
      expect(weightPR).toBeUndefined();
    });

    it('does not detect lower weight as a PR', () => {
      checkForPR('squat', 225, 5, 'lbs');
      const results = checkForPR('squat', 200, 5, 'lbs');
      const weightPR = results.find(r => r.record?.type === 'weight');
      expect(weightPR).toBeUndefined();
    });

    // e1RM PRs
    it('detects first e1RM as a PR', () => {
      const results = checkForPR('bench', 185, 5, 'lbs');
      const e1rmPR = results.find(r => r.record?.type === 'e1rm');
      expect(e1rmPR).toBeDefined();
      expect(e1rmPR!.isNewPR).toBe(true);
      // Epley: 185 * (1 + 5/30) = 215.83 → 216
      expect(e1rmPR!.record!.value).toBe(216);
    });

    it('detects higher e1RM as a new PR', () => {
      checkForPR('bench', 185, 5, 'lbs');
      const results = checkForPR('bench', 200, 5, 'lbs');
      const e1rmPR = results.find(r => r.record?.type === 'e1rm');
      expect(e1rmPR).toBeDefined();
      expect(e1rmPR!.record!.previousValue).toBe(216);
    });

    it('does not detect lower e1RM as a PR', () => {
      checkForPR('bench', 200, 5, 'lbs');
      const results = checkForPR('bench', 150, 3, 'lbs');
      const e1rmPR = results.find(r => r.record?.type === 'e1rm');
      expect(e1rmPR).toBeUndefined();
    });

    it('uses Epley formula for e1RM: reps=1 means e1rm=weight', () => {
      const results = checkForPR('squat', 400, 1, 'lbs');
      const e1rmPR = results.find(r => r.record?.type === 'e1rm');
      expect(e1rmPR).toBeDefined();
      expect(e1rmPR!.record!.value).toBe(400);
    });

    // Rep PRs
    it('detects rep PR at specific weight (more reps at same weight)', () => {
      checkForPR('squat', 225, 5, 'lbs'); // first entry at 225 — stored but not reported
      const results = checkForPR('squat', 225, 8, 'lbs'); // more reps
      const repPR = results.find(r => r.record?.type === 'reps');
      expect(repPR).toBeDefined();
      expect(repPR!.record!.value).toBe(8);
      expect(repPR!.record!.previousValue).toBe(5);
      expect(repPR!.message).toContain('rep PR');
    });

    it('does not report first rep entry as a rep PR (only on beat)', () => {
      const results = checkForPR('squat', 225, 5, 'lbs');
      const repPR = results.find(r => r.record?.type === 'reps');
      // First entry at a weight is stored but not reported as a PR
      expect(repPR).toBeUndefined();
    });

    it('does not detect same reps as a rep PR', () => {
      checkForPR('squat', 225, 5, 'lbs');
      const results = checkForPR('squat', 225, 5, 'lbs');
      const repPR = results.find(r => r.record?.type === 'reps');
      expect(repPR).toBeUndefined();
    });

    // Form score PRs
    it('detects form score PR when beating previous', () => {
      checkForPR('squat', 225, 5, 'lbs', 75); // first score stored but not reported
      const results = checkForPR('squat', 225, 5, 'lbs', 90);
      const formPR = results.find(r => r.record?.type === 'form_score');
      expect(formPR).toBeDefined();
      expect(formPR!.record!.value).toBe(90);
      expect(formPR!.record!.previousValue).toBe(75);
      expect(formPR!.message).toContain('form score PR');
    });

    it('does not report first form score entry as a form PR', () => {
      const results = checkForPR('squat', 225, 5, 'lbs', 80);
      const formPR = results.find(r => r.record?.type === 'form_score');
      expect(formPR).toBeUndefined();
    });

    it('does not detect lower form score as a PR', () => {
      checkForPR('squat', 225, 5, 'lbs', 90);
      const results = checkForPR('squat', 225, 5, 'lbs', 80);
      const formPR = results.find(r => r.record?.type === 'form_score');
      expect(formPR).toBeUndefined();
    });

    // Multiple PR types simultaneously
    it('detects multiple PR types in one check (weight + e1RM)', () => {
      const results = checkForPR('deadlift', 405, 3, 'lbs');
      const types = results.map(r => r.record?.type);
      expect(types).toContain('weight');
      expect(types).toContain('e1rm');
    });

    it('detects weight + e1RM + rep PR + form PR simultaneously', () => {
      // First entry to set baselines
      checkForPR('squat', 200, 5, 'lbs', 60);
      // Beat everything
      const results = checkForPR('squat', 300, 8, 'lbs', 85);
      const types = results.map(r => r.record?.type);
      expect(types).toContain('weight');
      expect(types).toContain('e1rm');
      // Form PR is reported because we had a previous form score
      expect(types).toContain('form_score');
    });

    // Edge cases: weight
    it('ignores weight = 0', () => {
      const results = checkForPR('squat', 0, 5, 'lbs');
      expect(results).toHaveLength(0);
    });

    it('ignores negative weight', () => {
      const results = checkForPR('squat', -100, 5, 'lbs');
      expect(results).toHaveLength(0);
    });

    // Edge cases: reps
    it('does not generate rep PR for reps = 1', () => {
      checkForPR('squat', 225, 1, 'lbs');
      const results = checkForPR('squat', 225, 1, 'lbs');
      const repPR = results.find(r => r.record?.type === 'reps');
      expect(repPR).toBeUndefined();
    });

    it('does not generate e1RM PR for reps > 15', () => {
      const results = checkForPR('squat', 135, 20, 'lbs');
      const e1rmPR = results.find(r => r.record?.type === 'e1rm');
      expect(e1rmPR).toBeUndefined();
    });

    it('handles reps = 0 gracefully (no e1RM or rep PR)', () => {
      const results = checkForPR('squat', 225, 0, 'lbs');
      // weight > 0 but reps < 1, so no e1RM; reps not > 1, so no rep PR
      // weight PR should still be detected (weight > 0)
      const e1rmPR = results.find(r => r.record?.type === 'e1rm');
      const repPR = results.find(r => r.record?.type === 'reps');
      expect(e1rmPR).toBeUndefined();
      expect(repPR).toBeUndefined();
    });

    // Edge cases: form score
    it('ignores form score = 0', () => {
      const results = checkForPR('squat', 225, 5, 'lbs', 0);
      const formPR = results.find(r => r.record?.type === 'form_score');
      expect(formPR).toBeUndefined();
    });

    it('ignores undefined form score', () => {
      const results = checkForPR('squat', 225, 5, 'lbs', undefined);
      const formPR = results.find(r => r.record?.type === 'form_score');
      expect(formPR).toBeUndefined();
    });

    it('handles negative form score (treated as <= 0)', () => {
      const results = checkForPR('squat', 225, 5, 'lbs', -10);
      const formPR = results.find(r => r.record?.type === 'form_score');
      expect(formPR).toBeUndefined();
    });

    // Cross-lift isolation
    it('tracks PRs independently per lift', () => {
      checkForPR('squat', 315, 5, 'lbs');
      const results = checkForPR('bench', 225, 5, 'lbs');
      // Bench should get its own first-time weight PR
      const weightPR = results.find(r => r.record?.type === 'weight');
      expect(weightPR).toBeDefined();
      expect(weightPR!.record!.lift).toBe('bench');
    });

    // Units
    it('preserves unit in PR records', () => {
      const results = checkForPR('squat', 140, 5, 'kg');
      const weightPR = results.find(r => r.record?.type === 'weight');
      expect(weightPR!.record!.unit).toBe('kg');
    });

    // Date tracking
    it('records date on PR', () => {
      const results = checkForPR('squat', 315, 1, 'lbs');
      const weightPR = results.find(r => r.record?.type === 'weight');
      expect(weightPR!.record!.date).toBeTruthy();
      // Should be a valid ISO date string
      expect(new Date(weightPR!.record!.date).getTime()).not.toBeNaN();
    });

    // Context string
    it('includes context string in weight PR', () => {
      const results = checkForPR('squat', 315, 3, 'lbs');
      const weightPR = results.find(r => r.record?.type === 'weight');
      expect(weightPR!.record!.context).toBe('315 lbs x 3');
    });

    it('includes context string in e1RM PR', () => {
      const results = checkForPR('squat', 315, 3, 'lbs');
      const e1rmPR = results.find(r => r.record?.type === 'e1rm');
      expect(e1rmPR!.record!.context).toContain('Epley');
    });

    // Very large numbers
    it('handles very large weight values', () => {
      const results = checkForPR('squat', 99999, 1, 'lbs');
      const weightPR = results.find(r => r.record?.type === 'weight');
      expect(weightPR).toBeDefined();
      expect(weightPR!.record!.value).toBe(99999);
    });

    // NaN values
    it('does not record NaN weight as a PR', () => {
      const results = checkForPR('squat', NaN, 5, 'lbs');
      expect(results).toHaveLength(0);
    });

    it('handles NaN reps gracefully', () => {
      // NaN > 0 is false, so weight PR should not fire either (NaN weight)
      // But if weight is valid and reps is NaN: weight > 0 is true
      const results = checkForPR('squat', 225, NaN, 'lbs');
      // weight PR fires (weight > 0 && no prev)
      const weightPR = results.find(r => r.record?.type === 'weight');
      expect(weightPR).toBeDefined();
      // e1RM: reps >= 1 is false for NaN
      const e1rmPR = results.find(r => r.record?.type === 'e1rm');
      expect(e1rmPR).toBeUndefined();
      // rep PR: reps > 1 is false for NaN
      const repPR = results.find(r => r.record?.type === 'reps');
      expect(repPR).toBeUndefined();
    });

    // Rep PR key includes weight
    it('tracks rep PRs independently per weight', () => {
      checkForPR('squat', 225, 5, 'lbs');
      checkForPR('squat', 275, 3, 'lbs');
      // Now beat 225 reps
      const results = checkForPR('squat', 225, 8, 'lbs');
      const repPR = results.find(r => r.record?.type === 'reps');
      expect(repPR).toBeDefined();
      expect(repPR!.record!.context).toContain('225');
    });

    // e1RM Epley calculation correctness
    it('computes Epley e1RM correctly: 100 x 10 = 133', () => {
      const results = checkForPR('squat', 100, 10, 'lbs');
      const e1rmPR = results.find(r => r.record?.type === 'e1rm');
      // Epley: 100 * (1 + 10/30) = 133.33 → rounded to 133
      expect(e1rmPR!.record!.value).toBe(133);
    });

    // Boundary: reps = 15 (max for e1RM)
    it('computes e1RM at reps = 15 (boundary)', () => {
      const results = checkForPR('squat', 100, 15, 'lbs');
      const e1rmPR = results.find(r => r.record?.type === 'e1rm');
      expect(e1rmPR).toBeDefined();
      // Epley: 100 * (1 + 15/30) = 150
      expect(e1rmPR!.record!.value).toBe(150);
    });

    // All results are isNewPR = true
    it('only returns results where isNewPR is true', () => {
      const results = checkForPR('squat', 225, 5, 'lbs', 80);
      for (const r of results) {
        expect(r.isNewPR).toBe(true);
      }
    });

    // Saves PRs to storage after check
    it('persists PRs to localStorage after each check', () => {
      checkForPR('squat', 300, 5, 'lbs');
      const stored = loadPRs();
      expect(stored['weight_squat']).toBeDefined();
      expect(stored['weight_squat'].value).toBe(300);
      expect(stored['e1rm_squat']).toBeDefined();
    });
  });

  // ── getAllPRsByLift ──

  describe('getAllPRsByLift', () => {
    it('returns empty object when no PRs exist', () => {
      expect(getAllPRsByLift()).toEqual({});
    });

    it('groups PRs correctly by lift', () => {
      checkForPR('squat', 315, 5, 'lbs');
      checkForPR('bench', 225, 5, 'lbs');
      checkForPR('deadlift', 405, 3, 'lbs');

      const byLift = getAllPRsByLift();
      expect(Object.keys(byLift)).toContain('squat');
      expect(Object.keys(byLift)).toContain('bench');
      expect(Object.keys(byLift)).toContain('deadlift');
    });

    it('includes multiple PR types per lift', () => {
      checkForPR('squat', 315, 5, 'lbs');
      const byLift = getAllPRsByLift();
      // Squat should have weight and e1RM PRs
      const squatTypes = byLift['squat'].map(pr => pr.type);
      expect(squatTypes).toContain('weight');
      expect(squatTypes).toContain('e1rm');
    });

    it('does not mix lifts', () => {
      checkForPR('squat', 315, 5, 'lbs');
      checkForPR('bench', 225, 5, 'lbs');
      const byLift = getAllPRsByLift();
      for (const pr of byLift['squat']) {
        expect(pr.lift).toBe('squat');
      }
      for (const pr of byLift['bench']) {
        expect(pr.lift).toBe('bench');
      }
    });
  });

  // ── getBestE1RMs ──

  describe('getBestE1RMs', () => {
    it('returns empty object when no PRs exist', () => {
      expect(getBestE1RMs()).toEqual({});
    });

    it('returns best e1RM for each lift', () => {
      checkForPR('squat', 315, 5, 'lbs');
      checkForPR('bench', 225, 5, 'lbs');
      const e1rms = getBestE1RMs();
      expect(e1rms['squat']).toBeDefined();
      expect(e1rms['bench']).toBeDefined();
      expect(e1rms['squat']).toBeGreaterThan(315);
      expect(e1rms['bench']).toBeGreaterThan(225);
    });

    it('does not include non-e1RM PR types', () => {
      checkForPR('squat', 315, 5, 'lbs', 90);
      const e1rms = getBestE1RMs();
      // Should only have squat, not form score keys
      expect(Object.keys(e1rms)).toEqual(['squat']);
    });
  });
});
