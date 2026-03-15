/**
 * Deadlift live mode strategy.
 * Uses hip angle for phase detection, matching the DeadliftPhaseDetector
 * pattern from exercises/deadlift.ts.
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
import { clamp, scoreToGrade, scoreTempo } from './scorer';
import { computeVelocityMetrics } from './competition';

// ─── Hip-angle driven phase detector (mirrors exercises/deadlift.ts) ───

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

// ─── Deadlift Scoring (replicates exercises/deadlift.ts scoring logic) ───

type DeadliftType = 'conventional' | 'sumo' | 'romanian';

const DEADLIFT_TRUNK_RANGES: Record<DeadliftType, [number, number]> = {
  conventional: [35, 65],
  sumo: [25, 50],
  romanian: [30, 55],
};

const DEADLIFT_WEIGHTS = {
  backPosition: 0.25,
  hipHinge: 0.20,
  lockout: 0.20,
  symmetry: 0.10,
  tempo: 0.10,
  control: 0.15,
};

const DEADLIFT_COMPETITION_WEIGHTS = {
  backPosition: 0.25,
  hipHinge: 0.20,
  lockout: 0.30,
  symmetry: 0.10,
  tempo: 0.00,
  control: 0.15,
};

const HIP_HINGE_THRESHOLDS: Record<ExperienceLevel, number> = {
  beginner: 100,
  intermediate: 85,
  advanced: 75,
};

function scoreBackPosition(maxTrunkAngle: number, dlType: DeadliftType, experienceLevel: ExperienceLevel): number {
  const [minExpected, maxExpected] = DEADLIFT_TRUNK_RANGES[dlType];
  const tolerance = experienceLevel === 'advanced' ? 10 : experienceLevel === 'intermediate' ? 15 : 20;
  if (maxTrunkAngle >= minExpected && maxTrunkAngle <= maxExpected) return 100;
  let deviation: number;
  if (maxTrunkAngle < minExpected) deviation = minExpected - maxTrunkAngle;
  else deviation = maxTrunkAngle - maxExpected;
  if (deviation <= tolerance) return clamp(100 - (deviation / tolerance) * 15, 0, 100);
  return clamp(85 - (deviation - tolerance) * 1.5, 0, 100);
}

function scoreHipHinge(minHipAngle: number, experienceLevel: ExperienceLevel): number {
  const threshold = HIP_HINGE_THRESHOLDS[experienceLevel];
  if (minHipAngle <= threshold - 20) return 100;
  if (minHipAngle <= threshold) {
    const frac = (minHipAngle - (threshold - 20)) / 20;
    return clamp(100 - frac * 20, 0, 100);
  }
  const over = minHipAngle - threshold;
  return clamp(80 - over * 2, 0, 100);
}

function scoreDeadliftLockout(rep: RepData, calibration: CalibrationData | null): number {
  const lastAngles = rep.frameAngles.slice(-5);
  if (lastAngles.length === 0) return 50;
  const finalHipAngle = Math.max(...lastAngles.map(fa => fa.hipAngle));
  const standingHip = calibration?.standingHipAngle ?? 175;
  const diff = Math.abs(finalHipAngle - standingHip);
  if (diff <= 10) return 100;
  if (diff <= 20) return clamp(100 - ((diff - 10) / 10) * 25, 0, 100);
  return clamp(75 - (diff - 20) * 1.5, 0, 100);
}

function scoreDeadliftSymmetry(rep: RepData): number {
  const symmetryValues = rep.frameAngles.map(fa => fa.hipSymmetry).filter((v): v is number => v !== null);
  if (symmetryValues.length === 0) return 90;
  const maxAsymmetry = Math.max(...symmetryValues);
  if (maxAsymmetry < 0.05) return 100;
  if (maxAsymmetry < 0.10) return clamp(100 - ((maxAsymmetry - 0.05) / 0.05) * 15, 0, 100);
  if (maxAsymmetry < 0.20) return clamp(85 - ((maxAsymmetry - 0.10) / 0.10) * 25, 0, 100);
  return clamp(60 - (maxAsymmetry - 0.20) * 100, 0, 100);
}

function scoreDeadliftControl(rep: RepData): number {
  const bottomRelIdx = rep.frameAngles.length > 0
    ? rep.frameAngles.reduce((minI, fa, i, arr) => fa.hipAngle < arr[minI].hipAngle ? i : minI, 0)
    : 0;
  const ascentAngles = rep.frameAngles.slice(bottomRelIdx).map(fa => fa.hipAngle);
  let reversals = 0;
  for (let i = 2; i < ascentAngles.length; i++) {
    const prev = ascentAngles[i - 1] - ascentAngles[i - 2];
    const curr = ascentAngles[i] - ascentAngles[i - 1];
    if (prev > 1 && curr < -2) reversals++;
  }
  if (reversals === 0) return 100;
  if (reversals === 1) return 80;
  return clamp(60 - (reversals - 1) * 15, 0, 100);
}

// ─── Issue Detection ───

function detectDeadliftIssues(
  rep: RepData,
  dlType: DeadliftType,
  experienceLevel: ExperienceLevel,
  competitionMode: boolean,
): FormIssue[] {
  const issues: FormIssue[] = [];
  const [, maxExpected] = DEADLIFT_TRUNK_RANGES[dlType];
  const tolerance = experienceLevel === 'advanced' ? 10 : 15;

  if (rep.maxTrunkAngle > maxExpected + tolerance) {
    issues.push({
      name: 'rounded_back',
      severity: rep.maxTrunkAngle > maxExpected + tolerance * 2 ? 'high' : 'moderate',
      description: 'Your back rounded excessively during the lift',
      value: rep.maxTrunkAngle,
      threshold: maxExpected + tolerance,
      phase: SquatPhase.ASCENDING,
      frame: rep.bottomFrame,
    });
  }

  const bottomRelIdx = rep.frameAngles.reduce((minI, fa, i, arr) =>
    fa.hipAngle < arr[minI].hipAngle ? i : minI, 0);
  const ascentTrunkAngles = rep.frameAngles.slice(bottomRelIdx).map(fa => fa.trunkAngle);
  if (ascentTrunkAngles.length >= 3) {
    const trunkAtStart = ascentTrunkAngles[0] ?? 0;
    const earlyTrunk = ascentTrunkAngles.slice(0, Math.ceil(ascentTrunkAngles.length * 0.4));
    const maxEarlyTrunk = earlyTrunk.length > 0 ? Math.max(...earlyTrunk) : trunkAtStart;
    const trunkIncrease = maxEarlyTrunk - trunkAtStart;
    if (trunkIncrease > 10) {
      issues.push({
        name: 'hip_shoot',
        severity: trunkIncrease > 20 ? 'high' : 'moderate',
        description: 'Your hips shot up before your shoulders during the pull',
        value: trunkIncrease,
        threshold: 10,
        phase: SquatPhase.ASCENDING,
        frame: rep.bottomFrame,
      });
    }
  }

  const ascentHipAngles = rep.frameAngles.slice(bottomRelIdx).map(fa => fa.hipAngle);
  let hitchCount = 0;
  for (let i = 2; i < ascentHipAngles.length; i++) {
    const prev = ascentHipAngles[i - 1] - ascentHipAngles[i - 2];
    const curr = ascentHipAngles[i] - ascentHipAngles[i - 1];
    if (prev > 1 && curr < -2) hitchCount++;
  }
  if (hitchCount > 0) {
    issues.push({
      name: 'hitching',
      severity: hitchCount > 1 ? 'high' : 'moderate',
      description: 'The bar stopped or reversed direction during the pull',
      value: hitchCount,
      threshold: 0,
      phase: SquatPhase.ASCENDING,
      frame: rep.bottomFrame,
    });
  }

  const lastAngles = rep.frameAngles.slice(-5);
  const finalHipAngle = lastAngles.length > 0 ? Math.max(...lastAngles.map(fa => fa.hipAngle)) : 0;
  if (finalHipAngle < 160) {
    issues.push({
      name: 'incomplete_lockout',
      severity: finalHipAngle < 145 ? 'moderate' : 'low',
      description: 'Didn\'t fully lock out at the top \u2014 hips should be fully extended',
      value: finalHipAngle,
      threshold: 160,
      phase: SquatPhase.STANDING,
      frame: rep.endFrame,
    });
  }

  const hingeThreshold = HIP_HINGE_THRESHOLDS[experienceLevel];
  if (rep.minHipAngle > hingeThreshold) {
    issues.push({
      name: 'insufficient_rom',
      severity: rep.minHipAngle > hingeThreshold + 15 ? 'moderate' : 'low',
      description: dlType === 'romanian'
        ? 'Didn\'t hinge deep enough \u2014 lower the bar until you feel a hamstring stretch'
        : 'Didn\'t hinge down far enough to the bar',
      value: rep.minHipAngle,
      threshold: hingeThreshold,
      phase: SquatPhase.BOTTOM,
      frame: rep.bottomFrame,
    });
  }

  return issues;
}

// ─── Coaching Cues ───

const DEADLIFT_CUE_DATABASE: Record<string, { cue: string; priority: number; explanation: string }> = {
  rounded_back: {
    cue: 'Pack your lats \u2014 pull the bar into your body',
    priority: 1,
    explanation: 'Your back is rounding during the pull.',
  },
  hip_shoot: {
    cue: 'Push the floor away \u2014 don\'t lift the bar, push your feet through the floor',
    priority: 2,
    explanation: 'Your hips rose faster than your shoulders.',
  },
  hitching: {
    cue: 'Drive your hips through in one smooth motion',
    priority: 1,
    explanation: 'The bar stopped or reversed during the pull.',
  },
  incomplete_lockout: {
    cue: 'Squeeze your glutes and stand tall at the top',
    priority: 3,
    explanation: 'You didn\'t fully extend your hips at the top.',
  },
  insufficient_rom: {
    cue: 'Hinge deeper \u2014 push your hips back further',
    priority: 4,
    explanation: 'You\'re not hinging deep enough.',
  },
};

function getDeadliftCues(issues: FormIssue[]): CoachingCue[] {
  const cueMap = new Map<string, CoachingCue>();
  for (const issue of issues) {
    const entry = DEADLIFT_CUE_DATABASE[issue.name];
    if (!entry || cueMap.has(issue.name)) continue;
    cueMap.set(issue.name, { issue: issue.name, cue: entry.cue, priority: entry.priority, explanation: entry.explanation });
  }
  return Array.from(cueMap.values()).sort((a, b) => a.priority - b.priority);
}

function getDeadliftPositiveFeedback(scores: {
  backPosition: number;
  hipHinge: number;
  lockout: number;
  symmetry: number;
  tempo: number;
  control: number;
}): string[] {
  const feedback: string[] = [];
  if (scores.backPosition >= 90) feedback.push('Great back position \u2014 stayed neutral throughout');
  if (scores.hipHinge >= 90) feedback.push('Good hip hinge depth');
  if (scores.lockout >= 90) feedback.push('Strong lockout at the top');
  if (scores.symmetry >= 90) feedback.push('Even pull \u2014 nice and balanced');
  if (scores.control >= 90) feedback.push('Smooth, controlled pull \u2014 no hitching');
  if (scores.tempo >= 90) feedback.push('Good tempo and control');
  return feedback;
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
    const isCompetition = this.competitionMode;
    const backPosition = scoreBackPosition(rep.maxTrunkAngle, this.dlType, this.experienceLevel);
    const hipHinge = scoreHipHinge(rep.minHipAngle, this.experienceLevel);
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

    const issues = detectDeadliftIssues(rep, this.dlType, this.experienceLevel, isCompetition);
    const cues = getDeadliftCues(issues);
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
