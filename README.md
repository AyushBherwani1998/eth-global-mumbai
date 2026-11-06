# eth-global-mumbai

Listing Day: an SME IPO as a Uniswap CCA auction that lists into a Uniswap v4 pool with exchange-style market controls
(design: [`plan.md`](plan.md)).

| Path | What |
|---|---|
| [`contracts/`](contracts/README.md) | Solidity (Foundry): hooks, eligibility modules (open / World ID), CRE receiver, demo + ENSv2 scripts. Deploy walkthrough: [`contracts/DEPLOY.md`](contracts/DEPLOY.md); errors for the UI: [`contracts/errors.md`](contracts/errors.md) |
| [`cre/`](cre/README.md) | Chainlink CRE workflow that pushes the exchange's listing policy on-chain |
| [`services/mock-exchange/`](services/mock-exchange/README.md) | The exchange's editable listing policy API, read by the CRE workflow |
| [`services/verify/`](services/verify/README.md) | World ID verify backend for human listings: IDKit request signing, World `/api/v4/verify`, EIP-712 eligibility passes. Frontend contract: [`services/verify/API.md`](services/verify/API.md) |
