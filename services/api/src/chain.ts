import {
  createPublicClient,
  defineChain,
  http,
  type AbiEvent,
  type Address,
  type GetLogsReturnType,
  type PublicClient,
} from "viem";
import { sepolia } from "viem/chains";

import { SEPOLIA, type Config } from "./config.ts";

/**
 * One viem client for the configured RPC. No caching: every request goes to the node. `batch.multicall` only
 * folds reads issued in the same tick into one Multicall3 `eth_call` (fewer round trips, same freshness).
 */
export function createClient(config: Config, overrides: { ensUniversalResolver?: Address; multicall3?: Address } = {}) {
  const chain =
    config.chainId === sepolia.id
      ? sepolia
      : defineChain({
          id: config.chainId,
          name: `fork-${config.chainId}`,
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: [config.rpcUrl] } },
        });
  const withContracts = defineChain({
    ...chain,
    contracts: {
      ...chain.contracts,
      multicall3: { address: overrides.multicall3 ?? config.overrides.multicall3 ?? SEPOLIA.multicall3 },
      ensUniversalResolver: {
        address: overrides.ensUniversalResolver ?? config.overrides.ensUniversalResolver ?? SEPOLIA.ensUniversalResolver,
      },
    },
  });
  return createPublicClient({
    chain: withContracts,
    transport: http(config.rpcUrl, { retryCount: 1, timeout: 20_000 }),
    batch: { multicall: { wait: 0 } },
    // All ENS records are onchain; never let a CCIP-Read gateway call leave the proxy.
    ccipRead: false,
  }) as PublicClient;
}

export type Client = ReturnType<typeof createClient>;

export type StrictLogs<E extends AbiEvent> = GetLogsReturnType<E, [E], true, bigint, bigint>;

/** `eth_getLogs` over [fromBlock, toBlock] in chunks of `maxRange` blocks (public RPCs cap the range). */
export async function getLogsChunked<const E extends AbiEvent>(
  client: Client,
  params: { address: Address; event: E; args?: Record<string, unknown>; fromBlock: bigint; toBlock: bigint },
  maxRange: bigint,
): Promise<StrictLogs<E>> {
  const out: StrictLogs<E>[number][] = [];
  for (let from = params.fromBlock; from <= params.toBlock; from += maxRange) {
    const to = from + maxRange - 1n < params.toBlock ? from + maxRange - 1n : params.toBlock;
    const logs = await client.getLogs({
      address: params.address,
      event: params.event,
      args: params.args as never,
      fromBlock: from,
      toBlock: to,
      strict: true,
    } as never);
    out.push(...(logs as StrictLogs<E>));
  }
  return out as StrictLogs<E>;
}

/** Block timestamps for a set of block numbers (one `eth_getBlockByNumber` each, in parallel). */
export async function blockTimes(client: Client, blocks: Iterable<bigint>): Promise<Map<bigint, bigint>> {
  const unique = [...new Set(blocks)];
  const entries = await Promise.all(
    unique.map(async (n) => [n, (await client.getBlock({ blockNumber: n })).timestamp] as const),
  );
  return new Map(entries);
}
