# Listing Day contract errors (for the frontend)

Selectors come from `forge inspect <Contract> errors` on this commit. The ABIs live in `out/` after `forge build`, or
import the interfaces `src/interfaces/IAuctionValidationHook.sol`, `src/interfaces/IEligibilityModule.sol`,
`src/interfaces/IWorldPassModule.sol`, `src/interfaces/IListingHook.sol`, `src/interfaces/IListingPolicy.sol` and `src/interfaces/IListingPolicyReceiver.sol`.

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
  // inner.errorName: "BidAboveCap" | "CapExceeded" | "SenderMustBeOwner" | "NotEligible" | ...
}
```

On a human listing add `worldPassModuleAbi` (`abis/IWorldPassModule.json`); `NotEligible`'s argument is the reason
number in the table under [World ID passes](#world-id-passes-worldpassmodule-human-listings).

The same wrapping applies to `eth_estimateGas` / `eth_call` simulations, so the bid sheet can pre-check a bid.

## Bid-time errors from our contracts (arrive inside `ValidationHookCallFailed`)

| Error | Selector | Source | When | Suggested UI copy |
|---|---|---|---|---|
| `BidAboveCap(uint256 maxPrice, uint256 capQ96)` | `0xc9cb70dc` | `AuctionValidationHook` | `maxPrice` is above 190 points (`capQ96` = 150,533,508,776,980) | "Max price is above the 1.90 USDC / lot cap" |
| `SenderMustBeOwner()` | `0x35a4298c` | `AuctionValidationHook` | The wallet sending the bid is not the bid `owner` | "Bids must be placed from the owning wallet" |
| `OnlyAuction()` | `0xd75a4849` | `AuctionValidationHook` | `validate` called by anything but the bound auction, or before `setAuction` | Misconfiguration: auction not bound yet |
| `CapExceeded(uint256 newTotal, uint256 cap)` | `0xf480e285` | `AllowAllModule` / `WorldPassModule` (via `IEligibilityModule`) | Cumulative budget would exceed 20 USDC (`cap` = 20,000,000): per wallet on an open listing, **per person** (nullifier) on a human one. `newTotal` includes the rejected bid | "Over the 20 USDC per-applicant limit; you can still commit `cap - committed`" |
| `NotEligible(uint8 reason)` | `0x1737ee52` | `WorldPassModule` | Human listing: the World ID pass in `hookData` was refused; `reason` below | See [World ID passes](#world-id-passes-worldpassmodule-human-listings) |
| `OnlyHook()` | `0x5a91834f` | `AllowAllModule` / `WorldPassModule` (via `IEligibilityModule`) | Module called by anything but its hook. Never seen through the CCA | Misconfiguration |

All amounts are raw USDC units (6 decimals). Prices are CCA Q96; points = `priceQ96 / 792281625142`.
Remaining budget for a wallet: `AllowAllModule.remaining(wallet)`; committed so far: `AllowAllModule.committed(wallet)`.
On a human listing: `WorldPassModule.committed(WorldPassModule.nullifierOf(wallet))` (cap from the pass, 20 USDC).

### World ID passes (WorldPassModule, human listings)

On a listing with ENS `listingday.eligibility = human`, `hookData` must be the `EligibilityPass` + signature from
`services/verify` ([API](../services/verify/API.md)). The module checks, in this order, and reverts
`NotEligible(reason)` (ABI: `NotEligible(uint8)`, the enum `IWorldPassModule.Reason`):

| `reason` | Name | When | Suggested UI copy |
|---|---|---|---|
| 0 | `MissingPass` | `hookData` is empty (e.g. an open-listing bid sheet on a human listing) | "Verify with World ID to bid" |
| 1 | `InvalidPass` | `hookData` shorter than a pass + signature, or a zero nullifier | Bug |
| 2 | `WrongSigner` | Signature isn't from `signer()` (tampered pass, another backend, malformed / high-s signature) | Bug / misconfiguration |
| 3 | `Expired` | `block.timestamp > pass.expiry` (passes live 10 minutes) | "Your verification expired, verify again" |
| 4 | `WrongWallet` | `pass.wallet` is not both the bid `owner` and the sender | "Bid from the wallet you verified" |
| 5 | `WrongAuction` | `pass.auction` is not this hook's auction | "Verify again for this listing" |
| 6 | `NullifierBoundToOtherWallet` | This person already bid from another wallet (the first accepted bid binds nullifier and wallet) | "You already bid from another wallet" |
| 7 | `WalletBoundToOtherNullifier` | This wallet already bid as another person | "This wallet is linked to someone else" |

Then `CapExceeded(newTotal, cap)` if the person's cumulative budget would exceed `pass.cap`. The `AuctionValidationHook`
checks (`SenderMustBeOwner`, `BidAboveCap`) run before the module. Revert data recorded by the scripted demo:
`.rejectedBids.{secondWallet,expiredPass,overCap}.revertData` in the human deployments file.

Reads: `signer()`, `hook()`, `walletOf(nullifier)`, `nullifierOf(wallet)`, `committed(nullifier)`, `PASS_TYPEHASH()`
(`0x3c53d17404e8fe8e64dcc5d8bd70c23fe30eccce9116a1f83bd790bca88dda54` =
`keccak256("EligibilityPass(bytes32 nullifier,address wallet,address auction,uint128 cap,uint64 expiry)")`),
`DOMAIN_SEPARATOR()`, `hashPass(pass)`, `eip712Domain()` (name `ListingDay WorldPass`, version `1`).

## Admin / deploy errors from our contracts (direct calls, not wrapped)

| Error | Selector | Source | When |
|---|---|---|---|
| `OnlyDeployer()` | `0x618bbdd5` | `AuctionValidationHook.setAuction` | Caller is not the hook deployer |
| `AuctionAlreadySet()` | `0x51a05b4d` | `AuctionValidationHook.setAuction` | Called a second time |
| `ValidationHookMismatch(address auctionValidationHook)` | `0x1940a519` | `AuctionValidationHook.setAuction` | The auction's `validationHook()` is not this hook |
| `TokenMismatch(address expected, address actual)` | `0xf902523f` | `AuctionValidationHook.setAuction` | The auction sells a different token |
| `CurrencyMismatch(address expected, address actual)` | `0x5d06997e` | `AuctionValidationHook.setAuction` | The auction raises a different currency (not Sepolia USDC) |
| `AuctionAlreadyStarted(uint64 startBlock)` | `0x7eaa8843` | `AuctionValidationHook.setAuction` | Called at or after the auction's `startBlock` |
| `ZeroAddress()` | `0xd92e233d` | hook constructor / `setAuction`, `AllowAllModule` / `WorldPassModule` constructors | A required address is zero (incl. the pass signer) |
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
resolver's revert data. With the issuer's ENSv2 `PermissionedResolver` it is `EACUnauthorizedAccountRoles`
(`0x4b27a133`) if the receiver's scoped `listingday.status` role is missing (run `make ens-status-role`); with
`MockStatusResolver` it is `Unauthorized(address writer)` (`0x8e4a23d6`) or `ForcedFailure()` (`0xcf70b534`); it is
empty for out-of-gas or a resolver without code. `syncStatus()` retries.

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

## ENSv2 ticker namespace (`acme.listingday.eth`)

The app only **reads** ENS (through the Universal Resolver), so most of these appear in the ENS scripts, not the UI.
They are ENSv2 errors (contracts-v2 tag `v2-mainnet-deployment-1`), decodable with the ABIs in `abis/ensv2/`.

Reads (viem `getEnsText` / `getEnsAddress` → `UniversalResolver.resolveWithGateways`):

| Error | Selector | When | Suggested UI copy |
|---|---|---|---|
| `ResolverNotFound(bytes name)` | `0x77209fe8` | No resolver for the name: the ticker isn't registered, was delisted (`unregister`), or expired. viem returns `null` | "Not listed" |
| `ResolverError(bytes errorData)` | `0x95c0c752` | The issuer's resolver reverted (e.g. a profile it doesn't support) | Treat as missing record |

A record that was never set resolves to `""` (text) / the zero address (`addr`), not to an error. An empty
`listingday.status` means no CRE report has landed yet: show "draft".

Registration (`ETHRegistrar`, `EnsName.s.sol`):

| Error | Selector | When |
|---|---|---|
| `CommitmentTooNew(bytes32 commitment, uint64 validFrom, uint64 blockTimestamp)` | `0x6be614e3` | `register` less than 60 s (`MIN_COMMITMENT_AGE`) after `commit`. `make ens-name` waits for it |
| `CommitmentTooOld(bytes32 commitment, uint64 validTo, uint64 blockTimestamp)` | `0x0cb9df3f` | More than 24 h after `commit`; `EnsName` commits again |
| `UnexpiredCommitmentExists(bytes32 commitment)` | `0x0a059d71` | `commit` of a commitment that is still pending |
| `NameNotAvailable(string label)` | `0x477707e8` | The `.eth` name is taken (also from `getRegisterPrice`) |
| `DurationTooShort(uint64 duration, uint64 minDuration)` | `0xa096b844` | `ENS_DURATION` < 28 days |
| `PaymentTokenNotSupported(address paymentToken)` | `0x02e2ae9e` | Payment token not accepted by the rent oracle (ENS MockUSDC / MockDAI and Circle USDC are) |
| `ERC20InsufficientAllowance` / `ERC20InsufficientBalance` | `0xfb8f41b2` / `0xe450d38c` | MockUSDC not approved / minted for the price (`EnsName` mints and approves it) |

Registry and resolver (`UserRegistry` for `listingday.eth`, the issuer's `PermissionedResolver`):

| Error | Selector | When |
|---|---|---|
| `TransferDisallowed(uint256 tokenId, address from)` | `0xe58f6d5a` | `unsafeTransfer` of a ticker: the issuer has no `ROLE_CAN_TRANSFER_ADMIN`, so tickers can't move mid-IPO |
| `TransferUnsafeUntilRegistryIsEmancipated()` | `0x54838f98` | `safeTransferFrom` of a ticker: checked first, because the exchange keeps `ROLE_UNREGISTER` at the registry root |
| `EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account)` | `0x4b27a133` | Missing role. E.g. the receiver writing any text key but `listingday.status` (`resource` = `uint256(keccak256(key))`, `roleBitmap` = `ROLE_SET_TEXT` = `0x10`), the exchange calling `setResolver` on a ticker, the issuer calling `register` |
| `EACCannotGrantRoles(uint256 resource, uint256 roleBitmap, address account)` | `0xd1a3b355` | Granting without the admin role: the exchange or the issuer granting roles on a ticker (token admin roles exist only at registration), anyone calling `PermissionedResolver.grantRoles` (disabled: use `grantSetterRoles`) |
| `LabelAlreadyRegistered(string label)` | `0xdef545a4` | Registering a ticker that is already registered |
| `LabelExpired(uint256 tokenId)` | `0xc44e2374` | Using an expired name (the ticker expires with `listingday.eth`) |
| `InvalidName(string name)` | `0x7f19f48d` | Our `EnsNames.dnsEncode` on an empty label (`"acme..eth"`) |

**Token ids change.** A role grant or revoke on a name burns its ERC-1155 token and re-mints it under a new id
(`TokenRegenerated(oldTokenId, newTokenId)`); unregister + register does too. A stale id returns `ownerOf = 0x0`.
Always look ids up by label with `findTokenId(label)`, and key app state on the label or namehash, never the id.

## Events

| Event | Topic 0 | Source |
|---|---|---|
| `CommitmentMade(bytes32 commitment)` | `0x561eb038a114723afa3c72b445add7b8602de546264da1e7e826af628316dbcb` | ENS `ETHRegistrar` |
| `NameRegistered(uint256 indexed tokenId, string label, address owner, IRegistry subregistry, address resolver, uint64 duration, address paymentToken, bytes32 indexed referrer, uint256 base, uint256 premium)` | `0xebd3982eafd13b820e3edb2a4abd57a82ce3b8802e0cd45637a5de51383f9fac` | ENS `ETHRegistrar` (`listingday.eth`) |
| `LabelRegistered(uint256 indexed tokenId, bytes32 indexed labelHash, string label, address owner, uint64 expiry, address indexed sender)` | `0x2fe093918572373e9f1f0368f414dffd0043a74ae8c9fd7b0e390b26a0d20b6e` | ENS registries. On the `listingday.eth` UserRegistry: a ticker was listed (the IPO list) |
| `LabelUnregistered(uint256 indexed tokenId, address indexed sender)` | `0x5293e83951c7b759c1ef192ceed240dc2caa652e29ddbd95cafe1d88e5a9cea8` | UserRegistry: a ticker was delisted |
| `TokenRegenerated(uint256 indexed oldTokenId, uint256 indexed newTokenId)` | `0x4adeae13ec8831392865da923fda1c23d6894f7acb41defa2472480cd4b47d58` | ENS registries: roles changed, the token id moved |
| `SubregistryUpdated(uint256 indexed tokenId, IRegistry indexed subregistry, address indexed sender)` | `0xca9c8d517128edd416adf5719242ca6ff93ce234442d95234da53c0ae8a10540` | ENS registries |
| `ResolverUpdated(uint256 indexed tokenId, address indexed resolver, address indexed sender)` | `0x9b6b420ff87c91604d447e507cbeedda5df2fa669a6b6534375e41fd3905a8d5` | ENS registries |
| `ParentUpdated(IRegistry indexed parent, string label, address indexed sender)` | `0xe49f02c945e0ee4a8d961a371289bd054aa21d9ca1b73250ffd4880eb708cff4` | UserRegistry (canonical parent set) |
| `TextUpdated(uint256 indexed recordId, string indexed keyHash, string key, string value)` | `0x14cf4389d9a790cb32a054e033d7e3d3b78119dee4fea3c0983aac1db3f54015` | Issuer's `PermissionedResolver`: a text record changed (e.g. `listingday.status` from the receiver) |
| `AddressUpdated(uint256 indexed recordId, uint256 coinType, bytes addressBytes)` | `0x5856fffa4d8f7605f45813e1cc223ac63a6fa1f09ca60f0e6a6525317bc7fa41` | Issuer's `PermissionedResolver` |
| `ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)` | `0x0a2c575ff341b41da136c9ccae74ec230a927a024d18f0dccf46d123f28f5f54` | ENS `VerifiableFactory` (UserRegistry and resolver proxies) |
| `AuctionSet(address indexed auction)` | `0x4da9b3b7ca08b559bc11eb42bb6961e0813372ed0b55f0e9b68b76cf0207fce8` | `AuctionValidationHook` |
| `BudgetCommitted(address indexed owner, uint128 amount, uint256 total)` | `0xdcf8d4699e0d58f02a056a45185d9fcb9b0146943452ac620b0cd3281acb56aa` | `AllowAllModule` |
| `BudgetCommitted(bytes32 indexed nullifier, address indexed wallet, uint128 amount, uint256 total)` | `0xb098e0bc2b25b36615b0050023f0b05503473ec35ed186df7282c9de6a9baef9` | `WorldPassModule` (per person) |
| `NullifierBound(bytes32 indexed nullifier, address indexed wallet)` | `0x4dc8b8de296376797676ed0fba6c1df2b7ced8ba63666494c78596c34b56e027` | `WorldPassModule`: a person's first accepted bid |
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
