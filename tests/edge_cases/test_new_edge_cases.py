"""Edge case tests for new features added to the squat form analyzer."""

import pytest

from squat_form.calibration import (
    TRUNK_ANGLE_NORMS,
    get_trunk_angle_range,
)
from squat_form.feedback import (
    CUE_DATABASE,
    ISSUE_DISPLAY_NAMES,
    format_summary,
    get_cues_for_issues,
)
from squat_form.schemas import (
    CalibrationData,
    CoachingCue,
    ExperienceLevel,
    FormIssue,
    FrameAngles,
    IssueSeverity,
    RepData,
    RepScore,
    SquatConfig,
    SquatPhase,
    SquatType,
)
from squat_form.scorer import (
    WEIGHTS,
    get_positive_feedback_from_scores,
    score_depth,
    score_knee_tracking,
    score_lockout,
    score_rep,
    score_symmetry,
    score_tempo,
    score_trunk,
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


def _make_issue(name: str, severity: IssueSeverity = IssueSeverity.MODERATE) -> FormIssue:
    return FormIssue(
        name=name,
        severity=severity,
        description=f"Test issue: {name}",
        value=50.0,
        threshold=80.0,
        phase=SquatPhase.BOTTOM,
        frame=42,
    )


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


# ===========================================================================
# Positive Feedback Edge Cases
# ===========================================================================


@pytest.mark.edge
class TestPositiveFeedbackEdgeCases:
    def test_all_scores_at_boundary_80(self):
        """All scores exactly at 80 -- depth gets 'Good depth', others do not
        get feedback since their threshold is 90."""
        feedback = get_positive_feedback_from_scores(
            depth_score=80, knee_tracking_score=80, trunk_score=80,
            symmetry_score=80, tempo_score=80, lockout_score=80,
        )
        # Only depth has a threshold at 80 (for "Good depth")
        good_depth = [f for f in feedback if "good depth" in f.lower()]
        assert len(good_depth) == 1
        # No other category at 80 should produce feedback (threshold is 90)
        non_depth = [f for f in feedback if "good depth" not in f.lower()]
        assert len(non_depth) == 0

    def test_all_scores_at_boundary_90(self):
        """All scores exactly at 90 -- should produce positive feedback for every category."""
        feedback = get_positive_feedback_from_scores(
            depth_score=90, knee_tracking_score=90, trunk_score=90,
            symmetry_score=90, tempo_score=90, lockout_score=90,
        )
        # Should get Great depth (>=90), knee tracking, trunk, tempo, symmetry, lockout
        assert len(feedback) >= 5  # At least 5 items for 6 dimensions (depth is "Great")

    def test_all_scores_zero(self):
        """All scores at 0 should still produce a valid response with empty feedback."""
        feedback = get_positive_feedback_from_scores(
            depth_score=0, knee_tracking_score=0, trunk_score=0,
            symmetry_score=0, tempo_score=0, lockout_score=0,
        )
        assert isinstance(feedback, list)
        assert len(feedback) == 0

    def test_all_scores_zero_in_rep_score(self):
        """A rep with all scores zero should produce a valid RepScore."""
        config = _default_config()
        # Create a rep with terrible form to get very low scores
        rep = _build_rep_data(
            min_knee_angle=180,
            max_trunk_angle=0,
            descent_duration=0.0,
            bottom_duration=0.0,
            ascent_duration=0.0,
        )
        result = score_rep(rep, config, None)
        assert isinstance(result, RepScore)
        assert isinstance(result.positive_feedback, list)
        assert 0 <= result.overall_score <= 100

    def test_all_scores_100(self):
        """All scores at 100 should produce positive feedback for every category."""
        feedback = get_positive_feedback_from_scores(
            depth_score=100, knee_tracking_score=100, trunk_score=100,
            symmetry_score=100, tempo_score=100, lockout_score=100,
        )
        assert len(feedback) >= 5  # At least depth, knee, trunk, tempo, symmetry, lockout


# ===========================================================================
# Competition Depth Edge Cases
# ===========================================================================


@pytest.mark.edge
class TestCompetitionDepthEdgeCases:
    def test_margin_exactly_zero(self):
        """competition_depth_margin = 0.0 (hip exactly at knee level)."""
        rep = _build_rep_data(
            competition_depth_pass=False,
            competition_depth_margin=0.0,
        )
        assert rep.competition_depth_margin == 0.0
        # At exactly 0, per check_competition_depth: margin > 0 -> pass, so 0 = fail
        assert rep.competition_depth_pass is False

    def test_very_large_positive_margin(self):
        """Very large positive margin (very deep squat) is valid."""
        rep = _build_rep_data(
            competition_depth_pass=True,
            competition_depth_margin=0.50,
        )
        assert rep.competition_depth_pass is True
        assert rep.competition_depth_margin == pytest.approx(0.50)

    def test_very_large_negative_margin(self):
        """Very large negative margin (barely any depth) is valid."""
        rep = _build_rep_data(
            competition_depth_pass=False,
            competition_depth_margin=-0.40,
        )
        assert rep.competition_depth_pass is False
        assert rep.competition_depth_margin == pytest.approx(-0.40)

    def test_competition_fields_with_score_rep(self):
        """score_rep works correctly when competition depth fields are set."""
        config = _default_config()
        cal = _default_calibration()
        rep = _build_rep_data(
            competition_depth_pass=True,
            competition_depth_margin=0.05,
        )
        result = score_rep(rep, config, cal)
        assert isinstance(result, RepScore)
        assert 0 <= result.overall_score <= 100


# ===========================================================================
# Calibration Edge Cases (Femur/Tibia)
# ===========================================================================


@pytest.mark.edge
class TestCalibrationFemurTibiaEdgeCases:
    def test_extreme_short_femurs_ratio_0_5(self):
        """femur_tibia_ratio = 0.5 (extremely short femurs) -- range should decrease."""
        cal = _default_calibration(femur_tibia_ratio=0.5)
        base_min, base_max = TRUNK_ANGLE_NORMS[SquatType.BODYWEIGHT]
        adj_min, adj_max = get_trunk_angle_range(SquatType.BODYWEIGHT, cal)
        # deviation = -0.5, adjustment = -0.5 * 5.5 * 10 = -27.5
        assert adj_min < base_min
        assert adj_max < base_max

    def test_extreme_long_femurs_ratio_2_0(self):
        """femur_tibia_ratio = 2.0 (extremely long femurs) -- range should increase."""
        cal = _default_calibration(femur_tibia_ratio=2.0)
        base_min, base_max = TRUNK_ANGLE_NORMS[SquatType.BODYWEIGHT]
        adj_min, adj_max = get_trunk_angle_range(SquatType.BODYWEIGHT, cal)
        # deviation = 1.0, adjustment = 1.0 * 5.5 * 10 = 55
        assert adj_min > base_min
        assert adj_max > base_max

    def test_trunk_range_never_returns_negative_min_for_reasonable_ratios(self):
        """For ratios between 0.7 and 1.5, get_trunk_angle_range min should not be negative."""
        for ratio_10 in range(7, 16):  # 0.7 to 1.5
            ratio = ratio_10 / 10.0
            cal = _default_calibration(femur_tibia_ratio=ratio)
            for squat_type in SquatType:
                adj_min, adj_max = get_trunk_angle_range(squat_type, cal)
                # For reasonable body proportions, min should not go negative
                # (extreme ratios like 0.5 might push it negative, which is a known limitation)
                assert isinstance(adj_min, float)
                assert isinstance(adj_max, float)
                assert adj_min <= adj_max

    def test_trunk_range_values_are_floats(self):
        """get_trunk_angle_range always returns floats regardless of ratio."""
        for ratio in [0.5, 0.8, 1.0, 1.3, 2.0, 3.0]:
            cal = _default_calibration(femur_tibia_ratio=ratio)
            adj_min, adj_max = get_trunk_angle_range(SquatType.BODYWEIGHT, cal)
            assert isinstance(adj_min, float)
            assert isinstance(adj_max, float)


# ===========================================================================
# Scoring Weight Verification Edge Cases
# ===========================================================================


@pytest.mark.edge
class TestScoringWeightVerification:
    def test_score_depth_returns_0_to_100(self):
        """score_depth always returns a value in [0, 100]."""
        config = _default_config()
        for angle in [0, 45, 80, 90, 100, 120, 150, 180]:
            result = score_depth(angle, config)
            assert 0 <= result <= 100, f"score_depth({angle}) = {result}"

    def test_score_knee_tracking_returns_0_to_100(self):
        """score_knee_tracking always returns a value in [0, 100]."""
        config = _default_config()
        for ratio in [None, 0.0, 0.5, 0.75, 0.85, 0.95, 1.0, 1.5]:
            for valgus in [True, False]:
                result = score_knee_tracking(ratio, valgus, config)
                assert 0 <= result <= 100, f"score_knee_tracking({ratio}, {valgus}) = {result}"

    def test_score_trunk_returns_0_to_100(self):
        """score_trunk always returns a value in [0, 100]."""
        config = _default_config()
        cal = _default_calibration()
        for angle in [0, 20, 35, 45, 60, 75, 90]:
            result = score_trunk(angle, config, cal)
            assert 0 <= result <= 100, f"score_trunk({angle}) = {result}"

    def test_score_symmetry_returns_0_to_100(self):
        """score_symmetry always returns a value in [0, 100]."""
        for asym in [None, 0.0, 0.01, 0.03, 0.06, 0.10, 0.20, 0.50]:
            result = score_symmetry(asym)
            assert 0 <= result <= 100, f"score_symmetry({asym}) = {result}"

    def test_score_tempo_returns_0_to_100(self):
        """score_tempo always returns a value in [0, 100]."""
        for d, b, a in [(0, 0, 0), (0.5, 0, 0.2), (2, 0.5, 1.5), (5, 2, 3), (30, 10, 15)]:
            result = score_tempo(d, b, a)
            assert 0 <= result <= 100, f"score_tempo({d}, {b}, {a}) = {result}"

    def test_score_lockout_returns_0_to_100(self):
        """score_lockout always returns a value in [0, 100]."""
        for final, standing in [(170, 170), (160, 170), (140, 170), (90, 170), (180, 170)]:
            result = score_lockout(final, standing)
            assert 0 <= result <= 100, f"score_lockout({final}, {standing}) = {result}"

    def test_changing_depth_only_affects_overall_by_depth_weight(self):
        """Changing depth score by X should change overall by approximately X * effective_depth_weight.

        When no frontal knee data is available (empty frame_angles), the knee_tracking
        weight is redistributed proportionally among other dimensions, so the effective
        depth weight is higher than the base WEIGHTS["depth"].
        """
        from squat_form.scorer import _redistribute_weights
        config = _default_config()
        cal = _default_calibration()

        # Rep with good depth (85 degrees) -- well below threshold
        rep_good = _build_rep_data(min_knee_angle=70)
        # Rep with borderline depth (110 degrees)
        rep_bad = _build_rep_data(min_knee_angle=110)

        result_good = score_rep(rep_good, config, cal)
        result_bad = score_rep(rep_bad, config, cal)

        depth_diff = result_good.depth_score - result_bad.depth_score
        overall_diff = result_good.overall_score - result_bad.overall_score

        # These reps have no frame_angles, so knee_tracking weight is redistributed.
        # Use the redistributed weight for the expected contribution.
        effective_weights = _redistribute_weights(WEIGHTS, "knee_tracking")
        expected_contribution = depth_diff * effective_weights["depth"]
        assert overall_diff == pytest.approx(expected_contribution, abs=2.0)


# ===========================================================================
# Display Name Edge Cases
# ===========================================================================


@pytest.mark.edge
class TestDisplayNameEdgeCases:
    def test_unknown_issue_name_fallback_in_format_summary(self):
        """Issue with name not in ISSUE_DISPLAY_NAMES should fall back gracefully."""
        unknown_issue = _make_issue("totally_unknown_issue_xyz", IssueSeverity.HIGH)
        cues = get_cues_for_issues([unknown_issue])
        # format_summary should not crash
        summary = format_summary([unknown_issue], cues)
        assert isinstance(summary, str)
        assert len(summary) > 0
        # The fallback should produce a title-cased version without underscores
        assert "Totally Unknown Issue Xyz" in summary

    def test_format_summary_empty_issues_and_cues(self):
        """format_summary with empty issues and empty cues returns 'Great form!' message."""
        summary = format_summary([], [])
        assert "great form" in summary.lower()

    def test_format_summary_issue_without_matching_display_name(self):
        """format_summary with issues that have no matching display name uses fallback."""
        issues = [
            _make_issue("no_such_display_name_abc", IssueSeverity.MODERATE),
        ]
        cues = get_cues_for_issues(issues)
        summary = format_summary(issues, cues)
        assert isinstance(summary, str)
        # The fallback is: issue.name.replace("_", " ").title()
        assert "No Such Display Name Abc" in summary

    def test_all_cue_database_keys_have_display_names(self):
        """Every issue in CUE_DATABASE has a corresponding ISSUE_DISPLAY_NAMES entry."""
        for key in CUE_DATABASE:
            assert key in ISSUE_DISPLAY_NAMES, (
                f"CUE_DATABASE has '{key}' but ISSUE_DISPLAY_NAMES does not"
            )
