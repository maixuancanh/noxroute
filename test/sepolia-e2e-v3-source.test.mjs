import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = await readFile(
  fileURLToPath(new URL("../e2e/noxveil-v3-sepolia.spec.ts", import.meta.url)),
  "utf8",
);

test("Sepolia V3 E2E estimates high-cost writes and applies a bounded buffer", () => {
  assert.match(source, /async function sendWithEstimatedGas/);
  assert.match(source, /method\.estimateGas\(\.\.\.args\)/);
  assert.match(source, /estimate \* 130n \/ 100n/);
  for (const operation of [
    "createWethStrategy",
    "createUsdcStrategy",
    "lockEpoch",
    "finalizeAggregate",
    "settlement",
  ]) {
    assert.match(source, new RegExp(`sendWithEstimatedGas\\(\\s*["']${operation}["']`));
  }
  assert.doesNotMatch(source, /gasLimit:\s*(?:12_000_000|16_000_000|4_000_000)/);
});

test("Sepolia V3 E2E resumes setup from owner-decrypted vault balances", () => {
  assert.match(source, /async function ownerAvailableBalance/);
  assert.match(source, /vault\.availableHandle\(owner, token\)/);
  assert.match(source, /handle === ZeroHash/);
  assert.match(source, /client\.decrypt\(handle\)/);
  assert.match(source, /WETH_DEPOSIT - wethAvailableBefore/);
  assert.match(source, /usdcDeposit - usdcAvailableBefore/);
});

test("Sepolia V3 E2E reconciles private net residual and settlement rounding dust", () => {
  assert.match(source, /const netResidualQuoteWad = requestedQuoteWad - 2n \* matchedQuoteWad/);
  assert.match(source, /const settlementResidualQuoteWad =/);
  assert.match(source, /const roundingDustQuoteWad = netResidualQuoteWad - settlementResidualQuoteWad/);
  assert.match(source, /maxRoundingDustQuoteWad/);
  assert.match(source, /netResidualQuoteWad: netResidualQuoteWad\.toString\(\)/);
  assert.match(source, /settlementResidualQuoteWad: settlementResidualQuoteWad\.toString\(\)/);
  assert.match(source, /roundingDustQuoteWad: roundingDustQuoteWad\.toString\(\)/);
});

test("Sepolia V3 E2E rejects wrong failure reasons and dirty one-shot state", () => {
  assert.match(source, /mustRejectMatching/);
  assert.match(source, /mustRejectCustomError/);
  assert.match(source, /InvalidEpochStatus/);
  assert.equal(source.includes("does not exist or user .* is not authorized to decrypt it"), true);
  assert.doesNotMatch(source, /\/unauthorized\|not authorized\|access\|acl\|permission\/i/);
  assert.match(source, /activeStrategyCountBefore/);
  assert.match(source, /Refusing to write into a deployment with active strategies/);
  assert.doesNotMatch(source, /async function mustReject\([^)]*\)\s*\{[\s\S]*?catch\s*\{\s*return;/);
});
