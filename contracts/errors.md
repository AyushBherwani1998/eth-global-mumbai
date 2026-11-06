# Listing Day contract errors (for the frontend)

Selectors come from `forge inspect <Contract> errors` on this commit. The ABIs live in `out/` after `forge build`, or
import the interfaces `src/interfaces/IAuctionValidationHook.sol` and `src/interfaces/IEligibilityModule.sol`.

## How a rejected bid looks

`CCA.submitBid` calls `AuctionValidationHook.validate`, which calls the eligibility module. The CCA catches **every**
hook revert and re-throws it wrapped:

```
ValidationHookCallFailed(bytes reason)   selector 0x5d73cdc5
```

`reason` is the hook's (or module's) own ABI-encoded error. To decode with viem, decode the outer error with the CCA
ABI, then decode `reason` with an ABI that contains the hook and module errors:

```ts
import { decodeErrorResult } from "viem";

const outer = decodeErrorResult({ abi: ccaAbi, data: revertData });
if (outer.errorName === "ValidationHookCallFailed") {
  const inner = decodeErrorResult({
    abi: [...auctionValidationHookAbi, ...eligibilityModuleAbi],
    data: outer.args[0],
  });
  // inner.errorName: "BidAboveCap" | "CapExceeded" | "SenderMustBeOwner" | ...
}
```

The same wrapping applies to `eth_estimateGas` / `eth_call` simulations, so the bid sheet can pre-check a bid.

## Bid-time errors from our contracts (arrive inside `ValidationHookCallFailed`)

| Error | Selector | Source | When | Suggested UI copy |
|---|---|---|---|---|
| `BidAboveCap(uint256 maxPrice, uint256 capQ96)` | `0xc9cb70dc` | `AuctionValidationHook` | `maxPrice` is above 190 points (`capQ96` = 150,533,508,776,980) | "Max price is above the 1.90 USDC / lot cap" |
| `SenderMustBeOwner()` | `0x35a4298c` | `AuctionValidationHook` | The wallet sending the bid is not the bid `owner` | "Bids must be placed from the owning wallet" |
| `OnlyAuction()` | `0xd75a4849` | `AuctionValidationHook` | `validate` called by anything but the bound auction, or before `setAuction` | Misconfiguration: auction not bound yet |
| `CapExceeded(uint256 newTotal, uint256 cap)` | `0xf480e285` | `AllowAllModule` (via `IEligibilityModule`) | Cumulative budget for this wallet would exceed 20 USDC (`cap` = 20,000,000). `newTotal` includes the rejected bid | "Over the 20 USDC per-applicant limit; you can still commit `cap - committed`" |
| `OnlyHook()` | `0x5a91834f` | `AllowAllModule` (via `IEligibilityModule`) | Module called by anything but its hook. Never seen through the CCA | Misconfiguration |

All amounts are raw USDC units (6 decimals). Prices are CCA Q96; points = `priceQ96 / 792281625142`.
Remaining budget for a wallet: `AllowAllModule.remaining(wallet)`; committed so far: `AllowAllModule.committed(wallet)`.

## Admin / deploy errors from our contracts (direct calls, not wrapped)

| Error | Selector | Source | When |
|---|---|---|---|
| `OnlyDeployer()` | `0x618bbdd5` | `AuctionValidationHook.setAuction` | Caller is not the hook deployer |
| `AuctionAlreadySet()` | `0x51a05b4d` | `AuctionValidationHook.setAuction` | Called a second time |
| `ValidationHookMismatch(address auctionValidationHook)` | `0x1940a519` | `AuctionValidationHook.setAuction` | The auction's `validationHook()` is not this hook |
| `TokenMismatch(address expected, address actual)` | `0xf902523f` | `AuctionValidationHook.setAuction` | The auction sells a different token |
| `CurrencyMismatch(address expected, address actual)` | `0x5d06997e` | `AuctionValidationHook.setAuction` | The auction raises a different currency (not Sepolia USDC) |
| `AuctionAlreadyStarted(uint64 startBlock)` | `0x7eaa8843` | `AuctionValidationHook.setAuction` | Called at or after the auction's `startBlock` |
| `ZeroAddress()` | `0xd92e233d` | hook constructor / `setAuction`, `AllowAllModule` constructor | A required address is zero |
| `InvalidCap()` | `0xcadd5a68` | hook / `AllowAllModule` constructors | Cap is zero |
| `ModuleHookMismatch(address moduleHook)` | `0xe9734c49` | hook constructor | The module was deployed for a different hook address |
| `ZeroRecipient()` | `0xd27b4443` | `MockSME` constructor | Supply recipient is zero |
| `TickSpacingTooSmall(uint256)` | `0xb72f4bb9` | `ListingPrice.tickSpacingQ96` (library, internal) | Tick spacing below the CCA minimum of 2 |

## CCA and Permit2 errors the bid sheet will also see (not wrapped)

These come from the CCA itself (v2.1.0) or from the Permit2 pull that happens **before** the hook runs.

| Error | Selector | When |
|---|---|---|
| `TransferFromFailed()` | `0x7939f424` | Permit2 pull failed: missing `USDC.approve(Permit2)` / `Permit2.approve(USDC, auction, …)`, expired Permit2 allowance, or insufficient USDC. Permit2's own reason (`InsufficientAllowance`, `AllowanceExpired`) is not bubbled, so check balance and `Permit2.allowance(owner, USDC, auction)` to tell them apart |
| `Permit2AmountOverflow()` | `0x8757f0fd` | Amount does not fit in uint160 |
| `AuctionNotStarted()` | `0xeffaea80` | Before `startBlock` |
| `AuctionIsOver()` | `0x5f0ae8b5` | At or after `endBlock` |
| `TokensNotReceived()` | `0x8d6b8a82` | Issuer has not deposited the auction supply yet |
| `BidAmountTooSmall()` | `0xc8731608` | `amount == 0` |
| `BidOwnerCannotBeZeroAddress()` | `0x4076a98c` | `owner == address(0)` |
| `CurrencyIsNotNative()` | `0xe3e0a9bd` | ETH sent with a USDC bid |
| `BidMustBeAboveClearingPrice()` | `0x5f259e52` | `maxPrice` at or below the current clearing price (checked after the hook) |
| `TickPriceNotAtBoundary()` | `0xd76fb50f` | `maxPrice` not a multiple of `tickSpacing` (1 point). Use `points * 792281625142` |
| `TickPreviousPriceInvalid()` | `0xa16c4535` | Bad `prevTickPriceQ96` hint (pass the floor, or the 4-arg `submitBid`) |
| `InvalidBidPriceTooHigh(uint256,uint256)` | `0xae9d6dc2` | `maxPrice` above the CCA's supply-derived max (far above our cap) |
| `AuctionSoldOut()` | `0x5cd54361` | No supply left |
| `ValidationHookCallFailed(bytes)` | `0x5d73cdc5` | Wrapper for all hook errors above |

The full CCA error list is in `lib/continuous-clearing-auction/src/interfaces/`.

## Events

| Event | Topic 0 | Source |
|---|---|---|
| `AuctionSet(address indexed auction)` | `0x4da9b3b7ca08b559bc11eb42bb6961e0813372ed0b55f0e9b68b76cf0207fce8` | `AuctionValidationHook` |
| `BudgetCommitted(address indexed owner, uint128 amount, uint256 total)` | `0xdcf8d4699e0d58f02a056a45185d9fcb9b0146943452ac620b0cd3281acb56aa` | `AllowAllModule` |
| `BidSubmitted(uint256 indexed id, address indexed owner, uint256 priceQ96, uint128 amount)` | `0x650baad5cd8ca09b8f580be220fa04ce2ba905a041f764b6a3fe2c848eb70540` | CCA |
