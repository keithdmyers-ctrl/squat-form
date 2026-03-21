# Squat Form Analyzer

## Overview
AI-powered multi-exercise form analysis using MediaPipe BlazePose. Browser-based (privacy-first — video never leaves device). Supports 6 exercises with real-time coaching, goal tracking, and competition mode.

## Common Commands

```bash
# Frontend (TypeScript)
cd frontend && npx vite dev          # Dev server
cd frontend && npx vite build        # Production build
cd frontend && npx tsc --noEmit      # Type check
cd frontend && npx vitest run        # Run tests (1973+)

# iOS (Capacitor)
cd frontend && npm run ios:build    # Build web + sync to iOS
cd frontend && npm run ios:open     # Open Xcode project
cd frontend && npm run ios:run      # Build + sync + run on device/sim

# Backend (Python)
cd tests && python -m pytest -v      # Run all tests (260+)
cd tests && python -m pytest -k "test_name" -v  # Single test

# Full validation
cd frontend && npx tsc --noEmit && npx vitest run && cd ../tests && python -m pytest -v
```

## Architecture

### Frontend (`frontend/src/`)
- **main.ts** — UI integration hub, DOM event wiring, keyboard shortcuts
- **analyzer.ts** — Squat analysis orchestrator
- **exercises/** — Exercise-specific analyzers:
  - **index.ts** — Exercise router/dispatcher (6 exercises)
  - **deadlift.ts** — Hip-angle driven deadlift analysis
  - **bench.ts** — Elbow-angle driven bench press analysis
  - **overhead-press.ts** — Shoulder-angle driven OHP analysis
  - **barbell-row.ts** — Elbow/hip-angle driven row analysis
  - **lunge.ts** — Knee-angle driven lunge analysis
- **angles.ts** — Joint angle computation (knee, hip, trunk, elbow, shoulder)
- **phases.ts** — Squat phase detection (knee-angle state machine)
- **scorer.ts** — 6-dimension weighted scoring (depth 25%, knee 20%, trunk 20%, symmetry 10%, tempo 10%, lockout 15%)
- **issues.ts** — Form issue detection (35+ checks across exercises, including lateral shift, cervical hyperextension, bracing reminder)
- **cues.ts** — Coaching cues, corrective exercises with YouTube links, progressions
- **calibration.ts** — Body proportion calibration (femur/tibia ratio)
- **competition.ts** — IPF/USAPL rules, sticking points, RPE/RIR, attempt planning, comp total tracking, competition commands reference
- **mobility.ts** — Mobility assessment and warmup recommendations
- **smoothing.ts** — One Euro Filter for temporal pose smoothing
- **pose.ts** — MediaPipe Web integration (WASM)
- **live.ts** — LiveAnalyzer with LiveExerciseStrategy interface (all exercises)
- **live-mode.ts** — Live webcam UI
- **live-deadlift.ts** / **live-bench.ts** — Live mode exercise strategies
- **one-rm.ts** — 1RM estimation (Epley/Brzycki), DOTS/Wilks-2/GL Points relative strength scoring, 1RM safety checks
- **exercise-core.ts** — Shared analysis utilities (fatigue, issue aggregation, dimension labels)
- **goals.ts** — Goal-setting and progress tracking (3 consecutive hits to achieve)
- **programming.ts** — Periodized training recommendations (hypertrophy/strength/peaking/deload)
- **workout-programs.ts** — 23 powerlifting program definitions (SS, GZCLP, 5/3/1, Texas Method, HLM, BBB, FSL, J&T2, nSuns, Block, DUP, Conjugate, Sheiko #29/#31, Candito 6-Week, Calgary Barbell 16/8-Week, SBS Hypertrophy/Strength, PPL), 26 exercise slots with equipment adaptations, program recommendation engine
- **program-generator.ts** — LP tracking with stall detection, workout generation, autoregulation (RPE + form score), transition recommendations (novice→intermediate→advanced), accessory recommendations from weak points, 5/3/1 percentage engine
- **ui-workout.ts** — Training Program tab UI: setup wizard, program recommendations, daily workout display, set logging, completion flow, transition cards (lazy-loaded)
- **rest-timer.ts** — Between-set rest timer with countdown, audio beep, vibration, +30s/-30s adjust
- **pr-tracker.ts** — Personal record detection (weight PR, e1RM PR, rep PR, form score PR)
- **plate-calculator.ts** — Plate loading calculator (lbs and kg standard plate sizes)
- **workout-calendar.ts** — Monthly training calendar grid with streak and consistency tracking
- **volume-tracker.ts** — Muscle group volume tracking with MEV/MAV/MRV zones (Israetel/Schoenfeld)
- **warmup-timer.ts** — Guided warmup timer engine
- **multi-angle.ts** — Multi-camera video merge (side + front)
- **snapshot.ts** — Video frame capture at key positions
- **gif-export.ts** — Per-rep clip export via MediaRecorder
- **rpe-calculator.ts** — RPE-based e1RM calculation, weight-for-target, prescription tables
- **custom-program.ts** — User-defined program text parsing and custom program builder
- **adaptation-engine.ts** — Multi-signal training adaptation (form, RPE, readiness, fatigue, injury)
- **body-tracker.ts** — Body measurements and composition tracking
- **safety-screening.ts** — PAR-Q+ pre-participation screening, pre-existing conditions, post-set pain prompts
- **strength-standards.ts** — Bodyweight-relative strength classifications (untrained→elite) for SBD+OHP
- **ui-glossary.ts** — Browsable glossary modal with 50+ terms, search, category tabs
- **phase-detector.ts** — Generic parameterized phase detector (eliminates duplication across exercise files)
- **storage-migration.ts** — Shared localStorage versioning and migration utilities
- **ml-personalization.ts** — On-device ML personalization (response curves, volume sensitivity, progression rate, smart transitions)
- **bluetooth-vbt.ts** — Web Bluetooth VBT integration (RepOne, GymAware, OpenBarbell), velocity zones, 1RM from load-velocity
- **health-sync.ts** — Apple Health / Google Fit sync via Capacitor (bodyweight, sleep, workout export)
- **rankings.ts** — Population percentile rankings by IPF weight class, competition history tracking
- **video-annotation.ts** — Canvas annotation tools (pen, line, arrow, angle measurement, text), side-by-side comparison, frame navigation
- **muscle-map.ts** — SVG anatomical muscle map (front/back views, 13 muscle groups, volume zone coloring, interactive tooltips)
- **bar-path.ts** — Barbell path tracking and visualization (SVG overlay, path shape classification, efficiency scoring)
- **warmup-calculator.ts** — Auto-generate warm-up ramp (bar→40%→60%→75%→85%→90%) with plate loading
- **data-backup.ts** — Full app state export/import as JSON file (21 localStorage keys)
- **progression-charts.ts** — SVG line charts for e1RM, volume, bodyweight trends over time
- **workout-flexibility.ts** — Mid-workout exercise reorder, skip, add, substitute
- **form-programming-bridge.ts** — Form weakness analysis → accessory exercise recommendations
- **meet-day.ts** — Meet-day mode with live attempt tracking, warm-up timer, checklist
- **data-import.ts** — CSV import from Strong, Hevy, and generic formats with exercise name mapping
- **ui-workout-setup.ts** — Program setup wizard (extracted from ui-workout.ts)
- **ui-workout-session.ts** — Daily workout display and set logging (extracted)
- **ui-workout-analytics.ts** — Calendar, volume, progression analytics (extracted)
- **ui-workout-completion.ts** — Post-workout feedback and completion flow (extracted)
- **exercise-demos.ts** — Exercise demonstration content and video references
- **form-bridge.ts** — Bridge between form analysis scores and workout autoregulation
- **progression-engine.ts** — Progression logic (linear, percentage wave, RPE-based, AMRAP-driven)
- **workout-storage.ts** — Workout log persistence layer
- **ai-coach.ts** — AI coaching engine (offline heuristics + optional Claude API integration)
- **ui-coach.ts** — AI Coach chat UI (lazy-loaded)
- **backend-service.ts** — Optional backend API client
- **settings.ts** — User settings persistence (experience, units, theme)
- **upload-mode.ts** — Video upload mode UI and file handling
- **native.ts** — Capacitor native platform integration (haptics, status bar)
- **ui-progress.ts** — Analysis progress bar and validation warnings
- **ui-skeleton.ts** — Skeleton loading states
- **ui-video-overlay.ts** — Video overlay rendering
- **ui-training.ts** — Training recommendations UI
- **ui-coaching.ts** — Coaching cues display
- **ui-warmup-mobility.ts** — Warmup and mobility overlay UI
- **meet-prep.ts** / **meet-prep-plan.ts** — Competition meet preparation and attempt planning
- **video-export.ts** — Video export utilities
- **csv-export.ts** / **share.ts** — Data export (CSV, shareable links)
- **ui.ts** / **ui-comparison.ts** / **ui-results.ts** / **ui-history.ts** — Results, comparison, history

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
- Exercise routing via `exercises/index.ts` dispatcher (6 exercises, 20+ variants)
- Phase detection: knee-angle (squat/lunge), hip-angle (deadlift/row), elbow-angle (bench), shoulder-angle (OHP)
- LiveExerciseStrategy interface for exercise-agnostic live mode
- Severity-adaptive coaching: mild/moderate/urgent, with beginner-friendly labels
- One Euro Filter for temporal smoothing of noisy pose landmarks
- Competition depth gate: high squats capped at 40/100 with "No Lift" grade
- Tiered results display: beginner (summary), intermediate (collapsed detail), advanced (expanded)
- CSS design system: 9 font tokens, 5 spacing tokens, dark/light themes, 100+ component classes
- Progressive disclosure: settings hidden for beginners, expanded for advanced
- Backend supports squats only; multi-exercise analysis is frontend-only

## After Changes
- Type check with `npx tsc --noEmit`
- Run both frontend (1973+) and backend (260) tests
- Test all exercises (squat, deadlift, bench, OHP, row, lunge) — not just the one changed
- Verify live mode still works if pose/phase code was touched
- Check mobile responsiveness for any UI changes
- Production build: `cd frontend && npx vite build`
- Scorer test expectations are current — previously noted mismatches have been resolved
