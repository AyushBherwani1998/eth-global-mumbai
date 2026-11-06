import { ConfigError, loadConfig } from "./config.ts";
import { createPassSigner } from "./pass.ts";
import { createVerifyServer } from "./server.ts";

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`verify: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const server = createVerifyServer({ config });
server.listen(config.port, config.host, () => {
  const signer = createPassSigner(config.passSignerKey).address;
  console.log(`verify listening on http://${config.host}:${config.port} (World ID environment: ${config.world.environment})`);
  console.log(`pass signer ${signer}: must equal WorldPassModule.signer() of every listing below`);
  for (const l of config.listings.values()) {
    console.log(`  ${l.ticker}: action ${l.action}, auction ${l.auction}, module ${l.module}, cap ${l.cap}`);
  }
});
