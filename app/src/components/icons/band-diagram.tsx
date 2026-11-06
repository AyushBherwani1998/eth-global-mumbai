// BandDiagram: what a trading band is, and what happens to a trade that would
// land outside it, drawn once instead of explained in a paragraph.
//
// Why this exists. The band is the whole product, and today it reaches the user
// only as sentences: the rule strip, the Trading rule sheet, the band caption
// under the chart and the rejection toast all describe the same picture in
// words. rich/band-meter.tsx shows where the price sits *now*, but it cannot
// show what would happen to a trade, which is the part people get wrong.
//
// How it is drawn. The geometry is flat token-coloured blocks positioned by
// percentage, exactly as the chart draws its band (UI.md 3.1): --band-fill
// between the two limits, the limits as 1px --text-2 rules, the reference
// as a 1px dotted --text-2 line. SVG is used only for the two trade marks,
// which must not stretch with the container: a filled square for a trade that
// goes through, and the same 9px cross the chart already uses for a reverted
// swap (UI.md 3.1 item 6).
//
// Three modes, one frame, so a reader who has seen one has seen them all:
//   normal   one trade inside the limits, one above them
//   oneway   a tighter cap on the side that moves away from the reference
//   halted   no band at all; both trades are turned away
//
// Labels are HTML in our own type classes, never SVG <text>, so they stay 13px
// at every container width and follow the theme like the rest of the page.

import type { ReactNode } from "react";

export type BandMode = "normal" | "oneway" | "halted";

export type BandTrade = {
  /** Price the trade would land at. */
  to: number;
  /** Does the exchange let it through? */
  allowed: boolean;
  /** Short caption printed under the figure. */
  label: string;
};

const INK = "var(--text)";

function Mark({ allowed }: { allowed: boolean }) {
  return allowed ? (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden style={{ display: "block" }}>
      <rect x={3} y={3} width={8} height={8} fill={INK} />
    </svg>
  ) : (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden style={{ display: "block" }}>
      <path d="M2.5 2.5 L11.5 11.5 M11.5 2.5 L2.5 11.5" stroke="var(--loss)" strokeWidth={1.75} strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** Default pair of trades per mode: one that goes through, one that does not. */
function defaultTrades(mode: BandMode, price: number, high: number, reference: number, awayLimit: number): BandTrade[] {
  if (mode === "halted") {
    return [
      { to: price + (high - price) * 0.5, allowed: false, label: "A trade up" },
      { to: price - (price - reference) * 0.8, allowed: false, label: "A trade down" },
    ];
  }
  if (mode === "oneway") {
    return [
      { to: reference + (price - reference) * 0.35, allowed: true, label: "Back toward the reference" },
      { to: awayLimit + (high - awayLimit) * 0.6, allowed: false, label: "Further away from it" },
    ];
  }
  return [
    { to: price + (high - price) * 0.55, allowed: true, label: "Inside today's limits" },
    { to: high + (high - price) * 0.9, allowed: false, label: "Outside today's limits" },
  ];
}

export function BandDiagram({
  mode = "normal",
  /** The price the limits are measured around (`policy.referencePrice`). */
  reference = 1.1,
  /** Today's limits (`market.band`). */
  band = { low: 1.045, high: 1.155 },
  /** Where the price is right now. */
  price = 1.128,
  /**
   * One-way mode only: how far a trade that moves *away* from the reference may
   * go. Defaults to the tighter surveillance cap, 5% of the reference.
   */
  awayLimit,
  trades,
  height = 196,
  digits = 3,
  title,
  className,
}: {
  mode?: BandMode;
  reference?: number;
  band?: { low: number; high: number };
  price?: number;
  awayLimit?: number;
  trades?: BandTrade[];
  height?: number;
  digits?: number;
  title?: ReactNode;
  className?: string;
}) {
  const away = awayLimit ?? reference + (band.high - reference) * 0.45;
  const rows = trades ?? defaultTrades(mode, price, band.high, reference, away);

  // The scale holds every limit, the price and both trade targets, with air at
  // each end so no mark is ever clipped by the frame.
  const values = [band.low, band.high, reference, price, ...rows.map((r) => r.to)];
  const rawLow = Math.min(...values);
  const rawHigh = Math.max(...values);
  const pad = (rawHigh - rawLow) * 0.18 || 0.02;
  const lo = rawLow - pad;
  const hi = rawHigh + pad;
  const y = (v: number) => ((hi - v) / (hi - lo)) * 100;

  const halted = mode === "halted";
  const fmt = (v: number) => v.toFixed(digits);
  // Columns: the price first, then one per trade. They live in the right half of
  // the frame; the left half is the label gutter, so a label and a mark can
  // never land on each other whatever the numbers are.
  const cols = rows.length + 1;

  return (
    <figure className={className}>
      {title && <figcaption className="t-label mb-3">{title}</figcaption>}

      <div className="relative w-full border border-line bg-surface" style={{ height }} role="img" aria-label={ariaLabel(mode, band, reference, rows, digits)}>
        {/* The allowed band. Halted draws the whole field in the halt fill instead. */}
        {halted ? (
          <div aria-hidden className="absolute inset-0" style={{ background: "var(--loss-fill)" }} />
        ) : (
          <div
            aria-hidden
            className="absolute inset-x-0"
            style={{
              top: `${y(band.high)}%`,
              height: `${y(band.low) - y(band.high)}%`,
              background: "var(--band-fill)",
              // The limits are what the figure teaches, so they are drawn in
              // --text-2 rather than the chart's fainter --line-strong.
              borderTop: "1px solid var(--text-2)",
              borderBottom: "1px solid var(--text-2)",
            }}
          />
        )}

        {/* One-way: the tighter cap on the side that moves away from the reference. */}
        {mode === "oneway" && (
          <div aria-hidden className="absolute inset-x-0" style={{ top: `${y(away)}%`, borderTop: "1px solid var(--warn)" }} />
        )}

        {/* The reference price. Dotted --text-2, as in the chart. */}
        <div aria-hidden className="absolute inset-x-0" style={{ top: `${y(reference)}%`, borderTop: "1px dotted var(--text-2)" }} />

        {/* Edge labels. Each sits on its own line with a surface pad so the rule runs behind it, not through it. */}
        {!halted && (
          <>
            <Edge top={y(band.high)} place="above">
              Highest <span className="num">{fmt(band.high)}</span>
            </Edge>
            <Edge top={y(band.low)} place="below">
              Lowest <span className="num">{fmt(band.low)}</span>
            </Edge>
          </>
        )}
        {mode === "oneway" && (
          <Edge top={y(away)} place="above" tone="text-warn">
            Away cap <span className="num">{fmt(away)}</span>
          </Edge>
        )}
        <Edge top={y(reference)} place="below">
          Reference <span className="num">{fmt(reference)}</span>
        </Edge>

        {/* Lane 1: where the price is now. */}
        <Lane left={lanePos(0, cols)}>
          <div aria-hidden className="absolute h-[3px] w-7 -translate-x-1/2 -translate-y-1/2" style={{ top: `${y(price)}%`, background: INK }} />
          <span className="num t-caption absolute -translate-x-1/2 whitespace-nowrap text-text" style={{ top: `calc(${y(price)}% + 6px)` }}>
            {fmt(price)}
          </span>
        </Lane>

        {/* One lane per trade: a dotted run from the price to where it would land. */}
        {rows.map((r, i) => (
          <Lane key={i} left={lanePos(i + 1, cols)}>
            <div
              aria-hidden
              className="absolute w-px -translate-x-1/2"
              style={{
                top: `${Math.min(y(price), y(r.to))}%`,
                height: `${Math.abs(y(r.to) - y(price))}%`,
                borderLeft: "1px dotted var(--text-2)",
              }}
            />
            <span className="absolute -translate-x-1/2 -translate-y-1/2" style={{ top: `${y(r.to)}%` }}>
              <Mark allowed={r.allowed} />
            </span>
            <span
              className="num t-caption absolute -translate-x-1/2 whitespace-nowrap"
              style={{ top: `calc(${y(r.to)}% + 10px)`, color: r.allowed ? "var(--text)" : "var(--loss-text)" }}
            >
              {fmt(r.to)}
            </span>
          </Lane>
        ))}
      </div>

      {/* Legend: the mark, then the sentence it stands for. */}
      <ul className="mt-3 grid gap-2">
        {rows.map((r, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-[3px] shrink-0">
              <Mark allowed={r.allowed} />
            </span>
            <span className="t-body text-text">
              {r.label}
              {" — "}
              <span className={r.allowed ? "text-text-2" : "text-loss-text"}>{r.allowed ? "goes through" : "turned away, nothing is charged"}</span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Columns are evenly spread across the right half, 50% to 88%. */
function lanePos(i: number, cols: number) {
  if (cols < 2) return 68;
  return 50 + (38 / (cols - 1)) * i;
}

function Lane({ left, children }: { left: number; children: ReactNode }) {
  return (
    <div className="absolute inset-y-0" style={{ left: `${left}%` }}>
      {children}
    </div>
  );
}

function Edge({ top, place, tone, children }: { top: number; place: "above" | "below"; tone?: string; children: ReactNode }) {
  return (
    <span
      className={`t-caption absolute left-2 whitespace-nowrap bg-surface px-1 ${tone ?? ""}`}
      style={place === "above" ? { top: `calc(${top}% - 20px)` } : { top: `calc(${top}% + 3px)` }}
    >
      {children}
    </span>
  );
}

function ariaLabel(mode: BandMode, band: { low: number; high: number }, reference: number, rows: BandTrade[], digits: number) {
  const where =
    mode === "halted"
      ? "Trading is halted, so no price goes through."
      : `Trades go through between ${band.low.toFixed(digits)} and ${band.high.toFixed(digits)}, measured around ${reference.toFixed(digits)}.`;
  return `${where} ${rows.map((r) => `${r.label}: ${r.allowed ? "goes through" : "turned away"}.`).join(" ")}`;
}
