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
        "Use precise technical language freely. Speak as a single expert narrator."
    ),
    "clinical": (
        "Write for clinicians (oncologists, rare disease specialists). "
        "Explain genomics terms briefly on first use. Frame everything "
        "as patient impact and diagnostic confidence. Speak as a single narrator."
    ),
    "general": (
        "Write for the general public — curious non-scientists. "
        "Use everyday analogies. Never use an acronym without immediately explaining it. "
        "Speak as a single narrator, as if explaining to a smart friend."
    ),
}

SCRIPT_USER_TEMPLATE = """\
Write a spoken audio briefing (~600 words, ~90 seconds spoken) delivered by a single narrator.

Use this quality report summary:
{summary_json}

Structure (stick to this order):
1. Hook (10s): open with "Something interesting came out of this week's sequencing run..."
2. Headline (20s): explain the MSH2 panel design finding and Lynch syndrome implications
3. Deep dive (30s): describe the outlier sample and what went wrong technically
4. So what? (20s): state what the lab should do — give 1-2 concrete next steps
5. Close (10s): natural wrap-up

Rules:
- Output ONLY valid JSON, no prose before or after
- Format: [{{"speaker": "Narrator", "line": "..."}}, ...]
- No stage directions, no [brackets], no (parenthetical notes)
- Each line is one spoken segment — keep segments under 40 words
- Do not repeat the same information twice"""


def _strip_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.rstrip("`").strip()
    # Extract outermost JSON array or object
    for open_ch, close_ch in [("[", "]"), ("{", "}")]:
        start = raw.find(open_ch)
        end = raw.rfind(close_ch) + 1
        if start != -1 and end > start:
            return raw[start:end]
    return raw.strip()


def generate_script(summary: dict, audience: str = "lab", max_retries: int = 3) -> list[dict]:
    if audience not in SCRIPT_SYSTEM:
        raise ValueError(f"audience must be one of {list(SCRIPT_SYSTEM)}")

    user_prompt = SCRIPT_USER_TEMPLATE.format(summary_json=json.dumps(summary, indent=2))
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    last_error: Exception | None = None

    for attempt in range(max_retries):
        response = client.models.generate_content(
            model=MODEL,
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=SCRIPT_SYSTEM[audience],
                max_output_tokens=3000,
                temperature=0.3,
            ),
        )

        text = response.text or ""
        if not text.strip():
            last_error = RuntimeError(
                f"Empty response from model (attempt {attempt+1}). "
                f"Finish reason: {response.candidates[0].finish_reason if response.candidates else 'unknown'}"
            )
            continue

        try:
            raw = _strip_fences(text)
            parsed = json.loads(raw)
            if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict) and "line" in parsed[0]:
                return parsed
            last_error = ValueError(
                f"Model returned unexpected JSON structure (attempt {attempt+1}): {raw[:300]}"
            )
        except json.JSONDecodeError as e:
            last_error = e

    raise RuntimeError(f"Failed to get valid script after {max_retries} attempts") from last_error


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
