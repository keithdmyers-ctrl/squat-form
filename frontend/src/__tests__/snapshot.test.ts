import { describe, it, expect } from 'vitest';
import {
  createSnapshotRecord,
  isValidSnapshot,
  estimateSnapshotSize,
  filterByPhase,
  getSnapshotsForRep,
  extractRepKeyFrames,
} from '../snapshot';
import type { FrameSnapshot } from '../snapshot';

/** Helper to create a mock snapshot. */
function makeSnapshot(phase: string, repIndex: number, timestamp: number = 0): FrameSnapshot {
  return {
    dataUrl: `data:image/jpeg;base64,${btoa(`fake-image-data-${phase}-${repIndex}`)}`,
    phase,
    repIndex,
    timestamp,
  };
}

describe('createSnapshotRecord', () => {
  it('limits to 4 snapshots', () => {
    const snapshots: FrameSnapshot[] = [
      makeSnapshot('bottom', 0, 10),
      makeSnapshot('lockout', 0, 20),
      makeSnapshot('bottom', 1, 30),
      makeSnapshot('lockout', 1, 40),
      makeSnapshot('bottom', 2, 50),
      makeSnapshot('lockout', 2, 60),
    ];
    const result = createSnapshotRecord(snapshots);
    expect(result).toHaveLength(4);
  });

  it('returns all snapshots when fewer than 4', () => {
    const snapshots: FrameSnapshot[] = [
      makeSnapshot('bottom', 0, 10),
      makeSnapshot('lockout', 0, 20),
    ];
    const result = createSnapshotRecord(snapshots);
    expect(result).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    const result = createSnapshotRecord([]);
    expect(result).toHaveLength(0);
  });

  it('preserves snapshot data in the first 4 entries', () => {
    const snapshots: FrameSnapshot[] = [
      makeSnapshot('bottom', 0, 10),
      makeSnapshot('lockout', 0, 20),
      makeSnapshot('bottom', 1, 30),
      makeSnapshot('lockout', 1, 40),
      makeSnapshot('bottom', 2, 50),
    ];
    const result = createSnapshotRecord(snapshots);
    expect(result[0].phase).toBe('bottom');
    expect(result[0].repIndex).toBe(0);
    expect(result[1].phase).toBe('lockout');
    expect(result[3].phase).toBe('lockout');
    expect(result[3].repIndex).toBe(1);
  });

  it('returns exactly 4 from 4 snapshots', () => {
    const snapshots: FrameSnapshot[] = [
      makeSnapshot('bottom', 0),
      makeSnapshot('lockout', 0),
      makeSnapshot('bottom', 1),
      makeSnapshot('lockout', 1),
    ];
    const result = createSnapshotRecord(snapshots);
    expect(result).toHaveLength(4);
  });
});

describe('isValidSnapshot', () => {
  it('validates a correct snapshot', () => {
    const snap = makeSnapshot('bottom', 0, 100);
    expect(isValidSnapshot(snap)).toBe(true);
  });

  it('rejects null', () => {
    expect(isValidSnapshot(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidSnapshot(undefined)).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isValidSnapshot('string')).toBe(false);
    expect(isValidSnapshot(42)).toBe(false);
  });

  it('rejects empty dataUrl', () => {
    expect(isValidSnapshot({
      dataUrl: '',
      phase: 'bottom',
      repIndex: 0,
      timestamp: 0,
    })).toBe(false);
  });

  it('rejects invalid phase', () => {
    expect(isValidSnapshot({
      dataUrl: 'data:image/jpeg;base64,abc',
      phase: 'invalid',
      repIndex: 0,
      timestamp: 0,
    })).toBe(false);
  });

  it('rejects negative repIndex', () => {
    expect(isValidSnapshot({
      dataUrl: 'data:image/jpeg;base64,abc',
      phase: 'bottom',
      repIndex: -1,
      timestamp: 0,
    })).toBe(false);
  });

  it('rejects negative timestamp', () => {
    expect(isValidSnapshot({
      dataUrl: 'data:image/jpeg;base64,abc',
      phase: 'bottom',
      repIndex: 0,
      timestamp: -5,
    })).toBe(false);
  });

  it('accepts lockout phase', () => {
    expect(isValidSnapshot({
      dataUrl: 'data:image/jpeg;base64,abc',
      phase: 'lockout',
      repIndex: 0,
      timestamp: 0,
    })).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(isValidSnapshot({ dataUrl: 'data:image/jpeg;base64,abc' })).toBe(false);
    expect(isValidSnapshot({ phase: 'bottom' })).toBe(false);
  });
});

describe('estimateSnapshotSize', () => {
  it('returns 0 for empty array', () => {
    expect(estimateSnapshotSize([])).toBe(0);
  });

  it('sums data URL lengths', () => {
    const snapshots: FrameSnapshot[] = [
      { dataUrl: 'abcde', phase: 'bottom', repIndex: 0, timestamp: 0 },
      { dataUrl: '12345678', phase: 'lockout', repIndex: 0, timestamp: 10 },
    ];
    expect(estimateSnapshotSize(snapshots)).toBe(13); // 5 + 8
  });
});

describe('filterByPhase', () => {
  it('filters to bottom phase only', () => {
    const snapshots: FrameSnapshot[] = [
      makeSnapshot('bottom', 0),
      makeSnapshot('lockout', 0),
      makeSnapshot('bottom', 1),
      makeSnapshot('lockout', 1),
    ];
    const result = filterByPhase(snapshots, 'bottom');
    expect(result).toHaveLength(2);
    expect(result.every(s => s.phase === 'bottom')).toBe(true);
  });

  it('returns empty for no matches', () => {
    const snapshots: FrameSnapshot[] = [
      makeSnapshot('bottom', 0),
    ];
    const result = filterByPhase(snapshots, 'lockout');
    expect(result).toHaveLength(0);
  });

  it('handles empty input', () => {
    expect(filterByPhase([], 'bottom')).toHaveLength(0);
  });
});

describe('getSnapshotsForRep', () => {
  it('gets snapshots for rep 0', () => {
    const snapshots: FrameSnapshot[] = [
      makeSnapshot('bottom', 0),
      makeSnapshot('lockout', 0),
      makeSnapshot('bottom', 1),
      makeSnapshot('lockout', 1),
    ];
    const result = getSnapshotsForRep(snapshots, 0);
    expect(result).toHaveLength(2);
    expect(result.every(s => s.repIndex === 0)).toBe(true);
  });

  it('returns empty for non-existent rep', () => {
    const snapshots: FrameSnapshot[] = [
      makeSnapshot('bottom', 0),
      makeSnapshot('lockout', 0),
    ];
    const result = getSnapshotsForRep(snapshots, 5);
    expect(result).toHaveLength(0);
  });
});

describe('extractRepKeyFrames', () => {
  it('returns bottom and end frames', () => {
    const result = extractRepKeyFrames([0, 100, 200], [90, 190, 290], [30, 130, 230]);
    expect(result.bottomFrames).toEqual([30, 130, 230]);
    expect(result.endFrames).toEqual([90, 190, 290]);
  });

  it('handles empty arrays', () => {
    const result = extractRepKeyFrames([], [], []);
    expect(result.bottomFrames).toEqual([]);
    expect(result.endFrames).toEqual([]);
  });

  it('returns copies, not references', () => {
    const endFrames = [90, 190];
    const bottomFrames = [30, 130];
    const result = extractRepKeyFrames([0, 100], endFrames, bottomFrames);
    endFrames.push(290);
    bottomFrames.push(230);
    expect(result.endFrames).toHaveLength(2);
    expect(result.bottomFrames).toHaveLength(2);
  });
});
