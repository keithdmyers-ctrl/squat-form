/**
 * ML-driven programming personalization.
 *
 * Lightweight on-device learning from the user's own training history.
 * Uses simple statistical methods (linear regression, Pearson correlation,
 * moving averages) on accumulated workout logs to build a personal model.
 *
 * No external ML libraries — pure TypeScript math on accumulated data.
 *
 * Evidence basis:
 * - Zourdos et al. (2016) — RPE autoregulation
 * - Israetel (2020) — Volume landmarks individualization
 * - Schoenfeld et al. (2017) — Dose-response for volume
 * - Helms et al. (2016) — RIR-based training
 */

import type { WorkoutLog, ProgramState, WorkoutSet } from './workout-storage';

// ─── Storage Key ───

const PERSONAL_MODEL_KEY = 'squat_form_personal_model';

// ─── Minimum Data Thresholds ───

/** Minimum logged workouts before any model is built */
const MIN_WORKOUTS_FOR_MODEL = 10;
/** Data points needed for full confidence */
const FULL_CONFIDENCE_THRESHOLD = 50;
/** Minimum weeks of data for volume sensitivity analysis */
const MIN_WEEKS_FOR_VOLUME = 4;

// ─── Types ───

export interface TrainingResponse {
  /** How this user responds to volume changes (sets/week) */
  volumeSensitivity: number;  // -1 to 1: negative = needs less volume, positive = tolerates more
  /** How quickly this user progresses on each lift */
  progressionRate: Record<string, number>;  // lift -> multiplier (1.0 = average, >1 = faster)
  /** How often this user needs deloads */
  deloadFrequency: number;  // estimated weeks between needed deloads
  /** Optimal training intensity zone */
  intensityPreference: number;  // 0-1: lower = responds better to volume, higher = responds to intensity
  /** Recovery capacity estimate */
  recoveryCapacity: 'low' | 'normal' | 'high';
  /** Confidence in estimates (0-1, increases with more data) */
  confidence: number;
  /** Number of data points used */
  dataPoints: number;
  /** Last updated */
  lastUpdated: string;
}

export interface PersonalizedRecommendation {
  category: 'volume' | 'intensity' | 'frequency' | 'deload' | 'progression' | 'exercise';
  recommendation: string;
  reasoning: string;
  confidence: number;
  dataPoints: number;
}

// ─── Math Utilities ───

/**
 * Simple linear regression on (x, y) pairs.
 * Returns slope, intercept, and R² (coefficient of determination).
 */
export function linearRegression(
  points: [number, number][],
): { slope: number; intercept: number; r2: number } {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0, r2: 0 };
  if (n === 1) return { slope: 0, intercept: points[0][1], r2: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (const [x, y] of points) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
    sumY2 += y * y;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-10) {
    return { slope: 0, intercept: sumY / n, r2: 0 };
  }

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R² calculation
  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (const [x, y] of points) {
    ssTot += (y - meanY) ** 2;
    ssRes += (y - (slope * x + intercept)) ** 2;
  }
  const r2 = ssTot < 1e-10 ? 0 : Math.max(0, 1 - ssRes / ssTot);

  return { slope, intercept, r2 };
}

/**
 * Pearson correlation coefficient between two arrays.
 * Returns a value in [-1, 1], or 0 if inputs are invalid.
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;

  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let covXY = 0, varX = 0, varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    covXY += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  const denominator = Math.sqrt(varX * varY);
  if (denominator < 1e-10) return 0;

  return covXY / denominator;
}

// ─── Data Extraction Helpers ───

/** ISO date string -> week index (weeks since epoch, for grouping) */
function dateToWeekIndex(dateStr: string): number {
  const ms = new Date(dateStr).getTime();
  return Math.floor(ms / (7 * 24 * 60 * 60 * 1000));
}

/** Group logs by calendar week and compute per-week aggregates */
interface WeekSummary {
  weekIndex: number;
  totalSets: number;
  avgRPE: number;
  avgFormScore: number;
  sessionCount: number;
  difficulty: string[];  // session difficulty ratings
  readinessScores: number[];
}

function groupByWeek(logs: WorkoutLog[]): WeekSummary[] {
  const weekMap = new Map<number, {
    sets: number;
    rpeValues: number[];
    formScores: number[];
    sessions: number;
    difficulties: string[];
    readinessScores: number[];
  }>();

  for (const log of logs) {
    const wi = dateToWeekIndex(log.date);
    if (!weekMap.has(wi)) {
      weekMap.set(wi, {
        sets: 0, rpeValues: [], formScores: [], sessions: 0,
        difficulties: [], readinessScores: [],
      });
    }
    const w = weekMap.get(wi)!;
    w.sessions++;
    if (log.sessionDifficulty) {
      w.difficulties.push(log.sessionDifficulty);
    }

    // Readiness composite score (1-5 scale, higher = better readiness)
    if (log.readiness) {
      const r = log.readiness;
      const readinessScore = (
        r.sleepQuality +
        r.motivation +
        (6 - r.stress) +    // invert: low stress = high readiness
        (6 - r.soreness)    // invert: low soreness = high readiness
      ) / 4;
      w.readinessScores.push(readinessScore);
    }

    for (const set of log.sets) {
      if (!set.completed) continue;
      w.sets++;
      if (set.rpe != null && set.rpe > 0) {
        w.rpeValues.push(set.rpe);
      }
      if (set.formScore != null && set.formScore > 0) {
        w.formScores.push(set.formScore);
      }
    }
  }

  const summaries: WeekSummary[] = [];
  for (const [weekIndex, data] of weekMap) {
    summaries.push({
      weekIndex,
      totalSets: data.sets,
      avgRPE: data.rpeValues.length > 0
        ? data.rpeValues.reduce((a, b) => a + b, 0) / data.rpeValues.length
        : 0,
      avgFormScore: data.formScores.length > 0
        ? data.formScores.reduce((a, b) => a + b, 0) / data.formScores.length
        : 0,
      sessionCount: data.sessions,
      difficulty: data.difficulties,
      readinessScores: data.readinessScores,
    });
  }

  // Sort by week index ascending
  summaries.sort((a, b) => a.weekIndex - b.weekIndex);
  return summaries;
}

/** Extract per-lift weight progression from logs */
interface LiftProgression {
  lift: string;
  dataPoints: Array<{ date: string; weight: number; reps: number }>;
}

function extractLiftProgressions(logs: WorkoutLog[]): LiftProgression[] {
  const liftMap = new Map<string, Array<{ date: string; weight: number; reps: number }>>();

  for (const log of logs) {
    for (const set of log.sets) {
      if (!set.completed || !set.actualWeight || !set.actualReps) continue;
      const lift = set.exerciseSlot;
      if (!liftMap.has(lift)) liftMap.set(lift, []);
      liftMap.get(lift)!.push({
        date: log.date,
        weight: set.actualWeight,
        reps: set.actualReps,
      });
    }
  }

  const result: LiftProgression[] = [];
  for (const [lift, dataPoints] of liftMap) {
    dataPoints.sort((a, b) => a.date.localeCompare(b.date));
    result.push({ lift, dataPoints });
  }
  return result;
}

// ─── Model Building ───

/**
 * Compute volume sensitivity: Pearson correlation between weekly set counts
 * and average RPE/form quality over 8+ weeks of data.
 *
 * Negative correlation with RPE means more volume → higher RPE (volume-sensitive).
 * Negative correlation with form scores means more volume → worse form.
 */
function computeVolumeSensitivity(weeks: WeekSummary[]): number {
  // Need enough weeks with both volume and RPE data
  const validWeeks = weeks.filter(w => w.totalSets > 0 && w.avgRPE > 0);
  if (validWeeks.length < MIN_WEEKS_FOR_VOLUME) return 0;

  const volumes = validWeeks.map(w => w.totalSets);
  const rpes = validWeeks.map(w => w.avgRPE);

  // Correlation between volume and RPE:
  // positive correlation → higher volume → higher RPE (volume-sensitive → negative sensitivity)
  const rpeCorr = pearsonCorrelation(volumes, rpes);

  // Also consider form score correlation if available
  const withForm = validWeeks.filter(w => w.avgFormScore > 0);
  if (withForm.length >= MIN_WEEKS_FOR_VOLUME) {
    const formVolumes = withForm.map(w => w.totalSets);
    const formScores = withForm.map(w => w.avgFormScore);
    // Positive correlation means more volume → higher form scores (good)
    const formCorr = pearsonCorrelation(formVolumes, formScores);

    // Blend: RPE corr (inverted) and form corr (direct)
    // volume-sensitive = high RPE with volume + low form with volume
    return clamp((-rpeCorr + formCorr) / 2, -1, 1);
  }

  // Only RPE available: invert it
  return clamp(-rpeCorr, -1, 1);
}

/**
 * Compute progression rate per lift: ratio of actual weight gain rate
 * to expected rate (based on program-defined increments).
 *
 * Expected baseline: 5 lbs/week for squat/deadlift, 2.5 lbs/week for bench/OHP.
 */
function computeProgressionRates(
  liftProgressions: LiftProgression[],
): Record<string, number> {
  const EXPECTED_WEEKLY_RATE: Record<string, number> = {
    squat: 5,
    bench: 2.5,
    deadlift: 5,
    ohp: 2.5,
    row: 2.5,
  };

  const rates: Record<string, number> = {};

  for (const { lift, dataPoints } of liftProgressions) {
    if (dataPoints.length < 3) continue;

    // Use the max weight per session for trend analysis
    const sessionMaxes = new Map<string, number>();
    for (const dp of dataPoints) {
      const dateKey = dp.date.slice(0, 10);
      const current = sessionMaxes.get(dateKey) ?? 0;
      if (dp.weight > current) sessionMaxes.set(dateKey, dp.weight);
    }

    const points: [number, number][] = [];
    const dates = [...sessionMaxes.keys()].sort();
    const baseDate = new Date(dates[0]).getTime();
    for (const date of dates) {
      const weeksSince = (new Date(date).getTime() - baseDate) / (7 * 24 * 60 * 60 * 1000);
      points.push([weeksSince, sessionMaxes.get(date)!]);
    }

    if (points.length < 2) continue;

    const { slope } = linearRegression(points);
    const expected = EXPECTED_WEEKLY_RATE[lift] ?? 2.5;
    // Ratio of actual weekly gain to expected
    const ratio = expected > 0 ? slope / expected : 1;
    rates[lift] = Math.max(0, Math.min(3, ratio));  // clamp to [0, 3]
  }

  return rates;
}

/**
 * Estimate deload frequency: average weeks between sessions rated "too_hard"
 * or "could_not_finish", or weeks where RPE averaged > 9.
 */
function computeDeloadFrequency(weeks: WeekSummary[]): number {
  if (weeks.length < 4) return 4;  // default: 4-week cycles

  const deloadWeekIndices: number[] = [];
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const hasHardSession = w.difficulty.some(
      d => d === 'too_hard' || d === 'could_not_finish',
    );
    const highRPE = w.avgRPE >= 9;

    if (hasHardSession || highRPE) {
      deloadWeekIndices.push(i);
    }
  }

  if (deloadWeekIndices.length < 2) {
    // Not enough deload signals — default estimate
    return Math.min(weeks.length, 6);
  }

  // Average gap between deload-needing weeks
  let totalGap = 0;
  for (let i = 1; i < deloadWeekIndices.length; i++) {
    totalGap += deloadWeekIndices[i] - deloadWeekIndices[i - 1];
  }
  const avgGap = totalGap / (deloadWeekIndices.length - 1);
  return Math.max(2, Math.min(8, Math.round(avgGap * 10) / 10));
}

/**
 * Compute intensity preference: compare completion rate and RPE on
 * high-intensity (fewer sets, heavier) vs high-volume (more sets, lighter) days.
 */
function computeIntensityPreference(logs: WorkoutLog[]): number {
  let intensityDaySessions = 0;
  let volumeDaySessions = 0;
  let intensityDayCompletionSum = 0;
  let volumeDayCompletionSum = 0;

  for (const log of logs) {
    if (log.sets.length === 0) continue;

    const completedSets = log.sets.filter(s => s.completed);
    if (completedSets.length === 0) continue;

    const completionRate = completedSets.length / log.sets.length;
    const avgWeight = completedSets.reduce(
      (sum, s) => sum + (s.actualWeight ?? s.targetWeight), 0,
    ) / completedSets.length;
    const setCount = completedSets.length;

    // Classify session: intensity-focused (fewer sets, heavier) vs volume-focused
    // Use a heuristic: below-median set count = intensity day
    if (setCount <= 12) {
      intensityDaySessions++;
      intensityDayCompletionSum += completionRate;
    } else {
      volumeDaySessions++;
      volumeDayCompletionSum += completionRate;
    }
  }

  if (intensityDaySessions === 0 || volumeDaySessions === 0) return 0.5;

  const intensityAvg = intensityDayCompletionSum / intensityDaySessions;
  const volumeAvg = volumeDayCompletionSum / volumeDaySessions;

  // Higher completion rate on intensity days → higher intensity preference
  // Scale to 0-1 range
  const diff = intensityAvg - volumeAvg;
  return clamp(0.5 + diff, 0, 1);
}

/**
 * Estimate recovery capacity from readiness scores, session difficulty,
 * and deload frequency.
 */
function computeRecoveryCapacity(
  weeks: WeekSummary[],
  deloadFreq: number,
): 'low' | 'normal' | 'high' {
  // Factor 1: Average readiness scores
  const allReadiness: number[] = [];
  for (const w of weeks) {
    allReadiness.push(...w.readinessScores);
  }
  const avgReadiness = allReadiness.length > 0
    ? allReadiness.reduce((a, b) => a + b, 0) / allReadiness.length
    : 3; // default neutral

  // Factor 2: Frequency of "too hard" ratings
  let totalSessions = 0;
  let hardSessions = 0;
  for (const w of weeks) {
    totalSessions += w.sessionCount;
    hardSessions += w.difficulty.filter(
      d => d === 'too_hard' || d === 'could_not_finish',
    ).length;
  }
  const hardRate = totalSessions > 0 ? hardSessions / totalSessions : 0;

  // Factor 3: Deload frequency (longer between deloads = better recovery)
  const deloadScore = deloadFreq >= 5 ? 1 : deloadFreq >= 3.5 ? 0 : -1;

  // Composite score
  const readinessScore = avgReadiness >= 4 ? 1 : avgReadiness >= 3 ? 0 : -1;
  const hardnessScore = hardRate <= 0.1 ? 1 : hardRate <= 0.25 ? 0 : -1;

  const composite = readinessScore + hardnessScore + deloadScore;

  if (composite >= 2) return 'high';
  if (composite <= -2) return 'low';
  return 'normal';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ─── Main Model Builder ───

/**
 * Analyze the user's training history to build a personalized model.
 * Uses simple statistical methods (moving averages, linear regression,
 * correlation analysis) on accumulated workout data.
 *
 * Returns null if there are fewer than MIN_WORKOUTS_FOR_MODEL logged workouts.
 */
export function buildPersonalModel(
  logs: WorkoutLog[],
  _state: ProgramState,
): TrainingResponse | null {
  if (logs.length < MIN_WORKOUTS_FOR_MODEL) return null;

  const weeks = groupByWeek(logs);
  const liftProgressions = extractLiftProgressions(logs);

  const volumeSensitivity = computeVolumeSensitivity(weeks);
  const progressionRate = computeProgressionRates(liftProgressions);
  const deloadFrequency = computeDeloadFrequency(weeks);
  const intensityPreference = computeIntensityPreference(logs);
  const recoveryCapacity = computeRecoveryCapacity(weeks, deloadFrequency);
  const confidence = Math.min(1, logs.length / FULL_CONFIDENCE_THRESHOLD);

  return {
    volumeSensitivity,
    progressionRate,
    deloadFrequency,
    intensityPreference,
    recoveryCapacity,
    confidence,
    dataPoints: logs.length,
    lastUpdated: new Date().toISOString(),
  };
}

// ─── Personalized Recommendations ───

/**
 * Generate personalized training recommendations based on the learned model.
 * Only produces recommendations with confidence above 0.2 (10+ workouts).
 */
export function getPersonalizedRecommendations(
  model: TrainingResponse,
  currentProgram?: string,
): PersonalizedRecommendation[] {
  const recs: PersonalizedRecommendation[] = [];

  // Volume recommendations
  if (model.volumeSensitivity < -0.3) {
    recs.push({
      category: 'volume',
      recommendation:
        'Your data shows you are volume-sensitive — form and RPE degrade when weekly sets increase. ' +
        'Consider lower-volume, higher-intensity templates.',
      reasoning:
        `Volume-RPE correlation of ${model.volumeSensitivity.toFixed(2)} indicates ` +
        `diminishing returns from high volume. ` +
        (currentProgram === 'sbs_hypertrophy' || currentProgram === 'nippard_powerbuilding'
          ? 'Consider switching to a strength-focused template like Texas Method or 5/3/1 FSL.'
          : 'Prioritize intensity over volume in your training.'),
      confidence: model.confidence,
      dataPoints: model.dataPoints,
    });
  } else if (model.volumeSensitivity > 0.3) {
    recs.push({
      category: 'volume',
      recommendation:
        'Your data shows you tolerate higher training volume well. ' +
        'You may benefit from higher-volume programming.',
      reasoning:
        `Volume-quality correlation of ${model.volumeSensitivity.toFixed(2)} suggests ` +
        `you recover well from higher set counts. ` +
        (currentProgram === 'texas_method' || currentProgram === 'starting_strength'
          ? 'Consider BBB, SBS Hypertrophy, or a PPL split for more volume.'
          : 'Your current volume tolerance supports continued progression.'),
      confidence: model.confidence,
      dataPoints: model.dataPoints,
    });
  }

  // Intensity preference recommendations
  if (model.intensityPreference > 0.65) {
    const suggestion = currentProgram === 'sbs_hypertrophy' || currentProgram === 'ppl'
      ? ' Consider switching from your current high-volume program to a strength-focused template like 5/3/1 FSL or Texas Method.'
      : '';
    recs.push({
      category: 'intensity',
      recommendation:
        'Your data shows you respond better to higher intensity, lower volume training.' + suggestion,
      reasoning:
        `Completion rate is ${((model.intensityPreference - 0.5) * 200).toFixed(0)}% higher ` +
        `on intensity-focused days vs volume-focused days.`,
      confidence: model.confidence,
      dataPoints: model.dataPoints,
    });
  } else if (model.intensityPreference < 0.35) {
    recs.push({
      category: 'intensity',
      recommendation:
        'Your data shows you respond better to moderate intensity, higher volume training. ' +
        'Volume-driven programs suit your training style.',
      reasoning:
        `Completion rate is ${((0.5 - model.intensityPreference) * 200).toFixed(0)}% higher ` +
        `on volume-focused days vs intensity-focused days.`,
      confidence: model.confidence,
      dataPoints: model.dataPoints,
    });
  }

  // Deload recommendations
  if (model.deloadFrequency < 3.5) {
    recs.push({
      category: 'deload',
      recommendation:
        `You've needed a deload every ${model.deloadFrequency.toFixed(1)} weeks on average. ` +
        `Consider scheduling deloads every ${Math.round(model.deloadFrequency)} weeks ` +
        `instead of the standard 4-week cycle.`,
      reasoning:
        'Frequent high-RPE sessions and difficulty ratings indicate accumulated fatigue ' +
        'builds faster than the standard programming assumes.',
      confidence: model.confidence,
      dataPoints: model.dataPoints,
    });
  } else if (model.deloadFrequency > 5) {
    recs.push({
      category: 'deload',
      recommendation:
        `Your data suggests you can train ${model.deloadFrequency.toFixed(1)} weeks ` +
        `between deloads. You may be deloading more often than necessary.`,
      reasoning:
        'Low frequency of high-RPE sessions and difficulty ratings suggests strong ' +
        'recovery capacity. Consider extending mesocycle length.',
      confidence: model.confidence,
      dataPoints: model.dataPoints,
    });
  }

  // Progression rate recommendations (per-lift)
  for (const [lift, rate] of Object.entries(model.progressionRate)) {
    if (rate > 1.3 && model.confidence >= 0.3) {
      recs.push({
        category: 'progression',
        recommendation:
          `You've been progressing on ${lift} ${rate.toFixed(1)}x faster than average. ` +
          `You may be ready to transition to an intermediate program sooner.`,
        reasoning:
          `Linear regression shows a weight gain rate of ${rate.toFixed(1)}x the expected ` +
          `baseline for ${lift}. This is a strong indicator of untapped potential or ` +
          `conservatively set starting weights.`,
        confidence: model.confidence,
        dataPoints: model.dataPoints,
      });
    } else if (rate < 0.5 && rate > 0 && model.confidence >= 0.3) {
      recs.push({
        category: 'progression',
        recommendation:
          `Your ${lift} progression is ${rate.toFixed(1)}x the expected rate. ` +
          `Consider smaller weight jumps or additional volume for this lift.`,
        reasoning:
          `Slower-than-expected progression on ${lift} may indicate a need for ` +
          `micro-loading (1.25 lb plates), additional accessory work, or a ` +
          `technique focus block.`,
        confidence: model.confidence,
        dataPoints: model.dataPoints,
      });
    }
  }

  // Recovery capacity recommendations
  if (model.recoveryCapacity === 'low') {
    recs.push({
      category: 'frequency',
      recommendation:
        'Your recovery metrics indicate below-average recovery capacity. ' +
        'Consider reducing training frequency or adding recovery-focused practices.',
      reasoning:
        'Consistently low readiness scores and frequent "too hard" session ratings ' +
        'suggest your current training load may exceed your recovery ability. ' +
        'Sleep, nutrition, and stress management improvements could help.',
      confidence: model.confidence,
      dataPoints: model.dataPoints,
    });
  } else if (model.recoveryCapacity === 'high') {
    recs.push({
      category: 'frequency',
      recommendation:
        'Your recovery metrics are above average. You could handle higher training ' +
        'frequency or volume if desired.',
      reasoning:
        'Consistently high readiness scores and rare "too hard" ratings suggest ' +
        'room for additional training stimulus.',
      confidence: model.confidence,
      dataPoints: model.dataPoints,
    });
  }

  // Filter out low-confidence recommendations
  return recs.filter(r => r.confidence >= 0.2);
}

// ─── Personalized Volume Landmarks ───

/**
 * Override population-average volume landmarks with learned personal values.
 * More accurate than the factor-based individualization because it uses
 * actual response data rather than demographic proxies.
 */
export function getPersonalizedVolumeLandmarks(
  model: TrainingResponse,
  _muscleGroup: string,
  baselineLandmarks: { mev: number; mav: number; mrv: number },
): { mev: number; mav: number; mrv: number; source: 'personal' | 'population' } {
  // Need sufficient confidence to personalize
  if (model.confidence < 0.2) {
    return { ...baselineLandmarks, source: 'population' };
  }

  let { mev, mav, mrv } = baselineLandmarks;

  // Volume sensitivity adjusts MRV and MAV
  // Positive sensitivity → can handle more volume → increase MRV
  // Negative sensitivity → needs less volume → decrease MRV
  const volumeAdjust = 1 + model.volumeSensitivity * 0.2; // ±20% at extremes
  mrv = Math.round(mrv * volumeAdjust);
  mav = Math.round(mav * (1 + model.volumeSensitivity * 0.1)); // ±10% for MAV

  // Recovery capacity adjusts overall volume tolerance
  if (model.recoveryCapacity === 'low') {
    mrv = Math.round(mrv * 0.85);
    mav = Math.round(mav * 0.9);
  } else if (model.recoveryCapacity === 'high') {
    mrv = Math.round(mrv * 1.1);
  }

  // Ensure ordering: mev <= mav <= mrv
  mev = Math.max(1, mev);
  if (mav < mev) mav = mev;
  if (mrv < mav) mrv = mav;

  return { mev, mav, mrv, source: 'personal' };
}

// ─── Program Transition Intelligence ───

/** Programs grouped by level for transition recommendations */
const PROGRAM_LEVELS: Record<string, string[]> = {
  beginner: ['starting_strength', 'gzclp', '531_beginner'],
  intermediate: ['texas_method', 'hlm_split', '531_bbb', 'nsuns', 'upper_lower_split', 'nippard_powerbuilding', 'sbs_hypertrophy', 'sbs_strength'],
  advanced: ['block_periodization', 'dup', 'conjugate'],
};

/** Program style classification */
const PROGRAM_STYLE: Record<string, 'volume' | 'intensity' | 'balanced'> = {
  starting_strength: 'intensity',
  gzclp: 'balanced',
  '531_beginner': 'balanced',
  texas_method: 'intensity',
  hlm_split: 'balanced',
  '531_bbb': 'volume',
  nsuns: 'volume',
  upper_lower_split: 'balanced',
  nippard_powerbuilding: 'volume',
  block_periodization: 'balanced',
  dup: 'intensity',
  conjugate: 'intensity',
  sbs_hypertrophy: 'volume',
  sbs_strength: 'intensity',
  ppl: 'volume',
};

function getProgramLevel(programId: string): string {
  for (const [level, ids] of Object.entries(PROGRAM_LEVELS)) {
    if (ids.includes(programId)) return level;
  }
  return 'intermediate';  // default
}

/**
 * Use the personal model to recommend when and what to transition to.
 * More nuanced than the rule-based system because it considers the user's
 * actual response patterns, not just stall counts.
 */
export function getSmartTransitionRecommendation(
  model: TrainingResponse,
  currentProgram: string,
  programHistory: string[],
): { shouldTransition: boolean; recommendedProgram?: string; reasoning: string } | null {
  if (model.confidence < 0.3) {
    return null;  // Not enough data for transition intelligence
  }

  const currentLevel = getProgramLevel(currentProgram);
  const currentStyle = PROGRAM_STYLE[currentProgram] ?? 'balanced';

  // Check for fast progressors on beginner programs
  const avgProgressionRate = Object.values(model.progressionRate).length > 0
    ? Object.values(model.progressionRate).reduce((a, b) => a + b, 0) /
      Object.values(model.progressionRate).length
    : 1;

  // Fast progressor still on beginner program → no need to rush transition
  if (currentLevel === 'beginner' && avgProgressionRate > 1.2) {
    return {
      shouldTransition: false,
      reasoning:
        `You're progressing ${avgProgressionRate.toFixed(1)}x faster than average on your ` +
        `current program. Stay on it — fast LP gains are the most efficient progress you'll ever make.`,
    };
  }

  // Slow progressor on beginner program → might need to transition
  if (currentLevel === 'beginner' && avgProgressionRate < 0.4 && model.confidence >= 0.4) {
    // Find a matching intermediate program
    const recommended = findBestProgram(model, 'intermediate', programHistory);
    return {
      shouldTransition: true,
      recommendedProgram: recommended,
      reasoning:
        `Your progression rate (${avgProgressionRate.toFixed(1)}x expected) suggests ` +
        `linear progression may be stalling. An intermediate program with periodization ` +
        `could resume progress.`,
    };
  }

  // Style mismatch: volume-sensitive user on volume program
  if (model.volumeSensitivity < -0.3 && currentStyle === 'volume') {
    const recommended = findBestProgram(model, currentLevel, programHistory, 'intensity');
    return {
      shouldTransition: true,
      recommendedProgram: recommended,
      reasoning:
        `Your training data shows you're volume-sensitive (${model.volumeSensitivity.toFixed(2)}), ` +
        `but your current program (${currentProgram}) is volume-focused. ` +
        `An intensity-focused program would better match your response profile.`,
    };
  }

  // Style mismatch: volume-tolerant user on intensity program
  if (model.volumeSensitivity > 0.3 && currentStyle === 'intensity' && currentLevel !== 'beginner') {
    const recommended = findBestProgram(model, currentLevel, programHistory, 'volume');
    return {
      shouldTransition: true,
      recommendedProgram: recommended,
      reasoning:
        `Your training data shows you tolerate volume well (${model.volumeSensitivity.toFixed(2)}), ` +
        `but your current program is intensity-focused. ` +
        `A higher-volume program could drive more progress.`,
    };
  }

  // No transition needed
  return {
    shouldTransition: false,
    reasoning: 'Your current program matches your training response profile well.',
  };
}

function findBestProgram(
  model: TrainingResponse,
  targetLevel: string,
  programHistory: string[],
  preferredStyle?: 'volume' | 'intensity' | 'balanced',
): string | undefined {
  const candidates = PROGRAM_LEVELS[targetLevel] ?? [];
  const style = preferredStyle ?? (model.intensityPreference > 0.6 ? 'intensity' : 'volume');

  // Score candidates
  const scored = candidates.map(id => {
    let score = 0;

    // Prefer programs not yet tried
    if (!programHistory.includes(id)) score += 2;

    // Match style preference
    const programStyle = PROGRAM_STYLE[id] ?? 'balanced';
    if (programStyle === style) score += 3;
    else if (programStyle === 'balanced') score += 1;

    return { id, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.id;
}

// ─── Storage ───

/**
 * Save the personal model to localStorage.
 */
export function savePersonalModel(model: TrainingResponse): void {
  try {
    localStorage.setItem(PERSONAL_MODEL_KEY, JSON.stringify(model));
  } catch {
    // Graceful fallback — model is not critical, can be rebuilt
  }
}

/**
 * Load the personal model from localStorage.
 */
export function loadPersonalModel(): TrainingResponse | null {
  try {
    const raw = localStorage.getItem(PERSONAL_MODEL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Validate essential fields
    if (
      typeof parsed.volumeSensitivity !== 'number' ||
      typeof parsed.confidence !== 'number' ||
      typeof parsed.dataPoints !== 'number'
    ) {
      return null;
    }
    return parsed as TrainingResponse;
  } catch {
    return null;
  }
}
