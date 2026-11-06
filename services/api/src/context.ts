import type { Block } from "viem";

import { type Client } from "./chain.ts";
import { listings, type Config, type Listing } from "./config.ts";
import { notFound } from "./errors.ts";

export type Ctx = { config: Config; client: Client };

/** Every listing whose deployments file is readable right now. */
export function allListings(ctx: Ctx): Listing[] {
  return listings(ctx.config);
}

export function getListing(ctx: Ctx, ticker: string): Listing {
  const t = ticker.toLowerCase();
  const l = allListings(ctx).find((x) => x.ticker === t);
  if (!l) throw notFound("UNKNOWN_TICKER", `no listing "${ticker}" in DEPLOYMENTS_FILES`);
  return l;
}

/** The block every read of one request is pinned to, so a response is one consistent snapshot. */
export type Head = { number: bigint; timestamp: bigint };

export async function head(ctx: Ctx): Promise<Head> {
  const b: Block = await ctx.client.getBlock({ blockTag: "latest" });
  return { number: b.number ?? 0n, timestamp: b.timestamp };
}
