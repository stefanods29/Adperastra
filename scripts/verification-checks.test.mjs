import test from "node:test";
import assert from "node:assert/strict";
import { licenseAllowed, repositoryFileProblems, helpProblems, npmLicenseProblems } from "./verification-checks.mjs";

test("a disjunction needs one allowed license and a conjunction needs every license", () => {
  assert.equal(licenseAllowed("MIT OR GPL-3.0-only"), true);
  assert.equal(licenseAllowed("MIT AND GPL-3.0-only"), false);
  assert.equal(licenseAllowed("(GPL-3.0-only OR MIT) AND Apache-2.0"), true);
  assert.equal(licenseAllowed("(MIT OR ISC) AND (GPL-3.0-only OR AGPL-3.0-only)"), false);
});

test("missing, malformed and unexpected license terms fail closed", () => {
  for (const text of [undefined, "", "MIT OR", "MIT ISC", "(MIT", "MIT)", "UNLICENSED", "MIT WITH unknown-exception", "MIT; GPL-3.0-only"]) {
    assert.equal(licenseAllowed(text), false, String(text));
  }
  assert.equal(licenseAllowed("(MPL-2.0 OR Apache-2.0)"), true);
  assert.equal(licenseAllowed("Unicode-3.0 AND BSL-1.0"), true);
});

test("tracked files over 50 MB and private keys are rejected without exposing values", () => {
  assert.equal(repositoryFileProblems("normal.txt", Buffer.from("hello")).length, 0);
  assert.match(repositoryFileProblems("large.dat", Buffer.alloc(0), 50 * 1024 * 1024 + 1).join(), /50 MB/);
  const privateKey = ["-----BEGIN", "PRIVATE", "KEY-----"].join(" ");
  const problems = repositoryFileProblems("bad.txt", Buffer.from(privateKey));
  assert.match(problems.join(), /private key/i);
  assert.equal(problems.join().includes(privateKey), false);
  assert.match(repositoryFileProblems("nested/dev.key", Buffer.alloc(0)).join(), /key file/i);
  assert.match(repositoryFileProblems("nested/.adperastra/private.txt", Buffer.alloc(0)).join(), /forbidden/i);
});

test("help parity and local links fail on missing pages and traversal", () => {
  const files = new Map([
    ["en/start.md", "[Next](next.md)"], ["en/next.md", "# Next"],
    ["es/start.md", "[Next](next.md)"], ["es/next.md", "# Siguiente"],
  ]);
  assert.deepEqual(helpProblems(files), []);
  files.delete("es/next.md");
  assert.match(helpProblems(files).join(), /missing es\/next.md/i);
  files.set("en/start.md", "[Unsafe](../../private.md)");
  assert.match(helpProblems(files).join(), /outside help/i);
});

test("npm licenses: shipped packages must be allowed; dev and documented not-bundled packages are skipped", () => {
  const packages = {
    "": { name: "app" },
    "node_modules/ok": { version: "1.0.0", license: "MIT" },
    "node_modules/bad": { version: "1.0.0", license: "GPL-3.0-only" },
    "node_modules/devtool": { version: "1.0.0", license: "BlueOak-1.0.0", dev: true },
    "node_modules/cli-only": { version: "1.0.0", license: "PSF-2.0" },
  };
  const reason = "Used only by a command-line program that the app never imports.";
  const result = npmLicenseProblems(packages, { "node_modules/cli-only": reason });
  assert.deepEqual(result.problems, ["node_modules/bad@1.0.0: license needs approval: GPL-3.0-only"]);
  assert.equal(result.checked, 2);
  assert.match(npmLicenseProblems(packages).problems.join(), /cli-only/);
  assert.throws(() => npmLicenseProblems(packages, { "node_modules/cli-only": "" }), /reason/);
});

test("speed gate: tier misses and >20% slowdowns fail, timer noise does not", async () => {
  const { compareBenchmarks } = await import("./compare-benchmarks.mjs");
  const previous = { step: "03a", results: [
    { name: "menu", median_ms: 5 }, { name: "select", median_ms: 20 }, { name: "copy job", median_ms: 400 },
  ] };
  const ok = compareBenchmarks({ step: "03b", results: [
    { name: "menu", median_ms: 6.5 }, { name: "select", median_ms: 23 }, { name: "copy job", median_ms: 450 }, { name: "restore (jobs)", median_ms: 300 },
    { name: "scroll", median_ms: 18, runs: 100, dropped_frames: 1, display_frame_ms: 16.7, tier: "smooth" },
  ] }, previous);
  assert.deepEqual(ok.problems, []);
  const bad = compareBenchmarks({ step: "03b", results: [
    { name: "menu", median_ms: 120 }, { name: "select", median_ms: 30 }, { name: "copy job", median_ms: 1200 },
    { name: "scroll", median_ms: 40, runs: 100, dropped_frames: 20, display_frame_ms: 16.7, tier: "smooth" },
  ] }, previous);
  const text = bad.problems.join("\n");
  assert.match(text, /menu: 120 ms is over the 100 ms tier/);
  assert.match(text, /select: 30 ms is more than 20% slower/);
  assert.match(text, /copy job: 1200 ms is over the 1000 ms tier/);
  assert.match(text, /scroll: 20 of 100 frames dropped/);
});

test("speed gate: several runs combine into their median row by row", async () => {
  const { combineRuns } = await import("./compare-benchmarks.mjs");
  const run = (a, b) => ({ results: [{ name: "a", median_ms: a, max_ms: a + 1 }, { name: "b", median_ms: b }] });
  const rows = combineRuns([run(10, 5), run(30, 6), run(12, 50)]);
  assert.equal(rows.find((r) => r.name === "a").median_ms, 12);
  assert.equal(rows.find((r) => r.name === "a").max_ms, 31);
  assert.equal(rows.find((r) => r.name === "b").median_ms, 6);
});
