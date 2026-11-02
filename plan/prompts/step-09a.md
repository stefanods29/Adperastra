# Coding assignment: step 09a — More tabs and sessions

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-09a.md](../steps/step-09a.md). Guide SHA-256: `7979f71cf84974fb5ce21fa052879bbbf089f84e84d32ffdc8c4be3e908f9069`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-09a-tabs-sessions |
| Tag | v0.1.1-step09a |
| Depends on | current04a tabs/open pipeline,06a unsaved state,08a snapshots;chronological08d acceptance independentfromwriting |
| Written before | 07a was built |
| Interface revision | tabs-documents-1;session-2 |

Settings reservation: 19 -> 20; screenshot reservations: 91-92. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07b producer guide](../steps/step-07b.md)
- [Step 07c producer guide](../steps/step-07c.md)
- [Step 07d producer guide](../steps/step-07d.md)
- [Step 08a producer guide](../steps/step-08a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| Ref | Producer; exactsymbol/file | Contract |
|---|---|---|
| U1 | 04a services/tabs.ts TabState/TabsState/SessionData,openFileTab/activateTab/closeTab/setTabView/sessionFromTabs/tabsFromSession | Existingfieldskept; newoptionals/defaultsbelow,onlycoordinatormodifiescanonicalfile |
| U2 | 06a useUnsavedChanges.tsx UnsavedChanges.confirmClose(ids)->Promise<boolean>,SaveHandle | Awaitapproval; shareddocumentpromptdeduplicated; cancelneverclosesdirtyviews |
| U3 | 04a handlers/openPipeline.ts planOpen(path,registry,openWith)->Promise<OpenDecision> | Actualdiskfileopening/defaultapps/protectedview;nosession-grantreuse |
| U4 | 05c TabStrip/ToolbarDock/layout contexts | KeeponeTabStrip; currentpropslabel/onActivate/onClose,optionalnewactionssuppliedcoordinator; preserveallsides |
| U5 | 08a E4/E5 ExportSnapshot/ExportHandle/exportSnapshots;07d E8 GrantedBacking/FileGrants | DocumentHandle.captureSnapshotreturnsimmutableauthorizedsnapshot;sensitivestoragepolicyenforcedbackend |
| U6 | 02 services/explorer.ts SortSpec/ExplorerItem;05a ViewModeId;05b columnroot | ExactSortKey/directionabove; per-folderViewstateimportsactualtypes,notcopy |
| U7 | 07b QuickPreviewDialog;07c GalleryContent | Eachoriginviewhasownselection/activeflag;noquick-previewcross-tabstaleresults |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; commit | Files/work | Tests/exactoracles |
|---|---|---|
| T1; `feat(tabs): bounded folder and document descriptors [step-09a/T1]` | coordinatorcanonicaltabs/sessiontypes;newdocuments/types.ts,session.rs,folder-statehelpers. D1/D6/D7/E4. | duplicatepermanentExplorerfixedtoexactlyone;201strefused;virtualtitle/tokennotserialized;existinglegacyfiletabmigrateswithoutpathmeaningchange |
| T2; `feat(documents): shared revision and lifetime registry [step-09a/T2]` | DocumentRegistry.ts,documents/closePolicies.ts,services/documents.ts,nativedocuments.rs/document_grants.rs; native08a SnapshotAuthorityRegistry registration/revocation;D7-D9/E3/E4. | twoacquiresonesourceonedocument; closeoneviewretainsdirtysecond; lastreleasecancels/revokes; absentlockedproviderfailsexplicit; snapshotrevision1unchangedafteredit2 |
| T3; `feat(tabs): pin duplicate reorder and reopen [step-09a/T3]` | newtabActions.ts/tabHistory.ts pluscoordinatorcanonicalreducers. E1/E2,pinnedsegment/MRU/bounds. | permanentcannotclose/pin; pinnedcannotcrosssegmentonreorder;duplicatehasnewviewID/samedocID;closedhistory51keepsnewest50;MRUcyclekeepsvisibleorder |
| T4; `feat(explorer): independent folder tab views [step-09a/T4]` | FolderTabView.tsx/useFolderTabState.ts;coordinatorExplorerHomeinitialstate props/Appmount/key/status. | folderAselectiondoesnotchangeB;inactivewatcher30sreleased;reorderkeepscomponentidentity;onefolderpreviewdoesnotcontrolanother |
| T5; `feat(sessions): bounded view-state restore [step-09a/T5]` | services/viewState.ts/sessions.ts/sessionValidation.ts;coordinatorRustsave/load/schema20startupsettings/codecs. | imagefit/manualturnspreserved;mediaautoplayfalse; prototypekey/depth9/64KiB+1rejected;schemanewerretainednotdowngraded; activefirst/max2opens; missingfileplaceholderkeepsothers |
| T6; `feat(tabs): dirty-safe tab controls and keyboard routing [step-09a/T6]` | tabKeyRouting.ts/TabContextMenu.tsx;coordinatorTabStrip/App/useUnsavedChangesregistrybridge. | close awaits E11 atomic policy/dialog plan;cancel keeps every affected view/model;Ctrl+9last;searchfocusedCtrl+TabdoesnotactivateotherTab;sharedDocpromptonce;virtualnoDiskinvoke |
| T7; `docs(help): tabs and startup sessions [step-09a/T7]` | helppagesbelow;coordinatorkeys/pseudo/measures. | allcommandshelp; bilingualmissing/limit/close labels;startupmigration19keepsupdates/privacy; noexecutedtestclaimsfromworkers |

Tests newtabs/session/documents/folderTabs/tabKeyboard.test.ts(x), nativevalidationmoduleunitcaseswithinjectedproviders. Underlyingfile/snapshot/sourcepermissionsmustalsohavereviewer-runintegrationtests; no inventedclosedtabrestorewithoutnormalopen.

## Coordinator commit labels (workers do not commit)

- feat(tabs): bounded folder and document descriptors [step-09a/T1]
- feat(documents): shared revision and lifetime registry [step-09a/T2]
- feat(tabs): pin duplicate reorder and reopen [step-09a/T3]
- feat(explorer): independent folder tab views [step-09a/T4]
- feat(sessions): bounded view-state restore [step-09a/T5]
- feat(tabs): dirty-safe tab controls and keyboard routing [step-09a/T6]
- docs(help): tabs and startup sessions [step-09a/T7]

## Required handoff

Return `handoff/step-09a/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-09a/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
