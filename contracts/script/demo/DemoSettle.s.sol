// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Sepolia} from "../../src/libraries/Constants.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {DemoBase, IPositionManagerLike, ISweepState} from "./DemoBase.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAuctionStorage} from "continuous-clearing-auction/src/interfaces/IAuctionStorage.sol";
import {IContinuousClearingAuction} from "continuous-clearing-auction/src/interfaces/IContinuousClearingAuction.sol";
import {Bid} from "continuous-clearing-auction/src/libraries/BidLib.sol";
import {console2} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {ILBPInitializer} from "liquidity-launcher/src/interfaces/ILBPInitializer.sol";
import {ILBPStrategy} from "liquidity-launcher/src/interfaces/ILBPStrategy.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";

/// @notice Step 4: after `endBlock`: exit and claim every bid, sweep unsold shares to the treasury, then after
///         `migrationBlock` `LBPStrategy.migrate(auction)` into the ListingHook pool.
///
///   PRIVATE_KEY=0x… [TREASURY_KEY=0x…] \
///   forge script script/demo/DemoSettle.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --slow
///
/// `migrate()` catches its own failure (`MigrationFailed` + `FundsRecovered`, tx status still 1), so success is the
/// `Migrated` event plus `ListingHook.listed()`, never the receipt status. Exits and claims are permissionless (the
/// deployer pays gas, tokens and refunds go to each bid's owner); the sweep must come from the treasury.
/// Idempotent: exited / claimed bids, a done sweep and a listed pool are skipped.
contract DemoSettle is DemoBase {
    using StateLibrary for IPoolManager;

    /// @dev ERC721 Transfer(address,address,uint256).
    bytes32 internal constant TRANSFER_TOPIC = keccak256("Transfer(address,address,uint256)");

    function run() external {
        _step("DemoSettle");
        Deployment memory d = _load();
        _requireAuction(d);
        require(
            block.number >= d.endBlock,
            string.concat("auction ends at block ", vm.toString(d.endBlock), "; now ", vm.toString(block.number))
        );
        IContinuousClearingAuction cca = d.auction;

        vm.startBroadcast(_deployerKey());
        if (cca.lastCheckpointedBlock() != d.endBlock) {
            _tx("CCA.checkpoint()");
            cca.checkpoint();
        }
        vm.stopBroadcast();

        bool graduated = cca.isGraduated();
        uint256 clearing = cca.clearingPrice();
        console2.log("graduated", graduated);
        console2.log("currencyRaised (raw USDC)", IAuctionStorage(address(cca)).currencyRaised());
        console2.log("clearing price (points)", ListingPrice.q96ToPoints(clearing));

        _exitAndClaimAll(cca, graduated, clearing, d.claimBlock);
        uint256 swept = _sweep(d, cca);
        uint256 lpTokenId = _migrate(d, cca, graduated);
        _save(d, cca, swept, lpTokenId);
    }

    function _exitAndClaimAll(IContinuousClearingAuction cca, bool graduated, uint256 clearing, uint64 claimBlock)
        internal
    {
        uint256 n = cca.nextBidId();
        vm.startBroadcast(_deployerKey());
        for (uint256 id; id < n; id++) {
            Bid memory b = cca.bids(id);
            if (b.exitedBlock == 0) {
                if (!graduated || b.maxPrice > clearing) {
                    _tx(string.concat("CCA.exitBid(", vm.toString(id), ")"));
                    cca.exitBid(id);
                    b = cca.bids(id);
                } else {
                    // At or below the clearing price: needs exitPartiallyFilledBid with checkpoint hints (app flow).
                    console2.log("bid", id, "is at/below clearing: exit it with exitPartiallyFilledBid");
                    continue;
                }
            }
            if (graduated && b.tokensFilled != 0 && block.number >= claimBlock) {
                _tx(string.concat("CCA.claimTokens(", vm.toString(id), ")"));
                cca.claimTokens(id);
            }
        }
        vm.stopBroadcast();
    }

    function _sweep(Deployment memory d, IContinuousClearingAuction cca) internal returns (uint256 swept) {
        if (ISweepState(address(cca)).sweepUnsoldTokensBlock() != 0) {
            console2.log("unsold shares already swept");
            return _jsonUint(_json(), ".results.unsoldSwept");
        }
        require(vm.addr(_treasuryKey()) == d.treasury, "TREASURY_KEY is not the auction's tokensRecipient");
        uint256 before = d.token.balanceOf(d.treasury);
        vm.startBroadcast(_treasuryKey());
        _tx("CCA.sweepUnsoldTokens() (treasury)");
        cca.sweepUnsoldTokens();
        vm.stopBroadcast();
        swept = d.token.balanceOf(d.treasury) - before;
        console2.log("unsold shares swept to treasury", swept);
    }

    function _migrate(Deployment memory d, IContinuousClearingAuction cca, bool graduated)
        internal
        returns (uint256 lpTokenId)
    {
        if (d.hook.listed()) {
            console2.log("pool already listed");
            return d.lpTokenId;
        }
        if (block.number < d.migrationBlock) {
            console2.log("migration opens at block", d.migrationBlock, "- re-run DemoSettle then");
            return 0;
        }
        vm.startBroadcast(_deployerKey());
        vm.recordLogs();
        _tx("LBPStrategy.migrate(auction) (fixed gas limit)");
        ILBPStrategy(Sepolia.LBP_STRATEGY).migrate{gas: MIGRATE_GAS}(ILBPInitializer(address(cca)));
        vm.stopBroadcast();

        bool migrated;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            Vm.Log memory l = logs[i];
            if (l.emitter == Sepolia.LBP_STRATEGY && l.topics[0] == ILBPStrategy.Migrated.selector) migrated = true;
            if (l.emitter == Sepolia.LBP_STRATEGY && l.topics[0] == ILBPStrategy.MigrationFailed.selector) {
                console2.log("MigrationFailed reason:");
                console2.logBytes(abi.decode(l.data, (bytes)));
            }
            if (
                l.emitter == Sepolia.POSITION_MANAGER && l.topics.length == 4 && l.topics[0] == TRANSFER_TOPIC
                    && l.topics[1] == bytes32(0) && address(uint160(uint256(l.topics[2]))) == d.treasury
            ) lpTokenId = uint256(l.topics[3]);
        }
        if (!graduated) {
            console2.log("NOT GRADUATED: bids were refunded and the LP reserve recovered to the treasury; no pool");
            return 0;
        }
        require(migrated && d.hook.listed(), "Migrated not emitted: the pool did not open");
        require(
            lpTokenId != 0 && IPositionManagerLike(Sepolia.POSITION_MANAGER).ownerOf(lpTokenId) == d.treasury, "LP NFT"
        );
        _logPointsE2("pool opened at", _pointsE2(d.hook));
        console2.log("LP NFT (PositionManager) tokenId", lpTokenId);
    }

    function _save(Deployment memory d, IContinuousClearingAuction cca, uint256 swept, uint256 lpTokenId) internal {
        IAuctionStorage s = IAuctionStorage(address(cca));
        string memory r = "results";
        vm.serializeBool(r, "graduated", cca.isGraduated());
        vm.serializeUint(r, "currencyRaised", s.currencyRaised());
        vm.serializeUint(r, "clearingPriceQ96", cca.clearingPrice());
        vm.serializeUint(r, "clearingPoints", ListingPrice.q96ToPoints(cca.clearingPrice()));
        vm.serializeUint(r, "totalCleared", s.totalCleared());
        vm.serializeUint(r, "unsoldSwept", swept);
        vm.serializeBool(r, "migrated", d.hook.listed());
        vm.serializeUint(r, "listingSqrtPriceX96", d.hook.listingSqrtPriceX96());
        vm.serializeUint(
            r,
            "listingPointsE2",
            d.hook.listed()
                ? ListingPrice.sqrtPriceX96ToPointsE2(d.hook.listingSqrtPriceX96(), d.hook.usdcIsCurrency0())
                : 0
        );
        vm.serializeUint(r, "listedAt", d.hook.listedAt());
        vm.serializeUint(r, "listingDayEndsAt", d.hook.listingDayEndsAt());
        vm.serializeUint(r, "poolLiquidity", IPoolManager(Sepolia.POOL_MANAGER).getLiquidity(d.hook.poolId()));
        vm.serializeUint(r, "treasuryUsdc", IERC20(Sepolia.USDC).balanceOf(d.treasury));
        vm.serializeUint(r, "treasuryShares", d.token.balanceOf(d.treasury));
        r = vm.serializeUint(r, "lpTokenId", lpTokenId);
        _writeSection("results", r);
    }
}
