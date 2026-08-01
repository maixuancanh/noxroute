// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

interface IUniswapV3FactoryMinimal {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

