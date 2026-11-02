# Coding assignment: step 07b — Quick preview and rich file info

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-07b.md](../steps/step-07b.md). Guide SHA-256: `cd3ede3f88302c5bf29b21d8754dbd7b54deb08593d8b912f72af6171bae47e3`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | `step-07b-preview-metadata` |
| Tag | `v0.0.21-step07b` |
| Depends on | 07a, handler/open pipeline 04a, protected view 04c |
| Written before | 07a was built |
| Source baseline | `0154c69b3ea5afbfadc39ffa8ee2637733396348` |
| Shared interface revision | `preview-foundation-1`, `metadata-preview-1` |

Settings reservation: 12 -> 12; screenshot reservations: 59-61. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| Ref | Producer, exact file/name | Inputs/output and requirement |
|---|---|---|
| U1 | 07a E1/E3; cache-store and `src-tauri/src/cache.rs` | CacheKey/SourceStamp/CacheService.source_stamp/lease and CacheLease exactly as 07a; kind metadata, schema/version/config key above |
| U2 | 07a E4; `src-tauri/src/background.rs` | BackgroundPolicy.register/eligible/cancel_kind for metadata; do not change pause semantics |
| U3 | 06d; helper.rs/jobs.rs and services/jobs.ts | HelperProcess, DriveTimings, Jobs/JobContext/spawn_job, runJob<T> returning Promise<JobHandle<T>>; cancel obsolete requests |
| U4 | 04a/06a; handlers/types.ts | HandlerViewProps.info/url/active/savedState/onStateChange/onStatus/find/protectedView and optional save callbacks; add previewOnly optional without changing meanings |
| U5 | 04a; services/files.ts | fileDetect(path) -> Promise<FileTypeInfo>; fileGrant(path) -> Promise<string>; fileRevoke(token) -> Promise<void>; fileUrl(token,name) -> string |
| U6 | 05b; views/ColumnPreview.tsx | ColumnPreviewProps item/width/showExtensions/typeLabel/onOpen; retain current props and change only internal preview/facts slots |
| U7 | 03a/06b; DetailsPane.tsx | DetailsPaneProps.selected/summary/folder and optional onShowHistory; preserve existing size/history actions |
| U8 | 02/05a; services/selection.ts and useItemInteractions.ts | Existing selection.focus is a path; current display order supplied by ItemView. Add optional callback `onPreview?: (item: ExplorerItem) => void` to ItemViewProps, no direct invoke |

U8 is an additive coordinator edit. Newer view modules import the same ItemViewProps; do not copy its interface. Row index is not stable file identity.

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

### T1 — Metadata DTO and helper dependency features
**Files:** create metadata_types.rs, metadata_properties.rs; coordinator adds windows feature Win32_UI_Shell_PropertiesSystem and common COM features only if missing. **Do this:** implement fixed ID/property/type mapping above; add none for arbitrary user-selected names; defaults/validation exactly table; lifetime-safe variant conversion. **Uses:** U1/U3. **Tests:** `metadata_types_tests`: duration ticks 12,345,678 ->1,234 ms; frame rate29,970 ->29.97; list17th trimmed; text4097 refused as partial; unknown property omitted. **Traps:** units and PROPVARIANT kinds differ. **Commit:** `feat(metadata): fixed bounded property data [step-07b/T1]`.

### T2 — Read-only property helper
**Files:** create metadata_helper.rs, metadata_windows.rs; coordinator helper dispatch main. **Do this:** flag --metadata-helper, read one request; check source flags/stamp; initialize COM; open property store read-only through GPS_DEFAULT with no write flags; fixed property list; enforce limits; poll cancellation between fields; recheck source; report partial missing values; parent kills after3s. **Uses:** U1-U3/E2. **Tests:** helper malformed request fails; online-only test has zero content-store opens; crash/timeout returns error while Explorer stays alive; property failure preserves available fields. **Traps:** no default-value zeros for unknown facts. **Commit:** `feat(metadata): isolate Windows property reads [step-07b/T2]`.

### T3 — Cached metadata jobs/services
**Files:** create metadata.rs, metadata_jobs.rs, src/services/metadata.ts; coordinator IPC and managed state. **Do this:** implement E1/E2 requests; max128 active consumers; coalesce equal stamp; use metadata background policy; cache cap256KiB per result and global budget; invalid/oversized cached data treated miss; release cancels final consumer; update source revision before returning. **Uses:** U1-U3. **Tests:** stale revision rejected; two same consumers one helper; paused policy no read; cache hit returns same normalized fields; malformed cache never reaches UI. **Traps:** cache SourceStamp/CacheKey imported unchanged. **Commit:** `feat(metadata): cancellable cached metadata service [step-07b/T3]`.

### T4 — Read-only handler preview contract
**Files:** create src/preview/previewHandler.ts, src/components/PreviewSurface.tsx; coordinator optional previewOnly field and existing handler guards. **Do this:** find handler through existing registry; grant/revoke source; all editor mutation paths disabled in previewOnly even if callbacks supplied; unsupported/cloud/error fallback; keep loading skeleton100ms/text1s; no OpenInWindows automatic action. **Uses:** U4/U5/E5. **Tests:** preview cannot save/change dirty state; protected file remains protected; media starts paused; path changes revoke old grant; unsupported file displays Open. **Traps:** calling a normal editable handler without the previewOnly guard is not read-only. **Commit:** `feat(preview): shared inert handler previews [step-07b/T4]`.

### T5 — Quick preview dialog and navigation
**Files:** create src/preview/QuickPreviewDialog.tsx, previewNavigation.ts, useQuickPreview.ts, src/styles/preview.css; coordinator item callback/command/menu wiring. **Do this:** implement D1/D7; snapshot invoking focus, derive next eligible path from current order, clamp boundaries; one modal per origin tab; Space/Esc close; Open closes preview then awaits normal open; main list inert; reject keys from editable descendants. **Uses:** U5/U8/E3/E4. **Tests:** first previous disabled; last next disabled; folders skipped; Escape restores original focus; deleted origin falls back list; repeated Space closes. **Traps:** no selection changes from stale async preview. **Commit:** `feat(preview): keyboard quick preview dialog [step-07b/T5]`.

### T6 — Rich facts and pane adapters
**Files:** create src/metadata/MetadataFacts.tsx, useMetadata.ts, src/styles/metadata.css; coordinator minimal DetailsPane and ColumnPreview edits. **Do this:** single-file only; preserve listing facts/history/Open;150ms debounce and cleanup; two-column dl, label104px/value remaining,8px row gap, wrap anywhere for text, max16rows; use existing tokens; details preview max160px height, Column max240px, contain; multi-select retains existing summary. **Uses:** U6/U7/E1/E3. **Tests:** 2 files show no mixed metadata; failed metadata leaves size/date/history; rapid A->B excludes A facts; Spanish labels wrap; background pause no spinner forever. **Traps:** hooks path revision dependencies, no same-folder navigation. **Commit:** `feat(details): rich facts and pane previews [step-07b/T6]`.

### T7 — Translations, help and review fixtures
**Files:** help pages below; coordinator translations/pseudo/command test expectations, measure scripts. **Do this:** add full key table; command help/F1; measurements/shots below. **Uses:** E1-E5. **Tests:** preview keyboard with English/Spanish text and dark classes; all new keys paired; orphan consumer release after tab close. **Traps:** no test execution from workers. **Commit:** `docs(help): quick preview and file details [step-07b/T7]`.

## Coordinator commit labels (workers do not commit)

- feat(metadata): fixed bounded property data [step-07b/T1]
- feat(metadata): isolate Windows property reads [step-07b/T2]
- feat(metadata): cancellable cached metadata service [step-07b/T3]
- feat(preview): shared inert handler previews [step-07b/T4]
- feat(preview): keyboard quick preview dialog [step-07b/T5]
- feat(details): rich facts and pane previews [step-07b/T6]
- docs(help): quick preview and file details [step-07b/T7]

## Required handoff

Return `handoff/step-07b/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-07b/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
