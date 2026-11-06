# Listing Day demo entry points. Full walkthrough, env vars and expected output: DEPLOY.md.
#   make demo-fork        whole flow on a Sepolia fork in one process (no keys, nothing broadcast)
#   make demo-anvil       whole flow as separate --broadcast steps against a local anvil fork
#   make demo-sepolia     the real thing: every step with --broadcast on Sepolia, waiting for the auction blocks
# Every step target can be run on its own and re-run after a failure (each step skips what is already done).

-include .env
export

RPC_URL ?= $(SEPOLIA_RPC_URL)
DEPLOYMENTS_FILE ?= deployments/sepolia.json
FORGE_FLAGS ?=
BROADCAST = --rpc-url $(RPC_URL) --broadcast --slow $(FORGE_FLAGS)
VERIFY = $(if $(ETHERSCAN_API_KEY),--verify --etherscan-api-key $(ETHERSCAN_API_KEY),)
STEP = forge script script/demo
WAIT = bash script/demo/wait-for-block.sh
ABI_CONTRACTS = MockSME AllowAllModule AuctionValidationHook ListingHook ListingPolicyReceiver \
	IListingHook IListingPolicyReceiver IAuctionValidationHook IEligibilityModule \
	IContinuousClearingAuction ILBPStrategy ILiquidityLauncher IAllowanceTransfer IPositionManager \
	IStateView IV4Quoter IPoolManager PoolSwapTest IERC20Metadata

.PHONY: demo-fork demo-anvil demo-sepolia check-env fund balances deploy launch wait-start bids \
	wait-migration settle trade halt resume export-json abis abis-check

demo-fork:
	forge script script/demo/DemoFork.s.sol --fork-url $(SEPOLIA_RPC_URL) --skip-simulation

demo-anvil:
	bash script/demo/anvil-rehearsal.sh

demo-sepolia: check-env balances deploy launch wait-start bids wait-migration settle trade halt
	@echo "demo-sepolia done: $(DEPLOYMENTS_FILE)"

check-env:
	@test -n "$(RPC_URL)" || (echo "set SEPOLIA_RPC_URL (or RPC_URL)" && exit 1)
	@test -n "$(PRIVATE_KEY)" || (echo "set PRIVATE_KEY (deployer / issuer)" && exit 1)
	@test -n "$(DEMO_WALLET_KEYS)" || (echo "set DEMO_WALLET_KEYS (comma-separated, >= 6 keys)" && exit 1)

fund:
	$(STEP)/FundDemoWallets.s.sol $(BROADCAST)
	$(MAKE) export-json

balances:
	$(STEP)/FundDemoWallets.s.sol --rpc-url $(RPC_URL) --sig "balances()"

deploy:
	$(STEP)/DemoDeploy.s.sol $(BROADCAST) $(VERIFY)
	$(MAKE) export-json

launch:
	$(STEP)/DemoLaunch.s.sol $(BROADCAST)
	$(MAKE) export-json

wait-start:
	$(WAIT) .auction.startBlock

bids:
	$(STEP)/DemoBid.s.sol $(BROADCAST)
	$(MAKE) export-json

wait-migration:
	$(WAIT) .auction.migrationBlock

settle:
	$(STEP)/DemoSettle.s.sol $(BROADCAST)
	$(MAKE) export-json

trade:
	$(STEP)/DemoTrade.s.sol $(BROADCAST)
	$(MAKE) export-json

halt:
	HALTED=true $(STEP)/DemoHalt.s.sol $(BROADCAST)
	$(MAKE) export-json

resume:
	HALTED=false $(STEP)/DemoHalt.s.sol $(BROADCAST)
	$(MAKE) export-json

export-json:
	forge script script/demo/ExportDeployments.s.sol

# Frontend ABIs (JSON arrays) from the build output into abis/.
abis:
	forge build
	@mkdir -p abis && rm -f abis/*.json
	@for c in $(ABI_CONTRACTS); do \
		f=$$(find out -name "$$c.json" -path "*/$$c.sol/*" | head -1); \
		test -n "$$f" || { echo "no build output for $$c"; exit 1; }; \
		jq '.abi' "$$f" > abis/$$c.json; \
	done
	@echo "wrote $$(ls abis/*.json | wc -l) ABIs to abis/"

abis-check: abis
	@test -z "$$(git status --porcelain -- abis)" || \
		{ git status --short -- abis; echo "abis/ is out of date: run make abis and commit it"; exit 1; }
