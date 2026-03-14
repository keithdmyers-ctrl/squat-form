"""Body proportion calibration from standing-frame landmarks."""

from __future__ import annotations

from squat_form.schemas import (
    CalibrationData,
    ExperienceLevel,
    Point,
    SquatType,
)
from squat_form.angles import (
    angle_from_vertical,
    calculate_angle,
    pt,
    segment_length,
)


# Degrees of trunk angle adjustment per 0.1 femur/tibia ratio deviation.
# A ratio of 1.3 (deviation 0.3) yields ~16.5 degrees of additional lean allowance.
PROPORTION_ADJUSTMENT_PER_RATIO: float = 5.5

# Trunk angle norms (degrees from vertical) per squat type: (min, max)
TRUNK_ANGLE_NORMS: dict[SquatType, tuple[float, float]] = {
    SquatType.BODYWEIGHT: (25.0, 45.0),
    SquatType.HIGH_BAR: (30.0, 50.0),     # Research: 30-45° typical
    SquatType.LOW_BAR: (40.0, 60.0),      # Research: 40-55° typical
    SquatType.FRONT: (10.0, 25.0),        # Research: 10-20°
    SquatType.GOBLET: (15.0, 30.0),
    SquatType.OVERHEAD: (10.0, 25.0),
}


def calibrate_from_standing(landmarks: dict[str, Point]) -> CalibrationData:
    """Calibrate body proportions from a standing-frame landmark set.

    Measures segment lengths (normalized to total leg length), standing
    joint angles, and key ratios.

    Args:
        landmarks: Named landmark dictionary from the pose extractor.

    Returns:
        CalibrationData with all measurements.
    """
    # Pick the side with better visibility (simple: average both sides)
    left_vis = sum(
        landmarks.get(k, Point(x=0, y=0, visibility=0)).visibility
        for k in ("left_shoulder", "left_hip", "left_knee", "left_ankle")
    )
    right_vis = sum(
        landmarks.get(k, Point(x=0, y=0, visibility=0)).visibility
        for k in ("right_shoulder", "right_hip", "right_knee", "right_ankle")
    )
    side = "left" if left_vis >= right_vis else "right"

    shoulder = landmarks[f"{side}_shoulder"]
    hip = landmarks[f"{side}_hip"]
    knee = landmarks[f"{side}_knee"]
    ankle = landmarks[f"{side}_ankle"]
    heel = landmarks.get(f"{side}_heel", ankle)
    foot_index = landmarks.get(f"{side}_foot_index", ankle)

    # Raw segment lengths
    raw_femur = segment_length(hip, knee)
    raw_tibia = segment_length(knee, ankle)
    raw_torso = segment_length(shoulder, hip)

    total_leg = raw_femur + raw_tibia
    if total_leg < 1e-9:
        total_leg = 1.0  # prevent division by zero

    femur_norm = raw_femur / total_leg
    tibia_norm = raw_tibia / total_leg
    torso_norm = raw_torso / total_leg

    femur_tibia_ratio = raw_femur / raw_tibia if raw_tibia > 1e-9 else 1.0
    torso_femur_ratio = raw_torso / raw_femur if raw_femur > 1e-9 else 1.0

    # Standing angles
    standing_knee = calculate_angle(pt(hip), pt(knee), pt(ankle))
    standing_hip = calculate_angle(pt(shoulder), pt(hip), pt(knee))
    standing_trunk = angle_from_vertical(pt(shoulder), pt(hip))
    standing_ankle = calculate_angle(pt(knee), pt(ankle), pt(foot_index))

    # Standing knee width (frontal plane)
    standing_knee_width: float | None = None
    if "left_knee" in landmarks and "right_knee" in landmarks:
        standing_knee_width = abs(
            landmarks["left_knee"].x - landmarks["right_knee"].x
        )

    return CalibrationData(
        standing_knee_angle=standing_knee,
        standing_hip_angle=standing_hip,
        standing_trunk_angle=standing_trunk,
        standing_ankle_angle=standing_ankle,
        femur_length=femur_norm,
        tibia_length=tibia_norm,
        torso_length=torso_norm,
        femur_tibia_ratio=femur_tibia_ratio,
        torso_femur_ratio=torso_femur_ratio,
        standing_knee_width=standing_knee_width,
    )


def get_trunk_angle_range(
    squat_type: SquatType,
    calibration: CalibrationData,
) -> tuple[float, float]:
    """Get the acceptable trunk angle range adjusted for body proportions.

    Longer femurs relative to tibias require more forward lean to keep the
    bar over mid-foot, so the allowable range shifts up.

    Args:
        squat_type: Type of squat being performed.
        calibration: Calibration data from standing frame.

    Returns:
        (min_angle, max_angle) in degrees from vertical.
    """
    base_min, base_max = TRUNK_ANGLE_NORMS.get(
        squat_type, TRUNK_ANGLE_NORMS[SquatType.BODYWEIGHT]
    )

    # Adjust for femur/tibia ratio deviation from 1.0
    # Higher ratio (longer femurs) -> more forward lean allowed
    # PROPORTION_ADJUSTMENT_PER_RATIO = 5.5 (degrees per 0.1 ratio deviation)
    # e.g. ratio 1.3 => deviation 0.3 => 0.3 * 55 = 16.5 degrees
    ratio_deviation = calibration.femur_tibia_ratio - 1.0
    adjustment = ratio_deviation * PROPORTION_ADJUSTMENT_PER_RATIO * 10.0
    adjustment = max(-20.0, min(25.0, adjustment))

    return (base_min + adjustment, base_max + adjustment)


def get_depth_threshold(experience_level: ExperienceLevel) -> float:
    """Get the target knee angle for adequate depth.

    Lower angle = deeper squat.

    Args:
        experience_level: Lifter experience level.

    Returns:
        Knee angle threshold in degrees.
    """
    thresholds = {
        ExperienceLevel.BEGINNER: 110.0,      # Above parallel, learning form safely
        ExperienceLevel.INTERMEDIATE: 100.0,   # Near parallel
        ExperienceLevel.ADVANCED: 90.0,        # At/below parallel
    }
    return thresholds.get(experience_level, 110.0)


def check_competition_depth(hip: Point, knee: Point) -> tuple[bool, float]:
    """Check if hip crease is below top of knee (competition standard).

    Uses Y-coordinates in image space (y increases downward).
    Hip crease is estimated slightly below the hip landmark.

    Args:
        hip: Hip landmark point.
        knee: Knee landmark point.

    Returns:
        (is_deep_enough, margin) where margin is positive if deep enough,
        negative if not deep enough (in normalized units).
    """
    # Hip crease is approximately 10% of femur length below the hip landmark
    hip_crease_offset = abs(hip.y - knee.y) * 0.10
    hip_crease_y = hip.y + hip_crease_offset  # lower in image = deeper

    knee_top_y = knee.y

    margin = hip_crease_y - knee_top_y  # positive = below knee = deep enough
    is_deep = margin > 0

    return (is_deep, margin)
