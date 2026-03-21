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
import type { BenchConfig, BenchPauseResult } from './exercises/bench';
import {
  scoreBenchROM,
  scoreBenchLockout,
  scoreBenchControl,
  scoreBenchSymmetry,
  scoreBenchTempo,
  scoreBenchPause,
  scoreBenchPauseDetailed,
  detectBenchPause,
  detectBenchIssues,
  getBenchCues,
  getBenchPositiveFeedback,
  BENCH_WEIGHTS,
  BENCH_COMPETITION_WEIGHTS,
} from './exercises/bench';

// ─── Elbow-angle driven phase detector (live-specific with re-descending) ───

import { GenericPhaseDetector } from './phase-detector';
import type { PhaseDetectorConfig } from './phase-detector';

const LIVE_BENCH_PHASE_CONFIG: PhaseDetectorConfig = {
  standingAngle: 155,
  descendingThreshold: 2.0,
  bottomVelocityThreshold: 1.5,
  ascendingThreshold: 2.0,
  minRepFrames: 6,
  liveMode: true,
};

// ─── Live Pause Tracker ───

/** Minimum frames at bottom to show "HOLD" in live mode. */
const LIVE_HOLD_DISPLAY_FRAMES = 2;
/** Minimum pause duration (seconds) before showing "PRESS!" command. */
const LIVE_PRESS_COMMAND_THRESHOLD_S = 1.0;

/**
 * Tracks pause state in real-time during the BOTTOM phase of a live bench rep.
 * Counts consecutive low-velocity frames and provides visual cue state.
 */
export class LivePauseTracker {
  /** Number of consecutive low-velocity frames at bottom. */
  private pauseFrameCount = 0;
  /** Elbow angles collected during the current bottom phase. */
  private bottomElbowAngles: number[] = [];
  /** Whether we're currently tracking a bottom phase. */
  private inBottom = false;
  /** The last pause result computed when leaving bottom. */
  private lastPauseResult: BenchPauseResult | null = null;
  /** Estimated FPS for converting frames to time. */
  private fps = 30;

  /** Start tracking a new bottom phase. */
  enterBottom(fps: number): void {
    this.inBottom = true;
    this.pauseFrameCount = 0;
    this.bottomElbowAngles = [];
    this.fps = fps > 0 ? fps : 30;
  }

  /** Record a frame while in the bottom phase. */
  recordFrame(elbowAngle: number): void {
    if (!this.inBottom) return;
    this.bottomElbowAngles.push(elbowAngle);
    const n = this.bottomElbowAngles.length;
    if (n >= 2) {
      const delta = Math.abs(this.bottomElbowAngles[n - 1] - this.bottomElbowAngles[n - 2]);
      if (delta < 1.5) {
        this.pauseFrameCount++;
      } else {
        this.pauseFrameCount = 0;
      }
    } else {
      this.pauseFrameCount = 1; // First frame counts
    }
  }

  /** Leave the bottom phase and finalize the pause result. */
  leaveBottom(): BenchPauseResult | null {
    if (!this.inBottom) return this.lastPauseResult;
    this.inBottom = false;
    if (this.bottomElbowAngles.length < 2) {
      this.lastPauseResult = null;
      return null;
    }
    // Use the same detection logic as the offline analyzer
    const bottomRelIdx = this.bottomElbowAngles.reduce(
      (minI, a, i, arr) => (a < arr[minI] ? i : minI), 0,
    );
    this.lastPauseResult = detectBenchPause(this.bottomElbowAngles, bottomRelIdx, this.fps);
    return this.lastPauseResult;
  }

  /** Get the current pause duration in seconds (while still at bottom). */
  getCurrentPauseDurationS(): number {
    return this.fps > 0 ? this.pauseFrameCount / this.fps : 0;
  }

  /** Should we display "HOLD" to the user? */
  shouldShowHold(): boolean {
    return this.inBottom && this.pauseFrameCount >= LIVE_HOLD_DISPLAY_FRAMES;
  }

  /** Should we display "PRESS!" (referee command simulation)? */
  shouldShowPress(): boolean {
    return this.inBottom && this.getCurrentPauseDurationS() >= LIVE_PRESS_COMMAND_THRESHOLD_S;
  }

  /** Get the most recently computed pause result (from the last completed rep). */
  getLastPauseResult(): BenchPauseResult | null {
    return this.lastPauseResult;
  }

  /** Reset all state. */
  reset(): void {
    this.pauseFrameCount = 0;
    this.bottomElbowAngles = [];
    this.inBottom = false;
    this.lastPauseResult = null;
  }
}

// ─── Strategy Implementation ───

export class BenchLiveStrategy implements LiveExerciseStrategy {
  exerciseType = 'bench_press';
  standingThreshold = 150;
  noRepsMessage = 'No reps detected. Make sure you complete full bench press reps \u2014 arms extended, lower to chest, and press back up.';
  private phaseDetector: GenericPhaseDetector;
  private benchType: BenchType;
  private experienceLevel: ExperienceLevel;
  private competitionMode: boolean;
  /** Real-time pause tracker for live feedback. */
  readonly pauseTracker: LivePauseTracker;
  /** The last phase seen, used to detect BOTTOM entry/exit. */
  private lastPhase: SquatPhase = SquatPhase.STANDING;
  /** Estimated FPS (updated by the LiveAnalyzer's processFrame timing). */
  private estimatedFps = 30;

  constructor(benchType: BenchType = 'flat', experienceLevel: ExperienceLevel = 'beginner', competitionMode = false) {
    this.phaseDetector = new GenericPhaseDetector(LIVE_BENCH_PHASE_CONFIG);
    this.benchType = benchType;
    this.experienceLevel = experienceLevel;
    this.competitionMode = competitionMode;
    this.pauseTracker = new LivePauseTracker();
  }

  /** Build a BenchConfig from the strategy's parameters for use with exercise scoring functions. */
  private getConfig(): BenchConfig {
    return {
      benchType: this.benchType,
      experienceLevel: this.experienceLevel,
      competitionMode: this.competitionMode,
    };
  }

  /** Update the estimated FPS (called by external code that tracks frame timing). */
  setEstimatedFps(fps: number): void {
    this.estimatedFps = fps > 0 ? fps : 30;
  }

  detectPhase(angles: FrameAngles): SquatPhase {
    const phase = this.phaseDetector.update(angles.elbowAngle ?? 180);
    const elbowAngle = angles.elbowAngle ?? 180;

    // Track BOTTOM phase entry/exit for pause detection
    if (phase === SquatPhase.BOTTOM && this.lastPhase !== SquatPhase.BOTTOM) {
      this.pauseTracker.enterBottom(this.estimatedFps);
    }
    if (phase === SquatPhase.BOTTOM) {
      this.pauseTracker.recordFrame(elbowAngle);
    }
    if (this.lastPhase === SquatPhase.BOTTOM && phase !== SquatPhase.BOTTOM) {
      this.pauseTracker.leaveBottom();
    }

    this.lastPhase = phase;
    return phase;
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

    // Get the pause result from the tracker (computed when leaving BOTTOM phase)
    const pauseResult = this.pauseTracker.getLastPauseResult();

    const minElbow = Math.min(...rep.frameAngles.map(fa => fa.elbowAngle ?? 180));
    const rom = scoreBenchROM(minElbow, benchConfig);
    const lockout = scoreBenchLockout(rep);
    const control = scoreBenchControl(rep);
    const symmetry = scoreBenchSymmetry(rep);
    const tempo = isCompetition ? 100 : scoreBenchTempo(rep.descentDuration, rep.ascentDuration);

    // Use detailed pause scoring when available, otherwise fall back to duration-based
    const pause = pauseResult
      ? scoreBenchPauseDetailed(pauseResult, benchConfig)
      : scoreBenchPause(rep.bottomDuration, benchConfig);

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

    const issues = detectBenchIssues(rep, benchConfig, pauseResult ?? undefined);
    const cues = getBenchCues(issues, this.experienceLevel);
    const positiveFeedback = getBenchPositiveFeedback({
      rom, lockout, control, symmetry, tempo, pause,
    });

    let totalScore = overall;
    const highCount = issues.filter(i => i.severity === 'high').length;
    if (highCount > 0) totalScore = Math.max(0, totalScore - highCount * 5);

    // Competition mode: cap score at 50 if no pause detected
    if (isCompetition && pauseResult && (!pauseResult.detected || pauseResult.durationMs < 300)) {
      totalScore = Math.min(totalScore, 50);
    }

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
    this.pauseTracker.reset();
    this.lastPhase = SquatPhase.STANDING;
  }
}
