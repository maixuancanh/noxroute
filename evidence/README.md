# NoxRoute Evidence Index

This directory records evidence by claim level. A deployment artifact, local
test, browser smoke, and real multi-wallet test prove different things and are
not interchangeable.

## Current artifacts

| Artifact | Status | What it proves | What it does not prove |
| --- | --- | --- | --- |
| `../dapp/v3-deployment.json` | recorded | Canonical V3 Sepolia addresses, configuration, deployment transactions, and code hashes | A user trade or residual settlement |
| `v3-sepolia-deployment.json` | pass | V3 deployment evidence at the recorded verification block | Multi-wallet behavior |
| `v3-sepolia-dependencies.json` | pass | Code, token metadata, pool fee/state, and configured official dependency addresses | Market quality or a V3 trade |
| `privacy-invariants-v3.json` | pass | The private-field model and exact three-field public-decryption allowlist | TEE compromise resistance or a formal audit |
| `local-nox-v3.log` | pass | 16 local-Nox tests for persistent state, private eligibility, netting, allocation, exact netting, retries, and timeout | Sepolia liveness or wallet extensions |
| `ui-v3-browser.json` | pass, no extension | Visible Chromium layout, wallet chooser, responsive behavior, and no recorded page/console errors | A MetaMask popup, signature, transaction, or multi-wallet E2E |
| `extension-wallet-smoke-2026-08-01.md` | pass | Real MetaMask EIP-6963 lifecycle, token-funded approval/deposit, Nox strategy creation, owner-only reveal, epoch lock, Nox aggregate proof finalization, and official Uniswap residual settlement | Mainnet production readiness |
| `extension-wallet-funding-2026-08-01.json` | pass | Confirmed wrap and transfer receipts funding the connected MetaMask account with exactly 0.002 official Sepolia WETH | Approval, vault deposit, Nox encryption, or strategy creation from MetaMask |
| `extension-wallet-strategy-2026-08-01.json` | extension E2E pass | Real MetaMask approval, Vault deposit, handle-only Nox strategy transaction, owner/event binding, non-zero handles, seven-field owner-authorized Nox reveal without recording plaintext, epoch lock, Nox proof finalization, and official Uniswap residual settlement | Mainnet production readiness |
| `vercel-deployment-2026-08-02.md` | pass | Public Vercel production URL, disabled SSO protection, static asset availability, and public browser smoke | Mainnet production readiness or wallet-extension transaction signing |
| `sepolia-e2e-v3-funding.json` | pass | Explicitly confirmed seller gas funding and official Uniswap WETH-to-USDC setup swap receipts | Confidential strategy execution |
| `sepolia-e2e-v3.json` | pass | Two-owner encrypted strategies, private netting, exactly three public aggregate decryptions, official Uniswap residual settlement, owner output/remaining decryptions, unauthorized-decryption rejection, and replay rejection | A real browser-extension popup or mainnet production readiness |

## Pending artifacts

- No extension-wallet Sepolia E2E artifact remains pending. Mainnet production hardening and audit are still out of scope.

## Claim audit and removals

The required pre-rewrite audit searched README, submission copy, demo copy, and
dApp metadata for overclaims and protocol references. The following stale
V1/V2 material was removed from the NoxRoute public path:

- the retired batch-router product name and three-intent demo framing;
- retired demo-token tickers and token addresses;
- a retired product-router address, adapter address, and pool address;
- an earlier pool and settlement transaction presented as current protocol proof;
- earlier evaluator/router and netting/settlement transactions presented as current encrypted-intent evidence;
- “verified Sepolia E2E” wording that had no V3 multi-wallet evidence artifact;
- instructions and language that treated a no-extension UI smoke as a real wallet flow.

Old contracts or scripts may remain in the repository for regression coverage,
but they are not NoxRoute submission evidence and must not be cited as such.

## Disclosure and scope

- Deposits and withdrawals are public; addresses and lifecycle timing are public.
- The final public boundary is only aggregate residual and `aggregateMinOut`, represented by exactly three aggregate public decryptions.
- Privacy relies on TEE/Nox trust and correct ACL and contract behavior.
- Scope is one WETH/USDC pair, one 0.05% fee tier, a maximum of 8 strategies, and a fixed cadence.
- NoxRoute is not an anonymity system, is not mainnet-audited, and is not production-ready.
- Sepolia test pool price and liquidity are not market-quality evidence.

## Artifact-derived links

Run `npm run docs:render:v3` after a deployment artifact changes, then
`npm run docs:check:v3`. Contract and deployment-transaction links in
`SUBMISSION.md` and `demo-script.md` are generated from
`dapp/v3-deployment.json`. The settlement link and E2E transaction links come
from the verified `sepolia-e2e-v3.json`; never type or recycle one by hand.
