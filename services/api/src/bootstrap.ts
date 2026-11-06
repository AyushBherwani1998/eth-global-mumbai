/**
 * Shared cold-start for the long-running Node server and the Vercel function entry.
 * Does not listen on a port — callers that need a TCP server call `serve` themselves.
 */
import type { Hono } from "hono";

import { createApp, redactRpc } from "./app.ts";
import { createClient, type Client } from "./chain.ts";
import { loadConfig, readDeployments, type Config } from "./config.ts";

export type Bootstrapped = {
  app: Hono;
  config: Config;
  client: Client;
};

export function bootstrap(env: NodeJS.ProcessEnv = process.env): Bootstrapped {
  const config = loadConfig(env);
  const client = createClient(config);
  const app = createApp({ config, client });

  for (const d of readDeployments(config)) {
    console.log(d.error === undefined ? `[api] listing ${d.ticker} <- ${d.file}` : `[api] WARN ${d.file}: ${d.error}`);
  }
  client
    .getChainId()
    .then((id) => {
      if (id !== config.chainId) {
        console.warn(`[api] WARN RPC chain id ${id} != expected ${config.chainId} (set CHAIN_ID or RPC_URL)`);
      }
    })
    .catch((e: Error) => console.warn(`[api] WARN RPC ${redactRpc(config.rpcUrl)} unreachable: ${e.message}`));

  return { app, config, client };
}

export { redactRpc };
