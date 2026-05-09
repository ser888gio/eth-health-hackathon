import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface DnaSpinnerProps {
  className?: string;
  /** Number of rungs / sample points along the helix. */
  steps?: number;
  /** Rotation speed in revolutions per second. */
  speed?: number;
}

/**
 * Animated DNA double helix.
 *
 * Renders two sinusoidal strands with connecting base-pair rungs.
 * Each frame we shift the sine phase, which makes the helix appear to
 * rotate smoothly around its vertical axis. Strand color, rung color,
 * and the front/back depth fade are derived from `currentColor`.
 */
export function DnaSpinner({
  className,
  steps = 26,
  speed = 0.6,
}: DnaSpinnerProps) {
  const strandARef = useRef<SVGPathElement>(null);
  const strandBRef = useRef<SVGPathElement>(null);
  const rungsRef = useRef<SVGGElement>(null);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();

    const W = 100;
    const H = 100;
    const cx = W / 2;
    const amp = 22; // helix radius (horizontal)
    const turns = 1.6; // number of twists across the height
    const pad = 6;

    // Pre-create rung lines once.
    const rungEls: SVGLineElement[] = [];
    if (rungsRef.current) {
      rungsRef.current.innerHTML = "";
      for (let i = 0; i < steps; i++) {
        const l = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "line",
        );
        l.setAttribute("stroke", "currentColor");
        l.setAttribute("stroke-width", "1.6");
        l.setAttribute("stroke-linecap", "round");
        rungsRef.current.appendChild(l);
        rungEls.push(l);
      }
    }

    const tick = (now: number) => {
      const t = ((now - start) / 1000) * speed * Math.PI * 2;

      let pathA = "";
      let pathB = "";

      for (let i = 0; i < steps; i++) {
        const u = i / (steps - 1);
        const y = pad + u * (H - pad * 2);
        const angle = u * turns * Math.PI * 2 + t;
        const ax = cx + Math.sin(angle) * amp;
        const bx = cx + Math.sin(angle + Math.PI) * amp;
        // depth z in [-1,1] used to fade rungs that are on the back side.
        const az = Math.cos(angle);
        const bz = Math.cos(angle + Math.PI);

        pathA += (i === 0 ? "M" : "L") + ax.toFixed(2) + " " + y.toFixed(2);
        pathB += (i === 0 ? "M" : "L") + bx.toFixed(2) + " " + y.toFixed(2);

        const rung = rungEls[i];
        if (rung) {
          rung.setAttribute("x1", ax.toFixed(2));
          rung.setAttribute("y1", y.toFixed(2));
          rung.setAttribute("x2", bx.toFixed(2));
          rung.setAttribute("y2", y.toFixed(2));
          // Front rungs brighter, back rungs faded.
          const depth = (az + bz) / 2; // -1..1
          const opacity = 0.25 + ((depth + 1) / 2) * 0.55;
          rung.setAttribute("opacity", opacity.toFixed(2));
        }
      }

      strandARef.current?.setAttribute("d", pathA);
      strandBRef.current?.setAttribute("d", pathB);

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [steps, speed]);

  return (
    <svg
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="DNA double helix"
      className={cn("inline-block", className)}
      fill="none"
    >
      <g ref={rungsRef} />
      <path
        ref={strandARef}
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        ref={strandBRef}
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.75"
      />
    </svg>
  );
}
