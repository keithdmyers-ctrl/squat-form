/**
 * Bench press live mode strategy (EXPERIMENTAL).
 * Uses elbow angle for phase detection with live-specific re-descending logic.
 * Delegates scoring, issue detection, and cue generation to exercises/bench.ts
 * to avoid duplicating that logic.
 *
 * Note: Live bench press analysis is experimental. The person is lying
 * horizontally, so pose detection accuracy may be reduced compared to
 * standing exercises. Camera should be positioned at the side.
 */

import { SquatPhase } from './types';
import type {
  FrameAngles,
  CalibrationData,
  SquatConfig,
  RepData,
  RepScore,
  ExperienceLevel,
  BenchType,
} from './types';
import type { LiveExerciseStrategy } from './live';
import { clamp, scoreToGrade } from './scorer';
import type { BenchConfig } from './exercises/bench';
import {
  scoreBenchROM,
  scoreBenchLockout,
  scoreBenchControl,
  scoreBenchSymmetry,
  scoreBenchTempo,
  scoreBenchPause,
  detectBenchIssues,
  getBenchCues,
  getBenchPositiveFeedback,
  BENCH_WEIGHTS,
  BENCH_COMPETITION_WEIGHTS,
} from './exercises/bench';

// ─── Elbow-angle driven phase detector (live-specific with re-descending) ───

const EXTENDED_ELBOW_ANGLE = 155;
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

class LiveBenchPhaseDetector {
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

  update(elbowAngle: number): SquatPhase {
    const smoothed = smoothAngle(this.smoothBuffer, elbowAngle, SMOOTHING_WINDOW);
    this.smoothedHistory.push(smoothed);
    if (this.smoothedHistory.length > HISTORY_WINDOW + 1) this.smoothedHistory.shift();

    const delta = this.prevSmoothedAngle !== null ? smoothed - this.prevSmoothedAngle : 0;
    const cumDelta = this.cumulativeDelta();

    switch (this.phase) {
      case SquatPhase.STANDING: // Arms extended
        this.bottomHoldCount = 0;
        if (smoothed < EXTENDED_ELBOW_ANGLE && cumDelta < -DESCENDING_THRESHOLD) {
          this.phase = SquatPhase.DESCENDING;
        }
        break;

      case SquatPhase.DESCENDING: // Lowering bar
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

      case SquatPhase.BOTTOM: // Bar on chest
        if (cumDelta > ASCENDING_THRESHOLD) {
          this.phase = SquatPhase.ASCENDING;
        }
        break;

      case SquatPhase.ASCENDING: // Pressing
        if (smoothed >= EXTENDED_ELBOW_ANGLE) {
          this.phase = SquatPhase.STANDING;
        } else if (delta < -3) {
          // Live mode: bar coming back down
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

export class BenchLiveStrategy implements LiveExerciseStrategy {
  exerciseType = 'bench_press';
  standingThreshold = 150;
  noRepsMessage = 'No reps detected. Make sure you complete full bench press reps \u2014 arms extended, lower to chest, and press back up.';
  private phaseDetector: LiveBenchPhaseDetector;
  private benchType: BenchType;
  private experienceLevel: ExperienceLevel;
  private competitionMode: boolean;

  constructor(benchType: BenchType = 'flat', experienceLevel: ExperienceLevel = 'beginner', competitionMode = false) {
    this.phaseDetector = new LiveBenchPhaseDetector();
    this.benchType = benchType;
    this.experienceLevel = experienceLevel;
    this.competitionMode = competitionMode;
  }

  /** Build a BenchConfig from the strategy's parameters for use with exercise scoring functions. */
  private getConfig(): BenchConfig {
    return {
      benchType: this.benchType,
      experienceLevel: this.experienceLevel,
      competitionMode: this.competitionMode,
    };
  }

  detectPhase(angles: FrameAngles): SquatPhase {
    return this.phaseDetector.update(angles.elbowAngle ?? 180);
  }

  isCalibrated(angles: FrameAngles): boolean {
    return (angles.elbowAngle ?? 180) >= this.standingThreshold;
  }

  calibrationAngle(angles: FrameAngles): number {
    return angles.elbowAngle ?? 180;
  }

  trackingAngle(angles: FrameAngles): number {
    return angles.elbowAngle ?? 180;
  }

  getScoreDimensions(): string[] {
    return ['Range of Motion', 'Control', 'Pause', 'Symmetry', 'Tempo', 'Lockout'];
  }

  scoreRep(
    rep: RepData,
    config: SquatConfig,
    calibration: CalibrationData | null,
  ): RepScore {
    const benchConfig = this.getConfig();
    const isCompetition = this.competitionMode;

    const minElbow = Math.min(...rep.frameAngles.map(fa => fa.elbowAngle ?? 180));
    const rom = scoreBenchROM(minElbow, benchConfig);
    const lockout = scoreBenchLockout(rep);
    const control = scoreBenchControl(rep);
    const symmetry = scoreBenchSymmetry(rep);
    const tempo = isCompetition ? 100 : scoreBenchTempo(rep.descentDuration, rep.ascentDuration);
    const pause = scoreBenchPause(rep.bottomDuration, benchConfig);

    const w = isCompetition ? BENCH_COMPETITION_WEIGHTS : BENCH_WEIGHTS;

    const overall = clamp(
      Math.round(
        rom * w.rom +
        lockout * w.lockout +
        control * w.control +
        symmetry * w.symmetry +
        tempo * w.tempo +
        pause * w.pause,
      ),
      0, 100,
    );

    const issues = detectBenchIssues(rep, benchConfig);
    const cues = getBenchCues(issues, this.experienceLevel);
    const positiveFeedback = getBenchPositiveFeedback({
      rom, lockout, control, symmetry, tempo, pause,
    });

    let totalScore = overall;
    const highCount = issues.filter(i => i.severity === 'high').length;
    if (highCount > 0) totalScore = Math.max(0, totalScore - highCount * 5);

    return {
      depthScore: rom,
      kneeTrackingScore: control,
      trunkScore: pause,
      symmetryScore: symmetry,
      tempoScore: tempo,
      lockoutScore: lockout,
      overallScore: totalScore,
      grade: scoreToGrade(totalScore, this.experienceLevel),
      issues,
      cues,
      positiveFeedback,
      stickingPoints: [],
      velocity: rep.velocity,
    };
  }

  reset(): void {
    this.phaseDetector.reset();
  }
}
