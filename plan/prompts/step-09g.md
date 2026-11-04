# Coding assignment: step 09g — "What's using this file?" and the shelf

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-09g.md](../steps/step-09g.md). Guide SHA-256: `83293fe0a3dfb1188080f02ae16c06067ab26202afda423219bb4b591a61e090`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-09g-locks-shelf |
| Tag | v0.1.7-step09g |
| Depends on | 09b saved-groups-1;09c content-transfer-1;09f transfer-jobs-1;07a thumbnails |
| Written before | 07a was built |
| Interface revision | file-locks-1; shelf-1 |

Settings reservation: 23 -> 24; screenshot reservations: 104-105. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 08b producer guide](../steps/step-08b.md)
- [Step 08c producer guide](../steps/step-08c.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09b producer guide](../steps/step-09b.md)
- [Step 09c producer guide](../steps/step-09c.md)
- [Step 09e producer guide](../steps/step-09e.md)
- [Step 09f producer guide](../steps/step-09f.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Read first / uses

Read mapped v1 09c lock/shelf paragraphs; full09b/c/f; existing native Windows helper/job pattern; `src/services/explorer.ts` shareItems/openItem; fileops clipboard/drag wrappers; layout05c guide and actual panel registry. All source locations are fixed below; shared layout integration is returned as coordinator instructions.

| ID | Producer/task; canonical export | Consumption |
|---|---|---|
| U1 | 09f E1/E2 transferJobs.ts startTransfer/controlTransfer | Copy/move shelf references through one queue; failures/missing items remain visible, no duplicated engine |
| U2 | 09e E6 batch/registry.ts resolveBatchAction;08b presets/08c PrivacyDialog;06e archive creation | Existing options/confirmations remain; shelf itself is not permission to modify, share or clean |
| U3 | 07a E7 FileThumbnail(path,edge,active,fallback,className?) |64px shelf thumbnail, cancel/release when hidden; cloudplaceholderneverbackgroundread |
| U4 | 09b E4/E6 saved groups;09a normalopen/DocumentRef | Open as group via exactdescriptors/GroupRestoreHost, no fabricatedfilepathsforvirtualentries |
| U5 | 09c E1/E2 transfer tokens/TransferRegistry; existingfileops clipboardSetFiles(paths,cut) andnativeOLEdrag | Onlyexplicitdrop/drag action; persistdiskrefs,nevertransfer tokens/bytes/decryptedvirtualnames |
| U6 | 09a E9 UiHistoryRegistry;03b UndoStack;05c layout | Shelfadd/remove/clear/move-order appstateundo; panevisibility/placement addedinsettingswithoutnewlayoutframework |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks and tests

| Task/commit | Files/imports/work | Named test/input -> expected |
|---|---|---|
| T1 `deps: enable Windows Restart Manager [step-09g/T1]` | coordinatorCargoWindowsfeature/license;create file_lock_types.rs/fileLocks.ts;U1/U3 | nativeDTOinvalidpid/startticks/pathlimitsrefusedbeforeRMsession;featuresverifiedagainstpinnedsource |
| T2 `feat(locks): bounded program inspection and normal close [step-09g/T2]` | file_locks.rs/restart_manager.rs/process_identity.rs;U1;D1-D3 | native `pid_reuse_refused`; `critical_self_other_user_denied`; `close_session_contains_only_selected_process`; `no_force_flags`; `session_ended_on_all_errors`;realfixtureopenhandleidentified |
| T3 `feat(shelf): persistent bounded file references [step-09g/T3]` | shelf_types.rs/shelf_store.rs/shelf.ts/shelfValidation.ts;U4/U6 | shelf.test.ts:nodupnormalizedpaths;1001refused;clearleavesdiskhashes;virtualneverpersisted;revisionraceoriginalkept |
| T4 `feat(shelf): shared action and drag routing [step-09g/T4]` | shelfActions.ts/shelfRefresh.ts/useShelfDrop.ts;U1-U5 | actionreviewrequired;missingitemreported;completedmoveonlyupdatesactualpaths;sensitiveexternaldragdeniedwithoutsafe-copy;refreshnohydrate |
| T5 `feat(ui): files in use and dockable shelf [step-09g/T5]` | FilesInUseDialog.tsx,CloseProgramDialog.tsx,ShelfPanel.tsx,styles/shelf.css/styles/fileLocks.css;coordinatorschema24/layout/routes | locksUi/shelfUi.test.tsx:warningbeforeclose;Escnocloseprocess;CtrlAltSonly;keyboardrows/menus;Saveasshortcutunchanged |
| T6 `docs(help): files in use and shelf [step-09g/T6]` | fourhelpfilesbelow;coordinatorlocales/pseudo/shots/measures | bilingualroutes/keyparity;hiddenpanelcancelsmetadata/leases;oldfileopsretained |

## Coordinator commit labels (workers do not commit)

- deps: enable Windows Restart Manager [step-09g/T1]
- feat(locks): bounded program inspection and normal close [step-09g/T2]
- feat(shelf): persistent bounded file references [step-09g/T3]
- feat(shelf): shared action and drag routing [step-09g/T4]
- feat(ui): files in use and dockable shelf [step-09g/T5]
- docs(help): files in use and shelf [step-09g/T6]

## Required handoff

Return `handoff/step-09g/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-09g/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
