// Exact amounts for the write path. What the user types is parsed into raw
// integer units here and sent to services/api as `*Raw` strings, so nothing is
// ever rounded through a float on its way to a transaction.
//
// No runtime imports: this file runs under `node --test` as well as in Next.

export const USDC_DECIMALS = 6;
export const SHARE_DECIMALS = 18;
export const BPS = 10_000n;

export type Parsed = { ok: true; raw: bigint; value: number } | { ok: false; error: string };

/**
 * "12.5" -> 12_500_000n at 6 decimals. Accepts digits with an optional single
 * point and grouping commas ("1,000.25"). Rejects signs, exponents, blanks and
 * more fraction digits than the token has, with a sentence that names the fix.
 */
export function parseAmount(input: string, decimals: number): Parsed {
  const s = input.trim().replace(/,/g, "");
  if (s === "") return { ok: false, error: "Enter an amount." };
  if (!/^\d*\.?\d*$/.test(s) || s === ".") return { ok: false, error: "Use digits and one decimal point only." };
  const [whole = "", frac = ""] = s.split(".");
  if (frac.length > decimals) return { ok: false, error: `Use at most ${decimals} digits after the point.` };
  const raw = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (raw === 0n) return { ok: false, error: "Enter an amount above zero." };
  return { ok: true, raw, value: Number(s) };
}

/** 12_500_000n at 6 decimals -> "12.5". Exact; trailing zeros dropped. */
export function formatRaw(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Minimum output after slippage, rounded down so the floor is never above what the user accepted. */
export function minOutAfterSlippage(rawOut: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) throw new Error("slippageBps must be an integer in [0, 10000)");
  return (rawOut * (BPS - BigInt(slippageBps))) / BPS;
}

/** Percent choice ("0.5") -> basis points (50). */
export function slippageToBps(pct: string): number {
  const n = Math.round(Number(pct) * 100);
  if (!Number.isFinite(n) || n < 0 || n >= 10_000) throw new Error(`bad slippage ${pct}`);
  return n;
}

/**
 * A lot price (USDC per 1,000 shares, e.g. 1.3) -> the auction's integer price
 * points (130). The auction ticks in whole points, so a price is rounded down to
 * the tick: bidding "1.299" means at most 1.29, never more than the user typed.
 */
export function priceToPoints(lotPrice: number): number {
  return Math.floor(Math.round(lotPrice * 1e6) / 1e4);
}
