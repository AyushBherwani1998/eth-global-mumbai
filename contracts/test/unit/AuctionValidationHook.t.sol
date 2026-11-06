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
import {MockAuction} from "../utils/MockAuction.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IValidationHook} from "continuous-clearing-auction/src/interfaces/IValidationHook.sol";

contract AuctionValidationHookTest is HookFixture {
    address internal issuer = makeAddr("issuer");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal usdc = Sepolia.USDC;

    MockSME internal token;
    AuctionValidationHook internal hook;
    AllowAllModule internal module;
    MockAuction internal auction;

    uint256 internal cap = ListingPrice.CAP_PRICE_Q96;
    uint256 internal price190 = ListingPrice.pointsToQ96(190);
    uint256 internal price191 = ListingPrice.pointsToQ96(191);
    uint256 internal price110 = ListingPrice.pointsToQ96(110);

    function setUp() public {
        token = new MockSME("Acme SME", "ACME", issuer);
        (hook, module) = _deployHookAndModule(issuer, address(token), usdc, ListingDay.APPLICANT_CAP);
        auction = _newAuction(address(hook), address(token), usdc);
        vm.prank(issuer);
        hook.setAuction(address(auction));
    }

    function _newAuction(address hook_, address token_, address currency_) internal returns (MockAuction) {
        return new MockAuction(hook_, token_, currency_, uint64(block.number + 10));
    }

    // ---------------------------------------------------------------- only the bound auction

    function test_validate_revertsOnlyAuction_whenCalledDirectly() public {
        vm.prank(alice);
        vm.expectRevert(IAuctionValidationHook.OnlyAuction.selector);
        hook.validate(price110, 1e6, alice, alice, "");
    }

    function test_validate_revertsOnlyAuction_fromOtherAuctionNamingThisHook() public {
        MockAuction rogue = _newAuction(address(hook), address(token), usdc);
        vm.prank(alice);
        vm.expectRevert(IAuctionValidationHook.OnlyAuction.selector);
        rogue.submitBid(price110, 1e6, alice, "");
    }

    function test_validate_revertsOnlyAuction_beforeSetAuction() public {
        (AuctionValidationHook freshHook,) =
            _deployHookAndModule(issuer, address(token), usdc, ListingDay.APPLICANT_CAP);
        MockAuction freshAuction = _newAuction(address(freshHook), address(token), usdc);
        vm.prank(alice);
        vm.expectRevert(IAuctionValidationHook.OnlyAuction.selector);
        freshAuction.submitBid(price110, 1e6, alice, "");
    }

    function test_validate_acceptsBoundAuction() public {
        vm.prank(alice);
        auction.submitBid(price110, 1e6, alice, "");
        assertEq(module.committed(alice), 1e6);
    }

    // ---------------------------------------------------------------- setAuction

    function test_setAuction_bindsOnceAndEmits() public {
        (AuctionValidationHook freshHook,) =
            _deployHookAndModule(issuer, address(token), usdc, ListingDay.APPLICANT_CAP);
        MockAuction freshAuction = _newAuction(address(freshHook), address(token), usdc);
        vm.expectEmit(true, false, false, false, address(freshHook));
        emit IAuctionValidationHook.AuctionSet(address(freshAuction));
        vm.prank(issuer);
        freshHook.setAuction(address(freshAuction));
        assertEq(freshHook.auction(), address(freshAuction));
        assertEq(hook.auction(), address(auction));
    }

    function test_setAuction_revertsOnlyDeployer() public {
        (AuctionValidationHook freshHook,) =
            _deployHookAndModule(issuer, address(token), usdc, ListingDay.APPLICANT_CAP);
        MockAuction freshAuction = _newAuction(address(freshHook), address(token), usdc);
        assertEq(freshHook.deployer(), issuer);
        vm.prank(alice);
        vm.expectRevert(IAuctionValidationHook.OnlyDeployer.selector);
        freshHook.setAuction(address(freshAuction));
    }

    function test_setAuction_revertsWhenCalledTwice() public {
        MockAuction second = _newAuction(address(hook), address(token), usdc);
        vm.prank(issuer);
        vm.expectRevert(IAuctionValidationHook.AuctionAlreadySet.selector);
        hook.setAuction(address(second));
        assertEq(hook.auction(), address(auction));
    }

    function test_setAuction_revertsIfAuctionValidationHookIsNotThis() public {
        (AuctionValidationHook freshHook,) =
            _deployHookAndModule(issuer, address(token), usdc, ListingDay.APPLICANT_CAP);
        address otherHook = makeAddr("otherHook");
        MockAuction wrongHookAuction = _newAuction(otherHook, address(token), usdc);
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(IAuctionValidationHook.ValidationHookMismatch.selector, otherHook));
        freshHook.setAuction(address(wrongHookAuction));
    }

    function test_setAuction_revertsIfTokenMismatch() public {
        (AuctionValidationHook freshHook,) =
            _deployHookAndModule(issuer, address(token), usdc, ListingDay.APPLICANT_CAP);
        address otherToken = makeAddr("otherToken");
        MockAuction wrongToken = _newAuction(address(freshHook), otherToken, usdc);
        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(IAuctionValidationHook.TokenMismatch.selector, address(token), otherToken)
        );
        freshHook.setAuction(address(wrongToken));
    }

    function test_setAuction_revertsIfCurrencyMismatch() public {
        (AuctionValidationHook freshHook,) =
            _deployHookAndModule(issuer, address(token), usdc, ListingDay.APPLICANT_CAP);
        MockAuction nativeAuction = _newAuction(address(freshHook), address(token), address(0));
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(IAuctionValidationHook.CurrencyMismatch.selector, usdc, address(0)));
        freshHook.setAuction(address(nativeAuction));
    }

    function test_setAuction_revertsAtOrAfterStartBlock() public {
        (AuctionValidationHook freshHook,) =
            _deployHookAndModule(issuer, address(token), usdc, ListingDay.APPLICANT_CAP);
        MockAuction freshAuction = _newAuction(address(freshHook), address(token), usdc);
        uint64 startBlock = freshAuction.startBlock();
        vm.roll(startBlock);
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(IAuctionValidationHook.AuctionAlreadyStarted.selector, startBlock));
        freshHook.setAuction(address(freshAuction));
    }

    // ---------------------------------------------------------------- sender == owner

    function test_validate_revertsSenderMustBeOwner() public {
        vm.prank(bob);
        vm.expectRevert(IAuctionValidationHook.SenderMustBeOwner.selector);
        auction.submitBid(price110, 1e6, alice, "");
        assertEq(module.committed(alice), 0);
        assertEq(module.committed(bob), 0);
    }

    // ---------------------------------------------------------------- 190-point cap

    function test_capQ96_is190Points() public view {
        assertEq(hook.capQ96(), ListingPrice.CAP_PRICE_Q96);
        assertEq(hook.capQ96(), ListingPrice.pointsToQ96(190));
    }

    function test_validate_maxPriceAt190Points_passes() public {
        vm.prank(alice);
        auction.submitBid(price190, 1e6, alice, "");
        assertEq(module.committed(alice), 1e6);
    }

    function test_validate_maxPriceAt191Points_revertsBidAboveCap() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IAuctionValidationHook.BidAboveCap.selector, price191, cap));
        auction.submitBid(price191, 1e6, alice, "");
    }

    function test_validate_oneRawUnitAboveCap_revertsBidAboveCap() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IAuctionValidationHook.BidAboveCap.selector, cap + 1, cap));
        auction.submitBid(cap + 1, 1e6, alice, "");
    }

    // ---------------------------------------------------------------- per-wallet cumulative budget

    function test_module_cumulative20Usdc_passes_plusOneRawUnit_revertsCapExceeded() public {
        vm.startPrank(alice);
        auction.submitBid(price110, 12e6, alice, "");
        auction.submitBid(price190, 8e6, alice, "");
        assertEq(module.committed(alice), 20e6);
        assertEq(module.remaining(alice), 0);

        vm.expectRevert(abi.encodeWithSelector(IEligibilityModule.CapExceeded.selector, 20e6 + 1, 20e6));
        auction.submitBid(price110, 1, alice, "");
        vm.stopPrank();
        assertEq(module.committed(alice), 20e6);
    }

    function test_module_single20UsdcBid_passes_single20UsdcPlusOne_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IEligibilityModule.CapExceeded.selector, 20e6 + 1, 20e6));
        auction.submitBid(price110, 20e6 + 1, alice, "");

        vm.prank(alice);
        auction.submitBid(price110, 20e6, alice, "");
        assertEq(module.committed(alice), 20e6);
    }

    function test_module_separateWallets_haveSeparateCaps() public {
        vm.prank(alice);
        auction.submitBid(price110, 20e6, alice, "");
        vm.prank(bob);
        auction.submitBid(price110, 20e6, bob, "");
        assertEq(module.committed(alice), 20e6);
        assertEq(module.committed(bob), 20e6);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IEligibilityModule.CapExceeded.selector, 20e6 + 1, 20e6));
        auction.submitBid(price110, 1, alice, "");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IEligibilityModule.CapExceeded.selector, 20e6 + 1, 20e6));
        auction.submitBid(price110, 1, bob, "");
    }

    function test_module_revertsOnlyHook_whenCalledByAnyoneElse() public {
        assertEq(module.hook(), address(hook));
        vm.prank(alice);
        vm.expectRevert(IEligibilityModule.OnlyHook.selector);
        module.check(alice, alice, 1e6, "");

        vm.prank(address(auction));
        vm.expectRevert(IEligibilityModule.OnlyHook.selector);
        module.check(alice, alice, 1e6, "");
    }

    // ---------------------------------------------------------------- wiring

    function test_constructor_revertsIfModuleHookIsNotThis() public {
        AllowAllModule unrelated = new AllowAllModule(makeAddr("someoneElse"), ListingDay.APPLICANT_CAP);
        vm.expectPartialRevert(IAuctionValidationHook.ModuleHookMismatch.selector);
        new AuctionValidationHook(unrelated, address(token), usdc, cap);
    }

    function test_supportsInterface() public view {
        assertTrue(hook.supportsInterface(type(IValidationHook).interfaceId));
        assertTrue(hook.supportsInterface(type(IERC165).interfaceId));
        assertTrue(hook.supportsInterface(type(IAuctionValidationHook).interfaceId));
        assertFalse(hook.supportsInterface(0xffffffff));
    }

    function test_mockSME_fixedSupply_noMint() public {
        assertEq(token.totalSupply(), ListingDay.TOTAL_SUPPLY);
        assertEq(token.balanceOf(issuer), 110_000e18);
        assertEq(token.decimals(), 18);
        (bool ok,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", alice, 1));
        assertFalse(ok);
        assertEq(token.totalSupply(), 110_000e18);
    }
}
