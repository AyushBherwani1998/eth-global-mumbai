"use client";

// ExchangeNotices (rich): every notice the exchange has published for this
// company, newest first, with the receipt for each one.
//
// Fed by GET /v1/market/:ticker `events[]` — `{ time, kind, label, tx, block }`.
// `label` is already written by the backend ("Listed at 1.10 · ±5% band",
// "v2 Normal ±20% · ref listing price"), so it is printed as it comes; the
// square carries `kind` and the link carries `tx`.

import { useState } from "react";
import { dateTimeIST, txUrl as defaultTxUrl } from "@/lib/format";
import { cx } from "@/components/ui";

export type NoticeKind = "listing" | "normal" | "surveillance" | "directional" | "halted" | "reference";

const SQUARE: Record<NoticeKind, string> = {
  listing: "bg-text",
  normal: "bg-text",
  reference: "bg-text-2",
  surveillance: "bg-warn",
  directional: "bg-warn",
  halted: "bg-loss",
};

export type Notice = {
  /** ISO string from the event log. */
  time: string;
  kind: NoticeKind;
  label: string;
  /** The CRE report transaction. Renders a "Receipt" link when present. */
  tx?: string | null;
  block?: number | null;
};

export function ExchangeNotices({
  notices,
  title = "Exchange notices",
  /** Show this many, with a labelled button for the rest. */
  limit = 4,
  txUrl = defaultTxUrl,
  emptyText = "No notices yet. The exchange publishes one whenever the trading rule changes.",
  className,
}: {
  notices: Notice[];
  title?: string;
  limit?: number;
  txUrl?: (tx: string) => string;
  emptyText?: string;
  className?: string;
}) {
  const [all, setAll] = useState(false);
  // The API returns them oldest first; the newest notice is the one in force.
  const ordered = [...notices].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  const shown = all ? ordered : ordered.slice(0, limit);
  const hidden = ordered.length - shown.length;

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="t-section-title">{title}</h2>
        {ordered.length > 0 && <span className="num t-caption">{ordered.length}</span>}
      </div>

      {ordered.length === 0 ? (
        <p className="t-body mt-2 text-text-2">{emptyText}</p>
      ) : (
        <ol className="mt-2">
          {shown.map((n, i) => (
            <li key={`${n.time}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
              {/* Rail: a hairline through the squares, stopping at the last one. */}
              <span aria-hidden className="relative flex w-2 shrink-0 justify-center pt-[8px]">
                <span className={cx("z-10 size-2 shrink-0", SQUARE[n.kind])} />
                {i < shown.length - 1 && <span className="absolute top-[18px] bottom-[-8px] w-px bg-line" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="t-body block text-text">{n.label}</span>
                <span className="flex flex-wrap items-center gap-x-3">
                  <span className="t-caption">{dateTimeIST(n.time)}</span>
                  {n.block != null && <span className="num t-caption">Block {n.block.toLocaleString("en-US")}</span>}
                  {n.tx && (
                    <a href={txUrl(n.tx)} target="_blank" rel="noreferrer" className="prose-link t-caption text-gain-text">
                      Receipt
                    </a>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}

      {hidden > 0 && (
        <button type="button" onClick={() => setAll(true)} className="t-change-sm flex h-12 items-center text-gain-text">
          Show {hidden} earlier {hidden === 1 ? "notice" : "notices"}
        </button>
      )}
    </div>
  );
}
