// Typed access to the JSON files in /mock. Every screen reads through here,
// so swapping mock data for chain reads later is a change in one place.

import iposJson from "../../mock/ipos.json";
import walletJson from "../../mock/wallet.json";
import bidsJson from "../../mock/bids.json";
import marketJson from "../../mock/market.json";
import marketSeriesJson from "../../mock/market-series.json";
import auctionSeriesJson from "../../mock/auction-series.json";
import portfolioJson from "../../mock/portfolio.json";
import consoleJson from "../../mock/console.json";

export type EnsStatus = "draft" | "auction" | "listed" | "surveillance" | "halted";
export type Phase = "draft" | "live" | "refunding" | "listed";
export type Mode = "listing" | "normal" | "surveillance" | "directional" | "halted";

export type Records = {
  addr: string;
  token: string | null;
  auction: string | null;
  hook: string | null;
  policy: string | null;
  pool: string | null;
};

export type Ipo = {
  ticker: string;
  symbol: string;
  name: string;
  sector: string;
  city: string;
  description: string;
  url: string;
  avatar: { initials: string; bg: string; fg: string };
  status: EnsStatus;
  phase: Phase;
  eligibility: "human" | "open";
  clearingPrice: number | null;
  graduated?: boolean;
  listedAt?: string;
  raised?: number;
  bidCount?: number;
  applicants?: number;
  startBlock?: number;
  endBlock?: number;
  claimBlock?: number;
  records: Records;
};

export type Offer = typeof iposJson.offer;

export type PricePoint = { time: number; value: number; halted?: boolean };
export type RefPoint = { time: number; value: number; mode: Mode; bandBps: number };
export type Trade = { time: number; side: "buy" | "sell"; usdc: number; shares: number; price: number; tx: string };
export type ClearingPoint = { block: number; time: number; price: number; raised: number };

export type Policy = {
  version: number;
  mode: Mode;
  referencePrice: number;
  bandBps: number;
  halted: boolean;
  since: string;
  asOf: string;
  coolOffMin: number;
  creTx: string;
};

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
  id: number;
  ticker: string;
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

export const IPOS = iposJson.ipos as Ipo[];
export const WALLET = walletJson;
export const BIDS = bidsJson.bids as Bid[];
export const COMMITTED = bidsJson.committed as Record<string, number>;
export const PORTFOLIO = portfolioJson;
export const CONSOLE = consoleJson;

export const TICKERS = IPOS.map((i) => i.ticker);
export const LISTED_TICKERS = Object.keys(marketSeriesJson);

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
