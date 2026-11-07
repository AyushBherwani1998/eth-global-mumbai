// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ListingDay, Sepolia} from "../../src/libraries/Constants.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {DemoBase, IRegisteredPoolIds} from "./DemoBase.sol";
import {
    AuctionParameters,
    IContinuousClearingAuction
} from "continuous-clearing-auction/src/interfaces/IContinuousClearingAuction.sol";
import {console2} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {ILBPStrategy} from "liquidity-launcher/src/interfaces/ILBPStrategy.sol";
import {ILiquidityLauncher} from "liquidity-launcher/src/interfaces/ILiquidityLauncher.sol";
import {IMulticall} from "liquidity-launcher/src/interfaces/IMulticall.sol";
import {
    LiquidityAllocationBracket,
    MigratorParameters,
    PoolParameters
} from "liquidity-launcher/src/libraries/MigratorParams.sol";
import {Distribution} from "liquidity-launcher/src/types/Distribution.sol";
import {PositionDefinition} from "liquidity-launcher/src/types/PositionPlannerTypes.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";

/// @notice Step 2: LiquidityLauncher.multicall(depositToken, distributeToken) -> LBPStrategy creates the CCA
///         (90,000 auctioned, 20,000 kept for the LP, pool id reserved for the ListingHook), then
///         `validationHook.setAuction(auction)` strictly before `startBlock`.
///
///   PRIVATE_KEY=0x… [START_DELAY_BLOCKS=10] [BID_WINDOW_BLOCKS=30] [CLEAR_BLOCKS=20] \
///   forge script script/demo/DemoLaunch.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --slow
///
/// Auction schedule (blocks, ~12 s each on Sepolia):
///   launch .. startBlock                 START_DELAY_BLOCKS: room for the 4 launch txs incl. setAuction
///   startBlock .. +BID_WINDOW_BLOCKS     bid window, 0 mps: no supply released, so every bid in it counts as if
///                                        placed in the same block (99 USDC clears at 110 points)
///   .. endBlock                          CLEAR_BLOCKS releasing 1e7 / CLEAR_BLOCKS mps each
///   claimBlock = endBlock, migrationBlock = endBlock + 1
/// Defaults: ~2 min lead, ~6 min bid window, ~4 min clearing.
contract DemoLaunch is DemoBase {
    uint24 internal constant MPS_TOTAL = 1e7;

    function run() external {
        _step("DemoLaunch");
        Deployment memory d = _load();
        address issuer = vm.addr(_deployerKey());
        require(issuer == d.deployer, "PRIVATE_KEY is not the deployer in the deployments file");
        uint256 totalSup = _totalSupply();
        require(d.token.balanceOf(issuer) == totalSup, "issuer must hold the whole supply");
        bytes32 poolId = PoolId.unwrap(d.hook.poolId());

        IContinuousClearingAuction auction = d.auction;
        if (address(auction).code.length == 0) {
            address registered = IRegisteredPoolIds(Sepolia.LBP_STRATEGY).registeredPoolIds(poolId);
            if (registered != address(0)) {
                auction = IContinuousClearingAuction(registered);
                console2.log("auction already launched (recovered from LBPStrategy):", registered);
            } else {
                auction = _launch(d, issuer);
            }
        } else {
            console2.log("auction already launched:", address(auction));
        }

        if (d.validationHook.auction() == address(0)) {
            uint64 start = auction.startBlock();
            require(
                block.number < start,
                "startBlock passed before setAuction: launch a new listing (new DEMO_LABEL, larger START_DELAY_BLOCKS)"
            );
            vm.startBroadcast(_deployerKey());
            _tx("AuctionValidationHook.setAuction(auction)");
            d.validationHook.setAuction(address(auction));
            vm.stopBroadcast();
        }

        require(d.validationHook.auction() == address(auction), "validation hook bound to the auction");
        require(address(auction.validationHook()) == address(d.validationHook), "auction uses our validation hook");
        uint256 auctionSup = _auctionSupply();
        require(auction.totalSupply() == auctionSup, "auction supply matches config");
        require(d.token.balanceOf(Sepolia.LBP_STRATEGY) >= _lpReserve(), "strategy holds the LP reserve");
        _save(auction);
    }

    function _totalSupply() internal view returns (uint256) {
        return vm.envOr("TOTAL_SUPPLY_SHARES", uint256(110_000)) * 1e18;
    }

    function _auctionSupply() internal view returns (uint256) {
        return vm.envOr("AUCTION_SUPPLY_SHARES", uint256(90_000)) * 1e18;
    }

    function _lpReserve() internal view returns (uint256) {
        return vm.envOr("LP_RESERVE_SHARES", uint256(20_000)) * 1e18;
    }

    function _launch(Deployment memory d, address issuer) internal returns (IContinuousClearingAuction auction) {
        uint64 startDelay = uint64(vm.envOr("START_DELAY_BLOCKS", uint256(10)));
        uint64 bidWindow = uint64(vm.envOr("BID_WINDOW_BLOCKS", uint256(30)));
        uint64 clearBlocks = uint64(vm.envOr("CLEAR_BLOCKS", uint256(20)));
        require(startDelay >= 4, "START_DELAY_BLOCKS must leave room for setAuction");
        require(clearBlocks != 0 && MPS_TOTAL % clearBlocks == 0, "CLEAR_BLOCKS must divide 1e7");
        uint256 totalSup = _totalSupply();
        require(d.token.balanceOf(issuer) == totalSup, "issuer must hold the whole supply");

        uint64 startBlock = uint64(block.number) + startDelay;
        uint64 endBlock = startBlock + bidWindow + clearBlocks;
        bytes[] memory calls = _launchCalls(d, startBlock, endBlock, bidWindow, clearBlocks);

        vm.startBroadcast(_deployerKey());
        _approveLauncher(d, issuer);
        vm.recordLogs();
        _tx("LiquidityLauncher.multicall(depositToken, distributeToken)");
        IMulticall(Sepolia.LIQUIDITY_LAUNCHER).multicall(calls);
        vm.stopBroadcast();

        auction = IContinuousClearingAuction(_initializerFromLogs());
        console2.log("auction (CCA)", address(auction));
        console2.log("  startBlock    ", startBlock);
        console2.log("  bid window end", startBlock + bidWindow);
        console2.log("  endBlock      ", endBlock);
        console2.log("  migrationBlock", endBlock + 1);
    }

    /// @dev `LiquidityLauncher.multicall([depositToken, distributeToken])` calldata (same parameters as the
    ///      lifecycle fork test, with the demo block schedule).
    function _launchCalls(Deployment memory d, uint64 startBlock, uint64 endBlock, uint64 bidWindow, uint64 clearBlocks)
        internal
        view
        returns (bytes[] memory calls)
    {
        bytes memory steps = abi.encodePacked(uint24(MPS_TOTAL / clearBlocks), uint40(clearBlocks));
        if (bidWindow != 0) steps = abi.encodePacked(uint24(0), uint40(bidWindow), steps);

        uint256 floorPts = _floorPoints();
        uint256 floorPriceQ96 = floorPts * ListingPrice.ONE_POINT_Q96;
        AuctionParameters memory auctionParams = AuctionParameters({
            currency: Sepolia.USDC,
            tokensRecipient: d.treasury,
            fundsRecipient: Sepolia.LBP_STRATEGY,
            startBlock: startBlock,
            endBlock: endBlock,
            claimBlock: endBlock,
            tickSpacing: ListingPrice.TICK_SPACING_Q96,
            validationHook: address(d.validationHook),
            floorPrice: floorPriceQ96,
            requiredCurrencyRaised: _requiredRaise(),
            auctionStepsData: steps
        });
        LiquidityAllocationBracket[] memory brackets = new LiquidityAllocationBracket[](1);
        brackets[0] = LiquidityAllocationBracket({lowerThreshold: 0, rate: LP_RATE_MPS});
        uint256 totalSup = _totalSupply();
        MigratorParameters memory migrationParams = MigratorParameters({
            token: address(d.token),
            currency: Sepolia.USDC,
            migrationBlock: endBlock + 1,
            reservedTokenAmountForLP: uint128(_lpReserve()),
            recipient: d.treasury,
            positionRecipient: d.treasury,
            poolParameters: PoolParameters({fee: POOL_FEE, tickSpacing: POOL_TICK_SPACING, hook: address(d.hook)}),
            positionDefinitions: abi.encode(new PositionDefinition[](0)),
            lpAllocationSchedule: abi.encode(brackets)
        });
        Distribution memory distribution = Distribution({
            strategy: Sepolia.LBP_STRATEGY,
            amount: uint128(totalSup),
            configData: abi.encode(migrationParams, abi.encode(auctionParams))
        });
        calls = new bytes[](2);
        calls[0] = abi.encodeCall(ILiquidityLauncher.depositToken, (address(d.token), uint160(totalSup)));
        calls[1] = abi.encodeCall(ILiquidityLauncher.distributeToken, (address(d.token), distribution, _salt("launch")));
    }

    function _floorPoints() internal view returns (uint256) {
        return vm.envOr("FLOOR_POINTS", uint256(80));
    }

    function _requiredRaise() internal view returns (uint128) {
        return uint128(vm.envOr("REQUIRED_RAISE_USDC_RAW", uint256(45e6)));
    }

    /// @dev The launcher pulls the deposit through Permit2. Runs inside the issuer's broadcast.
    function _approveLauncher(Deployment memory d, address issuer) internal {
        uint256 totalSup = _totalSupply();
        if (d.token.allowance(issuer, Sepolia.PERMIT2) < totalSup) {
            _tx("MockSME.approve(Permit2, max)");
            d.token.approve(Sepolia.PERMIT2, type(uint256).max);
        }
        (uint160 amount, uint48 expiration,) =
            IAllowanceTransfer(Sepolia.PERMIT2).allowance(issuer, address(d.token), Sepolia.LIQUIDITY_LAUNCHER);
        if (amount < totalSup || expiration < block.timestamp + 10 minutes) {
            _tx("Permit2.approve(MockSME, LiquidityLauncher, supply, +1h)");
            IAllowanceTransfer(Sepolia.PERMIT2)
                .approve(
                    address(d.token),
                    Sepolia.LIQUIDITY_LAUNCHER,
                    uint160(totalSup),
                    uint48(block.timestamp + 1 hours)
                );
        }
    }

    function _initializerFromLogs() internal view returns (address) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (
                logs[i].emitter == Sepolia.LBP_STRATEGY && logs[i].topics[0] == ILBPStrategy.InitializerCreated.selector
            ) {
                return address(uint160(uint256(logs[i].topics[1])));
            }
        }
        revert("InitializerCreated not emitted");
    }

    function _save(IContinuousClearingAuction auction) internal {
        MigratorParameters memory m = ILBPStrategy(Sepolia.LBP_STRATEGY).initializers(auction);
        string memory a = "auction";
        vm.serializeAddress(a, "address", address(auction));
        vm.serializeUint(a, "startBlock", auction.startBlock());
        vm.serializeUint(a, "endBlock", auction.endBlock());
        vm.serializeUint(a, "claimBlock", auction.claimBlock());
        vm.serializeUint(a, "migrationBlock", m.migrationBlock);
        // The schedule is only known at launch time; a re-run keeps what the launch recorded.
        string memory j = _json();
        uint256 bidWindow = vm.keyExistsJson(j, ".auction.bidWindowBlocks")
            ? vm.parseJsonUint(j, ".auction.bidWindowBlocks")
            : vm.envOr("BID_WINDOW_BLOCKS", uint256(30));
        vm.serializeUint(a, "bidWindowBlocks", bidWindow);
        vm.serializeUint(a, "bidWindowEndBlock", auction.startBlock() + bidWindow);
        vm.serializeUint(a, "clearBlocks", auction.endBlock() - auction.startBlock() - bidWindow);
        vm.serializeUint(a, "totalSupply", auction.totalSupply());
        uint256 floorPts = _floorPoints();
        vm.serializeUint(a, "floorPriceQ96", floorPts * ListingPrice.ONE_POINT_Q96);
        vm.serializeUint(a, "tickSpacingQ96", ListingPrice.TICK_SPACING_Q96);
        vm.serializeUint(a, "requiredCurrencyRaised", ListingDay.REQUIRED_CURRENCY_RAISED);
        vm.serializeUint(a, "reservedTokenAmountForLP", m.reservedTokenAmountForLP);
        vm.serializeAddress(a, "tokensRecipient", auction.tokensRecipient());
        vm.serializeAddress(a, "fundsRecipient", auction.fundsRecipient());
        a = vm.serializeAddress(a, "validationHook", address(auction.validationHook()));
        _writeSection("auction", a);
    }
}
