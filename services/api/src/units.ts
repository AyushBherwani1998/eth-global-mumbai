/**
 * Listing Day price math, the same definitions as contracts/src/libraries/ListingPrice.sol:
 * - points: issue = 100 points = 1.00 USDC per 1,000-share lot = 0.001 USDC per share.
 * - CCA price: raw USDC (6 dec) per raw share (18 dec), Q96.
 * - v4 pool price: sqrtPriceX96 of currency1 per currency0 (inverted when USDC is currency0).
 */
import { formatUnits, parseUnits } from "viem";

export const Q96 = 1n << 96n;
export const USDC_DECIMALS = 6;
export const SHARE_DECIMALS = 18;
/** Raw shares per 1,000-share lot. */
const SHARE_RAW_PER_LOT = 1000n * 10n ** 18n;
/** Raw USDC per lot for one point (0.01 USDC). */
const QUOTE_RAW_PER_LOT_PER_POINT = 10n ** 4n;
/** `ListingPrice.ONE_POINT_Q96` = floor(2^96 * 1e4 / 1e21) = 792,281,625,142. */
export const ONE_POINT_Q96 = (Q96 * QUOTE_RAW_PER_LOT_PER_POINT) / SHARE_RAW_PER_LOT;
/** points x 100 per Q96 unit: pointsE2 = priceQ96 * 1e19 / 2^96. */
const POINTS_E2_SCALE = 100n * 10n ** 17n;

export function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Tick-aligned CCA price for an integer points price (`ListingPrice.pointsToQ96`). */
export function pointsToQ96(points: bigint): bigint {
  return points * ONE_POINT_Q96;
}

/**
 * Points x100 of a CCA Q96 price, rounded to nearest: tick prices are floor(points * 2^96 / 1e5) onchain, so
 * flooring back would show 80 points as 79.99.
 */
export function q96ToPointsE2(priceQ96: bigint): bigint {
  return divRound(priceQ96 * POINTS_E2_SCALE, Q96);
}

/** Points (2 decimals) of a CCA Q96 price. */
export function q96ToPoints(priceQ96: bigint): number {
  return Number(q96ToPointsE2(priceQ96)) / 100;
}

/** USDC per lot (4 decimals) of a CCA Q96 price. */
export function q96ToPrice(priceQ96: bigint): number {
  return round(Number(q96ToPointsE2(priceQ96)) / 10_000, 4);
}

export function pointsE2ToPrice(pointsE2: bigint): number {
  return round(Number(pointsE2) / 10_000, 4);
}

export function pointsE2ToPoints(pointsE2: bigint): number {
  return Number(pointsE2) / 100;
}

function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  return (a * b) / d;
}

function divRound(n: bigint, d: bigint): bigint {
  return (n + d / 2n) / d;
}

/** `ListingPrice.sqrtPriceX96ToPriceQ96`: v4 sqrt price to a CCA-style Q96 share price, rounded down. */
export function sqrtPriceX96ToPriceQ96(sqrtPriceX96: bigint, usdcIsCurrency0: boolean): bigint {
  if (sqrtPriceX96 === 0n) return 0n;
  if (usdcIsCurrency0) {
    const inverse = mulDiv(Q96, Q96, sqrtPriceX96);
    return mulDiv(inverse, inverse, Q96);
  }
  return mulDiv(sqrtPriceX96, sqrtPriceX96, Q96);
}

/** Pool price in points x100 (11_000 = 110.00 points = 1.10 USDC / lot), rounded to nearest. */
export function sqrtPriceX96ToPointsE2(sqrtPriceX96: bigint, usdcIsCurrency0: boolean): bigint {
  return q96ToPointsE2(sqrtPriceX96ToPriceQ96(sqrtPriceX96, usdcIsCurrency0));
}

export function sqrtPriceX96ToPrice(sqrtPriceX96: bigint, usdcIsCurrency0: boolean): number {
  return pointsE2ToPrice(sqrtPriceX96ToPointsE2(sqrtPriceX96, usdcIsCurrency0));
}

export function usdc(raw: bigint): number {
  return Number(formatUnits(raw, USDC_DECIMALS));
}

export function shares(raw: bigint): number {
  return Number(formatUnits(raw, SHARE_DECIMALS));
}

/** Parses a human amount ("19.5", 20) into raw units; throws on bad input or too many decimals. */
export function parseAmount(value: number | string, decimals: number): bigint {
  const s = typeof value === "number" ? numberToPlain(value) : value.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`not a positive decimal amount: ${String(value)}`);
  const frac = s.split(".")[1] ?? "";
  if (frac.length > decimals) throw new Error(`${String(value)} has more than ${decimals} decimals`);
  return parseUnits(s, decimals);
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error(`not a positive amount: ${n}`);
  // String(1.3) is the shortest round-trip form ("1.3"); toFixed would expose float noise (1.300000000000000044).
  const s = String(n);
  if (/e/i.test(s)) throw new Error(`${s}: pass very small or very large amounts as a decimal string`);
  return s;
}

/** USDC per lot (e.g. 1.3) to an integer points price (130); throws if it is not on the 1-point tick. */
export function priceToPoints(price: number | string): bigint {
  const pointsE2 = parseAmount(price, 4); // USDC / lot with 4 decimals = points x100
  if (pointsE2 % 100n !== 0n) throw new Error(`price ${String(price)} is not a multiple of 0.01 USDC / lot (1 point)`);
  return pointsE2 / 100n;
}

const MIN_SQRT_PRICE = 4_295_128_739n;
const MAX_SQRT_PRICE = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;
const BPS = 10_000n;
const BAND_SCALE = 10n ** 18n;

/** floor(sqrt(n)), as OpenZeppelin `Math.sqrt`. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("isqrt of a negative number");
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  // Newton from a float seed, then settle on the floor.
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) break;
    x = y;
  }
  while (x * x > n) x -= 1n;
  while ((x + 1n) * (x + 1n) <= n) x += 1n;
  return x;
}

/** `ListingBand.bounds`: pool sqrtPriceX96 bounds of a ±`bps` share-price band around `refSqrtPriceX96`. */
export function bandBounds(refSqrtPriceX96: bigint, bps: number, usdcIsCurrency0: boolean): [bigint, bigint] {
  const b = BigInt(bps);
  const up = isqrt((BPS + b) * 10n ** 32n);
  const down = isqrt((BPS - b) * 10n ** 32n);
  const ceilDiv = (n: bigint, d: bigint) => (n + d - 1n) / d;
  const [lo, hi] = usdcIsCurrency0
    ? [ceilDiv(refSqrtPriceX96 * BAND_SCALE, up), (refSqrtPriceX96 * BAND_SCALE) / down]
    : [ceilDiv(refSqrtPriceX96 * down, BAND_SCALE), (refSqrtPriceX96 * up) / BAND_SCALE];
  const clamp = (x: bigint) => (x < MIN_SQRT_PRICE ? MIN_SQRT_PRICE : x > MAX_SQRT_PRICE ? MAX_SQRT_PRICE : x);
  return [clamp(lo), clamp(hi)];
}

/** Signed share-price change from one pool sqrt price to another, in bps (2 decimals). */
export function priceChangeBps(fromSqrtPriceX96: bigint, toSqrtPriceX96: bigint, usdcIsCurrency0: boolean): number | null {
  const a = sqrtPriceX96ToPriceQ96(fromSqrtPriceX96, usdcIsCurrency0);
  const b = sqrtPriceX96ToPriceQ96(toSqrtPriceX96, usdcIsCurrency0);
  if (a === 0n) return null;
  return Number(((b - a) * 1_000_000n) / a) / 100;
}

/**
 * Pool sqrt price after an exact-input swap that stays inside one liquidity range (v4 SqrtPriceMath, LP fee taken
 * from the input). Exact for the demo's single full-range position; an estimate when other ranges would be crossed.
 */
export function sqrtPriceAfterExactIn(p: { sqrtPriceX96: bigint; liquidity: bigint; amountIn: bigint; feePips: number; zeroForOne: boolean }): bigint | null {
  const { sqrtPriceX96, liquidity, zeroForOne } = p;
  if (sqrtPriceX96 === 0n || liquidity === 0n) return null;
  const amount = (p.amountIn * (1_000_000n - BigInt(p.feePips))) / 1_000_000n;
  if (zeroForOne) {
    const num = liquidity * Q96;
    const den = num + amount * sqrtPriceX96;
    return (num * sqrtPriceX96 + den - 1n) / den;
  }
  return sqrtPriceX96 + (amount * Q96) / liquidity;
}

/** Full-range position token amounts at `sqrtPriceX96` for `liquidity`, ignoring the range edges. */
export function fullRangeAmounts(liquidity: bigint, sqrtPriceX96: bigint): { amount0: bigint; amount1: bigint } {
  if (sqrtPriceX96 === 0n) return { amount0: 0n, amount1: 0n };
  return { amount0: (liquidity * Q96) / sqrtPriceX96, amount1: (liquidity * sqrtPriceX96) / Q96 };
}

/** "1.10" for whole points, "1.045" when a band edge falls between points. */
export function formatLot(price: number): string {
  return price.toFixed(Math.abs(price * 100 - Math.round(price * 100)) < 1e-6 ? 2 : 3);
}

export function iso(unixSeconds: bigint | number | null | undefined): string | null {
  if (unixSeconds === null || unixSeconds === undefined) return null;
  const n = Number(unixSeconds);
  if (n === 0) return null;
  return new Date(n * 1000).toISOString();
}
