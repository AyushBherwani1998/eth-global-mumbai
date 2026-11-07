/**
 * Auction creation struct encoding - matches Liquidity Launcher types.
 * 
 * Based on:
 * - continuous-clearing-auction/src/interfaces/IContinuousClearingAuction.sol
 * - liquidity-launcher/src/libraries/MigratorParams.sol
 * - liquidity-launcher/src/types/Distribution.sol
 */

import { type Address, type Hex, encodeAbiParameters, parseAbiParameters } from "viem";

/**
 * AuctionParameters struct for CCA creation.
 */
export type AuctionParameters = {
  currency: Address;
  tokensRecipient: Address;
  fundsRecipient: Address;
  startBlock: bigint;
  endBlock: bigint;
  claimBlock: bigint;
  tickSpacing: bigint;
  validationHook: Address;
  floorPrice: bigint;
  requiredCurrencyRaised: bigint;
  auctionStepsData: Hex;
};

/**
 * PoolParameters struct for v4 pool configuration.
 */
export type PoolParameters = {
  fee: number;
  tickSpacing: number;
  hook: Address;
};

/**
 * LiquidityAllocationBracket for LP allocation schedule.
 */
export type LiquidityAllocationBracket = {
  lowerThreshold: bigint;
  rate: number; // uint24 in mps
};

/**
 * MigratorParameters struct for post-auction LP migration.
 */
export type MigratorParameters = {
  token: Address;
  currency: Address;
  migrationBlock: bigint;
  reservedTokenAmountForLP: bigint;
  recipient: Address;
  positionRecipient: Address;
  poolParameters: PoolParameters;
  positionDefinitions: Hex; // Encoded PositionDefinition[]
  lpAllocationSchedule: Hex; // Encoded LiquidityAllocationBracket[]
};

/**
 * Distribution struct for LiquidityLauncher.distributeToken.
 */
export type Distribution = {
  strategy: Address;
  amount: bigint;
  configData: Hex; // Encoded (MigratorParameters, bytes)
};

/**
 * Encode AuctionParameters struct.
 */
export function encodeAuctionParameters(params: AuctionParameters): Hex {
  return encodeAbiParameters(
    parseAbiParameters('address, address, address, uint64, uint64, uint64, uint256, address, uint256, uint128, bytes'),
    [
      params.currency,
      params.tokensRecipient,
      params.fundsRecipient,
      params.startBlock,
      params.endBlock,
      params.claimBlock,
      params.tickSpacing,
      params.validationHook,
      params.floorPrice,
      params.requiredCurrencyRaised,
      params.auctionStepsData,
    ]
  );
}

/**
 * Encode PoolParameters struct.
 */
export function encodePoolParameters(params: PoolParameters): Hex {
  return encodeAbiParameters(
    parseAbiParameters('uint24, int24, address'),
    [
      params.fee,
      params.tickSpacing,
      params.hook,
    ]
  );
}

/**
 * Encode LiquidityAllocationBracket array.
 */
export function encodeLiquidityAllocationBrackets(brackets: LiquidityAllocationBracket[]): Hex {
  return encodeAbiParameters(
    parseAbiParameters('(uint256 lowerThreshold, uint24 rate)[]'),
    [brackets as unknown as [{ lowerThreshold: bigint; rate: number }[]]]
  );
}

/**
 * Encode MigratorParameters struct.
 */
export function encodeMigratorParameters(params: MigratorParameters): Hex {
  return encodeAbiParameters(
    parseAbiParameters('address, address, uint64, uint128, address, address, (uint24 fee, int24 tickSpacing, address hook), bytes, bytes'),
    [
      params.token,
      params.currency,
      params.migrationBlock,
      params.reservedTokenAmountForLP,
      params.recipient,
      params.positionRecipient,
      params.poolParameters,
      params.positionDefinitions,
      params.lpAllocationSchedule,
    ]
  );
}

/**
 * Encode Distribution configData: abi.encode(MigratorParameters, abi.encode(AuctionParameters))
 */
export function encodeDistributionConfigData(
  migratorParams: MigratorParameters,
  auctionParams: AuctionParameters
): Hex {
  const encodedAuction = encodeAuctionParameters(auctionParams);
  const encodedMigrator = encodeMigratorParameters(migratorParams);
  
  // configData is: abi.encode(MigratorParameters, abi.encode(AuctionParameters))
  // This is a tuple of (MigratorParameters, bytes)
  return encodeAbiParameters(
    parseAbiParameters('bytes, bytes'),
    [encodedMigrator, encodedAuction]
  );
}

/**
 * Encode full Distribution struct.
 */
export function encodeDistribution(distribution: Distribution): Hex {
  return encodeAbiParameters(
    parseAbiParameters('(address strategy, uint128 amount, bytes configData)'),
    [distribution as unknown as [{ strategy: Address; amount: bigint; configData: Hex }]]
  );
}

/**
 * Encode auction steps data: alternating mps (uint24) and blocks (uint40).
 * 
 * Example: [0 mps for 30 blocks, then 500,000 mps for 20 blocks]
 * Packed as: 0x000000000000001e0007a120000000000014
 */
export function encodeAuctionSteps(steps: Array<{ mps: number; blocks: number }>): Hex {
  let encoded = "0x";
  for (const step of steps) {
    // uint24 mps
    const mpsHex = step.mps.toString(16).padStart(6, '0');
    // uint40 blocks
    const blocksHex = step.blocks.toString(16).padStart(10, '0');
    encoded += mpsHex + blocksHex;
  }
  return encoded as Hex;
}
