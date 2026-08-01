import { BrowserProvider, createEthersHandleClient } from "./nox-browser.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isZeroHandle = (handle) => handle === 0n || /^0x0*$/i.test(String(handle));

export class NoxRoutePrivacy {
  constructor(chain) {
    this.chain = chain;
    this.handleClient = null;
  }

  async connect() {
    if (!this.chain.ethereum) throw new Error("Connect a wallet before using Nox.");
    if (this.chain.uiSimulation) {
      this.handleClient = { evidenceLabel: "simulated provider UI test" };
      return this.handleClient;
    }
    const provider = new BrowserProvider(this.chain.ethereum);
    const signer = await provider.getSigner();
    this.handleClient = await createEthersHandleClient(signer);
    return this.handleClient;
  }

  async client() {
    return this.handleClient || this.connect();
  }

  async encryptStrategy(values) {
    if (this.chain.uiSimulation) {
      const handle = (byte) => `0x${byte.repeat(64)}`;
      const proof = (byte) => `0x${byte.repeat(8)}`;
      return {
        input: {
          direction: handle("1"), directionProof: proof("1"),
          budget: handle("2"), budgetProof: proof("2"),
          clip: handle("3"), clipProof: proof("3"),
          limitPriceWad: handle("4"), limitPriceProof: proof("4"),
          slippageBps: handle("5"), slippageProof: proof("5"),
        },
        receipt: {
          direction: handle("1"),
          budget: handle("2"),
          clip: handle("3"),
          limitPriceWad: handle("4"),
          slippageBps: handle("5"),
          proofBytes: { direction: 4, budget: 4, clip: 4, limitPriceWad: 4, slippageBps: 4 },
        },
      };
    }
    const client = await this.client();
    const contract = this.chain.deployment.engine;
    const [direction, budget, clip, limitPriceWad, slippageBps] = await Promise.all([
      client.encryptInput(BigInt(values.direction), "uint16", contract),
      client.encryptInput(BigInt(values.budget), "uint256", contract),
      client.encryptInput(BigInt(values.clip), "uint256", contract),
      client.encryptInput(BigInt(values.limitPriceWad), "uint256", contract),
      client.encryptInput(BigInt(values.slippageBps), "uint256", contract),
    ]);
    return {
      input: {
        direction: direction.handle,
        directionProof: direction.handleProof,
        budget: budget.handle,
        budgetProof: budget.handleProof,
        clip: clip.handle,
        clipProof: clip.handleProof,
        limitPriceWad: limitPriceWad.handle,
        limitPriceProof: limitPriceWad.handleProof,
        slippageBps: slippageBps.handle,
        slippageProof: slippageBps.handleProof,
      },
      receipt: {
        direction: direction.handle,
        budget: budget.handle,
        clip: clip.handle,
        limitPriceWad: limitPriceWad.handle,
        slippageBps: slippageBps.handle,
        proofBytes: {
          direction: (direction.handleProof.length - 2) / 2,
          budget: (budget.handleProof.length - 2) / 2,
          clip: (clip.handleProof.length - 2) / 2,
          limitPriceWad: (limitPriceWad.handleProof.length - 2) / 2,
          slippageBps: (slippageBps.handleProof.length - 2) / 2,
        },
      },
    };
  }

  async retry(label, action, onElapsed, timeoutMs = 360_000) {
    const startedAt = Date.now();
    let lastError;
    while (Date.now() - startedAt < timeoutMs) {
      try {
        return await action();
      } catch (error) {
        lastError = error;
        onElapsed?.(Date.now() - startedAt, error);
        await wait(5_000);
      }
    }
    throw new Error(`${label} timed out. Retry without recreating the strategy. ${this.explain(lastError)}`);
  }

  async decryptOwnerState(strategyId, onElapsed) {
    if (this.chain.uiSimulation) {
      return {
        direction: 0n,
        remaining: 6_000_000_000_000_000_000n,
        clip: 1_000_000_000_000_000_000n,
        limitPriceWad: 2_500_000_000_000_000_000_000n,
        slippageBps: 100n,
        wethBalance: 6_000_000_000_000_000_000n,
        usdcBalance: 3_500_000_000n,
      };
    }
    const client = await this.client();
    const strategy = await this.chain.strategy(strategyId);
    const decrypt = (label, handle) => isZeroHandle(handle)
      ? 0n
      : this.retry(label, async () => (await client.decrypt(handle)).value, onElapsed);
    const [direction, remaining, clip, limitPriceWad, slippageBps, wethBalance, usdcBalance] = await Promise.all([
      decrypt("direction", strategy.handles.direction),
      decrypt("remaining budget", strategy.handles.remaining),
      decrypt("clip", strategy.handles.clip),
      decrypt("private limit", strategy.handles.limitPriceWad),
      decrypt("private slippage", strategy.handles.slippageBps),
      this.chain.readContracts.vault.availableHandle(this.chain.account, this.chain.deployment.weth)
        .then((handle) => decrypt("confidential WETH balance", handle)),
      this.chain.readContracts.vault.availableHandle(this.chain.account, this.chain.deployment.usdc)
        .then((handle) => decrypt("confidential USDC balance", handle)),
    ]);
    return { direction, remaining, clip, limitPriceWad, slippageBps, wethBalance, usdcBalance };
  }

  async publicDecryptEpoch(epoch, onElapsed) {
    if (this.chain.uiSimulation) {
      return {
        direction: { value: 0n, decryptionProof: "0x0101" },
        amount: { value: 1_000_000_000_000_000n, decryptionProof: "0x0202" },
        minimum: { value: 2_400_000n, decryptionProof: "0x0303" },
      };
    }
    const client = await this.client();
    const decrypt = (label, handle) => this.retry(label, () => client.publicDecrypt(handle), onElapsed);
    const [direction, amount, minimum] = await Promise.all([
      decrypt("residual direction proof", epoch.residualDirectionHandle),
      decrypt("residual amount proof", epoch.residualAmountHandle),
      decrypt("aggregate minimum proof", epoch.aggregateMinOutHandle),
    ]);
    return { direction, amount, minimum };
  }

  async decryptEpochPrivate(epochId, onElapsed) {
    if (this.chain.uiSimulation) {
      return { totalRequestedQuote: 10_000_000_000_000_000_000n, matchedQuote: 7_500_000_000_000_000_000n };
    }
    const client = await this.client();
    const handles = await this.chain.epochPrivateHandles(epochId);
    try {
      const [totalRequestedQuote, matchedQuote] = await Promise.all([
        this.retry("private requested volume", async () =>
          (await client.decrypt(handles.totalRequestedQuote)).value,
        onElapsed),
        this.retry("private matched volume", async () =>
          (await client.decrypt(handles.matchedQuote)).value,
        onElapsed),
      ]);
      return { totalRequestedQuote, matchedQuote };
    } catch (error) {
      throw new Error(`Unauthorized private reveal. Only a participating owner or active auditor can decrypt these handles. ${this.explain(error)}`);
    }
  }

  explain(error) {
    const message = error?.shortMessage || error?.message || String(error || "");
    if (/not authorized|permission|viewer|acl|access/i.test(message)) {
      return "This wallet is not authorized by the Nox handle ACL.";
    }
    if (/not yet computed|unknown handle|subgraph/i.test(message)) {
      return "Nox is still computing or indexing this handle.";
    }
    return message;
  }
}
