"use client";

// Thin wrapper over TradingView Lightweight Charts v5 (Apache-2.0).
// The attribution logo stays on (licence requirement); the NOTICE text is on /about.

import { useEffect, useRef, useState } from "react";
import {
  BaselineSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  LineType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

type Pt = { time: number; value: number };
export type ChartLine = { price: number; color: "brand" | "gain" | "loss" | "warn" | "muted"; title?: string; style?: "dashed" | "dotted" | "solid" };
export type ChartMarker = { time: number; kind: "reject" | "event" | "halt"; text?: string };

function readTokens() {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    brand: v("--brand"),
    gain: v("--gain"),
    loss: v("--loss"),
    warn: v("--warn"),
    muted: v("--muted"),
    fg: v("--fg"),
    line: v("--line"),
    card: v("--card"),
  };
}

const ist = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
const istDay = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

function alpha(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function snap(points: Pt[], t: number) {
  let best = points[0]?.time ?? t;
  for (const p of points) if (Math.abs(p.time - t) < Math.abs(best - t)) best = p.time;
  return best;
}

export function TimeChart({
  data,
  kind = "baseline",
  baseValue,
  color = "gain",
  reference,
  lines = [],
  markers = [],
  height = 220,
  digits = 3,
  onHover,
}: {
  data: Pt[];
  kind?: "baseline" | "line" | "step";
  baseValue?: number;
  color?: "brand" | "gain" | "loss";
  reference?: Pt[];
  lines?: ChartLine[];
  markers?: ChartMarker[];
  height?: number;
  digits?: number;
  onHover?: (p: { value: number; time: number } | null) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [scheme, setScheme] = useState(0);
  const hoverRef = useRef(onHover);
  useEffect(() => {
    hoverRef.current = onHover;
  }, [onHover]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setScheme((s) => s + 1);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    if (!el.current || data.length === 0) return;
    const c = readTokens();
    const chart: IChartApi = createChart(el.current, {
      height,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: c.muted,
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 11,
        attributionLogo: true,
      },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { visible: false, scaleMargins: { top: 0.12, bottom: 0.12 } },
      leftPriceScale: { visible: false },
      timeScale: {
        visible: false,
        borderVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: c.muted, style: LineStyle.Dashed, labelVisible: true, labelBackgroundColor: c.fg },
        horzLine: { visible: false, labelVisible: false },
      },
      handleScroll: false,
      handleScale: false,
      localization: {
        timeFormatter: (t: Time) => {
          const d = new Date((t as number) * 1000);
          return `${istDay.format(d)} ${ist.format(d)} IST`;
        },
        priceFormatter: (p: number) => p.toFixed(digits),
      },
    });

    const values = data.map((d) => d.value);
    const extra = lines.map((l) => l.price);
    const lo = Math.min(...values, ...extra);
    const hi = Math.max(...values, ...extra);
    const autoscaleInfoProvider = () => ({ priceRange: { minValue: lo, maxValue: hi } });

    let series: ISeriesApi<"Baseline"> | ISeriesApi<"Line">;
    if (kind === "baseline") {
      series = chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: baseValue ?? data[0].value },
        topLineColor: c.gain,
        bottomLineColor: c.loss,
        topFillColor1: alpha(c.gain, 0.22),
        topFillColor2: alpha(c.gain, 0.02),
        bottomFillColor1: alpha(c.loss, 0.02),
        bottomFillColor2: alpha(c.loss, 0.22),
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        autoscaleInfoProvider,
      });
    } else {
      series = chart.addSeries(LineSeries, {
        color: c[color],
        lineWidth: 2,
        lineType: kind === "step" ? LineType.WithSteps : LineType.Simple,
        priceLineVisible: false,
        lastValueVisible: false,
        autoscaleInfoProvider,
      });
    }
    series.setData(data.map((d) => ({ time: d.time as UTCTimestamp, value: d.value })));

    if (reference && reference.length) {
      const last = data[data.length - 1].time;
      const refPts = reference
        .filter((r) => r.time <= last)
        .map((r) => ({ time: Math.max(r.time, data[0].time), value: r.value }));
      const lastRef = refPts.at(-1) ?? { value: reference.at(-1)!.value };
      if (refPts.length === 0 || refPts.at(-1)!.time < last) refPts.push({ time: last, value: lastRef.value });
      const dedup = refPts.filter((p, i, a) => i === a.length - 1 || a[i + 1].time !== p.time);
      const ref = chart.addSeries(LineSeries, {
        color: c.brand,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        lineType: LineType.WithSteps,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider,
      });
      ref.setData(dedup.map((d) => ({ time: d.time as UTCTimestamp, value: d.value })));
    }

    for (const l of lines) {
      series.createPriceLine({
        price: l.price,
        color: c[l.color],
        lineWidth: 1,
        lineStyle: l.style === "solid" ? LineStyle.Solid : l.style === "dotted" ? LineStyle.Dotted : LineStyle.Dashed,
        axisLabelVisible: false,
        title: l.title ?? "",
      });
    }

    if (markers.length) {
      const sm: SeriesMarker<Time>[] = markers
        .filter((m) => m.time >= data[0].time && m.time <= data[data.length - 1].time)
        .map((m) => ({
          time: snap(data, m.time) as UTCTimestamp,
          position: (m.kind === "reject" ? "aboveBar" : "belowBar") as "aboveBar" | "belowBar",
          shape: (m.kind === "reject" ? "arrowDown" : m.kind === "halt" ? "square" : "circle") as "arrowDown" | "square" | "circle",
          color: m.kind === "reject" || m.kind === "halt" ? c.loss : c.brand,
          text: m.text,
          size: 1,
        }))
        .sort((a, b) => (a.time as number) - (b.time as number));
      createSeriesMarkers(series, sm);
    }

    chart.timeScale().fitContent();

    chart.subscribeCrosshairMove((param) => {
      const cb = hoverRef.current;
      if (!cb) return;
      if (!param.time || !param.point) return cb(null);
      const d = param.seriesData.get(series) as { value?: number } | undefined;
      if (d?.value === undefined) return cb(null);
      cb({ value: d.value, time: param.time as number });
    });

    return () => chart.remove();
  }, [data, kind, baseValue, color, reference, lines, markers, height, digits, scheme]);

  return <div ref={el} className="w-full" style={{ height }} onMouseLeave={() => hoverRef.current?.(null)} />;
}

