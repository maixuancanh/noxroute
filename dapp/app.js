import { formatUnits, parseUnits } from "./nox-browser.js";
import { NoxRouteChain } from "./v3-chain.js?v=chainlink-rate-1";
import { NoxRoutePrivacy } from "./v3-privacy.js";

const chain = new NoxRouteChain();
const privacy = new NoxRoutePrivacy(chain);
const LAST_STRATEGY_KEY = "noxroute:v3:last-strategy";
const LAST_EPOCH_KEY = "noxroute:v3:last-epoch";
const TX_HISTORY_KEY = "noxroute:v3:tx-history";
const WAD = 10n ** 18n;
const USDC_ATOMS = 10n ** 6n;
const USDC_ATOMS_PER_QUOTE_WAD = WAD / USDC_ATOMS;

const state = {
  mode: "instant",
  direction: 0,
  wallet: null,
  deployment: null,
  lastStrategy: readJson(LAST_STRATEGY_KEY),
  lastEpoch: readJson(LAST_EPOCH_KEY),
  txHistory: readJson(TX_HISTORY_KEY) || [],
  strategyFlow: null,
  epochFlow: null,
  strategyRetry: null,
  epochRetry: null,
  howStep: 0,
  howTimer: null,
};

const STRATEGY_STEPS = [
  ["connect", "Connect", "Wallet and Sepolia are ready."],
  ["approve", "Approve", "Approve the public ERC-20 deposit only if needed."],
  ["deposit", "Deposit", "Move the public deposit into the confidential vault."],
  ["encrypt", "Nox encrypt", "Encrypt budget, clip, limit, slippage and direction."],
  ["create", "Create strategy", "Send only Nox handles and proofs to the V3 engine."],
];

const EPOCH_STEPS = [
  ["lock", "Lock epoch", "Freeze the active strategy set at official Uniswap TWAP."],
  ["proof", "Wait for Nox proof", "Public-decrypt exactly three aggregate settlement handles."],
  ["finalize", "Finalize aggregate", "Bind the proofs to the committed epoch action."],
  ["settle", "Settle Uniswap residual", "Settle only the unmatched aggregate through SwapRouter02."],
];

const HOW_STEPS = [
  {
    title: "Wallet deposit",
    detail: "The wallet funds the strategy with the selected ERC-20 token. This boundary is intentionally public because ERC-20 transfers are public.",
    publicText: "Wallet, token and deposit amount.",
    privateText: "The future strategy intent is not revealed in calldata.",
  },
  {
    title: "Nox encryption",
    detail: "Nox encrypts the strategy-defining fields: budget, clip, limit, slippage and direction.",
    publicText: "A strategy creation transaction containing Nox handles.",
    privateText: "Actual constraints, direction and trading limits.",
  },
  {
    title: "Private vault",
    detail: "Persistent encrypted state tracks remaining balance and eligibility across epochs.",
    publicText: "Strategy existence and authorized contract interactions.",
    privateText: "Remaining budget, per-user credit and execution readiness.",
  },
  {
    title: "Batch matching",
    detail: "Nox compares encrypted opposing flows and nets them before any public market route is needed.",
    publicText: "A batch epoch exists.",
    privateText: "Requested volume, matched volume and participant allocations.",
  },
  {
    title: "Uniswap V3",
    detail: "Only the aggregate residual routes through the official Uniswap V3 router and pool.",
    publicText: "One aggregate residual settlement and official pool interaction.",
    privateText: "Which user caused which part of the residual.",
  },
  {
    title: "USDC credit",
    detail: "The strategy receives owner-authorized vault credit while the public chain sees only the aggregate result.",
    publicText: "Aggregate output and residual settlement.",
    privateText: "Per-user output credit and strategy continuation state.",
  },
];

function byId(id) { return document.getElementById(id); }

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = value;
}

function setStatus(message, error = false) {
  const element = byId("actionStatus");
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("error", error);
}

function short(value, head = 8, tail = 6) {
  if (!value || value.length <= head + tail + 3) return value || "-";
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function openModal(id) {
  const modal = byId(id);
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.querySelector("button, a, input")?.focus();
}

function closeModal(id) {
  byId(id)?.classList.add("hidden");
}

function setPage(page, scrollTarget = null) {
  const nextPage = ["trade", "how", "contracts"].includes(page) ? page : "home";
  for (const view of document.querySelectorAll("[data-page]")) {
    view.classList.toggle("hidden", view.dataset.page !== nextPage);
  }
  for (const link of document.querySelectorAll("[data-page-link]")) {
    link.classList.toggle("active", link.dataset.pageLink === nextPage && !link.dataset.scrollTarget);
  }
  const hash = nextPage === "contracts" ? "#contracts" : nextPage === "how" ? "#how-it-works" : nextPage === "trade" ? scrollTarget ? `#${scrollTarget}` : "#trade" : "#home";
  if (window.location.hash !== hash) history.replaceState(null, "", hash);
  const target = scrollTarget ? byId(scrollTarget) : nextPage === "contracts" ? byId("contractsPanel") : nextPage === "how" ? byId("howPage") : nextPage === "trade" ? byId("tradePage") : byId("homePage");
  target?.scrollIntoView({ block: "start" });
  if (nextPage === "how") startHowDemo();
  else stopHowDemo();
}

function restorePageFromHash() {
  const hash = window.location.hash.replace("#", "");
  if (["contracts", "contractsPanel", "chainView", "privacyReceipt"].includes(hash)) {
    setPage("contracts");
    return;
  }
  if (["how", "how-it-works", "howPage"].includes(hash)) {
    setPage("how");
    return;
  }
  if (["trade", "strategyComposer", "depositDisclosure"].includes(hash)) {
    setPage("trade", hash === "trade" ? null : hash);
    return;
  }
  if (hash === "depositDisclosure") {
    setPage("trade", "depositDisclosure");
    return;
  }
  setPage("home");
}

function setHowStep(index) {
  state.howStep = index % HOW_STEPS.length;
  const current = HOW_STEPS[state.howStep];
  for (const node of document.querySelectorAll(".how-node")) {
    const nodeStep = Number(node.dataset.howStep);
    node.classList.toggle("active", nodeStep === state.howStep);
    node.classList.toggle("complete", nodeStep < state.howStep);
  }
  for (const marker of document.querySelectorAll(".how-flow-step")) {
    const markerStep = Number(marker.dataset.howFlowStep);
    marker.classList.toggle("active", markerStep === state.howStep);
    marker.classList.toggle("complete", markerStep < state.howStep);
  }
  setText("howStepTitle", current.title);
  setText("howStepDetail", current.detail);
  setText("howPublicText", current.publicText);
  setText("howPrivateText", current.privateText);
  const progress = byId("howProgressBar");
  if (progress) progress.style.transform = `scaleX(${(state.howStep + 1) / HOW_STEPS.length})`;
}

function stopHowDemo() {
  if (!state.howTimer) return;
  clearInterval(state.howTimer);
  state.howTimer = null;
}

function startHowDemo(reset = false) {
  if (reset) state.howStep = 0;
  setHowStep(state.howStep);
  stopHowDemo();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  state.howTimer = setInterval(() => setHowStep(state.howStep + 1), 2200);
}

function elapsedLabel(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function renderProgress(containerId, steps) {
  const container = byId(containerId);
  if (!container) return;
  container.textContent = "";
  for (const [id, title, detail] of steps) {
    const row = document.createElement("div");
    row.className = "progress-step waiting";
    row.dataset.step = id;
    const icon = document.createElement("span");
    icon.className = "step-icon";
    icon.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    copy.className = "step-copy";
    const strong = document.createElement("strong");
    strong.textContent = title;
    const meta = document.createElement("span");
    meta.textContent = detail;
    copy.append(strong, meta);
    row.append(icon, copy);
    container.append(row);
  }
}

function setProgress(containerId, stepId, status, detail) {
  const container = byId(containerId);
  const row = container?.querySelector(`[data-step="${stepId}"]`);
  if (!row) return;
  if (status === "current") {
    for (const active of container.querySelectorAll(".progress-step.current")) {
      if (active !== row) active.className = "progress-step waiting";
    }
  }
  row.className = `progress-step ${status}`;
  const icon = row.querySelector(".step-icon");
  if (icon) icon.textContent = status === "done" ? "\u2713" : status === "failed" ? "!" : "";
  if (detail) row.querySelector(".step-copy span").textContent = detail;
}

function failProgress(containerId, stepId, error, retryId) {
  const message = NoxRouteChain.explainError(error);
  setProgress(containerId, stepId, "failed", message);
  byId(retryId)?.classList.remove("hidden");
  return message;
}

function currentToken() {
  return state.direction === 0
    ? { input: "WETH", output: "USDC", inputDecimals: 18, outputDecimals: 6 }
    : { input: "USDC", output: "WETH", inputDecimals: 6, outputDecimals: 18 };
}

function parseDecimal(value, decimals, label) {
  const normalized = String(value || "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error(`${label} must be a positive number.`);
  const amount = parseUnits(normalized, decimals);
  if (amount <= 0n) throw new Error(`${label} must be greater than zero.`);
  return amount;
}

function readStrategyValues() {
  const token = currentToken();
  const budget = parseDecimal(byId("budgetInput").value, token.inputDecimals, "Private budget");
  const clip = state.mode === "instant"
    ? budget
    : parseDecimal(byId("clipInput").value, token.inputDecimals, "Clip per epoch");
  if (clip > budget) throw new Error("Clip per epoch cannot exceed the private budget.");
  const limitPriceWad = parseDecimal(byId("limitInput").value, 18, "Private limit");
  const slippageText = String(byId("slippageInput").value || "").trim();
  if (!/^\d+$/.test(slippageText)) throw new Error("Private slippage must be a whole number of basis points.");
  const slippageBps = BigInt(slippageText);
  if (slippageBps > 10_000n) throw new Error("Private slippage cannot exceed 10,000 bps.");
  return { direction: BigInt(state.direction), budget, clip, limitPriceWad, slippageBps, token };
}

function renderDirection() {
  const token = currentToken();
  setText("inputTokenSymbol", token.input);
  setText("outputTokenSymbol", token.output);
  const inputIcon = byId("inputTokenIcon");
  const outputIcon = byId("outputTokenIcon");
  if (state.direction === 0) {
    inputIcon.src = "./assets/weth-token.png";
    inputIcon.alt = "WETH token mark";
    outputIcon.src = "./assets/usdc-token.png";
    outputIcon.alt = "USDC token mark";
  } else {
    inputIcon.src = "./assets/usdc-token.png";
    inputIcon.alt = "USDC token mark";
    outputIcon.src = "./assets/weth-token.png";
    outputIcon.alt = "WETH token mark";
  }
  refreshWalletMetrics().catch(() => {});
  updateEstimate();
}

function setMode(mode) {
  state.mode = mode;
  const instant = mode === "instant";
  byId("instantMode").classList.toggle("active", instant);
  byId("dcaMode").classList.toggle("active", !instant);
  byId("instantMode").setAttribute("aria-selected", String(instant));
  byId("dcaMode").setAttribute("aria-selected", String(!instant));
  byId("strategyComposer").classList.toggle("is-instant", instant);
  setText("budgetHelp", instant ? "Private one-clip budget" : "Private recurring budget");
  setText("executionMode", instant ? "One encrypted clip" : "Persistent encrypted clips");
  updateEstimate();
}

function quoteWethToUsdc(wethAmount, priceWad) {
  const quoteWad = wethAmount * priceWad / WAD;
  return quoteWad / USDC_ATOMS_PER_QUOTE_WAD;
}

function quoteUsdcToWeth(usdcAmount, priceWad) {
  const quoteWad = usdcAmount * USDC_ATOMS_PER_QUOTE_WAD;
  return quoteWad * WAD / priceWad;
}

function updateEstimate() {
  try {
    const values = readStrategyValues();
    const quotePriceWad = state.wallet?.marketPriceWad || state.wallet?.twapPriceWad || 0n;
    if (!quotePriceWad) {
      setText("estimatedOutput", "-");
      return;
    }
    const output = state.direction === 0
      ? quoteWethToUsdc(values.budget, quotePriceWad)
      : quoteUsdcToWeth(values.budget, quotePriceWad);
    const source = state.wallet?.priceSource || "market rate";
    setText("estimatedOutput", formatUnits(output, values.token.outputDecimals));
    setText("twapPrice", `${formatUnits(quotePriceWad, 18)} USDC / WETH - ${source}`);
    setText("budgetError", "");
  } catch (error) {
    setText("estimatedOutput", "-");
    setText("budgetError", error.message);
  }
}

async function refreshWalletMetrics() {
  if (!chain.account) return;
  state.wallet = await chain.walletState();
  const token = currentToken();
  const publicBalance = state.direction === 0 ? state.wallet.formatted.weth : state.wallet.formatted.usdc;
  setText("publicWalletBalance", `${publicBalance} ${token.input}`);
  setText("currentEpoch", String(await chain.readContracts.engine.currentEpoch()));
  setText("participantCount", `${state.wallet.activeStrategyCount} / 8`);
  setText("networkBadge", "Sepolia");
  byId("networkBadge").prepend(Object.assign(document.createElement("span"), { className: "status-dot ok" }));
  updateEstimate();
}

function renderDisconnected() {
  state.wallet = null;
  setText("walletStatus", "Connect wallet");
  byId("walletDot").className = "status-dot neutral";
  byId("accountMenu")?.classList.add("hidden");
  byId("accountPill").setAttribute("aria-expanded", "false");
  setText("accountFull", "Not connected");
  setText("publicWalletBalance", "Wallet balance -");
  setText("confidentialVaultBalance", "Confidential vault -");
  setText("primaryStrategyAction", "Connect wallet");
  setStatus("Connect a wallet to create a Nox strategy.");
  clearPrivateValues();
}

function clearPrivateValues() {
  const grid = byId("privateStateGrid");
  if (grid) {
    grid.textContent = "";
    const message = document.createElement("p");
    message.textContent = "Authorize this wallet to reveal its encrypted handles.";
    grid.append(message);
  }
  setText("confidentialVaultBalance", "Confidential vault \u2014");
  setText("privateRequested", "\u2022\u2022\u2022\u2022");
  setText("internallyMatched", "\u2022\u2022\u2022\u2022");
  setText("savingsLock", "Locked");
  byId("savingsLock")?.classList.remove("unlocked");
  closeModal("revealModal");
}

async function renderConnected(walletState) {
  state.wallet = walletState;
  const walletLabel = walletState.wallet?.name;
  setText("walletStatus", walletLabel ? `${walletLabel} \u00b7 ${short(walletState.account, 6, 4)}` : short(walletState.account, 6, 4));
  setText("accountFull", walletState.account);
  byId("walletDot").className = "status-dot ok";
  byId("accountMenu")?.classList.add("hidden");
  byId("accountPill").setAttribute("aria-expanded", "false");
  setText("primaryStrategyAction", state.mode === "instant" ? "Create private strategy" : "Start Stealth DCA");
  setStatus("Ready. Wallet confirmations open automatically when required.");
  await privacy.connect();
  await refreshWalletMetrics();
  renderSavedWorkspace();
}

function setBudgetPercent(percent) {
  if (!state.wallet) {
    setStatus("Connect a wallet before using balance presets.", true);
    return;
  }
  const balance = state.direction === 0 ? state.wallet.weth : state.wallet.usdc;
  const decimals = state.direction === 0 ? 18 : 6;
  const amount = BigInt(balance) * BigInt(percent) / 100n;
  const formatted = formatUnits(amount, decimals)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
  byId("budgetInput").value = formatted;
  updateEstimate();
}

async function openWalletChooser() {
  openModal("walletModal");
  const list = byId("walletList");
  list.textContent = "";
  setText("walletModalStatus", "Detecting EIP-6963 wallet extensions...");
  const wallets = await chain.discoverWallets();
  if (!wallets.length) {
    setText("walletModalStatus", "No wallet extension detected. Install MetaMask, Rabby or another EVM wallet, then refresh.");
    return;
  }
  setText("walletModalStatus", "Choose a wallet to continue on Sepolia.");
  for (const wallet of wallets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wallet-option";
    if (wallet.info?.icon) {
      const image = document.createElement("img");
      image.src = wallet.info.icon;
      image.alt = "";
      button.append(image);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "wallet-fallback-icon";
      fallback.textContent = (wallet.info?.name || "W").slice(0, 1).toUpperCase();
      button.append(fallback);
    }
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = wallet.info?.name || "Browser wallet";
    const rdns = document.createElement("span");
    rdns.textContent = wallet.info?.rdns || "Injected provider";
    copy.append(name, rdns);
    button.append(copy);
    button.addEventListener("click", () => connectWallet(wallet));
    list.append(button);
  }
}

async function connectWallet(wallet) {
  setText("walletModalStatus", `Waiting for ${wallet.info?.name || "wallet"}...`);
  try {
    const walletState = await chain.connect(wallet);
    closeModal("walletModal");
    await renderConnected(walletState);
  } catch (error) {
    setText("walletModalStatus", NoxRouteChain.explainError(error));
  }
}

function addTransaction(label, hash) {
  if (!hash) return;
  state.txHistory.unshift({ label, hash, at: Date.now() });
  state.txHistory = state.txHistory.slice(0, 12);
  saveJson(TX_HISTORY_KEY, state.txHistory);
  renderTransactions();
}

function renderTransactions() {
  const list = byId("transactionList");
  list.textContent = "";
  if (!state.txHistory.length) {
    const empty = document.createElement("p");
    empty.textContent = "No V3 transaction in this browser session.";
    list.append(empty);
    return;
  }
  for (const entry of state.txHistory) {
    const link = document.createElement("a");
    link.href = chain.etherscanTx(entry.hash);
    link.target = "_blank";
    link.rel = "noreferrer";
    const label = document.createElement("span");
    label.textContent = entry.label;
    const hash = document.createElement("code");
    hash.textContent = short(entry.hash);
    link.append(label, hash);
    list.append(link);
  }
}

function renderChainManifest() {
  const d = state.deployment;
  const rows = [
    ["engineLink", "engineAddress", d.engine],
    ["noxComputeLink", "noxComputeAddress", d.noxCompute],
    ["poolLink", "poolAddress", d.uniswapPool],
    ["routerLink", "routerAddress", d.swapRouter02],
  ];
  for (const [linkId, textId, address] of rows) {
    byId(linkId).href = chain.etherscanAddress(address);
    setText(textId, short(address));
    byId(textId).title = address;
  }
  renderTransactions();
}

function renderSavedWorkspace() {
  if (!state.lastStrategy) return;
  byId("strategyWorkspace").classList.remove("hidden");
  setText("workspaceTitle", state.lastEpoch?.status === "settled" ? "Last epoch settled" : "Waiting for the next epoch");
  setText("strategySummary", `Strategy ${short(state.lastStrategy.strategyId)} uses persistent Nox handles.`);
}

function strategyReceipt(receipt) {
  const container = byId("strategyHandleReceipt");
  container.textContent = "";
  for (const [label, value] of Object.entries(receipt)) {
    if (label === "proofBytes") continue;
    const row = document.createElement("div");
    const name = document.createElement("span");
    name.textContent = label;
    const code = document.createElement("code");
    code.textContent = short(value, 12, 10);
    code.title = value;
    row.append(name, code);
    container.append(row);
  }
}

async function createStrategyFlow() {
  byId("retryStrategy").classList.add("hidden");
  openModal("strategyProgressModal");
  if (!state.strategyFlow) {
    renderProgress("strategyProgressSteps", STRATEGY_STEPS);
    state.strategyFlow = { stage: "start", startedAt: Date.now() };
  }
  const flow = state.strategyFlow;
  const elapsed = () => setText("strategyElapsed", `Elapsed ${elapsedLabel(Date.now() - flow.startedAt)}`);
  const timer = setInterval(elapsed, 1_000);
  try {
    let values = flow.values;
    if (!chain.account) {
      setProgress("strategyProgressSteps", "connect", "current", "Choose a wallet to continue.");
      closeModal("strategyProgressModal");
      await openWalletChooser();
      throw new Error("Connect a wallet, then press the primary action again.");
    }
    setProgress("strategyProgressSteps", "connect", "done", `${short(chain.account)} on Sepolia.`);

    if (!values) {
      values = readStrategyValues();
      flow.values = values;
      flow.tokenState = await chain.publicTokenState(state.direction, byId("budgetInput").value);
      if (flow.tokenState.balance < values.budget) {
        throw Object.assign(new Error(`Wallet needs ${formatUnits(values.budget, values.token.inputDecimals)} ${values.token.input} for the public deposit.`), { step: "approve" });
      }
    }

    if (flow.tokenState.allowance < values.budget && !flow.approved) {
      setProgress("strategyProgressSteps", "approve", "current", `Confirm ${values.token.input} approval in your wallet.`);
      const tx = await chain.approve(state.direction, values.budget);
      addTransaction("Approve vault", tx.hash);
      await chain.waitForReceipt(tx, elapsed);
      flow.approved = true;
    }
    setProgress("strategyProgressSteps", "approve", "done", "Vault allowance is ready.");

    if (!flow.deposited) {
      setProgress("strategyProgressSteps", "deposit", "current", `Confirm the public ${values.token.input} deposit.`);
      const tx = await chain.deposit(state.direction, values.budget);
      addTransaction("Public vault deposit", tx.hash);
      await chain.waitForReceipt(tx, elapsed);
      flow.depositTx = tx.hash;
      flow.deposited = true;
    }
    setProgress("strategyProgressSteps", "deposit", "done", "Public deposit recorded; private ledger handle updated.");

    if (!flow.encrypted) {
      setProgress("strategyProgressSteps", "encrypt", "current", "Authorize Nox encryption. Plaintext fields stay out of calldata.");
      flow.encrypted = await privacy.encryptStrategy(values);
    }
    setProgress("strategyProgressSteps", "encrypt", "done", "Five Nox handles and proofs are ready.");

    if (!flow.strategyId) {
      setProgress("strategyProgressSteps", "create", "current", "Confirm the handle-only strategy transaction.");
      flow.clientNonce ||= BigInt(Date.now());
      const tx = await chain.createStrategy(flow.encrypted.input, flow.clientNonce);
      addTransaction("Create Nox strategy", tx.hash);
      const receipt = await chain.waitForReceipt(tx, elapsed);
      const event = chain.parseEvent(receipt, "StrategyCreated");
      if (!event) throw Object.assign(new Error("StrategyCreated event was not found in the confirmed receipt."), { step: "create" });
      flow.strategyId = event.args.strategyId;
      flow.createTx = tx.hash;
    }
    setProgress("strategyProgressSteps", "create", "done", `Strategy ${short(flow.strategyId)} is active.`);

    state.lastStrategy = {
      strategyId: flow.strategyId,
      createTx: flow.createTx,
      depositTx: flow.depositTx,
      direction: state.direction,
      mode: state.mode,
      handles: flow.encrypted.receipt,
    };
    saveJson(LAST_STRATEGY_KEY, state.lastStrategy);
    renderSavedWorkspace();
    strategyReceipt(flow.encrypted.receipt);
    byId("strategyTxLink").href = chain.etherscanTx(flow.createTx);
    setText("strategyReceiptEvidence", chain.uiSimulation ? "simulated provider UI test" : "Encrypted on Sepolia");
    setText("strategyReceiptTitle", chain.uiSimulation ? "Strategy UI state created" : "Strategy created");
    setText("strategyReceiptBody", chain.uiSimulation
      ? "The simulated provider UI test rendered a strategy-created receipt. No Nox encryption or Sepolia transaction was performed."
      : state.mode === "instant"
        ? "Your one-clip strategy is encrypted and ready for permissionless epoch execution."
        : "Your recurring strategy persists privately across epochs until its budget is exhausted or you cancel it.");
    state.strategyFlow = null;
    state.strategyRetry = null;
    closeModal("strategyProgressModal");
    openModal("strategyReceiptModal");
    await refreshWalletMetrics();
  } catch (error) {
    if (!chain.account) {
      state.strategyFlow = null;
      setStatus(NoxRouteChain.explainError(error), true);
      return;
    }
    const failedStep = error.step || (flow.encrypted ? "create" : flow.deposited ? "encrypt" : flow.approved ? "deposit" : "approve");
    const message = failProgress("strategyProgressSteps", failedStep, error, "retryStrategy");
    state.strategyRetry = createStrategyFlow;
    setStatus(message, true);
  } finally {
    clearInterval(timer);
    elapsed();
  }
}

async function advanceEpochFlow() {
  if (!chain.account) return openWalletChooser();
  byId("retryEpoch").classList.add("hidden");
  openModal("epochProgressModal");
  if (!state.epochFlow) {
    renderProgress("epochProgressSteps", EPOCH_STEPS);
    state.epochFlow = { stage: "start", startedAt: Date.now() };
  }
  const flow = state.epochFlow;
  const elapsed = () => setText("epochElapsed", `Elapsed ${elapsedLabel(Date.now() - flow.startedAt)}`);
  const timer = setInterval(elapsed, 1_000);
  try {
    if (!flow.epochId) {
      setProgress("epochProgressSteps", "lock", "current", "Confirm permissionless epoch lock in your wallet.");
      const block = await chain.browserProvider.getBlock("latest");
      const tx = await chain.lockEpoch(BigInt(block.timestamp + 1_200));
      addTransaction("Lock private epoch", tx.hash);
      const receipt = await chain.waitForReceipt(tx, elapsed);
      const event = chain.parseEvent(receipt, "EpochOpened");
      if (!event) throw Object.assign(new Error("EpochOpened event missing from confirmed lock transaction."), { step: "lock" });
      flow.epochId = event.args.epochId;
      flow.lockTx = tx.hash;
    }
    setProgress("epochProgressSteps", "lock", "done", `Epoch ${short(flow.epochId)} is locked.`);

    if (!flow.proofs) {
      setProgress("epochProgressSteps", "proof", "current", "Nox is computing the three aggregate public settlement fields.");
      flow.lockedEpoch = await chain.epoch(flow.epochId);
      flow.proofs = await privacy.publicDecryptEpoch(flow.lockedEpoch, (ms) => {
        setText("epochElapsed", `Elapsed ${elapsedLabel(ms)} - waiting for Nox`);
      });
    }
    setProgress("epochProgressSteps", "proof", "done", "Residual direction, amount and aggregate minimum are ready.");

    if (!flow.finalizeTx) {
      setProgress("epochProgressSteps", "finalize", "current", "Confirm aggregate proof finalization.");
      const tx = await chain.finalizeEpoch(flow.epochId, flow.proofs);
      addTransaction("Finalize Nox aggregate", tx.hash);
      await chain.waitForReceipt(tx, elapsed);
      flow.finalizeTx = tx.hash;
    }
    setProgress("epochProgressSteps", "finalize", "done", "Committed action is ready and replay-protected.");

    if (!flow.settlementTx) {
      setProgress("epochProgressSteps", "settle", "current", "Confirm settlement; only a nonzero residual touches Uniswap.");
      const tx = await chain.settleEpoch(flow.epochId);
      addTransaction("Settle Uniswap residual", tx.hash);
      await chain.waitForReceipt(tx, elapsed);
      flow.settlementTx = tx.hash;
    }
    const settled = await chain.epoch(flow.epochId);
    if (Number(settled.status) !== 5) throw Object.assign(new Error("Confirmed transaction did not leave the epoch in Settled state."), { step: "settle" });
    setProgress("epochProgressSteps", "settle", "done", `Settled ${settled.residualAmount} residual atoms through the committed route.`);

    state.lastEpoch = {
      epochId: flow.epochId,
      lockTx: flow.lockTx,
      finalizeTx: flow.finalizeTx,
      settlementTx: flow.settlementTx,
      status: "settled",
      residualAmount: settled.residualAmount.toString(),
      residualDirection: Number(settled.residualDirection),
      amountOut: settled.amountOut.toString(),
    };
    saveJson(LAST_EPOCH_KEY, state.lastEpoch);
    setText("epochStatus", "Settled");
    setText("publicResidual", formatResidual(settled.residualAmount, Number(settled.residualDirection)));
    setText("workspaceTitle", "Last epoch settled");
    byId("settlementTxLink").href = chain.etherscanTx(flow.settlementTx);
    setText("finalResultEvidence", chain.uiSimulation ? "simulated provider UI test" : "Official settlement verified");
    setText("finalResultTitle", chain.uiSimulation ? "Settlement UI state" : "Epoch settled");
    setText("finalResultBody", chain.uiSimulation
      ? "The simulated provider UI test rendered the official Uniswap V3 routing receipt with the provider-returned hash. No Sepolia transaction was performed."
      : settled.residualAmount === 0n
        ? "The epoch netted internally; no Uniswap swap was needed. Private owner allocations are ready."
        : `The aggregate residual settled on official Uniswap V3. ${settled.amountOut} output atoms returned to the confidential vault.`);
    state.epochFlow = null;
    state.epochRetry = null;
    closeModal("epochProgressModal");
    openModal("finalResultModal");
    await refreshWalletMetrics();
  } catch (error) {
    const failedStep = error.step || (flow.finalizeTx ? "settle" : flow.proofs ? "finalize" : flow.epochId ? "proof" : "lock");
    const message = failProgress("epochProgressSteps", failedStep, error, "retryEpoch");
    state.epochRetry = advanceEpochFlow;
    setStatus(message, true);
  } finally {
    clearInterval(timer);
    elapsed();
  }
}

function formatResidual(amount, direction) {
  const symbol = direction === 0 ? "WETH" : "USDC";
  return `${formatUnits(BigInt(amount), direction === 0 ? 18 : 6)} ${symbol}`;
}

async function revealPrivateState() {
  if (!chain.account) return openWalletChooser();
  if (!state.lastStrategy?.strategyId) {
    setStatus("Create a strategy before revealing owner-only state.", true);
    return;
  }
  openModal("revealModal");
  byId("privateStateGrid").innerHTML = "<p>Waiting for owner-authorized Nox decryption...</p>";
  try {
    const revealed = await privacy.decryptOwnerState(state.lastStrategy.strategyId, (ms) => {
      byId("privateStateGrid").innerHTML = `<p>Waiting for Nox - ${elapsedLabel(ms)}</p>`;
    });
    const rows = [
      ["Direction", Number(revealed.direction) === 0 ? "Sell WETH" : "Sell USDC"],
      ["Budget remaining", formatUnits(revealed.remaining, Number(revealed.direction) === 0 ? 18 : 6)],
      ["Next clip", formatUnits(revealed.clip, Number(revealed.direction) === 0 ? 18 : 6)],
      ["Private limit", `${formatUnits(revealed.limitPriceWad, 18)} USDC/WETH`],
      ["Private slippage", `${revealed.slippageBps} bps`],
      ["Confidential WETH", formatUnits(revealed.wethBalance, 18)],
      ["Confidential USDC", formatUnits(revealed.usdcBalance, 6)],
    ];
    const grid = byId("privateStateGrid");
    grid.textContent = "";
    for (const [label, value] of rows) {
      const cell = document.createElement("div");
      const name = document.createElement("span");
      name.textContent = label;
      const strong = document.createElement("strong");
      strong.textContent = value;
      cell.append(name, strong);
      grid.append(cell);
    }
    setText("confidentialVaultBalance", `${formatUnits(revealed.wethBalance, 18)} WETH - ${formatUnits(revealed.usdcBalance, 6)} USDC`);

    if (state.lastEpoch?.epochId) {
      try {
        const privateEpoch = await privacy.decryptEpochPrivate(state.lastEpoch.epochId);
        // totalRequestedQuote and matchedQuote are viewer-only, never public Nox decryptions.
        setText("privateRequested", `${formatUnits(privateEpoch.totalRequestedQuote, 18)} quote`);
        setText("internallyMatched", `${formatUnits(privateEpoch.matchedQuote, 18)} quote`);
        setText("publicResidual", formatResidual(state.lastEpoch.residualAmount, state.lastEpoch.residualDirection));
        byId("savingsLock").classList.add("unlocked");
        setText("savingsLock", "Owner revealed");
      } catch (error) {
        setStatus(`Unauthorized epoch metrics remain locked: ${privacy.explain(error)}`, true);
      }
    }
  } catch (error) {
    byId("privateStateGrid").innerHTML = `<p>${privacy.explain(error)}</p>`;
    setStatus(`Unauthorized private reveal rejected: ${privacy.explain(error)}`, true);
  }
}

function bindEvents() {
  for (const link of document.querySelectorAll("[data-page-link]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setPage(link.dataset.pageLink, link.dataset.scrollTarget || null);
    });
  }
  byId("replayHowDemo")?.addEventListener("click", () => startHowDemo(true));
  byId("accountPill").addEventListener("click", async () => {
    if (!chain.account) return openWalletChooser();
    const menu = byId("accountMenu");
    const open = menu.classList.toggle("hidden") === false;
    byId("accountPill").setAttribute("aria-expanded", String(open));
  });
  byId("disconnectWallet").addEventListener("click", () => {
    chain.disconnect();
    privacy.handleClient = null;
    byId("accountMenu").classList.add("hidden");
    renderDisconnected();
  });
  byId("closeWalletModal").addEventListener("click", () => closeModal("walletModal"));
  byId("instantMode").addEventListener("click", () => setMode("instant"));
  byId("dcaMode").addEventListener("click", () => setMode("dca"));
  byId("flipDirection").addEventListener("click", () => {
    state.direction = state.direction === 0 ? 1 : 0;
    renderDirection();
  });
  for (const id of ["budgetInput", "clipInput", "limitInput", "slippageInput"]) {
    byId(id).addEventListener("input", updateEstimate);
  }
  for (const button of document.querySelectorAll("[data-budget-percent]")) {
    button.addEventListener("click", () => setBudgetPercent(button.dataset.budgetPercent));
  }
  byId("primaryStrategyAction").addEventListener("click", () => chain.account ? createStrategyFlow() : openWalletChooser());
  byId("advanceEpoch").addEventListener("click", advanceEpochFlow);
  byId("revealPrivateState").addEventListener("click", revealPrivateState);
  byId("refreshChain").addEventListener("click", async () => {
    try {
      await refreshWalletMetrics();
      setStatus("Live V3 chain state refreshed.");
    } catch (error) {
      setStatus(NoxRouteChain.explainError(error), true);
    }
  });
  byId("retryStrategy").addEventListener("click", () => state.strategyRetry?.());
  byId("retryEpoch").addEventListener("click", () => state.epochRetry?.());
  for (const [button, modal] of [
    ["closeStrategyProgress", "strategyProgressModal"],
    ["closeStrategyReceipt", "strategyReceiptModal"],
    ["closeEpochProgress", "epochProgressModal"],
    ["closeFinalResult", "finalResultModal"],
    ["closeReveal", "revealModal"],
  ]) byId(button).addEventListener("click", () => closeModal(modal));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const id of ["walletModal", "strategyProgressModal", "strategyReceiptModal", "epochProgressModal", "finalResultModal", "revealModal"]) {
      if (!byId(id).classList.contains("hidden")) closeModal(id);
    }
  });
  chain.onWalletEvent = () => window.location.reload();
}

async function initialize() {
  state.deployment = await chain.initialize();
  bindEvents();
  renderChainManifest();
  renderProgress("strategyProgressSteps", STRATEGY_STEPS);
  renderProgress("epochProgressSteps", EPOCH_STEPS);
  restorePageFromHash();
  setMode("instant");
  renderDirection();
  renderSavedWorkspace();
  if (state.lastEpoch?.status === "settled") {
    setText("epochStatus", "Settled");
    setText("publicResidual", formatResidual(state.lastEpoch.residualAmount, state.lastEpoch.residualDirection));
  }
  try {
    const restored = await chain.restoreSession();
    if (restored) await renderConnected(restored);
    else renderDisconnected();
  } catch (error) {
    renderDisconnected();
    setStatus(`Wallet session could not be restored: ${NoxRouteChain.explainError(error)}`, true);
  }
}

initialize().catch((error) => {
  renderDisconnected();
  setStatus(`NoxRoute initialization failed: ${NoxRouteChain.explainError(error)}`, true);
});
