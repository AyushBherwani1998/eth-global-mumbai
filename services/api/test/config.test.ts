import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { SEPOLIA, loadConfig, parseDeployment, readDeployments, type DeploymentJson } from "../src/config.ts";

const FIXTURE = resolve(import.meta.dirname, "fixtures/deployment.json");
const json = JSON.parse(readFileSync(FIXTURE, "utf8")) as DeploymentJson;
const base = { parentName: "listingday.eth", overrides: {}, chainId: 31337 };

test("loadConfig defaults to Sepolia and the committed deployments file", () => {
  const c = loadConfig({});
  assert.equal(c.chainId, SEPOLIA.chainId);
  assert.equal(c.port, 8788);
  assert.equal(c.host, "127.0.0.1");
  assert.equal(c.rpcUrl, "https://ethereum-sepolia-rpc.publicnode.com");
  assert.match(c.deployments[0]!.path, /contracts\/deployments\/sepolia\.json$/);
  assert.deepEqual(c.corsOrigins, ["http://localhost:3000", "http://127.0.0.1:3000"]);
});

test("loadConfig treats empty values (a sourced .env.example) as unset", () => {
  const empty = { DEPLOYMENTS_FILES: "", RPC_URL: "", SEPOLIA_RPC_URL: "", CHAIN_ID: "", PORT: "", HOST: "", CORS_ORIGINS: "", LOGS_MAX_RANGE: "", USDC_ADDRESS: "" };
  assert.deepEqual(loadConfig(empty), loadConfig({}));
});

test("loadConfig reads DEPLOYMENTS_FILES with #ticker suffixes and the chain id from the first file", () => {
  const c = loadConfig({
    DEPLOYMENTS_FILES: `${FIXTURE}, ./missing.json#Kesar`,
    RPC_URL: "http://127.0.0.1:8546",
    SEPOLIA_RPC_URL: "https://ignored.example",
    CORS_ORIGINS: "https://app.example, http://localhost:3000",
    USDC_ADDRESS: "0x0000000000000000000000000000000000000001",
    PORT: "9000",
  });
  assert.equal(c.chainId, 31337);
  assert.equal(c.rpcUrl, "http://127.0.0.1:8546");
  assert.equal(c.port, 9000);
  assert.deepEqual(c.deployments.map((d) => d.ticker), [null, "kesar"]);
  assert.match(c.deployments[1]!.path, /services\/api\/missing\.json$/);
  assert.deepEqual(c.corsOrigins, ["https://app.example", "http://localhost:3000"]);
  assert.equal(c.overrides.usdc, "0x0000000000000000000000000000000000000001");
  assert.equal(loadConfig({ DEPLOYMENTS_FILES: FIXTURE, CHAIN_ID: "11155111" }).chainId, 11155111);
  assert.throws(() => loadConfig({ USDC_ADDRESS: "0x12" }), /USDC_ADDRESS/);
});

test("parseDeployment maps the demo export", () => {
  const l = parseDeployment(json, FIXTURE, base, null);
  assert.equal(l.ticker, "acme");
  assert.equal(l.ensName, json.ens?.ticker?.name);
  assert.equal(l.usdcIsCurrency0, true);
  assert.equal(l.listingDayBandBps, 500);
  assert.equal(l.hook, json.contracts?.listingHook);
  assert.equal(l.auction, json.auction?.address);
  assert.equal(l.poolKey.hooks, l.hook);
  assert.equal(l.params.floorPoints, 80n);
  assert.equal(l.params.capPriceQ96, 150_533_508_776_980n);
  assert.equal(l.external.usdc, SEPOLIA.usdc);
  assert.equal(l.external.quoter, SEPOLIA.quoter);
});

test("parseDeployment: #ticker override, env overrides and missing sections", () => {
  const override = "0x00000000000000000000000000000000000000AA";
  const l = parseDeployment(json, FIXTURE, { ...base, overrides: { quoter: override } }, "kesar");
  assert.equal(l.ticker, "kesar");
  assert.equal(l.ensName, "kesar.listingday.eth");
  assert.equal(l.external.quoter, override);

  const noEns = { ...json, ens: undefined, label: "Demo-1" };
  assert.equal(parseDeployment(noEns, FIXTURE, base, null).ticker, "demo-1");
  const notLaunched = { ...json, auction: {} };
  assert.equal(parseDeployment(notLaunched, FIXTURE, base, null).auction, null);
  assert.throws(() => parseDeployment({ ...json, pool: undefined }, FIXTURE, base, null), /pool section missing/);
  assert.throws(() => parseDeployment({ ...json, contracts: {} }, FIXTURE, base, null), /listingHook missing/);
});

test("readDeployments reports unreadable files instead of throwing", () => {
  const c = loadConfig({ DEPLOYMENTS_FILES: `${FIXTURE},./nope.json#x` });
  const [ok, bad] = readDeployments(c);
  assert.equal(ok?.listing?.ticker, "acme");
  assert.equal(bad?.listing, undefined);
  assert.match(bad?.error ?? "", /not found/);
});
