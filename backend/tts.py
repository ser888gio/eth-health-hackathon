import os
from pathlib import Path

from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs

load_dotenv()

MODEL_ID = "eleven_turbo_v2"
OUTPUT_FORMAT = "mp3_44100_128"


def _client() -> ElevenLabs:
    return ElevenLabs(api_key=os.getenv("ELEVENLABS_API_KEY"))


def _voice_id() -> str:
    return os.getenv("ELEVENLABS_VOICE_NARRATOR", "")


def generate_audio(script: list[dict], output_dir: str = "output") -> list[Path]:
    out = Path(output_dir)
    out.mkdir(exist_ok=True)

    client = _client()
    voice = _voice_id()
    if not voice:
        raise ValueError(
            "No voice ID configured. Set ELEVENLABS_VOICE_NARRATOR in .env"
        )
    paths: list[Path] = []

    for i, turn in enumerate(script):
        line = turn["line"]

        file_path = out / f"line_{i:03d}.mp3"
        audio_chunks = client.text_to_speech.convert(
            voice_id=voice,
            text=line,
            model_id=MODEL_ID,
            output_format=OUTPUT_FORMAT,
        )
        file_path.write_bytes(b"".join(audio_chunks))
        print(f"  [{i+1}/{len(script)}] {line[:60]}...")
        paths.append(file_path)

    return paths


if __name__ == "__main__":
    import sys
    from pdf_parser import parse_pdf
    from summarizer import summarize
    from script_gen import generate_script

    pdf = sys.argv[1] if len(sys.argv) > 1 else "report.pdf"
    audience = sys.argv[2] if len(sys.argv) > 2 else "lab"
    report = parse_pdf(pdf)
    summary = summarize(report, audience=audience)
    script = generate_script(summary, audience=audience)
    paths = generate_audio(script)
    print(f"\nGenerated {len(paths)} audio segments in output/")
