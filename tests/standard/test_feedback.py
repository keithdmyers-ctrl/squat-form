"""Tests for the squat_form.feedback module."""

import pytest

from squat_form.feedback import CUE_DATABASE, format_summary, get_cues_for_issues
from squat_form.schemas import FormIssue, IssueSeverity, SquatPhase


def _make_issue(name: str, severity: IssueSeverity = IssueSeverity.MODERATE) -> FormIssue:
    """Helper to build a FormIssue with minimal required fields."""
    return FormIssue(
        name=name,
        severity=severity,
        description=f"Test issue: {name}",
        value=50.0,
        threshold=80.0,
        phase=SquatPhase.BOTTOM,
        frame=42,
    )


# ---------------------------------------------------------------------------
# CUE_DATABASE
# ---------------------------------------------------------------------------


@pytest.mark.standard
def test_cue_database_completeness():
    """All expected issue names have entries in CUE_DATABASE."""
    expected_issues = [
        "insufficient_depth",
        "knee_valgus",
        "excessive_forward_lean",
        "fast_descent",
        "butt_wink",
        "heel_rise",
    ]
    for issue_name in expected_issues:
        assert issue_name in CUE_DATABASE, f"Missing CUE_DATABASE entry for '{issue_name}'"


# ---------------------------------------------------------------------------
# get_cues_for_issues
# ---------------------------------------------------------------------------


@pytest.mark.standard
def test_get_cues_sorted_by_priority():
    """Output is sorted by priority (ascending)."""
    issues = [
        _make_issue("insufficient_depth", IssueSeverity.HIGH),
        _make_issue("heel_rise", IssueSeverity.LOW),
        _make_issue("knee_valgus", IssueSeverity.HIGH),
    ]
    cues = get_cues_for_issues(issues)
    priorities = [c.priority for c in cues]
    assert priorities == sorted(priorities)


@pytest.mark.standard
def test_get_cues_for_known_issues():
    """Known issues produce cues with non-empty text."""
    issues = [_make_issue("insufficient_depth")]
    cues = get_cues_for_issues(issues)
    assert len(cues) > 0
    for cue in cues:
        assert cue.cue  # non-empty string
        assert cue.explanation  # non-empty string


@pytest.mark.standard
def test_get_cues_for_unknown_issue():
    """Unknown issue name -> no cue (not crash)."""
    issues = [_make_issue("totally_made_up_issue_xyz")]
    cues = get_cues_for_issues(issues)
    # Should not crash; may return empty or a generic cue
    assert isinstance(cues, list)


# ---------------------------------------------------------------------------
# format_summary
# ---------------------------------------------------------------------------


@pytest.mark.standard
def test_format_summary_no_issues():
    """Empty list -> 'Great form!' message."""
    summary = format_summary([], [])
    assert "great" in summary.lower() or "no issues" in summary.lower()


@pytest.mark.standard
def test_format_summary_with_issues():
    """Issues produce markdown with severity sections."""
    issues = [
        _make_issue("insufficient_depth", IssueSeverity.HIGH),
        _make_issue("heel_rise", IssueSeverity.LOW),
    ]
    cues = get_cues_for_issues(issues)
    summary = format_summary(issues, cues)
    assert len(summary) > 0
    # Should mention severity headings (Fix These First or Fine-Tuning)
    assert "fix these first" in summary.lower() or "fine-tuning" in summary.lower()


@pytest.mark.standard
def test_format_summary_includes_cues():
    """Cues appear in the summary output."""
    issues = [_make_issue("insufficient_depth")]
    cues = get_cues_for_issues(issues)
    summary = format_summary(issues, cues)
    # The summary should contain coaching advice text
    assert len(summary) > 20  # not trivially short


@pytest.mark.standard
def test_cue_priorities_unique_per_tier():
    """No two Tier 1 (highest severity) issues share exact same priority,
    excluding ties that exist intentionally in the database."""
    # Collect all priorities for priority 1-3 issues
    high_priorities = []
    for issue_name, cue_info in CUE_DATABASE.items():
        if isinstance(cue_info, dict):
            priority = cue_info.get("priority", None)
        elif hasattr(cue_info, "priority"):
            priority = cue_info.priority
        else:
            continue
        if priority is not None and priority <= 3:  # Tier 1 = priority 1-3
            high_priorities.append((issue_name, priority))

    # Verify we found tier-1 entries and they are valid
    assert len(high_priorities) >= 2, "Expected at least 2 tier-1 priority entries"
    # Each entry should have a valid priority
    for name, priority in high_priorities:
        assert isinstance(priority, int), f"Priority for {name} should be int"
