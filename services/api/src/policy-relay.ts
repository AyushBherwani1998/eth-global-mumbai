/**
 * Demo policy relay - manual server-side relaying through existing mock forwarder.
 * NEVER stores private keys in client code, logs, responses, or repo.
 * Uses RELAYER_PRIVATE_KEY from environment for demo only.
 */
import { createWalletClient, http, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { badRequest } from "./errors.ts";
import type { Listing } from "./config.ts";
import type { Ctx } from "./context.ts";

export type PolicyRelayPayload = {
  /** halt, resume, or policy mode change */
  operation: "halt" | "resume" | "set_mode" | "set_reference";
  /** For set_mode */
  mode?: "normal" | "surveillance" | "directional";
  /** For set_reference */
  referencePrice?: string;
  /** Additional policy parameters */
  halted?: boolean;
  bandBps?: number;
};

export type PolicyRelayResult = {
  success: boolean;
  txHash?: Hex;
  blockNumber?: bigint;
  error?: string;
  warning?: string;
  /** For demonstration/testing */
  simulationResult?: {
    wouldRevert: boolean;
    reason?: string;
  };
};

/**
 * Relay policy report through the existing mock forwarder.
 * This is DEMO/MANUAL operator report functionality, NOT real CRE execution.
 * 
 * Security checks:
 * - RELAYER_PRIVATE_KEY must be set and valid
 * - Fail closed without config
 * - Validate funded signer
 * - Check nonce/time serialization
 * - Verify receipt includes ReportProcessed(result=true) and PolicyApplied
 * - Forwarder success alone is insufficient
 */
export async function relayPolicyReport(
  ctx: Ctx,
  listing: Listing,
  payload: Record<string, unknown>,
): Promise<PolicyRelayResult> {
  // Validate environment
  const relayerKey = process.env.RELAYER_PRIVATE_KEY;
  const killSwitch = process.env.POLICY_RELAY_DISABLED === "true";

  if (killSwitch) {
    throw badRequest("Policy relay is disabled (POLICY_RELAY_DISABLED=true)");
  }

  if (!relayerKey) {
    return {
      success: false,
      error: "RELAYER_PRIVATE_KEY not configured. This is expected during development. " +
             "Set RELAYER_PRIVATE_KEY in Railway environment to enable demo policy relay.",
      warning: "Demo policy relay requires RELAYER_PRIVATE_KEY environment variable",
    };
  }

  // Validate relayer key format
  if (!relayerKey.startsWith("0x") || relayerKey.length !== 66) {
    throw badRequest("Invalid RELAYER_PRIVATE_KEY format");
  }

  // Create wallet client
  const account = privateKeyToAccount(relayerKey as Hex);
  const client = createWalletClient({
    account,
    chain: sepolia,
    transport: http(ctx.config.rpcUrl),
  });

  // Check balance preflight
  const balance = await ctx.client.getBalance({ address: account.address });
  const minBalance = parseEther("0.001"); // Minimum 0.001 ETH
  
  if (balance < minBalance) {
    return {
      success: false,
      error: `Relayer address ${account.address} has insufficient balance: ${balance} wei (minimum: ${minBalance} wei)`,
      warning: "Relayer needs to be funded on Sepolia",
    };
  }

  // Validate receiver address
  if (!listing.receiver) {
    throw badRequest("Listing has no receiver configured");
  }

  // Parse and validate payload
  const operation = payload.operation;
  if (typeof operation !== "string" || !["halt", "resume", "set_mode", "set_reference"].includes(operation)) {
    throw badRequest("Invalid operation. Must be: halt, resume, set_mode, or set_reference");
  }

  // For demonstration, we'll simulate the operation first
  // In a real implementation, this would construct the actual policy report
  
  console.log("[policy-relay] Demo relay operation:", {
    ticker: listing.ticker,
    operation,
    relayer: account.address,
    receiver: listing.receiver,
    payload,
  });

  // TODO: Implement actual policy report construction and relay
  // This would involve:
  // 1. Reading current policy from mock exchange
  // 2. Constructing report with proper encoding
  // 3. Sending transaction through forwarder
  // 4. Verifying ReportProcessed and PolicyApplied events
  
  return {
    success: false,
    warning: "Policy relay implementation in progress. Use command-line CRE workflow for now.",
    error: "Browser-based policy relay not yet implemented. " +
           "Use: cd cre && cre workflow simulate ./listing-policy --target staging-settings --trigger-index 0 --broadcast",
  };
}

/**
 * Validate policy parameters before relay.
 */
export function validatePolicyParams(payload: Record<string, unknown>): void {
  if (payload.mode) {
    const mode = payload.mode;
    if (typeof mode !== "string" || !["normal", "surveillance", "directional"].includes(mode)) {
      throw badRequest("Invalid mode. Must be: normal, surveillance, or directional");
    }
  }

  if (payload.bandBps !== undefined) {
    const bandBps = payload.bandBps;
    if (typeof bandBps !== "number" || !Number.isInteger(bandBps) || bandBps < 0 || bandBps > 9999) {
      throw badRequest("bandBps must be an integer between 0 and 9999");
    }
  }

  if (payload.referencePrice !== undefined) {
    const price = payload.referencePrice;
    if (typeof price !== "string" || !/^\d+(\.\d+)?$/.test(price)) {
      throw badRequest("referencePrice must be a valid number string");
    }
  }
}
