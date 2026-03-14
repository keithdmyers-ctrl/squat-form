"""Tests for the squat_form.angles module."""

import math

import pytest

from squat_form.angles import (
    angle_from_vertical,
    calculate_angle,
    compute_frame_angles,
    segment_length,
)
from squat_form.schemas import Point


# ---------------------------------------------------------------------------
# calculate_angle
# ---------------------------------------------------------------------------


@pytest.mark.standard
def test_calculate_angle_right_angle():
    """Points forming a 90-degree angle."""
    a = (0.0, 0.0, 0.0)
    b = (0.0, 1.0, 0.0)  # vertex
    c = (1.0, 1.0, 0.0)
    assert calculate_angle(a, b, c) == pytest.approx(90, abs=5)


@pytest.mark.standard
def test_calculate_angle_straight_line():
    """Collinear points -> 180 degrees."""
    a = (0.0, 0.0, 0.0)
    b = (1.0, 0.0, 0.0)
    c = (2.0, 0.0, 0.0)
    assert calculate_angle(a, b, c) == pytest.approx(180, abs=5)


@pytest.mark.standard
def test_calculate_angle_acute():
    """45-degree angle."""
    a = (0.0, 1.0, 0.0)
    b = (0.0, 0.0, 0.0)  # vertex
    c = (1.0, 1.0, 0.0)
    # Angle at origin between (0,1) and (1,1) should be ~45
    assert calculate_angle(a, b, c) == pytest.approx(45, abs=5)


@pytest.mark.standard
def test_calculate_angle_zero():
    """Coincident points -> 180 (degenerate case, returns 180 for zero-length segments)."""
    p = (5.0, 5.0, 0.0)
    result = calculate_angle(p, p, p)
    assert result == 180.0


@pytest.mark.standard
def test_calculate_angle_obtuse():
    """135-degree angle."""
    # Vertex at origin.  Rays to (1, 0) and (-1, 1) form 135 degrees.
    a = (1.0, 0.0, 0.0)
    b = (0.0, 0.0, 0.0)
    c = (-1.0, 1.0, 0.0)
    expected = math.degrees(math.atan2(1, -1) - math.atan2(0, 1))
    # atan2(1,-1) = 135 deg, atan2(0,1) = 0 deg => diff = 135
    assert calculate_angle(a, b, c) == pytest.approx(135, abs=5)


# ---------------------------------------------------------------------------
# angle_from_vertical
# ---------------------------------------------------------------------------


@pytest.mark.standard
def test_angle_from_vertical_straight_up():
    """Vertical segment -> ~0 degrees from vertical."""
    top = (100.0, 0.0, 0.0)
    bottom = (100.0, 100.0, 0.0)
    assert angle_from_vertical(top, bottom) == pytest.approx(0, abs=5)


@pytest.mark.standard
def test_angle_from_vertical_horizontal():
    """Horizontal segment -> ~90 degrees from vertical."""
    top = (0.0, 100.0, 0.0)
    bottom = (100.0, 100.0, 0.0)
    assert angle_from_vertical(top, bottom) == pytest.approx(90, abs=5)


@pytest.mark.standard
def test_angle_from_vertical_45_degrees():
    """Diagonal segment -> ~45 degrees from vertical."""
    top = (0.0, 0.0, 0.0)
    bottom = (100.0, 100.0, 0.0)
    assert angle_from_vertical(top, bottom) == pytest.approx(45, abs=5)


# ---------------------------------------------------------------------------
# compute_frame_angles
# ---------------------------------------------------------------------------


@pytest.mark.standard
def test_compute_frame_angles_standing(standing_landmarks):
    """Standing posture -> knee angle ~170, trunk angle ~5-10."""
    result = compute_frame_angles(standing_landmarks)
    assert result.knee_angle == pytest.approx(170, abs=15)
    assert result.trunk_angle == pytest.approx(7, abs=10)


@pytest.mark.standard
def test_compute_frame_angles_squat_bottom(bottom_squat_landmarks):
    """Bottom squat posture -> knee angle ~90-120, trunk angle ~20-60."""
    result = compute_frame_angles(bottom_squat_landmarks)
    assert 80 <= result.knee_angle <= 130
    assert 15 <= result.trunk_angle <= 60


@pytest.mark.standard
def test_compute_frame_angles_side_selection(standing_landmarks):
    """When right side has higher visibility, computation uses right side."""
    # Lower left side visibility
    for name in standing_landmarks:
        if name.startswith("left_"):
            standing_landmarks[name].visibility = 0.1
    result = compute_frame_angles(standing_landmarks)
    # Should still produce valid angles (using right side)
    assert 0 <= result.knee_angle <= 180
    assert 0 <= result.trunk_angle <= 90


# ---------------------------------------------------------------------------
# segment_length
# ---------------------------------------------------------------------------


@pytest.mark.standard
def test_segment_length():
    """Two known points -> correct Euclidean distance."""
    a = Point(x=0, y=0)
    b = Point(x=3, y=4)
    assert segment_length(a, b) == pytest.approx(5.0, abs=0.01)


@pytest.mark.standard
def test_segment_length_same_point():
    """Same point -> distance is 0.0."""
    p = Point(x=42, y=99)
    assert segment_length(p, p) == pytest.approx(0.0, abs=0.001)
