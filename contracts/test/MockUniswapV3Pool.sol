// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

contract MockUniswapV3Pool {
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;
    uint128 public liquidity = 1;
    uint32 public maxHistory;
    int24 public meanTick;
    int24 public spotTick;
    int56 public tickCumulativeDelta;

    constructor(
        address configuredToken0,
        address configuredToken1,
        uint24 configuredFee,
        uint32 configuredHistory,
        int24 configuredMeanTick,
        int24 configuredSpotTick
    ) {
        token0 = configuredToken0;
        token1 = configuredToken1;
        fee = configuredFee;
        maxHistory = configuredHistory;
        meanTick = configuredMeanTick;
        spotTick = configuredSpotTick;
        tickCumulativeDelta = int56(configuredMeanTick) * int56(uint56(configuredHistory));
    }

    function setMaxHistory(uint32 value) external {
        maxHistory = value;
    }

    function setLiquidity(uint128 value) external {
        liquidity = value;
    }

    function setSpotTick(int24 value) external {
        spotTick = value;
    }

    function setObservation(
        uint32 history,
        int56 delta,
        int56,
        int24 configuredSpotTick,
        uint128 configuredLiquidity
    ) external {
        maxHistory = history;
        tickCumulativeDelta = delta;
        spotTick = configuredSpotTick;
        liquidity = configuredLiquidity;
    }

    function observe(
        uint32[] calldata secondsAgos
    ) external view returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidity) {
        require(secondsAgos.length == 2 && secondsAgos[1] == 0, "secondsAgos");
        require(secondsAgos[0] <= maxHistory, "OLD");
        tickCumulatives = new int56[](2);
        secondsPerLiquidity = new uint160[](2);
        tickCumulatives[0] = 0;
        tickCumulatives[1] = tickCumulativeDelta;
    }

    function slot0()
        external
        view
        returns (uint160, int24, uint16, uint16, uint16, uint8, bool)
    {
        return (1, spotTick, 0, 2, 2, 0, true);
    }
}
