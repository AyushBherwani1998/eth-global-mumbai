/**
 * Authentication and authorization for issuer operations.
 * Supports multi-address allowlist with signature verification.
 */
import { type Context } from "hono";
import { getAddress, isAddress, recoverMessageAddress, type Address, type Hex } from "viem";
import { badRequest } from "./errors.ts";

export type AuthConfig = {
  /** Comma-separated list of issuer addresses allowed to create listings */
  allowedIssuers: string[];
  /** Backwards-compatible single issuer address (deprecated) */
  legacyIssuer?: string;
  /** Maximum signature age in seconds (default: 300 = 5 minutes) */
  maxSignatureAge?: number;
};

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
  };
}

export type SignedRequest = {
  /** The action being performed (e.g., "create_listing", "update_policy") */
  action: string;
  /** Chain ID for replay protection */
  chainId: number;
  /** Unix timestamp in seconds */
  timestamp: number;
  /** The request payload (JSON) */
  payload: unknown;
  /** Signature over the message */
  signature: Hex;
};

/**
 * Verify a signed request from an issuer.
 * Checks:
 * - Signature is valid and recovers to an address
 * - Recovered address is in the allowlist
 * - Timestamp is recent (within maxSignatureAge)
 * - Chain ID matches expected
 * Returns the authenticated issuer address.
 */
export async function verifySignedRequest(
  request: SignedRequest,
  config: AuthConfig,
  expectedChainId: number,
): Promise<Address> {
  const { action, chainId, timestamp, payload, signature } = request;

  // Check chain ID
  if (chainId !== expectedChainId) {
    throw badRequest(`Invalid chain ID: expected ${expectedChainId}, got ${chainId}`);
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

  // Construct message
  const message = JSON.stringify({
    action,
    chainId,
    timestamp,
    payload,
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

  if (typeof req.action !== "string" || !req.action) {
    throw badRequest("Missing or invalid 'action' field");
  }
  if (typeof req.chainId !== "number" || !Number.isInteger(req.chainId)) {
    throw badRequest("Missing or invalid 'chainId' field");
  }
  if (typeof req.timestamp !== "number" || !Number.isInteger(req.timestamp)) {
    throw badRequest("Missing or invalid 'timestamp' field");
  }
  if (!req.payload) {
    throw badRequest("Missing 'payload' field");
  }
  if (typeof req.signature !== "string" || !req.signature.startsWith("0x")) {
    throw badRequest("Missing or invalid 'signature' field");
  }

  return {
    action: req.action,
    chainId: req.chainId,
    timestamp: req.timestamp,
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
