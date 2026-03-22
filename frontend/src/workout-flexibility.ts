/**
 * Workout flexibility: mid-workout exercise reordering, skipping, adding,
 * and substitution.
 *
 * Real gym sessions don't follow a fixed order. If the squat rack is
 * occupied, you start with bench. If your shoulder hurts, you skip OHP.
 * If you feel great, you add paused squats.
 */

import type { GeneratedWorkout } from './progression-engine';
import { EXERCISE_SLOTS } from './workout-programs';

// ─── Types ───

export interface WorkoutModification {
  type: 'reorder' | 'skip' | 'add' | 'substitute';
  exerciseSlot: string;
  timestamp: string;
  details: {
    newPosition?: number;
    reason?: string;
    addedExercise?: {
      name: string;
      slot: string;
      sets: number;
      reps: string;
      weight?: number;
    };
    substituteWith?: string;
  };
}

export interface AddedExercise {
  name: string;
  slot: string;
  sets: number;
  reps: string;
  weight?: number;
}

export interface FlexibleWorkout {
  original: GeneratedWorkout;
  modifications: WorkoutModification[];
  currentOrder: string[];
  skippedExercises: string[];
  addedExercises: AddedExercise[];
}

export const SKIP_REASONS = [
  'Equipment busy',
  'Pain/discomfort',
  'Running short on time',
  'Already done elsewhere',
  'Other',
] as const;

export type SkipReason = typeof SKIP_REASONS[number];

// ─── Core Functions ───

/**
 * Create a flexible workout wrapper around a generated workout.
 */
export function createFlexibleWorkout(workout: GeneratedWorkout): FlexibleWorkout {
  return {
    original: workout,
    modifications: [],
    currentOrder: workout.exercises.map(e => e.exerciseSlot),
    skippedExercises: [],
    addedExercises: [],
  };
}

/**
 * Reorder an exercise to a new position.
 * Returns a new FlexibleWorkout with the exercise moved.
 */
export function reorderExercise(
  flexible: FlexibleWorkout,
  exerciseSlot: string,
  newIndex: number,
): FlexibleWorkout {
  const order = [...flexible.currentOrder];
  const currentIdx = order.indexOf(exerciseSlot);
  if (currentIdx === -1) return flexible;

  // Clamp newIndex to valid range
  const clampedIndex = Math.max(0, Math.min(newIndex, order.length - 1));

  // Remove from current position and insert at new position
  order.splice(currentIdx, 1);
  order.splice(clampedIndex, 0, exerciseSlot);

  const modification: WorkoutModification = {
    type: 'reorder',
    exerciseSlot,
    timestamp: new Date().toISOString(),
    details: { newPosition: clampedIndex },
  };

  return {
    ...flexible,
    currentOrder: order,
    modifications: [...flexible.modifications, modification],
  };
}

/**
 * Skip an exercise (remove from current order, track reason).
 */
export function skipExercise(
  flexible: FlexibleWorkout,
  exerciseSlot: string,
  reason?: string,
): FlexibleWorkout {
  // Cannot skip if already skipped
  if (flexible.skippedExercises.includes(exerciseSlot)) return flexible;
  // Cannot skip added exercises — use removeAddedExercise instead
  if (flexible.addedExercises.some(e => e.slot === exerciseSlot)) return flexible;
  // Must be in original exercises
  if (!flexible.original.exercises.some(e => e.exerciseSlot === exerciseSlot)) return flexible;

  const modification: WorkoutModification = {
    type: 'skip',
    exerciseSlot,
    timestamp: new Date().toISOString(),
    details: { reason: reason ?? 'Other' },
  };

  return {
    ...flexible,
    currentOrder: flexible.currentOrder.filter(s => s !== exerciseSlot),
    skippedExercises: [...flexible.skippedExercises, exerciseSlot],
    modifications: [...flexible.modifications, modification],
  };
}

/**
 * Un-skip a previously skipped exercise (restore to original position).
 */
export function unskipExercise(
  flexible: FlexibleWorkout,
  exerciseSlot: string,
): FlexibleWorkout {
  if (!flexible.skippedExercises.includes(exerciseSlot)) return flexible;

  // Find where this exercise was in the original order
  const originalOrder = flexible.original.exercises.map(e => e.exerciseSlot);
  const originalIdx = originalOrder.indexOf(exerciseSlot);

  // Determine the best insertion position by finding the closest preceding
  // original exercise that is still in currentOrder
  const newOrder = [...flexible.currentOrder];
  let insertAt = 0; // default: beginning (for first exercise or no preceding found)
  if (originalIdx > 0) {
    insertAt = newOrder.length; // fallback: append
    for (let i = originalIdx - 1; i >= 0; i--) {
      const precedingSlot = originalOrder[i];
      const idxInCurrent = newOrder.indexOf(precedingSlot);
      if (idxInCurrent !== -1) {
        insertAt = idxInCurrent + 1;
        break;
      }
      // If we can't find any preceding exercise, insert at the beginning
      if (i === 0) {
        insertAt = 0;
      }
    }
  }

  newOrder.splice(insertAt, 0, exerciseSlot);

  return {
    ...flexible,
    currentOrder: newOrder,
    skippedExercises: flexible.skippedExercises.filter(s => s !== exerciseSlot),
    modifications: flexible.modifications.filter(
      m => !(m.type === 'skip' && m.exerciseSlot === exerciseSlot)
    ),
  };
}

/**
 * Add an extra exercise to the workout.
 */
export function addExercise(
  flexible: FlexibleWorkout,
  exercise: AddedExercise,
): FlexibleWorkout {
  const modification: WorkoutModification = {
    type: 'add',
    exerciseSlot: exercise.slot,
    timestamp: new Date().toISOString(),
    details: { addedExercise: exercise },
  };

  return {
    ...flexible,
    currentOrder: [...flexible.currentOrder, exercise.slot],
    addedExercises: [...flexible.addedExercises, exercise],
    modifications: [...flexible.modifications, modification],
  };
}

/**
 * Remove a previously added exercise.
 * Only removes exercises that were added mid-workout, not original exercises.
 */
export function removeAddedExercise(
  flexible: FlexibleWorkout,
  slot: string,
): FlexibleWorkout {
  // Only remove if it was actually added (not an original exercise)
  if (!flexible.addedExercises.some(e => e.slot === slot)) return flexible;

  return {
    ...flexible,
    currentOrder: flexible.currentOrder.filter(s => s !== slot),
    addedExercises: flexible.addedExercises.filter(e => e.slot !== slot),
    modifications: flexible.modifications.filter(
      m => !(m.type === 'add' && m.exerciseSlot === slot)
    ),
  };
}

// ─── Query Functions ───

export interface ActiveExercise {
  name: string;
  slot: string;
  sets: Array<{
    setNumber: number;
    targetReps: string;
    targetWeight: number;
    isWarmup: boolean;
  }>;
  isAdded: boolean;
  originalIndex: number;
}

/**
 * Get the exercises in their current display order (including added, excluding skipped).
 */
export function getActiveExercises(flexible: FlexibleWorkout): ActiveExercise[] {
  const originalExercises = flexible.original.exercises;
  const result: ActiveExercise[] = [];

  for (const slot of flexible.currentOrder) {
    // Check if this is an added exercise
    const addedEx = flexible.addedExercises.find(e => e.slot === slot);
    if (addedEx) {
      const sets: ActiveExercise['sets'] = [];
      for (let i = 0; i < addedEx.sets; i++) {
        sets.push({
          setNumber: i + 1,
          targetReps: addedEx.reps,
          targetWeight: addedEx.weight ?? 0,
          isWarmup: false,
        });
      }
      result.push({
        name: addedEx.name,
        slot: addedEx.slot,
        sets,
        isAdded: true,
        originalIndex: -1,
      });
      continue;
    }

    // It's an original exercise
    const originalIdx = originalExercises.findIndex(e => e.exerciseSlot === slot);
    if (originalIdx === -1) continue;
    const origEx = originalExercises[originalIdx];

    const sets: ActiveExercise['sets'] = [];

    // Include warmup sets first
    if (origEx.warmupSets) {
      for (const ws of origEx.warmupSets) {
        sets.push({
          setNumber: ws.setNumber,
          targetReps: ws.targetReps,
          targetWeight: ws.targetWeight,
          isWarmup: true,
        });
      }
    }

    // Then working sets
    for (const ws of origEx.sets) {
      sets.push({
        setNumber: ws.setNumber,
        targetReps: ws.targetReps,
        targetWeight: ws.targetWeight,
        isWarmup: false,
      });
    }

    result.push({
      name: origEx.name,
      slot: origEx.exerciseSlot,
      sets,
      isAdded: false,
      originalIndex: originalIdx,
    });
  }

  return result;
}

// ─── UI Rendering ───

/**
 * Render the workout modification toolbar (reorder arrows, skip button).
 */
export function renderModificationToolbar(
  exerciseSlot: string,
  isFirst: boolean,
  isLast: boolean,
  isSkipped: boolean,
): string {
  const upDisabled = isFirst ? ' disabled' : '';
  const downDisabled = isLast ? ' disabled' : '';

  if (isSkipped) {
    return `<div class="wf-toolbar" data-slot="${exerciseSlot}">
  <button class="wf-btn wf-unskip-btn" data-action="unskip" data-slot="${exerciseSlot}" title="Restore exercise">Restore</button>
</div>`;
  }

  return `<div class="wf-toolbar" data-slot="${exerciseSlot}">
  <button class="wf-btn wf-move-up-btn" data-action="move-up" data-slot="${exerciseSlot}" title="Move up"${upDisabled}>&uarr;</button>
  <button class="wf-btn wf-move-down-btn" data-action="move-down" data-slot="${exerciseSlot}" title="Move down"${downDisabled}>&darr;</button>
  <button class="wf-btn wf-skip-btn" data-action="skip" data-slot="${exerciseSlot}" title="Skip exercise">Skip</button>
</div>`;
}

/**
 * Render the "Add Exercise" dialog.
 * Shows common exercises (from EXERCISE_SLOTS) with quick-add buttons.
 */
export function renderAddExerciseDialog(): string {
  const slots = Object.entries(EXERCISE_SLOTS);

  const exerciseButtons = slots.map(([key, slot]) => {
    const mainLabel = slot.isMainLift ? ' (main)' : '';
    return `<button class="wf-add-exercise-btn" data-slot="${key}" data-name="${slot.name}">${slot.name}${mainLabel}</button>`;
  }).join('\n    ');

  return `<div class="wf-add-dialog">
  <h4 class="wf-dialog-title">Add Exercise</h4>
  <div class="wf-exercise-grid">
    ${exerciseButtons}
  </div>
  <div class="wf-add-custom">
    <h5>Custom</h5>
    <div class="wf-custom-form">
      <input type="text" class="wf-custom-name" placeholder="Exercise name" />
      <input type="number" class="wf-custom-sets" placeholder="Sets" value="3" min="1" max="10" />
      <input type="text" class="wf-custom-reps" placeholder="Reps (e.g. 8-12)" value="8-12" />
      <input type="number" class="wf-custom-weight" placeholder="Weight (optional)" min="0" step="5" />
      <button class="wf-btn wf-add-custom-btn" data-action="add-custom">Add Custom</button>
    </div>
  </div>
  <button class="wf-btn wf-dialog-close" data-action="close-dialog">Cancel</button>
</div>`;
}

/**
 * Render the skip reason selector.
 */
export function renderSkipReasonDialog(exerciseName: string): string {
  const reasonButtons = SKIP_REASONS.map(reason =>
    `<button class="wf-reason-btn" data-reason="${reason}">${reason}</button>`
  ).join('\n    ');

  return `<div class="wf-skip-dialog">
  <h4 class="wf-dialog-title">Skip ${exerciseName}?</h4>
  <p class="wf-dialog-subtitle">Why are you skipping this exercise?</p>
  <div class="wf-reason-list">
    ${reasonButtons}
  </div>
  <button class="wf-btn wf-dialog-close" data-action="close-dialog">Cancel</button>
</div>`;
}
