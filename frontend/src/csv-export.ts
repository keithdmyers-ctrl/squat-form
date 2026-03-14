/**
 * CSV export for session history and per-analysis data.
 */

import type { SessionRecord, SetAnalysis } from './types';

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
