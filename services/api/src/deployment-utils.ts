/**
 * Utility functions for deployment coordination.
 */
import type { ListingCreationState } from "./listing-creation.ts";

/**
 * Determine current deployment step based on listing state.
 */
export function determineCurrentStep(listing: ListingCreationState): number {
  if (!listing.tokenAddress) return 1;
  if (!listing.moduleAddress) return 2;
  if (!listing.validationHookAddress) return 3;
  if (!listing.hookAddress) return 4;
  if (!listing.receiverAddress) return 5;
  return 6; // Complete
}
