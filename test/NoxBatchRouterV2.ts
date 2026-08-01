import { expect } from "chai";
import type { BaseContract, ContractRunner } from "ethers";
import hre from "hardhat";

const { ethers, networkHelpers } = await hre.network.create();

const EPOCH = ethers.id("permissionless-epoch-1");
const AMOUNT_HANDLES = [ethers.id("amount-any-a"), ethers.id("amount-any-b"), ethers.id("amount-any-c")] as const;
const MIN_OUT_HANDLES = [ethers.id("min-any-a"), ethers.id("min-any-b"), ethers.id("min-any-c")] as const;
const REQUEST = ethers.id("request-any");
const TIMEOUT = 600n;

function connected<T extends BaseContract>(contract: T, runner: ContractRunner): T {
  return contract.connect(runner) as T;
}

describe("NoxBatchRouterV2", function () {
  async function deployFixture() {
    const [deployer, alice, bob, carol, keeper] = await ethers.getSigners();
    const tokenIn = await ethers.deployContract("MockERC20", ["Batch Official In", "BOIN"]);
    const tokenOut = await ethers.deployContract("MockERC20", ["Batch Official Out", "BOOUT"]);
    const router = await ethers.deployContract("MockSwapRouter", [
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
    ]);
    const evaluator = await ethers.deployContract("MockBatchEvaluator");
    const batch = await ethers.deployContract("NoxBatchRouterV2", [
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      await router.getAddress(),
      await evaluator.getAddress(),
      TIMEOUT,
    ]);

    for (const user of [alice, bob, carol]) {
      await (tokenIn as any).mint(user.address, 1_000);
      await (tokenIn.connect(user) as any).approve(await batch.getAddress(), 1_000);
    }
    await (tokenOut as any).mint(await router.getAddress(), 10_000);
    await evaluator.setNextRequestId(REQUEST);
    await router.setAmountOut(900);

    return { deployer, alice, bob, carol, keeper, tokenIn, tokenOut, router, evaluator, batch };
  }

  async function deadline(offset = 3_600n) {
    return BigInt(await networkHelpers.time.latest()) + offset;
  }

  it("allows any wallet to open an epoch and join the next three-participant batch", async function () {
    const f = await deployFixture();
    await connected(f.batch, f.alice).openEpoch(EPOCH, await deadline());

    await expect(connected(f.batch, f.alice).submitIntent(EPOCH, AMOUNT_HANDLES[0], MIN_OUT_HANDLES[0], 300))
      .to.emit(f.batch, "IntentSubmitted");
    await connected(f.batch, f.bob).submitIntent(EPOCH, AMOUNT_HANDLES[1], MIN_OUT_HANDLES[1], 400);
    await connected(f.batch, f.carol).submitIntent(EPOCH, AMOUNT_HANDLES[2], MIN_OUT_HANDLES[2], 500);

    expect(await f.batch.userAt(EPOCH, 0)).to.equal(f.alice.address);
    expect(await f.batch.userAt(EPOCH, 1)).to.equal(f.bob.address);
    expect(await f.batch.userAt(EPOCH, 2)).to.equal(f.carol.address);
    expect((await f.batch.getEpoch(EPOCH)).intentCount).to.equal(3n);
    await expect(connected(f.batch, f.keeper).requestNetting(EPOCH))
      .to.emit(f.batch, "NettingRequested")
      .withArgs(EPOCH, REQUEST, 1n, 1);
  });

  it("rejects duplicate participant submits but never relies on constructor allowlists", async function () {
    const f = await deployFixture();
    await connected(f.batch, f.keeper).openEpoch(EPOCH, await deadline());
    await connected(f.batch, f.alice).submitIntent(EPOCH, AMOUNT_HANDLES[0], MIN_OUT_HANDLES[0], 300);
    await expect(connected(f.batch, f.alice).submitIntent(EPOCH, AMOUNT_HANDLES[1], MIN_OUT_HANDLES[1], 300))
      .to.be.revertedWithCustomError(f.batch, "IntentAlreadySubmitted");
    await connected(f.batch, f.bob).submitIntent(EPOCH, AMOUNT_HANDLES[1], MIN_OUT_HANDLES[1], 400);
    await connected(f.batch, f.carol).submitIntent(EPOCH, AMOUNT_HANDLES[2], MIN_OUT_HANDLES[2], 500);
    await expect(connected(f.batch, f.keeper).submitIntent(EPOCH, ethers.id("extra"), ethers.id("extra-min"), 1))
      .to.be.revertedWithCustomError(f.batch, "BatchFull");
  });

  it("lets anyone settle a finalized batch and distributes outputs to dynamic participants", async function () {
    const f = await deployFixture();
    await connected(f.batch, f.keeper).openEpoch(EPOCH, await deadline());
    await connected(f.batch, f.alice).submitIntent(EPOCH, AMOUNT_HANDLES[0], MIN_OUT_HANDLES[0], 300);
    await connected(f.batch, f.bob).submitIntent(EPOCH, AMOUNT_HANDLES[1], MIN_OUT_HANDLES[1], 400);
    await connected(f.batch, f.carol).submitIntent(EPOCH, AMOUNT_HANDLES[2], MIN_OUT_HANDLES[2], 500);
    await connected(f.batch, f.alice).requestNetting(EPOCH);
    await f.evaluator.finalize(await f.batch.getAddress(), EPOCH, REQUEST, 1, 900, [200, 300, 400], [200, 300, 400]);

    await expect(connected(f.batch, f.keeper).settle(EPOCH, 850))
      .to.emit(f.batch, "EpochSettled")
      .withArgs(EPOCH, 900, 850);
    expect(await f.tokenOut.balanceOf(f.alice.address)).to.equal(200n);
    expect(await f.tokenOut.balanceOf(f.bob.address)).to.equal(300n);
    expect(await f.tokenOut.balanceOf(f.carol.address)).to.equal(400n);
  });
});
