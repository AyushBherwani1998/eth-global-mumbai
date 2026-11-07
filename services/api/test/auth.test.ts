import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadAuthConfig, verifySignedRequest, isAuthorizedIssuer } from "../src/auth.ts";

const ISSUER1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // Valid checksummed address
const ISSUER2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"; // Valid checksummed address  
const UNAUTHORIZED = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"; // Valid checksummed address

const testKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const testAccount = privateKeyToAccount(testKey);

describe("Auth", () => {
  describe("loadAuthConfig", () => {
    it("should load comma-separated issuer addresses", () => {
      const config = loadAuthConfig({
        ISSUER_ADDRESSES: `${ISSUER1},${ISSUER2}`,
      });
      
      assert.strictEqual(config.allowedIssuers.length, 2);
      assert.ok(config.allowedIssuers.includes(getAddress(ISSUER1)));
      assert.ok(config.allowedIssuers.includes(getAddress(ISSUER2)));
    });

    it("should support legacy ISSUER_ADDRESS", () => {
      const config = loadAuthConfig({
        ISSUER_ADDRESS: ISSUER1,
      });
      
      assert.strictEqual(config.allowedIssuers.length, 1);
      assert.ok(config.allowedIssuers.includes(getAddress(ISSUER1)));
    });

    it("should merge ISSUER_ADDRESSES and ISSUER_ADDRESS", () => {
      const config = loadAuthConfig({
        ISSUER_ADDRESSES: ISSUER1,
        ISSUER_ADDRESS: ISSUER2,
      });
      
      assert.strictEqual(config.allowedIssuers.length, 2);
    });

    it("should throw on invalid addresses", () => {
      assert.throws(() => {
        loadAuthConfig({
          ISSUER_ADDRESSES: "not-an-address",
        });
      });
    });
  });

  describe("isAuthorizedIssuer", () => {
    it("should return true for authorized addresses", () => {
      const config = loadAuthConfig({ ISSUER_ADDRESSES: ISSUER1 });
      assert.ok(isAuthorizedIssuer(ISSUER1 as `0x${string}`, config));
    });

    it("should return false for unauthorized addresses", () => {
      const config = loadAuthConfig({ ISSUER_ADDRESSES: ISSUER1 });
      assert.ok(!isAuthorizedIssuer(UNAUTHORIZED as `0x${string}`, config));
    });

    it("should be case-insensitive", () => {
      const config = loadAuthConfig({ ISSUER_ADDRESSES: ISSUER1 });
      assert.ok(isAuthorizedIssuer(ISSUER1.toLowerCase() as `0x${string}`, config));
    });
  });

  describe("verifySignedRequest", () => {
    it("should reject expired signatures", async () => {
      const config = loadAuthConfig({ 
        ISSUER_ADDRESSES: testAccount.address,
        MAX_SIGNATURE_AGE: "60",
      });

      const oldTimestamp = Math.floor(Date.now() / 1000) - 120; // 2 minutes ago
      const nonce = `${oldTimestamp}_test123`;
      const payload = { test: "data" };
      const payloadHash = "0x" + Buffer.from(JSON.stringify(payload)).toString("hex");
      
      const message = JSON.stringify({
        domain: "listing-day.api",
        action: "test_action",
        chainId: 11155111,
        timestamp: oldTimestamp,
        nonce,
        ticker: null,
        payloadHash,
      });

      const signature = await testAccount.signMessage({ message });

      await assert.rejects(
        async () => {
          await verifySignedRequest(
            {
              domain: "listing-day.api",
              action: "test_action",
              chainId: 11155111,
              timestamp: oldTimestamp,
              nonce,
              payload,
              signature,
            },
            config,
            11155111
          );
        },
        /expired/i
      );
    });

    it("should reject future timestamps", async () => {
      const config = loadAuthConfig({ ISSUER_ADDRESSES: testAccount.address });
      
      const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;
      const nonce = `${futureTimestamp}_test123`;
      const payload = { test: "data" };
      const payloadHash = "0x" + Buffer.from(JSON.stringify(payload)).toString("hex");
      
      const message = JSON.stringify({
        domain: "listing-day.api",
        action: "test_action",
        chainId: 11155111,
        timestamp: futureTimestamp,
        nonce,
        ticker: null,
        payloadHash,
      });

      const signature = await testAccount.signMessage({ message });

      await assert.rejects(
        async () => {
          await verifySignedRequest(
            {
              domain: "listing-day.api",
              action: "test_action",
              chainId: 11155111,
              timestamp: futureTimestamp,
              nonce,
              payload,
              signature,
            },
            config,
            11155111
          );
        },
        /future/i
      );
    });

    it("should reject wrong chain ID", async () => {
      const config = loadAuthConfig({ ISSUER_ADDRESSES: testAccount.address });
      
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = `${timestamp}_test123`;
      const payload = { test: "data" };
      const payloadHash = "0x" + Buffer.from(JSON.stringify(payload)).toString("hex");
      
      const message = JSON.stringify({
        domain: "listing-day.api",
        action: "test_action",
        chainId: 1, // Mainnet
        timestamp,
        nonce,
        ticker: null,
        payloadHash,
      });

      const signature = await testAccount.signMessage({ message });

      await assert.rejects(
        async () => {
          await verifySignedRequest(
            {
              domain: "listing-day.api",
              action: "test_action",
              chainId: 1,
              timestamp,
              nonce,
              payload,
              signature,
            },
            config,
            11155111 // Expecting Sepolia
          );
        },
        /chain id/i
      );
    });

    it("should reject unauthorized signers", async () => {
      const config = loadAuthConfig({ ISSUER_ADDRESSES: ISSUER1 });
      
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = `${timestamp}_test123`;
      const payload = { test: "data" };
      const payloadHash = "0x" + Buffer.from(JSON.stringify(payload)).toString("hex");
      
      const message = JSON.stringify({
        domain: "listing-day.api",
        action: "test_action",
        chainId: 11155111,
        timestamp,
        nonce,
        ticker: null,
        payloadHash,
      });

      const signature = await testAccount.signMessage({ message });

      await assert.rejects(
        async () => {
          await verifySignedRequest(
            {
              domain: "listing-day.api",
              action: "test_action",
              chainId: 11155111,
              timestamp,
              nonce,
              payload,
              signature,
            },
            config,
            11155111
          );
        },
        /not authorized/i
      );
    });

    it("should accept valid signed requests", async () => {
      const config = loadAuthConfig({ ISSUER_ADDRESSES: testAccount.address });
      
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = `${timestamp}_test123`;
      const payload = { test: "data" };
      const payloadHash = "0x" + Buffer.from(JSON.stringify(payload)).toString("hex");
      
      const message = JSON.stringify({
        domain: "listing-day.api",
        action: "test_action",
        chainId: 11155111,
        timestamp,
        nonce,
        ticker: null,
        payloadHash,
      });

      const signature = await testAccount.signMessage({ message });

      const recoveredAddress = await verifySignedRequest(
        {
          domain: "listing-day.api",
          action: "test_action",
          chainId: 11155111,
          timestamp,
          nonce,
          payload,
          signature,
        },
        config,
        11155111
      );

      assert.strictEqual(recoveredAddress, testAccount.address);
    });
    
    it("should reject replay attacks (same nonce twice)", async () => {
      const config = loadAuthConfig({ ISSUER_ADDRESSES: testAccount.address });
      const nonceStore = new (await import("../src/auth.ts")).NonceStore();
      
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = `${timestamp}_test123`;
      const payload = { test: "data" };
      const payloadHash = "0x" + Buffer.from(JSON.stringify(payload)).toString("hex");
      
      const message = JSON.stringify({
        domain: "listing-day.api",
        action: "test_action",
        chainId: 11155111,
        timestamp,
        nonce,
        ticker: null,
        payloadHash,
      });

      const signature = await testAccount.signMessage({ message });
      
      const request = {
        domain: "listing-day.api",
        action: "test_action",
        chainId: 11155111,
        timestamp,
        nonce,
        payload,
        signature,
      };

      // First request should succeed
      await verifySignedRequest(request, config, 11155111, nonceStore);

      // Second request with same nonce should fail
      await assert.rejects(
        async () => {
          await verifySignedRequest(request, config, 11155111, nonceStore);
        },
        /nonce already used|replay/i
      );
    });
  });
});
