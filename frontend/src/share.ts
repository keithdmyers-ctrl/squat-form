/**
 * Shareable analysis links: encode/decode analysis summaries in URL hash.
 * Uses JSON + base64url encoding (no compression for max browser compat).
 */

import type { SetAnalysis } from './types';

export interface SharedAnalysisSummary {
  score: number;
  grade: string;
  reps: number;
  repScores: number[];
  topIssues: string[];
  squatType: string;
  experienceLevel: string;
  date: string;
  competition: boolean;
  weight?: number;
  unit?: string;
  estimated1rm?: number;
}

/** Encode an analysis result into a shareable URL. */
export function encodeAnalysisUrl(analysis: SetAnalysis, weight?: number, unit?: string, estimated1rm?: number): string {
  const summary: SharedAnalysisSummary = {
    score: analysis.overallScore,
    grade: analysis.grade,
    reps: analysis.repCount,
    repScores: analysis.reps.map(r => r.overallScore),
    topIssues: analysis.topIssues.slice(0, 3).map(i => i.name),
    squatType: analysis.config.squatType,
    experienceLevel: analysis.config.experienceLevel,
    date: new Date().toISOString().slice(0, 10),
    competition: analysis.competitionMode,
    weight,
    unit,
    estimated1rm,
  };

  const json = JSON.stringify(summary);
  const encoded = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#share=${encoded}`;
}

/** Decode a shared analysis URL hash. Returns null if invalid. */
export function decodeAnalysisUrl(hash: string): SharedAnalysisSummary | null {
  if (!hash.startsWith('#share=')) return null;
  try {
    const encoded = hash.slice(7);
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded);
    const parsed = JSON.parse(json);
    // Basic validation
    if (typeof parsed.score !== 'number' || typeof parsed.grade !== 'string') return null;
    return parsed as SharedAnalysisSummary;
  } catch {
    return null;
  }
}

/** Generate a shareable image card as a canvas blob.
 * @param format - 'standard' (600x315 link preview) or 'story' (1080x1920 story format)
 */
export async function generateShareCard(analysis: SetAnalysis, format: 'standard' | 'story' = 'standard'): Promise<Blob> {
  const isStory = format === 'story';
  const width = isStory ? 1080 : 600;
  const height = isStory ? 1920 : 315;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas 2D context');

  // Background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, width, height);

  // Border accent
  ctx.strokeStyle = '#00d4ff';
  ctx.lineWidth = isStory ? 4 : 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  const scale = isStory ? 2.5 : 1;

  // Title
  ctx.fillStyle = '#00d4ff';
  ctx.font = `bold ${Math.round(20 * scale)}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = isStory ? 'center' : 'left';
  ctx.fillText('Lift Form Analyzer', isStory ? width / 2 : 24, isStory ? 180 : 40);

  // Grade circle
  const gradeX = width / 2;
  const gradeY = isStory ? height * 0.4 : 140;
  const gradeR = isStory ? 140 : 55;

  const gradeColor = analysis.grade === 'A' ? '#4ade80' : analysis.grade === 'B' ? '#2dd4bf' : analysis.grade === 'C' ? '#fbbf24' : '#fb923c';

  ctx.beginPath();
  ctx.arc(gradeX, gradeY, gradeR, 0, Math.PI * 2);
  ctx.strokeStyle = gradeColor;
  ctx.lineWidth = isStory ? 8 : 4;
  ctx.stroke();

  ctx.fillStyle = gradeColor;
  ctx.font = `bold ${Math.round(48 * scale)}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(analysis.grade, gradeX, gradeY + 16 * scale);

  // Score
  ctx.fillStyle = '#e0e0e0';
  ctx.font = `bold ${Math.round(18 * scale)}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.fillText(`${analysis.overallScore}/100`, gradeX, gradeY + gradeR + 28 * scale);

  // Stats
  ctx.fillStyle = '#a0a0a0';
  ctx.font = `${Math.round(14 * scale)}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = 'center';
  const statsY = isStory ? height - 200 : height - 40;
  ctx.fillText(
    `${analysis.repCount} reps | ${analysis.config.squatType.replace('_', ' ')} | ${analysis.config.experienceLevel}`,
    width / 2, statsY,
  );

  // Date
  ctx.fillStyle = '#8a8a8a';
  ctx.font = `${Math.round(12 * scale)}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText(new Date().toLocaleDateString(), width - 24 * scale, height - 12 * scale);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to generate share card image'));
    }, 'image/png');
  });
}
