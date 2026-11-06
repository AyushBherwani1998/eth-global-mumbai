// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AuctionValidationHook} from "../../src/AuctionValidationHook.sol";
import {MockSME} from "../../src/MockSME.sol";
import {IAuctionValidationHook} from "../../src/interfaces/IAuctionValidationHook.sol";
import {IEligibilityModule} from "../../src/interfaces/IEligibilityModule.sol";
import {ListingDay} from "../../src/libraries/Constants.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {AllowAllModule} from "../../src/modules/AllowAllModule.sol";
import {HookFixture} from "../utils/HookFixture.sol";
import {HookRevertDecoder} from "../utils/HookRevertDecoder.sol";
import {ContinuousClearingAuction} from "continuous-clearing-auction/src/ContinuousClearingAuction.sol";
import {AuctionParameters} from "continuous-clearing-auction/src/interfaces/IContinuousClearingAuction.sol";
import {ValidationHookLib} from "continuous-clearing-auction/src/libraries/ValidationHookLib.sol";

/// @notice Real CCA v2.1.0 code (compiled from the pinned source) calling our hook. Uses native ETH as the
///         currency so no Permit2 is needed; the USDC + Permit2 path is covered by the fork test.
contract CCAWrapsHookRevertTest is HookFixture {
    address internal issuer = makeAddr("issuer");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    MockSME internal token;
    AuctionValidationHook internal hook;
    AllowAllModule internal module;
    ContinuousClearingAuction internal cca;

    uint256 internal floor = ListingPrice.FLOOR_PRICE_Q96;
    uint256 internal cap = ListingPrice.CAP_PRICE_Q96;

    function setUp() public {
        token = new MockSME("Acme SME", "ACME", issuer);
        (hook, module) = _deployHookAndModule(issuer, address(token), address(0), ListingDay.APPLICANT_CAP);

        uint64 startBlock = uint64(block.number + 5);
        uint64 endBlock = startBlock + 100;
        AuctionParameters memory params = AuctionParameters({
            currency: address(0),
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
        });
        cca = new ContinuousClearingAuction(address(token), ListingDay.AUCTION_SUPPLY, params, address(0));

        vm.startPrank(issuer);
        token.transfer(address(cca), ListingDay.AUCTION_SUPPLY);
        cca.onTokensReceived();
        hook.setAuction(address(cca));
        vm.stopPrank();

        vm.roll(startBlock);
        vm.deal(alice, 1 ether);
        vm.deal(bob, 1 ether);
    }

    function _bid(address from, uint256 maxPriceQ96, uint128 amount, address owner) internal returns (uint256) {
        vm.prank(from);
        return cca.submitBid{value: amount}(maxPriceQ96, amount, owner, floor, "");
    }

    function _wrapped(bytes memory inner) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(ValidationHookLib.ValidationHookCallFailed.selector, inner);
    }

    function test_realCCA_acceptsBidAtCap_withinBudget() public {
        _bid(alice, cap, 20e6, alice);
        assertEq(module.committed(alice), 20e6);
        assertEq(address(cca).balance, 20e6);
    }

    function test_realCCA_wrapsBidAboveCap_asValidationHookCallFailed() public {
        uint256 price191 = ListingPrice.pointsToQ96(191);
        bytes memory inner = abi.encodeWithSelector(IAuctionValidationHook.BidAboveCap.selector, price191, cap);
        vm.expectRevert(_wrapped(inner));
        _bid(alice, price191, 1e6, alice);
    }

    function test_realCCA_wrapsCapExceeded_asValidationHookCallFailed() public {
        _bid(alice, cap, 20e6, alice);
        bytes memory inner = abi.encodeWithSelector(IEligibilityModule.CapExceeded.selector, 20e6 + 1, 20e6);
        vm.expectRevert(_wrapped(inner));
        _bid(alice, cap, 1, alice);
    }

    function test_realCCA_wrapsSenderMustBeOwner_asValidationHookCallFailed() public {
        vm.expectRevert(_wrapped(abi.encodeWithSelector(IAuctionValidationHook.SenderMustBeOwner.selector)));
        _bid(bob, cap, 1e6, alice);
    }

    function test_realCCA_innerErrorIsDecodable() public {
        uint256 price191 = ListingPrice.pointsToQ96(191);
        vm.prank(alice);
        try cca.submitBid{value: 1e6}(price191, 1e6, alice, floor, "") {
            fail();
        } catch (bytes memory revertData) {
            assertEq(HookRevertDecoder.selectorOf(revertData), ValidationHookLib.ValidationHookCallFailed.selector);
            bytes memory inner = HookRevertDecoder.unwrap(revertData);
            assertEq(HookRevertDecoder.selectorOf(inner), IAuctionValidationHook.BidAboveCap.selector);
            (uint256 maxPrice, uint256 capQ96) = abi.decode(HookRevertDecoder.stripSelector(inner), (uint256, uint256));
            assertEq(maxPrice, price191);
            assertEq(capQ96, cap);
            assertEq(ListingPrice.q96ToPoints(maxPrice), 191);
        }
    }
}
