import { BaseError, decodeErrorResult, type Hex } from "viem";

import { allErrorsAbi } from "./abis.ts";
import type { DecodedError } from "./types.ts";
import { q96ToPoints, sqrtPriceX96ToPrice, usdc } from "./units.ts";

/** Errors whose only job is to carry another error's bytes (outermost first when nested). */
const WRAPPER_ARG: Record<string, number> = {
  ValidationHookCallFailed: 0, // CCA -> AuctionValidationHook / eligibility module
  WrappedError: 2, // v4 PoolManager -> ListingHook (target, selector, reason, details)
  UnexpectedRevertBytes: 0, // V4Quoter -> whatever the simulated swap hit
  ExecutionFailed: 1, // Universal Router (commandIndex, message)
};

export type DecodeContext = { usdcIsCurrency0?: boolean };

/** Decodes revert data, unwrapping nested wrapper errors to the innermost reason. */
export function decodeRevert(data: Hex | null | undefined, ctx: DecodeContext = {}): DecodedError {
  const wrappers: string[] = [];
  let current: Hex | null = data && data !== "0x" ? data : null;
  for (let depth = 0; current && depth < 8; depth++) {
    const decoded = tryDecode(current);
    if (!decoded) break;
    const argIndex = WRAPPER_ARG[decoded.errorName];
    const inner = argIndex === undefined ? undefined : (decoded.args?.[argIndex] as Hex | undefined);
    if (argIndex === undefined || !inner || inner === "0x") {
      return describe(decoded.errorName, current, decoded.args ?? [], wrappers, ctx);
    }
    wrappers.push(decoded.errorName);
    current = inner;
  }
  if (!current) {
    return {
      name: wrappers.at(-1) ?? "EmptyRevert",
      selector: null,
      args: {},
      message: "The call reverted without a reason (out of gas, or a contract without code)",
      wrappers,
      data: data ?? null,
    };
  }
  const selector = current.length >= 10 ? (current.slice(0, 10) as Hex) : null;
  return { name: "Unknown", selector, args: {}, message: `Unknown revert ${selector ?? current}`, wrappers, data: current };
}

type Decoded = { errorName: string; args?: readonly unknown[] };

function tryDecode(data: Hex): Decoded | null {
  try {
    const r = decodeErrorResult({ abi: allErrorsAbi, data });
    return { errorName: r.errorName, args: r.args as readonly unknown[] | undefined };
  } catch {
    return null;
  }
}

function describe(name: string, data: Hex, rawArgs: readonly unknown[], wrappers: string[], ctx: DecodeContext): DecodedError {
  const item = allErrorsAbi.find((i) => i.type === "error" && i.name === name);
  const args: Record<string, string | number | boolean> = {};
  const inputs = item && item.type === "error" ? item.inputs : [];
  rawArgs.forEach((v, i) => {
    const key = inputs[i]?.name || String(i);
    args[key] = typeof v === "bigint" ? v.toString() : typeof v === "boolean" || typeof v === "number" ? v : String(v);
  });
  const selector = name === "Error" || name === "Panic" ? null : (data.slice(0, 10) as Hex);
  return { name, selector, args, message: message(name, rawArgs, ctx), wrappers, data };
}

function b(v: unknown): bigint {
  return typeof v === "bigint" ? v : BigInt(String(v ?? 0));
}

function lot(n: number): string {
  return n.toFixed(n * 100 === Math.round(n * 100) ? 2 : 3);
}

/** Suggested UI copy, from contracts/errors.md. */
function message(name: string, a: readonly unknown[], ctx: DecodeContext): string {
  const inv = ctx.usdcIsCurrency0 ?? true;
  switch (name) {
    case "OutOfBand": {
      // With USDC as currency0 the lowest sqrt price is the highest share price.
      const [p, min, max] = [b(a[0]), b(a[1]), b(a[2])];
      const [lo, hi] = inv ? [sqrtPriceX96ToPrice(max, inv), sqrtPriceX96ToPrice(min, inv)] : [sqrtPriceX96ToPrice(min, inv), sqrtPriceX96ToPrice(max, inv)];
      return `Outside today's price band (${lot(lo)} to ${lot(hi)} USDC / lot): the price after this trade would be ${lot(sqrtPriceX96ToPrice(p, inv))}`;
    }
    case "DirectionalWidening":
      return `Only trades toward the reference price (${lot(sqrtPriceX96ToPrice(b(a[2]), inv))} USDC / lot) are allowed right now`;
    case "Halted":
      return "Trading halted";
    case "CoolingOff":
      return `Cooling off until ${new Date(Number(b(a[0])) * 1000).toISOString()}`;
    case "BidAboveCap":
      return `Max price ${(q96ToPoints(b(a[0])) / 100).toFixed(2)} is above the ${(q96ToPoints(b(a[1])) / 100).toFixed(2)} USDC / lot cap`;
    case "CapExceeded": {
      const [total, cap] = [b(a[0]), b(a[1])];
      return `Over the ${usdc(cap)} USDC per-applicant limit (this bid would bring you to ${usdc(total)} USDC)`;
    }
    case "SenderMustBeOwner":
      return "Bids must be placed from the owning wallet";
    case "NotEligible":
      return "This wallet is not eligible for this listing";
    case "OnlyAuction":
      return "Misconfiguration: the validation hook is not bound to this auction yet";
    case "TransferFromFailed":
      return "USDC could not be pulled: approve Permit2, set the Permit2 allowance for this spender, and check the USDC balance";
    case "InsufficientAllowance":
      return "Permit2 allowance too low for this amount";
    case "AllowanceExpired":
      return "Permit2 allowance expired: approve again";
    case "AuctionNotStarted":
      return "The auction has not started yet";
    case "AuctionIsOver":
      return "The auction is over";
    case "AuctionIsNotOver":
      return "The auction is still running";
    case "TokensNotReceived":
      return "The issuer has not deposited the auction supply yet";
    case "BidAmountTooSmall":
      return "Bid amount must be above zero";
    case "BidMustBeAboveClearingPrice":
      return "Max price must be above the current clearing price";
    case "TickPriceNotAtBoundary":
      return "Max price must be a multiple of 0.01 USDC / lot";
    case "AuctionSoldOut":
      return "The auction is sold out";
    case "NotClaimable":
      return "Tokens can be claimed after the claim block";
    case "BidNotExited":
      return "Exit the bid before claiming";
    case "NotGraduated":
      return "The auction did not reach its minimum raise: exit for a full refund";
    case "CannotExitBid":
      return "This bid is at or below the clearing price: use the partial exit";
    case "BidAlreadyExited":
      return "This bid was already exited";
    case "BidIdDoesNotExist":
      return "No such bid";
    case "CannotPartiallyExitBidBeforeEndBlock":
      return "A bid at the clearing price can only be exited after the auction ends";
    case "CannotPartiallyExitBidBeforeGraduation":
      return "Bids can't be exited before the auction graduates";
    case "InvalidLastFullyFilledCheckpointHint":
    case "InvalidOutbidBlockCheckpointHint":
      return "Exit hints are out of date: prepare the exit again";
    case "V4TooLittleReceived":
      return "Price moved: the output would be below your minimum";
    case "TransactionDeadlinePassed":
      return "Deadline passed: prepare the swap again";
    case "NotEnoughLiquidity":
      return "Not enough pool liquidity for this trade";
    case "PoolNotInitialized":
      return "The pool is not open yet";
    case "ERC20InsufficientBalance":
      return "Insufficient token balance";
    case "ERC20InsufficientAllowance":
      return "Token allowance too low";
    case "Error":
      return String(a[0] ?? "Reverted");
    case "Panic":
      return `Panic ${String(a[0] ?? "")}`;
    default:
      return name;
  }
}

/** Revert data from a viem error (eth_call / estimateGas / simulate failures), if any. */
export function revertDataOf(err: unknown): Hex | null {
  if (err instanceof BaseError) {
    const found = err.walk((e) => typeof (e as { data?: unknown }).data === "string" && String((e as { data: string }).data).startsWith("0x"));
    const data = (found as { data?: Hex } | null)?.data;
    if (data) return data;
    const nested = err.walk((e) => {
      const d = (e as { data?: { data?: unknown } }).data;
      return !!d && typeof d === "object" && typeof d.data === "string";
    }) as { data?: { data?: Hex } } | null;
    if (nested?.data?.data) return nested.data.data;
  }
  return null;
}
