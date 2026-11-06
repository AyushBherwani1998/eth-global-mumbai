/**
 * POST /v1/prepare/*: unsigned calldata for the wallet plus a simulation from the user's address. The server never
 * signs or sends anything; MetaMask sends `steps` in order (approvals first, `needed: false` ones skipped).
 */
import { encodeAbiParameters, encodeFunctionData, encodePacked, getAddress, isAddress, maxUint256, type Address, type Hex } from "viem";

import { ccaAbi, erc20Abi, permit2Abi, quoterAbi, universalRouterAbi } from "./abis.ts";
import type { Listing } from "./config.ts";
import { head, type Ctx, type Head } from "./context.ts";
import { badRequest, conflict, notFound } from "./errors.ts";
import { auctionState, planExit } from "./reads/auction.ts";
import { decodeRevert, revertDataOf } from "./revert.ts";
import type { Permit2Info, Prepared, PreparedStep, Simulation, TxRequest } from "./types.ts";
import { ONE_POINT_Q96, SHARE_DECIMALS, USDC_DECIMALS, parseAmount, pointsToQ96, priceToPoints, q96ToPoints, q96ToPrice, shares, usdc } from "./units.ts";

const MAX_UINT128 = (1n << 128n) - 1n;
/** Universal Router command and v4 router actions (v4-periphery `Actions`). */
const V4_SWAP = 0x10;
const SWAP_EXACT_IN_SINGLE = 0x06;
const SETTLE_ALL = 0x0c;
const TAKE_ALL = 0x0f;

// ------------------------------------------------------------------------------------------ input parsing

export function parseAddress(v: unknown, field: string): Address {
  if (typeof v !== "string" || !isAddress(v, { strict: false })) throw badRequest(`${field} must be an address`);
  if (!isAddress(v)) throw badRequest(`${field} has an invalid EIP-55 checksum (send it lowercase or checksummed)`);
  return getAddress(v);
}

function parseRaw(v: unknown, field: string, max: bigint): bigint {
  if (typeof v !== "string" || !/^\d+$/.test(v)) throw badRequest(`${field} must be a decimal integer string`);
  const n = BigInt(v);
  if (n === 0n || n > max) throw badRequest(`${field} out of range`);
  return n;
}

function amountFrom(body: Record<string, unknown>, human: string, raw: string, decimals: number, max: bigint): bigint {
  if (body[raw] !== undefined) return parseRaw(body[raw], raw, max);
  const v = body[human];
  if (typeof v !== "number" && typeof v !== "string") throw badRequest(`${human} (or ${raw}) is required`);
  let n: bigint;
  try {
    n = parseAmount(v, decimals);
  } catch (e) {
    throw badRequest(`${human}: ${(e as Error).message}`);
  }
  if (n === 0n || n > max) throw badRequest(`${human} out of range`);
  return n;
}

function intField(body: Record<string, unknown>, field: string, dflt: number, min: number, max: number): number {
  const v = body[field];
  if (v === undefined) return dflt;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw badRequest(`${field} must be an integer in [${min}, ${max}]`);
  return v;
}

// ------------------------------------------------------------------------------------------ simulation

/** eth_call for a single call; eth_simulateV1 when approvals have to land first (same block, in order). */
export async function simulate(ctx: Ctx, l: Listing, from: Address, calls: TxRequest[], h: Head): Promise<Simulation> {
  const block = Number(h.number);
  const dctx = { usdcIsCurrency0: l.usdcIsCurrency0 };
  const last = calls.at(-1);
  if (!last) return { ok: null, method: "none", block, error: null, gasUsed: null, note: "nothing to simulate" };
  if (calls.length === 1) {
    try {
      await ctx.client.call({ account: from, to: last.to, data: last.data, value: BigInt(last.value), blockNumber: h.number });
      return { ok: true, method: "eth_call", block, error: null, gasUsed: null, note: null };
    } catch (e) {
      const data = revertDataOf(e);
      if (data === null && !isRevert(e)) throw e;
      return { ok: false, method: "eth_call", block, error: decodeRevert(data, dctx), gasUsed: null, note: null };
    }
  }
  try {
    const [result] = await ctx.client.simulateBlocks({
      blockNumber: h.number,
      validation: false,
      blocks: [{ calls: calls.map((c) => ({ account: from, to: c.to, data: c.data, value: BigInt(c.value) })) }],
    });
    const results = result?.calls ?? [];
    const failed = results.findIndex((r) => r.status === "failure");
    if (failed === -1) {
      return { ok: true, method: "eth_simulateV1", block, error: null, gasUsed: results.at(-1)?.gasUsed.toString() ?? null, note: `${calls.length} calls simulated in order` };
    }
    return {
      ok: false,
      method: "eth_simulateV1",
      block,
      error: decodeRevert(results[failed]?.data ?? null, dctx),
      gasUsed: null,
      note: failed === calls.length - 1 ? `the final call reverts after ${failed} approval step(s)` : `step ${failed + 1} of ${calls.length} reverts`,
    };
  } catch (e) {
    return { ok: null, method: "none", block, error: null, gasUsed: null, note: `eth_simulateV1 unavailable on this RPC (${shortMessage(e)}); send the approval steps first, then prepare again` };
  }
}

function isRevert(e: unknown): boolean {
  return /revert/i.test(shortMessage(e));
}

function shortMessage(e: unknown): string {
  return (e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? String(e);
}

// ------------------------------------------------------------------------------------------ approvals

function tx(to: Address, data: Hex): TxRequest {
  return { to, data, value: "0" };
}

/** ERC20 -> Permit2 approval plus the Permit2 allowance for `spender`, marked needed only when missing. */
async function permit2Steps(
  ctx: Ctx,
  l: Listing,
  h: Head,
  owner: Address,
  token: Address,
  spender: Address,
  amount: bigint,
  expiresIn: number,
  kind: "approveUsdcToPermit2" | "approveTokenToPermit2",
  label: string,
): Promise<{ steps: PreparedStep[]; info: Permit2Info }> {
  const permit2 = l.external.permit2;
  const [erc20Allowance, p2] = await Promise.all([
    ctx.client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, permit2], blockNumber: h.number }),
    ctx.client.readContract({ address: permit2, abi: permit2Abi, functionName: "allowance", args: [owner, token, spender], blockNumber: h.number }),
  ]);
  const [p2Amount, p2Expiration] = p2;
  const expiration = Number(h.timestamp) + expiresIn;
  const steps: PreparedStep[] = [
    {
      kind,
      ...tx(token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [permit2, maxUint256] })),
      description: `Approve Permit2 to move your ${label} (once per token)`,
      needed: erc20Allowance < amount,
    },
    {
      kind: "permit2Approve",
      ...tx(permit2, encodeFunctionData({ abi: permit2Abi, functionName: "approve", args: [token, spender, amount, expiration] })),
      description: `Permit2: allow ${spender} to pull ${label} (expires in ${Math.round(expiresIn / 3600)} h)`,
      needed: p2Amount < amount || BigInt(p2Expiration) <= h.timestamp,
    },
  ];
  return {
    steps,
    info: {
      token,
      spender,
      amount: amount.toString(),
      expiration,
      current: { erc20AllowanceToPermit2: erc20Allowance.toString(), permit2Amount: p2Amount.toString(), permit2Expiration: Number(p2Expiration) },
    },
  };
}

async function finish(
  ctx: Ctx,
  l: Listing,
  h: Head,
  action: Prepared["action"],
  from: Address,
  steps: PreparedStep[],
  permit2: Permit2Info | null,
  details: Record<string, unknown>,
): Promise<Prepared> {
  const main = steps.at(-1)!;
  const sim = await simulate(ctx, l, from, steps.filter((s) => s.needed), h);
  return { ticker: l.ticker, action, to: main.to, data: main.data, value: main.value, from, chainId: ctx.config.chainId, steps, permit2, simulate: sim, details };
}

// ------------------------------------------------------------------------------------------ bid

export async function prepareBid(ctx: Ctx, l: Listing, body: Record<string, unknown>): Promise<Prepared> {
  if (!l.auction) throw conflict("NOT_LAUNCHED", `${l.ticker} has no auction yet (run make launch)`);
  const owner = parseAddress(body.owner, "owner");
  const amount = amountFrom(body, "budget", "budgetRaw", USDC_DECIMALS, MAX_UINT128);
  let points: bigint;
  if (body.maxPricePoints !== undefined) {
    const p = body.maxPricePoints;
    if (typeof p !== "number" || !Number.isInteger(p) || p <= 0) throw badRequest("maxPricePoints must be a positive integer (1 point = 0.01 USDC / lot)");
    points = BigInt(p);
  } else {
    const p = body.maxPrice;
    if (typeof p !== "number" && typeof p !== "string") throw badRequest("maxPrice (USDC / lot) or maxPricePoints is required");
    try {
      points = priceToPoints(p);
    } catch (e) {
      throw badRequest(`maxPrice: ${(e as Error).message}`);
    }
  }
  const maxPriceQ96 = pointsToQ96(points);
  if (maxPriceQ96 % l.params.tickSpacingQ96 !== 0n) throw badRequest(`maxPrice must sit on the auction tick spacing (${l.params.tickSpacingQ96 / ONE_POINT_Q96} points)`);
  const expiresIn = intField(body, "permit2ExpiresIn", 86_400, 60, 30 * 86_400);

  const h = await head(ctx);
  const usdcAddr = l.external.usdc;
  const { steps, info } = await permit2Steps(ctx, l, h, owner, usdcAddr, l.auction, amount, expiresIn, "approveUsdcToPermit2", "USDC");
  const prevTickPriceQ96 = l.params.floorPriceQ96;
  steps.push({
    kind: "submitBid",
    ...tx(l.auction, encodeFunctionData({ abi: ccaAbi, functionName: "submitBid", args: [maxPriceQ96, amount, owner, prevTickPriceQ96, "0x"] })),
    description: `Bid ${usdc(amount)} USDC up to ${q96ToPrice(maxPriceQ96)} USDC / lot`,
    needed: true,
  });
  const balance = await ctx.client.readContract({ address: usdcAddr, abi: erc20Abi, functionName: "balanceOf", args: [owner], blockNumber: h.number });
  return finish(ctx, l, h, "bid", owner, steps, info, {
    auction: l.auction,
    owner,
    budget: usdc(amount),
    maxPrice: q96ToPrice(maxPriceQ96),
    maxPricePoints: q96ToPoints(maxPriceQ96),
    usdcBalance: usdc(balance),
    warnings: balance < amount ? [`USDC balance ${usdc(balance)} is below the ${usdc(amount)} USDC budget`] : [],
    raw: { amount: amount.toString(), maxPriceQ96: maxPriceQ96.toString(), prevTickPriceQ96: prevTickPriceQ96.toString(), usdcBalance: balance.toString() },
  });
}

// ------------------------------------------------------------------------------------------ swap

export function encodeV4ExactInSingle(p: {
  poolKey: Listing["poolKey"];
  zeroForOne: boolean;
  amountIn: bigint;
  minOut: bigint;
  currencyIn: Address;
  currencyOut: Address;
}): { commands: Hex; inputs: Hex[] } {
  const actions = encodePacked(["uint8", "uint8", "uint8"], [SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL]);
  const swap = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "amountIn", type: "uint128" },
          { name: "amountOutMinimum", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    [{ poolKey: p.poolKey, zeroForOne: p.zeroForOne, amountIn: p.amountIn, amountOutMinimum: p.minOut, hookData: "0x" }],
  );
  const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [p.currencyIn, p.amountIn]);
  const take = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [p.currencyOut, p.minOut]);
  const input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, [swap, settle, take]]);
  return { commands: encodePacked(["uint8"], [V4_SWAP]), inputs: [input] };
}

export async function prepareSwap(ctx: Ctx, l: Listing, body: Record<string, unknown>): Promise<Prepared> {
  const from = parseAddress(body.from, "from");
  const side = body.side;
  if (side !== "buy" && side !== "sell") throw badRequest('side must be "buy" or "sell"');
  const decimalsIn = side === "buy" ? USDC_DECIMALS : SHARE_DECIMALS;
  const amountIn = amountFrom(body, "amount", "amountRaw", decimalsIn, MAX_UINT128);
  const slippageBps = intField(body, "slippageBps", 100, 0, 5000);
  const deadlineSeconds = intField(body, "deadlineSeconds", 600, 30, 86_400);
  const expiresIn = intField(body, "permit2ExpiresIn", 86_400, 60, 30 * 86_400);

  const usdcAddr = l.external.usdc;
  const [currencyIn, currencyOut] = side === "buy" ? [usdcAddr, l.token] : [l.token, usdcAddr];
  const zeroForOne = getAddress(currencyIn) === getAddress(l.poolKey.currency0);

  const h = await head(ctx);
  const dctx = { usdcIsCurrency0: l.usdcIsCurrency0 };
  let quoteOut: bigint | null = null;
  let quoteError = null;
  try {
    const { result } = await ctx.client.simulateContract({
      address: l.external.quoter,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{ poolKey: l.poolKey, zeroForOne, exactAmount: amountIn, hookData: "0x" }],
      account: from,
      blockNumber: h.number,
    });
    quoteOut = result[0];
  } catch (e) {
    quoteError = decodeRevert(revertDataOf(e), dctx);
  }
  let minOut: bigint;
  if (body.minOutRaw !== undefined) {
    if (typeof body.minOutRaw !== "string" || !/^\d+$/.test(body.minOutRaw)) throw badRequest("minOutRaw must be a decimal integer string");
    minOut = BigInt(body.minOutRaw);
  } else {
    minOut = quoteOut === null ? 0n : (quoteOut * BigInt(10_000 - slippageBps)) / 10_000n;
  }

  const router = l.external.universalRouter;
  const label = side === "buy" ? "USDC" : "shares";
  const balance = await ctx.client.readContract({ address: currencyIn, abi: erc20Abi, functionName: "balanceOf", args: [from], blockNumber: h.number });
  const { steps, info } = await permit2Steps(ctx, l, h, from, currencyIn, router, amountIn, expiresIn, side === "buy" ? "approveUsdcToPermit2" : "approveTokenToPermit2", label);
  const { commands, inputs } = encodeV4ExactInSingle({ poolKey: l.poolKey, zeroForOne, amountIn, minOut, currencyIn, currencyOut });
  const deadline = h.timestamp + BigInt(deadlineSeconds);
  const fmtIn = side === "buy" ? `${usdc(amountIn)} USDC` : `${shares(amountIn)} shares`;
  steps.push({
    kind: "swap",
    ...tx(router, encodeFunctionData({ abi: universalRouterAbi, functionName: "execute", args: [commands, inputs, deadline] })),
    description: `${side === "buy" ? "Buy" : "Sell"} with ${fmtIn} (Universal Router, v4 exact input)`,
    needed: true,
  });

  const fmtOut = (x: bigint) => (side === "buy" ? shares(x) : usdc(x));
  const usdcIn = side === "buy" ? amountIn : quoteOut;
  const sharesAmt = side === "buy" ? quoteOut : amountIn;
  const avgPrice = usdcIn !== null && sharesAmt !== null && sharesAmt > 0n ? Math.round((usdc(usdcIn) / shares(sharesAmt)) * 1000 * 10_000) / 10_000 : null;
  return finish(ctx, l, h, "swap", from, steps, info, {
    side,
    router,
    zeroForOne,
    amountIn: side === "buy" ? usdc(amountIn) : shares(amountIn),
    quote: {
      ok: quoteError === null,
      amountOut: quoteOut === null ? null : fmtOut(quoteOut),
      /** Average execution price (USDC / lot), before fees are separated out. */
      avgPrice,
      error: quoteError,
    },
    minOut: fmtOut(minOut),
    slippageBps,
    deadline: Number(deadline),
    warnings: balance < amountIn ? [`${label} balance ${side === "buy" ? usdc(balance) : shares(balance)} is below the amount in`] : [],
    raw: { amountIn: amountIn.toString(), amountOut: quoteOut?.toString() ?? null, minOut: minOut.toString(), commands, inputs },
  });
}

// ------------------------------------------------------------------------------------------ exit / claim

async function readBid(ctx: Ctx, auction: Address, id: bigint, h: Head) {
  try {
    return await ctx.client.readContract({ address: auction, abi: ccaAbi, functionName: "bids", args: [id], blockNumber: h.number });
  } catch (e) {
    const err = decodeRevert(revertDataOf(e));
    if (err.name === "BidIdDoesNotExist") throw notFound("UNKNOWN_BID", `bid ${id} does not exist on ${auction}`);
    throw e;
  }
}

function bidIdOf(v: unknown, field: string): bigint {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw badRequest(`${field} must be a non-negative integer`);
  return BigInt(v);
}

export async function prepareExit(ctx: Ctx, l: Listing, body: Record<string, unknown>): Promise<Prepared> {
  if (!l.auction) throw conflict("NOT_LAUNCHED", `${l.ticker} has no auction yet`);
  const id = bidIdOf(body.bidId, "bidId");
  const h = await head(ctx);
  const [bid, a] = await Promise.all([readBid(ctx, l.auction, id, h), auctionState(ctx, l, h)]);
  const from = body.from === undefined ? getAddress(bid.owner) : parseAddress(body.from, "from");
  const plan = await planExit(ctx, l, a!, { maxPrice: bid.maxPrice, startBlock: BigInt(bid.startBlock), exitedBlock: BigInt(bid.exitedBlock) }, h);
  const step: PreparedStep =
    plan.fn === "exitPartiallyFilledBid"
      ? {
          kind: "exitPartiallyFilledBid",
          ...tx(l.auction, encodeFunctionData({ abi: ccaAbi, functionName: "exitPartiallyFilledBid", args: [id, plan.lastFullyFilledCheckpointBlock, plan.outbidBlock] })),
          description: `Exit partially filled / outbid bid ${id}`,
          needed: true,
        }
      : {
          kind: "exitBid",
          ...tx(l.auction, encodeFunctionData({ abi: ccaAbi, functionName: "exitBid", args: [id] })),
          description: `Exit bid ${id} (refund + fill accounting; tokens are claimed separately)`,
          needed: true,
        };
  return finish(ctx, l, h, "exit", from, [step], null, {
    bidId: Number(id),
    owner: getAddress(bid.owner),
    function: plan.fn ?? "exitBid",
    reason: plan.fn === null ? plan.reason : null,
    hints: plan.fn === "exitPartiallyFilledBid" ? { lastFullyFilledCheckpointBlock: Number(plan.lastFullyFilledCheckpointBlock), outbidBlock: Number(plan.outbidBlock) } : null,
  });
}

export async function prepareClaim(ctx: Ctx, l: Listing, body: Record<string, unknown>): Promise<Prepared> {
  if (!l.auction) throw conflict("NOT_LAUNCHED", `${l.ticker} has no auction yet`);
  const ids =
    body.bidIds !== undefined
      ? Array.isArray(body.bidIds) && body.bidIds.length > 0
        ? body.bidIds.map((v, i) => bidIdOf(v, `bidIds[${i}]`))
        : (() => {
            throw badRequest("bidIds must be a non-empty array");
          })()
      : [bidIdOf(body.bidId, "bidId")];
  const h = await head(ctx);
  const bids = await Promise.all(ids.map((id) => readBid(ctx, l.auction!, id, h)));
  const owner = getAddress(bids[0]!.owner);
  if (bids.some((b) => getAddress(b.owner) !== owner)) throw badRequest("all bidIds must belong to one owner (claimTokensBatch)");
  const from = body.from === undefined ? owner : parseAddress(body.from, "from");
  const step: PreparedStep =
    ids.length === 1
      ? {
          kind: "claimTokens",
          ...tx(l.auction, encodeFunctionData({ abi: ccaAbi, functionName: "claimTokens", args: [ids[0]!] })),
          description: `Claim the shares filled by bid ${ids[0]}`,
          needed: true,
        }
      : {
          kind: "claimTokensBatch",
          ...tx(l.auction, encodeFunctionData({ abi: ccaAbi, functionName: "claimTokensBatch", args: [owner, ids] })),
          description: `Claim the shares filled by bids ${ids.join(", ")}`,
          needed: true,
        };
  return finish(ctx, l, h, "claim", from, [step], null, {
    bidIds: ids.map(Number),
    owner,
    tokensFilled: bids.reduce((s, b) => s + shares(b.tokensFilled), 0),
    exited: bids.map((b) => b.exitedBlock !== 0n),
    // claimTokens zeroes tokensFilled, so a second claim succeeds and transfers nothing.
    warnings: bids.every((b) => b.tokensFilled === 0n) ? ["nothing to claim: already claimed, or the bid filled 0 shares"] : [],
  });
}
