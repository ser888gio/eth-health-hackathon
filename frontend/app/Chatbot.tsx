"use client";

import { useEffect, useRef, useState } from "react";
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
};

function MarkdownMessage({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div className="gpt-message-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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

const SUGGESTIONS = [
  "What is the overall quality of this sequencing run?",
  "Which genes have low coverage regions?",
  "Summarize the key QA findings",
  "What are the recurrent low-coverage regions?",
  "Are there any coverage warnings I should be aware of?",
];

function newConversation(): Conversation {
  return { id: crypto.randomUUID(), title: "New conversation", messages: [] };
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([newConversation()]);
  const [activeId, setActiveId] = useState<string>(conversations[0].id);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const active = conversations.find((c) => c.id === activeId)!;
  const messages = active.messages;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [activeId]);

  function updateMessages(id: string, updater: (msgs: Message[]) => Message[]) {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, messages: updater(c.messages) } : c))
    );
  }

  function setTitle(id: string, title: string) {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c))
    );
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

  async function send(text?: string) {
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
      setTitle(convId, message.length > 48 ? message.slice(0, 48) + "…" : message);
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
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

  return (
    <div className="gpt-shell">
      {/* Sidebar */}
      <aside className="gpt-sidebar">
        <button className="gpt-new-chat" onClick={startNewConversation}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
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
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="gpt-history-icon">
                <path d="M2 2a1 1 0 011-1h8a1 1 0 011 1v7a1 1 0 01-1 1H5L2 13V2z" fill="currentColor" opacity=".7" />
              </svg>
              <span className="gpt-history-title">{c.title}</span>
              <button
                className="gpt-history-delete"
                aria-label="Delete"
                onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
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

      {/* Main */}
      <div className="gpt-main">
        {messages.length === 0 ? (
          <div className="gpt-welcome">
            <div className="gpt-welcome-icon">
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
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
          </div>
        ) : (
          <div className="gpt-messages">
            {messages.map((msg, i) => (
              <div key={i} className={`gpt-row ${msg.role === "user" ? "gpt-row-user" : "gpt-row-assistant"}`}>
                <div className="gpt-avatar">
                  {msg.role === "user" ? (
                    <span className="gpt-avatar-user">H4</span>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                      <path d="M3 5a2 2 0 012-2h8a2 2 0 012 2v6a2 2 0 01-2 2H6l-3 3V5z" fill="white" />
                    </svg>
                  )}
                </div>
                <div className="gpt-message">
                  <span className="gpt-message-role">
                    {msg.role === "user" ? "You" : "Assistant"}
                  </span>
                  <MarkdownMessage text={msg.text} streaming={msg.streaming} />
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Input */}
        <div className="gpt-input-wrap">
          <div className="gpt-input-box">
            <textarea
              ref={inputRef}
              className="gpt-input"
              placeholder="Message Clinical AI Assistant…"
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
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M1 8l13-6-6 13V8H1z" fill="currentColor" />
              </svg>
            </button>
          </div>
          <p className="gpt-input-hint">Press Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
}
