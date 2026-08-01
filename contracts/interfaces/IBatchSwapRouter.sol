// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IBatchSwapRouter {
    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external returns (uint256 amountOut);
}
