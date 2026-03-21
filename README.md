# Lift Coach — AI Powerlifting Coach

AI-powered multi-exercise form analysis and adaptive training programming. Computer vision form checks, 23 evidence-based programs, and in-workout tracking — all in your browser. Privacy-first: video never leaves your device.

## Features

### Form Analysis (6 Exercises)
- **Squat** (bodyweight, high bar, low bar, front, goblet, overhead), **Deadlift** (conventional, sumo, Romanian), **Bench Press** (flat, close-grip, wide-grip), **Overhead Press**, **Barbell Row**, **Lunge** — each scored to exercise- and variant-specific standards
- **35+ form checks** including depth, knee valgus, trunk angle, butt wink, heel rise, good-morning pattern, bench pause detection, lateral trunk shift, bracing reminder, cervical hyperextension
- **Severity-adaptive coaching**: Mild, moderate, and urgent feedback with beginner-friendly language
- **Anatomy-aware calibration**: Adjusts thresholds for your body proportions (femur/tibia ratio)
- **Competition mode**: IPF/USAPL rules, bench pause gate, sticking point detection, attempt planning

### Training Programming (23 Programs)
- **Beginner**: Starting Strength (5-phase), GZCLP (with auto stage cycling)
- **Intermediate**: 5/3/1 (Beginner, BBB, FSL), Texas Method, HLM, Candito 6-Week, SBS Hypertrophy/Strength, PPL, nSuns, J&T 2.0, DUP, Upper/Lower, Block Periodization, Powerbuilding
- **Advanced**: Sheiko #29/#31, Calgary Barbell 16/8-Week, Conjugate
- **Auto-progression**: LP tracking, stall detection, deload scheduling, program transition recommendations
- **Autoregulation**: RPE + form score integration, readiness-based adjustments, injury tracking with return-to-training protocols

### Safety & Health
- **PAR-Q+ health screening** (12 questions, ACSM-compliant, annual re-screening)
- **Pre-existing condition management** (6+ conditions with per-exercise modifications)
- **Pregnancy mode** (ACOG 2020 guidelines, modified depth/intensity/exercise substitutions)
- **Weight safety caps** (world-record-based ceilings, bodyweight-relative sanity checks)
- **Post-set pain prompts** with red flag detection (numbness, radiating pain → stop recommendation)
- **Form-score weight suggestions** (recommendations, not auto-applied — user must confirm)

### Competition & Strength
- **DOTS, Wilks-2, and IPF GL Points** calculators
- **Strength standards** (Untrained → Elite, 4 lifts × 2 sexes)
- **Competition total tracking** (S+B+D with all scoring systems)
- **IPF/USAPL commands reference** (all 3 lifts)
- **Meet preparation** with attempt selection and meet-day adrenaline factor

### Coaching & Education
- **AI Coach** (offline heuristic + optional Claude API, integrates form data)
- **59-term glossary** across 5 categories (Training, Programming, Anatomy, Competition, Nutrition)
- **Exercise demos** with step-by-step instructions, common mistakes, YouTube links
- **Volume tracking** with MEV/MAV/MRV zones, mesocycle progression, frequency analysis
- **Individualized volume landmarks** (adjusted by training age, recovery, age, sex)

### Platform
- **Privacy-first**: Browser-based — video never leaves your device
- **Offline-capable**: All features work without internet
- **iOS app**: Available via Capacitor (native haptics, status bar integration)
- **Progressive disclosure**: Beginners see simplified UI; complexity reveals with experience

## Quick Start

### Option 1: Browser App (recommended, no server needed)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

> **Note:** The browser app performs ALL analysis client-side using MediaPipe Web. Your video never leaves your device and no backend server is required.

### Option 2: Backend API (server-side analysis with annotated video)

> **Note:** The backend is a standalone server-side analysis option. It uses MediaPipe + OpenCV on the server to process uploaded videos and return annotated results. It does not communicate with the frontend app.

```bash
cd backend
pip install -r requirements.txt
python app.py
```

Open http://localhost:8000 in your browser, or use the API at `POST /api/v1/analyze`.

> **CORS:** Set the `CORS_ORIGINS` environment variable to restrict allowed origins in production (comma-separated, e.g. `CORS_ORIGINS=https://example.com`). Defaults to `*` (all origins).

### Running Tests

```bash
pip install -r backend/requirements.txt
pip install pytest httpx
pytest tests/ -v
```

## Project Structure

```
squat-form/
├── frontend/          # Browser-based client-side analysis
│   ├── src/
│   │   ├── analyzer.ts    # Form analysis orchestrator
│   │   ├── angles.ts      # Joint angle computation
│   │   ├── calibration.ts # Body proportion calibration
│   │   ├── competition.ts # Competition mode (IPF/USAPL rules)
│   │   ├── cues.ts        # Coaching cues and corrective exercises
│   │   ├── issues.ts      # Form issue detection
│   │   ├── exercises/     # Exercise-specific analyzers (deadlift, bench)
│   │   ├── live.ts        # Live webcam analysis mode
│   │   ├── live-mode.ts   # Live mode utilities and state management
│   │   ├── main.ts        # App entry point, session persistence
│   │   ├── mobility.ts    # Mobility assessment and warmup
│   │   ├── phases.ts      # Squat phase detection (state machine)
│   │   ├── pose.ts        # MediaPipe Web integration
│   │   ├── scorer.ts      # 6-dimension weighted scoring (standard + competition)
│   │   ├── smoothing.ts   # One Euro Filter temporal smoothing
│   │   ├── types.ts       # TypeScript type definitions
│   │   └── ui.ts          # Results display, charts, accessibility
│   └── index.html         # Single-page app with dark theme UI
│
├── backend/           # Server-side video upload analysis
│   ├── squat_form/
│   │   ├── __init__.py    # Package init
│   │   ├── analyzer.py    # Main analysis pipeline
│   │   ├── angles.py      # Joint angle math
│   │   ├── annotator.py   # Skeleton overlay rendering
│   │   ├── calibration.py # Body proportion calibration
│   │   ├── feedback.py    # Coaching cues and exercise progressions
│   │   ├── mobility.py    # Mobility assessment and warmup
│   │   ├── phases.py      # Phase detection state machine
│   │   ├── pose.py        # MediaPipe pose extraction
│   │   ├── schemas.py     # Pydantic data models
│   │   ├── scorer.py      # 6-dimension weighted scoring
│   │   └── video.py       # Video I/O with OpenCV
│   ├── app.py             # FastAPI application
│   ├── static/            # Upload UI
│   └── requirements.txt
│
├── tests/             # 2102 tests (1842 frontend + 260 backend)
│   ├── standard/      # Unit tests for each module
│   ├── edge_cases/    # Boundary conditions and degenerate inputs
│   └── deep/          # Integration and pipeline tests
│
└── PROJECT_PLAN.md    # Detailed project plan and architecture
```

## Architecture

Both stacks implement identical analysis algorithms. The frontend processes video entirely in-browser using MediaPipe Web — your video never leaves your device. The backend provides a REST API for server-side processing.

### Frontend (Browser-based, no server required)

```
┌─────────────────────────────────────────────┐
│                  main.ts                     │
│        (Entry point, event wiring)          │
├─────────────┬───────────────────────────────┤
│   Upload    │        Live Mode              │
│   Mode      │     (live.ts + pose.ts)       │
├─────────────┴───────────────────────────────┤
│              analyzer.ts (orchestrator)      │
├──────┬──────┬──────┬──────┬──────┬──────────┤
│calib.│scorer│issues│ cues │mobil.│competition│
│ .ts  │ .ts  │ .ts  │ .ts  │ .ts  │   .ts    │
├──────┴──────┴──────┴──────┴──────┴──────────┤
│     angles.ts    │    phases.ts              │
├──────────────────┴──────────────────────────┤
│              types.ts                        │
├─────────────────────────────────────────────┤
│         MediaPipe Web (WASM)                │
└─────────────────────────────────────────────┘
```

### Backend (Server-side, for API integration)

```
┌──────────────────────────────────────┐
│            app.py (FastAPI)          │
├──────────────────────────────────────┤
│          analyzer.py                 │
├──────┬──────┬──────┬──────┬─────────┤
│scorer│calib.│feed- │mobil.│ phases  │
│ .py  │ .py  │back  │ .py  │  .py   │
│      │      │ .py  │      │        │
├──────┴──────┴──────┴──────┴─────────┤
│   angles.py  │  schemas.py          │
├──────────────┴──────────────────────┤
│    MediaPipe + OpenCV               │
└──────────────────────────────────────┘
```

## How It Works

1. **Pose estimation**: MediaPipe BlazePose extracts 33 body landmarks per frame
2. **Calibration**: Standing posture measurements personalize angle thresholds to your body
3. **Phase detection**: State machine identifies squat reps (standing → descent → bottom → ascent)
4. **Form analysis**: Each rep is checked against exercise-specific form checks (19 total across squats, deadlifts, and bench press)
5. **Scoring**: 6-dimension weighted score (depth 25%, knee tracking 20%, trunk 20%, symmetry 10%, tempo 10%, lockout 15%)
6. **Feedback**: Plain-English coaching cues with root-cause explanations and corrective exercises

### Signal Processing

- **One Euro Filter**: Adaptive temporal smoothing for landmark positions. Reduces jitter while preserving responsiveness during fast movements (frontend live mode).
- **3D angle computation**: Both stacks use full (x, y, z) coordinates from MediaPipe BlazePose for angle calculations, falling back gracefully to 2D when z-data is unavailable.
- **Rolling FPS tracking**: Live mode uses a rolling average of actual frame timestamps instead of a hardcoded frame rate, for accurate tempo scoring.

### Competition Mode Weights

When competition mode is enabled (IPF/USAPL rules), the scoring weights shift to prioritize depth and lockout:

| Dimension     | Standard | Competition |
|---------------|----------|-------------|
| Depth         | 25%      | 30%         |
| Knee Tracking | 20%      | 25%         |
| Trunk         | 20%      | 15%         |
| Symmetry      | 10%      | 10%         |
| Tempo         | 10%      | 0%          |
| Lockout       | 15%      | 20%         |

## Live Webcam Mode

The frontend includes a real-time live webcam analysis mode. Point your webcam at yourself, perform squats, and receive immediate feedback:

- **Auto-calibration**: Detects standing posture from the first few frames to personalize thresholds
- **Per-rep scoring**: Each rep is scored as it completes, with results shown in real time
- **Audio coaching cues**: Spoken feedback after each rep via the Web Speech API (one cue per rep to avoid overload)
- **Phase detection**: Visual indicator shows current squat phase (standing, descending, bottom, ascending)

Live mode runs entirely in the browser using MediaPipe Web -- no backend connection is needed.

- **ResizeObserver-based rendering**: Uses ResizeObserver instead of per-frame layout queries for smooth 60fps skeleton overlay rendering.
- **Adaptive frame rate**: Tracks actual processing FPS via rolling average for accurate tempo computation.

## Frontend-Only Mode

The frontend app performs all analysis client-side using MediaPipe Web (WASM). Your video never leaves your device and no backend server is required. This includes:

- Video file upload and analysis
- Live webcam analysis
- Scoring, coaching cues, and mobility assessments
- Session history (stored in localStorage)

The backend is a separate, standalone option for server-side processing via REST API. The frontend and backend do not communicate with each other.

## Rate Limiting

The backend API enforces rate limiting of **10 requests per minute per IP address** on the `/api/v1/analyze` endpoint. Exceeding the limit returns HTTP 429 with a descriptive error message.

## API

The backend serves auto-generated API docs at:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

### `POST /api/v1/analyze`
Upload a video file with form parameters:
- `file`: Video file (MP4, MOV, AVI, WebM, MKV; max 100MB)
- `squat_type`: bodyweight | high_bar | low_bar | front | goblet | overhead
- `experience_level`: beginner | intermediate | advanced
- `camera_view`: side | front
- `competition_mode`: true | false

#### Response Schema

```json
{
  "success": true,
  "analysis": {
    "rep_count": 5,
    "overall_score": 78.5,
    "grade": "C",
    "fatigue_detected": false,
    "reps": ["..."],
    "top_issues": ["..."],
    "top_cues": ["..."],
    "positive_highlights": ["..."],
    "mobility_findings": ["..."],
    "warmup_protocol": ["..."],
    "side_view_warning": "..."
  },
  "annotated_video_url": "/api/v1/annotated/...",
  "report_text": "..."
}
```

### `GET /api/v1/health`
Returns `{"status": "ok"}`

### `GET /api/v1/annotated/{filename}`
Returns the annotated video file generated by a previous analysis request. The URL is provided in the `annotated_video_url` field of the analysis response.

## License

MIT
