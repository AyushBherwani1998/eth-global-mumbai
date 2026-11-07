/**
 * Listing creation state management - persistent storage for browser-based listing creation.
 * Supports resumable creation workflow with pending/confirmed/error states.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type Address, type Hex } from "viem";

export type ListingCreationPhase =
  | "pending_token"
  | "token_deployed"
  | "pending_validation"
  | "validation_deployed"
  | "pending_hook"
  | "hook_deployed"
  | "pending_receiver"
  | "receiver_deployed"
  | "pending_policy_source"
  | "policy_source_set"
  | "pending_auction"
  | "auction_created"
  | "pending_auction_binding"
  | "completed"
  | "error";

export type ListingCreationState = {
  id: string;
  ticker: string;
  tokenName: string;
  tokenSymbol: string;
  issuerAddress: Address;
  createdAt: number;
  updatedAt: number;
  phase: ListingCreationPhase;
  error?: string;
  
  // Deployed contract addresses
  tokenAddress?: Address;
  moduleAddress?: Address;
  validationHookAddress?: Address;
  hookAddress?: Address;
  receiverAddress?: Address;
  
  // Transaction hashes
  tokenDeployTx?: Hex;
  moduleDeployTx?: Hex;
  validationHookDeployTx?: Hex;
  hookDeployTx?: Hex;
  receiverDeployTx?: Hex;
  policySourceTx?: Hex;
  
  // Configuration
  deploymentConfig?: {
    totalSupply?: string;
    auctionSupply?: string;
    lpReserve?: string;
    applicantCap?: string;
    requiredCurrencyRaised?: string;
    floorPoints?: string;
    issuePoints?: string;
    capPoints?: string;
    auctionAddress?: string;
    auctionPoolId?: string;
    auctionTxHash?: string;
  };
};

export type ListingCreationStore = {
  listings: Record<string, ListingCreationState>;
  version: number;
};

const DEFAULT_STORE: ListingCreationStore = {
  listings: {},
  version: 1,
};

/**
 * Simple file-based persistent storage.
 * Railway deployments should mount a volume at /data to persist this across redeploys.
 */
export class ListingCreationStorage {
  private storePath: string;
  private store: ListingCreationStore;

  constructor(storePath = "/data/listing-creation-state.json") {
    this.storePath = storePath;
    this.store = this.load();
  }

  private load(): ListingCreationStore {
    try {
      if (existsSync(this.storePath)) {
        const data = readFileSync(this.storePath, "utf8");
        return JSON.parse(data) as ListingCreationStore;
      }
    } catch (e) {
      console.error("[listing-creation] Failed to load state:", e);
    }
    return { ...DEFAULT_STORE };
  }

  private save(): void {
    try {
      const dir = dirname(this.storePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.storePath, JSON.stringify(this.store, null, 2), "utf8");
    } catch (e) {
      console.error("[listing-creation] Failed to save state:", e);
      throw new Error("Failed to persist listing creation state");
    }
  }

  create(params: {
    ticker: string;
    tokenName: string;
    tokenSymbol: string;
    issuerAddress: Address;
    deploymentConfig?: ListingCreationState["deploymentConfig"];
  }): ListingCreationState {
    const id = `${params.ticker}_${Date.now()}`;
    const now = Date.now();
    
    const listing: ListingCreationState = {
      id,
      ticker: params.ticker.toLowerCase(),
      tokenName: params.tokenName,
      tokenSymbol: params.tokenSymbol,
      issuerAddress: params.issuerAddress,
      createdAt: now,
      updatedAt: now,
      phase: "pending_token",
      deploymentConfig: params.deploymentConfig,
    };

    this.store.listings[id] = listing;
    this.save();
    return listing;
  }

  update(id: string, updates: Partial<ListingCreationState>): ListingCreationState {
    const listing = this.store.listings[id];
    if (!listing) {
      throw new Error(`Listing creation ${id} not found`);
    }

    Object.assign(listing, updates, { updatedAt: Date.now() });
    this.save();
    return listing;
  }

  get(id: string): ListingCreationState | null {
    return this.store.listings[id] ?? null;
  }

  getByTicker(ticker: string): ListingCreationState[] {
    return Object.values(this.store.listings).filter(
      (l) => l.ticker === ticker.toLowerCase()
    );
  }

  getByIssuer(issuerAddress: Address): ListingCreationState[] {
    return Object.values(this.store.listings).filter(
      (l) => l.issuerAddress.toLowerCase() === issuerAddress.toLowerCase()
    );
  }

  list(): ListingCreationState[] {
    return Object.values(this.store.listings);
  }

  delete(id: string): boolean {
    if (this.store.listings[id]) {
      delete this.store.listings[id];
      this.save();
      return true;
    }
    return false;
  }
}
