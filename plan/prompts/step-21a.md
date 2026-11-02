# Coding assignment: step 21a — Excel-style editing

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-21a.md](../steps/step-21a.md). Guide SHA-256: `90d708d1578d9b1e897275a1a2071ee258bdb01083fda1b0fb2ac79f23ee7b53`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 5/5 |
| Branch | step-21a-spreadsheet-editor |
| Reserved tag | v0.5.8-step21a |
| Depends on |20a office-edit-1;09a documents;09c transfers;09h recovery;13 read-only Office |
| Written before |07a was built |
| Contract revision |office-sheet-ui-1; deterministic sheet UI;20c is a separate included document-AI step |

Settings reservation: 52 -> 53; screenshot reservations: 191-193. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 08a producer guide](../steps/step-08a.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09c producer guide](../steps/step-09c.md)
- [Step 09f producer guide](../steps/step-09f.md)
- [Step 09h producer guide](../steps/step-09h.md)
- [Step 12b producer guide](../steps/step-12b.md)
- [Step 13 producer guide](../steps/step-13.md)
- [Step 20a producer guide](../steps/step-20a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses and exact exports

| Ref | Producer; exact canonical export | Consumption |
|---|---|---|
| U1 |20a E1/E3/E4/E6/E7/E8/E11 | CellAddress/Range/Input/FormatPatch,SheetOperation,OfficeChart,pivot/conditional/validation payloads,OfficeSelection/Viewport/Formatting/Controller; typedtransactions andformulaASTparse/format. Never duplicate range or formula types. |
| U2 |09a controller.ts/DocumentRegistry andDocumentHandle | Controller factory ID office-sheet via20a registerOfficeControllerFactory; sharedcontent/revision/contentidentity, original-byte read versus currentcapture; save/release ownership. |
| U3 |09c E1/E2 TransferRegistry/TransferPayload | Target `office-sheet:<document_id>` accepts cells,text,image wheneligible; cells are finite typed values; explicit losses, snapshot lifetimes, one targettransaction. |
| U4 |13 E5/E6 office-sheet/OfficePresenter;12b engineTypes.OfficeFormat | Honest view-only fallback and existing format ownership.20a binding does not modify13 read-only commands. |
| U5 |08a snapshots;09f publication;09h recovery;06b version hook | Export currentencodedrevision, permitted save/copy, protected/sensitive policy and ordinary recovery provider. |
| U7 |20a T7/E25, `src/services/officeDrafts.ts`,office-edit-1 | `createOfficeBlankDraft(family:'document'\|'sheet')->Promise<JobHandle<OfficeBlankDraftHandle>>`; sheet editor calls sheet only. Await handle.completion for {document,controller}; native creates authorized XLSX draft, one visible sheet with localized office.blankSheetName index1, active A1,1900 date system, no formulas/data/links. No filesystem path, fake snapshot or independent session is created by this UI. |
| U6 |Baseline CommandRegistry<C>/RibbonDef,05c ToolbarDock | All9tabs/groups/livecommandstate andfocusedshortcut routing; no component invoke. |

CanonicalUI `src/office/sheet/sheetUiTypes.ts`: SheetEditorViewState active_sheet_id UUID|null,selection OfficeSelection sheet|null,viewport OfficeViewport,active_ribbon_tab enumeratedbelow,formula_bar/gridlines/headings bool,freeze perviewdisplay from engine,zoom25-400. Never persist formula buffer/cell bodies/passwords/tokens. SheetEditorProps document DocumentHandle,active bool,savedState SheetEditorViewState|null,onStateChange(state)->void,onStatus(FileTabStatus)->void,onOpenHelp(slug)->void,previewOnly boolfalse. SheetCommandContext controller,state,selection,formatting,view,openDialog(id SheetDialogId)->void; fixedDialogIDs cellFormat/numberFormat/conditional/validation/chart/pivot/sort/filter/find/replace/sheetName/print/export/properties.

| Export | Exact contract |
|---|---|
| E1 `src/office/sheet/SheetEditor.tsx` SheetEditor | SheetEditorProps; source-aware presenter. Existing actual-path disk bridge and VirtualViewProps bridge feed samecomponent. |
| E2 `sheetCommands.ts` registerSheetCommands; `sheetRibbon.ts` sheetRibbon | registerSheetCommands(CommandRegistry<SheetCommandContext>)->void; sheetRibbon()->RibbonDef withnine tabsbelow. |
| E3 `sheetTransfer.ts` sheetTransferTarget | (controller OfficeController)->TransferTarget. cells ->set_cells modevalues atactiveaddress; text ->singletextcell unless userchooses TSV paste preview; image ->authorized image chart/object onlyifapprovedengine supports imported drawing preservation, otherwise disabledunsupported. No Excel clipboard execution. |
| E4 `sheetViewState.ts` sheetViewStateCodec | version1 encode/decode per09a; knownsheetUUID,selectionbounds,finiteviewport; stripcell/formulabuffer data. |
| E5 `src/services/officeSheet.ts` officeCellWindow | (sessionId:string,range:CellRange)->Promise<OfficeCellWindow>; native office_edit_cell_window(session_id,range). Types OfficeCellWindow/OfficeDisplayCell are imported from20a E14, with its500row/2000cell/768KiB bounds; continuation uses same columns and next_row. Native binding cell_window is specified by20a, not a second parser; currentrevision checked before display. |
| E6 `formulaLocale.ts` displayFormula/parseFormula | (controller,canonical:string,locale:en-US/es-419)->Promise<string>; (controller,display:string,locale)->20a E7 parsedresult. DelegatesengineAST, no privateevaluator. |

E5 imports20a E14 and its exact SPI/IPC; it does not design or add a second workbook parser. Display cell response preservestypedformula input and cached display separately. row_count/column_count logicaldimensions comefrom20a sheet items.

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; commit | Owned files/work and dependencies | Tests to write and exact oracle |
|---|---|---|
| T1; `feat(sheet): source-aware spreadsheet controller and state [step-21a/T1]` | sheetUiTypes.ts,sheetViewState.ts,sheetController.ts; U1/U2/U4,sharedfactory. | sheetController.test.ts missingengineviewfallback;twoviewsonemodel; protectednoedit;unknownsheetstateclampedwithoutcontent; schema52 -> 53preservation. |
| T2; `feat(sheet): bounded virtual grid and accessible selection [step-21a/T2]` | SheetEditor.tsx,SheetGrid.tsx,sheetWindow.ts,useSheetSelection.ts,officeSheet.ts; E5/U1. | sheetGrid.test.tsx100krows<=2000mountedcells;row1048575/col16383 selectable;+1rejected;staleresponseignored;mergedactivecellannounced; hiddenviewnocontinuingfetch. |
| T3; `feat(sheet): formula entry and locale-safe expression display [step-21a/T3]` | FormulaBar.tsx,NameBox.tsx,formulaLocale.ts,formulaEditing.ts;U1/E6. | formulaLocale.test.ts=SUMA(1;2)->=SUM(1,2);literal"SUMA;"unchanged;Esc0mutations;Enteronetransaction;invalidkeepsbuffer;namedrangenotfilesystempath. |
| T4; `feat(sheet): nine-tab ribbon and workbook formatting [step-21a/T4]` | sheetCommands.ts,sheetRibbon.ts,SheetHeader.tsx,SheetBackstage.tsx,SheetFormatControls.tsx,styles/office-sheet.css;U1/U6/U7; New propagates E25 JobHandle cancellation and uses returned shared draft/controller. | sheetRibbon.test.tsx9tabsorder;mixboldindeterminate;readonlydisabled;formulaeditownundo;labelsalltranslated;movableribbondocking; new_workbook_uses_E25 (family sheet, exactly returned shared controller); new_workbook_cancel_no_tab (cancel0fakepath/0tab); blank_workbook_native_defaults (one visible sheet,A1,1900,no contents,can_save_existingfalse). |
| T5; `feat(sheet): sheet structure and safe range operations [step-21a/T5]` | SheetTabs.tsx,SheetStructureDialogs.tsx,SheetSortFilter.tsx,sheetTransfer.ts;U1/U3. | renameinvalid/duplicatecasefails;lastsheetdeletefails;sort2x3movesentirerows;mergecancelunchanged;paste100001cellsrejected;formula-likecelltextinert;oneUndoentry. |
| T6; `feat(sheet): validation conditional rules charts and pivots [step-21a/T6]` | SheetValidationDialog.tsx,SheetConditionalDialog.tsx,SheetChartDialog.tsx,SheetPivotDialog.tsx;U1. | validationlist=A/BrejectsCwithstop;conditional>5formats6not5;SUMpivotA1=2/A2=3result5;chartsourceexternaldenied;unsupportedpreservedrulesunchangedaftercell edit. |
| T7; `feat(sheet): print export recovery and formula parity [step-21a/T7]` | SheetPrintDialog.tsx,sheetExport.ts,sheetRecovery.ts,sheetParityFixtures.ts(tests only);U1/U5. | sum1+2=3;AVERAGE2/4=3;IFtruebranches;round1.25at1decimal=1.3;datesystemsretained;saveR/editR+1dirty;noexternalfetch;currentunsavedPDFsnapshotcorrect. |
| T8; `docs(help): spreadsheets formulas and data tools [step-21a/T8]` | Fullhelpbelow;coordinatorschema53/translation/IPC/handler/defaultapps/pseudo/speed/shots. | sheetHelp.test.tsallkeys/help;keyboardcell/ribbon/pickers;esdark/pseudofit;roundtripchart/pivot/formulas/unknownpartsevidencependinguntilcoordinatorrun. |

Tests under `src/__tests__/`; native cell_window and typedprintsettings validation/transaction tests in20a nativeboundary. Do not change anengineparityexpectedvalue to match anobservedwrongresult; recordmismatchandfixbindingorretainunacceptedcapability.

## Coordinator commit labels (workers do not commit)

- feat(sheet): source-aware spreadsheet controller and state [step-21a/T1]
- feat(sheet): bounded virtual grid and accessible selection [step-21a/T2]
- feat(sheet): formula entry and locale-safe expression display [step-21a/T3]
- feat(sheet): nine-tab ribbon and workbook formatting [step-21a/T4]
- feat(sheet): sheet structure and safe range operations [step-21a/T5]
- feat(sheet): validation conditional rules charts and pivots [step-21a/T6]
- feat(sheet): print export recovery and formula parity [step-21a/T7]
- docs(help): spreadsheets formulas and data tools [step-21a/T8]

## Required handoff

Return `handoff/step-21a/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-21a/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
