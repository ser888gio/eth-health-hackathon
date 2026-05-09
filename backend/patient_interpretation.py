import json
import os

from dotenv import load_dotenv
from google import genai
from google.genai import types

from sophia_client import SophiaPatientData

load_dotenv()

MODEL = "gemini-3-flash-preview"

SYSTEM_PROMPT = (
    "You are a senior molecular pathologist preparing a concise, actionable summary "
    "for another pathologist. Focus on verification, clinical impact, and required "
    "follow-up steps. Use clear headings and bullet points."
)

USER_PROMPT_TEMPLATE = """\
You are given SOPHiA Pathologist exports for a single patient. Use the data to produce
an actionable, step-by-step summary for the pathologist. If a required fact is missing,
state it explicitly and say what must be verified.

REQUIRED OUTPUT STRUCTURE (use these headings and order, and ASCII punctuation only):

Short answer - priorities the pathologist must complete for this patient ({patient_id}{sample_label}):

Immediate verification (before reporting)
- ...
  - ...

Orthogonal confirmation (required for an actionable germline result)
- ...

Additional molecular checks
- ...

Classification and documentation
- ...

Clinical communication / actions
- ...

VUS handling
- ...

Sign-off and audit
- ...

Practical checklist with sequence and short how-to:

A. Same day (urgent)
1. ...
2. ...

B. Within 48-72 hours
3. ...
4. ...

C. Before issuing final report
5. ...
6. ...

Suggested report language (editable, for inclusion in draft)
Short version (for report):
"..."

Caveats and things to watch
- ...

DATA:
PATIENT_METADATA_JSON:
{patient_json}

QC_REPORT_TEXT:
{qc_text}

GENE_TABLE_EXPORT:
{gene_text}

COVERAGE_EXPORT:
{coverage_text}

VARIANT_TABLE_EXPORT:
{variants_text}
"""


def _strip_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```", 1)[-1]
        raw = raw.strip("`")
    return raw.strip()


def interpret_patient(data: SophiaPatientData) -> str:
    patient_json = json.dumps(data.patient_record or {}, indent=2)
    sample_label = f", sample {data.sample_id}" if data.sample_id else ""

    user_prompt = USER_PROMPT_TEMPLATE.format(
        patient_id=data.patient_id,
        sample_label=sample_label,
        patient_json=patient_json,
        qc_text=data.qc_text or "",
        gene_text=data.gene_text or "",
        coverage_text=data.coverage_text or "",
        variants_text=data.variants_text or "",
    )

    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    response = client.models.generate_content(
        model=MODEL,
        contents=user_prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            max_output_tokens=4096,
            temperature=0.2,
        ),
    )

    return _strip_fences(response.text or "")
