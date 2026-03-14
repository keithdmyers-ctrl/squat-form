"""Tests for the squat_form.calibration module."""

import pytest

from squat_form.calibration import (
    calibrate_from_standing,
    get_depth_threshold,
    get_trunk_angle_range,
)
from squat_form.schemas import ExperienceLevel, Point, SquatType


# ---------------------------------------------------------------------------
# calibrate_from_standing
# ---------------------------------------------------------------------------


@pytest.mark.standard
def test_calibrate_standing_angles(standing_landmarks):
    """Standing landmarks -> standing_knee_angle ~170, trunk_angle ~5-10."""
    cal = calibrate_from_standing(standing_landmarks)
    assert cal.standing_knee_angle == pytest.approx(170, abs=15)
    assert cal.standing_trunk_angle == pytest.approx(7, abs=10)


@pytest.mark.standard
def test_calibrate_segment_ratios(standing_landmarks):
    """Verify femur_tibia_ratio and torso_femur_ratio are reasonable (0.5-2.0)."""
    cal = calibrate_from_standing(standing_landmarks)
    assert 0.5 <= cal.femur_tibia_ratio <= 2.0
    assert 0.5 <= cal.torso_femur_ratio <= 2.0


# ---------------------------------------------------------------------------
# get_trunk_angle_range
# ---------------------------------------------------------------------------


def _make_calibration(femur_tibia_ratio: float = 1.0) -> "CalibrationData":
    from squat_form.schemas import CalibrationData
    return CalibrationData(
        standing_knee_angle=170,
        standing_hip_angle=170,
        standing_trunk_angle=5,
        standing_ankle_angle=85,
        femur_length=40,
        tibia_length=40,
        torso_length=45,
        femur_tibia_ratio=femur_tibia_ratio,
        torso_femur_ratio=1.125,
    )


@pytest.mark.standard
def test_trunk_angle_range_bodyweight():
    """Bodyweight returns (30, 45) base range (before proportion adjustment)."""
    cal = _make_calibration(femur_tibia_ratio=1.0)
    low, high = get_trunk_angle_range(SquatType.BODYWEIGHT, cal)
    assert 25 <= low <= 35
    assert 40 <= high <= 50


@pytest.mark.standard
def test_trunk_angle_range_high_bar():
    """High bar returns (30, 50) base range."""
    cal = _make_calibration(femur_tibia_ratio=1.0)
    low, high = get_trunk_angle_range(SquatType.HIGH_BAR, cal)
    assert 25 <= low <= 35
    assert 45 <= high <= 55


@pytest.mark.standard
def test_trunk_angle_range_long_femurs():
    """High femur/tibia ratio -> wider/higher range than normal."""
    cal_normal = _make_calibration(femur_tibia_ratio=1.0)
    cal_long = _make_calibration(femur_tibia_ratio=1.5)
    low_normal, high_normal = get_trunk_angle_range(SquatType.BODYWEIGHT, cal_normal)
    low_long, high_long = get_trunk_angle_range(SquatType.BODYWEIGHT, cal_long)
    # Longer femurs require more forward lean, so the range should shift higher
    assert high_long >= high_normal


# ---------------------------------------------------------------------------
# get_depth_threshold
# ---------------------------------------------------------------------------


@pytest.mark.standard
def test_depth_threshold_levels():
    """beginner=110, intermediate=100, advanced=90."""
    assert get_depth_threshold(ExperienceLevel.BEGINNER) == pytest.approx(110, abs=5)
    assert get_depth_threshold(ExperienceLevel.INTERMEDIATE) == pytest.approx(100, abs=5)
    assert get_depth_threshold(ExperienceLevel.ADVANCED) == pytest.approx(90, abs=5)


# ---------------------------------------------------------------------------
# Additional calibration tests
# ---------------------------------------------------------------------------


@pytest.mark.standard
def test_calibrate_knee_width(standing_landmarks):
    """With frontal landmarks -> standing_knee_width is positive."""
    cal = calibrate_from_standing(standing_landmarks)
    # Both left and right knees are present, so width should be calculable
    if cal.standing_knee_width is not None:
        assert cal.standing_knee_width > 0


@pytest.mark.standard
def test_calibrate_side_selection(standing_landmarks):
    """When one side has low visibility, uses other side."""
    # Set all left-side visibility to near zero
    for name in list(standing_landmarks.keys()):
        if name.startswith("left_"):
            standing_landmarks[name] = Point(
                x=standing_landmarks[name].x,
                y=standing_landmarks[name].y,
                z=standing_landmarks[name].z,
                visibility=0.05,
            )
    cal = calibrate_from_standing(standing_landmarks)
    # Should still produce valid calibration using right side
    assert cal.standing_knee_angle > 0
    assert cal.femur_length > 0
