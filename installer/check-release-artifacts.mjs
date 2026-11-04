#!/usr/bin/env node
// Release content check (Step 08d T4). No dependency, no network.
//
//   node installer/check-release-artifacts.mjs <release-dir> <version> <commit>
//
// Reads the same fixed names as Rust `artifact_inventory.rs`, verifies the
// generated manifest, every SHA-256 and byte length, SHA256SUMS.txt, and that
// no extra, debug, key, model or test file is present.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const FORBIDDEN = [
  "debug",
  "test",
  "fixture",
  "sample",
  "measurement",
  "private",
  ".key",
  ".gguf",
  ".onnx",
  ".safetensors",
  ".pt",
  ".pdb",
];

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function check(releaseDir, version, commit) {
  const problems = [];
  if (!VERSION.test(version)) problems.push(`invalid version: ${version}`);
  if (!COMMIT.test(commit)) problems.push(`invalid source commit: ${commit}`);

  const catalog = JSON.parse(
    await readFile(path.join(here, "artifacts.json"), "utf8"),
  );
  if (catalog.schema !== 1 || catalog.target !== "windows-x86_64") {
    problems.push("installer/artifacts.json is not the v1 catalog");
  }
  const names = catalog.names.map((name) => name.replace("{version}", version));
  if (names.length !== 7 || new Set(names).size !== names.length) {
    problems.push("the fixed artifact list must contain seven unique names");
  }
  const derived = new Set(catalog.derived ?? []);
  const recordNames = names.filter((name) => !derived.has(name));
  const expected = new Set(names);

  const manifestPath = path.join(releaseDir, "release-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schema !== 1 || !Array.isArray(manifest.records)) {
    problems.push("release-manifest.json has an unknown shape");
  }
  const records = Array.isArray(manifest.records) ? manifest.records : [];
  if (records.length !== recordNames.length) {
    problems.push(`expected ${recordNames.length} records, found ${records.length}`);
  }
  const seen = new Set();
  for (const record of records) {
    const name = String(record.name ?? "");
    if (!recordNames.includes(name)) problems.push(`unexpected artifact record: ${name}`);
    if (seen.has(name)) problems.push(`duplicate artifact record: ${name}`);
    seen.add(name);
    if (FORBIDDEN.some((word) => name.toLowerCase().includes(word))) {
      problems.push(`forbidden artifact name: ${name}`);
    }
    if (!SHA256.test(String(record.sha256 ?? ""))) {
      problems.push(`${name}: invalid SHA-256`);
    }
    if (!Number.isSafeInteger(record.byte_len) || record.byte_len <= 0) {
      problems.push(`${name}: invalid byte length`);
    }
    if (record.source_commit !== commit) {
      problems.push(`${name}: source commit does not match`);
    }
    if (record.version !== version) {
      problems.push(`${name}: version does not match`);
    }
    if (record.target !== catalog.target) {
      problems.push(`${name}: target does not match`);
    }
    if (record.unsigned !== true) {
      problems.push(`${name}: public artifact must be unsigned`);
    }
    try {
      const file = path.join(releaseDir, name);
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) {
        problems.push(`${name}: not a regular file`);
        continue;
      }
      if (info.size !== record.byte_len) {
        problems.push(`${name}: byte length differs from disk`);
      }
      const actual = await hashFile(file);
      if (actual !== record.sha256) problems.push(`${name}: SHA-256 differs from disk`);
    } catch {
      problems.push(`${name}: missing from the release folder`);
    }
  }
  for (const name of recordNames) {
    if (!seen.has(name)) problems.push(`missing artifact record: ${name}`);
  }

  const entries = await readdir(releaseDir);
  for (const entry of entries) {
    if (entry === "release-manifest.json") continue;
    if (!expected.has(entry)) problems.push(`unexpected file in release folder: ${entry}`);
    const info = await lstat(path.join(releaseDir, entry));
    if (!info.isFile() || info.isSymbolicLink()) {
      problems.push(`release entry is not a regular file: ${entry}`);
    }
  }

  const sumsText = await readFile(path.join(releaseDir, "SHA256SUMS.txt"), "utf8");
  const sums = new Map();
  for (const line of sumsText.split(/\r?\n/)) {
    if (line === "") continue;
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) {
      problems.push(`SHA256SUMS.txt has an invalid line: ${line}`);
      continue;
    }
    sums.set(match[2], match[1]);
  }
  if (sums.size !== recordNames.length) {
    problems.push(`SHA256SUMS.txt has ${sums.size} entries, expected ${recordNames.length}`);
  }
  for (const record of records) {
    if (sums.get(record.name) !== record.sha256) {
      problems.push(`SHA256SUMS.txt differs for ${record.name}`);
    }
  }
  return problems;
}

const [releaseDir, version, commit] = process.argv.slice(2);
if (!releaseDir || !version || !commit) {
  console.error("usage: node installer/check-release-artifacts.mjs <release-dir> <version> <commit>");
  process.exitCode = 2;
} else {
  try {
    const problems = await check(path.resolve(releaseDir), version, commit);
    if (problems.length > 0) {
      for (const problem of problems) console.error(problem);
      process.exitCode = 1;
    } else {
      console.log(`release content check passed: 6 hashed artifacts plus SHA256SUMS.txt for ${version}`);
    }
  } catch (error) {
    console.error(`release content check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
