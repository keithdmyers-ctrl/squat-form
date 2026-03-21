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
  /** Optional inline SVG illustration (stick figure). */
  svg?: string;
  /** Optional YouTube video URL demonstrating the exercise. */
  videoUrl?: string;
}

// ─── Stick-Figure SVG Illustrations ───
// Simple 80x50 viewBox stick figures for common corrective exercises.

const SVG_CLAMSHELL = `<svg viewBox="0 0 80 50" xmlns="http://www.w3.org/2000/svg" style="width:80px;height:50px"><line x1="10" y1="40" x2="40" y2="40" stroke="#4cc9f0" stroke-width="2"/><line x1="40" y1="40" x2="55" y2="30" stroke="#4cc9f0" stroke-width="2"/><line x1="55" y1="30" x2="40" y2="20" stroke="#4cc9f0" stroke-width="2" stroke-dasharray="3,2"/><circle cx="10" cy="38" r="4" fill="none" stroke="#4cc9f0" stroke-width="1.5"/><path d="M55 30 L70 18" stroke="#4ade80" stroke-width="2" stroke-dasharray="4,2"/><text x="62" y="15" fill="#4ade80" font-size="7">open</text></svg>`;

const SVG_GOBLET_SQUAT = `<svg viewBox="0 0 80 50" xmlns="http://www.w3.org/2000/svg" style="width:80px;height:50px"><circle cx="40" cy="8" r="5" fill="none" stroke="#4cc9f0" stroke-width="1.5"/><line x1="40" y1="13" x2="40" y2="28" stroke="#4cc9f0" stroke-width="2"/><line x1="40" y1="28" x2="30" y2="42" stroke="#4cc9f0" stroke-width="2"/><line x1="30" y1="42" x2="28" y2="48" stroke="#4cc9f0" stroke-width="2"/><line x1="40" y1="28" x2="50" y2="42" stroke="#4cc9f0" stroke-width="2"/><line x1="50" y1="42" x2="52" y2="48" stroke="#4cc9f0" stroke-width="2"/><rect x="35" y="18" width="10" height="6" rx="1" fill="none" stroke="#fbbf24" stroke-width="1.5"/></svg>`;

const SVG_WALL_ANKLE = `<svg viewBox="0 0 80 50" xmlns="http://www.w3.org/2000/svg" style="width:80px;height:50px"><line x1="10" y1="5" x2="10" y2="48" stroke="#666" stroke-width="3"/><circle cx="30" cy="10" r="5" fill="none" stroke="#4cc9f0" stroke-width="1.5"/><line x1="30" y1="15" x2="28" y2="28" stroke="#4cc9f0" stroke-width="2"/><line x1="28" y1="28" x2="15" y2="38" stroke="#4cc9f0" stroke-width="2"/><line x1="15" y1="38" x2="20" y2="48" stroke="#4cc9f0" stroke-width="2"/><line x1="28" y1="28" x2="40" y2="40" stroke="#4cc9f0" stroke-width="2"/><line x1="40" y1="40" x2="42" y2="48" stroke="#4cc9f0" stroke-width="2"/><path d="M15 38 L10 30" stroke="#4ade80" stroke-width="1.5" stroke-dasharray="3,2"/><text x="45" y="35" fill="#4ade80" font-size="6">knee→wall</text></svg>`;

const SVG_GLUTE_BRIDGE = `<svg viewBox="0 0 80 50" xmlns="http://www.w3.org/2000/svg" style="width:80px;height:50px"><line x1="5" y1="48" x2="75" y2="48" stroke="#666" stroke-width="1"/><circle cx="15" cy="35" r="4" fill="none" stroke="#4cc9f0" stroke-width="1.5"/><line x1="15" y1="39" x2="40" y2="30" stroke="#4cc9f0" stroke-width="2"/><line x1="40" y1="30" x2="55" y2="38" stroke="#4cc9f0" stroke-width="2"/><line x1="55" y1="38" x2="55" y2="48" stroke="#4cc9f0" stroke-width="2"/><path d="M35 30 L35 20" stroke="#4ade80" stroke-width="1.5" stroke-dasharray="3,2"/><text x="38" y="18" fill="#4ade80" font-size="6">drive up</text></svg>`;

const SVG_PAUSE_SQUAT = `<svg viewBox="0 0 80 50" xmlns="http://www.w3.org/2000/svg" style="width:80px;height:50px"><circle cx="40" cy="10" r="5" fill="none" stroke="#4cc9f0" stroke-width="1.5"/><line x1="40" y1="15" x2="40" y2="26" stroke="#4cc9f0" stroke-width="2"/><line x1="40" y1="26" x2="30" y2="38" stroke="#4cc9f0" stroke-width="2"/><line x1="30" y1="38" x2="28" y2="48" stroke="#4cc9f0" stroke-width="2"/><line x1="40" y1="26" x2="50" y2="38" stroke="#4cc9f0" stroke-width="2"/><line x1="50" y1="38" x2="52" y2="48" stroke="#4cc9f0" stroke-width="2"/><text x="55" y="32" fill="#fbbf24" font-size="7">PAUSE</text><rect x="55" y="26" width="20" height="10" rx="2" fill="none" stroke="#fbbf24" stroke-width="1" stroke-dasharray="2,1"/></svg>`;

const CORRECTIVE_EXERCISES: Record<string, CorrectiveExercise[]> = {
  knee_valgus: [
    { name: 'Banded Squats', description: 'Loop a resistance band above your knees. Squat while actively pushing your knees into the band.', sets: '3x10', videoUrl: 'https://www.youtube.com/watch?v=BKqYPNFHbmA' },
    { name: 'Monster Walks', description: 'With a band above your knees, take wide steps sideways keeping tension on the band. Higher glute medius activation than clamshells (Macadam et al. 2015).', sets: '3x10 each direction', videoUrl: 'https://www.youtube.com/watch?v=jMCRMnmMBHY' },
    { name: 'Clamshells', description: 'Lie on your side with knees bent. Open your top knee like a clamshell while keeping feet together. Good starting point if monster walks are too challenging.', sets: '3x15 each side', svg: SVG_CLAMSHELL, videoUrl: 'https://www.youtube.com/watch?v=cP0bYqzqPCk' },
  ],
  butt_wink: [
    { name: 'Box Squats', description: 'Squat to a box set at the depth where your lower back stays flat. Pause, then stand.', sets: '3x8', svg: SVG_PAUSE_SQUAT, videoUrl: 'https://www.youtube.com/watch?v=rMWYh5SQplM' },
    { name: '90/90 Hip Stretch', description: 'Sit with one leg bent 90 degrees in front and one behind. Lean forward gently to stretch the hip.', sets: '30 sec each side' },
    { name: 'Goblet Squat Holds', description: 'Hold a goblet squat at the bottom position, using the weight to push your knees out and keep your torso upright.', sets: '3x10 sec at bottom', videoUrl: 'https://www.youtube.com/watch?v=MeIiIdhvXT4' },
  ],
  excessive_forward_lean: [
    { name: 'Goblet Squats', description: 'Hold a weight at your chest and squat, focusing on keeping your torso as upright as possible.', sets: '3x10', svg: SVG_GOBLET_SQUAT, videoUrl: 'https://www.youtube.com/watch?v=MeIiIdhvXT4' },
    { name: 'Wall Ankle Stretches', description: 'Face a wall with one foot forward. Drive your knee toward the wall while keeping your heel down.', sets: '3x30 sec each', svg: SVG_WALL_ANKLE, videoUrl: 'https://www.youtube.com/watch?v=IikP_teeLkI' },
    { name: 'Front Foot Elevated Split Squats', description: 'Place your front foot on a small platform. Lower into a split squat, focusing on an upright torso.', sets: '3x8' },
  ],
  good_morning: [
    { name: 'Pause Squats', description: 'Squat down and hold the bottom position for 2 seconds, then drive up leading with your chest.', sets: '3x5, 2 sec pause', videoUrl: 'https://www.youtube.com/watch?v=GERFUqKvpLI' },
    { name: 'Front Squats', description: 'Squat with the bar in front position. This forces an upright torso and builds quad strength.', sets: '3x8', videoUrl: 'https://www.youtube.com/watch?v=m4ytaCJZpl0' },
    { name: 'Leg Press', description: 'Use a leg press machine to build quad strength so your legs can keep up with your back.', sets: '3x10' },
  ],
  heel_rise: [
    { name: 'Wall Ankle Stretches', description: 'Face a wall with one foot forward. Drive your knee toward the wall while keeping your heel down.', sets: '3x30 sec', svg: SVG_WALL_ANKLE, videoUrl: 'https://www.youtube.com/watch?v=IikP_teeLkI' },
    { name: 'Heel-Elevated Squats', description: 'Place small plates or a wedge under your heels and squat. This temporarily bypasses ankle limitations.', sets: '3x10', videoUrl: 'https://www.youtube.com/watch?v=drPbXjGVsWA' },
    { name: 'Calf Foam Rolling', description: 'Roll a foam roller slowly up and down each calf, pausing on tight spots.', sets: '2 min each' },
  ],
  insufficient_depth: [
    { name: 'Goblet Squat to Box', description: 'Hold a weight at your chest and squat down to a box or bench at your target depth.', sets: '3x10', videoUrl: 'https://www.youtube.com/watch?v=MeIiIdhvXT4' },
    { name: 'Deep Squat Hold', description: 'Hold the bottom of a squat while holding a doorframe or pole for support. Focus on opening your hips.', sets: '3x20 sec' },
    { name: 'Hip 90/90 Stretch', description: 'Sit with one leg bent 90 degrees in front and one behind. Lean forward to stretch hip flexors and rotators.', sets: '3x30 sec' },
  ],
  excessive_forward_knee_travel: [
    { name: 'Wall Squats', description: 'Stand facing a wall with toes a few inches away. Squat while keeping your knees from touching the wall, forcing you to sit back.', sets: '3x10' },
    { name: 'Box Squats with Sit-Back Cue', description: 'Squat to a box behind you, emphasizing sitting your hips back first rather than letting your knees drift forward.', sets: '3x8', videoUrl: 'https://www.youtube.com/watch?v=rMWYh5SQplM' },
    { name: 'Ankle Mobility Drills', description: 'Perform banded ankle distractions by wrapping a band low around one ankle and driving your knee forward over your toes to build controlled range.', sets: '3x30 sec each side', videoUrl: 'https://www.youtube.com/watch?v=IikP_teeLkI' },
  ],
  fast_descent: [
    { name: 'Tempo Squats', description: 'Squat with a deliberate 3-second descent. Count "one-thousand-one, two, three" on the way down.', sets: '3x5, 3 sec down', videoUrl: 'https://www.youtube.com/watch?v=kVAP9jO-MFk' },
    { name: 'Pause Squats', description: 'Squat down slowly and hold the bottom for 2 seconds before standing up.', sets: '3x5, 2 sec pause', videoUrl: 'https://www.youtube.com/watch?v=GERFUqKvpLI' },
    { name: 'Eccentric Wall Sits', description: 'Slide slowly down a wall into a seated position over 5 seconds, then hold.', sets: '3x20 sec' },
  ],
  slow_descent: [
    { name: 'Tempo Squats with Prescribed Speed', description: 'Squat with a deliberate 2-second descent — no slower. Use a metronome or counting to maintain a brisk, controlled pace.', sets: '3x8, 2 sec down', videoUrl: 'https://www.youtube.com/watch?v=kVAP9jO-MFk' },
    { name: 'Dynamic Box Squats', description: 'Sit back to a box quickly but under control, then explode up. Trains a faster, more aggressive descent while keeping form.', sets: '3x5', videoUrl: 'https://www.youtube.com/watch?v=rMWYh5SQplM' },
    { name: 'Drop Squats', description: 'From standing, quickly drop into a quarter-squat catching position. Builds comfort with a faster descent under load.', sets: '3x8' },
  ],
  bouncing: [
    { name: 'Pause Squats', description: 'Squat down and hold the bottom for 2 seconds before pushing back up. No bouncing allowed.', sets: '3x5, 2 sec pause', svg: SVG_PAUSE_SQUAT, videoUrl: 'https://www.youtube.com/watch?v=GERFUqKvpLI' },
    { name: 'Dead-Stop Squats', description: 'Squat to a box, sit down completely, pause for a full second, then stand. Removes all momentum.', sets: '3x5' },
    { name: 'Isometric Bottom Hold', description: 'Hold the bottom of a squat without moving. Build strength in the weakest position.', sets: '3x10 sec' },
  ],
  asymmetric_hips: [
    { name: 'Bulgarian Split Squats', description: 'Place one foot on a bench behind you. Squat on the front leg to build single-leg strength.', sets: '3x8 each side', videoUrl: 'https://www.youtube.com/watch?v=2C-uNgKwPLE' },
    { name: 'Single-Leg Leg Press', description: 'Use one leg at a time on the leg press to identify and fix strength imbalances.', sets: '3x10 each side' },
    { name: 'Side-Lying Hip Abduction', description: 'Lie on your side and raise your top leg slowly. Strengthens hip stabilizers.', sets: '3x15 each side' },
  ],
  asymmetric_shift: [
    { name: 'Bulgarian Split Squats', description: 'Place one foot on a bench behind you. Squat on the front leg to build single-leg strength.', sets: '3x8 each side', videoUrl: 'https://www.youtube.com/watch?v=2C-uNgKwPLE' },
    { name: 'Single-Leg Leg Press', description: 'Use one leg at a time on the leg press to identify and fix strength imbalances.', sets: '3x10 each side' },
    { name: 'Side-Lying Hip Abduction', description: 'Lie on your side and raise your top leg slowly. Strengthens hip stabilizers.', sets: '3x15 each side' },
  ],
  bracing_reminder: [
    { name: 'Supine Belly Breathing', description: 'Lie on your back with a hand on your belly. Breathe so your hand rises (belly breath, not chest). Practice filling your trunk with 360 degrees of pressure.', sets: '10 breaths before each session', videoUrl: 'https://www.youtube.com/watch?v=0Ua9bOsZTYg' },
    { name: 'Standing Brace Practice', description: 'Stand and practice bracing without a bar — take a big belly breath, brace your abs as if about to be punched, hold 5 seconds. Release and repeat.', sets: '10 reps before working sets' },
    { name: 'Plank with Breathing', description: 'Hold a plank while practicing bracing breaths. Breathe into your belly without losing core tension. Builds the ability to maintain bracing under load.', sets: '3x20 sec' },
  ],
  lateral_shift: [
    { name: 'Bulgarian Split Squats', description: 'Place one foot on a bench behind you. Squat on the front leg to build single-leg strength. Do the weak side first, then match reps on the strong side.', sets: '3x8 each side', videoUrl: 'https://www.youtube.com/watch?v=2C-uNgKwPLE' },
    { name: 'Single-Leg Leg Press', description: 'Use one leg at a time on the leg press to identify and fix strength imbalances between sides.', sets: '3x10 each side' },
    { name: 'Single-Leg Romanian Deadlift', description: 'Stand on one leg and hinge forward with a dumbbell. Builds unilateral hip and hamstring strength to correct side-to-side imbalances.', sets: '3x8 each side', videoUrl: 'https://www.youtube.com/watch?v=_1els2E0YcY' },
  ],
  cervical_hyperextension: [
    { name: 'Broomstick Posture Check', description: 'Hold a broomstick behind your back touching your head, upper back, and tailbone simultaneously. Practice squatting while maintaining all three contact points. If your head pulls away, you are extending.', sets: '3x5 with empty bar' },
    { name: 'Wall Slides', description: 'Stand with your back against a wall, arms up in a goalpost position. Slide your arms up and down while keeping your head, upper back, and hips touching the wall. Trains neutral head position.', sets: '3x10', videoUrl: 'https://www.youtube.com/watch?v=gL1Nuqb1KeE' },
    { name: 'Chin Tucks', description: 'Stand or sit tall and gently pull your chin straight back (make a double chin). Hold for 5 seconds. Strengthens deep neck flexors that maintain neutral head position under load.', sets: '3x10, 5 sec hold' },
  ],
  incomplete_lockout: [
    { name: 'Glute Bridges', description: 'Lie on your back with knees bent. Drive hips up and squeeze glutes hard at the top.', sets: '3x12', svg: SVG_GLUTE_BRIDGE, videoUrl: 'https://www.youtube.com/watch?v=OUgsJ8-Vi0E' },
    { name: 'Hip Thrusts', description: 'With your upper back on a bench, drive hips up and hold the top position for a second.', sets: '3x10', videoUrl: 'https://www.youtube.com/watch?v=xDmFkJxPzeM' },
    { name: 'Standing Hip Extensions', description: 'Stand on one leg and extend the other leg behind you, squeezing your glute.', sets: '3x12 each side' },
  ],
  trunk_angle_increase_on_ascent: [
    { name: 'Pause Squats', description: 'Pause at the bottom and focus on driving your chest up first as you stand.', sets: '3x5, 2 sec pause', videoUrl: 'https://www.youtube.com/watch?v=GERFUqKvpLI' },
    { name: 'Front Squats', description: 'The front-loaded position forces you to keep your chest up throughout the movement.', sets: '3x8', videoUrl: 'https://www.youtube.com/watch?v=m4ytaCJZpl0' },
    { name: 'Tempo Squats', description: 'Use a slow controlled ascent (3 seconds up) to practice keeping your torso angle constant.', sets: '3x5, 3 sec up', videoUrl: 'https://www.youtube.com/watch?v=kVAP9jO-MFk' },
  ],

  // ─── Deadlift Corrective Exercises ───

  rounded_back: [
    { name: 'Paused Deadlifts', description: 'Pull to knee height and hold for 2 seconds, focusing on keeping your chest up and back flat. Then complete the pull.', sets: '3x3' },
    { name: 'Romanian Deadlifts', description: 'Hinge at the hips with a slight knee bend, lowering the bar along your legs. Focus on maintaining a neutral spine throughout.', sets: '3x8', videoUrl: 'https://www.youtube.com/watch?v=jEy_czb3RKA' },
    { name: 'Band Pull-Aparts', description: 'Hold a band at shoulder width and pull it apart by squeezing your shoulder blades together. Builds upper back strength to resist rounding.', sets: '3x15', videoUrl: 'https://www.youtube.com/watch?v=JObYtU7Y7ag' },
  ],
  hip_shoot: [
    { name: 'Deficit Deadlifts', description: 'Stand on a 1-2 inch platform and deadlift. The extra range of motion forces you to use your legs more off the floor.', sets: '3x5', videoUrl: 'https://www.youtube.com/watch?v=Bvo0882MVKQ' },
    { name: 'Front Squats', description: 'Squat with the bar in front position. Builds the quad strength needed to drive with your legs rather than your back.', sets: '3x8', videoUrl: 'https://www.youtube.com/watch?v=m4ytaCJZpl0' },
    { name: 'Tempo Deadlifts', description: 'Pull with a deliberate 3-second concentric. This forces you to stay patient and keep your hips and shoulders rising together.', sets: '3x3' },
  ],
  hitching: [
    { name: 'Block Pulls', description: 'Deadlift from blocks set just below knee height. Builds strength in the top portion of the pull where hitching occurs.', sets: '3x5', videoUrl: 'https://www.youtube.com/watch?v=uSBrieTJjrA' },
    { name: 'Rack Pulls', description: 'Pull from pins set in a rack at knee height. Overload the lockout portion to build finishing strength.', sets: '3x5', videoUrl: 'https://www.youtube.com/watch?v=uSBrieTJjrA' },
    { name: "Farmer's Walks", description: "Pick up heavy dumbbells or farmer's walk handles and walk for distance. Builds the grip endurance that prevents grip-related hitching.", sets: '3x30 sec', videoUrl: 'https://www.youtube.com/watch?v=Fkzk_RqlYig' },
  ],
  asymmetric_pull: [
    { name: 'Single-Leg Romanian Deadlifts', description: 'Stand on one leg and hinge forward, lowering a dumbbell or kettlebell toward the floor. Builds unilateral hip and hamstring strength to correct side-to-side imbalances.', sets: '3x8 each side', videoUrl: 'https://www.youtube.com/watch?v=_1els2E0YcY' },
    { name: 'Suitcase Deadlifts', description: 'Deadlift a weight held in one hand at your side. Forces your core and hips to resist lateral shifting throughout the pull.', sets: '3x8 each side' },
    { name: 'Single-Arm Dumbbell Rows', description: 'Row a dumbbell with one arm at a time, bracing on a bench. Identifies and corrects back strength imbalances that cause asymmetric pulling.', sets: '3x10 each side' },
  ],
  fast_descent_deadlift: [
    { name: 'Tempo Romanian Deadlifts', description: 'Perform RDLs with a slow 4-second lowering phase. Builds eccentric control through the hip hinge pattern.', sets: '3x6, 4 sec down', videoUrl: 'https://www.youtube.com/watch?v=jEy_czb3RKA' },
    { name: 'Controlled Eccentric Deadlifts', description: 'After locking out a deadlift, lower the bar over 3-4 seconds back to the floor. Focus on maintaining tension and bar path.', sets: '3x5, 3-4 sec down' },
    { name: 'Pause-at-Knee Deadlifts', description: 'Lower the bar from lockout and pause for 2 seconds when it reaches your knees, then continue to the floor. Builds control at the hardest part of the descent.', sets: '3x5, 2 sec pause' },
  ],
  insufficient_rom_deadlift: [
    { name: 'Deficit Deadlifts', description: 'Stand on a 1-2 inch platform and deadlift from the floor. The added range of motion builds strength and mobility in the bottom position.', sets: '3x5', videoUrl: 'https://www.youtube.com/watch?v=Bvo0882MVKQ' },
    { name: 'Hip Hinge Drills', description: 'Stand with your back to a wall and push your hips back until they touch the wall. Step further from the wall each set to increase hinge depth.', sets: '3x10' },
    { name: 'Standing Hamstring Stretches', description: 'Place one foot on a low box and hinge forward with a flat back until you feel a stretch in the back of your thigh. Improves the flexibility needed for a full pull from the floor.', sets: '3x30 sec each side' },
  ],

  // ─── Bench Press Corrective Exercises ───

  no_pause: [
    { name: 'Spoto Press', description: 'Lower the bar to 1 inch above your chest and hold for 1 second before pressing. Builds strength and control at the bottom.', sets: '3x5', videoUrl: 'https://www.youtube.com/watch?v=SNFBlMlIXEY' },
    { name: 'Long Pause Bench', description: 'Lower the bar to your chest and hold for a full 3 seconds before pressing. Eliminates the stretch reflex and builds raw strength.', sets: '3x5' },
    { name: 'Floor Press', description: 'Bench press while lying on the floor. Your elbows touch the ground at the bottom, creating a natural pause point.', sets: '3x8', videoUrl: 'https://www.youtube.com/watch?v=Aoyg4WKyfrI' },
  ],
  uneven_press: [
    { name: 'Dumbbell Bench Press', description: 'Press with dumbbells instead of a barbell. Each arm must work independently, exposing and correcting imbalances.', sets: '3x10', videoUrl: 'https://www.youtube.com/watch?v=VmB1G1K7v94' },
    { name: 'Single-Arm Dumbbell Press', description: 'Press one dumbbell at a time while lying on the bench. Focus on the weaker side first, then match reps with the stronger side.', sets: '3x8 each side' },
    { name: 'Banded Press', description: 'Attach a band to the barbell for accommodating resistance. The band forces even pressing speed as it gets harder at the top.', sets: '3x10' },
  ],
  press_stall: [
    { name: 'Spoto Press', description: 'Pause the bar 1 inch off your chest for 1-2 seconds, then press. Builds strength right at the sticking point.', sets: '3x5', videoUrl: 'https://www.youtube.com/watch?v=SNFBlMlIXEY' },
    { name: 'Pin Press', description: 'Set safety pins at your sticking point height. Start each rep from the pins (dead stop) and press to lockout.', sets: '3x5', videoUrl: 'https://www.youtube.com/watch?v=Wo0oWVNJHXc' },
    { name: 'Close-Grip Bench', description: 'Bench with a narrower grip (hands just inside shoulder width). Builds tricep strength needed to push through the mid-range sticking point.', sets: '3x8', videoUrl: 'https://www.youtube.com/watch?v=nEF0bv2FW94' },
  ],

  // ─── Overhead Press Corrective Exercises ───

  excessive_lean_back: [
    { name: 'Z-Press', description: 'Sit on the floor with legs extended and press overhead. Eliminates all leg drive and forces core bracing — any lean-back becomes immediately obvious.', sets: '3x8' },
    { name: 'Seated Overhead Press', description: 'Press overhead while seated on a bench with back support. Removes the temptation to lean back and isolates the pressing muscles.', sets: '3x8' },
    { name: 'Dead Bugs', description: 'Lie on your back with arms and legs raised. Slowly extend opposite arm and leg while keeping your lower back pressed flat. Builds the core stability needed to resist lean-back.', sets: '3x10 each side' },
  ],
  partial_rom: [
    { name: 'Shoulder Dislocates', description: 'Hold a PVC pipe or band with a wide grip and rotate it slowly from your thighs all the way overhead and behind you. Builds shoulder mobility needed for full ROM pressing. Safe for most people.', sets: '2x10' },
    { name: 'Dumbbell Overhead Press (progressive ROM)', description: 'Press dumbbells overhead, starting with a comfortable range and gradually lowering the start position each week. Dumbbells allow natural shoulder rotation and a safe, individualized range of motion.', sets: '3x10' },
    { name: 'Bradford Press', description: 'Alternate pressing the bar from front to behind your neck without fully locking out. Builds pressing strength through the full ROM around your head. Skip this if you have any shoulder pain or limited shoulder mobility.', sets: '3x8' },
  ],
  forward_press: [
    { name: 'Landmine Press', description: 'Press a barbell anchored at one end in a landmine attachment. The fixed arc teaches a vertical press path and builds unilateral pressing strength.', sets: '3x10 each side' },
    { name: 'Z-Press', description: 'Press overhead while seated on the floor with legs extended. The lack of back support forces you to maintain a vertical bar path or you\'ll fall backward.', sets: '3x8' },
    { name: 'Wall Facing Press', description: 'Stand facing a wall with toes 6 inches away. Press a light weight overhead — the wall prevents forward drift and teaches a straight bar path.', sets: '3x10' },
  ],
  asymmetric_press: [
    { name: 'Single-Arm Dumbbell Press', description: 'Press a dumbbell with one arm at a time while standing. Focus on the weaker side first, then match reps with the stronger side.', sets: '3x8 each side' },
    { name: 'Kettlebell Press', description: 'Press a kettlebell overhead one arm at a time. The offset center of gravity challenges stability and builds balanced pressing strength.', sets: '3x8 each side' },
    { name: 'Arnold Press', description: 'Start with dumbbells at shoulder height with palms facing you. Rotate palms out as you press overhead. Builds balanced shoulder strength through rotation.', sets: '3x10' },
  ],
  incomplete_lockout_ohp: [
    { name: 'Push Press', description: 'Use a slight leg drive to help press the bar overhead, then hold the lockout for 2 seconds. The leg assistance lets you practice with heavier weight at the top.', sets: '3x5, 2 sec hold' },
    { name: 'Overhead Holds', description: 'Press or jerk a weight overhead and simply hold it for time. Builds overhead stability, shoulder endurance, and lockout confidence.', sets: '3x20 sec' },
    { name: 'Snatch-Grip Behind-Neck Press', description: 'Press from behind the neck with a wide (snatch) grip. The wider grip and behind-neck position trains a stronger, more stable lockout position.', sets: '3x8' },
  ],
  fast_descent_ohp: [
    { name: 'Tempo Overhead Press', description: 'Press with a deliberate 3-second lowering phase. Count "one-thousand-one, two, three" on the way down.', sets: '3x5, 3 sec down' },
    { name: 'Pause at Shoulders', description: 'Lower the bar to your shoulders and hold for 2 seconds before pressing again. Builds control and eliminates momentum from the eccentric.', sets: '3x5, 2 sec pause' },
    { name: 'Eccentric-Only Overhead Press', description: 'Push press the bar up, then lower it as slowly as possible (5 seconds) back to your shoulders. Builds eccentric control with heavier weight.', sets: '3x3, 5 sec down' },
  ],

  // ─── Barbell Row Corrective Exercises ───

  torso_rise: [
    { name: 'Seal Row', description: 'Lie face-down on an elevated bench and row the bar up. The bench support eliminates torso rise and isolates the back.', sets: '3x10' },
    { name: 'Chest-Supported Row', description: 'Row with your chest supported on an incline bench. Removes the temptation to use momentum from the torso.', sets: '3x10' },
    { name: 'Strict Pendlay Row', description: 'Row from the floor with a dead stop each rep. Reset your back angle between reps to enforce strict position.', sets: '3x6' },
  ],
  insufficient_rom_row: [
    { name: 'Cable Row (full ROM)', description: 'Use a cable machine to row with a full range of motion, squeezing shoulder blades together at the top.', sets: '3x12' },
    { name: 'Band Pull-Apart', description: 'Hold a band at shoulder width and pull it apart by squeezing your shoulder blades together. Builds the upper back strength for full ROM rows.', sets: '3x15' },
    { name: 'Dumbbell Row', description: 'Row a dumbbell with one arm braced on a bench. The unilateral movement allows a fuller range of motion.', sets: '3x10 each side' },
  ],
  jerky_pull: [
    { name: 'Tempo Row', description: 'Row with a 2-second pull and 2-second lower. Eliminates jerking by forcing constant tension.', sets: '3x8, 2 sec each way' },
    { name: 'Pause Row', description: 'Pull the bar to your chest and hold for 1 second before lowering. Builds control at the top of the movement.', sets: '3x6, 1 sec pause' },
    { name: 'Machine Row', description: 'Use a plate-loaded or cable row machine. The fixed path teaches smooth, controlled pulling.', sets: '3x12' },
  ],
  asymmetric_row: [
    { name: 'Single-Arm Dumbbell Row', description: 'Row a dumbbell with one arm at a time, braced on a bench. Identifies and corrects strength imbalances between sides.', sets: '3x10 each side' },
    { name: 'Cable Row', description: 'Use a single-handle cable attachment and row one arm at a time. The constant tension exposes asymmetries.', sets: '3x10 each side' },
    { name: 'Meadows Row', description: 'Row a landmine barbell with one arm in a staggered stance. The unique angle builds balanced lat and upper back strength.', sets: '3x8 each side' },
  ],
  fast_lowering_row: [
    { name: 'Tempo Eccentric Row', description: 'Row the bar up normally, then lower it over 3-4 seconds. Builds eccentric control and time under tension.', sets: '3x8, 3-4 sec down' },
    { name: 'Chest-Supported Row', description: 'Row with your chest on an incline bench. The support makes it easier to control the lowering phase.', sets: '3x10' },
    { name: 'Cable Row', description: 'The constant cable tension forces you to control the eccentric. Focus on a slow, smooth return.', sets: '3x12' },
  ],
  excessive_hip_extension: [
    { name: 'Seal Row', description: 'Lie face-down on an elevated bench and row. Completely eliminates hip extension from the movement.', sets: '3x10' },
    { name: 'Chest-Supported Row', description: 'Row with your chest on an incline bench. The bench prevents hip extension and momentum.', sets: '3x10' },
    { name: 'Pendlay Row', description: 'Row from the floor with a dead stop each rep. The strict start position discourages hip extension.', sets: '3x6' },
  ],

  // ─── Lunge Corrective Exercises ───

  knee_past_toes_lunge: [
    { name: 'Reverse Lunge', description: 'Step backward into a lunge instead of forward. This naturally limits how far the front knee travels forward.', sets: '3x10 each side' },
    { name: 'Step-Back Lunge', description: 'Focus on stepping far enough back that your front shin stays vertical. Use a mirror or video to check.', sets: '3x8 each side' },
    { name: 'Ankle Mobility Drill', description: 'Perform banded ankle distractions to build controlled range. Better ankle mobility allows proper knee tracking.', sets: '3x30 sec each side' },
  ],
  insufficient_depth_lunge: [
    { name: 'Goblet Reverse Lunge', description: 'Hold a dumbbell at your chest and reverse lunge. The counterbalance helps you achieve greater depth with control.', sets: '3x10 each side' },
    { name: 'TRX Assisted Lunge', description: 'Hold TRX straps for balance and lunge deeply. The assistance lets you train the bottom range safely.', sets: '3x10 each side' },
    { name: 'Hip Flexor Stretch', description: 'Kneel on one knee and push your hips forward. Tight hip flexors limit lunge depth — stretching them unlocks range of motion.', sets: '3x30 sec each side' },
  ],
  forward_lean_lunge: [
    { name: 'Goblet Lunge', description: 'Hold a dumbbell at your chest and lunge. The front-loaded weight naturally cues an upright torso.', sets: '3x10 each side' },
    { name: 'Overhead Lunge', description: 'Lunge with arms extended overhead holding a light plate or PVC. Any forward lean becomes immediately obvious.', sets: '3x8 each side' },
    { name: 'Zercher Lunge', description: 'Hold a barbell in the crook of your elbows and lunge. The front-loaded position forces you to stay upright.', sets: '3x8 each side' },
  ],
  knee_valgus_lunge: [
    { name: 'Banded Lateral Walk', description: 'Place a band above your knees and walk sideways, keeping tension. Strengthens hip abductors to prevent knee cave.', sets: '3x10 each direction' },
    { name: 'Single-Leg Glute Bridge', description: 'Bridge on one leg at a time, squeezing your glute at the top. Builds the single-leg hip stability needed for lunges.', sets: '3x12 each side' },
    { name: 'Monster Walk', description: 'With a band above your knees, take wide diagonal steps forward. Builds hip stability in a movement pattern similar to lunging.', sets: '3x10 each direction' },
  ],
  uneven_stride: [
    { name: 'Walking Lunge with Pause', description: 'Walk forward in a lunge, pausing at the bottom of each rep for 2 seconds. The pause lets you check and correct stride length.', sets: '3x8 each side, 2 sec pause' },
    { name: 'Alternating Reverse Lunge', description: 'Alternate reverse lunges in place, focusing on stepping the same distance back each time. Use floor markers if needed.', sets: '3x10 each side' },
    { name: 'Split Squat Hold', description: 'Hold the bottom of a split squat for time. Builds stability and body awareness in the lunge position.', sets: '3x20 sec each side' },
  ],
  incomplete_lockout_lunge: [
    { name: 'Split Squat', description: 'Perform stationary split squats, focusing on fully standing up and locking your hips at the top of each rep.', sets: '3x10 each side' },
    { name: 'Lunge to Balance', description: 'Lunge forward, then drive up and balance on the front leg with the back knee raised. Forces complete hip extension.', sets: '3x8 each side' },
    { name: 'Step-Up', description: 'Step onto a box or bench, fully extending your hip and knee at the top. Hold the top position for 1 second.', sets: '3x10 each side' },
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
  bracing_reminder: [
    { level: 'Start here', exercise: 'Practice belly breathing — watch YouTube video on bracing', criteria: 'Can perform 10 belly breaths with hand on stomach rising' },
    { level: 'Progress to', exercise: 'Practice bracing with empty bar', criteria: 'Can brace and hold for 5 seconds before each rep' },
    { level: 'Goal', exercise: 'Automatic bracing before every rep', criteria: 'Bracing is habitual — no conscious thought needed' },
  ],
  lateral_shift: [
    { level: 'Start here', exercise: 'Bulgarian Split Squats (3x8 each side)', criteria: 'Can complete all reps with even form on both sides' },
    { level: 'Progress to', exercise: 'Single-Leg Leg Press (3x10 each side)', criteria: 'Equal weight and control on both sides' },
    { level: 'Goal', exercise: 'Centered squat with no lateral shift', criteria: 'Bar stays level and body stays centered throughout every rep' },
  ],
  cervical_hyperextension: [
    { level: 'Start here', exercise: 'Broomstick posture check (3x5)', criteria: 'Can maintain head contact with broomstick during bodyweight squat' },
    { level: 'Progress to', exercise: 'Chin tucks during warm-up sets', criteria: 'Neutral head position with light weight' },
    { level: 'Goal', exercise: 'Automatic neutral head position', criteria: 'Head stays in line with spine at working weight without conscious effort' },
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

  // ─── Overhead Press Progressions ───

  excessive_lean_back: [
    { level: 'Start here', exercise: 'Z-Press (3x8) with light weight', criteria: 'Can press without any lean-back while seated' },
    { level: 'Progress to', exercise: 'Seated OHP (3x8) with back support', criteria: 'Strict vertical press with moderate weight' },
    { level: 'Goal', exercise: 'Standing OHP with no lean-back', criteria: 'Trunk stays within 10 degrees of vertical throughout the press' },
  ],
  partial_rom: [
    { level: 'Start here', exercise: 'Shoulder Dislocates (2x10)', criteria: 'Full ROM without pain or restriction' },
    { level: 'Progress to', exercise: 'Bradford Press (3x8) with light weight', criteria: 'Smooth transition front to back with no discomfort' },
    { level: 'Goal', exercise: 'Full ROM overhead press', criteria: 'Bar touches shoulders at bottom and arms fully lock out at top every rep' },
  ],
  forward_press: [
    { level: 'Start here', exercise: 'Wall Facing Press (3x10) with light weight', criteria: 'Can press without bar touching wall' },
    { level: 'Progress to', exercise: 'Z-Press (3x8)', criteria: 'Vertical bar path with no forward drift' },
    { level: 'Goal', exercise: 'Standing OHP with straight bar path', criteria: 'Bar travels in a vertical line over midfoot consistently' },
  ],
  asymmetric_press: [
    { level: 'Start here', exercise: 'Single-Arm DB Press (3x8 each side)', criteria: 'Equal reps and control on both sides' },
    { level: 'Progress to', exercise: 'Kettlebell Press (3x8 each side)', criteria: 'Stable lockout with equal effort both sides' },
    { level: 'Goal', exercise: 'Even barbell overhead press', criteria: 'Bar stays level throughout every rep' },
  ],
  incomplete_lockout_ohp: [
    { level: 'Start here', exercise: 'Overhead Holds (3x20 sec)', criteria: 'Can hold weight overhead with fully locked elbows' },
    { level: 'Progress to', exercise: 'Push Press (3x5) with 2-sec lockout hold', criteria: 'Full lockout and stable hold at top' },
    { level: 'Goal', exercise: 'Full lockout on every strict press rep', criteria: 'Arms fully extended, head through, bar over midfoot' },
  ],
  fast_descent_ohp: [
    { level: 'Start here', exercise: 'Tempo OHP (3x5) with 3-sec lowering', criteria: 'Can control bar for full 3 seconds on the way down' },
    { level: 'Progress to', exercise: 'Pause at Shoulders (3x5) with 2-sec pause', criteria: 'Smooth controlled lowering with clean pause' },
    { level: 'Goal', exercise: 'Full OHP with controlled descent', criteria: 'Bar lowered under control (1-2 sec) every rep' },
  ],

  // ─── Barbell Row Progressions ───

  torso_rise: [
    { level: 'Start here', exercise: 'Seal Row (3x10)', criteria: 'Can row without any torso rise' },
    { level: 'Progress to', exercise: 'Strict Pendlay Row (3x6)', criteria: 'Torso stays parallel to floor throughout the pull' },
    { level: 'Goal', exercise: 'Bent-over row with stable torso', criteria: 'No torso rise at working weight' },
  ],
  insufficient_rom_row: [
    { level: 'Start here', exercise: 'Cable Row (3x12) with full squeeze', criteria: 'Shoulder blades fully retracted at top' },
    { level: 'Progress to', exercise: 'Dumbbell Row (3x10) with pause at top', criteria: 'Bar or dumbbell touches torso every rep' },
    { level: 'Goal', exercise: 'Full ROM barbell row', criteria: 'Bar contacts lower chest/upper abdomen on every rep' },
  ],
  jerky_pull: [
    { level: 'Start here', exercise: 'Tempo Row (3x8) with 2-sec pull/lower', criteria: 'Smooth controlled movement throughout' },
    { level: 'Progress to', exercise: 'Pause Row (3x6) with 1-sec hold', criteria: 'No jerking or momentum at any point' },
    { level: 'Goal', exercise: 'Smooth barbell row at working weight', criteria: 'Controlled pull and lower on every rep' },
  ],
  asymmetric_row: [
    { level: 'Start here', exercise: 'Single-Arm DB Row (3x10 each side)', criteria: 'Equal reps and control on both sides' },
    { level: 'Progress to', exercise: 'Cable Row (3x10 each side)', criteria: 'Same weight and tempo both sides' },
    { level: 'Goal', exercise: 'Symmetrical barbell row', criteria: 'Bar stays level and rises evenly with no lateral drift' },
  ],
  fast_lowering_row: [
    { level: 'Start here', exercise: 'Tempo Eccentric Row (3x8) with 3-sec lower', criteria: 'Can control the bar for full 3 seconds on the way down' },
    { level: 'Progress to', exercise: 'Chest-Supported Row (3x10)', criteria: 'Smooth controlled lowering with no dropping' },
    { level: 'Goal', exercise: 'Barbell row with controlled eccentric', criteria: 'Bar lowered under control (1-2 sec) every rep' },
  ],
  excessive_hip_extension: [
    { level: 'Start here', exercise: 'Seal Row (3x10)', criteria: 'Can row without any hip movement' },
    { level: 'Progress to', exercise: 'Pendlay Row (3x6) with strict form', criteria: 'Hips stay locked in position throughout' },
    { level: 'Goal', exercise: 'Bent-over row with no hip extension', criteria: 'Hip angle stays constant through the entire set' },
  ],

  // ─── Lunge Progressions ───

  knee_past_toes_lunge: [
    { level: 'Start here', exercise: 'Reverse Lunge (3x10 each side)', criteria: 'Front shin stays near vertical' },
    { level: 'Progress to', exercise: 'Step-Back Lunge (3x8 each side)', criteria: 'Consistent stride length with vertical shin' },
    { level: 'Goal', exercise: 'Forward lunge with controlled knee travel', criteria: 'Knee tracks over toes without excessive forward drift' },
  ],
  insufficient_depth_lunge: [
    { level: 'Start here', exercise: 'TRX Assisted Lunge (3x10 each side)', criteria: 'Can reach full depth with assistance' },
    { level: 'Progress to', exercise: 'Goblet Reverse Lunge (3x10 each side)', criteria: 'Back knee nearly touches floor' },
    { level: 'Goal', exercise: 'Full depth lunge consistently', criteria: 'Back knee reaches 1-2 inches from floor every rep' },
  ],
  forward_lean_lunge: [
    { level: 'Start here', exercise: 'Goblet Lunge (3x10 each side)', criteria: 'Can maintain upright torso with front load' },
    { level: 'Progress to', exercise: 'Overhead Lunge (3x8 each side)', criteria: 'Arms stay overhead with no forward lean' },
    { level: 'Goal', exercise: 'Lunge with proper torso angle', criteria: 'Torso stays within 10 degrees of vertical throughout' },
  ],
  knee_valgus_lunge: [
    { level: 'Start here', exercise: 'Banded Lateral Walk (3x10 each direction)', criteria: 'Can maintain tension without knee cave' },
    { level: 'Progress to', exercise: 'Single-Leg Glute Bridge (3x12 each side)', criteria: 'Full hip extension with stable knee position' },
    { level: 'Goal', exercise: 'Lunge with proper knee tracking', criteria: 'Knee tracks over toes with no inward collapse' },
  ],
  uneven_stride: [
    { level: 'Start here', exercise: 'Split Squat Hold (3x20 sec each side)', criteria: 'Can hold stable position with even stance' },
    { level: 'Progress to', exercise: 'Alternating Reverse Lunge (3x10 each side)', criteria: 'Consistent stride length both sides' },
    { level: 'Goal', exercise: 'Even stride on all lunge variations', criteria: 'Stride length within 10% between left and right sides' },
  ],
  incomplete_lockout_lunge: [
    { level: 'Start here', exercise: 'Split Squat (3x10 each side)', criteria: 'Full hip and knee extension at top' },
    { level: 'Progress to', exercise: 'Lunge to Balance (3x8 each side)', criteria: 'Can balance on front leg with full lockout' },
    { level: 'Goal', exercise: 'Full lockout on every lunge rep', criteria: 'Complete hip and knee extension at top of every rep' },
  ],
};

/** Get exercise progressions for a given issue name. */
export function getExerciseProgressions(issueName: string): ExerciseProgression[] {
  return PROGRESSION_DATABASE[issueName] ?? [];
}
