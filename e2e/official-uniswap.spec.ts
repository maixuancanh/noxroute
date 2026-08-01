import { expect } from "chai";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  formatEther,
  keccak256,
  parseEther,
  toUtf8Bytes,
} from "ethers";
import { createEthersHandleClient } from "@iexec-nox/handle";

const shouldRun = process.env.RUN_SEPOLIA_E2E === "1";
const maybeDescribe = shouldRun ? describe : describe.skip;

const UNISWAP_V3_FACTORY_SEPOLIA = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";
const UNISWAP_V3_NPM_SEPOLIA = "0x1238536071E1c677A632429e3655c799b22cDA52";
const UNISWAP_SWAP_ROUTER_02_SEPOLIA = "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E";
const FEE = 3000;
const Q96 = 79228162514264337593543950336n;
const PRICE_4X_IF_TOKEN_IN_IS_TOKEN0 = Q96 * 2n;
const PRICE_4X_IF_TOKEN_IN_IS_TOKEN1 = Q96 / 2n;
const UNIT = parseEther("1");
const LIQUIDITY_TOKEN_IN = parseEther("20");
const LIQUIDITY_TOKEN_OUT = parseEther("80");

const factoryAbi = [
  "function getPool(address tokenA,address tokenB,uint24 fee) view returns (address)",
] as const;

const npmAbi = [
  "function createAndInitializePoolIfNecessary(address token0,address token1,uint24 fee,uint160 sqrtPriceX96) payable returns (address pool)",
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
] as const;

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

function sortTokenPair(tokenIn: string, tokenOut: string) {
  return tokenIn.toLowerCase() < tokenOut.toLowerCase()
    ? { token0: tokenIn, token1: tokenOut, tokenInIsToken0: true }
    : { token0: tokenOut, token1: tokenIn, tokenInIsToken0: false };
}

maybeDescribe("NoxBatch official Uniswap V3 Sepolia E2E", function () {
  this.timeout(1_200_000);

  it("privately nets three intents and settles through official Uniswap SwapRouter02", async function () {
    const rpcUrl = process.env.SEPOLIA_RPC_URL;
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    expect(rpcUrl, "SEPOLIA_RPC_URL is required").to.be.a("string");
    expect(privateKey, "DEPLOYER_PRIVATE_KEY is required").to.be.a("string");

    const provider = new JsonRpcProvider(rpcUrl);
    const coordinator = new Wallet(privateKey as `0x${string}`, provider);
    const handleClient = await createEthersHandleClient(coordinator);
    console.log(`officialUniswapFactory=${UNISWAP_V3_FACTORY_SEPOLIA}`);
    console.log(`officialUniswapNPM=${UNISWAP_V3_NPM_SEPOLIA}`);
    console.log(`officialUniswapSwapRouter02=${UNISWAP_SWAP_ROUTER_02_SEPOLIA}`);
    console.log(`coordinator=${await coordinator.getAddress()}`);
    console.log(`coordinatorBalanceEth=${formatEther(await provider.getBalance(coordinator))}`);

    const users = Array.from({ length: 3 }, () =>
      Wallet.createRandom().connect(provider),
    );
    for (const user of users) {
      const tx = await coordinator.sendTransaction({
        to: await user.getAddress(),
        value: parseEther("0.003"),
      });
      await tx.wait();
    }

    const tokenArtifact = loadArtifact("contracts/test/MockERC20.sol/MockERC20.json");
    const evaluatorArtifact = loadArtifact("contracts/NoxBatchEvaluator.sol/NoxBatchEvaluator.json");
    const batchArtifact = loadArtifact("contracts/NoxBatchRouter.sol/NoxBatchRouter.json");
    const adapterArtifact = loadArtifact("contracts/UniswapV3BatchSwapAdapter.sol/UniswapV3BatchSwapAdapter.json");

    const tokenIn = await deploy(
      new ContractFactory(tokenArtifact.abi as never, tokenArtifact.bytecode, coordinator),
      ["Batch Official In", "BOIN"],
      "officialTokenIn",
    );
    const tokenOut = await deploy(
      new ContractFactory(tokenArtifact.abi as never, tokenArtifact.bytecode, coordinator),
      ["Batch Official Out", "BOOUT"],
      "officialTokenOut",
    );

    const tokenInAddress = await tokenIn.getAddress();
    const tokenOutAddress = await tokenOut.getAddress();
    const pair = sortTokenPair(tokenInAddress, tokenOutAddress);
    const sqrtPriceX96 = pair.tokenInIsToken0
      ? PRICE_4X_IF_TOKEN_IN_IS_TOKEN0
      : PRICE_4X_IF_TOKEN_IN_IS_TOKEN1;
    const amount0Desired = pair.tokenInIsToken0 ? LIQUIDITY_TOKEN_IN : LIQUIDITY_TOKEN_OUT;
    const amount1Desired = pair.tokenInIsToken0 ? LIQUIDITY_TOKEN_OUT : LIQUIDITY_TOKEN_IN;

    const npm = new Contract(UNISWAP_V3_NPM_SEPOLIA, npmAbi, coordinator);
    const factory = new Contract(UNISWAP_V3_FACTORY_SEPOLIA, factoryAbi, provider);
    for (const token of [tokenIn, tokenOut]) {
      const mintTx = await token.mint(await coordinator.getAddress(), parseEther("200"));
      await mintTx.wait();
      const approveTx = await token.approve(UNISWAP_V3_NPM_SEPOLIA, parseEther("200"));
      await approveTx.wait();
    }
    const createPoolTx = await npm.createAndInitializePoolIfNecessary(
      pair.token0,
      pair.token1,
      FEE,
      sqrtPriceX96,
    );
    console.log(`officialCreatePoolTx=${createPoolTx.hash}`);
    await createPoolTx.wait();
    const pool = await factory.getPool(pair.token0, pair.token1, FEE);
    console.log(`officialUniswapPool=${pool}`);
    expect(pool).to.not.equal("0x0000000000000000000000000000000000000000");

    const mintPositionTx = await npm.mint({
      token0: pair.token0,
      token1: pair.token1,
      fee: FEE,
      tickLower: -887220,
      tickUpper: 887220,
      amount0Desired,
      amount1Desired,
      amount0Min: 0,
      amount1Min: 0,
      recipient: await coordinator.getAddress(),
      deadline: Math.floor(Date.now() / 1000) + 3600,
    }, {
      gasLimit: 1_500_000,
    });
    console.log(`officialMintLiquidityTx=${mintPositionTx.hash}`);
    await mintPositionTx.wait();

    const evaluator = await deploy(
      new ContractFactory(evaluatorArtifact.abi as never, evaluatorArtifact.bytecode, coordinator),
      [],
      "noxEvaluator",
    );
    const userAddresses = await Promise.all(users.map((user) => user.getAddress()));
    const adapter = await deploy(
      new ContractFactory(adapterArtifact.abi as never, adapterArtifact.bytecode, coordinator),
      [
        await coordinator.getAddress(),
        tokenInAddress,
        tokenOutAddress,
        UNISWAP_SWAP_ROUTER_02_SEPOLIA,
        FEE,
      ],
      "officialUniswapBatchAdapter",
    );
    const batch = await deploy(
      new ContractFactory(batchArtifact.abi as never, batchArtifact.bytecode, coordinator),
      [
        await coordinator.getAddress(),
        userAddresses,
        tokenInAddress,
        tokenOutAddress,
        await adapter.getAddress(),
        await evaluator.getAddress(),
        3600,
      ],
      "noxBatchRouterOfficialUniswap",
    );
    const setControllerTx = await adapter.setController(await batch.getAddress());
    console.log(`setOfficialAdapterControllerTx=${setControllerTx.hash}`);
    await setControllerTx.wait();

    const epochId = keccak256(toUtf8Bytes(`nox-batch-official-uniswap-${Date.now()}`));
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const openTx = await batch.openEpoch(epochId, deadline);
    console.log(`epochId=${epochId}`);
    console.log(`openEpochTx=${openTx.hash}`);
    await openTx.wait();

    const amounts = [
      parseEther("0.2"),
      parseEther("0.3"),
      parseEther("0.4"),
    ] as const;
    const escrows = amounts;
    const expectedOutputs = amounts.map((amount) => amount * 2n);
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
        await userHandleClient.encryptInput(expectedOutputs[index], "uint256", await batch.getAddress());
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
      expect(output.value).to.equal(expectedOutputs[index]);
      debitProofs.push(debit.decryptionProof);
      outputProofs.push(output.decryptionProof);
    }

    const deliverTx = await evaluator.deliverNetting(requestId, debitProofs, outputProofs);
    console.log(`deliverNettingTx=${deliverTx.hash}`);
    await deliverTx.wait();

    const totalExpectedOutput = expectedOutputs.reduce((sum, value) => sum + value, 0n);
    const settleTx = await batch.settle(epochId, totalExpectedOutput);
    console.log(`settleOfficialUniswapTx=${settleTx.hash}`);
    await settleTx.wait();

    for (let index = 0; index < users.length; index += 1) {
      expect(await tokenOut.balanceOf(await users[index].getAddress())).to.equal(expectedOutputs[index]);
    }
    const surplus = await tokenOut.balanceOf(await batch.getAddress());
    console.log(`officialUniswapBatchSurplus=${surplus.toString()}`);
  });
});
