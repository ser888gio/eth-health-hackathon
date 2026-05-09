"use client";

import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = {
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
};

type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  qaSummaryGenerated?: boolean;
};

type SendOptions = {
  sampleId?: string;
  intent?: "qa-summary";
};

type TaskTargetType = "sample" | "gene";

type TodoTask = {
  id: string;
  targetId: string;
  targetType: TaskTargetType;
  note: string;
  severity: number;
  createdAt: string;
  completed: boolean;
};

type PendingNote = {
  targetId: string;
  targetType: TaskTargetType;
};

const TODO_STORAGE_KEY = "clinical-chat-tasks-v1";
const DEFAULT_SEVERITY = 3;
const SEVERITY_OPTIONS = [1, 2, 3, 4, 5];

const FALLBACK_SAMPLE_IDS = ["SG063-LPA", "SG220-LPA", "SG222-LPA", "17br088-1-Run1"];
const SAMPLE_IDS = FALLBACK_SAMPLE_IDS;
const SAMPLE_ID_SET = new Set(SAMPLE_IDS.map((id) => id.toLowerCase()));
const COMMON_TOKEN_SET = new Set([
  "AI",
  "BAM",
  "CNV",
  "CSV",
  "DNA",
  "FASTQ",
  "HG38",
  "INDEL",
  "LPA",
  "NGS",
  "PDF",
  "QA",
  "Q30",
  "QC",
  "RNA",
  "RUO",
  "SNP",
  "TXT",
  "URL",
  "VAF",
]);
const ID_PATTERN = /(SG063-LPA|SG220-LPA|SG222-LPA|17br088-1-Run1|\b[A-Z][A-Z0-9]{1,9}\b)/g;

const SUGGESTIONS = [
  "Compare samples SG063-LPA, SG220-LPA, and 17br088-1-Run1.",
  "What is the overall quality of this sequencing run?",
  "Which genes have low coverage regions?",
  "Are there any coverage warnings I should be aware of?",
];

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

function normalizeActionText(value: string) {
  return value
    .replace(/\s*\[\d+(?:]\[\d+)*]\s*/g, " ")
    .replace(/^(TODO|Action|Follow-up)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function markdownSectionTitle(line: string): string | null {
  const hashHeading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
  if (hashHeading) return hashHeading[1].trim().replace(/:$/, "");

  const trimmed = line.trim();
  const boldHeading = trimmed.match(/^\*\*(.+?)\*\*:?\s*$/);
  if (boldHeading) return boldHeading[1].trim().replace(/:$/, "");

  const plainHeading = trimmed.match(/^([A-Z][A-Za-z -]+):\s*$/);
  return plainHeading ? plainHeading[1].trim() : null;
}

function extractRecommendedActions(markdown: string): Set<string> {
  const actions = new Set<string>();
  const lines = markdown.split(/\r?\n/);
  let inSection = false;

  for (const line of lines) {
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/) || line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (inSection && bullet) {
      const action = normalizeActionText(bullet[1]);
      if (action) actions.add(action);
      continue;
    }

    const heading = markdownSectionTitle(line);
    if (heading) {
      inSection = /recommended\s+follow[- ]?up\s+actions/i.test(heading);
    }
  }

  return actions;
}

function inferSampleId(text: string): string | null {
  for (const sampleId of SAMPLE_IDS) {
    if (text.toLowerCase().includes(sampleId.toLowerCase())) return sampleId;
  }
  return null;
}

function newConversation(): Conversation {
  return { id: crypto.randomUUID(), title: "New conversation", messages: [] };
}

function targetTypeFor(token: string): TaskTargetType | null {
  if (SAMPLE_ID_SET.has(token.toLowerCase())) return "sample";
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(token)) return null;
  if (COMMON_TOKEN_SET.has(token)) return null;
  if (/^\d/.test(token) || /^\d+$/.test(token)) return null;
  return "gene";
}

function normalizeSeverity(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SEVERITY;
  return Math.min(5, Math.max(1, Math.round(numeric)));
}

function normalizeTask(task: Partial<TodoTask>): TodoTask | null {
  if (!task.id || !task.targetId || !task.targetType || !task.note || !task.createdAt) return null;
  if (task.targetType !== "sample" && task.targetType !== "gene") return null;

  return {
    id: String(task.id),
    targetId: String(task.targetId),
    targetType: task.targetType,
    note: String(task.note),
    severity: normalizeSeverity(task.severity),
    createdAt: String(task.createdAt),
    completed: Boolean(task.completed),
  };
}

function IdAction({
  token,
  targetType,
  onAddTask,
}: {
  token: string;
  targetType: TaskTargetType;
  onAddTask: (task: PendingNote & { note: string; severity: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState(DEFAULT_SEVERITY);
  const trimmed = note.trim();

  function submit() {
    if (!trimmed) return;
    onAddTask({ targetId: token, targetType, note: trimmed, severity });
    setNote("");
    setSeverity(DEFAULT_SEVERITY);
    setOpen(false);
  }

  return (
    <span className="gpt-id-action">
      <span className={`gpt-id-chip ${targetType}`}>{token}</span>
      <button
        className="gpt-id-plus"
        type="button"
        aria-label={`Add note for ${token}`}
        title={`Add note for ${token}`}
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
      {open ? (
        <span className="gpt-note-popover">
          <textarea
            value={note}
            rows={2}
            placeholder={`Note for ${token}`}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
              if (event.key === "Escape") {
                setOpen(false);
              }
            }}
            autoFocus
          />
          <label className="gpt-note-severity">
            <span>Severity</span>
            <select value={severity} onChange={(event) => setSeverity(normalizeSeverity(event.target.value))}>
              {SEVERITY_OPTIONS.map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <span className="gpt-note-actions">
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary" disabled={!trimmed} onClick={submit}>
              Send
            </button>
          </span>
        </span>
      ) : null}
    </span>
  );
}

function renderIds(children: ReactNode, onAddTask?: (task: PendingNote & { note: string; severity: number }) => void): ReactNode {
  if (!onAddTask) return children;

  return Children.map(children, (child) => {
    if (typeof child === "string") {
      const nodes: ReactNode[] = [];
      let lastIndex = 0;

      for (const match of child.matchAll(ID_PATTERN)) {
        const token = match[0];
        const index = match.index ?? 0;
        const targetType = targetTypeFor(token);

        if (!targetType) continue;
        if (index > lastIndex) nodes.push(child.slice(lastIndex, index));
        nodes.push(
          <IdAction
            key={`${token}-${index}-${nodes.length}`}
            token={token}
            targetType={targetType}
            onAddTask={onAddTask}
          />,
        );
        lastIndex = index + token.length;
      }

      if (lastIndex === 0) return child;
      if (lastIndex < child.length) nodes.push(child.slice(lastIndex));
      return nodes;
    }

    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children) {
      return {
        ...child,
        props: {
          ...child.props,
          children: renderIds(child.props.children, onAddTask),
        },
      };
    }

    return child;
  });
}

function MarkdownMessage({
  text,
  streaming,
  onAddTask,
}: {
  text: string;
  streaming?: boolean;
  onAddTask?: (task: PendingNote & { note: string; severity: number }) => void;
}) {
  const idRenderer = streaming ? undefined : onAddTask;
  const recommendedActions = !streaming && onAddTask ? extractRecommendedActions(text) : new Set<string>();
  const inferredSampleId = inferSampleId(text);

  return (
    <div className="gpt-message-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{renderIds(children, idRenderer)}</p>,
          li: ({ children }) => {
            const note = normalizeActionText(textFromReactNode(children));
            const followUpSampleId = idRenderer && inferredSampleId && recommendedActions.has(note) ? inferredSampleId : null;

            return (
              <li className={followUpSampleId ? "gpt-follow-up-action" : undefined}>
                {followUpSampleId ? (
                  <button
                    className="gpt-follow-up-plus"
                    type="button"
                    aria-label={`Add follow-up task for ${followUpSampleId}`}
                    title="Add as task"
                    onClick={() =>
                      onAddTask?.({
                        targetId: followUpSampleId,
                        targetType: "sample",
                        note,
                        severity: DEFAULT_SEVERITY,
                      })
                    }
                  >
                    +
                  </button>
                ) : null}
                <span>{renderIds(children, idRenderer)}</span>
              </li>
            );
          },
          h2: ({ children }) => <h2>{renderIds(children, idRenderer)}</h2>,
          h3: ({ children }) => <h3>{renderIds(children, idRenderer)}</h3>,
          h4: ({ children }) => <h4>{renderIds(children, idRenderer)}</h4>,
          strong: ({ children }) => <strong>{renderIds(children, idRenderer)}</strong>,
          em: ({ children }) => <em>{renderIds(children, idRenderer)}</em>,
          td: ({ children }) => <td>{renderIds(children, idRenderer)}</td>,
          th: ({ children }) => <th>{renderIds(children, idRenderer)}</th>,
          table: ({ children }) => (
            <div className="gpt-table-wrap">
              <table className="gpt-markdown-table">{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
      {streaming && <span className="gpt-cursor" />}
    </div>
  );
}

export default function ChatPage() {
  const initialConversation = useRef(newConversation());
  const [conversations, setConversations] = useState<Conversation[]>([initialConversation.current]);
  const [activeId, setActiveId] = useState<string>(initialConversation.current.id);
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const tasksHydrated = useRef(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");
  const [editSeverity, setEditSeverity] = useState(DEFAULT_SEVERITY);
  const [exportStatus, setExportStatus] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sampleIds, setSampleIds] = useState<string[]>(FALLBACK_SAMPLE_IDS);
  const [selectedSampleId, setSelectedSampleId] = useState(FALLBACK_SAMPLE_IDS[0]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const active = conversations.find((c) => c.id === activeId) ?? conversations[0];
  const messages = active.messages;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [activeId]);

  useEffect(() => {
    let cancelled = false;

    async function loadSampleIds() {
      try {
        const res = await fetch("/api/chat", { method: "GET" });
        if (!res.ok) return;
        const payload = await res.json();
        const ids = Array.isArray(payload.sampleIds)
          ? payload.sampleIds.filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0)
          : [];
        if (cancelled || ids.length === 0) return;

        setSampleIds(ids);
        setSelectedSampleId((current) => (ids.includes(current) ? current : ids[0]));
      } catch {
        // Keep the fallback IDs when the database is not available yet.
      }
    }

    loadSampleIds();
    return () => {
      cancelled = true;
    };
  }, []);

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

  function updateMessages(id: string, updater: (msgs: Message[]) => Message[]) {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, messages: updater(c.messages) } : c)),
    );
  }

  function setTitle(id: string, title: string) {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  }

  function markQaSummaryGenerated(id: string) {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, qaSummaryGenerated: true } : c)));
  }

  function startNewConversation() {
    const c = newConversation();
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
    setInput("");
  }

  function deleteConversation(id: string) {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (next.length === 0) {
        const fresh = newConversation();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  }

  function addTask(task: PendingNote & { note: string; severity: number }) {
    setTasks((prev) => {
      const normalizedNote = normalizeActionText(task.note);
      if (!normalizedNote) return prev;
      const isDuplicate = prev.some(
        (existing) =>
          existing.targetId === task.targetId &&
          existing.targetType === task.targetType &&
          normalizeActionText(existing.note).toLowerCase() === normalizedNote.toLowerCase(),
      );
      if (isDuplicate) return prev;

      return [
        {
          id: crypto.randomUUID(),
          targetId: task.targetId,
          targetType: task.targetType,
          note: normalizedNote,
          severity: normalizeSeverity(task.severity),
          createdAt: new Date().toISOString(),
          completed: false,
        },
        ...prev,
      ];
    });
  }

  function addRecommendedActionTasks(sampleId: string, markdown: string) {
    const actions = Array.from(extractRecommendedActions(markdown));
    if (actions.length === 0) return;

    setTasks((prev) => {
      const existingKeys = new Set(
        prev.map((task) =>
          [task.targetType, task.targetId, normalizeActionText(task.note).toLowerCase()].join("|"),
        ),
      );
      const createdAt = new Date().toISOString();
      const newTasks = actions
        .map((note) => ({
          id: crypto.randomUUID(),
          targetId: sampleId,
          targetType: "sample" as const,
          note,
          severity: DEFAULT_SEVERITY,
          createdAt,
          completed: false,
        }))
        .filter((task) => {
          const key = [task.targetType, task.targetId, normalizeActionText(task.note).toLowerCase()].join("|");
          if (existingKeys.has(key)) return false;
          existingKeys.add(key);
          return true;
        });

      return newTasks.length > 0 ? [...newTasks, ...prev] : prev;
    });
  }

  function toggleTask(id: string) {
    setTasks((prev) =>
      prev.map((task) => (task.id === id ? { ...task, completed: !task.completed } : task)),
    );
  }

  function deleteTask(id: string) {
    setTasks((prev) => prev.filter((task) => task.id !== id));
  }

  function beginEditTask(task: TodoTask) {
    setEditingTaskId(task.id);
    setEditNote(task.note);
    setEditSeverity(task.severity);
  }

  function cancelEditTask() {
    setEditingTaskId(null);
    setEditNote("");
    setEditSeverity(DEFAULT_SEVERITY);
  }

  function saveEditTask(id: string) {
    const trimmed = editNote.trim();
    if (!trimmed) return;

    setTasks((prev) =>
      prev.map((task) =>
        task.id === id
          ? {
              ...task,
              note: trimmed,
              severity: normalizeSeverity(editSeverity),
            }
          : task,
      ),
    );
    cancelEditTask();
  }

  function tasksAsMarkdown() {
    const lines = ["# Clinical Chat To-do", ""];

    if (tasks.length === 0) {
      lines.push("_No tasks yet._");
      return lines.join("\n");
    }

    tasks.forEach((task) => {
      lines.push(
        `- [${task.completed ? "x" : " "}] **${task.targetId}** (${task.targetType}, severity ${task.severity}/5): ${task.note}`,
      );
      lines.push(`  - Created: ${new Date(task.createdAt).toLocaleString()}`);
    });

    return lines.join("\n");
  }

  function downloadText(filename: string, content: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportObsidian() {
    downloadText("clinical-chat-todo.md", tasksAsMarkdown(), "text/markdown;charset=utf-8");
    setExportStatus("Obsidian Markdown exported.");
  }

  async function exportNotion() {
    const markdown = tasksAsMarkdown();
    try {
      await navigator.clipboard.writeText(markdown);
      setExportStatus("Notion-ready Markdown copied.");
    } catch {
      downloadText("clinical-chat-todo-for-notion.md", markdown, "text/markdown;charset=utf-8");
      setExportStatus("Clipboard unavailable; Markdown downloaded.");
    }
  }

  function calendarTimestamp(date: Date) {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  function escapeIcsText(value: string) {
    return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
  }

  function exportCalendar() {
    const now = new Date();
    const due = new Date(now.getTime() + 60 * 60 * 1000);
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Clinical Chat//Todo Tasks//EN",
      "CALSCALE:GREGORIAN",
    ];

    tasks.forEach((task) => {
      lines.push(
        "BEGIN:VTODO",
        `UID:${task.id}@clinical-chat`,
        `DTSTAMP:${calendarTimestamp(now)}`,
        `DUE:${calendarTimestamp(due)}`,
        `SUMMARY:${escapeIcsText(`${task.targetId} follow-up`)}`,
        `DESCRIPTION:${escapeIcsText(`${task.note}\nType: ${task.targetType}\nSeverity: ${task.severity}/5`)}`,
        `STATUS:${task.completed ? "COMPLETED" : "NEEDS-ACTION"}`,
        "END:VTODO",
      );
    });

    lines.push("END:VCALENDAR");
    downloadText("clinical-chat-tasks.ics", lines.join("\r\n"), "text/calendar;charset=utf-8");
    setExportStatus("Calendar task file exported.");
  }

  async function send(text?: string, options: SendOptions = {}) {
    const message = (text ?? input).trim();
    if (!message || busy) return;

    setInput("");
    setBusy(true);

    const isFirst = active.messages.length === 0;
    const convId = activeId;

    updateMessages(convId, (msgs) => [
      ...msgs,
      { role: "user", text: message },
      { role: "assistant", text: "", streaming: true },
    ]);

    if (isFirst) {
      setTitle(convId, message.length > 48 ? message.slice(0, 48) + "..." : message);
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, ...options }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        updateMessages(convId, (msgs) => {
          const next = [...msgs];
          next[next.length - 1] = { role: "assistant", text: `Error: ${err.error}` };
          return next;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        const snapshot = accumulated;
        updateMessages(convId, (msgs) => {
          const next = [...msgs];
          next[next.length - 1] = { role: "assistant", text: snapshot, streaming: true };
          return next;
        });
      }

      updateMessages(convId, (msgs) => {
        const next = [...msgs];
        next[next.length - 1] = { role: "assistant", text: accumulated };
        return next;
      });

      if (options.intent === "qa-summary") {
        const summarySampleId = options.sampleId || inferSampleId(accumulated);
        if (summarySampleId) addRecommendedActionTasks(summarySampleId, accumulated);
        markQaSummaryGenerated(convId);
      }
    } catch (err) {
      updateMessages(convId, (msgs) => {
        const next = [...msgs];
        next[next.length - 1] = {
          role: "assistant",
          text: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  function generateQaSummary() {
    const sampleId = selectedSampleId || sampleIds[0];
    if (!sampleId) return;
    send(
      `Create a concise QA report summary for sample ${sampleId}. Include overall status, key QC metrics, coverage concerns, mapping/on-target quality, duplication or soft-clipping concerns, and recommended follow-up actions.`,
      { intent: "qa-summary", sampleId },
    );
  }

  return (
    <div className="gpt-shell">
      <aside className="gpt-sidebar">
        <button className="gpt-new-chat" onClick={startNewConversation}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          New conversation
        </button>

        <nav className="gpt-history">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`gpt-history-item ${c.id === activeId ? "active" : ""}`}
              onClick={() => setActiveId(c.id)}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="gpt-history-icon" aria-hidden="true">
                <path d="M2 2a1 1 0 011-1h8a1 1 0 011 1v7a1 1 0 01-1 1H5L2 13V2z" fill="currentColor" opacity=".7" />
              </svg>
              <span className="gpt-history-title">{c.title}</span>
              <button
                className="gpt-history-delete"
                aria-label="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteConversation(c.id);
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </nav>

        <div className="gpt-sidebar-footer">
          <span className="gpt-indicator" />
          Clinical AI Assistant
        </div>
      </aside>

      <div className="gpt-main">
        {messages.length === 0 ? (
          <div className="gpt-welcome">
            <div className="gpt-welcome-icon">
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
                <circle cx="18" cy="18" r="18" fill="#3f60db" opacity=".12" />
                <path d="M8 14a3 3 0 013-3h14a3 3 0 013 3v8a3 3 0 01-3 3H13l-5 5V14z" fill="#3f60db" />
              </svg>
            </div>
            <h2 className="gpt-welcome-title">Clinical Genomics Assistant</h2>
            <p className="gpt-welcome-sub">
              Ask questions about the NGS quality reports and genomics documents loaded into the knowledge base.
            </p>
            <div className="gpt-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="gpt-suggestion" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
            <div className="gpt-sample-summary" aria-label="Create QA report summary">
              <label htmlFor="qa-sample-select">QA report summary</label>
              <div className="gpt-sample-summary-row">
                <select
                  id="qa-sample-select"
                  value={selectedSampleId}
                  onChange={(event) => setSelectedSampleId(event.target.value)}
                  disabled={busy || sampleIds.length === 0}
                >
                  {sampleIds.map((id) => (
                    <option value={id} key={id}>
                      {id}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={generateQaSummary} disabled={busy || sampleIds.length === 0}>
                  Generate summary
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="gpt-messages">
            {messages.map((msg, i) => (
              <div key={i} className={`gpt-row ${msg.role === "user" ? "gpt-row-user" : "gpt-row-assistant"}`}>
                <div className="gpt-avatar">
                  {msg.role === "user" ? (
                    <span className="gpt-avatar-user">H4</span>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                      <path d="M3 5a2 2 0 012-2h8a2 2 0 012 2v6a2 2 0 01-2 2H6l-3 3V5z" fill="white" />
                    </svg>
                  )}
                </div>
                <div className="gpt-message">
                  <span className="gpt-message-role">{msg.role === "user" ? "You" : "Assistant"}</span>
                  <MarkdownMessage
                    text={msg.text}
                    streaming={msg.streaming}
                    onAddTask={msg.role === "assistant" ? addTask : undefined}
                  />
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        <div className="gpt-input-wrap">
          {messages.length > 0 && !active.qaSummaryGenerated ? (
            <div className="gpt-inline-summary" aria-label="Create QA report summary">
              <select
                value={selectedSampleId}
                onChange={(event) => setSelectedSampleId(event.target.value)}
                disabled={busy || sampleIds.length === 0}
              >
                {sampleIds.map((id) => (
                  <option value={id} key={id}>
                    {id}
                  </option>
                ))}
              </select>
              <button type="button" onClick={generateQaSummary} disabled={busy || sampleIds.length === 0}>
                QA summary
              </button>
            </div>
          ) : null}
          <div className="gpt-input-box">
            <textarea
              ref={inputRef}
              className="gpt-input"
              placeholder="Message Clinical AI Assistant..."
              rows={1}
              value={input}
              onChange={autoResize}
              onKeyDown={handleKeyDown}
              disabled={busy}
            />
            <button
              className="gpt-send"
              aria-label="Send message"
              onClick={() => send()}
              disabled={!input.trim() || busy}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M1 8l13-6-6 13V8H1z" fill="currentColor" />
              </svg>
            </button>
          </div>
          <p className="gpt-input-hint">Press Enter to send - Shift+Enter for new line</p>
        </div>
      </div>

      <aside className="gpt-todo-panel" aria-label="To-do task list">
        <div className="gpt-todo-header">
          <span>To-do</span>
          <b>{tasks.length}</b>
        </div>
        <div className="gpt-export-actions" aria-label="Export tasks">
          <button type="button" onClick={exportObsidian} disabled={tasks.length === 0}>
            Obsidian
          </button>
          <button type="button" onClick={exportNotion} disabled={tasks.length === 0}>
            Notion
          </button>
          <button type="button" onClick={exportCalendar} disabled={tasks.length === 0}>
            Calendar
          </button>
        </div>
        {exportStatus ? <p className="gpt-export-status">{exportStatus}</p> : null}
        {tasks.length === 0 ? (
          <p className="gpt-todo-empty">Add notes from sample or gene IDs in assistant answers.</p>
        ) : (
          <div className="gpt-todo-list">
            {tasks.map((task) => (
              <article className={`gpt-todo-item ${task.completed ? "completed" : ""}`} key={task.id}>
                <button
                  className="gpt-todo-check"
                  type="button"
                  aria-label={task.completed ? "Mark task incomplete" : "Mark task complete"}
                  onClick={() => toggleTask(task.id)}
                >
                  {task.completed ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path d="M2 6.2l2.3 2.3L10 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </button>
                <div className="gpt-todo-body">
                  <div className="gpt-todo-meta">
                    <span className={task.targetType}>{task.targetId}</span>
                    <small>{task.targetType}</small>
                    <strong className={`gpt-severity severity-${task.severity}`}>S{task.severity}</strong>
                  </div>
                  {editingTaskId === task.id ? (
                    <div className="gpt-todo-edit">
                      <textarea
                        value={editNote}
                        rows={3}
                        onChange={(event) => setEditNote(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            saveEditTask(task.id);
                          }
                          if (event.key === "Escape") {
                            cancelEditTask();
                          }
                        }}
                        autoFocus
                      />
                      <label>
                        <span>Severity</span>
                        <select value={editSeverity} onChange={(event) => setEditSeverity(normalizeSeverity(event.target.value))}>
                          {SEVERITY_OPTIONS.map((value) => (
                            <option value={value} key={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="gpt-todo-edit-actions">
                        <button type="button" onClick={cancelEditTask}>
                          Cancel
                        </button>
                        <button type="button" className="primary" disabled={!editNote.trim()} onClick={() => saveEditTask(task.id)}>
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="gpt-todo-note">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.note}</ReactMarkdown>
                    </div>
                  )}
                </div>
                {editingTaskId === task.id ? null : (
                  <button
                    className="gpt-todo-edit-button"
                    type="button"
                    aria-label={`Edit task for ${task.targetId}`}
                    title={`Edit task for ${task.targetId}`}
                    onClick={() => beginEditTask(task)}
                  >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                      <path d="M2 9.7V11h1.3l6.2-6.2-1.3-1.3L2 9.7zM9 2.7l1.3-1.3 1.3 1.3-1.3 1.3L9 2.7z" fill="currentColor" />
                    </svg>
                  </button>
                )}
                <button
                  className="gpt-todo-delete"
                  type="button"
                  aria-label={`Delete task for ${task.targetId}`}
                  onClick={() => deleteTask(task.id)}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </article>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
