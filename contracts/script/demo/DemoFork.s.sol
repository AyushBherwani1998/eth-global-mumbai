// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IEligibilityModule} from "../../src/interfaces/IEligibilityModule.sol";
import {IListingHook} from "../../src/interfaces/IListingHook.sol";
import {IWorldPassModule} from "../../src/interfaces/IWorldPassModule.sol";
import {ListingDay, Sepolia} from "../../src/libraries/Constants.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {DemoBase, IPositionManagerLike, ISweepState} from "./DemoBase.sol";
import {DemoBid} from "./DemoBid.s.sol";
import {DemoDeploy} from "./DemoDeploy.s.sol";
import {DemoHalt} from "./DemoHalt.s.sol";
import {DemoLaunch} from "./DemoLaunch.s.sol";
import {DemoSettle} from "./DemoSettle.s.sol";
import {DemoTrade} from "./DemoTrade.s.sol";
import {ExportDeployments} from "./ExportDeployments.s.sol";
import {FundDemoWallets} from "./FundDemoWallets.s.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAuctionStorage} from "continuous-clearing-auction/src/interfaces/IAuctionStorage.sol";
import {ValidationHookLib} from "continuous-clearing-auction/src/libraries/ValidationHookLib.sol";
import {console2} from "forge-std/Script.sol";
import {StdAssertions} from "forge-std/StdAssertions.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {Currency} from "v4-core/src/types/Currency.sol";

/// @notice The whole Sepolia demo, every step script in order, on a Sepolia fork in one process: funding (from a
///         dealt funder), deploy, launch, bids across the bid window, settle (before and after migrationBlock),
///         trade, halt, resume, export. Blocks are rolled between steps and every step is re-run once to check
///         it is idempotent. Asserts after each step. Writes `deployments/sepolia-fork.json`.
///
///   forge script script/demo/DemoFork.s.sol --fork-url $SEPOLIA_RPC_URL      (or: make demo-fork)
///
/// ELIGIBILITY=human (make demo-fork ELIGIBILITY=human): the same run on a human listing (WorldPassModule, a
/// throwaway pass signer, scripted passes per bid, plus the recorded second-wallet / expired / over-cap rejections).
/// Writes `deployments/sepolia-fork-human.json`.
///
/// Uses throwaway keys (never the env's PRIVATE_KEY); nothing is broadcast.
contract DemoFork is DemoBase, StdCheats, StdAssertions {
    using StateLibrary for IPoolManager;

    string internal constant FORK_FILE = "deployments/sepolia-fork.json";
    string internal constant FORK_FILE_HUMAN = "deployments/sepolia-fork-human.json";
    uint256 internal constant WALLETS = 8;

    uint256 internal deployerKey = _key("deployer");
    uint256 internal treasuryKey = _key("treasury");
    uint256 internal broadcasterKey = _key("creBroadcaster");
    uint256 internal passSignerKey = _key("passSigner");

    function run() external {
        require(block.chainid == Sepolia.CHAIN_ID, "run on a Sepolia fork: --fork-url $SEPOLIA_RPC_URL");
        _setEnv();
        if (vm.exists(_forkFile())) vm.removeFile(_forkFile());

        _fund();
        Deployment memory d = _deploy();
        d = _launch();
        _bids(d);
        d = _settle(d);
        _trade(d);
        _haltAndResume(d);
        new ExportDeployments().run();
        _checkJson();
        console2.log("");
        console2.log(string.concat("DemoFork (", _eligibility(), "): all steps passed; wrote"), _forkFile());
    }

    // ---------------------------------------------------------------- steps

    function _fund() internal {
        address funder = vm.addr(deployerKey);
        vm.deal(funder, 10 ether);
        deal(Sepolia.USDC, funder, WALLETS * 20e6);
        new FundDemoWallets().run();
        uint256[] memory keys = _demoKeys();
        for (uint256 i; i < keys.length; i++) {
            assertGe(IERC20(Sepolia.USDC).balanceOf(vm.addr(keys[i])), 20e6, "wallet funded with 20 USDC");
            assertGe(vm.addr(keys[i]).balance, 0.02 ether, "wallet funded with ETH");
        }
        assertGe(vm.addr(treasuryKey).balance, 0.02 ether, "treasury gets gas");
        assertGe(vm.addr(broadcasterKey).balance, 0.02 ether, "CRE broadcaster gets gas");
        assertEq(IERC20(Sepolia.USDC).balanceOf(funder), 0, "funder distributed all of it");

        uint256 ethBefore = funder.balance;
        new FundDemoWallets().run();
        assertEq(funder.balance, ethBefore, "funding again sends nothing");
    }

    function _deploy() internal returns (Deployment memory d) {
        new DemoDeploy().run();
        d = _load();
        assertGt(uint160(address(d.token)), uint160(Sepolia.USDC), "MockSME > USDC");
        assertEq(Currency.unwrap(d.hook.poolKey().currency0), Sepolia.USDC, "USDC is currency0");
        assertEq(address(d.hook.policySource()), address(d.receiver), "hook reads the receiver");
        assertEq(d.receiver.broadcaster(), vm.addr(broadcasterKey), "configurable broadcaster");
        assertEq(d.receiver.forwarder(), Sepolia.CRE_MOCK_FORWARDER);
        assertEq(d.token.balanceOf(d.deployer), ListingDay.TOTAL_SUPPLY);
        IEligibilityModule module = d.validationHook.module();
        assertEq(module.hook(), address(d.validationHook), "module bound to the validation hook");
        assertEq(d.human, _human(), "deployments file records the eligibility mode");
        assertEq(vm.parseJsonString(_json(), ".eligibility.mode"), _eligibility());
        assertEq(vm.parseJsonAddress(_json(), ".contracts.eligibilityModule"), address(module));
        if (d.human) {
            assertEq(address(module), address(d.worldPass), "WorldPassModule behind the hook");
            assertEq(d.worldPass.signer(), vm.addr(passSignerKey), "pass signer = the backend's key");
            assertEq(vm.parseJsonAddress(_json(), ".eligibility.passSigner"), vm.addr(passSignerKey));
            assertEq(vm.parseJsonString(_json(), ".eligibility.worldAction"), "listingday-acme");
        } else {
            assertEq(address(module), address(d.module), "AllowAllModule behind the hook");
        }

        new DemoDeploy().run();
        Deployment memory again = _load();
        assertEq(address(again.validationHook), address(d.validationHook), "re-run reuses the validation hook");
        assertEq(address(again.hook), address(d.hook), "re-run reuses the ListingHook");
    }

    function _launch() internal returns (Deployment memory d) {
        new DemoLaunch().run();
        d = _load();
        assertEq(d.validationHook.auction(), address(d.auction), "setAuction done");
        assertLt(block.number, d.startBlock, "setAuction before startBlock");
        assertEq(d.migrationBlock, d.endBlock + 1);
        assertEq(d.auction.totalSupply(), ListingDay.AUCTION_SUPPLY);
        assertEq(d.token.balanceOf(Sepolia.LBP_STRATEGY), ListingDay.LP_RESERVE);

        new DemoLaunch().run();
        assertEq(address(_load().auction), address(d.auction), "re-run keeps the auction");
    }

    /// @dev Bids spread over the bid window (2 per run, 3 blocks apart), then one idempotent re-run.
    function _bids(Deployment memory d) internal {
        vm.roll(d.startBlock);
        vm.setEnv("MAX_BIDS_PER_RUN", "2");
        for (uint256 run_; run_ < 3; run_++) {
            new DemoBid().run();
            vm.roll(vm.getBlockNumber() + 3);
        }
        vm.setEnv("MAX_BIDS_PER_RUN", "100");
        new DemoBid().run();
        uint256[] memory amounts = _bidAmounts();
        uint256 total;
        for (uint256 i; i < amounts.length; i++) {
            address wallet = vm.addr(_demoKeys()[i]);
            if (d.human) {
                assertEq(d.worldPass.walletOf(_demoNullifier(i)), wallet, "nullifier bound to the wallet");
                assertEq(d.worldPass.nullifierOf(wallet), _demoNullifier(i), "wallet bound to the nullifier");
                assertEq(d.worldPass.committed(_demoNullifier(i)), amounts[i], "bid committed per human");
            } else {
                assertEq(d.module.committed(wallet), amounts[i], "bid committed");
            }
            total += amounts[i];
        }
        assertEq(d.auction.nextBidId(), amounts.length, "one bid per wallet, none repeated");
        assertEq(vm.parseJsonUint(_json(), ".bids.count"), amounts.length);
        assertEq(IERC20(Sepolia.USDC).balanceOf(address(d.auction)), total, "USDC pulled via Permit2");
        if (d.human) _checkRejections();
    }

    /// @dev The revert data DemoBid recorded is exactly what `submitBid` would revert with, per case.
    function _checkRejections() internal view {
        string memory j = _json();
        _checkRejection(
            j,
            "secondWallet",
            abi.encodeWithSelector(
                IWorldPassModule.NotEligible.selector, IWorldPassModule.Reason.NullifierBoundToOtherWallet
            )
        );
        _checkRejection(
            j,
            "expiredPass",
            abi.encodeWithSelector(IWorldPassModule.NotEligible.selector, IWorldPassModule.Reason.Expired)
        );
        uint256 cap = ListingDay.APPLICANT_CAP;
        _checkRejection(j, "overCap", abi.encodeWithSelector(IEligibilityModule.CapExceeded.selector, cap + 1, cap));
    }

    function _checkRejection(string memory j, string memory name, bytes memory hookError) internal pure {
        string memory k = string.concat(".rejectedBids.", name);
        assertEq(vm.parseJsonBytes(j, string.concat(k, ".hookError")), hookError, name);
        assertEq(
            vm.parseJsonBytes(j, string.concat(k, ".revertData")),
            abi.encodeWithSelector(ValidationHookLib.ValidationHookCallFailed.selector, hookError),
            string.concat(name, ": wrapped by the CCA")
        );
    }

    function _settle(Deployment memory d) internal returns (Deployment memory) {
        vm.roll(d.endBlock);
        new DemoSettle().run();
        assertTrue(d.auction.isGraduated(), "graduated");
        assertFalse(d.hook.listed(), "migration not open yet");
        assertGt(ISweepState(address(d.auction)).sweepUnsoldTokensBlock(), 0, "unsold swept to treasury");

        vm.roll(d.migrationBlock);
        new DemoSettle().run();
        d = _load();
        assertApproxEqAbs(IAuctionStorage(address(d.auction)).currencyRaised(), 99e6, 1, "99 USDC raised");
        assertEq(ListingPrice.q96ToPoints(d.auction.clearingPrice()), 110, "clears at 110 points");
        assertTrue(d.hook.listed(), "Migrated: pool open");
        assertApproxEqAbs(d.hook.currentPointsE2(), 11_000, 1, "pool opens at 110 points");
        assertEq(uint8(d.hook.phase()), uint8(IListingHook.Phase.ListingDay));
        assertEq(IPositionManagerLike(Sepolia.POSITION_MANAGER).ownerOf(d.lpTokenId), d.treasury, "LP NFT");
        assertGt(IPoolManager(Sepolia.POOL_MANAGER).getLiquidity(d.hook.poolId()), 0, "LP minted");
        uint256[] memory amounts = _bidAmounts();
        for (uint256 i; i < amounts.length; i++) {
            assertGt(d.token.balanceOf(vm.addr(_demoKeys()[i])), 0, "bidder claimed shares");
        }
        assertTrue(vm.parseJsonBool(_json(), ".results.migrated"));

        new DemoSettle().run();
        return d;
    }

    function _trade(Deployment memory d) internal {
        new DemoTrade().run();
        assertApproxEqAbs(d.hook.currentPointsE2(), 11_400, 2, "in-band buy to 114 passed");
        string memory j = _json();
        bytes memory revertData = vm.parseJsonBytes(j, ".trade.outOfBandRevertData");
        assertEq(_selector(_unwrapHookRevert(revertData)), IListingHook.OutOfBand.selector, "117 reverts OutOfBand");
        assertApproxEqAbs(vm.parseJsonUint(j, ".trade.bandHighPointsE2"), 11_550, 1, "listing-day band top");

        new DemoTrade().run();
        assertApproxEqAbs(d.hook.currentPointsE2(), 11_400, 2, "re-run does not buy again");
    }

    function _haltAndResume(Deployment memory d) internal {
        d = _load();
        uint128 liquidity = IPositionManagerLike(Sepolia.POSITION_MANAGER).getPositionLiquidity(d.lpTokenId);
        new DemoHalt().run();
        assertTrue(d.receiver.policy().halted, "receiver halted");
        string memory j = _json();
        bytes memory halted = vm.parseJsonBytes(j, ".halt.haltedSwapRevertData");
        assertEq(_selector(_unwrapHookRevert(halted)), IListingHook.Halted.selector, "swap reverts Halted");
        uint256 removed = vm.parseJsonUint(j, ".halt.lpRemovedLiquidity");
        assertGt(removed, 0, "LP removal while halted");
        assertEq(
            IPositionManagerLike(Sepolia.POSITION_MANAGER).getPositionLiquidity(d.lpTokenId),
            liquidity - removed,
            "liquidity left the pool"
        );

        new DemoHalt().run();
        assertEq(vm.parseJsonUint(_json(), ".halt.lpRemovedLiquidity"), removed, "re-run removes nothing more");

        vm.warp(vm.getBlockTimestamp() + 12);
        vm.roll(vm.getBlockNumber() + 1);
        vm.setEnv("HALTED", "false");
        new DemoHalt().run();
        vm.setEnv("HALTED", "true");
        assertFalse(d.receiver.policy().halted, "resumed");
        (uint160 sqrtP,,,) = IPoolManager(Sepolia.POOL_MANAGER).getSlot0(d.hook.poolId());
        (bool ok,) = _simulate(
            vm.addr(_traderKey()),
            address(d.swapRouter),
            _swapCall(d.hook.poolKey(), sqrtP, _pointsSqrt(112, d.hook.usdcIsCurrency0()))
        );
        assertTrue(ok, "swaps work again after the resume report");
    }

    function _checkJson() internal view {
        string memory j = _json();
        string[37] memory keys = [
            ".chainId",
            ".label",
            ".deployBlock",
            ".deployer",
            ".treasury",
            ".creBroadcaster",
            ".external.usdc",
            ".external.permit2",
            ".external.poolManager",
            ".external.positionManager",
            ".external.universalRouter",
            ".external.stateView",
            ".external.lbpStrategy",
            ".contracts.mockSME",
            _human() ? ".contracts.worldPassModule" : ".contracts.allowAllModule",
            ".contracts.eligibilityModule",
            ".eligibility.mode",
            ".eligibility.cap",
            ".contracts.auctionValidationHook",
            ".contracts.listingHook",
            ".contracts.listingPolicyReceiver",
            ".pool.poolId",
            ".pool.usdcIsCurrency0",
            ".pool.poolKey.currency0",
            ".pool.poolKey.currency1",
            ".pool.poolKey.fee",
            ".pool.poolKey.tickSpacing",
            ".pool.poolKey.hooks",
            ".auction.address",
            ".auction.startBlock",
            ".auction.endBlock",
            ".auction.claimBlock",
            ".auction.migrationBlock",
            ".results.clearingPriceQ96",
            ".results.lpTokenId",
            ".trade.swapRouter",
            ".txs.deploy"
        ];
        for (uint256 i; i < keys.length; i++) {
            assertTrue(vm.keyExistsJson(j, keys[i]), string.concat("deployments json has ", keys[i]));
        }
        assertEq(vm.parseJsonUint(j, ".chainId"), Sepolia.CHAIN_ID);
        assertEq(vm.parseJsonUint(j, ".auction.claimBlock"), vm.parseJsonUint(j, ".auction.endBlock"));
        assertEq(vm.parseJsonUint(j, ".auction.migrationBlock"), vm.parseJsonUint(j, ".auction.endBlock") + 1);
        assertEq(vm.parseJsonAddress(j, ".pool.poolKey.hooks"), vm.parseJsonAddress(j, ".contracts.listingHook"));
    }

    // ---------------------------------------------------------------- env

    function _forkFile() internal view returns (string memory) {
        return _human() ? FORK_FILE_HUMAN : FORK_FILE;
    }

    function _setEnv() internal {
        vm.setEnv("ELIGIBILITY", _eligibility());
        vm.setEnv("DEPLOYMENTS_FILE", _forkFile());
        vm.setEnv("DEMO_LABEL", _human() ? "fork-human" : "fork");
        vm.setEnv("ENS_TICKER", "acme");
        vm.setEnv("PASS_SIGNER_KEY", vm.toString(bytes32(passSignerKey)));
        vm.setEnv("PASS_SIGNER_ADDRESS", vm.toString(vm.addr(passSignerKey)));
        vm.setEnv("PRIVATE_KEY", vm.toString(bytes32(deployerKey)));
        vm.setEnv("FUNDER_KEY", vm.toString(bytes32(deployerKey)));
        vm.setEnv("TREASURY_KEY", vm.toString(bytes32(treasuryKey)));
        vm.setEnv("CRE_BROADCASTER_KEY", vm.toString(bytes32(broadcasterKey)));
        vm.setEnv("HALTED", "true");
        string memory keys;
        for (uint256 i; i < WALLETS; i++) {
            keys = string.concat(
                keys, i == 0 ? "" : ",", vm.toString(bytes32(_key(string.concat("wallet", vm.toString(i)))))
            );
        }
        vm.setEnv("DEMO_WALLET_KEYS", keys);
    }

    /// @dev Separate keys per mode, so an open and a human run can share one fork (DemoScripts.fork.t.sol).
    function _key(string memory name) internal view returns (uint256) {
        return uint256(keccak256(abi.encode(_human() ? "listing-day fork key human" : "listing-day fork key", name)));
    }
}
