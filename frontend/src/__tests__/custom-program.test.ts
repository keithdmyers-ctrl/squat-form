import { describe, it, expect } from 'vitest';
import { parseExerciseLine, parseProgramText, buildCustomProgram, resolveExerciseSlot } from '../custom-program';

describe('Custom Program Builder', () => {
  describe('resolveExerciseSlot', () => {
    it('should resolve common exercise names', () => {
      expect(resolveExerciseSlot('Squat')).toBe('squat');
      expect(resolveExerciseSlot('bench press')).toBe('bench');
      expect(resolveExerciseSlot('Deadlift')).toBe('deadlift');
      expect(resolveExerciseSlot('OHP')).toBe('ohp');
      expect(resolveExerciseSlot('Barbell Row')).toBe('row');
      expect(resolveExerciseSlot('Pull-up')).toBe('pullup');
      expect(resolveExerciseSlot('RDL')).toBe('rdl');
      expect(resolveExerciseSlot('close grip bench')).toBe('close_grip_bench');
    });
  });

  describe('parseExerciseLine', () => {
    it('should parse basic exercise line', () => {
      const result = parseExerciseLine('Squat 3x5');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Squat');
      expect(result!.sets).toBe(3);
      expect(result!.reps).toBe('5');
      expect(result!.slot).toBe('squat');
    });

    it('should parse RPE', () => {
      const result = parseExerciseLine('Bench Press 3x5 @ RPE 8');
      expect(result!.rpe).toBe(8);
      expect(result!.slot).toBe('bench');
    });

    it('should parse percentage', () => {
      const result = parseExerciseLine('Squat 3x5 @80% 1RM');
      expect(result!.intensityPct).toBe(80);
    });

    it('should parse frequency', () => {
      const result = parseExerciseLine('Squat 3x5, 2x/week');
      expect(result!.frequency).toBe(2);
    });

    it('should parse starting weight', () => {
      const result = parseExerciseLine('Squat 3x5, start 185 lbs');
      expect(result!.startWeight).toBe(185);
      expect(result!.unit).toBe('lbs');
    });

    it('should parse weekly increase', () => {
      const result = parseExerciseLine('Squat 3x5, increase 5 lbs/week');
      expect(result!.weeklyIncrease).toBe(5);
    });

    it('should parse complex line', () => {
      const result = parseExerciseLine('Squat 3x5 @ RPE 8, 2x/week, start 185 lbs, increase 5 lbs/week');
      expect(result!.name).toBe('Squat');
      expect(result!.sets).toBe(3);
      expect(result!.reps).toBe('5');
      expect(result!.rpe).toBe(8);
      expect(result!.frequency).toBe(2);
      expect(result!.startWeight).toBe(185);
      expect(result!.weeklyIncrease).toBe(5);
    });

    it('should parse rep ranges', () => {
      const result = parseExerciseLine('Rows 3x8-10');
      expect(result!.reps).toBe('8-10');
    });

    it('should skip comments and empty lines', () => {
      expect(parseExerciseLine('')).toBeNull();
      expect(parseExerciseLine('# This is a comment')).toBeNull();
      expect(parseExerciseLine('// Another comment')).toBeNull();
    });
  });

  describe('parseProgramText', () => {
    it('should parse a full program description', () => {
      const text = `
        name: My Strength Program
        level: beginner
        goal: strength
        4 days/week
        deload every 4 weeks

        Squat 3x5 @ RPE 8, 2x/week, start 185 lbs, increase 5 lbs/week
        Bench Press 3x5 @ RPE 8, 2x/week, start 135 lbs, increase 5 lbs/week
        Deadlift 1x5 @ RPE 8, 1x/week, start 225 lbs, increase 5 lbs/week
        OHP 3x5 @ RPE 7, 1x/week, start 95 lbs, increase 2.5 lbs/week
        Rows 3x8, 2x/week
      `;

      const config = parseProgramText(text);
      expect(config.name).toBe('My Strength Program');
      expect(config.daysPerWeek).toBe(4);
      expect(config.deloadFrequency).toBe(4);
      expect(config.level).toBe('beginner');
      expect(config.goal).toBe('strength');
      expect(config.exercises.length).toBe(5);
      expect(config.exercises[0].name).toBe('Squat');
      expect(config.exercises[0].startWeight).toBe(185);
    });
  });

  describe('buildCustomProgram', () => {
    it('should build a valid ProgramDefinition', () => {
      const config = parseProgramText(`
        3 days/week
        Squat 3x5 @ RPE 8, 2x/week, start 185 lbs, increase 5 lbs/week
        Bench 3x5 @ RPE 8, 1x/week, start 135 lbs
        Deadlift 1x5, 1x/week, start 225 lbs
      `);

      const program = buildCustomProgram(config);
      expect(program.id).toContain('custom_');
      expect(program.workouts.length).toBe(3);
      expect(program.daysPerWeek).toEqual([3]);
      expect(program.progression.type).toBe('rpe_autoregulated');
      expect(program.progression.description).toContain('Squat: +5');
    });

    it('should distribute exercises across days by frequency', () => {
      const config = parseProgramText(`
        3 days/week
        Squat 3x5, 3x/week
        Bench 3x5, 2x/week
        Deadlift 1x5, 1x/week
      `);

      const program = buildCustomProgram(config);
      // Squat should appear on all 3 days
      const squatDays = program.workouts.filter(w =>
        w.exercises.some(e => e.exerciseSlot === 'squat')
      );
      expect(squatDays.length).toBe(3);

      // Deadlift should appear on 1 day
      const dlDays = program.workouts.filter(w =>
        w.exercises.some(e => e.exerciseSlot === 'deadlift')
      );
      expect(dlDays.length).toBe(1);
    });
  });
});
