"""Video annotation: skeleton drawing, angle display, phase/score overlays."""

from __future__ import annotations

from typing import Optional

import cv2
import numpy as np

from squat_form.schemas import (
    FormIssue,
    FrameAngles,
    IssueSeverity,
    Point,
    SquatPhase,
)


# Skeleton connections as pairs of landmark names
CONNECTIONS: list[tuple[str, str]] = [
    ("left_shoulder", "right_shoulder"),
    ("left_shoulder", "left_hip"),
    ("right_shoulder", "right_hip"),
    ("left_hip", "right_hip"),
    ("left_hip", "left_knee"),
    ("right_hip", "right_knee"),
    ("left_knee", "left_ankle"),
    ("right_knee", "right_ankle"),
    ("left_ankle", "left_heel"),
    ("right_ankle", "right_heel"),
    ("left_heel", "left_foot_index"),
    ("right_heel", "right_foot_index"),
    ("left_ankle", "left_foot_index"),
    ("right_ankle", "right_foot_index"),
]

# Default joint colors (BGR)
JOINT_COLORS: dict[str, tuple[int, int, int]] = {
    "default": (0, 255, 0),       # green
    "shoulder": (255, 200, 0),    # cyan-ish
    "hip": (0, 200, 255),         # orange
    "knee": (0, 255, 255),        # yellow
    "ankle": (255, 100, 0),       # blue
}

# Severity-based joint override colors (BGR)
_SEVERITY_COLORS: dict[IssueSeverity, tuple[int, int, int]] = {
    IssueSeverity.HIGH: (0, 0, 255),       # red
    IssueSeverity.MODERATE: (0, 165, 255), # orange
    IssueSeverity.LOW: (0, 255, 255),      # yellow
}

# Phase display colors (BGR)
_PHASE_COLORS: dict[SquatPhase, tuple[int, int, int]] = {
    SquatPhase.STANDING: (200, 200, 200),
    SquatPhase.DESCENDING: (0, 200, 255),
    SquatPhase.BOTTOM: (0, 100, 255),
    SquatPhase.ASCENDING: (0, 255, 100),
}


def _joint_group(name: str) -> str:
    """Map a landmark name to its joint group for coloring."""
    if "shoulder" in name:
        return "shoulder"
    if "hip" in name:
        return "hip"
    if "knee" in name:
        return "knee"
    if "ankle" in name or "heel" in name or "foot" in name:
        return "ankle"
    return "default"


def _to_pixel(point: Point, width: int, height: int) -> tuple[int, int]:
    """Convert normalized Point to pixel coordinates."""
    return (int(point.x * width), int(point.y * height))


class SquatAnnotator:
    """Draws skeleton overlays, angles, phase labels, and scores on video frames."""

    def draw_skeleton(
        self,
        frame: np.ndarray,
        landmarks: dict[str, Point],
        issues: Optional[list[FormIssue]] = None,
    ) -> np.ndarray:
        """Draw skeleton with color-coded joints on the frame.

        Args:
            frame: BGR image (modified in place and returned).
            landmarks: Named landmark points (normalized 0-1).
            issues: Optional issues to color-code affected joints.

        Returns:
            The annotated frame.
        """
        h, w = frame.shape[:2]

        # Determine which joints have issues for coloring
        issue_joints: dict[str, IssueSeverity] = {}
        if issues:
            for issue in issues:
                if "knee" in issue.name:
                    issue_joints["knee"] = issue.severity
                if "hip" in issue.name or "butt" in issue.name:
                    issue_joints["hip"] = issue.severity
                if "heel" in issue.name or "ankle" in issue.name:
                    issue_joints["ankle"] = issue.severity
                if "trunk" in issue.name or "lean" in issue.name or "morning" in issue.name:
                    issue_joints["shoulder"] = issue.severity

        # Draw connections
        for start_name, end_name in CONNECTIONS:
            if start_name in landmarks and end_name in landmarks:
                pt1 = _to_pixel(landmarks[start_name], w, h)
                pt2 = _to_pixel(landmarks[end_name], w, h)
                cv2.line(frame, pt1, pt2, (200, 200, 200), 2, cv2.LINE_AA)

        # Draw joints
        for name, point in landmarks.items():
            if point.visibility < 0.3:
                continue

            px = _to_pixel(point, w, h)
            group = _joint_group(name)

            # Use severity color if applicable, otherwise default
            if group in issue_joints:
                color = _SEVERITY_COLORS.get(issue_joints[group], JOINT_COLORS["default"])
            else:
                color = JOINT_COLORS.get(group, JOINT_COLORS["default"])

            radius = 6 if group in ("knee", "hip") else 4
            cv2.circle(frame, px, radius, color, -1, cv2.LINE_AA)
            cv2.circle(frame, px, radius, (255, 255, 255), 1, cv2.LINE_AA)

        return frame

    def draw_angles(
        self,
        frame: np.ndarray,
        landmarks: dict[str, Point],
        angles: FrameAngles,
    ) -> np.ndarray:
        """Draw angle values near the relevant joints.

        Args:
            frame: BGR image.
            landmarks: Named landmark points.
            angles: Computed frame angles.

        Returns:
            The annotated frame.
        """
        h, w = frame.shape[:2]
        font = cv2.FONT_HERSHEY_SIMPLEX
        scale = 0.45
        thickness = 1
        color = (255, 255, 255)

        # Draw angles near their respective joints
        angle_labels = [
            ("left_knee", "right_knee", f"Knee: {angles.knee_angle:.0f}"),
            ("left_hip", "right_hip", f"Hip: {angles.hip_angle:.0f}"),
            ("left_ankle", "right_ankle", f"Ankle: {angles.ankle_angle:.0f}"),
        ]

        for left_key, right_key, label in angle_labels:
            # Use the more visible side
            key = left_key
            if right_key in landmarks:
                if left_key not in landmarks or landmarks[right_key].visibility > landmarks[left_key].visibility:
                    key = right_key

            if key in landmarks:
                px, py = _to_pixel(landmarks[key], w, h)
                # Offset text to the right of the joint
                text_pos = (px + 15, py - 5)
                # Background for readability
                (tw, th), _ = cv2.getTextSize(label, font, scale, thickness)
                cv2.rectangle(
                    frame,
                    (text_pos[0] - 2, text_pos[1] - th - 2),
                    (text_pos[0] + tw + 2, text_pos[1] + 4),
                    (0, 0, 0),
                    -1,
                )
                cv2.putText(frame, label, text_pos, font, scale, color, thickness, cv2.LINE_AA)

        # Trunk angle in the upper area
        trunk_label = f"Trunk: {angles.trunk_angle:.0f}"
        for key in ("left_shoulder", "right_shoulder"):
            if key in landmarks:
                px, py = _to_pixel(landmarks[key], w, h)
                text_pos = (px + 15, py + 20)
                (tw, th), _ = cv2.getTextSize(trunk_label, font, scale, thickness)
                cv2.rectangle(
                    frame,
                    (text_pos[0] - 2, text_pos[1] - th - 2),
                    (text_pos[0] + tw + 2, text_pos[1] + 4),
                    (0, 0, 0),
                    -1,
                )
                cv2.putText(frame, trunk_label, text_pos, font, scale, color, thickness, cv2.LINE_AA)
                break

        return frame

    def draw_phase(
        self,
        frame: np.ndarray,
        phase: SquatPhase,
        rep_count: int,
    ) -> np.ndarray:
        """Draw phase label and rep counter on the frame.

        Args:
            frame: BGR image.
            phase: Current squat phase.
            rep_count: Number of completed reps.

        Returns:
            The annotated frame.
        """
        h, w = frame.shape[:2]
        font = cv2.FONT_HERSHEY_SIMPLEX

        # Phase label (top-left)
        phase_text = phase.value.upper()
        color = _PHASE_COLORS.get(phase, (200, 200, 200))
        cv2.putText(frame, phase_text, (15, 35), font, 0.8, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(frame, phase_text, (15, 35), font, 0.8, color, 2, cv2.LINE_AA)

        # Rep counter (top-left, below phase)
        rep_text = f"Rep: {rep_count}"
        cv2.putText(frame, rep_text, (15, 65), font, 0.7, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(frame, rep_text, (15, 65), font, 0.7, (255, 255, 255), 2, cv2.LINE_AA)

        return frame

    def draw_score(
        self,
        frame: np.ndarray,
        score: float,
    ) -> np.ndarray:
        """Draw the current score on the frame.

        Args:
            frame: BGR image.
            score: Current score (0-100).

        Returns:
            The annotated frame.
        """
        h, w = frame.shape[:2]
        font = cv2.FONT_HERSHEY_SIMPLEX

        score_text = f"Score: {score:.0f}"

        # Color based on score
        if score >= 80:
            color = (0, 255, 0)    # green
        elif score >= 60:
            color = (0, 200, 255)  # orange
        else:
            color = (0, 0, 255)    # red

        # Top-right corner
        (tw, th), _ = cv2.getTextSize(score_text, font, 0.8, 2)
        x = w - tw - 20
        cv2.putText(frame, score_text, (x, 35), font, 0.8, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(frame, score_text, (x, 35), font, 0.8, color, 2, cv2.LINE_AA)

        return frame

    def annotate_frame(
        self,
        frame: np.ndarray,
        landmarks: dict[str, Point] | None,
        angles: FrameAngles | None,
        phase: SquatPhase,
        rep_count: int,
        issues: list[FormIssue] | None = None,
        score: float | None = None,
    ) -> np.ndarray:
        """All-in-one frame annotation.

        Args:
            frame: BGR image.
            landmarks: Named landmark points (or None if no pose).
            angles: Computed angles (or None).
            phase: Current squat phase.
            rep_count: Completed rep count.
            issues: Current form issues.
            score: Current score.

        Returns:
            The fully annotated frame.
        """
        if landmarks is not None:
            frame = self.draw_skeleton(frame, landmarks, issues)
            if angles is not None:
                frame = self.draw_angles(frame, landmarks, angles)

        frame = self.draw_phase(frame, phase, rep_count)

        if score is not None:
            frame = self.draw_score(frame, score)

        return frame


def render_annotated_video(
    input_path: str,
    output_path: str,
    frame_annotations: list[dict],
) -> None:
    """Write an annotated video using cv2.VideoWriter.

    Args:
        input_path: Path to the original video.
        output_path: Path for the output annotated video.
        frame_annotations: List of dicts with keys:
            - landmarks: dict[str, Point] | None
            - angles: FrameAngles | None
            - phase: SquatPhase
            - rep_count: int
            - issues: list[FormIssue] | None
            - score: float | None
    """
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {input_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        fps = 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

    annotator = SquatAnnotator()
    frame_idx = 0

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx < len(frame_annotations):
                ann = frame_annotations[frame_idx]
                frame = annotator.annotate_frame(
                    frame=frame,
                    landmarks=ann.get("landmarks"),
                    angles=ann.get("angles"),
                    phase=ann.get("phase", SquatPhase.STANDING),
                    rep_count=ann.get("rep_count", 0),
                    issues=ann.get("issues"),
                    score=ann.get("score"),
                )

            writer.write(frame)
            frame_idx += 1
    finally:
        cap.release()
        writer.release()
