# Noxveil Confidential DCA/TWAP Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the V2 one-shot demo with a production-shaped Noxveil V3 vault that keeps recurring WETH/USDC strategy state and user balances confidential, offsets opposing clips at a Uniswap V3 TWAP, and exposes only the residual aggregate needed for a real Sepolia settlement.

**Architecture:** Preserve all V2 contracts and evidence. Add V3 under `contracts/v3/`: an encrypted-balance vault, a persistent strategy/epoch engine, and a narrow official-Uniswap adapter. The engine evaluates at most eight strategies per epoch with Nox, reserves encrypted debits, public-decrypts only residual direction/amount/aggregate minimum, settles the residual through official SwapRouter02, and atomically credits encrypted output balances. Unit tests run without the Nox services, Nox integration tests run with the official Hardhat plugin and Docker Engine inside WSL, and a separate real Sepolia E2E proves the complete boundary.

**Tech Stack:** Solidity 0.8.35, Hardhat 3.11, Ethers 6, `@iexec-nox/nox-protocol-contracts` 0.2.4, `@iexec-nox/nox-hardhat-plugin` 0.2.0, `@iexec-nox/handle`, official Sepolia WETH/USDC/Uniswap V3, Node 22+, Docker Engine in WSL, vanilla HTML/CSS/JavaScript dApp.

---

## Non-negotiable proof boundary

- `test:unit:v3` proves deterministic math, state-machine guards, adapter restrictions, and UI helpers. It is not Nox runtime evidence.
- `test:nox:local:v3` must boot the official Nox off-chain stack through the Hardhat plugin inside WSL. It proves real handle creation, ACL behavior, encrypted arithmetic, and local public decryption.
- `test:sepolia:v3` must use the deployed Sepolia NoxCompute and official WETH/USDC/Uniswap V3 contracts. It is the only test that can produce a `sepolia-e2e.json` success artifact.
- Never call a plaintext helper a Nox test. Never use `Nox.toEuint256(userPlaintext)` for a value that is claimed private; private fields enter as `externalEuint*` handles and proofs produced before the transaction.
- Never public-decrypt a user clip, user output, user balance, remaining budget, limit, slippage, eligibility flag, or per-side total. Only residual direction, residual amount, and one aggregate `amountOutMinimum` may become public.
- Aggregate requested and internally matched quote-volume handles remain private too. Participating strategy owners and an optional scoped auditor may receive viewer ACLs and deliberately decrypt those two metrics; an unauthenticated chain observer cannot.
- Addresses, strategy creation/cancellation calls, epoch timing, participant count, residual settlement, and ordinary ERC-20 deposits/withdrawals remain public. Noxveil claims confidentiality, not sender anonymity.
- The dApp must not create, fund, or submit intents from hidden demo wallets. Sepolia fixtures use explicit separately funded E2E keys from environment variables and are not part of the product UI.
- This directory is not currently a Git repository. Do not initialize Git and do not pretend that per-task commits exist. Record task completion in this checklist and in machine-readable evidence instead.

## Canonical V3 constants and units

- Chain: Ethereum Sepolia, chain ID `11155111`.
- WETH9: `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`, 18 decimals.
- Circle USDC: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`, 6 decimals.
- Uniswap V3 Factory: `0x0227628f3F023bb0B980b67D528571c95c6DaC1c`.
- SwapRouter02: `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E`.
- Candidate 0.05% WETH/USDC pool: resolve at runtime with `factory.getPool(WETH, USDC, 500)`; never trust a copied pool address without checking factory membership, bytecode, token0/token1, fee, observation history, and nonzero liquidity.
- NoxCompute is supplied by `@iexec-nox/nox-protocol-contracts` for chain `11155111`; deployment scripts must additionally assert nonempty code at `0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF` before deploying V3.
- `PRICE_WAD` is USDC per WETH scaled by `1e18`.
- Convert WETH atomic units to quote WAD with `wethWei * priceWad / 1e18`.
- Convert USDC atomic units to quote WAD with `usdcAtoms * 1e12`.
- Convert quote WAD to WETH atomic units with `quoteWad * 1e18 / priceWad`.
- Convert quote WAD to USDC atomic units with `quoteWad / 1e12`.
- Direction encoding is private: `0 = WETH_TO_USDC`, `1 = USDC_TO_WETH`. Any other encrypted value becomes ineligible; it must not cause a public revert that reveals the value.
- Epochs are global and fixed cadence. An active strategy is evaluated every epoch until its encrypted remaining budget reaches zero or its public owner cancels it.

---

### Task 1: Wire the official Nox local test runtime without breaking V2

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `hardhat.config.ts`
- Create: `scripts/run-nox-local-wsl.sh`
- Create: `test/NoxPluginConfigV3.test.mjs`

- [x] **Step 1: Write the failing package/config smoke test**

Create `test/NoxPluginConfigV3.test.mjs` with Node tests that read `package.json` and `hardhat.config.ts` and assert:

```js
assert.equal(pkg.devDependencies['@iexec-nox/nox-hardhat-plugin'], '0.2.0');
assert.match(config, /noxPlugin/);
assert.match(config, /chainType:\s*['"]op['"]/);
assert.match(pkg.scripts['test:nox:local:v3'], /run-nox-local-wsl/);
assert.match(pkg.scripts['test:sepolia:v3'], /noxveil-v3-sepolia/);
```

- [x] **Step 2: Run it and confirm RED**

Run:

```powershell
node --test test/NoxPluginConfigV3.test.mjs
```

Expected: FAIL because the plugin, network type, and V3 scripts do not exist.

- [x] **Step 3: Install and pin the official plugin**

Run:

```powershell
npm install --save-dev --save-exact @iexec-nox/nox-hardhat-plugin@0.2.0 cross-env@7.0.3
```

Keep the existing Hardhat `3.11.1` range and Mocha/Ethers toolbox. Add the Nox plugin to `plugins` and add:

```ts
networks: {
  default: { type: "edr-simulated", chainType: "op" },
},
```

The installed `0.2.0` package starts or resolves the local stack only when the test calls `nox.connect(networkConnection)`; it does not implement the older documented top-level `nox.skipTestOverride` option. Do not add that ignored config key. Do not configure a Sepolia private key in `hardhat.config.ts`; the deployment/E2E scripts continue to read secrets from environment variables directly.

- [x] **Step 4: Add separated scripts**

Add these scripts without changing existing V2 commands:

```json
"test:unit:v3": "hardhat test mocha test/NoxveilMathV3.ts test/NoxveilAdapterV3.ts && node --test test/NoxPluginConfigV3.test.mjs test/dapp-ui-v3.test.mjs",
"test:nox:local:v3:inner": "hardhat test mocha e2e/noxveil-v3-local.spec.ts",
"test:nox:local:v3": "wsl bash /mnt/d/dorahack/ixec/projects/nox-batch/scripts/run-nox-local-wsl.sh",
"test:sepolia:v3": "cross-env RUN_SEPOLIA_V3_E2E=1 hardhat test mocha e2e/noxveil-v3-sepolia.spec.ts"
```

- [x] **Step 5: Add the WSL isolation runner**

`scripts/run-nox-local-wsl.sh` must:

1. use `set -euo pipefail`;
2. check `node --version` is 22+;
3. check `docker info` succeeds against Docker Engine inside WSL;
4. create a temporary directory with `mktemp -d`;
5. copy the project into it with `rsync`, excluding `.env`, `node_modules`, `artifacts`, `cache`, and evidence containing keys;
6. run `npm ci`, then `npm run test:nox:local:v3:inner`;
7. copy a sanitized success log back to `evidence/local-nox-v3.log` only after the test exits zero;
8. remove only the validated temporary directory in a `trap`.

This avoids sharing Windows-native `node_modules` binaries with Linux.

- [x] **Step 6: Verify GREEN without starting Docker yet**

Run:

```powershell
node --test test/NoxPluginConfigV3.test.mjs
npm run build
npx hardhat test mocha --grep "NoxBatch"
```

Expected: config test passes, all contracts compile, and existing V2 tests remain green. Do not claim local Nox runtime proof yet.

---

### Task 2: Implement deterministic V3 price, netting, and commitment math

**Files:**

- Create: `contracts/v3/libraries/NoxveilMath.sol`
- Create: `contracts/v3/libraries/NoxveilTypes.sol`
- Create: `contracts/test/NoxveilMathHarness.sol`
- Create: `test/NoxveilMathV3.ts`

- [x] **Step 1: Write failing unit tests**

Cover these named cases in `test/NoxveilMathV3.ts`:

```text
converts WETH and USDC atomic amounts through quote WAD without decimal drift
returns a WETH residual when WETH quote volume exceeds USDC quote volume
returns a USDC residual when USDC quote volume exceeds WETH quote volume
returns zero residual for exactly offsetting flow
rounds residual input down and amountOutMinimum up conservatively
computes pro-rata output and assigns deterministic final dust
rejects price zero, unsupported fee, and arithmetic overflow
changes the action commitment when any bound field changes
```

The action commitment preimage must contain:

```solidity
chainId, engine, vault, adapter, epochId, epochNonce, deadline,
weth, usdc, uniswapRouter, uniswapPool, fee, twapWindow,
twapPriceWad, residualDirectionHandle, residualAmountHandle,
aggregateMinOutHandle
```

- [x] **Step 2: Run and confirm RED**

Run:

```powershell
npx hardhat test mocha test/NoxveilMathV3.ts
```

Expected: FAIL because the library and harness do not exist.

- [x] **Step 3: Implement the smallest pure math library**

Use `Math.mulDiv`-equivalent full-precision arithmetic or a reviewed local implementation; never multiply before dividing when realistic WETH/price ranges could overflow. Return a `Residual` struct with public direction enum, input amount, and matched quote volume. For dust, give the last eligible strategy on a side the difference between aggregate output and prior allocations so sum(outputs) equals aggregate output exactly.

- [x] **Step 4: Verify GREEN and edge ranges**

Run:

```powershell
npx hardhat test mocha test/NoxveilMathV3.ts
npm run build
```

Expected: all deterministic math tests pass and Solidity 0.8.35 compilation succeeds.

---

### Task 3: Define narrow V3 interfaces and public state machine

**Files:**

- Create: `contracts/v3/interfaces/INoxveilVault.sol`
- Create: `contracts/v3/interfaces/INoxveilAdapter.sol`
- Create: `contracts/v3/interfaces/IUniswapV3PoolMinimal.sol`
- Create: `contracts/v3/interfaces/ISwapRouter02Minimal.sol`
- Create: `contracts/v3/interfaces/IUniswapV3FactoryMinimal.sol`
- Create: `contracts/v3/interfaces/IERC20MetadataMinimal.sol`
- Create: `contracts/v3/NoxveilEpochState.sol`
- Create: `test/NoxveilEpochStateV3.ts`

- [x] **Step 1: Write failing state-machine tests**

Assert only these transitions are legal:

```text
NONE -> OPEN -> LOCKED -> READY -> SETTLING -> SETTLED
LOCKED -> CANCELLED after deadline
READY -> READY on a failed external settlement because the transaction reverts
```

Assert replayed epoch IDs, stale nonces, duplicate finalization proofs, premature cancellation, and changed action commitments revert.

- [x] **Step 2: Run and confirm RED**

Run:

```powershell
npx hardhat test mocha test/NoxveilEpochStateV3.ts
```

Expected: FAIL because the state machine does not exist.

- [x] **Step 3: Implement interfaces and the public skeleton**

The interfaces expose only the narrow calls required between vault, engine, and adapter. The public epoch struct contains no per-user amounts:

```solidity
struct EpochPublic {
  uint64 openedAt;
  uint64 lockedAt;
  uint64 deadline;
  uint32 participantCount;
  uint32 nonce;
  EpochStatus status;
  uint256 twapPriceWad;
  bytes32 actionCommitment;
  bytes32 residualDirectionHandle;
  bytes32 residualAmountHandle;
  bytes32 aggregateMinOutHandle;
  uint256 residualAmount;
  uint256 amountOutMinimum;
  uint256 amountOut;
}
```

The plaintext residual fields remain zero until a valid Nox decryption proof is accepted.

- [x] **Step 4: Verify GREEN**

Run:

```powershell
npx hardhat test mocha test/NoxveilEpochStateV3.ts
```

Expected: all transition/replay tests pass.

---

### Task 4: Build the encrypted two-token vault with reservation accounting

**Files:**

- Create: `contracts/v3/NoxveilVault.sol`
- Create: `contracts/test/MockNoxveilEngine.sol`
- Test in: `e2e/noxveil-v3-local.spec.ts`
- Modify: `e2e/noxveil-v3-local.spec.ts`

- [x] **Step 1: Write failing contract tests**

Test public guards without needing plaintext Nox evaluation:

```text
accepts only configured WETH and USDC
credits the sender and never an arbitrary beneficiary during deposit
only the immutable engine can reserve, commit, release, or authorize adapter spend
rejects a second engine assignment and arbitrary adapter targets
uses checks-effects-interactions and a non-reentrancy guard
emits deposit and withdrawal boundary events without encrypted values in event data
cannot withdraw funds reserved for an epoch
```

- [x] **Step 2: Run and confirm RED**

Run:

```powershell
npm run test:nox:local:v3
```

Expected: FAIL because `NoxveilVault` does not exist. This is intentionally a real Nox-stack RED test, not a plaintext mock.

- [x] **Step 3: Implement encrypted ledger storage**

Store, per user and token:

```solidity
mapping(address => mapping(address => euint256)) private available;
mapping(bytes32 => mapping(address => mapping(address => euint256))) private reserved;
```

After every newly produced handle:

```solidity
Nox.allowThis(value);
Nox.allow(value, owner);
Nox.allow(value, strategyEngine);
```

`deposit(token, amount)` transfers ordinary ERC-20 and adds `Nox.toEuint256(amount)` to the encrypted available balance. The docs and UI must label this amount public. Expose only handle getters, never plaintext balance getters.

- [x] **Step 4: Implement encrypted reserve/commit/release**

The engine passes an encrypted direction and selected clip. The vault uses `Nox.eq`, `Nox.select`, and safe arithmetic to derive WETH and USDC reservations without branching publicly on direction. Invalid direction or insufficient balance selects zero reservation instead of reverting on a secret condition. The engine receives a private eligibility handle and folds it into the final selected clip.

On settlement, `commitEpoch` subtracts reserved input and adds encrypted output. On cancellation, `releaseEpoch` returns both encrypted reservations. Neither function transfers per-user ERC-20.

- [x] **Step 5: Add withdrawal request/fulfillment**

The owner requests a full-token-balance withdrawal bound to a fresh destination, nonce, deadline, token, vault, chain, and the current encrypted balance handle. Only that balance handle is made publicly decryptable because an ordinary ERC-20 transfer cannot hide the final amount. `finalizeFullWithdrawal` validates the proof, checks the handle has not changed, consumes the nonce once, zeroes the encrypted ledger balance, and transfers to the committed destination. This avoids public-decrypting a separate encrypted sufficiency boolean.

- [x] **Step 6: Add the real local Nox vault tests**

In `e2e/noxveil-v3-local.spec.ts`, create a Hardhat network connection, pass it to `nox.connect(connection)`, and use the returned `encryptInput`, `decrypt`, and `publicDecrypt` methods to prove:

- owner can decrypt available balance;
- engine can compute with it;
- an unrelated signer cannot decrypt it;
- the handle remains usable in a later transaction, proving `allowThis` was granted;
- reservation and release do not public-decrypt user values;
- withdrawal exposes exactly one amount and consumes its commitment once.

- [x] **Step 7: Run unit and local-stack GREEN**

Run:

```powershell
npm run test:nox:local:v3
npm run build
```

Expected: public guards and real Nox assertions pass through Docker Engine in WSL. Verified on 2026-08-01 with 7 passing local-stack cases.

---

### Task 5: Build persistent encrypted strategies

**Files:**

- Create: `contracts/v3/NoxveilStrategyEngine.sol`
- Modify: `e2e/noxveil-v3-local.spec.ts`

- [x] **Step 1: Write failing strategy lifecycle tests**

Test:

```text
accepts all five private fields only as external handles plus proofs
rejects zero or replayed handles and duplicate strategy nonces
stores owner, pair, creation epoch, cancelled flag, and nonce publicly
stores direction, remaining, clip, limit, and slippage only as handles
allows at most eight active strategies in an epoch
lets only the owner cancel a strategy
does not emit plaintext strategy fields
preserves V2 files and addresses untouched
```

- [x] **Step 2: Run and confirm RED**

Run:

```powershell
npm run test:nox:local:v3
```

Expected: FAIL because the V3 engine does not exist.

- [x] **Step 3: Implement creation with Nox proof validation**

Use an explicit typed input struct to keep the ABI auditable without triggering a Solidity stack-too-deep failure:

```solidity
struct ExternalStrategyInput {
  externalEuint16 direction;
  bytes directionProof;
  externalEuint256 budget;
  bytes budgetProof;
  externalEuint256 clip;
  bytes clipProof;
  externalEuint256 limitPriceWad;
  bytes limitProof;
  externalEuint256 slippageBps;
  bytes slippageProof;
}

createStrategy(ExternalStrategyInput calldata input, uint64 clientNonce)
```

Validate each with `Nox.fromExternal`. Apply `Nox.allowThis` and `Nox.allow(handle, owner)` to every persistent handle. Do not accept a public budget cap or public direction. Use the vault's encrypted balance handles later for eligibility rather than leaking a cap at creation.

- [x] **Step 4: Implement cancellation without secret completion leakage**

Cancellation is public and owner-authorized. Natural completion (`remaining == 0`) stays encrypted; the public strategy stays registered but contributes zero to future epochs. The UI may show completion only after owner decryption.

- [x] **Step 5: Add real local Nox persistence tests**

Prove that the owner decrypts strategy fields, another signer fails, engine evaluation can reuse the handles in a later block, and no public decryption request is created for individual fields.

- [x] **Step 6: Verify unit GREEN**

Run:

```powershell
npm run test:nox:local:v3
npm run build
```

Expected: lifecycle tests pass. Verified on 2026-08-01 as part of the 10-case real local Nox stack suite.

---

### Task 6: Implement confidential epoch evaluation and true opposing-flow netting

**Files:**

- Modify: `contracts/v3/NoxveilStrategyEngine.sol`
- Modify: `contracts/v3/NoxveilVault.sol`
- Modify: `e2e/noxveil-v3-local.spec.ts`

- [x] **Step 1: Write failing epoch tests**

Add cases for:

```text
evaluates a valid WETH seller when TWAP >= its encrypted limit
evaluates a valid USDC seller when TWAP <= its encrypted limit
selects zero for invalid direction, insufficient balance, exhausted budget, or failed limit
uses min(encrypted remaining, encrypted clip)
offsets opposing quote volume and derives only one residual direction
reserves selected debits but does not decrement remaining before settlement
marks only residual direction, residual amount, and aggregate minOut publicly decryptable
keeps each selected clip, side total, limit, and eligibility private
```

- [x] **Step 2: Run and confirm RED**

Run:

```powershell
npm run test:nox:local:v3
```

Expected: FAIL because epoch evaluation is not implemented. The wrapper must run inside WSL with Docker; do not substitute mocks.

- [x] **Step 3: Implement bounded encrypted evaluation**

For each of at most eight active strategies:

1. convert public TWAP and constants to public Nox handles;
2. validate encrypted direction by comparing to `0` and `1`;
3. compute `candidate = min(remaining, clip)` using encrypted comparisons/select;
4. compare the encrypted vault balance to `candidate`;
5. apply direction-specific encrypted price condition;
6. combine conditions with nested encrypted `Nox.select` operations (the pinned Nox SDK has comparisons and selects but no boolean AND/OR wrapper);
7. select candidate or zero without a secret-dependent Solidity branch;
8. reserve it in the vault;
9. aggregate WETH and USDC input handles separately;
10. store selected clip handles for post-settlement allocation.

Every result needed in another transaction receives `Nox.allowThis`. Handles passed from engine to vault in the same call receive transient vault access; handles stored by the vault receive persistent vault/owner/engine ACLs before return.

- [x] **Step 4: Compute confidential matched flow and residual**

Normalize both encrypted side totals into quote WAD, compute encrypted `matchedQuote = min(wethQuote, usdcQuote)`, and derive encrypted residual direction and native-token residual amount. Zero residual must settle internally without calling Uniswap.

The strict aggregate minimum is derived only for the residual side:

- WETH residual: use the strictest eligible encrypted lower execution price, combining each private sell limit with its private slippage-from-TWAP floor.
- USDC residual: use the strictest eligible encrypted upper execution price, combining each private buy limit with its private slippage-from-TWAP ceiling.
- No residual: aggregate minimum is encrypted zero.

Call `Nox.allowPublicDecryption` only on the final direction, residual amount, and aggregate minimum handles.

Keep `totalRequestedQuote` and `matchedQuote` as encrypted handles. Grant viewer ACLs only to owners who participated in that epoch and to an explicitly configured, revocable auditor. These values power the in-app privacy-savings proof after an authorized signature; they are not part of public settlement calldata.

- [x] **Step 5: Bind the action commitment**

Store a commitment over all fields listed in Task 2 plus the three aggregate handles. Any retry uses the same epoch nonce and commitment; a newly locked epoch gets a new nonce. Do not accept caller-supplied adapter/pool/router values during finalization.

- [x] **Step 6: Verify local Nox GREEN**

Run from Windows:

```powershell
npm run test:nox:local:v3
```

Expected: the WSL runner reports Docker healthy, the official plugin boots the Nox services, and all vault/strategy/epoch Nox tests pass. Save console output under `evidence/local-nox-v3.log` only after sanitizing it for secrets.

Verified on 2026-08-01 with 12 passing real local-stack cases. `slippageBps` is encoded as encrypted `uint256`, not encrypted `uint16`, because Nox protocol contracts 0.2.4 do not expose an encrypted integer widening cast; keeping the value in one encrypted arithmetic domain avoids plaintext conversion.

---

### Task 7: Implement the official Uniswap V3 TWAP adapter

**Files:**

- Create: `contracts/v3/NoxveilUniswapV3Adapter.sol`
- Create: `contracts/test/MockUniswapV3Pool.sol`
- Create: `contracts/test/MockUniswapV3Factory.sol`
- Create: `contracts/test/MockSwapRouter02.sol`
- Create: `contracts/test/MockERC20Decimals.sol`
- Create: `test/NoxveilAdapterV3.ts`

- [x] **Step 1: Write failing adapter tests**

Test:

```text
constructor rejects wrong factory pool, token pair, fee, router, or zero-code endpoint
consultTwap uses observe([window, 0]) and never slot0 as the reference price
handles negative tick rounding exactly as Uniswap OracleLibrary
normalizes 18-decimal WETH and 6-decimal USDC into PRICE_WAD
rejects stale/insufficient observation history
rejects spot deviation above public MAX_DEVIATION_BPS
allows only the immutable engine/vault path to execute
executes exactInputSingle for only the configured pair and fee
sets an exact allowance, resets it to zero, and returns actual amountOut
does not call the router for a zero residual
```

- [x] **Step 2: Run and confirm RED**

Run:

```powershell
npx hardhat test mocha test/NoxveilAdapterV3.ts
```

Expected: FAIL because the adapter does not exist.

- [x] **Step 3: Implement TWAP consultation**

Port only the required, license-compatible portions of Uniswap V3 `OracleLibrary`/`TickMath` with attribution, or import a pinned official package if it compiles cleanly under Solidity 0.8.35. Compute arithmetic mean tick from `observe`, correct negative division rounding, and quote exactly one WETH into USDC-scaled `PRICE_WAD`.

Use a public deployment-time TWAP window and max deviation ceiling. Read spot only for the deviation guard, never as the reference used for private eligibility.

- [x] **Step 4: Implement residual settlement**

The vault transfers only the already-public residual input to the adapter. The adapter approves SwapRouter02 for exactly `amountIn`, calls:

```solidity
exactInputSingle({
  tokenIn,
  tokenOut,
  fee: 500,
  recipient: vault,
  amountIn,
  amountOutMinimum,
  sqrtPriceLimitX96: 0
})
```

Then reset approval to zero. Reject callbacks or arbitrary calldata; this is not a generic executor.

- [x] **Step 5: Verify GREEN**

Run:

```powershell
npx hardhat test mocha test/NoxveilAdapterV3.ts
npm run test:unit:v3
```

Expected: all adapter and pure unit tests pass without claiming official Sepolia use.

Verified on 2026-08-01: 5/5 adapter tests and 13/13 Hardhat V3 unit tests pass. The required TickMath constants and OracleLibrary quote/negative-rounding behavior are preserved with Uniswap GPL-2.0-or-later attribution; OpenZeppelin `Math.mulDiv` supplies the 512-bit multiplication primitive under Solidity 0.8.35.

---

### Task 8: Finalize, settle, retry, and cancel epochs atomically

**Files:**

- Modify: `contracts/v3/NoxveilStrategyEngine.sol`
- Modify: `contracts/v3/NoxveilVault.sol`
- Modify: `e2e/noxveil-v3-local.spec.ts`

- [x] **Step 1: Write failing proof/finalization tests**

Cover:

```text
accepts valid Nox proofs for exactly the three stored aggregate handles
rejects malformed proof, swapped proof, stale epoch, changed commitment, and replay
does not consume READY state when Uniswap reverts
lets any signer retry the exact committed action before deadline
settles zero residual internally without Uniswap
settles nonzero residual once and records official amountOut
allocates outputs pro rata in encrypted form and assigns rounding dust exactly
decrements encrypted remaining only after successful settlement
commits encrypted reservations into available balances atomically
releases reservations on permissionless timeout cancellation
never public-decrypts a per-user value during any path
```

- [x] **Step 2: Run and confirm RED**

Run:

```powershell
npm run test:nox:local:v3
```

Expected: new finalization tests fail while earlier Nox cases stay green.

- [x] **Step 3: Implement aggregate proof delivery**

`finalizeAggregate(epochId, directionProof, amountProof, minOutProof)` must public-decrypt the three handles stored in that epoch, validate type/range consistency, recompute the action commitment, persist public residual fields, and transition `LOCKED -> READY`. The direction may be `0/1`; for zero residual it must not influence a swap.

- [x] **Step 4: Implement permissionless atomic settlement**

`settle(epochId)` may be called by any address. It must:

1. check exact status, nonce, deadline, and commitment;
2. transition to `SETTLING` before external calls;
3. execute at most one official residual swap, or none for zero residual;
4. convert public aggregate output to an encrypted public handle;
5. derive each side's encrypted total output exactly: the internally matched opposing-token reserve plus official Uniswap output on the residual-receiving side, and only the internally matched reserve on the other side;
6. compute each user's private pro-rata credit from selected clip handles and encrypted side totals, assigning final dust deterministically so each side reconciles exactly;
7. update vault reservations/balances and strategy remaining handles;
8. grant all persistent ACLs;
9. consume epoch and withdrawal/action nonces once;
10. emit only aggregate receipt fields;
11. transition to `SETTLED`.

A revert at any point rolls the transaction back to `READY`, preserving retryability.

- [x] **Step 5: Implement cancellation**

After deadline, any signer can cancel `OPEN`, `LOCKED`, or `READY` epochs. Release all encrypted reservations and leave strategy remaining unchanged. Cancellation events disclose strategy IDs/owners already public, but no amounts or directions.

- [x] **Step 6: Verify GREEN locally**

Run:

```powershell
npm run test:nox:local:v3
```

Expected: all local Nox state-machine, ACL, netting, finalization, retry, and cancel cases pass.

Verified on 2026-08-01 with 16 passing real local Nox-stack cases, including malformed/swapped proof rejection, rollback to `READY` after adapter revert, permissionless retry, zero-residual internal settlement, exact encrypted pro-rata dust reconciliation, post-success remaining-budget decrement, and permissionless timeout release. The V3 unit suite also remains GREEN.

---

### Task 9: Add an explicit privacy-invariant audit suite

**Files:**

- Create: `test/NoxveilPrivacyInvariantV3.test.mjs`
- Create: `scripts/audit-v3-privacy.mjs`
- Create: `evidence/privacy-invariants-v3.json`

- [x] **Step 1: Write the failing static/runtime audit**

The audit must fail if V3 contains any of these patterns outside test files:

```text
publicDecrypt on a handle whose role is clip/output/balance/remaining/limit/slippage/eligibility/sideTotal
event field named amount, clip, limit, slippage, balance, output, or remaining in a per-user event
public escrowCap or plaintext budget argument
Wallet.createRandom in dapp or production scripts
hardcoded output multiplier
generic delegatecall/call executor
slot0 used as the TWAP reference
```

It must parse a sample `createStrategy` calldata encoding and assert that known plaintext budget/clip/limit values do not occur as 32-byte ABI words.

- [x] **Step 2: Run and confirm RED**

Run:

```powershell
node --test test/NoxveilPrivacyInvariantV3.test.mjs
```

Expected: FAIL until V3 contracts and scripts follow the allowlist.

- [x] **Step 3: Implement allowlist-based audit output**

`scripts/audit-v3-privacy.mjs` writes `evidence/privacy-invariants-v3.json` with:

```json
{
  "status": "pass",
  "privateFields": ["direction", "remaining", "clip", "limit", "slippage", "balances", "allocations"],
  "publicDecryptFields": ["residualDirection", "residualAmount", "aggregateMinOut"],
  "viewerOnlyAggregates": ["totalRequestedQuote", "matchedQuote"],
  "publicBoundary": ["addresses", "epochTiming", "participantCount", "deposits", "withdrawals", "residualSettlement"],
  "violations": []
}
```

The script exits nonzero for any violation and never overwrites a prior passing file with a failing result.

- [x] **Step 4: Verify GREEN**

Run:

```powershell
node --test test/NoxveilPrivacyInvariantV3.test.mjs
node scripts/audit-v3-privacy.mjs
```

Expected: pass JSON with zero violations.

Verified on 2026-08-01: all 3 audit tests pass, the calldata fixture contains no plaintext economic ABI words, the forced-failure path preserves prior passing evidence, and `evidence/privacy-invariants-v3.json` records zero violations.

---

### Task 10: Deploy V3 against official Sepolia dependencies

**Files:**

- Create: `scripts/verify-v3-sepolia-dependencies.mjs`
- Create: `scripts/deploy-noxveil-v3-sepolia.mjs`
- Create: `dapp/v3-deployment.json`
- Create: `evidence/v3-sepolia-dependencies.json`
- Modify: `package.json`

- [x] **Step 1: Write the dependency verifier first**

The read-only verifier must query the configured RPC and assert:

- chain ID equals `11155111`;
- code exists for NoxCompute, WETH, USDC, factory, SwapRouter02, and factory-resolved pool;
- token `symbol`, `decimals`, and pool `token0`, `token1`, `fee` match expected values;
- `factory.getPool(WETH, USDC, 500)` equals the chosen pool;
- pool liquidity is nonzero;
- `observe([twapWindow, 0])` succeeds;
- deployer has enough ETH for deployment, without printing the private key or full RPC URL.

- [x] **Step 2: Run verifier and stop on any mismatch**

Run with secrets supplied only in the shell environment:

```powershell
npm run verify:v3:sepolia
```

Expected: `evidence/v3-sepolia-dependencies.json` records block number, code hashes, resolved addresses, token metadata, fee, liquidity, and observation result. If any check fails, do not deploy and do not write `dapp/v3-deployment.json`.

- [x] **Step 3: Implement deterministic deployment order**

Add scripts:

```json
"verify:v3:sepolia": "node scripts/verify-v3-sepolia-dependencies.mjs",
"deploy:v3:sepolia": "npm run build && npm run verify:v3:sepolia && node scripts/deploy-noxveil-v3-sepolia.mjs"
```

Deploy in this order: bootstrap vault, adapter with the vault as immutable controller/recipient, then engine with immutable vault and adapter references. Because the vault cannot know the later CREATE addresses safely without a separate CREATE2 design, expose one-time `setAdapter` and `setEngine` bootstrap calls. Each accepts only a code-bearing contract whose immutable reverse getters point back to the vault and official dependencies. Permanently close and renounce the bootstrap role after both bindings; neither target can ever be replaced.

- [x] **Step 4: Write deployment artifact only after post-deploy checks**

Verify bytecode and every immutable/config getter, then write:

```json
{
  "version": "3",
  "chainId": 11155111,
  "noxCompute": "...",
  "weth": "...",
  "usdc": "...",
  "uniswapFactory": "...",
  "uniswapPool": "...",
  "swapRouter02": "...",
  "fee": 500,
  "twapWindow": 300,
  "maxDeviationBps": 100,
  "vault": "...",
  "engine": "...",
  "adapter": "...",
  "deploymentTxs": { "vault": "...", "engine": "...", "adapter": "...", "bindEngine": "..." },
  "verifiedAtBlock": 0
}
```

Never put RPC URLs or private keys in the artifact.

- [x] **Step 5: Run deployment**

Run:

```powershell
npm run deploy:v3:sepolia
```

Expected: all deployment/binding receipts have status 1 and the artifact is written only after getter/code verification.

Verified on 2026-08-01: the dependency verifier passed against Sepolia, then vault, adapter, and engine deployed and were bound in the planned order. All six deployment/binding receipts have status 1, bootstrap was permanently closed, and `dapp/v3-deployment.json` plus `evidence/v3-sepolia-deployment.json` were written after code/getter checks at block 11391894.

---

### Task 11: Prove a real multi-wallet Sepolia epoch end to end

**Files:**

- Create: `e2e/noxveil-v3-sepolia.spec.ts`
- Create: `scripts/fund-v3-e2e-users.mjs`
- Create: `evidence/sepolia-e2e-v3.json`

- [x] **Step 1: Write the gated E2E test**

Require all of:

```text
RUN_SEPOLIA_V3_E2E=1
SEPOLIA_RPC_URL
V3_KEEPER_PRIVATE_KEY
V3_WETH_SELLER_PRIVATE_KEY
V3_USDC_SELLER_PRIVATE_KEY
```

Never generate wallets inside the test. Before spending, print only addresses, balances, required amounts, chain, and contract destinations; never print keys. Abort if any wallet is unfunded rather than silently funding it. The separate funding script is an explicit operator action and records transaction hashes.

- [x] **Step 2: Create the failing E2E assertions**

The test must:

1. re-run official dependency verification;
2. wrap test ETH into official WETH for the WETH seller and obtain official test USDC for the other seller through a pre-approved, recorded setup path;
3. approve and deposit into the real V3 vault;
4. encrypt two opposing strategies with each user's Nox handle client before sending calldata;
5. create strategies and prove raw calldata omits known plaintext fields;
6. lock an epoch permissionlessly;
7. public-decrypt exactly three aggregate handles;
8. use a participating owner's viewer ACL—not public decryption—to prove the private requested and internally matched quote volumes are nonzero, and prove the public residual is smaller than the privately revealed requested total;
9. finalize aggregate proof and settle through official SwapRouter02 if residual is nonzero;
10. owner-decrypt each output balance and remaining budget;
11. prove an unrelated keeper cannot privately decrypt either user's fields;
12. prove epoch/action replay reverts;
13. record transaction hashes and before/after balances.

- [x] **Step 3: Run once and expect an actionable failure**

Run:

```powershell
npm run test:sepolia:v3
```

Expected on the first run: a precise missing-balance/setup error or a failing incomplete contract path. Do not relax assertions.

Verified on 2026-08-01: the gated runner exits with the precise missing `SEPOLIA_RPC_URL` precondition when secrets are absent. After explicit operator confirmation, the funding script recorded five successful setup receipts and the funded multi-wallet E2E passed on Sepolia.

- [x] **Step 4: Complete the real flow and write evidence atomically**

Only after every assertion passes, write `evidence/sepolia-e2e-v3.json` using a temporary file followed by rename. Include:

```json
{
  "status": "pass",
  "chainId": 11155111,
  "addresses": {},
  "users": [],
  "epochId": "...",
  "handles": {
    "publiclyDecrypted": ["residualDirection", "residualAmount", "aggregateMinOut"],
    "keptPrivate": ["clips", "limits", "slippage", "remaining", "balances", "allocations"]
  },
  "transactions": {},
  "uniswap": { "pool": "...", "router": "...", "settlementTx": "..." },
  "privacySavings": {
    "disclosure": "authorized participant E2E disclosure; not public Nox decryption",
    "requestedQuoteWad": "...",
    "matchedQuoteWad": "...",
    "netResidualQuoteWad": "...",
    "settlementResidualQuoteWad": "...",
    "roundingDustQuoteWad": "..."
  },
  "verifiedAtBlock": 0
}
```

Do not call the E2E complete if the official settlement transaction reverted, the output owner-decryption failed, or unauthorized decryption was not tested.

Verified on 2026-08-01: epoch `0x68984849f6fcfb04e1772dcdb1352d93d1f6569d034b9f8632fa9cd9cc375802` settled through the official pool in transaction `0xb7f3d0129bafd9eb2e3a9210f54d2a1bdca4844b3c3768d81b54e9863adb125a`. All five E2E receipts have status 1; the official pool emitted a settlement log; owners decrypted outputs and remaining balances; unauthorized and replay checks failed as required. The evidence verifier reconciles private two-sided requested volume as `2 * matched + net residual` and records the 9,064 quote-WAD atomic conversion dust separately.

---

### Task 12: Upgrade the dApp from instant demo to Noxveil strategy product

**Files:**

- Modify: `dapp/index.html`
- Modify: `dapp/styles.css`
- Modify: `dapp/app.js`
- Modify: `dapp/nox-browser.js`
- Create: `dapp/v3-chain.js`
- Create: `dapp/v3-privacy.js`
- Create: `test/dapp-ui-v3.test.mjs`

- [x] **Step 1: Write failing DOM/static tests**

Assert the UI contains:

```text
Instant and Stealth DCA modes
deposit boundary disclosure before approval
private controls for budget, clip, limit, and slippage
owner-only Reveal private state action
epoch pulse with status and participant count
privacy savings with private requested, internally matched, and public residual values
Chain View with Nox and official Uniswap transaction links
Privacy Receipt with hidden/public field lists
one primary action with a progress modal
no demo wallet filler, no BOIN/BOOUT, no VeilSwap label, no fake success message
```

- [x] **Step 2: Run and confirm RED**

Run:

```powershell
node --test test/dapp-ui-v3.test.mjs
```

Expected: FAIL because the existing page is a V2 BOIN/BOOUT swap.

- [x] **Step 3: Separate chain, privacy, and presentation logic**

- `v3-chain.js`: provider discovery, connection persistence, contract reads/writes, receipt polling, Etherscan links.
- `v3-privacy.js`: Nox client initialization, typed strategy encryption, owner decryption, handle/ACL display.
- `app.js`: state reducer, form validation, step orchestration, and rendering only.

Keep EIP-6963 wallet discovery and restored connection. Never place the RPC key in browser source; use the wallet provider for writes and a public read provider only if explicitly configured outside source control.

- [x] **Step 4: Implement the two product modes**

- Instant: creates a one-clip strategy and follows the same V3 contracts; it is not a special plaintext route.
- Stealth DCA: encrypted total budget, clip, limit, and slippage persist across epochs.

The token pair is fixed to official WETH/USDC in the MVP, so token dropdowns are unnecessary. Deposit/withdraw panels state that ordinary ERC-20 transfer amounts are public.

- [x] **Step 5: Implement one-click orchestration**

The primary action opens a progress modal. Current step gets an animated red/coral border; completed steps get green ticks; future steps get neutral spinners. Required wallet confirmations open automatically for:

```text
Connect -> Approve (if needed) -> Deposit (if needed) -> Nox encrypt -> Create strategy
```

Epoch execution is permissionless but asynchronous. If an epoch is not ready, the modal closes into a strategy receipt rather than pretending settlement finished. A separate `Advance epoch` action may perform:

```text
Lock -> wait for Nox public proofs -> finalize aggregate -> settle official Uniswap residual
```

Do not freeze indefinitely: every wait has elapsed time, retry, and safe-close behavior.

- [x] **Step 6: Implement owner reveal and privacy receipt**

Owner reveal calls `decrypt()` for their handles and displays budget remaining, next clip, private limit, slippage, and confidential token balances. A participating owner may also sign to reveal the viewer-only epoch totals (`totalRequestedQuote` and `matchedQuote`) for the privacy-savings panel; an observer sees these as locked. Chain View separately shows the three publicly disclosed aggregate values, all V3 transactions, and the official pool/router addresses. Unauthorized errors are explained rather than converted into zeroes.

- [ ] **Step 7: Verify static and browser behavior**

Run:

```powershell
node --test test/dapp-ui-v3.test.mjs
node --check dapp/app.js
node --check dapp/v3-chain.js
node --check dapp/v3-privacy.js
npm run dapp
```

Then open `http://localhost:5173`, connect a real browser wallet, refresh, verify the shortened address persists, open the disconnect popover, and exercise the V3 read path. Static checks do not count as extension-popup proof.

Browser-smoke subset verified on 2026-08-01 with visible Chromium: the page and DCA controls load, the wallet chooser opens and closes with Escape, desktop/mobile have zero horizontal overflow, the primary touch target is 52px, and no page/console errors were recorded. Evidence is in `evidence/ui-v3-browser.json` and the two UI screenshots. This step intentionally remains unchecked until the real MetaMask/Rabby popup, persisted refresh session, disconnect popover, and wallet-backed V3 read path are exercised.

---

### Task 13: Add browser E2E for UX state, without automating secret wallet approval

**Files:**

- Create: `test/browser/noxveil-v3-ui.spec.mjs`
- Create: `playwright.config.mjs`
- Modify: `package.json`

- [x] **Step 1: Write failing browser tests with an injected test provider**

Test:

```text
loads V3 deployment and shows official WETH/USDC
restores a previously authorized EIP-6963 wallet label after refresh
percentage buttons update the visible deposit/clip amount correctly
Instant mode creates one clip; Stealth DCA exposes all encrypted fields
progress modal highlights exactly the active step
failure keeps the failed step visible with retry
strategy-created receipt never says swap completed
settled receipt links the actual official Uniswap transaction
disconnect clears persisted authorization and private revealed values
```

- [x] **Step 2: Run and confirm RED**

Run:

```powershell
npm run test:browser:v3
```

Expected: FAIL until browser config and UI behavior exist.

- [x] **Step 3: Implement deterministic injected-provider fixtures**

The fixture may simulate EIP-1193 responses for UI state only. Label its evidence `simulated provider UI test`; it cannot replace the manual MetaMask popup check or Sepolia E2E.

- [x] **Step 4: Verify GREEN**

Run:

```powershell
npm run test:browser:v3
```

Expected: all UI state transitions pass headlessly.

Verified on 2026-08-01: 10/10 Playwright cases pass against a Playwright-owned port 4173 server. Coverage includes the nine required UI behaviors plus a runtime security test for the localhost/query/marker triple guard. The reconnect case uses a second EIP-6963 provider and verifies new-provider `accountsChanged` and `chainChanged` listeners. Evidence is explicitly labeled `simulated provider UI test`; it is not wallet-extension, real-Nox, or Sepolia proof.

---

### Task 14: Replace submission claims with falsifiable V3 evidence

**Files:**

- Modify: `README.md`
- Modify: `SUBMISSION.md`
- Modify: `demo-script.md`
- Modify: `dapp/project.json`
- Create: `SECURITY.md`
- Create: `PRIVACY.md`
- Create: `evidence/README.md`

- [x] **Step 1: Write a claim audit before editing prose**

Search:

```powershell
rg -n -i "production.ready|fully private|anonymous|completed|official|real Nox|Uniswap" README.md SUBMISSION.md demo-script.md dapp/project.json
```

For every strong claim, identify a local-Nox log, Sepolia receipt, dependency code hash, owner-decryption proof, unauthorized-decryption failure, or UI browser check. Remove or qualify claims without evidence.

- [x] **Step 2: Document why Nox is essential**

The first screen and submission must explain four irreplaceable jobs:

1. persistent private strategy state across epochs;
2. encrypted balance sufficiency and clip eligibility;
3. confidential opposing-flow netting;
4. private post-settlement balance/remaining-budget allocation.

Also explain the measurable result: requested private volume, internally offset volume, and residual official-Uniswap volume.

- [x] **Step 3: Document exact limitations**

State plainly:

- ordinary ERC-20 deposit/withdraw transfers are public;
- user addresses and strategy lifecycle timing are public;
- aggregate residual and minimum output are public;
- TEE/Nox trust assumptions apply;
- MVP supports one pair, one fee tier, eight strategies, fixed cadence, and Sepolia;
- no anonymity or mainnet-audit claim is made.

- [x] **Step 4: Update the demo script**

The demo must show:

```text
official dependency panel -> two encrypted strategies -> owner/private ACL -> epoch lock ->
three aggregate decryptions only -> internally matched volume -> residual Uniswap tx ->
owner decrypts confidential outputs/remaining -> unauthorized decrypt fails -> privacy receipt
```

Do not demonstrate the old BOIN/BOOUT pool as V3 proof.

- [x] **Step 5: Verify documentation links**

Every contract/transaction link in the submission must be derived from `dapp/v3-deployment.json` or `evidence/sepolia-e2e-v3.json`, not copied by hand.

Verified on 2026-08-01: the V3 claim audit removed stale V1/V2 product evidence, every judge-facing surface names all four load-bearing Nox jobs and exact limitations, the first screen visibly presents the four jobs, and the timed demo follows the evidence sequence. `scripts/render-v3-doc-links.mjs` derives the single allowed explorer-link block from the deployment artifact, rejects duplicate/unmatched markers and explorer links outside it, and `npm run docs:check:v3` is current. Documentation tests pass 13/13. Real multi-wallet Sepolia and extension-wallet proof remain explicitly pending rather than being claimed.

---

### Task 15: Final regression and submission-readiness gate

**Files:**

- Modify only files required to fix failures found by this gate.

- [x] **Step 1: Run compile and all legacy/V3 unit tests**

Run:

```powershell
npm run build
npm test
npm run test:unit:v3
node --test test/NoxveilPrivacyInvariantV3.test.mjs
```

Expected: all V2 regression tests and V3 deterministic/privacy tests pass.

Verified on 2026-08-01 after the final secret/demo-server fixes: build and `tsc --noEmit` exited 0; legacy/V3 contract regression passed 32/32; V3 unit/static/docs/security tests passed 49/49; and privacy invariants passed 3/3. The security scan includes `package-lock.json`, generated evidence, and NUL-adjacent byte content. The V2 demo helper is import-safe, does not recover keys from transcripts, and uses reviewed endpoint-specific timeouts.

- [x] **Step 2: Run real local Nox integration in WSL**

Run:

```powershell
npm run test:nox:local:v3
```

Expected: official plugin boots Nox services through native WSL Docker Engine and every Nox ACL/encrypted-state test passes.

Verified again on 2026-08-01 after the TypeScript cleanup: the official local Nox stack booted through the WSL runner and all 16 encrypted-state, proof, and ACL integration assertions passed. The cleanup changed only erased TypeScript contract connection casts and did not alter runtime behavior.

- [x] **Step 3: Re-verify live Sepolia state**

Run:

```powershell
npm run verify:v3:sepolia
npm run test:sepolia:v3
```

Expected: live code/config/liquidity checks pass and the real multi-wallet epoch settles successfully. Old successful receipts do not substitute for a current verification if deployment state changed.

Verified on 2026-08-01: live dependency/code/config/liquidity checks pass, funding receipts pass, and the real two-owner epoch settled through official Uniswap. `npm run verify:e2e:v3` independently re-read all receipts, the settled epoch, the official pool log, the three-field public-decryption allowlist, and the privacy-savings arithmetic before atomically reconciling the artifact.

- [ ] **Step 4: Run browser tests and manual wallet smoke**

Run:

```powershell
npm run test:browser:v3
npm run dapp
```

Manually verify MetaMask/Rabby chooser, account persistence after refresh, signature/transaction prompts, disconnect, owner decrypt, epoch advancement, actual transaction links, and error recovery.

Current boundary on 2026-08-01: the deterministic browser suite passes 10/10 and a visible Chromium smoke has no layout or console errors. These are simulated-provider/browser checks only; a real extension popup, signature, transaction, owner decrypt, and recovery smoke is still required, so this step remains open.

- [x] **Step 5: Inspect evidence consistency**

Cross-check that:

- deployment addresses in the dApp, docs, and evidence match;
- every listed transaction has receipt status 1;
- the pool was factory-resolved and official;
- exactly three aggregate handles were public-decrypted;
- individual fields remain decryptable only by authorized owners/engine;
- privacy-savings arithmetic reconciles;
- no secret appears in tracked/output files.

Verified on 2026-08-01: deployment/E2E addresses match; all listed E2E receipts have status 1; the settlement receipt includes the configured factory-resolved official pool; the public-decryption list is exactly three fields; owner and unauthorized ACL outcomes pass; rounding is explicitly reconciled; and the full workspace secret scan found no known token digest or hardcoded Infura v3 URL.

- [ ] **Step 6: Declare readiness honestly**

Only declare Noxveil V3 submission-ready when all five gates are green: compile/unit, local official Nox, live official-dependency verification, real Sepolia E2E, and real browser-wallet smoke. If any gate is missing, report it separately as a remaining gap rather than using the word complete.

---

## Final acceptance matrix

| Requirement | Required proof |
|---|---|
| Nox encrypts before calldata | Raw transaction calldata inspection plus handle SDK logs |
| Private values persist across epochs | Local Nox and Sepolia owner decrypt after multiple transactions |
| Unauthorized users cannot read | Explicit failed decrypt from unrelated signer |
| Opposing flow is truly offset | Encrypted side aggregation plus public requested/matched/residual reconciliation |
| Only aggregate is disclosed | Privacy invariant audit and exactly three public decryption proofs |
| Official Uniswap is used unchanged | Factory-resolved pool, code hashes, SwapRouter02 receipt, pool balance/event delta |
| Keeper is permissionless | Lock/finalize/settle called by a signer that is not owner or deployer |
| Failure is recoverable | Retry after failed settlement and timeout cancellation tests |
| Outputs remain confidential | Owner decrypts vault output handle; no per-user ERC-20 payout event |
| UI tells the truth | Strategy-created vs epoch-settled receipts are distinct |
| No demo backdoor | Static audit finds no generated/funded product wallets or privileged settle path |

## Official references used to lock this plan

- Nox Hardhat plugin guide: `https://docs.noxprotocol.io/guides/build-confidential-smart-contracts/hardhat`
- Nox private input guide: `https://docs.noxprotocol.io/guides/accept-user-inputs`
- Nox handle persistence/ACL guide: `https://docs.noxprotocol.io/guides/manage-handle-access/transient-access`
- Nox confidential strategy use case: `https://docs.noxprotocol.io/getting-started/use-cases/confidential-vault-encrypted-strategy`
- Nox confidential position use case: `https://docs.noxprotocol.io/getting-started/use-cases/confidential-vault`
- Nox protocol package currently pinned in this project: `@iexec-nox/nox-protocol-contracts@0.2.4`
- Nox Hardhat plugin version verified on npm on 2026-08-01: `@iexec-nox/nox-hardhat-plugin@0.2.0`
