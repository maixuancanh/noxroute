import { expect } from "chai";
import hre from "hardhat";

const { ethers, networkHelpers } = await hre.network.create();

const EPOCH = ethers.id("noxveil-v3-epoch");
const COMMITMENT = ethers.id("noxveil-v3-action");
const DIRECTION_HANDLE = ethers.id("residual-direction");
const AMOUNT_HANDLE = ethers.id("residual-amount");
const MINIMUM_HANDLE = ethers.id("aggregate-minimum");

describe("NoxveilEpochState V3", function () {
  async function deployFixture() {
    const state = await ethers.deployContract("NoxveilEpochStateHarness");
    const now = BigInt(await networkHelpers.time.latest());
    return { state, deadline: now + 600n };
  }

  async function openAndLock() {
    const fixture = await deployFixture();
    await fixture.state.openEpoch(EPOCH, fixture.deadline, 2);
    await fixture.state.lockEpoch(
      EPOCH,
      2_500n * 10n ** 18n,
      COMMITMENT,
      DIRECTION_HANDLE,
      AMOUNT_HANDLE,
      MINIMUM_HANDLE,
    );
    return fixture;
  }

  it("permits only NONE -> OPEN -> LOCKED -> READY -> SETTLING -> SETTLED", async function () {
    const { state, deadline } = await deployFixture();
    await state.openEpoch(EPOCH, deadline, 2);
    expect((await state.getEpoch(EPOCH)).status).to.equal(1n);

    await state.lockEpoch(
      EPOCH,
      2_500n * 10n ** 18n,
      COMMITMENT,
      DIRECTION_HANDLE,
      AMOUNT_HANDLE,
      MINIMUM_HANDLE,
    );
    expect((await state.getEpoch(EPOCH)).status).to.equal(2n);

    await state.readyEpoch(EPOCH, COMMITMENT, 10, 9);
    expect((await state.getEpoch(EPOCH)).status).to.equal(3n);
    await state.beginSettlement(EPOCH, COMMITMENT);
    expect((await state.getEpoch(EPOCH)).status).to.equal(4n);
    await state.completeSettlement(EPOCH, 11);
    expect((await state.getEpoch(EPOCH)).status).to.equal(5n);
  });

  it("rejects skipped transitions and duplicate finalization", async function () {
    const { state, deadline } = await deployFixture();
    await expect(state.readyEpoch(EPOCH, COMMITMENT, 1, 1))
      .to.be.revertedWithCustomError(state, "InvalidEpochStatus");
    await state.openEpoch(EPOCH, deadline, 1);
    await expect(state.beginSettlement(EPOCH, COMMITMENT))
      .to.be.revertedWithCustomError(state, "InvalidEpochStatus");
    await state.lockEpoch(
      EPOCH,
      1,
      COMMITMENT,
      DIRECTION_HANDLE,
      AMOUNT_HANDLE,
      MINIMUM_HANDLE,
    );
    await state.readyEpoch(EPOCH, COMMITMENT, 1, 1);
    await expect(state.readyEpoch(EPOCH, COMMITMENT, 1, 1))
      .to.be.revertedWithCustomError(state, "InvalidEpochStatus");
  });

  it("rejects replayed epoch IDs and stale action commitments", async function () {
    const { state, deadline } = await openAndLock();
    await expect(state.openEpoch(EPOCH, deadline, 2))
      .to.be.revertedWithCustomError(state, "EpochAlreadyUsed");
    await expect(state.readyEpoch(EPOCH, ethers.id("changed"), 10, 9))
      .to.be.revertedWithCustomError(state, "ActionCommitmentMismatch");
    await state.readyEpoch(EPOCH, COMMITMENT, 10, 9);
    await expect(state.beginSettlement(EPOCH, ethers.id("stale")))
      .to.be.revertedWithCustomError(state, "ActionCommitmentMismatch");
  });

  it("rolls SETTLING back to READY when the settlement transaction reverts", async function () {
    const { state } = await openAndLock();
    await state.readyEpoch(EPOCH, COMMITMENT, 10, 9);
    await expect(state.attemptSettlementAndRevert(EPOCH, COMMITMENT))
      .to.be.revertedWithCustomError(state, "SimulatedSettlementFailure");
    expect((await state.getEpoch(EPOCH)).status).to.equal(3n);
  });

  it("rejects premature cancellation and allows permissionless timeout cancellation", async function () {
    const { state, deadline } = await openAndLock();
    await expect(state.cancelEpoch(EPOCH))
      .to.be.revertedWithCustomError(state, "EpochDeadlineNotReached");
    await networkHelpers.time.increaseTo(deadline + 1n);
    await state.cancelEpoch(EPOCH);
    expect((await state.getEpoch(EPOCH)).status).to.equal(6n);
    await expect(state.cancelEpoch(EPOCH))
      .to.be.revertedWithCustomError(state, "InvalidEpochStatus");
  });

  it("stores only public aggregate metadata in the epoch record", async function () {
    const { state } = await openAndLock();
    const epoch = await state.getEpoch(EPOCH);
    expect(epoch.participantCount).to.equal(2n);
    expect(epoch.epochNonce).to.equal(1n);
    expect(epoch.actionCommitment).to.equal(COMMITMENT);
    expect(epoch.residualDirectionHandle).to.equal(DIRECTION_HANDLE);
    expect(epoch.residualAmountHandle).to.equal(AMOUNT_HANDLE);
    expect(epoch.aggregateMinOutHandle).to.equal(MINIMUM_HANDLE);
    expect(epoch.residualAmount).to.equal(0n);
    expect(epoch.amountOutMinimum).to.equal(0n);
    expect(epoch.amountOut).to.equal(0n);
  });
});

