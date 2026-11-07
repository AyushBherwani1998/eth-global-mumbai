/**
 * Auction creation via LiquidityLauncher - REQUIRED for functional listing.
 * 
 * Lifecycle from DemoLaunch.s.sol:
 * 1. Token approvals: token.approve(Permit2), Permit2.approve(LiquidityLauncher)
 * 2. LiquidityLauncher.multicall([depositToken, distributeToken])
 * 3. Extract auction address from InitializerCreated event
 * 4. ValidationHook.setAuction(auction)
 * 
 * This mirrors the exact sequence from DemoLaunch.s.sol.
 */

import { type Address, type Hex, encodeAbiParameters, encodeFunctionData, parseAbi } from "viem";

export type AuctionCreationParams = {
  // Deployed contracts
  tokenAddress: Address;
  validationHookAddress: Address;
  hookAddress: Address;
  
  // Network config
  usdc: Address;
  permit2: Address;
  liquidityLauncher: Address;
  lbpStrategy: Address;
  
  // Issuer & treasury
  issuerAddress: Address;
  treasuryAddress: Address;
  
  // Auction params (from ListingDay constants)
  totalSupply: bigint;
  auctionSupply: bigint;
  lpReserve: bigint;
  requiredCurrencyRaised: bigint;
  
  // Price params (from ListingPrice)
  floorPriceQ96: bigint;
  tickSpacingQ96: bigint;
  
  // Pool params
  poolFee: bigint;
  poolTickSpacing: bigint;
  lpRateMps: bigint; // 2e6 = 20%
  
  // Schedule (blocks)
  startDelayBlocks: bigint;
  bidWindowBlocks: bigint;
  clearBlocks: bigint;
  currentBlock: bigint;
};

export type AuctionApprovalStep = {
  step: number;
  contract: string;
  method: string;
  description: string;
  to: Address;
  data: Hex;
  value: Hex;
};

/**
 * Step 7a: token.approve(Permit2, max)
 * REQUIRED before LiquidityLauncher can pull tokens
 */
export function preparePermit2Approval(params: {
  tokenAddress: Address;
  permit2: Address;
}): AuctionApprovalStep {
  const erc20Abi = parseAbi([
    'function approve(address spender, uint256 amount) external returns (bool)'
  ]);
  
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [params.permit2, BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")],
  });
  
  return {
    step: 7,
    contract: "MockSME",
    method: "approve",
    description: "Approve Permit2 for token transfer",
    to: params.tokenAddress,
    data,
    value: "0x0" as Hex,
  };
}

/**
 * Step 7b: Permit2.approve(token, LiquidityLauncher, totalSupply, expiry)
 * REQUIRED before LiquidityLauncher can pull via Permit2
 */
export function prepareLauncherPermit2Approval(params: {
  tokenAddress: Address;
  permit2: Address;
  liquidityLauncher: Address;
  totalSupply: bigint;
  expiry: bigint; // block.timestamp + 1 hour
}): AuctionApprovalStep {
  const permit2Abi = parseAbi([
    'function approve(address token, address spender, uint160 amount, uint48 expiration) external'
  ]);
  
  const data = encodeFunctionData({
    abi: permit2Abi,
    functionName: 'approve',
    args: [
      params.tokenAddress,
      params.liquidityLauncher,
      params.totalSupply,
      Number(params.expiry),
    ] as const,
  });
  
  return {
    step: 7,
    contract: "Permit2",
    method: "approve",
    description: "Approve LiquidityLauncher via Permit2",
    to: params.permit2,
    data,
    value: "0x0" as Hex,
  };
}

/**
 * Step 7c: LiquidityLauncher.multicall([depositToken, distributeToken])
 * Creates the CCA auction and reserves pool ID
 */
export function prepareAuctionCreation(params: AuctionCreationParams): AuctionApprovalStep {
  const startBlock = params.currentBlock + params.startDelayBlocks;
  const endBlock = startBlock + params.bidWindowBlocks + params.clearBlocks;
  const migrationBlock = endBlock + 1n;
  
  // MPS schedule: bid window at 0 mps, then release supply linearly
  const mpsPerBlock = 10_000_000n / params.clearBlocks;
  const auctionStepsData = encodeAuctionSteps(
    params.bidWindowBlocks,
    mpsPerBlock,
    params.clearBlocks
  );
  
  // AuctionParameters struct
  const auctionParams = {
    currency: params.usdc,
    tokensRecipient: params.treasuryAddress,
    fundsRecipient: params.lbpStrategy, // Strategy holds the funds
    startBlock,
    endBlock,
    claimBlock: endBlock,
    tickSpacing: params.tickSpacingQ96,
    validationHook: params.validationHookAddress,
    floorPrice: params.floorPriceQ96,
    requiredCurrencyRaised: params.requiredCurrencyRaised,
    auctionStepsData,
  };
  
  // LiquidityAllocationBracket: 20% of raise goes to LP
  const brackets = [{
    lowerThreshold: 0n,
    rate: BigInt(params.lpRateMps),
  }];
  
  // MigratorParameters struct
  const migrationParams = {
    token: params.tokenAddress,
    currency: params.usdc,
    migrationBlock,
    reservedTokenAmountForLP: params.lpReserve,
    recipient: params.treasuryAddress,
    positionRecipient: params.treasuryAddress,
    poolParameters: {
      fee: params.poolFee,
      tickSpacing: params.poolTickSpacing,
      hook: params.hookAddress,
    },
    positionDefinitions: "0x" as Hex, // Empty array
    lpAllocationSchedule: encodeBrackets(brackets),
  };
  
  // Distribution struct
  const distribution = {
    strategy: params.lbpStrategy,
    amount: params.totalSupply,
    configData: encodeDistributionConfig(migrationParams, auctionParams),
  };
  
  // Multicall: [depositToken, distributeToken]
  const liquidityLauncherAbi = parseAbi([
    'function multicall(bytes[] calldata calls) external returns (bytes[] memory)',
    'function depositToken(address token, uint160 amount) external',
    'function distributeToken(address token, (address strategy, uint128 amount, bytes configData) distribution, bytes32 salt) external returns (address)'
  ]);
  
  const depositCall = encodeFunctionData({
    abi: liquidityLauncherAbi,
    functionName: 'depositToken',
    args: [params.tokenAddress, params.totalSupply as unknown as bigint],
  });
  
  const distributeCall = encodeFunctionData({
    abi: liquidityLauncherAbi,
    functionName: 'distributeToken',
    args: [params.tokenAddress, distribution as unknown, "0x" + Date.now().toString(16).padStart(64, '0') as Hex],
  });
  
  const data = encodeFunctionData({
    abi: liquidityLauncherAbi,
    functionName: 'multicall',
    args: [[depositCall, distributeCall]],
  });
  
  return {
    step: 7,
    contract: "LiquidityLauncher",
    method: "multicall",
    description: "Create auction and reserve pool",
    to: params.liquidityLauncher,
    data,
    value: "0x0" as Hex,
  };
}

/**
 * Step 8: ValidationHook.setAuction(auction)
 * REQUIRED binding - must happen before auction startBlock
 */
export function prepareSetAuction(params: {
  validationHookAddress: Address;
  auctionAddress: Address;
}): AuctionApprovalStep {
  const validationHookAbi = parseAbi([
    'function setAuction(address auction) external'
  ]);
  
  const data = encodeFunctionData({
    abi: validationHookAbi,
    functionName: 'setAuction',
    args: [params.auctionAddress],
  });
  
  return {
    step: 8,
    contract: "AuctionValidationHook",
    method: "setAuction",
    description: "Bind validation hook to auction",
    to: params.validationHookAddress,
    data,
    value: "0x0" as Hex,
  };
}

/**
 * Encode auction steps data: [mps0, blocks0, mps1, blocks1, ...]
 * Format: packed uint24 mps, uint40 blocks
 */
function encodeAuctionSteps(bidWindow: bigint, mpsPerBlock: bigint, clearBlocks: bigint): Hex {
  let encoded = "0x";
  
  // Bid window: 0 mps for bidWindow blocks
  if (bidWindow > 0n) {
    const mpsHex = "000000"; // 0 mps as uint24
    const blocksHex = bidWindow.toString(16).padStart(10, '0'); // uint40
    encoded += mpsHex + blocksHex;
  }
  
  // Clearing: mpsPerBlock for clearBlocks
  const mpsClearHex = mpsPerBlock.toString(16).padStart(6, '0'); // uint24
  const clearBlocksHex = clearBlocks.toString(16).padStart(10, '0'); // uint40
  encoded += mpsClearHex + clearBlocksHex;
  
  return encoded as Hex;
}

/**
 * Encode liquidity allocation brackets for LP schedule
 */
function encodeBrackets(brackets: Array<{ lowerThreshold: bigint; rate: bigint }>): Hex {
  return encodeAbiParameters(
    [{ type: 'tuple[]', components: [{ name: 'lowerThreshold', type: 'uint256' }, { name: 'rate', type: 'uint24' }] }],
    [brackets as unknown as [{ lowerThreshold: bigint; rate: number }[]]]
  );
}

/**
 * Encode distribution config data: abi.encode(migrationParams, abi.encode(auctionParams))
 * This matches the exact encoding from DemoLaunch.s.sol
 */
function encodeDistributionConfig(migrationParams: { liquidityLauncher: Address; tokenRecipient: Address; totalAmount: bigint }, auctionParams: { auctionAddress: Address; initialOwner: Address; baseFee: bigint; brackets: Hex; initialPrice: bigint }): Hex {
  // First encode AuctionParameters
  const encodedAuction = encodeAbiParameters(
    [
      { name: 'currency', type: 'address' },
      { name: 'tokensRecipient', type: 'address' },
      { name: 'fundsRecipient', type: 'address' },
      { name: 'startBlock', type: 'uint64' },
      { name: 'endBlock', type: 'uint64' },
      { name: 'claimBlock', type: 'uint64' },
      { name: 'tickSpacing', type: 'uint256' },
      { name: 'validationHook', type: 'address' },
      { name: 'floorPrice', type: 'uint256' },
      { name: 'requiredCurrencyRaised', type: 'uint128' },
      { name: 'auctionStepsData', type: 'bytes' }
    ],
    [
      auctionParams.currency,
      auctionParams.tokensRecipient,
      auctionParams.fundsRecipient,
      auctionParams.startBlock,
      auctionParams.endBlock,
      auctionParams.claimBlock,
      auctionParams.tickSpacing,
      auctionParams.validationHook,
      auctionParams.floorPrice,
      auctionParams.requiredCurrencyRaised,
      auctionParams.auctionStepsData,
    ]
  );

  // Then encode MigratorParameters with the encoded auction as bytes
  return encodeAbiParameters(
    [
      { name: 'token', type: 'address' },
      { name: 'currency', type: 'address' },
      { name: 'migrationBlock', type: 'uint64' },
      { name: 'reservedTokenAmountForLP', type: 'uint128' },
      { name: 'recipient', type: 'address' },
      { name: 'positionRecipient', type: 'address' },
      {
        name: 'poolParameters',
        type: 'tuple',
        components: [
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hook', type: 'address' }
        ]
      },
      { name: 'positionDefinitions', type: 'bytes' },
      { name: 'lpAllocationSchedule', type: 'bytes' },
      { name: 'encodedAuctionParams', type: 'bytes' }
    ],
    [
      migrationParams.token,
      migrationParams.currency,
      migrationParams.migrationBlock,
      migrationParams.reservedTokenAmountForLP,
      migrationParams.recipient,
      migrationParams.positionRecipient,
      {
        fee: migrationParams.poolParameters.fee,
        tickSpacing: migrationParams.poolParameters.tickSpacing,
        hook: migrationParams.poolParameters.hook,
      },
      migrationParams.positionDefinitions,
      migrationParams.lpAllocationSchedule,
      encodedAuction,
    ]
  );
}
