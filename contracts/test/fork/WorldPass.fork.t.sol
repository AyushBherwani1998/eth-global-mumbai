// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AuctionValidationHook} from "../../src/AuctionValidationHook.sol";
import {MockSME} from "../../src/MockSME.sol";
import {IEligibilityModule} from "../../src/interfaces/IEligibilityModule.sol";
import {EligibilityPass, IWorldPassModule} from "../../src/interfaces/IWorldPassModule.sol";
import {ListingDay, Sepolia} from "../../src/libraries/Constants.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {WorldPassModule} from "../../src/modules/WorldPassModule.sol";
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

/// @notice A 'human' listing on Sepolia: the deployed CCA factory v2.1.0 creates an auction whose validation hook
///         delegates to WorldPassModule; bids pay real Sepolia USDC through Permit2 and carry the backend-signed
///         EligibilityPass as `hookData`. Rejections are decoded from `ValidationHookCallFailed` like the frontend.
contract WorldPassForkTest is SepoliaForkTest, HookFixture {
    address internal issuer = makeAddr("issuer");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    uint256 internal signerKey = uint256(keccak256("listing-day fork pass signer"));

    bytes32 internal constant HUMAN_A = keccak256("fork human A");
    bytes32 internal constant HUMAN_B = keccak256("fork human B");
    uint128 internal constant CAP = uint128(ListingDay.APPLICANT_CAP);

    MockSME internal token;
    AuctionValidationHook internal hook;
    WorldPassModule internal module;
    IContinuousClearingAuction internal cca;
    IERC20 internal usdc = IERC20(Sepolia.USDC);

    uint256 internal floor = ListingPrice.FLOOR_PRICE_Q96;
    uint256 internal price = ListingPrice.CAP_PRICE_Q96;

    function setUpFork() internal override {
        token = new MockSME("Acme SME", "ACME", issuer);
        (hook, module) = _deployHookAndWorldPass(issuer, address(token), Sepolia.USDC, vm.addr(signerKey));

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
        vm.startPrank(issuer);
        cca = IContinuousClearingAuction(
            address(
                IDistributorFactory(Sepolia.CCA_FACTORY)
                    .create(address(token), ListingDay.AUCTION_SUPPLY, configData, keccak256("listing-day-world-pass"))
            )
        );
        token.transfer(address(cca), ListingDay.AUCTION_SUPPLY);
        cca.onTokensReceived();
        hook.setAuction(address(cca));
        vm.stopPrank();

        vm.roll(startBlock);
        _fundAndApprove(alice, 25e6);
        _fundAndApprove(bob, 25e6);
    }

    function _fundAndApprove(address who, uint256 amount) internal {
        deal(Sepolia.USDC, who, amount);
        vm.startPrank(who);
        usdc.approve(Sepolia.PERMIT2, type(uint256).max);
        IAllowanceTransfer(Sepolia.PERMIT2)
            .approve(Sepolia.USDC, address(cca), type(uint160).max, uint48(block.timestamp + 1 days));
        vm.stopPrank();
    }

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
        return cca.submitBid(price, amount, from, floor, hookData);
    }

    /// @dev Submits a bid that must fail and returns the module's reason, decoded like the frontend does.
    function _rejected(address from, uint128 amount, bytes memory hookData) internal returns (bytes memory inner) {
        uint256 before = usdc.balanceOf(from);
        vm.prank(from);
        try cca.submitBid(price, amount, from, floor, hookData) {
            revert("bid should have been rejected");
        } catch (bytes memory revertData) {
            assertEq(HookRevertDecoder.selectorOf(revertData), ValidationHookLib.ValidationHookCallFailed.selector);
            inner = HookRevertDecoder.unwrap(revertData);
        }
        assertEq(usdc.balanceOf(from), before, "rejected bid keeps the USDC");
    }

    function _reason(bytes memory inner) internal pure returns (IWorldPassModule.Reason) {
        assertEq(HookRevertDecoder.selectorOf(inner), IWorldPassModule.NotEligible.selector, "NotEligible");
        return abi.decode(HookRevertDecoder.stripSelector(inner), (IWorldPassModule.Reason));
    }

    function test_fork_validPass_bidPullsUsdcViaPermit2() public {
        uint256 bidId = _bid(alice, 20e6, _signed(_pass(HUMAN_A, alice)));
        assertEq(cca.bids(bidId).owner, alice);
        assertEq(usdc.balanceOf(address(cca)), 20e6, "USDC pulled via Permit2");
        assertEq(usdc.balanceOf(alice), 5e6);
        assertEq(module.committed(HUMAN_A), 20e6);
        assertEq(module.walletOf(HUMAN_A), alice);
    }

    function test_fork_expiredPass_notEligibleExpired() public {
        EligibilityPass memory pass = _pass(HUMAN_A, alice);
        bytes memory hookData = _signed(pass);
        vm.warp(pass.expiry + 1);
        assertEq(uint8(_reason(_rejected(alice, 1e6, hookData))), uint8(IWorldPassModule.Reason.Expired));
    }

    function test_fork_wrongSigner_notEligibleWrongSigner() public {
        bytes memory forged = _passHookData(module, uint256(keccak256("forger")), _pass(HUMAN_A, alice));
        assertEq(uint8(_reason(_rejected(alice, 1e6, forged))), uint8(IWorldPassModule.Reason.WrongSigner));
    }

    function test_fork_passForAnotherWallet_notEligibleWrongWallet() public {
        bytes memory bobsPass = _signed(_pass(HUMAN_B, bob));
        assertEq(uint8(_reason(_rejected(alice, 1e6, bobsPass))), uint8(IWorldPassModule.Reason.WrongWallet));
    }

    function test_fork_passForAnotherAuction_notEligibleWrongAuction() public {
        EligibilityPass memory pass = _pass(HUMAN_A, alice);
        pass.auction = Sepolia.CCA_FACTORY;
        bytes memory hookData = _signed(pass);
        assertEq(uint8(_reason(_rejected(alice, 1e6, hookData))), uint8(IWorldPassModule.Reason.WrongAuction));
    }

    function test_fork_sameHumanSecondWallet_notEligibleNullifierBound() public {
        _bid(alice, 5e6, _signed(_pass(HUMAN_A, alice)));
        bytes memory secondWallet = _signed(_pass(HUMAN_A, bob));
        assertEq(
            uint8(_reason(_rejected(bob, 1e6, secondWallet))),
            uint8(IWorldPassModule.Reason.NullifierBoundToOtherWallet)
        );
    }

    /// @dev 12 + 8 = 20 USDC fills the human's cap; one more raw unit is CapExceeded, and a second wallet cannot
    ///      carry the same human's pass to get around it.
    function test_fork_perHumanCap_acrossBids_andNoSecondWallet() public {
        bytes memory hookData = _signed(_pass(HUMAN_A, alice));
        _bid(alice, 12e6, hookData);
        _bid(alice, 8e6, hookData);
        assertEq(module.committed(HUMAN_A), CAP);

        assertEq(
            _rejected(alice, 1, hookData), abi.encodeWithSelector(IEligibilityModule.CapExceeded.selector, CAP + 1, CAP)
        );
        bytes memory viaBob = _signed(_pass(HUMAN_A, bob));
        assertEq(
            uint8(_reason(_rejected(bob, 1e6, viaBob))), uint8(IWorldPassModule.Reason.NullifierBoundToOtherWallet)
        );

        _bid(bob, 20e6, _signed(_pass(HUMAN_B, bob)));
        assertEq(usdc.balanceOf(address(cca)), 40e6);
    }
}
