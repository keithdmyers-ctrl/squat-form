# Changelog

All notable changes to the Squat Form Analyzer are documented here.

## [1.1.0] - 2026-03-08

### Added
- Multi-exercise support: deadlift analyzer (conventional, sumo, Romanian) and bench press analyzer (flat, close-grip, wide-grip)
- Exercise router for automatic exercise type dispatching
- Deadlift form checks: rounded back, hip shoot, hitching, insufficient ROM, asymmetric pull, fast descent
- Bench press form checks: no pause, uneven press, press stall
- Severity-adaptive coaching cues (mild/moderate/urgent feedback per issue)
- Alternate cue phrasings for variety in coaching feedback
- Per-rep narrative with best rep identification and fatigue detection
- Progress-aware coaching: session history comparison, recurring issue tracking
- Video timestamp links in coaching feedback (click to seek to relevant frame)
- Camera view confidence notes on score breakdown
- 404 new frontend tests (deadlift, bench, thresholds, mobility, fuzz, integration, competition, live mode)
- Corrective exercises and progressions for all deadlift and bench press issues
- Specific positive feedback with numerical scores per dimension
- Real-time live webcam analysis mode with audio coaching cues
- Dynamic weight redistribution when frontal knee data is unavailable
- Standing posture validation in calibration (knee angle > 150°)
- Exercise progressions for good_morning, bouncing, fast_descent, asymmetric_shift
- First-timer contextual messaging ("Most people score 50-70 on their first try")
- "How does this work?" re-show onboarding button
- Video upload guidance (duration, orientation, tips)
- Screen reader result announcements (aria-live)
- Severity text labels (H/M/L) alongside color indicators
- Contextual error card actions per error type
- LocalStorage quota warning
- Configurable CORS origins via environment variable
- Temporal landmark smoothing (One Euro Filter, replaces EMA) for landmark positions in live mode
- Binary search optimization for video frame lookup
- Competition depth check validates both sides
- Video duration validation (max 5 minutes)
- Architecture diagram in README
- ResizeObserver-based canvas sizing in live mode (replaces per-frame getBoundingClientRect)
- Rolling average FPS tracking for accurate live mode tempo scoring
- Competition mode support in live mode scoreRep()

### Changed
- Beginner depth threshold: 110° → 100° (parallel required)
- Competition hip crease offset: 5% → 10% of femur length
- Forward knee travel detection restricted to low-bar squats only (threshold 45°)
- Good morning cue: "Drive your back into the bar" → "Push through your legs while keeping your chest up"
- Score colors: low scores use neutral slate instead of red
- Grade D: "Needs work" → "Getting there — the exercises below will help"
- Fatigue warning reframed with positive language
- Issue descriptions use plain English instead of angle measurements
- Valgus detection uses experience-tiered thresholds consistently
- Backend trunk angle adjustment clamped to [-20, +25] degrees
- Frontend analyzer.ts decomposed into 6 focused modules
- Headline changed to value proposition: "Get Better at Squats"
- Competition mode only shown for advanced experience level
- `asyncio.get_event_loop()` replaced with `asyncio.get_running_loop()`
- `getPositiveFeedback` refactored from 6 positional parameters to a single scores object
- Backend angle computation uses manual math instead of numpy for 3D vectors
- Backend `_pt` helper renamed to `pt` and exported from angles.py for reuse
- `pickBetterSide` removed from calibration.ts (uses shared `pickSide` from angles.ts)
- Calibration segment lengths normalized to total leg length (frontend parity with backend)
- 3D angle computation upgraded from 2D in both frontend and backend stacks
- Frontend valgus MODERATE threshold synced with backend (0.08 → 0.05)
- Ankle angle default changed from 0 to 90 in frontend (matching backend)
- Backend model_complexity upgraded from 1 to 2 (full BlazePose model)

### Fixed
- Side-view videos no longer silently lose ~7.5 points on knee tracking
- Frontend/backend asymmetry threshold synced (was 0.15 vs 0.05)
- Frontend missing bouncing detection added
- Event listeners no longer accumulate on repeated analyses
- requestAnimationFrame leak on re-analysis
- computeFrameAngles crash on missing landmarks
- File upload double-close in backend
- Backend/frontend good_morning description divergence
- Error card "Adjust Settings" shown for irrelevant error types
- README API routes corrected to /api/v1/ prefix
- PROJECT_PLAN scoring weights updated to match code
- showError in live mode onError callback changed to showErrorCard for consistent error UX
- Frontend/backend competition lockout algorithm synced (diff-from-standing)
- Frontend positive feedback logic synced with backend (score-based checks)

### Security
- CORS origins configurable via CORS_ORIGINS environment variable
- crypto.randomUUID() fallback for non-HTTPS contexts

## [1.0.0] - 2026-03-08

### Added
- Initial release with video upload analysis
- 10 form checks: depth, knee valgus, butt wink, good morning, heel rise, forward lean, tempo, bouncing, asymmetry, forward knee travel
- 6 scoring dimensions: depth (25%), knee tracking (20%), trunk (20%), symmetry (10%), tempo (10%), lockout (15%)
- Body proportion calibration from standing frame
- Competition mode with IPF/USAPL rules
- Sticking point detection, bar path analysis, velocity metrics
- Mobility assessment with self-tests and stretches
- Personalized warm-up protocol generation
- Exercise progressions (3-level paths)
- Session history with trend tracking
- Print/copy report functionality
- Dual-stack: Python FastAPI backend + TypeScript Vite frontend
- 260 tests across standard, edge-case, and integration categories
- Dark theme with accessibility features (ARIA, keyboard nav, reduced motion)
