// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.35;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20MetadataMinimal} from "./interfaces/IERC20MetadataMinimal.sol";
import {INoxveilVault} from "./interfaces/INoxveilVault.sol";
import {IUniswapV3FactoryMinimal} from "./interfaces/IUniswapV3FactoryMinimal.sol";
import {IUniswapV3PoolMinimal} from "./interfaces/IUniswapV3PoolMinimal.sol";
import {ISwapRouter02Minimal} from "./interfaces/ISwapRouter02Minimal.sol";
import {NoxveilTickMath} from "./libraries/NoxveilTickMath.sol";

contract NoxveilUniswapV3Adapter {
    uint24 public constant fee = 500;
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant USDC_TO_WAD = 1e12;

    address public immutable vault;
    address public immutable factory;
    address public immutable router;
    address public immutable pool;
    address public immutable weth;
    address public immutable usdc;
    uint32 public immutable twapWindow;
    uint16 public immutable maxDeviationBps;

    error InvalidEndpoint(address endpoint);
    error InvalidPool(address expected, address supplied);
    error InvalidPair();
    error InvalidFee(uint24 supplied);
    error InvalidDecimals(uint8 wethDecimals, uint8 usdcDecimals);
    error InvalidTwapWindow();
    error InvalidDeviationLimit(uint16 maxDeviationBps);
    error InsufficientHistory();
    error InsufficientLiquidity();
    error InvalidOraclePrice();
    error SpotDeviationExceeded(uint256 twapPriceWad, uint256 spotPriceWad);
    error OnlyVault();
    error InvalidDirection(uint8 direction);
    error TokenOperationFailed(address token);
    error InsufficientOutput(uint256 amountOut, uint256 minimum);

    constructor(
        address configuredVault,
        address configuredFactory,
        address configuredRouter,
        address configuredPool,
        uint32 configuredTwapWindow,
        uint16 configuredMaxDeviationBps
    ) {
        _requireCode(configuredVault);
        _requireCode(configuredFactory);
        _requireCode(configuredRouter);
        _requireCode(configuredPool);
        if (configuredTwapWindow == 0) revert InvalidTwapWindow();
        if (configuredMaxDeviationBps == 0 || configuredMaxDeviationBps > BPS_DENOMINATOR) {
            revert InvalidDeviationLimit(configuredMaxDeviationBps);
        }

        address configuredWeth = INoxveilVault(configuredVault).weth();
        address configuredUsdc = INoxveilVault(configuredVault).usdc();
        address factoryPool = IUniswapV3FactoryMinimal(configuredFactory).getPool(
            configuredWeth,
            configuredUsdc,
            fee
        );
        if (factoryPool != configuredPool) revert InvalidPool(factoryPool, configuredPool);

        IUniswapV3PoolMinimal candidate = IUniswapV3PoolMinimal(configuredPool);
        address expectedToken0 = configuredWeth < configuredUsdc ? configuredWeth : configuredUsdc;
        address expectedToken1 = configuredWeth < configuredUsdc ? configuredUsdc : configuredWeth;
        if (candidate.token0() != expectedToken0 || candidate.token1() != expectedToken1) {
            revert InvalidPair();
        }
        if (candidate.fee() != fee) revert InvalidFee(candidate.fee());
        uint8 wethDecimals = IERC20MetadataMinimal(configuredWeth).decimals();
        uint8 usdcDecimals = IERC20MetadataMinimal(configuredUsdc).decimals();
        if (wethDecimals != 18 || usdcDecimals != 6) {
            revert InvalidDecimals(wethDecimals, usdcDecimals);
        }

        vault = configuredVault;
        factory = configuredFactory;
        router = configuredRouter;
        pool = configuredPool;
        weth = configuredWeth;
        usdc = configuredUsdc;
        twapWindow = configuredTwapWindow;
        maxDeviationBps = configuredMaxDeviationBps;
    }

    function consultTwap() external view returns (uint256 priceWad, int24 arithmeticMeanTick) {
        if (IUniswapV3PoolMinimal(pool).liquidity() == 0) revert InsufficientLiquidity();
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapWindow;
        secondsAgos[1] = 0;

        int56[] memory tickCumulatives;
        try IUniswapV3PoolMinimal(pool).observe(secondsAgos) returns (
            int56[] memory observedTicks,
            uint160[] memory
        ) {
            if (observedTicks.length != 2) revert InsufficientHistory();
            tickCumulatives = observedTicks;
        } catch {
            revert InsufficientHistory();
        }

        int56 tickDelta = tickCumulatives[1] - tickCumulatives[0];
        int56 window = int56(uint56(twapWindow));
        arithmeticMeanTick = int24(tickDelta / window);
        if (tickDelta < 0 && tickDelta % window != 0) arithmeticMeanTick--;

        priceWad = _priceWadAtTick(arithmeticMeanTick);
        (, int24 spotTick,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        uint256 spotPriceWad = _priceWadAtTick(spotTick);
        if (priceWad == 0 || spotPriceWad == 0) revert InvalidOraclePrice();
        uint256 absoluteDifference = spotPriceWad > priceWad
            ? spotPriceWad - priceWad
            : priceWad - spotPriceWad;
        uint256 deviationBps = Math.mulDiv(absoluteDifference, BPS_DENOMINATOR, priceWad);
        if (deviationBps > maxDeviationBps) {
            revert SpotDeviationExceeded(priceWad, spotPriceWad);
        }
    }

    function executeResidual(
        uint8 direction,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) external returns (uint256 amountOut) {
        if (msg.sender != vault) revert OnlyVault();
        if (direction > 1) revert InvalidDirection(direction);
        if (amountIn == 0) return 0;

        address tokenIn = direction == 0 ? weth : usdc;
        address tokenOut = direction == 0 ? usdc : weth;
        _safeTransferFrom(tokenIn, vault, address(this), amountIn);
        _safeApprove(tokenIn, router, amountIn);
        amountOut = ISwapRouter02Minimal(router).exactInputSingle(
            ISwapRouter02Minimal.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: vault,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: 0
            })
        );
        _safeApprove(tokenIn, router, 0);
        if (amountOut < amountOutMinimum) revert InsufficientOutput(amountOut, amountOutMinimum);
    }

    function _priceWadAtTick(int24 tick) private view returns (uint256) {
        uint160 sqrtRatioX96 = NoxveilTickMath.getSqrtRatioAtTick(tick);
        uint256 quoteAtoms;
        if (sqrtRatioX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtRatioX96) * sqrtRatioX96;
            quoteAtoms = weth < usdc
                ? Math.mulDiv(ratioX192, 1e18, 1 << 192)
                : Math.mulDiv(1 << 192, 1e18, ratioX192);
        } else {
            uint256 ratioX128 = Math.mulDiv(sqrtRatioX96, sqrtRatioX96, 1 << 64);
            quoteAtoms = weth < usdc
                ? Math.mulDiv(ratioX128, 1e18, 1 << 128)
                : Math.mulDiv(1 << 128, 1e18, ratioX128);
        }
        return Math.mulDiv(quoteAtoms, USDC_TO_WAD, 1);
    }

    function _requireCode(address endpoint) private view {
        if (endpoint.code.length == 0) revert InvalidEndpoint(endpoint);
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool success, bytes memory result) = token.call(
            abi.encodeCall(IERC20MetadataMinimal.transferFrom, (from, to, amount))
        );
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert TokenOperationFailed(token);
        }
    }

    function _safeApprove(address token, address spender, uint256 amount) private {
        (bool success, bytes memory result) = token.call(
            abi.encodeCall(IERC20MetadataMinimal.approve, (spender, amount))
        );
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert TokenOperationFailed(token);
        }
    }
}
