/**
 * W0 config: chain, RPC and addresses come from the deployments JSON the demo scripts write
 * (contracts/deployments/<network>.json, one listing per file), with env overrides. The files are re-read on every
 * request, so a running server picks up each deploy step (launch, settle, ENS) without a restart.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, isAddress, type Address, type Hex } from "viem";

const SERVICE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Sepolia addresses (plan.md §17, contracts/src/libraries/Constants.sol), used when a file lacks them. */
export const SEPOLIA = {
  chainId: 11_155_111,
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
  positionManager: "0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4",
  universalRouter: "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b",
  stateView: "0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C",
  quoter: "0x68aFa8b853cAa7a2D40B0F6AEE5C4DbC147C8244",
  lbpStrategy: "0x95434E898Af471945Cab33D5064d2aC1A6Ba2000",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  ensUniversalResolver: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
} as const satisfies Record<string, string | number>;

export type ExternalAddresses = {
  usdc: Address;
  permit2: Address;
  poolManager: Address;
  positionManager: Address;
  universalRouter: Address;
  stateView: Address;
  quoter: Address;
  lbpStrategy: Address;
  multicall3: Address;
  ensUniversalResolver: Address;
};

export type Config = {
  port: number;
  host: string;
  rpcUrl: string;
  /** Expected chain id: CHAIN_ID, else the first deployment's `chainId`, else Sepolia. */
  chainId: number;
  corsOrigins: string[];
  deployments: { path: string; ticker: string | null }[];
  parentName: string;
  logsMaxRange: bigint;
  /** Env address overrides (win over the deployment files). */
  overrides: Partial<ExternalAddresses>;
};

/** The parts of a deployments file the API reads (see contracts/DEPLOY.md §4). */
export type DeploymentJson = {
  chainId?: number;
  label?: string;
  deployBlock?: number;
  deployer?: string;
  issuer?: string;
  treasury?: string;
  external?: Record<string, string>;
  contracts?: {
    mockSME?: string;
    allowAllModule?: string;
    auctionValidationHook?: string;
    listingHook?: string;
    listingPolicyReceiver?: string;
  };
  pool?: {
    poolId?: string;
    poolKey?: { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string };
    usdcIsCurrency0?: boolean;
    listingDayBandBps?: number;
    listingDaySeconds?: number;
  };
  params?: Record<string, number | string>;
  auction?: Record<string, number | string>;
  results?: Record<string, number | string | boolean>;
  trade?: Record<string, unknown>;
  ens?: {
    parent?: { name?: string };
    ticker?: { label?: string; name?: string; resolver?: string };
    external?: Record<string, string>;
  };
};

export type Listing = {
  ticker: string;
  file: string;
  chainId: number;
  label: string;
  deployBlock: bigint;
  ensName: string;
  parentName: string;
  usdcIsCurrency0: boolean;
  listingDayBandBps: number;
  poolId: Hex;
  poolKey: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
  token: Address;
  module: Address | null;
  validationHook: Address | null;
  hook: Address;
  receiver: Address | null;
  auction: Address | null;
  treasury: Address | null;
  /** Demo bid blocks etc. (`auction` section), absent before `make launch`. */
  startBlock: bigint | null;
  endBlock: bigint | null;
  claimBlock: bigint | null;
  migrationBlock: bigint | null;
  params: {
    totalSupply: bigint;
    auctionSupply: bigint;
    lpReserve: bigint;
    applicantCap: bigint;
    requiredCurrencyRaised: bigint;
    floorPoints: bigint;
    issuePoints: bigint;
    capPoints: bigint;
    floorPriceQ96: bigint;
    capPriceQ96: bigint;
    tickSpacingQ96: bigint;
    lpRateMps: bigint;
  };
  external: ExternalAddresses;
};

export class ConfigError extends Error {}

function envList(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function envAddress(env: NodeJS.ProcessEnv, key: string): Address | undefined {
  const v = env[key]?.trim();
  if (!v) return undefined;
  if (!isAddress(v)) throw new ConfigError(`${key} is not an address: ${v}`);
  return getAddress(v);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const files = envList(env.DEPLOYMENTS_FILES || env.DEPLOYMENTS_FILE);
  const deployments = (files.length ? files : ["../../contracts/deployments/sepolia.json"]).map((entry) => {
    const [p = "", ticker] = entry.split("#");
    return { path: isAbsolute(p) ? p : resolve(SERVICE_ROOT, p), ticker: ticker?.trim().toLowerCase() || null };
  });

  let chainId = env.CHAIN_ID ? Number(env.CHAIN_ID) : NaN;
  if (!Number.isInteger(chainId)) {
    const first = deployments.find((d) => existsSync(d.path));
    const fileChain = first ? (readJson(first.path).chainId ?? NaN) : NaN;
    chainId = Number.isInteger(fileChain) ? fileChain : SEPOLIA.chainId;
  }

  const logsMaxRange = BigInt(env.LOGS_MAX_RANGE || "50000");
  if (logsMaxRange <= 0n) throw new ConfigError("LOGS_MAX_RANGE must be positive");

  return {
    port: Number(env.PORT || 8788),
    host: env.HOST || "127.0.0.1",
    rpcUrl: env.RPC_URL || env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
    chainId,
    corsOrigins: envList(env.CORS_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000"),
    deployments,
    parentName: env.ENS_PARENT_NAME?.trim() || "listingday.eth",
    logsMaxRange,
    overrides: {
      usdc: envAddress(env, "USDC_ADDRESS"),
      permit2: envAddress(env, "PERMIT2_ADDRESS"),
      poolManager: envAddress(env, "POOL_MANAGER_ADDRESS"),
      positionManager: envAddress(env, "POSITION_MANAGER_ADDRESS"),
      universalRouter: envAddress(env, "UNIVERSAL_ROUTER_ADDRESS"),
      stateView: envAddress(env, "STATE_VIEW_ADDRESS"),
      quoter: envAddress(env, "QUOTER_ADDRESS"),
      lbpStrategy: envAddress(env, "LBP_STRATEGY_ADDRESS"),
      multicall3: envAddress(env, "MULTICALL3_ADDRESS"),
      ensUniversalResolver: envAddress(env, "ENS_UNIVERSAL_RESOLVER_ADDRESS"),
    },
  };
}

function readJson(path: string): DeploymentJson {
  return JSON.parse(readFileSync(path, "utf8")) as DeploymentJson;
}

function addr(v: unknown): Address | null {
  return typeof v === "string" && isAddress(v) && !/^0x0{40}$/i.test(v) ? getAddress(v) : null;
}

function req(v: unknown, what: string, file: string): Address {
  const a = addr(v);
  if (!a) throw new ConfigError(`${file}: ${what} missing (run make deploy)`);
  return a;
}

function big(v: unknown, fallback: bigint): bigint {
  if (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v))) return BigInt(v);
  return fallback;
}

function optBig(v: unknown): bigint | null {
  const b = big(v, -1n);
  return b > 0n ? b : null;
}

/** The demo parameters (DemoDeploy `params`), defaulting to plan.md §4 values. */
function params(p: Record<string, number | string> = {}): Listing["params"] {
  const ONE_POINT_Q96 = 792_281_625_142n;
  return {
    totalSupply: big(p.totalSupply, 110_000n * 10n ** 18n),
    auctionSupply: big(p.auctionSupply, 90_000n * 10n ** 18n),
    lpReserve: big(p.lpReserve, 20_000n * 10n ** 18n),
    applicantCap: big(p.applicantCap, 20_000_000n),
    requiredCurrencyRaised: big(p.requiredCurrencyRaised, 45_000_000n),
    floorPoints: big(p.floorPoints, 80n),
    issuePoints: big(p.issuePoints, 100n),
    capPoints: big(p.capPoints, 190n),
    floorPriceQ96: big(p.floorPriceQ96, 80n * ONE_POINT_Q96),
    capPriceQ96: big(p.capPriceQ96, 190n * ONE_POINT_Q96),
    tickSpacingQ96: big(p.tickSpacingQ96, ONE_POINT_Q96),
    lpRateMps: big(p.lpRateMps, 2_000_000n),
  };
}

/** Parses one deployments file into a listing. Throws ConfigError for files the API can't serve yet. */
export function parseDeployment(
  json: DeploymentJson,
  file: string,
  config: Pick<Config, "parentName" | "overrides" | "chainId">,
  tickerOverride: string | null,
): Listing {
  const c = json.contracts ?? {};
  const hook = req(c.listingHook, "contracts.listingHook", file);
  const token = req(c.mockSME, "contracts.mockSME", file);
  const pool = json.pool ?? {};
  const key = pool.poolKey;
  if (!key || typeof pool.poolId !== "string") throw new ConfigError(`${file}: pool section missing (run make deploy)`);

  const label = json.ens?.ticker?.label;
  const ticker = (tickerOverride ?? label ?? json.label ?? "").toLowerCase();
  if (!/^[a-z0-9-]+$/.test(ticker)) throw new ConfigError(`${file}: no usable ticker (add "#ticker" to its DEPLOYMENTS_FILES entry)`);
  const parentName = json.ens?.parent?.name || config.parentName;
  const ensName = tickerOverride || !json.ens?.ticker?.name ? `${ticker}.${parentName}` : json.ens.ticker.name;

  const ext = json.external ?? {};
  const ensExt = json.ens?.external ?? {};
  const o = config.overrides;
  const pick = (k: keyof ExternalAddresses, fromFile: unknown): Address =>
    o[k] ?? addr(fromFile) ?? getAddress(SEPOLIA[k]);

  const a = json.auction ?? {};
  return {
    ticker,
    file,
    chainId: json.chainId ?? config.chainId,
    label: json.label ?? ticker,
    deployBlock: big(json.deployBlock, 0n),
    ensName,
    parentName,
    usdcIsCurrency0: pool.usdcIsCurrency0 ?? addr(key.currency0) === pick("usdc", ext.usdc),
    listingDayBandBps: Number(pool.listingDayBandBps ?? 500),
    poolId: pool.poolId as Hex,
    poolKey: {
      currency0: req(key.currency0, "pool.poolKey.currency0", file),
      currency1: req(key.currency1, "pool.poolKey.currency1", file),
      fee: Number(key.fee),
      tickSpacing: Number(key.tickSpacing),
      hooks: req(key.hooks, "pool.poolKey.hooks", file),
    },
    token,
    module: addr(c.allowAllModule),
    validationHook: addr(c.auctionValidationHook),
    hook,
    receiver: addr(c.listingPolicyReceiver),
    auction: addr(a.address),
    treasury: addr(json.treasury),
    startBlock: optBig(a.startBlock),
    endBlock: optBig(a.endBlock),
    claimBlock: optBig(a.claimBlock),
    migrationBlock: optBig(a.migrationBlock),
    params: params(json.params),
    external: {
      usdc: pick("usdc", ext.usdc),
      permit2: pick("permit2", ext.permit2),
      poolManager: pick("poolManager", ext.poolManager),
      positionManager: pick("positionManager", ext.positionManager),
      universalRouter: pick("universalRouter", ext.universalRouter),
      stateView: pick("stateView", ext.stateView),
      quoter: pick("quoter", ext.quoter),
      lbpStrategy: pick("lbpStrategy", ext.lbpStrategy),
      multicall3: pick("multicall3", undefined),
      ensUniversalResolver: pick("ensUniversalResolver", ensExt.universalResolver),
    },
  };
}

export type LoadedDeployment = { file: string; ticker: string | null; listing?: Listing; error?: string };

/** Reads every configured deployments file now (no caching). Bad files are reported, not thrown. */
export function readDeployments(config: Config): LoadedDeployment[] {
  return config.deployments.map(({ path, ticker }) => {
    try {
      if (!existsSync(path)) throw new ConfigError(`${path} not found (run make deploy, or set DEPLOYMENTS_FILES)`);
      const listing = parseDeployment(readJson(path), path, config, ticker);
      return { file: path, ticker: listing.ticker, listing };
    } catch (e) {
      return { file: path, ticker, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

export function listings(config: Config): Listing[] {
  return readDeployments(config).flatMap((d) => (d.listing ? [d.listing] : []));
}
