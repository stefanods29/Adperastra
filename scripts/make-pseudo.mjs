// make-pseudo.mjs - generate src/i18n/locales/pseudo.json from en.json.
//
// Run:  npm run i18n:pseudo
// Never edit pseudo.json by hand: this script owns it, and
// `npm run lint:i18n` fails when pseudo.json is out of date.
//
// Every English string becomes "[" + accented text + padding + "]":
// letters get accents (so missing translations stand out), the text grows
// by about 40% (so cut-off labels show up), and the ICU structure
// ({name}, plural/select options, "#") is kept exactly, so messages still
// format with their arguments.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, print } from "./icu-lite.mjs";

const ACCENTS = {
  a: "ä", e: "ë", i: "ï", o: "ø", u: "ü", y: "ÿ", c: "ç", n: "ñ",
  A: "Ä", E: "Ë", I: "Ï", O: "Ø", U: "Ü", Y: "Ÿ", C: "Ç", N: "Ñ",
};

function accent(text) {
  let out = "";
  for (const ch of text) out += ACCENTS[ch] ?? ch;
  return out;
}

function letterCount(nodes) {
  let count = 0;
  for (const node of nodes) {
    if (node.type === "text") count += (node.value.match(/[A-Za-z]/g) ?? []).length;
    if (node.type === "choice") {
      count += Math.max(0, ...node.options.map((option) => letterCount(option.nodes)));
    }
  }
  return count;
}

export function pseudoString(english) {
  const nodes = parse(english);
  const padding = "~".repeat(Math.max(2, Math.ceil(letterCount(nodes) * 0.4)));
  return `[${print(nodes, accent)} ${padding}]`;
}

export function pseudoTree(value) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = pseudoTree(child);
    return out;
  }
  if (typeof value !== "string") return value;
  return pseudoString(value);
}

export function renderPseudoJson(enJson) {
  return `${JSON.stringify(pseudoTree(enJson), null, 2)}\n`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const enPath = join(root, "src/i18n/locales/en.json");
  const pseudoPath = join(root, "src/i18n/locales/pseudo.json");
  const en = JSON.parse(readFileSync(enPath, "utf8").replace(/^﻿/, ""));
  writeFileSync(pseudoPath, renderPseudoJson(en), "utf8");
  console.log("pseudo.json written from en.json.");
}
