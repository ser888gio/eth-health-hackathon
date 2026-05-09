/**
 * Deterministic gene & variant visualization for the Case Dashboard.
 *
 * Everything here is computed from a hash of the patient ID — same patient,
 * same picture every time. No AI, no real alignment. The intent is to give a
 * pathologist a fast visual sanity check (gene track + variant pins, coverage
 * track, ±20 bp sequence context, and a small static IGV-lite schematic).
 */

import { useMemo, useState, forwardRef } from "react";
import { AlertTriangle, Dna, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------- Deterministic helpers ---------- */

function hashSeed(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GENE_POOL = [
  { gene: "BRCA1", chr: "17" },
  { gene: "BRCA2", chr: "13" },
  { gene: "MLH1", chr: "3" },
  { gene: "MSH2", chr: "2" },
  { gene: "TP53", chr: "17" },
  { gene: "PALB2", chr: "16" },
];

const BASES = ["A", "C", "G", "T"] as const;
const CONSEQUENCES = [
  "missense",
  "nonsense",
  "splice",
  "frameshift",
  "synonymous",
] as const;
const ZYGOSITY = ["heterozygous", "homozygous"] as const;
const CLASSIFICATION = ["VUS", "Likely pathogenic", "Pathogenic", "Benign"] as const;

export type Variant = {
  id: string;
  exon: number;
  /** position along the gene track, 0..1 */
  pos: number;
  hgvsC: string;
  hgvsP: string;
  vaf: number;
  depth: number;
  zygosity: (typeof ZYGOSITY)[number];
  consequence: (typeof CONSEQUENCES)[number];
  classification: (typeof CLASSIFICATION)[number];
  refBase: (typeof BASES)[number];
  altBase: (typeof BASES)[number];
};

export type Exon = {
  index: number;
  start: number; // 0..1
  end: number; // 0..1
  coverage: number; // 0..200x
};

export type GeneModel = {
  gene: string;
  chr: string;
  exons: Exon[];
  variants: Variant[];
  /** seed used to generate the surrounding sequence per variant */
  seed: number;
};

/* ---------- Build the deterministic gene model ---------- */

export function buildGeneModel(patientId: string): GeneModel {
  const seed = hashSeed("gene:" + patientId);
  const rand = mulberry32(seed);

  const { gene, chr } = GENE_POOL[seed % GENE_POOL.length];
  const exonCount = 8 + (seed % 6);

  // Lay exons across the track with intronic gaps.
  const slots = exonCount * 2 + 1; // intron, exon, intron, exon, ... intron
  let cursor = 0;
  const exons: Exon[] = [];
  const slotWidth = 1 / slots;
  for (let i = 0; i < exonCount; i++) {
    cursor += slotWidth; // intron
    const start = cursor;
    const widthJitter = 0.6 + rand() * 0.8;
    const end = Math.min(1, start + slotWidth * widthJitter);
    cursor = end;
    const cov = Math.round(20 + rand() * 180);
    exons.push({ index: i + 1, start, end, coverage: cov });
  }

  const variantCount = 2 + (seed % 3);
  const variants: Variant[] = [];
  for (let i = 0; i < variantCount; i++) {
    const exon = exons[Math.floor(rand() * exons.length)];
    const pos = exon.start + rand() * (exon.end - exon.start);
    const ref = BASES[Math.floor(rand() * 4)];
    let alt = BASES[Math.floor(rand() * 4)];
    if (alt === ref) alt = BASES[(BASES.indexOf(ref) + 1) % 4];
    const cdsPos = 100 + Math.floor(rand() * 5800);
    const aaPos = Math.max(1, Math.floor(cdsPos / 3));
    const consequence = CONSEQUENCES[Math.floor(rand() * CONSEQUENCES.length)];
    const classification =
      consequence === "synonymous"
        ? "Benign"
        : CLASSIFICATION[Math.floor(rand() * CLASSIFICATION.length)];
    variants.push({
      id: `v${i}`,
      exon: exon.index,
      pos,
      hgvsC: `c.${cdsPos}${ref}>${alt}`,
      hgvsP: `p.${threeLetter(ref)}${aaPos}${threeLetter(alt)}`,
      vaf: Math.round((0.18 + rand() * 0.7) * 100) / 100,
      depth: 30 + Math.floor(rand() * 220),
      zygosity: ZYGOSITY[Math.floor(rand() * 2)],
      consequence,
      classification,
      refBase: ref,
      altBase: alt,
    });
  }
  variants.sort((a, b) => a.pos - b.pos);

  return { gene, chr, exons, variants, seed };
}

function threeLetter(b: string) {
  return { A: "Ala", C: "Cys", G: "Gly", T: "Thr" }[b] ?? b;
}

/* ---------- ±20 bp sequence context ---------- */

function sequenceContext(seed: number, variantIndex: number, ref: string, alt: string) {
  const rand = mulberry32(seed + variantIndex * 9973);
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i < 20; i++) left.push(BASES[Math.floor(rand() * 4)]);
  for (let i = 0; i < 20; i++) right.push(BASES[Math.floor(rand() * 4)]);
  return { left: left.join(""), refBase: ref, altBase: alt, right: right.join("") };
}

/* ---------- Thresholds ---------- */

const LOW_COV = 50;
const HET_THRESHOLD = 0.65; // VAFs farther from 0.5 than this band → suspicious

function isHighlyHeterogeneous(vaf: number) {
  return Math.abs(vaf - 0.5) > 0.3 && vaf < HET_THRESHOLD;
}

/* ---------- Component ---------- */

export type GeneVisualizationHandle = HTMLDivElement;

export const GeneVisualization = forwardRef<HTMLDivElement, { patientId: string }>(
  function GeneVisualization({ patientId }, ref) {
    const model = useMemo(() => buildGeneModel(patientId), [patientId]);
    const [selectedId, setSelectedId] = useState<string>(model.variants[0]?.id ?? "");
    const selected =
      model.variants.find((v) => v.id === selectedId) ?? model.variants[0];

    const lowCovExons = model.exons.filter((e) => e.coverage < LOW_COV);
    const heterogeneousVariants = model.variants.filter((v) => isHighlyHeterogeneous(v.vaf));

    return (
      <section ref={ref} className="space-y-4 animate-lab-in">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Dna className="size-4" />
            </span>
            <div>
              <h3 className="font-display text-sm font-semibold tracking-tight">
                Gene &amp; variant visualization
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {model.gene} · chr{model.chr} · {model.exons.length} exons ·{" "}
                {model.variants.length} variants
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {lowCovExons.length > 0 && (
              <ReviewBadge>
                {lowCovExons.length} low-coverage exon{lowCovExons.length > 1 ? "s" : ""}
              </ReviewBadge>
            )}
            {heterogeneousVariants.length > 0 && (
              <ReviewBadge>
                {heterogeneousVariants.length} off-target VAF
              </ReviewBadge>
            )}
          </div>
        </header>

        <GeneTrack
          model={model}
          selectedId={selected?.id ?? ""}
          onSelect={setSelectedId}
        />

        <CoverageTrack exons={model.exons} variants={model.variants} />

        {selected && <SequenceContext model={model} variant={selected} />}
        {selected && <IgvLite model={model} variant={selected} />}
      </section>
    );
  },
);

function ReviewBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
      <AlertTriangle className="size-3" />
      Review · {children}
    </span>
  );
}

/* ---------- Gene track ---------- */

function GeneTrack({
  model,
  selectedId,
  onSelect,
}: {
  model: GeneModel;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-3 shadow-[var(--shadow-elegant)]">
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>5′</span>
        <span>Gene track · exons (filled) · introns (line)</span>
        <span>3′</span>
      </div>
      <div className="relative h-16">
        {/* Intron baseline */}
        <div className="absolute top-1/2 left-0 right-0 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-foreground/30 to-transparent" />
        {/* Exons */}
        {model.exons.map((e) => {
          const low = e.coverage < LOW_COV;
          return (
            <div
              key={e.index}
              title={`Exon ${e.index} · ${e.coverage}× mean coverage`}
              className={cn(
                "absolute top-1/2 h-5 -translate-y-1/2 rounded-sm border transition-colors",
                low
                  ? "border-amber-500/60 bg-amber-500/30"
                  : "border-primary/40 bg-primary/20",
              )}
              style={{
                left: `${e.start * 100}%`,
                width: `${Math.max(0.4, (e.end - e.start) * 100)}%`,
              }}
            >
              <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 font-mono text-[9px] text-muted-foreground">
                {e.index}
              </span>
            </div>
          );
        })}
        {/* Variant pins */}
        {model.variants.map((v) => {
          const active = v.id === selectedId;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onSelect(v.id)}
              title={`${v.hgvsC} ${v.hgvsP} · VAF ${v.vaf} · depth ${v.depth}× · ${v.zygosity}`}
              className="group absolute top-0 -translate-x-1/2"
              style={{ left: `${v.pos * 100}%` }}
            >
              <span
                className={cn(
                  "block h-7 w-px transition-colors",
                  active ? "bg-emerald-600" : "bg-foreground/40 group-hover:bg-emerald-500",
                )}
              />
              <span
                className={cn(
                  "block size-2.5 -translate-x-[3px] rounded-full border-2 border-background transition-all",
                  active
                    ? "bg-emerald-600 ring-2 ring-emerald-500/40"
                    : v.classification.startsWith("Pathogenic") ||
                        v.classification.startsWith("Likely")
                      ? "bg-destructive group-hover:scale-125"
                      : "bg-primary group-hover:scale-125",
                )}
              />
            </button>
          );
        })}
      </div>

      {/* Variant table (hover details rendered through title; click to select) */}
      <ul className="mt-2 grid gap-1">
        {model.variants.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => onSelect(v.id)}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
                v.id === selectedId
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-transparent hover:bg-muted/50",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                  ex{v.exon}
                </span>
                <span className="truncate font-mono">{v.hgvsC}</span>
                <span className="hidden truncate text-muted-foreground sm:inline">
                  {v.hgvsP}
                </span>
                <ConsequenceBadge c={v.consequence} />
              </span>
              <span className="flex shrink-0 items-center gap-3 font-mono text-[10px] tabular-nums text-muted-foreground">
                <span>VAF {v.vaf.toFixed(2)}</span>
                <span>{v.depth}×</span>
                <span className="hidden sm:inline">{v.zygosity}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConsequenceBadge({ c }: { c: Variant["consequence"] }) {
  const tone =
    c === "nonsense" || c === "frameshift" || c === "splice"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : c === "missense"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "border-primary/30 bg-primary/10 text-primary";
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider",
        tone,
      )}
    >
      {c}
    </span>
  );
}

/* ---------- Coverage track ---------- */

function CoverageTrack({ exons, variants }: { exons: Exon[]; variants: Variant[] }) {
  const max = Math.max(200, ...exons.map((e) => e.coverage));
  return (
    <div className="rounded-lg border bg-card p-3 shadow-[var(--shadow-elegant)]">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Activity className="size-3" />
          Coverage per exon
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">0–{max}×</span>
      </div>
      <div className="relative h-20">
        {/* Threshold line */}
        <div
          className="absolute right-0 left-0 border-amber-500/50 border-t border-dashed"
          style={{ top: `${100 - (LOW_COV / max) * 100}%` }}
        >
          <span className="absolute right-0 -top-3 rounded bg-card px-1 font-mono text-[9px] text-amber-600">
            {LOW_COV}× threshold
          </span>
        </div>
        {/* Bars */}
        {exons.map((e) => {
          const low = e.coverage < LOW_COV;
          const h = (e.coverage / max) * 100;
          return (
            <div
              key={e.index}
              title={`Exon ${e.index} · ${e.coverage}× mean`}
              className={cn(
                "absolute bottom-0 rounded-t-sm transition-colors",
                low
                  ? "bg-gradient-to-t from-amber-500/70 to-amber-500/30"
                  : "bg-gradient-to-t from-primary/70 to-primary/30",
              )}
              style={{
                left: `${e.start * 100}%`,
                width: `${Math.max(0.4, (e.end - e.start) * 100)}%`,
                height: `${h}%`,
              }}
            />
          );
        })}
        {/* Variant tick marks */}
        {variants.map((v) => (
          <div
            key={v.id}
            className="absolute top-0 bottom-0 w-px bg-emerald-600/50"
            style={{ left: `${v.pos * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------- Sequence context ±20 bp ---------- */

function SequenceContext({ model, variant }: { model: GeneModel; variant: Variant }) {
  const idx = model.variants.findIndex((x) => x.id === variant.id);
  const ctx = useMemo(
    () => sequenceContext(model.seed, idx, variant.refBase, variant.altBase),
    [model.seed, idx, variant.refBase, variant.altBase],
  );
  const baseColor: Record<string, string> = {
    A: "text-emerald-600",
    C: "text-primary",
    G: "text-amber-600",
    T: "text-destructive",
  };
  return (
    <div className="rounded-lg border bg-card p-3 shadow-[var(--shadow-elegant)]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Sequence context · ±20 bp · {variant.hgvsC}
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-700 dark:text-emerald-400">
            {variant.consequence}
          </span>
          <span className="rounded border bg-muted/50 px-1.5 py-0.5 font-medium">
            {variant.classification}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border bg-muted/30 p-3">
        <div className="font-mono text-[11px] leading-tight text-muted-foreground">ref</div>
        <div className="whitespace-nowrap font-mono text-sm tracking-[0.18em]">
          {ctx.left.split("").map((b, i) => (
            <span key={i} className={baseColor[b]}>
              {b}
            </span>
          ))}
          <span className="rounded bg-destructive/15 px-1 font-bold text-destructive ring-1 ring-destructive/40">
            {ctx.refBase}
          </span>
          {ctx.right.split("").map((b, i) => (
            <span key={i} className={baseColor[b]}>
              {b}
            </span>
          ))}
        </div>

        <div className="mt-3 font-mono text-[11px] leading-tight text-muted-foreground">
          alt
        </div>
        <div className="whitespace-nowrap font-mono text-sm tracking-[0.18em]">
          {ctx.left.split("").map((b, i) => (
            <span key={i} className={baseColor[b]}>
              {b}
            </span>
          ))}
          <span className="rounded bg-emerald-500/20 px-1 font-bold text-emerald-700 ring-1 ring-emerald-500/40 dark:text-emerald-400">
            {ctx.altBase}
          </span>
          {ctx.right.split("").map((b, i) => (
            <span key={i} className={baseColor[b]}>
              {b}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        Deterministic schematic — flanking bases generated from the patient seed for layout
        only, not real reference sequence.
      </p>
    </div>
  );
}

/* ---------- IGV-lite ---------- */

function IgvLite({ model, variant }: { model: GeneModel; variant: Variant }) {
  const rand = useMemo(
    () => mulberry32(model.seed + variant.pos * 9991),
    [model.seed, variant.pos],
  );
  const reads = useMemo(() => {
    const list: { y: number; left: number; width: number; alt: boolean }[] = [];
    for (let i = 0; i < 28; i++) {
      const left = rand() * 0.7;
      const width = 0.12 + rand() * 0.18;
      const y = i;
      const alt = rand() < variant.vaf && left < 0.5 && left + width > 0.5;
      list.push({ y, left, width, alt });
    }
    return list;
  }, [rand, variant.vaf]);

  return (
    <div className="rounded-lg border bg-card p-3 shadow-[var(--shadow-elegant)]">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          IGV-lite · pile-up schematic
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {variant.hgvsC} · {variant.zygosity}
        </span>
      </div>
      <div className="relative h-44 overflow-hidden rounded-md border bg-muted/20">
        {/* center column = variant */}
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-emerald-500/50" />
        {reads.map((r, i) => (
          <div
            key={i}
            className={cn(
              "absolute h-1.5 rounded-sm",
              r.alt ? "bg-destructive/70" : "bg-primary/40",
            )}
            style={{
              top: 4 + r.y * 5.5,
              left: `${r.left * 100}%`,
              width: `${r.width * 100}%`,
            }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-sm bg-primary/60" /> reference
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-sm bg-destructive/70" /> alt-allele read
        </span>
        <span className="ml-auto font-mono">expected ALT ≈ {Math.round(variant.vaf * 100)}%</span>
      </div>
    </div>
  );
}
