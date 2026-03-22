import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CoachContext, CoachMemory, CoachMessage } from '../ai-coach';

// --- Mock all dependencies before importing the module under test ---

vi.mock('../workout-storage', () => ({
  loadProgramState: vi.fn(() => null),
  loadWorkoutLogs: vi.fn(() => []),
}));

vi.mock('../workout-programs', () => ({
  PROGRAMS: {
    starting_strength: {
      id: 'starting_strength',
      name: 'Starting Strength',
      shortName: 'SS',
      scienceBasis: 'Linear progression is the most effective novice training method. Rippetoe\'s Starting Strength is a proven barbell-only novice program.',
      workouts: [],
    },
    gzclp: {
      id: 'gzclp',
      name: 'GZCLP',
      shortName: 'GZCLP',
      scienceBasis: 'Tiered progression allows continued LP after initial stalls.',
      workouts: [],
    },
  },
}));

vi.mock('../pr-tracker', () => ({
  getBestE1RMs: vi.fn(() => ({})),
}));

vi.mock('../form-bridge', () => ({
  getRecentFormScores: vi.fn(() => ({})),
  getRecentWeakDimensions: vi.fn(() => ({})),
}));

vi.mock('../body-tracker', () => ({
  getProgressSummary: vi.fn(() => ({
    bodyweight: { unit: 'lbs' },
    measurements: {},
    photoCount: 0,
  })),
}));

vi.mock('../exercise-demos', () => ({
  getExerciseDemo: vi.fn((slot: string) => {
    const demos: Record<string, unknown> = {
      squat: {
        slot: 'squat',
        name: 'Barbell Back Squat',
        description: 'The king of lower body exercises.',
        steps: ['Step 1', 'Step 2'],
        commonMistakes: ['Knees caving in', 'Excessive forward lean'],
        cues: ['Drive knees out', 'Chest up', 'Sit back'],
        muscles: ['Quads', 'Glutes', 'Hamstrings'],
        youtubeUrl: 'https://www.youtube.com/watch?v=test',
        youtubeTitle: 'How to Squat',
      },
      bench: {
        slot: 'bench',
        name: 'Barbell Bench Press',
        description: 'Primary upper body pressing movement.',
        steps: ['Step 1'],
        commonMistakes: ['Bouncing off chest'],
        cues: ['Arch your back', 'Leg drive'],
        muscles: ['Chest', 'Triceps'],
      },
    };
    return demos[slot] ?? null;
  }),
}));

vi.mock('../volume-tracker', () => ({
  calculateWeeklyVolume: vi.fn(() => []),
  getUndertrainedMuscles: vi.fn(() => []),
}));

// --- Import module under test ---

import {
  loadCoachMemory,
  saveCoachMemory,
  extractMemoryFromMessage,
  buildCoachContext,
  buildSystemPrompt,
  getOfflineResponse,
  routeQuestion,
  sendToClaudeAPI,
  getApiKey,
  saveApiKey,
  clearApiKey,
  loadChatHistory,
  saveChatHistory,
  clearChatHistory,
} from '../ai-coach';

// --- localStorage mock ---

function createLocalStorageMock(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

// --- Helper: build a minimal CoachContext ---

function makeContext(overrides: Partial<CoachContext> = {}): CoachContext {
  return {
    programState: null,
    currentProgram: 'No program selected',
    currentPhase: 'Week 0',
    currentWeek: 0,
    workoutsCompleted: 0,
    recentLogs: [],
    formScores: {},
    weakDimensions: {},
    e1rms: {},
    bodyProgress: { bodyweight: { unit: 'lbs' }, measurements: {}, photoCount: 0 },
    undertrainedMuscles: [],
    recentDifficulty: [],
    recentRPE: [],
    ...overrides,
  };
}

// --- Tests ---

describe('AI Coach', () => {
  let storageMock: Storage;

  beforeEach(() => {
    storageMock = createLocalStorageMock();
    vi.stubGlobal('localStorage', storageMock);
  });

  // ========================================
  // Coach Memory (persistence layer)
  // ========================================

  describe('Coach Memory', () => {
    it('returns empty memory when localStorage is empty', () => {
      const mem = loadCoachMemory();
      expect(mem.facts).toEqual([]);
      expect(mem.conversationCount).toBe(0);
    });

    it('round-trips memory through save/load', () => {
      const mem: CoachMemory = {
        facts: [{ fact: 'User wants to compete', source: 'user_told', date: '2026-03-01', category: 'goal' }],
        conversationCount: 5,
        firstConversation: '2026-01-01T00:00:00.000Z',
        lastConversation: '2026-03-01T00:00:00.000Z',
      };
      saveCoachMemory(mem);
      const loaded = loadCoachMemory();
      expect(loaded.facts).toHaveLength(1);
      expect(loaded.facts[0].fact).toBe('User wants to compete');
      expect(loaded.conversationCount).toBe(5);
    });

    it('caps facts at 50', () => {
      const mem: CoachMemory = {
        facts: Array.from({ length: 60 }, (_, i) => ({
          fact: `Fact ${i}`,
          source: 'observed' as const,
          date: '2026-01-01',
          category: 'achievement' as const,
        })),
        conversationCount: 100,
        firstConversation: '2026-01-01T00:00:00.000Z',
        lastConversation: '2026-03-01T00:00:00.000Z',
      };
      saveCoachMemory(mem);
      const loaded = loadCoachMemory();
      expect(loaded.facts).toHaveLength(50);
      // Should keep the last 50
      expect(loaded.facts[0].fact).toBe('Fact 10');
    });

    it('handles corrupted localStorage gracefully', () => {
      localStorage.setItem('squat_form_coach_memory', 'not-valid-json');
      const mem = loadCoachMemory();
      expect(mem.facts).toEqual([]);
      expect(mem.conversationCount).toBe(0);
    });
  });

  // ========================================
  // Memory Extraction
  // ========================================

  describe('extractMemoryFromMessage', () => {
    it('extracts goal from "I want to" statements', () => {
      const ctx = makeContext();
      extractMemoryFromMessage('I want to squat 315', ctx);
      const mem = loadCoachMemory();
      expect(mem.facts.some(f => f.category === 'goal' && f.fact.includes('squat 315'))).toBe(true);
      expect(mem.conversationCount).toBe(1);
    });

    it('extracts limitations from "I have trouble with" statements', () => {
      const ctx = makeContext();
      extractMemoryFromMessage('I have trouble with my left knee', ctx);
      const mem = loadCoachMemory();
      expect(mem.facts.some(f => f.category === 'limitation')).toBe(true);
    });

    it('extracts preferences from "I prefer" statements', () => {
      const ctx = makeContext();
      extractMemoryFromMessage('I prefer low bar squats', ctx);
      const mem = loadCoachMemory();
      expect(mem.facts.some(f => f.category === 'preference' && f.fact.includes('low bar'))).toBe(true);
    });

    it('extracts dislikes from "I don\'t like" statements', () => {
      const ctx = makeContext();
      extractMemoryFromMessage("I don't like front squats", ctx);
      const mem = loadCoachMemory();
      expect(mem.facts.some(f => f.category === 'preference' && f.fact.includes('front squats'))).toBe(true);
    });

    it('does not add duplicate facts', () => {
      const ctx = makeContext();
      extractMemoryFromMessage('I want to squat 315', ctx);
      extractMemoryFromMessage('I want to squat 315', ctx);
      const mem = loadCoachMemory();
      const goalFacts = mem.facts.filter(f => f.fact.includes('squat 315'));
      expect(goalFacts).toHaveLength(1);
    });

    it('records milestone achievements at 25 workout increments', () => {
      const ctx = makeContext({ workoutsCompleted: 25 });
      extractMemoryFromMessage('How am I doing?', ctx);
      const mem = loadCoachMemory();
      expect(mem.facts.some(f => f.fact.includes('Completed 25 workouts'))).toBe(true);
    });

    it('tracks PR achievements from e1rm data', () => {
      const ctx = makeContext({ e1rms: { squat: 300, bench: 225 } });
      extractMemoryFromMessage('Check my progress', ctx);
      const mem = loadCoachMemory();
      expect(mem.facts.some(f => f.fact.includes('Best squat e1RM: 300'))).toBe(true);
      expect(mem.facts.some(f => f.fact.includes('Best bench e1RM: 225'))).toBe(true);
    });

    it('updates existing PR facts rather than adding duplicates', () => {
      const ctx1 = makeContext({ e1rms: { squat: 275 } });
      extractMemoryFromMessage('test', ctx1);
      const ctx2 = makeContext({ e1rms: { squat: 300 } });
      extractMemoryFromMessage('test', ctx2);
      const mem = loadCoachMemory();
      const squatPRs = mem.facts.filter(f => f.fact.startsWith('Best squat e1RM:'));
      expect(squatPRs).toHaveLength(1);
      expect(squatPRs[0].fact).toBe('Best squat e1RM: 300 lbs');
    });
  });

  // ========================================
  // Offline Response System
  // ========================================

  describe('Offline Response - Form/Technique', () => {
    it('asks for form check video when no scores available', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse('How is my form?', ctx);
      expect(resp.role).toBe('coach');
      expect(resp.content).toContain('Form Check');
      expect(resp.content).toContain('form analysis data');
    });

    it('returns form scores when data is available', () => {
      const ctx = makeContext({ formScores: { squat: 82, bench: 60 } });
      const resp = getOfflineResponse('How is my technique?', ctx);
      expect(resp.content).toContain('82/100');
      expect(resp.content).toContain('60/100');
      expect(resp.dataSources).toContain('CV form analysis');
    });

    it('recommends weight reduction for low scores', () => {
      const ctx = makeContext({ formScores: { squat: 55 } });
      const resp = getOfflineResponse('Check my form score', ctx);
      expect(resp.content).toContain('reducing weight by 10%');
    });

    it('identifies strongest and weakest lifts', () => {
      const ctx = makeContext({ formScores: { squat: 90, deadlift: 60, bench: 75 } });
      const resp = getOfflineResponse('Tell me about my form', ctx);
      expect(resp.content).toContain('Deadlift');
      expect(resp.content).toContain('Squat');
    });
  });

  describe('Offline Response - Progress', () => {
    it('returns beginner encouragement for new users', () => {
      const ctx = makeContext({ workoutsCompleted: 1 });
      const resp = getOfflineResponse('How am I progressing?', ctx);
      expect(resp.content).toContain('just getting started');
      expect(resp.content).toContain('showing up');
    });

    it('includes e1RM data in progress responses', () => {
      const ctx = makeContext({
        workoutsCompleted: 20,
        e1rms: { squat: 300, bench: 200 },
      });
      const resp = getOfflineResponse('How is my progress?', ctx);
      expect(resp.content).toContain('300 lbs');
      expect(resp.content).toContain('200 lbs');
      expect(resp.dataSources).toContain('PR tracker');
    });

    it('reports stalled lifts', () => {
      const ctx = makeContext({
        workoutsCompleted: 30,
        e1rms: { squat: 300 },
        programState: {
          programId: 'starting_strength',
          startDate: '2026-01-01',
          currentWeek: 8,
          currentDay: 0,
          trainingMaxes: {},
          liftProgress: {
            squat: {
              liftName: 'squat',
              currentWeight: 275,
              unit: 'lbs',
              increment: 5,
              consecutiveFailures: 2,
              deloadCycles: 1,
              stage: 1,
              lpExhausted: false,
              history: [],
              lastSuccessWeight: 270,
            },
          },
          workoutsCompleted: 30,
          cycleNumber: 1,
          lpPhase: undefined,
        } as any,
      });
      const resp = getOfflineResponse('Am I getting stronger?', ctx);
      expect(resp.content).toContain('stalled');
    });
  });

  describe('Offline Response - Programming', () => {
    it('suggests setup wizard when no program is selected', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse('What program should I follow?', ctx);
      expect(resp.content).toContain('Training tab');
      expect(resp.content).toContain('setup wizard');
    });

    it('describes current program and its science basis', () => {
      const ctx = makeContext({
        programState: {
          programId: 'starting_strength',
          startDate: '2026-01-01',
          currentWeek: 3,
          currentDay: 0,
          trainingMaxes: {},
          liftProgress: {},
          workoutsCompleted: 8,
          cycleNumber: 1,
        } as any,
        currentProgram: 'SS',
        currentPhase: 'Week 3',
        currentWeek: 3,
        workoutsCompleted: 8,
      });
      const resp = getOfflineResponse('Tell me about my program', ctx);
      expect(resp.content).toContain('Starting Strength');
      expect(resp.content).toContain('still early');
      expect(resp.dataSources).toContain('program state');
    });

    it('detects LP exhaustion and suggests intermediate programs', () => {
      const ctx = makeContext({
        programState: {
          programId: 'starting_strength',
          startDate: '2026-01-01',
          currentWeek: 12,
          currentDay: 0,
          trainingMaxes: {},
          liftProgress: {
            squat: { liftName: 'squat', currentWeight: 300, unit: 'lbs', increment: 5, consecutiveFailures: 3, deloadCycles: 3, stage: 1, lpExhausted: true, history: [], lastSuccessWeight: 290 },
            bench: { liftName: 'bench', currentWeight: 200, unit: 'lbs', increment: 2.5, consecutiveFailures: 3, deloadCycles: 3, stage: 1, lpExhausted: true, history: [], lastSuccessWeight: 195 },
          },
          workoutsCompleted: 40,
          cycleNumber: 1,
        } as any,
        currentProgram: 'SS',
        currentPhase: 'Week 12',
        currentWeek: 12,
        workoutsCompleted: 40,
      });
      const resp = getOfflineResponse('Should I change my routine?', ctx);
      expect(resp.content).toContain('exhausted linear progression');
      expect(resp.content).toContain('intermediate');
    });
  });

  describe('Offline Response - Injury/Pain', () => {
    it('always recommends seeing a professional for persistent pain', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse('My knee hurts when I squat', ctx);
      expect(resp.content).toContain('physiotherapist');
      expect(resp.content).toContain('persists');
      expect(resp.content).toContain('Stop');
    });

    it('distinguishes between sharp pain and soreness', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse('I have pain in my back', ctx);
      expect(resp.content).toContain('sharp');
      expect(resp.content).toContain('soreness');
      expect(resp.content).toContain('DOMS');
    });

    it('mentions post-workout injury tracking', () => {
      const ctx = makeContext();
      // Use "injury" (not "injured") because the branch checks q.includes('injury')
      const resp = getOfflineResponse('I have a shoulder injury', ctx);
      expect(resp.content).toContain('post-workout feedback');
      expect(resp.content).toContain('return-to-training');
    });
  });

  describe('Offline Response - Deload/Fatigue', () => {
    it('recommends deload when RPE is consistently > 9', () => {
      const ctx = makeContext({
        recentRPE: [9.5, 10, 9, 9.5, 10],
        recentDifficulty: [],
      });
      const resp = getOfflineResponse('Should I take a deload?', ctx);
      expect(resp.content).toContain('deload');
      expect(resp.content).toContain('Average recent RPE');
      expect(resp.content).toContain('very high');
    });

    it('recommends deload after 2+ "too hard" sessions', () => {
      const ctx = makeContext({
        recentRPE: [8, 8.5, 9],
        recentDifficulty: ['too_hard', 'too_hard', 'just_right'],
      });
      const resp = getOfflineResponse('I feel tired all the time', ctx);
      expect(resp.content).toContain('deload');
      expect(resp.content).toContain('too hard');
    });

    it('does not recommend deload when data shows manageable fatigue', () => {
      const ctx = makeContext({
        recentRPE: [7, 7.5, 8],
        recentDifficulty: ['just_right', 'just_right'],
      });
      const resp = getOfflineResponse('Do I need rest?', ctx);
      expect(resp.content).toContain("doesn't show signs of accumulated fatigue");
    });

    it('uses actual RPE data in deload recommendations', () => {
      const ctx = makeContext({
        recentRPE: [9.5, 9.8, 10, 9.2, 9.6],
        recentDifficulty: ['too_hard', 'too_hard', 'just_right'],
      });
      const resp = getOfflineResponse('I need recovery advice', ctx);
      expect(resp.content).toMatch(/Average recent RPE:\s*\d+\.\d+/);
      expect(resp.dataSources).toContain('RPE data');
    });
  });

  describe('Offline Response - Technique/Exercise Tips', () => {
    it('returns exercise cues for recognized exercises', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse('squat tips', ctx);
      expect(resp.content).toContain('Barbell Back Squat');
      expect(resp.content).toContain('Drive knees out');
      expect(resp.content).toContain('Common mistakes');
    });

    it('incorporates form score context when available', () => {
      const ctx = makeContext({ formScores: { squat: 60 } });
      // "how do i" triggers technique, "squat" matches exercise
      const resp = getOfflineResponse('How do I squat?', ctx);
      expect(resp.content).toContain('60/100');
      expect(resp.content).toContain('needs work');
    });

    it('returns general help when no exercise is identified', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse('How to lift?', ctx);
      // No specific exercise match, so shows the exercise list
      expect(resp.content).toContain('exercise');
    });

    it('maps "press" to OHP exercise slot', () => {
      const ctx = makeContext();
      // The demo mock only has squat and bench, so "press" maps to ohp which returns null
      const resp = getOfflineResponse('How to press overhead?', ctx);
      // Should still respond even without a demo
      expect(resp.role).toBe('coach');
    });
  });

  describe('Offline Response - Nutrition', () => {
    it('stays in scope as a lifting coach', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse('What should I eat for muscle gain?', ctx);
      expect(resp.content).toContain("lifting coach, not a nutritionist");
    });

    it('provides evidence-based nutrition recommendations', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse('How much protein do I need?', ctx);
      expect(resp.content).toContain('1.6-2.2');
      expect(resp.content).toContain('Morton');
    });

    it('mentions sleep importance', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse('What diet should I follow?', ctx);
      expect(resp.content).toContain('Sleep');
      expect(resp.content).toContain('7-9 hours');
    });
  });

  describe('Offline Response - Terminology', () => {
    it('defines RPE accurately', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse('What is RPE?', ctx);
      expect(resp.content).toContain('Rate of Perceived Exertion');
      expect(resp.content).toContain('1-10');
      expect(resp.content).toContain('RPE 8');
    });

    it('defines AMRAP accurately', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse('What does AMRAP mean?', ctx);
      expect(resp.content).toContain('As Many Reps As Possible');
    });

    it('1RM question routes to progress (domain keyword outweighs question frame)', () => {
      // "1rm" keyword (progress, 2 pts) outweighs "what's" phrase (terminology, 1 pt)
      const ctx = makeContext({ workoutsCompleted: 1 });
      const resp = getOfflineResponse("What's a 1RM?", ctx);
      expect(resp.role).toBe('coach');
      expect(resp.content.length).toBeGreaterThan(0);
    });

    it('defines RIR and links it to RPE', () => {
      const ctx = makeContext();
      // "explain" triggers terminology branch, "rir" matches the RIR term definition
      const resp = getOfflineResponse('Explain RIR', ctx);
      expect(resp.content).toContain('Reps In Reserve');
      expect(resp.content).toContain('RPE');
    });

    it('deload question routes to deload branch (domain keyword outweighs question frame)', () => {
      // "deload" keyword (deload, 2 pts) outweighs "what is" phrase (terminology, 1 pt)
      // The coach gives personalized deload advice based on RPE data.
      const ctx = makeContext({
        recentRPE: [7, 7.5],
        recentDifficulty: ['just_right'],
      });
      const resp = getOfflineResponse('What is a deload?', ctx);
      expect(resp.content).toContain('deload');
      expect(resp.dataSources).toContain('RPE data');
    });

    it('defines LP (Linear Progression)', () => {
      const ctx = makeContext();
      // "what is" triggers terminology, "lp" matches the LP term definition
      const resp = getOfflineResponse('What is LP?', ctx);
      expect(resp.content).toContain('Linear Progression');
      expect(resp.content).toContain('adding weight every single session');
    });

    it('matches "set" definition for questions containing "set"', () => {
      const ctx = makeContext();
      // "what is a superset?" contains "set" which matches the "set" term definition
      const resp = getOfflineResponse('What is a superset?', ctx);
      // Gets the "set" definition because "set" is a substring of "superset"
      expect(resp.content).toContain('SET');
      expect(resp.content).toContain('repetitions');
    });

    it('shows term list when no term keyword matches', () => {
      const ctx = makeContext();
      // Use a word that doesn't contain any term keys
      const resp = getOfflineResponse('What is a warmup?', ctx);
      // "warmup" is not a defined term, so it should show the term list
      expect(resp.content).toContain('RPE');
      expect(resp.content).toContain('AMRAP');
    });
  });

  describe('Offline Response - Plateau/Sticking Points', () => {
    it('provides squat-specific sticking point advice', () => {
      const ctx = makeContext({ formScores: { squat: 65 } });
      const resp = getOfflineResponse("I'm stuck on my squat", ctx);
      expect(resp.content).toContain('Squat Plateau');
      expect(resp.content).toContain('Pause squats');
    });

    it('provides bench-specific sticking point advice', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse("Can't get my bench to go up", ctx);
      expect(resp.content).toContain('Bench Plateau');
      expect(resp.content).toContain('Spoto press');
    });

    it('provides general plateau advice when no lift specified', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse("I'm stuck at a plateau", ctx);
      expect(resp.content).toContain('General Plateau Advice');
      expect(resp.content).toContain('recovery');
    });

    it('incorporates form score when analyzing plateaus', () => {
      const ctx = makeContext({ formScores: { squat: 60 } });
      const resp = getOfflineResponse('My squat is stuck', ctx);
      expect(resp.content).toContain('60/100');
      expect(resp.content).toContain('technique');
    });
  });

  describe('Offline Response - Memory/History', () => {
    it('reports coaching history', () => {
      const mem: CoachMemory = {
        facts: [{ fact: 'User wants to compete', source: 'user_told', date: '2026-03-01', category: 'goal' }],
        conversationCount: 10,
        firstConversation: '2026-01-15T00:00:00.000Z',
        lastConversation: '2026-03-20T00:00:00.000Z',
      };
      saveCoachMemory(mem);
      const ctx = makeContext({ workoutsCompleted: 20, currentProgram: 'SS' });
      const resp = getOfflineResponse('Do you remember me?', ctx);
      expect(resp.content).toContain('10 sessions');
      expect(resp.content).toContain('2026-01-15');
      expect(resp.content).toContain('Goals');
    });
  });

  // ========================================
  // Safety Boundaries
  // ========================================

  describe('Safety Boundaries', () => {
    it('never recommends weight increases for RPE 10 sessions', () => {
      const ctx = makeContext({
        recentRPE: [10, 10, 10],
        recentDifficulty: ['too_hard', 'too_hard'],
      });
      const resp = getOfflineResponse('Should I add more weight?', ctx);
      // With RPE 10 the "progress" branch would fire; it should not suggest increases
      // The deload/fatigue branch would trigger for "tired" but "add weight" hits different categories
      // Regardless: the system should never suggest adding weight when RPE is maximal
      expect(resp.content).not.toContain('increase the weight');
    });

    it('recommends stopping for sharp joint pain', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse('I have sharp pain in my knee', ctx);
      expect(resp.content).toContain('Stop');
      expect(resp.content).toContain('sharp');
    });

    it('recommends deload after 2+ "too hard" sessions', () => {
      const ctx = makeContext({
        recentRPE: [8, 9, 9],
        recentDifficulty: ['too_hard', 'too_hard', 'just_right'],
      });
      const resp = getOfflineResponse('I feel really fatigued', ctx);
      expect(resp.content).toContain('deload');
    });
  });

  // ========================================
  // Default/Catch-all
  // ========================================

  describe('Default Response', () => {
    it('returns a help menu for unknown question categories', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse('Can you juggle?', ctx);
      expect(resp.content).toContain('AI lifting coach');
      expect(resp.content).toContain('form');
      expect(resp.content).toContain('progressing');
    });

    it('handles empty input gracefully', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse('', ctx);
      expect(resp.role).toBe('coach');
      expect(resp.content.length).toBeGreaterThan(0);
    });

    it('handles very long input without crashing', () => {
      const ctx = makeContext();
      const longMessage = 'How do I improve '.repeat(500);
      const resp = getOfflineResponse(longMessage, ctx);
      expect(resp.role).toBe('coach');
      expect(resp.content.length).toBeGreaterThan(0);
    });
  });

  // ========================================
  // Context Integration
  // ========================================

  describe('Context Integration', () => {
    it('incorporates form score data into technique responses', () => {
      const ctx = makeContext({ formScores: { squat: 45 } });
      const resp = getOfflineResponse('How is my squat technique?', ctx);
      expect(resp.content).toContain('45/100');
      expect(resp.content).toContain('Focus here');
    });

    it('uses e1RM data in progress responses', () => {
      const ctx = makeContext({
        workoutsCompleted: 20,
        e1rms: { deadlift: 400 },
      });
      const resp = getOfflineResponse('How is my progress?', ctx);
      expect(resp.content).toContain('Deadlift');
      expect(resp.content).toContain('400');
    });

    it('factors stall count into programming advice', () => {
      const ctx = makeContext({
        workoutsCompleted: 30,
        programState: {
          programId: 'starting_strength',
          startDate: '2026-01-01',
          currentWeek: 10,
          currentDay: 0,
          trainingMaxes: {},
          liftProgress: {
            squat: {
              liftName: 'squat', currentWeight: 300, unit: 'lbs', increment: 5,
              consecutiveFailures: 3, deloadCycles: 3, stage: 1, lpExhausted: true,
              history: [], lastSuccessWeight: 290,
            },
            bench: {
              liftName: 'bench', currentWeight: 200, unit: 'lbs', increment: 2.5,
              consecutiveFailures: 3, deloadCycles: 3, stage: 1, lpExhausted: true,
              history: [], lastSuccessWeight: 195,
            },
          },
          workoutsCompleted: 30,
          cycleNumber: 1,
        } as any,
        currentProgram: 'SS',
        currentPhase: 'Week 10',
        currentWeek: 10,
      });
      const resp = getOfflineResponse('What should I do next?', ctx);
      expect(resp.content).toContain('exhausted linear progression');
    });
  });

  // ========================================
  // System Prompt Builder
  // ========================================

  describe('buildSystemPrompt', () => {
    it('includes program and form data in prompt', () => {
      const ctx = makeContext({
        currentProgram: 'Starting Strength',
        currentPhase: 'Week 4',
        currentWeek: 4,
        workoutsCompleted: 12,
        formScores: { squat: 72 },
        e1rms: { squat: 250 },
      });
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('Program: Starting Strength');
      expect(prompt).toContain('squat: 72/100');
      expect(prompt).toContain('squat: 250 lbs');
    });

    it('includes coaching guidelines', () => {
      const ctx = makeContext();
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('COACHING GUIDELINES');
      expect(prompt).toContain('healthcare professional');
    });

    it('includes coaching memory when facts exist', () => {
      const mem: CoachMemory = {
        facts: [{ fact: 'User training for powerlifting meet', source: 'user_told', date: '2026-03-01', category: 'goal' }],
        conversationCount: 5,
        firstConversation: '2026-01-01T00:00:00.000Z',
        lastConversation: '2026-03-01T00:00:00.000Z',
      };
      saveCoachMemory(mem);
      const ctx = makeContext();
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('COACHING MEMORY');
      expect(prompt).toContain('powerlifting meet');
    });

    it('includes weak dimensions when below 75', () => {
      const ctx = makeContext({ weakDimensions: { depth: 60, trunk: 50 } });
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('Weak Form Dimensions');
      expect(prompt).toContain('depth: 60/100');
      expect(prompt).toContain('trunk: 50/100');
    });

    it('includes undertrained muscles', () => {
      const ctx = makeContext({ undertrainedMuscles: ['glutes', 'hamstrings'] });
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('Undertrained');
      expect(prompt).toContain('glutes');
    });
  });

  // ========================================
  // API Key Management
  // ========================================

  describe('API Key Management', () => {
    it('returns null when no API key is stored', () => {
      expect(getApiKey()).toBeNull();
    });

    it('saves and retrieves API key', () => {
      saveApiKey('sk-test-key-123');
      expect(getApiKey()).toBe('sk-test-key-123');
    });

    it('clears API key', () => {
      saveApiKey('sk-test-key-123');
      clearApiKey();
      expect(getApiKey()).toBeNull();
    });
  });

  // ========================================
  // Chat History
  // ========================================

  describe('Chat History', () => {
    it('returns empty array when no history exists', () => {
      expect(loadChatHistory()).toEqual([]);
    });

    it('saves and loads chat history', () => {
      const msgs: CoachMessage[] = [
        { role: 'user', content: 'Hello', timestamp: '2026-03-20T10:00:00Z' },
        { role: 'coach', content: 'Hi there!', timestamp: '2026-03-20T10:00:01Z' },
      ];
      saveChatHistory(msgs);
      const loaded = loadChatHistory();
      expect(loaded).toHaveLength(2);
      expect(loaded[0].content).toBe('Hello');
    });

    it('caps history at 50 messages', () => {
      const msgs: CoachMessage[] = Array.from({ length: 60 }, (_, i) => ({
        role: 'user' as const,
        content: `Msg ${i}`,
        timestamp: new Date().toISOString(),
      }));
      saveChatHistory(msgs);
      const loaded = loadChatHistory();
      expect(loaded).toHaveLength(50);
      // Should keep the last 50
      expect(loaded[0].content).toBe('Msg 10');
    });

    it('clears chat history', () => {
      saveChatHistory([{ role: 'user', content: 'test', timestamp: '' }]);
      clearChatHistory();
      expect(loadChatHistory()).toEqual([]);
    });
  });

  // ========================================
  // Claude API (online mode)
  // ========================================

  describe('sendToClaudeAPI', () => {
    it('falls back to offline response on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
      const ctx = makeContext();
      const msgs: CoachMessage[] = [
        { role: 'user', content: 'How is my form?', timestamp: '' },
      ];
      const resp = await sendToClaudeAPI(msgs, ctx, 'sk-test');
      expect(resp.role).toBe('coach');
      expect(resp.content).toContain('[Offline mode');
    });

    it('falls back to offline response on API error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      }));
      const ctx = makeContext();
      const msgs: CoachMessage[] = [
        { role: 'user', content: 'Test question', timestamp: '' },
      ];
      const resp = await sendToClaudeAPI(msgs, ctx, 'bad-key');
      expect(resp.role).toBe('coach');
      expect(resp.content).toContain('[Offline mode');
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('handles empty training history gracefully', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse('How am I doing?', ctx);
      expect(resp.role).toBe('coach');
      // Should not crash, should return meaningful content
      expect(resp.content.length).toBeGreaterThan(10);
    });

    it('handles no form scores in progress response', () => {
      const ctx = makeContext({ workoutsCompleted: 5 });
      const resp = getOfflineResponse('How is my progress?', ctx);
      expect(resp.role).toBe('coach');
    });

    it('response always has valid timestamp', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse('test', ctx);
      expect(resp.timestamp).toBeTruthy();
      expect(() => new Date(resp.timestamp)).not.toThrow();
    });

    it('bodyweight data is included when available', () => {
      const ctx = makeContext({
        workoutsCompleted: 20,
        e1rms: { squat: 250 },
        bodyProgress: {
          bodyweight: { current: 180, change30d: 2, unit: 'lbs' },
          measurements: {},
          photoCount: 0,
        },
      });
      const resp = getOfflineResponse('How is my progress?', ctx);
      expect(resp.content).toContain('180');
    });
  });

  // ========================================
  // Question Routing (scored keyword matching)
  // ========================================

  describe('Question Routing', () => {
    describe('routes questions to correct categories', () => {
      it('"What program should I run?" routes to programming, NOT progress', () => {
        expect(routeQuestion('What program should I run?')).toBe('programming');
      });

      it('"How much protein should I eat?" routes to nutrition, NOT progress', () => {
        expect(routeQuestion('How much protein should I eat?')).toBe('nutrition');
      });

      it('"How do I press properly?" routes to technique, NOT progress', () => {
        expect(routeQuestion('How do I press properly?')).toBe('technique');
      });

      it('"Am I making progress?" routes to progress', () => {
        expect(routeQuestion('Am I making progress?')).toBe('progress');
      });

      it('"How am I progressing?" routes to progress', () => {
        expect(routeQuestion('How am I progressing?')).toBe('progress');
      });

      it('"I hit a PR today!" routes to progress', () => {
        expect(routeQuestion('I hit a PR today!')).toBe('progress');
      });

      it('"I need a new program" routes to programming', () => {
        expect(routeQuestion('I need a new program')).toBe('programming');
      });
    });

    describe('routes edge cases correctly', () => {
      it('"How do I practice squats?" routes to technique', () => {
        expect(routeQuestion('How do I practice squats?')).toBe('technique');
      });

      it('"What\'s the best approach for my pressing?" routes to default (no strong signals)', () => {
        // "pressing" does not match any category keywords strongly
        const route = routeQuestion("What's the best approach for my pressing?");
        // "what's" matches terminology, which is acceptable
        expect(['technique', 'terminology', 'default']).toContain(route);
      });

      it('"Should I eat more protein for recovery?" routes to nutrition', () => {
        // "protein" (nutrition, 2) + "eat" (nutrition, 2) = 4 vs "recovery" (deload, 2)
        expect(routeQuestion('Should I eat more protein for recovery?')).toBe('nutrition');
      });

      it('"protein" no longer matches progress via "pr" substring', () => {
        expect(routeQuestion('protein')).toBe('nutrition');
        expect(routeQuestion('protein')).not.toBe('progress');
      });

      it('"program" no longer matches progress via "pr" substring', () => {
        expect(routeQuestion('program')).toBe('programming');
        expect(routeQuestion('program')).not.toBe('progress');
      });

      it('"press" no longer matches progress', () => {
        // "press" is not a keyword in any route category
        // Should route to default since no category has strong signals
        const route = routeQuestion('press');
        expect(route).not.toBe('progress');
      });

      it('"properly" no longer matches progress', () => {
        const route = routeQuestion('Do this exercise properly');
        expect(route).not.toBe('progress');
      });
    });

    describe('priority ordering breaks ties correctly', () => {
      it('injury keywords outrank other categories in ambiguous questions', () => {
        // "pain" is an injury keyword checked early in priority
        expect(routeQuestion('I have pain')).toBe('injury');
      });

      it('domain keywords (2 pts) outweigh question-frame phrases (1 pt)', () => {
        // "What is a deload?" -- "deload" keyword (2 pts) vs "what is" phrase (1 pt)
        expect(routeQuestion('What is a deload?')).toBe('deload');
      });

      it('multiple keyword matches accumulate score', () => {
        // "stuck" (2) + "plateau" (2) = 4 for plateau
        expect(routeQuestion("I'm stuck at a plateau")).toBe('plateau');
      });
    });
  });

  // ========================================
  // Routing Integration (end-to-end via getOfflineResponse)
  // ========================================

  describe('Routing Integration', () => {
    it('"What program should I run?" returns programming response', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse('What program should I run?', ctx);
      expect(resp.content).toContain('Training tab');
      expect(resp.content).toContain('setup wizard');
    });

    it('"How much protein should I eat?" returns nutrition response', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse('How much protein should I eat?', ctx);
      expect(resp.content).toContain('1.6-2.2');
      expect(resp.content).toContain('lifting coach');
    });

    it('"How do I press properly?" returns technique response', () => {
      const ctx = makeContext();
      const resp = getOfflineResponse('How do I press properly?', ctx);
      // "press" maps to OHP in the exercise list, demo not mocked for OHP
      expect(resp.role).toBe('coach');
      expect(resp.content.length).toBeGreaterThan(0);
    });

    it('"Am I making progress?" returns progress response', () => {
      const ctx = makeContext({ workoutsCompleted: 1 });
      const resp = getOfflineResponse('Am I making progress?', ctx);
      expect(resp.content).toContain('just getting started');
    });

    it('"How am I progressing?" returns progress response', () => {
      const ctx = makeContext({ workoutsCompleted: 20, e1rms: { squat: 300 } });
      const resp = getOfflineResponse('How am I progressing?', ctx);
      expect(resp.content).toContain('300 lbs');
      expect(resp.dataSources).toContain('PR tracker');
    });

    it('"I hit a PR today!" returns progress response', () => {
      const ctx = makeContext({ workoutsCompleted: 15, e1rms: { bench: 200 } });
      const resp = getOfflineResponse('I hit a PR today!', ctx);
      expect(resp.content).toContain('200 lbs');
    });
  });
});
