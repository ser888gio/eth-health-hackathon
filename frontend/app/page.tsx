"use client";

import { useEffect, useMemo, useState } from "react";
import ChatPage from "./Chatbot";

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

  const reportSrc = useMemo(
    () => `/api/report#toolbar=0&navpanes=0&pagemode=none&scrollbar=1&page=${page}&zoom=${zoom}`,
    [page, zoom],
  );

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

  const isChat = activeModule === "Chat";

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
