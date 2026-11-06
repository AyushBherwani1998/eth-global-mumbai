// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

/// @title ListingBand
/// @notice Price bands for `ListingHook`, computed in v4 sqrtPriceX96 space.
/// @dev Bands are defined on the SHARE price (USDC per share), the number the UI shows: a 5% band around 110
///      points is 104.5 to 115.5 points. In sqrt space that is `ref * sqrt(1 ± b)` when USDC is currency1, and
///      `ref / sqrt(1 ± b)` (bounds swapped) when USDC is currency0, because the pool price is then inverted.
library ListingBand {
    uint256 internal constant BPS = 10_000;
    /// @dev sqrt factors are 1e18-scaled: sqrt((BPS ± bps) * 1e32) = sqrt(1 ± b) * 1e18.
    uint256 internal constant SCALE = 1e18;
    uint256 internal constant Q96 = 1 << 96;

    /// @notice Pool sqrtPriceX96 bounds for a share-price band of ±`bps` around `refSqrtPriceX96`.
    /// @param bps Half-width in bps of the share price; must be < 10_000.
    /// @return sqrtPriceMinX96 Lowest allowed pool sqrtPriceX96 (clamped to v4 MIN_SQRT_PRICE).
    /// @return sqrtPriceMaxX96 Highest allowed pool sqrtPriceX96 (clamped to v4 MAX_SQRT_PRICE).
    function bounds(uint160 refSqrtPriceX96, uint256 bps, bool usdcIsCurrency0)
        internal
        pure
        returns (uint160 sqrtPriceMinX96, uint160 sqrtPriceMaxX96)
    {
        uint256 up = Math.sqrt((BPS + bps) * 1e32);
        uint256 down = Math.sqrt((BPS - bps) * 1e32);
        uint256 lo;
        uint256 hi;
        if (usdcIsCurrency0) {
            lo = Math.mulDiv(refSqrtPriceX96, SCALE, up, Math.Rounding.Ceil);
            hi = Math.mulDiv(refSqrtPriceX96, SCALE, down);
        } else {
            lo = Math.mulDiv(refSqrtPriceX96, down, SCALE, Math.Rounding.Ceil);
            hi = Math.mulDiv(refSqrtPriceX96, up, SCALE);
        }
        sqrtPriceMinX96 = _clamp(lo);
        sqrtPriceMaxX96 = _clamp(hi);
    }

    /// @notice Distance of `sqrtPriceX96` from `refSqrtPriceX96` as a Q96 ratio >= 1 (max(p/r, r/p)).
    /// @dev Symmetric under inversion, so it measures the gap identically in either token order.
    function gapQ96(uint160 sqrtPriceX96, uint160 refSqrtPriceX96) internal pure returns (uint256) {
        return sqrtPriceX96 >= refSqrtPriceX96
            ? Math.mulDiv(sqrtPriceX96, Q96, refSqrtPriceX96)
            : Math.mulDiv(refSqrtPriceX96, Q96, sqrtPriceX96);
    }

    function _clamp(uint256 sqrtPriceX96) private pure returns (uint160) {
        if (sqrtPriceX96 < TickMath.MIN_SQRT_PRICE) return TickMath.MIN_SQRT_PRICE;
        if (sqrtPriceX96 > TickMath.MAX_SQRT_PRICE) return TickMath.MAX_SQRT_PRICE;
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint160(sqrtPriceX96);
    }
}
