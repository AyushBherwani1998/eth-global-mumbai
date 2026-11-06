# Listing Day contracts

Foundry project for the Listing Day CCA + v4 IPO (design: [`../plan.md`](../plan.md)). This covers build chunks 0
to 7:

- Chunks 0 and 1: the scaffold, the price math, `MockSME`, `AuctionValidationHook` and `AllowAllModule`.
- Chunk 2: the full launch-to-trading lifecycle on a Sepolia fork, through the deployed Uniswap contracts.
- Chunk 3: `ListingHook`.
- Chunk 4: the Chainlink CRE consumer `ListingPolicyReceiver`, which feeds the hook its policy. The workflow that writes to it lives in [`../cre`](../cre), and the exchange API it reads from in [`../services/mock-exchange`](../services/mock-exchange).
- Chunk 5: the Sepolia demo scripts (`script/demo/`, `make demo-fork` / `make demo-sepolia`): fund the demo wallets, deploy, launch, bid, settle, trade, halt. They write `deployments/sepolia.json` and the frontend ABIs live in `abis/`. See [`DEPLOY.md`](DEPLOY.md).
- Chunk 6: the ENSv2 ticker namespace (`script/ens/`, `make ens-fork` / `make ens-sepolia`): `listingday.eth`, our UserRegistry, the issuer-owned `acme.listingday.eth` with the IPO records, and the receiver's scoped `listingday.status` role. See [ENSv2 ticker namespace](#ensv2-ticker-namespace-chunk-6), including the [frontend read guide](#frontend-read-guide).
- Chunk 7: World ID eligibility for **human** listings: `WorldPassModule` checks an EIP-712 `EligibilityPass` per bid, signed by the verify backend in [`../services/verify`](../services/verify/README.md) after a World ID Proof of Human (`ELIGIBILITY=human` in the scripts). See [World ID eligibility](#world-id-eligibility-chunk-7).

Nothing is deployed yet: the scripts run on a Sepolia fork in CI, and the real broadcast is a manual step
([`DEPLOY.md`](DEPLOY.md)).

Frontend error and selector reference: [`errors.md`](errors.md).

## Setup

```bash
# Foundry (forge 1.x)
curl -L https://foundry.paradigm.xyz | bash && foundryup

# From the repo root: fetch the pinned deps. Don't use --recursive; nested submodules aren't needed
# (liquidity-launcher's include the full optimism monorepo).
git submodule update --init

cd contracts
forge build
```

## Running tests

| What | Command |
|---|---|
| Unit tests only (no network) | `forge test --no-match-path 'test/fork/*'` |
| Everything; fork tests skip with a message if no RPC | `forge test` |
| Everything on a Sepolia fork | `forge test --fork-url $SEPOLIA_RPC_URL` |
| Fork tests only | `SEPOLIA_RPC_URL=<url> forge test --match-path 'test/fork/*'` |

Fork tests (`test/fork/*.fork.t.sol`) run when either `--fork-url` points at Sepolia, or `SEPOLIA_RPC_URL` is set
(they then create the fork themselves). Set `SEPOLIA_FORK_BLOCK` to pin a block. With neither, they are skipped:

```
[SKIP: skipped: SEPOLIA_RPC_URL not set: skipping Sepolia fork test (set it or run forge test --fork-url $SEPOLIA_RPC_URL)] setUp()
```

A public RPC works fine for these tests, e.g. `export SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com`.

## Layout

| Path | What |
|---|---|
| `src/libraries/Constants.sol` | `Sepolia` addresses (plan.md §17, each checked onchain), `SepoliaEns` (ENSv2 at contracts-v2 tag `v2-mainnet-deployment-1`, checked onchain) and `ListingDay` demo parameters |
| `src/libraries/EnsV2.sol` | `EnsRoles` (ENSv2 role bitmaps, Listing Day role sets) and `EnsNames` (DNS encoding, namehash) |
| `src/interfaces/IEnsV2.sol` | The ENSv2 calls we make: registrar, registries, PermissionedResolver, VerifiableFactory, Universal Resolver |
| `src/libraries/ListingPrice.sol` | Points ↔ CCA Q96 price math and tick-spacing helper. Use it everywhere (hook cap, launch script, UI) |
| `src/MockSME.sol` | Fixed-supply share token, 110,000e18 minted once in the constructor, no mint function |
| `src/AuctionValidationHook.sol` | CCA `IValidationHook`: only the bound auction, `sender == owner`, `maxPrice <= capQ96`, then the module |
| `src/modules/AllowAllModule.sol` | Phase 1 `IEligibilityModule`: per-wallet cumulative budget cap (20 USDC); only its hook may call it |
| `src/modules/WorldPassModule.sol` | Human-listing `IEligibilityModule`: verifies the backend-signed `EligibilityPass` in `hookData`, binds World ID nullifier and wallet one-to-one, per-person cumulative cap; only its hook may call it |
| `src/ListingHook.sol` | v4 hook (inherits liquidity-launcher `InitializerHook`): only LBPStrategy initializes; listing-day ±5% band, then policy bands, directional mode, halt, cool-off; no liquidity flags |
| `src/libraries/ListingBand.sol` | Share-price bands in sqrtPriceX96 space, orientation-aware |
| `src/ListingPolicyReceiver.sol` | Chainlink CRE consumer (`IReceiver.onReport`) that stores the `ListingPolicy` and serves it to the hook as its `IListingPolicy`; best-effort ENS status mirror |
| `src/mocks/MockListingPolicy.sol` | Owner-settable `IListingPolicy` for tests and manual demos without CRE |
| `src/mocks/MockStatusResolver.sol` | `IStatusResolver` stand-in for the ENS resolver in unit tests (can be told to revert or burn gas); the real one is the issuer's ENSv2 PermissionedResolver |
| `src/interfaces/` | `IAuctionValidationHook`, `IEligibilityModule`, `IWorldPassModule` (`EligibilityPass`, `NotEligible` reasons), `IListingHook`, `IListingPolicy`, `IListingPolicyReceiver`, `IReceiver` (Chainlink-compatible), `IStatusResolver` (errors, events and reads for the frontend ABI) |
| `script/DeployListingPolicyReceiver.s.sol` | Deploys the receiver; optionally points a hook at it and sets the ENS mirror |
| `script/demo/` | The demo steps (`FundDemoWallets`, `DemoDeploy`, `DemoLaunch`, `DemoBid`, `DemoSettle`, `DemoTrade`, `DemoHalt`, `ExportDeployments`), each idempotent against the deployments file; `DemoFork` runs them all on a fork with asserts; `anvil-rehearsal.sh` runs them (and the ENS steps) as broadcasts against anvil. Entry points in the `Makefile`, walkthrough in [`DEPLOY.md`](DEPLOY.md) |
| `script/ens/` | The ENSv2 steps (`EnsName`, `EnsRegistry`, `EnsTicker`, `EnsRecords`, `EnsStatusRole`, `EnsRead`), each idempotent; `EnsFork` runs them on a fork with asserts; `wait-for-commit.sh` waits out the 60 s commit age |
| `deployments/` | `sepolia.json` after the real run (committed); fork and anvil rehearsals write git-ignored files next to it |
| `abis/` | Frontend ABI arrays, regenerated with `make abis` (CI checks they're current); `abis/ensv2/` holds the official ENSv2 ABIs from the tag (`make abis-ensv2`) |
| `test/unit/` | Price math, hook + module, the real CCA v2.1.0 code wrapping hook reverts, `ListingHook` on a local PoolManager in both token orders, the receiver (directly and through a `MockKeystoneForwarder` port driving a hook), the CRE report vectors shared with the TypeScript workflow, the tx-hash export on a trimmed real broadcast log (`test/fixtures/broadcast/`), ENS name encoding (`EnsNames.t.sol`), `WorldPassModule` through a real local CCA (`WorldPassModule.t.sol`) and the EIP-712 parity vectors shared with the verify backend (`WorldPassFixture.t.sol`) |
| `test/fork/` | Sepolia USDC metadata, every constant + cross-links, a bid through the live CCA factory, the full lifecycle (`ListingLifecycle.fork.t.sol`, ending with CRE halting and reopening the migrated pool), reports through the live Sepolia `MockKeystoneForwarder` (`CreMockForwarder.fork.t.sol`), the ENSv2 namespace against the live ENS contracts (`EnsNamespace.fork.t.sol`), World ID passes through the live CCA factory with USDC + Permit2 (`WorldPass.fork.t.sol`), and the demo (open and human) + ENS scripts end to end (`DemoScripts.fork.t.sol`) |

## Price math

Prices are quoted in **points**: issue = 100 points = 1.00 USDC per 1,000-share lot = 0.001 USDC per share. The CCA
prices raw USDC (6 decimals) per raw MockSME (18 decimals) in Q96:

- `ONE_POINT_Q96 = floor(2^96 * 1e4 / 1e21) = 792,281,625,142`
- `priceQ96(points) = points * ONE_POINT_Q96`

| Points | USDC / lot | Q96 | Role |
|---|---|---|---|
| 80 | 0.80 | 63,382,530,011,360 | CCA `floorPrice` |
| 100 | 1.00 | 79,228,162,514,200 | Issue price (≈ 7.92e13, well above the CCA minimum floor 2^32+1) |
| 190 | 1.90 | 150,533,508,776,980 | `AuctionValidationHook.capQ96` |
| 1 | 0.01 | 792,281,625,142 | CCA `tickSpacing` |

Every price is a multiple of `ONE_POINT_Q96` rather than `floor(points * 2^96 / 1e17)`, because the CCA requires the
floor and each bid's `maxPrice` to sit exactly on a tick boundary (`TickPriceNotAtBoundary`). The difference from the
untruncated value is under 1 raw Q96 unit per point (64 units at 100 points, a relative error below 1e-12).

## Deploy wiring (for the launch script)

The CCA factory's CREATE2 init code includes `AuctionParameters.validationHook`, so the hook can't know the auction
address at deploy time. Order:

1. Deploy `MockSME` (supply to the issuer). Pick a CREATE2 salt so its address sorts above USDC, so USDC is `currency0`
   in the v4 pool (plan.md "Quote currency").
2. Predict the hook address, deploy `AllowAllModule(predictedHook, 20e6)`, then
   `AuctionValidationHook(module, mockSME, USDC, ListingPrice.CAP_PRICE_Q96)`. The hook constructor reverts
   `ModuleHookMismatch` if the module was built for another address. `HookFixture._deployHookAndModule` shows the
   nonce-based prediction.
3. LiquidityLauncher `multicall(depositToken, distributeToken)` with `validationHook = hook`, `floorPrice =
   FLOOR_PRICE_Q96`, `tickSpacing = TICK_SPACING_Q96`, `currency = USDC`. Read the auction from `AuctionCreated`.
4. From the hook deployer, `hook.setAuction(auction)` strictly before `startBlock`. It checks `validationHook()`,
   `token()` and `currency()` on the auction, and can only run once.

`ListingLifecycle.fork.t.sol` runs this whole sequence against the live Sepolia contracts; `_launch()` there is the
reference for the launch script.

## Full lifecycle (chunk 2)

| Step | Who | Call | Notes |
|---|---|---|---|
| 1 | issuer | `new MockSME{salt}` | Salt searched so MockSME > USDC: USDC is `currency0` and the pool price is inverted |
| 2 | issuer | `AllowAllModule` + `AuctionValidationHook` | As above |
| 3 | issuer | mine + deploy `ListingHook` | `HookMiner.find(deployer, flags, creationCode, abi.encode(PoolManager, LBPStrategy, config))`, flags = BEFORE/AFTER_INITIALIZE + BEFORE/AFTER_SWAP (`0x30C0`). In a script the deployer is the CREATE2 proxy `0x4e59…956C` |
| 4 | issuer | `MockSME.approve(Permit2)`, `Permit2.approve(MockSME, LiquidityLauncher, 110,000e18, exp)` | The launcher pulls the deposit through Permit2 |
| 5 | issuer | `LiquidityLauncher.multicall([depositToken, distributeToken])` | `Distribution{strategy: LBPStrategy, amount: 110,000e18, configData: abi.encode(MigratorParameters, abi.encode(AuctionParameters))}`. LBPStrategy creates the CCA (90,000), keeps 20,000 for LP, reserves the pool id. Auction address: `InitializerCreated` topic 1 |
| 6 | issuer | `validationHook.setAuction(auction)` | Before `startBlock` |
| 7 | bidders | `USDC.approve(Permit2)`, `Permit2.approve(USDC, auction, amount, exp)`, `submitBid(maxPriceQ96, amount, owner, floorQ96, "")` | Up to 20 USDC each |
| 8 | anyone | after `endBlock`: `exitBid(id)`, then after `claimBlock`: `claimTokens(id)` | Not graduated: `exitBid` refunds everything, `claimTokens` reverts `NotGraduated` |
| 9 | treasury | `sweepUnsoldTokens()` | Unsold auction shares (all 90,000 if not graduated) |
| 10 | anyone | after `migrationBlock`: `LBPStrategy.migrate(auction)` | Opens the v4 pool at the clearing price through `ListingHook`, mints a full-range LP NFT to the treasury, sends the non-LP USDC and unused LP shares to the treasury |

Demo parameters used by the fork test (plan.md §4):

| Parameter | Value |
|---|---|
| `AuctionParameters` | `currency` USDC, `tokensRecipient` treasury, `fundsRecipient` LBPStrategy, 100 blocks at `1e5` mps, `claimBlock = endBlock`, floor 80 points, tick 1 point, `requiredCurrencyRaised` 45e6 |
| `MigratorParameters` | `migrationBlock = endBlock + 1`, `reservedTokenAmountForLP` 20,000e18, `recipient` + `positionRecipient` treasury, pool fee 3000 / tick spacing 60 / `ListingHook`, no extra positions (full range only), LP bracket 20% of the raise |
| Outcomes | 99 USDC from 5 bidders at the cap clears at 110 points (just above the tick: 99e6 / 90,000e18 is between ticks), the pool opens at 1.10 USDC / lot. 45 USDC clears at the floor and graduates (33,750 unsold shares to the treasury). 44.999999 USDC doesn't graduate |

## ListingHook

One hook per listing. It serves exactly one pool, whose key (USDC, MockSME, fee, tick spacing, itself) is fixed at
deploy time, so `poolId()` is known before migration. Prices are compared in sqrtPriceX96 space; bands are defined on
the share price (USDC per share), so ±5% around 110 is exactly 104.5 to 115.5 points in either token order.

| Callback | What it does |
|---|---|
| `beforeInitialize` (`view`) | Inherited `InitializerHook` check `sender == LBPStrategy`, then the pinned key |
| `afterInitialize` | Stores the listing price (the clearing price), `usdcIsCurrency0`, the listing-day band, `listingDayEndsAt = now + listingDayDuration`; emits `Listed` |
| `beforeSwap` | Reverts `Halted` / `CoolingOff` from the policy; `tstore`s the pre-swap price |
| `afterSwap` | Listing day: reverts `OutOfBand` outside ±`listingDayBandBps` of the listing price. After: directional check (mode 2), then the policy band |

Liquidity callbacks are off, so adding and removing liquidity always works, including while halted.

**Policy (`IListingPolicy.policy()`).** Read on every swap from `policySource`, which the owner sets with
`setPolicySource`: the CRE `ListingPolicyReceiver` in the real setup, or `MockListingPolicy` in tests. Zero fields
fall back to defaults, and an `address(0)` source means all defaults:

| Field | Meaning | Default |
|---|---|---|
| `refSqrtPriceX96` | Reference price, **as the pool's own sqrtPriceX96** (use `ListingPrice.pointsToSqrtPriceX96(points, hook.usdcIsCurrency0())`) | listing price |
| `normalBandBps` | Band in mode 0 and 2 | 2000 (20%) |
| `survBandBps` | Band in mode 1; also the directional tolerance | 500 (5%) |
| `mode` | 0 normal, 1 surveillance, 2 directional; other values = 0 | 0 |
| `halted` | All swaps revert | false |
| `coolOffUntil` | Swaps revert before this timestamp | 0 |

During the listing-day window only the listing-day band, halt and cool-off apply; reference, mode and bands take
effect after it. `version`, `asOf` and `chainSelector` are carried for the receiver; the hook doesn't check freshness.

**Directional mode.** A swap that increases the distance to the reference (measured as `max(p/ref, ref/p)`, the same
in both token orders) reverts `DirectionalWidening` unless it ends within the surveillance band of the reference.
Without that tolerance a pool sitting at the reference could never trade. Swaps toward the reference only face the
normal band.

**Reads for the frontend.** `phase()` (NotListed / ListingDay / Normal), `currentBand()` (sqrt bounds),
`currentBandPointsE2()` and `currentPointsE2()` (share prices x100: `11000` = 1.10 USDC / lot), `effectivePolicy()`
(defaults filled in), `listingSqrtPriceX96()`, `listingDayEndsAt()`, `usdcIsCurrency0()`, `poolKey()`, `poolId()`.
Events: `Listed` once at migration, `PolicySourceSet`. Reverted swaps emit nothing.

## ListingPolicyReceiver (chunk 4)

The exchange's market controls reach the pool like this:

1. The issuer console edits the mock exchange API.
2. The CRE workflow ([`../cre`](../cre)) runs on a cron or HTTP trigger. It `GET`s the API, encodes the policy into a report and calls `writeReport`.
3. The Keystone forwarder calls `ListingPolicyReceiver.onReport(metadata, report)`.
4. `ListingHook` reads `receiver.policy()` on every swap.

To plug the receiver in, the hook owner calls `hook.setPolicySource(receiver)`. Nothing else changes in the hook.

**Report payload.** `abi.encode(ListingPolicy policy, string status)`, the struct above plus an optional ENS status. `metadata` (workflow id, name, owner) is ignored.

**Checks, in order** (any failure reverts; the forwarder records it as `ReportProcessed(..., result = false)`):

| # | Check | Error |
|---|---|---|
| 1 | `msg.sender == forwarder` | `InvalidSender` |
| 2 | `tx.origin == broadcaster` (hackathon guard; `broadcaster = 0` disables it) | `InvalidOrigin` |
| 3 | `policy.chainSelector == 16015286601757825753` (Sepolia, immutable) | `WrongChainSelector` |
| 4 | `asOf > last accepted asOf` (strictly monotonic) | `StaleReport` |
| 5 | `asOf <= block.timestamp + 5 min` | `ReportFromFuture` |
| 6 | `block.timestamp - asOf <= maxAge` | `ReportExpired` |
| 7 | bands `< 10000` bps, `mode <= 2` | `InvalidPolicy` |
| 8 | `status` is at most 32 bytes | `InvalidStatus` |

When a report passes, the receiver:

- Assigns `version = previous + 1` and ignores the report's own `version`.
- Stores the policy and the status, then emits `PolicyApplied(version, policy, status)`.
- Then, and only then, tries the ENS mirror.

The guard is two-part on purpose. Sepolia's CRE simulation forwarder `MockKeystoneForwarder`
(`0x15fC6ae953E024d975e77382eEeC56A9101f9F88`; verified on-chain, and the address the `cre` CLI uses) checks no
signatures, and both `report()` and `route()` are public. Anyone can make it call `onReport`, so `msg.sender` alone
proves nothing. `tx.origin == broadcaster` pins delivery to the operator key that runs
`cre workflow simulate --broadcast`. A transient-storage reentrancy lock stops the ENS call from pushing a second
report through `route()` inside the same transaction. Once the workflow is deployed to a DON, point `setForwarder` at
the signature-checking `KeystoneForwarder` (`0xF834…4482`) and clear the broadcaster.

**Staleness rule (fail closed).** `policy()` returns the stored policy with `halted = true` once
`block.timestamp > asOf + maxAge`. The hook then rejects swaps with `Halted()`, while liquidity add and remove keep
working. The next accepted report lifts it. `latestPolicy()` returns the raw stored policy, `isStale()` says whether the
override is active, and `staleAt()` gives the first stale timestamp (`asOf + maxAge + 1`). Before the first report,
`policy()` is all zeros, so the hook uses its defaults and an unpublished receiver behaves like having no source.
Choose `maxAge` with the cadence in mind: with manual `simulate --broadcast` runs, something like `1 day` is
practical; with a DON cron every minute, minutes.

**ENS status mirror (best effort).** After applying a policy, the receiver writes
`setText(statusName, "listingday.status", status)` to `statusResolver`. The owner sets both with `setStatusMirror`;
`statusName` is DNS-encoded and the resolver may be unset.

- An empty `status` is derived from the policy: `halted` when halted or cooling off, `surveillance` when mode is not 0, otherwise `listed`. The console can send `draft`, `auction` or `listed` explicitly.
- The write is skipped when the status equals the last mirrored one.
- The write runs in `try/catch` with at most 1M gas (`STATUS_MIRROR_GAS`), keeping a reserve for the bookkeeping after it.
- A resolver that reverts, burns all its gas, rejects the writer, or has no code emits `StatusMirrorFailed(resolver, status, reason)`, and the policy stays applied.
- Anyone can call `syncStatus()` to retry. The workflow's `gasLimit` (1.8M) covers the ENS call plus the forwarder overhead.

**Admin (owner only, `OnlyOwner`).** `setForwarder` (non-zero), `setBroadcaster` (`0` disables the origin check),
`setMaxAge` (non-zero) and `setStatusMirror`. `owner` and `chainSelector` are immutable.

**Reads for the frontend.** `policy()` (what the hook enforces), `latestPolicy()`, `status()`, `isStale()`,
`staleAt()`, `maxAge()`, `forwarder()`, `broadcaster()`, `statusResolver()`, `statusName()`. Prefer
`ListingHook.effectivePolicy()` for the defaults-filled view. Events: `PolicyApplied`, `StatusMirrored`,
`StatusMirrorFailed`, and the forwarder's `ReportProcessed(receiver, workflowExecutionId, reportId, result)`. Topics
are in [`errors.md`](errors.md#events).

**Deploy.**

```bash
CRE_BROADCASTER=<address of CRE_ETH_PRIVATE_KEY> LISTING_HOOK=<hook, if you own it> \
  forge script script/DeployListingPolicyReceiver.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key $PK
```

The forwarder defaults to the Sepolia `MockKeystoneForwarder` and `maxAge` to 1 day; see the script header for the
other variables. Then set `receiverAddress` in `../cre/listing-policy/config.staging.json`.

## ENSv2 ticker namespace (chunk 6)

Each SME ticker is an ENSv2 subname that the issuer controls, and the app reads everything about an IPO from it
(plan.md §7). Built against the live Sepolia ENSv2 deployment, ensdomains/contracts-v2 tag
**`v2-mainnet-deployment-1`** (commit `62778d8`), not `main`. Addresses are in `SepoliaEns` (`Constants.sol`) and are
re-checked onchain by `SepoliaAddresses.fork.t.sol`; the official ABIs are in `abis/ensv2/`.

```
ETHRegistry (.eth)
└─ listingday.eth            owner: the exchange (ENS_OWNER_KEY). ETHRegistrar commit/reveal, paid in ENS MockUSDC
   │                         (0x240b…14aa, public mint; ~8.0 USDC/yr). Roles from registration: SET_SUBREGISTRY(+admin),
   │                         SET_RESOLVER(+admin), CAN_TRANSFER_ADMIN
   └─ subregistry: UserRegistry   VerifiableFactory proxy of UserRegistryImpl; root roles of the exchange:
      │                           REGISTRAR | UNREGISTER | SET_PARENT (no admin, no upgrade); canonical parent set
      └─ acme.listingday.eth      owner: the issuer (ERC-1155 token); roles SET_RESOLVER | RENEW only, no
                                  CAN_TRANSFER_ADMIN; expiry = the parent's
         resolver: the issuer's PermissionedResolver (VerifiableFactory proxy, issuer holds ALL_ROLES, one per ticker)
```

**Records on `acme.listingday.eth`.** All written by the issuer (`EnsRecords`) except `listingday.status`:

| Key | Value |
|---|---|
| `addr` (coin type 60) | MockSME |
| `listingday.auction` | CCA address (after `make launch`; re-run `make ens-records`) |
| `listingday.pool` | v4 PoolId, `0x` + 64 hex (fixed at deploy: the hook pins the pool key) |
| `listingday.hook` | ListingHook |
| `listingday.policy` | `eip155:<chainId>:<ListingPolicyReceiver>` |
| `listingday.status` | `listed` / `surveillance` / `halted` (or what the CRE report sends). **Only the receiver writes it**, on every accepted report. Empty until the first report: show "draft" |
| `listingday.eligibility` | `open` (`AllowAllModule`) or `human` (`WorldPassModule`): follows the validation hook's module in the deployments file, so ENS can't advertise a mode the hook doesn't enforce |
| `description`, `url`, `avatar` | Issuer profile; avatar defaults to an inline `data:image/svg+xml;base64,…` (ENSIP-12) |

**The receiver's write power.** The issuer calls `resolver.grantSetterRoles(abi.encodeCall(setText, (name,
"listingday.status", "")), receiver)`. That grants `ROLE_SET_TEXT` on the resource `uint256(keccak256("listingday.status"))`
(needs `ROLE_SET_TEXT_ADMIN`; `grantRoles` is disabled on the resolver). The role is per key across every name in that
resolver, which is why each ticker gets its own resolver. Then the receiver owner calls `setStatusMirror(resolver,
dnsEncode("acme.listingday.eth"))`. Any other write from the receiver reverts `EACUnauthorizedAccountRoles`. Gas for a
report through the MockKeystoneForwarder with the mirror: ~199k in the fork tests (`evm_version = cancun`; ~46k of it
the first `setText`, ~29k after), and 351k (halt) / 241k (resume) on the anvil rehearsal, which runs Sepolia's current
schedule (a USDC `approve` there is ~128k, as on live Sepolia). Either way well inside the workflow's 1.8M `gasLimit`.

**Scripts** (`script/ens/`, each idempotent, `.ens` in the deployments file rebuilt from chain state every time):

| Step | Script | Signer | What |
|---|---|---|---|
| 1 | `EnsName.s.sol` (run twice) | `ENS_OWNER_KEY` | Mint + approve MockUSDC, `commit`; after 60 s `register("listingday", owner, secret, 0, 0, ENS_DURATION, MockUSDC, 0)` |
| 2 | `EnsRegistry.s.sol` | `ENS_OWNER_KEY` | `VerifiableFactory.deployProxy(UserRegistryImpl, salt, initialize([(owner, roles)]))`, `setParent`, `ETHRegistry.setSubregistry(findTokenId("listingday"), registry)` |
| 3 | `EnsTicker.s.sol` | `ISSUER_KEY`, `ENS_OWNER_KEY` | Issuer deploys its PermissionedResolver proxy; exchange `register("acme", issuer, 0, resolver, SET_RESOLVER \| RENEW, parentExpiry)` |
| 4 | `EnsRecords.s.sol` | `ISSUER_KEY` | One `multicall` of the changed records |
| 5 | `EnsStatusRole.s.sol` | `ISSUER_KEY`, `PRIVATE_KEY` | `grantSetterRoles` for the receiver, `setStatusMirror`, `syncStatus()` if a report already landed |
| 6 | `EnsRead.s.sol` | none | Every record through the Universal Resolver, as the frontend reads them |

`EnsFork.s.sol` (`make ens-fork`) runs all of it on a Sepolia fork with asserts, plus three CRE-style reports;
`make ens-sepolia` is the live run ([`DEPLOY.md`](DEPLOY.md#5-ensv2-ticker-namespace-chunk-6)).

### Frontend read guide

The UI hard-codes only the parent name. viem's `sepolia` chain already has `ensUniversalResolver =
0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`. All records are onchain, so turn CCIP-Read off: no gateway call can leak
around Anon-RPC. `getEnsText` / `getEnsAddress` call `resolveWithGateways(dnsName, data, ["x-batch-gateway:true"])`,
which `EnsRead.s.sol` reproduces. Tested against the anvil rehearsal chain with viem 2.57:

```ts
import { createPublicClient, http, parseAbi, parseAbiItem } from "viem";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";

const client = createPublicClient({ chain: sepolia, transport: http(RPC_URL), ccipRead: false });

const name = normalize("acme.listingday.eth");
const KEYS = ["listingday.auction", "listingday.pool", "listingday.hook", "listingday.policy",
  "listingday.status", "listingday.eligibility", "description", "url", "avatar"] as const;
const [token, ...texts] = await Promise.all([
  client.getEnsAddress({ name }), // MockSME
  ...KEYS.map((key) => client.getEnsText({ name, key })), // null when unset
]);
const status = texts[4] ?? "draft";

// The IPO list: tickers under listingday.eth, from the UserRegistry's events.
const registryAbi = parseAbi([
  "function getSubregistry(string label) view returns (address)",
  "function findOwner(string label) view returns (address)",
  "function findTokenId(string label) view returns (uint256)",
]);
const registry = await client.readContract({
  address: "0xD4eBcbBdF463C9c45784603Db0dDD499BC44A8B4", // ETHRegistry
  abi: registryAbi, functionName: "getSubregistry", args: ["listingday"],
});
const listed = await client.getLogs({
  address: registry,
  event: parseAbiItem("event LabelRegistered(uint256 indexed tokenId, bytes32 indexed labelHash, string label, address owner, uint64 expiry, address indexed sender)"),
  fromBlock: ENS_FROM_BLOCK, // deployments/sepolia.json .txs.ensRegistry[0].block
});
// Delisted tickers have findOwner == 0x0 (also LabelUnregistered events). Never cache token ids:
// they change on role changes (TokenRegenerated) and relists; use findTokenId(label).
```

Don't call the resolver's `text(node, key)` / `addr(node)` directly: the PermissionedResolver has no such views and
reverts. Reads go through `resolve(dnsName, abi.encodeCall(text, (node, key)))` (ENSIP-10), which the Universal
Resolver, and so viem, already does.

Then check the records against each other: `listingday.hook` should be the hook whose `policySource()` is the
receiver in `listingday.policy`, and `listingday.eligibility` should match the validation hook's module.

### Where ENSv2 differs from plan.md §7

- **Universal Resolver.** `0xeEeE…EeEe` (`UpgradableUniversalResolverProxy`) points at
  `ManagedUniversalResolverProxy` `0x6d80…e6F1`, which then points at `UniversalResolverV2` `0x24E1…2D72`: one more hop
  than the plan says. Transparent to viem.
- **Transfer reverts.** `safeTransferFrom` of a ticker reverts `TransferUnsafeUntilRegistryIsEmancipated` before the
  transfer-role check, because a registry whose root holds `ROLE_UNREGISTER` is not emancipated. Only
  `unsafeTransfer` reaches `TransferDisallowed`. Both block the transfer.
- **Token id regeneration on `acme`.** Token admin roles can only be granted at registration, and the issuer gets none,
  so nobody can change `acme`'s roles: its id only changes on delist/relist (`unregister` + `register`, records kept).
  The tests show `TokenRegenerated` on `listingday.eth`, where we hold admin roles from registration.
- **Extra root role.** `ROLE_SET_PARENT` besides `ROLE_REGISTRAR` and `ROLE_UNREGISTER`, to set the registry's
  canonical parent (`getParent()` = ETHRegistry, `"listingday"`).
- **One resolver per ticker** (salt = the ticker name), not per issuer account, so the receiver's scoped role covers
  exactly one name.
- **`listingday.pool` at deploy**, not after migrate: the pool id is fixed once the hook exists.
- **Payment token.** The rent oracle also accepts Circle's Sepolia USDC; we pay in ENS MockUSDC as planned (mintable).
- **Reads are `resolve()`-only.** The PermissionedResolver exposes no `text` / `addr` views, only ENSIP-10
  `resolve(dnsName, data)`. The Universal Resolver path the plan uses is unaffected.

## World ID eligibility (chunk 7)

A **human** listing (plan.md §8) admits one person per wallet and caps each person, not each wallet. World ID only:
Proof of Human, no nationality or documents. The proof is checked off-chain by
[`../services/verify`](../services/verify/README.md) (IDKit 4.x, World's `/api/v4/verify`), which then signs an
`EligibilityPass`; the chain only checks that signature.

```solidity
struct EligibilityPass {
    bytes32 nullifier; // World ID nullifier for action `listingday-<ticker>`: one per person per action
    address wallet;    // must be the bid owner and the sender
    address auction;   // must be this hook's auction
    uint128 cap;       // per-person cumulative cap, raw USDC (20 USDC)
    uint64 expiry;     // unix seconds, inclusive (backend: now + 10 min)
}
// hookData = abi.encode(pass, signature); EIP-712 domain ("ListingDay WorldPass", "1", chainId, module)
```

`WorldPassModule(hook, signer)` (signer = the backend's `PASS_SIGNER_KEY` address, immutable) runs, per bid:

1. only its hook (`OnlyHook`); the hook has already checked auction, `sender == owner` and the price cap;
2. decode + `ECDSA.tryRecover` against `signer` (`NotEligible` `MissingPass` / `InvalidPass` / `WrongSigner`; high-s
   and malformed signatures are rejected);
3. `block.timestamp <= expiry` (`Expired`), `wallet == owner == sender` (`WrongWallet`), `auction == hook.auction()`
   (`WrongAuction`);
4. binding: the first accepted bid binds `nullifier <-> wallet` both ways (`NullifierBound`); afterwards another wallet
   with that nullifier reverts `NullifierBoundToOtherWallet`, and that wallet with another nullifier
   `WalletBoundToOtherNullifier`;
5. `committed[nullifier] + amount <= pass.cap` (`CapExceeded`), then `BudgetCommitted`.

A pass is reusable for several bids until it expires; the cap is cumulative per person across passes. Errors and the
reason numbers: [`errors.md`](errors.md#world-id-passes-worldpassmodule-human-listings). The backend enforces the same
binding (409 for a second wallet) before it signs, so the contract check is the backstop if a pass for another
wallet is ever presented.

**Trust.** The pass signer is the trust point: whoever holds `PASS_SIGNER_KEY` can admit anyone, so it stays
server-side next to the RP key. The proofs themselves aren't verified on-chain here (the backend uses the Developer
Portal verify API), and the chain stores only nullifiers and wallets. This is sybil resistance, not KYC.

**Deploy.** Same nonce-predicted wiring as `AllowAllModule` (`HookFixture._deployHookAndWorldPass`); the scripts do it
with `ELIGIBILITY=human` ([`DEPLOY.md`](DEPLOY.md#6-human-listing-world-id-chunk-7)). Because the hook's module is
immutable, a human listing is a new launch, not a switch on an existing one.

**Parity.** `services/verify/fixtures/pass-vectors.json` pins passes signed by the TypeScript signer (viem);
`WorldPassFixture.t.sol` deploys the module at the fixture's addresses and checks the digest, the signer, the
`hookData` bytes and an accepted bid. `npm test` there checks the file is current.

## Pinned dependencies

Submodules under `lib/`, pinned to the commits validated in `../VALIDATION.md` or to what those repos pin themselves.

| Dep | Commit | Why this one |
|---|---|---|
| `continuous-clearing-auction` | `ce78b4d` (v2.1.0 + CI-only commits; `src/` identical to tag `v2.1.0`, the deployed factory) | VALIDATION.md pin |
| `liquidity-launcher` | `266c187` (v3.3.0 + docs; `src/` identical to tag `v3.3.0`) | VALIDATION.md pin |
| `openzeppelin-contracts` | `e4f7021` (v5.3.0) | CCA's pin |
| `solady` | `2af0640` (v0.1.23) | CCA's pin |
| `permit2` | `cc56ad0` | CCA's and liquidity-launcher's pin |
| `blocknumberish` | `38fe20b` (v1.1.0) | CCA's and liquidity-launcher's pin |
| `v4-core` | `59d3ecf` | liquidity-launcher's pin (needed by `InitializerHook` / `LBPStrategy` later) |
| `v4-periphery` | `ad04c9f` | liquidity-launcher's pin |
| `solmate` | `4b47a19` | v4-core's pin; only needed to compile `PoolManager` for the local `ListingHook` unit tests |
| `forge-std` | `8e40513` (v1.11.0) | latest release |

Compiler: solc 0.8.26, `evm_version = cancun`; the CCA factory compiles with via-IR, the same split as the CCA repo.
