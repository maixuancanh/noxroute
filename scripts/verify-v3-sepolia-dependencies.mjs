import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Contract,
  JsonRpcProvider,
  formatEther,
  getAddress,
  keccak256,
  parseEther,
} from "ethers";

export const V3_SEPOLIA = Object.freeze({
  chainId: 11155111n,
  noxCompute: "0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF",
  weth: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  uniswapFactory: "0x0227628f3F023bb0B980b67D528571c95c6DaC1c",
  swapRouter02: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
  fee: 500,
  twapWindow: 300,
  maxDeviationBps: 100,
  epochDuration: 300,
});

const tokenAbi = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];
const factoryAbi = [
  "function getPool(address tokenA,address tokenB,uint24 fee) view returns (address)",
];
const poolAbi = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function liquidity() view returns (uint128)",
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives,uint160[] secondsPerLiquidityCumulativeX128s)",
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
];

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function codeEvidence(provider, address, label) {
  const code = await provider.getCode(address);
  assertCondition(code !== "0x", `${label} has no code at ${address}`);
  return { address: getAddress(address), codeHash: keccak256(code), codeBytes: (code.length - 2) / 2 };
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

export async function verifyV3SepoliaDependencies({
  rpcUrl = process.env.SEPOLIA_RPC_URL,
  deployerAddress = process.env.DEPLOYER_ADDRESS,
  evidencePath = resolve("evidence", "v3-sepolia-dependencies.json"),
  writeEvidence = true,
} = {}) {
  assertCondition(rpcUrl, "SEPOLIA_RPC_URL is required");
  assertCondition(deployerAddress, "DEPLOYER_ADDRESS is required for the balance gate");
  const provider = new JsonRpcProvider(rpcUrl, Number(V3_SEPOLIA.chainId), {
    staticNetwork: true,
  });
  const network = await provider.getNetwork();
  assertCondition(network.chainId === V3_SEPOLIA.chainId, `wrong chainId ${network.chainId}`);
  const blockNumber = await provider.getBlockNumber();

  const factory = new Contract(V3_SEPOLIA.uniswapFactory, factoryAbi, provider);
  const resolvedPool = getAddress(
    await factory.getPool(V3_SEPOLIA.weth, V3_SEPOLIA.usdc, V3_SEPOLIA.fee),
  );
  assertCondition(resolvedPool !== getAddress("0x0000000000000000000000000000000000000000"), "factory returned zero pool");

  const code = {};
  for (const [label, address] of Object.entries({
    noxCompute: V3_SEPOLIA.noxCompute,
    weth: V3_SEPOLIA.weth,
    usdc: V3_SEPOLIA.usdc,
    uniswapFactory: V3_SEPOLIA.uniswapFactory,
    swapRouter02: V3_SEPOLIA.swapRouter02,
    uniswapPool: resolvedPool,
  })) {
    code[label] = await codeEvidence(provider, address, label);
  }

  const weth = new Contract(V3_SEPOLIA.weth, tokenAbi, provider);
  const usdc = new Contract(V3_SEPOLIA.usdc, tokenAbi, provider);
  const tokenMetadata = {
    weth: { symbol: await weth.symbol(), decimals: Number(await weth.decimals()) },
    usdc: { symbol: await usdc.symbol(), decimals: Number(await usdc.decimals()) },
  };
  assertCondition(tokenMetadata.weth.symbol === "WETH", `unexpected WETH symbol ${tokenMetadata.weth.symbol}`);
  assertCondition(tokenMetadata.weth.decimals === 18, `unexpected WETH decimals ${tokenMetadata.weth.decimals}`);
  assertCondition(tokenMetadata.usdc.symbol === "USDC", `unexpected USDC symbol ${tokenMetadata.usdc.symbol}`);
  assertCondition(tokenMetadata.usdc.decimals === 6, `unexpected USDC decimals ${tokenMetadata.usdc.decimals}`);

  const pool = new Contract(resolvedPool, poolAbi, provider);
  const [token0, token1, fee, liquidity, observation, slot0] = await Promise.all([
    pool.token0(),
    pool.token1(),
    pool.fee(),
    pool.liquidity(),
    pool.observe([V3_SEPOLIA.twapWindow, 0]),
    pool.slot0(),
  ]);
  const sorted = [getAddress(V3_SEPOLIA.weth), getAddress(V3_SEPOLIA.usdc)]
    .sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1);
  assertCondition(getAddress(token0) === sorted[0] && getAddress(token1) === sorted[1], "pool token order mismatch");
  assertCondition(Number(fee) === V3_SEPOLIA.fee, `pool fee mismatch ${fee}`);
  assertCondition(liquidity > 0n, "pool liquidity is zero");
  assertCondition(observation.tickCumulatives.length === 2, "observe returned wrong tick array length");

  const normalizedDeployer = getAddress(deployerAddress);
  const deployerBalance = await provider.getBalance(normalizedDeployer);
  const minimumBalance = parseEther(process.env.V3_MIN_DEPLOYER_ETH || "0.02");
  assertCondition(
    deployerBalance >= minimumBalance,
    `deployer balance ${formatEther(deployerBalance)} ETH is below ${formatEther(minimumBalance)} ETH`,
  );

  const evidence = {
    status: "pass",
    chainId: Number(network.chainId),
    verifiedAtBlock: blockNumber,
    generatedAt: new Date().toISOString(),
    resolvedAddresses: {
      noxCompute: getAddress(V3_SEPOLIA.noxCompute),
      weth: getAddress(V3_SEPOLIA.weth),
      usdc: getAddress(V3_SEPOLIA.usdc),
      uniswapFactory: getAddress(V3_SEPOLIA.uniswapFactory),
      swapRouter02: getAddress(V3_SEPOLIA.swapRouter02),
      uniswapPool: resolvedPool,
    },
    code,
    tokenMetadata,
    pool: {
      token0: getAddress(token0),
      token1: getAddress(token1),
      fee: Number(fee),
      liquidity: liquidity.toString(),
      twapWindow: V3_SEPOLIA.twapWindow,
      tickCumulatives: observation.tickCumulatives.map(String),
      spotTick: Number(slot0.tick),
      observationCardinality: Number(slot0.observationCardinality),
    },
    deployer: {
      address: normalizedDeployer,
      balanceWei: deployerBalance.toString(),
      minimumBalanceWei: minimumBalance.toString(),
    },
  };
  if (writeEvidence) atomicWriteJson(evidencePath, evidence);
  return { provider, evidence };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const { evidence } = await verifyV3SepoliaDependencies();
    console.log(`V3 Sepolia dependencies verified at block ${evidence.verifiedAtBlock}`);
    console.log(`pool=${evidence.resolvedAddresses.uniswapPool}`);
    console.log(`deployer=${evidence.deployer.address}`);
    console.log(`deployerBalanceEth=${formatEther(BigInt(evidence.deployer.balanceWei))}`);
  } catch (error) {
    console.error(`V3 Sepolia dependency verification failed: ${error.message || String(error)}`);
    process.exitCode = 1;
  }
}
