# Listing Day contracts

Foundry project for the Listing Day CCA + v4 IPO (design: [`../plan.md`](../plan.md)). This covers build chunks 0
to 5:

- Chunks 0 and 1: the scaffold, the price math, `MockSME`, `AuctionValidationHook` and `AllowAllModule`.
- Chunk 2: the full launch-to-trading lifecycle on a Sepolia fork, through the deployed Uniswap contracts.
- Chunk 3: `ListingHook`.
- Chunk 4: the Chainlink CRE consumer `ListingPolicyReceiver`, which feeds the hook its policy. The workflow that writes to it lives in [`../cre`](../cre), and the exchange API it reads from in [`../services/mock-exchange`](../services/mock-exchange).
- Chunk 5: the Sepolia demo scripts (`script/demo/`, `make demo-fork` / `make demo-sepolia`): fund the demo wallets, deploy, launch, bid, settle, trade, halt. They write `deployments/sepolia.json` and the frontend ABIs live in `abis/`. See [`DEPLOY.md`](DEPLOY.md).

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
| `src/libraries/Constants.sol` | `Sepolia` addresses (plan.md §17, each checked onchain) and `ListingDay` demo parameters |
| `src/libraries/ListingPrice.sol` | Points ↔ CCA Q96 price math and tick-spacing helper. Use it everywhere (hook cap, launch script, UI) |
| `src/MockSME.sol` | Fixed-supply share token, 110,000e18 minted once in the constructor, no mint function |
| `src/AuctionValidationHook.sol` | CCA `IValidationHook`: only the bound auction, `sender == owner`, `maxPrice <= capQ96`, then the module |
| `src/modules/AllowAllModule.sol` | Phase 1 `IEligibilityModule`: per-wallet cumulative budget cap (20 USDC); only its hook may call it |
| `src/ListingHook.sol` | v4 hook (inherits liquidity-launcher `InitializerHook`): only LBPStrategy initializes; listing-day ±5% band, then policy bands, directional mode, halt, cool-off; no liquidity flags |
| `src/libraries/ListingBand.sol` | Share-price bands in sqrtPriceX96 space, orientation-aware |
| `src/ListingPolicyReceiver.sol` | Chainlink CRE consumer (`IReceiver.onReport`) that stores the `ListingPolicy` and serves it to the hook as its `IListingPolicy`; best-effort ENS status mirror |
| `src/mocks/MockListingPolicy.sol` | Owner-settable `IListingPolicy` for tests and manual demos without CRE |
| `src/mocks/MockStatusResolver.sol` | `IStatusResolver` stand-in for the ENS resolver (can be told to revert or burn gas) until chunk 6 |
| `src/interfaces/` | `IAuctionValidationHook`, `IEligibilityModule`, `IListingHook`, `IListingPolicy`, `IListingPolicyReceiver`, `IReceiver` (Chainlink-compatible), `IStatusResolver` (errors, events and reads for the frontend ABI) |
| `script/DeployListingPolicyReceiver.s.sol` | Deploys the receiver; optionally points a hook at it and sets the ENS mirror |
| `script/demo/` | The demo steps (`FundDemoWallets`, `DemoDeploy`, `DemoLaunch`, `DemoBid`, `DemoSettle`, `DemoTrade`, `DemoHalt`, `ExportDeployments`), each idempotent against the deployments file; `DemoFork` runs them all on a fork with asserts; `anvil-rehearsal.sh` runs them as broadcasts against anvil. Entry points in the `Makefile`, walkthrough in [`DEPLOY.md`](DEPLOY.md) |
| `deployments/` | `sepolia.json` after the real run (committed); fork and anvil rehearsals write git-ignored files next to it |
| `abis/` | Frontend ABI arrays, regenerated with `make abis` (CI checks they're current) |
| `test/unit/` | Price math, hook + module, the real CCA v2.1.0 code wrapping hook reverts, `ListingHook` on a local PoolManager in both token orders, the receiver (directly and through a `MockKeystoneForwarder` port driving a hook), the CRE report vectors shared with the TypeScript workflow, and the tx-hash export on a trimmed real broadcast log (`test/fixtures/broadcast/`) |
| `test/fork/` | Sepolia USDC metadata, every constant + cross-links, a bid through the live CCA factory, the full lifecycle (`ListingLifecycle.fork.t.sol`, ending with CRE halting and reopening the migrated pool), reports through the live Sepolia `MockKeystoneForwarder` (`CreMockForwarder.fork.t.sol`), and the demo scripts end to end (`DemoScripts.fork.t.sol`) |

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
