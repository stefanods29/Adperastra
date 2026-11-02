# Coding assignment: step 09h — Crash recovery, report a problem, safe mode

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-09h.md](../steps/step-09h.md). Guide SHA-256: `15f8ade38a3977362473f7b68d1862945131aeb1d973825c2a3a8abc4416ece1`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 4/5 |
| Branch | step-09h-recovery-diagnostics |
| Tag | v0.1.8-step09h |
| Depends on | 09a shared-document/session-2;09b groups;08a snapshots;06e archive output |
| Written before | 07a was built |
| Interface revision | recovery-1; diagnostics-1 |

Settings reservation: 24 -> 25; screenshot reservations: 106-107. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 08a producer guide](../steps/step-08a.md)
- [Step 08d producer guide](../steps/step-08d.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09b producer guide](../steps/step-09b.md)
- [Step 09c producer guide](../steps/step-09c.md)
- [Step 09e producer guide](../steps/step-09e.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Read first / uses

| ID | Producer/task; exact canonical symbol | Contract |
|---|---|---|
| U1 | 09a T2 `documents/controller.ts` DocumentControllerBinding/Context and DocumentState | capture immutable encoded current revision/content_id; dirty is contentidentity-based; no originalbytesreadRange substitution |
| U2 | 08a E4/E5 exportSnapshots/ExportSnapshots | ExportSnapshot with content_id; boundedleases/storage_policy; sensitive snapshots never diskspool |
| U3 | 09a E5 loadSession/saveSession via native get_session/save_session;09b defaultedgroupmetadata;09i later defaultedsplitmetadata | Restore descriptors normally; revision/rootcodec validation; no restoration oflive tokens/passwords |
| U4 | 06e archive::create_spool; owned_io output; existing protocol | ZIP uses owned staging/no-replace; diagnostics files are app-owned synthetic entries, not arbitrary userpaths |
| U5 | 08d publicversion/release URLs; existinglogging | Diagnostics version info from build; fixed repository issue URL; no signing/private-keypathsread |
| U6 | 09e journal recovery metadata | Surface unfinished rename-journals as recovery_required; neverdelete/rename userintermediatesmerelybecausejournalexists |

Read v1 09c crash/report/safe-modeparagraphs; full09a; actualApp/FileTabView/errorhandling/bootstrap/settingsload/helper; addcommand/help/Windowsfeature recipes. Windows DPAPI CryptProtectData/CryptUnprotectData use existingwindows0.61.3 Win32_Security_Cryptography and Win32_Foundation,verifiedlocal source beforewiring; nohomemadeencryption.

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks and tests

| Task/commit | Files and dependencies | Exact test requirements |
|---|---|---|
| T1 `feat(recovery): encrypted bounded recovery records [step-09h/T1]` | recovery_types.rs/recovery_store.rs/recovery_dpapi.rs/recovery.ts;U1/U2 | native wronguserdecryptfails;truncated/hashmismatchcorruptkept;64MiB+1refused;catalogbeforedataneverpublished;DPAPIfailnoplainttextfallback |
| T2 `feat(recovery): immutable document capture scheduling [step-09h/T2]` | useRecoveryCapture.ts/recoveryScheduler.ts;coordinatorcontrollerownerhook/schema25;U1/U2 | recoveryCapture.test.ts:duplicateviewsonecature;neweditsdonotchangesnapshotR;2sdebounce/10smin;cleancontentIDnorewrite;sensitiverefused;capwarningvisible |
| T3 `feat(recovery): reviewed recovered copies and startup restore [step-09h/T3]` | recovery_open.rs/RecoveryDialog.tsx/recoveryRestore.ts;U3/U6 | originalhashunchanged;newownedcopypath/MOTWkept;Discardonlyrecord;missingoriginaldoesnotblockcopy;unfinishedrenamejournalnopathcleanup |
| T4 `feat(startup): crash markers and non-destructive safe mode [step-09h/T4]` | startup_health.rs/safe_mode.rs/safeMode.ts;coordinatorbootsettingsroot | threefailuresin5minsafe;twonot;readyafter30s;actualsettingsbytesunchanged;restartnormalawaitsdirtycancel;crashneverdropsrecovery |
| T5 `feat(diagnostics): local redacted diagnostic sessions [step-09h/T5]` | diagnostics_types.rs/diagnostics_collect.rs/diagnostics_redact.rs/diagnostics_archive.rs/diagnostics.ts;U4/U5 | redactdrive/UNC/escapedpath/user;secretfolderneverread;32MiBdumpcap;defaultnodump/nofilecontents;ZIPtraversalrefused;savecollisionforeignkept;issueURLnoattachmenttext |
| T6 `feat(ui): tab failure and diagnostics review [step-09h/T6]` | TabErrorBoundary.tsx/DiagnosticsDialog.tsx/SafeModeBanner.tsx/styles/recovery.css/styles/diagnostics.css;coordinatorviewhost | recoveryUi.test.tsx:oneviewthrowExplorerusable;Escdoesnotdiscard;edit/excludefilebeforeSave;networkonlyOpenissue;200%zoom/eslongtext |
| T7 `docs(help): recovery safe mode and diagnostics [step-09h/T7]` | sixhelpfilesbelow;coordinatorlocales/pseudo/measures/shots | everyerrorhaseneskey;helpers/disposalrealprocesscrashfixtureexecutedbycoordinator,workersnotclaimpass |

## Coordinator commit labels (workers do not commit)

- feat(recovery): encrypted bounded recovery records [step-09h/T1]
- feat(recovery): immutable document capture scheduling [step-09h/T2]
- feat(recovery): reviewed recovered copies and startup restore [step-09h/T3]
- feat(startup): crash markers and non-destructive safe mode [step-09h/T4]
- feat(diagnostics): local redacted diagnostic sessions [step-09h/T5]
- feat(ui): tab failure and diagnostics review [step-09h/T6]
- docs(help): recovery safe mode and diagnostics [step-09h/T7]

## Required handoff

Return `handoff/step-09h/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-09h/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
