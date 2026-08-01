import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  formatEther,
  parseEther,
} from "ethers";
import { createEthersHandleClient } from "@iexec-nox/handle";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const rpcUrl = process.env.SEPOLIA_RPC_URL;
const sponsorPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL is required");
if (!sponsorPrivateKey) throw new Error("DEPLOYER_PRIVATE_KEY is required");

const deployment = JSON.parse(fs.readFileSync(path.join(root, "dapp", "v2-deployment.json"), "utf8"));
const tokenArtifact = JSON.parse(fs.readFileSync(path.join(root, "artifacts", "contracts", "test", "MockERC20.sol", "MockERC20.json"), "utf8"));
const batchArtifact = JSON.parse(fs.readFileSync(path.join(root, "artifacts", "contracts", "NoxBatchRouterV2.sol", "NoxBatchRouterV2.json"), "utf8"));

const provider = new JsonRpcProvider(rpcUrl);
const sponsor = new Wallet(sponsorPrivateKey, provider);
const tokenIn = new Contract(deployment.tokenIn, tokenArtifact.abi, sponsor);
const batch = new Contract(deployment.noxBatchRouterV2, batchArtifact.abi, sponsor);
const helperCount = Number(process.env.DEMO_HELPER_COUNT || "2");
const amount = parseEther(process.env.DEMO_AMOUNT || "0.10");
const minOut = amount * 2n * 995n / 1000n;
const gasFloat = parseEther(process.env.DEMO_HELPER_GAS_ETH || "0.002");

async function wait(label, tx) {
  console.log(`${label}=${tx.hash}`);
  await tx.wait();
}

const epochId = await batch.activeEpochId();
if (epochId === "0x" + "0".repeat(64)) {
  throw new Error("No active V2 epoch. Open an epoch in the dApp first.");
}

const epoch = await batch.getEpoch(epochId);
const currentCount = Number(epoch.intentCount);
const missing = Math.max(0, 3 - currentCount);
const fillCount = Math.min(helperCount, missing);

console.log(`sponsor=${await sponsor.getAddress()}`);
console.log(`sponsorBalanceEth=${formatEther(await provider.getBalance(sponsor))}`);
console.log(`routerV2=${deployment.noxBatchRouterV2}`);
console.log(`activeEpochId=${epochId}`);
console.log(`currentIntentCount=${currentCount}`);
console.log(`fillCount=${fillCount}`);

if (fillCount === 0) {
  console.log("demoBatchAlreadyFull=true");
  process.exit(0);
}

for (let index = 0; index < fillCount; index += 1) {
  const helper = Wallet.createRandom().connect(provider);
  console.log(`helper${index + 1}=${await helper.getAddress()}`);

  await wait(`fundHelper${index + 1}Tx`, await sponsor.sendTransaction({
    to: await helper.getAddress(),
    value: gasFloat,
  }));

  await wait(`mintHelper${index + 1}Tx`, await tokenIn.mint(await helper.getAddress(), amount));

  const helperToken = tokenIn.connect(helper);
  const helperBatch = batch.connect(helper);
  await wait(`approveHelper${index + 1}Tx`, await helperToken.approve(deployment.noxBatchRouterV2, amount));

  const handleClient = await createEthersHandleClient(helper);
  const { handle: amountHandle, handleProof: amountProof } =
    await handleClient.encryptInput(amount, "uint256", deployment.noxBatchRouterV2);
  const { handle: minOutHandle, handleProof: minOutProof } =
    await handleClient.encryptInput(minOut, "uint256", deployment.noxBatchRouterV2);

  const submitTx = await helperBatch[
    "submitIntent(bytes32,bytes32,bytes,bytes32,bytes,uint128)"
  ](epochId, amountHandle, amountProof, minOutHandle, minOutProof, amount);
  await wait(`submitHelper${index + 1}Tx`, submitTx);
}

const finalEpoch = await batch.getEpoch(epochId);
console.log(`finalIntentCount=${Number(finalEpoch.intentCount)}`);
console.log("nextStep=Request netting in the dApp, then settle once finalized.");
