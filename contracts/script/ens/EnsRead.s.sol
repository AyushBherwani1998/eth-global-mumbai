// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IEnsAddrProfile,
    IEnsPermissionedRegistry,
    IEnsTextProfile,
    IEnsUniversalResolver
} from "../../src/interfaces/IEnsV2.sol";
import {SepoliaEns} from "../../src/libraries/Constants.sol";
import {EnsNames} from "../../src/libraries/EnsV2.sol";
import {EnsBase} from "./EnsBase.sol";
import {console2} from "forge-std/Script.sol";

/// @notice ENS step 6 (read-only): resolve a ticker exactly the way the frontend does. Every record goes through
///         the Universal Resolver proxy `0xeEeE…EeEe` with `resolveWithGateways(dnsName, data,
///         ["x-batch-gateway:true"])`, the call viem's `getEnsAddress` / `getEnsText` make; all records are onchain,
///         so no CCIP-Read gateway is involved (`ccipRead: false` is safe). The ticker's registry facts come from
///         `ETHRegistry.getSubregistry("listingday")`: nothing but the parent name is hard-coded.
///
///   [ENS_TICKER=acme] forge script script/ens/EnsRead.s.sol --rpc-url $RPC        (make ens-read)
///
/// With a deployments file, also compares the records with it (`ENS_READ_STRICT=true` makes a mismatch fatal).
contract EnsRead is EnsBase {
    IEnsUniversalResolver internal constant UR = IEnsUniversalResolver(SepoliaEns.UNIVERSAL_RESOLVER);

    struct Resolved {
        address resolver;
        address addr;
        string[9] keys;
        string[9] texts;
    }

    struct Ticker {
        IEnsPermissionedRegistry registry;
        address owner;
        uint256 tokenId;
        uint64 expiry;
        uint256 ownerRoles;
    }

    function run() external {
        string memory name = _tickerName();
        console2.log("=== EnsRead", name, "via Universal Resolver", SepoliaEns.UNIVERSAL_RESOLVER);
        Ticker memory t = ticker(_parentLabel(), _tickerLabel());
        console2.log("registry (ETHRegistry.getSubregistry)", address(t.registry));
        console2.log("owner (findOwner)", t.owner);
        console2.log("tokenId (findTokenId)", t.tokenId);
        console2.log("expiry", t.expiry);

        Resolved memory r = resolve(name);
        console2.log("resolver", r.resolver);
        console2.log("addr(60)", r.addr);
        for (uint256 i; i < r.keys.length; i++) {
            console2.log(string.concat(r.keys[i], ": ", r.texts[i]));
        }
        _compare(r);
    }

    /// @notice Every Listing Day record of `name`, through the Universal Resolver.
    function resolve(string memory name) public view returns (Resolved memory r) {
        bytes memory dns = EnsNames.dnsEncode(name);
        bytes32 node = EnsNames.namehash(dns);
        bytes memory result;
        (result, r.resolver) = UR.resolveWithGateways(dns, abi.encodeCall(IEnsAddrProfile.addr, (node)), _gateways());
        r.addr = abi.decode(result, (address));
        r.keys = _recordKeys();
        for (uint256 i; i < r.keys.length; i++) {
            r.texts[i] = text(name, r.keys[i]);
        }
    }

    /// @notice `getEnsText({ name, key })`.
    function text(string memory name, string memory key) public view returns (string memory) {
        bytes memory dns = EnsNames.dnsEncode(name);
        (bytes memory result,) = UR.resolveWithGateways(
            dns, abi.encodeCall(IEnsTextProfile.text, (EnsNames.namehash(dns), key)), _gateways()
        );
        return abi.decode(result, (string));
    }

    /// @notice `getEnsAddress({ name })`.
    function addr(string memory name) public view returns (address) {
        bytes memory dns = EnsNames.dnsEncode(name);
        (bytes memory result,) =
            UR.resolveWithGateways(dns, abi.encodeCall(IEnsAddrProfile.addr, (EnsNames.namehash(dns))), _gateways());
        return abi.decode(result, (address));
    }

    /// @notice Registry-side facts the IPO list needs. Token ids regenerate on role changes: always look them up
    ///         by label (`findTokenId`), never cache them.
    function ticker(string memory parentLabel, string memory label) public view returns (Ticker memory t) {
        t.registry = IEnsPermissionedRegistry(address(ETH_REGISTRY.getSubregistry(parentLabel)));
        if (address(t.registry) == address(0)) return t;
        t.owner = t.registry.findOwner(label);
        t.tokenId = t.registry.findTokenId(label);
        t.expiry = t.registry.findExpiry(label);
        if (t.owner != address(0)) t.ownerRoles = t.registry.roles(t.tokenId, t.owner);
    }

    function _gateways() internal pure returns (string[] memory g) {
        g = new string[](1);
        g[0] = LOCAL_BATCH_GATEWAY;
    }

    function _compare(Resolved memory r) internal view {
        if (!vm.exists(_file()) || !vm.keyExistsJson(_json(), ".contracts.mockSME")) return;
        string memory j = _json();
        bool strict = vm.envOr("ENS_READ_STRICT", false);
        bool ok = _check("addr(60) == contracts.mockSME", r.addr == vm.parseJsonAddress(j, ".contracts.mockSME"));
        ok = _check(
            "listingday.hook == contracts.listingHook",
            keccak256(bytes(r.texts[2]))
                == keccak256(bytes(vm.toString(vm.parseJsonAddress(j, ".contracts.listingHook"))))
        ) && ok;
        ok = _check(
            "listingday.pool == pool.poolId",
            keccak256(bytes(r.texts[1])) == keccak256(bytes(vm.toString(vm.parseJsonBytes32(j, ".pool.poolId"))))
        ) && ok;
        string memory policy = string.concat(
            "eip155:",
            vm.toString(block.chainid),
            ":",
            vm.toString(vm.parseJsonAddress(j, ".contracts.listingPolicyReceiver"))
        );
        ok = _check(
            "listingday.policy == eip155:<chainId>:<receiver>", keccak256(bytes(r.texts[3])) == keccak256(bytes(policy))
        ) && ok;
        address auction = _jsonAddress(j, ".auction.address");
        if (auction != address(0)) {
            ok = _check(
                "listingday.auction == auction.address",
                keccak256(bytes(r.texts[0])) == keccak256(bytes(vm.toString(auction)))
            ) && ok;
        }
        console2.log(ok ? "records match the deployments file" : "records DIFFER from the deployments file");
        require(ok || !strict, "ENS records differ from the deployments file (ENS_READ_STRICT)");
    }

    function _check(string memory what, bool ok) internal pure returns (bool) {
        console2.log(string.concat(ok ? "  ok   " : "  FAIL ", what));
        return ok;
    }
}
