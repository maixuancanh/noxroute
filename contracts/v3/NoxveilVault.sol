// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {
    Nox,
    ebool,
    euint16,
    euint256
} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {IERC20MetadataMinimal} from "./interfaces/IERC20MetadataMinimal.sol";
import {INoxveilAdapter} from "./interfaces/INoxveilAdapter.sol";

interface INoxveilEngineBinding {
    function vault() external view returns (address);
}

contract NoxveilVault {
    struct FullWithdrawal {
        address owner;
        address token;
        address destination;
        uint64 nonce;
        uint64 deadline;
        bytes32 balanceHandle;
        bool consumed;
    }

    address public immutable weth;
    address public immutable usdc;
    address public immutable bootstrapAdmin;
    address public engine;
    address public adapter;
    bool public bootstrapClosed;

    mapping(address owner => mapping(address token => euint256 balance)) private available;
    mapping(bytes32 epochId => mapping(address owner => mapping(address token => euint256 balance))) private reserved;
    mapping(bytes32 epochId => mapping(address owner => bool created)) public reservationCreated;
    mapping(bytes32 epochId => mapping(address owner => bool processed)) public reservationProcessed;
    mapping(address owner => uint256 count) public activeReservationCount;
    mapping(address owner => mapping(uint64 nonce => bool used)) public withdrawalNonceUsed;
    mapping(address owner => mapping(address token => bytes32 commitment)) public pendingWithdrawal;
    mapping(bytes32 commitment => FullWithdrawal request) private fullWithdrawalByCommitment;

    uint256 private reentrancyStatus = 1;

    error InvalidEndpoint(address endpoint);
    error InvalidPair();
    error UnsupportedToken(address token);
    error OnlyBootstrapAdmin();
    error BootstrapClosed();
    error EngineAlreadySet();
    error AdapterAlreadySet();
    error InvalidEngine(address candidate);
    error InvalidAdapter(address candidate);
    error OnlyEngine();
    error TokenTransferFailed();
    error ReentrantCall();
    error InvalidOwner(address owner);
    error InvalidEpochId();
    error ReservationAlreadyCreated(bytes32 epochId, address owner);
    error UnknownReservation(bytes32 epochId, address owner);
    error ReservationAlreadyProcessed(bytes32 epochId, address owner);
    error ActiveReservation(address owner);
    error InvalidWithdrawalDestination();
    error InvalidWithdrawalDeadline();
    error WithdrawalNonceAlreadyUsed(uint64 nonce);
    error WithdrawalPending(address owner, address token);
    error UnknownWithdrawal(bytes32 commitment);
    error WithdrawalAlreadyConsumed(bytes32 commitment);
    error WithdrawalExpired(uint64 deadline);
    error EmptyWithdrawal();
    error BalanceHandleChanged();

    event EngineBound(address indexed engine);
    event AdapterBound(address indexed adapter);
    event BootstrapPermanentlyClosed();
    event Deposited(address indexed owner, address indexed token);
    event EpochReserved(bytes32 indexed epochId, address indexed owner);
    event EpochReservationReleased(bytes32 indexed epochId, address indexed owner);
    event EpochReservationCommitted(bytes32 indexed epochId, address indexed owner);
    event FullWithdrawalRequested(
        bytes32 indexed commitment,
        address indexed owner,
        address indexed token,
        address destination,
        uint64 nonce,
        uint64 deadline,
        bytes32 balanceHandle
    );
    event FullWithdrawalFinalized(
        bytes32 indexed commitment,
        address indexed owner,
        address indexed token,
        address destination
    );

    constructor(address configuredWeth, address configuredUsdc) {
        if (configuredWeth == configuredUsdc) revert InvalidPair();
        if (configuredWeth.code.length == 0) revert InvalidEndpoint(configuredWeth);
        if (configuredUsdc.code.length == 0) revert InvalidEndpoint(configuredUsdc);
        weth = configuredWeth;
        usdc = configuredUsdc;
        bootstrapAdmin = msg.sender;
    }

    modifier nonReentrant() {
        if (reentrancyStatus != 1) revert ReentrantCall();
        reentrancyStatus = 2;
        _;
        reentrancyStatus = 1;
    }

    modifier onlyEngine() {
        if (msg.sender != engine) revert OnlyEngine();
        _;
    }

    modifier onlyBootstrap() {
        if (msg.sender != bootstrapAdmin) revert OnlyBootstrapAdmin();
        if (bootstrapClosed) revert BootstrapClosed();
        _;
    }

    function setEngine(address candidate) external onlyBootstrap {
        if (engine != address(0)) revert EngineAlreadySet();
        if (candidate.code.length == 0) revert InvalidEngine(candidate);
        try INoxveilEngineBinding(candidate).vault() returns (address reverseVault) {
            if (reverseVault != address(this)) revert InvalidEngine(candidate);
        } catch {
            revert InvalidEngine(candidate);
        }
        engine = candidate;
        emit EngineBound(candidate);
    }

    function setAdapter(address candidate) external onlyBootstrap {
        if (adapter != address(0)) revert AdapterAlreadySet();
        if (candidate.code.length == 0) revert InvalidAdapter(candidate);
        try INoxveilAdapter(candidate).vault() returns (address reverseVault) {
            if (reverseVault != address(this)) revert InvalidAdapter(candidate);
        } catch {
            revert InvalidAdapter(candidate);
        }
        adapter = candidate;
        emit AdapterBound(candidate);
    }

    function closeBootstrap() external onlyBootstrap {
        if (engine == address(0) || adapter == address(0)) revert BootstrapClosed();
        bootstrapClosed = true;
        emit BootstrapPermanentlyClosed();
    }

    function deposit(address token, uint256 amount) external nonReentrant {
        _requireSupportedToken(token);
        if (amount == 0) revert EmptyWithdrawal();
        if (pendingWithdrawal[msg.sender][token] != bytes32(0)) {
            revert WithdrawalPending(msg.sender, token);
        }

        _safeTransferFrom(token, msg.sender, address(this), amount);
        euint256 nextBalance = Nox.add(available[msg.sender][token], Nox.toEuint256(amount));
        available[msg.sender][token] = nextBalance;
        _persist(nextBalance, msg.sender);
        emit Deposited(msg.sender, token);
    }

    function availableHandle(address owner, address token) external view returns (bytes32) {
        _requireSupportedToken(token);
        return euint256.unwrap(available[owner][token]);
    }

    function reservedHandle(bytes32 epochId, address owner, address token) external view returns (bytes32) {
        _requireSupportedToken(token);
        return euint256.unwrap(reserved[epochId][owner][token]);
    }

    function reserveForEpoch(
        bytes32 epochId,
        address owner,
        bytes32 directionHandle,
        bytes32 selectedClipHandle
    ) external onlyEngine returns (bytes32 wethReservedHandle, bytes32 usdcReservedHandle) {
        if (epochId == bytes32(0)) revert InvalidEpochId();
        if (owner == address(0)) revert InvalidOwner(owner);
        if (reservationCreated[epochId][owner]) revert ReservationAlreadyCreated(epochId, owner);
        if (
            pendingWithdrawal[owner][weth] != bytes32(0) ||
            pendingWithdrawal[owner][usdc] != bytes32(0)
        ) revert WithdrawalPending(owner, address(0));

        euint16 direction = euint16.wrap(directionHandle);
        euint256 selectedClip = euint256.wrap(selectedClipHandle);
        euint256 reservedWeth = _reserveTokenForDirection(owner, weth, direction, selectedClip, 0);
        euint256 reservedUsdc = _reserveTokenForDirection(owner, usdc, direction, selectedClip, 1);
        reserved[epochId][owner][weth] = reservedWeth;
        reserved[epochId][owner][usdc] = reservedUsdc;
        _persist(reservedWeth, owner);
        _persist(reservedUsdc, owner);

        reservationCreated[epochId][owner] = true;
        activeReservationCount[owner]++;
        emit EpochReserved(epochId, owner);
        return (euint256.unwrap(reservedWeth), euint256.unwrap(reservedUsdc));
    }

    function releaseEpoch(bytes32 epochId, address owner) external onlyEngine {
        _requireOpenReservation(epochId, owner);
        _releaseToken(epochId, owner, weth);
        _releaseToken(epochId, owner, usdc);
        _finishReservation(epochId, owner);
        emit EpochReservationReleased(epochId, owner);
    }

    function commitEpoch(
        bytes32 epochId,
        address owner,
        bytes32 wethCreditHandle,
        bytes32 usdcCreditHandle
    ) external onlyEngine {
        _requireOpenReservation(epochId, owner);
        _creditAndClear(epochId, owner, weth, euint256.wrap(wethCreditHandle));
        _creditAndClear(epochId, owner, usdc, euint256.wrap(usdcCreditHandle));
        _finishReservation(epochId, owner);
        emit EpochReservationCommitted(epochId, owner);
    }

    function executeResidual(
        uint8 direction,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) external onlyEngine nonReentrant returns (uint256 amountOut) {
        if (adapter == address(0)) revert InvalidAdapter(adapter);
        address tokenIn = direction == 0 ? weth : usdc;
        _safeApprove(tokenIn, adapter, amountIn);
        amountOut = INoxveilAdapter(adapter).executeResidual(direction, amountIn, amountOutMinimum);
        _safeApprove(tokenIn, adapter, 0);
    }

    function requestFullWithdrawal(
        address token,
        address destination,
        uint64 nonce,
        uint64 deadline
    ) external returns (bytes32 commitment) {
        _requireSupportedToken(token);
        if (destination == address(0)) revert InvalidWithdrawalDestination();
        if (deadline <= block.timestamp) revert InvalidWithdrawalDeadline();
        if (withdrawalNonceUsed[msg.sender][nonce]) revert WithdrawalNonceAlreadyUsed(nonce);
        if (activeReservationCount[msg.sender] != 0) {
            revert ActiveReservation(msg.sender);
        }
        if (pendingWithdrawal[msg.sender][token] != bytes32(0)) {
            revert WithdrawalPending(msg.sender, token);
        }

        euint256 balance = available[msg.sender][token];
        if (!Nox.isInitialized(balance)) {
            balance = Nox.toEuint256(0);
            available[msg.sender][token] = balance;
            _persist(balance, msg.sender);
        }
        bytes32 balanceHandle = euint256.unwrap(balance);
        commitment = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                msg.sender,
                token,
                destination,
                nonce,
                deadline,
                balanceHandle
            )
        );
        withdrawalNonceUsed[msg.sender][nonce] = true;
        pendingWithdrawal[msg.sender][token] = commitment;
        fullWithdrawalByCommitment[commitment] = FullWithdrawal({
            owner: msg.sender,
            token: token,
            destination: destination,
            nonce: nonce,
            deadline: deadline,
            balanceHandle: balanceHandle,
            consumed: false
        });
        Nox.allowPublicDecryption(balance);
        emit FullWithdrawalRequested(
            commitment,
            msg.sender,
            token,
            destination,
            nonce,
            deadline,
            balanceHandle
        );
    }

    function finalizeFullWithdrawal(
        bytes32 commitment,
        bytes calldata decryptionProof
    ) external nonReentrant {
        FullWithdrawal storage request = fullWithdrawalByCommitment[commitment];
        if (request.owner == address(0)) revert UnknownWithdrawal(commitment);
        if (request.consumed) revert WithdrawalAlreadyConsumed(commitment);
        if (block.timestamp > request.deadline) revert WithdrawalExpired(request.deadline);
        if (pendingWithdrawal[request.owner][request.token] != commitment) {
            revert UnknownWithdrawal(commitment);
        }
        if (euint256.unwrap(available[request.owner][request.token]) != request.balanceHandle) {
            revert BalanceHandleChanged();
        }

        uint256 amount = Nox.publicDecrypt(euint256.wrap(request.balanceHandle), decryptionProof);
        if (amount == 0) revert EmptyWithdrawal();

        request.consumed = true;
        pendingWithdrawal[request.owner][request.token] = bytes32(0);
        euint256 zero = Nox.toEuint256(0);
        available[request.owner][request.token] = zero;
        _persist(zero, request.owner);
        _safeTransfer(request.token, request.destination, amount);
        emit FullWithdrawalFinalized(
            commitment,
            request.owner,
            request.token,
            request.destination
        );
    }

    function getFullWithdrawal(bytes32 commitment) external view returns (FullWithdrawal memory) {
        return fullWithdrawalByCommitment[commitment];
    }

    function _reserveToken(
        address owner,
        address token,
        euint256 requested
    ) private returns (euint256 reservedAmount) {
        euint256 current = available[owner][token];
        (ebool success, euint256 next) = Nox.safeSub(current, requested);
        euint256 zero = Nox.toEuint256(0);
        reservedAmount = Nox.select(success, requested, zero);
        euint256 nextAvailable = Nox.select(success, next, current);
        available[owner][token] = nextAvailable;
        _persist(nextAvailable, owner);
    }

    function _reserveTokenForDirection(
        address owner,
        address token,
        euint16 direction,
        euint256 selectedClip,
        uint16 expectedDirection
    ) private returns (euint256) {
        ebool isInput = Nox.eq(direction, Nox.toEuint16(expectedDirection));
        euint256 requested = Nox.select(isInput, selectedClip, Nox.toEuint256(0));
        return _reserveToken(owner, token, requested);
    }

    function _releaseToken(bytes32 epochId, address owner, address token) private {
        euint256 next = Nox.add(available[owner][token], reserved[epochId][owner][token]);
        available[owner][token] = next;
        _persist(next, owner);
        _clearReserved(epochId, owner, token);
    }

    function _creditAndClear(
        bytes32 epochId,
        address owner,
        address token,
        euint256 credit
    ) private {
        euint256 next = Nox.add(available[owner][token], credit);
        available[owner][token] = next;
        _persist(next, owner);
        _clearReserved(epochId, owner, token);
    }

    function _clearReserved(bytes32 epochId, address owner, address token) private {
        euint256 zero = Nox.toEuint256(0);
        reserved[epochId][owner][token] = zero;
        _persist(zero, owner);
    }

    function _finishReservation(bytes32 epochId, address owner) private {
        reservationProcessed[epochId][owner] = true;
        activeReservationCount[owner]--;
    }

    function _requireOpenReservation(bytes32 epochId, address owner) private view {
        if (!reservationCreated[epochId][owner]) revert UnknownReservation(epochId, owner);
        if (reservationProcessed[epochId][owner]) revert ReservationAlreadyProcessed(epochId, owner);
    }

    function _persist(euint256 value, address owner) private {
        Nox.allowThis(value);
        Nox.allow(value, owner);
        if (engine != address(0)) Nox.allow(value, engine);
    }

    function _requireSupportedToken(address token) private view {
        if (token != weth && token != usdc) revert UnsupportedToken(token);
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool success, bytes memory result) = token.call(
            abi.encodeCall(IERC20MetadataMinimal.transferFrom, (from, to, amount))
        );
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert TokenTransferFailed();
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool success, bytes memory result) = token.call(
            abi.encodeCall(IERC20MetadataMinimal.transfer, (to, amount))
        );
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert TokenTransferFailed();
        }
    }

    function _safeApprove(address token, address spender, uint256 amount) private {
        (bool success, bytes memory result) = token.call(
            abi.encodeCall(IERC20MetadataMinimal.approve, (spender, amount))
        );
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert TokenTransferFailed();
        }
    }
}
