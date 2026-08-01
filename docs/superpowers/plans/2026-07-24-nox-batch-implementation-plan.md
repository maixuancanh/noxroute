# NoxBatch Implementation Plan

## Goal

Build an isolated local vertical slice for a Nox-powered fixed-pair batch swap coordinator.

The protocol keeps each user's desired input amount and minimum output as opaque Nox handles, waits for exactly three users in one epoch, asks a Nox evaluator to compute the aggregate executable swap and per-user allocations, then settles through a single public router call.

## Implemented scope

- Exactly three immutable users for the MVP epoch cohort.
- One immutable token pair and router endpoint.
- One active epoch at a time with permanent epoch ID reuse protection.
- Opaque amount/min-output handles with global handle reuse protection.
- Public escrow caps to bound settlement without revealing exact intended amounts.
- Asynchronous request lifecycle with request ID and epoch correlation.
- Failed evaluator attempts consume retries and permit terminal cancellation after three timed-out attempts.
- Aggregate router settlement with output distribution and unused escrow refunds.
- Contract-wide reentrancy guard.

## Verification

Use local protocol-adapter tests only until WSL2 and the Nox local stack are available.

```bash
npm run build
npm test
npm run typecheck
npm audit --omit=dev
```

Do not describe this project as live Nox or Sepolia E2E until a real Nox computation and unchanged router/protocol interaction have been verified.
