"""
Golden validation tests: verify the analysis pipeline produces correct results
for known squat patterns. Tests cover issue detection, scoring accuracy,
coaching cue quality, and angle computation.

These tests act as regression guards — if thresholds or logic change,
these tests ensure the system still produces biomechanically correct results.
"""

import pytest

# ─── Imports ───

from squat_form.schemas import (
    CalibrationData,
    ExperienceLevel,
    FrameAngles,
    RepData,
    SquatConfig,
    SquatType,
)
from squat_form.angles import calculate_angle, compute_frame_angles
from squat_form.calibration import (
    get_depth_threshold,
    TRUNK_ANGLE_NORMS,
)
from squat_form.scorer import (
    _grade,
    score_depth,
    score_knee_tracking,
    score_trunk,
    score_symmetry,
    score_tempo,
    score_lockout,
    rep_to_issues,
    WEIGHTS,
)
from squat_form.feedback.cues import CUE_DATABASE


# ═══════════════════════════════════════════════════════════════════════
# SECTION 1: Threshold Validation Against Biomechanics Research
# ═══════════════════════════════════════════════════════════════════════


class TestThresholdsMatchResearch:
    """Verify hardcoded thresholds align with published biomechanics data."""

    def test_depth_thresholds_progressive(self):
        """Depth requirements should increase with experience level."""
        beg = get_depth_threshold(ExperienceLevel.BEGINNER)
        inter = get_depth_threshold(ExperienceLevel.INTERMEDIATE)
        adv = get_depth_threshold(ExperienceLevel.ADVANCED)
        assert beg >= inter
        assert inter >= adv
        assert beg > adv  # At minimum, beginner is more lenient than advanced

    def test_depth_advanced_at_parallel(self):
        """Advanced depth (90°) should approximate parallel squat.
        Research: parallel ≈ 80-100° included knee angle."""
        adv = get_depth_threshold(ExperienceLevel.ADVANCED)
        assert 80 <= adv <= 100

    def test_depth_beginner_above_parallel(self):
        """Beginner threshold should be at or above parallel (learning form safely)."""
        beg = get_depth_threshold(ExperienceLevel.BEGINNER)
        assert beg >= 90

    def test_scoring_weights_sum_to_one(self):
        """All scoring weights must sum to 1.0."""
        total = sum(WEIGHTS.values())
        assert abs(total - 1.0) < 1e-9

    def test_trunk_ranges_front_most_upright(self):
        """Front squat should have the most upright trunk range.
        Research: front squat 10-25° from vertical."""
        front_min, front_max = TRUNK_ANGLE_NORMS[SquatType.FRONT]
        high_bar_min, _ = TRUNK_ANGLE_NORMS[SquatType.HIGH_BAR]
        assert front_max < high_bar_min + 10  # Front max should be near/below high-bar min

    def test_trunk_ranges_low_bar_most_leaned(self):
        """Low-bar should allow the most forward lean.
        Research: low-bar 40-55°, ~10-15° more than high-bar."""
        _, low_bar_max = TRUNK_ANGLE_NORMS[SquatType.LOW_BAR]
        _, high_bar_max = TRUNK_ANGLE_NORMS[SquatType.HIGH_BAR]
        assert low_bar_max > high_bar_max

    def test_trunk_range_differences_match_research(self):
        """Low-bar should be ~10-20° more lean than high-bar (research says ~10-15°)."""
        lb_min, _ = TRUNK_ANGLE_NORMS[SquatType.LOW_BAR]
        hb_min, _ = TRUNK_ANGLE_NORMS[SquatType.HIGH_BAR]
        diff = lb_min - hb_min
        assert 5 <= diff <= 25  # Reasonable range


# ═══════════════════════════════════════════════════════════════════════
# SECTION 2: Scoring Accuracy — Known Inputs → Expected Outputs
# ═══════════════════════════════════════════════════════════════════════


class TestScoringAccuracy:
    """Verify scoring functions produce biomechanically sensible results."""

    @pytest.fixture
    def intermediate_config(self):
        return SquatConfig(
            squat_type=SquatType.HIGH_BAR,
            experience_level=ExperienceLevel.INTERMEDIATE,
        )

    @pytest.fixture
    def beginner_config(self):
        return SquatConfig(
            squat_type=SquatType.BODYWEIGHT,
            experience_level=ExperienceLevel.BEGINNER,
        )

    def test_perfect_depth_scores_high(self, intermediate_config):
        """80° knee angle (well below parallel) → score ≥ 95."""
        score = score_depth(80, intermediate_config)
        assert score >= 95

    def test_parallel_depth_scores_well(self, intermediate_config):
        """100° knee angle (at threshold) → score ≥ 75."""
        score = score_depth(100, intermediate_config)
        assert score >= 75

    def test_shallow_depth_scores_low(self, intermediate_config):
        """130° knee angle (quarter squat) → score < 50."""
        score = score_depth(130, intermediate_config)
        assert score < 50

    def test_ideal_tempo_scores_perfect(self):
        """2s descent, 0.5s pause, 1.5s ascent → score ≥ 90."""
        score = score_tempo(2.0, 0.5, 1.5)
        assert score >= 90

    def test_controlled_slow_tempo_acceptable(self):
        """3.5s descent (slow but controlled) → score ≥ 80."""
        score = score_tempo(3.5, 0.3, 2.0)
        assert score >= 80

    def test_dive_bomb_tempo_low(self):
        """0.3s descent (dive bombing) → score < 80."""
        score = score_tempo(0.3, 0.05, 0.5)
        assert score < 80

    def test_good_lockout_scores_high(self):
        """Final knee 172° with standing 175° → score = 100 (within 5°)."""
        score = score_lockout(172.0, 175.0)
        assert score == 100

    def test_poor_lockout_scores_low(self):
        """Final knee 140° with standing 175° → score < 60."""
        score = score_lockout(140.0, 175.0)
        assert score < 60

    def test_perfect_symmetry_scores_100(self):
        """Near-zero hip asymmetry → score = 100."""
        assert score_symmetry(0.01) == 100

    def test_noisy_symmetry_still_good(self):
        """3% asymmetry (within measurement noise range) → score ≥ 90."""
        assert score_symmetry(0.03) >= 90

    def test_significant_asymmetry_penalized(self):
        """15% asymmetry (clinically significant) → score < 80."""
        assert score_symmetry(0.15) < 80

    def test_no_data_symmetry_reasonable(self):
        """No symmetry data → score should be reasonable default (not 0)."""
        assert score_symmetry(None) >= 80

    def test_knee_tracking_no_data_no_valgus(self):
        """No frontal data, no valgus detected → decent score."""
        config = SquatConfig(experience_level=ExperienceLevel.INTERMEDIATE)
        score = score_knee_tracking(None, False, config)
        assert 70 <= score <= 80

    def test_knee_tracking_good_ratio(self):
        """Knee width ratio 0.96 (very stable) → score = 100."""
        config = SquatConfig(experience_level=ExperienceLevel.INTERMEDIATE)
        score = score_knee_tracking(0.96, False, config)
        assert score == 100

    def test_trunk_within_range_perfect(self):
        """Trunk angle within expected range → score = 100."""
        config = SquatConfig(
            squat_type=SquatType.HIGH_BAR,
            experience_level=ExperienceLevel.INTERMEDIATE,
        )
        # Backend defaults to 30-50° for high_bar without calibration
        score = score_trunk(40.0, config, None)
        assert score == 100


# ═══════════════════════════════════════════════════════════════════════
# SECTION 3: Issue Detection — Synthetic Squats → Expected Issues
# ═══════════════════════════════════════════════════════════════════════


class TestIssueDetection:
    """Verify specific form problems trigger the correct issues."""

    @pytest.fixture
    def config(self):
        return SquatConfig(
            squat_type=SquatType.HIGH_BAR,
            experience_level=ExperienceLevel.INTERMEDIATE,
        )

    def test_shallow_squat_triggers_depth_issue(self, config):
        """130° min knee angle → 'insufficient_depth' issue detected."""
        rep = _make_rep(min_knee_angle=130)
        issues = rep_to_issues(rep, config, None)
        issue_names = [i.name for i in issues]
        assert "insufficient_depth" in issue_names

    def test_deep_squat_no_depth_issue(self, config):
        """80° min knee angle → no 'insufficient_depth' issue."""
        rep = _make_rep(min_knee_angle=80)
        issues = rep_to_issues(rep, config, None)
        issue_names = [i.name for i in issues]
        assert "insufficient_depth" not in issue_names

    def test_valgus_triggers_knee_issue(self, config):
        """Knee valgus detected → 'knee_valgus' issue."""
        rep = _make_rep(knee_valgus=True, frame_angles=[{"knee_width_ratio": 0.60}] * 5)
        issues = rep_to_issues(rep, config, None)
        issue_names = [i.name for i in issues]
        assert "knee_valgus" in issue_names

    def test_good_morning_triggers_issue(self, config):
        """25° trunk angle increase on ascent → 'good_morning' issue."""
        rep = _make_rep(trunk_angle_change_on_ascent=25)
        issues = rep_to_issues(rep, config, None)
        issue_names = [i.name for i in issues]
        assert "good_morning" in issue_names

    def test_normal_ascent_no_good_morning(self, config):
        """5° trunk angle increase on ascent → no 'good_morning' issue."""
        rep = _make_rep(trunk_angle_change_on_ascent=5)
        issues = rep_to_issues(rep, config, None)
        issue_names = [i.name for i in issues]
        assert "good_morning" not in issue_names

    def test_heel_rise_triggers_issue(self, config):
        """Heel rise detected → 'heel_rise' issue."""
        rep = _make_rep(heel_rise=True)
        issues = rep_to_issues(rep, config, None)
        issue_names = [i.name for i in issues]
        assert "heel_rise" in issue_names

    def test_butt_wink_triggers_issue(self, config):
        """Butt wink detected → 'butt_wink' issue."""
        rep = _make_rep(butt_wink=True, pelvic_tilt_at_bottom=18)
        issues = rep_to_issues(rep, config, None)
        issue_names = [i.name for i in issues]
        assert "butt_wink" in issue_names

    def test_fast_descent_triggers_issue(self, config):
        """0.5s descent → 'fast_descent' issue."""
        rep = _make_rep(descent_duration=0.5)
        issues = rep_to_issues(rep, config, None)
        issue_names = [i.name for i in issues]
        assert "fast_descent" in issue_names

    def test_normal_descent_no_issue(self, config):
        """2.0s descent → no 'fast_descent' issue."""
        rep = _make_rep(descent_duration=2.0)
        issues = rep_to_issues(rep, config, None)
        issue_names = [i.name for i in issues]
        assert "fast_descent" not in issue_names

    def test_bouncing_triggers_issue(self, config):
        """0.02s bottom pause → 'bouncing' issue."""
        rep = _make_rep(bottom_duration=0.02)
        issues = rep_to_issues(rep, config, None)
        issue_names = [i.name for i in issues]
        assert "bouncing" in issue_names

    def test_no_duplicate_good_morning_and_trunk_increase(self, config):
        """Good morning and trunk_angle_increase_on_ascent should not both appear."""
        rep = _make_rep(trunk_angle_change_on_ascent=25)
        issues = rep_to_issues(rep, config, None)
        issue_names = [i.name for i in issues]
        gm_count = issue_names.count("good_morning")
        trunk_count = issue_names.count("trunk_angle_increase_on_ascent")
        # Should not have both — that would be a duplicate
        assert gm_count + trunk_count <= 1

    def test_perfect_form_no_high_issues(self, config):
        """Perfect squat → zero HIGH severity issues."""
        rep = _make_rep(
            min_knee_angle=85,
            max_trunk_angle=42,
            descent_duration=2.0,
            bottom_duration=0.3,
            ascent_duration=1.5,
            heel_rise=False,
            butt_wink=False,
            knee_valgus=False,
            trunk_angle_change_on_ascent=3,
            pelvic_tilt_at_bottom=5,
            frame_angles=[{
                "knee_angle": 170, "hip_angle": 170, "trunk_angle": 5,
                "ankle_angle": 90, "shin_angle": 10,
                "knee_width_ratio": 0.95, "hip_symmetry": 0.01,
            }] * 10,
        )
        issues = rep_to_issues(rep, config, None)
        high_issues = [i for i in issues if i.severity.value == "high"]
        assert len(high_issues) == 0

    def test_asymmetry_triggers_issue(self, config):
        """12% hip asymmetry → 'asymmetric_shift' issue."""
        rep = _make_rep(frame_angles=[{"hip_symmetry": 0.12}] * 10)
        issues = rep_to_issues(rep, config, None)
        issue_names = [i.name for i in issues]
        assert "asymmetric_shift" in issue_names

    def test_low_asymmetry_no_issue(self, config):
        """3% hip asymmetry → no 'asymmetric_shift' issue."""
        rep = _make_rep(frame_angles=[{"hip_symmetry": 0.03}] * 10)
        issues = rep_to_issues(rep, config, None)
        issue_names = [i.name for i in issues]
        assert "asymmetric_shift" not in issue_names


# ═══════════════════════════════════════════════════════════════════════
# SECTION 4: Coaching Cue Quality Validation
# ═══════════════════════════════════════════════════════════════════════


class TestCoachingCueQuality:
    """Verify coaching cues are appropriate, evidence-based, and jargon-free."""

    JARGON_WORDS = [
        "ACL", "MCL", "meniscus", "patella", "femur", "tibia",
        "valgus", "varus", "plantarflexion",
        "lumbar lordosis", "kyphosis", "sagittal", "coronal", "frontal plane",
        "posterior chain", "hip extensors", "knee extensors",
        "eccentric", "concentric", "isometric",
    ]

    def test_all_issues_have_cues(self):
        """Every detectable issue should have a coaching cue defined."""
        expected_issues = [
            "knee_valgus", "butt_wink", "excessive_forward_lean",
            "good_morning", "heel_rise", "insufficient_depth",
            "fast_descent", "bouncing",
            "asymmetric_shift", "excessive_forward_knee_travel",
        ]
        for issue_name in expected_issues:
            assert issue_name in CUE_DATABASE, f"Missing cue for '{issue_name}'"

    def test_cues_are_plain_english(self):
        """Coaching cues should avoid technical jargon."""
        for name, entry in CUE_DATABASE.items():
            cue_text = str(entry["cue"]).lower()
            for jargon in self.JARGON_WORDS:
                assert jargon.lower() not in cue_text, (
                    f"Cue for '{name}' contains jargon: '{jargon}'"
                )

    def test_explanations_are_accessible(self):
        """Explanations can reference anatomy but should explain it in context."""
        for name, entry in CUE_DATABASE.items():
            explanation = str(entry["explanation"])
            # Should be reasonably long (actually explains something)
            assert len(explanation) >= 50, (
                f"Explanation for '{name}' is too short ({len(explanation)} chars)"
            )
            # If using medical terms, should explain them
            for jargon in ["ACL", "MCL", "meniscus"]:
                if jargon in explanation:
                    assert "means" in explanation.lower() or "which" in explanation.lower(), (
                        f"Explanation for '{name}' uses '{jargon}' without explanation"
                    )

    def test_cue_priorities_are_valid(self):
        """All cue priorities should be positive integers."""
        for name, entry in CUE_DATABASE.items():
            assert isinstance(entry["priority"], int), f"Priority for '{name}' is not int"
            assert entry["priority"] >= 1, f"Priority for '{name}' is < 1"

    def test_knee_valgus_cue_mentions_feet_or_knees(self):
        """Knee valgus cue should give actionable foot/knee instruction."""
        cue = str(CUE_DATABASE["knee_valgus"]["cue"]).lower()
        assert "feet" in cue or "knees" in cue or "floor" in cue

    def test_depth_cue_is_actionable(self):
        """Depth cue should give a concrete external target."""
        cue = str(CUE_DATABASE["insufficient_depth"]["cue"]).lower()
        assert "hip" in cue or "deeper" in cue or "try" in cue or "aim" in cue

    def test_heel_rise_explanation_mentions_ankle_mobility(self):
        """Heel rise explanation should reference ankle mobility as root cause."""
        explanation = str(CUE_DATABASE["heel_rise"]["explanation"]).lower()
        assert "ankle" in explanation

    def test_butt_wink_explanation_not_alarmist(self):
        """Butt wink explanation should note that some movement is normal."""
        explanation = str(CUE_DATABASE["butt_wink"]["explanation"]).lower()
        assert "normal" in explanation or "some" in explanation


# ═══════════════════════════════════════════════════════════════════════
# SECTION 5: Grade Boundary Validation
# ═══════════════════════════════════════════════════════════════════════


class TestGradeBoundaries:
    """Verify grade assignments are fair and progressive."""

    def test_perfect_form_gets_A(self):
        """Score of 95 → grade A."""
        assert _grade(95) == "A"

    def test_good_form_gets_B(self):
        """Score of 85 → grade B."""
        assert _grade(85) == "B"

    def test_adequate_form_gets_C(self):
        """Score of 75 → grade C."""
        assert _grade(75) == "C"

    def test_poor_form_gets_D(self):
        """Score of 65 → grade D."""
        assert _grade(65) == "D"

    def test_failing_grade(self):
        """Score below 60 → grade F."""
        assert _grade(40) == "F"

    def test_boundary_90_is_A(self):
        """Exactly 90 → grade A (inclusive boundary)."""
        assert _grade(90) == "A"

    def test_boundary_89_is_B(self):
        """Score 89 → grade B."""
        assert _grade(89) == "B"


# ═══════════════════════════════════════════════════════════════════════
# SECTION 6: Angle Computation Sanity Checks
# ═══════════════════════════════════════════════════════════════════════


class TestAngleComputationSanity:
    """Verify angle computations produce biomechanically sensible results."""

    def test_standing_knee_angle_near_180(self, standing_landmarks):
        """Standing posture → knee angle should be 160-180°."""
        angles = compute_frame_angles(standing_landmarks)
        assert 155 <= angles.knee_angle <= 185

    def test_standing_trunk_near_vertical(self, standing_landmarks):
        """Standing posture → trunk angle should be near 0° (vertical)."""
        angles = compute_frame_angles(standing_landmarks)
        assert angles.trunk_angle < 20

    def test_bottom_squat_knee_flexed(self, bottom_squat_landmarks):
        """Bottom squat → knee angle should be 70-120°."""
        angles = compute_frame_angles(bottom_squat_landmarks)
        assert 60 <= angles.knee_angle <= 130

    def test_right_angle_is_90(self):
        """Three points forming a right angle → 90°."""
        angle = calculate_angle((0, 1, 0), (0, 0, 0), (1, 0, 0))
        assert abs(angle - 90) < 1.0

    def test_straight_line_is_180(self):
        """Three collinear points → 180°."""
        angle = calculate_angle((0, 0, 0), (1, 0, 0), (2, 0, 0))
        assert abs(angle - 180) < 1.0


# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════


def _default_frame_angles(**overrides) -> FrameAngles:
    """Create a FrameAngles with sensible defaults."""
    defaults = {
        "knee_angle": 170.0,
        "hip_angle": 170.0,
        "ankle_angle": 90.0,
        "trunk_angle": 5.0,
        "shin_angle": 10.0,
        "knee_width_ratio": None,
        "hip_symmetry": None,
    }
    defaults.update(overrides)
    return FrameAngles(**defaults)


def _make_rep(**overrides) -> RepData:
    """Create a minimal RepData with sensible defaults."""
    # Handle frame_angles specially: convert list of dicts to list of FrameAngles
    fa_dicts = overrides.pop("frame_angles", None)
    if fa_dicts is not None:
        frame_angles = [_default_frame_angles(**fa) for fa in fa_dicts]
    else:
        frame_angles = [_default_frame_angles() for _ in range(10)]

    defaults = {
        "rep_number": 1,
        "start_frame": 0,
        "end_frame": 100,
        "bottom_frame": 50,
        "min_knee_angle": 85.0,
        "min_hip_angle": 70.0,
        "max_trunk_angle": 40.0,
        "descent_duration": 2.0,
        "bottom_duration": 0.3,
        "ascent_duration": 1.5,
        "frame_angles": frame_angles,
        "heel_rise": False,
        "butt_wink": False,
        "good_morning": False,
        "knee_valgus": False,
        "trunk_angle_change_on_ascent": 3.0,
        "pelvic_tilt_at_bottom": 5.0,
    }
    defaults.update(overrides)
    return RepData(**defaults)
