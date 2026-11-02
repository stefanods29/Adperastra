# Coding assignment: step 07d — PDF viewer

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-07d.md](../steps/step-07d.md). Guide SHA-256: `0a2037ab81e8b3ebaa6774acfd2ac74738aff9e628b189527e2b16219d6ab3b2`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-07d-pdf-viewer |
| Tag | v0.0.23-step07d |
| Depends on | 07a cache/helper, 07b preview, 04b ribbon |
| Written before | 07a was built |
| Interface revision | pdf-reader-2, preview-foundation-1; helper-transport-1; file-backing-1 |

Settings reservation: 13 -> 13; screenshot reservations: 64-66. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 07b producer guide](../steps/step-07b.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| Ref | Producer and canonical name | Exact use |
|---|---|---|
| U1 | 07a E1-E5: CacheStore/CacheKey/SourceStamp/CacheLease, CacheService.source_stamp/lease/release, releaseCacheLease | kind pdf_page; options page/rotation/render bucket; per-kind blob cap8MiB; no guessed token/path |
| U2 | 06d helper.rs/jobs.rs and services/jobs.ts | HelperProcess, DriveTimings, JobContext/spawn_job, runJob<T>/JobHandle<T>; result is on completion, not handle.result |
| U3 | 07b E5; handlers/types.ts | previewOnly optional boolean: no print/autoplay/dirty/save in quick preview; HandlerViewProps.active cancels offscreen render |
| U4 | 04b/05c; ribbon/ViewerFrame.tsx, ToolbarDock | Existing ribbon docking; type accent pdf; do not build fixed-position duplicate ribbon |
| U5 | 04a; files.ts/handler registry/openPipeline | Existing FileTypeInfo and normal token/grant lifecycle; handler ID pdf, MIME application/pdf, extension pdf, priority before text |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

### T1 — Pin assets and define PDF DTOs
**Files:** pdf_types.rs,pdf_snapshot_resolver.rs, services/pdf.ts; coordinator dependency records/manifests, helper assets packaging, new frontend entry. **Do:** exact data/export tables; confirm Node version before installation; bundle same-version worker/CMaps/fonts/wasm locally; no CDN/browser-native PDF embed. **Tests:** pdfContracts.test.ts: page0/NaN zoom/foreign UUID refused; DTOs roundtrip snake_case; pdf ViewState excludes password/token. **Uses:** U1/U5. **Commit:** `deps: add pdfjs-dist 6.4.299 (Apache-2.0) [step-07d/T1]`.

### T2 — Separate PDF helper host
**Files:** webview_helper.rs,webview_helper_types.rs,webview_helper_protocol.rs,webview_helper_inputs.rs,webview_private.rs,helper_frames.rs,file_grant_backing.rs,src/services/helperBridge.ts,pdf_helper.rs,pdf_helper_types.rs, pdf_helper_process.rs, pdf-helper.html, src/pdf-helper/main.ts, src/pdf-helper/types.ts,src/pdf-helper/load.ts. **Do:** implement E7/E8/E9 once; earlyflag before main app startup; isolated Tauri builder with helper-only command registration/capabilities, own data subfolder; restricted local input/output protocol; job ownership/memory/timeout/cancel; no root app state access from helper. **Tests:** helper death leaves parent usable; unapproved path/output body refused; no parent command in helper handler; second source request cannot reuse old token. **Uses:** U1/U2/E7-E9. **Commit:** `feat(pdf): isolated trusted PDF helper host [step-07d/T2]`.

### T3 — Bounded document/page/text adapters
**Files:** pdf_sessions.rs,pdf_snapshot_resolver.rs, pdf.rs, pdf_jobs.rs; src/pdf-helper/render.ts,text.ts. **Do:** E1-E3/E9, finite source/pages/pixel/text limits, guarded disk stamps or resolved immutable snapshots, password only memory; render visible page then adjacent, cancel late revisions; validate PNG+identity before ordinary disk cache or E8 memory lease; return text chunks without HTML or bytes in JSON. Native request.output_specs is empty for open/text/outline/search/print and one PNG<=8MiB for render; print keeps sequential canvases child-local. **Tests:** scripts/external-resource fixtures make zero network/action calls; PDF1000pages opens first without rendering1000; cancellation disposes render task/grants; 2^22+1pixels refused before allocation; snapshot revision1 remains revision1 after edit2; absent resolver fails without disk open; sensitive render writes zero disk/cache bytes. **Uses:** U1/U2/E1-E3. **Commit:** `feat(pdf): bounded page and text rendering [step-07d/T3]`.

### T4 — Viewer shell, pages and thumbnails
**Files:** handlers/pdf/index.ts, PdfView.tsx, PdfPages.tsx, PdfSidebar.tsx, pdfState.ts, styles/pdf.css; coordinator registry. **Do:** handler maxBytes512MiB, accentpdf, supportsFindtrue, editablefalse; ViewerFrame ribbon; sidebar196px resizable160-320; canvas surface token,24px padding; page image centered, text overlay exacttransform; sidebar row144px; virtualization overscan1page/4thumbnails; keyboard PageUp/Down and input Enter bounds. **Tests:** activefalse cancels offscreen work; virtual visible count bounded; page/thumbnail selection sync;400%zoom scrolls without breaking toolbar; protected preview no print. **Uses:** U3-U5/E1-E3/E5. **Commit:** `feat(pdf): accessible paged viewer [step-07d/T4]`.

### T5 — Outline/search/text selection and coordinate math
**Files:** PdfOutline.tsx,pdfCoordinates.ts,pdfSearch.ts,src/pdf-helper/search.ts. **Do:** implement E4; capped hierarchical outline with explicit missing-state; text selection/order/RTL; search cursor query-bound and cancellable; transform forward/inverse uses PDF viewport matrix once. **Tests:** page box(0,0,100,200), scale1, rotation90, default flipped viewport has matrix(0,1,1,0,0,0); point(10,20) ->(20,10), viewport200x100; inverse returns(10,20) within1e-6; query change clears oldmatches; outline5001st/depth33 yields explicit bounded partial/error, no UI freeze. **Uses:** E3-E5. **Commit:** `feat(pdf): text search and outline navigation [step-07d/T5]`.

### T6 — User-confirmed printing
**Files:** pdf_print.rs,src/pdf-helper/print.ts,src/handlers/pdf/PdfPrintDialog.tsx. **Do:** E6; validate permissions/range; generate bounded print view using controlled page images; helper system print UI; clean image leases and print DOM on completion/cancel. **Tests:** range101refused before render; no print without click; permissionfalse disables action in UI and Rust; cancel produces no file mutation. **Uses:** U2/E1/E2/E6. **Commit:** `feat(pdf): bounded user-confirmed printing [step-07d/T6]`.

### T7 — Help, fixtures and capture instructions
**Files:** help/en/es/viewing-pdfs.md; coordinator translations/pseudo/IPC/command tests, scripts. **Do:** full text below; ensure first page/search/sidebar sample corpus; reviewers only run tools. **Tests:** every command help exists; English/Spanish labels fit and keys/ICU agree; JS action fixtures remain inert. **Commit:** `docs(help): viewing PDFs [step-07d/T7]`.

## Coordinator commit labels (workers do not commit)

- deps: add pdfjs-dist 6.4.299 (Apache-2.0) [step-07d/T1]
- feat(pdf): isolated trusted PDF helper host [step-07d/T2]
- feat(pdf): bounded page and text rendering [step-07d/T3]
- feat(pdf): accessible paged viewer [step-07d/T4]
- feat(pdf): text search and outline navigation [step-07d/T5]
- feat(pdf): bounded user-confirmed printing [step-07d/T6]
- docs(help): viewing PDFs [step-07d/T7]

## Required handoff

Return `handoff/step-07d/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-07d/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
