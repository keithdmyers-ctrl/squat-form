import { describe, it, expect } from 'vitest';
import { exportSessionsCSV, exportAnalysisCSV } from '../csv-export';

describe('exportSessionsCSV', () => {
  it('generates headers and rows', () => {
    const sessions = [{
      date: '2026-03-09',
      squat_type: 'high_bar',
      experience_level: 'intermediate',
      rep_count: 5,
      overall_score: 82,
      grade: 'B',
      top_issue: 'knee_valgus',
    }];
    const csv = exportSessionsCSV(sessions as any);
    expect(csv).toContain('Date,Squat Type');
    expect(csv).toContain('2026-03-09,high_bar,intermediate,5,82,B,knee_valgus');
  });

  it('escapes commas in values', () => {
    const sessions = [{
      date: '2026-03-09',
      squat_type: 'high_bar',
      experience_level: 'intermediate',
      rep_count: 5,
      overall_score: 82,
      grade: 'B',
      top_issue: 'knee_valgus, heel_rise',
    }];
    const csv = exportSessionsCSV(sessions as any);
    expect(csv).toContain('"knee_valgus, heel_rise"');
  });

  it('handles empty sessions', () => {
    const csv = exportSessionsCSV([]);
    const lines = csv.split('\n');
    expect(lines.length).toBe(1); // headers only
  });
});

describe('exportAnalysisCSV', () => {
  it('generates per-rep rows', () => {
    const analysis = {
      reps: [
        {
          overallScore: 85,
          grade: 'B',
          depthScore: 90,
          kneeTrackingScore: 80,
          trunkScore: 85,
          symmetryScore: 88,
          tempoScore: 75,
          lockoutScore: 92,
          issues: [{ name: 'knee_valgus', severity: 'moderate' }],
        },
      ],
    };
    const csv = exportAnalysisCSV(analysis as any);
    expect(csv).toContain('Rep,Score,Grade');
    // CSV now includes raw angle columns between score dimensions and issues
    expect(csv).toContain('1,85,B,90,80,85,88,75,92');
  });
});
