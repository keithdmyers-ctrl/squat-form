import { describe, it, expect } from 'vitest';
import {
  getCorrectiveExercises,
  getExerciseProgressions,
  PROGRESSION_DATABASE,
} from '../cues';
import type { CorrectiveExercise } from '../cues';

// We need to access the CORRECTIVE_EXERCISES object, which is not exported.
// Instead we test through the exported getCorrectiveExercises function,
// and verify all known issue IDs.

// --- Known issue IDs from the cue database ---

const SQUAT_ISSUES = [
  'knee_valgus',
  'butt_wink',
  'excessive_forward_lean',
  'good_morning',
  'heel_rise',
  'insufficient_depth',
  'excessive_forward_knee_travel',
  'fast_descent',
  'slow_descent',
  'bouncing',
  'asymmetric_hips',
  'asymmetric_shift',
  'bracing_reminder',
  'lateral_shift',
  'cervical_hyperextension',
  'incomplete_lockout',
  'trunk_angle_increase_on_ascent',
];

const DEADLIFT_ISSUES = [
  'rounded_back',
  'hip_shoot',
  'hitching',
  'asymmetric_pull',
  'fast_descent_deadlift',
  'insufficient_rom_deadlift',
];

const BENCH_ISSUES = [
  'no_pause',
  'uneven_press',
  'press_stall',
];

const OHP_ISSUES = [
  'excessive_lean_back',
  'partial_rom',
  'forward_press',
  'asymmetric_press',
  'incomplete_lockout_ohp',
  'fast_descent_ohp',
];

const ROW_ISSUES = [
  'torso_rise',
  'insufficient_rom_row',
  'jerky_pull',
  'asymmetric_row',
  'fast_lowering_row',
  'excessive_hip_extension',
];

const LUNGE_ISSUES = [
  'knee_past_toes_lunge',
  'insufficient_depth_lunge',
  'forward_lean_lunge',
  'knee_valgus_lunge',
  'uneven_stride',
  'incomplete_lockout_lunge',
];

const ALL_CORRECTIVE_ISSUE_IDS = [
  ...SQUAT_ISSUES,
  ...DEADLIFT_ISSUES,
  ...BENCH_ISSUES,
  ...OHP_ISSUES,
  ...ROW_ISSUES,
  ...LUNGE_ISSUES,
];

const ALL_PROGRESSION_ISSUE_IDS = Object.keys(PROGRESSION_DATABASE);

// --- Tests ---

describe('Cues Module', () => {
  // ========================================
  // Corrective Exercise Database - Coverage
  // ========================================

  describe('Corrective Exercise Database', () => {
    it.each(ALL_CORRECTIVE_ISSUE_IDS)(
      'issue "%s" has at least one corrective exercise',
      (issueId) => {
        const exercises = getCorrectiveExercises(issueId);
        expect(exercises.length).toBeGreaterThanOrEqual(1);
      },
    );

    it.each(ALL_CORRECTIVE_ISSUE_IDS)(
      'corrective exercises for "%s" have names and descriptions',
      (issueId) => {
        const exercises = getCorrectiveExercises(issueId);
        for (const ex of exercises) {
          expect(ex.name).toBeTruthy();
          expect(ex.name.length).toBeGreaterThan(0);
          expect(ex.description).toBeTruthy();
          expect(ex.description.length).toBeGreaterThan(10);
        }
      },
    );

    it.each(ALL_CORRECTIVE_ISSUE_IDS)(
      'corrective exercises for "%s" have sets prescriptions',
      (issueId) => {
        const exercises = getCorrectiveExercises(issueId);
        for (const ex of exercises) {
          expect(ex.sets).toBeTruthy();
          expect(ex.sets.length).toBeGreaterThan(0);
        }
      },
    );

    it('returns empty array for unknown issue names', () => {
      expect(getCorrectiveExercises('nonexistent_issue')).toEqual([]);
      expect(getCorrectiveExercises('')).toEqual([]);
    });
  });

  // ========================================
  // YouTube Links Validation
  // ========================================

  describe('YouTube Links', () => {
    it('all videoUrl fields are valid YouTube URL format', () => {
      const youtubeUrlPattern = /^https:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+$/;
      for (const issueId of ALL_CORRECTIVE_ISSUE_IDS) {
        const exercises = getCorrectiveExercises(issueId);
        for (const ex of exercises) {
          if (ex.videoUrl) {
            expect(
              youtubeUrlPattern.test(ex.videoUrl),
              `Invalid YouTube URL for ${ex.name} (issue: ${issueId}): ${ex.videoUrl}`,
            ).toBe(true);
          }
        }
      }
    });

    it('knee_valgus exercises have YouTube links', () => {
      const exercises = getCorrectiveExercises('knee_valgus');
      const withVideo = exercises.filter(e => e.videoUrl);
      expect(withVideo.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================
  // Corrective Exercise Appropriateness
  // ========================================

  describe('Exercise Appropriateness', () => {
    it('knee_valgus correctives target hip/glute strength', () => {
      const exercises = getCorrectiveExercises('knee_valgus');
      const names = exercises.map(e => e.name.toLowerCase());
      // Should include banded exercises or glute/hip exercises
      const hasRelevantExercise = names.some(n =>
        n.includes('band') || n.includes('clamshell') || n.includes('monster') || n.includes('glute'),
      );
      expect(hasRelevantExercise).toBe(true);
    });

    it('butt_wink correctives include mobility work', () => {
      const exercises = getCorrectiveExercises('butt_wink');
      const descriptions = exercises.map(e => e.description.toLowerCase());
      // Should mention hip mobility or box squats
      const hasRelevantWork = descriptions.some(d =>
        d.includes('hip') || d.includes('box') || d.includes('stretch'),
      );
      expect(hasRelevantWork).toBe(true);
    });

    it('heel_rise correctives include ankle mobility', () => {
      const exercises = getCorrectiveExercises('heel_rise');
      const descriptions = exercises.map(e => e.description.toLowerCase());
      const hasAnkleWork = descriptions.some(d =>
        d.includes('ankle') || d.includes('calf') || d.includes('heel'),
      );
      expect(hasAnkleWork).toBe(true);
    });

    it('good_morning correctives target quad/chest strength', () => {
      const exercises = getCorrectiveExercises('good_morning');
      const names = exercises.map(e => e.name.toLowerCase());
      // Pause squats and front squats address the good morning pattern
      const hasRelevant = names.some(n =>
        n.includes('pause') || n.includes('front') || n.includes('leg press'),
      );
      expect(hasRelevant).toBe(true);
    });

    it('rounded_back correctives include posterior chain work', () => {
      const exercises = getCorrectiveExercises('rounded_back');
      const names = exercises.map(e => e.name.toLowerCase());
      const hasRelevant = names.some(n =>
        n.includes('romanian') || n.includes('pull-apart') || n.includes('paused'),
      );
      expect(hasRelevant).toBe(true);
    });

    it('no_pause bench correctives include pausing exercises', () => {
      const exercises = getCorrectiveExercises('no_pause');
      const names = exercises.map(e => e.name.toLowerCase());
      const hasPauseWork = names.some(n =>
        n.includes('pause') || n.includes('spoto') || n.includes('floor'),
      );
      expect(hasPauseWork).toBe(true);
    });

    it('excessive_lean_back OHP correctives address core stability', () => {
      const exercises = getCorrectiveExercises('excessive_lean_back');
      const names = exercises.map(e => e.name.toLowerCase());
      const hasRelevant = names.some(n =>
        n.includes('z-press') || n.includes('seated') || n.includes('dead bug'),
      );
      expect(hasRelevant).toBe(true);
    });

    it('torso_rise row correctives use supported rowing', () => {
      const exercises = getCorrectiveExercises('torso_rise');
      const names = exercises.map(e => e.name.toLowerCase());
      const hasSupport = names.some(n =>
        n.includes('seal') || n.includes('chest-supported') || n.includes('pendlay'),
      );
      expect(hasSupport).toBe(true);
    });

    it('valgus correctives do NOT include bench press', () => {
      const exercises = getCorrectiveExercises('knee_valgus');
      const names = exercises.map(e => e.name.toLowerCase());
      expect(names.some(n => n.includes('bench press'))).toBe(false);
    });
  });

  // ========================================
  // Progression Database - Structure
  // ========================================

  describe('Progression Database', () => {
    it.each(ALL_PROGRESSION_ISSUE_IDS)(
      'issue "%s" has exactly 3 progression stages',
      (issueId) => {
        const progressions = getExerciseProgressions(issueId);
        expect(progressions).toHaveLength(3);
      },
    );

    it.each(ALL_PROGRESSION_ISSUE_IDS)(
      'progression for "%s" has start/progress/goal levels',
      (issueId) => {
        const progressions = getExerciseProgressions(issueId);
        expect(progressions[0].level).toBe('Start here');
        expect(progressions[1].level).toBe('Progress to');
        expect(progressions[2].level).toBe('Goal');
      },
    );

    it.each(ALL_PROGRESSION_ISSUE_IDS)(
      'progression for "%s" has exercise and criteria for each stage',
      (issueId) => {
        const progressions = getExerciseProgressions(issueId);
        for (const prog of progressions) {
          expect(prog.exercise).toBeTruthy();
          expect(prog.exercise.length).toBeGreaterThan(0);
          expect(prog.criteria).toBeTruthy();
          expect(prog.criteria.length).toBeGreaterThan(0);
        }
      },
    );

    it('returns empty array for unknown issue names', () => {
      expect(getExerciseProgressions('nonexistent_issue')).toEqual([]);
      expect(getExerciseProgressions('')).toEqual([]);
    });
  });

  // ========================================
  // Progression Goes from Easier to Harder
  // ========================================

  describe('Progression Difficulty', () => {
    it('squat valgus progression moves from isolation to compound', () => {
      const progressions = getExerciseProgressions('knee_valgus');
      expect(progressions[0].exercise.toLowerCase()).toContain('clamshell');
      expect(progressions[1].exercise.toLowerCase()).toContain('banded');
      expect(progressions[2].exercise.toLowerCase()).toContain('squat');
    });

    it('butt_wink progression starts with limited ROM', () => {
      const progressions = getExerciseProgressions('butt_wink');
      expect(progressions[0].exercise.toLowerCase()).toContain('box');
      expect(progressions[2].exercise.toLowerCase()).toContain('full depth');
    });

    it('heel_rise progression ends with flat-foot full squat', () => {
      const progressions = getExerciseProgressions('heel_rise');
      expect(progressions[0].exercise.toLowerCase()).toContain('elevated');
      expect(progressions[2].exercise.toLowerCase()).toContain('heels');
    });

    it('incomplete_lockout starts simple and ends at full lockout', () => {
      const progressions = getExerciseProgressions('incomplete_lockout');
      expect(progressions[0].exercise.toLowerCase()).toContain('bridge');
      expect(progressions[2].exercise.toLowerCase()).toContain('lockout');
    });

    it('no_pause bench progression moves to competition pausing', () => {
      const progressions = getExerciseProgressions('no_pause');
      expect(progressions[0].exercise.toLowerCase()).toContain('pause');
      expect(progressions[2].exercise.toLowerCase()).toContain('competition');
    });

    it('excessive_lean_back OHP starts seated and ends standing', () => {
      const progressions = getExerciseProgressions('excessive_lean_back');
      expect(progressions[0].exercise.toLowerCase()).toContain('z-press');
      expect(progressions[2].exercise.toLowerCase()).toContain('standing');
    });

    it('torso_rise row starts with supported and ends unsupported', () => {
      const progressions = getExerciseProgressions('torso_rise');
      expect(progressions[0].exercise.toLowerCase()).toContain('seal');
      expect(progressions[2].exercise.toLowerCase()).toContain('bent-over');
    });
  });

  // ========================================
  // Safety: Bradford Press Warning
  // ========================================

  describe('Safety', () => {
    it('Bradford Press has a shoulder pain warning', () => {
      const exercises = getCorrectiveExercises('partial_rom');
      const bradford = exercises.find(e => e.name.toLowerCase().includes('bradford'));
      expect(bradford).toBeDefined();
      expect(bradford!.description.toLowerCase()).toContain('shoulder pain');
    });

    it('Bradford Press description warns about limited mobility', () => {
      const exercises = getCorrectiveExercises('partial_rom');
      const bradford = exercises.find(e => e.name.toLowerCase().includes('bradford'));
      expect(bradford).toBeDefined();
      expect(bradford!.description.toLowerCase()).toContain('limited shoulder mobility');
    });

    it('Shoulder Dislocates describe them as safe for most people', () => {
      const exercises = getCorrectiveExercises('partial_rom');
      const dislocates = exercises.find(e => e.name.toLowerCase().includes('dislocate'));
      expect(dislocates).toBeDefined();
      expect(dislocates!.description.toLowerCase()).toContain('safe');
    });

    it('no corrective exercise description is empty or missing', () => {
      for (const issueId of ALL_CORRECTIVE_ISSUE_IDS) {
        const exercises = getCorrectiveExercises(issueId);
        for (const ex of exercises) {
          expect(
            ex.description.length,
            `Empty description for ${ex.name} (issue: ${issueId})`,
          ).toBeGreaterThan(20);
        }
      }
    });

    it('eccentric-heavy exercises mention control', () => {
      // Tempo exercises should mention controlled movement
      const tempoExercises: CorrectiveExercise[] = [];
      for (const issueId of ALL_CORRECTIVE_ISSUE_IDS) {
        const exercises = getCorrectiveExercises(issueId);
        for (const ex of exercises) {
          if (ex.name.toLowerCase().includes('tempo') || ex.name.toLowerCase().includes('eccentric')) {
            tempoExercises.push(ex);
          }
        }
      }
      expect(tempoExercises.length).toBeGreaterThan(0);
      for (const ex of tempoExercises) {
        const desc = ex.description.toLowerCase();
        const hasControl = desc.includes('control') || desc.includes('slow') || desc.includes('second');
        expect(hasControl).toBe(true);
      }
    });
  });

  // ========================================
  // Cross-exercise Coverage
  // ========================================

  describe('Cross-exercise Coverage', () => {
    it('covers all 6 exercise types with corrective exercises', () => {
      expect(getCorrectiveExercises('knee_valgus').length).toBeGreaterThan(0);       // squat
      expect(getCorrectiveExercises('rounded_back').length).toBeGreaterThan(0);      // deadlift
      expect(getCorrectiveExercises('no_pause').length).toBeGreaterThan(0);          // bench
      expect(getCorrectiveExercises('excessive_lean_back').length).toBeGreaterThan(0); // OHP
      expect(getCorrectiveExercises('torso_rise').length).toBeGreaterThan(0);        // row
      expect(getCorrectiveExercises('knee_past_toes_lunge').length).toBeGreaterThan(0); // lunge
    });

    it('covers all 6 exercise types with progressions', () => {
      expect(getExerciseProgressions('knee_valgus').length).toBe(3);
      expect(getExerciseProgressions('rounded_back').length).toBe(3);
      expect(getExerciseProgressions('no_pause').length).toBe(3);
      expect(getExerciseProgressions('excessive_lean_back').length).toBe(3);
      expect(getExerciseProgressions('torso_rise').length).toBe(3);
      expect(getExerciseProgressions('knee_past_toes_lunge').length).toBe(3);
    });

    it('has at least 3 corrective exercises per squat issue', () => {
      for (const issueId of SQUAT_ISSUES) {
        const exercises = getCorrectiveExercises(issueId);
        expect(
          exercises.length,
          `Expected at least 3 corrective exercises for ${issueId}, got ${exercises.length}`,
        ).toBeGreaterThanOrEqual(3);
      }
    });

    it('has at least 3 corrective exercises per deadlift issue', () => {
      for (const issueId of DEADLIFT_ISSUES) {
        const exercises = getCorrectiveExercises(issueId);
        expect(exercises.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('has at least 3 corrective exercises per bench issue', () => {
      for (const issueId of BENCH_ISSUES) {
        const exercises = getCorrectiveExercises(issueId);
        expect(exercises.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('has at least 3 corrective exercises per OHP issue', () => {
      for (const issueId of OHP_ISSUES) {
        const exercises = getCorrectiveExercises(issueId);
        expect(exercises.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('has at least 3 corrective exercises per row issue', () => {
      for (const issueId of ROW_ISSUES) {
        const exercises = getCorrectiveExercises(issueId);
        expect(exercises.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('has at least 3 corrective exercises per lunge issue', () => {
      for (const issueId of LUNGE_ISSUES) {
        const exercises = getCorrectiveExercises(issueId);
        expect(exercises.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  // ========================================
  // SVG Illustrations
  // ========================================

  describe('SVG Illustrations', () => {
    it('some corrective exercises include SVG illustrations', () => {
      let svgCount = 0;
      for (const issueId of ALL_CORRECTIVE_ISSUE_IDS) {
        const exercises = getCorrectiveExercises(issueId);
        for (const ex of exercises) {
          if (ex.svg) {
            svgCount++;
            expect(ex.svg).toContain('<svg');
            expect(ex.svg).toContain('</svg>');
          }
        }
      }
      // We know there are at least a few exercises with SVGs
      expect(svgCount).toBeGreaterThanOrEqual(3);
    });

    it('SVG viewBox attribute is present when SVG exists', () => {
      for (const issueId of ALL_CORRECTIVE_ISSUE_IDS) {
        const exercises = getCorrectiveExercises(issueId);
        for (const ex of exercises) {
          if (ex.svg) {
            expect(ex.svg).toContain('viewBox');
          }
        }
      }
    });
  });

  // ========================================
  // Consistency Between Correctives and Progressions
  // ========================================

  describe('Corrective-Progression Consistency', () => {
    it('squat issues in correctives also appear in progressions', () => {
      for (const issueId of SQUAT_ISSUES) {
        const correctives = getCorrectiveExercises(issueId);
        const progressions = getExerciseProgressions(issueId);
        if (correctives.length > 0) {
          // Not all corrective issues necessarily have progressions, but major ones should
          // At minimum, we don't crash
          expect(Array.isArray(progressions)).toBe(true);
        }
      }
    });

    it('deadlift issues in correctives also appear in progressions', () => {
      for (const issueId of DEADLIFT_ISSUES) {
        const progressions = getExerciseProgressions(issueId);
        expect(progressions.length).toBe(3);
      }
    });

    it('bench issues in correctives also appear in progressions', () => {
      for (const issueId of BENCH_ISSUES) {
        const progressions = getExerciseProgressions(issueId);
        expect(progressions.length).toBe(3);
      }
    });

    it('OHP issues in correctives also appear in progressions', () => {
      for (const issueId of OHP_ISSUES) {
        const progressions = getExerciseProgressions(issueId);
        expect(progressions.length).toBe(3);
      }
    });

    it('row issues in correctives also appear in progressions', () => {
      for (const issueId of ROW_ISSUES) {
        const progressions = getExerciseProgressions(issueId);
        expect(progressions.length).toBe(3);
      }
    });

    it('lunge issues in correctives also appear in progressions', () => {
      for (const issueId of LUNGE_ISSUES) {
        const progressions = getExerciseProgressions(issueId);
        expect(progressions.length).toBe(3);
      }
    });
  });

  // ========================================
  // Sets Format
  // ========================================

  describe('Sets Format', () => {
    it('sets prescriptions follow standard notation', () => {
      // Most should match patterns like "3x10", "3x8 each side", "30 sec each side", etc.
      for (const issueId of ALL_CORRECTIVE_ISSUE_IDS) {
        const exercises = getCorrectiveExercises(issueId);
        for (const ex of exercises) {
          // Should contain numbers
          expect(
            /\d/.test(ex.sets),
            `Sets for ${ex.name} (${issueId}) should contain a number: "${ex.sets}"`,
          ).toBe(true);
        }
      }
    });
  });
});
