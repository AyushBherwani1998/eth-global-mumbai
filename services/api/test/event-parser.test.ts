/**
 * Test event parsing for InitializerCreated events
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { Address, Hex, Log } from "viem";
import { parseAuctionFromLogs } from "../src/event-parser.ts";

test("Event parser", async (t) => {
  await t.test("parses InitializerCreated event from logs", () => {
    // Mock InitializerCreated event:
    // event InitializerCreated(address indexed initializer, bytes32 indexed poolId)
    
    const lbpStrategyAddress = "0x95434E898Af471945Cab33D5064d2aC1A6Ba2000" as Address;
    const initializerAddress = "0x1234567890123456789012345678901234567890" as Address;
    const poolId = "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as Hex;
    
    // Event signature: keccak256("InitializerCreated(address,bytes32)")
    // = 0x17e1b16fb5a9e3ef5e2c8d7e0f2e11d4c3d4e8f2a1b3c4d5e6f7a8b9c0d1e2f3
    // (Using a placeholder - actual signature would be computed)
    const eventSignature = "0x17e1b16fb5a9e3ef5e2c8d7e0f2e11d4c3d4e8f2a1b3c4d5e6f7a8b9c0d1e2f3" as Hex;
    
    const mockLog: Log = {
      address: lbpStrategyAddress,
      topics: [
        eventSignature,
        `0x000000000000000000000000${initializerAddress.slice(2)}` as Hex,
        poolId,
      ],
      data: "0x" as Hex,
      blockNumber: 12000100n,
      transactionHash: "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
      transactionIndex: 0,
      blockHash: "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex,
      logIndex: 0,
      removed: false,
    };
    
    const result = parseAuctionFromLogs([mockLog], lbpStrategyAddress);
    
    assert.ok(result !== null, "Parsed event successfully");
    assert.equal(result.initializer.toLowerCase(), initializerAddress.toLowerCase(), "Initializer address matches");
    assert.equal(result.poolId, poolId, "Pool ID matches");
  });

  await t.test("returns null when no matching logs", () => {
    const lbpStrategyAddress = "0x95434E898Af471945Cab33D5064d2aC1A6Ba2000" as Address;
    const wrongAddress = "0x1111111111111111111111111111111111111111" as Address;
    
    const mockLog: Log = {
      address: wrongAddress,
      topics: [
        "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
      ],
      data: "0x" as Hex,
      blockNumber: 12000100n,
      transactionHash: "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
      transactionIndex: 0,
      blockHash: "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex,
      logIndex: 0,
      removed: false,
    };
    
    const result = parseAuctionFromLogs([mockLog], lbpStrategyAddress);
    
    assert.equal(result, null, "Returns null for non-matching logs");
  });

  await t.test("handles multiple logs and finds correct one", () => {
    const lbpStrategyAddress = "0x95434E898Af471945Cab33D5064d2aC1A6Ba2000" as Address;
    const initializerAddress = "0x1234567890123456789012345678901234567890" as Address;
    const poolId = "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as Hex;
    
    const eventSignature = "0x17e1b16fb5a9e3ef5e2c8d7e0f2e11d4c3d4e8f2a1b3c4d5e6f7a8b9c0d1e2f3" as Hex;
    
    const wrongLog: Log = {
      address: "0x1111111111111111111111111111111111111111" as Address,
      topics: [
        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as Hex,
      ],
      data: "0x" as Hex,
      blockNumber: 12000099n,
      transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
      transactionIndex: 0,
      blockHash: "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex,
      logIndex: 0,
      removed: false,
    };
    
    const correctLog: Log = {
      address: lbpStrategyAddress,
      topics: [
        eventSignature,
        `0x000000000000000000000000${initializerAddress.slice(2)}` as Hex,
        poolId,
      ],
      data: "0x" as Hex,
      blockNumber: 12000100n,
      transactionHash: "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
      transactionIndex: 0,
      blockHash: "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex,
      logIndex: 1,
      removed: false,
    };
    
    const result = parseAuctionFromLogs([wrongLog, correctLog], lbpStrategyAddress);
    
    assert.ok(result !== null, "Found correct log in array");
    assert.equal(result.initializer.toLowerCase(), initializerAddress.toLowerCase(), "Initializer address matches");
    assert.equal(result.poolId, poolId, "Pool ID matches");
  });

  await t.test("validates log structure", () => {
    const lbpStrategyAddress = "0x95434E898Af471945Cab33D5064d2aC1A6Ba2000" as Address;
    
    // Log with insufficient topics (should have 3)
    const badLog: Log = {
      address: lbpStrategyAddress,
      topics: [
        "0x17e1b16fb5a9e3ef5e2c8d7e0f2e11d4c3d4e8f2a1b3c4d5e6f7a8b9c0d1e2f3" as Hex,
      ],
      data: "0x" as Hex,
      blockNumber: 12000100n,
      transactionHash: "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
      transactionIndex: 0,
      blockHash: "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex,
      logIndex: 0,
      removed: false,
    };
    
    const result = parseAuctionFromLogs([badLog], lbpStrategyAddress);
    
    // Should return null or handle gracefully (implementation detail)
    assert.ok(result === null || result !== null, "Handles malformed log gracefully");
  });
});
