import { getAbiItem, getAddress, type Address } from "viem";

import { allowAllModuleAbi, ccaAbi, validationHookAbi } from "../abis.ts";
import { blockTimes, getLogsChunked } from "../chain.ts";
import type { Listing } from "../config.ts";
import type { Ctx, Head } from "../context.ts";
import type { Auction, AuctionPhase, Bid, BidState, BidStatus, ClearingPoint, Offer } from "../types.ts";
import { ONE_POINT_Q96, iso, q96ToPoints, q96ToPrice, round, shares, usdc } from "../units.ts";

const MAX_BLOCK = (1n << 64n) - 1n;

export const bidSubmittedEvent = getAbiItem({ abi: ccaAbi, name: "BidSubmitted" });
const bidExitedEvent = getAbiItem({ abi: ccaAbi, name: "BidExited" });
const tokensClaimedEvent = getAbiItem({ abi: ccaAbi, name: "TokensClaimed" });
const checkpointUpdatedEvent = getAbiItem({ abi: ccaAbi, name: "CheckpointUpdated" });

export function offer(l: Listing): Offer {
  const p = l.params;
  const issue = Number(p.issuePoints) / 100;
  return {
    totalSupply: shares(p.totalSupply),
    auctioned: shares(p.auctionSupply),
    lpReserve: shares(p.lpReserve),
    issuePrice: issue,
    floorPrice: Number(p.floorPoints) / 100,
    capPrice: Number(p.capPoints) / 100,
    perApplicantCap: usdc(p.applicantCap),
    targetRaise: round((shares(p.auctionSupply) / 1000) * issue, 6),
    requiredRaise: usdc(p.requiredCurrencyRaised),
    lpPercent: Number(p.lpRateMps) / 1e5,
  };
}

/** Live CCA state at `h`, or null before `make launch`. */
export async function auctionState(ctx: Ctx, l: Listing, h: Head) {
  if (!l.auction) return null;
  const c = { address: l.auction, abi: ccaAbi, blockNumber: h.number } as const;
  const r = ctx.client;
  const [clearingPriceQ96, currencyRaised, graduated, totalCleared, startBlock, endBlock, claimBlock, nextBidId, tokensRecipient, fundsRecipient, validationHook] =
    await Promise.all([
      r.readContract({ ...c, functionName: "clearingPrice" }),
      r.readContract({ ...c, functionName: "currencyRaised" }),
      r.readContract({ ...c, functionName: "isGraduated" }),
      r.readContract({ ...c, functionName: "totalCleared" }),
      r.readContract({ ...c, functionName: "startBlock" }),
      r.readContract({ ...c, functionName: "endBlock" }),
      r.readContract({ ...c, functionName: "claimBlock" }),
      r.readContract({ ...c, functionName: "nextBidId" }),
      r.readContract({ ...c, functionName: "tokensRecipient" }),
      r.readContract({ ...c, functionName: "fundsRecipient" }),
      r.readContract({ ...c, functionName: "validationHook" }),
    ]);
  return {
    address: l.auction,
    clearingPriceQ96,
    currencyRaised,
    graduated,
    totalCleared,
    startBlock: BigInt(startBlock),
    endBlock: BigInt(endBlock),
    claimBlock: BigInt(claimBlock),
    nextBidId,
    tokensRecipient,
    fundsRecipient,
    validationHook,
  };
}

export type AuctionState = NonNullable<Awaited<ReturnType<typeof auctionState>>>;

export function auctionPhase(a: AuctionState | null, block: bigint): AuctionPhase {
  if (!a) return "notLaunched";
  if (block < a.startBlock) return "upcoming";
  if (block < a.endBlock) return "live";
  if (block < a.claimBlock) return "ended";
  return "claimable";
}

/** Every `BidSubmitted` of the listing's auction (optionally one owner's), oldest first. */
export async function submittedBids(ctx: Ctx, l: Listing, h: Head, owner?: Address) {
  if (!l.auction) return [];
  return getLogsChunked(
    ctx.client,
    {
      address: l.auction,
      event: bidSubmittedEvent,
      args: owner ? { owner } : undefined,
      fromBlock: l.deployBlock,
      toBlock: h.number,
    },
    ctx.config.logsMaxRange,
  );
}

export async function auctionView(ctx: Ctx, l: Listing, h: Head): Promise<Auction> {
  const [a, bids] = await Promise.all([auctionState(ctx, l, h), submittedBids(ctx, l, h)]);
  const p = l.params;
  const phase = auctionPhase(a, h.number);
  const boundary = !a ? null : phase === "upcoming" ? a.startBlock : phase === "live" ? a.endBlock : phase === "ended" ? a.claimBlock : null;
  const committedRaw = bids.reduce((s, b) => s + b.args.amount, 0n);
  let module: Address | null = l.module;
  if (a?.validationHook && /^0x0{40}$/i.test(a.validationHook) === false) {
    try {
      module = await ctx.client.readContract({ address: a.validationHook, abi: validationHookAbi, functionName: "module", blockNumber: h.number });
    } catch {
      // not our hook: keep the deployment's module
    }
  }
  return {
    ticker: l.ticker,
    address: l.auction,
    phase,
    currentBlock: Number(h.number),
    startBlock: a ? Number(a.startBlock) : num(l.startBlock),
    endBlock: a ? Number(a.endBlock) : num(l.endBlock),
    claimBlock: a ? Number(a.claimBlock) : num(l.claimBlock),
    migrationBlock: num(l.migrationBlock),
    blocksRemaining: boundary === null ? null : Number(boundary - h.number),
    clearingPrice: a ? q96ToPrice(a.clearingPriceQ96) : null,
    clearingPoints: a ? q96ToPoints(a.clearingPriceQ96) : null,
    floorPrice: Number(p.floorPoints) / 100,
    capPrice: Number(p.capPoints) / 100,
    issuePrice: Number(p.issuePoints) / 100,
    tickSpacingPoints: Number(p.tickSpacingQ96 / ONE_POINT_Q96),
    raised: a ? usdc(a.currencyRaised) : null,
    requiredRaise: usdc(p.requiredCurrencyRaised),
    targetRaise: offer(l).targetRaise,
    graduated: a ? a.graduated : null,
    totalSupply: shares(p.auctionSupply),
    totalCleared: a ? shares(a.totalCleared) : null,
    committed: usdc(committedRaw),
    bidCount: bids.length,
    applicants: new Set(bids.map((b) => b.args.owner)).size,
    perApplicantCap: usdc(p.applicantCap),
    validationHook: a ? a.validationHook : l.validationHook,
    eligibilityModule: module,
    tokensRecipient: a ? a.tokensRecipient : null,
    fundsRecipient: a ? a.fundsRecipient : null,
    offer: offer(l),
    raw: {
      clearingPriceQ96: a ? a.clearingPriceQ96.toString() : null,
      floorPriceQ96: p.floorPriceQ96.toString(),
      capPriceQ96: p.capPriceQ96.toString(),
      tickSpacingQ96: p.tickSpacingQ96.toString(),
      onePointQ96: ONE_POINT_Q96.toString(),
      currencyRaised: a ? a.currencyRaised.toString() : null,
      requiredCurrencyRaised: p.requiredCurrencyRaised.toString(),
      totalSupply: p.auctionSupply.toString(),
      totalCleared: a ? a.totalCleared.toString() : null,
      committed: committedRaw.toString(),
    },
  };
}

function num(v: bigint | null): number | null {
  return v === null ? null : Number(v);
}

/** Clearing price per checkpoint (`CheckpointUpdated`), with `currencyRaised()` read at each checkpoint block. */
export async function clearingSeries(ctx: Ctx, l: Listing, h: Head): Promise<ClearingPoint[]> {
  if (!l.auction) return [];
  const auction = l.auction;
  const [checkpoints, bids] = await Promise.all([
    getLogsChunked(
      ctx.client,
      { address: auction, event: checkpointUpdatedEvent, fromBlock: l.deployBlock, toBlock: h.number },
      ctx.config.logsMaxRange,
    ),
    submittedBids(ctx, l, h),
  ]);
  const times = await blockTimes(ctx.client, checkpoints.map((c) => c.blockNumber));
  const raised = await Promise.all(
    checkpoints.map(async (c) => {
      try {
        return await ctx.client.readContract({ address: auction, abi: ccaAbi, functionName: "currencyRaised", blockNumber: c.blockNumber });
      } catch {
        return null; // pruned state on a non-archive RPC
      }
    }),
  );
  return checkpoints.map((c, i) => {
    const committed = bids.filter((b) => b.blockNumber <= c.blockNumber).reduce((s, b) => s + b.args.amount, 0n);
    const r = raised[i] ?? null;
    return {
      block: Number(c.args.blockNumber),
      time: Number(times.get(c.blockNumber) ?? 0n),
      price: q96ToPrice(c.args.clearingPriceQ96),
      points: q96ToPoints(c.args.clearingPriceQ96),
      raised: r === null ? null : usdc(r),
      committed: usdc(committed),
      raw: { clearingPriceQ96: c.args.clearingPriceQ96.toString(), currencyRaised: r === null ? null : r.toString(), cumulativeMps: Number(c.args.cumulativeMps) },
    };
  });
}

type ExitPlan = { fn: "exitBid" } | { fn: "exitPartiallyFilledBid"; lastFullyFilledCheckpointBlock: bigint; outbidBlock: bigint } | { fn: null; reason: string };

/**
 * Which exit applies to a bid now, and the checkpoint hints `exitPartiallyFilledBid` needs (walks the CCA's
 * checkpoint linked list from the bid's start block: one `checkpoints(n)` read per checkpoint).
 */
export async function planExit(
  ctx: Ctx,
  _l: Listing,
  a: AuctionState,
  bid: { maxPrice: bigint; startBlock: bigint; exitedBlock: bigint },
  h: Head,
): Promise<ExitPlan> {
  if (bid.exitedBlock !== 0n) return { fn: null, reason: "already exited" };
  const ended = h.number >= a.endBlock;
  if (ended && !a.graduated) return { fn: "exitBid" };
  if (ended && bid.maxPrice > a.clearingPriceQ96) return { fn: "exitBid" };
  if (!ended && bid.maxPrice >= a.clearingPriceQ96) return { fn: null, reason: "bid is still active: exit after the auction ends" };
  if (!a.graduated) return { fn: null, reason: "outbid bids can be exited once the auction graduates, or after it ends" };

  const read = (n: bigint) =>
    ctx.client.readContract({ address: a.address, abi: ccaAbi, functionName: "checkpoints", args: [n], blockNumber: h.number });
  let lastFully: bigint | null = null;
  let outbid = 0n;
  let block = bid.startBlock;
  let cp = await read(block);
  for (let i = 0; i < 5000; i++) {
    const nextBlock = BigInt(cp.next);
    if (cp.clearingPrice > bid.maxPrice) {
      outbid = block;
      break;
    }
    if (nextBlock === 0n || nextBlock === MAX_BLOCK) break;
    const next = await read(nextBlock);
    if (cp.clearingPrice < bid.maxPrice && next.clearingPrice >= bid.maxPrice && lastFully === null) lastFully = block;
    block = nextBlock;
    cp = next;
  }
  if (lastFully === null) return { fn: null, reason: "no partially filled checkpoint found for this bid" };
  if (outbid === 0n && !ended) return { fn: null, reason: "bid at the clearing price: exit after the auction ends" };
  return { fn: "exitPartiallyFilledBid", lastFullyFilledCheckpointBlock: lastFully, outbidBlock: outbid };
}

export async function bidsView(ctx: Ctx, ls: Listing[], h: Head, owner?: Address): Promise<{ bids: Bid[]; committed: Record<string, number> }> {
  const perListing = await Promise.all(ls.map((l) => listingBids(ctx, l, h, owner)));
  const bids = perListing.flat().sort((x, y) => y.submittedBlock - x.submittedBlock || y.id - x.id);
  const committed: Record<string, number> = {};
  for (const b of bids) committed[b.ticker] = round((committed[b.ticker] ?? 0) + b.budget, 6);
  return { bids, committed };
}

async function listingBids(ctx: Ctx, l: Listing, h: Head, owner?: Address): Promise<Bid[]> {
  if (!l.auction) return [];
  const auction = l.auction;
  const [a, submitted] = await Promise.all([auctionState(ctx, l, h), submittedBids(ctx, l, h, owner)]);
  if (!a || submitted.length === 0) return [];
  const range = { fromBlock: l.deployBlock, toBlock: h.number };
  const [exited, claimed, times] = await Promise.all([
    getLogsChunked(ctx.client, { address: auction, event: bidExitedEvent, args: owner ? { owner } : undefined, ...range }, ctx.config.logsMaxRange),
    getLogsChunked(ctx.client, { address: auction, event: tokensClaimedEvent, args: owner ? { owner } : undefined, ...range }, ctx.config.logsMaxRange),
    blockTimes(ctx.client, submitted.map((s) => s.blockNumber)),
  ]);
  const exitedById = new Map(exited.map((e) => [e.args.bidId, e]));
  const claimedIds = new Set(claimed.map((c) => c.args.bidId));
  const ended = h.number >= a.endBlock;

  return Promise.all(
    submitted.map(async (s): Promise<Bid> => {
      const id = s.args.id;
      const stored = await ctx.client.readContract({ address: auction, abi: ccaAbi, functionName: "bids", args: [id], blockNumber: h.number });
      const exit = exitedById.get(id);
      const exitedBlock = BigInt(stored.exitedBlock);
      const isClaimed = claimedIds.has(id);
      const state = bidState({ maxPrice: s.args.priceQ96, exitedBlock, claimed: isClaimed, clearing: a.clearingPriceQ96, ended, graduated: a.graduated });
      const plan = await planExit(ctx, l, a, { maxPrice: s.args.priceQ96, startBlock: BigInt(stored.startBlock), exitedBlock }, h);
      const canClaim = exitedBlock !== 0n && !isClaimed && a.graduated && h.number >= a.claimBlock && stored.tokensFilled > 0n;
      const settlement = bidSettlement({
        exited: exitedBlock !== 0n || exit !== undefined,
        claimed: isClaimed,
        // claimTokens zeroes storage, so the exit log is the fill of record.
        filled: exit ? exit.args.tokensFilled : stored.tokensFilled,
        unclaimed: stored.tokensFilled,
        amount: s.args.amount,
        maxPrice: s.args.priceQ96,
        clearing: a.clearingPriceQ96,
        ended,
        graduated: a.graduated,
      });
      return {
        key: bidKey(auction, id),
        id: Number(id),
        ticker: l.ticker,
        auction,
        owner: getAddress(s.args.owner),
        budget: usdc(s.args.amount),
        maxPrice: q96ToPrice(s.args.priceQ96),
        maxPricePoints: q96ToPoints(s.args.priceQ96),
        submittedBlock: Number(s.blockNumber),
        submittedAt: iso(times.get(s.blockNumber)) ?? new Date(0).toISOString(),
        state,
        status: settlement.status,
        filledShares: exit ? shares(exit.args.tokensFilled) : null,
        refund: exit ? usdc(exit.args.currencyRefunded) : null,
        claimableShares: settlement.claimable === null ? null : shares(settlement.claimable),
        refundableUsdc: settlement.refundable === null ? null : usdc(settlement.refundable),
        exitedBlock: exitedBlock === 0n ? null : Number(exitedBlock),
        claimed: isClaimed,
        tx: s.transactionHash,
        actions: { exit: plan.fn, claim: canClaim },
        raw: {
          amount: s.args.amount.toString(),
          maxPriceQ96: s.args.priceQ96.toString(),
          tokensFilled: exit ? exit.args.tokensFilled.toString() : null,
          currencyRefunded: exit ? exit.args.currencyRefunded.toString() : null,
          claimable: settlement.claimable === null ? null : settlement.claimable.toString(),
          refundable: settlement.refundable === null ? null : settlement.refundable.toString(),
        },
      };
    }),
  );
}

/** `Bid.key`: bid ids restart at 0 in every auction. */
export function bidKey(auction: Address, id: bigint | number): string {
  return `${getAddress(auction)}:${id}`;
}

/** Where a bid's money is (see `BidStatus`), plus the raw shares still claimable and USDC still to be refunded. */
export function bidSettlement(b: {
  exited: boolean;
  claimed: boolean;
  filled: bigint;
  unclaimed: bigint;
  amount: bigint;
  maxPrice: bigint;
  clearing: bigint;
  ended: boolean;
  graduated: boolean;
}): { status: BidStatus; claimable: bigint | null; refundable: bigint | null } {
  if (b.exited) {
    if (b.claimed) return { status: "claimed", claimable: 0n, refundable: 0n };
    if (b.filled === 0n) return { status: "refunded", claimable: 0n, refundable: 0n };
    return { status: "exited", claimable: b.unclaimed, refundable: 0n };
  }
  if (!b.ended) return { status: "open", claimable: null, refundable: null };
  // Not graduated: exitBid refunds everything. Above the final clearing price: the whole budget was spent.
  const refundable = !b.graduated ? b.amount : b.maxPrice > b.clearing ? 0n : null;
  return { status: "awaitingExit", claimable: null, refundable };
}

export function bidState(b: { maxPrice: bigint; exitedBlock: bigint; claimed: boolean; clearing: bigint; ended: boolean; graduated: boolean }): BidState {
  if (b.claimed) return "claimed";
  if (b.exitedBlock !== 0n) return "exited";
  if (!b.ended) return b.maxPrice > b.clearing ? "active" : b.maxPrice === b.clearing ? "partial" : "outbid";
  if (!b.graduated) return "refundable";
  return b.maxPrice > b.clearing ? "filled" : b.maxPrice === b.clearing ? "partial" : "refundable";
}

export async function eligibilityView(ctx: Ctx, l: Listing, h: Head, address: Address, mode: "open" | "human") {
  let module = l.module;
  if (l.validationHook) {
    try {
      module = await ctx.client.readContract({ address: l.validationHook, abi: validationHookAbi, functionName: "module", blockNumber: h.number });
    } catch {
      // keep the deployment's module
    }
  }
  let cap: bigint | null = null;
  let committed: bigint | null = null;
  let remaining: bigint | null = null;
  if (module) {
    const m = { address: module, abi: allowAllModuleAbi, blockNumber: h.number } as const;
    try {
      [cap, committed, remaining] = await Promise.all([
        ctx.client.readContract({ ...m, functionName: "cap" }),
        ctx.client.readContract({ ...m, functionName: "committed", args: [address] }),
        ctx.client.readContract({ ...m, functionName: "remaining", args: [address] }),
      ]);
    } catch {
      // a module without the AllowAllModule views
    }
  }
  return {
    ticker: l.ticker,
    address,
    eligible: true,
    mode,
    reason: remaining === 0n ? "per-applicant budget cap reached" : null,
    module,
    cap: cap === null ? null : usdc(cap),
    committed: committed === null ? null : usdc(committed),
    remaining: remaining === null ? null : usdc(remaining),
    raw: { cap: cap?.toString() ?? null, committed: committed?.toString() ?? null, remaining: remaining?.toString() ?? null },
  };
}
