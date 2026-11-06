// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EnsRead} from "../../script/ens/EnsRead.s.sol";
import {ListingPolicyReceiver} from "../../src/ListingPolicyReceiver.sol";
import {
    Grant,
    IEnsAddressProfile,
    IEnsEthRegistrar,
    IEnsMockERC20,
    IEnsPermissionedRegistry,
    IEnsPermissionedResolver,
    IEnsRegistry,
    IEnsUniversalResolver,
    IEnsUserRegistry,
    IEnsVerifiableFactory
} from "../../src/interfaces/IEnsV2.sol";
import {ListingPolicy} from "../../src/interfaces/IListingPolicy.sol";
import {IListingPolicyReceiver} from "../../src/interfaces/IListingPolicyReceiver.sol";
import {IStatusResolver} from "../../src/interfaces/IStatusResolver.sol";
import {Sepolia, SepoliaEns} from "../../src/libraries/Constants.sol";
import {EnsNames, EnsRoles} from "../../src/libraries/EnsV2.sol";
import {CreReports} from "../utils/CreReports.sol";
import {SepoliaForkTest} from "../utils/SepoliaForkTest.sol";

/// @notice The ENSv2 ticker namespace (plan.md §7) on a Sepolia fork against the live ENSv2 contracts
///         (contracts-v2 tag `v2-mainnet-deployment-1`): `listingday.eth` via commit/reveal, our UserRegistry,
///         `acme` owned by the issuer with the issuer's PermissionedResolver, records read through the Universal
///         Resolver, the receiver's scoped `listingday.status` role, transfer locks and token id regeneration.
/// @dev Direct calls with pranks, no scripts: the scripts read config from process-wide env vars, which would race
///      with other fork tests running in parallel. The scripts themselves run in `DemoScripts.fork.t.sol`.
contract EnsNamespaceForkTest is SepoliaForkTest, CreReports {
    IEnsEthRegistrar internal constant REGISTRAR = IEnsEthRegistrar(SepoliaEns.ETH_REGISTRAR);
    IEnsPermissionedRegistry internal constant ETH_REGISTRY = IEnsPermissionedRegistry(SepoliaEns.ETH_REGISTRY);
    IEnsVerifiableFactory internal constant FACTORY = IEnsVerifiableFactory(SepoliaEns.VERIFIABLE_FACTORY);
    IEnsMockERC20 internal constant ENS_USDC = IEnsMockERC20(SepoliaEns.ENS_MOCK_USDC);

    string internal constant TICKER = "acme";
    string internal constant STATUS = "listingday.status";
    uint64 internal constant DURATION = 365 days;
    /// @dev `gasConfig.gasLimit` of the CRE workflow (cre/listing-policy/config.staging.json).
    uint256 internal constant CRE_GAS_LIMIT = 1_800_000;

    address internal exchange = makeAddr("listing-day ens exchange");
    address internal issuer = makeAddr("listing-day ens issuer");
    address internal ops = makeAddr("listing-day ens ops");
    address internal broadcaster = makeAddr("listing-day ens creBroadcaster");
    address internal token = makeAddr("listing-day ens MockSME");
    address internal auction = makeAddr("listing-day ens auction");
    address internal hook = makeAddr("listing-day ens ListingHook");
    bytes32 internal constant POOL_ID = keccak256("pool");

    string internal parentLabel;
    string internal parentName;
    string internal tickerName;
    bytes internal tickerDns;
    uint256 internal parentPrice;
    uint256 internal parentPaid;
    IEnsUserRegistry internal registry;
    IEnsPermissionedResolver internal resolver;
    ListingPolicyReceiver internal receiver;
    EnsRead internal reader;

    function setUpFork() internal override {
        parentLabel = REGISTRAR.isAvailable("listingday") ? "listingday" : "listingday-fork";
        parentName = string.concat(parentLabel, ".eth");
        tickerName = string.concat(TICKER, ".", parentName);
        tickerDns = EnsNames.dnsEncode(tickerName);
        reader = new EnsRead();

        (parentPrice, parentPaid) = _registerParent(parentLabel, exchange);

        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(exchange, EnsRoles.LISTING_REGISTRY_ROOT_ROLES);
        vm.startPrank(exchange);
        registry = IEnsUserRegistry(
            FACTORY.deployProxy(SepoliaEns.USER_REGISTRY_IMPL, 1, abi.encodeCall(IEnsUserRegistry.initialize, (grants)))
        );
        registry.setParent(IEnsRegistry(address(ETH_REGISTRY)), parentLabel);
        ETH_REGISTRY.setSubregistry(ETH_REGISTRY.findTokenId(parentLabel), registry);
        vm.stopPrank();

        grants[0] = Grant(issuer, EnsRoles.ALL_ROLES);
        vm.prank(issuer);
        resolver = IEnsPermissionedResolver(
            FACTORY.deployProxy(
                SepoliaEns.PERMISSIONED_RESOLVER_IMPL,
                2,
                abi.encodeCall(IEnsPermissionedResolver.initialize, (grants, new bytes[](0)))
            )
        );

        uint64 expiry = ETH_REGISTRY.findExpiry(parentLabel);
        vm.prank(exchange);
        registry.register(
            TICKER, issuer, IEnsRegistry(address(0)), address(resolver), EnsRoles.ISSUER_TICKER_ROLES, expiry
        );

        receiver = new ListingPolicyReceiver(
            address(this), Sepolia.CRE_MOCK_FORWARDER, broadcaster, Sepolia.CRE_CHAIN_SELECTOR, 1 days
        );
        _writeRecords();
        vm.prank(issuer);
        resolver.grantSetterRoles(
            abi.encodeCall(IEnsPermissionedResolver.setText, (tickerDns, STATUS, "")), address(receiver)
        );
        receiver.setStatusMirror(IStatusResolver(address(resolver)), tickerDns);
    }

    // ---------------------------------------------------------------- listingday.eth

    function test_parent_registeredByCommitReveal() public view {
        uint256 tokenId = ETH_REGISTRY.findTokenId(parentLabel);
        assertEq(ETH_REGISTRY.ownerOf(tokenId), exchange, "exchange owns the parent");
        assertTrue(ETH_REGISTRY.hasRoles(tokenId, EnsRoles.ETH_REGISTRATION_ROLES, exchange), "registration roles");
        assertEq(ETH_REGISTRY.findExpiry(parentLabel), block.timestamp + DURATION, "1 year from the reveal");
        assertGt(parentPrice, 0);
        assertEq(parentPaid, parentPrice, "paid the quoted price in ENS MockUSDC");
        assertEq(address(ETH_REGISTRY.getSubregistry(parentLabel)), address(registry), "our UserRegistry");
        assertEq(ETH_REGISTRY.getResolver(parentLabel), address(0), "no resolver on the parent itself");
        (IEnsRegistry parent, string memory label) = registry.getParent();
        assertEq(address(parent), address(ETH_REGISTRY), "canonical parent");
        assertEq(label, parentLabel);
    }

    function test_parent_revealNeedsSixtySeconds() public {
        string memory label = "listingday-commit-test";
        bytes32 secret = keccak256("secret");
        bytes32 commitment =
            REGISTRAR.makeCommitment(label, ops, secret, IEnsRegistry(address(0)), address(0), DURATION, bytes32(0));
        _pay(ops, label);
        vm.prank(ops);
        REGISTRAR.commit(commitment);
        uint64 validFrom = uint64(vm.getBlockTimestamp()) + REGISTRAR.MIN_COMMITMENT_AGE();

        skip(REGISTRAR.MIN_COMMITMENT_AGE() - 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEnsEthRegistrar.CommitmentTooNew.selector, commitment, validFrom, uint64(block.timestamp)
            )
        );
        vm.prank(ops);
        REGISTRAR.register(
            label, ops, secret, IEnsRegistry(address(0)), address(0), DURATION, address(ENS_USDC), bytes32(0)
        );

        skip(1);
        vm.prank(ops);
        REGISTRAR.register(
            label, ops, secret, IEnsRegistry(address(0)), address(0), DURATION, address(ENS_USDC), bytes32(0)
        );
        assertEq(ETH_REGISTRY.findOwner(label), ops);
        assertFalse(REGISTRAR.isAvailable(label));
    }

    // ---------------------------------------------------------------- acme.listingday.eth

    function test_ticker_ownedByIssuer() public view {
        uint256 tokenId = registry.findTokenId(TICKER);
        assertEq(registry.ownerOf(tokenId), issuer, "issuer owns the ticker");
        assertEq(registry.findOwner(TICKER), issuer);
        assertEq(registry.roles(tokenId, issuer), EnsRoles.ISSUER_TICKER_ROLES, "SET_RESOLVER | RENEW only");
        assertFalse(registry.hasRoles(tokenId, EnsRoles.ROLE_CAN_TRANSFER_ADMIN, issuer), "not transferable");
        assertEq(registry.roles(tokenId, exchange), 0, "exchange holds no token roles");
        assertEq(registry.roles(0, exchange), EnsRoles.LISTING_REGISTRY_ROOT_ROLES, "exchange root roles");
        assertEq(registry.getResolver(TICKER), address(resolver), "issuer's own resolver");
        assertTrue(resolver.hasRootRoles(EnsRoles.ALL_ROLES, issuer), "issuer owns its resolver");
        assertFalse(resolver.hasRootRoles(EnsRoles.ROLE_SET_TEXT, exchange), "exchange cannot write records");
        assertFalse(registry.isEmancipated(), "registry keeps ROLE_UNREGISTER at root");
    }

    function test_ticker_issuerCanRepointResolver() public {
        address other = makeAddr("listing-day ens otherResolver");
        uint256 tokenId = registry.findTokenId(TICKER);
        vm.prank(issuer);
        registry.setResolver(tokenId, other);
        assertEq(registry.getResolver(TICKER), other);

        vm.expectRevert(
            abi.encodeWithSelector(
                IEnsPermissionedRegistry.EACUnauthorizedAccountRoles.selector,
                registry.getResource(tokenId),
                EnsRoles.ROLE_SET_RESOLVER,
                exchange
            )
        );
        vm.prank(exchange);
        registry.setResolver(tokenId, address(resolver));
    }

    function test_ticker_transferReverts() public {
        uint256 tokenId = registry.findTokenId(TICKER);
        vm.expectRevert(abi.encodeWithSelector(IEnsPermissionedRegistry.TransferDisallowed.selector, tokenId, issuer));
        vm.prank(issuer);
        registry.unsafeTransfer(ops, tokenId, "");

        vm.expectRevert(IEnsPermissionedRegistry.TransferUnsafeUntilRegistryIsEmancipated.selector);
        vm.prank(issuer);
        registry.safeTransferFrom(issuer, ops, tokenId, 1, "");

        assertEq(registry.ownerOf(tokenId), issuer, "still the issuer's");
    }

    // ---------------------------------------------------------------- records through the Universal Resolver

    function test_records_viaUniversalResolver() public view {
        EnsRead.Resolved memory r = reader.resolve(tickerName);
        assertEq(r.resolver, address(resolver), "UR finds the issuer's resolver");
        assertEq(r.addr, token, "addr(60) = MockSME");
        assertEq(r.texts[0], vm.toString(auction), "listingday.auction");
        assertEq(r.texts[1], vm.toString(POOL_ID), "listingday.pool");
        assertEq(r.texts[2], vm.toString(hook), "listingday.hook");
        assertEq(r.texts[3], string.concat("eip155:11155111:", vm.toString(address(receiver))), "listingday.policy");
        assertEq(r.texts[4], "", "listingday.status: empty before the first CRE report");
        assertEq(r.texts[5], "open", "listingday.eligibility");
        assertEq(r.texts[6], "Acme SME: Listing Day IPO", "description");
        assertEq(r.texts[7], "https://github.com/AyushBherwani1998/eth-global-mumbai", "url");
        assertEq(r.texts[8], "data:image/svg+xml;base64,PHN2Zy8+", "avatar");

        bytes memory dns = tickerDns;
        (bytes memory result,) = IEnsUniversalResolver(SepoliaEns.UNIVERSAL_RESOLVER)
            .resolveWithGateways(
                dns, abi.encodeCall(IEnsAddressProfile.addr, (EnsNames.namehash(dns), 60)), _gateways()
            );
        assertEq(abi.decode(result, (bytes)), abi.encodePacked(token), "addr(node, 60) bytes");
        (address found, bytes32 node,) = IEnsUniversalResolver(SepoliaEns.UNIVERSAL_RESOLVER).findResolver(dns);
        assertEq(found, address(resolver));
        assertEq(node, EnsNames.namehash(dns));
    }

    // ---------------------------------------------------------------- the receiver's scoped status role

    function test_receiver_setsStatusFromCreReport_butNotOtherRecords() public {
        assertTrue(resolver.hasRoles(EnsRoles.textResource(STATUS), EnsRoles.ROLE_SET_TEXT, address(receiver)));
        assertFalse(resolver.hasRootRoles(EnsRoles.ROLE_SET_TEXT, address(receiver)), "scoped, not root");

        ListingPolicy memory p = _freshPolicy();
        vm.expectEmit(address(receiver));
        emit IListingPolicyReceiver.StatusMirrored(address(resolver), "listed");
        assertTrue(
            _deliver(Sepolia.CRE_MOCK_FORWARDER, address(receiver), broadcaster, _encodeReport(p, ""), CRE_GAS_LIMIT),
            "ReportProcessed.result within the workflow's gas limit"
        );
        assertEq(reader.text(tickerName, STATUS), "listed", "status via the Universal Resolver");

        skip(12);
        p = _freshPolicy();
        p.halted = true;
        assertTrue(_deliver(Sepolia.CRE_MOCK_FORWARDER, address(receiver), broadcaster, _encodeReport(p, "")));
        assertEq(reader.text(tickerName, STATUS), "halted");

        skip(12);
        p = _freshPolicy();
        assertTrue(_deliver(Sepolia.CRE_MOCK_FORWARDER, address(receiver), broadcaster, _encodeReport(p, "")));
        assertEq(reader.text(tickerName, STATUS), "listed");

        vm.expectRevert(
            abi.encodeWithSelector(
                IEnsPermissionedResolver.EACUnauthorizedAccountRoles.selector,
                EnsRoles.textResource("url"),
                EnsRoles.ROLE_SET_TEXT,
                address(receiver)
            )
        );
        vm.prank(address(receiver));
        resolver.setText(tickerDns, "url", "https://evil.example");

        vm.expectPartialRevert(IEnsPermissionedResolver.EACUnauthorizedAccountRoles.selector);
        vm.prank(address(receiver));
        resolver.setAddress(tickerDns, 60, abi.encodePacked(ops));

        assertEq(reader.text(tickerName, "url"), "https://github.com/AyushBherwani1998/eth-global-mumbai");
        assertEq(reader.addr(tickerName), token);
    }

    function test_receiver_statusRole_grantNeedsTextAdmin() public {
        vm.expectPartialRevert(IEnsPermissionedResolver.EACCannotGrantRoles.selector);
        vm.prank(exchange);
        resolver.grantSetterRoles(abi.encodeCall(IEnsPermissionedResolver.setText, (tickerDns, "url", "")), ops);

        vm.expectPartialRevert(IEnsPermissionedResolver.EACCannotGrantRoles.selector);
        vm.prank(issuer);
        resolver.grantRoles(EnsRoles.textResource("url"), EnsRoles.ROLE_SET_TEXT, ops);
    }

    // ---------------------------------------------------------------- token ids

    /// @dev Role changes on a token burn + re-mint it under a new id (`TokenRegenerated`). Shown on
    ///      `listingday.eth`, where the exchange holds admin roles from registration; nobody can change roles on
    ///      `acme` (token admin roles exist only at registration and the issuer got none), so its id changes only
    ///      on delist/relist. Either way: look ids up by label, never cache them.
    function test_tokenId_regeneratesOnRoleChange_findTokenId() public {
        uint256 oldId = ETH_REGISTRY.findTokenId(parentLabel);
        vm.prank(exchange);
        ETH_REGISTRY.grantRoles(oldId, EnsRoles.ROLE_SET_RESOLVER, ops);
        uint256 newId = ETH_REGISTRY.findTokenId(parentLabel);
        assertTrue(newId != oldId, "token id regenerated");
        assertEq(ETH_REGISTRY.ownerOf(oldId), address(0), "stale id has no owner");
        assertEq(ETH_REGISTRY.ownerOf(newId), exchange);
        assertEq(ETH_REGISTRY.getTokenId(oldId), newId, "getTokenId(anyId) maps to the current id");
        assertEq(address(ETH_REGISTRY.getSubregistry(parentLabel)), address(registry), "wiring unaffected");
        address parentResolver = makeAddr("listing-day ens parentResolver");
        vm.prank(ops);
        ETH_REGISTRY.setResolver(newId, parentResolver);

        uint256 acmeId = registry.findTokenId(TICKER);
        vm.expectPartialRevert(IEnsPermissionedRegistry.EACCannotGrantRoles.selector);
        vm.prank(exchange);
        registry.grantRoles(acmeId, EnsRoles.ROLE_RENEW, ops);
        vm.expectPartialRevert(IEnsPermissionedRegistry.EACCannotGrantRoles.selector);
        vm.prank(issuer);
        registry.grantRoles(acmeId, EnsRoles.ROLE_RENEW, ops);
        assertEq(registry.findTokenId(TICKER), acmeId, "acme roles are fixed");
    }

    function test_tokenId_changesOnDelistRelist_recordsPersist() public {
        uint256 oldId = registry.findTokenId(TICKER);
        vm.prank(exchange);
        registry.unregister(oldId);
        assertEq(registry.findOwner(TICKER), address(0), "delisted");
        assertEq(registry.getResolver(TICKER), address(0), "resolver hidden while unregistered");
        try reader.text(tickerName, "url") returns (string memory url) {
            assertEq(url, "", "no records while delisted");
        } catch {}

        uint64 expiry = ETH_REGISTRY.findExpiry(parentLabel);
        vm.prank(exchange);
        registry.register(
            TICKER, issuer, IEnsRegistry(address(0)), address(resolver), EnsRoles.ISSUER_TICKER_ROLES, expiry
        );
        uint256 newId = registry.findTokenId(TICKER);
        assertTrue(newId != oldId, "new token id");
        assertEq(registry.ownerOf(newId), issuer);
        assertEq(registry.ownerOf(oldId), address(0));
        assertEq(reader.addr(tickerName), token, "records live in the resolver, keyed by name");
        assertEq(reader.text(tickerName, "listingday.eligibility"), "open");
    }

    // ---------------------------------------------------------------- helpers

    function _registerParent(string memory label, address owner) internal returns (uint256 price, uint256 paid) {
        bytes32 secret = keccak256(abi.encode("secret", label));
        bytes32 commitment =
            REGISTRAR.makeCommitment(label, owner, secret, IEnsRegistry(address(0)), address(0), DURATION, bytes32(0));
        price = _pay(owner, label);
        uint256 before = ENS_USDC.balanceOf(REGISTRAR.BENEFICIARY());
        vm.prank(owner);
        REGISTRAR.commit(commitment);
        skip(REGISTRAR.MIN_COMMITMENT_AGE() + 1);
        vm.prank(owner);
        REGISTRAR.register(
            label, owner, secret, IEnsRegistry(address(0)), address(0), DURATION, address(ENS_USDC), bytes32(0)
        );
        paid = ENS_USDC.balanceOf(REGISTRAR.BENEFICIARY()) - before;
    }

    function _pay(address owner, string memory label) internal returns (uint256 price) {
        (uint256 base, uint256 premium) = REGISTRAR.getRegisterPrice(label, DURATION, address(ENS_USDC));
        price = base + premium;
        vm.startPrank(owner);
        ENS_USDC.mint(owner, price);
        ENS_USDC.approve(address(REGISTRAR), price);
        vm.stopPrank();
    }

    function _writeRecords() internal {
        bytes memory dns = tickerDns;
        bytes[] memory calls = new bytes[](9);
        calls[0] = abi.encodeCall(IEnsPermissionedResolver.setAddress, (dns, 60, abi.encodePacked(token)));
        calls[1] = _text("listingday.auction", vm.toString(auction));
        calls[2] = _text("listingday.pool", vm.toString(POOL_ID));
        calls[3] = _text("listingday.hook", vm.toString(hook));
        calls[4] = _text("listingday.policy", string.concat("eip155:11155111:", vm.toString(address(receiver))));
        calls[5] = _text("listingday.eligibility", "open");
        calls[6] = _text("description", "Acme SME: Listing Day IPO");
        calls[7] = _text("url", "https://github.com/AyushBherwani1998/eth-global-mumbai");
        calls[8] = _text("avatar", "data:image/svg+xml;base64,PHN2Zy8+");
        vm.prank(issuer);
        resolver.multicall(calls);
    }

    function _text(string memory key, string memory value) internal view returns (bytes memory) {
        return abi.encodeCall(IEnsPermissionedResolver.setText, (tickerDns, key, value));
    }

    function _gateways() internal pure returns (string[] memory g) {
        g = new string[](1);
        g[0] = "x-batch-gateway:true";
    }
}
