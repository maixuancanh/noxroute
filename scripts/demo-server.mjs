import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dappDir = path.join(root, "dapp");
const publicRpcUrl = "https://ethereum-sepolia-rpc.publicnode.com";
const defaultTimeoutMs = 60_000;
// Fill performs several sequential Sepolia transactions and Nox encryptions.
const fillDemoTimeoutMs = 30 * 60_000;
// Finalize can perform six sequential decryptions with 240-second retries, then delivery.
const finalizeDemoTimeoutMs = 30 * 60_000;

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function redactSecrets(value) {
  return value.replace(/0x[a-fA-F0-9]{64}/g, "0x[REDACTED_32BYTE]");
}

export function runScript(scriptName, {
  env = process.env,
  spawnFn = spawn,
  timeoutMs = defaultTimeoutMs,
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive finite number");
  }

  return new Promise((resolve, reject) => {
    const child = spawnFn(process.execPath, [path.join(root, "scripts", scriptName)], {
      cwd: root,
      env: {
        ...env,
        SEPOLIA_RPC_URL: env.SEPOLIA_RPC_URL || publicRpcUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout;

    const settle = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("exit", (code) => {
      settle(() => {
        const safeStdout = redactSecrets(stdout);
        const safeStderr = redactSecrets(stderr);
        if (code === 0) resolve({ ok: true, stdout: safeStdout });
        else reject(new Error(safeStderr || safeStdout || `${scriptName} exited with ${code}`));
      });
    });
    child.on("error", (error) => {
      settle(() => reject(new Error(
        `${scriptName} failed to start: ${redactSecrets(error.message || String(error))}`,
      )));
    });

    timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        child.kill("SIGTERM");
      } catch {
        // Preserve the timeout error even if the child is already unavailable.
      }
      reject(new Error(`${scriptName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

async function handleApi(req, res, scriptRunner) {
  try {
    if (req.url === "/api/fill-demo-batch") {
      sendJson(res, 200, await scriptRunner("fill-v2-demo-batch.mjs", {
        timeoutMs: fillDemoTimeoutMs,
      }));
      return;
    }
    if (req.url === "/api/finalize-demo-batch") {
      sendJson(res, 200, await scriptRunner("finalize-v2-demo-batch.mjs", {
        timeoutMs: finalizeDemoTimeoutMs,
      }));
      return;
    }
    sendJson(res, 404, { ok: false, error: "Unknown API endpoint" });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || String(error) });
  }
}

export function createDemoServer({
  scriptRunner = runScript,
  staticDirectory = dappDir,
} = {}) {
  return http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url?.startsWith("/api/")) {
      await handleApi(req, res, scriptRunner);
      return;
    }

    const requested = decodeURIComponent((req.url || "/").split("?")[0]);
    const safePath = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
    const filePath = path.resolve(staticDirectory, safePath);
    if (!filePath.startsWith(path.resolve(staticDirectory))) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": contentType(filePath) });
    fs.createReadStream(filePath).pipe(res);
  });
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const port = Number(process.env.PORT || "5173");
  createDemoServer().listen(port, () => {
    console.log(`NoxBatch demo dApp listening on http://localhost:${port}`);
  });
}
