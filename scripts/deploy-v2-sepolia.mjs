import fs from "node:fs";
import path from "node:path";
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

const rpcUrl = process.env.SEPOLIA_RPC_URL;
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL is required");
if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY is required");

const UNISWAP_V3_FACTORY_SEPOLIA = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";
const UNISWAP_V3_NPM_SEPOLIA = "0x1238536071E1c677A632429e3655c799b22cDA52";
const UNISWAP_SWAP_ROUTER_02_SEPOLIA = "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E";
const FEE = 3000;
const Q96 = 79228162514264337593543950336n;
const PRICE_4X_IF_TOKEN_IN_IS_TOKEN0 = Q96 * 2n;
const PRICE_4X_IF_TOKEN_IN_IS_TOKEN1 = Q96 / 2n;
const LIQUIDITY_TOKEN_IN = parseEther("20");
const LIQUIDITY_TOKEN_OUT = parseEther("80");

const factoryAbi = [
  "function getPool(address tokenA,address tokenB,uint24 fee) view returns (address)",
];

const npmAbi = [
  "function createAndInitializePoolIfNecessary(address token0,address token1,uint24 fee,uint160 sqrtPriceX96) payable returns (address pool)",
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
];

function artifact(relativePath) {
  return JSON.parse(fs.readFileSync(path.join("artifacts", relativePath), "utf8"));
}

async function deploy(factory, args, label) {
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const tx = contract.deploymentTransaction();
  console.log(`${label}=${address}`);
  if (tx) console.log(`${label}DeployTx=${tx.hash}`);
  return contract;
}

function sortTokenPair(tokenIn, tokenOut) {
  return tokenIn.toLowerCase() < tokenOut.toLowerCase()
    ? { token0: tokenIn, token1: tokenOut, tokenInIsToken0: true }
    : { token0: tokenOut, token1: tokenIn, tokenInIsToken0: false };
}

const provider = new JsonRpcProvider(rpcUrl);
const deployer = new Wallet(privateKey, provider);
console.log(`deployer=${await deployer.getAddress()}`);
console.log(`deployerBalanceEth=${formatEther(await provider.getBalance(deployer))}`);

const tokenArtifact = artifact("contracts/test/MockERC20.sol/MockERC20.json");
const evaluatorArtifact = artifact("contracts/NoxBatchEvaluator.sol/NoxBatchEvaluator.json");
const adapterArtifact = artifact("contracts/UniswapV3BatchSwapAdapter.sol/UniswapV3BatchSwapAdapter.json");
const batchArtifact = artifact("contracts/NoxBatchRouterV2.sol/NoxBatchRouterV2.json");

const tokenIn = await deploy(
  new ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, deployer),
  ["Batch Official In", "BOIN"],
  "v2TokenIn",
);
const tokenOut = await deploy(
  new ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, deployer),
  ["Batch Official Out", "BOOUT"],
  "v2TokenOut",
);
const tokenInAddress = await tokenIn.getAddress();
const tokenOutAddress = await tokenOut.getAddress();

const pair = sortTokenPair(tokenInAddress, tokenOutAddress);
const sqrtPriceX96 = pair.tokenInIsToken0
  ? PRICE_4X_IF_TOKEN_IN_IS_TOKEN0
  : PRICE_4X_IF_TOKEN_IN_IS_TOKEN1;
const amount0Desired = pair.tokenInIsToken0 ? LIQUIDITY_TOKEN_IN : LIQUIDITY_TOKEN_OUT;
const amount1Desired = pair.tokenInIsToken0 ? LIQUIDITY_TOKEN_OUT : LIQUIDITY_TOKEN_IN;

const npm = new Contract(UNISWAP_V3_NPM_SEPOLIA, npmAbi, deployer);
const factory = new Contract(UNISWAP_V3_FACTORY_SEPOLIA, factoryAbi, provider);
for (const token of [tokenIn, tokenOut]) {
  await (await token.mint(await deployer.getAddress(), parseEther("200"))).wait();
  await (await token.approve(UNISWAP_V3_NPM_SEPOLIA, parseEther("200"))).wait();
}
const createPoolTx = await npm.createAndInitializePoolIfNecessary(pair.token0, pair.token1, FEE, sqrtPriceX96);
console.log(`v2CreatePoolTx=${createPoolTx.hash}`);
await createPoolTx.wait();
const pool = await factory.getPool(pair.token0, pair.token1, FEE);
console.log(`v2OfficialUniswapPool=${pool}`);

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
  recipient: await deployer.getAddress(),
  deadline: Math.floor(Date.now() / 1000) + 3600,
}, { gasLimit: 1_500_000 });
console.log(`v2MintLiquidityTx=${mintPositionTx.hash}`);
await mintPositionTx.wait();

const evaluator = await deploy(
  new ContractFactory(evaluatorArtifact.abi, evaluatorArtifact.bytecode, deployer),
  [],
  "v2NoxEvaluator",
);
const adapter = await deploy(
  new ContractFactory(adapterArtifact.abi, adapterArtifact.bytecode, deployer),
  [
    await deployer.getAddress(),
    tokenInAddress,
    tokenOutAddress,
    UNISWAP_SWAP_ROUTER_02_SEPOLIA,
    FEE,
  ],
  "v2UniswapAdapter",
);
const batch = await deploy(
  new ContractFactory(batchArtifact.abi, batchArtifact.bytecode, deployer),
  [
    tokenInAddress,
    tokenOutAddress,
    await adapter.getAddress(),
    await evaluator.getAddress(),
    3600,
  ],
  "noxBatchRouterV2",
);
const setControllerTx = await adapter.setController(await batch.getAddress());
console.log(`v2SetAdapterControllerTx=${setControllerTx.hash}`);
await setControllerTx.wait();

const epochId = keccak256(toUtf8Bytes(`nox-batch-v2-${Date.now()}`));
const openTx = await batch.openEpoch(epochId, Math.floor(Date.now() / 1000) + 3600);
console.log(`v2OpenEpochTx=${openTx.hash}`);
await openTx.wait();

const deployment = {
  chainId: 11155111,
  tokenIn: tokenInAddress,
  tokenOut: tokenOutAddress,
  uniswapPool: pool,
  swapRouter02: UNISWAP_SWAP_ROUTER_02_SEPOLIA,
  noxEvaluator: await evaluator.getAddress(),
  uniswapAdapter: await adapter.getAddress(),
  noxBatchRouterV2: await batch.getAddress(),
  activeEpochId: epochId,
};
fs.writeFileSync("dapp/v2-deployment.json", `${JSON.stringify(deployment, null, 2)}\n`);
console.log(JSON.stringify(deployment, null, 2));
