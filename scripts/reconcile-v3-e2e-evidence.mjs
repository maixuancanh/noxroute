import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Contract, JsonRpcProvider } from "ethers";

const WAD = 10n ** 18n;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const evidencePath = join(root, "evidence", "sepolia-e2e-v3.json");
const deploymentPath = join(root, "dapp", "v3-deployment.json");
const engineArtifactPath = join(
  root,
  "artifacts",
  "contracts",
  "v3",
  "NoxveilStrategyEngine.sol",
  "NoxveilStrategyEngine.json",
);
const publicRpcUrl = "https://ethereum-sepolia-rpc.publicnode.com";

export function reconcilePrivacySavings(privacySavings, twapPriceWad) {
  const requested = BigInt(privacySavings.requestedQuoteWad);
  const matched = BigInt(privacySavings.matchedQuoteWad);
  if (2n * matched > requested) throw new Error("matched quote exceeds requested two-sided volume");

  const netResidual = requested - 2n * matched;
  const settlementResidual = BigInt(
    privacySavings.settlementResidualQuoteWad ?? privacySavings.residualQuoteWad,
  );
  if (settlementResidual > netResidual) {
    throw new Error("settlement residual exceeds private net residual");
  }
  const roundingDust = netResidual - settlementResidual;
  const maxRoundingDust = (BigInt(twapPriceWad) + WAD - 1n) / WAD;
  if (roundingDust >= maxRoundingDust) {
    throw new Error(`rounding dust exceeds one WETH atomic unit of quote value: ${roundingDust}`);
  }

  return {
    disclosure: privacySavings.disclosure,
    requestedQuoteWad: requested.toString(),
    matchedQuoteWad: matched.toString(),
    netResidualQuoteWad: netResidual.toString(),
    settlementResidualQuoteWad: settlementResidual.toString(),
    roundingDustQuoteWad: roundingDust.toString(),
  };
}

async function runCli() {
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
  const engineArtifact = JSON.parse(readFileSync(engineArtifactPath, "utf8"));
  if (evidence.status !== "pass" || evidence.chainId !== 11155111) {
    throw new Error("Sepolia E2E evidence is not a passing chain 11155111 artifact");
  }
  if (evidence.uniswap.pool.toLowerCase() !== deployment.uniswapPool.toLowerCase()) {
    throw new Error("evidence pool does not match the deployment artifact");
  }
  if (evidence.uniswap.router.toLowerCase() !== deployment.swapRouter02.toLowerCase()) {
    throw new Error("evidence router does not match the deployment artifact");
  }

  const provider = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL || publicRpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== 11155111n) throw new Error(`expected Sepolia, got ${network.chainId}`);

  const receipts = {};
  for (const [name, hash] of Object.entries(evidence.transactions)) {
    const receipt = await provider.getTransactionReceipt(hash);
    if (!receipt || receipt.status !== 1) throw new Error(`${name} receipt is missing or failed`);
    receipts[name] = {
      hash,
      status: receipt.status,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
    };
  }

  const settlementReceipt = await provider.getTransactionReceipt(evidence.transactions.settlement);
  const officialPoolLogEmitted = settlementReceipt.logs.some(
    (log) => log.address.toLowerCase() === deployment.uniswapPool.toLowerCase(),
  );
  if (!officialPoolLogEmitted) throw new Error("settlement receipt has no official Uniswap pool log");

  const engine = new Contract(deployment.engine, engineArtifact.abi, provider);
  const epoch = await engine.getEpoch(evidence.epochId);
  if (epoch.status !== 5n) throw new Error(`epoch is not SETTLED: ${epoch.status}`);
  if (epoch.amountOut.toString() !== evidence.uniswap.amountOut) {
    throw new Error("evidence amountOut does not match the settled epoch");
  }
  if (epoch.amountOutMinimum.toString() !== evidence.uniswap.amountOutMinimum) {
    throw new Error("evidence amountOutMinimum does not match the settled epoch");
  }
  const publicDecryptions = evidence.handles.publiclyDecrypted;
  if (JSON.stringify(publicDecryptions) !== JSON.stringify([
    "residualDirection",
    "residualAmount",
    "aggregateMinOut",
  ])) {
    throw new Error("public decryption allowlist is not exactly the expected three fields");
  }

  const updated = {
    ...evidence,
    privacySavings: reconcilePrivacySavings(evidence.privacySavings, epoch.twapPriceWad),
    receipts,
    uniswap: {
      ...evidence.uniswap,
      officialPoolLogEmitted,
    },
    verifiedAtBlock: await provider.getBlockNumber(),
  };
  const temporaryPath = `${evidencePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, evidencePath);
  console.log(`verifiedEpoch=${evidence.epochId}`);
  console.log(`verifiedSettlement=${evidence.transactions.settlement}`);
  console.log(`verifiedEvidence=${evidencePath}`);
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) await runCli();
