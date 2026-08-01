import assert from "node:assert/strict";
import test from "node:test";

import { reconcilePrivacySavings } from "../scripts/reconcile-v3-e2e-evidence.mjs";

test("reconciles private net residual with public settlement rounding", () => {
  assert.deepEqual(reconcilePrivacySavings({
    disclosure: "authorized participant E2E disclosure; not public Nox decryption",
    requestedQuoteWad: "20487683990500000000",
    matchedQuoteWad: "8436105000000000000",
    residualQuoteWad: "3615473990499990936",
  }, 24_102n * 10n ** 18n), {
    disclosure: "authorized participant E2E disclosure; not public Nox decryption",
    requestedQuoteWad: "20487683990500000000",
    matchedQuoteWad: "8436105000000000000",
    netResidualQuoteWad: "3615473990500000000",
    settlementResidualQuoteWad: "3615473990499990936",
    roundingDustQuoteWad: "9064",
  });
});

test("rejects inconsistent or excessive residual rounding", () => {
  assert.throws(() => reconcilePrivacySavings({
    requestedQuoteWad: "10",
    matchedQuoteWad: "6",
    residualQuoteWad: "0",
  }, 1n), /matched quote exceeds/);
  assert.throws(() => reconcilePrivacySavings({
    requestedQuoteWad: "100",
    matchedQuoteWad: "40",
    residualQuoteWad: "10",
  }, 1n), /rounding dust exceeds/);
});
