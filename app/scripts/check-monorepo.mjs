// The app type-imports the API's response types from ../services/api/src/types.ts
// (lib/api.ts), so it only builds inside the full repository. A host that copies
// just app/ (for example a Railway service with root directory /app) fails later
// with a bare TS2307; this says what to change instead.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const types = fileURLToPath(new URL("../../services/api/src/types.ts", import.meta.url));
if (!existsSync(types)) {
  console.error(
    [
      "",
      "app/ must be built from the whole repository: it imports types from services/api/src/types.ts,",
      "which is not in this build context.",
      "Build from the repo root, e.g. `pnpm --dir app install --frozen-lockfile && pnpm --dir app build`,",
      "and on a host with a root-directory setting use `/` (not `/app`). See app/RUNNING.md, Deploying.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
