// UI copy only. The server and hook remain the authority on whether a trade is allowed.
export function approvalTitle(kind: string, token: string): string {
  switch (kind) {
    case "approveUsdcToPermit2":
    case "approveTokenToPermit2":
      return `Enable ${token} for trading`;
    case "permit2Approve":
      return `Allow this trade to use your ${token}`;
    default:
      return "Approve in your wallet";
  }
}

/** Do not infer above/below from a rounded API price: the hook uses sqrtPriceX96.
 * Both band edges are inclusive (ListingHook._enforceBand). A rounded estimate
 * can equal an edge even when the full-precision price is outside it.
 */
export function bandRejection(range: string, priceAfter: number | null): string {
  return `Not allowed: this trade breaks today's price limit (${range}).${priceAfter === null ? "" : ` Estimated price after: ${priceAfter.toFixed(4)}.`} Prices shown are rounded; the exchange checks the full on-chain price.`;
}
