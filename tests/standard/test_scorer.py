"""Tests for the squat_form.scorer module."""

import pytest

from squat_form.scorer import (
    _grade,
    score_depth,
    score_knee_tracking,
    score_lockout,
    score_rep,
    score_set,
    score_symmetry,
    score_tempo,
    score_trunk,
)
from squat_form.schemas import (
    CalibrationData,
    ExperienceLevel,
    FormIssue,
    IssueSeverity,
    RepData,
    RepScore,
    SquatConfig,
    SquatPhase,
    SquatType,
)


# ---------------------------------------------------------------------------
# Helper to build minimal CalibrationData
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# _grade
# ---------------------------------------------------------------------------


@pytest.mark.standard
class TestGradeBoundaries:
    def test_grade_a(self):
        assert _grade(90) == "A"

    def test_grade_b(self):
        assert _grade(80) == "B"

    def test_grade_c(self):
        assert _grade(70) == "C"

    def test_grade_d(self):
        assert _grade(60) == "D"

    def test_grade_f(self):
        assert _grade(59) == "F"


# ---------------------------------------------------------------------------
# score_depth
# ---------------------------------------------------------------------------


@pytest.mark.standard
def test_score_depth_full():
    """min_knee_angle=80 (well below threshold) -> 100."""
    config = _default_config()
    result = score_depth(min_knee_angle=80, config=config)
    assert result == pytest.approx(100, abs=10)


@pytest.mark.standard
def test_score_depth_at_threshold():
    """min_knee_angle at threshold -> ~80."""
    config = _default_config()
    # Intermediate threshold is ~100
    result = score_depth(min_knee_angle=100, config=config)
    assert 60 <= result <= 90


@pytest.mark.standard
def test_score_depth_insufficient():
    """min_knee_angle=130 -> low score (<60)."""
    config = _default_config()
    result = score_depth(min_knee_angle=130, config=config)
    assert result < 60


# ---------------------------------------------------------------------------
# score_knee_tracking
# ---------------------------------------------------------------------------


@pytest.mark.standard
def test_score_knee_tracking_good():
    """ratio=0.98 -> 100 (knees tracking well over toes)."""
    config = _default_config()
    result = score_knee_tracking(min_knee_width_ratio=0.98, knee_valgus_detected=False, config=config)
    assert result == pytest.approx(100, abs=10)


@pytest.mark.standard
def test_score_knee_tracking_valgus():
    """ratio=0.75 with valgus -> penalized score (knee caving in).
    Intermediate threshold is 0.75, so ratio is at threshold (score ~80).
    Valgus penalty is -5, resulting in ~75."""
    config = _default_config()
    result = score_knee_tracking(min_knee_width_ratio=0.75, knee_valgus_detected=True, config=config)
    assert result < 80


@pytest.mark.standard
def test_score_knee_tracking_no_data():
    """None ratio, no valgus -> 75 default (reduced confidence without front view)."""
    config = _default_config()
    result = score_knee_tracking(min_knee_width_ratio=None, knee_valgus_detected=False, config=config)
    assert result == pytest.approx(75, abs=10)


# ---------------------------------------------------------------------------
# score_trunk
# ---------------------------------------------------------------------------


@pytest.mark.standard
def test_score_trunk_in_range():
    """Trunk angle within normal range -> 100."""
    config = _default_config()
    cal = _default_calibration()
    # Bodyweight normal range is about 30-45 degrees
    result = score_trunk(max_trunk_angle=37, config=config, calibration=cal)
    assert result == pytest.approx(100, abs=10)


@pytest.mark.standard
def test_score_trunk_excessive():
    """Trunk angle way beyond normal range -> low score.
    Bodyweight range is (25, 45), intermediate tolerance is 15.
    At 75 degrees: deviation=30, score = 85 - (30-15)*1.5 = 62.5."""
    config = _default_config()
    cal = _default_calibration()
    result = score_trunk(max_trunk_angle=75, config=config, calibration=cal)
    assert result < 70


# ---------------------------------------------------------------------------
# score_symmetry
# ---------------------------------------------------------------------------


@pytest.mark.standard
def test_score_symmetry_perfect():
    """asymmetry=0 -> 100."""
    result = score_symmetry(max_hip_asymmetry=0.0)
    assert result == pytest.approx(100, abs=5)


# ---------------------------------------------------------------------------
# score_tempo
# ---------------------------------------------------------------------------


@pytest.mark.standard
def test_score_tempo_ideal():
    """2s descent, 0.5s pause, 1.5s ascent -> ~100."""
    result = score_tempo(descent_duration=2.0, bottom_pause=0.5, ascent_duration=1.5)
    assert result >= 85


@pytest.mark.standard
def test_score_tempo_too_fast():
    """0.5s descent -> penalized."""
    result = score_tempo(descent_duration=0.5, bottom_pause=0.0, ascent_duration=0.5)
    assert result < 85


# ---------------------------------------------------------------------------
# score_lockout
# ---------------------------------------------------------------------------


@pytest.mark.standard
def test_score_lockout_full():
    """Final knee angle within 5 degrees of standing -> 100."""
    result = score_lockout(final_knee_angle=168, standing_knee_angle=170)
    assert result == pytest.approx(100, abs=10)


# ---------------------------------------------------------------------------
# score_rep
# ---------------------------------------------------------------------------


@pytest.mark.standard
def test_score_rep_returns_valid_scores():
    """All sub-scores between 0-100 and grade is valid."""
    config = _default_config()
    cal = _default_calibration()
    rep = RepData(
        rep_number=1,
        start_frame=0,
        end_frame=100,
        bottom_frame=50,
        min_knee_angle=90,
        min_hip_angle=70,
        max_trunk_angle=40,
        descent_duration=2.0,
        bottom_duration=0.5,
        ascent_duration=1.5,
        frame_angles=[],
    )
    result = score_rep(rep, config=config, calibration=cal)
    assert 0 <= result.depth_score <= 100
    assert 0 <= result.knee_tracking_score <= 100
    assert 0 <= result.trunk_score <= 100
    assert 0 <= result.symmetry_score <= 100
    assert 0 <= result.tempo_score <= 100
    assert 0 <= result.lockout_score <= 100
    assert 0 <= result.overall_score <= 100
    assert result.grade in ("A", "B", "C", "D", "F")


# ---------------------------------------------------------------------------
# score_set
# ---------------------------------------------------------------------------


@pytest.mark.standard
def test_score_set_fatigue_detection():
    """Last 2 reps scored 20+ below first 2 -> fatigue_detected=True."""
    config = _default_config()
    cal = _default_calibration()
    # Build reps where the last 2 are significantly worse
    good_rep = RepData(
        rep_number=1, start_frame=0, end_frame=100, bottom_frame=50,
        min_knee_angle=85, min_hip_angle=70, max_trunk_angle=40,
        descent_duration=2.0, bottom_duration=0.5, ascent_duration=1.5,
        frame_angles=[],
    )
    bad_rep = RepData(
        rep_number=4, start_frame=400, end_frame=500, bottom_frame=450,
        min_knee_angle=130, min_hip_angle=120, max_trunk_angle=65,
        descent_duration=0.5, bottom_duration=0.0, ascent_duration=0.3,
        frame_angles=[],
    )
    rep_data_list = [good_rep, good_rep, bad_rep, bad_rep]
    rep_scores = [score_rep(r, config=config, calibration=cal) for r in rep_data_list]
    result = score_set(rep_scores, rep_data_list, config=config, calibration=cal)
    assert result.fatigue_detected is True


@pytest.mark.standard
def test_score_set_empty():
    """Empty rep list -> grade F, score 0."""
    config = _default_config()
    cal = _default_calibration()
    result = score_set([], [], config=config, calibration=cal)
    assert result.grade == "F"
    assert result.overall_score == pytest.approx(0, abs=5)


@pytest.mark.standard
@pytest.mark.parametrize(
    "min_knee_angle,max_trunk,descent,ascent",
    [
        (0, 0, 0.01, 0.01),       # extreme low angles, near-zero time
        (180, 90, 60, 60),         # no squat, extreme trunk, long time
        (90, 45, 2.0, 1.5),       # normal values
        (45, 10, 0.1, 0.1),       # very deep, very upright, very fast
    ],
)
def test_all_scores_bounded(min_knee_angle, max_trunk, descent, ascent):
    """Parametrized with extreme values -> all scores 0-100."""
    config = _default_config()
    cal = _default_calibration()
    rep = RepData(
        rep_number=1, start_frame=0, end_frame=100, bottom_frame=50,
        min_knee_angle=min_knee_angle, min_hip_angle=70,
        max_trunk_angle=max_trunk,
        descent_duration=descent, bottom_duration=0.0,
        ascent_duration=ascent,
        frame_angles=[],
    )
    result = score_rep(rep, config=config, calibration=cal)
    assert 0 <= result.depth_score <= 100
    assert 0 <= result.knee_tracking_score <= 100
    assert 0 <= result.trunk_score <= 100
    assert 0 <= result.symmetry_score <= 100
    assert 0 <= result.tempo_score <= 100
    assert 0 <= result.lockout_score <= 100
    assert 0 <= result.overall_score <= 100
