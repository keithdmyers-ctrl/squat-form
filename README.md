# Squat Form Analyzer

AI-powered squat form analysis using computer vision. Get instant, personalized coaching feedback on your squat technique.

## Features

- **Multi-exercise support** (frontend): Squats (bodyweight, high bar, low bar, front, goblet, overhead), deadlifts (conventional, sumo, Romanian), and bench press (flat, close-grip, wide-grip) — each scored to type-specific standards. The backend API currently supports squats only.
- **Anatomy-aware**: Calibrates to your body proportions (femur/tibia ratio) for personalized thresholds
- **19 form checks across exercises**: Squats (10: depth, knee tracking, trunk angle, butt wink, heel rise, good-morning, tempo, lockout, symmetry, forward knee travel), deadlifts (6: rounded back, hip shoot, hitching, insufficient ROM, asymmetric pull, fast descent), bench press (3: no pause, uneven press, press stall)
- **Severity-adaptive coaching**: Mild, moderate, and urgent feedback tailored to issue severity
- **Progress-aware coaching**: Session history comparison and recurring issue tracking
- **Per-rep narrative**: Best rep identification and fatigue detection across sets
- **Coaching cues**: Plain-English feedback with root-cause explanations and corrective exercises
- **Competition mode**: IPF/USAPL depth rules, sticking point detection, bar path analysis, velocity metrics
- **Mobility assessment**: Self-tests and stretches for detected limitations
- **Progress tracking**: Session history with trend charts and milestone detection
- **Privacy-first**: Browser-based analysis — your video never leaves your device

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
├── tests/             # 778 tests (518 frontend + 260 backend)
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
