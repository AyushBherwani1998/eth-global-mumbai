// Static copy, NOT the app's data.
//
// Every business read now goes through `src/lib/api.ts` to the backend
// (services/api). What is left here is the handful of constants and shapes the
// parts that have not been migrated yet still import: the search sheet, the
// account sheet, the issuer console, and the sign-in demo session.
//
// The one listing below is the one listing that exists on chain (Acme), at the
// numbers it actually shows: cleared at 0.80, 60 USDC raised, 3 applicants,
// policy version 5. The seven invented companies that used to live here are
// gone, so nothing in the app can show a company the exchange does not have.
//
// The `Ipo` type is the API's own `Listing` type, so the app's types are honest
// about what can be null (`sector` and `city` always are).

import type { Listing, Offer as ApiOffer } from "@/types/listing-day-api";
import iposJson from "../../mock/ipos.json";
import walletJson from "../../mock/wallet.json";
import bidsJson from "../../mock/bids.json";
import marketJson from "../../mock/market.json";
import marketSeriesJson from "../../mock/market-series.json";
import auctionSeriesJson from "../../mock/auction-series.json";
import portfolioJson from "../../mock/portfolio.json";
import consoleJson from "../../mock/console.json";

export type EnsStatus = "draft" | "auction" | "listed" | "surveillance" | "halted";
/** Lifecycle, as the API reports it (`cleared` = graduated, pool not opened yet). */
export type Phase = "draft" | "live" | "cleared" | "refunding" | "listed";
export type Mode = "listing" | "normal" | "surveillance" | "directional" | "halted";

/** ENS records on <ticker>.<parent>. Any of them can be unset. */
export type Records = Listing["records"];

/** One company, exactly as `GET /v1/listings` returns it. */
export type Ipo = Listing;

export type Offer = ApiOffer;

export type PricePoint = { time: number; value: number; halted?: boolean };
export type RefPoint = { time: number; value: number; mode: Mode; bandBps: number };
export type Trade = { time: number; side: "buy" | "sell"; usdc: number; shares: number; price: number; tx: string };
export type ClearingPoint = { block: number; time: number; price: number; raised: number };

/**
 * The circuit policy as the banner and the trade sheet want it: every field
 * present. `src/lib/adapt.ts` builds one of these from the API's `PolicyView`,
 * and returns null when the chain has no band yet, so nothing is invented.
 */
export type Policy = {
  version: number;
  mode: Mode;
  referencePrice: number;
  bandBps: number;
  halted: boolean;
  since: string;
  asOf: string;
  coolOffMin: number;
  /** "" when no CRE report has landed yet; the receipt row is hidden then. */
  creTx: string;
};

/**
 * A swap the trading rule turned away. Reverted swaps emit no logs, so the
 * backend can never see one (`rejected` is always `[]`): the only ones the app
 * shows are the ones it watched happen in this session.
 */
export type Rejected = {
  time: string;
  side: "buy" | "sell";
  usdc: number;
  priceAfter: number;
  reason: string;
  detail: string;
  tx: string;
};

export type MarketEvent = { time: string; kind: Mode | "reference"; label: string };

export type Market = {
  usdcIsCurrency0: boolean;
  policy: Policy;
  liquidity: { usdc: number; shares: number };
  rejected: Rejected[];
  events: MarketEvent[];
  prices: PricePoint[];
  reference: RefPoint[];
  trades: Trade[];
};

export type BidState = "active" | "outbid" | "partial" | "filled" | "exited" | "claimed" | "refundable";
export type Bid = {
  /** The CCA's own bid id. Every auction counts from zero, so it is unique only together with `auction`. */
  id: number;
  ticker: string;
  /** The auction this bid was placed in (the ticker's `listingday.auction` record). */
  auction: string;
  budget: number;
  maxPrice: number;
  submittedBlock: number;
  submittedAt: string;
  state: BidState;
  filledShares: number;
  refund: number;
  tx: string;
};

export const PARENT = iposJson.parent;
export const CURRENT_BLOCK = iposJson.currentBlock;
export const NOW = iposJson.now;
export const OFFER: Offer = iposJson.offer;
export const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
export const FAUCET_URL = "https://faucet.circle.com/";

// The JSON is written to the Listing shape; TypeScript widens its string
// literals (`0x…` addresses, the status union), so this is a shape assertion.
export const IPOS = iposJson.ipos as unknown as Ipo[];
export const WALLET = walletJson;
export const BIDS: Bid[] = (bidsJson.bids as Omit<Bid, "auction">[]).map((b) => ({
  ...b,
  auction: IPOS.find((i) => i.ticker === b.ticker)?.records.auction ?? "",
}));
export const COMMITTED = bidsJson.committed as Record<string, number>;
export const PORTFOLIO = portfolioJson as {
  holdings: { ticker: string; shares: number; unclaimedShares: number; avgCost: number }[];
  lpPositions: { id: number; ticker: string; rangeLo: number; rangeHi: number; liquidityUsdc: number; liquidityShares: number; feesUsdc: number; owner: string }[];
};
export const CONSOLE = consoleJson;

export const TICKERS = IPOS.map((i) => i.ticker);
export const LISTED_TICKERS = Object.keys(marketSeriesJson);

/** Stable identity for a bid across auctions: auction address plus bid id. */
export function bidKey(b: Pick<Bid, "auction" | "id">) {
  return `${b.auction.toLowerCase()}:${b.id}`;
}

export function getIpo(ticker: string): Ipo | undefined {
  return IPOS.find((i) => i.ticker === ticker);
}

export function ensName(ticker: string) {
  return `${ticker}.${PARENT}`;
}

export function getMarket(ticker: string): Market | undefined {
  const base = (marketJson as Record<string, unknown>)[ticker] as Omit<Market, "prices" | "reference" | "trades"> | undefined;
  const series = (marketSeriesJson as Record<string, { prices: PricePoint[]; reference: RefPoint[]; trades: Trade[] }>)[ticker];
  if (!base || !series) return undefined;
  return { ...base, ...series } as Market;
}

export function getClearing(ticker: string): ClearingPoint[] {
  return (auctionSeriesJson as Record<string, ClearingPoint[]>)[ticker] ?? [];
}

export function lastPrice(ticker: string): number | null {
  const m = getMarket(ticker);
  if (m) return m.prices[m.prices.length - 1].value;
  return getIpo(ticker)?.clearingPrice ?? null;
}

/** Price at the start of the IST trading day (or listing), for a "1D" change. */
export function dayOpen(ticker: string): number | null {
  const m = getMarket(ticker);
  if (!m) return null;
  const cutoff = new Date(NOW).getTime() / 1000 - 24 * 3600;
  return (m.prices.find((p) => p.time >= cutoff) ?? m.prices[0]).value;
}

export function bidsFor(ticker: string) {
  return BIDS.filter((b) => b.ticker === ticker);
}

export function isMarketTicker(ticker: string) {
  return LISTED_TICKERS.includes(ticker);
}

/** One company page for every phase (UX.md section 2). */
export function hrefFor(ipo: Pick<Ipo, "ticker">) {
  return `/stock/${ipo.ticker}`;
}
