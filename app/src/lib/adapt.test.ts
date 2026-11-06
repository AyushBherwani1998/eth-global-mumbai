import { test } from "node:test";
import assert from "node:assert/strict";

import { bidRoom, holdingRows, lastPriceOf, sharesHeld, toMarket, toReference, toTrades, tradeGate, withHalts } from "./adapt.ts";
import type { Eligibility, HaltSpan, Holding, MarketView, Portfolio } from "./api";

function holding(over: Partial<Holding>): Holding {
  return {
    ticker: "acme",
    symbol: "ACME",
    token: "0x0000000000000000000000000000000000000001",
    shares: 0,
    unclaimedShares: 0,
    pendingBids: 0,
    price: 0.8,
    priceSource: "pool",
    value: null,
    avgCost: null,
    raw: { balance: "0", unclaimed: "0" },
    ...over,
  } as Holding;
}

function portfolio(holdings: Holding[]): Portfolio {
  return { holdings, bids: [], balances: { eth: 0, usdc: 0, raw: { eth: "0", usdc: "0" } } } as unknown as Portfolio;
}

const policy = {
  version: 3,
  mode: "normal",
  referencePrice: 1,
  bandBps: 2000,
  halted: false,
  since: "2026-11-06T10:00:00.000Z",
  asOf: "2026-11-06T10:00:00.000Z",
  coolOffMin: 10,
  coolOffUntil: null,
  creTx: null,
};

function market(over: Partial<MarketView>): MarketView {
  return {
    ticker: "acme",
    listed: true,
    usdcIsCurrency0: true,
    price: 1.01,
    listingPrice: 0.8,
    tradingOpen: true,
    halted: false,
    haltCause: null,
    policy,
    liquidity: { usdc: 10, shares: 10000 },
    events: [],
    trades: [],
    prices: [],
    reference: [],
    haltSpans: [],
    ...over,
  } as unknown as MarketView;
}

test("a wallet holding shares bought on the market, with no bids, still has a row and a share count", () => {
  const p = portfolio([holding({ ticker: "nirmaan", shares: 5000, value: 4.5 }), holding({ ticker: "tara" })]);
  assert.equal(sharesHeld(p, "nirmaan"), 5000);
  assert.deepEqual(
    holdingRows(p).map((h) => h.ticker),
    ["nirmaan"],
  );
  assert.equal(p.bids.length, 0);
});

test("shares still to collect and open bids each earn a row; unknown portfolio holds nothing", () => {
  const p = portfolio([holding({ ticker: "vayu", unclaimedShares: 14084 }), holding({ ticker: "kesar", pendingBids: 2 })]);
  assert.deepEqual(
    holdingRows(p).map((h) => h.ticker),
    ["vayu", "kesar"],
  );
  assert.equal(sharesHeld(p, "vayu"), 0, "unclaimed shares are not in the wallet yet");
  assert.equal(sharesHeld(null, "acme"), 0);
  assert.deepEqual(holdingRows(null), []);
});

test("bidRoom: at the per-wallet cap, partway, and when the module reports no cap", () => {
  const e = (cap: number | null, committed: number | null, remaining: number | null) => ({ cap, committed, remaining }) as Eligibility;
  assert.deepEqual(bidRoom(e(20, 20, 0)), { known: true, cap: 20, committed: 20, remaining: 0, atCap: true });
  assert.deepEqual(bidRoom(e(20, 5, 15)), { known: true, cap: 20, committed: 5, remaining: 15, atCap: false });
  assert.deepEqual(bidRoom(e(20, 25, -5)), { known: true, cap: 20, committed: 25, remaining: 0, atCap: true });
  assert.deepEqual(bidRoom(e(null, null, null)), { known: false });
  assert.deepEqual(bidRoom(null), { known: false });
});

test("tradeGate: open, cooling off (with its end time), report halt, stale, not listed, loading", () => {
  assert.deepEqual(tradeGate(market({})), { open: true });

  const cooling = tradeGate(market({ tradingOpen: false, haltCause: "coolingOff", policy: { ...policy, coolOffUntil: "2026-11-06T10:10:00.000Z" } as MarketView["policy"] }));
  assert.equal(cooling.open, false);
  assert.equal(!cooling.open && cooling.cause, "coolingOff");
  assert.equal(!cooling.open && cooling.until, "2026-11-06T10:10:00.000Z");

  // Cooling off blocks swaps without `halted`: the gate must follow tradingOpen, not halted.
  const coolingNotHalted = tradeGate(market({ tradingOpen: false, halted: false, haltCause: "coolingOff" }));
  assert.equal(coolingNotHalted.open, false);

  const report = tradeGate(market({ tradingOpen: false, halted: true, haltCause: "report" }));
  assert.equal(!report.open && report.cause, "report");
  const stale = tradeGate(market({ tradingOpen: false, haltCause: "stale" }));
  assert.equal(!stale.open && stale.cause, "stale");
  const notListed = tradeGate(market({ listed: false, tradingOpen: false }));
  assert.equal(!notListed.open && notListed.cause, "notListed");
  const loading = tradeGate(null);
  assert.equal(!loading.open && loading.cause, "unknown");
});

test("withHalts adds a flat, flagged pair per halt span at the price when it began", () => {
  const pts = [
    { time: 100, value: 1 },
    { time: 200, value: 1.2 },
    { time: 400, value: 1.1 },
  ];
  const spans: HaltSpan[] = [
    { from: "", to: "", fromTime: 250, toTime: 350, cause: "report", version: 2, tx: null },
    { from: "", to: null, fromTime: 450, toTime: null, cause: "coolingOff", version: 3, tx: null },
  ];
  const out = withHalts(pts, spans, 500);
  assert.deepEqual(out, [
    { time: 100, value: 1 },
    { time: 200, value: 1.2 },
    { time: 250, value: 1.2, halted: true },
    { time: 350, value: 1.2, halted: true },
    { time: 400, value: 1.1 },
    { time: 450, value: 1.1, halted: true },
    { time: 500, value: 1.1, halted: true },
  ]);
  assert.deepEqual(withHalts([], spans, 500), [], "no trades: nothing to draw");
  assert.equal(withHalts(pts, [], 500), pts);
});

test("trades show each trade's own average fill price, not the pool price after it", () => {
  const m = market({
    trades: [{ time: 1, side: "buy", usdc: 1.2, shares: 1000, price: 1.25, avgPrice: 1.2, tx: "0xab", block: 1, sender: "0x0", raw: {} }] as unknown as MarketView["trades"],
  });
  assert.equal(toTrades(m)[0].price, 1.2);
  assert.deepEqual(toTrades(null), []);
});

test("reference steps and the chart market come from the server's replay", () => {
  const m = market({
    prices: [
      { time: 100, value: 1, block: 1 },
      { time: 200, value: 1.05, block: 2 },
    ],
    reference: [
      { time: 50, value: 0.8, mode: "listing", bandBps: 500, low: 0.76, high: 0.84, version: 1, carryForward: false },
      { time: 150, value: 1, mode: "normal", bandBps: 2000, low: 0.8, high: 1.2, version: 2, carryForward: false },
      { time: 300, value: 1, mode: "normal", bandBps: 2000, low: 0.8, high: 1.2, version: 2, carryForward: true },
    ],
    haltSpans: [{ from: "", to: null, fromTime: 250, toTime: null, cause: "report", version: 3, tx: null }],
  });
  assert.deepEqual(
    toReference(m).map((r) => [r.time, r.value, r.bandBps]),
    [
      [50, 0.8, 500],
      [150, 1, 2000],
      [300, 1, 2000],
    ],
  );
  const chart = toMarket(m);
  assert.ok(chart);
  // A running halt is drawn up to the response head (the carry-forward point), not the machine clock.
  assert.deepEqual(chart.prices.at(-1), { time: 300, value: 1.05, halted: true });
  assert.equal(toMarket(market({ prices: [] })), null, "no trades yet: nothing to chart");
});

test("lastPriceOf: pool price, else last trade, else listing price, else null (documented nulls)", () => {
  assert.equal(lastPriceOf(market({ price: 1.01 })), 1.01);
  assert.equal(lastPriceOf(market({ price: null, prices: [{ time: 1, value: 0.9, block: 1 }] })), 0.9);
  assert.equal(lastPriceOf(market({ price: null, prices: [], listingPrice: 0.8 })), 0.8);
  assert.equal(lastPriceOf(market({ price: null, prices: [], listingPrice: null })), null);
  assert.equal(lastPriceOf(null), null);
});
