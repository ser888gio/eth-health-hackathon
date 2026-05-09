from pathlib import Path

from pydub import AudioSegment


def assemble(line_paths: list[Path], output_path: Path, pause_ms: int = 400) -> None:
    silence = AudioSegment.silent(duration=pause_ms)
    combined = AudioSegment.empty()
    for p in line_paths:
        combined += AudioSegment.from_mp3(p) + silence
    output_path.parent.mkdir(exist_ok=True)
    combined.export(str(output_path), format="mp3")
    duration_s = len(combined) / 1000
    print(f"Assembled {len(line_paths)} segments → {output_path} ({duration_s:.1f}s)")


if __name__ == "__main__":
    import sys

    paths = [Path(p) for p in sys.argv[1:]]
    if not paths:
        print("Usage: python audio_assembler.py output/line_000.mp3 output/line_001.mp3 ...")
        sys.exit(1)
    assemble(paths, Path("output/podcast.mp3"))
