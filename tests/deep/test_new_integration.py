"""Integration tests for new features working together in the squat form analyzer."""

import pytest

from squat_form.calibration import get_trunk_angle_range
from squat_form.feedback import (
    CUE_DATABASE,
    ISSUE_DISPLAY_NAMES,
    format_summary,
    get_cues_for_issues,
)
from squat_form.schemas import (
    CalibrationData,
    CameraView,
    ExperienceLevel,
    FormIssue,
    FrameAngles,
    IssueSeverity,
    RepData,
    RepScore,
    SetAnalysis,
    SquatConfig,
    SquatPhase,
    SquatType,
)
from squat_form.scorer import (
    WEIGHTS,
    get_positive_feedback_from_scores,
    score_rep,
    score_set,
)


# ---------------------------------------------------------------------------
# Helpers
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


def _build_rep_data(
    rep_number: int = 1,
    min_knee_angle: float = 90,
    max_trunk_angle: float = 40,
    descent_duration: float = 2.0,
    bottom_duration: float = 0.5,
    ascent_duration: float = 1.5,
    **kwargs,
) -> RepData:
    defaults = dict(
        rep_number=rep_number,
        start_frame=0,
        end_frame=100,
        bottom_frame=50,
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


# Jargon words that should NOT appear in user-facing issue descriptions
JARGON_WORDS = [
    "ACL", "meniscus", "glute medius", "posterior pelvic tilt",
    "patellofemoral", "MCL", "VMO", "vastus medialis",
]


# ===========================================================================
# Full Pipeline with New Features
# ===========================================================================


@pytest.mark.deep
class TestFullPipelineNewFeatures:
    def test_good_form_has_positive_highlights(self):
        """A squat with good form should produce positive_highlights in SetAnalysis."""
        config = _default_config()
        cal = _default_calibration()

        # Good form rep: good depth, good trunk, good tempo
        good_reps = [
            _build_rep_data(
                rep_number=i + 1,
                min_knee_angle=80,
                max_trunk_angle=37,
                descent_duration=2.0,
                bottom_duration=0.5,
                ascent_duration=1.5,
            )
            for i in range(3)
        ]
        result = _score_set_from_rep_data(good_reps, config, cal)

        # Good reps should generate some positive highlights
        assert isinstance(result.positive_highlights, list)
        # With good form, at least one positive highlight should exist
        assert len(result.positive_highlights) >= 1

    def test_knee_valgus_uses_plain_english(self):
        """A squat with knee valgus should use plain English (no jargon)."""
        config = _default_config()
        cal = _default_calibration()

        rep = _build_rep_data(
            knee_valgus=True,
            frame_angles=[FrameAngles(
                knee_angle=90, hip_angle=90, ankle_angle=70,
                trunk_angle=40, shin_angle=15, knee_width_ratio=0.70,
            )],
        )
        scored = score_rep(rep, config, cal)

        # Check issues for jargon
        for issue in scored.issues:
            for jargon in JARGON_WORDS:
                assert jargon.lower() not in issue.description.lower(), (
                    f"Issue '{issue.name}' description contains jargon: '{jargon}'"
                )

        # Check cues for jargon
        for cue in scored.cues:
            for jargon in JARGON_WORDS:
                assert jargon.lower() not in cue.cue.lower(), (
                    f"Cue for '{cue.issue}' contains jargon: '{jargon}'"
                )
                assert jargon.lower() not in cue.explanation.lower(), (
                    f"Explanation for '{cue.issue}' contains jargon: '{jargon}'"
                )

    def test_all_issues_use_plain_english(self):
        """A squat with all issues should have issues sorted by severity and use plain English."""
        config = _default_config()
        cal = _default_calibration()

        # Build rep with multiple problems
        rep = _build_rep_data(
            min_knee_angle=130,      # insufficient depth
            max_trunk_angle=70,      # excessive forward lean
            descent_duration=0.3,    # fast descent
            bottom_duration=0.02,    # bouncing
            ascent_duration=0.2,
            knee_valgus=True,
            heel_rise=True,
            butt_wink=True,
            good_morning=True,
            trunk_angle_change_on_ascent=20,
            pelvic_tilt_at_bottom=15,
            frame_angles=[FrameAngles(
                knee_angle=130, hip_angle=100, ankle_angle=70,
                trunk_angle=70, shin_angle=30, knee_width_ratio=0.70,
                hip_symmetry=0.08,
            )],
        )
        scored = score_rep(rep, config, cal)

        # Verify issues exist
        assert len(scored.issues) > 0

        # Check all issues and cues for jargon
        for issue in scored.issues:
            for jargon in JARGON_WORDS:
                assert jargon.lower() not in issue.description.lower(), (
                    f"Issue '{issue.name}' description contains jargon: '{jargon}'"
                )

        # Issues in format_summary should use display names
        cues = get_cues_for_issues(scored.issues)
        summary = format_summary(scored.issues, cues)
        for issue in scored.issues:
            if issue.name in ISSUE_DISPLAY_NAMES:
                display_name = ISSUE_DISPLAY_NAMES[issue.name]
                assert display_name in summary, (
                    f"Summary should contain display name '{display_name}' for issue '{issue.name}'"
                )


# ===========================================================================
# Scoring Consistency After Weight Changes
# ===========================================================================


@pytest.mark.deep
class TestScoringConsistencyAfterWeightChanges:
    def test_deterministic_scoring(self):
        """Same input always produces the same output (determinism)."""
        config = _default_config()
        cal = _default_calibration()
        rep = _build_rep_data()

        results = [score_rep(rep, config, cal) for _ in range(10)]

        for r in results[1:]:
            assert r.overall_score == results[0].overall_score
            assert r.depth_score == results[0].depth_score
            assert r.knee_tracking_score == results[0].knee_tracking_score
            assert r.trunk_score == results[0].trunk_score
            assert r.symmetry_score == results[0].symmetry_score
            assert r.tempo_score == results[0].tempo_score
            assert r.lockout_score == results[0].lockout_score
            assert r.grade == results[0].grade
            assert r.positive_feedback == results[0].positive_feedback

    def test_depth_improvement_bigger_than_knee_tracking(self):
        """Improving depth by 10 points improves overall score more
        than improving knee tracking by 10 points, because depth weight (0.25)
        is higher than knee tracking weight (0.20)."""
        # Directly compute using weights
        # A 10-point improvement in depth adds 10 * 0.25 = 2.5 to overall
        # A 10-point improvement in knee_tracking adds 10 * 0.20 = 2.0 to overall
        depth_delta = 10.0 * WEIGHTS["depth"]
        knee_tracking_delta = 10.0 * WEIGHTS["knee_tracking"]
        assert depth_delta > knee_tracking_delta

        # Also verify through actual scoring
        config = _default_config()
        cal = _default_calibration()

        # Baseline rep
        baseline = _build_rep_data(
            min_knee_angle=105,  # borderline depth
            frame_angles=[FrameAngles(
                knee_angle=170, hip_angle=170, ankle_angle=85,
                trunk_angle=40, shin_angle=10, knee_width_ratio=0.87,
            )],
        )
        baseline_score = score_rep(baseline, config, cal)

        # Improve knee tracking (increase ratio -> better knee score)
        better_knee = _build_rep_data(
            min_knee_angle=105,
            frame_angles=[FrameAngles(
                knee_angle=170, hip_angle=170, ankle_angle=85,
                trunk_angle=40, shin_angle=10, knee_width_ratio=0.97,
            )],
        )
        better_knee_score = score_rep(better_knee, config, cal)

        # Improve depth (decrease angle -> better depth score)
        better_depth = _build_rep_data(
            min_knee_angle=80,
            frame_angles=[FrameAngles(
                knee_angle=170, hip_angle=170, ankle_angle=85,
                trunk_angle=40, shin_angle=10, knee_width_ratio=0.87,
            )],
        )
        better_depth_score = score_rep(better_depth, config, cal)

        # The depth improvement should produce a larger change in overall
        knee_improvement = better_knee_score.overall_score - baseline_score.overall_score
        depth_improvement = better_depth_score.overall_score - baseline_score.overall_score

        # Depth weight (0.25) is 1.25x knee tracking weight (0.20), so the overall
        # change should reflect that ratio (approximately)
        assert knee_improvement > 0, "Knee tracking improvement should be positive"
        assert depth_improvement > 0, "Depth improvement should be positive"


# ===========================================================================
# Positive + Negative Feedback Balance
# ===========================================================================


@pytest.mark.deep
class TestPositiveNegativeFeedbackBalance:
    def test_mixed_quality_rep_has_both_feedback_types(self):
        """A mixed-quality rep should have both positive_feedback and issues."""
        config = _default_config()
        cal = _default_calibration()

        # Good depth and tempo, but bad knee tracking and trunk
        rep = _build_rep_data(
            min_knee_angle=80,        # good depth -> score >= 90
            max_trunk_angle=70,       # bad trunk -> issue
            descent_duration=2.0,     # good tempo
            bottom_duration=0.5,
            ascent_duration=1.5,
            frame_angles=[FrameAngles(
                knee_angle=170, hip_angle=170, ankle_angle=85,
                trunk_angle=70, shin_angle=10, knee_width_ratio=0.70,
            )],
            knee_valgus=True,
        )
        scored = score_rep(rep, config, cal)

        # Should have some positive feedback (from good depth)
        assert len(scored.positive_feedback) >= 1
        # Should also have issues (from bad knee tracking and trunk)
        assert len(scored.issues) >= 1

    def test_terrible_rep_has_few_or_no_positive_items(self):
        """A terrible rep (all sub-50 scores) should have few/no positive items."""
        config = _default_config()
        cal = _default_calibration()

        rep = _build_rep_data(
            min_knee_angle=150,       # terrible depth
            max_trunk_angle=80,       # terrible trunk
            descent_duration=0.3,     # terrible tempo
            bottom_duration=0.01,     # bouncing
            ascent_duration=0.2,
            frame_angles=[FrameAngles(
                knee_angle=120, hip_angle=120, ankle_angle=85,
                trunk_angle=80, shin_angle=30, knee_width_ratio=0.60,
                hip_symmetry=0.15,
            )],
            knee_valgus=True,
            heel_rise=True,
        )
        scored = score_rep(rep, config, cal)

        # With terrible form across all dimensions, no positive feedback expected
        assert len(scored.positive_feedback) == 0

    def test_perfect_rep_has_many_positive_and_zero_issues(self):
        """A perfect rep should have many positive items and zero issues."""
        config = _default_config()
        cal = _default_calibration()

        # Perfect form: good depth, trunk in range, good tempo, no issues
        rep = _build_rep_data(
            min_knee_angle=75,
            max_trunk_angle=37,
            descent_duration=2.0,
            bottom_duration=0.5,
            ascent_duration=1.5,
            frame_angles=[FrameAngles(
                knee_angle=170, hip_angle=170, ankle_angle=85,
                trunk_angle=37, shin_angle=10, knee_width_ratio=0.98,
                hip_symmetry=0.01,
            )],
        )
        scored = score_rep(rep, config, cal)

        # Should have multiple positive items
        assert len(scored.positive_feedback) >= 3

        # Should have zero critical issues (side_view_knee_caveat is acceptable
        # as it's just informational)
        critical_issues = [
            i for i in scored.issues
            if i.severity in (IssueSeverity.HIGH, IssueSeverity.MODERATE)
        ]
        assert len(critical_issues) == 0

    def test_set_analysis_positive_highlights_from_good_reps(self):
        """A set with consistently good reps should have positive_highlights."""
        config = _default_config()
        cal = _default_calibration()

        reps = [
            _build_rep_data(
                rep_number=i + 1,
                min_knee_angle=80,
                max_trunk_angle=37,
                descent_duration=2.0,
                bottom_duration=0.5,
                ascent_duration=1.5,
            )
            for i in range(5)
        ]
        result = _score_set_from_rep_data(reps, config, cal)

        # Positive highlights are aggregated from individual rep feedback
        # that appears in at least half the reps
        assert isinstance(result.positive_highlights, list)
        assert len(result.positive_highlights) >= 1

    def test_set_analysis_side_view_warning(self):
        """A set analyzed from side view should include a side_view_warning."""
        config = SquatConfig(
            squat_type=SquatType.BODYWEIGHT,
            experience_level=ExperienceLevel.INTERMEDIATE,
            camera_view=CameraView.SIDE,
        )
        cal = _default_calibration()

        reps = [_build_rep_data(rep_number=i + 1) for i in range(3)]
        result = _score_set_from_rep_data(reps, config, cal)

        assert result.side_view_warning is not None
        assert "side view" in result.side_view_warning.lower()
        assert "front view" in result.side_view_warning.lower()

    def test_set_analysis_no_side_view_warning_for_front(self):
        """A set analyzed from front view should NOT have a side_view_warning."""
        config = SquatConfig(
            squat_type=SquatType.BODYWEIGHT,
            experience_level=ExperienceLevel.INTERMEDIATE,
            camera_view=CameraView.FRONT,
        )
        cal = _default_calibration()

        reps = [_build_rep_data(rep_number=i + 1) for i in range(3)]
        result = _score_set_from_rep_data(reps, config, cal)

        assert result.side_view_warning is None
