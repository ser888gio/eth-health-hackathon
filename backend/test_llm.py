import pytest
import os
from .summarizer import summarize
from .script_gen import generate_script

# Ensure API key is set for tests
@pytest.fixture(autouse=True)
def check_api_key():
    if not os.getenv("GEMINI_API_KEY"):
        pytest.skip("GEMINI_API_KEY environment variable not set")

@pytest.fixture
def mock_report():
    return {
        "samples": [
            {"sample_id": "S1", "coverage": 120, "quality": "pass"},
            {"sample_id": "S2", "coverage": 80, "quality": "warning"}
        ],
        "recurrent_low_coverage": [
            {"gene": "MSH2", "exon": 8, "affected_samples": 6}
        ]
    }

def test_summarizer(mock_report):
    summary = summarize(mock_report, audience="lab")
    
    assert isinstance(summary, dict)
    assert "executive_summary" in summary
    assert "findings" in summary
    assert isinstance(summary["findings"], list)

def test_generate_script():
    mock_summary = {
        "executive_summary": "The test run evaluated two samples and found issues.",
        "findings": [
            {"title": "MSH2 concern", "detail": "Low coverage detected.", "action": "Review panel design."}
        ]
    }
    
    script = generate_script(mock_summary, audience="lab")
    
    assert isinstance(script, list)
    assert len(script) > 0
    assert "speaker" in script[0]
    assert "line" in script[0]
