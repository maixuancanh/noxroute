// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IBatchSwapRouter} from "../interfaces/IBatchSwapRouter.sol";
import {IERC20Minimal} from "../interfaces/IERC20Minimal.sol";

contract MockSwapRouter is IBatchSwapRouter {
    address public immutable expectedTokenIn;
    address public immutable expectedTokenOut;
    uint256 public amountOut;

    constructor(address tokenIn, address tokenOut) {
        expectedTokenIn = tokenIn;
        expectedTokenOut = tokenOut;
    }

    function setAmountOut(uint256 configuredAmountOut) external {
        amountOut = configuredAmountOut;
    }

    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external returns (uint256) {
        require(tokenIn == expectedTokenIn, "tokenIn");
        require(tokenOut == expectedTokenOut, "tokenOut");
        require(amountOut >= minAmountOut, "slippage");
        require(IERC20Minimal(tokenIn).transferFrom(msg.sender, address(this), amountIn), "pull");
        require(IERC20Minimal(tokenOut).transfer(msg.sender, amountOut), "pay");
        return amountOut;
    }
}
