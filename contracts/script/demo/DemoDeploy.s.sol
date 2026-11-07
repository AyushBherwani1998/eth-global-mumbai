// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AuctionValidationHook} from "../../src/AuctionValidationHook.sol";
import {ListingHook} from "../../src/ListingHook.sol";
import {ListingPolicyReceiver} from "../../src/ListingPolicyReceiver.sol";
import {MockSME} from "../../src/MockSME.sol";
import {ListingHookConfig} from "../../src/interfaces/IListingHook.sol";
import {IListingPolicy} from "../../src/interfaces/IListingPolicy.sol";
import {ListingDay, Sepolia} from "../../src/libraries/Constants.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {AllowAllModule} from "../../src/modules/AllowAllModule.sol";
import {DemoBase} from "./DemoBase.sol";
import {console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";

/// @notice Step 1: MockSME (CREATE2-salted above USDC, so USDC is currency0), AllowAllModule + AuctionValidationHook,
///         a mined ListingHook, the CRE ListingPolicyReceiver (Sepolia MockKeystoneForwarder, configurable
///         broadcaster), then `hook.setPolicySource(receiver)`. Writes the deployments file skeleton.
///
///   PRIVATE_KEY=0x… [CRE_BROADCASTER_KEY=0x…] [TREASURY_KEY=0x…] [DEMO_LABEL=acme-v1] \
///   forge script script/demo/DemoDeploy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --slow
///
/// Idempotent: MockSME, ListingHook and the receiver sit at CREATE2 addresses derived from DEMO_LABEL, so a re-run
/// finds them; the module and validation hook are reused from the deployments file. Use a new DEMO_LABEL for a
/// fresh listing (a fresh token, hence a fresh pool id).
contract DemoDeploy is DemoBase {
    struct Deployed {
        MockSME token;
        AllowAllModule module;
        AuctionValidationHook validationHook;
        ListingHook hook;
        ListingPolicyReceiver receiver;
    }

    function run() external {
        _step("DemoDeploy");
        address deployer = vm.addr(_deployerKey());
        address treasury = vm.addr(_treasuryKey());
        address broadcaster = vm.addr(_broadcasterKey());
        uint64 maxAge = uint64(vm.envOr("POLICY_MAX_AGE", uint256(1 days)));
        uint32 listingDay = uint32(vm.envOr("LISTING_DAY_SECONDS", uint256(1 hours)));
        uint256 deployBlock = block.number;

        Deployed memory c;
        vm.startBroadcast(_deployerKey());
        c.token = _deployToken(deployer);
        (c.module, c.validationHook) = _deployValidation(deployer, c.token);
        c.hook = _deployListingHook(deployer, c.token, listingDay);
        c.receiver = _deployReceiver(deployer, broadcaster, maxAge);
        if (address(c.hook.policySource()) != address(c.receiver)) {
            _tx("ListingHook.setPolicySource(receiver)");
            c.hook.setPolicySource(IListingPolicy(address(c.receiver)));
        }
        vm.stopBroadcast();

        _check(c, deployer, broadcaster);
        _save(c, deployer, treasury, broadcaster, deployBlock);
    }

    function _deployToken(address issuer) internal returns (MockSME token) {
        string memory name = vm.envOr("STOCK_NAME", string("Acme SME"));
        string memory symbol = vm.envOr("STOCK_SYMBOL", string("ACME"));
        bytes memory initCode = abi.encodePacked(type(MockSME).creationCode, abi.encode(name, symbol, issuer));
        bytes32 initCodeHash = keccak256(initCode);
        uint256 i;
        bytes32 salt = _salt(string.concat("MockSME#", vm.toString(i)));
        while (vm.computeCreate2Address(salt, initCodeHash, CREATE2_FACTORY) < Sepolia.USDC) {
            salt = _salt(string.concat("MockSME#", vm.toString(++i)));
        }
        (address addr, bool fresh) = _create2(salt, initCode);
        if (fresh) _tx(string.concat("MockSME (CREATE2, ", symbol, " to the issuer)"));
        token = MockSME(addr);
        console2.log("MockSME", addr, fresh ? "(deployed)" : "(exists)");
    }

    /// @dev The module needs the hook address and the hook checks `module.hook() == this`, so the hook is predicted
    ///      from the deployer's next-but-one nonce. Both are plain CREATEs: `AuctionValidationHook.deployer` must be
    ///      the issuer EOA, the only account allowed to `setAuction`.
    function _deployValidation(address deployer, MockSME token)
        internal
        returns (AllowAllModule module, AuctionValidationHook validationHook)
    {
        string memory j = vm.exists(_file()) ? vm.readFile(_file()) : "{}";
        validationHook = AuctionValidationHook(_jsonAddress(j, ".contracts.auctionValidationHook"));
        if (
            address(validationHook).code.length != 0 && validationHook.token() == address(token)
                && validationHook.deployer() == deployer
        ) {
            module = AllowAllModule(address(validationHook.module()));
            console2.log("AuctionValidationHook", address(validationHook), "(exists)");
            return (module, validationHook);
        }
        address predicted = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);
        uint128 applicantCap = uint128(vm.envOr("APPLICANT_CAP_USDC_RAW", uint256(20e6)));
        uint256 capPoints = _capPoints();
        uint256 capPriceQ96 = _pointsToQ96(capPoints);
        _tx("AllowAllModule (per wallet cap)");
        module = new AllowAllModule(predicted, applicantCap);
        _tx(string.concat("AuctionValidationHook (cap ", vm.toString(capPoints), " points)"));
        validationHook = new AuctionValidationHook(module, address(token), Sepolia.USDC, capPriceQ96);
        require(address(validationHook) == predicted, "validation hook address prediction");
        console2.log("AllowAllModule", address(module), "(deployed)");
        console2.log("AuctionValidationHook", address(validationHook), "(deployed)");
    }

    function _deployListingHook(address owner, MockSME token, uint32 listingDay) internal returns (ListingHook hook) {
        ListingHookConfig memory config = ListingHookConfig({
            owner: owner,
            usdc: Sepolia.USDC,
            token: address(token),
            fee: POOL_FEE,
            tickSpacing: POOL_TICK_SPACING,
            listingDayBandBps: LISTING_DAY_BAND_BPS,
            listingDayDuration: listingDay,
            policySource: IListingPolicy(address(0))
        });
        bytes memory args = abi.encode(IPoolManager(Sepolia.POOL_MANAGER), Sepolia.LBP_STRATEGY, config);
        bytes memory initCode = abi.encodePacked(type(ListingHook).creationCode, args);
        (address mined, bytes32 salt) = _mineHookSalt(keccak256(initCode));
        (address addr, bool fresh) = _create2(salt, initCode);
        require(addr == mined, "mined hook address");
        if (fresh) _tx("ListingHook (CREATE2, mined flags 0x30C0)");
        hook = ListingHook(addr);
        console2.log("ListingHook", addr, fresh ? "(deployed)" : "(exists)");
    }

    /// @dev First salt whose CREATE2 address carries exactly the hook flags. Unlike `HookMiner.find` it does not
    ///      skip addresses that already have code, so a re-run lands on the hook it deployed before.
    function _mineHookSalt(bytes32 initCodeHash) internal pure returns (address hook, bytes32 salt) {
        for (uint256 i; i < 1_000_000; i++) {
            salt = bytes32(i);
            hook = vm.computeCreate2Address(salt, initCodeHash, CREATE2_FACTORY);
            if (uint160(hook) & Hooks.ALL_HOOK_MASK == LISTING_HOOK_FLAGS) return (hook, salt);
        }
        revert("no hook salt found");
    }

    function _deployReceiver(address owner, address broadcaster, uint64 maxAge)
        internal
        returns (ListingPolicyReceiver receiver)
    {
        bytes memory initCode = abi.encodePacked(
            type(ListingPolicyReceiver).creationCode,
            abi.encode(owner, Sepolia.CRE_MOCK_FORWARDER, broadcaster, Sepolia.CRE_CHAIN_SELECTOR, maxAge)
        );
        (address addr, bool fresh) = _create2(_salt("ListingPolicyReceiver"), initCode);
        if (fresh) _tx("ListingPolicyReceiver (CREATE2, forwarder = Sepolia MockKeystoneForwarder)");
        receiver = ListingPolicyReceiver(addr);
        console2.log("ListingPolicyReceiver", addr, fresh ? "(deployed)" : "(exists)");
    }

    function _check(Deployed memory c, address deployer, address broadcaster) internal view {
        require(address(c.token) > Sepolia.USDC, "MockSME must sort above USDC");
        uint256 supply = _totalSupply();
        require(
            c.token.balanceOf(deployer) == supply || c.validationHook.auction() != address(0),
            "issuer holds total supply"
        );
        require(c.module.hook() == address(c.validationHook), "module bound to the validation hook");
        require(c.hook.authorized() == Sepolia.LBP_STRATEGY, "hook authorizes LBPStrategy");
        require(uint160(address(c.hook)) & Hooks.ALL_HOOK_MASK == LISTING_HOOK_FLAGS, "hook flags");
        require(address(c.hook.policySource()) == address(c.receiver), "policy source = receiver");
        require(c.receiver.forwarder() == Sepolia.CRE_MOCK_FORWARDER, "receiver forwarder");
        require(c.receiver.broadcaster() == broadcaster, "receiver broadcaster");
    }

    function _save(Deployed memory c, address deployer, address treasury, address broadcaster, uint256 deployBlock)
        internal
    {
        string memory path = _file();
        bool sameListing = vm.exists(path) && _jsonAddress(vm.readFile(path), ".contracts.mockSME") == address(c.token)
            && _jsonAddress(vm.readFile(path), ".contracts.listingHook") == address(c.hook);

        string memory contracts = _contractsJson(c);
        string memory pool = _poolJson(c);
        string memory receiver = _receiverJson(c);
        string memory metadata = _metadataJson();

        if (sameListing) {
            _writeSection("contracts", contracts);
            _writeSection("pool", pool);
            _writeSection("receiverConfig", receiver);
            _writeSection("metadata", metadata);
            vm.writeJson(string.concat("\"", vm.toString(broadcaster), "\""), path, ".creBroadcaster");
            console2.log("updated", path);
            return;
        }

        string memory root = "root";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeString(root, "label", _label());
        vm.serializeUint(root, "deployBlock", deployBlock);
        vm.serializeAddress(root, "deployer", deployer);
        vm.serializeAddress(root, "issuer", deployer);
        vm.serializeAddress(root, "treasury", treasury);
        vm.serializeAddress(root, "creBroadcaster", broadcaster);
        vm.serializeString(root, "external", _externalJson());
        vm.serializeString(root, "contracts", contracts);
        vm.serializeString(root, "pool", pool);
        vm.serializeString(root, "receiverConfig", receiver);
        vm.serializeString(root, "params", _paramsJson());
        vm.serializeString(root, "metadata", metadata);
        vm.serializeString(root, "auction", "{}");
        vm.serializeString(root, "bids", "{}");
        vm.serializeString(root, "results", "{}");
        vm.serializeString(root, "trade", "{}");
        vm.serializeString(root, "halt", "{}");
        vm.serializeString(root, "ens", "{}");
        root = vm.serializeString(root, "txs", "{}");
        _ensureParentDir(path);
        vm.writeJson(root, path);
        console2.log("wrote", path);
    }

    function _contractsJson(Deployed memory c) internal returns (string memory o) {
        o = "contracts";
        vm.serializeAddress(o, "mockSME", address(c.token));
        vm.serializeAddress(o, "allowAllModule", address(c.module));
        vm.serializeAddress(o, "auctionValidationHook", address(c.validationHook));
        vm.serializeAddress(o, "listingHook", address(c.hook));
        o = vm.serializeAddress(o, "listingPolicyReceiver", address(c.receiver));
    }

    function _poolJson(Deployed memory c) internal returns (string memory o) {
        PoolKey memory key = c.hook.poolKey();
        string memory poolKey = "poolKey";
        vm.serializeAddress(poolKey, "currency0", Currency.unwrap(key.currency0));
        vm.serializeAddress(poolKey, "currency1", Currency.unwrap(key.currency1));
        vm.serializeUint(poolKey, "fee", key.fee);
        vm.serializeInt(poolKey, "tickSpacing", key.tickSpacing);
        poolKey = vm.serializeAddress(poolKey, "hooks", address(key.hooks));
        o = "pool";
        vm.serializeBytes32(o, "poolId", PoolId.unwrap(c.hook.poolId()));
        vm.serializeBool(o, "usdcIsCurrency0", Currency.unwrap(key.currency0) == Sepolia.USDC);
        vm.serializeUint(o, "listingDayBandBps", c.hook.listingDayBandBps());
        vm.serializeUint(o, "listingDaySeconds", c.hook.listingDayDuration());
        o = vm.serializeString(o, "poolKey", poolKey);
    }

    function _receiverJson(Deployed memory c) internal returns (string memory o) {
        o = "receiverConfig";
        vm.serializeAddress(o, "forwarder", c.receiver.forwarder());
        vm.serializeAddress(o, "broadcaster", c.receiver.broadcaster());
        // Above 2^53: a string, so JavaScript reads it exactly.
        vm.serializeString(o, "chainSelector", vm.toString(c.receiver.chainSelector()));
        o = vm.serializeUint(o, "maxAge", c.receiver.maxAge());
    }

    function _externalJson() internal returns (string memory e) {
        e = "external";
        vm.serializeAddress(e, "usdc", Sepolia.USDC);
        vm.serializeAddress(e, "permit2", Sepolia.PERMIT2);
        vm.serializeAddress(e, "poolManager", Sepolia.POOL_MANAGER);
        vm.serializeAddress(e, "positionManager", Sepolia.POSITION_MANAGER);
        vm.serializeAddress(e, "universalRouter", Sepolia.UNIVERSAL_ROUTER);
        vm.serializeAddress(e, "stateView", Sepolia.STATE_VIEW);
        vm.serializeAddress(e, "quoter", Sepolia.QUOTER);
        vm.serializeAddress(e, "ccaFactory", Sepolia.CCA_FACTORY);
        vm.serializeAddress(e, "liquidityLauncher", Sepolia.LIQUIDITY_LAUNCHER);
        vm.serializeAddress(e, "lbpStrategy", Sepolia.LBP_STRATEGY);
        vm.serializeAddress(e, "creMockForwarder", Sepolia.CRE_MOCK_FORWARDER);
        e = vm.serializeAddress(e, "create2Factory", CREATE2_FACTORY);
    }

    function _paramsJson() internal returns (string memory p) {
        uint256 floorPts = _floorPoints();
        uint256 issuePts = _issuePoints();
        uint256 capPts = _capPoints();
        p = "params";
        vm.serializeUint(p, "totalSupply", _totalSupply());
        vm.serializeUint(p, "auctionSupply", _auctionSupply());
        vm.serializeUint(p, "lpReserve", _lpReserve());
        vm.serializeUint(p, "applicantCap", vm.envOr("APPLICANT_CAP_USDC_RAW", uint256(20e6)));
        vm.serializeUint(p, "requiredCurrencyRaised", _requiredRaise());
        vm.serializeUint(p, "floorPoints", floorPts);
        vm.serializeUint(p, "issuePoints", issuePts);
        vm.serializeUint(p, "capPoints", capPts);
        vm.serializeUint(p, "floorPriceQ96", _pointsToQ96(floorPts));
        vm.serializeUint(p, "capPriceQ96", _pointsToQ96(capPts));
        vm.serializeUint(p, "tickSpacingQ96", ListingPrice.TICK_SPACING_Q96);
        vm.serializeUint(p, "onePointQ96", ListingPrice.ONE_POINT_Q96);
        p = vm.serializeUint(p, "lpRateMps", LP_RATE_MPS);
    }

    function _totalSupply() internal view returns (uint256) {
        return vm.envOr("TOTAL_SUPPLY_SHARES", uint256(110_000)) * 1e18;
    }

    function _auctionSupply() internal view returns (uint256) {
        return vm.envOr("AUCTION_SUPPLY_SHARES", uint256(90_000)) * 1e18;
    }

    function _lpReserve() internal view returns (uint256) {
        return vm.envOr("LP_RESERVE_SHARES", uint256(20_000)) * 1e18;
    }

    function _requiredRaise() internal view returns (uint128) {
        return uint128(vm.envOr("REQUIRED_RAISE_USDC_RAW", uint256(45e6)));
    }

    function _floorPoints() internal view returns (uint256) {
        return vm.envOr("FLOOR_POINTS", uint256(80));
    }

    function _issuePoints() internal view returns (uint256) {
        return vm.envOr("ISSUE_POINTS", uint256(100));
    }

    function _capPoints() internal view returns (uint256) {
        uint256 issue = _issuePoints();
        uint256 capPct = vm.envOr("CAP_PERCENT", uint256(190));
        return (issue * capPct) / 100;
    }

    function _pointsToQ96(uint256 points) internal pure returns (uint256) {
        return points * ListingPrice.ONE_POINT_Q96;
    }

    function _metadataJson() internal returns (string memory m) {
        m = "metadata";
        vm.serializeString(m, "priceSource", vm.envOr("PRICE_SOURCE", string("demo")));
        vm.serializeString(m, "priceSourceDate", vm.envOr("PRICE_SOURCE_DATE", string("")));
        vm.serializeString(m, "referencePrice", vm.envOr("REFERENCE_PRICE_INR", string("")));
        vm.serializeString(m, "priceCurrency", "INR");
        m = vm.serializeString(m, "disclaimer", "Demo prices in test USDC. Not real USD-equity pricing.");
    }
}
