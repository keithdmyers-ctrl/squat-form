"""Main analysis engine that orchestrates pose estimation, phase detection, and scoring."""

from __future__ import annotations

import math

from squat_form.schemas import (
    BarPathData,
    CalibrationData,
    CameraView,
    FormIssue,
    FrameAngles,
    IssueSeverity,
    MobilityFindingModel,
    Point,
    RepData,
    SetAnalysis,
    SquatConfig,
    SquatPhase,
    SquatType,
    StickingPoint,
    VelocityMetrics,
    WarmUpStepModel,
)
from squat_form.angles import compute_frame_angles
from squat_form.calibration import calibrate_from_standing, check_competition_depth
from squat_form.feedback import generate_text_report
from squat_form.mobility import assess_mobility, generate_warmup
from squat_form.phases import PhaseDetector
from squat_form.scorer import score_rep, score_set


class FormAnalyzer:
    """Analyzes a sequence of pose landmarks to score squat form."""

    def __init__(self, config: SquatConfig) -> None:
        self.config = config

    def analyze_landmarks_sequence(
        self,
        frames: list[dict[str, Point]],
        fps: float,
    ) -> SetAnalysis:
        """Run full analysis on a sequence of per-frame landmarks.

        Args:
            frames: List of landmark dictionaries, one per frame.
            fps: Video frame rate (frames per second).

        Returns:
            SetAnalysis with scored reps, issues, and cues.
        """
        if not frames or fps <= 0:
            return SetAnalysis(
                rep_count=0,
                reps=[],
                overall_score=0.0,
                grade="F",
                fatigue_detected=False,
                top_issues=[],
                top_cues=[],
                calibration=None,
                config=self.config,
            )

        # Step 1: Calibrate from the first few standing frames
        calibration = self._calibrate(frames)

        standing_knee_width = (
            calibration.standing_knee_width if calibration else None
        )

        # Step 2: Compute angles per frame
        all_angles: list[FrameAngles] = []
        for lm in frames:
            angles = compute_frame_angles(lm, standing_knee_width)
            all_angles.append(angles)

        # Step 3: Detect phases and reps
        detector = PhaseDetector()
        phases: list[SquatPhase] = []
        for angles in all_angles:
            phase = detector.update(angles.knee_angle)
            phases.append(phase)

        reps = detector.completed_reps

        if not reps:
            # No complete reps detected
            return SetAnalysis(
                rep_count=0,
                reps=[],
                overall_score=0.0,
                grade="F",
                fatigue_detected=False,
                top_issues=[],
                top_cues=[],
                calibration=calibration,
                config=self.config,
            )

        # Step 4: Extract RepData for each rep
        rep_data_list: list[RepData] = []
        for i, rep_range in enumerate(reps):
            rep_data = self._extract_rep_data(
                rep_number=i + 1,
                start_frame=rep_range.start_frame,
                end_frame=rep_range.end_frame,
                bottom_frame=rep_range.bottom_frame,
                all_angles=all_angles,
                all_landmarks=frames,
                fps=fps,
                calibration=calibration,
            )
            rep_data_list.append(rep_data)

        # Step 5: Compute sticking points, bar path, and velocity for each rep
        for rep_data in rep_data_list:
            rep_knee = [fa.knee_angle for fa in rep_data.frame_angles]
            rep_hip = [fa.hip_angle for fa in rep_data.frame_angles]
            local_bottom = rep_data.bottom_frame - rep_data.start_frame
            local_end = rep_data.end_frame - rep_data.start_frame

            # Sticking points (during ascent)
            if len(rep_knee) > 3:
                rep_data.sticking_points = detect_sticking_points(
                    rep_knee, rep_hip, fps, local_bottom, local_end,
                )

            # Bar path (for loaded squat types)
            loaded_types = (SquatType.HIGH_BAR, SquatType.LOW_BAR)
            if self.config.squat_type in loaded_types:
                rep_data.bar_path = compute_bar_path(
                    frames, rep_data.start_frame, rep_data.end_frame,
                )

            # Velocity metrics
            if len(rep_knee) > 3:
                rep_data.velocity = compute_velocity_metrics(
                    rep_knee, fps, local_bottom,
                )

        # Step 6: Score each rep
        rep_scores = [
            score_rep(rd, self.config, calibration) for rd in rep_data_list
        ]

        # Step 7: Score the set
        result = score_set(rep_scores, rep_data_list, self.config, calibration)

        # Step 8: Mobility assessment and warmup protocol
        all_issues: list[FormIssue] = []
        for rs in rep_scores:
            all_issues.extend(rs.issues)

        mobility_findings = assess_mobility(all_issues, self.config)
        warmup_steps = generate_warmup(all_issues, self.config)

        result.mobility_findings = [
            MobilityFindingModel(
                area=f.area,
                limitation=f.limitation,
                test=f.test,
                stretches=f.stretches,
                frequency=f.frequency,
            )
            for f in mobility_findings
        ]
        result.warmup_protocol = [
            WarmUpStepModel(
                name=s.name,
                description=s.description,
                duration=s.duration,
                purpose=s.purpose,
            )
            for s in warmup_steps
        ]

        # Step 9: Generate text report
        result.report_text = generate_text_report(result)

        # Step 10: Add side-view warning if applicable
        if self.config.camera_view == CameraView.SIDE and result.side_view_warning is None:
            result.side_view_warning = (
                "Side view analysis cannot fully assess knee tracking. "
                "Record a front view for a complete assessment."
            )

        return result

    def _calibrate(self, frames: list[dict[str, Point]]) -> CalibrationData | None:
        """Calibrate from the first few frames (assumed standing)."""
        # Use the first frame with reasonable landmark visibility
        for lm in frames[:30]:  # Check up to first 30 frames
            required = [
                "left_shoulder", "right_shoulder",
                "left_hip", "right_hip",
                "left_knee", "right_knee",
                "left_ankle", "right_ankle",
            ]
            if all(k in lm for k in required):
                avg_vis = sum(lm[k].visibility for k in required) / len(required)
                if avg_vis > 0.5:
                    # Validate standing posture (knee angle > 150 degrees)
                    from squat_form.angles import calculate_angle
                    is_standing = True
                    for side in ("left", "right"):
                        hip_k, knee_k, ankle_k = f"{side}_hip", f"{side}_knee", f"{side}_ankle"
                        if all(k in lm for k in (hip_k, knee_k, ankle_k)):
                            knee_angle = calculate_angle(
                                (lm[hip_k].x, lm[hip_k].y, lm[hip_k].z),
                                (lm[knee_k].x, lm[knee_k].y, lm[knee_k].z),
                                (lm[ankle_k].x, lm[ankle_k].y, lm[ankle_k].z),
                            )
                            if knee_angle < 150.0:
                                is_standing = False
                                break
                    if not is_standing:
                        continue
                    try:
                        return calibrate_from_standing(lm)
                    except (KeyError, ZeroDivisionError):
                        continue
        return None

    def _extract_rep_data(
        self,
        rep_number: int,
        start_frame: int,
        end_frame: int,
        bottom_frame: int,
        all_angles: list[FrameAngles],
        all_landmarks: list[dict[str, Point]],
        fps: float,
        calibration: CalibrationData | None,
    ) -> RepData:
        """Extract detailed RepData for a single rep."""
        # Clamp frame indices to valid range
        start = max(0, min(start_frame, len(all_angles) - 1))
        end = max(start, min(end_frame, len(all_angles) - 1))
        bottom = max(start, min(bottom_frame, end))

        rep_angles = all_angles[start : end + 1]

        if not rep_angles:
            # Edge case: no frames in range
            return RepData(
                rep_number=rep_number,
                start_frame=start,
                end_frame=end,
                bottom_frame=bottom,
                min_knee_angle=180.0,
                min_hip_angle=180.0,
                max_trunk_angle=0.0,
                descent_duration=0.0,
                bottom_duration=0.0,
                ascent_duration=0.0,
                frame_angles=[],
            )

        # Min/max angles
        min_knee = min(fa.knee_angle for fa in rep_angles)
        min_hip = min(fa.hip_angle for fa in rep_angles)
        max_trunk = max(fa.trunk_angle for fa in rep_angles)

        # Phase durations
        descent_frames = max(1, bottom - start)
        ascent_frames = max(1, end - bottom)
        # Estimate bottom duration: frames near the bottom where angle is within 5 deg of min
        bottom_count = sum(
            1 for fa in rep_angles
            if fa.knee_angle <= min_knee + 5.0
        )

        descent_duration = descent_frames / fps
        ascent_duration = ascent_frames / fps
        bottom_duration = bottom_count / fps

        # Form checks
        heel_rise = self._check_heel_rise(start, end, bottom, all_landmarks)
        butt_wink, pelvic_tilt = self._check_butt_wink(start, end, bottom, all_angles)
        good_morning, trunk_change = self._check_good_morning(start, end, bottom, all_angles)
        knee_valgus = self._check_knee_valgus(rep_angles)

        # Competition depth check at bottom frame
        comp_depth_pass: bool | None = None
        comp_depth_margin: float | None = None
        if bottom < len(all_landmarks):
            bottom_lm = all_landmarks[bottom]
            # Try to find hip and knee landmarks for competition depth
            # Check BOTH sides and use the worst case (shallowest hip crease),
            # since IPF judges use the worst side.
            depth_results = []
            for side in ("left", "right"):
                hip_key = f"{side}_hip"
                knee_key = f"{side}_knee"
                if hip_key in bottom_lm and knee_key in bottom_lm:
                    hip_pt = bottom_lm[hip_key]
                    knee_pt = bottom_lm[knee_key]
                    if hip_pt.visibility > 0.5 and knee_pt.visibility > 0.5:
                        passed, margin = check_competition_depth(hip_pt, knee_pt)
                        depth_results.append((passed, margin))

            if depth_results:
                # Use the worst case (the side that's least deep)
                comp_depth_pass = all(p for p, _ in depth_results)
                comp_depth_margin = min(m for _, m in depth_results)

        return RepData(
            rep_number=rep_number,
            start_frame=start,
            end_frame=end,
            bottom_frame=bottom,
            min_knee_angle=min_knee,
            min_hip_angle=min_hip,
            max_trunk_angle=max_trunk,
            descent_duration=descent_duration,
            bottom_duration=bottom_duration,
            ascent_duration=ascent_duration,
            frame_angles=rep_angles,
            heel_rise=heel_rise,
            butt_wink=butt_wink,
            good_morning=good_morning,
            knee_valgus=knee_valgus,
            trunk_angle_change_on_ascent=trunk_change,
            pelvic_tilt_at_bottom=pelvic_tilt,
            competition_depth_pass=comp_depth_pass,
            competition_depth_margin=comp_depth_margin,
        )

    def _check_heel_rise(
        self,
        start: int,
        end: int,
        bottom: int,
        landmarks: list[dict[str, Point]],
    ) -> bool:
        """Check if heel y-position rises significantly during descent."""
        if start >= len(landmarks) or end >= len(landmarks):
            return False

        # Get standing heel position
        start_lm = landmarks[start]
        heel_key = None
        for key in ("left_heel", "right_heel"):
            if key in start_lm:
                heel_key = key
                break
        if heel_key is None:
            return False

        standing_heel_y = start_lm[heel_key].y

        # Check if heel rises (y decreases in image coords) during the rep
        max_rise = 0.0
        for i in range(start, min(end + 1, len(landmarks))):
            if heel_key in landmarks[i]:
                rise = standing_heel_y - landmarks[i][heel_key].y
                if rise > max_rise:
                    max_rise = rise

        # Threshold: 2% of frame height is a significant rise
        # Since landmarks are normalized 0-1 in mediapipe, 0.02 is reasonable
        return max_rise > 0.02

    def _check_butt_wink(
        self,
        start: int,
        end: int,
        bottom: int,
        all_angles: list[FrameAngles],
    ) -> tuple[bool, float]:
        """Check for posterior pelvic tilt at the bottom.

        Compares trunk angle at mid-descent to bottom.

        Returns:
            (butt_wink_detected, pelvic_tilt_degrees)
        """
        if bottom >= len(all_angles) or start >= len(all_angles):
            return False, 0.0

        mid_descent = start + (bottom - start) // 2
        mid_descent = max(start, min(mid_descent, len(all_angles) - 1))

        mid_trunk = all_angles[mid_descent].trunk_angle
        bottom_trunk = all_angles[bottom].trunk_angle

        # Butt wink manifests as a change in trunk/hip angle relationship at the bottom
        # Use hip angle change as a proxy for pelvic tilt
        mid_hip = all_angles[mid_descent].hip_angle
        bottom_hip = all_angles[bottom].hip_angle
        pelvic_tilt = abs(bottom_hip - mid_hip) - abs(bottom_trunk - mid_trunk)

        return pelvic_tilt > 12.0, pelvic_tilt

    def _check_good_morning(
        self,
        start: int,
        end: int,
        bottom: int,
        all_angles: list[FrameAngles],
    ) -> tuple[bool, float]:
        """Check if trunk angle increases beyond threshold during ascent.

        Uses 20 deg for low-bar squats (some forward lean is biomechanically
        inevitable), 15 deg for all other squat types.

        Returns:
            (good_morning_detected, trunk_angle_change)
        """
        if bottom >= len(all_angles) or end >= len(all_angles):
            return False, 0.0

        bottom_trunk = all_angles[bottom].trunk_angle

        # Find max trunk angle during ascent
        max_trunk_ascent = bottom_trunk
        for i in range(bottom, min(end + 1, len(all_angles))):
            if all_angles[i].trunk_angle > max_trunk_ascent:
                max_trunk_ascent = all_angles[i].trunk_angle

        change = max_trunk_ascent - bottom_trunk
        threshold = 20.0 if self.config.squat_type == SquatType.LOW_BAR else 15.0
        return change > threshold, change

    def _check_knee_valgus(self, rep_angles: list[FrameAngles]) -> bool:
        """Check if knee width ratio drops below the valgus threshold for the configured experience level."""
        from squat_form.schemas import ExperienceLevel
        valgus_threshold = {
            ExperienceLevel.BEGINNER: 0.80,
            ExperienceLevel.INTERMEDIATE: 0.85,
            ExperienceLevel.ADVANCED: 0.90,
        }.get(self.config.experience_level, 0.85)
        for fa in rep_angles:
            if fa.knee_width_ratio is not None and fa.knee_width_ratio < valgus_threshold:
                return True
        return False


# ---------------------------------------------------------------------------
# Sticking point detection
# ---------------------------------------------------------------------------


def detect_sticking_points(
    knee_angles: list[float],
    hip_angles: list[float],
    fps: float,
    bottom_idx: int,
    end_idx: int,
) -> list[StickingPoint]:
    """Detect sticking points from angular velocity analysis during ascent.

    A sticking point is where the ascent velocity drops significantly,
    indicating the weakest point in the lift.

    Args:
        knee_angles: List of knee angles for the rep frames.
        hip_angles: List of hip angles for the rep frames.
        fps: Video frame rate.
        bottom_idx: Index within the rep-local arrays where the bottom occurs.
        end_idx: Index within the rep-local arrays where the rep ends.

    Returns:
        List of StickingPoint objects found during ascent.
    """
    if fps <= 0 or bottom_idx >= end_idx or len(knee_angles) < 3:
        return []

    # Extract ascent portion
    ascent_start = min(bottom_idx, len(knee_angles) - 1)
    ascent_end = min(end_idx, len(knee_angles) - 1)

    if ascent_end - ascent_start < 3:
        return []

    # Compute angular velocity (change per frame) during ascent
    velocities: list[float] = []
    for i in range(ascent_start + 1, ascent_end + 1):
        vel = knee_angles[i] - knee_angles[i - 1]
        velocities.append(vel)

    if not velocities:
        return []

    # Smooth with 3-frame rolling average
    smoothed: list[float] = []
    for i in range(len(velocities)):
        window_start = max(0, i - 1)
        window_end = min(len(velocities), i + 2)
        avg = sum(velocities[window_start:window_end]) / (window_end - window_start)
        smoothed.append(avg)

    # Peak ascent velocity (positive = angle increasing = ascending)
    peak_velocity = max(smoothed) if smoothed else 0.0

    if peak_velocity <= 0:
        return []  # No clear ascent detected

    # Find frames where velocity drops below 50% of peak
    threshold = peak_velocity * 0.5
    sticking_frames: list[int] = []
    for i, vel in enumerate(smoothed):
        if vel < threshold and vel >= 0:
            sticking_frames.append(i)

    if not sticking_frames:
        return []

    # The deepest such frame is the primary sticking point
    primary_frame_local = sticking_frames[0]  # First = deepest since we start from bottom
    frame_in_rep = ascent_start + 1 + primary_frame_local

    # Clamp to valid range
    frame_in_rep = min(frame_in_rep, len(knee_angles) - 1)

    # Compute depth percentage
    bottom_angle = knee_angles[ascent_start] if ascent_start < len(knee_angles) else 90.0
    standing_angle = knee_angles[-1] if knee_angles else 170.0
    angle_range = standing_angle - bottom_angle

    if angle_range > 0:
        current_angle = knee_angles[frame_in_rep] if frame_in_rep < len(knee_angles) else bottom_angle
        depth_pct = ((current_angle - bottom_angle) / angle_range) * 100.0
    else:
        depth_pct = 50.0

    depth_pct = max(0.0, min(100.0, depth_pct))

    # Description based on depth percentage
    if depth_pct < 30:
        region = "out of the hole"
    elif depth_pct < 60:
        region = "mid-range"
    else:
        region = "near lockout"

    knee_angle_val = knee_angles[frame_in_rep] if frame_in_rep < len(knee_angles) else 0.0
    hip_angle_val = hip_angles[frame_in_rep] if frame_in_rep < len(hip_angles) else 0.0
    velocity_drop = peak_velocity - smoothed[primary_frame_local] if primary_frame_local < len(smoothed) else 0.0

    return [
        StickingPoint(
            frame=frame_in_rep,
            knee_angle=knee_angle_val,
            hip_angle=hip_angle_val,
            depth_percentage=round(depth_pct, 1),
            velocity_drop=round(velocity_drop, 2),
            description=f"Sticking point at {depth_pct:.0f}% depth ({region})",
        )
    ]


# ---------------------------------------------------------------------------
# Bar path estimation
# ---------------------------------------------------------------------------


def compute_bar_path(
    landmarks_sequence: list[dict[str, Point]],
    rep_start: int,
    rep_end: int,
) -> BarPathData:
    """Estimate bar path from shoulder landmarks during a rep.

    For high_bar/low_bar squats, the bar position is estimated from the
    mid-shoulder point (average of left and right shoulder landmarks).

    Args:
        landmarks_sequence: Full sequence of landmark dictionaries.
        rep_start: Start frame index.
        rep_end: End frame index.

    Returns:
        BarPathData with path analysis.
    """
    frames_list: list[int] = []
    x_positions: list[float] = []
    y_positions: list[float] = []

    start = max(0, rep_start)
    end = min(rep_end + 1, len(landmarks_sequence))

    for i in range(start, end):
        lm = landmarks_sequence[i]
        left_shoulder = lm.get("left_shoulder")
        right_shoulder = lm.get("right_shoulder")
        if left_shoulder is None or right_shoulder is None:
            continue
        if left_shoulder.visibility < 0.3 or right_shoulder.visibility < 0.3:
            continue

        mid_x = (left_shoulder.x + right_shoulder.x) / 2.0
        mid_y = (left_shoulder.y + right_shoulder.y) / 2.0

        frames_list.append(i)
        x_positions.append(mid_x)
        y_positions.append(mid_y)

    if len(x_positions) < 2:
        return BarPathData(description="Insufficient data for bar path analysis")

    # Lateral drift
    start_x = x_positions[0]
    lateral_drift = max(abs(x - start_x) for x in x_positions)

    # Vertical range
    vertical_range = max(y_positions) - min(y_positions)

    # Path efficiency: straight line / actual path length
    straight_line = math.sqrt(
        (x_positions[-1] - x_positions[0]) ** 2
        + (y_positions[-1] - y_positions[0]) ** 2
    )

    actual_path = 0.0
    for i in range(1, len(x_positions)):
        dx = x_positions[i] - x_positions[i - 1]
        dy = y_positions[i] - y_positions[i - 1]
        actual_path += math.sqrt(dx * dx + dy * dy)

    if actual_path > 1e-9:
        path_efficiency = min(1.0, straight_line / actual_path)
    else:
        path_efficiency = 1.0

    # Classification
    if path_efficiency > 0.95:
        quality = "Excellent bar path"
    elif path_efficiency > 0.85:
        quality = "Good bar path"
    elif path_efficiency > 0.75:
        quality = "Some drift in bar path"
    else:
        quality = "Significant drift in bar path"

    # Determine drift direction
    drift_desc = quality
    if lateral_drift > 0.01:
        # Find frame with max drift and determine if it's forward or back
        max_drift_idx = max(range(len(x_positions)), key=lambda i: abs(x_positions[i] - start_x))
        drift_dir = x_positions[max_drift_idx] - start_x
        # Find if this happens at bottom or top
        y_at_drift = y_positions[max_drift_idx]
        mid_y_val = (min(y_positions) + max(y_positions)) / 2.0
        at_bottom = y_at_drift > mid_y_val
        position_word = "at the bottom" if at_bottom else "at the top"
        # In image coords, positive x can be forward or backward depending on view
        drift_desc = f"{quality} -- bar drifts {position_word}"

    return BarPathData(
        frames=frames_list,
        x_positions=x_positions,
        y_positions=y_positions,
        lateral_drift=round(lateral_drift, 4),
        vertical_range=round(vertical_range, 4),
        path_efficiency=round(path_efficiency, 3),
        description=drift_desc,
    )


# ---------------------------------------------------------------------------
# Velocity metrics
# ---------------------------------------------------------------------------


def compute_velocity_metrics(
    knee_angles: list[float],
    fps: float,
    bottom_idx: int,
) -> VelocityMetrics:
    """Compute velocity metrics for a rep from knee angle data.

    Args:
        knee_angles: Knee angles for each frame of the rep.
        fps: Video frame rate.
        bottom_idx: Index of the bottom frame within the rep.

    Returns:
        VelocityMetrics with peak/mean velocities.
    """
    if len(knee_angles) < 3 or fps <= 0:
        return VelocityMetrics(description="Insufficient data for velocity analysis")

    bottom = min(bottom_idx, len(knee_angles) - 1)

    # Descent velocities (angle decreasing -> negative change)
    descent_vels: list[float] = []
    for i in range(1, bottom + 1):
        if i < len(knee_angles):
            vel = abs(knee_angles[i] - knee_angles[i - 1]) * fps  # degrees per second
            descent_vels.append(vel)

    # Ascent velocities (angle increasing -> positive change)
    ascent_vels: list[float] = []
    for i in range(bottom + 1, len(knee_angles)):
        vel = abs(knee_angles[i] - knee_angles[i - 1]) * fps  # degrees per second
        ascent_vels.append(vel)

    peak_descent = max(descent_vels) if descent_vels else 0.0
    peak_ascent = max(ascent_vels) if ascent_vels else 0.0
    mean_descent = sum(descent_vels) / len(descent_vels) if descent_vels else 0.0
    mean_ascent = sum(ascent_vels) / len(ascent_vels) if ascent_vels else 0.0

    ratio = mean_ascent / mean_descent if mean_descent > 0 else 1.0

    if ratio > 1.2:
        description = "Explosive ascent -- faster up than down"
    elif ratio > 0.8:
        description = "Balanced tempo -- similar speed up and down"
    else:
        description = "Controlled ascent -- slower up than down (grinding)"

    return VelocityMetrics(
        peak_descent_velocity=round(peak_descent, 1),
        peak_ascent_velocity=round(peak_ascent, 1),
        mean_descent_velocity=round(mean_descent, 1),
        mean_ascent_velocity=round(mean_ascent, 1),
        ascent_to_descent_ratio=round(ratio, 2),
        description=description,
    )
