/**
 * Beginner's Guide: The 80/20 of Starting Strength Training
 *
 * Evidence-based, plain-language guide for people who have never lifted
 * or are in their first year. Focuses on the 20% of knowledge that
 * produces 80% of results (Pareto Principle, per Nuckols & Isuf 2015).
 *
 * This content is displayed in the app as an interactive guide accessible
 * from the Training tab setup wizard.
 */

export interface GuideSection {
  id: string;
  title: string;
  icon: string;
  content: string;
  /** Key takeaway — the ONE thing to remember */
  takeaway: string;
  /** Evidence source */
  source?: string;
}

export const BEGINNER_GUIDE: GuideSection[] = [
  {
    id: 'why',
    title: 'Why Strength Training?',
    icon: '💪',
    content: `
You don't need to want to be a powerlifter to benefit from barbell training. Strength training is the single most effective thing you can do for long-term health, body composition, and quality of life.

<strong>What the research says:</strong>
• Builds muscle and bone density (critical after age 30)
• Reduces injury risk in daily life and sports
• Improves metabolic health, insulin sensitivity, and cardiovascular markers
• Boosts mood, sleep quality, and cognitive function
• The benefits compound over years — starting now pays dividends for decades

<strong>How much time does it take?</strong>
2-3 sessions per week, 45-75 minutes each. That's 2-4 hours per week — less time than most people spend on social media daily. And unlike cardio, the benefits last between sessions.
    `.trim(),
    takeaway: 'Strength training 2-3x/week is the single highest-ROI health investment you can make.',
    source: 'Kraemer & Ratamess (2004); Westcott (2012)',
  },
  {
    id: 'matters',
    title: 'The Only 5 Things That Matter',
    icon: '🎯',
    content: `
Most fitness content is noise. Here are the 5 things that account for roughly 80% of your results. Everything else is a rounding error.

<strong>1. Show Up Consistently</strong>
Train 2-3 times per week, every week. Consistency beats intensity. A mediocre program done consistently will always beat a perfect program done inconsistently.

<strong>2. Progressive Overload</strong>
Add a little weight or a few reps each session. This is THE principle of getting stronger. Your body adapts to the stress you give it — if the stress doesn't increase, neither does your strength.

<strong>3. Do Compound Movements</strong>
Squat, bench press, deadlift, overhead press, and rows. These 5 exercises train every muscle in your body. You could do ONLY these and build an impressive physique.

<strong>4. Eat Enough Protein</strong>
Aim for 0.7-1 gram per pound of bodyweight per day (1.6-2.2 g/kg). Spread it across 3-4 meals. Chicken, fish, eggs, dairy, beans, protein shakes — the source matters less than the total amount.

<strong>5. Sleep 7-9 Hours</strong>
You don't get stronger in the gym — you get stronger while you sleep. Less than 7 hours reduces your strength by 5-10% and increases injury risk by 1.7x. Sleep is your #1 recovery tool. No supplement replaces it.
    `.trim(),
    takeaway: 'Consistency + progressive overload + compound lifts + protein + sleep = 80% of your results.',
    source: 'Nuckols & Isuf, The Art of Lifting (2015); Morton et al. (2018); Milewski et al. (2014)',
  },
  {
    id: 'doesnt-matter',
    title: 'What Doesn\'t Matter (Yet)',
    icon: '🚫',
    content: `
Don't waste mental energy on these until you've been training consistently for 6+ months:

<strong>Supplements</strong> — Creatine monohydrate (5g/day) is the only supplement with strong evidence. Everything else is marketing. Save your money.

<strong>Optimal rep ranges</strong> — Whether you do 5 reps or 8 reps matters far less than doing SOMETHING progressively heavier over time.

<strong>Meal timing</strong> — Eating protein within 2 hours of training is fine. You don't need to chug a shake immediately after your last set.

<strong>The "perfect" program</strong> — Any well-designed beginner program works. Starting Strength, GZCLP, 5/3/1 for Beginners — they all produce similar results. Pick one and stick with it.

<strong>Muscle confusion</strong> — This is not a real thing. Your muscles don't get "confused." They respond to progressive overload. Do the same exercises and get stronger at them.

<strong>Cardio interference</strong> — Light cardio (walking, cycling) does not kill your gains. Stay active on off days.
    `.trim(),
    takeaway: 'Don\'t major in the minors. Pick a program, eat protein, sleep, and add weight to the bar.',
    source: 'Nuckols & Isuf, The Art of Lifting (2015); Schoenfeld et al. (2017)',
  },
  {
    id: 'exercises',
    title: 'The 5 Essential Exercises',
    icon: '🏋️',
    content: `
These 5 compound movements train your entire body. Learn these well and you have a complete training program.

<strong>Squat</strong> — The king of all exercises. Trains quads, glutes, hamstrings, core, and back. If you could only do one exercise for the rest of your life, this would be it.

<strong>Bench Press</strong> — Primary upper body push. Trains chest, shoulders, and triceps. Use a full range of motion (bar to chest) for maximum benefit.

<strong>Deadlift</strong> — Pick the bar up off the floor. Trains your entire posterior chain: hamstrings, glutes, back, grip. The simplest and most effective exercise.

<strong>Overhead Press</strong> — Press a bar from your shoulders to overhead. Trains shoulders, triceps, and core. The hardest to progress but the most functional pressing movement.

<strong>Barbell Row</strong> — Pull a bar to your chest while bent over. Trains your back, biceps, and rear delts. Balances out all the pressing work.

<strong>Start with the empty bar (45 lbs / 20 kg).</strong> Learn the movement patterns with light weight. Add weight gradually as your form improves. The bar is not too light — it's where everyone starts.
    `.trim(),
    takeaway: 'Squat, bench, deadlift, press, row. Learn these 5 and you have everything you need.',
    source: 'Rippetoe, Starting Strength (2011); Ralston et al. (2017)',
  },
  {
    id: 'program',
    title: 'How to Choose Your Program',
    icon: '📋',
    content: `
The app recommends a program based on your experience, schedule, and goals. Here's how to think about it:

<strong>If you've never barbell trained (0-6 months):</strong>
• <strong>Starting Strength</strong> — The classic. 3 days/week, squat every session, add weight every workout. Our version auto-evolves through 5 phases as you progress, so you never outgrow it.
• <strong>GZCLP</strong> — More flexible. Has a built-in system for when you stall (changes rep schemes automatically). Community favorite.
• <strong>5/3/1 for Beginners</strong> — Slower but more sustainable. Uses a Training Max (90% of your true max) so you're never grinding.

<strong>If you've been lifting 1-3 years:</strong>
• <strong>Upper/Lower Split</strong> — 4 days/week with heavy/light rotation. Simple, flexible, sustainable.
• <strong>5/3/1 BBB</strong> — 4 days/week. Heavy top sets + 5x10 for muscle growth.
• <strong>Texas Method</strong> — 3 days/week. Volume Monday, Recovery Wednesday, PR Friday.

<strong>If you can only train 2 days/week:</strong>
Starting Strength works on 2 days. Not ideal, but better than nothing. Do the full workout each session.

<strong>If you only have 45 minutes:</strong>
The Essentials program uses 1-2 hard sets per exercise (instead of 3-4 easy ones) to pack a full workout into 45-50 minutes.

<strong>The best program is the one you'll actually do.</strong> Don't overthink it. Pick the one that fits your schedule, try it for 8-12 weeks, then evaluate.
    `.trim(),
    takeaway: 'Beginner? Start with Starting Strength or GZCLP. The best program is the one you\'ll actually follow.',
    source: 'Rippetoe (2011); Krapf/SSC (2024); Wendler (2017); Nippard (2023)',
  },
  {
    id: 'first-workout',
    title: 'Your First Workout',
    icon: '🚀',
    content: `
Here's exactly what to do on Day 1:

<strong>1. Warm up (5-10 minutes)</strong>
Light cardio to break a sweat: walking, cycling, jumping jacks. Then some leg swings and arm circles.

<strong>2. Squat with the empty bar</strong>
Start with just the bar (45 lbs). Do 2 sets of 5 reps. Focus on sitting between your legs, keeping your chest up, and going below parallel. If the bar feels light, add 10 lbs per side and do your 3 work sets of 5.

<strong>3. Bench press (or overhead press)</strong>
Same approach: start with the empty bar, do 2 warm-up sets, then 3 sets of 5 at a challenging-but-completable weight.

<strong>4. Deadlift</strong>
Start with 95 lbs (a 25 lb plate on each side) or just the bar. Learn the hip hinge. 1 set of 5 reps.

<strong>5. Go home</strong>
That's it. Your first workout should take 30-45 minutes. You should feel like you could have done more. That's intentional — start conservative and add weight next time.

<strong>What to expect:</strong>
• You WILL feel awkward. Every beginner does. This passes within 2-3 weeks.
• You might be sore for 2-3 days after. This is normal (DOMS). It decreases dramatically after the first week.
• You should NOT feel sharp pain in your joints. Muscle soreness = normal. Joint pain = stop and ask for help.
    `.trim(),
    takeaway: 'Day 1: empty bar, 3 exercises, go home. Start lighter than you think. You can always add weight next time.',
    source: 'Rippetoe (2011); Krapf (2024)',
  },
  {
    id: 'progression',
    title: 'How You\'ll Get Stronger',
    icon: '📈',
    content: `
The app handles this automatically, but here's what's happening behind the scenes:

<strong>Session to session (beginner):</strong>
Every workout, the app adds 5-10 lbs to your lifts. This is called Linear Progression (LP). As a beginner, your body adapts fast enough to get stronger EVERY session. This is the fastest you'll ever gain strength — enjoy it.

<strong>When you stall:</strong>
Eventually, you won't be able to complete all your reps at a given weight. This is normal. The app will:
1. Have you repeat the weight next session
2. If you fail again, reduce weight by 10% and rebuild
3. After 2-3 of these cycles, the app evolves your program (adds light days, changes rep schemes)

<strong>When the app says to change programs:</strong>
When your body can no longer recover between individual sessions (typically after 3-9 months), the app will recommend transitioning to an intermediate program that uses weekly periodization instead of session-to-session progression. Trust the timing — don't switch too early.

<strong>Form analysis feedback loop:</strong>
Upload a video of any lift and the app analyzes your technique with computer vision. If your form degrades (e.g., knees caving on squats), the app automatically:
• Reduces your working weight to reinforce good technique
• Suggests corrective exercises (pause squats, banded squats)
• Gives you specific coaching cues

No other app does this. It's like having a coach watching every rep.
    `.trim(),
    takeaway: 'The app adds weight for you, catches your stalls, evolves your program, and even watches your form. Just show up and lift.',
    source: 'Rippetoe (2011); Krapf (2024); Helms et al. (2016)',
  },
  {
    id: 'faq',
    title: 'Common Beginner Questions',
    icon: '❓',
    content: `
<strong>How much weight should I start with?</strong>
The empty bar (45 lbs / 20 kg). If you checked "I've never barbell trained" in setup, the app starts you here automatically. If that's too heavy for overhead press, start with a lighter fixed barbell or dumbbells.

<strong>Will I get bulky?</strong>
No. Building significant muscle mass takes years of dedicated training and eating. You will get leaner, firmer, and stronger long before you get "bulky." And if you do start building more muscle than you want, you can simply adjust your training — it's fully controllable.

<strong>Is it safe?</strong>
Barbell training is one of the safest forms of exercise when done with proper form. The injury rate is lower than running, basketball, or soccer. The app's form analysis helps you maintain safe technique.

<strong>What if I can't do a full squat?</strong>
Mobility takes time. Start with a box squat (sit to a bench) and work on ankle and hip flexibility. The app's mobility assessment identifies your specific limitations and prescribes targeted stretches.

<strong>Do I need a belt?</strong>
Not as a beginner. Learn to brace your core naturally first. A belt can be helpful later when weights get heavy (typically when you're squatting 1.5x+ bodyweight).

<strong>How do I know if my form is right?</strong>
Use the Form Check tab — record a video from the side, upload it, and the app scores your technique across 6 dimensions. Or ask the AI Coach "how to squat?" for step-by-step instructions with coaching cues.

<strong>What does RPE mean?</strong>
Rate of Perceived Exertion — how hard a set felt on a 1-10 scale. RPE 8 means "I could have done 2 more reps." Don't worry about this for your first few weeks — the app hides it until you're ready.
    `.trim(),
    takeaway: 'Start with the empty bar, focus on form, and let the app handle the programming. You\'ve got this.',
    source: 'Various — see TRAINING_METHODOLOGY_REFERENCE.md for full citations',
  },
];

/**
 * Get the complete beginner guide.
 */
export function getBeginnerGuide(): GuideSection[] {
  return BEGINNER_GUIDE;
}

/**
 * Get a specific guide section by ID.
 */
export function getGuideSection(id: string): GuideSection | null {
  return BEGINNER_GUIDE.find(s => s.id === id) ?? null;
}
