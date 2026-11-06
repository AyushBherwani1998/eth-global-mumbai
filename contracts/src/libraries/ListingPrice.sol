// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title ListingPrice
/// @notice Single source of truth for Listing Day price math (plan.md §4, "Quote currency").
/// @dev Units:
///      - points: issue price = 100 points = 1.00 USDC per 1,000-share lot = 0.001 USDC per share.
///      - CCA price: raw currency units per raw token unit, in Q96 (USDC has 6 decimals, MockSME 18).
///      So 1 point = 0.01 USDC per lot = 1e4 raw USDC / 1e21 raw shares, and
///      ONE_POINT_Q96 = floor(2^96 * 1e4 / 1e21) = floor(2^96 / 1e17).
///
///      Every points price is defined as `points * ONE_POINT_Q96` (not `floor(points * 2^96 / 1e17)`), so
///      the floor, issue and cap prices are exact multiples of the 1-point tick spacing. The CCA requires
///      the floor and every bid `maxPrice` to sit on a tick boundary (`TickPriceNotAtBoundary`).
///      The truncation error is < 1 raw Q96 unit per point (relative error < 1e-12).
library ListingPrice {
    uint256 internal constant Q96 = 1 << 96;

    uint8 internal constant QUOTE_DECIMALS = 6;
    uint8 internal constant SHARE_DECIMALS = 18;
    uint256 internal constant LOT_SHARES = 1000;
    /// @notice Raw share units in one 1,000-share lot (1e21).
    uint256 internal constant SHARE_RAW_PER_LOT = LOT_SHARES * 10 ** SHARE_DECIMALS;
    /// @notice Points per 1.00 USDC per lot.
    uint256 internal constant POINTS_PER_QUOTE_UNIT_PER_LOT = 100;
    /// @notice Raw USDC per lot for one point (0.01 USDC = 1e4).
    uint256 internal constant QUOTE_RAW_PER_LOT_PER_POINT = 10 ** QUOTE_DECIMALS / POINTS_PER_QUOTE_UNIT_PER_LOT;

    /// @notice Q96 price of one point: 792,281,625,142.
    uint256 internal constant ONE_POINT_Q96 = Q96 * QUOTE_RAW_PER_LOT_PER_POINT / SHARE_RAW_PER_LOT;

    uint256 internal constant FLOOR_POINTS = 80;
    uint256 internal constant ISSUE_POINTS = 100;
    uint256 internal constant CAP_POINTS = 190;
    uint256 internal constant TICK_SPACING_POINTS = 1;

    /// @notice CCA `floorPrice`: 80 points = 0.80 USDC per lot.
    uint256 internal constant FLOOR_PRICE_Q96 = FLOOR_POINTS * ONE_POINT_Q96;
    /// @notice Issue price: 100 points = 1.00 USDC per lot (~7.92e13).
    uint256 internal constant ISSUE_PRICE_Q96 = ISSUE_POINTS * ONE_POINT_Q96;
    /// @notice AuctionValidationHook `capQ96`: 190 points = 1.90 USDC per lot.
    uint256 internal constant CAP_PRICE_Q96 = CAP_POINTS * ONE_POINT_Q96;
    /// @notice CCA `tickSpacing`: 1 point (1% of issue, 1.25% of floor).
    uint256 internal constant TICK_SPACING_Q96 = TICK_SPACING_POINTS * ONE_POINT_Q96;

    /// @notice Same as CCA ConstantsLib.MIN_FLOOR_PRICE.
    uint256 internal constant CCA_MIN_FLOOR_PRICE = (1 << 32) + 1;
    /// @notice Same as CCA ConstantsLib.MIN_TICK_SPACING.
    uint256 internal constant CCA_MIN_TICK_SPACING = 2;

    error TickSpacingTooSmall(uint256 tickSpacingQ96);

    /// @notice Points price to CCA Q96 price (tick-aligned).
    function pointsToQ96(uint256 points) internal pure returns (uint256) {
        return points * ONE_POINT_Q96;
    }

    /// @notice CCA Q96 price to points, rounded down.
    function q96ToPoints(uint256 priceQ96) internal pure returns (uint256) {
        return priceQ96 / ONE_POINT_Q96;
    }

    /// @notice Points price to raw USDC per 1,000-share lot (e.g. 110 points -> 1_100_000 = 1.10 USDC).
    function pointsToQuoteRawPerLot(uint256 points) internal pure returns (uint256) {
        return points * QUOTE_RAW_PER_LOT_PER_POINT;
    }

    /// @notice Untruncated conversion of a raw quote amount per raw share amount to Q96,
    ///         `floor(quoteRaw * 2^96 / shareRaw)`. Use only for comparison and display; bids must use
    ///         tick-aligned prices from `pointsToQ96`.
    function rawPriceToQ96(uint256 quoteRaw, uint256 shareRaw) internal pure returns (uint256) {
        return Math.mulDiv(quoteRaw, Q96, shareRaw);
    }

    /// @notice CCA `tickSpacing` for a tick of `pointsPerTick` points.
    function tickSpacingQ96(uint256 pointsPerTick) internal pure returns (uint256 spacing) {
        spacing = pointsPerTick * ONE_POINT_Q96;
        if (spacing < CCA_MIN_TICK_SPACING) revert TickSpacingTooSmall(spacing);
    }

    /// @notice True if `priceQ96` sits on a tick boundary for `spacingQ96`.
    function isTickAligned(uint256 priceQ96, uint256 spacingQ96) internal pure returns (bool) {
        return priceQ96 % spacingQ96 == 0;
    }

    /// @notice Rounds `priceQ96` down to the nearest tick boundary for `spacingQ96`.
    function roundDownToTick(uint256 priceQ96, uint256 spacingQ96) internal pure returns (uint256) {
        return priceQ96 - (priceQ96 % spacingQ96);
    }

    // ------------------------------------------------------------------ v4 pool prices
    // A v4 pool prices currency1 per currency0 as sqrtPriceX96. USDC usually sorts below MockSME, so USDC is
    // currency0 and the pool price is shares per USDC (inverted): a higher share price is a LOWER sqrtPriceX96.

    /// @notice CCA-style Q96 share price (raw USDC per raw share) to a v4 sqrtPriceX96.
    /// @dev Same math as liquidity-launcher `TokenPricing` (what LBPStrategy uses to initialize the pool), so
    ///      `priceQ96ToSqrtPriceX96(clearingPriceQ96, usdcIsCurrency0)` equals the migrated pool's opening price.
    function priceQ96ToSqrtPriceX96(uint256 priceQ96, bool usdcIsCurrency0) internal pure returns (uint160) {
        uint256 priceX192 = usdcIsCurrency0 ? Math.mulDiv(Q96 << 96, Q96, priceQ96) : priceQ96 << 96;
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint160(Math.sqrt(priceX192));
    }

    /// @notice v4 sqrtPriceX96 to a CCA-style Q96 share price (raw USDC per raw share), rounded down.
    function sqrtPriceX96ToPriceQ96(uint160 sqrtPriceX96, bool usdcIsCurrency0) internal pure returns (uint256) {
        if (usdcIsCurrency0) {
            uint256 inverse = Math.mulDiv(Q96, Q96, sqrtPriceX96);
            return Math.mulDiv(inverse, inverse, Q96);
        }
        return Math.mulDiv(sqrtPriceX96, sqrtPriceX96, Q96);
    }

    /// @notice Points price to a v4 sqrtPriceX96 (e.g. a ListingHook policy reference price).
    function pointsToSqrtPriceX96(uint256 points, bool usdcIsCurrency0) internal pure returns (uint160) {
        return priceQ96ToSqrtPriceX96(pointsToQ96(points), usdcIsCurrency0);
    }

    /// @notice Untruncated points price to a v4 sqrtPriceX96, for prices between ticks (e.g. 104.5 points as
    ///         `pointsE2 = 10_450`). Display and test use only.
    function pointsE2ToSqrtPriceX96(uint256 pointsE2, bool usdcIsCurrency0) internal pure returns (uint160) {
        return priceQ96ToSqrtPriceX96(Math.mulDiv(pointsE2, Q96, 100 * 1e17), usdcIsCurrency0);
    }

    /// @notice v4 sqrtPriceX96 to points scaled by 100 (11_000 = 110.00 points = 1.10 USDC per lot), rounded down.
    function sqrtPriceX96ToPointsE2(uint160 sqrtPriceX96, bool usdcIsCurrency0) internal pure returns (uint256) {
        return Math.mulDiv(sqrtPriceX96ToPriceQ96(sqrtPriceX96, usdcIsCurrency0), 100 * 1e17, Q96);
    }
}
