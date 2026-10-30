# Adperastra — Architecture (Step 00 proposal)

Status: **proposal for owner approval**. No app code exists yet. This document
designs every contract in `plan/contracts.md` so later steps plug in instead of
rewriting earlier ones. Shared files win over this document on conflict
(`plan/rules.md`, `plan/speed.md`, `plan/git-and-testing.md`, `plan/contracts.md`).

## 1. Recommended stack (confirming AGENTS.md section 3)

| Option | Speed / size | Web editors reuse | Cross-platform path | License | Verdict |
|---|---|---|---|---|---|
| **Tauri 2 + Rust core + TypeScript UI (recommended)** | Small installer, low idle RAM; Rust is C/C++-class speed and memory-safe for untrusted files | Direct (CodeMirror, PDF.js, canvas run in the system webview) | Yes — macOS/Linux webviews exist; Windows code stays behind Rust service traits | Tauri MIT/Apache-2.0 | **Confirm.** Per-webview capabilities + isolation pattern give the sandbox `rules.md` s.5 requires |
| WinUI 3 / Windows App SDK + WebView2 (C#) | Fast, but two stacks | Via C#-to-JS bridging for every editor | No — Windows only | Windows App SDK MIT | Reject: discards the Rust core and the later-port goal |
| Electron | Largest download and idle RAM; Node is the wrong place for fast file work, so a Rust sidecar would be needed anyway | Direct | Yes | MIT | Reject: size/RAM fight `speed.md`; duplicates Tauri, worse |
| Avalonia (.NET) | Good, but mature editors still need an embedded webview | Awkward | Yes | MIT | Reject: pays the webview cost without the web ecosystem |
| Qt 6 | Fast | Awkward (Qt WebEngine is another Chromium) | Yes | **LGPL** — only allowed as separate replaceable DLLs, never the app shell | Reject: license gate + C++ memory-safety risk on untrusted files |

Study-only references: Files (files-community, MIT — study, and code reuse only if ever relevant), Spacedrive (AGPL) and Explorer++ (GPL) — ideas only, never code.

**UI framework: React + Vite + TypeScript (recommended).** Svelte and Solid are
both faster in micro-benchmarks, but the hard parts of this app are mature
accessible primitives (React Aria / Radix), virtualized lists and tables
(TanStack), and wrappers for CodeMirror / PDF.js / Fabric / Konva / PixiJS —
all strongest in React, and Step 01b's component gallery assumes them.
Mitigations for React's cost: lazy bundle per handler, virtualized lists,
strict TS, and the standing rule that heavy work never runs in TypeScript.
Styling is design tokens (JSON) compiled to CSS variables; no CSS framework is
locked in Step 00 because every component is ours and token-styled.

## 2. Process and trust architecture

```
 setup launcher (01a, tiny native Rust)
   reads signed dependencies.json -> verifies -> repairs -> starts app
        |
 Tauri app
   |- Webview UI (React/TS) ............ presentation only
   |    Explorer tab + isolated context per file tab
   |    calls Rust ONLY through typed, capability-checked commands
   |- Rust core (src-tauri + crates/) ... disk, jobs, search, cache, AI host
   |- Helper processes (low privilege, no network, CPU/RAM job limits)
   |    PDF render, archives, unusual image decode, OCR, FFmpeg,
   |    Office engine pack, AI runtime pack
   '- App data (fully reported in Settings > App storage, 12a)
        settings.json, cache.sqlite, versions/, packs/, indexes/, logs/
```

Every webview command is serde-typed, length-limited, path-canonicalized and
checked against what that tab may touch. Strict CSP (`default-src 'self'`, no
eval, no remote scripts). Untrusted markup (HTML/SVG/email/notebooks) renders
only in a sandboxed frame: scripts off, unique origin, no app commands, no
network. Risky parsers live in helper processes that can be killed/restarted.

## 3. Contract interface sketches

Notation: Rust types are `serde` structs; TypeScript types mirror them. Every
command returns `Result<T, AppError>` with `AppError { code, message_key, detail }`
— `message_key` is translated, never hardcoded text. IDs are opaque strings.
Anything slow is cancellable and reports through the job runner.

| # | Contract (built in) | Interface sketch |
|---|---|---|
| 1 | Setup window + dependency manifest (01a) | `dependencies.json { schema, components[{id, version, source_url, sha256, size, required}], signature }`; launcher `verify() -> Missing[]` in the Instant tier (metadata first, hashes only for suspects), `repair(missing) -> Job`. Same manifest extends to packs (12a) with license + per-file hashes |
| 2 | Design tokens + theme engine (01b) | `tokens.json { color, font, space, radius, shadow, motion, accent{file_type} }` -> CSS variables `--adp-*`; themes are token overrides only; theme adapters restyle third-party surfaces |
| 3 | Settings + i18n (01b) | One versioned `settings.json` + migration chain; `t(key, icu_args)`; runtime switch en / es-419 (+ pseudo-locale in tests); locale-aware formatting everywhere; hardcoded-text lint fails builds |
| 4 | Help system (01b) | `help/<lang>/<feature>.md`; `open_help(context_id)` via F1 and "?" buttons; sandboxed rendering; background search index |
| 5 | Security base (01b, helpers 04a) | Tauri capability set per webview; isolation hook validates every invoke; `validate_path(tab_scope, path) -> CanonicalPath`; `spawn_helper(kind, files) -> Handle` with limits, no network |
| 6 | Crash capture (01b) | Local panic log + minidump (never uploaded); `session.json` every few seconds — format must already fit tab groups/split (09a) and recovery UI (09c) |
| 7 | Command registry (02) | `Command { id, label_key, icon, shortcut?, enabled_when(ctx), risk: ReadOnly/Change/Recycle/Irreversible, help_page, run(ctx) }`; context is focus-scoped (resolves Ctrl+Tab and Ctrl+1..n clashes later). Callers: bars, menus, ribbons, palette, DnD, assistant. Recycle = undoable (Recycle Bin); the assistant may use it only after the two different confirmations. Irreversible = cannot be undone (permanent delete and similar); never exposed to the assistant, and the UI warns before running it. |
| 8 | File-system service (02) | `list_dir(path) -> stream<Item>`, `stat`, `watch(path) -> stream<FsEvent>`, `read_range`. `Item { path, name, kind, size, mtime, attrs{hidden, system, link_target?, online_only, file_id} }`. Backing store is an enum from day one: `RealPath / ArchivePath / ContainerPath` (06c, 09e). `file_id` = stable Windows file ID (10b, 11b) |
| 9 | Menus from commands (03a) | `MenuDef = [CommandRef / Submenu / Separator]` per surface; one renderer; user-editable in 10b without format change |
| 10 | Job runner + scheduler (03b) | `submit(JobSpec{kind, priority, items}) -> JobId`; progress/pause/resume/cancel/per-item retry; per-drive serialization + verify hooks reserved (09c); background work obeys Background-work settings |
| 11 | Undo stack (03b) | `push({label_key, undo, redo, undoable})` plus `begin_group(label_key)/end_group()` grouping so bulk rename and batch actions undo as one step; entries with `undoable: false` make the UI warn before the action runs; one stack for Ctrl+Z, toasts, Recent actions, assistant |
| 12 | Drag-and-drop service (03b) | `DragPayload = Files / Tabs / Content{text?, cells?, image?, pages?}` — content kinds reserved now (09a, 19a); drops resolve to undoable jobs |
| 13 | Handler registry + open pipeline (04a) | `Handler { id, version, detect(head, ext) -> score, thumbnail?, metadata?, viewer(lazy), editor?(lazy), ribbon?, conversions[], help_page, speed_tier, tab_state{save, restore}, drop_behavior?, ai_actions? }`; pipeline detect -> preview -> mount -> upgrade; prefetch at ~150 ms hover; Mark-of-the-Web protected view is an input every handler honors. `tab_state`/`drop_behavior` are mandatory (09a/09d) |
| 14 | Default apps (04a) | `open_with(path)` with per-extension remembered choice; Settings > Default apps; text/hex only as explicit commands |
| 15 | Cache store (04a) | SQLite index + disk blobs keyed `path+size+mtime+handler_version`, LRU under a size cap; `report_storage()` feeds App storage from v1 |
| 16 | Ribbon framework (04b) | `RibbonDef = Tabs[Groups[Button/Toggle/Split/Gallery/Custom]]` bound to commands or engine state; Alt key-tips; skeleton while loading; dockable any side (05); per-pane context (09d) and engine-state binding (20a) designed in |
| 17 | Layout engine (05) | Layout as JSON in settings (bars/panels per side, presets); default preset = Figma; panels can register late (shelf, 09c) |
| 18 | View modes (05) | `ItemSource = Folder(path) / Search(query) / Virtual(kind, params)` — non-folder sources are first-class (11b); all views virtualized |
| 19 | Version store (06b) | `before_modify(path, source) -> VersionId`, deduplicated/compressed, background, never delays a save; history/compare/restore. **The hook exists in save paths from 06a**, before the store lands in 06b |
| 20 | Archive service (06c) | An archive is a backing store (contract 8): list/preview/extract/create, zip-bomb (size+ratio) and path-traversal limits, helper process |
| 21 | Metadata service (07a) | `metadata(path) -> {exif?/media?/document?}`; feeds Details pane (with extension sections for 06b/08b), columns, search, tags |
| 22 | OCR service (07b) | `ocr(path/page) -> {text, regions}`, cached; Windows.Media.Ocr first, Tesseract as a later pack; background OCR skips online-only files |
| 23 | Converter registry (08a) | `Converter { id, inputs[], outputs[], options_schema, engine, estimate(), run() }`; UI generated from the schema — must already fit media time-range/codec options (12b); never overwrites by default (overwrite via contract 19) |
| 24 | Privacy cleaner (08b) | `inspect(path) -> Finding[]`, `clean(path, ids) -> new_file`; opt-in only, keep-by-default; reuses converter/job plumbing |
| 25 | Release pipeline (08c) | Tag on `main` -> GitHub Actions -> installer + portable zip + SHA-256 + draft release for owner approval; `data_root()` abstraction from 01b enables portable mode and uninstall keep/remove |
| 26 | Tab sessions (09a) | Session = handler `tab_state` (contract 13) for tabs/groups/split; saved groups are a versioned file; restore loads visible tab first |
| 27 | Encrypted containers (09e) | A container is a `ContainerPath` backing store (contract 8); reviewed crypto only (`age`/`rage`, Argon2/scrypt); lock/unlock are verified atomic-swap jobs |
| 28 | Setup files (10b) | `.adperastra-setup` = zip of JSON + images; part-by-part preview before import; no code; no personal data unless ticked |
| 29 | Index service (11a) | Filename + metadata index always, content index opt-in, watcher-fed (contract 8); background indexing never reads online-only placeholders; incremental queries for Instant search |
| 30 | Search modes (11a) | `SearchMode { id, label_key, parse, run }`; Name/Content/Filters/Regex built in, AI modes (17c) register later; prefixes `name: text: re: ask: photo:` reserved now |
| 31 | Tag store (11b) | Tags keyed by `file_id + path`, survive rename/move; writing tags into file metadata off by default |
| 32 | Pack manager + App storage (12a) | Pack = contract 1 manifest + `enables[]`; install/update/remove as jobs; App storage aggregates `report_storage()` from every store — no hidden storage |
| 33 | Engine adapters (12b) | `EngineAdapter { command_map, state -> ribbon_state, helper lifecycle }` for FFmpeg and the Office engine; generic shape reused by 13/15/20a |
| 34 | Local AI runtime (14c) | Helper process `load_model / run(streaming) / cancel / unload`; GPU (Vulkan/DirectML) with CPU fallback, memory limits, idle unload, no network; generic, not upscale-shaped (17a-d reuse it) |
| 35 | AI evaluation harness (17a) | Versioned EN+ES sets per AI feature, automatic scoring in step reports; prompt-injection set must be refused |
| 36 | Assistant tools (17a) | Generated from the command registry: typed args, risk enforced (read-only runs free; changes previewed; recycle needs two different confirmations; permanent delete never exposed). Every tool call goes through `validate_path` with the **assistant scope**: the active tab, items the user mentions or selects, plus folders the user explicitly granted; anything outside that scope needs explicit permission first. |
| 37 | Section registries: Home + navigation pane (shell in 02; late sections in 09a/10b/11b) | `SectionRegistry.register({ id, label_key, icon, order, render, visible_when })` — sections register late, like layout panels (contract 17): Saved groups (09a), customizable Home/nav pane (10b), Tags and Views sections (11b) plug in without touching the Explorer shell. |

## 4. Repository structure (proposed)

```
Adperastra/
  AGENTS.md, ARCHITECTURE.md, README.md, LICENSE, CHANGELOG.md (01b)
  plan/                      the build plan
  src/                       React + TypeScript UI (01b): app, components,
                             handlers, ribbons, themes, i18n
  src-tauri/                 Tauri app and Rust entry (01b)
  crates/                    Rust workspace: core, fs-service, jobs,
                             handlers, search, ai-runtime, setup (01a)
  help/en/, help/es/         one Markdown page per feature per language
  locales/en/, locales/es/   ICU translation files (pseudo-locale in tests)
  themes/                    built-in theme token files
  docs/decisions/, docs/benchmarks/, docs/design-inventory.md,
       docs/test-and-speed-plan.md
  tests/, e2e/, fuzz/, bench/   never shipped (verified in 08c)
  test-files/                corpus generated by scripts; large files ignored
  scripts/                   test-all.ps1 and generators
```

## 5. Decisions that protect later steps (from reading all 52 step files)

1. Handler tab-state + drop/content hooks are mandatory from 04a (09a, 09d).
2. FS backing-store kinds and stable file IDs exist from 02 (06c, 09e, 10b, 11b).
3. `before_modify` version hook precedes the version store (06a before 06b).
4. Ribbon binds engine state and works per pane; layout accepts late panels.
5. Shortcuts are remappable and focus-scoped, absorbing the Ctrl+Tab and
   Ctrl+1..9 (tabs) vs Ctrl+1..7 (tags) overlaps without hardcoding.
6. The Office engine stays a **separate, replaceable program in a pack**
   (LibreOffice: MPL-2.0 core, LGPL parts). Natively linking LibreOfficeKit
   into the Rust core would break the license gate. See
   `docs/decisions/0003-office-engine-licensing.md`.
7. Every AI model, dictionary and font license is verified per exact file
   before a pack ships; candidates named in `plan/ai.md` (Qwen, Gemma, ...)
   are **not** pre-approved. LGPL only as a separate replaceable program/DLL
   with notices + source links; GPL/AGPL/non-commercial never bundled.

## 6. Step order and difficulty

Confirmed unchanged. Every apparent conflict found across the step files is a
clarification, not a reordering. Example: "Open in Terminal" is a menu entry
registered in 03a and completed/documented in 09d. The three hardest clusters
(18, 19, 20-22) stay last; 20a keeps its throwaway-spike design so the Office
engine risk is retired with evidence before any editor is built on it.

## File-operation safety (contract 10, Step 03b)

`FileOpRequest.allow_system` defaults to `false`. A job checks fresh metadata before making any change, including system items nested inside moved/deleted folders and existing Replace targets. If confirmation is needed, the job returns `ops.system_confirmation_required` with no changes; the UI shows a translated warning with Cancel focused and can retry that same operation once with `allow_system: true` after Continue. Ordinary jobs never show this warning. Cancellation during the check returns a cancelled report without changing files. The check reads metadata only, reports progress through the existing job transport, and never reads file contents.

Drive/share roots and the actual Windows/Program Files folders are always refused; confirmation cannot override this. Destructive operations do not follow directory links or junctions: a top-level item containing one is skipped with `link_not_supported`, leaving its source untouched. Copy keeps its existing source loop guard; Replace target checks also refuse directory reparse points. Metadata failures are skipped and reported. Undo/Redo transfer jobs check their existing source and destination paths under the same rules; missing counterpart paths are expected and are left for the operation engine to validate.

## Step 03b: exact transfer effects for Undo (contracts 10 and 11)

A move report retains an exact transfer plan even when cancelled or only partly successful. Each TransferEffect records from, to, kind (file, directory scaffold, or atomic tree rename), source_removed, and destination_created. Directory scaffolds are never mistaken for an atomic renamed tree. File targets are the actual names written, including Keep both names. Effects are recorded as disk changes succeed; completed remains a user-facing top-level summary, never the source of truth for Undo.

Undo first recreates source directory scaffolds that the operation removed, moves back only items whose sources were actually removed, recycles copies whose sources remain, and removes only empty directory scaffolds it created. Pre-existing merged destination contents are untouched. The exact replaced Recycle Bin entries are restored afterward. Redo repeats only recorded effects, including retained copies, and removes only empty source scaffolds that were originally removed; it never retries skipped source files.

Undo and redo never overwrite a new item at an expected target, and nonempty scaffolds changed by another program are preserved. A skipped, failed, or cancelled history operation raises its translated error and leaves the history cursor unchanged. The existing file_op_start transport executes transfer history as a job with cancel/progress and the same absolute-path, root, reparse-point and system-item checks as other operations. Transfer plans stay in Rust behind opaque identifiers so a large folder does not turn into a large UI response; identifiers are local, bounded with the 100-entry undo history, and never commands or paths supplied without validation.

Transfer history reserves at most 32 MiB per forward operation before any mutation and keeps at most 100 referenced plans within 128 MiB total. Capacity exhaustion returns FsError::UndoLimit / ops.undo_limit, not a filename error; no effects are clipped or silently evicted. The user can select fewer items or restart to begin a fresh local history. Plans already referenced by Undo/Redo, including pending groups and in-flight jobs, remain retained.
