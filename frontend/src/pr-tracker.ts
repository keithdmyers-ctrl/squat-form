/**
 * Personal Record (PR) tracking system.
 * Detects new PRs for weight, reps, e1RM, form score, and volume.
 * Every competitor app has PR tracking — this is table stakes.
 */

export type PRType = 'weight' | 'reps' | 'e1rm' | 'form_score' | 'volume';

export interface PersonalRecord {
  id: string;
  type: PRType;
  lift: string;
  value: number;
  unit: string;
  date: string;
  /** Additional context (e.g., "275 x 5 reps" for e1RM) */
  context: string;
  /** Previous record value (for comparison) */
  previousValue?: number;
}

export interface PRCheck {
  isNewPR: boolean;
  record?: PersonalRecord;
  /** Celebration message */
  message?: string;
}

const PR_STORAGE_KEY = 'squat_form_prs';

export function loadPRs(): Record<string, PersonalRecord> {
  try {
    return JSON.parse(localStorage.getItem(PR_STORAGE_KEY) || '{}');
  } catch { return {}; }
}

export function savePRs(prs: Record<string, PersonalRecord>): void {
  try {
    localStorage.setItem(PR_STORAGE_KEY, JSON.stringify(prs));
  } catch {
    document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' }));
  }
}

/**
 * Check if a completed set is a new personal record.
 * Checks: heaviest weight, most reps at a weight, highest e1RM, best form score.
 */
export function checkForPR(
  lift: string,
  weight: number,
  reps: number,
  unit: string,
  formScore?: number,
): PRCheck[] {
  const prs = loadPRs();
  const results: PRCheck[] = [];

  // PR Type 1: Heaviest weight lifted (any reps)
  const weightKey = `weight_${lift}`;
  const prevWeight = prs[weightKey];
  if (weight > 0 && (!prevWeight || weight > prevWeight.value)) {
    const record: PersonalRecord = {
      id: weightKey,
      type: 'weight',
      lift,
      value: weight,
      unit,
      date: new Date().toISOString(),
      context: `${weight} ${unit} x ${reps}`,
      previousValue: prevWeight?.value,
    };
    prs[weightKey] = record;
    results.push({
      isNewPR: true,
      record,
      message: prevWeight
        ? `New ${capitalize(lift)} weight PR! ${weight} ${unit} (previous: ${prevWeight.value} ${unit})`
        : `First ${capitalize(lift)} PR recorded: ${weight} ${unit}!`,
    });
  }

  // PR Type 2: Estimated 1RM (Epley formula)
  if (weight > 0 && reps >= 1 && reps <= 15) {
    const e1rm = reps === 1 ? weight : Math.round(weight * (1 + reps / 30));
    const e1rmKey = `e1rm_${lift}`;
    const prevE1RM = prs[e1rmKey];
    if (!prevE1RM || e1rm > prevE1RM.value) {
      const record: PersonalRecord = {
        id: e1rmKey,
        type: 'e1rm',
        lift,
        value: e1rm,
        unit,
        date: new Date().toISOString(),
        context: `${weight} ${unit} x ${reps} reps (Epley)`,
        previousValue: prevE1RM?.value,
      };
      prs[e1rmKey] = record;
      results.push({
        isNewPR: true,
        record,
        message: prevE1RM
          ? `New ${capitalize(lift)} estimated 1RM! ${e1rm} ${unit} (previous: ${prevE1RM.value} ${unit})`
          : `${capitalize(lift)} e1RM: ${e1rm} ${unit}`,
      });
    }
  }

  // PR Type 3: Rep PR at specific weight (e.g., most reps at 225)
  if (weight > 0 && reps > 1) {
    const repKey = `reps_${lift}_${weight}`;
    const prevReps = prs[repKey];
    if (!prevReps || reps > prevReps.value) {
      const record: PersonalRecord = {
        id: repKey,
        type: 'reps',
        lift,
        value: reps,
        unit: 'reps',
        date: new Date().toISOString(),
        context: `${reps} reps @ ${weight} ${unit}`,
        previousValue: prevReps?.value,
      };
      prs[repKey] = record;
      if (prevReps) {
        results.push({
          isNewPR: true,
          record,
          message: `New ${capitalize(lift)} rep PR at ${weight} ${unit}! ${reps} reps (previous: ${prevReps.value})`,
        });
      }
    }
  }

  // PR Type 4: Form score PR
  if (formScore !== undefined && formScore > 0) {
    const formKey = `form_${lift}`;
    const prevForm = prs[formKey];
    if (!prevForm || formScore > prevForm.value) {
      const record: PersonalRecord = {
        id: formKey,
        type: 'form_score',
        lift,
        value: formScore,
        unit: 'pts',
        date: new Date().toISOString(),
        context: `${formScore}/100 form score`,
        previousValue: prevForm?.value,
      };
      prs[formKey] = record;
      if (prevForm) {
        results.push({
          isNewPR: true,
          record,
          message: `New ${capitalize(lift)} form score PR! ${formScore}/100 (previous: ${prevForm.value}/100)`,
        });
      }
    }
  }

  savePRs(prs);
  return results.filter(r => r.isNewPR);
}

/**
 * Get all PRs for display, organized by lift.
 */
export function getAllPRsByLift(): Record<string, PersonalRecord[]> {
  const prs = loadPRs();
  const byLift: Record<string, PersonalRecord[]> = {};
  for (const pr of Object.values(prs)) {
    if (!byLift[pr.lift]) byLift[pr.lift] = [];
    byLift[pr.lift].push(pr);
  }
  return byLift;
}

/**
 * Get the best e1RM for each main lift.
 */
export function getBestE1RMs(): Record<string, number> {
  const prs = loadPRs();
  const result: Record<string, number> = {};
  for (const [_key, pr] of Object.entries(prs)) {
    if (pr.type === 'e1rm') {
      result[pr.lift] = pr.value;
    }
  }
  return result;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
