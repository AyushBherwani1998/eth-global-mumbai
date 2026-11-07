# Complete Listing Lifecycle - Browser & Script Compatibility

## Overview

A functional Thaamba Listing Day listing requires 8 steps:

1. Deploy MockSME token (CREATE2, address > USDC)
2. Deploy AllowAllModule
3. Deploy AuctionValidationHook (deployer must be issuer)
4. Deploy ListingHook (mined for correct permission flags)
5. Deploy ListingPolicyReceiver
6. **Hook.setPolicySource(receiver)** - Connect policy updates
7. **Create auction** via LiquidityLauncher - Enable trading
8. **ValidationHook.setAuction(auction)** - Bind validation

Steps 1-6 are implemented for browser wallet signing.

**Steps 7-8 are REQUIRED but complex** - they involve:
- Multiple approval transactions
- Complex multicall with nested structs
- Extracting auction address from event logs
- Time-sensitive binding (must happen before auction startBlock)

## Implementation Status

### ✅ Steps 1-6: Contract Deployment & Configuration
- Browser wallet signs each transaction
- API provides unsigned transaction data
- CREATE2 salt mining for token address
- Hook address mining for permission flags
- Nonce prediction for dependencies
- setPolicySource configuration

### ⚠️ Steps 7-8: Auction Creation & Binding

#### Current State
- Approval functions implemented (Permit2, LiquidityLauncher)
- Auction creation parameters defined matching DemoLaunch.s.sol
- setAuction binding function ready
- **Missing**: Complex struct encoding for distributeToken
- **Missing**: Event log parsing to extract auction address
- **Missing**: Browser orchestration for multi-transaction flow

#### Why Complex
The auction creation requires:

```solidity
// 1. Token approvals
token.approve(Permit2, type(uint256).max)
Permit2.approve(token, LiquidityLauncher, totalSupply, expiry)

// 2. Multicall with complex nested structs
LiquidityLauncher.multicall([
  abi.encodeCall(depositToken, (token, totalSupply)),
  abi.encodeCall(distributeToken, (token, distribution, salt))
])

// Where distribution contains:
Distribution({
  strategy: LBPStrategy,
  amount: totalSupply,
  configData: abi.encode(
    MigratorParameters({...}),
    abi.encode(AuctionParameters({...}))
  )
})

// 3. Extract auction address from InitializerCreated event
// 4. Bind before auction starts
validationHook.setAuction(auctionAddress)
```

The `configData` field contains doubly-nested ABI-encoded structs with 20+ fields total.

## Hook Permission Flags

The ListingHook requires these permission flags (from `getHookPermissions()`):

```solidity
Hooks.BEFORE_INITIALIZE_FLAG |
Hooks.AFTER_INITIALIZE_FLAG |
Hooks.BEFORE_SWAP_FLAG |
Hooks.AFTER_SWAP_FLAG
```

**NOT** `0x30C0` as previously assumed. The hook address is mined to have these exact flags in the low 16 bits.

## Registry Integration

Both browser-deployed and script-deployed listings must be registered in:
- `/data/deployments/sepolia/<ticker>.json` for browser deployments
- `deployments/sepolia/<ticker>.json` for script deployments

Format matches DemoDeploy.s.sol output:

```json
{
  "chainId": 11155111,
  "label": "acme-v1",
  "deployBlock": 123456,
  "deployer": "0x...",
  "issuer": "0x...",
  "treasury": "0x...",
  "creBroadcaster": "0x...",
  "external": { "usdc": "0x...", ... },
  "contracts": {
    "mockSME": "0x...",
    "allowAllModule": "0x...",
    "auctionValidationHook": "0x...",
    "listingHook": "0x...",
    "listingPolicyReceiver": "0x..."
  },
  "pool": { "poolId": "0x...", ... },
  "receiverConfig": { ... },
  "params": { "totalSupply": "110000000000000000000000", ... },
  "auction": { "address": "0x...", ... }
}
```

The app loads listings from both locations and displays them in the issuer console.

## Recommended Completion Approach

### Option A: Script-Based Auction Launch (Simplest)
After browser completes steps 1-6:
1. Export deployed addresses to environment
2. Run `forge script script/demo/DemoLaunch.s.sol` with issuer private key
3. Script handles auction creation complexity
4. Browser continues with post-auction steps

### Option B: Browser Multi-Step Flow (Full Browser Experience)
1. Add approval substeps (7a, 7b) before multicall
2. Implement full struct encoding for Distribution
3. Parse InitializerCreated event logs client-side
4. Store auction address, proceed to step 8
5. Requires significant browser-side complexity

### Option C: Hybrid Server-Assisted (Recommended)
1. Browser completes steps 1-6
2. API endpoint `/v1/listings/creation/:id/launch-auction` with signed request:
   - Server constructs multicall transaction
   - Returns unsigned transaction data
   - Browser signs and submits
   - Server monitors for InitializerCreated event
   - Auto-advances to step 8 when auction detected
3. Browser signs setAuction transaction
4. Registry registration happens automatically

## Constants (from ListingDay & ListingPrice)

```typescript
const TOTAL_SUPPLY = 110_000n * 10n**18n; // 110,000 shares
const AUCTION_SUPPLY = 90_000n * 10n**18n; // 90,000 auctioned
const LP_RESERVE = 20_000n * 10n**18n; // 20,000 for LP
const APPLICANT_CAP = 20n * 10n**6n; // 20 USDC per wallet
const REQUIRED_CURRENCY_RAISED = 45n * 10n**6n; // 45 USDC (50% of 90 target)

const FLOOR_PRICE_Q96 = 80n * 792_281_625_142n; // 80 points
const CAP_PRICE_Q96 = 190n * 792_281_625_142n; // 190 points
const TICK_SPACING_Q96 = 1n * 792_281_625_142n; // 1 point
const ONE_POINT_Q96 = 792_281_625_142n;

const POOL_FEE = 3000; // 0.3%
const POOL_TICK_SPACING = 60;
const LP_RATE_MPS = 2_000_000; // 20% of raise to LP
```

## Auction Schedule (Blocks)

Default from DemoLaunch.s.sol:
- START_DELAY_BLOCKS: 10 (~2 min on Sepolia)
- BID_WINDOW_BLOCKS: 30 (~6 min)
- CLEAR_BLOCKS: 20 (~4 min)

Must complete setAuction BEFORE startBlock or launch fails.

## Next Steps

To complete functional listing creation:

1. **Implement struct encoding** for Distribution/MigratorParameters/AuctionParameters
2. **Add event log parsing** to extract auction address from InitializerCreated
3. **Wire registry integration** to app deployment loading
4. **Test end-to-end** with browser wallet on local fork
5. **Document exact browser flow** with transaction sequence
6. **Add approval checks** before multicall (token balance, Permit2 allowance)
7. **Handle timing** to ensure setAuction completes before startBlock

## Security Considerations

- Auction creation deploys a CCA contract - gas costs ~3-5M
- Issuer must hold full TOTAL_SUPPLY before launch
- Approvals are permanent (type(uint256).max) - document clearly
- setAuction can only be called by issuer (AuctionValidationHook.deployer check)
- Auction parameters are immutable once created
- Wrong parameters = need new listing with different ticker
