// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {NoxveilTypes} from "./NoxveilTypes.sol";

library NoxveilMath {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant USDC_TO_WAD = 1e12;

    error InvalidPrice();
    error UnsupportedFee(uint24 fee);
    error InvalidSideInput();
    error InvalidAllocation();

    function wethToQuoteWad(uint256 wethWei, uint256 priceWad) internal pure returns (uint256) {
        _requirePrice(priceWad);
        return Math.mulDiv(wethWei, priceWad, WAD);
    }

    function usdcToQuoteWad(uint256 usdcAtoms) internal pure returns (uint256) {
        return Math.mulDiv(usdcAtoms, USDC_TO_WAD, 1);
    }

    function quoteWadToWeth(uint256 quoteWad, uint256 priceWad) internal pure returns (uint256) {
        _requirePrice(priceWad);
        return Math.mulDiv(quoteWad, WAD, priceWad);
    }

    function quoteWadToWethUp(uint256 quoteWad, uint256 priceWad) internal pure returns (uint256) {
        _requirePrice(priceWad);
        return Math.mulDiv(quoteWad, WAD, priceWad, Math.Rounding.Ceil);
    }

    function quoteWadToUsdc(uint256 quoteWad) internal pure returns (uint256) {
        return quoteWad / USDC_TO_WAD;
    }

    function quoteWadToUsdcUp(uint256 quoteWad) internal pure returns (uint256) {
        return Math.mulDiv(quoteWad, 1, USDC_TO_WAD, Math.Rounding.Ceil);
    }

    function residual(
        uint256 wethWei,
        uint256 usdcAtoms,
        uint256 priceWad
    ) internal pure returns (NoxveilTypes.Direction direction, uint256 amountIn, uint256 matchedQuoteWad) {
        uint256 wethQuoteWad = wethToQuoteWad(wethWei, priceWad);
        uint256 usdcQuoteWad = usdcToQuoteWad(usdcAtoms);

        if (wethQuoteWad >= usdcQuoteWad) {
            return (
                NoxveilTypes.Direction.WETH_TO_USDC,
                quoteWadToWeth(wethQuoteWad - usdcQuoteWad, priceWad),
                usdcQuoteWad
            );
        }
        return (
            NoxveilTypes.Direction.USDC_TO_WETH,
            quoteWadToUsdc(usdcQuoteWad - wethQuoteWad),
            wethQuoteWad
        );
    }

    function proRata(
        uint256 totalOutput,
        uint256 userInput,
        uint256 sideInput
    ) internal pure returns (uint256) {
        if (sideInput == 0) revert InvalidSideInput();
        return Math.mulDiv(totalOutput, userInput, sideInput);
    }

    function finalDust(uint256 totalOutput, uint256 allocatedBefore) internal pure returns (uint256) {
        if (allocatedBefore > totalOutput) revert InvalidAllocation();
        return totalOutput - allocatedBefore;
    }

    function validateFee(uint24 fee) internal pure {
        if (fee != 500) revert UnsupportedFee(fee);
    }

    function actionCommitment(
        NoxveilTypes.ActionCommitmentInput memory input
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(input));
    }

    function _requirePrice(uint256 priceWad) private pure {
        if (priceWad == 0) revert InvalidPrice();
    }
}
