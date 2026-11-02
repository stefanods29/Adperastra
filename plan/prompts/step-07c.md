# Coding assignment: step 07c — Gallery

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-07c.md](../steps/step-07c.md). Guide SHA-256: `de3c24890ac22b90a82cf811679aab8b3cd6b8e99295953739ed5187fc6f1cf8`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 2/5 |
| Branch | `step-07c-gallery` |
| Tag | `v0.0.22-step07c` |
| Depends on | 07a cache/thumbnails, 07b metadata/preview, 05a selection/view conventions |
| Written before | 07a was built |
| Source baseline | `0154c69b3ea5afbfadc39ffa8ee2637733396348` |
| Shared interface revisions | preview-foundation-1; metadata-preview-1; gallery-source-1 |

Settings reservation: 12 -> 13; screenshot reservations: 62-63. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 07b producer guide](../steps/step-07b.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| Ref | Producer; canonical export | Contract |
|---|---|---|
| U1 | 07a E6/E7; services/thumbnails.ts, FileThumbnail.tsx | request/lookup/releaseThumbnail and FileThumbnail(path,edge,active,fallback); no duplicate decoder |
| U2 | 07b E1; services/metadata.ts | MetadataInfo, MetadataFieldId date_taken, readMetadata/releaseMetadata; SourceStamp from07a; date field ISO UTC |
| U3 | 07b E4; preview/QuickPreviewDialog.tsx | QuickPreviewProps selection/onClose/onOpen/onOpenHelp; no editor mutation |
| U4 | 05a; views/useItemInteractions.ts, gridLayout.ts | ItemViewProps/useItemInteractions; selection paths and existing gridMove; maintain row role option and listbox keyboard semantics |
| U5 | 02; services/explorer.ts, Rust explorer/fs-service listings | ExplorerItem exactly current shape; basic listings are attribute-only for online-only entries; existing displayPath/format services |
| U6 | 06c; src-tauri/src/file_dialogs.rs | pick_folder_path(owner: isize, title: str reference) -> Result<Option<String>,String>; call on blocking thread; cancel is Ok(None), failure dialog.failed; title is translated Gallery add-folder label |
| U7 | 04a; App/openPipeline and ExplorerHome callback | Existing onOpenFile(path,background) callback returns Promise<void>; use normal detection/grants/protected-view flow |
| U8 | 07a E4; background.rs | BackgroundPolicy metadata registration/eligibility and cancellation, foreground browse remains usable |

U6's signature was checked against current source. Future tab workers use U7 rather than creating Gallery-specific open behavior.

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

### T1 — Sources/settings and data contracts
**Files:** create gallery_types.rs and services/gallery.ts types; coordinator schema13 migration, Rust/TS defaults/normalization, settings tests and measurement fixture settings. **Do this:** validate source count/IDs/absolute paths, normalize compare paths without losing display path, persist only settings fields; keep prior12 sections intact. **Uses:** U5/U6. **Tests:** schema12 es/dark retains existing background settings and adds empty Gallery; 33sources refused; duplicate path with case/long prefix refused; empty sources valid. **Commit:** `feat(gallery): validated picture sources [step-07c/T1]`.

### T2 — Bounded discovery and sessions
**Files:** create gallery_scan.rs, gallery_sessions.rs, gallery.rs; coordinator shared jobs/IPC. **Do this:** breadth-first scans authorized roots, visited identity set, max two workers, bounded queue/depth/items; no reparse descent or source hydration; preserve overlapping source_ids, skip hidden/system per flags; return first256 while continuing bounded job; snapshot generation for paging. **Uses:** U5/U8/E4. **Tests:** overlapping roots list one file with two source IDs; loop skipped; online-only candidate visible without content open; 250,001st returns partial reason items; access error preserves other root. **Commit:** `feat(gallery): bounded deduplicated discovery [step-07c/T2]`.

### T3 — Date grouping and stable pages
**Files:** create galleryDates.ts, gallery_order.rs, gallery_pages.rs and dedicated tests. **Do this:** apply D5/D6; immutable generation, bytes/row caps, oldest cursor expiry; rich taken date collected via07b only when permitted, stage regroup for scan completion/refresh; sort tie normalizedpath. **Uses:** U2/E3. **Tests:** taken2026-01-01T00:30Z, Lima UTC-5 ->2025-12; missing taken uses modified; zero dates undated; cursor from another scan rejected; page256 then remaining1 yields no duplicate. **Commit:** `feat(gallery): stable dated paging [step-07c/T3]`.

### T4 — Virtualized photo grid
**Files:** create src/views/gallery/GalleryContent.tsx, GalleryGrid.tsx, useGallery.ts, gallerySelection.ts, styles/gallery.css. **Do this:** exact cell/header sizes D7; listbox/option semantics; use current selection helpers; separate source controls; Add-folder empty state versus no-results state; skeleton100ms and text1s; partial notice with skipped count, retry Refresh; preserve key/focus. **Uses:** U1/U4/E1/E2. **Tests:** only viewport+overscan rows rendered; 960px width gives four184px cells with12px gaps within928px; arrow/focus/shift selection matches layout; current source removal does not select wrong file. **Commit:** `feat(gallery): virtualized picture grid [step-07c/T4]`.

### T5 — Preview/open and Explorer integration
**Files:** create useGalleryActions.ts; coordinator Explorer gallery location slot, nav command and App developer-title key. **Do this:** Enter and doubleclick U7, Space U3; selected picture Details U2; developer tab same kind/contents with Components title; no Gallery-specific grants persisted. **Uses:** U1-U4/U7. **Tests:** normal open callback receives exact path/background flag; preview is read-only; missing handler falls back safely; developer tab session preserved and renamed only in display. **Commit:** `feat(gallery): previews and ordinary file opening [step-07c/T5]`.

### T6 — Source changes, watchers and cancellation
**Files:** create gallery_watch.rs, useGallerySources.ts; coordinator settings callback. **Do this:** Add awaits picker and persisted settings success; Remove changes references only, cancels stale tasks/cursors, preserves files covered by other sources; watchers250ms coalesced, idle release30s; close clears generations; late results ignored. **Uses:** U2/U6/U8/E1/E4. **Tests:** remove one overlapping root keeps item; failed settings persistence keeps prior sources and shows error; inactive30s watcher release; old scan reply cannot replace new source state. **Commit:** `feat(gallery): source lifecycle and refresh [step-07c/T6]`.

### T7 — Help, translations and reviewer capture plan
**Files:** help pages below, coordinator key/command tests/pseudo/measurement scripts. **Do this:** full labels above, F1 the-gallery, resolve old placeholder tests to new user behavior; add measured interactions and screenshot. **Tests:** bilingual empty states/source controls; keyboard add/remove; no untranslated visible text; no source mutation. **Commit:** `docs(help): photo Gallery [step-07c/T7]`.

Task-specific Rust tests live in crate fs-service only for pure filesystem helper additions; Gallery orchestration tests in src-tauri gallery modules with injected listings/clocks. UI tests are `src/__tests__/gallery.test.tsx`, `galleryDates.test.ts`, `gallerySources.test.tsx`. Workers write but never run them.

## Coordinator commit labels (workers do not commit)

- feat(gallery): validated picture sources [step-07c/T1]
- feat(gallery): bounded deduplicated discovery [step-07c/T2]
- feat(gallery): stable dated paging [step-07c/T3]
- feat(gallery): virtualized picture grid [step-07c/T4]
- feat(gallery): previews and ordinary file opening [step-07c/T5]
- feat(gallery): source lifecycle and refresh [step-07c/T6]
- docs(help): photo Gallery [step-07c/T7]

## Required handoff

Return `handoff/step-07c/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-07c/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
