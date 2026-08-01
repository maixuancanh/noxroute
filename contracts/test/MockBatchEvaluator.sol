// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {INoxBatchEvaluator} from "../interfaces/INoxBatchEvaluator.sol";

interface INoxBatchRouterCallback {
    function finalizeNetting(
        bytes32 epochId,
        bytes32 requestId,
        uint64 epoch,
        uint128 totalInput,
        uint128[3] calldata debits,
        uint128[3] calldata outputs
    ) external;
}

contract MockBatchEvaluator is INoxBatchEvaluator {
    bytes32 public nextRequestId;
    bool public reverting;

    function setNextRequestId(bytes32 requestId) external {
        nextRequestId = requestId;
    }

    function setReverting(bool enabled) external {
        reverting = enabled;
    }

    function requestNetting(
        bytes32,
        uint64,
        address[3] calldata,
        bytes32[3] calldata,
        bytes[3] calldata,
        bytes32[3] calldata,
        bytes[3] calldata,
        uint128[3] calldata
    ) external view returns (bytes32) {
        if (reverting) revert("evaluator down");
        return nextRequestId;
    }

    function finalize(
        address batchRouter,
        bytes32 epochId,
        bytes32 requestId,
        uint64 epoch,
        uint128 totalInput,
        uint128[3] calldata debits,
        uint128[3] calldata outputs
    ) external {
        INoxBatchRouterCallback(batchRouter).finalizeNetting(
            epochId,
            requestId,
            epoch,
            totalInput,
            debits,
            outputs
        );
    }
}
