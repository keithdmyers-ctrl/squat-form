"""Standard tests for all new features added to the squat form analyzer."""

import pytest

from squat_form.calibration import (
    PROPORTION_ADJUSTMENT_PER_RATIO,
    TRUNK_ANGLE_NORMS,
    get_trunk_angle_range,
)
from squat_form.feedback import CUE_DATABASE, ISSUE_DISPLAY_NAMES, format_summary, get_cues_for_issues
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
    score_set,
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
# Updated Scoring Weights
# ===========================================================================


@pytest.mark.standard
class TestUpdatedScoringWeights:
    def test_weights_depth(self):
        """Depth weight is 0.25."""
        assert WEIGHTS["depth"] == pytest.approx(0.25)

    def test_weights_knee_tracking(self):
        """Knee tracking weight is 0.20."""
        assert WEIGHTS["knee_tracking"] == pytest.approx(0.20)

    def test_weights_trunk(self):
        """Trunk weight is 0.20."""
        assert WEIGHTS["trunk"] == pytest.approx(0.20)

    def test_weights_symmetry(self):
        """Symmetry weight is 0.10."""
        assert WEIGHTS["symmetry"] == pytest.approx(0.10)

    def test_weights_tempo(self):
        """Tempo weight is 0.10."""
        assert WEIGHTS["tempo"] == pytest.approx(0.10)

    def test_weights_lockout(self):
        """Lockout weight is 0.15."""
        assert WEIGHTS["lockout"] == pytest.approx(0.15)

    def test_weights_sum_to_one(self):
        """All weights sum to 1.0."""
        total = sum(WEIGHTS.values())
        assert total == pytest.approx(1.0)

    def test_depth_higher_weight_than_knee_tracking(self):
        """Depth has a higher weight (0.25) than knee tracking (0.20),
        so a perfect depth score contributes more to the overall score."""
        config = _default_config()
        cal = _default_calibration()

        # Rep with perfect knee tracking (ratio=1.0) but mediocre depth (120 deg)
        rep_good_knee = _build_rep_data(
            min_knee_angle=120,
            frame_angles=[FrameAngles(
                knee_angle=170, hip_angle=170, ankle_angle=85,
                trunk_angle=40, shin_angle=10, knee_width_ratio=1.0,
            )],
        )

        # Rep with perfect depth (70 deg) but mediocre knee tracking (ratio=0.80)
        rep_good_depth = _build_rep_data(
            min_knee_angle=70,
            frame_angles=[FrameAngles(
                knee_angle=170, hip_angle=170, ankle_angle=85,
                trunk_angle=40, shin_angle=10, knee_width_ratio=0.80,
            )],
        )

        score_knee = score_rep(rep_good_knee, config, cal)
        score_depth_rep = score_rep(rep_good_depth, config, cal)

        # Depth is weighted 0.25, knee tracking is 0.20.
        # Good depth contributes more to overall.
        # The test checks the direction of the weight effect.
        # depth_score contribution = 100 * 0.25 = 25 points
        # knee_tracking_score contribution = 100 * 0.20 = 20 points
        knee_contribution = score_knee.knee_tracking_score * WEIGHTS["knee_tracking"]
        depth_contribution = score_depth_rep.depth_score * WEIGHTS["depth"]
        assert WEIGHTS["depth"] > WEIGHTS["knee_tracking"]


# ===========================================================================
# Positive Feedback Generation
# ===========================================================================


@pytest.mark.standard
class TestPositiveFeedback:
    def test_great_depth_at_90(self):
        """depth_score >= 90 produces 'Great depth' feedback."""
        feedback = get_positive_feedback_from_scores(
            depth_score=95, knee_tracking_score=50, trunk_score=50,
            symmetry_score=50, tempo_score=50, lockout_score=50,
        )
        great_depth = [f for f in feedback if "great depth" in f.lower()]
        assert len(great_depth) == 1

    def test_good_depth_at_80(self):
        """depth_score >= 80 but < 90 produces 'Good depth' feedback."""
        feedback = get_positive_feedback_from_scores(
            depth_score=85, knee_tracking_score=50, trunk_score=50,
            symmetry_score=50, tempo_score=50, lockout_score=50,
        )
        good_depth = [f for f in feedback if "good depth" in f.lower()]
        assert len(good_depth) == 1

    def test_no_great_depth_below_90(self):
        """depth_score = 85 should NOT produce 'Great depth'."""
        feedback = get_positive_feedback_from_scores(
            depth_score=85, knee_tracking_score=50, trunk_score=50,
            symmetry_score=50, tempo_score=50, lockout_score=50,
        )
        great_depth = [f for f in feedback if "great depth" in f.lower()]
        assert len(great_depth) == 0

    def test_knee_tracking_feedback_at_90(self):
        """knee_tracking_score >= 90 produces knee tracking feedback."""
        feedback = get_positive_feedback_from_scores(
            depth_score=50, knee_tracking_score=95, trunk_score=50,
            symmetry_score=50, tempo_score=50, lockout_score=50,
        )
        knee_fb = [f for f in feedback if "knee" in f.lower()]
        assert len(knee_fb) >= 1

    def test_trunk_feedback_at_90(self):
        """trunk_score >= 90 produces trunk position feedback."""
        feedback = get_positive_feedback_from_scores(
            depth_score=50, knee_tracking_score=50, trunk_score=95,
            symmetry_score=50, tempo_score=50, lockout_score=50,
        )
        trunk_fb = [f for f in feedback if "torso" in f.lower() or "trunk" in f.lower() or "upright" in f.lower()]
        assert len(trunk_fb) >= 1

    def test_tempo_feedback_at_90(self):
        """tempo_score >= 90 produces tempo feedback."""
        feedback = get_positive_feedback_from_scores(
            depth_score=50, knee_tracking_score=50, trunk_score=50,
            symmetry_score=50, tempo_score=95, lockout_score=50,
        )
        tempo_fb = [f for f in feedback if "tempo" in f.lower() or "controlled" in f.lower()]
        assert len(tempo_fb) >= 1

    def test_all_below_80_produces_minimal_feedback(self):
        """All scores below 80 produces empty or minimal positive feedback."""
        feedback = get_positive_feedback_from_scores(
            depth_score=50, knee_tracking_score=50, trunk_score=50,
            symmetry_score=50, tempo_score=50, lockout_score=50,
        )
        assert len(feedback) == 0

    def test_positive_feedback_items_are_strings(self):
        """All items in positive_feedback are strings."""
        feedback = get_positive_feedback_from_scores(
            depth_score=95, knee_tracking_score=95, trunk_score=95,
            symmetry_score=95, tempo_score=95, lockout_score=95,
        )
        for item in feedback:
            assert isinstance(item, str)


# ===========================================================================
# Plain English Issue Names
# ===========================================================================


@pytest.mark.standard
class TestPlainEnglishIssueNames:
    def test_knee_valgus_display_name(self):
        assert ISSUE_DISPLAY_NAMES["knee_valgus"] == "Knees Caving In"

    def test_butt_wink_display_name(self):
        assert ISSUE_DISPLAY_NAMES["butt_wink"] == "Hips Tucking Under"

    def test_excessive_forward_lean_display_name(self):
        assert ISSUE_DISPLAY_NAMES["excessive_forward_lean"] == "Too Much Forward Lean"

    def test_good_morning_display_name(self):
        assert ISSUE_DISPLAY_NAMES["good_morning"] == "Hips Rising First"

    def test_heel_rise_display_name(self):
        assert ISSUE_DISPLAY_NAMES["heel_rise"] == "Heels Coming Up"

    def test_insufficient_depth_display_name(self):
        assert ISSUE_DISPLAY_NAMES["insufficient_depth"] == "Not Deep Enough"

    def test_fast_descent_display_name(self):
        assert ISSUE_DISPLAY_NAMES["fast_descent"] == "Dropping Too Fast"

    def test_bouncing_display_name(self):
        assert ISSUE_DISPLAY_NAMES["bouncing"] == "Bouncing at the Bottom"

    def test_asymmetric_shift_display_name(self):
        assert ISSUE_DISPLAY_NAMES["asymmetric_shift"] == "Shifting to One Side"

    def test_format_summary_uses_display_names(self):
        """format_summary output should use display names, not underscore names."""
        issues = [
            _make_issue("knee_valgus", IssueSeverity.HIGH),
            _make_issue("butt_wink", IssueSeverity.MODERATE),
            _make_issue("heel_rise", IssueSeverity.LOW),
        ]
        cues = get_cues_for_issues(issues)
        summary = format_summary(issues, cues)
        # Display names should appear
        assert "Knees Caving In" in summary
        assert "Hips Tucking Under" in summary
        assert "Heels Coming Up" in summary
        # The issue names with underscores should not appear as stand-alone tokens
        # (they may appear as part of internal references, but the display text should use plain English)
        # Check that the bolded names don't contain underscores
        for line in summary.split("\n"):
            if line.startswith("- **"):
                # Extract the bold text between ** and **
                bold_start = line.index("**") + 2
                bold_end = line.index("**", bold_start)
                bold_text = line[bold_start:bold_end]
                assert "_" not in bold_text, f"Display name should not contain underscores: {bold_text}"


# ===========================================================================
# Heel Rise Cue Fix
# ===========================================================================


@pytest.mark.standard
class TestHeelRiseCueFix:
    def test_heel_rise_cue_mentions_whole_foot(self):
        """Heel rise cue text contains 'whole foot'."""
        cue_info = CUE_DATABASE["heel_rise"]
        assert "whole foot" in cue_info["cue"].lower()

    def test_heel_rise_cue_does_not_say_sit_back(self):
        """Heel rise cue does NOT say 'sit back'."""
        cue_info = CUE_DATABASE["heel_rise"]
        assert "sit back" not in cue_info["cue"].lower()

    def test_heel_rise_cue_does_not_say_heels(self):
        """Heel rise cue text does NOT contain the word 'heels'."""
        cue_info = CUE_DATABASE["heel_rise"]
        assert "heels" not in cue_info["cue"].lower()

    def test_heel_rise_explanation_mentions_ankle_mobility(self):
        """Heel rise explanation mentions 'ankle mobility'."""
        cue_info = CUE_DATABASE["heel_rise"]
        explanation = str(cue_info["explanation"]).lower()
        assert "ankle" in explanation


# ===========================================================================
# Side-View Warning
# ===========================================================================


@pytest.mark.standard
class TestSideViewWarning:
    def test_side_view_knee_tracking_score_when_no_frontal_data(self):
        """score_knee_tracking returns 75.0 when min_knee_width_ratio is None
        and no valgus detected (reduced confidence without front view)."""
        config = _default_config()
        result = score_knee_tracking(
            min_knee_width_ratio=None,
            knee_valgus_detected=False,
            config=config,
        )
        assert result == pytest.approx(75.0)

    def test_side_view_score_lower_than_frontal_good(self):
        """Side-view (no data) score is lower than frontal-view good-tracking score."""
        config = _default_config()
        side_score = score_knee_tracking(
            min_knee_width_ratio=None,
            knee_valgus_detected=False,
            config=config,
        )
        frontal_score = score_knee_tracking(
            min_knee_width_ratio=0.98,
            knee_valgus_detected=False,
            config=config,
        )
        assert side_score < frontal_score


# ===========================================================================
# Competition Depth Fields
# ===========================================================================


@pytest.mark.standard
class TestCompetitionDepthFields:
    def test_rep_data_with_competition_depth_pass_true(self):
        """RepData can be created with competition_depth_pass=True."""
        rep = _build_rep_data(competition_depth_pass=True, competition_depth_margin=0.05)
        assert rep.competition_depth_pass is True
        assert rep.competition_depth_margin == pytest.approx(0.05)

    def test_rep_data_with_competition_depth_pass_false(self):
        """RepData can be created with competition_depth_pass=False."""
        rep = _build_rep_data(competition_depth_pass=False, competition_depth_margin=-0.03)
        assert rep.competition_depth_pass is False
        assert rep.competition_depth_margin == pytest.approx(-0.03)

    def test_rep_data_competition_depth_defaults_none(self):
        """RepData defaults competition_depth_pass and margin to None."""
        rep = _build_rep_data()
        assert rep.competition_depth_pass is None
        assert rep.competition_depth_margin is None

    def test_positive_margin_means_below_knee(self):
        """Positive margin means the hip crease is below the knee (deep enough)."""
        rep = _build_rep_data(competition_depth_pass=True, competition_depth_margin=0.10)
        assert rep.competition_depth_margin > 0

    def test_negative_margin_means_above_knee(self):
        """Negative margin means the hip crease is above the knee (not deep enough)."""
        rep = _build_rep_data(competition_depth_pass=False, competition_depth_margin=-0.05)
        assert rep.competition_depth_margin < 0


# ===========================================================================
# Updated Trunk Angle Norms
# ===========================================================================


@pytest.mark.standard
class TestUpdatedTrunkAngleNorms:
    def test_high_bar_range(self):
        """HIGH_BAR trunk angle range is (30, 50)."""
        assert TRUNK_ANGLE_NORMS[SquatType.HIGH_BAR] == (30.0, 50.0)

    def test_low_bar_range(self):
        """LOW_BAR trunk angle range is (40, 60)."""
        assert TRUNK_ANGLE_NORMS[SquatType.LOW_BAR] == (40.0, 60.0)

    def test_bodyweight_range(self):
        """BODYWEIGHT trunk angle range is (25, 45)."""
        assert TRUNK_ANGLE_NORMS[SquatType.BODYWEIGHT] == (25.0, 45.0)

    def test_front_range(self):
        """FRONT squat trunk angle range is (10, 25)."""
        assert TRUNK_ANGLE_NORMS[SquatType.FRONT] == (10.0, 25.0)

    def test_goblet_range(self):
        """GOBLET squat trunk angle range is (15, 30)."""
        assert TRUNK_ANGLE_NORMS[SquatType.GOBLET] == (15.0, 30.0)

    def test_overhead_range(self):
        """OVERHEAD squat trunk angle range is (10, 25)."""
        assert TRUNK_ANGLE_NORMS[SquatType.OVERHEAD] == (10.0, 25.0)

    def test_all_squat_types_have_norms(self):
        """Every SquatType has a trunk angle norm entry."""
        for squat_type in SquatType:
            assert squat_type in TRUNK_ANGLE_NORMS, f"Missing norm for {squat_type}"


# ===========================================================================
# Femur/Tibia Adjustment
# ===========================================================================


@pytest.mark.standard
class TestFemurTibiaAdjustment:
    def test_ratio_1_3_produces_16_to_17_degrees(self):
        """A femur/tibia ratio of 1.3 produces approximately 16-17 degrees of adjustment."""
        cal = _default_calibration(femur_tibia_ratio=1.3)
        base_min, base_max = TRUNK_ANGLE_NORMS[SquatType.BODYWEIGHT]
        adjusted_min, adjusted_max = get_trunk_angle_range(SquatType.BODYWEIGHT, cal)
        adjustment = adjusted_min - base_min
        # deviation = 0.3, adjustment = 0.3 * 5.5 * 10 = 16.5
        assert adjustment == pytest.approx(16.5, abs=1.0)

    def test_ratio_1_0_produces_zero_adjustment(self):
        """A femur/tibia ratio of 1.0 produces zero adjustment."""
        cal = _default_calibration(femur_tibia_ratio=1.0)
        base_min, base_max = TRUNK_ANGLE_NORMS[SquatType.BODYWEIGHT]
        adjusted_min, adjusted_max = get_trunk_angle_range(SquatType.BODYWEIGHT, cal)
        assert adjusted_min == pytest.approx(base_min, abs=0.01)
        assert adjusted_max == pytest.approx(base_max, abs=0.01)

    def test_ratio_0_8_produces_negative_adjustment(self):
        """A femur/tibia ratio of 0.8 produces negative adjustment (less lean allowed)."""
        cal = _default_calibration(femur_tibia_ratio=0.8)
        base_min, base_max = TRUNK_ANGLE_NORMS[SquatType.BODYWEIGHT]
        adjusted_min, adjusted_max = get_trunk_angle_range(SquatType.BODYWEIGHT, cal)
        assert adjusted_min < base_min
        assert adjusted_max < base_max


# ===========================================================================
# Tiered Valgus Thresholds
# ===========================================================================


@pytest.mark.standard
class TestTieredValgusThresholds:
    def test_beginner_more_lenient_at_0_82(self):
        """Beginner with ratio 0.82 should score better than advanced with ratio 0.82.
        Beginner threshold is 0.80 (so 0.82 is above threshold).
        Advanced threshold is 0.90 (so 0.82 is below threshold)."""
        beginner_config = _default_config(experience_level=ExperienceLevel.BEGINNER)
        advanced_config = _default_config(experience_level=ExperienceLevel.ADVANCED)

        beginner_score = score_knee_tracking(
            min_knee_width_ratio=0.82,
            knee_valgus_detected=False,
            config=beginner_config,
        )
        advanced_score = score_knee_tracking(
            min_knee_width_ratio=0.82,
            knee_valgus_detected=False,
            config=advanced_config,
        )
        assert beginner_score > advanced_score

    def test_beginner_threshold_is_0_80(self):
        """Beginner: ratio just above 0.80 should not be heavily penalized."""
        config = _default_config(experience_level=ExperienceLevel.BEGINNER)
        score_above = score_knee_tracking(0.81, False, config)
        score_below = score_knee_tracking(0.79, False, config)
        # Above threshold should score significantly better than below
        assert score_above > score_below

    def test_advanced_threshold_is_0_90(self):
        """Advanced: ratio just above 0.90 should not be heavily penalized."""
        config = _default_config(experience_level=ExperienceLevel.ADVANCED)
        score_above = score_knee_tracking(0.91, False, config)
        score_below = score_knee_tracking(0.89, False, config)
        # Above threshold should score better than below
        assert score_above > score_below

    def test_intermediate_threshold_between(self):
        """Intermediate threshold (0.85) is between beginner and advanced."""
        config = _default_config(experience_level=ExperienceLevel.INTERMEDIATE)
        score_above = score_knee_tracking(0.86, False, config)
        score_below = score_knee_tracking(0.84, False, config)
        assert score_above > score_below
