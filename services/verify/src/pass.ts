import { encodeAbiParameters, getAddress, hashTypedData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** Must match `WorldPassModule`'s `EIP712("ListingDay WorldPass", "1")` and `PASS_TYPEHASH`. */
export const PASS_DOMAIN_NAME = "ListingDay WorldPass";
export const PASS_DOMAIN_VERSION = "1";

export const PASS_TYPES = {
  EligibilityPass: [
    { name: "nullifier", type: "bytes32" },
    { name: "wallet", type: "address" },
    { name: "auction", type: "address" },
    { name: "cap", type: "uint128" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

/** `hookData = abi.encode(EligibilityPass pass, bytes signature)`, decoded by `WorldPassModule.check`. */
const HOOK_DATA_PARAMS = [
  {
    type: "tuple",
    components: [
      { name: "nullifier", type: "bytes32" },
      { name: "wallet", type: "address" },
      { name: "auction", type: "address" },
      { name: "cap", type: "uint128" },
      { name: "expiry", type: "uint64" },
    ],
  },
  { type: "bytes" },
] as const;

export type EligibilityPass = {
  nullifier: Hex;
  wallet: Address;
  auction: Address;
  cap: bigint;
  expiry: bigint;
};

export type PassDomain = { chainId: number; module: Address };

export function passDomain(d: PassDomain) {
  return {
    name: PASS_DOMAIN_NAME,
    version: PASS_DOMAIN_VERSION,
    chainId: d.chainId,
    verifyingContract: getAddress(d.module),
  } as const;
}

/** EIP-712 digest; equals `WorldPassModule.hashPass(pass)` onchain. */
export function passDigest(d: PassDomain, pass: EligibilityPass): Hex {
  return hashTypedData({ domain: passDomain(d), types: PASS_TYPES, primaryType: "EligibilityPass", message: pass });
}

export function encodeHookData(pass: EligibilityPass, signature: Hex): Hex {
  return encodeAbiParameters(HOOK_DATA_PARAMS, [pass, signature]);
}

export type SignedPass = {
  pass: EligibilityPass;
  signature: Hex;
  digest: Hex;
  hookData: Hex;
};

export type PassSigner = {
  address: Address;
  sign(d: PassDomain, pass: EligibilityPass): Promise<SignedPass>;
};

export function createPassSigner(privateKey: Hex): PassSigner {
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    async sign(d, pass) {
      const signature = await account.signTypedData({
        domain: passDomain(d),
        types: PASS_TYPES,
        primaryType: "EligibilityPass",
        message: pass,
      });
      return { pass, signature, digest: passDigest(d, pass), hookData: encodeHookData(pass, signature) };
    },
  };
}

/** JSON shape of a pass (bigints as decimal strings / numbers) for the API and fixtures. */
export function passToJson(pass: EligibilityPass) {
  return {
    nullifier: pass.nullifier,
    wallet: pass.wallet,
    auction: pass.auction,
    cap: pass.cap.toString(),
    expiry: Number(pass.expiry),
  };
}
