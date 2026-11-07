import { basename } from "node:path";

import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { BaseError, getAddress, isAddress, type Address, type Hex } from "viem";

import { errorCatalog } from "./abis.ts";
import { extractSignedRequest, isAuthorizedIssuer, loadAuthConfig, verifySignedRequest, NonceStore, type AuthConfig } from "./auth.ts";
import { originAllowed, readDeployments } from "./config.ts";
import { allListings, getListing, head, type Ctx } from "./context.ts";
import { HttpError, badRequest } from "./errors.ts";
import { ListingCreationStorage, type ListingCreationState } from "./listing-creation.ts";
import { parseAddress, prepareBid, prepareClaim, prepareExit, prepareSwap } from "./prepare.ts";
import { auctionView, bidsView, clearingSeries, eligibilityView } from "./reads/auction.ts";
import { configView } from "./reads/config.ts";
import { issuerView } from "./reads/issuer.ts";
import { ensView, listingDetail, listingSummary } from "./reads/listing.ts";
import { marketView, policyView, swapsView } from "./reads/market.ts";
import { policyHistory } from "./reads/policy-history.ts";
import { relayPolicyReport } from "./policy-relay.ts";
import { simulateDirectional } from "./directional-simulation.ts";
import { portfolioView } from "./reads/portfolio.ts";
import { determineCurrentStep } from "./deployment-utils.ts";
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
  
  // Initialize auth config, nonce store, and listing creation storage
  const authConfig: AuthConfig = loadAuthConfig(process.env);
  const nonceStore = new NonceStore(process.env.NONCE_STORE_PATH || "/data/nonces.json");
  const listingStorage = new ListingCreationStorage(process.env.LISTING_STATE_PATH);
  
  // Clean up old nonces periodically (every hour)
  setInterval(() => {
    nonceStore.cleanup(authConfig.maxSignatureAge || 300);
  }, 3600000);

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

  // Listing creation endpoints
  app.post("/v1/listings/create", async (c) => {
    const signedReq = await extractSignedRequest(c);
    const issuerAddress = await verifySignedRequest(signedReq, authConfig, ctx.config.chainId, nonceStore);

    if (signedReq.action !== "create_listing") {
      throw badRequest("Invalid action for this endpoint");
    }

    const payload = signedReq.payload as Record<string, unknown>;
    const ticker = payload.ticker;
    const tokenName = payload.tokenName;
    const tokenSymbol = payload.tokenSymbol;

    if (typeof ticker !== "string" || !ticker) {
      throw badRequest("Missing or invalid ticker");
    }
    if (typeof tokenName !== "string" || !tokenName) {
      throw badRequest("Missing or invalid tokenName");
    }
    if (typeof tokenSymbol !== "string" || !tokenSymbol) {
      throw badRequest("Missing or invalid tokenSymbol");
    }

    // Create listing creation record
    const listing = listingStorage.create({
      ticker,
      tokenName,
      tokenSymbol,
      issuerAddress,
      deploymentConfig: payload.config as ListingCreationState["deploymentConfig"],
    });

    // Get first deployment step (MockSME token)
    const { getNextDeploymentStep } = await import("./deployment-complete.ts");
    const { prepareTokenDeployment } = await import("./deployment-complete.ts");
    
    try {
      // For now, return the creation ID and let browser poll for steps
      // Full implementation would prepare first step here
      return json(c, { 
        success: true, 
        listing,
        message: "Listing creation initiated. Use GET /v1/listings/creation/:id/next-step to get deployment steps."
      });
    } catch (error) {
      return json(c, {
        error: {
          code: "DEPLOYMENT_PREP_FAILED",
          message: error instanceof Error ? error.message : String(error),
        }
      }, 500);
    }
  });

  app.get("/v1/listings/creation/:id", async (c) => {
    const id = c.req.param("id");
    const listing = listingStorage.get(id);
    if (!listing) {
      return json(c, { error: { code: "NOT_FOUND", message: "Listing creation not found" } }, 404);
    }
    return json(c, listing);
  });

  app.get("/v1/listings/creations", async (c) => {
    const address = c.req.query("issuer");
    let listings: ListingCreationState[];
    
    if (address) {
      if (!isAddress(address)) {
        throw badRequest("Invalid issuer address");
      }
      listings = listingStorage.getByIssuer(getAddress(address));
    } else {
      listings = listingStorage.list();
    }
    
    return json(c, { listings });
  });

  // Get next deployment step for a listing creation - REQUIRES AUTH
  app.post("/v1/listings/creation/:id/next-step", async (c) => {
    const signedReq = await extractSignedRequest(c);
    const issuerAddress = await verifySignedRequest(signedReq, authConfig, ctx.config.chainId, nonceStore);
    
    const id = c.req.param("id");
    const listing = listingStorage.get(id);
    
    if (!listing) {
      return json(c, { error: { code: "NOT_FOUND", message: "Listing creation not found" } }, 404);
    }
    
    // Verify requester is the listing issuer
    if (listing.issuerAddress.toLowerCase() !== issuerAddress.toLowerCase()) {
      return json(c, { error: { code: "FORBIDDEN", message: "Not authorized for this listing" } }, 400);
    }

    // Determine current deployment state from listing
    const deploymentState = {
      token: listing.tokenAddress,
      module: listing.moduleAddress,
      validationHook: listing.validationHookAddress,
      hook: listing.hookAddress,
      receiver: listing.receiverAddress,
      currentStep: determineCurrentStep(listing),
      completed: listing.phase === "completed",
    };

    if (deploymentState.completed) {
      return json(c, { message: "Deployment already complete", listing });
    }

    // Get deployment params from existing deployed listing config
    const existingListings = allListings(ctx);
    if (existingListings.length === 0) {
      return json(c, {
        error: {
          code: "NO_REFERENCE_CONFIG",
          message: "No existing listings found. Need reference deployment config (USDC, PoolManager addresses).",
        }
      }, 500);
    }
    const refListing = existingListings[0]!;
    
    const deploymentParams = {
      tokenName: listing.tokenName,
      tokenSymbol: listing.tokenSymbol,
      issuerAddress: listing.issuerAddress,
      usdc: refListing.external.usdc,
      poolManager: refListing.external.poolManager,
      forwarder: getAddress("0x15fC6ae953E024d975e77382eEeC56A9101f9F88"), // Sepolia MockKeystoneForwarder
      broadcaster: getAddress(process.env.POLICY_BROADCASTER_ADDRESS || "0x6F520A9e473f3f3DAa0EFFf5eF5e1690C86970dA"),
    };

    try {
      const { getNextDeploymentStep } = await import("./deployment-complete.ts");
      
      // Load compiled bytecodes from forge build artifacts
      const mockSMEBytecode = (await import("./bytecode/MockSME.json", { with: { type: "json" } })).default;
      const allowAllModuleBytecode = (await import("./bytecode/AllowAllModule.json", { with: { type: "json" } })).default;
      const validationHookBytecode = (await import("./bytecode/AuctionValidationHook.json", { with: { type: "json" } })).default;
      const listingHookBytecode = (await import("./bytecode/ListingHook.json", { with: { type: "json" } })).default;
      const receiverBytecode = (await import("./bytecode/ListingPolicyReceiver.json", { with: { type: "json" } })).default;
      
      const bytecodes = {
        mockSME: mockSMEBytecode.bytecode as Hex,
        allowAllModule: allowAllModuleBytecode.bytecode as Hex,
        auctionValidationHook: validationHookBytecode.bytecode as Hex,
        listingHook: listingHookBytecode.bytecode as Hex,
        listingPolicyReceiver: receiverBytecode.bytecode as Hex,
      };
      
      const nextStep = await getNextDeploymentStep(
        deploymentParams,
        deploymentState,
        listing.issuerAddress,
        ctx.client,
        bytecodes
      );

      if (!nextStep) {
        return json(c, { message: "No next step available" });
      }

      return json(c, { step: nextStep, listing });
    } catch (error) {
      return json(c, {
        error: {
          code: "STEP_PREP_FAILED",
          message: error instanceof Error ? error.message : String(error),
        }
      }, 500);
    }
  });

  // Submit transaction hash after browser signs deployment - REQUIRES AUTH
  app.post("/v1/listings/creation/:id/submit-tx", async (c) => {
    const signedReq = await extractSignedRequest(c);
    const issuerAddress = await verifySignedRequest(signedReq, authConfig, ctx.config.chainId, nonceStore);
    
    const id = c.req.param("id");
    const payload = signedReq.payload as Record<string, unknown>;
    const { txHash, step, expectedTo, expectedData } = payload;

    if (!txHash || typeof txHash !== "string") {
      throw badRequest("Missing txHash");
    }
    if (typeof step !== "number") {
      throw badRequest("Missing step number");
    }

    const listing = listingStorage.get(id);
    if (!listing) {
      return json(c, { error: { code: "NOT_FOUND", message: "Listing creation not found" } }, 404);
    }
    
    // Verify requester is the listing issuer
    if (listing.issuerAddress.toLowerCase() !== issuerAddress.toLowerCase()) {
      return json(c, { error: { code: "FORBIDDEN", message: "Not authorized for this listing" } }, 400);
    }

    try {
      // Fetch and validate transaction
      const tx = await ctx.client.getTransaction({ hash: txHash as Hex });
      
      // Validate transaction parameters
      if (tx.from.toLowerCase() !== issuerAddress.toLowerCase()) {
        throw new Error(`Transaction from ${tx.from}, expected ${issuerAddress}`);
      }
      
      if (tx.chainId !== ctx.config.chainId) {
        throw new Error(`Transaction on chain ${tx.chainId}, expected ${ctx.config.chainId}`);
      }
      
      // If expected params provided, validate them
      if (expectedTo && tx.to && tx.to.toLowerCase() !== (expectedTo as string).toLowerCase()) {
        throw new Error(`Transaction to ${tx.to}, expected ${expectedTo}`);
      }
      
      if (expectedData && tx.input !== expectedData) {
        throw new Error("Transaction data mismatch");
      }
      
      // Wait for transaction receipt
      const receipt = await ctx.client.waitForTransactionReceipt({
        hash: txHash as Hex,
        confirmations: 1,
      });

      if (receipt.status !== "success") {
        listingStorage.update(id, {
          phase: "error",
          error: `Transaction ${txHash} failed`,
        });
        return json(c, { error: { message: "Transaction failed" } }, 400);
      }

      // Extract deployed address from receipt
      // For CREATE2 via factory, contractAddress will be null
      let deployedAddress = receipt.contractAddress;
      
      // If no contractAddress (CREATE2 factory case), derive from tx data
      if (!deployedAddress && step === 1) {
        // For CREATE2, we need to compute the address from salt + initCode
        // This should match the predictedAddress from next-step
        // For now, require it to be provided in the submission
        const providedAddress = payload.predictedAddress as string | undefined;
        if (!providedAddress) {
          throw new Error("CREATE2 deployment requires predictedAddress in submission");
        }
        
        // Verify the predicted address has code
        const code = await ctx.client.getBytecode({ address: providedAddress as Address });
        if (!code || code === "0x") {
          throw new Error(`No code deployed at predicted address ${providedAddress}`);
        }
        
        deployedAddress = providedAddress as Address;
      }
      
      if (!deployedAddress) {
        throw new Error("No contract address in receipt and no predictedAddress provided");
      }

      // Update listing with deployed address
      const updates: Partial<ListingCreationState> = {};
      switch (step) {
        case 1:
          updates.tokenAddress = deployedAddress;
          updates.tokenDeployTx = txHash as Hex;
          updates.phase = "token_deployed";
          break;
        case 2:
          updates.moduleAddress = deployedAddress;
          updates.moduleDeployTx = txHash as Hex;
          updates.phase = "pending_validation";
          break;
        case 3:
          updates.validationHookAddress = deployedAddress;
          updates.validationHookDeployTx = txHash as Hex;
          updates.phase = "validation_deployed";
          break;
        case 4:
          updates.hookAddress = deployedAddress;
          updates.hookDeployTx = txHash as Hex;
          updates.phase = "hook_deployed";
          break;
        case 5:
          updates.receiverAddress = deployedAddress;
          updates.receiverDeployTx = txHash as Hex;
          updates.phase = "receiver_deployed";
          break;
      }

      const updated = listingStorage.update(id, updates);
      
      // Check if deployment is complete
      if (updated.receiverAddress && updated.hookAddress) {
        listingStorage.update(id, { phase: "completed" });
      }

      return json(c, { success: true, listing: updated });
    } catch (error) {
      listingStorage.update(id, {
        phase: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      return json(c, {
        error: {
          code: "TX_PROCESSING_FAILED",
          message: error instanceof Error ? error.message : String(error),
        }
      }, 500);
    }
  });

  app.post("/v1/listings/creation/:id/update", async (c) => {
    const signedReq = await extractSignedRequest(c);
    await verifySignedRequest(signedReq, authConfig, ctx.config.chainId, nonceStore);

    const id = c.req.param("id");
    const payload = signedReq.payload as Record<string, unknown>;

    const listing = listingStorage.get(id);
    if (!listing) {
      return json(c, { error: { code: "NOT_FOUND", message: "Listing creation not found" } }, 404);
    }

    const updated = listingStorage.update(id, payload as Partial<ListingCreationState>);
    return json(c, { success: true, listing: updated });
  });

  // Policy relay endpoint for demo manual relaying
  app.post("/v1/policy/:ticker/relay", async (c) => {
    const signedReq = await extractSignedRequest(c);
    await verifySignedRequest(signedReq, authConfig, ctx.config.chainId, nonceStore);

    const ticker = c.req.param("ticker");
    const listing = getListing(ctx, ticker);

    if (signedReq.action !== "relay_policy") {
      throw badRequest("Invalid action for this endpoint");
    }

    const payload = signedReq.payload as Record<string, unknown>;
    
    // Relay the policy report to the blockchain
    const result = await relayPolicyReport(ctx, listing, payload);
    
    return json(c, { success: true, result });
  });

  // Directional simulation endpoint - READ ONLY, no auth required
  app.get("/v1/policy/:ticker/simulate-directional", async (c) => {
    const listing = getListing(ctx, c.req.param("ticker"));
    
    const testAddressRaw = c.req.query("testAddress");
    const narrowingAmount = c.req.query("narrowingAmount");
    const wideningAmount = c.req.query("wideningAmount");
    
    const result = await simulateDirectional(ctx, listing, {
      testAddress: testAddressRaw ? testAddressRaw as Address : undefined,
      narrowingAmount,
      wideningAmount,
    });
    
    return json(c, result);
  });

  return app;
}
