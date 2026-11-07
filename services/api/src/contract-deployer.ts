/**
 * Contract deployment orchestrator using viem for browser-wallet-based deployment.
 * 
 * CRITICAL PREREQUISITE:
 * Contracts must be compiled with `forge build` before deployment can work.
 * This creates bytecode artifacts in contracts/out/ that this module loads.
 * 
 * DEPLOYMENT FLOW:
 * 1. API returns unsigned transaction data for each deployment step
 * 2. Browser wallet signs and broadcasts transaction
 * 3. Browser sends back transaction hash
 * 4. API waits for receipt and extracts deployed address
 * 5. Repeat for each contract in sequence
 * 
 * This approach ensures browser wallet pays for all deployments and server never
 * holds private keys for token deployment.
 */
import { type Address, type Hex, encodeDeployData, getAddress, keccak256, toHex, encodePacked } from "viem";
import { isCompiled, loadDeploymentBytecodes } from "./contract-bytecode.ts";

export type DeploymentStep = {
  step: number;
  totalSteps: number;
  contract: string;
  description: string;
  unsignedTx: {
    to: null;
    data: Hex;
    value: string;
  };
};

export type DeploymentParams = {
  tokenName: string;
  tokenSymbol: string;
  recipient: Address;
  // Additional params for other contracts
  usdc: Address;
  poolManager: Address;
  forwarder: Address;
  broadcaster: Address;
};

/**
 * Generate deployment transaction for MockSME token with CREATE2 salt mining
 * to ensure token address sorts above USDC (so USDC is currency0).
 */
export function prepareMockSMEDeployment(params: {
  name: string;
  symbol: string;
  recipient: Address;
  usdc: Address;
  create2Factory: Address;
}): { tx: DeploymentStep; salt: Hex; predictedAddress: Address } {
  if (!isCompiled()) {
    throw new Error(
      "Contracts not compiled. Run 'cd contracts && forge build' before attempting deployment. " +
      "Bytecode artifacts are required to generate deployment transactions."
    );
  }

  const bytecodes = loadDeploymentBytecodes();
  
  // Encode constructor with name, symbol, recipient
  const deployData = encodeDeployData({
    abi: bytecodes.mockSME.abi,
    bytecode: bytecodes.mockSME.bytecode,
    args: [params.name, params.symbol, params.recipient],
  });

  // Mine CREATE2 salt to get address > USDC
  const initCodeHash = keccak256(deployData);
  let i = 0;
  let salt: Hex = keccak256(encodePacked(["string", "uint256"], ["MockSME#", BigInt(i)]));
  let predictedAddress = computeCreate2Address(params.create2Factory, salt, initCodeHash);
  
  // Mine salt until address > USDC
  while (BigInt(predictedAddress) < BigInt(params.usdc)) {
    i++;
    salt = keccak256(encodePacked(["string", "uint256"], ["MockSME#", BigInt(i)]));
    predictedAddress = computeCreate2Address(params.create2Factory, salt, initCodeHash);
    
    if (i > 10000) {
      throw new Error("Failed to mine CREATE2 salt for MockSME address > USDC after 10000 attempts");
    }
  }

  // CREATE2 deployment requires calling the factory
  // For simplicity, we'll use regular CREATE for now and document the limitation
  const tx: DeploymentStep = {
    step: 1,
    totalSteps: 5,
    contract: "MockSME",
    description: `Deploy ${params.symbol} token (${params.name}) with 110,000 supply to ${params.recipient}`,
    unsignedTx: {
      to: null,
      data: deployData,
      value: "0",
    },
  };

  return { tx, salt, predictedAddress };
}

/**
 * Compute CREATE2 address.
 */
function computeCreate2Address(factory: Address, salt: Hex, initCodeHash: Hex): Address {
  const data = encodePacked(
    ["bytes1", "address", "bytes32", "bytes32"],
    ["0xff", factory, salt, initCodeHash]
  );
  const hash = keccak256(data);
  return getAddress(("0x" + hash.slice(-40)) as Address);
}

/**
 * Prepare AllowAllModule deployment.
 * Requires predicted AuctionValidationHook address (deployer's next nonce + 1).
 */
export function prepareAllowAllModuleDeployment(params: {
  predictedValidationHook: Address;
  applicantCap: bigint;
}): DeploymentStep {
  if (!isCompiled()) {
    throw new Error("Contracts not compiled. Run 'cd contracts && forge build' first.");
  }

  const bytecodes = loadDeploymentBytecodes();

  const deployData = encodeDeployData({
    abi: bytecodes.allowAllModule.abi,
    bytecode: bytecodes.allowAllModule.bytecode,
    args: [params.predictedValidationHook, params.applicantCap],
  });

  return {
    step: 2,
    totalSteps: 5,
    contract: "AllowAllModule",
    description: `Deploy AllowAllModule with ${params.applicantCap} USDC cap per wallet`,
    unsignedTx: {
      to: null,
      data: deployData,
      value: "0",
    },
  };
}

/**
 * BLOCKER DOCUMENTATION:
 * 
 * This module implements the deployment flow but requires:
 * 
 * 1. COMPILED CONTRACTS: Run `cd contracts && forge build`
 *    - Creates contracts/out/ with bytecode artifacts
 *    - Without this, deployment will fail with clear error
 * 
 * 2. CREATE2 FACTORY: For salted MockSME deployment
 *    - Sepolia: 0x4e59b44847b379578588920cA78FbF26c0B4956C (canonical)
 *    - Requires factory address in deployment config
 * 
 * 3. BROWSER WALLET INTEGRATION:
 *    - UI must request user to sign each deployment transaction
 *    - UI sends back transaction hashes to API
 *    - API waits for receipts and extracts addresses
 * 
 * 4. SEQUENTIAL DEPLOYMENT:
 *    - Some contracts need addresses of others
 *    - Module needs predicted validation hook address
 *    - Hook needs token + module addresses
 *    - Receiver is independent
 * 
 * The current implementation provides:
 * ✅ Clear error when bytecode missing
 * ✅ Transaction preparation functions
 * ✅ CREATE2 salt mining logic
 * ⚠️ Simplified CREATE deployment (CREATE2 factory integration TODO)
 * ❌ Full 5-step deployment sequence (stubbed below)
 */

export function prepareNextDeploymentStep(
  currentStep: number,
  previousAddresses: Partial<{
    token: Address;
    module: Address;
    validationHook: Address;
    hook: Address;
    receiver: Address;
  }>,
  params: DeploymentParams
): DeploymentStep | null {
  if (!isCompiled()) {
    throw new Error(
      "Contracts not compiled. PREREQUISITE: Run 'cd contracts && forge build' to generate bytecode artifacts."
    );
  }

  // Return null if deployment complete
  if (currentStep > 5) {
    return null;
  }

  // This is where the full sequence would be implemented
  // Each step would check previous addresses and prepare next deployment
  throw new Error(
    "Full deployment sequence not yet implemented. " +
    "Use forge script for now: forge script script/demo/DemoDeploy.s.sol --rpc-url $RPC --broadcast"
  );
}

/**
 * Deployment status check for server-side approach.
 * 
 * ALTERNATIVE APPROACH (if browser wallet approach is too complex):
 * Use a separate DEPLOYER_KEY (NOT the policy broadcaster key) for server-side deployment.
 * This would require:
 * - DEPLOYER_PRIVATE_KEY env var
 * - Funded Sepolia account
 * - Updated security docs
 * - Clear separation from policy relay key
 */
export function requiresDeployerKey(): boolean {
  // For now, we expect browser wallet approach
  // If server-side deployment is needed, this would return true
  // and check for DEPLOYER_PRIVATE_KEY env var
  return false;
}
