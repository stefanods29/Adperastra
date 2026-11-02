# Coding assignment: step 09d — Explorer extras and the command palette

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-09d.md](../steps/step-09d.md). Guide SHA-256: `432af5197e24168e83a23eeb44a6e77f0ea09b6d49d925f921f3c9369fb26b1f`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-09d-explorer-palette |
| Tag | v0.1.4-step09d |
| Depends on | 09a folder views;09b saved groups;07b metadata |
| Written before | 07a was built |
| Interface revision | folder-presentation-1; palette-1 |

Settings reservation: 21 -> 22; screenshot reservations: 97-98. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07b producer guide](../steps/step-07b.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09b producer guide](../steps/step-09b.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Read first and dependencies

Read mapped v1 09a Explorer-extras and09b palette paragraphs; full09a/b; actual `src/commands/registry.ts`, `src/ribbon/shortcuts.ts`, `src/services/folderViews.ts`, `src/services/selection.ts`, `src/views/explorer/views/useItemInteractions.ts`, FileList/FileGrid/ListModeView/ColumnView; settings section registry and existing command tests. These existing files remain coordinator-owned.

| ID | Producer/task; exact file/export | Required contract |
|---|---|---|
| U1 | 02/03a `src/commands/registry.ts`: Command<C>,CommandRegistry<C>.list/get,isCommandEnabled,isCommandVisible,commandLabelKey | Command.run(ctx,arg?) returns void, never assumed Promise; evaluate enabledWhen again at activation. Add optional disabledReasonKey(ctx)->string only through coordinator |
| U2 | 05a `src/services/folderViews.ts`: folderViewKey(path)->string,getFolderViews()->Promise<FolderView[]>,setFolderView(path,mode)->Promise<void> | Extend native store/DTO additively; legacy mode/used_unix retained; folder keys normalize prefix/case/trailing slash |
| U3 | 05a `ItemViewProps` in views/explorer/views/useItemInteractions.ts | Reuse existing selection/interaction/virtualization; optional presentation below. No second selection store |
| U4 | 09a E1/E4/E6 folder tabs/session,09b E4/E6 saved groups | Palette host routes exact folder/document descriptors/restore host; missing file normal pipeline |
| U5 | 07b E1 metadata.ts readMetadata/releaseMetadata | Optional metadata only after user chooses its column, cancel when hidden; never hydrate cloud files in background |
| U6 | 05d `src/views/settings/sections.ts` SETTINGS_SECTIONS,sectionMatches; help registry | Build palette entries from registered IDs/labels/slugs, no duplicated hand-maintained catalog |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; exact commit | Owned files / numbered work / imports | Tests: file; name; input -> expected |
|---|---|---|
| T1 `feat(explorer): folder presentation contracts [step-09d/T1]` | folderPresentation.ts;folder_presentation_types.rs/folder_presentation_store.rs.1defineDTO;2migratelegacy;3validate/atomicwrite. U2/U3 | folderPresentation.test.ts +native: `legacy_mode_retained`; `name_column_required`; `duplicate_column_refused`; `width95_refused`; `long_path_not_persisted_but_browsable` |
| T2 `feat(explorer): accessible column chooser and resize [step-09d/T2]` | ColumnChooser.tsx,useColumnResize.ts,styles/folderColumns.css; coordinatorFileList/ItemViewProps. U1/U3/U5/E1 | folderColumns.test.tsx: namecannotuncheck;Right+8/ShiftRight+32;Escreset;metadatahidden cancels; persisted600max |
| T3 `feat(explorer): rubber band selection in every view [step-09d/T3]` | selectionGeometry.ts,useRubberBand.ts,SelectionBand.tsx; coordinatorItemView/virtual-layoutadapters. U3/E5/E6 | rubberBand.test.ts: edge-only excluded;Ctrl togglescapturedset;shiftadds;scrolledgridcorrect;Esc restores;blur stopsRAF;10kvirtualrowsnot10kDOMnodes |
| T4 `feat(palette): bounded bilingual command matching [step-09d/T4]` | palette/types.ts,matchPalette.ts,PaletteRegistry.ts,paletteEntries.ts. U1/U4/U6 | paletteMatch.test.ts: café matchescafe;exactstart outrankssubsequence;alltokensrequired;tiesstableID;51resultsreturns50;EnglishmatchesSpanishUI |
| T5 `feat(palette): command and location dispatch [step-09d/T5]` | CommandPalette.tsx,usePaletteCatalog.ts,styles/palette.css; coordinatorCommandoptionalreason/schema22/roots. U1/U4/U6/E2/E3 | commandPalette.test.tsx: disabledEnterdoesnothing;enablementrechecked;CtrlKonce;Escfocus;MRUonlyafterdispatch;staleasyncgenerationdiscarded;noAIentry |
| T6 `docs(help): folder columns and command palette [step-09d/T6]` | sixhelpfilesbelow; coordinatorlocales/measurements/shots/registries. U1-U6 | columnsandpalettehelp links/enesICUparity;oldfilelistkeyboardandsorttestsunchanged exceptspecifiedoptionalprops |

Traps: never change sorting semantics while changing columns; no main-thread file reads for palette; computed rectangles useonecoordinate system; no second selection reducer. Workers list exact sharedchanges instead ofeditingroots.

## Coordinator commit labels (workers do not commit)

- feat(explorer): folder presentation contracts [step-09d/T1]
- feat(explorer): accessible column chooser and resize [step-09d/T2]
- feat(explorer): rubber band selection in every view [step-09d/T3]
- feat(palette): bounded bilingual command matching [step-09d/T4]
- feat(palette): command and location dispatch [step-09d/T5]
- docs(help): folder columns and command palette [step-09d/T6]

## Required handoff

Return `handoff/step-09d/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-09d/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
