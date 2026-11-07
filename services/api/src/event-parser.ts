/**
 * Event log parsing for extracting auction address from InitializerCreated event.
 * Matches DemoLaunch.s.sol's _initializerFromLogs()
 */

import { type Address, type Hex, type PublicClient, type Log, decodeEventLog, parseAbi } from "viem";

/**
 * LBPStrategy emits InitializerCreated when auction is created.
 * event InitializerCreated(address indexed initializer, PoolId indexed poolId);
 */
const LBP_STRATEGY_ABI = parseAbi([
  'event InitializerCreated(address indexed initializer, bytes32 indexed poolId)'
]);

export type AuctionCreatedEvent = {
  auction: Address;
  poolId: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
};

/**
 * Extract auction address from InitializerCreated event logs.
 * 
 * @param logs Transaction receipt logs
 * @param lbpStrategyAddress Address of the LBPStrategy contract
 * @returns Auction address or null if not found
 */
export function parseAuctionFromLogs(logs: Log[], lbpStrategyAddress: Address): AuctionCreatedEvent | null {
  for (const log of logs) {
    // Match emitter address
    if (log.address.toLowerCase() !== lbpStrategyAddress.toLowerCase()) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: LBP_STRATEGY_ABI,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName === 'InitializerCreated') {
        return {
          auction: decoded.args.initializer as Address,
          poolId: decoded.args.poolId as Hex,
          blockNumber: log.blockNumber ?? 0n,
          transactionHash: log.transactionHash ?? ("0x" as Hex),
        };
      }
    } catch {
      // Not the event we're looking for, continue
      continue;
    }
  }

  return null;
}

/**
 * Wait for auction creation and extract address from transaction receipt.
 */
export async function waitForAuctionCreation(
  client: PublicClient,
  txHash: Hex,
  lbpStrategyAddress: Address,
  confirmations = 1
): Promise<AuctionCreatedEvent> {
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    confirmations,
  });

  if (receipt.status !== "success") {
    throw new Error(`Auction creation transaction ${txHash} failed`);
  }

  const event = parseAuctionFromLogs(receipt.logs, lbpStrategyAddress);
  if (!event) {
    throw new Error(`No InitializerCreated event found in transaction ${txHash}`);
  }

  return event;
}
