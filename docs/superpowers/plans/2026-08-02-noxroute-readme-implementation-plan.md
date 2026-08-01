# NoxRoute README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the NoxRoute README with an English, human-written hackathon document that explains the product, visualizes its architecture, and links every material claim to reproducible evidence.

**Architecture:** Keep the README product-first, then move from privacy rationale to system diagrams, disclosure boundaries, deployed contracts, E2E proof, reproduction, and limitations. Build every factual section from the checked V3 deployment and Sepolia E2E artifacts, while preserving exact phrases required by the documentation tests.

**Tech Stack:** Markdown, GitHub Mermaid, Ethereum Sepolia, iExec Nox, Solidity/Hardhat, Uniswap V3, Node.js test runner, Playwright evidence.

---

## File map

- Modify `README.md`: the public repository entry point and only product-facing file changed by the implementation.
- Reference `dapp/v3-deployment.json`: canonical chain ID, contract addresses, deployment transactions, fee, cadence, and verification block.
- Reference `evidence/sepolia-e2e-v3.json`: canonical multi-wallet E2E, aggregate disclosure fields, privacy-savings values, settlement data, and rejection checks.
- Reference `evidence/README.md`: claim-to-artifact ledger and proof-level boundaries.
- Test `test/docs-v3.test.mjs`: exact product name, four Nox jobs, disclosure fields, limitations, and evidence status language.
- Test `test/NoxveilPrivacyV3.test.mjs`: privacy model regression coverage.

### Task 1: Replace the README narrative and information architecture

**Files:**
- Modify: `README.md`
- Reference: `SUBMISSION.md`
- Reference: `dapp/project.json`

- [x] **Step 1: Replace the first screen with a professional hero**

Use the existing logo at `dapp/assets/noxroute-logo.png`, identify the product as â€œNoxRoute,â€ and lead with this value proposition: confidential recurring WETH/USDC execution that keeps strategy economics encrypted while only an aggregate residual reaches official Uniswap V3. Include direct links to `https://noxroute.vercel.app`, `SUBMISSION.md`, and `evidence/README.md`, plus compact badges for Sepolia, iExec Nox, Uniswap V3, and test status.

- [x] **Step 2: Write the human product story**

Explain that public recurring strategies leak direction, budget, clip size, limit, slippage, cadence, and remaining capital across transactions. Explain that NoxRoute layers confidential state and computation over unchanged public infrastructure; deposits remain public, strategy economics become encrypted handles, and only the unmatched aggregate residual is prepared for public settlement.

- [x] **Step 3: Preserve the exact four-job Nox section**

Create `## Why Nox is load-bearing` with exactly these four numbered bold labels and no fifth numbered job:

1. `Persistent private strategy state across epochs`
2. `Encrypted balance sufficiency and clip eligibility`
3. `Confidential opposing-flow netting`
4. `Private post-settlement allocation and remaining balances`

Give each label a concise explanation. State why removing Nox from any job reveals per-user economics or breaks the recurring confidential design.

### Task 2: Add GitHub-native architecture and lifecycle diagrams

**Files:**
- Modify: `README.md`
- Reference: `contracts/v3/NoxveilVault.sol`
- Reference: `contracts/v3/NoxveilStrategyEngine.sol`
- Reference: `contracts/v3/NoxveilUniswapV3Adapter.sol`

- [x] **Step 1: Add the architecture flowchart**

Add a GitHub-compatible `flowchart LR` Mermaid block with three subgraphs:

- User boundary: Wallet, NoxRoute dApp, browser-side Nox encryption.
- Confidential execution: Vault, Strategy Engine, NoxCompute, encrypted strategy state, private eligibility/netting/allocation.
- Public settlement: Uniswap V3 Adapter, official SwapRouter02, official WETH/USDC 0.05% pool.

Label the edge into the public settlement zone â€œthree aggregate fields onlyâ€ and the return path â€œaggregate output for private allocation.â€ Do not imply the public ERC-20 deposit is private.

- [x] **Step 2: Add the execution sequence diagram**

Add a `sequenceDiagram` Mermaid block with participants User, dApp, Vault, Engine, Nox, Adapter, and Uniswap. Show public approval/deposit, local encryption, handle-only strategy creation, private epoch computation, exactly three aggregate decryptions, optional nonzero residual settlement, private allocation, and owner-authorized reads.

- [x] **Step 3: Add the disclosure boundary table**

Use three rows:

- Public: approvals, deposits, withdrawals, addresses, timing, participant count, contract calls, residual settlement.
- Private with Nox: direction, budget, clip, limit, slippage, eligibility, requested/matched volume, per-user allocation, remaining balances.
- Selectively revealed: exactly `residualDirection`, `residualAmount`, and `aggregateMinOut` as aggregate settlement fields.

In one paragraph, include the exact test-required phrases â€œviewer-authorized requested and matched volume,â€ â€œonly the aggregate public residual,â€ and â€œexactly three aggregate public decryptions,â€ with only the three permitted backticked field names in that paragraph.

### Task 3: Add artifact-derived Sepolia proof

**Files:**
- Modify: `README.md`
- Reference: `dapp/v3-deployment.json`
- Reference: `evidence/sepolia-e2e-v3.json`
- Reference: `evidence/extension-wallet-strategy-2026-08-01.json`
- Reference: `evidence/vercel-deployment-2026-08-02.md`

- [x] **Step 1: Present the measured disclosure result**

State that the recorded two-owner E2E has status `pass`. Present requested quote volume `20.4876839905`, internally matched quote volume `8.436105`, net residual quote volume `3.6154739905`, and settlement residual quote volume `3.615473990499990936`, clearly labeled as values normalized to the artifactâ€™s quote-WAD accounting. Explain that this is a disclosure-reduction measurement available to an authorized participant, not public Nox decryption and not an anonymity proof.

- [x] **Step 2: Add deployed contract responsibilities and links**

Create a table for NoxCompute, Vault, Strategy Engine, Uniswap V3 Adapter, WETH, USDC, Uniswap V3 Factory, WETH/USDC 0.05% pool, and SwapRouter02. Use exact addresses from `dapp/v3-deployment.json` and link each to `https://sepolia.etherscan.io/address/<address>`. Do not list the metadata-only Chainlink feed as an execution dependency because the V3 contracts do not read it.

- [x] **Step 3: Add real E2E transaction links**

Link the two encrypted strategy transactions, epoch lock/netting, aggregate proof finalization, and official Uniswap residual settlement using the hashes in `evidence/sepolia-e2e-v3.json`. State that the official pool emitted a log, unauthorized decryption was rejected, replay was rejected, and the recorded epoch ID is `0x68984849f6fcfb04e1772dcdb1352d93d1f6569d034b9f8632fa9cd9cc375802`.

- [x] **Step 4: Distinguish proof levels exactly**

Include these four exact labels so the README passes the evidence-boundary tests:

- `Real multi-wallet Sepolia E2E: **verified**`
- `MetaMask connection lifecycle: **verified**`
- `Token-funded extension transactions: **verified**`
- `Public Vercel dApp: **verified**`

For each, link the relevant artifact and state what it does not prove.

### Task 4: Add reproduction, repository map, challenge fit, and limitations

**Files:**
- Modify: `README.md`
- Reference: `package.json`
- Reference: `PRIVACY.md`
- Reference: `SECURITY.md`

- [x] **Step 1: Write runnable setup instructions**

List Node.js 20+, npm, Windows PowerShell/WSL for the local Nox stack, and a Sepolia wallet only for interactive testnet use. Show these exact commands:

```powershell
cd D:\dorahack\ixec\projects\nox-batch
npm install
npm run build
npm run test:unit:v3
npm run typecheck
npm run docs:check:v3
npm run dapp
```

State that the dApp opens at `http://localhost:5173` and that users must use test assets only.

- [x] **Step 2: Add optional verification commands**

Document `npm run test:nox:local:v3`, `npm run test:browser:v3`, `npm run verify:v3:sepolia`, and `npm run verify:e2e:v3`, explaining which require WSL, browser dependencies, or network access. Do not instruct readers to run a state-changing Sepolia E2E by default.

- [x] **Step 3: Add a compact repository tree**

Map `contracts/v3`, `dapp`, `e2e`, `evidence`, `scripts`, `test`, `PRIVACY.md`, `SECURITY.md`, `SUBMISSION.md`, and `demo-script.md` to one clear responsibility each.

- [x] **Step 4: Explain challenge fit**

State that NoxRoute adds privacy through an integration layer without modifying Uniswap V3: Nox handles confidential strategy state and computation, while the official router and pool keep their normal public interfaces and receive only the aggregate residual when settlement is required.

- [x] **Step 5: State all limits without ambiguity**

Include every exact tested boundary: deposits and withdrawals are public; addresses and lifecycle timing are public; privacy depends on TEE/Nox trust; the deployment supports one WETH/USDC pair, one 0.05% fee tier, a maximum of 8 strategies, and a fixed cadence; it is not an anonymity system, not mainnet-audited, not production-ready; Sepolia price and liquidity are not market-quality evidence.

### Task 5: Validate the README as documentation and evidence

**Files:**
- Test: `test/docs-v3.test.mjs`
- Test: `test/NoxveilPrivacyV3.test.mjs`
- Verify: `README.md`

- [x] **Step 1: Run the documentation renderer check**

Run:

```powershell
npm run docs:check:v3
```

Expected: exit code 0 and generated link blocks remain consistent.

- [x] **Step 2: Run focused documentation and privacy tests**

Run:

```powershell
node --test test/docs-v3.test.mjs test/NoxveilPrivacyV3.test.mjs
```

Expected: all tests pass, including product-name, four-job, three-decryption, evidence-level, and limitation assertions.

- [x] **Step 3: Scan for stale names and unsafe wording**

Run:

```powershell
rg -n "Noxveil|NoxBatch|VeilSwap|BOIN|BOOUT|mainnet-ready|production-ready|anonymous|fully private" README.md
```

Expected: only the intentional negative phrases `not production-ready` and `not an anonymity system` may appear; no retired product names appear.

- [x] **Step 4: Verify artifact-derived addresses and hashes**

Run a PowerShell script that loads `dapp/v3-deployment.json` and `evidence/sepolia-e2e-v3.json`, then asserts every contract address, E2E transaction hash, and epoch ID appears in `README.md`.

Expected: output `README artifact references: PASS` and exit code 0.

- [x] **Step 5: Check Markdown links and Mermaid structure**

Use a Node script to collect relative Markdown links and assert their files exist. Assert two Mermaid fences exist, one contains `flowchart LR`, the other contains `sequenceDiagram`, and all fences are balanced.

Expected: output `README links and Mermaid: PASS` and exit code 0.

- [x] **Step 6: Record the non-Git handoff boundary**

The workspace has no `.git` metadata, so no commit step is possible. Report the modified README, validation commands, and exact pass counts without claiming a commit, push, or public repository update.
