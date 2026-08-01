import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("V3 dApp is a private strategy product, not the BOIN demo", () => {
  const html = read("dapp/index.html");
  for (const required of [
    "Instant",
    "Stealth DCA",
    "Private budget",
    "Clip per epoch",
    "Private limit",
    "Private slippage",
    "Reveal private state",
    "Advance epoch",
  ]) assert.match(html, new RegExp(required, "i"), `missing ${required}`);
  assert.match(html, /WETH/);
  assert.match(html, /USDC/);
  assert.doesNotMatch(html, /BOIN|BOOUT|VeilSwap/i);
  assert.doesNotMatch(html, /Mint Token In|Fill demo batch|demo participant/i);
});

test("public branding uses NoxRoute and the animated home page is the default surface", () => {
  const html = read("dapp/index.html");
  const app = read("dapp/app.js");
  const css = read("dapp/styles.css");
  assert.match(html, /<title>NoxRoute - Private Strategy Router on Uniswap<\/title>/);
  assert.match(html, /aria-label="NoxRoute home"/);
  assert.match(html, />NoxRoute<\/span>/);
  assert.match(html, /id="homePage"[^>]*data-page="home"/);
  assert.match(html, /id="homePage"[^>]*class="home-page page-view"/);
  assert.match(html, /Private swap routes/i);
  assert.match(html, /without public strategy leaks/i);
  assert.match(html, /Open private route/i);
  assert.match(html, /Watch the flow/i);
  assert.match(html, /Browser encryption/i);
  assert.match(html, /TEE compute/i);
  assert.match(html, /Selective reveal/i);
  assert.match(html, /Public composability/i);
  assert.match(html, /Honest privacy boundary/i);
  assert.match(app, /setPage\(page/);
  assert.match(app, /setPage\("home"\)/);
  assert.match(css, /\.home-hero/);
  assert.match(css, /@keyframes card-float/);
  assert.match(css, /@keyframes orbit-dot/);
  assert.match(css, /@keyframes route-scan/);
  assert.match(html, /noxroute-logo\.png/);
  assert.doesNotMatch(html, /Noxveil|noxveil-logo|VeilSwap|veilswap-logo|BOIN|BOOUT|boin-token|boout-token/i);
});

test("V3 dApp explains the public deposit boundary before approval", () => {
  const html = read("dapp/index.html");
  assert.match(html, /ERC-20 deposit amounts are public/i);
  assert.match(html, /strategy (?:budget|rules|parameters).*encrypted/i);
  assert.match(html, /id="depositDisclosure"/);
  assert.match(html, /id="primaryStrategyAction"/);
});

test("chain, privacy, and presentation logic are separated", () => {
  assert.equal(existsSync(new URL("dapp/v3-chain.js", root)), true);
  assert.equal(existsSync(new URL("dapp/v3-privacy.js", root)), true);
  const html = read("dapp/index.html");
  const app = read("dapp/app.js");
  const chain = read("dapp/v3-chain.js");
  const privacy = read("dapp/v3-privacy.js");
  assert.match(html, /v3-chain\.js/);
  assert.match(html, /v3-privacy\.js/);
  assert.match(app, /NoxRouteChain/);
  assert.match(app, /NoxRoutePrivacy/);
  assert.doesNotMatch(app + chain + privacy, /Noxveil|noxveil|VeilSwap|BOIN|BOOUT/i);
  assert.match(chain, /v3-deployment\.json/);
  assert.match(chain, /wallet_switchEthereumChain/);
  assert.match(chain, /wallet_watchAsset/);
  assert.match(privacy, /createEthersHandleClient|createHandleClient/);
  assert.match(privacy, /encryptStrategy/);
  assert.match(privacy, /decryptOwnerState/);
});

test("wallet transactions estimate gas with a bounded buffer", () => {
  const chain = read("dapp/v3-chain.js");
  assert.match(chain, /estimateGas/);
  assert.match(chain, /GAS_LIMIT_CAP/);
  assert.match(chain, /GAS_BUFFER_NUMERATOR/);
  assert.doesNotMatch(chain, /gasLimit:\s*(?:4_000_000|12_000_000|16_000_000)/);
});

test("quote preview uses the official Chainlink Sepolia ETH/USD rate, not the test pool TWAP", () => {
  const deployment = JSON.parse(read("dapp/v3-deployment.json"));
  const app = read("dapp/app.js");
  const chain = read("dapp/v3-chain.js");
  assert.equal(deployment.chainlinkEthUsdFeed, "0x694AA1769357215DE4FAC081bf1f309aDC325306");
  assert.match(chain, /CHAINLINK_ETH_USD_ABI/);
  assert.match(chain, /latestRoundData/);
  assert.match(chain, /marketPriceWad/);
  assert.match(chain, /Chainlink ETH\/USD/i);
  assert.match(app, /quotePriceWad/);
  assert.doesNotMatch(app, /values\.budget \* price \/ 10n \*\* 30n/);
  assert.match(app, /10n \*\* 6n/);
});

test("one-click orchestration is honest about asynchronous epochs", () => {
  const html = read("dapp/index.html");
  const app = read("dapp/app.js");
  for (const id of [
    "strategyProgressModal",
    "strategyProgressSteps",
    "strategyReceiptModal",
    "epochProgressModal",
    "finalResultModal",
  ]) assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
  for (const step of ["Connect", "Approve", "Deposit", "Nox encrypt", "Create strategy"]) {
    assert.match(app, new RegExp(step, "i"), `missing strategy step ${step}`);
  }
  for (const step of ["Lock epoch", "Wait for Nox proof", "Finalize aggregate", "Settle Uniswap residual"]) {
    assert.match(app, new RegExp(step, "i"), `missing epoch step ${step}`);
  }
  assert.match(app, /elapsed/i);
  assert.match(app, /retry/i);
  assert.doesNotMatch(app, /fake success|pretend|simulation complete/i);
});

test("privacy savings, chain view, and privacy receipt preserve disclosure roles", () => {
  const html = read("dapp/index.html");
  const app = read("dapp/app.js");
  for (const required of [
    "Privacy savings",
    "Private requested",
    "Internally matched",
    "Public residual",
    "Chain view",
    "Privacy receipt",
    "Publicly disclosed",
    "Kept private",
    "NoxCompute",
    "SwapRouter02",
  ]) assert.match(html, new RegExp(required, "i"), `missing ${required}`);
  assert.match(app, /totalRequestedQuote/);
  assert.match(app, /matchedQuote/);
  assert.match(app, /residualAmount/);
  assert.match(app, /unauthori[sz]ed/i);
});

test("contract evidence is isolated behind the Contracts page tab", () => {
  const html = read("dapp/index.html");
  const app = read("dapp/app.js");
  assert.match(html, /id="tradePage"[^>]*data-page="trade"/);
  assert.match(html, /id="contractsPanel"[^>]*data-page="contracts"/);
  assert.match(html, /id="contractsPanel"[^>]*class="[^"]*hidden/);
  assert.match(html, /data-page-link="contracts"/);
  assert.match(app, /function setPage/);
  assert.match(app, /restorePageFromHash/);
});

test("how it works is an animated standalone product walkthrough page", () => {
  const html = read("dapp/index.html");
  const app = read("dapp/app.js");
  const css = read("dapp/styles.css");
  assert.match(html, /data-page-link="how"/);
  assert.match(html, /id="howPage"[^>]*data-page="how"/);
  assert.match(html, /id="howPage"[^>]*class="[^"]*hidden/);
  assert.doesNotMatch(html, /Animated protocol walkthrough/i);
  assert.match(html, /Nox encrypts/i);
  assert.match(html, /intent/i);
  assert.match(html, /private matching/i);
  assert.match(html, /aggregate settlement/i);
  for (const step of [
    "Wallet deposit",
    "Nox encryption",
    "Private vault",
    "Batch matching",
    "Uniswap V3",
    "USDC credit",
  ]) assert.match(html, new RegExp(step, "i"), `missing walkthrough step ${step}`);
  assert.match(app, /startHowDemo/);
  assert.match(app, /setHowStep/);
  assert.match(css, /\.how-node\.active/);
  assert.match(html, /class="how-flow-strip"/);
  assert.match(html, /class="how-flow-step active" data-how-flow-step="0"/);
  assert.match(css, /\.how-flow-step\.active/);
  assert.match(css, /\.how-flow-step\.active::after/);
  assert.doesNotMatch(html, /how-flow-packet/);
  assert.doesNotMatch(html, /class="how-connector/);
  assert.doesNotMatch(html, /class="how-track"/);
  assert.match(css, /\.how-inspector\s*{[^}]*height:\s*100%[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
  assert.match(css, /#replayHowDemo\s*{[^}]*margin-top:\s*auto/s);
  assert.match(html, /class="how-copy"/);
  assert.match(css, /\.how-hero\s*{[^}]*max-width:\s*1128px/s);
  assert.match(css, /\.how-hero h1\s*{[^}]*max-width:\s*1128px[^}]*white-space:\s*nowrap/s);
  assert.match(css, /\.how-copy\s*{[^}]*max-width:\s*1128px/s);
  assert.doesNotMatch(css, /\.how-copy\s*{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /\.how-copy p\s*{[^}]*text-align:\s*justify[^}]*text-align-last:\s*left/s);
  assert.match(css, /@keyframes how-packet/);
});

test("motion and accessibility states are explicit", () => {
  const html = read("dapp/index.html");
  const css = read("dapp/styles.css");
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(css, /\.progress-step\.current/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /min-height:\s*44px/);
  assert.doesNotMatch(css, /transition:\s*(?:all|width|height)/);
});

test("dApp copy does not leak mojibake glyphs into the UI", () => {
  const files = ["dapp/index.html", "dapp/app.js", "dapp/v3-chain.js", "dapp/styles.css"];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /â|Â|Ã|�/, `${file} contains mojibake`);
  }
});
