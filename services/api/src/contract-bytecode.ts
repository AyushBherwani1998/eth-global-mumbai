/**
 * Contract bytecode loader - requires compiled artifacts from forge build.
 * 
 * PREREQUISITE: Run `forge build` in contracts/ directory to generate bytecode.
 * This module loads bytecode from contracts/out/ directory created by forge.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Hex } from "viem";

export type ContractBytecode = {
  bytecode: Hex;
  abi: any[];
};

const CONTRACTS_DIR = resolve(process.cwd(), "../../contracts");
const OUT_DIR = resolve(CONTRACTS_DIR, "out");

/**
 * Check if contracts are compiled (out/ directory exists with artifacts).
 */
export function isCompiled(): boolean {
  return existsSync(OUT_DIR) && existsSync(resolve(OUT_DIR, "MockSME.sol"));
}

/**
 * Load contract bytecode and ABI from forge artifacts.
 * @param contractName - Name of the contract (e.g., "MockSME")
 * @param solPath - Relative path to .sol file from contracts/src (e.g., "MockSME.sol")
 */
export function loadBytecode(contractName: string, solPath: string): ContractBytecode {
  if (!isCompiled()) {
    throw new Error(
      `Contracts not compiled. Run 'cd contracts && forge build' to generate bytecode. ` +
      `Expected artifacts in ${OUT_DIR}`
    );
  }

  const artifactPath = resolve(OUT_DIR, solPath, `${contractName}.json`);
  
  if (!existsSync(artifactPath)) {
    throw new Error(`Contract artifact not found: ${artifactPath}`);
  }

  try {
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    
    if (!artifact.bytecode?.object) {
      throw new Error(`No bytecode found in artifact for ${contractName}`);
    }

    const bytecode = artifact.bytecode.object as Hex;
    const abi = artifact.abi || [];

    if (bytecode === "0x" || bytecode.length < 4) {
      throw new Error(`Invalid bytecode for ${contractName} (too short or empty)`);
    }

    return { bytecode, abi };
  } catch (error) {
    throw new Error(
      `Failed to load bytecode for ${contractName}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Load all required contract bytecodes for listing deployment.
 */
export function loadDeploymentBytecodes(): {
  mockSME: ContractBytecode;
  allowAllModule: ContractBytecode;
  auctionValidationHook: ContractBytecode;
  listingHook: ContractBytecode;
  listingPolicyReceiver: ContractBytecode;
} {
  return {
    mockSME: loadBytecode("MockSME", "MockSME.sol"),
    allowAllModule: loadBytecode("AllowAllModule", "modules/AllowAllModule.sol"),
    auctionValidationHook: loadBytecode("AuctionValidationHook", "AuctionValidationHook.sol"),
    listingHook: loadBytecode("ListingHook", "ListingHook.sol"),
    listingPolicyReceiver: loadBytecode("ListingPolicyReceiver", "ListingPolicyReceiver.sol"),
  };
}
