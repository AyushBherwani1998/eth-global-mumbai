/** HTTP behavior that needs no RPC: routing, validation, errors, CORS, and /health with a dead node. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { createApp, redactRpc } from "../src/app.ts";
import { createClient } from "../src/chain.ts";
import { loadConfig } from "../src/config.ts";

const FIXTURE = resolve(import.meta.dirname, "fixtures/deployment.json");
const config = loadConfig({ DEPLOYMENTS_FILES: FIXTURE, RPC_URL: "http://127.0.0.1:1/secret-key", CORS_ORIGINS: "https://app.example" });
const app = createApp({ config, client: createClient(config) });

const post = (path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

test("/health reports a dead RPC as 503 without leaking the URL path", async () => {
  const res = await app.request("/health");
  assert.equal(res.status, 503);
  const h = await res.json();
  assert.equal(h.ok, false);
  assert.equal(h.chainId, 31337);
  assert.equal(h.rpc, "http://127.0.0.1:1");
  assert.equal(h.deployments[0].ticker, "acme");
  assert.equal(h.deployments[0].ok, true);
  assert.ok(h.error);
  assert.equal(redactRpc("https://user:pw@rpc.example/v2/KEY"), "https://rpc.example");
});

test("unknown ticker and route are 404 with an error body", async () => {
  const res = await app.request("/v1/listings/nope");
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: { code: "UNKNOWN_TICKER", message: 'no listing "nope" in DEPLOYMENTS_FILES' } });
  for (const p of ["/v1/policy/nope", "/v1/market/nope/swaps", "/v1/auction/nope/clearing"]) assert.equal((await app.request(p)).status, 404);
  const route = await app.request("/v2/nothing");
  assert.equal(route.status, 404);
  assert.equal((await route.json()).error.code, "NOT_FOUND");
});

test("query validation is 400", async () => {
  assert.equal((await app.request("/v1/eligibility?address=0x0000000000000000000000000000000000000001")).status, 400);
  assert.equal((await app.request("/v1/eligibility?ticker=acme&address=0x12")).status, 400);
  assert.equal((await app.request("/v1/bids?owner=nope")).status, 400);
  assert.equal((await app.request("/v1/market/acme/swaps?limit=0")).status, 400);
  assert.equal((await app.request("/v1/market/acme/swaps?fromBlock=-1")).status, 400);
});

test("prepare body validation is 400 before any RPC call", async () => {
  const owner = "0x00000000000000000000000000000000000beef1";
  const cases: [string, unknown, RegExp][] = [
    ["/v1/prepare/bid", "not json", /JSON/],
    ["/v1/prepare/bid", [1], /JSON object/],
    ["/v1/prepare/bid", { owner }, /ticker is required/],
    ["/v1/prepare/bid", { ticker: "acme", owner: "0x00000000000000000000000000000000000bEEF1", budget: 1, maxPrice: 1 }, /checksum/],
    ["/v1/prepare/bid", { ticker: "acme", owner, maxPrice: 1.3 }, /budget/],
    ["/v1/prepare/bid", { ticker: "acme", owner, budget: 0, maxPrice: 1.3 }, /out of range/],
    ["/v1/prepare/bid", { ticker: "acme", owner, budget: "1.0000001", maxPrice: 1.3 }, /decimals/],
    ["/v1/prepare/bid", { ticker: "acme", owner, budget: 10, maxPrice: 1.305 }, /multiple of 0.01/],
    ["/v1/prepare/bid", { ticker: "acme", owner, budget: 10, maxPricePoints: 1.5 }, /maxPricePoints/],
    ["/v1/prepare/bid", { ticker: "acme", owner, budget: 10, maxPrice: 1.3, permit2ExpiresIn: 1 }, /permit2ExpiresIn/],
    ["/v1/prepare/swap", { ticker: "acme", from: owner, side: "long", amount: 1 }, /side/],
    ["/v1/prepare/swap", { ticker: "acme", from: owner, side: "buy", amountRaw: "1.5" }, /amountRaw/],
    ["/v1/prepare/swap", { ticker: "acme", from: owner, side: "buy", amount: 1, slippageBps: 6000 }, /slippageBps/],
    ["/v1/prepare/exit", { ticker: "acme", bidId: -1 }, /bidId/],
    ["/v1/prepare/claim", { ticker: "acme", bidIds: [] }, /bidIds/],
  ];
  for (const [path, body, re] of cases) {
    const res = await post(path, body);
    const j = await res.json();
    assert.equal(res.status, 400, `${path} ${JSON.stringify(body)} -> ${JSON.stringify(j)}`);
    assert.equal(j.error.code, "BAD_REQUEST");
    assert.match(j.error.message, re);
  }
  assert.equal((await post("/v1/prepare/bid", { ticker: "nope", owner, budget: 1, maxPrice: 1 })).status, 404);
});

test("RPC failures are 502 RPC_ERROR", async () => {
  const res = await app.request("/v1/auction/acme");
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.code, "RPC_ERROR");
});

test("CORS allows the configured origin only; responses are no-store", async () => {
  const pre = await app.request("/v1/listings", { method: "OPTIONS", headers: { origin: "https://app.example", "access-control-request-method": "POST" } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://app.example");
  assert.match(pre.headers.get("access-control-allow-methods") ?? "", /POST/);
  const other = await app.request("/v1/listings/nope", { headers: { origin: "https://evil.example" } });
  assert.equal(other.headers.get("access-control-allow-origin"), null);
  assert.equal(other.headers.get("cache-control"), "no-store");
});
