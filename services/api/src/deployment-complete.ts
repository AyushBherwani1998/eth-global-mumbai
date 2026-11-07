/**
 * Complete 8-step deployment orchestration for browser-wallet-based listing creation.
 * 
 * ARCHITECTURE:
 * - Browser wallet signs each deployment transaction
 * - API provides unsigned tx data with proper constructor args
 * - API tracks progress and handles dependencies between steps
 * - Uses CREATE2 for token, regular CREATE for others
 * 
 * DEPLOYMENT SEQUENCE:
 * 1. MockSME token (CREATE2, address > USDC)
 * 2. AllowAllModule (needs predicted ValidationHook address from next nonce)
 * 3. AuctionValidationHook (needs Module address)
 * 4. ListingHook (needs token, uses address mining for flags 0x30C0)
 * 5. ListingPolicyReceiver (needs forwarder & broadcaster)
 * 6. Hook.setPolicySource(receiver) - REQUIRED for policy updates
 * 7. Create auction via LiquidityLauncher - REQUIRED for trading  
 * 8. ValidationHook.setAuction(auction) - REQUIRED binding
 */

// Load pre-compiled bytecode artifacts (committed to repo).
// These were extracted from forge build output at build time.
// No runtime forge dependency - bytecode is bundled with API.

import { 
  type Address, 
  type Hex, 
  type PublicClient,
  encodeDeployData, 
  getAddress, 
  encodePacked, 
  keccak256,
  getContractAddress,
  concat
} from "viem";

import {
  mockSmeAbi,
  allowAllModuleAbi,
  validationHookAbi,
  listingHookAbi,
  receiverAbi
} from "./abis.generated.ts";

import { prepareSetPolicySourceStep } from "./deployment-complete-step6.ts";

export type DeploymentParams = {
  // Token params
  tokenName: string;
  tokenSymbol: string;
  issuerAddress: Address;
  
  // Network config  
  usdc: Address;
  poolManager: Address;
  forwarder: Address; // MockKeystoneForwarder on Sepolia
  broadcaster: Address; // CRE broadcaster
  
  // Optional config
  applicantCap?: bigint; // Default 20M USDC (20_000_000 * 10^6)
  maxAge?: bigint; // Policy max age, default 1 day
  listingDayDuration?: number; // Default 1 hour
  listingDayBandBps?: number; // Default 500 (5%)
};

export type DeploymentStep = {
  step: number;
  totalSteps: 5 | 8;
  contract: string;
  description: string;
  to: Address | null;
  data: Hex;
  value: Hex;
  gasLimit?: Hex;
  predictedAddress?: Address;
  dependencies?: {
    token?: Address;
    module?: Address;
    validationHook?: Address;
    hook?: Address;
  };
};

export type DeploymentState = {
  token?: Address;
  module?: Address;
  validationHook?: Address;
  hook?: Address;
  receiver?: Address;
  currentStep: number;
  completed: boolean;
};

/**
 * Compute CREATE2 address for deterministic deployment.
 */
function computeCreate2Address(
  factory: Address,
  salt: Hex,
  initCodeHash: Hex
): Address {
  const data = encodePacked(
    ["bytes1", "address", "bytes32", "bytes32"],
    ["0xff", factory, salt, initCodeHash]
  );
  const hash = keccak256(data);
  return getAddress(("0x" + hash.slice(-40)) as Address);
}

/**
 * Mine CREATE2 salt to ensure token address > USDC (so USDC is currency0).
 */
function mineSaltForToken(
  deployData: Hex,
  usdc: Address,
  create2Factory: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C" // Canonical CREATE2 factory
): { salt: Hex; predictedAddress: Address } {
  const initCodeHash = keccak256(deployData);
  
  let i = 0;
  let salt: Hex;
  let predictedAddress: Address;
  
  do {
    salt = keccak256(encodePacked(["string"], [`MockSME#${i}`]));
    predictedAddress = computeCreate2Address(create2Factory, salt, initCodeHash);
    i++;
    
    if (i > 10000) {
      throw new Error("Failed to mine CREATE2 salt for token address > USDC after 10000 attempts");
    }
  } while (BigInt(predictedAddress) <= BigInt(usdc));
  
  return { salt, predictedAddress };
}

/**
 * Mine hook address with required permission flags.
 * ListingHook needs flags 0x30C0 (beforeAddLiquidity, beforeSwap, beforeDonate).
 */
function mineHookAddress(
  deployer: Address,
  startNonce: bigint,
  requiredFlags: Hex = "0x30c0"
): { targetNonce: bigint; predictedAddress: Address } {
  let nonce = startNonce;
  let predictedAddress: Address;
  
  do {
    predictedAddress = getContractAddress({
      from: deployer,
      nonce,
    });
    
    // Check if address & 0xFFFF == requiredFlags
    const addressBits = BigInt(predictedAddress) & 0xFFFFn;
    if (addressBits === BigInt(requiredFlags)) {
      return { targetNonce: nonce, predictedAddress };
    }
    
    nonce++;
    if (nonce > startNonce + 10000n) {
      throw new Error("Failed to mine hook address with required flags after 10000 attempts");
    }
  } while (true); // eslint-disable-line no-constant-condition
}

/**
 * Step 1: Deploy MockSME token via CREATE2.
 */
export function prepareTokenDeployment(
  params: DeploymentParams,
  bytecode: Hex
): DeploymentStep {
  const deployData = encodeDeployData({
    abi: mockSmeAbi,
    bytecode,
    args: [params.tokenName, params.tokenSymbol, params.issuerAddress],
  });
  
  const { salt, predictedAddress } = mineSaltForToken(deployData, params.usdc);
  
  // For CREATE2, we need to call the factory
  const create2Factory = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
  const factoryCallData = concat([salt, deployData]);
  
  return {
    step: 1,
    totalSteps: 5,
    contract: "MockSME",
    description: `Deploy ${params.tokenSymbol} token via CREATE2`,
    to: create2Factory,
    data: factoryCallData,
    value: "0x0",
    predictedAddress,
    dependencies: {},
  };
}

/**
 * Step 2: Deploy AllowAllModule.
 * Needs predicted ValidationHook address (deployer's current nonce + 1).
 */
export async function prepareModuleDeployment(
  params: DeploymentParams,
  bytecode: Hex,
  deployer: Address,
  client: PublicClient
): Promise<DeploymentStep> {
  const currentNonce = await client.getTransactionCount({ address: deployer });
  const predictedValidationHook = getContractAddress({
    from: deployer,
    nonce: BigInt(currentNonce) + 1n,
  });
  
  const applicantCap = params.applicantCap || 20_000_000n * 10n ** 6n; // 20M USDC
  
  const deployData = encodeDeployData({
    abi: allowAllModuleAbi,
    bytecode,
    args: [predictedValidationHook, applicantCap],
  });
  
  const predictedModule = getContractAddress({
    from: deployer,
    nonce: BigInt(currentNonce),
  });
  
  return {
    step: 2,
    totalSteps: 5,
    contract: "AllowAllModule",
    description: `Deploy AllowAllModule with ${applicantCap / 10n ** 6n}M USDC cap`,
    to: null,
    data: deployData,
    value: "0x0",
    predictedAddress: predictedModule,
    dependencies: {},
  };
}

/**
 * Step 3: Deploy AuctionValidationHook.
 */
export function prepareValidationHookDeployment(
  params: DeploymentParams,
  bytecode: Hex,
  state: { token: Address; module: Address }
): DeploymentStep {
  // Cap price: 190 points = 190 * 7.92281625142e11 Q96
  const capPriceQ96 = 190n * 792281625142n;
  
  const deployData = encodeDeployData({
    abi: validationHookAbi,
    bytecode,
    args: [state.module, state.token, params.usdc, capPriceQ96],
  });
  
  return {
    step: 3,
    totalSteps: 5,
    contract: "AuctionValidationHook",
    description: "Deploy AuctionValidationHook with 190-point cap",
    to: null,
    data: deployData,
    value: "0x0",
    dependencies: {
      token: state.token,
      module: state.module,
    },
  };
}

/**
 * Step 4: Deploy ListingHook with address mining for flags 0x30C0.
 */
export async function prepareListingHookDeployment(
  params: DeploymentParams,
  bytecode: Hex,
  state: { token: Address; validationHook: Address },
  deployer: Address,
  client: PublicClient
): Promise<DeploymentStep & { dummyNonce: bigint; targetNonce: bigint }> {
  const currentNonce = await client.getTransactionCount({ address: deployer });
  
  // Mine for hook address with required flags
  const { targetNonce, predictedAddress } = mineHookAddress(deployer, BigInt(currentNonce), "0x30c0");
  
  const listingDayBandBps = params.listingDayBandBps || 500; // 5%
  const listingDayDuration = params.listingDayDuration || 3600; // 1 hour
  
  // Hook config struct
  const hookConfig = {
    owner: params.issuerAddress,
    usdc: params.usdc,
    token: state.token,
    fee: 3000, // 0.3%
    tickSpacing: 60,
    listingDayBandBps,
    listingDayDuration,
    policySource: "0x0000000000000000000000000000000000000000", // Will be set later
  };
  
  const deployData = encodeDeployData({
    abi: listingHookAbi,
    bytecode,
    args: [params.poolManager, params.issuerAddress, hookConfig] as unknown as readonly [Address, Address, Hex],
  });
  
  return {
    step: 4,
    totalSteps: 5,
    contract: "ListingHook",
    description: `Deploy ListingHook (mining for flags 0x30C0, nonce ${targetNonce})`,
    to: null,
    data: deployData,
    value: "0x0",
    predictedAddress,
    dummyNonce: BigInt(currentNonce),
    targetNonce,
    dependencies: {
      token: state.token,
      validationHook: state.validationHook,
    },
  };
}

/**
 * Step 5: Deploy ListingPolicyReceiver.
 */
export function prepareReceiverDeployment(
  params: DeploymentParams,
  bytecode: Hex
): DeploymentStep {
  const maxAge = params.maxAge || 86400n; // 1 day
  
  const deployData = encodeDeployData({
    abi: receiverAbi,
    bytecode,
    args: [params.forwarder, params.broadcaster, maxAge] as unknown as readonly [Address, Address, bigint],
  });
  
  return {
    step: 5,
    totalSteps: 5,
    contract: "ListingPolicyReceiver",
    description: "Deploy ListingPolicyReceiver for CRE policy updates",
    to: null,
    data: deployData,
    value: "0x0",
    dependencies: {},
  };
}

/**
 * Get the next deployment step based on current state.
 */
export async function getNextDeploymentStep(
  params: DeploymentParams,
  state: DeploymentState,
  deployer: Address,
  client: PublicClient,
  bytecodes: {
    mockSME: Hex;
    allowAllModule: Hex;
    auctionValidationHook: Hex;
    listingHook: Hex;
    listingPolicyReceiver: Hex;
  }
): Promise<DeploymentStep | null> {
  if (state.completed) {
    return null;
  }
  
  switch (state.currentStep) {
    case 1:
      if (state.token) return null; // Already have token
      return prepareTokenDeployment(params, bytecodes.mockSME);
    
    case 2:
      if (!state.token) throw new Error("Token not deployed yet");
      if (state.module) return null;
      return await prepareModuleDeployment(params, bytecodes.allowAllModule, deployer, client);
    
    case 3:
      if (!state.token || !state.module) throw new Error("Token and Module required");
      if (state.validationHook) return null;
      return prepareValidationHookDeployment(
        params,
        bytecodes.auctionValidationHook,
        { token: state.token, module: state.module }
      );
    
    case 4:
      if (!state.token || !state.validationHook) throw new Error("Token and ValidationHook required");
      if (state.hook) return null;
      return await prepareListingHookDeployment(
        params,
        bytecodes.listingHook,
        { token: state.token, validationHook: state.validationHook },
        deployer,
        client
      );
    
    case 5:
      if (state.receiver) return null;
      return prepareReceiverDeployment(params, bytecodes.listingPolicyReceiver);
    
    case 6:
      // REQUIRED: Connect receiver to hook for policy updates
      if (!state.hook || !state.receiver) throw new Error("Hook and Receiver required");
      return prepareSetPolicySourceStep({ hookAddress: state.hook, receiverAddress: state.receiver });
    
    case 7:
      // Step 7 is now multi-phase in the browser: 7a (token approve), 7b (Permit2 approve), 7c (multicall)
      // Return metadata indicating browser needs to handle auction creation
      // This is logged as a warning but the browser orchestrator will handle it
      console.warn("Step 7 requires browser-side auction creation (approvals + multicall)");
      return null;
    
    case 8:
      // Step 8 requires auction address from step 7, which must be extracted from logs
      console.warn("Step 8 (setAuction) requires auction address from step 7 completion");
      return null;
    
    default:
      return null;
  }
}
