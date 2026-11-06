// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IEnsPermissionedResolver} from "../../src/interfaces/IEnsV2.sol";
import {EnsBase} from "./EnsBase.sol";
import {console2} from "forge-std/Script.sol";

/// @notice ENS step 4: the issuer writes the IPO records on `acme.listingday.eth` in its own resolver, from the
///         deployments file, in one `multicall`:
///
///   addr(60)                MockSME
///   listingday.auction      CCA (once launched)
///   listingday.pool         v4 PoolId (known at deploy: the hook pins the key)
///   listingday.hook         ListingHook
///   listingday.policy       eip155:<chainId>:<ListingPolicyReceiver>
///   listingday.eligibility  `human` if the listing's module is the WorldPassModule (ELIGIBILITY=human), else `open`
///   description, url, avatar  ENS_DESCRIPTION / ENS_URL / ENS_AVATAR (defaults below)
///
/// `listingday.status` is not written here: only the receiver writes it (EnsStatusRole, then every CRE report).
///
///   [ISSUER_KEY=0x…] forge script script/ens/EnsRecords.s.sol --rpc-url $RPC --broadcast
///
/// Idempotent: only records whose current value differs are sent. Re-run after `make launch` to add the auction.
contract EnsRecords is EnsBase {
    string internal constant DEFAULT_URL = "https://github.com/AyushBherwani1998/eth-global-mumbai";

    struct Record {
        string key;
        string value;
    }

    function run() external {
        _ensStep("EnsRecords");
        Deployment memory d = _load();
        IEnsPermissionedResolver resolver = _issuerResolver();
        bytes memory name = _tickerDns();
        require(
            _userRegistry().getResolver(_tickerLabel()) == address(resolver) && address(resolver).code.length != 0,
            "ticker not registered with the issuer's resolver: run EnsTicker first"
        );

        Record[] memory want = _records(d);
        bytes[] memory calls = new bytes[](want.length + 1);
        uint256 n;
        if (_resolveAddr(resolver, name) != address(d.token)) {
            calls[n++] = abi.encodeCall(
                IEnsPermissionedResolver.setAddress, (name, COIN_TYPE_ETH, abi.encodePacked(address(d.token)))
            );
            console2.log("  set addr(60) =", address(d.token));
        }
        for (uint256 i; i < want.length; i++) {
            if (bytes(want[i].value).length == 0) continue;
            if (keccak256(bytes(_resolveText(resolver, name, want[i].key))) == keccak256(bytes(want[i].value))) {
                continue;
            }
            calls[n++] = abi.encodeCall(IEnsPermissionedResolver.setText, (name, want[i].key, want[i].value));
            console2.log(string.concat("  set ", want[i].key, " = ", _short(want[i].value)));
        }
        assembly ("memory-safe") {
            mstore(calls, n)
        }

        if (n == 0) {
            console2.log("records already up to date");
        } else {
            vm.startBroadcast(_issuerKey());
            _tx(string.concat("PermissionedResolver.multicall(", vm.toString(n), " setters) (issuer)"));
            resolver.multicall(calls);
            vm.stopBroadcast();
        }
        _saveEns();
    }

    function _records(Deployment memory d) internal view returns (Record[] memory r) {
        string memory j = _json();
        r = new Record[](8);
        r[0] = Record(KEY_AUCTION, address(d.auction).code.length != 0 ? vm.toString(address(d.auction)) : "");
        r[1] = Record(
            KEY_POOL, vm.keyExistsJson(j, ".pool.poolId") ? vm.toString(vm.parseJsonBytes32(j, ".pool.poolId")) : ""
        );
        r[2] = Record(KEY_HOOK, vm.toString(address(d.hook)));
        r[3] = Record(
            KEY_POLICY, string.concat("eip155:", vm.toString(block.chainid), ":", vm.toString(address(d.receiver)))
        );
        r[4] = Record(KEY_ELIGIBILITY, _eligibilityRecord(d));
        r[5] = Record(KEY_DESCRIPTION, vm.envOr("ENS_DESCRIPTION", _defaultDescription(d)));
        r[6] = Record(KEY_URL, vm.envOr("ENS_URL", string(DEFAULT_URL)));
        r[7] = Record(KEY_AVATAR, vm.envOr("ENS_AVATAR", _defaultAvatar(d)));
    }

    /// @dev Follows the deployed module, so ENS never advertises an eligibility the hook does not enforce.
    ///      ENS_ELIGIBILITY, if set, must agree.
    function _eligibilityRecord(Deployment memory d) internal view returns (string memory mode) {
        mode = d.human ? "human" : "open";
        string memory asked = vm.envOr("ENS_ELIGIBILITY", string(""));
        require(
            bytes(asked).length == 0 || keccak256(bytes(asked)) == keccak256(bytes(mode)),
            string.concat("ENS_ELIGIBILITY=", asked, " but the listing's module is ", mode, ": unset it")
        );
    }

    function _defaultDescription(Deployment memory d) internal view returns (string memory) {
        return string.concat(
            d.token.name(),
            " (",
            d.token.symbol(),
            "): Listing Day IPO. Continuous clearing auction in Sepolia USDC, then a Uniswap v4 pool with listing-day",
            " price bands and CRE-driven halts."
        );
    }

    /// @dev ENSIP-12 data URI, so the avatar needs no hosting.
    function _defaultAvatar(Deployment memory d) internal view returns (string memory) {
        string memory svg = string.concat(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">",
            "<rect width=\"64\" height=\"64\" rx=\"14\" fill=\"#0f766e\"/>",
            "<text x=\"32\" y=\"39\" font-family=\"sans-serif\" font-size=\"16\" font-weight=\"700\" fill=\"#fff\"",
            " text-anchor=\"middle\">",
            d.token.symbol(),
            "</text></svg>"
        );
        return string.concat("data:image/svg+xml;base64,", vm.toBase64(bytes(svg)));
    }

    function _short(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        if (b.length <= 72) return s;
        bytes memory head = new bytes(69);
        for (uint256 i; i < 69; i++) {
            head[i] = b[i];
        }
        return string.concat(string(head), "...");
    }
}
