// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IListingHook, ListingHookConfig} from "./interfaces/IListingHook.sol";
import {IListingPolicy, ListingPolicy} from "./interfaces/IListingPolicy.sol";
import {ListingBand} from "./libraries/ListingBand.sol";
import {ListingPrice} from "./libraries/ListingPrice.sol";
import {InitializerHook} from "liquidity-launcher/src/periphery/hooks/InitializerHook.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";

/// @title ListingHook
/// @notice v4 hook for a Listing Day pool: ±5% listing-day band around the CCA clearing price, then a policy-driven
///         band (20% normal, 5% surveillance, directional mode), halt and cool-off. Bands only ever reject swaps;
///         no liquidity flags are set, so adding and removing liquidity is never blocked.
/// @dev Inherits liquidity-launcher's `InitializerHook`, so LBPStrategy accepts it (`IInitializerHook` via ERC165,
///      `authorized() == LBPStrategy`, BEFORE_INITIALIZE flag) and only LBPStrategy can initialize the pool.
///      `beforeInitialize` stays `view`; state is written in `afterInitialize`. The hook serves exactly one pool,
///      whose key is fixed at deploy time. A reverting swap cannot persist anything, so halts arrive only as
///      successful policy updates (plan.md §5).
contract ListingHook is InitializerHook, IListingHook {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint16 public constant DEFAULT_NORMAL_BAND_BPS = 2000;
    uint16 public constant DEFAULT_SURVEILLANCE_BAND_BPS = 500;
    uint8 public constant MODE_NORMAL = 0;
    uint8 public constant MODE_SURVEILLANCE = 1;
    uint8 public constant MODE_DIRECTIONAL = 2;

    /// @dev keccak256("listingday.ListingHook.preSwapSqrtPriceX96") - 1. Transient: pre-swap price for directional mode.
    uint256 internal constant PRE_SWAP_SQRT_PRICE_SLOT =
        0x21003784599029f20b604028c54f3fb7908c79e8b72222bc5318901cc8797513;

    address public immutable owner;
    address public immutable usdc;
    address public immutable token;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;
    uint16 public immutable listingDayBandBps;
    uint32 public immutable listingDayDuration;
    PoolId public immutable poolId;

    IListingPolicy public policySource;

    bool public listed;
    bool public usdcIsCurrency0;
    uint64 public listedAt;
    uint64 public listingDayEndsAt;
    uint160 public listingSqrtPriceX96;
    int24 public listingTick;
    uint160 public listingDaySqrtPriceMinX96;
    uint160 public listingDaySqrtPriceMaxX96;

    /// @param poolManager_ v4 PoolManager.
    /// @param strategy LBPStrategy, the only address allowed to initialize the pool.
    constructor(IPoolManager poolManager_, address strategy, ListingHookConfig memory config)
        InitializerHook(poolManager_, strategy)
    {
        if (
            config.usdc == address(0) || config.token == address(0) || config.usdc == config.token
                || config.listingDayBandBps == 0 || config.listingDayBandBps >= ListingBand.BPS
        ) revert InvalidConfig();
        owner = config.owner;
        usdc = config.usdc;
        token = config.token;
        fee = config.fee;
        tickSpacing = config.tickSpacing;
        listingDayBandBps = config.listingDayBandBps;
        listingDayDuration = config.listingDayDuration;
        poolId = _poolKey(config.usdc, config.token, config.fee, config.tickSpacing).toId();
        policySource = config.policySource;
        emit PolicySourceSet(address(config.policySource));
    }

    // ---------------------------------------------------------------- permissions

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: true,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ---------------------------------------------------------------- initialize

    /// @dev Inherited LBPStrategy-only check, then pins the pool key. `view`: no writes before initialization.
    function _beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96)
        internal
        view
        override
        returns (bytes4)
    {
        super._beforeInitialize(sender, key, sqrtPriceX96);
        if (PoolId.unwrap(key.toId()) != PoolId.unwrap(poolId)) revert PoolKeyMismatch();
        return IHooks.beforeInitialize.selector;
    }

    /// @dev Stores the listing price (the CCA clearing price LBPStrategy initialized at), orientation and the
    ///      listing-day band, and starts the listing-day window.
    function _afterInitialize(address, PoolKey calldata key, uint160 sqrtPriceX96, int24 tick)
        internal
        override
        returns (bytes4)
    {
        if (listed) revert AlreadyListed();
        bool usdc0 = Currency.unwrap(key.currency0) == usdc;
        (uint160 lo, uint160 hi) = ListingBand.bounds(sqrtPriceX96, listingDayBandBps, usdc0);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 nowTs = uint64(block.timestamp);
        uint64 endsAt = nowTs + listingDayDuration;

        listed = true;
        usdcIsCurrency0 = usdc0;
        listedAt = nowTs;
        listingDayEndsAt = endsAt;
        listingSqrtPriceX96 = sqrtPriceX96;
        listingTick = tick;
        listingDaySqrtPriceMinX96 = lo;
        listingDaySqrtPriceMaxX96 = hi;

        // forge-lint: disable-next-line(reentrancy-events)
        emit Listed(poolId, sqrtPriceX96, tick, usdc0, endsAt, lo, hi);
        return IHooks.afterInitialize.selector;
    }

    // ---------------------------------------------------------------- swaps

    /// @dev Halt and cool-off reject early; otherwise records the pre-swap price for directional mode.
    function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        ListingPolicy memory p = _readPolicy();
        if (p.halted) revert Halted();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < p.coolOffUntil) revert CoolingOff(p.coolOffUntil);
        uint160 pre = _sqrtPrice();
        assembly ("memory-safe") {
            tstore(PRE_SWAP_SQRT_PRICE_SLOT, pre)
        }
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev Rejects the swap if the post-swap price is outside the active band, or (directional mode) if it
    ///      widens the gap to the reference beyond the surveillance band.
    function _afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        internal
        view
        override
        returns (bytes4, int128)
    {
        uint160 post = _sqrtPrice();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < listingDayEndsAt) {
            _checkBand(post, listingDaySqrtPriceMinX96, listingDaySqrtPriceMaxX96);
        } else {
            ListingPolicy memory p = _effectivePolicy(_readPolicy());
            uint160 ref = p.refSqrtPriceX96;
            if (p.mode == MODE_DIRECTIONAL) {
                uint160 pre;
                assembly ("memory-safe") {
                    pre := tload(PRE_SWAP_SQRT_PRICE_SLOT)
                }
                if (ListingBand.gapQ96(post, ref) > ListingBand.gapQ96(pre, ref)) {
                    (uint160 sLo, uint160 sHi) = ListingBand.bounds(ref, p.survBandBps, usdcIsCurrency0);
                    if (post < sLo || post > sHi) revert DirectionalWidening(pre, post, ref);
                }
            }
            (uint160 lo, uint160 hi) = _policyBand(p);
            _checkBand(post, lo, hi);
        }
        return (IHooks.afterSwap.selector, 0);
    }

    // ---------------------------------------------------------------- admin

    /// @inheritdoc IListingHook
    function setPolicySource(IListingPolicy policySource_) external {
        if (msg.sender != owner) revert OnlyOwner();
        policySource = policySource_;
        emit PolicySourceSet(address(policySource_));
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IListingHook
    function poolKey() external view returns (PoolKey memory) {
        return _poolKey(usdc, token, fee, tickSpacing);
    }

    /// @inheritdoc IListingHook
    function phase() public view returns (Phase) {
        if (!listed) return Phase.NotListed;
        // forge-lint: disable-next-line(block-timestamp)
        return block.timestamp < listingDayEndsAt ? Phase.ListingDay : Phase.Normal;
    }

    /// @inheritdoc IListingHook
    function effectivePolicy() external view returns (ListingPolicy memory) {
        return _effectivePolicy(_readPolicy());
    }

    /// @inheritdoc IListingHook
    function currentBand() public view returns (uint160 sqrtPriceMinX96, uint160 sqrtPriceMaxX96) {
        Phase ph = phase();
        if (ph == Phase.NotListed) return (0, 0);
        if (ph == Phase.ListingDay) return (listingDaySqrtPriceMinX96, listingDaySqrtPriceMaxX96);
        return _policyBand(_effectivePolicy(_readPolicy()));
    }

    /// @inheritdoc IListingHook
    function currentBandPointsE2() external view returns (uint256 lowPointsE2, uint256 highPointsE2) {
        (uint160 lo, uint160 hi) = currentBand();
        if (lo == 0) return (0, 0);
        bool usdc0 = usdcIsCurrency0;
        // With USDC as currency0 the lowest sqrt price is the highest share price.
        (uint160 forLow, uint160 forHigh) = usdc0 ? (hi, lo) : (lo, hi);
        lowPointsE2 = ListingPrice.sqrtPriceX96ToPointsE2(forLow, usdc0);
        highPointsE2 = ListingPrice.sqrtPriceX96ToPointsE2(forHigh, usdc0);
    }

    /// @inheritdoc IListingHook
    function currentPointsE2() external view returns (uint256) {
        if (!listed) return 0;
        return ListingPrice.sqrtPriceX96ToPointsE2(_sqrtPrice(), usdcIsCurrency0);
    }

    // ---------------------------------------------------------------- internal

    function _readPolicy() internal view returns (ListingPolicy memory p) {
        IListingPolicy source = policySource;
        if (address(source) != address(0)) p = source.policy();
    }

    function _effectivePolicy(ListingPolicy memory p) internal view returns (ListingPolicy memory) {
        if (p.refSqrtPriceX96 == 0) p.refSqrtPriceX96 = listingSqrtPriceX96;
        if (p.normalBandBps == 0 || p.normalBandBps >= ListingBand.BPS) p.normalBandBps = DEFAULT_NORMAL_BAND_BPS;
        if (p.survBandBps == 0 || p.survBandBps >= ListingBand.BPS) p.survBandBps = DEFAULT_SURVEILLANCE_BAND_BPS;
        if (p.mode > MODE_DIRECTIONAL) p.mode = MODE_NORMAL;
        return p;
    }

    function _policyBand(ListingPolicy memory p) internal view returns (uint160, uint160) {
        uint16 bps = p.mode == MODE_SURVEILLANCE ? p.survBandBps : p.normalBandBps;
        return ListingBand.bounds(p.refSqrtPriceX96, bps, usdcIsCurrency0);
    }

    function _checkBand(uint160 sqrtPriceX96, uint160 lo, uint160 hi) internal pure {
        if (sqrtPriceX96 < lo || sqrtPriceX96 > hi) revert OutOfBand(sqrtPriceX96, lo, hi);
    }

    function _sqrtPrice() internal view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
    }

    function _poolKey(address usdc_, address token_, uint24 fee_, int24 tickSpacing_)
        internal
        view
        returns (PoolKey memory)
    {
        (address c0, address c1) = usdc_ < token_ ? (usdc_, token_) : (token_, usdc_);
        return PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: fee_,
            tickSpacing: tickSpacing_,
            hooks: IHooks(address(this))
        });
    }
}
