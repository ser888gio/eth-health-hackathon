import re
import logging
from pathlib import Path

import pdfplumber

logger = logging.getLogger(__name__)


def parse_pdf(pdf_path: str = "report.pdf") -> dict:
    path = Path(pdf_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    result = {
        "request_id": None,
        "pipeline": None,
        "panel": None,
        "panel_genes": None,
        "target_regions": None,
        "samples": [],
        "recurrent_low_coverage": [],
    }

    with pdfplumber.open(path) as pdf:
        full_text = "\n".join(page.extract_text() or "" for page in pdf.pages)
        _extract_header(full_text, result)
        _extract_samples(pdf, full_text, result)
        _extract_recurrent_low_coverage(full_text, result)

    return result


def _extract_header(text: str, result: dict) -> None:
    patterns = {
        "request_id": r"Request[:\s]+(\S+)",
        "pipeline": r"Pipeline[:\s]+(\S+)",
        "panel": r"Panel[:\s]+([\w_]+)",
        "panel_genes": r"(\d+)\s+genes?",
        "target_regions": r"([\d,]+)\s+target regions?",
    }
    for key, pattern in patterns.items():
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            val = m.group(1).replace(",", "")
            result[key] = int(val) if key in ("panel_genes", "target_regions") else val


def _extract_samples(pdf: pdfplumber.PDF, full_text: str, result: dict) -> None:
    for page in pdf.pages:
        table = page.extract_table()
        if not table:
            continue
        headers = [str(h).strip().lower() if h else "" for h in table[0]]
        if not any("duplicate" in h or "on-target" in h or "coverage" in h for h in headers):
            continue
        for row in table[1:]:
            if not row or not row[0]:
                continue
            sample = _parse_sample_row(headers, row)
            if sample:
                result["samples"].append(sample)

    if not result["samples"]:
        _extract_samples_from_text(full_text, result)


def _parse_sample_row(headers: list[str], row: list) -> dict | None:
    def get(keywords: list[str]) -> str | None:
        for i, h in enumerate(headers):
            if any(k in h for k in keywords) and i < len(row) and row[i]:
                return str(row[i]).strip()
        return None

    sample_id = get(["sample", "id", "name"])
    if not sample_id or sample_id.lower() in ("sample", "id", "name", ""):
        return None

    def to_float(val: str | None) -> float | None:
        if val is None:
            return None
        try:
            return float(val.replace("%", "").replace(",", "").strip()) / (
                100 if "%" in (val or "") else 1
            )
        except ValueError:
            return None

    def to_int(val: str | None) -> int | None:
        if val is None:
            return None
        try:
            return int(val.replace(",", "").strip())
        except ValueError:
            return None

    dup_raw = get(["duplicate", "pcr dup"])
    on_target_raw = get(["on-target", "on target", "mapping rate"])
    cov_raw = get(["mean coverage", "average coverage", "depth"])
    lcr_raw = get(["low coverage region", "lcr"])
    qc_raw = get(["qc", "status", "pass", "fail"])

    return {
        "id": sample_id,
        "pcr_duplicate_fraction": to_float(dup_raw),
        "on_target_rate": to_float(on_target_raw),
        "mean_coverage": to_float(cov_raw),
        "low_coverage_regions": to_int(lcr_raw),
        "qc_status": (qc_raw or "").upper() or None,
    }


def _extract_samples_from_text(text: str, result: dict) -> None:
    pattern = re.compile(
        r"(\d{9,}-\d+-\w+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d,]+)\s*(PASS|FAIL)?",
        re.IGNORECASE,
    )
    for m in pattern.finditer(text):
        result["samples"].append({
            "id": m.group(1),
            "pcr_duplicate_fraction": float(m.group(2)),
            "on_target_rate": float(m.group(3)),
            "mean_coverage": float(m.group(4)),
            "low_coverage_regions": int(m.group(5).replace(",", "")),
            "qc_status": (m.group(6) or "").upper() or None,
        })


def _extract_recurrent_low_coverage(text: str, result: dict) -> None:
    gene_pattern = re.compile(
        r"(MSH2|MLH1|MSH6|PMS2|BRCA1|BRCA2|TP53|APC|PTEN|RB1)\b.*?"
        r"exon\s*(\d+).*?(Chr\w+:\d+)",
        re.IGNORECASE | re.DOTALL,
    )
    affected_pattern = re.compile(r"(\d+)\s+(?:of\s+)?(?:out of\s+)?\d+\s+samples?", re.IGNORECASE)

    for m in gene_pattern.finditer(text):
        gene = m.group(1).upper()
        exon = int(m.group(2))
        position = m.group(3)
        snippet = text[max(0, m.start() - 200): m.end() + 200]
        affected = None
        am = affected_pattern.search(snippet)
        if am:
            affected = int(am.group(1))

        entry = {"gene": gene, "exon": exon, "position": position, "affected_samples": affected}
        if not any(e["gene"] == gene and e["exon"] == exon for e in result["recurrent_low_coverage"]):
            result["recurrent_low_coverage"].append(entry)


if __name__ == "__main__":
    import json
    import sys

    pdf = sys.argv[1] if len(sys.argv) > 1 else "report.pdf"
    data = parse_pdf(pdf)
    print(json.dumps(data, indent=2))
