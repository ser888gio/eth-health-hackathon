import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import { Activity, AlertTriangle, Users } from "lucide-react";
import { DnaSpinner } from "@/components/DnaSpinner";
import { PatientDetail } from "@/components/PatientDetail";
import type { UploadedFile } from "@/lib/uploads";
import type { Patient, Triage } from "@/lib/patients";
import { ragListPatients } from "@/lib/rag/client.functions";
import { cn } from "@/lib/utils";

const SUMMARY_MD = `
**Cohort overview:** Retrieval-augmented analysis across the uploaded genomics files for hereditary cancer predisposition.

### Key findings
- **BRCA1 / BRCA2:** pathogenic variants flagged with VUS pending reclassification.
- **Lynch syndrome panel** (MLH1, MSH2, MSH6, PMS2): likely pathogenic variants and MSI signal.
- **TP53 (Li-Fraumeni):** germline pathogenic variants — early surveillance recommended.

> Switch to **Patients** above to triage individual cases.
`;

const TRIAGE_TONE: Record<Triage, string> = {
  Urgent: "bg-destructive",
  Priority: "bg-amber-500",
  Routine: "bg-emerald-500",
};

export function SummaryPanel({
  files = [],
  activePatientId,
  onSelectPatient,
}: {
  files?: UploadedFile[];
  activePatientId?: string | null;
  onSelectPatient?: (id: string | null) => void;
}) {
  const listPatients = useServerFn(ragListPatients);
  const { data: patients = [] } = useQuery<Patient[]>({
    queryKey: ["rag-patients", files.map((f) => f.id).sort().join(",")],
    queryFn: () => listPatients({ data: { files } }),
    enabled: files.length > 0,
    staleTime: 30_000,
  });
  const hasRealPatients = patients.some((p) => !p.isExample);
  const showExampleNote = patients.length > 0 && !hasRealPatients;
  const [mode, setMode] = useState<"overview" | "patients">("overview");

  // If a patient is externally selected, jump to patients mode.
  useEffect(() => {
    if (activePatientId) setMode("patients");
  }, [activePatientId]);

  const activePatient =
    patients.find((p) => p.id === activePatientId) ?? patients[0] ?? null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b px-6 py-5">
        <DnaSpinner className="size-10 text-primary" />
        <div className="flex-1">
          <h1 className="font-semibold text-lg leading-tight">
            Hereditary Cancer Solutions
          </h1>
          <p className="text-muted-foreground text-xs">
            Genomic intelligence summary
          </p>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1 border-b px-6 py-3">
        <ModeButton
          active={mode === "overview"}
          onClick={() => {
            setMode("overview");
            onSelectPatient?.(null);
          }}
        >
          Overview
        </ModeButton>
        <ModeButton
          active={mode === "patients"}
          onClick={() => setMode("patients")}
          disabled={patients.length === 0}
        >
          Patients ({patients.length})
        </ModeButton>
      </div>

      {mode === "overview" ? (
        <OverviewMode
          files={files}
          patients={patients}
          showExampleNote={showExampleNote}
          onJumpToPatient={(id) => {
            onSelectPatient?.(id);
            setMode("patients");
          }}
        />
      ) : (
        <PatientsMode
          patients={patients}
          activePatient={activePatient}
          showExampleNote={showExampleNote}
          onSelect={(id) => onSelectPatient?.(id)}
        />
      )}
    </div>
  );
}

/* ─────────── Overview ─────────── */

function OverviewMode({
  files,
  patients,
  showExampleNote,
  onJumpToPatient,
}: {
  files: UploadedFile[];
  patients: Patient[];
  showExampleNote: boolean;
  onJumpToPatient: (id: string) => void;
}) {
  void onJumpToPatient;

  return (
    <>
      <div className="border-b px-6 py-4">
        <Stat icon={<Users className="size-4" />} label="Patients" value={files.length ? (patients.length ? String(patients.length) : "Pending") : "—"} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {files.length > 0 && showExampleNote && (
          <section className="border-b px-6 py-5">
            <SectionHeader icon={<AlertTriangle className="size-3.5" />} label="Triage queue" />
            <div className="rounded-lg border border-dashed bg-card px-3 py-3 text-sm">
              <p className="font-medium">Awaiting cohort from retrieval backend</p>
              <p className="mt-1 text-muted-foreground text-xs">
                Patient grouping is determined by the RAG. Triage buckets (Urgent / Priority / Routine)
                will populate here as soon as the backend returns a cohort.
              </p>
            </div>
          </section>
        )}

        <div className="px-6 py-5">
          <SectionHeader icon={<Activity className="size-3.5" />} label="Cohort summary" />
          <article className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-h3:text-base prose-h3:mt-5 prose-h3:mb-2 prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-blockquote:text-muted-foreground prose-blockquote:border-l-primary prose-blockquote:not-italic">
            <ReactMarkdown>{SUMMARY_MD}</ReactMarkdown>
          </article>
        </div>
      </div>
    </>
  );
}

/* ─────────── Patients ─────────── */

function PatientsMode({
  patients,
  activePatient,
  showExampleNote,
  onSelect,
}: {
  patients: Patient[];
  activePatient: Patient | null;
  showExampleNote: boolean;
  onSelect: (id: string) => void;
}) {
  if (patients.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-12 text-center">
        <p className="text-muted-foreground text-sm">No patients detected in this analysis.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {showExampleNote && (
        <div className="border-b bg-amber-500/5 px-6 py-2.5 text-xs text-muted-foreground">
          Cohort detection runs in the retrieval backend. Showing one example patient
          so the per-case workflow stays visible until indexing is wired.
        </div>
      )}
      <div className="grid flex-1 grid-cols-[220px_1fr] overflow-hidden">
        <ul className="overflow-y-auto border-r bg-muted/20">
          {patients.map((p) => {
            const active = activePatient?.id === p.id;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className={cn(
                    "flex w-full flex-col gap-1 border-l-2 px-3 py-2.5 text-left text-sm transition-colors",
                    active
                      ? "border-l-primary bg-background"
                      : "border-l-transparent hover:bg-background/60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2 shrink-0 rounded-full", TRIAGE_TONE[p.triage])} />
                    <span className="truncate font-medium">{p.id}</span>
                  </div>
                  {p.isExample && (
                    <span className="ml-4 w-fit rounded bg-muted px-1.5 py-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Example
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="overflow-y-auto">
          {activePatient && (
            <PatientDetail
              patient={activePatient}
              patients={patients}
              onSelectPatient={onSelect}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────── Shared ─────────── */

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
      {icon}
      {label}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-semibold text-base tabular-nums truncate">{value}</div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
        active ? "bg-primary text-primary-foreground" : "hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
