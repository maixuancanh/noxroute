import assert from "node:assert/strict";
import { expect } from "chai";
import hre from "hardhat";

const connection = await hre.network.create();
const { ethers } = connection;

const FEE = 500;
const WINDOW = 1_800;
const MAX_DEVIATION_BPS = 100;

function addressLessThan(left: string, right: string) {
  return BigInt(left) < BigInt(right);
}

function tickForWethPrice(wethIsToken0: boolean, price: number) {
  const rawRatio = wethIsToken0 ? (price * 1e6) / 1e18 : 1e18 / (price * 1e6);
  return Math.floor(Math.log(rawRatio) / Math.log(1.0001));
}

describe("NoxveilUniswapV3Adapter", function () {
  async function deployBase() {
    const [admin, outsider] = await ethers.getSigners();
    const weth = await ethers.deployContract("MockERC20Decimals", ["Wrapped Ether", "WETH", 18]);
    const usdc = await ethers.deployContract("MockERC20Decimals", ["USD Coin", "USDC", 6]);
    const vault = await ethers.deployContract("NoxveilVault", [
      await weth.getAddress(),
      await usdc.getAddress(),
    ]);
    const wethAddress = await weth.getAddress();
    const usdcAddress = await usdc.getAddress();
    const wethIsToken0 = addressLessThan(wethAddress, usdcAddress);
    const token0 = wethIsToken0 ? wethAddress : usdcAddress;
    const token1 = wethIsToken0 ? usdcAddress : wethAddress;
    const meanTick = tickForWethPrice(wethIsToken0, 2_500);
    const pool = await ethers.deployContract("MockUniswapV3Pool", [
      token0,
      token1,
      FEE,
      WINDOW,
      meanTick,
      meanTick,
    ]);
    const factory = await ethers.deployContract("MockUniswapV3Factory");
    await factory.setPool(wethAddress, usdcAddress, FEE, await pool.getAddress());
    const router = await ethers.deployContract("MockSwapRouter02");
    return { admin, outsider, weth, usdc, vault, pool, factory, router, meanTick };
  }

  async function deployFixture() {
    const base = await deployBase();
    const adapter = await ethers.deployContract("NoxveilUniswapV3Adapter", [
      await base.vault.getAddress(),
      await base.factory.getAddress(),
      await base.router.getAddress(),
      await base.pool.getAddress(),
      WINDOW,
      MAX_DEVIATION_BPS,
    ]);
    const engine = await ethers.deployContract("MockNoxveilEngine", [await base.vault.getAddress()]);
    await base.vault.setEngine(await engine.getAddress());
    await base.vault.setAdapter(await adapter.getAddress());
    await base.vault.closeBootstrap();
    return { ...base, adapter, engine };
  }

  it("rejects invalid endpoints, factory pools, pairs, and fees", async function () {
    const base = await deployBase();
    await assert.rejects(async () => ethers.deployContract("NoxveilUniswapV3Adapter", [
      await base.vault.getAddress(),
      base.outsider.address,
      await base.router.getAddress(),
      await base.pool.getAddress(),
      WINDOW,
      MAX_DEVIATION_BPS,
    ]));

    const wrongFactory = await ethers.deployContract("MockUniswapV3Factory");
    await assert.rejects(async () => ethers.deployContract("NoxveilUniswapV3Adapter", [
      await base.vault.getAddress(),
      await wrongFactory.getAddress(),
      await base.router.getAddress(),
      await base.pool.getAddress(),
      WINDOW,
      MAX_DEVIATION_BPS,
    ]));

    const other = await ethers.deployContract("MockERC20Decimals", ["Other", "OTHER", 18]);
    const wrongPairPool = await ethers.deployContract("MockUniswapV3Pool", [
      await base.weth.getAddress(),
      await other.getAddress(),
      FEE,
      WINDOW,
      0,
      0,
    ]);
    const wrongPairFactory = await ethers.deployContract("MockUniswapV3Factory");
    await wrongPairFactory.setPool(
      await base.weth.getAddress(),
      await base.usdc.getAddress(),
      FEE,
      await wrongPairPool.getAddress(),
    );
    await assert.rejects(async () => ethers.deployContract("NoxveilUniswapV3Adapter", [
      await base.vault.getAddress(),
      await wrongPairFactory.getAddress(),
      await base.router.getAddress(),
      await wrongPairPool.getAddress(),
      WINDOW,
      MAX_DEVIATION_BPS,
    ]));

    const wrongFeePool = await ethers.deployContract("MockUniswapV3Pool", [
      await base.pool.token0(),
      await base.pool.token1(),
      3_000,
      WINDOW,
      base.meanTick,
      base.meanTick,
    ]);
    const wrongFeeFactory = await ethers.deployContract("MockUniswapV3Factory");
    await wrongFeeFactory.setPool(
      await base.weth.getAddress(),
      await base.usdc.getAddress(),
      FEE,
      await wrongFeePool.getAddress(),
    );
    await assert.rejects(async () => ethers.deployContract("NoxveilUniswapV3Adapter", [
      await base.vault.getAddress(),
      await wrongFeeFactory.getAddress(),
      await base.router.getAddress(),
      await wrongFeePool.getAddress(),
      WINDOW,
      MAX_DEVIATION_BPS,
    ]));
  });

  it("uses observe TWAP, normalizes WETH/USDC decimals, and rounds negative means down", async function () {
    const { adapter, pool } = await deployFixture();
    const [priceWad, meanTick] = await adapter.consultTwap();
    expect(meanTick).to.equal(BigInt(await pool.meanTick()));
    expect(priceWad).to.be.greaterThan(2_499n * 10n ** 18n);
    expect(priceWad).to.be.lessThan(2_501n * 10n ** 18n);

    await pool.setObservation(WINDOW, -1_001, -1_001, -11, 1);
    const [, roundedTick] = await adapter.consultTwap();
    expect(roundedTick).to.equal(-1n);
  });

  it("rejects insufficient history, empty liquidity, and excessive spot deviation", async function () {
    const { adapter, pool, meanTick } = await deployFixture();
    await pool.setMaxHistory(WINDOW - 1);
    await expect(adapter.consultTwap()).to.be.revertedWithCustomError(adapter, "InsufficientHistory");

    await pool.setMaxHistory(WINDOW);
    await pool.setLiquidity(0);
    await expect(adapter.consultTwap()).to.be.revertedWithCustomError(adapter, "InsufficientLiquidity");

    await pool.setLiquidity(1);
    await pool.setSpotTick(meanTick + 1_000);
    await expect(adapter.consultTwap()).to.be.revertedWithCustomError(adapter, "SpotDeviationExceeded");
  });

  it("allows only the vault path and executes the configured exactInputSingle route", async function () {
    const { outsider, weth, usdc, vault, adapter, engine, router } = await deployFixture();
    const amountIn = 10n ** 18n;
    const amountOut = 2_490n * 10n ** 6n;
    await weth.mint(await vault.getAddress(), amountIn);
    await router.setAmountOut(amountOut);

    await expect((adapter.connect(outsider) as typeof adapter).executeResidual(0, amountIn, amountOut - 1n))
      .to.be.revertedWithCustomError(adapter, "OnlyVault");
    await engine.executeResidual(0, amountIn, amountOut - 1n);

    expect(await router.callCount()).to.equal(1n);
    const call = await router.lastCall();
    expect(call.tokenIn).to.equal(await weth.getAddress());
    expect(call.tokenOut).to.equal(await usdc.getAddress());
    expect(call.fee).to.equal(BigInt(FEE));
    expect(call.recipient).to.equal(await vault.getAddress());
    expect(call.amountIn).to.equal(amountIn);
    expect(call.amountOutMinimum).to.equal(amountOut - 1n);
    expect(call.sqrtPriceLimitX96).to.equal(0n);
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(amountOut);
    expect(await weth.allowance(await vault.getAddress(), await adapter.getAddress())).to.equal(0n);
    expect(await weth.allowance(await adapter.getAddress(), await router.getAddress())).to.equal(0n);
  });

  it("does not call the router for a zero residual", async function () {
    const { engine, router } = await deployFixture();
    expect(await engine.executeResidual.staticCall(0, 0, 0)).to.equal(0n);
    await engine.executeResidual(0, 0, 0);
    expect(await router.callCount()).to.equal(0n);
  });
});
