import { expect } from "chai";
import hre from "hardhat";

const { ethers } = await hre.network.create();

const WAD = 10n ** 18n;
const USDC = 10n ** 6n;
const PRICE = 2_500n * WAD;

describe("NoxveilMath V3", function () {
  async function deployHarness() {
    return ethers.deployContract("NoxveilMathHarness");
  }

  it("converts WETH and USDC atomic amounts through quote WAD without decimal drift", async function () {
    const math = await deployHarness();

    expect(await math.wethToQuoteWad(WAD, PRICE)).to.equal(2_500n * WAD);
    expect(await math.usdcToQuoteWad(2_500n * USDC)).to.equal(2_500n * WAD);
    expect(await math.quoteWadToWeth(2_500n * WAD, PRICE)).to.equal(WAD);
    expect(await math.quoteWadToUsdc(2_500n * WAD)).to.equal(2_500n * USDC);
  });

  it("returns a WETH residual when WETH quote volume exceeds USDC quote volume", async function () {
    const math = await deployHarness();
    const [direction, amountIn, matchedQuoteWad] = await math.residual(
      2n * WAD,
      3_000n * USDC,
      PRICE,
    );

    expect(direction).to.equal(0n);
    expect(amountIn).to.equal(8n * 10n ** 17n);
    expect(matchedQuoteWad).to.equal(3_000n * WAD);
  });

  it("returns a USDC residual when USDC quote volume exceeds WETH quote volume", async function () {
    const math = await deployHarness();
    const [direction, amountIn, matchedQuoteWad] = await math.residual(
      2n * WAD,
      6_000n * USDC,
      PRICE,
    );

    expect(direction).to.equal(1n);
    expect(amountIn).to.equal(1_000n * USDC);
    expect(matchedQuoteWad).to.equal(5_000n * WAD);
  });

  it("returns zero residual for exactly offsetting flow", async function () {
    const math = await deployHarness();
    const [, amountIn, matchedQuoteWad] = await math.residual(
      WAD,
      2_500n * USDC,
      PRICE,
    );

    expect(amountIn).to.equal(0n);
    expect(matchedQuoteWad).to.equal(2_500n * WAD);
  });

  it("rounds residual input down and amountOutMinimum up conservatively", async function () {
    const math = await deployHarness();

    expect(await math.quoteWadToWeth(WAD, 3n * WAD)).to.equal(333_333_333_333_333_333n);
    expect(await math.quoteWadToWethUp(WAD, 3n * WAD)).to.equal(333_333_333_333_333_334n);
    expect(await math.quoteWadToUsdc(WAD + 999_999_999_999n)).to.equal(1_000_000n);
    expect(await math.quoteWadToUsdcUp(WAD + 999_999_999_999n)).to.equal(1_000_001n);
  });

  it("computes pro-rata output and assigns deterministic final dust", async function () {
    const math = await deployHarness();

    const first = await math.proRata(10, 1, 3);
    const second = await math.proRata(10, 1, 3);
    const last = await math.finalDust(10, first + second);
    expect([first, second, last]).to.deep.equal([3n, 3n, 4n]);
  });

  it("rejects price zero, unsupported fee, division by zero, and arithmetic overflow", async function () {
    const math = await deployHarness();

    await expect(math.wethToQuoteWad(WAD, 0)).to.be.revertedWithCustomError(math, "InvalidPrice");
    await expect(math.quoteWadToWeth(WAD, 0)).to.be.revertedWithCustomError(math, "InvalidPrice");
    await expect(math.validateFee(123)).to.be.revertedWithCustomError(math, "UnsupportedFee");
    await expect(math.proRata(10, 1, 0)).to.be.revertedWithCustomError(math, "InvalidSideInput");
    await expect(math.usdcToQuoteWad(ethers.MaxUint256)).to.revert(ethers);
  });

  it("changes the action commitment when any bound field changes", async function () {
    const math = await deployHarness();
    const addresses = await ethers.getSigners();
    const base = {
      chainId: 11155111n,
      engine: addresses[0].address,
      vault: addresses[1].address,
      adapter: addresses[2].address,
      epochId: ethers.id("epoch-1"),
      epochNonce: 1,
      deadline: 2_000_000_000,
      weth: addresses[3].address,
      usdc: addresses[4].address,
      uniswapRouter: addresses[5].address,
      uniswapPool: addresses[6].address,
      fee: 500,
      twapWindow: 300,
      twapPriceWad: PRICE,
      residualDirectionHandle: ethers.id("direction"),
      residualAmountHandle: ethers.id("amount"),
      aggregateMinOutHandle: ethers.id("minimum"),
    };
    const initial = await math.actionCommitment(base);
    const variants = [
      { chainId: 1n },
      { engine: addresses[7].address },
      { vault: addresses[7].address },
      { adapter: addresses[7].address },
      { epochId: ethers.id("epoch-2") },
      { epochNonce: 2 },
      { deadline: 2_000_000_001 },
      { weth: addresses[7].address },
      { usdc: addresses[7].address },
      { uniswapRouter: addresses[7].address },
      { uniswapPool: addresses[7].address },
      { fee: 3000 },
      { twapWindow: 600 },
      { twapPriceWad: PRICE + 1n },
      { residualDirectionHandle: ethers.id("direction-2") },
      { residualAmountHandle: ethers.id("amount-2") },
      { aggregateMinOutHandle: ethers.id("minimum-2") },
    ];

    for (const variant of variants) {
      expect(await math.actionCommitment({ ...base, ...variant })).to.not.equal(initial);
    }
  });
});
