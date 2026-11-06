// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AuctionValidationHook} from "../../src/AuctionValidationHook.sol";
import {MockSME} from "../../src/MockSME.sol";
import {EligibilityPass} from "../../src/interfaces/IWorldPassModule.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {WorldPassModule} from "../../src/modules/WorldPassModule.sol";
import {MockAuction} from "../utils/MockAuction.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Test} from "forge-std/Test.sol";

/// @notice Cross-language EIP-712 parity. `services/verify/fixtures/pass-vectors.json` holds passes signed by the
///         verify backend's TypeScript signer (`npm test` there pins the file); here each digest must equal
///         `WorldPassModule.hashPass` for the same domain (chain id + module address), the signature must recover
///         to the fixture signer, `hookData` must equal `abi.encode(pass, signature)`, and a bid carrying exactly
///         that `hookData` must pass the module.
contract WorldPassFixtureTest is Test {
    string internal constant FIXTURE = "../services/verify/fixtures/pass-vectors.json";
    uint256 internal constant CASES = 2;

    string internal json;
    address internal fixtureSigner;

    function setUp() public {
        json = vm.readFile(FIXTURE);
        fixtureSigner = vm.parseJsonAddress(json, ".signer");
    }

    function _key(uint256 i, string memory field) internal pure returns (string memory) {
        return string.concat(".cases[", vm.toString(i), "].", field);
    }

    function _pass(uint256 i) internal view returns (EligibilityPass memory p) {
        p.nullifier = vm.parseJsonBytes32(json, _key(i, "pass.nullifier"));
        p.wallet = vm.parseJsonAddress(json, _key(i, "pass.wallet"));
        p.auction = vm.parseJsonAddress(json, _key(i, "pass.auction"));
        p.cap = uint128(vm.parseJsonUint(json, _key(i, "pass.cap")));
        p.expiry = uint64(vm.parseJsonUint(json, _key(i, "pass.expiry")));
    }

    /// @dev Deploys the module, hook and a mock auction at the fixture's addresses on the fixture's chain id, so the
    ///      EIP-712 domain is the one the TypeScript side signed for.
    function _wire(uint256 i) internal returns (WorldPassModule module) {
        vm.chainId(vm.parseJsonUint(json, _key(i, "chainId")));
        address moduleAt = vm.parseJsonAddress(json, _key(i, "module"));
        address hookAt = vm.parseJsonAddress(json, _key(i, "hook"));
        EligibilityPass memory p = _pass(i);

        deployCodeTo("WorldPassModule.sol:WorldPassModule", abi.encode(hookAt, fixtureSigner), moduleAt);
        module = WorldPassModule(moduleAt);
        MockSME token = new MockSME("Acme SME", "ACME", address(this));
        deployCodeTo(
            "AuctionValidationHook.sol:AuctionValidationHook",
            abi.encode(moduleAt, address(token), address(0), ListingPrice.CAP_PRICE_Q96),
            hookAt
        );
        deployCodeTo(
            "MockAuction.sol:MockAuction",
            abi.encode(hookAt, address(token), address(0), uint64(block.number + 1)),
            p.auction
        );
        AuctionValidationHook(hookAt).setAuction(p.auction);
    }

    function test_fixture_hasAllCases() public view {
        assertEq(vm.parseJsonString(json, _key(CASES - 1, "name")), "max-values-anvil");
        assertFalse(vm.keyExistsJson(json, _key(CASES, "name")), "update CASES when adding vectors");
    }

    function test_fixture_tsDigestEqualsSolidityHashPass() public {
        for (uint256 i; i < CASES; i++) {
            WorldPassModule module = _wire(i);
            EligibilityPass memory p = _pass(i);
            bytes32 digest = vm.parseJsonBytes32(json, _key(i, "digest"));
            assertEq(module.hashPass(p), digest, "EIP-712 digest");

            bytes memory signature = vm.parseJsonBytes(json, _key(i, "signature"));
            assertEq(ECDSA.recover(digest, signature), fixtureSigner, "signature recovers to the pass signer");
            assertEq(abi.encode(p, signature), vm.parseJsonBytes(json, _key(i, "hookData")), "hookData encoding");
        }
    }

    function test_fixture_tsHookDataPassesTheModule() public {
        for (uint256 i; i < CASES; i++) {
            WorldPassModule module = _wire(i);
            EligibilityPass memory p = _pass(i);
            vm.roll(block.number + 1);
            vm.warp(p.expiry);
            vm.prank(p.wallet);
            MockAuction(p.auction)
                .submitBid(ListingPrice.CAP_PRICE_Q96, 1, p.wallet, vm.parseJsonBytes(json, _key(i, "hookData")));
            assertEq(module.walletOf(p.nullifier), p.wallet, "nullifier bound");
            assertEq(module.committed(p.nullifier), 1, "budget committed");
        }
    }
}
