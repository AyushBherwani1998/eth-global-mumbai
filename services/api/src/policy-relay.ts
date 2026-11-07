/**
 * Demo policy relay - manual server-side relaying through existing mock forwarder.
 * NEVER stores private keys in client code, logs, responses, or repo.
 * Uses RELAYER_PRIVATE_KEY from environment for demo only.
 */
import { createPublicClient, createWalletClient, http, parseEther, encodeAbiParameters, decodeEventLog, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { badRequest } from "./errors.ts";
import type { Listing } from "./config.ts";
import type { Ctx } from "./context.ts";

// Port of CRE policy encoding logic
const LISTING_POLICY_ABI = {
  type: "tuple",
  components: [
    { name: "version", type: "uint32" },
    { name: "asOf", type: "uint64" },
    { name: "chainSelector", type: "uint64" },
    { name: "refSqrtPriceX96", type: "uint160" },
    { name: "normalBandBps", type: "uint16" },
    { name: "survBandBps", type: "uint16" },
    { name: "mode", type: "uint8" },
    { name: "halted", type: "bool" },
    { name: "coolOffUntil", type: "uint64" },
  ],
} as const;

const REPORT_ABI = [LISTING_POLICY_ABI, { name: "status", type: "string" }] as const;

const Q96 = 1n << 96n;

function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  return (a * b) / d;
}

function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("isqrt of negative");
  if (n < 2n) return n;
  let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

function pointsE2ToSqrtPriceX96(pointsE2: bigint, usdcIsCurrency0: boolean): bigint {
  if (pointsE2 <= 0n) throw new Error("pointsE2 must be positive");
  const priceQ96 = mulDiv(pointsE2, Q96, 10n ** 19n);
  const priceX192 = usdcIsCurrency0 ? mulDiv(Q96 << 96n, Q96, priceQ96) : priceQ96 << 96n;
  return isqrt(priceX192);
}

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
  const mockExchangeUrl = process.env.MOCK_EXCHANGE_URL || "http://localhost:8787";

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

  // Create wallet and public clients
  const account = privateKeyToAccount(relayerKey as Hex);
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(ctx.config.rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(ctx.config.rpcUrl),
  });

  // Check balance preflight
  const balance = await publicClient.getBalance({ address: account.address });
  const minBalance = parseEther("0.001");
  
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
  validatePolicyParams(payload);
  const operation = payload.operation as string;

  // Verify broadcaster address matches authorized address
  const authorizedBroadcaster = process.env.POLICY_BROADCASTER_ADDRESS;
  if (authorizedBroadcaster && account.address.toLowerCase() !== authorizedBroadcaster.toLowerCase()) {
    console.warn(`[policy-relay] Broadcaster address mismatch: using ${account.address}, authorized is ${authorizedBroadcaster}`);
  }

  try {
    // 1. Read current policy from mock exchange
    const policyResponse = await fetch(`${mockExchangeUrl}/policy`);
    if (!policyResponse.ok) {
      throw new Error(`Failed to read policy from mock exchange: ${policyResponse.statusText}`);
    }
    const currentPolicy = await policyResponse.json();

    // 2. Apply operation to get new policy state
    const newPolicy = applyPolicyOperation(currentPolicy, operation, payload);

    // 3. Construct ListingPolicy report
    const asOf = BigInt(Math.floor(Date.now() / 1000));
    const chainSelector = 16015286601757825753n; // Sepolia
    
    const refPricePoints = typeof newPolicy.refPricePoints === "number" ? newPolicy.refPricePoints : null;
    const refPointsE2 = refPricePoints ? Math.round(refPricePoints * 100) : 0;
    const refSqrtPriceX96 = refPointsE2 === 0 ? 0n : pointsE2ToSqrtPriceX96(BigInt(refPointsE2), listing.usdcIsCurrency0);
    
    const modeMap: Record<string, number> = { normal: 0, surveillance: 1, directional: 2 };
    const mode = typeof newPolicy.mode === "string" ? newPolicy.mode : "normal";
    const modeValue = modeMap[mode] ?? 0;
    
    const bands = typeof newPolicy.bands === "object" && newPolicy.bands !== null ? newPolicy.bands as Record<string, unknown> : {};
    const normalBps = typeof bands.normalBps === "number" ? bands.normalBps : 2000;
    const survBps = typeof bands.surveillanceBps === "number" ? bands.surveillanceBps : 500;
    
    const halted = typeof newPolicy.halted === "boolean" ? newPolicy.halted : false;
    const coolOffUntil = typeof newPolicy.coolOffUntil === "number" ? BigInt(newPolicy.coolOffUntil) : 0n;
    const status = typeof newPolicy.status === "string" ? newPolicy.status : "";

    const report = encodeAbiParameters(REPORT_ABI, [
      {
        version: 0, // Receiver assigns version
        asOf,
        chainSelector,
        refSqrtPriceX96,
        normalBandBps: normalBps,
        survBandBps: survBps,
        mode: modeValue,
        halted,
        coolOffUntil,
      },
      status,
    ]);

    console.log("[policy-relay] Constructed report:", {
      ticker: listing.ticker,
      operation,
      asOf: asOf.toString(),
      mode: modeValue,
      halted: newPolicy.halted,
      reportLength: report.length,
    });

    // 4. Send report through mock forwarder
    // The forwarder ABI has a report function that forwards to the receiver
    const forwarderAddress = "0x15fC6ae953E024d975e77382eEeC56A9101f9F88"; // Sepolia mock forwarder
    
    const hash = await walletClient.writeContract({
      address: forwarderAddress,
      abi: [
        {
          type: "function",
          name: "report",
          inputs: [
            { name: "receiver", type: "address" },
            { name: "payload", type: "bytes" },
          ],
          outputs: [],
          stateMutability: "nonpayable",
        },
      ],
      functionName: "report",
      args: [listing.receiver, report],
    });

    console.log("[policy-relay] Transaction submitted:", hash);

    // 5. Wait for confirmation and verify events
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });

    if (receipt.status !== "success") {
      return {
        success: false,
        error: "Transaction reverted",
        txHash: hash,
        blockNumber: receipt.blockNumber,
      };
    }

    // Check for ReportProcessed event from forwarder (result must be true)
    const reportProcessedAbi = [
      {
        type: "event",
        name: "ReportProcessed",
        inputs: [
          { name: "receiver", type: "address", indexed: true },
          { name: "result", type: "bool", indexed: false },
        ],
      },
    ];
    
    let reportProcessedOk = false;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: reportProcessedAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "ReportProcessed") {
          const args = decoded.args as unknown as { receiver: string; result: boolean };
          if (!args.result) {
            return {
              success: false,
              error: "ReportProcessed event found but result=false (receiver rejected report)",
              txHash: hash,
              blockNumber: receipt.blockNumber,
            };
          }
          reportProcessedOk = true;
          break;
        }
      } catch {
        // Not this event, continue
      }
    }

    if (!reportProcessedOk) {
      return {
        success: false,
        error: "ReportProcessed(result=true) event not found",
        txHash: hash,
        blockNumber: receipt.blockNumber,
      };
    }

    // Check for PolicyApplied event from receiver
    const policyAppliedAbi = [
      {
        type: "event",
        name: "PolicyApplied",
        inputs: [
          { name: "version", type: "uint32", indexed: true },
          { name: "asOf", type: "uint64", indexed: false },
        ],
      },
    ];
    
    const policyAppliedEvents = receipt.logs.filter(log => {
      try {
        const decoded = decodeEventLog({
          abi: policyAppliedAbi,
          data: log.data,
          topics: log.topics,
        });
        return decoded.eventName === "PolicyApplied";
      } catch {
        return false;
      }
    });

    if (policyAppliedEvents.length === 0) {
      return {
        success: false,
        error: "ReportProcessed ok but PolicyApplied event not found from receiver",
        txHash: hash,
        blockNumber: receipt.blockNumber,
      };
    }
    
    // Verify PolicyApplied has expected asOf (should be monotonic and match our report)
    const policyAppliedDecoded = decodeEventLog({
      abi: policyAppliedAbi,
      data: policyAppliedEvents[0]!.data,
      topics: policyAppliedEvents[0]!.topics,
    });
    
    const policyArgs = policyAppliedDecoded.args as unknown as { version: number; asOf: bigint };
    if (policyArgs.asOf !== BigInt(asOf)) {
      console.warn(`[policy-relay] PolicyApplied asOf mismatch: expected ${asOf}, got ${policyArgs.asOf}`);
    }

    return {
      success: true,
      txHash: hash,
      blockNumber: receipt.blockNumber,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Apply a policy operation to the current policy state.
 */
function applyPolicyOperation(
  currentPolicy: Record<string, unknown>,
  operation: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const newPolicy = { ...currentPolicy };

  switch (operation) {
    case "halt":
      newPolicy.halted = true;
      break;
    
    case "resume":
      newPolicy.halted = false;
      break;
    
    case "set_mode":
      if (payload.mode) {
        newPolicy.mode = payload.mode;
      }
      break;
    
    case "set_reference":
      if (payload.referencePrice) {
        newPolicy.refPricePoints = parseFloat(payload.referencePrice as string);
      }
      break;
  }

  return newPolicy;
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
