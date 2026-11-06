"use client";

// Reverse ENS for the signed-in address. Names live on Ethereum mainnet, so the
// lookup is a mainnet read even though the app trades on Sepolia. It is one
// read per address, cached for the tab, and every failure resolves to null:
// nothing in the UI depends on a name being found.

import { useEffect, useState } from "react";
import { createPublicClient, http, isAddress } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({ chain: mainnet, transport: http() });

const cache = new Map<string, Promise<string | null>>();

export function ensNameFor(address: string | null | undefined): Promise<string | null> {
  if (!address || !isAddress(address)) return Promise.resolve(null);
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const p = client.getEnsName({ address: address as `0x${string}` }).catch(() => null);
  cache.set(key, p);
  return p;
}

/** Null until the lookup lands, and null if the address has no name. */
export function useEnsName(address: string | null) {
  // The address is kept alongside the name so a change reads as "not resolved
  // yet" without having to reset state from inside the effect.
  const [found, setFound] = useState<{ address: string; name: string | null } | null>(null);
  useEffect(() => {
    if (!address) return;
    let live = true;
    ensNameFor(address).then((name) => {
      if (live) setFound({ address, name });
    });
    return () => {
      live = false;
    };
  }, [address]);
  return address && found?.address === address ? found.name : null;
}
