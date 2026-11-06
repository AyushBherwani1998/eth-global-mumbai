// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AuctionValidationHook} from "../../src/AuctionValidationHook.sol";
import {MockSME} from "../../src/MockSME.sol";
import {IAuctionValidationHook} from "../../src/interfaces/IAuctionValidationHook.sol";
import {IEligibilityModule} from "../../src/interfaces/IEligibilityModule.sol";
import {ListingDay, Sepolia} from "../../src/libraries/Constants.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {AllowAllModule} from "../../src/modules/AllowAllModule.sol";
import {HookFixture} from "../utils/HookFixture.sol";
import {HookRevertDecoder} from "../utils/HookRevertDecoder.sol";
import {SepoliaForkTest} from "../utils/SepoliaForkTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    AuctionParameters,
    IContinuousClearingAuction
} from "continuous-clearing-auction/src/interfaces/IContinuousClearingAuction.sol";
import {ValidationHookLib} from "continuous-clearing-auction/src/libraries/ValidationHookLib.sol";
import {IDistributorFactory} from "liquidity-launcher/src/interfaces/IDistributorFactory.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

/// @notice The deployed Sepolia CCA factory v2.1.0 creates an auction that names our hook; bids pay real
///         Sepolia USDC through Permit2, and hook reverts come back wrapped as `ValidationHookCallFailed`.
contract CCAFactoryHookForkTest is SepoliaForkTest, HookFixture {
    address internal issuer = makeAddr("issuer");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    MockSME internal token;
    AuctionValidationHook internal hook;
    AllowAllModule internal module;
    IContinuousClearingAuction internal cca;
    IERC20 internal usdc = IERC20(Sepolia.USDC);

    uint256 internal floor = ListingPrice.FLOOR_PRICE_Q96;
    uint256 internal cap = ListingPrice.CAP_PRICE_Q96;

    function setUpFork() internal override {
        token = new MockSME("Acme SME", "ACME", issuer);
        (hook, module) = _deployHookAndModule(issuer, address(token), Sepolia.USDC, ListingDay.APPLICANT_CAP);

        uint64 startBlock = uint64(block.number + 5);
        uint64 endBlock = startBlock + 100;
        bytes memory configData = abi.encode(
            AuctionParameters({
                currency: Sepolia.USDC,
                tokensRecipient: issuer,
                fundsRecipient: issuer,
                startBlock: startBlock,
                endBlock: endBlock,
                claimBlock: endBlock,
                tickSpacing: ListingPrice.TICK_SPACING_Q96,
                validationHook: address(hook),
                floorPrice: floor,
                requiredCurrencyRaised: ListingDay.REQUIRED_CURRENCY_RAISED,
                auctionStepsData: abi.encodePacked(uint24(1e5), uint40(100))
            })
        );
        IDistributorFactory factory = IDistributorFactory(Sepolia.CCA_FACTORY);
        bytes32 salt = keccak256("listing-day-fork-test");
        address predicted =
            address(factory.getAddress(address(token), ListingDay.AUCTION_SUPPLY, configData, salt, issuer));

        vm.startPrank(issuer);
        cca = IContinuousClearingAuction(
            address(factory.create(address(token), ListingDay.AUCTION_SUPPLY, configData, salt))
        );
        assertEq(address(cca), predicted, "factory getAddress");
        token.transfer(address(cca), ListingDay.AUCTION_SUPPLY);
        cca.onTokensReceived();
        hook.setAuction(address(cca));
        vm.stopPrank();

        assertEq(address(cca.validationHook()), address(hook));
        assertEq(hook.auction(), address(cca));

        vm.roll(startBlock);
        _fundAndApprove(alice, 21e6);
        _fundAndApprove(bob, 21e6);
    }

    /// @dev The 3 first-bid approvals from plan.md: USDC.approve(Permit2), Permit2.approve(USDC, auction).
    function _fundAndApprove(address who, uint256 amount) internal {
        deal(Sepolia.USDC, who, amount);
        assertEq(usdc.balanceOf(who), amount, "deal USDC");
        vm.startPrank(who);
        usdc.approve(Sepolia.PERMIT2, type(uint256).max);
        IAllowanceTransfer(Sepolia.PERMIT2)
            .approve(Sepolia.USDC, address(cca), type(uint160).max, uint48(block.timestamp + 1 days));
        vm.stopPrank();
    }

    function _bid(address from, uint256 maxPriceQ96, uint128 amount, address owner) internal returns (uint256) {
        vm.prank(from);
        return cca.submitBid(maxPriceQ96, amount, owner, floor, "");
    }

    function _wrapped(bytes memory inner) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(ValidationHookLib.ValidationHookCallFailed.selector, inner);
    }

    function test_fork_bidAtCap_20Usdc_pullsUsdcViaPermit2() public {
        _bid(alice, cap, 20e6, alice);
        assertEq(module.committed(alice), 20e6);
        assertEq(usdc.balanceOf(address(cca)), 20e6);
        assertEq(usdc.balanceOf(alice), 1e6);
    }

    function test_fork_bidAbove190_wrappedBidAboveCap_decodable() public {
        uint256 price191 = ListingPrice.pointsToQ96(191);
        vm.prank(alice);
        try cca.submitBid(price191, 1e6, alice, floor, "") {
            fail();
        } catch (bytes memory revertData) {
            assertEq(HookRevertDecoder.selectorOf(revertData), ValidationHookLib.ValidationHookCallFailed.selector);
            bytes memory inner = HookRevertDecoder.unwrap(revertData);
            assertEq(inner, abi.encodeWithSelector(IAuctionValidationHook.BidAboveCap.selector, price191, cap));
        }
        assertEq(usdc.balanceOf(alice), 21e6, "reverted bid keeps funds");
    }

    function test_fork_cumulativeCap_wrappedCapExceeded() public {
        _bid(alice, cap, 20e6, alice);
        vm.expectRevert(_wrapped(abi.encodeWithSelector(IEligibilityModule.CapExceeded.selector, 20e6 + 1, 20e6)));
        _bid(alice, cap, 1, alice);

        _bid(bob, cap, 20e6, bob);
        assertEq(module.committed(bob), 20e6);
    }

    function test_fork_senderNotOwner_wrappedSenderMustBeOwner() public {
        vm.expectRevert(_wrapped(abi.encodeWithSelector(IAuctionValidationHook.SenderMustBeOwner.selector)));
        _bid(bob, cap, 1e6, alice);
    }
}
