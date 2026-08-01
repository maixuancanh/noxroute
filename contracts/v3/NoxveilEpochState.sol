// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

abstract contract NoxveilEpochState {
    uint32 internal constant MAX_EPOCH_PARTICIPANTS = 8;

    enum EpochStatus {
        None,
        Open,
        Locked,
        Ready,
        Settling,
        Settled,
        Cancelled
    }

    struct EpochPublic {
        uint64 openedAt;
        uint64 lockedAt;
        uint64 deadline;
        uint32 participantCount;
        uint32 epochNonce;
        EpochStatus status;
        uint256 twapPriceWad;
        bytes32 actionCommitment;
        bytes32 residualDirectionHandle;
        bytes32 residualAmountHandle;
        bytes32 aggregateMinOutHandle;
        uint8 residualDirection;
        uint256 residualAmount;
        uint256 amountOutMinimum;
        uint256 amountOut;
    }

    uint32 private nextEpochNonce;
    mapping(bytes32 epochId => EpochPublic epoch) private epochById;
    mapping(bytes32 epochId => bool used) public epochIdUsed;

    error InvalidEpochId();
    error EpochAlreadyUsed(bytes32 epochId);
    error InvalidEpochDeadline(uint64 deadline);
    error InvalidParticipantCount(uint32 participantCount);
    error InvalidEpochStatus(bytes32 epochId, EpochStatus actual, EpochStatus expected);
    error InvalidEpochLock();
    error ActionCommitmentMismatch(bytes32 supplied, bytes32 expected);
    error EpochDeadlineNotReached(uint64 deadline);
    error EpochDeadlinePassed(uint64 deadline);
    error InvalidSettlementOutput(uint256 amountOut, uint256 minimum);

    event EpochOpened(bytes32 indexed epochId, uint32 indexed epochNonce, uint64 deadline, uint32 participantCount);
    event EpochLocked(
        bytes32 indexed epochId,
        uint32 indexed epochNonce,
        uint256 twapPriceWad,
        bytes32 actionCommitment,
        bytes32 residualDirectionHandle,
        bytes32 residualAmountHandle,
        bytes32 aggregateMinOutHandle
    );
    event EpochReady(bytes32 indexed epochId, uint256 residualAmount, uint256 amountOutMinimum);
    event EpochSettled(bytes32 indexed epochId, uint256 residualAmount, uint256 amountOut);
    event EpochCancelled(bytes32 indexed epochId);

    function getEpoch(bytes32 epochId) public view returns (EpochPublic memory) {
        return epochById[epochId];
    }

    function _openEpoch(bytes32 epochId, uint64 deadline, uint32 participantCount) internal {
        if (epochId == bytes32(0)) revert InvalidEpochId();
        if (epochIdUsed[epochId]) revert EpochAlreadyUsed(epochId);
        if (deadline <= block.timestamp) revert InvalidEpochDeadline(deadline);
        if (participantCount == 0 || participantCount > MAX_EPOCH_PARTICIPANTS) {
            revert InvalidParticipantCount(participantCount);
        }

        uint32 epochNonce = ++nextEpochNonce;
        epochIdUsed[epochId] = true;
        epochById[epochId] = EpochPublic({
            openedAt: uint64(block.timestamp),
            lockedAt: 0,
            deadline: deadline,
            participantCount: participantCount,
            epochNonce: epochNonce,
            status: EpochStatus.Open,
            twapPriceWad: 0,
            actionCommitment: bytes32(0),
            residualDirectionHandle: bytes32(0),
            residualAmountHandle: bytes32(0),
            aggregateMinOutHandle: bytes32(0),
            residualDirection: 0,
            residualAmount: 0,
            amountOutMinimum: 0,
            amountOut: 0
        });
        emit EpochOpened(epochId, epochNonce, deadline, participantCount);
    }

    function _lockEpoch(
        bytes32 epochId,
        uint256 twapPriceWad,
        bytes32 actionCommitment,
        bytes32 residualDirectionHandle,
        bytes32 residualAmountHandle,
        bytes32 aggregateMinOutHandle
    ) internal {
        EpochPublic storage epoch = epochById[epochId];
        _requireStatus(epochId, epoch.status, EpochStatus.Open);
        if (block.timestamp >= epoch.deadline) revert EpochDeadlinePassed(epoch.deadline);
        if (
            twapPriceWad == 0 ||
            actionCommitment == bytes32(0) ||
            residualDirectionHandle == bytes32(0) ||
            residualAmountHandle == bytes32(0) ||
            aggregateMinOutHandle == bytes32(0)
        ) revert InvalidEpochLock();

        epoch.lockedAt = uint64(block.timestamp);
        epoch.twapPriceWad = twapPriceWad;
        epoch.actionCommitment = actionCommitment;
        epoch.residualDirectionHandle = residualDirectionHandle;
        epoch.residualAmountHandle = residualAmountHandle;
        epoch.aggregateMinOutHandle = aggregateMinOutHandle;
        epoch.status = EpochStatus.Locked;
        emit EpochLocked(
            epochId,
            epoch.epochNonce,
            twapPriceWad,
            actionCommitment,
            residualDirectionHandle,
            residualAmountHandle,
            aggregateMinOutHandle
        );
    }

    function _markEpochReady(
        bytes32 epochId,
        bytes32 suppliedCommitment,
        uint8 residualDirection,
        uint256 residualAmount,
        uint256 amountOutMinimum
    ) internal {
        EpochPublic storage epoch = epochById[epochId];
        _requireStatus(epochId, epoch.status, EpochStatus.Locked);
        _requireCommitment(suppliedCommitment, epoch.actionCommitment);
        if (block.timestamp >= epoch.deadline) revert EpochDeadlinePassed(epoch.deadline);
        if (residualDirection > 1) revert InvalidSettlementOutput(residualDirection, 1);
        if (residualAmount != 0 && amountOutMinimum == 0) {
            revert InvalidSettlementOutput(0, amountOutMinimum);
        }

        epoch.residualDirection = residualDirection;
        epoch.residualAmount = residualAmount;
        epoch.amountOutMinimum = amountOutMinimum;
        epoch.status = EpochStatus.Ready;
        emit EpochReady(epochId, residualAmount, amountOutMinimum);
    }

    function _beginSettlement(bytes32 epochId, bytes32 suppliedCommitment) internal {
        EpochPublic storage epoch = epochById[epochId];
        _requireStatus(epochId, epoch.status, EpochStatus.Ready);
        _requireCommitment(suppliedCommitment, epoch.actionCommitment);
        if (block.timestamp >= epoch.deadline) revert EpochDeadlinePassed(epoch.deadline);
        epoch.status = EpochStatus.Settling;
    }

    function _completeSettlement(bytes32 epochId, uint256 amountOut) internal {
        EpochPublic storage epoch = epochById[epochId];
        _requireStatus(epochId, epoch.status, EpochStatus.Settling);
        if (epoch.residualAmount != 0 && amountOut < epoch.amountOutMinimum) {
            revert InvalidSettlementOutput(amountOut, epoch.amountOutMinimum);
        }
        epoch.amountOut = amountOut;
        epoch.status = EpochStatus.Settled;
        emit EpochSettled(epochId, epoch.residualAmount, amountOut);
    }

    function _cancelEpoch(bytes32 epochId) internal {
        EpochPublic storage epoch = epochById[epochId];
        if (
            epoch.status != EpochStatus.Open &&
            epoch.status != EpochStatus.Locked &&
            epoch.status != EpochStatus.Ready
        ) {
            revert InvalidEpochStatus(epochId, epoch.status, EpochStatus.Open);
        }
        if (block.timestamp <= epoch.deadline) revert EpochDeadlineNotReached(epoch.deadline);
        epoch.status = EpochStatus.Cancelled;
        emit EpochCancelled(epochId);
    }

    function _requireStatus(bytes32 epochId, EpochStatus actual, EpochStatus expected) private pure {
        if (actual != expected) revert InvalidEpochStatus(epochId, actual, expected);
    }

    function _requireCommitment(bytes32 supplied, bytes32 expected) private pure {
        if (supplied != expected) revert ActionCommitmentMismatch(supplied, expected);
    }
}
