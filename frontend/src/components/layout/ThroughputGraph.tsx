import { useEffect, useRef } from "react";
import { useDownloadsStore } from "@/stores/downloads";

const W = 300;
const H = 44;
const POINTS = 24;
const SEG = W / (POINTS - 1);
const TICK_MS = 1000;

/** Aggregate speed is derived from receivedBytes deltas between ticks
 *  (the backend's DownloadProgress events already update receivedBytes in
 *  the store) rather than re-summing a separate "speed" field per task,
 *  since not every task kind reports one consistently — bytes-over-time
 *  is true for all of them. */
function useAggregateSpeed() {
  const tasks = useDownloadsStore((s) => s.tasks);
  const lastBytes = useRef<number>(-1);
  const lastAt = useRef<number>(performance.now());
  const speedRef = useRef(0);

  const totalBytes = tasks.reduce((sum, t) => sum + t.receivedBytes, 0);
  const now = performance.now();

  if (lastBytes.current < 0) {
    lastBytes.current = totalBytes;
    lastAt.current = now;
  } else {
    const dt = (now - lastAt.current) / 1000;
    if (dt > 0.4) {
      const delta = Math.max(0, totalBytes - lastBytes.current);
      speedRef.current = delta / dt;
      lastBytes.current = totalBytes;
      lastAt.current = now;
    }
  }
  return speedRef;
}

function fmtSpeed(bps: number) {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
}

function smoothPath(vals: number[], maxV: number) {
  const scale = (v: number) => H - Math.min(1, v / (maxV || 1)) * (H - 4) - 2;
  const pts = vals.map((v, i): [number, number] => [i * SEG, scale(v)]);
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  const last = pts[pts.length - 1];
  return { line: d, area: `${d} L ${last[0]},${H} L 0,${H} Z`, last };
}

export function ThroughputGraph({ onSpeedLabel }: { onSpeedLabel?: (s: string) => void }) {
  const speedRef = useAggregateSpeed();
  const gRef = useRef<SVGGElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const areaRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const dataRef = useRef<number[]>(Array.from({ length: POINTS }, () => 0));
  const maxRef = useRef<number>(1024);

  useEffect(() => {
    function render() {
      const maxV = Math.max(maxRef.current, ...dataRef.current, 1);
      maxRef.current = maxV;
      const { line, area, last } = smoothPath(dataRef.current, maxV);
      lineRef.current?.setAttribute("d", line);
      areaRef.current?.setAttribute("d", area);
      dotRef.current?.setAttribute("cx", String(last[0]));
      dotRef.current?.setAttribute("cy", String(last[1]));
    }
    render();

    const id = setInterval(() => {
      const speed = speedRef.current;
      dataRef.current.push(speed);
      onSpeedLabel?.(fmtSpeed(speed));
      render();

      const g = gRef.current;
      if (!g) return;
      g.style.transition = `transform ${TICK_MS * 0.82}ms var(--ease-out)`;
      g.style.transform = `translateX(-${SEG}px)`;

      setTimeout(() => {
        dataRef.current.shift();
        if (!g) return;
        g.style.transition = "none";
        g.style.transform = "translateX(0)";
        render();
        void g.getBoundingClientRect();
      }, TICK_MS * 0.82);
    }, TICK_MS);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative h-11 w-full max-w-[340px] overflow-hidden rounded-lg">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-full w-full">
        <defs>
          <linearGradient id="speusisAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-ink)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent-ink)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g ref={gRef}>
          <path ref={areaRef} fill="url(#speusisAreaFill)" />
          <path ref={lineRef} fill="none" stroke="var(--accent-ink)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle ref={dotRef} r="2.6" fill="var(--accent-ink)" style={{ filter: "drop-shadow(0 0 4px var(--accent-ink))" }} />
        </g>
      </svg>
    </div>
  );
}

export { fmtSpeed };
