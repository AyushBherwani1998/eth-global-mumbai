import { serve } from "@hono/node-server";

import { createApp, redactRpc } from "./app.ts";
import { createClient } from "./chain.ts";
import { loadConfig, readDeployments } from "./config.ts";

const config = loadConfig();
const client = createClient(config);
const app = createApp({ config, client });

for (const d of readDeployments(config)) {
  console.log(d.error === undefined ? `[api] listing ${d.ticker} <- ${d.file}` : `[api] WARN ${d.file}: ${d.error}`);
}
client
  .getChainId()
  .then((id) => {
    if (id !== config.chainId) console.warn(`[api] WARN RPC chain id ${id} != expected ${config.chainId} (set CHAIN_ID or RPC_URL)`);
  })
  .catch((e: Error) => console.warn(`[api] WARN RPC ${redactRpc(config.rpcUrl)} unreachable: ${e.message}`));

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`[api] listening on http://${info.address}:${info.port} (chain ${config.chainId}, rpc ${redactRpc(config.rpcUrl)})`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}
