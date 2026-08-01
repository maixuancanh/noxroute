import { expect } from "chai";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  keccak256,
  parseEther,
  toUtf8Bytes,
} from "ethers";
import { createEthersHandleClient } from "@iexec-nox/handle";

const shouldRun = process.env.RUN_SEPOLIA_E2E === "1";
const maybeDescribe = shouldRun ? describe : describe.skip;

function loadArtifact(relativePath: string) {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const artifactPath = join(testDir, "..", "artifacts", relativePath);
  return JSON.parse(readFileSync(artifactPath, "utf8")) as {
    abi: unknown;
    bytecode: `0x${string}`;
  };
}

async function deploy(factory: ContractFactory, args: unknown[], label: string) {
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const tx = contract.deploymentTransaction();
  console.log(`${label}=${await contract.getAddress()}`);
  if (tx) console.log(`${label}DeployTx=${tx.hash}`);
  return contract as any;
}

async function publicDecryptWithRetry(
  handleClient: any,
  handle: string,
  timeoutMs = 180_000,
) {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await handleClient.publicDecrypt(handle);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  throw lastError;
}

maybeDescribe("NoxBatch Sepolia E2E", function () {
  this.timeout(1_000_000);

  it("privately nets three intents and settles one aggregate router swap", async function () {
    const rpcUrl = process.env.SEPOLIA_RPC_URL;
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    expect(rpcUrl, "SEPOLIA_RPC_URL is required").to.be.a("string");
    expect(privateKey, "DEPLOYER_PRIVATE_KEY is required").to.be.a("string");

    const provider = new JsonRpcProvider(rpcUrl);
    const coordinator = new Wallet(privateKey as `0x${string}`, provider);
    const handleClient = await createEthersHandleClient(coordinator);
    const users = Array.from({ length: 3 }, () =>
      Wallet.createRandom().connect(provider),
    );
    for (const user of users) {
      const tx = await coordinator.sendTransaction({
        to: await user.getAddress(),
        value: parseEther("0.004"),
      });
      await tx.wait();
    }

    const tokenArtifact = loadArtifact("contracts/test/MockERC20.sol/MockERC20.json");
    const routerArtifact = loadArtifact(
      "contracts/test/MockSwapRouter.sol/MockSwapRouter.json",
    );
    const evaluatorArtifact = loadArtifact(
      "contracts/NoxBatchEvaluator.sol/NoxBatchEvaluator.json",
    );
    const batchArtifact = loadArtifact("contracts/NoxBatchRouter.sol/NoxBatchRouter.json");

    const tokenIn = await deploy(
      new ContractFactory(tokenArtifact.abi as never, tokenArtifact.bytecode, coordinator),
      ["Token In", "TIN"],
      "tokenIn",
    );
    const tokenOut = await deploy(
      new ContractFactory(tokenArtifact.abi as never, tokenArtifact.bytecode, coordinator),
      ["Token Out", "TOUT"],
      "tokenOut",
    );
    const swapRouter = await deploy(
      new ContractFactory(routerArtifact.abi as never, routerArtifact.bytecode, coordinator),
      [await tokenIn.getAddress(), await tokenOut.getAddress()],
      "swapRouterTarget",
    );
    const evaluator = await deploy(
      new ContractFactory(evaluatorArtifact.abi as never, evaluatorArtifact.bytecode, coordinator),
      [],
      "noxEvaluator",
    );
    const userAddresses = await Promise.all(users.map((user) => user.getAddress()));
    const batch = await deploy(
      new ContractFactory(batchArtifact.abi as never, batchArtifact.bytecode, coordinator),
      [
        await coordinator.getAddress(),
        userAddresses,
        await tokenIn.getAddress(),
        await tokenOut.getAddress(),
        await swapRouter.getAddress(),
        await evaluator.getAddress(),
        3600,
      ],
      "noxBatchRouter",
    );
    const setAmountOutTx = await swapRouter.setAmountOut(300);
    console.log(`setRouterAmountOutTx=${setAmountOutTx.hash}`);
    await setAmountOutTx.wait();
    const seedRouterTx = await tokenOut.mint(await swapRouter.getAddress(), 300);
    console.log(`seedRouterTokenOutTx=${seedRouterTx.hash}`);
    await seedRouterTx.wait();

    const epochId = keccak256(toUtf8Bytes(`nox-batch-${Date.now()}`));
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const openTx = await batch.openEpoch(epochId, deadline);
    console.log(`epochId=${epochId}`);
    console.log(`openEpochTx=${openTx.hash}`);
    await openTx.wait();

    const amounts = [40n, 50n, 60n] as const;
    const minOuts = [50n, 60n, 70n] as const;
    const escrows = [50, 60, 70] as const;
    for (let index = 0; index < users.length; index += 1) {
      const user = users[index];
      const mintTx = await tokenIn.mint(await user.getAddress(), escrows[index]);
      await mintTx.wait();
      const approveTx = await tokenIn.connect(user).approve(
        await batch.getAddress(),
        escrows[index],
      );
      await approveTx.wait();
      const userHandleClient = await createEthersHandleClient(user);
      const { handle: amountHandle, handleProof: amountProof } =
        await userHandleClient.encryptInput(amounts[index], "uint256", await batch.getAddress());
      const { handle: minOutHandle, handleProof: minOutProof } =
        await userHandleClient.encryptInput(minOuts[index], "uint256", await batch.getAddress());
      const submitTx = await batch.connect(user)[
        "submitIntent(bytes32,bytes32,bytes,bytes32,bytes,uint128)"
      ](epochId, amountHandle, amountProof, minOutHandle, minOutProof, escrows[index]);
      console.log(`amount${index + 1}Handle=${amountHandle}`);
      console.log(`minOut${index + 1}Handle=${minOutHandle}`);
      console.log(`submitIntent${index + 1}Tx=${submitTx.hash}`);
      await submitTx.wait();
    }

    const requestTx = await batch.requestNetting(epochId);
    console.log(`requestNettingTx=${requestTx.hash}`);
    const requestReceipt = await requestTx.wait();
    const event = requestReceipt?.logs
      .map((log: unknown) => {
        try {
          return batch.interface.parseLog(log as never);
        } catch {
          return null;
        }
      })
      .find((log: { name?: string } | null) => log?.name === "NettingRequested");
    expect(event, "NettingRequested event is required").to.not.equal(undefined);
    const requestId = event!.args[1] as string;
    const [debitHandles, outputHandles] = await evaluator.resultHandlesOf(requestId);
    console.log(`requestId=${requestId}`);

    const debitProofs: string[] = [];
    const outputProofs: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      console.log(`debit${index + 1}Handle=${debitHandles[index]}`);
      console.log(`output${index + 1}Handle=${outputHandles[index]}`);
      const debit = await publicDecryptWithRetry(handleClient, debitHandles[index]);
      const output = await publicDecryptWithRetry(handleClient, outputHandles[index]);
      expect(debit.value).to.equal(amounts[index]);
      expect(output.value).to.equal(amounts[index] * 2n);
      debitProofs.push(debit.decryptionProof);
      outputProofs.push(output.decryptionProof);
    }

    const deliverTx = await evaluator.deliverNetting(
      requestId,
      debitProofs,
      outputProofs,
    );
    console.log(`deliverNettingTx=${deliverTx.hash}`);
    await deliverTx.wait();

    const settleTx = await batch.settle(epochId, 300);
    console.log(`settleTx=${settleTx.hash}`);
    await settleTx.wait();

    expect(await tokenOut.balanceOf(await users[0].getAddress())).to.equal(80n);
    expect(await tokenOut.balanceOf(await users[1].getAddress())).to.equal(100n);
    expect(await tokenOut.balanceOf(await users[2].getAddress())).to.equal(120n);
    expect(await tokenIn.balanceOf(await users[0].getAddress())).to.equal(10n);
    expect(await tokenIn.balanceOf(await users[1].getAddress())).to.equal(10n);
    expect(await tokenIn.balanceOf(await users[2].getAddress())).to.equal(10n);
  });
});
