"use client";

// PriceChart (UI.md section 3, UX.md 3.11) over TradingView Lightweight Charts v5
// (Apache-2.0; the attribution logo stays on, the NOTICE text is on /about).
//
// One line coloured by the change over the visible range, a dotted baseline
// (day open / range start / issue price), a shaded allowed band, a dotted
// reference step line, halt column shading and reverted-swap x marks.
// The chart is created once per (theme, kind, height); data updates go through
// setData / primitive updates, never a rebuild. Hover is exposed via onHover.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  LineType,
  TrackingModeExitMode,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesPrimitive,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type Logical,
  type PrimitivePaneViewZOrder,
  type SeriesAttachedParameter,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Maximize2 } from "lucide-react";
import { useOnThemeChange } from "./theme";
import { Chip, cx } from "./ui";
import { dateTimeIST, timeIST } from "@/lib/format";
import type { Mode } from "@/lib/mock";

// ---------------------------------------------------------------------------
// Types and helpers
// ---------------------------------------------------------------------------

export type ChartPoint = { time: number; value: number; halted?: boolean };
export type ChartRef = { time: number; value: number; mode: Mode; bandBps: number };
export type ChartLine = { price: number; label?: string };
export type HoverPoint = { time: number; value: number } | null;
export type ChartRange = "1D" | "1W" | "ALL";

export const RANGE_SECONDS: Record<ChartRange, number> = { "1D": 86400, "1W": 7 * 86400, ALL: Infinity };
export const RANGE_LABELS: Record<ChartRange, string> = { "1D": "1D", "1W": "1W", ALL: "All" };

/** Points within the range ending at `nowSec`; always at least two points. */
export function sliceRange<T extends { time: number }>(points: T[], range: ChartRange, nowSec: number): T[] {
  const from = nowSec - RANGE_SECONDS[range];
  const pts = points.filter((p) => p.time >= from);
  return pts.length > 1 ? pts : points.slice(-2);
}

type Tokens = {
  bg: string;
  text2: string;
  lineStrong: string;
  gain: string;
  loss: string;
  gainFill: string;
  lossFill: string;
  bandFill: string;
};

function readTokens(): Tokens {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    bg: v("--bg"),
    text2: v("--text-2"),
    lineStrong: v("--line-strong"),
    gain: v("--gain"),
    loss: v("--loss"),
    gainFill: v("--gain-fill"),
    lossFill: v("--loss-fill"),
    bandFill: v("--band-fill"),
  };
}

/** Nearest data index for a time (binary search). */
function nearestIndex(times: number[], t: number): number {
  if (times.length === 0) return 0;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(times[lo - 1] - t) <= Math.abs(times[lo] - t)) return lo - 1;
  return lo;
}

// ---------------------------------------------------------------------------
// Overlay primitive: halt columns + band (bottom), reject x marks (top).
// All geometry is index based, so it works for any time between data points.
// ---------------------------------------------------------------------------

type Overlay = {
  halts: { from: number; to: number }[]; // index ranges, inclusive
  band: ({ lo: number; hi: number } | null)[]; // per data index
  rejects: { index: number; value: number }[];
};

type DrawTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

class OverlayRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly layer: "bottom" | "top",
    private readonly prim: OverlayPrimitive,
  ) {}
  draw(target: DrawTarget) {
    const p = this.prim;
    if (!p.chart || !p.series) return;
    const chart = p.chart;
    const series = p.series;
    const t = p.tokens;
    const x = (i: number) => chart.timeScale().logicalToCoordinate(i as Logical);
    const y = (v: number) => series.priceToCoordinate(v);
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      if (this.layer === "bottom") {
        // Halt columns
        ctx.fillStyle = t.lossFill;
        for (const h of p.data.halts) {
          const x1 = x(h.from);
          const x2 = x(Math.min(h.to + 1, p.data.band.length - 1));
          if (x1 === null || x2 === null) continue;
          ctx.fillRect(Math.min(x1, x2), 0, Math.max(1, Math.abs(x2 - x1)), mediaSize.height);
        }
        // Band polygons, one per contiguous run
        ctx.fillStyle = t.bandFill;
        const band = p.data.band;
        let i = 0;
        while (i < band.length) {
          if (!band[i]) {
            i += 1;
            continue;
          }
          let j = i;
          while (j + 1 < band.length && band[j + 1]) j += 1;
          ctx.beginPath();
          let started = false;
          for (let k = i; k <= j; k += 1) {
            const b = band[k]!;
            const xk = x(k);
            const yk = y(b.hi);
            if (xk === null || yk === null) continue;
            if (!started) {
              ctx.moveTo(xk, yk);
              started = true;
            } else ctx.lineTo(xk, yk);
            if (k < j) {
              const xn = x(k + 1);
              if (xn !== null) ctx.lineTo(xn, yk);
            }
          }
          for (let k = j; k >= i; k -= 1) {
            const b = band[k]!;
            const xk = x(k);
            const yk = y(b.lo);
            if (xk === null || yk === null) continue;
            if (k < j) {
              const xn = x(k + 1);
              if (xn !== null) ctx.lineTo(xn, yk);
            }
            ctx.lineTo(xk, yk);
          }
          if (started) {
            ctx.closePath();
            ctx.fill();
          }
          i = j + 1;
        }
      } else {
        // Reverted swaps: 9px x marks, 1.5px stroke
        ctx.strokeStyle = t.loss;
        ctx.lineWidth = 1.5;
        ctx.lineCap = "round";
        const r = 4.5;
        for (const m of p.data.rejects) {
          const cx0 = x(m.index);
          const cy0 = y(m.value);
          if (cx0 === null || cy0 === null) continue;
          ctx.beginPath();
          ctx.moveTo(cx0 - r, cy0 - r);
          ctx.lineTo(cx0 + r, cy0 + r);
          ctx.moveTo(cx0 + r, cy0 - r);
          ctx.lineTo(cx0 - r, cy0 + r);
          ctx.stroke();
        }
      }
    });
  }
}

class OverlayView implements IPrimitivePaneView {
  private readonly r: OverlayRenderer;
  constructor(
    private readonly layer: "bottom" | "top",
    prim: OverlayPrimitive,
  ) {
    this.r = new OverlayRenderer(layer, prim);
  }
  zOrder(): PrimitivePaneViewZOrder {
    return this.layer;
  }
  renderer() {
    return this.r;
  }
}

class OverlayPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<"Line"> | ISeriesApi<"Area"> | null = null;
  data: Overlay = { halts: [], band: [], rejects: [] };
  private requestUpdate: (() => void) | null = null;
  private readonly views: OverlayView[];
  constructor(public tokens: Tokens) {
    this.views = [new OverlayView("bottom", this), new OverlayView("top", this)];
  }
  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart as IChartApi;
    this.series = p.series as ISeriesApi<"Line">;
    this.requestUpdate = p.requestUpdate;
  }
  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }
  paneViews() {
    return this.views;
  }
  set(data: Overlay) {
    this.data = data;
    this.requestUpdate?.();
  }
}

// ---------------------------------------------------------------------------
// PriceChart
// ---------------------------------------------------------------------------

type Label = { x: number; y: number; text: string; anchor: "above" | "below" | "right" };

export function PriceChart({
  data,
  kind = "market",
  baseline,
  reference,
  showBand,
  lines = [],
  rejects = [],
  height = 280,
  digits = 2,
  onHover,
  readout = true,
  labels = true,
  axes = false,
  onExpand,
  className,
}: {
  data: ChartPoint[];
  /** market: plain line. clearing: step line. raised: line with a soft area fill. */
  kind?: "market" | "clearing" | "raised";
  /** Dotted baseline: day open (1D), range start (1W, All) or issue price (IPO). */
  baseline?: number;
  /** Reference price over time with its band; draws the dotted step line and the shaded band. */
  reference?: ChartRef[];
  /** Force the band on/off. Default: on unless every point is in Normal mode and the band is off-screen. */
  showBand?: boolean;
  /** Extra dotted lines (floor, cap, minimum raise) with right-edge labels. */
  lines?: ChartLine[];
  /** Times (seconds) of reverted swaps; clamped to the nearest visible point. */
  rejects?: number[];
  height?: number;
  digits?: number;
  onHover?: (p: HoverPoint) => void;
  /** Reserve a 24px readout line above the chart (time left, value right) during hover. */
  readout?: boolean;
  /** H / L / last labels. */
  labels?: boolean;
  /** Show the time axis (Expand view only). */
  axes?: boolean;
  /** Renders the labelled "Expand" button bottom-right (mobile only). */
  onExpand?: () => void;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | ISeriesApi<"Area"> | null>(null);
  const refSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const primRef = useRef<OverlayPrimitive | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const tokensRef = useRef<Tokens | null>(null);
  const rangeRef = useRef<{ min: number; max: number }>({ min: 0, max: 1 });
  const hoverRef = useRef(onHover);
  const [themeTick, setThemeTick] = useState(0);
  const [hover, setHover] = useState<HoverPoint>(null);
  const [placed, setPlaced] = useState<Label[]>([]);
  // Bumped after (re)creation so the data effect runs against the new chart.
  const [dataTick, setDataTick] = useState(0);

  useEffect(() => {
    hoverRef.current = onHover;
  }, [onHover]);

  const onTheme = useCallback(() => setThemeTick((t) => t + 1), []);
  useOnThemeChange(onTheme);

  const up = data.length > 1 ? data[data.length - 1].value >= data[0].value : true;

  // 1. Create the chart once per theme / kind / height / axes.
  useEffect(() => {
    if (!el.current) return;
    const t = readTokens();
    tokensRef.current = t;
    const chart = createChart(el.current, {
      autoSize: true,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: t.text2,
        fontFamily: "Roboto, system-ui, sans-serif",
        fontSize: 13,
        attributionLogo: true,
      },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { visible: false, scaleMargins: { top: 0.14, bottom: 0.14 } },
      leftPriceScale: { visible: false },
      timeScale: { visible: axes, borderVisible: false, fixLeftEdge: true, fixRightEdge: true, timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: t.lineStrong, width: 1, style: LineStyle.Solid, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false },
      handleScale: false,
      trackingMode: { exitMode: TrackingModeExitMode.OnTouchEnd },
      localization: {
        timeFormatter: (time: Time) => timeIST(time as number),
        priceFormatter: (p: number) => p.toFixed(digits),
      },
    });

    const autoscaleInfoProvider = () => ({ priceRange: { minValue: rangeRef.current.min, maxValue: rangeRef.current.max } });

    // Reference step line (under the price line).
    const refSeries = chart.addSeries(LineSeries, {
      color: t.text2,
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      lineType: LineType.WithSteps,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      visible: false,
    });

    const common = {
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 5,
      crosshairMarkerBorderColor: t.bg,
      crosshairMarkerBorderWidth: 2,
      autoscaleInfoProvider,
    };
    const series =
      kind === "raised"
        ? chart.addSeries(AreaSeries, { ...common, lineColor: t.gain, lineWidth: 3, topColor: t.gainFill, bottomColor: "transparent", lineType: LineType.Simple })
        : chart.addSeries(LineSeries, { ...common, color: t.gain, lineWidth: 3, lineType: kind === "clearing" ? LineType.WithSteps : LineType.Simple });

    const prim = new OverlayPrimitive(t);
    series.attachPrimitive(prim);

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) {
        setHover(null);
        hoverRef.current?.(null);
        return;
      }
      const d = param.seriesData.get(series) as { value?: number } | undefined;
      if (d?.value === undefined) {
        setHover(null);
        hoverRef.current?.(null);
        return;
      }
      const p = { value: d.value, time: param.time as number };
      setHover(p);
      hoverRef.current?.(p);
    });

    chartRef.current = chart;
    seriesRef.current = series;
    refSeriesRef.current = refSeries;
    primRef.current = prim;
    priceLinesRef.current = [];
    setDataTick((n) => n + 1);

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      refSeriesRef.current = null;
      primRef.current = null;
      priceLinesRef.current = [];
    };
    // digits only affects the formatter; a change is rare and acceptable to rebuild on.
  }, [height, kind, axes, digits, themeTick]);

  // Derived, memoised geometry.
  const derived = useMemo(() => {
    const times = data.map((d) => d.time);
    const refAt = (time: number): ChartRef | null => {
      if (!reference || reference.length === 0) return null;
      let cur: ChartRef | null = null;
      for (const r of reference) {
        if (r.time <= time) cur = r;
        else break;
      }
      return cur ?? reference[0];
    };
    const refValues: (number | null)[] = data.map((d) => refAt(d.time)?.value ?? null);
    const anyNonNormal = data.some((d) => {
      const r = refAt(d.time);
      return d.halted || (r && r.mode !== "normal");
    });
    const values = data.map((d) => d.value);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const bandOnScreen = data.some((d) => {
      const r = refAt(d.time);
      if (!r) return false;
      const bl = r.value * (1 - r.bandBps / 10000);
      const bh = r.value * (1 + r.bandBps / 10000);
      return bl <= hi && bh >= lo;
    });
    const drawBand = showBand ?? (anyNonNormal || bandOnScreen);
    const band: Overlay["band"] = data.map((d) => {
      const r = refAt(d.time);
      if (!drawBand || !r || d.halted || r.mode === "halted") return null;
      if (r.mode === "directional") {
        // Only the half toward the reference.
        return { lo: Math.min(r.value, d.value), hi: Math.max(r.value, d.value) };
      }
      return { lo: r.value * (1 - r.bandBps / 10000), hi: r.value * (1 + r.bandBps / 10000) };
    });
    const halts: Overlay["halts"] = [];
    let start = -1;
    data.forEach((d, i) => {
      if (d.halted && start < 0) start = i;
      if (!d.halted && start >= 0) {
        halts.push({ from: start, to: i - 1 });
        start = -1;
      }
    });
    if (start >= 0) halts.push({ from: start, to: data.length - 1 });
    const rej: Overlay["rejects"] = rejects.map((t) => {
      const i = nearestIndex(times, t);
      return { index: i, value: data[i]?.value ?? 0 };
    });
    const bandVals = band.flatMap((b) => (b ? [b.lo, b.hi] : []));
    const extra = [...lines.map((l) => l.price), ...(baseline !== undefined ? [baseline] : []), ...bandVals, ...refValues.filter((v): v is number => v !== null)];
    return {
      times,
      refValues,
      band,
      halts,
      rej,
      min: Math.min(lo, ...extra),
      max: Math.max(hi, ...extra),
      lastBand: [...band].reverse().find((b) => b) ?? null,
    };
  }, [data, reference, showBand, lines, baseline, rejects]);

  // 2. Push data into the existing chart.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const refSeries = refSeriesRef.current;
    const prim = primRef.current;
    const t = tokensRef.current;
    if (!chart || !series || !refSeries || !prim || !t || data.length === 0) return;

    rangeRef.current = { min: derived.min, max: derived.max };
    const colour = up ? t.gain : t.loss;
    if (kind === "raised") (series as ISeriesApi<"Area">).applyOptions({ lineColor: t.gain });
    else (series as ISeriesApi<"Line">).applyOptions({ color: colour });

    series.setData(data.map((d) => ({ time: d.time as UTCTimestamp, value: d.value })));

    const hasRef = derived.refValues.some((v) => v !== null);
    refSeries.applyOptions({ visible: hasRef });
    refSeries.setData(hasRef ? data.map((d, i) => ({ time: d.time as UTCTimestamp, value: derived.refValues[i] ?? data[i].value })) : []);

    for (const pl of priceLinesRef.current) series.removePriceLine(pl);
    priceLinesRef.current = [];
    const mk = (price: number) =>
      series.createPriceLine({ price, color: t.lineStrong, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });
    if (baseline !== undefined) priceLinesRef.current.push(mk(baseline));
    for (const l of lines) priceLinesRef.current.push(mk(l.price));

    prim.set({ halts: derived.halts, band: derived.band, rejects: derived.rej });
    chart.timeScale().fitContent();

    // H / L / last + right-edge labels, positioned after layout.
    let raf = 0;
    const place = () => {
      const w = el.current?.clientWidth ?? 0;
      const h = el.current?.clientHeight ?? height;
      const out: Label[] = [];
      const x = (i: number) => chart.timeScale().logicalToCoordinate(i as Logical);
      const y = (v: number) => series.priceToCoordinate(v);
      if (labels && data.length > 1) {
        let hiI = 0;
        let loI = 0;
        data.forEach((d, i) => {
          if (d.value > data[hiI].value) hiI = i;
          if (d.value < data[loI].value) loI = i;
        });
        const push = (i: number, anchor: Label["anchor"], prefix: string) => {
          const px = x(i);
          const py = y(data[i].value);
          if (px === null || py === null) return;
          const text = `${prefix}${data[i].value.toFixed(digits)}`;
          // Keep the label inside the chart; a low label near the bottom-left would sit on the attribution logo.
          const half = text.length * 4 + 4;
          const cx0 = Math.min(Math.max(px, half), Math.max(half, w - half));
          const flip = anchor === "below" && cx0 < 90 && py > h - 64;
          // Flipped labels near the bottom-left also nudge right, clear of the attribution logo.
          out.push({ x: flip ? Math.max(cx0, 80) : cx0, y: py, text, anchor: flip ? "above" : anchor });
        };
        // The last point already carries the right-edge value label.
        if (hiI !== data.length - 1) push(hiI, "above", "H ");
        if (loI !== data.length - 1) push(loI, "below", "L ");
        const lastY = y(data[data.length - 1].value);
        if (lastY !== null) out.push({ x: w, y: lastY, text: data[data.length - 1].value.toFixed(digits), anchor: "right" });
      }
      for (const l of lines) {
        const py = y(l.price);
        if (l.label && py !== null) out.push({ x: w, y: py, text: l.label, anchor: "right" });
      }
      if (derived.lastBand) {
        const yh = y(derived.lastBand.hi);
        const yl = y(derived.lastBand.lo);
        if (yh !== null) out.push({ x: w, y: yh, text: derived.lastBand.hi.toFixed(Math.max(digits, 3)), anchor: "right" });
        if (yl !== null) out.push({ x: w, y: yl, text: derived.lastBand.lo.toFixed(Math.max(digits, 3)), anchor: "right" });
      }
      const key = JSON.stringify(out);
      if (key !== lastKey) {
        lastKey = key;
        setPlaced(out);
      }
      // Complete when every label that can exist has resolved to a coordinate.
      const expected =
        (labels && data.length > 1 ? 1 + (hiIdx() !== data.length - 1 ? 1 : 0) + (loIdx() !== data.length - 1 ? 1 : 0) : 0) +
        lines.filter((l) => l.label).length +
        (derived.lastBand ? 2 : 0);
      return out.length >= expected && w > 0;
    };
    const hiIdx = () => data.reduce((b, d, i) => (d.value > data[b].value ? i : b), 0);
    const loIdx = () => data.reduce((b, d, i) => (d.value < data[b].value ? i : b), 0);
    let lastKey = "";
    // The chart sizes itself asynchronously (autoSize); poll until every coordinate resolves (max ~2s).
    let tries = 0;
    const attempt = () => {
      if (!place() && tries++ < 120) raf = requestAnimationFrame(attempt);
    };
    raf = requestAnimationFrame(attempt);
    const onLayout = () => {
      cancelAnimationFrame(raf);
      tries = 0;
      raf = requestAnimationFrame(attempt);
    };
    chart.timeScale().subscribeSizeChange(onLayout);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onLayout);
    return () => {
      cancelAnimationFrame(raf);
      chart.timeScale().unsubscribeSizeChange(onLayout);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onLayout);
    };
  }, [data, derived, baseline, lines, kind, up, digits, labels, height, dataTick]);

  return (
    <div className={cx("relative", className)}>
      {readout && (
        <div className="flex h-6 items-center justify-between" aria-live="polite">
          {hover ? (
            <>
              <span className="t-caption num">{dateTimeIST(hover.time)}</span>
              <span className="t-readout num text-text">{hover.value.toFixed(digits)}</span>
            </>
          ) : null}
        </div>
      )}
      <div className="relative" style={{ height, touchAction: "pan-y" }}>
        <div ref={el} className="absolute inset-0" onMouseLeave={() => setHover(null)} />
        {placed.map((l, i) => (
          <span
            key={i}
            aria-hidden
            className="num pointer-events-none absolute text-[13px] leading-[18px] font-medium whitespace-nowrap text-text-2"
            style={
              l.anchor === "right"
                ? { right: 0, top: l.y, transform: "translateY(-50%)" }
                : { left: Math.max(0, l.x), top: l.y, transform: l.anchor === "above" ? "translate(-50%, calc(-100% - 6px))" : "translate(-50%, 6px)" }
            }
          >
            {l.text}
          </span>
        ))}
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            className="t-nav-label absolute right-3 bottom-3 flex h-12 items-center gap-1.5 rounded-full bg-surface-2 px-4 text-text lg:hidden"
          >
            <Maximize2 className="size-[18px]" /> Expand
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Range chips: 1D · 1W · All (UX.md 3.11). Selected = grey fill, dark border.
// ---------------------------------------------------------------------------

export function RangeChips<T extends string = ChartRange>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (r: T) => void;
  /** Defaults to the three chart ranges. */
  options?: { id: T; label: string }[];
  className?: string;
}) {
  const opts = options ?? ((["1D", "1W", "ALL"] as ChartRange[]).map((r) => ({ id: r, label: RANGE_LABELS[r] })) as unknown as { id: T; label: string }[]);
  return (
    <div role="radiogroup" aria-label="Chart range" className={cx("flex gap-2", className)}>
      {opts.map((o) => (
        <Chip key={o.id} variant="range" selected={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </Chip>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fullscreen chart (UI.md 3.7): fixed view, bar with Back + name + readout,
// chart fills the height with the time axis on, range chips at the bottom.
// ---------------------------------------------------------------------------

export function FullscreenChart({
  open,
  onClose,
  title,
  chart,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Render prop so the caller keeps control of chart props; receives the available height. */
  chart: (height: number) => ReactNode;
  /** Range chips row. */
  footer?: ReactNode;
}) {
  const [h, setH] = useState(300);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    try {
      (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape").catch(() => {});
    } catch {}
    const measure = () => setH(Math.max(200, (body.current?.clientHeight ?? 300) - 32));
    measure();
    window.addEventListener("resize", measure);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("resize", measure);
      window.removeEventListener("keydown", onKey);
      try {
        (screen.orientation as ScreenOrientation & { unlock?: () => void }).unlock?.();
      } catch {}
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg px-[max(20px,env(safe-area-inset-left))] pr-[max(20px,env(safe-area-inset-right))]" role="dialog" aria-modal="true" aria-label={`${title} chart`}>
      <div className="flex h-14 shrink-0 items-center gap-2 pt-[env(safe-area-inset-top)]">
        <button type="button" onClick={onClose} className="t-chip -ml-2 flex h-12 items-center gap-1 rounded-[10px] px-2 text-text">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m12 19-7-7 7-7" />
            <path d="M19 12H5" />
          </svg>
          Back
        </button>
        <span className="t-list-title truncate text-text">{title}</span>
      </div>
      <div ref={body} className="min-h-0 flex-1 py-2">
        {chart(h)}
      </div>
      {footer && <div className="shrink-0 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</div>}
    </div>
  );
}
