# Listing Creation Deployment Setup

## Overview

Browser-wallet-based listing creation is **fully implemented** with 5-step deployment orchestration. The only remaining prerequisite is committing compiled bytecode artifacts.

## Architecture

✅ **Browser wallet** signs all deployment transactions (NO server keys)  
✅ **API** provides unsigned transaction data with constructor args  
✅ **Sequential coordination** handles address dependencies  
✅ **CREATE2 salt mining** for MockSME > USDC  
✅ **Hook address mining** for flags 0x30C0  
✅ **State persistence** and restart-safe tracking  

## One-Time Setup (Development/Build Time)

### 1. Compile Contracts and Extract Bytecode

The bytecode artifacts need to be committed to the repository. Run this once:

```bash
# Start local Anvil fork
anvil --fork-url $SEPOLIA_RPC_URL --port 8545

# In another terminal, run deployment script to generate broadcast artifacts
cd contracts
forge script script/demo/DemoDeploy.s.sol --fork-url http://localhost:8545

# Extract bytecode from broadcast artifacts
cd ../services/api
node scripts/extract-bytecode.mjs

# Commit the extracted bytecode
git add src/bytecode/*.json
git commit -m "chore: add compiled contract bytecode artifacts"
```

This extracts deployment bytecode from the forge broadcast and commits it as static artifacts.

### 2. Alternative: Manual Bytecode Extraction

If forge is unavailable, bytecode can be extracted from existing deployed contracts:

```bash
# Get bytecode from deployed contract
cast code <DEPLOYED_CONTRACT_ADDRESS> --rpc-url $SEPOLIA_RPC_URL > bytecode.txt

# Or from Etherscan
curl "https://api-sepolia.etherscan.io/api?module=contract&action=getabi&address=<ADDRESS>"
```

## Runtime Usage (After Bytecode Committed)

### API Start

```bash
cd services/api
npm install
export SEPOLIA_RPC_URL=<your-rpc>
export ISSUER_ADDRESSES=0x...
npm start
```

### Browser Flow

1. User fills in listing form (ticker, name, symbol)
2. User signs authorization message
3. API creates listing record
4. Browser calls `GET /v1/listings/creation/:id/next-step` (Step 1: MockSME)
5. Browser wallet signs deployment transaction
6. Browser submits `POST /v1/listings/creation/:id/submit-tx` with tx hash
7. API waits for receipt, extracts contract address
8. Repeat steps 4-7 for Steps 2-5 (Module, ValidationHook, Hook, Receiver)
9. Listing marked complete

### Deployment Steps

1. **MockSME** (CREATE2, salted for address > USDC)
2. **AllowAllModule** (requires predicted ValidationHook address)
3. **AuctionValidationHook** (requires Module + Token addresses)
4. **ListingHook** (requires mined address with flags 0x30C0)
5. **ListingPolicyReceiver** (independent)

## Post-Deployment Configuration

After all 5 contracts deployed, additional setup needed:

### 6. Set Policy Source

```typescript
// Hook.setPolicySource(receiver)
await hook.write.setPolicySource([receiverAddress]);
```

### 7. Create Auction (Optional)

```typescript
// Deploy auction via LiquidityLauncher
// This binds ValidationHook and configures pricing
```

These steps can be added to the orchestrator or done manually per the existing scripts.

## Files

### Implementation
- `services/api/src/deployment-complete.ts` - 5-step orchestration logic
- `services/api/src/deployment-utils.ts` - State tracking helpers
- `app/src/components/console/deploy-orchestrator.ts` - Browser coordinator
- `app/src/components/console/create-listing.tsx` - UI integration

### API Endpoints
- `POST /v1/listings/create` - Initiate listing creation
- `GET /v1/listings/creation/:id/next-step` - Get next unsigned deployment tx
- `POST /v1/listings/creation/:id/submit-tx` - Submit signed tx hash
- `GET /v1/listings/creation/:id` - Check deployment status

### Bytecode (To be committed)
- `services/api/src/bytecode/MockSME.json`
- `services/api/src/bytecode/AllowAllModule.json`
- `services/api/src/bytecode/AuctionValidationHook.json`
- `services/api/src/bytecode/ListingHook.json`
- `services/api/src/bytecode/ListingPolicyReceiver.json`

## Testing Locally

```bash
# Terminal 1: Start Anvil fork
anvil --fork-url $SEPOLIA_RPC_URL

# Terminal 2: Run extraction (one-time)
cd services/api && node scripts/extract-bytecode.mjs

# Terminal 3: Start API
cd services/api && npm start

# Terminal 4: Start app
cd app && pnpm dev

# Browser: Connect wallet, navigate to issuer console, create listing
```

## Security Notes

- ✅ Browser wallet pays for all deployments
- ✅ Server has NO deployment private keys
- ✅ Policy relayer key is separate (only for policy relay)
- ✅ Bytecode committed as static artifacts (no runtime compilation)
- ✅ All transactions signed by browser wallet
- ✅ API only coordinates and validates

## Current Status

**Architecture**: ✅ Complete  
**5-Step Orchestration**: ✅ Implemented  
**Browser Integration**: ✅ Implemented  
**API Coordination**: ✅ Implemented  
**Bytecode Artifacts**: ⚠️ Need one-time extraction & commit  
**Post-Deploy Config**: ⚠️ setPolicySource & auction creation not yet wired  

**Ready for flow testing after bytecode extraction.**
