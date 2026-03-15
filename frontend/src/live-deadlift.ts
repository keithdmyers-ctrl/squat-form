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

const STANDING_HIP_ANGLE = 160;
const DESCENDING_THRESHOLD = 2.0;
const BOTTOM_VELOCITY_THRESHOLD = 1.5;
const ASCENDING_THRESHOLD = 2.0;
const SMOOTHING_WINDOW = 5;
const HISTORY_WINDOW = 3;

function smoothAngle(buffer: number[], newValue: number, windowSize: number): number {
  buffer.push(newValue);
  if (buffer.length > windowSize) buffer.shift();
  return buffer.reduce((sum, v) => sum + v, 0) / buffer.length;
}

class LiveDeadliftPhaseDetector {
  private phase: SquatPhase = SquatPhase.STANDING;
  private smoothBuffer: number[] = [];
  private smoothedHistory: number[] = [];
  private prevSmoothedAngle: number | null = null;
  private bottomHoldCount = 0;

  reset(): void {
    this.phase = SquatPhase.STANDING;
    this.smoothBuffer = [];
    this.smoothedHistory = [];
    this.prevSmoothedAngle = null;
    this.bottomHoldCount = 0;
  }

  private cumulativeDelta(): number {
    if (this.smoothedHistory.length < 2) return 0;
    return this.smoothedHistory[this.smoothedHistory.length - 1] - this.smoothedHistory[0];
  }

  update(hipAngle: number): SquatPhase {
    const smoothed = smoothAngle(this.smoothBuffer, hipAngle, SMOOTHING_WINDOW);
    this.smoothedHistory.push(smoothed);
    if (this.smoothedHistory.length > HISTORY_WINDOW + 1) this.smoothedHistory.shift();

    const delta = this.prevSmoothedAngle !== null ? smoothed - this.prevSmoothedAngle : 0;
    const cumDelta = this.cumulativeDelta();

    switch (this.phase) {
      case SquatPhase.STANDING:
        this.bottomHoldCount = 0;
        if (smoothed < STANDING_HIP_ANGLE && cumDelta < -DESCENDING_THRESHOLD) {
          this.phase = SquatPhase.DESCENDING;
        }
        break;

      case SquatPhase.DESCENDING:
        if (Math.abs(delta) < BOTTOM_VELOCITY_THRESHOLD) {
          this.bottomHoldCount++;
          if (this.bottomHoldCount >= 2) {
            this.phase = SquatPhase.BOTTOM;
            this.bottomHoldCount = 0;
          }
        } else if (delta > 0) {
          this.phase = SquatPhase.BOTTOM;
          this.bottomHoldCount = 0;
        } else {
          this.bottomHoldCount = 0;
        }
        break;

      case SquatPhase.BOTTOM:
        if (cumDelta > ASCENDING_THRESHOLD) {
          this.phase = SquatPhase.ASCENDING;
        }
        break;

      case SquatPhase.ASCENDING:
        if (smoothed >= STANDING_HIP_ANGLE) {
          this.phase = SquatPhase.STANDING;
        } else if (delta < -3) {
          // Live mode: re-descending
          this.phase = SquatPhase.DESCENDING;
          this.bottomHoldCount = 0;
        }
        break;
    }

    this.prevSmoothedAngle = smoothed;
    return this.phase;
  }
}

// ─── Strategy Implementation ───

export class DeadliftLiveStrategy implements LiveExerciseStrategy {
  exerciseType = 'deadlift';
  standingThreshold = 155;
  noRepsMessage = 'No reps detected. Make sure you complete full deadlifts \u2014 standing, hinge down, and back to standing.';
  private phaseDetector: LiveDeadliftPhaseDetector;
  private dlType: DeadliftType;
  private experienceLevel: ExperienceLevel;
  private competitionMode: boolean;

  constructor(dlType: DeadliftType = 'conventional', experienceLevel: ExperienceLevel = 'beginner', competitionMode = false) {
    this.phaseDetector = new LiveDeadliftPhaseDetector();
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
