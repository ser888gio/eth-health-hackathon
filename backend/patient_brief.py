import argparse
import sys
from pathlib import Path

import pdfplumber

from audio_assembler import assemble
from patient_interpretation import interpret_patient
from sophia_client import SophiaPatientData, fetch_patient_bundle
from speech import text_to_script_segments
from tts import generate_audio
from vqs_client import parse_vqs_curl, run_vqs_query, vqs_response_to_tsv


def _output_paths(output_dir: str, patient_id: str, sample_id: str | None) -> tuple[Path, Path]:
    out = Path(output_dir)
    out.mkdir(exist_ok=True)
    suffix = f"{patient_id}_{sample_id}" if sample_id else patient_id
    summary_path = out / f"summary_{suffix}.txt"
    audio_path = out / f"briefing_{suffix}.mp3"
    return summary_path, audio_path


def _load_curl_file(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def _read_text_file(path: str) -> str:
    return Path(path).read_text(encoding="utf-8", errors="replace")


def _extract_pdf_text(path: str) -> str:
    pdf_path = Path(path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    with pdfplumber.open(pdf_path) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages)


def _find_patient_curl(vqs_curl_dir: str, patient_id: str, kind: str) -> str:
    dir_path = Path(vqs_curl_dir)
    if not dir_path.exists():
        raise FileNotFoundError(f"VQS cURL directory not found: {dir_path}")

    suffixes = ["curl", "txt"]
    patterns = []
    if kind == "variants":
        patterns = [
            f"{patient_id}.curl",
            f"{patient_id}_variants.curl",
            f"{patient_id}.txt",
            f"{patient_id}_variants.txt",
        ]
    elif kind == "coverage":
        patterns = [
            f"{patient_id}_coverage.curl",
            f"{patient_id}_coverage.txt",
            f"{patient_id}_gene.curl",
            f"{patient_id}_gene.txt",
        ]

    for name in patterns:
        candidate = dir_path / name
        if candidate.exists():
            return str(candidate)

    matches = [
        p
        for ext in suffixes
        for p in dir_path.glob(f"*.{ext}")
        if patient_id in p.stem
    ]
    if len(matches) == 1:
        return str(matches[0])
    if len(matches) > 1:
        match_list = ", ".join(m.name for m in matches)
        raise ValueError(
            f"Multiple cURL files match patient '{patient_id}': {match_list}. "
            "Rename to be specific (e.g., PID-SG019-LPA_variants.curl)."
        )

    raise FileNotFoundError(
        f"No cURL file found for patient '{patient_id}' in {dir_path}. "
        "Save the cURL as <PATIENT_ID>_variants.curl."
    )


def _collect_patient_ids(vqs_curl_dir: str) -> list[str]:
    dir_path = Path(vqs_curl_dir)
    if not dir_path.exists():
        raise FileNotFoundError(f"VQS cURL directory not found: {dir_path}")

    ids: set[str] = set()
    for ext in ("*.curl", "*.txt"):
        for path in dir_path.glob(ext):
            stem = path.stem
            for suffix in ("_variants", "_coverage", "_gene"):
                if stem.endswith(suffix):
                    stem = stem[: -len(suffix)]
                    break
            if stem:
                ids.add(stem)
    return sorted(ids)


def _vqs_text_from_curl(curl_file: str, max_rows: int | None = None) -> tuple[str, str]:
    curl_text = _load_curl_file(curl_file)
    request = parse_vqs_curl(curl_text)
    response = run_vqs_query(request)
    text = vqs_response_to_tsv(response, max_rows=max_rows)
    return text, request.url


def run_patient_brief(
    patient_id: str,
    sample_id: str | None,
    output_dir: str,
    vqs_variants_curl: str | None = None,
    vqs_coverage_curl: str | None = None,
    vqs_curl_dir: str | None = None,
    qc_pdf: str | None = None,
    gene_csv: str | None = None,
    variant_pdf: str | None = None,
) -> Path:
    qc_text = ""
    gene_text = ""
    coverage_text = ""
    variants_text = ""
    sources: dict[str, str] = {}

    if qc_pdf:
        qc_text = _extract_pdf_text(qc_pdf)
        sources["qc_pdf"] = qc_pdf

    if gene_csv:
        gene_text = _read_text_file(gene_csv)
        sources["gene_csv"] = gene_csv

    if variant_pdf:
        variants_text = _extract_pdf_text(variant_pdf)
        sources["variant_pdf"] = variant_pdf

    if vqs_curl_dir:
        if not vqs_variants_curl:
            vqs_variants_curl = _find_patient_curl(vqs_curl_dir, patient_id, "variants")
        if not vqs_coverage_curl:
            try:
                vqs_coverage_curl = _find_patient_curl(vqs_curl_dir, patient_id, "coverage")
            except FileNotFoundError:
                vqs_coverage_curl = None

    if vqs_variants_curl and not variants_text:
        variants_text, variants_url = _vqs_text_from_curl(vqs_variants_curl)
        sources["variants_url"] = variants_url
    if vqs_coverage_curl and not coverage_text:
        coverage_text, coverage_url = _vqs_text_from_curl(vqs_coverage_curl)
        sources["coverage_url"] = coverage_url
        if not gene_text:
            gene_text = coverage_text

    if any([qc_text, gene_text, coverage_text, variants_text, vqs_variants_curl, vqs_coverage_curl]):
        data = SophiaPatientData(
            patient_id=patient_id,
            sample_id=sample_id,
            patient_record={
                "source": "file" if any([qc_pdf, gene_csv, variant_pdf]) else "vqs",
                "patient_id": patient_id,
                "sample_id": sample_id,
            },
            qc_text=qc_text or None,
            gene_text=gene_text or None,
            coverage_text=coverage_text or None,
            variants_text=variants_text or None,
            sources=sources,
        )
    else:
        data = fetch_patient_bundle(patient_id=patient_id, sample_id=sample_id)
    summary = interpret_patient(data)

    summary_path, audio_path = _output_paths(output_dir, patient_id, sample_id)
    summary_path.write_text(summary, encoding="utf-8")

    script = text_to_script_segments(summary)
    line_paths = generate_audio(script, output_dir=output_dir)
    assemble(line_paths, audio_path)

    return audio_path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate a SOPHiA Pathologist patient summary and audio briefing."
    )
    parser.add_argument("patient_id", nargs="?", help="Patient identifier (e.g., PID-SG019-LPA)")
    parser.add_argument("--sample-id", help="Optional sample identifier")
    parser.add_argument("--output-dir", default="output", help="Output directory")
    parser.add_argument(
        "--vqs-curl-file",
        help="Path to a VQS cURL (variants table). Uses VQS instead of SOPHiA exports.",
    )
    parser.add_argument(
        "--vqs-curl-dir",
        help="Directory with per-patient VQS cURL files (e.g., PID-SG019-LPA_variants.curl).",
    )
    parser.add_argument(
        "--patients",
        help="Comma-separated patient IDs to process (uses --vqs-curl-dir if set).",
    )
    parser.add_argument(
        "--list-patients",
        action="store_true",
        help="List patient IDs found in --vqs-curl-dir and exit.",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Process all patient IDs found in --vqs-curl-dir.",
    )
    parser.add_argument(
        "--vqs-variants-curl-file",
        help="Path to a VQS cURL for the variants table.",
    )
    parser.add_argument(
        "--vqs-coverage-curl-file",
        help="Path to a VQS cURL for coverage or gene table.",
    )
    parser.add_argument("--qc-pdf", help="Path to QC report PDF for this patient.")
    parser.add_argument("--gene-csv", help="Path to gene table CSV export.")
    parser.add_argument("--variant-pdf", help="Path to variant table PDF export.")
    args = parser.parse_args()

    if args.list_patients:
        if not args.vqs_curl_dir:
            print("Error: --list-patients requires --vqs-curl-dir", file=sys.stderr)
            sys.exit(1)
        for pid in _collect_patient_ids(args.vqs_curl_dir):
            print(pid)
        return

    if args.all:
        if not args.vqs_curl_dir:
            print("Error: --all requires --vqs-curl-dir", file=sys.stderr)
            sys.exit(1)
        patient_ids = _collect_patient_ids(args.vqs_curl_dir)
        if not patient_ids:
            print("Error: no patients found in --vqs-curl-dir", file=sys.stderr)
            sys.exit(1)
    elif args.patients:
        patient_ids = [p.strip() for p in args.patients.split(",") if p.strip()]
    elif args.patient_id:
        patient_ids = [args.patient_id]
    else:
        print("Error: patient_id is required unless using --patients or --list-patients", file=sys.stderr)
        sys.exit(1)

    if len(patient_ids) > 1 and args.sample_id:
        print("Error: --sample-id can only be used with a single patient", file=sys.stderr)
        sys.exit(1)

    vqs_variants = args.vqs_variants_curl_file or args.vqs_curl_file
    for pid in patient_ids:
        out = run_patient_brief(
            pid,
            args.sample_id,
            args.output_dir,
            vqs_variants_curl=vqs_variants,
            vqs_coverage_curl=args.vqs_coverage_curl_file,
            vqs_curl_dir=args.vqs_curl_dir,
            qc_pdf=args.qc_pdf,
            gene_csv=args.gene_csv,
            variant_pdf=args.variant_pdf,
        )
        print(f"Done. Play: {out.resolve()}")


if __name__ == "__main__":
    main()
