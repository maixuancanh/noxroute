# NoxRoute Four-Minute Demo Script

## Recording gate

Real multi-wallet Sepolia E2E is **verified** by
`evidence/sepolia-e2e-v3.json`: two owners created encrypted strategies, Nox
netted them, the residual settled through the official Uniswap pool, owners
decrypted their own results, and unauthorized/replay attempts failed. Real
MetaMask connection lifecycle is **verified** in
`evidence/extension-wallet-smoke-2026-08-01.md`, including refresh persistence
and disconnect/reconnect. Token-funded extension transactions are **verified**
in `evidence/extension-wallet-strategy-2026-08-01.json`, including approval,
Vault deposit, handle-only Nox strategy creation, owner-authorized reveal,
epoch lock, aggregate proof finalization, and official Uniswap residual
settlement.

## V3 Sepolia links

This generated block proves the current deployment and lists the verified E2E
transactions, including the official Uniswap residual settlement.

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

## 0:00–0:30 — Establish official dependencies and the boundary

1. Open the **official dependency panel**.
2. Show that NoxCompute, WETH, USDC, the Uniswap V3 factory, WETH/USDC 0.05% pool, and SwapRouter02 match the deployment artifact.
3. Say: “These verified dependencies and deployed V3 contracts do not by themselves prove a completed end-to-end trade.”

## 0:30–1:10 — Create private recurring state

4. Connect the first owner and create the first of **two encrypted strategies** with a private budget, clip, limit, slippage, and direction.
5. Connect the second owner and create the opposing encrypted strategy.
6. Use **owner ACL** decryption to show that each owner can read only owner-authorized strategy state. Explain that persistent Nox handles carry that private state across epochs.

## 1:10–2:05 — Lock, evaluate, and reveal only aggregates

7. Trigger **epoch lock** and show the strategy count without revealing either strategy's economics.
8. Wait for Nox eligibility and opposing-flow netting.
9. Show **exactly three aggregate public decryptions**: `residualDirection`, `residualAmount`, and `aggregateMinOut`.
10. In Privacy savings, compare viewer-only requested volume with **internally matched** volume.
11. Point to the **public residual** as the only volume disclosed for external settlement.

## 2:05–2:50 — Settle only what remains

12. Open the **official Uniswap transaction** generated from the verified V3 E2E artifact. Show the configured SwapRouter02 route and the log emitted by the official WETH/USDC pool.
13. Contrast the internally matched amount with the smaller residual. State that Sepolia pool price and liquidity are not market-quality evidence.

## 2:50–3:30 — Prove selective disclosure

14. Return to owner one and decrypt the owner's **output and remaining balance**.
15. Switch to the other account or auditor fixture and show an **unauthorized decrypt failure** for state outside that viewer's ACL.
16. Open the **privacy receipt**: viewer-authorized requested and matched volume versus only the aggregate public residual, plus the three publicly disclosed aggregate fields.

## 3:30–4:00 — Close with the exact claim

17. Summarize the four load-bearing Nox jobs: persistent state, balance and clip eligibility, opposing-flow netting, and post-settlement allocation.
18. State the public boundary: deposits and withdrawals are public; addresses and lifecycle timing are public; only aggregate residual and `aggregateMinOut` are publicly disclosed at finalization.
19. State the limits: TEE/Nox trust; one WETH/USDC pair; one 0.05% fee tier; a maximum of 8 strategies; fixed cadence; not an anonymity system; not mainnet-audited; not production-ready.
20. End on the evidence status. V3 deployment, dependencies, local Nox behavior, privacy invariants, no-extension UI, multi-wallet Sepolia E2E, MetaMask connection lifecycle, token-funded extension transactions, and the public Vercel dApp are recorded.
