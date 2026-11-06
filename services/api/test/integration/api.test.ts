/**
 * Every endpoint against an anvil Sepolia fork running the demo deploy (scripts/integration.sh sets it up):
 * acme = the full rehearsal (settled, listed, traded, halted, resumed, ENS); kesar = a second listing whose
 * auction is live. Prepared transactions are sent from impersonated wallets, so the calldata is proven onchain,
 * not only in simulation. Skipped unless RPC_URL and DEPLOYMENTS_FILES are set.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createWalletClient, encodeAbiParameters, http, keccak256, toHex, type Address, type Hex } from "viem";

import { createApp } from "../../src/app.ts";
import { createClient } from "../../src/chain.ts";
import { loadConfig } from "../../src/config.ts";
import type {
  Auction,
  BidsResponse,
  ClearingResponse,
  ConfigResponse,
  Eligibility,
  EnsView,
  Health,
  IssuerView,
  ListingDetail,
  ListingsResponse,
  MarketView,
  PolicyHistory,
  PolicyView,
  Portfolio,
  Prepared,
  SwapQuote,
  SwapsResponse,
} from "../../src/types.ts";

const enabled = !!process.env.RPC_URL && !!process.env.DEPLOYMENTS_FILES;
const config = loadConfig(process.env);
const client = createClient(config);
const app = createApp({ config, client });
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as const;
const BIDDER = "0x00000000000000000000000000000000000b1d01" as Address;
const TRADER = "0x00000000000000000000000000000000000b1d02" as Address;

async function get<T>(path: string): Promise<T> {
  const res = await app.request(path);
  const body = await res.json();
  assert.equal(res.status, 200, `${path}: ${JSON.stringify(body)}`);
  return body as T;
}

async function prepare(action: string, body: Record<string, unknown>): Promise<Prepared> {
  const res = await app.request(`/v1/prepare/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json();
  assert.equal(res.status, 200, `${action}: ${JSON.stringify(j)}`);
  const p = j as Prepared;
  const main = p.steps.at(-1)!;
  assert.deepEqual({ to: p.to, data: p.data, value: p.value }, { to: main.to, data: main.data, value: main.value });
  assert.equal(p.chainId, 31337);
  return p;
}

const rpc = (method: string, params: unknown[]) => client.request({ method, params } as never);

async function fundUsdc(who: Address, raw: bigint) {
  // FiatTokenV2_2 balances live in mapping slot 9 (top bit = blacklist flag).
  const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [who, 9n]));
  await rpc("anvil_setStorageAt", [USDC, slot, toHex(raw, { size: 32 })]);
  await rpc("anvil_setBalance", [who, toHex(10n ** 18n)]);
}

/** Sends the needed steps the way MetaMask would (one tx each, in order) from an impersonated wallet. */
async function send(p: Prepared, from: Address) {
  await rpc("anvil_impersonateAccount", [from]);
  const wallet = createWalletClient({ transport: http(config.rpcUrl) });
  for (const s of p.steps.filter((x) => x.needed)) {
    const hash = await wallet.sendTransaction({ account: from, to: s.to, data: s.data as Hex, value: BigInt(s.value), chain: null });
    const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 250 });
    assert.equal(receipt.status, "success", `${s.kind} reverted`);
  }
}

describe("API against the anvil demo fork", { skip: !enabled && "set RPC_URL and DEPLOYMENTS_FILES (npm run test:integration)" }, () => {
  test("/health", async () => {
    const h = await get<Health>("/health");
    assert.equal(h.ok, true);
    assert.equal(h.rpcChainId, 31337);
    assert.deepEqual(h.deployments.map((d) => [d.ticker, d.ok]), [["acme", true], ["kesar", true]]);
  });

  test("GET /v1/listings", async () => {
    const r = await get<ListingsResponse>("/v1/listings");
    assert.equal(r.chainId, 31337);
    const [acme, kesar] = r.listings;
    assert.equal(acme?.ticker, "acme");
    assert.equal(acme?.status, "listed");
    assert.equal(acme?.statusSource, "ens");
    assert.equal(acme?.phase, "listed");
    assert.equal(acme?.eligibility, "open");
    assert.equal(acme?.clearingPrice, 1.1);
    assert.equal(acme?.graduated, true);
    assert.equal(acme?.bidCount, 5);
    assert.ok(acme?.listedAt);
    assert.equal(kesar?.ticker, "kesar");
    assert.equal(kesar?.status, "auction");
    assert.equal(kesar?.phase, "live");
  });

  test("GET /v1/listings/:ticker", async () => {
    const d = await get<ListingDetail>("/v1/listings/acme");
    assert.equal(d.offer.issuePrice, 1);
    assert.equal(d.offer.capPrice, 1.9);
    assert.equal(d.offer.perApplicantCap, 20);
    assert.equal(d.records.hook, d.contracts.listingHook);
    assert.equal(d.external.usdc, USDC);
  });

  test("GET /v1/ens/:ticker resolves the demo records through the Universal Resolver", async () => {
    const e = await get<EnsView>("/v1/ens/acme");
    assert.equal(e.resolved, true);
    assert.equal(e.records["listingday.status"], "listed");
    assert.deepEqual(Object.values(e.matchesDeployment), [true, true, true, true, true]);
    await get<EnsView>("/v1/ens/kesar"); // no ENS records yet: still 200
  });

  test("GET /v1/auction/:ticker and /clearing (settled acme)", async () => {
    const a = await get<Auction>("/v1/auction/acme");
    assert.equal(a.phase, "claimable");
    assert.equal(a.graduated, true);
    assert.equal(a.clearingPrice, 1.1);
    assert.equal(a.raised, 99);
    assert.equal(a.bidCount, 5);
    assert.equal(a.applicants, 5);
    assert.equal(a.floorPrice, 0.8);
    const c = await get<ClearingResponse>("/v1/auction/acme/clearing");
    assert.ok(c.series.length >= 2);
    assert.equal(c.series.at(-1)?.price, 1.1);
    for (let i = 1; i < c.series.length; i++) assert.ok(c.series[i]!.block >= c.series[i - 1]!.block);
  });

  test("GET /v1/bids (all claimed after the demo)", async () => {
    const r = await get<BidsResponse>("/v1/bids?ticker=acme");
    assert.equal(r.bids.length, 5);
    assert.equal(r.committed.acme, 99);
    for (const b of r.bids) {
      assert.equal(b.state, "claimed");
      assert.equal(b.status, "claimed");
      assert.equal(b.key, `${b.auction.toLowerCase()}:${b.id}`);
      assert.ok((b.filledShares ?? 0) > 0);
      assert.deepEqual([b.claimableShares, b.refundableUsdc], [0, 0]);
      assert.deepEqual(b.actions, { exit: null, claim: false });
    }
    assert.equal(new Set(r.bids.map((b) => b.key)).size, r.bids.length);
    const owner = r.bids[0]!.owner;
    const mine = await get<BidsResponse>(`/v1/bids?owner=${owner}`);
    assert.ok(mine.bids.length >= 1);
    assert.ok(mine.bids.every((b) => b.owner === owner));
  });

  test("GET /v1/policy/:ticker (resumed after the halt, listing day)", async () => {
    const p = await get<PolicyView>("/v1/policy/acme");
    assert.equal(p.halted, false);
    assert.equal(p.mode, "listing");
    assert.equal(p.hookPhase, "ListingDay");
    assert.equal(p.bandBps, 500);
    assert.ok(p.version >= 2);
    assert.equal(p.stale, false);
    assert.ok(p.staleAt);
    assert.ok(p.creTx);
    assert.equal(p.referencePrice, 1.1);
    assert.deepEqual(p.band && [p.band.low, p.band.high], [1.045, 1.155]);
    const k = await get<PolicyView>("/v1/policy/kesar");
    assert.equal(k.hookPhase, "NotListed");
    assert.equal(k.version, 0);
  });

  test("GET /v1/market/:ticker and /swaps", async () => {
    const m = await get<MarketView>("/v1/market/acme");
    assert.equal(m.listed, true);
    assert.equal(m.usdcIsCurrency0, true);
    assert.ok(m.price !== null && m.band !== null && m.price >= m.band.low && m.price <= m.band.high);
    assert.ok(m.liquidity.usdc > 0 && m.liquidity.shares > 0);
    assert.deepEqual(m.events.map((e) => e.kind), ["listing", "halted", "normal"]);
    assert.deepEqual([m.referencePrice, m.halted, m.haltCause, m.tradingOpen], [1.1, false, null, true]);
    assert.ok(m.trades.length >= 1);
    assert.equal(m.prices.length, m.trades.length);
    assert.ok(m.trades.every((t) => t.avgPrice > 0));
    assert.deepEqual(m.haltSpans.map((h) => h.cause), ["report"]);
    assert.equal(m.reference.at(-1)?.carryForward, true);
    const s = await get<SwapsResponse>("/v1/market/acme/swaps");
    assert.ok(s.trades.length >= 1);
    assert.equal(s.trades[0]?.side, "buy");
    assert.equal(s.prices.length, s.trades.length);
    const k = await get<MarketView>("/v1/market/kesar");
    assert.equal(k.listed, false);
    assert.equal(k.price, null);
  });

  test("GET /v1/policy/:ticker/history (listing, halt, resume)", async () => {
    const h = await get<PolicyHistory>("/v1/policy/acme/history");
    assert.equal(h.listing?.listingPrice, 1.1);
    assert.ok(h.entries.length >= 2);
    assert.equal(h.entries[0]?.halted, true);
    assert.equal(h.spans[0]?.trigger, "listed");
    assert.equal(h.spans.at(-1)?.toTime, null);
    assert.ok(h.spans.every((s) => s.tradingMode === "listing" && s.bandBps === 500));
    assert.deepEqual(h.haltSpans.map((s) => [s.cause, s.version]), [["report", 1]]);
    const k = await get<PolicyHistory>("/v1/policy/kesar/history");
    assert.deepEqual([k.listing, k.spans.length], [null, 0]);
  });

  test("GET /v1/issuer/:ticker: the ENS addr is the token, the issuer owns the name", async () => {
    const i = await get<IssuerView>("/v1/issuer/acme");
    assert.equal(i.ensAddr, i.token.address);
    assert.equal(i.ensAddrIsToken, true);
    assert.equal(i.issuer.source, "ens");
    assert.notEqual(i.issuer.address, i.token.address);
    const owner = i.roles.find((r) => r.role === "ens.nameOwner")?.holder;
    assert.equal(owner, i.issuer.address);
    const c = await get<IssuerView>(`/v1/issuer/acme?address=${i.issuer.address}`);
    assert.equal(c.check?.isIssuer, true);
    assert.ok(c.check?.roles.includes("ens.nameOwner"));
    assert.equal((await get<IssuerView>(`/v1/issuer/acme?address=${BIDDER}`)).check?.isIssuer, false);
  });

  test("GET /v1/config lists both listings without RPC data", async () => {
    const c = await get<ConfigResponse>("/v1/config");
    assert.deepEqual(c.listings.map((l) => l.ticker), ["acme", "kesar"]);
    assert.equal(c.listings[0]?.contracts.listingHook, c.listings[0]?.pool.poolKey.hooks);
  });

  test("GET /v1/eligibility (open listing, per-wallet cap)", async () => {
    const e = await get<Eligibility>(`/v1/eligibility?ticker=kesar&address=${BIDDER}`);
    assert.deepEqual([e.eligible, e.mode, e.cap, e.committed, e.remaining], [true, "open", 20, 0, 20]);
  });

  test("POST /v1/prepare/bid: simulate, send, read back, then the cap", async () => {
    await fundUsdc(BIDDER, 50_000_000n);
    const p = await prepare("bid", { ticker: "kesar", owner: BIDDER, budget: 10, maxPrice: 1.3 });
    assert.deepEqual(p.steps.map((s) => [s.kind, s.needed]), [["approveUsdcToPermit2", true], ["permit2Approve", true], ["submitBid", true]]);
    assert.equal(p.permit2?.spender, p.to);
    assert.equal(p.permit2?.amount, "10000000");
    assert.equal(p.simulate.ok, true, JSON.stringify(p.simulate));
    assert.equal(p.simulate.method, "eth_simulateV1");
    await send(p, BIDDER);

    const bids = await get<BidsResponse>(`/v1/bids?ticker=kesar&owner=${BIDDER}`);
    assert.equal(bids.bids.length, 1);
    assert.deepEqual([bids.bids[0]?.state, bids.bids[0]?.budget, bids.bids[0]?.maxPrice], ["active", 10, 1.3]);
    assert.deepEqual([bids.bids[0]?.status, bids.bids[0]?.claimableShares, bids.bids[0]?.refundableUsdc], ["open", null, null]);
    const pf = await get<Portfolio>(`/v1/portfolio/${BIDDER}`);
    assert.equal(pf.balances.usdc, 40);
    assert.equal(pf.bids.length, 1);
    assert.equal(pf.totals.inAuctionUsdc, 10);
    assert.equal(pf.holdings.find((x) => x.ticker === "kesar")?.pendingBids, 1);
    assert.equal(pf.holdings.find((x) => x.ticker === "kesar")?.priceSource, "clearing");
    const e = await get<Eligibility>(`/v1/eligibility?ticker=kesar&address=${BIDDER}`);
    assert.deepEqual([e.committed, e.remaining], [10, 10]);
    const a = await get<Auction>("/v1/auction/kesar");
    assert.deepEqual([a.phase, a.bidCount, a.committed], ["live", 1, 10]);

    const over = await prepare("bid", { ticker: "kesar", owner: BIDDER, budget: 15, maxPrice: 1.3 });
    assert.equal(over.steps[0]?.needed, false); // USDC -> Permit2 is a one-time max approval
    assert.equal(over.simulate.ok, false);
    assert.equal(over.simulate.error?.name, "CapExceeded");
    assert.deepEqual(over.simulate.error?.wrappers, ["ValidationHookCallFailed"]);
    const above = await prepare("bid", { ticker: "kesar", owner: BIDDER, budget: 5, maxPricePoints: 250 });
    assert.equal(above.simulate.error?.name, "BidAboveCap");
    const late = await prepare("bid", { ticker: "acme", owner: BIDDER, budget: 5, maxPrice: 1.3 });
    assert.equal(late.simulate.error?.name, "AuctionIsOver");
  });

  test("POST /v1/prepare/swap: in-band buy and sell are sent; out-of-band is OutOfBand", async () => {
    await fundUsdc(TRADER, 5_000_000n);
    const before = (await get<SwapsResponse>("/v1/market/acme/swaps")).trades.length;
    const buy = await prepare("swap", { ticker: "acme", from: TRADER, side: "buy", amount: 0.05 });
    assert.equal(buy.simulate.ok, true, JSON.stringify(buy.simulate));
    const q = buy.details.quote as SwapQuote;
    assert.equal(q.ok, true);
    assert.equal(q.priceAfterSource, "simulation");
    assert.ok(q.priceAfter! > q.priceBefore! && q.priceImpactBps! > 0, JSON.stringify(q));
    await send(buy, TRADER);
    const after = await get<SwapsResponse>("/v1/market/acme/swaps");
    assert.equal(after.trades.length, before + 1);
    assert.equal(after.trades[0]?.side, "buy");
    assert.equal(after.trades[0]?.usdc, 0.05);

    const sell = await prepare("swap", { ticker: "acme", from: TRADER, side: "sell", amount: 10 });
    assert.equal(sell.simulate.ok, true, JSON.stringify(sell.simulate));
    await send(sell, TRADER);
    assert.equal((await get<SwapsResponse>("/v1/market/acme/swaps")).trades[0]?.side, "sell");

    const big = await prepare("swap", { ticker: "acme", from: TRADER, side: "buy", amount: 4 });
    assert.equal(big.simulate.ok, false);
    assert.equal(big.simulate.error?.name, "OutOfBand");
    assert.match(big.simulate.error?.message ?? "", /Outside today's price band \(1\.045 to 1\.155 USDC \/ lot\)/);
    const bq = big.details.quote as SwapQuote;
    assert.equal(bq.error?.name, "OutOfBand");
    assert.equal(bq.priceAfterSource, "revert");
    assert.ok(bq.priceAfter! > 1.155, JSON.stringify(bq));
  });

  test("POST /v1/prepare/exit and /claim", async () => {
    const exited = await prepare("exit", { ticker: "acme", bidId: 0 });
    assert.equal(exited.simulate.error?.name, "BidAlreadyExited");
    assert.equal(exited.details.reason, "already exited");
    const claim = await prepare("claim", { ticker: "acme", bidId: 0 });
    assert.equal(claim.steps[0]?.kind, "claimTokens");
    assert.deepEqual(claim.details.warnings, ["nothing to claim: already claimed, or the bid filled 0 shares"]);

    const live = await get<BidsResponse>(`/v1/bids?ticker=kesar&owner=${BIDDER}`);
    const early = await prepare("exit", { ticker: "kesar", bidId: live.bids[0]!.id });
    assert.equal(early.simulate.ok, false);
    assert.match(String(early.details.reason), /still active/);
    const unknown = await app.request("/v1/prepare/exit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker: "acme", bidId: 999 }) });
    assert.equal(unknown.status, 404);
  });
});
