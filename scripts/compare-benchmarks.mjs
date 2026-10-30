// Developer-only speed gate (plan/speed.md "Measuring"): every UI result must
// meet its tier, and must not be more than 20% slower than the previous
// step's result for the same interaction.
//   node scripts/compare-benchmarks.mjs <new ui json> [previous ui json]
//   node scripts/compare-benchmarks.mjs <new ui json> --tiers-only
//   node scripts/compare-benchmarks.mjs --combine <runs.json> <step> <baseline> <out json>
// A JSON with ab_baseline (written by measure-ab.ps1) is compared with that
// baseline: the previous step's build, measured alongside it on the same PC,
// so a busy PC slows both the same way. --tiers-only is for other hardware
// (GitHub runners). Otherwise the newest docs/benchmarks/*-ui-step*.json from
// a different step is used.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));

// Below 2 ms the browser's timer granularity and frame alignment dominate,
// so a "20% slower" result there is measurement noise, not a slowdown.
export const NOISE_FLOOR_MS = 2;

export const TIER_LIMITS_MS = { instant: 100, fast: 1000, waiting: 10000 };

/** Tier limit in ms for one result row (plan/speed.md tiers). Rows name their
 * tier; rows from before tiers were recorded are classed by their name. */
export function tierLimit(result) {
  // Smooth: 16 ms per frame. On a display slower than 60 Hz a frame cannot be
  // faster than the display, so the limit is the display frame (+50% for a
  // frame that is late but not dropped), never less than 16.7 ms * 1.5.
  if (result.tier === "smooth") return Math.max(result.display_frame_ms ?? 16.7, 16.7) * 1.5;
  if (result.tier) {
    if (!(result.tier in TIER_LIMITS_MS)) throw new Error(`${result.name}: unknown tier ${result.tier}`);
    return TIER_LIMITS_MS[result.tier];
  }
  if (/\bjobs?\b|classic menu|separate process/i.test(result.name)) return TIER_LIMITS_MS.fast;
  return TIER_LIMITS_MS.instant;
}

export function compareBenchmarks(current, previous) {
  const problems = [];
  const rows = [];
  const before = new Map((previous?.results ?? []).map((row) => [row.name, row]));
  for (const row of current.results ?? []) {
    const limit = tierLimit(row);
    const old = before.get(row.name);
    const tierOk = row.median_ms <= limit;
    const slower = old && row.median_ms > old.median_ms * 1.2 && row.median_ms - old.median_ms > NOISE_FLOOR_MS;
    if (!tierOk) problems.push(`${row.name}: ${row.median_ms} ms is over the ${Math.round(limit)} ms tier`);
    if (row.tier === "smooth" && row.dropped_frames > 0 && row.dropped_frames / row.runs > 0.05) {
      problems.push(`${row.name}: ${row.dropped_frames} of ${row.runs} frames dropped`);
    }
    if (slower) problems.push(`${row.name}: ${row.median_ms} ms is more than 20% slower than ${old.median_ms} ms (step ${previous.step})`);
    rows.push({ name: row.name, limit_ms: Math.round(limit * 10) / 10, median_ms: row.median_ms, previous_ms: old?.median_ms ?? null, pass: tierOk && !slower });
  }
  return { problems, rows };
}

const median = (values) => {
  const sorted = values.filter((value) => typeof value === "number").sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

/** Rows that are the median of several runs (each run is itself a median). */
export function combineRuns(runs) {
  const names = [...new Set(runs.flatMap((run) => run.results.map((row) => row.name)))];
  return names.map((name) => {
    const rows = runs.map((run) => run.results.find((row) => row.name === name)).filter(Boolean);
    return {
      ...rows[0],
      median_ms: median(rows.map((row) => row.median_ms)),
      max_ms: Math.max(...rows.map((row) => row.max_ms ?? 0)),
      run_medians_ms: rows.map((row) => row.median_ms),
    };
  });
}

export function previousBenchmark(dir, step) {
  const files = readdirSync(dir).filter((name) => /-ui-step[\w]+\.json$/.test(name)).sort();
  for (const name of files.reverse()) {
    const data = readJson(path.join(dir, name));
    if (data.step !== step) return { name, data };
  }
  return null;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && process.argv[2] === "--combine") {
  const [, , , runsFile, step, baseline, outFile] = process.argv;
  const raw = readJson(runsFile);
  const parse = (list) => list.map((text) => JSON.parse(text.replace(/^﻿/, "")));
  const record = {
    date: new Date().toISOString(),
    step,
    build: "release (tauri build --no-bundle)",
    method: `Inside the packaged app's page: action to the next painted frame. Each row is the median of ${raw.current.length} runs (each run the median of 7), measured alternately with ${baseline} on the same PC.`,
    language: "en",
    theme: "light",
    results: combineRuns(parse(raw.current)),
    ab_baseline: { build: baseline, step: baseline, results: combineRuns(parse(raw.baseline)) },
  };
  writeFileSync(outFile, JSON.stringify(record, null, 2) + "\n");
  console.log(`saved ${outFile}`);
} else if (isMain) {
  const current = readJson(process.argv[2]);
  const tiersOnly = process.argv[3] === "--tiers-only";
  const previous = tiersOnly
    ? null
    : current.ab_baseline
      ? { name: `${current.ab_baseline.build}, measured alongside`, data: current.ab_baseline }
      : process.argv[3]
        ? { name: process.argv[3], data: readJson(process.argv[3]) }
        : previousBenchmark(path.join(root, "docs", "benchmarks"), current.step);
  const { problems, rows } = compareBenchmarks(current, previous?.data);
  console.log(tiersOnly ? `Checked step ${current.step} against the tiers only (other hardware).` : `Compared step ${current.step} with ${previous ? previous.name : "no earlier step"}.`);
  for (const row of rows) console.log(`${row.pass ? "PASS" : "FAIL"}  ${row.name}: ${row.median_ms} ms (tier ${row.limit_ms} ms, before ${row.previous_ms ?? "-"} ms)`);
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exitCode = 1;
}
