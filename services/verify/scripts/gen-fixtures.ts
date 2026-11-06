/**
 * EIP-712 pass vectors signed by the backend's own signer code (`createPassSigner`), pinned in
 * fixtures/pass-vectors.json. `npm run fixtures` after an intentional change; `npm test` fails if the file is stale,
 * and contracts/test/unit/WorldPassFixture.t.sol checks the same digests, signatures and hookData in Solidity.
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { keccak256, stringToHex, type Address, type Hex } from "viem";

import { createPassSigner, passToJson } from "../src/pass.ts";

export const FIXTURE_PATH = new URL("../fixtures/pass-vectors.json", import.meta.url).pathname;

/** Throwaway key, only ever used for these vectors. */
export const FIXTURE_SIGNER_KEY = keccak256(stringToHex("listing-day verify fixture pass signer"));

type CaseInput = {
  name: string;
  chainId: number;
  module: Address;
  hook: Address;
  nullifier: Hex;
  wallet: Address;
  auction: Address;
  cap: bigint;
  expiry: bigint;
};

const INPUTS: CaseInput[] = [
  {
    name: "acme-sepolia",
    chainId: 11155111,
    module: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    hook: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    nullifier: "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8",
    wallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    auction: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    cap: 20_000_000n,
    expiry: 1_762_400_600n,
  },
  {
    name: "max-values-anvil",
    chainId: 31337,
    module: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    hook: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
    nullifier: "0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000000",
    wallet: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    auction: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
    cap: (1n << 128n) - 1n,
    expiry: (1n << 64n) - 1n,
  },
];

export async function computeCases() {
  const signer = createPassSigner(FIXTURE_SIGNER_KEY);
  const cases = [];
  for (const c of INPUTS) {
    const signed = await signer.sign(
      { chainId: c.chainId, module: c.module },
      { nullifier: c.nullifier, wallet: c.wallet, auction: c.auction, cap: c.cap, expiry: c.expiry },
    );
    cases.push({
      name: c.name,
      chainId: c.chainId,
      module: c.module,
      hook: c.hook,
      // Decimal strings: vm.parseJsonUint reads them exactly (JSON numbers lose precision above 2^53).
      pass: { ...passToJson(signed.pass), expiry: c.expiry.toString() },
      digest: signed.digest,
      signature: signed.signature,
      hookData: signed.hookData,
    });
  }
  return { signer: signer.address, cases };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const fixture = await computeCases();
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${fixture.cases.length} pass vectors to ${FIXTURE_PATH}`);
}
