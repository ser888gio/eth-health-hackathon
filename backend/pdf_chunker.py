"""
PDF -> Parse -> Chunk -> Embed -> JSON

4-step pipeline:
  1. Parse:  Extract structured data per sample from PDF (patient_id, coverage, QC, etc.)
  2. Chunk:  Convert structured data into text chunks + chunk free-text sections
  3. Embed:  Vectorize each chunk using sentence-transformers/all-mpnet-base-v2
  4. Save:   Write chunks_embedded.json -> send to teammate -> teammate loads into vector DB
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pdfplumber


# ==============================================================================
# STEP 1: PARSE
# Extract structured data from PDF organized by sample.
# ==============================================================================

def parse_pdf(pdf_path: str) -> dict:
    """
    Extract structured data from one PDF report.

    Returns:
    {
      "patient_id": "50004-000001",
      "pipeline":   "ILL1XG1G4_CNV_NextSeq_7",  # analysis pipeline used
      "panel":      "BRCA_panel",                # gene panel used
      "samples": [
        {
          "sample_number": 1,          # assigned index (1, 2, 3, ...)
          "id": "50004-000001-S1",
          "mean_coverage": 312.0,
          "on_target_rate": 0.942,
          "pcr_duplicate_fraction": 0.05,
          "qc_status": "PASS",
          "low_coverage_region_count": 3
        }
      ],
      "low_coverage_regions": [
        {
          "gene": "BRCA2",
          "exon": 11,
          "position": "chr13:32906408",
          "coverage": 18,
          "status": "LOW",
          "affected_samples": 2
        }
      ]
    }
    """
    path = Path(pdf_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    result: dict[str, Any] = {
        "patient_id":          path.stem,   # fallback: filename without extension
        "source_file":         path.name,
        "pipeline":            None,        # filled by _parse_header if found in PDF
        "panel":               None,        # filled by _parse_header if found in PDF
        "samples":             [],          # list of sample dicts (one patient can have multiple)
        "low_coverage_regions": [],
    }

    with pdfplumber.open(path) as pdf:
        full_text = "\n".join(p.extract_text() or "" for p in pdf.pages)
        _parse_header(full_text, result)
        _parse_samples(pdf, full_text, result)
        _parse_low_coverage(full_text, result)

    # Assign sequential sample numbers so RAG can answer "what is sample 2's coverage?"
    for idx, sample in enumerate(result["samples"], start=1):
        sample["sample_number"] = idx

    return result


def _parse_header(text: str, result: dict) -> None:
    """Extract patient_id, pipeline name, panel name from the report header."""
    patterns = {
        "patient_id": r"(?:Patient|Request|Case)\s*(?:ID|#)?[:\s]+(\S+)",
        "pipeline":   r"Pipeline[:\s]+(\S+)",
        "panel":      r"Panel[:\s]+([\w_\-]+)",
    }
    for key, pattern in patterns.items():
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            result[key] = m.group(1)


def _parse_samples(pdf: pdfplumber.PDF, full_text: str, result: dict) -> None:
    """
    Extract per-sample QC metrics.
    Priority: structured table extraction -> regex text fallback.
    """
    for page in pdf.pages:
        table = page.extract_table()
        if not table:
            continue
        headers = [str(h or "").strip().lower() for h in table[0]]
        if not any(k in h for h in headers for k in ("coverage", "duplicate", "on-target", "qc")):
            continue
        for row in table[1:]:
            if not row or not row[0]:
                continue
            sample = _parse_sample_row(headers, row)
            if sample:
                result["samples"].append(sample)

    # Fallback: parse metrics from raw text if no table was found
    if not result["samples"]:
        pattern = re.compile(
            r"(\S+-\S+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d,]+)\s*(PASS|FAIL)?",
            re.IGNORECASE,
        )
        for m in pattern.finditer(full_text):
            result["samples"].append({
                "id":                      m.group(1),
                "pcr_duplicate_fraction":  float(m.group(2)),
                "on_target_rate":          float(m.group(3)),
                "mean_coverage":           float(m.group(4)),
                "low_coverage_region_count": int(m.group(5).replace(",", "")),
                "qc_status":               (m.group(6) or "").upper() or None,
            })


def _parse_sample_row(headers: list[str], row: list) -> dict | None:
    """Parse one table row into a sample dict."""
    def get(keywords: list[str]) -> str | None:
        for i, h in enumerate(headers):
            if any(k in h for k in keywords) and i < len(row) and row[i]:
                return str(row[i]).strip()
        return None

    def to_float(v: str | None) -> float | None:
        if not v:
            return None
        try:
            return float(v.replace("%", "").replace(",", "")) / (100 if "%" in v else 1)
        except ValueError:
            return None

    sample_id = get(["sample", "id", "name"])
    if not sample_id or sample_id.lower() in ("sample", "id", "name"):
        return None

    return {
        "id":                      sample_id,
        "mean_coverage":           to_float(get(["mean coverage", "average coverage", "depth"])),
        "on_target_rate":          to_float(get(["on-target", "on target", "mapping"])),
        "pcr_duplicate_fraction":  to_float(get(["duplicate", "pcr dup"])),
        "low_coverage_region_count": _to_int(get(["low coverage region", "lcr"])),
        "qc_status":               (get(["qc", "status", "pass", "fail"]) or "").upper() or None,
    }


def _to_int(v: str | None) -> int | None:
    if not v:
        return None
    try:
        return int(v.replace(",", ""))
    except ValueError:
        return None


def _parse_low_coverage(text: str, result: dict) -> None:
    """Extract low coverage region entries (gene, exon, position, coverage depth)."""
    gene_re = re.compile(
        r"(MSH2|MLH1|MSH6|PMS2|BRCA1|BRCA2|TP53|APC|PTEN|RB1|CDH1|PALB2|CHEK2|ATM)\b"
        r".{0,100}?exon\s*(\d+).{0,100}?(chr[\w:]+)",
        re.IGNORECASE | re.DOTALL,
    )
    cov_re = re.compile(r"(\d+)\s*x?\b", re.IGNORECASE)
    aff_re = re.compile(r"(\d+)\s+(?:of|out of)\s+\d+\s+samples?", re.IGNORECASE)

    for m in gene_re.finditer(text):
        gene = m.group(1).upper()
        exon = int(m.group(2))

        # Skip duplicates
        if any(r["gene"] == gene and r["exon"] == exon for r in result["low_coverage_regions"]):
            continue

        snippet = text[max(0, m.start() - 100): m.end() + 200]
        coverage = None
        cm = cov_re.search(snippet)
        if cm:
            coverage = int(cm.group(1))

        affected = None
        am = aff_re.search(snippet)
        if am:
            affected = int(am.group(1))

        result["low_coverage_regions"].append({
            "gene":             gene,
            "exon":             exon,
            "position":         m.group(3),
            "coverage":         coverage,
            "status":           "LOW" if (coverage and coverage < 20) else "REDUCED",
            "affected_samples": affected,
        })


# ==============================================================================
# STEP 2: CHUNK
# Convert parsed structured data into text chunks for RAG retrieval.
# Each chunk includes patient_id so the vector DB can filter by patient.
# ==============================================================================

def make_chunks(parsed: dict) -> list[dict]:
    """
    Convert parsed report dict into a list of text chunks.

    Chunk types:
      "report_header"    - pipeline / panel metadata (1 per PDF)
      "sample_summary"   - QC metrics per sample (1 chunk per sample)
      "low_coverage_row" - one low coverage region entry (1 chunk per gene/exon)
    """
    chunks: list[dict] = []
    pid = parsed["patient_id"]
    src = parsed["source_file"]

    # Report header chunk
    header_parts = [f"Patient ID: {pid}"]
    if parsed.get("pipeline"):
        header_parts.append(f"Pipeline: {parsed['pipeline']}")
    if parsed.get("panel"):
        header_parts.append(f"Panel: {parsed['panel']}")
    chunks.append(_chunk(
        patient_id=pid, source_file=src,
        section="Report Header", chunk_type="report_header",
        text=". ".join(header_parts) + ".",
    ))

    # One chunk per sample — enables precise answers like "what is sample 2's coverage?"
    for sample in parsed["samples"]:
        num = sample.get("sample_number", "?")
        sid = sample.get("id", "unknown")
        parts = [f"Patient {pid} Sample #{num} (ID: {sid})"]
        if sample.get("mean_coverage") is not None:
            parts.append(f"mean coverage {sample['mean_coverage']:.0f}x")
        if sample.get("on_target_rate") is not None:
            parts.append(f"on-target rate {sample['on_target_rate']*100:.1f}%")
        if sample.get("pcr_duplicate_fraction") is not None:
            parts.append(f"PCR duplicate fraction {sample['pcr_duplicate_fraction']*100:.1f}%")
        if sample.get("low_coverage_region_count") is not None:
            parts.append(f"low coverage region count {sample['low_coverage_region_count']}")
        if sample.get("qc_status"):
            parts.append(f"QC status {sample['qc_status']}")
        chunks.append(_chunk(
            patient_id=pid, source_file=src,
            section="Sample Quality Summary", chunk_type="sample_summary",
            text=". ".join(parts) + ".",
            sample_number=num, sample_id=sid,
        ))

    # One chunk per low coverage region row — enables "which genes have low coverage?" queries
    for region in parsed["low_coverage_regions"]:
        parts = [
            f"Patient {pid} low coverage region",
            f"Gene: {region['gene']}",
            f"Exon: {region['exon']}",
            f"Position: {region['position']}",
        ]
        if region.get("coverage") is not None:
            parts.append(f"Coverage: {region['coverage']}x")
        if region.get("status"):
            parts.append(f"Status: {region['status']}")
        if region.get("affected_samples") is not None:
            parts.append(f"Affected samples: {region['affected_samples']}")
        chunks.append(_chunk(
            patient_id=pid, source_file=src,
            section="Low Coverage Regions", chunk_type="low_coverage_row",
            text=" | ".join(parts),
            gene=region["gene"], exon=region["exon"],
        ))

    return chunks


def _chunk(patient_id: str, source_file: str, section: str,
           chunk_type: str, text: str, **extra) -> dict:
    return {
        "patient_id":  patient_id,
        "source_file": source_file,
        "section":     section,
        "chunk_type":  chunk_type,
        "text":        text.strip(),
        **extra,
        "embedding":   None,   # filled in Step 3
    }


# ==============================================================================
# STEP 3: EMBED
# Vectorize each chunk's text using sentence-transformers/all-mpnet-base-v2.
# Model produces 768-dimensional vectors.
# Downloaded once (~420MB), then cached at ~/.cache/huggingface/
# ==============================================================================

def embed_chunks(chunks: list[dict]) -> list[dict]:
    """
    Add a 768-dim float vector to each chunk's "embedding" field.
    The teammate reads this field and loads it directly into the vector DB.
    """
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        import subprocess, sys
        subprocess.check_call([sys.executable, "-m", "pip", "install", "sentence-transformers"])
        from sentence_transformers import SentenceTransformer

    # Load model once — reused across all chunks in this run
    model = SentenceTransformer("sentence-transformers/all-mpnet-base-v2")

    texts = [c["text"] for c in chunks]
    vectors = model.encode(texts, batch_size=32, show_progress_bar=True)

    for chunk, vector in zip(chunks, vectors):
        chunk["embedding"] = vector.tolist()   # numpy array -> plain list for JSON

    return chunks


# ==============================================================================
# STEP 4: PIPELINE
# ==============================================================================

def process_pdf(pdf_path: str) -> list[dict]:
    """Parse -> chunk -> embed one PDF. Returns list of embedded chunks."""
    print(f"\n[1/3] Parsing: {pdf_path}")
    parsed = parse_pdf(pdf_path)
    print(f"      {len(parsed['samples'])} samples, {len(parsed['low_coverage_regions'])} low coverage regions")

    print(f"[2/3] Chunking")
    chunks = make_chunks(parsed)
    print(f"      {len(chunks)} chunks created")

    print(f"[3/3] Embedding")
    chunks = embed_chunks(chunks)

    return chunks


def process_folder(folder_path: str, output_json: str = "chunks_embedded.json") -> None:
    """Process all PDFs in a folder and write one combined JSON file."""
    folder = Path(folder_path)
    pdf_files = sorted(folder.glob("*.pdf"))

    if not pdf_files:
        print(f"No PDF files found in: {folder_path}")
        return

    all_chunks: list[dict] = []
    for pdf_file in pdf_files:
        chunks = process_pdf(str(pdf_file))
        all_chunks.extend(chunks)

    out = Path(output_json)
    out.write_text(json.dumps(all_chunks, indent=2, ensure_ascii=False))

    print(f"\nDone. {len(all_chunks)} total chunks from {len(pdf_files)} PDFs.")
    print(f"Saved: {out.resolve()}")
    print(f"Send '{output_json}' to teammate -> they load embeddings into vector DB.")


# ==============================================================================
# CLI
# ==============================================================================

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage:")
        print("  python pdf_chunker.py report.pdf            # single file")
        print("  python pdf_chunker.py reports/              # whole folder")
        print("  python pdf_chunker.py reports/ output.json  # custom output name")
        sys.exit(1)

    target = sys.argv[1]
    output = sys.argv[2] if len(sys.argv) > 2 else "chunks_embedded.json"

    if Path(target).is_dir():
        process_folder(target, output)
    else:
        result = process_pdf(target)
        Path(output).write_text(json.dumps(result, indent=2, ensure_ascii=False))
        print(f"\n{len(result)} chunks -> {output}")
