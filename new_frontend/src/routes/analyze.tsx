import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { SummaryPanel } from "@/components/SummaryPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { Button } from "@/components/ui/button";
import {
  loadThreads,
  saveThreads,
  deriveTitleFromMessages,
  deriveTitleFromFiles,
  getActiveThreadId,
  setActiveThreadId,
  type Thread,
} from "@/lib/threads";
import type { UIMessage } from "ai";

export const Route = createFileRoute("/analyze")({
  component: Analyze,
  head: () => ({
    meta: [
      { title: "Analysis — Hereditary Cancer Solutions" },
      {
        name: "description",
        content:
          "Genomics summary and retrieval-augmented chat over uploaded hereditary cancer files.",
      },
    ],
  }),
});

function Analyze() {
  const navigate = useNavigate();
  const [bootstrapped, setBootstrapped] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activePatientId, setActivePatientId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || bootstrapped) return;
    const existing = loadThreads();
    if (existing.length === 0) {
      navigate({ to: "/" });
      return;
    }
    const stored = getActiveThreadId();
    const initial = existing.find((t) => t.id === stored)?.id ?? existing[0].id;
    setThreads(existing);
    setActiveId(initial);
    setActiveThreadId(initial);
    setBootstrapped(true);
  }, [bootstrapped, navigate]);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeId) ?? null,
    [threads, activeId],
  );

  const handleSelect = (id: string) => {
    setActiveId(id);
    setActiveThreadId(id);
  };

  const handleDelete = (id: string) => {
    setThreads((prev) => {
      const next = prev.filter((t) => t.id !== id);
      saveThreads(next);
      if (id === activeId) {
        const newActive = next[0]?.id ?? null;
        setActiveId(newActive);
        if (newActive) setActiveThreadId(newActive);
        if (!newActive) navigate({ to: "/" });
      }
      return next;
    });
  };

  const handleMessagesChange = (msgs: UIMessage[]) => {
    if (!activeId) return;
    setThreads((prev) => {
      const next = prev.map((t) => {
        if (t.id !== activeId) return t;
        const isFileTitle = t.title === deriveTitleFromFiles(t.files);
        const newTitle =
          isFileTitle && msgs.length > 0
            ? deriveTitleFromMessages(msgs) || t.title
            : t.title;
        return { ...t, messages: msgs, title: newTitle, updatedAt: Date.now() };
      });
      saveThreads(next);
      return next;
    });
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b bg-card px-4 py-2">
        <Link
          to="/"
          className="rounded-md px-2 py-1 text-muted-foreground text-sm hover:bg-accent hover:text-foreground"
        >
          ← Files
        </Link>
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <Link to="/">
            <Plus className="size-3.5" />
            New analysis
          </Link>
        </Button>
      </div>
      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-3">
        <div className="overflow-hidden border-r bg-card lg:col-span-2">
          <SummaryPanel
            files={activeThread?.files ?? []}
            activePatientId={activePatientId}
            onSelectPatient={setActivePatientId}
          />
        </div>
        <div className="overflow-hidden">
          {activeThread ? (
            <ChatPanel
              key={activeThread.id}
              threadId={activeThread.id}
              initialMessages={activeThread.messages}
              onMessagesChange={handleMessagesChange}
              threads={threads}
              activeId={activeId}
              onSelect={handleSelect}
              onDelete={handleDelete}
              onNewAnalysis={() => navigate({ to: "/" })}
              activePatientId={activePatientId}
              onClearPatient={() => setActivePatientId(null)}
              fileIds={activeThread.files.map((f) => f.id)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
