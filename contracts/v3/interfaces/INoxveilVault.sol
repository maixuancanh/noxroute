// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

interface INoxveilVault {
    function weth() external view returns (address);
    function usdc() external view returns (address);
    function engine() external view returns (address);
    function adapter() external view returns (address);
    function availableHandle(address owner, address token) external view returns (bytes32);
    function reserveForEpoch(
        bytes32 epochId,
        address owner,
        bytes32 directionHandle,
        bytes32 selectedClipHandle
    ) external returns (bytes32 wethReservedHandle, bytes32 usdcReservedHandle);
    function commitEpoch(
        bytes32 epochId,
        address owner,
        bytes32 wethCreditHandle,
        bytes32 usdcCreditHandle
    ) external;
    function releaseEpoch(bytes32 epochId, address owner) external;
    function executeResidual(
        uint8 direction,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) external returns (uint256 amountOut);
}

