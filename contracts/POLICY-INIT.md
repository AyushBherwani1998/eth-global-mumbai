# Initial Policy Configuration Commands

## Current State (Verified On-Chain)
All receiver `policy()` returns ZEROS except halted=false:
- JIO receiver 0x594B83406A429074EE34E39aD7B62332A24F0d43: version=0, asOf=0, halted=false
- TCS receiver 0xABA8dEFf6B92F952fF64a04Eb76C5A1E58966b14: version=0, asOf=0, halted=false

**Effect**: Hook applies defaults (normalBandBps=2000, halted=false) but NO reference price set.

## Required: Set Initial Baseline Policy

### Per-Stock Commands

```bash
cd contracts

# JIOFIN - Set 100 points reference
DEPLOYMENTS_FILE=deployments/sepolia-jiofin.json ISSUE_POINTS=100 \
forge script script/demo/InitPolicy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --slow --via-ir

# Reliance - Set 571 points reference (after deploy)
DEPLOYMENTS_FILE=deployments/sepolia-reliance.json ISSUE_POINTS=571 \
forge script script/demo/InitPolicy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --slow --via-ir

# TCS - Set 1081 points reference
DEPLOYMENTS_FILE=deployments/sepolia-tcs.json ISSUE_POINTS=1081 \
forge script script/demo/InitPolicy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --slow --via-ir
```

## What InitPolicy.s.sol Does

1. Reads receiver from deployment file
2. Builds ListingPolicy struct:
   - `refSqrtPriceX96` = issue price converted to sqrtPriceX96
   - `normalBandBps` = 2000 (20%)
   - `survBandBps` = 500 (5%, not used)
   - `mode` = 0 (normal)
   - `halted` = false (UNHALTED)
   - `asOf` = current timestamp
   - `chainSelector` = Sepolia selector
3. Sends via MockKeystoneForwarder.report() from broadcaster
4. Verifies PolicyApplied event and policy state

## Verification After Init

```bash
# Check policy applied (field 7 should still be false):
cast call 0x594B83406A429074EE34E39aD7B62332A24F0d43 \
  "policy()(uint160,uint64,uint64,uint16,uint16,uint8,bool,uint64,uint16)" \
  --rpc-url $SEPOLIA_RPC_URL

# Expected (JIOFIN example):
# (refSqrtPriceX96>0, asOf>0, 0, 2000, 500, 0, false, 16015286601757825753, 0)
#  ^reference set  ^timestamp  ^cooloff ^20% ^5% ^normal ^NOT HALTED ^chainSel
```

## Band Defaults Confirmed

From ListingHook.sol `_effectivePolicy()`:
- `DEFAULT_NORMAL_BAND_BPS = 2000` (20%)
- `DEFAULT_SURVEILLANCE_BAND_BPS = 500` (5%)

From hook constants:
- `listingDayBandBps = 500` (5%, first hour override)

## Staleness Settings

- `maxAge = 86400` (1 day) - policy stale after 24h without update
- Fresh report sets `asOf = block.timestamp`
- **No automation** - policy stays valid unless maxAge expires

## Safety Checks

1. Script requires `halted = false` in struct
2. Script verifies `after.halted = false` on-chain
3. Mode 0 (normal) only
4. No cool-off period
5. Reference price = issue price (safe baseline)

## Manual Policy Read (All Fields)

```bash
# ListingPolicy struct ABI:
# (uint160 refSqrtPriceX96,
#  uint64 asOf,
#  uint64 coolOffUntil,
#  uint16 normalBandBps,
#  uint16 survBandBps,
#  uint8 mode,
#  bool halted,
#  uint64 chainSelector,
#  uint16 directionalBandBps)

cast call $RECEIVER_ADDRESS \
  "policy()(uint160,uint64,uint64,uint16,uint16,uint8,bool,uint64,uint16)" \
  --rpc-url $SEPOLIA_RPC_URL
```

## Operator Execution Order

1. Run `make deploy launch` for each stock
2. Run `InitPolicy.s.sol` for each stock (sets bands + reference)
3. Run `make bids` (bands now active)
4. Verify policy with cast call

No halt tests, no out-of-band tests, just baseline configuration.
