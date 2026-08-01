# NoxRoute README Design

## Goal

Replace the current repository README with a polished English document that
works for hackathon judges, Web3 builders, and technical reviewers. The README
must explain the product in human language, make Nox's role unmistakably
load-bearing, and connect every material technical claim to reproducible local
or Sepolia evidence.

## Audience and reading order

The primary audience is an iExec Nox hackathon judge who may spend only a few
minutes on the repository. The secondary audience is an engineer who wants to
understand, run, or audit the project. The document therefore follows a
product-to-proof sequence:

1. Establish the problem and product in the first screen.
2. Explain why Nox creates real value in the execution path.
3. Show architecture and data flow visually.
4. Demonstrate what is public, private, and selectively revealed.
5. Present deployed contracts and real Sepolia E2E evidence.
6. Provide reproducible setup, test, and dApp instructions.
7. End with security limits, project structure, and supporting documents.

## Document structure

The README will contain these sections:

1. **Hero** — project logo, NoxRoute name, one-sentence value proposition,
   concise badges, live demo, and network/protocol context.
2. **What NoxRoute does** — the public-strategy leakage problem and the product
   response in plain English.
3. **Why Nox is load-bearing** — persistent encrypted state, private
   eligibility, opposing-flow netting, and private allocation.
4. **Architecture** — a Mermaid flowchart showing wallet/dApp, vault, strategy
   engine, NoxCompute, adapter, SwapRouter02, and Uniswap V3 pool.
5. **Execution lifecycle** — a Mermaid sequence diagram covering deposit,
   browser encryption, strategy creation, epoch processing, three aggregate
   decryptions, residual settlement, and owner-authorized reads.
6. **Privacy boundary** — a compact public/private/selectively revealed table.
7. **Measured Sepolia result** — artifact-derived requested, matched, and
   residual volume plus the three public fields. This is described as
   disclosure reduction, not anonymity.
8. **Deployed system** — contract responsibilities and Etherscan links derived
   from the checked deployment artifacts.
9. **Verified E2E** — real transaction links and a clear distinction between
   local tests, browser smoke, extension-wallet execution, and on-chain E2E.
10. **Run locally** — prerequisites, install, compile, tests, local dApp, and
    Sepolia-only safety warning.
11. **Repository map** — important directories and artifacts.
12. **Security and limitations** — public lifecycle data, TEE/ACL trust,
    single-pair testnet scope, no anonymity claim, no audit, and no production
    readiness claim.
13. **Why it fits the challenge** — unchanged official Uniswap integration and
    privacy added through layering rather than modifying Uniswap.
14. **Documentation and acknowledgements** — links to privacy, security,
    submission, demo, and evidence documents.

## Diagram design

The architecture diagram will separate three trust and disclosure zones:

- **User boundary:** wallet, browser-side encryption, and the dApp.
- **Confidential execution boundary:** encrypted strategy state, private Nox
  computation, eligibility, netting, and allocation.
- **Public settlement boundary:** only the aggregate residual and aggregate
  minimum output pass through the unchanged official Uniswap V3 route.

The sequence diagram will make the lifecycle chronological and show which
interactions are public, encrypted, private, or owner-authorized. Mermaid syntax
must render on GitHub without external plugins, custom themes, or unsupported
icons.

## Claim policy

The README may claim only what the repository artifacts verify:

- Real contracts are deployed on Ethereum Sepolia.
- The integration uses official Sepolia WETH, USDC, Uniswap V3 Factory,
  WETH/USDC 0.05% pool, and SwapRouter02 addresses recorded in evidence.
- Two independent owners completed a multi-wallet encrypted-strategy E2E.
- Epoch processing produced exactly three aggregate public decryptions:
  `residualDirection`, `residualAmount`, and `aggregateMinOut`.
- A nonzero aggregate residual settled through the official Uniswap V3 path.
- Owner-only reads, unauthorized-decryption rejection, and replay rejection are
  recorded by the E2E artifact.
- Real MetaMask lifecycle and token-funded transactions are recorded separately
  from headless browser checks.

The README must not claim that deposits, withdrawals, identities, timing, or all
on-chain activity are private. It must not claim anonymity, mainnet readiness,
an audit, production safety, or market-quality execution.

## Tone and style

Use direct, natural English. Prefer short paragraphs and concrete verbs over
marketing superlatives. Explain specialist terms at first use. Avoid repetitive
"verified" language in narrative sections; reserve exact proof status for the
evidence section. Use tables only where comparison improves comprehension.

## Validation

After implementation:

1. Run `npm run docs:check:v3` to ensure generated deployment references remain
   consistent.
2. Run the documentation and privacy-related Node test suites.
3. Scan the README for stale product names and disallowed overclaims.
4. Validate all local file links and compare every address and transaction hash
   with `dapp/v3-deployment.json` and `evidence/sepolia-e2e-v3.json`.
5. Inspect Mermaid blocks for balanced syntax and GitHub-compatible node labels.

## Scope boundary

This task changes only the NoxRoute README and this design record. It does not
rename deployed Solidity contracts, alter application behavior, redeploy the
dApp, publish the repository, or change submission accounts.
