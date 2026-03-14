"""MediaPipe pose estimation integration."""

from __future__ import annotations

from typing import Optional

import numpy as np

from squat_form.schemas import Point

# MediaPipe landmark indices -> names
LANDMARK_MAP: dict[int, str] = {
    # Face landmarks (0-10) intentionally excluded
    11: "left_shoulder",
    12: "right_shoulder",
    23: "left_hip",
    24: "right_hip",
    25: "left_knee",
    26: "right_knee",
    27: "left_ankle",
    28: "right_ankle",
    29: "left_heel",
    30: "right_heel",
    31: "left_foot_index",
    32: "right_foot_index",
}

try:
    import mediapipe as mp

    _MEDIAPIPE_AVAILABLE = True
except ImportError:
    _MEDIAPIPE_AVAILABLE = False
    mp = None  # type: ignore[assignment]


class PoseExtractor:
    """Extracts named pose landmarks from video frames using MediaPipe.

    Falls back gracefully if mediapipe is not installed.
    """

    def __init__(
        self,
        static_image_mode: bool = False,
        model_complexity: int = 2,
        min_detection_confidence: float = 0.5,
    ) -> None:
        self._pose = None
        if not _MEDIAPIPE_AVAILABLE:
            return

        self._pose = mp.solutions.pose.Pose(
            static_image_mode=static_image_mode,
            model_complexity=model_complexity,
            min_detection_confidence=min_detection_confidence,
            min_tracking_confidence=0.5,
        )

    def extract(self, frame: np.ndarray) -> Optional[dict[str, Point]]:
        """Extract pose landmarks from a single BGR video frame.

        Args:
            frame: BGR image as a numpy array (H, W, 3).

        Returns:
            Dictionary mapping landmark names to Point objects, or None
            if no pose was detected or mediapipe is unavailable.
        """
        if self._pose is None:
            return None

        # Convert BGR to RGB
        import cv2

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self._pose.process(rgb)

        if results.pose_landmarks is None:
            return None

        landmarks: dict[str, Point] = {}
        for idx, name in LANDMARK_MAP.items():
            lm = results.pose_landmarks.landmark[idx]
            landmarks[name] = Point(
                x=lm.x,
                y=lm.y,
                z=lm.z,
                visibility=lm.visibility,
            )

        return landmarks

    def close(self) -> None:
        """Release MediaPipe resources."""
        if self._pose is not None:
            self._pose.close()
            self._pose = None

    def __enter__(self) -> PoseExtractor:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()
