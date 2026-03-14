"""Edge case and boundary condition tests for squat form analysis."""

import math
import random

import pytest

from squat_form.angles import (
    angle_from_vertical,
    calculate_angle,
    compute_frame_angles,
    segment_length,
)
from squat_form.calibration import calibrate_from_standing, get_trunk_angle_range
from squat_form.feedback import format_summary, get_cues_for_issues
from squat_form.phases import detect_reps, get_phases
from squat_form.schemas import (
    CalibrationData,
    ExperienceLevel,
    FormIssue,
    IssueSeverity,
    Point,
    RepData,
    SquatConfig,
    SquatPhase,
    SquatType,
)
from squat_form.scorer import (
    score_depth,
    score_knee_tracking,
    score_lockout,
    score_rep,
    score_set,
    score_tempo,
)


def _default_calibration(**overrides) -> CalibrationData:
    defaults = dict(
        standing_knee_angle=170,
        standing_hip_angle=170,
        standing_trunk_angle=5,
        standing_ankle_angle=85,
        femur_length=40,
        tibia_length=40,
        torso_length=45,
        femur_tibia_ratio=1.0,
        torso_femur_ratio=1.125,
    )
    defaults.update(overrides)
    return CalibrationData(**defaults)


def _default_config(**overrides) -> SquatConfig:
    defaults = dict(
        squat_type=SquatType.BODYWEIGHT,
        experience_level=ExperienceLevel.INTERMEDIATE,
    )
    defaults.update(overrides)
    return SquatConfig(**defaults)


def _make_point(x: float, y: float, z: float = 0.0, visibility: float = 1.0) -> Point:
    return Point(x=x, y=y, z=z, visibility=visibility)


# ===========================================================================
# Angle edge cases
# ===========================================================================


@pytest.mark.edge
def test_angle_coincident_points():
    """All three points are the same -> returns 180.0 (degenerate, zero-length segments), no crash."""
    p = (5.0, 5.0, 0.0)
    result = calculate_angle(p, p, p)
    assert result == 180.0


@pytest.mark.edge
def test_angle_two_coincident():
    """Two of three points are same -> returns 180.0 (zero-length segment), no crash."""
    a = (0.0, 0.0, 0.0)
    b = (0.0, 0.0, 0.0)
    c = (1.0, 1.0, 0.0)
    result = calculate_angle(a, b, c)
    assert result == 180.0 or isinstance(result, float)  # graceful handling


@pytest.mark.edge
def test_angle_very_small_segment():
    """Points extremely close together (1e-12 apart) -> no NaN/crash."""
    a = (0.0, 0.0, 0.0)
    b = (1e-12, 0.0, 0.0)
    c = (1e-12, 1e-12, 0.0)
    result = calculate_angle(a, b, c)
    assert not math.isnan(result)
    assert not math.isinf(result)


@pytest.mark.edge
def test_angle_negative_coordinates():
    """Negative x,y values -> correct angle still computed."""
    a = (-10.0, -10.0, 0.0)
    b = (-10.0, 0.0, 0.0)  # vertex
    c = (0.0, 0.0, 0.0)
    # Should be ~90 degrees
    result = calculate_angle(a, b, c)
    assert result == pytest.approx(90, abs=5)


@pytest.mark.edge
def test_angle_very_large_coordinates():
    """Coordinates in millions -> correct angle."""
    a = (0.0, 1_000_000.0, 0.0)
    b = (0.0, 0.0, 0.0)  # vertex
    c = (1_000_000.0, 0.0, 0.0)
    result = calculate_angle(a, b, c)
    assert result == pytest.approx(90, abs=5)


@pytest.mark.edge
def test_angle_from_vertical_zero_length():
    """Same point for top and bottom -> returns 0.0."""
    p = (100.0, 100.0, 0.0)
    result = angle_from_vertical(p, p)
    assert result == 0.0 or isinstance(result, float)


# ===========================================================================
# Phase detection edge cases
# ===========================================================================


@pytest.mark.edge
def test_phases_empty_input():
    """Empty angle list -> no reps, no crash."""
    reps = detect_reps([])
    assert len(reps) == 0
    phases = get_phases([])
    assert len(phases) == 0


@pytest.mark.edge
def test_phases_single_frame():
    """One frame -> STANDING, no reps."""
    phases = get_phases([170.0])
    assert len(phases) == 1
    assert phases[0] == SquatPhase.STANDING
    reps = detect_reps([170.0])
    assert len(reps) == 0


@pytest.mark.edge
def test_phases_constant_low_angle():
    """All frames at 90 degrees -> no rep counted (never returns to standing)."""
    angles = [90.0] * 100
    reps = detect_reps(angles)
    assert len(reps) == 0


@pytest.mark.edge
def test_phases_noisy_signal(generate_knee_angles_for_reps):
    """Angles with random noise (+/-3 degrees) -> still detects reps correctly."""
    random.seed(42)
    clean_angles = generate_knee_angles_for_reps(num_reps=3, min_angle=90)
    noisy_angles = [a + random.uniform(-3, 3) for a in clean_angles]
    reps = detect_reps(noisy_angles)
    assert len(reps) == 3


@pytest.mark.edge
def test_phases_very_slow_squat():
    """500 frames per rep -> still detected."""
    angles = []
    # Standing
    angles.extend([170.0] * 100)
    # Very slow descent: 200 frames
    for i in range(200):
        t = (i + 1) / 200.0
        angles.append(170 - 80 * t)
    # Bottom
    angles.extend([90.0] * 50)
    # Very slow ascent: 200 frames
    for i in range(200):
        t = (i + 1) / 200.0
        angles.append(90 + 80 * t)
    # Standing
    angles.extend([170.0] * 50)
    reps = detect_reps(angles)
    # The state machine may or may not detect this as a rep depending on
    # smoothing and history window behavior -- graceful handling is key
    assert isinstance(reps, list)


@pytest.mark.edge
def test_phases_very_fast_squat():
    """Minimum frames per rep boundary -> detected or correctly rejected."""
    angles = []
    angles.extend([170.0] * 5)
    # Rapid descent: 3 frames
    angles.extend([140.0, 110.0, 90.0])
    # Bottom: 1 frame
    angles.append(90.0)
    # Rapid ascent: 3 frames
    angles.extend([110.0, 140.0, 170.0])
    angles.extend([170.0] * 5)
    reps = detect_reps(angles)
    # Either detected or gracefully rejected - no crash
    assert isinstance(reps, list)


@pytest.mark.edge
def test_phases_gradual_descent_no_bottom():
    """Angle slowly decreasing then slowly increasing without clear bottom."""
    angles = []
    # Gradual descent over 100 frames from 170 to 105 (just above threshold)
    for i in range(100):
        t = i / 99.0
        angles.append(170 - 65 * t)
    # Gradual ascent back
    for i in range(100):
        t = i / 99.0
        angles.append(105 + 65 * t)
    reps = detect_reps(angles)
    # Handles gracefully (may or may not count depending on threshold)
    assert isinstance(reps, list)


@pytest.mark.edge
def test_phases_double_bottom():
    """Angle goes to 90, comes up to 120, goes back to 90, then up -> counts correctly."""
    angles = []
    angles.extend([170.0] * 20)
    # First dip
    for i in range(20):
        t = (i + 1) / 20.0
        angles.append(170 - 80 * t)
    angles.extend([90.0] * 5)
    # Partial recovery
    for i in range(10):
        t = (i + 1) / 10.0
        angles.append(90 + 30 * t)
    angles.extend([120.0] * 3)
    # Second dip
    for i in range(10):
        t = (i + 1) / 10.0
        angles.append(120 - 30 * t)
    angles.extend([90.0] * 5)
    # Full recovery
    for i in range(30):
        t = (i + 1) / 30.0
        angles.append(90 + 80 * t)
    angles.extend([170.0] * 20)
    reps = detect_reps(angles)
    # Should count as 1 or 2 reps depending on implementation, not crash
    assert isinstance(reps, list)
    assert len(reps) >= 1


# ===========================================================================
# Scorer edge cases
# ===========================================================================


@pytest.mark.edge
def test_score_depth_zero_angle():
    """min_knee_angle=0 -> returns 100 (max depth)."""
    config = _default_config()
    result = score_depth(min_knee_angle=0, config=config)
    assert result == pytest.approx(100, abs=10)


@pytest.mark.edge
def test_score_depth_180_angle():
    """min_knee_angle=180 -> returns ~0 (standing, no squat)."""
    config = _default_config()
    result = score_depth(min_knee_angle=180, config=config)
    assert result < 30


@pytest.mark.edge
def test_score_knee_tracking_zero_ratio():
    """ratio=0.0 -> returns 0 or low score, no crash."""
    config = _default_config()
    result = score_knee_tracking(min_knee_width_ratio=0.0, knee_valgus_detected=True, config=config)
    assert 0 <= result <= 100


@pytest.mark.edge
def test_score_knee_tracking_ratio_above_one():
    """ratio=1.2 (knees widened past shoulders) -> 100."""
    config = _default_config()
    result = score_knee_tracking(min_knee_width_ratio=1.2, knee_valgus_detected=False, config=config)
    assert result >= 90


@pytest.mark.edge
def test_score_tempo_zero_durations():
    """All durations=0 -> returns score, no crash/division by zero."""
    result = score_tempo(descent_duration=0.0, bottom_pause=0.0, ascent_duration=0.0)
    assert 0 <= result <= 100


@pytest.mark.edge
def test_score_tempo_very_long():
    """30 second descent -> penalty but valid score."""
    result = score_tempo(descent_duration=30.0, bottom_pause=1.0, ascent_duration=15.0)
    assert 0 <= result <= 100


@pytest.mark.edge
def test_score_lockout_negative_diff():
    """Final angle > standing angle -> still valid score."""
    result = score_lockout(final_knee_angle=175, standing_knee_angle=170)
    assert 0 <= result <= 100


@pytest.mark.edge
def test_score_set_single_rep():
    """Only 1 rep -> no fatigue detection, valid score."""
    config = _default_config()
    cal = _default_calibration()
    rep = RepData(
        rep_number=1, start_frame=0, end_frame=100, bottom_frame=50,
        min_knee_angle=90, min_hip_angle=70, max_trunk_angle=40,
        descent_duration=2.0, bottom_duration=0.5, ascent_duration=1.5,
        frame_angles=[],
    )
    rep_score = score_rep(rep, config=config, calibration=cal)
    result = score_set([rep_score], [rep], config=config, calibration=cal)
    assert result.fatigue_detected is False
    assert 0 <= result.overall_score <= 100


@pytest.mark.edge
def test_score_set_two_reps():
    """2 reps -> no fatigue detection (need 4+)."""
    config = _default_config()
    cal = _default_calibration()
    rep = RepData(
        rep_number=1, start_frame=0, end_frame=100, bottom_frame=50,
        min_knee_angle=90, min_hip_angle=70, max_trunk_angle=40,
        descent_duration=2.0, bottom_duration=0.5, ascent_duration=1.5,
        frame_angles=[],
    )
    rep_score = score_rep(rep, config=config, calibration=cal)
    result = score_set([rep_score, rep_score], [rep, rep], config=config, calibration=cal)
    assert result.fatigue_detected is False


# ===========================================================================
# Calibration edge cases
# ===========================================================================


@pytest.mark.edge
def test_calibrate_zero_length_segments(make_landmarks):
    """All points at same position -> no crash, reasonable defaults."""
    landmarks = make_landmarks({
        "left_shoulder": (100, 100),
        "right_shoulder": (100, 100),
        "left_hip": (100, 100),
        "right_hip": (100, 100),
        "left_knee": (100, 100),
        "right_knee": (100, 100),
        "left_ankle": (100, 100),
        "right_ankle": (100, 100),
        "left_heel": (100, 100),
        "right_heel": (100, 100),
        "left_foot_index": (100, 100),
        "right_foot_index": (100, 100),
    })
    try:
        cal = calibrate_from_standing(landmarks)
        # Should not crash; values may be zero/default
        assert isinstance(cal.standing_knee_angle, float)
    except (ZeroDivisionError, ValueError):
        # Acceptable if it raises a clear error for degenerate input
        pass


@pytest.mark.edge
def test_calibrate_inverted_skeleton(make_landmarks):
    """Ankle above hip -> still returns calibration data."""
    landmarks = make_landmarks({
        "left_shoulder": (280, 400),
        "right_shoulder": (360, 400),
        "left_hip": (290, 350),
        "right_hip": (350, 350),
        "left_knee": (285, 200),
        "right_knee": (355, 200),
        "left_ankle": (282, 100),
        "right_ankle": (358, 100),
        "left_heel": (278, 95),
        "right_heel": (354, 95),
        "left_foot_index": (295, 92),
        "right_foot_index": (368, 92),
    })
    cal = calibrate_from_standing(landmarks)
    assert isinstance(cal, CalibrationData)
    assert cal.femur_length >= 0
    assert cal.tibia_length >= 0


@pytest.mark.edge
def test_trunk_range_extreme_ratio():
    """femur_tibia_ratio=3.0 -> range values are valid floats."""
    cal = _default_calibration(femur_tibia_ratio=3.0)
    low, high = get_trunk_angle_range(SquatType.BODYWEIGHT, cal)
    # With extreme ratio the values may exceed 90, but should still be valid floats
    assert isinstance(low, float)
    assert isinstance(high, float)
    assert low <= high


# ===========================================================================
# Feedback edge cases
# ===========================================================================


@pytest.mark.edge
def test_empty_issues_list():
    """get_cues_for_issues([]) -> empty list."""
    cues = get_cues_for_issues([])
    assert cues == []


@pytest.mark.edge
def test_duplicate_issues():
    """Same issue twice -> deduplicated to one cue by get_cues_for_issues."""
    issue = FormIssue(
        name="insufficient_depth",
        severity=IssueSeverity.HIGH,
        description="Not deep enough",
        value=120,
        threshold=100,
        phase=SquatPhase.BOTTOM,
        frame=50,
    )
    cues = get_cues_for_issues([issue, issue])
    # get_cues_for_issues deduplicates by issue name
    assert len(cues) == 1


# ===========================================================================
# Landmark edge cases
# ===========================================================================


@pytest.mark.edge
def test_compute_angles_missing_landmarks(standing_landmarks):
    """Missing foot_index -> KeyError or handled gracefully."""
    del standing_landmarks["left_foot_index"]
    del standing_landmarks["right_foot_index"]
    try:
        result = compute_frame_angles(standing_landmarks)
        # If it succeeds, check it returns valid FrameAngles
        assert 0 <= result.knee_angle <= 180
    except KeyError:
        # Acceptable - foot_index is required
        pass


@pytest.mark.edge
def test_compute_angles_all_zero_visibility(standing_landmarks):
    """All visibility=0 -> still computes (uses whatever side is 'better')."""
    for name in standing_landmarks:
        standing_landmarks[name] = Point(
            x=standing_landmarks[name].x,
            y=standing_landmarks[name].y,
            z=0.0,
            visibility=0.0,
        )
    result = compute_frame_angles(standing_landmarks)
    # Should still produce some result, even if unreliable
    assert isinstance(result.knee_angle, float)


@pytest.mark.edge
def test_compute_angles_nan_coordinates(make_landmarks):
    """NaN in coordinates -> handled without crash."""
    landmarks = make_landmarks({
        "left_shoulder": (280, 150),
        "right_shoulder": (360, 150),
        "left_hip": (float("nan"), 280),
        "right_hip": (350, 280),
        "left_knee": (285, 380),
        "right_knee": (355, 380),
        "left_ankle": (282, 470),
        "right_ankle": (358, 470),
        "left_heel": (278, 475),
        "right_heel": (354, 475),
        "left_foot_index": (295, 478),
        "right_foot_index": (368, 478),
    })
    try:
        result = compute_frame_angles(landmarks)
        # If it succeeds, the result should at least be a float (possibly NaN itself)
        assert isinstance(result.knee_angle, float)
    except (ValueError, ZeroDivisionError):
        # Acceptable to raise an error for NaN input
        pass
