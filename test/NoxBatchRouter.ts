import { expect } from "chai";
import type { BaseContract, ContractRunner } from "ethers";
import hre from "hardhat";

const { ethers, networkHelpers } = await hre.network.create();

const EPOCH = ethers.id("epoch-1");
const EPOCH_2 = ethers.id("epoch-2");
const AMOUNT_HANDLES = [ethers.id("amount-a"), ethers.id("amount-b"), ethers.id("amount-c")] as const;
const MIN_OUT_HANDLES = [ethers.id("min-a"), ethers.id("min-b"), ethers.id("min-c")] as const;
const REQUEST_1 = ethers.id("request-1");
const REQUEST_2 = ethers.id("request-2");
const TIMEOUT = 600n;
const MAX_WINDOW = 30n * 24n * 60n * 60n;

function connected<T extends BaseContract>(contract: T, runner: ContractRunner): T {
  return contract.connect(runner) as T;
}

describe("NoxBatchRouter", function () {
  async function deployFixture() {
    const [coordinator, userA, userB, userC, outsider] = await ethers.getSigners();
    const tokenIn = await ethers.deployContract("MockERC20", ["USD Coin", "USDC"]);
    const tokenOut = await ethers.deployContract("MockERC20", ["Wrapped Ether", "WETH"]);
    const router = await ethers.deployContract("MockSwapRouter", [
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
    ]);
    const evaluator = await ethers.deployContract("MockBatchEvaluator");
    const users = [userA.address, userB.address, userC.address] as const;
    const batch = await ethers.deployContract("NoxBatchRouter", [
      coordinator.address,
      users,
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      await router.getAddress(),
      await evaluator.getAddress(),
      TIMEOUT,
    ]);

    for (const user of [userA, userB, userC]) {
      await (tokenIn as any).mint(user.address, 1_000);
      await (tokenIn.connect(user) as any).approve(await batch.getAddress(), 1_000);
    }
    await (tokenOut as any).mint(await router.getAddress(), 10_000);
    await evaluator.setNextRequestId(REQUEST_1);
    await router.setAmountOut(900);

    return { coordinator, userA, userB, userC, users: [userA, userB, userC], outsider, tokenIn, tokenOut, router, evaluator, batch };
  }

  async function deadline(offset = 3_600n) {
    return BigInt(await networkHelpers.time.latest()) + offset;
  }

  async function openEpoch(f: Awaited<ReturnType<typeof deployFixture>>, epochId = EPOCH) {
    await connected(f.batch, f.coordinator).openEpoch(epochId, await deadline());
  }

  async function submitAll(f: Awaited<ReturnType<typeof deployFixture>>) {
    await connected(f.batch, f.userA).submitIntent(EPOCH, AMOUNT_HANDLES[0], MIN_OUT_HANDLES[0], 300);
    await connected(f.batch, f.userB).submitIntent(EPOCH, AMOUNT_HANDLES[1], MIN_OUT_HANDLES[1], 400);
    await connected(f.batch, f.userC).submitIntent(EPOCH, AMOUNT_HANDLES[2], MIN_OUT_HANDLES[2], 500);
  }

  async function requestNetting(f: Awaited<ReturnType<typeof deployFixture>>) {
    await openEpoch(f);
    await submitAll(f);
    await connected(f.batch, f.coordinator).requestNetting(EPOCH);
  }

  describe("configuration and epoch intake", function () {
    it("publishes immutable coordinator, fixed pair, users, endpoints, and timeout", async function () {
      const f = await deployFixture();
      expect(await f.batch.coordinator()).to.equal(f.coordinator.address);
      expect(await f.batch.userAt(0)).to.equal(f.userA.address);
      expect(await f.batch.tokenIn()).to.equal(await f.tokenIn.getAddress());
      expect(await f.batch.tokenOut()).to.equal(await f.tokenOut.getAddress());
      expect(await f.batch.router()).to.equal(await f.router.getAddress());
      expect(await f.batch.evaluator()).to.equal(await f.evaluator.getAddress());
      expect(await f.batch.evaluationTimeout()).to.equal(TIMEOUT);
    });

    it("validates constructor users, endpoints, pair, and timeout", async function () {
      const f = await deployFixture();
      const factory = await ethers.getContractFactory("NoxBatchRouter");
      await expect(factory.deploy(ethers.ZeroAddress, f.users.map((u) => u.address), await f.tokenIn.getAddress(), await f.tokenOut.getAddress(), await f.router.getAddress(), await f.evaluator.getAddress(), TIMEOUT))
        .to.be.revertedWithCustomError(f.batch, "InvalidCoordinator");
      await expect(factory.deploy(f.coordinator.address, [f.userA.address, f.userA.address, f.userC.address], await f.tokenIn.getAddress(), await f.tokenOut.getAddress(), await f.router.getAddress(), await f.evaluator.getAddress(), TIMEOUT))
        .to.be.revertedWithCustomError(f.batch, "InvalidUser");
      await expect(factory.deploy(f.coordinator.address, f.users.map((u) => u.address), await f.tokenIn.getAddress(), await f.tokenIn.getAddress(), await f.router.getAddress(), await f.evaluator.getAddress(), TIMEOUT))
        .to.be.revertedWithCustomError(f.batch, "InvalidPair");
      await expect(factory.deploy(f.coordinator.address, f.users.map((u) => u.address), f.outsider.address, await f.tokenOut.getAddress(), await f.router.getAddress(), await f.evaluator.getAddress(), TIMEOUT))
        .to.be.revertedWithCustomError(f.batch, "InvalidEndpoint");
    });

    it("opens one bounded epoch and collects exactly one opaque intent from each user", async function () {
      const f = await deployFixture();
      await expect(connected(f.batch, f.coordinator).openEpoch(EPOCH, await deadline()))
        .to.emit(f.batch, "EpochOpened");
      await expect(connected(f.batch, f.userA).submitIntent(EPOCH, AMOUNT_HANDLES[0], MIN_OUT_HANDLES[0], 300))
        .to.emit(f.batch, "IntentSubmitted");
      await connected(f.batch, f.userB).submitIntent(EPOCH, AMOUNT_HANDLES[1], MIN_OUT_HANDLES[1], 400);
      await connected(f.batch, f.userC).submitIntent(EPOCH, AMOUNT_HANDLES[2], MIN_OUT_HANDLES[2], 500);
      expect(await f.batch.amountHandle(EPOCH, 0)).to.equal(AMOUNT_HANDLES[0]);
      expect((await f.batch.getEpoch(EPOCH)).intentCount).to.equal(3n);
      expect(await f.tokenIn.balanceOf(await f.batch.getAddress())).to.equal(1_200n);
    });

    it("rejects unauthorized users, duplicate handles, invalid escrows, and expired windows", async function () {
      const f = await deployFixture();
      await openEpoch(f);
      await expect(connected(f.batch, f.outsider).submitIntent(EPOCH, AMOUNT_HANDLES[0], MIN_OUT_HANDLES[0], 300))
        .to.be.revertedWithCustomError(f.batch, "UnauthorizedUser");
      await expect(connected(f.batch, f.userA).submitIntent(EPOCH, ethers.ZeroHash, MIN_OUT_HANDLES[0], 300))
        .to.be.revertedWithCustomError(f.batch, "InvalidHandle");
      await connected(f.batch, f.userA).submitIntent(EPOCH, AMOUNT_HANDLES[0], MIN_OUT_HANDLES[0], 300);
      await expect(connected(f.batch, f.userA).submitIntent(EPOCH, AMOUNT_HANDLES[1], MIN_OUT_HANDLES[1], 300))
        .to.be.revertedWithCustomError(f.batch, "IntentAlreadySubmitted");
      await expect(connected(f.batch, f.userB).submitIntent(EPOCH, AMOUNT_HANDLES[0], MIN_OUT_HANDLES[1], 400))
        .to.be.revertedWithCustomError(f.batch, "DuplicateHandle");
      await expect(connected(f.batch, f.userB).submitIntent(EPOCH, AMOUNT_HANDLES[1], MIN_OUT_HANDLES[1], 0))
        .to.be.revertedWithCustomError(f.batch, "InvalidEscrow");
    });
  });

  describe("async netting and settlement", function () {
    it("starts a correlated request only after all three intents arrive", async function () {
      const f = await deployFixture();
      await openEpoch(f);
      await connected(f.batch, f.userA).submitIntent(EPOCH, AMOUNT_HANDLES[0], MIN_OUT_HANDLES[0], 300);
      await expect(connected(f.batch, f.coordinator).requestNetting(EPOCH))
        .to.be.revertedWithCustomError(f.batch, "IntentBatchIncomplete");
      await connected(f.batch, f.userB).submitIntent(EPOCH, AMOUNT_HANDLES[1], MIN_OUT_HANDLES[1], 400);
      await connected(f.batch, f.userC).submitIntent(EPOCH, AMOUNT_HANDLES[2], MIN_OUT_HANDLES[2], 500);
      await expect(connected(f.batch, f.coordinator).requestNetting(EPOCH))
        .to.emit(f.batch, "NettingRequested").withArgs(EPOCH, REQUEST_1, 1n, 1);
    });

    it("consumes failed evaluator attempts and allows terminal cancellation after exhaustion", async function () {
      const f = await deployFixture();
      await openEpoch(f);
      await submitAll(f);
      await f.evaluator.setNextRequestId(ethers.ZeroHash);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await expect(connected(f.batch, f.coordinator).requestNetting(EPOCH))
          .to.emit(f.batch, "NettingRequestFailed");
        await networkHelpers.time.increase(TIMEOUT);
      }
      expect((await f.batch.getEpoch(EPOCH)).evaluationAttempts).to.equal(3n);
      await expect(connected(f.batch, f.coordinator).cancelEpoch(EPOCH))
        .to.emit(f.batch, "EpochCancelled");
      expect(await f.tokenIn.balanceOf(f.userA.address)).to.equal(1_000n);
    });

    it("consumes reverting evaluator attempts before terminal cancellation", async function () {
      const f = await deployFixture();
      await openEpoch(f);
      await submitAll(f);
      await f.evaluator.setReverting(true);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await expect(connected(f.batch, f.coordinator).requestNetting(EPOCH))
          .to.emit(f.batch, "NettingRequestFailed");
        await networkHelpers.time.increase(TIMEOUT);
      }
      expect((await f.batch.getEpoch(EPOCH)).evaluationAttempts).to.equal(3n);
      await expect(connected(f.batch, f.coordinator).cancelEpoch(EPOCH))
        .to.emit(f.batch, "EpochCancelled");
    });

    it("authenticates callback correlation and validates aggregate allocation", async function () {
      const f = await deployFixture();
      await requestNetting(f);
      await expect(connected(f.batch, f.outsider).finalizeNetting(EPOCH, REQUEST_1, 1, 900, [200, 300, 400], [200, 300, 400]))
        .to.be.revertedWithCustomError(f.batch, "UnauthorizedEvaluator");
      await expect(f.evaluator.finalize(await f.batch.getAddress(), EPOCH, REQUEST_2, 1, 900, [200, 300, 400], [200, 300, 400]))
        .to.be.revertedWithCustomError(f.batch, "RequestIdMismatch");
      await expect(f.evaluator.finalize(await f.batch.getAddress(), EPOCH, REQUEST_1, 2, 900, [200, 300, 400], [200, 300, 400]))
        .to.be.revertedWithCustomError(f.batch, "RequestEpochMismatch");
      await expect(f.evaluator.finalize(await f.batch.getAddress(), EPOCH, REQUEST_1, 1, 900, [200, 300, 500], [200, 300, 400]))
        .to.be.revertedWithCustomError(f.batch, "InvalidAllocation");

      await expect(f.evaluator.finalize(await f.batch.getAddress(), EPOCH, REQUEST_1, 1, 900, [200, 300, 400], [200, 300, 400]))
        .to.emit(f.batch, "NettingFinalized");
      expect((await f.batch.getEpoch(EPOCH)).status).to.equal(5n);
    });

    it("settles one aggregate router swap, distributes outputs, and refunds unused escrow", async function () {
      const f = await deployFixture();
      await requestNetting(f);
      await f.evaluator.finalize(await f.batch.getAddress(), EPOCH, REQUEST_1, 1, 900, [200, 300, 400], [200, 300, 400]);
      await expect(connected(f.batch, f.coordinator).settle(EPOCH, 850))
        .to.emit(f.batch, "EpochSettled").withArgs(EPOCH, 900, 850);

      expect(await f.tokenIn.balanceOf(await f.router.getAddress())).to.equal(900n);
      expect(await f.tokenIn.balanceOf(f.userA.address)).to.equal(800n);
      expect(await f.tokenIn.balanceOf(f.userB.address)).to.equal(700n);
      expect(await f.tokenIn.balanceOf(f.userC.address)).to.equal(600n);
      expect(await f.tokenOut.balanceOf(f.userA.address)).to.equal(200n);
      expect(await f.tokenOut.balanceOf(f.userB.address)).to.equal(300n);
      expect(await f.tokenOut.balanceOf(f.userC.address)).to.equal(400n);
      await expect(connected(f.batch, f.coordinator).settle(EPOCH, 850))
        .to.be.revertedWithCustomError(f.batch, "EpochAlreadySettled");
    });

    it("keeps epoch IDs terminal and allows the next epoch after settlement", async function () {
      const f = await deployFixture();
      await requestNetting(f);
      await f.evaluator.finalize(await f.batch.getAddress(), EPOCH, REQUEST_1, 1, 900, [200, 300, 400], [200, 300, 400]);
      await connected(f.batch, f.coordinator).settle(EPOCH, 850);
      await expect(connected(f.batch, f.coordinator).openEpoch(EPOCH, await deadline()))
        .to.be.revertedWithCustomError(f.batch, "EpochAlreadyUsed");
      await expect(connected(f.batch, f.coordinator).openEpoch(EPOCH_2, await deadline()))
        .to.emit(f.batch, "EpochOpened");
    });
  });
});
