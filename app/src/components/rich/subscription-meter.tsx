"use client";

// SubscriptionMeter (rich): how much of an IPO has been applied for, whether it
// has passed the raise it needs to list, and who has applied.
//
// Fed by GET /v1/auction/:ticker — `raised`, `targetRaise`, `requiredRaise`,
// `bidCount`, `applicants`, `perApplicantCap`, `graduated`, `blocksRemaining`
// (turn that into the `closes` caption with blocksToCountdown).

import type { ReactNode } from "react";
import { ProgressBar, cx } from "@/components/ui";
import { usdc } from "@/lib/format";

export function SubscriptionMeter({
  raised,
  targetRaise,
  requiredRaise,
  bidCount,
  applicants,
  perApplicantCap,
  /** `graduated`, once the auction has ended. null while it is still running. */
  graduated,
  /** Right-hand caption: "Closes in 42m" from `blocksRemaining`. */
  closes,
  title = "Applications",
  className,
}: {
  raised: number;
  targetRaise: number;
  requiredRaise: number;
  bidCount?: number | null;
  applicants?: number | null;
  perApplicantCap?: number | null;
  graduated?: boolean | null;
  closes?: ReactNode;
  title?: string;
  className?: string;
}) {
  const times = targetRaise > 0 ? raised / targetRaise : 0;
  const met = raised >= requiredRaise;
  const facts: { label: string; value: string }[] = [];
  if (bidCount != null) facts.push({ label: "Applications", value: bidCount.toLocaleString("en-IN") });
  if (applicants != null) facts.push({ label: "People", value: applicants.toLocaleString("en-IN") });
  if (perApplicantCap != null) facts.push({ label: "Cap per person", value: `${usdc(perApplicantCap)} USDC` });

  return (
    <div className={cx("rounded-[10px] border border-line bg-surface p-4", className)}>
      <div className="flex items-baseline justify-between gap-4">
        <p className="t-label">{title}</p>
        {closes && <p className="t-caption">{closes}</p>}
      </div>

      <p className="num mt-1">
        <span className="t-section-title text-text">{usdc(raised)}</span>
        <span className="t-label"> of {usdc(targetRaise)} USDC</span>
        <span className="t-label"> · {times.toFixed(2)}x</span>
      </p>

      <ProgressBar className="mt-3" value={raised} max={Math.max(targetRaise, raised)} marker={requiredRaise} />

      <p className="t-body mt-2 text-text-2">
        {graduated === false ? (
          <>
            Closed below <span className="num">{usdc(requiredRaise)}</span> USDC. Every application is refundable.
          </>
        ) : met ? (
          <>
            Past the <span className="num">{usdc(requiredRaise)}</span> USDC it needs to list (the tick on the bar).
          </>
        ) : (
          <>
            Lists only if it reaches <span className="num">{usdc(requiredRaise)}</span> USDC (the tick on the bar). Otherwise every application is refunded.
          </>
        )}
      </p>

      {facts.length > 0 && (
        <div className="mt-4 flex border-t border-line pt-3">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0 flex-1 pr-3">
              <p className="t-label truncate">{f.label}</p>
              <p className="num t-list-title mt-0.5 text-text">{f.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
