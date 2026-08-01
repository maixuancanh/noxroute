import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const dappDir = path.resolve("dapp");
const projectDir = path.resolve(".");

test("NoxBatch dApp exposes a real private swap product flow", () => {
  const html = fs.readFileSync(path.join(dappDir, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(dappDir, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(dappDir, "styles.css"), "utf8");

  for (const id of [
    "swapForm",
    "fromTokenSymbol",
    "toTokenSymbol",
    "swapAmount",
    "quotePreview",
    "privacyFlow",
    "approveToken",
    "submitIntent",
    "settleBatch",
    "batchState",
    "userHistory",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }

  assert.match(app, /eth_requestAccounts/, "wallet connection must request accounts");
  assert.match(app, /eth_call/, "dApp must read live chain state");
  assert.match(app, /eth_sendTransaction/, "dApp must prepare real wallet transactions");
  assert.match(app, /allowance|approveToken/, "dApp must model ERC20 approval flow");
  assert.match(app, /submitIntent|settleBatch/, "dApp must model private intent and batch settlement actions");
  assert.match(css, /\.swap-card/, "swap UI needs product styling");
});

test("NoxBatch uses a swap-app shell instead of a hackathon dashboard layout", () => {
  const html = fs.readFileSync(path.join(dappDir, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(dappDir, "styles.css"), "utf8");

  for (const id of [
    "appShell",
    "topNav",
    "accountPill",
    "swapPanel",
    "routeDetails",
    "primarySwapAction",
    "detailsDrawer",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }

  assert.doesNotMatch(html, /class="hero/, "swap app should not open with a landing-page hero");
  assert.doesNotMatch(html, /class="nav-tabs"/, "single-screen swap app should not show unused Pool/Privacy tabs");
  assert.doesNotMatch(html, /id="connectWallet"/, "only one wallet connect control should be visible");
  assert.match(css, /max-width:\s*480px/, "main swap panel should be centered and compact");
});

test("wallet status helpers tolerate removed optional UI nodes", () => {
  const app = fs.readFileSync(path.join(dappDir, "app.js"), "utf8");

  assert.match(app, /const el = byId\(id\);\n\s+if \(el\) el\.textContent = value;/, "text helper must guard missing elements");
  assert.match(app, /const el = byId\(id\);\n\s+if \(el\) el\.className = "dot " \+ state;/, "setDot helper must guard missing dots");
  assert.doesNotMatch(app, /byId\("connectWallet"\)\.addEventListener/, "removed connect button must not be wired");
});

test("NoxBatch dApp exposes test-token onboarding controls", () => {
  const html = fs.readFileSync(path.join(dappDir, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(dappDir, "app.js"), "utf8");

  for (const id of ["mintTokenIn", "addTokenIn", "addTokenOut"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }

  assert.match(app, /mint:\s*"0x40c10f19"/, "must encode mint(address,uint256)");
  assert.match(app, /wallet_watchAsset/, "must support adding test tokens to wallet");
});

test("mint flow waits for mining and refreshes balances", () => {
  const app = fs.readFileSync(path.join(dappDir, "app.js"), "utf8");

  assert.match(app, /eth_getTransactionReceipt/, "mint flow must poll for a transaction receipt");
  assert.match(app, /waitForReceipt/, "mint flow must use a receipt wait helper");
  assert.match(app, /await refreshBalances\(\)/, "mint flow must refresh balances after mining");
});

test("token metadata keeps symbol when decimals is missing", () => {
  const app = fs.readFileSync(path.join(dappDir, "app.js"), "utf8");

  assert.match(app, /readTokenSymbol/, "symbol reads must be isolated from decimals fallback");
  assert.match(app, /readTokenDecimals/, "decimals reads must have their own fallback");
  assert.match(app, /return 18;/, "missing decimals should fallback to 18 without losing symbol");
});

test("wallet account pill restores session and supports disconnect menu", () => {
  const app = fs.readFileSync(path.join(dappDir, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(dappDir, "styles.css"), "utf8");

  assert.match(app, /eth_accounts/, "app must restore authorized wallet after refresh");
  assert.match(app, /waitForWalletProvider/, "restore must wait for delayed wallet injection");
  assert.match(app, /localStorage\.setItem\("noxBatchWalletConnected"/, "connect must persist a reconnect hint");
  assert.match(app, /accountsChanged/, "app must react to wallet account changes");
  assert.match(app, /openAccountMenu/, "connected account pill must open account menu");
  assert.match(app, /disconnectWallet/, "account menu must provide disconnect");
  assert.match(app, /short\(account\)/, "account pill must show shortened address");
  assert.match(css, /\.account-menu/, "disconnect popup must be styled");
});

test("frontend encrypts intents with real Nox handle SDK", () => {
  const app = fs.readFileSync(path.join(dappDir, "app.js"), "utf8");
  const bundle = fs.existsSync(path.join(dappDir, "nox-browser.js"))
    ? fs.readFileSync(path.join(dappDir, "nox-browser.js"), "utf8")
    : "";

  assert.doesNotMatch(app, /randomBytes32|Demo handles|generated locally/, "frontend must not use fake demo handles");
  assert.match(app, /encryptNoxIntent/, "app must call the Nox encryption bridge");
  assert.match(app, /submitIntentWithProof:\s*"0x9e2aad13"/, "app must submit the proof overload");
  assert.match(bundle, /createEthersHandleClient|encryptInput/, "bundle must contain real Nox handle SDK encryption");
});

test("Nox encryption result is visible and copyable", () => {
  const html = fs.readFileSync(path.join(dappDir, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(dappDir, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(dappDir, "styles.css"), "utf8");

  for (const id of ["noxResult", "amountHandlePreview", "minOutHandlePreview", "amountProofPreview", "minOutProofPreview", "copyNoxResult"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(app, /renderNoxResult/, "app must render handles and proof metadata");
  assert.match(app, /copyNoxResult/, "app must wire copy button");
  assert.match(css, /\.nox-result/, "result panel must be styled");
});

test("demo filler can add the two remaining V2 participants without embedded secrets", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
  const script = fs.existsSync(path.join(projectDir, "scripts", "fill-v2-demo-batch.mjs"))
    ? fs.readFileSync(path.join(projectDir, "scripts", "fill-v2-demo-batch.mjs"), "utf8")
    : "";
  const html = fs.readFileSync(path.join(dappDir, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(dappDir, "app.js"), "utf8");

  assert.equal(pkg.scripts["demo:fill-v2"], "node scripts/fill-v2-demo-batch.mjs");
  assert.match(script, /createEthersHandleClient/, "helper must encrypt through the real Nox handle SDK");
  assert.match(script, /Wallet\.createRandom\(\)/, "helper should create two throwaway demo users");
  assert.match(script, /submitIntent\(bytes32,bytes32,bytes,bytes32,bytes,uint128\)/, "helper must submit the proof overload");
  assert.match(script, /DEPLOYER_PRIVATE_KEY/, "helper must receive the funded sponsor key from env");
  assert.doesNotMatch(script, /0x[a-fA-F0-9]{64}/, "helper must not embed a private key");
  assert.match(html, /id="fillDemoBatch"/, "dApp should show the demo helper action");
  assert.match(app, /demo:fill-v2/, "dApp should tell users the exact command for filling the demo batch");
});

test("wallet transactions cap gas below Infura Sepolia sendRawTransaction limit", () => {
  const app = fs.readFileSync(path.join(dappDir, "app.js"), "utf8");

  assert.match(app, /const safeGasLimit = "0xf00000"/, "sendTx should use a gas cap below Infura's 0x1000000 limit");
  assert.match(app, /gas:\s*safeGasLimit/, "wallet transactions must include the safe gas cap");
  assert.doesNotMatch(app, /0x1406f40|21000000/, "dApp must not request a 21M gas transaction");
});

test("submit intent preflights and decodes contract revert reasons", () => {
  const app = fs.readFileSync(path.join(dappDir, "app.js"), "utf8");

  assert.match(app, /function decodeRevertError/, "app should decode custom error selectors");
  assert.match(app, /TokenTransferFailed/, "app should name likely token balance or allowance failures");
  assert.match(app, /IntentAlreadySubmitted/, "app should name duplicate participant failures");
  assert.match(app, /async function preflightTx/, "app should simulate writes before sending them");
  assert.match(app, /await preflightTx\(batchRouter, calldata\)/, "submit intent must preflight the exact calldata");
  assert.match(app, /Submit preflight failed:/, "submit failures should tell the user before wallet signing");
});

test("demo finalizer can deliver Nox netting proofs for a pending V2 epoch", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
  const script = fs.existsSync(path.join(projectDir, "scripts", "finalize-v2-demo-batch.mjs"))
    ? fs.readFileSync(path.join(projectDir, "scripts", "finalize-v2-demo-batch.mjs"), "utf8")
    : "";

  assert.equal(pkg.scripts["demo:finalize-v2"], "node scripts/finalize-v2-demo-batch.mjs");
  assert.match(script, /resultHandlesOf/, "finalizer should read evaluator result handles");
  assert.match(script, /publicDecryptWithRetry/, "finalizer should wait for public decrypt proofs");
  assert.match(script, /deliverNetting/, "finalizer should deliver proofs back to the evaluator");
  assert.match(script, /DEPLOYER_PRIVATE_KEY/, "finalizer must receive the funded keeper key from env");
  assert.doesNotMatch(script, /0x[a-fA-F0-9]{64}/, "finalizer must not embed a private key");
});

test("one-click swap shows guided progress and final result modals", () => {
  const html = fs.readFileSync(path.join(dappDir, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(dappDir, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(dappDir, "styles.css"), "utf8");

  assert.match(html, /id="primarySwapAction"[^>]*>Swap</, "primary action should be a single Swap button");
  for (const id of ["swapProgressModal", "swapProgressSteps", "swapResultModal", "swapResultTitle", "swapResultBody", "swapResultLink"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(app, /async function runOneClickSwap/, "app should orchestrate the full swap flow");
  for (const fn of ["setProgressStep", "openProgressModal", "openResultModal", "callDemoApi"]) {
    assert.match(app, new RegExp(`function ${fn}|async function ${fn}`), `missing ${fn}`);
  }
  for (const endpoint of ["/api/fill-demo-batch", "/api/finalize-demo-batch"]) {
    assert.match(app, new RegExp(endpoint), `app should call ${endpoint}`);
  }
  assert.match(app, /Confirm in MetaMask/, "progress modal should indicate wallet confirmations");
  assert.match(app, /await sendTx\(tokenIn, encodeCall\(selectors\.approve/, "autopilot should approve when needed");
  assert.match(app, /await encryptNoxIntent\(\)/, "autopilot should encrypt with Nox");
  assert.match(app, /await preflightTx\(batchRouter, calldata\)/, "autopilot should preflight submit");
  assert.match(app, /await sendTx\(batchRouter, calldata\)/, "autopilot should submit intent");
  assert.match(app, /await sendTx\(batchRouter, encodeCall\(selectors\.requestNetting/, "autopilot should request netting");
  assert.match(app, /await sendTx\(batchRouter, encodeCall\(selectors\.settle/, "autopilot should settle");
  assert.match(css, /\.progress-modal/, "progress modal should be styled");
  assert.match(css, /\.step-status\.done/, "completed steps should show green state");
  assert.match(css, /@keyframes spin/, "current or waiting steps should have a spinner");
});

test("receive token panel displays Token Out wallet balance", () => {
  const html = fs.readFileSync(path.join(dappDir, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(dappDir, "app.js"), "utf8");

  assert.match(html, /id="tokenOutBalance"/, "receive panel should expose a Token Out balance slot");
  assert.match(app, /ethCall\(tokenOut, encodeCall\(selectors\.balanceOf/, "refreshBalances should read Token Out balance");
  assert.match(app, /text\("tokenOutBalance"/, "refreshBalances should render Token Out balance");
  assert.match(app, /tokenOutBalance: decodeUint/, "refreshBalances should return Token Out balance for result flows");
});

test("Orbiter-inspired redesign adds branded motion without breaking dApp structure", () => {
  const html = fs.readFileSync(path.join(dappDir, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(dappDir, "styles.css"), "utf8");

  for (const id of ["ambientField", "routeBeam", "privacySignal"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(css, /--orbiter-coral:\s*#FF5C5C/i, "redesign should use the supplied Orbiter coral token");
  assert.match(css, /Clash-Grotesk-Regular|Clash Grotesk/, "redesign should use the supplied Orbiter type direction");
  assert.match(css, /@keyframes orbitFloat/, "background ambient objects should animate");
  assert.match(css, /@keyframes routePulse/, "route beam should animate");
  assert.match(css, /@keyframes buttonSheen/, "primary swap button should have a premium motion layer");
  assert.match(css, /prefers-reduced-motion:\s*reduce/, "motion redesign must respect reduced motion");
  assert.match(css, /\.token-box:hover/, "token panels should have tactile hover states");
  assert.match(css, /\.progress-modal:not\(\.hidden\) \.progress-panel/, "progress modal should animate in");
});

test("Orbiter trade reference layout is the primary screen", () => {
  const html = fs.readFileSync(path.join(dappDir, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(dappDir, "styles.css"), "utf8");

  for (const label of ["Trade", "Market", "Quests", "More", "Sell", "Buy"]) {
    assert.match(html, new RegExp(`>${label}<`), `missing Orbiter-style label ${label}`);
  }
  assert.match(html, /class="app-grid-button"/, "header should include Orbiter-style app grid button");
  assert.match(css, /--space-black:\s*#020303/i, "layout should use a near-black Orbiter space background");
  assert.match(css, /radial-gradient\(circle at 10% 90%/i, "layout should include lower-left space glow like Orbiter");
  assert.match(css, /\.swap-panel\s*{[^}]*max-width:\s*488px/s, "trade card should match Orbiter compact width");
  assert.match(css, /\.swap-screen\s*{[^}]*grid-template-columns:\s*1fr/s, "primary screen should not render as a dashboard grid");
  assert.match(css, /\.side-panel\s*{[^}]*display:\s*none/s, "technical side panels should not compete with the Orbiter trade card");
});

test("Orbiter space background matches the supplied reference image", () => {
  const html = fs.readFileSync(path.join(dappDir, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(dappDir, "styles.css"), "utf8");

  for (const id of ["spaceNebula", "spaceDustLeft", "spaceDustRight", "spaceMascot"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing background layer #${id}`);
  }
  assert.match(css, /\.space-nebula/, "background should have a dedicated nebula layer");
  assert.match(css, /\.space-nebula\s*{[^}]*z-index:\s*0/s, "nebula must sit above the black body background");
  assert.match(css, /\.app-shell\s*{[^}]*z-index:\s*1/s, "app shell must sit above the visible nebula");
  assert.match(css, /radial-gradient\(ellipse at 7% 84%/i, "left bottom red dust cloud should match Orbiter reference");
  assert.match(css, /radial-gradient\(ellipse at 86% 58%/i, "right teal haze should match Orbiter reference");
  assert.match(css, /\.space-dust-left::before/, "left dust should include dense red particle speckles");
  assert.match(css, /\.space-mascot/, "bottom-left mascot should be represented in CSS");
  assert.match(css, /animation:\s*mascotBob/, "mascot should have subtle compositor-only motion");
});

test("local demo server exposes autopilot helper endpoints", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
  const server = fs.existsSync(path.join(projectDir, "scripts", "demo-server.mjs"))
    ? fs.readFileSync(path.join(projectDir, "scripts", "demo-server.mjs"), "utf8")
    : "";

  assert.equal(pkg.scripts["dapp:demo"], "node scripts/demo-server.mjs");
  assert.match(server, /\/api\/fill-demo-batch/, "server should expose fill endpoint");
  assert.match(server, /\/api\/finalize-demo-batch/, "server should expose finalize endpoint");
  assert.match(server, /runScript/, "server should run existing helper scripts");
  assert.match(server, /DEPLOYER_PRIVATE_KEY/, "server should inject keeper private key from env or local recovery");
  assert.match(server, /recoverV1PrivateKey/, "server should recover the prior throwaway key for local demo continuity");
  assert.doesNotMatch(server, /0x[a-fA-F0-9]{64}/, "server must not embed a private key");
});

test("autopilot helper calls cannot leave progress modal spinning forever", () => {
  const html = fs.readFileSync(path.join(dappDir, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(dappDir, "app.js"), "utf8");

  assert.match(app, /AbortController/, "demo API calls should be abortable");
  assert.match(app, /Local demo helper timed out/, "timeout should explain the stalled helper to the user");
  assert.match(app, /Fill helper timed out, but batch is now full\./, "stale fill helper should recover when chain state is already full");
  assert.match(app, /setProgressStep\("fill", "done", "Batch has 3 private intents\."\)/, "filled batch should always advance progress");
  assert.match(html, /id="closeProgressModal"/, "progress modal should have a safe close button for stale browser requests");
  assert.match(app, /on\("closeProgressModal", "click", closeProgressModal\)/, "close button should dismiss stale progress modal");
  assert.match(html, /app\.js\?v=/, "frontend script should be cache-busted after flow fixes");
});

test("current progress step highlights the whole row with a bright border", () => {
  const app = fs.readFileSync(path.join(dappDir, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(dappDir, "styles.css"), "utf8");

  assert.match(app, /row\.classList\.remove\("waiting", "current", "done", "failed"\)/, "progress row should clear prior state classes");
  assert.match(app, /row\.classList\.add\(state\)/, "progress row should receive the active state");
  assert.match(css, /\.progress-step\.current\s*{[^}]*border-color:\s*rgba\(255,\s*92,\s*92,\s*0\.88\)/s, "current row should have a bright coral border");
  assert.match(css, /\.progress-step\.current\s*{[^}]*box-shadow:/s, "current row should glow enough to see where the flow is");
  assert.match(css, /\.progress-step\.done\s*{[^}]*border-color:/s, "completed rows should still have a softer success border");
});

test("Orbiter trade card removes placeholder controls and uses supplied design tokens", () => {
  const html = fs.readFileSync(path.join(dappDir, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(dappDir, "styles.css"), "utf8");

  assert.doesNotMatch(html, /class="swap-heading"/, "trade pill above the card should be removed");
  assert.doesNotMatch(html, /id="copyEvidence"/, "floating two-square placeholder controls should be removed");
  assert.match(css, /--font-primary:\s*"Clash-Grotesk-Regular"/, "typography should use supplied primary font token");
  assert.match(css, /--text-xs:\s*11px/, "typography should include supplied 11px size token");
  assert.match(css, /--text-sm:\s*14px/, "typography should include supplied 14px size token");
  assert.match(css, /--text-base:\s*15px/, "typography should include supplied 15px size token");
  assert.match(css, /--text-lg:\s*18px/, "typography should include supplied 18px size token");
  assert.match(css, /--space-2:\s*4px/, "spacing should include supplied 4px base token");
  assert.match(css, /--duration-fast:\s*0\.15s/, "motion should use supplied fast duration token");
  assert.match(css, /--duration-base:\s*0\.3s/, "motion should use supplied base duration token");
});

test("Orbiter font faces load the real Clash Grotesk assets", () => {
  const html = fs.readFileSync(path.join(dappDir, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(dappDir, "styles.css"), "utf8");

  for (const face of ["Regular", "Medium", "SemiBold", "Bold"]) {
    assert.match(css, new RegExp(`font-family:Clash-Grotesk-${face}`), `missing ${face} font face`);
    assert.match(css, new RegExp(`https://cdn\\.orbiter\\.finance/fonts/Clash-Grotesk-${face}\\.otf`), `missing Orbiter CDN font asset for ${face}`);
  }
  assert.match(css, /font-synthesis:\s*none/, "browser should not synthesize fake weights");
  assert.match(css, /\.nav-link\s*{[^}]*font-family:\s*var\(--font-semibold\)/s, "nav should use Orbiter semibold face");
  assert.match(css, /\.brand\s*{[^}]*font-family:\s*var\(--font-semibold\)/s, "brand should use Orbiter semibold face");
  assert.match(html, /styles\.css\?v=raster-brand-1/, "stylesheet should keep cache-busting after font and token picker fixes");
});

test("amount presets work and token pills remove chain/caret clutter", () => {
  const html = fs.readFileSync(path.join(dappDir, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(dappDir, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(dappDir, "styles.css"), "utf8");

  assert.match(app, /querySelectorAll\("\[data-percent\]"\)/, "percentage buttons should be wired");
  assert.match(app, /dataset\.percent/, "percentage handler should read the selected percent");
  assert.match(app, /latestTokenInBalance/, "percentage handler should use live BOIN balance");
  assert.match(app, /byId\("swapAmount"\)\.value = formatUnits\(presetAmount, tokenInInfo\.decimals, 6\)/, "percentage handler should update the swap amount input");
  assert.doesNotMatch(html, />Sepolia</, "token pills should not show Sepolia subtitle");
  assert.doesNotMatch(css, /\.token-picker::after/, "custom token picker caret should be removed");
  assert.match(css, /appearance:\s*none/, "native select arrow should be hidden");
  assert.match(html, /styles\.css\?v=raster-brand-1/, "stylesheet should be cache-busted for token picker cleanup");
  assert.match(html, /app\.js\?v=raster-brand-1/, "script should be cache-busted for preset handler");
});

test("token picker is static, aligned, and branded with generated icons", () => {
  const html = fs.readFileSync(path.join(dappDir, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(dappDir, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(dappDir, "styles.css"), "utf8");

  assert.match(html, /<title>Noxveil - Private Swap<\/title>/, "project should be renamed in the page title");
  assert.match(html, />Noxveil</, "header brand should use the new project name");
  assert.doesNotMatch(html, /VeilSwap|veilswap/, "old VeilSwap branding should not remain in the UI");
  assert.doesNotMatch(app, /VeilSwap|veilswap/, "old VeilSwap branding should not remain in runtime copy");
  assert.match(html, /class="brand-logo"/, "project should use a generated logo mark");
  assert.doesNotMatch(html, /<select/, "token pills should not use native dropdowns");
  assert.doesNotMatch(app, /on\("(fromToken|toToken)"/, "frontend should not depend on removed token select boxes");
  assert.doesNotMatch(app, /renderTokenSelectors/, "frontend should not depend on removed token select boxes");
  assert.match(html, /class="token-icon token-icon-in"/, "BOIN should have its own generated token icon");
  assert.match(html, /class="token-icon token-icon-out"/, "BOOUT should have its own generated token icon");
  assert.match(html, /id="fromTokenSymbol"[^>]*>BOIN</, "from token should render as static aligned text");
  assert.match(html, /id="toTokenSymbol"[^>]*>BOOUT</, "to token should render as static aligned text");
  assert.match(css, /\.token-pill\s*{[^}]*display:\s*inline-flex/s, "token pill should align icon and text with flex");
  assert.match(html, /styles\.css\?v=raster-brand-1/, "stylesheet should be cache-busted for static token brand");
  assert.match(html, /app\.js\?v=raster-brand-1/, "script should be cache-busted for removed dropdown logic");
});

test("brand and token artwork use generated raster image assets", () => {
  const html = fs.readFileSync(path.join(dappDir, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(dappDir, "styles.css"), "utf8");

  for (const asset of [
    "assets/noxveil-logo.png",
    "assets/boin-token.png",
    "assets/boout-token.png",
  ]) {
    assert.ok(fs.existsSync(path.join(dappDir, asset)), `missing generated raster asset ${asset}`);
    assert.match(html, new RegExp(asset.replace(".", "\\.")), `HTML should use ${asset}`);
  }

  assert.match(html, /<img class="brand-logo"/, "project logo should be a generated raster image, not inline SVG");
  assert.match(html, /<img class="token-icon token-icon-in"/, "BOIN icon should be a generated raster image");
  assert.match(html, /<img class="token-icon token-icon-out"/, "BOOUT icon should be a generated raster image");
  assert.doesNotMatch(html, /<svg class="brand-logo"|<svg class="token-icon/, "logo and token icons should not be inline SVG");
  assert.match(css, /\.brand-logo\s*{[^}]*object-fit:\s*cover/s, "raster logo should be cropped cleanly in its UI box");
  assert.match(css, /\.token-icon\s*{[^}]*object-fit:\s*cover/s, "raster token icons should be cropped cleanly in their UI boxes");
});
