/**
 * Standalone Glossary Page for Lift Coach.
 *
 * Provides a browsable, searchable modal with all training terminology
 * consolidated from TERM_GLOSSARY (ui-workout.ts) and termDefinitions
 * (ai-coach.ts), plus additional anatomy, competition, and nutrition terms.
 *
 * Design:
 * - Uses existing CSS design system (onboarding-overlay, card, form-input)
 * - Accessible: ARIA roles, focus trapping, keyboard navigation
 * - Mobile-friendly: full-screen on small viewports
 * - Lightweight: no external dependencies
 */

import { escapeHtml } from './ui-utilities';

// ─── Types ───

export interface GlossaryEntry {
  term: string;
  shortDefinition: string;
  fullExplanation?: string;
  category: 'training' | 'programming' | 'anatomy' | 'competition' | 'nutrition';
  relatedTerms?: string[];
}

// ─── Glossary Data ───

export const GLOSSARY: GlossaryEntry[] = [
  // ── Training ──
  {
    term: 'Set',
    shortDefinition: 'One group of consecutive reps.',
    fullExplanation:
      'A set is one group of consecutive repetitions. When a program says "3 sets of 5 reps" ' +
      '(written as 3x5), you do 5 reps, rest, 5 reps, rest, 5 reps. That\'s 3 sets total.',
    category: 'training',
    relatedTerms: ['Rep', 'Work Set', 'Rest'],
  },
  {
    term: 'Rep',
    shortDefinition: 'One complete movement (e.g., lower the bar and stand back up).',
    fullExplanation:
      'A rep (repetition) is one complete movement. For a squat: lower the bar, stand back up ' +
      '-- that\'s 1 rep. "5 reps" means doing that movement 5 times in a row before resting.',
    category: 'training',
    relatedTerms: ['Set', 'AMRAP'],
  },
  {
    term: '1RM',
    shortDefinition: 'One-Rep Max -- the heaviest weight you can lift for a single rep with good form.',
    fullExplanation:
      '1RM means "One-Rep Max" -- the heaviest weight you can lift for a single repetition with good form. ' +
      'You don\'t need to actually test this. The app estimates it from your working sets using the ' +
      'Epley formula: e1RM = weight x (1 + reps/30).',
    category: 'training',
    relatedTerms: ['Training Max', 'PR', 'RPE'],
  },
  {
    term: 'PR',
    shortDefinition: 'Personal Record -- your best-ever performance on a lift.',
    fullExplanation:
      'PR stands for Personal Record. It can refer to your heaviest single (weight PR), your best ' +
      'estimated 1RM (e1RM PR), your most reps at a given weight (rep PR), or even your best form ' +
      'score. The app tracks all four types automatically.',
    category: 'training',
    relatedTerms: ['1RM', 'AMRAP'],
  },
  {
    term: 'AMRAP',
    shortDefinition: 'As Many Reps As Possible -- do as many good reps as you can.',
    fullExplanation:
      'AMRAP means "As Many Reps As Possible." When you see "5+" or "AMRAP" on a set, do as many ' +
      'good reps as you can -- stop 1-2 reps before form breaks down. Your AMRAP performance helps ' +
      'the app calculate progression. Example: if your program says 3x5+ and you get 5, 5, 8 on the ' +
      'AMRAP set, that tells the app you have room to increase weight.',
    category: 'training',
    relatedTerms: ['Rep', 'RPE', 'Failure'],
  },
  {
    term: 'RPE',
    shortDefinition: 'Rate of Perceived Exertion (1-10 scale). RPE 8 means you could do 2 more reps.',
    fullExplanation:
      'RPE stands for Rate of Perceived Exertion. It\'s a 1-10 scale measuring how hard a set felt.\n\n' +
      'RPE 6: Could do 4+ more reps (warm-up territory)\n' +
      'RPE 7: Could do 3 more reps\n' +
      'RPE 8: Could do 2 more reps (most productive training zone)\n' +
      'RPE 9: Could do 1 more rep\n' +
      'RPE 10: Maximum effort, couldn\'t do another rep\n\n' +
      'Use RPE to gauge intensity without needing exact percentages. Most training should be RPE 7-8.5.',
    category: 'training',
    relatedTerms: ['RIR', 'AMRAP', 'Failure'],
  },
  {
    term: 'RIR',
    shortDefinition: 'Reps In Reserve -- how many reps you could have done but didn\'t.',
    fullExplanation:
      'RIR means "Reps In Reserve" -- how many reps you could have done but didn\'t. RIR 2 = you ' +
      'stopped with 2 reps left in the tank. RIR is the inverse of RPE: RPE 8 = RIR 2, RPE 9 = RIR 1, ' +
      'RPE 10 = RIR 0.',
    category: 'training',
    relatedTerms: ['RPE', 'Failure', 'AMRAP'],
  },
  {
    term: 'Warm-up',
    shortDefinition: 'Lighter sets performed before work sets to prepare your body and groove the movement.',
    fullExplanation:
      'Warm-up sets are lighter sets performed before your main working weight. They increase blood flow, ' +
      'raise muscle temperature, and let you practice the movement pattern before loading heavy. A typical ' +
      'warm-up for a 300 lb squat: bar x 10, 135 x 5, 185 x 3, 225 x 2, 275 x 1.',
    category: 'training',
    relatedTerms: ['Work Set', 'Set'],
  },
  {
    term: 'Work Set',
    shortDefinition: 'Your main heavy sets for the day (not warm-ups).',
    fullExplanation:
      'Work sets are the main heavy sets prescribed by your program. These are the sets that drive ' +
      'adaptation. Everything before them (warm-ups) prepares your body; work sets are where the real ' +
      'training happens.',
    category: 'training',
    relatedTerms: ['Warm-up', 'Set'],
  },
  {
    term: 'Failure',
    shortDefinition: 'When you can\'t complete the target number of reps with good form.',
    fullExplanation:
      'Failure occurs when you can\'t complete another rep with proper form. "Technical failure" means ' +
      'form starts breaking down. "Absolute failure" means you physically cannot move the weight. Most ' +
      'training should stop 1-2 reps short of failure (RPE 8-9). Going to absolute failure frequently ' +
      'increases injury risk and fatigue without proportional strength gains.',
    category: 'training',
    relatedTerms: ['RPE', 'RIR', 'AMRAP'],
  },
  {
    term: 'Deload',
    shortDefinition: 'A planned easy week with lighter weights to let your body recover.',
    fullExplanation:
      'A deload is a planned easy week where you reduce weight and/or volume to let your body recover. ' +
      'Think of it as a recovery period -- you\'re not getting weaker, you\'re letting your muscles, ' +
      'joints, and nervous system catch up. Typically: same exercises, 30-50% less weight, fewer sets. ' +
      'Most programs schedule deloads every 4-6 weeks.',
    category: 'training',
    relatedTerms: ['Volume', 'Intensity', 'Periodization'],
  },
  {
    term: 'Rest',
    shortDefinition: 'Time to recover between sets. Typically 2-5 minutes for strength work.',
    fullExplanation:
      'Rest periods between sets allow your muscles and nervous system to partially recover. For ' +
      'strength training (heavy, low-rep sets), rest 3-5 minutes for full phosphocreatine recovery. ' +
      'For hypertrophy (moderate weight, higher reps), 1.5-3 minutes. Shorter rest periods increase ' +
      'metabolic stress but reduce the weight you can handle.',
    category: 'training',
    relatedTerms: ['Set', 'Work Set'],
  },
  {
    term: 'Progressive Overload',
    shortDefinition: 'Gradually increasing demands on your body over time to force adaptation.',
    fullExplanation:
      'Progressive overload means gradually increasing the demands on your body over time -- adding ' +
      'weight, reps, or sets. It\'s the #1 principle of getting stronger. Without progressive overload, ' +
      'your body has no reason to adapt. Methods include adding weight (most common for beginners), ' +
      'adding reps, adding sets, reducing rest time, or increasing range of motion.',
    category: 'training',
    relatedTerms: ['Linear Progression', 'Periodization'],
  },

  // ── Programming ──
  {
    term: 'Linear Progression',
    shortDefinition: 'Adding weight every session -- the fastest way for beginners to get stronger.',
    fullExplanation:
      'LP means Linear Progression -- adding weight every single session. This works for beginners ' +
      'because your body recovers fast enough to get stronger between workouts. Typical increments: ' +
      '5 lbs for squat/deadlift, 2.5 lbs for bench/press. When LP stops working (you can\'t add ' +
      'weight anymore), it\'s time for intermediate programming.',
    category: 'programming',
    relatedTerms: ['Periodization', 'DUP', 'Progressive Overload'],
  },
  {
    term: 'Periodization',
    shortDefinition: 'Organizing training into planned phases that focus on different goals.',
    fullExplanation:
      'Periodization means organizing your training into planned phases (blocks) that focus on different ' +
      'goals. Example: 4 weeks of high-volume hypertrophy, then 4 weeks of heavy strength, then 2 weeks ' +
      'of peaking. This prevents plateaus and manages fatigue. Common models: linear periodization, ' +
      'undulating (DUP), and block periodization.',
    category: 'programming',
    relatedTerms: ['DUP', 'Block Periodization', 'Hypertrophy', 'Strength Phase', 'Peaking'],
  },
  {
    term: 'DUP',
    shortDefinition: 'Daily Undulating Periodization -- varying rep ranges across training days.',
    fullExplanation:
      'DUP stands for Daily Undulating Periodization. Instead of spending weeks in one rep range, you ' +
      'vary intensity and volume within each week. Example: Monday = heavy 3x3, Wednesday = moderate 4x6, ' +
      'Friday = light 3x10. Research (Rhea et al., 2002) suggests DUP may be superior to linear ' +
      'periodization for strength gains in trained lifters.',
    category: 'programming',
    relatedTerms: ['Periodization', 'Block Periodization', 'Volume', 'Intensity'],
  },
  {
    term: 'Block Periodization',
    shortDefinition: 'Dedicating multi-week blocks to specific training goals (accumulation, transmutation, realization).',
    fullExplanation:
      'Block periodization divides training into concentrated multi-week phases: accumulation (high ' +
      'volume, moderate intensity), transmutation (moderate volume, high intensity), and realization ' +
      '(low volume, peak intensity). Each block emphasizes one primary quality. Popular with advanced ' +
      'lifters and powerlifters peaking for competition.',
    category: 'programming',
    relatedTerms: ['Periodization', 'DUP', 'Peaking'],
  },
  {
    term: 'Training Max',
    shortDefinition: 'A conservative max (usually 90% of true 1RM) used to calculate working weights.',
    fullExplanation:
      'Training Max (TM) is a conservative number used to calculate your working weights -- typically ' +
      '90% of your true 1RM. If your best squat is 300 lbs, your TM would be 270 lbs. All percentages ' +
      'in 5/3/1 programs are based on TM, not your actual max. This builds in a buffer so you\'re never ' +
      'grinding reps in training.',
    category: 'programming',
    relatedTerms: ['1RM', 'TM'],
  },
  {
    term: 'TM',
    shortDefinition: 'Training Max -- 90% of your true 1RM, used to calculate working weights.',
    fullExplanation:
      'TM is shorthand for Training Max. See "Training Max" for full details. All 5/3/1 percentages ' +
      'are based on this conservative number, not your actual 1RM.',
    category: 'programming',
    relatedTerms: ['Training Max', '1RM'],
  },
  {
    term: 'Hypertrophy',
    shortDefinition: 'Muscle growth -- typically trained with moderate weight and higher reps (8-15).',
    fullExplanation:
      'Hypertrophy refers to muscle growth (increased muscle fiber size). It\'s typically trained with ' +
      'moderate loads (60-75% 1RM) and higher rep ranges (8-15 reps). Key drivers: mechanical tension, ' +
      'metabolic stress, and muscle damage. Sufficient volume (sets per muscle per week) and progressive ' +
      'overload are the most important factors for hypertrophy (Schoenfeld, 2010).',
    category: 'programming',
    relatedTerms: ['Volume', 'MEV', 'MAV', 'MRV', 'Strength Phase'],
  },
  {
    term: 'Strength Phase',
    shortDefinition: 'Training phase focused on increasing maximal strength with heavier loads (80-90% 1RM).',
    fullExplanation:
      'A strength phase focuses on increasing your ability to produce maximal force. Typically uses ' +
      'heavier loads (80-90% 1RM), lower rep ranges (3-6 reps), and longer rest periods (3-5 min). ' +
      'Volume is moderate. This phase builds on the muscle mass gained during hypertrophy phases.',
    category: 'programming',
    relatedTerms: ['Hypertrophy', 'Peaking', 'Periodization', 'Intensity'],
  },
  {
    term: 'Peaking',
    shortDefinition: 'Final training phase before competition -- low volume, very heavy weights to express maximum strength.',
    fullExplanation:
      'Peaking is the final phase before a competition or max-out attempt. Volume drops significantly ' +
      '(fewer sets/reps), intensity rises to near-maximal (90-100% 1RM), and fatigue is allowed to ' +
      'dissipate. A typical peak lasts 1-3 weeks. The goal is to express the strength you\'ve built, ' +
      'not to build new strength.',
    category: 'programming',
    relatedTerms: ['Strength Phase', 'Deload', 'Block Periodization'],
  },
  {
    term: 'Volume',
    shortDefinition: 'Total amount of work performed (sets x reps x weight).',
    fullExplanation:
      'Training volume is the total amount of work performed, often calculated as sets x reps x weight. ' +
      'More practically, "number of hard sets per muscle group per week" is the most useful volume metric. ' +
      'Volume is the primary driver of hypertrophy. More volume generally means more growth, up to a ' +
      'point (MRV) where recovery is exceeded.',
    category: 'programming',
    relatedTerms: ['Intensity', 'Frequency', 'MEV', 'MAV', 'MRV'],
  },
  {
    term: 'Intensity',
    shortDefinition: 'How heavy the weight is relative to your max (expressed as % of 1RM or RPE).',
    fullExplanation:
      'In strength training, intensity means how heavy the weight is -- typically expressed as a ' +
      'percentage of your 1RM. 80% intensity on a 300 lb max = 240 lbs. Higher intensity (heavier ' +
      'weight) drives neural adaptations and maximal strength. RPE is another way to measure intensity ' +
      'without knowing your exact 1RM.',
    category: 'programming',
    relatedTerms: ['Volume', '1RM', 'RPE'],
  },
  {
    term: 'Frequency',
    shortDefinition: 'How often you train a muscle group or movement per week.',
    fullExplanation:
      'Training frequency is how many times per week you train a given muscle group or lift. Research ' +
      'suggests training each muscle at least 2x/week is superior to 1x/week for hypertrophy ' +
      '(Schoenfeld et al., 2016). For strength, 2-4x/week per lift is common among competitive ' +
      'powerlifters.',
    category: 'programming',
    relatedTerms: ['Volume', 'Intensity'],
  },
  {
    term: 'MEV',
    shortDefinition: 'Minimum Effective Volume -- fewest sets needed to make progress.',
    fullExplanation:
      'MEV (Minimum Effective Volume) is the least amount of training volume (sets per muscle per week) ' +
      'needed to stimulate growth. Below MEV, you may maintain but won\'t grow. For most muscle groups, ' +
      'MEV is approximately 6-8 sets per week (Israetel et al.).',
    category: 'programming',
    relatedTerms: ['MAV', 'MRV', 'Volume'],
  },
  {
    term: 'MAV',
    shortDefinition: 'Maximum Adaptive Volume -- the volume sweet spot where you make the most progress.',
    fullExplanation:
      'MAV (Maximum Adaptive Volume) is the volume range where you get the best gains relative to ' +
      'recovery cost. Training above MAV still produces gains but with diminishing returns and ' +
      'increasing fatigue. For most muscle groups, MAV is approximately 12-18 sets per week.',
    category: 'programming',
    relatedTerms: ['MEV', 'MRV', 'Volume'],
  },
  {
    term: 'MRV',
    shortDefinition: 'Maximum Recoverable Volume -- the most you can do and still recover from.',
    fullExplanation:
      'MRV (Maximum Recoverable Volume) is the highest volume you can handle while still recovering. ' +
      'Training beyond MRV leads to overreaching, stagnation, and increased injury risk. MRV varies ' +
      'by individual, muscle group, training status, sleep, nutrition, and stress. For most muscle ' +
      'groups, MRV is approximately 20-25 sets per week.',
    category: 'programming',
    relatedTerms: ['MEV', 'MAV', 'Volume', 'Deload'],
  },
  {
    term: 'FSL',
    shortDefinition: 'First Set Last -- a 5/3/1 template where you do additional sets at your first working weight.',
    fullExplanation:
      'FSL means "First Set Last" -- a 5/3/1 template where after your main sets, you do 5x5 at the ' +
      'weight of your first working set. It\'s a moderate-volume option that builds strength without ' +
      'excessive fatigue. Good for most intermediate lifters.',
    category: 'programming',
    relatedTerms: ['TM', 'Training Max'],
  },
  {
    term: 'T1',
    shortDefinition: 'Tier 1: Your heaviest main lift of the day (low reps, high intensity).',
    fullExplanation:
      'In the GZCLP and similar tiered programs, T1 is your primary compound lift for the day, ' +
      'performed at the highest intensity (heaviest weight, lowest reps). Example: Squat 5x3 at 85%.',
    category: 'programming',
    relatedTerms: ['T2', 'T3'],
  },
  {
    term: 'T2',
    shortDefinition: 'Tier 2: A secondary compound lift with moderate weight and reps.',
    fullExplanation:
      'In tiered programs, T2 is a secondary compound movement performed at moderate intensity and ' +
      'volume. It often complements the T1 lift. Example: if T1 is squat, T2 might be Romanian deadlift ' +
      'at 3x10.',
    category: 'programming',
    relatedTerms: ['T1', 'T3'],
  },
  {
    term: 'T3',
    shortDefinition: 'Tier 3: Accessory/isolation work with lighter weight and higher reps.',
    fullExplanation:
      'In tiered programs, T3 exercises are isolation or accessory movements performed at lighter weights ' +
      'and higher reps (12-20). They target weak points, build muscle, and prevent imbalances. ' +
      'Examples: leg curls, face pulls, bicep curls.',
    category: 'programming',
    relatedTerms: ['T1', 'T2'],
  },
  {
    term: 'LP',
    shortDefinition: 'Linear Progression -- adding weight every session (beginner programs).',
    fullExplanation:
      'LP is shorthand for Linear Progression. See "Linear Progression" for full details.',
    category: 'programming',
    relatedTerms: ['Linear Progression'],
  },

  // ── Anatomy ──
  {
    term: 'Posterior Chain',
    shortDefinition: 'Muscles on the back side of your body: glutes, hamstrings, spinal erectors.',
    fullExplanation:
      'The posterior chain includes all the muscles on the back side of your body, primarily the ' +
      'glutes, hamstrings, and spinal erectors (lower back muscles). These muscles are critical for ' +
      'deadlifts, squats, and athletic performance. Weak posterior chain is one of the most common ' +
      'strength imbalances.',
    category: 'anatomy',
    relatedTerms: ['Anterior Chain', 'Glutes', 'Hamstrings', 'Hip Hinge'],
  },
  {
    term: 'Anterior Chain',
    shortDefinition: 'Muscles on the front side of your body: quads, hip flexors, abs.',
    fullExplanation:
      'The anterior chain includes muscles on the front of your body, primarily the quadriceps, hip ' +
      'flexors, and abdominals. Front squats, lunges, and leg presses are anterior-chain dominant exercises.',
    category: 'anatomy',
    relatedTerms: ['Posterior Chain', 'Quads'],
  },
  {
    term: 'Quads',
    shortDefinition: 'Quadriceps -- the four muscles on the front of your thigh that extend the knee.',
    fullExplanation:
      'The quadriceps femoris is a group of four muscles on the front of the thigh (rectus femoris, ' +
      'vastus lateralis, vastus medialis, vastus intermedius). They are the primary knee extensors and ' +
      'are heavily involved in squats, lunges, and the lockout portion of deadlifts.',
    category: 'anatomy',
    relatedTerms: ['Anterior Chain', 'Hamstrings', 'Lockout'],
  },
  {
    term: 'Glutes',
    shortDefinition: 'Gluteal muscles -- the primary hip extensors, critical for squats and deadlifts.',
    fullExplanation:
      'The gluteal muscles (gluteus maximus, medius, and minimus) are the largest and most powerful ' +
      'muscles in the body. The gluteus maximus is the primary hip extensor and is crucial for squats, ' +
      'deadlifts, and hip thrusts. Weak glutes contribute to knee valgus, lower back pain, and ' +
      'poor lockout strength.',
    category: 'anatomy',
    relatedTerms: ['Posterior Chain', 'Hamstrings', 'Hip Hinge'],
  },
  {
    term: 'Hamstrings',
    shortDefinition: 'Muscles on the back of your thigh that flex the knee and extend the hip.',
    fullExplanation:
      'The hamstrings are a group of three muscles on the back of the thigh (biceps femoris, ' +
      'semitendinosus, semimembranosus). They flex the knee and extend the hip. They are heavily ' +
      'involved in deadlifts and contribute to squat depth and stability. Romanian deadlifts and ' +
      'Nordic curls are primary hamstring exercises.',
    category: 'anatomy',
    relatedTerms: ['Posterior Chain', 'Glutes', 'Quads'],
  },
  {
    term: 'Hip Hinge',
    shortDefinition: 'A movement pattern where you bend at the hips while keeping a neutral spine.',
    fullExplanation:
      'The hip hinge is a fundamental movement pattern where you push your hips back while maintaining ' +
      'a neutral spine. It\'s the basis of the deadlift, Romanian deadlift, barbell row, and kettlebell ' +
      'swing. Mastering the hip hinge is critical for safe deadlifting and for protecting your lower back.',
    category: 'anatomy',
    relatedTerms: ['Posterior Chain', 'Glutes', 'Hamstrings'],
  },
  {
    term: 'Valgus',
    shortDefinition: 'Knee caving inward during a squat or lunge -- a common form fault.',
    fullExplanation:
      'Knee valgus (medial knee collapse) occurs when the knees cave inward during squatting or ' +
      'lunging. It\'s usually caused by weak hip abductors (gluteus medius), tight adductors, or poor ' +
      'motor control. Significant valgus increases ACL injury risk. Cues: "push knees out," "screw feet ' +
      'into the floor." Banded squats can help train proper knee tracking.',
    category: 'anatomy',
    relatedTerms: ['Glutes', 'Depth'],
  },
  {
    term: 'Butt Wink',
    shortDefinition: 'Posterior pelvic tilt at the bottom of a squat -- the pelvis tucks under.',
    fullExplanation:
      'Butt wink refers to posterior pelvic tilt at the bottom of a squat, where the pelvis tucks ' +
      'under and the lower back rounds slightly. Some butt wink is normal and not dangerous at lighter ' +
      'loads. Excessive butt wink under heavy load can increase disc injury risk. Causes include limited ' +
      'hip flexion mobility, tight hamstrings, or squatting below your individual anatomical range.',
    category: 'anatomy',
    relatedTerms: ['Depth', 'Posterior Chain'],
  },
  {
    term: 'Lockout',
    shortDefinition: 'The top of a lift where you fully extend your hips and knees.',
    fullExplanation:
      'Lockout is the final position of a lift where the hips and knees are fully extended. In ' +
      'competition powerlifting, incomplete lockout results in a failed lift. Common lockout issues: ' +
      'soft knees (not fully extending), hyperextending the lower back instead of squeezing glutes, ' +
      'or hitching on deadlifts (using thighs to push the bar up).',
    category: 'anatomy',
    relatedTerms: ['Depth', 'Glutes', 'Quads'],
  },
  {
    term: 'Depth',
    shortDefinition: 'How deep you squat -- competition standard requires hip crease below knee.',
    fullExplanation:
      'Squat depth is measured by how far the hip crease descends relative to the top of the knee. ' +
      'In IPF/USAPL competition, the hip crease must clearly pass below the top of the knee for the ' +
      'lift to count ("below parallel"). The app scores depth based on knee angle, with competition ' +
      'mode enforcing strict depth standards and capping high squats at 40/100.',
    category: 'anatomy',
    relatedTerms: ['Butt Wink', 'Valgus', 'Lockout'],
  },

  // ── Competition ──
  {
    term: 'USAPL',
    shortDefinition: 'USA Powerlifting -- the U.S. affiliate of the IPF, the largest drug-tested federation.',
    fullExplanation:
      'USAPL (USA Powerlifting) is the U.S. national affiliate of the International Powerlifting ' +
      'Federation (IPF). It is the largest drug-tested powerlifting federation in the U.S. USAPL ' +
      'follows IPF rules: squat (with commands), bench press (with commands), and deadlift. Competitors ' +
      'must wear approved singlets and follow strict technical standards.',
    category: 'competition',
    relatedTerms: ['IPF', 'Commands', 'Singlet'],
  },
  {
    term: 'IPF',
    shortDefinition: 'International Powerlifting Federation -- the world governing body for powerlifting.',
    fullExplanation:
      'The IPF (International Powerlifting Federation) is the global governing body for drug-tested ' +
      'powerlifting, with affiliates in most countries (USAPL in the U.S.). IPF sets the rules for ' +
      'equipment, commands, depth standards, and weight classes used at World Championships and the ' +
      'World Games.',
    category: 'competition',
    relatedTerms: ['USAPL', 'DOTS', 'Wilks', 'GL Points'],
  },
  {
    term: 'DOTS',
    shortDefinition: 'A bodyweight-relative strength score for comparing lifters across weight classes.',
    fullExplanation:
      'DOTS is a modern formula for comparing powerlifting performance across weight classes. It ' +
      'replaced Wilks as the IPF\'s official relative strength metric. DOTS = total x coefficient ' +
      '(based on bodyweight). A DOTS score of 400+ is elite. It\'s considered more equitable across ' +
      'weight classes than the original Wilks formula.',
    category: 'competition',
    relatedTerms: ['Wilks', 'GL Points', 'IPF'],
  },
  {
    term: 'Wilks',
    shortDefinition: 'An older bodyweight-relative scoring formula, largely replaced by DOTS.',
    fullExplanation:
      'The Wilks coefficient is a formula that adjusts a powerlifting total for bodyweight, allowing ' +
      'comparison across weight classes. Developed by Robert Wilks, it was the IPF standard for decades. ' +
      'It has been largely superseded by DOTS and GL Points, which are considered more equitable at ' +
      'extreme bodyweights.',
    category: 'competition',
    relatedTerms: ['DOTS', 'GL Points', 'IPF'],
  },
  {
    term: 'GL Points',
    shortDefinition: 'Goodlift Points -- the IPF\'s newest relative strength formula, replacing DOTS for some events.',
    fullExplanation:
      'GL Points (Goodlift Points) is the IPF\'s latest formula for comparing lifters across weight ' +
      'classes, introduced to improve on both Wilks and DOTS. It uses updated statistical models and ' +
      'is used for Best Lifter awards at some IPF competitions.',
    category: 'competition',
    relatedTerms: ['DOTS', 'Wilks', 'IPF'],
  },
  {
    term: 'Commands',
    shortDefinition: 'Referee instructions during competition lifts: Squat/Rack, Start/Press/Rack, Down.',
    fullExplanation:
      'In IPF/USAPL competition, lifters must wait for referee commands:\n\n' +
      'Squat: "Squat" (begin descent), "Rack" (return bar)\n' +
      'Bench: "Start" (unrack), "Press" (push the bar), "Rack" (return bar)\n' +
      'Deadlift: "Down" (lower the bar after lockout)\n\n' +
      'Moving before or ignoring a command results in a failed lift. Practice pausing at each command ' +
      'position during training.',
    category: 'competition',
    relatedTerms: ['IPF', 'USAPL', 'Attempt'],
  },
  {
    term: 'Opener',
    shortDefinition: 'Your first attempt at a competition -- should be a weight you can triple easily.',
    fullExplanation:
      'Your opener is your first attempt on each lift at a competition. It should be conservative -- ' +
      'a weight you can do for 3 reps on your worst day (roughly 90-92% of your true 1RM). Going 3/3 ' +
      'on openers builds confidence and ensures you get on the board. Missing an opener is a strategic ' +
      'disaster.',
    category: 'competition',
    relatedTerms: ['Attempt', 'Commands'],
  },
  {
    term: 'Attempt',
    shortDefinition: 'One lift on the competition platform -- you get 3 attempts per lift.',
    fullExplanation:
      'In powerlifting competition, each lifter gets three attempts per lift (squat, bench, deadlift). ' +
      'Attempts must go up in weight (you cannot decrease). Your best successful attempt on each lift ' +
      'counts toward your total. Strategy: opener (conservative), second (moderate PR attempt), third ' +
      '(reach/PR).',
    category: 'competition',
    relatedTerms: ['Opener', 'Flight'],
  },
  {
    term: 'Flight',
    shortDefinition: 'A group of lifters who compete together in a rotation at a meet.',
    fullExplanation:
      'At a powerlifting meet, lifters are divided into flights (groups) of up to 14 lifters. All ' +
      'lifters in a flight complete their first attempt before anyone takes their second. Flight order ' +
      'goes from lightest to heaviest weight. Flights keep the competition organized and allow ' +
      'adequate rest between attempts.',
    category: 'competition',
    relatedTerms: ['Attempt', 'Weigh-in'],
  },
  {
    term: 'Weigh-in',
    shortDefinition: 'Official bodyweight measurement before competition to determine weight class.',
    fullExplanation:
      'Weigh-ins happen 2 hours (USAPL/IPF) or 24 hours (some federations) before lifting. Your ' +
      'bodyweight determines your weight class and is used for relative strength scoring (DOTS/Wilks). ' +
      'Many lifters do a controlled water cut to make a lower weight class, then rehydrate before lifting.',
    category: 'competition',
    relatedTerms: ['Flight', 'DOTS', 'Wilks'],
  },
  {
    term: 'Singlet',
    shortDefinition: 'A one-piece lifting suit required in most powerlifting competitions.',
    fullExplanation:
      'A singlet is a one-piece form-fitting garment required by IPF/USAPL rules for competition. It ' +
      'allows the referees to clearly see your body position (especially hip crease depth on squats). ' +
      'Singlets must meet specific fit and color requirements. You can wear a T-shirt under your ' +
      'singlet for bench press.',
    category: 'competition',
    relatedTerms: ['IPF', 'USAPL'],
  },

  // ── Nutrition ──
  {
    term: 'Protein',
    shortDefinition: 'The macronutrient most important for muscle repair and growth (aim for 1.6-2.2 g/kg/day).',
    fullExplanation:
      'Protein is a macronutrient made of amino acids, essential for muscle repair and growth. For ' +
      'strength athletes, research recommends 1.6-2.2 g per kg bodyweight per day (Morton et al., 2018). ' +
      'Good sources: chicken, beef, fish, eggs, dairy, whey protein, legumes, tofu. Spread intake across ' +
      '3-5 meals with 25-40g per meal for optimal muscle protein synthesis.',
    category: 'nutrition',
    relatedTerms: ['Macros', 'Caloric Surplus'],
  },
  {
    term: 'Caloric Surplus',
    shortDefinition: 'Eating more calories than you burn -- required for optimal muscle gain.',
    fullExplanation:
      'A caloric surplus means consuming more calories than your body expends. A modest surplus of ' +
      '300-500 calories/day above maintenance is optimal for muscle gain ("lean bulk"). Larger surpluses ' +
      'accelerate fat gain without proportionally more muscle growth. Beginners can build muscle in a ' +
      'deficit (body recomposition), but advanced lifters generally need a surplus.',
    category: 'nutrition',
    relatedTerms: ['Caloric Deficit', 'Macros', 'Protein'],
  },
  {
    term: 'Caloric Deficit',
    shortDefinition: 'Eating fewer calories than you burn -- required for fat loss.',
    fullExplanation:
      'A caloric deficit means consuming fewer calories than your body expends. This is the only way ' +
      'to lose body fat. For lifters, a moderate deficit of 300-500 calories/day preserves more muscle ' +
      'than aggressive cuts. Keep protein high (2.0+ g/kg/day) during a cut to minimize muscle loss ' +
      '(Helms et al., 2014).',
    category: 'nutrition',
    relatedTerms: ['Caloric Surplus', 'Macros', 'Protein'],
  },
  {
    term: 'Macros',
    shortDefinition: 'Macronutrients: protein, carbohydrates, and fats -- the three calorie-providing nutrients.',
    fullExplanation:
      'Macronutrients (macros) are the three calorie-providing nutrients: protein (4 cal/g), ' +
      'carbohydrates (4 cal/g), and fat (9 cal/g). For strength athletes, a typical macro split is: ' +
      'protein 1.6-2.2 g/kg, fat 0.7-1.0 g/kg, and carbs filling the remaining calories. Carbs are ' +
      'especially important for fueling high-intensity training.',
    category: 'nutrition',
    relatedTerms: ['Protein', 'Caloric Surplus', 'Caloric Deficit'],
  },
  {
    term: 'Creatine',
    shortDefinition: 'The most researched and effective legal supplement for strength and power (5g/day).',
    fullExplanation:
      'Creatine monohydrate is the most extensively studied sports supplement with consistent evidence ' +
      'for improving strength, power output, and lean mass (Kreider et al., 2017). Standard dose: ' +
      '3-5g daily (loading is unnecessary). It works by increasing phosphocreatine stores, allowing ' +
      'more ATP regeneration during high-intensity efforts. Safe for long-term use. May cause 1-3 lbs ' +
      'of water weight gain.',
    category: 'nutrition',
    relatedTerms: ['Protein'],
  },

  // ── Additional Terms (added for completeness) ──
  {
    term: 'DOTS',
    shortDefinition: 'The IPF\'s official relative strength formula, replacing Wilks for Best Lifter awards.',
    fullExplanation:
      'DOTS (Dictionary of Terms — no, it is just a name) uses a 4th-degree polynomial to normalize ' +
      'powerlifting totals across bodyweights. Adopted by the IPF in 2019, it is more accurate than ' +
      'Wilks at extreme bodyweights. Higher DOTS = relatively stronger. Scores above 400 are advanced, ' +
      'above 500 are elite. Both male and female coefficients exist.',
    category: 'competition',
    relatedTerms: ['Wilks', 'GL Points', '1RM'],
  },
  {
    term: 'Wilks',
    shortDefinition: 'A relative strength formula used by USPA and many local federations.',
    fullExplanation:
      'The Wilks coefficient normalizes a powerlifting total relative to bodyweight using a 5th-degree ' +
      'polynomial formula. The Wilks-2 (2020 revision) updated the original coefficients. While the IPF ' +
      'has moved to DOTS, many federations (USPA, local meets) still use Wilks. Higher = relatively stronger.',
    category: 'competition',
    relatedTerms: ['DOTS', 'GL Points', '1RM'],
  },
  {
    term: 'GL Points',
    shortDefinition: 'IPF Goodlift Points — an alternative relative strength scoring system used by the IPF.',
    fullExplanation:
      'GL (Goodlift) Points use an exponential formula to compare powerlifting totals across bodyweights. ' +
      'Used by the IPF alongside DOTS for different ranking purposes. The formula approaches an asymptote ' +
      'at extreme bodyweights, which avoids the instability issues of polynomial-based systems.',
    category: 'competition',
    relatedTerms: ['DOTS', 'Wilks'],
  },
  {
    term: 'VBT',
    shortDefinition: 'Velocity-Based Training — using bar speed to guide training intensity and fatigue.',
    fullExplanation:
      'VBT uses bar velocity measurements (from devices like RepOne, GymAware, or OpenBarbell) to ' +
      'objectively gauge training intensity. Faster bar speed = lighter relative load. Key zones: ' +
      '0.75-1.0 m/s (strength-speed), 0.5-0.75 m/s (speed-strength), 0.3-0.5 m/s (strength), ' +
      '<0.3 m/s (maximal strength). Velocity loss >20% within a set indicates significant fatigue ' +
      '(Sanchez-Medina & Gonzalez-Badillo, 2011).',
    category: 'training',
    relatedTerms: ['RPE', '1RM', 'Progressive Overload'],
  },
  {
    term: 'Conjugate',
    shortDefinition: 'Westside Barbell\'s system: max effort and dynamic effort days with exercise rotation.',
    fullExplanation:
      'The Conjugate Method (popularized by Louie Simmons at Westside Barbell) rotates max effort (ME) ' +
      'and dynamic effort (DE) exercises weekly. ME days: work up to a 1-3RM on a variation (box squat, ' +
      'floor press, deficit deadlift). DE days: speed work with submaximal loads and accommodating resistance ' +
      '(bands/chains). The theory: rotating exercises prevents accommodation while maintaining specificity.',
    category: 'programming',
    relatedTerms: ['DUP', 'Block Periodization'],
  },
  {
    term: 'Sticking Point',
    shortDefinition: 'The position in a lift where the bar decelerates most — your weakest point in the range of motion.',
    fullExplanation:
      'Every lift has a mechanically disadvantaged position where bar speed slows. In squats: typically ' +
      'the "hole" (out of the bottom) or mid-range. In bench: off the chest or at lockout. In deadlifts: ' +
      'off the floor or at the knees. Identifying your sticking point guides exercise selection — deficit ' +
      'deadlifts for off-the-floor weakness, pin squats for mid-range, board press for bench lockout.',
    category: 'training',
    relatedTerms: ['Lockout', 'RPE'],
  },
];

// Sort alphabetically by term
GLOSSARY.sort((a, b) => a.term.localeCompare(b.term));

// ─── Category Metadata ───

const CATEGORY_LABELS: Record<GlossaryEntry['category'], string> = {
  training: 'Training',
  programming: 'Programming',
  anatomy: 'Anatomy',
  competition: 'Competition',
  nutrition: 'Nutrition',
};

const CATEGORY_ORDER: GlossaryEntry['category'][] = [
  'training',
  'programming',
  'anatomy',
  'competition',
  'nutrition',
];

// ─── Rendering ───

/**
 * Render the HTML for the glossary modal.
 */
export function renderGlossaryModal(): string {
  const categoryTabs = CATEGORY_ORDER.map(
    (cat) =>
      `<button type="button" class="gl-tab" data-category="${cat}" role="tab" aria-selected="false" aria-controls="gl-entries">${CATEGORY_LABELS[cat]}</button>`,
  ).join('');

  const entries = GLOSSARY.map((entry, i) => renderEntry(entry, i)).join('');

  return `
    <div class="gl-overlay" id="gl-overlay" role="dialog" aria-modal="true" aria-label="Glossary">
      <div class="card card--static gl-dialog">
        <div class="gl-header">
          <h2 class="section-heading-sm">Glossary</h2>
          <button type="button" class="gl-close-btn" id="gl-close-btn" aria-label="Close glossary">&times;</button>
        </div>

        <div class="gl-search-wrap">
          <input type="text" class="form-input gl-search" id="gl-search"
            placeholder="Search terms..." aria-label="Search glossary terms"
            autocomplete="off" autocorrect="off" spellcheck="false" />
        </div>

        <div class="gl-tabs" role="tablist" aria-label="Filter by category">
          <button type="button" class="gl-tab gl-tab--active" data-category="all" role="tab" aria-selected="true" aria-controls="gl-entries">All</button>
          ${categoryTabs}
        </div>

        <div class="gl-entries" id="gl-entries" role="tabpanel">
          ${entries}
        </div>

        <div class="gl-empty" id="gl-empty" style="display:none">
          <p>No matching terms found.</p>
        </div>
      </div>
    </div>
  `;
}

function renderEntry(entry: GlossaryEntry, index: number): string {
  const relatedHtml = entry.relatedTerms?.length
    ? `<div class="gl-related">Related: ${entry.relatedTerms
        .map((t) => `<button type="button" class="gl-related-link" data-term="${escapeHtml(t)}">${escapeHtml(t)}</button>`)
        .join(', ')}</div>`
    : '';

  const fullHtml = entry.fullExplanation
    ? `<div class="gl-full" id="gl-full-${index}" style="display:none">${escapeHtml(entry.fullExplanation).replace(/\n/g, '<br>')}</div>
       <button type="button" class="gl-more-btn" data-index="${index}" aria-expanded="false" aria-controls="gl-full-${index}">Learn more</button>`
    : '';

  return `
    <div class="gl-entry" data-category="${entry.category}" data-term-lower="${entry.term.toLowerCase()}" data-def-lower="${entry.shortDefinition.toLowerCase()}">
      <div class="gl-entry-header">
        <span class="gl-term">${escapeHtml(entry.term)}</span>
        <span class="gl-badge gl-badge--${entry.category}">${CATEGORY_LABELS[entry.category]}</span>
      </div>
      <p class="gl-short">${escapeHtml(entry.shortDefinition)}</p>
      ${fullHtml}
      ${relatedHtml}
    </div>
  `;
}

// ─── Initialization ───

let glossaryEl: HTMLElement | null = null;

/**
 * Create the glossary modal and append it to document.body.
 * Wire up search, category tabs, open/close, and keyboard navigation.
 */
export function initGlossary(): void {
  // Prevent duplicate initialization
  if (glossaryEl) return;

  // Inject styles once
  if (!document.getElementById('gl-styles')) {
    const style = document.createElement('style');
    style.id = 'gl-styles';
    style.textContent = getGlossaryStyles();
    document.head.appendChild(style);
  }

  // Create container
  const container = document.createElement('div');
  container.innerHTML = renderGlossaryModal();
  glossaryEl = container.firstElementChild as HTMLElement;
  document.body.appendChild(glossaryEl);

  // Initially hidden
  glossaryEl.style.display = 'none';

  // Wire close button
  const closeBtn = glossaryEl.querySelector('#gl-close-btn') as HTMLElement;
  closeBtn?.addEventListener('click', closeGlossary);

  // Wire overlay click-to-close
  glossaryEl.addEventListener('click', (e) => {
    if ((e.target as HTMLElement) === glossaryEl) {
      closeGlossary();
    }
  });

  // Wire Escape key and focus trap
  glossaryEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeGlossary();
      e.stopPropagation();
      return;
    }

    // Focus trap: cycle Tab/Shift+Tab within the modal
    if (e.key === 'Tab') {
      const dialog = glossaryEl?.querySelector('.gl-dialog') as HTMLElement;
      if (!dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button, input, [tabindex]:not([tabindex="-1"]), a[href]',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  });

  // Wire search
  const searchInput = glossaryEl.querySelector('#gl-search') as HTMLInputElement;
  searchInput?.addEventListener('input', () => {
    filterEntries(searchInput.value);
  });

  // Wire category tabs
  const tabs = glossaryEl.querySelectorAll<HTMLElement>('.gl-tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => {
        t.classList.remove('gl-tab--active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('gl-tab--active');
      tab.setAttribute('aria-selected', 'true');
      const category = tab.dataset.category ?? 'all';
      filterByCategory(category);
      // Re-apply search filter on top of category
      if (searchInput) {
        filterEntries(searchInput.value);
      }
    });
  });

  // Wire "Learn more" buttons
  glossaryEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    // Learn more toggle
    if (target.classList.contains('gl-more-btn')) {
      const idx = target.dataset.index;
      const fullEl = glossaryEl?.querySelector(`#gl-full-${idx}`) as HTMLElement | null;
      if (fullEl) {
        const isExpanded = fullEl.style.display !== 'none';
        fullEl.style.display = isExpanded ? 'none' : 'block';
        target.textContent = isExpanded ? 'Learn more' : 'Show less';
        target.setAttribute('aria-expanded', String(!isExpanded));
      }
    }

    // Related term link
    if (target.classList.contains('gl-related-link')) {
      const termName = target.dataset.term;
      if (termName && searchInput) {
        searchInput.value = termName;
        // Reset to "All" tab
        tabs.forEach((t) => {
          t.classList.toggle('gl-tab--active', t.dataset.category === 'all');
          t.setAttribute('aria-selected', String(t.dataset.category === 'all'));
        });
        filterByCategory('all');
        filterEntries(termName);
        // Scroll to matching entry
        const match = glossaryEl?.querySelector(
          `.gl-entry[data-term-lower="${termName.toLowerCase()}"]`,
        ) as HTMLElement | null;
        match?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  });

  // Listen for custom event to open glossary
  document.addEventListener('open-glossary', ((e: CustomEvent) => {
    openGlossary(e.detail?.term);
  }) as EventListener);
}

function filterByCategory(category: string): void {
  if (!glossaryEl) return;
  const entries = glossaryEl.querySelectorAll<HTMLElement>('.gl-entry');
  entries.forEach((entry) => {
    if (category === 'all' || entry.dataset.category === category) {
      entry.removeAttribute('data-cat-hidden');
    } else {
      entry.setAttribute('data-cat-hidden', 'true');
    }
  });
  updateEmptyState();
}

function filterEntries(query: string): void {
  if (!glossaryEl) return;
  const q = query.toLowerCase().trim();
  const entries = glossaryEl.querySelectorAll<HTMLElement>('.gl-entry');
  entries.forEach((entry) => {
    if (!q) {
      entry.removeAttribute('data-search-hidden');
    } else {
      const termLower = entry.dataset.termLower ?? '';
      const defLower = entry.dataset.defLower ?? '';
      const matches = termLower.includes(q) || defLower.includes(q);
      if (matches) {
        entry.removeAttribute('data-search-hidden');
      } else {
        entry.setAttribute('data-search-hidden', 'true');
      }
    }
  });
  updateEmptyState();
}

function updateEmptyState(): void {
  if (!glossaryEl) return;
  const entries = glossaryEl.querySelectorAll<HTMLElement>('.gl-entry');
  let visibleCount = 0;
  entries.forEach((entry) => {
    const catHidden = entry.hasAttribute('data-cat-hidden');
    const searchHidden = entry.hasAttribute('data-search-hidden');
    const isVisible = !catHidden && !searchHidden;
    entry.style.display = isVisible ? '' : 'none';
    if (isVisible) visibleCount++;
  });
  const emptyEl = glossaryEl.querySelector('#gl-empty') as HTMLElement | null;
  if (emptyEl) {
    emptyEl.style.display = visibleCount === 0 ? 'block' : 'none';
  }
}

// ─── Open / Close ───

/**
 * Open the glossary modal, optionally scrolling to a specific term.
 */
export function openGlossary(searchTerm?: string): void {
  if (!glossaryEl) {
    initGlossary();
  }
  if (!glossaryEl) return;

  glossaryEl.style.display = '';

  const searchInput = glossaryEl.querySelector('#gl-search') as HTMLInputElement;

  if (searchTerm) {
    if (searchInput) {
      searchInput.value = searchTerm;
    }
    // Reset to all tab
    const tabs = glossaryEl.querySelectorAll<HTMLElement>('.gl-tab');
    tabs.forEach((t) => {
      t.classList.toggle('gl-tab--active', t.dataset.category === 'all');
      t.setAttribute('aria-selected', String(t.dataset.category === 'all'));
    });
    filterByCategory('all');
    filterEntries(searchTerm);

    // Scroll to matching entry
    requestAnimationFrame(() => {
      const match = glossaryEl?.querySelector(
        `.gl-entry[data-term-lower="${searchTerm.toLowerCase()}"]`,
      ) as HTMLElement | null;
      match?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  } else {
    if (searchInput) searchInput.value = '';
    filterByCategory('all');
    filterEntries('');
  }

  // Focus the search input for keyboard accessibility
  requestAnimationFrame(() => {
    searchInput?.focus();
  });
}

/**
 * Close the glossary modal.
 */
export function closeGlossary(): void {
  if (glossaryEl) {
    glossaryEl.style.display = 'none';
  }
}

// ─── Styles ───

function getGlossaryStyles(): string {
  return `
    .gl-overlay {
      position: fixed;
      inset: 0;
      z-index: 10000;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-sm, 8px);
    }

    .gl-dialog {
      width: 100%;
      max-width: 640px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: 12px;
      background: var(--bg-card, #1e1e2e);
      color: var(--text-primary, #e0e0e0);
    }

    .gl-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing-md, 16px) var(--spacing-md, 16px) 0;
    }

    .gl-close-btn {
      background: none;
      border: none;
      color: var(--text-secondary, #a0a0a0);
      font-size: 1.5rem;
      cursor: pointer;
      min-width: 44px;
      min-height: 44px;
      padding: 8px;
      border-radius: 4px;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .gl-close-btn:hover {
      color: var(--text-primary, #e0e0e0);
      background: var(--bg-hover, rgba(255,255,255,0.08));
    }

    .gl-search-wrap {
      padding: var(--spacing-sm, 8px) var(--spacing-md, 16px);
    }

    .gl-search {
      width: 100%;
      box-sizing: border-box;
    }

    .gl-tabs {
      display: flex;
      gap: 4px;
      padding: 0 var(--spacing-md, 16px) var(--spacing-sm, 8px);
      overflow-x: auto;
      flex-shrink: 0;
    }

    .gl-tab {
      background: none;
      border: 1px solid var(--border-color, #3a3a4a);
      color: var(--text-secondary, #a0a0a0);
      padding: 4px 12px;
      border-radius: 16px;
      font-size: var(--font-xs, 0.75rem);
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s, color 0.15s;
    }
    .gl-tab:hover {
      background: var(--bg-hover, rgba(255,255,255,0.08));
    }
    .gl-tab--active {
      background: var(--accent-color, #6c63ff);
      color: #fff;
      border-color: var(--accent-color, #6c63ff);
    }

    .gl-entries {
      flex: 1;
      overflow-y: auto;
      padding: 0 var(--spacing-md, 16px) var(--spacing-md, 16px);
    }

    .gl-entry {
      border-bottom: 1px solid var(--border-color, #2a2a3a);
      padding: var(--spacing-sm, 8px) 0;
    }
    .gl-entry:last-child {
      border-bottom: none;
    }

    .gl-entry-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }

    .gl-term {
      font-weight: 600;
      font-size: var(--font-md, 1rem);
      color: var(--text-primary, #e0e0e0);
    }

    .gl-badge {
      font-size: var(--font-xxs, 0.65rem);
      padding: 1px 6px;
      border-radius: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 500;
    }
    .gl-badge--training { background: #2a5298; color: #c5d8f0; }
    .gl-badge--programming { background: #4a2a78; color: #d4c5f0; }
    .gl-badge--anatomy { background: #2a6848; color: #c5f0d8; }
    .gl-badge--competition { background: #8a5a2a; color: #f0e0c5; }
    .gl-badge--nutrition { background: #6a2a4a; color: #f0c5d8; }

    .gl-short {
      margin: 0;
      font-size: var(--font-sm, 0.875rem);
      color: var(--text-secondary, #b0b0b0);
      line-height: 1.4;
    }

    .gl-full {
      margin-top: 8px;
      padding: 8px 12px;
      background: var(--bg-inset, rgba(0,0,0,0.15));
      border-radius: 6px;
      font-size: var(--font-sm, 0.875rem);
      color: var(--text-secondary, #b0b0b0);
      line-height: 1.5;
      white-space: pre-line;
    }

    .gl-more-btn {
      background: none;
      border: none;
      color: var(--accent-color, #6c63ff);
      font-size: var(--font-xs, 0.75rem);
      cursor: pointer;
      padding: 2px 0;
      margin-top: 4px;
    }
    .gl-more-btn:hover {
      text-decoration: underline;
    }

    .gl-related {
      margin-top: 6px;
      font-size: var(--font-xs, 0.75rem);
      color: var(--text-muted, #808080);
    }

    .gl-related-link {
      background: none;
      border: none;
      color: var(--accent-color, #6c63ff);
      cursor: pointer;
      font-size: inherit;
      padding: 0;
      text-decoration: underline;
      text-decoration-style: dotted;
    }
    .gl-related-link:hover {
      text-decoration-style: solid;
    }

    .gl-empty {
      padding: var(--spacing-lg, 24px);
      text-align: center;
      color: var(--text-muted, #808080);
      font-size: var(--font-sm, 0.875rem);
    }

    @media (max-width: 480px) {
      .gl-dialog {
        max-height: 100vh;
        max-width: 100%;
        border-radius: 0;
        height: 100%;
      }
      .gl-overlay {
        padding: 0;
      }
    }
  `;
}
