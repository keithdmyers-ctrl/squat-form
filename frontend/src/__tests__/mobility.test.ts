import { describe, it, expect } from 'vitest';
import { assessMobility, generateWarmupProtocol } from '../mobility';
import type { FormIssue, ExperienceLevel, MobilityFinding, WarmUpStep } from '../types';

// ── Helpers ──

function makeIssue(overrides: Partial<FormIssue> = {}): FormIssue {
  return {
    name: 'heel_rise',
    severity: 'moderate',
    description: 'Heels lifting during squat',
    value: 15,
    threshold: 10,
    phase: 'bottom',
    frame: 30,
    ...overrides,
  };
}

// ── assessMobility ──

describe('assessMobility', () => {
  it('recommends hip/glute mobility for knee valgus', () => {
    const issues = [makeIssue({ name: 'knee_valgus', severity: 'moderate' })];
    const findings = assessMobility(issues, 'beginner');

    expect(findings.length).toBe(1);
    expect(findings[0].area).toBe('Hip Abductors');
    expect(findings[0].limitation).toContain('glute');
    expect(findings[0].stretches.length).toBeGreaterThan(0);
  });

  it('recommends ankle dorsiflexion work for heel rise', () => {
    const issues = [makeIssue({ name: 'heel_rise', severity: 'moderate' })];
    const findings = assessMobility(issues, 'beginner');

    expect(findings.length).toBe(1);
    expect(findings[0].area).toBe('Ankles');
    expect(findings[0].limitation).toContain('ankle');
    expect(findings[0].stretches.some(s => s.toLowerCase().includes('ankle'))).toBe(true);
  });

  it('recommends hip flexor stretches for butt wink', () => {
    const issues = [makeIssue({ name: 'butt_wink', severity: 'moderate' })];
    const findings = assessMobility(issues, 'beginner');

    expect(findings.length).toBe(1);
    expect(findings[0].area).toBe('Hips');
    expect(findings[0].limitation).toContain('hip');
    expect(findings[0].stretches.some(s => s.toLowerCase().includes('hip'))).toBe(true);
  });

  it('recommends thoracic/ankle mobility for excessive forward lean', () => {
    const issues = [makeIssue({ name: 'excessive_forward_lean', severity: 'moderate' })];
    const findings = assessMobility(issues, 'beginner');

    expect(findings.length).toBe(1);
    expect(findings[0].area).toBe('Ankles & Upper Back');
    expect(findings[0].limitation).toContain('ankle');
    expect(findings[0].limitation).toContain('upper back');
  });

  it('handles multiple issues with correct prioritization and no duplicate areas', () => {
    // knee_valgus -> Hip Abductors, good_morning -> Core & Quadriceps
    // Both have different areas, so both should appear
    const issues = [
      makeIssue({ name: 'knee_valgus', severity: 'high' }),
      makeIssue({ name: 'good_morning', severity: 'moderate' }),
    ];
    const findings = assessMobility(issues, 'beginner');

    expect(findings.length).toBe(2);
    const areas = findings.map(f => f.area);
    expect(areas).toContain('Hip Abductors');
    expect(areas).toContain('Core & Quadriceps');
    // No duplicates
    expect(new Set(areas).size).toBe(areas.length);
  });

  it('deduplicates findings by area', () => {
    // If two issues map to the same area, only the first should appear
    // heel_rise -> Ankles, excessive_forward_lean -> Ankles & Thoracic Spine
    // These have different area strings, so both should appear
    const issues = [
      makeIssue({ name: 'heel_rise', severity: 'moderate' }),
      makeIssue({ name: 'excessive_forward_lean', severity: 'moderate' }),
    ];
    const findings = assessMobility(issues, 'beginner');

    expect(findings.length).toBe(2);
    const areas = findings.map(f => f.area);
    // Verify uniqueness
    expect(new Set(areas).size).toBe(areas.length);
  });

  it('returns empty findings for no issues', () => {
    const findings = assessMobility([], 'beginner');
    expect(findings.length).toBe(0);
  });

  it('returns empty findings for unknown issue names', () => {
    const issues = [makeIssue({ name: 'nonexistent_issue', severity: 'high' })];
    const findings = assessMobility(issues, 'beginner');
    expect(findings.length).toBe(0);
  });

  // ── Experience level behavior ──

  it('advanced users skip basic findings with non-high severity', () => {
    // knee_valgus is marked basic: true
    const issues = [makeIssue({ name: 'knee_valgus', severity: 'moderate' })];
    const findings = assessMobility(issues, 'advanced');
    expect(findings.length).toBe(0);
  });

  it('advanced users keep basic findings with high severity', () => {
    const issues = [makeIssue({ name: 'knee_valgus', severity: 'high' })];
    const findings = assessMobility(issues, 'advanced');
    expect(findings.length).toBe(1);
    expect(findings[0].area).toBe('Hip Abductors');
  });

  it('advanced users keep non-basic findings regardless of severity', () => {
    // heel_rise is basic: false
    const issues = [makeIssue({ name: 'heel_rise', severity: 'low' })];
    const findings = assessMobility(issues, 'advanced');
    expect(findings.length).toBe(1);
    expect(findings[0].area).toBe('Ankles');
  });

  it('advanced users get abbreviated descriptions', () => {
    const issues = [makeIssue({ name: 'heel_rise', severity: 'moderate' })];

    const beginnerFindings = assessMobility(issues, 'beginner');
    const advancedFindings = assessMobility(issues, 'advanced');

    // Advanced description should be shorter (brief version)
    expect(advancedFindings[0].limitation.length).toBeLessThan(
      beginnerFindings[0].limitation.length,
    );
  });

  it('advanced users get only top 2 stretches', () => {
    const issues = [makeIssue({ name: 'heel_rise', severity: 'moderate' })];

    const beginnerFindings = assessMobility(issues, 'beginner');
    const advancedFindings = assessMobility(issues, 'advanced');

    expect(beginnerFindings[0].stretches.length).toBe(3);
    expect(advancedFindings[0].stretches.length).toBe(2);
  });

  it('advanced users get empty test for basic items', () => {
    // knee_valgus is basic: true, but only included if severity is high
    const issues = [makeIssue({ name: 'knee_valgus', severity: 'high' })];
    const findings = assessMobility(issues, 'advanced');

    expect(findings.length).toBe(1);
    expect(findings[0].test).toBe('');
  });

  it('intermediate users get full detail like beginners', () => {
    const issues = [makeIssue({ name: 'heel_rise', severity: 'moderate' })];

    const beginnerFindings = assessMobility(issues, 'beginner');
    const intermediateFindings = assessMobility(issues, 'intermediate');

    expect(intermediateFindings[0].limitation).toBe(beginnerFindings[0].limitation);
    expect(intermediateFindings[0].stretches.length).toBe(beginnerFindings[0].stretches.length);
  });

  it('defaults to beginner when no experience level provided', () => {
    const issues = [makeIssue({ name: 'heel_rise', severity: 'moderate' })];
    const findings = assessMobility(issues);

    expect(findings.length).toBe(1);
    expect(findings[0].stretches.length).toBe(3); // Full stretches = beginner
  });
});

// ── generateWarmupProtocol ──

describe('generateWarmupProtocol', () => {
  it('returns base warm-up steps for empty issues', () => {
    const protocol = generateWarmupProtocol([], 'beginner');

    // Should have the 3 base warm-up steps
    expect(protocol.length).toBe(3);
    expect(protocol[0].name).toBe('General Warm-Up');
    expect(protocol[1].name).toBe('Hip Circles');
    expect(protocol[2].name).toBe('Bodyweight Squats');
  });

  it('adds issue-specific steps for heel rise', () => {
    const issues = [makeIssue({ name: 'heel_rise' })];
    const protocol = generateWarmupProtocol(issues, 'beginner');

    expect(protocol.length).toBe(4); // 3 base + 1 issue-specific
    const names = protocol.map(s => s.name);
    expect(names).toContain('Ankle Mobilization');
  });

  it('adds issue-specific steps for butt wink', () => {
    const issues = [makeIssue({ name: 'butt_wink' })];
    const protocol = generateWarmupProtocol(issues, 'beginner');

    const names = protocol.map(s => s.name);
    expect(names).toContain('Hip Opener');
  });

  it('adds issue-specific steps for knee valgus', () => {
    const issues = [makeIssue({ name: 'knee_valgus' })];
    const protocol = generateWarmupProtocol(issues, 'beginner');

    const names = protocol.map(s => s.name);
    expect(names).toContain('Glute Activation');
  });

  it('adds issue-specific steps for excessive forward lean', () => {
    const issues = [makeIssue({ name: 'excessive_forward_lean' })];
    const protocol = generateWarmupProtocol(issues, 'beginner');

    const names = protocol.map(s => s.name);
    expect(names).toContain('Thoracic Spine Mobilization');
  });

  it('adds issue-specific steps for good morning pattern', () => {
    const issues = [makeIssue({ name: 'good_morning' })];
    const protocol = generateWarmupProtocol(issues, 'beginner');

    const names = protocol.map(s => s.name);
    expect(names).toContain('Core Activation');
  });

  it('does not duplicate warm-up steps for repeated issues', () => {
    const issues = [
      makeIssue({ name: 'heel_rise' }),
      makeIssue({ name: 'heel_rise' }),
    ];
    const protocol = generateWarmupProtocol(issues, 'beginner');

    const ankleSteps = protocol.filter(s => s.name === 'Ankle Mobilization');
    expect(ankleSteps.length).toBe(1);
  });

  it('handles multiple different issues', () => {
    const issues = [
      makeIssue({ name: 'heel_rise' }),
      makeIssue({ name: 'knee_valgus' }),
      makeIssue({ name: 'butt_wink' }),
    ];
    const protocol = generateWarmupProtocol(issues, 'beginner');

    // 3 base + 3 issue-specific
    expect(protocol.length).toBe(6);
    const names = protocol.map(s => s.name);
    expect(names).toContain('Ankle Mobilization');
    expect(names).toContain('Glute Activation');
    expect(names).toContain('Hip Opener');
  });

  it('ignores unknown issue names gracefully', () => {
    const issues = [makeIssue({ name: 'nonexistent_issue' })];
    const protocol = generateWarmupProtocol(issues, 'beginner');

    // Only base warm-up steps
    expect(protocol.length).toBe(3);
  });

  // ── Experience level affects warm-up ──

  it('advanced users get abbreviated base warm-up (2 steps)', () => {
    const protocol = generateWarmupProtocol([], 'advanced');

    expect(protocol.length).toBe(2);
    expect(protocol[0].name).toBe('General Warm-Up');
    expect(protocol[1].name).toBe('Dynamic Prep');
  });

  it('advanced users get abbreviated issue-specific steps', () => {
    const issues = [makeIssue({ name: 'heel_rise' })];
    const beginnerProtocol = generateWarmupProtocol(issues, 'beginner');
    const advancedProtocol = generateWarmupProtocol(issues, 'advanced');

    // Advanced base is 2 steps, beginner base is 3 steps
    expect(advancedProtocol.length).toBe(3); // 2 base + 1 issue
    expect(beginnerProtocol.length).toBe(4); // 3 base + 1 issue

    // Advanced issue step should be shorter in description
    const advancedAnkle = advancedProtocol.find(s => s.name === 'Ankle Mob');
    const beginnerAnkle = beginnerProtocol.find(s => s.name === 'Ankle Mobilization');
    expect(advancedAnkle).toBeDefined();
    expect(beginnerAnkle).toBeDefined();
    expect(advancedAnkle!.description.length).toBeLessThan(beginnerAnkle!.description.length);
  });

  it('intermediate users get full base warm-up like beginners', () => {
    const protocol = generateWarmupProtocol([], 'intermediate');

    expect(protocol.length).toBe(3);
    expect(protocol[0].name).toBe('General Warm-Up');
    expect(protocol[1].name).toBe('Hip Circles');
    expect(protocol[2].name).toBe('Bodyweight Squats');
  });

  it('defaults to beginner when no experience level provided', () => {
    const protocol = generateWarmupProtocol([]);
    expect(protocol.length).toBe(3); // Full base warm-up
  });

  it('all steps have required fields populated', () => {
    const issues = [
      makeIssue({ name: 'heel_rise' }),
      makeIssue({ name: 'knee_valgus' }),
    ];
    const protocol = generateWarmupProtocol(issues, 'beginner');

    for (const step of protocol) {
      expect(step.name).toBeTruthy();
      expect(step.description).toBeTruthy();
      expect(step.duration).toBeTruthy();
      expect(step.purpose).toBeTruthy();
    }
  });
});
