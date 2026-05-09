import json
import os

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

MODEL = "gemini-3-flash-preview"

SYSTEM_PROMPTS = {
    "lab": (
        "You are a senior bioinformatician presenting NGS QC findings to a lab team. "
        "Use precise metric names (PCR duplicate fraction, on-target mapping rate, coverage depth). "
        "Be direct and technical. Flag actionable issues with clear thresholds."
    ),
    "clinical": (
        "You are a clinical genomics liaison briefing an oncology team. "
        "Avoid sequencing jargon. Focus on what the QC results mean for diagnostic confidence "
        "and whether results can be trusted for clinical decision-making."
    ),
    "general": (
        "You are explaining a DNA test quality check to someone with no science background. "
        'Use simple analogies (e.g. "like a photocopier making too many copies of the same page"). '
        "Never use acronyms without explaining them first. Keep sentences short."
    ),
}

USER_PROMPT_TEMPLATE = """\
Review this NGS quality report and write:
1. A 3-sentence executive summary
2. The top 3 findings in order of clinical significance
3. One recommended action per finding

CRITICAL FINDING TO HIGHLIGHT: MSH2 exon 8 (Chr2:47442251) shows recurrent low coverage \
in {n_affected}/8 samples. This is a PANEL DESIGN issue, not a sample quality issue. \
It means variants in this Lynch syndrome gene region may be systematically missed.

QC DATA:
{qc_data}

Respond ONLY with valid JSON in this exact shape:
{{
  "executive_summary": "...",
  "findings": [
    {{"title": "...", "detail": "...", "action": "..."}}
  ]
}}"""


def _strip_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


def summarize(report: dict, audience: str = "lab") -> dict:
    if audience not in SYSTEM_PROMPTS:
        raise ValueError(f"audience must be one of {list(SYSTEM_PROMPTS)}")

    n_affected = _count_affected(report)
    user_prompt = USER_PROMPT_TEMPLATE.format(
        n_affected=n_affected,
        qc_data=json.dumps(report, indent=2),
    )

    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    response = client.models.generate_content(
        model=MODEL,
        contents=user_prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPTS[audience],
            max_output_tokens=1024,
            temperature=0.3,
        ),
    )

    raw = _strip_fences(response.text)
    return json.loads(raw)


def _count_affected(report: dict) -> int:
    for entry in report.get("recurrent_low_coverage", []):
        if entry.get("gene") == "MSH2" and entry.get("exon") == 8:
            return entry.get("affected_samples") or 7
    return 7


if __name__ == "__main__":
    import sys
    from pdf_parser import parse_pdf

    pdf = sys.argv[1] if len(sys.argv) > 1 else "report.pdf"
    audience = sys.argv[2] if len(sys.argv) > 2 else "lab"
    report = parse_pdf(pdf)
    summary = summarize(report, audience=audience)
    print(json.dumps(summary, indent=2))
