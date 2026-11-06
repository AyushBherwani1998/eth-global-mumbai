// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ListingPolicyReceiver} from "../../src/ListingPolicyReceiver.sol";
import {IEnsMockERC20, IEnsPermissionedResolver, IEnsUserRegistry} from "../../src/interfaces/IEnsV2.sol";
import {ListingPolicy} from "../../src/interfaces/IListingPolicy.sol";
import {Sepolia, SepoliaEns} from "../../src/libraries/Constants.sol";
import {EnsNames, EnsRoles} from "../../src/libraries/EnsV2.sol";
import {DemoDeploy} from "../demo/DemoDeploy.s.sol";
import {DemoLaunch} from "../demo/DemoLaunch.s.sol";
import {EnsBase} from "./EnsBase.sol";
import {EnsName} from "./EnsName.s.sol";
import {EnsRead} from "./EnsRead.s.sol";
import {EnsRecords} from "./EnsRecords.s.sol";
import {EnsRegistry} from "./EnsRegistry.s.sol";
import {EnsStatusRole} from "./EnsStatusRole.s.sol";
import {EnsTicker} from "./EnsTicker.s.sol";
import {console2} from "forge-std/Script.sol";
import {StdAssertions} from "forge-std/StdAssertions.sol";

/// @notice The ENSv2 ticker namespace (plan.md §7) against the real Sepolia ENSv2 contracts on a fork: deploy +
///         launch the listing, then every ENS step in order (commit, wait 60 s, register `listingday.eth`,
///         UserRegistry, ticker, records, status role), each run twice for idempotency, then real CRE-style reports
///         through the live MockKeystoneForwarder that the receiver mirrors into `listingday.status`. All reads go
///         through the Universal Resolver (`EnsRead`). Writes `deployments/sepolia-ens-fork.json`.
///         Then the swap-in: the issuer relaunches `acme` as a human listing (WorldPassModule, plan.md §8), and the
///         same ENS steps point the ticker at it with `listingday.eligibility = human`
///         (`deployments/sepolia-ens-fork-human.json`).
///
///   forge script script/ens/EnsFork.s.sol --fork-url $SEPOLIA_RPC_URL       (or: make ens-fork)
///
/// Throwaway keys: the "exchange" owns `listingday.eth`, the issuer (= the listing deployer) owns `acme`.
/// If `listingday.eth` is already taken on the forked chain (e.g. after the live run), the fork uses
/// `listingday-fork.eth` instead; nothing else changes. Nothing is broadcast.
contract EnsFork is EnsBase, StdAssertions {
    string internal constant FORK_FILE = "deployments/sepolia-ens-fork.json";
    string internal constant FORK_FILE_HUMAN = "deployments/sepolia-ens-fork-human.json";
    string internal constant FALLBACK_PARENT_LABEL = "listingday-fork";

    uint256 internal deployerKey = _key("deployer");
    uint256 internal exchangeKey = _key("exchange");
    uint256 internal broadcasterKey = _key("creBroadcaster");

    function run() external {
        setUpEnv();
        if (vm.exists(FORK_FILE)) vm.removeFile(FORK_FILE);
        deployListing();
        registerParent();
        wireRegistry();
        registerTicker();
        writeRecords();
        grantStatusRole();
        reportStatus();
        checkResolution();
        swapInHumanListing();
        console2.log("");
        console2.log("EnsFork: all steps passed; wrote", FORK_FILE, "and", FORK_FILE_HUMAN);
    }

    // ---------------------------------------------------------------- steps (public: reused by the fork tests)

    function setUpEnv() public {
        require(block.chainid == Sepolia.CHAIN_ID, "run on a Sepolia fork: --fork-url $SEPOLIA_RPC_URL");
        vm.setEnv("DEPLOYMENTS_FILE", FORK_FILE);
        vm.setEnv("DEMO_LABEL", "ens-fork");
        vm.setEnv("PRIVATE_KEY", vm.toString(bytes32(deployerKey)));
        vm.setEnv("ISSUER_KEY", vm.toString(bytes32(deployerKey)));
        vm.setEnv("ENS_OWNER_KEY", vm.toString(bytes32(exchangeKey)));
        vm.setEnv("TREASURY_KEY", vm.toString(bytes32(deployerKey)));
        vm.setEnv("CRE_BROADCASTER_KEY", vm.toString(bytes32(broadcasterKey)));
        vm.setEnv("ENS_TICKER", DEFAULT_TICKER);
        vm.setEnv("ELIGIBILITY", "open");
        vm.setEnv("ENS_ELIGIBILITY", "");
        bool taken = !REGISTRAR.isAvailable(DEFAULT_PARENT_LABEL)
            && ETH_REGISTRY.findOwner(DEFAULT_PARENT_LABEL) != vm.addr(exchangeKey);
        vm.setEnv("ENS_PARENT_LABEL", taken ? FALLBACK_PARENT_LABEL : DEFAULT_PARENT_LABEL);
        vm.deal(vm.addr(deployerKey), 10 ether);
        vm.deal(vm.addr(exchangeKey), 1 ether);
        vm.deal(vm.addr(broadcasterKey), 1 ether);
    }

    function deployListing() public {
        new DemoDeploy().run();
        new DemoLaunch().run();
        assertGt(address(_load().auction).code.length, 0, "auction launched");
    }

    function registerParent() public {
        address exchange = vm.addr(exchangeKey);
        string memory label = _parentLabel();
        IEnsMockERC20 usdc = IEnsMockERC20(SepoliaEns.ENS_MOCK_USDC);
        (uint256 base, uint256 premium) = REGISTRAR.getRegisterPrice(label, _duration(), address(usdc));
        uint256 beneficiaryBefore = usdc.balanceOf(REGISTRAR.BENEFICIARY());

        new EnsName().run();
        uint64 committedAt = REGISTRAR.commitmentAt(_commitment());
        assertEq(committedAt, vm.getBlockTimestamp(), "commit sent");
        assertTrue(REGISTRAR.isAvailable(label), "not registered by the commit run");
        assertEq(vm.parseJsonUint(_json(), ".ens.parent.commit.validFrom"), committedAt + 60, "validFrom in json");

        _advance(REGISTRAR.MIN_COMMITMENT_AGE() + 1);
        new EnsName().run();
        assertEq(ETH_REGISTRY.findOwner(label), exchange, "parent registered to the exchange");
        assertEq(ETH_REGISTRY.findExpiry(label), committedAt + 61 + _duration(), "expiry = reveal time + duration");
        assertEq(usdc.balanceOf(REGISTRAR.BENEFICIARY()) - beneficiaryBefore, base + premium, "paid in ENS MockUSDC");
        uint256 tokenId = ETH_REGISTRY.findTokenId(label);
        assertTrue(ETH_REGISTRY.hasRoles(tokenId, EnsRoles.ETH_REGISTRATION_ROLES, exchange), "registration roles");

        new EnsName().run();
        assertEq(ETH_REGISTRY.findTokenId(label), tokenId, "re-run keeps the name");
    }

    function wireRegistry() public {
        new EnsRegistry().run();
        IEnsUserRegistry registry = _userRegistry();
        assertEq(address(ETH_REGISTRY.getSubregistry(_parentLabel())), address(registry), "subregistry set");
        assertEq(registry.roles(0, vm.addr(exchangeKey)), EnsRoles.LISTING_REGISTRY_ROOT_ROLES, "exchange root roles");
        (, string memory parentLabel) = registry.getParent();
        assertEq(parentLabel, _parentLabel(), "canonical parent");
        assertFalse(registry.isEmancipated(), "not emancipated: we keep ROLE_UNREGISTER");

        new EnsRegistry().run();
        assertEq(address(ETH_REGISTRY.getSubregistry(_parentLabel())), address(registry), "re-run keeps it");
    }

    function registerTicker() public {
        new EnsTicker().run();
        IEnsUserRegistry registry = _userRegistry();
        address issuer = vm.addr(deployerKey);
        string memory label = _tickerLabel();
        uint256 tokenId = registry.findTokenId(label);
        assertEq(registry.ownerOf(tokenId), issuer, "ticker owned by the issuer");
        assertTrue(issuer != vm.addr(exchangeKey), "issuer is not the exchange");
        assertEq(registry.roles(tokenId, issuer), EnsRoles.ISSUER_TICKER_ROLES, "SET_RESOLVER | RENEW only");
        assertEq(registry.getResolver(label), address(_issuerResolver()), "issuer's own resolver");
        assertEq(registry.findExpiry(label), ETH_REGISTRY.findExpiry(_parentLabel()), "expires with the parent");
        assertTrue(_issuerResolver().hasRootRoles(EnsRoles.ALL_ROLES, issuer), "issuer owns its resolver");

        new EnsTicker().run();
        assertEq(registry.findTokenId(label), tokenId, "re-run keeps the ticker");
    }

    function writeRecords() public {
        new EnsRecords().run();
        string memory j = _json();
        assertEq(vm.parseJsonAddress(j, ".ens.records.addr60"), vm.parseJsonAddress(j, ".contracts.mockSME"));
        assertEq(vm.parseJsonString(j, ".ens.records.['listingday.eligibility']"), "open");

        vm.recordLogs();
        new EnsRecords().run();
        assertEq(vm.getRecordedLogs().length, 0, "re-run sends nothing");
    }

    function grantStatusRole() public {
        new EnsStatusRole().run();
        ListingPolicyReceiver receiver = _receiver();
        IEnsPermissionedResolver resolver = _issuerResolver();
        assertTrue(
            resolver.hasRoles(EnsRoles.textResource(KEY_STATUS), EnsRoles.ROLE_SET_TEXT, address(receiver)),
            "receiver may set listingday.status"
        );
        assertFalse(resolver.hasRootRoles(EnsRoles.ROLE_SET_TEXT, address(receiver)), "not root");
        assertEq(address(receiver.statusResolver()), address(resolver), "mirror resolver");
        assertEq(receiver.statusName(), _tickerDns(), "mirror name (DNS-encoded)");
        (bool ok, bytes memory ret) = _simulate(
            address(receiver),
            address(resolver),
            abi.encodeCall(IEnsPermissionedResolver.setText, (_tickerDns(), KEY_URL, "https://evil.example"))
        );
        assertFalse(ok, "receiver cannot set url");
        assertEq(_selector(ret), IEnsPermissionedResolver.EACUnauthorizedAccountRoles.selector);

        new EnsStatusRole().run();
    }

    /// @dev Three CRE-style reports through the live forwarder; the receiver mirrors each derived status.
    function reportStatus() public {
        EnsRead reader = new EnsRead();
        ListingPolicyReceiver receiver = _receiver();
        assertEq(reader.text(_tickerName(), KEY_STATUS), "", "no status before the first report");

        ListingPolicy memory p;
        _report(receiver, p);
        assertEq(reader.text(_tickerName(), KEY_STATUS), "listed");
        p.halted = true;
        _report(receiver, p);
        assertEq(reader.text(_tickerName(), KEY_STATUS), "halted");
        p.halted = false;
        _report(receiver, p);
        assertEq(reader.text(_tickerName(), KEY_STATUS), "listed");
        new EnsStatusRole().run();
        assertEq(reader.text(_tickerName(), KEY_STATUS), "listed", "re-run keeps the mirrored status");
    }

    function checkResolution() public {
        EnsRead.Resolved memory r = new EnsRead().resolve(_tickerName());
        string memory j = _json();
        assertEq(r.resolver, address(_issuerResolver()), "UR finds the issuer's resolver");
        assertEq(r.addr, vm.parseJsonAddress(j, ".contracts.mockSME"), "addr = MockSME");
        assertEq(r.texts[0], vm.toString(vm.parseJsonAddress(j, ".auction.address")), "auction");
        assertEq(r.texts[1], vm.toString(vm.parseJsonBytes32(j, ".pool.poolId")), "pool");
        assertEq(r.texts[2], vm.toString(vm.parseJsonAddress(j, ".contracts.listingHook")), "hook");
        assertEq(
            r.texts[3],
            string.concat("eip155:11155111:", vm.toString(vm.parseJsonAddress(j, ".contracts.listingPolicyReceiver"))),
            "policy"
        );
        assertEq(r.texts[4], "listed", "status");
        assertEq(r.texts[5], "open", "eligibility");
        assertGt(bytes(r.texts[6]).length, 0, "description");
        assertEq(r.texts[7], "https://github.com/AyushBherwani1998/eth-global-mumbai", "url");
        assertEq(_prefix(r.texts[8], 26), "data:image/svg+xml;base64,", "avatar");
        string[6] memory keys = [
            ".ens.parent.owner",
            ".ens.userRegistry.address",
            ".ens.ticker.tokenId",
            ".ens.resolver.address",
            ".ens.records.addr60",
            ".ens.statusRole.granted"
        ];
        for (uint256 i; i < keys.length; i++) {
            assertTrue(vm.keyExistsJson(j, keys[i]), string.concat("deployments json has ", keys[i]));
        }
        assertEq(vm.parseJsonString(j, ".ens.records.['listingday.status']"), "listed");
        assertTrue(vm.parseJsonBool(j, ".ens.statusRole.granted"));
        assertFalse(vm.parseJsonBool(j, ".ens.ticker.transferable"));
    }

    /// @dev Same ticker, same issuer; the validation hook's module is immutable, so `human` is a new launch.
    function swapInHumanListing() public {
        address openAuction = vm.parseJsonAddress(_json(), ".auction.address");
        vm.setEnv("ELIGIBILITY", "human");
        vm.setEnv("DEPLOYMENTS_FILE", FORK_FILE_HUMAN);
        vm.setEnv("DEMO_LABEL", "ens-fork-human");
        vm.setEnv("PASS_SIGNER_ADDRESS", vm.toString(vm.addr(_key("passSigner"))));
        if (vm.exists(FORK_FILE_HUMAN)) vm.removeFile(FORK_FILE_HUMAN);
        deployListing();
        Deployment memory d = _load();
        assertTrue(d.human, "human listing");
        assertEq(d.worldPass.signer(), vm.addr(_key("passSigner")));

        vm.setEnv("ENS_ELIGIBILITY", "open");
        (bool ok,) = address(new EnsRecords()).call(abi.encodeCall(EnsRecords.run, ()));
        assertFalse(ok, "ENS_ELIGIBILITY must agree with the module");
        vm.setEnv("ENS_ELIGIBILITY", "");

        new EnsRecords().run();
        assertEq(vm.parseJsonString(_json(), ".ens.records.['listingday.eligibility']"), "human");
        new EnsStatusRole().run();
        ListingPolicy memory p;
        _report(_receiver(), p);

        EnsRead.Resolved memory r = new EnsRead().resolve(_tickerName());
        assertEq(r.texts[0], vm.toString(address(d.auction)), "ticker points at the human auction");
        assertTrue(address(d.auction) != openAuction, "a new auction");
        assertEq(r.texts[2], vm.toString(address(d.hook)), "hook of the human listing");
        assertEq(r.texts[4], "listed", "status mirrored by the human listing's receiver");
        assertEq(r.texts[5], "human", "eligibility");
        assertEq(r.addr, address(d.token), "addr = the human listing's MockSME");
    }

    // ---------------------------------------------------------------- internal

    function _report(ListingPolicyReceiver receiver_, ListingPolicy memory p) internal {
        _advance(12);
        _sendPolicyReport(receiver_, p, "", "listing-day/EnsFork");
        assertEq(receiver_.mirroredStatusHash(), keccak256(bytes(receiver_.status())), "mirrored to ENS");
        _saveEns();
    }

    function _advance(uint256 secs) internal {
        vm.warp(vm.getBlockTimestamp() + secs);
        vm.roll(vm.getBlockNumber() + (secs + 11) / 12);
    }

    function _prefix(string memory s, uint256 n) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        if (b.length < n) return s;
        bytes memory out = new bytes(n);
        for (uint256 i; i < n; i++) {
            out[i] = b[i];
        }
        return string(out);
    }

    function _key(string memory name) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode("listing-day ens fork key", name)));
    }
}
