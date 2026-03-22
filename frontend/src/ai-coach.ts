/**
 * AI Coaching Engine for Lift Coach.
 *
 * Provides personalized coaching by combining:
 * 1. User's CV form analysis scores (unique -- no competitor has this data)
 * 2. Training history (workout logs, PRs, e1RM trends)
 * 3. Program state (current program, phase, week, stalls)
 * 4. Readiness and adaptation data
 * 5. Body tracking (weight trends, measurements)
 * 6. Exercise knowledge base (demos, cues, common mistakes)
 *
 * Two modes:
 * - Online: Uses Claude API for natural language coaching (user provides API key)
 * - Offline: Uses rule-based smart responses from the user's data
 *
 * This is the #1 competitive differentiator -- no other app has an AI coach
 * with access to computer vision form data.
 */

import { loadProgramState, loadWorkoutLogs } from './workout-storage';
import type { ProgramState, WorkoutLog } from './workout-storage';
import { PROGRAMS } from './workout-programs';
import { getBestE1RMs } from './pr-tracker';
import { getRecentFormScores, getRecentWeakDimensions } from './form-bridge';
import { getProgressSummary } from './body-tracker';
import type { ProgressSummary } from './body-tracker';
import { getExerciseDemo } from './exercise-demos';
import { calculateWeeklyVolume, getUndertrainedMuscles } from './volume-tracker';

// --- Types ---

export interface CoachMessage {
  role: 'user' | 'coach';
  content: string;
  timestamp: string;
  /** Data sources referenced in this response */
  dataSources?: string[];
}

export interface CoachContext {
  programState: ProgramState | null;
  currentProgram: string;
  currentPhase: string;
  currentWeek: number;
  workoutsCompleted: number;
  recentLogs: WorkoutLog[];
  formScores: Record<string, number>;
  weakDimensions: Record<string, number>;
  e1rms: Record<string, number>;
  bodyProgress: ProgressSummary;
  undertrainedMuscles: string[];
  recentDifficulty: string[];
  recentRPE: number[];
}

// --- Persistent Coaching Memory ---

export interface CoachMemory {
  /** Key facts the coach has learned about the user */
  facts: Array<{
    fact: string;
    source: string; // 'user_told', 'observed', 'inferred'
    date: string;
    category: 'goal' | 'preference' | 'limitation' | 'achievement' | 'concern';
  }>;
  /** Number of total conversations */
  conversationCount: number;
  /** First conversation date */
  firstConversation: string;
  /** Last conversation date */
  lastConversation: string;
}

const COACH_MEMORY_KEY = 'squat_form_coach_memory';

export function loadCoachMemory(): CoachMemory {
  try {
    return JSON.parse(localStorage.getItem(COACH_MEMORY_KEY) ?? 'null') ?? {
      facts: [],
      conversationCount: 0,
      firstConversation: new Date().toISOString(),
      lastConversation: new Date().toISOString(),
    };
  } catch {
    return { facts: [], conversationCount: 0, firstConversation: new Date().toISOString(), lastConversation: new Date().toISOString() };
  }
}

export function saveCoachMemory(memory: CoachMemory): void {
  try {
    // Cap facts at 50
    if (memory.facts.length > 50) memory.facts = memory.facts.slice(-50);
    localStorage.setItem(COACH_MEMORY_KEY, JSON.stringify(memory));
  } catch { /* storage full */ }
}

/**
 * Extract memorable facts from a conversation.
 * Called after each user message to build persistent memory.
 */
export function extractMemoryFromMessage(userMessage: string, context: CoachContext): void {
  const memory = loadCoachMemory();
  const q = userMessage.toLowerCase();
  const today = new Date().toISOString().slice(0, 10);

  // Update conversation tracking
  memory.conversationCount++;
  memory.lastConversation = new Date().toISOString();

  // Extract facts from common patterns
  const extractions: Array<{ pattern: RegExp; category: CoachMemory['facts'][0]['category']; extract: (match: RegExpMatchArray) => string }> = [
    // Goals
    { pattern: /(?:i want to|my goal is|i'm trying to|i need to)\s+(.+?)(?:\.|$)/i, category: 'goal', extract: (m) => `User's goal: ${m[1].trim()}` },
    { pattern: /(?:training for|preparing for|competing in)\s+(.+?)(?:\.|$)/i, category: 'goal', extract: (m) => `Training for: ${m[1].trim()}` },
    // Limitations
    { pattern: /(?:i can't|i have trouble with|my .+ hurts|i injured my)\s+(.+?)(?:\.|$)/i, category: 'limitation', extract: (m) => `Limitation: ${m[1].trim()}` },
    { pattern: /(?:only have|can only train|limited to)\s+(.+?)(?:\.|$)/i, category: 'limitation', extract: (m) => `Constraint: ${m[1].trim()}` },
    // Preferences
    { pattern: /(?:i prefer|i like|i enjoy)\s+(.+?)(?:\.|$)/i, category: 'preference', extract: (m) => `Prefers: ${m[1].trim()}` },
    { pattern: /(?:i don't like|i hate|i avoid)\s+(.+?)(?:\.|$)/i, category: 'preference', extract: (m) => `Dislikes: ${m[1].trim()}` },
  ];

  for (const { pattern, category, extract } of extractions) {
    const match = q.match(pattern);
    if (match) {
      const fact = extract(match);
      // Don't add duplicate facts
      if (!memory.facts.some(f => f.fact === fact)) {
        memory.facts.push({ fact, source: 'user_told', date: today, category });
      }
    }
  }

  // Auto-observe achievements from context
  if (context.workoutsCompleted > 0 && context.workoutsCompleted % 25 === 0) {
    const milestone = `Completed ${context.workoutsCompleted} workouts`;
    if (!memory.facts.some(f => f.fact === milestone)) {
      memory.facts.push({ fact: milestone, source: 'observed', date: today, category: 'achievement' });
    }
  }

  // Track PR achievements
  for (const [lift, e1rm] of Object.entries(context.e1rms)) {
    const prFact = `Best ${lift} e1RM: ${e1rm} lbs`;
    const existingPR = memory.facts.find(f => f.fact.startsWith(`Best ${lift} e1RM:`));
    if (existingPR) {
      existingPR.fact = prFact;
      existingPR.date = today;
    } else {
      memory.facts.push({ fact: prFact, source: 'observed', date: today, category: 'achievement' });
    }
  }

  saveCoachMemory(memory);
}

// --- Context Builder ---

/**
 * Gather all available user data into a coaching context.
 * This is what makes our AI coach unique -- it has access to CV form data,
 * training history, and body metrics that no competitor can provide.
 */
export function buildCoachContext(): CoachContext {
  const state = loadProgramState();
  const logs = loadWorkoutLogs();
  const recentLogs = logs.slice(0, 10);
  const program = state ? PROGRAMS[state.programId] : null;

  // Form analysis data (from CV -- our unique moat)
  const formScores = getRecentFormScores();
  const weakDimensions = getRecentWeakDimensions('squat');

  // Strength data
  const e1rms = getBestE1RMs();

  // Body data
  const bodyProgress = getProgressSummary();

  // Volume data
  const volumeData = calculateWeeklyVolume(
    recentLogs.map(l => ({
      date: l.date,
      sets: l.sets.map(s => ({ exerciseSlot: s.exerciseSlot, completed: s.completed })),
    })),
    1,
  );
  const undertrained = getUndertrainedMuscles(volumeData).map(v => v.label);

  // Recent feedback
  const recentDifficulty = recentLogs
    .filter(l => l.sessionDifficulty)
    .map(l => l.sessionDifficulty!)
    .slice(0, 5);

  const recentRPE = recentLogs
    .flatMap(l => l.sets.filter(s => s.rpe).map(s => s.rpe!))
    .slice(0, 20);

  return {
    programState: state,
    currentProgram: program?.shortName ?? 'No program selected',
    currentPhase: state?.lpPhase ? `Phase ${state.lpPhase}` : `Week ${state?.currentWeek ?? 0}`,
    currentWeek: state?.currentWeek ?? 0,
    workoutsCompleted: state?.workoutsCompleted ?? 0,
    recentLogs,
    formScores,
    weakDimensions,
    e1rms,
    bodyProgress,
    undertrainedMuscles: undertrained,
    recentDifficulty,
    recentRPE,
  };
}

/**
 * Build a system prompt for the AI coach that includes all user context.
 */
export function buildSystemPrompt(context: CoachContext): string {
  const lines: string[] = [
    'You are an expert AI powerlifting coach built into the Lift Coach app.',
    'You have access to the user\'s actual training data, including computer vision form analysis scores -- something no other coaching app can provide.',
    'Be concise, actionable, and evidence-based. Cite sources when making claims.',
    'Speak like a knowledgeable training partner, not a textbook.',
    '',
    '=== USER\'S CURRENT DATA ===',
    '',
    `Program: ${context.currentProgram}`,
    `Phase/Week: ${context.currentPhase}, Week ${context.currentWeek}`,
    `Workouts completed: ${context.workoutsCompleted}`,
    '',
  ];

  // Form scores (CV data -- our unique value)
  if (Object.keys(context.formScores).length > 0) {
    lines.push('Form Analysis Scores (from computer vision):');
    for (const [lift, score] of Object.entries(context.formScores)) {
      lines.push(`  ${lift}: ${score}/100`);
    }
    lines.push('');
  }

  // Weak dimensions
  if (Object.keys(context.weakDimensions).length > 0) {
    lines.push('Weak Form Dimensions (from CV analysis):');
    for (const [dim, score] of Object.entries(context.weakDimensions)) {
      if (score < 75) lines.push(`  ${dim}: ${score}/100 (needs work)`);
    }
    lines.push('');
  }

  // Estimated 1RMs
  if (Object.keys(context.e1rms).length > 0) {
    lines.push('Estimated 1RMs:');
    for (const [lift, e1rm] of Object.entries(context.e1rms)) {
      lines.push(`  ${lift}: ${e1rm} lbs`);
    }
    lines.push('');
  }

  // Body progress
  if (context.bodyProgress.bodyweight.current) {
    lines.push(`Bodyweight: ${context.bodyProgress.bodyweight.current} ${context.bodyProgress.bodyweight.unit}`);
    if (context.bodyProgress.bodyweight.change30d) {
      lines.push(`  30-day change: ${context.bodyProgress.bodyweight.change30d > 0 ? '+' : ''}${context.bodyProgress.bodyweight.change30d} ${context.bodyProgress.bodyweight.unit}`);
    }
    lines.push('');
  }

  // LP progress per lift
  if (context.programState?.liftProgress) {
    lines.push('Current Working Weights:');
    for (const [lift, progress] of Object.entries(context.programState.liftProgress)) {
      lines.push(`  ${lift}: ${progress.currentWeight} ${progress.unit} (${progress.deloadCycles} deloads, ${progress.lpExhausted ? 'LP exhausted' : 'progressing'})`);
    }
    lines.push('');
  }

  // Undertrained muscles
  if (context.undertrainedMuscles.length > 0) {
    lines.push(`Undertrained muscle groups (below MEV): ${context.undertrainedMuscles.join(', ')}`);
    lines.push('');
  }

  // Recent session difficulty
  if (context.recentDifficulty.length > 0) {
    lines.push(`Recent session difficulty: ${context.recentDifficulty.join(', ')}`);
  }

  // Average RPE
  if (context.recentRPE.length > 0) {
    const avgRPE = context.recentRPE.reduce((a, b) => a + b, 0) / context.recentRPE.length;
    lines.push(`Average recent RPE: ${avgRPE.toFixed(1)}`);
  }

  // Persistent coaching memory
  const memory = loadCoachMemory();
  if (memory.facts.length > 0) {
    lines.push('');
    lines.push('=== COACHING MEMORY (persistent across sessions) ===');
    lines.push(`Sessions: ${memory.conversationCount} conversations since ${memory.firstConversation.slice(0, 10)}`);
    lines.push('');
    for (const fact of memory.facts) {
      lines.push(`- [${fact.category}] ${fact.fact} (${fact.source}, ${fact.date})`);
    }
    lines.push('');
    lines.push('Use this memory to personalize responses. Reference past conversations and achievements when relevant.');
  }

  lines.push('');
  lines.push('=== COACHING GUIDELINES ===');
  lines.push('- Reference the user\'s actual form scores when discussing technique');
  lines.push('- If form scores are below 70, recommend weight reduction and technique drills');
  lines.push('- Cite specific exercises from the exercise demo database when suggesting correctives');
  lines.push('- For programming questions, explain the "why" behind the current program\'s design');
  lines.push('- For injury concerns, always recommend seeing a healthcare professional for persistent pain');
  lines.push('- Keep responses under 200 words unless the user asks for detail');

  return lines.join('\n');
}

// --- Offline Smart Responses ---

/**
 * Route categories for the offline coaching response system.
 * Each category has keywords that are matched against the user's question.
 * The category with the highest score (most keyword matches) wins.
 * Priority ordering breaks ties (lower index = higher priority).
 */
interface RouteCategory {
  id: string;
  /** Keywords to match against the lowercased question (checked with word-boundary-aware matching) */
  keywords: string[];
  /** Keywords matched with simple includes() -- for multi-word phrases */
  phrases: string[];
}

const ROUTE_CATEGORIES: RouteCategory[] = [
  // Order matters for tie-breaking: earlier categories win ties
  { id: 'memory', keywords: ['history', 'journey', 'remember'], phrases: ['how long'] },
  { id: 'injury', keywords: ['hurt', 'pain', 'injury', 'injured', 'sore'], phrases: [] },
  { id: 'deload', keywords: ['deload', 'tired', 'fatigue', 'fatigued', 'recovery', 'rest'], phrases: [] },
  { id: 'form', keywords: ['form', 'technique', 'score'], phrases: [] },
  { id: 'nutrition', keywords: ['eat', 'nutrition', 'protein', 'diet', 'calorie', 'calories', 'food'], phrases: [] },
  { id: 'plateau', keywords: ['stuck', 'stall', 'stalled', 'plateau', 'weak'], phrases: ['sticking point', 'weak point', 'not progressing', "can't lift", "can't get"] },
  { id: 'programming', keywords: ['program', 'routine', 'plan', 'split', 'transition'], phrases: ['change program', 'should i change', 'what should i do', 'switch program', 'new program'] },
  { id: 'progress', keywords: ['progress', 'progressing', 'stronger', '1rm', 'gains', 'improving'], phrases: ['how am i doing', 'hit a pr', 'new pr', 'personal record'] },
  { id: 'technique', keywords: ['cue', 'cues', 'tip', 'tips'], phrases: ['how to', 'how do i'] },
  { id: 'terminology', keywords: ['explain', 'define', 'meaning'], phrases: ['what is', 'what does', "what's"] },
  { id: 'default', keywords: [], phrases: [] },
];

/**
 * Check if a keyword appears in the query using substring matching.
 * The keywords themselves are chosen to be specific enough to avoid
 * false matches (e.g., 'progress' instead of 'pr').
 */
function matchesKeyword(query: string, keyword: string): boolean {
  return query.includes(keyword);
}

/**
 * Score each route category against the query and return the best match.
 * Scoring: each keyword match = 2 points, each phrase match = 1 point.
 * Keywords score higher because they are domain-specific signals (e.g., "deload",
 * "protein"), while phrases are generic question frames (e.g., "what is", "how to").
 * Ties broken by priority order (earlier in ROUTE_CATEGORIES wins).
 */
export function routeQuestion(question: string): string {
  const q = question.toLowerCase();

  let bestId = 'default';
  let bestScore = 0;

  for (const cat of ROUTE_CATEGORIES) {
    if (cat.id === 'default') continue;

    let score = 0;

    // Keywords are domain-specific signals (higher weight)
    for (const kw of cat.keywords) {
      if (matchesKeyword(q, kw)) {
        score += 2;
      }
    }

    // Phrases are generic question frames (lower weight)
    for (const phrase of cat.phrases) {
      if (q.includes(phrase)) {
        score += 1;
      }
    }

    // Strictly greater than: ties broken by priority (earlier category wins)
    if (score > bestScore) {
      bestScore = score;
      bestId = cat.id;
    }
  }

  return bestId;
}

/**
 * Pre-built coaching responses based on common questions and user data.
 * Works without any API -- uses the user's actual training data to give
 * personalized, context-aware answers.
 *
 * Uses a scored keyword-matching router instead of fragile if/else-if
 * with includes() checks, preventing false matches like "program" hitting
 * the progress branch due to the "pr" substring.
 */
export function getOfflineResponse(
  question: string,
  context: CoachContext,
): CoachMessage {
  const q = question.toLowerCase();
  let content: string;
  let dataSources: string[] = [];

  const route = routeQuestion(question);

  // Memory/history questions
  const memory = loadCoachMemory();
  if (route === 'memory') {
    content = `I've been coaching you for ${memory.conversationCount} sessions since ${memory.firstConversation.slice(0, 10)}.\n\n`;
    if (memory.facts.length > 0) {
      content += 'Here\'s what I know about you:\n\n';
      const goals = memory.facts.filter(f => f.category === 'goal');
      const achievements = memory.facts.filter(f => f.category === 'achievement');
      const limitations = memory.facts.filter(f => f.category === 'limitation');
      if (goals.length) { content += '**Goals:**\n'; goals.forEach(f => { content += `\u2022 ${f.fact}\n`; }); content += '\n'; }
      if (achievements.length) { content += '**Achievements:**\n'; achievements.forEach(f => { content += `\u2022 ${f.fact}\n`; }); content += '\n'; }
      if (limitations.length) { content += '**Things to watch:**\n'; limitations.forEach(f => { content += `\u2022 ${f.fact}\n`; }); content += '\n'; }
    }
    content += `Current program: ${context.currentProgram} (${context.currentPhase})\nWorkouts completed: ${context.workoutsCompleted}`;
    dataSources = ['coaching memory', 'training history'];
  }

  // Form/technique questions
  else if (route === 'form') {
    const scores = context.formScores;
    if (Object.keys(scores).length === 0) {
      content = 'I don\'t have any form analysis data yet. Use the "Form Check" tab to upload a video of your lift -- I\'ll analyze your technique across 6 dimensions and give you specific feedback. This is something no other coaching app can do.';
    } else {
      const entries = Object.entries(scores);
      const worst = entries.reduce((a, b) => a[1] < b[1] ? a : b);
      const best = entries.reduce((a, b) => a[1] > b[1] ? a : b);

      content = 'Based on your recent form analysis:\n\n';
      for (const [lift, score] of entries) {
        const grade = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 55 ? 'Needs work' : 'Focus here';
        content += `\u2022 ${capitalize(lift)}: ${score}/100 (${grade})\n`;
      }

      if (worst[1] < 70) {
        const demo = getExerciseDemo(worst[0]);
        content += `\nYour ${capitalize(worst[0])} needs the most attention. `;
        if (demo) {
          content += `Key cues: ${demo.cues.slice(0, 3).join(', ')}. `;
          content += `Common mistakes: ${demo.commonMistakes[0]}. `;
        }
        content += 'Consider reducing weight by 10% to rebuild technique.';
      } else {
        content += `\nNice work -- your form is solid across the board. ${capitalize(best[0])} is your strongest lift technically (${best[1]}/100).`;
      }
      dataSources = ['CV form analysis', 'exercise demos'];
    }
  }

  // Strength/progress questions
  else if (route === 'progress') {
    const e1rms = context.e1rms;
    if (Object.keys(e1rms).length === 0 && context.workoutsCompleted < 3) {
      content = `You're just getting started -- ${context.workoutsCompleted} workout(s) completed so far. Focus on learning the movements and building consistency. Strength PRs will come naturally in the first few weeks. The most important thing right now is showing up.`;
    } else {
      content = 'Here\'s where you stand:\n\n';
      if (Object.keys(e1rms).length > 0) {
        for (const [lift, e1rm] of Object.entries(e1rms)) {
          content += `\u2022 ${capitalize(lift)} e1RM: ${e1rm} lbs\n`;
        }
      }
      content += `\nWorkouts completed: ${context.workoutsCompleted}`;
      content += `\nCurrent program: ${context.currentProgram} (${context.currentPhase})`;

      if (context.bodyProgress.bodyweight.current) {
        content += `\nBodyweight: ${context.bodyProgress.bodyweight.current} ${context.bodyProgress.bodyweight.unit}`;
        if (context.bodyProgress.bodyweight.change30d) {
          content += ` (${context.bodyProgress.bodyweight.change30d > 0 ? '+' : ''}${context.bodyProgress.bodyweight.change30d} last 30 days)`;
        }
      }

      // Check for stalls
      const stalledLifts = Object.entries(context.programState?.liftProgress ?? {})
        .filter(([, p]) => p.deloadCycles > 0)
        .map(([lift]) => lift);

      if (stalledLifts.length > 0) {
        content += `\n\n${capitalize(stalledLifts.join(', '))} ${stalledLifts.length === 1 ? 'has' : 'have'} stalled. This is normal -- it means you're getting close to needing intermediate programming. Keep training, eat well, and sleep 7-9 hours. The app will recommend a transition when it's time.`;
      }
      dataSources = ['PR tracker', 'workout logs', 'body tracker'];
    }
  }

  // Program/programming questions
  else if (route === 'programming') {
    const program = context.programState ? PROGRAMS[context.programState.programId] : null;
    if (!program) {
      content = 'You don\'t have a program set up yet. Go to the Training tab and use the setup wizard -- it will recommend the best program based on your experience, schedule, equipment, and goals. Or describe your ideal program in the text builder and I\'ll generate it for you.';
    } else {
      content = `You're on **${program.name}** (${context.currentPhase}, Week ${context.currentWeek}).\n\n`;
      content += `**Why this program:** ${program.scienceBasis.slice(0, 200)}...\n\n`;

      if (context.workoutsCompleted < 10) {
        content += `You're still early in the program (${context.workoutsCompleted} workouts). Give it at least 4-6 weeks before evaluating whether to change. Consistency > program optimization at this stage.`;
      } else {
        const exhaustedLifts = Object.entries(context.programState?.liftProgress ?? {})
          .filter(([, p]) => p.lpExhausted)
          .map(([lift]) => lift);

        if (exhaustedLifts.length >= 2) {
          content += `${exhaustedLifts.length} of your lifts have exhausted linear progression. The app will recommend intermediate programs (Texas Method, Upper/Lower Split, 5/3/1) when you're ready.`;
        } else {
          content += 'Your program is still driving progress. Stick with it until the adaptation engine recommends a change -- it\'s monitoring your stalls, RPE, form scores, and recovery automatically.';
        }
      }
      dataSources = ['program state', 'workout logs'];
    }
  }

  // Injury/pain questions
  else if (route === 'injury') {
    content = 'I\'m sorry to hear something hurts. Here\'s what I recommend:\n\n';
    content += '1. **If it\'s sharp, sudden, or in a joint**: Stop that exercise immediately. Use the post-workout feedback to report it -- the app will automatically substitute safe alternatives.\n\n';
    content += '2. **If it\'s general muscle soreness (DOMS)**: This is normal, especially after new exercises or increased volume. Foam rolling, light movement, and adequate protein help. You can train through mild soreness.\n\n';
    content += '3. **If pain persists for 2+ weeks**: See a physiotherapist or sports medicine doctor. The app tracks injury reports across sessions and will escalate the recommendation if the same area keeps getting flagged.\n\n';
    content += 'You can report injuries in the post-workout feedback form -- the app will automatically adjust your exercises and provide a graduated return-to-training protocol when the pain resolves.';
    dataSources = ['injury tracking system'];
  }

  // Deload/fatigue questions
  else if (route === 'deload') {
    const avgRPE = context.recentRPE.length > 0
      ? context.recentRPE.reduce((a, b) => a + b, 0) / context.recentRPE.length
      : 0;
    const tooHardCount = context.recentDifficulty.filter(d => d === 'too_hard').length;

    if (avgRPE > 9 || tooHardCount >= 2) {
      content = 'Your data suggests you might need a deload:\n\n';
      content += `\u2022 Average recent RPE: ${avgRPE.toFixed(1)}/10 (${avgRPE > 9 ? 'very high' : 'elevated'})\n`;
      content += `\u2022 Recent sessions rated "too hard": ${tooHardCount} of ${context.recentDifficulty.length}\n\n`;
      content += 'Go to "Modify Schedule" and select "I need a deload week." The app will reduce all weights by 35-40% for one week while keeping the same movement patterns. You\'ll come back stronger.\n\n';
      content += 'Science: PMC10948666 -- deloading every 4-6 weeks (or reactively when performance declines) prevents non-functional overreaching.';
    } else {
      content = `Your data doesn't show signs of accumulated fatigue right now (avg RPE ${avgRPE.toFixed(1)}, no recent "too hard" sessions). But if you feel run down, trust your body -- a proactive deload is never wasted. Use the "Modify Schedule" button to schedule one.`;
    }
    dataSources = ['RPE data', 'session difficulty', 'readiness'];
  }

  // Exercise-specific questions
  else if (route === 'technique') {
    // Try to identify which exercise
    const exercises = ['squat', 'bench', 'deadlift', 'ohp', 'press', 'row', 'pull-up', 'pullup', 'rdl', 'hip thrust'];
    const match = exercises.find(e => q.includes(e));

    if (match) {
      const slot = match === 'press' ? 'ohp' : match === 'pull-up' ? 'pullup' : match === 'hip thrust' ? 'hip_thrust' : match;
      const demo = getExerciseDemo(slot);
      if (demo) {
        content = `**${demo.name}**\n\n`;
        content += `${demo.description}\n\n`;
        content += '**Key cues:**\n';
        demo.cues.forEach(c => { content += `\u2022 ${c}\n`; });
        content += '\n**Common mistakes:**\n';
        demo.commonMistakes.slice(0, 3).forEach(m => { content += `\u2022 ${m}\n`; });

        // Add form score context if available
        const formScore = context.formScores[slot];
        if (formScore) {
          content += `\n**Your form score:** ${formScore}/100. `;
          if (formScore < 70) {
            content += 'This needs work -- focus on the cues above and consider a form check video.';
          } else if (formScore >= 85) {
            content += 'Your technique is looking strong. Keep it up.';
          }
        }

        if (demo.youtubeUrl) {
          content += `\n\n**Tutorial:** ${demo.youtubeTitle ?? 'Watch demo'}`;
        }
        dataSources = ['exercise demos', 'CV form analysis'];
      } else {
        content = `I don't have detailed demo information for "${match}" yet. Use the Form Check tab to upload a video and I'll analyze your technique.`;
      }
    } else {
      content = 'What exercise do you need help with? I have detailed coaching cues and form analysis for: squat, bench press, deadlift, overhead press, barbell row, pull-ups, Romanian deadlift, hip thrusts, and more. Just ask "how to squat" or "bench press tips."';
    }
  }

  // Nutrition/diet questions
  else if (route === 'nutrition') {
    content = 'I\'m a lifting coach, not a nutritionist, but here are the evidence-based fundamentals:\n\n';
    content += '\u2022 **Protein:** 1.6-2.2 g/kg bodyweight/day, spread across 3-5 meals (Morton et al. 2018)\n';
    content += '\u2022 **Calories:** Slight surplus (10-20%) for muscle gain; moderate deficit for fat loss. You can build muscle in a deficit as a beginner.\n';
    content += '\u2022 **Sleep:** 7-9 hours -- this matters MORE than any supplement (Knowles et al. 2018)\n';
    content += '\u2022 **Hydration:** Drink enough that your urine is pale yellow\n\n';
    content += 'For detailed macro tracking, I\'d recommend pairing this app with MacroFactor (by Stronger by Science) -- it has the best TDEE algorithm in the market.';
    dataSources = ['evidence-based guidelines'];
  }

  // Terminology questions
  else if (route === 'terminology') {
    const termDefinitions: Record<string, string> = {
      'rpe': 'RPE stands for Rate of Perceived Exertion. It\'s a 1-10 scale measuring how hard a set felt.\n\n\u2022 RPE 6: Could do 4+ more reps (warm-up territory)\n\u2022 RPE 7: Could do 3 more reps\n\u2022 RPE 8: Could do 2 more reps (most productive training zone)\n\u2022 RPE 9: Could do 1 more rep\n\u2022 RPE 10: Maximum effort, couldn\'t do another rep\n\nUse RPE to gauge intensity without needing exact percentages. Most training should be RPE 7-8.5.',
      'amrap': 'AMRAP means "As Many Reps As Possible." When you see "5+" or "AMRAP" on a set, do as many good reps as you can \u2014 stop 1-2 reps before form breaks down. Your AMRAP performance helps the app calculate progression. Example: if your program says 3x5+ and you get 5, 5, 8 on the AMRAP set, that tells the app you have room to increase weight.',
      'training max': 'Training Max (TM) is a conservative number used to calculate your working weights \u2014 typically 90% of your true 1RM. If your best squat is 300 lbs, your TM would be 270 lbs. All percentages in 5/3/1 programs are based on TM, not your actual max. This builds in a buffer so you\'re never grinding reps in training.',
      'tm': 'Training Max (TM) is 90% of your true 1RM. All 5/3/1 percentages are based on this conservative number. See "Training Max" for details.',
      'deload': 'A deload is a planned easy week where you reduce weight and/or volume to let your body recover. Think of it as a recovery period \u2014 you\'re not getting weaker, you\'re letting your muscles, joints, and nervous system catch up. Typically: same exercises, 30-50% less weight, fewer sets. Most programs schedule deloads every 4-6 weeks.',
      '1rm': '1RM means "One-Rep Max" \u2014 the heaviest weight you can lift for a single repetition with good form. You don\'t need to actually test this. The app estimates it from your working sets using the Epley formula: e1RM = weight \u00d7 (1 + reps/30).',
      'set': 'A set is one group of consecutive repetitions. When a program says "3 sets of 5 reps" (written as 3x5), you do 5 reps, rest, 5 reps, rest, 5 reps. That\'s 3 sets total.',
      'rep': 'A rep (repetition) is one complete movement. For a squat: lower the bar, stand back up \u2014 that\'s 1 rep. "5 reps" means doing that movement 5 times in a row before resting.',
      'lp': 'LP means Linear Progression \u2014 adding weight every single session. This works for beginners because your body recovers fast enough to get stronger between workouts. When LP stops working (you can\'t add weight anymore), it\'s time for intermediate programming.',
      'fsl': 'FSL means "First Set Last" \u2014 a 5/3/1 template where after your main sets, you do 5x5 at the weight of your first working set. It\'s a moderate-volume option that builds strength without excessive fatigue.',
      'rir': 'RIR means "Reps In Reserve" \u2014 how many reps you could have done but didn\'t. RIR 2 = you stopped with 2 reps left in the tank. RIR is the inverse of RPE: RPE 8 = RIR 2, RPE 9 = RIR 1, RPE 10 = RIR 0.',
      'progressive overload': 'Progressive overload means gradually increasing the demands on your body over time \u2014 adding weight, reps, or sets. It\'s the #1 principle of getting stronger. Without progressive overload, your body has no reason to adapt.',
      'periodization': 'Periodization means organizing your training into planned phases (blocks) that focus on different goals. Example: 4 weeks of high-volume hypertrophy, then 4 weeks of heavy strength, then 2 weeks of peaking. This prevents plateaus and manages fatigue.',
    };

    // Find which term they're asking about
    let foundTerm: string | null = null;
    let foundDefinition: string | null = null;
    for (const [term, def] of Object.entries(termDefinitions)) {
      if (q.includes(term.toLowerCase())) {
        foundTerm = term.toUpperCase();
        foundDefinition = def;
        break;
      }
    }

    if (foundDefinition) {
      content = `**${foundTerm}**\n\n${foundDefinition}`;
      dataSources = ['glossary'];
    } else {
      content = 'I can explain these training terms:\n\n' +
        '\u2022 **RPE** \u2014 Rate of Perceived Exertion\n' +
        '\u2022 **AMRAP** \u2014 As Many Reps As Possible\n' +
        '\u2022 **Training Max (TM)** \u2014 90% of your 1RM\n' +
        '\u2022 **Deload** \u2014 Planned recovery week\n' +
        '\u2022 **1RM** \u2014 One-Rep Max\n' +
        '\u2022 **Set / Rep** \u2014 Groups of movements\n' +
        '\u2022 **LP** \u2014 Linear Progression\n' +
        '\u2022 **FSL** \u2014 First Set Last (5/3/1 template)\n' +
        '\u2022 **RIR** \u2014 Reps In Reserve\n' +
        '\u2022 **Progressive Overload** \u2014 Adding weight over time\n' +
        '\u2022 **Periodization** \u2014 Planned training phases\n\n' +
        'Ask "What is RPE?" or "Explain deload" for details.';
      dataSources = ['glossary'];
    }
  }

  // Plateau / sticking point questions
  else if (route === 'plateau') {
    // Check which lift they're asking about
    const liftMatch = ['squat', 'bench', 'deadlift', 'ohp', 'press'].find(l => q.includes(l));

    content = '';

    if (liftMatch) {
      const slot = liftMatch === 'press' ? 'ohp' : liftMatch;
      const progress = context.programState?.liftProgress?.[slot];
      const formScore = context.formScores[slot];

      content += `**${capitalize(liftMatch)} Plateau Analysis:**\n\n`;

      if (progress) {
        content += `Current weight: ${progress.currentWeight} ${progress.unit}\n`;
        content += `Deload cycles: ${progress.deloadCycles}\n`;
        if (progress.lpExhausted) content += `LP status: Exhausted \u2014 time for intermediate programming\n`;
        content += '\n';
      }

      if (formScore && formScore < 75) {
        content += `Your form score is ${formScore}/100 \u2014 technique is likely limiting you. Focus on form before adding weight.\n\n`;
      }

      // Exercise-specific sticking point advice
      const stickingPointAdvice: Record<string, string> = {
        squat: '**If you\'re stuck at the bottom (out of the hole):**\n\u2022 Pause squats (3-sec hold at bottom)\n\u2022 Front squats (forces upright position)\n\u2022 Box squats (practice driving from a dead stop)\n\n**If you\'re stuck at the top (lockout):**\n\u2022 Hip thrusts (glute strength)\n\u2022 Good mornings (posterior chain)\n\n**If you\'re leaning forward:**\n\u2022 Front squats\n\u2022 Core work (planks, ab wheel)',
        bench: '**If you\'re stuck off the chest:**\n\u2022 Spoto press (pause 1" above chest)\n\u2022 Wide-grip bench\n\u2022 DB bench (greater ROM)\n\n**If you\'re stuck at lockout:**\n\u2022 Close-grip bench (tricep strength)\n\u2022 Floor press\n\u2022 Tricep pushdowns',
        deadlift: '**If you\'re stuck off the floor:**\n\u2022 Deficit deadlifts (1-2" platform)\n\u2022 Pause deadlifts\n\u2022 Front squats (quad strength)\n\n**If you\'re stuck above the knee:**\n\u2022 Block pulls / rack pulls\n\u2022 Barbell rows (upper back)\n\u2022 Good mornings',
        ohp: '**If you\'re stuck at the bottom:**\n\u2022 Z-press (seated, no leg drive)\n\u2022 Pin press from bottom position\n\n**If you\'re stuck at lockout:**\n\u2022 Close-grip bench (tricep carryover)\n\u2022 Push press (teaches lockout position)',
      };

      content += stickingPointAdvice[slot] ?? stickingPointAdvice['squat'];
    } else {
      content += '**General Plateau Advice:**\n\n';
      content += '1. **Check recovery first:** Are you sleeping 7-9 hours? Eating enough protein (1.6-2.2 g/kg/day)? Managing stress?\n\n';
      content += '2. **Check form:** Use the Form Check tab to analyze your technique. Poor form limits strength transfer.\n\n';
      content += '3. **Check programming:** If you\'ve been on the same program for months without progress, the app will recommend a transition. Trust the adaptation engine.\n\n';
      content += '4. **Consider a deload:** Sometimes your body just needs a recovery week. Go to Modify Schedule \u2192 "I need a deload week."\n\n';
      content += 'Which lift is giving you trouble? I can give specific accessory recommendations.';
    }

    dataSources = ['lift progress', 'exercise demos', 'form analysis'];
  }

  // Default / catch-all
  else {
    content = 'I\'m your AI lifting coach. I can help with:\n\n';
    content += '\u2022 **"How\'s my form?"** -- I\'ll review your CV form analysis scores\n';
    content += '\u2022 **"How am I progressing?"** -- I\'ll show your PRs, e1RMs, and trends\n';
    content += '\u2022 **"Should I change programs?"** -- I\'ll evaluate your current program fit\n';
    content += '\u2022 **"How to squat/bench/deadlift?"** -- Coaching cues and common mistakes\n';
    content += '\u2022 **"I\'m tired/need a deload"** -- I\'ll check your fatigue signals\n';
    content += '\u2022 **"Something hurts"** -- Injury guidance and exercise substitutions\n';
    content += '\u2022 **"What should I eat?"** -- Evidence-based nutrition basics\n\n';
    content += 'What would you like to know?';
    dataSources = [];
  }

  return {
    role: 'coach',
    content,
    timestamp: new Date().toISOString(),
    dataSources,
  };
}

// --- Online Mode (Claude API) ---

const API_KEY_STORAGE = 'squat_form_ai_api_key';

export function getApiKey(): string | null {
  try { return localStorage.getItem(API_KEY_STORAGE); } catch { return null; }
}

export function saveApiKey(key: string): void {
  try { localStorage.setItem(API_KEY_STORAGE, key); } catch { document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' })); }
}

export function clearApiKey(): void {
  try { localStorage.removeItem(API_KEY_STORAGE); } catch { /* ignore */ }
}

/**
 * Send a message to Claude API with full training context.
 * Returns the coach's response.
 *
 * Note: This calls the Anthropic API directly from the client.
 * The user provides their own API key -- we never store or transmit
 * their training data to any server except Anthropic's API.
 */
export async function sendToClaudeAPI(
  messages: CoachMessage[],
  context: CoachContext,
  apiKey: string,
): Promise<CoachMessage> {
  const systemPrompt = buildSystemPrompt(context);

  const apiMessages = messages.map(m => ({
    role: m.role === 'coach' ? 'assistant' as const : 'user' as const,
    content: m.content,
  }));

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages: apiMessages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const responseContent: string = data.content?.[0]?.text ?? 'I couldn\'t generate a response. Please try again.';

    return {
      role: 'coach',
      content: responseContent,
      timestamp: new Date().toISOString(),
      dataSources: ['Claude API', 'full training context'],
    };
  } catch (_err) {
    // Fall back to offline response
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    const offlineResponse = getOfflineResponse(lastUserMsg?.content ?? '', context);
    offlineResponse.content = `[Offline mode -- API unavailable]\n\n${offlineResponse.content}`;
    return offlineResponse;
  }
}

// --- Chat History ---

const CHAT_HISTORY_KEY = 'squat_form_chat_history';

export function loadChatHistory(): CoachMessage[] {
  try {
    return JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) ?? '[]');
  } catch { return []; }
}

export function saveChatHistory(messages: CoachMessage[]): void {
  try {
    // Keep last 50 messages
    const toSave = messages.length > 50 ? messages.slice(-50) : messages;
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(toSave));
  } catch {
    document.dispatchEvent(new CustomEvent('storage-warning', { detail: 'Storage is full. Some data may not be saved.' }));
  }
}

export function clearChatHistory(): void {
  try { localStorage.removeItem(CHAT_HISTORY_KEY); } catch { /* ignore */ }
}

// --- Utility ---

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
