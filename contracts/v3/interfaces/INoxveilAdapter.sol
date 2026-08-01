// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

interface INoxveilAdapter {
    function vault() external view returns (address);
    function weth() external view returns (address);
    function usdc() external view returns (address);
    function pool() external view returns (address);
    function router() external view returns (address);
    function fee() external view returns (uint24);
    function twapWindow() external view returns (uint32);
    function consultTwap() external view returns (uint256 priceWad, int24 arithmeticMeanTick);
    function executeResidual(
        uint8 direction,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) external returns (uint256 amountOut);
}
