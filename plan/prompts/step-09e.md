# Coding assignment: step 09e — Bulk rename and batch actions

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-09e.md](../steps/step-09e.md). Guide SHA-256: `d40ebe7dcc0e5236f1fa6bca4b5b0a40a4042a46142753c6b1e3cd836d6a1c07`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 4/5 |
| Branch | step-09e-bulk-actions |
| Tag | v0.1.5-step09e |
| Depends on | 07b metadata-preview-1;08a conversion-2;08b conversion-presets-1;08c privacy-1;09d palette-1 |
| Written before | 07a was built |
| Interface revision | bulk-rename-1; batch-actions-1 |

Settings reservation: 22 -> 22; screenshot reservations: 99-100. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 07b producer guide](../steps/step-07b.md)
- [Step 08a producer guide](../steps/step-08a.md)
- [Step 08b producer guide](../steps/step-08b.md)
- [Step 08c producer guide](../steps/step-08c.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09b producer guide](../steps/step-09b.md)
- [Step 09d producer guide](../steps/step-09d.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Read first / dependencies

Mapped v1 09b bulk rename/batch actions; full08a-c/09a/09d; current fs-service rename/name validation/owned_io; transfer-history and Undo types; native jobs;07b metadata values. Pin regex1.13.1, MIT OR Apache-2.0, Rust1.65, defaultfeatures off with std/perf/unicode; coordinator verifies these feature names against exact crate metadata and records them before installation. API RegexBuilder::new/size_limit/dfa_size_limit/build, Regex::replace_all/Captures checked from primary docs; no JS regex execution.

| ID | Producer/task; exact export | Use |
|---|---|---|
| U1 | 07a T2/E3 SourceStamp/CacheService.source_stamp;07b T2/E1 MetadataInfo | Source full-resolution stamp and fixed metadata field IDs date_taken/camera_model/width/height; metadata fetched only for explicitly requested placeholders |
| U2 | 03b fs-service validate_new_name; owned_io PinnedDirectory/PinnedSource | Name validation and pinned parent chains; mutation handles defined here are separate from read-only PinnedSource |
| U3 | 06d jobs.rs JobContext/spawn_job,services/jobs.ts runJob/JobHandle.completion | Plan/execute use shared jobs, cancellation and progress, no separate polling table |
| U4 | 08b E4 applyConversionPreset;08a E2 startConversion;08c E1 inspectPrivacy/cleanPrivacy | Exact input/option/report types imported, no second conversion/cleaner implementation |
| U5 | 03b UndoStack/FileAction/executeFileAction;09a E9UiHistoryRegistry | File rename effects use new E5 native receipt; app-state presets use validated UI-history adapter, no mutable-source Redo reconstruction |
| U6 | 09d E3 PaletteRegistry; CommandRegistry/JobsPanel | Register compatible multi-selection actions and translated summaries; enabledWhen checked at dispatch |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks, tests and commits

| Task | Files / ordered algorithm / dependencies | Named tests with exact oracle | Commit |
|---|---|---|---|
| T1 | new bulk-rename crate manifest/lib/types/operations.rs; coordinatorregexdep/license/registration. U1/U2; defineDTOs/caps andpuretransform | crates/bulk-rename/tests/step09e_names_tests.rs: `numbering_skips_excluded_rows` indicesincluded0,2 start1padding3 ->001,002; `unicode_upper_expands_safely` straße->STRASSE; `extension_not_changed_by_default`; `regex_backreference_refused` | `deps: add bounded bulk rename engine [step-09e/T1]` |
| T2 | preview.rs/collisions.rs/native bulk_rename.rs/types/services/bulkRename.ts. U1/U2/U3; compute/page/cancelplan | step09e_preview_tests.rs: A/Bswapready; duplicatefinalnameconflict;NULinvalid;missingdatetakeninvalid;excludedrownotnumbered;stalegenerationignored | `feat(rename): live validated rename plans [step-09e/T2]` |
| T3 | crates/fs-service/src/rename_handles.rs;bulk-rename journal.rs/executor.rs. U2; implementD6-D8 with injectedfilesystemadapter andrealWindowstests | step09e_execute_tests.rs: A↔B contentsremainattachedtosameobjects;case-onlynameworks;newforeignoriginalonrollbackkept;cancelneverdeletesuserintermediate;sourceidentityswapbeforeguardchangesnothing;journalfailurebeforemutation; crash_before_intent/after_intent/after_syscall/before_completion allfindsameobjectonlyatrecordedcandidate | `feat(rename): guarded cyclic rename execution [step-09e/T3]` |
| T4 | rename_history.rs/renameHistory.ts; coordinatorFileActiondispatch/globalUndo;U3/U5/E5 | native `changed_receipt_refused`; `undo_redo_uses_same_objects`; `failed_undo_does_not_confirm_cursor`;partialreportactualpathsequaldisk | `feat(rename): exact rename receipts and history [step-09e/T4]` |
| T5 | rename_presets.rs/renamePresets.ts,BulkRenameDialog.tsx,RenameOperations.tsx,RenamePreview.tsx,styles/bulkRename.css;U1-U3/E1-E4 | bulkRename.test.tsx:150msdebounce;invaliddisabled;excludeconflict;keyboard/alltexts;1001refused;catalogrevisionconflictandno sourcepathpersist | `feat(rename): bulk rename controls and presets [step-09e/T5]` |
| T6 | batch/registry.ts,batch/runBatchAction.ts,BatchActionsDialog.tsx;U4/U6/E6 | batchActions.test.ts:source/snapshottypesunchanged;loss/categoryackrequired;retryneverrepeatscompleted;reportpaginationkeepscounts | `feat(batch): reuse conversion and privacy actions [step-09e/T6]` |
| T7 | fourhelpfilesbelow; coordinatorlocales/pseudo/registries/measurements/shots | helpkeys/routes and oldinline-rename tests retained; coordinator executesrealrace/cancel/journaltests | `docs(help): bulk rename and batch actions [step-09e/T7]` |

## Coordinator commit labels (workers do not commit)

- deps: add bounded bulk rename engine [step-09e/T1]
- feat(rename): live validated rename plans [step-09e/T2]
- feat(rename): guarded cyclic rename execution [step-09e/T3]
- feat(rename): exact rename receipts and history [step-09e/T4]
- feat(rename): bulk rename controls and presets [step-09e/T5]
- feat(batch): reuse conversion and privacy actions [step-09e/T6]
- docs(help): bulk rename and batch actions [step-09e/T7]

## Required handoff

Return `handoff/step-09e/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-09e/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
