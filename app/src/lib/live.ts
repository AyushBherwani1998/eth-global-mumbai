"use client";

// Live reads: one small polling hook over lib/api.ts, plus the screen-level
// hooks every screen uses. There is no server push, so freshness is a timer.
//
// Rules the hook keeps:
// - the first load shows a skeleton; later loads never blank the screen;
// - an answer this session already has comes back immediately, even in a body
//   that has just mounted, so swapping a tab never re-flashes a skeleton for
//   data the app is holding (see CACHE below);
// - a failed poll keeps the last good data on screen and raises the error, so
//   a blip does not throw away a working page;
// - polling stops while the tab is hidden and catches up when it comes back;
// - `retry()` re-runs immediately (that is the Retry button).

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure, POLL, api, asApiFailure, type BidsResponse, type EnsView, type ListingsResponse, type MarketView, type Portfolio } from "./api";

export type Live<T> = {
  data: T | null;
  error: ApiFailure | null;
  /** First load, nothing on screen yet. */
  loading: boolean;
  /** A retry is in flight while data is already on screen. */
  refreshing: boolean;
  retry: () => void;
  /** ms, for "as of" copy. */
  updatedAt: number | null;
};

const refreshers = new Set<() => void>();

/** Re-read everything on screen now, e.g. once a transaction's receipt is in. */
export function refreshLive() {
  refreshers.forEach((r) => r());
}

/** What the last completed read returned, and which request it answered. */
type Entry<T> = { key: string | null; data: T | null; error: ApiFailure | null; updatedAt: number | null };

// ---------------------------------------------------------------------------
// The answers this session already has
// ---------------------------------------------------------------------------

// A screen's state dies with the screen, but the answer to "what are the
// listings" does not. Switching a tab unmounts one body and mounts another, so
// without this every hook in the incoming body starts from nothing and the
// screen flashes skeletons for data the app is already holding -- the worst of
// it on the way *back*, where every byte is known.
//
// Keyed by the same request key the hook polls on, so an entry can only ever
// answer the question it was asked. A new mount shows the last answer at once
// and the poll it starts refreshes it in place, the same as any other tick.
const CACHE = new Map<string, Entry<unknown>>();

// Enough for the tickers one session touches; the oldest question goes first.
const CACHE_MAX = 64;

function remember<T>(entry: Entry<T>) {
  if (entry.key === null) return;
  CACHE.delete(entry.key);
  CACHE.set(entry.key, entry as Entry<unknown>);
  if (CACHE.size > CACHE_MAX) {
    const oldest = CACHE.keys().next();
    if (!oldest.done) CACHE.delete(oldest.value);
  }
}

function recall<T>(key: string | null): Entry<T> | undefined {
  return key === null ? undefined : (CACHE.get(key) as Entry<T> | undefined);
}

/**
 * Poll one resource. `key` identifies the request (pass null to stand down,
 * e.g. while signed out); `load` is read from a ref so an inline arrow
 * function does not restart the timer on every render.
 *
 * State is only ever written from a settled promise or a timer, never from the
 * body of an effect, so a poll never cascades a render.
 */
export function useLive<T>(key: string | null, load: () => Promise<T>, intervalMs: number): Live<T> {
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const [entry, setEntry] = useState<Entry<T>>(() => recall<T>(key) ?? { key: null, data: null, error: null, updatedAt: null });
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (key === null) return;
    let alive = true;

    const run = async () => {
      try {
        const data = await loadRef.current();
        if (!alive) return;
        const next = { key, data, error: null, updatedAt: Date.now() };
        remember(next);
        setEntry(next);
        setRetrying(false);
      } catch (e) {
        if (!alive) return;
        const error = asApiFailure(e);
        // A failed poll keeps whatever is already on screen for this key.
        setEntry((prev) => {
          const kept = prev.key === key ? prev : (recall<T>(key) ?? { key, data: null, error: null, updatedAt: null });
          const next = { ...kept, key, error };
          remember(next);
          return next;
        });
        setRetrying(false);
      }
    };

    void run();
    const id = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) void run();
    }, intervalMs);
    const onVisible = () => {
      if (!document.hidden) void run();
    };
    const onRefresh = () => void run();
    document.addEventListener("visibilitychange", onVisible);
    refreshers.add(onRefresh);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      refreshers.delete(onRefresh);
    };
  }, [key, intervalMs, attempt]);

  const retry = useCallback(() => {
    setRetrying(true);
    setAttempt((a) => a + 1);
  }, []);

  // The key can change under a mounted hook too (a different ticker, a
  // different segment). That is the same situation as a fresh mount, so it
  // reads the same answer rather than falling back to a skeleton.
  const shown = entry.key === key ? entry : (recall<T>(key) ?? entry);
  const answered = key !== null && shown.key === key;
  return {
    data: answered ? shown.data : null,
    error: answered ? shown.error : null,
    loading: key !== null && !answered,
    refreshing: retrying,
    retry,
    updatedAt: answered ? shown.updatedAt : null,
  };
}

/** Two resources, one error and one Retry: the shape every screen wants. */
export function merge2<A, B>(a: Live<A>, b: Live<B>): { error: ApiFailure | null; loading: boolean; refreshing: boolean; retry: () => void } {
  return {
    error: a.error ?? b.error,
    loading: a.loading || b.loading,
    refreshing: a.refreshing || b.refreshing,
    retry: () => {
      a.retry();
      b.retry();
    },
  };
}

export function merge3<A, B, C>(a: Live<A>, b: Live<B>, c: Live<C>) {
  return {
    error: a.error ?? b.error ?? c.error,
    loading: a.loading || b.loading || c.loading,
    refreshing: a.refreshing || b.refreshing || c.refreshing,
    retry: () => {
      a.retry();
      b.retry();
      c.retry();
    },
  };
}

// ---------------------------------------------------------------------------
// Screen-level reads
// ---------------------------------------------------------------------------

/** Every listing the exchange knows about. The only source of truth for what exists. */
export function useListings(): Live<ListingsResponse> {
  return useLive("listings", () => api.listings(), POLL.listings);
}

/** One listing with its offer parameters (supply, price range, caps, raise targets). */
export function useListing(ticker: string | null) {
  return useLive(ticker ? `listing:${ticker}` : null, () => api.listing(ticker as string), POLL.listings);
}

/** How many recent trades every market read asks for: enough for a day of chart and the trades tab. */
export const TRADES_LIMIT = 400;

/** Pool price, policy, recent trades and price points, reference/band steps and halt spans: one call. */
export function useMarket(ticker: string | null) {
  return useLive(ticker ? `market:${ticker}:${TRADES_LIMIT}` : null, () => api.market(ticker as string, { limit: TRADES_LIMIT }), POLL.market);
}

export function useAuction(ticker: string | null) {
  return useLive(ticker ? `auction:${ticker}` : null, () => api.auction(ticker as string), POLL.auction);
}

export function useClearing(ticker: string | null) {
  return useLive(ticker ? `clearing:${ticker}` : null, () => api.clearing(ticker as string), POLL.clearing);
}

/** This wallet's applications. Null owner (signed out) stands the poll down. */
export function useBids(owner: string | null, ticker?: string): Live<BidsResponse> {
  return useLive(owner ? `bids:${owner}:${ticker ?? "all"}` : null, () => api.bids({ owner: owner as string, ticker }), POLL.bids);
}

/** Every application in one listing, from every wallet (the issuer console). */
export function useTickerBids(ticker: string | null): Live<BidsResponse> {
  return useLive(ticker ? `bids:*:${ticker}` : null, () => api.bids({ ticker: ticker as string }), POLL.bids);
}

/** The listing's ENS name as resolved, and whether its records match the deployment. */
export function useEns(ticker: string | null): Live<EnsView> {
  return useLive(ticker ? `ens:${ticker}` : null, () => api.ens(ticker as string), POLL.issuer);
}

export function useEligibility(ticker: string | null, address: string | null) {
  return useLive(
    ticker && address ? `eligibility:${ticker}:${address}` : null,
    () => api.eligibility(ticker as string, address as string),
    POLL.eligibility,
  );
}

export type Quote = { ticker: string; market: MarketView };

/**
 * Price, band and trade history for a set of listed companies, in one resource
 * so the Markets list has a single loading and error state.
 */
export function useQuotes(tickers: string[]): Live<Quote[]> {
  const key = tickers.length ? `quotes:${tickers.join(",")}` : null;
  const list = tickers.join(",");
  return useLive(
    key,
    async () => {
      const ts = list ? list.split(",") : [];
      return Promise.all(
        ts.map(async (ticker) => ({ ticker, market: await api.market(ticker, { limit: TRADES_LIMIT }) })),
      );
    },
    POLL.market,
  );
}

/** Is the server up, and is it serving a chain or the development fixtures? */
export function useHealth() {
  return useLive("health", () => api.health(), POLL.health);
}

/**
 * This wallet's USDC and ETH, share balances (held even with no bids), and
 * every bid across listings. Null address (signed out) stands the poll down.
 */
export function usePortfolio(address: string | null): Live<Portfolio> {
  return useLive(address ? `portfolio:${address.toLowerCase()}` : null, () => api.portfolio(address as string), POLL.portfolio);
}

/**
 * The tickers `address` is the issuer of, per `/v1/issuer/:ticker?address=`
 * (`check.isIssuer`). One check per listing; slow poll, it changes only with ENS ownership.
 */
export function useIssuerOf(tickers: string[], address: string | null): Live<string[]> {
  const list = tickers.join(",");
  return useLive(
    address && list ? `issuer:${address.toLowerCase()}:${list}` : null,
    async () => {
      const rows = await Promise.all(list.split(",").map((t) => api.issuer(t, address as string)));
      return rows.filter((r) => r.check?.isIssuer).map((r) => r.ticker);
    },
    POLL.issuer,
  );
}
