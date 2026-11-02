# Step 21b: AI for sheets

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 5/5 |
| Branch | step-21b-ai-sheets |
| Tag | v0.5.9-step21b; reserved |
| Depends on | 21a sheet editor;20a approved formula/proposal binding;17a provider/schema/evaluation |
| Written before | 07a was built |
| Contract revision | ai-sheet-1, office-ai-proposal-1, assistant-provider-1 |

This is a **guide** step: all decisions are fixed below, with no implementation bodies. Workers write source/tests; coordinator executes verification. A real approved Office binding and actual formula/chart evidence remain required. Missing capabilities are disabled controls, never fake successful evaluation.

## Goal

Review an already calculated formula before insertion, explain formulas, preview typed cleaning changes, see suggested charts rendered by the actual engine, and review a description of a selected table.

## Do not do in this step

No model arithmetic as a substitute for engine calculation, JavaScript/eval/shell execution, arbitrary SQL, macros, external workbook references, web-service formulas, automatic data cleanup, hidden-row deletion, external data refresh, new Office engine or silent network upload. Ordinary manual formulas remain21a. Deck assistance is22b.

## Read first

Read20a E7/E14/E17/E20-E22 and full formula safety/clone contracts,21a formulaLocale/grid/selection,17a assistant-provider-1/schema/evaluation,14c localruntime, ai.md/rules/speed/design, settings/help recipes, v1 21b. Verify every canonical import against producer guide; do not infer engine support from a parsed formula alone.

## Decisions

1. **D1. Selection boundary.** One rectangle≤2000cells,500rows,100columns,24000textscalars; no disjoint selection. Formulaproposal target is one editable cell; cleaning/chart/table description use explicitly selected rectangle and headerchoice. Include hidden rows only when user selects the separate Include hidden rows control, off bydefault; native records actualscope. Protected/noneditable cells block affectedchanges beforepreview.
2. **D2. Selected assistant backend.** All five text/vision reasoningactions use17a prepareAssistantInference/confirmAssistantOutbound/startAssistantInference. Local means no outboundpayload. API means exact visible provider/model/payload/sourceexcerpt preview and explicit one-shot Send, then result review separately. Selecting API never authorizes filecontent uploads, resend, paid retry or history upload. Sensitive/unlocked context refuses API. No automatic provider/local fallback.
3. **D3. Formula pipeline.** Model proposes one canonical Englishfunction formula plus explanation and referenced sourceaddresses. Native parser parses through approvedengine, verifies supportedfunctioncatalog/AST and allowedcurrentworkbookreferences, then formatOfficeFormula produces localizeddisplay (ESfunctionnames/semicolon). Parse thatdisplay back and require identicalcanonicalAST. Only then build a typed set_cells/formulas proposal and evaluate through E21on actual isolated clone. Display actual calculatedvalue/error, canonicalformula and localizedformula before Accept. Errors/blockedfunctions/non-determinism disableAccept, neverinsertanuncalculatedformula.
4. **D4. Deterministic limits.** E21maximum256formulas,2000targetcells,100000dependencycells,30s/512MiBclone limit. Block externalnameindirection, workbookrefs, macros, DDE, WEBSERVICE/RTD/HYPERLINK, volatile RAND/RANDBETWEEN/NOW/TODAY and unsupportedfunctions; do not replace them with cached values. Formula can read only captured workbook data inside authorized dependencyclosure; model gets only visible consentedselection/excerpts, no arbitrary file reader.
5. **D5. Cleaning is typed.** Model selects allowedcolumnoperations trim_spaces/normalize_date/parse_number/mark_duplicates. App executes deterministictransformers on immutable captureddata and shows exact before/afterdiff. Trim removes leading/trailing U+0020/U+0009 only and collapses consecutiveinterior U+0020 toone; preserveNBSP. Dateoperation requires explicitsourceformat YYYY-MM-DD/DD/MM/YYYY/MM/DD/YYYY and ISOoutput; invalid dates/ambiguoussource remainunchanged+warning. Numberoperation requires explicitdecimal/thousandsseparators and finite result; leadingzeroidentifiers staytext unless usermarksnumericcolumn. Duplicatecomparison uses typednormalizedvalues across selectedkeycolumns, stablefirstrowkeeper; defaultmarksduplicate rows inpreview only. Clearing duplicatecellvalues needs separatecheckbox and stillneverdeletesphysicalrows. Formula cells remainunchangedbycleaning.
6. **D6. Chart.** Model chooses only20a OfficeChart kind column/bar/line/area/pie/scatter and a subrange ofselectedcurrentworkbookcells. Appvalidates dimensions, headers, numericseries and roworder, constructs typed OfficeChart, then E21renders actual chart onclone. No model image, fakechartcanvas or externalrange. Unsupported chartdisabled; do not silently substitute type.
7. **D7. Explain/describe.** Read-onlyoutputs cite selectedcell/rangeaddresses and parsed functionIDs. Describe only statistics computed by engine/typedapp fromcapturedcells; model cannotinvent totals/trends. Explanationdoesnoteditformula; copytext explicit. No guarantee of financialcorrectness.
8. **D8. Acceptance and settings.** Schema53→54 adds ai.sheets.enabled false and experimental_actions emptylist of formula/explain/clean/chart/describe. Current17aqualitytier shown. Acceptedformula/clean/chart uses E22humanconfirmedoneatomictransaction/Undo; selectionrevision/content/scopecheckedagain. Editing prompt, formula, cleaningoptions or charttype invalidatesoldpreview/consent. Retryneverautomatic.

## Data shapes and service boundary

Canonical `src/office/sheet/ai/sheetAiTypes.ts`, native mirror `src-tauri/src/office_sheet_ai_types.rs`. Reuse20a CellAddress/Range/Input/OfficeChart/OfficeProposalPreview; every string is data, never an enginecommand. Wireunknownfields/nonfinitevalues/refexcess refused; response≤768KiB, modelstructuredpayload≤256KiB.

| Type | Exact fields |
|---|---|
| SheetAiAction | formula/explain/clean/chart/describe |
| SheetAiRequest | action; session_id UUID; expected_revision safeu64; expected_content_id UUID; selection CellRange; target CellAddress|null (requiredformula); header bool true; include_hidden bool false; request string1-2000scalars; locale en/es; request_revision u32 |
| SheetFormulaOutput | schema_id sheet.formula.v1; canonical string1-8192starts=; explanation string≤4096; referenced_ranges CellRange[]≤32; no resultvalue suppliedbymodel |
| SheetExplainOutput | schema_id sheet.explain.v1; explanation string≤8192; function_ids string[]≤64; cited_ranges CellRange[]≤32; no operations |
| SheetCleanOperation | tagged trim_spaces{columns u16[]1-100}; normalize_date{columns,source_format YYYY-MM-DD/DD/MM/YYYY/MM/DD/YYYY}; parse_number{columns,decimal dot/comma,thousands none/dot/comma/space,allow_leading_zero bool false}; mark_duplicates{key_columns u16[]1-100,clear_duplicate_values bool false}. Columns zero-basedwithinselectedrectangle;≤16operations, no mixed separator overlap |
| SheetCleanOutput | schema_id sheet.clean.v1; operations SheetCleanOperation[]1-16; explanation≤4096 |
| SheetChartOutput | schema_id sheet.chart.v1; kind OfficeChart.kind; source CellRange; headers bool; title≤512; explanation≤4096 |
| SheetDescribeOutput | schema_id sheet.describe.v1; text≤8192; cited_ranges CellRange[]≤32; statistic_ids UUID[]≤32; stats mustreferapp-ownedexactcomputedvalues |
| SheetCleanDiff | address CellAddress; before CellInput; after CellInput; reason trim_spaces/normalize_date/parse_number/duplicate; warning nullable ambiguous_date/invalid_number/identifier_preserved/formula_preserved/duplicate_mark_only; duplicate_of nullableCellAddress |
| SheetAiSuggestion | id UUID; action; context OfficeAiContext; output correspondingtypedoutput; diffs SheetCleanDiff[]≤2000paginated; preview OfficeProposalPreview|null; localized_formula nullable≤8192; status awaiting_send/generating/previewing/ready/applying/applied/error/cancelled; model_id/model_revision; request_revision; expires_unix now+300 |

| Export; file | Exact signature/lifetime |
|---|---|
| prepareSheetSuggestion; services/sheetAi.ts | (controller:OfficeController,request:SheetAiRequest)->Promise<SheetAiPreparedRequest>; SheetAiPreparedRequest{idUUID,request,context_idUUID,outbound_preview:AssistantOutboundPreview,expires_unix}. APIpayloadreviewmustnotautoconfirm |
| generateSheetSuggestion; same | (preparedId:string,outboundConsentId:string|null)->Promise<JobHandle<SheetAiSuggestion>>; local nullconsent; nativegatewayvalidatesAPIone-shotconsent/hash/revisions |
| previewSheetSuggestion; same | (controller:OfficeController,suggestionId:string,edited:SheetAiOutput)->Promise<JobHandle<SheetAiSuggestion>>; SheetAiOutput is exact discriminated union of5outputs above; editable changes rerunparse/typedtransform/clone andinvalidateoldpreview |
| acceptSheetSuggestion; same | (controller:OfficeController,suggestionId:string)->Promise<OfficeTransactionResult>; formula/clean/chartonly; explicit E22grant; explain/describe noapplyaction |
| releaseSheetSuggestion; same | (id:string)->Promise<void>; idempotent destroyscontexts/previews, no save/log ofcells |
| applyTypedCleaning; sheet/ai/cleaningTransforms.ts | (cells:readonlyOfficeDisplayCell[],range:CellRange,operations:readonlySheetCleanOperation[])->SheetCleanDiff[]; pure, deterministic, noengineorfiles; refuses>2000cells |

No new generationIPC: gateway andOfficeproposalcommands ownnativeauthority. Cleaningtypesvalidatedboth sides. Native errorssheet_ai.invalid/changed/unsafe_formula/calculation/ambiguous/failed use translationsbelow;20a stableerrorsarecanonical. Code files split byfeature≤400lines.

Current unsaved cells are captured by20a E5 with exact revision/content. Acquire14c E3 AiInputRef through acquireAiInput(ConversionInput snapshot{snapshot_id,document_id,revision})->Promise<AiInputRef>; releaseAiInput and08a snapshot when the request ends. Kind document is original backing revision1 only, never current unsaved cells. Bounded source arguments/statistic IDs must match the same immutable E20 capture and native allowlist. Native-sensitive classification is inherited; no caller flag can downgrade it or authorize API.

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

## UI, commands and full translations

Five command IDs `sheet.aiFormula/aiExplain/aiClean/aiChart/aiDescribe`, labelskeysbelow; Sparklesicon, noglobalshortcuts. Formula/Explain inFormulasAIgroup, Clean/Chart/Describe inDataAIgroup; groupkeysheetAi.title. Missingengine/proposalcapability/pack/provider showsactualreason. Explainrequiresformulacell; activeformulaeditbufferblocksopeninguntiluserconfirms/cancelsit.

`.sheet-ai-panel` complementaryregion,width400,min320,maxviewportminus32,padding16,gap12; below1000dialog800withtabsSource/Proposal/Result. Gridpreviewrow32,maxheight320,virtualized,headersticky, changedcellsinclude before/afterlabels. Formula display usesreadonlymonospacefields canonical/localized andactualresult/error; resultnevermodelprose. ChartpreviewusesOfficeRenderPagelease,accessiblecaptionandunderlyingrange. Footer Send onlyforAPIpayloadreview, Generateforlocal, Acceptonlycalculatedeligiblemutatingaction, Retry/Edit/Discard. Skeleton100ms,text1s,Cancel; rolealertforerrors,politejobstatus. Focusstartsrequestinput,Escclosesinnermosteditthenpanel/restoresribbon; noglobalEnterapply. UIcolors/font/radius useexistingtokens only.

| Key | English | Spanish |
|---|---|---|
| sheetAi.title | AI spreadsheet help | Ayuda de hojas de cálculo con IA |
| sheetAi.formula | Write a formula that… | Escribir una fórmula que… |
| sheetAi.explain | Explain this formula | Explicar esta fórmula |
| sheetAi.clean | Clean this data | Limpiar estos datos |
| sheetAi.chart | Suggest a chart | Sugerir un gráfico |
| sheetAi.describe | Describe this table | Describir esta tabla |
| sheetAi.request | What do you need? | ¿Qué necesitas? |
| sheetAi.source | Selected cells | Celdas seleccionadas |
| sheetAi.canonical | Canonical formula | Fórmula canónica |
| sheetAi.localized | Formula in this language | Fórmula en este idioma |
| sheetAi.calculated | Calculated result | Resultado calculado |
| sheetAi.notCalculated | Not calculated; insertion is disabled. | Sin calcular; la inserción está desactivada. |
| sheetAi.before | Before | Antes |
| sheetAi.after | After | Después |
| sheetAi.reason | Reason | Motivo |
| sheetAi.header | First row contains headers | La primera fila contiene encabezados |
| sheetAi.hidden | Include hidden rows | Incluir filas ocultas |
| sheetAi.clearDuplicates | Clear duplicate values after the first row | Borrar valores duplicados después de la primera fila |
| sheetAi.duplicatesKept | Duplicate rows are marked only; no rows will be deleted. | Solo se marcan las filas duplicadas; no se eliminarán filas. |
| sheetAi.generate | Generate suggestion | Generar sugerencia |
| sheetAi.accept | Accept previewed changes | Aceptar los cambios revisados |
| sheetAi.retry | Retry | Reintentar |
| sheetAi.edit | Edit suggestion | Editar sugerencia |
| sheetAi.discard | Discard | Descartar |
| sheetAi.cancel | Cancel | Cancelar |
| sheetAi.progress | Preparing and checking the suggestion… | Preparando y comprobando la sugerencia… |
| sheetAi.copy | Copy explanation | Copiar explicación |
| sheetAi.stats | Computed from the selected cells at revision {revision}. | Calculado con las celdas seleccionadas en la revisión {revision}. |
| errors.sheet_ai.invalid | Select one supported range or formula cell. | Selecciona un intervalo o celda de fórmula compatible. |
| errors.sheet_ai.changed | The workbook changed. Prepare a new preview. | El libro cambió. Prepara una vista previa nueva. |
| errors.sheet_ai.unsafe_formula | This formula uses a blocked function or reference. | Esta fórmula usa una función o referencia bloqueada. |
| errors.sheet_ai.calculation | This formula did not calculate successfully. | Esta fórmula no se calculó correctamente. |
| errors.sheet_ai.ambiguous | Choose explicit date or number rules before cleaning. | Elige reglas explícitas de fechas o números antes de limpiar. |
| errors.sheet_ai.failed | The suggestion could not be prepared. Cells are unchanged. | No se pudo preparar la sugerencia. Las celdas no cambiaron. |

Cleaningreasonkeys sheetAi.trimSpaces/NormalizeDate/ParseNumber/Duplicate = Trim spaces/Normalize date/Parse number/Duplicate and Quitar espacios/Normalizar fecha/Interpretar número/Duplicado. Warningkeys sheetAi.ambiguousDate/InvalidNumber/IdentifierKept/FormulaKept = Ambiguous date/Invalid number/Identifier kept as text/Formula kept unchanged and Fecha ambigua/Número no válido/Identificador conservado como texto/Fórmula sin cambios. Selectedprovider/outboundreview/Send/consenterrors reuse17aexactkeys; do not duplicate or weaken the warning.

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

## Full bilingual help

Create ai-help-in-spreadsheets.md inbothlanguages. ENtitle **AI help in spreadsheets**. Intro: “Review calculated formulas and typed changes before editing a workbook.” How to use: “Select one range and choose an AI action. Write a formula that proposes one formula, checks its supported functions and references, then calculates it on a separate copy before insertion. Review its canonical form, localized form and actual result. Explain this formula and Describe this table produce read-only text. Clean this data shows every before-and-after cell change; choose explicit date and number rules. Suggest a chart renders a real chart from the selected cells. Accept only the changes you reviewed.” Good to know: “External connections, volatile or blocked formulas and macros do not run. Ambiguous dates and leading-zero identifiers are not guessed. Duplicate rows are marked first; rows are never deleted by cleaning. Choosing an API backend requires a separate preview and one-time Send consent for the displayed cell content. Acceptance still requires another explicit action. Undo reverses one accepted transaction. Check results yourself.” See also: “Formulas; AI quality tiers; AI privacy.”

EStitle **Ayuda de hojas de cálculo con IA**. Intro: “Revisa fórmulas calculadas y cambios tipados antes de editar un libro.” Cómo usar: “Selecciona un intervalo y elige una acción de IA. Escribir una fórmula propone una fórmula, comprueba sus funciones y referencias compatibles y la calcula en una copia separada antes de insertarla. Revisa la forma canónica, la forma en tu idioma y el resultado real. Explicar esta fórmula y Describir esta tabla generan texto de solo lectura. Limpiar estos datos muestra cada cambio de celda; elige reglas explícitas de fechas y números. Sugerir un gráfico representa un gráfico real con las celdas seleccionadas. Acepta solo los cambios que revisaste.” Para tener en cuenta: “No se ejecutan conexiones externas, fórmulas volátiles o bloqueadas ni macros. No se adivinan fechas ambiguas ni identificadores con ceros iniciales. Primero se marcan las filas duplicadas; la limpieza nunca elimina filas. Un servicio de API requiere una vista previa separada y permiso de envío de una sola vez para las celdas mostradas. Aceptar los cambios sigue requiriendo otra acción explícita. Deshacer revierte una transacción aceptada. Comprueba los resultados.” Consulta también: “Fórmulas; Niveles de calidad de IA; Privacidad de IA.”

Update spreadsheet-formulas with “Optional AI proposals are calculated on a separate copy before insertion.” / “Las propuestas opcionales de IA se calculan en una copia separada antes de insertarlas.”

## Check by hand

| Retained fixture | Content |
|---|---|
| review-root/21b/formulas.xlsx | A1=2,A2=3,A3blank; B1=“000123”; B2literal“=SUM(1,2)”; C1=0; existingchart/namedrange/validation/protectedcell/hiddenrow |
| review-root/21b/clean.xlsx | Headers Name/Date/Amount/ID; rows “  Ana  ”/31-12-2026/“1.234,50”/“000123”; duplicateAna; invalid31-02-2026; formula=SUM(A1:A2) kept; no real personaldata |

1. Generate SUM, AVERAGE, IF, ROUND, invaliddivision andblockedexternalcases. Inspectactualclone values,canonical/localizedforms andunchangedsource untilAccept.
2. Cleanspaces/date/number/duplicates andinspect everytypedchange. Undo exactcells/formats; formula/identifierpreservationmandatory.
3. Suggestchart andcompare realenginepreviewwithacceptedchart;explain/describemustnoteditanything.
4. Switchlocal/API:payloadpreview+Send,changedpayloadnewconsent,sensitiveAPIrefusal,networkfailurewithoutfallback/automaticretry.
5. Testsourceeditafterpreview,expiry,cancel,readonly,Spanishdark,pseudo,keyboard,200%zoomandNarrator.

## Speed, screenshots and done

Add `step21b.panel.open` Instant0.1s, `step21b.clean.diff2000` Fast1s, `step21b.preview.grid.scroll` Smooth16ms, `step21b.accept.warm` Instant0.1s forsingleformula; actualclonecalculate/render/inferenceusecancellableWaiting/backgroundtiersandmeasuredwalltime. Preserve21atyping/scrollwithin20%andtheirtiers. Screenshots194-sheet-ai-calculated-formula and195-sheet-ai-clean-chart,each en/light,es/dark,pseudo/light under docs/screenshots/step-21b/.

Done when allfiveactions use the selectedbackend with explicitpayloadconsent, formulas are actuallycalculatedbeforeeveryacceptedinsert, typedcleaning/chartrealengine/groundedexplanations preserve source/Undo, schema54/help/translations/evaluations/security/accessibility arecomplete, and coordinatorreportsactualgate/package/speed/model/provider/engineevidence.
