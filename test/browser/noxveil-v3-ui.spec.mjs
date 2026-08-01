import { expect, test } from "@playwright/test";

const EVIDENCE_LABEL = "simulated provider UI test";
const APP_URL = "/?simulated-provider-ui-test=1#trade";
const ACCOUNT = "0x1234567890abcdef1234567890abcdef12345678";
const SECOND_ACCOUNT = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const ACCOUNTS_CHANGED_ACCOUNT = `0x${"22".repeat(20)}`;
const CHAIN_CHANGED_ACCOUNT = `0x${"33".repeat(20)}`;
const WALLET_NAME = "Noxveil Fixture Wallet";
const WALLET_RDNS = "dev.noxveil.fixture";
const SECOND_WALLET_NAME = "Noxveil Second Wallet";
const SECOND_WALLET_RDNS = "dev.noxveil.second";
const SETTLEMENT_TX = `0x${"77".repeat(32)}`;

async function installSimulatedProvider(page, { failOnceAt = null } = {}) {
  await page.addInitScript((fixture) => {
    const details = fixture.wallets.map((wallet, index) => {
      const listeners = new Map();
      const accountStorageKey = `noxveil:fixture:account:${wallet.rdns}`;
      const simulation = {
        evidenceLabel: fixture.evidenceLabel,
        account: wallet.account,
        delayMs: 180,
        failOnceAt: index === 0 ? fixture.failOnceAt : null,
        failedActions: [],
        balances: {
          eth: "20000000000000000",
          weth: "8000000000000000000",
          usdc: "12000000000",
        },
        allowance: "0",
        twapPriceWad: "2500000000000000000000",
        marketPriceWad: "1865561849870000000000",
        strategyId: `0x${"55".repeat(32)}`,
        epochId: `0x${"66".repeat(32)}`,
        hashes: {
          approve: `0x${"11".repeat(32)}`,
          deposit: `0x${"22".repeat(32)}`,
          create: `0x${"33".repeat(32)}`,
          lock: `0x${"44".repeat(32)}`,
          finalize: `0x${"55".repeat(32)}`,
          settle: fixture.settlementTx,
        },
      };
      const provider = {
        __noxrouteSimulatedUi: simulation,
        async request({ method }) {
          if (method === "eth_chainId") return simulation.chainId || "0xaa36a7";
          if (method === "eth_accounts" || method === "eth_requestAccounts") {
            return [localStorage.getItem(accountStorageKey) || simulation.account];
          }
          if (method === "wallet_switchEthereumChain") return null;
          throw new Error(`Unsupported simulated provider UI method: ${method}`);
        },
        on(event, listener) {
          const group = listeners.get(event) || [];
          group.push(listener);
          listeners.set(event, group);
        },
        removeListener(event, listener) {
          listeners.set(event, (listeners.get(event) || []).filter((entry) => entry !== listener));
        },
        __setAccount(account) {
          simulation.account = account;
          localStorage.setItem(accountStorageKey, account);
        },
        __emit(event, value) {
          if (event === "accountsChanged" && value?.[0]) this.__setAccount(value[0]);
          if (event === "chainChanged") simulation.chainId = value;
          for (const listener of listeners.get(event) || []) listener(value);
        },
      };
      return {
        info: {
          uuid: `11111111-2222-4333-8444-55555555555${index}`,
          name: wallet.name,
          rdns: wallet.rdns,
          icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' />",
        },
        provider,
      };
    });
    const announce = () => queueMicrotask(() => {
      for (const detail of details) {
        window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
      }
    });
    window.addEventListener("eip6963:requestProvider", announce);
    Object.defineProperty(window, "ethereum", { configurable: true, value: details[0].provider });
    window.__noxveilSimulatedProvider = details[0].provider;
    window.__noxveilSimulatedProviders = details.map((detail) => detail.provider);
  }, {
    evidenceLabel: EVIDENCE_LABEL,
    wallets: [
      { account: ACCOUNT, name: WALLET_NAME, rdns: WALLET_RDNS },
      { account: SECOND_ACCOUNT, name: SECOND_WALLET_NAME, rdns: SECOND_WALLET_RDNS },
    ],
    settlementTx: SETTLEMENT_TX,
    failOnceAt,
  });
}

async function connectWallet(page, walletName = WALLET_NAME) {
  await page.getByRole("button", { name: /connect wallet/i }).first().click();
  await page.getByRole("button", { name: new RegExp(walletName, "i") }).click();
  await expect(page.locator("#walletStatus")).toContainText(walletName);
  await expect(page.locator("#accountMenu")).toBeHidden();
  await expect(page.locator("#accountPill")).toHaveAttribute("aria-expanded", "false");
}

async function createStrategy(page) {
  await connectWallet(page);
  await page.locator("#primaryStrategyAction").click();
  await expect(page.locator("#strategyReceiptModal")).toBeVisible();
}

test.describe(EVIDENCE_LABEL, () => {
  test.beforeEach(async ({ page }) => {
    await installSimulatedProvider(page);
  });

  test("loads the Sepolia V3 deployment and official WETH/USDC", async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page.locator("#productTitle")).toContainText("Uniswap V3");
    await expect(page.locator("#inputTokenSymbol")).toHaveText("WETH");
    await expect(page.locator("#outputTokenSymbol")).toHaveText("USDC");
    const manifest = await page.evaluate(() => fetch("./v3-deployment.json").then((response) => response.json()));
    expect(manifest.chainId).toBe(11155111);
    expect(manifest.weth).toBe("0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14");
    expect(manifest.usdc).toBe("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");
  });

  test("runtime guard requires local hostname, query flag, and exact evidence label", async ({ page }) => {
    await page.goto(APP_URL);
    const result = await page.evaluate(async ({ evidenceLabel }) => {
      const module = await import(`./v3-chain.js?runtime-guard=${Date.now()}`);
      if (typeof module.localUiSimulation !== "function") {
        return { exported: false, allowed: false, nonLocal: null, missingQuery: null, wrongLabel: null };
      }
      const { localUiSimulation } = module;
      const simulation = { evidenceLabel };
      const provider = { __noxrouteSimulatedUi: simulation };
      const wrongProvider = { __noxrouteSimulatedUi: { evidenceLabel: "wrong label" } };
      const allowedContext = { hostname: "127.0.0.1", search: "?simulated-provider-ui-test=1" };
      return {
        exported: true,
        allowed: localUiSimulation(provider, allowedContext) === simulation,
        nonLocal: localUiSimulation(provider, { ...allowedContext, hostname: "noxveil.example" }),
        missingQuery: localUiSimulation(provider, { ...allowedContext, search: "" }),
        wrongLabel: localUiSimulation(wrongProvider, allowedContext),
      };
    }, { evidenceLabel: EVIDENCE_LABEL });
    expect(result.exported).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.nonLocal).toBeNull();
    expect(result.missingQuery).toBeNull();
    expect(result.wrongLabel).toBeNull();
  });

  test("restores the previously authorized EIP-6963 wallet label after refresh", async ({ page }) => {
    await page.goto(APP_URL);
    await connectWallet(page);
    await page.reload();
    await expect(page.locator("#walletStatus")).toContainText(WALLET_NAME);
    await expect(page.locator("#accountFull")).toHaveText(ACCOUNT);
  });

  test("disconnect and reconnect bind account and chain events from the new provider", async ({ page }) => {
    await page.goto(APP_URL);
    await connectWallet(page);
    await page.locator("#accountPill").click();
    await page.locator("#disconnectWallet").click();
    await connectWallet(page, SECOND_WALLET_NAME);
    await expect(page.locator("#accountFull")).toHaveText(SECOND_ACCOUNT);

    await page.evaluate((account) => {
      window.__noxveilSimulatedProviders[1].__emit("accountsChanged", [account]);
    }, ACCOUNTS_CHANGED_ACCOUNT);
    await expect(page.locator("#accountFull")).toHaveText(ACCOUNTS_CHANGED_ACCOUNT);

    await page.evaluate((account) => {
      const provider = window.__noxveilSimulatedProviders[1];
      provider.__setAccount(account);
      provider.__emit("chainChanged", "0xaa36a7");
    }, CHAIN_CHANGED_ACCOUNT);
    await expect(page.locator("#accountFull")).toHaveText(CHAIN_CHANGED_ACCOUNT);
  });

  test("percentage presets update the visible amount from the connected balance", async ({ page }) => {
    await page.goto(APP_URL);
    await connectWallet(page);
    await page.getByRole("button", { name: "25%" }).click();
    await expect(page.locator("#budgetInput")).toHaveValue("2");
    await page.getByRole("button", { name: "50%" }).click();
    await expect(page.locator("#budgetInput")).toHaveValue("4");
    await page.getByRole("button", { name: "Max" }).click();
    await expect(page.locator("#budgetInput")).toHaveValue("8");
  });

  test("quote preview uses the Chainlink market rate instead of the Sepolia test-pool TWAP", async ({ page }) => {
    await page.goto(APP_URL);
    await connectWallet(page);
    await page.locator("#budgetInput").fill("1");
    await expect(page.locator("#estimatedOutput")).toHaveText("1865.561849");
    await expect(page.locator("#twapPrice")).toContainText("1865.56184987 USDC / WETH");
    await expect(page.locator("#twapPrice")).toContainText("Chainlink ETH/USD");
    await expect(page.locator("#twapPrice")).not.toContainText("2500");
  });

  test("Instant is one clip while Stealth DCA exposes all private controls", async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page.locator("#executionMode")).toHaveText("One encrypted clip");
    await expect(page.locator("#privateControls")).toBeHidden();
    await page.getByRole("tab", { name: "Stealth DCA" }).click();
    await expect(page.getByLabel("Private budget")).toBeVisible();
    await expect(page.getByLabel("Clip per epoch")).toBeVisible();
    await expect(page.getByLabel("Private limit")).toBeVisible();
    await expect(page.getByLabel("Private slippage")).toBeVisible();
  });

  test("progress highlights exactly one active step and strategy receipt does not claim a completed swap", async ({ page }) => {
    await page.goto(APP_URL);
    await connectWallet(page);
    await page.locator("#primaryStrategyAction").click();
    const progress = page.locator("#strategyProgressModal");
    await expect(progress).toBeVisible();
    await expect(progress.locator(".progress-step.current")).toHaveCount(1);
    await expect(page.locator("#strategyReceiptModal")).toBeVisible();
    await expect(page.locator("#strategyReceiptEvidence")).toHaveText(EVIDENCE_LABEL);
    await expect(page.locator("#strategyReceiptBody")).toContainText("No Nox encryption or Sepolia transaction was performed");
    await expect(page.locator("#strategyReceiptModal")).not.toContainText(/swap (?:was )?completed|swap complete/i);
    await expect(page.locator("#strategyTxLink")).toHaveAttribute("href", `https://sepolia.etherscan.io/tx/0x${"33".repeat(32)}`);
  });

  test("failure keeps the failed step visible with Retry and retry resumes safely", async ({ page }) => {
    await page.close();
    const retryPage = await page.context().newPage();
    await installSimulatedProvider(retryPage, { failOnceAt: "deposit" });
    await retryPage.goto(APP_URL);
    await connectWallet(retryPage);
    await retryPage.locator("#primaryStrategyAction").click();
    const failed = retryPage.locator('#strategyProgressSteps [data-step="deposit"]');
    await expect(failed).toHaveClass(/failed/);
    await expect(failed).toBeVisible();
    await expect(retryPage.locator("#retryStrategy")).toBeVisible();
    await retryPage.locator("#retryStrategy").click();
    await expect(retryPage.locator("#strategyReceiptModal")).toBeVisible();
  });

  test("settled receipt links the exact settlement transaction returned for official Uniswap routing", async ({ page }) => {
    await page.goto(APP_URL);
    await createStrategy(page);
    await page.locator("#closeStrategyReceipt").click();
    await page.locator("#advanceEpoch").click();
    await expect(page.locator("#finalResultModal")).toBeVisible();
    await expect(page.locator("#finalResultEvidence")).toHaveText(EVIDENCE_LABEL);
    await expect(page.locator("#finalResultBody")).toContainText("No Sepolia transaction was performed");
    await expect(page.locator("#finalResultBody")).toContainText("official Uniswap V3");
    await expect(page.locator("#settlementTxLink")).toHaveAttribute("href", `https://sepolia.etherscan.io/tx/${SETTLEMENT_TX}`);
  });

  test("disconnect clears persisted authorization and private revealed values", async ({ page }) => {
    await page.goto(APP_URL);
    await createStrategy(page);
    await page.locator("#closeStrategyReceipt").click();
    await page.locator("#revealPrivateState").click();
    await expect(page.locator("#privateStateGrid")).toContainText("Budget remaining");
    await expect(page.locator("#confidentialVaultBalance")).toContainText(/WETH.*USDC/);
    await page.locator("#closeReveal").click();
    await page.locator("#accountPill").click();
    await page.locator("#disconnectWallet").click();
    await expect(page.locator("#walletStatus")).toHaveText("Connect wallet");
    expect(await page.evaluate(() => localStorage.getItem("noxroute:v3:wallet-rdns"))).toBeNull();
    await expect(page.locator("#privateStateGrid")).toHaveText(/Authorize this wallet/i);
    await expect(page.locator("#confidentialVaultBalance")).not.toContainText(/\d/);
    await expect(page.locator("#privateRequested")).not.toContainText(/\d/);
    await expect(page.locator("#internallyMatched")).not.toContainText(/\d/);
  });
});
