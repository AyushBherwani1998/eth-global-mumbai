/**
 * Registry integration - makes browser-created listings discoverable by app and scripts.
 * 
 * Listings deployed via browser AND via script must both be registered in the
 * deployments file for app discovery. This file provides compatibility with the
 * existing DemoDeploy.s.sol output format.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Address } from "viem";

export type DeployedListing = {
  // Metadata
  chainId: number;
  label: string;
  deployBlock: number;
  deployer: Address;
  issuer: Address;
  treasury: Address;
  creBroadcaster: Address;
  
  // External addresses (network config)
  external: {
    usdc: Address;
    permit2: Address;
    poolManager: Address;
    positionManager: Address;
    universalRouter: Address;
    stateView: Address;
    quoter: Address;
    ccaFactory: Address;
    liquidityLauncher: Address;
    lbpStrategy: Address;
    creMockForwarder: Address;
    create2Factory: Address;
  };
  
  // Deployed contracts
  contracts: {
    mockSME: Address;
    allowAllModule: Address;
    auctionValidationHook: Address;
    listingHook: Address;
    listingPolicyReceiver: Address;
  };
  
  // Pool configuration
  pool: {
    poolId: string;
    usdcIsCurrency0: boolean;
    listingDayBandBps: number;
    listingDaySeconds: number;
    poolKey: {
      currency0: Address;
      currency1: Address;
      fee: number;
      tickSpacing: number;
      hooks: Address;
    };
  };
  
  // Receiver configuration
  receiverConfig: {
    forwarder: Address;
    broadcaster: Address;
    chainSelector: string;
    maxAge: number;
  };
  
  // Parameters (constants)
  params: {
    totalSupply: string;
    auctionSupply: string;
    lpReserve: string;
    applicantCap: string;
    requiredCurrencyRaised: string;
    floorPoints: number;
    issuePoints: number;
    capPoints: number;
    floorPriceQ96: string;
    capPriceQ96: string;
    tickSpacingQ96: string;
    onePointQ96: string;
    lpRateMps: number;
  };
  
  // Auction (populated after launch)
  auction?: {
    address: Address;
    startBlock: number;
    endBlock: number;
    claimBlock: number;
    migrationBlock: number;
    bidWindowBlocks: number;
    bidWindowEndBlock: number;
    clearBlocks: number;
    totalSupply: string;
    floorPriceQ96: string;
    tickSpacingQ96: string;
    requiredCurrencyRaised: string;
    reservedTokenAmountForLP: string;
    tokensRecipient: Address;
    fundsRecipient: Address;
    validationHook: Address;
  };
  
  // Transaction history
  txs?: Record<string, unknown>;
  
  // Other sections
  bids?: Record<string, unknown>;
  results?: Record<string, unknown>;
  trade?: Record<string, unknown>;
  halt?: Record<string, unknown>;
  ens?: Record<string, unknown>;
};

/**
 * Register a browser-deployed listing in the deployments file.
 * Makes it discoverable by app and compatible with script output format.
 */
export function registerListing(
  deploymentFile: string,
  listing: Partial<DeployedListing>
): void {
  try {
    // Ensure directory exists
    const dir = dirname(deploymentFile);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    // Write deployment file
    writeFileSync(deploymentFile, JSON.stringify(listing, null, 2), "utf8");
    console.log("[registry] Registered listing in", deploymentFile);
  } catch (e) {
    console.error("[registry] Failed to register listing:", e);
    throw new Error("Failed to register listing in deployments file", { cause: e });
  }
}

/**
 * Load existing deployment file if it exists.
 */
export function loadDeployment(deploymentFile: string): DeployedListing | null {
  try {
    if (existsSync(deploymentFile)) {
      const data = readFileSync(deploymentFile, "utf8");
      return JSON.parse(data) as DeployedListing;
    }
  } catch (e) {
    console.error("[registry] Failed to load deployment:", e);
  }
  return null;
}

/**
 * Update a section of the deployment file (e.g., "auction", "pool").
 */
export function updateDeploymentSection(
  deploymentFile: string,
  section: string,
  data: unknown
): void {
  try {
    const deployment = loadDeployment(deploymentFile) || {};
    (deployment as Record<string, unknown>)[section] = data;
    registerListing(deploymentFile, deployment);
  } catch (e) {
    console.error("[registry] Failed to update section:", e);
    throw new Error(`Failed to update ${section} in deployments file`, { cause: e });
  }
}

/**
 * Create deployment file path for a ticker.
 */
export function getDeploymentPath(ticker: string, chainId: number): string {
  const network = chainId === 11155111 ? "sepolia" : `chain-${chainId}`;
  return `/data/deployments/${network}/${ticker}.json`;
}

/**
 * List all deployments for a network.
 */
export async function listDeployments(chainId: number): Promise<DeployedListing[]> {
  const network = chainId === 11155111 ? "sepolia" : `chain-${chainId}`;
  const deploymentsDir = `/data/deployments/${network}`;
  
  if (!existsSync(deploymentsDir)) {
    return [];
  }
  
  try {
    const { readdirSync } = await import("node:fs");
    const files = readdirSync(deploymentsDir) as string[];
    return files
      .filter((f: string) => f.endsWith(".json"))
      .map((f: string) => loadDeployment(`${deploymentsDir}/${f}`))
      .filter((d: DeployedListing | null): d is DeployedListing => d !== null);
  } catch (e) {
    console.error("[registry] Failed to list deployments:", e);
    return [];
  }
}
