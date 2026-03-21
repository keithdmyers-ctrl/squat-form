import { describe, it, expect } from 'vitest';
import {
  createFlexibleWorkout,
  reorderExercise,
  skipExercise,
  unskipExercise,
  addExercise,
  removeAddedExercise,
  getActiveExercises,
  renderModificationToolbar,
  renderAddExerciseDialog,
  renderSkipReasonDialog,
  SKIP_REASONS,
} from '../workout-flexibility';
import type { FlexibleWorkout, AddedExercise } from '../workout-flexibility';
import type { GeneratedWorkout } from '../progression-engine';

// ─── Helpers ───

function makeWorkout(exerciseCount = 3): GeneratedWorkout {
  const exercises = [];
  const slots = ['squat', 'bench', 'deadlift', 'ohp', 'row'];
  const names = ['Barbell Back Squat', 'Barbell Bench Press', 'Barbell Deadlift', 'Overhead Press', 'Barbell Row'];

  for (let i = 0; i < exerciseCount; i++) {
    exercises.push({
      name: names[i % names.length],
      exerciseSlot: slots[i % slots.length],
      sets: [
        { setNumber: 1, targetReps: '5', targetWeight: 135, restSeconds: 180, isAmrap: false },
        { setNumber: 2, targetReps: '5', targetWeight: 135, restSeconds: 180, isAmrap: false },
        { setNumber: 3, targetReps: '5', targetWeight: 135, restSeconds: 180, isAmrap: true },
      ],
      warmupSets: [
        { setNumber: 1, targetReps: '5', targetWeight: 45, restSeconds: 60, isAmrap: false },
        { setNumber: 2, targetReps: '3', targetWeight: 95, restSeconds: 60, isAmrap: false },
      ],
      notes: `Exercise ${i + 1}`,
    });
  }

  return {
    dayName: 'Workout A',
    dayLabel: 'Day A',
    exercises,
    programName: 'Starting Strength',
    weekLabel: 'Week 1',
    notes: ['Workout A notes'],
    scienceNote: 'Linear progression science',
  };
}

// ─── Tests ───

describe('createFlexibleWorkout', () => {
  it('preserves original exercise order', () => {
    const workout = makeWorkout(3);
    const flexible = createFlexibleWorkout(workout);

    expect(flexible.original).toBe(workout);
    expect(flexible.currentOrder).toEqual(['squat', 'bench', 'deadlift']);
    expect(flexible.modifications).toEqual([]);
    expect(flexible.skippedExercises).toEqual([]);
    expect(flexible.addedExercises).toEqual([]);
  });

  it('handles single-exercise workout', () => {
    const workout = makeWorkout(1);
    const flexible = createFlexibleWorkout(workout);

    expect(flexible.currentOrder).toEqual(['squat']);
  });

  it('handles empty workout', () => {
    const workout: GeneratedWorkout = {
      dayName: 'Empty',
      dayLabel: 'Empty',
      exercises: [],
      programName: 'Test',
      weekLabel: 'Week 1',
      notes: [],
      scienceNote: '',
    };
    const flexible = createFlexibleWorkout(workout);

    expect(flexible.currentOrder).toEqual([]);
  });
});

describe('reorderExercise', () => {
  it('moves an exercise from first to last', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const result = reorderExercise(flexible, 'squat', 2);

    expect(result.currentOrder).toEqual(['bench', 'deadlift', 'squat']);
    expect(result.modifications).toHaveLength(1);
    expect(result.modifications[0].type).toBe('reorder');
    expect(result.modifications[0].exerciseSlot).toBe('squat');
    expect(result.modifications[0].details.newPosition).toBe(2);
  });

  it('moves an exercise from last to first', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const result = reorderExercise(flexible, 'deadlift', 0);

    expect(result.currentOrder).toEqual(['deadlift', 'squat', 'bench']);
  });

  it('moves to a middle position', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const result = reorderExercise(flexible, 'squat', 1);

    expect(result.currentOrder).toEqual(['bench', 'squat', 'deadlift']);
  });

  it('clamps newIndex to valid range (too high)', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const result = reorderExercise(flexible, 'squat', 100);

    expect(result.currentOrder).toEqual(['bench', 'deadlift', 'squat']);
  });

  it('clamps newIndex to valid range (negative)', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const result = reorderExercise(flexible, 'deadlift', -5);

    expect(result.currentOrder).toEqual(['deadlift', 'squat', 'bench']);
  });

  it('does nothing for non-existent exercise', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const result = reorderExercise(flexible, 'nonexistent', 0);

    expect(result.currentOrder).toEqual(['squat', 'bench', 'deadlift']);
    expect(result.modifications).toEqual([]);
  });

  it('handles single-exercise reorder gracefully', () => {
    const flexible = createFlexibleWorkout(makeWorkout(1));
    const result = reorderExercise(flexible, 'squat', 0);

    expect(result.currentOrder).toEqual(['squat']);
  });

  it('does not mutate the original flexible workout', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const result = reorderExercise(flexible, 'squat', 2);

    expect(flexible.currentOrder).toEqual(['squat', 'bench', 'deadlift']);
    expect(result.currentOrder).toEqual(['bench', 'deadlift', 'squat']);
  });
});

describe('skipExercise', () => {
  it('removes exercise from active list', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const result = skipExercise(flexible, 'bench', 'Equipment busy');

    expect(result.currentOrder).toEqual(['squat', 'deadlift']);
    expect(result.skippedExercises).toEqual(['bench']);
    expect(result.modifications).toHaveLength(1);
    expect(result.modifications[0].type).toBe('skip');
    expect(result.modifications[0].details.reason).toBe('Equipment busy');
  });

  it('tracks skip reason', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const result = skipExercise(flexible, 'squat', 'Pain/discomfort');

    expect(result.modifications[0].details.reason).toBe('Pain/discomfort');
  });

  it('defaults reason to Other when not provided', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const result = skipExercise(flexible, 'squat');

    expect(result.modifications[0].details.reason).toBe('Other');
  });

  it('does not skip already-skipped exercise', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const step1 = skipExercise(flexible, 'bench', 'Equipment busy');
    const step2 = skipExercise(step1, 'bench', 'Pain/discomfort');

    expect(step2.skippedExercises).toEqual(['bench']);
    expect(step2.modifications).toHaveLength(1);
  });

  it('does not skip added exercises', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const added = addExercise(flexible, {
      name: 'Pause Squat',
      slot: 'pause_squat',
      sets: 3,
      reps: '5',
      weight: 100,
    });
    const result = skipExercise(added, 'pause_squat');

    // Should not have skipped it
    expect(result.currentOrder).toContain('pause_squat');
    expect(result.skippedExercises).not.toContain('pause_squat');
  });

  it('allows skipping all exercises', () => {
    let flexible = createFlexibleWorkout(makeWorkout(3));
    flexible = skipExercise(flexible, 'squat');
    flexible = skipExercise(flexible, 'bench');
    flexible = skipExercise(flexible, 'deadlift');

    expect(flexible.currentOrder).toEqual([]);
    expect(flexible.skippedExercises).toEqual(['squat', 'bench', 'deadlift']);
  });

  it('does not skip non-existent exercise', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const result = skipExercise(flexible, 'nonexistent');

    expect(result.currentOrder).toEqual(['squat', 'bench', 'deadlift']);
    expect(result.skippedExercises).toEqual([]);
  });
});

describe('unskipExercise', () => {
  it('restores a skipped exercise to original position', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const skipped = skipExercise(flexible, 'bench');
    const result = unskipExercise(skipped, 'bench');

    expect(result.currentOrder).toEqual(['squat', 'bench', 'deadlift']);
    expect(result.skippedExercises).toEqual([]);
  });

  it('does nothing if exercise is not skipped', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const result = unskipExercise(flexible, 'bench');

    expect(result.currentOrder).toEqual(['squat', 'bench', 'deadlift']);
  });

  it('restores first exercise correctly', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const skipped = skipExercise(flexible, 'squat');
    expect(skipped.currentOrder).toEqual(['bench', 'deadlift']);

    const result = unskipExercise(skipped, 'squat');
    expect(result.currentOrder).toEqual(['squat', 'bench', 'deadlift']);
  });

  it('restores last exercise correctly', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const skipped = skipExercise(flexible, 'deadlift');
    const result = unskipExercise(skipped, 'deadlift');

    expect(result.currentOrder).toEqual(['squat', 'bench', 'deadlift']);
  });

  it('restores exercise when multiple are skipped', () => {
    let flexible = createFlexibleWorkout(makeWorkout(3));
    flexible = skipExercise(flexible, 'squat');
    flexible = skipExercise(flexible, 'bench');

    const result = unskipExercise(flexible, 'bench');
    expect(result.currentOrder).toEqual(['bench', 'deadlift']);
    expect(result.skippedExercises).toEqual(['squat']);
  });

  it('removes the skip modification', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const skipped = skipExercise(flexible, 'bench', 'Equipment busy');
    expect(skipped.modifications).toHaveLength(1);

    const result = unskipExercise(skipped, 'bench');
    expect(result.modifications).toHaveLength(0);
  });
});

describe('addExercise', () => {
  it('appends an exercise to the active list', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const newEx: AddedExercise = {
      name: 'Pause Squat',
      slot: 'pause_squat',
      sets: 3,
      reps: '3-5',
      weight: 100,
    };
    const result = addExercise(flexible, newEx);

    expect(result.currentOrder).toEqual(['squat', 'bench', 'deadlift', 'pause_squat']);
    expect(result.addedExercises).toHaveLength(1);
    expect(result.addedExercises[0]).toEqual(newEx);
    expect(result.modifications).toHaveLength(1);
    expect(result.modifications[0].type).toBe('add');
  });

  it('can add multiple exercises', () => {
    let flexible = createFlexibleWorkout(makeWorkout(3));
    flexible = addExercise(flexible, { name: 'Curl', slot: 'curl', sets: 3, reps: '10' });
    flexible = addExercise(flexible, { name: 'Dip', slot: 'dip', sets: 3, reps: '8-12' });

    expect(flexible.currentOrder).toEqual(['squat', 'bench', 'deadlift', 'curl', 'dip']);
    expect(flexible.addedExercises).toHaveLength(2);
  });

  it('handles adding exercise with duplicate slot', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const result = addExercise(flexible, { name: 'Pause Squat', slot: 'squat', sets: 3, reps: '3' });

    // Should still add it (the slot appears twice)
    expect(result.currentOrder).toEqual(['squat', 'bench', 'deadlift', 'squat']);
    expect(result.addedExercises).toHaveLength(1);
  });

  it('tracks the modification', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const result = addExercise(flexible, { name: 'Curl', slot: 'curl', sets: 3, reps: '10' });

    expect(result.modifications[0].type).toBe('add');
    expect(result.modifications[0].exerciseSlot).toBe('curl');
    expect(result.modifications[0].details.addedExercise?.name).toBe('Curl');
  });
});

describe('removeAddedExercise', () => {
  it('removes a previously added exercise', () => {
    let flexible = createFlexibleWorkout(makeWorkout(3));
    flexible = addExercise(flexible, { name: 'Curl', slot: 'curl', sets: 3, reps: '10' });
    const result = removeAddedExercise(flexible, 'curl');

    expect(result.currentOrder).toEqual(['squat', 'bench', 'deadlift']);
    expect(result.addedExercises).toHaveLength(0);
  });

  it('does not remove original exercises', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const result = removeAddedExercise(flexible, 'squat');

    // Should not remove original squat
    expect(result.currentOrder).toEqual(['squat', 'bench', 'deadlift']);
  });

  it('removes the add modification', () => {
    let flexible = createFlexibleWorkout(makeWorkout(3));
    flexible = addExercise(flexible, { name: 'Curl', slot: 'curl', sets: 3, reps: '10' });
    expect(flexible.modifications).toHaveLength(1);

    const result = removeAddedExercise(flexible, 'curl');
    expect(result.modifications).toHaveLength(0);
  });

  it('does nothing for non-existent slot', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const result = removeAddedExercise(flexible, 'nonexistent');

    expect(result.currentOrder).toEqual(['squat', 'bench', 'deadlift']);
  });
});

describe('getActiveExercises', () => {
  it('returns correct combined list in current order', () => {
    const flexible = createFlexibleWorkout(makeWorkout(3));
    const active = getActiveExercises(flexible);

    expect(active).toHaveLength(3);
    expect(active[0].name).toBe('Barbell Back Squat');
    expect(active[0].slot).toBe('squat');
    expect(active[0].isAdded).toBe(false);
    expect(active[0].originalIndex).toBe(0);
    expect(active[1].slot).toBe('bench');
    expect(active[2].slot).toBe('deadlift');
  });

  it('includes warmup and working sets', () => {
    const flexible = createFlexibleWorkout(makeWorkout(1));
    const active = getActiveExercises(flexible);

    // 2 warmup + 3 working sets
    expect(active[0].sets).toHaveLength(5);
    expect(active[0].sets[0].isWarmup).toBe(true);
    expect(active[0].sets[1].isWarmup).toBe(true);
    expect(active[0].sets[2].isWarmup).toBe(false);
    expect(active[0].sets[3].isWarmup).toBe(false);
    expect(active[0].sets[4].isWarmup).toBe(false);
  });

  it('reflects reordering', () => {
    let flexible = createFlexibleWorkout(makeWorkout(3));
    flexible = reorderExercise(flexible, 'deadlift', 0);
    const active = getActiveExercises(flexible);

    expect(active[0].slot).toBe('deadlift');
    expect(active[0].originalIndex).toBe(2);
    expect(active[1].slot).toBe('squat');
    expect(active[2].slot).toBe('bench');
  });

  it('excludes skipped exercises', () => {
    let flexible = createFlexibleWorkout(makeWorkout(3));
    flexible = skipExercise(flexible, 'bench');
    const active = getActiveExercises(flexible);

    expect(active).toHaveLength(2);
    expect(active.map(a => a.slot)).toEqual(['squat', 'deadlift']);
  });

  it('includes added exercises', () => {
    let flexible = createFlexibleWorkout(makeWorkout(3));
    flexible = addExercise(flexible, { name: 'Curl', slot: 'curl', sets: 4, reps: '10-12', weight: 30 });
    const active = getActiveExercises(flexible);

    expect(active).toHaveLength(4);
    const added = active[3];
    expect(added.name).toBe('Curl');
    expect(added.slot).toBe('curl');
    expect(added.isAdded).toBe(true);
    expect(added.originalIndex).toBe(-1);
    expect(added.sets).toHaveLength(4);
    expect(added.sets[0].targetReps).toBe('10-12');
    expect(added.sets[0].targetWeight).toBe(30);
  });

  it('handles empty workout', () => {
    const workout: GeneratedWorkout = {
      dayName: 'Empty',
      dayLabel: 'Empty',
      exercises: [],
      programName: 'Test',
      weekLabel: 'Week 1',
      notes: [],
      scienceNote: '',
    };
    const flexible = createFlexibleWorkout(workout);
    const active = getActiveExercises(flexible);

    expect(active).toEqual([]);
  });

  it('added exercise with no weight defaults to 0', () => {
    let flexible = createFlexibleWorkout(makeWorkout(1));
    flexible = addExercise(flexible, { name: 'Plank', slot: 'ab_work', sets: 3, reps: '30s' });
    const active = getActiveExercises(flexible);

    const added = active.find(a => a.slot === 'ab_work');
    expect(added).toBeDefined();
    expect(added!.sets[0].targetWeight).toBe(0);
  });
});

describe('renderModificationToolbar', () => {
  it('renders up/down/skip buttons for normal exercise', () => {
    const html = renderModificationToolbar('squat', false, false, false);

    expect(html).toContain('data-action="move-up"');
    expect(html).toContain('data-action="move-down"');
    expect(html).toContain('data-action="skip"');
    expect(html).toContain('data-slot="squat"');
    expect(html).not.toContain('disabled');
  });

  it('disables up button for first exercise', () => {
    const html = renderModificationToolbar('squat', true, false, false);

    expect(html).toContain('wf-move-up-btn" data-action="move-up" data-slot="squat" title="Move up" disabled');
    expect(html).not.toContain('wf-move-down-btn" data-action="move-down" data-slot="squat" title="Move down" disabled');
  });

  it('disables down button for last exercise', () => {
    const html = renderModificationToolbar('deadlift', false, true, false);

    expect(html).toContain('wf-move-down-btn" data-action="move-down" data-slot="deadlift" title="Move down" disabled');
    expect(html).not.toContain('wf-move-up-btn" data-action="move-up" data-slot="deadlift" title="Move up" disabled');
  });

  it('renders restore button for skipped exercise', () => {
    const html = renderModificationToolbar('bench', false, false, true);

    expect(html).toContain('data-action="unskip"');
    expect(html).toContain('Restore');
    expect(html).not.toContain('data-action="skip"');
    expect(html).not.toContain('data-action="move-up"');
  });
});

describe('renderAddExerciseDialog', () => {
  it('renders exercise buttons from EXERCISE_SLOTS', () => {
    const html = renderAddExerciseDialog();

    expect(html).toContain('Add Exercise');
    expect(html).toContain('wf-add-exercise-btn');
    expect(html).toContain('data-slot="squat"');
    expect(html).toContain('data-slot="bench"');
    expect(html).toContain('data-slot="deadlift"');
    expect(html).toContain('(main)');
  });

  it('includes custom exercise form', () => {
    const html = renderAddExerciseDialog();

    expect(html).toContain('wf-custom-name');
    expect(html).toContain('wf-custom-sets');
    expect(html).toContain('wf-custom-reps');
    expect(html).toContain('wf-custom-weight');
    expect(html).toContain('data-action="add-custom"');
  });

  it('includes cancel button', () => {
    const html = renderAddExerciseDialog();

    expect(html).toContain('data-action="close-dialog"');
    expect(html).toContain('Cancel');
  });
});

describe('renderSkipReasonDialog', () => {
  it('renders all skip reasons', () => {
    const html = renderSkipReasonDialog('Bench Press');

    expect(html).toContain('Skip Bench Press');
    for (const reason of SKIP_REASONS) {
      expect(html).toContain(reason);
    }
  });

  it('includes cancel button', () => {
    const html = renderSkipReasonDialog('Squat');

    expect(html).toContain('data-action="close-dialog"');
    expect(html).toContain('Cancel');
  });
});

describe('complex scenarios', () => {
  it('reorder + skip + add produces correct active list', () => {
    let flexible = createFlexibleWorkout(makeWorkout(3));
    // Reorder: deadlift first
    flexible = reorderExercise(flexible, 'deadlift', 0);
    // Skip bench
    flexible = skipExercise(flexible, 'bench', 'Equipment busy');
    // Add curls
    flexible = addExercise(flexible, { name: 'Curl', slot: 'curl', sets: 3, reps: '10' });

    const active = getActiveExercises(flexible);
    expect(active.map(a => a.slot)).toEqual(['deadlift', 'squat', 'curl']);
    expect(flexible.modifications).toHaveLength(3);
  });

  it('skip all then add creates workout with only added exercises', () => {
    let flexible = createFlexibleWorkout(makeWorkout(2));
    flexible = skipExercise(flexible, 'squat');
    flexible = skipExercise(flexible, 'bench');
    flexible = addExercise(flexible, { name: 'Curl', slot: 'curl', sets: 3, reps: '10' });

    const active = getActiveExercises(flexible);
    expect(active).toHaveLength(1);
    expect(active[0].isAdded).toBe(true);
  });

  it('multiple reorders accumulate modifications', () => {
    let flexible = createFlexibleWorkout(makeWorkout(3));
    flexible = reorderExercise(flexible, 'squat', 2);
    flexible = reorderExercise(flexible, 'bench', 2);

    expect(flexible.currentOrder).toEqual(['deadlift', 'squat', 'bench']);
    expect(flexible.modifications).toHaveLength(2);
  });
});
