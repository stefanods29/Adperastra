# Coding assignment: step 21b — AI for sheets

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-21b.md](../steps/step-21b.md). Guide SHA-256: `bebb320d1656444ac69a5e7b44c53dc6491e69a2ee31e614495382a9b48d247f`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 5/5 |
| Branch | step-21b-ai-sheets |
| Tag | v0.5.9-step21b; reserved |
| Depends on | 21a sheet editor;20a approved formula/proposal binding;17a provider/schema/evaluation |
| Written before | 07a was built |
| Contract revision | ai-sheet-1, office-ai-proposal-1, assistant-provider-1 |

Settings reservation: 53 -> 54; screenshot reservations: 194-195. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 17a producer guide](../steps/step-17a.md)
- [Step 20a producer guide](../steps/step-20a.md)
- [Step 21a producer guide](../steps/step-21a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses and exact exports

| Ref | Producer task; canonicalfile;revision | Exact use |
|---|---|---|
| U1 |20a T6/T7 E20-E22;services/officeAi.ts;office-ai-proposal-1 | captureOfficeAiContext with expectedrevision/content/selection; evaluateOfficeProposal onclone; officeProposalPage/release; confirmOfficeProposal only explicit foregroundbutton; applyOfficeProposal requires grant/revisions/scope; contexts/previews300s,grant60s |
| U2 |20a E7/E14/E17;services/officeEdit.ts/officeSheet.ts;office-edit-1 | parseOfficeFormula(sessionId,text,locale)->{canonical,functions,valid,error_offset_utf16}; formatOfficeFormula(sessionId,canonical,locale)->string; officeFunctions(sessionId,locale,cursor?)->OfficeResultPage<OfficeFunction>; officeCellWindow(sessionId,range)->OfficeCellWindow currentrevision≤2000cells |
| U3 |21a T1/T3/T4;sheetUiTypes.ts/formulaLocale.ts/sheetRibbon.ts;office-sheet-ui-1 | SheetCommandContext/currentselection; displayFormula/parseFormula delegateU2; existing formulaeditbuffer retainsownEnter/Esc/Undo, AIpanelmustnotcommitit |
| U4 |17a providertask;services/assistantInference.ts;assistant-provider-1 | prepareAssistantInference(AiTaskRequest)->AssistantOutboundPreview; confirmAssistantOutbound(previewId)->{consent_id}; startAssistantInference(request,consentId|null)->JobHandle<AiTaskResult>; APIonlyafterone-shotSend, provider/model/hash/sourcebound, sensitiveAPIrefused |
| U5 |17a T2/T8;schemaRegistry.ts/promptRegistry.ts/evalTypes.ts;assistant-schema-1/ai-eval-1 | Trusted schemas/prompts, bilingualtypedgoldenscorers/runEvalSuite; no remotegrader |

| Export | Producer; exact contract |
|---|---|
| E1 |21b T1;sheetAiTypes.ts;ai-sheet-1: allaction/request/output/cleandiff typesabove |
| E2 |21b T3-T6;services/sheetAi.ts: fiveorchestrationfunctionsspecifiedabove, source/previewexpirybound;17atools mayopenreviewonly |
| E3 |21b T2;cleaningTransforms.ts: applyTypedCleaning puretypedfunctionabove, noformulaevaluationorfiles |
| E4 |21b T6;SheetAiPanel.tsx props controller:OfficeController,selection:OfficeSelection|null,initialAction:SheetAiAction,onClose:()->void,onOpenHelp:(slug:string)->void |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; Files; dependencies | Numbered work | Tests: name; input → exact oracle | Commit |
|---|---|---|---|
| T1; sheetAiTypes.ts,office_sheet_ai_types.rs,sheetAiSettings.ts;U1/U2/U4/U5 | 1.DefineDTOs. 2.Schema53→54defaults. 3.Register5sheet.*.v1schemas/promptsrevision1. 4.Addtexts/pseudoandproviderstates. | sheetAiTypes.test.ts `sheet_ai_defaults_off`:enabledfalse/emptyactions; `sheet_ai_one_rectangle`:disjointrefused; `sheet_ai_oversize`:2001cellsrefused; `sheet_ai_no_arbitrary_code`:scriptfieldrejected | `feat(ai-sheet): bounded typed action contracts [step-21b/T1]` |
| T2; cleaningTransforms.ts,cleaningDates.ts,cleaningNumbers.ts,cleaningDuplicates.ts;U2 | 1.Compute typed deterministicdiffs. 2.Keepformulas/identifierzeros. 3.Requireexplicitlocaleparseoptions. 4.Markduplicatesstablefirstrow;clearonlyexplicitchoice. 5.Neverphysicallydeleterows. | sheetCleaning.test.ts `trim_exact`:“  A  B\t”→“A B”,NBSPunchanged; `date_dmy`:31/12/2026→2026-12-31; `date_invalid`:31/02/2026unchangedwarning; `number_es`:1.234,50→1234.5; `identifier_zero`:000123unchanged; `duplicate_first`:rowsA/A/BmarkssecondAonly | `feat(ai-sheet): deterministic reviewed cleaning transforms [step-21b/T2]` |
| T3; services/sheetAi.ts,sheetAiContext.ts,sheetAiGeneration.ts;U1/U4/U5 | 1.Capturecurrentcells/headers/hiddenrowscope. 2.Prepareselectedbackendrequest. 3.APIpayloadpreviewandone-shotSend;localnobackendswitch. 4.Validate5structuredoutputs. 5.Cancel/releaseonrevision/tab/lock. | sheetAiProvider.test.ts `sheet_api_requires_send`:preparedpayload0requestsuntilconsent; `sheet_api_changed_payload`:changedcellrequiresnewconsent; `sheet_sensitive_api_refused`:0network; `sheet_no_cloud_fallback`:localfailure0APIrequests | `feat(ai-sheet): consented structured suggestions [step-21b/T3]` |
| T4; sheetFormulaProposal.ts,sheetFormulaSafety.ts;U1/U2/U3 | 1.ParsecanonicalAST. 2.Checkfunctioncatalog/referenceclosure. 3.Localizedformat/reparseequivalence. 4.Buildset_cellsformulas. 5.Evaluateactualclone. 6.Displayresult/errors;Applyonlysafe/calculated. | sheetFormulaAi.test.ts `formula_sum_actual`:A1=2,A2=3,=SUM(A1:A2)actualclone5; `formula_spanish_roundtrip`:=SUMA(A1;A2)→=SUM(A1,A2)→sameAST; `formula_literal_untouched`:quoted“SUMA;”unchanged; `formula_divzero`:=1/0error/Acceptdisabled; `formula_external_denied`:=[book.xlsx]Sheet1!A1blocked0evaluation; `formula_clone_not_live`:sourceR/cellunchanged | `feat(ai-sheet): real clone-calculated formula previews [step-21b/T4]` |
| T5; sheetCleaningProposal.ts,sheetChartProposal.ts,sheetDescription.ts;U1/U2 | 1.Mapdiffstotypedset_cellsvalues. 2.Validatechartsourcewithinselection. 3.RenderchartE21actualengine. 4.Compute/readstatisticIDsforDescribe. 5.ExplanationfunctionIDsandcitationsmustexistincapture. | sheetAiProposal.test.ts `clean_one_transaction`:3changesoneUndo; `chart_actual_engine`:rendererleaserequirednotmodelimage; `chart_external_range`:outsideselectionrefused; `describe_sum_grounded`:2+3computed5,model6rejected; `explain_no_mutation`:0operations/historychange | `feat(ai-sheet): typed cleaning charts and grounded explanations [step-21b/T5]` |
| T6; SheetAiPanel.tsx,SheetAiFormulaPreview.tsx,SheetAiCleaningGrid.tsx,SheetAiChartPreview.tsx,src/styles/sheet-ai.css;U1/U3/U4 | 1.Buildfixedpanel. 2.Wire5commands. 3.SeparateSendfromAccept. 4.Editinvalidatesclone. 5.AcceptE22grant/oneUndo;readonlyactionsCopyonly. | sheetAiPanel.test.tsx `formula_accept_after_calculation`:pending/error0Accept; `sheet_accept_stale`:R+1blocks; `sheet_undo_exact`:Undoallcelltypes/formatsrestored; `sheet_formula_buffer_owns_keys`:activebufferEscnotAIapply; `sheet_spanish_dark_labels`:allkeyslocalized | `feat(ai-sheet): accessible checked suggestion review [step-21b/T6]` |
| T7; tests/fixtures/ai/sheets,tests/ai/suites/sheetEvaluation.ts,assets/ai/prompts/sheet;U5 | 1.Add50EN+50ESformulacases,30+30cleaning,20+20explain/chart/describeeach. 2.Requireformulaactualresult≥98%overall,100%acceptedformulascalculated;unsafeexternal0,canonical/localizedAST100%;cleaningprecision≥99%/recall≥95%,identifier/formulapreservation100%;chartvalidrange/render100%;explain/describehuman≥4/5andgroundedfacts100%. 3.Promptinjection20cases/provider,safety100%. 4.FailingqualityExperimental/off,safetyblocksaction. | sheetEvaluation.test.ts `formula_result_type`:number5≠text“5”; `clean_precision_oracle`:TP99FP1→0.99; `chart_render_required`:missingrenderfails; `no_model_calc_substitute`:modelclaimed5withoutclonefails | `test(ai-sheet): bilingual calculation and cleaning evaluations [step-21b/T7]` |
| T8; helpbelow,commands/settings/helpcatalog,measurements/shots;U1-U5 | 1.Addfullhelp. 2.Measureactualperformance/cleanup. 3.Recordrealengine/provider/model/corpus/hardwareevidence. 4.Checkallprovider/localandaccessibilitystates. | sheetAiHelp.test.ts `sheet_ai_help_complete`:fiveactions/pipeline/consentpresent; `sheet_ai_unknown_caps_disabled`:noapprovedengine→disablednotfake; `sheet_ai_no_automatic_retry`:networkerrorrequiresuserRetry+newconsent | `docs(ai-sheet): safe formula and cleaning help [step-21b/T8]` |

AllnamedUItests live src/__tests__; nativeformula/clone tests remain20a modules. Sharedfiles updatedbycoordinatoronly. Trap: parse success, localizeddisplay and model explanation each fail to prove calculation; only actualE21clone result enablesinsertion.

## Coordinator commit labels (workers do not commit)

- feat(ai-sheet): bounded typed action contracts [step-21b/T1]
- feat(ai-sheet): deterministic reviewed cleaning transforms [step-21b/T2]
- feat(ai-sheet): consented structured suggestions [step-21b/T3]
- feat(ai-sheet): real clone-calculated formula previews [step-21b/T4]
- feat(ai-sheet): typed cleaning charts and grounded explanations [step-21b/T5]
- feat(ai-sheet): accessible checked suggestion review [step-21b/T6]
- test(ai-sheet): bilingual calculation and cleaning evaluations [step-21b/T7]
- docs(ai-sheet): safe formula and cleaning help [step-21b/T8]

## Required handoff

Return `handoff/step-21b/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-21b/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.

AI reminder: assistant text uses17a's selected Local/API gateway; Meta is the first API provider, Local the initial choice. No automatic cloud fallback. Keys stay native; file-derived payloads need exact one-use reviewed consent. Speech/image/embeddings remain local. Reading a file never authorizes uploading it. Do not call a real provider or download a model in this assignment.
