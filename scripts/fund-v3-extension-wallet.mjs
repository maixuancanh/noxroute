import assert from "node:assert/strict";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider, Wallet, formatEther, parseEther } from "ethers";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const evidencePath = join(root, "evidence", "extension-wallet-funding-2026-08-01.json");
const expectedSource = "0x4B96f0B001417fF56354712c6A54b737DA054A7D";
const destination = "0x018afE2Be696274bCb3A33B2FB1487F96f649bd6";
const amount = parseEther("0.002");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (existsSync(evidencePath)) {
  throw new Error(`Funding evidence already exists; refusing a duplicate transfer: ${evidencePath}`);
}

const deployment = JSON.parse(readFileSync(join(root, "dapp", "v3-deployment.json"), "utf8"));
const provider = new JsonRpcProvider(required("SEPOLIA_RPC_URL"));
const wallet = new Wallet(required("V3_KEEPER_PRIVATE_KEY"), provider);
const source = await wallet.getAddress();
const network = await provider.getNetwork();

assert.equal(network.chainId, 11155111n, "funding must run on Sepolia");
assert.equal(source.toLowerCase(), expectedSource.toLowerCase(), "unexpected funding source");
assert.equal(deployment.weth.toLowerCase(), "0xfff9976782d46cc05630d1f6ebab18b2324d6b14", "unexpected Sepolia WETH");

const weth = new Contract(deployment.weth, [
  "function deposit() payable",
  "function transfer(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
], wallet);

const sourceEthBefore = await provider.getBalance(source);
const destinationBefore = await weth.balanceOf(destination);
assert(sourceEthBefore > amount, "source lacks ETH for wrap plus gas");

const wrapTx = await weth.deposit({ value: amount });
const wrapReceipt = await wrapTx.wait();
assert.equal(wrapReceipt?.status, 1, "WETH wrap reverted");

const transferTx = await weth.transfer(destination, amount);
const transferReceipt = await transferTx.wait();
assert.equal(transferReceipt?.status, 1, "WETH transfer reverted");

const destinationAfter = await weth.balanceOf(destination);
assert.equal(destinationAfter - destinationBefore, amount, "destination WETH delta mismatch");

const evidence = {
  status: "pass",
  chainId: Number(network.chainId),
  source,
  destination,
  weth: deployment.weth,
  amountWei: amount.toString(),
  amountWeth: "0.002",
  sourceEthBefore: formatEther(sourceEthBefore),
  destinationWethBefore: destinationBefore.toString(),
  destinationWethAfter: destinationAfter.toString(),
  transactions: {
    wrap: { hash: wrapTx.hash, blockNumber: wrapReceipt.blockNumber, status: wrapReceipt.status },
    transfer: { hash: transferTx.hash, blockNumber: transferReceipt.blockNumber, status: transferReceipt.status },
  },
  verifiedAtBlock: await provider.getBlockNumber(),
};

const temporaryPath = `${evidencePath}.tmp`;
writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`);
renameSync(temporaryPath, evidencePath);

console.log(`source=${source}`);
console.log(`destination=${destination}`);
console.log(`amountWeth=0.002`);
console.log(`wrapTx=${wrapTx.hash}`);
console.log(`transferTx=${transferTx.hash}`);
console.log(`destinationWethAfter=${formatEther(destinationAfter)}`);
