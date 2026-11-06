import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { createMockExchange } from "../src/server.ts";

const SECRET = "test-secret";
const NOW = 1_762_400_000;

async function start(opts: { stateFile?: string } = {}) {
  let clock = NOW;
  const server = createMockExchange({ secret: SECRET, now: () => clock, ...opts });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    server,
    base,
    tick: (s: number) => {
      clock += s;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function write(base: string, method: string, path: string, body: unknown, key: string | null = SECRET) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== null) headers["x-api-key"] = key;
  return fetch(base + path, { method, headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

describe("GET", () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  before(async () => {
    ctx = await start();
  });
  after(() => ctx.close());

  it("returns the default policy without auth", async () => {
    const res = await fetch(`${ctx.base}/policy`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), {
      ticker: "ACME",
      refPricePoints: null,
      mode: "normal",
      halted: false,
      coolOffUntil: 0,
      bands: { normalBps: 2000, surveillanceBps: 500 },
      status: "",
      revision: 0,
      updatedAt: NOW,
    });
  });

  it("serves /health, 404s unknown paths and answers CORS preflight", async () => {
    assert.deepEqual(await (await fetch(`${ctx.base}/health`)).json(), { ok: true });
    assert.equal((await fetch(`${ctx.base}/nope`)).status, 404);
    const pre = await fetch(`${ctx.base}/policy`, { method: "OPTIONS" });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get("access-control-allow-headers") ?? "", /x-api-key/);
  });

  it("rejects unsupported methods", async () => {
    const res = await fetch(`${ctx.base}/policy`, { method: "DELETE" });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "GET, PUT, POST");
  });
});

describe("edit", () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  before(async () => {
    ctx = await start();
  });
  after(() => ctx.close());

  it("POST merges a partial edit, bumps revision and updatedAt, and GET reflects it", async () => {
    ctx.tick(60);
    const res = await write(ctx.base, "POST", "/policy", { halted: true, bands: { surveillanceBps: 300 } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.halted, true);
    assert.deepEqual(body.bands, { normalBps: 2000, surveillanceBps: 300 });
    assert.equal(body.revision, 1);
    assert.equal(body.updatedAt, NOW + 60);
    assert.deepEqual(await (await fetch(`${ctx.base}/policy`)).json(), body);
  });

  it("POST accepts numeric modes and 2-decimal points", async () => {
    const body = await (await write(ctx.base, "POST", "/policy", { mode: 2, refPricePoints: 104.55 })).json();
    assert.equal(body.mode, "directional");
    assert.equal(body.refPricePoints, 104.55);
    assert.equal(body.halted, true, "untouched fields keep their value");
  });

  it("PUT replaces the whole policy; omitted fields fall back to defaults", async () => {
    const res = await write(ctx.base, "PUT", "/policy", {
      refPricePoints: 90,
      mode: "surveillance",
      coolOffUntil: NOW + 900,
      status: "surveillance",
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(
      { ...body, updatedAt: undefined },
      {
        ticker: "ACME",
        refPricePoints: 90,
        mode: "surveillance",
        halted: false,
        coolOffUntil: NOW + 900,
        bands: { normalBps: 2000, surveillanceBps: 500 },
        status: "surveillance",
        revision: 3,
        updatedAt: undefined,
      },
    );
  });

  it("POST /policy/reset restores defaults and keeps counting revisions", async () => {
    const body = await (await write(ctx.base, "POST", "/policy/reset", {})).json();
    assert.equal(body.refPricePoints, null);
    assert.equal(body.mode, "normal");
    assert.equal(body.revision, 4);
  });

  it("rejects invalid values with every problem listed and leaves the policy unchanged", async () => {
    const before = await (await fetch(`${ctx.base}/policy`)).json();
    const res = await write(ctx.base, "POST", "/policy", {
      mode: "panic",
      halted: "yes",
      refPricePoints: 1.234,
      coolOffUntil: -1,
      bands: { normalBps: 10_000, wide: 1 },
      status: "delisted",
      revision: 99,
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "invalid_policy");
    assert.equal(body.details.length, 8);
    assert.deepEqual(await (await fetch(`${ctx.base}/policy`)).json(), before);
  });

  it("rejects malformed JSON, non-object bodies and oversized bodies", async () => {
    assert.equal((await write(ctx.base, "POST", "/policy", "{nope")).status, 400);
    const arr = await write(ctx.base, "POST", "/policy", [1]);
    assert.equal(arr.status, 400);
    assert.deepEqual((await arr.json()).details, ["body must be a JSON object"]);
    const big = await write(ctx.base, "POST", "/policy", { ticker: "x".repeat(20_000) });
    assert.equal(big.status, 413);
  });
});

describe("auth", () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  before(async () => {
    ctx = await start();
  });
  after(() => ctx.close());

  for (const [name, key] of [
    ["missing", null],
    ["wrong", "wrong-secret"],
    ["prefix of the secret", "test"],
  ] as const) {
    it(`rejects writes with a ${name} key`, async () => {
      for (const [method, path] of [
        ["POST", "/policy"],
        ["PUT", "/policy"],
        ["POST", "/policy/reset"],
      ]) {
        const res = await write(ctx.base, method, path, { halted: true }, key);
        assert.equal(res.status, 401, `${method} ${path}`);
        assert.deepEqual(await res.json(), { error: "unauthorized" });
      }
      assert.equal((await (await fetch(`${ctx.base}/policy`)).json()).halted, false);
    });
  }

  it("accepts Authorization: Bearer as an alternative", async () => {
    const res = await fetch(`${ctx.base}/policy`, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ halted: true }),
    });
    assert.equal(res.status, 200);
  });

  it("refuses to start without a secret", () => {
    assert.throws(() => createMockExchange({ secret: "" }), /secret is required/);
  });
});

describe("persistence", () => {
  it("saves every edit to STATE_FILE and reloads it on restart", async () => {
    const stateFile = join(mkdtempSync(join(tmpdir(), "mock-exchange-")), "state.json");
    const a = await start({ stateFile });
    await write(a.base, "POST", "/policy", { halted: true, ticker: "TATA" });
    await a.close();
    assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).ticker, "TATA");

    const b = await start({ stateFile });
    const body = await (await fetch(`${b.base}/policy`)).json();
    await b.close();
    assert.equal(body.halted, true);
    assert.equal(body.revision, 1);
  });
});
