"""Video loading and frame extraction utilities."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Generator

import cv2
import numpy as np


@dataclass
class VideoMetadata:
    """Metadata about a video file."""

    path: str
    fps: float
    frame_count: int
    width: int
    height: int
    duration: float


def load_video(path: str | Path) -> tuple[cv2.VideoCapture, VideoMetadata]:
    """Open a video file and return the capture object with metadata.

    Args:
        path: Path to the video file.

    Returns:
        Tuple of (VideoCapture, VideoMetadata).

    Raises:
        FileNotFoundError: If the video file does not exist.
        ValueError: If the video cannot be opened.
    """
    path = str(path)
    if not Path(path).exists():
        raise FileNotFoundError(f"Video file not found: {path}")

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video file: {path}")

    metadata = _extract_metadata(cap, path)
    return cap, metadata


def get_metadata(path: str | Path) -> VideoMetadata:
    """Get metadata for a video without keeping it open.

    Args:
        path: Path to the video file.

    Returns:
        VideoMetadata with video properties.
    """
    cap, metadata = load_video(path)
    cap.release()
    return metadata


def extract_frames(
    path: str | Path,
    max_frames: int | None = None,
    step: int = 1,
) -> Generator[tuple[int, np.ndarray], None, None]:
    """Yield (frame_number, frame) tuples from a video file.

    Args:
        path: Path to the video file.
        max_frames: Optional maximum number of frames to extract.
            If None, extracts all frames.
        step: Process every Nth frame (1 = every frame, 2 = every other, etc.).
            Frames that are skipped are not yielded nor counted toward max_frames.

    Yields:
        Tuple of (frame_index, BGR frame as numpy array).
    """
    cap, metadata = load_video(path)

    try:
        frame_idx = 0
        yielded = 0
        while True:
            if max_frames is not None and yielded >= max_frames:
                break

            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % step == 0:
                yield frame_idx, frame
                yielded += 1

            frame_idx += 1
    finally:
        cap.release()


def _extract_metadata(cap: cv2.VideoCapture, path: str) -> VideoMetadata:
    """Extract metadata from an open VideoCapture."""
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        fps = 30.0  # Default fallback

    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration = frame_count / fps if fps > 0 else 0.0

    return VideoMetadata(
        path=path,
        fps=fps,
        frame_count=frame_count,
        width=width,
        height=height,
        duration=duration,
    )
