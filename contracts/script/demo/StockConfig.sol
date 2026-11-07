// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title StockConfig
/// @notice Configurable parameters for multiple independent stock listing demos.
/// @dev Each stock gets its own DEPLOYMENTS_FILE and separate contracts (token, auction, hook, receiver).
///      Set via environment variables; defaults mirror the original ACME demo.
library StockConfig {
    /// @notice Name of the ERC20 token (e.g. "Jio Financial Services", "Reliance Industries Limited")
    function tokenName() internal view returns (string memory) {
        return vm.envOr("STOCK_NAME", string("Acme SME"));
    }

    /// @notice Token symbol (e.g. "JIOFIN", "RELIANCE", "TCS")
    function tokenSymbol() internal view returns (string memory) {
        return vm.envOr("STOCK_SYMBOL", string("ACME"));
    }

    /// @notice ENS ticker label (lowercase, e.g. "jiofin", "reliance", "tcs")
    function ticker() internal view returns (string memory) {
        return vm.envOr("STOCK_TICKER", string("acme"));
    }

    /// @notice Floor price in points (1 point = 0.01 USDC per 1000-share lot)
    /// @dev Must be >= 32 points (CCA MIN_FLOOR_PRICE constraint after Q96 conversion)
    function floorPoints() internal view returns (uint256) {
        return vm.envOr("FLOOR_POINTS", uint256(80));
    }

    /// @notice Issue price in points (reference price for demo; 100 points = 1.00 USDC per lot)
    function issuePoints() internal view returns (uint256) {
        return vm.envOr("ISSUE_POINTS", uint256(100));
    }

    /// @notice Total supply in whole shares (no decimals; will be multiplied by 1e18)
    /// @dev Default 110,000 shares total
    function totalSupply() internal view returns (uint256) {
        return vm.envOr("TOTAL_SUPPLY_SHARES", uint256(110_000));
    }

    /// @notice Auction supply in whole shares (sold in CCA)
    /// @dev Default 90,000 shares (81.8% of total)
    function auctionSupply() internal view returns (uint256) {
        return vm.envOr("AUCTION_SUPPLY_SHARES", uint256(90_000));
    }

    /// @notice LP reserve in whole shares (held by strategy for v4 pool)
    /// @dev Default 20,000 shares (18.2% of total)
    function lpReserve() internal view returns (uint256) {
        return vm.envOr("LP_RESERVE_SHARES", uint256(20_000));
    }

    /// @notice Required currency raised for graduation (raw USDC, 6 decimals)
    /// @dev Default 45 USDC (50% of 90 USDC target at 100 points)
    function requiredRaise() internal view returns (uint128) {
        return uint128(vm.envOr("REQUIRED_RAISE_USDC_RAW", uint256(45e6)));
    }

    /// @notice Total auction duration in blocks (BID_WINDOW_BLOCKS + CLEAR_BLOCKS)
    /// @dev 5 minutes total ≈ 25 blocks (12s each), 6 hours ≈ 1800 blocks
    function totalAuctionBlocks() internal view returns (uint64) {
        uint256 bidWindow = vm.envOr("BID_WINDOW_BLOCKS", uint256(30));
        uint256 clearBlocks = vm.envOr("CLEAR_BLOCKS", uint256(20));
        return uint64(bidWindow + clearBlocks);
    }

    /// @notice Bid window duration in blocks (zero issuance phase)
    function bidWindowBlocks() internal view returns (uint64) {
        return uint64(vm.envOr("BID_WINDOW_BLOCKS", uint256(30)));
    }

    /// @notice Clearing phase duration in blocks (supply released)
    /// @dev Must divide 1e7 (MPS_TOTAL)
    function clearBlocks() internal view returns (uint64) {
        return uint64(vm.envOr("CLEAR_BLOCKS", uint256(20)));
    }

    /// @notice Deployment label for CREATE2 salt (must be unique per stock)
    /// @dev Change this for each new listing (e.g. "jiofin-v1", "reliance-v1", "tcs-v1")
    function deployLabel() internal view returns (string memory) {
        return vm.envOr("DEMO_LABEL", string("acme-v1"));
    }

    /// @notice Deployments file path for this listing
    /// @dev Each stock must have its own file (e.g. "deployments/jiofin.json")
    function deploymentsFile() internal view returns (string memory) {
        return vm.envOr("DEPLOYMENTS_FILE", string("deployments/sepolia.json"));
    }

    /// @notice Validate configuration constraints
    function validate() internal view {
        require(floorPoints() >= 32, "FLOOR_POINTS must be >= 32 (CCA MIN_FLOOR_PRICE)");
        require(issuePoints() >= floorPoints(), "ISSUE_POINTS must be >= FLOOR_POINTS");
        uint256 ts = totalSupply();
        uint256 auction = auctionSupply();
        uint256 lp = lpReserve();
        require(ts > 0 && auction > 0 && lp > 0, "Supply parameters must be positive");
        require(auction + lp <= ts, "AUCTION_SUPPLY + LP_RESERVE must not exceed TOTAL_SUPPLY");
        uint256 clear = clearBlocks();
        require(clear > 0 && 1e7 % clear == 0, "CLEAR_BLOCKS must divide 1e7");
        bytes memory label = bytes(deployLabel());
        require(label.length > 0 && label.length < 32, "DEMO_LABEL must be 1-31 chars");
    }
}

// Cheat code interface for vm.envOr
interface Vm {
    function envOr(string calldata key, string calldata defaultValue) external view returns (string memory);
    function envOr(string calldata key, uint256 defaultValue) external view returns (uint256);
}

Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
