# PRD: AI-Powered Powerlifting Programming & Coaching Engine

## Vision
Transform the Squat Form Analyzer from a form-analysis tool into the **only privacy-first platform that combines computer vision form analysis with evidence-based, adaptive training programming** — occupying an uncontested market position where no competitor currently exists.

## Market Context
- **$7.7B AI fitness market** (2026), growing 12-17% CAGR
- **No existing tool combines form analysis + programming** — users pay $35-55/month for two separate apps (e.g., Juggernaut AI + Gymscore)
- **Community demand**: Reddit/forum consensus is that the ideal tool would auto-generate programs, adapt based on performance, and provide form feedback — all in one place

## Target Users

| Persona | Description | Primary Need |
|---------|-------------|-------------|
| **Beginner Powerlifter** | 0-6 months, learning the lifts | "Tell me what to do and if I'm doing it right" |
| **Intermediate Powerlifter** | 6mo-3yr, past LP, seeking structure | "Help me choose the right program and progress intelligently" |
| **Advanced Powerlifter** | 3yr+, competing or planning to | "Optimize my peaking, identify weak points, manage fatigue" |
| **Powerlifting Coach** | Programs for multiple athletes | "Give me data-driven insights on my athletes' form and progress" |

## Core Feature Set

### F1: Intelligent Program Generator
**What**: Generate a complete, periodized training program based on user profile, goals, equipment, and experience level.

**User Inputs**:
- Training days per week (2-6)
- Equipment access: full gym / barbell + rack / dumbbells only / bodyweight only / mixed
- Experience level: beginner / intermediate / advanced (auto-detected from history when available)
- Current maxes (or estimated from AMRAP data)
- Goal: general strength / powerlifting competition (with meet date) / hypertrophy / athletic performance
- Constraints: time per session, injuries/limitations

**Program Selection Logic** (evidence-based):

| Experience | Days/Wk | Recommended Program | Source |
|-----------|---------|-------------------|--------|
| Beginner | 3 | GZCLP | Reddit/fitness wiki consensus; best failure management |
| Beginner | 3 | Starting Strength style LP | Rippetoe; proven for absolute beginners |
| Beginner | 3 | 5/3/1 for Beginners | Wendler; best long-term framework |
| Beginner | 4-6 | Reddit PPL (Metallicadpa) | Community-validated high frequency LP |
| Intermediate | 3 | Texas Method | Rippetoe; weekly periodization |
| Intermediate | 3 | Madcow 5x5 | Weekly linear periodization with ramping |
| Intermediate | 4 | 5/3/1 BBB/FSL | Wendler; flexible template system |
| Intermediate | 4 | GZCL Jacked & Tan 2.0 | Lefever; powerbuilding with periodization |
| Intermediate | 4 | nSuns 5/3/1 LP | High volume 5/3/1 variant |
| Intermediate | 3-4 | HLM (Heavy/Light/Medium) | Baker; stress management framework |
| Intermediate | 4-6 | Stronger by Science 28 Programs | Nuckols; per-lift customization |
| Advanced | 4 | Conjugate/Westside | Simmons; max effort + dynamic effort |
| Advanced | 3-5 | Block Periodization | JTS; accumulation/intensification/realization |
| Advanced | 4-6 | RPE-based (RTS style) | Tuchscherer; full autoregulation |
| Advanced | 3-4 | Sheiko | Sheiko; high volume submaximal |
| Advanced | 4 | DUP | Research-backed; ~2x strength gains vs linear |
| Competition | Any | Meet Peaking Protocol | 1-2 week taper, 30-50% volume reduction |

**Equipment Adaptations**:
- Full gym: Standard barbell programming
- Barbell + rack (home): Same programs, substitute machine accessories with barbell/DB alternatives
- Dumbbells only: Goblet squats for back squats, DB bench for barbell bench, DB RDL for deadlift, DB OHP, DB rows. Apply same progression principles (Schoenfeld 2021: DB training equally effective for muscle/strength)
- Bodyweight only: Progression-based (push-up → decline push-up → dips; air squat → pistol squat; inverted row → pull-up). Linear progression on difficulty, not load
- Mixed: Barbell for main lifts where available, DB/BW for accessories

### F2: Novice Linear Progression Engine
**What**: Built-in LP tracker with automatic stall detection, deload management, and transition recommendations.

**Progression Rules**:
- Lower body: +10 lb/session initially, drop to +5 lb when first stall
- Upper body: +5 lb/session initially, drop to +2.5 lb when first stall
- Microplate recommendation when available

**Stall Detection Algorithm**:
1. Failed to complete prescribed reps at a given weight → flag
2. Auto-deload: reduce 10% and resume progression
3. Track deload cycles per lift independently
4. After 2-3 deload cycles on same lift → trigger transition recommendation

**Transition Recommendations** (per lift, not global):
- "Your squat has stalled through 3 deload cycles. Your estimated squat 1RM is [X]. Consider transitioning to intermediate programming."
- Recommended options based on days available:
  - 3 days: Texas Method or HLM (Heavy/Light/Medium) split
  - 4 days: 5/3/1 (BBB or FSL template) or GZCL Jacked & Tan
  - 5-6 days: nSuns or DUP
- Explain WHY each option fits (e.g., "Texas Method uses weekly periodization — you'll PR once per week on Friday instead of every session")
- Allow per-lift transitions: "Run intermediate bench while continuing LP squats"

**Science backing**: Rippetoe's LP exhaustion criteria; Andy Baker's transition protocols; community consensus from r/fitness, r/weightroom.

### F3: Intermediate/Advanced Program Engine
**What**: Full implementation of intermediate and advanced programs with autoregulation.

**Texas Method Implementation**:
- Monday: Volume day (5x5 @ 90% of 5RM)
- Wednesday: Recovery (2x5 @ 80% of Monday)
- Friday: Intensity (1x5 new PR attempt)
- Track weekly PRs, auto-adjust volume day based on Friday performance

**HLM (Heavy/Light/Medium) Split**:
- Configurable 3-4 day split
- Heavy: Top sets at RPE 8-9
- Light: 70-75% of heavy day weights
- Medium: 80-85% of heavy day weights
- Auto-balance stress across the week

**5/3/1 Engine**:
- Core 3-week wave with percentages of Training Max (90% of true 1RM)
- Week 1: 65/75/85% x 5+
- Week 2: 70/80/90% x 3+
- Week 3: 75/85/95% x 1+
- Week 4: Deload (40/50/60%)
- AMRAP-driven TM increases (+5 lb upper, +10 lb lower per cycle)
- Templates: BBB (5x10 supplemental), FSL (5x5 at first set %), BBS (10x5)
- Joker sets when AMRAP exceeds expectations
- Assistance: 50-100 reps each push/pull/legs per session

**RPE-Based Autoregulation**:
- Prescribe target RPE per set (e.g., "3x5 @ RPE 8")
- RPE-to-%1RM lookup table (Tuchscherer/Zourdos research)
- Fatigue stops: "repeat sets until RPE 9"
- Back-off sets: percentage drops from top set
- Session RPE tracking feeds into load management

**Block Periodization**:
- Hypertrophy block: 4-6 weeks, 8-15 reps, 50-70% 1RM, high volume
- Strength block: 4-6 weeks, 3-6 reps, 70-85% 1RM, moderate volume
- Peaking block: 2-4 weeks, 1-3 reps, 85-95% 1RM, low volume
- Auto-sequence based on meet date or training goals

### F4: Science-Based Autoregulation System
**What**: Every workout adapts based on real performance data, not just subjective readiness.

**Data Sources** (priority order):
1. **Form quality scores** (from CV analysis) — unique to this tool
2. **RPE/RIR per set** (user-reported)
3. **Rep performance** (AMRAP results vs expectations)
4. **Velocity estimates** (from CV angular velocity — approximate)
5. **Fatigue detection** (within-session score degradation)
6. **Session history trends** (weight/score progression)

**Adaptation Rules**:
- Form score < 70 on working sets → suggest weight reduction ("Your form degraded at this weight — consider dropping 5-10% to reinforce technique")
- RPE consistently > target by 1+ → auto-reduce next session's load 2-5%
- RPE consistently < target by 1+ → auto-increase next session's load 2-5%
- AMRAP exceeds expectations by 3+ reps → larger increment next cycle
- Fatigue detected (>15pt score drop across set) → suggest fewer sets or longer rest
- 3+ sessions with declining scores → trigger deload recommendation

**Research basis**: Zourdos et al. (2016) RPE autoregulation; Helms et al. (2016) RIR-based training; meta-analysis showing autoregulated training superior to fixed percentages for strength gains (PMC12336695).

### F5: Volume & Recovery Management
**What**: Track training volume by muscle group and manage fatigue.

**Volume Tracking** (per Israetel/RP volume landmarks):
- Track weekly sets per muscle group from programmed exercises
- Display relative to MEV (Minimum Effective Volume) and MRV (Max Recoverable Volume)
- Warn when approaching MRV
- Suggest deload when volume tolerance signs appear

**Deload Protocols** (evidence-based, per PMC10948666):
- Every 4-6 weeks or when performance markers decline
- Duration: 1 week
- Method: Reduce volume 30-50%, maintain intensity ≥80%
- Proactive (scheduled) or reactive (triggered by fatigue markers)

**Recovery Indicators**:
- Readiness questionnaire (sleep hours, stress 1-5, soreness 1-5, motivation 1-5)
- Trend detection: 3+ declining readiness scores → suggest light day or deload
- Form quality trend as proxy for fatigue (unique data point)

### F6: Competition Peaking Engine
**What**: Automated peaking protocol when a meet date is set.

**Protocol** (based on PMC7552788 systematic review):
- Auto-generates reverse-engineered training from meet date
- 1-2 week taper (2 weeks for lifters with >2yr experience)
- Volume reduction: 30-50% (gradual, not sudden)
- Intensity: maintain 85%+ or slight reduction
- Final heavy session: 4-7 days before meet
- Expected improvement: 2-5% on competition total
- Last deadlift: 7-10 days out (longest recovery)
- Last squat: 5-7 days out
- Last bench: 3-5 days out
- Attempt selection (existing feature, enhanced):
  - Opener: 87% (guaranteed make)
  - Second: 93% (build total)
  - Third: 100-102% (PR attempt)

### F7: Workout Session UI
**What**: Clean, fast workout logging integrated with programming.

**Session Flow**:
1. Open app → see today's prescribed workout (exercises, sets, reps, target weight/RPE)
2. For each set: log weight, reps, RPE (optional)
3. Optional: record video for form analysis on any set
4. Rest timer between sets (configurable, with suggested times per phase)
5. Session complete → summary with scores, PRs, notes
6. Auto-calculate: e1RM updates, volume totals, form trends

**Key UX Principles** (from user research):
- Speed > features: logging a set should take <3 seconds
- Offline-first: full functionality without internet
- Progressive disclosure: beginners see weight/reps only; advanced see RPE/velocity/percentage

### F8: Progress Dashboard
**What**: Comprehensive training analytics.

**Views**:
- **Strength Progression**: e1RM trend per lift over time
- **Volume Load**: weekly tonnage (sets × reps × weight) trend
- **Form Quality**: dimension scores over time per exercise
- **Training Stress**: RPE trends, readiness scores, deload timing
- **Body Composition**: bodyweight trend, DOTS score progression
- **Program Adherence**: completed vs prescribed sessions/sets
- **Weak Point Analysis**: form dimensions consistently scoring lowest → accessory recommendations

### F9: Accessory Exercise Recommendations
**What**: Auto-suggest accessories based on weak points identified by form analysis.

**Weak Point → Accessory Mapping**:

| Weak Point (Form) | Sticking Point | Accessory Exercises | Source |
|---|---|---|---|
| Depth issues (squat) | Out of the hole | Pause squats, pin squats, tempo squats | Helms et al. |
| Knee valgus | Any phase | Banded squats, hip abductor work, single-leg work | Escamilla (2001) |
| Forward lean (squat) | Mid-range | Front squats, SSB squats, leg press | Rippetoe |
| Weak lockout (squat) | Near top | Box squats, hip thrusts, glute bridges | Simmons |
| Slow off floor (DL) | Off the floor | Deficit deadlifts, pause deadlifts | Nuckols |
| Weak back (DL) | Above knee | Block pulls, heavy rows, good mornings | Sheiko |
| Slow off chest (bench) | Bottom | Spoto press, wide-grip bench, DB bench | Helms |
| Weak lockout (bench) | Near top | Close-grip bench, board press, pin press | Simmons |
| Elbow flare (bench) | Any | Tricep work, close-grip bench, floor press | JTS |
| Bar path issues | Any | Tempo reps, pause reps at sticking point | Tuchscherer |

**Equipment-adapted**: If user only has dumbbells, map to DB alternatives. If bodyweight only, map to progression exercises.

### F10: Science Citation Engine
**What**: Every recommendation links to its evidence basis.

**Implementation**:
- Each program recommendation includes a "Why this program?" explanation with methodology source
- Each adaptation decision shows the principle driving it
- Deload recommendations cite volume/fatigue research
- Form cues reference biomechanics literature
- In-app "Learn More" expandable sections with research summaries
- Not full academic citations in UI — concise "Based on [Author, Year]" with expandable detail

## Gap Analysis: Current Tool vs PRD

| Feature | Current State | PRD Target | Gap Size |
|---------|-------------|-----------|----------|
| Form Analysis (6 exercises) | Complete | Complete | None |
| 6-Dimension Scoring | Complete | Complete | None |
| Competition Rules (IPF) | Complete | Enhanced with full peaking | Small |
| 1RM Estimation | Complete | Enhanced with e1RM tracking | Small |
| Attempt Planning | Complete (3-attempt + 4-week taper) | Enhanced with lift-specific timing | Small |
| RPE/RIR Tracking | Per-session only | Per-set with autoregulation | Medium |
| Goal Tracking | 3 concurrent goals, dimension-based | Integrated with programming | Small |
| Training Phase Selection | Manual 4-phase selection | Auto-sequenced periodization | Large |
| **Program Generation** | **None** | **Full multi-methodology engine** | **Critical** |
| **LP Tracking & Stall Detection** | **None** | **Automatic with transition recs** | **Critical** |
| **Intermediate Programs** | **None** | **Texas Method, HLM, 5/3/1, GZCL, etc.** | **Critical** |
| **Advanced Programs** | **None** | **Block, DUP, Conjugate, RPE-based** | **Critical** |
| **Workout Session UI** | **None** | **Prescribed workouts with logging** | **Critical** |
| **Volume Management** | **None** | **MEV/MRV tracking with deload triggers** | **Large** |
| **Equipment Adaptations** | **None** | **Full gym/DB/BW/mixed programming** | **Large** |
| **Accessory Recommendations** | Corrective exercises only | **Weak-point-driven accessories** | **Medium** |
| **Progress Dashboard** | Basic history/charts | **Multi-dimension analytics** | **Medium** |
| **Science Citations** | None in UI | **Per-recommendation citations** | **Medium** |
| Per-Set Logging | None (per-session only) | Full set-by-set logging | Large |
| Readiness Tracking | None | Sleep/stress/soreness questionnaire | Medium |

## Implementation Priority

### Phase 1 (Critical — Core Programming Engine)
1. Program Generator with user profile inputs
2. Novice LP engine with stall detection
3. Workout session UI (today's workout + logging)
4. Equipment adaptation system

### Phase 2 (High — Intermediate/Advanced Programs)
5. Texas Method / HLM implementation
6. 5/3/1 engine with templates
7. LP-to-intermediate transition logic
8. Per-set RPE tracking with autoregulation

### Phase 3 (Medium — Intelligence Layer)
9. Form-score-driven load adjustments
10. Volume management (MEV/MRV)
11. Accessory recommendations from weak points
12. Enhanced progress dashboard

### Phase 4 (Polish — Coaching Quality)
13. Science citation engine
14. Competition peaking automation
15. Readiness tracking
16. Block periodization & DUP engines

## Success Criteria

| Persona | Rating Target | Key Satisfaction Drivers |
|---------|-------------|------------------------|
| Beginner | 4.5/5 | "It told me exactly what to do and when to progress" |
| Intermediate | 4.5/5 | "It transitioned me to the right program and adapts to my performance" |
| Advanced | 4.5/5 | "The form data feeds into intelligent programming decisions" |
| Coach | 4.5/5 | "Evidence-based recommendations I'd give my own athletes" |

## Non-Goals (This Release)
- Nutrition tracking (separate domain, well-served by MacroFactor)
- Social features / leaderboards
- Cloud sync / user accounts (privacy-first architecture)
- Coach-athlete multi-user management
- Barbell velocity hardware integration
