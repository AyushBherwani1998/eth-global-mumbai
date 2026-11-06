import { parseAbi, type Abi } from "viem";

import {
  allowAllModuleAbi,
  ccaAbi,
  eligibilityModuleAbi,
  erc20Abi,
  lbpStrategyAbi,
  listingHookAbi,
  mockSmeAbi,
  permit2Abi,
  poolManagerAbi,
  quoterAbi,
  receiverAbi,
  stateViewAbi,
  validationHookAbi,
} from "./abis.generated.ts";

export {
  allowAllModuleAbi,
  ccaAbi,
  erc20Abi,
  listingHookAbi,
  mockSmeAbi,
  permit2Abi,
  poolManagerAbi,
  quoterAbi,
  receiverAbi,
  stateViewAbi,
  validationHookAbi,
};

/** Universal Router 2.0 entry point and errors (not in contracts/abis). */
export const universalRouterAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
  "error ExecutionFailed(uint256 commandIndex, bytes message)",
  "error TransactionDeadlinePassed()",
  "error LengthMismatch()",
  "error V4TooLittleReceived(uint256 minAmountOutReceived, uint256 amountReceived)",
  "error V4TooMuchRequested(uint256 maxAmountInRequested, uint256 amountRequested)",
  "error DeltaNotNegative(address currency)",
  "error DeltaNotPositive(address currency)",
  "error InsufficientBalance()",
]);

/**
 * Errors thrown from libraries, so they are in no contract ABI: the wrappers the decoder peels off
 * (CCA `ValidationHookCallFailed`, v4 `WrappedError`, V4Quoter `UnexpectedRevertBytes`) and the transfer failures.
 */
export const libraryErrorsAbi = parseAbi([
  "error ValidationHookCallFailed(bytes reason)",
  "error WrappedError(address target, bytes4 selector, bytes reason, bytes details)",
  "error HookCallFailed()",
  "error UnexpectedRevertBytes(bytes revertData)",
  "error QuoteSwap(uint256 amount)",
  "error NotEnoughLiquidity(bytes32 poolId)",
  "error TransferFromFailed()",
  "error TransferFailed()",
  "error Permit2AmountOverflow()",
  "error PriceLimitAlreadyExceeded(uint160 sqrtPriceCurrentX96, uint160 sqrtPriceLimitX96)",
  "error PriceLimitOutOfBounds(uint160 sqrtPriceLimitX96)",
  "error InvalidInitializer(address caller, address expected)",
]);

/** Every error the Listing Day flows can hit, for revert decoding (duplicates by selector are harmless). */
export const allErrorsAbi: Abi = dedupeErrors([
  ...libraryErrorsAbi,
  ...universalRouterAbi,
  ...listingHookAbi,
  ...validationHookAbi,
  ...allowAllModuleAbi,
  ...eligibilityModuleAbi,
  ...ccaAbi,
  ...receiverAbi,
  ...permit2Abi,
  ...poolManagerAbi,
  ...lbpStrategyAbi,
  ...mockSmeAbi,
] as Abi);

function dedupeErrors(abi: Abi): Abi {
  const seen = new Set<string>();
  return abi.filter((item) => {
    if (item.type !== "error") return false;
    const sig = `${item.name}(${item.inputs.map((i) => i.type).join(",")})`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}
