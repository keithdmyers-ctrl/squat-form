# Squat Form Analyzer

## Overview
AI-powered multi-exercise form analysis using MediaPipe BlazePose. Browser-based (privacy-first — video never leaves device). Supports squat, deadlift, and bench press with real-time coaching.

## Common Commands

```bash
# Frontend (TypeScript)
cd frontend && npx vite dev          # Dev server
cd frontend && npx vite build        # Production build
cd frontend && npx tsc --noEmit      # Type check
cd frontend && npx vitest run        # Run tests

# Backend (Python)
cd tests && python -m pytest -v      # Run all tests (260+)
cd tests && python -m pytest -k "test_name" -v  # Single test

# Full validation
cd frontend && npx tsc --noEmit && npx vitest run && cd ../tests && python -m pytest -v
```

## Architecture

### Frontend (`frontend/src/`)
- **main.ts** — UI integration hub, DOM event wiring
- **analyzer.ts** — Squat analysis orchestrator
- **exercises/** — Exercise-specific analyzers (deadlift.ts, bench.ts, index.ts router)
- **angles.ts** — Joint angle computation (knee, hip, trunk, elbow, shoulder)
- **phases.ts** — Squat phase detection (knee-angle state machine)
- **scorer.ts** — 6-dimension weighted scoring (depth 25%, knee 20%, trunk 20%, symmetry 10%, tempo 10%, lockout 15%)
- **issues.ts** — Form issue detection (19 checks across exercises)
- **cues.ts** — Coaching cues and corrective exercises
- **calibration.ts** — Body proportion calibration (femur/tibia ratio)
- **competition.ts** — IPF/USAPL rules, sticking point detection, RPE/RIR estimation, downward motion detection
- **mobility.ts** — Mobility assessment and warmup recommendations
- **smoothing.ts** — One Euro Filter for temporal pose smoothing
- **pose.ts** — MediaPipe Web integration (WASM)
- **live.ts** / **live-mode.ts** — Real-time webcam analysis (squat only)
- **one-rm.ts** — 1RM estimation (Epley/Brzycki), DOTS relative strength scoring
- **exercise-core.ts** — Shared analysis utilities (fatigue detection, issue aggregation, score dimension labels)
- **csv-export.ts** / **share.ts** — Data export (CSV with raw angles, JSON), shareable links
- **ui.ts** / **ui-comparison.ts** / **ui-results.ts** / **ui-history.ts** — Results display, session comparison, history

### Backend (`backend/squat_form/`)
- **analyzer.py** — Analysis pipeline
- **scorer.py** — Scoring engine
- **phases.py** — Phase detection
- **angles.py** — Joint angle math
- **calibration.py** — Body proportion calibration
- **feedback.py** — Coaching cues
- **mobility.py** — Mobility assessment
- **annotator.py** — Skeleton overlay rendering
- **pose.py** — MediaPipe integration
- **video.py** — OpenCV video I/O
- **schemas.py** — Pydantic models

## Key Patterns
- Dual MediaPipe models: Full (video upload, higher accuracy), Lite (live webcam, faster)
- Exercise routing via `exercises/index.ts` dispatcher
- Phase detection: knee-angle driven (squat), hip-angle driven (deadlift), elbow-angle driven (bench)
- Severity-adaptive coaching: mild → moderate → urgent, with scientific citations (stripped for beginners)
- One Euro Filter for temporal smoothing of noisy pose landmarks
- Competition depth gate: high squats capped at 40/100 with "No Lift" grade in competition mode
- Shared analysis utilities in exercise-core.ts used by deadlift.ts and bench.ts
- Backend supports squats only; multi-exercise analysis is frontend-only

## After Changes
- Type check with `npx tsc --noEmit`
- Run both frontend and backend tests
- Test all exercises (squat, deadlift, bench) — not just the one changed
- Verify live mode still works if pose/phase code was touched
- Check mobile responsiveness for any UI changes
- 23 known test expectation mismatches in scorer.test.ts — these are NOT code bugs
