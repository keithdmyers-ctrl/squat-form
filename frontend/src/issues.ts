/**
 * Issue detection and coaching cue generation.
 * Extracted from analyzer.ts — no behavior changes.
 */

import {
  SquatType,
  SquatPhase,
  IssueSeverity,
} from './types';
import type {
  SquatConfig,
  CalibrationData,
  FormIssue,
  CoachingCue,
  RepData,
} from './types';
import {
  DEPTH_THRESHOLDS,
  ANGLE_TOLERANCES,
  VALGUS_THRESHOLDS,
  IDEAL_DESCENT_MIN,
  IDEAL_DESCENT_MAX,
} from './scorer';
import { getTrunkAngleRange } from './calibration';

// ─── Coaching Cue Database (synced with backend feedback.py — plain English, no jargon) ───
export interface CueEntry {
  cue: string;
  alternateCues?: string[];      // 2-3 alternate phrasings
  priority: number;
  explanation: string;           // default (moderate)
  explanationLow?: string;       // mild version
  explanationHigh?: string;      // urgent version
}

export const CUE_DATABASE: Record<string, CueEntry> = {
  knee_valgus: {
    cue: 'Spread the floor with your feet',
    alternateCues: ['Screw your feet into the ground', 'Push your knees out over your pinky toes'],
    priority: 1,
    explanation:
      'Your knees are collapsing inward (medial knee displacement), which increases ACL and meniscus stress (Hewett et al. 2005, Am J Sports Med). This usually means the gluteus medius and hip external rotators need strengthening. Try squatting with a resistance band around your knees, add clamshell exercises and lateral band walks to your warmup, or try a slightly wider stance. Note: some minor inward knee movement during maximal effort is normal — this is flagged because the amount detected is beyond that normal range.',
    explanationLow:
      'Minor inward knee movement detected. This is worth monitoring but not urgent — add some glute activation to your warm-up.',
    explanationHigh:
      'Significant knee collapse detected. Research shows this level of valgus substantially increases injury risk (Hewett et al. 2005). Reduce the weight and focus on glute strengthening before progressing.',
  },
  butt_wink: {
    cue: 'Squat to the box and reverse',
    alternateCues: ['Brace your core hard before descending', 'Stop one inch higher than where your back rounds'],
    priority: 2,
    explanation:
      'At the bottom of your squat, your hips tuck under (posterior pelvic tilt) and your lower back rounds. Under load, this shifts stress from the muscles to the spinal discs and ligaments (McGill 2010, "Ultimate Back Fitness and Performance"). It usually means your hip flexibility — or even your hip bone structure (acetabular depth/orientation) — is limiting your depth. Try squatting to a box at a depth where your lower back stays flat. Note: some hip movement at the bottom is normal and expected. Not everyone can achieve a deep squat with a neutral spine due to individual anatomy, and that is OK.',
    explanationLow:
      'Slight pelvic tuck at the bottom. At this level it\'s mostly cosmetic — keep an eye on it.',
    explanationHigh:
      'Pronounced lower back rounding at the bottom. Under heavier loads this becomes a concern for disc health. Limit your depth to where your back stays neutral.',
  },
  excessive_forward_lean: {
    cue: 'Drive the bar straight up toward the ceiling',
    alternateCues: ['Chest up \u2014 lead with your sternum', 'Imagine a string pulling your chest to the ceiling'],
    priority: 3,
    explanation:
      'Your upper body is leaning too far forward. This shifts the load from your quadriceps to your lumbar extensors (Fry et al. 2003, J Strength Cond Res). Common causes: limited ankle dorsiflexion, long femurs relative to torso, or quadriceps weakness. Try goblet squats to practice a more upright position, or try shoes with a raised heel (weightlifting shoes). Note: for low-bar back squats, more forward lean is normal and expected due to bar position.',
    explanationLow:
      'Slightly more forward lean than ideal, but within a workable range. Focus on ankle mobility over time.',
    explanationHigh:
      'Your torso is tipping very far forward, shifting most of the load to your lower back. Reduce weight or switch to a more upright squat variation.',
  },
  good_morning: {
    cue: 'Push the ground away as you stand',
    alternateCues: ['Lead with your chest on the way up', 'Imagine a string pulling your sternum to the ceiling as you stand'],
    priority: 3,
    explanation:
      'Your hips are shooting up before your shoulders on the way up, turning the squat into a hip-dominant "good morning" pattern. This shifts load to the lumbar spine and indicates the quadriceps are the weak link (Swinton et al. 2012, J Strength Cond Res). This often happens with fatigue or excessive weight. The most effective fix is to reduce the weight until your shoulders and hips rise at the same rate, and add front squats or leg press to build quad strength.',
    explanationLow:
      'Your hips rose slightly faster than your shoulders. Minor, but worth cueing.',
    explanationHigh:
      'Your squat is turning into a good morning — hips shoot up while the bar stays low. This is a strong signal to reduce the weight.',
  },
  heel_rise: {
    cue: 'Push your whole foot into the floor -- feel even pressure from heel to toe',
    alternateCues: ['Grip the floor with your toes', 'Drive through your whole foot evenly'],
    priority: 4,
    explanation:
      'Heels lifting usually means limited ankle dorsiflexion. Research shows you need about 15-20 degrees of ankle dorsiflexion past neutral for a full-depth squat (Kasuyama et al. 2009, J Phys Ther Sci). Try ankle mobility stretches before squatting, use heel-elevated shoes or small plates under your heels, or try a slightly wider stance with more toe-out.',
    explanationLow:
      'Slight heel lift detected. Try ankle mobility stretches before your next session.',
    explanationHigh:
      'Heels are coming up significantly. Use heel-elevated shoes or plates under your heels until ankle mobility improves.',
  },
  insufficient_depth: {
    cue: 'Aim for your hip crease to reach knee level',
    alternateCues: ['Sit down between your legs, not behind them', 'Pretend there\'s a low chair behind you'],
    priority: 5,
    explanation:
      'You\'re not squatting deep enough to get the full benefit. The goal is to get your hip crease to at least knee level (parallel). If you can\'t get there, it\'s usually an ankle or hip flexibility issue. Try goblet squats to a low box or bench to practice the depth, and add ankle mobility stretches and hip-opening exercises between sessions.',
    explanationLow:
      'You\'re close to target depth — just a couple more inches.',
    explanationHigh:
      'Depth is well above target. Focus on hip and ankle mobility to improve your range of motion gradually.',
  },
  fast_descent: {
    cue: 'Slow down -- aim for a 2-3 second descent',
    alternateCues: ['Count \'one-Mississippi, two-Mississippi\' on the way down', 'Think of lowering yourself, not dropping'],
    priority: 6,
    explanation:
      'Your descent is too fast, which makes it harder to maintain form and control. Aim for a smooth 2-3 second descent where you feel in control the whole way down. Try counting \'one-Mississippi, two-Mississippi\' as you lower.',
    explanationLow:
      'Descent was a bit quick. Try counting to two on the way down.',
    explanationHigh:
      'Very fast, uncontrolled descent. This makes it hard to maintain form and increases injury risk. Slow down deliberately.',
  },
  slow_descent: {
    cue: 'Your descent is very slow -- a bit more speed is fine',
    alternateCues: ['Let gravity help a little — don\'t fight it the whole way', 'Smooth and steady, not slow-motion'],
    priority: 7,
    explanation:
      'While control is great, going too slow can tire you out before your muscles get a full workout. A steady 2-3 second descent is the sweet spot.',
    explanationLow:
      'Descent was a touch slow. Not a big deal, but a slightly faster tempo may feel more natural.',
    explanationHigh:
      'Very slow descent — you\'re burning energy before the hard part of the lift. Speed up to 2-3 seconds down.',
  },
  bouncing: {
    cue: 'Pause for a half-second at the bottom before standing',
    alternateCues: ['Own the bottom position \u2014 no free ride up', 'Pause and feel the tension before reversing'],
    priority: 5,
    explanation:
      'You\'re using momentum to bounce out of the bottom instead of muscle strength. This puts extra stress on your knee and hip joints. Try pausing for a half-second at the bottom before pushing back up. This builds strength in the hardest part of the squat.',
    explanationLow:
      'Brief pause at the bottom. Try holding for a half-second to build bottom-position strength.',
    explanationHigh:
      'Hard bounce out of the bottom. This puts significant stress on your knees. Practice pause squats to build control.',
  },
  incomplete_lockout: {
    cue: 'Stand tall at the top of each rep',
    alternateCues: ['Finish the rep \u2014 squeeze your glutes hard at the top', 'Stand all the way up before starting the next rep'],
    priority: 5,
    explanation:
      'You\'re not fully standing up between reps. Finishing each rep completely builds better habits and full-range strength. Focus on standing all the way up before starting the next rep.',
    explanationLow:
      'Almost fully locked out — squeeze your glutes a bit harder at the top.',
    explanationHigh:
      'Not standing up fully between reps. This shortchanges your range of motion and can become a habit.',
  },
  asymmetric_hips: {
    cue: 'Push the ground away evenly on both sides',
    alternateCues: ['Feel equal pressure on both feet', 'Drive your weaker side harder'],
    priority: 4,
    explanation:
      'You\'re putting more weight on one side than the other, which can lead to uneven wear on your joints over time. This often comes from a strength or mobility difference between sides. Try single-leg exercises like split squats to build equal strength on both sides.',
    explanationLow:
      'Slight side-to-side imbalance detected. Single-leg work can help even this out over time.',
    explanationHigh:
      'Noticeable weight shift to one side. This can lead to overuse injuries. Prioritize single-leg exercises.',
  },
  asymmetric_shift: {
    cue: 'Push the ground away evenly on both sides',
    alternateCues: ['Feel equal pressure on both feet', 'Drive harder through your weaker side'],
    priority: 4,
    explanation:
      'You\'re putting more weight on one side than the other, which can lead to uneven wear on your joints over time. This often comes from a strength or mobility difference between sides. Try single-leg exercises like split squats to build equal strength on both sides. If the shift persists, focus on driving harder through the weaker side.',
    explanationLow:
      'Slight side-to-side imbalance detected. Single-leg work can help even this out over time.',
    explanationHigh:
      'Noticeable weight shift to one side. This can lead to overuse injuries. Prioritize single-leg exercises.',
  },
  trunk_angle_increase_on_ascent: {
    cue: 'Push the ground away as you stand',
    alternateCues: ['Chest up as you drive out of the hole', 'Lead with your shoulders, not your hips'],
    priority: 3,
    explanation:
      'If your torso tips forward as you stand up, your back is taking over. Focus on pushing the ground away from you while keeping your upper body steady.',
    explanationLow:
      'Slight forward tip on the way up. Focus on keeping your chest angle constant as you stand.',
    explanationHigh:
      'Your torso is pitching forward significantly on the ascent. Reduce the weight and focus on keeping your chest up throughout the lift.',
  },
  excessive_forward_knee_travel: {
    cue: 'Sit your hips back toward the wall behind you',
    alternateCues: ['Break at the hips first, then the knees', 'Think hips back, not knees forward'],
    priority: 4,
    explanation:
      'Your knees are traveling very far forward. While some forward knee travel is normal (especially for high-bar and front squats), too much in a low-bar squat can shift stress to your knees. Try sitting back slightly more or using a wider stance.',
    explanationLow:
      'Knees drifted a bit far forward. Try initiating the descent by pushing your hips back first.',
    explanationHigh:
      'Knees are well past your toes, shifting load away from your hips and onto your knees. Sit back more and consider a wider stance.',
  },

  // ─── Deadlift Issues ───

  rounded_back: {
    cue: 'Brace hard and pull the slack out of the bar before you lift',
    alternateCues: ['Proud chest — show the logo on your shirt', 'Big breath, tight core, then pull'],
    priority: 1,
    explanation:
      'Spinal flexion under load increases shear forces on the intervertebral discs and stress on the posterior ligaments (McGill 2010). A neutral spine distributes compressive force safely through the vertebral bodies. Before every pull, take a big breath into your belly (Valsalva maneuver increases intra-abdominal pressure and spinal stability), brace your core, and pull your chest up into a "proud chest" position. If you can\'t maintain a flat back, the weight is too heavy.',
    explanationLow:
      'Slight upper back rounding detected. Focus on pulling your chest up before you start the pull.',
    explanationHigh:
      'Significant spinal rounding under load. This is a serious injury risk. Reduce the weight until you can maintain a flat back throughout the pull.',
  },
  hip_shoot: {
    cue: 'Push the floor away — hips and shoulders rise together',
    alternateCues: ['Leg press the floor before your back takes over', 'Shoulders and hips rise at the same speed'],
    priority: 2,
    explanation:
      'Your hips are rising first, which turns the deadlift into a stiff-leg variation and shifts all the load to your lower back. The hips and shoulders should rise at the same rate off the floor. Think about pushing the floor away with your legs rather than lifting the bar with your back.',
    explanationLow:
      'Hips rose slightly ahead of your shoulders. Focus on driving with your legs off the floor.',
    explanationHigh:
      'Hips shot up well before your shoulders, turning this into a stiff-leg pull. Reduce the weight and practice keeping your chest up off the floor.',
  },
  hitching: {
    cue: 'One smooth pull from floor to lockout',
    alternateCues: ['Drive your hips through without stopping', 'Keep the bar moving — no resting on your thighs'],
    priority: 3,
    explanation:
      'Hitching — where the bar stops or reverses during the pull — is a disqualification in competition and a sign that the weight is too heavy or your grip is failing. The pull should be one continuous motion from floor to lockout. Reduce the weight and practice smooth pulls, and add grip work like farmer\'s walks if grip is the limiting factor.',
    explanationLow:
      'Brief stall near lockout. Practice driving your hips through to finish the pull in one motion.',
    explanationHigh:
      'The bar stopped and you had to re-pull or hitch it up your thighs. This is a red card in competition and a sign the weight is too heavy.',
  },
  insufficient_rom_deadlift: {
    cue: 'Hinge deeper — push your hips back further',
    alternateCues: ['Reach the bar closer to the floor', 'Push your hips back like you\'re closing a car door'],
    priority: 5,
    explanation:
      'You\'re not hinging deep enough to get the full benefit of the deadlift. For conventional deadlifts, the bar should start from the floor. For Romanian deadlifts, lower until you feel a strong hamstring stretch. Push your hips back rather than bending your knees to reach deeper.',
    explanationLow:
      'Slightly short range of motion. Try pushing your hips back a bit further each set.',
    explanationHigh:
      'Very limited range of motion — you\'re missing most of the benefit of the exercise. Work on hamstring flexibility and practice hinging with a light weight.',
  },
  asymmetric_pull: {
    cue: 'Drive evenly through both feet',
    alternateCues: ['Check your hand spacing — even grip, even pull', 'Feel equal pressure on both feet throughout the pull'],
    priority: 4,
    explanation:
      'One side is working harder than the other during the pull, which can lead to injury over time and reinforces strength imbalances. Check that your hands are evenly spaced on the bar and that you\'re driving evenly through both feet. Add single-leg Romanian deadlifts and single-leg work to build balanced strength.',
    explanationLow:
      'Slight imbalance between sides during the pull. Add single-leg Romanian deadlifts to your routine.',
    explanationHigh:
      'Significant asymmetry in your pull — one side is doing much more work. Check hand spacing and add single-leg work to correct the imbalance.',
  },
  fast_descent_deadlift: {
    cue: 'Control the bar down — don\'t just drop it',
    alternateCues: ['Reverse the pull — hips back, then bend the knees', 'Lower it like you\'re setting it on glass'],
    priority: 6,
    explanation:
      'Dropping the bar without controlling the eccentric phase misses half the strength-building potential of the exercise and can be dangerous to you and others in the gym. Lower the bar under control in 1-2 seconds, reversing the pulling motion. The eccentric phase builds muscle and reinforces proper movement patterns.',
    explanationLow:
      'The bar came down a bit fast. Try a controlled 1-2 second lowering phase.',
    explanationHigh:
      'The bar was essentially dropped. You\'re missing half the strength benefit and risking injury. Lower under control every rep.',
  },

  // ─── Bench Press Issues ───

  no_pause: {
    cue: 'Touch and hold — wait for the press command',
    alternateCues: ['Sink it into your chest and pause', 'Dead stop on the chest before you press'],
    priority: 2,
    explanation:
      'In IPF/USAPL competition, the bar must be held motionless on the chest until the head judge gives the "press" command (IPF Technical Rules 2024, Section B.1). Even in training, pausing on the chest eliminates the stretch-shortening cycle and builds concentric-only strength at the most challenging point of the lift (Kompf & Arandjelovic 2016, Sports Med). Practice 1-2 second pauses to build raw pressing strength.',
    explanationLow:
      'Very brief chest contact. Try holding for a full one-count before pressing.',
    explanationHigh:
      'The bar bounced off your chest with no pause. This would be a red light in competition and reduces strength development off the chest.',
  },
  uneven_press: {
    cue: 'Press both hands at the same speed',
    alternateCues: ['Keep the bar level — drive evenly with both arms', 'Focus on your weaker arm matching the stronger one'],
    priority: 3,
    explanation:
      'One arm is pressing faster than the other, causing the bar to tilt. This puts your shoulders at risk for injury because the lagging side is being loaded unevenly. A tilted bar also makes the lift harder and can cause you to miss a rep. Add dumbbell bench pressing to identify and fix the imbalance.',
    explanationLow:
      'Slight bar tilt during the press. Add some dumbbell work to balance out the sides.',
    explanationHigh:
      'The bar is tilting significantly — one arm is doing much more work. Switch to dumbbells for a training cycle to fix the imbalance before it causes a shoulder issue.',
  },
  press_stall: {
    cue: 'Drive through the sticking point — don\'t let the bar stop',
    alternateCues: ['Explode off the chest — maximum speed from the start', 'Think speed, not just strength, off the bottom'],
    priority: 4,
    explanation:
      'The bar stalled about 2-3 inches off your chest, which is the most common sticking point in the bench press (van den Tillaar & Ettema 2010, J Sports Sci). This is where the pectoralis major transitions primary responsibility to the triceps and anterior deltoid. Build strength at this point with Spoto press (pause 1 inch off the chest) and pin press (press from pins set at the sticking point).',
    explanationLow:
      'Brief slowdown at the mid-range. Add some Spoto press work to build speed through this zone.',
    explanationHigh:
      'The bar stalled hard at the sticking point. This is a strength gap between your pecs and triceps. Add pin press and Spoto press as accessories.',
  },
};

// ─── Issue Detection ───

export function detectRepIssues(
  rep: RepData,
  config: SquatConfig,
  calibration: CalibrationData | null,
): FormIssue[] {
  const issues: FormIssue[] = [];
  const tolerance = ANGLE_TOLERANCES[config.experienceLevel];

  // 1. Depth check
  const depthThreshold = DEPTH_THRESHOLDS[config.experienceLevel];
  if (rep.minKneeAngle > depthThreshold) {
    issues.push({
      name: 'insufficient_depth',
      severity: rep.minKneeAngle > depthThreshold + 20 ? IssueSeverity.MODERATE : IssueSeverity.LOW,
      description: rep.minKneeAngle > depthThreshold + 20
        ? 'You stopped well above the target depth — try to get lower gradually'
        : rep.minKneeAngle > depthThreshold + 10
          ? 'Almost there — just a few more inches deeper'
          : 'Just barely above target depth — you\'re very close!',
      value: rep.minKneeAngle,
      threshold: depthThreshold,
      phase: SquatPhase.BOTTOM,
      frame: rep.bottomFrame,
    });
  }

  // 2. Knee valgus (graduated severity based on degree)
  if (rep.kneeValgus) {
    const valgusThreshold = VALGUS_THRESHOLDS[config.experienceLevel];
    // Find worst knee width ratio to determine severity
    let worstRatio = 1.0;
    for (const fa of rep.frameAngles) {
      if (fa.kneeWidthRatio !== null && fa.kneeWidthRatio < worstRatio) {
        worstRatio = fa.kneeWidthRatio;
      }
    }
    const valgusDistance = valgusThreshold - worstRatio;
    const valgusSeverity = valgusDistance > 0.15
      ? IssueSeverity.HIGH
      : valgusDistance > 0.05
        ? IssueSeverity.MODERATE
        : IssueSeverity.LOW;
    issues.push({
      name: 'knee_valgus',
      severity: valgusSeverity,
      description: 'Knees collapsed inward during the rep',
      value: worstRatio,
      threshold: valgusThreshold,
      phase: SquatPhase.ASCENDING,
      frame: rep.bottomFrame,
    });
  }

  // 3. Trunk angle
  const [, maxTrunkExpected] = getTrunkAngleRange(config.squatType, calibration);
  if (rep.maxTrunkAngle > maxTrunkExpected + tolerance) {
    issues.push({
      name: 'excessive_forward_lean',
      severity:
        rep.maxTrunkAngle > maxTrunkExpected + tolerance * 3
          ? IssueSeverity.HIGH
          : IssueSeverity.MODERATE,
      description: 'You leaned forward more than ideal for this squat style',
      value: rep.maxTrunkAngle,
      threshold: maxTrunkExpected + tolerance,
      phase: SquatPhase.BOTTOM,
      frame: rep.bottomFrame,
    });
  }

  // 4. Good morning pattern (threshold is higher for low-bar squats)
  // Research: >15° trunk angle increase on ascent = significant form breakdown
  const goodMorningThreshold = config.squatType === SquatType.LOW_BAR ? 20 : 15;
  if (rep.trunkAngleChangeOnAscent > goodMorningThreshold) {
    const gmSeverity = rep.trunkAngleChangeOnAscent > goodMorningThreshold + 15
      ? IssueSeverity.HIGH : IssueSeverity.MODERATE;
    issues.push({
      name: 'good_morning',
      severity: gmSeverity,
      description: 'Your hips shot up before your shoulders on the way up',
      value: rep.trunkAngleChangeOnAscent,
      threshold: goodMorningThreshold,
      phase: SquatPhase.ASCENDING,
      frame: rep.bottomFrame,
    });
  }

  // 5. Butt wink
  if (rep.buttWink) {
    issues.push({
      name: 'butt_wink',
      severity: IssueSeverity.MODERATE,
      description: 'Pelvis tucked under at the bottom position',
      value: rep.pelvicTiltAtBottom,
      threshold: 8,
      phase: SquatPhase.BOTTOM,
      frame: rep.bottomFrame,
    });
  }

  // 6. Heel rise
  if (rep.heelRise) {
    issues.push({
      name: 'heel_rise',
      severity: IssueSeverity.MODERATE,
      description: 'Heels lifted off the ground during descent',
      value: 1,
      threshold: 0,
      phase: SquatPhase.DESCENDING,
      frame: rep.bottomFrame,
    });
  }

  // 7. Tempo
  const FAST_DESCENT_THRESHOLD = 1.2;
  if (rep.descentDuration < FAST_DESCENT_THRESHOLD) {
    issues.push({
      name: 'fast_descent',
      severity: IssueSeverity.LOW,
      description: `Descent was ${rep.descentDuration.toFixed(1)}s (aim for ${IDEAL_DESCENT_MIN}-${IDEAL_DESCENT_MAX}s)`,
      value: rep.descentDuration,
      threshold: IDEAL_DESCENT_MIN,
      phase: SquatPhase.DESCENDING,
      frame: rep.startFrame,
    });
  }

  // 8. Lockout
  const lastAngles = rep.frameAngles.slice(-5);
  const maxLockout =
    lastAngles.length > 0 ? Math.max(...lastAngles.map((fa) => fa.kneeAngle)) : 0;
  if (maxLockout < 160) {
    issues.push({
      name: 'incomplete_lockout',
      severity: IssueSeverity.LOW,
      description: 'Didn\'t fully straighten up at the top — squeeze your glutes to finish each rep',
      value: maxLockout,
      threshold: 160,
      phase: SquatPhase.STANDING,
      frame: rep.endFrame,
    });
  }

  // 9. Bouncing at bottom
  // Advanced lifters intentionally use the stretch reflex in training (Wilson et al. 1991,
  // Int J Sports Med) — only flag if in competition mode where a pause may be required,
  // or for beginner/intermediate lifters who lack the motor control to bounce safely.
  if (rep.bottomDuration < 0.10) {
    if (config.experienceLevel === 'advanced' && !config.competitionMode) {
      // Don't penalize advanced lifters using stretch reflex in training
    } else {
      issues.push({
        name: 'bouncing',
        severity: config.experienceLevel === 'advanced' ? IssueSeverity.LOW : IssueSeverity.MODERATE,
        description: config.experienceLevel === 'advanced'
          ? 'No pause at the bottom — competition requires a controlled reversal'
          : 'No pause at the bottom — bouncing puts stress on your joints rather than your muscles',
        value: rep.bottomDuration,
        threshold: 0.1,
        phase: SquatPhase.BOTTOM,
        frame: rep.bottomFrame,
      });
    }
  }

  // 10. Asymmetry (experience-level-based thresholds)
  const asymmetryThresholds: Record<string, number> = {
    beginner: 0.10,
    intermediate: 0.07,
    advanced: 0.05,
  };
  const asymmetryThreshold = asymmetryThresholds[config.experienceLevel] ?? 0.10;
  const symmetryValues = rep.frameAngles
    .map((fa) => fa.hipSymmetry)
    .filter((v): v is number => v !== null);
  if (symmetryValues.length > 0) {
    const maxAsymmetry = Math.max(...symmetryValues);
    if (maxAsymmetry > asymmetryThreshold) {
      issues.push({
        name: 'asymmetric_shift',
        severity: maxAsymmetry > 0.30 ? IssueSeverity.MODERATE : IssueSeverity.LOW,
        description: `${(maxAsymmetry * 100).toFixed(0)}% imbalance between left and right sides`,
        value: maxAsymmetry,
        threshold: asymmetryThreshold,
        phase: SquatPhase.BOTTOM,
        frame: rep.bottomFrame,
      });
    }
  }

  // 11. Excessive forward knee travel — only flag for low-bar squats
  if (config.squatType === SquatType.LOW_BAR) {
    const maxShinAngle = Math.max(...rep.frameAngles.map((fa) => fa.shinAngle));
    if (maxShinAngle > 45) {
      issues.push({
        name: 'excessive_forward_knee_travel',
        severity: IssueSeverity.LOW,
        description: 'Knees traveled very far forward — consider a wider stance or sitting back more',
        value: maxShinAngle,
        threshold: 45,
        phase: SquatPhase.BOTTOM,
        frame: rep.bottomFrame,
      });
    }
  }

  return issues;
}

// ─── Coaching Cues ───

/** Strip academic citations from explanations for beginner-friendly display. */
function stripCitations(text: string): string {
  // Remove parenthetical citations like (Hewett et al. 2005, Am J Sports Med)
  return text.replace(/\s*\([^)]*et al\.[^)]*\)/g, '')
    .replace(/\s*\([^)]*\d{4}[^)]*\)/g, '')
    .replace(/\s*\(IPF [^)]+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getCuesForIssues(issues: FormIssue[], experienceLevel?: string): CoachingCue[] {
  const cueMap = new Map<string, CoachingCue>();
  const isBeginnerLevel = experienceLevel === 'beginner';

  for (const issue of issues) {
    const entry = CUE_DATABASE[issue.name];
    if (!entry) continue;

    // Only keep one cue per issue name, prioritize higher severity
    if (!cueMap.has(issue.name)) {
      // Pick severity-specific explanation
      let explanation = entry.explanation;
      if (issue.severity === 'low' && entry.explanationLow) {
        explanation = entry.explanationLow;
      } else if (issue.severity === 'high' && entry.explanationHigh) {
        explanation = entry.explanationHigh;
      }

      // Strip academic citations for beginners to reduce visual noise
      if (isBeginnerLevel) {
        explanation = stripCitations(explanation);
      }

      cueMap.set(issue.name, {
        issue: issue.name,
        cue: entry.cue,
        priority: entry.priority,
        explanation,
      });
    }
  }

  // Sort by priority (lower number = higher priority)
  return Array.from(cueMap.values()).sort((a, b) => a.priority - b.priority);
}
