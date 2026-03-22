/**
 * Tests for settings.ts — settings persistence, weight unit management,
 * exercise type retrieval, and experience level gating.
 *
 * settings.ts captures DOM references at module load time via document.getElementById,
 * so we set up a minimal DOM polyfill on globalThis before importing. We use
 * vi.resetModules() to re-evaluate the module against fresh DOM state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── localStorage mock ──

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true, configurable: true });

// ── Minimal DOM Polyfill ──

class MockClassList {
  private classes = new Set<string>();
  add(...names: string[]) { names.forEach(n => this.classes.add(n)); }
  remove(...names: string[]) { names.forEach(n => this.classes.delete(n)); }
  toggle(name: string, force?: boolean) {
    if (force === undefined) {
      if (this.classes.has(name)) this.classes.delete(name);
      else this.classes.add(name);
    } else if (force) {
      this.classes.add(name);
    } else {
      this.classes.delete(name);
    }
  }
  contains(name: string) { return this.classes.has(name); }
}

interface MockElementConfig {
  tag?: string;
  id?: string;
  value?: string;
  classes?: string[];
  dataset?: Record<string, string>;
  style?: Record<string, string>;
  children?: MockElement[];
  type?: string;
  checked?: boolean;
  textContent?: string;
  attributes?: Record<string, string>;
}

class MockElement {
  tag: string;
  id: string;
  value: string = '';
  classList: MockClassList;
  dataset: Record<string, string>;
  style: Record<string, string>;
  children: MockElement[];
  type: string = '';
  checked: boolean = false;
  textContent: string = '';
  private _attributes: Record<string, string>;
  private _listeners: Record<string, Function[]> = {};

  constructor(config: MockElementConfig = {}) {
    this.tag = config.tag ?? 'div';
    this.id = config.id ?? '';
    this.value = config.value ?? '';
    this.classList = new MockClassList();
    (config.classes ?? []).forEach(c => this.classList.add(c));
    this.dataset = config.dataset ?? {};
    this.style = { display: '', ...config.style };
    this.children = config.children ?? [];
    this.type = config.type ?? '';
    this.checked = config.checked ?? false;
    this.textContent = config.textContent ?? '';
    this._attributes = config.attributes ?? {};
  }

  getAttribute(name: string): string | null { return this._attributes[name] ?? null; }
  setAttribute(name: string, value: string) { this._attributes[name] = value; }
  removeAttribute(name: string) { delete this._attributes[name]; }
  hasAttribute(name: string) { return name in this._attributes; }
  addEventListener(event: string, fn: Function) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }
  dispatchEvent(event: any) {
    const type = event.type ?? event;
    (this._listeners[type] ?? []).forEach(fn => fn(event));
  }
  focus() {}
  click() {
    (this._listeners['click'] ?? []).forEach(fn => fn(new (globalThis as any).Event('click')));
  }
  querySelector(selector: string): MockElement | null {
    return findInTree(this.children, selector);
  }
  querySelectorAll(selector: string): MockElement[] {
    return findAllInTree(this.children, selector);
  }
}

function matchesSelector(el: MockElement, selector: string): boolean {
  // Very basic selector matching for our test DOM
  if (selector.startsWith('#')) {
    const rest = selector.slice(1);
    // #id .class or #id input[type=...] compound
    const spaceIdx = rest.indexOf(' ');
    if (spaceIdx >= 0) {
      // Descendant selector - just check children
      const parentId = rest.slice(0, spaceIdx);
      // Not needed for our test cases
      return false;
    }
    return el.id === rest;
  }

  // Split selector into parts: classes and attribute selectors
  // e.g., ".weight-unit-btn.active" -> [".weight-unit-btn", ".active"]
  // e.g., ".weight-unit-btn[data-unit=\"lbs\"]" -> [".weight-unit-btn", "[data-unit=\"lbs\"]"]
  const classMatches = selector.match(/\.[\w-]+/g) ?? [];
  const attrMatches = selector.match(/\[([^\]]+)\]/g) ?? [];
  const tagMatch = selector.match(/^(\w+)/);

  // If we have class selectors
  if (classMatches.length > 0) {
    for (const cls of classMatches) {
      if (!el.classList.contains(cls.slice(1))) return false;
    }
    // Check attribute selectors
    for (const attr of attrMatches) {
      const match = attr.match(/\[data-(\w+)="?([^"\]]*)"?\]/);
      if (match && el.dataset[match[1]] !== match[2]) return false;
      const typeMatch = attr.match(/\[type="?(\w+)"?\]/);
      if (typeMatch && el.type !== typeMatch[1]) return false;
    }
    // Check tag if present
    if (tagMatch && !selector.startsWith('.')) {
      if (el.tag !== tagMatch[1]) return false;
    }
    return true;
  }

  // Tag + attribute selectors (e.g., input[type="checkbox"])
  if (tagMatch) {
    if (el.tag !== tagMatch[1]) return false;
    for (const attr of attrMatches) {
      const match = attr.match(/\[type="?(\w+)"?\]/);
      if (match && el.type !== match[1]) return false;
      const dataMatch = attr.match(/\[data-(\w+)="?([^"\]]*)"?\]/);
      if (dataMatch && el.dataset[dataMatch[1]] !== dataMatch[2]) return false;
    }
    return attrMatches.length > 0; // Only match if there was some attribute constraint
  }

  return false;
}

function findInTree(elements: MockElement[], selector: string): MockElement | null {
  for (const el of elements) {
    if (matchesSelector(el, selector)) return el;
    const found = findInTree(el.children, selector);
    if (found) return found;
  }
  return null;
}

function findAllInTree(elements: MockElement[], selector: string): MockElement[] {
  const results: MockElement[] = [];
  for (const el of elements) {
    if (matchesSelector(el, selector)) results.push(el);
    results.push(...findAllInTree(el.children, selector));
  }
  return results;
}

function buildDOM(): { elements: Map<string, MockElement>; allElements: MockElement[] } {
  const elements = new Map<string, MockElement>();
  const allElements: MockElement[] = [];

  function reg(el: MockElement): MockElement {
    if (el.id) elements.set(el.id, el);
    allElements.push(el);
    return el;
  }

  // Create all the elements settings.ts needs
  reg(new MockElement({ tag: 'select', id: 'exercise-type', value: 'squat' }));
  reg(new MockElement({ tag: 'select', id: 'squat-type', value: 'high_bar' }));
  reg(new MockElement({ tag: 'select', id: 'deadlift-type', value: 'conventional' }));
  reg(new MockElement({ tag: 'select', id: 'bench-type', value: 'flat' }));
  reg(new MockElement({ tag: 'select', id: 'ohp-type', value: 'strict' }));
  reg(new MockElement({ tag: 'select', id: 'row-type', value: 'bent_over' }));
  reg(new MockElement({ tag: 'select', id: 'lunge-type', value: 'forward' }));
  reg(new MockElement({ tag: 'select', id: 'experience-level', value: 'intermediate' }));
  reg(new MockElement({ tag: 'input', id: 'weight-input', value: '' }));
  reg(new MockElement({ tag: 'input', id: 'live-weight-input', value: '' }));
  reg(new MockElement({ tag: 'input', id: 'bodyweight-input', value: '' }));
  reg(new MockElement({ tag: 'select', id: 'bodyweight-unit', value: 'lbs' }));
  reg(new MockElement({ tag: 'select', id: 'rpe-input', value: '' }));
  reg(new MockElement({ tag: 'select', id: 'training-phase', value: '' }));

  // Weight unit buttons
  reg(new MockElement({ tag: 'button', classes: ['weight-unit-btn', 'active'], dataset: { unit: 'lbs' } }));
  reg(new MockElement({ tag: 'button', classes: ['weight-unit-btn'], dataset: { unit: 'kg' } }));
  reg(new MockElement({ tag: 'button', classes: ['live-weight-unit-btn', 'active'], dataset: { unit: 'lbs' } }));
  reg(new MockElement({ tag: 'button', classes: ['live-weight-unit-btn'], dataset: { unit: 'kg' } }));

  // Variant groups
  reg(new MockElement({ id: 'squat-type-group' }));
  reg(new MockElement({ id: 'deadlift-type-group' }));
  reg(new MockElement({ id: 'bench-type-group' }));
  reg(new MockElement({ id: 'ohp-type-group' }));
  reg(new MockElement({ id: 'row-type-group' }));
  reg(new MockElement({ id: 'lunge-type-group' }));

  // Advanced settings
  reg(new MockElement({ classes: ['advanced-setting'] }));
  const checkbox = reg(new MockElement({ tag: 'input', type: 'checkbox', checked: false }));
  reg(new MockElement({ id: 'competition-toggle-container', children: [checkbox] }));
  reg(new MockElement({ id: 'more-settings', tag: 'details' }));
  reg(new MockElement({ id: 'experience-hint' }));

  // Exercise tabs
  const tab1 = reg(new MockElement({ tag: 'button', classes: ['exercise-tab', 'active'], dataset: { exercise: 'squat' }, attributes: { tabindex: '0', 'aria-checked': 'true' } }));
  const tab2 = reg(new MockElement({ tag: 'button', classes: ['exercise-tab'], dataset: { exercise: 'deadlift' }, attributes: { tabindex: '-1', 'aria-checked': 'false' } }));
  const tab3 = reg(new MockElement({ tag: 'button', classes: ['exercise-tab'], dataset: { exercise: 'bench_press' }, attributes: { tabindex: '-1', 'aria-checked': 'false' } }));
  reg(new MockElement({ classes: ['exercise-toggle'], children: [tab1, tab2, tab3] }));

  // Sex toggle
  reg(new MockElement({ tag: 'button', classes: ['sex-toggle-btn', 'active'], attributes: { 'aria-checked': 'true' } }));
  reg(new MockElement({ tag: 'button', classes: ['sex-toggle-btn'], attributes: { 'aria-checked': 'false' } }));

  return { elements, allElements };
}

function installDOM(): { elements: Map<string, MockElement>; allElements: MockElement[] } {
  const { elements, allElements } = buildDOM();

  const mockDocument = {
    getElementById: (id: string) => elements.get(id) ?? null,
    querySelector: (selector: string) => {
      if (selector.startsWith('#')) return elements.get(selector.slice(1)) ?? null;
      return findInTree(allElements, selector);
    },
    querySelectorAll: (selector: string) => {
      return findAllInTree(allElements, selector);
    },
    dispatchEvent: vi.fn(),
  };

  (globalThis as any).document = mockDocument;
  (globalThis as any).Event = class { type: string; bubbles: boolean; constructor(type: string, opts?: any) { this.type = type; this.bubbles = opts?.bubbles ?? false; } };
  (globalThis as any).CustomEvent = class extends (globalThis as any).Event { detail: any; constructor(type: string, opts?: any) { super(type, opts); this.detail = opts?.detail; } };

  return { elements, allElements };
}

// ── Module loader ──

let settingsModule: typeof import('../settings');

async function loadSettingsModule() {
  vi.resetModules();
  settingsModule = await import('../settings');
}

// ── Tests ──

describe('settings.ts', () => {
  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
  });

  // ── getWeightUnit ──

  describe('getWeightUnit', () => {
    it('returns "lbs" when lbs button is active', async () => {
      installDOM();
      await loadSettingsModule();
      expect(settingsModule.getWeightUnit()).toBe('lbs');
    });

    it('returns "kg" when kg button is active', async () => {
      const { allElements } = installDOM();
      allElements
        .filter(e => e.classList.contains('weight-unit-btn'))
        .forEach(btn => btn.classList.toggle('active', btn.dataset.unit === 'kg'));
      await loadSettingsModule();
      expect(settingsModule.getWeightUnit()).toBe('kg');
    });

    it('returns "lbs" as default when no button is active', async () => {
      const { allElements } = installDOM();
      allElements
        .filter(e => e.classList.contains('weight-unit-btn'))
        .forEach(btn => btn.classList.remove('active'));
      await loadSettingsModule();
      expect(settingsModule.getWeightUnit()).toBe('lbs');
    });
  });

  // ── setWeightUnit ──

  describe('setWeightUnit', () => {
    it('activates the kg button in both panels', async () => {
      const { allElements } = installDOM();
      await loadSettingsModule();
      settingsModule.setWeightUnit('kg');
      for (const btn of allElements.filter(e => e.classList.contains('weight-unit-btn'))) {
        if (btn.dataset.unit === 'kg') expect(btn.classList.contains('active')).toBe(true);
        else expect(btn.classList.contains('active')).toBe(false);
      }
      for (const btn of allElements.filter(e => e.classList.contains('live-weight-unit-btn'))) {
        if (btn.dataset.unit === 'kg') expect(btn.classList.contains('active')).toBe(true);
        else expect(btn.classList.contains('active')).toBe(false);
      }
    });

    it('switches back to lbs', async () => {
      installDOM();
      await loadSettingsModule();
      settingsModule.setWeightUnit('kg');
      settingsModule.setWeightUnit('lbs');
      expect(settingsModule.getWeightUnit()).toBe('lbs');
    });
  });

  // ── getExerciseType ──

  describe('getExerciseType', () => {
    it('returns "squat" by default', async () => {
      installDOM();
      await loadSettingsModule();
      expect(settingsModule.getExerciseType()).toBe('squat');
    });

    it('returns the selected exercise type from DOM', async () => {
      const { elements } = installDOM();
      elements.get('exercise-type')!.value = 'deadlift';
      await loadSettingsModule();
      expect(settingsModule.getExerciseType()).toBe('deadlift');
    });
  });

  // ── updateExerciseVariantVisibility ──

  describe('updateExerciseVariantVisibility', () => {
    it('shows squat type group when exercise is squat', async () => {
      const { elements } = installDOM();
      await loadSettingsModule();
      settingsModule.updateExerciseVariantVisibility();
      expect(elements.get('squat-type-group')!.classList.contains('visible')).toBe(true);
    });

    it('hides squat type group when exercise is deadlift', async () => {
      const { elements } = installDOM();
      elements.get('exercise-type')!.value = 'deadlift';
      await loadSettingsModule();
      settingsModule.updateExerciseVariantVisibility();
      expect(elements.get('squat-type-group')!.classList.contains('visible')).toBe(false);
      expect(elements.get('deadlift-type-group')!.classList.contains('visible')).toBe(true);
    });

    it('shows bench type group for bench_press', async () => {
      const { elements } = installDOM();
      elements.get('exercise-type')!.value = 'bench_press';
      await loadSettingsModule();
      settingsModule.updateExerciseVariantVisibility();
      expect(elements.get('bench-type-group')!.classList.contains('visible')).toBe(true);
    });

    it('shows ohp type group for overhead_press', async () => {
      const { elements } = installDOM();
      elements.get('exercise-type')!.value = 'overhead_press';
      await loadSettingsModule();
      settingsModule.updateExerciseVariantVisibility();
      expect(elements.get('ohp-type-group')!.classList.contains('visible')).toBe(true);
    });

    it('shows row type group for barbell_row', async () => {
      const { elements } = installDOM();
      elements.get('exercise-type')!.value = 'barbell_row';
      await loadSettingsModule();
      settingsModule.updateExerciseVariantVisibility();
      expect(elements.get('row-type-group')!.classList.contains('visible')).toBe(true);
    });

    it('shows lunge type group for lunge', async () => {
      const { elements } = installDOM();
      elements.get('exercise-type')!.value = 'lunge';
      await loadSettingsModule();
      settingsModule.updateExerciseVariantVisibility();
      expect(elements.get('lunge-type-group')!.classList.contains('visible')).toBe(true);
    });
  });

  // ── updateAdvancedSettingsVisibility ──

  describe('updateAdvancedSettingsVisibility', () => {
    it('hides advanced settings for beginners', async () => {
      const { elements, allElements } = installDOM();
      elements.get('experience-level')!.value = 'beginner';
      await loadSettingsModule();
      settingsModule.updateAdvancedSettingsVisibility();
      const advSetting = allElements.find(e => e.classList.contains('advanced-setting'))!;
      expect(advSetting.classList.contains('beginner-hidden')).toBe(true);
    });

    it('shows advanced settings for intermediate users', async () => {
      const { elements, allElements } = installDOM();
      elements.get('experience-level')!.value = 'intermediate';
      await loadSettingsModule();
      settingsModule.updateAdvancedSettingsVisibility();
      const advSetting = allElements.find(e => e.classList.contains('advanced-setting'))!;
      expect(advSetting.classList.contains('beginner-hidden')).toBe(false);
    });

    it('hides competition toggle for beginners', async () => {
      const { elements } = installDOM();
      elements.get('experience-level')!.value = 'beginner';
      await loadSettingsModule();
      settingsModule.updateAdvancedSettingsVisibility();
      expect(elements.get('competition-toggle-container')!.style.display).toBe('none');
    });

    it('shows competition toggle for advanced users', async () => {
      const { elements } = installDOM();
      elements.get('experience-level')!.value = 'advanced';
      await loadSettingsModule();
      settingsModule.updateAdvancedSettingsVisibility();
      expect(elements.get('competition-toggle-container')!.style.display).toBe('');
    });

    it('closes "more settings" details for beginners', async () => {
      const { elements } = installDOM();
      elements.get('more-settings')!.setAttribute('open', '');
      elements.get('experience-level')!.value = 'beginner';
      await loadSettingsModule();
      settingsModule.updateAdvancedSettingsVisibility();
      expect(elements.get('more-settings')!.hasAttribute('open')).toBe(false);
    });

    it('opens "more settings" details for non-beginners', async () => {
      const { elements } = installDOM();
      elements.get('experience-level')!.value = 'intermediate';
      await loadSettingsModule();
      settingsModule.updateAdvancedSettingsVisibility();
      expect(elements.get('more-settings')!.hasAttribute('open')).toBe(true);
    });
  });

  // ── initSettings ──

  describe('initSettings', () => {
    it('restores saved settings from localStorage', async () => {
      const { elements } = installDOM();
      const settings = {
        version: 1,
        data: {
          squat_type: 'low_bar',
          experience_level: 'advanced',
          weight: '225',
          weight_unit: 'lbs',
          exercise_type: 'deadlift',
          deadlift_type: 'sumo',
          bench_type: 'flat',
          ohp_type: 'strict',
          row_type: 'bent_over',
          lunge_type: 'forward',
          bodyweight: '200',
          bodyweight_unit: 'lbs',
          rpe: '8',
          training_phase: 'hypertrophy',
        },
      };
      localStorageMock.setItem('squat_form_settings', JSON.stringify(settings));
      await loadSettingsModule();
      settingsModule.initSettings();
      expect(elements.get('exercise-type')!.value).toBe('deadlift');
      expect(elements.get('squat-type')!.value).toBe('low_bar');
      expect(elements.get('experience-level')!.value).toBe('advanced');
      expect(elements.get('weight-input')!.value).toBe('225');
    });

    it('handles missing saved settings gracefully', async () => {
      installDOM();
      await loadSettingsModule();
      expect(() => settingsModule.initSettings()).not.toThrow();
    });

    it('sets up variant visibility on init', async () => {
      const { elements } = installDOM();
      await loadSettingsModule();
      settingsModule.initSettings();
      expect(elements.get('squat-type-group')!.classList.contains('visible')).toBe(true);
    });

    it('sets up experience hint on init', async () => {
      const { elements } = installDOM();
      await loadSettingsModule();
      settingsModule.initSettings();
      expect(elements.get('experience-hint')!.textContent).toBeTruthy();
    });

    it('returns void', async () => {
      installDOM();
      await loadSettingsModule();
      const result = settingsModule.initSettings();
      expect(result).toBeUndefined();
    });
  });

  // ── getSavedSettings ──

  describe('getSavedSettings', () => {
    it('returns null when no settings saved', async () => {
      installDOM();
      await loadSettingsModule();
      expect(settingsModule.getSavedSettings()).toBeNull();
    });

    it('returns saved settings object', async () => {
      installDOM();
      localStorageMock.setItem('squat_form_settings', JSON.stringify({
        version: 1,
        data: {
          squat_type: 'high_bar',
          experience_level: 'beginner',
          weight: '',
          weight_unit: 'lbs',
          exercise_type: 'squat',
          deadlift_type: 'conventional',
          bench_type: 'flat',
          ohp_type: 'strict',
          row_type: 'bent_over',
          lunge_type: 'forward',
          bodyweight: '',
          bodyweight_unit: 'lbs',
          rpe: '',
          training_phase: '',
        },
      }));
      await loadSettingsModule();
      const result = settingsModule.getSavedSettings();
      expect(result).not.toBeNull();
      expect(result!.squat_type).toBe('high_bar');
      expect(result!.experience_level).toBe('beginner');
    });

    it('returns null for corrupted settings', async () => {
      installDOM();
      localStorageMock.setItem('squat_form_settings', '{corrupt');
      await loadSettingsModule();
      expect(settingsModule.getSavedSettings()).toBeNull();
    });
  });

  // ── persistSettings ──

  describe('persistSettings', () => {
    it('saves current settings to localStorage', async () => {
      installDOM();
      await loadSettingsModule();
      settingsModule.persistSettings();
      const stored = localStorageMock.getItem('squat_form_settings');
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed.data.squat_type).toBe('high_bar');
    });

    it('captures current exercise type', async () => {
      const { elements } = installDOM();
      elements.get('exercise-type')!.value = 'deadlift';
      await loadSettingsModule();
      settingsModule.persistSettings();
      const stored = JSON.parse(localStorageMock.getItem('squat_form_settings')!);
      expect(stored.data.exercise_type).toBe('deadlift');
    });

    it('captures weight', async () => {
      const { elements } = installDOM();
      elements.get('weight-input')!.value = '315';
      await loadSettingsModule();
      settingsModule.persistSettings();
      const stored = JSON.parse(localStorageMock.getItem('squat_form_settings')!);
      expect(stored.data.weight).toBe('315');
    });

    it('captures weight unit', async () => {
      installDOM();
      await loadSettingsModule();
      settingsModule.setWeightUnit('kg');
      settingsModule.persistSettings();
      const stored = JSON.parse(localStorageMock.getItem('squat_form_settings')!);
      expect(stored.data.weight_unit).toBe('kg');
    });

    it('captures experience level', async () => {
      const { elements } = installDOM();
      elements.get('experience-level')!.value = 'advanced';
      await loadSettingsModule();
      settingsModule.persistSettings();
      const stored = JSON.parse(localStorageMock.getItem('squat_form_settings')!);
      expect(stored.data.experience_level).toBe('advanced');
    });
  });
});
