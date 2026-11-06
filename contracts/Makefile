# Listing Day demo entry points. Full walkthrough, env vars and expected output: DEPLOY.md.
#   make demo-fork        whole flow on a Sepolia fork in one process (no keys, nothing broadcast)
#   make demo-anvil       whole flow as separate --broadcast steps against a local anvil fork
#   make demo-sepolia     the real thing: every step with --broadcast on Sepolia, waiting for the auction blocks
#   make ens-fork         ENSv2 ticker namespace (listingday.eth -> acme) on a Sepolia fork, nothing broadcast
#   make ens-sepolia      the ENS steps with --broadcast on Sepolia (after deploy + launch; manual, needs funded keys)
#   ELIGIBILITY=human     any of the above for a World ID listing (WorldPassModule; DEPLOY.md "Human listing")
# Every step target can be run on its own and re-run after a failure (each step skips what is already done).

# .env holds plain KEY=value lines (no quotes). Only its variables are exported, never the derived ones below:
# an exported BROADCAST would carry a stale --rpc-url into nested `make -e` calls.
ifneq (,$(wildcard .env))
include .env
export $(shell sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' .env)
endif

RPC_URL ?= $(SEPOLIA_RPC_URL)
# open: AllowAllModule (per wallet). human: WorldPassModule (per World ID human, passes from services/verify). The
# validation hook's module is immutable, so a human listing is its own launch with its own deployments file.
ELIGIBILITY ?= open
ifeq ($(ELIGIBILITY),human)
DEPLOYMENTS_FILE ?= deployments/sepolia-human.json
endif
DEPLOYMENTS_FILE ?= deployments/sepolia.json
export RPC_URL DEPLOYMENTS_FILE ELIGIBILITY
FORGE_FLAGS ?=
BROADCAST = --rpc-url $(RPC_URL) --broadcast --slow $(FORGE_FLAGS)
VERIFY = $(if $(ETHERSCAN_API_KEY),--verify --etherscan-api-key $(ETHERSCAN_API_KEY),)
STEP = forge script script/demo
WAIT = bash script/demo/wait-for-block.sh
ENS = forge script script/ens
ABI_CONTRACTS = MockSME AllowAllModule WorldPassModule AuctionValidationHook ListingHook ListingPolicyReceiver \
	IListingHook IListingPolicyReceiver IAuctionValidationHook IEligibilityModule IWorldPassModule \
	IContinuousClearingAuction ILBPStrategy ILiquidityLauncher IAllowanceTransfer IPositionManager \
	IStateView IV4Quoter IPoolManager PoolSwapTest IERC20Metadata

.PHONY: demo-fork demo-anvil demo-sepolia check-env fund balances deploy launch wait-start bids \
	wait-migration settle trade halt resume export-json verify-listings abis abis-check \
	ens-fork ens-sepolia check-ens-env ens-name ens-registry ens-ticker ens-records ens-status-role ens-read \
	abis-ensv2

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
	@test "$(ELIGIBILITY)" != human || test -n "$(PASS_SIGNER_KEY)" || \
		(echo "ELIGIBILITY=human: set PASS_SIGNER_KEY (= services/verify's PASS_SIGNER_KEY; scripted bids sign passes)" && exit 1)

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

# services/verify LISTINGS for the human listing in DEPLOYMENTS_FILE (after launch), e.g.
#   LISTINGS=$$(make -s verify-listings ELIGIBILITY=human) npm start      (in ../services/verify)
VERIFY_LISTINGS_JQ = if .contracts.worldPassModule == null or .auction.address == null \
	then error("$(DEPLOYMENTS_FILE): no launched human listing (ELIGIBILITY=human make deploy launch)") \
	else [{ticker: $$ticker, chainId: .chainId, auction: .auction.address, module: .contracts.worldPassModule, \
	cap: (.eligibility.cap | tostring)}] end
verify-listings:
	@jq -ce --arg ticker "$${ENS_TICKER:-acme}" '$(VERIFY_LISTINGS_JQ)' $(DEPLOYMENTS_FILE)

# ---------------------------------------------------------------- ENSv2 ticker namespace (plan.md §7)
# Keys: ENS_OWNER_KEY (owns listingday.eth + the UserRegistry), ISSUER_KEY (owns acme + its resolver); both default
# to PRIVATE_KEY, which must stay the ListingPolicyReceiver owner (setStatusMirror).

ens-fork:
	forge script script/ens/EnsFork.s.sol --fork-url $(SEPOLIA_RPC_URL) --skip-simulation

ens-sepolia: check-ens-env ens-name ens-registry ens-ticker ens-records ens-status-role ens-read
	@echo "ens-sepolia done: $(DEPLOYMENTS_FILE) (.ens)"

check-ens-env:
	@test -n "$(RPC_URL)" || (echo "set SEPOLIA_RPC_URL (or RPC_URL)" && exit 1)
	@test -n "$(PRIVATE_KEY)" || (echo "set PRIVATE_KEY (deployer / receiver owner)" && exit 1)

# Commit, wait MIN_COMMITMENT_AGE (60 s of chain time), register. Re-running after success does nothing.
ens-name:
	$(ENS)/EnsName.s.sol $(BROADCAST)
	bash script/ens/wait-for-commit.sh
	$(ENS)/EnsName.s.sol $(BROADCAST)
	$(MAKE) export-json

ens-registry:
	$(ENS)/EnsRegistry.s.sol $(BROADCAST)
	$(MAKE) export-json

ens-ticker:
	$(ENS)/EnsTicker.s.sol $(BROADCAST)
	$(MAKE) export-json

ens-records:
	$(ENS)/EnsRecords.s.sol $(BROADCAST)
	$(MAKE) export-json

ens-status-role:
	$(ENS)/EnsStatusRole.s.sol $(BROADCAST)
	$(MAKE) export-json

# Read-only: every record through the Universal Resolver, as the frontend reads them.
ens-read:
	$(ENS)/EnsRead.s.sol --rpc-url $(RPC_URL)

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

# Official ENSv2 ABIs into abis/ensv2/ from a contracts-v2 checkout at the pinned tag (committed; `make abis` keeps
# them). git clone --branch v2-mainnet-deployment-1 https://github.com/ensdomains/contracts-v2 $(ENS_V2_DIR)
ENS_V2_DIR ?= ../../contracts-v2
ENS_V2_ABIS = ETHRegistrar ETHRegistry UserRegistryImpl PermissionedResolverImpl VerifiableFactory \
	UniversalResolverV2 StandardRentPriceOracle MockUSDC
abis-ensv2:
	@test "$$(git -C $(ENS_V2_DIR) describe --tags)" = v2-mainnet-deployment-1 || \
		{ echo "$(ENS_V2_DIR) is not contracts-v2 at tag v2-mainnet-deployment-1"; exit 1; }
	@mkdir -p abis/ensv2
	@for c in $(ENS_V2_ABIS); do \
		jq '.abi' $(ENS_V2_DIR)/contracts/deployments/sepolia/$$c.json > abis/ensv2/$$c.json; \
	done
	@echo "wrote $$(ls abis/ensv2/*.json | wc -l) ENSv2 ABIs to abis/ensv2/"

abis-check: abis
	@test -z "$$(git status --porcelain -- abis)" || \
		{ git status --short -- abis; echo "abis/ is out of date: run make abis and commit it"; exit 1; }
