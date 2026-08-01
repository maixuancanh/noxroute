import {
  BrowserProvider,
  Contract,
  Interface,
  formatEther,
  formatUnits,
  parseEther,
  parseUnits,
} from "ethers";
import { createEthersHandleClient } from "@iexec-nox/handle";

export {
  BrowserProvider,
  Contract,
  Interface,
  createEthersHandleClient,
  formatEther,
  formatUnits,
  parseEther,
  parseUnits,
};

export async function createNoxHandleClient(ethereum) {
  if (!ethereum) throw new Error("No injected wallet provider found");
  const provider = new BrowserProvider(ethereum);
  const signer = await provider.getSigner();
  return createEthersHandleClient(signer);
}

export async function encryptNoxIntent({ ethereum, amount, minOut, contractAddress }) {
  const handleClient = await createNoxHandleClient(ethereum);
  const amountResult = await handleClient.encryptInput(BigInt(amount), "uint256", contractAddress);
  const minOutResult = await handleClient.encryptInput(BigInt(minOut), "uint256", contractAddress);
  return {
    amountHandle: amountResult.handle,
    amountProof: amountResult.handleProof,
    minOutHandle: minOutResult.handle,
    minOutProof: minOutResult.handleProof,
  };
}
