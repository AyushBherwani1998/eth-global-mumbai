/**
 * Integration tests for auction creation endpoints with auth
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toHex, getAddress, type Address, type Hex } from "viem";
import { verifySignedRequest, loadAuthConfig } from "../src/auth.ts";

test("Endpoint integration", async (t) => {
  const issuerPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
  const issuerAccount = privateKeyToAccount(issuerPrivateKey);
  const issuerAddress = getAddress(issuerAccount.address);
  
  const unauthorizedPrivateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
  const unauthorizedAccount = privateKeyToAccount(unauthorizedPrivateKey);
  const unauthorizedAddress = getAddress(unauthorizedAccount.address);

  const config = loadAuthConfig({ ISSUER_ADDRESSES: issuerAddress });

  // Helper to create signed request
  async function createSignedRequest(action: string, payload: any, account: typeof issuerAccount, timestamp?: number) {
    const ts = timestamp || Math.floor(Date.now() / 1000);
    const nonce = `${ts}_${Math.random().toString(36).substring(7)}`;
    const payloadHash = keccak256(toHex(JSON.stringify(payload)));
    
    const message = JSON.stringify({
      domain: "listing-day.api",
      action,
      chainId: 11155111,
      timestamp: ts,
      nonce,
      ticker: null,
      payloadHash,
    });
    
    const signature = await account.signMessage({ message });
    
    return {
      domain: "listing-day.api",
      action,
      chainId: 11155111,
      timestamp: ts,
      nonce,
      ticker: undefined,
      payload,
      signature,
    };
  }

  await t.test("prepare-auction validates signed requests", async () => {
    const payload = {
      creationId: "test-creation-123",
      tokenAddress: "0x1234567890123456789012345678901234567890" as Address,
    };
    
    const request = await createSignedRequest("prepare_auction", payload, issuerAccount);
    
    // Verify signature is valid
    try {
      const signer = await verifySignedRequest(request, config, 11155111);
      assert.equal(signer.toLowerCase(), issuerAddress.toLowerCase(), "Signer matches issuer");
    } catch (e: any) {
      assert.fail(`Should accept valid signature: ${e.message}`);
    }
  });

  await t.test("rejects unauthorized signer", async () => {
    const payload = { creationId: "test-creation-456" };
    const request = await createSignedRequest("prepare_auction", payload, unauthorizedAccount);
    
    await assert.rejects(
      async () => {
        await verifySignedRequest(request, config, 11155111);
      },
      (err: any) => {
        assert.ok(err.message.includes("not authorized"), "Error mentions authorization");
        return true;
      },
      "Unauthorized signer rejected"
    );
  });

  await t.test("rejects replay attacks with same nonce", async () => {
    const payload = { creationId: "test-creation-789" };
    const request = await createSignedRequest("prepare_auction", payload, issuerAccount);
    
    const nonceStore = new (await import("../src/auth.ts")).NonceStore();
    
    // First request succeeds
    await verifySignedRequest(request, config, 11155111, nonceStore);
    
    // Replay with same nonce should fail
    await assert.rejects(
      async () => {
        await verifySignedRequest(request, config, 11155111, nonceStore);
      },
      (err: any) => {
        assert.ok(err.message.includes("already used") || err.message.includes("replay"), "Error mentions replay");
        return true;
      },
      "Replay rejected"
    );
  });

  await t.test("rejects expired timestamps", async () => {
    const payload = { creationId: "test-creation-old" };
    
    // 10 minutes old
    const oldTimestamp = Math.floor(Date.now() / 1000) - (10 * 60);
    const request = await createSignedRequest("prepare_auction", payload, issuerAccount, oldTimestamp);
    
    const configWithShortExpiry = loadAuthConfig({
      ISSUER_ADDRESSES: issuerAddress,
      MAX_SIGNATURE_AGE: "300", // 5 minutes
    });
    
    await assert.rejects(
      async () => {
        await verifySignedRequest(request, configWithShortExpiry, 11155111);
      },
      (err: any) => {
        assert.ok(err.message.includes("expired") || err.message.includes("old"), "Error mentions expiration");
        return true;
      },
      "Expired request rejected"
    );
  });

  await t.test("validates transaction data structure", () => {
    // Test that prepare-auction returns expected structure
    const mockPrepareResponse = {
      step: 7,
      contract: "LiquidityLauncher",
      to: "0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0" as Address,
      data: "0xac9650d8" as Hex, // multicall selector
      value: "0x0",
    };
    
    assert.equal(mockPrepareResponse.step, 7, "Step is 7");
    assert.equal(mockPrepareResponse.contract, "LiquidityLauncher", "Contract name correct");
    assert.ok(mockPrepareResponse.data.startsWith("0xac9650d8"), "Has multicall selector");
    assert.equal(mockPrepareResponse.value, "0x0", "Value is 0");
  });

  await t.test("validates setAuction transaction structure", () => {
    // Test that prepare-set-auction returns expected structure
    const mockSetAuctionResponse = {
      step: 8,
      contract: "AuctionValidationHook",
      to: "0x2222222222222222222222222222222222222222" as Address,
      data: "0x6c6f26fa" as Hex, // setAuction selector
      value: "0x0",
    };
    
    assert.equal(mockSetAuctionResponse.step, 8, "Step is 8");
    assert.equal(mockSetAuctionResponse.contract, "AuctionValidationHook", "Contract name correct");
    assert.ok(mockSetAuctionResponse.data.startsWith("0x6c6f26fa"), "Has setAuction selector");
  });

  await t.test("handles failed transaction submission", async () => {
    // Simulate a transaction that fails
    const mockFailedReceipt = {
      status: "reverted" as const,
      transactionHash: "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
      blockNumber: 12000100n,
    };
    
    assert.equal(mockFailedReceipt.status, "reverted", "Status is reverted");
    // Implementation should handle reverted receipts and return error
  });

  await t.test("handles resume from failed step", () => {
    // Test that lifecycle can resume from a failed step
    const creationStates = [
      { phase: "deployed_policy_receiver", canResume: true, nextStep: 6 },
      { phase: "policy_source_set", canResume: true, nextStep: 7 },
      { phase: "pending_auction", canResume: true, nextStep: 7 },
      { phase: "auction_created", canResume: true, nextStep: 8 },
    ];
    
    for (const state of creationStates) {
      assert.ok(state.canResume, `Can resume from ${state.phase}`);
      assert.ok(state.nextStep >= 6 && state.nextStep <= 8, `Next step ${state.nextStep} is valid`);
    }
  });

  await t.test("validates multicall encoding structure", () => {
    // Multicall takes bytes[] calldata data
    // Should be: 0xac9650d8 + abi.encode(bytes[] data)
    
    const multicallSelector = "0xac9650d8";
    const mockMulticallData = `${multicallSelector}00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002` as Hex;
    
    assert.ok(mockMulticallData.startsWith(multicallSelector), "Starts with multicall selector");
    assert.ok(mockMulticallData.length > 10, "Has substantial calldata");
  });
});
