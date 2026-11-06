/**
 * Exchange-side listing policy: the editable JSON the CRE workflow reads and encodes into a `ListingPolicy`
 * report for `ListingPolicyReceiver`. Prices are in points (100 = 1.00 USDC per 1,000-share lot).
 */

export const MODES = ["normal", "surveillance", "directional"] as const;
export type Mode = (typeof MODES)[number];

/** Values the receiver mirrors to ENS `listingday.status`; "" lets the receiver derive it from the policy. */
export const STATUSES = ["", "draft", "auction", "listed", "surveillance", "halted"] as const;
export type Status = (typeof STATUSES)[number];

export type Bands = {
  /** Normal band half-width in bps of the share price (modes normal + directional). 0 = hook default 2000. */
  normalBps: number;
  /** Surveillance band half-width (mode surveillance, and the directional tolerance). 0 = hook default 500. */
  surveillanceBps: number;
};

export type ExchangePolicy = {
  ticker: string;
  /** Reference share price in points, up to 2 decimals (104.5 ok). null = the listing (clearing) price. */
  refPricePoints: number | null;
  mode: Mode;
  halted: boolean;
  /** Unix seconds; swaps revert before it. 0 = no cool-off. */
  coolOffUntil: number;
  bands: Bands;
  status: Status;
  /** Bumped by the server on every edit. */
  revision: number;
  /** Unix seconds of the last edit. */
  updatedAt: number;
};

export type PolicyEdit = Partial<Omit<ExchangePolicy, "bands" | "revision" | "updatedAt" | "mode">> & {
  bands?: Partial<Bands>;
  mode?: Mode | 0 | 1 | 2;
};

export const MAX_BPS = 9999;
export const MAX_POINTS = 1_000_000;
export const MAX_TIMESTAMP = 2 ** 40;

export function defaultPolicy(ticker = "ACME", now = nowSeconds()): ExchangePolicy {
  return {
    ticker,
    refPricePoints: null,
    mode: "normal",
    halted: false,
    coolOffUntil: 0,
    bands: { normalBps: 2000, surveillanceBps: 500 },
    status: "",
    revision: 0,
    updatedAt: now,
  };
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

const EDITABLE = new Set(["ticker", "refPricePoints", "mode", "halted", "coolOffUntil", "bands", "status"]);
const BAND_KEYS = new Set(["normalBps", "surveillanceBps"]);

export class PolicyValidationError extends Error {
  readonly details: string[];
  constructor(details: string[]) {
    super(`invalid policy: ${details.join("; ")}`);
    this.details = details;
  }
}

/**
 * Applies `edit` on top of `base` (a partial merge; `bands` merges per field), validates the result and bumps
 * `revision` / `updatedAt`. Throws `PolicyValidationError` listing every problem.
 */
export function applyEdit(base: ExchangePolicy, edit: unknown, now = nowSeconds()): ExchangePolicy {
  const errors: string[] = [];
  if (typeof edit !== "object" || edit === null || Array.isArray(edit)) {
    throw new PolicyValidationError(["body must be a JSON object"]);
  }
  const e = edit as Record<string, unknown>;
  for (const k of Object.keys(e)) {
    if (!EDITABLE.has(k)) errors.push(`unknown or read-only field "${k}"`);
  }

  const next: ExchangePolicy = { ...base, bands: { ...base.bands } };

  if ("ticker" in e) {
    if (typeof e.ticker !== "string" || e.ticker.length === 0 || e.ticker.length > 16) {
      errors.push("ticker must be a 1-16 character string");
    } else next.ticker = e.ticker;
  }
  if ("refPricePoints" in e) {
    const v = e.refPricePoints;
    if (v === null) next.refPricePoints = null;
    else if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > MAX_POINTS) {
      errors.push(`refPricePoints must be null or a number in (0, ${MAX_POINTS}]`);
    } else if (Math.abs(Math.round(v * 100) - v * 100) > 1e-6) {
      errors.push("refPricePoints allows at most 2 decimals");
    } else next.refPricePoints = v;
  }
  if ("mode" in e) {
    const v = e.mode;
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < MODES.length) next.mode = MODES[v];
    else if (typeof v === "string" && (MODES as readonly string[]).includes(v)) next.mode = v as Mode;
    else errors.push(`mode must be one of ${MODES.join(", ")} (or 0, 1, 2)`);
  }
  if ("halted" in e) {
    if (typeof e.halted !== "boolean") errors.push("halted must be a boolean");
    else next.halted = e.halted;
  }
  if ("coolOffUntil" in e) {
    const v = e.coolOffUntil;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v >= MAX_TIMESTAMP) {
      errors.push("coolOffUntil must be an integer unix timestamp in seconds (0 = none)");
    } else next.coolOffUntil = v;
  }
  if ("bands" in e) {
    const b = e.bands;
    if (typeof b !== "object" || b === null || Array.isArray(b)) errors.push("bands must be an object");
    else {
      for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
        if (!BAND_KEYS.has(k)) errors.push(`unknown bands field "${k}"`);
        else if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_BPS) {
          errors.push(`bands.${k} must be an integer in [0, ${MAX_BPS}] (0 = hook default)`);
        } else next.bands[k as keyof Bands] = v;
      }
    }
  }
  if ("status" in e) {
    const v = e.status;
    if (typeof v !== "string" || !(STATUSES as readonly string[]).includes(v)) {
      errors.push(`status must be one of ${STATUSES.map((s) => JSON.stringify(s)).join(", ")}`);
    } else next.status = v as Status;
  }

  if (errors.length > 0) throw new PolicyValidationError(errors);
  next.revision = base.revision + 1;
  next.updatedAt = now;
  return next;
}

/** Full replacement: every editable field not in `body` falls back to its default. */
export function replacePolicy(base: ExchangePolicy, body: unknown, now = nowSeconds()): ExchangePolicy {
  const fresh = { ...defaultPolicy(base.ticker, now), revision: base.revision };
  return applyEdit(fresh, body, now);
}
