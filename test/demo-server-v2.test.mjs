import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

const originalPort = process.env.PORT;
process.env.PORT = "0";
const handlesBeforeImport = new Set(process._getActiveHandles());
const demoServerModule = await import("../scripts/demo-server.mjs");
for (const handle of process._getActiveHandles()) {
  if (!handlesBeforeImport.has(handle) && typeof handle.close === "function") {
    await new Promise((resolve) => handle.close(resolve));
  }
}
if (originalPort === undefined) delete process.env.PORT;
else process.env.PORT = originalPort;

const { createDemoServer, runScript } = demoServerModule;

function requireExport(value, name) {
  assert.equal(typeof value, "function", `${name} must be exported`);
}

function createFakeChild({ onKill } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal) => {
    onKill?.(signal);
    return true;
  };
  return child;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test("exports import-safe demo server helpers", () => {
  requireExport(createDemoServer, "createDemoServer");
  requireExport(runScript, "runScript");
});

test("serves the real dapp and routes both demo POST endpoints", async (t) => {
  requireExport(createDemoServer, "createDemoServer");
  const calls = [];
  const server = createDemoServer({
    scriptRunner: async (scriptName, options) => {
      calls.push({ scriptName, options });
      return { ok: true, stdout: `${scriptName} complete` };
    },
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = await listen(server);

  const rootResponse = await fetch(`${baseUrl}/`);
  assert.equal(rootResponse.status, 200);
  assert.match(rootResponse.headers.get("content-type"), /^text\/html/);
  assert.match(await rootResponse.text(), /NoxRoute/i);

  for (const [endpoint, scriptName] of [
    ["/api/fill-demo-batch", "fill-v2-demo-batch.mjs"],
    ["/api/finalize-demo-batch", "finalize-v2-demo-batch.mjs"],
  ]) {
    const response = await fetch(`${baseUrl}${endpoint}`, { method: "POST" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      stdout: `${scriptName} complete`,
    });
  }

  const unknownResponse = await fetch(`${baseUrl}/api/unknown`, { method: "POST" });
  assert.equal(unknownResponse.status, 404);
  assert.deepEqual(await unknownResponse.json(), {
    ok: false,
    error: "Unknown API endpoint",
  });
  assert.deepEqual(calls, [
    {
      scriptName: "fill-v2-demo-batch.mjs",
      options: { timeoutMs: 30 * 60_000 },
    },
    {
      scriptName: "finalize-v2-demo-batch.mjs",
      options: { timeoutMs: 30 * 60_000 },
    },
  ]);
});

test("runScript uses an overridden RPC and redacts private key shaped output", async () => {
  requireExport(runScript, "runScript");
  let childOptions;
  const child = createFakeChild();
  const privateKeyShapedOutput = `0x${"a".repeat(64)}`;
  const resultPromise = runScript("harmless.mjs", {
    env: { SEPOLIA_RPC_URL: "https://rpc.example.test" },
    spawnFn: (_command, _args, options) => {
      childOptions = options;
      queueMicrotask(() => {
        child.stdout.end(`value=${privateKeyShapedOutput}`);
        child.emit("exit", 0);
      });
      return child;
    },
    timeoutMs: 100,
  });

  const result = await resultPromise;
  assert.equal(childOptions.env.SEPOLIA_RPC_URL, "https://rpc.example.test");
  assert.equal(childOptions.env.DEPLOYER_PRIVATE_KEY, undefined);
  assert.equal(result.stdout, "value=0x[REDACTED_32BYTE]");
});

test("runScript provides a keyless public RPC fallback", async () => {
  requireExport(runScript, "runScript");
  let childOptions;
  const child = createFakeChild();
  const resultPromise = runScript("harmless.mjs", {
    env: {},
    spawnFn: (_command, _args, options) => {
      childOptions = options;
      queueMicrotask(() => child.emit("exit", 0));
      return child;
    },
    timeoutMs: 100,
  });

  await resultPromise;
  assert.match(childOptions.env.SEPOLIA_RPC_URL, /^https:\/\//);
  assert.equal(childOptions.env.DEPLOYER_PRIVATE_KEY, undefined);
});

test("runScript kills a timed out child and rejects with an explicit timeout", async () => {
  requireExport(runScript, "runScript");
  let killedWith;
  const child = createFakeChild({ onKill: (signal) => { killedWith = signal; } });

  await assert.rejects(
    runScript("hung.mjs", {
      env: {},
      spawnFn: () => child,
      timeoutMs: 10,
    }),
    /hung\.mjs timed out after 10ms/,
  );
  assert.equal(killedWith, "SIGTERM");
});

test("runScript clears its timeout when the child exits", async () => {
  requireExport(runScript, "runScript");
  let killCount = 0;
  const child = createFakeChild({ onKill: () => { killCount += 1; } });
  const resultPromise = runScript("quick.mjs", {
    env: {},
    spawnFn: () => {
      queueMicrotask(() => child.emit("exit", 0));
      return child;
    },
    timeoutMs: 10,
  });

  await resultPromise;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(killCount, 0);
});

test("runScript clears its timeout when the child emits an error", async () => {
  requireExport(runScript, "runScript");
  let killCount = 0;
  const child = createFakeChild({ onKill: () => { killCount += 1; } });
  const resultPromise = runScript("broken.mjs", {
    env: {},
    spawnFn: () => {
      queueMicrotask(() => child.emit("error", new Error("spawn failed")));
      return child;
    },
    timeoutMs: 10,
  });

  await assert.rejects(resultPromise, /broken\.mjs failed to start: spawn failed/);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(killCount, 0);
});
