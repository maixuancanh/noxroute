import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import * as v3DocLinkRenderer from "../scripts/render-v3-doc-links.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => {
  const url = new URL(path, root);
  return existsSync(url) ? readFileSync(url, "utf8") : "";
};
const publicDocPaths = [
  "README.md",
  "SUBMISSION.md",
  "demo-script.md",
  "SECURITY.md",
  "PRIVACY.md",
  "evidence/README.md",
  "dapp/project.json",
];

const legacyAddresses = [
  "0x5a96aC1A2b615780D9825fB9c719BC82261aad8C",
  "0x7b738d90a295250ee5276956ac6dB3674F09931a",
  "0x29fD42cA33428e277c661c5DfaE6e8952ADDbF0F",
  "0x3A7659A64c6E9234555C0f09Be0B44Ad897fdeB8",
  "0xdb2DeEEdbbc077586dD87fde2288443245161279",
  "0xE888D5Fc48B1fFcEa3fAEfFF34b2beD33b2E5B64",
  "0xF7Ad14Ae715fEAa56c4E68fc48e094eAb7258C12",
  "0x195f061789AcDb4a5456C7b4b462044aCF94A482",
  "0x72aAe8CFeb1D7E276eb1111059da4Fd777EE6088",
  "0x3d55C83ba98B0Ac4ff35ED6B7AEF016cBA299dAF",
  "0x65CA0dE623bbaf7D9a16938FcA1694F7343A6867",
  "0xe9d4c89970065927c56985f6559d33421e89692e480909e2b395983f56c27d2a",
  "0xa0b805f2304ebb51c5bdedc681bb57523e53b8ae5f9891332094cc8797e3456f",
  "0xb21ab472de2f760c4cc4dfd11ff298caf53168a903f25a4bbf16281040701efa",
];

const expectedNoxJobs = [
  "Persistent private strategy state across epochs",
  "Encrypted balance sufficiency and clip eligibility",
  "Confidential opposing-flow netting",
  "Private post-settlement allocation and remaining balances",
];
const publicDecryptionFields = ["residualDirection", "residualAmount", "aggregateMinOut"];
const requiredLimitations = [
  "deposits and withdrawals are public",
  "addresses and lifecycle timing are public",
  "TEE/Nox trust",
  "one WETH/USDC pair",
  "one 0.05% fee tier",
  "maximum of 8 strategies",
  "fixed cadence",
  "not an anonymity system",
  "not mainnet-audited",
  "not production-ready",
  "not market-quality evidence",
];
const evidenceStatusLabels = [
  "Real multi-wallet Sepolia E2E: **verified**",
  "MetaMask connection lifecycle: **verified**",
  "Token-funded extension transactions: **verified**",
  "Public Vercel dApp: **verified**",
];
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const assertContainsClaims = (path, content, claims) => {
  for (const claim of claims) {
    assert.match(content, new RegExp(escapeRegExp(claim), "i"), `${path} is missing: ${claim}`);
  }
};

const extractNumberedTimedDemo = (demo) => {
  const steps = [];
  let inTimedSection = false;
  for (const line of demo.split(/\r?\n/)) {
    if (/^## \d+:\d+/.test(line)) {
      inTimedSection = true;
      continue;
    }
    if (/^## /.test(line) && inTimedSection) break;
    if (!inTimedSection) continue;
    const numbered = line.match(/^\d+\.\s+(.+)/);
    if (numbered) {
      steps.push(numbered[1]);
    } else if (steps.length > 0 && line.trim()) {
      steps[steps.length - 1] += ` ${line.trim()}`;
    }
  }
  return steps;
};

test("public documentation uses the NoxRoute product name only", () => {
  const docs = publicDocPaths.map((path) => [path, read(path)]);
  for (const [path, content] of docs) {
    assert.match(content, /NoxRoute/i, `${path} must identify NoxRoute`);
    assert.doesNotMatch(content, /Noxveil|NoxBatch|VeilSwap|BOIN|BOOUT/i, `${path} contains a retired product or demo-token name`);
    for (const address of legacyAddresses) {
      assert.equal(content.toLowerCase().includes(address.toLowerCase()), false, `${path} contains stale V1/V2 evidence ${address}`);
    }
  }
});

test("README and submission explain exactly four load-bearing Nox jobs", () => {
  for (const path of ["README.md", "SUBMISSION.md"]) {
    const content = read(path);
    const section = content.match(/## Why Nox is load-bearing\r?\n([\s\S]*?)(?=\r?\n## |$)/i)?.[1] ?? "";
    const numberedJobs = [...section.matchAll(/^\d+\.\s+\*\*(.+?)\*\*/gm)].map((match) => match[1]);
    assert.deepEqual(numberedJobs, expectedNoxJobs, `${path} must contain the four exact Nox jobs and no fifth job`);
  }
});

test("first-screen route banner visibly names the four load-bearing Nox jobs", () => {
  const html = read("dapp/index.html");
  const banner = html.match(/<div class="route-banner">([\s\S]*?)<\/div>\s*<section id="strategyComposer"/)?.[1] ?? "";
  assert.match(banner, /<ul class="nox-job-line" aria-label="Why Nox is required">/);
  for (const phrase of [
    "Persistent private state",
    "Encrypted eligibility",
    "Opposing-flow netting",
    "Private allocation and remaining balances",
  ]) assert.match(banner, new RegExp(phrase, "i"), `first screen is missing: ${phrase}`);
  assert.equal([...banner.matchAll(/<li>/g)].length, 4, "first screen must show exactly four Nox jobs");
});

test("README and submission independently quantify the three public decryptions", () => {
  for (const path of ["README.md", "SUBMISSION.md"]) {
    const content = read(path);
    assert.match(content, /viewer-authorized requested\s+and matched\s+volume/i, `${path} is missing the viewer-authorized comparison`);
    assert.match(content, /only (?:the )?aggregate public\s+residual/i, `${path} is missing the public residual boundary`);
    assert.match(content, /exactly three aggregate public decryptions/i, `${path} is missing the exact decryption count`);
    const disclosureParagraph = content
      .split(/\r?\n\r?\n/)
      .find((paragraph) => /exactly three aggregate public decryptions/i.test(paragraph)) ?? "";
    const disclosedFields = [...disclosureParagraph.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    assert.deepEqual(disclosedFields, publicDecryptionFields, `${path} must name exactly the three allowed public decryption fields`);
  }
});

test("README and submission independently state every limitation and evidence proof level", () => {
  for (const path of ["README.md", "SUBMISSION.md"]) {
    const content = read(path);
    assertContainsClaims(path, content, requiredLimitations);
    assertContainsClaims(path, content, evidenceStatusLabels);
  }
  assert.equal(existsSync(new URL("evidence/sepolia-e2e-v3.json", root)), true, "verified E2E evidence is required");
  const evidence = JSON.parse(read("evidence/sepolia-e2e-v3.json"));
  assert.equal(evidence.status, "pass");
  assert.equal(evidence.handles.publiclyDecrypted.length, 3);
  assert.equal(evidence.unauthorizedDecryptionRejected, true);
  assert.equal(evidence.replayRejected, true);
  assert.equal(evidence.uniswap.officialPoolLogEmitted, true);
});

test("demo independently states the exact disclosure and verified-evidence boundaries", () => {
  const demo = read("demo-script.md");
  assertContainsClaims("demo-script.md", demo, [
    "deposits and withdrawals are public",
    "addresses and lifecycle timing are public",
    "exactly three aggregate public decryptions",
    ...publicDecryptionFields,
    "aggregate public residual",
    "Sepolia E2E is **verified**",
    "MetaMask connection lifecycle is **verified**",
    "Token-funded extension transactions are **verified**",
  ]);
});

test("parsed project metadata has exact jobs, structured limitations, and evidence status", () => {
  const config = JSON.parse(read("dapp/project.json"));
  assert.deepEqual(config.noxJobs, expectedNoxJobs);
  assert.equal(config.noxJobs.length, 4);
  assert.deepEqual(config.publicDecryptions, publicDecryptionFields);
  assert.deepEqual(config.publicBoundary, [
    "Deposits and withdrawals are public",
    "Addresses and lifecycle timing are public",
    "Only aggregate residual and aggregateMinOut are public at finalization",
  ]);
  assert.deepEqual(config.scope, {
    pair: "WETH/USDC",
    feeTier: "0.05%",
    maxStrategies: 8,
    cadence: "fixed",
  });
  assert.equal(config.trust, "TEE/Nox trust, viewer ACL correctness, and contract correctness");
  assert.deepEqual(config.limitations, [
    "Not an anonymity system",
    "Not mainnet-audited",
    "Not production-ready",
    "Sepolia test pool price and liquidity are not market-quality evidence",
  ]);
  assert.deepEqual(config.artifacts.sepoliaE2E, {
    path: "../evidence/sepolia-e2e-v3.json",
    status: "pass",
  });
  assert.deepEqual(config.artifacts.extensionWalletSmoke, {
    path: "../evidence/extension-wallet-smoke-2026-08-01.md",
    strategyPath: "../evidence/extension-wallet-strategy-2026-08-01.json",
    status: "extension-e2e-pass",
  });
  assert.deepEqual(config.artifacts.vercelDeployment, {
    path: "../evidence/vercel-deployment-2026-08-02.md",
    url: "https://noxroute.vercel.app",
    status: "pass",
  });
});

test("numbered timed demo follows the required evidence-first V3 flow", () => {
  const steps = extractNumberedTimedDemo(read("demo-script.md"));
  assert.equal(steps.length, 20, "demo must have exactly 20 numbered timed steps");
  const numberedDemo = steps.join("\n");
  const ordered = [
    "official dependency panel",
    "two encrypted strategies",
    "owner ACL",
    "epoch lock",
    "exactly three aggregate public decryptions",
    "internally matched",
    "public residual",
    "official Uniswap transaction",
    "owner one and decrypt",
    "unauthorized decrypt failure",
    "privacy receipt",
  ];
  let cursor = -1;
  for (const phrase of ordered) {
    const next = numberedDemo.toLowerCase().indexOf(phrase.toLowerCase(), cursor + 1);
    assert.ok(next > cursor, `demo step missing or out of order: ${phrase}`);
    cursor = next;
  }
});

test("pure V3 doc renderer replaces one valid generated block", () => {
  assert.equal(typeof v3DocLinkRenderer.validateAndRenderV3DocLinks, "function");
  const generated = "<!-- V3_LINKS:START -->\nhttps://sepolia.etherscan.io/address/0x1111111111111111111111111111111111111111\n<!-- V3_LINKS:END -->";
  const source = "Before\n<!-- V3_LINKS:START -->\nstale\n<!-- V3_LINKS:END -->\nAfter";
  assert.equal(
    v3DocLinkRenderer.validateAndRenderV3DocLinks(source, generated, "fixture.md"),
    `Before\n${generated}\nAfter`,
  );
});

test("pure V3 doc renderer rejects duplicate, unmatched, and reversed markers", () => {
  assert.equal(typeof v3DocLinkRenderer.validateAndRenderV3DocLinks, "function");
  const generated = "<!-- V3_LINKS:START -->\ncurrent\n<!-- V3_LINKS:END -->";
  const invalidSources = [
    ["no markers", "exactly one V3_LINKS:START marker"],
    ["<!-- V3_LINKS:START -->\nno end", "exactly one V3_LINKS:END marker"],
    ["no start\n<!-- V3_LINKS:END -->", "exactly one V3_LINKS:START marker"],
    ["<!-- V3_LINKS:END -->\n<!-- V3_LINKS:START -->", "must precede"],
    ["<!-- V3_LINKS:START -->\n<!-- V3_LINKS:START -->\n<!-- V3_LINKS:END -->", "exactly one V3_LINKS:START marker"],
    ["<!-- V3_LINKS:START -->\n<!-- V3_LINKS:END -->\n<!-- V3_LINKS:END -->", "exactly one V3_LINKS:END marker"],
  ];
  for (const [source, message] of invalidSources) {
    assert.throws(
      () => v3DocLinkRenderer.validateAndRenderV3DocLinks(source, generated, "fixture.md"),
      new RegExp(escapeRegExp(message), "i"),
    );
  }
});

test("pure V3 doc renderer rejects Sepolia address and transaction links outside its block", () => {
  assert.equal(typeof v3DocLinkRenderer.validateAndRenderV3DocLinks, "function");
  const generated = "<!-- V3_LINKS:START -->\nhttps://sepolia.etherscan.io/tx/0x1111\n<!-- V3_LINKS:END -->";
  for (const source of [
    "https://sepolia.etherscan.io/address/0x2222\n<!-- V3_LINKS:START -->\nold\n<!-- V3_LINKS:END -->",
    "<!-- V3_LINKS:START -->\nold\n<!-- V3_LINKS:END -->\nhttps://sepolia.etherscan.io/tx/0x3333",
  ]) {
    assert.throws(
      () => v3DocLinkRenderer.validateAndRenderV3DocLinks(source, generated, "fixture.md"),
      /Sepolia Etherscan address\/transaction links outside the generated V3 link block/i,
    );
  }
});

test("root package metadata uses the NoxRoute product name", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(pkg.name, "noxroute");
  assert.equal(lock.name, "noxroute");
  assert.equal(lock.packages[""].name, "noxroute");
});

test("submission and demo links are rendered from the V3 deployment artifact", () => {
  const result = spawnSync(process.execPath, ["scripts/render-v3-doc-links.mjs", "--check"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const evidence = JSON.parse(read("evidence/sepolia-e2e-v3.json"));
  const settlementLink = `https://sepolia.etherscan.io/tx/${evidence.transactions.settlement}`;
  for (const path of ["SUBMISSION.md", "demo-script.md"]) {
    assert.match(read(path), new RegExp(escapeRegExp(settlementLink)), `${path} is missing the artifact-derived settlement link`);
  }
});
