/**
 * Structured policy history: every `PolicyApplied` report plus the effective rules over time, rebuilt with the same
 * rules `ListingHook` applies at swap time (listing-day band override, 0-band defaults, receiver staleness, cool-off).
 * `buildPolicyTimeline` is pure; `policyLogs` fetches its inputs.
 */
import { getAbiItem, getAddress, type Address, type Hex } from "viem";

import { listingHookAbi, receiverAbi } from "../abis.ts";
import { blockTimes, getLogsChunked } from "../chain.ts";
import type { Listing } from "../config.ts";
import type { Ctx, Head } from "../context.ts";
import type { Band, HaltCause, HaltSpan, Mode, PolicyHistory, PolicyHistoryEntry, PolicySpan, RefPoint, TradingMode } from "../types.ts";
import { bandBounds, iso, pointsE2ToPoints, pointsE2ToPrice, sqrtPriceX96ToPointsE2 } from "../units.ts";

const DEFAULT_NORMAL_BAND_BPS = 2000;
const DEFAULT_SURVEILLANCE_BAND_BPS = 500;
const POLICY_MODES: TradingMode[] = ["normal", "surveillance", "directional"];

const policyAppliedEvent = getAbiItem({ abi: receiverAbi, name: "PolicyApplied" });
const maxAgeSetEvent = getAbiItem({ abi: receiverAbi, name: "MaxAgeSet" });
const listedEvent = getAbiItem({ abi: listingHookAbi, name: "Listed" });

export type ReportedPolicy = {
  asOf: bigint;
  refSqrtPriceX96: bigint;
  normalBandBps: number;
  survBandBps: number;
  mode: number;
  halted: boolean;
  coolOffUntil: bigint;
};
export type AppliedLog = { version: number; block: bigint; time: bigint; tx: Hex; policy: ReportedPolicy; status: string };
export type ListedLog = { block: bigint; time: bigint; tx: Hex; listingSqrtPriceX96: bigint; listingDayEndsAt: bigint };
export type MaxAgeLog = { block: bigint; time: bigint; maxAge: bigint };

export type TimelineInput = {
  usdcIsCurrency0: boolean;
  listingDayBandBps: number;
  listed: ListedLog | null;
  /** Oldest first. */
  applied: AppliedLog[];
  /** Oldest first; the constructor emits the first one. */
  maxAges: MaxAgeLog[];
  /** Used when no `MaxAgeSet` precedes a point (e.g. logs out of range); null = never stale. */
  fallbackMaxAge: bigint | null;
  now: bigint;
};

export type Timeline = Pick<PolicyHistory, "entries" | "spans" | "haltSpans" | "reference">;

const ZERO_POLICY: ReportedPolicy = { asOf: 0n, refSqrtPriceX96: 0n, normalBandBps: 0, survBandBps: 0, mode: 0, halted: false, coolOffUntil: 0n };

function band(sqrtMin: bigint, sqrtMax: bigint, usdc0: boolean): Band {
  const a = sqrtPriceX96ToPointsE2(sqrtMin, usdc0);
  const b = sqrtPriceX96ToPointsE2(sqrtMax, usdc0);
  const [lowE2, highE2] = a < b ? [a, b] : [b, a];
  return { low: pointsE2ToPrice(lowE2), high: pointsE2ToPrice(highE2), lowPoints: pointsE2ToPoints(lowE2), highPoints: pointsE2ToPoints(highE2) };
}

const validBand = (bps: number, dflt: number) => (bps === 0 || bps >= 10_000 ? dflt : bps);

type State = {
  version: number;
  applied: AppliedLog | null;
  tradingMode: TradingMode;
  halted: boolean;
  coolingOff: boolean;
  haltCause: HaltCause | null;
  refSqrt: bigint;
  bandBps: number;
  sqrtMin: bigint;
  sqrtMax: bigint;
  directionalBandBps: number | null;
  listingDayOverride: boolean;
};

/** The hook's view at time `t` (`_readPolicy` + `_effectivePolicy` + the listing-day branch of `_afterSwap`). */
function stateAt(t: bigint, input: TimelineInput, listed: ListedLog): State {
  const applied = [...input.applied].reverse().find((a) => a.time <= t) ?? null;
  const p = applied?.policy ?? ZERO_POLICY;
  const version = applied?.version ?? 0;
  const maxAge = [...input.maxAges].reverse().find((m) => m.time <= t)?.maxAge ?? input.fallbackMaxAge;
  const stale = version !== 0 && maxAge !== null && t > p.asOf + maxAge;
  const halted = p.halted || stale;
  const coolingOff = t < p.coolOffUntil;
  const listingDay = t < listed.listingDayEndsAt;
  const mode = p.mode > 2 ? 0 : p.mode;
  const normal = validBand(p.normalBandBps, DEFAULT_NORMAL_BAND_BPS);
  const surv = validBand(p.survBandBps, DEFAULT_SURVEILLANCE_BAND_BPS);
  const ref = p.refSqrtPriceX96 === 0n ? listed.listingSqrtPriceX96 : p.refSqrtPriceX96;
  const [refSqrt, bandBps] = listingDay ? [listed.listingSqrtPriceX96, input.listingDayBandBps] : [ref, mode === 1 ? surv : normal];
  const [sqrtMin, sqrtMax] = bandBounds(refSqrt, bandBps, input.usdcIsCurrency0);
  return {
    version,
    applied,
    tradingMode: listingDay ? "listing" : (POLICY_MODES[mode] ?? "normal"),
    halted,
    coolingOff,
    haltCause: p.halted ? "report" : stale ? "stale" : coolingOff ? "coolingOff" : null,
    refSqrt,
    bandBps,
    sqrtMin,
    sqrtMax,
    directionalBandBps: !listingDay && mode === 2 ? surv : null,
    listingDayOverride: listingDay,
  };
}

const sameRules = (a: State, b: State) =>
  a.version === b.version &&
  a.tradingMode === b.tradingMode &&
  a.halted === b.halted &&
  a.coolingOff === b.coolingOff &&
  a.haltCause === b.haltCause &&
  a.refSqrt === b.refSqrt &&
  a.bandBps === b.bandBps &&
  a.directionalBandBps === b.directionalBandBps;

function displayMode(s: State): Mode {
  return s.halted ? "halted" : s.tradingMode;
}

export function buildPolicyTimeline(input: TimelineInput): Timeline {
  const usdc0 = input.usdcIsCurrency0;
  const price = (sqrt: bigint) => sqrtPriceX96ToPointsE2(sqrt, usdc0);
  const entries: PolicyHistoryEntry[] = input.applied.map((a, i) => {
    const p = a.policy;
    const next = input.applied[i + 1];
    const maxAge = [...input.maxAges].reverse().find((m) => m.time <= a.time)?.maxAge ?? input.fallbackMaxAge;
    const refE2 = p.refSqrtPriceX96 === 0n ? null : price(p.refSqrtPriceX96);
    const eff = input.listed && a.time >= input.listed.time ? stateAt(a.time, input, input.listed) : null;
    const mode = p.mode > 2 ? 0 : p.mode;
    return {
      version: a.version,
      block: Number(a.block),
      time: iso(a.time) ?? "",
      timestamp: Number(a.time),
      tx: a.tx,
      status: a.status,
      asOf: iso(p.asOf) ?? "",
      mode: POLICY_MODES[mode] ?? "normal",
      policyMode: p.mode,
      halted: p.halted,
      coolOffUntil: iso(p.coolOffUntil),
      referencePrice: refE2 === null ? null : pointsE2ToPrice(refE2),
      referencePoints: refE2 === null ? null : pointsE2ToPoints(refE2),
      normalBandBps: p.normalBandBps,
      survBandBps: p.survBandBps,
      staleAt: maxAge === null ? null : iso(p.asOf + maxAge + 1n),
      supersededAt: next ? iso(next.time) : null,
      effective: eff
        ? {
            mode: displayMode(eff),
            tradingMode: eff.tradingMode,
            referencePrice: pointsE2ToPrice(price(eff.refSqrt)),
            bandBps: eff.bandBps,
            band: band(eff.sqrtMin, eff.sqrtMax, usdc0),
            directionalBandBps: eff.directionalBandBps,
            listingDayOverride: eff.listingDayOverride,
          }
        : null,
      raw: { refSqrtPriceX96: p.refSqrtPriceX96.toString(), asOf: p.asOf.toString(), coolOffUntil: p.coolOffUntil.toString() },
    };
  });

  const listed = input.listed;
  if (!listed || input.now < listed.time) return { entries, spans: [], haltSpans: [], reference: [] };

  // Every instant the effective rules can change, from the listing to now.
  const ages = new Set<bigint>([...input.maxAges.map((m) => m.maxAge), ...(input.fallbackMaxAge === null ? [] : [input.fallbackMaxAge])]);
  const candidates: bigint[] = [listed.time, listed.listingDayEndsAt];
  for (const a of input.applied) {
    candidates.push(a.time);
    if (a.policy.coolOffUntil > 0n) candidates.push(a.policy.coolOffUntil);
    for (const m of ages) candidates.push(a.policy.asOf + m + 1n);
  }
  for (const m of input.maxAges) candidates.push(m.time);
  const boundaries = [...new Set(candidates.filter((t) => t >= listed.time && t <= input.now))].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));

  const trigger = (t: bigint): { trigger: PolicySpan["trigger"]; tx: Hex | null; block: number | null } => {
    if (t === listed.time) return { trigger: "listed", tx: listed.tx, block: Number(listed.block) };
    const a = [...input.applied].reverse().find((x) => x.time === t);
    if (a) return { trigger: "policyApplied", tx: a.tx, block: Number(a.block) };
    if (t === listed.listingDayEndsAt) return { trigger: "listingDayEnded", tx: null, block: null };
    if (input.maxAges.some((m) => m.time === t)) return { trigger: "maxAgeSet", tx: null, block: null };
    if (input.applied.some((x) => x.policy.coolOffUntil === t)) return { trigger: "coolOffEnded", tx: null, block: null };
    return { trigger: "stale", tx: null, block: null };
  };

  const segments: { from: bigint; state: State }[] = [];
  for (const t of boundaries) {
    const state = stateAt(t, input, listed);
    const last = segments.at(-1);
    if (last && sameRules(last.state, state)) continue;
    segments.push({ from: t, state });
  }

  const spans: PolicySpan[] = segments.map((seg, i) => {
    const s = seg.state;
    const to = segments[i + 1]?.from ?? null;
    const refE2 = price(s.refSqrt);
    return {
      from: iso(seg.from) ?? "",
      to: to === null ? null : iso(to),
      fromTime: Number(seg.from),
      toTime: to === null ? null : Number(to),
      ...trigger(seg.from),
      version: s.version,
      mode: displayMode(s),
      tradingMode: s.tradingMode,
      halted: s.halted,
      coolingOff: s.coolingOff,
      tradingOpen: !s.halted && !s.coolingOff,
      haltCause: s.haltCause,
      referencePrice: pointsE2ToPrice(refE2),
      referencePoints: pointsE2ToPoints(refE2),
      bandBps: s.bandBps,
      band: band(s.sqrtMin, s.sqrtMax, usdc0),
      directionalBandBps: s.directionalBandBps,
      raw: { refSqrtPriceX96: s.refSqrt.toString(), sqrtPriceMinX96: s.sqrtMin.toString(), sqrtPriceMaxX96: s.sqrtMax.toString() },
    };
  });

  const haltSpans: HaltSpan[] = [];
  for (const s of spans) {
    if (s.tradingOpen || s.haltCause === null) continue;
    const prev = haltSpans.at(-1);
    if (prev && prev.toTime === s.fromTime && prev.cause === s.haltCause) {
      prev.to = s.to;
      prev.toTime = s.toTime;
      continue;
    }
    haltSpans.push({ from: s.from, to: s.to, fromTime: s.fromTime, toTime: s.toTime, cause: s.haltCause, version: s.version, tx: s.tx });
  }

  const reference: RefPoint[] = spans.map((s) => ({
    time: s.fromTime,
    value: s.referencePrice,
    mode: s.mode,
    bandBps: s.bandBps,
    low: s.band.low,
    high: s.band.high,
    version: s.version,
    carryForward: false,
  }));
  const last = reference.at(-1);
  if (last && BigInt(last.time) < input.now) reference.push({ ...last, time: Number(input.now), carryForward: true });

  return { entries, spans, haltSpans, reference };
}

/** The hook's policy source if it is the deployment's receiver (or any non-zero source), else null. */
export function receiverOf(l: Listing, policySource: Address): Address | null {
  if (/^0x0{40}$/i.test(policySource)) return null;
  const src = getAddress(policySource);
  return l.receiver && src === l.receiver ? l.receiver : src;
}

/** `Listed`, `PolicyApplied` and `MaxAgeSet` logs with block times (inputs of `buildPolicyTimeline`). */
export async function policyLogs(ctx: Ctx, l: Listing, h: Head, receiver: Address | null) {
  const range = { fromBlock: l.deployBlock, toBlock: h.number };
  const max = ctx.config.logsMaxRange;
  const [listedLogs, appliedLogs, maxAgeLogs] = await Promise.all([
    getLogsChunked(ctx.client, { address: l.hook, event: listedEvent, ...range }, max),
    receiver ? getLogsChunked(ctx.client, { address: receiver, event: policyAppliedEvent, ...range }, max) : Promise.resolve([]),
    receiver ? getLogsChunked(ctx.client, { address: receiver, event: maxAgeSetEvent, ...range }, max) : Promise.resolve([]),
  ]);
  const times = await blockTimes(ctx.client, [...listedLogs, ...appliedLogs, ...maxAgeLogs].map((x) => x.blockNumber));
  const time = (b: bigint) => times.get(b) ?? 0n;
  const first = listedLogs[0];
  const listed: ListedLog | null = first
    ? { block: first.blockNumber, time: time(first.blockNumber), tx: first.transactionHash, listingSqrtPriceX96: first.args.listingSqrtPriceX96, listingDayEndsAt: first.args.listingDayEndsAt }
    : null;
  const applied: AppliedLog[] = appliedLogs.map((e) => ({
    version: e.args.version,
    block: e.blockNumber,
    time: time(e.blockNumber),
    tx: e.transactionHash,
    status: e.args.status,
    policy: {
      asOf: e.args.policy.asOf,
      refSqrtPriceX96: e.args.policy.refSqrtPriceX96,
      normalBandBps: e.args.policy.normalBandBps,
      survBandBps: e.args.policy.survBandBps,
      mode: e.args.policy.mode,
      halted: e.args.policy.halted,
      coolOffUntil: e.args.policy.coolOffUntil,
    },
  }));
  const maxAges: MaxAgeLog[] = maxAgeLogs.map((e) => ({ block: e.blockNumber, time: time(e.blockNumber), maxAge: e.args.maxAge }));
  return { listed, applied, maxAges, listedLogs, appliedLogs, times };
}

export type PolicyLogs = Awaited<ReturnType<typeof policyLogs>>;

export const HISTORY_NOTES = [
  "Spans apply ListingHook's rules: the listing-day band overrides the policy band until listingDayEndsAt; halts and cool-offs apply even then.",
  "halted includes receiver staleness (report older than maxAge); haltCause tells them apart. Cool-off blocks swaps without setting halted.",
  "Times are block times; a swap in the same block as a PolicyApplied may have run under the previous rules.",
  "Only the hook's current policy source is read; an earlier setPolicySource is not replayed.",
];

export async function policyHistory(ctx: Ctx, l: Listing, h: Head): Promise<PolicyHistory> {
  const policySource = await ctx.client.readContract({ address: l.hook, abi: listingHookAbi, functionName: "policySource", blockNumber: h.number });
  const receiver = receiverOf(l, policySource);
  let maxAge: bigint | null = null;
  if (receiver) {
    try {
      maxAge = await ctx.client.readContract({ address: receiver, abi: receiverAbi, functionName: "maxAge", blockNumber: h.number });
    } catch {
      // not a ListingPolicyReceiver (e.g. MockListingPolicy): never stale
    }
  }
  const logs = await policyLogs(ctx, l, h, receiver);
  return historyFrom(l, h, receiver, maxAge, logs);
}

export function historyFrom(l: Listing, h: Head, receiver: Address | null, maxAge: bigint | null, logs: PolicyLogs): PolicyHistory {
  const timeline = buildPolicyTimeline({
    usdcIsCurrency0: l.usdcIsCurrency0,
    listingDayBandBps: l.listingDayBandBps,
    listed: logs.listed,
    applied: logs.applied,
    maxAges: logs.maxAges,
    fallbackMaxAge: maxAge,
    now: h.timestamp,
  });
  const listed = logs.listed;
  let listing: PolicyHistory["listing"] = null;
  if (listed) {
    const e2 = sqrtPriceX96ToPointsE2(listed.listingSqrtPriceX96, l.usdcIsCurrency0);
    const [lo, hi] = bandBounds(listed.listingSqrtPriceX96, l.listingDayBandBps, l.usdcIsCurrency0);
    listing = {
      listedAt: iso(listed.time) ?? "",
      block: Number(listed.block),
      tx: listed.tx,
      listingPrice: pointsE2ToPrice(e2),
      listingPoints: pointsE2ToPoints(e2),
      listingDayEndsAt: iso(listed.listingDayEndsAt) ?? "",
      bandBps: l.listingDayBandBps,
      band: band(lo, hi, l.usdcIsCurrency0),
    };
  }
  return {
    ticker: l.ticker,
    hook: l.hook,
    receiver,
    now: iso(h.timestamp) ?? "",
    currentBlock: Number(h.number),
    maxAge: maxAge === null ? null : Number(maxAge),
    listing,
    ...timeline,
    notes: HISTORY_NOTES,
  };
}
