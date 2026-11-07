"use client";

// StatGrid (rich): a hairline-divided grid of named facts. Every cell is a
// label, a value and an optional one-line explanation, so nothing is a number
// without a meaning.
//
// On a listed company it is fed by GET /v1/market/:ticker:
// `liquidity.usdc` / `liquidity.shares`, `policy.referencePrice`,
// `policy.bandBps`, `policy.version`, `listingPrice`.
// On an ICO by GET /v1/auction/:ticker (issue / floor / cap, per-applicant cap).
//
// Different from SummaryCard (UI.md 2.12), which is a fixed 2x2 of portfolio
// totals with right-aligned money. This one takes any number of cells, every
// cell left-aligned, and carries a caption under the value.

import type { ReactNode } from "react";
import { cx } from "@/components/ui";

export type Stat = {
  label: string;
  value: ReactNode;
  /** One line under the value: the unit, the source, or what it means. */
  sub?: ReactNode;
};

export function StatGrid({
  stats,
  columns = 2,
  title,
  className,
}: {
  stats: Stat[];
  columns?: 2 | 3;
  title?: string;
  className?: string;
}) {
  // The hairlines are the 1px gaps showing the line-coloured ground through.
  // A short last row would show that ground as a block, so it is padded out.
  const fillers = (columns - (stats.length % columns)) % columns;
  return (
    <div className={className}>
      {title && <p className="t-label mb-2">{title}</p>}
      <div className={cx("grid gap-px overflow-hidden rounded-[10px] border border-line bg-line", columns === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {stats.map((s, i) => (
          <div key={i} className="bg-surface p-4">
            <p className="t-label">{s.label}</p>
            <p className="num t-list-title mt-1 text-text">{s.value}</p>
            {s.sub && <p className="t-caption mt-1">{s.sub}</p>}
          </div>
        ))}
        {Array.from({ length: fillers }, (_, i) => (
          <div key={`filler-${i}`} aria-hidden className="bg-surface" />
        ))}
      </div>
    </div>
  );
}
