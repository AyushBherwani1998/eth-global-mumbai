import { getAbiItem, getAddress } from "viem";

import { listingHookAbi, poolManagerAbi, receiverAbi, stateViewAbi } from "../abis.ts";
import { blockTimes, getLogsChunked } from "../chain.ts";
import type { Listing } from "../config.ts";
import type { Ctx, Head } from "../context.ts";
import type { Band, HaltCause, HookPhase, MarketEvent, MarketView, Mode, PolicyView, SwapsResponse, Trade } from "../types.ts";
import { formatLot, fullRangeAmounts, iso, pointsE2ToPoints, pointsE2ToPrice, round, shares, sqrtPriceX96ToPointsE2, sqrtPriceX96ToPrice, usdc } from "../units.ts";
import { historyFrom, policyLogs, receiverOf, type PolicyLogs } from "./policy-history.ts";

const HOOK_PHASES: HookPhase[] = ["NotListed", "ListingDay", "Normal"];
const POLICY_MODES: Mode[] = ["normal", "surveillance", "directional"];

const policyAppliedEvent = getAbiItem({ abi: receiverAbi, name: "PolicyApplied" });
const swapEvent = getAbiItem({ abi: poolManagerAbi, name: "Swap" });

export async function hookState(ctx: Ctx, l: Listing, h: Head) {
  const c = { address: l.hook, abi: listingHookAbi, blockNumber: h.number } as const;
  const r = ctx.client;
  const [phase, eff, band, bandE2, listed, listedAt, listingDayEndsAt, listingSqrt, listingDayBandBps, pointsE2, policySource] = await Promise.all([
    r.readContract({ ...c, functionName: "phase" }),
    r.readContract({ ...c, functionName: "effectivePolicy" }),
    r.readContract({ ...c, functionName: "currentBand" }),
    r.readContract({ ...c, functionName: "currentBandPointsE2" }),
    r.readContract({ ...c, functionName: "listed" }),
    r.readContract({ ...c, functionName: "listedAt" }),
    r.readContract({ ...c, functionName: "listingDayEndsAt" }),
    r.readContract({ ...c, functionName: "listingSqrtPriceX96" }),
    r.readContract({ ...c, functionName: "listingDayBandBps" }),
    r.readContract({ ...c, functionName: "currentPointsE2" }),
    r.readContract({ ...c, functionName: "policySource" }),
  ]);
  return { phase: HOOK_PHASES[phase] ?? "NotListed", eff, band, bandE2, listed, listedAt, listingDayEndsAt, listingSqrt, listingDayBandBps, pointsE2, policySource };
}

type HookState = Awaited<ReturnType<typeof hookState>>;

async function policyApplied(ctx: Ctx, l: Listing, h: Head, receiver: `0x${string}`, version: number) {
  return getLogsChunked(
    ctx.client,
    { address: receiver, event: policyAppliedEvent, args: { version }, fromBlock: l.deployBlock, toBlock: h.number },
    ctx.config.logsMaxRange,
  );
}

async function receiverState(ctx: Ctx, receiver: `0x${string}` | null, h: Head) {
  if (!receiver) return null;
  const rc = { address: receiver, abi: receiverAbi, blockNumber: h.number } as const;
  try {
    const [lp, isStale, sa, ma, st] = await Promise.all([
      ctx.client.readContract({ ...rc, functionName: "latestPolicy" }),
      ctx.client.readContract({ ...rc, functionName: "isStale" }),
      ctx.client.readContract({ ...rc, functionName: "staleAt" }),
      ctx.client.readContract({ ...rc, functionName: "maxAge" }),
      ctx.client.readContract({ ...rc, functionName: "status" }),
    ]);
    return { latestHalted: lp.halted, stale: isStale, staleAt: sa === 0n ? null : sa, maxAge: ma, status: st || null };
  } catch {
    return null; // a policy source that is not a ListingPolicyReceiver (e.g. MockListingPolicy)
  }
}

/** `halted` is the hook's effective flag (report halt OR staleness); `latestHalted` is the stored report's own flag. */
export function haltCauseOf(r: { halted: boolean; latestHalted: boolean | null; stale: boolean; coolingOff: boolean }): HaltCause | null {
  if (r.latestHalted) return "report";
  if (r.stale) return "stale";
  if (r.halted) return "report";
  return r.coolingOff ? "coolingOff" : null;
}

export async function policyView(ctx: Ctx, l: Listing, h: Head, hs?: HookState): Promise<PolicyView> {
  const s = hs ?? (await hookState(ctx, l, h));
  const receiver = receiverOf(l, s.policySource);
  const rs = await receiverState(ctx, receiver, h);

  const eff = s.eff;
  const listingDay = s.phase === "ListingDay";
  const notListed = s.phase === "NotListed";
  const usdc0 = l.usdcIsCurrency0;
  const mode: Mode = eff.halted ? "halted" : listingDay || notListed ? "listing" : (POLICY_MODES[eff.mode] ?? "normal");
  const bandBps = listingDay || notListed ? s.listingDayBandBps : eff.mode === 1 ? eff.survBandBps : eff.normalBandBps;
  const refSqrt = listingDay ? s.listingSqrt : eff.refSqrtPriceX96;
  const referencePointsE2 = refSqrt === 0n ? null : sqrtPriceX96ToPointsE2(refSqrt, usdc0);
  const band = bandOf(s.band, usdc0);

  const version = eff.version;
  const applied = version > 0 && receiver ? (await policyApplied(ctx, l, h, receiver, version)).at(-1) : undefined;
  const appliedTime = applied ? (await blockTimes(ctx.client, [applied.blockNumber])).get(applied.blockNumber) : undefined;
  const coolOff = eff.coolOffUntil > h.timestamp ? eff.coolOffUntil : 0n;
  const haltCause = haltCauseOf({ halted: eff.halted, latestHalted: rs?.latestHalted ?? null, stale: rs?.stale ?? false, coolingOff: coolOff !== 0n });

  return {
    ticker: l.ticker,
    version,
    mode,
    referencePrice: referencePointsE2 === null ? null : pointsE2ToPrice(referencePointsE2),
    referencePoints: referencePointsE2 === null ? null : pointsE2ToPoints(referencePointsE2),
    bandBps,
    halted: eff.halted,
    haltCause,
    tradingOpen: haltCause === null,
    since: appliedTime ? iso(appliedTime) : iso(s.listedAt),
    asOf: iso(eff.asOf),
    coolOffMin: Math.ceil(Number(coolOff === 0n ? 0n : coolOff - h.timestamp) / 60),
    coolOffUntil: iso(coolOff),
    creTx: applied?.transactionHash ?? null,
    hookPhase: s.phase,
    band,
    listingDayEndsAt: iso(s.listingDayEndsAt),
    stale: rs?.stale ?? false,
    staleAt: iso(rs?.staleAt ?? null),
    maxAge: rs ? Number(rs.maxAge) : null,
    policyMode: eff.mode,
    normalBandBps: eff.normalBandBps,
    survBandBps: eff.survBandBps,
    receiver,
    receiverStatus: rs?.status ?? null,
    raw: {
      refSqrtPriceX96: refSqrt.toString(),
      sqrtPriceMinX96: s.band[0] === 0n ? null : s.band[0].toString(),
      sqrtPriceMaxX96: s.band[1] === 0n ? null : s.band[1].toString(),
      asOf: eff.asOf.toString(),
      coolOffUntil: eff.coolOffUntil.toString(),
      staleAt: rs?.staleAt?.toString() ?? null,
      latestHalted: rs?.latestHalted ?? null,
    },
  };
}

/** Display band from the hook's sqrt bounds (`currentBandPointsE2` floors, so 110 points x 0.95 shows 104.49). */
export function bandOf([sqrtMin, sqrtMax]: readonly [bigint, bigint], usdc0: boolean): Band | null {
  if (sqrtMin === 0n && sqrtMax === 0n) return null;
  const a = sqrtPriceX96ToPointsE2(sqrtMin, usdc0);
  const b = sqrtPriceX96ToPointsE2(sqrtMax, usdc0);
  const [lowE2, highE2] = a < b ? [a, b] : [b, a];
  return { low: pointsE2ToPrice(lowE2), high: pointsE2ToPrice(highE2), lowPoints: pointsE2ToPoints(lowE2), highPoints: pointsE2ToPoints(highE2) };
}

/** Pool slot0 + in-range liquidity at `h`. */
export async function poolState(ctx: Ctx, l: Listing, h: Head) {
  const sv = { address: l.external.stateView, abi: stateViewAbi, blockNumber: h.number } as const;
  const [slot0, liquidity] = await Promise.all([
    ctx.client.readContract({ ...sv, functionName: "getSlot0", args: [l.poolId] }),
    ctx.client.readContract({ ...sv, functionName: "getLiquidity", args: [l.poolId] }),
  ]);
  return { sqrtPriceX96: slot0[0], tick: slot0[1], liquidity };
}

export async function marketView(ctx: Ctx, l: Listing, h: Head, opts: { limit: number } = { limit: 100 }): Promise<MarketView> {
  const s = await hookState(ctx, l, h);
  const receiver = receiverOf(l, s.policySource);
  const [policy, pool, logs, swaps] = await Promise.all([
    policyView(ctx, l, h, s),
    poolState(ctx, l, h),
    policyLogs(ctx, l, h, receiver),
    swapsView(ctx, l, h, { limit: opts.limit }),
  ]);
  const { sqrtPriceX96, tick, liquidity } = pool;
  const history = historyFrom(l, h, receiver, policy.maxAge === null ? null : BigInt(policy.maxAge), logs);
  const pointsE2 = sqrtPriceX96ToPointsE2(sqrtPriceX96, l.usdcIsCurrency0);
  const amounts = fullRangeAmounts(liquidity, sqrtPriceX96);
  const usdc0 = l.usdcIsCurrency0;
  const listingPointsE2 = s.listingSqrt === 0n ? null : sqrtPriceX96ToPointsE2(s.listingSqrt, usdc0);
  return {
    ticker: l.ticker,
    listed: s.listed,
    hookPhase: s.phase,
    mode: policy.mode,
    usdcIsCurrency0: usdc0,
    price: s.listed ? pointsE2ToPrice(pointsE2) : null,
    points: s.listed ? pointsE2ToPoints(pointsE2) : null,
    referencePrice: s.listed ? policy.referencePrice : null,
    referencePoints: s.listed ? policy.referencePoints : null,
    band: policy.band,
    halted: policy.halted,
    haltCause: policy.haltCause,
    tradingOpen: policy.tradingOpen,
    listingPrice: listingPointsE2 === null ? null : pointsE2ToPrice(listingPointsE2),
    listedAt: s.listed ? iso(s.listedAt) : null,
    listingDayEndsAt: iso(s.listingDayEndsAt),
    policy,
    liquidity: {
      usdc: usdc(usdc0 ? amounts.amount0 : amounts.amount1),
      shares: shares(usdc0 ? amounts.amount1 : amounts.amount0),
    },
    rejected: [],
    events: marketEvents(l, logs),
    trades: swaps.trades,
    prices: swaps.prices,
    tradesLimit: opts.limit,
    reference: history.reference,
    haltSpans: history.haltSpans,
    poolId: l.poolId,
    poolKey: l.poolKey,
    raw: {
      sqrtPriceX96: s.listed ? sqrtPriceX96.toString() : null,
      tick: s.listed ? tick : null,
      liquidity: s.listed ? liquidity.toString() : null,
      pointsE2: s.listed ? s.pointsE2.toString() : null,
      bandPointsE2: s.bandE2[0] === 0n && s.bandE2[1] === 0n ? null : [s.bandE2[0].toString(), s.bandE2[1].toString()],
    },
  };
}

/** Circuit timeline: the `Listed` event, then every `PolicyApplied` (mock `MarketEvent`). */
function marketEvents(l: Listing, logs: PolicyLogs): MarketEvent[] {
  const { listedLogs, appliedLogs: applied, times } = logs;
  const usdc0 = l.usdcIsCurrency0;
  const events: MarketEvent[] = [];
  for (const e of listedLogs) {
    const price = sqrtPriceX96ToPrice(e.args.listingSqrtPriceX96, usdc0);
    events.push({ time: iso(times.get(e.blockNumber)) ?? "", kind: "listing", label: `Listed at ${formatLot(price)} · ±${l.listingDayBandBps / 100}% band`, tx: e.transactionHash, block: Number(e.blockNumber) });
  }
  let prevRef: bigint | null = null;
  for (const e of applied) {
    const p = e.args.policy;
    const ref = p.refSqrtPriceX96;
    const refText = ref === 0n ? "listing price" : formatLot(sqrtPriceX96ToPrice(ref, usdc0));
    let kind: MarketEvent["kind"];
    let label: string;
    if (p.halted) [kind, label] = ["halted", "Halted"];
    else if (p.mode === 1) [kind, label] = ["surveillance", `Surveillance ±${(p.survBandBps || 500) / 100}% · ref ${refText}`];
    else if (p.mode === 2) [kind, label] = ["directional", `Directional · only trades toward ref ${refText}`];
    else if (prevRef !== null && ref !== prevRef) [kind, label] = ["reference", `Reference ${refText}`];
    else [kind, label] = ["normal", `Normal ±${(p.normalBandBps || 2000) / 100}% · ref ${refText}`];
    prevRef = ref;
    events.push({ time: iso(times.get(e.blockNumber)) ?? "", kind, label: `v${e.args.version} ${label}`, tx: e.transactionHash, block: Number(e.blockNumber) });
  }
  return events.sort((a, b) => a.block - b.block);
}

export async function swapsView(ctx: Ctx, l: Listing, h: Head, opts: { limit: number; fromBlock?: bigint }): Promise<SwapsResponse> {
  const logs = await getLogsChunked(
    ctx.client,
    { address: l.external.poolManager, event: swapEvent, args: { id: l.poolId }, fromBlock: opts.fromBlock ?? l.deployBlock, toBlock: h.number },
    ctx.config.logsMaxRange,
  );
  const recent = logs.slice(-opts.limit);
  const times = await blockTimes(ctx.client, recent.map((x) => x.blockNumber));
  const usdc0 = l.usdcIsCurrency0;
  const trades: Trade[] = recent.map((e) => {
    // PoolManager emits the swapper's balance delta: negative = paid into the pool.
    const usdcDelta = usdc0 ? e.args.amount0 : e.args.amount1;
    const shareDelta = usdc0 ? e.args.amount1 : e.args.amount0;
    const abs = (x: bigint) => (x < 0n ? -x : x);
    const u = usdc(abs(usdcDelta));
    const sh = shares(abs(shareDelta));
    return {
      time: Number(times.get(e.blockNumber) ?? 0n),
      side: usdcDelta < 0n ? "buy" : "sell",
      usdc: u,
      shares: sh,
      price: sqrtPriceX96ToPrice(e.args.sqrtPriceX96, usdc0),
      avgPrice: sh > 0 ? round((u / sh) * 1000, 4) : 0,
      tx: e.transactionHash,
      block: Number(e.blockNumber),
      sender: getAddress(e.args.sender),
      raw: {
        amount0: e.args.amount0.toString(),
        amount1: e.args.amount1.toString(),
        sqrtPriceX96: e.args.sqrtPriceX96.toString(),
        tick: e.args.tick,
        liquidity: e.args.liquidity.toString(),
      },
    };
  });
  const prices = trades.map((t) => ({ time: t.time, value: t.price, block: t.block }));
  return { ticker: l.ticker, poolId: l.poolId, trades: [...trades].reverse(), prices };
}
