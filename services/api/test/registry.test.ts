/**
 * Test registry generation and app consumer compatibility
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Address, Hex } from "viem";

// Import registry functions
import { registerListing } from "../src/registry-integration.ts";

test("Registry", async (t) => {
  const testDir = "/tmp/test-registry";
  const testDataDir = join(testDir, "deployments", "sepolia");
  
  // Setup test directory
  t.before(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDataDir, { recursive: true });
  });
  
  t.after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  await t.test("registerListing creates valid JSON file", () => {
    const ticker = "TEST";
    const listing = {
      ticker,
      token: "0x1234567890123456789012345678901234567890" as Address,
      auction: "0x2345678901234567890123456789012345678901" as Address,
      hook: "0x3456789012345678901234567890123456789012" as Address,
      poolId: "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as Hex,
      policy: "0x4567890123456789012345678901234567890123" as Address,
      validationHook: "0x5678901234567890123456789012345678901234" as Address,
    };
    
    const filePath = join(testDataDir, `${ticker}.json`);
    registerListing(filePath, listing);
    
    const content = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);
    
    assert.equal(parsed.ticker, listing.ticker, "Ticker matches");
    assert.equal(parsed.token, listing.token, "Token address matches");
    assert.equal(parsed.auction, listing.auction, "Auction address matches");
    assert.equal(parsed.hook, listing.hook, "Hook address matches");
    assert.equal(parsed.poolId, listing.poolId, "Pool ID matches");
    assert.equal(parsed.policy, listing.policy, "Policy receiver matches");
    assert.equal(parsed.validationHook, listing.validationHook, "Validation hook matches");
  });

  await t.test("registry file is compatible with app parseDeployment", async () => {
    // This simulates what the app does when reading the registry
    const ticker = "DEMO";
    const listing = {
      ticker,
      token: "0xaaa1111111111111111111111111111111111111" as Address,
      auction: "0xbbb2222222222222222222222222222222222222" as Address,
      hook: "0xccc3333333333333333333333333333333333333" as Address,
      poolId: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as Hex,
      policy: "0xddd4444444444444444444444444444444444444" as Address,
      validationHook: "0xeee5555555555555555555555555555555555555" as Address,
    };
    
    const filePath = join(testDataDir, `${ticker}.json`);
    registerListing(filePath, listing);
    
    // Read and parse as the app would
    const content = readFileSync(filePath, "utf-8");
    const deployment = JSON.parse(content);
    
    // Verify app-expected structure
    assert.ok(deployment.ticker, "Has ticker field");
    assert.ok(deployment.token, "Has token field");
    assert.ok(deployment.auction, "Has auction field");
    assert.ok(deployment.hook, "Has hook field");
    assert.ok(deployment.poolId, "Has poolId field");
    assert.ok(deployment.policy, "Has policy field");
    assert.ok(deployment.validationHook, "Has validationHook field");
    
    // Verify addresses are valid hex strings
    assert.ok(deployment.token.startsWith("0x"), "Token is hex address");
    assert.ok(deployment.auction.startsWith("0x"), "Auction is hex address");
    assert.equal(deployment.token.length, 42, "Token address is 42 chars");
    assert.equal(deployment.auction.length, 42, "Auction address is 42 chars");
    assert.equal(deployment.poolId.length, 66, "Pool ID is 66 chars (32 bytes hex)");
  });

  await t.test("handles multiple listings in same directory", () => {
    const listings = [
      {
        ticker: "FIRST",
        token: "0x1111111111111111111111111111111111111111" as Address,
        auction: "0x2222222222222222222222222222222222222222" as Address,
        hook: "0x3333333333333333333333333333333333333333" as Address,
        poolId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex,
        policy: "0x4444444444444444444444444444444444444444" as Address,
        validationHook: "0x5555555555555555555555555555555555555555" as Address,
      },
      {
        ticker: "SECOND",
        token: "0x6666666666666666666666666666666666666666" as Address,
        auction: "0x7777777777777777777777777777777777777777" as Address,
        hook: "0x8888888888888888888888888888888888888888" as Address,
        poolId: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex,
        policy: "0x9999999999999999999999999999999999999999" as Address,
        validationHook: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address,
      },
    ];
    
    listings.forEach(listing => {
      const filePath = join(testDataDir, `${listing.ticker}.json`);
      registerListing(filePath, listing);
    });
    
    // Verify both files exist and are different
    const first = JSON.parse(readFileSync(join(testDataDir, "FIRST.json"), "utf-8"));
    const second = JSON.parse(readFileSync(join(testDataDir, "SECOND.json"), "utf-8"));
    
    assert.equal(first.ticker, "FIRST", "First ticker correct");
    assert.equal(second.ticker, "SECOND", "Second ticker correct");
    assert.notEqual(first.token, second.token, "Tokens are different");
    assert.notEqual(first.auction, second.auction, "Auctions are different");
  });

  await t.test("overwrites existing listing file", () => {
    const ticker = "UPDATE";
    const filePath = join(testDataDir, `${ticker}.json`);
    
    const original = {
      ticker,
      token: "0x1111111111111111111111111111111111111111" as Address,
      auction: "0x2222222222222222222222222222222222222222" as Address,
      hook: "0x3333333333333333333333333333333333333333" as Address,
      poolId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex,
      policy: "0x4444444444444444444444444444444444444444" as Address,
      validationHook: "0x5555555555555555555555555555555555555555" as Address,
    };
    
    const updated = {
      ticker,
      token: "0x9999999999999999999999999999999999999999" as Address,
      auction: "0x8888888888888888888888888888888888888888" as Address,
      hook: "0x7777777777777777777777777777777777777777" as Address,
      poolId: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as Hex,
      policy: "0x6666666666666666666666666666666666666666" as Address,
      validationHook: "0x5555555555555555555555555555555555555555" as Address,
    };
    
    registerListing(filePath, original);
    const firstContent = readFileSync(filePath, "utf-8");
    const firstParsed = JSON.parse(firstContent);
    assert.equal(firstParsed.token, original.token, "Original token written");
    
    registerListing(filePath, updated);
    const secondContent = readFileSync(filePath, "utf-8");
    const secondParsed = JSON.parse(secondContent);
    assert.equal(secondParsed.token, updated.token, "Updated token written");
    assert.notEqual(firstParsed.token, secondParsed.token, "Token was updated");
  });
});
