// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {INoxveilVault} from "../v3/interfaces/INoxveilVault.sol";
import {IERC20MetadataMinimal} from "../v3/interfaces/IERC20MetadataMinimal.sol";

interface IMockMintableToken {
    function mint(address account, uint256 amount) external;
}

contract MockNoxveilAdapter {
    address public immutable vault;
    address public weth;
    address public usdc;
    address public pool;
    address public router;
    uint24 public constant fee = 500;
    uint32 public constant twapWindow = 1_800;
    bool public shouldRevert;
    uint256 public callCount;
    uint256 public configuredAmountOut;

    constructor(address configuredVault) {
        vault = configuredVault;
        weth = INoxveilVault(configuredVault).weth();
        usdc = INoxveilVault(configuredVault).usdc();
    }

    function consultTwap() external pure returns (uint256 priceWad, int24 arithmeticMeanTick) {
        return (2_500e18, 0);
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function setAmountOut(uint256 value) external {
        configuredAmountOut = value;
    }

    function executeResidual(
        uint8 direction,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) external returns (uint256 amountOut) {
        if (shouldRevert) revert("mock swap revert");
        if (amountIn == 0) return 0;
        address tokenIn = direction == 0 ? weth : usdc;
        address tokenOut = direction == 0 ? usdc : weth;
        require(
            IERC20MetadataMinimal(tokenIn).transferFrom(msg.sender, address(this), amountIn),
            "input transfer"
        );
        amountOut = configuredAmountOut == 0 ? amountOutMinimum : configuredAmountOut;
        require(amountOut >= amountOutMinimum, "minimum");
        IMockMintableToken(tokenOut).mint(vault, amountOut);
        callCount++;
    }
}
