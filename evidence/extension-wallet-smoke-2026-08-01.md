# Extension wallet smoke — 2026-08-01

Environment: Chrome with the MetaMask EIP-6963 provider, `http://localhost:5173/`, Ethereum Sepolia.

Verified manually:

- The wallet chooser listed detected EIP-6963 providers with their names and icons.
- Selecting MetaMask connected account `0x018afE2Be696274bCb3A33B2FB1487F96f649bd6`.
- The header rendered the wallet name and shortened address: `MetaMask · 0x018a…9bd6`.
- After a full page reload and provider discovery, the prior MetaMask session restored without another account request.
- Clicking the connected-account button opened the account menu with the full address and a Disconnect action.
- Disconnect returned the UI to `Connect wallet`; a second full reload remained disconnected.
- Reopening the chooser and selecting MetaMask reconnected the same account.
- Sepolia reads completed and displayed the current TWAP and epoch state.

Funding update: after explicit authorization, `extension-wallet-funding-2026-08-01.json` records successful Sepolia wrap and transfer receipts. The connected account then displayed `0.002 WETH`.

Confirmed extension transactions:

- Exact `0.001 WETH` Vault approval: `0x78c334d70e17eee49ca53d382b85ba1b9773902cee08c1eb061e7d53aac7a595`, status `1`, block `11393678`.
- Public `0.001 WETH` Vault deposit: `0x97a53e3e9d870720c3e1ee1bbaba775e4cb6f725b04f141c5d52781893a2aba3`, status `1`, block `11393680`.
- Post-deposit read: wallet balance `0.001 WETH`, allowance `0`, and a non-zero confidential Vault balance handle.

Confirmed extension strategy and privacy flow:

- Nox encrypted all five strategy inputs before calldata construction.
- MetaMask created strategy `0x872e5a1951585f7a83c940c01c118678e314efe17c1d59720559bdf9fd1db52e` in transaction `0xb361515246aae6fc90a9e068bfb412f18251d0550fe336d43aa0a28b35912e2b`, status `1`, block `11393683`.
- The submitted calldata contained five non-zero Nox handles and did not contain the plaintext budget or slippage words.
- The same owner authorized Nox decryption with an off-chain MetaMask signature; the modal rendered all seven owner-only fields.
- No private plaintext values are copied into this evidence. A zero confidential-token balance is handled as zero without sending a zero handle to the Nox decrypt API.

Confirmed extension epoch execution:

- MetaMask locked epoch `0xa514c10000000000000000000000000000000000000000000000000000ac0a33` in transaction `0x4d5439b1a2aab2554b30c5d67673b3e7045cec702c8df9a61cb35ffade00dc27`, status `1`, block `11396363`.
- Nox public-decrypted exactly three aggregate settlement handles; no per-user private values are copied into this evidence.
- MetaMask finalized the aggregate proof in transaction `0x10e24149251453cba68e55638e2117de2e02113bf037070f194e94cc0ae3a336`, status `1`, block `11396366`.
- MetaMask settled the official Uniswap residual in transaction `0x9cbdcec7448b4bb5fb17f8548aa619376551497bc400d90888b2dde8920972ae`, status `1`, block `11396367`.
- The UI displayed all four epoch steps as done and the live status as `Settled`.

The independent deterministic-wallet Sepolia E2E is recorded in `sepolia-e2e-v3.json`.
