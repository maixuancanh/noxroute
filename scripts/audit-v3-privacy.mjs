import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const contractsRoot = join(projectRoot, "contracts", "v3");
const evidencePath = join(projectRoot, "evidence", "privacy-invariants-v3.json");
const violations = [];

function filesUnder(directory, predicate = () => true) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...filesUnder(path, predicate));
    else if (predicate(path)) files.push(path);
  }
  return files;
}

function source(path) {
  return readFileSync(path, "utf8");
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function addViolation(code, path, detail) {
  violations.push({
    code,
    file: relative(projectRoot, path).replaceAll("\\", "/"),
    detail,
  });
}

const solidityFiles = filesUnder(contractsRoot, (path) => path.endsWith(".sol"));
const enginePath = join(contractsRoot, "NoxveilStrategyEngine.sol");
const vaultPath = join(contractsRoot, "NoxveilVault.sol");
const adapterPath = join(contractsRoot, "NoxveilUniswapV3Adapter.sol");
const engineSource = source(enginePath);
const vaultSource = source(vaultPath);
const adapterSource = source(adapterPath);

const allowedDecryptions = [
  [enginePath, "Nox.publicDecrypt", 3],
  [vaultPath, "Nox.publicDecrypt", 1],
];
for (const path of solidityFiles) {
  const body = source(path);
  const allowance = allowedDecryptions.find(([allowedPath]) => allowedPath === path);
  const expected = allowance?.[2] ?? 0;
  const actual = count(body, "Nox.publicDecrypt");
  if (actual !== expected) addViolation("PUBLIC_DECRYPT_COUNT", path, `expected ${expected}, found ${actual}`);
}
for (const expectedExpression of [
  "euint16.wrap(epoch.residualDirectionHandle)",
  "euint256.wrap(epoch.residualAmountHandle)",
  "euint256.wrap(epoch.aggregateMinOutHandle)",
]) {
  if (!engineSource.includes(expectedExpression)) {
    addViolation("PUBLIC_DECRYPT_ROLE", enginePath, `missing exact aggregate role ${expectedExpression}`);
  }
}
if (!vaultSource.includes("euint256.wrap(request.balanceHandle), decryptionProof")) {
  addViolation("WITHDRAWAL_DECRYPT_ROLE", vaultPath, "full-withdrawal decrypt is not bound to request.balanceHandle");
}

for (const [path, body, expected] of [
  [enginePath, engineSource, [
    "Nox.allowPublicDecryption(outputs.residualDirection)",
    "Nox.allowPublicDecryption(outputs.residualAmount)",
    "Nox.allowPublicDecryption(outputs.aggregateMinOut)",
  ]],
  [vaultPath, vaultSource, ["Nox.allowPublicDecryption(balance)"]],
]) {
  const actualCount = count(body, "Nox.allowPublicDecryption");
  if (actualCount !== expected.length) {
    addViolation("PUBLIC_ALLOW_COUNT", path, `expected ${expected.length}, found ${actualCount}`);
  }
  for (const expression of expected) {
    if (!body.includes(expression)) addViolation("PUBLIC_ALLOW_ROLE", path, `missing ${expression}`);
  }
}

const bannedPerUserEventFields = new Set([
  "amount",
  "clip",
  "limit",
  "slippage",
  "balance",
  "output",
  "remaining",
]);
for (const path of solidityFiles) {
  const body = source(path);
  for (const eventMatch of body.matchAll(/event\s+(\w+)\s*\(([\s\S]*?)\);/g)) {
    const [, eventName, parameters] = eventMatch;
    if (!/\b(owner|account|user)\b/.test(parameters)) continue;
    for (const parameter of parameters.split(",")) {
      const name = parameter.trim().split(/\s+/).at(-1)?.replace(/[^A-Za-z0-9_]/g, "");
      if (name && bannedPerUserEventFields.has(name)) {
        addViolation("PER_USER_EVENT_PLAINTEXT", path, `${eventName}.${name}`);
      }
    }
  }
}

const plaintextEconomicPattern = /\buint(?:8|16|24|32|64|128|160|256)?\s+(?:public\s+)?(escrowCap|budget|clip|limitPriceWad|slippageBps)\b/g;
for (const path of solidityFiles) {
  for (const match of source(path).matchAll(plaintextEconomicPattern)) {
    addViolation("PLAINTEXT_ECONOMIC_FIELD", path, match[0]);
  }
}

for (const path of solidityFiles) {
  const body = source(path);
  if (body.includes(".delegatecall(")) addViolation("GENERIC_DELEGATECALL", path, "delegatecall is forbidden");
  const lowLevelCalls = count(body, ".call(");
  const allowedTokenCalls = path === vaultPath ? 3 : path === adapterPath ? 2 : 0;
  if (lowLevelCalls !== allowedTokenCalls || (lowLevelCalls > 0 && !body.includes("token.call("))) {
    addViolation("GENERIC_CALL_EXECUTOR", path, `expected ${allowedTokenCalls} exact token.call operations, found ${lowLevelCalls}`);
  }
}

if (
  count(adapterSource, ".slot0()") !== 1 ||
  !adapterSource.includes(".observe(secondsAgos)") ||
  !adapterSource.includes("spotPriceWad") ||
  !adapterSource.includes("deviationBps")
) {
  addViolation("SPOT_AS_REFERENCE", adapterPath, "slot0 must be used once only for the spot-deviation guard after observe");
}

const v3RuntimeFiles = [
  ...filesUnder(join(projectRoot, "scripts"), (path) => /v3/i.test(path) && /\.(m?js|ts)$/.test(path)),
  ...filesUnder(join(projectRoot, "dapp"), (path) => /v3/i.test(path) && /\.(m?js|ts)$/.test(path)),
];
for (const path of v3RuntimeFiles) {
  const body = source(path);
  if (/\b(?:Wallet|HDNodeWallet)\.createRandom\s*\(/.test(body)) {
    addViolation("RANDOM_PRODUCTION_WALLET", path, "generated wallets are forbidden in V3 runtime code");
  }
  if (/(?:output|amountOut|receive)[^\n;=]*\*\s*[2-9](?:\D|$)/i.test(body)) {
    addViolation("HARDCODED_OUTPUT_MULTIPLIER", path, "output must come from protocol math or a quote");
  }
}

if (process.env.NOXVEIL_AUDIT_FORCE_VIOLATION === "1") {
  addViolation("FORCED_TEST_VIOLATION", import.meta.filename, "test-only failure path");
}

if (violations.length > 0) {
  console.error(JSON.stringify({ status: "fail", violations }, null, 2));
  process.exitCode = 1;
} else {
  const evidence = {
    status: "pass",
    generatedAt: new Date().toISOString(),
    scope: ["contracts/v3", "scripts/*v3*", "dapp/*v3*"],
    privateFields: ["direction", "remaining", "clip", "limit", "slippage", "balances", "allocations"],
    publicDecryptFields: ["residualDirection", "residualAmount", "aggregateMinOut"],
    viewerOnlyAggregates: ["totalRequestedQuote", "matchedQuote"],
    publicBoundary: ["addresses", "epochTiming", "participantCount", "deposits", "withdrawals", "residualSettlement"],
    violations: [],
  };
  mkdirSync(dirname(evidencePath), { recursive: true });
  const temporaryPath = `${evidencePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, evidencePath);
  console.log(`Privacy audit passed: ${relative(projectRoot, evidencePath)}`);
}
