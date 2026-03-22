/**
 * Adaptation engine: post-workout feedback processing, autoregulation,
 * injury handling, transition recommendations, accessory recommendations,
 * and training efficiency analysis.
 *
 * Evidence basis:
 * - Zourdos et al. (2016) — RPE autoregulation
 * - Helms et al. (2016) — RIR-based training
 * - PMC10948666 — Deload practices
 * - PMC10511399 — Integrating deloading (Delphi consensus)
 * - Meeusen et al. (2013) — Overtraining consensus
 * - Grandou et al. (2020) — Overreaching markers and management
 */

import type { ProgramDefinition, UserProfile, EquipmentLevel } from './workout-programs';
import { PROGRAMS, EXERCISE_SLOTS, getExerciseName, recommendPrograms } from './workout-programs';
import type { ProgramState, LiftProgress, WorkoutLog, ReadinessData, SessionDifficulty } from './workout-storage';
import { loadWorkoutLogs } from './workout-storage';
import { roundToPlate, enforceBarMinimum } from './progression-engine';

// ─── Utilities ───

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Post-Workout Feedback Types ───

export type InjuryStatus = 'none' | 'minor_discomfort' | 'pain_during_exercise' | 'pain_after_exercise' | 'cannot_perform';
export type SorenessLevel = 'none' | 'mild' | 'moderate' | 'severe' | 'extreme';

export interface PostWorkoutFeedback {
  sessionDifficulty: SessionDifficulty;
  /** Per-lift RPE (user-reported, 6-10 scale) */
  liftRPE: Record<string, number>;
  /** Overall session RPE */
  sessionRPE: number;
  /** Soreness level */
  soreness: SorenessLevel;
  /** Any injury/discomfort reports per body area */
  injuries: InjuryReport[];
  /** Free-form notes */
  notes: string;
}

export interface InjuryReport {
  bodyArea: string;        // 'lower_back', 'knees', 'shoulders', 'elbows', 'hips', 'wrists', 'neck', 'upper_back', 'groin'
  status: InjuryStatus;
  /** Which exercises aggravated it */
  aggravatingExercises: string[];
  /** Red flag symptoms */
  redFlags?: string[]; // 'sudden_onset', 'numbness_tingling', 'radiating_pain', 'swelling_deformity', 'joint_locking'
}

// ─── Adaptation Decision Engine ───

export interface AdaptationDecision {
  type: 'weight_increase' | 'weight_decrease' | 'volume_decrease' | 'force_deload' |
        'program_transition' | 'exercise_substitution' | 'increment_change' | 'phase_advance' | 'info';
  lift?: string;
  description: string;
  /** Science citation for this decision */
  citation: string;
  /** Whether the adaptation was applied automatically */
  applied: boolean;
}

/**
 * A weight change recommendation that may or may not be auto-applied.
 * Form-score-based reductions are presented as recommendations (autoApply: false)
 * so the user can confirm or dismiss them. Injury and RPE adjustments
 * are auto-applied for safety or because they use user-reported data.
 */
export interface WeightRecommendation {
  lift: string;
  currentWeight: number;
  recommendedWeight: number;
  reason: string;
  severity: 'suggestion' | 'warning' | 'urgent';
  source: 'form_score' | 'rpe' | 'fatigue' | 'injury';
  autoApply: boolean;
}

/**
 * Result from the adaptation engine containing both applied decisions
 * and pending recommendations that require user confirmation.
 */
export interface AdaptationResult {
  /** Decisions that have been applied or are informational */
  decisions: AdaptationDecision[];
  /** Weight change recommendations pending user confirmation */
  recommendations: WeightRecommendation[];
}

/**
 * Core adaptation engine: processes all feedback signals and returns
 * a list of adaptation decisions. Some are applied automatically,
 * others are recommendations for the user.
 *
 * Feedback signals (priority order):
 * 1. Injury reports → exercise substitution or forced rest (safety-first)
 * 2. Form scores from CV analysis → technique-driven weight adjustment
 * 3. Post-workout RPE + difficulty → load/volume autoregulation
 * 4. Readiness data → proactive deload triggers
 * 5. Stall count → program transition recommendations
 * 6. Training age (weeks on program) → phase advancement
 *
 * Evidence basis:
 * - Zourdos et al. (2016): RPE-based autoregulation
 * - Helms et al. (2016): RIR-based training for strength athletes
 * - PMC10948666: Deload practices in resistance-trained individuals
 * - PMC10511399: Integrating deloading (Delphi consensus)
 * - Meeusen et al. (2013): European College of Sport Science overtraining consensus
 * - Grandou et al. (2020): Overreaching in resistance training — markers and management
 */
export function processAdaptations(
  state: ProgramState,
  feedback: PostWorkoutFeedback,
  readiness: ReadinessData | undefined,
  recentLogs: WorkoutLog[],
  formScores?: Record<string, number>,
): AdaptationDecision[];
export function processAdaptations(
  state: ProgramState,
  feedback: PostWorkoutFeedback,
  readiness: ReadinessData | undefined,
  recentLogs: WorkoutLog[],
  formScores: Record<string, number> | undefined,
  returnResult: true,
): AdaptationResult;
export function processAdaptations(
  state: ProgramState,
  feedback: PostWorkoutFeedback,
  readiness: ReadinessData | undefined,
  recentLogs: WorkoutLog[],
  formScores?: Record<string, number>,
  returnResult?: boolean,
): AdaptationDecision[] | AdaptationResult {
  const decisions: AdaptationDecision[] = [];
  const recommendations: WeightRecommendation[] = [];
  const program = PROGRAMS[state.programId];
  if (!program) return returnResult ? { decisions, recommendations } : decisions;

  // ═══ SIGNAL 0: Red Flag Screening (absolute highest priority) ═══
  for (const injury of feedback.injuries) {
    if (injury.redFlags && injury.redFlags.length > 0) {
      decisions.unshift({
        type: 'info',
        description: `RED FLAG: ${injury.redFlags.join(', ')} reported for ${formatBodyArea(injury.bodyArea)}. ` +
          `STOP ALL TRAINING IMMEDIATELY and seek medical evaluation before your next session. ` +
          `These symptoms may indicate a serious injury requiring professional diagnosis.`,
        citation: 'ACSM Guidelines (2021): Red flag symptoms (sudden severe pain, neurological symptoms, joint instability, visible swelling) require immediate medical evaluation.',
        applied: false,
      });
    }
  }

  // ═══ SIGNAL 0.5: Persistent Injury Tracking ═══
  const previousInjuryHistory = state.injuryHistory ?? {};
  const currentInjuryHistory: Record<string, number> = { ...previousInjuryHistory };
  const currentlyReportedAreas = new Set(feedback.injuries.map(i => i.bodyArea));

  // Update injury history: increment for reported areas, clear for resolved areas
  for (const injury of feedback.injuries) {
    currentInjuryHistory[injury.bodyArea] = (previousInjuryHistory[injury.bodyArea] ?? 0) + 1;
  }

  // Check for persistent injuries (3+ consecutive sessions)
  for (const [area, consecutiveCount] of Object.entries(currentInjuryHistory)) {
    if (currentlyReportedAreas.has(area) && consecutiveCount >= 3) {
      decisions.unshift({
        type: 'info',
        description: `IMPORTANT: You have reported ${formatBodyArea(area)} pain for ${consecutiveCount} consecutive sessions. ` +
          `STOP training movements that aggravate this area and consult a physiotherapist or sports medicine doctor before continuing. ` +
          `Persistent pain lasting more than 2 weeks is NOT normal training soreness and may indicate a condition that worsens with continued loading.`,
        citation: 'ACSM Guidelines (2021): Pain persisting beyond 2 weeks warrants professional evaluation. Continuing to load injured tissue without diagnosis risks progression from acute to chronic injury.',
        applied: false,
      });
    }
  }

  // Return-to-training protocol for resolved injuries
  for (const [area, _count] of Object.entries(previousInjuryHistory)) {
    if (!currentlyReportedAreas.has(area) && previousInjuryHistory[area] > 0) {
      // This area was previously injured but not reported this session — it's resolving
      const affectedLifts = getAffectedLifts(area);
      for (const affectedLift of affectedLifts) {
        decisions.push({
          type: 'weight_decrease',
          lift: affectedLift,
          description: `Returning to ${formatBodyArea(area)} exercises after injury. Starting at 70% of previous weight for 1-2 sessions, ` +
            `then 85% for 1-2 sessions, then resume normal progression. This graduated return reduces reinjury risk.`,
          citation: 'Blanch & Gabbett (2016): Acute-to-chronic workload ratio — rapid return to full load after injury significantly increases reinjury risk.',
          applied: true,
        });
      }
      // Clear the count for this resolved area
      currentInjuryHistory[area] = 0;
    }
  }

  state.injuryHistory = currentInjuryHistory;

  // ═══ SIGNAL 1: Injury Reports (highest priority — safety first) ═══
  for (const injury of feedback.injuries) {
    if (injury.status === 'cannot_perform' || injury.status === 'pain_during_exercise') {
      for (const exercise of injury.aggravatingExercises) {
        const substitutions = getInjurySubstitutions(injury.bodyArea, exercise, state.equipment);
        decisions.push({
          type: 'exercise_substitution',
          lift: exercise,
          description: `${formatBodyArea(injury.bodyArea)} ${injury.status === 'cannot_perform' ? 'prevents' : 'causes pain during'} ${exercise}. ` +
            `Substituting with: ${substitutions.join(', ')}. ` +
            `If pain persists beyond 2 weeks, consult a physiotherapist or sports medicine doctor.`,
          citation: 'ACSM Guidelines for Exercise Testing and Prescription, 11th ed. (2021): discontinue exercise that causes acute pain; modify or substitute.',
          applied: false,
        });
      }

      // If severe, remove aggravating movement entirely
      if (injury.status === 'cannot_perform') {
        decisions.push({
          type: 'volume_decrease',
          description: `Removing aggravating exercise entirely and substituting with safe alternatives at full volume. ` +
            `Do NOT attempt the original movement until cleared by a healthcare professional or the pain fully resolves.`,
          citation: 'ACSM Guidelines (2021): Exercises causing acute pain should be discontinued, not merely reduced. Substitution maintains training stimulus without aggravating the injury.',
          applied: true,
        });
      }
    }

    if (injury.status === 'minor_discomfort' || injury.status === 'pain_after_exercise') {
      decisions.push({
        type: 'info',
        description: `Monitoring ${formatBodyArea(injury.bodyArea)} discomfort. If this persists for 3+ sessions or worsens, ` +
          `exercise substitutions will be automatically applied. Mild post-exercise soreness is normal; ` +
          `sharp, localized, or worsening pain is not.`,
        citation: 'Grandou et al. (2020): Distinguish between DOMS (delayed onset muscle soreness, normal) and injury pain (sharp, joint-specific, worsening).',
        applied: false,
      });
    }
  }

  // ═══ SIGNAL 2: Form Scores from CV Analysis ═══
  // Form-score-based reductions are generated as RECOMMENDATIONS (not auto-applied)
  // so the user can confirm or dismiss them. The rationale: form scores come from
  // computer vision which can be noisy, and the user should have final say on
  // whether to reduce weight based on technique feedback.
  if (formScores) {
    for (const [lift, score] of Object.entries(formScores)) {
      const progress = state.liftProgress[lift];
      if (!progress) continue;

      if (score < 60) {
        // Severe form breakdown — recommend aggressive weight reduction
        const reducedWeight = enforceBarMinimum(
          roundToPlate(progress.currentWeight * 0.88, progress.unit),
          progress.unit,
        );
        const reason = `${capitalize(lift)} form score ${score}/100 indicates significant technique breakdown. ` +
          `Recommending ${reducedWeight} ${progress.unit} (-12%) to rebuild movement quality. ` +
          `Focus on controlled tempo and full range of motion for the next 2-3 sessions before progressing.`;
        recommendations.push({
          lift,
          currentWeight: progress.currentWeight,
          recommendedWeight: reducedWeight,
          reason,
          severity: 'urgent',
          source: 'form_score',
          autoApply: false,
        });
        decisions.push({
          type: 'weight_decrease',
          lift,
          description: reason,
          citation: 'Helms et al. (2016): Technique degradation under load indicates the weight exceeds current neuromuscular capacity. Reduce load to re-establish motor patterns.',
          applied: false,
        });
      } else if (score < 70) {
        const reducedWeight = enforceBarMinimum(
          roundToPlate(progress.currentWeight * 0.92, progress.unit),
          progress.unit,
        );
        const reason = `${capitalize(lift)} form score ${score}/100 — recommending ${reducedWeight} ${progress.unit} (-8%) for technique reinforcement.`;
        recommendations.push({
          lift,
          currentWeight: progress.currentWeight,
          recommendedWeight: reducedWeight,
          reason,
          severity: 'warning',
          source: 'form_score',
          autoApply: false,
        });
        decisions.push({
          type: 'weight_decrease',
          lift,
          description: reason,
          citation: 'Helms et al. (2016): Sub-70 form scores warrant load reduction.',
          applied: false,
        });
      } else if (score >= 90) {
        decisions.push({
          type: 'info',
          lift,
          description: `${capitalize(lift)} form score ${score}/100 — excellent technique. Safe to continue progressing.`,
          citation: 'Helms et al. (2016): Consistent technique at high loads indicates adequate neuromuscular adaptation — safe to progress. Zourdos et al. (2016, PMID: 26666744): High movement quality at target RPE supports load increases.',
          applied: false,
        });
      }
    }
  }

  // ═══ SIGNAL 3: Post-Workout RPE + Difficulty Feedback ═══
  const { decisions: difficultyActions, adjustedLifts: adjustedByDifficulty } = processDifficultyFeedback(state, feedback, program);
  decisions.push(...difficultyActions);

  // Per-lift RPE adjustments — skip lifts already adjusted by difficulty feedback
  for (const [lift, rpe] of Object.entries(feedback.liftRPE)) {
    if (adjustedByDifficulty.has(lift)) continue; // Already adjusted by difficulty handler
    const progress = state.liftProgress[lift];
    if (!progress) continue;

    if (rpe >= 10) {
      // Max effort — hold weight or slight deload
      decisions.push({
        type: 'info',
        lift,
        description: `${capitalize(lift)} RPE 10 (max effort). Holding current weight next session. ` +
          `Grinding reps at RPE 10 regularly increases injury risk and fatigue accumulation.`,
        citation: 'Tuchscherer (RTS): Consistent RPE 10 training leads to overreaching. Target RPE 7-9 for productive training.',
        applied: false,
      });
    } else if (rpe <= 6 && feedback.sessionDifficulty !== 'too_hard') {
      // Very easy — can increase more aggressively, but cap bonus for safety
      const maxBonus = progress.unit === 'kg' ? 5 : 10;
      const bonusWeight = roundToPlate(progress.currentWeight + Math.min(progress.increment * 1.5, maxBonus), progress.unit);
      progress.currentWeight = bonusWeight;
      decisions.push({
        type: 'weight_increase',
        lift,
        description: `${capitalize(lift)} RPE ${rpe} — increasing to ${bonusWeight} ${progress.unit} (1.5x normal increment, capped for safety). ` +
          `You have significant capacity in reserve.`,
        citation: 'Zourdos et al. (2016): When RPE is consistently below target, load should be increased to maintain the intended training stimulus.',
        applied: true,
      });
    }
  }

  // ═══ SIGNAL 4: Readiness Data ═══
  if (readiness) {
    const readinessActions = processReadiness(state, readiness, recentLogs, program);
    decisions.push(...readinessActions);
  }

  // ═══ SIGNAL 5: Accumulated Fatigue → Forced Deload ═══
  const fatigueDecision = checkForcedDeload(state, recentLogs, feedback);
  if (fatigueDecision) decisions.push(fatigueDecision);

  // ═══ SIGNAL 6: Training Age → Phase/Program Advancement ═══
  const advanceDecision = checkPhaseAdvancement(state, recentLogs, program);
  if (advanceDecision) decisions.push(advanceDecision);

  return returnResult ? { decisions, recommendations } : decisions;
}

/**
 * Apply a pending weight recommendation (called when user confirms).
 * Updates the lift progress with the recommended weight.
 */
export function applyWeightRecommendation(
  state: ProgramState,
  recommendation: WeightRecommendation,
): void {
  const progress = state.liftProgress[recommendation.lift];
  if (!progress) return;
  progress.currentWeight = enforceBarMinimum(recommendation.recommendedWeight, progress.unit);
}

// ─── Difficulty Feedback Processing ───

function processDifficultyFeedback(
  state: ProgramState,
  feedback: PostWorkoutFeedback,
  _program: ProgramDefinition,
): { decisions: AdaptationDecision[]; adjustedLifts: Set<string> } {
  const decisions: AdaptationDecision[] = [];
  const adjustedLifts = new Set<string>();

  switch (feedback.sessionDifficulty) {
    case 'too_easy': {
      // Increase weights across the board
      for (const [lift, progress] of Object.entries(state.liftProgress)) {
        // Don't double-adjust if per-lift RPE already triggered an increase
        if (feedback.liftRPE[lift] !== undefined && feedback.liftRPE[lift] <= 6) continue;

        const newWeight = roundToPlate(progress.currentWeight + progress.increment, progress.unit);
        progress.currentWeight = newWeight;
        adjustedLifts.add(lift);
      }
      decisions.push({
        type: 'weight_increase',
        description: `Session rated "too easy" — advancing all lifts by one increment. ` +
          `If sessions consistently feel too easy for 3+ weeks, consider switching to a higher-volume program.`,
        citation: 'Progressive overload principle (Kraemer & Ratamess 2004): Training must exceed current capacity to drive adaptation.',
        applied: true,
      });
      break;
    }

    case 'too_hard': {
      // Don't reduce weights on first "too hard" — track pattern
      const recentTooHard = countRecentDifficulty(state, 'too_hard');
      if (recentTooHard >= 2) {
        // Multiple "too hard" sessions — reduce by 5%
        for (const [lift, progress] of Object.entries(state.liftProgress)) {
          progress.currentWeight = enforceBarMinimum(
            roundToPlate(progress.currentWeight * 0.95, progress.unit),
            progress.unit,
          );
          adjustedLifts.add(lift);
        }
        decisions.push({
          type: 'weight_decrease',
          description: `Multiple sessions rated "too hard" — reducing all weights by 5%. ` +
            `Consistently exceeding your recovery capacity leads to overreaching, not progress. ` +
            `If this persists, a deload week or program change may be needed.`,
          citation: 'Meeusen et al. (2013): Functional overreaching (short-term performance decline) can become non-functional overreaching if training stress is not reduced.',
          applied: true,
        });
      } else {
        decisions.push({
          type: 'info',
          description: `Session rated "too hard" — monitoring. If 2+ of your next 3 sessions also feel too hard, ` +
            `weights will be automatically reduced. Check: sleep (7-9 hrs), protein (1.6-2.2 g/kg/day), ` +
            `overall life stress, hydration.`,
          citation: 'Morton et al. (2018): Recovery is multi-factorial; nutrition, sleep, and life stress all affect training capacity.',
          applied: false,
        });
      }
      break;
    }

    case 'could_not_finish': {
      // Force deload
      for (const [lift, progress] of Object.entries(state.liftProgress)) {
        progress.currentWeight = enforceBarMinimum(
          roundToPlate(progress.currentWeight * 0.9, progress.unit),
          progress.unit,
        );
        adjustedLifts.add(lift);
      }
      decisions.push({
        type: 'force_deload',
        description: `Could not finish workout — forcing a deload. All weights reduced 10%. ` +
          `Next session will be a recovery day (same exercises, reduced volume). ` +
          `If you could not finish due to time constraints rather than fatigue, you can override this in settings.`,
        citation: 'PMC10948666: Reactive deloads (triggered by performance decline) are equally effective as planned deloads for maintaining long-term progress.',
        applied: true,
      });
      break;
    }

    case 'just_right':
      // No adjustment needed — this is the target state
      break;
  }

  return { decisions, adjustedLifts };
}

// ─── Readiness Processing ───

function processReadiness(
  state: ProgramState,
  readiness: ReadinessData,
  recentLogs: WorkoutLog[],
  _program: ProgramDefinition,
): AdaptationDecision[] {
  const decisions: AdaptationDecision[] = [];

  // Calculate composite readiness score (1-5 scale)
  const compositeReadiness = (
    readiness.sleepQuality +
    (6 - readiness.stress) +
    (6 - readiness.soreness) +
    readiness.motivation
  ) / 4;

  // Check readiness trend over last 3 sessions
  const recentReadiness = recentLogs
    .slice(0, 3)
    .filter(l => l.readiness)
    .map(l => {
      const r = l.readiness!;
      return (r.sleepQuality + (6 - r.stress) + (6 - r.soreness) + r.motivation) / 4;
    });

  const avgRecentReadiness = recentReadiness.length > 0
    ? recentReadiness.reduce((a, b) => a + b, 0) / recentReadiness.length
    : compositeReadiness;

  // Very low readiness today → suggest light day
  if (compositeReadiness < 2.0) {
    decisions.push({
      type: 'volume_decrease',
      description: `Low readiness score today (${compositeReadiness.toFixed(1)}/5). ` +
        `Recommending a light session: reduce working sets by 40% and cap RPE at 7. ` +
        `Sleep ${readiness.sleepHours < 7 ? `(${readiness.sleepHours} hrs — aim for 7-9)` : 'OK'}, ` +
        `stress ${readiness.stress >= 4 ? '(high)' : 'OK'}, ` +
        `soreness ${readiness.soreness >= 4 ? '(high)' : 'OK'}.`,
      citation: 'PMC10511399 (Delphi consensus): Adjust training when sleep < 7 hrs, stress > 3/5, or soreness > 3/5.',
      applied: false,
    });
  }

  // Declining trend → suggest deload
  if (avgRecentReadiness < 2.5 && recentReadiness.length >= 2) {
    decisions.push({
      type: 'force_deload',
      description: `Readiness has been declining across recent sessions (avg ${avgRecentReadiness.toFixed(1)}/5). ` +
        `Recommending a deload week: reduce volume 30-50%, maintain intensity at 80%. ` +
        `Recovery is where adaptation happens — you get stronger BETWEEN workouts, not during them.`,
      citation: 'Selye (1956): General Adaptation Syndrome — prolonged stress without recovery leads to exhaustion, not adaptation. ' +
        'PMC10948666: Deload recommended every 4-6 weeks or when performance markers decline.',
      applied: false,
    });
  }

  // Severe soreness → warn about accumulated muscle damage
  if (readiness.soreness >= 4) {
    decisions.push({
      type: 'info',
      description: `Soreness level: ${readiness.soreness}/5 (${readiness.soreness === 5 ? 'extreme' : 'severe'}). ` +
        `This suggests incomplete recovery from previous training. Consider: ` +
        `extra rest day, lighter weights today, or foam rolling / active recovery. ` +
        `Training through severe DOMS increases injury risk and impairs performance.`,
      citation: 'Cheung et al. (2003): Training with severe DOMS reduces force production 10-50% and alters movement patterns, increasing injury risk.',
      applied: false,
    });
  }

  // Low sleep → specific guidance
  if (readiness.sleepHours < 6) {
    decisions.push({
      type: 'info',
      description: `Sleep: ${readiness.sleepHours} hours. Research shows <6 hours impairs strength by 5-10% and ` +
        `increases injury risk by 1.7x. Consider a light session or rest day.`,
      citation: 'Milewski et al. (2014): Athletes sleeping < 8 hrs had 1.7x greater injury risk. ' +
        'Knowles et al. (2018): Sleep deprivation reduces maximal strength and power output.',
      applied: false,
    });
  }

  return decisions;
}

// ─── Forced Deload Detection ───

/**
 * Check multiple fatigue signals and force a deload when accumulated fatigue
 * exceeds safe thresholds.
 *
 * Triggers (any 3 of these in the last 5 sessions):
 * - RPE >= 9.5 on 2+ lifts
 * - Difficulty rated "too hard" or "could not finish"
 * - Soreness >= 4
 * - Readiness score < 2.5
 * - Form scores declining (avg of last 3 < avg of prior 3)
 */
function checkForcedDeload(
  state: ProgramState,
  recentLogs: WorkoutLog[],
  currentFeedback: PostWorkoutFeedback,
): AdaptationDecision | null {
  if (recentLogs.length < 3) return null;

  let fatigueSignals = 0;

  // Check high RPE across recent sessions
  const recentHighRPE = recentLogs.slice(0, 5).filter(log =>
    log.sets.some(s => s.rpe && s.rpe >= 9.5)
  ).length;
  if (recentHighRPE >= 2) fatigueSignals++;

  // Current session difficulty
  if (currentFeedback.sessionDifficulty === 'too_hard' || currentFeedback.sessionDifficulty === 'could_not_finish') {
    fatigueSignals++;
  }

  // Soreness
  if (currentFeedback.soreness === 'severe' || currentFeedback.soreness === 'extreme') {
    fatigueSignals++;
  }

  // Readiness trend
  const readinessScores = recentLogs.slice(0, 5)
    .filter(l => l.readiness)
    .map(l => {
      const r = l.readiness!;
      return (r.sleepQuality + (6 - r.stress) + (6 - r.soreness) + r.motivation) / 4;
    });
  if (readinessScores.length >= 2) {
    const avg = readinessScores.reduce((a, b) => a + b, 0) / readinessScores.length;
    if (avg < 2.5) fatigueSignals++;
  }

  // Session RPE trending high
  if (currentFeedback.sessionRPE >= 9.5) fatigueSignals++;

  // Trigger forced deload at 3+ signals
  if (fatigueSignals >= 3) {
    // Apply deload to all lifts
    for (const progress of Object.values(state.liftProgress)) {
      progress.currentWeight = enforceBarMinimum(
        roundToPlate(progress.currentWeight * 0.85, progress.unit),
        progress.unit,
      );
    }

    return {
      type: 'force_deload',
      description: `Accumulated fatigue detected (${fatigueSignals} of 5 warning signals triggered). ` +
        `Forcing a deload: all weights reduced 15%, next 1-2 sessions at reduced volume. ` +
        `Signals: ${buildFatigueSignalList(recentHighRPE, currentFeedback, readinessScores)}. ` +
        `After deload, weights will rebuild over 1-2 weeks — you will not lose progress.`,
      citation: 'PMC10948666: Proactive deloads prevent non-functional overreaching. ' +
        'PMC10511399 (Delphi consensus): Multiple fatigue markers co-occurring warrant immediate load reduction. ' +
        'Meeusen et al. (2013): Accumulated fatigue without adequate recovery leads to performance decline, not gains.',
      applied: true,
    };
  }

  return null;
}

function buildFatigueSignalList(
  recentHighRPE: number,
  feedback: PostWorkoutFeedback,
  readinessScores: number[],
): string {
  const signals: string[] = [];
  if (recentHighRPE >= 2) signals.push(`high RPE (${recentHighRPE} recent sessions at 9.5+)`);
  if (feedback.sessionDifficulty === 'too_hard') signals.push('session felt too hard');
  if (feedback.sessionDifficulty === 'could_not_finish') signals.push('could not finish workout');
  if (feedback.soreness === 'severe' || feedback.soreness === 'extreme') signals.push(`soreness: ${feedback.soreness}`);
  if (readinessScores.length >= 2) {
    const avg = readinessScores.reduce((a, b) => a + b, 0) / readinessScores.length;
    if (avg < 2.5) signals.push(`low readiness trend (${avg.toFixed(1)}/5)`);
  }
  if (feedback.sessionRPE >= 9.5) signals.push(`session RPE ${feedback.sessionRPE}`);
  return signals.join(', ');
}

// ─── Phase Advancement ───

/**
 * Check if the lifter should advance to the next phase or program.
 * Criteria vary by program type:
 *
 * LP programs: transition when stall cycles exhausted (handled by recordSetResult)
 * 5/3/1: advance when TM growth stalls or after planned # of cycles
 * Block: advance to next block based on week count
 * All: consider overall training age and performance trajectory
 */
function checkPhaseAdvancement(
  state: ProgramState,
  recentLogs: WorkoutLog[],
  program: ProgramDefinition,
): AdaptationDecision | null {
  // Block periodization: auto-advance between blocks using configured boundaries
  if (program.id === 'block_periodization') {
    const bounds = state.blockBoundaries ?? { hyp: 1, str: 6, peak: 11 };
    if (state.currentWeek === bounds.str - 1) {
      return {
        type: 'phase_advance',
        description: `Hypertrophy block complete (${bounds.str - bounds.hyp} weeks). Advancing to Strength block. ` +
          `Focus shifts from high volume (8-12 reps) to heavier loads (4-6 reps). ` +
          `The muscle mass you built will now be trained to produce more force.`,
        citation: 'Issurin (2008): Block periodization — sequential development of hypertrophy → strength → peaking.',
        applied: true,
      };
    }
    if (state.currentWeek === bounds.peak - 1) {
      return {
        type: 'phase_advance',
        description: `Strength block complete (${bounds.peak - bounds.str} weeks). Advancing to Peaking block. ` +
          `Volume decreases significantly, intensity increases to near-max. ` +
          `This is where your competition performance is realized.`,
        citation: 'PMC7552788: Peaking taper of 1-2 weeks with 30-50% volume reduction yields 2-5% performance improvement.',
        applied: true,
      };
    }
  }

  // 5/3/1 programs: check for TM reset after poor AMRAP performance
  if (program.id.startsWith('531')) {
    // Check if recent AMRAP sets are underperforming
    const amrapSets = recentLogs.slice(0, 6).flatMap(log =>
      log.sets.filter(s => s.targetReps.includes('+') && s.actualReps !== undefined)
    );

    if (amrapSets.length >= 3) {
      const underperforming = amrapSets.filter(s => {
        const target = parseInt(s.targetReps.replace('+', ''), 10);
        return (s.actualReps ?? 0) <= target; // Only hitting minimum, not exceeding
      });

      if (underperforming.length >= 3) {
        // Recommend "5 forward, 3 back" TM reset
        return {
          type: 'info',
          description: `AMRAP sets are consistently hitting only the minimum reps. ` +
            `Your Training Max may be too high. Wendler recommends the "5 forward, 3 back" approach: ` +
            `reset your TM back 3 cycles (${3 * (program.progression.incrementLbs.upper)} lbs upper, ` +
            `${3 * (program.progression.incrementLbs.lower)} lbs lower body). ` +
            `This ensures you can always hit 5+ reps on the "1+" set.`,
          citation: 'Wendler (2017): "If you can\'t get at least 5 reps on the 1+ set, your TM is too high. Reset and build back up."',
          applied: false,
        };
      }
    }
  }

  // General: check if program has been running longer than typical duration
  const weeksOnProgram = state.currentWeek;
  const [minWeeks, maxWeeks] = program.typicalDurationWeeks;
  if (weeksOnProgram > maxWeeks) {
    return {
      type: 'program_transition',
      description: `You've been on ${program.shortName} for ${weeksOnProgram} weeks ` +
        `(typical range: ${minWeeks}-${maxWeeks} weeks). ` +
        `Consider transitioning to a new program to provide a fresh stimulus. ` +
        `The body adapts to repeated stimuli — new programming provides novel challenges.`,
      citation: 'Zatsiorsky & Kraemer (2006): The Principle of Accommodation — the response to a constant stimulus decreases over time.',
      applied: false,
    };
  }

  return null;
}

// ─── Autoregulation ───

/**
 * Adjust next session's weights based on form scores and RPE.
 * Returns adjustment messages.
 *
 * Evidence: Zourdos et al. (2016) — RPE autoregulation superior to fixed percentages.
 * Helms et al. (2016) — RIR-based training for strength athletes.
 * Meta-analysis PMC12336695 — autoregulated training significantly more effective.
 */
export function autoregulate(
  state: ProgramState,
  recentLogs: WorkoutLog[],
): string[] {
  const messages: string[] = [];
  const program = PROGRAMS[state.programId];
  if (!program) return messages;

  // Guard against repeated mutations on every render — run at most once per day
  const today = new Date().toISOString().slice(0, 10);
  if (state.lastAutoregulatedDate === today) return messages;

  // Get last 3 workouts for trend analysis
  const recent = recentLogs.slice(0, 3);
  if (recent.length < 2) return messages;

  // Check form score trends
  for (const liftKey of Object.keys(state.liftProgress)) {
    const liftSets = recent.flatMap(log =>
      log.sets.filter(s => s.exerciseSlot === liftKey && s.formScore !== undefined)
    );

    if (liftSets.length < 3) continue;

    const avgFormScore = liftSets.reduce((s, set) => s + (set.formScore ?? 0), 0) / liftSets.length;
    const avgRPE = liftSets.filter(s => s.rpe).reduce((s, set) => s + (set.rpe ?? 0), 0) /
      (liftSets.filter(s => s.rpe).length || 1);

    // Form degradation warning
    if (avgFormScore < 70) {
      const progress = state.liftProgress[liftKey];
      if (progress) {
        const reducedWeight = enforceBarMinimum(
          roundToPlate(progress.currentWeight * 0.92, progress.unit),
          progress.unit,
        );
        messages.push(
          `${capitalize(liftKey)}: Average form score ${Math.round(avgFormScore)}/100 across recent sessions. ` +
          `Reducing weight to ${reducedWeight} ${progress.unit} to rebuild technique. ` +
          `(Helms et al. 2016: technique breakdown under load suggests the weight is beyond current ` +
          `neuromuscular capacity, even if the lifter can complete reps.)`,
        );
        progress.currentWeight = reducedWeight;
      }
    }

    // RPE too high — suggest deload
    if (avgRPE > 9.0 && program.progression.type !== 'linear_session') {
      messages.push(
        `${capitalize(liftKey)}: Average RPE ${avgRPE.toFixed(1)} across recent sessions indicates ` +
        `high accumulated fatigue. Consider a deload this week (reduce volume 30-50%, maintain intensity). ` +
        `(PMC10948666: deload every 4-6 weeks; reactive deloads when RPE consistently exceeds targets.)`,
      );
    }

    // RPE too low — suggest increase
    if (avgRPE < 7.0 && avgRPE > 0 && program.progression.type === 'rpe_autoregulated') {
      const progress = state.liftProgress[liftKey];
      if (progress) {
        const increasedWeight = roundToPlate(progress.currentWeight * 1.05, progress.unit);
        messages.push(
          `${capitalize(liftKey)}: Average RPE ${avgRPE.toFixed(1)} — you have more in the tank. ` +
          `Increasing to ${increasedWeight} ${progress.unit} next session.`,
        );
        progress.currentWeight = increasedWeight;
      }
    }
  }

  // Readiness trend check
  const readinessScores = recent
    .filter(l => l.readiness)
    .map(l => {
      const r = l.readiness!;
      return (r.sleepQuality + (6 - r.stress) + (6 - r.soreness) + r.motivation) / 4;
    });

  if (readinessScores.length >= 2) {
    const avgReadiness = readinessScores.reduce((a, b) => a + b, 0) / readinessScores.length;
    if (avgReadiness < 2.5) {
      messages.push(
        `Low readiness trend detected (avg ${avgReadiness.toFixed(1)}/5). ` +
        `Consider a deload or light training week. Recovery is where adaptation happens — ` +
        `more training stress on top of poor recovery leads to overreaching, not progress. ` +
        `(Selye's General Adaptation Syndrome; Meeusen et al. 2013: overtraining consensus statement.)`,
      );
    }
  }

  // Mark today so we don't re-apply weight mutations on subsequent renders
  if (messages.length > 0) {
    state.lastAutoregulatedDate = today;
  }

  return messages;
}

// ─── Transition Recommendations ───

export interface TransitionRecommendation {
  currentProgram: string;
  reason: string;
  recommendations: Array<{
    program: ProgramDefinition;
    fitReason: string;
  }>;
  /** Whether transition is recommended now or just informational */
  urgency: 'now' | 'soon' | 'informational';
}

/**
 * Generate detailed transition recommendations with science-backed reasoning.
 */
export function getTransitionRecommendations(
  state: ProgramState,
  profile: UserProfile,
): TransitionRecommendation | null {
  const program = PROGRAMS[state.programId];
  if (!program) return null;

  const exhaustedLifts = Object.values(state.liftProgress).filter(p => p.lpExhausted);
  if (exhaustedLifts.length === 0 && state.workoutsCompleted < 20) return null;

  // Build transition recommendation
  const nextProfile: UserProfile = {
    ...profile,
    experienceLevel: program.level === 'beginner' ? 'intermediate' : 'advanced',
  };

  const candidates = recommendPrograms(nextProfile);
  const recommendations = candidates.slice(0, 4).map(p => ({
    program: p,
    fitReason: getTransitionFitReason(p, profile, state),
  }));

  const urgency: 'now' | 'soon' | 'informational' =
    exhaustedLifts.length >= 3 ? 'now' :
    exhaustedLifts.length >= 1 ? 'soon' :
    'informational';

  return {
    currentProgram: program.name,
    reason: getTransitionReason(state, program, exhaustedLifts),
    recommendations,
    urgency,
  };
}

function getTransitionReason(
  state: ProgramState,
  program: ProgramDefinition,
  exhaustedLifts: LiftProgress[],
): string {
  if (exhaustedLifts.length >= 3) {
    return `You've completed ${state.workoutsCompleted} workouts on ${program.shortName} and ` +
      `${exhaustedLifts.length} of 4 main lifts have exhausted linear progression. ` +
      `Your body now requires longer recovery periods between PR attempts — ` +
      `weekly or multi-week periodization will continue driving progress. ` +
      `(Rippetoe 2013: "The intermediate trainee can no longer recover between ` +
      `individual workouts quickly enough to make progress every session.")`;
  }

  if (exhaustedLifts.length >= 1) {
    const names = exhaustedLifts.map(l => capitalize(l.liftName)).join(' and ');
    return `Your ${names} ${exhaustedLifts.length === 1 ? 'has' : 'have'} exhausted session-to-session LP ` +
      `after ${state.workoutsCompleted} workouts. OHP typically stalls first, then bench, then squat, ` +
      `then deadlift — this is normal progression. You can transition individual lifts while ` +
      `continuing LP on others.`;
  }

  return `After ${state.workoutsCompleted} workouts, you may want to evaluate your program options. ` +
    `Current progress is good, but there may be a better fit for your goals.`;
}

function getTransitionFitReason(
  program: ProgramDefinition,
  profile: UserProfile,
  _state: ProgramState,
): string {
  switch (program.id) {
    case 'texas_method':
      return `3 days/week — same schedule as your current program. ` +
        `Weekly periodization (Volume/Recovery/Intensity) gives your body a full week to recover between PRs. ` +
        `Best if you want to keep training 3 days and focus purely on strength. ` +
        `(Rippetoe/Baker 2015)`;
    case 'hlm_split':
      return `RPE-based autoregulation adapts to your daily readiness — no more grinding through bad days. ` +
        `3-4 days/week with Heavy/Light/Medium stress management. ` +
        `Can be run indefinitely with modifications. (Baker; Zourdos et al. 2016)`;
    case '531_bbb':
      return `4 days/week with the proven 5/3/1 framework. ` +
        `The 5×10 BBB supplemental sets build muscle mass to support future strength. ` +
        `Slow, sustainable progression — designed to be run for years, not months. (Wendler 2017)`;
    case '531_fsl':
      return `Same 5/3/1 framework as BBB but with less volume (5×5 instead of 5×10). ` +
        `Better choice if recovery is a concern or during a caloric deficit. (Wendler 2017)`;
    case 'gzcl_jt2':
      return `12-week periodized powerbuilding program. If you liked GZCLP's tiered approach, ` +
        `J&T 2.0 extends it with planned rep max progression. ` +
        `Great for building both size and strength. (Lefever 2016)`;
    case 'nsuns':
      return `High-volume 5/3/1 variant with weekly LP. ` +
        `Aggressive progression — 17 working sets per session across two main lifts. ` +
        `Best for lifters who recover well and want fast results. (nSuns, r/nSuns)`;
    case 'block_periodization':
      return `Sequential hypertrophy → strength → peaking blocks. Best for competition prep ` +
        `with a specific meet date. 12-16 weeks total. (Issurin 2008; JTS)`;
    case 'dup':
      return `Daily variation prevents accommodation while providing frequent lift practice. ` +
        `Research shows ~2× the strength gains vs linear periodization. ` +
        `(Rhea et al. 2002; Zourdos et al. 2016)`;
    case 'conjugate':
      return `Max Effort + Dynamic Effort training. Constant exercise variation prevents ` +
        `accommodation. Requires full gym with bands/chains for optimal results. (Simmons 2007)`;
    default:
      return `Matches your ${profile.daysPerWeek} days/week schedule and ${profile.equipment} equipment.`;
  }
}

// ─── Accessory Recommendations ───

export interface AccessoryRecommendation {
  weakPoint: string;
  stickingPoint: string;
  exercises: string[];
  setsReps: string;
  scienceBasis: string;
}

/**
 * Recommend accessory exercises based on form analysis weak points.
 * Adapts recommendations to available equipment.
 */
export function recommendAccessories(
  weakDimensions: Record<string, number>,
  exercise: string,
  equipment: EquipmentLevel,
): AccessoryRecommendation[] {
  const recommendations: AccessoryRecommendation[] = [];

  const exerciseAccessories: Record<string, Record<string, AccessoryRecommendation>> = {
    squat: {
      depth: {
        weakPoint: 'Insufficient depth',
        stickingPoint: 'Out of the hole',
        exercises: getEquipmentExercises(['pause_squat', 'front_squat', 'leg_press'], equipment),
        setsReps: '3×5-8',
        scienceBasis: 'Pause squats develop strength at the bottom position by eliminating the stretch-shortening cycle. Front squats enforce upright posture. (Helms et al., Strength & Conditioning Research)',
      },
      kneeTracking: {
        weakPoint: 'Knee valgus / poor tracking',
        stickingPoint: 'Any phase',
        exercises: ['Banded squats', getExerciseName('hip_thrust', equipment), getExerciseName('leg_press', equipment) + ' (single-leg)'],
        setsReps: '3×10-15',
        scienceBasis: 'Hip abductor strengthening reduces knee valgus during squatting. Banded squats provide proprioceptive feedback. (Escamilla 2001; Powers 2010)',
      },
      trunk: {
        weakPoint: 'Excessive forward lean',
        stickingPoint: 'Mid-range',
        exercises: getEquipmentExercises(['front_squat', 'pause_squat', 'ab_work'], equipment),
        setsReps: '3×6-10',
        scienceBasis: 'Front squats force an upright torso position. Core strengthening supports trunk rigidity under load. (Rippetoe 2011; Gullett et al. 2009)',
      },
      lockout: {
        weakPoint: 'Weak lockout',
        stickingPoint: 'Near top',
        exercises: getEquipmentExercises(['box_squat', 'hip_thrust', 'good_morning'], equipment),
        setsReps: '3×5-8',
        scienceBasis: 'Box squats develop concentric-only strength from a dead stop. Hip thrusts isolate glute extension. (Simmons 2007)',
      },
    },
    deadlift: {
      depth: {
        weakPoint: 'Slow off the floor',
        stickingPoint: 'First pull',
        exercises: getEquipmentExercises(['deficit_deadlift', 'pause_squat', 'front_squat'], equipment),
        setsReps: '3×3-5',
        scienceBasis: 'Deficit deadlifts increase ROM and develop starting strength off the floor. (Nuckols, Stronger by Science)',
      },
      trunk: {
        weakPoint: 'Rounded back',
        stickingPoint: 'Above knee',
        exercises: [getExerciseName('row', equipment), getExerciseName('good_morning', equipment), getExerciseName('ab_work', equipment)],
        setsReps: '4×8-12',
        scienceBasis: 'Heavy rows and good mornings develop the erector spinae and upper back strength needed to maintain a neutral spine. (Sheiko; Rippetoe 2011)',
      },
      lockout: {
        weakPoint: 'Weak lockout / hitching',
        stickingPoint: 'Near hip extension',
        exercises: [getExerciseName('hip_thrust', equipment), 'Block pulls', getExerciseName('good_morning', equipment)],
        setsReps: '3×5-8',
        scienceBasis: 'Hip thrusts develop peak hip extension force. Block pulls overload the top portion of the lift. (Contreras et al. 2011)',
      },
    },
    bench_press: {
      depth: {
        weakPoint: 'Weak off chest',
        stickingPoint: 'Bottom of press',
        exercises: [getExerciseName('spoto_press', equipment), 'Wide-grip bench', getExerciseName('bench', equipment) + ' (DB)'],
        setsReps: '3×5-8',
        scienceBasis: 'Spoto press develops strength at the weakest point by pausing 1" off the chest. Wide-grip increases pec contribution. (Helms; Green & Comfort 2007)',
      },
      lockout: {
        weakPoint: 'Weak lockout',
        stickingPoint: 'Near top',
        exercises: [getExerciseName('close_grip_bench', equipment), getExerciseName('tricep_extension', equipment), 'Floor press'],
        setsReps: '3×6-10',
        scienceBasis: 'Close-grip bench and tricep isolation develop the triceps, which are the primary movers in the lockout. Board/floor press overloads the top ROM. (Simmons 2007; Lehman 2005)',
      },
    },
  };

  const exAccessories = exerciseAccessories[exercise] ?? exerciseAccessories['squat'];

  for (const [dimension, score] of Object.entries(weakDimensions)) {
    if (score < 75 && exAccessories[dimension]) {
      recommendations.push(exAccessories[dimension]);
    }
  }

  return recommendations;
}

export function getEquipmentExercises(slots: string[], equipment: EquipmentLevel): string[] {
  return slots.map(s => getExerciseName(s, equipment));
}

// ─── Injury Substitutions ───

/**
 * Get exercise substitutions for common injury areas.
 * Returns exercises that avoid loading the injured area.
 */
function getInjurySubstitutions(bodyArea: string, aggravatingExercise: string, _equipment: EquipmentLevel): string[] {
  const substitutions: Record<string, Record<string, string[]>> = {
    lower_back: {
      squat: ['Leg Press', 'Belt Squat', 'Goblet Squat (light)', 'Wall Sit'],
      deadlift: ['Hip Thrust', 'Glute Bridge', 'Leg Curl', 'Trap Bar Deadlift (if available, upright torso)'],
      barbell_row: ['Cable Row (neutral spine)', 'Chest-Supported Row', 'Machine Row'],
    },
    knees: {
      squat: ['Box Squat (high box, above parallel)', 'Leg Press (0-60° knee flexion only)', 'Hip Thrust', 'Wall Sit', 'Wall Sit (pain-free angle)'],
      lunge: ['Hip Thrust', 'Glute Bridge', 'Cable Pull-through'],
      deadlift: ['Romanian Deadlift', 'Hip Thrust', 'Glute Bridge', 'Leg Curl'],
    },
    shoulders: {
      bench: ['Floor Press', 'Push-ups (if pain-free)', 'Machine Chest Press (limited ROM)'],
      ohp: ['Landmine Press', 'Lateral Raises (light)', 'Face Pulls'],
      row: ['Low Row', 'Cable Row (elbows close)', 'Chest-Supported Row'],
    },
    elbows: {
      bench: ['Floor Press', 'Machine Press', 'Push-ups'],
      ohp: ['Landmine Press', 'Machine Press'],
      curl: ['Hammer Curls', 'Cable Curls (light)', 'Isometric holds'],
    },
    hips: {
      squat: ['Leg Press', 'Leg Extension + Leg Curl (isolation)', 'Wall Sit'],
      deadlift: ['Leg Curl', 'Back Extension (if pain-free)', 'Glute Bridge'],
      lunge: ['Leg Extension', 'Leg Curl', 'Seated Calf Raise'],
    },
    wrists: {
      bench: ['Machine Press', 'Wrist wraps + reduced weight', 'Push-ups (on fists or parallettes)'],
      ohp: ['Machine Press', 'Landmine Press'],
      curl: ['Hammer Curls', 'Cable Curls with EZ bar'],
    },
    neck: {
      squat: ['Safety Squat Bar (if available)', 'Leg Press', 'Goblet Squat', 'Belt Squat'],
    },
    upper_back: {
      deadlift: ['Trap Bar Deadlift', 'Hip Thrust', 'Leg Curl', 'Block Pull (reduced ROM)'],
      row: ['Cable Row (neutral grip)', 'Machine Row', 'Chest-Supported Row'],
    },
    groin: {
      squat: ['Box Squat (narrow stance)', 'Leg Press (feet together)', 'Leg Extension + Leg Curl'],
      deadlift: ['Conventional Deadlift (narrow stance, if pain-free)', 'Hip Thrust', 'Glute Bridge'],
      lunge: ['Step-up (if pain-free)', 'Leg Extension', 'Leg Curl'],
    },
  };

  // Look up substitutions for the specific aggravating exercise, with fallbacks
  const areaMap = substitutions[bodyArea];
  if (!areaMap) {
    return ['Consult a physiotherapist for exercise recommendations specific to your condition.'];
  }
  return areaMap[aggravatingExercise] ??
    Object.values(areaMap)[0] ??
    ['Consult a physiotherapist for exercise recommendations specific to your condition.'];
}

/**
 * Map body areas to the lifts they typically affect,
 * used for return-to-training protocol after injury resolution.
 */
function getAffectedLifts(bodyArea: string): string[] {
  const areaToLifts: Record<string, string[]> = {
    lower_back: ['squat', 'deadlift'],
    knees: ['squat', 'deadlift'],
    shoulders: ['bench', 'ohp'],
    elbows: ['bench', 'ohp'],
    hips: ['squat', 'deadlift'],
    wrists: ['bench', 'ohp'],
    neck: ['squat'],
    upper_back: ['deadlift', 'row'],
    groin: ['squat', 'deadlift'],
  };
  return areaToLifts[bodyArea] ?? [];
}

function formatBodyArea(area: string): string {
  const labels: Record<string, string> = {
    lower_back: 'Lower back',
    knees: 'Knee',
    shoulders: 'Shoulder',
    elbows: 'Elbow',
    hips: 'Hip',
    wrists: 'Wrist',
    neck: 'Neck',
    upper_back: 'Upper back',
    groin: 'Groin',
  };
  return labels[area] ?? area;
}

// ─── Difficulty Tracking (for multi-session pattern detection) ───

function countRecentDifficulty(_state: ProgramState, difficulty: SessionDifficulty): number {
  const logs = loadWorkoutLogs();
  return logs.slice(0, 5).filter(l => l.sessionDifficulty === difficulty).length;
}

// ─── 80/20 Time Efficiency Analysis ───

export interface EfficiencyAnalysis {
  /** Current program's estimated weekly time commitment (minutes) */
  currentWeeklyMinutes: number;
  /** Time per session (minutes) */
  sessionMinutes: number;
  /** Top 3 highest-ROI exercises (80/20 principle) */
  highROIExercises: Array<{
    exercise: string;
    reason: string;
    citation: string;
  }>;
  /** Exercises that could be dropped with minimal impact */
  lowROIExercises: Array<{
    exercise: string;
    reason: string;
    timesSaved: number; // minutes per week
  }>;
  /** Suggested time-optimized program variant */
  optimizedPlan: {
    description: string;
    weeklyMinutes: number;
    timeSavedPercent: number;
    strengthRetainedPercent: number;
    exercises: string[];
    citation: string;
  };
  /** Possible improvements based on training data */
  improvements: Array<{
    title: string;
    description: string;
    impact: 'high' | 'medium' | 'low';
    citation: string;
  }>;
}

/**
 * Analyze training time efficiency using the 80/20 principle.
 *
 * Evidence basis:
 * - Ralston et al. (2017): Compound movements produce 80%+ of strength gains
 * - Schoenfeld et al. (2019): 6-9 sets/week per muscle group captures ~80% of hypertrophy gains
 * - Androulakis-Korakakis et al. (2020): Minimum effective training dose for strength
 * - Iversen et al. (2021): Norwegian Frequency Project — frequency distributes volume, not inherently superior
 * - Nuckols (2020, Stronger by Science): Practical Programming for Strength Athletes
 */
export function analyzeEfficiency(
  state: ProgramState,
  recentLogs: WorkoutLog[],
): EfficiencyAnalysis {
  const program = PROGRAMS[state.programId];
  if (!program) {
    return {
      currentWeeklyMinutes: 0, sessionMinutes: 0,
      highROIExercises: [], lowROIExercises: [],
      optimizedPlan: { description: 'No program selected', weeklyMinutes: 0, timeSavedPercent: 0, strengthRetainedPercent: 0, exercises: [], citation: '' },
      improvements: [],
    };
  }

  // Calculate time per session from set count and rest periods
  const totalSets = program.workouts.reduce((sum, day) =>
    sum + day.exercises.reduce((s, ex) =>
      s + ex.sets.reduce((ss, set) => ss + set.sets, 0), 0), 0);
  const avgRestPerSet = program.workouts.reduce((sum, day) =>
    sum + day.exercises.reduce((s, ex) =>
      s + ex.sets.reduce((ss, set) => ss + set.restSeconds * set.sets, 0), 0), 0) / Math.max(totalSets, 1);

  const setsPerSession = totalSets / Math.max(program.workouts.length, 1);
  // Time = warm-up (10 min) + sets * (set duration ~45s + rest) + transitions (~2 min per exercise)
  const exercisesPerSession = program.workouts.reduce((sum, day) => sum + day.exercises.length, 0) / Math.max(program.workouts.length, 1);
  const sessionMinutes = Math.round(10 + setsPerSession * (0.75 + avgRestPerSet / 60) + exercisesPerSession * 2);
  const daysPerWeek = program.daysPerWeek[0];
  const currentWeeklyMinutes = sessionMinutes * daysPerWeek;

  // 80/20: The big 3 compound movements produce ~80% of powerlifting strength gains
  const highROIExercises = [
    {
      exercise: 'Squat (any variant)',
      reason: 'Trains quads, glutes, core, and back simultaneously. The single most effective lower body exercise. ' +
        '1 set of squats provides more stimulus than 3 sets of isolation work for the same muscles.',
      citation: 'Ralston et al. (2017): Multi-joint exercises produce significantly greater strength gains than single-joint exercises. ' +
        'Nuckols (Stronger by Science, 2020): "If you could only do one lower body exercise, squat."',
    },
    {
      exercise: 'Bench Press (any variant)',
      reason: 'Primary upper body push. Trains chest, front delts, triceps. The most effective chest builder per unit of time. ' +
        'Close-grip variant covers tricep training needs.',
      citation: 'Schoenfeld et al. (2016): Compound pressing movements produce equivalent or superior hypertrophy to isolation exercises for the same muscles. ' +
        'Nuckols (Stronger by Science): The bench press alone covers ~80% of upper body push training needs for powerlifters.',
    },
    {
      exercise: 'Deadlift (any variant)',
      reason: 'Trains the entire posterior chain: hamstrings, glutes, erectors, lats, grip. ' +
        'Highest total-body load of any exercise. 1-2 heavy sets provide enormous stimulus.',
      citation: 'Androulakis-Korakakis et al. (2020): As few as 1-4 heavy sets of deadlift per week can maintain or increase strength in trained lifters. ' +
        'Nuckols (Stronger by Science): "Deadlift training has the best stimulus-to-fatigue ratio of any compound lift."',
    },
  ];

  // Identify low-ROI exercises in the current program
  const lowROIExercises: EfficiencyAnalysis['lowROIExercises'] = [];
  for (const day of program.workouts) {
    for (const ex of day.exercises) {
      const slot = EXERCISE_SLOTS[ex.exerciseSlot];
      if (!slot?.isMainLift) {
        const setCount = ex.sets.reduce((s, set) => s + set.sets, 0);
        const timePerWeek = Math.round(setCount * (0.75 + 60 / 60) / program.workouts.length * daysPerWeek); // rough minutes
        if (timePerWeek > 0) {
          lowROIExercises.push({
            exercise: slot?.name ?? ex.exerciseSlot,
            reason: `Accessory work. Provides marginal additional benefit when compound movements are already covering this muscle group. ` +
              `Can be cut first if time is limited.`,
            timesSaved: timePerWeek,
          });
        }
      }
    }
  }

  // Time-optimized variant
  const optimizedMinutes = Math.round(currentWeeklyMinutes * 0.6);
  const optimizedPlan = {
    description: `Time-optimized version: 3 days/week, only the big 3 lifts + 1 accessory per session. ` +
      `Cuts ~${Math.round((1 - 0.6) * 100)}% of training time while retaining ~85-90% of strength gains. ` +
      `Best when life gets busy — do the minimum that maintains progress, then add back volume when time allows.`,
    weeklyMinutes: optimizedMinutes,
    timeSavedPercent: Math.round((1 - optimizedMinutes / Math.max(currentWeeklyMinutes, 1)) * 100),
    strengthRetainedPercent: 88,
    exercises: ['Squat (3x5)', 'Bench Press (3x5)', 'Deadlift (1x5)', 'Row or Pull-up (3x8-10)'],
    citation: 'Androulakis-Korakakis et al. (2020, PMC8435792): "The minimum effective training dose for maintaining strength is substantially lower than the dose required for maximizing it. ' +
      'As few as 2-3 sets per exercise per session, 2-3 times per week, is sufficient to maintain or slowly increase strength in trained individuals." ' +
      'Nuckols (Stronger by Science, 2020): "When time is limited, prioritize the competition lifts and do whatever accessories you can fit in the remaining time."',
  };

  // Improvements based on training data
  const improvements: EfficiencyAnalysis['improvements'] = [];

  // Check if user is training enough frequency per lift
  const mainLiftsPerWeek: Record<string, number> = {};
  for (const day of program.workouts) {
    for (const ex of day.exercises) {
      if (EXERCISE_SLOTS[ex.exerciseSlot]?.isMainLift) {
        mainLiftsPerWeek[ex.exerciseSlot] = (mainLiftsPerWeek[ex.exerciseSlot] ?? 0) + 1;
      }
    }
  }
  // Scale to actual days per week
  const scaleFactor = daysPerWeek / Math.max(program.workouts.length, 1);
  for (const [lift, count] of Object.entries(mainLiftsPerWeek)) {
    const weeklyFreq = count * scaleFactor;
    if (weeklyFreq < 1.5) {
      improvements.push({
        title: `Increase ${capitalize(lift)} frequency`,
        description: `You're training ${lift} ~${weeklyFreq.toFixed(1)}x/week. Research suggests 2x/week minimum for optimal strength gains. ` +
          `Consider adding a lighter ${lift} day or switching to a program with higher frequency.`,
        impact: 'high',
        citation: 'Schoenfeld et al. (2016, PMID: 27102172): Training a muscle group 2x/week produces significantly greater hypertrophy than 1x/week when volume is equated. ' +
          'Grgic et al. (2018): Higher training frequencies are associated with greater strength gains, though the effect is largely mediated by total volume.',
      });
    }
  }

  // Check rest periods — are they optimal?
  if (avgRestPerSet < 120) {
    improvements.push({
      title: 'Increase rest periods for main lifts',
      description: `Average rest period is ${Math.round(avgRestPerSet / 60)} minutes. For strength-focused training, 3-5 minutes between heavy compound sets is optimal. ` +
        `Short rest reduces performance on subsequent sets, leaving reps (and gains) on the table.`,
      impact: 'medium',
      citation: 'Grgic et al. (2017, PMID: 28641044): "Longer rest intervals (>2 min) lead to greater increases in maximal strength and muscle hypertrophy." ' +
        'Schoenfeld et al. (2016, PMID: 26605807): 3-minute rest intervals produced significantly greater strength gains than 1-minute intervals.',
    });
  }

  // Check if RPE data suggests suboptimal intensity
  if (recentLogs.length >= 3) {
    const recentRPE = recentLogs.slice(0, 5).flatMap(l => l.sets.filter(s => s.rpe).map(s => s.rpe!));
    if (recentRPE.length >= 3) {
      const avgRPE = recentRPE.reduce((a, b) => a + b, 0) / recentRPE.length;
      if (avgRPE < 6.5) {
        improvements.push({
          title: 'Train closer to failure',
          description: `Average RPE ${avgRPE.toFixed(1)} — you're leaving too much in reserve. For strength, target RPE 7-9 on working sets. ` +
            `Training below RPE 7 provides minimal stimulus for adaptation.`,
          impact: 'high',
          citation: 'Helms et al. (2016): Proximity to failure is a key driver of both strength and hypertrophy adaptations. ' +
            'Robinson et al. (2021, PMC): Training at higher RPE (>7) produces greater strength gains than low-RPE training when volume is matched.',
        });
      } else if (avgRPE > 9.2) {
        improvements.push({
          title: 'Reduce average intensity',
          description: `Average RPE ${avgRPE.toFixed(1)} — consistently training at near-max effort increases injury risk and fatigue accumulation. ` +
            `Most productive training occurs at RPE 7-8.5. Save RPE 9-10 for AMRAP sets and testing.`,
          impact: 'high',
          citation: 'Tuchscherer (RTS): "Most of your training should live at RPE 7-8.5. Going to RPE 10 regularly is a recipe for injury and burnout." ' +
            'Helms et al. (2018): Systematic review found that training to failure does not provide additional benefit over stopping 1-3 reps short for strength outcomes.',
        });
      }
    }

    // Check volume — are they doing enough sets?
    const avgSetsPerSession = recentLogs.slice(0, 3).reduce((sum, l) => sum + l.sets.filter(s => s.completed).length, 0) / Math.min(recentLogs.length, 3);
    if (avgSetsPerSession < 12) {
      improvements.push({
        title: 'Consider increasing training volume',
        description: `Averaging ${Math.round(avgSetsPerSession)} completed sets per session. Research suggests 10+ sets per muscle group per week for optimal strength gains. ` +
          `If you're completing the program as written, this is fine — but skipping sets reduces effectiveness.`,
        impact: 'medium',
        citation: 'Schoenfeld et al. (2017, PMID: 28834797): "There is a dose-response relationship between weekly sets and hypertrophy, with ≥10 sets per muscle group per week being optimal." ' +
          'Ralston et al. (2017): Higher volumes are associated with greater strength gains up to a point of diminishing returns.',
      });
    }
  }

  // Check for sleep quality impact
  const recentReadiness = recentLogs.slice(0, 5).filter(l => l.readiness).map(l => l.readiness!);
  if (recentReadiness.length >= 2) {
    const avgSleep = recentReadiness.reduce((s, r) => s + r.sleepHours, 0) / recentReadiness.length;
    if (avgSleep < 7) {
      improvements.push({
        title: 'Prioritize sleep over extra training',
        description: `Average sleep: ${avgSleep.toFixed(1)} hours. Sleep is the #1 recovery tool and more impactful than any supplement or accessory exercise. ` +
          `An extra hour of sleep would produce more strength gains than an extra 30 minutes in the gym.`,
        impact: 'high',
        citation: 'Knowles et al. (2018, PMID: 29352073): Sleep deprivation reduces maximal strength by 5-10% and impairs muscle recovery. ' +
          'Watson (2017): "Sleep is the single most effective thing we can do to reset our brain and body health each day." ' +
          'Dattilo et al. (2011): Sleep restriction reduces protein synthesis and elevates cortisol, directly impairing muscle recovery.',
      });
    }
  }

  return {
    currentWeeklyMinutes,
    sessionMinutes,
    highROIExercises,
    lowROIExercises,
    optimizedPlan,
    improvements,
  };
}
