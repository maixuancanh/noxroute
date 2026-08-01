# Noxveil V3 — Confidential DCA/TWAP Vault

Date: 2026-08-01  
Status: Proposed for user review  
Target network: Ethereum Sepolia  
Underlying protocol: official Uniswap V3, unmodified

## 1. Product decision

Noxveil V3 is a confidential recurring-execution vault for Uniswap V3. A user
creates a persistent swap strategy whose budget, clip size, price bound and
remaining balance stay encrypted. At fixed public epochs, Nox privately checks
which strategies are eligible, offsets opposing clips at the public epoch TWAP,
and reveals only the net residual required for Uniswap settlement.

The existing one-click swap remains available as an "Instant" strategy with one
clip. The differentiating product is "Stealth DCA", which executes a private
strategy across multiple epochs without exposing its total budget or future
orders.

This is deliberately different from a one-epoch dark pool. Noxveil protects a
long-lived execution strategy, not only a single order.

### Competitive differentiation

Current confidential-swap submissions mainly protect one batch or one treasury
trade. Noxveil's defining state is persistent across epochs: private remaining
budget, private clip size, private price bound and private execution progress.
The recurring strategy would become predictable if those values were replaced
with public storage, so the DCA product itself depends on Nox.

The implementation will be written independently. It may use public standards
and official dependencies such as Nox, ERC-7984, OpenZeppelin and Uniswap, but it
will not copy competitor contracts, UI code, names or submission text.

## 2. User problem and measurable value

Public DCA/TWAP contracts reveal total budget, per-interval order size, price
threshold, remaining duration and future execution timing. Bots can predict the
next trades, copy the strategy or move price against it.

Noxveil must produce four measurable outcomes:

1. The user's total budget, clip size, price bound and remaining amount never
   appear as plaintext calldata, storage or events.
2. Opposing eligible flow is crossed internally; only the aggregate residual
   reaches Uniswap.
3. User output and remaining strategy balance return to an encrypted internal
   ledger rather than being transferred publicly after every execution.
4. The UI shows the percentage of requested volume hidden inside the aggregate,
   the public residual transaction and an observer-mode privacy audit.

Without Nox, the contract cannot privately decide eligibility, debit a hidden
balance, update hidden remaining state or allocate aggregate output. Nox is
therefore load-bearing rather than an encryption wrapper around an otherwise
public swap.

## 3. Privacy boundary

### Hidden with Nox

- Strategy total budget.
- Per-epoch clip size.
- User price ceiling/floor.
- User slippage preference within the supported range.
- Remaining unexecuted amount.
- Per-user epoch debit and output allocation.
- Confidential vault balances.
- Completion state derived from encrypted remaining balance.

### Intentionally public

- Strategy owner address and creation transaction.
- Selected public pair contract.
- Public epoch number and lock/settlement timestamps.
- Number of submitted strategies or participants in an epoch.
- Aggregate residual amount and direction sent to Uniswap.
- Aggregate Uniswap minimum output and final Uniswap output.
- Official Uniswap router, pool and transaction receipt.
- Deposit and withdrawal transfers of ordinary ERC-20 tokens.

Depositing arbitrary ERC-20 amounts leaks the deposit amount. The MVP reduces
linkability with recommended fixed-denomination deposits and lets withdrawals
target a fresh address. It does not claim sender anonymity. Future ERC-7984
wrapping can make transfers between confidential accounts private, but it does
not make the original ERC-20 wrap or final unwrap invisible.

## 4. MVP scope

### Included

- WETH/USDC on Ethereum Sepolia.
- Official Uniswap V3 SwapRouter02 and existing WETH/USDC pool.
- Two public execution modes: Instant and Stealth DCA.
- Encrypted direction, budget, clip, price bound and remaining amount.
- Fixed global epoch cadence.
- Up to eight active strategies processed per epoch.
- Permissionless epoch locking, finalization and settlement.
- Confidential internal balances for both assets.
- Fixed-denomination deposit shortcuts and fresh-address withdrawals.
- Owner-only balance and strategy decryption in the browser.
- Optional scoped viewer access for one strategy as a stretch feature.
- Chain View and a final Privacy Receipt.

### Explicitly excluded

- Arbitrary token pairs.
- Cross-chain routing.
- A solver auction.
- Account abstraction or gas sponsorship.
- A full central-limit-order book.
- Claims of sender or timing anonymity.
- Mainnet deployment.

These exclusions keep the hackathon implementation small enough to complete and
verify end to end.

## 5. Contract architecture

### `NoxveilVault`

Custodies ordinary WETH and USDC while storing each user's entitlement as Nox
encrypted balances.

Responsibilities:

- Accept deposits and add public deposit amounts to encrypted balances.
- Authorize the strategy engine to debit and credit encrypted balances.
- Support owner-authorized confidential transfers inside the vault.
- Support full-token-balance withdrawal requests to a committed destination.
- Publicly decrypt only that full balance when ordinary ERC-20 finalization is
  unavoidable. Partial private exits can first use an internal confidential
  transfer to a fresh self-controlled address, then withdraw that address's
  full balance.

The vault never transfers per-epoch swap output directly to users.

### `NoxveilStrategyEngine`

Owns strategy state and epoch state.

Encrypted strategy fields:

- Direction.
- Remaining input.
- Clip amount.
- Limit price.
- User slippage bound.

Public strategy fields:

- Owner.
- Pair ID.
- Creation epoch.
- Cancellation flag.
- Replay-protection nonce.

Responsibilities:

- Validate Nox external handles and proofs.
- Grant persistent access with `Nox.allowThis` where state survives a
  transaction.
- Check encrypted balance sufficiency without reverting on a private condition.
- At lock time, evaluate eligibility against a public reference price.
- Use `Nox.select` to contribute either the private clip or encrypted zero.
- Aggregate eligible clips per direction, normalize them at the public epoch
  TWAP and offset opposing flow in the encrypted domain.
- Expose only the residual amount, residual direction and aggregate settlement
  minimum handles for public decryption.
- Update encrypted remaining values and private ledger allocations after
  settlement.

### `NoxveilUniswapAdapter`

A narrow, immutable adapter to official Uniswap V3.

Responsibilities:

- Accept calls only from the strategy engine.
- Restrict execution to the configured WETH/USDC pair and fee tier.
- Read and sanity-check the pool reference price.
- Execute `exactInputSingle` with the verified aggregate amount and minimum
  output.
- Return actual output to the strategy engine.
- Reset token approvals after execution.

The adapter controller is locked after deployment.

### Permissionless keeper

Any address may advance an eligible epoch. The keeper provides liveness but has
no authority to choose amounts, users, pair or route. Every plaintext aggregate
must carry a Nox public-decryption proof verified on-chain.

The reference keeper can run as a script or scheduled job, but the dApp also
exposes the same permissionless actions for judge testing. No production flow
depends on a local deployer private key or fake participant wallets.

## 6. Epoch state machine

```text
OPEN
  -> LOCKED              aggregate handles created; strategy set frozen
  -> PROOF_READY         aggregate decrypt proofs accepted
  -> SETTLING            exact action commitment consumed
  -> SETTLED             Uniswap result allocated to encrypted balances

LOCKED / PROOF_READY
  -> RETRYABLE           gateway or swap timeout; same commitment may retry
  -> CANCELLED           after deadline; encrypted debits restored
```

Only one transition may consume an epoch commitment. The commitment binds:

- Chain ID.
- Noxveil engine and adapter addresses.
- Epoch ID.
- Pair and direction.
- Reference price observation.
- Aggregate input handle.
- Aggregate minimum-output handle or derived bound.
- Uniswap router and pool fee.
- Nonce and deadline.

Changing any field invalidates the settlement proof.

## 7. Confidential computation

For each strategy in an epoch:

1. Convert public epoch price into a Nox value.
2. Compare it with the encrypted limit price.
3. Compare encrypted remaining balance with encrypted clip size.
4. Derive `eligible` using encrypted boolean operations.
5. Select `min(remaining, clip)` when eligible, otherwise encrypted zero.
6. Add the selected clip to the encrypted aggregate for its direction.
7. Compute each encrypted minimum-output contribution from the clip, TWAP and
   encrypted user slippage bound.
8. Offset opposing direction totals at TWAP and derive the encrypted residual.
9. Preserve each selected clip handle for private post-settlement allocation.

Only the residual amount, residual direction and aggregate settlement minimum
are made publicly decryptable. Individual clips, side totals, limits,
eligibility flags and matched allocations remain private.

After a successful Uniswap execution, the engine computes each private output
pro rata from its encrypted clip and the public aggregate result. It subtracts
the encrypted debit from remaining strategy state and credits the encrypted
vault balance.

The production implementation must not public-decrypt per-user debit, output,
remaining amount or completion status.

## 8. Price and slippage rules

- The adapter reads a time-weighted average price from the official Uniswap V3
  pool `observe` history at epoch lock; raw `slot0` spot price is not sufficient.
- The implementation normalizes WETH and USDC decimals before comparisons.
- A minimum TWAP observation window and spot-deviation guard protect against
  stale or manipulated observations.
- A protocol-wide hard slippage ceiling protects the interval between lock and
  settlement.
- Each encrypted user limit determines eligibility at lock. Each encrypted
  slippage bound contributes to an encrypted aggregate minimum-output value;
  only that aggregate bound is publicly decrypted for settlement.
- If the pool price moves beyond the public hard ceiling, settlement reverts and
  the epoch becomes retryable or cancellable without exposing which user limit
  failed.

## 9. User flows

### Create Stealth DCA

1. Connect a standard EIP-1193 wallet.
2. Deposit WETH or USDC, with fixed-denomination presets recommended.
3. Choose direction, total budget, clip size and private price bound.
4. Encrypt all sensitive fields in the browser with the Nox handle SDK.
5. Submit handles and proofs with a strategy nonce and deadline.
6. Show a privacy receipt containing handles, transaction hashes and the exact
   public/private boundary.

### Execute epoch

1. Anyone locks the next public epoch.
2. Nox evaluates active strategies and creates aggregate handles.
3. A permissionless keeper obtains public decrypt proofs for aggregates.
4. The contract verifies proofs and the exact action commitment.
5. Opposing eligible flow settles internally at TWAP; the adapter performs at
   most one residual Uniswap swap for the epoch.
6. Output and remaining state are credited privately.

### View private state

The owner signs a gasless EIP-712 data-access request in the browser and decrypts
their own balance, remaining budget and execution summary. Plaintext is never
written back to a server or contract.

### Cancel and withdraw

The user may cancel future clips. Unspent encrypted strategy balance returns to
their encrypted vault balance. The MVP withdrawal exits one token's full vault
balance to a committed destination, with a fresh-address recommendation; the
final ERC-20 amount is correctly disclosed as a privacy boundary. Full-balance
withdrawal avoids disclosing a second encrypted balance-sufficiency predicate.

## 10. UI design

The current Orbiter-inspired shell remains. The swap card gains a compact
execution selector:

- `Instant`: one encrypted clip.
- `Stealth DCA`: recurring encrypted strategy.

The Stealth DCA form contains total budget, clip size and private limit price.
Sensitive values receive a lock indicator and a short explanation of why Nox is
needed.

Additional product surfaces:

- `My private strategy`: owner-only decrypted state.
- `Epoch pulse`: current public epoch, participant count and keeper state.
- `Privacy savings`: total private requested volume, internally offset volume
  and residual AMM volume, without revealing per-user contributions.
- `Chain View`: observer-only rendering built from Sepolia calls and logs.
- `Privacy Receipt`: Nox handles/proofs, engine transactions, official Uniswap
  receipt and hidden/public field matrix.

The primary flow remains one action at a time. MetaMask opens only for required
signatures or transactions, and the existing progress modal reports every
asynchronous Nox and settlement phase.

## 11. Failure handling

- Invalid or reused handles: reject before storing strategy state.
- Private insufficient balance: select zero without a distinguishable revert;
  expose a generic owner-only status after decryption.
- Stale price: do not lock the epoch.
- Nox proof unavailable: keep epoch locked and retryable until deadline.
- Malformed or replayed proof: reject without consuming the epoch commitment.
- Uniswap revert or insufficient output: restore the pre-settlement state and
  leave the epoch retryable.
- Keeper offline: any wallet can continue the epoch.
- Deadline exceeded: permissionless cancellation restores private debits.
- Withdrawal failure: retain encrypted entitlement and allow retry.

No error message may reveal which private strategy caused an aggregate to be
zero or ineligible.

## 12. Security requirements

- Checks-effects-interactions and reentrancy protection around all token calls.
- Safe ERC-20 transfer and approval handling.
- Immutable official protocol endpoints and locked adapter controller.
- Per-strategy and per-epoch nonces.
- One-time commitment consumption.
- Nox ACL tests for owner, engine, adapter, optional auditor and unauthorized
  viewer.
- No per-user amount, output, limit or balance in events.
- Cancel paths for all asynchronous Nox states.
- Maximum strategies per epoch and bounded loops.
- Explicit treatment of fee-on-transfer and rebasing tokens as unsupported.

## 13. Verification plan

### Local Nox stack

Run through WSL with the official Nox Hardhat stack. Required tests include:

- Deposit and encrypted-balance credit.
- Strategy creation with real external handle proofs.
- Eligible and ineligible private limit cases.
- Encrypted insufficient-balance behavior without a private-data revert.
- Multiple strategies aggregated into one epoch.
- Opposing strategy clips offset internally and reduce public AMM volume.
- Instant strategy as a one-clip special case.
- Successful aggregate settlement and private output allocation.
- Retry after gateway delay and Uniswap price movement.
- Cancellation and encrypted refund.
- Proof replay, commitment mutation and unauthorized ACL attempts.
- Static event/calldata assertions that forbid per-user plaintext fields.

### Ethereum Sepolia E2E

The recorded E2E must use no mock chain data:

1. Deploy the new vault, engine and locked adapter.
2. Use official Sepolia WETH, USDC, NoxCompute, SwapRouter02 and pool.
3. Create at least two real encrypted strategies from separate wallets.
4. Lock an epoch and public-decrypt only residual direction, residual amount and
   aggregate settlement minimum.
5. Settle through official Uniswap V3.
6. Let each owner decrypt only their own result and remaining state.
7. Prove an unauthorized wallet cannot decrypt either strategy.
8. Query logs as an observer and show that private fields cannot be recovered.
9. Save all addresses, transaction hashes and balance deltas in a machine-readable
   deployment artifact and the submission README.

## 14. Migration from the current V2

- Keep V2 contracts and transaction evidence unchanged for historical proof.
- Add V3 contracts in a separate `contracts/v3/` boundary.
- Deploy a new Sepolia stack; do not upgrade or mutate the V2 router.
- Replace BOIN/BOOUT demo routing in the production UI with WETH/USDC.
- Remove all local demo-fill and demo-finalize dependencies from the product
  flow.
- Preserve the existing wallet chooser, visual system and progress-modal UX.
- Update project metadata, README, demo script and submission claims only after
  the V3 Sepolia E2E succeeds.

## 15. Acceptance criteria

Noxveil V3 is ready to submit only when all of the following are true:

- A new user can create an Instant or Stealth DCA strategy with a standard
  wallet.
- Sensitive fields are encrypted before calldata.
- Nox privately determines eligibility and clip amount.
- Per-user inputs and outputs are never publicly decrypted.
- Only net residual settlement values reach official Uniswap V3.
- Owner-only state decryption works in the browser.
- The flow has no fake users, mock protocol, embedded private key or mandatory
  local helper.
- An independent judge can advance or recover an epoch permissionlessly.
- Chain View makes every privacy claim falsifiable.
- Local tests, frontend build and a fresh Sepolia E2E all pass.
