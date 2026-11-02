# Coding assignment: step 12a — Pack manager, App storage, Background work page

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-12a.md](../steps/step-12a.md). Guide SHA-256: `cf166d3770d7d9c1ed60b3098688b81a9f7938b1891a03d2b4ff0c905db31f21`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 4/5 |
| Branch | step-12a-pack-manager |
| Tag | v0.2.4-step12a |
| Depends on | 07a cache/background contracts; 09h recovery storage; 09j clipboard storage; 11a-c indexes/scans; setup-core baseline |
| Written before | 07a was built |
| Interface revision | packs-1; storage-providers-1; background-2 |

Settings reservation: 36 -> 37; screenshot reservations: 141-143. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 09h producer guide](../steps/step-09h.md)
- [Step 09j producer guide](../steps/step-09j.md)
- [Step 10c producer guide](../steps/step-10c.md)
- [Step 11a producer guide](../steps/step-11a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| Ref | Producer/task/file/revision | Exact consumption |
|---|---|---|
| U1 | 07a E4; `src-tauri/src/background.rs`; background-1 | BackgroundPolicy.register/eligible/cancel_kind/pause_all and BackgroundTaskKind; extend its settings and decisions, keep one policy authority |
| U2 | 07a E1/E3/E5; `cache-store`, `src/services/cache.ts`; preview-foundation-1 | CacheUsage and leased cache clearing; never count leased blobs as already removed |
| U3 | 06d jobs; `src/services/jobs.ts`, `src-tauri/src/jobs.rs`; baseline 0154c69 | runJob<T> -> JobHandle<T> with completion/cancel; bounded shared job table, no second polling transport |
| U4 | 01a setup; `setup-core/src/profile.rs`, `manifest.rs`, `signing.rs`; baseline | Profile selected pack IDs; existing trusted public-key/signature verification primitives; no fictional Pack.version field |
| U5 | 06b `src/services/versions.ts`; baseline | versionsStoreSize():Promise<number>, versionsDeleteAll():Promise<void>; native provider wraps existing store locks/accounting rather than path deletion |
| U6 | 09h/09j/11a-c provider-specific stores | Coordinator registers the stores through E3 below; providers retain their own safety/lease rules; no consumer imports private SQLite connections |
| U7 | 10c E profile_root.rs; profile-root-1 | resolve_profile_root returns ProfileRoot{base_dir,profile_dir,shared_packs_dir,profile_id,portable}; inject roots into stores instead of reselecting AppData |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

Each task writes tests but workers do not execute them. Shared file changes are exact integration proposals. New files <=400 lines; split service/types/state/install/download modules as named here.

| Task; commit | Files and ordered work; dependencies | Named tests: input -> expected |
|---|---|---|
| T1; `feat(packs): signed catalog contracts [step-12a/T1]` | Create pack-store/types.rs,catalog.rs,validation.rs; verify bytes then parse and validate dependency DAG; U4, E1/E2. | catalog_signature_precedes_parse: modified signed byte -> bad_signature/no parse; catalog_cycle_refused: media->office->media -> dependency_cycle; unknown_schema_retained: schema2 -> no overwrite |
| T2; `feat(packs): owned resumable downloads [step-12a/T2]` | pack-store/download.rs,download_state.rs; bounded request and owned partial, ETag/Range/hash; U3. | resume_wrong_etag_restarts_owned_copy: ETagA->B -> no append; cancel_keeps_foreign_partial: substituted path -> foreign file untouched; hash_failure_never_installs: one changed byte -> bad_hash |
| T3; `feat(packs): verified versioned activation [step-12a/T3]` | pack-store/install.rs,leases.rs,inventory.rs; guarded extraction, inventory, activation/rollback; U4. | traversal_refused: ../outside -> no outside write; active_lease_blocks_removal: lease1 -> pending_remove until Drop; failed_update_keeps_old_version: probe fail -> previous active version |
| T4; `feat(storage): bounded owned-store registry [step-12a/T4]` | native storage.rs,storage_types.rs; services/storage.ts,StorageRows.tsx; U2/U5/U6,E3/E4. | clear_accepts_category_only: path argument -> bad_request; leased_cache_stays_counted: 10MiB leased -> pending10MiB; clear_versions_does_not_touch_sources: source hash identical |
| T5; `feat(background): shared policy controls [step-12a/T5]` | background_policy.rs/background_limits.rs and services/background.ts; coordinator extends07a policy/schema37; U1,E5. | quiet_wraps_midnight:22:00-07:00 at23:00 -> paused; equal_hours_all_day:enabled/start=end -> paused; pause_all_checkpoints_within100ms; foreground_export_not_silently_paused |
| T6; `feat(settings): packs and background pages [step-12a/T6]` | AppStorageSettings.tsx,BackgroundWorkSettings.tsx,PackCard.tsx,storage.css; E1/E4/E5. | remove_waits_for_dirty_editor: Cancel close -> lease retained; missing_pack_link_opens_storage; clear_confirmation_names_loss; duplicate_click_starts_one_job |
| T7; `docs(help): packs storage and background work [step-12a/T7]` | Three help files below, pack test fixture protocol, coordinator schema/keys/wiring/gate/speed/screenshots/report. | schema36_migration_preserves_task_choices; first_run_nonai_only; every_registered_store_is_reported; all_help_bilingual |

## Exact file and test allocation

Feature-owned roots: crates/pack-store/src/; src-tauri/src/storage*.rs and background_*.rs; src/services/{packs,packTypes,storage,background}.ts; src/views/settings/ and src/storage/. Bare filenames in a task expand inside its feature root; native filenames mean src-tauri/src/ unless an explicit crate path is given. The coordinator owns shared App/Explorer/main, settings schemas, manifests/lockfiles, command/handler/IPC registries, generated locales and asset wiring; workers submit exact insertions rather than editing those shared files. Helpers use the producer's fixed entry/action registry through coordinator integration.

Place every named test in task Tn in the corresponding file below. Rust test modules with private feature access are attached by the owning native module; they are not a fictitious standalone src-tauri library. The listed assertions remain unchanged when split into smaller test files.

|Task|Exact test file|
|---|---|
|T1|crates/pack-store/tests/step12a_catalog.rs|
|T2|crates/pack-store/tests/step12a_download.rs|
|T3|crates/pack-store/tests/step12a_install.rs|
|T4|src-tauri/src/storage_step12a_tests.rs|
|T5|src-tauri/src/background_step12a_tests.rs|
|T6|src/__tests__/step12a-settings.test.tsx|
|T7|src/__tests__/step12a-help.test.ts|

Workers write these tests and fixtures but do not execute any command, install, compile, generate assets or claim results. Coordinator runs targeted checks, complete gate/package, real parser/process/file-safety tests and manual evidence. A mock is not evidence of native confinement, interoperability or performance.

## Coordinator commit labels (workers do not commit)

- feat(packs): signed catalog contracts [step-12a/T1]
- feat(packs): owned resumable downloads [step-12a/T2]
- feat(packs): verified versioned activation [step-12a/T3]
- feat(storage): bounded owned-store registry [step-12a/T4]
- feat(background): shared policy controls [step-12a/T5]
- feat(settings): packs and background pages [step-12a/T6]
- docs(help): packs storage and background work [step-12a/T7]

## Required handoff

Return `handoff/step-12a/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-12a/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
