// Developer-only checks. No app code or dependency is added by this file.
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(readFileSync(path.join(root, "scripts/license-policy.json"), "utf8"));
const allowed = new Set(policy.allowed);

// SPDX precedence is parentheses, WITH, AND, then OR. Parse every branch,
// even when a boolean result is already known, so malformed input fails.
export function licenseAllowed(expression) {
  if (typeof expression !== "string" || !expression.trim()) return false;
  const tokens = expression.match(/[A-Za-z0-9.+-]+|[()]/g) ?? [];
  if (tokens.join("") !== expression.replace(/\s/g, "")) return false;
  let cursor = 0;
  function atom() {
    if (tokens[cursor] === "(") {
      cursor++;
      const value = or();
      if (tokens[cursor++] !== ")") throw new Error("unclosed license group");
      return value;
    }
    const id = tokens[cursor++];
    if (!id || ["AND", "OR", "WITH", ")"].includes(id)) throw new Error("expected license");
    if (tokens[cursor] === "WITH") {
      cursor++;
      const exception = tokens[cursor++];
      if (!exception || ["AND", "OR", "WITH", "(", ")"].includes(exception)) throw new Error("expected exception");
      return allowed.has(`${id} WITH ${exception}`);
    }
    return allowed.has(id);
  }
  function and() {
    let value = atom();
    while (tokens[cursor] === "AND") {
      cursor++;
      const next = atom();
      value = value && next;
    }
    return value;
  }
  function or() {
    let value = and();
    while (tokens[cursor] === "OR") {
      cursor++;
      const next = and();
      value = value || next;
    }
    return value;
  }
  try {
    const value = or();
    return cursor === tokens.length && value;
  } catch { return false; }
}

export function repositoryFileProblems(relative, content, size = content.length) {
  const problems = [];
  const name = relative.replaceAll("\\", "/");
  if (/(^|\/)\.adperastra(\/|$)/i.test(name)) problems.push(`${relative}: forbidden signing-key directory`);
  if (/\.key$/i.test(name)) problems.push(`${relative}: private key file must never be tracked`);
  if (size > 50 * 1024 * 1024) problems.push(`${relative}: exceeds 50 MB`);
  const text = content.toString("utf8");
  const patterns = [
    /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
  ];
  if (patterns.some((pattern) => pattern.test(text))) problems.push(`${relative}: possible private key or access token (value withheld)`);
  return problems;
}

export function helpProblems(files) {
  const problems = [];
  const ids = new Set([...files.keys()].map((name) => name.split("/").slice(1).join("/")));
  for (const id of ids) for (const lang of ["en", "es"]) {
    if (!files.has(`${lang}/${id}`)) problems.push(`missing ${lang}/${id}`);
  }
  for (const [name, content] of files) {
    for (const match of content.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
      let decoded;
      try { decoded = decodeURIComponent(target.split("#")[0]); }
      catch { problems.push(`${name}: invalid help link`); continue; }
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), decoded));
      if (!resolved.startsWith(`${name.split("/")[0]}/`) || decoded.includes("\\")) problems.push(`${name}: link outside help: ${target}`);
      else if (!files.has(resolved)) problems.push(`${name}: missing linked page ${resolved}`);
    }
  }
  return problems;
}

function repositoryProblems() {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const problems = [];
  for (const name of tracked) {
    const full = path.resolve(root, name);
    if (!full.startsWith(root + path.sep) || /(^|[\\/])\.adperastra([\\/]|$)/i.test(name) || /\.key$/i.test(name)) {
      problems.push(`${name}: forbidden tracked path (not read)`);
      continue;
    }
    let stat;
    try { stat = lstatSync(full); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (!stat.isFile() || !realpathSync(full).startsWith(realpathSync(root) + path.sep)) {
      problems.push(`${name}: tracked links and non-files are not scanned`);
      continue;
    }
    const content = stat.size > 50 * 1024 * 1024 ? Buffer.alloc(0) : readFileSync(full);
    problems.push(...repositoryFileProblems(name, content, stat.size));
  }
  console.log(`Scanned ${tracked.length} tracked paths; excluded folders were never enumerated.`);
  return problems;
}

function npmLicenseProblems() {
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const entries = Object.entries(lock.packages).filter(([name]) => name);
  const problems = entries.filter(([, item]) => !licenseAllowed(item.license))
    .map(([name, item]) => `${name}@${item.version}: license needs approval: ${item.license ?? "missing"}`);
  console.log(`Checked licenses of ${entries.length} npm packages, including development and optional dependencies.`);
  return problems;
}

function allHelpProblems() {
  const files = new Map();
  for (const lang of ["en", "es"]) for (const name of readdirSync(path.join(root, "help", lang))) {
    if (name.endsWith(".md")) files.set(`${lang}/${name}`, readFileSync(path.join(root, "help", lang, name), "utf8"));
  }
  console.log(`Checked ${files.size} help pages.`);
  return helpProblems(files);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  let problems = [];
  if (mode === "repo") problems = repositoryProblems();
  else if (mode === "licenses") problems = npmLicenseProblems();
  else if (mode === "help") problems = allHelpProblems();
  else if (mode === "cargo-config") {
    if (!process.argv[3]) throw new Error("cargo-config needs an output path");
    writeFileSync(process.argv[3], `[licenses]\ninclude-dev = true\ninclude-build = true\nconfidence-threshold = 0.95\nallow = ${JSON.stringify(policy.allowed)}\n`);
  } else throw new Error("expected repo, licenses, help or cargo-config");
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exitCode = 1;
}
