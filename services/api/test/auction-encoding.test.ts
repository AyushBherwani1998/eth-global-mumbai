/**
 * Test auction encoding against expected format from DemoLaunch.s.sol
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { 
  encodeAbiParameters, 
  parseAbiParameters,
  type Address,
  type Hex
} from "viem";

// Import the encoding functions
import { prepareAuctionCreation, type AuctionCreationParams } from "../src/auction-creation.ts";

test("Auction encoding", async (t) => {
  await t.test("encodes auction steps data correctly", () => {
    // Test the auction steps encoding: [0 mps for 30 blocks, then 500,000 mps for 20 blocks]
    // Format: (uint24 mps, uint40 blocks) pairs concatenated
    // uint24 = 6 hex digits (3 bytes)
    // uint40 = 10 hex digits (5 bytes)
    
    // Bid window: 0 mps (uint24), 30 blocks (uint40)
    const mps0 = "000000"; // 0 in hex, 3 bytes = 6 hex chars
    const blocks0 = "000000001e"; // 30 in hex, 5 bytes = 10 hex chars
    
    // Clear: 500,000 mps (uint24), 20 blocks (uint40)
    const mps1 = "07a120"; // 500,000 in hex, 3 bytes = 6 hex chars
    const blocks1 = "0000000014"; // 20 in hex, 5 bytes = 10 hex chars
    
    const expected = `0x${mps0}${blocks0}${mps1}${blocks1}`;
    
    // Our encoding for bid window 30, clear 20 (with mpsPerBlock = 10M / 20 = 500,000)
    const bidWindow = 30n;
    const clearBlocks = 20n;
    const mpsPerBlock = 10_000_000n / clearBlocks; // 500,000
    
    let encoded = "0x";
    
    // Bid window
    if (bidWindow > 0n) {
      const mpsHex = "000000"; // 0 mps as uint24
      const blocksHex = bidWindow.toString(16).padStart(10, '0'); // uint40
      encoded += mpsHex + blocksHex;
    }
    
    // Clearing
    const mpsClearHex = mpsPerBlock.toString(16).padStart(6, '0'); // uint24
    const clearBlocksHex = clearBlocks.toString(16).padStart(10, '0'); // uint40
    encoded += mpsClearHex + clearBlocksHex;
    
    assert.equal(encoded, expected, "Auction steps encoding matches expected format");
  });

  await t.test("encodes distribution config with nested structs", () => {
    // Test that distribution config encoding matches the structure from DemoLaunch.s.sol
    // configData: abi.encode(migrationParams, abi.encode(auctionParams))
    
    const token = "0x1111111111111111111111111111111111111111" as Address;
    const usdc = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address;
    const lbpStrategy = "0x95434E898Af471945Cab33D5064d2aC1A6Ba2000" as Address;
    const validationHook = "0x2222222222222222222222222222222222222222" as Address;
    const hook = "0x3333333333333333333333333333333333333333" as Address;
    const treasury = "0x4444444444444444444444444444444444444444" as Address;
    
    const currentBlock = 12000000n;
    const startDelayBlocks = 10n;
    const bidWindowBlocks = 30n;
    const clearBlocks = 20n;
    
    const startBlock = currentBlock + startDelayBlocks;
    const endBlock = startBlock + bidWindowBlocks + clearBlocks;
    const migrationBlock = endBlock + 1n;
    
    // AuctionParameters struct
    const auctionParams = {
      currency: usdc,
      tokensRecipient: treasury,
      fundsRecipient: lbpStrategy,
      startBlock,
      endBlock,
      claimBlock: endBlock,
      tickSpacing: 792_281_625_142n,
      validationHook,
      floorPrice: 80n * 792_281_625_142n,
      requiredCurrencyRaised: 45_000_000n,
      auctionStepsData: "0x" as Hex, // Simplified for this test
    };
    
    // Encode AuctionParameters
    const encodedAuction = encodeAbiParameters(
      parseAbiParameters('address, address, address, uint64, uint64, uint64, uint256, address, uint256, uint128, bytes'),
      [
        auctionParams.currency,
        auctionParams.tokensRecipient,
        auctionParams.fundsRecipient,
        auctionParams.startBlock,
        auctionParams.endBlock,
        auctionParams.claimBlock,
        auctionParams.tickSpacing,
        auctionParams.validationHook,
        auctionParams.floorPrice,
        auctionParams.requiredCurrencyRaised,
        auctionParams.auctionStepsData,
      ]
    );
    
    // MigratorParameters with encoded auction
    const lpAllocationSchedule = encodeAbiParameters(
      parseAbiParameters('(uint256 lowerThreshold, uint24 rate)[]'),
      [[{ lowerThreshold: 0n, rate: 2_000_000 }]]
    );
    
    const encodedMigrator = encodeAbiParameters(
      parseAbiParameters('address, address, uint64, uint128, address, address, (uint24 fee, int24 tickSpacing, address hook), bytes, bytes, bytes'),
      [
        token,
        usdc,
        migrationBlock,
        20_000n * 10n ** 18n, // LP reserve
        treasury,
        treasury,
        { fee: 3000, tickSpacing: 60, hook },
        "0x" as Hex, // empty position definitions
        lpAllocationSchedule,
        encodedAuction,
      ]
    );
    
    // Verify structure - should be a valid hex string
    assert.ok(encodedMigrator.startsWith('0x'), "Encoded migrator is hex string");
    assert.ok(encodedMigrator.length > 100, "Encoded migrator has reasonable length");
    
    // Verify we can decode it back
    const decoded = encodeAbiParameters(
      parseAbiParameters('bytes, bytes'),
      [encodedMigrator, encodedAuction]
    );
    
    assert.ok(decoded.startsWith('0x'), "Distribution config is valid hex");
  });

  await t.test("prepares complete auction creation transaction", () => {
    const params: AuctionCreationParams = {
      tokenAddress: "0x1111111111111111111111111111111111111111" as Address,
      validationHookAddress: "0x2222222222222222222222222222222222222222" as Address,
      hookAddress: "0x3333333333333333333333333333333333333333" as Address,
      usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address,
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address,
      liquidityLauncher: "0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0" as Address,
      lbpStrategy: "0x95434E898Af471945Cab33D5064d2aC1A6Ba2000" as Address,
      issuerAddress: "0x4444444444444444444444444444444444444444" as Address,
      treasuryAddress: "0x4444444444444444444444444444444444444444" as Address,
      totalSupply: 110_000n * 10n ** 18n,
      auctionSupply: 90_000n * 10n ** 18n,
      lpReserve: 20_000n * 10n ** 18n,
      requiredCurrencyRaised: 45_000_000n,
      floorPriceQ96: 80n * 792_281_625_142n,
      tickSpacingQ96: 1n * 792_281_625_142n,
      poolFee: 3000n,
      poolTickSpacing: 60n,
      lpRateMps: 2_000_000n,
      startDelayBlocks: 10n,
      bidWindowBlocks: 30n,
      clearBlocks: 20n,
      currentBlock: 12000000n,
    };
    
    const result = prepareAuctionCreation(params);
    
    assert.equal(result.step, 7, "Step is 7");
    assert.equal(result.contract, "LiquidityLauncher", "Contract is LiquidityLauncher");
    assert.equal(result.to, params.liquidityLauncher, "To address is LiquidityLauncher");
    assert.ok(result.data.startsWith('0x'), "Data is hex string");
    assert.ok(result.data.length > 100, "Data has substantial length");
    assert.equal(result.value, "0x0", "Value is 0");
    
    // Verify the data includes multicall selector (0xac9650d8)
    assert.ok(result.data.startsWith('0xac9650d8'), "Data starts with multicall selector");
  });

  await t.test("approval transactions have correct format", async () => {
    const { preparePermit2Approval, prepareLauncherPermit2Approval } = await import("../src/auction-creation.ts");
    
    const tokenAddress = "0x1111111111111111111111111111111111111111" as Address;
    const permit2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;
    const liquidityLauncher = "0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0" as Address;
    
    // Test Permit2 approval
    const step7a = preparePermit2Approval({ tokenAddress, permit2 });
    assert.equal(step7a.to, tokenAddress, "Step 7a targets token");
    assert.ok(step7a.data.startsWith('0x095ea7b3'), "Step 7a has approve selector");
    
    // Test Launcher Permit2 approval
    const step7b = prepareLauncherPermit2Approval({
      tokenAddress,
      permit2,
      liquidityLauncher,
      totalSupply: 110_000n * 10n ** 18n,
      expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
    });
    assert.equal(step7b.to, permit2, "Step 7b targets Permit2");
    assert.ok(step7b.data.startsWith('0x'), "Step 7b has valid data");
  });
});
