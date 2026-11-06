import { serve } from "@hono/node-server";

import { bootstrap, redactRpc } from "./bootstrap.ts";

const { app, config } = bootstrap();

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`[api] listening on http://${info.address}:${info.port} (chain ${config.chainId}, rpc ${redactRpc(config.rpcUrl)})`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}
