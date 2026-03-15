/**
 * CSV export for session history and per-analysis data.
 */

import type { SessionRecord, SetAnalysis } from './types';
import { estimateRPE } from './competition';

/** Escape a value for CSV (handle commas, quotes, newlines). */
function csvEscape(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Generate CSV from session history. */
export function exportSessionsCSV(sessions: SessionRecord[]): string {
  const headers = ['Date', 'Squat Type', 'Experience Level', 'Reps', 'Score', 'Grade', 'Top Issue', 'Weight', 'Unit'];
  const rows = sessions.map(s => [
    csvEscape(s.date),
    csvEscape(s.squat_type),
    csvEscape(s.experience_level),
    csvEscape(s.rep_count),
    csvEscape(s.overall_score),
    csvEscape(s.grade),
    csvEscape(s.top_issue),
    csvEscape(s.weight ?? ''),
    csvEscape(s.weight_unit ?? ''),
  ].join(','));

  return [headers.join(','), ...rows].join('\n');
}

/** Generate detailed per-rep CSV from a single analysis with raw angle data. */
export function exportAnalysisCSV(analysis: SetAnalysis): string {
  const headers = [
    'Rep', 'Score', 'Grade',
    'Depth', 'Knee Tracking', 'Torso', 'Symmetry', 'Tempo', 'Lockout',
    'Min Knee Angle', 'Max Trunk Angle', 'Min Hip Angle',
    'Descent Duration (s)', 'Ascent Duration (s)', 'Bottom Duration (s)',
    'Peak Ascent Velocity (deg/s)', 'Mean Ascent Velocity (deg/s)',
    'Ascent/Descent Ratio', 'Sticking Points',
    'Confidence',
    'Issues',
  ];
  const rows = analysis.reps.map((rep, i) => [
    csvEscape(i + 1),
    csvEscape(rep.overallScore),
    csvEscape(rep.grade),
    csvEscape(rep.depthScore),
    csvEscape(rep.kneeTrackingScore),
    csvEscape(rep.trunkScore),
    csvEscape(rep.symmetryScore),
    csvEscape(rep.tempoScore),
    csvEscape(rep.lockoutScore),
    // Raw angle and timing data
    csvEscape(rep.minKneeAngle != null ? Math.round(rep.minKneeAngle) : ''),
    csvEscape(rep.maxTrunkAngle != null ? Math.round(rep.maxTrunkAngle) : ''),
    csvEscape(rep.minHipAngle != null ? Math.round(rep.minHipAngle) : ''),
    csvEscape(rep.descentDuration != null ? rep.descentDuration.toFixed(2) : ''),
    csvEscape(rep.ascentDuration != null ? rep.ascentDuration.toFixed(2) : ''),
    csvEscape(rep.bottomDuration != null ? rep.bottomDuration.toFixed(2) : ''),
    csvEscape(rep.velocity?.peakAscentVelocity ?? ''),
    csvEscape(rep.velocity?.meanAscentVelocity ?? ''),
    csvEscape(rep.velocity?.ascentDescentRatio ?? ''),
    csvEscape((rep.stickingPoints ?? []).map(sp => `${sp.depthPercentage}%`).join('; ')),
    csvEscape(rep.avgConfidence != null ? (rep.avgConfidence * 100).toFixed(0) + '%' : ''),
    csvEscape(rep.issues.map(iss => iss.name).join('; ')),
  ].join(','));

  return [headers.join(','), ...rows].join('\n');
}

/** Export full analysis as JSON for advanced users. */
export function exportAnalysisJSON(analysis: SetAnalysis): string {
  // Convert Maps to plain objects for JSON serialization
  const repFrameObj: Record<string, number> = {};
  analysis.repFrameMap.forEach((v, k) => { repFrameObj[String(k)] = v; });

  const serializable = {
    ...analysis,
    repFrameMap: repFrameObj,
  };
  return JSON.stringify(serializable, null, 2);
}

/** Trigger a JSON file download in the browser. */
export function downloadJSON(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Trigger a CSV file download in the browser. */
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
// ─── Training Log Clipboard Export ───

/** Map exercise variant strings to compact abbreviations. */
const VARIANT_ABBREVIATIONS: Record<string, string> = {
  // Squat variants
  high_bar: 'HB',
  low_bar: 'LB',
  front: 'Front',
  goblet: 'Goblet',
  bodyweight: 'BW',
  overhead: 'OH',
  // Deadlift variants
  conventional: 'Conv',
  sumo: 'Sumo',
  romanian: 'RDL',
  // Bench variants
  flat: 'Flat',
  close_grip: 'CG',
  wide_grip: 'WG',
};

/** Map exercise type strings to display names. */
const EXERCISE_NAMES: Record<string, string> = {
  squat: 'Squat',
  deadlift: 'Deadlift',
  bench_press: 'Bench',
};

/** Map internal issue names to plain-English labels. */
function humanizeIssueName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/^(.)/,  c => c.toLowerCase());
}

/**
 * Generate a compact training log entry for clipboard.
 * Format: "03/14 Squat HB 315x5 RPE 8 Score 82 Focus: knee valgus"
 */
export function generateTrainingLogEntry(
  analysis: SetAnalysis,
  weight?: number,
  unit?: string,
  exerciseType?: string,
  variant?: string,
): string {
  const parts: string[] = [];

  // Date in MM/DD format
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  parts.push(`${mm}/${dd}`);

  // Exercise name
  const exerciseName = exerciseType
    ? (EXERCISE_NAMES[exerciseType] ?? exerciseType)
    : 'Squat';
  parts.push(exerciseName);

  // Variant abbreviation
  if (variant) {
    const abbrev = VARIANT_ABBREVIATIONS[variant] ?? variant;
    parts.push(abbrev);
  }

  // Weight x reps
  if (weight != null && weight > 0) {
    const weightStr = unit ? `${weight}${unit}` : `${weight}`;
    parts.push(`${weightStr}x${analysis.repCount}`);
  } else {
    parts.push(`x${analysis.repCount}`);
  }

  // RPE from velocity metrics (average across reps that have velocity data)
  const rpeValues: number[] = [];
  for (const rep of analysis.reps) {
    if (rep.velocity) {
      const rpeEst = estimateRPE(rep.velocity);
      if (rpeEst) rpeValues.push(rpeEst.rpe);
    }
  }
  if (rpeValues.length > 0) {
    const avgRPE = rpeValues.reduce((s, v) => s + v, 0) / rpeValues.length;
    // Round to nearest 0.5
    const roundedRPE = Math.round(avgRPE * 2) / 2;
    parts.push(`RPE ${roundedRPE}`);
  }

  // Score
  parts.push(`Score ${Math.round(analysis.overallScore)}`);

  // Focus: top issue
  const topIssue = analysis.topIssues.length > 0
    ? humanizeIssueName(analysis.topIssues[0].name)
    : 'none';
  parts.push(`Focus: ${topIssue}`);

  return parts.join(' ');
}

/** Copy text to the clipboard. Returns true on success, false on failure. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers or non-secure contexts
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }
}
