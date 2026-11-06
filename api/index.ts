/**
 * Vercel Node function entry for the Listing Day API.
 *
 * The API Vercel project must use Root Directory = repository root (so
 * `contracts/deployments/sepolia.json` is uploaded). `vercel.json` rewrites
 * every path to this function and includes the deployments JSON via includeFiles.
 *
 * Local / Railway / Docker keep using `services/api` (`node src/index.ts`).
 */
import { bootstrap } from "../services/api/src/bootstrap.ts";

const { app } = bootstrap();

export default app;
