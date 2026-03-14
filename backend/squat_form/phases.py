"""State machine for squat phase detection and rep counting."""

from __future__ import annotations

from dataclasses import dataclass, field
from collections import deque

from squat_form.schemas import SquatPhase


# --- Constants ---

STANDING_KNEE_ANGLE: float = 160.0
DESCENDING_THRESHOLD: float = 2.0   # per-frame smoothed delta to detect descent
BOTTOM_VELOCITY_THRESHOLD: float = 1.0
ASCENDING_THRESHOLD: float = 2.0    # per-frame smoothed delta to detect ascent
MIN_REP_FRAMES: int = 10
HISTORY_WINDOW: int = 3             # frames to look back for cumulative delta


@dataclass
class RepRange:
    """Frame range for a single rep."""

    start_frame: int
    end_frame: int
    bottom_frame: int
    min_knee_angle: float


class PhaseDetector:
    """State machine that tracks squat phases via smoothed knee angles."""

    def __init__(self) -> None:
        self._phase: SquatPhase = SquatPhase.STANDING
        self._buffer: deque[float] = deque(maxlen=5)
        self._smoothed_history: deque[float] = deque(maxlen=HISTORY_WINDOW + 1)
        self._prev_smoothed: float | None = None
        self._bottom_hold_count: int = 0
        self._rep_start: int | None = None
        self._min_angle: float = 180.0
        self._min_angle_frame: int = 0
        self._frame_idx: int = 0
        self.completed_reps: list[RepRange] = []

    def _smoothed_angle(self) -> float:
        """Return the average of the angle buffer."""
        return sum(self._buffer) / len(self._buffer)

    def _cumulative_delta(self) -> float:
        """Return angle change over the history window for robust detection."""
        if len(self._smoothed_history) < 2:
            return 0.0
        return self._smoothed_history[-1] - self._smoothed_history[0]

    def update(self, knee_angle: float) -> SquatPhase:
        """Feed a new knee angle observation and return the current phase.

        Args:
            knee_angle: Measured knee angle in degrees for this frame.

        Returns:
            Current squat phase after the update.
        """
        self._buffer.append(knee_angle)
        smoothed = self._smoothed_angle()
        self._smoothed_history.append(smoothed)
        delta = (smoothed - self._prev_smoothed) if self._prev_smoothed is not None else 0.0
        cumulative_delta = self._cumulative_delta()

        if self._phase == SquatPhase.STANDING:
            # Use cumulative delta over the history window for robust detection
            if smoothed < STANDING_KNEE_ANGLE and cumulative_delta < -DESCENDING_THRESHOLD:
                self._phase = SquatPhase.DESCENDING
                self._rep_start = self._frame_idx
                self._min_angle = smoothed
                self._min_angle_frame = self._frame_idx
                self._bottom_hold_count = 0

        elif self._phase == SquatPhase.DESCENDING:
            if smoothed < self._min_angle:
                self._min_angle = smoothed
                self._min_angle_frame = self._frame_idx
            # Transition to bottom: velocity near zero or angle starts increasing
            if abs(delta) < BOTTOM_VELOCITY_THRESHOLD:
                self._bottom_hold_count += 1
                if self._bottom_hold_count >= 2:
                    self._phase = SquatPhase.BOTTOM
                    self._bottom_hold_count = 0
            elif delta > 0:
                # Angle started increasing -- we passed the bottom
                self._phase = SquatPhase.BOTTOM
                self._bottom_hold_count = 0
            else:
                self._bottom_hold_count = 0

        elif self._phase == SquatPhase.BOTTOM:
            if smoothed < self._min_angle:
                self._min_angle = smoothed
                self._min_angle_frame = self._frame_idx
            if cumulative_delta > ASCENDING_THRESHOLD:
                self._phase = SquatPhase.ASCENDING

        elif self._phase == SquatPhase.ASCENDING:
            if smoothed >= STANDING_KNEE_ANGLE:
                # Rep complete
                if (
                    self._rep_start is not None
                    and (self._frame_idx - self._rep_start) >= MIN_REP_FRAMES
                ):
                    self.completed_reps.append(
                        RepRange(
                            start_frame=self._rep_start,
                            end_frame=self._frame_idx,
                            bottom_frame=self._min_angle_frame,
                            min_knee_angle=self._min_angle,
                        )
                    )
                self._phase = SquatPhase.STANDING
                self._rep_start = None
                self._min_angle = 180.0

        self._prev_smoothed = smoothed
        self._frame_idx += 1
        return self._phase

    def reset(self) -> None:
        """Reset the detector to its initial state."""
        self._phase = SquatPhase.STANDING
        self._buffer = deque(maxlen=5)
        self._smoothed_history = deque(maxlen=HISTORY_WINDOW + 1)
        self._prev_smoothed = None
        self._bottom_hold_count = 0
        self._rep_start = None
        self._min_angle = 180.0
        self._min_angle_frame = 0
        self._frame_idx = 0
        self.completed_reps = []


def detect_reps(knee_angles: list[float]) -> list[RepRange]:
    """Convenience function: detect reps from a list of knee angles.

    Args:
        knee_angles: Per-frame knee angle measurements.

    Returns:
        List of detected RepRange objects.
    """
    detector = PhaseDetector()
    for angle in knee_angles:
        detector.update(angle)
    return detector.completed_reps


def get_phases(knee_angles: list[float]) -> list[SquatPhase]:
    """Return the phase label for each frame.

    Args:
        knee_angles: Per-frame knee angle measurements.

    Returns:
        List of SquatPhase values, one per frame.
    """
    detector = PhaseDetector()
    phases: list[SquatPhase] = []
    for angle in knee_angles:
        phases.append(detector.update(angle))
    return phases
