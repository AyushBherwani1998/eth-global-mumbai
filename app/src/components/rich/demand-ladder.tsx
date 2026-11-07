"use client";

// DemandLadder (rich): how much money is waiting at each top price in an ICO,
// and which of it clears. Every application names the most it will pay, so the
// ladder says whether the price is being held up by a few high bids or a wall
// of them, and how far the next applicant is from being refunded.
//
// Fed by GET /v1/bids?ticker= — group `bids[]` by `maxPrice`, summing `budget`
// and counting rows. The clearing line comes from GET /v1/auction/:ticker
// `clearingPrice`.

import { usdc } from "@/lib/format";
import { cx } from "@/components/ui";

export type DemandRow = {
  /** The most this group of applications will pay (USDC per lot). */
  price: number;
  /** Sum of their budgets, USDC. */
  usdc: number;
  /** How many applications sit at that price. */
  bids?: number;
};

export function DemandLadder({
  rows,
  clearingPrice,
  title = "Where the applications sit",
  caption = "Each application names the most it will pay. Anything under the final price is refunded.",
  digits = 2,
  className,
}: {
  rows: DemandRow[];
  clearingPrice?: number | null;
  title?: string;
  caption?: string;
  digits?: number;
  className?: string;
}) {
  const ordered = [...rows].sort((a, b) => b.price - a.price);
  const max = ordered.reduce((m, r) => Math.max(m, r.usdc), 0);
  const total = ordered.reduce((t, r) => t + r.usdc, 0);
  const count = ordered.reduce((t, r) => t + (r.bids ?? 0), 0);
  // The divider goes above the first row that would be refunded.
  const cutIndex = clearingPrice == null ? -1 : ordered.findIndex((r) => r.price < clearingPrice);

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="t-section-title">{title}</h2>
        <span className="num t-caption">
          {usdc(total)} USDC{count > 0 ? ` · ${count}` : ""}
        </span>
      </div>
      <p className="t-body mt-1 text-text-2">{caption}</p>

      <ul className="mt-3">
        {ordered.map((r, i) => {
          // Bars are scaled against the biggest row and stop short of the
          // right column, so the money figure never sits on top of one.
          const pct = max > 0 ? (r.usdc / max) * 62 : 0;
          const below = clearingPrice != null && r.price < clearingPrice;
          return (
            <li key={`${r.price}-${i}`}>
              {i === cutIndex && clearingPrice != null && (
                <p className="dotted-line num t-caption flex items-baseline justify-between gap-3 pt-2 pb-2">
                  <span className="text-text">Final price {clearingPrice.toFixed(digits)}</span>
                  <span>under this, money comes back</span>
                </p>
              )}
              <div className="relative flex min-h-14 items-center justify-between gap-3 border-b border-line px-2 py-2">
                <span aria-hidden className={cx("absolute inset-y-[8px] left-0 bg-line", below && "opacity-50")} style={{ width: `${Math.max(2, pct)}%` }} />
                <span className="num t-list-title relative text-text">{r.price.toFixed(digits)}</span>
                <span className="relative text-right">
                  <span className="num t-change-sm block text-text">{usdc(r.usdc)} USDC</span>
                  {r.bids != null && (
                    <span className="num t-caption block">
                      {r.bids} {r.bids === 1 ? "application" : "applications"}
                    </span>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
