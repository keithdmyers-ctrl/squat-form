/**
 * Deadlift live mode strategy.
 * Uses hip angle for phase detection with live-specific re-descending logic.
 * Delegates scoring, issue detection, and cue generation to exercises/deadlift.ts
 * to avoid duplicating that logic.
 */

import { SquatPhase } from './types';
import type {
  FrameAngles,
  CalibrationData,
  SquatConfig,
  RepData,
  RepScore,
  ExperienceLevel,
  DeadliftType,
} from './types';
import type { LiveExerciseStrategy } from './live';
import { clamp, scoreToGrade, scoreTempo } from './scorer';
import type { DeadliftConfig } from './exercises/deadlift';
import {
  scoreBackPosition,
  scoreHipHinge,
  scoreDeadliftLockout,
  scoreDeadliftSymmetry,
  scoreDeadliftControl,
  detectDeadliftIssues,
  getDeadliftCues,
  getDeadliftPositiveFeedback,
  DEADLIFT_WEIGHTS,
  DEADLIFT_COMPETITION_WEIGHTS,
} from './exercises/deadlift';

// ─── Hip-angle driven phase detector (live-specific with re-descending) ───

import { GenericPhaseDetector } from './phase-detector';
import type { PhaseDetectorConfig } from './phase-detector';

const LIVE_DEADLIFT_PHASE_CONFIG: PhaseDetectorConfig = {
  standingAngle: 160,
  descendingThreshold: 2.0,
  bottomVelocityThreshold: 1.5,
  ascendingThreshold: 2.0,
  minRepFrames: 8,
  liveMode: true,
};

// ─── Strategy Implementation ───

export class DeadliftLiveStrategy implements LiveExerciseStrategy {
  exerciseType = 'deadlift';
  standingThreshold = 155;
  noRepsMessage = 'No reps detected. Make sure you complete full deadlifts \u2014 standing, hinge down, and back to standing.';
  private phaseDetector: GenericPhaseDetector;
  private dlType: DeadliftType;
  private experienceLevel: ExperienceLevel;
  private competitionMode: boolean;

  constructor(dlType: DeadliftType = 'conventional', experienceLevel: ExperienceLevel = 'beginner', competitionMode = false) {
    this.phaseDetector = new GenericPhaseDetector(LIVE_DEADLIFT_PHASE_CONFIG);
    this.dlType = dlType;
    this.experienceLevel = experienceLevel;
    this.competitionMode = competitionMode;
  }

  /** Build a DeadliftConfig from the strategy's parameters for use with exercise scoring functions. */
  private getConfig(): DeadliftConfig {
    return {
      deadliftType: this.dlType,
      experienceLevel: this.experienceLevel,
      competitionMode: this.competitionMode,
    };
  }

  detectPhase(angles: FrameAngles): SquatPhase {
    return this.phaseDetector.update(angles.hipAngle);
  }

  isCalibrated(angles: FrameAngles): boolean {
    return angles.hipAngle >= this.standingThreshold;
  }

  calibrationAngle(angles: FrameAngles): number {
    return angles.hipAngle;
  }

  trackingAngle(angles: FrameAngles): number {
    return angles.hipAngle;
  }

  getScoreDimensions(): string[] {
    return ['Hip Hinge', 'Control', 'Back Position', 'Symmetry', 'Tempo', 'Lockout'];
  }

  scoreRep(
    rep: RepData,
    config: SquatConfig,
    calibration: CalibrationData | null,
  ): RepScore {
    const dlConfig = this.getConfig();
    const isCompetition = this.competitionMode;

    const backPosition = scoreBackPosition(rep.maxTrunkAngle, dlConfig, calibration);
    const hipHinge = scoreHipHinge(rep.minHipAngle, dlConfig);
    const lockout = scoreDeadliftLockout(rep, calibration);
    const symmetry = scoreDeadliftSymmetry(rep);
    const tempo = isCompetition ? 100 : scoreTempo(rep.descentDuration, rep.bottomDuration, rep.ascentDuration);
    const control = scoreDeadliftControl(rep);

    const w = isCompetition ? DEADLIFT_COMPETITION_WEIGHTS : DEADLIFT_WEIGHTS;

    const overall = clamp(
      Math.round(
        backPosition * w.backPosition +
        hipHinge * w.hipHinge +
        lockout * w.lockout +
        symmetry * w.symmetry +
        tempo * w.tempo +
        control * w.control,
      ),
      0, 100,
    );

    const issues = detectDeadliftIssues(rep, dlConfig, calibration);
    const cues = getDeadliftCues(issues, this.experienceLevel);
    const positiveFeedback = getDeadliftPositiveFeedback({
      backPosition, hipHinge, lockout, symmetry, tempo, control,
    });

    // Soft penalty for HIGH severity issues
    let totalScore = overall;
    const highCount = issues.filter(i => i.severity === 'high').length;
    if (highCount > 0) totalScore = Math.max(0, totalScore - highCount * 5);

    return {
      depthScore: hipHinge,
      kneeTrackingScore: control,
      trunkScore: backPosition,
      symmetryScore: symmetry,
      tempoScore: tempo,
      lockoutScore: lockout,
      overallScore: totalScore,
      grade: scoreToGrade(totalScore, this.experienceLevel),
      issues,
      cues,
      positiveFeedback,
      stickingPoints: rep.stickingPoints,
      velocity: rep.velocity,
    };
  }

  reset(): void {
    this.phaseDetector.reset();
  }
}
