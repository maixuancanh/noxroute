import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AbiCoder,
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  getAddress,
  keccak256,
} from "ethers";
import {
  V3_SEPOLIA,
  verifyV3SepoliaDependencies,
} from "./verify-v3-sepolia-dependencies.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const deploymentPath = join(projectRoot, "dapp", "v3-deployment.json");
const evidencePath = join(projectRoot, "evidence", "v3-sepolia-deployment.json");

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function artifact(relativePath) {
  return JSON.parse(readFileSync(join(projectRoot, "artifacts", relativePath), "utf8"));
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

async function deploy(label, artifactPath, args, signer) {
  const compiled = artifact(artifactPath);
  const contract = await new ContractFactory(compiled.abi, compiled.bytecode, signer).deploy(...args);
  const deploymentTransaction = contract.deploymentTransaction();
  assertCondition(deploymentTransaction, `${label} deployment transaction missing`);
  const receipt = await deploymentTransaction.wait();
  assertCondition(receipt?.status === 1, `${label} deployment reverted`);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`${label}=${address}`);
  console.log(`${label}Tx=${deploymentTransaction.hash}`);
  return { contract, address, transactionHash: deploymentTransaction.hash, receipt };
}

async function confirmed(transactionPromise, label) {
  const transaction = await transactionPromise;
  const receipt = await transaction.wait();
  assertCondition(receipt?.status === 1, `${label} reverted`);
  console.log(`${label}Tx=${transaction.hash}`);
  return { transactionHash: transaction.hash, receipt };
}

async function codeHash(provider, address, label) {
  const code = await provider.getCode(address);
  assertCondition(code !== "0x", `${label} has no deployed bytecode`);
  return keccak256(code);
}

async function postDeploymentChecks({ provider, deployer, vault, adapter, engine, dependencies }) {
  const [vaultAddress, adapterAddress, engineAddress] = await Promise.all([
    vault.getAddress(),
    adapter.getAddress(),
    engine.getAddress(),
  ]);
  const expectedPool = dependencies.resolvedAddresses.uniswapPool;
  const expectedPairId = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint24"],
      [V3_SEPOLIA.weth, V3_SEPOLIA.usdc, V3_SEPOLIA.fee],
    ),
  );

  const checks = [
    [await vault.weth(), V3_SEPOLIA.weth, "vault.weth"],
    [await vault.usdc(), V3_SEPOLIA.usdc, "vault.usdc"],
    [await vault.engine(), engineAddress, "vault.engine"],
    [await vault.adapter(), adapterAddress, "vault.adapter"],
    [await vault.bootstrapAdmin(), deployer, "vault.bootstrapAdmin"],
    [await adapter.vault(), vaultAddress, "adapter.vault"],
    [await adapter.factory(), V3_SEPOLIA.uniswapFactory, "adapter.factory"],
    [await adapter.router(), V3_SEPOLIA.swapRouter02, "adapter.router"],
    [await adapter.pool(), expectedPool, "adapter.pool"],
    [await adapter.weth(), V3_SEPOLIA.weth, "adapter.weth"],
    [await adapter.usdc(), V3_SEPOLIA.usdc, "adapter.usdc"],
    [await engine.vault(), vaultAddress, "engine.vault"],
    [await engine.adapter(), adapterAddress, "engine.adapter"],
    [await engine.auditorAdmin(), deployer, "engine.auditorAdmin"],
  ];
  for (const [actual, expected, label] of checks) {
    assertCondition(getAddress(actual) === getAddress(expected), `${label} mismatch`);
  }
  assertCondition(await vault.bootstrapClosed(), "vault bootstrap is not permanently closed");
  assertCondition(Number(await adapter.fee()) === V3_SEPOLIA.fee, "adapter fee mismatch");
  assertCondition(Number(await adapter.twapWindow()) === V3_SEPOLIA.twapWindow, "adapter TWAP window mismatch");
  assertCondition(Number(await adapter.maxDeviationBps()) === V3_SEPOLIA.maxDeviationBps, "adapter deviation mismatch");
  assertCondition(Number(await engine.epochDuration()) === V3_SEPOLIA.epochDuration, "engine epoch duration mismatch");
  assertCondition((await engine.pairId()) === expectedPairId, "engine pairId mismatch");

  return {
    vault: await codeHash(provider, vaultAddress, "vault"),
    adapter: await codeHash(provider, adapterAddress, "adapter"),
    engine: await codeHash(provider, engineAddress, "engine"),
  };
}

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  assertCondition(rpcUrl, "SEPOLIA_RPC_URL is required");
  assertCondition(privateKey, "DEPLOYER_PRIVATE_KEY is required");
  if (existsSync(deploymentPath) && process.env.V3_ALLOW_REDEPLOY !== "1") {
    throw new Error("dapp/v3-deployment.json already exists; refusing an accidental duplicate deployment");
  }

  const provider = new JsonRpcProvider(rpcUrl, Number(V3_SEPOLIA.chainId), { staticNetwork: true });
  const wallet = new Wallet(privateKey, provider);
  const deployer = await wallet.getAddress();
  if (process.env.DEPLOYER_ADDRESS) {
    assertCondition(getAddress(process.env.DEPLOYER_ADDRESS) === deployer, "DEPLOYER_ADDRESS does not match signer");
  }
  const { evidence: dependencies } = await verifyV3SepoliaDependencies({
    rpcUrl,
    deployerAddress: deployer,
  });
  console.log(`deployer=${deployer}`);

  const vaultDeployment = await deploy("NoxveilVault", "contracts/v3/NoxveilVault.sol/NoxveilVault.json", [
    V3_SEPOLIA.weth,
    V3_SEPOLIA.usdc,
  ], wallet);
  const adapterDeployment = await deploy("NoxveilUniswapV3Adapter", "contracts/v3/NoxveilUniswapV3Adapter.sol/NoxveilUniswapV3Adapter.json", [
    vaultDeployment.address,
    V3_SEPOLIA.uniswapFactory,
    V3_SEPOLIA.swapRouter02,
    dependencies.resolvedAddresses.uniswapPool,
    V3_SEPOLIA.twapWindow,
    V3_SEPOLIA.maxDeviationBps,
  ], wallet);
  const engineDeployment = await deploy("NoxveilStrategyEngine", "contracts/v3/NoxveilStrategyEngine.sol/NoxveilStrategyEngine.json", [
    vaultDeployment.address,
    adapterDeployment.address,
    V3_SEPOLIA.epochDuration,
  ], wallet);

  const vault = new Contract(vaultDeployment.address, artifact("contracts/v3/NoxveilVault.sol/NoxveilVault.json").abi, wallet);
  const adapter = new Contract(adapterDeployment.address, artifact("contracts/v3/NoxveilUniswapV3Adapter.sol/NoxveilUniswapV3Adapter.json").abi, wallet);
  const engine = new Contract(engineDeployment.address, artifact("contracts/v3/NoxveilStrategyEngine.sol/NoxveilStrategyEngine.json").abi, wallet);
  const bindEngine = await confirmed(vault.setEngine(engineDeployment.address), "bindEngine");
  const bindAdapter = await confirmed(vault.setAdapter(adapterDeployment.address), "bindAdapter");
  const closeBootstrap = await confirmed(vault.closeBootstrap(), "closeBootstrap");

  const codeHashes = await postDeploymentChecks({
    provider,
    deployer,
    vault,
    adapter,
    engine,
    dependencies,
  });
  const verifiedAtBlock = await provider.getBlockNumber();
  const deployment = {
    version: "3",
    chainId: Number(V3_SEPOLIA.chainId),
    deployedAt: new Date().toISOString(),
    deployer,
    noxCompute: getAddress(V3_SEPOLIA.noxCompute),
    weth: getAddress(V3_SEPOLIA.weth),
    usdc: getAddress(V3_SEPOLIA.usdc),
    uniswapFactory: getAddress(V3_SEPOLIA.uniswapFactory),
    uniswapPool: getAddress(dependencies.resolvedAddresses.uniswapPool),
    swapRouter02: getAddress(V3_SEPOLIA.swapRouter02),
    fee: V3_SEPOLIA.fee,
    twapWindow: V3_SEPOLIA.twapWindow,
    maxDeviationBps: V3_SEPOLIA.maxDeviationBps,
    epochDuration: V3_SEPOLIA.epochDuration,
    vault: vaultDeployment.address,
    engine: engineDeployment.address,
    adapter: adapterDeployment.address,
    deploymentTxs: {
      vault: vaultDeployment.transactionHash,
      adapter: adapterDeployment.transactionHash,
      engine: engineDeployment.transactionHash,
      bindEngine: bindEngine.transactionHash,
      bindAdapter: bindAdapter.transactionHash,
      closeBootstrap: closeBootstrap.transactionHash,
    },
    codeHashes,
    verifiedAtBlock,
  };
  atomicWriteJson(deploymentPath, deployment);
  atomicWriteJson(evidencePath, { status: "pass", ...deployment });
  console.log(`V3 deployment verified at block ${verifiedAtBlock}`);
  console.log(`artifact=${resolve(deploymentPath)}`);
}

try {
  await main();
} catch (error) {
  console.error(`V3 Sepolia deployment failed: ${error.message || String(error)}`);
  process.exitCode = 1;
}
