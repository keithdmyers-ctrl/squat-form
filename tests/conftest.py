"""Shared test fixtures for squat form analysis tests."""

import math
from typing import Optional

import pytest

from squat_form.schemas import (
    CameraView,
    ExperienceLevel,
    Point,
    SquatConfig,
    SquatType,
)


def _make_point(x: float, y: float, z: float = 0.0, visibility: float = 1.0) -> Point:
    """Helper to create a Point with defaults."""
    return Point(x=x, y=y, z=z, visibility=visibility)


@pytest.fixture
def standing_landmarks() -> dict[str, Point]:
    """Landmarks representing a person standing upright in a 640x480 image."""
    return {
        "left_shoulder": _make_point(280, 150),
        "right_shoulder": _make_point(360, 150),
        "left_hip": _make_point(290, 280),
        "right_hip": _make_point(350, 280),
        "left_knee": _make_point(285, 380),
        "right_knee": _make_point(355, 380),
        "left_ankle": _make_point(282, 470),
        "right_ankle": _make_point(358, 470),
        "left_heel": _make_point(278, 475),
        "right_heel": _make_point(354, 475),
        "left_foot_index": _make_point(295, 478),
        "right_foot_index": _make_point(368, 478),
    }


@pytest.fixture
def bottom_squat_landmarks() -> dict[str, Point]:
    """Landmarks at the bottom of a proper parallel squat.

    Hips lowered, knees bent ~100 degrees, torso leaned forward ~45 degrees.
    """
    return {
        "left_shoulder": _make_point(250, 230),
        "right_shoulder": _make_point(330, 230),
        "left_hip": _make_point(300, 350),
        "right_hip": _make_point(340, 350),
        "left_knee": _make_point(260, 390),
        "right_knee": _make_point(380, 390),
        "left_ankle": _make_point(282, 470),
        "right_ankle": _make_point(358, 470),
        "left_heel": _make_point(278, 475),
        "right_heel": _make_point(354, 475),
        "left_foot_index": _make_point(295, 478),
        "right_foot_index": _make_point(368, 478),
    }


@pytest.fixture
def squat_config() -> SquatConfig:
    """Default squat configuration: bodyweight, intermediate, side view."""
    return SquatConfig(
        squat_type=SquatType.BODYWEIGHT,
        experience_level=ExperienceLevel.INTERMEDIATE,
        camera_view=CameraView.SIDE,
    )


@pytest.fixture
def make_landmarks():
    """Factory function to create a landmark dict from simplified position dict.

    Usage:
        landmarks = make_landmarks({
            "left_shoulder": (280, 150),
            "right_shoulder": (360, 150),
            ...
        })

    Positions can be (x, y), (x, y, z), or (x, y, z, visibility).
    """

    def _factory(positions: dict) -> dict[str, Point]:
        result = {}
        for name, pos in positions.items():
            if len(pos) == 2:
                result[name] = _make_point(pos[0], pos[1])
            elif len(pos) == 3:
                result[name] = _make_point(pos[0], pos[1], z=pos[2])
            elif len(pos) == 4:
                result[name] = _make_point(pos[0], pos[1], z=pos[2], visibility=pos[3])
            else:
                raise ValueError(f"Position for {name} must have 2-4 elements, got {len(pos)}")
        return result

    return _factory


def _interpolate_landmarks(
    standing: dict[str, Point],
    bottom: dict[str, Point],
    t: float,
) -> dict[str, Point]:
    """Linearly interpolate between standing and bottom positions.

    t=0 -> standing, t=1 -> bottom.
    """
    result = {}
    for name in standing:
        s = standing[name]
        b = bottom[name]
        result[name] = _make_point(
            x=s.x + (b.x - s.x) * t,
            y=s.y + (b.y - s.y) * t,
            z=s.z + (b.z - s.z) * t,
            visibility=s.visibility,
        )
    return result


@pytest.fixture
def generate_squat_sequence():
    """Generate a synthetic sequence of landmarks for a multi-rep squat.

    Returns (list_of_frame_landmarks, fps).
    Each rep: 30 frames standing, 45 frames descending, 10 frames at bottom,
              45 frames ascending, 15 frames standing.
    Total frames per rep: 145.
    """

    def _generate(
        num_reps: int = 3,
        depth_angle: float = 90.0,
        fps: float = 30.0,
    ) -> tuple[list[dict[str, Point]], float]:
        # Define standing and bottom landmark templates
        standing = {
            "left_shoulder": _make_point(280, 150),
            "right_shoulder": _make_point(360, 150),
            "left_hip": _make_point(290, 280),
            "right_hip": _make_point(350, 280),
            "left_knee": _make_point(285, 380),
            "right_knee": _make_point(355, 380),
            "left_ankle": _make_point(282, 470),
            "right_ankle": _make_point(358, 470),
            "left_heel": _make_point(278, 475),
            "right_heel": _make_point(354, 475),
            "left_foot_index": _make_point(295, 478),
            "right_foot_index": _make_point(368, 478),
        }

        # Scale the bottom position based on depth_angle.
        # depth_angle=90 -> full depth (t=1.0), depth_angle=170 -> barely any movement
        depth_fraction = max(0.0, min(1.0, (170.0 - depth_angle) / 80.0))

        bottom = {
            "left_shoulder": _make_point(250, 150 + 80 * depth_fraction),
            "right_shoulder": _make_point(330, 150 + 80 * depth_fraction),
            "left_hip": _make_point(300, 280 + 70 * depth_fraction),
            "right_hip": _make_point(340, 280 + 70 * depth_fraction),
            "left_knee": _make_point(260, 380 + 10 * depth_fraction),
            "right_knee": _make_point(380, 380 + 10 * depth_fraction),
            "left_ankle": _make_point(282, 470),
            "right_ankle": _make_point(358, 470),
            "left_heel": _make_point(278, 475),
            "right_heel": _make_point(354, 475),
            "left_foot_index": _make_point(295, 478),
            "right_foot_index": _make_point(368, 478),
        }

        frames: list[dict[str, Point]] = []

        for _rep in range(num_reps):
            # Standing phase: 30 frames
            for _ in range(30):
                frames.append(_interpolate_landmarks(standing, bottom, 0.0))

            # Descending phase: 45 frames (t goes 0 -> 1)
            for i in range(45):
                t = (i + 1) / 45.0
                frames.append(_interpolate_landmarks(standing, bottom, t))

            # Bottom phase: 10 frames
            for _ in range(10):
                frames.append(_interpolate_landmarks(standing, bottom, 1.0))

            # Ascending phase: 45 frames (t goes 1 -> 0)
            for i in range(45):
                t = 1.0 - (i + 1) / 45.0
                frames.append(_interpolate_landmarks(standing, bottom, t))

            # Standing recovery: 15 frames
            for _ in range(15):
                frames.append(_interpolate_landmarks(standing, bottom, 0.0))

        return frames, fps

    return _generate


@pytest.fixture
def generate_knee_angles_for_reps():
    """Generate just the knee angles for a squat sequence (simpler than full landmarks).

    Each rep: 30 frames at standing_angle, 45 frames descending,
    10 frames at min_angle, 45 frames ascending, 15 frames at standing_angle.
    """

    def _generate(
        num_reps: int = 3,
        min_angle: float = 90.0,
        standing_angle: float = 170.0,
    ) -> list[float]:
        angles: list[float] = []

        for _rep in range(num_reps):
            # Standing phase
            angles.extend([standing_angle] * 30)

            # Descending phase: linearly interpolate from standing to min
            for i in range(45):
                t = (i + 1) / 45.0
                angle = standing_angle + (min_angle - standing_angle) * t
                angles.append(angle)

            # Bottom phase
            angles.extend([min_angle] * 10)

            # Ascending phase: linearly interpolate from min to standing
            for i in range(45):
                t = (i + 1) / 45.0
                angle = min_angle + (standing_angle - min_angle) * t
                angles.append(angle)

            # Standing recovery
            angles.extend([standing_angle] * 15)

        return angles

    return _generate
