// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Sepolia, SepoliaEns} from "../../src/libraries/Constants.sol";
import {SepoliaForkTest} from "../utils/SepoliaForkTest.sol";

interface IHasPoolManager {
    function poolManager() external view returns (address);
}

interface ILBPStrategyView {
    function initializerFactory() external view returns (address);
    function positionManager() external view returns (address);
    function poolManager() external view returns (address);
}

interface ICcaFactoryView {
    function protocolFeeController() external view returns (address);
}

interface IInitializerHookView {
    function authorized() external view returns (address);
}

interface IEnsV2Links {
    function ETH_REGISTRY() external view returns (address);
    function rentPriceOracle() external view returns (address);
    function isPaymentToken(address token) external view returns (bool);
    function LABEL_STORE() external view returns (address);
    function getSubregistry(string calldata label) external view returns (address);
    function implementation() external view returns (address);
    function ROOT_REGISTRY() external view returns (address);
    function decimals() external view returns (uint8);
}

contract SepoliaAddressesForkTest is SepoliaForkTest {
    /// @dev EIP-1967 implementation slot, used by Circle's FiatTokenProxy.
    bytes32 internal constant IMPLEMENTATION_SLOT = 0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3;

    function test_fork_allConstants_haveCode() public view {
        address[16] memory all = [
            Sepolia.USDC,
            Sepolia.USDC_IMPLEMENTATION,
            Sepolia.PERMIT2,
            Sepolia.POOL_MANAGER,
            Sepolia.POSITION_MANAGER,
            Sepolia.UNIVERSAL_ROUTER,
            Sepolia.UNIVERSAL_ROUTER_2_1_2,
            Sepolia.STATE_VIEW,
            Sepolia.QUOTER,
            Sepolia.CCA_FACTORY,
            Sepolia.LIQUIDITY_LAUNCHER,
            Sepolia.LBP_STRATEGY,
            Sepolia.INITIALIZER_HOOK_REFERENCE,
            Sepolia.UERC20_FACTORY,
            Sepolia.CRE_MOCK_FORWARDER,
            Sepolia.CRE_FORWARDER
        ];
        for (uint256 i; i < all.length; i++) {
            assertGt(all[i].code.length, 0, vm.toString(all[i]));
        }
    }

    function test_fork_crossLinks() public view {
        assertEq(address(uint160(uint256(vm.load(Sepolia.USDC, IMPLEMENTATION_SLOT)))), Sepolia.USDC_IMPLEMENTATION);

        assertEq(IHasPoolManager(Sepolia.POSITION_MANAGER).poolManager(), Sepolia.POOL_MANAGER);
        assertEq(IHasPoolManager(Sepolia.STATE_VIEW).poolManager(), Sepolia.POOL_MANAGER);
        assertEq(IHasPoolManager(Sepolia.QUOTER).poolManager(), Sepolia.POOL_MANAGER);

        ILBPStrategyView lbp = ILBPStrategyView(Sepolia.LBP_STRATEGY);
        assertEq(lbp.initializerFactory(), Sepolia.CCA_FACTORY);
        assertEq(lbp.positionManager(), Sepolia.POSITION_MANAGER);
        assertEq(lbp.poolManager(), Sepolia.POOL_MANAGER);

        assertEq(ICcaFactoryView(Sepolia.CCA_FACTORY).protocolFeeController(), address(0));
        assertEq(IInitializerHookView(Sepolia.INITIALIZER_HOOK_REFERENCE).authorized(), Sepolia.LBP_STRATEGY);
    }

    function test_fork_ensV2_haveCode() public view {
        address[13] memory all = [
            SepoliaEns.ROOT_REGISTRY,
            SepoliaEns.ETH_REGISTRY,
            SepoliaEns.ETH_REGISTRAR,
            SepoliaEns.RENT_PRICE_ORACLE,
            SepoliaEns.LABEL_STORE,
            SepoliaEns.VERIFIABLE_FACTORY,
            SepoliaEns.USER_REGISTRY_IMPL,
            SepoliaEns.PERMISSIONED_RESOLVER_IMPL,
            SepoliaEns.UNIVERSAL_RESOLVER,
            SepoliaEns.MANAGED_UNIVERSAL_RESOLVER_PROXY,
            SepoliaEns.UNIVERSAL_RESOLVER_V2,
            SepoliaEns.ENS_MOCK_USDC,
            SepoliaEns.ENS_MOCK_DAI
        ];
        for (uint256 i; i < all.length; i++) {
            assertGt(all[i].code.length, 0, vm.toString(all[i]));
        }
    }

    /// @dev The ENSv2 deployment hangs together the way contracts-v2 `v2-mainnet-deployment-1` describes it.
    function test_fork_ensV2_crossLinks() public view {
        assertEq(IEnsV2Links(SepoliaEns.ROOT_REGISTRY).getSubregistry("eth"), SepoliaEns.ETH_REGISTRY, "root -> eth");
        assertEq(IEnsV2Links(SepoliaEns.ETH_REGISTRAR).ETH_REGISTRY(), SepoliaEns.ETH_REGISTRY, "registrar");
        assertEq(IEnsV2Links(SepoliaEns.ETH_REGISTRAR).rentPriceOracle(), SepoliaEns.RENT_PRICE_ORACLE, "oracle");
        assertTrue(IEnsV2Links(SepoliaEns.RENT_PRICE_ORACLE).isPaymentToken(SepoliaEns.ENS_MOCK_USDC), "MockUSDC");
        assertTrue(IEnsV2Links(SepoliaEns.RENT_PRICE_ORACLE).isPaymentToken(SepoliaEns.ENS_MOCK_DAI), "MockDAI");
        // Circle's Sepolia USDC is accepted too; the scripts pay in the mintable ENS MockUSDC so no faucet is needed.
        assertTrue(IEnsV2Links(SepoliaEns.RENT_PRICE_ORACLE).isPaymentToken(Sepolia.USDC), "Circle USDC");
        assertEq(IEnsV2Links(SepoliaEns.ENS_MOCK_USDC).decimals(), 6);
        assertEq(IEnsV2Links(SepoliaEns.ETH_REGISTRY).LABEL_STORE(), SepoliaEns.LABEL_STORE, "eth label store");
        assertEq(IEnsV2Links(SepoliaEns.USER_REGISTRY_IMPL).LABEL_STORE(), SepoliaEns.LABEL_STORE, "user label store");
        assertEq(
            IEnsV2Links(SepoliaEns.UNIVERSAL_RESOLVER).implementation(),
            SepoliaEns.MANAGED_UNIVERSAL_RESOLVER_PROXY,
            "0xeEeE... -> managed proxy"
        );
        assertEq(
            IEnsV2Links(SepoliaEns.MANAGED_UNIVERSAL_RESOLVER_PROXY).implementation(),
            SepoliaEns.UNIVERSAL_RESOLVER_V2,
            "managed proxy -> UniversalResolverV2"
        );
        assertEq(IEnsV2Links(SepoliaEns.UNIVERSAL_RESOLVER_V2).ROOT_REGISTRY(), SepoliaEns.ROOT_REGISTRY, "UR root");
    }
}
