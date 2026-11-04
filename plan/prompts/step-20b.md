# Coding assignment: step 20b — Word-style editing

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-20b.md](../steps/step-20b.md). Guide SHA-256: `be3825f0c409923a92cc73274a73f8fd5c4c99f9557b2b7813477df36f8c1186`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 5/5 |
| Branch | step-20b-document-editor |
| Reserved tag | v0.5.6-step20b |
| Depends on | 20a office-edit-1 E1-E12;09a document controller;09c content-transfer-1;09h recovery;08a snapshots |
| Written before | 07a was built |
| Contract revision | office-document-ui-1; imports office-edit-1 without redefining it |

Settings reservation: 50 -> 51; screenshot reservations: 186-188. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 08a producer guide](../steps/step-08a.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09c producer guide](../steps/step-09c.md)
- [Step 09h producer guide](../steps/step-09h.md)
- [Step 13 producer guide](../steps/step-13.md)
- [Step 20a producer guide](../steps/step-20a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Dependencies, values and exact exports

| Ref | Producer; exact canonical export | Consumption |
|---|---|---|
| U1 |20a T1/E1 types and E2-E8/E11/E12 services/controller | OfficeSessionState,TextSpan/TextFormatPatch/ParagraphFormatPatch/PageLayout/DocumentOperation/OfficeTransaction/OfficeEditComment; transact/undo/redo/state/formatting/items/formula-independentfind/capture/export/spelling/mode. Exact revision/capability/lifetime semantics remain20a. |
| U2 |09a controller.ts registerDocumentControllerFactory,DocumentControllerContext/Binding; documents/types.ts DocumentHandle/VirtualViewProps | Use20a factory bridge once per document; registerSave and registerExport bridges are coordinator wiring, not per-view duplicate save models. notifyContentChanged exactly once after successful mutation. |
| U3 |09c E1/E2 TransferRegistry and canonical TransferPayload | Register target_id `office-document:<document_id>`; accept text/rich_text/cells/image/pdf_pages as supported. PDF pages become explicit images, not embedded active PDF; files not accepted as arbitrary executable attachments. |
| U4 |08a ExportSnapshot and09f publication;06b before_modify;09h recovery | Immutable encoded capture/content_id, authorized path/version/identity checks, registered recovery; no current disk reload for unsaved export. |
| U6 |20a T7/E25, `src/services/officeDrafts.ts`,office-edit-1 | `createOfficeBlankDraft(family:'document'\|'sheet')->Promise<JobHandle<OfficeBlankDraftHandle>>`; call document only, handle.completion returns {document:DocumentHandle,controller:OfficeController}. Native approved blank creation,09a draft authority/release and save-existing=false are20a-owned. |
| U5 |Baseline commands/ribbon and05c ToolbarDock | CommandRegistry<OfficeCommandContext>,RibbonDef,existing docking, shortcuts and focus. Components return integration instructions for shared App/handler/default-app/settings/IPC/locale files. |

Canonical UI types `src/office/document/documentUiTypes.ts`: DocumentEditorViewState fields selection OfficeSelection|null,viewport OfficeViewport,navigation_open boolfalse,comments_open boolfalse,ruler booltrue,active_ribbon_tab one of the nine IDs below; no document contents. DocumentEditorProps document DocumentHandle,active bool,savedState DocumentEditorViewState|null,onStateChange(state)->void,onStatus(FileTabStatus)->void,onOpenHelp(slug)->void,previewOnly boolfalse. OfficeCommandContext controller OfficeController,state OfficeSessionState,selection OfficeSelection|null,formatting OfficeFormatting|null,view DocumentEditorViewState,openDialog(id:DocumentDialogId)->void; dialog IDs font/paragraph/page/table/image/link/style/citation/comment/find/replace/export/print/properties/compatibility, all fixedenum.

| Export | Exact signature; consumers |
|---|---|
| E1 `src/office/document/DocumentEditor.tsx` DocumentEditor | DocumentEditorProps above;09a virtual presenter adapter forwards DocumentHandle rather than inventing FileTypeInfo.path. Disk adapter only supplies actual source metadata. |
| E2 `documentCommands.ts` registerDocumentCommands | (registry:CommandRegistry<OfficeCommandContext>)->void; duplicates fail; command IDs/labels/actions matrix below, prefix `doc.`. |
| E3 `documentRibbon.ts` documentRibbon | ()->RibbonDef; nine tabs in table order, group IDs below; custom control IDs document.font/document.size/document.style/document.paragraph/document.page/document.zoom; controlled values from formatting. |
| E4 `documentTransfer.ts` documentTransferTarget | (controller:OfficeController)->TransferTarget; describe returns only compatible actions; accept builds one20a transaction. cells->real document table, string/number/bool display text; formula-like text remains text. Return TransferReceipt with actual transaction_id/revision/count. |
| E5 `documentViewState.ts` documentViewStateCodec | version1, encode/decode functions conform09a registerViewStateCodec; clamp zoom10-400,page>=1,scroll finite; strip sessionID/tokens/text. |
| E6 `documentStatistics.ts` readDocumentStatistics | (sessionId:string)->Promise<{revision:number,page:number,page_count:number,words:number,characters:number,language:string}>. Delegate20a E13 services/officeEdit.ts readDocumentStatistics and native office_edit_document_stats(session_id), capability document_text; native engine counts Unicode word boundaries, no main-thread whole-document text scan. Bind through officeEdit.ts only. |

E6 imports DocumentStatistics and E13 from20a; the UI module is a forwarding adapter and does not declare another native service or record type. Counts are actual engine semantics; fixture text “One two three.” has3words/14characters including spaces and punctuation.

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; exact commit | Files; ordered work and dependencies | Tests and exact expected result |
|---|---|---|
| T1; `feat(document): shared controller and view-state adapter [step-20b/T1]` | documentUiTypes.ts,documentViewState.ts,documentController.ts; register20a factory bridge and validatestate. U1/U2. | documentController.test.ts: two views share one model; changingviewscrollneverdirty; protected startsviewing; missingengineexplicitfallback; previewOnlynevermutable. |
| T2; `feat(document): editable viewport and synchronized selection [step-20b/T2]` | DocumentEditor.tsx,DocumentCanvas.tsx,useDocumentSelection.ts,documentStatistics.ts; E1/E6, viewportgeneration andaccessibleediting. U1/U2/U5. | documentViewport.test.tsx: stale render released; insertionone transaction; surrogate pair cannot split; status fixture3words14characters; inactiveviewstopsrender; keyboardselectionretainedonribbon. |
| T3; `feat(document): live header ribbon and backstage [step-20b/T3]` | documentCommands.ts,documentRibbon.ts,DocumentHeader.tsx,DocumentBackstage.tsx,styles/office-document.css. U1/U5/U6; nine exacttabs/groups,sharedmode/save/share; New awaits E25 blank creation, propagates cancellation and opens only returned shared draft. | `document_ribbon_reflects_engine_selection`: mixedboldindeterminate,toggle->true; readonlydisabled; all9tabs in order; side docking40/34/112 sizing; FileEscfocusrestored; new_document_uses_E25 (document family, one shared returned controller); new_document_cancel_no_tab (cancel0fabricatedpaths/0blanktabs); new_document_save_existing_disabled (Save as new required). |
| T4; `feat(document): text paragraph styles and page controls [step-20b/T4]` | DocumentFontControls.tsx,DocumentParagraphDialog.tsx,DocumentPageDialog.tsx,DocumentStyleGallery.tsx. U1; typedoperations/liveformatting. | formattingselectionnotwholefile; leftindent18->36/outdent18->0; A4margins20mm->56.692913pt; invalidmarginsfailwithoutedit; mixedfontpickerdoesnotapplydefault; sourceunsupportedstylepreserved. |
| T5; `feat(document): insert references and heading navigation [step-20b/T5]` | DocumentInsertDialogs.tsx,DocumentReferenceDialogs.tsx,DocumentNavigation.tsx,DocumentRuler.tsx. U1/U4; tables/images/fields/link/citation/page geometry. | imageusesimmutableauthorizedsnapshot; linkjavascriptrefused; TOCrefreshonlyfieldID; headingclicknotdirty; table100x100valid101rowsrefused; ruleroperationusesdocumentpointsat200%zoom. |
| T6; `feat(document): comments tracked changes and local spelling [step-20b/T6]` | DocumentComments.tsx,DocumentReview.tsx,DocumentSpelling.tsx; pageditemsandconfirmIDs. U1. | `track_changes_round_trip_preserves_review_data`; replyanchorunchanged;accept-allonlypreviewedIDs; checkerabsentdisabled; noAI/networkcall; stalecommentspanrejects. |
| T7; `feat(document): safe autosave recovery and content transfer [step-20b/T7]` | documentAutosave.ts,documentRecovery.ts,documentTransfer.ts,documentExport.ts; U2/U3/U4; perdocsave serialization andsnapshot release. | `document_autosave_failure_keeps_dirty_state`; saveRwhileeditR+1 dirty; `document_transfer_preserves_supported_formatting`; cellsreal table; formula-likeinert; cancel0targetmutations; sensitiveplaintextnotwritten. |
| T8; `docs(help): document editing and review [step-20b/T8]` | Full bilingual pages below; coordinator schema51/help/pseudo/registries/defaultapps/measurements/shots. | documentHelp.test.ts allmatrixkeys/helpIDs; allcontrolskeyboard/esdark/pseudo; schema50preservespriorprefs; Voice/dictationproviderregistrationand20cwritingextensiongated. |

Tests named under `src/__tests__/` as shown; native document_stats/operation validation and real round-trip corpus tests belong to20a boundary modules. New files under400 lines. Shared App/Explorer/main changes are coordinator-owned and at most40lines/task.

## Coordinator commit labels (workers do not commit)

- feat(document): shared controller and view-state adapter [step-20b/T1]
- feat(document): editable viewport and synchronized selection [step-20b/T2]
- feat(document): live header ribbon and backstage [step-20b/T3]
- feat(document): text paragraph styles and page controls [step-20b/T4]
- feat(document): insert references and heading navigation [step-20b/T5]
- feat(document): comments tracked changes and local spelling [step-20b/T6]
- feat(document): safe autosave recovery and content transfer [step-20b/T7]
- docs(help): document editing and review [step-20b/T8]

## Required handoff

Return `handoff/step-20b/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-20b/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
