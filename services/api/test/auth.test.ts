import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { getAddress, keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadAuthConfig, verifySignedRequest, isAuthorizedIssuer } from "../src/auth.ts";

const ISSUER1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // Valid checksummed address
const ISSUER2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"; // Valid checksummed address  
const UNAUTHORIZED = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"; // Valid checksummed address

const testKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const testAccount = privateKeyToAccount(testKey);
const testAccountAddr = getAddress(testAccount.address); // Ensure checksummed

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
        ISSUER_ADDRESSES: testAccountAddr,
        MAX_SIGNATURE_AGE: "60",
      });

      const oldTimestamp = Math.floor(Date.now() / 1000) - 120; // 2 minutes ago
      const nonce = `${oldTimestamp}_test123`;
      const payload = { test: "data" };
      const payloadHash = keccak256(toHex(JSON.stringify(payload)));
      
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
      const config = loadAuthConfig({ ISSUER_ADDRESSES: testAccountAddr });
      
      const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;
      const nonce = `${futureTimestamp}_test123`;
      const payload = { test: "data" };
      const payloadHash = keccak256(toHex(JSON.stringify(payload)));
      
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
      const config = loadAuthConfig({ ISSUER_ADDRESSES: testAccountAddr });
      
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = `${timestamp}_test123`;
      const payload = { test: "data" };
      const payloadHash = keccak256(toHex(JSON.stringify(payload)));
      
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
      const payloadHash = keccak256(toHex(JSON.stringify(payload)));
      
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
      const config = loadAuthConfig({ ISSUER_ADDRESSES: testAccountAddr });
      
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = `${timestamp}_test123`;
      const payload = { test: "data" };
      const payloadHash = keccak256(toHex(JSON.stringify(payload)));
      
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

      assert.strictEqual(recoveredAddress, testAccountAddr);
    });
    
    it("should reject replay attacks (same nonce twice)", async () => {
      const config = loadAuthConfig({ ISSUER_ADDRESSES: testAccountAddr });
      const nonceStore = new (await import("../src/auth.ts")).NonceStore();
      
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = `${timestamp}_test123`;
      const payload = { test: "data" };
      const payloadHash = keccak256(toHex(JSON.stringify(payload)));
      
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

    it("should prevent cross-action replay (same nonce, different action)", async () => {
      const config = loadAuthConfig({ ISSUER_ADDRESSES: testAccountAddr });
      const nonceStore = new (await import("../src/auth.ts")).NonceStore();
      
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = `${timestamp}_crossaction`;
      const payload = { test: "data" };
      const payloadHash = keccak256(toHex(JSON.stringify(payload)));
      
      // Sign for action1
      const message1 = JSON.stringify({
        domain: "listing-day.api",
        action: "create_listing",
        chainId: 11155111,
        timestamp,
        nonce,
        ticker: null,
        payloadHash,
      });
      const signature1 = await testAccount.signMessage({ message: message1 });
      
      const request1 = {
        domain: "listing-day.api",
        action: "create_listing",
        chainId: 11155111,
        timestamp,
        nonce,
        payload,
        signature: signature1,
      };

      // First request succeeds
      await verifySignedRequest(request1, config, 11155111, nonceStore);

      // Try to replay with different action but same nonce - should fail (nonce consumed)
      const message2 = JSON.stringify({
        domain: "listing-day.api",
        action: "relay_policy",
        chainId: 11155111,
        timestamp,
        nonce,
        ticker: null,
        payloadHash,
      });
      const signature2 = await testAccount.signMessage({ message: message2 });
      
      const request2 = {
        domain: "listing-day.api",
        action: "relay_policy",
        chainId: 11155111,
        timestamp,
        nonce,
        payload,
        signature: signature2,
      };

      await assert.rejects(
        async () => {
          await verifySignedRequest(request2, config, 11155111, nonceStore);
        },
        /nonce already used|replay/i
      );
    });

    it("should prevent cross-chain replay (same nonce, different chain)", async () => {
      const config = loadAuthConfig({ ISSUER_ADDRESSES: testAccountAddr });
      const nonceStore = new (await import("../src/auth.ts")).NonceStore();
      
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = `${timestamp}_crosschain`;
      const payload = { test: "data" };
      const payloadHash = keccak256(toHex(JSON.stringify(payload)));
      
      // Sign for chain 11155111
      const message1 = JSON.stringify({
        domain: "listing-day.api",
        action: "test_action",
        chainId: 11155111,
        timestamp,
        nonce,
        ticker: null,
        payloadHash,
      });
      const signature1 = await testAccount.signMessage({ message: message1 });
      
      const request1 = {
        domain: "listing-day.api",
        action: "test_action",
        chainId: 11155111,
        timestamp,
        nonce,
        payload,
        signature: signature1,
      };

      // Request on chain 11155111 succeeds
      await verifySignedRequest(request1, config, 11155111, nonceStore);

      // Try to use same signature on chain 1 - should fail (signature won't verify for different chain)
      await assert.rejects(
        async () => {
          await verifySignedRequest(
            { ...request1, chainId: 1 },
            config,
            1,
            nonceStore
          );
        },
        /Invalid chain ID|Invalid signature|not authorized/i
      );
    });

    it("should prevent cross-ticker replay (same nonce, different ticker)", async () => {
      const config = loadAuthConfig({ ISSUER_ADDRESSES: testAccountAddr });
      const nonceStore = new (await import("../src/auth.ts")).NonceStore();
      
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = `${timestamp}_crossticker`;
      const payload = { test: "data" };
      const payloadHash = keccak256(toHex(JSON.stringify(payload)));
      
      // Sign for ticker "ACME"
      const message1 = JSON.stringify({
        domain: "listing-day.api",
        action: "relay_policy",
        chainId: 11155111,
        timestamp,
        nonce,
        ticker: "ACME",
        payloadHash,
      });
      const signature1 = await testAccount.signMessage({ message: message1 });
      
      const request1 = {
        domain: "listing-day.api",
        action: "relay_policy",
        chainId: 11155111,
        timestamp,
        nonce,
        ticker: "ACME",
        payload,
        signature: signature1,
      };

      // First request succeeds
      await verifySignedRequest(request1, config, 11155111, nonceStore);

      // Try to use same nonce with different ticker - should fail (nonce consumed)
      const message2 = JSON.stringify({
        domain: "listing-day.api",
        action: "relay_policy",
        chainId: 11155111,
        timestamp,
        nonce,
        ticker: "TEST",
        payloadHash,
      });
      const signature2 = await testAccount.signMessage({ message: message2 });
      
      const request2 = {
        domain: "listing-day.api",
        action: "relay_policy",
        chainId: 11155111,
        timestamp,
        nonce,
        ticker: "TEST",
        payload,
        signature: signature2,
      };

      await assert.rejects(
        async () => {
          await verifySignedRequest(request2, config, 11155111, nonceStore);
        },
        /nonce already used|replay/i
      );
    });

    it("should detect payload tampering (changed payload after signing)", async () => {
      const config = loadAuthConfig({ ISSUER_ADDRESSES: testAccountAddr });
      
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = `${timestamp}_tamper`;
      const originalPayload = { amount: 100, recipient: ISSUER1 };
      const tamperedPayload = { amount: 999999, recipient: UNAUTHORIZED };
      const originalPayloadHash = keccak256(toHex(JSON.stringify(originalPayload)));
      
      // Sign the original payload
      const message = JSON.stringify({
        domain: "listing-day.api",
        action: "transfer",
        chainId: 11155111,
        timestamp,
        nonce,
        ticker: null,
        payloadHash: originalPayloadHash,
      });
      const signature = await testAccount.signMessage({ message });
      
      // Try to submit with tampered payload - signature won't verify because hash mismatches
      const request = {
        domain: "listing-day.api",
        action: "transfer",
        chainId: 11155111,
        timestamp,
        nonce,
        payload: tamperedPayload,
        signature,
      };

      await assert.rejects(
        async () => {
          await verifySignedRequest(request, config, 11155111);
        },
        /Invalid signature|not authorized/i
      );
    });

    it("should persist and reload nonce store across restarts", async () => {
      const { tmpdir } = await import("node:os");
      const { mkdtempSync, rmSync } = await import("node:fs");
      const { join } = await import("node:path");
      
      const tempDir = mkdtempSync(join(tmpdir(), "auth-test-"));
      const storePath = join(tempDir, "nonces.json");
      
      try {
        const config = loadAuthConfig({ ISSUER_ADDRESSES: testAccountAddr });
        
        // Create first store and consume a nonce
        const store1 = new (await import("../src/auth.ts")).NonceStore(storePath);
        const timestamp = Math.floor(Date.now() / 1000);
        const nonce = `${timestamp}_persist`;
        const payload = { test: "data" };
        const payloadHash = keccak256(toHex(JSON.stringify(payload)));
        
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

        // First verification succeeds
        await verifySignedRequest(request, config, 11155111, store1);

        // Create new store (simulating restart) - should reload persisted nonces
        const store2 = new (await import("../src/auth.ts")).NonceStore(storePath);

        // Replay should fail even after "restart"
        await assert.rejects(
          async () => {
            await verifySignedRequest(request, config, 11155111, store2);
          },
          /nonce already used|replay/i
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
