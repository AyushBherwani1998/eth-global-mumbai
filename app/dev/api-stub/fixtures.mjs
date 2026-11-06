// Expands app/mock/demo-exchange.json into the exact response shapes of
// services/api (see its README and src/types.ts). Not app code, never bundled.
//
// Everything is built relative to the moment the server starts, so every chart
// window from 5m to All has real shape. The spec holds the story (who exists,
// what phase they are in, which rule changes landed when); this file turns it
// into listings, auctions, clearing series, policies, pools, swaps and bids.
//
// Acme's numbers are the ones live Acme shows on Sepolia: cleared at 0.80, 60
// USDC raised, 3 applicants, policy version 5. Every other company here is a
// demo, which is why the stub tells the app so (`/health` → stub://fixtures)
// and the app marks every screen while it is pointed here.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = JSON.parse(readFileSync(join(HERE, "..", "..", "mock", "demo-exchange.json"), "utf8"));

const BLOCK_SECONDS = 12;
const BLOCKS_PER_MIN = 60 / BLOCK_SECONDS;

export const DEMO_OWNER = "0x7a3F9e21C04b8D5a6E1f2B3c4D5e6F7a8B9cC91E";

const EXTERNAL = {
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203620",
  universalRouter: "0xf8F7a5C7e9B1d3F5a7C9e1B3d5F7a9C1e3B5c22A",
  quoter: "0x61B3f2011A92d183C7dbaDBdA940a7555cCf9227",
  stateView: "0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  universalResolver: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
};

const OTHER_BIDDER = "0x19bD4f6E8b0A5c7D9e2F1b3A6c8E0d4F5a3E7b02";

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r4 = (n) => Math.round(n * 10000) / 10000;
const r6 = (n) => Math.round(n * 1e6) / 1e6;
const iso = (sec) => new Date(Math.round(sec) * 1000).toISOString();
const seedOf = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/** A deterministic 20-byte address per (ticker, role), so every page is stable. */
function addrFor(ticker, role) {
  const rand = rng(seedOf(`${ticker}:${role}`));
  let hex = "";
  for (let i = 0; i < 40; i += 1) hex += "0123456789abcdef"[Math.floor(rand() * 16)];
  return `0x${hex}`;
}
function hashFor(ticker, role) {
  return `${addrFor(ticker, `${role}:a`)}${addrFor(ticker, `${role}:b`).slice(2, 26)}`;
}

/**
 * Resolution by age: 5s for the last quarter hour, 20s for the last hour, 1m
 * for the last six, 5m for the rest of today, 20m for older days. Enough shape
 * for the 5m chip without a megabyte of JSON for the All chip.
 */
function stepAt(ageSec) {
  if (ageSec <= 900) return 5;
  if (ageSec <= 3600) return 20;
  if (ageSec <= 6 * 3600) return 60;
  if (ageSec <= 24 * 3600) return 300;
  return 1200;
}

const band = (ref, bps) => ({
  low: r4(ref * (1 - bps / 10000)),
  high: r4(ref * (1 + bps / 10000)),
  lowPoints: r4(ref * 100 * (1 - bps / 10000)),
  highPoints: r4(ref * 100 * (1 + bps / 10000)),
});

/** Mean-reverting walk through the policy segments, clipped to each band. */
function walk(company, nowSec) {
  const policies = company.policy ?? [];
  if (policies.length === 0) return [];
  const rand = rng(seedOf(company.ticker));
  const vol = company.pool?.vol ?? 0.005;
  const points = [];
  let p = policies[0].ref;

  for (let i = 0; i < policies.length; i += 1) {
    const seg = policies[i];
    const from = nowSec - seg.minutesAgo * 60;
    const to = i + 1 < policies.length ? nowSec - policies[i + 1].minutesAgo * 60 : nowSec;
    const b = band(seg.ref, seg.bandBps);
    let t = from;
    while (t <= to) {
      const step = stepAt(nowSec - t);
      if (seg.halted) {
        points.push({ time: Math.round(t), value: r4(p), halted: true });
      } else {
        const scale = step / 300;
        const shock = (rand() - 0.5) * 2 * vol * p * Math.sqrt(scale);
        const pull = (seg.target - p) * 0.08 * scale;
        p = Math.min(b.high * 0.995, Math.max(b.low * 1.005, p + shock + pull));
        points.push({ time: Math.round(t), value: r4(p) });
      }
      t += step;
    }
  }
  return points;
}

/** One trade per few price points, newest first, with the router as sender. */
function tradesFrom(company, points, listBlock) {
  const rand = rng(seedOf(`${company.ticker}:trades`));
  const out = [];
  for (let i = points.length - 1; i > 1 && out.length < 60; i -= 1) {
    if (points[i].halted) continue;
    if (rand() < 0.86) continue;
    const up = points[i].value >= points[i - 1].value;
    const usdc = r6(0.3 + rand() * 3.1);
    const sharesOut = r6((usdc / points[i].value) * 1000);
    out.push({
      time: points[i].time,
      side: up ? "buy" : "sell",
      usdc,
      shares: sharesOut,
      price: points[i].value,
      tx: hashFor(company.ticker, `swap${i}`),
      block: listBlock + i,
      sender: EXTERNAL.universalRouter,
      raw: {
        amount0: String(Math.round(usdc * -1e6)),
        amount1: String(Math.round(sharesOut * 1e18)),
        sqrtPriceX96: "2346535657612926232651887599287742833",
        tick: 344094,
        liquidity: "537293216038455",
      },
    });
  }
  return out;
}

/** CCA checkpoints: the clearing price only ever rises, and the raise with it. */
function clearingSeries(company, nowSec, startBlock) {
  const a = company.auction ?? {};
  if (a.startedMinutesAgo === undefined) return [];
  const rand = rng(seedOf(`${company.ticker}:clearing`));
  const floor = SPEC.offer.floorPrice;
  const final = a.clearing ?? floor;
  const target = a.raised ?? 0;
  const startSec = nowSec - a.startedMinutesAgo * 60;
  const endSec = a.endedMinutesAgo !== undefined ? nowSec - a.endedMinutesAgo * 60 : nowSec;
  const span = Math.max(60, endSec - startSec);
  const out = [];
  let p = floor;
  let raised = 0;
  for (let i = 0; i <= 24; i += 1) {
    const progress = i / 24;
    const want = floor + (final - floor) * Math.pow(progress, 0.7);
    if (want > p && rand() < 0.6) p = Math.min(want, p + (want - p) * (0.5 + rand() * 0.8));
    raised = Math.max(raised, target * Math.pow(progress, 0.85) * (0.96 + rand() * 0.04));
    const time = Math.round(startSec + span * progress);
    out.push({
      block: startBlock + i * 12,
      time,
      price: r4(p),
      points: r4(p * 100),
      raised: Math.round(raised * 100) / 100,
      committed: Math.round(raised * 100) / 100,
      raw: { clearingPriceQ96: "63382530011360", currencyRaised: String(Math.round(raised * 1e6)), cumulativeMps: null },
    });
  }
  out[out.length - 1].price = r4(final);
  out[out.length - 1].points = r4(final * 100);
  out[out.length - 1].raised = target;
  out[out.length - 1].committed = target;
  return out;
}

export function build(nowSec = Math.floor(Date.now() / 1000)) {
  const currentBlock = SPEC.currentBlock;
  const blockAt = (minutesAgo) => Math.round(currentBlock - minutesAgo * BLOCKS_PER_MIN);
  const offer = SPEC.offer;

  const byTicker = new Map();

  for (const c of SPEC.companies) {
    const a = c.auction ?? {};
    const records = {
      addr: addrFor(c.ticker, "token"),
      token: addrFor(c.ticker, "token"),
      auction: a.startedMinutesAgo === undefined && a.startsInMinutes === undefined ? null : addrFor(c.ticker, "auction"),
      hook: addrFor(c.ticker, "hook"),
      policy: addrFor(c.ticker, "policy"),
      pool: c.policy ? addrFor(c.ticker, "pool").padEnd(66, "0") : null,
    };

    const startBlock =
      a.startedMinutesAgo !== undefined ? blockAt(a.startedMinutesAgo) : a.startsInMinutes !== undefined ? blockAt(-a.startsInMinutes) : null;
    const endBlock =
      a.endedMinutesAgo !== undefined ? blockAt(a.endedMinutesAgo) : a.endsInMinutes !== undefined ? blockAt(-a.endsInMinutes) : null;
    const claimBlock = a.claimMinutesAgo !== undefined ? blockAt(a.claimMinutesAgo) : endBlock === null ? null : endBlock + 100;

    const listedAt = c.listedMinutesAgo !== undefined ? iso(nowSec - c.listedMinutesAgo * 60) : null;
    const listBlock = c.listedMinutesAgo !== undefined ? blockAt(c.listedMinutesAgo) : currentBlock;

    const listing = {
      ticker: c.ticker,
      symbol: c.symbol,
      name: c.name,
      ensName: `${c.ticker}.${SPEC.parent}`,
      // Always null, exactly as the real proxy returns them.
      sector: null,
      city: null,
      description: c.description ?? null,
      url: c.url ?? null,
      avatar: { ...c.avatar, uri: null },
      status: c.status,
      statusSource: "ens",
      phase: c.phase,
      eligibility: c.eligibility,
      clearingPrice: a.clearing ?? null,
      clearingPoints: a.clearing === undefined ? null : r4(a.clearing * 100),
      graduated: a.graduated ?? null,
      listedAt,
      raised: a.raised ?? null,
      bidCount: a.bidCount ?? 0,
      applicants: a.applicants ?? 0,
      startBlock,
      endBlock,
      claimBlock,
      records,
      raw: {
        clearingPriceQ96: a.clearing === undefined ? null : "63382530011360",
        currencyRaised: a.raised === undefined ? null : String(Math.round(a.raised * 1e6)),
      },
    };

    const listingDetail = {
      ...listing,
      offer,
      chainId: SPEC.chainId,
      deployBlock: (startBlock ?? currentBlock) - 100,
      contracts: {
        token: records.token,
        auction: records.auction,
        hook: records.hook,
        policyReceiver: records.policy,
        validationHook: addrFor(c.ticker, "validation"),
        eligibilityModule: addrFor(c.ticker, "eligibility"),
      },
      external: EXTERNAL,
    };

    // ---- auction -------------------------------------------------------
    let auctionPhase = "notLaunched";
    let blocksRemaining = null;
    if (a.startsInMinutes !== undefined) {
      auctionPhase = "upcoming";
      blocksRemaining = Math.round(a.startsInMinutes * BLOCKS_PER_MIN);
    } else if (a.endsInMinutes !== undefined) {
      auctionPhase = "live";
      blocksRemaining = Math.round(a.endsInMinutes * BLOCKS_PER_MIN);
    } else if (a.claimMinutesAgo !== undefined) {
      auctionPhase = "claimable";
    } else if (a.endedMinutesAgo !== undefined) {
      auctionPhase = "ended";
    }

    const auction = {
      ticker: c.ticker,
      address: records.auction,
      phase: auctionPhase,
      currentBlock,
      startBlock,
      endBlock,
      claimBlock,
      migrationBlock: claimBlock === null ? null : claimBlock + 1,
      blocksRemaining,
      clearingPrice: a.clearing ?? null,
      clearingPoints: a.clearing === undefined ? null : r4(a.clearing * 100),
      floorPrice: offer.floorPrice,
      capPrice: offer.capPrice,
      issuePrice: offer.issuePrice,
      tickSpacingPoints: 1,
      raised: a.raised ?? null,
      requiredRaise: offer.requiredRaise,
      targetRaise: offer.targetRaise,
      graduated: a.graduated ?? null,
      totalSupply: offer.auctioned,
      totalCleared: a.clearing && a.raised ? r4((a.raised / a.clearing) * 1000) : null,
      committed: a.raised ?? 0,
      bidCount: a.bidCount ?? 0,
      applicants: a.applicants ?? 0,
      perApplicantCap: offer.perApplicantCap,
      validationHook: addrFor(c.ticker, "validation"),
      eligibilityModule: addrFor(c.ticker, "eligibility"),
      tokensRecipient: addrFor(c.ticker, "treasury"),
      fundsRecipient: addrFor(c.ticker, "funds"),
      offer,
      raw: {
        clearingPriceQ96: a.clearing === undefined ? null : "63382530011360",
        floorPriceQ96: "63382530011360",
        capPriceQ96: "150533508776980",
        tickSpacingQ96: "792281625142643",
        onePointQ96: "792281625142643",
        currencyRaised: a.raised === undefined ? null : String(Math.round(a.raised * 1e6)),
        requiredCurrencyRaised: String(offer.requiredRaise * 1e6),
        totalSupply: "90000000000000000000000",
        totalCleared: null,
        committed: String(Math.round((a.raised ?? 0) * 1e6)),
      },
    };

    const clearing = { ticker: c.ticker, auction: records.auction, series: clearingSeries(c, nowSec, startBlock ?? currentBlock) };

    // ---- policy, pool and swaps ---------------------------------------
    let policy = null;
    let market = null;
    let swaps = { ticker: c.ticker, poolId: records.pool ?? "0x", trades: [], prices: [] };

    if (c.policy && c.policy.length > 0) {
      const current = c.policy[c.policy.length - 1];
      const points = walk(c, nowSec);
      const trades = tradesFrom(c, points, listBlock);
      const b = band(current.ref, current.bandBps);
      const halted = Boolean(current.halted);
      const sinceSec = nowSec - current.minutesAgo * 60;
      const listingDayEnds = c.listedMinutesAgo === undefined ? null : iso(nowSec - c.listedMinutesAgo * 60 + 24 * 3600);
      const hookPhase = current.mode === "listing" ? "ListingDay" : "Normal";

      policy = {
        ticker: c.ticker,
        version: current.version,
        mode: halted ? "halted" : current.mode,
        referencePrice: current.ref,
        referencePoints: r4(current.ref * 100),
        bandBps: current.bandBps,
        halted,
        since: iso(sinceSec),
        asOf: iso(sinceSec - 30),
        coolOffMin: current.coolOffMin ?? 0,
        coolOffUntil: current.coolOffMin ? iso(sinceSec + current.coolOffMin * 60) : null,
        creTx: hashFor(c.ticker, `policy${current.version}`),
        hookPhase,
        band: halted ? null : b,
        listingDayEndsAt: listingDayEnds,
        stale: false,
        staleAt: iso(sinceSec + 86400),
        maxAge: 86400,
        policyMode: current.mode === "surveillance" ? 1 : current.mode === "directional" ? 2 : 0,
        normalBandBps: 2000,
        survBandBps: 500,
        receiver: records.policy,
        receiverStatus: c.status,
        raw: {
          refSqrtPriceX96: "2227537199353396563404014697",
          sqrtPriceMinX96: "2172109306657558409890265168",
          sqrtPriceMaxX96: "2282965092049234716917764226",
          asOf: String(Math.round(sinceSec - 30)),
          coolOffUntil: "0",
          staleAt: String(Math.round(sinceSec + 86400)),
          latestHalted: halted,
        },
      };

      const lastPrice = points.length ? points[points.length - 1].value : current.ref;

      market = {
        ticker: c.ticker,
        listed: true,
        hookPhase,
        mode: policy.mode,
        usdcIsCurrency0: true,
        price: lastPrice,
        points: r4(lastPrice * 100),
        band: policy.band,
        listingPrice: a.clearing ?? null,
        listedAt,
        listingDayEndsAt: listingDayEnds,
        policy,
        liquidity: { usdc: c.pool?.usdc ?? 0, shares: c.pool?.shares ?? 0 },
        rejected: [],
        events: c.policy.map((p) => ({
          time: iso(nowSec - p.minutesAgo * 60),
          kind: p.halted ? "halted" : p.mode,
          label: p.label,
          tx: hashFor(c.ticker, `policy${p.version}`),
          block: blockAt(p.minutesAgo),
        })),
        poolId: records.pool,
        poolKey: { currency0: EXTERNAL.usdc, currency1: records.token, fee: 3000, tickSpacing: 60, hooks: records.hook },
        raw: {
          sqrtPriceX96: "2227537199353396563404014697",
          tick: 344094,
          liquidity: "537293216038455",
          pointsE2: String(Math.round(lastPrice * 10000)),
          bandPointsE2: policy.band ? [String(Math.round(policy.band.lowPoints * 100)), String(Math.round(policy.band.highPoints * 100))] : null,
        },
      };

      swaps = { ticker: c.ticker, poolId: records.pool, trades, prices: points.map((p) => ({ time: p.time, value: p.value })) };
    }

    // ---- bids ----------------------------------------------------------
    const bids = (c.bids ?? []).map((b) => ({
      id: b.id,
      ticker: c.ticker,
      owner: b.mine ? null : OTHER_BIDDER, // filled in per request
      budget: b.budget,
      maxPrice: b.maxPrice,
      maxPricePoints: r4(b.maxPrice * 100),
      submittedBlock: blockAt(b.minutesAgo),
      submittedAt: iso(nowSec - b.minutesAgo * 60),
      state: b.state,
      filledShares: b.filledShares ?? null,
      refund: b.refund ?? null,
      exitedBlock: b.state === "exited" || b.state === "claimed" ? claimBlock : null,
      claimed: Boolean(b.claimed),
      tx: hashFor(c.ticker, `bid${b.id}`),
      actions: { exit: b.exitable ?? null, claim: Boolean(b.claimOpen) },
      raw: {
        amount: String(Math.round(b.budget * 1e6)),
        maxPriceQ96: "87150978765691",
        tokensFilled: b.filledShares === undefined ? null : String(Math.round(b.filledShares * 1e18)),
        currencyRefunded: b.refund === undefined ? null : String(Math.round(b.refund * 1e6)),
      },
    }));

    const ens = {
      ticker: c.ticker,
      name: listing.ensName,
      universalResolver: EXTERNAL.universalResolver,
      records: {
        addr: records.addr,
        "listingday.auction": records.auction,
        "listingday.pool": records.pool,
        "listingday.hook": records.hook,
        "listingday.policy": records.policy ? `eip155:${SPEC.chainId}:${records.policy}` : null,
        "listingday.status": c.status,
        "listingday.eligibility": c.eligibility,
        description: c.description ?? null,
        url: c.url ?? null,
        avatar: null,
      },
      matchesDeployment: { addr: true, auction: true, pool: records.pool ? true : null, hook: true, policy: true },
      resolved: true,
      error: null,
    };

    byTicker.set(c.ticker, { listing, listingDetail, auction, clearing, policy, market, swaps, bids, ens, spec: c });
  }

  const tickers = [...byTicker.keys()];

  /** `owner` null means every bidder; otherwise the ones marked `mine` in the spec. */
  const bidsFor = (owner, ticker) => {
    const out = [];
    for (const t of tickers) {
      if (ticker && ticker !== t) continue;
      const entry = byTicker.get(t);
      for (let i = 0; i < entry.bids.length; i += 1) {
        const spec = entry.spec.bids[i];
        const resolved = { ...entry.bids[i], owner: spec.mine ? (owner ?? DEMO_OWNER) : OTHER_BIDDER };
        if (owner && !spec.mine) continue;
        out.push(resolved);
      }
    }
    out.sort((a, b) => b.submittedBlock - a.submittedBlock);
    const committed = {};
    for (const b of out) committed[b.ticker] = r6((committed[b.ticker] ?? 0) + b.budget);
    return { ticker: ticker ?? null, owner: owner ?? null, bids: out, committed };
  };

  const eligibility = (ticker, address) => {
    const mine = bidsFor(address, ticker);
    const committed = mine.committed[ticker] ?? 0;
    const remaining = Math.max(0, offer.perApplicantCap - committed);
    return {
      ticker,
      address,
      eligible: true,
      mode: "open",
      reason: remaining === 0 ? `You have already applied with the most one person can (${offer.perApplicantCap} USDC).` : null,
      module: addrFor(ticker, "eligibility"),
      cap: offer.perApplicantCap,
      committed,
      remaining,
      raw: {
        cap: String(offer.perApplicantCap * 1e6),
        committed: String(Math.round(committed * 1e6)),
        remaining: String(Math.round(remaining * 1e6)),
      },
    };
  };

  return {
    chainId: SPEC.chainId,
    currentBlock,
    now: iso(nowSec),
    parent: SPEC.parent,
    tickers,
    get: (t) => byTicker.get(t),
    listings: tickers.map((t) => byTicker.get(t).listing),
    bidsFor,
    eligibility,
    external: EXTERNAL,
    addrFor,
  };
}
