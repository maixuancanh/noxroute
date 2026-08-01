import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const deploymentPath = join(root, "dapp", "v3-deployment.json");
const e2eEvidencePath = join(root, "evidence", "sepolia-e2e-v3.json");
const targets = ["SUBMISSION.md", "demo-script.md"];
const etherscan = "https://sepolia.etherscan.io";
const startMarker = "<!-- V3_LINKS:START -->";
const endMarker = "<!-- V3_LINKS:END -->";
const explorerLinkPattern = /\bhttps?:\/\/sepolia\.etherscan\.io\/(?:address|tx)(?:\/[^\s<>()\]]*|(?=[\s<>()\]}.,;:!?]|$))/i;

const markerRange = (source, label) => {
  const startCount = source.split(startMarker).length - 1;
  const endCount = source.split(endMarker).length - 1;
  if (startCount !== 1) throw new Error(`${label} must contain exactly one V3_LINKS:START marker`);
  if (endCount !== 1) throw new Error(`${label} must contain exactly one V3_LINKS:END marker`);

  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start > end) throw new Error(`${label} V3_LINKS:START marker must precede its V3_LINKS:END marker`);
  return { start, end: end + endMarker.length };
};

export const validateAndRenderV3DocLinks = (source, renderedBlock, label = "document") => {
  const sourceRange = markerRange(source, label);
  markerRange(renderedBlock, "generated V3 link block");

  const outsideGeneratedBlock = source.slice(0, sourceRange.start) + source.slice(sourceRange.end);
  if (explorerLinkPattern.test(outsideGeneratedBlock)) {
    throw new Error(`${label} contains Sepolia Etherscan address/transaction links outside the generated V3 link block`);
  }

  return source.slice(0, sourceRange.start) + renderedBlock + source.slice(sourceRange.end);
};

const requiredHex = (label, value, length) => {
  const pattern = new RegExp(`^0x[0-9a-fA-F]{${length}}$`);
  if (!pattern.test(value ?? "")) throw new Error(`${label} is not a ${length / 2}-byte hex value`);
  return value;
};

const renderBlock = (deployment, e2eEvidence) => {
  const contracts = [
    ["NoxCompute", deployment.noxCompute],
    ["NoxRoute Vault", deployment.vault],
    ["NoxRoute Strategy Engine", deployment.engine],
    ["NoxRoute Uniswap V3 Adapter", deployment.adapter],
    ["WETH", deployment.weth],
    ["USDC", deployment.usdc],
    ["Uniswap V3 Factory", deployment.uniswapFactory],
    ["Uniswap V3 WETH/USDC 0.05% pool", deployment.uniswapPool],
    ["SwapRouter02", deployment.swapRouter02],
  ];

  const transactions = [
    ["Vault deployment", deployment.deploymentTxs.vault],
    ["Adapter deployment", deployment.deploymentTxs.adapter],
    ["Engine deployment", deployment.deploymentTxs.engine],
    ["Engine binding", deployment.deploymentTxs.bindEngine],
    ["Adapter binding", deployment.deploymentTxs.bindAdapter],
    ["Bootstrap closure", deployment.deploymentTxs.closeBootstrap],
  ];

  for (const [label, address] of contracts) requiredHex(label, address, 40);
  for (const [label, hash] of transactions) requiredHex(label, hash, 64);

  let e2eLines = [
    "_No official Uniswap residual-settlement transaction is listed while `evidence/sepolia-e2e-v3.json` is pending._",
  ];
  if (e2eEvidence) {
    if (e2eEvidence.status !== "pass" || e2eEvidence.chainId !== deployment.chainId) {
      throw new Error("Sepolia E2E evidence is not a passing artifact for the deployed chain");
    }
    for (const field of ["vault", "engine", "adapter"]) {
      if (e2eEvidence.addresses[field]?.toLowerCase() !== deployment[field].toLowerCase()) {
        throw new Error(`Sepolia E2E ${field} does not match the deployment artifact`);
      }
    }
    if (e2eEvidence.uniswap.pool.toLowerCase() !== deployment.uniswapPool.toLowerCase()
      || e2eEvidence.uniswap.router.toLowerCase() !== deployment.swapRouter02.toLowerCase()) {
      throw new Error("Sepolia E2E Uniswap dependencies do not match the deployment artifact");
    }
    const e2eTransactions = [
      ["WETH-owner encrypted strategy", e2eEvidence.transactions.createWethStrategy],
      ["USDC-owner encrypted strategy", e2eEvidence.transactions.createUsdcStrategy],
      ["Confidential epoch lock and netting", e2eEvidence.transactions.lockEpoch],
      ["Aggregate proof finalization", e2eEvidence.transactions.finalizeAggregate],
      ["Official Uniswap residual settlement", e2eEvidence.transactions.settlement],
    ];
    for (const [label, hash] of e2eTransactions) requiredHex(label, hash, 64);
    e2eLines = [
      "### Real multi-wallet Sepolia E2E transactions",
      "",
      ...e2eTransactions.map(([label, hash]) => `- [${label}](${etherscan}/tx/${hash})`),
      "",
      `_Verified settled epoch \`${requiredHex("epochId", e2eEvidence.epochId, 64)}\`; links are generated from \`evidence/sepolia-e2e-v3.json\`._`,
    ];
  }

  return [
    startMarker,
    "_Generated from `dapp/v3-deployment.json` and the verified E2E artifact when present; do not hand-edit addresses or transaction hashes._",
    "",
    "### Contracts",
    "",
    ...contracts.map(([label, address]) => `- [${label}](${etherscan}/address/${address})`),
    "",
    "### Deployment transactions",
    "",
    ...transactions.map(([label, hash]) => `- [${label}](${etherscan}/tx/${hash})`),
    "",
    ...e2eLines,
    endMarker,
  ].join("\n");
};

const runCli = () => {
  const checkOnly = process.argv.includes("--check");
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
  const e2eEvidence = existsSync(e2eEvidencePath)
    ? JSON.parse(readFileSync(e2eEvidencePath, "utf8"))
    : null;
  const renderedBlock = renderBlock(deployment, e2eEvidence);
  let stale = false;

  for (const relativePath of targets) {
    const path = join(root, relativePath);
    const source = readFileSync(path, "utf8");
    const expected = validateAndRenderV3DocLinks(source, renderedBlock, relativePath);
    if (expected === source) continue;
    stale = true;
    if (!checkOnly) writeFileSync(path, expected, "utf8");
    console.error(`${relativePath}: artifact-derived V3 links are stale`);
  }

  if (checkOnly && stale) process.exitCode = 1;
  if (!stale) console.log("artifact-derived V3 doc links are current");
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) runCli();
