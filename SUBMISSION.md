# NoxRoute Submission

## Short description

NoxRoute is confidential recurring execution for a fixed WETH/USDC Uniswap
V3 Sepolia market. Users encrypt long-lived strategy rules; Nox privately
checks eligibility, nets opposing flow, and allocates results. Only a non-zero
aggregate residual is prepared for settlement through the unchanged official
SwapRouter02 interface.

## Why Nox is load-bearing

1. **Persistent private strategy state across epochs** — encrypted strategy economics remain reusable without plaintext republishing.
2. **Encrypted balance sufficiency and clip eligibility** — participation and clip selection do not reveal individual balance sufficiency or rejection reasons.
3. **Confidential opposing-flow netting** — eligible opposing WETH/USDC flow is matched before any public AMM settlement.
4. **Private post-settlement allocation and remaining balances** — outputs and surviving budgets remain encrypted and owner-authorized after finalization.

These are four distinct jobs in the execution path. Removing Nox from any one
of them exposes per-user state or prevents the recurring private strategy from
working across epochs.

## What a judge can measure

The privacy-savings panel compares **viewer-authorized requested and matched
volume** with only the aggregate public residual visible to an ordinary chain
observer. At finalization, **exactly three aggregate public decryptions** are
allowed: `residualDirection`, `residualAmount`, and `aggregateMinOut`.

The difference between requested volume and public residual is a measurable
disclosure reduction, not an anonymity claim. Deposits and withdrawals are
public; addresses and lifecycle timing are public.

## Current evidence status

- **Verified deployment:** `dapp/v3-deployment.json` and `evidence/v3-sepolia-deployment.json` describe the V3 Sepolia contracts.
- **Verified official dependencies:** `evidence/v3-sepolia-dependencies.json` records code and configuration for NoxCompute, WETH, USDC, the Uniswap V3 factory, the 0.05% pool, and SwapRouter02.
- **Verified local Nox behavior:** `evidence/local-nox-v3.log` records 16 passing local-Nox tests.
- **Verified privacy allowlist:** `evidence/privacy-invariants-v3.json` records the exact three public decryption fields and no violations.
- **Verified UI without an extension:** `evidence/ui-v3-browser.json` records the no-extension browser smoke and its boundary.
- Real multi-wallet Sepolia E2E: **verified**. `evidence/sepolia-e2e-v3.json` records the settled two-owner epoch, official Uniswap pool log, owner-only output/remaining decryptions, unauthorized-decryption rejection, and replay rejection.
- MetaMask connection lifecycle: **verified**. `evidence/extension-wallet-smoke-2026-08-01.md` records the real EIP-6963 chooser, connection, refresh persistence, account menu, disconnect, and reconnect.
- Token-funded extension transactions: **verified**. `evidence/extension-wallet-smoke-2026-08-01.md` and `evidence/extension-wallet-strategy-2026-08-01.json` record real MetaMask approval, Vault deposit, handle-only Nox strategy creation, owner-authorized reveal, epoch lock, aggregate proof finalization, and official Uniswap residual settlement.
- Public Vercel dApp: **verified**. `evidence/vercel-deployment-2026-08-02.md` records the production URL, disabled Vercel SSO protection, static asset checks, and browser smoke test.

## V3 Sepolia links

The block below is checked against `dapp/v3-deployment.json` and
`evidence/sepolia-e2e-v3.json` by `npm run docs:check:v3`. Contract,
deployment, strategy, epoch, proof, and settlement links are artifact-derived.

<!-- V3_LINKS:START -->
_Generated from `dapp/v3-deployment.json` and the verified E2E artifact when present; do not hand-edit addresses or transaction hashes._

### Contracts

- [NoxCompute](https://sepolia.etherscan.io/address/0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF)
- [NoxRoute Vault](https://sepolia.etherscan.io/address/0x7ac57676aF7810358Db8a09fe0bc51C6559990f6)
- [NoxRoute Strategy Engine](https://sepolia.etherscan.io/address/0x8Ff54Fbf497D48bCFba47Dd2bD36aC0F83233251)
- [NoxRoute Uniswap V3 Adapter](https://sepolia.etherscan.io/address/0xed8d65bfE6b170C431A353fD74e205a1BfB50aD2)
- [WETH](https://sepolia.etherscan.io/address/0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14)
- [USDC](https://sepolia.etherscan.io/address/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238)
- [Uniswap V3 Factory](https://sepolia.etherscan.io/address/0x0227628f3F023bb0B980b67D528571c95c6DaC1c)
- [Uniswap V3 WETH/USDC 0.05% pool](https://sepolia.etherscan.io/address/0x3289680dD4d6C10bb19b899729cda5eEF58AEfF1)
- [SwapRouter02](https://sepolia.etherscan.io/address/0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E)

### Deployment transactions

- [Vault deployment](https://sepolia.etherscan.io/tx/0x7ac91edf7f32a1408192e0326ee8f842f7daeb376c645c52ddce35fdb7fcd159)
- [Adapter deployment](https://sepolia.etherscan.io/tx/0x8cdaa171ae071d42e3c1956f33478ae22071f9600f2ef73744b8a05de847a6dd)
- [Engine deployment](https://sepolia.etherscan.io/tx/0x99dafb8842b3dfea65306d656bbe7b1e0b3eea7ddcba9ab164261c32295728e2)
- [Engine binding](https://sepolia.etherscan.io/tx/0x045773d8d95815dc778cbb885d2545dd0bba51d477d4cfaf0f7f670bf748d677)
- [Adapter binding](https://sepolia.etherscan.io/tx/0x7e524aaafdb00efd8551d562d2d03d371b228d292dc98be953b236144dbb70f0)
- [Bootstrap closure](https://sepolia.etherscan.io/tx/0xe11e178784f1f2e0466a6bae875e1b829df496c3ff0691805ab64e68374dc604)

### Real multi-wallet Sepolia E2E transactions

- [WETH-owner encrypted strategy](https://sepolia.etherscan.io/tx/0xc990e3fc04394fa6956450a7b3df5918517ee1cd6bea389778534b505c4d0864)
- [USDC-owner encrypted strategy](https://sepolia.etherscan.io/tx/0xd8b658b3fe45635978d87d84670b5e9e54e720a5f8ce7e3b2ea4b98e0676855d)
- [Confidential epoch lock and netting](https://sepolia.etherscan.io/tx/0xea3ad346a980483d10c6d147fcbd9fc881e9214516b3bc3f77fd22a702d3ce22)
- [Aggregate proof finalization](https://sepolia.etherscan.io/tx/0xd395fe536c1482a29f42fb924c7346ed578345a63e9e2a98a9ea426bce5a5770)
- [Official Uniswap residual settlement](https://sepolia.etherscan.io/tx/0xb7f3d0129bafd9eb2e3a9210f54d2a1bdca4844b3c3768d81b54e9863adb125a)

_Verified settled epoch `0x68984849f6fcfb04e1772dcdb1352d93d1f6569d034b9f8632fa9cd9cc375802`; links are generated from `evidence/sepolia-e2e-v3.json`._
<!-- V3_LINKS:END -->

## Limitations

- Deposits and withdrawals are public; addresses and lifecycle timing are public.
- Only aggregate residual and `aggregateMinOut` become public at finalization.
- The privacy boundary depends on TEE/Nox trust, correct ACLs, and correct contract code.
- Sepolia scope is one WETH/USDC pair, one 0.05% fee tier, a maximum of 8 strategies, and a fixed cadence.
- NoxRoute is not an anonymity system, is not mainnet-audited, and is not production-ready.
- Sepolia test pool price and liquidity are not market-quality evidence.

## Public X post draft

Built NoxRoute: confidential recurring WETH/USDC strategies with persistent
Nox state, private eligibility, opposing-flow netting, and private allocation.
Only a non-zero aggregate residual is prepared for official Uniswap V3
settlement. Deployment, local-Nox, privacy, UI, real multi-wallet Sepolia E2E,
and real MetaMask extension transaction evidence are recorded. @iEx_ec

Demo + repo: <insert links>

## Required links before submission

- Public GitHub repo URL:
- Four-minute demo video URL:
- X post URL tagging `@iEx_ec`:
- Live dApp URL: https://noxroute.vercel.app

The extension-wallet evidence now includes token-funded approval, deposit, Nox
strategy creation, owner-authorized reveal, epoch lock, aggregate proof
finalization, and official Uniswap residual settlement. Do not expand the claim
beyond Sepolia, the listed WETH/USDC pair, or the documented trust boundary.
