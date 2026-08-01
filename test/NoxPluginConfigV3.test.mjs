import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("scopes npm test to legacy and V3 contract regression suites", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("package.json", projectRoot), "utf8"),
  );

  assert.equal(
    packageJson.scripts.test,
    "hardhat test mocha test/NoxBatchRouter.ts test/NoxBatchRouterV2.ts test/NoxveilMathV3.ts test/NoxveilEpochStateV3.ts test/NoxveilAdapterV3.ts",
  );
});

test("keeps the retired V2 UI test outside the active test tree", async () => {
  await assert.rejects(
    readFile(new URL("test/dapp-ui.test.mjs", projectRoot), "utf8"),
    { code: "ENOENT" },
  );
});

test("pins the official Nox Hardhat plugin and separates V3 proof levels", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("package.json", projectRoot), "utf8"),
  );

  assert.equal(
    packageJson.devDependencies["@iexec-nox/nox-hardhat-plugin"],
    "0.2.0",
  );
  assert.equal(packageJson.devDependencies["cross-env"], "7.0.3");
  assert.doesNotMatch(packageJson.scripts["test:unit:v3"], /NOX_SKIP_STACK/);
  assert.match(
    packageJson.scripts["test:nox:local:v3"],
    /run-nox-local-wsl\.sh/,
  );
  assert.match(
    packageJson.scripts["test:sepolia:v3"],
    /noxveil-v3-sepolia\.spec\.ts/,
  );
});

test("registers the Nox plugin on an OP-compatible simulated network", async () => {
  const config = await readFile(
    new URL("hardhat.config.ts", projectRoot),
    "utf8",
  );

  assert.match(config, /noxPlugin/);
  assert.match(config, /chainType:\s*["']op["']/);
  assert.doesNotMatch(config, /skipTestOverride/);
  assert.doesNotMatch(config, /\bnox\s*:/);
});

test("isolates Linux dependencies and writes evidence only after local Nox passes", async () => {
  const runner = await readFile(
    new URL("scripts/run-nox-local-wsl.sh", projectRoot),
    "utf8",
  ).catch(() => "");

  assert.match(runner, /mktemp -d/);
  assert.match(runner, /HOME}\/\.local\/bin/);
  assert.match(runner, /docker info/);
  assert.match(runner, /npm ci/);
  assert.match(runner, /test:nox:local:v3:inner/);
  assert.match(runner, /test_status/);
  assert.match(runner, /local-nox-v3\.log/);
  assert.match(runner, /Refusing to remove unexpected temporary path/);
});
