"""Mobility assessment and warm-up protocol generation based on detected squat form issues."""

from __future__ import annotations

from dataclasses import dataclass, field

from squat_form.schemas import FormIssue, SquatConfig


@dataclass
class MobilityFinding:
    area: str               # e.g. "Ankles", "Hips", "Thoracic Spine"
    limitation: str         # Plain English description
    test: str               # Self-assessment test
    stretches: list[str]    # 2-3 stretches/exercises
    frequency: str          # e.g. "Daily, 5 minutes"


@dataclass
class WarmUpStep:
    name: str
    description: str
    duration: str
    purpose: str


# ---------------------------------------------------------------------------
# Mobility assessment database: issue_name -> MobilityFinding template
# ---------------------------------------------------------------------------

_MOBILITY_MAP: dict[str, dict] = {
    "heel_rise": {
        "area": "Ankles",
        "limitation": "Your ankle flexibility may be limiting your squat depth.",
        "test": (
            "Kneel facing a wall with toes 4 inches away. Can your knee touch "
            "the wall without your heel lifting? If not, ankle mobility is limited."
        ),
        "stretches": [
            "Wall ankle stretch (knee to wall) - 3x30s each side",
            "Calf foam rolling - 2 minutes each leg",
            "Banded ankle distraction - 2x30s each side",
        ],
        "frequency": "Daily, 5 minutes before squatting",
    },
    "butt_wink": {
        "area": "Hips",
        "limitation": "Your hip flexion range may be limiting your bottom position.",
        "test": (
            "Lie on your back and pull one knee to your chest. If your other leg "
            "lifts off the floor, hip flexors are tight. If you can't get your "
            "knee past 120 degrees, hip flexion is limited."
        ),
        "stretches": [
            "90/90 hip stretch - 3x30s each side",
            "Pigeon stretch - 2x45s each side",
            "Deep squat hold (holding doorframe) - 3x20s",
        ],
        "frequency": "Daily, 5 minutes; hold each position longer over time",
    },
    "excessive_forward_lean": {
        "area": "Multiple (Ankles, Hips, Thoracic Spine)",
        "limitation": (
            "A combination of ankle, hip, or thoracic spine mobility may be "
            "limiting your upright position."
        ),
        "test": (
            "Hold a broomstick overhead and squat. If you can't keep it over "
            "your feet, you likely have thoracic extension or overhead mobility "
            "limitations."
        ),
        "stretches": [
            "Wall ankle stretch - 3x30s",
            "Cat-cow thoracic mobilization - 2x10 reps",
            "Open book stretch - 2x10 each side",
        ],
        "frequency": "Before every squat session, 5-8 minutes",
    },
    "knee_valgus": {
        "area": "Hips (lateral)",
        "limitation": (
            "The muscles on the outside of your hips may need strengthening "
            "to keep your knees tracking properly."
        ),
        "test": (
            "Stand on one leg for 30 seconds. If your hip drops on the other "
            "side or your knee caves in, hip abductor strength is a factor."
        ),
        "stretches": [
            "Clamshells with band - 3x15 each side",
            "Lateral band walks - 3x10 each direction",
            "Single-leg glute bridges - 3x12 each side",
        ],
        "frequency": "3x per week as part of your warmup",
    },
    "good_morning": {
        "area": "Core/Quads",
        "limitation": "Your core stability or quadriceps strength may need work.",
        "test": (
            "Do a wall sit at 90 degrees for 45 seconds. If your quads give "
            "out quickly, quad endurance is a factor."
        ),
        "stretches": [
            "Goblet squat holds - 3x10s at bottom",
            "Front plank - 3x30s",
            "Wall sits - 3x30s",
        ],
        "frequency": "2-3x per week",
    },
}


def assess_mobility(issues: list[FormIssue], config: SquatConfig) -> list[MobilityFinding]:
    """Analyze form issues and suggest which mobility limitations are likely causing them.

    Args:
        issues: List of detected form issues from the analysis.
        config: Squat configuration (used for context).

    Returns:
        List of MobilityFinding objects with areas, tests, and stretches.
    """
    seen_areas: set[str] = set()
    findings: list[MobilityFinding] = []

    for issue in issues:
        template = _MOBILITY_MAP.get(issue.name)
        if template is None:
            continue

        # Avoid duplicate findings for the same area
        if template["area"] in seen_areas:
            continue
        seen_areas.add(template["area"])

        findings.append(
            MobilityFinding(
                area=template["area"],
                limitation=template["limitation"],
                test=template["test"],
                stretches=list(template["stretches"]),
                frequency=template["frequency"],
            )
        )

    return findings


# ---------------------------------------------------------------------------
# Warm-up protocol generation
# ---------------------------------------------------------------------------

_BASE_WARMUP: list[dict[str, str]] = [
    {
        "name": "General warm-up",
        "description": (
            "5 minutes of light cardio (walking, bike, jumping jacks) "
            "to raise body temperature"
        ),
        "duration": "5 min",
        "purpose": "Increases blood flow and prepares joints",
    },
    {
        "name": "Hip circles",
        "description": (
            "Stand on one leg, make 10 large circles with the other knee "
            "in each direction"
        ),
        "duration": "2 min",
        "purpose": "Warms up hip joints",
    },
    {
        "name": "Bodyweight squats",
        "description": (
            "10 slow bodyweight squats with a 2-second pause at the bottom"
        ),
        "duration": "2 min",
        "purpose": "Grooves the squat pattern",
    },
]

_ISSUE_WARMUP_STEPS: dict[str, dict[str, str]] = {
    "heel_rise": {
        "name": "Ankle mobilization",
        "description": (
            "Wall ankle stretch -- knee to wall, 10 reps each side, "
            "pushing a little further each rep"
        ),
        "duration": "2 min",
        "purpose": "Improves ankle dorsiflexion for deeper squats",
    },
    "butt_wink": {
        "name": "Hip opener",
        "description": (
            "Deep squat hold, hold the bottom for 20 seconds, rock side "
            "to side gently"
        ),
        "duration": "1 min",
        "purpose": "Opens hip flexion range for the bottom position",
    },
    "knee_valgus": {
        "name": "Glute activation",
        "description": (
            "10 clamshells + 10 lateral band walks each direction"
        ),
        "duration": "3 min",
        "purpose": "Activates hip abductors to prevent knee cave",
    },
    "excessive_forward_lean": {
        "name": "Thoracic mobility",
        "description": (
            "Cat-cow stretch, 10 reps, focusing on upper back extension"
        ),
        "duration": "1 min",
        "purpose": "Improves upper back extension for a more upright squat",
    },
    "good_morning": {
        "name": "Core activation",
        "description": (
            "Dead bugs -- 10 reps each side, keeping lower back pressed to floor"
        ),
        "duration": "2 min",
        "purpose": "Engages core to prevent hips rising before shoulders",
    },
}


def generate_warmup(issues: list[FormIssue], config: SquatConfig) -> list[WarmUpStep]:
    """Generate a personalized pre-squat warmup based on detected form issues.

    Args:
        issues: List of detected form issues.
        config: Squat configuration (used for context).

    Returns:
        List of WarmUpStep objects (base steps + issue-specific steps).
    """
    steps: list[WarmUpStep] = []

    # Always include base warmup steps
    for base in _BASE_WARMUP:
        steps.append(
            WarmUpStep(
                name=base["name"],
                description=base["description"],
                duration=base["duration"],
                purpose=base["purpose"],
            )
        )

    # Add issue-specific steps (avoid duplicates)
    seen_names: set[str] = set()
    for issue in issues:
        step_template = _ISSUE_WARMUP_STEPS.get(issue.name)
        if step_template is None:
            continue
        if step_template["name"] in seen_names:
            continue
        seen_names.add(step_template["name"])

        steps.append(
            WarmUpStep(
                name=step_template["name"],
                description=step_template["description"],
                duration=step_template["duration"],
                purpose=step_template["purpose"],
            )
        )

    return steps
