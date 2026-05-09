import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useRef, useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Upload, FileText, X, ArrowRight, MessagesSquare, Trash2, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBytes, type UploadedFile } from "@/lib/uploads";
import { uploadFiles } from "@/lib/uploads.functions";
import { ragIndexFiles } from "@/lib/rag/client.functions";
import {
  loadThreads,
  saveThreads,
  createThreadFromFiles,
  setActiveThreadId,
  type Thread,
} from "@/lib/threads";
import { DnaSpinner } from "@/components/DnaSpinner";

export const Route = createFileRoute("/")({
  component: UploadPage,
  head: () => ({
    meta: [
      { title: "Upload genomics files — Hereditary Cancer Solutions" },
      {
        name: "description",
        content:
          "Upload medical genomics files (VCF, BAM, CSV, PDF) to begin retrieval-augmented analysis for hereditary cancer solutions.",
      },
    ],
  }),
});

const ACCEPTED = ".vcf,.bam,.csv,.tsv,.pdf,.txt,.json,.xml,.fasta,.fastq";

type Phase = "idle" | "uploading" | "indexing" | "error";

function UploadPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const upload = useServerFn(uploadFiles);
  const indexFiles = useServerFn(ragIndexFiles);

  useEffect(() => {
    setThreads(loadThreads());
  }, []);

  const addFiles = (incoming: FileList | File[]) => {
    setPending((prev) => [...prev, ...Array.from(incoming)]);
  };

  const removeFile = (idx: number) =>
    setPending((prev) => prev.filter((_, i) => i !== idx));

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const handleAnalyze = async () => {
    if (pending.length === 0 || phase === "uploading" || phase === "indexing") return;
    setPhase("uploading");
    setStatusMsg(`Uploading ${pending.length} file${pending.length === 1 ? "" : "s"}…`);
    try {
      const fd = new FormData();
      for (const f of pending) fd.append("file", f, f.name);
      const stored: UploadedFile[] = await upload({ data: fd });

      setPhase("indexing");
      setStatusMsg("Indexing files for retrieval…");
      const indexed = await indexFiles({ data: { files: stored } });
      if (!indexed.ok) {
        setStatusMsg(indexed.message ?? "Indexing reported a problem; continuing.");
      }

      const t = createThreadFromFiles(stored);
      const next = [t, ...threads];
      saveThreads(next);
      setActiveThreadId(t.id);
      navigate({ to: "/analyze" });
    } catch (err) {
      console.error("[upload] failed:", err);
      setPhase("error");
      setStatusMsg(
        `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const openExisting = (id: string) => {
    setActiveThreadId(id);
    navigate({ to: "/analyze" });
  };

  const deleteExisting = (id: string) => {
    const next = threads.filter((t) => t.id !== id);
    saveThreads(next);
    setThreads(next);
  };

  const busy = phase === "uploading" || phase === "indexing";

  return (
    <main className="flex min-h-screen flex-col items-center bg-background px-6 py-12">
      <div className="w-full max-w-2xl">
        <header className="mb-10 flex items-center gap-3">
          <DnaSpinner className="size-12 text-primary" />
          <div>
            <h1 className="font-semibold text-2xl leading-tight">
              Hereditary Cancer Solutions
            </h1>
            <p className="text-muted-foreground text-sm">
              Upload a set of genomics files to start a new analysis
            </p>
          </div>
        </header>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => !busy && inputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-card px-6 py-14 text-center transition-colors",
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
            busy && "pointer-events-none opacity-60",
          )}
        >
          <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Upload className="size-6" />
          </div>
          <p className="font-medium text-base">Drop files or a folder here, or click to browse</p>
          <p className="mt-1 text-muted-foreground text-sm">
            VCF · BAM · CSV · PDF · FASTA · clinical notes
          </p>
          <p className="mt-3 text-muted-foreground text-xs">
            All files dropped together become <span className="font-medium text-foreground">one analysis</span>.
          </p>
          <div className="mt-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
              Choose files
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => folderRef.current?.click()} disabled={busy}>
              Choose folder
            </Button>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
          <input
            ref={folderRef}
            type="file"
            multiple
            // @ts-expect-error - non-standard but widely supported
            webkitdirectory=""
            directory=""
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
        </div>

        {pending.length > 0 && (
          <div className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium text-sm">
                {pending.length} file{pending.length === 1 ? "" : "s"} in this batch
              </h2>
              <span className="text-muted-foreground text-xs">
                Total {formatBytes(pending.reduce((s, f) => s + f.size, 0))}
              </span>
            </div>
            <ul className="divide-y rounded-lg border bg-card">
              {pending.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-3 px-4 py-3">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm">{f.name}</p>
                    <p className="text-muted-foreground text-xs">{formatBytes(f.size)}</p>
                  </div>
                  <button type="button" onClick={() => removeFile(i)} aria-label={`Remove ${f.name}`} disabled={busy} className="text-muted-foreground hover:text-destructive disabled:opacity-40">
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {statusMsg && (
          <div
            className={cn(
              "mt-6 flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
              phase === "error"
                ? "border-destructive/40 bg-destructive/5 text-destructive"
                : "border-primary/30 bg-primary/5 text-foreground",
            )}
          >
            {phase === "uploading" || phase === "indexing" ? (
              <Loader2 className="size-4 animate-spin text-primary" />
            ) : phase === "error" ? (
              <AlertTriangle className="size-4" />
            ) : (
              <CheckCircle2 className="size-4 text-primary" />
            )}
            <span>{statusMsg}</span>
          </div>
        )}

        <div className="mt-8 flex items-center justify-end">
          <Button size="lg" disabled={pending.length === 0 || busy} onClick={handleAnalyze} className="gap-2">
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {phase === "uploading" ? "Uploading…" : "Indexing…"}
              </>
            ) : (
              <>
                Start new analysis
                <ArrowRight className="size-4" />
              </>
            )}
          </Button>
        </div>

        {threads.length > 0 && (
          <section className="mt-14">
            <h2 className="mb-3 font-medium text-sm text-muted-foreground uppercase tracking-wider">
              Previous analyses
            </h2>
            <ul className="divide-y rounded-lg border bg-card">
              {threads.map((t) => (
                <li key={t.id} className="group flex items-center gap-3 px-4 py-3">
                  <MessagesSquare className="size-4 shrink-0 text-muted-foreground" />
                  <button
                    type="button"
                    onClick={() => openExisting(t.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate font-medium text-sm">{t.title}</p>
                    <p className="text-muted-foreground text-xs">
                      {t.files.length} file{t.files.length === 1 ? "" : "s"} · {new Date(t.updatedAt).toLocaleDateString()}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteExisting(t.id)}
                    aria-label="Delete analysis"
                    className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-muted-foreground text-xs">
              Or <Link to="/analyze" className="underline hover:text-foreground">jump back into the workspace</Link>.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
