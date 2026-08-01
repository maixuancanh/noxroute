// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {IBatchSwapRouter} from "./interfaces/IBatchSwapRouter.sol";
import {IERC20Minimal} from "./interfaces/IERC20Minimal.sol";
import {INoxBatchEvaluator} from "./interfaces/INoxBatchEvaluator.sol";
import {
    Nox,
    euint256,
    externalEuint256
} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

contract NoxBatchRouterV2 {
    uint64 public constant MAX_TIMEOUT = 30 days;
    uint8 public constant BATCH_SIZE = 3;
    uint8 public constant MAX_EVALUATION_ATTEMPTS = 3;

    enum EpochStatus {
        None,
        Open,
        Requesting,
        Pending,
        Failed,
        Finalized,
        Settling,
        Settled,
        Cancelled
    }

    struct Epoch {
        uint64 deadline;
        EpochStatus status;
        uint8 intentCount;
        uint8 evaluationAttempts;
        uint64 epoch;
        uint64 requestedAt;
        bytes32 requestId;
        uint128 totalInput;
        uint128 totalOutput;
    }

    address public immutable tokenIn;
    address public immutable tokenOut;
    address public immutable router;
    INoxBatchEvaluator public immutable evaluator;
    uint64 public immutable evaluationTimeout;

    bytes32 public activeEpochId;

    mapping(bytes32 epochId => Epoch epoch) private epochs;
    mapping(bytes32 epochId => bool used) public epochIdUsed;
    mapping(bytes32 epochId => address[3] users) private epochUsers;
    mapping(bytes32 epochId => mapping(address user => uint8 indexPlusOne)) private participantIndexPlusOne;
    mapping(bytes32 epochId => bytes32[3] handles) private amountHandles;
    mapping(bytes32 epochId => bytes32[3] handles) private minOutHandles;
    mapping(bytes32 epochId => bytes[3] proofs) private amountProofs;
    mapping(bytes32 epochId => bytes[3] proofs) private minOutProofs;
    mapping(bytes32 epochId => uint128[3] amounts) private escrowCaps;
    mapping(bytes32 epochId => uint128[3] amounts) private debitAmounts;
    mapping(bytes32 epochId => uint128[3] amounts) private outputAmounts;
    mapping(bytes32 handle => bool used) public handleUsed;
    mapping(bytes32 requestId => bool used) public requestIdUsed;

    uint256 private reentrancyStatus = 1;

    error InvalidEndpoint(address endpoint);
    error InvalidPair();
    error InvalidEvaluationTimeout();
    error InvalidUser(address user);
    error InvalidEpochId();
    error EpochAlreadyUsed();
    error AnotherEpochActive(bytes32 epochId);
    error InvalidDeadline();
    error EpochNotOpen();
    error EpochNotPending();
    error EpochNotFinalized();
    error EpochAlreadySettled();
    error EpochTerminal();
    error IntentAlreadySubmitted();
    error BatchFull();
    error InvalidHandle();
    error DuplicateHandle();
    error InvalidEscrow();
    error IntentBatchIncomplete();
    error EvaluationAttemptLimitReached();
    error EvaluationTimeoutNotReached(uint256 retryAt);
    error RequestIdMismatch(bytes32 supplied, bytes32 expected);
    error RequestEpochMismatch(uint64 supplied, uint64 expected);
    error UnauthorizedEvaluator();
    error InvalidAllocation();
    error RouterSwapFailed();
    error TokenTransferFailed();
    error ReentrantCall();

    event EpochOpened(bytes32 indexed epochId, uint64 deadline);
    event IntentSubmitted(
        bytes32 indexed epochId,
        address indexed user,
        bytes32 amountHandle,
        bytes32 minOutHandle,
        uint128 escrowCap
    );
    event NettingRequested(bytes32 indexed epochId, bytes32 indexed requestId, uint64 indexed epoch, uint8 attempt);
    event NettingRequestFailed(bytes32 indexed epochId, uint64 indexed epoch, uint8 attempt);
    event NettingFinalized(bytes32 indexed epochId, uint128 totalInput, uint128 totalOutput);
    event EpochSettled(bytes32 indexed epochId, uint128 amountIn, uint128 minAmountOut);
    event EpochCancelled(bytes32 indexed epochId, address indexed caller);

    constructor(
        address configuredTokenIn,
        address configuredTokenOut,
        address configuredRouter,
        address configuredEvaluator,
        uint64 configuredEvaluationTimeout
    ) {
        if (configuredTokenIn == configuredTokenOut) revert InvalidPair();
        if (
            configuredTokenIn.code.length == 0 ||
            configuredTokenOut.code.length == 0 ||
            configuredRouter.code.length == 0 ||
            configuredEvaluator.code.length == 0
        ) revert InvalidEndpoint(address(0));
        if (
            configuredEvaluationTimeout == 0 ||
            configuredEvaluationTimeout > MAX_TIMEOUT
        ) revert InvalidEvaluationTimeout();

        tokenIn = configuredTokenIn;
        tokenOut = configuredTokenOut;
        router = configuredRouter;
        evaluator = INoxBatchEvaluator(configuredEvaluator);
        evaluationTimeout = configuredEvaluationTimeout;
    }

    modifier nonReentrant() {
        if (reentrancyStatus != 1) revert ReentrantCall();
        reentrancyStatus = 2;
        _;
        reentrancyStatus = 1;
    }

    function openEpoch(bytes32 epochId, uint64 deadline) external nonReentrant {
        if (activeEpochId != bytes32(0)) revert AnotherEpochActive(activeEpochId);
        if (epochId == bytes32(0)) revert InvalidEpochId();
        if (epochIdUsed[epochId]) revert EpochAlreadyUsed();
        if (deadline <= block.timestamp || deadline > block.timestamp + MAX_TIMEOUT) {
            revert InvalidDeadline();
        }

        epochIdUsed[epochId] = true;
        activeEpochId = epochId;
        epochs[epochId] = Epoch({
            deadline: deadline,
            status: EpochStatus.Open,
            intentCount: 0,
            evaluationAttempts: 0,
            epoch: 0,
            requestedAt: 0,
            requestId: bytes32(0),
            totalInput: 0,
            totalOutput: 0
        });
        emit EpochOpened(epochId, deadline);
    }

    function submitIntent(
        bytes32 epochId,
        bytes32 encryptedAmountHandle,
        bytes32 encryptedMinOutHandle,
        uint128 escrowCap
    ) external nonReentrant {
        uint8 index = _validateIntent(epochId, encryptedAmountHandle, encryptedMinOutHandle, escrowCap);
        _storeIntent(epochId, index, encryptedAmountHandle, encryptedMinOutHandle, escrowCap, "", "");
    }

    function submitIntent(
        bytes32 epochId,
        bytes32 encryptedAmountHandle,
        bytes calldata encryptedAmountProof,
        bytes32 encryptedMinOutHandle,
        bytes calldata encryptedMinOutProof,
        uint128 escrowCap
    ) external nonReentrant {
        uint8 index = _validateIntent(epochId, encryptedAmountHandle, encryptedMinOutHandle, escrowCap);
        euint256 amount = Nox.fromExternal(
            externalEuint256.wrap(encryptedAmountHandle),
            encryptedAmountProof
        );
        euint256 minOut = Nox.fromExternal(
            externalEuint256.wrap(encryptedMinOutHandle),
            encryptedMinOutProof
        );
        Nox.allow(amount, address(evaluator));
        Nox.allow(minOut, address(evaluator));
        _storeIntent(
            epochId,
            index,
            encryptedAmountHandle,
            encryptedMinOutHandle,
            escrowCap,
            encryptedAmountProof,
            encryptedMinOutProof
        );
    }

    function _validateIntent(
        bytes32 epochId,
        bytes32 encryptedAmountHandle,
        bytes32 encryptedMinOutHandle,
        uint128 escrowCap
    ) private view returns (uint8 index) {
        Epoch storage epochState = epochs[epochId];
        if (epochState.status == EpochStatus.Settled || epochState.status == EpochStatus.Cancelled) {
            revert EpochTerminal();
        }
        if (epochState.status != EpochStatus.Open) revert EpochNotOpen();
        if (block.timestamp >= epochState.deadline) revert InvalidDeadline();
        if (epochState.intentCount >= BATCH_SIZE) revert BatchFull();
        if (participantIndexPlusOne[epochId][msg.sender] != 0) revert IntentAlreadySubmitted();
        if (encryptedAmountHandle == bytes32(0) || encryptedMinOutHandle == bytes32(0)) {
            revert InvalidHandle();
        }
        if (encryptedAmountHandle == encryptedMinOutHandle) revert DuplicateHandle();
        if (handleUsed[encryptedAmountHandle] || handleUsed[encryptedMinOutHandle]) {
            revert DuplicateHandle();
        }
        if (escrowCap == 0) revert InvalidEscrow();
        index = epochState.intentCount;
    }

    function _storeIntent(
        bytes32 epochId,
        uint8 index,
        bytes32 encryptedAmountHandle,
        bytes32 encryptedMinOutHandle,
        uint128 escrowCap,
        bytes memory encryptedAmountProof,
        bytes memory encryptedMinOutProof
    ) private {
        Epoch storage epochState = epochs[epochId];
        handleUsed[encryptedAmountHandle] = true;
        handleUsed[encryptedMinOutHandle] = true;
        participantIndexPlusOne[epochId][msg.sender] = index + 1;
        epochUsers[epochId][index] = msg.sender;
        amountHandles[epochId][index] = encryptedAmountHandle;
        minOutHandles[epochId][index] = encryptedMinOutHandle;
        amountProofs[epochId][index] = encryptedAmountProof;
        minOutProofs[epochId][index] = encryptedMinOutProof;
        escrowCaps[epochId][index] = escrowCap;
        epochState.intentCount++;
        _safeTransferFrom(tokenIn, msg.sender, address(this), escrowCap);

        emit IntentSubmitted(epochId, msg.sender, encryptedAmountHandle, encryptedMinOutHandle, escrowCap);
    }

    function requestNetting(bytes32 epochId) external nonReentrant {
        Epoch storage epochState = epochs[epochId];
        if (epochState.status != EpochStatus.Open && epochState.status != EpochStatus.Pending) {
            revert EpochNotOpen();
        }
        if (epochState.intentCount != BATCH_SIZE) revert IntentBatchIncomplete();
        if (epochState.evaluationAttempts >= MAX_EVALUATION_ATTEMPTS) {
            revert EvaluationAttemptLimitReached();
        }
        if (epochState.status == EpochStatus.Pending && !_evaluationTimedOut(epochState)) {
            revert EvaluationTimeoutNotReached(uint256(epochState.requestedAt) + evaluationTimeout);
        }

        epochState.status = EpochStatus.Requesting;
        epochState.epoch++;
        epochState.evaluationAttempts++;
        epochState.requestedAt = uint64(block.timestamp);
        epochState.requestId = bytes32(0);

        bytes32 requestId;
        try evaluator.requestNetting(
            epochId,
            epochState.epoch,
            epochUsers[epochId],
            amountHandles[epochId],
            amountProofs[epochId],
            minOutHandles[epochId],
            minOutProofs[epochId],
            escrowCaps[epochId]
        ) returns (bytes32 returnedRequestId) {
            requestId = returnedRequestId;
        } catch {
            epochState.status = EpochStatus.Pending;
            emit NettingRequestFailed(epochId, epochState.epoch, epochState.evaluationAttempts);
            return;
        }
        if (requestId == bytes32(0) || requestIdUsed[requestId]) {
            epochState.status = EpochStatus.Pending;
            emit NettingRequestFailed(epochId, epochState.epoch, epochState.evaluationAttempts);
            return;
        }

        requestIdUsed[requestId] = true;
        epochState.requestId = requestId;
        epochState.status = EpochStatus.Pending;
        emit NettingRequested(epochId, requestId, epochState.epoch, epochState.evaluationAttempts);
    }

    function finalizeNetting(
        bytes32 epochId,
        bytes32 requestId,
        uint64 epoch,
        uint128 totalInput,
        uint128[3] calldata debits,
        uint128[3] calldata outputs
    ) external nonReentrant {
        if (msg.sender != address(evaluator)) revert UnauthorizedEvaluator();
        Epoch storage epochState = epochs[epochId];
        if (epochState.status != EpochStatus.Pending) revert EpochNotPending();
        if (epoch != epochState.epoch) revert RequestEpochMismatch(epoch, epochState.epoch);
        if (requestId == bytes32(0) || requestId != epochState.requestId) {
            revert RequestIdMismatch(requestId, epochState.requestId);
        }

        uint128 debitSum;
        uint128 outputSum;
        for (uint8 i = 0; i < BATCH_SIZE; i++) {
            if (debits[i] > escrowCaps[epochId][i]) revert InvalidAllocation();
            debitSum += debits[i];
            outputSum += outputs[i];
        }
        if (debitSum == 0 || debitSum != totalInput || outputSum == 0) {
            revert InvalidAllocation();
        }

        debitAmounts[epochId] = debits;
        outputAmounts[epochId] = outputs;
        epochState.totalInput = totalInput;
        epochState.totalOutput = outputSum;
        epochState.status = EpochStatus.Finalized;

        emit NettingFinalized(epochId, totalInput, outputSum);
    }

    function settle(bytes32 epochId, uint128 minAmountOut) external nonReentrant {
        Epoch storage epochState = epochs[epochId];
        if (epochState.status == EpochStatus.Settled) revert EpochAlreadySettled();
        if (epochState.status != EpochStatus.Finalized) revert EpochNotFinalized();
        if (minAmountOut == 0 || minAmountOut > epochState.totalOutput) revert InvalidAllocation();

        epochState.status = EpochStatus.Settling;
        _safeApprove(tokenIn, router, epochState.totalInput);
        uint256 amountOut = IBatchSwapRouter(router).swapExactInput(
            tokenIn,
            tokenOut,
            epochState.totalInput,
            minAmountOut
        );
        if (amountOut < minAmountOut || amountOut < epochState.totalOutput) {
            epochState.status = EpochStatus.Finalized;
            revert RouterSwapFailed();
        }

        for (uint8 i = 0; i < BATCH_SIZE; i++) {
            address user = epochUsers[epochId][i];
            uint128 refund = escrowCaps[epochId][i] - debitAmounts[epochId][i];
            if (refund != 0) _safeTransfer(tokenIn, user, refund);
            if (outputAmounts[epochId][i] != 0) _safeTransfer(tokenOut, user, outputAmounts[epochId][i]);
        }

        epochState.status = EpochStatus.Settled;
        activeEpochId = bytes32(0);
        emit EpochSettled(epochId, epochState.totalInput, minAmountOut);
    }

    function cancelEpoch(bytes32 epochId) external nonReentrant {
        Epoch storage epochState = epochs[epochId];
        if (epochState.status == EpochStatus.Settled || epochState.status == EpochStatus.Cancelled) {
            revert EpochTerminal();
        }
        if (
            epochState.status == EpochStatus.Pending &&
            epochState.evaluationAttempts < MAX_EVALUATION_ATTEMPTS &&
            block.timestamp <= epochState.deadline
        ) revert EvaluationAttemptLimitReached();

        for (uint8 i = 0; i < BATCH_SIZE; i++) {
            uint128 escrow = escrowCaps[epochId][i];
            if (escrow != 0) {
                escrowCaps[epochId][i] = 0;
                _safeTransfer(tokenIn, epochUsers[epochId][i], escrow);
            }
        }
        epochState.status = EpochStatus.Cancelled;
        activeEpochId = bytes32(0);
        emit EpochCancelled(epochId, msg.sender);
    }

    function userAt(bytes32 epochId, uint256 index) external view returns (address) {
        if (index >= BATCH_SIZE) revert InvalidUser(address(0));
        return epochUsers[epochId][index];
    }

    function amountHandle(bytes32 epochId, uint256 index) external view returns (bytes32) {
        if (index >= BATCH_SIZE) revert InvalidUser(address(0));
        return amountHandles[epochId][index];
    }

    function getEpoch(bytes32 epochId) external view returns (Epoch memory) {
        return epochs[epochId];
    }

    function _evaluationTimedOut(Epoch storage epochState) private view returns (bool) {
        return block.timestamp >= epochState.requestedAt && block.timestamp - epochState.requestedAt >= evaluationTimeout;
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool success, bytes memory result) = token.call(abi.encodeCall(IERC20Minimal.transferFrom, (from, to, amount)));
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) revert TokenTransferFailed();
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool success, bytes memory result) = token.call(abi.encodeCall(IERC20Minimal.transfer, (to, amount)));
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) revert TokenTransferFailed();
    }

    function _safeApprove(address token, address spender, uint256 amount) private {
        (bool success, bytes memory result) = token.call(abi.encodeCall(IERC20Minimal.approve, (spender, amount)));
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) revert TokenTransferFailed();
    }
}
