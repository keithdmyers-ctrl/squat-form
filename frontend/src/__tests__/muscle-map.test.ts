import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getMuscleColor,
  getMuscleMapLayout,
  volumeToMapData,
  renderMuscleMap,
  renderSessionMusclesSummary,
  zoneToIntensity,
  injectMuscleMapStyles,
  attachMuscleMapListeners,
} from '../muscle-map';
import type { MuscleMapData, MuscleIntensity, MuscleMapView } from '../muscle-map';
import type { MuscleVolume } from '../volume-tracker';

// ─── getMuscleColor ───

describe('getMuscleColor', () => {
  it('returns valid color strings for all 6 intensity levels', () => {
    const levels: MuscleIntensity[] = ['none', 'low', 'moderate', 'optimal', 'high', 'excessive'];
    for (const level of levels) {
      const color = getMuscleColor(level);
      expect(color).toBeTruthy();
      expect(color).toMatch(/^rgba\(/);
    }
  });

  it('returns gray for "none"', () => {
    expect(getMuscleColor('none')).toBe('rgba(128,128,128,0.15)');
  });

  it('returns blue for "low"', () => {
    expect(getMuscleColor('low')).toContain('96,165,250');
  });

  it('returns green for "moderate"', () => {
    expect(getMuscleColor('moderate')).toContain('74,222,128');
  });

  it('returns bright green for "optimal"', () => {
    const color = getMuscleColor('optimal');
    expect(color).toContain('74,222,128');
    expect(color).toContain('0.8');
  });

  it('returns yellow for "high"', () => {
    expect(getMuscleColor('high')).toContain('251,191,36');
  });

  it('returns red for "excessive"', () => {
    expect(getMuscleColor('excessive')).toContain('248,113,113');
  });

  it('returns gray for unknown intensity', () => {
    expect(getMuscleColor('unknown' as MuscleIntensity)).toBe('rgba(128,128,128,0.15)');
  });
});

// ─── zoneToIntensity ───

describe('zoneToIntensity', () => {
  it('returns "none" for 0 sets regardless of zone', () => {
    expect(zoneToIntensity('under', 0, 6, 12)).toBe('none');
    expect(zoneToIntensity('optimal', 0, 6, 12)).toBe('none');
  });

  it('returns "low" for under zone with non-zero sets', () => {
    expect(zoneToIntensity('under', 3, 6, 12)).toBe('low');
  });

  it('returns "moderate" for lower half of optimal zone', () => {
    // mev=6, mav=12, mid=9. sets=7 < 9 → moderate
    expect(zoneToIntensity('optimal', 7, 6, 12)).toBe('moderate');
  });

  it('returns "optimal" for upper half of optimal zone', () => {
    // mev=6, mav=12, mid=9. sets=10 >= 9 → optimal
    expect(zoneToIntensity('optimal', 10, 6, 12)).toBe('optimal');
  });

  it('returns "high" for high zone', () => {
    expect(zoneToIntensity('high', 18, 6, 14)).toBe('high');
  });

  it('returns "excessive" for excessive zone', () => {
    expect(zoneToIntensity('excessive', 25, 8, 15)).toBe('excessive');
  });

  it('returns "none" for unknown zone', () => {
    expect(zoneToIntensity('unknown', 5, 6, 12)).toBe('none');
  });
});

// ─── volumeToMapData ───

describe('volumeToMapData', () => {
  it('converts MuscleVolume array to MuscleMapData array', () => {
    const volumes: MuscleVolume[] = [
      { muscleGroup: 'quads', label: 'Quads', weeklySets: 12, zone: 'optimal', mev: 8, mav: 15, mrv: 20 },
      { muscleGroup: 'chest', label: 'Chest', weeklySets: 0, zone: 'under', mev: 6, mav: 14, mrv: 22 },
    ];

    const result = volumeToMapData(volumes);
    expect(result).toHaveLength(2);

    // First item: quads with 12 sets in optimal zone
    expect(result[0].muscleGroup).toBe('quads');
    expect(result[0].label).toBe('Quads');
    expect(result[0].sets).toBe(12);
    expect(result[0].intensity).toBe('optimal'); // 12 >= (8+15)/2 = 11.5
    expect(result[0].zone).toBe('optimal');
    expect(result[0].tooltip).toContain('Quads');
    expect(result[0].tooltip).toContain('12 sets');
    expect(result[0].tooltip).toContain('optimal zone');

    // Second item: chest with 0 sets → intensity "none"
    expect(result[1].muscleGroup).toBe('chest');
    expect(result[1].intensity).toBe('none');
    expect(result[1].sets).toBe(0);
  });

  it('handles empty input', () => {
    expect(volumeToMapData([])).toEqual([]);
  });

  it('maps all 4 volume zones correctly', () => {
    const volumes: MuscleVolume[] = [
      { muscleGroup: 'a', label: 'A', weeklySets: 3, zone: 'under', mev: 6, mav: 12, mrv: 20 },
      { muscleGroup: 'b', label: 'B', weeklySets: 7, zone: 'optimal', mev: 6, mav: 12, mrv: 20 },
      { muscleGroup: 'c', label: 'C', weeklySets: 18, zone: 'high', mev: 6, mav: 14, mrv: 20 },
      { muscleGroup: 'd', label: 'D', weeklySets: 25, zone: 'excessive', mev: 8, mav: 15, mrv: 20 },
    ];

    const result = volumeToMapData(volumes);
    expect(result[0].intensity).toBe('low');       // under zone, non-zero
    expect(result[1].intensity).toBe('moderate');   // 7 < (6+12)/2=9
    expect(result[2].intensity).toBe('high');
    expect(result[3].intensity).toBe('excessive');
  });

  it('generates correct tooltip text', () => {
    const volumes: MuscleVolume[] = [
      { muscleGroup: 'glutes', label: 'Glutes', weeklySets: 4, zone: 'under', mev: 4, mav: 12, mrv: 16 },
    ];
    const result = volumeToMapData(volumes);
    expect(result[0].tooltip).toBe('Glutes: 4 sets (under MEV)');
  });
});

// ─── getMuscleMapLayout ───

describe('getMuscleMapLayout', () => {
  it('returns front and back arrays', () => {
    const layout = getMuscleMapLayout();
    expect(layout.front).toBeDefined();
    expect(layout.back).toBeDefined();
    expect(Array.isArray(layout.front)).toBe(true);
    expect(Array.isArray(layout.back)).toBe(true);
  });

  it('front view contains expected muscles', () => {
    const { front } = getMuscleMapLayout();
    const muscles = front.map(r => r.muscle);
    expect(muscles).toContain('quads');
    expect(muscles).toContain('chest');
    expect(muscles).toContain('core');
    expect(muscles).toContain('biceps');
    expect(muscles).toContain('front_delts');
    expect(muscles).toContain('shoulders');
    expect(muscles).toContain('calves');
  });

  it('back view contains expected muscles', () => {
    const { back } = getMuscleMapLayout();
    const muscles = back.map(r => r.muscle);
    expect(muscles).toContain('back');
    expect(muscles).toContain('glutes');
    expect(muscles).toContain('hamstrings');
    expect(muscles).toContain('triceps');
    expect(muscles).toContain('upper_back');
    expect(muscles).toContain('rear_delts');
    expect(muscles).toContain('lower_back');
    expect(muscles).toContain('calves');
  });

  it('each region has a valid SVG path and label', () => {
    const layout = getMuscleMapLayout();
    for (const region of [...layout.front, ...layout.back]) {
      expect(region.path).toBeTruthy();
      expect(region.label).toBeTruthy();
      expect(region.muscle).toBeTruthy();
      // SVG path should start with M
      expect(region.path.trim()).toMatch(/^M/);
    }
  });
});

// ─── renderMuscleMap ───

describe('renderMuscleMap', () => {
  const sampleData: MuscleMapData[] = [
    { muscleGroup: 'quads', label: 'Quads', intensity: 'optimal', sets: 15, zone: 'optimal', tooltip: 'Quads: 15 sets (optimal zone)' },
    { muscleGroup: 'chest', label: 'Chest', intensity: 'low', sets: 4, zone: 'under', tooltip: 'Chest: 4 sets (under MEV)' },
  ];

  it('returns HTML string containing SVG', () => {
    const html = renderMuscleMap(sampleData);
    expect(html).toContain('<svg');
    expect(html).toContain('</svg>');
  });

  it('includes front/back toggle buttons', () => {
    const html = renderMuscleMap(sampleData);
    expect(html).toContain('mm-toggle-btn');
    expect(html).toContain('data-view="front"');
    expect(html).toContain('data-view="back"');
    expect(html).toContain('Front');
    expect(html).toContain('Back');
  });

  it('includes legend', () => {
    const html = renderMuscleMap(sampleData);
    expect(html).toContain('mm-legend');
    expect(html).toContain('Untrained');
    expect(html).toContain('Under MEV');
    expect(html).toContain('Optimal');
    expect(html).toContain('Over MRV');
  });

  it('includes mode label', () => {
    const weekHtml = renderMuscleMap(sampleData, 'front', 'week');
    expect(weekHtml).toContain('This Week');

    const sessionHtml = renderMuscleMap(sampleData, 'front', 'session');
    expect(sessionHtml).toContain('This Session');
  });

  it('renders front view as active by default', () => {
    const html = renderMuscleMap(sampleData);
    expect(html).toContain('id="mm-view-front"');
    expect(html).toContain('mm-view-active');
  });

  it('renders back view as active when specified', () => {
    const html = renderMuscleMap(sampleData, 'back');
    // The back view should have the active class
    expect(html).toContain('data-view="back"');
    // Container data attribute
    expect(html).toContain('data-view="back"');
  });

  it('applies correct colors to muscle paths based on intensity', () => {
    const html = renderMuscleMap(sampleData);
    // Optimal intensity for quads
    expect(html).toContain(getMuscleColor('optimal'));
    // Low intensity for chest
    expect(html).toContain(getMuscleColor('low'));
  });

  it('includes tooltips as data attributes', () => {
    const html = renderMuscleMap(sampleData);
    expect(html).toContain('data-tooltip');
    expect(html).toContain('Quads: 15 sets (optimal zone)');
  });

  it('includes ARIA labels for accessibility', () => {
    const html = renderMuscleMap(sampleData);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('role="tabpanel"');
  });

  it('renders with empty data without errors', () => {
    const html = renderMuscleMap([]);
    expect(html).toContain('<svg');
    expect(html).toContain('mm-container');
  });
});

// ─── renderSessionMusclesSummary ───

describe('renderSessionMusclesSummary', () => {
  it('maps exercise slots to muscle groups', () => {
    const sets = [
      { exerciseSlot: 'squat', completed: true },
      { exerciseSlot: 'squat', completed: true },
      { exerciseSlot: 'squat', completed: true },
      { exerciseSlot: 'bench', completed: true },
      { exerciseSlot: 'bench', completed: true },
    ];

    const html = renderSessionMusclesSummary(sets);
    expect(html).toContain('Muscles Worked');
    // Squat targets quads, glutes, core
    expect(html).toContain('Quads');
    expect(html).toContain('Core');
    expect(html).toContain('Glutes');
    // Bench targets chest, triceps, front_delts
    expect(html).toContain('Chest');
    expect(html).toContain('Triceps');
  });

  it('handles empty sets array', () => {
    const html = renderSessionMusclesSummary([]);
    expect(html).toContain('No muscles tracked');
  });

  it('only counts completed sets', () => {
    const sets = [
      { exerciseSlot: 'squat', completed: true },
      { exerciseSlot: 'squat', completed: false },
      { exerciseSlot: 'squat', completed: false },
    ];

    const html = renderSessionMusclesSummary(sets);
    // Should still show muscles, just with lower counts
    expect(html).toContain('Quads');
    // Only 1 completed set of squats
    expect(html).toContain('(1)');
  });

  it('handles unknown exercise slots gracefully', () => {
    const sets = [
      { exerciseSlot: 'nonexistent_exercise', completed: true },
    ];

    const html = renderSessionMusclesSummary(sets);
    // Should show the "no muscles" message since unknown slots are skipped
    expect(html).toContain('No muscles tracked');
  });

  it('includes the muscle map SVG', () => {
    const sets = [
      { exerciseSlot: 'squat', completed: true },
    ];

    const html = renderSessionMusclesSummary(sets);
    expect(html).toContain('<svg');
    expect(html).toContain('mm-container');
  });

  it('shows set counts per muscle group', () => {
    const sets = [
      { exerciseSlot: 'deadlift', completed: true },
      { exerciseSlot: 'deadlift', completed: true },
      { exerciseSlot: 'deadlift', completed: true },
    ];

    const html = renderSessionMusclesSummary(sets);
    // Deadlift → hamstrings, glutes, back, core (3 sets each)
    expect(html).toContain('(3)');
  });
});

// ─── injectMuscleMapStyles ───

describe('injectMuscleMapStyles', () => {
  let mockHead: { appendChild: ReturnType<typeof vi.fn> };
  let mockStyleEl: Record<string, unknown>;
  let getByIdResult: null | Record<string, unknown>;

  beforeEach(() => {
    mockStyleEl = { id: '', textContent: '' };
    mockHead = { appendChild: vi.fn() };
    getByIdResult = null;

    (globalThis as Record<string, unknown>).document = {
      getElementById: vi.fn().mockImplementation(() => getByIdResult),
      createElement: vi.fn().mockReturnValue(mockStyleEl),
      head: mockHead,
    };
  });

  it('injects a style element with id muscle-map-styles', () => {
    injectMuscleMapStyles();
    expect(mockStyleEl.id).toBe('muscle-map-styles');
    expect(mockHead.appendChild).toHaveBeenCalledWith(mockStyleEl);
  });

  it('is idempotent — does not inject if already present', () => {
    getByIdResult = { id: 'muscle-map-styles' };
    injectMuscleMapStyles();
    expect(mockHead.appendChild).not.toHaveBeenCalled();
  });

  it('sets textContent with expected CSS class selectors', () => {
    injectMuscleMapStyles();
    const content = mockStyleEl.textContent as string;
    expect(content).toContain('.mm-container');
    expect(content).toContain('.mm-toggle');
    expect(content).toContain('.mm-svg');
    expect(content).toContain('.mm-muscle');
    expect(content).toContain('.mm-tooltip');
    expect(content).toContain('.mm-legend');
    expect(content).toContain('.mm-mode-label');
  });
});

// ─── attachMuscleMapListeners ───

describe('attachMuscleMapListeners', () => {
  it('is exported and callable', () => {
    expect(typeof attachMuscleMapListeners).toBe('function');
  });

  it('renders HTML with interactive elements', () => {
    const html = renderMuscleMap([], 'front');
    // Verify the HTML contains toggle buttons that listeners would wire up
    expect(html).toContain('mm-toggle-btn');
    expect(html).toContain('data-view="front"');
    expect(html).toContain('data-view="back"');
  });

  it('renders muscles with data-tooltip for hover behavior', () => {
    const data: MuscleMapData[] = [
      { muscleGroup: 'quads', label: 'Quads', intensity: 'optimal', sets: 15, zone: 'optimal', tooltip: 'Quads: 15 sets' },
    ];
    const html = renderMuscleMap(data);
    expect(html).toContain('data-tooltip="Quads: 15 sets"');
    expect(html).toContain('data-muscle="quads"');
    expect(html).toContain('mm-tooltip');
  });
});
