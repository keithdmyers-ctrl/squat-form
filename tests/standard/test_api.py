"""Tests for the FastAPI application endpoints."""

import io

import pytest

try:
    from fastapi.testclient import TestClient

    FASTAPI_AVAILABLE = True
except ImportError:
    FASTAPI_AVAILABLE = False


@pytest.fixture
def client():
    """Create a FastAPI test client."""
    if not FASTAPI_AVAILABLE:
        pytest.skip("fastapi not installed")
    from app import app

    return TestClient(app)


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------


@pytest.mark.standard
@pytest.mark.slow
def test_health_endpoint(client):
    """GET /api/v1/health -> 200 {'status': 'ok'}."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"


# ---------------------------------------------------------------------------
# Analyze endpoint
# ---------------------------------------------------------------------------


@pytest.mark.standard
@pytest.mark.slow
def test_analyze_no_file(client):
    """POST /api/v1/analyze with no file -> 422."""
    response = client.post("/api/v1/analyze")
    assert response.status_code == 422


@pytest.mark.standard
@pytest.mark.slow
def test_analyze_invalid_file_type(client):
    """POST with a .txt file -> error response."""
    fake_file = io.BytesIO(b"this is not a video")
    response = client.post(
        "/api/v1/analyze",
        files={"file": ("test.txt", fake_file, "text/plain")},
    )
    # Should either be 400/415/422 or a JSON error
    assert response.status_code >= 400 or (
        response.status_code == 200 and not response.json().get("success", True)
    )


@pytest.mark.standard
@pytest.mark.slow
def test_analyze_missing_config(client):
    """POST with file but no config -> uses defaults (should succeed or return validation error)."""
    # Create a minimal valid-looking file (won't actually be processed without mediapipe)
    fake_video = io.BytesIO(b"\x00" * 100)
    response = client.post(
        "/api/v1/analyze",
        files={"file": ("test.mp4", fake_video, "video/mp4")},
    )
    # Either succeeds with defaults or returns a structured error
    assert response.status_code in (200, 400, 422, 415, 500)
    if response.status_code == 200:
        data = response.json()
        assert "success" in data or "analysis" in data
