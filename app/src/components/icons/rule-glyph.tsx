// RuleGlyph: one mark per trading-rule state, so the five rules the exchange can
// put a share under are told apart by shape and not only by colour.
//
// Why this exists. The app has exactly one state symbol today: an 8px filled
// square (ui.tsx RuleStrip, rich/market-status.tsx, rich/exchange-notices.tsx).
// It collapses five rules into three colours, and two pairs of rules share a
// colour exactly — listing and normal are both `bg-text`, surveillance and
// directional are both `bg-warn`. So in the notices feed, a day that went under
// watch and a day that went one-way are the same picture, and UI.md's rule that
// colour is never the only carrier of meaning is broken in the one place where
// the meaning is the whole point.
//
// The grammar. Every glyph is the same drawing: two bars are the limits a price
// may trade between, and what sits between them says what may happen today.
//
//   normal    thin bars far apart, the price square loose between them
//   listing   the same band with a solid post on the day it opened
//   watch     heavy bars pressed onto the price: almost no room
//   oneway    one limit heavy (the capped direction), a triangle running to the
//             open one (the direction that still goes through)
//   halted    the two bars fused into one slab: nowhere to go
//
// Ink is the severity scale. Normal is the lightest mark in the set and halted
// the heaviest, so the strip reads before the word does.
//
// Two directions are drawn. DIRECTION picks the one the app ships; the other
// stays here, one word away (the same arrangement as avatar/art.tsx).
//
//   band   the limits drawn literally, as above. Needs 16px or more.
//   mark   the same five meanings inside a 16-unit square, so it can replace the
//          existing 8px status square in a list row without changing a layout.
//
// Colour: everything is currentColor. The caller sets the colour with a token
// class (`text-text`, `text-warn`, `text-loss-text`), which is also why every
// glyph has to survive being plain grey at 16px — that is its worst case.

import type { ReactNode } from "react";

export type RuleState = "listing" | "normal" | "watch" | "oneway" | "halted";

export type RuleGlyphDirection = "band" | "mark";

/** The direction the app ships. "mark" renders from the same file. */
export const DIRECTION: RuleGlyphDirection = "band";

/** Plain-English word for each state, matching circuit-banner.tsx copy. */
export const RULE_WORD: Record<RuleState, string> = {
  listing: "Listing day",
  normal: "Open",
  watch: "Under watch",
  oneway: "One-way day",
  halted: "Halted",
};

/**
 * The token class each state is normally drawn in. Neutral while trading is
 * ordinary, warn for a tighter rule, loss for a stop — the mapping already used
 * by RuleStrip and MarketStatus.
 */
export const RULE_TONE: Record<RuleState, string> = {
  listing: "text-text",
  normal: "text-text",
  watch: "text-warn",
  oneway: "text-warn",
  halted: "text-loss-text",
};

// --- direction 1: band -------------------------------------------------------
// A 24 grid. The field runs x 2..22 so a 40px glyph keeps 3px of air on each
// side and a 16px one still keeps 1.3px. Nothing is thinner than 2 units
// (1.33px at 16), so no part of any glyph can disappear into a hairline.

const BAND: Record<RuleState, ReactNode> = {
  // Thin limits, wide apart, a loose price square. The emptiest mark in the set.
  normal: (
    <>
      <rect x={2} y={3.5} width={20} height={2.5} />
      <rect x={10} y={10} width={4} height={4} />
      <rect x={2} y={18} width={20} height={2.5} />
    </>
  ),
  // The limits start at a solid post instead of running the full width: the day
  // the band opened. The bracket silhouette is what keeps it apart from normal
  // at 16px, where a difference in bar spacing alone would not survive.
  listing: (
    <>
      <rect x={2} y={5.5} width={3.5} height={13} />
      <rect x={5.5} y={5.5} width={16.5} height={2.5} />
      <rect x={13} y={10} width={4} height={4} />
      <rect x={5.5} y={16} width={16.5} height={2.5} />
    </>
  ),
  // Heavy limits pressed onto the price. Dense where normal is airy.
  watch: (
    <>
      <rect x={2} y={7} width={20} height={3.5} />
      <rect x={10} y={10.75} width={4} height={2.5} />
      <rect x={2} y={13.5} width={20} height={3.5} />
    </>
  ),
  // One limit heavy (moves away from the reference are capped tight), a triangle
  // running to the thin one (moves back toward it still go through).
  oneway: (
    <>
      <rect x={2} y={3.5} width={20} height={3.5} />
      <polygon points="8.5,10 15.5,10 12,18" />
      <rect x={2} y={19} width={20} height={2} />
    </>
  ),
  // The limits fused into one slab. No gap left to trade in.
  halted: <rect x={2} y={8.5} width={20} height={7} />,
};

// --- direction 2: mark -------------------------------------------------------
// The same five meanings inside one 16-unit square (x 4..20), so the glyph can
// stand where the 8px status square stands now. The square is the day: open,
// opening, slotted, one-way, shut.

const MARK: Record<RuleState, ReactNode> = {
  normal: <rect x={5.25} y={5.25} width={13.5} height={13.5} fill="none" stroke="currentColor" strokeWidth={2.5} />,
  listing: (
    <>
      <rect x={5.25} y={5.25} width={13.5} height={13.5} fill="none" stroke="currentColor" strokeWidth={2.5} />
      <rect x={4} y={12} width={16} height={8} />
    </>
  ),
  watch: (
    <>
      <rect x={5.25} y={5.25} width={13.5} height={13.5} fill="none" stroke="currentColor" strokeWidth={2.5} />
      <rect x={4} y={10.5} width={16} height={3} />
    </>
  ),
  oneway: (
    <>
      <rect x={5.25} y={5.25} width={13.5} height={13.5} fill="none" stroke="currentColor" strokeWidth={2.5} />
      <polygon points="8,8.5 16,8.5 12,17" />
    </>
  ),
  halted: <rect x={4} y={4} width={16} height={16} />,
};

const SHAPES: Record<RuleGlyphDirection, Record<RuleState, ReactNode>> = { band: BAND, mark: MARK };

export function RuleGlyph({
  state,
  size = 20,
  direction = DIRECTION,
  /** Accessible name. Without it the glyph is decoration next to its own word, so it is hidden. */
  title,
  className,
}: {
  state: RuleState;
  size?: number;
  direction?: RuleGlyphDirection;
  title?: string;
  className?: string;
}) {
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
      {SHAPES[direction][state]}
    </svg>
  );
}

/**
 * Glyph + word on one line, the pairing used in a strip, a chip or a notice row.
 * The word carries the meaning; the glyph is what makes two warn-coloured rules
 * tell apart at a glance.
 */
export function RuleLabel({
  state,
  size = 20,
  direction = DIRECTION,
  word,
  className,
}: {
  state: RuleState;
  size?: number;
  direction?: RuleGlyphDirection;
  word?: string;
  className?: string;
}) {
  return (
    <span className={className ? `inline-flex items-center gap-2 ${className}` : "inline-flex items-center gap-2"}>
      <RuleGlyph state={state} size={size} direction={direction} />
      {word ?? RULE_WORD[state]}
    </span>
  );
}
