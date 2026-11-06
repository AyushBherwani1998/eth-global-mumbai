// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AuctionValidationHook} from "../../src/AuctionValidationHook.sol";
import {MockSME} from "../../src/MockSME.sol";
import {IAuctionValidationHook} from "../../src/interfaces/IAuctionValidationHook.sol";
import {IEligibilityModule} from "../../src/interfaces/IEligibilityModule.sol";
import {EligibilityPass, IWorldPassModule} from "../../src/interfaces/IWorldPassModule.sol";
import {ListingDay} from "../../src/libraries/Constants.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {WorldPassModule} from "../../src/modules/WorldPassModule.sol";
import {HookFixture} from "../utils/HookFixture.sol";
import {HookRevertDecoder} from "../utils/HookRevertDecoder.sol";
import {ContinuousClearingAuction} from "continuous-clearing-auction/src/ContinuousClearingAuction.sol";
import {AuctionParameters} from "continuous-clearing-auction/src/interfaces/IContinuousClearingAuction.sol";
import {ValidationHookLib} from "continuous-clearing-auction/src/libraries/ValidationHookLib.sol";

/// @notice WorldPassModule behind AuctionValidationHook, called by real CCA v2.1.0 code (compiled from the pinned
///         source, native ETH as the currency). Every rejection is asserted as the CCA's
///         `ValidationHookCallFailed(NotEligible(reason))` the frontend decodes. USDC + Permit2: the fork test.
contract WorldPassModuleTest is HookFixture {
    address internal issuer = makeAddr("issuer");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    uint256 internal signerKey = uint256(keccak256("listing-day pass signer"));
    address internal passSigner = vm.addr(signerKey);

    bytes32 internal constant HUMAN_A = keccak256("human A");
    bytes32 internal constant HUMAN_B = keccak256("human B");
    uint128 internal constant CAP = uint128(ListingDay.APPLICANT_CAP);

    MockSME internal token;
    AuctionValidationHook internal hook;
    WorldPassModule internal module;
    ContinuousClearingAuction internal cca;

    uint256 internal floor = ListingPrice.FLOOR_PRICE_Q96;
    uint256 internal price = ListingPrice.CAP_PRICE_Q96;

    function setUp() public {
        vm.warp(1_762_400_000);
        token = new MockSME("Acme SME", "ACME", issuer);
        (hook, module) = _deployHookAndWorldPass(issuer, address(token), address(0), passSigner);

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

    // ---------------------------------------------------------------- helpers

    function _pass(bytes32 nullifier, address wallet) internal view returns (EligibilityPass memory) {
        return EligibilityPass({
            nullifier: nullifier,
            wallet: wallet,
            auction: address(cca),
            cap: CAP,
            expiry: uint64(block.timestamp + 10 minutes)
        });
    }

    function _signed(EligibilityPass memory pass) internal view returns (bytes memory) {
        return _passHookData(module, signerKey, pass);
    }

    function _bid(address from, uint128 amount, bytes memory hookData) internal returns (uint256) {
        vm.prank(from);
        return cca.submitBid{value: amount}(price, amount, from, floor, hookData);
    }

    function _notEligible(IWorldPassModule.Reason reason) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(
            ValidationHookLib.ValidationHookCallFailed.selector,
            abi.encodeWithSelector(IWorldPassModule.NotEligible.selector, reason)
        );
    }

    function _capExceeded(uint256 newTotal, uint256 cap) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(
            ValidationHookLib.ValidationHookCallFailed.selector,
            abi.encodeWithSelector(IEligibilityModule.CapExceeded.selector, newTotal, cap)
        );
    }

    // ---------------------------------------------------------------- happy path

    function test_validPass_bidSucceeds_bindsNullifierToWallet() public {
        bytes memory hookData = _signed(_pass(HUMAN_A, alice));
        vm.expectEmit(address(module));
        emit IWorldPassModule.NullifierBound(HUMAN_A, alice);
        vm.expectEmit(address(module));
        emit IWorldPassModule.BudgetCommitted(HUMAN_A, alice, 12e6, 12e6);
        _bid(alice, 12e6, hookData);

        assertEq(module.walletOf(HUMAN_A), alice);
        assertEq(module.nullifierOf(alice), HUMAN_A);
        assertEq(module.committed(HUMAN_A), 12e6);
        assertEq(address(cca).balance, 12e6);
        assertEq(cca.bids(0).owner, alice);
    }

    function test_samePass_reusedAcrossBids_capIsCumulative() public {
        bytes memory hookData = _signed(_pass(HUMAN_A, alice));
        _bid(alice, 8e6, hookData);
        _bid(alice, 12e6, hookData);
        assertEq(module.committed(HUMAN_A), CAP);

        vm.expectRevert(_capExceeded(CAP + 1, CAP));
        _bid(alice, 1, hookData);
    }

    function test_cap_survivesAFreshPassForTheSameHuman() public {
        _bid(alice, 15e6, _signed(_pass(HUMAN_A, alice)));
        vm.warp(block.timestamp + 1 hours);
        bytes memory fresh = _signed(_pass(HUMAN_A, alice));
        vm.expectRevert(_capExceeded(15e6 + 6e6, CAP));
        _bid(alice, 6e6, fresh);
        _bid(alice, 5e6, fresh);
        assertEq(module.committed(HUMAN_A), CAP);
    }

    function test_passValidUpToAndIncludingExpiry() public {
        EligibilityPass memory pass = _pass(HUMAN_A, alice);
        bytes memory hookData = _signed(pass);
        vm.warp(pass.expiry);
        _bid(alice, 1e6, hookData);
    }

    function testFuzz_cap_acceptsExactlyUpToCap(uint128 first, uint128 second) public {
        first = uint128(bound(first, 1, CAP));
        second = uint128(bound(second, 1, CAP));
        bytes memory hookData = _signed(_pass(HUMAN_A, alice));
        _bid(alice, first, hookData);
        if (uint256(first) + second > CAP) {
            vm.expectRevert(_capExceeded(uint256(first) + second, CAP));
            _bid(alice, second, hookData);
            assertEq(module.committed(HUMAN_A), first);
        } else {
            _bid(alice, second, hookData);
            assertEq(module.committed(HUMAN_A), uint256(first) + second);
        }
    }

    // ---------------------------------------------------------------- NotEligible paths

    function test_expiredPass_revertsNotEligibleExpired() public {
        EligibilityPass memory pass = _pass(HUMAN_A, alice);
        bytes memory hookData = _signed(pass);
        vm.warp(pass.expiry + 1);
        vm.expectRevert(_notEligible(IWorldPassModule.Reason.Expired));
        _bid(alice, 1e6, hookData);
    }

    function test_wrongSigner_revertsNotEligibleWrongSigner() public {
        bytes memory hookData = _passHookData(module, uint256(keccak256("attacker")), _pass(HUMAN_A, alice));
        vm.expectRevert(_notEligible(IWorldPassModule.Reason.WrongSigner));
        _bid(alice, 1e6, hookData);
    }

    function test_tamperedCap_revertsNotEligibleWrongSigner() public {
        EligibilityPass memory pass = _pass(HUMAN_A, alice);
        (, bytes memory signature) = abi.decode(_signed(pass), (EligibilityPass, bytes));
        pass.cap = 1000e6;
        vm.expectRevert(_notEligible(IWorldPassModule.Reason.WrongSigner));
        _bid(alice, 21e6, abi.encode(pass, signature));
    }

    function test_malformedOrMalleableSignature_revertsNotEligibleWrongSigner() public {
        EligibilityPass memory pass = _pass(HUMAN_A, alice);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, module.hashPass(pass));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory highS = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(_notEligible(IWorldPassModule.Reason.WrongSigner));
        _bid(alice, 1e6, abi.encode(pass, highS));

        vm.expectRevert(_notEligible(IWorldPassModule.Reason.WrongSigner));
        _bid(alice, 1e6, abi.encode(pass, abi.encodePacked(r, s)));
    }

    function test_passForAnotherWallet_revertsNotEligibleWrongWallet() public {
        bytes memory bobsPass = _signed(_pass(HUMAN_B, bob));
        vm.expectRevert(_notEligible(IWorldPassModule.Reason.WrongWallet));
        _bid(alice, 1e6, bobsPass);
    }

    function test_passForAnotherWallet_bidOnItsBehalf_revertsSenderMustBeOwner() public {
        bytes memory bobsPass = _signed(_pass(HUMAN_B, bob));
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                ValidationHookLib.ValidationHookCallFailed.selector,
                abi.encodeWithSelector(IAuctionValidationHook.SenderMustBeOwner.selector)
            )
        );
        cca.submitBid{value: 1e6}(price, 1e6, bob, floor, bobsPass);
    }

    function test_passForAnotherAuction_revertsNotEligibleWrongAuction() public {
        EligibilityPass memory pass = _pass(HUMAN_A, alice);
        pass.auction = makeAddr("another auction");
        bytes memory hookData = _signed(pass);
        vm.expectRevert(_notEligible(IWorldPassModule.Reason.WrongAuction));
        _bid(alice, 1e6, hookData);
    }

    function test_sameHumanSecondWallet_revertsNotEligibleNullifierBound() public {
        _bid(alice, 20e6, _signed(_pass(HUMAN_A, alice)));
        // A validly signed pass for the same nullifier but another wallet (the backend refuses to issue it with
        // HTTP 409; this is the onchain backstop if one were presented anyway).
        bytes memory secondWallet = _signed(_pass(HUMAN_A, bob));
        vm.expectRevert(_notEligible(IWorldPassModule.Reason.NullifierBoundToOtherWallet));
        _bid(bob, 1e6, secondWallet);
        assertEq(module.walletOf(HUMAN_A), alice);
        assertEq(module.nullifierOf(bob), bytes32(0));
    }

    function test_walletWithAnotherHumansPass_revertsNotEligibleWalletBound() public {
        _bid(alice, 1e6, _signed(_pass(HUMAN_A, alice)));
        bytes memory otherHuman = _signed(_pass(HUMAN_B, alice));
        vm.expectRevert(_notEligible(IWorldPassModule.Reason.WalletBoundToOtherNullifier));
        _bid(alice, 1e6, otherHuman);
    }

    function test_missingPass_revertsNotEligibleMissingPass() public {
        vm.expectRevert(_notEligible(IWorldPassModule.Reason.MissingPass));
        _bid(alice, 1e6, "");
    }

    function test_shortHookDataOrZeroNullifier_revertsNotEligibleInvalidPass() public {
        vm.expectRevert(_notEligible(IWorldPassModule.Reason.InvalidPass));
        _bid(alice, 1e6, abi.encode(uint256(1), uint256(2)));

        bytes memory zeroNullifier = _signed(_pass(bytes32(0), alice));
        vm.expectRevert(_notEligible(IWorldPassModule.Reason.InvalidPass));
        _bid(alice, 1e6, zeroNullifier);
    }

    function test_reasonIsDecodableFromTheCcaRevert() public {
        vm.prank(alice);
        try cca.submitBid{value: 1e6}(price, 1e6, alice, floor, "") {
            fail();
        } catch (bytes memory revertData) {
            assertEq(HookRevertDecoder.selectorOf(revertData), ValidationHookLib.ValidationHookCallFailed.selector);
            bytes memory inner = HookRevertDecoder.unwrap(revertData);
            assertEq(HookRevertDecoder.selectorOf(inner), IWorldPassModule.NotEligible.selector);
            uint8 reason = abi.decode(HookRevertDecoder.stripSelector(inner), (uint8));
            assertEq(reason, uint8(IWorldPassModule.Reason.MissingPass));
        }
        assertEq(IWorldPassModule.NotEligible.selector, bytes4(keccak256("NotEligible(uint8)")));
    }

    // ---------------------------------------------------------------- wiring

    function test_onlyHook_canCallCheck() public {
        bytes memory hookData = _signed(_pass(HUMAN_A, alice));
        vm.prank(alice);
        vm.expectRevert(IEligibilityModule.OnlyHook.selector);
        module.check(alice, alice, 1e6, hookData);
    }

    function test_constructor_rejectsZeroAddresses() public {
        vm.expectRevert(IWorldPassModule.ZeroAddress.selector);
        new WorldPassModule(address(0), passSigner);
        vm.expectRevert(IWorldPassModule.ZeroAddress.selector);
        new WorldPassModule(address(hook), address(0));
    }

    function test_eip712_typehashAndDomain() public view {
        assertEq(
            module.PASS_TYPEHASH(),
            keccak256("EligibilityPass(bytes32 nullifier,address wallet,address auction,uint128 cap,uint64 expiry)")
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ListingDay WorldPass"),
                keccak256("1"),
                block.chainid,
                address(module)
            )
        );
        assertEq(module.DOMAIN_SEPARATOR(), domain);
        assertEq(module.signer(), passSigner);
        assertEq(module.hook(), address(hook));
        assertEq(address(hook.module()), address(module));
    }
}
