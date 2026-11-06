"use client";

// LifecycleRail (rich): where a listing has got to, from draft through the
// auction to listed, with the date or block each stage happened on.
//
// Fed by GET /v1/listings/:ticker `phase` (draft | live | cleared | refunding |
// listed) plus GET /v1/auction/:ticker for the stage captions: `startBlock`,
// `endBlock`, `claimBlock`, `blocksRemaining`, `graduated`, and `listedAt` from
// the listing.
//
// Not the approval Stepper (UI.md 2.17): that one counts three wallet prompts
// inside a sheet. This is the listing's own history, it carries a caption per
// stage, and it can end in a failed stage ("Not listed").

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cx } from "@/components/ui";

export type LifecycleStage = {
  id: string;
  label: string;
  /** Date, block or countdown under the label. */
  sub?: ReactNode;
  state: "done" | "current" | "upcoming";
  /** "loss" marks a terminal failure stage (Not listed, Halted). */
  tone?: "loss";
};

export function LifecycleRail({ stages, title, className }: { stages: LifecycleStage[]; title?: string; className?: string }) {
  return (
    <div className={className}>
      {title && <p className="t-label mb-3">{title}</p>}
      <ol className="flex items-start" aria-label={title ?? "Listing progress"}>
        {stages.map((s, i) => {
          const done = s.state === "done";
          const now = s.state === "current";
          const loss = s.tone === "loss";
          return (
            <li key={s.id} className="flex min-w-0 flex-1 flex-col items-start">
              <span className="flex w-full items-center">
                <span
                  className={cx(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-[13px] leading-none font-medium",
                    loss && (done || now)
                      ? "border-[1.5px] border-loss text-loss-text"
                      : done
                        ? "bg-text text-bg"
                        : now
                          ? "border-[1.5px] border-text text-text"
                          : "border border-line text-text-2",
                  )}
                  aria-hidden
                >
                  {done && !loss ? <Check className="size-3.5" /> : i + 1}
                </span>
                {i < stages.length - 1 && <span className={cx("mx-2 h-px flex-1", done ? "bg-text" : "bg-line")} />}
              </span>
              <span className={cx("t-nav-label mt-2 pr-3", loss && (done || now) ? "text-loss-text" : now || done ? "text-text" : "text-text-2")}>
                {s.label}
                <span className="sr-only">{done ? " (done)" : now ? " (now)" : " (not yet)"}</span>
              </span>
              {s.sub && <span className="t-caption mt-0.5 pr-3">{s.sub}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
