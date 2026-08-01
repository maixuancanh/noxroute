import {
  BrowserProvider,
  Contract,
  formatEther,
  formatUnits,
  parseUnits,
} from "./nox-browser.js";

const SEPOLIA_CHAIN_ID = "0xaa36a7";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const SESSION_KEY = "noxroute:v3:wallet-rdns";
const GAS_LIMIT_CAP = 16_000_000n;
const GAS_BUFFER_NUMERATOR = 130n;
const GAS_BUFFER_DENOMINATOR = 100n;

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const VAULT_ABI = [
  "function weth() view returns (address)",
  "function usdc() view returns (address)",
  "function engine() view returns (address)",
  "function adapter() view returns (address)",
  "function bootstrapClosed() view returns (bool)",
  "function deposit(address token,uint256 amount)",
  "function availableHandle(address owner,address token) view returns (bytes32)",
];

const ENGINE_ABI = [
  "event StrategyCreated(bytes32 indexed strategyId,address indexed owner,bytes32 indexed pairId,uint64 creationEpoch,uint64 clientNonce,uint8 slot)",
  "event EpochOpened(bytes32 indexed epochId,uint32 indexed epochNonce,uint64 deadline,uint32 participantCount)",
  "event EpochLocked(bytes32 indexed epochId,uint32 indexed epochNonce,uint256 twapPriceWad,bytes32 actionCommitment,bytes32 residualDirectionHandle,bytes32 residualAmountHandle,bytes32 aggregateMinOutHandle)",
  "event EpochReady(bytes32 indexed epochId,uint256 residualAmount,uint256 amountOutMinimum)",
  "event EpochSettled(bytes32 indexed epochId,uint256 residualAmount,uint256 amountOut)",
  "function currentEpoch() view returns (uint64)",
  "function activeStrategyCount() view returns (uint8)",
  "function createStrategy((bytes32 direction,bytes directionProof,bytes32 budget,bytes budgetProof,bytes32 clip,bytes clipProof,bytes32 limitPriceWad,bytes limitPriceProof,bytes32 slippageBps,bytes slippageProof) input,uint64 clientNonce) returns (bytes32 strategyId)",
  "function getStrategyPublic(bytes32 strategyId) view returns ((address owner,bytes32 pairId,uint64 creationEpoch,uint64 clientNonce,uint8 slot,bool cancelled))",
  "function strategyHandles(bytes32 strategyId) view returns ((bytes32 direction,bytes32 remaining,bytes32 clip,bytes32 limitPriceWad,bytes32 slippageBps))",
  "function lockCurrentEpoch(uint64 deadline) returns (bytes32 epochId)",
  "function getEpoch(bytes32 epochId) view returns ((uint64 openedAt,uint64 lockedAt,uint64 deadline,uint32 participantCount,uint32 epochNonce,uint8 status,uint256 twapPriceWad,bytes32 actionCommitment,bytes32 residualDirectionHandle,bytes32 residualAmountHandle,bytes32 aggregateMinOutHandle,uint8 residualDirection,uint256 residualAmount,uint256 amountOutMinimum,uint256 amountOut))",
  "function epochPrivateHandles(bytes32 epochId) view returns ((bytes32 totalWeth,bytes32 totalUsdc,bytes32 totalRequestedQuote,bytes32 matchedQuote))",
  "function finalizeAggregate(bytes32 epochId,bytes directionProof,bytes amountProof,bytes minimumProof)",
  "function settle(bytes32 epochId)",
];

const ADAPTER_ABI = [
  "function consultTwap() view returns (uint256 priceWad,int24 arithmeticMeanTick)",
  "function pool() view returns (address)",
  "function router() view returns (address)",
];

const CHAINLINK_ETH_USD_ABI = [
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function localUiSimulation(provider, context = location) {
  const hostAllowed = context.hostname === "127.0.0.1" || context.hostname === "localhost";
  const queryAllowed = new URLSearchParams(context.search).get("simulated-provider-ui-test") === "1";
  const simulation = provider?.__noxrouteSimulatedUi;
  return hostAllowed && queryAllowed && simulation?.evidenceLabel === "simulated provider UI test"
    ? simulation
    : null;
}

function normalizedError(error) {
  const message = error?.shortMessage || error?.info?.error?.message || error?.message || String(error);
  if (/user rejected|user denied|4001/i.test(message)) return "You rejected the wallet request.";
  if (/insufficient funds/i.test(message)) return "This wallet needs more Sepolia ETH for gas.";
  if (/wrong network|chain/i.test(message) && /switch|11155111|aa36a7/i.test(message)) {
    return "Switch the connected wallet to Ethereum Sepolia and retry.";
  }
  return message.replace(/^execution reverted:\s*/i, "");
}

export class NoxRouteChain {
  constructor() {
    this.deployment = null;
    this.wallets = new Map();
    this.ethereum = null;
    this.browserProvider = null;
    this.signer = null;
    this.account = null;
    this.walletInfo = null;
    this.uiSimulation = null;
    this.readContracts = null;
    this.writeContracts = null;
    this.boundProvider = null;
    this.boundProviderListeners = null;
    this.onWalletEvent = null;
  }

  async initialize() {
    const response = await fetch("./v3-deployment.json", { cache: "no-store" });
    if (!response.ok) throw new Error("V3 deployment manifest is unavailable.");
    this.deployment = await response.json();
    if (Number(this.deployment.chainId) !== 11155111) throw new Error("V3 manifest is not Sepolia.");
    return this.deployment;
  }

  async discoverWallets(timeoutMs = 450) {
    this.wallets.clear();
    const announce = (event) => {
      const detail = event.detail;
      if (!detail?.provider) return;
      const key = detail.info?.rdns || detail.info?.uuid || detail.info?.name || String(this.wallets.size);
      this.wallets.set(key, detail);
    };
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    await wait(timeoutMs);
    window.removeEventListener("eip6963:announceProvider", announce);
    if (window.ethereum && this.wallets.size === 0) {
      this.wallets.set("injected", {
        info: { name: "Browser wallet", rdns: "injected", icon: "" },
        provider: window.ethereum,
      });
    }
    return [...this.wallets.values()];
  }

  async restoreSession() {
    const rdns = localStorage.getItem(SESSION_KEY);
    if (!rdns) return null;
    const wallets = await this.discoverWallets();
    const match = wallets.find((entry) => (entry.info?.rdns || "injected") === rdns);
    if (!match) return null;
    const accounts = await match.provider.request({ method: "eth_accounts" });
    if (!accounts?.length) return null;
    return this.connect(match, false);
  }

  async connect(walletDetail, requestAccounts = true) {
    if (!walletDetail?.provider) throw new Error("Choose a detected wallet.");
    this.ethereum = walletDetail.provider;
    this.walletInfo = walletDetail.info || { name: "Browser wallet", rdns: "injected", icon: "" };
    this.uiSimulation = localUiSimulation(this.ethereum);
    const accounts = await this.ethereum.request({
      method: requestAccounts ? "eth_requestAccounts" : "eth_accounts",
    });
    if (!accounts?.length) throw new Error("The wallet returned no account.");
    await this.ensureSepolia();
    if (this.uiSimulation) {
      this.account = accounts[0];
      this.signer = { getAddress: async () => this.account };
      this.browserProvider = {
        getBalance: async () => BigInt(this.uiSimulation.balances.eth),
        getBlock: async () => ({ timestamp: 2_000_000_000 }),
      };
      this.bindSimulatedContracts();
    } else {
      this.browserProvider = new BrowserProvider(this.ethereum);
      this.signer = await this.browserProvider.getSigner();
      this.account = await this.signer.getAddress();
      this.bindContracts();
    }
    this.bindWalletListeners();
    localStorage.setItem(SESSION_KEY, this.walletInfo.rdns || "injected");
    return this.walletState();
  }

  bindContracts() {
    const d = this.deployment;
    this.readContracts = {
      weth: new Contract(d.weth, ERC20_ABI, this.browserProvider),
      usdc: new Contract(d.usdc, ERC20_ABI, this.browserProvider),
      vault: new Contract(d.vault, VAULT_ABI, this.browserProvider),
      engine: new Contract(d.engine, ENGINE_ABI, this.browserProvider),
      adapter: new Contract(d.adapter, ADAPTER_ABI, this.browserProvider),
      chainlinkEthUsd: new Contract(d.chainlinkEthUsdFeed, CHAINLINK_ETH_USD_ABI, this.browserProvider),
    };
    this.writeContracts = {
      weth: this.readContracts.weth.connect(this.signer),
      usdc: this.readContracts.usdc.connect(this.signer),
      vault: this.readContracts.vault.connect(this.signer),
      engine: this.readContracts.engine.connect(this.signer),
    };
  }

  bindSimulatedContracts() {
    const handle = (byte) => `0x${byte.repeat(64)}`;
    this.readContracts = {
      vault: { availableHandle: async () => handle("a") },
      engine: {
        currentEpoch: async () => 42n,
        activeStrategyCount: async () => 1n,
      },
    };
    this.writeContracts = {};
  }

  simulatedTransaction(action, eventName, eventArgs, onMined) {
    const simulation = this.uiSimulation;
    if (!simulation) return null;
    if (simulation.failOnceAt === action && !simulation.failedActions.includes(action)) {
      simulation.failedActions.push(action);
      throw Object.assign(new Error(`Simulated ${action} failure for retry coverage.`), { step: action });
    }
    return {
      hash: simulation.hashes[action],
      wait: async () => {
        await wait(Number(simulation.delayMs || 0));
        onMined?.();
        return {
          status: 1,
          logs: [],
          __events: eventName ? { [eventName]: { name: eventName, args: eventArgs } } : {},
        };
      },
    };
  }

  bindWalletListeners() {
    const provider = this.ethereum;
    if (!provider?.on || this.boundProvider === provider) return;
    this.unbindWalletListeners();
    const accountsChanged = (accounts) => {
      if (!accounts?.length) this.disconnect();
      this.onWalletEvent?.("accountsChanged");
    };
    const chainChanged = () => this.onWalletEvent?.("chainChanged");
    provider.on("accountsChanged", accountsChanged);
    provider.on("chainChanged", chainChanged);
    this.boundProvider = provider;
    this.boundProviderListeners = { accountsChanged, chainChanged };
  }

  unbindWalletListeners() {
    const provider = this.boundProvider;
    const listeners = this.boundProviderListeners;
    if (provider && listeners) {
      const remove = provider.removeListener || provider.off;
      if (remove) {
        remove.call(provider, "accountsChanged", listeners.accountsChanged);
        remove.call(provider, "chainChanged", listeners.chainChanged);
      }
    }
    this.boundProvider = null;
    this.boundProviderListeners = null;
  }

  async ensureSepolia() {
    const chainId = await this.ethereum.request({ method: "eth_chainId" });
    if (String(chainId).toLowerCase() === SEPOLIA_CHAIN_ID) return;
    await this.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_CHAIN_ID }],
    });
  }

  disconnect() {
    localStorage.removeItem(SESSION_KEY);
    this.unbindWalletListeners();
    this.ethereum = null;
    this.browserProvider = null;
    this.signer = null;
    this.account = null;
    this.walletInfo = null;
    this.uiSimulation = null;
    this.readContracts = null;
    this.writeContracts = null;
  }

  requireWallet() {
    if (!this.account || !this.writeContracts) throw new Error("Connect a wallet first.");
  }

  async walletState() {
    this.requireWallet();
    if (this.uiSimulation) {
      const simulation = this.uiSimulation;
      const eth = BigInt(simulation.balances.eth);
      const weth = BigInt(simulation.balances.weth);
      const usdc = BigInt(simulation.balances.usdc);
      const twapPriceWad = BigInt(simulation.twapPriceWad);
      const marketPriceWad = BigInt(simulation.marketPriceWad || simulation.twapPriceWad);
      return {
        account: this.account,
        wallet: this.walletInfo,
        eth,
        weth,
        usdc,
        twapPriceWad,
        marketPriceWad,
        priceSource: "Chainlink ETH/USD",
        activeStrategyCount: 1n,
        formatted: {
          eth: formatEther(eth),
          weth: formatUnits(weth, 18),
          usdc: formatUnits(usdc, 6),
        },
      };
    }
    const [eth, weth, usdc, twap, market, active] = await Promise.all([
      this.browserProvider.getBalance(this.account),
      this.readContracts.weth.balanceOf(this.account),
      this.readContracts.usdc.balanceOf(this.account),
      this.readContracts.adapter.consultTwap(),
      this.readChainlinkEthUsd(),
      this.readContracts.engine.activeStrategyCount(),
    ]);
    return {
      account: this.account,
      wallet: this.walletInfo,
      eth,
      weth,
      usdc,
      twapPriceWad: twap[0],
      marketPriceWad: market.priceWad,
      marketPriceUpdatedAt: market.updatedAt,
      priceSource: market.source,
      activeStrategyCount: active,
      formatted: {
        eth: formatEther(eth),
        weth: formatUnits(weth, 18),
        usdc: formatUnits(usdc, 6),
      },
    };
  }

  async readChainlinkEthUsd() {
    const [decimals, description, round] = await Promise.all([
      this.readContracts.chainlinkEthUsd.decimals(),
      this.readContracts.chainlinkEthUsd.description(),
      this.readContracts.chainlinkEthUsd.latestRoundData(),
    ]);
    const answer = BigInt(round[1]);
    if (answer <= 0n) throw new Error("Chainlink ETH/USD returned a non-positive price.");
    const precision = 10n ** BigInt(18 - Number(decimals));
    return {
      priceWad: answer * precision,
      updatedAt: BigInt(round[3]),
      source: description || "Chainlink ETH/USD",
    };
  }

  token(direction) {
    const wethSide = Number(direction) === 0;
    return wethSide
      ? { address: this.deployment.weth, symbol: "WETH", decimals: 18, contract: this.writeContracts.weth }
      : { address: this.deployment.usdc, symbol: "USDC", decimals: 6, contract: this.writeContracts.usdc };
  }

  async publicTokenState(direction, amountText) {
    this.requireWallet();
    if (this.uiSimulation) {
      const wethSide = Number(direction) === 0;
      const decimals = wethSide ? 18 : 6;
      return {
        address: wethSide ? this.deployment.weth : this.deployment.usdc,
        symbol: wethSide ? "WETH" : "USDC",
        decimals,
        amount: parseUnits(String(amountText || "0"), decimals),
        balance: BigInt(wethSide ? this.uiSimulation.balances.weth : this.uiSimulation.balances.usdc),
        allowance: BigInt(this.uiSimulation.allowance || "0"),
      };
    }
    const token = this.token(direction);
    const amount = parseUnits(String(amountText || "0"), token.decimals);
    const [balance, allowance] = await Promise.all([
      token.contract.balanceOf(this.account),
      token.contract.allowance(this.account, this.deployment.vault),
    ]);
    return { ...token, amount, balance, allowance };
  }

  async approve(direction, amount) {
    this.requireWallet();
    await this.ensureSepolia();
    if (this.uiSimulation) return this.simulatedTransaction("approve", null, null, () => {
      this.uiSimulation.allowance = amount.toString();
    });
    return this.token(direction).contract.approve(this.deployment.vault, amount);
  }

  async deposit(direction, amount) {
    this.requireWallet();
    await this.ensureSepolia();
    if (this.uiSimulation) return this.simulatedTransaction("deposit");
    return this.writeContracts.vault.deposit(this.token(direction).address, amount);
  }

  async createStrategy(encrypted, clientNonce) {
    this.requireWallet();
    await this.ensureSepolia();
    if (this.uiSimulation) {
      return this.simulatedTransaction("create", "StrategyCreated", { strategyId: this.uiSimulation.strategyId });
    }
    return this.sendWithEstimatedGas(this.writeContracts.engine.createStrategy, [encrypted, clientNonce]);
  }

  async sendWithEstimatedGas(method, args = []) {
    const estimate = await method.estimateGas(...args);
    const gasLimit = (estimate * GAS_BUFFER_NUMERATOR + GAS_BUFFER_DENOMINATOR - 1n)
      / GAS_BUFFER_DENOMINATOR;
    if (gasLimit > GAS_LIMIT_CAP) {
      throw new Error(`Estimated gas ${gasLimit} exceeds the Sepolia transaction cap.`);
    }
    return method(...args, { gasLimit });
  }

  parseEvent(receipt, name) {
    if (receipt?.__events?.[name]) return receipt.__events[name];
    for (const log of receipt?.logs || []) {
      try {
        const parsed = this.writeContracts.engine.interface.parseLog(log);
        if (parsed?.name === name) return parsed;
      } catch {}
    }
    return null;
  }

  async strategy(strategyId) {
    this.requireWallet();
    if (this.uiSimulation) {
      const handle = (byte) => `0x${byte.repeat(64)}`;
      return {
        publicState: { owner: this.account },
        handles: {
          direction: handle("1"),
          remaining: handle("2"),
          clip: handle("3"),
          limitPriceWad: handle("4"),
          slippageBps: handle("5"),
        },
      };
    }
    const [publicState, handles] = await Promise.all([
      this.readContracts.engine.getStrategyPublic(strategyId),
      this.readContracts.engine.strategyHandles(strategyId),
    ]);
    return { publicState, handles };
  }

  async lockEpoch(deadline) {
    this.requireWallet();
    await this.ensureSepolia();
    if (this.uiSimulation) {
      return this.simulatedTransaction("lock", "EpochOpened", { epochId: this.uiSimulation.epochId });
    }
    return this.sendWithEstimatedGas(this.writeContracts.engine.lockCurrentEpoch, [deadline]);
  }

  async epoch(epochId) {
    if (this.uiSimulation) {
      const handle = (byte) => `0x${byte.repeat(64)}`;
      return {
        status: this.uiSimulation.settled ? 5 : 2,
        residualDirectionHandle: handle("6"),
        residualAmountHandle: handle("7"),
        aggregateMinOutHandle: handle("8"),
        residualDirection: 0,
        residualAmount: 1_000_000_000_000_000n,
        amountOut: 2_500_000n,
      };
    }
    return this.readContracts.engine.getEpoch(epochId);
  }

  async epochPrivateHandles(epochId) {
    if (this.uiSimulation) {
      const handle = (byte) => `0x${byte.repeat(64)}`;
      return { totalRequestedQuote: handle("9"), matchedQuote: handle("a") };
    }
    return this.readContracts.engine.epochPrivateHandles(epochId);
  }

  async finalizeEpoch(epochId, proofs) {
    this.requireWallet();
    if (this.uiSimulation) return this.simulatedTransaction("finalize");
    return this.sendWithEstimatedGas(this.writeContracts.engine.finalizeAggregate, [
      epochId,
      proofs.direction.decryptionProof,
      proofs.amount.decryptionProof,
      proofs.minimum.decryptionProof,
    ]);
  }

  async settleEpoch(epochId) {
    this.requireWallet();
    if (this.uiSimulation) return this.simulatedTransaction("settle", null, null, () => {
      this.uiSimulation.settled = true;
    });
    return this.sendWithEstimatedGas(this.writeContracts.engine.settle, [epochId]);
  }

  async waitForReceipt(tx, onElapsed, timeoutMs = 420_000) {
    const startedAt = Date.now();
    const timer = setInterval(() => onElapsed?.(Date.now() - startedAt), 1_000);
    try {
      const receipt = await Promise.race([
        tx.wait(),
        wait(timeoutMs).then(() => { throw new Error("Transaction confirmation timed out. Retry safely from Chain view."); }),
      ]);
      if (!receipt || receipt.status !== 1) throw new Error("Transaction reverted.");
      return receipt;
    } finally {
      clearInterval(timer);
    }
  }

  async addToken(symbol) {
    this.requireWallet();
    const isWeth = symbol === "WETH";
    return this.ethereum.request({
      method: "wallet_watchAsset",
      params: {
        type: "ERC20",
        options: {
          address: isWeth ? this.deployment.weth : this.deployment.usdc,
          symbol,
          decimals: isWeth ? 18 : 6,
        },
      },
    });
  }

  etherscanAddress(address) {
    return `https://sepolia.etherscan.io/address/${address}`;
  }

  etherscanTx(hash) {
    return `https://sepolia.etherscan.io/tx/${hash}`;
  }

  static explainError(error) {
    return normalizedError(error);
  }
}

export { ZERO_ADDRESS };
