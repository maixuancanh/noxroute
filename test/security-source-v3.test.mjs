import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const excludedDirectories = new Set([
  ".codegraph",
  ".git",
  "artifacts",
  "cache",
  "node_modules",
]);

async function collectTextSources(directory = projectRoot) {
  const sources = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      sources.push(...await collectTextSources(absolutePath));
      continue;
    }
    if (!entry.isFile()) continue;

    const content = await readFile(absolutePath);
    sources.push({
      path: path.relative(projectRoot, absolutePath),
      text: content.toString("latin1"),
    });
  }

  return sources;
}

const sources = await collectTextSources();

test("security scan includes package-lock.json", () => {
  assert.equal(
    sources.some((source) => source.path === "package-lock.json"),
    true,
  );
});

test("security scan includes generated evidence", () => {
  assert.equal(
    sources.some((source) => source.path.startsWith(`evidence${path.sep}`)),
    true,
  );
});

test("security scan detects a 32-hex digest adjacent to NUL bytes", async () => {
  const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), "noxveil-security-"));
  const fakeToken = "0123456789abcdef0123456789abcdef";
  const knownDigest = createHash("sha256").update(fakeToken).digest("hex");

  try {
    await writeFile(
      path.join(fixtureDirectory, "nul-adjacent.bin"),
      Buffer.from(`prefix\0${fakeToken}\0suffix`, "latin1"),
    );
    const fixtureSources = await collectTextSources(fixtureDirectory);
    const detected = fixtureSources.some((source) => {
      for (const match of source.text.matchAll(/[A-Fa-f0-9]{32,}/g)) {
        const candidateDigest = createHash("sha256")
          .update(match[0].slice(0, 32))
          .digest("hex");
        if (candidateDigest === knownDigest) return true;
      }
      return false;
    });

    assert.equal(detected, true);
  } finally {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test("source tree does not contain the known exposed RPC token", () => {
  const knownTokenDigest = "fe0d865a93f189fa01b824e718e09b4e1283450c3b411b1d9476f967b638ba7d";
  const matches = sources
    .filter((source) => {
      for (const match of source.text.matchAll(/[A-Fa-f0-9]{32,}/g)) {
        const hexRun = match[0];
        for (let offset = 0; offset <= hexRun.length - 32; offset += 1) {
          const candidate = hexRun.slice(offset, offset + 32);
          const digest = createHash("sha256").update(candidate).digest("hex");
          if (digest === knownTokenDigest) return true;
        }
      }
      return false;
    })
    .map((source) => source.path);

  assert.deepEqual(matches, [], `known RPC token found in: ${matches.join(", ")}`);
});

test("source tree does not contain hardcoded Infura v3 URLs", () => {
  const hardcodedInfuraV3Url = /https?:\/\/[^\s"'`]+\.infura\.io\/v3\/[A-Za-z0-9_-]{16,}/i;
  const matches = sources
    .filter((source) => hardcodedInfuraV3Url.test(source.text))
    .map((source) => source.path);

  assert.deepEqual(matches, [], `hardcoded Infura v3 URL found in: ${matches.join(", ")}`);
});
