/**
 * Pure math functions for computing squat-related joint angles.
 * Port of Python angles.py to TypeScript (no numpy -- uses manual math).
 */

import type { Point, FrameAngles } from './types';

/**
 * Calculate the angle at vertex b formed by segments ba and bc using 3D coordinates.
 * Uses x, y, and z from the point tuples for full 3D angle computation.
 * When z is 0 (world landmarks unavailable), this gracefully falls back to 2D behavior.
 * @returns Angle in degrees, clamped to [0, 180].
 */
export function calculateAngle(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): number {
  const bax = a[0] - b[0];
  const bay = a[1] - b[1];
  const baz = a[2] - b[2];
  const bcx = c[0] - b[0];
  const bcy = c[1] - b[1];
  const bcz = c[2] - b[2];

  const lenBa = Math.sqrt(bax * bax + bay * bay + baz * baz);
  const lenBc = Math.sqrt(bcx * bcx + bcy * bcy + bcz * bcz);

  if (lenBa < 1e-9 || lenBc < 1e-9) {
    return 180.0;
  }

  const dot = bax * bcx + bay * bcy + baz * bcz;
  let cosAngle = dot / (lenBa * lenBc);
  cosAngle = Math.max(-1.0, Math.min(1.0, cosAngle));
  return (Math.acos(cosAngle) * 180) / Math.PI;
}

/**
 * Calculate the angle of a segment from the vertical axis using 3D coordinates.
 *
 * In image coordinates y increases downward, so the vertical (upward) direction
 * is (0, -1, 0). The segment direction is from bottom toward top
 * (i.e. the anatomical direction "upward along the body").
 *
 * Uses x, y, and z for full 3D angle computation. When z is 0 (world
 * landmarks unavailable), this gracefully falls back to 2D behavior.
 *
 * @returns Angle in degrees from vertical [0, 180].
 */
export function angleFromVertical(
  top: [number, number, number],
  bottom: [number, number, number],
): number {
  const segX = top[0] - bottom[0];
  const segY = top[1] - bottom[1];
  const segZ = top[2] - bottom[2];
  const segLen = Math.sqrt(segX * segX + segY * segY + segZ * segZ);

  if (segLen < 1e-9) {
    return 0.0;
  }

  // vertical is (0, -1, 0) in image coords
  // dot(segment, vertical) = segX*0 + segY*(-1) + segZ*0 = -segY
  let cosAngle = -segY / segLen;
  cosAngle = Math.max(-1.0, Math.min(1.0, cosAngle));
  return (Math.acos(cosAngle) * 180) / Math.PI;
}

/** 3D Euclidean distance between two Points. Falls back to 2D when z is 0. */
export function segmentLength(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Convert Point to (x, y, z) tuple for 3D angle computation. */
function pt(p: Point): [number, number, number] {
  return [p.x, p.y, p.z];
}

/**
 * Compute lateral trunk shift: the horizontal displacement of the midpoint
 * between shoulders relative to the midpoint between hips.
 * A value of 0 means perfectly centered; positive means shifted right.
 *
 * The result is normalized by torso height (shoulder-to-hip distance) for
 * scale independence.
 *
 * Reference: Cholewicki et al. (2005) — lateral trunk flexion as spine injury predictor
 *
 * @param landmarks Dict mapping landmark names to Point objects.
 * @returns Normalized lateral shift value, or 0 if required landmarks are missing.
 */
export function computeLateralShift(landmarks: Record<string, Point>): number {
  const leftShoulder = landmarks['left_shoulder'];
  const rightShoulder = landmarks['right_shoulder'];
  const leftHip = landmarks['left_hip'];
  const rightHip = landmarks['right_hip'];

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return 0;
  }

  const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
  const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipMidX = (leftHip.x + rightHip.x) / 2;
  const hipMidY = (leftHip.y + rightHip.y) / 2;

  // Torso height for normalization (vertical distance from shoulder mid to hip mid)
  const torsoHeight = Math.sqrt(
    (shoulderMidX - hipMidX) ** 2 + (shoulderMidY - hipMidY) ** 2,
  );

  if (torsoHeight < 1e-9) {
    return 0;
  }

  const lateralShift = shoulderMidX - hipMidX;
  return lateralShift / torsoHeight;
}

/**
 * Compute the angle of the head/neck relative to the trunk.
 * Uses ear-to-shoulder angle relative to the trunk line.
 *
 * Returns the neck extension angle in degrees.
 * ~0 = neutral, positive = extended (looking up), negative = flexed (looking down)
 *
 * @param landmarks Dict mapping landmark names to Point objects.
 * @returns Neck extension angle in degrees, or 0 if required landmarks are missing.
 */
export function computeNeckAngle(landmarks: Record<string, Point>): number {
  const leftEar = landmarks['left_ear'];
  const rightEar = landmarks['right_ear'];
  const leftShoulder = landmarks['left_shoulder'];
  const rightShoulder = landmarks['right_shoulder'];
  const leftHip = landmarks['left_hip'];
  const rightHip = landmarks['right_hip'];

  // Need at least one ear, one shoulder, and one hip on the same side
  const hasLeft = leftEar && leftShoulder && leftHip;
  const hasRight = rightEar && rightShoulder && rightHip;

  if (!hasLeft && !hasRight) {
    return 0;
  }

  // Use the side with better visibility, or whichever is available
  let ear: Point, shoulder: Point, hip: Point;
  if (hasLeft && hasRight) {
    const leftVis = leftEar.visibility + leftShoulder.visibility;
    const rightVis = rightEar.visibility + rightShoulder.visibility;
    if (leftVis >= rightVis) {
      ear = leftEar;
      shoulder = leftShoulder;
      hip = leftHip;
    } else {
      ear = rightEar!;
      shoulder = rightShoulder!;
      hip = rightHip!;
    }
  } else if (hasLeft) {
    ear = leftEar!;
    shoulder = leftShoulder!;
    hip = leftHip!;
  } else {
    ear = rightEar!;
    shoulder = rightShoulder!;
    hip = rightHip!;
  }

  // Trunk angle from vertical (shoulder -> hip direction)
  const trunkAngleFromVertical = angleFromVertical(pt(shoulder), pt(hip));

  // Neck/head angle from vertical (ear -> shoulder direction)
  const neckAngleFromVertical = angleFromVertical(pt(ear), pt(shoulder));

  // Relative neck extension = neck angle - trunk angle
  // Positive means head is tilted back (extended) relative to the trunk
  // Negative means head is tilted forward (flexed) relative to the trunk
  return neckAngleFromVertical - trunkAngleFromVertical;
}

/** Pick the side (left/right) with better average visibility. */
export function pickSide(landmarks: Record<string, Point>): 'left' | 'right' {
  const leftKeys = Object.keys(landmarks).filter((k) => k.startsWith('left_'));
  const rightKeys = Object.keys(landmarks).filter((k) => k.startsWith('right_'));

  const leftVis =
    leftKeys.length > 0
      ? leftKeys.reduce((sum, k) => sum + landmarks[k].visibility, 0) / leftKeys.length
      : 0;
  const rightVis =
    rightKeys.length > 0
      ? rightKeys.reduce((sum, k) => sum + landmarks[k].visibility, 0) / rightKeys.length
      : 0;

  return leftVis >= rightVis ? 'left' : 'right';
}

/**
 * Compute all relevant squat angles from a set of landmarks.
 *
 * @param landmarks Dict mapping landmark names to Point objects.
 * @param standingKneeWidth Standing-frame knee width for ratio computation.
 * @returns FrameAngles with all computed angles.
 */
export function computeFrameAngles(
  landmarks: Record<string, Point>,
  standingKneeWidth?: number,
  cachedSide?: 'left' | 'right',
): FrameAngles {
  const side = cachedSide ?? pickSide(landmarks);

  const shoulder = landmarks[`${side}_shoulder`];
  const hip = landmarks[`${side}_hip`];
  const knee = landmarks[`${side}_knee`];
  const ankle = landmarks[`${side}_ankle`];

  // Null guard: if any core landmark is missing, return safe defaults
  if (!shoulder || !hip || !knee || !ankle) {
    return {
      kneeAngle: 180,
      hipAngle: 180,
      ankleAngle: 90,
      trunkAngle: 0,
      shinAngle: 0,
      kneeWidthRatio: null,
      hipSymmetry: null,
      lateralShift: 0,
      neckAngle: 0,
    };
  }

  const heel = landmarks[`${side}_heel`] ?? ankle;
  const footIndex = landmarks[`${side}_foot_index`] ?? ankle;

  // Knee angle: hip-knee-ankle
  const kneeAngle = calculateAngle(pt(hip), pt(knee), pt(ankle));

  // Hip angle: shoulder-hip-knee
  const hipAngle = calculateAngle(pt(shoulder), pt(hip), pt(knee));

  // Ankle angle: knee-ankle-foot_index
  const ankleAngle = calculateAngle(pt(knee), pt(ankle), pt(footIndex));

  // Trunk angle: angle of torso (shoulder->hip) from vertical
  const trunkAngle = angleFromVertical(pt(shoulder), pt(hip));

  // Shin angle: angle of shin (knee->ankle) from vertical
  const shinAngle = angleFromVertical(pt(knee), pt(ankle));

  // Knee width ratio (frontal view)
  let kneeWidthRatio: number | null = null;
  if (
    landmarks['left_knee'] &&
    landmarks['right_knee'] &&
    standingKneeWidth !== undefined &&
    standingKneeWidth > 1e-9
  ) {
    const currentWidth = Math.abs(landmarks['left_knee'].x - landmarks['right_knee'].x);
    kneeWidthRatio = currentWidth / standingKneeWidth;
  }

  // Hip symmetry: difference in left vs right hip y-position, normalized
  let hipSymmetry: number | null = null;
  if (landmarks['left_hip'] && landmarks['right_hip']) {
    const leftHip = landmarks['left_hip'];
    const rightHip = landmarks['right_hip'];
    const hipWidth = Math.abs(leftHip.x - rightHip.x);
    if (hipWidth > 1e-9) {
      hipSymmetry = Math.abs(leftHip.y - rightHip.y) / hipWidth;
    }
  }

  // FPPA: Frontal Plane Projection Angle for valgus detection
  // Compute when both left and right knees are visible (frontal view)
  let fppa: number | undefined;
  if (
    landmarks['left_knee'] &&
    landmarks['right_knee'] &&
    landmarks['left_hip'] &&
    landmarks['right_hip'] &&
    landmarks['left_ankle'] &&
    landmarks['right_ankle']
  ) {
    const lKnee = landmarks['left_knee'];
    const lAnkle = landmarks['left_ankle'];
    const rKnee = landmarks['right_knee'];
    const rAnkle = landmarks['right_ankle'];
    const leftFppa = Math.atan2(lKnee.x - lAnkle.x, lAnkle.y - lKnee.y) * 180 / Math.PI;
    const rightFppa = Math.atan2(rKnee.x - rAnkle.x, rAnkle.y - rKnee.y) * 180 / Math.PI;
    // Use the larger (worse) absolute FPPA value
    fppa = Math.max(Math.abs(leftFppa), Math.abs(rightFppa));
  }

  // Elbow angle: shoulder-elbow-wrist (for bench press)
  const elbow = landmarks[`${side}_elbow`];
  const wrist = landmarks[`${side}_wrist`];
  let elbowAngle: number | undefined;
  let shoulderAngle: number | undefined;
  if (elbow && wrist && shoulder) {
    elbowAngle = calculateAngle(pt(shoulder), pt(elbow), pt(wrist));
    // Shoulder flexion: hip-shoulder-elbow
    if (hip) {
      shoulderAngle = calculateAngle(pt(hip), pt(shoulder), pt(elbow));
    }
  }

  // Average visibility of core landmarks used for angle computations
  const coreVisibilities = [shoulder.visibility, hip.visibility, knee.visibility, ankle.visibility];
  const landmarkConfidence = coreVisibilities.reduce((sum, v) => sum + v, 0) / coreVisibilities.length;

  // Lateral trunk shift (frontal view — requires both sides)
  const lateralShift = computeLateralShift(landmarks);

  // Neck extension angle (requires ear landmarks)
  const neckAngle = computeNeckAngle(landmarks);

  return {
    kneeAngle,
    hipAngle,
    ankleAngle,
    trunkAngle,
    shinAngle,
    kneeWidthRatio,
    hipSymmetry,
    fppa,
    elbowAngle,
    shoulderAngle,
    landmarkConfidence,
    lateralShift,
    neckAngle,
  };
}
