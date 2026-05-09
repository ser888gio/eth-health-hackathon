import { useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { useServerFn } from "@tanstack/react-start";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Dna, Plus, MessagesSquare, Trash2, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { Thread } from "@/lib/threads";
import { ragChat } from "@/lib/rag/client.functions";
import type { RagCitation } from "@/lib/rag/types";

type Status = "ready" | "submitted" | "streaming";

export function ChatPanel({
  threadId,
  initialMessages,
  onMessagesChange,
  threads,
  activeId,
  onSelect,
  onDelete,
  onNewAnalysis,
  activePatientId,
  onClearPatient,
  fileIds = [],
}: {
  threadId: string;
  initialMessages: UIMessage[];
  onMessagesChange: (messages: UIMessage[]) => void;
  threads: Thread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewAnalysis: () => void;
  activePatientId?: string | null;
  onClearPatient?: () => void;
  fileIds?: string[];
}) {
  const [messages, setMessages] = useState<UIMessage[]>(initialMessages);
  const [citations, setCitations] = useState<Record<string, RagCitation[]>>({});
  const [status, setStatus] = useState<Status>("ready");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset when thread changes
  useEffect(() => {
    setMessages(initialMessages);
    setStatus("ready");
  }, [threadId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist
  useEffect(() => {
    onMessagesChange(messages);
  }, [messages, onMessagesChange]);

  // Focus textarea on thread change / after send
  useEffect(() => {
    textareaRef.current?.focus();
  }, [threadId, status]);

  const chat = useServerFn(ragChat);

  const handleSubmit = async (msg: PromptInputMessage) => {
    const text = msg.text?.trim();
    if (!text || status !== "ready") return;

    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text }],
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setStatus("submitted");

    try {
      // Convert UIMessage history to the adapter's flat shape.
      const history = nextMessages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.parts
          .map((p) => (p.type === "text" ? p.text : ""))
          .join(""),
      }));
      setStatus("streaming");
      const result = await chat({
        data: {
          messages: history,
          patientId: activePatientId ?? null,
          fileIds,
        },
      });
      const aiId = crypto.randomUUID();
      const aiMsg: UIMessage = {
        id: aiId,
        role: "assistant",
        parts: [{ type: "text", text: result.text || "_(empty response)_" }],
      };
      if (result.citations && result.citations.length > 0) {
        setCitations((prev) => ({ ...prev, [aiId]: result.citations! }));
      }
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      const errMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [
          {
            type: "text",
            text: `**Chat failed.** \`${err instanceof Error ? err.message : String(err)}\``,
          },
        ],
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setStatus("ready");
    }
  };

  const isBusy = status === "submitted" || status === "streaming";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex items-center gap-2 border-b px-5 py-4">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Dna className="size-4" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-sm leading-tight">Genomics Assistant</h2>
          <p className="text-muted-foreground text-xs">Retrieval-augmented over your cohort</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <MessagesSquare className="size-3.5" />
              <span className="max-w-[140px] truncate">
                {threads.find((t) => t.id === activeId)?.title ?? "Conversations"}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onClick={onNewAnalysis} className="gap-2">
              <Plus className="size-3.5" />
              New analysis (upload files)
            </DropdownMenuItem>
            {threads.length > 0 && <DropdownMenuSeparator />}
            {threads.map((t) => (
              <DropdownMenuItem
                key={t.id}
                onClick={() => onSelect(t.id)}
                className="group flex items-center gap-2"
              >
                <span className="flex-1 truncate">{t.title}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(t.id);
                  }}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="Delete"
                >
                  <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Conversation className="flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl">
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<Dna className="size-8" />}
              title="Ask about the cohort"
              description="Try: 'Which families carry BRCA1 pathogenic variants?' or 'Summarize Lynch syndrome findings.'"
            />
          ) : (
            messages.map((m) => {
              const text = m.parts
                .map((p) => (p.type === "text" ? p.text : ""))
                .join("");
              return (
                <Message key={m.id} from={m.role}>
                  {m.role === "user" ? (
                    <MessageContent className="group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground">
                      {text}
                    </MessageContent>
                  ) : (
                    <MessageContent>
                      <MessageResponse>{text}</MessageResponse>
                      {citations[m.id] && citations[m.id].length > 0 && (
                        <div className="mt-3 border-t border-border/50 pt-2">
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Sources
                          </p>
                          <ol className="space-y-1 text-xs">
                            {citations[m.id].map((c, i) => (
                              <li key={i} className="flex gap-2">
                                <span className="text-muted-foreground tabular-nums">
                                  {i + 1}.
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="font-medium">{c.label}</span>
                                  {c.locator != null && (
                                    <span className="text-muted-foreground">
                                      {" "}· {c.locator}
                                    </span>
                                  )}
                                  {c.snippet && (
                                    <span className="mt-0.5 block truncate text-muted-foreground italic">
                                      “{c.snippet}”
                                    </span>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </MessageContent>
                  )}
                </Message>
              );
            })
          )}
          {status === "submitted" && (
            <Message from="assistant">
              <MessageContent>
                <Shimmer>Searching genomic files…</Shimmer>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t p-4">
        <div className="mx-auto w-full max-w-3xl">
          {activePatientId && (
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-primary text-xs font-medium">
                Asking about {activePatientId}
                <button
                  type="button"
                  onClick={onClearPatient}
                  aria-label="Clear patient scope"
                  className="rounded-full p-0.5 hover:bg-primary/20"
                >
                  <X className="size-3" />
                </button>
              </span>
            </div>
          )}
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea
              ref={textareaRef}
              placeholder="Ask about variants, families, guidelines…"
              disabled={isBusy}
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit status={status} disabled={isBusy} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
