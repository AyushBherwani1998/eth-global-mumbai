import { getAddress, isAddress, type Address } from "viem";
import { normalize } from "viem/ens";

import { listingHookAbi, mockSmeAbi, receiverAbi } from "../abis.ts";
import type { Listing as ListingCfg } from "../config.ts";
import type { Ctx, Head } from "../context.ts";
import type { EnsStatus, EnsView, Listing, ListingDetail, Phase } from "../types.ts";
import { iso, q96ToPoints, q96ToPrice, usdc } from "../units.ts";
import { auctionState, offer, submittedBids } from "./auction.ts";

export const ENS_TEXT_KEYS = [
  "listingday.auction",
  "listingday.pool",
  "listingday.hook",
  "listingday.policy",
  "listingday.status",
  "listingday.eligibility",
  "description",
  "url",
  "avatar",
] as const;

const STATUSES: EnsStatus[] = ["draft", "auction", "listed", "surveillance", "halted"];
const PALETTE = [
  ["#1f6feb", "#ffffff"],
  ["#f59e0b", "#ffffff"],
  ["#0f766e", "#ffffff"],
  ["#7c3aed", "#ffffff"],
  ["#db2777", "#ffffff"],
  ["#475569", "#ffffff"],
] as const;

async function ensText(ctx: Ctx, l: ListingCfg, key: string): Promise<string | null> {
  try {
    const v = await ctx.client.getEnsText({ name: normalize(l.ensName), key, universalResolverAddress: l.external.ensUniversalResolver });
    return v ? v : null;
  } catch {
    return null; // ResolverNotFound (ticker not registered yet), resolver errors
  }
}

export async function ensAddr(ctx: Ctx, l: ListingCfg): Promise<Address | null> {
  try {
    const v = await ctx.client.getEnsAddress({ name: normalize(l.ensName), universalResolverAddress: l.external.ensUniversalResolver });
    return v && !/^0x0{40}$/i.test(v) ? getAddress(v) : null;
  } catch {
    return null;
  }
}

export async function ensView(ctx: Ctx, l: ListingCfg): Promise<EnsView> {
  let error: string | null = null;
  const [addr, ...texts] = await Promise.all([ensAddr(ctx, l), ...ENS_TEXT_KEYS.map((k) => ensText(ctx, l, k))]);
  const records = Object.fromEntries(ENS_TEXT_KEYS.map((k, i) => [k, texts[i] ?? null])) as Omit<EnsView["records"], "addr">;
  const resolved = addr !== null || texts.some((t) => t !== null);
  if (!resolved) error = `${l.ensName} does not resolve (not registered yet, or no records): run make ens-sepolia`;
  const same = (v: string | null, expected: string | null) => (v === null || expected === null ? null : v.toLowerCase() === expected.toLowerCase());
  return {
    ticker: l.ticker,
    name: l.ensName,
    universalResolver: l.external.ensUniversalResolver,
    records: { addr, ...records },
    matchesDeployment: {
      addr: same(addr, l.token),
      auction: same(records["listingday.auction"], l.auction),
      pool: same(records["listingday.pool"], l.poolId),
      hook: same(records["listingday.hook"], l.hook),
      policy: same(policyAddress(records["listingday.policy"]), l.receiver),
    },
    resolved,
    error,
  };
}

/** `eip155:<chainId>:<address>` (or a bare address) to the address. */
export function policyAddress(v: string | null): Address | null {
  if (!v) return null;
  const last = v.split(":").at(-1) ?? "";
  return isAddress(last) ? getAddress(last) : null;
}

export async function listingSummary(ctx: Ctx, l: ListingCfg, h: Head): Promise<Listing> {
  const r = ctx.client;
  const hook = { address: l.hook, abi: listingHookAbi, blockNumber: h.number } as const;
  const [a, bids, name, symbol, listed, listedAt, policy, receiverStatus, ensStatus, eligibility, description, url, avatar, ensAddress] =
    await Promise.all([
      auctionState(ctx, l, h),
      submittedBids(ctx, l, h),
      r.readContract({ address: l.token, abi: mockSmeAbi, functionName: "name", blockNumber: h.number }),
      r.readContract({ address: l.token, abi: mockSmeAbi, functionName: "symbol", blockNumber: h.number }),
      r.readContract({ ...hook, functionName: "listed" }),
      r.readContract({ ...hook, functionName: "listedAt" }),
      r.readContract({ ...hook, functionName: "effectivePolicy" }),
      l.receiver
        ? r.readContract({ address: l.receiver, abi: receiverAbi, functionName: "status", blockNumber: h.number }).catch(() => "")
        : Promise.resolve(""),
      ensText(ctx, l, "listingday.status"),
      ensText(ctx, l, "listingday.eligibility"),
      ensText(ctx, l, "description"),
      ensText(ctx, l, "url"),
      ensText(ctx, l, "avatar"),
      ensAddr(ctx, l),
    ]);

  let phase: Phase;
  if (listed) phase = "listed";
  else if (!a || h.number < a.startBlock) phase = "draft";
  else if (h.number < a.endBlock) phase = "live";
  else phase = a.graduated ? "cleared" : "refunding";

  const derived: EnsStatus = listed ? (policy.halted ? "halted" : policy.mode !== 0 ? "surveillance" : "listed") : a ? "auction" : "draft";
  const asStatus = (s: string | null) => (s && (STATUSES as string[]).includes(s) ? (s as EnsStatus) : null);
  const fromEns = asStatus(ensStatus);
  const fromReceiver = asStatus(receiverStatus);
  const status = fromEns ?? fromReceiver ?? derived;

  const [bg, fg] = PALETTE[[...l.ticker].reduce((s, ch) => s + ch.charCodeAt(0), 0) % PALETTE.length] ?? PALETTE[0];
  return {
    ticker: l.ticker,
    symbol,
    name,
    ensName: l.ensName,
    sector: null,
    city: null,
    description,
    url,
    avatar: { initials: l.ticker.slice(0, 2).toUpperCase(), bg, fg, uri: avatar },
    status,
    statusSource: fromEns ? "ens" : fromReceiver ? "receiver" : "derived",
    phase,
    eligibility: eligibility === "human" ? "human" : "open",
    clearingPrice: a ? q96ToPrice(a.clearingPriceQ96) : null,
    clearingPoints: a ? q96ToPoints(a.clearingPriceQ96) : null,
    graduated: a ? a.graduated : null,
    listedAt: listed ? iso(listedAt) : null,
    raised: a ? usdc(a.currencyRaised) : null,
    bidCount: bids.length,
    applicants: new Set(bids.map((b) => b.args.owner)).size,
    startBlock: a ? Number(a.startBlock) : null,
    endBlock: a ? Number(a.endBlock) : null,
    claimBlock: a ? Number(a.claimBlock) : null,
    records: {
      addr: ensAddress ?? l.token,
      token: l.token,
      auction: l.auction,
      hook: l.hook,
      policy: l.receiver,
      pool: l.poolId,
    },
    raw: {
      clearingPriceQ96: a ? a.clearingPriceQ96.toString() : null,
      currencyRaised: a ? a.currencyRaised.toString() : null,
    },
  };
}

export async function listingDetail(ctx: Ctx, l: ListingCfg, h: Head): Promise<ListingDetail> {
  const summary = await listingSummary(ctx, l, h);
  return {
    ...summary,
    offer: offer(l),
    chainId: l.chainId,
    deployBlock: Number(l.deployBlock),
    contracts: {
      mockSME: l.token,
      allowAllModule: l.module,
      auctionValidationHook: l.validationHook,
      listingHook: l.hook,
      listingPolicyReceiver: l.receiver,
      auction: l.auction,
      treasury: l.treasury,
    },
    external: { ...l.external },
  };
}
