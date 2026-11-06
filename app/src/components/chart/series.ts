// Chart geometry, independent of the drawing library.
//
// Everything the chart shows for one window is collapsed into a `Shape`: a
// fixed-size grid of OHLC bars, the price window, two alphas (line / bars) and
// the overlay positions. Two shapes can be interpolated, which is what makes a
// window or type change morph instead of jump.

export type ChartPoint = { time: number; value: number; halted?: boolean };
export type Bar = { time: number; open: number; high: number; low: number; close: number };
/** Inclusive span in grid space (0 .. n-1). */
export type Span = { from: number; to: number };
/** A marker pinned to a grid position. */
export type Mark = { x: number; value: number };
export type RefPoint = { time: number; value: number; mode: string; bandBps: number };
export type Level = { value: number; alpha: number; label?: string; pin?: boolean };

export type Shape = {
  n: number;
  bars: Bar[];
  /** Price window: the data's own low / high. Nothing else widens it. */
  min: number;
  max: number;
  /** Change over the window as 0 (loss) .. 1 (gain); lerped so the colour never flips mid-tween. */
  upness: number;
  aLine: number;
  aBars: number;
  /** Grouped by alpha so a tween can cross-fade marker sets. */
  halts: { spans: Span[]; alpha: number }[];
  rejects: { marks: Mark[]; alpha: number }[];
  /** Window open: the dotted line the change is measured from. */
  baseline: Level | null;
  /** Trading limits and caller-supplied levels. */
  limits: Level[];
};

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Points per window. Bars need few and wide (a 3px candle reads as noise);
 * the line wants enough to stay smooth. Never more than the raw points.
 */
export function gridSize(len: number, bars: boolean): number {
  if (len < 2) return len;
  return bars ? Math.min(len, Math.max(8, Math.min(60, Math.round(len / 3)))) : Math.min(len, 180);
}

/** Exactly `n` OHLC bars over `data`. Requires n <= data.length. */
function toBars(data: ChartPoint[], n: number): Bar[] {
  const len = data.length;
  const out: Bar[] = [];
  for (let k = 0; k < n; k += 1) {
    const s = Math.floor((k * len) / n);
    const e = Math.max(s + 1, Math.floor(((k + 1) * len) / n));
    const open = data[s].value;
    let high = open;
    let low = open;
    let close = open;
    for (let i = s; i < e; i += 1) {
      const v = data[i].value;
      if (v > high) high = v;
      if (v < low) low = v;
      close = v;
    }
    out.push({ time: data[e - 1].time, open, high, low, close });
  }
  return out;
}

/** Latest reference at or before `time`. */
function refAt(reference: RefPoint[] | undefined, time: number): RefPoint | null {
  if (!reference || reference.length === 0) return null;
  let cur: RefPoint | null = null;
  for (const r of reference) {
    if (r.time <= time) cur = r;
    else break;
  }
  return cur ?? reference[0];
}

function nearestIndex(data: ChartPoint[], t: number): number {
  let lo = 0;
  let hi = data.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (data[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(data[lo - 1].time - t) <= Math.abs(data[lo].time - t)) return lo - 1;
  return lo;
}

export function buildShape(
  data: ChartPoint[],
  bars: boolean,
  opts: {
    reference?: RefPoint[];
    rejects?: number[];
    baseline?: number;
    /** Caller-supplied levels (floor, cap, minimum raise); always drawn. */
    levels?: { price: number; label?: string }[];
    /** Force the trading limits on or off. Default: on when a reference is given. */
    limits?: boolean;
    n?: number;
  } = {},
): Shape {
  const len = data.length;
  const n = opts.n ?? gridSize(len, bars);
  const grid = toBars(data, n);
  let min = Infinity;
  let max = -Infinity;
  for (const d of data) {
    if (d.value < min) min = d.value;
    if (d.value > max) max = d.value;
  }
  // A dead-flat window still needs a window, or the line sits on the frame edge.
  if (max - min < 1e-9) {
    const pad = Math.max(Math.abs(max) * 0.002, 1e-4);
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const toGrid = (i: number) => (len < 2 ? 0 : (i / (len - 1)) * (n - 1));

  const spans: Span[] = [];
  let start = -1;
  data.forEach((d, i) => {
    if (d.halted && start < 0) start = i;
    if (!d.halted && start >= 0) {
      spans.push({ from: toGrid(start), to: toGrid(i) });
      start = -1;
    }
  });
  if (start >= 0) spans.push({ from: toGrid(start), to: toGrid(len - 1) });

  const first = data[0].time;
  const last = data[len - 1].time;
  const slack = (last - first) * 0.02;
  const marks: Mark[] = [];
  for (const t of opts.rejects ?? []) {
    // An attempt from outside this window belongs to another window; the
    // Rejected tab lists them all. Only what is on (or just off) screen is kept.
    if (t < first - slack || t > last + slack) continue;
    const i = nearestIndex(data, t);
    marks.push({ x: toGrid(i), value: data[i].value });
  }

  const limits: Level[] = [];
  if (opts.limits ?? Boolean(opts.reference?.length)) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const d of data) {
      const r = refAt(opts.reference, d.time);
      if (!r || d.halted || r.mode === "halted" || r.bandBps <= 0) continue;
      lo = Math.min(lo, r.value * (1 - r.bandBps / 10000));
      hi = Math.max(hi, r.value * (1 + r.bandBps / 10000));
    }
    // Only when a limit is close enough to say something about the room left.
    // A limit ten times the day's move away is noise, and the rule banner over
    // the chart already spells both of them out in words.
    if (lo !== Infinity && lo >= min - span && lo <= max) limits.push({ value: lo, alpha: 1, pin: true });
    if (hi !== -Infinity && hi <= max + span && hi >= min) limits.push({ value: hi, alpha: 1, pin: true });
  }
  for (const l of opts.levels ?? []) limits.push({ value: l.price, alpha: 1, label: l.label, pin: true });

  return {
    n,
    bars: grid,
    min,
    max,
    upness: data[len - 1].value >= data[0].value ? 1 : 0,
    aLine: bars ? 0 : 1,
    aBars: bars ? 1 : 0,
    halts: spans.length > 0 ? [{ spans, alpha: 1 }] : [],
    rejects: marks.length > 0 ? [{ marks, alpha: 1 }] : [],
    baseline: opts.baseline === undefined ? null : { value: opts.baseline, alpha: 1 },
    limits,
  };
}

/** Same shape on a different grid size, by linear interpolation. */
export function resampleShape(s: Shape, n: number): Shape {
  if (s.n === n || s.n < 2 || n < 2) return s.n === n ? s : { ...s, n, bars: toSize(s.bars, n) };
  const k = (s.n - 1) / (n - 1);
  const bars: Bar[] = [];
  for (let i = 0; i < n; i += 1) {
    const p = i * k;
    const a = s.bars[Math.floor(p)];
    const b = s.bars[Math.min(s.n - 1, Math.ceil(p))];
    const f = p - Math.floor(p);
    bars.push({
      time: Math.round(lerp(a.time, b.time, f)),
      open: lerp(a.open, b.open, f),
      high: lerp(a.high, b.high, f),
      low: lerp(a.low, b.low, f),
      close: lerp(a.close, b.close, f),
    });
  }
  const scale = (x: number) => x / k;
  return {
    ...s,
    n,
    bars,
    halts: s.halts.map((h) => ({ alpha: h.alpha, spans: h.spans.map((v) => ({ from: scale(v.from), to: scale(v.to) })) })),
    rejects: s.rejects.map((r) => ({ alpha: r.alpha, marks: r.marks.map((m) => ({ x: scale(m.x), value: m.value })) })),
  };
}

/** Pad or trim a bar list to n (degenerate grids only). */
function toSize(bars: Bar[], n: number): Bar[] {
  const out = bars.slice(0, n);
  while (out.length < n && bars.length > 0) out.push({ ...bars[bars.length - 1], time: bars[bars.length - 1].time + out.length });
  return out;
}

function fadeSets<T extends { alpha: number }>(a: T[], b: T[], t: number, same: boolean): T[] {
  if (same) return b.map((s) => ({ ...s, alpha: 1 }));
  return [...a.map((s) => ({ ...s, alpha: s.alpha * (1 - t) })), ...b.map((s) => ({ ...s, alpha: s.alpha * t }))].filter((s) => s.alpha > 0.01);
}

const key = (v: unknown) => JSON.stringify(v);

/** Both shapes must share `n`. Times are kept strictly ascending. */
export function lerpShape(a: Shape, b: Shape, t: number): Shape {
  const n = b.n;
  const bars: Bar[] = [];
  let prev = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const x = a.bars[i];
    const y = b.bars[i];
    const time = Math.max(prev + 1, Math.round(lerp(x.time, y.time, t)));
    prev = time;
    bars.push({
      time,
      open: lerp(x.open, y.open, t),
      high: lerp(x.high, y.high, t),
      low: lerp(x.low, y.low, t),
      close: lerp(x.close, y.close, t),
    });
  }
  // Levels nearly always match one for one (same company, same rule); when they
  // do, the line slides. When they do not, the old set fades out under the new.
  const limits: Level[] =
    a.limits.length === b.limits.length
      ? b.limits.map((l, i) => ({ ...l, value: lerp(a.limits[i].value, l.value, t), alpha: lerp(a.limits[i].alpha, l.alpha, t) }))
      : [...a.limits.map((l) => ({ ...l, alpha: l.alpha * (1 - t) })), ...b.limits.map((l) => ({ ...l, alpha: l.alpha * t }))];
  const baseline: Level | null =
    a.baseline && b.baseline
      ? { value: lerp(a.baseline.value, b.baseline.value, t), alpha: 1 }
      : a.baseline
        ? { ...a.baseline, alpha: 1 - t }
        : b.baseline
          ? { ...b.baseline, alpha: t }
          : null;
  return {
    n,
    bars,
    min: lerp(a.min, b.min, t),
    max: lerp(a.max, b.max, t),
    upness: lerp(a.upness, b.upness, t),
    aLine: lerp(a.aLine, b.aLine, t),
    aBars: lerp(a.aBars, b.aBars, t),
    halts: fadeSets(a.halts, b.halts, t, key(a.halts) === key(b.halts)),
    rejects: fadeSets(a.rejects, b.rejects, t, key(a.rejects) === key(b.rejects)),
    baseline,
    limits: limits.filter((l) => l.alpha > 0.01),
  };
}

/**
 * Candles grow out of the line: at k = 0 every bar is flat on its close, at
 * k = 1 it is the real body and wick.
 */
export function collapse(bars: Bar[], k: number): Bar[] {
  if (k >= 0.999) return bars;
  return bars.map((b) => ({
    time: b.time,
    open: b.close + (b.open - b.close) * k,
    high: b.close + (b.high - b.close) * k,
    low: b.close + (b.low - b.close) * k,
    close: b.close,
  }));
}

// --- colour helpers ---------------------------------------------------------

function parse(c: string): [number, number, number] {
  const s = c.trim();
  if (s.startsWith("#")) {
    const h = s.slice(1);
    const f = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
    return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
  }
  const m = s.match(/-?\d+(\.\d+)?/g);
  if (m && m.length >= 3) return [Number(m[0]), Number(m[1]), Number(m[2])];
  return [0, 0, 0];
}

export function withAlpha(colour: string, alpha: number): string {
  const [r, g, b] = parse(colour);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

/** Mix two token colours, used so the line never flips colour mid-tween. */
export function mix(a: string, b: string, t: number, alpha = 1): string {
  const x = parse(a);
  const y = parse(b);
  return `rgba(${Math.round(lerp(x[0], y[0], t))}, ${Math.round(lerp(x[1], y[1], t))}, ${Math.round(lerp(x[2], y[2], t))}, ${clamp(alpha, 0, 1).toFixed(3)})`;
}
