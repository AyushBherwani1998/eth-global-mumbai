/**
 * Pure workflow logic (no CRE runtime): mock exchange JSON -> `ListingPolicy` -> report payload bytes for
 * `ListingPolicyReceiver.onReport`. Kept separate from `workflow.ts` so it can be unit-tested and golden-checked
 * against the Solidity side (`contracts/test/unit/CreReportFixture.t.sol`).
 */
import { encodeAbiParameters, type Hex } from "viem";

export const MODES = ["normal", "surveillance", "directional"] as const;
export const STATUSES = ["", "draft", "auction", "listed", "surveillance", "halted"] as const;
export type Status = (typeof STATUSES)[number];

/** The subset of the mock exchange `GET /policy` body the workflow consumes, normalised. */
export type ExchangeSnapshot = {
  /** Reference price in points * 100 (10_450 = 104.50 points); 0 = listing price. */
  refPointsE2: number;
  mode: 0 | 1 | 2;
  halted: boolean;
  coolOffUntil: number;
  normalBandBps: number;
  survBandBps: number;
  status: Status;
};

/** Mirrors the Solidity `ListingPolicy` struct (field order matters for the ABI encoding). */
export type ListingPolicy = {
  version: number;
  asOf: bigint;
  chainSelector: bigint;
  refSqrtPriceX96: bigint;
  normalBandBps: number;
  survBandBps: number;
  mode: number;
  halted: boolean;
  coolOffUntil: bigint;
};

export const LISTING_POLICY_ABI = {
  type: "tuple",
  components: [
    { name: "version", type: "uint32" },
    { name: "asOf", type: "uint64" },
    { name: "chainSelector", type: "uint64" },
    { name: "refSqrtPriceX96", type: "uint160" },
    { name: "normalBandBps", type: "uint16" },
    { name: "survBandBps", type: "uint16" },
    { name: "mode", type: "uint8" },
    { name: "halted", type: "bool" },
    { name: "coolOffUntil", type: "uint64" },
  ],
} as const;

/** `ListingPolicyReceiver` decodes `abi.decode(report, (ListingPolicy, string))`. */
export const REPORT_ABI = [LISTING_POLICY_ABI, { name: "status", type: "string" }] as const;

const MAX_BPS = 9999;
const MAX_POINTS = 1_000_000;
const MAX_UINT64 = (1n << 64n) - 1n;

/** Validates and normalises the API body. Throws with every problem listed. */
export function parseExchangePolicy(body: unknown): ExchangeSnapshot {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("exchange policy: body must be a JSON object");
  }
  const b = body as Record<string, unknown>;
  const errors: string[] = [];

  let refPointsE2 = 0;
  if (b.refPricePoints !== null && b.refPricePoints !== undefined) {
    const v = b.refPricePoints;
    const e2 = typeof v === "number" ? Math.round(v * 100) : Number.NaN;
    if (typeof v !== "number" || !(v > 0) || v > MAX_POINTS || Math.abs(e2 - v * 100) > 1e-6) {
      errors.push("refPricePoints must be null or a positive number with at most 2 decimals");
    } else refPointsE2 = e2;
  }

  let mode: 0 | 1 | 2 = 0;
  const m = b.mode ?? "normal";
  const idx = typeof m === "number" ? m : MODES.indexOf(m as (typeof MODES)[number]);
  if (!Number.isInteger(idx) || idx < 0 || idx > 2) errors.push(`mode must be one of ${MODES.join(", ")}`);
  else mode = idx as 0 | 1 | 2;

  const halted = b.halted ?? false;
  if (typeof halted !== "boolean") errors.push("halted must be a boolean");

  const coolOffUntil = b.coolOffUntil ?? 0;
  if (typeof coolOffUntil !== "number" || !Number.isSafeInteger(coolOffUntil) || coolOffUntil < 0) {
    errors.push("coolOffUntil must be a non-negative integer (unix seconds)");
  }

  const bands = (b.bands ?? {}) as Record<string, unknown>;
  const band = (key: string): number => {
    const v = bands[key] ?? 0;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_BPS) {
      errors.push(`bands.${key} must be an integer in [0, ${MAX_BPS}]`);
      return 0;
    }
    return v;
  };
  const normalBandBps = band("normalBps");
  const survBandBps = band("surveillanceBps");

  const status = b.status ?? "";
  if (typeof status !== "string" || !(STATUSES as readonly string[]).includes(status)) {
    errors.push(`status must be one of ${STATUSES.map((s) => JSON.stringify(s)).join(", ")}`);
  }

  if (errors.length > 0) throw new Error(`exchange policy: ${errors.join("; ")}`);
  return {
    refPointsE2,
    mode,
    halted: halted as boolean,
    coolOffUntil: coolOffUntil as number,
    normalBandBps,
    survBandBps,
    status: status as Status,
  };
}

const Q96 = 1n << 96n;

function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  return (a * b) / d;
}

/** floor(sqrt(n)), as OpenZeppelin `Math.sqrt`. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("isqrt of negative");
  if (n < 2n) return n;
  let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/**
 * Bit-exact port of `ListingPrice.pointsE2ToSqrtPriceX96`: points * 100 -> the pool's v4 sqrtPriceX96.
 * USDC (6 decimals) per 1,000-share lot (18 decimals), so 1 point = 0.01 USDC per lot = 1e4 raw / 1e21 raw.
 */
export function pointsE2ToSqrtPriceX96(pointsE2: bigint, usdcIsCurrency0: boolean): bigint {
  if (pointsE2 <= 0n) throw new Error("pointsE2 must be positive");
  const priceQ96 = mulDiv(pointsE2, Q96, 10n ** 19n);
  const priceX192 = usdcIsCurrency0 ? mulDiv(Q96 << 96n, Q96, priceQ96) : priceQ96 << 96n;
  return isqrt(priceX192);
}

export type BuildOptions = {
  /** Execution time in unix seconds (strictly increasing between accepted reports). */
  asOf: bigint;
  chainSelector: bigint;
  usdcIsCurrency0: boolean;
};

/** `version` is left 0: the receiver assigns versions itself. */
export function buildListingPolicy(s: ExchangeSnapshot, o: BuildOptions): ListingPolicy {
  if (o.asOf <= 0n || o.asOf > MAX_UINT64) throw new Error("asOf out of range");
  return {
    version: 0,
    asOf: o.asOf,
    chainSelector: o.chainSelector,
    refSqrtPriceX96: s.refPointsE2 === 0 ? 0n : pointsE2ToSqrtPriceX96(BigInt(s.refPointsE2), o.usdcIsCurrency0),
    normalBandBps: s.normalBandBps,
    survBandBps: s.survBandBps,
    mode: s.mode,
    halted: s.halted,
    coolOffUntil: BigInt(s.coolOffUntil),
  };
}

export function encodeReport(policy: ListingPolicy, status: Status): Hex {
  return encodeAbiParameters(REPORT_ABI, [policy, status]);
}
