from pathlib import Path


# 400 ms of silence at 44100 Hz, stereo, 128 kbps as a minimal valid MP3 frame.
# We use a pre-encoded silent MP3 chunk so we never need ffmpeg/pydub.
def _silence_bytes(pause_ms: int = 400) -> bytes:
    """Return raw MP3 bytes for a silent segment of approximately pause_ms duration."""
    # Each 44100 Hz MPEG1 Layer3 frame covers 1152 samples = ~26.1 ms.
    # We need roughly pause_ms / 26.1 frames. Each silent frame at 128 kbps
    # is 417 bytes (frame_size = 144 * bitrate / sample_rate = 144*128000/44100).
    # We approximate with a known-good silent MP3 frame repeated N times.
    # This silent frame: MPEG1, Layer3, 128kbps, 44100Hz, stereo, no padding.
    silent_frame = bytes([
        0xFF,
        0xFB,
        0x90,
        0x00,
    ] + [0x00] * 413)
    frames = max(1, round(pause_ms / 26.1))
    return silent_frame * frames


def assemble(line_paths: list[Path], output_path: Path, pause_ms: int = 400) -> None:
    silence = _silence_bytes(pause_ms)
    output_path.parent.mkdir(exist_ok=True)
    chunks: list[bytes] = []
    for path in line_paths:
        chunks.append(path.read_bytes())
        chunks.append(silence)
    output_path.write_bytes(b"".join(chunks))
    total_kb = output_path.stat().st_size / 1024
    print(f"Assembled {len(line_paths)} segments -> {output_path} ({total_kb:.0f} KB)")


if __name__ == "__main__":
    import sys

    paths = [Path(p) for p in sys.argv[1:]]
    if not paths:
        print("Usage: python audio_assembler.py output/line_000.mp3 output/line_001.mp3 ...")
        sys.exit(1)
    assemble(paths, Path("output/podcast.mp3"))
