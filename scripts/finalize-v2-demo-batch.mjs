import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  formatEther,
} from "ethers";
import { createEthersHandleClient } from "@iexec-nox/handle";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const rpcUrl = process.env.SEPOLIA_RPC_URL;
const keeperPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL is required");
if (!keeperPrivateKey) throw new Error("DEPLOYER_PRIVATE_KEY is required");

const deployment = JSON.parse(fs.readFileSync(path.join(root, "dapp", "v2-deployment.json"), "utf8"));
const batchArtifact = JSON.parse(fs.readFileSync(path.join(root, "artifacts", "contracts", "NoxBatchRouterV2.sol", "NoxBatchRouterV2.json"), "utf8"));
const evaluatorArtifact = JSON.parse(fs.readFileSync(path.join(root, "artifacts", "contracts", "NoxBatchEvaluator.sol", "NoxBatchEvaluator.json"), "utf8"));

const zero32 = `0x${"0".repeat(64)}`;
const provider = new JsonRpcProvider(rpcUrl);
const keeper = new Wallet(keeperPrivateKey, provider);
const batch = new Contract(deployment.noxBatchRouterV2, batchArtifact.abi, keeper);
const evaluator = new Contract(deployment.noxEvaluator, evaluatorArtifact.abi, keeper);
const handleClient = await createEthersHandleClient(keeper);

async function publicDecryptWithRetry(handle, timeoutMs = 240_000) {
  const startedAt = Date.now();
  let lastError;
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

async function wait(label, tx) {
  console.log(`${label}=${tx.hash}`);
  await tx.wait();
}

const epochId = await batch.activeEpochId();
if (epochId === zero32) throw new Error("No active V2 epoch.");

const epoch = await batch.getEpoch(epochId);
const status = Number(epoch.status);
const requestId = epoch.requestId;

console.log(`keeper=${await keeper.getAddress()}`);
console.log(`keeperBalanceEth=${formatEther(await provider.getBalance(keeper))}`);
console.log(`routerV2=${deployment.noxBatchRouterV2}`);
console.log(`noxEvaluator=${deployment.noxEvaluator}`);
console.log(`activeEpochId=${epochId}`);
console.log(`status=${status}`);
console.log(`intentCount=${Number(epoch.intentCount)}`);
console.log(`requestId=${requestId}`);

if (status === 5) {
  console.log("alreadyFinalized=true");
  process.exit(0);
}
if (status !== 3) {
  throw new Error(`Epoch must be Pending before finalization. Current status=${status}`);
}
if (requestId === zero32) throw new Error("Pending epoch has no requestId.");

const [debitHandles, outputHandles] = await evaluator.resultHandlesOf(requestId);
const debitProofs = [];
const outputProofs = [];

for (let index = 0; index < 3; index += 1) {
  console.log(`decryptDebit${index + 1}Handle=${debitHandles[index]}`);
  const debit = await publicDecryptWithRetry(debitHandles[index]);
  console.log(`debit${index + 1}=${debit.value.toString()}`);
  debitProofs.push(debit.decryptionProof);

  console.log(`decryptOutput${index + 1}Handle=${outputHandles[index]}`);
  const output = await publicDecryptWithRetry(outputHandles[index]);
  console.log(`output${index + 1}=${output.value.toString()}`);
  outputProofs.push(output.decryptionProof);
}

await wait("deliverNettingTx", await evaluator.deliverNetting(requestId, debitProofs, outputProofs));

const finalEpoch = await batch.getEpoch(epochId);
console.log(`finalStatus=${Number(finalEpoch.status)}`);
console.log(`totalInput=${finalEpoch.totalInput.toString()}`);
console.log(`totalOutput=${finalEpoch.totalOutput.toString()}`);
console.log("nextStep=Settle batch in the dApp.");
