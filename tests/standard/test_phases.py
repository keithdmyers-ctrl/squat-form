"""Tests for the squat_form.phases module."""

import pytest

from squat_form.phases import PhaseDetector, detect_reps, get_phases, RepRange
from squat_form.schemas import SquatPhase


@pytest.mark.standard
def test_standing_stays_standing(generate_knee_angles_for_reps):
    """Constant 170-degree input -> always STANDING, 0 reps."""
    angles = [170.0] * 100
    phases = get_phases(angles)
    assert len(phases) == len(angles)
    assert all(p == SquatPhase.STANDING for p in phases)
    reps = detect_reps(angles)
    assert len(reps) == 0


@pytest.mark.standard
def test_single_rep_detection(generate_knee_angles_for_reps):
    """Sequence 170->90->170 -> detects exactly 1 rep."""
    angles = generate_knee_angles_for_reps(num_reps=1, min_angle=90)
    reps = detect_reps(angles)
    assert len(reps) == 1


@pytest.mark.standard
def test_multi_rep_detection(generate_knee_angles_for_reps):
    """3-rep sequence -> detects 3 reps."""
    angles = generate_knee_angles_for_reps(num_reps=3, min_angle=90)
    reps = detect_reps(angles)
    assert len(reps) == 3


@pytest.mark.standard
def test_phase_transitions(generate_knee_angles_for_reps):
    """Verify correct phase sequence: STANDING->DESCENDING->BOTTOM->ASCENDING->STANDING."""
    angles = generate_knee_angles_for_reps(num_reps=1, min_angle=90)
    phases = get_phases(angles)

    # Collect unique transitions
    seen_transitions = []
    prev = phases[0]
    for phase in phases[1:]:
        if phase != prev:
            seen_transitions.append((prev, phase))
            prev = phase

    # Should see at least these transitions in order
    expected = [
        (SquatPhase.STANDING, SquatPhase.DESCENDING),
        (SquatPhase.DESCENDING, SquatPhase.BOTTOM),
        (SquatPhase.BOTTOM, SquatPhase.ASCENDING),
        (SquatPhase.ASCENDING, SquatPhase.STANDING),
    ]
    for transition in expected:
        assert transition in seen_transitions, f"Missing transition {transition}"


@pytest.mark.standard
def test_rep_frame_ranges(generate_knee_angles_for_reps):
    """Verify start_frame, end_frame, bottom_frame are reasonable."""
    angles = generate_knee_angles_for_reps(num_reps=2, min_angle=90)
    reps = detect_reps(angles)
    assert len(reps) >= 2

    for rep in reps:
        assert rep.start_frame >= 0
        assert rep.end_frame > rep.start_frame
        assert rep.start_frame <= rep.bottom_frame <= rep.end_frame
        assert rep.end_frame < len(angles)


@pytest.mark.standard
def test_min_knee_angle_tracking(generate_knee_angles_for_reps):
    """Verify min_knee_angle in RepRange matches actual minimum."""
    min_angle = 85.0
    angles = generate_knee_angles_for_reps(num_reps=1, min_angle=min_angle)
    reps = detect_reps(angles)
    assert len(reps) == 1
    # The tracked min should be close to the actual minimum angle
    assert reps[0].min_knee_angle == pytest.approx(min_angle, abs=5)


@pytest.mark.standard
def test_shallow_movement_ignored(generate_knee_angles_for_reps):
    """Small fluctuations (170->155->170) don't count as reps."""
    angles = generate_knee_angles_for_reps(num_reps=1, min_angle=155)
    reps = detect_reps(angles)
    assert len(reps) == 0


@pytest.mark.standard
def test_get_phases_length(generate_knee_angles_for_reps):
    """get_phases returns list same length as input."""
    angles = generate_knee_angles_for_reps(num_reps=2, min_angle=90)
    phases = get_phases(angles)
    assert len(phases) == len(angles)


@pytest.mark.standard
def test_detector_reset():
    """After reset(), detector is in STANDING with 0 reps."""
    detector = PhaseDetector()
    # Feed some frames
    for angle in [170, 150, 130, 110, 90, 110, 130, 150, 170]:
        detector.update(angle)
    # Now reset
    detector.reset()
    assert detector._phase == SquatPhase.STANDING
    assert len(detector.completed_reps) == 0


@pytest.mark.standard
def test_partial_rep_not_counted(generate_knee_angles_for_reps):
    """Sequence that descends but doesn't return to standing -> no complete rep."""
    # Just the descent portion: 170 -> 90, never returning
    angles = []
    for i in range(60):
        t = i / 59.0
        angles.append(170 - 80 * t)
    reps = detect_reps(angles)
    assert len(reps) == 0
