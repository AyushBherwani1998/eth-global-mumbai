import { strict as assert } from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import { existsSync, unlinkSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ListingCreationStorage } from "../src/listing-creation.ts";

describe("ListingCreationStorage", () => {
  const testDir = join(tmpdir(), `listing-creation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const testPath = join(testDir, "test-state.json");
  let storage: ListingCreationStorage;

  beforeEach(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    storage = new ListingCreationStorage(testPath);
  });

  afterEach(() => {
    try {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    } catch (e) {
      // Ignore cleanup errors in tests
    }
  });

  describe("create", () => {
    it("should create a new listing creation state", () => {
      const listing = storage.create({
        ticker: "TEST",
        tokenName: "Test Token",
        tokenSymbol: "TEST",
        issuerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      });

      assert.ok(listing.id);
      assert.strictEqual(listing.ticker, "test");
      assert.strictEqual(listing.tokenName, "Test Token");
      assert.strictEqual(listing.tokenSymbol, "TEST");
      assert.strictEqual(listing.phase, "pending_token");
    });

    it("should persist to disk", () => {
      storage.create({
        ticker: "TEST",
        tokenName: "Test Token",
        tokenSymbol: "TEST",
        issuerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      });

      assert.ok(existsSync(testPath));
      
      // Create new storage instance and verify data persists
      const newStorage = new ListingCreationStorage(testPath);
      const listings = newStorage.list();
      assert.strictEqual(listings.length, 1);
    });
  });

  describe("update", () => {
    it("should update listing state", () => {
      const listing = storage.create({
        ticker: "TEST",
        tokenName: "Test Token",
        tokenSymbol: "TEST",
        issuerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      });

      const updated = storage.update(listing.id, {
        phase: "token_deployed",
        tokenAddress: "0x1234567890123456789012345678901234567890",
        tokenDeployTx: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      });

      assert.strictEqual(updated.phase, "token_deployed");
      assert.strictEqual(updated.tokenAddress, "0x1234567890123456789012345678901234567890");
      assert.ok(updated.updatedAt > listing.updatedAt);
    });

    it("should throw on non-existent listing", () => {
      assert.throws(() => {
        storage.update("nonexistent", { phase: "error" });
      }, /not found/);
    });
  });

  describe("get", () => {
    it("should retrieve listing by id", () => {
      const created = storage.create({
        ticker: "TEST",
        tokenName: "Test Token",
        tokenSymbol: "TEST",
        issuerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      });

      const retrieved = storage.get(created.id);
      assert.ok(retrieved);
      assert.strictEqual(retrieved.id, created.id);
    });

    it("should return null for non-existent listing", () => {
      const result = storage.get("nonexistent");
      assert.strictEqual(result, null);
    });
  });

  describe("getByTicker", () => {
    it("should find listings by ticker", () => {
      storage.create({
        ticker: "TEST",
        tokenName: "Test Token 1",
        tokenSymbol: "TEST",
        issuerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      });

      storage.create({
        ticker: "TEST",
        tokenName: "Test Token 2",
        tokenSymbol: "TEST",
        issuerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      });

      storage.create({
        ticker: "OTHER",
        tokenName: "Other Token",
        tokenSymbol: "OTHER",
        issuerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      });

      const testListings = storage.getByTicker("TEST");
      assert.strictEqual(testListings.length, 2);
    });
  });

  describe("getByIssuer", () => {
    it("should find listings by issuer address", () => {
      const issuer1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const issuer2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

      storage.create({
        ticker: "TEST1",
        tokenName: "Test Token 1",
        tokenSymbol: "TEST1",
        issuerAddress: issuer1 as `0x${string}`,
      });

      storage.create({
        ticker: "TEST2",
        tokenName: "Test Token 2",
        tokenSymbol: "TEST2",
        issuerAddress: issuer1 as `0x${string}`,
      });

      storage.create({
        ticker: "TEST3",
        tokenName: "Test Token 3",
        tokenSymbol: "TEST3",
        issuerAddress: issuer2 as `0x${string}`,
      });

      const issuer1Listings = storage.getByIssuer(issuer1 as `0x${string}`);
      assert.strictEqual(issuer1Listings.length, 2);

      const issuer2Listings = storage.getByIssuer(issuer2 as `0x${string}`);
      assert.strictEqual(issuer2Listings.length, 1);
    });
  });

  describe("delete", () => {
    it("should delete a listing", () => {
      const listing = storage.create({
        ticker: "TEST",
        tokenName: "Test Token",
        tokenSymbol: "TEST",
        issuerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      });

      const deleted = storage.delete(listing.id);
      assert.ok(deleted);

      const retrieved = storage.get(listing.id);
      assert.strictEqual(retrieved, null);
    });

    it("should return false for non-existent listing", () => {
      const deleted = storage.delete("nonexistent");
      assert.ok(!deleted);
    });
  });
});
