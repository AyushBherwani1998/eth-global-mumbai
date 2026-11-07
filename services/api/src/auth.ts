/**
 * Authentication and authorization for issuer operations.
 * Supports multi-address allowlist with signature verification.
 * Implements proper replay protection with nonce tracking.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Context } from "hono";
import { getAddress, isAddress, recoverMessageAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { badRequest } from "./errors.ts";

export type AuthConfig = {
  /** Comma-separated list of issuer addresses allowed to create listings */
  allowedIssuers: string[];
  /** Backwards-compatible single issuer address (deprecated) */
  legacyIssuer?: string;
  /** Maximum signature age in seconds (default: 300 = 5 minutes) */
  maxSignatureAge?: number;
  /** Domain for EIP-712-style domain binding */
  domain: string;
};

/**
 * Nonce store for replay protection.
 * Tracks used nonces per address to prevent replay attacks.
 */
export class NonceStore {
  private nonces: Map<string, Set<string>> = new Map();
  private storePath?: string;

  constructor(storePath?: string) {
    this.storePath = storePath;
    this.load();
  }

  private load(): void {
    if (!this.storePath || !existsSync(this.storePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.storePath, "utf8"));
      this.nonces = new Map(
        Object.entries(data).map(([addr, nonces]) => [addr, new Set(nonces as string[])])
      );
    } catch (e) {
      console.error("[auth] Failed to load nonce store:", e);
    }
  }

  private save(): void {
    if (!this.storePath) return;
    try {
      const dir = dirname(this.storePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data = Object.fromEntries(
        Array.from(this.nonces.entries()).map(([addr, nonces]) => [addr, Array.from(nonces)])
      );
      writeFileSync(this.storePath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error("[auth] Failed to save nonce store:", e);
    }
  }

  /**
   * Check if nonce has been used, then mark it as used.
   * Returns true if nonce was fresh (not used before).
   */
  consumeNonce(address: Address, nonce: string): boolean {
    const key = address.toLowerCase();
    if (!this.nonces.has(key)) {
      this.nonces.set(key, new Set());
    }
    const used = this.nonces.get(key)!;
    if (used.has(nonce)) {
      return false; // Already used
    }
    used.add(nonce);
    this.save();
    return true;
  }

  /**
   * Clean up old nonces (older than maxAge seconds).
   */
  cleanup(maxAge: number): void {
    // For simplicity, nonces include timestamp, so we can parse and remove old ones
    // Format: timestamp_random
    const cutoff = Date.now() - maxAge * 1000;
    for (const [addr, nonces] of this.nonces.entries()) {
      const filtered = new Set(
        Array.from(nonces).filter(nonce => {
          const parts = nonce.split("_");
          const ts = parseInt(parts[0], 10);
          return !isNaN(ts) && ts >= cutoff;
        })
      );
      this.nonces.set(addr, filtered);
    }
    this.save();
  }
}

/**
 * Parse issuer allowlist from environment variables.
 * Supports both ISSUER_ADDRESSES (new, comma-separated) and ISSUER_ADDRESS (legacy, single).
 */
export function loadAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const allowedIssuers: string[] = [];
  
  // New: comma-separated list
  if (env.ISSUER_ADDRESSES) {
    const addresses = env.ISSUER_ADDRESSES.split(",")
      .map(addr => addr.trim())
      .filter(Boolean);
    
    for (const addr of addresses) {
      if (!isAddress(addr)) {
        throw new Error(`Invalid address in ISSUER_ADDRESSES: ${addr}`);
      }
      allowedIssuers.push(getAddress(addr));
    }
  }
  
  // Legacy: single issuer (backwards compatible)
  if (env.ISSUER_ADDRESS) {
    const addr = env.ISSUER_ADDRESS.trim();
    if (!isAddress(addr)) {
      throw new Error(`Invalid ISSUER_ADDRESS: ${addr}`);
    }
    const checksummed = getAddress(addr);
    if (!allowedIssuers.includes(checksummed)) {
      allowedIssuers.push(checksummed);
    }
  }

  return {
    allowedIssuers,
    legacyIssuer: env.ISSUER_ADDRESS?.trim(),
    maxSignatureAge: Number(env.MAX_SIGNATURE_AGE || 300),
    domain: env.AUTH_DOMAIN || "listing-day.api",
  };
}

export type SignedRequest = {
  /** Domain for EIP-712-style binding */
  domain: string;
  /** The action being performed (e.g., "create_listing", "update_policy") */
  action: string;
  /** Chain ID for replay protection */
  chainId: number;
  /** Unix timestamp in seconds */
  timestamp: number;
  /** Nonce for replay protection (format: timestamp_random) */
  nonce: string;
  /** Optional ticker for per-listing operations */
  ticker?: string;
  /** The request payload (JSON) */
  payload: unknown;
  /** Signature over the message */
  signature: Hex;
};

/**
 * Verify a signed request from an issuer.
 * Checks:
 * - Domain matches expected
 * - Signature is valid and recovers to an address
 * - Recovered address is in the allowlist
 * - Timestamp is recent (within maxSignatureAge)
 * - Chain ID matches expected
 * - Nonce has not been used before (replay protection)
 * - Payload hash integrity
 * Returns the authenticated issuer address.
 */
export async function verifySignedRequest(
  request: SignedRequest,
  config: AuthConfig,
  expectedChainId: number,
  nonceStore?: NonceStore,
): Promise<Address> {
  const { domain, action, chainId, timestamp, nonce, ticker, payload, signature } = request;

  // Check domain binding
  if (domain !== config.domain) {
    throw badRequest(`Invalid domain: expected ${config.domain}, got ${domain}`);
  }

  // Check chain ID
  if (chainId !== expectedChainId) {
    throw badRequest(`Invalid chain ID: expected ${expectedChainId}, got ${chainId}`);
  }

  // Validate nonce format (timestamp_random)
  if (!nonce || !/^\d+_[a-z0-9]+$/i.test(nonce)) {
    throw badRequest("Invalid nonce format (expected: timestamp_random)");
  }

  // Check timestamp (replay protection)
  const now = Math.floor(Date.now() / 1000);
  const age = now - timestamp;
  const maxAge = config.maxSignatureAge ?? 300;
  
  if (age < 0) {
    throw badRequest("Request timestamp is in the future");
  }
  if (age > maxAge) {
    throw badRequest(`Request signature expired (age: ${age}s, max: ${maxAge}s)`);
  }

  // Compute payload hash for integrity
  const payloadJson = JSON.stringify(payload);
  const payloadHash = keccak256(toHex(payloadJson));
  
  // Verify that the signed message contains a matching payload hash
  // The message structure should have been: domain, action, chainId, timestamp, nonce, ticker, payloadHash

  // Construct message with all binding fields
  const message = JSON.stringify({
    domain,
    action,
    chainId,
    timestamp,
    nonce,
    ticker: ticker || null,
    payloadHash,
  });

  // Recover signer
  let recoveredAddress: Address;
  try {
    recoveredAddress = await recoverMessageAddress({
      message,
      signature,
    });
  } catch (e) {
    throw badRequest("Invalid signature");
  }

  // Check if signer is in allowlist
  const checksummed = getAddress(recoveredAddress);
  if (!config.allowedIssuers.includes(checksummed)) {
    throw badRequest(`Address ${checksummed} is not authorized as an issuer`);
  }

  // Check and consume nonce (atomic replay protection)
  if (nonceStore && !nonceStore.consumeNonce(checksummed, nonce)) {
    throw badRequest("Nonce already used (replay attack detected)");
  }

  return checksummed;
}

/**
 * Extract and verify signed request from Hono context.
 * Expects body in format: { action, chainId, timestamp, payload, signature }
 */
export async function extractSignedRequest(c: Context): Promise<SignedRequest> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object");
  }

  const req = body as Record<string, unknown>;

  if (typeof req.domain !== "string" || !req.domain) {
    throw badRequest("Missing or invalid 'domain' field");
  }
  if (typeof req.action !== "string" || !req.action) {
    throw badRequest("Missing or invalid 'action' field");
  }
  if (typeof req.chainId !== "number" || !Number.isInteger(req.chainId)) {
    throw badRequest("Missing or invalid 'chainId' field");
  }
  if (typeof req.timestamp !== "number" || !Number.isInteger(req.timestamp)) {
    throw badRequest("Missing or invalid 'timestamp' field");
  }
  if (typeof req.nonce !== "string" || !req.nonce) {
    throw badRequest("Missing or invalid 'nonce' field");
  }
  if (!req.payload) {
    throw badRequest("Missing 'payload' field");
  }
  if (typeof req.signature !== "string" || !req.signature.startsWith("0x")) {
    throw badRequest("Missing or invalid 'signature' field");
  }

  return {
    domain: req.domain,
    action: req.action,
    chainId: req.chainId,
    timestamp: req.timestamp,
    nonce: req.nonce,
    ticker: typeof req.ticker === "string" ? req.ticker : undefined,
    payload: req.payload,
    signature: req.signature as Hex,
  };
}

/**
 * Check if an address is in the issuer allowlist (read-only check).
 */
export function isAuthorizedIssuer(address: Address, config: AuthConfig): boolean {
  const checksummed = getAddress(address);
  return config.allowedIssuers.includes(checksummed);
}
