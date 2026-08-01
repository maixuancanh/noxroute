// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {ISwapRouter02Minimal} from "../v3/interfaces/ISwapRouter02Minimal.sol";
import {IERC20MetadataMinimal} from "../v3/interfaces/IERC20MetadataMinimal.sol";

interface IMintableToken {
    function mint(address account, uint256 amount) external;
}

contract MockSwapRouter02 is ISwapRouter02Minimal {
    ExactInputSingleParams public lastCall;
    uint256 public callCount;
    uint256 public amountOut;

    function setAmountOut(uint256 value) external {
        amountOut = value;
    }

    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable returns (uint256) {
        require(amountOut >= params.amountOutMinimum, "Too little received");
        require(
            IERC20MetadataMinimal(params.tokenIn).transferFrom(
                msg.sender,
                address(this),
                params.amountIn
            ),
            "input transfer"
        );
        lastCall = params;
        callCount++;
        IMintableToken(params.tokenOut).mint(params.recipient, amountOut);
        return amountOut;
    }
}
