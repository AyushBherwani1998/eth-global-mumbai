import { readFileSync } from "node:fs";

import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

import type { WorldEnvironment } from "./world.ts";

/** One 'human' listing: the World ID action and the onchain addresses the pass is bound to. */
export type Listing = {
  ticker: string;
  /** World ID action, `listingday-<ticker>`: the nullifier is unique per human for this action. */
  action: string;
  chainId: number;
  /** The CCA (pass.auction). */
  auction: Address;
  /** The WorldPassModule (EIP-712 verifyingContract). */
  module: Address;
  /** Per-human cumulative cap in raw currency units (6-decimal USDC). */
  cap: bigint;
};

export type Config = {
  host: string;
  port: number;
  corsOrigin: string;
  world: {
    appId: string;
    rpId: string;
    rpSigningKey: Hex;
    environment: WorldEnvironment;
    verifyBaseUrl: string;
    allowLegacyProofs: boolean;
    rpRequestTtlSeconds: number;
  };
  passSignerKey: Hex;
  passTtlSeconds: number;
  dbPath: string;
  listings: Map<string, Listing>;
};

export class ConfigError extends Error {}

const TICKER = /^[a-z0-9][a-z0-9-]{0,30}$/;

export function actionFor(ticker: string): string {
  return `listingday-${ticker}`;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name]?.trim();
  if (!v) throw new ConfigError(`${name} is required (see .env.example)`);
  return v;
}

function privateKey(env: NodeJS.ProcessEnv, name: string): Hex {
  const raw = required(env, name);
  const v = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  if (!isHex(v) || v.length !== 66) throw new ConfigError(`${name} must be a 32-byte hex private key`);
  return v;
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) throw new ConfigError(`${name} must be a positive integer`);
  return n;
}

export function parseListings(json: string): Map<string, Listing> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ConfigError("LISTINGS is not valid JSON");
  }
  if (!Array.isArray(raw) || raw.length === 0) throw new ConfigError("LISTINGS must be a non-empty JSON array");
  const out = new Map<string, Listing>();
  for (const [i, entry] of raw.entries()) {
    const e = entry as Record<string, unknown>;
    const where = `LISTINGS[${i}]`;
    const ticker = typeof e.ticker === "string" ? e.ticker.toLowerCase() : "";
    if (!TICKER.test(ticker)) throw new ConfigError(`${where}.ticker must match ${TICKER}`);
    if (out.has(ticker)) throw new ConfigError(`${where}: duplicate ticker ${ticker}`);
    const chainId = Number(e.chainId);
    if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new ConfigError(`${where}.chainId is invalid`);
    for (const k of ["auction", "module"] as const) {
      if (typeof e[k] !== "string" || !isAddress(e[k] as string, { strict: false })) {
        throw new ConfigError(`${where}.${k} must be an address`);
      }
    }
    let cap: bigint;
    try {
      cap = BigInt(e.cap as string);
    } catch {
      throw new ConfigError(`${where}.cap must be an integer (raw currency units)`);
    }
    if (cap <= 0n || cap >= 1n << 128n) throw new ConfigError(`${where}.cap must fit uint128 and be > 0`);
    out.set(ticker, {
      ticker,
      action: actionFor(ticker),
      chainId,
      auction: getAddress(e.auction as string),
      module: getAddress(e.module as string),
      cap,
    });
  }
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const environment = (env.WORLD_ENVIRONMENT?.trim() || "staging") as WorldEnvironment;
  if (environment !== "staging" && environment !== "production") {
    throw new ConfigError('WORLD_ENVIRONMENT must be "staging" (simulator, the demo) or "production"');
  }
  const appId = required(env, "WORLD_APP_ID");
  if (!appId.startsWith("app_")) throw new ConfigError("WORLD_APP_ID must look like app_...");
  const rpId = required(env, "WORLD_RP_ID");
  if (!rpId.startsWith("rp_")) throw new ConfigError("WORLD_RP_ID must look like rp_...");
  const listingsJson = env.LISTINGS_FILE?.trim() ? readFileSync(env.LISTINGS_FILE.trim(), "utf8") : required(env, "LISTINGS");
  const legacy = env.WORLD_ALLOW_LEGACY_PROOFS?.trim() || "false";
  if (legacy !== "true" && legacy !== "false") throw new ConfigError("WORLD_ALLOW_LEGACY_PROOFS must be true or false");

  return {
    host: env.HOST?.trim() || "127.0.0.1",
    port: positiveInt(env, "PORT", 8788),
    corsOrigin: env.CORS_ORIGIN?.trim() || "*",
    world: {
      appId,
      rpId,
      rpSigningKey: privateKey(env, "WORLD_RP_SIGNING_KEY"),
      environment,
      verifyBaseUrl: env.WORLD_VERIFY_BASE_URL?.trim() || "https://developer.world.org",
      allowLegacyProofs: legacy === "true",
      rpRequestTtlSeconds: positiveInt(env, "WORLD_RP_REQUEST_TTL_SECONDS", 300),
    },
    passSignerKey: privateKey(env, "PASS_SIGNER_KEY"),
    passTtlSeconds: positiveInt(env, "PASS_TTL_SECONDS", 600),
    dbPath: env.DB_PATH?.trim() || "data/verify.sqlite",
    listings: parseListings(listingsJson),
  };
}
