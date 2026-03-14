"""Pydantic models and enums for squat form analysis."""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class SquatType(str, Enum):
    BODYWEIGHT = "bodyweight"
    HIGH_BAR = "high_bar"
    LOW_BAR = "low_bar"
    FRONT = "front"
    GOBLET = "goblet"
    OVERHEAD = "overhead"


class ExperienceLevel(str, Enum):
    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"


class CameraView(str, Enum):
    SIDE = "side"
    FRONT = "front"


class SquatPhase(str, Enum):
    STANDING = "standing"
    DESCENDING = "descending"
    BOTTOM = "bottom"
    ASCENDING = "ascending"


class IssueSeverity(str, Enum):
    HIGH = "high"
    MODERATE = "moderate"
    LOW = "low"


class Point(BaseModel):
    x: float
    y: float
    z: float = 0.0
    visibility: float = 1.0


class FrameAngles(BaseModel):
    knee_angle: float
    hip_angle: float
    ankle_angle: float
    trunk_angle: float
    shin_angle: float
    knee_width_ratio: Optional[float] = None
    hip_symmetry: Optional[float] = None


class FormIssue(BaseModel):
    name: str
    severity: IssueSeverity
    description: str
    value: float
    threshold: float
    phase: SquatPhase
    frame: int


class CoachingCue(BaseModel):
    issue: str
    cue: str
    priority: int
    explanation: str


class SquatConfig(BaseModel):
    squat_type: SquatType = SquatType.BODYWEIGHT
    experience_level: ExperienceLevel = ExperienceLevel.BEGINNER
    camera_view: CameraView = CameraView.SIDE
    target_depth: Optional[float] = None
    competition_mode: bool = False  # IPF/USAPL competition rules


class CalibrationData(BaseModel):
    standing_knee_angle: float
    standing_hip_angle: float
    standing_trunk_angle: float
    standing_ankle_angle: float
    femur_length: float
    tibia_length: float
    torso_length: float
    femur_tibia_ratio: float
    torso_femur_ratio: float
    standing_knee_width: Optional[float] = None


class StickingPoint(BaseModel):
    frame: int
    knee_angle: float
    hip_angle: float
    depth_percentage: float  # 0=bottom, 100=standing
    velocity_drop: float     # How much velocity decreased
    description: str         # e.g. "Sticking point at 45% depth (just above parallel)"


class BarPathData(BaseModel):
    frames: list[int] = Field(default_factory=list)
    x_positions: list[float] = Field(default_factory=list)  # Horizontal position per frame
    y_positions: list[float] = Field(default_factory=list)  # Vertical position per frame
    lateral_drift: float = 0.0      # Max horizontal deviation from start
    vertical_range: float = 0.0     # Total vertical travel
    path_efficiency: float = 1.0    # Straight line / actual path length (1.0 = perfect)
    description: str = ""           # e.g. "Bar drifts forward 2cm at the bottom"


class VelocityMetrics(BaseModel):
    peak_descent_velocity: float = 0.0   # degrees per second (knee angle change rate)
    peak_ascent_velocity: float = 0.0
    mean_descent_velocity: float = 0.0
    mean_ascent_velocity: float = 0.0
    ascent_to_descent_ratio: float = 1.0  # > 1 means faster up than down (explosive)
    description: str = ""


class RepData(BaseModel):
    rep_number: int
    start_frame: int
    end_frame: int
    bottom_frame: int
    min_knee_angle: float
    min_hip_angle: float
    max_trunk_angle: float
    descent_duration: float
    bottom_duration: float
    ascent_duration: float
    frame_angles: list[FrameAngles]
    heel_rise: bool = False
    butt_wink: bool = False
    good_morning: bool = False
    knee_valgus: bool = False
    trunk_angle_change_on_ascent: float = 0.0
    pelvic_tilt_at_bottom: float = 0.0
    competition_depth_pass: Optional[bool] = None
    competition_depth_margin: Optional[float] = None
    sticking_points: list[StickingPoint] = Field(default_factory=list)
    bar_path: Optional[BarPathData] = None
    velocity: Optional[VelocityMetrics] = None


class RepScore(BaseModel):
    depth_score: float = Field(ge=0, le=100)
    knee_tracking_score: float = Field(ge=0, le=100)
    trunk_score: float = Field(ge=0, le=100)
    symmetry_score: float = Field(ge=0, le=100)
    tempo_score: float = Field(ge=0, le=100)
    lockout_score: float = Field(ge=0, le=100)
    overall_score: float = Field(ge=0, le=100)
    grade: str
    issues: list[FormIssue] = Field(default_factory=list)
    cues: list[CoachingCue] = Field(default_factory=list)
    positive_feedback: list[str] = Field(default_factory=list)


class MobilityFindingModel(BaseModel):
    """Pydantic model for mobility finding (serializable version)."""
    area: str = ""
    limitation: str = ""
    test: str = ""
    stretches: list[str] = Field(default_factory=list)
    frequency: str = ""


class WarmUpStepModel(BaseModel):
    """Pydantic model for warm-up step (serializable version)."""
    name: str = ""
    description: str = ""
    duration: str = ""
    purpose: str = ""


class SetAnalysis(BaseModel):
    rep_count: int
    reps: list[RepScore]
    overall_score: float
    grade: str
    fatigue_detected: bool
    top_issues: list[FormIssue]
    top_cues: list[CoachingCue]
    calibration: Optional[CalibrationData] = None
    config: SquatConfig
    side_view_warning: Optional[str] = None
    positive_highlights: list[str] = Field(default_factory=list)
    mobility_findings: list[MobilityFindingModel] = Field(default_factory=list)
    warmup_protocol: list[WarmUpStepModel] = Field(default_factory=list)
    report_text: str = ""


class AnalysisRequest(BaseModel):
    squat_type: SquatType = SquatType.BODYWEIGHT
    experience_level: ExperienceLevel = ExperienceLevel.BEGINNER
    camera_view: CameraView = CameraView.SIDE


class AnalysisResponse(BaseModel):
    success: bool
    analysis: Optional[SetAnalysis] = None
    annotated_video_url: Optional[str] = None
    error: Optional[str] = None
    report_text: str = ""
