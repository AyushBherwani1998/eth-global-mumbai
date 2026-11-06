import { randomBytes } from "node:crypto";

import { createMockExchange } from "./server.ts";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
let secret = process.env.MOCK_EXCHANGE_SECRET ?? "";
if (!secret) {
  secret = randomBytes(16).toString("hex");
  console.warn(`MOCK_EXCHANGE_SECRET not set; using a random one for this run: ${secret}`);
}

const server = createMockExchange({
  secret,
  ticker: process.env.TICKER ?? "ACME",
  stateFile: process.env.STATE_FILE || undefined,
});

server.listen(port, host, () => {
  console.log(`mock-exchange listening on http://${host}:${port} (GET /policy, PUT|POST /policy, POST /policy/reset)`);
});
