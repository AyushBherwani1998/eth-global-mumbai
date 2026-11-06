import { getAbiItem, getAddress } from "viem";

import { listingHookAbi, poolManagerAbi, receiverAbi, stateViewAbi } from "../abis.ts";
import { blockTimes, getLogsChunked } from "../chain.ts";
import type { Listing } from "../config.ts";
import type { Ctx, Head } from "../context.ts";
import type { Band, HookPhase, MarketEvent, MarketView, Mode, PolicyView, SwapsResponse, Trade } from "../types.ts";
import { fullRangeAmounts, iso, pointsE2ToPoints, pointsE2ToPrice, shares, sqrtPriceX96ToPointsE2, sqrtPriceX96ToPrice, usdc } from "../units.ts";

const HOOK_PHASES: HookPhase[] = ["NotListed", "ListingDay", "Normal"];
const POLICY_MODES: Mode[] = ["normal", "surveillance", "directional"];

const policyAppliedEvent = getAbiItem({ abi: receiverAbi, name: "PolicyApplied" });
const listedEvent = getAbiItem({ abi: listingHookAbi, name: "Listed" });
const swapEvent = getAbiItem({ abi: poolManagerAbi, name: "Swap" });

function lotFixed(n: number): string {
  return n.toFixed(n * 100 === Math.round(n * 100) ? 2 : 3);
}

async function hookState(ctx: Ctx, l: Listing, h: Head) {
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

async function policyApplied(ctx: Ctx, l: Listing, h: Head, version?: number) {
  if (!l.receiver) return [];
  return getLogsChunked(
    ctx.client,
    { address: l.receiver, event: policyAppliedEvent, args: version === undefined ? undefined : { version }, fromBlock: l.deployBlock, toBlock: h.number },
    ctx.config.logsMaxRange,
  );
}

export async function policyView(ctx: Ctx, l: Listing, h: Head, hs?: HookState): Promise<PolicyView> {
  const s = hs ?? (await hookState(ctx, l, h));
  const receiver = l.receiver && getAddress(s.policySource) === l.receiver ? l.receiver : /^0x0{40}$/i.test(s.policySource) ? null : getAddress(s.policySource);
  let latest: { asOf: bigint; halted: boolean; version: number } | null = null;
  let stale = false;
  let staleAt: bigint | null = null;
  let maxAge: bigint | null = null;
  let receiverStatus: string | null = null;
  if (receiver) {
    const rc = { address: receiver, abi: receiverAbi, blockNumber: h.number } as const;
    try {
      const [lp, isStale, sa, ma, st] = await Promise.all([
        ctx.client.readContract({ ...rc, functionName: "latestPolicy" }),
        ctx.client.readContract({ ...rc, functionName: "isStale" }),
        ctx.client.readContract({ ...rc, functionName: "staleAt" }),
        ctx.client.readContract({ ...rc, functionName: "maxAge" }),
        ctx.client.readContract({ ...rc, functionName: "status" }),
      ]);
      latest = { asOf: lp.asOf, halted: lp.halted, version: lp.version };
      stale = isStale;
      staleAt = sa === 0n ? null : sa;
      maxAge = ma;
      receiverStatus = st || null;
    } catch {
      // a policy source that is not a ListingPolicyReceiver (e.g. MockListingPolicy)
    }
  }

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
  const applied = version > 0 ? (await policyApplied(ctx, l, h, version)).at(-1) : undefined;
  const appliedTime = applied ? (await blockTimes(ctx.client, [applied.blockNumber])).get(applied.blockNumber) : undefined;
  const coolOff = eff.coolOffUntil > h.timestamp ? eff.coolOffUntil : 0n;

  return {
    ticker: l.ticker,
    version,
    mode,
    referencePrice: referencePointsE2 === null ? null : pointsE2ToPrice(referencePointsE2),
    referencePoints: referencePointsE2 === null ? null : pointsE2ToPoints(referencePointsE2),
    bandBps,
    halted: eff.halted,
    since: appliedTime ? iso(appliedTime) : iso(s.listedAt),
    asOf: iso(eff.asOf),
    coolOffMin: Math.ceil(Number(coolOff === 0n ? 0n : coolOff - h.timestamp) / 60),
    coolOffUntil: iso(coolOff),
    creTx: applied?.transactionHash ?? null,
    hookPhase: s.phase,
    band,
    listingDayEndsAt: iso(s.listingDayEndsAt),
    stale,
    staleAt: iso(staleAt),
    maxAge: maxAge === null ? null : Number(maxAge),
    policyMode: eff.mode,
    normalBandBps: eff.normalBandBps,
    survBandBps: eff.survBandBps,
    receiver,
    receiverStatus,
    raw: {
      refSqrtPriceX96: refSqrt.toString(),
      sqrtPriceMinX96: s.band[0] === 0n ? null : s.band[0].toString(),
      sqrtPriceMaxX96: s.band[1] === 0n ? null : s.band[1].toString(),
      asOf: eff.asOf.toString(),
      coolOffUntil: eff.coolOffUntil.toString(),
      staleAt: staleAt?.toString() ?? null,
      latestHalted: latest?.halted ?? null,
    },
  };
}

/** Display band from the hook's sqrt bounds (`currentBandPointsE2` floors, so 110 points x 0.95 shows 104.49). */
function bandOf([sqrtMin, sqrtMax]: readonly [bigint, bigint], usdc0: boolean): Band | null {
  if (sqrtMin === 0n && sqrtMax === 0n) return null;
  const a = sqrtPriceX96ToPointsE2(sqrtMin, usdc0);
  const b = sqrtPriceX96ToPointsE2(sqrtMax, usdc0);
  const [lowE2, highE2] = a < b ? [a, b] : [b, a];
  return { low: pointsE2ToPrice(lowE2), high: pointsE2ToPrice(highE2), lowPoints: pointsE2ToPoints(lowE2), highPoints: pointsE2ToPoints(highE2) };
}

export async function marketView(ctx: Ctx, l: Listing, h: Head): Promise<MarketView> {
  const s = await hookState(ctx, l, h);
  const sv = { address: l.external.stateView, abi: stateViewAbi, blockNumber: h.number } as const;
  const [policy, slot0, liquidity, events] = await Promise.all([
    policyView(ctx, l, h, s),
    ctx.client.readContract({ ...sv, functionName: "getSlot0", args: [l.poolId] }),
    ctx.client.readContract({ ...sv, functionName: "getLiquidity", args: [l.poolId] }),
    marketEvents(ctx, l, h),
  ]);
  const [sqrtPriceX96, tick] = slot0;
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
    band: policy.band,
    listingPrice: listingPointsE2 === null ? null : pointsE2ToPrice(listingPointsE2),
    listedAt: s.listed ? iso(s.listedAt) : null,
    listingDayEndsAt: iso(s.listingDayEndsAt),
    policy,
    liquidity: {
      usdc: usdc(usdc0 ? amounts.amount0 : amounts.amount1),
      shares: shares(usdc0 ? amounts.amount1 : amounts.amount0),
    },
    rejected: [],
    events,
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
async function marketEvents(ctx: Ctx, l: Listing, h: Head): Promise<MarketEvent[]> {
  const [listedLogs, applied] = await Promise.all([
    getLogsChunked(ctx.client, { address: l.hook, event: listedEvent, fromBlock: l.deployBlock, toBlock: h.number }, ctx.config.logsMaxRange),
    policyApplied(ctx, l, h),
  ]);
  const times = await blockTimes(ctx.client, [...listedLogs, ...applied].map((x) => x.blockNumber));
  const usdc0 = l.usdcIsCurrency0;
  const events: MarketEvent[] = [];
  for (const e of listedLogs) {
    const price = sqrtPriceX96ToPrice(e.args.listingSqrtPriceX96, usdc0);
    events.push({ time: iso(times.get(e.blockNumber)) ?? "", kind: "listing", label: `Listed at ${lotFixed(price)} · ±${l.listingDayBandBps / 100}% band`, tx: e.transactionHash, block: Number(e.blockNumber) });
  }
  let prevRef: bigint | null = null;
  for (const e of applied) {
    const p = e.args.policy;
    const ref = p.refSqrtPriceX96;
    const refText = ref === 0n ? "listing price" : lotFixed(sqrtPriceX96ToPrice(ref, usdc0));
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
    return {
      time: Number(times.get(e.blockNumber) ?? 0n),
      side: usdcDelta < 0n ? "buy" : "sell",
      usdc: usdc(abs(usdcDelta)),
      shares: shares(abs(shareDelta)),
      price: sqrtPriceX96ToPrice(e.args.sqrtPriceX96, usdc0),
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
  const prices = trades.map((t) => ({ time: t.time, value: t.price }));
  return { ticker: l.ticker, poolId: l.poolId, trades: [...trades].reverse(), prices };
}
