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
import type { Listing, MarketEvent, MarketView, PolicyView, SwapsResponse, Trade } from "./api";

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

/** Chart points from the swaps endpoint (oldest first already). */
export function pricePoints(swaps: SwapsResponse | null): PricePoint[] {
  return swaps ? swaps.prices.map((p) => ({ time: p.time, value: p.value })) : [];
}

/** The number to show as "the price": the pool price, else the last trade, else the listing price. */
export function lastPriceOf(market: MarketView | null, swaps: SwapsResponse | null): number | null {
  if (market?.price != null) return market.price;
  const pts = pricePoints(swaps);
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

export function toTrades(swaps: SwapsResponse | null): MockTrade[] {
  if (!swaps) return [];
  return swaps.trades.map((t: Trade) => ({
    time: t.time,
    side: t.side,
    usdc: t.usdc,
    shares: t.shares,
    price: t.price,
    tx: t.tx,
  }));
}

/**
 * One flat reference point: today's band. The proxy does not serve a band
 * history (it would have to replay every policy report), so the chart gets the
 * band in force now rather than a made-up past one.
 */
export function toReference(policy: Policy | null, firstTime: number): RefPoint[] {
  if (!policy) return [];
  return [{ time: firstTime, value: policy.referencePrice, mode: policy.mode, bandBps: policy.bandBps }];
}

/**
 * The legacy `Market` the trade sheet takes. Null when the pool has no price or
 * no band yet: there is nothing to quote against, so the screen shows that
 * instead of a form.
 */
export function toMarket(market: MarketView | null, swaps: SwapsResponse | null): Market | null {
  if (!market) return null;
  const policy = toPolicy(market.policy);
  const prices = pricePoints(swaps);
  if (!policy || prices.length === 0) return null;
  return {
    usdcIsCurrency0: market.usdcIsCurrency0,
    policy,
    liquidity: market.liquidity,
    // Reverted swaps emit no logs, so the proxy never sees them (README).
    // The only rejects the app can show are the ones it watched happen.
    rejected: [],
    events: market.events.map((e) => ({ time: e.time, kind: e.kind, label: e.label })),
    prices,
    reference: toReference(policy, prices[0].time),
    trades: toTrades(swaps),
  };
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

/** An IPO is taking applications. */
export const isOpen = (l: Listing) => l.phase === "live";
/** An IPO has not opened yet. */
export const isUpcoming = (l: Listing) => l.phase === "draft";
/** An IPO is over: it listed, it is waiting to list, or it is refunding. */
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
