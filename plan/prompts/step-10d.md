# Coding assignment: step 10d — Folder colors, icons, backgrounds, column sets

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-10d.md](../steps/step-10d.md). Guide SHA-256: `07e8f9518b309e865b0b539d4c7178d5cb99cbf8a0a4376c0c82459bb0a6704a`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-10d-folder-customization |
| Tag | v0.1.15-step10d |
| Depends on | 07a/b previews/identity;09f identity effects;09d folder-presentation-1;10a contrast;10c profile-root-1 |
| Written before | 07a was built |
| Interface revision | file-identity-1; folder-customization-1 |

Settings reservation: 30 -> 31; screenshot reservations: 122-123. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 07b producer guide](../steps/step-07b.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09d producer guide](../steps/step-09d.md)
- [Step 09f producer guide](../steps/step-09f.md)
- [Step 10a producer guide](../steps/step-10a.md)
- [Step 10c producer guide](../steps/step-10c.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Goal, exclusions and read first

Customize folder color/icon/background throughout the app, optionally write Windows desktop.ini, and assign column sets manually. No automatic folder classification, remote images, arbitrary icon DLLs, AI or changes to user folders without explicit Windows-integration consent. Read mapped v1 step10b folder paragraphs;09d/10a/10c; actual folderViews.ts/FileList/ColumnView/Breadcrumb/NavItem/TabStrip/fileTile/native transfer history and owned_io, settings recipes.

| ID | Producer/task; canonical export | Dependency |
|---|---|---|
| U1 | 09d T1/E1 folderPresentation.ts FolderPresentation/ColumnSpec/ColumnId,get/setFolderPresentation | Extend existing column IDs additively; never duplicate sort/group/view DTOs |
| U2 | 07b T1/E1 metadata.ts MetadataField/Info/readMetadata/releaseMetadata | Additionalmusiccolumns are audio_title/audio_artist/audio_album already fixedmetadataIDs; selectingcolumnstartsboundedbackgroundrequestonly |
| U3 | 07a T2/T3/E1/E3/E5/E8 cache/leases/decode | Userimages max64MiB,owneddecodedcachePNG; no pathURL; release leaseswheninvisible |
| U4 | 10a T5/E4 themeMath.ts contrastRatio/resolveReadableAccent | Same4.5text/3nontext thresholds andalgorithm, no new approximatecontrastfunction |
| U5 | 10c T4/E5 ProfileRoot | Perprofilecatalog/assets underprofile_dir; sharedpacksuntouched |
| U6 | 09a T3/E9 UiHistoryRegistry;09f native exact completed effect identities | One appmetadataUndo; followmovesonlyauthoritativeIdentityEffect below,neverpathguess; unprovedidentityreceipt leavesrecordunmigratedanddiagnostic |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; commit | Files/work/dependencies | Named tests/oracles |
|---|---|---|
| T1 `feat(identity): shared stable file identity receipts [step-10d/T1]` | fileIdentity.ts,file_identity.rs,folder_identity_effects.rs;D2/E1/E6;coordinatornativeoperationreceiptbridge.U5/U6 | fileIdentity.test.ts/native:stablevolumefiledistinctacrossvolumes;unstablepathfallback;forgedUIeffectrefused;incompleteeffectnotmigrated;copyretainsoriginal |
| T2 `feat(folders): bounded customization catalog [step-10d/T2]` | folderCustomization.ts,folder_customization_types.rs/folder_customization_store.rs;U3/U5/U6 | folderCustomization.test.ts/native:10001refused;failedtransactionpreserves;assetsbeforeDB;Undooneentry;unknownassetneverdeleted |
| T3 `feat(folders): shared decoration and background resolver [step-10d/T3]` | FolderDecorationResolver.ts,FolderBackground.tsx,styles/folderCustomization.css;U1-U4/E2/E4;coordinatorallfolderentrypoints | folderDecoration.test.tsx:exactoverridewinsancestor;reparseinheritstops;globaloffdoesnotreadimage;stalegenerationignored;textcontrast>=4.5;firstrowsnotblocked |
| T4 `feat(folders): manual column sets and suggestions [step-10d/T4]` | ColumnSetEditor.tsx,columnSetSuggestion.ts,column_sets.rs;U1/U2/E3 | columnSets.test.ts:5of8photos=>photos;4of8=>general;4of4=>generalminimum5;Namecannotremove;disabledfeaturekeepsregularcolumns;metadatarequestedonlyvisible |
| T5 `feat(folders): explicit Windows appearance writes [step-10d/T5]` | folder_desktop_ini.rs,desktop_ini_data.rs,FolderCustomizeDialog.tsx;U3/U6/E5 | desktopIni.test.ts/native:newfileonlyownedpublish;existingfileunavailable0writes;unknownINIkeyspreserved;drive/system/reparse refused;Cancelretainsoriginalfolderattrs |
| T6 `docs(help): folder appearance and column sets [step-10d/T6]` | sixhelpfilesbelow;coordinator schema31/locales/pseudo/speedshots.U1-U6 | allkeys/help/commandregistration,allentrypointssameResolver,Spanishdark/pseudobounds |

## Coordinator commit labels (workers do not commit)

- feat(identity): shared stable file identity receipts [step-10d/T1]
- feat(folders): bounded customization catalog [step-10d/T2]
- feat(folders): shared decoration and background resolver [step-10d/T3]
- feat(folders): manual column sets and suggestions [step-10d/T4]
- feat(folders): explicit Windows appearance writes [step-10d/T5]
- docs(help): folder appearance and column sets [step-10d/T6]

## Required handoff

Return `handoff/step-10d/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-10d/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
