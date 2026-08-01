# NoxRoute Security

## Status

NoxRoute is testnet software. It is not mainnet-audited and is not
production-ready. Do not deposit assets with real economic value.

## Security model

The design separates confidential computation from public settlement:

- Nox stores persistent encrypted strategy and balance handles.
- Nox privately evaluates balance sufficiency, clip eligibility, limits, and opposing flow.
- Only `residualDirection`, `residualAmount`, and `aggregateMinOut` may be publicly decrypted.
- The adapter checks the configured WETH/USDC pool, 0.05% fee tier, TWAP window, and aggregate minimum output before calling SwapRouter02.
- The vault, engine, and adapter are bound during bootstrap; current deployment transactions and bytecode evidence are indexed in `evidence/README.md`.

## Trust assumptions

Confidentiality depends on TEE/Nox trust, correct viewer ACLs, the deployed
contract code, wallet behavior, and the surrounding Ethereum/Uniswap security
model. A compromise of the confidential-compute trust boundary or an ACL bug
may expose strategy state. Public chain observers can correlate public events.

## Known limitations

- Deposits and withdrawals are public; addresses and lifecycle timing are public.
- Public ERC-20 approvals, token transfers, epoch participation, and residual settlement remain observable.
- Sepolia scope is one WETH/USDC pair, one 0.05% fee tier, a maximum of 8 strategies, and a fixed cadence.
- NoxRoute is not an anonymity system. It does not hide wallet identity or prevent timing analysis.
- Sepolia test pool price and liquidity are not market-quality evidence.
- Real multi-wallet Sepolia E2E: **verified** in `evidence/sepolia-e2e-v3.json`.
- Real MetaMask extension transaction flow: **verified** in `evidence/extension-wallet-strategy-2026-08-01.json`.
- Real extension-wallet smoke: **verified** in `evidence/extension-wallet-smoke-2026-08-01.md`.

## Reporting

Do not include secrets, private keys, live wallet exports, or unredacted private
strategy values in a report. Provide a minimal reproduction, affected contract
or module, expected behavior, and observed disclosure or authorization failure.
