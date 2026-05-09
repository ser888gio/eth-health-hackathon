import json
import sys
from pathlib import Path

from dotenv import load_dotenv

from audio_assembler import assemble
from pdf_parser import parse_pdf
from script_gen import generate_script
from summarizer import summarize
from tts import generate_audio

load_dotenv()

AUDIENCES = ("lab", "clinical", "general")


def generate_assets(pdf_path: str = "report.pdf", audience: str = "lab") -> dict:
    if audience not in AUDIENCES:
        raise ValueError(f"audience must be one of {AUDIENCES}")

    output_dir = Path("output")
    output_dir.mkdir(exist_ok=True)

    summary_path = output_dir / f"summary_{audience}.json"
    script_path = output_dir / f"script_{audience}.json"
    audio_path = output_dir / f"briefing_{audience}.mp3"

    report = parse_pdf(pdf_path)
    summary = summarize(report, audience=audience)
    script = generate_script(summary, audience=audience)
    line_paths = generate_audio(script, output_dir=str(output_dir))
    assemble(line_paths, audio_path)

    summary_payload = {
        "audience": audience,
        "source_pdf": str(Path(pdf_path).resolve()),
        "audio_file": str(audio_path),
        "report": report,
        "summary": summary,
        "script": script,
    }

    summary_path.write_text(json.dumps(summary_payload, indent=2), encoding="utf-8")
    script_path.write_text(json.dumps(script, indent=2), encoding="utf-8")
    return summary_payload


if __name__ == "__main__":
    pdf = sys.argv[1] if len(sys.argv) > 1 else "report.pdf"
    audience = sys.argv[2] if len(sys.argv) > 2 else "lab"
    payload = generate_assets(pdf, audience)
    print(json.dumps({
        "summary": f"output/summary_{audience}.json",
        "audio": payload["audio_file"],
        "segments": len(payload["script"]),
    }))
