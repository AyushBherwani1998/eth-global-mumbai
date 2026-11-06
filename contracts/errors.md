# Listing Day contract errors (for the frontend)

Selectors come from `forge inspect <Contract> errors` on this commit. The ABIs live in `out/` after `forge build`, or
import the interfaces `src/interfaces/IAuctionValidationHook.sol`, `src/interfaces/IEligibilityModule.sol`,
`src/interfaces/IListingHook.sol`, `src/interfaces/IListingPolicy.sol` and `src/interfaces/IListingPolicyReceiver.sol`.

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

## Exits, claims and sweeps after the auction (CCA v2.1.0, direct calls)

| Error | Selector | When |
|---|---|---|
| `AuctionIsNotOver()` | `0x00175ba8` | `exitBid` / sweeps before `endBlock` |
| `NotClaimable()` | `0x6247a84e` | `claimTokens` before `claimBlock` (= `endBlock` in the demo) |
| `BidNotExited()` | `0x7e138882` | `claimTokens` before `exitBid` for that bid. Order: `exitBid(id)` then `claimTokens(id)` |
| `NotGraduated()` | `0xd66173a5` | `claimTokens` when raised < 45 USDC. Bidders only `exitBid` (full refund) |
| `CannotExitBid()` | `0x0ba98457` | `exitBid` on a bid at or below the final clearing price; use `exitPartiallyFilledBid` |
| `NotAuthorized(address authorized, address caller)` | `0xc55ddc97` | `sweepUnsoldTokens` from anyone but `tokensRecipient` (issuer treasury) |
| `CannotSweepTokens()` | `0x8fd6c3f9` | `sweepUnsoldTokens` a second time |

## Pool trading errors (ListingHook, arrive inside the v4 `WrappedError`)

The PoolManager wraps every hook revert (ERC-7751):

```
WrappedError(address target, bytes4 selector, bytes reason, bytes details)   selector 0x90bfb865
```

`target` is the ListingHook, `selector` is the hook callback that reverted (`beforeSwap` `0x575e24b4`, `afterSwap`
`0xb47b2fb1`, `beforeInitialize` `0xdc98354e`), `reason` is the error below and `details` is `HookCallFailed()`
(`0xa9e35b2f`). Decode `reason` with the `IListingHook` ABI. The v4 Quoter and Universal Router revert the same way,
so a failed quote is the trade sheet's "would revert" pre-check. Reverted swaps emit no logs.

| Error | Selector | Callback | When | Suggested UI copy |
|---|---|---|---|---|
| `OutOfBand(uint160 sqrtPriceX96, uint160 sqrtPriceMinX96, uint160 sqrtPriceMaxX96)` | `0xbfdfc64e` | `afterSwap` | The swap would end outside the active band (listing day ±5% of the clearing price; then the policy band). Values are pool sqrtPriceX96; read `currentBandPointsE2()` for display | "Outside today's price band (104.50 to 115.50 USDC / lot)" |
| `DirectionalWidening(uint160 preSqrtPriceX96, uint160 postSqrtPriceX96, uint160 refSqrtPriceX96)` | `0xe3e23539` | `afterSwap` | Directional mode (policy `mode = 2`, after listing day): the swap moves the price further from the reference and ends outside the surveillance band (±5%) around it | "Only trades toward the reference price are allowed right now" |
| `Halted()` | `0x1ee9080f` | `beforeSwap` | Policy `halted = true`. Liquidity add / remove still work | "Trading halted" |
| `CoolingOff(uint64 until)` | `0xfbf97c58` | `beforeSwap` | `block.timestamp < coolOffUntil` | "Cooling off until {until}" |
| `InvalidInitializer(address caller, address expected)` | `0x8cbcc025` | `beforeInitialize` | Anyone but LBPStrategy initializes the pool (from liquidity-launcher `InitializerHook`) | Never seen in the app |
| `PoolKeyMismatch()` | `0x6b8fd8f3` | `beforeInitialize` | A pool other than the hook's pinned key (USDC/MockSME, fee, tick spacing) | Never seen in the app |
| `AlreadyListed()` | `0xa3d582ec` | `afterInitialize` | Defensive; can't happen for a pinned key | — |

Direct calls (not wrapped):

| Error | Selector | Source | When |
|---|---|---|---|
| `OnlyOwner()` | `0x5fc483c5` | `ListingHook.setPolicySource`, `MockListingPolicy` setters | Caller is not the owner |
| `InvalidConfig()` | `0x35be3ac8` | `ListingHook` constructor | Zero or equal token addresses, or listing-day band >= 100% |
| `NotPoolManager()` | `0xae18210a` | `ListingHook` callbacks | A hook callback called by anything but the PoolManager |

## CRE policy reports (ListingPolicyReceiver)

Reports arrive as `forwarder.report(receiver, rawReport, context, sigs)`, sent by the CRE broadcaster, which calls
`receiver.onReport(metadata, payload)`. The forwarder **swallows** receiver reverts: the transaction succeeds and emits
`ReportProcessed(receiver, workflowExecutionId, reportId, result)`. A rejected report shows up as `result == false`,
not as a failed transaction. The workflow turns that into a failed run, through `writeReport`'s
`receiverContractExecutionStatus == REVERTED`. To see *why* a report was rejected, replay `onReport` with
`eth_call` from the forwarder, with the broadcaster as `from`, and decode the revert with the `IListingPolicyReceiver`
ABI. The console normally only needs `PolicyApplied` (success) and `ReportProcessed.result`.

| Error | Selector | When | Suggested UI copy |
|---|---|---|---|
| `InvalidSender(address sender, address expected)` | `0xe1130dba` | `onReport` not called by the configured forwarder | Misconfiguration (wrong forwarder) |
| `InvalidOrigin(address origin, address expected)` | `0x1cd1cae1` | The transaction wasn't sent by the configured CRE broadcaster, e.g. someone else pushed a report through the permissionless mock forwarder | "Report not from the exchange's CRE operator" |
| `WrongChainSelector(uint64 chainSelector, uint64 expected)` | `0xf7f6c724` | `policy.chainSelector` is not Sepolia `16015286601757825753` | Misconfiguration (workflow targets another chain) |
| `StaleReport(uint64 asOf, uint64 lastAsOf)` | `0x4287e77f` | `asOf` not strictly after the last accepted report (replay or out of order) | "Older than the policy already applied" |
| `ReportExpired(uint64 asOf, uint64 maxAge)` | `0x7d5e7d09` | Report older than `maxAge` when it lands | "Policy update arrived too late" |
| `ReportFromFuture(uint64 asOf, uint256 blockTimestamp)` | `0x29770bf8` | `asOf` more than 5 minutes ahead of the block time (clock skew) | "Policy timestamp is in the future" |
| `InvalidPolicy()` | `0xd06b96b1` | A band ≥ 10000 bps, or `mode > 2` | "Invalid policy values" |
| `InvalidStatus()` | `0xf525e320` | `status` longer than 32 bytes | "Invalid status" |
| `Reentrancy()` | `0xab143c06` | A second report injected while one is being applied (e.g. from the ENS call) | Never seen in the app |

Admin calls (direct, not wrapped):

| Error | Selector | Source | When |
|---|---|---|---|
| `OnlyOwner()` | `0x5fc483c5` | `setForwarder`, `setBroadcaster`, `setMaxAge`, `setStatusMirror` | Caller is not the receiver owner |
| `ZeroAddress()` | `0xd92e233d` | constructor, `setForwarder` | Zero owner or forwarder |
| `InvalidMaxAge()` | `0x8974d2a4` | constructor, `setMaxAge` | `maxAge == 0` |

ENS mirror failures never revert: they emit `StatusMirrorFailed(resolver, status, reason)`, where `reason` is the
resolver's revert data. With `MockStatusResolver` it is `Unauthorized(address writer)` (`0x8e4a23d6`) or
`ForcedFailure()` (`0xcf70b534`); it is empty for out-of-gas or a resolver without code. `syncStatus()` retries.

A **stale** policy (older than `maxAge`) is not an error at the receiver. `policy()` reports it as `halted`, so swaps
revert with the hook's `Halted()` until a fresh report lands. Show "Trading halted: policy feed stale" when
`receiver.isStale()` is true.

## Migration (LBPStrategy v3.3.0)

`migrate(auction)` is permissionless after `migrationBlock` (= `endBlock + 1`). It never reverts once allowed: if the
pool can't be created (e.g. the auction didn't graduate) it emits `MigrationFailed` + `FundsRecovered` and sends the LP
reserve to the treasury. Check for `Migrated`, or `ListingHook.listed()`, rather than tx status.

| Error | Selector | When |
|---|---|---|
| `MigrationNotYetAllowed(uint256 migrationBlock, uint256 currentBlock)` | `0x2aa91e59` | Before `migrationBlock`, i.e. at or before the auction's `endBlock` |
| `InvalidHook(address hook)` | `0xd60f2161` | Launch time: the hook isn't an `InitializerHook` for this strategy, has bad flags, or the pool already exists |
| `PoolIdOccupied(bytes32 poolId, address initializer)` | `0x5866e5d6` | Launch time: another distribution already reserved this pool key (reused token + hook) |
| `InvalidFundsRecipient(address actual, address expected)` | `0xa629a931` | Launch time: auction `fundsRecipient` is not the strategy |
| `InvalidTokensRecipient(address actual)` | `0x8230db09` | Launch time: auction `tokensRecipient` is the strategy |
| `InvalidEndBlock(uint256 endBlock, uint256 migrationBlock)` | `0x241ff33e` | Launch time: `migrationBlock <= endBlock` |

## Events

| Event | Topic 0 | Source |
|---|---|---|
| `AuctionSet(address indexed auction)` | `0x4da9b3b7ca08b559bc11eb42bb6961e0813372ed0b55f0e9b68b76cf0207fce8` | `AuctionValidationHook` |
| `BudgetCommitted(address indexed owner, uint128 amount, uint256 total)` | `0xdcf8d4699e0d58f02a056a45185d9fcb9b0146943452ac620b0cd3281acb56aa` | `AllowAllModule` |
| `BidSubmitted(uint256 indexed id, address indexed owner, uint256 priceQ96, uint128 amount)` | `0x650baad5cd8ca09b8f580be220fa04ce2ba905a041f764b6a3fe2c848eb70540` | CCA |
| `BidExited(uint256 indexed bidId, address indexed owner, uint256 tokensFilled, uint256 currencyRefunded)` | `0x054fe6469466a0b4d2a6ae4b100e5f9c494c958f04b4000f44d470088dd97930` | CCA |
| `TokensClaimed(uint256 indexed bidId, address indexed owner, uint256 tokensFilled)` | `0x880f2ef2613b092f1a0a819f294155c98667eb294b7e6bf7a3810278142c1a1c` | CCA |
| `InitializerCreated(address indexed initializer, MigratorParameters migrationParams)` | `0x6d759545eb439f07e70f45431d6339af7a4f1ffef06d43e8ddf47fdb0799708c` | LBPStrategy (launch: `initializer` is the auction) |
| `Migrated(address indexed initializer, PoolKey indexed key, uint160 initialSqrtPriceX96, bytes plan)` | `0xbcc36534419debbbf0f25857d1fef3e4bbce9527091c805e9a7da93dbfd828f4` | LBPStrategy |
| `MigrationFailed(address indexed initializer, bytes reason)` | `0x68b0b16b3bdd5fa8045913c6519a56054f9ffabcc9d3ef1d71520fc0b61f1e15` | LBPStrategy |
| `FundsRecovered(address indexed initializer, address indexed recipient, uint256 amount)` | `0x13e06184555481b6d2cb327155e8d2e1d0b1f0252a7fe6621e32cf9988148835` | LBPStrategy |
| `Listed(bytes32 indexed poolId, uint160 listingSqrtPriceX96, int24 tick, bool usdcIsCurrency0, uint64 listingDayEndsAt, uint160 listingDaySqrtPriceMinX96, uint160 listingDaySqrtPriceMaxX96)` | `0x14d01e6e691277ec49cb4d9bb1620408b7cc4eed60fec2105b2e0afeda251777` | `ListingHook` (pool opened) |
| `PolicySourceSet(address indexed policySource)` | `0x647b3a889d97f882f9ac03223a58f73a082acf2fb00c2374292e4a65f2c59e40` | `ListingHook` |
| `PolicyUpdated(ListingPolicy policy)` | `0x8c21d95658b15b96d9a5d3cf5343785fc9503c41a3d1cbff404469c085db138c` | `MockListingPolicy` (tests / manual demos) |
| `PolicyApplied(uint32 indexed version, ListingPolicy policy, string status)` | `0x4a619e4f7dcb3d9c6f7a74ff80a459db28f4ba354851ff0e43c3db31ecb95e71` | `ListingPolicyReceiver`: a CRE report was accepted. `policy.version` = `version`; `status` is what gets mirrored to ENS |
| `StatusMirrored(address indexed resolver, string status)` | `0x8e751cbe18334007be0c5d8a1866abccf020cbb4248c43d2ae9061d94119771e` | `ListingPolicyReceiver`: ENS `listingday.status` written |
| `StatusMirrorFailed(address indexed resolver, string status, bytes reason)` | `0x3bb3b9d7cf78eb63986f81038ece4ec545ff6c4c370c05a2041a26522dead4f5` | `ListingPolicyReceiver`: ENS write failed, policy still applied |
| `ForwarderSet(address indexed forwarder)` | `0x01e06e871b32b0b127105fbd5dbecd24273b7e1191a8940de24f4ea249e355d6` | `ListingPolicyReceiver` admin |
| `BroadcasterSet(address indexed broadcaster)` | `0x3e0c6ca707153133edea0fdf23df07ed2417fba48db884fc6742177c3db1523f` | `ListingPolicyReceiver` admin |
| `MaxAgeSet(uint64 maxAge)` | `0x0db3374bef1892bbc82505369a338834407fa3a76893e09b92454fce7afb2f23` | `ListingPolicyReceiver` admin |
| `StatusMirrorSet(address indexed resolver, bytes name)` | `0x7d609c1ce694be6f7c92a6f42eed0dfcbb2fb264662a4b5dcc3fcf42c37667c0` | `ListingPolicyReceiver` admin |
| `ReportProcessed(address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result)` | `0x3617b009e9785c42daebadb6d3fb553243a4bf586d07ea72d65d80013ce116b5` | CRE forwarder (`MockKeystoneForwarder` / `KeystoneForwarder`): `result` is whether `onReport` succeeded |
| `TextChanged(bytes name, string key, string value)` | `0x88ba19293265ea5dd5bc0a3ea6a066f9f5ee7bac1b949ba6c513ae90abffa0c4` | `MockStatusResolver` (stand-in for the ENS resolver) |
