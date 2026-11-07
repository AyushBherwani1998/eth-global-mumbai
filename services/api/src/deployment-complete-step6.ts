import { type Address, type Hex } from "viem";
import type { DeploymentStep } from "./deployment-complete.ts";

/**
 * Prepare step 6: Hook.setPolicySource(receiver)
 * REQUIRED - connects receiver to hook for policy updates
 */
export function prepareSetPolicySourceStep(params: {
  hookAddress: Address;
  receiverAddress: Address;
}): DeploymentStep {
  // setPolicySource(address) selector: 0x6c6f26fa
  const selector = "0x6c6f26fa";
  const encodedReceiver = params.receiverAddress.slice(2).padStart(64, '0');
  const data = (selector + encodedReceiver) as Hex;
  
  return {
    step: 6,
    totalSteps: 8,
    contract: "ListingHook",
    description: "Connect policy receiver to hook (setPolicySource)",
    to: params.hookAddress,
    data,
    value: "0x0" as Hex,
  };
}
