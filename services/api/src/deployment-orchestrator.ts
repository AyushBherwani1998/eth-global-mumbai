/**
 * Browser-wallet deployment orchestrator.
 * 
 * ARCHITECTURE:
 * - Browser wallet signs all deployment transactions (NO server private keys for deployment)
 * - API provides unsigned transaction data with proper constructor args and CREATE2 salts
 * - Browser sends back transaction hashes, API waits for receipts
 * - Bytecode is pre-compiled and committed (run `npm run extract-bytecode` after forge script)
 * 
 * FLOW:
 * 1. User clicks "Create Listing" in browser
 * 2. API returns first deployment step (MockSME with CREATE2 salt)
 * 3. Browser wallet signs & broadcasts
 * 4. Browser sends tx hash to API
 * 5. API waits for receipt, extracts address
 * 6. Repeat for remaining contracts (Module, ValidationHook, Hook, Receiver)
 */
import { type Address, type Hex, encodeDeployData, getAddress, encodePacked, keccak256, parseAbi } from "viem";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Import ABIs from existing files
import { 
  mockSmeAbi,
  allowAllModuleAbi, 
  validationHookAbi,
  listingHookAbi,
  receiverAbi 
} from "./abis.generated.ts";

const BYTECODE_DIR = resolve(__dirname, "bytecode");

type BytecodeArtifact = {
  contractName: string;
  bytecode: Hex;
  extractedAt: string;
  source: string;
};

/**
 * Load pre-compiled bytecode (must be extracted with `npm run extract-bytecode`).
 */
function loadBytecode(contractName: string): Hex {
  const path = resolve(BYTECODE_DIR, `${contractName}.json`);
  
  if (!existsSync(path)) {
    throw new Error(
      `Bytecode not found for ${contractName}. ` +
      `Run: cd contracts && forge script script/demo/DemoDeploy.s.sol --fork-url http://localhost:8545 && ` +
      `cd ../../services/api && npm run extract-bytecode`
    );
  }
  
  const artifact: BytecodeArtifact = JSON.parse(readFileSync(path, 'utf8'));
  return artifact.bytecode;
}

export type UnsignedDeployTx = {
  to: null;
  data: Hex;
  value: `0x${string}`;
  gasLimit?: string;
};

export type DeploymentStep = {
  step: number;
  totalSteps: number;
  contract: string;
  description: string;
  unsignedTx: UnsignedDeployTx;
  predictedAddress?: Address; // For CREATE2
};

/**
 * Mine CREATE2 salt to ensure MockSME address > USDC (so USDC is currency0).
 */
function mineSaltForTokenAddress(
  tokenName: string,
  tokenSymbol: string,
  recipient: Address,
  usdc: Address,
  create2Factory: Address
): { salt: Hex; predictedAddress: Address; deployData: Hex } {
  // Load bytecode (this is the creation bytecode WITH constructor args already encoded)
  // We need to strip the constructor args and re-encode with our params
  const bytecode = loadBytecode("MockSME");
  
  // Encode deployment with constructor
  const deployData = encodeDeployData({
    abi: mockSmeAbi,
    bytecode: (bytecode.slice(0, bytecode.indexOf("000000") > 0 ? bytecode.indexOf("000000") : bytecode.length)) as `0x${string}`, // Strip appended constructor if any
    args: [tokenName, tokenSymbol, recipient],
  });
  
  const initCodeHash = keccak256(deployData);
  
  let i = 0;
  let salt: Hex;
  let predictedAddress: Address;
  
  do {
    salt = keccak256(encodePacked(["string", "uint256"], [`MockSME#${i}`, BigInt(i)]));
    
    // Compute CREATE2 address: keccak256(0xff ++ factory ++ salt ++ initCodeHash)[12:]
    const data = encodePacked(
      ["bytes1", "address", "bytes32", "bytes32"],
      ["0xff", create2Factory, salt, initCodeHash]
    );
    const hash = keccak256(data);
    predictedAddress = getAddress(("0x" + hash.slice(-40)) as Address);
    
    i++;
    if (i > 10000) {
      throw new Error("Failed to mine CREATE2 salt after 10000 attempts");
    }
  } while (BigInt(predictedAddress) <= BigInt(usdc));
  
  return { salt, predictedAddress, deployData };
}

/**
 * Prepare MockSME deployment transaction.
 * Uses CREATE2 to ensure address > USDC.
 */
export function prepareTokenDeployment(params: {
  tokenName: string;
  tokenSymbol: string;
  recipient: Address;
  usdc: Address;
  create2Factory: Address;
}): DeploymentStep & { salt: Hex } {
  const { salt, predictedAddress, deployData } = mineSaltForTokenAddress(
    params.tokenName,
    params.tokenSymbol,
    params.recipient,
    params.usdc,
    params.create2Factory
  );
  
  // For CREATE2 deployment, we need to call the factory with (salt, initCode)
  // For simplicity, return the deployment data and document CREATE2 factory call needed
  return {
    step: 1,
    totalSteps: 5,
    contract: "MockSME",
    description: `Deploy ${params.tokenSymbol} token (${params.tokenName}) via CREATE2`,
    predictedAddress,
    unsignedTx: {
      to: null,
      data: deployData, // Browser will need to wrap this in CREATE2 factory call
      value: "0x0" as `0x${string}`,
    },
    salt,
  };
}

/**
 * BLOCKER DOCUMENTATION:
 * 
 * Current implementation status:
 * ✅ Architecture designed (browser wallet signs, no server keys)
 * ✅ Bytecode extraction script created
 * ✅ CREATE2 salt mining logic implemented
 * ⚠️  Bytecode artifacts not yet committed (need to run forge script + extraction)
 * ⚠️  Full 5-step sequence not implemented (only token step done)
 * ⚠️  CREATE2 factory integration simplified (browser needs to call factory.deploy(salt, initCode))
 * 
 * REMAINING WORK:
 * 1. Run `cd contracts && forge script script/demo/DemoDeploy.s.sol --fork-url http://localhost:8545`
 * 2. Run `cd services/api && npm run extract-bytecode` to commit bytecode
 * 3. Implement remaining 4 deployment steps (Module, ValidationHook, Hook, Receiver)
 * 4. Wire browser UI to call API for each step, sign with wallet, send tx hash back
 * 5. Implement address mining for ListingHook (requires specific hook permissions flags)
 * 
 * The foundational architecture is correct - just needs the bytecode artifacts committed
 * and the remaining deployment steps implemented.
 */

export function isBytecodeAvailable(): boolean {
  return existsSync(BYTECODE_DIR) && existsSync(resolve(BYTECODE_DIR, "MockSME.json"));
}
