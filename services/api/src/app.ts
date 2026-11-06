import { basename } from "node:path";

import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { BaseError } from "viem";

import { errorCatalog } from "./abis.ts";
import { originAllowed, readDeployments } from "./config.ts";
import { allListings, getListing, head, type Ctx } from "./context.ts";
import { HttpError, badRequest } from "./errors.ts";
import { parseAddress, prepareBid, prepareClaim, prepareExit, prepareSwap } from "./prepare.ts";
import { auctionView, bidsView, clearingSeries, eligibilityView } from "./reads/auction.ts";
import { configView } from "./reads/config.ts";
import { issuerView } from "./reads/issuer.ts";
import { ensView, listingDetail, listingSummary } from "./reads/listing.ts";
import { marketView, policyView, swapsView } from "./reads/market.ts";
import { policyHistory } from "./reads/policy-history.ts";
import { portfolioView } from "./reads/portfolio.ts";
import type { ApiError, BidsResponse, ClearingResponse, ErrorCatalog, Health, ListingsResponse } from "./types.ts";
import { iso } from "./units.ts";

/** JSON with bigint -> string, so a stray raw value can never crash a response. */
function json(c: Context, data: unknown, status: 200 | 400 | 404 | 409 | 500 | 502 | 503 = 200) {
  const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return c.body(body, status, { "content-type": "application/json; charset=utf-8" });
}

function errorBody(code: string, message: string, details?: unknown): ApiError {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

/** RPC URL without credentials or path (API keys often live in the path). */
export function redactRpc(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "invalid";
  }
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("body must be JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw badRequest("body must be a JSON object");
  return body as Record<string, unknown>;
}

function tickerOf(body: Record<string, unknown>): string {
  if (typeof body.ticker !== "string" || body.ticker === "") throw badRequest("ticker is required");
  return body.ticker;
}

function uintQuery(c: Context, name: string): bigint | undefined {
  const v = c.req.query(name);
  if (v === undefined || v === "") return undefined;
  if (!/^\d+$/.test(v)) throw badRequest(`${name} must be a non-negative integer`);
  return BigInt(v);
}

function limitQuery(c: Context): number {
  const limit = Number(uintQuery(c, "limit") ?? 100n);
  if (limit < 1 || limit > 1000) throw badRequest("limit must be in [1, 1000]");
  return limit;
}

export function createApp(ctx: Ctx): Hono {
  const app = new Hono();
  const origins = ctx.config.corsOrigins;

  app.use(
    "*",
    cors({
      origin: origins.includes("*") ? "*" : (origin) => (originAllowed(origin, origins) ? origin : null),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["content-type"],
      maxAge: 600,
    }),
  );
  app.use("*", async (c, next) => {
    await next();
    c.header("cache-control", "no-store");
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return json(c, errorBody(err.code, err.message, err.details), err.status as 400 | 404 | 409);
    if (err instanceof BaseError) {
      console.error(`[api] ${c.req.method} ${c.req.path}: ${err.shortMessage}`);
      return json(c, errorBody("RPC_ERROR", err.shortMessage, { name: err.name }), 502);
    }
    console.error(`[api] ${c.req.method} ${c.req.path}:`, err);
    return json(c, errorBody("INTERNAL", err instanceof Error ? err.message : String(err)), 500);
  });
  app.notFound((c) => json(c, errorBody("NOT_FOUND", `no route ${c.req.method} ${c.req.path}`), 404));

  app.get("/health", async (c) => {
    const deployments = readDeployments(ctx.config).map((d) => {
      const file = basename(d.file);
      return d.error === undefined ? { file, ticker: d.ticker, ok: true } : { file, ticker: d.ticker, ok: false, error: d.error.split(d.file).join(file) };
    });
    const base = { chainId: ctx.config.chainId, rpc: redactRpc(ctx.config.rpcUrl), deployments };
    try {
      const [rpcChainId, block] = await Promise.all([ctx.client.getChainId(), ctx.client.getBlockNumber()]);
      const chainOk = rpcChainId === ctx.config.chainId;
      const out: Health = {
        ok: chainOk && deployments.some((d) => d.ok),
        rpcChainId,
        block: Number(block),
        ...base,
        ...(chainOk ? {} : { error: `RPC chain id ${rpcChainId} != expected ${ctx.config.chainId}` }),
      };
      return json(c, out, out.ok ? 200 : 503);
    } catch (e) {
      const out: Health = { ok: false, rpcChainId: null, block: null, ...base, error: e instanceof BaseError ? e.shortMessage : String(e) };
      return json(c, out, 503);
    }
  });

  app.get("/v1/listings", async (c) => {
    const h = await head(ctx);
    const listings = await Promise.all(allListings(ctx).map((l) => listingSummary(ctx, l, h)));
    const out: ListingsResponse = { parent: ctx.config.parentName, chainId: ctx.config.chainId, currentBlock: Number(h.number), now: iso(h.timestamp)!, listings };
    return json(c, out);
  });

  app.get("/v1/listings/:ticker", async (c) => {
    const l = getListing(ctx, c.req.param("ticker"));
    return json(c, await listingDetail(ctx, l, await head(ctx)));
  });

  app.get("/v1/ens/:ticker", async (c) => json(c, await ensView(ctx, getListing(ctx, c.req.param("ticker")))));

  app.get("/v1/auction/:ticker", async (c) => {
    const l = getListing(ctx, c.req.param("ticker"));
    return json(c, await auctionView(ctx, l, await head(ctx)));
  });

  app.get("/v1/auction/:ticker/clearing", async (c) => {
    const l = getListing(ctx, c.req.param("ticker"));
    const out: ClearingResponse = { ticker: l.ticker, auction: l.auction, series: await clearingSeries(ctx, l, await head(ctx)) };
    return json(c, out);
  });

  app.get("/v1/bids", async (c) => {
    const ticker = c.req.query("ticker") || null;
    const ownerQ = c.req.query("owner");
    const owner = ownerQ ? parseAddress(ownerQ, "owner") : null;
    const ls = ticker ? [getListing(ctx, ticker)] : allListings(ctx);
    const { bids, committed } = await bidsView(ctx, ls, await head(ctx), owner ?? undefined);
    const out: BidsResponse = { ticker: ticker && ls[0] ? ls[0].ticker : null, owner, bids, committed };
    return json(c, out);
  });

  app.get("/v1/eligibility", async (c) => {
    const ticker = c.req.query("ticker");
    if (!ticker) throw badRequest("ticker is required");
    const address = parseAddress(c.req.query("address"), "address");
    const l = getListing(ctx, ticker);
    return json(c, await eligibilityView(ctx, l, await head(ctx), address, "open"));
  });

  app.get("/v1/policy/:ticker", async (c) => {
    const l = getListing(ctx, c.req.param("ticker"));
    return json(c, await policyView(ctx, l, await head(ctx)));
  });

  app.get("/v1/policy/:ticker/history", async (c) => {
    const l = getListing(ctx, c.req.param("ticker"));
    return json(c, await policyHistory(ctx, l, await head(ctx)));
  });

  app.get("/v1/market/:ticker", async (c) => {
    const l = getListing(ctx, c.req.param("ticker"));
    const limit = limitQuery(c);
    return json(c, await marketView(ctx, l, await head(ctx), { limit }));
  });

  app.get("/v1/market/:ticker/swaps", async (c) => {
    const l = getListing(ctx, c.req.param("ticker"));
    const limit = limitQuery(c);
    const fromBlock = uintQuery(c, "fromBlock");
    return json(c, await swapsView(ctx, l, await head(ctx), { limit, fromBlock }));
  });

  app.get("/v1/issuer/:ticker", async (c) => {
    const l = getListing(ctx, c.req.param("ticker"));
    const q = c.req.query("address");
    const address = q ? parseAddress(q, "address") : null;
    return json(c, await issuerView(ctx, l, await head(ctx), address));
  });

  app.get("/v1/portfolio/:address", async (c) => {
    const address = parseAddress(c.req.param("address"), "address");
    const ticker = c.req.query("ticker");
    const ls = ticker ? [getListing(ctx, ticker)] : allListings(ctx);
    return json(c, await portfolioView(ctx, ls, await head(ctx), address));
  });

  app.get("/v1/config", (c) => json(c, configView(ctx.config)));

  app.get("/v1/errors", (c) => {
    const out: ErrorCatalog = { errors: errorCatalog() };
    return json(c, out);
  });

  const prepare = { bid: prepareBid, swap: prepareSwap, exit: prepareExit, claim: prepareClaim } as const;
  for (const [action, fn] of Object.entries(prepare)) {
    app.post(`/v1/prepare/${action}`, async (c) => {
      const body = await readBody(c);
      const l = getListing(ctx, tickerOf(body));
      return json(c, await fn(ctx, l, body));
    });
  }

  return app;
}
