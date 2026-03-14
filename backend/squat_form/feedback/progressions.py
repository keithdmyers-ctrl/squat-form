"""Exercise progression database for squat form issues."""

from __future__ import annotations


PROGRESSION_DATABASE: dict[str, list[dict]] = {
    "knee_valgus": [
        {"level": "Start here", "exercise": "Bodyweight squats with band above knees", "criteria": "3x10 with no knee cave"},
        {"level": "Progress to", "exercise": "Goblet squats with band", "criteria": "3x8 with controlled descent"},
        {"level": "Goal", "exercise": "Full squats without band, knees tracking toes naturally", "criteria": "Consistent A/B knee tracking score"},
    ],
    "butt_wink": [
        {"level": "Start here", "exercise": "Box squats to a height where back stays flat", "criteria": "3x10 with neutral spine"},
        {"level": "Progress to", "exercise": "Gradually lower the box height over 2-4 weeks", "criteria": "3x8 to parallel with no tuck"},
        {"level": "Goal", "exercise": "Full depth squats with neutral spine throughout", "criteria": "Consistent A/B trunk score"},
    ],
    "insufficient_depth": [
        {"level": "Start here", "exercise": "Goblet squat to high box/bench", "criteria": "3x10 with control"},
        {"level": "Progress to", "exercise": "Goblet squat to lower target", "criteria": "3x8 at parallel"},
        {"level": "Goal", "exercise": "Full squat to target depth for your level", "criteria": "Consistent A/B depth score"},
    ],
    "heel_rise": [
        {"level": "Start here", "exercise": "Squats with heels on 1-inch plates", "criteria": "3x10 with flat heels"},
        {"level": "Progress to", "exercise": "Squats with half-inch elevation", "criteria": "3x10 with flat heels"},
        {"level": "Goal", "exercise": "Flat-soled squats with full ankle mobility", "criteria": "No heel rise detected"},
    ],
    "excessive_forward_lean": [
        {"level": "Start here", "exercise": "Goblet squats (weight in front forces upright)", "criteria": "3x10 with trunk score > 80"},
        {"level": "Progress to", "exercise": "Front squats with light weight", "criteria": "3x8 with controlled lean"},
        {"level": "Goal", "exercise": "Back squats with appropriate lean for your body type", "criteria": "Consistent A/B trunk score"},
    ],
    "good_morning": [
        {"level": "Start here", "exercise": "Pause squats with light weight (3-second pause at bottom)", "criteria": "3x5 with shoulders and hips rising together"},
        {"level": "Progress to", "exercise": "Tempo squats (3 seconds down, 3 seconds up)", "criteria": "3x6 with no forward lean increase on ascent"},
        {"level": "Goal", "exercise": "Normal squats with chest staying up throughout", "criteria": "Consistent A/B trunk score"},
    ],
    "bouncing": [
        {"level": "Start here", "exercise": "Box squats with controlled descent and full pause", "criteria": "3x8 with 1-second pause on box"},
        {"level": "Progress to", "exercise": "Pause squats (1-second pause at bottom, no box)", "criteria": "3x6 with controlled reversal"},
        {"level": "Goal", "exercise": "Brief controlled pause at bottom before driving up", "criteria": "Bottom duration above 0.1 seconds consistently"},
    ],
    "fast_descent": [
        {"level": "Start here", "exercise": "Tempo squats with 3-second descent", "criteria": "3x8 with smooth, controlled descent"},
        {"level": "Progress to", "exercise": "Tempo squats with 2-second descent", "criteria": "3x8 maintaining form throughout"},
        {"level": "Goal", "exercise": "Controlled 2-second descent at working weight", "criteria": "Consistent controlled tempo score"},
    ],
    "asymmetric_shift": [
        {"level": "Start here", "exercise": "Single-leg exercises (Bulgarian split squats, lunges)", "criteria": "3x10 each side with equal difficulty"},
        {"level": "Progress to", "exercise": "Squats with feet on separate scales or balance boards", "criteria": "Weight within 5% between sides"},
        {"level": "Goal", "exercise": "Even weight distribution through full squat", "criteria": "Symmetry score consistently above 80"},
    ],
}


def get_progressions(issue_name: str) -> list[dict]:
    """Get the exercise progression for a given issue.

    Args:
        issue_name: The issue name key (e.g. 'knee_valgus').

    Returns:
        List of progression step dicts, or empty list if no progression defined.
    """
    return PROGRESSION_DATABASE.get(issue_name, [])
