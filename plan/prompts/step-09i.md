# Coding assignment: step 09i — Split view

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-09i.md](../steps/step-09i.md). Guide SHA-256: `83a33314852dc6feb3ceb2a923acd97c5ac4b0ffbc823708c395ee443ffbbb76`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-09i-split-view |
| Tag | v0.1.9-step09i |
| Depends on | 09a tabs-documents-1/session-2;09b saved-groups-1;09c content-transfer-1 |
| Written before | 07a was built |
| Interface revision | split-view-1; scroll-sync-1 |

Settings reservation: 25 -> 25; screenshot reservations: 108-109. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09b producer guide](../steps/step-09b.md)
- [Step 09c producer guide](../steps/step-09c.md)
- [Step 09d producer guide](../steps/step-09d.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Read first / uses

Read mapped v1 09d split paragraph;full09a/b/c;currentTabStrip,FileTabView,ExplorerHome,ToolbarDock/ribbonhost/session/codecs. Existingcomponentlogicremainscoordinator-owned; newSplitView hostcomposesitthroughpublicpropsbelow.

| ID | Producer/task and exact export | Required use |
|---|---|---|
| U1 | 09a E3/E4 DocumentRegistry/DocumentHandle/DocumentRef/VirtualViewProps | Referencecount per leaf, shareactualcontrolleracrosstwo views, independentselection/scroll. Lastviewdirtycoordinationawaited |
| U2 | 09a E6 FolderTabView; E1/E2 tabsreducers;E5sessions | Eachfolderleafownslisting/watcher/state; compositeoutertabdoesnotcreateanotherExplorerstore |
| U3 | 09b SavedTabDescriptor/catalognormalizers | Extendalloweddescriptorunionwithsplitbelow, preservenestedsecretcaps; notunboundedrecursiveSessionTab |
| U4 | 09c TransferRegistry/useTabDropTarget/contentpayloads | Internal/externaldropactionsrouteactiveleaf; no assumededitabletargetbeforeitsadapterregisters |
| U5 | 04b/05c existingribbon/layout/context;09dpalette | Activeleafsuppliesonecommandcontext/ribbon/status/help; toolbarsstilldockwithToolbarDock |
| U6 | 09a E10TabHistory,06a confirmClose,documentregistrycontroller | Allsplit/unsplit/swap/close structuralhistoryusesdescriptorswithoutcontent; no duplicateunsavedprompt |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks / exact tests

| Task/commit | Files/work/dependencies | Required tests and oracle |
|---|---|---|
| T1 `feat(splits): bounded leaf and session descriptors [step-09i/T1]` | splitViews.ts/splitValidation.ts/split_types.rs;coordinatorTabKind/session/catalogunions;U1-U3 | splitViews.test.ts:nestedsplitrefused;legacytabunchanged;virtualtitleomitted;ratioNaNrefused;missingonesidedoesnotdropother |
| T2 `feat(splits): identity-preserving split transactions [step-09i/T2]` | splitActions.ts/splitHost.ts;U1/U2/U6/E1 | splitActions.test.ts:twotabsconsumedoneouter;stableviewIDs/sharedmodelretainedacrosspresentationremount;swapactivefollowscontent;closelastsavedcancelpreservesboth;survivorsameouterID;oneUndo |
| T3 `feat(splits): accessible resizable leaf host [step-09i/T3]` | SplitView.tsx/SplitDivider.tsx/styles/splitView.css;coordinatorhost/ribbon/status | splitViewUi.test.tsx:keyboard1%/Shift5%;Home0.5;Escoriginalratio;minwidthcompactnotclip;activeleafcommands/F6;CtrlWwholeouter |
| T4 `feat(splits): bounded synchronized scroll ports [step-09i/T4]` | scrollSync.ts/useScrollSync.ts;coordinatorPDF/textpublicportbindings;U4/U5/E3/E4 | scrollSync.test.ts:PDF2of4within.5=>0.375;target2page=>page1within.75;syncnotreemit;disposecancelsRAF;extent0=>0;latestRAFwins |
| T5 `feat(splits): restore and transfer routing [step-09i/T5]` | splitRestore.ts/splitDropRouting.ts;coordinator09a/b/cpalette;U2-U5 | splitRestore.test.ts:global2openlimit;normalprotectedpipeline;dropsgoactiveleaf;groupbelongsouter;closingoneleafkeepssharedmodel |
| T6 `docs(help): split views and scrolling [step-09i/T6]` | twohelpfilesbelow;coordinatorlocales/pseudo/measures/shots | bilingualhelp/keyboard/commandIDsunique;oldtab/sessiontestsupdatedadditiveassertions,noskip |

## Coordinator commit labels (workers do not commit)

- feat(splits): bounded leaf and session descriptors [step-09i/T1]
- feat(splits): identity-preserving split transactions [step-09i/T2]
- feat(splits): accessible resizable leaf host [step-09i/T3]
- feat(splits): bounded synchronized scroll ports [step-09i/T4]
- feat(splits): restore and transfer routing [step-09i/T5]
- docs(help): split views and scrolling [step-09i/T6]

## Required handoff

Return `handoff/step-09i/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-09i/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
