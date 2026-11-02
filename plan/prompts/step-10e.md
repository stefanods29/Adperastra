# Coding assignment: step 10e — Menu editor, Home, sidebar and status bar customization, setup files

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-10e.md](../steps/step-10e.md). Guide SHA-256: `919afcc2fe7b349a484ccd06031777349bf2a57121eec3effd423a9fd394cb06`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-10e-customizable-shell |
| Tag | v0.1.16-step10e |
| Depends on | 09b groups;09d palette;10a themes;10b command-layout;10c profiles;10d decorations |
| Written before | 07a was built |
| Interface revision | shell-sections-1; setup-file-1 |

Settings reservation: 31 -> 32; screenshot reservations: 124-127. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09b producer guide](../steps/step-09b.md)
- [Step 09d producer guide](../steps/step-09d.md)
- [Step 10a producer guide](../steps/step-10a.md)
- [Step 10b producer guide](../steps/step-10b.md)
- [Step 10c producer guide](../steps/step-10c.md)
- [Step 10d producer guide](../steps/step-10d.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Read first and dependency contracts

Read v1 step10b menus/Home/navigation/status/setup paragraphs,all10a-dexports,09aUiHistory/09dpalette; actual commands/menus.ts MenuEntry union,HomePage.tsx,NavPane.tsx,FileTabStatus inhandlers/types.ts,settingsFile.ts,archiveguardedreader/zipwriter. Existing HomePage/NavPane props and FileTabStatus.items strings are legacy adapters, not imaginary registered section data.

| ID | Producer/task; exact symbol | Use |
|---|---|---|
| U1 | 02 commands/registry.ts CommandRegistry/Command;commands/menus.ts MenuEntry | Build resolvedMenuEntry from safe configuration. Runtimeicon/rendercallbacks neverpersist; enabled/visible rules stillchecked |
| U2 | 10b T1/E1 CommandLayoutRegistry,ToolbarCustomSettings andKeyboardMap/E2effectiveShortcut | Setup parts import canonical data, nevercopy/redefine; hiddenmenucommandsstaypaletteavailable |
| U3 | 10a T1/E1 CustomTheme/ThemeRef/read/save;10c E5 ProfileRoot | Safe theme data/assets andperprofileroot; noinstalledfontbytes orsourcepaths |
| U4 | 09b E4 savedgroups;09d E3 PaletteRegistry;10d E4FolderDecorationResolver | Home/nav load savedgroupsnormally;registeredviewitemsroutenormalopen; decorationusedonsamefolderentries |
| U5 | 09a T3/E9 UiHistoryRegistry and03bglobalUndo | OrdinaryshellconfigapplyoneUndo; setupapplyreservesallbefore/afterboundedstatesfirst |
| U6 | 06d/06e archive validatedentries,zip9.1writer;08aownedoutput;10csettingsFileimportpreview | Setupreadisboundedziphelper,nogenericunpack. PreviewbeforeApply;exportno-replace |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; commit | Files/work/dependencies | Named tests/oracles |
|---|---|---|
| T1 `feat(shell): configurable section and menu data [step-10e/T1]` | shell/types.ts,registries.ts,menuCustomization.ts,shell_custom_types.rs;coordinator schema32. U1-U5 | shellData.test.ts:depth4refused;duplicateIDrefused;unknowncommanddisabled;custompathnotOSrename;defaultsretainFigmaorder |
| T2 `feat(menus): visual safe context menu editor [step-10e/T2]` | MenuEditor.tsx,MenuTree.tsx,styles/menuEditor.css;coordinatormenuentryresolution.U1/U2/E5 | menuEditor.test.tsx:previewdoesnotrun;removedcommandstillpalette;keyboardreorder;resetonetargetonly;separatorsnormalizeinrenderedcopy |
| T3 `feat(home): registered editable Home sections [step-10e/T3]` | HomeEditor.tsx,HomeSectionHost.tsx,homeProviders.ts,styles/homeEditor.css;coordinatorHomePage.U4/E1 | homeSections.test.tsx:futureproviderregisteredwithoutrootchange;staleloadcancelled;DOMorder=visualorder;hiddenproviderdoesnoload;limit100enforced |
| T4 `feat(shell): navigation and status customization [step-10e/T4]` | NavigationEditor.tsx,StatusEditor.tsx,StatusFieldHost.tsx;coordinatorNavPane/FileTabStatuslegacyadapter.U3/U4/E2/E3 | shellFields.test.tsx:displayrenameleavespath;missingLocate;disposeOwnerstopsgetter;hiddenfree-spacefielddoesnotquerydrive;criticalerrorsremainwhenstatushidden |
| T5 `feat(setup): bounded setup archive preview and export [step-10e/T5]` | setups.ts,setup_types.rs,setup_archive.rs,setup_validation.rs,SetupImportDialog.tsx;U2/U3/U6/E4 | setupArchive.test.ts/native:traversal/duplicate/symlink/executabledeny;ratio101refused;hashmismatchbeforepreview;personaldefaultabsent;exportcollisionnooverwrite |
| T6 `feat(setup): transactional application and recovery [step-10e/T6]` | SetupPartRegistry.ts,setup_transaction.rs,setup_journal.rs,setupHistory.ts;U5/E6 | setupTransaction.test.ts/native:failureaftereachpartrollsbackreverse;externallychangedconfigretainedwithrecovery;UIpublishesonceaftercommit;historylimitbeforewrite;crashprepared/applying/committedrecovery |
| T7 `docs(help): shell customization and setup files [step-10e/T7]` | helpfilesbelow;coordinatortranslations/pseudo/registries/measures/shots.U1-U6 | keys/ICU/helpconsistent;untrustedlabelrenderstext;allprovidersdispose;newsettingsfixturesupdated |

## Coordinator commit labels (workers do not commit)

- feat(shell): configurable section and menu data [step-10e/T1]
- feat(menus): visual safe context menu editor [step-10e/T2]
- feat(home): registered editable Home sections [step-10e/T3]
- feat(shell): navigation and status customization [step-10e/T4]
- feat(setup): bounded setup archive preview and export [step-10e/T5]
- feat(setup): transactional application and recovery [step-10e/T6]
- docs(help): shell customization and setup files [step-10e/T7]

## Required handoff

Return `handoff/step-10e/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-10e/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
