// Adapters from the API's shapes to the shapes the shared components still
// take, plus the null-handling rules for the whole app.
//
// Why this file exists: `services/api/src/types.ts` is honest about what can be
// missing on chain (no clearing price before the first bid, no band before
// listing, no refund figure before a bid is settled). Several shared components
// -- the trade sheet, the apply sheet, the circuit banner -- still want the
// older all-present shape. Rather than lie to them, we adapt, and anything that
// cannot be adapted returns null so the screen shows a real state instead.
//
// `sector` and `city` are always null (services/api/README.md: nothing on chain
// carries them). The app does NOT keep a side table of invented sectors: a
// company's own line is its symbol, its ENS name and its description from ENS.
// Nothing is printed where a sector used to be.

import type { Market, Policy, PricePoint, RefPoint, Trade as MockTrade } from "./mock";
import type { Eligibility, HaltCause, HaltSpan, Holding, Listing, MarketEvent, MarketView, PolicyView, Portfolio, Trade } from "./api";

// ---------------------------------------------------------------------------
// Null copy. One phrase per missing value, never "—", "null" or "NaN".
// ---------------------------------------------------------------------------

export const COPY = {
  noPrice: "No trades yet",
  noClearing: "No price yet",
  noRaise: "Not available from this node",
  noListed: "Not listed yet",
  noSchedule: "Not scheduled yet",
  noBand: "No price limits yet",
  noReport: "Not reported yet",
  noAddress: "Not published yet",
  noDescription: "This company hasn't published a description.",
  afterSettle: "Known once you settle",
} as const;

/** Format a number that may be missing, with a sentence instead of an empty cell. */
export function orCopy(n: number | null | undefined, fmt: (v: number) => string, fallback: string): string {
  return n === null || n === undefined || Number.isNaN(n) ? fallback : fmt(n);
}

/** Format a time that may be missing. */
export function orTime(t: string | null | undefined, fmt: (v: string) => string, fallback: string): string {
  return t ? fmt(t) : fallback;
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/** Chart points from the market read (one per swap, post-swap pool price, oldest first). */
export function pricePoints(market: MarketView | null): PricePoint[] {
  return market ? market.prices.map((p) => ({ time: p.time, value: p.value })) : [];
}

/**
 * Price points with the halt windows marked. A halted pool takes no swaps, so
 * a halt has no points of its own; this adds a flat pair at the last price at
 * each span's start and end (or `nowSec` while it runs), flagged `halted`, so
 * the chart can shade the window. Spans before the first trade start at the
 * first trade's price; with no trades there is nothing to draw.
 */
export function withHalts(points: PricePoint[], spans: HaltSpan[], nowSec: number): PricePoint[] {
  if (points.length === 0 || spans.length === 0) return points;
  const priceAt = (t: number) => {
    let v = points[0].value;
    for (const p of points) {
      if (p.time > t) break;
      v = p.value;
    }
    return v;
  };
  const extra: PricePoint[] = [];
  for (const s of spans) {
    const end = s.toTime ?? Math.max(nowSec, s.fromTime);
    const v = priceAt(s.fromTime);
    extra.push({ time: s.fromTime, value: v, halted: true }, { time: end, value: v, halted: true });
  }
  return [...points, ...extra].sort((a, b) => a.time - b.time || Number(!!a.halted) - Number(!!b.halted));
}

/** The number to show as "the price": the pool price, else the last trade, else the listing price. */
export function lastPriceOf(market: MarketView | null): number | null {
  if (market?.price != null) return market.price;
  const pts = pricePoints(market);
  if (pts.length) return pts[pts.length - 1].value;
  return market?.listingPrice ?? null;
}

/** Price at the start of the last 24 hours, for a "today" change. Null when there is no history. */
export function dayOpenOf(points: PricePoint[], nowSec: number): number | null {
  if (points.length === 0) return null;
  const cutoff = nowSec - 24 * 3600;
  return (points.find((p) => p.time >= cutoff) ?? points[0]).value;
}

/**
 * "Now", as the server reported it. Pure: never reads the machine clock, so it
 * is safe to call while rendering. Falls back to 0, which makes a 24h cutoff
 * fall before every point, so "today" becomes "the whole series".
 */
export function nowSeconds(iso?: string | null): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t / 1000 : 0;
}

/** The clock the chart should slice against: the last point the pool produced. */
export function seriesNow(points: PricePoint[], fallbackIso?: string | null): number {
  return points.length ? points[points.length - 1].time : nowSeconds(fallbackIso);
}

// ---------------------------------------------------------------------------
// Policy and market
// ---------------------------------------------------------------------------

/**
 * The legacy `Policy` the circuit banner and the trade sheet take.
 * Null when there is no reference price yet: before listing there is no band,
 * and inventing one would be a lie. `creTx` is empty when no CRE report has
 * landed; the banner hides that row.
 */
export function toPolicy(p: PolicyView | null | undefined): Policy | null {
  if (!p || p.referencePrice === null) return null;
  const since = p.since ?? p.asOf;
  if (!since) return null;
  return {
    version: p.version,
    mode: p.mode,
    referencePrice: p.referencePrice,
    bandBps: p.bandBps,
    halted: p.halted,
    since,
    asOf: p.asOf ?? since,
    coolOffMin: p.coolOffMin,
    creTx: p.creTx ?? "",
  };
}

/** `price` is each trade's own average fill price (`avgPrice`), not the pool price after it. */
export function toTrades(market: MarketView | null): MockTrade[] {
  if (!market) return [];
  return market.trades.map((t: Trade) => ({
    time: t.time,
    side: t.side,
    usdc: t.usdc,
    shares: t.shares,
    price: t.avgPrice,
    tx: t.tx,
  }));
}

/**
 * The reference and band as they changed: one step per policy span from the
 * server's replay of `Listed` / `PolicyApplied` logs, so the chart's limit
 * lines follow the band that was actually in force at each time.
 */
export function toReference(market: MarketView | null): RefPoint[] {
  if (!market) return [];
  return market.reference.map((r) => ({ time: r.time, value: r.value, mode: r.mode, bandBps: r.bandBps }));
}

/**
 * The legacy `Market` the chart and banner take. Null when the pool has no
 * price or no band yet: there is nothing to draw against, so the screen shows
 * that instead.
 */
export function toMarket(market: MarketView | null): Market | null {
  if (!market) return null;
  const policy = toPolicy(market.policy);
  const prices = pricePoints(market);
  if (!policy || prices.length === 0) return null;
  const head = market.reference.at(-1)?.time ?? prices[prices.length - 1].time;
  return {
    usdcIsCurrency0: market.usdcIsCurrency0,
    policy,
    liquidity: market.liquidity,
    // Reverted swaps emit no logs, so the proxy never sees them (README).
    rejected: [],
    events: market.events.map((e) => ({ time: e.time, kind: e.kind, label: e.label })),
    prices: withHalts(prices, market.haltSpans, head),
    reference: toReference(market),
    trades: toTrades(market),
  };
}

// ---------------------------------------------------------------------------
// Can this trade right now?
// ---------------------------------------------------------------------------

export type TradeGate =
  | { open: true }
  | { open: false; cause: HaltCause | "notListed" | "unknown"; title: string; body: string; until: string | null };

/**
 * Whether the pool takes a swap now, from the server's `tradingOpen` /
 * `haltCause` (the hook's own order of checks). A cool-off blocks swaps
 * without `halted` being set, so `halted` alone is not enough.
 */
export function tradeGate(market: MarketView | null): TradeGate {
  if (!market) return { open: false, cause: "unknown", title: "Checking the market", body: "Loading the latest trading rules.", until: null };
  if (!market.listed) return { open: false, cause: "notListed", title: "Not trading yet", body: "This company has not listed, so its shares cannot be bought or sold yet.", until: null };
  if (market.tradingOpen) return { open: true };
  const p = market.policy;
  switch (market.haltCause) {
    case "coolingOff":
      return {
        open: false,
        cause: "coolingOff",
        title: "Cooling off after a halt",
        body: "Trading has just come back from a halt, so buying and selling stay paused for a few minutes.",
        until: p.coolOffUntil,
      };
    case "stale":
      return {
        open: false,
        cause: "stale",
        title: "Trading paused",
        body: "The exchange's price limits are out of date, so trading is paused until the next update lands.",
        until: null,
      };
    case "report":
      return { open: false, cause: "report", title: "Trading halted", body: "The exchange halted trading in this company. You can't buy or sell until it resumes.", until: null };
    default:
      return { open: false, cause: "unknown", title: "Trading paused", body: "The pool is not taking trades right now.", until: null };
  }
}

// ---------------------------------------------------------------------------
// Your money
// ---------------------------------------------------------------------------

/** Shares this wallet holds in `ticker` (ERC20 balance), whether or not it ever bid. */
export function sharesHeld(portfolio: Portfolio | null, ticker: string): number {
  return portfolio?.holdings.find((h) => h.ticker === ticker)?.shares ?? 0;
}

/** Holdings worth a row: shares in the wallet, shares to collect, or bids still open. */
export function holdingRows(portfolio: Portfolio | null): Holding[] {
  return (portfolio?.holdings ?? []).filter((h) => h.shares > 0 || h.unclaimedShares > 0 || h.pendingBids > 0);
}

export type BidRoom =
  | { known: false }
  | { known: true; cap: number; committed: number; remaining: number; atCap: boolean };

/** The per-wallet budget cap from /v1/eligibility. Unknown when the module does not report one. */
export function bidRoom(e: Eligibility | null): BidRoom {
  if (!e || e.cap === null || e.remaining === null) return { known: false };
  const remaining = Math.max(0, e.remaining);
  return { known: true, cap: e.cap, committed: e.committed ?? e.cap - remaining, remaining, atCap: remaining <= 0 };
}

/**
 * Plain English for one entry in a company's rule history. The server's own
 * label carries the policy version and the protocol word ("v3 Surveillance ±5%
 * · ref 0.90"); those belong in a Details disclosure, not on a notice board,
 * so the headline comes from the event kind and the server's wording is
 * offered separately with the version stripped.
 */
export function eventWords(kind: MarketEvent["kind"]): string {
  switch (kind) {
    case "halted":
      return "Trading halted";
    case "listing":
      return "Listing-day limits set";
    case "surveillance":
      return "Put under watch";
    case "directional":
      return "One-way day";
    case "reference":
      return "Reference price updated";
    default:
      return "Normal trading limits";
  }
}

/**
 * The server's own label, made readable: the policy version prefix dropped and
 * the protocol words swapped for the ones the rest of the app uses.
 */
export function eventDetail(label: string): string {
  return label
    .replace(/^v\d+\s*/, "")
    .replace(/Surveillance/i, "Under watch")
    .replace(/Directional/i, "One-way")
    .replace(/\bref\b/i, "around");
}

/** "Halted" / "Watch" before the price in a list row. */
export function flagFor(market: MarketView | null): { text: string; tone: "warn" | "loss" } | undefined {
  if (!market) return undefined;
  const halted = market.mode === "halted" || market.policy.halted;
  if (halted) return { text: "Halted", tone: "loss" };
  if (market.mode === "surveillance" || market.mode === "directional") return { text: "Watch", tone: "warn" };
  return undefined;
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

/** An ICO is taking applications. */
export const isOpen = (l: Listing) => l.phase === "live";
/** An ICO has not opened yet. */
export const isUpcoming = (l: Listing) => l.phase === "draft";
/** An ICO is over: it listed, it is waiting to list, or it is refunding. */
export const isClosed = (l: Listing) => l.phase === "listed" || l.phase === "cleared" || l.phase === "refunding";
/** The company trades on the market. */
export const isListed = (l: Listing) => l.phase === "listed";

/** The grey line under a company name. Never a sector: nothing on chain carries one. */
export function companySub(l: Listing): string {
  return l.ensName || l.symbol;
}

export function hrefFor(l: { ticker: string }): string {
  return `/stock/${l.ticker}`;
}
