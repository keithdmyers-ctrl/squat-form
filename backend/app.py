"""FastAPI application for squat form analysis."""

from __future__ import annotations

import asyncio
import functools
import logging
import math
import os
import tempfile
import time
import uuid
from pathlib import Path

from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, Request, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from squat_form.rate_limit import check_rate_limit
from squat_form.schemas import (
    AnalysisResponse,
    CameraView,
    ExperienceLevel,
    SquatConfig,
    SquatPhase,
    SquatType,
)
from squat_form.analyzer import FormAnalyzer
from squat_form.angles import compute_frame_angles
from squat_form.annotator import render_annotated_video
from squat_form.phases import PhaseDetector
from squat_form.pose import PoseExtractor
from squat_form.video import extract_frames, get_metadata

logger = logging.getLogger(__name__)

# Maximum upload size: 100 MB
MAX_UPLOAD_SIZE = 100 * 1024 * 1024

# Allowed video file extensions
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".avi", ".webm", ".mkv"}

# Directories
BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
ANNOTATED_DIR = BASE_DIR / "annotated_videos"
ANNOTATED_DIR.mkdir(exist_ok=True)


def _cleanup_annotated_videos(exclude_filename: str | None = None) -> None:
    """Remove annotated videos older than 1 hour.

    Args:
        exclude_filename: If provided, skip this file during cleanup to avoid
            deleting the just-created annotated video (race condition prevention).
    """
    if not ANNOTATED_DIR.exists():
        return
    cutoff = time.time() - 3600  # 1 hour
    for f in ANNOTATED_DIR.iterdir():
        try:
            if f.is_file() and f.stat().st_mtime < cutoff:
                if exclude_filename and f.name == exclude_filename:
                    continue
                f.unlink(missing_ok=True)
        except FileNotFoundError:
            pass  # Already deleted by another request — not an error
        except OSError:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run cleanup on startup."""
    _cleanup_annotated_videos()
    yield


app = FastAPI(
    title="Squat Form Analyzer",
    description="AI-powered squat form analysis using MediaPipe pose estimation",
    version="1.1.0",
    lifespan=lifespan,
)

# Set CORS_ORIGINS env var for production (e.g., "https://example.com")
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "*").split(",")

# allow_credentials=True is only valid with explicit origins, not wildcard "*"
_cors_use_credentials = "*" not in CORS_ORIGINS

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=_cors_use_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def root():
    """Serve the upload UI."""
    return FileResponse(str(STATIC_DIR / "index.html"))


@app.get("/api/v1/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok"}


@app.get("/api/v1/annotated/{filename}")
async def get_annotated_video(filename: str):
    """Serve an annotated video file."""
    # Sanitize: strip path traversal sequences and resolve
    sanitized = filename.replace("..", "").replace("/", "").replace("\\", "")
    filepath = (ANNOTATED_DIR / sanitized).resolve()

    # Ensure the resolved path is within the annotated directory
    if not str(filepath).startswith(str(ANNOTATED_DIR.resolve())):
        raise HTTPException(status_code=404, detail="Annotated video not found")

    if not filepath.exists():
        raise HTTPException(
            status_code=404,
            detail="Annotated video not found or has been cleaned up. Please re-analyze.",
        )

    try:
        return FileResponse(
            str(filepath),
            media_type="video/mp4",
            filename=sanitized,
        )
    except FileNotFoundError:
        # File was cleaned up between the exists() check and the read — race condition
        raise HTTPException(
            status_code=404,
            detail="Annotated video was cleaned up. Please re-analyze.",
        )


def _process_video_sync(tmp_path: str, config: SquatConfig) -> dict:
    """Run synchronous video processing (OpenCV/MediaPipe) off the event loop.

    Returns a dict with the processing results or error information.
    """
    import cv2

    # Validate that OpenCV can open the file
    cap = cv2.VideoCapture(tmp_path)
    if not cap.isOpened():
        cap.release()
        return {"error": "File is not a readable video", "status": 415}
    cap.release()

    # Get video metadata
    try:
        metadata = get_metadata(tmp_path)
    except (FileNotFoundError, ValueError) as exc:
        return {"error": f"Invalid video file: {exc}", "status": 400}

    if metadata.frame_count == 0:
        return {"error": "Video has no frames", "status": 400}

    # Reject videos longer than 5 minutes
    fps = metadata.fps
    frame_count = metadata.frame_count
    duration = frame_count / fps if fps > 0 else 0.0

    if duration > 300:
        return {
            "error": "Video is too long (max 5 minutes). Please trim to a single set of squats.",
            "status": 400,
        }

    # Subsample long videos: if more than 1800 frames (60s at 30fps),
    # process every Nth frame to keep total processed frames under 1800
    MAX_PROCESSED_FRAMES = 1800
    if frame_count > MAX_PROCESSED_FRAMES:
        step = math.ceil(frame_count / MAX_PROCESSED_FRAMES)
        effective_fps = fps / step
    else:
        step = 1
        effective_fps = fps

    # Extract landmarks from frames (with subsampling for long videos)
    all_landmarks: list[dict] = []
    all_frames_raw: list[dict | None] = []
    pose_extractor = PoseExtractor(
        static_image_mode=False,
        model_complexity=2,
        min_detection_confidence=0.5,
    )

    try:
        for frame_idx, frame in extract_frames(tmp_path, step=step):
            lm = pose_extractor.extract(frame)
            all_frames_raw.append(lm)
            if lm is not None:
                all_landmarks.append(lm)
            else:
                # Use empty dict for frames with no detection
                all_landmarks.append({})
    finally:
        pose_extractor.close()

    if not any(all_frames_raw):
        return {
            "error": "No pose detected in any frame. Ensure the full body is visible.",
            "status": 400,
        }

    # Filter to only frames with valid landmarks for analysis
    valid_frames = [lm for lm in all_landmarks if lm]

    if len(valid_frames) < 10:
        return {
            "error": "Too few frames with detected pose. Ensure good lighting and full body visibility.",
            "status": 400,
        }

    # Run analysis (use effective_fps which accounts for subsampling)
    analyzer = FormAnalyzer(config)
    analysis = analyzer.analyze_landmarks_sequence(valid_frames, effective_fps)

    # Build frame annotations for video rendering
    standing_knee_width = (
        analysis.calibration.standing_knee_width
        if analysis.calibration
        else None
    )
    phase_detector = PhaseDetector()
    frame_annotations: list[dict] = []
    current_score: float | None = None

    # Map rep scores by frame range for display
    rep_score_map: dict[int, float] = {}
    if analysis.reps:
        for i, rep_score in enumerate(analysis.reps):
            rep_score_map[i] = rep_score.overall_score

    valid_idx = 0
    rep_count = 0

    for raw_lm in all_frames_raw:
        if raw_lm is not None and raw_lm:
            angles = compute_frame_angles(raw_lm, standing_knee_width)
            phase = phase_detector.update(angles.knee_angle)
            rep_count = len(phase_detector.completed_reps)

            if rep_count > 0 and (rep_count - 1) in rep_score_map:
                current_score = rep_score_map[rep_count - 1]

            frame_annotations.append({
                "landmarks": raw_lm,
                "angles": angles,
                "phase": phase,
                "rep_count": rep_count,
                "issues": analysis.top_issues if current_score is not None else None,
                "score": current_score,
            })
            valid_idx += 1
        else:
            frame_annotations.append({
                "landmarks": None,
                "angles": None,
                "phase": SquatPhase.STANDING,
                "rep_count": rep_count,
                "issues": None,
                "score": current_score,
            })

    # Render annotated video (include timestamp to prevent stale file conflicts)
    video_id = uuid.uuid4().hex[:12]
    gen_ts = int(time.time())
    output_filename = f"annotated_{video_id}_{gen_ts}.mp4"
    output_path = str(ANNOTATED_DIR / output_filename)

    try:
        render_annotated_video(tmp_path, output_path, frame_annotations)
        annotated_url = f"/api/v1/annotated/{output_filename}"
    except Exception:
        logger.exception("Failed to render annotated video")
        annotated_url = None
        output_filename = None

    # Clean up old annotated videos after each analysis, excluding the one we just created
    _cleanup_annotated_videos(exclude_filename=output_filename)

    return {
        "success": True,
        "analysis": analysis,
        "annotated_video_url": annotated_url,
    }


@app.post("/api/v1/analyze")
async def analyze_video(
    request: Request,
    file: UploadFile = File(...),
    squat_type: str = Form("bodyweight"),
    experience_level: str = Form("beginner"),
    camera_view: str = Form("side"),
    competition_mode: str = Form("false"),
):
    """Analyze a squat video.

    Accepts a multipart file upload along with configuration parameters.
    Runs pose estimation, analyzes form, and returns scored results.
    """
    # Rate limiting: 10 requests per minute per IP
    rate_limit_response = await check_rate_limit(request)
    if rate_limit_response is not None:
        return rate_limit_response

    # Validate enum values — return 422 for invalid values instead of silent fallback
    try:
        st = SquatType(squat_type)
    except ValueError:
        valid = [e.value for e in SquatType]
        return JSONResponse(
            status_code=422,
            content=AnalysisResponse(
                success=False,
                error=f"Invalid squat_type '{squat_type}'. Valid values: {valid}",
            ).model_dump(),
        )

    try:
        el = ExperienceLevel(experience_level)
    except ValueError:
        valid = [e.value for e in ExperienceLevel]
        return JSONResponse(
            status_code=422,
            content=AnalysisResponse(
                success=False,
                error=f"Invalid experience_level '{experience_level}'. Valid values: {valid}",
            ).model_dump(),
        )

    try:
        cv = CameraView(camera_view)
    except ValueError:
        valid = [e.value for e in CameraView]
        return JSONResponse(
            status_code=422,
            content=AnalysisResponse(
                success=False,
                error=f"Invalid camera_view '{camera_view}'. Valid values: {valid}",
            ).model_dump(),
        )

    # Parse competition_mode from form string
    comp_mode = competition_mode.lower() in ("true", "1", "yes")

    config = SquatConfig(
        squat_type=st,
        experience_level=el,
        camera_view=cv,
        competition_mode=comp_mode,
    )

    # Validate file extension
    original_filename = file.filename or "video.mp4"
    suffix = Path(original_filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        return JSONResponse(
            status_code=415,
            content=AnalysisResponse(
                success=False,
                error=f"Unsupported file type '{suffix}'. Accepted formats: {sorted(ALLOWED_EXTENSIONS)}",
            ).model_dump(),
        )

    # Save uploaded file to temp location with chunked reading and size limit
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=suffix)
    try:
        total_size = 0
        try:
            with os.fdopen(tmp_fd, "wb") as f:
                while True:
                    chunk = await file.read(1024 * 1024)  # Read 1 MB at a time
                    if not chunk:
                        break
                    total_size += len(chunk)
                    if total_size > MAX_UPLOAD_SIZE:
                        # Clean up and reject (with block handles f.close())
                        try:
                            os.unlink(tmp_path)
                        except OSError:
                            pass
                        return JSONResponse(
                            status_code=413,
                            content=AnalysisResponse(
                                success=False,
                                error=f"File too large. Maximum upload size is {MAX_UPLOAD_SIZE // (1024 * 1024)} MB.",
                            ).model_dump(),
                        )
                    f.write(chunk)
        except OSError as exc:
            # Delete the partial file and return a 500 error
            logger.error("I/O error writing uploaded file: %s", exc)
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            return JSONResponse(
                status_code=500,
                content=AnalysisResponse(
                    success=False,
                    error="Failed to save uploaded file due to a server I/O error.",
                ).model_dump(),
            )

        if total_size == 0:
            return JSONResponse(
                status_code=400,
                content=AnalysisResponse(
                    success=False,
                    error="Empty video file",
                ).model_dump(),
            )

        # Run synchronous processing in a thread pool to avoid blocking the event loop
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            functools.partial(_process_video_sync, tmp_path, config),
        )

        # Handle error results from the sync processor
        if "error" in result:
            status = result.get("status", 500)
            return JSONResponse(
                status_code=status,
                content=AnalysisResponse(
                    success=False,
                    error=result["error"],
                ).model_dump(),
            )

        # Success
        analysis_result = result["analysis"]
        report_text = ""
        if analysis_result is not None:
            report_text = getattr(analysis_result, "report_text", "")
        return JSONResponse(
            content=AnalysisResponse(
                success=True,
                analysis=analysis_result,
                annotated_video_url=result.get("annotated_video_url"),
                report_text=report_text,
            ).model_dump(),
        )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Analysis failed")
        return JSONResponse(
            status_code=500,
            content=AnalysisResponse(
                success=False,
                error="An unexpected error occurred during analysis.",
            ).model_dump(),
        )
    finally:
        # Clean up temp file
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
