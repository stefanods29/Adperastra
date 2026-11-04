# Handoff integration plan

Authority: owner decision 2026-11-02 (`plan/STATUS.md`). The coordinator integrates the 54
submitted handoffs, fills missing implementations, and compiles/tests/packages them. Work stays
local on `integrate-handoffs`; `main`, remotes, tags and publication stay untouched.
Original handoffs in `handoff/` are preserved byte for byte.

## Rules for every batch

1. Read the step guide (`plan/steps/step-<id>.md`), the handoff README, and the review entries
   for that step in `docs/integration/handoff-review.md` / `step07b-review.md`.
2. Integrate into the repository only from `handoff/integration-<id>/` when that prepared copy
   exists; otherwise copy from `handoff/step-<id>/files/` and apply the shared-edit proposals.
3. Never overwrite an existing canonical file that has a different meaning for another step
   (for example 08b versus 09a `document_types.rs`, 07a versus 12a background help pages).
4. Add every Tauri command to `generate_handler!` and to the isolation allowlist; add every
   visible string to `en.json`/`es.json` and regenerate `pseudo.json`; add styles to
   `src/main.tsx` imports; add the help pages in both languages.
5. Run `cargo fmt --all`, then `.\scripts\gate.ps1`. Fix the cause of every failure. Only a
   clean `GATE PASSED` allows a commit.
6. Commit per step with `feat(<area>): <step name> [step-<id>]`; record corrections in
   `docs/step-reports/step-<id>.md`, `CHANGELOG.md` and `KNOWN_ISSUES.md`.
7. Never skip, ignore or weaken a submitted test to get a pass. Tests that need a real signed
   pack, real helper or real account stay `#[ignore]` only where the handoff already declares
   them as coordinator evidence gates; record why in the step report.
8. A step is "integrated" when it compiles, its tests pass, its commands are registered, its
   translations/help exist, and its known review defects are fixed. Speed, screenshots and
   owner checks are recorded as remaining evidence, not silently claimed.

## Batch order (dependency first)

| Batch | Steps | Reason / gate |
|---|---|---|
| 0 | 07a | Foundation: cache store, source stamp, background policy/scheduler, thumbnail helper. **In progress.** |
| 1 | 07b | Quick preview and metadata; consumes 07a cache/background/source APIs. Depends on `step07b-review.md` corrections. |
| 2 | 07c, 07d | Gallery (uses 07a thumbnails) and PDF viewer + webview helper transport (backing for later PDF/Office work). |
| 3 | 08a, 08b | Quick Convert/job queue and document/sheet/archive conversion; resolve 08b/09a `document_types.rs` collision first. |
| 4 | 09a-09f | Tabs/sessions/groups, drag between tabs, palette, bulk rename, conflict window; complete controller/commit/recovery and real adapters. |
| 5 | 09g-09k | Restart manager, split view, disk images, locked folders; replace the ignored restart test with a real one. |
| 6 | 10a-10f | Themes, toolbar/keyboard, formats/profiles, folder appearance, menu editor, accessibility. |
| 7 | 11a-11c | Search index/modes, tags/smart folders, storage/duplicates/sizes; producer-owned extractors and canonical time zone. |
| 8 | 12a, 12b | Pack manager and converters 3. Blocking rule: pack extraction/validation moves into the bounded helper before install/activation. |
| 9 | 13, 14a-14c | Office viewers, PDF tools, image editor basics, local AI runtime; accurate-page adapters and real model bridges. |
| 10 | 15, 16 | Audio/video basics and Windows integration; context-menu identity is an owner checkpoint. |
| 11 | 17a-17d | Assistant core, local actions, search, scans/PDF/writing. Local/API choice, Meta first, explicit consent. |
| 12 | 18a-19b | Advanced image editor and video timeline; typed render graph, native export. |
| 13 | 20a-22b | Office-neutral contracts, Word/Excel/PowerPoint editors, AI for documents/sheets/decks; owner engine checkpoint before binding. |

## Cross-cutting review defects to close during the batches

From `docs/integration/handoff-review.md` (H01-H15) and `step07b-review.md` (07b-01..11):

- H01 08b/09a canonical path collision: keep 09a `document_types.rs`, move 08b conversion DTOs.
- H02 directory identity/stamp route and bounded cache byte reader; no second cache.
- H03 native adapters (granted backing, pack root/version, confined child launcher, PDF pages).
- H04 pack extraction/install must run in the bounded helper (Blocker).
- H05 real llama/vision/speech/embedding dispatch, production `TurnEngine`/HTTP, microphone/PCM.
- H06 timeline graph placement/compositing/codec facts; native export.
- H07 canonical Office DTO/controller/lease contracts and editor hosts.
- H08 selected-context AI bridge; no whole-document upload or caller trust flag.
- H09 zero-based tile validation, shared layered validator, native project import/PSD bridge.
- H10 producer-owned bounded extractors; semantic result mode; one time zone resolver.
- H11 object-bound replacement/recycle proof; keep safe new-name copies meanwhile.
- H12 Office engine comparison: real Windows/local candidate evidence before owner choice.
- H13 modern Explorer menu identity/distribution alternatives before machine changes.
- H14 model/pack hashes, signatures, license inventory, confinement and quality evidence.
- H15 replace ignored/scaffold evidence tests with real process/output assertions under explicit gates.

## Status log

- 2026-11-02: 07a integrated and committed (`ee65156`): 523 Rust tests in 51 binaries,
  563 UI tests in 104 files; fixed a late-lease leak in the thumbnail service.
- 2026-11-02: 07b files, read-only guards, five commands and the metadata helper wired.
  Fixed the module tree, Arc service injection, duplicate locale block, inert restore and
  clippy findings. Final full gate passed: 584 Rust tests in 51 binaries, 608 UI tests in
  111 files, IPC and translations clean. One 06f JSON test now carries its own 15 s budget
  because the 600-test suite exceeds the 5 s default under load. Committed as `0b0880a`.
- 2026-11-03: 07c Gallery files and shared wiring applied (schema 13, five commands, grid,
  sources, settings persistence, help/locales). Fixed the missing module declaration, the
  non-existent fs-service ID call, callback ordering, and two wrong fixture paths in the
  submitted tests. Final full gate passed: 614 Rust tests in 51 binaries, 639 UI tests in
  114 files, IPC and translations clean. Committed as `1923846`.
- 2026-11-03: 07d PDF viewer and WebView helper applied with its own deps commit. Fixed the
  control-frame tag collision, the missing reply-shape check, PDF.js 6.4 shutdown, TypeScript
  7 buffer views, Clippy findings, the helper allowlist and the Default apps group count.
  Final full gate passed: 673 Rust tests in 51 binaries, 670 UI tests in 119 files, IPC and
  translations clean. Committed as `26bbdf0` with its own deps commit (`ea14385`).
- 2026-11-03: 07e payload inventoried. It needs two additive producer adapters that its
  payload does not contain: `decode_pixels_from_memory` in `thumbnail_decode.rs` and a
  `PdfOcrAdapter` implementing `ocr_pdf::OcrPdfPageSource` in `pdf.rs`.
- 2026-11-03: 07e OCR integrated with both missing adapters, schema 14 and the image/PDF
  commands. Final full gate passed: 722 Rust tests in 51 binaries, 692 UI tests in 123 files,
  IPC and translations clean. KI-096 (image/PDF OCR Find routing and the PDF word overlay) is
  fixed in the follow-up and the final gate passed (722 Rust/692 UI tests).
- 2026-11-03: 07e is complete locally. 07f inventoried but not started: its handoff declares
  twelve producer/API gaps (book WebView main-thread start, grant cloning, foliate parser
  surface, mail-parser accessors, SQLite table discovery and others). The reconciliation plan
  is in `docs/integration/step07f-plan.md`; the tree stays at the green 07e boundary.
- 2026-11-03: 07f integrated with its own deps commit (`9a9c7d9`) and implementation commit
  (`c2a377f`). Mail-parser/rusqlite API corrections, the `webview_helper_types` import path,
  the 06e three-value archive helper, Clippy findings in `data-views`, the registry priority
  rules and schema-15 tests are recorded in `docs/step-reports/step-07f.md`. Gap 11 does not
  apply (the helper window lives in the child process); the foliate/native spine counts are
  now checked. `fflate` is 0.8.3. Final full gate passed: 798 Rust tests in 51 binaries, 731
  UI tests in 134 files, IPC and translations clean. KI-097 (MOBI pictures, Major) and KI-098
  (fixed-layout pages, Minor) are open with targets. Next: 07g.

- 2026-11-03:07g implemented locally as69f778d, report719b645; full gate829Rust/777UI tests. Distinct texture-slot keys and transformed world bounds verified. Faster isolated vmThreads UI runner preserves per-file isolation (144files in about13–22s). Runtime/packaged evidence remains pending. Next08a; isolated pure converter18tests passed after resolving little_exif to0.6.23 and actual encoder APIs.
