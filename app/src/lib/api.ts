// The app's one door to the backend (services/api). Every business read on
// every screen goes through here; nothing reads the demo JSON in app/mock any
// more (mock.ts is now only static copy for parts not migrated yet).
//
// Response types are imported from the server's own source of truth,
// services/api/src/types.ts (the `@listing-day/api/types` package export), so
// the app can never drift from the contract. They are `import type` only, so
// no server code reaches the bundle.
//
// There is no caching layer here on purpose: every response carries
// `Cache-Control: no-store`, so the only thing this file does is fold calls to
// the same URL that are already in flight into one request (de-duplication
// within a tick). Freshness comes from polling; see lib/live.ts.

import type {
  Auction,
  Bid,
  BidsResponse,
  ClearingPoint,
  ClearingResponse,
  BidDetails,
  BidStatus,
  ClaimDetails,
  DecodedError,
  Eligibility,
  EnsView,
  ExitDetails,
  HaltCause,
  HaltSpan,
  Health,
  Holding,
  IssuerView,
  Listing,
  ListingDetail,
  ListingsResponse,
  MarketEvent,
  MarketView,
  Offer,
  PolicyView,
  Portfolio,
  Prepared,
  PreparedStep,
  PrepareBidBody,
  PrepareClaimBody,
  PrepareExitBody,
  PrepareSwapBody,
  RefPoint as ApiRefPoint,
  SwapDetails,
  SwapQuote,
  SwapsResponse,
  Trade,
} from "../../../services/api/src/types";

export type {
  Auction,
  Bid,
  BidDetails,
  BidStatus,
  BidsResponse,
  ClaimDetails,
  ClearingPoint,
  ClearingResponse,
  DecodedError,
  Eligibility,
  EnsView,
  ExitDetails,
  HaltCause,
  HaltSpan,
  Health,
  Holding,
  IssuerView,
  Listing,
  ListingDetail,
  ListingsResponse,
  MarketEvent,
  MarketView,
  Offer,
  PolicyView,
  Portfolio,
  Prepared,
  PreparedStep,
  PrepareBidBody,
  PrepareClaimBody,
  PrepareExitBody,
  PrepareSwapBody,
  ApiRefPoint,
  SwapDetails,
  SwapQuote,
  SwapsResponse,
  Trade,
};

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------

/** Where the backend lives. Unset is a real state, not a crash: see `ApiFailure`. */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

export function apiConfigured(): boolean {
  return API_URL.length > 0;
}

// ---------------------------------------------------------------------------
// Errors: one plain-English sentence per code, and each one names the fix.
// ---------------------------------------------------------------------------

/** Our own codes, on top of the ones services/api documents. */
export type ApiCode =
  | "NO_API_URL"
  | "OFFLINE"
  | "NETWORK"
  | "TIMEOUT"
  | "BAD_RESPONSE"
  | "BAD_REQUEST"
  | "UNKNOWN_TICKER"
  | "UNKNOWN_BID"
  | "NOT_FOUND"
  | "NOT_LAUNCHED"
  | "RPC_ERROR"
  | "INTERNAL";

const SENTENCE: Record<ApiCode, string> = {
  NO_API_URL: "This copy of the app is not pointed at an exchange server, so there is nothing to show. Set NEXT_PUBLIC_API_URL to the backend address and reload.",
  OFFLINE: "You are offline. Reconnect and tap Retry.",
  NETWORK: "We couldn't reach the exchange server. Check your internet, then tap Retry.",
  TIMEOUT: "The exchange server took too long to answer. Tap Retry.",
  BAD_RESPONSE: "The exchange server sent something this app couldn't read. Tap Retry, and if it keeps happening the app and the server are different versions.",
  BAD_REQUEST: "The app asked for something the exchange server could not read. Reload the page and try again.",
  UNKNOWN_TICKER: "This company is not on the exchange. Go back to Markets and pick one from the list.",
  UNKNOWN_BID: "That application is no longer on the exchange. Pull Orders up to date and try again.",
  NOT_FOUND: "That isn't on the exchange. Go back and try again.",
  NOT_LAUNCHED: "This company has not opened its IPO yet, so there is nothing to show until it does.",
  RPC_ERROR: "The exchange server couldn't reach the network. Wait a few seconds and tap Retry.",
  INTERNAL: "The exchange server hit an error. Wait a few seconds and tap Retry.",
};

function isApiCode(c: string): c is ApiCode {
  return c in SENTENCE;
}

/** Every failed read throws one of these: a code, the server's message, and UI copy. */
export class ApiFailure extends Error {
  readonly code: ApiCode;
  readonly status: number | null;
  readonly details: unknown;
  /** The server's own wording, for Details disclosures and logs. Never shown on its own. */
  readonly serverMessage: string | null;

  constructor(code: ApiCode, opts: { status?: number | null; details?: unknown; serverMessage?: string | null } = {}) {
    super(SENTENCE[code]);
    this.name = "ApiFailure";
    this.code = code;
    this.status = opts.status ?? null;
    this.details = opts.details;
    this.serverMessage = opts.serverMessage ?? null;
  }

  /** One plain-English sentence that names the fix. */
  get sentence(): string {
    return SENTENCE[this.code];
  }

  /**
   * Every error state offers Retry. Even the configuration one: once the
   * variable is set and the app reloads, the same button is the way back.
   */
  get retryable(): boolean {
    return true;
  }
}

export function asApiFailure(e: unknown): ApiFailure {
  if (e instanceof ApiFailure) return e;
  if (e instanceof DOMException && e.name === "TimeoutError") return new ApiFailure("TIMEOUT");
  if (e instanceof Error) return new ApiFailure("NETWORK", { serverMessage: e.message });
  return new ApiFailure("NETWORK");
}

/** The error title for a card, matched to the code. */
export function errorTitle(e: ApiFailure): string {
  switch (e.code) {
    case "NO_API_URL":
      return "No exchange server configured";
    case "OFFLINE":
      return "You're offline";
    case "NOT_LAUNCHED":
      return "This IPO hasn't opened yet";
    case "UNKNOWN_TICKER":
    case "NOT_FOUND":
      return "We couldn't find that company";
    case "UNKNOWN_BID":
      return "We couldn't find that application";
    default:
      return "We couldn't load this from the exchange";
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 12_000;

/** Calls to the same URL that are already in flight share one request. */
const inFlight = new Map<string, Promise<unknown>>();

function timeoutSignal(): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(TIMEOUT_MS);
  } catch {
    return undefined;
  }
}

type ErrorEnvelope = { error?: { code?: string; message?: string; details?: unknown } };

async function send<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  if (!apiConfigured()) throw new ApiFailure("NO_API_URL");
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new ApiFailure("OFFLINE");

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      // Responses are no-store at the server; never let a browser or Next cache win.
      cache: "no-store",
      signal: timeoutSignal(),
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw asApiFailure(e);
  }

  let parsed: unknown = null;
  const text = await res.text().catch(() => "");
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiFailure("BAD_RESPONSE", { status: res.status, serverMessage: text.slice(0, 200) });
    }
  }

  if (!res.ok) {
    const env = (parsed ?? {}) as ErrorEnvelope;
    const raw = env.error?.code ?? "";
    const code: ApiCode = isApiCode(raw) ? raw : res.status >= 500 ? "INTERNAL" : "BAD_REQUEST";
    throw new ApiFailure(code, { status: res.status, details: env.error?.details, serverMessage: env.error?.message ?? null });
  }

  if (parsed === null) throw new ApiFailure("BAD_RESPONSE", { status: res.status });
  return parsed as T;
}

function get<T>(path: string): Promise<T> {
  const key = `GET ${path}`;
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = send<T>("GET", path).finally(() => {
    if (inFlight.get(key) === p) inFlight.delete(key);
  });
  inFlight.set(key, p);
  return p;
}

function query(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

// ---------------------------------------------------------------------------
// Endpoints (services/api/README.md)
// ---------------------------------------------------------------------------

export const api = {
  health: () => get<Health>("/health"),

  listings: () => get<ListingsResponse>("/v1/listings"),
  listing: (ticker: string) => get<ListingDetail>(`/v1/listings/${encodeURIComponent(ticker)}`),
  ens: (ticker: string) => get<EnsView>(`/v1/ens/${encodeURIComponent(ticker)}`),

  auction: (ticker: string) => get<Auction>(`/v1/auction/${encodeURIComponent(ticker)}`),
  clearing: (ticker: string) => get<ClearingResponse>(`/v1/auction/${encodeURIComponent(ticker)}/clearing`),

  bids: (opts: { ticker?: string; owner?: string } = {}) => get<BidsResponse>(`/v1/bids${query(opts)}`),
  eligibility: (ticker: string, address: string) => get<Eligibility>(`/v1/eligibility${query({ ticker, address })}`),

  policy: (ticker: string) => get<PolicyView>(`/v1/policy/${encodeURIComponent(ticker)}`),
  /** `limit` is how many recent trades (and price points) come back: 1 to 1000, server default 100. */
  market: (ticker: string, opts: { limit?: number } = {}) => get<MarketView>(`/v1/market/${encodeURIComponent(ticker)}${query(opts)}`),
  swaps: (ticker: string, opts: { limit?: number; fromBlock?: number } = {}) =>
    get<SwapsResponse>(`/v1/market/${encodeURIComponent(ticker)}/swaps${query(opts)}`),

  portfolio: (address: string) => get<Portfolio>(`/v1/portfolio/${encodeURIComponent(address)}`),
  issuer: (ticker: string, address: string) => get<IssuerView>(`/v1/issuer/${encodeURIComponent(ticker)}${query({ address })}`),

  // Writes are prepared here and signed in the wallet (lib/tx.ts); the proxy never signs.
  prepareBid: (body: PrepareBidBody) => send<Prepared<BidDetails>>("POST", "/v1/prepare/bid", body),
  prepareSwap: (body: PrepareSwapBody) => send<Prepared<SwapDetails>>("POST", "/v1/prepare/swap", body),
  prepareExit: (body: PrepareExitBody) => send<Prepared<ExitDetails>>("POST", "/v1/prepare/exit", body),
  prepareClaim: (body: PrepareClaimBody) => send<Prepared<ClaimDetails>>("POST", "/v1/prepare/claim", body),
};

// ---------------------------------------------------------------------------
// Poll intervals. There is no server push, and each call is a few RPC round
// trips, so every screen polls on a timer sized to how fast the number moves.
// ---------------------------------------------------------------------------

export const POLL = {
  /** One Ethereum block: the fastest anything on chain can change. */
  listings: 12_000,
  /** Price and band: the number a trader watches. */
  market: 8_000,
  /** Trade history: a new row is interesting, but not urgent. */
  swaps: 15_000,
  /** Clearing price and raise during a live auction. */
  auction: 12_000,
  /** The clearing series only gains a point per checkpoint. */
  clearing: 30_000,
  /** Your own applications change only when you or the auction act. */
  bids: 15_000,
  /** Your per-wallet cap. */
  eligibility: 30_000,
  /** Is the server up, and is it serving a chain or fixtures. */
  health: 60_000,
} as const;
