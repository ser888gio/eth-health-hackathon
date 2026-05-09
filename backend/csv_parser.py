import csv
import io
import json
import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

HEADER_ALIASES = {
    "request_id": ["request_id", "request", "req_id", "requestid"],
    "pipeline": ["pipeline"],
    "panel": ["panel"],
    "panel_genes": ["panel_genes", "gene_count", "genes", "panel_gene_count"],
    "target_regions": ["target_regions", "target_region_count", "targets", "regions"],
}

SAMPLE_ID_KW = ["sample", "sample_id", "sampleid", "id", "name"]
PCR_DUP_KW = ["duplicate", "pcr_dup", "pcr_duplicate", "dup_rate", "dup_fraction"]
ON_TARGET_KW = ["on_target", "ontarget", "mapping_rate", "on_target_rate"]
COVERAGE_KW = ["mean_coverage", "avg_coverage", "average_coverage", "coverage", "depth"]
LOW_COV_KW = ["low_coverage", "low_cov", "lcr", "low_coverage_regions", "low_cov_regions"]
QC_KW = ["qc", "status", "pass", "fail"]

GENE_KW = ["gene"]
EXON_KW = ["exon"]
POSITION_KW = ["position", "locus", "region", "chr", "chromosome"]
AFFECTED_KW = ["affected_samples", "affected", "samples_affected", "n_affected", "affected_count"]

SECTION_KW = ["section", "table", "type"]
VARIANT_SAMPLE_KW = ["sample", "patient", "sample_id", "sampleid", "id", "name"]


def parse_csv(csv_path: str = "report.csv") -> dict:
    path = Path(csv_path)
    if not path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    result = {
        "request_id": None,
        "pipeline": None,
        "panel": None,
        "panel_genes": None,
        "target_regions": None,
        "samples": [],
        "recurrent_low_coverage": [],
    }

    rows = _read_csv_rows(path)
    if not rows:
        return result

    headers = [_norm(h) for h in rows[0]]
    variant_header_idx = _find_table_header(rows, _looks_like_variant_header)

    if _has_section_column(headers):
        _parse_sectioned(rows, result)

    _extract_header_kv(rows, result)

    if variant_header_idx is not None:
        if not result["samples"]:
            _extract_samples_from_variant_table(rows, result, variant_header_idx)
        return result

    if not result["samples"]:
        _extract_samples_from_tables(rows, result)

    if not result["recurrent_low_coverage"]:
        _extract_recurrent_from_tables(rows, result)

    return result


def _read_csv_rows(path: Path) -> list[list[str]]:
    text = path.read_text(encoding="utf-8-sig")
    rows = _read_delimited_rows(text)
    if rows and _mostly_single_column(rows) and _looks_like_whitespace_table(text):
        return _read_whitespace_rows(text)
    return rows


def _read_delimited_rows(text: str) -> list[list[str]]:
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    return [[cell.strip() for cell in row] for row in reader if any(cell.strip() for cell in row)]


def _mostly_single_column(rows: list[list[str]]) -> bool:
    if not rows:
        return False
    single = sum(1 for row in rows if len(row) <= 1)
    return single / len(rows) >= 0.8


def _looks_like_whitespace_table(text: str) -> bool:
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return False
    wide_lines = sum(1 for line in lines if re.search(r"\S\s{2,}\S", line))
    return wide_lines / len(lines) >= 0.2


def _read_whitespace_rows(text: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        row = _split_whitespace_line(line)
        if row:
            rows.append(row)
    return _normalize_whitespace_rows(rows)


def _split_whitespace_line(line: str) -> list[str]:
    parts = re.split(r"\s{2,}", line.strip())
    return [part.strip() for part in parts if part.strip()]


def _normalize_whitespace_rows(rows: list[list[str]]) -> list[list[str]]:
    normalized: list[list[str]] = []
    pending = ["", ""]
    for row in rows:
        if _looks_like_orphan_line(row):
            continue
        if _is_hyphen_fragment(row):
            pending = _merge_pending(pending, row)
            continue
        if any(pending):
            row = _apply_pending(pending, row)
            pending = ["", ""]
        normalized.append(row)
    return normalized


def _looks_like_orphan_line(row: list[str]) -> bool:
    if len(row) != 1:
        return False
    token = row[0]
    return token.startswith("NP_") or token.endswith(":p.")


def _is_hyphen_fragment(row: list[str]) -> bool:
    if len(row) > 2:
        return False
    return all(token.endswith("-") for token in row if token)


def _merge_pending(pending: list[str], row: list[str]) -> list[str]:
    for i, token in enumerate(row[:2]):
        pending[i] += token
    return pending


def _apply_pending(pending: list[str], row: list[str]) -> list[str]:
    if pending[0] and row:
        row[0] = pending[0] + row[0]
    if pending[1]:
        if len(row) > 1:
            row[1] = pending[1] + row[1]
        else:
            row.append(pending[1])
    return row


def _norm(value: str) -> str:
    return re.sub(r"[^a-z0-9_]+", "_", (value or "").strip().lower()).strip("_")


def _has_section_column(headers: list[str]) -> bool:
    return any(h in SECTION_KW for h in headers)


def _section_value(row_dict: dict) -> str:
    for key in SECTION_KW:
        if key in row_dict and row_dict[key]:
            return _norm(row_dict[key])
    return ""


def _parse_sectioned(rows: list[list[str]], result: dict) -> None:
    headers = [_norm(h) for h in rows[0]]
    for row in rows[1:]:
        row_dict = {headers[i]: row[i].strip() if i < len(row) else "" for i in range(len(headers))}
        section = _section_value(row_dict)

        _apply_header_from_row(row_dict, result)

        if section in ("sample", "samples", "qc_samples"):
            sample = _parse_sample_row(headers, row)
            if sample:
                result["samples"].append(sample)
        elif section in ("recurrent_low_coverage", "low_coverage", "recurrent"):
            entry = _parse_recurrent_row(headers, row)
            if entry and not _has_recurrent(result, entry):
                result["recurrent_low_coverage"].append(entry)


def _apply_header_from_row(row_dict: dict, result: dict) -> None:
    for key, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            if alias in row_dict and row_dict[alias]:
                raw = row_dict[alias]
                result[key] = _to_int(raw) if key in ("panel_genes", "target_regions") else raw
                break


def _extract_header_kv(rows: list[list[str]], result: dict) -> None:
    for row in rows:
        if len(row) < 2:
            continue
        key = _norm(row[0])
        val = (row[1] or "").strip()
        if not val:
            continue
        for target, aliases in HEADER_ALIASES.items():
            if key in aliases:
                result[target] = _to_int(val) if target in ("panel_genes", "target_regions") else val
                break


def _extract_samples_from_tables(rows: list[list[str]], result: dict) -> None:
    header_idx = _find_table_header(
        rows,
        lambda headers: _looks_like_sample_header(headers) and not _looks_like_variant_header(headers),
    )
    if header_idx is None:
        return

    headers = [_norm(h) for h in rows[header_idx]]
    for row in rows[header_idx + 1:]:
        row_headers = [_norm(c) for c in row]
        if _looks_like_recurrent_header(row_headers):
            break
        if _looks_like_sample_header(row_headers):
            continue
        sample = _parse_sample_row(headers, row)
        if sample:
            result["samples"].append(sample)


def _extract_recurrent_from_tables(rows: list[list[str]], result: dict) -> None:
    header_idx = _find_table_header(
        rows,
        lambda headers: _looks_like_recurrent_header(headers) and not _looks_like_variant_header(headers),
    )
    if header_idx is None:
        return

    headers = [_norm(h) for h in rows[header_idx]]
    for row in rows[header_idx + 1:]:
        row_headers = [_norm(c) for c in row]
        if _looks_like_sample_header(row_headers):
            break
        if _looks_like_recurrent_header(row_headers):
            continue
        entry = _parse_recurrent_row(headers, row)
        if entry and not _has_recurrent(result, entry):
            result["recurrent_low_coverage"].append(entry)


def _find_table_header(rows: list[list[str]], predicate) -> int | None:
    for idx, row in enumerate(rows):
        headers = [_norm(h) for h in row]
        if predicate(headers):
            return idx
    return None


def _find_col_index(headers: list[str], keywords: list[str]) -> int | None:
    for i, h in enumerate(headers):
        if any(k in h for k in keywords):
            return i
    return None


def _looks_like_sample_header(headers: list[str]) -> bool:
    has_sample = any("sample" in h or h in ("id", "name") for h in headers)
    has_metrics = any(
        any(k in h for k in ("duplicate", "on_target", "coverage", "depth", "mapping"))
        for h in headers
    )
    return has_sample and has_metrics


def _looks_like_recurrent_header(headers: list[str]) -> bool:
    has_gene = any("gene" in h for h in headers)
    has_exon = any("exon" in h for h in headers)
    has_support = any(
        any(k in h for k in POSITION_KW + AFFECTED_KW)
        for h in headers
    )
    return has_gene and has_exon and has_support


def _looks_like_variant_header(headers: list[str]) -> bool:
    has_gene = any("gene" in h for h in headers)
    has_variant = any(
        k in h
        for h in headers
        for k in ("transcript", "protein_hgvs", "c_dna", "coding_consequence", "clinvar", "hgvs")
    )
    has_freq = any(k in h for h in headers for k in ("vaf", "read_depth", "depth"))
    has_sample = any("sample" in h or "patient" in h for h in headers)
    return has_gene and has_variant and has_freq and has_sample


def _extract_samples_from_variant_table(
    rows: list[list[str]],
    result: dict,
    header_idx: int,
) -> None:
    headers = [_norm(h) for h in rows[header_idx]]
    sample_idx = _find_col_index(headers, VARIANT_SAMPLE_KW)
    depth_idx = _find_col_index(headers, ["read_depth", "depth", "coverage"])

    if sample_idx is None:
        return

    aggregates: dict[str, dict] = {}
    for row in rows[header_idx + 1:]:
        if sample_idx >= len(row):
            continue
        sample_id = (row[sample_idx] or "").strip()
        if not sample_id:
            continue

        entry = aggregates.setdefault(
            sample_id,
            {
                "id": sample_id,
                "pcr_duplicate_fraction": None,
                "on_target_rate": None,
                "mean_coverage": None,
                "low_coverage_regions": None,
                "qc_status": None,
                "_depth_total": 0.0,
                "_depth_count": 0,
            },
        )

        if depth_idx is not None and depth_idx < len(row):
            depth_val = _to_float(row[depth_idx])
            if depth_val is not None:
                entry["_depth_total"] += depth_val
                entry["_depth_count"] += 1

    for entry in aggregates.values():
        if entry["_depth_count"] > 0:
            entry["mean_coverage"] = entry["_depth_total"] / entry["_depth_count"]
        entry.pop("_depth_total", None)
        entry.pop("_depth_count", None)
        result["samples"].append(entry)


def _parse_sample_row(headers: list[str], row: list) -> dict | None:
    def get(keywords: list[str]) -> str | None:
        for i, h in enumerate(headers):
            if any(k in h for k in keywords) and i < len(row) and row[i]:
                return str(row[i]).strip()
        return None

    sample_id = get(SAMPLE_ID_KW)
    if not sample_id or sample_id.lower() in ("sample", "id", "name", ""):
        return None

    dup_raw = get(PCR_DUP_KW)
    on_target_raw = get(ON_TARGET_KW)
    cov_raw = get(COVERAGE_KW)
    lcr_raw = get(LOW_COV_KW)
    qc_raw = get(QC_KW)

    return {
        "id": sample_id,
        "pcr_duplicate_fraction": _to_float(dup_raw),
        "on_target_rate": _to_float(on_target_raw),
        "mean_coverage": _to_float(cov_raw),
        "low_coverage_regions": _to_int(lcr_raw),
        "qc_status": (qc_raw or "").upper() or None,
    }


def _parse_recurrent_row(headers: list[str], row: list) -> dict | None:
    def get(keywords: list[str]) -> str | None:
        for i, h in enumerate(headers):
            if any(k in h for k in keywords) and i < len(row) and row[i]:
                return str(row[i]).strip()
        return None

    gene = get(GENE_KW)
    if not gene or gene.lower() == "gene":
        return None

    exon_raw = get(EXON_KW)
    position = get(POSITION_KW)
    affected_raw = get(AFFECTED_KW)

    exon = _to_int(exon_raw)
    entry = {
        "gene": gene.upper(),
        "exon": exon,
        "position": position,
        "affected_samples": _to_int(affected_raw),
    }
    return entry if entry["exon"] is not None else None


def _has_recurrent(result: dict, entry: dict) -> bool:
    return any(e["gene"] == entry["gene"] and e["exon"] == entry["exon"] for e in result["recurrent_low_coverage"])


def _to_float(val: str | None) -> float | None:
    if val is None:
        return None
    try:
        cleaned = val.replace(",", "").strip()
        if cleaned.endswith("%"):
            return float(cleaned.rstrip("%")) / 100
        return float(cleaned)
    except ValueError:
        return None


def _to_int(val: str | None) -> int | None:
    if val is None:
        return None
    try:
        return int(str(val).replace(",", "").strip())
    except ValueError:
        return None


if __name__ == "__main__":
    import sys

    csv_path = sys.argv[1] if len(sys.argv) > 1 else "report.csv"
    data = parse_csv(csv_path)
    print(json.dumps(data, indent=2))
