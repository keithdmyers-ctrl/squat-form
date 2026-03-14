"""Coaching cue database and lookup helpers."""

from __future__ import annotations

from squat_form.schemas import CoachingCue, FormIssue, IssueSeverity


# Plain-English display names for each issue
ISSUE_DISPLAY_NAMES: dict[str, str] = {
    "knee_valgus": "Knees Caving In",
    "butt_wink": "Hips Tucking Under",
    "excessive_forward_lean": "Too Much Forward Lean",
    "good_morning": "Hips Rising First",
    "heel_rise": "Heels Coming Up",
    "insufficient_depth": "Not Deep Enough",
    "fast_descent": "Dropping Too Fast",
    "bouncing": "Bouncing at the Bottom",
    "asymmetric_shift": "Shifting to One Side",
    "excessive_forward_knee_travel": "Knees Too Far Forward",
    "incomplete_lockout": "Not Fully Standing Up",
}


CUE_DATABASE: dict[str, dict[str, str | int]] = {
    "knee_valgus": {
        "cue": "Spread the floor with your feet",
        "priority": 1,
        "explanation": (
            "Your knees are collapsing inward, which puts extra stress on your "
            "knee joints. This usually means the muscles on the outside of your "
            "hips need strengthening. Try squatting with a resistance band around "
            "your knees, add clamshell exercises and lateral band walks to your "
            "warmup, or try a slightly wider stance. Note: some minor inward "
            "knee movement during maximal effort is normal and not necessarily "
            "dangerous -- this is flagged because the amount detected is beyond "
            "that normal range."
        ),
    },
    "butt_wink": {
        "cue": "Squat to the box and reverse",
        "priority": 2,
        "explanation": (
            "At the very bottom of your squat, your hips tuck under and your "
            "lower back rounds. This puts extra pressure on your spine under load. "
            "It usually means your hip flexibility -- or even your hip bone "
            "structure -- is limiting your depth. Try squatting to a box at a "
            "depth where your lower back stays flat. Note: some hip movement at "
            "the bottom is normal and expected. Not everyone can achieve a deep "
            "squat with a neutral spine due to individual anatomy, and that is OK. "
            "This is flagged because the amount detected may increase injury risk, "
            "especially under heavy load."
        ),
    },
    "excessive_forward_lean": {
        "cue": "Drive the bar straight up toward the ceiling",
        "priority": 3,
        "explanation": (
            "Your upper body is leaning too far forward. This shifts the work to "
            "your lower back instead of your legs. Common causes: tight ankles, "
            "long thigh bones, or your legs need to get stronger. Try goblet squats "
            "to practice a more upright position, or try shoes with a raised heel. "
            "Note: for low-bar back squats, more forward lean is normal and expected."
        ),
    },
    "good_morning": {
        "cue": "Push the ground away as you stand",
        "priority": 3,
        "explanation": (
            "Your hips are shooting up before your shoulders on the way up, "
            "turning the squat into a lower-back exercise. This often happens when "
            "you're tired or the weight is too heavy. The most effective fix is to "
            "reduce the weight until your shoulders and hips rise at the same rate. "
            "Focus on pushing the ground away from you rather than lifting the "
            "weight up."
        ),
    },
    "heel_rise": {
        "cue": "Push your whole foot into the floor -- feel even pressure from heel to toe",
        "priority": 4,
        "explanation": (
            "Heels lifting usually means limited ankle mobility. You need about "
            "15-20 degrees of ankle dorsiflexion for a full squat. Try ankle "
            "mobility stretches before squatting, use heel-elevated shoes or small "
            "plates under your heels, or try a slightly wider stance with more "
            "toe-out."
        ),
    },
    "insufficient_depth": {
        "cue": "Aim for your hip crease to reach knee level",
        "priority": 5,
        "explanation": (
            "You're not squatting deep enough to get the full benefit. The goal "
            "is to get your hip crease to at least knee level (parallel). If you "
            "can't get there, it's usually an ankle or hip flexibility issue. Try "
            "goblet squats to a low box or bench to practice the depth, and add "
            "ankle mobility stretches and hip-opening exercises between sessions."
        ),
    },
    "fast_descent": {
        "cue": "Slow down -- aim for a 2-3 second descent",
        "priority": 6,
        "explanation": (
            "You're dropping into the squat too quickly, which makes it harder to "
            "maintain good form and control. Aim for a smooth 2-3 second descent "
            "where you feel in control the whole way down. Try counting "
            "'one-Mississippi, two-Mississippi' as you lower."
        ),
    },
    "bouncing": {
        "cue": "Pause for a half-second at the bottom before standing",
        "priority": 5,
        "explanation": (
            "You're using momentum to bounce out of the bottom instead of muscle "
            "strength. This puts extra stress on your knee and hip joints. Try "
            "pausing for a half-second at the bottom before pushing back up. "
            "This builds strength in the hardest part of the squat."
        ),
    },
    "asymmetric_shift": {
        "cue": "Push the ground away evenly on both sides",
        "priority": 4,
        "explanation": (
            "You're putting more weight on one side than the other, which can "
            "lead to uneven wear on your joints over time. This often comes from "
            "a strength or mobility difference between sides. Try single-leg "
            "exercises like split squats to build equal strength on both sides. "
            "If the shift persists, focus on driving harder through the weaker side."
        ),
    },
    "incomplete_lockout": {
        "cue": "Stand tall at the top of each rep",
        "priority": 5,
        "explanation": (
            "You're not fully standing up between reps. Finishing each rep "
            "completely builds better habits and full-range strength. Focus on "
            "standing all the way up before starting the next rep."
        ),
    },
    "excessive_forward_knee_travel": {
        "cue": "Sit your hips back toward the wall behind you",
        "priority": 4,
        "explanation": (
            "Your knees are traveling excessively far forward over your toes. While "
            "some forward knee travel is normal (especially for high-bar and front "
            "squats), too much in a low-bar squat can shift stress to your knees. "
            "Try sitting back slightly more or using a wider stance."
        ),
    },
}


def get_cues_for_issues(issues: list[FormIssue], squat_type: str | None = None) -> list[CoachingCue]:
    """Generate coaching cues for detected form issues, sorted by priority.

    Args:
        issues: List of detected form issues.
        squat_type: Optional squat type value string for load-specific cue variants.

    Returns:
        List of CoachingCue objects, sorted by priority (1 = most urgent).
    """
    seen: set[str] = set()
    cues: list[CoachingCue] = []

    for issue in issues:
        if issue.name in seen:
            continue
        seen.add(issue.name)

        entry = CUE_DATABASE.get(issue.name)
        if entry is None:
            continue

        # Check for load-specific variant
        cue_text = str(entry["cue"])
        if squat_type:
            load_cue = get_load_specific_cue(issue.name, squat_type)
            if load_cue:
                cue_text = load_cue

        cues.append(
            CoachingCue(
                issue=issue.name,
                cue=cue_text,
                priority=int(entry["priority"]),
                explanation=str(entry["explanation"]),
            )
        )

    cues.sort(key=lambda c: c.priority)
    return cues


def format_summary(issues: list[FormIssue], cues: list[CoachingCue]) -> str:
    """Format a human-readable markdown summary of issues and coaching cues.

    Args:
        issues: List of detected form issues.
        cues: List of coaching cues.

    Returns:
        Markdown-formatted string.
    """
    if not issues and not cues:
        return "**Great form!** No significant issues detected."

    lines: list[str] = []

    # Group issues by severity
    high = [i for i in issues if i.severity == IssueSeverity.HIGH]
    moderate = [i for i in issues if i.severity == IssueSeverity.MODERATE]
    low = [i for i in issues if i.severity == IssueSeverity.LOW]

    if high:
        lines.append("### Fix These First")
        for issue in high:
            display = ISSUE_DISPLAY_NAMES.get(issue.name, issue.name.replace("_", " ").title())
            lines.append(f"- **{display}**: {issue.description}")
        lines.append("")

    if moderate:
        lines.append("### Worth Improving")
        for issue in moderate:
            display = ISSUE_DISPLAY_NAMES.get(issue.name, issue.name.replace("_", " ").title())
            lines.append(f"- **{display}**: {issue.description}")
        lines.append("")

    if low:
        lines.append("### Fine-Tuning")
        for issue in low:
            display = ISSUE_DISPLAY_NAMES.get(issue.name, issue.name.replace("_", " ").title())
            lines.append(f"- **{display}**: {issue.description}")
        lines.append("")

    if cues:
        lines.append("### Focus On")
        for cue in cues:
            lines.append(f"1. **{cue.cue}** -- {cue.explanation}")
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Load-Specific Coaching Cues
# ---------------------------------------------------------------------------

LOAD_SPECIFIC_CUES: dict[str, dict[str, str]] = {
    "excessive_forward_lean": {
        "bodyweight": "Try holding your arms straight out in front for counterbalance",
        "loaded": "Drive your upper back into the bar as you stand",
    },
    "good_morning": {
        "bodyweight": "Imagine pushing the ground away from you as you stand",
        "loaded": "The weight may be too heavy -- reduce the load until your shoulders and hips rise together",
    },
    "knee_valgus": {
        "bodyweight": "Screw your feet into the floor -- turn your toes slightly outward",
        "loaded": "Reduce weight until knees track consistently, then add load gradually",
    },
}


def get_load_specific_cue(issue_name: str, squat_type: str) -> str | None:
    """Get a load-specific coaching cue variant.

    Args:
        issue_name: The issue name key (e.g. 'excessive_forward_lean').
        squat_type: The squat type value string (e.g. 'bodyweight', 'high_bar').

    Returns:
        A coaching cue string, or None if no load-specific cue exists.
    """
    if issue_name not in LOAD_SPECIFIC_CUES:
        return None
    is_loaded = squat_type in ("high_bar", "low_bar", "front")
    variant = "loaded" if is_loaded else "bodyweight"
    return LOAD_SPECIFIC_CUES[issue_name].get(variant)


# ---------------------------------------------------------------------------
# Competition-Specific Feedback
# ---------------------------------------------------------------------------

COMPETITION_CUES: dict[str, dict] = {
    "depth_fail": {
        "cue": "The judges would call this high -- sink it one more inch",
        "priority": 1,
        "explanation": (
            "In competition, the hip crease must be clearly below the top of the "
            "knee. Your squat was borderline or above. Practice pausing at your "
            "target depth to build consistency."
        ),
    },
    "incomplete_lockout_competition": {
        "cue": "Lock your knees and squeeze your glutes at the top -- wait for the rack command",
        "priority": 1,
        "explanation": (
            "In competition, you must show a clear lockout with knees fully "
            "extended and hips fully open before the rack command. Practice "
            "holding the top position for 2 seconds."
        ),
    },
    "bar_path_drift": {
        "cue": "Keep the bar over your midfoot throughout the lift",
        "priority": 3,
        "explanation": (
            "The bar is drifting horizontally during your lift. This wastes "
            "energy and can cause you to miss lifts at heavier weights. Focus "
            "on a vertical bar path directly over your midfoot."
        ),
    },
    "sticking_point_hole": {
        "cue": "Work on speed out of the hole -- pause squats and pin squats will help",
        "priority": 4,
        "explanation": (
            "Your sticking point is right out of the bottom. This is common and "
            "usually means you need more quad strength and/or better stretch "
            "reflex utilization. Add pause squats (3x3 at 70%) and pin squats "
            "from bottom position to your training."
        ),
    },
    "sticking_point_midrange": {
        "cue": "Your mid-range is the weak link -- try Anderson squats or banded squats",
        "priority": 4,
        "explanation": (
            "Your sticking point is in the middle of the ascent. This often "
            "indicates a transition weakness between quads and glutes/hamstrings. "
            "Anderson squats (from pins at the sticking point) and banded squats "
            "can help."
        ),
    },
    "sticking_point_lockout": {
        "cue": "Lockout is your weak point -- add hip thrusts and block pulls",
        "priority": 4,
        "explanation": (
            "You're slowing down near the top. This usually means glute and hip "
            "extensor strength needs work. Add heavy hip thrusts, block pulls, "
            "and top-half squats to your training."
        ),
    },
}
