# Listing Day contracts

Foundry project for the Listing Day CCA + v4 IPO (design: [`../plan.md`](../plan.md)). This covers build chunks 0–2:
the scaffold, the price math, `MockSME`, `AuctionValidationHook`, `AllowAllModule`, `ListingPolicyReceiver`, and 
`ListingHook`. Nothing is deployed yet; everything runs locally or on a Sepolia fork.

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
| `src/ListingPolicyReceiver.sol` | CRE policy store with tx.origin guard and best-effort ENS status mirror (plan.md §6) |
| `src/ListingHook.sol` | Uniswap v4 hook: inherits InitializerHook, enforces bands/modes/halt, orientation-aware, LP never blocked |
| `src/interfaces/` | `IAuctionValidationHook`, `IEligibilityModule`, `IListingPolicyReceiver`, `IListingHook` (errors and events for the frontend ABI) |
| `test/unit/` | Price math, auction validation hook + module, policy receiver, and listing hook unit tests |
| `test/fork/` | Sepolia USDC metadata, every constant + cross-links, and a bid through the live CCA factory with USDC + Permit2 |

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
| `forge-std` | `8e40513` (v1.11.0) | latest release |

Compiler: solc 0.8.26, `evm_version = cancun`; the CCA factory compiles with via-IR, the same split as the CCA repo.
