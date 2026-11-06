/**
 * GET /v1/portfolio/:address: ETH / USDC / share balances, unclaimed auction fills and every bid of one wallet,
 * marked at the pool (or clearing) price. No cost basis, P&L, LP positions or personal trade history: see
 * `unsupported`.
 */
import type { Address } from "viem";

import { erc20Abi, listingHookAbi } from "../abis.ts";
import type { Listing } from "../config.ts";
import type { Ctx, Head } from "../context.ts";
import type { Holding, Portfolio } from "../types.ts";
import { iso, q96ToPrice, round, shares, sqrtPriceX96ToPrice, usdc } from "../units.ts";
import { auctionState, bidsView } from "./auction.ts";
import { poolState } from "./market.ts";

export const UNSUPPORTED: Portfolio["unsupported"] = {
  costBasis: "Not computed: acquisitions (auction fills, swaps, transfers) need an accounting policy and full history. avgCost is always null.",
  pnl: "Not computed (needs cost basis).",
  lpPositions: "Not listed per wallet: use GET /v1/issuer/:ticker (role lp.owner) for the demo LP NFT.",
  lpFees: "Not computed.",
  tradeHistory: "Not attributable: pool Swap logs name the router, not the wallet. Keep the app's own receipts.",
};

async function mark(ctx: Ctx, l: Listing, h: Head): Promise<{ price: number | null; source: Holding["priceSource"] }> {
  const listed = await ctx.client.readContract({ address: l.hook, abi: listingHookAbi, functionName: "listed", blockNumber: h.number });
  if (listed) {
    const { sqrtPriceX96 } = await poolState(ctx, l, h);
    return { price: sqrtPriceX96ToPrice(sqrtPriceX96, l.usdcIsCurrency0), source: "pool" };
  }
  const a = await auctionState(ctx, l, h);
  return a ? { price: q96ToPrice(a.clearingPriceQ96), source: "clearing" } : { price: null, source: null };
}

export async function portfolioView(ctx: Ctx, ls: Listing[], h: Head, address: Address): Promise<Portfolio> {
  const at = { blockNumber: h.number } as const;
  const usdcAddr = ls[0]?.external.usdc;
  const [eth, usdcRaw, { bids }, perListing] = await Promise.all([
    ctx.client.getBalance({ address, ...at }),
    usdcAddr ? ctx.client.readContract({ address: usdcAddr, abi: erc20Abi, functionName: "balanceOf", args: [address], ...at }) : Promise.resolve(0n),
    bidsView(ctx, ls, h, address),
    Promise.all(
      ls.map(async (l) => {
        const [balance, symbol, m] = await Promise.all([
          ctx.client.readContract({ address: l.token, abi: erc20Abi, functionName: "balanceOf", args: [address], ...at }),
          ctx.client.readContract({ address: l.token, abi: erc20Abi, functionName: "symbol", ...at }),
          mark(ctx, l, h),
        ]);
        return { l, balance, symbol, m };
      }),
    ),
  ]);

  const holdings: Holding[] = [];
  for (const { l, balance, symbol, m } of perListing) {
    const mine = bids.filter((b) => b.ticker === l.ticker);
    const unclaimedRaw = mine.reduce((s, b) => s + BigInt(b.raw.claimable ?? "0"), 0n);
    const pendingBids = mine.filter((b) => b.status === "open" || b.status === "awaitingExit").length;
    if (balance === 0n && unclaimedRaw === 0n && mine.length === 0) continue;
    const total = shares(balance) + shares(unclaimedRaw);
    holdings.push({
      ticker: l.ticker,
      symbol,
      token: l.token,
      shares: shares(balance),
      unclaimedShares: shares(unclaimedRaw),
      pendingBids,
      price: m.price,
      priceSource: m.source,
      value: m.price === null ? null : round((total * m.price) / 1000, 6),
      avgCost: null,
      raw: { balance: balance.toString(), unclaimed: unclaimedRaw.toString() },
    });
  }

  const unclaimedShares: Record<string, number> = {};
  for (const x of holdings) unclaimedShares[x.ticker] = x.unclaimedShares;
  return {
    address,
    chainId: ctx.config.chainId,
    block: Number(h.number),
    asOf: iso(h.timestamp) ?? "",
    balances: { eth: Number(eth) / 1e18, usdc: usdc(usdcRaw), raw: { eth: eth.toString(), usdc: usdcRaw.toString() } },
    holdings,
    bids,
    totals: {
      holdingsValueUsdc: round(holdings.reduce((s, x) => s + (x.value ?? 0), 0), 6),
      unclaimedShares,
      refundableUsdc: round(bids.reduce((s, b) => s + (b.refundableUsdc ?? 0), 0), 6),
      inAuctionUsdc: round(bids.filter((b) => b.status === "open" || b.status === "awaitingExit").reduce((s, b) => s + b.budget, 0), 6),
    },
    unsupported: UNSUPPORTED,
  };
}
