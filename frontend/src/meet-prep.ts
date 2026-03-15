/**
 * Meet attempt selection helper for competitive powerlifters.
 * Generates opener / second / third attempt recommendations
 * based on training history and estimated 1RM.
 */

import type { SessionRecord } from './types';

export interface AttemptPlan {
  opener: number;
  second: number;
  third: number;
  openerRPE: string;
  secondRPE: string;
  thirdRPE: string;
  confidence: 'high' | 'moderate' | 'low';
  rationale: string;
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
): string {
  const pctOpener = Math.round((opener / estimated1RM) * 100);
  const pctSecond = Math.round((second / estimated1RM) * 100);
  const pctThird = Math.round((third / estimated1RM) * 100);

  const lines: string[] = [];
  lines.push(
    `Based on an estimated 1RM of ${estimated1RM}${unit}, ` +
    `drawn from ${sessionCount} recent training session${sessionCount !== 1 ? 's' : ''}.`,
  );
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
 * - Third: ~100% of estimated 1RM (RPE 9.5-10) — PR attempt
 *
 * Returns null if estimated1RM is invalid.
 */
export function generateAttemptPlan(
  sessions: SessionRecord[],
  estimated1RM: number,
  unit: string,
): AttemptPlan | null {
  if (estimated1RM <= 0 || !isFinite(estimated1RM)) return null;

  const opener = roundToIncrement(estimated1RM * 0.87, unit);
  const second = roundToIncrement(estimated1RM * 0.93, unit);
  const third = roundToIncrement(estimated1RM * 1.0, unit);

  const confidence = assessConfidence(sessions.length);

  const rationale = buildRationale(
    estimated1RM, unit, opener, second, third, confidence, sessions.length,
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
  };
}
