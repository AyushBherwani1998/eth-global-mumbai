# Investor and issuer UX audit

Scope: Markets, company pages, buy/sell panels and sheets, Portfolio, Orders,
IPO applications, Account, issuer list/console, transaction toasts. Checked at
390 × 844 and 1440 × 1000 against the local fixture API. No contracts changed.

## Changes

- Preserve PR #28's numbered progress rail and current-step layout. Replace
  server approval prose with short, consistent wallet instructions in both the
  trade and application forms. Keep token/spender contracts, copy controls and
  the actual permission expiry under Details; do not call a per-trade permission
  a one-time approval.
- Wrap long company names, rule-change explanations, issuer next actions, sheet
  headings, step descriptions and key/value rows instead of clipping or
  overflowing. Fix chart range chips' conflicting minimum widths at 390px.
- Show Account's wallet with Copy (the full address) and View on Sepolia Etherscan.
  Shared copy controls report clipboard failure instead of falsely saying Copied.
- Normal trading still has the policy's band: show its actual bounds and percent,
  including that both edges are inclusive. Keep halt/directional copy separate.
- `ListingHook._enforceBand` rejects `< lo` or `> hi`, not equality. The API's price
  estimate is rounded, so do not infer "above"/"below" from that estimate. A hook
  rejection names the limit and explains full on-chain precision; it never claims
  that two visibly equal prices are unequal. No tolerance is added to trading.
- Replace "Nothing: not allowed" with an explicit blocked state. Do not show
  unavailable average-price comparisons for a rejected quote. Wrap slippage controls.
- Successful transaction toasts now stay until dismissed/replaced. Transaction
  links remain clickable; identifiers inside server toast prose are shortened
  with full explorer links. Wallet cancellation messages stay for 10 seconds.

## Verification

CI-equivalent commands: `pnpm lint`, `pnpm test`, `pnpm typecheck`, `pnpm build`
(Node 22). Regression tests cover approval copy and both rounded boundary edges.

Visual review uses `app/dev/api-stub` and the no-Privy demo session. Trade sheets
replay a recorded read-only live `/v1/prepare/swap` quote to exercise the blocked
state and approvals without broadcasting. These are UI fixtures, not new chain
trades or evidence of a new hook test. Before images use latest main (75c289f,
including PR #28); after images retain its branding and progress-rail design.
Toast/current-step components are also rendered independently with fixture props.

Screenshots are review artifacts outside the repository, under
`/workspace/trade-test/ux-before/` and `/workspace/trade-test/ux-after/`.
