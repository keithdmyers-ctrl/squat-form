/**
 * Bench press live mode strategy (EXPERIMENTAL).
 * Uses elbow angle for phase detection, matching the BenchPhaseDetector
 * pattern from exercises/bench.ts.
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
  FormIssue,
  CoachingCue,
} from './types';
import type { LiveExerciseStrategy } from './live';
import { clamp, scoreToGrade } from './scorer';
import { computeVelocityMetrics } from './competition';

// ─── Elbow-angle driven phase detector (mirrors exercises/bench.ts) ───

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

// ─── Bench Scoring (replicates exercises/bench.ts scoring logic) ───

type BenchType = 'flat' | 'close_grip' | 'wide_grip';

const BENCH_WEIGHTS = {
  rom: 0.25,
  lockout: 0.20,
  control: 0.20,
  symmetry: 0.15,
  tempo: 0.10,
  pause: 0.10,
};

const BENCH_COMPETITION_WEIGHTS = {
  rom: 0.25,
  lockout: 0.25,
  control: 0.15,
  symmetry: 0.10,
  tempo: 0.00,
  pause: 0.25,
};

const BENCH_ROM_THRESHOLDS: Record<ExperienceLevel, number> = {
  beginner: 100,
  intermediate: 85,
  advanced: 75,
};

function scoreBenchROM(minElbowAngle: number, experienceLevel: ExperienceLevel): number {
  const threshold = BENCH_ROM_THRESHOLDS[experienceLevel];
  if (minElbowAngle <= threshold - 15) return 100;
  if (minElbowAngle <= threshold) {
    const frac = (minElbowAngle - (threshold - 15)) / 15;
    return clamp(100 - frac * 20, 0, 100);
  }
  const over = minElbowAngle - threshold;
  return clamp(80 - over * 2, 0, 100);
}

function scoreBenchLockout(rep: RepData): number {
  const lastAngles = rep.frameAngles.slice(-5);
  if (lastAngles.length === 0) return 50;
  const finalElbow = Math.max(...lastAngles.map(fa => fa.elbowAngle ?? 0));
  if (finalElbow >= 170) return 100;
  if (finalElbow >= 155) return clamp(100 - ((170 - finalElbow) / 15) * 25, 0, 100);
  return clamp(75 - (155 - finalElbow) * 1.5, 0, 100);
}

function scoreBenchControl(rep: RepData): number {
  const elbowAngles = rep.frameAngles.map(fa => fa.elbowAngle ?? 180);
  const bottomRelIdx = elbowAngles.reduce((minI, a, i, arr) => a < arr[minI] ? i : minI, 0);
  const ascentAngles = elbowAngles.slice(bottomRelIdx);
  let reversals = 0;
  for (let i = 2; i < ascentAngles.length; i++) {
    const prev = ascentAngles[i - 1] - ascentAngles[i - 2];
    const curr = ascentAngles[i] - ascentAngles[i - 1];
    if (prev > 1 && curr < -2) reversals++;
  }
  if (reversals === 0) return 100;
  if (reversals === 1) return 85;
  return clamp(65 - (reversals - 1) * 15, 0, 100);
}

function scoreBenchSymmetry(rep: RepData): number {
  const symmetryValues = rep.frameAngles.map(fa => fa.hipSymmetry).filter((v): v is number => v !== null);
  if (symmetryValues.length === 0) return 90;
  const maxAsymmetry = Math.max(...symmetryValues);
  if (maxAsymmetry < 0.05) return 100;
  if (maxAsymmetry < 0.10) return clamp(100 - ((maxAsymmetry - 0.05) / 0.05) * 15, 0, 100);
  if (maxAsymmetry < 0.20) return clamp(85 - ((maxAsymmetry - 0.10) / 0.10) * 25, 0, 100);
  return clamp(60 - (maxAsymmetry - 0.20) * 100, 0, 100);
}

function scoreBenchTempo(descentDuration: number, ascentDuration: number): number {
  let score = 100;
  if (descentDuration < 0.8) score -= Math.min(20, (0.8 - descentDuration) * 25);
  else if (descentDuration > 4.0) score -= Math.min(10, (descentDuration - 4.0) * 5);
  if (ascentDuration < 0.2) score -= 5;
  return clamp(score, 0, 100);
}

function scoreBenchPause(bottomDuration: number, competitionMode: boolean): number {
  if (competitionMode) {
    if (bottomDuration >= 0.5) return 100;
    if (bottomDuration >= 0.2) return 75;
    return 30;
  }
  if (bottomDuration >= 0.1 && bottomDuration <= 2.0) return 100;
  if (bottomDuration < 0.1) return 70;
  return clamp(90 - (bottomDuration - 2.0) * 10, 0, 100);
}

// ─── Issue Detection ───

function detectBenchIssues(
  rep: RepData,
  experienceLevel: ExperienceLevel,
  competitionMode: boolean,
): FormIssue[] {
  const issues: FormIssue[] = [];

  const minElbow = Math.min(...rep.frameAngles.map(fa => fa.elbowAngle ?? 180));
  const romThreshold = BENCH_ROM_THRESHOLDS[experienceLevel];
  if (minElbow > romThreshold) {
    issues.push({
      name: 'insufficient_rom',
      severity: minElbow > romThreshold + 15 ? 'moderate' : 'low',
      description: 'Didn\'t lower the bar far enough \u2014 try to touch or get close to your chest',
      value: minElbow,
      threshold: romThreshold,
      phase: SquatPhase.BOTTOM,
      frame: rep.bottomFrame,
    });
  }

  const lastElbow = Math.max(...rep.frameAngles.slice(-5).map(fa => fa.elbowAngle ?? 0));
  if (lastElbow < 160) {
    issues.push({
      name: 'incomplete_lockout',
      severity: lastElbow < 145 ? 'moderate' : 'low',
      description: 'Arms not fully extended at the top',
      value: lastElbow,
      threshold: 160,
      phase: SquatPhase.STANDING,
      frame: rep.endFrame,
    });
  }

  if (rep.bottomDuration < 0.05) {
    issues.push({
      name: 'bouncing',
      severity: competitionMode ? 'high' : 'moderate',
      description: 'Bar bounced off your chest \u2014 pause briefly at the bottom',
      value: rep.bottomDuration,
      threshold: 0.1,
      phase: SquatPhase.BOTTOM,
      frame: rep.bottomFrame,
    });
  }

  if (competitionMode && rep.bottomDuration < 0.3) {
    issues.push({
      name: 'no_pause',
      severity: 'high',
      description: 'Competition bench requires a clear pause on the chest before pressing',
      value: rep.bottomDuration,
      threshold: 0.3,
      phase: SquatPhase.BOTTOM,
      frame: rep.bottomFrame,
    });
  }

  return issues;
}

// ─── Coaching Cues ───

const BENCH_CUE_DATABASE: Record<string, { cue: string; priority: number; explanation: string }> = {
  insufficient_rom: {
    cue: 'Lower the bar to your chest \u2014 touch and press',
    priority: 3,
    explanation: 'Full range of motion builds more strength and muscle.',
  },
  incomplete_lockout: {
    cue: 'Press all the way up \u2014 lock your elbows at the top',
    priority: 3,
    explanation: 'Finish each rep with arms fully extended.',
  },
  bouncing: {
    cue: 'Control the bar to your chest \u2014 no bouncing',
    priority: 2,
    explanation: 'Bouncing the bar off your chest uses momentum instead of muscle strength.',
  },
  no_pause: {
    cue: 'Pause on the chest \u2014 wait for the press command',
    priority: 1,
    explanation: 'In competition, you must hold the bar motionless on your chest.',
  },
};

function getBenchCues(issues: FormIssue[]): CoachingCue[] {
  const cueMap = new Map<string, CoachingCue>();
  for (const issue of issues) {
    const entry = BENCH_CUE_DATABASE[issue.name];
    if (!entry || cueMap.has(issue.name)) continue;
    cueMap.set(issue.name, { issue: issue.name, cue: entry.cue, priority: entry.priority, explanation: entry.explanation });
  }
  return Array.from(cueMap.values()).sort((a, b) => a.priority - b.priority);
}

function getBenchPositiveFeedback(scores: {
  rom: number;
  lockout: number;
  control: number;
  symmetry: number;
  tempo: number;
  pause: number;
}): string[] {
  const feedback: string[] = [];
  if (scores.rom >= 90) feedback.push('Great range of motion \u2014 bar touched the chest');
  if (scores.lockout >= 90) feedback.push('Strong lockout at the top');
  if (scores.control >= 90) feedback.push('Smooth, controlled press');
  if (scores.symmetry >= 90) feedback.push('Even pressing \u2014 nice and balanced');
  if (scores.tempo >= 90) feedback.push('Good tempo and control');
  if (scores.pause >= 90) feedback.push('Good pause on the chest');
  return feedback;
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
    const isCompetition = this.competitionMode;
    const minElbow = Math.min(...rep.frameAngles.map(fa => fa.elbowAngle ?? 180));
    const rom = scoreBenchROM(minElbow, this.experienceLevel);
    const lockout = scoreBenchLockout(rep);
    const control = scoreBenchControl(rep);
    const symmetry = scoreBenchSymmetry(rep);
    const tempo = isCompetition ? 100 : scoreBenchTempo(rep.descentDuration, rep.ascentDuration);
    const pause = scoreBenchPause(rep.bottomDuration, isCompetition);

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

    const issues = detectBenchIssues(rep, this.experienceLevel, isCompetition);
    const cues = getBenchCues(issues);
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
