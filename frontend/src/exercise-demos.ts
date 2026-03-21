/**
 * Exercise demonstration database.
 * Maps exercise slots to:
 * 1. Animated GIF URLs (from ExerciseDB open source database)
 * 2. Curated YouTube tutorial links (from trusted coaches)
 * 3. Step-by-step text instructions
 * 4. Common mistakes and cues
 *
 * GIF source: ExerciseDB (github.com/ExerciseDB/exercisedb-api) — open source
 * YouTube sources: Alan Thrall, Jeff Nippard, Squat University, Starting Strength
 */

export interface ExerciseDemo {
  /** Exercise slot key */
  slot: string;
  /** Display name */
  name: string;
  /** Brief description of the movement */
  description: string;
  /** Step-by-step setup and execution instructions */
  steps: string[];
  /** Common mistakes to avoid */
  commonMistakes: string[];
  /** Coaching cues (short, actionable) */
  cues: string[];
  /** Primary muscles worked */
  muscles: string[];
  /** YouTube tutorial URL (curated, high-quality) */
  youtubeUrl?: string;
  /** YouTube video title for display */
  youtubeTitle?: string;
  /** ExerciseDB GIF URL (animated demonstration) */
  gifUrl?: string;
}

/**
 * Exercise demonstration database.
 * Covers all 20 exercise slots with instructions, cues, and demo links.
 */
export const EXERCISE_DEMOS: Record<string, ExerciseDemo> = {
  squat: {
    slot: 'squat',
    name: 'Barbell Back Squat',
    description: 'The king of all exercises. Bar on upper back, squat down until hip crease is below the knee, stand back up.',
    steps: [
      'Set bar on upper back (high bar: on traps; low bar: on rear delts)',
      'Grip bar just outside shoulders, squeeze shoulder blades together',
      'Unrack bar, take 2-3 steps back, feet shoulder-width apart, toes slightly out',
      'Take a deep breath, brace your core hard (like bracing for a punch)',
      'Push hips back and bend knees simultaneously — sit DOWN, not back',
      'Descend until hip crease passes below the top of the knee (below parallel)',
      'Drive up by pushing your feet through the floor — keep chest up',
      'Exhale at the top, re-brace for the next rep',
    ],
    commonMistakes: [
      'Not hitting depth (hip crease below knee)',
      'Knees caving inward (push knees out over toes)',
      'Leaning too far forward (keep chest up, elbows under bar)',
      'Rising on toes (keep whole foot flat, drive through midfoot)',
      'Rounding lower back at the bottom (butt wink — stop slightly above if this happens)',
      'Looking up at the ceiling (look at a point on the floor 6 feet ahead)',
    ],
    cues: [
      'Spread the floor with your feet',
      'Chest up, elbows under the bar',
      'Big breath, tight brace',
      'Sit between your legs, not behind them',
      'Push the earth away from you',
      'Knees track over toes',
    ],
    muscles: ['Quads', 'Glutes', 'Hamstrings', 'Core', 'Erectors'],
    youtubeUrl: 'https://www.youtube.com/watch?v=vmNPOjaGrVE',
    youtubeTitle: 'How to Squat — Alan Thrall',
  },

  bench: {
    slot: 'bench',
    name: 'Barbell Bench Press',
    description: 'Primary upper body push. Lie on bench, lower bar to chest, press to lockout.',
    steps: [
      'Lie on bench with eyes directly under the bar',
      'Retract and depress shoulder blades (pinch them together and down)',
      'Set a slight arch in your upper back — keep butt on the bench',
      'Plant feet flat on the floor, drive them into the ground',
      'Grip bar slightly wider than shoulder width (pinky on the ring is common)',
      'Unrack bar with arms locked, position bar over chest (not over face)',
      'Lower bar to lower chest / nipple line with elbows at ~45 degrees',
      'Touch chest (slight pause for competition), then press up and slightly back',
      'Lock out arms at the top',
    ],
    commonMistakes: [
      'Losing shoulder blade retraction (keep them squeezed the entire set)',
      'Flaring elbows to 90 degrees (keep at ~45-75 degrees)',
      'Bouncing bar off chest (control the descent, light touch)',
      'Lifting butt off bench (keep it planted)',
      'Bar path going straight up (press up AND slightly toward face)',
      'Wrists bending back (stack bar over wrists, straight wrists)',
    ],
    cues: [
      'Shoulder blades back and down',
      'Break the bar in half (rotate hands outward)',
      'Push yourself into the bench, away from the bar',
      'Row the bar to your chest',
      'Leg drive: feet push into the floor',
      'Touch low, press toward face',
    ],
    muscles: ['Chest', 'Triceps', 'Front Delts', 'Lats (stabilizers)'],
    youtubeUrl: 'https://www.youtube.com/watch?v=BYKScL2sgCs',
    youtubeTitle: 'How to Bench Press — Alan Thrall',
  },

  deadlift: {
    slot: 'deadlift',
    name: 'Barbell Deadlift',
    description: 'Pick the bar up off the floor. The simplest and most effective full-body exercise.',
    steps: [
      'Stand with feet hip-width apart, bar over midfoot (about 1 inch from shins)',
      'Bend over and grip bar just outside your legs (double overhand or mixed grip)',
      'Without moving the bar, bring your shins to the bar (bend knees until shins touch)',
      'Lift your chest — this sets your back. Do NOT round your lower back.',
      'Take a deep breath, brace hard',
      'Push the floor away with your legs — the bar will leave the ground',
      'Keep the bar in contact with your legs the entire way up',
      'Stand up fully: hips locked, knees locked, chest tall. Do not lean back.',
      'Return the bar to the floor by pushing hips back, then bending knees',
    ],
    commonMistakes: [
      'Starting with hips too low (this is not a squat — hips higher than knees)',
      'Starting with bar too far from shins (bar should be over midfoot)',
      'Rounding the lower back (set your back by lifting chest before pulling)',
      'Jerking the bar off the floor (pull the slack out first, then push)',
      'Hitching (using thighs to bump the bar up — keep smooth contact)',
      'Hyperextending at the top (just stand up straight, don\'t lean back)',
    ],
    cues: [
      'Push the floor away',
      'Pull the slack out of the bar before you lift',
      'Chest up, back flat',
      'Drag the bar up your legs',
      'Squeeze your glutes at the top',
      'Protect your back: brace like someone is about to punch your stomach',
    ],
    muscles: ['Hamstrings', 'Glutes', 'Erectors', 'Lats', 'Traps', 'Grip'],
    youtubeUrl: 'https://www.youtube.com/watch?v=wYREQkVtvEc',
    youtubeTitle: '5 Step Deadlift Setup — Alan Thrall',
  },

  ohp: {
    slot: 'ohp',
    name: 'Overhead Press',
    description: 'Press the bar from shoulders to overhead lockout. The hardest of the main lifts to progress.',
    steps: [
      'Set bar in rack at about chin height',
      'Grip bar just outside shoulders, elbows slightly in front of bar',
      'Unrack bar onto front delts (bar rests on shoulders, not hands)',
      'Take a deep breath, brace your core and squeeze your glutes',
      'Press bar straight up — move your head back slightly so bar passes your face',
      'Once bar passes forehead, push your head through (lean torso slightly forward)',
      'Lock out arms overhead with bar directly over midfoot',
      'Lower bar back to shoulders under control',
    ],
    commonMistakes: [
      'Pressing around the face (move head back, then push through)',
      'Excessive lean back (squeeze glutes, keep ribs down)',
      'Not locking out fully (arms straight, biceps by ears)',
      'Grip too wide (just outside shoulders is correct)',
      'Not bracing core (treat it like a standing plank)',
    ],
    cues: [
      'Big chest at the bottom',
      'Head through the window at the top',
      'Squeeze glutes and abs — full body lift',
      'Press straight up, not out',
      'Bar travels in a straight line from side view',
    ],
    muscles: ['Shoulders', 'Triceps', 'Upper Chest', 'Core'],
    youtubeUrl: 'https://www.youtube.com/watch?v=eNFXEEdfQp4',
    youtubeTitle: 'How to Overhead Press — Alan Thrall',
  },

  row: {
    slot: 'row',
    name: 'Barbell Row',
    description: 'Bend over, row the bar to your lower chest/upper belly. Primary back builder.',
    steps: [
      'Stand with feet shoulder-width, bar over midfoot',
      'Hinge at hips until torso is roughly 45-60 degrees (Pendlay: fully horizontal)',
      'Grip bar slightly wider than shoulder width (overhand or underhand)',
      'Set your back flat — do not round',
      'Pull bar to lower chest / upper abdomen',
      'Squeeze shoulder blades together at the top',
      'Lower bar under control (Pendlay: touch floor each rep)',
    ],
    commonMistakes: [
      'Standing too upright (you need to be bent over enough)',
      'Rounding the lower back (brace and keep flat)',
      'Using too much body English (minimize torso movement)',
      'Pulling to the wrong spot (lower chest, not neck)',
      'Not squeezing at the top (pause briefly, feel your back working)',
    ],
    cues: [
      'Pull with your elbows, not your hands',
      'Squeeze shoulder blades like cracking a walnut',
      'Chest to the bar',
      'Hips back, back flat',
      'Control the negative — don\'t just drop it',
    ],
    muscles: ['Lats', 'Rhomboids', 'Traps', 'Rear Delts', 'Biceps'],
    youtubeUrl: 'https://www.youtube.com/watch?v=G8l_8chR5BE',
    youtubeTitle: 'How to Barbell Row — Alan Thrall',
  },

  pullup: {
    slot: 'pullup',
    name: 'Pull-up / Chin-up',
    description: 'Hang from a bar, pull yourself up until chin clears the bar.',
    steps: [
      'Grip bar with hands shoulder-width (pull-ups: overhand; chin-ups: underhand)',
      'Hang with arms fully extended, shoulders engaged (not relaxed/dead hang)',
      'Initiate by depressing shoulder blades (pull shoulders down)',
      'Pull elbows down and back until chin clears the bar',
      'Lower under control to full extension',
    ],
    commonMistakes: [
      'Kipping or swinging (keep body tight, no momentum)',
      'Not going to full extension at the bottom (full ROM)',
      'Chin not clearing the bar (chest to bar is even better)',
      'Flaring elbows out (pull elbows to your sides)',
    ],
    cues: [
      'Pull your elbows to your back pockets',
      'Chest to the bar, not chin over',
      'Dead hang at the bottom, squeeze at the top',
      'Engage shoulders first, then pull',
    ],
    muscles: ['Lats', 'Biceps', 'Rear Delts', 'Core'],
    youtubeUrl: 'https://www.youtube.com/watch?v=eGo4IYlbE5g',
    youtubeTitle: 'Pull-up Progression — Jeff Nippard',
  },

  rdl: {
    slot: 'rdl',
    name: 'Romanian Deadlift',
    description: 'Hip hinge with slight knee bend. Bar goes from hips to mid-shin, focusing on hamstring stretch.',
    steps: [
      'Start standing with bar at hip height (unrack or deadlift to position)',
      'Feet hip-width, slight bend in knees (keep this bend constant)',
      'Push hips BACK (not down) while keeping the bar close to your legs',
      'Lower until you feel a deep hamstring stretch (usually mid-shin to knee level)',
      'Drive hips forward to stand back up, squeezing glutes at the top',
    ],
    commonMistakes: [
      'Bending knees too much (this becomes a deadlift — keep knees fixed)',
      'Rounding the back (keep chest up, back flat)',
      'Bar drifting away from legs (keep it in contact the whole time)',
      'Going too deep (stop when you feel the hamstring stretch, not when the bar touches the floor)',
    ],
    cues: [
      'Push your butt to the wall behind you',
      'Feel the stretch in your hamstrings',
      'Bar paints your legs',
      'Soft knees, stiff back',
    ],
    muscles: ['Hamstrings', 'Glutes', 'Erectors'],
    youtubeUrl: 'https://www.youtube.com/watch?v=JCXUYuzwNrM',
    youtubeTitle: 'Romanian Deadlift — Jeff Nippard',
  },

  hip_thrust: {
    slot: 'hip_thrust',
    name: 'Hip Thrust',
    description: 'Back on bench, bar on hips, drive hips up to full extension. Best glute isolation exercise.',
    steps: [
      'Sit on the floor with upper back against a bench',
      'Roll a barbell over your legs to your hip crease (use a pad)',
      'Plant feet flat, about shoulder width, close to your butt',
      'Drive through your heels, lifting hips until fully extended',
      'Squeeze glutes HARD at the top for 1-2 seconds',
      'Lower hips under control',
    ],
    commonMistakes: [
      'Hyperextending the lower back (squeeze glutes, keep ribs down)',
      'Feet too far out (knees should be ~90 degrees at the top)',
      'Not squeezing at the top (the squeeze IS the exercise)',
    ],
    cues: [
      'Push through your heels',
      'Posterior pelvic tilt at the top (tuck tailbone)',
      'Squeeze like you\'re cracking a walnut between your cheeks',
    ],
    muscles: ['Glutes', 'Hamstrings'],
  },

  close_grip_bench: {
    slot: 'close_grip_bench',
    name: 'Close-Grip Bench Press',
    description: 'Bench press with a narrow grip to emphasize triceps.',
    steps: [
      'Same setup as regular bench (shoulder blades retracted, arch, feet planted)',
      'Grip bar with hands about shoulder width (not too narrow — this strains wrists)',
      'Lower bar to lower chest with elbows tucked close to body',
      'Press up, focusing on tricep engagement',
    ],
    commonMistakes: [
      'Grip too narrow (shoulder width is narrow enough)',
      'Elbows flaring out (keep them tucked, ~30 degrees)',
    ],
    cues: ['Elbows tight to your sides', 'Squeeze triceps at lockout'],
    muscles: ['Triceps', 'Chest', 'Front Delts'],
  },

  face_pull: {
    slot: 'face_pull',
    name: 'Face Pull',
    description: 'Cable pull to face height. Essential for shoulder health and rear delt development.',
    steps: [
      'Set cable at face height with rope attachment',
      'Pull rope toward your face, separating hands as you pull',
      'Externally rotate at the end position (thumbs pointing back)',
      'Squeeze rear delts and upper back for 1 second',
      'Return under control',
    ],
    commonMistakes: [
      'Going too heavy (this is a light, high-rep exercise)',
      'Pulling to chest instead of face',
      'Not externally rotating at the end',
    ],
    cues: ['Pull to your ears', 'Thumbs back at the end', 'Light weight, feel the squeeze'],
    muscles: ['Rear Delts', 'Rhomboids', 'External Rotators'],
  },

  curl: {
    slot: 'curl',
    name: 'Bicep Curl',
    description: 'Flex the elbow against resistance. The classic arm builder.',
    steps: [
      'Stand with dumbbells at sides or barbell at thighs',
      'Keep elbows pinned at your sides throughout the movement',
      'Curl the weight up by flexing at the elbow',
      'Squeeze biceps at the top',
      'Lower under control (2-3 second negative)',
    ],
    commonMistakes: [
      'Swinging the weight (keep body still, only elbows move)',
      'Moving elbows forward (pin them at your sides)',
      'Using momentum (if you need to swing, the weight is too heavy)',
    ],
    cues: ['Elbows glued to your sides', 'Squeeze at the top', 'Slow negatives'],
    muscles: ['Biceps', 'Brachialis', 'Forearms'],
  },

  tricep_extension: {
    slot: 'tricep_extension',
    name: 'Tricep Extension / Pushdown',
    description: 'Extend the elbow against resistance. Cable pushdown or overhead extension.',
    steps: [
      'Set cable at high position with bar or rope attachment',
      'Pin elbows at your sides',
      'Push handle down until arms are fully extended',
      'Squeeze triceps at the bottom',
      'Return under control (don\'t let the weight yank your arms up)',
    ],
    commonMistakes: [
      'Elbows drifting forward (keep them pinned)',
      'Leaning over the handle (stand upright)',
      'Going too heavy (this is an isolation exercise)',
    ],
    cues: ['Only your forearms move', 'Squeeze at full extension', 'Control the weight up'],
    muscles: ['Triceps'],
  },

  ab_work: {
    slot: 'ab_work',
    name: 'Core / Ab Work',
    description: 'Strengthen the core for bracing during compound lifts.',
    steps: [
      'Choose an exercise: hanging leg raise, ab wheel, cable crunch, or plank',
      'Focus on contracting your abs, not just moving through the range of motion',
      'Control the movement — no swinging or momentum',
      'Breathe out during the contraction (crunch) phase',
    ],
    commonMistakes: [
      'Using hip flexors instead of abs (focus on curling your pelvis)',
      'Doing 100 crunches with bad form (fewer reps, better quality)',
      'Neglecting anti-extension work (planks, ab wheel)',
    ],
    cues: ['Think about bringing your ribs to your hips', 'Brace like you\'re about to get punched'],
    muscles: ['Rectus Abdominis', 'Obliques', 'Transverse Abdominis'],
  },

  leg_press: {
    slot: 'leg_press',
    name: 'Leg Press / Lunge',
    description: 'Machine-based quad exercise, or lunges for a barbell/dumbbell alternative.',
    steps: [
      'Sit in leg press with back flat against pad',
      'Place feet shoulder-width on the platform',
      'Release safety catches',
      'Lower the sled under control until knees are at ~90 degrees',
      'Push through your feet to extend legs (don\'t lock out knees fully)',
    ],
    commonMistakes: [
      'Going too deep (lower back lifts off the pad — stop before this happens)',
      'Locking out knees fully (keep a slight bend at the top)',
      'Feet too high or too low (shoulder width, middle of platform)',
    ],
    cues: ['Back stays flat on the pad', 'Don\'t bounce at the bottom', 'Controlled reps'],
    muscles: ['Quads', 'Glutes'],
  },

  good_morning: {
    slot: 'good_morning',
    name: 'Good Morning',
    description: 'Bar on back, hinge at hips. Strengthens the posterior chain.',
    steps: [
      'Bar on upper back (same position as squat)',
      'Feet shoulder-width, slight knee bend',
      'Push hips back, hinging at the hips (back stays flat)',
      'Lower until torso is roughly parallel to the floor',
      'Drive hips forward to stand up',
    ],
    commonMistakes: [
      'Rounding the back (keep it flat — reduce weight if needed)',
      'Going too heavy (this is an accessory, not a main lift)',
      'Bending knees too much (slight bend only)',
    ],
    cues: ['Push hips to the wall behind you', 'Flat back, proud chest', 'Feel hamstrings stretch'],
    muscles: ['Hamstrings', 'Glutes', 'Erectors'],
  },

  pause_squat: {
    slot: 'pause_squat',
    name: 'Pause Squat',
    description: 'Squat with a 2-3 second pause at the bottom. Builds strength out of the hole.',
    steps: [
      'Set up exactly like a normal squat',
      'Descend to full depth (below parallel)',
      'PAUSE for 2-3 seconds at the bottom — stay tight, don\'t relax',
      'Drive up explosively from the paused position',
    ],
    commonMistakes: [
      'Relaxing at the bottom (stay braced during the pause)',
      'Bouncing out of the pause (true dead stop, then drive)',
      'Using the same weight as regular squats (use 70-80% of your squat)',
    ],
    cues: ['Stay tight at the bottom', 'Count to 3, then explode', 'Keep bracing through the pause'],
    muscles: ['Quads', 'Glutes', 'Core'],
  },

  front_squat: {
    slot: 'front_squat',
    name: 'Front Squat',
    description: 'Bar on front of shoulders. Forces upright torso. Excellent for quads and core.',
    steps: [
      'Bar rests on front deltoids (not on your hands — hands just keep it in place)',
      'Use clean grip (fingertips under bar) or cross-arm grip',
      'Keep elbows HIGH throughout the movement (this keeps you upright)',
      'Squat straight down between your legs',
      'Drive up, keeping elbows high',
    ],
    commonMistakes: [
      'Elbows dropping (the bar will roll forward — elbows UP)',
      'Wrist pain (you don\'t need a full grip, just fingertips)',
      'Leaning forward (if you lean, the bar falls — stay upright)',
    ],
    cues: ['Elbows up!', 'Sit straight down', 'Bar rests on your delts, not your hands'],
    muscles: ['Quads', 'Core', 'Upper Back'],
    youtubeUrl: 'https://www.youtube.com/watch?v=m4ytaCJZpl0',
    youtubeTitle: 'How to Front Squat — Alan Thrall',
  },

  deficit_deadlift: {
    slot: 'deficit_deadlift',
    name: 'Deficit Deadlift',
    description: 'Deadlift while standing on a 1-2 inch platform. Builds strength off the floor.',
    steps: [
      'Stand on a 1-2 inch platform (bumper plate or wooden block)',
      'Set up exactly like a normal deadlift',
      'The deficit increases the range of motion at the bottom',
      'Pull with the same cues: flat back, push the floor away',
    ],
    commonMistakes: [
      'Platform too high (1-2 inches is enough — more risks back rounding)',
      'Rounding lower back (if you can\'t maintain position, reduce the deficit)',
    ],
    cues: ['Same as deadlift but from a deeper starting position', 'Extra focus on back position'],
    muscles: ['Hamstrings', 'Glutes', 'Erectors', 'Quads (more than regular DL)'],
  },

  spoto_press: {
    slot: 'spoto_press',
    name: 'Spoto Press / Pause Bench',
    description: 'Bench press pausing 1-2 inches off the chest. Builds strength at the weakest point.',
    steps: [
      'Set up exactly like a normal bench press',
      'Lower bar to 1-2 inches above your chest (don\'t touch)',
      'PAUSE for 2-3 seconds — maintain tension',
      'Press up explosively',
    ],
    commonMistakes: [
      'Touching the chest (the point is to stop ABOVE the chest)',
      'Relaxing during the pause (stay tight — lats, legs, everything)',
    ],
    cues: ['Hover 1 inch above chest', 'Stay tight during the pause', 'Explode from the pause'],
    muscles: ['Chest', 'Triceps', 'Front Delts'],
  },

  box_squat: {
    slot: 'box_squat',
    name: 'Box Squat',
    description: 'Squat to a box/bench. Sit on the box, pause, then stand up. Teaches proper depth and builds strength from a dead stop.',
    steps: [
      'Set a box or bench behind you at just below parallel height',
      'Set up like a normal squat (bar on back, feet wider than normal)',
      'Sit BACK onto the box — don\'t just touch and go',
      'Sit fully on the box, pause 1-2 seconds (keep core tight)',
      'Rock forward slightly and drive up explosively',
    ],
    commonMistakes: [
      'Plopping onto the box (sit down under control)',
      'Relaxing on the box (stay braced)',
      'Box too high (below parallel for strength, above for rehab/learning)',
    ],
    cues: ['Sit back to the box', 'Stay tight on the box', 'Explode off the box'],
    muscles: ['Quads', 'Glutes', 'Hamstrings'],
  },
};

/**
 * Get demo information for an exercise slot.
 */
export function getExerciseDemo(slot: string): ExerciseDemo | null {
  return EXERCISE_DEMOS[slot] ?? null;
}

/**
 * Get all available exercise demos.
 */
export function getAllDemos(): ExerciseDemo[] {
  return Object.values(EXERCISE_DEMOS);
}

/**
 * Search demos by name or muscle group.
 */
export function searchDemos(query: string): ExerciseDemo[] {
  const q = query.toLowerCase();
  return Object.values(EXERCISE_DEMOS).filter(d =>
    d.name.toLowerCase().includes(q) ||
    d.description.toLowerCase().includes(q) ||
    d.muscles.some(m => m.toLowerCase().includes(q))
  );
}
