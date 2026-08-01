# NoxRoute Privacy Boundary

## Private state

The following values are represented as Nox handles and remain encrypted for
the recurring strategy flow: direction, budget and remaining budget, clip,
limit, slippage, per-user balances, eligibility, allocations, requested volume,
and matched volume. Contract-level persistence lets that state survive across
epochs without plaintext republishing.

Owners receive viewer access to their own strategy, balance, output, and
remaining-state handles. A configured auditor may receive aggregate viewer
access. Unauthorized viewers should receive a decryption failure; that failure
is part of the demo and not a substitute for a formal privacy proof.

## Public decryption boundary

Finalization permits **exactly three aggregate public decryptions**:

1. `residualDirection`
2. `residualAmount`
3. `aggregateMinOut`

No requested total, matched total, per-user clip, eligibility decision,
allocation, or remaining balance belongs in the public decryption allowlist.
The recorded allowlist is in `evidence/privacy-invariants-v3.json`.

## Measurable disclosure reduction

The privacy receipt compares **viewer-authorized requested and matched volume**
while an ordinary observer sees only the aggregate public residual. Internally
matched flow is therefore volume that does not need to appear as external AMM
input. This metric describes disclosure savings; it does not prove anonymity or
hide the surrounding public lifecycle.

## Public information

- Deposits and withdrawals are public; addresses and lifecycle timing are public.
- ERC-20 approvals and transfers, participant count, epoch timing, contract calls, and any residual settlement are public.
- Only aggregate residual and `aggregateMinOut` are intended to reveal execution quantities at finalization.

## Limits and trust

The privacy claim assumes TEE/Nox trust and correct ACL and contract behavior.
NoxRoute is not an anonymity system, is not mainnet-audited, and is not
production-ready. The Sepolia deployment is limited to one WETH/USDC pair, one
0.05% fee tier, a maximum of 8 strategies, and a fixed cadence. Sepolia test
pool price and liquidity are not market-quality evidence.

- Real multi-wallet Sepolia E2E: **verified** in `evidence/sepolia-e2e-v3.json`.
- Real MetaMask extension transaction flow: **verified** in `evidence/extension-wallet-strategy-2026-08-01.json`.
- Real extension-wallet smoke: **verified** in `evidence/extension-wallet-smoke-2026-08-01.md`.
