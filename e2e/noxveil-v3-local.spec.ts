import assert from "node:assert/strict";
import { expect } from "chai";
import { createEthersHandleClient } from "@iexec-nox/handle";
import { nox } from "@iexec-nox/nox-hardhat-plugin";
import hre from "hardhat";

const connection = await hre.network.create();
const { ethers, networkHelpers } = connection;
const noxClient = await nox.connect(connection);

const WETH_DIRECTION = 0n;
const INVALID_DIRECTION = 2n;

describe("Noxveil V3 local Nox stack", function () {
  this.timeout(600_000);

  async function deployFixture() {
    const [owner, outsider, destination] = await ethers.getSigners();
    const weth = await ethers.deployContract("MockERC20", ["Wrapped Ether", "WETH"]);
    const usdc = await ethers.deployContract("MockERC20", ["USD Coin", "USDC"]);
    const other = await ethers.deployContract("MockERC20", ["Other", "OTHER"]);
    const vault = await ethers.deployContract("NoxveilVault", [
      await weth.getAddress(),
      await usdc.getAddress(),
    ]);
    const engine = await ethers.deployContract("MockNoxveilEngine", [await vault.getAddress()]);
    await vault.setEngine(await engine.getAddress());
    await weth.mint(owner.address, 10_000);
    await usdc.mint(owner.address, 10_000);
    await other.mint(owner.address, 10_000);
    await weth.approve(await vault.getAddress(), 10_000);
    await usdc.approve(await vault.getAddress(), 10_000);
    await other.approve(await vault.getAddress(), 10_000);
    return { owner, outsider, destination, weth, usdc, other, vault, engine };
  }

  async function decryptUint256(handle: string) {
    const result = await noxClient.decrypt(handle as never);
    return result.value as bigint;
  }

  async function deployStrategyFixture() {
    const [owner, outsider] = await ethers.getSigners();
    const weth = await ethers.deployContract("MockERC20", ["Wrapped Ether", "WETH"]);
    const usdc = await ethers.deployContract("MockERC20", ["USD Coin", "USDC"]);
    const vault = await ethers.deployContract("NoxveilVault", [
      await weth.getAddress(),
      await usdc.getAddress(),
    ]);
    const adapter = await ethers.deployContract("MockNoxveilAdapter", [await vault.getAddress()]);
    const engine = await ethers.deployContract("NoxveilStrategyEngine", [
      await vault.getAddress(),
      await adapter.getAddress(),
      300,
    ]);
    await vault.setEngine(await engine.getAddress());
    await vault.setAdapter(await adapter.getAddress());
    await vault.closeBootstrap();
    return { owner, outsider, weth, usdc, vault, adapter, engine };
  }

  async function encryptStrategy(
    engineAddress: `0x${string}`,
    values: {
      direction?: bigint;
      budget?: bigint;
      clip?: bigint;
      limit?: bigint;
      slippage?: bigint;
    } = {},
    handleClient: any = noxClient,
  ) {
    const direction = await handleClient.encryptInput(values.direction ?? 0n, "uint16", engineAddress);
    const budget = await handleClient.encryptInput(values.budget ?? 1_000n, "uint256", engineAddress);
    const clip = await handleClient.encryptInput(values.clip ?? 100n, "uint256", engineAddress);
    const limit = await handleClient.encryptInput(values.limit ?? 2_400n * 10n ** 18n, "uint256", engineAddress);
    const slippage = await handleClient.encryptInput(values.slippage ?? 50n, "uint256", engineAddress);
    return { direction, budget, clip, limit, slippage };
  }

  async function createStrategy(engine: any, clientNonce: bigint, values = {}, handleClient: any = noxClient) {
    const encrypted = await encryptStrategy(
      await engine.getAddress() as `0x${string}`,
      values,
      handleClient,
    );
    const tx = await engine.createStrategy({
      direction: encrypted.direction.handle,
      directionProof: encrypted.direction.handleProof,
      budget: encrypted.budget.handle,
      budgetProof: encrypted.budget.handleProof,
      clip: encrypted.clip.handle,
      clipProof: encrypted.clip.handleProof,
      limitPriceWad: encrypted.limit.handle,
      limitPriceProof: encrypted.limit.handleProof,
      slippageBps: encrypted.slippage.handle,
      slippageProof: encrypted.slippage.handleProof,
    }, clientNonce);
    const receipt = await tx.wait();
    const event = receipt?.logs
      .map((log: unknown) => {
        try {
          return engine.interface.parseLog(log as never);
        } catch {
          return null;
        }
      })
      .find((log: any) => log?.name === "StrategyCreated");
    assert(event);
    return { strategyId: event.args.strategyId as string, encrypted };
  }

  async function lockEpoch(engine: any, deadline: bigint) {
    const receipt = await (await engine.lockCurrentEpoch(deadline)).wait();
    const opened = receipt?.logs
      .map((log: unknown) => {
        try {
          return engine.interface.parseLog(log as never);
        } catch {
          return null;
        }
      })
      .find((log: any) => log?.name === "EpochOpened");
    assert(opened);
    return opened.args.epochId as string;
  }

  async function aggregateProofs(engine: any, epochId: string) {
    const epoch = await engine.getEpoch(epochId);
    const direction = await noxClient.publicDecrypt(epoch.residualDirectionHandle as never);
    const amount = await noxClient.publicDecrypt(epoch.residualAmountHandle as never);
    const minimum = await noxClient.publicDecrypt(epoch.aggregateMinOutHandle as never);
    return { epoch, direction, amount, minimum };
  }

  it("keeps deposited balances encrypted, owner-readable, and reusable across transactions", async function () {
    const { owner, outsider, weth, vault } = await deployFixture();
    await expect(vault.deposit(await weth.getAddress(), 1_000))
      .to.emit(vault, "Deposited")
      .withArgs(owner.address, await weth.getAddress());
    await vault.deposit(await weth.getAddress(), 500);

    const handle = await vault.availableHandle(owner.address, await weth.getAddress());
    expect(await decryptUint256(handle)).to.equal(1_500n);

    const outsiderClient = await createEthersHandleClient(outsider, {
      smartContractAddress: noxClient.noxComputeAddress,
      gatewayUrl: noxClient.handleGatewayUrl as `http://${string}`,
      subgraphUrl: "https://example.com/subgraphs/id/none",
    });
    await assert.rejects(() => outsiderClient.decrypt(handle as never));
  });

  it("rejects unsupported tokens and permanently binds a single reverse-verified engine", async function () {
    const { owner, other, vault } = await deployFixture();
    await expect(vault.deposit(await other.getAddress(), 1))
      .to.be.revertedWithCustomError(vault, "UnsupportedToken");
    const secondEngine = await ethers.deployContract("MockNoxveilEngine", [await vault.getAddress()]);
    await expect(vault.setEngine(await secondEngine.getAddress()))
      .to.be.revertedWithCustomError(vault, "EngineAlreadySet");
    await expect((vault.connect(owner) as typeof vault).reserveForEpoch(
      ethers.id("unauthorized"),
      owner.address,
      ethers.id("direction"),
      ethers.id("clip"),
    )).to.be.revertedWithCustomError(vault, "OnlyEngine");
  });

  it("binds only a reverse-verified adapter and permanently closes bootstrap", async function () {
    const { vault } = await deployFixture();
    const [, outsider] = await ethers.getSigners();
    const wrongVault = await ethers.deployContract("NoxveilVault", [
      await vault.weth(),
      await vault.usdc(),
    ]);
    const wrongAdapter = await ethers.deployContract("MockNoxveilAdapter", [await wrongVault.getAddress()]);
    const adapter = await ethers.deployContract("MockNoxveilAdapter", [await vault.getAddress()]);

    await expect(vault.setAdapter(outsider.address))
      .to.be.revertedWithCustomError(vault, "InvalidAdapter");
    await expect(vault.setAdapter(await wrongAdapter.getAddress()))
      .to.be.revertedWithCustomError(vault, "InvalidAdapter");
    await expect(vault.setAdapter(await adapter.getAddress()))
      .to.emit(vault, "AdapterBound")
      .withArgs(await adapter.getAddress());
    await expect(vault.setAdapter(await adapter.getAddress()))
      .to.be.revertedWithCustomError(vault, "AdapterAlreadySet");
    await expect(vault.closeBootstrap()).to.emit(vault, "BootstrapPermanentlyClosed");
    await expect(vault.setEngine(await vault.engine()))
      .to.be.revertedWithCustomError(vault, "BootstrapClosed");
  });

  it("reserves a private clip, hides insufficient balance, and releases without public decryption", async function () {
    const { owner, weth, usdc, vault, engine } = await deployFixture();
    await vault.deposit(await weth.getAddress(), 1_000);
    const epoch = ethers.id("private-reservation");
    const direction = await noxClient.encryptInput(
      WETH_DIRECTION,
      "uint16",
      await engine.getAddress() as `0x${string}`,
    );
    const clip = await noxClient.encryptInput(
      400n,
      "uint256",
      await engine.getAddress() as `0x${string}`,
    );
    await engine.reserveForEpoch(
      epoch,
      owner.address,
      direction.handle,
      direction.handleProof,
      clip.handle,
      clip.handleProof,
    );

    expect(await decryptUint256(await vault.availableHandle(owner.address, await weth.getAddress())))
      .to.equal(600n);
    expect(await decryptUint256(await vault.reservedHandle(epoch, owner.address, await weth.getAddress())))
      .to.equal(400n);
    expect(await decryptUint256(await vault.reservedHandle(epoch, owner.address, await usdc.getAddress())))
      .to.equal(0n);

    const withdrawalDeadline = BigInt(await networkHelpers.time.latest()) + 600n;
    await expect(vault.requestFullWithdrawal(
      await weth.getAddress(),
      owner.address,
      77,
      withdrawalDeadline,
    )).to.be.revertedWithCustomError(vault, "ActiveReservation");

    await engine.releaseEpoch(epoch, owner.address);
    expect(await decryptUint256(await vault.availableHandle(owner.address, await weth.getAddress())))
      .to.equal(1_000n);
    expect(await decryptUint256(await vault.reservedHandle(epoch, owner.address, await weth.getAddress())))
      .to.equal(0n);
  });

  it("selects zero privately for an invalid direction or an unaffordable clip", async function () {
    const { owner, weth, vault, engine } = await deployFixture();
    await vault.deposit(await weth.getAddress(), 1_000);

    for (const [label, directionValue, clipValue] of [
      ["invalid-direction", INVALID_DIRECTION, 100n],
      ["insufficient-balance", WETH_DIRECTION, 1_200n],
    ] as const) {
      const epoch = ethers.id(label);
      const direction = await noxClient.encryptInput(
        directionValue,
        "uint16",
        await engine.getAddress() as `0x${string}`,
      );
      const clip = await noxClient.encryptInput(
        clipValue,
        "uint256",
        await engine.getAddress() as `0x${string}`,
      );
      await engine.reserveForEpoch(
        epoch,
        owner.address,
        direction.handle,
        direction.handleProof,
        clip.handle,
        clip.handleProof,
      );
      expect(await decryptUint256(await vault.reservedHandle(epoch, owner.address, await weth.getAddress())))
        .to.equal(0n);
      await engine.releaseEpoch(epoch, owner.address);
    }

    expect(await decryptUint256(await vault.availableHandle(owner.address, await weth.getAddress())))
      .to.equal(1_000n);
  });

  it("commits reserved input and confidential output credit atomically", async function () {
    const { owner, weth, usdc, vault, engine } = await deployFixture();
    await vault.deposit(await weth.getAddress(), 1_000);
    const epoch = ethers.id("commit-reservation");
    const direction = await noxClient.encryptInput(
      WETH_DIRECTION,
      "uint16",
      await engine.getAddress() as `0x${string}`,
    );
    const clip = await noxClient.encryptInput(
      400n,
      "uint256",
      await engine.getAddress() as `0x${string}`,
    );
    await engine.reserveForEpoch(
      epoch,
      owner.address,
      direction.handle,
      direction.handleProof,
      clip.handle,
      clip.handleProof,
    );
    const wethCredit = await noxClient.encryptInput(
      0n,
      "uint256",
      await engine.getAddress() as `0x${string}`,
    );
    const usdcCredit = await noxClient.encryptInput(
      800n,
      "uint256",
      await engine.getAddress() as `0x${string}`,
    );
    await engine.commitEpoch(
      epoch,
      owner.address,
      wethCredit.handle,
      wethCredit.handleProof,
      usdcCredit.handle,
      usdcCredit.handleProof,
    );

    expect(await decryptUint256(await vault.availableHandle(owner.address, await weth.getAddress())))
      .to.equal(600n);
    expect(await decryptUint256(await vault.availableHandle(owner.address, await usdc.getAddress())))
      .to.equal(800n);
    expect(await decryptUint256(await vault.reservedHandle(epoch, owner.address, await weth.getAddress())))
      .to.equal(0n);
    await expect(engine.releaseEpoch(epoch, owner.address))
      .to.be.revertedWithCustomError(vault, "ReservationAlreadyProcessed");
  });

  it("withdraws a committed full token balance and consumes the commitment once", async function () {
    const { owner, destination, weth, vault } = await deployFixture();
    await vault.deposit(await weth.getAddress(), 321);
    const deadline = BigInt(await networkHelpers.time.latest()) + 600n;
    const requestTx = await vault.requestFullWithdrawal(
      await weth.getAddress(),
      destination.address,
      1,
      deadline,
    );
    const receipt = await requestTx.wait();
    const event = receipt?.logs
      .map((log: unknown) => {
        try {
          return vault.interface.parseLog(log as never);
        } catch {
          return null;
        }
      })
      .find((log: { name?: string } | null) => log?.name === "FullWithdrawalRequested");
    assert(event);
    const commitment = event.args.commitment as string;
    const balanceHandle = event.args.balanceHandle as string;
    const decryption = await noxClient.publicDecrypt(balanceHandle as never);
    expect(decryption.value).to.equal(321n);

    await vault.finalizeFullWithdrawal(commitment, decryption.decryptionProof);
    expect(await weth.balanceOf(destination.address)).to.equal(321n);
    expect(await decryptUint256(await vault.availableHandle(owner.address, await weth.getAddress())))
      .to.equal(0n);
    await expect(vault.finalizeFullWithdrawal(commitment, decryption.decryptionProof))
      .to.be.revertedWithCustomError(vault, "WithdrawalAlreadyConsumed");
  });

  it("stores all strategy economics as owner-readable persistent Nox handles", async function () {
    const { owner, outsider, engine } = await deployStrategyFixture();
    const { strategyId } = await createStrategy(engine, 7n, {
      direction: 1n,
      budget: 5_000n,
      clip: 250n,
      limit: 2_600n * 10n ** 18n,
      slippage: 75n,
    });
    const publicState = await engine.getStrategyPublic(strategyId);
    expect(publicState.owner).to.equal(owner.address);
    expect(publicState.cancelled).to.equal(false);
    expect(publicState.clientNonce).to.equal(7n);
    expect(publicState.slot).to.be.lessThan(8n);

    const handles = await engine.strategyHandles(strategyId);
    expect(await noxClient.decrypt(handles.direction as never).then((value) => value.value)).to.equal(1n);
    expect(await decryptUint256(handles.remaining)).to.equal(5_000n);
    expect(await decryptUint256(handles.clip)).to.equal(250n);
    expect(await decryptUint256(handles.limitPriceWad)).to.equal(2_600n * 10n ** 18n);
    expect(await noxClient.decrypt(handles.slippageBps as never).then((value) => value.value)).to.equal(75n);

    const outsiderClient = await createEthersHandleClient(outsider, {
      smartContractAddress: noxClient.noxComputeAddress,
      gatewayUrl: noxClient.handleGatewayUrl as `http://${string}`,
      subgraphUrl: "https://example.com/subgraphs/id/none",
    });
    await assert.rejects(() => outsiderClient.decrypt(handles.remaining as never));

    const topUp = await noxClient.encryptInput(
      125n,
      "uint256",
      await engine.getAddress() as `0x${string}`,
    );
    await engine.increaseBudget(strategyId, topUp.handle, topUp.handleProof);
    const updated = await engine.strategyHandles(strategyId);
    expect(await decryptUint256(updated.remaining)).to.equal(5_125n);
  });

  it("rejects zero/replayed handles and non-owner cancellation while freeing a cancelled slot", async function () {
    const { outsider, engine } = await deployStrategyFixture();
    const created = await createStrategy(engine, 9n);
    await expect(engine.createStrategy({
      direction: created.encrypted.direction.handle,
      directionProof: created.encrypted.direction.handleProof,
      budget: created.encrypted.budget.handle,
      budgetProof: created.encrypted.budget.handleProof,
      clip: created.encrypted.clip.handle,
      clipProof: created.encrypted.clip.handleProof,
      limitPriceWad: created.encrypted.limit.handle,
      limitPriceProof: created.encrypted.limit.handleProof,
      slippageBps: created.encrypted.slippage.handle,
      slippageProof: created.encrypted.slippage.handleProof,
    }, 10)).to.be.revertedWithCustomError(engine, "HandleAlreadyUsed");
    await expect(engine.createStrategy({
      direction: ethers.ZeroHash,
      directionProof: "0x",
      budget: ethers.ZeroHash,
      budgetProof: "0x",
      clip: ethers.ZeroHash,
      clipProof: "0x",
      limitPriceWad: ethers.ZeroHash,
      limitPriceProof: "0x",
      slippageBps: ethers.ZeroHash,
      slippageProof: "0x",
    }, 11)).to.be.revertedWithCustomError(engine, "InvalidHandle");
    await expect((engine.connect(outsider) as typeof engine).cancelStrategy(created.strategyId))
      .to.be.revertedWithCustomError(engine, "OnlyStrategyOwner");
    await engine.cancelStrategy(created.strategyId);
    expect((await engine.getStrategyPublic(created.strategyId)).cancelled).to.equal(true);
    expect(await engine.activeStrategyCount()).to.equal(0n);
    await expect(engine.cancelStrategy(created.strategyId))
      .to.be.revertedWithCustomError(engine, "StrategyAlreadyCancelled");
  });

  it("bounds active strategy evaluation slots at eight", async function () {
    const { engine } = await deployStrategyFixture();
    for (let index = 0; index < 8; index += 1) {
      await createStrategy(engine, BigInt(index + 1), {
        budget: 1_000n + BigInt(index),
        clip: 100n + BigInt(index),
      });
    }
    expect(await engine.activeStrategyCount()).to.equal(8n);

    const overflow = await encryptStrategy(await engine.getAddress() as `0x${string}`, {
      budget: 2_000n,
    });
    await expect(engine.createStrategy({
      direction: overflow.direction.handle,
      directionProof: overflow.direction.handleProof,
      budget: overflow.budget.handle,
      budgetProof: overflow.budget.handleProof,
      clip: overflow.clip.handle,
      clipProof: overflow.clip.handleProof,
      limitPriceWad: overflow.limit.handle,
      limitPriceProof: overflow.limit.handleProof,
      slippageBps: overflow.slippage.handle,
      slippageProof: overflow.slippage.handleProof,
    }, 99)).to.be.revertedWithCustomError(engine, "ActiveStrategyLimitReached");
  });

  it("confidentially nets opposing valid flows and exposes only aggregate settlement outputs", async function () {
    const { owner, outsider, weth, usdc, vault, engine } = await deployStrategyFixture();
    const wethUnit = 10n ** 18n;
    const usdcUnit = 10n ** 6n;

    await weth.mint(owner.address, 2n * wethUnit);
    await weth.approve(await vault.getAddress(), 2n * wethUnit);
    await vault.deposit(await weth.getAddress(), 2n * wethUnit);

    await usdc.mint(outsider.address, 1_000n * usdcUnit);
    await (usdc.connect(outsider) as typeof usdc).approve(await vault.getAddress(), 1_000n * usdcUnit);
    await (vault.connect(outsider) as typeof vault).deposit(await usdc.getAddress(), 1_000n * usdcUnit);

    const seller = await createStrategy(engine, 101n, {
      direction: 0n,
      budget: 2n * wethUnit,
      clip: wethUnit,
      limit: 2_400n * 10n ** 18n,
      slippage: 100n,
    });
    const outsiderClient = await createEthersHandleClient(outsider, {
      smartContractAddress: noxClient.noxComputeAddress,
      gatewayUrl: noxClient.handleGatewayUrl as `http://${string}`,
      subgraphUrl: "https://example.com/subgraphs/id/none",
    });
    const buyer = await createStrategy(engine.connect(outsider), 102n, {
      direction: 1n,
      budget: 1_000n * usdcUnit,
      clip: 1_000n * usdcUnit,
      limit: 2_600n * 10n ** 18n,
      slippage: 100n,
    }, outsiderClient);

    const auditor = (await ethers.getSigners())[4];
    await expect((engine.connect(outsider) as typeof engine).setAuditor(auditor.address))
      .to.be.revertedWithCustomError(engine, "OnlyAuditorAdmin");
    await engine.setAuditor(auditor.address);

    const deadline = BigInt(await networkHelpers.time.latest()) + 600n;
    const lockTx = await engine.lockCurrentEpoch(deadline);
    const lockReceipt = await lockTx.wait();
    const opened = lockReceipt?.logs
      .map((log: unknown) => {
        try {
          return engine.interface.parseLog(log as never);
        } catch {
          return null;
        }
      })
      .find((log: any) => log?.name === "EpochOpened");
    assert(opened);
    const epochId = opened.args.epochId as string;

    const epoch = await engine.getEpoch(epochId);
    expect(epoch.participantCount).to.equal(2n);
    expect(epoch.twapPriceWad).to.equal(2_500n * 10n ** 18n);
    expect(epoch.actionCommitment).to.not.equal(ethers.ZeroHash);

    const direction = await noxClient.publicDecrypt(epoch.residualDirectionHandle as never);
    const residual = await noxClient.publicDecrypt(epoch.residualAmountHandle as never);
    const minimum = await noxClient.publicDecrypt(epoch.aggregateMinOutHandle as never);
    expect(direction.value).to.equal(0n);
    expect(residual.value).to.equal(600_000_000_000_000_000n);
    expect(minimum.value).to.equal(1_485n * usdcUnit);

    const sellerSelection = await engine.epochStrategyHandles(epochId, seller.strategyId);
    const buyerSelection = await engine.epochStrategyHandles(epochId, buyer.strategyId);
    expect(await decryptUint256(sellerSelection.selectedWeth)).to.equal(wethUnit);
    expect(await outsiderClient.decrypt(buyerSelection.selectedUsdc as never).then((value: any) => value.value))
      .to.equal(1_000n * usdcUnit);

    const privateHandles = await engine.epochPrivateHandles(epochId);
    expect(await decryptUint256(privateHandles.totalRequestedQuote)).to.equal(3_500n * 10n ** 18n);
    expect(await decryptUint256(privateHandles.matchedQuote)).to.equal(1_000n * 10n ** 18n);
    const auditorClient = await createEthersHandleClient(auditor, {
      smartContractAddress: noxClient.noxComputeAddress,
      gatewayUrl: noxClient.handleGatewayUrl as `http://${string}`,
      subgraphUrl: "https://example.com/subgraphs/id/none",
    });
    expect(await auditorClient.decrypt(privateHandles.matchedQuote as never).then((value: any) => value.value))
      .to.equal(1_000n * 10n ** 18n);
    await engine.setAuditor(ethers.ZeroAddress);
    expect(await engine.auditor()).to.equal(ethers.ZeroAddress);
    await assert.rejects(() => noxClient.publicDecrypt(privateHandles.totalWeth as never));
    await assert.rejects(() => noxClient.publicDecrypt(privateHandles.totalUsdc as never));
    await assert.rejects(() => noxClient.publicDecrypt(sellerSelection.selectedWeth as never));

    const thirdParty = (await ethers.getSigners())[3];
    const thirdPartyClient = await createEthersHandleClient(thirdParty, {
      smartContractAddress: noxClient.noxComputeAddress,
      gatewayUrl: noxClient.handleGatewayUrl as `http://${string}`,
      subgraphUrl: "https://example.com/subgraphs/id/none",
    });
    await assert.rejects(() => thirdPartyClient.decrypt(privateHandles.matchedQuote as never));

    expect(await decryptUint256(await vault.availableHandle(owner.address, await weth.getAddress())))
      .to.equal(wethUnit);
    expect(await outsiderClient.decrypt(
      await vault.availableHandle(outsider.address, await usdc.getAddress()) as never,
    ).then((value: any) => value.value))
      .to.equal(0n);
    expect(await decryptUint256((await engine.strategyHandles(seller.strategyId)).remaining))
      .to.equal(2n * wethUnit);
    expect(await outsiderClient.decrypt(
      (await engine.strategyHandles(buyer.strategyId)).remaining as never,
    ).then((value: any) => value.value))
      .to.equal(1_000n * usdcUnit);
  });

  it("privately selects zero for invalid, exhausted, unaffordable, or limit-failing strategies", async function () {
    const { owner, weth, vault, engine } = await deployStrategyFixture();
    await weth.mint(owner.address, 50n);
    await weth.approve(await vault.getAddress(), 50n);
    await vault.deposit(await weth.getAddress(), 50n);

    const cases = [
      { nonce: 201n, direction: 2n, budget: 100n, clip: 100n, limit: 2_400n * 10n ** 18n },
      { nonce: 202n, direction: 0n, budget: 0n, clip: 100n, limit: 2_400n * 10n ** 18n },
      { nonce: 203n, direction: 0n, budget: 100n, clip: 100n, limit: 2_400n * 10n ** 18n },
      { nonce: 204n, direction: 0n, budget: 50n, clip: 50n, limit: 2_600n * 10n ** 18n },
    ];
    const strategyIds: string[] = [];
    for (const entry of cases) {
      strategyIds.push((await createStrategy(engine, entry.nonce, entry)).strategyId);
    }

    const deadline = BigInt(await networkHelpers.time.latest()) + 600n;
    const receipt = await (await engine.lockCurrentEpoch(deadline)).wait();
    const opened = receipt?.logs
      .map((log: unknown) => {
        try {
          return engine.interface.parseLog(log as never);
        } catch {
          return null;
        }
      })
      .find((log: any) => log?.name === "EpochOpened");
    assert(opened);

    for (const strategyId of strategyIds) {
      const selection = await engine.epochStrategyHandles(opened.args.epochId, strategyId);
      expect(await decryptUint256(selection.selectedWeth)).to.equal(0n);
      expect(await decryptUint256(selection.selectedUsdc)).to.equal(0n);
    }
    expect(await decryptUint256(await vault.availableHandle(owner.address, await weth.getAddress())))
      .to.equal(50n);
  });

  it("verifies only the committed aggregate proofs and retries an atomic residual settlement", async function () {
    const { owner, outsider, weth, usdc, vault, adapter, engine } = await deployStrategyFixture();
    const wethUnit = 10n ** 18n;
    const usdcUnit = 10n ** 6n;
    await weth.mint(owner.address, 2n * wethUnit);
    await weth.approve(await vault.getAddress(), 2n * wethUnit);
    await vault.deposit(await weth.getAddress(), 2n * wethUnit);
    await usdc.mint(outsider.address, 1_000n * usdcUnit);
    await (usdc.connect(outsider) as typeof usdc).approve(await vault.getAddress(), 1_000n * usdcUnit);
    await (vault.connect(outsider) as typeof vault).deposit(await usdc.getAddress(), 1_000n * usdcUnit);

    const seller = await createStrategy(engine, 301n, {
      direction: 0n,
      budget: 2n * wethUnit,
      clip: wethUnit,
      limit: 2_400n * 10n ** 18n,
      slippage: 100n,
    });
    const outsiderClient = await createEthersHandleClient(outsider, {
      smartContractAddress: noxClient.noxComputeAddress,
      gatewayUrl: noxClient.handleGatewayUrl as `http://${string}`,
      subgraphUrl: "https://example.com/subgraphs/id/none",
    });
    const buyer = await createStrategy(engine.connect(outsider), 302n, {
      direction: 1n,
      budget: 1_000n * usdcUnit,
      clip: 1_000n * usdcUnit,
      limit: 2_600n * 10n ** 18n,
      slippage: 100n,
    }, outsiderClient);

    const deadline = BigInt(await networkHelpers.time.latest()) + 600n;
    const epochId = await lockEpoch(engine, deadline);
    const proofs = await aggregateProofs(engine, epochId);
    await assert.rejects(() => engine.finalizeAggregate(
      epochId,
      "0x1234",
      proofs.amount.decryptionProof,
      proofs.minimum.decryptionProof,
    ));
    await assert.rejects(() => engine.finalizeAggregate(
      epochId,
      proofs.direction.decryptionProof,
      proofs.minimum.decryptionProof,
      proofs.amount.decryptionProof,
    ));

    await (engine.connect(outsider) as typeof engine).finalizeAggregate(
      epochId,
      proofs.direction.decryptionProof,
      proofs.amount.decryptionProof,
      proofs.minimum.decryptionProof,
    );
    expect((await engine.getEpoch(epochId)).status).to.equal(3n);
    await assert.rejects(() => engine.finalizeAggregate(
      epochId,
      proofs.direction.decryptionProof,
      proofs.amount.decryptionProof,
      proofs.minimum.decryptionProof,
    ));

    await adapter.setShouldRevert(true);
    await expect((engine.connect(outsider) as typeof engine).settle(epochId)).to.be.revertedWith("mock swap revert");
    expect((await engine.getEpoch(epochId)).status).to.equal(3n);

    await adapter.setShouldRevert(false);
    await adapter.setAmountOut(1_490n * usdcUnit);
    await (engine.connect(outsider) as typeof engine).settle(epochId);
    const settled = await engine.getEpoch(epochId);
    expect(settled.status).to.equal(5n);
    expect(settled.amountOut).to.equal(1_490n * usdcUnit);
    expect(await adapter.callCount()).to.equal(1n);

    expect(await decryptUint256(await vault.availableHandle(owner.address, await weth.getAddress())))
      .to.equal(wethUnit);
    expect(await decryptUint256(await vault.availableHandle(owner.address, await usdc.getAddress())))
      .to.equal(2_490n * usdcUnit);
    expect(await outsiderClient.decrypt(
      await vault.availableHandle(outsider.address, await weth.getAddress()) as never,
    ).then((value: any) => value.value)).to.equal(400_000_000_000_000_000n);
    expect(await outsiderClient.decrypt(
      await vault.availableHandle(outsider.address, await usdc.getAddress()) as never,
    ).then((value: any) => value.value)).to.equal(0n);
    expect(await decryptUint256((await engine.strategyHandles(seller.strategyId)).remaining))
      .to.equal(wethUnit);
    expect(await outsiderClient.decrypt(
      (await engine.strategyHandles(buyer.strategyId)).remaining as never,
    ).then((value: any) => value.value)).to.equal(0n);
  });

  it("settles an exactly netted epoch internally without invoking the adapter", async function () {
    const { owner, outsider, weth, usdc, vault, adapter, engine } = await deployStrategyFixture();
    const usdcUnit = 10n ** 6n;
    const matchedWeth = 400_000_000_000_000_000n;
    await weth.mint(owner.address, matchedWeth);
    await weth.approve(await vault.getAddress(), matchedWeth);
    await vault.deposit(await weth.getAddress(), matchedWeth);
    await usdc.mint(outsider.address, 1_000n * usdcUnit);
    await (usdc.connect(outsider) as typeof usdc).approve(await vault.getAddress(), 1_000n * usdcUnit);
    await (vault.connect(outsider) as typeof vault).deposit(await usdc.getAddress(), 1_000n * usdcUnit);

    await createStrategy(engine, 401n, {
      direction: 0n,
      budget: matchedWeth,
      clip: matchedWeth,
      limit: 2_400n * 10n ** 18n,
    });
    const outsiderClient = await createEthersHandleClient(outsider, {
      smartContractAddress: noxClient.noxComputeAddress,
      gatewayUrl: noxClient.handleGatewayUrl as `http://${string}`,
      subgraphUrl: "https://example.com/subgraphs/id/none",
    });
    await createStrategy(engine.connect(outsider), 402n, {
      direction: 1n,
      budget: 1_000n * usdcUnit,
      clip: 1_000n * usdcUnit,
      limit: 2_600n * 10n ** 18n,
    }, outsiderClient);
    const epochId = await lockEpoch(
      engine,
      BigInt(await networkHelpers.time.latest()) + 600n,
    );
    const proofs = await aggregateProofs(engine, epochId);
    expect(proofs.amount.value).to.equal(0n);
    expect(proofs.minimum.value).to.equal(0n);
    await engine.finalizeAggregate(
      epochId,
      proofs.direction.decryptionProof,
      proofs.amount.decryptionProof,
      proofs.minimum.decryptionProof,
    );
    await engine.settle(epochId);
    expect(await adapter.callCount()).to.equal(0n);
    expect(await decryptUint256(await vault.availableHandle(owner.address, await usdc.getAddress())))
      .to.equal(1_000n * usdcUnit);
    expect(await outsiderClient.decrypt(
      await vault.availableHandle(outsider.address, await weth.getAddress()) as never,
    ).then((value: any) => value.value)).to.equal(matchedWeth);
  });

  it("allocates encrypted pro-rata outputs and assigns final rounding dust exactly", async function () {
    const { owner, weth, usdc, vault, adapter, engine } = await deployStrategyFixture();
    const signers = await ethers.getSigners();
    const sellerTwo = signers[2];
    const buyer = signers[3];
    const sellerOneInput = 10n ** 18n;
    const sellerTwoInput = 10n ** 18n + 10n ** 12n;
    const totalSellerInput = sellerOneInput + sellerTwoInput;
    const buyerInput = 5_000n * 10n ** 6n;
    const swapOutput = 2_490n;

    for (const [signer, amount] of [
      [owner, sellerOneInput],
      [sellerTwo, sellerTwoInput],
    ] as const) {
      await weth.mint(signer.address, amount);
      await (weth.connect(signer) as typeof weth).approve(await vault.getAddress(), amount);
      await (vault.connect(signer) as typeof vault).deposit(await weth.getAddress(), amount);
    }
    await usdc.mint(buyer.address, buyerInput);
    await (usdc.connect(buyer) as typeof usdc).approve(await vault.getAddress(), buyerInput);
    await (vault.connect(buyer) as typeof vault).deposit(await usdc.getAddress(), buyerInput);

    const sellerTwoClient = await createEthersHandleClient(sellerTwo, {
      smartContractAddress: noxClient.noxComputeAddress,
      gatewayUrl: noxClient.handleGatewayUrl as `http://${string}`,
      subgraphUrl: "https://example.com/subgraphs/id/none",
    });
    const buyerClient = await createEthersHandleClient(buyer, {
      smartContractAddress: noxClient.noxComputeAddress,
      gatewayUrl: noxClient.handleGatewayUrl as `http://${string}`,
      subgraphUrl: "https://example.com/subgraphs/id/none",
    });
    await createStrategy(engine, 601n, {
      direction: 0n,
      budget: sellerOneInput,
      clip: sellerOneInput,
      limit: 2_400n * 10n ** 18n,
      slippage: 100n,
    });
    await createStrategy(engine.connect(sellerTwo), 602n, {
      direction: 0n,
      budget: sellerTwoInput,
      clip: sellerTwoInput,
      limit: 2_400n * 10n ** 18n,
      slippage: 100n,
    }, sellerTwoClient);
    await createStrategy(engine.connect(buyer), 603n, {
      direction: 1n,
      budget: buyerInput,
      clip: buyerInput,
      limit: 2_600n * 10n ** 18n,
      slippage: 100n,
    }, buyerClient);

    const epochId = await lockEpoch(
      engine,
      BigInt(await networkHelpers.time.latest()) + 600n,
    );
    const proofs = await aggregateProofs(engine, epochId);
    expect(proofs.amount.value).to.equal(10n ** 12n);
    await engine.finalizeAggregate(
      epochId,
      proofs.direction.decryptionProof,
      proofs.amount.decryptionProof,
      proofs.minimum.decryptionProof,
    );
    await adapter.setAmountOut(swapOutput);
    await engine.settle(epochId);

    const totalUsdcOutput = buyerInput + swapOutput;
    const sellerOneFloor = totalUsdcOutput * sellerOneInput / totalSellerInput;
    const sellerTwoFloor = totalUsdcOutput * sellerTwoInput / totalSellerInput;
    const dust = totalUsdcOutput - sellerOneFloor - sellerTwoFloor;
    expect(await decryptUint256(await vault.availableHandle(owner.address, await usdc.getAddress())))
      .to.equal(sellerOneFloor);
    expect(await sellerTwoClient.decrypt(
      await vault.availableHandle(sellerTwo.address, await usdc.getAddress()) as never,
    ).then((value: any) => value.value)).to.equal(sellerTwoFloor + dust);
    expect(await buyerClient.decrypt(
      await vault.availableHandle(buyer.address, await weth.getAddress()) as never,
    ).then((value: any) => value.value)).to.equal(2n * 10n ** 18n);
    expect(sellerOneFloor + sellerTwoFloor + dust).to.equal(totalUsdcOutput);
  });

  it("rejects stale finalization and permissionlessly releases encrypted reservations on timeout", async function () {
    const { owner, outsider, weth, vault, engine } = await deployStrategyFixture();
    await weth.mint(owner.address, 100n);
    await weth.approve(await vault.getAddress(), 100n);
    await vault.deposit(await weth.getAddress(), 100n);
    const strategy = await createStrategy(engine, 501n, {
      direction: 0n,
      budget: 100n,
      clip: 100n,
      limit: 2_400n * 10n ** 18n,
    });
    const deadline = BigInt(await networkHelpers.time.latest()) + 5n;
    const epochId = await lockEpoch(engine, deadline);
    const proofs = await aggregateProofs(engine, epochId);
    await networkHelpers.time.increase(6);
    await expect(engine.finalizeAggregate(
      epochId,
      proofs.direction.decryptionProof,
      proofs.amount.decryptionProof,
      proofs.minimum.decryptionProof,
    )).to.be.revertedWithCustomError(engine, "EpochDeadlinePassed");
    await (engine.connect(outsider) as typeof engine).cancelExpiredEpoch(epochId);
    expect((await engine.getEpoch(epochId)).status).to.equal(6n);
    expect(await decryptUint256(await vault.availableHandle(owner.address, await weth.getAddress())))
      .to.equal(100n);
    expect(await decryptUint256((await engine.strategyHandles(strategy.strategyId)).remaining))
      .to.equal(100n);
  });
});
