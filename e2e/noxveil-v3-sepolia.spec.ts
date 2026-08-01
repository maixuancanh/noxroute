import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "chai";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  ZeroHash,
  formatEther,
  formatUnits,
  parseEther,
  toBeHex,
  zeroPadValue,
} from "ethers";
import { createEthersHandleClient } from "@iexec-nox/handle";

const shouldRun = process.env.RUN_SEPOLIA_V3_E2E === "1";
const maybeDescribe = shouldRun ? describe : describe.skip;
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const deploymentPath = join(projectRoot, "dapp", "v3-deployment.json");
const evidencePath = join(projectRoot, "evidence", "sepolia-e2e-v3.json");

const WETH_DEPOSIT = parseEther("0.001");
const WETH_CLIP = parseEther("0.0005");
const USDC_TO_WAD = 10n ** 12n;
const WAD = 10n ** 18n;
const PUBLIC_DECRYPT_ROLES = [
  "residualDirection",
  "residualAmount",
  "aggregateMinOut",
] as const;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function loadArtifact(relativePath: string) {
  return JSON.parse(readFileSync(join(projectRoot, "artifacts", relativePath), "utf8")) as {
    abi: unknown;
  };
}

function parseEvent(contract: Contract, receipt: any, name: string) {
  const event = receipt?.logs
    .map((log: unknown) => {
      try {
        return contract.interface.parseLog(log as never);
      } catch {
        return null;
      }
    })
    .find((entry: any) => entry?.name === name);
  assert(event, `${name} event is required`);
  return event;
}

async function withRetry<T>(
  label: string,
  action: () => Promise<T>,
  timeoutMs = 360_000,
): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  throw new Error(`${label} timed out: ${String(lastError)}`);
}

function plaintextWord(value: bigint) {
  return zeroPadValue(toBeHex(value), 32).slice(2).toLowerCase();
}

function rejectionText(error: any): string {
  return [
    error?.name,
    error?.message,
    error?.shortMessage,
    error?.reason,
    error?.revert?.name,
    error?.info?.error?.message,
    error?.info?.error?.data?.message,
  ].filter(Boolean).join(" | ");
}

function revertData(error: any): string | null {
  for (const candidate of [
    error?.data,
    error?.error?.data,
    error?.info?.error?.data,
    error?.info?.error?.data?.data,
  ]) {
    if (typeof candidate === "string" && candidate.startsWith("0x")) return candidate;
  }
  return null;
}

async function mustRejectMatching(
  label: string,
  action: () => Promise<unknown>,
  expected: RegExp,
) {
  try {
    await action();
  } catch (error) {
    assert.match(rejectionText(error), expected, `${label} rejected for the wrong reason`);
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function mustRejectCustomError(
  label: string,
  action: () => Promise<unknown>,
  contract: Contract,
  expectedName: string,
) {
  try {
    await action();
  } catch (error: any) {
    const directName = error?.revert?.name || error?.errorName;
    let parsedName = directName;
    const data = revertData(error);
    if (!parsedName && data) {
      try {
        parsedName = contract.interface.parseError(data)?.name;
      } catch {}
    }
    assert.equal(parsedName, expectedName, `${label} rejected for the wrong reason: ${rejectionText(error)}`);
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function sendWithEstimatedGas(label: string, method: any, args: readonly unknown[]) {
  const estimate = await method.estimateGas(...args);
  const gasLimit = estimate * 130n / 100n + 1n;
  if (gasLimit > 16_000_000n) {
    throw new Error(`${label} buffered gas ${gasLimit} exceeds the Sepolia RPC cap`);
  }
  console.log(`${label}EstimatedGas=${estimate} gasLimit=${gasLimit}`);
  return method(...args, { gasLimit });
}

maybeDescribe("Noxveil V3 real Sepolia epoch", function () {
  this.timeout(1_800_000);

  it("encrypts opposing strategies, nets privately, and settles the residual through official Uniswap", async function () {
    const rpcUrl = required("SEPOLIA_RPC_URL");
    const keeperKey = required("V3_KEEPER_PRIVATE_KEY") as `0x${string}`;
    const wethSellerKey = required("V3_WETH_SELLER_PRIVATE_KEY") as `0x${string}`;
    const usdcSellerKey = required("V3_USDC_SELLER_PRIVATE_KEY") as `0x${string}`;
    const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));

    const provider = new JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    expect(network.chainId).to.equal(11155111n);
    const keeper = new Wallet(keeperKey, provider);
    const wethSeller = new Wallet(wethSellerKey, provider);
    const usdcSeller = new Wallet(usdcSellerKey, provider);
    const addresses = {
      keeper: await keeper.getAddress(),
      wethSeller: await wethSeller.getAddress(),
      usdcSeller: await usdcSeller.getAddress(),
    };
    expect(new Set(Object.values(addresses).map((value) => value.toLowerCase())).size)
      .to.equal(3, "keeper and sellers must be three distinct wallets");

    const dependencyCheck = spawnSync(process.execPath, ["scripts/verify-v3-sepolia-dependencies.mjs"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DEPLOYER_ADDRESS: addresses.keeper,
      },
    });
    assert.equal(
      dependencyCheck.status,
      0,
      `official dependency verification failed:\n${dependencyCheck.stdout}\n${dependencyCheck.stderr}`,
    );

    const engineArtifact = loadArtifact("contracts/v3/NoxveilStrategyEngine.sol/NoxveilStrategyEngine.json");
    const vaultArtifact = loadArtifact("contracts/v3/NoxveilVault.sol/NoxveilVault.json");
    const adapterArtifact = loadArtifact("contracts/v3/NoxveilUniswapV3Adapter.sol/NoxveilUniswapV3Adapter.json");
    const erc20Abi = [
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address,address) view returns (uint256)",
      "function approve(address,uint256) returns (bool)",
    ] as const;
    const wethAbi = [
      ...erc20Abi,
      "function deposit() payable",
    ] as const;

    const engine: any = new Contract(deployment.engine, engineArtifact.abi as never, keeper);
    const vault: any = new Contract(deployment.vault, vaultArtifact.abi as never, keeper);
    const adapter = new Contract(deployment.adapter, adapterArtifact.abi as never, provider);
    const weth = new Contract(deployment.weth, wethAbi, provider);
    const usdc = new Contract(deployment.usdc, erc20Abi, provider);
    const activeStrategyCountBefore = await engine.activeStrategyCount() as bigint;
    assert.equal(
      activeStrategyCountBefore,
      0n,
      "Refusing to write into a deployment with active strategies; verify the existing evidence or deploy a fresh E2E instance.",
    );

    const gasBalances = {
      keeper: await provider.getBalance(addresses.keeper),
      wethSeller: await provider.getBalance(addresses.wethSeller),
      usdcSeller: await provider.getBalance(addresses.usdcSeller),
    };
    const usdcAvailable = await usdc.balanceOf(addresses.usdcSeller) as bigint;
    console.log(`chainId=${network.chainId}`);
    console.log(`keeper=${addresses.keeper} balanceEth=${formatEther(gasBalances.keeper)}`);
    console.log(`wethSeller=${addresses.wethSeller} balanceEth=${formatEther(gasBalances.wethSeller)}`);
    console.log(`usdcSeller=${addresses.usdcSeller} balanceEth=${formatEther(gasBalances.usdcSeller)} usdc=${formatUnits(usdcAvailable, 6)}`);
    console.log(`vault=${deployment.vault} engine=${deployment.engine} adapter=${deployment.adapter}`);
    console.log(`officialPool=${deployment.uniswapPool} officialRouter=${deployment.swapRouter02}`);
    expect(gasBalances.keeper, "keeper needs at least 0.02 Sepolia ETH").to.be.gte(parseEther("0.02"));
    expect(gasBalances.wethSeller, "WETH seller needs at least 0.012 Sepolia ETH").to.be.gte(parseEther("0.012"));
    expect(gasBalances.usdcSeller, "USDC seller needs at least 0.01 Sepolia ETH").to.be.gte(parseEther("0.01"));

    const [twapPriceWad] = await adapter.consultTwap() as [bigint, bigint];
    const wethQuoteWad = WETH_CLIP * twapPriceWad / WAD;
    const usdcClip = (wethQuoteWad * 70n / 100n) / USDC_TO_WAD;
    const usdcDeposit = usdcClip * 2n;
    expect(usdcClip).to.be.greaterThan(0n);

    const txs: Record<string, string> = {};
    const wethClient = await createEthersHandleClient(wethSeller);
    const usdcClient = await createEthersHandleClient(usdcSeller);
    const keeperClient = await createEthersHandleClient(keeper);

    async function ownerAvailableBalance(label: string, client: any, owner: string, token: string) {
      const handle = await vault.availableHandle(owner, token) as string;
      if (handle === ZeroHash) return 0n;
      return BigInt((await withRetry(label, async () => client.decrypt(handle))).value);
    }

    const wethAvailableBefore = await ownerAvailableBalance(
      "existing WETH vault balance decrypt",
      wethClient,
      addresses.wethSeller,
      deployment.weth,
    );
    const usdcAvailableBefore = await ownerAvailableBalance(
      "existing USDC vault balance decrypt",
      usdcClient,
      addresses.usdcSeller,
      deployment.usdc,
    );
    const wethDepositNeeded = wethAvailableBefore < WETH_DEPOSIT
      ? WETH_DEPOSIT - wethAvailableBefore
      : 0n;
    const usdcDepositNeeded = usdcAvailableBefore < usdcDeposit
      ? usdcDeposit - usdcAvailableBefore
      : 0n;
    console.log(`vaultWethBefore=${wethAvailableBefore} vaultUsdcBefore=${usdcAvailableBefore}`);

    const wethBalanceBeforeWrap = await weth.balanceOf(addresses.wethSeller) as bigint;
    if (wethBalanceBeforeWrap < wethDepositNeeded) {
      const wrapAmount = wethDepositNeeded - wethBalanceBeforeWrap;
      const sellerWethWrapper: any = new Contract(deployment.weth, wethAbi, wethSeller);
      const wrapTx = await sellerWethWrapper.deposit({ value: wrapAmount });
      txs.wrapWeth = wrapTx.hash;
      expect((await wrapTx.wait())?.status).to.equal(1);
    }

    const sellerWeth: any = new Contract(deployment.weth, wethAbi, wethSeller);
    const sellerUsdc: any = new Contract(deployment.usdc, erc20Abi, usdcSeller);
    if (wethDepositNeeded > 0n) {
      const wethApproveTx = await sellerWeth.approve(deployment.vault, wethDepositNeeded);
      txs.approveWeth = wethApproveTx.hash;
      expect((await wethApproveTx.wait())?.status).to.equal(1);
      const wethDepositTx = await vault.connect(wethSeller).deposit(deployment.weth, wethDepositNeeded);
      txs.depositWeth = wethDepositTx.hash;
      expect((await wethDepositTx.wait())?.status).to.equal(1);
    }

    expect(
      usdcAvailable,
      `USDC seller needs ${formatUnits(usdcDepositNeeded, 6)} additional official USDC`,
    ).to.be.gte(usdcDepositNeeded);
    if (usdcDepositNeeded > 0n) {
      const usdcApproveTx = await sellerUsdc.approve(deployment.vault, usdcDepositNeeded);
      txs.approveUsdc = usdcApproveTx.hash;
      expect((await usdcApproveTx.wait())?.status).to.equal(1);
      const usdcDepositTx = await vault.connect(usdcSeller).deposit(deployment.usdc, usdcDepositNeeded);
      txs.depositUsdc = usdcDepositTx.hash;
      expect((await usdcDepositTx.wait())?.status).to.equal(1);
    }

    const engineAddress = deployment.engine as `0x${string}`;
    const sellerLimit = twapPriceWad * 99n / 100n;
    const buyerLimit = twapPriceWad * 101n / 100n;
    const sellerValues = {
      direction: 0n,
      budget: WETH_DEPOSIT,
      clip: WETH_CLIP,
      limit: sellerLimit,
      slippage: 100n,
    };
    const buyerValues = {
      direction: 1n,
      budget: usdcDeposit,
      clip: usdcClip,
      limit: buyerLimit,
      slippage: 100n,
    };

    async function encryptedInput(client: any, values: typeof sellerValues) {
      const direction = await client.encryptInput(values.direction, "uint16", engineAddress);
      const budget = await client.encryptInput(values.budget, "uint256", engineAddress);
      const clip = await client.encryptInput(values.clip, "uint256", engineAddress);
      const limitPriceWad = await client.encryptInput(values.limit, "uint256", engineAddress);
      const slippageBps = await client.encryptInput(values.slippage, "uint256", engineAddress);
      return {
        direction: direction.handle,
        directionProof: direction.handleProof,
        budget: budget.handle,
        budgetProof: budget.handleProof,
        clip: clip.handle,
        clipProof: clip.handleProof,
        limitPriceWad: limitPriceWad.handle,
        limitPriceProof: limitPriceWad.handleProof,
        slippageBps: slippageBps.handle,
        slippageProof: slippageBps.handleProof,
      };
    }

    const sellerInput = await encryptedInput(wethClient, sellerValues);
    const buyerInput = await encryptedInput(usdcClient, buyerValues);
    const nonceBase = BigInt(Date.now());
    const sellerNonce = nonceBase;
    const buyerNonce = nonceBase + 1n;
    const sellerEngine = engine.connect(wethSeller);
    const sellerTx = await sendWithEstimatedGas(
      "createWethStrategy",
      sellerEngine.createStrategy,
      [sellerInput, sellerNonce],
    );
    for (const value of [sellerValues.budget, sellerValues.clip, sellerValues.limit, sellerValues.slippage]) {
      expect(sellerTx.data.toLowerCase()).to.not.include(plaintextWord(value), `seller plaintext leaked: ${value}`);
    }
    txs.createWethStrategy = sellerTx.hash;
    const sellerReceipt = await sellerTx.wait();
    expect(sellerReceipt?.status).to.equal(1);
    const sellerStrategyId = parseEvent(engine, sellerReceipt, "StrategyCreated").args.strategyId as string;

    const buyerEngine = engine.connect(usdcSeller);
    const buyerTx = await sendWithEstimatedGas(
      "createUsdcStrategy",
      buyerEngine.createStrategy,
      [buyerInput, buyerNonce],
    );
    for (const value of [buyerValues.budget, buyerValues.clip, buyerValues.limit, buyerValues.slippage]) {
      expect(buyerTx.data.toLowerCase()).to.not.include(plaintextWord(value), `buyer plaintext leaked: ${value}`);
    }
    txs.createUsdcStrategy = buyerTx.hash;
    const buyerReceipt = await buyerTx.wait();
    expect(buyerReceipt?.status).to.equal(1);
    const buyerStrategyId = parseEvent(engine, buyerReceipt, "StrategyCreated").args.strategyId as string;

    const latest = await provider.getBlock("latest");
    assert(latest);
    const deadline = BigInt(latest.timestamp + 1_200);
    const lockTx = await sendWithEstimatedGas(
      "lockEpoch",
      engine.lockCurrentEpoch,
      [deadline],
    );
    txs.lockEpoch = lockTx.hash;
    const lockReceipt = await lockTx.wait();
    expect(lockReceipt?.status).to.equal(1);
    const epochId = parseEvent(engine, lockReceipt, "EpochOpened").args.epochId as string;
    const lockedEpoch = await engine.getEpoch(epochId);
    expect(lockedEpoch.participantCount).to.equal(2n);
    expect(lockedEpoch.status).to.equal(2n);

    const privateHandles = await engine.epochPrivateHandles(epochId);
    const publicResults = {
      direction: await withRetry("public direction decrypt", () => keeperClient.publicDecrypt(lockedEpoch.residualDirectionHandle)),
      amount: await withRetry("public amount decrypt", () => keeperClient.publicDecrypt(lockedEpoch.residualAmountHandle)),
      minimum: await withRetry("public minimum decrypt", () => keeperClient.publicDecrypt(lockedEpoch.aggregateMinOutHandle)),
    };
    expect(publicResults.direction.value).to.equal(0n);
    expect(publicResults.amount.value).to.be.greaterThan(0n);
    expect(publicResults.minimum.value).to.be.greaterThan(0n);

    const requestedQuoteWad = await withRetry("owner requested quote decrypt", async () =>
      (await wethClient.decrypt(privateHandles.totalRequestedQuote)).value as bigint,
    );
    const matchedQuoteWad = await withRetry("owner matched quote decrypt", async () =>
      (await wethClient.decrypt(privateHandles.matchedQuote)).value as bigint,
    );
    const settlementResidualQuoteWad = BigInt(publicResults.amount.value)
      * BigInt(lockedEpoch.twapPriceWad) / WAD;
    const netResidualQuoteWad = requestedQuoteWad - 2n * matchedQuoteWad;
    const roundingDustQuoteWad = netResidualQuoteWad - settlementResidualQuoteWad;
    const maxRoundingDustQuoteWad = (BigInt(lockedEpoch.twapPriceWad) + WAD - 1n) / WAD;
    expect(requestedQuoteWad).to.be.greaterThan(0n);
    expect(matchedQuoteWad).to.be.greaterThan(0n);
    expect(netResidualQuoteWad).to.be.greaterThanOrEqual(settlementResidualQuoteWad);
    expect(netResidualQuoteWad).to.be.lessThan(requestedQuoteWad);
    expect(roundingDustQuoteWad).to.be.lessThan(maxRoundingDustQuoteWad);
    await mustRejectMatching(
      "keeper private aggregate decrypt",
      () => keeperClient.decrypt(privateHandles.matchedQuote),
      /does not exist or user .* is not authorized to decrypt it/i,
    );

    const finalizeTx = await sendWithEstimatedGas(
      "finalizeAggregate",
      engine.finalizeAggregate,
      [
        epochId,
        publicResults.direction.decryptionProof,
        publicResults.amount.decryptionProof,
        publicResults.minimum.decryptionProof,
      ],
    );
    txs.finalizeAggregate = finalizeTx.hash;
    expect((await finalizeTx.wait())?.status).to.equal(1);
    await mustRejectCustomError("aggregate proof replay", async () => {
      const replay = await engine.finalizeAggregate(
        epochId,
        publicResults.direction.decryptionProof,
        publicResults.amount.decryptionProof,
        publicResults.minimum.decryptionProof,
      );
      await replay.wait();
    }, engine, "InvalidEpochStatus");

    const settleTx = await sendWithEstimatedGas(
      "settlement",
      engine.settle,
      [epochId],
    );
    txs.settlement = settleTx.hash;
    const settleReceipt = await settleTx.wait();
    expect(settleReceipt?.status).to.equal(1);
    const settled = await engine.getEpoch(epochId);
    expect(settled.status).to.equal(5n);
    expect(settled.amountOut).to.be.gte(settled.amountOutMinimum);
    await mustRejectCustomError("settlement replay", async () => {
      const replay = await engine.settle(epochId);
      await replay.wait();
    }, engine, "InvalidEpochStatus");

    const sellerUsdcAfter = await withRetry("seller USDC owner decrypt", async () =>
      (await wethClient.decrypt(await vault.availableHandle(addresses.wethSeller, deployment.usdc))).value as bigint,
    );
    const buyerWethAfter = await withRetry("buyer WETH owner decrypt", async () =>
      (await usdcClient.decrypt(await vault.availableHandle(addresses.usdcSeller, deployment.weth))).value as bigint,
    );
    const sellerRemaining = await withRetry("seller remaining owner decrypt", async () =>
      (await wethClient.decrypt((await engine.strategyHandles(sellerStrategyId)).remaining)).value as bigint,
    );
    const buyerRemaining = await withRetry("buyer remaining owner decrypt", async () =>
      (await usdcClient.decrypt((await engine.strategyHandles(buyerStrategyId)).remaining)).value as bigint,
    );
    expect(sellerUsdcAfter).to.be.greaterThan(0n);
    expect(buyerWethAfter).to.be.greaterThan(0n);
    expect(sellerRemaining).to.be.lessThan(sellerValues.budget);
    expect(buyerRemaining).to.be.lessThan(buyerValues.budget);
    const sellerOutputHandle = await vault.availableHandle(addresses.wethSeller, deployment.usdc);
    const buyerOutputHandle = await vault.availableHandle(addresses.usdcSeller, deployment.weth);
    await mustRejectMatching(
      "keeper seller output decrypt",
      () => keeperClient.decrypt(sellerOutputHandle),
      /does not exist or user .* is not authorized to decrypt it/i,
    );
    await mustRejectMatching(
      "keeper buyer output decrypt",
      () => keeperClient.decrypt(buyerOutputHandle),
      /does not exist or user .* is not authorized to decrypt it/i,
    );

    const verifiedAtBlock = await provider.getBlockNumber();
    const evidence = {
      status: "pass",
      chainId: Number(network.chainId),
      addresses: {
        ...addresses,
        vault: deployment.vault,
        engine: deployment.engine,
        adapter: deployment.adapter,
      },
      users: [
        { role: "wethSeller", address: addresses.wethSeller, strategyId: sellerStrategyId },
        { role: "usdcSeller", address: addresses.usdcSeller, strategyId: buyerStrategyId },
      ],
      epochId,
      handles: {
        publiclyDecrypted: PUBLIC_DECRYPT_ROLES,
        keptPrivate: ["clips", "limits", "slippage", "remaining", "balances", "allocations"],
      },
      transactions: txs,
      uniswap: {
        pool: deployment.uniswapPool,
        router: deployment.swapRouter02,
        settlementTx: txs.settlement,
        residualDirection: Number(publicResults.direction.value),
        residualAmount: publicResults.amount.value.toString(),
        amountOutMinimum: publicResults.minimum.value.toString(),
        amountOut: settled.amountOut.toString(),
      },
      privacySavings: {
        disclosure: "authorized participant E2E disclosure; not public Nox decryption",
        requestedQuoteWad: requestedQuoteWad.toString(),
        matchedQuoteWad: matchedQuoteWad.toString(),
        netResidualQuoteWad: netResidualQuoteWad.toString(),
        settlementResidualQuoteWad: settlementResidualQuoteWad.toString(),
        roundingDustQuoteWad: roundingDustQuoteWad.toString(),
      },
      ownerDecryptedAfter: {
        wethSellerUsdc: sellerUsdcAfter.toString(),
        usdcSellerWeth: buyerWethAfter.toString(),
        wethSellerRemaining: sellerRemaining.toString(),
        usdcSellerRemaining: buyerRemaining.toString(),
      },
      unauthorizedDecryptionRejected: true,
      replayRejected: true,
      verifiedAtBlock,
    };
    mkdirSync(dirname(evidencePath), { recursive: true });
    const temporaryPath = `${evidencePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, evidencePath);
    console.log(`epochId=${epochId}`);
    console.log(`settlementTx=${txs.settlement}`);
    console.log(`evidence=${evidencePath}`);
  });
});
