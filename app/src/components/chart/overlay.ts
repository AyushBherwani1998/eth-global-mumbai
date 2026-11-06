// The only things drawn on the chart besides the price itself: halt shading,
// the dotted window-open baseline, the trading limits when they are close
// enough to matter, and the x marks for rejected swaps.
//
// Geometry is in grid space (0 .. n-1), the same space the series uses, so a
// tween moves the overlay with the line for free.

import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import type { Mark, Span } from "./series";

export type OverlayTokens = { lineStrong: string; loss: string; lossFill: string };

export type OverlayData = {
  /** One entry per tween side, so marks cross-fade instead of popping. */
  halts: { spans: Span[]; alpha: number }[];
  rejects: { marks: Mark[]; alpha: number }[];
  baseline: { value: number; alpha: number } | null;
  limits: { value: number; alpha: number }[];
};

const EMPTY: OverlayData = { halts: [], rejects: [], baseline: null, limits: [] };

type DrawTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

class OverlayRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly layer: "bottom" | "top",
    private readonly prim: OverlayPrimitive,
  ) {}

  draw(target: DrawTarget) {
    const p = this.prim;
    const chart = p.chart;
    const series = p.series;
    if (!chart || !series) return;
    const t = p.tokens;
    const d = p.data;
    // Lightweight Charts returns 0 for a fractional logical index, so a
    // position between two bars is interpolated from its neighbours.
    const ts = chart.timeScale();
    const x = (i: number) => {
      const lo = Math.floor(i);
      const a = ts.logicalToCoordinate(lo as Logical);
      if (a === null) return null;
      if (lo === i) return a;
      const b = ts.logicalToCoordinate((lo + 1) as Logical);
      return b === null ? a : a + (b - a) * (i - lo);
    };
    const y = (v: number) => series.priceToCoordinate(v);
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.save();
      if (this.layer === "bottom") {
        for (const set of d.halts) {
          if (set.alpha <= 0.01) continue;
          ctx.globalAlpha = set.alpha;
          ctx.fillStyle = t.lossFill;
          for (const h of set.spans) {
            const x1 = x(h.from);
            const x2 = x(h.to);
            if (x1 === null || x2 === null) continue;
            ctx.fillRect(Math.min(x1, x2), 0, Math.max(2, Math.abs(x2 - x1)), mediaSize.height);
          }
        }
        ctx.lineWidth = 1;
        ctx.strokeStyle = t.lineStrong;
        // Window open: Groww's previous-close line, the thing the change is from.
        if (d.baseline && d.baseline.alpha > 0.01) {
          const yy = y(d.baseline.value);
          if (yy !== null) {
            ctx.globalAlpha = d.baseline.alpha;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(0, Math.round(yy) + 0.5);
            ctx.lineTo(mediaSize.width, Math.round(yy) + 0.5);
            ctx.stroke();
          }
        }
        // Trading limits: dashed, so they never read as a second baseline.
        ctx.setLineDash([4, 4]);
        for (const l of d.limits) {
          if (l.alpha <= 0.01) continue;
          const yy = y(l.value);
          if (yy === null) continue;
          ctx.globalAlpha = l.alpha;
          ctx.beginPath();
          ctx.moveTo(0, Math.round(yy) + 0.5);
          ctx.lineTo(mediaSize.width, Math.round(yy) + 0.5);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = t.loss;
        ctx.lineWidth = 1.5;
        ctx.lineCap = "round";
        const r = 4.5;
        for (const set of d.rejects) {
          if (set.alpha <= 0.01) continue;
          ctx.globalAlpha = set.alpha;
          for (const m of set.marks) {
            const cx = x(m.x);
            const cy = y(m.value);
            if (cx === null || cy === null) continue;
            ctx.beginPath();
            ctx.moveTo(cx - r, cy - r);
            ctx.lineTo(cx + r, cy + r);
            ctx.moveTo(cx + r, cy - r);
            ctx.lineTo(cx - r, cy + r);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
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

export class OverlayPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<"Line"> | ISeriesApi<"Area"> | null = null;
  data: OverlayData = EMPTY;
  private requestUpdate: (() => void) | null = null;
  private readonly views: OverlayView[];

  constructor(public tokens: OverlayTokens) {
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
  set(data: OverlayData) {
    this.data = data;
    this.requestUpdate?.();
  }
}
