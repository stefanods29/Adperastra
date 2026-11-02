# Coding assignment: step 10b — Toolbar and keyboard customization

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-10b.md](../steps/step-10b.md). Guide SHA-256: `763a2f76bf6e6a8b619da77c09a1e4ad09d84bb0c7200306aeac08ada388ab50`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-10b-toolbars-shortcuts |
| Tag | v0.1.13-step10b |
| Depends on | 05c docking;04b ribbon;09d palette;10a |
| Written before | 07a was built |
| Interface revision | command-layout-1; keyboard-map-1 |

Settings reservation: 28 -> 29; screenshot reservations: 117-118. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09c producer guide](../steps/step-09c.md)
- [Step 09d producer guide](../steps/step-09d.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Read first and exact dependencies

Read v1 step10a toolbar/keyboard paragraphs,04b/05c guides, current `src/ribbon/types.ts`, `src/ribbon/shortcuts.ts`, `src/services/shortcuts.ts`, `src/commands/{registry,menus,explorerCommands}.ts`, `src/layout/ToolbarDock.tsx` and `src/layout/toolbarLayout.ts`, and all command/ribbon tests. Read09a/b/c/d contract tables and UiHistoryRegistry.

| ID | Producer/task; symbol and canonical file | Contract used |
|---|---|---|
| U1 | 02/04b registry.ts Command<C>,CommandRegistry<C>,isCommandEnabled,isCommandVisible,commandLabelKey | run(ctx,arg?) returns void; no code from persisted configuration. Recheck current context at dispatch |
| U2 | 04b ribbon/types.ts RibbonDef/RibbonTab/RibbonGroup/RibbonControl | Existing controls only button,toggle,custom; custom render callbacks remain trusted static source and are addressed by ID, never serialized |
| U3 | 05c ToolbarDock,ToolbarLayoutContext,toolbarLayoutFor,tooltipPlacement | Keep docking and label geometry; customize entries before existing layout/overflow measurement |
| U4 | 04b ribbon/shortcuts.ts matchesShortcut/useCommandShortcuts; services/shortcuts.ts formatShortcut(shortcut,t) | Replace matching route through E3; do not leave competing listeners using old default shortcuts |
| U5 | 09a T3/E9 services/uiHistory.ts UiHistoryRegistry | Register adapter command-layout and keyboard-map; before/after data validated, history capacity reserved before apply |
| U6 | 09a tab shortcuts/09c drop/09d search palette | Ctrl+1..9 remain tab selection;Ctrl+Shift+S remains Save as;Ctrl+K palette; focusedsearch Ctrl+Tab overrides globalMRU; shelf defaultCtrl+Alt+S, notSaveas |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; exact commit | Files/work/imports | Tests/input -> expected |
|---|---|---|
| T1 `feat(customize): command layout and shortcut data [step-10b/T1]` | commandLayout.ts,keyboard/types.ts,keyboardMaps.ts,command_layout_types.rs,keyboard_map_types.rs;coordinator schema29. U1/U2/U5 | keyboardMaps.test.ts/native `unknown_command_retained_disabled`;`custom_renderer_not_deserialized`;`twenty_first_map_refused`;schema28settingspreserved |
| T2 `feat(toolbar): editable command layouts [step-10b/T2]` | ToolbarCustomizer.tsx,toolbarCustomization.ts,styles/toolbarCustomizer.css;coordinatorCommandBar/Ribbonintegration. U1-U3/E1 | toolbarCustomization.test.tsx:hidekeepspalettecommand;customcontrolcannotcrossincompatiblegroup;mandatoryHelpreachable;Cancelpreserves;verticaloverflowstillworks |
| T3 `feat(keyboard): one scoped shortcut router [step-10b/T3]` | KeyboardRouter.ts,shortcutNormalization.ts,effectiveShortcuts.ts;coordinatoruseCommandShortcutsbridge androotlistener. U1/U4/U6/E2 | keyboardRouter.test.ts:oneeventonecommand;defaultPreventedignored;AltGr/compositionignored;searchCtrlTabwins;Gnotcapturedininput;500mssequenceexpiry |
| T4 `feat(keyboard): editable keyboard presets and conflicts [step-10b/T4]` | presets.ts,ShortcutEditor.tsx,ShortcutCapture.tsx,styles/shortcuts.css. U4/E2/E3/E6 | keyboardPresets.test.ts:FinderExplorerEnterrename/textEnternewline;CommanderF8recycleonly;Vimggfirst;prefixconflictrefused;OSreservedreject;nonUSphysicalcodekept |
| T5 `feat(customize): shared preview history and quick access [step-10b/T5]` | customizeHistory.ts,QuickAccessBar.tsx,ClassicMenuBar.tsx;coordinatorUiHistoryadapterregistration/menuupdates. U1/U3/U5 | customizeHistory.test.ts:applyoneUndo;capacityfailsbeforemutation;undoinvalidcommanddoesnotexecute;failedsavekeepsdraft;quickmax20 |
| T6 `docs(help): toolbars and keyboard styles [step-10b/T6]` | fullhelppagesbelow;coordinatorlocale/pseudo/commandtexts/speedshots. U1-U6 | commands/help/tooltip effectivebindingparity;currentribbonunitcasesretained;sharedsettingsliteralfixturesupdatedwithdefaults |

## Coordinator commit labels (workers do not commit)

- feat(customize): command layout and shortcut data [step-10b/T1]
- feat(toolbar): editable command layouts [step-10b/T2]
- feat(keyboard): one scoped shortcut router [step-10b/T3]
- feat(keyboard): editable keyboard presets and conflicts [step-10b/T4]
- feat(customize): shared preview history and quick access [step-10b/T5]
- docs(help): toolbars and keyboard styles [step-10b/T6]

## Required handoff

Return `handoff/step-10b/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-10b/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
