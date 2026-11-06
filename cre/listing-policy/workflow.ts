import {
  bytesToHex,
  consensusIdenticalAggregation,
  CronCapability,
  type CronPayload,
  EVMClient,
  getNetwork,
  HTTPCapability,
  HTTPClient,
  type HTTPPayload,
  type HTTPSendRequester,
  handler,
  ok,
  prepareReportRequest,
  Runner,
  type Runtime,
  TxStatus,
  text,
} from "@chainlink/cre-sdk";
import { z } from "zod";

import { buildListingPolicy, encodeReport, type ExchangeSnapshot, parseExchangePolicy } from "./policy";

export const configSchema = z.object({
  /** Six-field cron (seconds first); the DON enforces a 30 s minimum interval. */
  schedule: z.string(),
  /** Mock exchange `GET /policy` URL. */
  apiUrl: z.string().url(),
  chainSelectorName: z.string(),
  receiverAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /** Pool orientation: true when USDC sorts below the share token (the Sepolia deployment). */
  usdcIsCurrency0: z.boolean(),
  /** Gas for the forwarder -> receiver call, incl. the best-effort ENS write. */
  gasLimit: z.string().regex(/^\d+$/),
});

export type Config = z.infer<typeof configSchema>;

export type RunResult = {
  trigger: "cron" | "http";
  asOf: string;
  report: string;
  txStatus: string;
  txHash: string;
};

/** EVM `ReceiverContractExecutionStatus.REVERTED` (not re-exported by the SDK's public API). */
const RECEIVER_REVERTED = 1;

const fetchSnapshot = (requester: HTTPSendRequester, config: Config): string => {
  const res = requester
    .sendRequest({ url: config.apiUrl, method: "GET", headers: { accept: "application/json" } })
    .result();
  if (!ok(res)) throw new Error(`mock exchange returned HTTP ${res.statusCode}`);
  // Normalised and re-serialised so identical-consensus compares only the fields that reach the chain.
  return JSON.stringify(parseExchangePolicy(JSON.parse(text(res))));
};

export function publishPolicy(runtime: Runtime<Config>, trigger: RunResult["trigger"]): RunResult {
  const config = runtime.config;
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName, isTestnet: true });
  if (!network) throw new Error(`unknown chain ${config.chainSelectorName}`);

  const snapshot = JSON.parse(
    new HTTPClient().sendRequest(runtime, fetchSnapshot, consensusIdenticalAggregation<string>())(config).result(),
  ) as ExchangeSnapshot;

  const asOf = BigInt(Math.floor(runtime.now().getTime() / 1000));
  const policy = buildListingPolicy(snapshot, {
    asOf,
    chainSelector: network.chainSelector.selector,
    usdcIsCurrency0: config.usdcIsCurrency0,
  });
  const payload = encodeReport(policy, snapshot.status);
  runtime.log(
    `policy asOf=${asOf} mode=${policy.mode} halted=${policy.halted} coolOffUntil=${policy.coolOffUntil} ` +
      `ref=${policy.refSqrtPriceX96} bands=${policy.normalBandBps}/${policy.survBandBps} status="${snapshot.status}"`,
  );
  runtime.log(`report payload ${payload}`);

  const report = runtime.report(prepareReportRequest(payload)).result();
  const reply = new EVMClient(network.chainSelector.selector)
    .writeReport(runtime, {
      receiver: config.receiverAddress,
      report,
      gasConfig: { gasLimit: config.gasLimit },
    })
    .result();

  const txHash = bytesToHex(reply.txHash ?? new Uint8Array(32));
  runtime.log(`writeReport txStatus=${TxStatus[reply.txStatus]} tx=${txHash}`);
  if (reply.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`writeReport failed: ${TxStatus[reply.txStatus]} ${reply.errorMessage ?? ""}`.trim());
  }
  if (reply.receiverContractExecutionStatus === RECEIVER_REVERTED) {
    // MockKeystoneForwarder swallows receiver reverts (ReportProcessed.result == false); surface them here.
    throw new Error(`ListingPolicyReceiver rejected the report (tx ${txHash})`);
  }
  return { trigger, asOf: asOf.toString(), report: payload, txStatus: TxStatus[reply.txStatus], txHash };
}

export const onCron = (runtime: Runtime<Config>, _payload: CronPayload): RunResult => publishPolicy(runtime, "cron");

/** Manual trigger: the body is ignored; the run always publishes the exchange's current policy. */
export const onHttp = (runtime: Runtime<Config>, _payload: HTTPPayload): RunResult => publishPolicy(runtime, "http");

export function initWorkflow(config: Config) {
  return [
    handler(new CronCapability().trigger({ schedule: config.schedule }), onCron),
    handler(new HTTPCapability().trigger({}), onHttp),
  ];
}

export async function runWorkflow() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
