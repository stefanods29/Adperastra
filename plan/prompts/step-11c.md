# Coding assignment: step 11c — Storage view, duplicate finder, folder sizes

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-11c.md](../steps/step-11c.md). Guide SHA-256: `daf39b624585f2c2fa796f1066ffde23d78685cc216903bfa0c2b4075395e783`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-11c-storage-duplicates |
| Tag | v0.2.3-step11c |
| Depends on | 07a cache/background/identity;09a watchers;09f mutation safety;11a index;10f accessibility |
| Written before | 07a was built |
| Interface revision | storage-scan-1; duplicate-review-1; folder-size-1 |

Settings reservation: 35 -> 36; screenshot reservations: 138-140. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09d producer guide](../steps/step-09d.md)
- [Step 09f producer guide](../steps/step-09f.md)
- [Step 10c producer guide](../steps/step-10c.md)
- [Step 10f producer guide](../steps/step-10f.md)
- [Step 11a producer guide](../steps/step-11a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Read first and exact dependencies

Read v1 step11c,11a/09f/07a/09a guides,fs-service traversal/owned_io,blake3hashusage,ExplorerItem/SortSpec/FileList/DetailsPane,UiHistory/globalUndo,currentrecyclelimitations. Do not infer object-bound recycling from path-basedtrashcalls.

| ID | Producer/task; canonical export | Exact use |
|---|---|---|
| U1 | 07a E9 services/fileIdentity.ts FileIdentityKey/readFileIdentity;SourceStamp/cacheService | Keybyvolume+fileidentity;timestamps100nsfromSourceStamp;metadata-onlyplaceholderread |
| U2 | 07a E4/E10 BackgroundPolicy/scheduler | storage_scan/folder_sizestaskkinds;shared2permitbudget;foregroundbrowsingprioritized;networkoffunlessexplicit |
| U3 | 09a T4/E8 watchSubscribe/watchUnsubscribe withWatchOptionsrecursive | Rootgeneration/overflowinvalidatecachedsummaryandrequestboundedrescan; neverassumepairedrenameeventexists |
| U4 | 11a E1/E2 nativeSearchIndex metadata/store | Reuseonlyrecordsstillvalidforcapturedrootgenerationandcompletecoverage;incompleteindexrequiresmetadatawalk,neverclaimfullscanfrompartialrows |
| U5 | 09f mutation/conflict/identityapproval;03b FileAction/UndoStack | Explicitselectedrecycle/move/archive normalpipeline;noReplace/permanentdelete;duplicatecleanupcapabilityfalseifexactapproved-objectoperationunproven |
| U6 | 10c ProfileRoot/displayformats;10f Accessibility;09d ItemViewProps | Perprofilecache/formatting,accessibleparallelLargestlist,selection/scrollanchorspreservedonasyncsizes |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; commit | Files/work/imports | Named tests/oracles |
|---|---|---|
| T1 `feat(storage): bounded scan data and metadata traversal [step-11c/T1]` | crates/storage-scan/src/{types,scan,walk,limits}.rs;storage.ts/storage_scan.rs;coordinator schema36. U1/U2/U6 | step11c_scan_tests:cloud0contentreads;loopskip;hardlinkslogicaltwiceallocatedonce;allocatedunknownnot0;1Mcapreturnspartial;Cancelpreservessource |
| T2 `feat(storage): bounded cache and paged summaries [step-11c/T2]` | storage_store.rs,storage_paging.rs,storage_watch.rs;U3/U4/E1 | storageCache.test/native:stalegenerationmarked;incompleteindexnotcomplete;DB/WALincluded;page<=256/768KiB;fourretainedscanslimit;cachedfirstpaintwithoutwalk |
| T3 `feat(storage): accessible treemap and largest-item view [step-11c/T3]` | StorageView.tsx,treemapLayout.ts,LargestItems.tsx,styles/storage.css;U5/U6/E6 | treemap.test.ts:100x50children3/1horizontal=>75/25axisbeforevisualgap;zeroitemnotNaN;finalremainderexact;allcanvasactionsparallelkeyboardlist;partial/stalelabelsvisible |
| T4 `feat(duplicates): guarded full equality verification [step-11c/T4]` | duplicate_candidates.rs,duplicate_hash.rs,duplicate_compare.rs;U1/U2/E2 | step11c_duplicates_tests:samesizeunequalbytesnotverified;partialhashcollisionfullcomparefails;hardlinkcollapsed;changedstampreject;<=128KiBreadonce;Cancelnochanges;emptyfilesgroupverified |
| T5 `feat(duplicates): explicit keeper review and safe cleanup gate [step-11c/T5]` | DuplicateFinder.tsx,duplicate_cleanup.rs,DuplicateReviewDialog.tsx;U5/E3/E6 | duplicateReview.test.tsx/native:defaultkeepall;cannotremoveallphysicalmembers;staleKeeperrefused;capabilityfalse0mutations;historycursorunchangedfailure;noautodeleteorpermanentfallback |
| T6 `feat(folder-size): shared background consumers and sorting [step-11c/T6]` | folderSizes.ts,folder_sizes.rs,folder_size_consumers.rs,folderSizeSort.ts;coordinatorFileList/Details/UIsettings.U1-U3/U6/E4/E5 | folderSizes.test.ts:networkoff0walks;unknownlastbothdirections;lastconsumercancel;twofoldersdontsharewrongresult;100msbatchpreservesselection/anchor;inlineRenamefreezesresort |
| T7 `docs(help): storage duplicates and folder sizes [step-11c/T7]` | helpbelow;coordinatorkeys/pseudo/AT/measurements/screenshots.U1-U6 | key/help/ICUparity;allreportsactualpartial/reasons;nogatedcleanupfeatureclaimedcomplete |

## Coordinator commit labels (workers do not commit)

- feat(storage): bounded scan data and metadata traversal [step-11c/T1]
- feat(storage): bounded cache and paged summaries [step-11c/T2]
- feat(storage): accessible treemap and largest-item view [step-11c/T3]
- feat(duplicates): guarded full equality verification [step-11c/T4]
- feat(duplicates): explicit keeper review and safe cleanup gate [step-11c/T5]
- feat(folder-size): shared background consumers and sorting [step-11c/T6]
- docs(help): storage duplicates and folder sizes [step-11c/T7]

## Required handoff

Return `handoff/step-11c/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-11c/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
