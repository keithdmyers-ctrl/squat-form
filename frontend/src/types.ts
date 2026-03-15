/** Shared types for the squat/deadlift/bench form analyzer. */

export interface Point {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface FrameAngles {
  kneeAngle: number;
  hipAngle: number;
  ankleAngle: number;
  trunkAngle: number;
  shinAngle: number;
  kneeWidthRatio: number | null;
  hipSymmetry: number | null;
  /** Frontal Plane Projection Angle for valgus detection (degrees). */
  fppa?: number;
  /** Elbow angle (shoulder-elbow-wrist) for bench press analysis. */
  elbowAngle?: number;
  /** Shoulder flexion angle for bench press analysis. */
  shoulderAngle?: number;
  /** Average landmark visibility/confidence for this frame's angle computations (0-1). */
  landmarkConfidence?: number;
}

// ─── Exercise Type ───

export const ExerciseType = {
  SQUAT: 'squat',
  DEADLIFT: 'deadlift',
  BENCH_PRESS: 'bench_press',
} as const;
export type ExerciseType = (typeof ExerciseType)[keyof typeof ExerciseType];

export const DeadliftType = {
  CONVENTIONAL: 'conventional',
  SUMO: 'sumo',
  ROMANIAN: 'romanian',
} as const;
export type DeadliftType = (typeof DeadliftType)[keyof typeof DeadliftType];

export const BenchType = {
  FLAT: 'flat',
  CLOSE_GRIP: 'close_grip',
  WIDE_GRIP: 'wide_grip',
} as const;
export type BenchType = (typeof BenchType)[keyof typeof BenchType];

export const SquatType = {
  BODYWEIGHT: 'bodyweight',
  HIGH_BAR: 'high_bar',
  LOW_BAR: 'low_bar',
  FRONT: 'front',
  GOBLET: 'goblet',
  OVERHEAD: 'overhead',
} as const;
export type SquatType = (typeof SquatType)[keyof typeof SquatType];

export const ExperienceLevel = {
  BEGINNER: 'beginner',
  INTERMEDIATE: 'intermediate',
  ADVANCED: 'advanced',
} as const;
export type ExperienceLevel = (typeof ExperienceLevel)[keyof typeof ExperienceLevel];

export const SquatPhase = {
  STANDING: 'standing',
  DESCENDING: 'descending',
  BOTTOM: 'bottom',
  ASCENDING: 'ascending',
} as const;
export type SquatPhase = (typeof SquatPhase)[keyof typeof SquatPhase];

export const IssueSeverity = {
  HIGH: 'high',
  MODERATE: 'moderate',
  LOW: 'low',
} as const;
export type IssueSeverity = (typeof IssueSeverity)[keyof typeof IssueSeverity];

export interface FormIssue {
  name: string;
  severity: IssueSeverity;
  description: string;
  value: number;
  threshold: number;
  phase: SquatPhase;
  frame: number;
}

export interface CoachingCue {
  issue: string;
  cue: string;
  priority: number;
  explanation: string;
}

/** Base config shared by all exercise analyzers. */
export interface BaseExerciseConfig {
  squatType: string;
  experienceLevel: ExperienceLevel;
  competitionMode: boolean;
}

export interface SquatConfig extends BaseExerciseConfig {
  squatType: SquatType;
}

export interface CalibrationData {
  standingKneeAngle: number;
  standingHipAngle: number;
  standingTrunkAngle: number;
  standingAnkleAngle: number;
  femurLength: number;
  tibiaLength: number;
  torsoLength: number;
  femurTibiaRatio: number;
  torsoFemurRatio: number;
  standingKneeWidth: number | null;
}

// ─── Mobility & Trainer Types ───

export interface MobilityFinding {
  area: string;
  limitation: string;
  test: string;
  stretches: string[];
  frequency: string;
}

export interface WarmUpStep {
  name: string;
  description: string;
  duration: string;
  purpose: string;
}

export interface ExerciseProgression {
  level: string;
  exercise: string;
  criteria: string;
}

// ─── Powerlifter Types ───

export interface StickingPoint {
  frame: number;
  kneeAngle: number;
  depthPercentage: number;
  velocityDrop: number;
  description: string;
}

export interface BarPathData {
  xPositions: number[];
  yPositions: number[];
  lateralDrift: number;
  pathEfficiency: number;
  description: string;
}

export interface VelocityMetrics {
  peakDescentVelocity: number;
  peakAscentVelocity: number;
  meanDescentVelocity: number;
  meanAscentVelocity: number;
  ascentDescentRatio: number;
  description: string;
}

export interface RepData {
  repNumber: number;
  startFrame: number;
  endFrame: number;
  bottomFrame: number;
  minKneeAngle: number;
  minHipAngle: number;
  maxTrunkAngle: number;
  descentDuration: number;
  bottomDuration: number;
  ascentDuration: number;
  frameAngles: FrameAngles[];
  heelRise: boolean;
  buttWink: boolean;
  goodMorning: boolean;
  kneeValgus: boolean;
  trunkAngleChangeOnAscent: number;
  pelvicTiltAtBottom: number;
  competitionDepthPass?: boolean;
  competitionDepthMargin?: number;
  stickingPoints: StickingPoint[];
  barPath?: BarPathData;
  velocity?: VelocityMetrics;
}

export interface RepScore {
  depthScore: number;
  kneeTrackingScore: number;
  trunkScore: number;
  symmetryScore: number;
  tempoScore: number;
  lockoutScore: number;
  overallScore: number;
  grade: string;
  issues: FormIssue[];
  cues: CoachingCue[];
  positiveFeedback: string[];
  stickingPoints: StickingPoint[];
  barPath?: BarPathData;
  velocity?: VelocityMetrics;
  competitionDepthPass?: boolean;
  competitionDepthMargin?: number;
  /** Average landmark confidence across all frames in this rep (0-1). */
  avgConfidence?: number;
  /** Raw angle summaries for data export. */
  minKneeAngle?: number;
  maxTrunkAngle?: number;
  minHipAngle?: number;
  descentDuration?: number;
  ascentDuration?: number;
  bottomDuration?: number;
}

export interface SetAnalysis {
  repCount: number;
  reps: RepScore[];
  overallScore: number;
  grade: string;
  fatigueDetected: boolean;
  topIssues: FormIssue[];
  topCues: CoachingCue[];
  calibration: CalibrationData | null;
  config: BaseExerciseConfig;
  /** Maps frame number to that frame's rep index (0-based), or -1 if between reps */
  repFrameMap: Map<number, number>;
  /** Start frames for each rep (used for seeking) */
  repStartFrames: number[];
  sideViewWarning?: string;
  /** Detected camera view angle from landmark geometry ('side', 'front', or 'unknown'). */
  detectedCameraView?: 'side' | 'front' | 'unknown';
  /** Warning if multiple people were detected in the video. */
  multiPersonWarning?: string;
  positiveHighlights: string[];
  mobilityFindings: MobilityFinding[];
  warmupProtocol: WarmUpStep[];
  competitionMode: boolean;
}

export interface RepRange {
  start: number;
  end: number;
  bottomIndex: number;
}

/** Rank issue severity for sorting/comparison. */
export function severityRank(severity: IssueSeverity | string): number {
  switch (severity) {
    case 'high':
      return 3;
    case 'moderate':
      return 2;
    case 'low':
      return 1;
    default:
      return 0;
  }
}

/** Landmarks dictionary: named landmark -> Point */
export type Landmarks = Record<string, Point>;

/** Frame data: frame index -> landmarks */
export type FrameData = Map<number, Landmarks>;

// ─── Session History Types ───

export interface SessionRecord {
  id: string;
  date: string;           // ISO timestamp
  squat_type: string;
  experience_level: string;
  rep_count: number;
  overall_score: number;
  grade: string;
  top_issue: string | null;
  positive_count: number;
  // Enhanced fields (optional for backward compat with existing sessions)
  exercise_type?: string;        // 'squat' | 'deadlift' | 'bench_press'
  exercise_variant?: string;     // specific variant name
  weight?: number;
  weight_unit?: string;
  rep_scores?: number[];        // per-rep overall scores
  avg_depth?: number;
  avg_knee_tracking?: number;
  avg_trunk?: number;
  avg_symmetry?: number;
  avg_tempo?: number;
  avg_lockout?: number;
  estimated_1rm?: number;
}
