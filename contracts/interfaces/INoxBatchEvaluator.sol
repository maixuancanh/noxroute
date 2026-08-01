// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

interface INoxBatchEvaluator {
    function requestNetting(
        bytes32 epochId,
        uint64 epoch,
        address[3] calldata users,
        bytes32[3] calldata amountHandles,
        bytes[3] calldata amountProofs,
        bytes32[3] calldata minOutHandles,
        bytes[3] calldata minOutProofs,
        uint128[3] calldata escrowCaps
    ) external returns (bytes32 requestId);
}
