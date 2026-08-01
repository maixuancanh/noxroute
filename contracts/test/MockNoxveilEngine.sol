// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {
    Nox,
    euint16,
    euint256,
    externalEuint16,
    externalEuint256
} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {INoxveilVault} from "../v3/interfaces/INoxveilVault.sol";

contract MockNoxveilEngine {
    address public immutable vault;

    constructor(address configuredVault) {
        vault = configuredVault;
    }

    function reserveForEpoch(
        bytes32 epochId,
        address owner,
        externalEuint16 directionHandle,
        bytes calldata directionProof,
        externalEuint256 clipHandle,
        bytes calldata clipProof
    ) external returns (bytes32 wethReservedHandle, bytes32 usdcReservedHandle) {
        euint16 direction = Nox.fromExternal(directionHandle, directionProof);
        euint256 clip = Nox.fromExternal(clipHandle, clipProof);
        Nox.allowTransient(direction, vault);
        Nox.allowTransient(clip, vault);
        return INoxveilVault(vault).reserveForEpoch(
            epochId,
            owner,
            euint16.unwrap(direction),
            euint256.unwrap(clip)
        );
    }

    function releaseEpoch(bytes32 epochId, address owner) external {
        INoxveilVault(vault).releaseEpoch(epochId, owner);
    }

    function executeResidual(
        uint8 direction,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) external returns (uint256) {
        return INoxveilVault(vault).executeResidual(direction, amountIn, amountOutMinimum);
    }

    function commitEpoch(
        bytes32 epochId,
        address owner,
        externalEuint256 wethCreditHandle,
        bytes calldata wethCreditProof,
        externalEuint256 usdcCreditHandle,
        bytes calldata usdcCreditProof
    ) external {
        euint256 wethCredit = Nox.fromExternal(wethCreditHandle, wethCreditProof);
        euint256 usdcCredit = Nox.fromExternal(usdcCreditHandle, usdcCreditProof);
        Nox.allowTransient(wethCredit, vault);
        Nox.allowTransient(usdcCredit, vault);
        INoxveilVault(vault).commitEpoch(
            epochId,
            owner,
            euint256.unwrap(wethCredit),
            euint256.unwrap(usdcCredit)
        );
    }
}
