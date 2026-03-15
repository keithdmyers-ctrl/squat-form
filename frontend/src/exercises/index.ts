/**
 * Exercise routing: dispatches analysis to the correct exercise-specific analyzer.
 */

import type {
  ExerciseType,
  DeadliftType,
  BenchType,
  OverheadPressType,
  SquatType,
  ExperienceLevel,
  FrameData,
  SetAnalysis,
} from '../types';
import { analyzeSequence } from '../analyzer';
import { analyzeDeadliftSequence } from './deadlift';
import type { DeadliftConfig } from './deadlift';
import { analyzeBenchSequence } from './bench';
import type { BenchConfig } from './bench';
import { analyzeOHPSequence } from './overhead-press';
import type { OverheadPressConfig } from './overhead-press';

export interface ExerciseConfig {
  exerciseType: ExerciseType;
  experienceLevel: ExperienceLevel;
  competitionMode: boolean;
  // Exercise-specific variant
  squatType?: SquatType;
  deadliftType?: DeadliftType;
  benchType?: BenchType;
  ohpType?: OverheadPressType;
}

/**
 * Analyze a set of any exercise type.
 * Routes to the appropriate exercise-specific analyzer.
 */
export function analyzeExercise(
  frames: FrameData,
  fps: number,
  config: ExerciseConfig,
): SetAnalysis {
  switch (config.exerciseType) {
    case 'deadlift': {
      const dlConfig: DeadliftConfig = {
        deadliftType: config.deadliftType ?? 'conventional',
        experienceLevel: config.experienceLevel,
        competitionMode: config.competitionMode,
      };
      return analyzeDeadliftSequence(frames, fps, dlConfig);
    }

    case 'bench_press': {
      const benchConfig: BenchConfig = {
        benchType: config.benchType ?? 'flat',
        experienceLevel: config.experienceLevel,
        competitionMode: config.competitionMode,
      };
      return analyzeBenchSequence(frames, fps, benchConfig);
    }

    case 'overhead_press': {
      const ohpConfig: OverheadPressConfig = {
        ohpType: config.ohpType ?? 'strict',
        experienceLevel: config.experienceLevel,
        competitionMode: config.competitionMode,
      };
      return analyzeOHPSequence(frames, fps, ohpConfig);
    }

    case 'squat':
    default: {
      return analyzeSequence(frames, fps, {
        squatType: config.squatType ?? 'bodyweight',
        experienceLevel: config.experienceLevel,
        competitionMode: config.competitionMode,
      });
    }
  }
}

/** Display labels for exercise types. */
export const EXERCISE_LABELS: Record<ExerciseType, string> = {
  squat: 'Squat',
  deadlift: 'Deadlift',
  bench_press: 'Bench Press',
  overhead_press: 'Overhead Press',
};

/** Display labels for deadlift variants. */
export const DEADLIFT_LABELS: Record<DeadliftType, string> = {
  conventional: 'Conventional',
  sumo: 'Sumo',
  romanian: 'Romanian (RDL)',
};

/** Display labels for bench variants. */
export const BENCH_LABELS: Record<BenchType, string> = {
  flat: 'Flat Bench',
  close_grip: 'Close Grip',
  wide_grip: 'Wide Grip',
};

/** Display labels for overhead press variants. */
export const OHP_LABELS: Record<OverheadPressType, string> = {
  strict: 'Strict Press',
  push_press: 'Push Press',
  behind_neck: 'Behind the Neck',
};
