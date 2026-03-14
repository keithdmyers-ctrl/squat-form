"""Sharable text report generation."""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

from squat_form.feedback.cues import ISSUE_DISPLAY_NAMES
from squat_form.feedback.progressions import PROGRESSION_DATABASE

if TYPE_CHECKING:
    from squat_form.schemas import SetAnalysis


def generate_text_report(analysis: SetAnalysis) -> str:
    """Generate a plain-text sharable report suitable for printing or sending to a coach.

    Args:
        analysis: The full SetAnalysis result.

    Returns:
        A formatted plain-text report string.
    """
    lines: list[str] = []

    # Header
    lines.append("=" * 60)
    lines.append("        SQUAT FORM ANALYSIS REPORT")
    lines.append("=" * 60)
    lines.append("")
    lines.append(f"Date:             {date.today().isoformat()}")
    lines.append(f"Squat Type:       {analysis.config.squat_type.value}")
    lines.append(f"Experience Level: {analysis.config.experience_level.value}")
    if analysis.config.competition_mode:
        lines.append("Mode:             Competition (IPF/USAPL rules)")
    lines.append("")

    # Overall score
    lines.append(f"Overall Score:    {analysis.overall_score:.1f}/100  ({analysis.grade})")
    lines.append(f"Reps Analyzed:    {analysis.rep_count}")
    if analysis.fatigue_detected:
        lines.append("Fatigue:          DETECTED -- form degraded in later reps")
    lines.append("")

    # Per-rep breakdown
    if analysis.reps:
        lines.append("-" * 60)
        lines.append("REP BREAKDOWN")
        lines.append("-" * 60)
        lines.append(f"{'Rep':<5} {'Score':<8} {'Grade':<7} {'Top Issue'}")
        lines.append("-" * 60)
        for i, rep in enumerate(analysis.reps, 1):
            top_issue = rep.issues[0].name if rep.issues else "None"
            display_name = ISSUE_DISPLAY_NAMES.get(top_issue, top_issue.replace("_", " ").title())
            lines.append(f"{i:<5} {rep.overall_score:<8.1f} {rep.grade:<7} {display_name}")
        lines.append("")

    # Top issues with coaching cues
    if analysis.top_issues:
        lines.append("-" * 60)
        lines.append("TOP ISSUES")
        lines.append("-" * 60)
        for issue in analysis.top_issues:
            display = ISSUE_DISPLAY_NAMES.get(issue.name, issue.name.replace("_", " ").title())
            severity_label = issue.severity.value.upper()
            lines.append(f"  [{severity_label}] {display}: {issue.description}")
        lines.append("")

    if analysis.top_cues:
        lines.append("-" * 60)
        lines.append("COACHING CUES")
        lines.append("-" * 60)
        for cue in analysis.top_cues:
            lines.append(f"  {cue.priority}. {cue.cue}")
            lines.append(f"     {cue.explanation}")
            lines.append("")

    # Positive highlights
    if analysis.positive_highlights:
        lines.append("-" * 60)
        lines.append("WHAT YOU DID WELL")
        lines.append("-" * 60)
        for highlight in analysis.positive_highlights:
            lines.append(f"  + {highlight}")
        lines.append("")

    # Mobility assessment
    if analysis.mobility_findings:
        lines.append("-" * 60)
        lines.append("MOBILITY ASSESSMENT")
        lines.append("-" * 60)
        for finding in analysis.mobility_findings:
            lines.append(f"  Area: {finding.area}")
            lines.append(f"  {finding.limitation}")
            lines.append(f"  Self-test: {finding.test}")
            lines.append(f"  Exercises:")
            for stretch in finding.stretches:
                lines.append(f"    - {stretch}")
            lines.append(f"  Frequency: {finding.frequency}")
            lines.append("")

    # Warmup protocol
    if analysis.warmup_protocol:
        lines.append("-" * 60)
        lines.append("RECOMMENDED WARM-UP")
        lines.append("-" * 60)
        for i, step in enumerate(analysis.warmup_protocol, 1):
            lines.append(f"  {i}. {step.name} ({step.duration})")
            lines.append(f"     {step.description}")
            lines.append(f"     Why: {step.purpose}")
            lines.append("")

    # Exercise progressions
    progression_issues = [
        issue for issue in (analysis.top_issues or [])
        if issue.name in PROGRESSION_DATABASE
    ]
    if progression_issues:
        lines.append("-" * 60)
        lines.append("EXERCISE PROGRESSIONS")
        lines.append("-" * 60)
        for issue in progression_issues:
            display = ISSUE_DISPLAY_NAMES.get(issue.name, issue.name.replace("_", " ").title())
            lines.append(f"  For {display}:")
            for step in PROGRESSION_DATABASE[issue.name]:
                lines.append(f"    [{step['level']}] {step['exercise']}")
                lines.append(f"      Criteria: {step['criteria']}")
            lines.append("")

    # Disclaimer
    lines.append("-" * 60)
    lines.append(
        "DISCLAIMER: This analysis is based on video pose estimation and "
        "should not replace professional coaching or medical advice. If you "
        "experience pain during squats, consult a qualified professional."
    )
    lines.append("=" * 60)

    return "\n".join(lines)
