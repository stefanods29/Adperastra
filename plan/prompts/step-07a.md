# Coding assignment: step 07a — Thumbnails, cache store, helper process, background work v1

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-07a.md](../steps/step-07a.md). Guide SHA-256: `03b15ad8e86faf557327bbbf2b47a7b773df1728a63cee831ded407cbafc4893`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | `step-07a-thumbnails` |
| Tag | `v0.0.20-step07a` (reserved; no tag is created by guide authoring) |
| Depends on | implemented 06f and committed KI-068/KI-079 repairs |
| Written before | 07a was built |
| Source baseline | `0154c69b3ea5afbfadc39ffa8ee2637733396348` |
| Shared interface revision | `preview-foundation-1` as defined below |

Settings reservation: 11 -> 12; screenshot reservations: 57-58. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- Read the baseline producers named in the Uses section below.

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| Ref | Producer; canonical definition | Exact dependency | Contract used |
|---|---|---|---|
| U1 | 06d; `src-tauri/src/helper.rs` | `HelperProcess::spawn/send_line/recv/kill`; free `helper::drive`; `DriveTimings` | Current line helper transport; helper::drive(io:&mut dyn HelperIo,token:&CancellationToken,timings:DriveTimings,on_line:&mut dyn FnMut(&str)->Result<bool,String>)->Result<DriveEnd,String>. It is a free function, not a HelperProcess method. Task-specific memory/wall/cancel limits above; preserve archive/font callers;07d adds a separate framed transport |
| U2 | 06d; `src-tauri/src/jobs.rs`, `src/services/jobs.ts` | `Jobs`, `JobContext`, `spawn_job`, `runJob<T>`, `JobHandle<T>` | Shared start/poll/cancel for requested long foreground work; thumbnail scheduling itself does not fill 32 user-job slots |
| U3 | 04a; `src-tauri/src/files.rs`, `src/services/files.ts` | `FileGrants::grant/revoke`, `fileUrl(token, name)` | Cache grants refer only to leased owned blob paths; bytes never in JSON |
| U4 | 06e; `crates/fs-service/src/owned_io/` | `SourceIdentity::capture`, `PinnedSource::open`, `PinnedDirectory::open`, `OwnedOutput` | SourceIdentity::capture(path:&Path)->OwnedIoResult<SourceIdentity>; PinnedSource::open(path:&Path,expected:&SourceIdentity)->OwnedIoResult<PinnedSource>; PinnedDirectory::open(path:&Path)->OwnedIoResult<PinnedDirectory>; OwnedOutput::create(directory:&PinnedDirectory,hint:&str)->OwnedIoResult<Self>; file_mut(&mut self)->&mut File; flush_sync(&mut self)->OwnedIoResult<()>; publish_name(&mut self,name:&str)->OwnedIoResult<PathBuf>; close(self)->ClosedOutput. ClosedOutput::publish_to(self,target:&Path)->OwnedIoResult<()>;dispose(self)->OwnedIoResult<()>. Do not copy private helpers |
| U5 | 05a/05d; `FileGrid.tsx`, `useItemInteractions.ts`, `appearance/density.ts` | `ItemViewProps`, `useItemInteractions`, `useRowSizes` | Preserve selection and density; replace only tile content with a dedicated component |
| U6 | 06c; Rust main/settings TS | `CURRENT_SCHEMA`, `SETTINGS_SCHEMA_VERSION`, `AppSettings` | Incoming schema 11; outgoing 12; keep all existing sections/defaults |
| U7 | 02; `src/services/explorer.ts` | `displayPath`, `samePath` | Display/comparison; source key normalization remains backend-owned |

Private locals in these files are not imports. U4's old SourceIdentity timestamp is seconds: add a separate high-precision source stamp in this step rather than silently changing that shared field's meaning.

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

### T1 — Cache crate, types and dependencies
**Files:** create `crates/cache-store/Cargo.toml`, `src/lib.rs`, `src/types.rs`, `src/error.rs`; coordinator registers workspace/dependencies and notices.
**Do this:** declare E1/E2 and data tables; CacheError as listed; pin existing rusqlite/blake3 versions/features; do not install from worker. Keep storage operations initially unregistered until their real implementations exist. **Uses:** U4/U6. **Tests:** `step07a_key_tests.rs`: `cache_key_changes_with_file_revision`, same path/size at ticks 10 and 11 gives distinct hash; `ids_do_not_lose_precision`, file ID above 2^53 retains exact string. **Traps:** do not use whole-second mtime or hash a Rust debug string. **Commit:** `deps: add cache store workspace dependencies [step-07a/T1]`.

### T2 — Owned cache persistence and physical budgets
**Files:** create crate `src/store.rs`, `src/schema.rs`, `src/cleanup.rs`, `tests/step07a_store_tests.rs`.
**Do this:** validate root; acquire OS lock; create schema or refuse newer schema; key hash is BLAKE3 of canonical field order with length-prefixed UTF-8 values and fixed-width little-endian integers; lookup validates record/owned blob; publish stages, flushes, rechecks source stamp, publishes no-replace UUID blob, commits index, then evicts oldest unleased records by used_unix/key_hash. Account all physical files. Clear removes only verified owned blobs; do not delete foreign or uncertain entries. **Uses:** U4/E1. **Tests:** limit 100 bytes with two 60-byte blobs evicts oldest unleased; lease oldest leaves it and refuses admission when remaining cap cannot fit; foreign file remains unchanged after clear; interrupted publication is never a usable hit. **Traps:** SQLite metadata success is not proof a blob exists. **Commit:** `feat(cache): bounded owned cache persistence [step-07a/T2]`.

### T3 — Source stamp and lease service
**Files:** create `src-tauri/src/cache.rs`, `cache_leases.rs`, `cache_stamp.rs`; create service `src/services/cache.ts`; coordinator IPC wiring.
**Do this:** implement E3/E5 and cache commands; obtain identity/full FILETIME from an opened attribute handle; validate no recall/reparse before content opens; lease pins verified owned blob before granting URL; release revokes token then drops pin; cap active leases at 512, expire only after explicit release/process exit, never silently while displayed. **Uses:** U3/U4/E1/E2. **Tests:** `cache_lease_tests`: pin survives clear and usage includes its bytes; releasing twice succeeds; unknown/foreign UUID cannot revoke another grant; source stamp differs for subsecond changes. **Traps:** never trust an input blob path. **Commit:** `feat(cache): source revisions and leased file grants [step-07a/T3]`.

### T4 — Shared background policy
**Files:** create `src-tauri/src/background.rs`, `background_queue.rs`, `background_windows.rs`, `src/services/background.ts`; coordinator settings schema 12 and default/migration/test/measurement settings changes.
**Do this:** implement D5-D7/E4 with pure decision function and injected clock/power inputs; poll Windows on dedicated thread; bounded priority queue keyed by result request; coalesce consumers; pause cancels active tokens and drains no source reads; register only actual installed feature task kinds. Add Windows features `Win32_UI_Input_KeyboardAndMouse`, `Win32_System_Power`; GetLastInputInfo wrap-safe milliseconds relative to current system tick. **Uses:** U1/U6. **Tests:** idle 29,999 false/30,000 true; only-AC with unknown false; paused always false; queue 257th returns busy without read; two active tasks maximum. **Traps:** do not cancel foreground file transfers. **Commit:** `feat(background): common bounded background policy [step-07a/T4]`.

### T5 — WIC thumbnail helper
**Files:** create `src-tauri/src/thumbnail_helper.rs`, `thumbnail_decode.rs`, `thumbnail_encode.rs`; coordinator helper dispatch in main.
**Do this:** flag `--thumbnail-helper`; one request on stdin with source path, expected stamp, edge, owned output path; no secrets/paths on command line; helper rechecks source and holds guard; implement E8 as COM-balanced WIC decode from guarded handle, checks width/height 1-65,536 and product at most 100,000,000; orientation then scale, nearest rounded dimensions minimum 1; output PNG at most 4 MiB in owned staging; return only bounded metadata, no binary JSON. Parent validates child report, length, PNG signature/dimensions/source stamp before cache publish. **Uses:** U1/U4/E1/E3/E8. **Tests:** 400x200 edge128 ->128x64; 20x10 edge64 ->20x10; zero/oversized dimensions refused before pixel allocation; timeout/cancel retains no published entry and preserves original. **Traps:** release COM objects before source guard; never read clipboard for a file thumbnail. **Commit:** `feat(thumbnails): isolated bounded WIC rendering [step-07a/T5]`.

### T6 — Thumbnail request service and cancellation
**Files:** create `src-tauri/src/thumbnails.rs`, `thumbnail_jobs.rs`, `src/services/thumbnails.ts`, `src/__tests__/thumbnails.test.ts`; coordinator command registration/allowlist.
**Do this:** implement lookup/start/release wrappers and E6; capture validated source stamp before queueing; check again at dispatch/result; max path/edge/UUID/request-id validation; task uses helper only after policy eligibility; no duplicate work for equal key; remove consumer on unmount; only newest key can publish UI reply. **Uses:** U1-U4/E1-E4. **Tests:** 2 consumers same key produce one helper; releasing one preserves other; final release cancels; old stamp completion is rejected; online-only input causes zero decoder/source-content calls. **Traps:** JobHandle has completion, not result. **Commit:** `feat(thumbnails): coalesced revision-aware requests [step-07a/T6]`.

### T7 — Grid thumbnail component
**Files:** create `src/components/FileThumbnail.tsx`, `src/services/useThumbnail.ts`, `src/styles/thumbnails.css`, `src/__tests__/fileThumbnail.test.tsx`; coordinator edits FileGrid tile slot and main CSS import.
**Do this:** implement E7; hook owns consumer UUID/revision and releases exactly once; inactive/offscreen components cancel pending work; image is aria-hidden because row already names file; object-fit contain, background surface.pane, no changes to cell size/selection/focus/badges; use existing tile fallback. Add component only for file kinds and supported extension claims, never folders/drives. **Uses:** U5/E5/E6. **Tests:** stale promise cannot replace newer path; unmount releases pending consumer and ready lease; Cloud fallback remains; keyboard/double-click tests keep old behavior. **Traps:** do not remount the row or change its key for a thumbnail. **Commit:** `feat(explorer): lazy thumbnails in existing item grids [step-07a/T7]`.

### T8 — Settings, help and reviewer measurements
**Files:** create `src/views/settings/BackgroundSettings.tsx`; help pages below; coordinator SettingsView/section registry, translations/pseudo, scripts and report wiring.
**Do this:** settings section after Versions; on/off, thumbnails toggle, idle, AC, Pause all and cache limit; disabled/loading states from status; toggles persist one atomic settings update; label/status values from key table. Section class adp-settings-section; 8 px gaps; normal Switch; no new colors. Reserve shots 57-thumbnails and 58-background-work; measures named below. **Uses:** U6/E4-E7. **Tests:** `backgroundSettings.test.tsx`: paused toggle persists once; import schema11 keeps language/theme/templates and supplies new defaults; unsupported cache limit rejected without resetting other fields. **Traps:** worker writes tests but coordinator generates pseudo/runs checks. **Commit:** `docs(help): thumbnails and background work [step-07a/T8]`.

## Coordinator commit labels (workers do not commit)

- deps: add cache store workspace dependencies [step-07a/T1]
- feat(cache): bounded owned cache persistence [step-07a/T2]
- feat(cache): source revisions and leased file grants [step-07a/T3]
- feat(background): common bounded background policy [step-07a/T4]
- feat(thumbnails): isolated bounded WIC rendering [step-07a/T5]
- feat(thumbnails): coalesced revision-aware requests [step-07a/T6]
- feat(explorer): lazy thumbnails in existing item grids [step-07a/T7]
- docs(help): thumbnails and background work [step-07a/T8]

## Required handoff

Return `handoff/step-07a/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-07a/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
