import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  formatEther,
  formatUnits,
  parseEther,
  parseUnits,
} from "ethers";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const deployment = JSON.parse(readFileSync(join(projectRoot, "dapp", "v3-deployment.json"), "utf8"));
const evidencePath = join(projectRoot, "evidence", "sepolia-e2e-v3-funding.json");
const rpcUrl = required("SEPOLIA_RPC_URL");
const sourceKey = required("V3_FUNDING_PRIVATE_KEY");
const keeperKey = required("V3_KEEPER_PRIVATE_KEY");
const wethSellerKey = required("V3_WETH_SELLER_PRIVATE_KEY");
const usdcSellerKey = required("V3_USDC_SELLER_PRIVATE_KEY");
const provider = new JsonRpcProvider(rpcUrl);
const source = new Wallet(sourceKey, provider);
const keeper = new Wallet(keeperKey, provider);
const wethSeller = new Wallet(wethSellerKey, provider);
const usdcSeller = new Wallet(usdcSellerKey, provider);

const GAS_TARGET = parseEther(process.env.V3_E2E_GAS_TARGET_ETH || "0.018");
const SETUP_SWAP_WETH = parseEther(process.env.V3_E2E_SETUP_SWAP_WETH || "0.002");
const USDC_TARGET = parseUnits(process.env.V3_E2E_USDC_TARGET || "6", 6);
const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
] ;
const wethAbi = [...erc20Abi, "function deposit() payable"];
const routerAbi = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
];
const adapterAbi = ["function consultTwap() view returns (uint256 priceWad,int24 arithmeticMeanTick)"];

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const network = await provider.getNetwork();
  if (network.chainId !== 11155111n) throw new Error(`expected Sepolia 11155111, got ${network.chainId}`);
  const addresses = {
    source: await source.getAddress(),
    keeper: await keeper.getAddress(),
    wethSeller: await wethSeller.getAddress(),
    usdcSeller: await usdcSeller.getAddress(),
  };
  if (new Set([addresses.keeper, addresses.wethSeller, addresses.usdcSeller].map((value) => value.toLowerCase())).size !== 3) {
    throw new Error("keeper and sellers must be three distinct wallets");
  }
  const sourceBalance = await provider.getBalance(addresses.source);
  const before = {
    sourceEth: sourceBalance,
    keeperEth: await provider.getBalance(addresses.keeper),
    wethSellerEth: await provider.getBalance(addresses.wethSeller),
    usdcSellerEth: await provider.getBalance(addresses.usdcSeller),
  };
  const usdc = new Contract(deployment.usdc, erc20Abi, provider);
  const beforeUsdc = await usdc.balanceOf(addresses.usdcSeller);
  console.log(`chainId=${network.chainId}`);
  console.log(`source=${addresses.source} balanceEth=${formatEther(before.sourceEth)}`);
  console.log(`keeper=${addresses.keeper} balanceEth=${formatEther(before.keeperEth)}`);
  console.log(`wethSeller=${addresses.wethSeller} balanceEth=${formatEther(before.wethSellerEth)}`);
  console.log(`usdcSeller=${addresses.usdcSeller} balanceEth=${formatEther(before.usdcSellerEth)} usdc=${formatUnits(beforeUsdc, 6)}`);
  console.log(`gasTargetEachEth=${formatEther(GAS_TARGET)} setupSwapWeth=${formatEther(SETUP_SWAP_WETH)} usdcTarget=${formatUnits(USDC_TARGET, 6)}`);
  console.log(`officialPool=${deployment.uniswapPool} officialRouter=${deployment.swapRouter02}`);
  if (process.env.V3_CONFIRM_FUNDING !== "YES") {
    throw new Error("funding plan only; set V3_CONFIRM_FUNDING=YES after confirming source, destinations, amounts, chain, and protocol route");
  }

  const txs = {};
  for (const [role, walletAddress, current] of [
    ["keeper", addresses.keeper, before.keeperEth],
    ["wethSeller", addresses.wethSeller, before.wethSellerEth],
    ["usdcSeller", addresses.usdcSeller, before.usdcSellerEth],
  ]) {
    if (walletAddress.toLowerCase() === addresses.source.toLowerCase() || current >= GAS_TARGET) continue;
    const tx = await source.sendTransaction({ to: walletAddress, value: GAS_TARGET - current });
    txs[`fund${role[0].toUpperCase()}${role.slice(1)}Gas`] = tx.hash;
    const receipt = await tx.wait();
    if (receipt?.status !== 1) throw new Error(`${role} gas funding reverted`);
  }

  if (beforeUsdc < USDC_TARGET) {
    const weth = new Contract(deployment.weth, wethAbi, source);
    const router = new Contract(deployment.swapRouter02, routerAbi, source);
    const adapter = new Contract(deployment.adapter, adapterAbi, provider);
    const [priceWad] = await adapter.consultTwap();
    const expectedUsdc = SETUP_SWAP_WETH * priceWad / 10n ** 30n;
    const minimumUsdc = expectedUsdc * 95n / 100n;
    if (minimumUsdc < USDC_TARGET - beforeUsdc) {
      throw new Error(`setup swap minimum ${formatUnits(minimumUsdc, 6)} USDC cannot reach target`);
    }
    const wrapTx = await weth.deposit({ value: SETUP_SWAP_WETH });
    txs.wrapSetupWeth = wrapTx.hash;
    if ((await wrapTx.wait())?.status !== 1) throw new Error("setup WETH wrap reverted");
    const approveTx = await weth.approve(deployment.swapRouter02, SETUP_SWAP_WETH);
    txs.approveSetupRouter = approveTx.hash;
    if ((await approveTx.wait())?.status !== 1) throw new Error("setup WETH approval reverted");
    const swapTx = await router.exactInputSingle({
      tokenIn: deployment.weth,
      tokenOut: deployment.usdc,
      fee: deployment.fee,
      recipient: addresses.usdcSeller,
      amountIn: SETUP_SWAP_WETH,
      amountOutMinimum: minimumUsdc,
      sqrtPriceLimitX96: 0,
    });
    txs.swapSetupWethForUsdc = swapTx.hash;
    if ((await swapTx.wait())?.status !== 1) throw new Error("official Uniswap setup swap reverted");
  }

  const after = {
    sourceEth: await provider.getBalance(addresses.source),
    keeperEth: await provider.getBalance(addresses.keeper),
    wethSellerEth: await provider.getBalance(addresses.wethSeller),
    usdcSellerEth: await provider.getBalance(addresses.usdcSeller),
    usdcSellerUsdc: await usdc.balanceOf(addresses.usdcSeller),
  };
  if (after.keeperEth < GAS_TARGET || after.wethSellerEth < GAS_TARGET || after.usdcSellerEth < GAS_TARGET) {
    throw new Error("post-funding gas target not reached");
  }
  if (after.usdcSellerUsdc < USDC_TARGET) throw new Error("post-funding USDC target not reached");
  const evidence = {
    status: "pass",
    chainId: Number(network.chainId),
    addresses,
    targets: {
      gasTargetWei: GAS_TARGET.toString(),
      usdcTarget: USDC_TARGET.toString(),
      setupSwapWeth: SETUP_SWAP_WETH.toString(),
    },
    before: Object.fromEntries(Object.entries({ ...before, usdcSellerUsdc: beforeUsdc }).map(([key, value]) => [key, value.toString()])),
    after: Object.fromEntries(Object.entries(after).map(([key, value]) => [key, value.toString()])),
    officialUniswap: {
      pool: deployment.uniswapPool,
      router: deployment.swapRouter02,
      setupSwapTx: txs.swapSetupWethForUsdc || null,
    },
    transactions: txs,
    verifiedAtBlock: await provider.getBlockNumber(),
  };
  mkdirSync(dirname(evidencePath), { recursive: true });
  const temporaryPath = `${evidencePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, evidencePath);
  console.log(`fundingEvidence=${evidencePath}`);
}

await main();
