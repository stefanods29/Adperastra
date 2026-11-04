// copy-pdfjs-assets.mjs - copies the pinned PDF.js worker assets into
// public/pdfjs so the trusted PDF helper serves its own CMaps and standard
// fonts from the app's own origin (Step 07d D4).
//
// Run: npm run pdfjs:assets (before `vite` and `vite build`).
// Nothing is downloaded: the files come from node_modules/pdfjs-dist at the
// exact pinned version. No wasm, no CDN, no remote font.

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "pdfjs-dist");
const target = join(root, "public", "pdfjs");

if (!existsSync(source)) {
  console.error("pdfjs-dist is not installed. Run npm ci before building.");
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

for (const folder of ["cmaps", "standard_fonts"]) {
  const from = join(source, folder);
  if (!existsSync(from)) {
    console.error(`pdfjs-dist has no ${folder} folder; the pinned package is incomplete.`);
    process.exit(1);
  }
  cpSync(from, join(target, folder), { recursive: true });
}

console.log("PDF.js CMaps and standard fonts copied to public/pdfjs");
