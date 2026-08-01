// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

contract MockUniswapV3Factory {
    mapping(bytes32 key => address pool) private poolByKey;

    function setPool(address tokenA, address tokenB, uint24 fee, address pool) external {
        poolByKey[_key(tokenA, tokenB, fee)] = pool;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        return poolByKey[_key(tokenA, tokenB, fee)];
    }

    function _key(address tokenA, address tokenB, uint24 fee) private pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encode(token0, token1, fee));
    }
}
