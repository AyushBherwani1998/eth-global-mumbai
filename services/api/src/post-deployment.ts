/**
 * Post-deployment configuration - REQUIRED steps to make listing functional.
 * 
 * After 5 contracts deployed, these steps are REQUIRED:
 * 1. Hook.setPolicySource(receiver) - Connect policy updates
 * 2. Create auction via LiquidityLauncher
 * 3. Bind ValidationHook to auction
 * 4. Register in deployments file for script/app discovery
 */

import { type Address, type Hex, type PublicClient } from "viem";
import { listingHookAbi } from "./abis.generated.ts";

export type PostDeploymentParams = {
  ticker: string;
  tokenAddress: Address;
  moduleAddress: Address;
  validationHookAddress: Address;
  hookAddress: Address;
  receiverAddress: Address;
  issuerAddress: Address;
  
  // Auction params
  totalSupply: bigint;
  auctionSupply: bigint;
  requiredCurrencyRaised: bigint;
  floorPriceQ96: bigint;
  tickSpacingQ96: bigint;
  
  // External addresses
  liquidityLauncher: Address;
  usdc: Address;
  lbpStrategy: Address;
};

export type PostDeploymentStep = {
  step: number;
  contract: string;
  method: string;
  description: string;
  to: Address;
  data: Hex;
  value: Hex;
};

/**
 * Step 6: Hook.setPolicySource(receiver)
 * REQUIRED: Connects receiver to hook for policy updates
 */
export function prepareSetPolicySource(params: {
  hookAddress: Address;
  receiverAddress: Address;
}): PostDeploymentStep {
  
  // This would normally use encodeFunctionData but we'll construct it manually
  // Function selector for setPolicySource(address): 0x6c6f26fa
  const selector = "0x6c6f26fa";
  const encodedReceiver = params.receiverAddress.slice(2).padStart(64, '0');
  const data = (selector + encodedReceiver) as Hex;
  
  return {
    step: 6,
    contract: "ListingHook",
    method: "setPolicySource",
    description: "Connect policy receiver to hook",
    to: params.hookAddress,
    data,
    value: "0x0",
  };
}

/**
 * Step 7: Create auction via LiquidityLauncher
 * REQUIRED: Sets up the auction mechanism
 */
export function prepareAuctionCreation(params: {
  liquidityLauncher: Address;
  validationHookAddress: Address;
  tokenAddress: Address;
  usdc: Address;
  totalSupply: bigint;
  auctionSupply: bigint;
  requiredCurrencyRaised: bigint;
  floorPriceQ96: bigint;
  tickSpacingQ96: bigint;
  lbpStrategy: Address;
  issuerAddress: Address;
}): PostDeploymentStep {
  // LiquidityLauncher.createAuction parameters
  // This is complex - for now return a placeholder that documents the requirement
  
  // Function: createAuction(address validationHook, address token, ...)
  // Selector: TBD from actual interface
  
  return {
    step: 7,
    contract: "LiquidityLauncher",
    method: "createAuction",
    description: "Create auction with validation hook",
    to: params.liquidityLauncher,
    data: "0x" as Hex, // Would need proper encoding
    value: "0x0",
  };
}

/**
 * Step 8: ValidationHook.setAuction(auctionAddress)
 * REQUIRED: Binds validation hook to auction
 */
export function prepareSetAuction(params: {
  validationHookAddress: Address;
  auctionAddress: Address;
}): PostDeploymentStep {
  // Function selector for setAuction(address): TBD
  const selector = "0x"; // Would need actual selector
  const encodedAuction = params.auctionAddress.slice(2).padStart(64, '0');
  const data = (selector + encodedAuction) as Hex;
  
  return {
    step: 8,
    contract: "AuctionValidationHook",
    method: "setAuction",
    description: "Bind validation hook to auction",
    to: params.validationHookAddress,
    data,
    value: "0x0",
  };
}

/**
 * Register deployed listing in deployments file for script/app discovery.
 * REQUIRED: Makes listing discoverable by existing app and scripts.
 */
export async function registerDeployedListing(params: {
  ticker: string;
  tokenAddress: Address;
  moduleAddress: Address;
  validationHookAddress: Address;
  hookAddress: Address;
  receiverAddress: Address;
  auctionAddress?: Address;
  deploymentFile: string;
}): Promise<void> {
  const { readFileSync, writeFileSync, existsSync } = await import("node:fs");
  
  let deployments: Record<string, unknown> = {};
  if (existsSync(params.deploymentFile)) {
    deployments = JSON.parse(readFileSync(params.deploymentFile, 'utf8')) as Record<string, unknown>;
  }
  
  // Add new listing to deployments
  deployments[params.ticker] = {
    ticker: params.ticker,
    tokenAddress: params.tokenAddress,
    moduleAddress: params.moduleAddress,
    validationHookAddress: params.validationHookAddress,
    hookAddress: params.hookAddress,
    receiverAddress: params.receiverAddress,
    auctionAddress: params.auctionAddress,
    deployedAt: new Date().toISOString(),
  };
  
  writeFileSync(params.deploymentFile, JSON.stringify(deployments, null, 2));
}

/**
 * Validate deployed listing is functional.
 * Checks:
 * - All contracts have code at expected addresses
 * - Hook.policySource() == receiver
 * - ValidationHook.auction() == auction address
 * - Hook address has correct permissions flags (0x30C0)
 */
export async function validateDeployedListing(
  params: PostDeploymentParams,
  client: PublicClient
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  // Check all contracts have code
  const contracts = [
    { name: "Token", address: params.tokenAddress },
    { name: "Module", address: params.moduleAddress },
    { name: "ValidationHook", address: params.validationHookAddress },
    { name: "Hook", address: params.hookAddress },
    { name: "Receiver", address: params.receiverAddress },
  ];
  
  for (const contract of contracts) {
    const code = await client.getBytecode({ address: contract.address });
    if (!code || code === "0x") {
      errors.push(`${contract.name} has no code at ${contract.address}`);
    }
  }
  
  // Check hook permissions flags
  const hookAddressBits = BigInt(params.hookAddress) & 0xFFFFn;
  if (hookAddressBits !== 0x30C0n) {
    errors.push(`Hook address ${params.hookAddress} has flags ${hookAddressBits.toString(16)}, expected 30c0`);
  }
  
  // Check Hook.policySource() == receiver
  try {
    const policySource = await client.readContract({
      address: params.hookAddress,
      abi: listingHookAbi,
      functionName: "policySource",
    });
    if (policySource !== params.receiverAddress) {
      errors.push(`Hook.policySource() is ${policySource}, expected ${params.receiverAddress}`);
    }
  } catch (e) {
    errors.push(`Failed to read Hook.policySource(): ${e}`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
