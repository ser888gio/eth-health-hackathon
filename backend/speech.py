import re
from typing import Iterable


def _chunk_words(text: str, max_words: int) -> Iterable[str]:
    words = text.split()
    for idx in range(0, len(words), max_words):
        yield " ".join(words[idx: idx + max_words])


def text_to_script_segments(text: str, speaker: str = "Narrator", max_words: int = 40) -> list[dict]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    segments: list[dict] = []

    for line in lines:
        cleaned = re.sub(r"^[-*\u2022]\s+", "", line)
        cleaned = re.sub(r"^\d+[\.)]\s+", "", cleaned)
        cleaned = re.sub(r"^[A-C]\.[\s]+", "", cleaned)

        for chunk in _chunk_words(cleaned, max_words):
            segments.append({"speaker": speaker, "line": chunk})

    return segments
