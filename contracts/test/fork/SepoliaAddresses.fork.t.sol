// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Sepolia} from "../../src/libraries/Constants.sol";
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
}
