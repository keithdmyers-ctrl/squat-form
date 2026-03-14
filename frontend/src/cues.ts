/**
 * Corrective exercises and exercise progression databases.
 * Extracted from analyzer.ts — no behavior changes.
 */

import type { ExerciseProgression } from './types';

// ─── Corrective Exercises Database ───

export interface CorrectiveExercise {
  name: string;
  description: string;
  sets: string;
}

const CORRECTIVE_EXERCISES: Record<string, CorrectiveExercise[]> = {
  knee_valgus: [
    { name: 'Banded Squats', description: 'Loop a resistance band above your knees. Squat while actively pushing your knees into the band.', sets: '3x10' },
    { name: 'Clamshells', description: 'Lie on your side with knees bent. Open your top knee like a clamshell while keeping feet together.', sets: '3x15 each side' },
    { name: 'Monster Walks', description: 'With a band above your knees, take wide steps sideways keeping tension on the band.', sets: '3x10 each direction' },
  ],
  butt_wink: [
    { name: 'Box Squats', description: 'Squat to a box set at the depth where your lower back stays flat. Pause, then stand.', sets: '3x8' },
    { name: '90/90 Hip Stretch', description: 'Sit with one leg bent 90 degrees in front and one behind. Lean forward gently to stretch the hip.', sets: '30 sec each side' },
    { name: 'Goblet Squat Holds', description: 'Hold a goblet squat at the bottom position, using the weight to push your knees out and keep your torso upright.', sets: '3x10 sec at bottom' },
  ],
  excessive_forward_lean: [
    { name: 'Goblet Squats', description: 'Hold a weight at your chest and squat, focusing on keeping your torso as upright as possible.', sets: '3x10' },
    { name: 'Wall Ankle Stretches', description: 'Face a wall with one foot forward. Drive your knee toward the wall while keeping your heel down.', sets: '3x30 sec each' },
    { name: 'Front Foot Elevated Split Squats', description: 'Place your front foot on a small platform. Lower into a split squat, focusing on an upright torso.', sets: '3x8' },
  ],
  good_morning: [
    { name: 'Pause Squats', description: 'Squat down and hold the bottom position for 2 seconds, then drive up leading with your chest.', sets: '3x5, 2 sec pause' },
    { name: 'Front Squats', description: 'Squat with the bar in front position. This forces an upright torso and builds quad strength.', sets: '3x8' },
    { name: 'Leg Press', description: 'Use a leg press machine to build quad strength so your legs can keep up with your back.', sets: '3x10' },
  ],
  heel_rise: [
    { name: 'Wall Ankle Stretches', description: 'Face a wall with one foot forward. Drive your knee toward the wall while keeping your heel down.', sets: '3x30 sec' },
    { name: 'Heel-Elevated Squats', description: 'Place small plates or a wedge under your heels and squat. This temporarily bypasses ankle limitations.', sets: '3x10' },
    { name: 'Calf Foam Rolling', description: 'Roll a foam roller slowly up and down each calf, pausing on tight spots.', sets: '2 min each' },
  ],
  insufficient_depth: [
    { name: 'Goblet Squat to Box', description: 'Hold a weight at your chest and squat down to a box or bench at your target depth.', sets: '3x10' },
    { name: 'Deep Squat Hold', description: 'Hold the bottom of a squat while holding a doorframe or pole for support. Focus on opening your hips.', sets: '3x20 sec' },
    { name: 'Hip 90/90 Stretch', description: 'Sit with one leg bent 90 degrees in front and one behind. Lean forward to stretch hip flexors and rotators.', sets: '3x30 sec' },
  ],
  excessive_forward_knee_travel: [
    { name: 'Wall Squats', description: 'Stand facing a wall with toes a few inches away. Squat while keeping your knees from touching the wall, forcing you to sit back.', sets: '3x10' },
    { name: 'Box Squats with Sit-Back Cue', description: 'Squat to a box behind you, emphasizing sitting your hips back first rather than letting your knees drift forward.', sets: '3x8' },
    { name: 'Ankle Mobility Drills', description: 'Perform banded ankle distractions by wrapping a band low around one ankle and driving your knee forward over your toes to build controlled range.', sets: '3x30 sec each side' },
  ],
  fast_descent: [
    { name: 'Tempo Squats', description: 'Squat with a deliberate 3-second descent. Count "one-thousand-one, two, three" on the way down.', sets: '3x5, 3 sec down' },
    { name: 'Pause Squats', description: 'Squat down slowly and hold the bottom for 2 seconds before standing up.', sets: '3x5, 2 sec pause' },
    { name: 'Eccentric Wall Sits', description: 'Slide slowly down a wall into a seated position over 5 seconds, then hold.', sets: '3x20 sec' },
  ],
  slow_descent: [
    { name: 'Tempo Squats with Prescribed Speed', description: 'Squat with a deliberate 2-second descent — no slower. Use a metronome or counting to maintain a brisk, controlled pace.', sets: '3x8, 2 sec down' },
    { name: 'Dynamic Box Squats', description: 'Sit back to a box quickly but under control, then explode up. Trains a faster, more aggressive descent while keeping form.', sets: '3x5' },
    { name: 'Drop Squats', description: 'From standing, quickly drop into a quarter-squat catching position. Builds comfort with a faster descent under load.', sets: '3x8' },
  ],
  bouncing: [
    { name: 'Pause Squats', description: 'Squat down and hold the bottom for 2 seconds before pushing back up. No bouncing allowed.', sets: '3x5, 2 sec pause' },
    { name: 'Dead-Stop Squats', description: 'Squat to a box, sit down completely, pause for a full second, then stand. Removes all momentum.', sets: '3x5' },
    { name: 'Isometric Bottom Hold', description: 'Hold the bottom of a squat without moving. Build strength in the weakest position.', sets: '3x10 sec' },
  ],
  asymmetric_hips: [
    { name: 'Bulgarian Split Squats', description: 'Place one foot on a bench behind you. Squat on the front leg to build single-leg strength.', sets: '3x8 each side' },
    { name: 'Single-Leg Leg Press', description: 'Use one leg at a time on the leg press to identify and fix strength imbalances.', sets: '3x10 each side' },
    { name: 'Side-Lying Hip Abduction', description: 'Lie on your side and raise your top leg slowly. Strengthens hip stabilizers.', sets: '3x15 each side' },
  ],
  asymmetric_shift: [
    { name: 'Bulgarian Split Squats', description: 'Place one foot on a bench behind you. Squat on the front leg to build single-leg strength.', sets: '3x8 each side' },
    { name: 'Single-Leg Leg Press', description: 'Use one leg at a time on the leg press to identify and fix strength imbalances.', sets: '3x10 each side' },
    { name: 'Side-Lying Hip Abduction', description: 'Lie on your side and raise your top leg slowly. Strengthens hip stabilizers.', sets: '3x15 each side' },
  ],
  incomplete_lockout: [
    { name: 'Glute Bridges', description: 'Lie on your back with knees bent. Drive hips up and squeeze glutes hard at the top.', sets: '3x12' },
    { name: 'Hip Thrusts', description: 'With your upper back on a bench, drive hips up and hold the top position for a second.', sets: '3x10' },
    { name: 'Standing Hip Extensions', description: 'Stand on one leg and extend the other leg behind you, squeezing your glute.', sets: '3x12 each side' },
  ],
  trunk_angle_increase_on_ascent: [
    { name: 'Pause Squats', description: 'Pause at the bottom and focus on driving your chest up first as you stand.', sets: '3x5, 2 sec pause' },
    { name: 'Front Squats', description: 'The front-loaded position forces you to keep your chest up throughout the movement.', sets: '3x8' },
    { name: 'Tempo Squats', description: 'Use a slow controlled ascent (3 seconds up) to practice keeping your torso angle constant.', sets: '3x5, 3 sec up' },
  ],

  // ─── Deadlift Corrective Exercises ───

  rounded_back: [
    { name: 'Paused Deadlifts', description: 'Pull to knee height and hold for 2 seconds, focusing on keeping your chest up and back flat. Then complete the pull.', sets: '3x3' },
    { name: 'Romanian Deadlifts', description: 'Hinge at the hips with a slight knee bend, lowering the bar along your legs. Focus on maintaining a neutral spine throughout.', sets: '3x8' },
    { name: 'Band Pull-Aparts', description: 'Hold a band at shoulder width and pull it apart by squeezing your shoulder blades together. Builds upper back strength to resist rounding.', sets: '3x15' },
  ],
  hip_shoot: [
    { name: 'Deficit Deadlifts', description: 'Stand on a 1-2 inch platform and deadlift. The extra range of motion forces you to use your legs more off the floor.', sets: '3x5' },
    { name: 'Front Squats', description: 'Squat with the bar in front position. Builds the quad strength needed to drive with your legs rather than your back.', sets: '3x8' },
    { name: 'Tempo Deadlifts', description: 'Pull with a deliberate 3-second concentric. This forces you to stay patient and keep your hips and shoulders rising together.', sets: '3x3' },
  ],
  hitching: [
    { name: 'Block Pulls', description: 'Deadlift from blocks set just below knee height. Builds strength in the top portion of the pull where hitching occurs.', sets: '3x5' },
    { name: 'Rack Pulls', description: 'Pull from pins set in a rack at knee height. Overload the lockout portion to build finishing strength.', sets: '3x5' },
    { name: "Farmer's Walks", description: "Pick up heavy dumbbells or farmer's walk handles and walk for distance. Builds the grip endurance that prevents grip-related hitching.", sets: '3x30 sec' },
  ],
  asymmetric_pull: [
    { name: 'Single-Leg Romanian Deadlifts', description: 'Stand on one leg and hinge forward, lowering a dumbbell or kettlebell toward the floor. Builds unilateral hip and hamstring strength to correct side-to-side imbalances.', sets: '3x8 each side' },
    { name: 'Suitcase Deadlifts', description: 'Deadlift a weight held in one hand at your side. Forces your core and hips to resist lateral shifting throughout the pull.', sets: '3x8 each side' },
    { name: 'Single-Arm Dumbbell Rows', description: 'Row a dumbbell with one arm at a time, bracing on a bench. Identifies and corrects back strength imbalances that cause asymmetric pulling.', sets: '3x10 each side' },
  ],
  fast_descent_deadlift: [
    { name: 'Tempo Romanian Deadlifts', description: 'Perform RDLs with a slow 4-second lowering phase. Builds eccentric control through the hip hinge pattern.', sets: '3x6, 4 sec down' },
    { name: 'Controlled Eccentric Deadlifts', description: 'After locking out a deadlift, lower the bar over 3-4 seconds back to the floor. Focus on maintaining tension and bar path.', sets: '3x5, 3-4 sec down' },
    { name: 'Pause-at-Knee Deadlifts', description: 'Lower the bar from lockout and pause for 2 seconds when it reaches your knees, then continue to the floor. Builds control at the hardest part of the descent.', sets: '3x5, 2 sec pause' },
  ],
  insufficient_rom_deadlift: [
    { name: 'Deficit Deadlifts', description: 'Stand on a 1-2 inch platform and deadlift from the floor. The added range of motion builds strength and mobility in the bottom position.', sets: '3x5' },
    { name: 'Hip Hinge Drills', description: 'Stand with your back to a wall and push your hips back until they touch the wall. Step further from the wall each set to increase hinge depth.', sets: '3x10' },
    { name: 'Standing Hamstring Stretches', description: 'Place one foot on a low box and hinge forward with a flat back until you feel a stretch in the back of your thigh. Improves the flexibility needed for a full pull from the floor.', sets: '3x30 sec each side' },
  ],

  // ─── Bench Press Corrective Exercises ───

  no_pause: [
    { name: 'Spoto Press', description: 'Lower the bar to 1 inch above your chest and hold for 1 second before pressing. Builds strength and control at the bottom.', sets: '3x5' },
    { name: 'Long Pause Bench', description: 'Lower the bar to your chest and hold for a full 3 seconds before pressing. Eliminates the stretch reflex and builds raw strength.', sets: '3x5' },
    { name: 'Floor Press', description: 'Bench press while lying on the floor. Your elbows touch the ground at the bottom, creating a natural pause point.', sets: '3x8' },
  ],
  uneven_press: [
    { name: 'Dumbbell Bench Press', description: 'Press with dumbbells instead of a barbell. Each arm must work independently, exposing and correcting imbalances.', sets: '3x10' },
    { name: 'Single-Arm Dumbbell Press', description: 'Press one dumbbell at a time while lying on the bench. Focus on the weaker side first, then match reps with the stronger side.', sets: '3x8 each side' },
    { name: 'Banded Press', description: 'Attach a band to the barbell for accommodating resistance. The band forces even pressing speed as it gets harder at the top.', sets: '3x10' },
  ],
  press_stall: [
    { name: 'Spoto Press', description: 'Pause the bar 1 inch off your chest for 1-2 seconds, then press. Builds strength right at the sticking point.', sets: '3x5' },
    { name: 'Pin Press', description: 'Set safety pins at your sticking point height. Start each rep from the pins (dead stop) and press to lockout.', sets: '3x5' },
    { name: 'Close-Grip Bench', description: 'Bench with a narrower grip (hands just inside shoulder width). Builds tricep strength needed to push through the mid-range sticking point.', sets: '3x8' },
  ],
};

/** Get corrective exercises for a given issue name. */
export function getCorrectiveExercises(issueName: string): CorrectiveExercise[] {
  return CORRECTIVE_EXERCISES[issueName] ?? [];
}

// ─── Exercise Progression Database ───

export const PROGRESSION_DATABASE: Record<string, ExerciseProgression[]> = {
  knee_valgus: [
    { level: 'Start here', exercise: 'Banded Clamshells (3x15)', criteria: 'Can complete all reps without losing form' },
    { level: 'Progress to', exercise: 'Banded Squats (3x10)', criteria: 'Knees stay over toes with medium band' },
    { level: 'Goal', exercise: 'Full squats with no valgus', criteria: 'No inward knee collapse at working weight' },
  ],
  butt_wink: [
    { level: 'Start here', exercise: 'Box Squats to above parallel', criteria: 'Can maintain flat back at box height' },
    { level: 'Progress to', exercise: 'Goblet Squat Holds at depth', criteria: 'Can hold bottom for 10 sec with flat back' },
    { level: 'Goal', exercise: 'Full depth squat, no wink', criteria: 'Hip crease below knee with neutral spine' },
  ],
  excessive_forward_lean: [
    { level: 'Start here', exercise: 'Goblet Squats (3x10)', criteria: 'Can keep chest up throughout' },
    { level: 'Progress to', exercise: 'Front Squats (3x8)', criteria: 'Upright torso at moderate weight' },
    { level: 'Goal', exercise: 'Back squat with proper torso angle', criteria: 'Torso angle within expected range for squat type' },
  ],
  good_morning: [
    { level: 'Start here', exercise: 'Pause Squats (3x5, 2 sec)', criteria: 'Can drive up without chest dropping' },
    { level: 'Progress to', exercise: 'Tempo Squats (3x5, 3 sec up)', criteria: 'Even hip/shoulder rise on ascent' },
    { level: 'Goal', exercise: 'Full squat with matched rise', criteria: 'Shoulders and hips rise together consistently' },
  ],
  heel_rise: [
    { level: 'Start here', exercise: 'Heel-Elevated Squats', criteria: 'Can squat to depth without heel rise' },
    { level: 'Progress to', exercise: 'Flat-foot with ankle stretches', criteria: 'Pass wall ankle test (5 inches)' },
    { level: 'Goal', exercise: 'Full squat, heels down', criteria: 'Full depth with heels flat on the ground' },
  ],
  insufficient_depth: [
    { level: 'Start here', exercise: 'Goblet Squat to Box', criteria: 'Can reach box at target depth' },
    { level: 'Progress to', exercise: 'Deep Squat Holds (3x20 sec)', criteria: 'Comfortable at target depth' },
    { level: 'Goal', exercise: 'Full depth squat consistently', criteria: 'Hip crease at or below knee every rep' },
  ],
  excessive_forward_knee_travel: [
    { level: 'Start here', exercise: 'Wall Squats (3x10)', criteria: 'Can squat without knees touching the wall' },
    { level: 'Progress to', exercise: 'Box Squats with sit-back cue (3x8)', criteria: 'Shins stay near vertical at box depth' },
    { level: 'Goal', exercise: 'Full squat with controlled knee travel', criteria: 'Knees track over toes without excessive forward drift' },
  ],
  slow_descent: [
    { level: 'Start here', exercise: 'Tempo Squats (3x8) with 2-sec descent', criteria: 'Can maintain brisk, consistent descent speed' },
    { level: 'Progress to', exercise: 'Dynamic Box Squats (3x5)', criteria: 'Controlled but quick descent to box' },
    { level: 'Goal', exercise: 'Full squat with appropriate descent speed', criteria: 'Descent takes 1-2 seconds consistently without being excessively slow' },
  ],
  incomplete_lockout: [
    { level: 'Start here', exercise: 'Glute Bridges (3x12)', criteria: 'Full hip extension at top' },
    { level: 'Progress to', exercise: 'Hip Thrusts (3x10)', criteria: 'Strong lockout with pause' },
    { level: 'Goal', exercise: 'Full lockout every rep', criteria: 'Complete hip and knee extension at top' },
  ],

  // ─── Deadlift Progressions ───

  rounded_back: [
    { level: 'Start here', exercise: 'Romanian Deadlifts (3x8) with light weight', criteria: 'Can maintain flat back through full ROM' },
    { level: 'Progress to', exercise: 'Paused Deadlifts (3x3) at knee height', criteria: 'Neutral spine maintained during 2-sec pause' },
    { level: 'Goal', exercise: 'Full deadlift with neutral spine', criteria: 'No back rounding at working weight' },
  ],
  hip_shoot: [
    { level: 'Start here', exercise: 'Tempo Deadlifts (3x3) with 3-sec pull', criteria: 'Hips and shoulders rise together at slow speed' },
    { level: 'Progress to', exercise: 'Deficit Deadlifts (3x5)', criteria: 'Legs drive the initial pull without hip shoot' },
    { level: 'Goal', exercise: 'Full deadlift with matched rise', criteria: 'Hips and shoulders rise at same rate consistently' },
  ],
  hitching: [
    { level: 'Start here', exercise: 'Block Pulls from below knee (3x5)', criteria: 'Smooth lockout with no bar stoppage' },
    { level: 'Progress to', exercise: 'Full deadlifts at moderate weight', criteria: 'One continuous pull from floor to lockout' },
    { level: 'Goal', exercise: 'Full deadlift — no hitching', criteria: 'Smooth pull at working weight every rep' },
  ],
  asymmetric_pull: [
    { level: 'Start here', exercise: 'Single-Leg RDLs (3x8 each side)', criteria: 'Can balance and hinge evenly on each leg' },
    { level: 'Progress to', exercise: 'Suitcase Deadlifts (3x8 each side)', criteria: 'No lateral shift when pulling from one side' },
    { level: 'Goal', exercise: 'Symmetrical conventional deadlift', criteria: 'Bar stays level and rises evenly with no lateral drift' },
  ],
  fast_descent_deadlift: [
    { level: 'Start here', exercise: 'Tempo RDLs (3x6) with 4-sec lowering', criteria: 'Can control the bar path for full 4 seconds on the way down' },
    { level: 'Progress to', exercise: 'Controlled Eccentric Deadlifts (3x5)', criteria: 'Smooth 3-sec lowering from lockout to floor' },
    { level: 'Goal', exercise: 'Full deadlift with controlled descent', criteria: 'Bar lowered under control every rep with no dropping' },
  ],
  insufficient_rom_deadlift: [
    { level: 'Start here', exercise: 'Hip Hinge Drills (3x10) with wall cue', criteria: 'Can hinge to 90 degrees with flat back' },
    { level: 'Progress to', exercise: 'Deficit Deadlifts (3x5) from 1-inch platform', criteria: 'Can pull from deficit with neutral spine' },
    { level: 'Goal', exercise: 'Full deadlift from floor with proper ROM', criteria: 'Can set up with flat back and pull from standard floor height' },
  ],

  // ─── Bench Press Progressions ───

  no_pause: [
    { level: 'Start here', exercise: 'Long Pause Bench (3x5) with 3-sec pause', criteria: 'Can hold bar motionless on chest for 3 seconds' },
    { level: 'Progress to', exercise: 'Spoto Press (3x5) — pause 1 inch off chest', criteria: 'Controlled pause without sinking into chest' },
    { level: 'Goal', exercise: 'Competition pause on every rep', criteria: 'Clean pause and press command on all reps' },
  ],
  uneven_press: [
    { level: 'Start here', exercise: 'Dumbbell Bench Press (3x10)', criteria: 'Both arms press at same speed with equal weight' },
    { level: 'Progress to', exercise: 'Single-Arm Dumbbell Press (3x8 each)', criteria: 'Equal reps and control on both sides' },
    { level: 'Goal', exercise: 'Even barbell press', criteria: 'Bar stays level throughout every rep' },
  ],
  press_stall: [
    { level: 'Start here', exercise: 'Pin Press from sticking point (3x5)', criteria: 'Can press from pins without getting stuck' },
    { level: 'Progress to', exercise: 'Spoto Press (3x5) — building off-chest power', criteria: 'Smooth press through previous sticking point' },
    { level: 'Goal', exercise: 'Full bench press with no stall', criteria: 'Continuous press from chest to lockout at working weight' },
  ],
};

/** Get exercise progressions for a given issue name. */
export function getExerciseProgressions(issueName: string): ExerciseProgression[] {
  return PROGRESSION_DATABASE[issueName] ?? [];
}
