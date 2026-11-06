"use client";

// MarketStatus (rich): is trading open right now, under which rule, since when,
// and what changes next. Fed by GET /v1/policy/:ticker (mode, halted, since,
// version, band, stale/staleAt, coolOffUntil, listingDayEndsAt).
//
// Not the same thing as RuleStrip / CircuitBanner: those are the full-bleed
// warning strip that renders nothing while trading is normal. This one always
// renders, states the rule in force, and carries "since" and "what changes next".

import { dateTimeIST, timeIST } from "@/lib/format";
import { cx } from "@/components/ui";

export type RuleMode = "listing" | "normal" | "surveillance" | "directional" | "halted";

const WORD: Record<RuleMode, string> = {
  listing: "Listing day",
  normal: "Open",
  surveillance: "Under watch",
  directional: "One-way",
  halted: "Halted",
};

/** Square and word colour. Neutral while trading is ordinary; warn for a tighter rule; loss for a stop. */
const TONE: Record<RuleMode, { square: string; word: string }> = {
  listing: { square: "bg-text", word: "text-text" },
  normal: { square: "bg-text", word: "text-text" },
  surveillance: { square: "bg-warn", word: "text-warn" },
  directional: { square: "bg-warn", word: "text-warn" },
  halted: { square: "bg-loss", word: "text-loss-text" },
};

export function MarketStatus({
  mode,
  /** `policy.since`: when this rule version was applied. ISO string. */
  since,
  /** `policy.version`. Printed as "Rule v2" so a change is visible. */
  version,
  /** `policy.band`: today's limits, printed as the second line. */
  band,
  /** `policy.bandBps` / `policy.referencePrice`: "±5% of 1.10". */
  bandBps,
  referencePrice,
  /** `policy.listingDayEndsAt` or `policy.coolOffUntil`: the next scheduled change. */
  nextChange,
  /** `policy.stale` / `staleAt`: a stale report reads as halted onchain. */
  stale,
  staleAt,
  digits = 3,
  className,
}: {
  mode: RuleMode;
  since?: string | null;
  version?: number | null;
  band?: { low: number; high: number } | null;
  bandBps?: number | null;
  referencePrice?: number | null;
  nextChange?: { label: string; at: string } | null;
  stale?: boolean;
  staleAt?: string | null;
  digits?: number;
  className?: string;
}) {
  const tone = TONE[mode];
  const limits = band ? `Trades go through between ${band.low.toFixed(digits)} and ${band.high.toFixed(digits)}` : null;
  const width =
    bandBps != null && referencePrice != null ? `±${(bandBps / 100).toFixed(bandBps % 100 === 0 ? 0 : 1)}% of ${referencePrice.toFixed(2)}` : null;

  return (
    <div className={cx("rounded-[10px] border border-line bg-surface p-4", className)}>
      <div className="flex items-start justify-between gap-4">
        <p className="t-list-title min-w-0 flex items-center gap-2">
          <span aria-hidden className={cx("size-2 shrink-0", tone.square)} />
          <span className={tone.word}>{WORD[mode]}</span>
          {since && <span className="t-label">since {timeIST(since)}</span>}
        </p>
        {version != null && <span className="num t-caption shrink-0">Rule v{version}</span>}
      </div>

      {mode === "halted" ? (
        <p className="t-body mt-2 text-text">Buying and selling are off until the exchange lifts it. Withdrawing liquidity still works.</p>
      ) : (
        limits && (
          <p className="num t-body mt-2 text-text">
            {limits}
            {width && <span className="t-label"> · {width}</span>}
          </p>
        )
      )}

      {(nextChange || stale) && (
        <div className="mt-3 border-t border-line pt-3">
          {nextChange && (
            <p className="t-caption">
              {nextChange.label} {dateTimeIST(nextChange.at)}
            </p>
          )}
          {stale && <p className="t-caption text-warn">No exchange report since {staleAt ? dateTimeIST(staleAt) : "the last one"}. Trading stops until the next one lands.</p>}
        </div>
      )}
    </div>
  );
}
