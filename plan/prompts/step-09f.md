# Coding assignment: step 09f — Copy window and conflict window

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-09f.md](../steps/step-09f.md). Guide SHA-256: `bbac74bdbf1c09d70553fc6b41bbf25487103c8054acc97849b80d8717dfde6c`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started; Replace remains gated |
| Difficulty | 5/5 |
| Branch | step-09f-transfer-controls |
| Tag | v0.1.6-step09f |
| Depends on | 03b fileops/history;06e owned_io;07a SourceStamp;09c folder drop routing |
| Written before | 07a was built |
| Interface revision | transfer-jobs-1; replace-capability-0 |

Settings reservation: 22 -> 23; screenshot reservations: 101-103. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 09c producer guide](../steps/step-09c.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Read first / uses

| ID | Producer/task and exact file/symbol | Contract used |
|---|---|---|
| U1 | 03b `src/services/fileops.ts`: ConflictPolicy merge/skip/keepBoth;OpProgress,OpReport,RunningJob;startFileJob(kind,sources,options)->Promise<RunningJob> | RunningJob.completion resolves OpReport. Do not invent OpResult or silently add Replace to UI union |
| U2 | `crates/fs-service/src/ops.rs` and transfer.rs: TransferEffect/TransferKind/apply_transfer;native transfer_history.rs TransferHistory.reserve/finish | Existing effects store paths and source_removed/destination_created only, not object identity or immutable bytes. Extend receipt fields here, never claim current Redo is snapshot restoration |
| U3 | 06e owned_io: PinnedDirectory::open,PinnedSource::open/file/verify_after_read,OwnedOutput::create/file_mut/flush_sync/publish_name/close;ClosedOutput::publish_to/dispose | New destinations written to owned staging/no-replace, never predictable partials or pathcleanup. SourceIdentity seconds are not07a fullprecision SourceStamp |
| U4 | 07a E3 SourceStamp/CacheService.source_stamp;07bmetadata/thumbnail;07a FileThumbnail | Conflict previews are readonly/policybound, cancellation releasesleases; no backgroundcloudhydration |
| U5 | 06d jobs.rs/services/jobs.ts shared Jobs/runJob/JobHandle.completion | New transfer jobs use shared start/poll/cancel; legacy file_op_start/poll/cancel become compatibilitydelegates, not second executionengine |
| U6 | 09c U4/E3 folderdrops; existing copy/paste/keyboard/filedialogs/JobsPanel | All copy/move entrypoints route one coordinator; preserveexistingriskconfirmations/globalUndo |

Read mapped v1 09c copy/conflict paragraphs, R-SAFE/R-FS, fullowned_io/source/save, transfer_history, existing fileopsExecution/fileopsUndo tests. Native Windows feature additions verified against0.61.3 source before install; no new thirdparty runtime library besides existing blake3.

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task/commit | Files/work/imports | Required tests with oracle |
|---|---|---|
| T1 `feat(transfers): controlled queue contracts [step-09f/T1]` | transfer_job_types.rs,src-tauri/src/transfer_control.rs,transferJobs.ts;U1/U2/U5;defineDTOandreservebeforeack | transferQueue.test.ts/native:33rdqueuefails;2global/1volume;jobexistsonack;nohistoryreservationnomutation |
| T2 `feat(transfers): pause resume skip and retry [step-09f/T2]` | transfer_copy.rs/transfer_move.rs/transfer_decisions.rs;U2/U3/U5 | step09f_control_tests.rs:pause1MiBboundarynoadditionalbytes;resumesexactoffset;cancelownedpartialonly;skipretainscompleted;3retriescap;sourcechangeforcesrepreview |
| T3 `feat(transfers): readback verification and rate estimates [step-09f/T3]` | owned_io/output.rs,E6;transfer_verify.rs/transfer_rates.rs;schema23coordinator | step09f_verify_tests.rs:corruptedreadbacknopublish/sourcekept;emptyhashknown;pauseexcludedfromETA;rate0ETAnull;overflowcountsrefused |
| T4 `feat(transfers): generation-bound conflict decisions [step-09f/T4]` | transfer_conflicts.rs/conflict_policy.rs;U3/U4 | step09f_conflict_tests.rs:newforeignfilekept;foldermergekeepssame-namedchild;staledecisionnoeffect;replace/newerrequestrejectedbeforewrite/recycle |
| T5 `fix(transfers): validate history object identities [step-09f/T5]` | coordinatortransfer_history/TransferEffect/FileActioncompatibility;new transfer_history_validation.rs | changedsourceRedofails;changedtargetUndoexercisesfailclosed;unavailableobjectboundrecyclenevercalled;historycursorunchanged;actualpartialreportretained |
| T6 `feat(transfers): accessible transfer and conflict windows [step-09f/T6]` | TransferWindow.tsx,ConflictDialog.tsx,useTransferState.ts,styles/transfers.css;U4/U6/E1-E5 | transferUi.test.tsx:pause/resumekeyboard;closepaneldoesnotcancel;disabledReplaceexplained;staleasyncresponsenotcurrentdialog;Spanishlonglabelsfit |
| T7 `docs(help): copy controls and safe conflicts [step-09f/T7]` | fourhelpfilesbelow;coordinatorallentrypoints/pseudo/measurement/shots | oldcopy/paste/dropcallercontracttestsupdatedtooneengine;readonlyversionhooknotcalled;reportcursorsbounded |

## Coordinator commit labels (workers do not commit)

- feat(transfers): controlled queue contracts [step-09f/T1]
- feat(transfers): pause resume skip and retry [step-09f/T2]
- feat(transfers): readback verification and rate estimates [step-09f/T3]
- feat(transfers): generation-bound conflict decisions [step-09f/T4]
- fix(transfers): validate history object identities [step-09f/T5]
- feat(transfers): accessible transfer and conflict windows [step-09f/T6]
- docs(help): copy controls and safe conflicts [step-09f/T7]

## Required handoff

Return `handoff/step-09f/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-09f/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
