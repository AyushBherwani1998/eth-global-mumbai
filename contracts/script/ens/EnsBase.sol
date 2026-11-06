// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ListingPolicyReceiver} from "../../src/ListingPolicyReceiver.sol";
import {
    IEnsAddrProfile,
    IEnsEthRegistrar,
    IEnsPermissionedRegistry,
    IEnsPermissionedResolver,
    IEnsRegistry,
    IEnsTextProfile,
    IEnsUserRegistry,
    IEnsVerifiableFactory
} from "../../src/interfaces/IEnsV2.sol";
import {SepoliaEns} from "../../src/libraries/Constants.sol";
import {EnsNames, EnsRoles} from "../../src/libraries/EnsV2.sol";
import {DemoBase} from "../demo/DemoBase.sol";
import {console2} from "forge-std/Script.sol";

/// @title EnsBase
/// @notice Shared config for the ENSv2 ticker namespace steps (plan.md §7): `listingday.eth` -> our UserRegistry
///         -> `acme` owned by the issuer, with the issuer's own PermissionedResolver.
/// @dev Every address is deterministic (the .eth name, `VerifiableFactory.predictProxyAddress(deployer, salt)` for
///      the registry and the resolver), so each step finds earlier work onchain and the `ens` section of the
///      deployments file is always rebuilt from chain state, never trusted.
///
/// Keys: `ENS_OWNER_KEY` (us: owns `listingday.eth` and the UserRegistry root roles; default `PRIVATE_KEY`),
/// `ISSUER_KEY` (owns the ticker and its resolver; default `PRIVATE_KEY`), `PRIVATE_KEY` (owner of the
/// ListingPolicyReceiver, for `setStatusMirror`).
abstract contract EnsBase is DemoBase {
    string internal constant ETH = "eth";
    string internal constant DEFAULT_PARENT_LABEL = "listingday";
    string internal constant DEFAULT_TICKER = "acme";
    uint64 internal constant DEFAULT_DURATION = 365 days;
    uint256 internal constant COIN_TYPE_ETH = 60;
    /// @dev viem's `localBatchGatewayUrl`: the Universal Resolver batches the call itself, no gateway server.
    string internal constant LOCAL_BATCH_GATEWAY = "x-batch-gateway:true";

    string internal constant KEY_AUCTION = "listingday.auction";
    string internal constant KEY_POOL = "listingday.pool";
    string internal constant KEY_HOOK = "listingday.hook";
    string internal constant KEY_POLICY = "listingday.policy";
    string internal constant KEY_STATUS = "listingday.status";
    string internal constant KEY_ELIGIBILITY = "listingday.eligibility";
    string internal constant KEY_DESCRIPTION = "description";
    string internal constant KEY_URL = "url";
    string internal constant KEY_AVATAR = "avatar";

    IEnsEthRegistrar internal constant REGISTRAR = IEnsEthRegistrar(SepoliaEns.ETH_REGISTRAR);
    IEnsPermissionedRegistry internal constant ETH_REGISTRY = IEnsPermissionedRegistry(SepoliaEns.ETH_REGISTRY);
    IEnsVerifiableFactory internal constant FACTORY = IEnsVerifiableFactory(SepoliaEns.VERIFIABLE_FACTORY);

    // ---------------------------------------------------------------- env

    function _ensOwnerKey() internal view returns (uint256) {
        return vm.envOr("ENS_OWNER_KEY", _deployerKey());
    }

    function _issuerKey() internal view returns (uint256) {
        return vm.envOr("ISSUER_KEY", _deployerKey());
    }

    function _parentLabel() internal view returns (string memory) {
        return vm.envOr("ENS_PARENT_LABEL", string(DEFAULT_PARENT_LABEL));
    }

    function _tickerLabel() internal view returns (string memory) {
        return vm.envOr("ENS_TICKER", string(DEFAULT_TICKER));
    }

    function _duration() internal view returns (uint64) {
        return uint64(vm.envOr("ENS_DURATION", uint256(DEFAULT_DURATION)));
    }

    /// @dev Deterministic so the reveal run recomputes the commitment without storing the secret anywhere. Only a
    ///      hash of the key; it becomes public in the `register` calldata anyway.
    function _secret() internal view returns (bytes32) {
        return
            vm.envOr(
                "ENS_SECRET", keccak256(abi.encode("listing-day ens commit secret", _ensOwnerKey(), _parentLabel()))
            );
    }

    // ---------------------------------------------------------------- names

    function _parentName() internal view returns (string memory) {
        return string.concat(_parentLabel(), ".", ETH);
    }

    function _tickerName() internal view returns (string memory) {
        return string.concat(_tickerLabel(), ".", _parentName());
    }

    function _tickerDns() internal view returns (bytes memory) {
        return EnsNames.dnsEncode(_tickerName());
    }

    function _commitment() internal view returns (bytes32) {
        return REGISTRAR.makeCommitment(
            _parentLabel(),
            vm.addr(_ensOwnerKey()),
            _secret(),
            IEnsRegistry(address(0)),
            address(0),
            _duration(),
            bytes32(0)
        );
    }

    // ---------------------------------------------------------------- deterministic contracts

    function _registrySalt() internal view returns (uint256) {
        return uint256(keccak256(abi.encode("listing-day ens", "UserRegistry", _parentName())));
    }

    /// @dev One resolver per ticker: a scoped setter role covers every name in a resolver, so this keeps the
    ///      receiver's `listingday.status` role to this ticker alone.
    function _resolverSalt() internal view returns (uint256) {
        return uint256(keccak256(abi.encode("listing-day ens", "PermissionedResolver", _tickerName())));
    }

    function _userRegistry() internal view returns (IEnsUserRegistry) {
        return IEnsUserRegistry(FACTORY.predictProxyAddress(vm.addr(_ensOwnerKey()), _registrySalt()));
    }

    function _issuerResolver() internal view returns (IEnsPermissionedResolver) {
        return IEnsPermissionedResolver(FACTORY.predictProxyAddress(vm.addr(_issuerKey()), _resolverSalt()));
    }

    // ---------------------------------------------------------------- reads

    function _resolveText(IEnsPermissionedResolver resolver, bytes memory dnsName, string memory key)
        internal
        view
        returns (string memory)
    {
        if (address(resolver).code.length == 0) return "";
        bytes memory data = abi.encodeCall(IEnsTextProfile.text, (EnsNames.namehash(dnsName), key));
        return abi.decode(resolver.resolve(dnsName, data), (string));
    }

    function _resolveAddr(IEnsPermissionedResolver resolver, bytes memory dnsName) internal view returns (address) {
        if (address(resolver).code.length == 0) return address(0);
        bytes memory data = abi.encodeCall(IEnsAddrProfile.addr, (EnsNames.namehash(dnsName)));
        return abi.decode(resolver.resolve(dnsName, data), (address));
    }

    function _receiver() internal view returns (ListingPolicyReceiver) {
        if (!vm.exists(_file())) return ListingPolicyReceiver(address(0));
        return ListingPolicyReceiver(_jsonAddress(_json(), ".contracts.listingPolicyReceiver"));
    }

    function _ensStep(string memory name) internal view {
        _step(name);
        console2.log("parent", _parentName(), "ticker", _tickerName());
    }

    // ---------------------------------------------------------------- the `ens` section

    /// @notice Rewrites `.ens` in the deployments file from chain state (creates a minimal file if none exists, so
    ///         the name can be registered before the listing is deployed).
    function _saveEns() internal {
        string memory path = _file();
        if (!vm.exists(path)) {
            _ensureParentDir(path);
            string memory root = "ens.root";
            vm.serializeUint(root, "chainId", block.chainid);
            root = vm.serializeString(root, "ens", "{}");
            vm.writeJson(root, path);
        } else if (!vm.keyExistsJson(vm.readFile(path), ".ens")) {
            vm.writeJson("{}", path, ".ens");
        }
        string memory o = "ens";
        vm.serializeString(o, "contractsV2Tag", "v2-mainnet-deployment-1");
        vm.serializeString(o, "external", _externalEnsJson());
        vm.serializeString(o, "parent", _parentJson());
        vm.serializeString(o, "userRegistry", _registryJson());
        vm.serializeString(o, "ticker", _tickerJson());
        vm.serializeString(o, "resolver", _resolverJson());
        vm.serializeString(o, "records", _recordsJson());
        o = vm.serializeString(o, "statusRole", _statusRoleJson());
        _writeSection("ens", o);
        console2.log("wrote .ens to", path);
    }

    function _externalEnsJson() internal returns (string memory o) {
        o = "ens.external";
        vm.serializeAddress(o, "universalResolver", SepoliaEns.UNIVERSAL_RESOLVER);
        vm.serializeAddress(o, "universalResolverV2", SepoliaEns.UNIVERSAL_RESOLVER_V2);
        vm.serializeAddress(o, "rootRegistry", SepoliaEns.ROOT_REGISTRY);
        vm.serializeAddress(o, "ethRegistry", SepoliaEns.ETH_REGISTRY);
        vm.serializeAddress(o, "ethRegistrar", SepoliaEns.ETH_REGISTRAR);
        vm.serializeAddress(o, "verifiableFactory", SepoliaEns.VERIFIABLE_FACTORY);
        vm.serializeAddress(o, "userRegistryImpl", SepoliaEns.USER_REGISTRY_IMPL);
        vm.serializeAddress(o, "permissionedResolverImpl", SepoliaEns.PERMISSIONED_RESOLVER_IMPL);
        o = vm.serializeAddress(o, "paymentToken", SepoliaEns.ENS_MOCK_USDC);
    }

    function _parentJson() internal returns (string memory o) {
        string memory label = _parentLabel();
        bytes memory dns = EnsNames.dnsEncode(_parentName());
        uint256 labelId = uint256(EnsNames.labelhash(label));
        bytes32 commitment = _commitment();
        uint64 committedAt = REGISTRAR.commitmentAt(commitment);

        // Written during forge's simulation: right after a commit run, committedAt / validFrom are a block or two
        // early. wait-for-commit.sh reads commitmentAt from chain instead.
        string memory c = "ens.parent.commit";
        vm.serializeBytes32(c, "commitment", commitment);
        vm.serializeUint(c, "committedAt", committedAt);
        vm.serializeUint(c, "validFrom", committedAt == 0 ? 0 : committedAt + REGISTRAR.MIN_COMMITMENT_AGE());
        vm.serializeUint(c, "validTo", committedAt == 0 ? 0 : committedAt + REGISTRAR.MAX_COMMITMENT_AGE());
        c = vm.serializeUint(c, "duration", _duration());

        o = "ens.parent";
        vm.serializeString(o, "name", _parentName());
        vm.serializeBytes(o, "dnsName", dns);
        vm.serializeBytes32(o, "node", EnsNames.namehash(dns));
        vm.serializeBytes32(o, "labelhash", bytes32(labelId));
        vm.serializeString(o, "tokenId", vm.toString(ETH_REGISTRY.getTokenId(labelId)));
        vm.serializeAddress(o, "owner", ETH_REGISTRY.getOwner(labelId));
        vm.serializeUint(o, "expiry", ETH_REGISTRY.getExpiry(labelId));
        vm.serializeAddress(o, "subregistry", address(ETH_REGISTRY.getSubregistry(label)));
        vm.serializeAddress(o, "resolver", ETH_REGISTRY.getResolver(label));
        o = vm.serializeString(o, "commit", c);
    }

    function _registryJson() internal returns (string memory o) {
        IEnsUserRegistry registry = _userRegistry();
        bool deployed = address(registry).code.length != 0;
        address root = vm.addr(_ensOwnerKey());
        o = "ens.userRegistry";
        vm.serializeAddress(o, "address", address(registry));
        vm.serializeBool(o, "deployed", deployed);
        vm.serializeString(o, "salt", vm.toString(_registrySalt()));
        vm.serializeAddress(o, "rootAccount", root);
        vm.serializeBytes32(o, "rootRoles", bytes32(deployed ? registry.roles(0, root) : 0));
        o = vm.serializeBool(o, "emancipated", deployed && registry.isEmancipated());
    }

    function _tickerJson() internal returns (string memory o) {
        IEnsUserRegistry registry = _userRegistry();
        bool deployed = address(registry).code.length != 0;
        string memory label = _tickerLabel();
        bytes memory dns = _tickerDns();
        uint256 labelId = uint256(EnsNames.labelhash(label));
        address owner = deployed ? registry.getOwner(labelId) : address(0);
        o = "ens.ticker";
        vm.serializeString(o, "label", label);
        vm.serializeString(o, "name", _tickerName());
        vm.serializeBytes(o, "dnsName", dns);
        vm.serializeBytes32(o, "node", EnsNames.namehash(dns));
        vm.serializeBytes32(o, "labelhash", bytes32(labelId));
        vm.serializeString(o, "tokenId", vm.toString(deployed ? registry.findTokenId(label) : 0));
        vm.serializeAddress(o, "owner", owner);
        vm.serializeUint(o, "expiry", deployed ? registry.getExpiry(labelId) : 0);
        vm.serializeAddress(o, "resolver", deployed ? registry.getResolver(label) : address(0));
        vm.serializeBytes32(o, "ownerRoles", bytes32(owner != address(0) ? registry.roles(labelId, owner) : 0));
        o = vm.serializeBool(
            o,
            "transferable",
            owner != address(0) && registry.hasRoles(labelId, EnsRoles.ROLE_CAN_TRANSFER_ADMIN, owner)
        );
    }

    function _resolverJson() internal returns (string memory o) {
        IEnsPermissionedResolver resolver = _issuerResolver();
        bool deployed = address(resolver).code.length != 0;
        address issuer = vm.addr(_issuerKey());
        o = "ens.resolver";
        vm.serializeAddress(o, "address", address(resolver));
        vm.serializeBool(o, "deployed", deployed);
        vm.serializeString(o, "salt", vm.toString(_resolverSalt()));
        vm.serializeAddress(o, "owner", issuer);
        o = vm.serializeBool(o, "ownerHasAllRoles", deployed && resolver.hasRootRoles(EnsRoles.ALL_ROLES, issuer));
    }

    function _recordsJson() internal returns (string memory o) {
        IEnsPermissionedResolver resolver = _issuerResolver();
        bytes memory dns = _tickerDns();
        string[9] memory keys = _recordKeys();
        o = "ens.records";
        vm.serializeAddress(o, "addr60", _resolveAddr(resolver, dns));
        for (uint256 i; i < keys.length - 1; i++) {
            vm.serializeString(o, keys[i], _resolveText(resolver, dns, keys[i]));
        }
        o = vm.serializeString(o, keys[keys.length - 1], _resolveText(resolver, dns, keys[keys.length - 1]));
    }

    function _statusRoleJson() internal returns (string memory o) {
        IEnsPermissionedResolver resolver = _issuerResolver();
        ListingPolicyReceiver receiver = _receiver();
        bool live = address(receiver).code.length != 0;
        o = "ens.statusRole";
        vm.serializeAddress(o, "receiver", address(receiver));
        vm.serializeString(o, "key", KEY_STATUS);
        vm.serializeString(o, "resource", vm.toString(EnsRoles.textResource(KEY_STATUS)));
        vm.serializeBool(
            o,
            "granted",
            live && address(resolver).code.length != 0
                && resolver.hasRoles(EnsRoles.textResource(KEY_STATUS), EnsRoles.ROLE_SET_TEXT, address(receiver))
        );
        vm.serializeAddress(o, "mirrorResolver", live ? address(receiver.statusResolver()) : address(0));
        vm.serializeBytes(o, "mirrorName", live ? receiver.statusName() : bytes(""));
        o = vm.serializeString(o, "receiverStatus", live ? receiver.status() : "");
    }

    function _recordKeys() internal pure returns (string[9] memory) {
        return [
            KEY_AUCTION,
            KEY_POOL,
            KEY_HOOK,
            KEY_POLICY,
            KEY_STATUS,
            KEY_ELIGIBILITY,
            KEY_DESCRIPTION,
            KEY_URL,
            KEY_AVATAR
        ];
    }
}
