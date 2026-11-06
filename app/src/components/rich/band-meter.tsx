"use client";

// BandMeter (rich): where the price sits inside today's allowed limits, how much
// room is left before a trade stops going through, and how much of the band the
// day has actually used.
//
// Fed by GET /v1/market/:ticker — `price`, `band.low` / `band.high`,
// `policy.referencePrice`, `policy.bandBps` — plus the day's low and high from
// GET /v1/market/:ticker/swaps (`prices[]` inside the window).

import { cx } from "@/components/ui";

function pos(v: number, low: number, high: number) {
  const span = high - low;
  if (!(span > 0)) return 50;
  return Math.max(0, Math.min(100, ((v - low) / span) * 100));
}

export function BandMeter({
  price,
  band,
  /** `policy.referencePrice`: the price the band is measured around. */
  reference,
  /** `policy.bandBps`: half-width in bps, printed as "±5%". */
  bandBps,
  /** Low and high of the traded prices in the window (from /swaps `prices[]`). */
  dayLow,
  dayHigh,
  /** `policy.halted`: no band applies, nothing trades. */
  halted,
  title = "Today's limits",
  digits = 3,
  className,
}: {
  price: number;
  band: { low: number; high: number };
  reference?: number | null;
  bandBps?: number | null;
  dayLow?: number | null;
  dayHigh?: number | null;
  halted?: boolean;
  title?: string;
  digits?: number;
  className?: string;
}) {
  const { low, high } = band;
  const p = pos(price, low, high);
  const labelLeft = Math.max(8, Math.min(92, p));
  const day = dayLow != null && dayHigh != null && dayHigh >= dayLow ? { low: dayLow, high: dayHigh } : null;
  const dLow = day ? pos(Math.max(day.low, low), low, high) : 0;
  const dHigh = day ? pos(Math.min(day.high, high), low, high) : 0;
  const toHigh = high - price;
  const toLow = price - low;
  const nearer = toHigh <= toLow ? "upper" : "lower";
  const room = Math.max(0, Math.min(toHigh, toLow));
  const roomPct = price > 0 ? (room / price) * 100 : 0;
  const width = bandBps != null ? `±${(bandBps / 100).toFixed(bandBps % 100 === 0 ? 0 : 1)}%` : null;

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-4">
        <p className="t-label">{title}</p>
        <p className="num t-caption">
          {width}
          {width && reference != null ? " of " : ""}
          {reference != null ? reference.toFixed(2) : ""}
        </p>
      </div>

      {/* Price label sits above its marker, clamped so it never leaves the track. */}
      <div className="relative mt-3 h-5">
        <span
          className="num t-change-sm absolute whitespace-nowrap text-text"
          style={{ left: `${labelLeft}%`, transform: "translateX(-50%)" }}
        >
          {price.toFixed(digits)}
        </span>
      </div>

      <div
        role="img"
        aria-label={`Price ${price.toFixed(digits)} inside today's limits of ${low.toFixed(digits)} to ${high.toFixed(digits)}`}
        className={cx("relative h-[10px] border border-line bg-surface-2", halted && "opacity-60")}
      >
        {day && (
          <span aria-hidden className="absolute inset-y-0 bg-line-strong" style={{ left: `${dLow}%`, width: `${Math.max(1, dHigh - dLow)}%` }} />
        )}
        {reference != null && (
          <span aria-hidden className="absolute -top-1 -bottom-1 w-px bg-text-2" style={{ left: `${pos(reference, low, high)}%` }} />
        )}
        <span aria-hidden className="absolute -top-[5px] -bottom-[5px] w-[2px] bg-text" style={{ left: `${p}%`, transform: "translateX(-1px)" }} />
      </div>

      <div className="num t-caption mt-2 flex justify-between">
        <span>{low.toFixed(digits)}</span>
        <span>{high.toFixed(digits)}</span>
      </div>

      <p className="t-body mt-2 text-text-2">
        {halted ? (
          "Trading is halted, so no price goes through today."
        ) : (
          <>
            <span className="num">{room.toFixed(digits)}</span> of room ({roomPct.toFixed(2)}%) before the {nearer} limit.
            {day && (
              <>
                {" "}
                Traded <span className="num">{day.low.toFixed(digits)}</span> to <span className="num">{day.high.toFixed(digits)}</span> so far.
              </>
            )}
          </>
        )}
      </p>
    </div>
  );
}
