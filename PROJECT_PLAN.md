# Squat Form Analyzer - Project Plan

A camera-based tool that evaluates squat form using pose estimation and provides actionable coaching feedback. Phase 1 analyzes uploaded video; Phase 2 delivers real-time feedback.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [What Good Squat Form Looks Like](#what-good-squat-form-looks-like)
3. [Common Errors to Detect](#common-errors-to-detect)
4. [Computer Vision Approach](#computer-vision-approach)
5. [Scoring & Feedback System](#scoring--feedback-system)
6. [Phased Implementation Plan](#phased-implementation-plan)
7. [Tech Stack](#tech-stack)
8. [Competitive Landscape](#competitive-landscape)
9. [Differentiation Strategy](#differentiation-strategy)
10. [Safety & Legal](#safety--legal)

---

## Architecture Overview

```
Phase 1 (Video Upload):
  Phone/Web Camera --> Record Video --> Upload to Web App
    --> FastAPI Backend
    --> OpenCV (frame extraction)
    --> MediaPipe Pose (per-frame landmarks)
    --> Angle Calculator (hip, knee, ankle, trunk)
    --> Form Analyzer (rule-based thresholds + phase detection)
    --> Output: Annotated video + JSON analysis + summary report

Phase 2 (Real-Time):
  Phone Camera --> On-device MediaPipe --> Real-time angle computation
    --> Rule engine (same as Phase 1) --> Audio/visual/haptic feedback
    --> Post-set summary
```

---

## What Good Squat Form Looks Like

### Setup / Standing Position

| Checkpoint | Proper Form | Measurable Target |
|-----------|-------------|-------------------|
| Foot width | Shoulder-width or slightly wider (1.0-1.5x shoulder width) | Measure ankle-to-ankle vs shoulder-to-shoulder ratio |
| Toe angle | 15-45 degrees outward (varies by hip anatomy) | Foot index to heel vector angle |
| Weight distribution | Even across "tripod foot" (heel, ball of big toe, ball of little toe) | Heel remains on ground throughout |
| Head/neck | Neutral cervical spine, gaze forward and slightly up | Nose-to-shoulder angle relative to vertical |

### Descent Phase

| Checkpoint | Proper Form | Measurable Target |
|-----------|-------------|-------------------|
| Initiation | Hip hinge first (push hips back), then knees bend | Hip angle changes before knee angle |
| Knee tracking | Knees track over 2nd-3rd toe, in line with foot angle | Frontal view: knee midpoint stays lateral to ankle midpoint |
| Torso angle | Controlled forward lean appropriate to squat type | See type-specific angles below |
| Tempo | Controlled, 1.5-3.0 seconds | Track hip vertical velocity |

### Bottom Position

| Checkpoint | Proper Form | Measurable Target |
|-----------|-------------|-------------------|
| Depth | Hip crease at or below top of knee (parallel) | Knee flexion 100-155 deg depending on target |
| Spine | Neutral lumbar curve maintained (no rounding or excessive arch) | Lumbar angle change < 10-15 deg from standing |
| Pelvis | No posterior pelvic tilt (butt wink) | Pelvic rotation < 10 deg from neutral |
| Heels | Flat on ground | Heel landmark height stable |
| Pause | Brief controlled pause (0.2-1.0 sec) | Time at minimum hip height |

### Ascent Phase

| Checkpoint | Proper Form | Measurable Target |
|-----------|-------------|-------------------|
| Drive pattern | Hips and knees extend simultaneously | Hip-knee lag < 15 deg differential |
| Knee tracking | No valgus collapse (knees caving in) | Knee width ratio stays > 0.85 of standing width |
| Torso | Maintains angle, no "good morning" pattern | Torso angle doesn't increase > 15 deg from bottom |
| Lockout | Full hip extension at top | Hip angle returns to standing baseline |

### Type-Specific Torso Angles (from vertical)

| Squat Type | Expected Torso Angle | Notes |
|-----------|---------------------|-------|
| High bar back squat | 40-50 deg | Bar on upper traps |
| Low bar back squat | 50-65 deg | Bar on rear delts, more hip-dominant |
| Front squat / Goblet | 20-35 deg | Most upright |
| Bodyweight | 30-45 deg | Arms counterbalance |
| Overhead squat | 15-30 deg | Requires most upright torso |

### Body Proportion Adjustments

The "correct" torso angle depends on limb proportions:

| Proportion | Effect | Adjustment |
|-----------|--------|------------|
| Long femurs / short torso | More forward lean needed to keep COM over midfoot | Allow 10-20 deg more lean |
| Short femurs / long torso | Naturally upright | Expect minimal forward lean |
| Long tibias | More forward knee travel, more upright torso possible | Don't penalize knee-over-toe |
| Short tibias | Less knee travel, more hip-dominant | Will need more forward lean |

**Key insight:** Capture the user's standing proportions during calibration. Use the femur-to-tibia and torso-to-femur ratios to set personalized angle thresholds rather than one-size-fits-all numbers.

---

## Common Errors to Detect

### Tier 1: High Injury Risk (always flag)

**1. Knee Valgus (Medial Collapse)**
- Knees cave inward, especially during ascent
- Risk: ACL tear, meniscus damage, patellofemoral pain
- Detection: Front view -- knee midpoint moves medial to ankle midpoint
- Threshold: Knee width ratio < 0.85 of standing width
- Root causes: Weak glute medius, tight adductors, poor ankle mobility
- Cue: "Spread the floor with your feet" / "Knees out"

**2. Lower Back Rounding (Lumbar Flexion)**
- Loss of neutral spine under load
- Risk: Disc herniation, ligament damage
- Detection: Side view -- lumbar angle change > 15 deg from standing
- Cue: "Brace your core" / "Chest up"

**3. Butt Wink (Posterior Pelvic Tilt)**
- Pelvis tucks under at bottom of squat
- Risk: Disc herniation (amplified under load)
- Detection: Side view -- track pelvic rotation at bottom 20% of squat
- Threshold: > 10 deg posterior rotation from neutral
- Root causes: Limited hip flexion ROM, tight hamstrings, bony hip anatomy
- Cue: "Stop just above where your pelvis starts to tuck"

### Tier 2: Moderate Risk (flag with suggestion)

**4. Excessive Forward Lean / Good-Morning Squat**
- Torso pitches forward excessively; hips rise faster than shoulders on ascent
- Detection: Torso angle exceeds type-specific range by > 15 deg; hip-knee lag on ascent
- Cue: "Lead with your chest" / "Push through your quads"

**5. Heel Rise**
- Heels lift off ground during descent
- Detection: Heel landmark rises relative to toe landmark
- Root cause: Limited ankle dorsiflexion (needs 15-20 deg)
- Cue: "Sit back into your heels" / Consider heel-elevated shoes

**6. Asymmetric Shift**
- Weight shifts to one side
- Detection: Front view -- hip height difference > 3cm, lateral displacement
- Cue: "Even weight on both feet"

### Tier 3: Performance (suggest improvement)

**7. Insufficient Depth**
- Not reaching parallel (hip crease above knee)
- Detection: Knee flexion < 100 deg at bottom
- Cue: "Try to get a bit deeper -- aim for hip crease at knee level"

**8. Bouncing at Bottom**
- Uncontrolled reversal using momentum
- Detection: Time at bottom < 0.1 sec with rapid velocity change
- Cue: "Pause briefly at the bottom before driving up"

---

## Computer Vision Approach

### Framework: MediaPipe Pose (BlazePose)

**Why MediaPipe over alternatives:**
- 33 keypoints (most comprehensive lightweight model) -- includes heels and foot index
- Built-in z-coordinate for pseudo-3D analysis
- Cross-platform: Android, iOS, web (JS), Python
- Fastest mobile inference (~33ms per frame even on low-end hardware)
- Largest ecosystem of fitness analysis examples and research validation
- Accuracy: ~5-10 deg RMSE vs. gold-standard motion capture (r = 0.80-0.94 for sagittal angles)

**Alternatives considered:**
- MoveNet Lightning: Faster (<7ms) but only 17 keypoints (no feet)
- MoveNet Thunder: 17 keypoints, 20ms inference, slightly more accurate
- OpenPose: Most accurate but requires GPU, not mobile-viable
- YOLOv8-Pose: Better multi-person but 17 keypoints, less mobile-optimized
- Apple Vision: iOS only, 19 keypoints

### Key Landmarks (MediaPipe indices)

| Landmark | Index | Use |
|----------|-------|-----|
| Left/Right Shoulder | 11, 12 | Torso lean, bar position |
| Left/Right Hip | 23, 24 | Hip hinge, depth, symmetry |
| Left/Right Knee | 25, 26 | Knee tracking, valgus, depth |
| Left/Right Ankle | 27, 28 | Dorsiflexion, heel lift |
| Left/Right Heel | 29, 30 | Heel contact detection |
| Left/Right Foot Index | 31, 32 | Foot position, toe angle |
| Nose | 0 | Head/neck position |

### Joint Angle Calculation

```python
import math

def calculate_angle(a, b, c):
    """Angle at vertex b, given points a, b, c as (x, y, z) tuples."""
    bax, bay, baz = a[0] - b[0], a[1] - b[1], a[2] - b[2]
    bcx, bcy, bcz = c[0] - b[0], c[1] - b[1], c[2] - b[2]
    len_ba = math.sqrt(bax*bax + bay*bay + baz*baz)
    len_bc = math.sqrt(bcx*bcx + bcy*bcy + bcz*bcz)
    cos_angle = (bax*bcx + bay*bcy + baz*bcz) / (len_ba * len_bc)
    return math.degrees(math.acos(max(-1.0, min(1.0, cos_angle))))

# Primary angles
knee_angle = calculate_angle(hip, knee, ankle)        # Flexion at knee
hip_angle = calculate_angle(shoulder, hip, knee)       # Flexion at hip
ankle_angle = calculate_angle(knee, ankle, foot_index) # Dorsiflexion
trunk_angle = angle_from_vertical(shoulder, hip)       # Forward lean
```

### Camera View Requirements

**Side view (sagittal) -- primary:**
- Captures: depth, knee tracking, torso lean, butt wink, heel rise, bar path
- User positions phone 2-4m away at ~hip height, perpendicular to their side

**Front view (coronal) -- secondary:**
- Captures: knee valgus/varus, stance width, lateral shift, symmetry
- Phone 2-4m away, facing the user

**Phase 1:** Support single-view analysis (side view recommended). Phase 2: multi-view or guide user to do both.

### Squat Phase Detection

Use a state machine driven by knee angle:

```
STANDING  (knee angle > 160 deg)
    |  knee angle decreasing
    v
DESCENDING  (160 > knee angle > bottom threshold)
    |  knee angle stops decreasing
    v
BOTTOM  (minimum knee angle detected, velocity ~0)
    |  knee angle increasing
    v
ASCENDING  (knee angle increasing toward 160)
    |  knee angle > 160
    v
STANDING  (rep complete, increment counter)
```

Apply phase-specific checks:
- Descent: tempo, knee tracking, torso angle progression
- Bottom: depth, butt wink, heel contact, pause duration
- Ascent: good-morning check (hips rising faster than shoulders), knee valgus (worst here)
- Standing: full lockout, rep-to-rep consistency

### Technical Challenges & Mitigations

| Challenge | Mitigation |
|-----------|------------|
| Barbell occludes shoulders | Use visibility scores; fall back to hip-based trunk estimation |
| Poor gym lighting | Pre-analysis brightness check; recommend well-lit position |
| Wrong camera angle | Setup guide with silhouette overlay; warn if landmarks unreliable |
| 2D angle inaccuracy | Instruct perpendicular camera; use ratios not absolutes |
| Shaky camera | Recommend tripod/propping; apply landmark smoothing |
| Multiple people in frame | MediaPipe is single-person; warn if multiple detected |
| Fatigue-induced form changes | Compare early vs. late reps; flag degradation trend |

---

## Scoring & Feedback System

### Per-Rep Score (0-100)

| Dimension | Weight | Scoring |
|-----------|--------|---------|
| Depth | 25% | Full depth=100, parallel=80, above parallel=40-60 |
| Knee tracking | 20% | Aligned with toes=100, mild valgus=60, significant valgus=20 |
| Trunk angle | 20% | Within type-specific norm=100, penalize per degree over |
| Symmetry | 10% | L/R hip and knee angle match within 5 deg=100 |
| Tempo | 10% | 1.5-3s descent=100, too fast or jerky=lower |
| Lockout | 15% | Full extension=100 |

> **Note:** These are the default weights. When frontal camera data is unavailable, dynamic weight redistribution adjusts the weights automatically (e.g., symmetry weight is redistributed to the dimensions that can be measured from a side view).

**Set score** = average of per-rep scores, with a fatigue penalty if last 2 reps score > 15 points below first 2.

**Grade:** A (90-100), B (80-89), C (70-79), D (60-69), F (<60)

### Experience-Level Thresholds

| Mode | Depth Standard | Angle Tolerance | Valgus Sensitivity |
|------|---------------|-----------------|-------------------|
| Beginner | Accept above-parallel (knee flex 90-140 deg) | +15 deg from norms | Only flag major collapse |
| Intermediate | Parallel required (110-150 deg) | +10 deg from norms | Flag moderate collapse |
| Advanced | Below parallel (125+ deg) | +5 deg from norms | Flag any medial displacement |

### Feedback Delivery

**Phase 1 (Video Analysis):**
- Annotated video with color-coded skeleton overlay (green/yellow/red per joint)
- Angle measurements displayed at key frames
- Timeline scrubber with red markers at problematic frames
- Frame-by-frame navigation for key moments
- Per-rep summary cards with screenshots (bottom position, worst valgus, lockout)
- Overall report: set score, per-rep breakdown, top 1-3 issues with corrective cues
- Side-by-side comparison with previous sessions

**Phase 2 (Real-Time):**
- Audio cues between reps: one corrective cue per rep, prioritized by injury risk
  - Short phrases: "Knees out", "Deeper", "Chest up"
  - Positive confirmation: "Good rep" (ding sound)
- Visual: traffic light indicator (green/yellow/red) in corner of screen
- Haptic: single vibration pulse on form deviation
- Post-set: detailed breakdown identical to Phase 1 output
- Latency target: < 100ms end-to-end (MediaPipe: ~33ms, leaving budget for analysis + rendering)
- **Key rule: max one corrective cue per rep** to avoid overload

### Progress Tracking

- Score trends over sessions (line chart)
- Per-dimension trend tracking ("Your depth improved 15% over 4 weeks")
- Before/after side-by-side video comparison
- Personal bests and milestones
- Rep/set volume tracking
- Streak system (sessions per week)

---

## Phased Implementation Plan

### Phase 1: Video Upload Analysis (MVP) -- ~4-6 weeks

**Goal:** User uploads a squat video, gets back an annotated analysis with scores and coaching cues.

**Week 1-2: Core Pipeline**
- [x] Project scaffolding (Python package, FastAPI app)
- [x] Video ingestion: accept upload (mp4/mov), extract frames with OpenCV
- [x] MediaPipe integration: extract 33 landmarks per frame with confidence scores
- [x] Joint angle calculator: knee, hip, ankle, trunk angles per frame
- [x] Squat phase detector: state machine (standing/descending/bottom/ascending)
- [x] Rep counter: count complete reps from phase transitions

**Week 3: Form Analysis Engine**
- [x] Depth checker: compare hip-to-knee height at bottom
- [x] Knee tracking analyzer: frontal-plane valgus/varus detection
- [x] Trunk angle analyzer: compare to type-specific norms
- [x] Butt wink detector: pelvic tilt change at bottom
- [x] Heel rise detector: heel landmark displacement
- [x] Good-morning detector: hip-knee lag on ascent
- [x] Per-rep scoring algorithm (weighted composite)
- [x] Calibration step: capture standing proportions for personalized thresholds

**Week 4: Output & Visualization**
- [x] Annotated video rendering: skeleton overlay with color-coded joints
- [x] Angle labels on key frames
- [x] Summary report generation (JSON + rendered HTML)
- [x] Per-rep summary cards
- [x] Corrective cue mapping (error -> coaching phrase)

**Week 5-6: Web Interface**
- [x] Simple web UI: upload video, view results
- [x] Camera setup guide (positioning instructions)
- [x] Squat type selector (bodyweight, high bar, low bar, front, goblet, overhead)
- [x] Experience level selector (beginner/intermediate/advanced)
- [x] Results page: annotated video player, report cards
- [ ] Deploy as web app

**Phase 1 Deliverable:** Working web app where users upload a squat video and receive a detailed form analysis with annotated video, scores, and coaching cues.

### Phase 1.5: Browser-Based Analysis -- ~2-3 weeks

**Goal:** Run analysis in the browser using TensorFlow.js/MediaPipe Web. No server needed for inference.

- [x] Port angle calculation and form analysis logic to TypeScript
- [x] Integrate MediaPipe Web (BlazePose) for in-browser pose estimation
- [x] Video file analysis in browser (process uploaded file client-side)
- [x] Webcam preview with live skeleton overlay and real-time coaching
- [ ] Progressive Web App (PWA) setup for mobile install

### Phase 2: Real-Time Mobile Feedback -- ~6-8 weeks

**Goal:** Live coaching during squats via phone camera.

**Weeks 1-3: On-Device Pipeline**
- [ ] Native mobile app with camera integration
- [x] On-device MediaPipe inference (browser-based via MediaPipe Web)
- [x] Real-time angle computation and phase detection
- [ ] Latency optimization (target < 100ms pipeline)

**Weeks 4-5: Feedback System**
- [x] Audio cue engine: text-to-speech via Web Speech API
- [x] Visual overlay: skeleton overlay with phase indicator
- [ ] Haptic feedback on form deviation
- [x] Feedback prioritization (one cue per rep, ranked by injury risk)
- [x] Post-set summary screen

**Weeks 6-8: Polish & Progress**
- [ ] User accounts and session storage
- [x] Progress tracking dashboard (localStorage-based)
- [x] Session history with trends
- [ ] Side-by-side comparison tool
- [x] Corrective exercise recommendations based on detected weaknesses
- [ ] Coach sharing (export/share analysis with a trainer)

### Phase 3: Advanced Features (Future)

- [ ] Multi-camera analysis (side + front simultaneously)
- [ ] Barbell tracking (weight/velocity estimation)
- [ ] Equipment detection (auto-detect squat type from visual cues)
- [ ] AI root-cause analysis ("Your knee valgus is likely caused by weak glute medius -- try these exercises")
- [ ] Coach portal: assign assessments, review client videos, add annotations
- [ ] Community features: share PRs, compare with anonymized benchmarks
- [ ] Wearable integration (Apple Watch/Garmin for heart rate overlay)
- [ ] Additional exercises (deadlift, bench press, overhead press)

---

## Tech Stack

### Phase 1 (Backend Video Analysis)

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Language | Python 3.11+ | MediaPipe native support, fast prototyping |
| Web framework | FastAPI | Async, auto-docs, file upload support |
| Pose estimation | MediaPipe Pose | 33 landmarks, z-coordinate, best mobile path |
| Video processing | OpenCV | Frame extraction, video annotation |
| Angle computation | math (stdlib) | 3D vector math for joint angles |
| Visualization | OpenCV drawing | Skeleton overlay on annotated video |
| Frontend | TypeScript + Vite | Browser-based analysis, no server needed |
| Storage | localStorage (browser) | Session history, user data |
| Deployment | Docker + cloud (Railway/Fly.io/Render) | Simple deployment |

### Phase 2 (Real-Time Mobile)

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Mobile framework | Native Swift/Kotlin (future) | Best performance for on-device inference |
| Pose estimation | MediaPipe SDK (Android/iOS) | On-device, 33 landmarks |
| Audio | Pre-recorded clips + TTS fallback | Low-latency coaching cues |
| State management | Zustand or Redux | Session state, settings |
| Backend | Same FastAPI (for sync/storage) | Progress tracking, coach features |

### Key Dependencies

```
# Phase 1 Python requirements
mediapipe>=0.10
opencv-python-headless>=4.8
numpy>=1.24
fastapi>=0.100
uvicorn[standard]
python-multipart  # file uploads
pydantic>=2.0     # data models
```

---

## Competitive Landscape

| App | Strengths | Weaknesses | Price |
|-----|-----------|------------|-------|
| CueForm AI | Cue-based feedback, frame-by-frame nav | Limited exercise library | Free + $10/mo |
| AiKYNETIX | 3D tracking, velocity analysis, coach sharing | iOS only, expensive | $13/mo or $80/yr |
| FormCheck AI | 30+ exercises, safety alerts | Generic feedback | ~$13/mo |
| Kemtai | Real-time NLP cues, post-session recap | Subscription-heavy, general fitness focus | $19-40/mo |
| Onyx | 3D capture, instructor-led | Acquired/pivoted, availability unclear | Subscription |
| Sports2D | Open source, calibrated measurements | Research-focused, no coaching UX | Free |

**Common weaknesses across all competitors:**
- ~70% accuracy for squat analysis with current pose estimation
- Detect problems but rarely explain root causes or prescribe fixes
- Camera positioning significantly affects accuracy (poor guidance)
- Treat movement as geometry, not physiology

---

## Differentiation Strategy

1. **Open-source core**: Release pose estimation pipeline + basic scoring as open source. Builds trust, enables community contributions. Monetize premium features.

2. **Root-cause analysis**: Don't just say "knees caving" -- explain *why* (weak glute medius, tight ankles) and suggest corrective exercises. This is the main gap in the market.

3. **Anatomy-aware scoring**: Calibrate thresholds to the user's body proportions (femur/tibia ratio, torso length). Most apps use fixed thresholds that penalize long-femured lifters.

4. **Privacy-first**: On-device processing only. No video uploaded to servers unless the user explicitly shares. Major differentiator vs. cloud-dependent competitors.

5. **Coach integration**: Let coaches assign assessments, review annotated videos, track client progress. White-label potential for PT clinics.

6. **Equipment-aware**: Detect squat type (bodyweight/barbell/goblet/front) and adjust scoring criteria automatically.

### Revenue Model (if commercialized)

| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | 3 video analyses/month, basic scoring |
| Pro | $9.99/mo | Unlimited analysis, progress tracking, corrective exercises |
| Coach | $29.99/mo | Client management, shared analysis, white-label |
| API | Usage-based | For developers building on the analysis engine |

---

## Safety & Legal

### Required Disclaimers
- "This app provides AI-based estimates that may contain errors"
- "Not a substitute for professional medical advice or coaching"
- "Consult a physician before beginning any exercise program"
- "Always listen to your body -- stop if you feel pain"

### When to Recommend a Professional
- Consistent asymmetry suggesting structural issue
- Form scores that decline despite coaching cues
- User reports pain or discomfort
- Inability to reach parallel depth (possible mobility restriction)
- Returning from injury

### Accuracy Communication
- Be transparent: "AI form analysis is approximately 80-90% accurate for major form faults and should complement, not replace, professional coaching"
- Show confidence levels per metric when landmark visibility is low
- Frame feedback as suggestions: "Consider pushing your knees out more" not "Your knees are wrong"
- Never make medical or injury-prevention claims

### Liability Mitigation
- Terms of service with explicit assumption of risk
- Waivers don't protect against gross negligence -- app must make reasonable safety efforts
- Flag high-risk form breakdowns prominently
- Log analysis confidence scores for each assessment

---

## References

### Biomechanics
- Straub et al. "A Biomechanical Review of the Squat Exercise" (IJSPT, 2024)
- Schoenfeld, "Squatting Kinematics and Kinetics" (JSCR, 2010)
- Lorenzetti et al. "How to squat? Effects of various stance widths" (BMC Sports Sci Med Rehab, 2018)

### Pose Estimation
- Google AI Edge, MediaPipe Pose Landmarker documentation
- Bazarevsky et al. "BlazePose: On-device Real-time Body Pose Tracking" (CVPR Workshop, 2020)
- Validations: Gu et al. "Markerless joint angle estimation using MediaPipe" (Multimedia Tools & Applications, 2026)

### Existing Projects
- [Squat-Analysis-Model](https://github.com/rohanx01/Squat-Analysis-Model) - MediaPipe + OpenCV GUI
- [Sports2D](https://github.com/davidpagnon/Sports2D) - Open-source 2D pose analysis
- [fitness-trainer-pose-estimation](https://github.com/yakupzengin/fitness-trainer-pose-estimation) - Rep counting + form
- [AI Fitness Trainer Tutorial](https://learnopencv.com/ai-fitness-trainer-using-mediapipe/) - LearnOpenCV

### UX & Feedback
- ScienceDirect: "Text, Image and Audio Feedback on Exercise Correction" (2019) - audio feedback most effective
- JMIR: "Smartphone Camera Positioning on AI Pose Estimation Accuracy" (2026)
