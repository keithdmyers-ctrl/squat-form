/**
 * Meet attempt selection helper for competitive powerlifters.
 * Generates opener / second / third attempt recommendations
 * based on training history, estimated 1RM, and meet-day arousal factor.
 */

import type { SessionRecord } from './types';

// ─── Meet-Day Adrenaline / Arousal Factor ───

export type MeetDayStrategy = 'conservative' | 'moderate' | 'aggressive';

/**
 * Get the meet-day performance factor for a given strategy.
 *
 * Well-prepared lifters typically perform 2-5% above gym performance on meet day
 * due to adrenaline, optimal peaking, competition arousal, and crowd effect.
 *
 * - conservative (1.0): No boost. Best for first-time competitors or nervous lifters.
 * - moderate (1.03): 3% boost. Typical for experienced competitors who have peaked properly.
 * - aggressive (1.05): 5% boost. For peaked, confident lifters with meet experience.
 */
export function getMeetDayFactor(strategy: MeetDayStrategy): number {
  switch (strategy) {
    case 'conservative': return 1.0;
    case 'moderate': return 1.03;
    case 'aggressive': return 1.05;
  }
}

export interface AttemptPlan {
  opener: number;
  second: number;
  third: number;
  openerRPE: string;
  secondRPE: string;
  thirdRPE: string;
  confidence: 'high' | 'moderate' | 'low';
  rationale: string;
  meetDayStrategy?: MeetDayStrategy;
  meetDayFactor?: number;
}

/**
 * Round a weight to the nearest competition increment.
 * - kg: nearest 2.5 kg (standard IPF bar loading)
 * - lbs: nearest 5 lbs (standard plate increments)
 */
function roundToIncrement(weight: number, unit: string): number {
  const increment = unit === 'lbs' ? 5 : 2.5;
  return Math.round(weight / increment) * increment;
}

/**
 * Determine confidence level based on number of recent training sessions.
 * More data points yield higher confidence in the attempt recommendations.
 */
function assessConfidence(sessionCount: number): 'high' | 'moderate' | 'low' {
  if (sessionCount > 5) return 'high';
  if (sessionCount >= 3) return 'moderate';
  return 'low';
}

/**
 * Build a rationale string explaining the attempt selection logic.
 */
function buildRationale(
  estimated1RM: number,
  unit: string,
  opener: number,
  second: number,
  third: number,
  confidence: 'high' | 'moderate' | 'low',
  sessionCount: number,
  meetDayStrategy?: MeetDayStrategy,
  meetDayFactor?: number,
): string {
  const pctOpener = Math.round((opener / estimated1RM) * 100);
  const pctSecond = Math.round((second / estimated1RM) * 100);
  const pctThird = Math.round((third / estimated1RM) * 100);

  const lines: string[] = [];
  lines.push(
    `Based on an estimated 1RM of ${estimated1RM}${unit}, ` +
    `drawn from ${sessionCount} recent training session${sessionCount !== 1 ? 's' : ''}.`,
  );

  if (meetDayStrategy && meetDayFactor && meetDayFactor > 1.0) {
    const boostPct = Math.round((meetDayFactor - 1.0) * 100);
    lines.push(
      `Meet-day strategy: ${meetDayStrategy} (+${boostPct}% adrenaline factor). ` +
      `Well-prepared lifters typically perform 2-5% above gym performance on meet day ` +
      `due to adrenaline, optimal peaking, and competition arousal.`,
    );
  } else if (meetDayStrategy === 'conservative') {
    lines.push(
      `Meet-day strategy: conservative (no adrenaline boost). ` +
      `Recommended for first-time competitors or lifters who prefer to play it safe.`,
    );
  }

  lines.push(
    `Opener: ${opener}${unit} (~${pctOpener}% of 1RM) — should feel like an RPE 7, ` +
    `a weight you could triple on your worst day. This secures a total.`,
  );
  lines.push(
    `Second attempt: ${second}${unit} (~${pctSecond}% of 1RM) — RPE 8.5-9, ` +
    `a solid single that builds momentum for the third.`,
  );
  lines.push(
    `Third attempt: ${third}${unit} (~${pctThird}% of 1RM) — RPE 9.5-10, ` +
    `a PR attempt or match. Go for it.`,
  );

  if (confidence === 'low') {
    lines.push(
      'Confidence is low due to limited training data. ' +
      'Consider being more conservative with attempt selection until more sessions are logged.',
    );
  } else if (confidence === 'moderate') {
    lines.push(
      'Confidence is moderate. A few more tracked sessions would improve the accuracy of these recommendations.',
    );
  } else {
    lines.push(
      'Confidence is high based on sufficient training history. ' +
      'Trust the process and execute on meet day.',
    );
  }

  return lines.join(' ');
}

/**
 * Generate meet attempt recommendations from training history.
 *
 * Attempt percentages follow standard powerlifting meet strategy:
 * - Opener: ~87% of estimated 1RM (RPE ~7) — guarantees a total
 * - Second: ~93% of estimated 1RM (RPE ~8.5-9) — builds the total
 * - Third: ~100-103% of estimated 1RM (RPE 9.5-10) — PR attempt
 *
 * The meetDayStrategy parameter applies an adrenaline/arousal factor
 * to the third attempt:
 * - conservative (1.0): third at 100% of gym 1RM
 * - moderate (1.03): third at 103% of gym 1RM (default)
 * - aggressive (1.05): third at 105% of gym 1RM
 *
 * Returns null if estimated1RM is invalid.
 */
export function generateAttemptPlan(
  sessions: SessionRecord[],
  estimated1RM: number,
  unit: string,
  meetDayStrategy: MeetDayStrategy = 'moderate',
): AttemptPlan | null {
  if (estimated1RM <= 0 || !isFinite(estimated1RM)) return null;

  const factor = getMeetDayFactor(meetDayStrategy);

  // Opener and second are based on raw gym 1RM (no adrenaline factor)
  const opener = roundToIncrement(estimated1RM * 0.87, unit);
  const second = roundToIncrement(estimated1RM * 0.93, unit);
  // Third attempt uses the meet-day factor
  const third = roundToIncrement(estimated1RM * factor, unit);

  const confidence = assessConfidence(sessions.length);

  const rationale = buildRationale(
    estimated1RM, unit, opener, second, third, confidence, sessions.length,
    meetDayStrategy, factor,
  );

  return {
    opener,
    second,
    third,
    openerRPE: '~7',
    secondRPE: '~8.5-9',
    thirdRPE: '~9.5-10',
    confidence,
    rationale,
    meetDayStrategy,
    meetDayFactor: factor,
  };
}
