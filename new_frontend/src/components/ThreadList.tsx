import { Plus, Trash2, MessageSquare } from "lucide-react";
import type { Thread } from "@/lib/threads";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function ThreadList({
  threads,
  activeId,
  onSelect,
  onCreate,
  onDelete,
}: {
  threads: Thread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col border-r bg-sidebar">
      <div className="flex items-center justify-between border-b px-3 py-3">
        <span className="font-medium text-sm">Conversations</span>
        <Button size="sm" variant="default" onClick={onCreate} className="h-7 gap-1 px-2">
          <Plus className="size-3.5" />
          New
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {threads.length === 0 && (
          <p className="px-2 py-4 text-center text-muted-foreground text-xs">
            No conversations yet
          </p>
        )}
        <ul className="space-y-1">
          {threads.map((t) => {
            const isActive = t.id === activeId;
            return (
              <li
                key={t.id}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/50",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(t.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{t.title}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(t.id)}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="Delete conversation"
                >
                  <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
