// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {NoxveilEpochState} from "../v3/NoxveilEpochState.sol";

contract NoxveilEpochStateHarness is NoxveilEpochState {
    error SimulatedSettlementFailure();

    function openEpoch(bytes32 epochId, uint64 deadline, uint32 participants) external {
        _openEpoch(epochId, deadline, participants);
    }

    function lockEpoch(
        bytes32 epochId,
        uint256 twapPriceWad,
        bytes32 actionCommitment,
        bytes32 directionHandle,
        bytes32 amountHandle,
        bytes32 minimumHandle
    ) external {
        _lockEpoch(
            epochId,
            twapPriceWad,
            actionCommitment,
            directionHandle,
            amountHandle,
            minimumHandle
        );
    }

    function readyEpoch(
        bytes32 epochId,
        bytes32 suppliedCommitment,
        uint256 residualAmount,
        uint256 amountOutMinimum
    ) external {
        _markEpochReady(epochId, suppliedCommitment, 0, residualAmount, amountOutMinimum);
    }

    function beginSettlement(bytes32 epochId, bytes32 suppliedCommitment) external {
        _beginSettlement(epochId, suppliedCommitment);
    }

    function completeSettlement(bytes32 epochId, uint256 amountOut) external {
        _completeSettlement(epochId, amountOut);
    }

    function attemptSettlementAndRevert(bytes32 epochId, bytes32 suppliedCommitment) external {
        _beginSettlement(epochId, suppliedCommitment);
        revert SimulatedSettlementFailure();
    }

    function cancelEpoch(bytes32 epochId) external {
        _cancelEpoch(epochId);
    }
}
