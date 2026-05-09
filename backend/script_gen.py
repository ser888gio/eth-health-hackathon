import json
import os

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

MODEL = "gemini-3-flash-preview"

SCRIPT_SYSTEM = {
    "lab": (
        "Write for an audience of lab scientists and bioinformaticians. "
        "Use precise technical language freely. Sam leads the technical discussion; "
        "Alex asks sharp, clinically-oriented follow-up questions."
    ),
    "clinical": (
        "Write for clinicians (oncologists, rare disease specialists). "
        "Explain genomics terms briefly on first use. Alex leads, framing everything "
        "as patient impact and diagnostic confidence."
    ),
    "general": (
        "Write for the general public — curious non-scientists. "
        "Use everyday analogies. Never use an acronym without immediately explaining it. "
        "Both hosts speak as if explaining to a smart friend."
    ),
}

SCRIPT_USER_TEMPLATE = """\
Write a conversational podcast script (~600 words, ~90 seconds spoken) between two hosts:
- Alex (clinician): patient/clinical impact angle
- Sam (bioinformatician): technical explanation angle

Use this quality report summary:
{summary_json}

Script structure (stick to this order):
1. Hook (10s): Alex opens with "Something interesting came out of this week's sequencing run..."
2. Headline (20s): Sam explains the MSH2 panel design finding and Lynch syndrome implications
3. Deep dive (30s): Alex asks about the outlier sample; Sam explains what went wrong technically
4. So what? (20s): Alex asks what the lab should do; Sam gives 1-2 concrete next steps
5. Close (10s): natural wrap-up, "see you next run"

Rules:
- Output ONLY valid JSON, no prose before or after
- Format: [{{"speaker": "Alex", "line": "..."}}, {{"speaker": "Sam", "line": "..."}}, ...]
- No stage directions, no [brackets], no (parenthetical notes)
- Each line is one spoken turn — keep turns under 40 words
- Do not repeat the same information twice"""


def _strip_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


def generate_script(summary: dict, audience: str = "lab") -> list[dict]:
    if audience not in SCRIPT_SYSTEM:
        raise ValueError(f"audience must be one of {list(SCRIPT_SYSTEM)}")

    user_prompt = SCRIPT_USER_TEMPLATE.format(summary_json=json.dumps(summary, indent=2))

    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    response = client.models.generate_content(
        model=MODEL,
        contents=user_prompt,
        config=types.GenerateContentConfig(
            system_instruction=SCRIPT_SYSTEM[audience],
            max_output_tokens=2048,
            temperature=0.7,
        ),
    )

    raw = _strip_fences(response.text)
    return json.loads(raw)


if __name__ == "__main__":
    import sys
    from pdf_parser import parse_pdf
    from summarizer import summarize

    pdf = sys.argv[1] if len(sys.argv) > 1 else "report.pdf"
    audience = sys.argv[2] if len(sys.argv) > 2 else "lab"
    report = parse_pdf(pdf)
    summary = summarize(report, audience=audience)
    script = generate_script(summary, audience=audience)
    for turn in script:
        print(f"{turn['speaker']}: {turn['line']}")
