/**
 * Vercel Node function entry for the mock-exchange policy API.
 *
 * This adapter wraps the mock-exchange HTTP server for serverless execution.
 * The CRE workflow fetches policy from this endpoint instead of a long-running server.
 *
 * Environment variables (configured in Vercel dashboard):
 * - MOCK_EXCHANGE_SECRET (required): Shared secret for write operations
 * - TICKER (optional): Default "ACME"
 * - STATE_FILE: Not supported on Vercel (serverless is stateless)
 *
 * Note: STATE_FILE persistence is disabled for serverless. Policy state resets
 * on each cold start to defaults. For persistent state, use external storage
 * (database, KV store) or Railway/Docker deployment.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyEdit, defaultPolicy, type ExchangePolicy, PolicyValidationError, replacePolicy } from "../services/mock-exchange/src/policy.ts";

// In-memory state (resets on cold start)
let policy: ExchangePolicy | null = null;

function getPolicy(): ExchangePolicy {
  if (!policy) {
    const ticker = process.env.TICKER ?? "ACME";
    const now = Math.floor(Date.now() / 1000);
    policy = defaultPolicy(ticker, now);
  }
  return policy;
}

function setPolicy(next: ExchangePolicy): ExchangePolicy {
  policy = next;
  return policy;
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function authorized(req: VercelRequest): boolean {
  const secret = process.env.MOCK_EXCHANGE_SECRET;
  if (!secret) {
    console.warn("MOCK_EXCHANGE_SECRET not set; rejecting all writes");
    return false;
  }

  const apiKey = req.headers["x-api-key"];
  const provided = typeof apiKey === "string" ? apiKey : 
    req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice("Bearer ".length) : undefined;

  if (!provided) return false;
  
  // Constant-time comparison
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

function setCors(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, PUT, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-api-key, authorization");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  // Handle OPTIONS for CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // Health check
    if (path === "/health" || path === "/api/policy/health") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("Allow", "GET, HEAD");
        return res.status(405).json({ error: "method_not_allowed" });
      }
      return res.status(200).json({ ok: true });
    }

    // Policy endpoints
    if (path === "/policy" || path === "/api/policy") {
      // GET /policy
      if (req.method === "GET" || req.method === "HEAD") {
        return res.status(200).json(getPolicy());
      }

      // PUT/POST /policy
      if (req.method === "PUT" || req.method === "POST") {
        if (!authorized(req)) {
          return res.status(401).json({ error: "unauthorized" });
        }

        const body = req.body;
        if (!body || typeof body !== "object") {
          return res.status(400).json({ error: "invalid_json" });
        }

        const current = getPolicy();
        const next = req.method === "PUT" 
          ? replacePolicy(current, body, now()) 
          : applyEdit(current, body, now());
        
        return res.status(200).json(setPolicy(next));
      }

      res.setHeader("Allow", "GET, HEAD, PUT, POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    // POST /policy/reset
    if (path === "/policy/reset" || path === "/api/policy/reset") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ error: "method_not_allowed" });
      }

      if (!authorized(req)) {
        return res.status(401).json({ error: "unauthorized" });
      }

      const current = getPolicy();
      const ticker = current.ticker;
      const reset = { ...defaultPolicy(ticker, now()), revision: current.revision + 1 };
      return res.status(200).json(setPolicy(reset));
    }

    return res.status(404).json({ error: "not_found" });

  } catch (err) {
    if (err instanceof PolicyValidationError) {
      return res.status(400).json({ error: "invalid_policy", details: err.details });
    }
    console.error("Policy API error:", err);
    return res.status(500).json({ error: "internal" });
  }
}
