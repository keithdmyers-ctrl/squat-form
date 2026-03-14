"""Pure math functions for computing squat-related joint angles."""

from __future__ import annotations

import math
from typing import Optional

from squat_form.schemas import FrameAngles, Point


def calculate_angle(
    a: tuple[float, float, float],
    b: tuple[float, float, float],
    c: tuple[float, float, float],
) -> float:
    """Calculate the angle at vertex b formed by segments ba and bc using 3D coordinates.

    Uses x, y, and z for full 3D angle computation. When z is 0 (world
    landmarks unavailable), this gracefully falls back to 2D behavior.

    Args:
        a: First point (x, y, z).
        b: Vertex point (x, y, z).
        c: Third point (x, y, z).

    Returns:
        Angle in degrees, clamped to [0, 180].
    """
    bax, bay, baz = a[0] - b[0], a[1] - b[1], a[2] - b[2]
    bcx, bcy, bcz = c[0] - b[0], c[1] - b[1], c[2] - b[2]

    len_ba = math.sqrt(bax * bax + bay * bay + baz * baz)
    len_bc = math.sqrt(bcx * bcx + bcy * bcy + bcz * bcz)

    if len_ba < 1e-9 or len_bc < 1e-9:
        return 180.0

    cos_angle = (bax * bcx + bay * bcy + baz * bcz) / (len_ba * len_bc)
    cos_angle = max(-1.0, min(1.0, cos_angle))
    return math.degrees(math.acos(cos_angle))


def angle_from_vertical(
    top: tuple[float, float, float], bottom: tuple[float, float, float]
) -> float:
    """Calculate the angle of a segment from the vertical axis using 3D coordinates.

    In image coordinates y increases downward, so the vertical (upward)
    direction is (0, -1, 0).  The segment direction is from *bottom*
    toward *top* (i.e. the anatomical direction "upward along the body").

    Uses x, y, and z for full 3D angle computation. When z is 0 (world
    landmarks unavailable), this gracefully falls back to 2D behavior.

    Args:
        top: Upper point (x, y, z) in image coords.
        bottom: Lower point (x, y, z) in image coords.

    Returns:
        Angle in degrees from vertical [0, 180].
    """
    sx, sy, sz = top[0] - bottom[0], top[1] - bottom[1], top[2] - bottom[2]

    seg_len = math.sqrt(sx * sx + sy * sy + sz * sz)
    if seg_len < 1e-9:
        return 0.0

    # dot product with vertical (0, -1, 0) simplifies to -sy
    cos_angle = -sy / seg_len
    cos_angle = max(-1.0, min(1.0, cos_angle))
    return math.degrees(math.acos(cos_angle))


def segment_length(a: Point, b: Point) -> float:
    """3D Euclidean distance between two Points. Falls back to 2D when z is 0."""
    return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)


def _pick_side(landmarks: dict[str, Point]) -> str:
    """Pick the side (left/right) with better average visibility."""
    left_keys = [k for k in landmarks if k.startswith("left_")]
    right_keys = [k for k in landmarks if k.startswith("right_")]

    left_vis = (
        sum(landmarks[k].visibility for k in left_keys) / len(left_keys)
        if left_keys
        else 0.0
    )
    right_vis = (
        sum(landmarks[k].visibility for k in right_keys) / len(right_keys)
        if right_keys
        else 0.0
    )

    return "left" if left_vis >= right_vis else "right"


def pt(p: Point) -> tuple[float, float, float]:
    """Convert Point to (x, y, z) tuple for 3D angle computation."""
    return (p.x, p.y, p.z)


def compute_frame_angles(
    landmarks: dict[str, Point],
    standing_knee_width: Optional[float] = None,
) -> FrameAngles:
    """Compute all relevant squat angles from a set of landmarks.

    Args:
        landmarks: Dict mapping landmark names to Point objects.
            Expected keys include left/right_shoulder, _hip, _knee,
            _ankle, _heel, _foot_index.
        standing_knee_width: Standing-frame knee width for ratio computation.

    Returns:
        FrameAngles with all computed angles.
    """
    side = _pick_side(landmarks)

    try:
        shoulder = landmarks[f"{side}_shoulder"]
        hip = landmarks[f"{side}_hip"]
        knee = landmarks[f"{side}_knee"]
        ankle = landmarks[f"{side}_ankle"]
    except KeyError:
        # Partial pose with missing critical landmarks — return safe defaults
        return FrameAngles(
            knee_angle=180.0,
            hip_angle=180.0,
            ankle_angle=90.0,
            trunk_angle=0.0,
            shin_angle=0.0,
            knee_width_ratio=None,
            hip_symmetry=None,
        )
    heel = landmarks.get(f"{side}_heel", ankle)
    foot_index = landmarks.get(f"{side}_foot_index", ankle)

    # Knee angle: hip-knee-ankle
    knee_angle = calculate_angle(pt(hip), pt(knee), pt(ankle))

    # Hip angle: shoulder-hip-knee
    hip_angle = calculate_angle(pt(shoulder), pt(hip), pt(knee))

    # Ankle angle: knee-ankle-foot_index
    ankle_angle = calculate_angle(pt(knee), pt(ankle), pt(foot_index))

    # Trunk angle: angle of torso (shoulder->hip) from vertical
    trunk_angle = angle_from_vertical(pt(shoulder), pt(hip))

    # Shin angle: angle of shin (knee->ankle) from vertical
    shin_angle = angle_from_vertical(pt(knee), pt(ankle))

    # Knee width ratio (frontal view): current knee distance / standing knee distance
    knee_width_ratio: Optional[float] = None
    if (
        "left_knee" in landmarks
        and "right_knee" in landmarks
        and standing_knee_width is not None
        and standing_knee_width > 1e-9
    ):
        current_width = abs(landmarks["left_knee"].x - landmarks["right_knee"].x)
        knee_width_ratio = current_width / standing_knee_width

    # Hip symmetry: difference in left vs right hip y-position, normalized
    hip_symmetry: Optional[float] = None
    if "left_hip" in landmarks and "right_hip" in landmarks:
        left_hip = landmarks["left_hip"]
        right_hip = landmarks["right_hip"]
        hip_width = abs(left_hip.x - right_hip.x)
        if hip_width > 1e-9:
            hip_symmetry = abs(left_hip.y - right_hip.y) / hip_width

    return FrameAngles(
        knee_angle=knee_angle,
        hip_angle=hip_angle,
        ankle_angle=ankle_angle,
        trunk_angle=trunk_angle,
        shin_angle=shin_angle,
        knee_width_ratio=knee_width_ratio,
        hip_symmetry=hip_symmetry,
    )
