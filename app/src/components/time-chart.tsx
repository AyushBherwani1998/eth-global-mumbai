"use client";

// PriceChart (UI.md section 3, UX.md 3.11) over TradingView Lightweight Charts v5
// (Apache-2.0; the attribution logo stays on, the NOTICE text is on /about).
//
// The frame holds one thing: the price. The line (or candles) is scaled to the
// data in the selected window, with one dotted line at the window open and
// nothing else unless it is load-bearing (halt shading, rejected swaps, a
// trading limit that is actually close). Everything numeric lives in the page
// header or in the crosshair readout.
//
// The chart object is created once per theme / kind / height. Changing the
// window or the chart type tweens: both windows are resampled onto one grid and
// the values, the price scale and the overlay are interpolated over 340ms.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  LineType,
  TrackingModeExitMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useOnThemeChange } from "./theme";
import { Chip, cx } from "./ui";
import { OverlayPrimitive, type OverlayTokens } from "./chart/overlay";
import {
  buildShape,
  clamp,
  collapse,
  easeOutCubic,
  lerpShape,
  mix,
  resampleShape,
  withAlpha,
  type ChartPoint,
  type Shape,
} from "./chart/series";
import type { ChartType } from "./chart/controls";
import { dateTimeIST, timeIST } from "@/lib/format";
import type { Mode } from "@/lib/mock";

export type { ChartPoint } from "./chart/series";
export type ChartRef = { time: number; value: number; mode: Mode; bandBps: number };
export type ChartLine = { price: number; label?: string };
export type HoverPoint = { time: number; value: number } | null;
export type ChartRange = "5m" | "15m" | "30m" | "1H" | "1D" | "1W" | "ALL";

/** Stable empty defaults: a fresh array each render would re-run the data effect. */
const NO_LINES: ChartLine[] = [];
const NO_REJECTS: number[] = [];

/** How long a window or type change takes to morph. */
const TWEEN_MS = 340;

export const RANGE_SECONDS: Record<ChartRange, number> = {
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1H": 3600,
  "1D": 86400,
  "1W": 7 * 86400,
  ALL: Infinity,
};
export const RANGE_LABELS: Record<ChartRange, string> = {
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1H": "1H",
  "1D": "1D",
  "1W": "1W",
  ALL: "All",
};
export const RANGES: ChartRange[] = ["5m", "15m", "30m", "1H", "1D", "1W", "ALL"];
/** Plain words for the header, next to the change. */
export const RANGE_WORDS: Record<ChartRange, string> = {
  "5m": "Last 5 minutes",
  "15m": "Last 15 minutes",
  "30m": "Last 30 minutes",
  "1H": "Last hour",
  "1D": "Last 24 hours",
  "1W": "Last 7 days",
  ALL: "Since listing",
};
export const RANGE_OPTIONS = RANGES.map((id) => ({ id, label: RANGE_LABELS[id] }));

/** Points within the range ending at `nowSec`; always at least two points. */
export function sliceRange<T extends { time: number }>(points: T[], range: ChartRange, nowSec: number): T[] {
  const from = nowSec - RANGE_SECONDS[range];
  const pts = points.filter((p) => p.time >= from);
  return pts.length > 1 ? pts : points.slice(-2);
}

type Tokens = OverlayTokens & { bg: string; text2: string; gain: string; loss: string; gainFill: string };

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
  };
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

type EdgeLabel = { y: number; text: string };

// ---------------------------------------------------------------------------
// PriceChart
// ---------------------------------------------------------------------------

export function PriceChart({
  data,
  kind = "market",
  type = "line",
  baseline,
  reference,
  showBand,
  lines = NO_LINES,
  rejects = NO_REJECTS,
  height = 280,
  digits = 2,
  onHover,
  readout = true,
  labels = true,
  axes = false,
  detail = false,
  className,
}: {
  data: ChartPoint[];
  /** market: line or candles. clearing: step line. raised: line with a soft area fill. */
  kind?: "market" | "clearing" | "raised";
  /** Candles are offered on the market chart only. */
  type?: ChartType;
  /** Dotted line at the start of the window, or the issue price on an ICO. */
  baseline?: number;
  /** Reference price over time with its band; sets the trading limits. */
  reference?: ChartRef[];
  /** Force the trading limits on or off. Default: on when a reference is given. */
  showBand?: boolean;
  /** Caller-supplied levels (floor, cap, minimum raise) with right-edge labels. */
  lines?: ChartLine[];
  /** Times (seconds) of reverted swaps. */
  rejects?: number[];
  height?: number;
  digits?: number;
  onHover?: (p: HoverPoint) => void;
  /** Reserve a 24px readout line above the chart (time left, value right). */
  readout?: boolean;
  /** Right-edge labels for levels and limits. */
  labels?: boolean;
  /** The library's own time axis (Expand only). */
  axes?: boolean;
  /** Expand view: also draws the reference step line. */
  detail?: boolean;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<"Line"> | ISeriesApi<"Area"> | null>(null);
  const barRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const refRef = useRef<ISeriesApi<"Line"> | null>(null);
  const primRef = useRef<OverlayPrimitive | null>(null);
  const tokensRef = useRef<Tokens | null>(null);
  const rangeRef = useRef<{ min: number; max: number }>({ min: 0, max: 1 });
  const digitsRef = useRef(digits);
  const hoverRef = useRef(onHover);
  const shownRef = useRef<Shape | null>(null);
  const barDataRef = useRef(false);
  const snapRef = useRef(true);
  const [themeTick, setThemeTick] = useState(0);
  const [hover, setHover] = useState<HoverPoint>(null);
  const [edge, setEdge] = useState<EdgeLabel[]>([]);
  const [moving, setMoving] = useState(false);
  // Bumped after (re)creation so the data effect runs against the new chart.
  const [dataTick, setDataTick] = useState(0);

  useEffect(() => {
    hoverRef.current = onHover;
  }, [onHover]);
  useEffect(() => {
    digitsRef.current = digits;
  }, [digits]);

  const onTheme = useCallback(() => {
    snapRef.current = true;
    setThemeTick((t) => t + 1);
  }, []);
  useOnThemeChange(onTheme);

  const windowBase = baseline ?? (data.length > 0 ? data[0].value : 0);
  const hoverAbs = hover && windowBase ? hover.value - windowBase : 0;
  const hoverRel = hover && windowBase ? (hoverAbs / windowBase) * 100 : 0;
  const enough = data.length > 1;

  // 1. Create the chart once per theme / kind / height / axes.
  useEffect(() => {
    if (!el.current || !enough) return;
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
      rightPriceScale: { visible: false, scaleMargins: { top: 0.12, bottom: 0.12 } },
      leftPriceScale: { visible: false },
      timeScale: {
        visible: axes,
        borderVisible: false,
        fixLeftEdge: false,
        fixRightEdge: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 0,
      },
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
        priceFormatter: (p: number) => p.toFixed(digitsRef.current),
      },
    });

    // The one rule the whole redesign turns on: the scale is the data's own
    // low and high. Limits, levels and the baseline never widen it.
    const autoscaleInfoProvider = () => ({ priceRange: { minValue: rangeRef.current.min, maxValue: rangeRef.current.max } });

    const refSeries = detail
      ? chart.addSeries(LineSeries, {
          color: t.text2,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          lineType: LineType.WithSteps,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          autoscaleInfoProvider,
          visible: false,
        })
      : null;

    const common = {
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 5,
      crosshairMarkerBorderColor: t.bg,
      crosshairMarkerBorderWidth: 2,
      autoscaleInfoProvider,
    };
    const main =
      kind === "raised"
        ? chart.addSeries(AreaSeries, {
            ...common,
            lineColor: t.gain,
            lineWidth: 3,
            topColor: t.gainFill,
            bottomColor: "transparent",
            lineType: LineType.Simple,
          })
        : chart.addSeries(LineSeries, {
            ...common,
            color: t.gain,
            lineWidth: 3,
            lineType: kind === "clearing" ? LineType.WithSteps : LineType.Simple,
          });

    // Candles sit above the line so they come forward as it fades.
    const bars =
      kind === "market"
        ? chart.addSeries(CandlestickSeries, {
            upColor: t.gain,
            downColor: t.loss,
            wickUpColor: t.gain,
            wickDownColor: t.loss,
            borderVisible: false,
            priceLineVisible: false,
            lastValueVisible: false,
            autoscaleInfoProvider,
          })
        : null;

    const prim = new OverlayPrimitive(t);
    main.attachPrimitive(prim);

    chart.subscribeCrosshairMove((param) => {
      const d = param.time && param.point ? (param.seriesData.get(main) as { value?: number } | undefined) : undefined;
      if (!d || d.value === undefined) {
        setHover(null);
        hoverRef.current?.(null);
        return;
      }
      const p = { value: d.value, time: param.time as number };
      setHover(p);
      hoverRef.current?.(p);
    });

    chartRef.current = chart;
    mainRef.current = main;
    barRef.current = bars;
    refRef.current = refSeries;
    primRef.current = prim;
    barDataRef.current = false;
    shownRef.current = null;
    snapRef.current = true;
    setDataTick((n) => n + 1);

    return () => {
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
      barRef.current = null;
      refRef.current = null;
      primRef.current = null;
    };
  }, [height, kind, axes, detail, enough, themeTick]);

  const refValues = useMemo(() => {
    if (!detail || !reference || reference.length === 0) return null;
    let i = 0;
    return data.map((d) => {
      while (i + 1 < reference.length && reference[i + 1].time <= d.time) i += 1;
      return reference[i].value;
    });
  }, [data, reference, detail]);

  // 2. Tween into the new window / type.
  useEffect(() => {
    const chart = chartRef.current;
    const main = mainRef.current;
    const prim = primRef.current;
    const t = tokensRef.current;
    if (!chart || !main || !prim || !t || !enough) return;
    const bars = barRef.current;

    const wantBars = type === "bars" && bars !== null;
    const target = buildShape(data, wantBars, {
      reference,
      rejects,
      baseline,
      levels: lines,
      limits: showBand,
    });

    const paint = (s: Shape) => {
      rangeRef.current = { min: s.min, max: s.max };
      const colour = mix(t.loss, t.gain, s.upness);
      if (kind === "raised") {
        (main as ISeriesApi<"Area">).applyOptions({
          lineColor: withAlpha(t.gain, s.aLine),
          topColor: withAlpha(t.gain, 0.1 * s.aLine),
          crosshairMarkerBackgroundColor: t.gain,
        });
      } else {
        (main as ISeriesApi<"Line">).applyOptions({
          color: mix(t.loss, t.gain, s.upness, s.aLine),
          crosshairMarkerBackgroundColor: colour,
        });
      }
      main.setData(s.bars.map((b) => ({ time: b.time as UTCTimestamp, value: b.close })));
      if (bars) {
        if (s.aBars <= 0.01) {
          if (barDataRef.current) {
            bars.setData([]);
            barDataRef.current = false;
          }
        } else {
          bars.applyOptions({
            upColor: withAlpha(t.gain, s.aBars),
            downColor: withAlpha(t.loss, s.aBars),
            wickUpColor: withAlpha(t.gain, s.aBars),
            wickDownColor: withAlpha(t.loss, s.aBars),
          });
          bars.setData(
            collapse(s.bars, easeOutCubic(s.aBars)).map((b) => ({
              time: b.time as UTCTimestamp,
              open: b.open,
              high: b.high,
              low: b.low,
              close: b.close,
            })),
          );
          barDataRef.current = true;
        }
      }
      if (refRef.current) {
        const show = refValues !== null && s.aLine + s.aBars > 0;
        refRef.current.applyOptions({ visible: show });
        refRef.current.setData(
          show && refValues ? s.bars.map((b, i) => ({ time: b.time as UTCTimestamp, value: refValues[Math.min(refValues.length - 1, Math.round((i / Math.max(1, s.n - 1)) * (refValues.length - 1)))] })) : [],
        );
      }
      prim.set({ halts: s.halts, rejects: s.rejects, baseline: s.baseline, limits: s.limits });
      shownRef.current = s;
      // The line runs edge to edge (Groww); candles need half a bar of air so
      // the last one is not sliced by the frame. The gap grows with the bars.
      const pad = 0.7 * s.aBars;
      chart.timeScale().setVisibleLogicalRange({ from: -pad, to: s.n - 1 + pad });
    };

    const from = shownRef.current;
    const instant = !from || snapRef.current || prefersReducedMotion();
    snapRef.current = false;
    if (instant) {
      paint(target);
      setMoving(false);
      return;
    }

    // Both windows onto one grid: the bar count never changes mid-tween, so the
    // time axis cannot jump and there is never a frame with no data.
    const source = resampleShape(from, target.n);
    setMoving(true);
    let raf = 0;
    let start = 0;
    const step = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min(1, (ts - start) / TWEEN_MS);
      paint(p >= 1 ? target : lerpShape(source, target, easeOutCubic(p)));
      if (p < 1) raf = requestAnimationFrame(step);
      else setMoving(false);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [data, type, kind, baseline, reference, rejects, lines, showBand, refValues, enough, dataTick]);

  // 3. Right-edge labels for levels and limits, once the tween has settled.
  useEffect(() => {
    const main = mainRef.current;
    const chart = chartRef.current;
    if (!main || !chart || !labels || moving || !enough) return;
    let raf = 0;
    let tries = 0;
    const place = (): boolean => {
      const s = shownRef.current;
      const h = el.current?.clientHeight ?? height;
      if (!s || h < 40) return false;
      const out: EdgeLabel[] = [];
      for (const l of s.limits) {
        if (l.alpha < 0.5) continue;
        const y = main.priceToCoordinate(l.value);
        if (y === null) return false;
        const top = 11;
        const bottom = h - 11;
        const yy = clamp(y, top, bottom);
        // A limit above or below the window stays pinned to the edge it left,
        // with a caret, so "how much room is left" never disappears.
        const caret = y < top ? " ↑" : y > bottom ? " ↓" : "";
        out.push({ y: yy, text: `${l.label ?? l.value.toFixed(Math.max(digits, 3))}${caret}` });
      }
      out.sort((a, b) => a.y - b.y);
      for (let i = 1; i < out.length; i += 1) if (out[i].y - out[i - 1].y < 18) out[i].y = out[i - 1].y + 18;
      setEdge((prev) => (prev.length === out.length && prev.every((p, i) => p.text === out[i].text && Math.abs(p.y - out[i].y) < 0.5) ? prev : out));
      return true;
    };
    const attempt = () => {
      if (!place() && tries++ < 90) raf = requestAnimationFrame(attempt);
    };
    raf = requestAnimationFrame(attempt);
    const onLayout = () => {
      cancelAnimationFrame(raf);
      tries = 0;
      raf = requestAnimationFrame(attempt);
    };
    chart.timeScale().subscribeSizeChange(onLayout);
    return () => {
      cancelAnimationFrame(raf);
      chart.timeScale().unsubscribeSizeChange(onLayout);
    };
  }, [moving, labels, digits, height, enough, dataTick]);

  if (!enough) {
    return (
      <div className={cx("relative", className)}>
        {readout && <div className="h-6" />}
        <div className="flex items-center justify-center rounded-[10px] border border-dashed border-line" style={{ height }}>
          <p className="t-caption px-6 text-center">
            {data.length === 1 ? "Only one price so far. The chart starts after the next trade." : "No prices yet for this window."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cx("relative", className)}>
      {readout && (
        <div className="flex h-6 items-center justify-between gap-3" aria-live="polite">
          {hover ? (
            <>
              <span className="t-caption num truncate">{dateTimeIST(hover.time)}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="t-readout num text-text">{hover.value.toFixed(digits)}</span>
                <span className={cx("num t-change-sm", hoverAbs >= 0 ? "text-gain-text" : "text-loss-text")}>
                  {hoverAbs >= 0 ? "+" : "-"}
                  {Math.abs(hoverAbs).toFixed(digits)} ({Math.abs(hoverRel).toFixed(2)}%)
                </span>
              </span>
            </>
          ) : null}
        </div>
      )}
      <div className="relative" style={{ height, touchAction: "pan-y" }}>
        <div
          ref={el}
          className="absolute inset-0"
          onMouseLeave={() => {
            setHover(null);
            hoverRef.current?.(null);
          }}
        />
        {labels &&
          edge.map((l, i) => (
            <span
              key={`${i}-${l.text}`}
              aria-hidden
              className={cx(
                "num pointer-events-none absolute right-0 z-10 rounded-[4px] bg-bg px-1 text-[13px] leading-[18px] text-text-2 transition-opacity duration-200",
                moving ? "opacity-0" : "opacity-100",
              )}
              style={{ top: l.y, transform: "translateY(-50%)" }}
            >
              {l.text}
            </span>
          ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Short toggle row (Price / Subscription). The chart window uses RangeChipRow
// from components/chart/controls.
// ---------------------------------------------------------------------------

export function RangeChips<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (r: T) => void;
  options: { id: T; label: string }[];
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label="Chart view" className={cx("flex gap-2 py-1", className)}>
      {options.map((o) => (
        <Chip key={o.id} variant="range" selected={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </Chip>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fullscreen chart (UI.md 3.7): fixed view, bar with Back + name + readout,
// chart fills the height with the time axis on, controls at the bottom.
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
  /** Range chips, or another control under the chart. */
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
    <div
      className="fixed inset-0 z-50 flex flex-col bg-bg px-[max(20px,env(safe-area-inset-left))] pr-[max(20px,env(safe-area-inset-right))]"
      role="dialog"
      aria-modal="true"
      aria-label={`${title} chart`}
    >
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
