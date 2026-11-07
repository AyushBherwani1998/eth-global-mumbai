/**
 * Contract deployment orchestrator - actually deploys contracts via forge scripts.
 * Integrates with existing DemoDeploy script and tracks state properly.
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { type Address, type Hex, getAddress } from "viem";
import type { DeploymentJson } from "./config.ts";

const execAsync = promisify(exec);

export type DeploymentParams = {
  ticker: string;
  tokenName: string;
  tokenSymbol: string;
  deployerAddress: Address;
  privateKey: Hex;
  rpcUrl: string;
  chainId: number;
  label?: string;
  config?: {
    totalSupply?: string;
    auctionSupply?: string;
    lpReserve?: string;
    applicantCap?: string;
    requiredCurrencyRaised?: string;
    floorPoints?: string;
    issuePoints?: string;
    capPoints?: string;
  };
};

export type DeploymentResult = {
  success: boolean;
  deploymentFile?: string;
  deployment?: DeploymentJson;
  tokenAddress?: Address;
  hookAddress?: Address;
  receiverAddress?: Address;
  moduleAddress?: Address;
  validationHookAddress?: Address;
  error?: string;
  logs?: string;
};

/**
 * Deploy a new listing using the existing forge deployment scripts.
 * This calls `forge script script/demo/DemoDeploy.s.sol` with appropriate env vars.
 */
export async function deployListing(params: DeploymentParams): Promise<DeploymentResult> {
  const contractsDir = resolve(process.cwd(), "../../contracts");
  
  if (!existsSync(contractsDir)) {
    return {
      success: false,
      error: `Contracts directory not found at ${contractsDir}. Ensure API is running from services/api.`,
    };
  }

  // Construct deployment label
  const label = params.label || `${params.ticker}-${Date.now()}`;
  const deploymentFile = resolve(contractsDir, `deployments/${params.ticker}.json`);

  try {
    // Set up environment for forge script
    const env = {
      ...process.env,
      PRIVATE_KEY: params.privateKey,
      DEMO_LABEL: label,
      RPC_URL: params.rpcUrl,
      DEPLOYMENTS_FILE: deploymentFile,
      // Optional config overrides
      ...(params.config?.totalSupply && { TOTAL_SUPPLY: params.config.totalSupply }),
      ...(params.config?.auctionSupply && { AUCTION_SUPPLY: params.config.auctionSupply }),
      ...(params.config?.lpReserve && { LP_RESERVE: params.config.lpReserve }),
      ...(params.config?.applicantCap && { APPLICANT_CAP: params.config.applicantCap }),
      ...(params.config?.requiredCurrencyRaised && { REQUIRED_CURRENCY_RAISED: params.config.requiredCurrencyRaised }),
    };

    // Execute deployment script
    const { stdout, stderr } = await execAsync(
      `forge script script/demo/DemoDeploy.s.sol --rpc-url ${params.rpcUrl} --broadcast --slow`,
      {
        cwd: contractsDir,
        env,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for logs
      }
    );

    const logs = stdout + (stderr ? `\nSTDERR:\n${stderr}` : "");

    // Check if deployment file was created
    if (!existsSync(deploymentFile)) {
      return {
        success: false,
        error: "Deployment script completed but deployment file not found",
        logs,
      };
    }

    // Read deployment file
    const deployment = JSON.parse(readFileSync(deploymentFile, "utf8")) as DeploymentJson;

    // Extract addresses
    const tokenAddress = deployment.contracts?.mockSME ? getAddress(deployment.contracts.mockSME) : undefined;
    const hookAddress = deployment.contracts?.listingHook ? getAddress(deployment.contracts.listingHook) : undefined;
    const receiverAddress = deployment.contracts?.listingPolicyReceiver ? getAddress(deployment.contracts.listingPolicyReceiver) : undefined;
    const moduleAddress = deployment.contracts?.allowAllModule ? getAddress(deployment.contracts.allowAllModule) : undefined;
    const validationHookAddress = deployment.contracts?.auctionValidationHook ? getAddress(deployment.contracts.auctionValidationHook) : undefined;

    return {
      success: true,
      deploymentFile,
      deployment,
      tokenAddress,
      hookAddress,
      receiverAddress,
      moduleAddress,
      validationHookAddress,
      logs,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      logs: error instanceof Error && 'stdout' in error ? String((error as any).stdout) : undefined,
    };
  }
}

/**
 * Check if a deployment can be resumed (deployment file exists with partial state).
 */
export function canResumeDeployment(ticker: string): boolean {
  const contractsDir = resolve(process.cwd(), "../../contracts");
  const deploymentFile = resolve(contractsDir, `deployments/${ticker}.json`);
  return existsSync(deploymentFile);
}

/**
 * Read existing deployment state.
 */
export function readDeploymentState(ticker: string): DeploymentJson | null {
  const contractsDir = resolve(process.cwd(), "../../contracts");
  const deploymentFile = resolve(contractsDir, `deployments/${ticker}.json`);
  
  if (!existsSync(deploymentFile)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(deploymentFile, "utf8")) as DeploymentJson;
  } catch {
    return null;
  }
}
