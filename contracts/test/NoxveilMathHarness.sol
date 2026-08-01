// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {NoxveilMath} from "../v3/libraries/NoxveilMath.sol";
import {NoxveilTypes} from "../v3/libraries/NoxveilTypes.sol";

contract NoxveilMathHarness {
    function wethToQuoteWad(uint256 wethWei, uint256 priceWad) external pure returns (uint256) {
        return NoxveilMath.wethToQuoteWad(wethWei, priceWad);
    }

    function usdcToQuoteWad(uint256 usdcAtoms) external pure returns (uint256) {
        return NoxveilMath.usdcToQuoteWad(usdcAtoms);
    }

    function quoteWadToWeth(uint256 quoteWad, uint256 priceWad) external pure returns (uint256) {
        return NoxveilMath.quoteWadToWeth(quoteWad, priceWad);
    }

    function quoteWadToWethUp(uint256 quoteWad, uint256 priceWad) external pure returns (uint256) {
        return NoxveilMath.quoteWadToWethUp(quoteWad, priceWad);
    }

    function quoteWadToUsdc(uint256 quoteWad) external pure returns (uint256) {
        return NoxveilMath.quoteWadToUsdc(quoteWad);
    }

    function quoteWadToUsdcUp(uint256 quoteWad) external pure returns (uint256) {
        return NoxveilMath.quoteWadToUsdcUp(quoteWad);
    }

    function residual(
        uint256 wethWei,
        uint256 usdcAtoms,
        uint256 priceWad
    ) external pure returns (NoxveilTypes.Direction direction, uint256 amountIn, uint256 matchedQuoteWad) {
        return NoxveilMath.residual(wethWei, usdcAtoms, priceWad);
    }

    function proRata(uint256 totalOutput, uint256 userInput, uint256 sideInput) external pure returns (uint256) {
        return NoxveilMath.proRata(totalOutput, userInput, sideInput);
    }

    function finalDust(uint256 totalOutput, uint256 allocatedBefore) external pure returns (uint256) {
        return NoxveilMath.finalDust(totalOutput, allocatedBefore);
    }

    function validateFee(uint24 fee) external pure {
        NoxveilMath.validateFee(fee);
    }

    function actionCommitment(
        NoxveilTypes.ActionCommitmentInput calldata input
    ) external pure returns (bytes32) {
        return NoxveilMath.actionCommitment(input);
    }
}

