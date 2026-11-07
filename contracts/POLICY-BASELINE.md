# Policy & Band Configuration (Baseline)

## Infrastructure Status: CONFIGURED, NOT DEMONSTRATED

All three new listings (JIOFIN, Reliance, TCS) deploy full band/halt infrastructure:
- ✅ ListingPolicyReceiver deployed per listing
- ✅ Hook.setPolicySource(receiver) set at deploy
- ✅ Initial state: UNHALTED, trading open
- ✅ Band mechanisms active
- ❌ NO halt demonstrations
- ❌ NO surveillance/directional mode tests
- ❌ NO policy transitions triggered

## Initial State (After Deploy, Before Any CRE Report)

**Receiver**: Policy storage empty (all zeros)
**Hook interpretation**: Applies DEFAULT values, trading OPEN

```solidity
// From ListingHook.sol _checkPolicy():
if (p.normalBandBps == 0) p.normalBandBps = DEFAULT_NORMAL_BAND_BPS;  // 2000 = 20%
if (p.survBandBps == 0) p.survBandBps = DEFAULT_SURV_BAND_BPS;        // 500 = 5%
```

**Result**: 
- halted = false
- mode = 0 (normal)
- normalBandBps = 2000 (20% default)
- Trading OPEN with 20% band

## Listing Day Override (First Hour After Migration)

During listing hour (hookPhase == ListingDay):
- Band = `listingDayBandBps` (500 = 5%)
- Overrides policy.normalBandBps
- Still respects policy.halted

**All three listings**: `listingDayBandBps = 500` (5%)

## Band Scaling Across Price Points

Band width is PERCENTAGE-BASED, scales automatically:

| Listing | Issue Points | 20% Normal Band | 5% Listing Day |
|---------|--------------|-----------------|----------------|
| JIOFIN | 100 | 80-120 | 95-105 |
| Reliance | 571 | 457-685 | 542-600 |
| TCS | 1081 | 865-1297 | 1027-1135 |

**No manual scaling needed** - band library handles proportional ranges.

## Halt Authorization

**Per listing**:
- Owner: deployer (0xAfD0...)
- Broadcaster: CRE_BROADCASTER_KEY address
- Forwarder: Sepolia MockKeystoneForwarder (0x15fC...)

**Halt path** (NOT USED IN THIS DEMO):
1. CRE workflow sends report via forwarder
2. Receiver validates: broadcaster tx.origin, asOf increases
3. Policy applied: halted flag stored
4. Hook enforces: all swaps revert with Halted()

**This demo**: NO CRE reports sent, stays in initial open state

## Staleness Failsafe

After first report: if `block.timestamp > asOf + maxAge`, policy auto-halts (fail closed).

**This demo**: No report = no asOf = no staleness check = OPEN

maxAge = 86400 (1 day default) applies after first report only.

## What This Enables (But Doesn't Use)

Infrastructure present allows FUTURE:
- CRE surveillance reports
- Halt/resume via reports  
- Surveillance/directional bands
- Cool-off periods
- ENS status mirroring

**This demo uses NONE of these** - just deploys infrastructure baseline.

## Trade Validation Flow

Every swap:
1. Hook reads receiver.policy()
2. If halted → revert Halted()
3. If listing day → apply 5% band
4. Else → apply 20% normal band (default)
5. Check price in band → allow or revert OutOfBand()

**All three listings**: Trading OPEN, bands active, no halts.

## Configuration Verification

```bash
# After deploy, check receiver exists and is bound:
cast call $HOOK_ADDRESS "policySource()" --rpc-url $SEPOLIA_RPC_URL
# Should return receiver address

# Check initial policy (all zeros = open):
cast call $RECEIVER_ADDRESS "policy()" --rpc-url $SEPOLIA_RPC_URL
# Returns: (0,0,0,0,0,0,false,0,0) = all defaults, not halted

# Check listing day band:
cast call $HOOK_ADDRESS "listingDayBandBps()" --rpc-url $SEPOLIA_RPC_URL
# Should return 500 (0x01f4)
```

## Critical: No Automation Halts Demo

**Confirmed**:
- No CRE workflows running
- No automated policy sends
- No DemoHalt.s.sol execution planned
- Receiver accepts reports ONLY from broadcaster tx.origin
- Mock exchange NOT configured to send halt

**Trading stays OPEN** throughout demo unless explicitly halted (which we don't do).
