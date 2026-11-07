/**
 * Registry integration tests
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Address } from "viem";

// Import registry functions
import { registerListing, type DeployedListing } from "../src/registry-integration.ts";

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
    const listing: Record<string, unknown> = {
      label: ticker,
      chainId: 11155111,
    };
    
    const filePath = join(testDataDir, `${ticker}.json`);
    registerListing(filePath, listing as Partial<DeployedListing>);
    
    const content = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);
    
    assert.equal(parsed.label, listing.label, "Label matches");
    assert.equal(parsed.chainId, listing.chainId, "ChainId matches");
  });

  await t.test("registry file is compatible with app parseDeployment", async () => {
    // This simulates what the app does when reading the registry
    const ticker = "DEMO";
    const listing: Record<string, unknown> = {
      label: ticker,
      chainId: 11155111,
    };
    
    const filePath = join(testDataDir, `${ticker}.json`);
    registerListing(filePath, listing as Partial<DeployedListing>);
    
    // Read and parse as the app would
    const content = readFileSync(filePath, "utf-8");
    const deployment = JSON.parse(content);
    
    // Verify app-expected structure
    assert.equal(deployment.label, ticker, "Label accessible");
    assert.equal(deployment.chainId, 11155111, "ChainId accessible");
  });

  await t.test("can update listing with auction data", async () => {
    const listing: Record<string, unknown> = {
      label: "TEST2",
      chainId: 11155111,
    };
    
    const filePath = join(testDataDir, `${listing.label}.json`);
    registerListing(filePath, listing as Partial<DeployedListing>);
    
    // Update auction data
    const auctionData = {
      address: "0xa234567890123456789012345678901234567890" as Address,
      startBlock: 1000,
      endBlock: 2000,
    };
    const updated: Record<string, unknown> = { ...listing, auctionExtra: auctionData };
    registerListing(filePath, updated as Partial<DeployedListing>);
    
    const content = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);
    
    assert.deepEqual(parsed.auctionExtra, auctionData, "Auction data updated");
    assert.equal(parsed.label, listing.label, "Original data preserved");
  });

  await t.test("registerListing creates separate files per listing", async () => {
    const listings = [
      {
        label: "FIRST",
        chainId: 11155111,
      },
      {
        label: "SECOND",
        chainId: 11155111,
      },
    ];
    
    listings.forEach(listing => {
      const filePath = join(testDataDir, `${listing.label}.json`);
      registerListing(filePath, listing as Partial<DeployedListing>);
    });
    
    // Verify both files exist and are different
    const first = JSON.parse(readFileSync(join(testDataDir, "FIRST.json"), "utf-8"));
    const second = JSON.parse(readFileSync(join(testDataDir, "SECOND.json"), "utf-8"));
    
    assert.notEqual(first.label, second.label, "Different labels");
  });

  await t.test("registerListing overwrites existing file", async () => {
    const filePath = join(testDataDir, "OVERWRITE.json");
    const original: Record<string, unknown> = {
      label: "OVERWRITE",
      chainId: 11155111,
      deployBlock: 1000,
    };
    
    registerListing(filePath, original as Partial<DeployedListing>);
    const firstContent = readFileSync(filePath, "utf-8");
    const firstParsed = JSON.parse(firstContent);
    assert.equal(firstParsed.deployBlock, original.deployBlock, "Original deployBlock written");
    
    const updated: Record<string, unknown> = {
      label: "OVERWRITE",
      chainId: 11155111,
      deployBlock: 2000,
    };
    registerListing(filePath, updated as Partial<DeployedListing>);
    const secondContent = readFileSync(filePath, "utf-8");
    const secondParsed = JSON.parse(secondContent);
    
    assert.equal(secondParsed.deployBlock, updated.deployBlock, "deployBlock overwritten");
    assert.notEqual(secondParsed.deployBlock, original.deployBlock, "Original deployBlock replaced");
  });
});
