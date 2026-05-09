import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const CHECKLIST: { id: string; label: string }[] = [
  { id: "igv", label: "Confirm top variant in IGV (read-level evidence)" },
  { id: "sample", label: "Verify sample type (germline vs tumour)" },
  { id: "orthogonal", label: "Order orthogonal confirmation if pathogenic / likely pathogenic" },
  { id: "cnv", label: "Run / review CNV / LOH at top variant locus" },
  { id: "acmg", label: "Document ACMG evidence codes" },
  { id: "notify", label: "Notify treating clinician + refer to genetics if germline LP/P" },
  { id: "signoff", label: "Peer review / sign-out" },
];

const KEY = (patientId: string) => `hcs-checklist-${patientId}`;

export function PatientChecklist({ patientId }: { patientId: string }) {
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(KEY(patientId));
      setDone(raw ? JSON.parse(raw) : {});
    } catch {
      setDone({});
    }
  }, [patientId]);

  const toggle = (id: string) => {
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(KEY(patientId), JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const completed = CHECKLIST.filter((c) => done[c.id]).length;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-muted-foreground text-xs uppercase tracking-wider">
          Pathologist checklist
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {completed} / {CHECKLIST.length}
        </span>
      </div>
      <ul className="space-y-1.5">
        {CHECKLIST.map((item) => {
          const checked = !!done[item.id];
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => toggle(item.id)}
                className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                    checked
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card",
                  )}
                  aria-hidden
                >
                  {checked && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span
                  className={cn(
                    checked && "text-muted-foreground line-through",
                  )}
                >
                  {item.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
