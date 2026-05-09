## Goal

Today the summary panel shows aggregate stats across all uploaded files. Based on the example pathologist workflow you pasted (one quality report + one variant table + one coverage file ⇒ one patient briefing), the panel should be reorganised so the pathologist works **patient by patient**, each with their own QC, variants, coverage flags, and recommended next actions.

## What changes

### 1. Group uploaded files into patients

Add a `derivePatients()` helper in `src/lib/patients.ts`:

- Extract a stable patient ID from each filename (e.g. `PID-SG019-LPA` from `PID-SG019-LPA_variant_table_export_2.txt`). Fall back to the filename stem when no recognisable ID is present.
- Classify each file by role from its name + extension:
  - **Quality report** → `report*.pdf`, `*qc*`, `*quality*`
  - **Variant table** → `*variant*`, `.vcf`
  - **Coverage** → `*coverage*`, `*cov*`
  - **Other** → everything else
- Return `Patient[] = { id, files: { qc, variants, coverage, other }, fileCount, totalBytes }`.

No file parsing yet — just classification by name. Real parsing comes later when the RAG backend is wired.

### 2. New three-mode `SummaryPanel` layout

Header keeps the DNA spinner + title. Below it, a small segmented control:

```text
[ Overview ] [ Patients (N) ]
```

**Overview mode** (default when no patient selected)

- The current cohort stats (Files / Patients / Data types / Size).
- The triage queue (Urgent / Priority / Routine) — clicking a patient pill jumps to that patient's detail view.
- Data composition bars + extension chips (kept from the current panel).

**Patients mode** — split into a left rail + right detail:

```text
┌──────────────┬────────────────────────────┐
│ Patient list │ Patient detail             │
│ • PID-SG019  │ ─ QC summary               │
│ • PID-SG020  │ ─ Key variants             │
│ • …          │ ─ Coverage flags           │
│              │ ─ Pathologist next actions │
└──────────────┴────────────────────────────┘
```

Patient list rows show: patient ID, triage badge (Urgent/Priority/Routine), file-role chips (QC ✓ / Variants ✓ / Coverage ✓ / missing greyed out).

### 3. Patient detail view

Stacked sections for the active patient:

1. **Header** — patient ID, triage badge, total files + size, "View files" expander.
2. **Sequencing QC** — a small grid of metrics. Until the report is parsed, show placeholders sourced from the QC file's presence (`Mean coverage —`, `% targets ≥50× —`, `Mapped reads —`, `Low-coverage regions —`) with a "Parse report" call-to-action that will later trigger backend parsing.
3. **Key variants** — table with columns: Gene · HGVS · Consequence · ACMG · ClinVar · VAF · Depth. Empty state: "No variant table parsed yet" with the variant filename listed.
4. **Coverage flags** — list of any low-coverage regions. Empty state when no coverage file is attached.
5. **Pathologist checklist** — actionable to-dos derived from the example you pasted (each item is a checkbox stored locally per patient):
   - Confirm top variant in IGV (read-level evidence).
   - Verify sample type (germline vs tumour).
   - Order orthogonal confirmation if pathogenic/likely pathogenic.
   - Run / review CNV / LOH at top variant locus.
   - Document ACMG evidence codes.
   - Notify treating clinician + refer to genetics if germline LP/P.
   - Peer review / sign-out.
6. **Suggested report language** — collapsible block with templated wording the pathologist can copy. Variables left as `{{gene}}`, `{{cDNA}}`, etc. until parsing is wired.

The chat panel on the right stays as-is; selecting a patient on the left will also send the patient ID into the chat context (passed as a prop to `ChatPanel` so the RAG can scope its answers).

### 4. Triage rule update

Triage is currently random per filename stem. Update the rule so it uses the file roles we now know:

- **Urgent** → patient has a variant table **and** a QC report (ready for sign-out).
- **Priority** → has a variant table but missing QC or coverage.
- **Routine** → only ancillary files so far.

This gives the pathologist a real reason to look at the order, instead of a hash bucket.

### 5. Wire patient selection into the chat

`ChatPanel` already has a `threadId`. Add an optional `activePatientId` prop. When set, prepend a small chip above the input ("Asking about PID-SG019-LPA · clear") so the pathologist knows the chat is scoped. The actual scoping will be enforced by the backend prompt later.

## Files touched

- **new** `src/lib/patients.ts` — `derivePatients`, `classifyFile`, types.
- `src/components/SummaryPanel.tsx` — rewritten around Overview / Patients modes, patient list, patient detail.
- **new** `src/components/PatientDetail.tsx` — the per-patient sections (QC, variants, coverage, checklist, report template).
- **new** `src/components/PatientChecklist.tsx` — checkbox list with per-patient localStorage persistence.
- `src/components/ChatPanel.tsx` — optional `activePatientId` prop + scope chip.
- `src/routes/analyze.tsx` — track `activePatientId` and pass to both panels.

## Out of scope for this plan

- Parsing the actual PDF/CSV/TXT files. The detail view is structured to receive parsed data, but populates from filenames + placeholders until the RAG backend is connected.
- Persisting checklist state to a database (localStorage for now, same as threads).
- Real ACMG classification or IGV deep links.
