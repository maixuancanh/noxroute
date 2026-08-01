// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

library NoxveilTypes {
    enum Direction {
        WETH_TO_USDC,
        USDC_TO_WETH
    }

    struct ActionCommitmentInput {
        uint256 chainId;
        address engine;
        address vault;
        address adapter;
        bytes32 epochId;
        uint32 epochNonce;
        uint64 deadline;
        address weth;
        address usdc;
        address uniswapRouter;
        address uniswapPool;
        uint24 fee;
        uint32 twapWindow;
        uint256 twapPriceWad;
        bytes32 residualDirectionHandle;
        bytes32 residualAmountHandle;
        bytes32 aggregateMinOutHandle;
    }
}

