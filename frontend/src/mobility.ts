/**
 * Mobility assessment and warm-up protocol generation.
 * Extracted from analyzer.ts. Supports experience-level-based detail filtering.
 */

import type {
  ExperienceLevel,
  FormIssue,
  MobilityFinding,
  WarmUpStep,
} from './types';

// ─── Mobility Assessment Database (matched to backend) ───

/** Extended mobility finding with experience-level metadata. */
interface MobilityEntry extends MobilityFinding {
  /** Abbreviated description for advanced users. */
  briefLimitation: string;
  /** Whether this is a basic finding that advanced users can skip. */
  basic: boolean;
}

const MOBILITY_DATABASE: Record<string, MobilityEntry> = {
  heel_rise: {
    area: 'Ankles',
    limitation: 'Your ankles are not flexible enough, which causes your heels to lift when you squat down. You need about 15-20 degrees of ankle bend (dorsiflexion) for a full squat.',
    briefLimitation: 'Ankle dorsiflexion deficit -- heels lifting.',
    basic: false,
    test: 'Wall Ankle Test: Face a wall, place one foot 5 inches away. Can you touch your knee to the wall without lifting your heel? You need 15-20 degrees of dorsiflexion.',
    stretches: [
      'Wall ankle stretches: 3x30 sec each side',
      'Banded ankle distraction: 2x60 sec each side',
      'Calf foam rolling: 2 min each leg',
    ],
    frequency: 'Daily, especially before squatting',
  },
  butt_wink: {
    area: 'Hips',
    limitation: 'Your hips are tight, which causes your lower back to round at the bottom of the squat. This usually means your hip joints need more flexibility or your hip bone structure limits your depth.',
    briefLimitation: 'Hip IR deficit causing posterior pelvic tilt at depth.',
    basic: false,
    test: 'Deep Squat Hold: Can you hold the bottom of a squat for 30 seconds with a flat back? If your lower back rounds, your hip mobility is limiting your depth.',
    stretches: [
      '90/90 hip stretch: 3x30 sec each side',
      'Pigeon pose: 2x45 sec each side',
      'Goblet squat hold with elbows pushing knees out: 3x15 sec',
    ],
    frequency: '3-4 times per week, plus pre-squat warm-up',
  },
  excessive_forward_lean: {
    area: 'Ankles & Upper Back',
    limitation: 'Tight ankles and a stiff upper back are forcing you to lean too far forward when you squat. Improving flexibility in both areas will help you stay more upright.',
    briefLimitation: 'Ankle + T-spine deficit causing excessive forward lean.',
    basic: false,
    test: 'Overhead Squat Test: Hold a broomstick overhead and squat. If the stick moves forward or you lean excessively, your thoracic mobility needs work.',
    stretches: [
      'Wall ankle stretches: 3x30 sec each side',
      'Thoracic spine foam rolling: 2 min',
      'Cat-cow stretches: 2x10 reps',
      'Doorway chest stretch: 2x30 sec',
    ],
    frequency: 'Daily for ankle work, 3x/week for thoracic',
  },
  knee_valgus: {
    area: 'Hip Abductors',
    limitation: 'Weak glute medius and hip external rotators are allowing your knees to collapse inward.',
    briefLimitation: 'Glute med weakness -- knee valgus.',
    basic: true,
    test: 'Single-Leg Squat Test: Stand on one leg and squat down. Does your knee dive inward? If so, your hip abductors need strengthening.',
    stretches: [
      'Clamshells with band: 3x15 each side',
      'Monster walks: 3x10 each direction',
      'Side-lying hip abduction: 3x12 each side',
    ],
    frequency: 'Include in every leg day warm-up',
  },
  good_morning: {
    area: 'Core & Quadriceps',
    limitation: 'Weak quads or poor core bracing is causing your hips to rise faster than your shoulders.',
    briefLimitation: 'Quad/core weakness -- good morning pattern.',
    basic: true,
    test: 'Front Squat Test: Can you front squat with an upright torso? If your hips shoot up first, your quads are the weak link.',
    stretches: [
      'Front squats: 3x8 (builds quad-dominant pattern)',
      'Dead bugs: 3x10 each side (core stability)',
      'Leg press: 3x10 (quad strengthening)',
    ],
    frequency: 'Include quad-dominant work 2-3x/week',
  },

  // ─── Deadlift Mobility ───

  rounded_back: {
    area: 'Thoracic Spine & Lats',
    limitation: 'A thoracic extension deficit and tight lats are preventing you from maintaining a neutral spine during the deadlift. When your upper back can\'t extend properly, your lower back compensates by rounding.',
    briefLimitation: 'T-spine extension deficit + lat tightness -- back rounding under load.',
    basic: false,
    test: 'Cat-Cow Test: Get on all fours and arch your upper back as much as possible (cow), then round it (cat). If you can\'t create a noticeable arch in your upper back during the cow portion, your thoracic extension is limited.',
    stretches: [
      'Thoracic spine foam rolling: 2 min (focus on upper back)',
      'Cat-cow stretches: 3x10 reps (emphasize the extension)',
      'Lat stretch on rack or doorframe: 3x30 sec each side',
    ],
    frequency: 'Daily, especially before deadlifting',
  },

  // ─── Bench Press Mobility ───

  uneven_press: {
    area: 'Shoulder Stabilizers',
    limitation: 'Shoulder mobility asymmetry is causing one arm to press differently than the other. This is often due to one shoulder being tighter or less stable, leading to uneven bar path and increased injury risk.',
    briefLimitation: 'Shoulder mobility asymmetry -- uneven pressing pattern.',
    basic: false,
    test: 'Wall Slide Test: Stand with your back against a wall and slide your arms up overhead. If one arm lifts off the wall sooner or can\'t reach as high, that side has a mobility deficit.',
    stretches: [
      'Doorway chest stretch: 3x30 sec each side (compare sides)',
      'Sleeper stretch: 2x30 sec each side (internal rotation)',
      'Band pull-aparts: 3x15 (shoulder stability)',
    ],
    frequency: '3-4 times per week, plus pre-bench warm-up',
  },
};

/**
 * Adapt a MobilityEntry to a MobilityFinding based on experience level.
 *
 * - Beginner: Full descriptions, all self-tests, frequency recommendations
 * - Intermediate: Standard descriptions, self-tests, standard frequency
 * - Advanced: Brief descriptions, skip self-tests for basic items, minimal frequency
 */
function adaptFinding(entry: MobilityEntry, level: ExperienceLevel): MobilityFinding {
  if (level === 'advanced') {
    return {
      area: entry.area,
      limitation: entry.briefLimitation,
      test: entry.basic ? '' : entry.test,
      stretches: entry.stretches.slice(0, 2), // Top 2 most impactful
      frequency: entry.frequency,
    };
  }

  if (level === 'intermediate') {
    return {
      area: entry.area,
      limitation: entry.limitation,
      test: entry.test,
      stretches: entry.stretches,
      frequency: entry.frequency,
    };
  }

  // Beginner: full detail
  return {
    area: entry.area,
    limitation: entry.limitation,
    test: entry.test,
    stretches: entry.stretches,
    frequency: entry.frequency,
  };
}

/**
 * Assess mobility limitations based on detected form issues.
 * Detail level adjusts based on experience level:
 * - Advanced: skips basic findings, uses abbreviated descriptions
 * - Intermediate/Beginner: full detail
 */
export function assessMobility(issues: FormIssue[], experienceLevel: ExperienceLevel = 'beginner'): MobilityFinding[] {
  const findings: MobilityFinding[] = [];
  const seenAreas = new Set<string>();

  for (const issue of issues) {
    const entry = MOBILITY_DATABASE[issue.name];
    if (!entry || seenAreas.has(entry.area)) continue;

    // Advanced users skip basic findings unless they are high severity
    if (experienceLevel === 'advanced' && entry.basic && issue.severity !== 'high') {
      continue;
    }

    findings.push(adaptFinding(entry, experienceLevel));
    seenAreas.add(entry.area);
  }

  return findings;
}

// ─── Warm-Up Protocol ───

const BASE_WARMUP_FULL: WarmUpStep[] = [
  {
    name: 'General Warm-Up',
    description: '5 minutes of light cardio: walking, cycling, or jumping jacks to raise your heart rate and body temperature.',
    duration: '5 min',
    purpose: 'Increase blood flow and prepare your body for movement',
  },
  {
    name: 'Hip Circles',
    description: 'Stand on one leg and make 10 large circles with the other leg in each direction. Switch sides.',
    duration: '2 min',
    purpose: 'Mobilize the hip joint through its full range of motion',
  },
  {
    name: 'Bodyweight Squats',
    description: 'Perform 10-15 slow, controlled bodyweight squats focusing on form. Pause at the bottom of each rep.',
    duration: '2 min',
    purpose: 'Pattern the squat movement and identify any stiffness',
  },
];

/** Abbreviated base warm-up for advanced users. */
const BASE_WARMUP_BRIEF: WarmUpStep[] = [
  {
    name: 'General Warm-Up',
    description: '3-5 min light cardio to raise body temperature.',
    duration: '3-5 min',
    purpose: 'Increase blood flow',
  },
  {
    name: 'Dynamic Prep',
    description: 'Hip circles, leg swings, bodyweight squats (5-8 reps).',
    duration: '3 min',
    purpose: 'Movement preparation',
  },
];

const ISSUE_WARMUP: Record<string, WarmUpStep> = {
  heel_rise: {
    name: 'Ankle Mobilization',
    description: 'Wall ankle stretches: place your foot 5 inches from a wall and drive your knee forward while keeping your heel down. 10 reps each side.',
    duration: '2 min',
    purpose: 'Improve ankle dorsiflexion for better squat depth',
  },
  butt_wink: {
    name: 'Hip Opener',
    description: '90/90 hip stretch: sit with one leg bent 90 degrees in front, the other behind. Lean forward gently. Hold 30 seconds each side.',
    duration: '2 min',
    purpose: 'Open up hip internal and external rotation',
  },
  knee_valgus: {
    name: 'Glute Activation',
    description: 'Banded clamshells: lie on your side with a band above your knees. Open your top knee 15 times each side, squeezing the glute.',
    duration: '2 min',
    purpose: 'Activate the glute medius to prevent knee caving',
  },
  excessive_forward_lean: {
    name: 'Thoracic Spine Mobilization',
    description: 'Foam roll your upper back for 10 passes, then do 10 cat-cow stretches focusing on arching your upper back.',
    duration: '3 min',
    purpose: 'Improve upper back extension for a more upright squat',
  },
  good_morning: {
    name: 'Core Activation',
    description: 'Dead bugs: lie on your back, extend opposite arm and leg while keeping your lower back pressed into the floor. 8 reps each side.',
    duration: '2 min',
    purpose: 'Activate deep core muscles for trunk stability',
  },
};

/** Abbreviated issue-specific warm-ups for advanced users. */
const ISSUE_WARMUP_BRIEF: Record<string, WarmUpStep> = {
  heel_rise: {
    name: 'Ankle Mob',
    description: 'Wall ankle drives: 10 reps each side.',
    duration: '1 min',
    purpose: 'Ankle dorsiflexion',
  },
  butt_wink: {
    name: 'Hip Opener',
    description: '90/90 stretch: 20 sec each side.',
    duration: '1 min',
    purpose: 'Hip rotation',
  },
  knee_valgus: {
    name: 'Glute Activation',
    description: 'Banded clamshells: 10 each side.',
    duration: '1 min',
    purpose: 'Glute med activation',
  },
  excessive_forward_lean: {
    name: 'T-Spine Mob',
    description: 'Foam roll upper back 8 passes, cat-cow x8.',
    duration: '2 min',
    purpose: 'Thoracic extension',
  },
  good_morning: {
    name: 'Core Activation',
    description: 'Dead bugs: 6 reps each side.',
    duration: '1 min',
    purpose: 'Core stability',
  },
};

/**
 * Generate a warm-up protocol based on detected issues.
 * Detail level adjusts based on experience level:
 * - Beginner: Full descriptions with all base steps and issue-specific additions
 * - Intermediate: Same structure, standard detail
 * - Advanced: Abbreviated base warm-up, condensed issue-specific steps
 */
export function generateWarmupProtocol(issues: FormIssue[], experienceLevel: ExperienceLevel = 'beginner'): WarmUpStep[] {
  const isAdvanced = experienceLevel === 'advanced';
  const baseWarmup = isAdvanced ? BASE_WARMUP_BRIEF : BASE_WARMUP_FULL;
  const issueWarmup = isAdvanced ? ISSUE_WARMUP_BRIEF : ISSUE_WARMUP;

  const protocol = [...baseWarmup];
  const seenNames = new Set(protocol.map(s => s.name));

  for (const issue of issues) {
    const step = issueWarmup[issue.name];
    if (step && !seenNames.has(step.name)) {
      protocol.push(step);
      seenNames.add(step.name);
    }
  }

  return protocol;
}
