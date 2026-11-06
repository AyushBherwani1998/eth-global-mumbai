import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { signRequest } from "@worldcoin/idkit-server";
import { getAddress, isAddress, type Address } from "viem";

import type { Config, Listing } from "./config.ts";
import { createPassSigner, passDomain, passToJson, PASS_TYPES, type PassSigner } from "./pass.ts";
import { BindingStore } from "./store.ts";
import { checkIdkitResult, ProofRejected, verifyWithWorld, WorldUnavailable, type IdkitResult } from "./world.ts";

export type VerifyServerOptions = {
  config: Config;
  store?: BindingStore;
  /** Overrides for tests. */
  fetch?: typeof fetch;
  now?: () => number;
};

const MAX_BODY_BYTES = 64 * 1024;
const MAX_PENDING_REQUESTS = 10_000;

type PendingRequest = { ticker: string; wallet: Address; expiresAt: number };

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function createVerifyServer(options: VerifyServerOptions): Server {
  const { config } = options;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const store = options.store ?? new BindingStore(config.dbPath);
  const signer = createPassSigner(config.passSignerKey);
  // RP-signed requests waiting for their proof, by nonce: ties each proof to the wallet it was requested for.
  // In memory and short-lived (WORLD_RP_REQUEST_TTL_SECONDS); a restart only means "verify again".
  const pending = new Map<string, PendingRequest>();

  const handlers: Record<string, (req: IncomingMessage) => Promise<unknown>> = {
    "GET /health": async () => ({
      ok: true,
      environment: config.world.environment,
      passSigner: signer.address,
      listings: [...config.listings.keys()],
    }),
    "GET /v1/listings": async () => ({ listings: [...config.listings.values()].map((l) => publicListing(config, signer, l)) }),
    "POST /v1/idkit/request": async (req) => {
      const body = await readJson(req);
      const listing = listingOf(config, body.ticker);
      const wallet = walletOf(body.wallet);
      const rp = signRequest({
        signingKeyHex: config.world.rpSigningKey,
        action: listing.action,
        ttl: config.world.rpRequestTtlSeconds,
      });
      prune(pending, now());
      if (pending.size >= MAX_PENDING_REQUESTS) throw new HttpError(503, "busy", "too many open verification requests");
      pending.set(rp.nonce.toLowerCase(), {
        ticker: listing.ticker,
        wallet,
        expiresAt: now() + config.world.rpRequestTtlSeconds,
      });
      return {
        app_id: config.world.appId,
        action: listing.action,
        environment: config.world.environment,
        allow_legacy_proofs: config.world.allowLegacyProofs,
        signal: wallet,
        preset: { type: "ProofOfHuman", signal: wallet },
        rp_context: {
          rp_id: config.world.rpId,
          nonce: rp.nonce,
          created_at: rp.createdAt,
          expires_at: rp.expiresAt,
          signature: rp.sig,
        },
      };
    },
    "POST /v1/idkit/verify": async (req) => {
      const body = await readJson(req);
      const listing = listingOf(config, body.ticker);
      const wallet = walletOf(body.wallet);
      const result = body.idkitResponse as IdkitResult | undefined;
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new HttpError(400, "invalid_request", "idkitResponse (the IDKit result object) is required");
      }

      const nonceKey = typeof result.nonce === "string" ? result.nonce.toLowerCase() : "";
      const request = pending.get(nonceKey);
      if (!request || request.expiresAt < now() || request.ticker !== listing.ticker || request.wallet !== wallet) {
        throw new HttpError(
          400,
          "unknown_request",
          "no open verification request for this wallet and listing (request a new one and verify again)",
        );
      }

      const proof = checkIdkitResult(result, {
        action: listing.action,
        environment: config.world.environment,
        signal: wallet,
        allowLegacyProofs: config.world.allowLegacyProofs,
      });
      await verifyWithWorld(result, proof, listing.action, {
        baseUrl: config.world.verifyBaseUrl,
        rpId: config.world.rpId,
        environment: config.world.environment,
        fetch: options.fetch,
      });
      pending.delete(nonceKey);

      const bound = store.bind(listing.action, listing.auction, proof.nullifier, wallet);
      if (!bound.ok) {
        throw new HttpError(
          409,
          bound.conflict,
          bound.conflict === "nullifier_bound_to_other_wallet"
            ? "this person already verified another wallet for this listing"
            : "this wallet is already verified by another person for this listing",
        );
      }

      const signed = await signer.sign(
        { chainId: listing.chainId, module: listing.module },
        {
          nullifier: proof.nullifier,
          wallet,
          auction: listing.auction,
          cap: listing.cap,
          expiry: BigInt(now() + config.passTtlSeconds),
        },
      );
      return {
        pass: passToJson(signed.pass),
        signature: signed.signature,
        hookData: signed.hookData,
        digest: signed.digest,
        chainId: listing.chainId,
        module: listing.module,
        signer: signer.address,
        firstVerification: bound.created,
      };
    },
  };

  return createServer(async (req, res) => {
    setCors(res, config.corsOrigin);
    const path = new URL(req.url ?? "/", "http://localhost").pathname.replace(/\/+$/, "") || "/";
    try {
      if (req.method === "OPTIONS") return send(res, 204);
      const listingMatch = /^\/v1\/listings\/([^/]+)$/.exec(path);
      if (listingMatch && req.method === "GET") {
        return send(res, 200, publicListing(config, signer, listingOf(config, decodeURIComponent(listingMatch[1]))));
      }
      const handler = handlers[`${req.method} ${path}`];
      if (!handler) {
        const known = Object.keys(handlers).some((k) => k.endsWith(` ${path}`));
        return send(res, known ? 405 : 404, { error: known ? "method_not_allowed" : "not_found" });
      }
      return send(res, 200, await handler(req));
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.code, message: err.message, ...err.extra });
      if (err instanceof ProofRejected) {
        return send(res, 400, {
          error: err.code,
          message: err.message,
          ...(err.worldCode ? { world_code: err.worldCode } : {}),
        });
      }
      if (err instanceof WorldUnavailable) return send(res, 502, { error: "world_unavailable", message: err.message });
      console.error(err);
      return send(res, 500, { error: "internal", message: "internal error" });
    }
  });
}

function publicListing(config: Config, signer: PassSigner, l: Listing) {
  return {
    ticker: l.ticker,
    action: l.action,
    chainId: l.chainId,
    auction: l.auction,
    module: l.module,
    cap: l.cap.toString(),
    passSigner: signer.address,
    passTtlSeconds: config.passTtlSeconds,
    eip712: { domain: passDomain({ chainId: l.chainId, module: l.module }), types: PASS_TYPES, primaryType: "EligibilityPass" },
    world: {
      app_id: config.world.appId,
      rp_id: config.world.rpId,
      environment: config.world.environment,
      allow_legacy_proofs: config.world.allowLegacyProofs,
      credential: "proof_of_human",
    },
  };
}

function listingOf(config: Config, ticker: unknown): Listing {
  if (typeof ticker !== "string" || ticker.length === 0) throw new HttpError(400, "invalid_request", "ticker is required");
  const listing = config.listings.get(ticker.toLowerCase());
  if (!listing) throw new HttpError(404, "unknown_listing", `no 'human' listing for ticker "${ticker}"`);
  return listing;
}

function walletOf(wallet: unknown): Address {
  if (typeof wallet !== "string" || !isAddress(wallet, { strict: false })) {
    throw new HttpError(400, "invalid_request", "wallet must be a 0x address");
  }
  return getAddress(wallet);
}

function prune(pending: Map<string, PendingRequest>, t: number) {
  for (const [nonce, p] of pending) if (p.expiresAt < t) pending.delete(nonce);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "body_too_large", "request body too large");
    chunks.push(chunk as Buffer);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "request body is not JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "invalid_request", "request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

function setCors(res: ServerResponse, origin: string) {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (origin !== "*") res.setHeader("Vary", "Origin");
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  if (body === undefined) return res.end();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
