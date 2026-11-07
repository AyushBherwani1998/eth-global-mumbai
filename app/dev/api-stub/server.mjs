#!/usr/bin/env node
// Development stub for services/api. NOT app code, never imported by the app.
//
//   node dev/api-stub/server.mjs            # http://127.0.0.1:8788
//
// The real backend needs contracts/deployments/<network>.json, which only
// exists after a deploy. This serves the same routes, the same JSON shapes
// (services/api/README.md) and the same error envelope from fixtures, so the
// app can be run end to end with no chain.
//
// It is honest about being a stub: /health reports `rpc: "stub://fixtures"`
// and every response carries `X-Data-Source: stub`. The app reads that and
//
// Env:
//   PORT=8788            port
//   STUB_FAIL=RPC_ERROR  make every /v1 route fail with that code, to see the
//                        app's error states (also: BAD_REQUEST, INTERNAL, ...)
//   STUB_DELAY=400       milliseconds of latency, to see the skeletons

import { createServer } from "node:http";
import { build, DEMO_OWNER } from "./fixtures.mjs";

const PORT = Number(process.env.PORT ?? 8788);
const HOST = process.env.HOST ?? "127.0.0.1";
const FAIL = process.env.STUB_FAIL ?? "";
const DELAY = Number(process.env.STUB_DELAY ?? 0);

const STATUS_FOR = {
  BAD_REQUEST: 400,
  UNKNOWN_TICKER: 404,
  UNKNOWN_BID: 404,
  NOT_FOUND: 404,
  NOT_LAUNCHED: 409,
  RPC_ERROR: 502,
  INTERNAL: 500,
};

const MESSAGE_FOR = {
  BAD_REQUEST: "Bad query or body",
  UNKNOWN_TICKER: "Unknown ticker",
  UNKNOWN_BID: "Unknown bid",
  NOT_FOUND: "Not found",
  NOT_LAUNCHED: "No auction yet",
  RPC_ERROR: "The node failed",
  INTERNAL: "Stub failure (STUB_FAIL)",
};

function headers(origin) {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-data-source": "stub",
    "access-control-allow-origin": origin || "*",
    "access-control-allow-headers": "content-type,accept",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    vary: "origin",
  };
}

function json(res, origin, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { ...headers(origin), "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function fail(res, origin, code) {
  json(res, origin, STATUS_FOR[code] ?? 500, { error: { code, message: MESSAGE_FOR[code] ?? "Stub failure" } });
}

function route(url, search, body) {
  const f = build();
  const seg = url.split("/").filter(Boolean);
  const known = (t) => f.tickers.includes(t);

  if (url === "/health") {
    return {
      body: {
        ok: true,
        rpcChainId: f.chainId,
        block: f.currentBlock,
        chainId: f.chainId,
        // Deliberately not an RPC URL: the app marks this data as a demo.
        rpc: "stub://fixtures",
        deployments: f.tickers.map((t) => ({ file: "mock/demo-exchange.json", ticker: t, ok: true })),
      },
    };
  }

  if (seg[0] !== "v1") return { code: "NOT_FOUND" };

  if (seg[1] === "listings") {
    if (seg.length === 2) {
      return { body: { parent: f.parent, chainId: f.chainId, currentBlock: f.currentBlock, now: f.now, listings: f.listings } };
    }
    if (!known(seg[2])) return { code: "UNKNOWN_TICKER" };
    return { body: f.get(seg[2]).listingDetail };
  }

  if (seg[1] === "ens") {
    if (!known(seg[2])) return { code: "UNKNOWN_TICKER" };
    return { body: f.get(seg[2]).ens };
  }

  if (seg[1] === "auction") {
    if (!known(seg[2])) return { code: "UNKNOWN_TICKER" };
    const e = f.get(seg[2]);
    if (seg[3] === "clearing") return { body: e.clearing };
    if (seg.length === 3) {
      if (e.auction.phase === "notLaunched") return { code: "NOT_LAUNCHED" };
      return { body: e.auction };
    }
    return { code: "NOT_FOUND" };
  }

  if (seg[1] === "policy") {
    if (!known(seg[2])) return { code: "UNKNOWN_TICKER" };
    const e = f.get(seg[2]);
    if (!e.policy) return { code: "NOT_LAUNCHED" };
    return { body: e.policy };
  }

  if (seg[1] === "market") {
    if (!known(seg[2])) return { code: "UNKNOWN_TICKER" };
    const e = f.get(seg[2]);
    if (seg[3] === "swaps") {
      const limit = Number(search.get("limit") ?? 0);
      const trades = limit > 0 ? e.swaps.trades.slice(0, limit) : e.swaps.trades;
      return { body: { ...e.swaps, trades } };
    }
    if (seg.length === 3) {
      if (!e.market) return { code: "NOT_LAUNCHED" };
      const limit = Number(search.get("limit") ?? 0);
      return { body: limit > 0 ? { ...e.market, trades: e.market.trades.slice(0, limit), tradesLimit: limit } : e.market };
    }
    return { code: "NOT_FOUND" };
  }

  if (seg[1] === "bids" && seg.length === 2) {
    const ticker = search.get("ticker");
    if (ticker && !known(ticker)) return { code: "UNKNOWN_TICKER" };
    return { body: f.bidsFor(search.get("owner"), ticker) };
  }

  if (seg[1] === "portfolio" && seg.length === 3) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(seg[2])) return { code: "BAD_REQUEST" };
    return { body: f.portfolio(seg[2]) };
  }

  if (seg[1] === "issuer" && seg.length === 3) {
    if (!known(seg[2])) return { code: "UNKNOWN_TICKER" };
    return { body: f.issuer(seg[2], search.get("address")) };
  }

  if (seg[1] === "eligibility" && seg.length === 2) {
    const ticker = search.get("ticker");
    const address = search.get("address");
    if (!address) return { code: "BAD_REQUEST" };
    if (!ticker || !known(ticker)) return { code: "UNKNOWN_TICKER" };
    return { body: f.eligibility(ticker, address) };
  }

  // Prepare: the stub never signs either. It returns a well-formed, already
  // allowed single step so the write path can be walked without a wallet.
  if (seg[1] === "prepare" && seg.length === 3) {
    const action = seg[2];
    if (!["bid", "swap", "exit", "claim"].includes(action)) return { code: "NOT_FOUND" };
    const ticker = body?.ticker ?? f.tickers[0];
    if (!known(ticker)) return { code: "UNKNOWN_TICKER" };
    const from = body?.from ?? body?.owner ?? DEMO_OWNER;
    const to = action === "swap" ? f.external.universalRouter : f.get(ticker).listing.records.auction;
    const step = {
      kind: action === "bid" ? "submitBid" : action === "swap" ? "swap" : action === "exit" ? "exitBid" : "claimTokens",
      to,
      data: "0x00",
      value: "0",
      needed: true,
      description: `Stub: ${action}`,
    };
    return {
      body: {
        ticker,
        action,
        from,
        chainId: f.chainId,
        to,
        data: "0x00",
        value: "0",
        steps: [step],
        permit2: null,
        simulate: { ok: true, method: "eth_call", block: f.currentBlock, error: null, gasUsed: "180000", note: "stub" },
        details: { stub: true, warnings: [] },
      },
    };
  }

  return { code: "NOT_FOUND" };
}

const server = createServer((req, res) => {
  const origin = req.headers.origin ?? "";
  if (req.method === "OPTIONS") {
    res.writeHead(204, headers(origin));
    res.end();
    return;
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const parsed = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    let body = null;
    if (chunks.length) {
      try {
        body = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        json(res, origin, 400, { error: { code: "BAD_REQUEST", message: "Body is not JSON" } });
        return;
      }
    }

    const finish = () => {
      if (FAIL && parsed.pathname.startsWith("/v1")) return fail(res, origin, FAIL);
      let out;
      try {
        out = route(parsed.pathname, parsed.searchParams, body);
      } catch (e) {
        console.error(e);
        return fail(res, origin, "INTERNAL");
      }
      if (out.code) return fail(res, origin, out.code);
      json(res, origin, 200, out.body);
    };

    if (DELAY > 0) setTimeout(finish, DELAY);
    else finish();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`api-stub listening on http://${HOST}:${PORT}  (fixtures, no chain)`);
  console.log(`point the app at it:  NEXT_PUBLIC_API_URL=http://${HOST}:${PORT}`);
  if (FAIL) console.log(`every /v1 route will fail with ${FAIL}`);
});
