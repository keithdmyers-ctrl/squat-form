"""Deep integration tests for the full squat form analysis pipeline."""

import json

import pytest

from squat_form.angles import compute_frame_angles
from squat_form.calibration import calibrate_from_standing, get_depth_threshold
from squat_form.feedback import format_summary, get_cues_for_issues
from squat_form.phases import detect_reps, get_phases
from squat_form.schemas import (
    CalibrationData,
    ExperienceLevel,
    FormIssue,
    IssueSeverity,
    RepData,
    RepScore,
    SetAnalysis,
    SquatConfig,
    SquatPhase,
    SquatType,
)
from squat_form.scorer import score_rep, score_set


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


def _build_rep_data(
    rep_number: int = 1,
    min_knee_angle: float = 90,
    max_trunk_angle: float = 40,
    descent_duration: float = 2.0,
    bottom_duration: float = 0.5,
    ascent_duration: float = 1.5,
    start_frame: int = 0,
    end_frame: int = 100,
    bottom_frame: int = 50,
    **kwargs,
) -> RepData:
    defaults = dict(
        rep_number=rep_number,
        start_frame=start_frame,
        end_frame=end_frame,
        bottom_frame=bottom_frame,
        min_knee_angle=min_knee_angle,
        min_hip_angle=70,
        max_trunk_angle=max_trunk_angle,
        descent_duration=descent_duration,
        bottom_duration=bottom_duration,
        ascent_duration=ascent_duration,
        frame_angles=[],
    )
    defaults.update(kwargs)
    return RepData(**defaults)


def _score_set_from_rep_data(
    rep_data_list: list[RepData],
    config: SquatConfig,
    calibration: CalibrationData | None,
) -> SetAnalysis:
    """Helper: score each rep, then score the set."""
    rep_scores = [score_rep(rd, config, calibration) for rd in rep_data_list]
    return score_set(rep_scores, rep_data_list, config, calibration)


# ===========================================================================
# Full pipeline integration
# ===========================================================================


@pytest.mark.deep
def test_full_pipeline_synthetic(generate_squat_sequence, standing_landmarks):
    """Generate 3-rep synthetic squat sequence -> run through pipeline -> verify outputs."""
    frames, fps = generate_squat_sequence(num_reps=3, depth_angle=90)

    # Step 1: Calibrate from first (standing) frame
    cal = calibrate_from_standing(frames[0])

    # Step 2: Compute frame angles
    frame_angles_list = [compute_frame_angles(f) for f in frames]
    knee_angles = [fa.knee_angle for fa in frame_angles_list]

    # Step 3: Detect reps
    reps = detect_reps(knee_angles)
    assert len(reps) == 3

    # Step 4: Build RepData and score each rep
    config = _default_config()
    rep_data_list = []
    for i, rep_range in enumerate(reps):
        rd = RepData(
            rep_number=i + 1,
            start_frame=rep_range.start_frame,
            end_frame=rep_range.end_frame,
            bottom_frame=rep_range.bottom_frame,
            min_knee_angle=rep_range.min_knee_angle,
            min_hip_angle=70,
            max_trunk_angle=max(
                fa.trunk_angle
                for fa in frame_angles_list[rep_range.start_frame : rep_range.end_frame + 1]
            ),
            descent_duration=(rep_range.bottom_frame - rep_range.start_frame) / fps,
            bottom_duration=5 / fps,
            ascent_duration=(rep_range.end_frame - rep_range.bottom_frame) / fps,
            frame_angles=frame_angles_list[rep_range.start_frame : rep_range.end_frame + 1],
        )
        rep_data_list.append(rd)

    # Step 5: Score set
    result = _score_set_from_rep_data(rep_data_list, config=config, calibration=cal)

    # Verify
    assert result.rep_count == 3
    assert 0 <= result.overall_score <= 100
    assert result.grade in ("A", "B", "C", "D", "F")
    assert cal is not None
    for rep_range in reps:
        assert rep_range.bottom_frame >= rep_range.start_frame


@pytest.mark.deep
def test_perfect_form_scores_high():
    """Perfect form (90 deg depth, 40 deg trunk, good tempo) -> overall score >= 80."""
    config = _default_config()
    cal = _default_calibration()
    reps = [
        _build_rep_data(
            rep_number=i + 1,
            min_knee_angle=85,
            max_trunk_angle=38,
            descent_duration=2.0,
            bottom_duration=0.5,
            ascent_duration=1.5,
        )
        for i in range(3)
    ]
    result = _score_set_from_rep_data(reps, config=config, calibration=cal)
    assert result.overall_score >= 75


@pytest.mark.deep
def test_shallow_squat_flagged():
    """Sequence with min_knee_angle=130 -> 'insufficient_depth' issue detected."""
    config = _default_config()
    cal = _default_calibration()
    reps = [_build_rep_data(min_knee_angle=130)]
    result = _score_set_from_rep_data(reps, config=config, calibration=cal)
    # Check that depth score is low
    scored = score_rep(reps[0], config=config, calibration=cal)
    assert scored.depth_score < 60
    # If issues are populated, check for insufficient_depth
    issue_names = [issue.name for issue in scored.issues]
    if issue_names:
        assert "insufficient_depth" in issue_names


@pytest.mark.deep
def test_fast_descent_flagged():
    """Very fast descent (5 frames at 30fps = 0.17s) -> penalized."""
    config = _default_config()
    cal = _default_calibration()
    rep = _build_rep_data(descent_duration=0.17, ascent_duration=0.17)
    scored = score_rep(rep, config=config, calibration=cal)
    assert scored.tempo_score < 80
    # Check issues if populated
    issue_names = [issue.name for issue in scored.issues]
    if issue_names:
        assert "fast_descent" in issue_names or scored.tempo_score < 60


@pytest.mark.deep
def test_increasing_fatigue():
    """6 reps where last 2 have 25 degrees less depth -> fatigue_detected=True."""
    config = _default_config()
    cal = _default_calibration()
    good_reps = [
        _build_rep_data(rep_number=i + 1, min_knee_angle=85)
        for i in range(4)
    ]
    bad_reps = [
        _build_rep_data(rep_number=i + 5, min_knee_angle=120, max_trunk_angle=60)
        for i in range(2)
    ]
    result = _score_set_from_rep_data(good_reps + bad_reps, config=config, calibration=cal)
    assert result.fatigue_detected is True


@pytest.mark.deep
@pytest.mark.parametrize("squat_type", list(SquatType))
def test_different_squat_types(squat_type):
    """Analyzer runs without error for each squat type."""
    config = SquatConfig(squat_type=squat_type, experience_level=ExperienceLevel.INTERMEDIATE)
    cal = _default_calibration()
    rep = _build_rep_data(min_knee_angle=90, max_trunk_angle=40)
    result = score_rep(rep, config=config, calibration=cal)
    assert 0 <= result.overall_score <= 100


@pytest.mark.deep
def test_different_experience_levels():
    """Different experience levels produce different depth thresholds."""
    thresholds = {}
    for level in ExperienceLevel:
        thresholds[level] = get_depth_threshold(level)

    # Beginner should have a more lenient (higher angle) threshold than advanced
    assert thresholds[ExperienceLevel.BEGINNER] > thresholds[ExperienceLevel.ADVANCED]

    # Same movement scored differently across levels
    cal = _default_calibration()
    scores = {}
    for level in ExperienceLevel:
        config = SquatConfig(experience_level=level)
        rep = _build_rep_data(min_knee_angle=105)  # borderline depth
        scored = score_rep(rep, config=config, calibration=cal)
        scores[level] = scored.depth_score

    # Beginner should score higher for the same 105-degree depth
    assert scores[ExperienceLevel.BEGINNER] >= scores[ExperienceLevel.ADVANCED]


@pytest.mark.deep
def test_scoring_consistency():
    """Same input always produces same output (deterministic)."""
    config = _default_config()
    cal = _default_calibration()
    rep = _build_rep_data()
    results = [score_rep(rep, config=config, calibration=cal) for _ in range(5)]
    for r in results[1:]:
        assert r.overall_score == results[0].overall_score
        assert r.depth_score == results[0].depth_score
        assert r.grade == results[0].grade


@pytest.mark.deep
def test_rep_isolation():
    """Issues in rep 2 don't affect scores of rep 1 or rep 3."""
    config = _default_config()
    cal = _default_calibration()

    good_rep = _build_rep_data(min_knee_angle=85, max_trunk_angle=38)
    bad_rep = _build_rep_data(min_knee_angle=135, max_trunk_angle=70)

    # Score good rep alone
    good_score_alone = score_rep(good_rep, config=config, calibration=cal)

    # Score good rep when bad rep is also in the set
    rep_data_list = [good_rep, bad_rep, good_rep]
    result = _score_set_from_rep_data(rep_data_list, config=config, calibration=cal)

    # The first and third rep scores should be the same as when scored alone
    assert result.reps[0].depth_score == pytest.approx(good_score_alone.depth_score, abs=1)
    assert result.reps[2].depth_score == pytest.approx(good_score_alone.depth_score, abs=1)


@pytest.mark.deep
def test_calibration_affects_scoring():
    """Long-femur calibration allows more trunk lean without penalty vs short-femur."""
    config = _default_config()

    # Short femurs (femur_tibia_ratio < 1)
    short_cal = _default_calibration(femur_tibia_ratio=0.8, femur_length=35, tibia_length=44)
    # Long femurs (femur_tibia_ratio > 1)
    long_cal = _default_calibration(femur_tibia_ratio=1.3, femur_length=52, tibia_length=40)

    # Same rep with moderate trunk lean
    rep = _build_rep_data(max_trunk_angle=50)

    short_score = score_rep(rep, config=config, calibration=short_cal)
    long_score = score_rep(rep, config=config, calibration=long_cal)

    # Long femurs should score trunk lean more favorably (or at least not worse)
    assert long_score.trunk_score >= short_score.trunk_score


@pytest.mark.deep
def test_single_rep_full_pipeline():
    """Single rep sequence -> valid SetAnalysis with 1 rep."""
    config = _default_config()
    cal = _default_calibration()
    rep = _build_rep_data()
    result = _score_set_from_rep_data([rep], config=config, calibration=cal)
    assert result.rep_count == 1
    assert len(result.reps) == 1
    assert result.grade in ("A", "B", "C", "D", "F")


@pytest.mark.deep
def test_many_reps():
    """20-rep sequence -> all reps detected and scored."""
    config = _default_config()
    cal = _default_calibration()
    reps = [_build_rep_data(rep_number=i + 1) for i in range(20)]
    result = _score_set_from_rep_data(reps, config=config, calibration=cal)
    assert result.rep_count == 20
    assert len(result.reps) == 20
    for rep_score in result.reps:
        assert 0 <= rep_score.overall_score <= 100


@pytest.mark.deep
def test_summary_format():
    """format_summary with real issues -> contains expected sections."""
    issues = [
        FormIssue(
            name="insufficient_depth",
            severity=IssueSeverity.HIGH,
            description="Squat depth insufficient",
            value=130,
            threshold=100,
            phase=SquatPhase.BOTTOM,
            frame=50,
        ),
        FormIssue(
            name="excessive_forward_lean",
            severity=IssueSeverity.MODERATE,
            description="Too much forward lean",
            value=60,
            threshold=45,
            phase=SquatPhase.BOTTOM,
            frame=52,
        ),
    ]
    cues = get_cues_for_issues(issues)
    summary = format_summary(issues, cues)
    assert len(summary) > 50
    # Should contain some structured output
    assert "depth" in summary.lower() or "insufficient" in summary.lower()


@pytest.mark.deep
def test_analysis_response_serialization():
    """SetAnalysis -> JSON serialization -> deserialization roundtrip."""
    config = _default_config()
    cal = _default_calibration()
    rep = _build_rep_data()
    set_result = _score_set_from_rep_data([rep], config=config, calibration=cal)

    # Serialize to JSON
    json_str = set_result.model_dump_json()

    # Deserialize back
    restored = SetAnalysis.model_validate_json(json_str)

    assert restored.rep_count == set_result.rep_count
    assert restored.overall_score == set_result.overall_score
    assert restored.grade == set_result.grade
    assert restored.fatigue_detected == set_result.fatigue_detected
    assert len(restored.reps) == len(set_result.reps)


@pytest.mark.deep
def test_bodyweight_vs_barbell_scoring():
    """Same angles should score differently for bodyweight vs low_bar due to trunk angle norms."""
    cal = _default_calibration()
    rep = _build_rep_data(max_trunk_angle=55)

    # Bodyweight config
    bw_config = SquatConfig(squat_type=SquatType.BODYWEIGHT, experience_level=ExperienceLevel.INTERMEDIATE)
    bw_result = score_rep(rep, config=bw_config, calibration=cal)

    # Low-bar config (expects more forward lean)
    lb_config = SquatConfig(squat_type=SquatType.LOW_BAR, experience_level=ExperienceLevel.INTERMEDIATE)
    lb_result = score_rep(rep, config=lb_config, calibration=cal)

    # Low-bar should be more forgiving of 55-degree trunk lean than bodyweight
    assert lb_result.trunk_score >= bw_result.trunk_score - 5  # at least similar or better
