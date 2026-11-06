import { timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { applyEdit, defaultPolicy, type ExchangePolicy, PolicyValidationError, replacePolicy } from "./policy.ts";

export type ServerOptions = {
  /** Shared secret required in `x-api-key` (or `Authorization: Bearer`) for every write. */
  secret: string;
  ticker?: string;
  /** Optional JSON file the policy is loaded from and saved to after every edit. */
  stateFile?: string;
  /** Override for tests. */
  now?: () => number;
};

const MAX_BODY_BYTES = 16 * 1024;

export function createMockExchange(options: ServerOptions): Server {
  if (!options.secret) throw new Error("mock-exchange: a non-empty secret is required");
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  let policy: ExchangePolicy = load(options) ?? defaultPolicy(options.ticker, now());

  const commit = (next: ExchangePolicy) => {
    policy = next;
    if (options.stateFile) writeFileSync(options.stateFile, `${JSON.stringify(policy, null, 2)}\n`);
    return policy;
  };

  return createServer(async (req, res) => {
    setCors(res);
    const path = new URL(req.url ?? "/", "http://localhost").pathname.replace(/\/+$/, "") || "/";
    try {
      if (req.method === "OPTIONS") return send(res, 204);
      if (path === "/health") {
        if (req.method !== "GET") return methodNotAllowed(res, "GET");
        return send(res, 200, { ok: true });
      }
      if (path === "/policy") {
        if (req.method === "GET" || req.method === "HEAD") return send(res, 200, policy);
        if (req.method !== "PUT" && req.method !== "POST") return methodNotAllowed(res, "GET, PUT, POST");
        if (!authorized(req, options.secret)) return send(res, 401, { error: "unauthorized" });
        const body = await readJson(req);
        const next = req.method === "PUT" ? replacePolicy(policy, body, now()) : applyEdit(policy, body, now());
        return send(res, 200, commit(next));
      }
      if (path === "/policy/reset") {
        if (req.method !== "POST") return methodNotAllowed(res, "POST");
        if (!authorized(req, options.secret)) return send(res, 401, { error: "unauthorized" });
        return send(res, 200, commit({ ...defaultPolicy(policy.ticker, now()), revision: policy.revision + 1 }));
      }
      return send(res, 404, { error: "not_found" });
    } catch (err) {
      if (err instanceof PolicyValidationError) return send(res, 400, { error: "invalid_policy", details: err.details });
      if (err instanceof HttpError) return send(res, err.status, { error: err.code });
      console.error(err);
      return send(res, 500, { error: "internal" });
    }
  });
}

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function load(options: ServerOptions): ExchangePolicy | undefined {
  if (!options.stateFile) return undefined;
  try {
    return JSON.parse(readFileSync(options.stateFile, "utf8")) as ExchangePolicy;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

function authorized(req: IncomingMessage, secret: string): boolean {
  const header = req.headers["x-api-key"];
  let provided = typeof header === "string" ? header : undefined;
  const auth = req.headers.authorization;
  if (provided === undefined && auth?.startsWith("Bearer ")) provided = auth.slice("Bearer ".length);
  if (provided === undefined) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "body_too_large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, PUT, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-api-key, authorization");
}

function methodNotAllowed(res: ServerResponse, allow: string) {
  res.setHeader("Allow", allow);
  send(res, 405, { error: "method_not_allowed" });
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  if (body === undefined) return res.end();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
