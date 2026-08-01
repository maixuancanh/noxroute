// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20Minimal} from "./interfaces/IERC20Minimal.sol";
import {IBatchSwapRouter} from "./interfaces/IBatchSwapRouter.sol";

interface IUniswapV3SwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable returns (uint256 amountOut);
}

contract UniswapV3BatchSwapAdapter is IBatchSwapRouter {
    address public immutable admin;
    address public controller;
    address public immutable tokenIn;
    address public immutable tokenOut;
    IUniswapV3SwapRouter02 public immutable router;
    uint24 public immutable poolFee;
    bool public controllerLocked;

    uint256 private reentrancyStatus = 1;

    error UnauthorizedController();
    error InvalidEndpoint(address endpoint);
    error InvalidPair();
    error InvalidPoolFee();
    error ControllerLocked();
    error TokenTransferFailed();
    error TokenApprovalFailed();
    error InsufficientAmountOut(uint256 received, uint256 required);
    error ReentrantCall();

    constructor(
        address configuredController,
        address configuredTokenIn,
        address configuredTokenOut,
        address configuredRouter,
        uint24 configuredPoolFee
    ) {
        if (
            configuredController == address(0) ||
            configuredTokenIn.code.length == 0 ||
            configuredTokenOut.code.length == 0 ||
            configuredRouter.code.length == 0
        ) revert InvalidEndpoint(address(0));
        if (configuredTokenIn == configuredTokenOut) revert InvalidPair();
        if (configuredPoolFee == 0 || configuredPoolFee > 1_000_000) {
            revert InvalidPoolFee();
        }

        admin = msg.sender;
        controller = configuredController;
        tokenIn = configuredTokenIn;
        tokenOut = configuredTokenOut;
        router = IUniswapV3SwapRouter02(configuredRouter);
        poolFee = configuredPoolFee;
    }

    modifier onlyController() {
        if (msg.sender != controller) revert UnauthorizedController();
        _;
    }

    function setController(address newController) external {
        if (msg.sender != admin) revert UnauthorizedController();
        if (controllerLocked) revert ControllerLocked();
        if (newController.code.length == 0) revert InvalidEndpoint(newController);
        controller = newController;
        controllerLocked = true;
    }

    modifier nonReentrant() {
        if (reentrancyStatus != 1) revert ReentrantCall();
        reentrancyStatus = 2;
        _;
        reentrancyStatus = 1;
    }

    function swapExactInput(
        address suppliedTokenIn,
        address suppliedTokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external onlyController nonReentrant returns (uint256 amountOut) {
        if (suppliedTokenIn != tokenIn || suppliedTokenOut != tokenOut) {
            revert InvalidPair();
        }

        _safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);
        _safeApprove(tokenIn, address(router), 0);
        _safeApprove(tokenIn, address(router), amountIn);

        amountOut = router.exactInputSingle(
            IUniswapV3SwapRouter02.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: poolFee,
                recipient: msg.sender,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                sqrtPriceLimitX96: 0
            })
        );

        _safeApprove(tokenIn, address(router), 0);
        if (amountOut < minAmountOut) {
            revert InsufficientAmountOut(amountOut, minAmountOut);
        }
    }

    function _safeTransferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    ) private {
        (bool success, bytes memory result) = token.call(
            abi.encodeCall(IERC20Minimal.transferFrom, (from, to, amount))
        );
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert TokenTransferFailed();
        }
    }

    function _safeApprove(address token, address spender, uint256 amount) private {
        (bool success, bytes memory result) = token.call(
            abi.encodeCall(IERC20Minimal.approve, (spender, amount))
        );
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert TokenApprovalFailed();
        }
    }
}
