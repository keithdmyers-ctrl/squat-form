/**
 * Real-time live webcam analysis engine.
 * Orchestrates per-frame pose processing, phase detection, rep scoring,
 * and audio coaching cues for the live mode.
 */

import { computeFrameAngles, segmentLength, pickSide } from './angles';
import { PhaseDetector } from './phases';
import { calibrateFromStanding } from './calibration';
import {
  WEIGHTS,
  COMPETITION_WEIGHTS,
  VALGUS_THRESHOLDS,
  clamp,
  scoreDepth,
  scoreKneeTracking,
  scoreTrunk,
  scoreSymmetry,
  scoreTempo,
  scoreLockout,
  scoreCompetitionLockout,
  scoreToGrade,
  redistributeWeights,
  getPositiveFeedback,
} from './scorer';
import { detectRepIssues, getCuesForIssues } from './issues';
import { detectStickingPoints, computeVelocityMetrics } from './competition';
import { assessMobility, generateWarmupProtocol } from './mobility';
import { SquatPhase, severityRank } from './types';
import type {
  Landmarks,
  FrameAngles,
  CalibrationData,
  SquatConfig,
  SquatType,
  ExperienceLevel,
  RepData,
  RepScore,
  SetAnalysis,
  FormIssue,
} from './types';

// ─── Public Interfaces ───

export interface LiveCallbacks {
  onFrameProcessed: (landmarks: Landmarks, angles: FrameAngles, phase: SquatPhase) => void;
  onRepComplete: (repScore: RepScore, repNumber: number) => void;
  onCalibrated: () => void;
  onPhaseChange: (phase: SquatPhase) => void;
  onError: (message: string) => void;
}

export interface LiveConfig {
  squatType: SquatType;
  experienceLevel: ExperienceLevel;
  competitionMode: boolean;
  audioEnabled: boolean;
}

// ─── LiveAnalyzer ───

export class LiveAnalyzer {
  private config: SquatConfig;
  private phaseDetector: PhaseDetector;
  private calibration: CalibrationData | null = null;
  private frameBuffer: FrameAngles[] = [];
  private landmarkBuffer: Landmarks[] = [];
  private repCount = 0;
  private repScores: RepScore[] = [];
  private callbacks: LiveCallbacks;
  private audioEnabled: boolean;
  private lastPhase: SquatPhase = SquatPhase.STANDING;
  private repStartIdx = 0;
  private bottomIdx = 0;
  private minKneeInRep = 180;
  private frameIndex = 0;
  private calibrationFrames: Landmarks[] = [];
  private calibrationAttempts = 0;
  private inRep = false;

  // Rolling FPS tracking based on actual frame timestamps
  private lastFrameTime: number | null = null;
  private frameIntervals: number[] = [];
  private readonly FPS_ROLLING_WINDOW = 30;

  constructor(liveConfig: LiveConfig, callbacks: LiveCallbacks) {
    this.config = {
      squatType: liveConfig.squatType,
      experienceLevel: liveConfig.experienceLevel,
      competitionMode: liveConfig.competitionMode,
    };
    this.phaseDetector = new PhaseDetector(true);
    this.callbacks = callbacks;
    this.audioEnabled = liveConfig.audioEnabled;
  }

  /** Process a single frame from the webcam. */
  processFrame(landmarks: Landmarks): void {
    this.frameIndex++;

    // Track actual FPS from frame timestamps
    const now = performance.now();
    if (this.lastFrameTime !== null) {
      const interval = now - this.lastFrameTime;
      if (interval > 0) {
        this.frameIntervals.push(interval);
        if (this.frameIntervals.length > this.FPS_ROLLING_WINDOW) {
          this.frameIntervals.shift();
        }
      }
    }
    this.lastFrameTime = now;

    const angles = computeFrameAngles(landmarks, this.calibration?.standingKneeWidth ?? undefined);

    // Calibration: use first few standing frames
    if (!this.calibration && this.calibrationAttempts < 60) {
      this.calibrationAttempts++;
      if (angles.kneeAngle >= 150) {
        this.calibrationFrames.push(landmarks);
        // Require 5 consecutive standing frames for stable calibration
        if (this.calibrationFrames.length >= 5) {
          this.calibration = calibrateFromStanding(this.calibrationFrames[Math.floor(this.calibrationFrames.length / 2)]);
          this.callbacks.onCalibrated();
        }
      } else {
        // Reset if not standing
        this.calibrationFrames = [];
      }
    }

    // Update phase detector
    const phase = this.phaseDetector.update(angles.kneeAngle);

    // Track phase changes
    if (phase !== this.lastPhase) {
      this.callbacks.onPhaseChange(phase);

      // Rep starts when we begin descending from standing
      if (this.lastPhase === SquatPhase.STANDING && phase === SquatPhase.DESCENDING) {
        this.inRep = true;
        this.repStartIdx = this.frameBuffer.length;
        this.minKneeInRep = angles.kneeAngle;
        this.bottomIdx = this.frameBuffer.length;
      }

      // Rep ends when we return to standing from ascending
      if (this.lastPhase === SquatPhase.ASCENDING && phase === SquatPhase.STANDING && this.inRep) {
        this.handleRepComplete();
        this.inRep = false;
      }

      this.lastPhase = phase;
    }

    // Track the bottom of the rep
    if (this.inRep && (phase === SquatPhase.DESCENDING || phase === SquatPhase.BOTTOM)) {
      if (angles.kneeAngle < this.minKneeInRep) {
        this.minKneeInRep = angles.kneeAngle;
        this.bottomIdx = this.frameBuffer.length;
      }
    }

    // Buffer frame angles and landmarks
    this.frameBuffer.push(angles);
    this.landmarkBuffer.push(landmarks);

    this.callbacks.onFrameProcessed(landmarks, angles, phase);
  }

  private handleRepComplete(): void {
    const repEndIdx = this.frameBuffer.length - 1;
    const repFrameAngles = this.frameBuffer.slice(this.repStartIdx, repEndIdx + 1);

    if (repFrameAngles.length < 10) {
      // Too few frames for a valid rep -- don't count it
      this.trimBuffers(repEndIdx);
      return;
    }

    this.repCount++;

    const repLandmarks = this.landmarkBuffer.slice(this.repStartIdx, repEndIdx + 1);

    // Build RepData from buffered frames
    const repData = this.buildRepData(repFrameAngles, repLandmarks, this.repStartIdx, repEndIdx);
    repData.repNumber = this.repCount;

    // Score the rep
    const repScore = this.scoreRep(repData);
    this.repScores.push(repScore);

    this.callbacks.onRepComplete(repScore, this.repCount);

    // Speak audio cue for the top issue
    if (repScore.cues.length > 0) {
      this.speakCue(repScore.cues[0].cue);
    } else if (repScore.positiveFeedback.length > 0) {
      this.speakCue(repScore.positiveFeedback[0]);
    }

    this.trimBuffers(repEndIdx);
  }

  private trimBuffers(repEndIdx: number): void {
    // Trim buffers: keep only a small tail for next rep detection continuity
    const keepFrom = Math.max(0, repEndIdx - 5);
    this.frameBuffer = this.frameBuffer.slice(keepFrom);
    this.landmarkBuffer = this.landmarkBuffer.slice(keepFrom);
    // Adjust indices for trimmed buffer
    this.repStartIdx = 0;
    this.bottomIdx = 0;
  }

  private buildRepData(
    repFrameAngles: FrameAngles[],
    repLandmarks: Landmarks[],
    _startIdx: number,
    _endIdx: number,
  ): RepData {
    // Single pass to find min knee angle, bottom index, min hip angle, and max trunk angle
    let minKneeAngle = 180;
    let minHipAngle = 180;
    let maxTrunkAngle = 0;
    let bottomRelIdx = 0;
    for (let i = 0; i < repFrameAngles.length; i++) {
      const fa = repFrameAngles[i];
      if (fa.kneeAngle < minKneeAngle) { minKneeAngle = fa.kneeAngle; bottomRelIdx = i; }
      if (fa.hipAngle < minHipAngle) minHipAngle = fa.hipAngle;
      if (fa.trunkAngle > maxTrunkAngle) maxTrunkAngle = fa.trunkAngle;
    }

    // Build kneeAngles array only for downstream uses (sticking points, velocity, bottom duration)
    const kneeAngles = repFrameAngles.map((fa) => fa.kneeAngle);

    // Use actual measured FPS (falls back to 15 if not enough data yet)
    const fps = this.getEffectiveFps();

    // Duration calculations
    const descentFrames = bottomRelIdx;
    const ascentFrames = repFrameAngles.length - bottomRelIdx;
    const descentDuration = fps > 0 ? descentFrames / fps : 0;
    const ascentDuration = fps > 0 ? ascentFrames / fps : 0;

    // Bottom duration: frames within 5 degrees of min knee angle
    let bottomFrameCount = 0;
    for (const ka of kneeAngles) {
      if (ka <= minKneeAngle + 5) {
        bottomFrameCount++;
      }
    }
    const bottomDuration = fps > 0 ? bottomFrameCount / fps : 0;

    // Detect heel rise
    let heelRise = false;
    if (repLandmarks.length > 0) {
      const startLm = repLandmarks[0];
      const side = pickSide(startLm);
      const heelKey = `${side}_heel`;
      const kneeKey = `${side}_knee`;
      const ankleKey = `${side}_ankle`;
      const startHeel = startLm[heelKey];
      const startKnee = startLm[kneeKey];
      const startAnkle = startLm[ankleKey];

      if (startHeel && startKnee && startAnkle) {
        const legLength = segmentLength(startKnee, startAnkle);
        const heelRiseThreshold = legLength * 0.035;
        const standingHeelY = startHeel.y;

        // Require 3 consecutive frames of heel rise to reduce false positives from MediaPipe jitter
        let consecutiveHeelRiseFrames = 0;
        for (let i = 0; i <= Math.min(bottomRelIdx, repLandmarks.length - 1); i++) {
          const lm = repLandmarks[i];
          const heel = lm[heelKey];
          if (!heel) { consecutiveHeelRiseFrames = 0; continue; }
          if (standingHeelY - heel.y > heelRiseThreshold) {
            consecutiveHeelRiseFrames++;
            if (consecutiveHeelRiseFrames >= 3) {
              heelRise = true;
              break;
            }
          } else {
            consecutiveHeelRiseFrames = 0;
          }
        }
      }
    }

    // Detect butt wink
    let pelvicTiltAtBottom = 0;
    if (bottomRelIdx >= 0 && bottomRelIdx < repFrameAngles.length) {
      const hipAngleAtBottom = repFrameAngles[bottomRelIdx]?.hipAngle ?? 0;
      const earlyHipAngles = repFrameAngles.slice(0, Math.max(1, Math.floor(repFrameAngles.length * 0.3)));
      const avgEarlyHip = earlyHipAngles.length > 0
        ? earlyHipAngles.reduce((s, fa) => s + fa.hipAngle, 0) / earlyHipAngles.length
        : hipAngleAtBottom;
      pelvicTiltAtBottom = Math.abs(hipAngleAtBottom - avgEarlyHip);
    }
    const buttWink = pelvicTiltAtBottom > 8;

    // Detect good morning pattern
    let trunkAngleChangeOnAscent = 0;
    if (bottomRelIdx >= 0 && bottomRelIdx < repFrameAngles.length) {
      const trunkAtBottom = repFrameAngles[bottomRelIdx]?.trunkAngle ?? 0;
      let maxTrunkOnAscent = trunkAtBottom;
      for (let i = bottomRelIdx; i < repFrameAngles.length; i++) {
        if (repFrameAngles[i].trunkAngle > maxTrunkOnAscent) {
          maxTrunkOnAscent = repFrameAngles[i].trunkAngle;
        }
      }
      trunkAngleChangeOnAscent = maxTrunkOnAscent - trunkAtBottom;
    }
    const goodMorningThreshold = this.config.squatType === 'low_bar' ? 20 : 15;
    const goodMorning = trunkAngleChangeOnAscent > goodMorningThreshold;

    // Detect knee valgus
    const valgusThreshold = VALGUS_THRESHOLDS[this.config.experienceLevel];
    let kneeValgus = false;
    for (const fa of repFrameAngles) {
      if (fa.kneeWidthRatio !== null && fa.kneeWidthRatio < valgusThreshold) {
        kneeValgus = true;
        break;
      }
    }

    // Sticking point detection
    const topAngle = kneeAngles.length > 0 ? Math.max(...kneeAngles) : 180;
    const stickingPoints = detectStickingPoints(
      kneeAngles, bottomRelIdx, topAngle, minKneeAngle, fps, 0,
    );

    // Velocity metrics
    const velocity = computeVelocityMetrics(kneeAngles, bottomRelIdx, fps);

    return {
      repNumber: 0,
      startFrame: 0,
      endFrame: 0,
      bottomFrame: 0,
      minKneeAngle,
      minHipAngle,
      maxTrunkAngle,
      descentDuration,
      bottomDuration,
      ascentDuration,
      frameAngles: repFrameAngles,
      heelRise,
      buttWink,
      goodMorning,
      kneeValgus,
      trunkAngleChangeOnAscent,
      pelvicTiltAtBottom,
      stickingPoints,
      velocity,
    };
  }

  private scoreRep(rep: RepData): RepScore {
    const isCompetition = this.config.competitionMode;
    const depth = scoreDepth(rep.minKneeAngle, this.config);
    const kneeTracking = scoreKneeTracking(rep, this.config);
    const trunk = scoreTrunk(rep.maxTrunkAngle, this.config, this.calibration);
    const symmetry = scoreSymmetry(rep);
    const tempo = isCompetition ? 100 : scoreTempo(rep.descentDuration, rep.bottomDuration, rep.ascentDuration);
    const lockout = scoreLockout(rep, this.calibration);
    const effectiveLockout = isCompetition ? scoreCompetitionLockout(rep, this.calibration) : lockout;

    const baseW = isCompetition ? COMPETITION_WEIGHTS : WEIGHTS;

    // If no frontal knee data, redistribute kneeTracking weight
    const hasFrontalData = rep.frameAngles.some((fa) => fa.kneeWidthRatio !== null);
    const w = hasFrontalData ? baseW : redistributeWeights(baseW, 'kneeTracking');

    const overall = clamp(
      Math.round(
        depth * w.depth +
          kneeTracking * w.kneeTracking +
          trunk * w.trunk +
          symmetry * w.symmetry +
          tempo * w.tempo +
          effectiveLockout * w.lockout,
      ),
      0,
      100,
    );

    const issues = detectRepIssues(rep, this.config, this.calibration);
    const cues = getCuesForIssues(issues);
    const positiveFeedback = getPositiveFeedback({
      depth,
      kneeTracking,
      trunk,
      symmetry,
      tempo,
      lockout: isCompetition ? effectiveLockout : lockout,
    });

    return {
      depthScore: depth,
      kneeTrackingScore: kneeTracking,
      trunkScore: trunk,
      symmetryScore: symmetry,
      tempoScore: tempo,
      lockoutScore: isCompetition ? effectiveLockout : lockout,
      overallScore: overall,
      grade: scoreToGrade(overall, this.config.experienceLevel),
      issues,
      cues,
      positiveFeedback,
      stickingPoints: rep.stickingPoints,
      velocity: rep.velocity,
    };
  }

  /** Get accumulated results for the full session. */
  getResults(): SetAnalysis {
    if (this.repScores.length === 0) {
      return {
        repCount: 0,
        reps: [],
        overallScore: 0,
        grade: scoreToGrade(0, this.config.experienceLevel),
        fatigueDetected: false,
        topIssues: [],
        topCues: [],
        calibration: this.calibration,
        config: this.config,
        repFrameMap: new Map(),
        repStartFrames: [],
        positiveHighlights: [],
        mobilityFindings: [],
        warmupProtocol: [],
        competitionMode: this.config.competitionMode,
      };
    }

    const avgScore = this.repScores.reduce((s, r) => s + r.overallScore, 0) / this.repScores.length;
    const overallScore = clamp(Math.round(avgScore), 0, 100);

    // Fatigue detection
    let fatigueDetected = false;
    if (this.repScores.length >= 4) {
      const first2Avg = (this.repScores[0].overallScore + this.repScores[1].overallScore) / 2;
      const last2Avg = (
        this.repScores[this.repScores.length - 2].overallScore +
        this.repScores[this.repScores.length - 1].overallScore
      ) / 2;
      fatigueDetected = first2Avg - last2Avg > 15;
    }

    // Collect top issues
    const allIssues = this.repScores.flatMap((r) => r.issues);
    const issueCountMap = new Map<string, { issue: FormIssue; count: number }>();
    for (const issue of allIssues) {
      const existing = issueCountMap.get(issue.name);
      if (existing) {
        existing.count++;
        if (severityRank(issue.severity) > severityRank(existing.issue.severity)) {
          existing.issue = issue;
        }
      } else {
        issueCountMap.set(issue.name, { issue, count: 1 });
      }
    }

    const topIssues = Array.from(issueCountMap.values())
      .sort((a, b) => {
        const sevDiff = severityRank(b.issue.severity) - severityRank(a.issue.severity);
        if (sevDiff !== 0) return sevDiff;
        return b.count - a.count;
      })
      .slice(0, 3)
      .map((e) => e.issue);

    const topCues = getCuesForIssues(topIssues);

    // Collect positive highlights
    const positiveSet = new Set<string>();
    for (const rep of this.repScores) {
      for (const fb of rep.positiveFeedback) {
        positiveSet.add(fb);
      }
    }

    const mobilityFindings = assessMobility(topIssues, this.config.experienceLevel);
    const warmupProtocol = generateWarmupProtocol(topIssues, this.config.experienceLevel);

    return {
      repCount: this.repScores.length,
      reps: this.repScores,
      overallScore,
      grade: scoreToGrade(overallScore, this.config.experienceLevel),
      fatigueDetected,
      topIssues,
      topCues,
      calibration: this.calibration,
      config: this.config,
      repFrameMap: new Map(),
      repStartFrames: [],
      positiveHighlights: Array.from(positiveSet),
      mobilityFindings,
      warmupProtocol,
      competitionMode: this.config.competitionMode,
    };
  }

  /** Speak a coaching cue using Web Speech API. */
  private speakCue(text: string): void {
    if (!this.audioEnabled) return;
    if (typeof speechSynthesis === 'undefined') return;

    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    utterance.pitch = 1.0;
    utterance.volume = 0.8;
    speechSynthesis.speak(utterance);
  }

  /** Get the effective FPS based on rolling average of actual frame intervals. Falls back to 30 if insufficient data. */
  getEffectiveFps(): number {
    if (this.frameIntervals.length < 5) {
      return 30; // fallback until enough samples collected
    }
    const avgInterval = this.frameIntervals.reduce((sum, v) => sum + v, 0) / this.frameIntervals.length;
    // avgInterval is in ms, convert to fps; clamp to reasonable range [1, 120]
    const fps = 1000 / avgInterval;
    return Math.max(1, Math.min(120, fps));
  }

  /** Update audio setting. */
  setAudioEnabled(enabled: boolean): void {
    this.audioEnabled = enabled;
    if (!enabled && typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel();
    }
  }

  /** Get current rep count. */
  getRepCount(): number {
    return this.repCount;
  }

  /** Get current calibration state. */
  isCalibrated(): boolean {
    return this.calibration !== null;
  }

  /** Get calibration progress: current consecutive standing frames and required count. */
  getCalibrationProgress(): { current: number; required: number; attempts: number; maxAttempts: number } {
    return {
      current: this.calibrationFrames.length,
      required: 5,
      attempts: this.calibrationAttempts,
      maxAttempts: 60,
    };
  }

  /** Reset for a new session. */
  reset(): void {
    this.phaseDetector = new PhaseDetector(true);
    this.calibration = null;
    this.frameBuffer = [];
    this.landmarkBuffer = [];
    this.repCount = 0;
    this.repScores = [];
    this.lastPhase = SquatPhase.STANDING;
    this.repStartIdx = 0;
    this.bottomIdx = 0;
    this.minKneeInRep = 180;
    this.frameIndex = 0;
    this.calibrationFrames = [];
    this.calibrationAttempts = 0;
    this.inRep = false;
    this.lastFrameTime = null;
    this.frameIntervals = [];
  }
}
