import sys
from pathlib import Path

from dotenv import load_dotenv

from pdf_parser import parse_pdf
from summarizer import summarize
from script_gen import generate_script
from tts import generate_audio
from audio_assembler import assemble

load_dotenv()

AUDIENCES = ("lab", "clinical", "general")


def main(pdf_path: str = "report.pdf", audience: str = "lab") -> None:
    if audience not in AUDIENCES:
        print(f"Error: audience must be one of {AUDIENCES}", file=sys.stderr)
        sys.exit(1)

    print(f"[1/5] Parsing {pdf_path}...")
    report = parse_pdf(pdf_path)
    print(f"      Found {len(report['samples'])} samples, "
          f"{len(report['recurrent_low_coverage'])} recurrent low-coverage regions")

    print(f"[2/5] Summarizing for audience='{audience}'...")
    summary = summarize(report, audience=audience)

    print(f"[3/5] Generating podcast script...")
    script = generate_script(summary, audience=audience)
    print(f"      Script has {len(script)} turns")

    print(f"[4/5] Generating audio ({len(script)} lines)...")
    line_paths = generate_audio(script)

    out_path = Path(f"output/podcast_{audience}.mp3")
    print(f"[5/5] Assembling → {out_path}")
    assemble(line_paths, out_path)

    print(f"\nDone. Play: {out_path.resolve()}")


if __name__ == "__main__":
    pdf = sys.argv[1] if len(sys.argv) > 1 else "report.pdf"
    aud = sys.argv[2] if len(sys.argv) > 2 else "lab"
    main(pdf, aud)
