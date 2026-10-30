// check-base.mjs - is this repository the one the plan was written for?
// Run: node scripts/check-base.mjs   (Step P2, task T0)
//
// plan/base.json lists the files that the next step recipes change, with
// the Git hash each file had when the recipes were written. A different
// hash means the file changed since then (for example a late fix in Step
// 03b), so a recipe's "find exactly" blocks or full-file replacements may
// not fit any more. Exit code 0: all match. Exit code 1: list of changes.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = JSON.parse(readFileSync(join(root, "plan", "base.json"), "utf8"));
const changed = [];
for (const [path, expected] of Object.entries(base.files)) {
  let actual;
  try {
    actual = execFileSync("git", ["hash-object", "--", path], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    actual = "(missing)";
  }
  if (actual !== expected) changed.push(`${path}: expected ${expected.slice(0, 12)}, found ${actual.slice(0, 12)}`);
}
if (changed.length > 0) {
  console.error(`Base check FAILED: ${changed.length} file(s) changed since the plan was written (base commit ${base.commit}):`);
  for (const line of changed) console.error(`  ${line}`);
  console.error("Stop and tell the owner (plan/steps/step-P2.md, task T0).");
  process.exit(1);
}
console.log(`Base check passed (${Object.keys(base.files).length} files match commit ${base.commit}).`);
