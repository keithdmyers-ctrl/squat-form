/**
 * Barbell row form analysis: phase detection, issue detection, scoring, and cues.
 * Uses elbow angle as the primary movement driver with hip angle for position monitoring.
 * User maintains a bent-over position (hip angle ~60-90°) throughout the movement.
 * Supports pendlay, bent_over, and yates row variants.
 */

import { computeFrameAngles, pickSide } from '../angles';
import { calibrateFromStanding, detectCameraView } from '../calibration';
import { SquatPhase } from '../types';
import type {
  BarBellRowType,
  ExperienceLevel,
  FrameAngles,
  CalibrationData,
  FormIssue,
  CoachingCue,
  RepData,
  RepScore,
  SetAnalysis,
  FrameData,
  RepRange,
} from '../types';
import { clamp, scoreToGrade } from '../scorer';
import { computeVelocityMetrics } from '../competition';
import { detectFatigue, aggregateTopIssues, aggregatePositiveFeedback, computeSetScore, createEmptyAnalysis, buildRepFrameMap } from '../exercise-core';

// ─── Barbell Row Config ───

export interface BarBellRowConfig {
  rowType: BarBellRowType;
  experienceLevel: ExperienceLevel;
  competitionMode: boolean;
}

// ─── Phase Detection (elbow angle driven, hip angle position) ───

const EXTENDED_ELBOW_ANGLE = 150;   // Arms mostly straight (start position)
const DESCENDING_THRESHOLD = 2.0;    // Used as "pulling" threshold (elbow angle decreasing)
const BOTTOM_VELOCITY_THRESHOLD = 1.5;
const ASCENDING_THRESHOLD = 2.0;     // Used as "lowering" threshold (elbow angle increasing)
const MIN_REP_FRAMES = 6;
const SMOOTHING_WINDOW = 5;
const HISTORY_WINDOW = 3;

function smoothAngle(buffer: number[], newValue: number, windowSize: number): number {
  buffer.push(newValue);
  if (buffer.length > windowSize) buffer.shift();
  return buffer.reduce((sum, v) => sum + v, 0) / buffer.length;
}

/**
 * Phase detector for barbell rows.
 * STANDING = start position (elbows extended, hips hinged)
 * DESCENDING = pulling (elbows flexing — angle decreasing)
 * BOTTOM = top of row (elbows fully flexed, bar at torso)
 * ASCENDING = lowering (elbows extending back down)
 *
 * Note: The naming maps to SquatPhase enum for compatibility,
 * but the semantics are inverted for rows:
 * - "DESCENDING" in elbow angle = pulling up
 * - "ASCENDING" in elbow angle = lowering down
 */
class RowPhaseDetector {
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
      case SquatPhase.STANDING: // Arms extended, bent over
        this.bottomHoldCount = 0;
        if (smoothed < EXTENDED_ELBOW_ANGLE && cumDelta < -DESCENDING_THRESHOLD) {
          this.phase = SquatPhase.DESCENDING; // Pulling (elbow angle decreasing)
        }
        break;

      case SquatPhase.DESCENDING: // Pulling
        if (Math.abs(delta) < BOTTOM_VELOCITY_THRESHOLD) {
          this.bottomHoldCount++;
          if (this.bottomHoldCount >= 2) {
            this.phase = SquatPhase.BOTTOM; // Top of row (bar at torso)
            this.bottomHoldCount = 0;
          }
        } else if (delta > 0) {
          this.phase = SquatPhase.BOTTOM;
          this.bottomHoldCount = 0;
        } else {
          this.bottomHoldCount = 0;
        }
        break;

      case SquatPhase.BOTTOM: // Bar at torso
        if (cumDelta > ASCENDING_THRESHOLD) {
          this.phase = SquatPhase.ASCENDING; // Lowering (elbow angle increasing)
        }
        break;

      case SquatPhase.ASCENDING: // Lowering
        if (smoothed >= EXTENDED_ELBOW_ANGLE) {
          this.phase = SquatPhase.STANDING; // Back to start
        }
        break;
    }

    this.prevSmoothedAngle = smoothed;
    return this.phase;
  }

  getCurrentPhase(): SquatPhase {
    return this.phase;
  }
}

export function detectRowReps(elbowAngles: number[]): RepRange[] {
  const detector = new RowPhaseDetector();
  const reps: RepRange[] = [];
  let repStart = -1;
  let bottomIdx = -1;
  let minAngleInRep = 180;

  for (let i = 0; i < elbowAngles.length; i++) {
    const prevPhase = detector.getCurrentPhase();
    const phase = detector.update(elbowAngles[i]);

    if (prevPhase === SquatPhase.STANDING && phase === SquatPhase.DESCENDING) {
      repStart = i;
      minAngleInRep = elbowAngles[i];
      bottomIdx = i;
    }

    if (repStart >= 0 && (phase === SquatPhase.DESCENDING || phase === SquatPhase.BOTTOM)) {
      if (elbowAngles[i] < minAngleInRep) {
        minAngleInRep = elbowAngles[i];
        bottomIdx = i;
      }
    }

    if (prevPhase === SquatPhase.ASCENDING && phase === SquatPhase.STANDING && repStart >= 0) {
      if ((i - repStart) >= MIN_REP_FRAMES) {
        reps.push({ start: repStart, end: i, bottomIndex: bottomIdx });
      }
      repStart = -1;
      bottomIdx = -1;
      minAngleInRep = 180;
    }
  }

  return reps;
}

// ─── Barbell Row Scoring ───

/** Ideal hip angle ranges per row type [min, max]. */
const ROW_HIP_ANGLE_RANGES: Record<BarBellRowType, [number, number]> = {
  pendlay: [50, 80],     // More horizontal torso, bar returns to floor
  bent_over: [60, 90],   // Standard bent-over position
  yates: [70, 110],      // More upright position
};

/** Scoring weights for barbell row. */
const ROW_WEIGHTS = {
  backPosition: 0.25,
  rowRom: 0.20,
  control: 0.20,
  symmetry: 0.10,
  tempo: 0.10,
  torsoStability: 0.15,
};

/** ROM thresholds: minimum elbow angle at top of row (lower = better ROM). */
const ROW_ROM_THRESHOLDS: Record<ExperienceLevel, number> = {
  beginner: 100,       // Partial range OK
  intermediate: 90,    // Near full contraction
  advanced: 85,        // Full ROM — bar to belly
};

function scoreBackPosition(
  hipAngles: number[],
  config: BarBellRowConfig,
): number {
  if (hipAngles.length === 0) return 50;

  const [minExpected, maxExpected] = ROW_HIP_ANGLE_RANGES[config.rowType];
  const avgHip = hipAngles.reduce((s, v) => s + v, 0) / hipAngles.length;
  const tolerance = config.experienceLevel === 'advanced' ? 10 : config.experienceLevel === 'intermediate' ? 15 : 20;

  if (avgHip >= minExpected && avgHip <= maxExpected) return 100;

  let deviation: number;
  if (avgHip < minExpected) deviation = minExpected - avgHip;
  else deviation = avgHip - maxExpected;

  if (deviation <= tolerance) return clamp(100 - (deviation / tolerance) * 15, 0, 100);
  return clamp(85 - (deviation - tolerance) * 1.5, 0, 100);
}

function scoreRowROM(minElbowAngle: number, config: BarBellRowConfig): number {
  const threshold = ROW_ROM_THRESHOLDS[config.experienceLevel];
  if (minElbowAngle <= threshold - 15) return 100;
  if (minElbowAngle <= threshold) {
    const frac = (minElbowAngle - (threshold - 15)) / 15;
    return clamp(100 - frac * 20, 0, 100);
  }
  const over = minElbowAngle - threshold;
  return clamp(80 - over * 2, 0, 100);
}

/** Control score: smooth eccentric (lowering not too fast). */
function scoreRowControl(rep: RepData): number {
  // Fast eccentric is a sign of poor control
  if (rep.ascentDuration < 0.3) return clamp(50 + rep.ascentDuration * 100, 0, 100);
  if (rep.ascentDuration < 0.5) return clamp(70 + (rep.ascentDuration - 0.3) * 150, 0, 100);

  // Check for smoothness during the pull
  const elbowAngles = rep.frameAngles.map(fa => fa.elbowAngle ?? 180);
  const bottomRelIdx = elbowAngles.reduce((minI, a, i, arr) => a < arr[minI] ? i : minI, 0);
  const pullAngles = elbowAngles.slice(0, bottomRelIdx + 1);

  let reversals = 0;
  for (let i = 2; i < pullAngles.length; i++) {
    const prev = pullAngles[i - 1] - pullAngles[i - 2];
    const curr = pullAngles[i] - pullAngles[i - 1];
    // During pull, angle should decrease; reversal = sudden increase
    if (prev < -1 && curr > 2) reversals++;
  }

  let score = 100;
  if (reversals > 0) score -= reversals * 15;
  return clamp(score, 0, 100);
}

/** Symmetry: left vs right elbow angle delta. */
function scoreRowSymmetry(rep: RepData): number {
  const symmetryValues = rep.frameAngles.map(fa => fa.hipSymmetry).filter((v): v is number => v !== null);
  if (symmetryValues.length === 0) return 90;
  const maxAsymmetry = Math.max(...symmetryValues);
  if (maxAsymmetry < 0.05) return 100;
  if (maxAsymmetry < 0.10) return clamp(100 - ((maxAsymmetry - 0.05) / 0.05) * 15, 0, 100);
  if (maxAsymmetry < 0.20) return clamp(85 - ((maxAsymmetry - 0.10) / 0.10) * 25, 0, 100);
  return clamp(60 - (maxAsymmetry - 0.20) * 100, 0, 100);
}

/** Tempo score for barbell row. */
function scoreRowTempo(descentDuration: number, ascentDuration: number): number {
  let score = 100;
  // Pull (descent in elbow angle): ideal 0.5-2.0s
  if (descentDuration < 0.3) score -= Math.min(20, (0.3 - descentDuration) * 50);
  else if (descentDuration > 3.0) score -= Math.min(10, (descentDuration - 3.0) * 5);
  // Lowering (ascent in elbow angle): ideal 0.5-2.0s, penalize very fast
  if (ascentDuration < 0.3) score -= Math.min(20, (0.3 - ascentDuration) * 50);
  else if (ascentDuration > 3.0) score -= Math.min(10, (ascentDuration - 3.0) * 5);
  return clamp(score, 0, 100);
}

/** Torso stability: trunk angle shouldn't change during rep. */
function scoreTorsoStability(rep: RepData): number {
  const trunkAngles = rep.frameAngles.map(fa => fa.trunkAngle);
  if (trunkAngles.length < 2) return 90;

  const mean = trunkAngles.reduce((s, v) => s + v, 0) / trunkAngles.length;
  const maxDeviation = Math.max(...trunkAngles.map(a => Math.abs(a - mean)));

  if (maxDeviation <= 5) return 100;
  if (maxDeviation <= 10) return clamp(100 - ((maxDeviation - 5) / 5) * 15, 0, 100);
  if (maxDeviation <= 20) return clamp(85 - ((maxDeviation - 10) / 10) * 30, 0, 100);
  return clamp(55 - (maxDeviation - 20) * 2, 0, 100);
}

// ─── Barbell Row Issue Detection ───

export function detectRowIssues(
  rep: RepData,
  config: BarBellRowConfig,
): FormIssue[] {
  const issues: FormIssue[] = [];

  // 1. Torso rise: hip angle increases > 15° during pull (using momentum)
  const hipAngles = rep.frameAngles.map(fa => fa.hipAngle);
  if (hipAngles.length >= 3) {
    const startHip = hipAngles[0];
    const maxHip = Math.max(...hipAngles);
    const hipIncrease = maxHip - startHip;
    if (hipIncrease > 15) {
      issues.push({
        name: 'torso_rise',
        severity: hipIncrease > 25 ? 'high' : 'moderate',
        description: 'Your torso rose during the pull — using momentum instead of back muscles',
        value: hipIncrease,
        threshold: 15,
        phase: SquatPhase.DESCENDING,
        frame: rep.bottomFrame,
      });
    }
  }

  // 2. Insufficient ROM: elbow doesn't flex enough at top
  const minElbow = Math.min(...rep.frameAngles.map(fa => fa.elbowAngle ?? 180));
  if (minElbow > 100) {
    issues.push({
      name: 'insufficient_rom_row',
      severity: minElbow > 120 ? 'moderate' : 'low',
      description: 'Didn\'t pull the bar far enough — aim to touch your belly button',
      value: minElbow,
      threshold: 100,
      phase: SquatPhase.BOTTOM,
      frame: rep.bottomFrame,
    });
  }

  // 3. Jerky pull: acceleration spikes during the concentric
  const elbowAngles = rep.frameAngles.map(fa => fa.elbowAngle ?? 180);
  const bottomRelIdx = elbowAngles.reduce((minI, a, i, arr) => a < arr[minI] ? i : minI, 0);
  const pullAngles = elbowAngles.slice(0, bottomRelIdx + 1);
  let jerks = 0;
  for (let i = 2; i < pullAngles.length; i++) {
    const prev = pullAngles[i - 1] - pullAngles[i - 2];
    const curr = pullAngles[i] - pullAngles[i - 1];
    if (prev < -1 && curr > 3) jerks++;
  }
  if (jerks > 0) {
    issues.push({
      name: 'jerky_pull',
      severity: jerks > 1 ? 'moderate' : 'low',
      description: 'The pull was jerky — aim for a smooth, controlled pull',
      value: jerks,
      threshold: 0,
      phase: SquatPhase.DESCENDING,
      frame: rep.bottomFrame,
    });
  }

  // 4. Asymmetric row: left/right elbow delta > 12°
  const symmetryValues = rep.frameAngles.map(fa => fa.hipSymmetry).filter((v): v is number => v !== null);
  if (symmetryValues.length > 0) {
    const maxAsym = Math.max(...symmetryValues);
    if (maxAsym > 0.12) {
      issues.push({
        name: 'asymmetric_row',
        severity: maxAsym > 0.25 ? 'moderate' : 'low',
        description: `${(maxAsym * 100).toFixed(0)}% imbalance between left and right sides`,
        value: maxAsym,
        threshold: 0.12,
        phase: SquatPhase.DESCENDING,
        frame: rep.bottomFrame,
      });
    }
  }

  // 5. Fast lowering: eccentric too fast (< 0.5s)
  // "ascent" in elbow angle terms = lowering the bar
  if (rep.ascentDuration < 0.5) {
    issues.push({
      name: 'fast_lowering_row',
      severity: rep.ascentDuration < 0.3 ? 'moderate' : 'low',
      description: `Lowering was ${rep.ascentDuration.toFixed(1)}s — control the bar on the way down`,
      value: rep.ascentDuration,
      threshold: 0.5,
      phase: SquatPhase.ASCENDING,
      frame: rep.endFrame,
    });
  }

  // 6. Excessive hip extension: standing too upright (hip > 120°)
  const maxHipAngle = hipAngles.length > 0 ? Math.max(...hipAngles) : 0;
  if (maxHipAngle > 120) {
    issues.push({
      name: 'excessive_hip_extension',
      severity: maxHipAngle > 140 ? 'high' : 'moderate',
      description: 'Standing too upright — maintain your hip hinge position throughout',
      value: maxHipAngle,
      threshold: 120,
      phase: SquatPhase.DESCENDING,
      frame: rep.startFrame,
    });
  }

  return issues;
}

// ─── Barbell Row Coaching Cues ───

const ROW_CUE_DATABASE: Record<string, { cue: string; priority: number; explanation: string; explanationBeginner?: string }> = {
  torso_rise: {
    cue: 'Keep your chest facing the floor throughout',
    priority: 1,
    explanation: 'Your torso is rising during the pull, which means you\'re using momentum and lower back instead of your upper back muscles. Keep your hip angle constant throughout the rep. If you have to heave the weight, it\'s too heavy.',
    explanationBeginner: 'Your body is standing up during the pull instead of staying bent over. This means you\'re using your lower back and momentum instead of the muscles you\'re trying to train. Use a lighter weight and focus on keeping your chest pointing at the floor the entire time.',
  },
  insufficient_rom_row: {
    cue: 'Pull the bar to your belly button — drive elbows behind your back',
    priority: 2,
    explanation: 'You\'re not pulling the bar high enough for full back muscle activation. Focus on driving your elbows behind your body, squeezing your shoulder blades together at the top. The bar should touch or nearly touch your lower chest/upper abdomen.',
    explanationBeginner: 'You\'re not pulling the bar far enough. Try to bring the bar all the way up to touch your belly button area. Think about pulling your elbows behind you as far as they\'ll go, and squeeze your shoulder blades together at the top. Use a lighter weight if needed.',
  },
  jerky_pull: {
    cue: 'Pull smoothly — no jerking or yanking',
    priority: 3,
    explanation: 'The pull had acceleration spikes, indicating jerky, uncontrolled movement. This reduces muscle tension and increases injury risk. Focus on a smooth, controlled pull with constant tension.',
    explanationBeginner: 'You\'re yanking the bar up with jerky movements. This can hurt your back and doesn\'t build as much muscle. Pull the bar up smoothly and steadily — imagine pulling it through thick honey. If you can\'t keep it smooth, the weight is too heavy.',
  },
  asymmetric_row: {
    cue: 'Pull evenly — use dumbbells to fix the imbalance',
    priority: 4,
    explanation: 'One side is pulling harder than the other. This creates muscle imbalances and can lead to injury. Try single-arm dumbbell rows to build equal strength on both sides.',
    explanationBeginner: 'One arm is doing more work than the other. This is common but should be fixed. Try doing rows with one dumbbell at a time — this forces each arm to work equally. Start with your weaker side first, then match the reps with your stronger side.',
  },
  fast_lowering_row: {
    cue: 'Lower the bar under control — 1-2 seconds down',
    priority: 5,
    explanation: 'You\'re dropping the bar too quickly on the eccentric. The lowering portion builds just as much muscle as the pulling portion. Aim for a 1-2 second controlled descent.',
    explanationBeginner: 'You\'re letting the bar drop down too fast after pulling it up. Lowering the bar slowly actually builds just as much strength as pulling it up! Try taking 1-2 seconds to bring it back down — nice and controlled.',
  },
  excessive_hip_extension: {
    cue: 'Maintain your hip hinge position — don\'t stand up during the pull',
    priority: 1,
    explanation: 'You\'re standing too upright, which turns the row into an upright row or shrug. Keep your torso at the proper angle: roughly 45 degrees for bent-over rows, more horizontal for Pendlay rows. Your hips should stay hinged throughout.',
    explanationBeginner: 'You\'re standing up too straight during the exercise. For a barbell row, you need to stay bent over — like you\'re bowing. If you stand up, you\'re not working the right muscles. Bend forward at your hips and keep that position for the entire set.',
  },
};

function getRowCues(issues: FormIssue[], experienceLevel?: string): CoachingCue[] {
  const cueMap = new Map<string, CoachingCue>();
  for (const issue of issues) {
    const entry = ROW_CUE_DATABASE[issue.name];
    if (!entry || cueMap.has(issue.name)) continue;
    const explanation = (experienceLevel === 'beginner' && entry.explanationBeginner)
      ? entry.explanationBeginner : entry.explanation;
    cueMap.set(issue.name, { issue: issue.name, cue: entry.cue, priority: entry.priority, explanation });
  }
  return Array.from(cueMap.values()).sort((a, b) => a.priority - b.priority);
}

// ─── Positive Feedback ───

function getRowPositiveFeedback(scores: {
  backPosition: number;
  rowRom: number;
  control: number;
  symmetry: number;
  tempo: number;
  torsoStability: number;
}): string[] {
  const feedback: string[] = [];
  if (scores.backPosition >= 90) feedback.push('Great back position — maintained hip angle throughout');
  if (scores.rowRom >= 90) feedback.push('Excellent range of motion — bar pulled to torso');
  if (scores.control >= 90) feedback.push('Smooth, controlled pull and lowering');
  if (scores.symmetry >= 90) feedback.push('Even pull — nice and balanced');
  if (scores.tempo >= 90) feedback.push('Good tempo on both pull and lowering');
  if (scores.torsoStability >= 90) feedback.push('Rock-solid torso — no swaying');
  return feedback;
}

// ─── Rep Building & Scoring ───

function buildRowRepData(
  repRange: RepRange,
  frameAnglesMap: Map<number, FrameAngles>,
  frameIndices: number[],
  fps: number,
): RepData {
  const { start, end, bottomIndex } = repRange;
  const repFrameAngles: FrameAngles[] = [];
  for (let i = start; i <= end && i < frameIndices.length; i++) {
    const fa = frameAnglesMap.get(frameIndices[i]);
    if (fa) repFrameAngles.push(fa);
  }

  const elbowAngles = repFrameAngles.map(fa => fa.elbowAngle ?? 180);
  const minElbowAngle = elbowAngles.length > 0 ? Math.min(...elbowAngles) : 180;
  const hipAngles = repFrameAngles.map(fa => fa.hipAngle);
  const trunkAngles = repFrameAngles.map(fa => fa.trunkAngle);

  const minHipAngle = hipAngles.length > 0 ? Math.min(...hipAngles) : 180;
  const maxTrunkAngle = trunkAngles.length > 0 ? Math.max(...trunkAngles) : 0;

  // For rows: "descent" = pulling (elbow angle decreasing), "ascent" = lowering (elbow angle increasing)
  const descentFrames = bottomIndex - start;
  const ascentFrames = end - bottomIndex;
  const descentDuration = fps > 0 ? descentFrames / fps : 0;
  const ascentDuration = fps > 0 ? ascentFrames / fps : 0;

  let bottomFrameCount = 0;
  for (const ea of elbowAngles) {
    if (ea <= minElbowAngle + 5) bottomFrameCount++;
  }
  const bottomDuration = fps > 0 ? bottomFrameCount / fps : 0;

  // Velocity metrics based on elbow angles
  const bottomRelIdx = bottomIndex - start;
  const velocity = computeVelocityMetrics(elbowAngles, bottomRelIdx, fps);

  return {
    repNumber: 0,
    startFrame: frameIndices[start] ?? 0,
    endFrame: frameIndices[end] ?? 0,
    bottomFrame: frameIndices[bottomIndex] ?? 0,
    minKneeAngle: 180,
    minHipAngle,
    maxTrunkAngle,
    descentDuration,
    bottomDuration,
    ascentDuration,
    frameAngles: repFrameAngles,
    heelRise: false,
    buttWink: false,
    goodMorning: false,
    kneeValgus: false,
    trunkAngleChangeOnAscent: 0,
    pelvicTiltAtBottom: 0,
    stickingPoints: [],
    velocity,
  };
}

export function scoreRowRep(
  rep: RepData,
  config: BarBellRowConfig,
): RepScore {
  const hipAngles = rep.frameAngles.map(fa => fa.hipAngle);
  const minElbow = Math.min(...rep.frameAngles.map(fa => fa.elbowAngle ?? 180));

  const backPosition = scoreBackPosition(hipAngles, config);
  const rowRom = scoreRowROM(minElbow, config);
  const control = scoreRowControl(rep);
  const symmetry = scoreRowSymmetry(rep);
  const tempo = scoreRowTempo(rep.descentDuration, rep.ascentDuration);
  const torsoStability = scoreTorsoStability(rep);

  const w = ROW_WEIGHTS;

  const overall = clamp(
    Math.round(
      backPosition * w.backPosition +
      rowRom * w.rowRom +
      control * w.control +
      symmetry * w.symmetry +
      tempo * w.tempo +
      torsoStability * w.torsoStability,
    ),
    0, 100,
  );

  const issues = detectRowIssues(rep, config);
  const cues = getRowCues(issues, config.experienceLevel);
  const positiveFeedback = getRowPositiveFeedback({
    backPosition, rowRom, control, symmetry, tempo, torsoStability,
  });

  // Soft penalty for HIGH severity issues
  let totalScore = overall;
  const highCount = issues.filter(i => i.severity === 'high').length;
  if (highCount > 0) totalScore = Math.max(0, totalScore - highCount * 5);

  // Aggregate landmark confidence across all frames in this rep
  const confidenceValues = rep.frameAngles
    .map(fa => fa.landmarkConfidence)
    .filter((v): v is number => v !== undefined);
  const avgConfidence = confidenceValues.length > 0
    ? confidenceValues.reduce((s, v) => s + v, 0) / confidenceValues.length
    : undefined;

  return {
    depthScore: rowRom,
    kneeTrackingScore: control,
    trunkScore: backPosition,
    symmetryScore: symmetry,
    tempoScore: tempo,
    lockoutScore: torsoStability,
    overallScore: totalScore,
    grade: scoreToGrade(totalScore, config.experienceLevel),
    issues,
    cues,
    positiveFeedback,
    stickingPoints: [],
    velocity: rep.velocity,
    avgConfidence,
    minKneeAngle: rep.minKneeAngle,
    maxTrunkAngle: rep.maxTrunkAngle,
    minHipAngle: rep.minHipAngle,
    descentDuration: rep.descentDuration,
    ascentDuration: rep.ascentDuration,
    bottomDuration: rep.bottomDuration,
    dimensions: { backPosition, rowRom, control, symmetry, tempo, torsoStability },
    exerciseType: 'barbell_row',
  };
}

// ─── Main Entry Point ───

export function analyzeRowSequence(
  frames: FrameData,
  fps: number,
  config: BarBellRowConfig,
): SetAnalysis {
  const sqConfig = {
    squatType: 'bodyweight' as const,
    experienceLevel: config.experienceLevel,
    competitionMode: config.competitionMode,
  };

  if (frames.size === 0) return createEmptyAnalysis(sqConfig);

  const frameIndices = Array.from(frames.keys()).sort((a, b) => a - b);

  // Calibrate from standing (if available)
  let calibration: CalibrationData | null = null;
  const calibrationCandidates = frameIndices.slice(0, Math.min(30, frameIndices.length));
  for (const ci of calibrationCandidates) {
    const lm = frames.get(ci);
    if (!lm) continue;
    const fa = computeFrameAngles(lm);
    if (fa.hipAngle >= 150 && fa.kneeAngle >= 150) {
      calibration = calibrateFromStanding(lm);
      break;
    }
  }

  // Detect camera view
  let detectedCameraView: 'side' | 'front' | 'unknown' = 'unknown';
  for (const ci of calibrationCandidates) {
    const lm = frames.get(ci);
    if (!lm) continue;
    const view = detectCameraView(lm);
    if (view !== 'unknown') { detectedCameraView = view; break; }
  }

  // Compute frame angles
  const frameAnglesMap = new Map<number, FrameAngles>();
  const elbowAnglesOrdered: number[] = [];
  for (const fi of frameIndices) {
    const lm = frames.get(fi)!;
    const fa = computeFrameAngles(lm, calibration?.standingKneeWidth ?? undefined);
    frameAnglesMap.set(fi, fa);
    elbowAnglesOrdered.push(fa.elbowAngle ?? 180);
  }

  // Check if elbow data is available
  const hasElbowData = elbowAnglesOrdered.some(a => a < 175);
  if (!hasElbowData) {
    const result = createEmptyAnalysis(sqConfig);
    result.sideViewWarning = 'Could not detect elbow/wrist landmarks clearly. For barbell row analysis, position the camera at the side with your full body visible.';
    return result;
  }

  // Detect reps via elbow angle
  const repRanges = detectRowReps(elbowAnglesOrdered);
  if (repRanges.length === 0) return createEmptyAnalysis(sqConfig, calibration);

  const repScores: RepScore[] = [];

  for (let r = 0; r < repRanges.length; r++) {
    const range = repRanges[r];
    const repData = buildRowRepData(range, frameAnglesMap, frameIndices, fps);
    repData.repNumber = r + 1;
    const score = scoreRowRep(repData, config);
    repScores.push(score);
  }

  const overallScore = computeSetScore(repScores);
  const fatigueDetected = detectFatigue(repScores);
  const topIssues = aggregateTopIssues(repScores);
  const topCues = getRowCues(topIssues, config.experienceLevel);
  const positiveHighlights = aggregatePositiveFeedback(repScores);
  const { repFrameMap: rfm, repStartFrames: rsf } = buildRepFrameMap(repRanges, frameIndices);

  return {
    repCount: repRanges.length,
    reps: repScores,
    overallScore,
    grade: scoreToGrade(overallScore, config.experienceLevel),
    fatigueDetected,
    topIssues,
    topCues,
    calibration,
    config: sqConfig,
    repFrameMap: rfm,
    repStartFrames: rsf,
    detectedCameraView,
    positiveHighlights,
    mobilityFindings: [],
    warmupProtocol: [],
    competitionMode: config.competitionMode,
  };
}
