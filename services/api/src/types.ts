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
 * - times: ISO 8601 strings in UTC; blocks: numbers. Chart points (`time` in series, trades) are unix seconds.
 *
 * Nullability: a field typed `T | null` is null only for the reason in its doc comment (usually "not onchain
 * yet" or "the RPC no longer serves that block"). Never coerce those nulls to 0 in the UI: show "—" / a gap.
 * README.md "Nullable fields" lists them all.
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
/** Price-based view of a bid (mock `BidState`); see `BidStatus` for where the funds are. */
export type BidState = "active" | "outbid" | "partial" | "filled" | "exited" | "claimed" | "refundable";
/**
 * Settlement of a bid, from the CCA's `bids()` storage and its `BidExited` / `TokensClaimed` logs:
 * - `open`: not exited and the auction is still running.
 * - `awaitingExit`: not exited and the auction has ended: `exitBid` / `exitPartiallyFilledBid` settles it.
 * - `exited`: exited with shares filled that are not claimed yet (`claimableShares`; `actions.claim` says when).
 * - `claimed`: exited and the filled shares were claimed (any unspent USDC was refunded at exit).
 * - `refunded`: exited with 0 shares filled: the whole budget came back at exit, nothing to claim.
 * `exited` is NOT "refunded": a fully filled bid can be exited and still hold unclaimed shares.
 */
export type BidStatus = "open" | "awaitingExit" | "exited" | "claimed" | "refunded";
/** Why trading is blocked: CRE report `halted`, receiver policy older than `maxAge`, or a cool-off window. */
export type HaltCause = "report" | "stale" | "coolingOff";
/** The band regime under a halt: listing-day band, or the policy mode (mock `Mode` minus "halted"). */
export type TradingMode = "listing" | "normal" | "surveillance" | "directional";

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
  /**
   * ENS `addr` (coin type 60) when resolved, else the deployment's MockSME. This is the SHARE TOKEN CONTRACT,
   * never the issuer's wallet: use GET /v1/issuer/:ticker (`issuer.address`) for "owner wallet" / console sign-in.
   */
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
  /** Not onchain anywhere: always null. Keep demo copy in the app, labelled as such. */
  sector: string | null;
  /** Not onchain anywhere: always null. */
  city: string | null;
  /** ENS `description` text record; null when unset or the name does not resolve. */
  description: string | null;
  /** ENS `url` text record; null when unset. */
  url: string | null;
  avatar: Avatar;
  status: EnsStatus;
  /** Where `status` came from: the ENS record, the receiver (`status()`), or derived from chain state. */
  statusSource: "ens" | "receiver" | "derived";
  /** Includes "cleared" (graduated, pool not opened yet), which the PR #21 mock `Phase` lacks. */
  phase: Phase;
  eligibility: "open" | "human";
  /** null before `make launch` (no auction); same for every auction-derived field below. */
  clearingPrice: number | null;
  clearingPoints: number | null;
  graduated: boolean | null;
  /** null until the pool is listed. */
  listedAt: string | null;
  raised: number | null;
  bidCount: number;
  /** Distinct bidding WALLETS (open listings: not a count of people). */
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
  /**
   * `currencyRaised()` at that block (USDC); null when the RPC no longer serves state at that block (non-archive
   * node). Draw a gap, not 0; `committed` is a different number (sum of budgets).
   */
  raised: number | null;
  /** Cumulative bid budgets submitted up to that block (USDC). */
  committed: number;
  raw: { clearingPriceQ96: string; currencyRaised: string | null; cumulativeMps: number | null };
};

export type ClearingResponse = { ticker: string; auction: Address | null; series: ClearingPoint[] };

/** mock `Bid` plus owner, points, actions and raw values. */
export type Bid = {
  /** Globally unique: `<auction address (EIP-55)>:<bidId>`. Use it for React keys, busy / override maps. */
  key: string;
  /** Bid id: unique only within one auction. */
  id: number;
  ticker: string;
  auction: Address;
  owner: Address;
  budget: number;
  maxPrice: number;
  maxPricePoints: number;
  submittedBlock: number;
  submittedAt: string;
  state: BidState;
  status: BidStatus;
  /** Shares filled, from `BidExited`; null before the exit (the fill is only final then). */
  filledShares: number | null;
  /** USDC refunded at exit, from `BidExited`; null before the exit. */
  refund: number | null;
  /** Shares the owner can still claim (exited, not claimed). 0 once claimed or refunded; null before the exit. */
  claimableShares: number | null;
  /**
   * USDC still to come back on exit. 0 once exited (see `refund`), the full budget when the auction ended without
   * graduating, 0 for a bid that ended above the clearing price; null while the outcome depends on checkpoints.
   */
  refundableUsdc: number | null;
  exitedBlock: number | null;
  claimed: boolean;
  tx: Hex;
  /** What the owner can do now; feed it to POST /v1/prepare/exit or /claim. */
  actions: { exit: "exitBid" | "exitPartiallyFilledBid" | null; claim: boolean };
  raw: { amount: string; maxPriceQ96: string; tokensFilled: string | null; currencyRefunded: string | null; claimable: string | null; refundable: string | null };
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
  /** 0 before the first CRE report. */
  version: number;
  mode: Mode;
  /** Reference share price (USDC / lot): the listing price on listing day. null only before listing. */
  referencePrice: number | null;
  referencePoints: number | null;
  /** Half-width of the band enforced on the next swap (bps of the share price). */
  bandBps: number;
  /** CRE halted trading, or the receiver's policy is stale (`haltCause` says which). */
  halted: boolean;
  /** Why the next swap would be rejected before any band check; null when trading is open. */
  haltCause: HaltCause | null;
  /** No halt and no cool-off: swaps are only limited by the band (and the directional rule). */
  tradingOpen: boolean;
  /** When the current policy version was applied (`PolicyApplied` block time), else the listing time; null before both. */
  since: string | null;
  /** The report's `asOf`; null before the first report. */
  asOf: string | null;
  coolOffMin: number;
  /** null when no cool-off is running. */
  coolOffUntil: string | null;
  /** Tx of the `PolicyApplied` for `version`; null before the first report (or if its log is out of range). */
  creTx: Hex | null;
  hookPhase: HookPhase;
  /** null before listing. */
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

/** Prose timeline entry; `kind: "reference"` hides the mode, so charts should use `reference` / `spans` instead. */
export type MarketEvent = { time: string; kind: Mode | "reference"; label: string; tx: Hex; block: number };

/** mock `PricePoint`: one per successful swap (post-swap pool price), oldest first. Several can share a block. */
export type PricePoint = { time: number; value: number; block: number };

/**
 * mock `RefPoint`: the effective reference and band from this time on (one per `PolicySpan`), plus a final
 * `carryForward: true` point at the response's head time so the line reaches "now". Not a trade.
 */
export type RefPoint = {
  time: number;
  value: number;
  mode: Mode;
  bandBps: number;
  low: number;
  high: number;
  version: number;
  carryForward: boolean;
};

/** A window in which swaps revert before any band check (chart halt columns). `to` null = still running. */
export type HaltSpan = { from: string; to: string | null; fromTime: number; toTime: number | null; cause: HaltCause; version: number; tx: Hex | null };

/**
 * One interval of constant effective rules, reconstructed from `Listed`, `PolicyApplied` and `MaxAgeSet` logs
 * with the same rules as `ListingHook` (listing-day band override, defaults for 0 bands, staleness, cool-off).
 */
export type PolicySpan = {
  from: string;
  /** null = still in force at the response's head block. */
  to: string | null;
  fromTime: number;
  toTime: number | null;
  /** What started this span. `tx` is set for `listed` and `policyApplied`; the others are time boundaries. */
  trigger: "listed" | "policyApplied" | "listingDayEnded" | "stale" | "coolOffEnded" | "maxAgeSet";
  tx: Hex | null;
  block: number | null;
  /** Policy version in force (0 = no report yet: hook defaults). */
  version: number;
  /** Same meaning as `PolicyView.mode`: "halted" for a report halt or staleness, else `tradingMode`. */
  mode: Mode;
  tradingMode: TradingMode;
  halted: boolean;
  coolingOff: boolean;
  tradingOpen: boolean;
  haltCause: HaltCause | null;
  referencePrice: number;
  referencePoints: number;
  /** Band half-width enforced on the post-swap price (listing-day band, or normal / surveillance). */
  bandBps: number;
  band: Band;
  /** Directional mode only: a swap that moves away from the reference must end inside ±this many bps. */
  directionalBandBps: number | null;
  raw: { refSqrtPriceX96: string; sqrtPriceMinX96: string; sqrtPriceMaxX96: string };
};

/** One accepted CRE report (`PolicyApplied`) as reported, plus what the hook enforced when it landed. */
export type PolicyHistoryEntry = {
  version: number;
  block: number;
  time: string;
  timestamp: number;
  tx: Hex;
  /** Status string stored with the report (mirrored to ENS `listingday.status`). */
  status: string;
  asOf: string;
  /** Reported mode (0 normal, 1 surveillance, 2 directional). */
  mode: TradingMode;
  policyMode: number;
  halted: boolean;
  coolOffUntil: string | null;
  /** Reported reference; null = 0 in the report = "use the listing price". */
  referencePrice: number | null;
  referencePoints: number | null;
  /** As reported (0 = hook default: 2000 normal, 500 surveillance). */
  normalBandBps: number;
  survBandBps: number;
  /** When this report goes stale (`asOf + maxAge + 1`, with the maxAge in force then); null if never stale. */
  staleAt: string | null;
  /** When the next version replaced it; null for the latest. */
  supersededAt: string | null;
  /**
   * The rules the hook enforced right after this report landed (listing-day band during the listing hour);
   * null when the report landed before the pool was listed (nothing trades then).
   */
  effective: { mode: Mode; tradingMode: TradingMode; referencePrice: number; bandBps: number; band: Band; directionalBandBps: number | null; listingDayOverride: boolean } | null;
  raw: { refSqrtPriceX96: string; asOf: string; coolOffUntil: string };
};

export type PolicyHistory = {
  ticker: string;
  hook: Address;
  receiver: Address | null;
  /** Head block time the spans run up to. */
  now: string;
  currentBlock: number;
  /** Current `maxAge` (s); history uses the `MaxAgeSet` value in force at each point. */
  maxAge: number | null;
  /** null before listing (then `spans`, `reference` and `haltSpans` are empty). */
  listing: {
    listedAt: string;
    block: number;
    tx: Hex;
    listingPrice: number;
    listingPoints: number;
    listingDayEndsAt: string;
    bandBps: number;
    band: Band;
  } | null;
  /** Every `PolicyApplied`, oldest first (reports before listing included). */
  entries: PolicyHistoryEntry[];
  spans: PolicySpan[];
  haltSpans: HaltSpan[];
  reference: RefPoint[];
  notes: string[];
};

/**
 * GET /v1/market/:ticker: everything the company page needs in one call (pool state, effective policy, trades,
 * price points, reference / band history, halt spans). mock `Market` plus the hook view.
 */
export type MarketView = {
  ticker: string;
  listed: boolean;
  hookPhase: HookPhase;
  mode: Mode;
  usdcIsCurrency0: boolean;
  /** Pool spot price (USDC / lot); null before listing (use the auction clearing price then). */
  price: number | null;
  points: number | null;
  /** Effective reference price (listing price on listing day); null before listing. */
  referencePrice: number | null;
  referencePoints: number | null;
  /** Current band (low / high USDC per lot); null before listing. */
  band: Band | null;
  halted: boolean;
  haltCause: HaltCause | null;
  tradingOpen: boolean;
  listingPrice: number | null;
  listedAt: string | null;
  listingDayEndsAt: string | null;
  policy: PolicyView;
  /** Token amounts backing the pool's in-range liquidity at the current price (full-range position). */
  liquidity: { usdc: number; shares: number };
  /** Reverted swaps emit no logs, so the proxy cannot see them: always empty (the app tracks its own receipts). */
  rejected: [];
  events: MarketEvent[];
  /** Most recent `tradesLimit` swaps, newest first (same as /swaps). */
  trades: Trade[];
  /** The same swaps as chart points, oldest first. Sparse: real swaps only, no synthetic fill. */
  prices: PricePoint[];
  tradesLimit: number;
  /** Effective reference / band steps (see `RefPoint`), oldest first. */
  reference: RefPoint[];
  haltSpans: HaltSpan[];
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
  /** Pool price AFTER the swap (USDC / lot): a market price, not this trade's fill price. */
  price: number;
  /** This trade's average fill price (USDC / lot) = usdc / shares x 1000, fee included. */
  avgPrice: number;
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
  prices: PricePoint[];
};

// ------------------------------------------------------------------------------------------- issuer / roles

/** One onchain role and who holds it right now. */
export type RoleHolder = {
  /** Stable id, e.g. "ens.nameOwner", "hook.owner", "receiver.broadcaster". */
  role: string;
  /** Contract the role lives on (null when the contract is not deployed / configured). */
  contract: Address | null;
  contractName: string;
  holder: Address | null;
  /** What holding it lets you do. */
  description: string;
  /** "onchain" = read at the response block; "deployment" = recorded by the deploy scripts, not verified. */
  source: "onchain" | "deployment";
};

/** GET /v1/issuer/:ticker: the token contract vs the issuer wallet, and every role holder. */
export type IssuerView = {
  ticker: string;
  ensName: string;
  chainId: number;
  block: number;
  /** The ERC20 share token. ENS `addr` points HERE. Never ask a user to connect this address. */
  token: { address: Address; name: string | null; symbol: string | null };
  /** ENS `addr` (coin type 60) as resolved, and whether it is the token (it should be). */
  ensAddr: Address | null;
  ensAddrIsToken: boolean | null;
  /**
   * The issuer wallet: the ENSv2 owner of the ticker name (`UserRegistry.findOwner(label)`), else the deployment's
   * `issuer`. This is the wallet to compare with the connected account for the issuer console.
   */
  issuer: { address: Address | null; source: "ens" | "deployment" | null };
  treasury: Address | null;
  roles: RoleHolder[];
  /** With `?address=`: the roles that address holds. */
  check: { address: Address; isIssuer: boolean; roles: string[] } | null;
  notes: string[];
};

// ------------------------------------------------------------------------------------------- portfolio

export type Holding = {
  ticker: string;
  symbol: string;
  token: Address;
  /** Wallet ERC20 balance. */
  shares: number;
  /** Filled shares of exited, unclaimed bids (claimable from the auction; not in `shares` yet). */
  unclaimedShares: number;
  /** Bids not exited yet: their fill is unknown until exit and is NOT counted in `unclaimedShares`. */
  pendingBids: number;
  /** Mark price (USDC / lot): pool spot when listed, else the auction clearing price; null before launch. */
  price: number | null;
  priceSource: "pool" | "clearing" | null;
  /** (shares + unclaimedShares) x price / 1000 (USDC); null without a price. */
  value: number | null;
  /** Unsupported: no cost-basis accounting (always null). */
  avgCost: null;
  raw: { balance: string; unclaimed: string };
};

/** GET /v1/portfolio/:address. Balances and bids only; see `unsupported`. */
export type Portfolio = {
  address: Address;
  chainId: number;
  block: number;
  asOf: string;
  balances: { eth: number; usdc: number; raw: { eth: string; usdc: string } };
  holdings: Holding[];
  /** This wallet's bids across every listing, newest first (same shape as /v1/bids). */
  bids: Bid[];
  totals: {
    /** Sum of holding values (USDC), listings without a price skipped. */
    holdingsValueUsdc: number;
    unclaimedShares: Record<string, number>;
    /** Known refunds still to come (sum of non-null `refundableUsdc`). */
    refundableUsdc: number;
    /** Budget of bids not exited yet (USDC still in the auction). */
    inAuctionUsdc: number;
  };
  /** Not computed by this API, with the reason. Hide or label these in the UI. */
  unsupported: { costBasis: string; pnl: string; lpPositions: string; lpFees: string; tradeHistory: string };
};

// ------------------------------------------------------------------------------------------- config

export type ListingConfig = {
  ticker: string;
  ensName: string;
  label: string;
  chainId: number;
  deployBlock: number;
  contracts: {
    token: Address;
    auction: Address | null;
    listingHook: Address;
    listingPolicyReceiver: Address | null;
    allowAllModule: Address | null;
    auctionValidationHook: Address | null;
  };
  wallets: { issuer: Address | null; treasury: Address | null; deployer: Address | null; creBroadcaster: Address | null };
  pool: { poolId: Hex; poolKey: MarketView["poolKey"]; usdcIsCurrency0: boolean; listingDayBandBps: number };
  auction: { startBlock: number | null; endBlock: number | null; claimBlock: number | null };
  ens: { registry: Address | null; resolver: Address | null; universalResolver: Address };
  lpTokenId: number | null;
  /** usdc, permit2, poolManager, positionManager, universalRouter, stateView, quoter, lbpStrategy, multicall3. */
  external: Record<string, Address>;
  offer: Offer;
};

/** GET /v1/config: static deployment data (no RPC), to replace the app's address fixtures. */
export type ConfigResponse = {
  apiVersion: string;
  chainId: number;
  chainName: string;
  parent: string;
  explorerUrl: string | null;
  /** The env var the app reads this API's base URL from. */
  frontendEnv: { apiUrl: "NEXT_PUBLIC_API_URL" };
  listings: ListingConfig[];
  /** Deployment files that could not be served (basename only). */
  errors: { file: string; ticker: string | null; error: string }[];
};

/** GET /v1/errors: every custom error the decoder knows (`simulate.error.name` is one of these, or Error / Panic / Unknown / EmptyRevert). */
export type ErrorCatalog = { errors: { name: string; selector: Hex; signature: string }[] };

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
export type Prepared<D = Record<string, unknown>> = TxRequest & {
  ticker: string;
  action: "bid" | "swap" | "exit" | "claim";
  from: Address;
  chainId: number;
  steps: PreparedStep[];
  permit2: Permit2Info | null;
  simulate: Simulation;
  details: D;
};

/** V4Quoter quote plus the pool price move it implies. */
export type SwapQuote = {
  /** false: the quote itself reverted (`error`), e.g. OutOfBand / Halted / CoolingOff / DirectionalWidening. */
  ok: boolean;
  /** Output (shares for buy, USDC for sell); null when the quote reverted. */
  amountOut: number | null;
  /** Average execution price (USDC / lot), fee included; null when the quote reverted. */
  avgPrice: number | null;
  /** Pool spot price before the swap (USDC / lot); null before listing. */
  priceBefore: number | null;
  /**
   * Pool spot price after the swap (USDC / lot). Also set when the swap reverts on a band rule (from the
   * OutOfBand / DirectionalWidening args), so the UI can say "would end at 1.27, band 0.64 to 0.96".
   */
  priceAfter: number | null;
  /** Signed spot-price move priceBefore -> priceAfter in bps (+ for buys). */
  priceImpactBps: number | null;
  /** Signed avgPrice vs priceBefore in bps (cost of size + LP fee). */
  avgPriceVsSpotBps: number | null;
  /**
   * Where `priceAfter` comes from: "simulation" (StateView.getSlot0 read right after the simulated swap),
   * "revert" (the hook's error args), "estimate" (single-range v4 math from slot0 + liquidity).
   */
  priceAfterSource: "simulation" | "revert" | "estimate" | null;
  error: DecodedError | null;
  raw: { sqrtPriceBeforeX96: string | null; sqrtPriceAfterX96: string | null };
};

export type SwapDetails = {
  side: "buy" | "sell";
  router: Address;
  zeroForOne: boolean;
  amountIn: number;
  quote: SwapQuote;
  minOut: number;
  slippageBps: number;
  deadline: number;
  warnings: string[];
  raw: { amountIn: string; amountOut: string | null; minOut: string; commands: Hex; inputs: Hex[] };
};

export type BidDetails = {
  auction: Address;
  owner: Address;
  budget: number;
  maxPrice: number;
  maxPricePoints: number;
  usdcBalance: number;
  warnings: string[];
  raw: { amount: string; maxPriceQ96: string; prevTickPriceQ96: string; usdcBalance: string };
};

export type ExitDetails = {
  bidId: number;
  /** `<auction>:<bidId>`, as `Bid.key`. */
  key: string;
  owner: Address;
  function: "exitBid" | "exitPartiallyFilledBid";
  /** Why no exit works yet (the simulation will revert); null when one does. */
  reason: string | null;
  hints: { lastFullyFilledCheckpointBlock: number; outbidBlock: number } | null;
};

export type ClaimDetails = {
  bidIds: number[];
  keys: string[];
  owner: Address;
  tokensFilled: number;
  exited: boolean[];
  warnings: string[];
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
