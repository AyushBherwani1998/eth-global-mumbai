// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AuctionValidationHook} from "../../src/AuctionValidationHook.sol";
import {ListingHook} from "../../src/ListingHook.sol";
import {MockSME} from "../../src/MockSME.sol";
import {ListingHookConfig} from "../../src/interfaces/IListingHook.sol";
import {ListingDay, Sepolia} from "../../src/libraries/Constants.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {MockListingPolicy} from "../../src/mocks/MockListingPolicy.sol";
import {AllowAllModule} from "../../src/modules/AllowAllModule.sol";
import {CreReports} from "./CreReports.sol";
import {HookFixture} from "./HookFixture.sol";
import {PoolActions} from "./PoolActions.sol";
import {SepoliaForkTest} from "./SepoliaForkTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    AuctionParameters,
    IContinuousClearingAuction
} from "continuous-clearing-auction/src/interfaces/IContinuousClearingAuction.sol";
import {Vm} from "forge-std/Vm.sol";
import {ILBPInitializer} from "liquidity-launcher/src/interfaces/ILBPInitializer.sol";
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
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";

/// @notice LBPStrategy's public pool-id reservation map (not part of ILBPStrategy).
interface IRegisteredPoolIds {
    function registeredPoolIds(PoolId poolId) external view returns (address initializer);
}

/// @notice The PositionManager calls used to exit the migrated LP position.
interface IPositionManagerExit {
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
    function nextTokenId() external view returns (uint256);
    function getPositionLiquidity(uint256 tokenId) external view returns (uint128 liquidity);
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @notice The Gate 0 launch on a Sepolia fork, entirely through the deployed Uniswap contracts: MockSME ->
///         LiquidityLauncher multicall (depositToken + distributeToken) -> LBPStrategy v3.3.0 -> CCA (factory
///         v2.1.0) -> `setAuction` -> real Sepolia USDC bids via Permit2 -> `migrate()` into a v4 pool behind a
///         mined ListingHook. Shared by the lifecycle and hook-rule fork suites.
abstract contract ListingForkFixture is SepoliaForkTest, HookFixture, PoolActions, CreReports {
    using PoolIdLibrary for PoolKey;

    uint24 internal constant POOL_FEE = 3000;
    int24 internal constant POOL_TICK_SPACING = 60;
    uint64 internal constant AUCTION_BLOCKS = 100;
    uint32 internal constant LISTING_DAY = 1 days;
    /// @dev 20% of the raise goes to the LP (MigratorParameters.lpAllocationSchedule, in mps).
    uint24 internal constant LP_RATE_MPS = 2e6;
    bytes32 internal constant LAUNCH_SALT = keccak256("listing-day-lifecycle");
    uint160 internal constant LISTING_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
    );

    address internal issuer = makeAddr("issuer");
    address internal treasury = makeAddr("issuerTreasury");
    address internal trader = makeAddr("trader");
    address internal attacker = makeAddr("attacker");
    address[5] internal bidders =
        [makeAddr("bidder1"), makeAddr("bidder2"), makeAddr("bidder3"), makeAddr("bidder4"), makeAddr("bidder5")];

    IPoolManager internal manager = IPoolManager(Sepolia.POOL_MANAGER);
    ILBPStrategy internal strategy = ILBPStrategy(Sepolia.LBP_STRATEGY);
    IERC20 internal usdc = IERC20(Sepolia.USDC);

    MockSME internal token;
    AuctionValidationHook internal validationHook;
    AllowAllModule internal module;
    MockListingPolicy internal policy;
    ListingHook internal listingHook;
    IContinuousClearingAuction internal cca;
    PoolSwapTest internal swapRouter;
    PoolKey internal key;

    uint64 internal startBlock;
    uint64 internal endBlock;
    uint64 internal migrationBlock;

    function setUpFork() internal virtual override {
        token = _deployMockSME();
        (validationHook, module) = _deployHookAndModule(issuer, address(token), Sepolia.USDC, ListingDay.APPLICANT_CAP);
        policy = new MockListingPolicy(issuer);
        listingHook = _mineAndDeployListingHook();
        key = listingHook.poolKey();

        _launch();
        vm.prank(issuer);
        validationHook.setAuction(address(cca));

        swapRouter = new PoolSwapTest(manager);
    }

    /// @notice Pool orientation under test. True is the production setup (plan.md "Quote currency").
    function _usdcIsCurrency0() internal pure virtual returns (bool) {
        return true;
    }

    // ---------------------------------------------------------------- setup steps

    /// @dev CREATE2 salt search so MockSME sorts above USDC (USDC is currency0) or, if the suite asks for the
    ///      other orientation, below it.
    function _deployMockSME() internal returns (MockSME sme) {
        bytes32 initCodeHash =
            keccak256(abi.encodePacked(type(MockSME).creationCode, abi.encode("Acme SME", "ACME", issuer)));
        bool above = _usdcIsCurrency0();
        uint256 salt;
        while ((vm.computeCreate2Address(bytes32(salt), initCodeHash, address(this)) > Sepolia.USDC) != above) salt++;
        sme = new MockSME{salt: bytes32(salt)}("Acme SME", "ACME", issuer);
        assertEq(uint160(address(sme)) > uint160(Sepolia.USDC), above, "MockSME sorts on the wrong side of USDC");
    }

    function _mineAndDeployListingHook() internal returns (ListingHook hook) {
        ListingHookConfig memory c = ListingHookConfig({
            owner: issuer,
            usdc: Sepolia.USDC,
            token: address(token),
            fee: POOL_FEE,
            tickSpacing: POOL_TICK_SPACING,
            listingDayBandBps: 500,
            listingDayDuration: LISTING_DAY,
            policySource: policy
        });
        (address mined, bytes32 salt) = HookMiner.find(
            address(this),
            LISTING_HOOK_FLAGS,
            type(ListingHook).creationCode,
            abi.encode(manager, Sepolia.LBP_STRATEGY, c)
        );
        hook = new ListingHook{salt: salt}(manager, Sepolia.LBP_STRATEGY, c);
        assertEq(address(hook), mined, "mined hook address");
    }

    /// @dev Issuer: Permit2 approval, then LiquidityLauncher.multicall(depositToken, distributeToken). LBPStrategy
    ///      creates the CCA through the factory, takes the LP reserve and reserves the v4 pool id for our hook.
    function _launch() internal {
        startBlock = uint64(block.number + 10);
        endBlock = startBlock + AUCTION_BLOCKS;
        migrationBlock = endBlock + 1;

        AuctionParameters memory auctionParams = AuctionParameters({
            currency: Sepolia.USDC,
            tokensRecipient: treasury,
            fundsRecipient: Sepolia.LBP_STRATEGY,
            startBlock: startBlock,
            endBlock: endBlock,
            claimBlock: endBlock,
            tickSpacing: ListingPrice.TICK_SPACING_Q96,
            validationHook: address(validationHook),
            floorPrice: ListingPrice.FLOOR_PRICE_Q96,
            requiredCurrencyRaised: ListingDay.REQUIRED_CURRENCY_RAISED,
            auctionStepsData: abi.encodePacked(uint24(1e7 / AUCTION_BLOCKS), uint40(AUCTION_BLOCKS))
        });
        LiquidityAllocationBracket[] memory brackets = new LiquidityAllocationBracket[](1);
        brackets[0] = LiquidityAllocationBracket({lowerThreshold: 0, rate: LP_RATE_MPS});
        MigratorParameters memory migrationParams = MigratorParameters({
            token: address(token),
            currency: Sepolia.USDC,
            migrationBlock: migrationBlock,
            reservedTokenAmountForLP: ListingDay.LP_RESERVE,
            recipient: treasury,
            positionRecipient: treasury,
            poolParameters: PoolParameters({fee: POOL_FEE, tickSpacing: POOL_TICK_SPACING, hook: address(listingHook)}),
            positionDefinitions: abi.encode(new PositionDefinition[](0)),
            lpAllocationSchedule: abi.encode(brackets)
        });
        Distribution memory distribution = Distribution({
            strategy: Sepolia.LBP_STRATEGY,
            amount: uint128(ListingDay.TOTAL_SUPPLY),
            configData: abi.encode(migrationParams, abi.encode(auctionParams))
        });
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(ILiquidityLauncher.depositToken, (address(token), uint160(ListingDay.TOTAL_SUPPLY)));
        calls[1] = abi.encodeCall(ILiquidityLauncher.distributeToken, (address(token), distribution, LAUNCH_SALT));

        vm.startPrank(issuer);
        token.approve(Sepolia.PERMIT2, type(uint256).max);
        IAllowanceTransfer(Sepolia.PERMIT2)
            .approve(
                address(token),
                Sepolia.LIQUIDITY_LAUNCHER,
                uint160(ListingDay.TOTAL_SUPPLY),
                uint48(block.timestamp + 1 hours)
            );
        vm.recordLogs();
        IMulticall(Sepolia.LIQUIDITY_LAUNCHER).multicall(calls);
        vm.stopPrank();

        cca = IContinuousClearingAuction(_initializerFromLogs());
        assertEq(cca.token(), address(token));
        assertEq(cca.currency(), Sepolia.USDC);
        assertEq(cca.totalSupply(), ListingDay.AUCTION_SUPPLY, "auction gets 90,000");
        assertEq(cca.fundsRecipient(), Sepolia.LBP_STRATEGY);
        assertEq(cca.tokensRecipient(), treasury);
        assertEq(token.balanceOf(address(cca)), ListingDay.AUCTION_SUPPLY);
        assertEq(token.balanceOf(issuer), 0, "issuer deposited the whole supply");
        assertEq(
            IRegisteredPoolIds(Sepolia.LBP_STRATEGY).registeredPoolIds(key.toId()),
            address(cca),
            "pool id reserved for this auction"
        );
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

    // ---------------------------------------------------------------- auction helpers

    /// @dev The first-bid flow from plan.md: USDC.approve(Permit2), Permit2.approve(USDC, auction), submitBid.
    function _bid(address who, uint128 amount) internal returns (uint256 bidId) {
        deal(Sepolia.USDC, who, amount);
        vm.startPrank(who);
        usdc.approve(Sepolia.PERMIT2, type(uint256).max);
        IAllowanceTransfer(Sepolia.PERMIT2)
            .approve(Sepolia.USDC, address(cca), amount, uint48(block.timestamp + 1 days));
        bidId = cca.submitBid(ListingPrice.CAP_PRICE_Q96, amount, who, ListingPrice.FLOOR_PRICE_Q96, "");
        vm.stopPrank();
        assertEq(usdc.balanceOf(who), 0, "bid pulled USDC via Permit2");
    }

    /// @dev All bids land in the first auction block at the 190-point cap, then the auction runs to its end block.
    function _runAuction(uint128[] memory amounts) internal returns (uint256[] memory bidIds) {
        vm.roll(startBlock);
        bidIds = new uint256[](amounts.length);
        for (uint256 i; i < amounts.length; i++) {
            bidIds[i] = _bid(bidders[i], amounts[i]);
        }
        vm.roll(endBlock);
        cca.checkpoint();
    }

    function _amounts99() internal pure returns (uint128[] memory a) {
        a = new uint128[](5);
        (a[0], a[1], a[2], a[3], a[4]) = (20e6, 20e6, 20e6, 20e6, 19e6);
    }

    function _amounts(uint128 a0, uint128 a1, uint128 a2) internal pure returns (uint128[] memory a) {
        a = new uint128[](3);
        (a[0], a[1], a[2]) = (a0, a1, a2);
    }

    function _exitAndClaimAll(uint256[] memory bidIds) internal returns (uint256 claimed) {
        for (uint256 i; i < bidIds.length; i++) {
            cca.exitBid(bidIds[i]);
            uint256 before = token.balanceOf(bidders[i]);
            cca.claimTokens(bidIds[i]);
            claimed += token.balanceOf(bidders[i]) - before;
        }
    }

    function _graduateAt110AndMigrate() internal returns (uint256[] memory bidIds) {
        bidIds = _runAuction(_amounts99());
        vm.roll(migrationBlock);
        strategy.migrate(ILBPInitializer(address(cca)));
        assertTrue(listingHook.listed(), "migration initialized the pool through the hook");
    }
}
