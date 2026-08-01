import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  Interface,
  keccak256,
  toUtf8Bytes,
  toBeHex,
  zeroPadValue,
} from "ethers";

const root = new URL("../", import.meta.url);
const evidenceUrl = new URL("../evidence/privacy-invariants-v3.json", import.meta.url);

test("V3 privacy audit passes with an explicit public-decryption allowlist", () => {
  const result = spawnSync(process.execPath, ["scripts/audit-v3-privacy.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const evidence = JSON.parse(readFileSync(evidenceUrl, "utf8"));
  assert.equal(evidence.status, "pass");
  assert.deepEqual(evidence.violations, []);
  assert.deepEqual(evidence.publicDecryptFields, [
    "residualDirection",
    "residualAmount",
    "aggregateMinOut",
  ]);
  assert.deepEqual(evidence.viewerOnlyAggregates, ["totalRequestedQuote", "matchedQuote"]);
});

test("sample createStrategy calldata contains handles, not plaintext economics", () => {
  const abi = [
    "function createStrategy((bytes32 direction,bytes directionProof,bytes32 budget,bytes budgetProof,bytes32 clip,bytes clipProof,bytes32 limitPriceWad,bytes limitPriceProof,bytes32 slippageBps,bytes slippageProof) input,uint64 clientNonce)",
  ];
  const iface = new Interface(abi);
  const privateValues = {
    budget: 5_000n * 10n ** 6n,
    clip: 250n * 10n ** 6n,
    limit: 2_600n * 10n ** 18n,
    slippage: 75n,
  };
  const handle = (label) => keccak256(toUtf8Bytes(`encrypted:${label}`));
  const calldata = iface.encodeFunctionData("createStrategy", [{
    direction: handle("direction"),
    directionProof: "0x1234",
    budget: handle("budget"),
    budgetProof: "0x2345",
    clip: handle("clip"),
    clipProof: "0x3456",
    limitPriceWad: handle("limit"),
    limitPriceProof: "0x4567",
    slippageBps: handle("slippage"),
    slippageProof: "0x5678",
  }, 77n]).toLowerCase();

  for (const value of Object.values(privateValues)) {
    const plaintextWord = zeroPadValue(toBeHex(value), 32).slice(2).toLowerCase();
    assert.equal(calldata.includes(plaintextWord), false, `plaintext ABI word leaked: ${value}`);
  }
});

test("a failing audit never overwrites prior passing evidence", () => {
  const before = readFileSync(evidenceUrl, "utf8");
  const result = spawnSync(process.execPath, ["scripts/audit-v3-privacy.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NOXVEIL_AUDIT_FORCE_VIOLATION: "1" },
  });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(evidenceUrl, "utf8"), before);
});
