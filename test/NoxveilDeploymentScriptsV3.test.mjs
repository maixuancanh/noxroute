import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Sepolia verifier pins official dependencies and fails before deployment", () => {
  const source = read("scripts/verify-v3-sepolia-dependencies.mjs");
  for (const value of [
    "11155111",
    "0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF",
    "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
    "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    "0x0227628f3F023bb0B980b67D528571c95c6DaC1c",
    "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
    "pool.observe([V3_SEPOLIA.twapWindow, 0])",
    "deployerBalance >= minimumBalance",
  ]) assert.ok(source.includes(value), `missing fail-closed dependency check: ${value}`);
  assert.equal(source.includes("console.log(rpcUrl"), false);
  assert.equal(source.includes("privateKey"), false);
});

test("deployment order is vault, adapter, engine, immutable bindings, then post-check artifact", () => {
  const source = read("scripts/deploy-noxveil-v3-sepolia.mjs");
  const markers = [
    'deploy("NoxveilVault"',
    'deploy("NoxveilUniswapV3Adapter"',
    'deploy("NoxveilStrategyEngine"',
    "vault.setEngine",
    "vault.setAdapter",
    "vault.closeBootstrap",
    "await postDeploymentChecks",
    "atomicWriteJson(deploymentPath",
  ];
  let previous = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker);
    assert.ok(index > previous, `deployment marker missing or out of order: ${marker}`);
    previous = index;
  }
  assert.equal(source.includes("console.log(privateKey"), false);
  assert.equal(source.includes("rpcUrl:"), false);
});

test("package scripts always build and verify before V3 deployment", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(packageJson.scripts["verify:v3:sepolia"], "node scripts/verify-v3-sepolia-dependencies.mjs");
  assert.equal(
    packageJson.scripts["deploy:v3:sepolia"],
    "npm run build && npm run verify:v3:sepolia && node scripts/deploy-noxveil-v3-sepolia.mjs",
  );
});
