/**
 * Directional halt simulation - actual eth_call against deployed contracts.
 * Tests both directions (narrowing vs widening gap) and proves DirectionalWidening revert.
 */
import { type Address } from "viem";
import { quoterAbi } from "./abis.ts";
import type { Listing } from "./config.ts";
import { head, type Ctx } from "./context.ts";
import { badRequest } from "./errors.ts";
import { poolState } from "./reads/market.ts";
import { policyView } from "./reads/market.ts";
import { decodeRevert, revertDataOf } from "./revert.ts";
import { shares, sqrtPriceX96ToPrice, usdc } from "./units.ts";

export type DirectionalSimulationResult = {
  ticker: string;
  currentPrice: number | null;
  referencePrice: number | null;
  mode: string;
  halted: boolean;
  
  narrowingTest: {
    description: string;
    direction: "buy" | "sell";
    amountIn: number;
    expectedBehavior: "success" | "revert";
    actualResult: "success" | "revert";
    error?: string;
    amountOut?: number;
    priceAfter?: number;
  };
  
  wideningTest: {
    description: string;
    direction: "buy" | "sell";
    amountIn: number;
    expectedBehavior: "revert";
    actualResult: "success" | "revert";
    error?: string;
    errorName?: string;
    amountOut?: number;
    priceAfter?: number;
  };
  
  fullHaltTest?: {
    description: string;
    direction: "buy" | "sell";
    amountIn: number;
    expectedBehavior: "revert";
    actualResult: "success" | "revert";
    error?: string;
    errorName?: string;
  };
};

/**
 * Simulate directional policy behavior with actual contract calls.
 * Tests that narrowing succeeds and widening reverts with DirectionalWidening.
 */
export async function simulateDirectional(
  ctx: Ctx,
  listing: Listing,
  params: {
    testAddress?: Address;
    narrowingAmount?: string;
    wideningAmount?: string;
  }
): Promise<DirectionalSimulationResult> {
  const h = await head(ctx);
  const pool = await poolState(ctx, listing, h);
  const policy = await policyView(ctx, listing, h);
  
  if (pool.sqrtPriceX96 === 0n) {
    throw badRequest("Pool not yet initialized");
  }
  
  const currentPrice = sqrtPriceX96ToPrice(pool.sqrtPriceX96, listing.usdcIsCurrency0);
  const referencePrice = policy.referencePrice;
  
  if (!referencePrice) {
    throw badRequest("No reference price set - directional mode requires a reference price");
  }
  
  // Determine if current price is above or below reference
  const priceAboveReference = currentPrice > referencePrice;
  
  // For narrowing: move price toward reference
  // For widening: move price away from reference
  let narrowingDirection: "buy" | "sell";
  let wideningDirection: "buy" | "sell";
  
  if (priceAboveReference) {
    // Price above reference: selling narrows (brings price down), buying widens
    narrowingDirection = "sell";
    wideningDirection = "buy";
  } else {
    // Price below reference: buying narrows (brings price up), selling widens
    narrowingDirection = "buy";
    wideningDirection = "sell";
  }
  
  // Test address for simulation (any address with no balance checks in static call)
  const testAddr: Address = params.testAddress || "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0";
  
  // Amount to trade (in human terms)
  const narrowingAmountHuman = params.narrowingAmount ? parseFloat(params.narrowingAmount) : 100;
  const wideningAmountHuman = params.wideningAmount ? parseFloat(params.wideningAmount) : 100;
  
  // Narrowing test (should succeed in directional mode)
  const narrowingTest = await testSwap(
    ctx,
    listing,
    testAddr,
    narrowingDirection,
    narrowingAmountHuman,
    h.number
  );
  
  // Widening test (should revert with DirectionalWidening)
  const wideningTest = await testSwap(
    ctx,
    listing,
    testAddr,
    wideningDirection,
    wideningAmountHuman,
    h.number
  );
  
  // If policy is halted, test that both directions fail
  let fullHaltTest: DirectionalSimulationResult["fullHaltTest"];
  if (policy.halted) {
    const haltTest = await testSwap(
      ctx,
      listing,
      testAddr,
      narrowingDirection,
      narrowingAmountHuman,
      h.number
    );
    fullHaltTest = {
      description: `Full halt blocks ${narrowingDirection} (narrowing direction)`,
      direction: narrowingDirection,
      amountIn: narrowingAmountHuman,
      expectedBehavior: "revert",
      actualResult: haltTest.reverted ? "revert" : "success",
      error: haltTest.error,
      errorName: haltTest.errorName,
    };
  }
  
  return {
    ticker: listing.ticker,
    currentPrice,
    referencePrice,
    mode: policy.mode,
    halted: policy.halted,
    
    narrowingTest: {
      description: `${narrowingDirection === "buy" ? "Buying" : "Selling"} ${narrowingAmountHuman} ${narrowingDirection === "buy" ? "USDC" : "shares"} (narrows gap toward reference)`,
      direction: narrowingDirection,
      amountIn: narrowingAmountHuman,
      expectedBehavior: policy.halted ? "revert" : "success",
      actualResult: narrowingTest.reverted ? "revert" : "success",
      error: narrowingTest.error,
      amountOut: narrowingTest.amountOut,
      priceAfter: narrowingTest.priceAfter,
    },
    
    wideningTest: {
      description: `${wideningDirection === "buy" ? "Buying" : "Selling"} ${wideningAmountHuman} ${wideningDirection === "buy" ? "USDC" : "shares"} (widens gap away from reference)`,
      direction: wideningDirection,
      amountIn: wideningAmountHuman,
      expectedBehavior: "revert",
      actualResult: wideningTest.reverted ? "revert" : "success",
      error: wideningTest.error,
      errorName: wideningTest.errorName,
      amountOut: wideningTest.amountOut,
      priceAfter: wideningTest.priceAfter,
    },
    
    fullHaltTest,
  };
}

async function testSwap(
  ctx: Ctx,
  listing: Listing,
  from: Address,
  direction: "buy" | "sell",
  amountHuman: number,
  blockNumber: bigint
): Promise<{
  reverted: boolean;
  error?: string;
  errorName?: string;
  amountOut?: number;
  priceAfter?: number;
}> {
  const zeroForOne = listing.usdcIsCurrency0 ? (direction === "buy") : (direction === "sell");
  const amountIn = direction === "buy" 
    ? BigInt(Math.floor(amountHuman * 10 ** 6))  // USDC has 6 decimals
    : BigInt(Math.floor(amountHuman * 10 ** 18)); // Shares have 18 decimals
  
  try {
    const { result } = await ctx.client.simulateContract({
      address: listing.external.quoter,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{
        poolKey: listing.poolKey,
        zeroForOne,
        exactAmount: amountIn,
        hookData: "0x"
      }],
      account: from,
      blockNumber,
    });
    
    const [amountOut] = result;
    const amountOutHuman = direction === "buy" 
      ? shares(amountOut)
      : usdc(amountOut);
    
    return {
      reverted: false,
      amountOut: amountOutHuman,
    };
  } catch (e) {
    const data = revertDataOf(e);
    const decoded = decodeRevert(data, { usdcIsCurrency0: listing.usdcIsCurrency0 });
    
    return {
      reverted: true,
      error: decoded?.message || String(e),
      errorName: decoded?.name,
    };
  }
}
