import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  Copy,
  Dna,
  FileText,
  History,
  Microscope,
  PenLine,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";

import type { Patient, Triage } from "@/lib/patients";
import { PatientChecklist } from "@/components/PatientChecklist";
import { GeneVisualization } from "@/components/GeneVisualization";
import {
  AUDIT_LABEL,
  DEFAULT_SETTINGS,
  METRIC_ORDER,
  appendAudit,
  computeMetrics,
  loadAudit,
  loadSettings,
  saveSettings,
  thresholdLabel,
  type AnalysisSettings,
  type AuditEntry,
  type ComputedMetric,
  type CustomMetric,
  type MetricConfig,
  type MetricKey,
  type Tone,
} from "@/lib/analysisSettings";

const TRIAGE_TONE: Record<Triage, string> = {
  Urgent: "bg-destructive/10 text-destructive border-destructive/30",
  Priority: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  Routine: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
};

const TONE_STYLES: Record<Tone, { card: string; dot: string; text: string; label: string }> = {
  good: {
    card: "border-emerald-500/30 bg-emerald-500/5",
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-400",
    label: "Pass",
  },
  warn: {
    card: "border-amber-500/30 bg-amber-500/5",
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-400",
    label: "Review",
  },
  bad: {
    card: "border-destructive/30 bg-destructive/5",
    dot: "bg-destructive",
    text: "text-destructive",
    label: "Fail",
  },
};

const REPORT_TEMPLATE = `A heterozygous {{classification}} {{gene}} variant was detected: {{cDNA}} ({{protein}}).
Observed VAF {{vaf}} (depth {{depth}}). {{consequence}} predicted; rare in population databases (gnomAD {{gnomad}}).
ClinVar: {{clinvar}}.

Recommend orthogonal confirmatory testing (clinical Sanger or diagnostic NGS) and referral to Clinical Genetics
for counselling and consideration of cascade testing. If obtained from tumour tissue, germline testing on blood
is advised to distinguish germline vs somatic origin.`;

type NavKey = "dashboard" | "report" | "settings";

const NAV: { key: NavKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "dashboard", label: "Case Dashboard", icon: Activity },
  { key: "report", label: "Report Draft", icon: FileText },
  { key: "settings", label: "Analysis Settings", icon: Settings2 },
];

export function PatientDetail({
  patient,
  patients,
  onSelectPatient,
}: {
  patient: Patient;
  patients?: Patient[];
  onSelectPatient?: (id: string) => void;
}) {
  const [nav, setNav] = useState<NavKey>("dashboard");
  const [settings, setSettings] = useState<AnalysisSettings>(DEFAULT_SETTINGS);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  // Reload settings + audit whenever the active patient changes (per-patient localStorage keys).
  useEffect(() => {
    setSettings(loadSettings(patient.id));
    setAudit(loadAudit(patient.id));
  }, [patient.id]);

  const logAudit = (entry: Parameters<typeof appendAudit>[1]) => {
    setAudit(appendAudit(patient.id, entry));
  };

  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-[200px_1fr]">
      {/* Left nav */}
      <aside className="border-b bg-muted/20 px-3 py-4 md:border-b-0 md:border-r">
        <PatientSelector
          patient={patient}
          patients={patients ?? []}
          onSelect={onSelectPatient}
        />
        <nav className="mt-4 flex flex-row gap-1 md:flex-col">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = nav === n.key;
            return (
              <button
                key={n.key}
                type="button"
                onClick={() => setNav(n.key)}
                className={cn(
                  "flex flex-1 items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors md:flex-none",
                  active
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                <span className="truncate">{n.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <div className="overflow-y-auto">
        <div className="space-y-6 px-6 py-5">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold text-xl tracking-tight">{patient.id}</h2>
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 font-medium text-xs",
                  TRIAGE_TONE[patient.triage],
                )}
              >
                {patient.triage}
              </span>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <ShieldCheck className="size-3" />
              Deterministic report · No AI
            </span>
          </header>

          <div key={nav} className="animate-lab-in space-y-6">
            {nav === "dashboard" && (
              <DashboardSection patient={patient} settings={settings} logAudit={logAudit} />
            )}
            {nav === "report" && (
              <ReportSection patient={patient} settings={settings} logAudit={logAudit} />
            )}
            {nav === "settings" && (
              <SettingsSection
                patientId={patient.id}
                settings={settings}
                onChange={setSettings}
                logAudit={logAudit}
              />
            )}

            <AuditTrail entries={audit} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────── Patient selector ─────────── */

function PatientSelector({
  patient,
  patients,
  onSelect,
}: {
  patient: Patient;
  patients: Patient[];
  onSelect?: (id: string) => void;
}) {
  const hasOptions = patients.length > 1 && !!onSelect;
  return (
    <div>
      <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Active patient
      </label>
      {hasOptions ? (
        <select
          value={patient.id}
          onChange={(e) => onSelect?.(e.target.value)}
          className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm font-medium"
        >
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} · {p.triage}
            </option>
          ))}
        </select>
      ) : (
        <div className="mt-1 truncate rounded-md border bg-background px-2 py-1.5 text-sm font-medium">
          {patient.id}
        </div>
      )}
      <p className="mt-1 text-[10px] text-muted-foreground">
        Settings &amp; notes saved per patient.
      </p>
    </div>
  );
}

/* ─────────── Dashboard ─────────── */

function DashboardSection({
  patient,
  settings,
  logAudit,
}: {
  patient: Patient;
  settings: AnalysisSettings;
  logAudit: (entry: { actor: string; action: AuditEntry["action"]; details?: string }) => void;
}) {
  const files = patient.files ?? { qc: [], variants: [], coverage: [], other: [] };
  const hasQc = files.qc.length > 0;
  const hasVariants = files.variants.length > 0;
  const hasCoverage = files.coverage.length > 0;
  const [showReport, setShowReport] = useState(false);
  const geneRef = useRef<HTMLDivElement | null>(null);

  const jumpToGene = () => {
    geneRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-6">
      <CaseDashboard
        patientId={patient.id}
        settings={settings}
        onJumpToGene={jumpToGene}
      />

      <GeneVisualization ref={geneRef} patientId={patient.id} />

      {hasQc && (
        <Section icon={<Activity className="size-3.5" />} title="Sequencing QC">
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Mean coverage" value="—" hint="parse pending" />
            <Metric label="% targets ≥50×" value="—" hint="parse pending" />
            <Metric label="Mapped reads" value="—" hint="parse pending" />
            <Metric label="Low-cov regions" value="—" hint="parse pending" />
          </div>
        </Section>
      )}

      {hasVariants && (
        <Section icon={<Microscope className="size-3.5" />} title="Key variants">
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr className="text-left text-muted-foreground">
                  <Th>Gene</Th>
                  <Th>HGVS</Th>
                  <Th>Consequence</Th>
                  <Th>ACMG</Th>
                  <Th>ClinVar</Th>
                  <Th className="text-right">VAF</Th>
                  <Th className="text-right">Depth</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    Awaiting parse of{" "}
                    <span className="font-medium text-foreground">{files.variants[0].name}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section icon={<AlertTriangle className="size-3.5" />} title="Coverage flags">
        {hasCoverage ? (
          <div className="rounded-md border bg-card px-3 py-3 text-sm text-muted-foreground">
            Awaiting parse of{" "}
            <span className="font-medium text-foreground">{files.coverage[0].name}</span> —
            low-coverage regions will appear here.
          </div>
        ) : (
          <EmptyState
            icon={<AlertTriangle className="size-4" />}
            title="No coverage data attached"
            hint="Coverage exports help flag intronic/exonic regions below threshold."
          />
        )}
      </Section>

      <Section icon={<ClipboardList className="size-3.5" />} title="Next actions" noTitleRow>
        <PatientChecklist patientId={patient.id} />
      </Section>

      <Section icon={<Workflow className="size-3.5" />} title="Suggested report language">
        <button
          type="button"
          onClick={() => setShowReport((v) => !v)}
          className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
        >
          {showReport ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          {showReport ? "Hide template" : "Show template"}
        </button>
        {showReport && (
          <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/40 px-3 py-3 text-xs leading-relaxed whitespace-pre-wrap">
            {REPORT_TEMPLATE}
          </pre>
        )}
      </Section>

      <NotesSignoff patientId={patient.id} logAudit={logAudit} />
    </div>
  );
}

function CaseDashboard({
  patientId,
  settings,
  onJumpToGene,
}: {
  patientId: string;
  settings: AnalysisSettings;
  onJumpToGene?: () => void;
}) {
  const { metrics, worst, ready } = useMemo(
    () => computeMetrics(patientId, settings),
    [patientId, settings],
  );

  const badgeStyles = ready
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : worst === "warn"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      : "border-destructive/40 bg-destructive/10 text-destructive";

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
          <Activity className="size-3.5" />
          Case dashboard
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-medium text-xs",
            badgeStyles,
          )}
        >
          {ready ? <CheckCircle2 className="size-3.5" /> : <Clock className="size-3.5" />}
          {ready ? "Ready for interpretation" : worst === "warn" ? "Needs review" : "Not ready"}
        </span>
      </div>

      {metrics.length === 0 ? (
        <EmptyState
          icon={<Settings2 className="size-4" />}
          title="No metrics enabled"
          hint="Enable metrics in Analysis Settings to populate the dashboard."
        />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {metrics.map((m) => {
            const t = TONE_STYLES[m.tone];
            const flagged = m.tone !== "good";
            return (
              <div key={m.key} className={cn("group rounded-md border px-3 py-2.5", t.card)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-muted-foreground text-xs">{m.label}</span>
                  <span className={cn("size-2 shrink-0 rounded-full", t.dot)} />
                </div>
                <div className="mt-1 font-display font-semibold text-lg tabular-nums">
                  {m.value}
                  {m.unit}
                </div>
                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="text-muted-foreground">target {m.threshold}</span>
                  <span className={cn("font-medium uppercase tracking-wider", t.text)}>
                    {t.label}
                  </span>
                </div>
                {flagged && onJumpToGene && (
                  <button
                    type="button"
                    onClick={onJumpToGene}
                    title="Jump to the gene & variant tracks"
                    className="mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded border border-dashed bg-background/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-emerald-500/40 hover:text-emerald-700 dark:hover:text-emerald-400"
                  >
                    <Dna className="size-2.5" />
                    Inspect on gene track →
                  </button>
                )}
                {m.source === "rag" && (
                  <div
                    title={m.query}
                    className="mt-1.5 flex items-center gap-1 truncate rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    <Search className="size-2.5 shrink-0" />
                    <span className="truncate">RAG · {m.query}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ─────────── Report Draft ─────────── */

function buildReportDraft(
  patientId: string,
  triage: Triage,
  settings: AnalysisSettings,
  metrics: ComputedMetric[],
  ready: boolean,
) {
  const builtin = metrics.filter((m) => m.source === "builtin");
  const custom = metrics.filter((m) => m.source === "rag");

  const lines = [
    `Case ${patientId} — Triage: ${triage}`,
    `Generated ${new Date().toLocaleString()}`,
    ``,
    settings.defaultWording,
    ``,
    `Sequencing QC summary:`,
    ...(builtin.length
      ? builtin.map(
          (m) =>
            `  • ${m.label}: ${m.value}${m.unit} (target ${m.threshold}) — ${TONE_STYLES[m.tone].label}`,
        )
      : ["  • (no built-in metrics enabled)"]),
  ];

  if (custom.length) {
    lines.push(
      ``,
      `Pathologist-defined metrics (extracted from patient files via RAG):`,
      ...custom.map(
        (m) =>
          `  • ${m.label}: ${m.value}${m.unit} (target ${m.threshold}) — ${TONE_STYLES[m.tone].label}\n      query: "${m.query}"`,
      ),
    );
  }

  lines.push(
    ``,
    `Status: ${ready ? "Ready for interpretation." : "Pending QC review — see flagged metrics above."}`,
    ``,
    settings.reportFooter,
  );

  return lines.join("\n");
}

function ReportSection({
  patient,
  settings,
  logAudit,
}: {
  patient: Patient;
  settings: AnalysisSettings;
  logAudit: (entry: { actor: string; action: AuditEntry["action"]; details?: string }) => void;
}) {
  const { metrics, ready } = useMemo(
    () => computeMetrics(patient.id, settings),
    [patient.id, settings],
  );
  const draft = useMemo(
    () => buildReportDraft(patient.id, patient.triage, settings, metrics, ready),
    [patient.id, patient.triage, settings, metrics, ready],
  );
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success("Report draft copied to clipboard");
      logAudit({ actor: "system", action: "report.copied" });
    } catch {
      toast.error("Could not access clipboard");
    }
  };

  return (
    <section>
      <div className="sticky top-0 z-10 -mx-6 mb-3 flex items-center justify-between gap-2 border-b bg-background/85 px-6 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
          <FileText className="size-3.5" />
          Report draft preview
        </div>
        <button
          type="button"
          onClick={onCopy}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
            copied
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-primary text-primary-foreground hover:opacity-90 border-transparent",
          )}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied to clipboard" : "Copy to report"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-md border bg-muted/40 px-3 py-3 text-xs leading-relaxed whitespace-pre-wrap">
        {draft}
      </pre>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        Read-only draft generated deterministically from QC metrics + Analysis Settings. No AI
        inference applied.
      </p>
    </section>
  );
}

/* ─────────── Analysis Settings ─────────── */

function SettingsSection({
  patientId,
  settings,
  onChange,
  logAudit,
}: {
  patientId: string;
  settings: AnalysisSettings;
  onChange: (s: AnalysisSettings) => void;
  logAudit: (entry: { actor: string; action: AuditEntry["action"]; details?: string }) => void;
}) {
  const update = (next: AnalysisSettings) => onChange(next);

  const updateMetric = (key: MetricKey, patch: Partial<MetricConfig>) => {
    update({
      ...settings,
      metrics: { ...settings.metrics, [key]: { ...settings.metrics[key], ...patch } },
    });
  };

  const updateCustom = (id: string, patch: Partial<CustomMetric>) => {
    update({
      ...settings,
      customMetrics: settings.customMetrics.map((m) =>
        m.id === id ? { ...m, ...patch } : m,
      ),
    });
  };

  const addCustom = () => {
    const draft: CustomMetric = {
      id: crypto.randomUUID(),
      label: "New metric",
      unit: "%",
      query: "",
      direction: "higherIsBetter",
      good: 90,
      warn: 75,
      visible: true,
    };
    update({ ...settings, customMetrics: [...settings.customMetrics, draft] });
    toast("Custom metric added — set a RAG query to extract its value");
  };

  const removeCustom = (id: string) => {
    update({
      ...settings,
      customMetrics: settings.customMetrics.filter((m) => m.id !== id),
    });
  };

  const onSave = () => {
    saveSettings(patientId, settings);
    toast.success("Analysis settings saved", {
      description: `Applied to ${patientId} — preview already updated.`,
    });
    logAudit({ actor: "system", action: "settings.saved" });
  };

  const onReset = () => {
    update(DEFAULT_SETTINGS);
    saveSettings(patientId, DEFAULT_SETTINGS);
    toast("Settings reset to defaults");
    logAudit({ actor: "system", action: "settings.reset" });
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
            <Settings2 className="size-3.5" />
            Analysis settings
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Configure thresholds, visible metrics and report wording. Changes update the preview
            instantly; click Save to persist for this patient.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <RotateCcw className="size-3.5" />
            Reset
          </button>
          <button
            type="button"
            onClick={onSave}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <Save className="size-3.5" />
            Save settings
          </button>
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Metrics &amp; thresholds
        </h4>
        <div className="overflow-hidden rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr className="text-left text-[10px] uppercase tracking-wider">
                <th className="px-3 py-2">Show</th>
                <th className="px-3 py-2">Metric</th>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2">Direction</th>
                <th className="px-3 py-2 text-right">Pass at</th>
                <th className="px-3 py-2 text-right">Review at</th>
                <th className="px-3 py-2 text-right">Threshold</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {METRIC_ORDER.map((key) => {
                const m = settings.metrics[key];
                return (
                  <tr key={key} className="text-xs">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={m.visible}
                        onChange={(e) => updateMetric(key, { visible: e.target.checked })}
                        className="size-4 cursor-pointer accent-primary"
                      />
                    </td>
                    <td className="px-3 py-2 font-medium text-foreground">{key}</td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={m.label}
                        onChange={(e) => updateMetric(key, { label: e.target.value })}
                        className="w-full rounded border bg-background px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={m.direction}
                        onChange={(e) =>
                          updateMetric(key, {
                            direction: e.target.value as MetricConfig["direction"],
                          })
                        }
                        className="rounded border bg-background px-1.5 py-1 text-xs"
                      >
                        <option value="higherIsBetter">Higher is better</option>
                        <option value="lowerIsBetter">Lower is better</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        value={m.good}
                        onChange={(e) =>
                          updateMetric(key, { good: Number(e.target.value) })
                        }
                        className="w-16 rounded border bg-background px-1.5 py-1 text-right text-xs tabular-nums"
                      />
                      <span className="ml-1 text-muted-foreground">{m.unit}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        value={m.warn}
                        onChange={(e) =>
                          updateMetric(key, { warn: Number(e.target.value) })
                        }
                        className="w-16 rounded border bg-background px-1.5 py-1 text-right text-xs tabular-nums"
                      />
                      <span className="ml-1 text-muted-foreground">{m.unit}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {thresholdLabel(m)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-end justify-between gap-2">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Custom metrics (extracted via RAG)
            </h4>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Define what to look for in this patient&apos;s files. The retrieval backend will run
              each query against the uploaded reports; thresholds below decide Pass / Review / Fail
              and the value is included in the report draft.
            </p>
          </div>
          <button
            type="button"
            onClick={addCustom}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <Plus className="size-3.5" />
            Add metric
          </button>
        </div>

        {settings.customMetrics.length === 0 ? (
          <EmptyState
            icon={<Search className="size-4" />}
            title="No custom metrics yet"
            hint='Example: label "MSI score", query "microsatellite instability score in the QC report", direction lower-is-better, pass at 10%.'
          />
        ) : (
          <ul className="space-y-2">
            {settings.customMetrics.map((m) => (
              <li key={m.id} className="rounded-md border bg-card p-3">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={m.visible}
                    onChange={(e) => updateCustom(m.id, { visible: e.target.checked })}
                    title="Include in dashboard and report"
                    className="mt-2 size-4 cursor-pointer accent-primary"
                  />
                  <div className="grid flex-1 gap-2 sm:grid-cols-12">
                    <label className="sm:col-span-4">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Label
                      </span>
                      <input
                        type="text"
                        value={m.label}
                        onChange={(e) => updateCustom(m.id, { label: e.target.value })}
                        className="mt-0.5 w-full rounded border bg-background px-2 py-1 text-sm font-medium"
                      />
                    </label>
                    <label className="sm:col-span-2">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Unit
                      </span>
                      <input
                        type="text"
                        value={m.unit}
                        onChange={(e) => updateCustom(m.id, { unit: e.target.value })}
                        className="mt-0.5 w-full rounded border bg-background px-2 py-1 text-sm tabular-nums"
                      />
                    </label>
                    <label className="sm:col-span-3">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Direction
                      </span>
                      <select
                        value={m.direction}
                        onChange={(e) =>
                          updateCustom(m.id, {
                            direction: e.target.value as CustomMetric["direction"],
                          })
                        }
                        className="mt-0.5 w-full rounded border bg-background px-1.5 py-1 text-xs"
                      >
                        <option value="higherIsBetter">Higher is better</option>
                        <option value="lowerIsBetter">Lower is better</option>
                      </select>
                    </label>
                    <label className="sm:col-span-1">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Pass
                      </span>
                      <input
                        type="number"
                        value={m.good}
                        onChange={(e) => updateCustom(m.id, { good: Number(e.target.value) })}
                        className="mt-0.5 w-full rounded border bg-background px-1.5 py-1 text-right text-xs tabular-nums"
                      />
                    </label>
                    <label className="sm:col-span-1">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Review
                      </span>
                      <input
                        type="number"
                        value={m.warn}
                        onChange={(e) => updateCustom(m.id, { warn: Number(e.target.value) })}
                        className="mt-0.5 w-full rounded border bg-background px-1.5 py-1 text-right text-xs tabular-nums"
                      />
                    </label>
                    <label className="sm:col-span-12">
                      <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        <Search className="size-3" />
                        RAG query — what to find in the patient&apos;s files
                      </span>
                      <input
                        type="text"
                        value={m.query}
                        onChange={(e) => updateCustom(m.id, { query: e.target.value })}
                        placeholder='e.g. "tumour mutational burden in mutations per Mb"'
                        className="mt-0.5 w-full rounded border bg-background px-2 py-1 text-sm"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeCustom(m.id)}
                    title="Remove metric"
                    className="mt-1 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="rounded bg-muted px-1.5 py-0.5 font-medium uppercase tracking-wider">
                    Threshold {thresholdLabel(m)}
                  </span>
                  {!m.query.trim() && (
                    <span className="text-amber-600 dark:text-amber-400">
                      Set a query so the RAG knows what to extract.
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Default wording
          </label>
          <textarea
            value={settings.defaultWording}
            onChange={(e) => update({ ...settings, defaultWording: e.target.value })}
            rows={4}
            className="mt-1 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Report footer
          </label>
          <textarea
            value={settings.reportFooter}
            onChange={(e) => update({ ...settings, reportFooter: e.target.value })}
            rows={4}
            className="mt-1 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Live preview
          </h4>
          <span className="text-[10px] text-muted-foreground">
            Updates as you edit thresholds — Save to persist for {patientId}.
          </span>
        </div>
        <CaseDashboard patientId={patientId} settings={settings} />
      </div>
    </section>
  );
}

/* ─────────── Notes & Sign-off ─────────── */

type NoteEntry = { id: string; initials: string; text: string; ts: number };
type SignoffState = {
  notes: NoteEntry[];
  approved: boolean;
  approvedBy?: string;
  approvedAt?: number;
};

const SIGNOFF_KEY_PREFIX = "patient-signoff:";

function loadSignoff(patientId: string): SignoffState {
  if (typeof window === "undefined") return { notes: [], approved: false };
  try {
    const raw = window.localStorage.getItem(SIGNOFF_KEY_PREFIX + patientId);
    if (!raw) return { notes: [], approved: false };
    return JSON.parse(raw) as SignoffState;
  } catch {
    return { notes: [], approved: false };
  }
}

function saveSignoff(patientId: string, state: SignoffState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIGNOFF_KEY_PREFIX + patientId, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function NotesSignoff({
  patientId,
  logAudit,
}: {
  patientId: string;
  logAudit: (entry: { actor: string; action: AuditEntry["action"]; details?: string }) => void;
}) {
  const [state, setState] = useState<SignoffState>(() => ({ notes: [], approved: false }));
  const [initials, setInitials] = useState("");
  const [text, setText] = useState("");

  useEffect(() => {
    setState(loadSignoff(patientId));
  }, [patientId]);

  const persist = (next: SignoffState) => {
    setState(next);
    saveSignoff(patientId, next);
  };

  const addNote = () => {
    const trimmed = text.trim();
    const ini = initials.trim().toUpperCase().slice(0, 4);
    if (!trimmed || !ini) return;
    const note: NoteEntry = {
      id: crypto.randomUUID(),
      initials: ini,
      text: trimmed,
      ts: Date.now(),
    };
    persist({ ...state, notes: [note, ...state.notes] });
    setText("");
    toast.success("Note added", { description: `${ini} · ${new Date().toLocaleTimeString()}` });
    logAudit({ actor: ini, action: "note.added", details: trimmed.slice(0, 80) });
  };

  const toggleApproval = () => {
    if (state.approved) {
      const who = state.approvedBy ?? "—";
      persist({ ...state, approved: false, approvedBy: undefined, approvedAt: undefined });
      toast("Approval revoked");
      logAudit({ actor: who, action: "case.unapproved" });
    } else {
      const ini = initials.trim().toUpperCase().slice(0, 4);
      if (!ini) {
        toast.error("Enter your initials before approving");
        return;
      }
      persist({ ...state, approved: true, approvedBy: ini, approvedAt: Date.now() });
      toast.success(`Case approved by ${ini}`);
      logAudit({ actor: ini, action: "case.approved" });
    }
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
          <PenLine className="size-3.5" />
          Notes &amp; sign-off
        </div>
        <label
          className={cn(
            "inline-flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
            state.approved
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-card hover:bg-accent",
          )}
        >
          <input
            type="checkbox"
            className="sr-only"
            checked={state.approved}
            onChange={toggleApproval}
          />
          {state.approved ? <CheckCircle2 className="size-3.5" /> : <Clock className="size-3.5" />}
          {state.approved
            ? `Approved by ${state.approvedBy} · ${new Date(state.approvedAt!).toLocaleDateString()}`
            : "Mark approved"}
        </label>
      </div>

      <div className="rounded-md border bg-card px-3 py-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={initials}
            onChange={(e) => setInitials(e.target.value)}
            placeholder="Initials"
            maxLength={4}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm uppercase tabular-nums sm:w-24"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a note for this case…"
            rows={2}
            className="flex-1 resize-none rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </div>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={addNote}
            disabled={!text.trim() || !initials.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-50"
          >
            Add note
          </button>
        </div>
      </div>

      {state.notes.length > 0 && (
        <ul className="mt-3 space-y-2">
          {state.notes.map((n) => (
            <li key={n.id} className="rounded-md border bg-card px-3 py-2 text-sm">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5 font-semibold text-foreground">
                  {n.initials}
                </span>
                <span>{new Date(n.ts).toLocaleString()}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap leading-snug">{n.text}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ─────────── Audit trail ─────────── */

function AuditTrail({ entries }: { entries: AuditEntry[] }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
        <History className="size-3.5" />
        Audit trail
      </div>
      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed bg-card px-3 py-3 text-xs text-muted-foreground">
          No activity yet for this patient.
        </div>
      ) : (
        <ol className="overflow-hidden rounded-md border bg-card">
          {entries.slice(0, 10).map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-3 border-b px-3 py-2 text-xs last:border-b-0"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 font-semibold text-foreground">
                  {e.actor}
                </span>
                <span className="truncate font-medium">{AUDIT_LABEL[e.action]}</span>
                {e.details && (
                  <span className="truncate text-muted-foreground">— {e.details}</span>
                )}
              </div>
              <time className="shrink-0 tabular-nums text-muted-foreground">
                {new Date(e.ts).toLocaleString()}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ─────────── Shared helpers ─────────── */

function Section({
  icon,
  title,
  children,
  noTitleRow,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  noTitleRow?: boolean;
}) {
  return (
    <section>
      {!noTitleRow && (
        <div className="mb-3 flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
          {icon}
          {title}
        </div>
      )}
      {children}
    </section>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2 font-medium", className)}>{children}</th>;
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-0.5 font-semibold text-base tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-dashed bg-card px-3 py-3 text-sm">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div>
        <div className="font-medium">{title}</div>
        <div className="mt-0.5 text-muted-foreground text-xs">{hint}</div>
      </div>
    </div>
  );
}
