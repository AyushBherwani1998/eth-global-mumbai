/**
 * GET /v1/issuer/:ticker: who the issuer is and who holds each role, read live. The ENS `addr` record of a ticker
 * is its share TOKEN contract; the issuer wallet is the ENSv2 owner of the ticker label in the parent's registry.
 */
import { getAddress, parseAbi, type Address } from "viem";

import { ccaAbi, listingHookAbi, mockSmeAbi, receiverAbi, validationHookAbi } from "../abis.ts";
import type { Listing } from "../config.ts";
import type { Ctx, Head } from "../context.ts";
import type { IssuerView, RoleHolder } from "../types.ts";
import { ensAddr } from "./listing.ts";

const ensRegistryAbi = parseAbi([
  "function findOwner(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
]);
const positionManagerAbi = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);

const ZERO = /^0x0{40}$/i;

/** A view call that returns null instead of throwing (contract not deployed, function missing, pruned state). */
async function maybe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

const asAddr = (v: unknown): Address | null => (typeof v === "string" && !ZERO.test(v) ? getAddress(v) : null);

export async function issuerView(ctx: Ctx, l: Listing, h: Head, check: Address | null): Promise<IssuerView> {
  const r = ctx.client;
  const at = { blockNumber: h.number } as const;
  const hook = { address: l.hook, abi: listingHookAbi, ...at } as const;
  const parentLabel = l.parentName.split(".")[0] ?? "";
  const [name, symbol, ensAddress, nameOwner, nameResolver, parentOwner, hookOwner, policySource] = await Promise.all([
    maybe(r.readContract({ address: l.token, abi: mockSmeAbi, functionName: "name", ...at })),
    maybe(r.readContract({ address: l.token, abi: mockSmeAbi, functionName: "symbol", ...at })),
    ensAddr(ctx, l),
    l.ens.registry ? maybe(r.readContract({ address: l.ens.registry, abi: ensRegistryAbi, functionName: "findOwner", args: [l.ens.label], ...at })) : null,
    l.ens.registry ? maybe(r.readContract({ address: l.ens.registry, abi: ensRegistryAbi, functionName: "getResolver", args: [l.ens.label], ...at })) : null,
    l.ens.ethRegistry ? maybe(r.readContract({ address: l.ens.ethRegistry, abi: ensRegistryAbi, functionName: "findOwner", args: [parentLabel], ...at })) : null,
    maybe(r.readContract({ ...hook, functionName: "owner" })),
    maybe(r.readContract({ ...hook, functionName: "policySource" })),
  ]);
  const receiver = asAddr(policySource) ?? l.receiver;
  const rc = receiver ? ({ address: receiver, abi: receiverAbi, ...at } as const) : null;
  const ac = l.auction ? ({ address: l.auction, abi: ccaAbi, ...at } as const) : null;
  const [recvOwner, forwarder, broadcaster, statusResolver, tokensRecipient, fundsRecipient, vhookDeployer, lpOwner] = await Promise.all([
    rc ? maybe(r.readContract({ ...rc, functionName: "owner" })) : null,
    rc ? maybe(r.readContract({ ...rc, functionName: "forwarder" })) : null,
    rc ? maybe(r.readContract({ ...rc, functionName: "broadcaster" })) : null,
    rc ? maybe(r.readContract({ ...rc, functionName: "statusResolver" })) : null,
    ac ? maybe(r.readContract({ ...ac, functionName: "tokensRecipient" })) : null,
    ac ? maybe(r.readContract({ ...ac, functionName: "fundsRecipient" })) : null,
    l.validationHook ? maybe(r.readContract({ address: l.validationHook, abi: validationHookAbi, functionName: "deployer", ...at })) : null,
    l.lpTokenId !== null ? maybe(r.readContract({ address: l.external.positionManager, abi: positionManagerAbi, functionName: "ownerOf", args: [l.lpTokenId], ...at })) : null,
  ]);

  const role = (role: string, contractName: string, contract: Address | null, holder: unknown, description: string, source: RoleHolder["source"] = "onchain"): RoleHolder => ({
    role,
    contract,
    contractName,
    holder: asAddr(holder),
    description,
    source,
  });
  const resolverAddr = asAddr(nameResolver) ?? l.ens.resolver;
  const roles: RoleHolder[] = [
    role("ens.nameOwner", "ENSv2 UserRegistry", l.ens.registry, nameOwner, `Owns ${l.ensName}: sets its resolver and records (the issuer wallet)`),
    role("ens.parentOwner", "ENSv2 ETHRegistry", l.ens.ethRegistry, parentOwner, `Owns ${l.parentName}: registers ticker names`),
    role("ens.statusMirror", "ENSv2 resolver", asAddr(statusResolver) ?? resolverAddr, receiver, "Allowed to write listingday.status (the CRE receiver mirrors its status)"),
    role("hook.owner", "ListingHook", l.hook, hookOwner, "May call setPolicySource (switch where trading rules come from)"),
    role("hook.policySource", "ListingHook", l.hook, receiver, "The contract the hook reads its trading policy from"),
    role("receiver.owner", "ListingPolicyReceiver", receiver, recvOwner, "May change the forwarder, broadcaster, maxAge and the ENS status mirror"),
    role("receiver.forwarder", "ListingPolicyReceiver", receiver, forwarder, "Only caller of onReport (CRE forwarder)"),
    role("receiver.broadcaster", "ListingPolicyReceiver", receiver, broadcaster, "Required tx.origin of CRE reports (the exchange's CRE operator); zero = any"),
    role("auction.tokensRecipient", "ContinuousClearingAuction", l.auction, tokensRecipient, "Receives unsold shares (sweepUnsoldTokens)"),
    role("auction.fundsRecipient", "ContinuousClearingAuction", l.auction, fundsRecipient, "Receives the raise (LBPStrategy, which seeds the pool)"),
    role("validationHook.deployer", "AuctionValidationHook", l.validationHook, vhookDeployer, "May bind the hook to its auction (setAuction, once)"),
    role("lp.owner", "PositionManager", l.lpTokenId === null ? null : l.external.positionManager, lpOwner, `Owns LP position #${l.lpTokenId ?? "?"} (may remove liquidity)`),
    role("deployment.treasury", "deployments file", null, l.treasury, "Treasury recorded by the deploy scripts", "deployment"),
    role("deployment.deployer", "deployments file", null, l.deployer, "Deployer recorded by the deploy scripts", "deployment"),
  ];

  const ownerFromEns = asAddr(nameOwner);
  const issuer: IssuerView["issuer"] = ownerFromEns ? { address: ownerFromEns, source: "ens" } : l.issuer ? { address: l.issuer, source: "deployment" } : { address: null, source: null };
  const notes = [
    `records.addr / ENS addr of ${l.ensName} is the ERC20 share token ${l.token}, not a wallet: never ask a user to connect it.`,
    "issuer.address is the ENSv2 owner of the ticker name; compare it with the connected wallet for the issuer console.",
    "Exchange operator roles (receiver.broadcaster / forwarder) are separate from the issuer: the issuer cannot publish trading policy.",
  ];
  if (!ownerFromEns) notes.push("The ENS owner could not be read (name not registered, or no ens.userRegistry in the deployments file): issuer falls back to the deployments file.");

  let checkOut: IssuerView["check"] = null;
  if (check) {
    const held = roles.filter((x) => x.holder === check).map((x) => x.role);
    checkOut = { address: check, isIssuer: issuer.address === check, roles: held };
  }

  return {
    ticker: l.ticker,
    ensName: l.ensName,
    chainId: l.chainId,
    block: Number(h.number),
    token: { address: l.token, name, symbol },
    ensAddr: ensAddress,
    ensAddrIsToken: ensAddress === null ? null : ensAddress === l.token,
    issuer,
    treasury: l.treasury,
    roles,
    check: checkOut,
    notes,
  };
}
