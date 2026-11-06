// StageMark: how far a listing has got, as one small square.
//
// Why not a picture per stage. The obvious set — an envelope for applications, a
// gavel for the final price, a chart for trading — fails the bar: in
// rich/lifecycle-rail.tsx every stage already has its own word printed directly
// under it, so each drawing would say what the label says and nothing more.
//
// What is actually missing is the compact form. The rail needs 280px and four
// labels; a row in Orders, a company card or a notice has room for 16px. This
// mark carries the one fact a glance needs — which of the four stages this
// listing has reached — with no pictorial content at all: four cells, filled as
// the listing advances. Draft is one cell, trading is all four.
//
// Two directions are drawn, as in rule-glyph.tsx and avatar/art.tsx.
//   quad  a 2x2 block. Reads as a square at any size and sits in an icon slot.
//   bar   four upright segments. More obviously a progression, less obviously
//         an icon; better beside a word than inside a tile.
//
// Colour is currentColor. A failed listing is drawn by the caller in
// `text-loss-text` with `failed`, which greys the cells and strikes the mark.

import type { ReactNode } from "react";

/** The four stages a listing moves through, in order. */
export const STAGES = ["Draft", "Applications", "Final price", "Trading"] as const;
export type StageName = (typeof STAGES)[number];

export type StageMarkDirection = "quad" | "bar";

/** The direction the app ships. "bar" renders from the same file. */
export const DIRECTION: StageMarkDirection = "quad";

/** Unreached cells are the same ink, held back far enough to read as "not yet". */
const DIM = 0.28;

// 2x2 on a 24 grid: cells of 9.5 with a 2 gap, 1.5 of air at the frame.
const QUAD = [
  { x: 1.5, y: 1.5 },
  { x: 13, y: 1.5 },
  { x: 1.5, y: 13 },
  { x: 13, y: 13 },
];

// Four upright segments, 3.5 wide, with the same 2 gap.
const BARS = [2, 7.5, 13, 18.5];

function cells(stage: number, direction: StageMarkDirection): ReactNode {
  if (direction === "bar") {
    return BARS.map((x, i) => <rect key={i} x={x} y={5} width={3.5} height={14} opacity={i < stage ? 1 : DIM} />);
  }
  return QUAD.map((c, i) => <rect key={i} x={c.x} y={c.y} width={9.5} height={9.5} opacity={i < stage ? 1 : DIM} />);
}

export function StageMark({
  /** How many of the four stages are reached, 1..4. `Draft` is 1, `Trading` is 4. */
  stage,
  /** The listing ended without listing: the cells stay held back and the mark is struck. */
  failed = false,
  size = 20,
  direction = DIRECTION,
  /** Accessible name. Without it the mark is hidden, as it is beside its own label. */
  title,
  className,
}: {
  stage: number;
  failed?: boolean;
  size?: number;
  direction?: StageMarkDirection;
  title?: string;
  className?: string;
}) {
  const n = failed ? 0 : Math.max(0, Math.min(4, Math.round(stage)));
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className}
      style={{ display: "block", flexShrink: 0 }}
    >
      {cells(n, direction)}
      {failed && <path d="M3 21 L21 3" stroke="currentColor" strokeWidth={2.5} fill="none" />}
    </svg>
  );
}

/** The stage number for a `GET /v1/listings/:ticker` phase. */
export function stageOf(phase: "draft" | "live" | "cleared" | "refunding" | "listed"): number {
  switch (phase) {
    case "draft":
      return 1;
    case "live":
      return 2;
    case "cleared":
    case "refunding":
      return 3;
    case "listed":
      return 4;
  }
}
