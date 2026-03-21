# Lift Coach — Training Methodology Reference

## Purpose

This document consolidates the evidence-based training principles, peer-reviewed research, and expert methodology sources that inform Lift Coach's programming decisions. Every recommendation in the app traces back to published evidence or established coaching methodology documented here.

This serves as both a reference for developers maintaining the programming engine and a transparency document for users who want to understand why the app makes specific recommendations.

---

## Part 1: Peer-Reviewed Sources

### 1. Schoenfeld et al. (2017) — Volume Dose-Response for Hypertrophy

**Citation:** Schoenfeld, B.J., Ogborn, D., & Krieger, J.W. (2017). Dose-response relationship between weekly resistance training volume and increases in muscle mass: A systematic review and meta-analysis. *Journal of Sports Sciences*, 35(11), 1073-1082. PMID: 27433992.

**Key findings:**
- Meta-analysis of 34 treatment groups from 15 studies
- Each additional weekly set is associated with ~0.37% greater hypertrophy
- Three volume tiers showed dose-response: <5 sets/wk, 5-9 sets/wk, 10+ sets/wk
- No upper ceiling identified (diminishing returns likely above 20 sets/wk)

**How Lift Coach uses this:**
- Volume tracker displays MEV/MAV/MRV zones per muscle group
- Programs prescribe 16-72 total weekly sets depending on training level
- 80/20 efficiency analysis identifies minimum effective volume
- Adaptation engine flags undertrained muscle groups

---

### 2. Schoenfeld et al. (2017) — Load and Strength vs Hypertrophy

**Citation:** Schoenfeld, B.J., Grgic, J., Ogborn, D., & Krieger, J.W. (2017). Strength and hypertrophy adaptations between low- vs. high-load resistance training. *Journal of Strength and Conditioning Research*, 31(12), 3508-3523. PMID: 28834797.

**Key findings:**
- 1RM strength gains are significantly greater with heavy loads (>60% 1RM)
- Muscle hypertrophy is similar between low and high loads when trained to failure
- For powerlifting: heavy loads are non-negotiable for maximal strength

**How Lift Coach uses this:**
- Strength phases prescribe 80-90% 1RM for main lifts
- Hypertrophy phases use 65-75% 1RM (within the effective range)
- Peaking phases use 90-100% 1RM for competition specificity
- Accessories can use lighter loads (RPE-based) without compromising hypertrophy
- Essentials 45min program uses 1-2 sets at RPE 8-10 (close to failure with lower load)

---

### 3. Schoenfeld et al. (2016) — Training Frequency for Hypertrophy

**Citation:** Schoenfeld, B.J., Ogborn, D., & Krieger, J.W. (2016). Effects of resistance training frequency on measures of muscle hypertrophy: A systematic review and meta-analysis. *Sports Medicine*, 46(11), 1689-1697. PMID: 27102172.

**Key findings:**
- Training a muscle 2x/week produces significantly greater hypertrophy than 1x/week
- Insufficient data to confirm 3x > 2x, but trend favors higher frequency
- When total volume is equated, frequency may be a tool for distributing volume

**How Lift Coach uses this:**
- All full-body programs (SS, GZCLP, DUP, Nippard 5x) hit each muscle 2-5x/week
- Upper/Lower split trains each muscle 2x/week
- Programs never prescribe 1x/week for any major muscle group
- Frequency note system warns users when selecting fewer training days

---

### 4. Zourdos et al. (2016) — RIR-Based RPE Scale

**Citation:** Zourdos, M.C., et al. (2016). Novel resistance training-specific rating of perceived exertion scale measuring repetitions in reserve. *Journal of Strength and Conditioning Research*, 30(1), 267-275. PMID: 26049792.

**Key findings:**
- RIR-based RPE scale is valid and reliable for resistance training autoregulation
- Experienced lifters are more accurate at estimating RPE than novices
- Accuracy improves at higher intensities (closer to 1RM)
- Novices need ~2 weeks of practice before RPE is reliable

**How Lift Coach uses this:**
- Full RPE-to-%1RM lookup table (reps 1-12, RPE 6-10 in 0.5 increments)
- RPE column hidden for first 5 workouts (progressive disclosure per Zourdos finding)
- RPE calculator converts between weight/reps/RPE and estimated 1RM
- Programs like HLM and Upper/Lower use RPE as primary load prescription
- Post-workout RPE feedback drives autoregulation adjustments

---

### 5. Travis et al. (2020) — Tapering and Peaking for Powerlifting

**Citation:** Travis, S.K., et al. (2020). A literature review and meta-analysis of tapering practices in competitive strength sports. *Sports Medicine - Open*, 6(1), 41. PMC7552788.

**Key findings:**
- Optimal taper: 1-2 weeks, 30-50% volume reduction, maintain or slightly reduce intensity
- Expected performance improvement from taper: 2-5%
- Stronger lifters benefit from 2-week tapers; weaker lifters from 1-week
- Final heavy session: 4-7 days before competition
- Cessation: 2-7 days before competition (4 days optimal for force production)

**How Lift Coach uses this:**
- Block periodization includes automatic peaking taper with volume reduction
- Meet date integration auto-calculates block durations (40% hyp, 40% str, 20% peak)
- Nippard powerbuilding has Week 9 taper built in
- Meet prep plan generates a periodized taper from competition date
- Competition attempt planning (opener/second/third at 88%/94%/100%)

---

### 6. Helms et al. (2016, 2018) — RPE for Strength Athletes

**Citations:**
- Helms, E.R., et al. (2016). Application of the repetitions in reserve-based rating of perceived exertion scale for resistance training. *Strength and Conditioning Journal*, 38(4), 42-49.
- Helms, E.R., et al. (2018). RPE and velocity relationships for the back squat, bench press, and deadlift in powerlifters. *Journal of Strength and Conditioning Research*, 32(7), 1875-1881. PMID: 29786623.

**Key findings:**
- RPE-based autoregulation produces superior strength gains vs fixed percentages
- RPE 7-9 is the productive training zone for most work sets
- RPE 10 should be reserved for testing and competition, not regular training
- Technique degradation under load indicates the weight exceeds neuromuscular capacity
- Combining RPE with percentage-based loading (dual regulation) is optimal

**How Lift Coach uses this:**
- 6-signal adaptation engine uses RPE as Signal 3
- Form score (from CV analysis) drives load adjustment when technique degrades (Helms finding)
- RPE > 9.5 sustained triggers deload recommendation
- RPE < 7 sustained triggers weight increase
- Nippard powerbuilding uses dual %1RM + RPE prescription
- Coach responds to RPE questions with evidence-based guidance

---

### 7. Deload Practices — Consensus Evidence

**Citations:**
- Pritchard, H.J., et al. (2015). Tapering practices of New Zealand's elite raw powerlifters. *Journal of Strength and Conditioning Research*, 29(7), 1963-1969. PMID: 26200193.
- Bell, L., et al. (2022). Deloading practices in resistance-trained individuals: A survey. *Sports Medicine - Open*. PMC10948666.
- Swinton, P.A., et al. (2022). Integrating deloading into strength and powerlifting training: A Delphi consensus. *Frontiers in Sports and Active Living*. PMC10511399.

**Key findings:**
- Deload every 4-6 weeks (average: 5.6 weeks in practice)
- Duration: ~1 week (average: 6.4 days)
- Method: Reduce volume 30-50%, maintain or slightly reduce intensity
- Proactive (scheduled) deloads are as effective as reactive (triggered by performance decline)
- Most common triggers: performance stall, accumulated fatigue, joint aches, declining motivation

**How Lift Coach uses this:**
- Programmed deloads: 5/3/1 every 4th week, others every 4-6 weeks
- Reactive deloads: forced when 3+ fatigue signals accumulate
- Vacation mode auto-triggers deload return (80% of previous weights for 1 week)
- "Modify Schedule" → "I need a deload week" applies 35-40% weight reduction
- Readiness questionnaire feeds into proactive deload recommendations

---

### 8. Morton et al. (2018) — Protein Requirements

**Citation:** Morton, R.W., et al. (2018). A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults. *British Journal of Sports Medicine*, 52(6), 376-384.

**Key findings:**
- Optimal protein intake: 1.6-2.2 g/kg/day for maximizing muscle protein synthesis
- Spread across 3-6 meals per day for optimal absorption
- Higher protein intake particularly important during caloric deficit
- Protein timing (post-workout) less important than total daily intake

**How Lift Coach uses this:**
- Stall messaging includes protein recommendation (1.6-2.2 g/kg/day)
- AI coach nutrition response references Morton et al.
- Readiness-based deload suggestions mention protein adequacy

---

### 9. Ogasawara et al. (2013) — Periodic Training Breaks

**Citation:** Ogasawara, R., et al. (2013). Comparison of muscle hypertrophy following 6-month of continuous and periodic resistance training. *European Journal of Applied Physiology*, 113(4), 975-985.

**Key findings:**
- Periodic training (6 weeks on, 3 weeks off) produced SIMILAR hypertrophy to continuous training over 24 weeks
- Planned breaks of 1-3 weeks do not cause significant strength loss
- Strength returns within 1-2 sessions of resuming training

**How Lift Coach uses this:**
- Vacation mode references this study in its science note
- Travel mode (bodyweight/dumbbell) maintains movement patterns during breaks
- Auto-deload-return protocol (80% for 1 week) after vacation/travel periods

---

### 10. Androulakis-Korakakis et al. (2020) — Minimum Effective Training Dose

**Citation:** Androulakis-Korakakis, P., et al. (2020). The minimum effective training dose required to increase 1RM strength in resistance-trained men: A systematic review and meta-analysis. *Sports Medicine*, 50(4), 751-765. PMC8435792.

**Key findings:**
- As few as 2-3 heavy sets per exercise per session, 2-3 times per week, can maintain or increase strength
- Low-volume training (1-4 sets/muscle/week) still produces measurable gains
- The minimum effective dose is much lower than the maximum tolerable dose
- Practical application: when time-constrained, prioritize compounds at adequate intensity

**How Lift Coach uses this:**
- Essentials 45min program uses 1-2 working sets per exercise at high intensity
- 80/20 efficiency analysis identifies the minimum effective exercises
- Time-optimized plan variant (60% of training time, ~88% of strength retention)
- Travel mode prescribes minimum effective bodyweight/light sessions

---

### 11. Rhea et al. (2002) — Daily Undulating Periodization

**Citation:** Rhea, M.R., et al. (2002). A comparison of linear and daily undulating periodized programs with equated volume and intensity for strength. *Journal of Strength and Conditioning Research*, 16(2), 250-255. PMID: 11991778.

**Key findings:**
- DUP produced 28.8% 1RM improvement vs 14.4% for linear periodization over 12 weeks
- Study used untrained subjects (important context)
- Daily variation in rep ranges and intensities prevents accommodation
- For trained lifters, Zourdos et al. (2016) confirmed DUP superiority

**How Lift Coach uses this:**
- DUP program with Strength/Hypertrophy/Power day rotation
- DUP science basis correctly notes the untrained population caveat
- DUP is classified as "advanced" (appropriate given trained-population evidence is more modest)

---

### 12. Milewski et al. (2014) — Sleep and Injury Risk

**Citation:** Milewski, M.D., et al. (2014). Chronic lack of sleep is associated with increased sports injuries in adolescent athletes. *Journal of Pediatric Orthopedics*, 34(2), 129-133.

**Key findings:**
- Athletes sleeping <8 hours had 1.7x greater injury risk
- Sleep deprivation reduces maximal strength by 5-10%
- Sleep quality affects recovery capacity, hormonal profile, and cognitive function

**How Lift Coach uses this:**
- Readiness questionnaire tracks sleep hours and quality
- Sleep <6 hours triggers warning with injury risk citation
- Low readiness trend (including poor sleep) triggers deload recommendation
- AI coach nutrition/recovery response emphasizes sleep > supplements

---

### 13. Knowles et al. (2018) — Sleep and Strength Performance

**Citation:** Knowles, O.E., et al. (2018). Inadequate sleep and muscle strength: Implications for resistance training. *Journal of Science and Medicine in Sport*, 21(9), 959-968. PMID: 29352073.

**Key findings:**
- Sleep deprivation reduces maximal voluntary contraction by 5-10%
- Even partial sleep restriction (6 hours vs 8) impairs strength recovery
- Effects are cumulative across consecutive nights of poor sleep

**How Lift Coach uses this:**
- Same as Source 12 — integrated into readiness system and coaching responses

---

## Part 2: Published Training Methodology Sources

### 14. Mark Rippetoe — Starting Strength (2011)

**Source:** Rippetoe, M. *Starting Strength: Basic Barbell Training*, 3rd ed. The Aasgaard Company, 2011.

**Core principles:**
- Novice linear progression: add weight every session
- 3x5 across for squat, bench, press; 1x5 for deadlift
- Full-body 3x/week (Mon/Wed/Fri)
- Stress-Recovery-Adaptation cycle (Selye's General Adaptation Syndrome)
- When daily LP stalls → weekly periodization → block periodization

**How Lift Coach uses this:**
- Starting Strength is one of 3 beginner programs
- 5-phase NLP evolution (per Sam Krapf's guide, see Source 15)
- LP tracking with stall detection, automatic deload, increment reduction
- LP exhaustion triggers intermediate program transition

---

### 15. Sam Krapf, SSC — Practical Guide to the Novice Linear Progression (2024)

**Source:** Krapf, S. *The Practical Guide to the Novice Linear Progression*. Ground Zero Strength, 2024. (nlpguide.gzstrength.com)

**Core principles:**
- "Don't change anything until you have to. Then change the least amount possible."
- 5-phase NLP evolution within the novice program
- Phase 1: True NLP (DL every session)
- Phase 2: Light pull introduced (one DL replaced with rows)
- Phase 3: Light squat mid-week (80% of heavy day)
- Phase 4: Back-off sets (1x5 top + 2x5 @ 90%)
- Phase 5: Full HLM for squats and pulls
- Per-lift transitions (OHP stalls first, then bench, then squat, then deadlift)

**How Lift Coach uses this:**
- All 5 phases implemented with 13 workout templates
- Auto-phase advancement based on: DL/squat weight ratio, deload cycles, soreness, readiness
- Press/bench alternation across sessions
- Bodyweight-relative Phase 2→3 threshold (1.5x BW male, 1.2x BW female)

---

### 16. Jim Wendler — 5/3/1 Forever (2017)

**Source:** Wendler, J. *5/3/1 Forever*. Jim Wendler LLC, 2017.

**Core principles:**
- Training Max = 90% of true 1RM (conservative, sustainable)
- 3-week wave: 65/75/85% → 70/80/90% → 75/85/95% (all of TM)
- AMRAP "+" sets provide autoregulation within the structure
- Supplemental templates: BBB (5x10 @ 50-60%), FSL (5x5 @ first set weight)
- Assistance: 50-100 reps each push/pull/single-leg per session
- "5 forward, 3 back" TM management for long-term sustainability
- Deload every 4th week

**How Lift Coach uses this:**
- 3 complete 5/3/1 templates: Beginner, BBB, FSL
- Correct TM calculation (90% of 1RM)
- Week-adjusted percentages displayed in workout cards
- AMRAP performance drives TM progression
- Automatic TM reset recommendation when AMRAPs underperform
- Deload week 4 with reduced volume

---

### 17. Greg Nuckols — Stronger by Science

**Sources:**
- Nuckols, G. *The Art of Lifting* (with Omar Isuf). 2015.
- Nuckols, G. *The Science of Lifting* (with Omar Isuf). 2015.
- Nuckols, G. 28 Free Programs. strongerbyscience.com, 2015-present.
- Nuckols, G. Various articles on volume, frequency, periodization. strongerbyscience.com.

**Core principles:**
- 80/20 (Pareto) principle: most results come from compound lifts, sleep, protein, progressive overload
- SAID principle: strength is a skill — practice the specific lifts at relevant loads
- Curvilinear stress response: too little stress = no adaptation, optimal stress = max gains, too much = overtraining
- Power law of diminishing returns for non-stressful inputs (meal frequency, sleep, training frequency)
- Training frequency: 2-3x/week per movement for optimal strength/hypertrophy balance
- Volume: 10-20 sets/muscle/week distributed across sessions

**How Lift Coach uses this:**
- 80/20 efficiency analysis function explicitly uses Pareto framework
- All programs center on compound lifts (SAID principle)
- Multi-signal fatigue detection models curvilinear stress response
- Volume tracker uses Nuckols' volume recommendations
- Training frequency validated across all 15 programs

---

### 18. Jeff Nippard — Powerbuilding System (2022-2023)

**Sources:**
- Nippard, J. *Powerbuilding Phase 3.0* (5x/week). 2022.
- Nippard, J. *The Essentials Program* (4x/week). 2023.

**Core principles:**
- Powerbuilding: simultaneous strength + hypertrophy through Big 3 focus + accessory volume
- Block periodization within mesocycles: accumulation → transmutation → peaking
- Dual autoregulation: %1RM + RPE caps on every working set
- Top singles on competition lifts for neuromuscular efficiency
- Time-efficient training: 1-2 hard sets close to failure > 3-4 easy sets (Essentials)
- Superset antagonist isolation work to save time

**How Lift Coach uses this:**
- Nippard Powerbuilding 5x program with 5 full-body days
- Essentials 45min program with 1-2 working sets at RPE 8-10
- Both use dual %1RM + RPE prescription
- Built-in semi-deload and taper weeks

---

### 19. Mike Israetel / Renaissance Periodization — Volume Landmarks

**Source:** Israetel, M., Hoffmann, J., & Smith, C. *Scientific Principles of Hypertrophy Training*. Renaissance Periodization, 2021.

**Core principles:**
- Volume landmarks per muscle group:
  - MV (Maintenance Volume): minimum to prevent atrophy
  - MEV (Minimum Effective Volume): minimum to stimulate growth
  - MAV (Maximum Adaptive Volume): volume producing best gains
  - MRV (Maximum Recoverable Volume): beyond this, you accumulate more fatigue than fitness
- Start mesocycle at MEV, progress toward MAV over 4-6 weeks, deload
- Individual variation is massive — landmarks are population averages

**How Lift Coach uses this:**
- Volume tracker shows MEV/MAV/MRV zones per muscle group with color-coded bars
- Undertrained muscles (<MEV) flagged for additional work
- Overtrained muscles (>MRV) flagged to reduce volume
- Values sourced from Israetel's published landmarks (verified against Schoenfeld meta-analyses)

---

### 20. Barbell Medicine — RPE Autoregulation (Feigenbaum/Baraki)

**Source:** Feigenbaum, J. & Baraki, A. *The Bridge Program; RPE-Based Programming*. Barbell Medicine, 2017-present. (barbellmedicine.com)

**Core principles:**
- RPE should be the PRIMARY load prescription tool for intermediate+ lifters
- Percentage-based training doesn't account for daily variation in readiness
- The Bridge: 8-week transition program from novice LP to intermediate RPE-based training
- Exercise variations alongside main lifts (pause squat, pin press, deficit deadlift)
- "The external load is merely a strategy for eliciting a response unique to each trainee"

**How Lift Coach uses this:**
- HLM, Upper/Lower, DUP programs use RPE as primary prescription
- Per-set RPE tracking feeds into autoregulation
- RPE calculator for bidirectional conversion
- Exercise variation through Conjugate ME picker and custom program builder

---

### 21. Louie Simmons — Westside Barbell / Conjugate Method

**Source:** Simmons, L. *Westside Barbell Book of Methods*. Westside Barbell, 2007.

**Core principles:**
- Three methods: Max Effort (work to 1-3RM), Dynamic Effort (submaximal speed work), Repeated Effort (accessories)
- Exercise rotation every 1-3 weeks prevents accommodation
- Accommodating resistance (bands/chains) for rate of force development
- 4 days: ME Lower, ME Upper, DE Lower, DE Upper

**How Lift Coach uses this:**
- Full Conjugate program with ME/DE split
- ME variation picker for exercise rotation tracking
- DE percentages (50-60% with speed focus) match Simmons prescription
- Accessory work targets identified weak points

---

## Part 3: Best Practices Summary

### The Evidence-Based Programming Hierarchy

Based on the compiled research, here is the priority order of training factors (most to least impactful):

#### Tier 1: Non-Negotiable (accounts for ~80% of results)

1. **Progressive overload** — Systematically increase weight, reps, or sets over time (Kraemer & Ratamess 2004)
2. **Compound movements** — Squat, bench, deadlift, press, row as the foundation (Ralston et al. 2017)
3. **Adequate protein** — 1.6-2.2 g/kg/day, spread across 3-5 meals (Morton et al. 2018)
4. **Sufficient sleep** — 7-9 hours; <6 hours impairs strength 5-10% and increases injury 1.7x (Milewski 2014, Knowles 2018)
5. **Consistency** — Show up 2-5x/week, every week, for months and years

#### Tier 2: Important (accounts for ~15% of results)

6. **Training volume** — 10-20 sets/muscle/week for hypertrophy; >4 sets for strength (Schoenfeld 2017)
7. **Training frequency** — Each muscle 2x+/week, distributed across sessions (Schoenfeld 2016)
8. **Intensity management** — RPE 7-9 for most work sets; avoid chronic RPE 10 (Zourdos 2016, Helms 2018)
9. **Deloading** — Every 4-6 weeks, reduce volume 30-50% (PMC10948666, PMC10511399)
10. **Exercise specificity** — Practice the competition lifts at relevant loads (SAID principle, Nuckols 2015)

#### Tier 3: Helpful but secondary (accounts for ~5% of results)

11. **Periodization style** — DUP, block, linear, or undulating all work; the best plan is the one you follow
12. **Exercise variation** — Rotate accessories to prevent accommodation; keep main lifts consistent
13. **Autoregulation** — RPE/RIR-based load selection accounts for daily readiness variation
14. **Warm-up protocol** — General cardio (5 min) + specific progressive warm-up sets
15. **Rest periods** — 3-5 min for heavy compounds, 1-2 min for accessories

#### Tier 4: Marginal (diminishing returns)

16. Nutrient timing (protein within 2 hours post-training is sufficient)
17. Supplements (creatine monohydrate is the only one with strong evidence)
18. Advanced techniques (dropsets, rest-pause, cluster sets — useful for time efficiency)
19. Training to absolute failure (proximity to failure matters; actual failure adds fatigue without proportional benefit)
20. Perfect programming (consistency with a decent program > inconsistency with the perfect program)

---

### Programming by Experience Level

#### Beginner (0-12 months)

| Parameter | Recommendation | Evidence |
|-----------|---------------|----------|
| Frequency | 3x/week full body | Rippetoe 2011, Schoenfeld 2016 |
| Progression | Add weight every session (LP) | Rippetoe 2011, Krapf 2024 |
| Volume | 3x5 main lifts, 1x5 deadlift | Rippetoe 2011 |
| Intensity | Work up to heavy 5s | Rippetoe 2011 |
| RPE use | Learn but don't prescribe yet | Zourdos 2016 (novices less accurate) |
| Deload | Reactive (after stall) | Krapf 2024 |
| Duration | 3-9 months before transition | Krapf 2024, Baker 2015 |

#### Intermediate (1-3 years)

| Parameter | Recommendation | Evidence |
|-----------|---------------|----------|
| Frequency | 3-4x/week, each muscle 2x+ | Schoenfeld 2016 |
| Progression | Weekly (Texas Method) or per-cycle (5/3/1) | Wendler 2017, Baker 2015 |
| Volume | 10-15 sets/muscle/week | Schoenfeld 2017, Nuckols 2018 |
| Intensity | RPE 7-9, dual %1RM + RPE | Helms 2018, Zourdos 2016 |
| RPE use | Primary autoregulation tool | Feigenbaum 2017 |
| Deload | Every 4-6 weeks, -30-50% volume | PMC10948666 |
| Periodization | DUP, HLM, or wave (5/3/1) | Rhea 2002, Wendler 2017 |

#### Advanced (3+ years)

| Parameter | Recommendation | Evidence |
|-----------|---------------|----------|
| Frequency | 4-6x/week | Nippard 2022, Simmons 2007 |
| Progression | Block periodization with phases | Issurin 2008, Travis 2020 |
| Volume | 15-20+ sets/muscle/week | Israetel 2021, Schoenfeld 2017 |
| Intensity | Phase-dependent: hyp 65-75%, str 80-90%, peak 90%+ | Travis 2020 |
| Competition taper | 1-2 weeks, -30-50% volume, maintain intensity | Travis 2020 |
| Exercise variation | Rotate accessories, keep main lifts | Simmons 2007 |
| Autoregulation | RPE + readiness + form analysis | Zourdos 2016, Helms 2018 |

---

### Injury Prevention & Management Principles

Based on ACSM Guidelines (2021), Blanch & Gabbett (2016), Meeusen et al. (2013):

1. **Pain during exercise = stop that movement**. Substitute, don't push through.
2. **Persistent pain (3+ sessions) = see a healthcare professional**. The app is not a doctor.
3. **DOMS is normal; sharp/localized/worsening pain is not**. Distinguish between the two.
4. **Graduated return after injury**: 70% → 85% → 100% over 2-3 sessions.
5. **Red flags requiring immediate medical attention**: sudden onset, numbness/tingling, radiating pain, swelling, joint locking.
6. **The acute-to-chronic workload ratio** (Blanch & Gabbett 2016): rapid increases in training load are the #1 injury risk factor. Progressive overload must be PROGRESSIVE.

---

### Recovery Priorities (Power Law Distribution per Nuckols 2015)

The first few units of each recovery input produce the most benefit:

1. **Sleep**: 7-8 hours (first hours matter most; >9 hours shows no additional benefit)
2. **Protein**: 1.6-2.2 g/kg/day across 3-5 meals
3. **Total calories**: Slight surplus (10-20%) for muscle gain; adequate for maintenance
4. **Hydration**: Enough for pale yellow urine
5. **Stress management**: All stressors draw from the same recovery pool (Selye GAS)
6. **Light movement on off days**: Walking, stretching, foam rolling (Ogasawara 2013)

---

## Part 4: How This Maps to Lift Coach Features

| Evidence Principle | App Feature | Module |
|-------------------|-------------|--------|
| Progressive overload | LP tracking, weight increments, AMRAP-driven progression | `progression-engine.ts` |
| Volume management | MEV/MAV/MRV tracker, weekly set counts | `volume-tracker.ts` |
| Frequency optimization | 15 programs spanning 2-5x/week | `workout-programs.ts` |
| RPE autoregulation | Per-set RPE tracking, RPE calculator, RPE-to-%1RM table | `rpe-calculator.ts`, `progression-engine.ts` |
| Deload protocols | Programmed + reactive deloads, vacation mode | `adaptation-engine.ts` |
| Form quality | CV analysis → programming adjustments | `form-bridge.ts`, `adaptation-engine.ts` |
| Injury management | Persistent tracking, substitutions, red flags, return-to-training | `adaptation-engine.ts` |
| Recovery monitoring | Readiness questionnaire (sleep, stress, soreness, motivation) | `adaptation-engine.ts` |
| Competition peaking | Meet date → block boundaries → taper | `progression-engine.ts` |
| Exercise specificity | Competition lifts as program foundation | `workout-programs.ts` |
| Time efficiency | 80/20 analysis, Essentials 45min program | `adaptation-engine.ts` |
| Evidence transparency | Citations on every adaptation decision | All modules |

---

*Last updated: March 2026*
*App version: 2.0.0*
