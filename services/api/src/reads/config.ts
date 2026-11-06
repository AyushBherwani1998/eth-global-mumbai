/** GET /v1/config: the deployment files as the app needs them. No RPC, so it works while the chain is unreachable. */
import { basename } from "node:path";

import { readDeployments, type Config, type Listing } from "../config.ts";
import type { ConfigResponse, ListingConfig } from "../types.ts";
import { offer } from "./auction.ts";

const CHAIN_NAMES: Record<number, string> = { 1: "Ethereum", 11155111: "Sepolia", 31337: "Anvil" };

const num = (v: bigint | null) => (v === null ? null : Number(v));

export function listingConfig(l: Listing): ListingConfig {
  const { ensUniversalResolver, ...external } = l.external;
  return {
    ticker: l.ticker,
    ensName: l.ensName,
    label: l.label,
    chainId: l.chainId,
    deployBlock: Number(l.deployBlock),
    contracts: {
      token: l.token,
      auction: l.auction,
      listingHook: l.hook,
      listingPolicyReceiver: l.receiver,
      allowAllModule: l.module,
      auctionValidationHook: l.validationHook,
    },
    wallets: { issuer: l.issuer, treasury: l.treasury, deployer: l.deployer, creBroadcaster: l.creBroadcaster },
    pool: { poolId: l.poolId, poolKey: l.poolKey, usdcIsCurrency0: l.usdcIsCurrency0, listingDayBandBps: l.listingDayBandBps },
    auction: { startBlock: num(l.startBlock), endBlock: num(l.endBlock), claimBlock: num(l.claimBlock) },
    ens: { registry: l.ens.registry, resolver: l.ens.resolver, universalResolver: ensUniversalResolver },
    lpTokenId: num(l.lpTokenId),
    external: { ...external },
    offer: offer(l),
  };
}

export function configView(config: Config): ConfigResponse {
  const loaded = readDeployments(config);
  return {
    apiVersion: "v1",
    chainId: config.chainId,
    chainName: CHAIN_NAMES[config.chainId] ?? `chain ${config.chainId}`,
    parent: config.parentName,
    explorerUrl: config.explorerUrl,
    frontendEnv: { apiUrl: "NEXT_PUBLIC_API_URL" },
    listings: loaded.flatMap((d) => (d.listing ? [listingConfig(d.listing)] : [])),
    errors: loaded.flatMap((d) => (d.error === undefined ? [] : [{ file: basename(d.file), ticker: d.ticker, error: d.error.split(d.file).join(basename(d.file)) }])),
  };
}
