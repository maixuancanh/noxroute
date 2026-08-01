// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {
    Nox,
    euint256
} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {INoxBatchEvaluator} from "./interfaces/INoxBatchEvaluator.sol";

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

contract NoxBatchEvaluator is INoxBatchEvaluator {
    struct Request {
        address router;
        bytes32 epochId;
        uint64 epoch;
        bytes32[3] debitHandles;
        bytes32[3] outputHandles;
    }

    uint256 public nonce;
    mapping(bytes32 requestId => Request request) public requests;

    event BatchNettingRequested(
        bytes32 indexed epochId,
        bytes32 indexed requestId,
        bytes32 firstDebitHandle
    );

    error InvalidAllocation(uint256 value);
    error MinOutNotMet(uint256 output, uint256 minimum);
    error UnknownRequest(bytes32 requestId);

    function requestNetting(
        bytes32 epochId,
        uint64 epoch,
        address[3] calldata users,
        bytes32[3] calldata amountHandles,
        bytes[3] calldata amountProofs,
        bytes32[3] calldata minOutHandles,
        bytes[3] calldata minOutProofs,
        uint128[3] calldata escrowCaps
    ) external returns (bytes32 requestId) {
        users;
        amountProofs;
        minOutHandles;
        minOutProofs;
        escrowCaps;

        bytes32[3] memory outputHandles;
        for (uint256 i; i < amountHandles.length; ++i) {
            euint256 output = Nox.mul(
                euint256.wrap(amountHandles[i]),
                Nox.toEuint256(2)
            );
            Nox.allowPublicDecryption(euint256.wrap(amountHandles[i]));
            Nox.allowPublicDecryption(output);
            outputHandles[i] = euint256.unwrap(output);
        }

        nonce++;
        requestId = keccak256(
            abi.encodePacked(block.chainid, address(this), msg.sender, nonce)
        );
        requests[requestId] = Request({
            router: msg.sender,
            epochId: epochId,
            epoch: epoch,
            debitHandles: amountHandles,
            outputHandles: outputHandles
        });
        emit BatchNettingRequested(epochId, requestId, amountHandles[0]);
    }

    function resultHandlesOf(
        bytes32 requestId
    ) external view returns (bytes32[3] memory debits, bytes32[3] memory outputs) {
        Request memory request = requests[requestId];
        return (request.debitHandles, request.outputHandles);
    }

    function deliverNetting(
        bytes32 requestId,
        bytes[3] calldata debitProofs,
        bytes[3] calldata outputProofs
    ) external {
        Request memory request = requests[requestId];
        if (request.router == address(0)) revert UnknownRequest(requestId);

        uint128[3] memory debits;
        uint128[3] memory outputs;
        uint256 totalInput;
        for (uint256 i; i < 3; ++i) {
            uint256 debit = Nox.publicDecrypt(
                euint256.wrap(request.debitHandles[i]),
                debitProofs[i]
            );
            uint256 output = Nox.publicDecrypt(
                euint256.wrap(request.outputHandles[i]),
                outputProofs[i]
            );
            if (debit == 0 || debit > type(uint128).max) {
                revert InvalidAllocation(debit);
            }
            if (output == 0 || output > type(uint128).max) {
                revert InvalidAllocation(output);
            }
            debits[i] = uint128(debit);
            outputs[i] = uint128(output);
            totalInput += debit;
        }
        if (totalInput > type(uint128).max) revert InvalidAllocation(totalInput);
        INoxBatchRouterCallback(request.router).finalizeNetting(
            request.epochId,
            requestId,
            request.epoch,
            uint128(totalInput),
            debits,
            outputs
        );
    }
}
