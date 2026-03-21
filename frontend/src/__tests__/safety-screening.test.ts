import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  savePARQResult,
  loadPARQResult,
  isPARQComplete,
  isPARQExpired,
  savePreExistingConditions,
  loadPreExistingConditions,
  getExerciseModifications,
  shouldShowPainPrompt,
  incrementPainSetCounter,
  savePainReport,
  getPainHistory,
  checkPainRedFlags,
  isPregnancyMode,
  getPregnancyGuidelines,
  handlePARQSubmit,
  PARQ_QUESTIONS,
  CONDITIONS_DATABASE,
} from '../safety-screening';
import type { PARQResult, PainReport } from '../safety-screening';

// ─── localStorage mock ───

let store: Record<string, string> = {};

function createLocalStorageMock(): Storage {
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

beforeEach(() => {
  store = {};
  vi.stubGlobal('localStorage', createLocalStorageMock());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Helpers ───

function makePARQResult(overrides: Partial<PARQResult> = {}): PARQResult {
  return {
    completed: true,
    completedDate: new Date().toISOString(),
    passed: true,
    responses: {},
    referralRecommended: false,
    referralReasons: [],
    restrictions: [],
    acknowledgedRisks: false,
    ...overrides,
  };
}

function makePainReport(overrides: Partial<PainReport> = {}): PainReport {
  return {
    timestamp: new Date().toISOString(),
    exercise: 'squat',
    location: 'Lower Back',
    type: 'dull',
    intensity: 3,
    onset: 'during_set',
    ...overrides,
  };
}

// ─── PAR-Q Storage ───

describe('PAR-Q storage', () => {
  it('savePARQResult/loadPARQResult round-trip', () => {
    const result = makePARQResult({ passed: false, referralRecommended: true });
    savePARQResult(result);
    const loaded = loadPARQResult();
    expect(loaded).toEqual(result);
  });

  it('loadPARQResult returns null when nothing stored', () => {
    expect(loadPARQResult()).toBeNull();
  });

  it('isPARQComplete returns true when completed', () => {
    savePARQResult(makePARQResult({ completed: true }));
    expect(isPARQComplete()).toBe(true);
  });

  it('isPARQComplete returns false when not completed', () => {
    savePARQResult(makePARQResult({ completed: false }));
    expect(isPARQComplete()).toBe(false);
  });

  it('isPARQComplete returns false when nothing stored', () => {
    expect(isPARQComplete()).toBe(false);
  });

  it('isPARQExpired returns true when no result stored', () => {
    expect(isPARQExpired()).toBe(true);
  });

  it('isPARQExpired returns false for recent completion', () => {
    savePARQResult(makePARQResult({ completedDate: new Date().toISOString() }));
    expect(isPARQExpired()).toBe(false);
  });

  it('isPARQExpired returns true when completed > 12 months ago', () => {
    const oldDate = new Date();
    oldDate.setMonth(oldDate.getMonth() - 13);
    savePARQResult(makePARQResult({ completedDate: oldDate.toISOString() }));
    expect(isPARQExpired()).toBe(true);
  });

  it('isPARQExpired returns true when completedDate is missing', () => {
    savePARQResult(makePARQResult({ completedDate: '' }));
    expect(isPARQExpired()).toBe(true);
  });
});

// ─── Pre-Existing Conditions ───

describe('Pre-existing conditions', () => {
  it('savePreExistingConditions/loadPreExistingConditions round-trip', () => {
    const conditions = ['disc_herniation', 'hypertension'];
    savePreExistingConditions(conditions);
    expect(loadPreExistingConditions()).toEqual(conditions);
  });

  it('loadPreExistingConditions returns empty array when nothing stored', () => {
    expect(loadPreExistingConditions()).toEqual([]);
  });

  it('getExerciseModifications returns correct modifications for disc_herniation + squat', () => {
    const mods = getExerciseModifications('squat', ['disc_herniation']);
    expect(mods.length).toBeGreaterThan(0);
    expect(mods[0].exercise).toBe('squat');
    expect(mods[0].contraindicated).toBe(false);
  });

  it('getExerciseModifications returns correct modifications for shoulder_impingement + bench_press', () => {
    const mods = getExerciseModifications('bench_press', ['shoulder_impingement']);
    expect(mods.length).toBeGreaterThan(0);
    expect(mods[0].exercise).toBe('bench_press');
  });

  it('getExerciseModifications returns modifications from multiple conditions', () => {
    const mods = getExerciseModifications('squat', ['disc_herniation', 'knee_replacement']);
    // Both conditions have squat modifications
    expect(mods.length).toBe(2);
  });

  it('getExerciseModifications returns empty for unknown condition', () => {
    const mods = getExerciseModifications('squat', ['nonexistent_condition']);
    expect(mods).toEqual([]);
  });

  it('getExerciseModifications returns empty for unknown exercise', () => {
    const mods = getExerciseModifications('unknown_exercise', ['disc_herniation']);
    expect(mods).toEqual([]);
  });

  it('getExerciseModifications marks barbell_row as contraindicated for disc_herniation', () => {
    const mods = getExerciseModifications('barbell_row', ['disc_herniation']);
    expect(mods.length).toBeGreaterThan(0);
    const contraindicated = mods.find((m) => m.contraindicated);
    expect(contraindicated).toBeDefined();
    expect(contraindicated!.substitute).toBeDefined();
  });
});

// ─── Pain Prompt ───

describe('Pain prompt', () => {
  it('shouldShowPainPrompt shows every 3 sets with no recent pain', () => {
    // Counter starts at 0. shouldShowPainPrompt is pure (no side effects).
    // incrementPainSetCounter must be called separately to advance the counter.

    // counter=0, next=1, 1%3 !== 0 -> false
    expect(shouldShowPainPrompt('squat')).toBe(false);
    incrementPainSetCounter('squat');

    // counter=1, next=2, 2%3 !== 0 -> false
    expect(shouldShowPainPrompt('squat')).toBe(false);
    incrementPainSetCounter('squat');

    // counter=2, next=3, 3%3 === 0 -> true
    expect(shouldShowPainPrompt('squat')).toBe(true);
    incrementPainSetCounter('squat');

    // counter=3, next=4, 4%3 !== 0 -> false
    expect(shouldShowPainPrompt('squat')).toBe(false);
  });

  it('shouldShowPainPrompt shows every set when there is recent pain', () => {
    // Save a recent pain report
    savePainReport(makePainReport({
      timestamp: new Date().toISOString(),
      exercise: 'squat',
      type: 'dull',
      intensity: 3,
    }));

    // Should show on every call because recent pain exists
    expect(shouldShowPainPrompt('squat')).toBe(true);
    expect(shouldShowPainPrompt('squat')).toBe(true);
  });

  it('shouldShowPainPrompt does not count old pain as recent', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    savePainReport(makePainReport({
      timestamp: oldDate.toISOString(),
      exercise: 'squat',
      type: 'dull',
      intensity: 3,
    }));

    // Old pain should not trigger every-set mode
    expect(shouldShowPainPrompt('squat')).toBe(false);
  });

  it('savePainReport/getPainHistory round-trip', () => {
    const report = makePainReport({ exercise: 'deadlift', location: 'Lower Back' });
    savePainReport(report);
    const history = getPainHistory('deadlift');
    expect(history.length).toBe(1);
    expect(history[0].exercise).toBe('deadlift');
    expect(history[0].location).toBe('Lower Back');
  });

  it('getPainHistory filters by exercise', () => {
    savePainReport(makePainReport({ exercise: 'squat' }));
    savePainReport(makePainReport({ exercise: 'deadlift' }));
    savePainReport(makePainReport({ exercise: 'squat' }));

    expect(getPainHistory('squat').length).toBe(2);
    expect(getPainHistory('deadlift').length).toBe(1);
    expect(getPainHistory('bench_press').length).toBe(0);
  });
});

// ─── checkPainRedFlags ───

describe('checkPainRedFlags', () => {
  it('sharp pain >= 7 returns stop', () => {
    const result = checkPainRedFlags(makePainReport({ type: 'sharp', intensity: 7 }));
    expect(result.action).toBe('stop');
    expect(result.isRedFlag).toBe(true);
  });

  it('sharp pain = 6 does not trigger red flag (moderate range)', () => {
    const result = checkPainRedFlags(makePainReport({ type: 'sharp', intensity: 6 }));
    expect(result.action).toBe('modify');
    expect(result.isRedFlag).toBe(false);
  });

  it('burning pain >= 5 returns stop', () => {
    const result = checkPainRedFlags(makePainReport({ type: 'burning', intensity: 5 }));
    expect(result.action).toBe('stop');
    expect(result.isRedFlag).toBe(true);
  });

  it('burning pain = 4 returns modify (not stop)', () => {
    const result = checkPainRedFlags(makePainReport({ type: 'burning', intensity: 4 }));
    expect(result.action).toBe('modify');
    expect(result.isRedFlag).toBe(false);
  });

  it('moderate pain (4-7) returns modify', () => {
    const result = checkPainRedFlags(makePainReport({ type: 'dull', intensity: 5 }));
    expect(result.action).toBe('modify');
    expect(result.isRedFlag).toBe(false);
  });

  it('mild pain (1-3) returns continue', () => {
    const result = checkPainRedFlags(makePainReport({ type: 'dull', intensity: 2 }));
    expect(result.action).toBe('continue');
    expect(result.isRedFlag).toBe(false);
  });

  it('no pain returns continue with empty message', () => {
    const result = checkPainRedFlags(makePainReport({ type: 'none', intensity: 0 }));
    expect(result.action).toBe('continue');
    expect(result.isRedFlag).toBe(false);
    expect(result.message).toBe('');
  });

  it('any pain type at intensity >= 8 returns stop', () => {
    const result = checkPainRedFlags(makePainReport({ type: 'pressure', intensity: 8 }));
    expect(result.action).toBe('stop');
    expect(result.isRedFlag).toBe(true);
  });
});

// ─── Pregnancy ───

describe('Pregnancy', () => {
  it('isPregnancyMode returns false when no conditions saved', () => {
    expect(isPregnancyMode()).toBe(false);
  });

  it('isPregnancyMode returns true when pregnancy is in conditions', () => {
    savePreExistingConditions(['pregnancy']);
    expect(isPregnancyMode()).toBe(true);
  });

  it('isPregnancyMode returns true when pregnancy is among other conditions', () => {
    savePreExistingConditions(['disc_herniation', 'pregnancy', 'hypertension']);
    expect(isPregnancyMode()).toBe(true);
  });

  it('getPregnancyGuidelines returns non-empty array', () => {
    const guidelines = getPregnancyGuidelines();
    expect(Array.isArray(guidelines)).toBe(true);
    expect(guidelines.length).toBeGreaterThan(0);
  });

  it('pregnancy-specific pain red flags: abdominal pain triggers immediate stop', () => {
    savePreExistingConditions(['pregnancy']);
    const result = checkPainRedFlags(makePainReport({
      type: 'dull',
      intensity: 2,
      location: 'Abdomen',
    }));
    expect(result.action).toBe('stop');
    expect(result.isRedFlag).toBe(true);
  });

  it('pregnancy-specific pain red flags: hip pain triggers immediate stop', () => {
    savePreExistingConditions(['pregnancy']);
    const result = checkPainRedFlags(makePainReport({
      type: 'dull',
      intensity: 2,
      location: 'Left Hip',
    }));
    expect(result.action).toBe('stop');
    expect(result.isRedFlag).toBe(true);
  });

  it('pregnancy-specific: pain > 5 triggers stop (lower threshold)', () => {
    savePreExistingConditions(['pregnancy']);
    const result = checkPainRedFlags(makePainReport({
      type: 'dull',
      intensity: 6,
      location: 'Lower Back',
    }));
    expect(result.action).toBe('stop');
    expect(result.isRedFlag).toBe(true);
  });

  it('pregnancy-specific: pain >= 3 triggers modify', () => {
    savePreExistingConditions(['pregnancy']);
    const result = checkPainRedFlags(makePainReport({
      type: 'dull',
      intensity: 3,
      location: 'Lower Back',
    }));
    expect(result.action).toBe('modify');
  });

  it('pregnancy-specific: intensity 2 in non-abdominal area returns continue', () => {
    savePreExistingConditions(['pregnancy']);
    const result = checkPainRedFlags(makePainReport({
      type: 'dull',
      intensity: 2,
      location: 'Lower Back',
    }));
    expect(result.action).toBe('continue');
  });
});

// ─── handlePARQSubmit ───

describe('handlePARQSubmit', () => {
  it('all "no" responses result in passed=true, no referral', () => {
    const formData = new FormData();
    for (const q of PARQ_QUESTIONS) {
      formData.set(`parq_${q.id}`, 'no');
    }
    const result = handlePARQSubmit(formData);
    expect(result.completed).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.referralRecommended).toBe(false);
    expect(result.referralReasons.length).toBe(0);
    expect(result.restrictions.length).toBe(0);
  });

  it('"yes" on immediate-urgency question triggers referral and passed=false', () => {
    const formData = new FormData();
    for (const q of PARQ_QUESTIONS) {
      formData.set(`parq_${q.id}`, q.id === 'heart_condition' ? 'yes' : 'no');
    }
    const result = handlePARQSubmit(formData);
    expect(result.passed).toBe(false);
    expect(result.referralRecommended).toBe(true);
    expect(result.referralReasons.length).toBeGreaterThan(0);
  });

  it('"yes" on recommended-urgency question triggers referral but passed=true', () => {
    const formData = new FormData();
    for (const q of PARQ_QUESTIONS) {
      formData.set(`parq_${q.id}`, q.id === 'bone_joint' ? 'yes' : 'no');
    }
    const result = handlePARQSubmit(formData);
    expect(result.passed).toBe(true);
    expect(result.referralRecommended).toBe(true);
  });

  it('"yes" on hypertension adds hypertension-specific restrictions', () => {
    const formData = new FormData();
    for (const q of PARQ_QUESTIONS) {
      formData.set(`parq_${q.id}`, q.id === 'hypertension' ? 'yes' : 'no');
    }
    const result = handlePARQSubmit(formData);
    expect(result.restrictions.some((r) => r.includes('Valsalva'))).toBe(true);
  });

  it('"yes" on disc_herniation adds disc-specific restrictions', () => {
    const formData = new FormData();
    for (const q of PARQ_QUESTIONS) {
      formData.set(`parq_${q.id}`, q.id === 'disc_herniation' ? 'yes' : 'no');
    }
    const result = handlePARQSubmit(formData);
    expect(result.restrictions.some((r) => r.includes('spinal flexion'))).toBe(true);
  });

  it('"yes" on pregnancy adds pregnancy-specific restrictions', () => {
    const formData = new FormData();
    for (const q of PARQ_QUESTIONS) {
      formData.set(`parq_${q.id}`, q.id === 'pregnancy' ? 'yes' : 'no');
    }
    const result = handlePARQSubmit(formData);
    expect(result.restrictions.some((r) => r.includes('supine'))).toBe(true);
    expect(result.restrictions.some((r) => r.includes('OB-GYN'))).toBe(true);
  });

  it('acknowledge checkbox is captured', () => {
    const formData = new FormData();
    for (const q of PARQ_QUESTIONS) {
      formData.set(`parq_${q.id}`, 'no');
    }
    formData.set('parq_acknowledge', 'yes');
    const result = handlePARQSubmit(formData);
    expect(result.acknowledgedRisks).toBe(true);
  });

  it('multiple "yes" responses accumulate reasons and restrictions', () => {
    const formData = new FormData();
    for (const q of PARQ_QUESTIONS) {
      formData.set(`parq_${q.id}`,
        ['heart_condition', 'hypertension', 'disc_herniation'].includes(q.id) ? 'yes' : 'no');
    }
    const result = handlePARQSubmit(formData);
    expect(result.referralReasons.length).toBeGreaterThanOrEqual(3);
    expect(result.restrictions.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── Edge cases ───

describe('Edge cases', () => {
  it('loadPARQResult handles corrupted JSON gracefully', () => {
    store['squat_form_parq'] = 'not valid json{{{';
    expect(loadPARQResult()).toBeNull();
  });

  it('loadPreExistingConditions handles corrupted JSON gracefully', () => {
    store['squat_form_conditions'] = '!invalid!';
    expect(loadPreExistingConditions()).toEqual([]);
  });

  it('getPainHistory handles corrupted pain history gracefully', () => {
    store['squat_form_pain_history'] = 'corrupted';
    expect(getPainHistory('squat')).toEqual([]);
  });

  it('savePARQResult handles storage full gracefully', () => {
    // Stub document.dispatchEvent since we are not in a browser env
    const mockDispatch = vi.fn();
    vi.stubGlobal('document', { dispatchEvent: mockDispatch });
    // Replace localStorage with one that throws on setItem
    vi.stubGlobal('localStorage', {
      ...createLocalStorageMock(),
      setItem: () => { throw new DOMException('QuotaExceededError'); },
    });
    // Should not throw
    expect(() => savePARQResult(makePARQResult())).not.toThrow();
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'storage-warning',
      }),
    );
  });

  it('savePreExistingConditions handles storage full gracefully', () => {
    const mockDispatch = vi.fn();
    vi.stubGlobal('document', { dispatchEvent: mockDispatch });
    vi.stubGlobal('localStorage', {
      ...createLocalStorageMock(),
      setItem: () => { throw new DOMException('QuotaExceededError'); },
    });
    expect(() => savePreExistingConditions(['disc_herniation'])).not.toThrow();
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('savePainReport handles storage full gracefully', () => {
    const mockDispatch = vi.fn();
    vi.stubGlobal('document', { dispatchEvent: mockDispatch });
    vi.stubGlobal('localStorage', {
      ...createLocalStorageMock(),
      setItem: () => { throw new DOMException('QuotaExceededError'); },
    });
    expect(() => savePainReport(makePainReport())).not.toThrow();
  });

  it('empty localStorage returns sensible defaults for all load functions', () => {
    expect(loadPARQResult()).toBeNull();
    expect(loadPreExistingConditions()).toEqual([]);
    expect(getPainHistory('squat')).toEqual([]);
    expect(isPARQComplete()).toBe(false);
    expect(isPARQExpired()).toBe(true);
    expect(isPregnancyMode()).toBe(false);
  });

  it('CONDITIONS_DATABASE has entries for all major condition categories', () => {
    const categories = new Set(CONDITIONS_DATABASE.map((c) => c.category));
    expect(categories.has('joint')).toBe(true);
    expect(categories.has('spine')).toBe(true);
    expect(categories.has('shoulder')).toBe(true);
    expect(categories.has('cardiovascular')).toBe(true);
  });

  it('PARQ_QUESTIONS has questions in all categories', () => {
    const categories = new Set(PARQ_QUESTIONS.map((q) => q.category));
    expect(categories.has('cardiovascular')).toBe(true);
    expect(categories.has('musculoskeletal')).toBe(true);
    expect(categories.has('general')).toBe(true);
  });
});
