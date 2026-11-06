"use client";

// Sparkline (UI.md 3.3, 7.8): SVG, 2.5px, round joins, no fill, no dots.
// Colour follows the sign of the change it sits next to (`up`), defaulting to
// last >= first of the drawn points.

type Pt = { value: number; time?: number };

/** The last `seconds` of the series when the points are timed. */
function window_(points: Pt[], seconds: number): Pt[] {
  const last = points[points.length - 1];
  if (!last || last.time === undefined) return points;
  const from = last.time - seconds;
  const out = points.filter((p) => (p.time ?? 0) >= from);
  return out.length > 1 ? out : points.slice(-2);
}

/** At most n points, evenly spaced, first and last always kept. */
function sample(points: Pt[], n: number): Pt[] {
  if (points.length <= n) return points;
  const out: Pt[] = [];
  for (let i = 0; i < n; i += 1) out.push(points[Math.round((i / (n - 1)) * (points.length - 1))]);
  return out;
}

export function Sparkline({
  points,
  width = 84,
  height = 32,
  up,
  max = 72,
  seconds = 86400,
  fill = false,
  className,
}: {
  points: Pt[];
  width?: number;
  height?: number;
  /** Override the colour rule, e.g. with the row's 1D change sign. */
  up?: boolean;
  /** At most N points drawn, sampled evenly over the window. */
  max?: number;
  /** Window covered, in seconds, when the points carry times. Matches the
   *  change shown next to the line (today), whatever the data's resolution. */
  seconds?: number;
  /** Flat tint under the line. No gradient. */
  fill?: boolean;
  className?: string;
}) {
  const pts = sample(window_(points, seconds), max);
  if (pts.length < 2) return <svg width={width} height={height} aria-hidden className={className} />;
  const vals = pts.map((p) => p.value);
  const min = Math.min(...vals);
  const span = Math.max(...vals) - min || 1;
  const pad = 2;
  const d = pts
    .map((p, i) => {
      const x = ((i / (pts.length - 1)) * (width - pad * 2) + pad).toFixed(1);
      const y = (height - pad - ((p.value - min) / span) * (height - pad * 2)).toFixed(1);
      return `${i === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
  const isUp = up ?? vals[vals.length - 1] >= vals[0];
  const colour = isUp ? "var(--gain)" : "var(--loss)";
  const area = `${d} L${(width - pad).toFixed(1)},${height} L${pad},${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className={className}>
      {fill && <path d={area} fill={colour} opacity="0.16" />}
      <path d={d} fill="none" stroke={colour} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
