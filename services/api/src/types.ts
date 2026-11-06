/**
 * Response shapes of the Listing Day API (services/api). Self-contained, type-only: the app can import it with
 * `import type { Listing } from "../../services/api/src/types"` (or the `@listing-day/api/types` export) without
 * pulling any server code into the bundle.
 *
 * Units, everywhere:
 * - `price` fields: USDC per 1,000-share lot (1.10), the unit `app/src/lib/mock.ts` uses.
 * - `points` fields: price x 100 (110 = 1.10 USDC / lot; issue price = 100 points).
 * - USDC amounts (`budget`, `raised`, `usdc`, ...): human USDC (6 decimals applied).
 * - share amounts (`shares`, `filledShares`, ...): human shares (18 decimals applied).
 * - `raw` objects: the onchain integers as decimal strings (bigints do not fit in JSON numbers).
 * - times: ISO 8601 strings in UTC; blocks: numbers.
 */

export type Hex = `0x${string}`;
export type Address = Hex;

/** ENS `listingday.status` (empty record = "draft"). */
export type EnsStatus = "draft" | "auction" | "listed" | "surveillance" | "halted";
/** Listing lifecycle, as in the app mock, plus "cleared" (graduated, pool not opened yet). */
export type Phase = "draft" | "live" | "cleared" | "refunding" | "listed";
/** Circuit mode shown on the banner (mock `Mode`). */
export type Mode = "listing" | "normal" | "surveillance" | "directional" | "halted";
/** `ListingHook.phase()`. */
export type HookPhase = "NotListed" | "ListingDay" | "Normal";
/** CCA timeline at the current block. */
export type AuctionPhase = "notLaunched" | "upcoming" | "live" | "ended" | "claimable";
export type BidState = "active" | "outbid" | "partial" | "filled" | "exited" | "claimed" | "refundable";

export type ApiError = {
  error: { code: string; message: string; details?: unknown };
};

export type Health = {
  ok: boolean;
  chainId: number;
  rpcChainId: number | null;
  block: number | null;
  rpc: string;
  deployments: { file: string; ticker: string | null; ok: boolean; error?: string }[];
  error?: string;
};

export type Records = {
  /** ENS `addr` (coin type 60) when resolved, else the deployment's MockSME. */
  addr: Address | null;
  token: Address | null;
  auction: Address | null;
  hook: Address | null;
  /** ListingPolicyReceiver (from `eip155:<chain>:<address>`). */
  policy: Address | null;
  /** v4 PoolId (bytes32). */
  pool: Hex | null;
};

export type Avatar = { initials: string; bg: string; fg: string; uri: string | null };

/** The app mock's `OFFER`, from the deployment parameters. */
export type Offer = {
  totalSupply: number;
  auctioned: number;
  lpReserve: number;
  issuePrice: number;
  floorPrice: number;
  capPrice: number;
  perApplicantCap: number;
  targetRaise: number;
  requiredRaise: number;
  lpPercent: number;
};

/** One IPO card (mock `Ipo`). */
export type Listing = {
  ticker: string;
  symbol: string;
  name: string;
  ensName: string;
  /** Not onchain: null unless the issuer adds them later. */
  sector: string | null;
  city: string | null;
  description: string | null;
  url: string | null;
  avatar: Avatar;
  status: EnsStatus;
  /** Where `status` came from: the ENS record, the receiver (`status()`), or derived from chain state. */
  statusSource: "ens" | "receiver" | "derived";
  phase: Phase;
  eligibility: "open" | "human";
  clearingPrice: number | null;
  clearingPoints: number | null;
  graduated: boolean | null;
  listedAt: string | null;
  raised: number | null;
  bidCount: number;
  applicants: number;
  startBlock: number | null;
  endBlock: number | null;
  claimBlock: number | null;
  records: Records;
  raw: { clearingPriceQ96: string | null; currencyRaised: string | null };
};

export type ListingsResponse = { parent: string; chainId: number; currentBlock: number; now: string; listings: Listing[] };

export type ListingDetail = Listing & {
  offer: Offer;
  chainId: number;
  deployBlock: number;
  contracts: Record<string, Address | null>;
  external: Record<string, Address | null>;
};

export type EnsView = {
  ticker: string;
  name: string;
  universalResolver: Address;
  /** Every record as resolved through the Universal Resolver (null = unset or not resolvable). */
  records: {
    addr: Address | null;
    "listingday.auction": string | null;
    "listingday.pool": string | null;
    "listingday.hook": string | null;
    "listingday.policy": string | null;
    "listingday.status": string | null;
    "listingday.eligibility": string | null;
    description: string | null;
    url: string | null;
    avatar: string | null;
  };
  /** Does ENS agree with the deployment file? null when the record is unset. */
  matchesDeployment: { addr: boolean | null; auction: boolean | null; pool: boolean | null; hook: boolean | null; policy: boolean | null };
  resolved: boolean;
  error: string | null;
};

export type Auction = {
  ticker: string;
  address: Address | null;
  phase: AuctionPhase;
  currentBlock: number;
  startBlock: number | null;
  endBlock: number | null;
  claimBlock: number | null;
  migrationBlock: number | null;
  /** Blocks until the next boundary (start, end or claim); null when there is none. */
  blocksRemaining: number | null;
  clearingPrice: number | null;
  clearingPoints: number | null;
  floorPrice: number;
  capPrice: number;
  issuePrice: number;
  tickSpacingPoints: number;
  raised: number | null;
  requiredRaise: number;
  targetRaise: number;
  graduated: boolean | null;
  totalSupply: number;
  totalCleared: number | null;
  /** Sum of all bid budgets (USDC), from `BidSubmitted` logs. */
  committed: number;
  bidCount: number;
  applicants: number;
  perApplicantCap: number;
  validationHook: Address | null;
  eligibilityModule: Address | null;
  tokensRecipient: Address | null;
  fundsRecipient: Address | null;
  offer: Offer;
  raw: {
    clearingPriceQ96: string | null;
    floorPriceQ96: string;
    capPriceQ96: string;
    tickSpacingQ96: string;
    onePointQ96: string;
    currencyRaised: string | null;
    requiredCurrencyRaised: string;
    totalSupply: string;
    totalCleared: string | null;
    committed: string;
  };
};

/** mock `ClearingPoint` plus points and raw values. */
export type ClearingPoint = {
  block: number;
  time: number;
  price: number;
  points: number;
  /** `currencyRaised()` at that block (USDC); null if the RPC has no state for it. */
  raised: number | null;
  /** Cumulative bid budgets submitted up to that block (USDC). */
  committed: number;
  raw: { clearingPriceQ96: string; currencyRaised: string | null; cumulativeMps: number | null };
};

export type ClearingResponse = { ticker: string; auction: Address | null; series: ClearingPoint[] };

/** mock `Bid` plus owner, points, actions and raw values. */
export type Bid = {
  id: number;
  ticker: string;
  owner: Address;
  budget: number;
  maxPrice: number;
  maxPricePoints: number;
  submittedBlock: number;
  submittedAt: string | null;
  state: BidState;
  /** Known after exit (from `BidExited`); null before. */
  filledShares: number | null;
  refund: number | null;
  exitedBlock: number | null;
  claimed: boolean;
  tx: Hex;
  /** What the owner can do now; feed it to POST /v1/prepare/exit or /claim. */
  actions: { exit: "exitBid" | "exitPartiallyFilledBid" | null; claim: boolean };
  raw: { amount: string; maxPriceQ96: string; tokensFilled: string | null; currencyRefunded: string | null };
};

export type BidsResponse = {
  ticker: string | null;
  owner: Address | null;
  bids: Bid[];
  /** Total budget per ticker (USDC), like mock `COMMITTED`. */
  committed: Record<string, number>;
};

export type Eligibility = {
  ticker: string;
  address: Address;
  /** Listings are open (AllowAllModule): always true; the per-wallet budget cap still applies to bids. */
  eligible: boolean;
  mode: "open" | "human";
  reason: string | null;
  module: Address | null;
  cap: number | null;
  committed: number | null;
  remaining: number | null;
  raw: { cap: string | null; committed: string | null; remaining: string | null };
};

export type Band = { low: number; high: number; lowPoints: number; highPoints: number };

/** mock `Policy` plus the hook/receiver view. */
export type PolicyView = {
  ticker: string;
  version: number;
  mode: Mode;
  /** Reference share price (USDC / lot): the listing price on listing day. */
  referencePrice: number | null;
  referencePoints: number | null;
  /** Half-width of the band enforced on the next swap (bps of the share price). */
  bandBps: number;
  halted: boolean;
  /** When the current policy version was applied (`PolicyApplied` block time), else the listing time. */
  since: string | null;
  asOf: string | null;
  coolOffMin: number;
  coolOffUntil: string | null;
  creTx: Hex | null;
  hookPhase: HookPhase;
  band: Band | null;
  listingDayEndsAt: string | null;
  /** The receiver's policy is older than `maxAge`: `policy()` reads as halted until the next report. */
  stale: boolean;
  staleAt: string | null;
  maxAge: number | null;
  /** 0 normal, 1 surveillance, 2 directional (effective, defaults filled in). */
  policyMode: number;
  normalBandBps: number;
  survBandBps: number;
  receiver: Address | null;
  receiverStatus: string | null;
  raw: {
    refSqrtPriceX96: string;
    sqrtPriceMinX96: string | null;
    sqrtPriceMaxX96: string | null;
    asOf: string;
    coolOffUntil: string;
    staleAt: string | null;
    latestHalted: boolean | null;
  };
};

export type MarketEvent = { time: string; kind: Mode | "reference"; label: string; tx: Hex; block: number };

export type MarketView = {
  ticker: string;
  listed: boolean;
  hookPhase: HookPhase;
  mode: Mode;
  usdcIsCurrency0: boolean;
  price: number | null;
  points: number | null;
  band: Band | null;
  listingPrice: number | null;
  listedAt: string | null;
  listingDayEndsAt: string | null;
  policy: PolicyView;
  /** Token amounts backing the pool's in-range liquidity at the current price (full-range position). */
  liquidity: { usdc: number; shares: number };
  /** Reverted swaps emit no logs, so the proxy cannot see them: always empty (the app tracks its own receipts). */
  rejected: [];
  events: MarketEvent[];
  poolId: Hex;
  poolKey: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
  /** `pointsE2` / `bandPointsE2`: the hook's own (floored) `currentPointsE2` / `currentBandPointsE2` views. */
  raw: { sqrtPriceX96: string | null; tick: number | null; liquidity: string | null; pointsE2: string | null; bandPointsE2: [string, string] | null };
};

/** mock `Trade` plus block, sender and raw deltas. */
export type Trade = {
  time: number;
  side: "buy" | "sell";
  usdc: number;
  shares: number;
  /** Pool price after the swap (USDC / lot). */
  price: number;
  tx: Hex;
  block: number;
  /** PoolManager caller (the router), not the wallet. */
  sender: Address;
  raw: { amount0: string; amount1: string; sqrtPriceX96: string; tick: number; liquidity: string };
};

export type SwapsResponse = {
  ticker: string;
  poolId: Hex;
  trades: Trade[];
  /** mock `PricePoint[]`, oldest first (one per swap). */
  prices: { time: number; value: number }[];
};

// ------------------------------------------------------------------------------------------- prepare

export type DecodedError = {
  /** Innermost decoded error, e.g. "OutOfBand", "Halted", "BidAboveCap", "Error" (revert string). */
  name: string;
  selector: Hex | null;
  args: Record<string, string | number | boolean>;
  /** Suggested UI copy (errors.md). */
  message: string;
  /** Wrappers peeled off, outermost first, e.g. ["ExecutionFailed", "WrappedError"]. */
  wrappers: string[];
  data: Hex | null;
};

export type Simulation = {
  /** null: could not simulate (e.g. the RPC lacks eth_simulateV1 and approvals are still missing). */
  ok: boolean | null;
  method: "eth_call" | "eth_simulateV1" | "none";
  block: number;
  error: DecodedError | null;
  gasUsed: string | null;
  note: string | null;
};

export type TxRequest = {
  to: Address;
  data: Hex;
  /** Wei as a decimal string; pass `BigInt(value)` to wagmi. */
  value: string;
};

export type PreparedStep = TxRequest & {
  kind:
    | "approveUsdcToPermit2"
    | "approveTokenToPermit2"
    | "permit2Approve"
    | "submitBid"
    | "swap"
    | "exitBid"
    | "exitPartiallyFilledBid"
    | "claimTokens"
    | "claimTokensBatch";
  description: string;
  /** false: already satisfied onchain (e.g. allowance in place); skip it. */
  needed: boolean;
};

export type Permit2Info = {
  token: Address;
  spender: Address;
  amount: string;
  expiration: number;
  current: { erc20AllowanceToPermit2: string; permit2Amount: string; permit2Expiration: number };
};

/** POST /v1/prepare/*: the final call at the top level, every wallet step in `steps` (approvals first). */
export type Prepared = TxRequest & {
  ticker: string;
  action: "bid" | "swap" | "exit" | "claim";
  from: Address;
  chainId: number;
  steps: PreparedStep[];
  permit2: Permit2Info | null;
  simulate: Simulation;
  details: Record<string, unknown>;
};

export type PrepareBidBody = {
  ticker: string;
  owner: Address;
  /** USDC (human, e.g. 20 or "19.5"); or `budgetRaw` in 6-decimal units. */
  budget?: number | string;
  budgetRaw?: string;
  /** USDC per lot (e.g. 1.3); or `maxPricePoints` (integer, 130). */
  maxPrice?: number | string;
  maxPricePoints?: number;
  /** Seconds the Permit2 allowance stays valid (default 1 day). */
  permit2ExpiresIn?: number;
};

export type PrepareSwapBody = {
  ticker: string;
  from: Address;
  side: "buy" | "sell";
  /** Exact input: USDC to spend (buy) or shares to sell (sell); or `amountRaw`. */
  amount?: number | string;
  amountRaw?: string;
  /** Minimum output in raw units; default: quote minus `slippageBps` (default 100 = 1%). */
  minOutRaw?: string;
  slippageBps?: number;
  deadlineSeconds?: number;
  permit2ExpiresIn?: number;
};

export type PrepareExitBody = { ticker: string; bidId: number; from?: Address };
export type PrepareClaimBody = { ticker: string; bidId?: number; bidIds?: number[]; from?: Address };
