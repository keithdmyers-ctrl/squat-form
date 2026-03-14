"""Scoring system for squat form analysis."""

from __future__ import annotations

from squat_form.schemas import (
    CalibrationData,
    CoachingCue,
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
from squat_form.calibration import get_depth_threshold, get_trunk_angle_range
from squat_form.feedback import get_cues_for_issues


# Dimension weights
WEIGHTS: dict[str, float] = {
    "depth": 0.25,
    "knee_tracking": 0.20,
    "trunk": 0.20,
    "symmetry": 0.10,
    "tempo": 0.10,
    "lockout": 0.15,
}

# Competition-mode weights (tempo is not scored, lockout is critical)
COMPETITION_WEIGHTS: dict[str, float] = {
    "depth": 0.30,
    "knee_tracking": 0.25,
    "trunk": 0.15,
    "symmetry": 0.10,
    "tempo": 0.00,   # Not scored in competition
    "lockout": 0.20,  # Critical for commands
}


def _redistribute_weights(
    base_weights: dict[str, float],
    exclude: str,
) -> dict[str, float]:
    """Redistribute weights when a dimension cannot be measured."""
    excluded_weight = base_weights.get(exclude, 0.0)
    remaining = {k: v for k, v in base_weights.items() if k != exclude}
    total_remaining = sum(remaining.values())
    if total_remaining <= 0:
        return base_weights
    scale = (total_remaining + excluded_weight) / total_remaining
    return {k: v * scale for k, v in remaining.items()}


def _clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def score_depth(min_knee_angle: float, config: SquatConfig) -> float:
    """Score depth based on minimum knee angle achieved.

    Full depth (well below threshold) = 100.
    At threshold = 80.
    Above threshold degrades linearly.
    """
    threshold = (
        config.target_depth
        if config.target_depth is not None
        else get_depth_threshold(config.experience_level)
    )

    if min_knee_angle <= threshold - 20:
        return 100.0
    elif min_knee_angle <= threshold:
        # Linear from 100 at (threshold-20) to 80 at threshold
        frac = (min_knee_angle - (threshold - 20)) / 20.0
        return _clamp(100.0 - frac * 20.0)
    else:
        # Above threshold -- score degrades
        over = min_knee_angle - threshold
        return _clamp(80.0 - over * 2.0)


def score_knee_tracking(
    min_knee_width_ratio: float | None,
    knee_valgus_detected: bool,
    config: SquatConfig,
) -> float:
    """Score knee tracking (valgus/varus).

    Uses tiered thresholds by experience level:
    - Beginner: flag at ratio < 0.70
    - Intermediate: flag at ratio < 0.75
    - Advanced: flag at ratio < 0.80

    Ratio >= 0.95 = 100 (knees stay wide).
    """
    if min_knee_width_ratio is None:
        # No frontal data available -- reduced confidence without front view
        if knee_valgus_detected:
            return 60.0
        return 75.0

    # Tiered threshold by experience level
    valgus_threshold = {
        ExperienceLevel.BEGINNER: 0.70,
        ExperienceLevel.INTERMEDIATE: 0.75,
        ExperienceLevel.ADVANCED: 0.80,
    }.get(config.experience_level, 0.75)

    if min_knee_width_ratio >= 0.95:
        score = 100.0
    elif min_knee_width_ratio >= valgus_threshold:
        # Linear from 100 at 0.95 to 80 at valgus_threshold
        frac = (0.95 - min_knee_width_ratio) / (0.95 - valgus_threshold)
        score = 100.0 - frac * 20.0
    else:
        # Gradual penalty below threshold
        distance = valgus_threshold - min_knee_width_ratio
        score = 80.0 - distance * 150.0

    if knee_valgus_detected:
        score -= 5.0

    return _clamp(score)


def score_trunk(
    max_trunk_angle: float,
    config: SquatConfig,
    calibration: CalibrationData | None,
) -> float:
    """Score trunk position based on acceptable lean range.

    Within range = 100.  Tolerance band depends on experience level.
    """
    if calibration is not None:
        min_angle, max_angle = get_trunk_angle_range(config.squat_type, calibration)
    else:
        min_angle, max_angle = 30.0, 50.0

    tolerance = {
        ExperienceLevel.BEGINNER: 20.0,
        ExperienceLevel.INTERMEDIATE: 15.0,
        ExperienceLevel.ADVANCED: 10.0,
    }.get(config.experience_level, 20.0)

    if min_angle <= max_trunk_angle <= max_angle:
        return 100.0

    if max_trunk_angle < min_angle:
        deviation = min_angle - max_trunk_angle
    else:
        deviation = max_trunk_angle - max_angle

    if deviation <= tolerance:
        return _clamp(100.0 - (deviation / tolerance) * 15.0)
    else:
        return _clamp(85.0 - (deviation - tolerance) * 1.5)


def score_symmetry(max_hip_asymmetry: float | None) -> float:
    """Score symmetry based on maximum hip asymmetry ratio.

    < 0.05 = 100 (MediaPipe noise floor).  Degrades with asymmetry.
    """
    if max_hip_asymmetry is None:
        return 90.0  # No data -- assume decent

    if max_hip_asymmetry < 0.05:
        return 100.0
    elif max_hip_asymmetry < 0.10:
        frac = (max_hip_asymmetry - 0.05) / 0.05
        return _clamp(100.0 - frac * 15.0)
    elif max_hip_asymmetry < 0.20:
        frac = (max_hip_asymmetry - 0.10) / 0.10
        return _clamp(85.0 - frac * 25.0)
    else:
        return _clamp(60.0 - (max_hip_asymmetry - 0.20) * 100.0)


def score_tempo(
    descent_duration: float,
    bottom_pause: float,
    ascent_duration: float,
) -> float:
    """Score tempo based on phase durations.

    Ideal descent: 1.0-4.0 s.
    Ideal pause: 0.1-1.5 s.
    """
    score = 100.0

    # Descent scoring
    if 1.0 <= descent_duration <= 4.0:
        pass
    elif descent_duration < 1.0:
        score -= min(20.0, (1.0 - descent_duration) * 20.0)
    else:
        score -= min(10.0, (descent_duration - 4.0) * 5.0)

    # Bottom pause scoring
    if 0.1 <= bottom_pause <= 1.5:
        pass
    elif bottom_pause < 0.1:
        score -= 10.0  # bouncing
    else:
        score -= min(10.0, (bottom_pause - 1.5) * 5.0)

    # Very fast ascent is fine (explosive), but extremely fast is suspicious
    if ascent_duration < 0.2:
        score -= 5.0

    return _clamp(score)


def score_lockout(
    final_knee_angle: float,
    standing_knee_angle: float,
) -> float:
    """Score lockout: how close the final knee angle is to standing.

    Within 10 degrees = 100. Default standing knee = 175.
    """
    diff = abs(final_knee_angle - standing_knee_angle)
    if diff <= 10.0:
        return 100.0
    elif diff <= 20.0:
        frac = (diff - 10.0) / 10.0
        return _clamp(100.0 - frac * 25.0)
    else:
        return _clamp(75.0 - (diff - 20.0) * 1.5)


def score_depth_competition(
    competition_depth_pass: bool | None,
    competition_depth_margin: float | None,
) -> float:
    """Score depth using competition rules (pass/fail based on hip-Y vs knee-Y).

    Args:
        competition_depth_pass: Whether hip crease was below knee.
        competition_depth_margin: How far below (positive) or above (negative).

    Returns:
        Depth score 0-100.
    """
    if competition_depth_pass is None:
        return 50.0  # Can't assess

    if competition_depth_pass:
        return 100.0

    # Failed depth
    if competition_depth_margin is not None and competition_depth_margin > -0.02:
        return 60.0  # Borderline
    return 20.0  # Clearly high


def score_lockout_competition(
    final_knee_angle: float,
    standing_knee_angle: float,
) -> float:
    """Score lockout using stricter competition rules.

    Args:
        final_knee_angle: Knee angle at the end of the rep.
        standing_knee_angle: Knee angle when standing (from calibration).

    Returns:
        Lockout score 0-100.
    """
    diff = abs(final_knee_angle - standing_knee_angle)
    if diff <= 3.0:
        return 100.0
    elif diff <= 5.0:
        return 80.0
    elif diff <= 10.0:
        return 50.0
    else:
        return 20.0


def get_positive_feedback_from_scores(
    depth_score: float,
    knee_tracking_score: float,
    trunk_score: float,
    symmetry_score: float,
    tempo_score: float,
    lockout_score: float,
) -> list[str]:
    """Return praise based on component scores.

    Args:
        depth_score: Depth dimension score (0-100).
        knee_tracking_score: Knee tracking dimension score (0-100).
        trunk_score: Trunk position dimension score (0-100).
        symmetry_score: Symmetry dimension score (0-100).
        tempo_score: Tempo dimension score (0-100).
        lockout_score: Lockout dimension score (0-100).

    Returns:
        List of positive feedback strings.
    """
    feedback: list[str] = []

    if depth_score >= 90:
        feedback.append("Great depth -- you hit well below parallel")
    elif depth_score >= 80:
        feedback.append("Good depth -- you reached parallel")

    if knee_tracking_score >= 90:
        feedback.append("Excellent knee tracking -- knees stayed right over your toes")

    if trunk_score >= 90:
        feedback.append("Nice upright torso position")

    if tempo_score >= 90:
        feedback.append("Good controlled tempo")

    if symmetry_score >= 90:
        feedback.append("Even weight distribution -- nice and balanced")

    if lockout_score >= 90:
        feedback.append("Strong lockout at the top")

    return feedback


def rep_to_issues(
    rep: RepData,
    config: SquatConfig,
    calibration: CalibrationData | None,
) -> list[FormIssue]:
    """Check all form criteria for a single rep and return issues found."""
    issues: list[FormIssue] = []

    # Depth check
    threshold = (
        config.target_depth
        if config.target_depth is not None
        else get_depth_threshold(config.experience_level)
    )
    if rep.min_knee_angle > threshold:
        if rep.min_knee_angle > threshold + 20:
            depth_desc = "You stopped well above the target depth — try to get lower gradually"
            depth_severity = IssueSeverity.MODERATE
        elif rep.min_knee_angle > threshold + 10:
            depth_desc = "Almost there — just a few more inches deeper"
            depth_severity = IssueSeverity.LOW
        else:
            depth_desc = "Just barely above target depth — you're very close!"
            depth_severity = IssueSeverity.LOW
        issues.append(
            FormIssue(
                name="insufficient_depth",
                severity=depth_severity,
                description=depth_desc,
                value=rep.min_knee_angle,
                threshold=threshold,
                phase=SquatPhase.BOTTOM,
                frame=rep.bottom_frame,
            )
        )

    # Knee valgus -- graduated severity based on distance from threshold
    if rep.knee_valgus:
        # Determine valgus threshold for this experience level
        kv_threshold = {
            ExperienceLevel.BEGINNER: 0.70,
            ExperienceLevel.INTERMEDIATE: 0.75,
            ExperienceLevel.ADVANCED: 0.80,
        }.get(config.experience_level, 0.75)
        # Find min knee width ratio to determine severity
        kv_min_kwr: float | None = None
        for fa in rep.frame_angles:
            if fa.knee_width_ratio is not None:
                if kv_min_kwr is None or fa.knee_width_ratio < kv_min_kwr:
                    kv_min_kwr = fa.knee_width_ratio
        if kv_min_kwr is not None:
            kv_distance = kv_threshold - kv_min_kwr
            if kv_distance > 0.15:
                kv_severity = IssueSeverity.HIGH
            elif kv_distance > 0.05:
                kv_severity = IssueSeverity.MODERATE
            else:
                kv_severity = IssueSeverity.LOW
        else:
            kv_severity = IssueSeverity.MODERATE  # No data, assume moderate
        issues.append(
            FormIssue(
                name="knee_valgus",
                severity=kv_severity,
                description="Knees collapsed inward during the squat",
                value=kv_min_kwr if kv_min_kwr is not None else 0.0,
                threshold=kv_threshold,
                phase=SquatPhase.ASCENDING,
                frame=rep.bottom_frame,
            )
        )

    # Butt wink
    if rep.butt_wink:
        issues.append(
            FormIssue(
                name="butt_wink",
                severity=IssueSeverity.MODERATE,
                description="Pelvis tucked under at the bottom position",
                value=rep.pelvic_tilt_at_bottom,
                threshold=12.0,
                phase=SquatPhase.BOTTOM,
                frame=rep.bottom_frame,
            )
        )

    # Good morning squat (threshold is higher for low-bar squats)
    gm_threshold = 20.0 if config.squat_type == SquatType.LOW_BAR else 15.0
    if rep.trunk_angle_change_on_ascent > gm_threshold:
        issues.append(
            FormIssue(
                name="good_morning",
                severity=IssueSeverity.HIGH,
                description="Your hips shot up before your shoulders on the way up",
                value=rep.trunk_angle_change_on_ascent,
                threshold=gm_threshold,
                phase=SquatPhase.ASCENDING,
                frame=rep.end_frame,
            )
        )

    # Excessive forward lean
    if calibration is not None:
        min_trunk, max_trunk = get_trunk_angle_range(config.squat_type, calibration)
        tolerance = {
            ExperienceLevel.BEGINNER: 20.0,
            ExperienceLevel.INTERMEDIATE: 15.0,
            ExperienceLevel.ADVANCED: 10.0,
        }.get(config.experience_level, 20.0)
        if rep.max_trunk_angle > max_trunk + 10:
            lean_excess = rep.max_trunk_angle - max_trunk
            if lean_excess >= tolerance * 3:
                lean_severity = IssueSeverity.HIGH
            elif lean_excess >= tolerance:
                lean_severity = IssueSeverity.MODERATE
            else:
                lean_severity = IssueSeverity.LOW
            issues.append(
                FormIssue(
                    name="excessive_forward_lean",
                    severity=lean_severity,
                    description="You leaned forward more than ideal for this squat style",
                    value=rep.max_trunk_angle,
                    threshold=max_trunk,
                    phase=SquatPhase.BOTTOM,
                    frame=rep.bottom_frame,
                )
            )

    # Heel rise
    if rep.heel_rise:
        issues.append(
            FormIssue(
                name="heel_rise",
                severity=IssueSeverity.MODERATE,
                description="Heels lifted off the ground during the squat",
                value=1.0,
                threshold=0.0,
                phase=SquatPhase.DESCENDING,
                frame=rep.bottom_frame,
            )
        )

    # Tempo: fast descent
    if rep.descent_duration < 1.2:
        issues.append(
            FormIssue(
                name="fast_descent",
                severity=IssueSeverity.LOW,
                description=f"Descent took only {rep.descent_duration:.1f}s (aim for 1.5-3.0s)",
                value=rep.descent_duration,
                threshold=1.5,
                phase=SquatPhase.DESCENDING,
                frame=rep.start_frame,
            )
        )

    # Bouncing at bottom
    if rep.bottom_duration < 0.10:
        bouncing_severity = (
            IssueSeverity.LOW
            if config.experience_level == ExperienceLevel.ADVANCED
            else IssueSeverity.MODERATE
        )
        issues.append(
            FormIssue(
                name="bouncing",
                severity=bouncing_severity,
                description="No pause at the bottom -- bouncing puts stress on your joints rather than your muscles",
                value=rep.bottom_duration,
                threshold=0.1,
                phase=SquatPhase.BOTTOM,
                frame=rep.bottom_frame,
            )
        )

    # Asymmetric shift
    max_asym = 0.0
    for fa in rep.frame_angles:
        if fa.hip_symmetry is not None and fa.hip_symmetry > max_asym:
            max_asym = fa.hip_symmetry
    if max_asym > 0.10:
        asym_severity = IssueSeverity.MODERATE if max_asym >= 0.30 else IssueSeverity.LOW
        issues.append(
            FormIssue(
                name="asymmetric_shift",
                severity=asym_severity,
                description=f"Weight shifted to one side ({max_asym*100:.0f}% imbalance)",
                value=max_asym,
                threshold=0.10,
                phase=SquatPhase.BOTTOM,
                frame=rep.bottom_frame,
            )
        )

    # Shin angle checks -- excessive forward knee travel
    max_shin = 0.0
    for fa in rep.frame_angles:
        if fa.shin_angle > max_shin:
            max_shin = fa.shin_angle
    if max_shin > 45.0 and rep.heel_rise:
        # Combined issue: excessive shin angle with heel rise -- already covered
        # by heel_rise issue, but increase severity of heel_rise if present
        for issue in issues:
            if issue.name == "heel_rise":
                issue.severity = IssueSeverity.HIGH
                issue.description = (
                    "Heels lifted with excessive forward knee travel -- "
                    "high stress on knees and ankles"
                )
                break
    # Forward knee travel: only flag for low-bar squats where excessive forward
    # travel genuinely indicates a form issue. For high-bar, front, and bodyweight
    # squats, forward knee travel is normal and expected.
    if config.squat_type == SquatType.LOW_BAR and max_shin > 45.0:
        issues.append(
            FormIssue(
                name="excessive_forward_knee_travel",
                severity=IssueSeverity.LOW,
                description="Knees traveled very far forward — consider a wider stance or sitting back more",
                value=max_shin,
                threshold=45.0,
                phase=SquatPhase.BOTTOM,
                frame=rep.bottom_frame,
            )
        )

    # Side-view knee tracking caveat
    min_kwr: float | None = None
    for fa in rep.frame_angles:
        if fa.knee_width_ratio is not None:
            if min_kwr is None or fa.knee_width_ratio < min_kwr:
                min_kwr = fa.knee_width_ratio
    if min_kwr is None and not rep.knee_valgus:
        issues.append(
            FormIssue(
                name="side_view_knee_caveat",
                severity=IssueSeverity.LOW,
                description=(
                    "Knee tracking could not be fully assessed from side view. "
                    "Record a front view for complete analysis."
                ),
                value=0.0,
                threshold=0.0,
                phase=SquatPhase.BOTTOM,
                frame=rep.bottom_frame,
            )
        )

    return issues


def score_rep(
    rep: RepData,
    config: SquatConfig,
    calibration: CalibrationData | None,
) -> RepScore:
    """Score a single rep across all dimensions."""
    competition = config.competition_mode
    issues = rep_to_issues(rep, config, calibration)
    cues = get_cues_for_issues(issues, config.squat_type.value)

    # Depth scoring
    if competition:
        depth = score_depth_competition(
            rep.competition_depth_pass,
            rep.competition_depth_margin,
        )
    else:
        depth = score_depth(rep.min_knee_angle, config)

    # Find min knee width ratio across the rep
    min_kwr: float | None = None
    for fa in rep.frame_angles:
        if fa.knee_width_ratio is not None:
            if min_kwr is None or fa.knee_width_ratio < min_kwr:
                min_kwr = fa.knee_width_ratio
    knee_tracking = score_knee_tracking(min_kwr, rep.knee_valgus, config)

    trunk = score_trunk(rep.max_trunk_angle, config, calibration)

    # Max hip asymmetry
    max_asym: float | None = None
    for fa in rep.frame_angles:
        if fa.hip_symmetry is not None:
            if max_asym is None or fa.hip_symmetry > max_asym:
                max_asym = fa.hip_symmetry
    symmetry = score_symmetry(max_asym)

    tempo = score_tempo(rep.descent_duration, rep.bottom_duration, rep.ascent_duration)

    # Lockout: use max of last 5 frames (robust against single-frame noise)
    last_angles = rep.frame_angles[-5:] if rep.frame_angles else []
    final_knee = max((fa.knee_angle for fa in last_angles), default=175.0)
    standing_knee = calibration.standing_knee_angle if calibration else 175.0
    if competition:
        lockout = score_lockout_competition(final_knee, standing_knee)
    else:
        lockout = score_lockout(final_knee, standing_knee)

    # Check if we have frontal knee data
    has_frontal_data = min_kwr is not None

    # Select and possibly adjust weights
    weights = COMPETITION_WEIGHTS if competition else WEIGHTS
    if not has_frontal_data:
        weights = _redistribute_weights(weights, "knee_tracking")

    overall = sum(weights.get(dim, 0.0) * score_val for dim, score_val in [
        ("depth", depth),
        ("knee_tracking", knee_tracking),
        ("trunk", trunk),
        ("symmetry", symmetry),
        ("tempo", tempo),
        ("lockout", lockout),
    ])

    # Generate positive feedback based on computed scores
    positive = get_positive_feedback_from_scores(
        depth_score=depth,
        knee_tracking_score=knee_tracking,
        trunk_score=trunk,
        symmetry_score=symmetry,
        tempo_score=tempo,
        lockout_score=lockout,
    )

    # Soft penalty: subtract 5 per HIGH-severity issue instead of hard cap.
    # This ensures dangerous form faults are penalized without completely
    # overriding good performance on other dimensions.
    high_count = sum(1 for issue in issues if issue.severity == IssueSeverity.HIGH)
    if high_count > 0:
        overall = max(0, overall - high_count * 5)

    return RepScore(
        depth_score=round(depth, 1),
        knee_tracking_score=round(knee_tracking, 1),
        trunk_score=round(trunk, 1),
        symmetry_score=round(symmetry, 1),
        tempo_score=round(tempo, 1),
        lockout_score=round(lockout, 1),
        overall_score=round(overall, 1),
        grade=_grade(overall),
        issues=issues,
        cues=cues,
        positive_feedback=positive,
    )


def score_set(
    rep_scores: list[RepScore],
    rep_data_list: list[RepData],
    config: SquatConfig,
    calibration: CalibrationData | None,
) -> SetAnalysis:
    """Score the entire set and detect fatigue."""
    if not rep_scores:
        return SetAnalysis(
            rep_count=0,
            reps=[],
            overall_score=0.0,
            grade="F",
            fatigue_detected=False,
            top_issues=[],
            top_cues=[],
            calibration=calibration,
            config=config,
        )

    overall = sum(r.overall_score for r in rep_scores) / len(rep_scores)

    # Fatigue detection: last 2 reps > 15 points below first 2
    fatigue_detected = False
    if len(rep_scores) >= 4:
        first_avg = sum(r.overall_score for r in rep_scores[:2]) / 2.0
        last_avg = sum(r.overall_score for r in rep_scores[-2:]) / 2.0
        fatigue_detected = (first_avg - last_avg) > 15.0

    # Aggregate issues and cues
    all_issues: list[FormIssue] = []
    for r in rep_scores:
        all_issues.extend(r.issues)
    # Deduplicate by name, keep the most severe
    issue_map: dict[str, FormIssue] = {}
    severity_order = {IssueSeverity.HIGH: 0, IssueSeverity.MODERATE: 1, IssueSeverity.LOW: 2}
    for issue in all_issues:
        if issue.name not in issue_map or severity_order.get(
            issue.severity, 3
        ) < severity_order.get(issue_map[issue.name].severity, 3):
            issue_map[issue.name] = issue
    top_issues = sorted(issue_map.values(), key=lambda i: severity_order.get(i.severity, 3))

    top_cues = get_cues_for_issues(top_issues, config.squat_type.value)

    # Aggregate positive highlights: collect the most common positive feedback
    positive_counts: dict[str, int] = {}
    for r in rep_scores:
        for pf in r.positive_feedback:
            positive_counts[pf] = positive_counts.get(pf, 0) + 1
    # Keep feedback that appeared in at least half of reps
    threshold_count = max(1, len(rep_scores) // 2)
    positive_highlights = [
        msg for msg, count in sorted(
            positive_counts.items(), key=lambda x: -x[1]
        )
        if count >= threshold_count
    ]

    # Side-view warning
    side_view_warning: str | None = None
    if config.camera_view.value == "side":
        side_view_warning = (
            "Side view analysis cannot fully assess knee tracking. "
            "Record a front view for a complete assessment."
        )

    return SetAnalysis(
        rep_count=len(rep_scores),
        reps=rep_scores,
        overall_score=round(overall, 1),
        grade=_grade(overall),
        fatigue_detected=fatigue_detected,
        top_issues=top_issues[:5],
        top_cues=top_cues[:5],
        calibration=calibration,
        config=config,
        side_view_warning=side_view_warning,
        positive_highlights=positive_highlights,
    )


def _grade(score: float) -> str:
    """Map a numeric score to a letter grade."""
    if score >= 90:
        return "A"
    elif score >= 80:
        return "B"
    elif score >= 70:
        return "C"
    elif score >= 60:
        return "D"
    else:
        return "F"
