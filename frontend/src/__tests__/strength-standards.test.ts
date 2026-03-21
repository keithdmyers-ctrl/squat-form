import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  STRENGTH_STANDARDS,
  getStrengthLevel,
  getStrengthPercentile,
  getNextMilestone,
  renderStrengthCard,
} from '../strength-standards';
import {
  calculateWilks2,
  calculateGLPoints,
  check1RMSafety,
  computeDOTS,
} from '../one-rm';
import {
  calculateCompTotal,
  saveCompTotal,
  loadCompTotals,
  getBestTotal,
  renderCompTotalCard,
  getCommandsForLift,
  renderCommandsReference,
  COMPETITION_COMMANDS,
} from '../competition';
import type { CompTotal } from '../competition';
import {
  getMeetDayFactor,
  generateAttemptPlan,
} from '../meet-prep';
import type { MeetDayStrategy } from '../meet-prep';
import { generateMeetPrepPlan } from '../meet-prep-plan';

// ─── localStorage mock ───

function createLocalStorageMock(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

// ─── Strength Standards ───

describe('STRENGTH_STANDARDS', () => {
  it('has exactly 6 levels', () => {
    expect(STRENGTH_STANDARDS).toHaveLength(6);
  });

  it('levels are in ascending order', () => {
    const expectedOrder = ['untrained', 'beginner', 'novice', 'intermediate', 'advanced', 'elite'];
    expect(STRENGTH_STANDARDS.map(s => s.level)).toEqual(expectedOrder);
  });

  it('multipliers increase with each level for all lifts and sexes', () => {
    const lifts = ['squat', 'bench', 'deadlift', 'ohp'] as const;
    const sexes = ['male', 'female'] as const;
    for (const lift of lifts) {
      for (const sex of sexes) {
        for (let i = 1; i < STRENGTH_STANDARDS.length; i++) {
          const prev = STRENGTH_STANDARDS[i - 1].multipliers[lift][sex];
          const curr = STRENGTH_STANDARDS[i].multipliers[lift][sex];
          expect(curr).toBeGreaterThan(prev);
        }
      }
    }
  });

  it('each standard has a color and description', () => {
    for (const s of STRENGTH_STANDARDS) {
      expect(s.color).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.label).toBeTruthy();
    }
  });
});

describe('getStrengthLevel', () => {
  it('returns untrained for zero weight', () => {
    expect(getStrengthLevel(0, 80, 'squat', 'male')).toBe('untrained');
  });

  it('returns untrained for zero bodyweight', () => {
    expect(getStrengthLevel(100, 0, 'squat', 'male')).toBe('untrained');
  });

  it('returns untrained for unknown lift', () => {
    expect(getStrengthLevel(100, 80, 'curls', 'male')).toBe('untrained');
  });

  it('classifies male squat at each level boundary', () => {
    const bw = 80;
    // Untrained: 0.75x = 60kg
    expect(getStrengthLevel(60, bw, 'squat', 'male')).toBe('untrained');
    // Beginner: 1.0x = 80kg
    expect(getStrengthLevel(80, bw, 'squat', 'male')).toBe('beginner');
    // Novice: 1.25x = 100kg
    expect(getStrengthLevel(100, bw, 'squat', 'male')).toBe('novice');
    // Intermediate: 1.5x = 120kg
    expect(getStrengthLevel(120, bw, 'squat', 'male')).toBe('intermediate');
    // Advanced: 2.0x = 160kg
    expect(getStrengthLevel(160, bw, 'squat', 'male')).toBe('advanced');
    // Elite: 2.5x = 200kg
    expect(getStrengthLevel(200, bw, 'squat', 'male')).toBe('elite');
  });

  it('classifies female bench at boundaries', () => {
    const bw = 60;
    // Untrained: 0.3x = 18kg
    expect(getStrengthLevel(18, bw, 'bench', 'female')).toBe('untrained');
    // Beginner: 0.45x = 27kg
    expect(getStrengthLevel(27, bw, 'bench', 'female')).toBe('beginner');
    // Novice: 0.6x = 36kg
    expect(getStrengthLevel(36, bw, 'bench', 'female')).toBe('novice');
    // Intermediate: 0.8x = 48kg
    expect(getStrengthLevel(48, bw, 'bench', 'female')).toBe('intermediate');
    // Advanced: 1.0x = 60kg
    expect(getStrengthLevel(60, bw, 'bench', 'female')).toBe('advanced');
    // Elite: 1.25x = 75kg
    expect(getStrengthLevel(75, bw, 'bench', 'female')).toBe('elite');
  });

  it('classifies mid-level values correctly', () => {
    const bw = 90;
    // 1.3x squat male = between novice (1.25) and intermediate (1.5) -> novice
    expect(getStrengthLevel(117, bw, 'squat', 'male')).toBe('novice');
    // 2.1x squat male = between advanced (2.0) and elite (2.5) -> advanced
    expect(getStrengthLevel(189, bw, 'squat', 'male')).toBe('advanced');
  });

  it('handles OHP aliases', () => {
    const bw = 80;
    expect(getStrengthLevel(80, bw, 'ohp', 'male')).toBe('advanced');
    expect(getStrengthLevel(80, bw, 'overhead press', 'male')).toBe('advanced');
    expect(getStrengthLevel(80, bw, 'shoulder press', 'male')).toBe('advanced');
  });

  it('below untrained threshold returns untrained', () => {
    const bw = 80;
    // Male squat untrained threshold is 0.75x = 60kg. Below that:
    expect(getStrengthLevel(40, bw, 'squat', 'male')).toBe('untrained');
  });

  it('above elite threshold returns elite', () => {
    const bw = 80;
    // Male squat elite = 2.5x = 200kg. Way above:
    expect(getStrengthLevel(300, bw, 'squat', 'male')).toBe('elite');
  });
});

describe('getStrengthPercentile', () => {
  it('returns 0 for zero weight', () => {
    expect(getStrengthPercentile(0, 80, 'squat', 'male')).toBe(0);
  });

  it('returns 0 for unknown lift', () => {
    expect(getStrengthPercentile(100, 80, 'curls', 'male')).toBe(0);
  });

  it('returns low percentile for untrained weight', () => {
    const pct = getStrengthPercentile(40, 80, 'squat', 'male');
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(10);
  });

  it('returns mid percentile for intermediate weight', () => {
    const bw = 80;
    // Intermediate squat male: 1.5x = 120kg -> ~60th percentile
    const pct = getStrengthPercentile(120, bw, 'squat', 'male');
    expect(pct).toBeGreaterThanOrEqual(55);
    expect(pct).toBeLessThanOrEqual(65);
  });

  it('returns high percentile for advanced weight', () => {
    const bw = 80;
    // Advanced squat male: 2.0x = 160kg -> ~80th percentile
    const pct = getStrengthPercentile(160, bw, 'squat', 'male');
    expect(pct).toBeGreaterThanOrEqual(75);
    expect(pct).toBeLessThanOrEqual(85);
  });

  it('returns 95+ for elite weight', () => {
    const bw = 80;
    // Elite squat male: 2.5x = 200kg -> ~95th percentile
    const pct = getStrengthPercentile(200, bw, 'squat', 'male');
    expect(pct).toBeGreaterThanOrEqual(95);
  });

  it('caps at 99 for extreme values', () => {
    const pct = getStrengthPercentile(400, 80, 'squat', 'male');
    expect(pct).toBeLessThanOrEqual(99);
  });

  it('percentile increases monotonically with weight', () => {
    const weights = [40, 60, 80, 100, 120, 160, 200, 250];
    let prevPct = -1;
    for (const w of weights) {
      const pct = getStrengthPercentile(w, 80, 'squat', 'male');
      expect(pct).toBeGreaterThanOrEqual(prevPct);
      prevPct = pct;
    }
  });
});

describe('getNextMilestone', () => {
  it('returns next level target for a beginner', () => {
    const bw = 80;
    const result = getNextMilestone(80, bw, 'squat', 'male');
    // Currently beginner (1.0x = 80kg), next is novice (1.25x = 100kg)
    expect(result.level).toBe('novice');
    expect(result.targetWeight).toBe(100);
    expect(result.deficit).toBe(20);
  });

  it('returns elite info when already at elite', () => {
    const bw = 80;
    const result = getNextMilestone(200, bw, 'squat', 'male');
    expect(result.level).toBe('elite');
    expect(result.deficit).toBe(0);
  });

  it('returns correct deficit', () => {
    const bw = 80;
    // 130kg squat male = novice (1.25x=100kg < 130/80=1.625 < intermediate 1.5x=120kg)
    // Actually 130/80 = 1.625 which is intermediate. Next is advanced at 2.0x = 160kg
    const result = getNextMilestone(130, bw, 'squat', 'male');
    expect(result.level).toBe('advanced');
    expect(result.targetWeight).toBe(160);
    expect(result.deficit).toBe(30);
  });

  it('handles zero bodyweight gracefully', () => {
    const result = getNextMilestone(100, 0, 'squat', 'male');
    expect(result.level).toBe('beginner');
  });
});

describe('renderStrengthCard', () => {
  it('returns valid HTML with lift data', () => {
    const html = renderStrengthCard(
      { squat: 140, bench: 100, deadlift: 180, ohp: 65 },
      80,
      'male',
    );
    expect(html).toContain('strength-card');
    expect(html).toContain('Squat');
    expect(html).toContain('Bench Press');
    expect(html).toContain('Deadlift');
    expect(html).toContain('Overhead Press');
    expect(html).toContain('80 kg bodyweight');
  });

  it('shows "No data" for missing lifts', () => {
    const html = renderStrengthCard({ squat: 100 }, 80, 'male');
    expect(html).toContain('No data');
  });

  it('shows bodyweight prompt for zero bodyweight', () => {
    const html = renderStrengthCard({ squat: 100 }, 0, 'male');
    expect(html).toContain('Enter your bodyweight');
  });
});

// ─── Wilks-2 and GL Points ───

describe('calculateWilks2', () => {
  it('returns null for zero total', () => {
    expect(calculateWilks2(0, 80, 'male')).toBeNull();
  });

  it('returns null for zero bodyweight', () => {
    expect(calculateWilks2(500, 0, 'male')).toBeNull();
  });

  it('returns a positive score for valid male inputs', () => {
    // ~83kg male with ~500kg total (roughly an intermediate-advanced lifter)
    const result = calculateWilks2(500, 83, 'male');
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });

  it('returns a positive score for valid female inputs', () => {
    const result = calculateWilks2(350, 63, 'female');
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });

  it('increases with higher total at same bodyweight', () => {
    const score1 = calculateWilks2(400, 83, 'male')!;
    const score2 = calculateWilks2(500, 83, 'male')!;
    expect(score2).toBeGreaterThan(score1);
  });

  it('lighter lifters get higher scores for same total', () => {
    // Same total, lighter bodyweight should yield higher Wilks
    const light = calculateWilks2(500, 66, 'male')!;
    const heavy = calculateWilks2(500, 120, 'male')!;
    expect(light).toBeGreaterThan(heavy);
  });

  it('produces reasonable values for a known benchmark', () => {
    // A ~83kg male totaling 600kg should produce roughly 380-420 Wilks-2
    const result = calculateWilks2(600, 83, 'male');
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(300);
    expect(result!).toBeLessThan(500);
  });
});

describe('calculateGLPoints', () => {
  it('returns null for zero total', () => {
    expect(calculateGLPoints(0, 80, 'male')).toBeNull();
  });

  it('returns null for zero bodyweight', () => {
    expect(calculateGLPoints(500, 0, 'male')).toBeNull();
  });

  it('returns a positive score for valid male inputs', () => {
    const result = calculateGLPoints(500, 83, 'male');
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });

  it('returns a positive score for valid female inputs', () => {
    const result = calculateGLPoints(350, 63, 'female');
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });

  it('increases with higher total at same bodyweight', () => {
    const score1 = calculateGLPoints(400, 83, 'male')!;
    const score2 = calculateGLPoints(500, 83, 'male')!;
    expect(score2).toBeGreaterThan(score1);
  });

  it('lighter lifters get higher GL points for same total', () => {
    const light = calculateGLPoints(500, 66, 'male')!;
    const heavy = calculateGLPoints(500, 120, 'male')!;
    expect(light).toBeGreaterThan(heavy);
  });

  it('produces reasonable values for a known benchmark', () => {
    // A ~83kg male totaling 600kg should produce roughly 70-110 GL points
    const result = calculateGLPoints(600, 83, 'male');
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(50);
    expect(result!).toBeLessThan(150);
  });
});

describe('check1RMSafety', () => {
  it('returns not plausible for zero max', () => {
    const result = check1RMSafety(0, 'squat');
    expect(result.plausible).toBe(false);
  });

  it('returns plausible for reasonable values', () => {
    const result = check1RMSafety(150, 'squat');
    expect(result.plausible).toBe(true);
  });

  it('flags values above world record', () => {
    const result = check1RMSafety(600, 'squat');
    expect(result.plausible).toBe(false);
    expect(result.warning).toContain('world record');
    expect(result.worldRecordPct).toBeGreaterThan(100);
  });

  it('warns for values near world record (>90%)', () => {
    // Male squat record ~505kg, 90% = ~455kg
    const result = check1RMSafety(470, 'squat');
    expect(result.plausible).toBe(true);
    expect(result.warning).toBeTruthy();
    expect(result.worldRecordPct).toBeGreaterThan(90);
  });

  it('flags extreme bodyweight multiples', () => {
    const result = check1RMSafety(400, 'squat', 80); // 5x BW
    expect(result.plausible).toBe(false);
    expect(result.warning).toContain('bodyweight');
  });

  it('accepts reasonable bodyweight multiples', () => {
    const result = check1RMSafety(200, 'squat', 80); // 2.5x BW
    expect(result.plausible).toBe(true);
  });

  it('returns plausible for unknown lift', () => {
    const result = check1RMSafety(100, 'leg_press');
    expect(result.plausible).toBe(true);
  });

  it('handles OHP aliases', () => {
    const result = check1RMSafety(250, 'overhead press');
    expect(result.plausible).toBe(false);
    expect(result.warning).toContain('world record');
  });

  it('provides worldRecordPct', () => {
    const result = check1RMSafety(200, 'squat');
    expect(result.worldRecordPct).toBeDefined();
    expect(result.worldRecordPct!).toBeGreaterThan(0);
    expect(result.worldRecordPct!).toBeLessThan(100);
  });
});

// ─── Competition Total Tracking ───

describe('calculateCompTotal', () => {
  it('sums three lifts', () => {
    expect(calculateCompTotal(200, 150, 250)).toBe(600);
  });

  it('returns 0 if any lift is zero (bombed out)', () => {
    expect(calculateCompTotal(0, 150, 250)).toBe(0);
    expect(calculateCompTotal(200, 0, 250)).toBe(0);
    expect(calculateCompTotal(200, 150, 0)).toBe(0);
  });

  it('returns 0 if any lift is negative', () => {
    expect(calculateCompTotal(-10, 150, 250)).toBe(0);
  });
});

describe('Competition total localStorage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageMock());
  });

  it('loadCompTotals returns empty array when nothing saved', () => {
    expect(loadCompTotals()).toEqual([]);
  });

  it('saveCompTotal and loadCompTotals round-trip', () => {
    const total: CompTotal = {
      squat: 200,
      bench: 150,
      deadlift: 250,
      total: 600,
      bodyweight: 83,
      date: '2026-03-15',
      dots: 420,
      isCompetition: true,
    };
    saveCompTotal(total);
    const loaded = loadCompTotals();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].total).toBe(600);
    expect(loaded[0].isCompetition).toBe(true);
  });

  it('getBestTotal returns the highest total', () => {
    saveCompTotal({
      squat: 180, bench: 130, deadlift: 220, total: 530,
      bodyweight: 83, date: '2026-01-01', isCompetition: true,
    });
    saveCompTotal({
      squat: 200, bench: 150, deadlift: 250, total: 600,
      bodyweight: 83, date: '2026-03-01', isCompetition: true,
    });
    saveCompTotal({
      squat: 190, bench: 140, deadlift: 240, total: 570,
      bodyweight: 83, date: '2026-02-01', isCompetition: false,
    });

    const best = getBestTotal('all');
    expect(best).not.toBeNull();
    expect(best!.total).toBe(600);
  });

  it('getBestTotal filters by type', () => {
    saveCompTotal({
      squat: 200, bench: 150, deadlift: 250, total: 600,
      bodyweight: 83, date: '2026-03-01', isCompetition: false,
    });
    saveCompTotal({
      squat: 180, bench: 130, deadlift: 220, total: 530,
      bodyweight: 83, date: '2026-01-01', isCompetition: true,
    });

    const bestComp = getBestTotal('competition');
    expect(bestComp!.total).toBe(530);

    const bestGym = getBestTotal('gym');
    expect(bestGym!.total).toBe(600);
  });

  it('getBestTotal returns null when no totals match filter', () => {
    saveCompTotal({
      squat: 200, bench: 150, deadlift: 250, total: 600,
      bodyweight: 83, date: '2026-03-01', isCompetition: false,
    });
    expect(getBestTotal('competition')).toBeNull();
  });

  it('getBestTotal returns null when no totals exist', () => {
    expect(getBestTotal()).toBeNull();
  });

  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem('squat_form_comp_totals', 'not json');
    expect(loadCompTotals()).toEqual([]);
  });
});

describe('renderCompTotalCard', () => {
  it('renders HTML with lift values', () => {
    const total: CompTotal = {
      squat: 200, bench: 150, deadlift: 250, total: 600,
      bodyweight: 83, date: '2026-03-15', dots: 420, wilks2: 380, glPoints: 85.5,
      isCompetition: true,
    };
    const html = renderCompTotalCard(total);
    expect(html).toContain('comp-total-card');
    expect(html).toContain('Meet Total');
    expect(html).toContain('200 kg');
    expect(html).toContain('150 kg');
    expect(html).toContain('250 kg');
    expect(html).toContain('600 kg');
    expect(html).toContain('DOTS: 420');
    expect(html).toContain('Wilks-2: 380');
    expect(html).toContain('GL: 85.5');
  });

  it('renders Gym Total label for non-competition', () => {
    const total: CompTotal = {
      squat: 200, bench: 150, deadlift: 250, total: 600,
      bodyweight: 83, date: '2026-03-15', isCompetition: false,
    };
    const html = renderCompTotalCard(total);
    expect(html).toContain('Gym Total');
  });
});

// ─── Competition Commands ───

describe('COMPETITION_COMMANDS', () => {
  it('has 6 total commands', () => {
    expect(COMPETITION_COMMANDS).toHaveLength(6);
  });

  it('has 2 squat commands', () => {
    expect(COMPETITION_COMMANDS.filter(c => c.lift === 'squat')).toHaveLength(2);
  });

  it('has 3 bench commands', () => {
    expect(COMPETITION_COMMANDS.filter(c => c.lift === 'bench')).toHaveLength(3);
  });

  it('has 1 deadlift command', () => {
    expect(COMPETITION_COMMANDS.filter(c => c.lift === 'deadlift')).toHaveLength(1);
  });
});

describe('getCommandsForLift', () => {
  it('returns correct squat commands', () => {
    const cmds = getCommandsForLift('squat');
    expect(cmds).toHaveLength(2);
    expect(cmds.map(c => c.command)).toContain('SQUAT');
    expect(cmds.map(c => c.command)).toContain('RACK');
  });

  it('returns correct bench commands', () => {
    const cmds = getCommandsForLift('bench');
    expect(cmds).toHaveLength(3);
    expect(cmds.map(c => c.command)).toContain('START');
    expect(cmds.map(c => c.command)).toContain('PRESS');
    expect(cmds.map(c => c.command)).toContain('RACK');
  });

  it('returns correct deadlift commands', () => {
    const cmds = getCommandsForLift('deadlift');
    expect(cmds).toHaveLength(1);
    expect(cmds[0].command).toBe('DOWN');
  });
});

describe('renderCommandsReference', () => {
  it('renders all commands when no lift specified', () => {
    const html = renderCommandsReference();
    expect(html).toContain('Squat');
    expect(html).toContain('Bench');
    expect(html).toContain('Deadlift');
    expect(html).toContain('PRESS');
    expect(html).toContain('DOWN');
  });

  it('renders only squat commands when lift specified', () => {
    const html = renderCommandsReference('squat');
    expect(html).toContain('Squat');
    expect(html).toContain('SQUAT');
    expect(html).not.toContain('PRESS');
    expect(html).not.toContain('DOWN');
  });

  it('renders all commands for invalid lift name', () => {
    const html = renderCommandsReference('curl');
    expect(html).toContain('Squat');
    expect(html).toContain('Bench');
    expect(html).toContain('Deadlift');
  });
});

// ─── Meet-Day Adrenaline Factor ───

describe('getMeetDayFactor', () => {
  it('returns 1.0 for conservative', () => {
    expect(getMeetDayFactor('conservative')).toBe(1.0);
  });

  it('returns 1.03 for moderate', () => {
    expect(getMeetDayFactor('moderate')).toBe(1.03);
  });

  it('returns 1.05 for aggressive', () => {
    expect(getMeetDayFactor('aggressive')).toBe(1.05);
  });
});

describe('generateAttemptPlan with meetDayStrategy', () => {
  const sessions = [
    { id: '1', date: '2026-03-01', squat_type: 'low_bar', experience_level: 'intermediate', rep_count: 5, overall_score: 80, grade: 'B', top_issue: null, positive_count: 3 },
    { id: '2', date: '2026-03-05', squat_type: 'low_bar', experience_level: 'intermediate', rep_count: 5, overall_score: 82, grade: 'B', top_issue: null, positive_count: 3 },
    { id: '3', date: '2026-03-08', squat_type: 'low_bar', experience_level: 'intermediate', rep_count: 5, overall_score: 85, grade: 'B', top_issue: null, positive_count: 3 },
  ];

  it('conservative strategy: third attempt at 100% of gym 1RM', () => {
    const plan = generateAttemptPlan(sessions, 200, 'kg', 'conservative');
    expect(plan).not.toBeNull();
    // Third at 100% of 200 = 200, rounded to 2.5kg = 200
    expect(plan!.third).toBe(200);
    expect(plan!.meetDayStrategy).toBe('conservative');
    expect(plan!.meetDayFactor).toBe(1.0);
  });

  it('moderate strategy: third attempt at 103% of gym 1RM', () => {
    const plan = generateAttemptPlan(sessions, 200, 'kg', 'moderate');
    expect(plan).not.toBeNull();
    // Third at 103% of 200 = 206, rounded to nearest 2.5kg = 205
    expect(plan!.third).toBe(205);
    expect(plan!.meetDayStrategy).toBe('moderate');
    expect(plan!.meetDayFactor).toBe(1.03);
  });

  it('aggressive strategy: third attempt at 105% of gym 1RM', () => {
    const plan = generateAttemptPlan(sessions, 200, 'kg', 'aggressive');
    expect(plan).not.toBeNull();
    // Third at 105% of 200 = 210, rounded to 2.5kg = 210
    expect(plan!.third).toBe(210);
    expect(plan!.meetDayStrategy).toBe('aggressive');
    expect(plan!.meetDayFactor).toBe(1.05);
  });

  it('defaults to moderate strategy', () => {
    const plan = generateAttemptPlan(sessions, 200, 'kg');
    expect(plan).not.toBeNull();
    expect(plan!.meetDayStrategy).toBe('moderate');
    expect(plan!.meetDayFactor).toBe(1.03);
  });

  it('opener and second are not affected by adrenaline factor', () => {
    const conservative = generateAttemptPlan(sessions, 200, 'kg', 'conservative');
    const aggressive = generateAttemptPlan(sessions, 200, 'kg', 'aggressive');
    expect(conservative!.opener).toBe(aggressive!.opener);
    expect(conservative!.second).toBe(aggressive!.second);
  });

  it('rationale mentions meet-day strategy for moderate', () => {
    const plan = generateAttemptPlan(sessions, 200, 'kg', 'moderate');
    expect(plan!.rationale).toContain('moderate');
    expect(plan!.rationale).toContain('adrenaline');
  });

  it('rationale mentions conservative strategy', () => {
    const plan = generateAttemptPlan(sessions, 200, 'kg', 'conservative');
    expect(plan!.rationale).toContain('conservative');
  });

  it('returns null for invalid 1RM', () => {
    expect(generateAttemptPlan(sessions, 0, 'kg', 'moderate')).toBeNull();
    expect(generateAttemptPlan(sessions, -100, 'kg', 'moderate')).toBeNull();
  });
});

describe('generateMeetPrepPlan with meetDayStrategy', () => {
  it('includes meetDayStrategy and factor in the result', () => {
    const plan = generateMeetPrepPlan('2026-05-01', 200, 'kg', '2026-03-01', 'aggressive');
    expect(plan.meetDayStrategy).toBe('aggressive');
    expect(plan.meetDayFactor).toBe(1.05);
    expect(plan.projectedMeetMax).toBeCloseTo(210, 0);
  });

  it('meet week opener is based on projected meet max', () => {
    const plan = generateMeetPrepPlan('2026-04-01', 200, 'kg', '2026-03-25', 'moderate');
    // Projected meet max = 200 * 1.03 = 206
    // Opener at 87% of 206 = 179.22, rounded to 2.5 = 180
    const meetWeek = plan.weeks.find(w => w.label.includes('Meet week'));
    expect(meetWeek).toBeDefined();
    expect(meetWeek!.weight).toBe(180);
  });

  it('taper weeks use gym 1RM, not boosted max', () => {
    const plan = generateMeetPrepPlan('2026-05-01', 200, 'kg', '2026-04-01', 'aggressive');
    // Week -1: Heavy singles at 93% of gym 1RM = 186, rounded = 185
    const taperWeek = plan.weeks.find(w => w.label.includes('Heavy singles'));
    expect(taperWeek).toBeDefined();
    expect(taperWeek!.weight).toBe(185);
  });

  it('defaults to moderate strategy', () => {
    const plan = generateMeetPrepPlan('2026-05-01', 200, 'kg', '2026-03-01');
    expect(plan.meetDayStrategy).toBe('moderate');
    expect(plan.meetDayFactor).toBe(1.03);
  });

  it('conservative strategy uses raw gym 1RM for meet week', () => {
    const plan = generateMeetPrepPlan('2026-04-01', 200, 'kg', '2026-03-25', 'conservative');
    // Projected meet max = 200 * 1.0 = 200
    // Opener at 87% of 200 = 174, rounded = 175
    const meetWeek = plan.weeks.find(w => w.label.includes('Meet week'));
    expect(meetWeek!.weight).toBe(175);
  });
});

// ─── DOTS integration sanity check ───

describe('computeDOTS', () => {
  it('returns positive score for valid inputs', () => {
    const result = computeDOTS(500, 83, true);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0);
  });

  it('returns null for invalid inputs', () => {
    expect(computeDOTS(0, 83, true)).toBeNull();
    expect(computeDOTS(500, 0, true)).toBeNull();
  });
});
