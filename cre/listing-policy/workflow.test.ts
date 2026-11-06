/**
 * Runs the real workflow handlers on the CRE SDK test runtime (no WASM, no DON) against a live
 * services/mock-exchange instance: the HTTP capability mock serves the body fetched from the running API, the
 * EVM mock captures `writeReport`, and the captured report payload must equal the golden vectors.
 */
import { afterAll, beforeAll, describe, expect } from "bun:test";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";

import { bytesToHex, TxStatus } from "@chainlink/cre-sdk";
import {
  EvmMock,
  HttpActionsMock,
  newTestRuntime,
  REPORT_METADATA_HEADER_LENGTH,
  test,
  type TestRuntime,
} from "@chainlink/cre-sdk/test";

import { createMockExchange } from "../../services/mock-exchange/src/server.ts";
import { type Config, configSchema, initWorkflow, onCron, onHttp } from "./workflow";
import { FIXTURE_PATH, type FixtureCase } from "./scripts/gen-fixtures";

const SEPOLIA = 16015286601757825753n;
const SECRET = "workflow-test";
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { cases: FixtureCase[] };
const byName = (n: string) => fixture.cases.find((c) => c.name === n) as FixtureCase;

let server: ReturnType<typeof createMockExchange>;
let apiUrl: string;
let clock = 1_762_400_000;

beforeAll(async () => {
  server = createMockExchange({ secret: SECRET, now: () => clock });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/policy`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const config = (): Config => ({
  ...(JSON.parse(readFileSync(new URL("./config.staging.json", import.meta.url), "utf8")) as Config),
  apiUrl,
});

async function edit(method: "POST" | "PUT", body: unknown) {
  const res = await fetch(apiUrl, {
    method,
    headers: { "x-api-key": SECRET, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
}

type Captured = { receiver: string; gasLimit: bigint; payload: string };

/** Wires the HTTP mock to the live API body and the EVM mock to capture the write. */
async function wire(
  cfg: Config,
  reply: { txStatus?: TxStatus; receiverContractExecutionStatus?: number } = {},
): Promise<{ captured: Captured[]; requests: string[] }> {
  const live = await fetch(cfg.apiUrl);
  const body = Buffer.from(await live.text()).toString("base64");
  const requests: string[] = [];
  HttpActionsMock.testInstance().sendRequest = (req) => {
    requests.push(`${req.method} ${req.url}`);
    return { statusCode: live.status, body };
  };
  const captured: Captured[] = [];
  EvmMock.testInstance(SEPOLIA).writeReport = (input) => {
    captured.push({
      receiver: bytesToHex(input.receiver),
      gasLimit: input.gasConfig?.gasLimit ?? 0n,
      payload: bytesToHex((input.report?.rawReport ?? new Uint8Array()).slice(REPORT_METADATA_HEADER_LENGTH)),
    });
    return {
      $typeName: "capabilities.blockchain.evm.v1alpha.WriteReportReply",
      txStatus: reply.txStatus ?? TxStatus.SUCCESS,
      receiverContractExecutionStatus: reply.receiverContractExecutionStatus ?? 0,
      txHash: new Uint8Array(32).fill(0xab),
    } as never;
  };
  return { captured, requests };
}

function runtimeAt(cfg: Config, asOf: number): TestRuntime<Config> {
  return newTestRuntime<Config>(null, { timeProvider: () => asOf * 1000 + 999 }, cfg);
}

describe("workflow against the live mock exchange", () => {
  test("config.staging.json is valid and targets Sepolia with a 1.5-2M gas limit", () => {
    const cfg = configSchema.parse(config());
    expect(cfg.chainSelectorName).toBe("ethereum-testnet-sepolia");
    expect(cfg.usdcIsCurrency0).toBe(true);
    expect(Number(cfg.gasLimit)).toBeGreaterThanOrEqual(1_500_000);
    expect(Number(cfg.gasLimit)).toBeLessThanOrEqual(2_000_000);
  });

  test("registers a cron handler and an HTTP (manual) handler", () => {
    const handlers = initWorkflow(config());
    expect(handlers).toHaveLength(2);
  });

  test("cron run on the default policy writes the golden 'default' report", async () => {
    const cfg = config();
    const { captured, requests } = await wire(cfg);
    const c = byName("default");
    const result = onCron(runtimeAt(cfg, c.asOf), {} as never);

    expect(requests).toEqual([`GET ${cfg.apiUrl}`]);
    expect(captured).toEqual([
      { receiver: cfg.receiverAddress.toLowerCase(), gasLimit: BigInt(cfg.gasLimit), payload: c.expected.payload },
    ]);
    expect(result).toEqual({
      trigger: "cron",
      asOf: String(c.asOf),
      report: c.expected.payload,
      txStatus: "SUCCESS",
      txHash: `0x${"ab".repeat(32)}`,
    });
  });

  for (const [name, method, body] of [
    ["halted", "POST", { halted: true }],
    [
      "directional-ref-90",
      "PUT",
      { refPricePoints: 90, mode: "directional", bands: { surveillanceBps: 300 } },
    ],
    [
      "surveillance-ref-104.5-cooloff",
      "PUT",
      {
        refPricePoints: 104.5,
        mode: "surveillance",
        coolOffUntil: 1_762_400_900,
        bands: { normalBps: 0, surveillanceBps: 0 },
        status: "surveillance",
      },
    ],
  ] as const) {
    test(`console edit -> manual run writes the golden '${name}' report`, async () => {
      clock += 60;
      await edit(method, body);
      const cfg = config();
      const { captured } = await wire(cfg);
      const c = byName(name);
      const rt = runtimeAt(cfg, c.asOf);
      const result = onHttp(rt, {} as never);
      expect(captured.map((w) => w.payload)).toEqual([c.expected.payload]);
      expect(result.trigger).toBe("http");
      expect(rt.getLogs().some((l) => l.includes(`report payload ${c.expected.payload}`))).toBe(true);
    });
  }

  test("a receiver revert (ReportProcessed.result == false) fails the run", async () => {
    const cfg = config();
    await wire(cfg, { receiverContractExecutionStatus: 1 });
    expect(() => onCron(runtimeAt(cfg, clock), {} as never)).toThrow(/rejected the report/);
  });

  test("a reverted or fatal transaction fails the run", async () => {
    const cfg = config();
    await wire(cfg, { txStatus: TxStatus.REVERTED });
    expect(() => onCron(runtimeAt(cfg, clock), {} as never)).toThrow(/writeReport failed: REVERTED/);
  });

  test("an API error or an invalid body fails the run before anything is written", async () => {
    const cfg = config();
    const { captured } = await wire(cfg);
    HttpActionsMock.testInstance().sendRequest = () => ({ statusCode: 503, body: "" });
    expect(() => onCron(runtimeAt(cfg, clock), {} as never)).toThrow(/HTTP 503/);
    HttpActionsMock.testInstance().sendRequest = () => ({
      statusCode: 200,
      body: Buffer.from(JSON.stringify({ mode: "panic" })).toString("base64"),
    });
    expect(() => onCron(runtimeAt(cfg, clock), {} as never)).toThrow(/mode must be one of/);
    expect(captured).toHaveLength(0);
  });
});
