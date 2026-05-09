"use client";

import { Children, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ChatPage from "./Chatbot";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const moduleTabs = ["Overview", "Quality", "Genes", "Variants", "Report", "Chat"];
const subnavTabs = ["Warnings", "Coverage", "Report"];
const skinnyTabs = [
  "Transcript",
  "Diseases",
  "Phenotypes",
  "Specimen",
  "Test Information",
  "Reported",
];

const fallbackSampleIds = ["SG063-LPA", "SG220-LPA", "SG222-LPA", "17br088-1-Run1"];
const TODO_STORAGE_KEY = "clinical-chat-tasks-v1";
const DEFAULT_TASK_SEVERITY = 3;

type TodoTask = {
  id: string;
  targetId: string;
  targetType: "sample" | "gene";
  note: string;
  severity: number;
  createdAt: string;
  completed: boolean;
};

type Finding = {
  title: string;
  detail: string;
  action: string;
};

type QaReport = {
  audience: string;
  audio_url: string;
  summary: {
    executive_summary: string;
    findings: Finding[];
  };
  script: Array<{
    speaker: string;
    line: string;
  }>;
};

export default function Home() {
  const [activeModule, setActiveModule] = useState("Quality");
  const [activeSubnav, setActiveSubnav] = useState("Report");
  const [activeDocument, setActiveDocument] = useState<"sample" | "request">("sample");
  const [zoom, setZoom] = useState("100");
  const [page, setPage] = useState(1);
  const [qaReport, setQaReport] = useState<QaReport | null>(null);
  const [qaStatus, setQaStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [qaError, setQaError] = useState("");
  const [sampleIds, setSampleIds] = useState<string[]>(fallbackSampleIds);
  const [selectedSampleId, setSelectedSampleId] = useState(fallbackSampleIds[0]);
  const [smartSummary, setSmartSummary] = useState("");
  const [smartStatus, setSmartStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [smartError, setSmartError] = useState("");
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [taskStatus, setTaskStatus] = useState("");
  const tasksHydrated = useRef(false);

  const reportSrc = useMemo(
    () => `/api/report#toolbar=0&navpanes=0&pagemode=none&scrollbar=1&page=${page}&zoom=${zoom}`,
    [page, zoom],
  );
  const isChat = activeModule === "Chat";

  const goToPage = (nextPage: number) => {
    setPage(Math.min(12, Math.max(1, nextPage)));
  };

  const printReport = () => {
    window.open("/api/report", "_blank", "noopener,noreferrer");
  };

  useEffect(() => {
    if (activeDocument !== "request" || qaStatus !== "idle") {
      return;
    }

    setQaStatus("loading");
    fetch("/api/qa-report")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Unable to generate QA report");
        }
        return payload as QaReport;
      })
      .then((payload) => {
        setQaReport(payload);
        setQaStatus("ready");
      })
      .catch((error: Error) => {
        setQaError(error.message);
        setQaStatus("error");
      });
  }, [activeDocument, qaStatus]);

  useEffect(() => {
    let cancelled = false;

    async function loadSampleIds() {
      try {
        const response = await fetch("/api/chat");
        if (!response.ok) return;
        const payload = await response.json();
        const ids = Array.isArray(payload.sampleIds)
          ? payload.sampleIds.filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0)
          : [];

        if (cancelled || ids.length === 0) return;
        setSampleIds(ids);
        setSelectedSampleId((current) => (ids.includes(current) ? current : ids[0]));
      } catch {
        // Keep fallback samples if the database is not available during local startup.
      }
    }

    loadSampleIds();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedSampleId || isChat) return;
    generateSmartSummary(selectedSampleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSampleId, isChat]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TODO_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setTasks(parsed.map(normalizeTask).filter(Boolean) as TodoTask[]);
      }
    } catch {
      setTasks([]);
    } finally {
      tasksHydrated.current = true;
    }
  }, []);

  useEffect(() => {
    if (!tasksHydrated.current) return;
    window.localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);

  const regenerateQaReport = () => {
    setQaStatus("loading");
    setQaError("");
    fetch("/api/qa-report?force=1")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Unable to generate QA report");
        }
        return payload as QaReport;
      })
      .then((payload) => {
        setQaReport(payload);
        setQaStatus("ready");
      })
      .catch((error: Error) => {
        setQaError(error.message);
        setQaStatus("error");
      });
  };

  async function generateSmartSummary(sampleId = selectedSampleId) {
    if (!sampleId || smartStatus === "loading") return;

    setSmartStatus("loading");
    setSmartError("");
    setSmartSummary("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "smart-case-summary",
          sampleId,
          message:
            `Create a Smart Case Summary for sample ${sampleId}: a fast triage overview for the analysis index page. ` +
            "Return 4-5 bullets covering readiness, key QA metrics, warnings/coverage risks, and the next review step.",
        }),
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({ error: "Unable to generate Smart Case Summary" }));
        throw new Error(payload.error || "Unable to generate Smart Case Summary");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setSmartSummary(accumulated);
      }

      setSmartStatus("ready");
    } catch (error) {
      setSmartError(error instanceof Error ? error.message : "Unable to generate Smart Case Summary");
      setSmartStatus("error");
    }
  }

  function addSmartSummaryTask(note: string) {
    const cleaned = cleanTaskNote(note);
    if (!cleaned) return;

    setTasks((previous) => [
      {
        id: crypto.randomUUID(),
        targetId: selectedSampleId,
        targetType: "sample",
        note: cleaned,
        severity: DEFAULT_TASK_SEVERITY,
        createdAt: new Date().toISOString(),
        completed: false,
      },
      ...previous,
    ]);
    setTaskStatus(`Added task for ${selectedSampleId}.`);
    window.setTimeout(() => setTaskStatus(""), 2200);
  }

  return (
    <>
      <aside className="rail">
        <div className="rail-top">
          <button className="rail-icon molecule" aria-label="Application launcher">
            <span />
            <span />
            <span />
            <span />
            <span />
          </button>
          <button className="rail-icon rail-chevron active" aria-label="Collapse panel">
            &rsaquo;
          </button>
          <button className="rail-icon home" aria-label="Home" />
          <button className="rail-icon layout" aria-label="Dashboard" />
          <button className="rail-icon folder" aria-label="Files" />
        </div>
        <div className="rail-middle">
          <button className="rail-icon bulb active" aria-label="Quality" />
          <button className="rail-icon plus" aria-label="Add" />
        </div>
        <div className="rail-bottom">
          <button className="rail-icon upload" aria-label="Upload" />
          <button className="rail-icon gear" aria-label="Settings" />
          <button className="rail-icon help" aria-label="Help">
            ?
          </button>
          <button className="avatar" aria-label="User menu">
            H4
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="casebar">
          <section className="case-title">
            <span className="draft">Draft</span>
            <div className="case-title-main">
              <span className="spark" />
              <strong>SG063-LPA - 2026 May 09 - Interpret...</strong>
              <button className="menu-button" aria-label="Menu">
                &#8801;
              </button>
            </div>
          </section>

          <section className="module-tabs" aria-label="Primary modules">
            {moduleTabs.map((tab) => (
              <button
                className={activeModule === tab ? "selected" : ""}
                key={tab}
                onClick={() => setActiveModule(tab)}
              >
                {tab}
              </button>
            ))}
          </section>

          <section className="summary-strip" aria-label="Case summary">
            <button className="back" aria-label="Back">
              &lsaquo;
            </button>
            <article className="summary-card application">
              <span className="vertical">Application</span>
              <div>
                <p>HCS v2 hg38</p>
                <small>
                  <span className="pill">RUO</span> hg38
                </small>
                <strong>CNV</strong>
              </div>
            </article>
            <article className="summary-card subject">
              <span className="vertical">Subject</span>
              <div>
                <p>PID-SG063-LPA</p>
                <small>Age - &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Sex -</small>
                <small>
                  Ancestry
                  <br />-
                </small>
              </div>
            </article>
            <article className="summary-card virtual-panel">
              <span className="vertical">Virtual Panel</span>
              <div className="select-row">
                HCS_v2_hg38 <span>&#8964;</span>
              </div>
              <div className="ring-row blue">
                <span className="ring lock" />
                <p>
                  <strong>84 Genes</strong>
                  <small>/ 84</small>
                </p>
              </div>
            </article>
            <article className="summary-card dynamic-panel muted">
              <span className="vertical">Dynamic Panel</span>
              <div className="ring-row">
                <span className="ring" />
                <p>
                  <strong>0 Genes</strong>
                  <small>/ 84</small>
                </p>
              </div>
            </article>
            <nav className="skinny-tabs" aria-label="Secondary modules">
              {skinnyTabs.map((tab) => (
                <button key={tab}>
                  <span>{tab}</span>
                  {tab === "Diseases" || tab === "Phenotypes" ? <b>0</b> : null}
                  {tab === "Reported" ? <i>&#9733;</i> : null}
                </button>
              ))}
            </nav>
            <div className="toolbar-end">
              <button aria-label="Settings">&#9881;</button>
              <button aria-label="Expand">&rsaquo;</button>
            </div>
          </section>
        </header>

        {isChat ? (
          <ChatPage />
        ) : (
          <>
            <section className="subnav" aria-label="Quality navigation">
              {subnavTabs.map((tab) => (
                <button
                  className={activeSubnav === tab ? "selected" : ""}
                  key={tab}
                  onClick={() => setActiveSubnav(tab)}
                >
                  {tab}
                  {tab === "Warnings" ? <span>38</span> : null}
                </button>
              ))}
              <button
                className={`pdf-link ${activeDocument === "sample" ? "primary" : ""}`}
                onClick={() => setActiveDocument("sample")}
              >
                Sample (QA-patient.pdf)
              </button>
              <button
                className={`pdf-link ${activeDocument === "request" ? "primary" : ""}`}
                onClick={() => setActiveDocument("request")}
              >
                Request (QA-report.pdf)
              </button>
            </section>

            <SmartCaseSummary
              sampleIds={sampleIds}
              selectedSampleId={selectedSampleId}
              status={smartStatus}
              summary={smartSummary}
              error={smartError}
              onSampleChange={setSelectedSampleId}
              onRegenerate={() => generateSmartSummary(selectedSampleId)}
              onAddTask={addSmartSummaryTask}
              taskStatus={taskStatus}
            />

            <section className="viewer-shell">
              {activeDocument === "sample" ? (
                <object
                  className="pdf-frame"
                  data={reportSrc}
                  type="application/pdf"
                  aria-label="Quality report PDF"
                >
                  <iframe className="pdf-frame" title="Quality report PDF" src={reportSrc} />
                </object>
              ) : (
                <QaSummaryReport
                  report={qaReport}
                  status={qaStatus}
                  error={qaError}
                  onRegenerate={regenerateQaReport}
                />
              )}
            </section>

          </>
        )}
      </main>
    </>
  );
}

function normalizeTask(task: Partial<TodoTask>): TodoTask | null {
  if (!task.id || !task.targetId || !task.targetType || !task.note || !task.createdAt) return null;
  if (task.targetType !== "sample" && task.targetType !== "gene") return null;

  return {
    id: String(task.id),
    targetId: String(task.targetId),
    targetType: task.targetType,
    note: String(task.note),
    severity: Number.isFinite(Number(task.severity)) ? Math.min(5, Math.max(1, Math.round(Number(task.severity)))) : DEFAULT_TASK_SEVERITY,
    createdAt: String(task.createdAt),
    completed: Boolean(task.completed),
  };
}

function textFromReactNode(children: ReactNode): string {
  const parts: string[] = [];

  Children.forEach(children, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      parts.push(String(child));
      return;
    }

    if (isValidElement<{ children?: ReactNode }>(child)) {
      parts.push(textFromReactNode(child.props.children));
    }
  });

  return parts.join("");
}

function cleanTaskNote(note: string) {
  return note
    .replace(/\s*\[\d+(?:]\[\d+)*]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function SmartCaseSummary({
  sampleIds,
  selectedSampleId,
  status,
  summary,
  error,
  onSampleChange,
  onRegenerate,
  onAddTask,
  taskStatus,
}: {
  sampleIds: string[];
  selectedSampleId: string;
  status: "idle" | "loading" | "ready" | "error";
  summary: string;
  error: string;
  onSampleChange: (sampleId: string) => void;
  onRegenerate: () => void;
  onAddTask: (note: string) => void;
  taskStatus: string;
}) {
  return (
    <section className="smart-summary" aria-label="Smart Case Summary">
      <div className="smart-summary-header">
        <div>
          <p>Summary</p>
          <h2>Smart Case Summary</h2>
        </div>
        <div className="smart-summary-actions">
          <select
            value={selectedSampleId}
            onChange={(event) => onSampleChange(event.target.value)}
            disabled={status === "loading" || sampleIds.length === 0}
            aria-label="Sample ID"
          >
            {sampleIds.map((id) => (
              <option value={id} key={id}>
                {id}
              </option>
            ))}
          </select>
          <button type="button" onClick={onRegenerate} disabled={status === "loading" || sampleIds.length === 0}>
            {status === "loading" ? "Generating..." : "Regenerate"}
          </button>
        </div>
      </div>

      <div className="smart-summary-body">
        {status === "loading" ? <p className="smart-summary-muted">Generating fast triage bullets...</p> : null}
        {status === "error" ? <p className="smart-summary-error">{error}</p> : null}
        {summary ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              li: ({ children }) => {
                const note = cleanTaskNote(textFromReactNode(children));
                return (
                  <li>
                    <button
                      className="smart-task-plus"
                      type="button"
                      aria-label={`Add follow-up task for ${selectedSampleId}`}
                      title="Add as task"
                      disabled={!note}
                      onClick={() => onAddTask(note)}
                    >
                      +
                    </button>
                    <span>{children}</span>
                  </li>
                );
              },
            }}
          >
            {summary}
          </ReactMarkdown>
        ) : status === "idle" ? (
          <p className="smart-summary-muted">Select a sample to generate a 4-5 bullet triage overview.</p>
        ) : null}
        {taskStatus ? <p className="smart-task-status">{taskStatus}</p> : null}
      </div>
    </section>
  );
}

function QaSummaryReport({
  report,
  status,
  error,
  onRegenerate,
}: {
  report: QaReport | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string;
  onRegenerate: () => void;
}) {
  return (
    <article className="qa-report-page">
      <header className="qa-report-header">
        <div>
          <p className="qa-eyebrow">Generated Summary</p>
          <h1>QA-report.pdf</h1>
        </div>
        <button onClick={onRegenerate} disabled={status === "loading"}>
          {status === "loading" ? "Generating..." : "Regenerate"}
        </button>
      </header>

      {status === "loading" ? (
        <section className="qa-state">
          <h2>Generating report summary and podcast</h2>
          <p>This can take a few minutes while the PDF is summarized and the audio briefing is assembled.</p>
        </section>
      ) : null}

      {status === "error" ? (
        <section className="qa-state error">
          <h2>Could not generate the QA report</h2>
          <p>{error}</p>
        </section>
      ) : null}

      {report ? (
        <>
          <section className="qa-summary">
            <h2>Executive Summary</h2>
            <p>{report.summary.executive_summary}</p>
          </section>

          <section className="qa-findings">
            <h2>Top Findings</h2>
            {report.summary.findings.map((finding, index) => (
              <article className="finding-card" key={`${finding.title}-${index}`}>
                <span>{index + 1}</span>
                <div>
                  <h3>{finding.title}</h3>
                  <p>{finding.detail}</p>
                  <strong>Action: {finding.action}</strong>
                </div>
              </article>
            ))}
          </section>

          <section className="podcast-panel">
            <div>
              <h2>Generated Podcast</h2>
              <p>Single-narrator audio briefing generated from the PDF summary.</p>
            </div>
            <audio controls src={report.audio_url} />
          </section>

          <section className="transcript-panel">
            <h2>Podcast Transcript</h2>
            {report.script.map((segment, index) => (
              <p key={`${segment.line}-${index}`}>
                <strong>{segment.speaker}:</strong> {segment.line}
              </p>
            ))}
          </section>
        </>
      ) : null}
    </article>
  );
}
