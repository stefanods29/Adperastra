# Step 17d: AI for scans and PDFs, and writing suggestions

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 5/5 |
| Branch | step-17d-ai-scans-writing |
| Tag | v0.5.0; reserved milestone, requires real verification and owner publication approval |
| Depends on | 17a structured tasks/evaluation;07d PDF;07e OCR;08a snapshots/conversion;06a text editing;09a controllers;12a packs |
| Written before | 07a was built |
| Contract revision | ai-extraction-1; ai-inline-1; consumes ai-runtime-1/assistant-schema-1/ai-eval-1 |

This is a **guide** step: every decision is below, but no implementation code. Workers write code/tests without installing, compiling, launching models or running checks. Coordinator integration and actual evidence remain required; authoring does not earn the milestone.

## Goal

Review scanned documents beside their sources, correct extracted tables and receipt fields, create separate editable DOCX/Markdown/text/XLSX/CSV outputs, and optionally accept short inline writing completions without delaying typing.

## Do not do in this step

No automatic OCR of folders, replacement of originals, financial/accounting advice, invoice payment, formula execution, model training or second inference engine. DOCX output opens in the existing viewer; full Office editing arrives20b/21a. PDF editing remains14a. Structured tables use OCR/layout heuristics plus the17a model; do not add an unevaluated table-detection pack.

## Read first

Read complete07d/07e/08a/08b/09a/14c/17a/17c guides, ai.md, rules R-SAFE/R-AI/R-SEC/R-BG, CodeMirror integration in06a, pinned docx9.15.0/ExcelJS4.4.0 metadata from06c, add-dependency/add-help-page/add-settings-field recipes, speed/design-spec, v1 17d. Inspect actual TextView/MarkdownView editor ownership before binding an extension; never create a second mutable text model.

## Decisions

1. **D1. Consent and limits.** Extraction is an explicit action on1-100 selected inputs, at most200pages total,50MiB/input,512MiB batch,20,000OCR words/page,100,000cells and10Mi scalars per reviewed document. Ten receipts fit the default case. Source classification comes from native grants; online-only inputs require explicit prior download and are never hydrated in background.
2. **D2. Stable source anchors.** Use07d PdfSourceIdentity exactly: disk{stamp} or snapshot{document_id,revision,content_id,sensitive}. Capture unsaved source content through09a/08a, not the saved file. Every extracted field carries source ID/page/oriented pixel rectangle/quoted OCR token IDs, with no invented confidence. Sensitive sources and results remain memory-only; unsupported encoder/publication fails before plaintext spill.
3. **D3. Layout.** OCR runs in07e helper. Group words by line/order; infer paragraphs where line gap exceeds1.5times median line height, headings where median word height exceeds1.35times body median and line has≤120scalars, bullets only from visible leading markers. Candidate tables require≥2columns and≥2rows with x-boundary agreement within0.02of page width across≥75%rows. Ambiguous grouping is flagged, not silently fixed. Model may label/reorder bounded OCR blocks but must cite existing word IDs and cannot invent missing text.
4. **D4. Review before export.** Source pane and editable semantic document/grid share selected anchor. Show low-confidence, missing, inconsistent and user-corrected fields distinctly. Confidence is heuristic provenance certainty, not factual probability: minimum of OCR available certainty (otherwise0.5), layout alignment ratio, and parser agreement; model-reported confidence is ignored. Mark uncertain below0.85. Explicit correction records before/after and a corrected flag; source never changes.
5. **D5. Receipt arithmetic.** Fields date/vendor/tax_id/currency/subtotal/tax/total/line_items. Currency is explicit ISO4217 fromsource or unknown, never inferred from language. Decimal amounts parsed to signed i64 minor units only after explicit currency-scale mapping; unknown currency stays text. Check subtotal+tax=total within1minorunit; mismatch flagged, not adjusted. Dates ambiguous between D/M and M/D remain original text until reviewed. Tax IDs/leading zeros remain text.
6. **D6. Output engines.** Promote existing pinned MIT docx9.15.0 and ExcelJS4.4.0 to helper-only encoding. No parsing in UI. DOCX contains real headings/paragraphs/lists/tables with conservative styles; no image-as-page pretend editability. Markdown/text preserve reading order. XLSX uses literal typed cells and source-reference sheet; CSV uses UTF-8+BOM,CRLF and explicit comma/semicolon delimiter. Text beginning =,+,-,@,tab or carriage return is prefixed with apostrophe in XLSX/CSV; disclose formula_safety_prefix. Financial negatives that were explicitly parsed numeric remain numeric.
7. **D7. Publication reuse.** Capture the corrected extraction model as an immutable08a ExportSnapshot with native authority and MIME application/vnd.adperastra.extraction+json, schema1. Static converter IDs extraction_docx/extraction_md/extraction_txt/extraction_xlsx/extraction_csv consume that snapshot through08a Converter/ConvertOutputSink; no new file writer. Parent names output, owns staging/flush/no-replace/history, and returns actual ConversionOutput rows. Each invocation creates1document or1workbook; CSV emits one selected table or combined receipt table only. No false one-input/one-output path field.
8. **D8. Inline is opt-in.** Schema46→47 adds ai.writing.inline_enabled false and enabled_types text/markdown/code booleans allfalse. Pause750ms after a normal insertion, collapsed cursor, focused active editable local document, no IME composition, selection, find dialog or protected mode. Take≤2048preceding/512following Unicode scalars from immutable editor revision; suggestion≤256scalars/single paragraph. One pending job/editor and one visible ghost. Inline completion is available only while the selected assistant backend is Local AI; API selection disables it with an explanation because a typing pause cannot authorize an upload. Never switch backends automatically. A new key, cursor move, change, blur, tab switch or lock cancels immediately; no inference in input handler.
9. **D9. Keyboard and history.** Tab accepts only a nonempty visible current ghost and otherwise preserves06a's Tab focus behavior. Escape dismisses without dirty state. Accept is one CodeMirror transaction at captured cursor with exact revision/content identity, one Undo entry, no save. Completion text is plain text, never executed or automatically formatted; code completions remain Experimental until language-specific evaluation passes. Screen reader gets one short completion-available announcement; no repetitive streamed token speech.
10. **D10. Milestone honesty.** v0.5 includes the17a-d AI features plus earlier ordinary features only after real suite/hardware/manual checks. Existing Blockers/Majors, pack licenses, actual scores, source retention and owner release approval must be resolved. No downloading weights, preparing fake screenshots or claiming model runs during guide writing.

## Data shapes

### Selected backend and outbound review

Text/vision extraction uses17a E7 assistant-provider-1, canonical services/assistantInference.ts: prepareAssistantInference(AiTaskRequest)->Promise<AssistantOutboundPreview>, confirmAssistantOutbound(previewId)->Promise<{consent_id:string}>, startAssistantInference(request,consentId|null)->Promise<JobHandle<AiTaskResult>>. Import AssistantOutboundPreview/AssistantProviderId from17a, not a local copy. OCR/layout work stays local; selecting API never sends scans/OCR text automatically. Show the exact selected page images/excerpts, provider/model, source labels and bytes before a separate foreground one-shot Send. Result correction and Export are later separate actions. Sensitive/unlocked inputs refuse API; no hidden fallback, prior-chat resend or automatic paid retry.

Add service `prepareExtraction(request:ExtractionRequest)->Promise<ExtractionPreparedRequest>`; ExtractionPreparedRequest fields id UUID, request, sources ExtractionSource[], outbound_preview AssistantOutboundPreview, expires_unix now+300. It performs authorized local OCR/layout first and prepares the exact model payload without network. Change extractSources signature to `(request:ExtractionRequest,preparedId:string,outboundConsentId:string|null)->Promise<JobHandle<ExtractionReview>>`; prepared ID binds source revisions/request and local also prepares with null consent. T3 adds the native prepare command `ai_extract_prepare_start(request_id,request)` with shared jobs; its TypeScript service awaits completion to return the declared prepared record. T3 tests `extraction_api_requires_send` (OCR can finish; network0 until Send), `extraction_api_source_changed` (changed source invalidates consent), `extraction_api_sensitive_refused` (0network), `extraction_no_automatic_retry` (one explicit Send at most one billed request). T6 test `inline_api_selected_disabled` requires0inference/0network and ordinary Tab focus behavior when API is selected. Add aiInline.localRequired = “Choose Local AI to use inline suggestions.” / “Elige IA local para usar sugerencias en línea.” Help extraction pages add the exact sentence “With an API backend, review the displayed scan content and confirm Send once before inference.” / “Con un servicio de API, revisa el contenido mostrado del escaneo y confirma el envío una vez antes del procesamiento.” Inline help adds the local-backend requirement. No consent is stored in settings or recycled across a typing pause.

Canonical `src/services/aiExtractionTypes.ts`, `src-tauri/src/ai_extraction_types.rs`. Wire fields snake_case. Reuse imported PdfSourceIdentity/AiInputRef/AiCitation/ExportSnapshot, never redefine them. UUID strings and safe integer constraints follow20a/08a conventions; JSON pages≤768KiB, model structured payload≤256KiB.

| Type | Fields and bounds |
|---|---|
| ExtractionSource | id UUID; input AiInputRef; identity PdfSourceIdentity; display_name<=255; page_count1-200; sensitive bool native-derived |
| ExtractionAnchor | source_id UUID; page u32≥1; word_ids u32[]1-256; rect{x,y,width,height} finite normalized0..1,positive area; quote string≤512; source identity obtained through source_id |
| ExtractionValue | original string≤16384; value string≤16384; confidence finite0..1; status certain/uncertain/missing/inconsistent/corrected; anchors ExtractionAnchor[]≤8; correction_revision safeu64 |
| ExtractionBlock | id UUID; kind heading/paragraph/list/table; order u32; heading_level nullable1-6; text nullableExtractionValue; list_items ExtractionValue[]≤1000; table_id nullableUUID; matching variant fields only |
| ExtractionTable | id UUID; source_ids UUID[]1-100; columns {id UUID,name ExtractionValue,type text/number/date}[]1-100; rows {id UUID,cells ExtractionValue[]}[]≤10000; rectangular; global100000cells; header bool |
| ReceiptRecord | id UUID; source_id UUID; date/vendor/tax_id/currency/subtotal/tax/total ExtractionValue; date_iso nullableYYYY-MM-DD; currency_code nullableISO4217; subtotal_minor/tax_minor/total_minor nullablei64 withinJSsafe range; line_items ExtractionTable; arithmetic_ok bool|null |
| ExtractionReview | id UUID; revision safeu64; content_id UUID; sources ExtractionSource[]≤100; blocks ExtractionBlock[]≤10000; tables ExtractionTable[]≤100; receipts ReceiptRecord[]≤100; complete bool; warnings stablecode[]≤32; next_cursor nullableUUID; expires_unix now+1800; sensitive bool. Full native review≤16MiB; paginated data only UI |
| ExtractionRequest | inputs AiInputRef[]1-100; kind document/tables/receipts; locale en/es; ocr_language auto/installedBCP47; request_revision u32 |
| ExtractionCorrection | tagged field {id UUID,expected string,value string}; table_cell {table_id,row_id,column_id,expected,value}; split_column {table_id,column_id,separator string1-8}; merge_columns {table_id,column_ids UUID[]2-10,separator string≤8}; review revision required separately. All changes typed and previewed, max1000operations |
| ExtractionPublish | review_id UUID; expected_revision safeu64; expected_content_id UUID; format docx/md/txt/xlsx/csv; table_id nullableUUID; dest_dir absolute; name string1-180stem; accepted_warning_codes ConversionWarningCode[]; include_source_labels bool true. No overwrite flag |
| InlineCompletionRequest | document_id UUID; revision safeu64; content_id UUID; cursor_utf16 safeu64; before≤2048scalars; after≤512scalars; file_type text/markdown/code; language string≤32; generation u32 |
| InlineCompletion | generation u32; revision safeu64; content_id UUID; cursor_utf16; text≤256scalars; expires_unix now+30; no edits/paths/commands |

Native extraction model snapshot schema1 stores the full corrected review fields above plus chosen output table/format and source labels as inert data. It contains no capabilities/tokens/passwords, native paths or executable formula; source path labels are included only by explicit user checkbox and ordinary sources. Sensitive labels are logical provider labels, never decrypted disk paths. Snapshot≤16MiB, owned-authority classification cannot be downgraded.

| Service in services/aiExtraction.ts; native IPC | Signature and ownership |
|---|---|
| extractSources; ai_extract_start | (request:ExtractionRequest,preparedId:string,outboundConsentId:string|null)->Promise<JobHandle<ExtractionReview>>; prepareExtraction(request)->Promise<ExtractionPreparedRequest> performs local OCR and outbound review first. Native request_id/request/prepared_id/outbound_consent_id; retain source/OCR grants throughout review |
| extractionPage; ai_extract_page | (reviewId:string,cursor:string)->Promise<ExtractionReview>; cursor bound to ID/revision,30minexpiry |
| correctExtraction; ai_extract_correct | (reviewId:string,expectedRevision:number,corrections:readonlyExtractionCorrection[])->Promise<ExtractionReview>; atomic corrected-model history, revision+1/contentnewUUID; no source mutation |
| captureExtraction; ai_extract_capture_start | (request:ExtractionPublish)->Promise<JobHandle<ExportSnapshot>>; captures immutable review revision/content, helper encodes schema1 with native authority; no destination publication yet |
| releaseExtraction; ai_extract_release | (reviewId:string)->Promise<void>; idempotent, cancel jobs, OCR/pixel/snapshot grants released; sensitive buffers zero/drop onlock |
| requestInlineCompletion; ai_inline_start | (request:InlineCompletionRequest)->Promise<JobHandle<InlineCompletion>>; native validates owning controller/current revision and caps; completion never a mutation |

All commands ensure_main, input ownership/revision/limits and cancellation; registration+isolation allowlist mandatory. Errors `ai_extract.invalid/changed/too_large/unsupported/uncertain/failed` and `ai_inline.unavailable/changed` below. Helper memory512MiB/30sperpage; full batch cancellable background, no holds of app lock during inference/encoding.

## Uses from other steps

| Ref | Producer task; canonical file; frozen revision | Exact use |
|---|---|---|
| U1 |14c T2;localAiTypes.ts/localAiRuntime.ts;ai-runtime-1 | 17a startAssistantInference(AiTaskRequest,outboundConsentId)->Promise<JobHandle<AiTaskResult>>, structured_text/vision_answer; prompt arguments trust source, fixed output schemas, native leases; releaseAiArtifact(id) |
| U2 |17a T2/T8;assistant/schemaRegistry.ts,promptRegistry.ts,evalTypes.ts;assistant-schema-1/ai-eval-1 | registerAiSchema/registerAiPrompt; runEvalSuite(suiteId)->Promise<JobHandle<EvalSummary>>, versioned bilingual examples/oracles |
| U3 |07e T2-T4;services/ocr.ts;ocr-1 | recognizeText(OcrRequest)->Promise<JobHandle<OcrPage>>,ocrPage/releaseOcr; OcrPage words/text/page/source with PdfSourceIdentity; no invented OCRconfidence field |
| U4 |07d source/render task;services/pdf.ts;pdf-reader-2 | PdfInput snapshot{reference:{snapshot_id,document_id,revision,content_id}}/file{path,expected?}; openPdfInput,readPdfText/renderPdfPage; source identity and pagecoords remain source-bound |
| U5 |08a T2/T4;exportSnapshots.ts/convert.ts;conversion-2/export-snapshot-2 | ExportSnapshot with content_id and native-sensitive policy; startConversion(ConversionRequest)->Promise<JobHandle<ConversionReport>>; Converter::convert and ConvertOutputSink parent publication; shared authority/upload1MiB routes |
| U6 |06a editor and09a controller tasks;09a documents/types.ts | DocumentHandle currentrevision/content; captured immutable editor text; one actual CodeMirror dispatch under controller. Original readRange never substitutes unsaved currenttext |
| U7 |12a background;07a sharedhelper;06c pinned encoder metadata | Reuse helper confinement/packs/jobs; docx9.15.0/ExcelJS4.4.0 encoding only, never an unapproved Office engine |

## Exports for later steps

| ID | Producer; canonical file | Exact export |
|---|---|---|
| E1 |17d T1;aiExtractionTypes.ts;ai-extraction-1 | All source/anchor/review/correction DTOs above;20c/21b/22b may consume reviewed captured text/table data with attribution, never native private review map |
| E2 |17d T3/T4;services/aiExtraction.ts | extractSources/extractionPage/correctExtraction/captureExtraction/releaseExtraction signatures above; immutable source leases/30minTTL |
| E3 |17d T5;src/extraction/extractionPublication.ts | publishExtraction(request:ExtractionPublish)->Promise<JobHandle<ConversionReport>>; capture once, choose exactregisteredconverter/options, call08astartConversion; releasecaptureafter job completes. Before leavingpage retainreportoutputs notassumedpaths |
| E4 |17d T6;src/editor/aiInlineCompletion.ts | createInlineCompletionExtension(options:{document:DocumentHandle,fileType:text/markdown/code,language:string,enabled:boolean})->CodeMirror Extension; owns timer/job/ghost cleanup; no separate mutable document |

## UI, commands and complete translation keys

Review is a FileTab child, not a second editor controller. `ExtractionReviewPane` props reviewId:string,onClose:()->void,onOpenHelp:(slug)->void. `.extraction-review` is two equal minmax(0,1fr) columns,gap16,padding16; source and result have separate headings and scroll areas. Below900px use stacked source/result tabs, minimum review width320. Source region uses existing PDF/image presenter with overlay; selecting field scrolls to anchor without changing source. `.extraction-field` minheight40,padding8,gap8,border1token; uncertain amber icon+label (never color alone), corrected check+label. Grid virtualizes≤100visible rows, row32; status/footer buttons height32. Controls use --adp-color-surface/text/text-muted/border/accent, --adp-radius-md and existing font/spacing tokens. Skeleton≤100ms, progress text1s,Cancel throughout. Empty/failedpartial review shows counts and retained successful sources; never appears complete. Error role alert, jobstatus polite, table role grid/headers with correct indices.

Commands `file.scanToDocument`, `file.tablesToSheet`, `file.receiptsToSheet`, `text.inlineSuggestions`; icons FileText/Table/ReceiptText/Sparkles verified from inventory; no global shortcuts. First3readonly until explicit export, fourthsettingschange. Help slugs below. Review controls Tabnormal, arrowsgrid,Entereditcell,Esc cancel edit first then close unsavedreview confirmation. Ghost decoration aria-hidden; separate polite availability label; Tab/Esc only when ghostcurrent.

| Key | English | Spanish |
|---|---|---|
| aiExtract.document | Scan to editable document | Escaneo a documento editable |
| aiExtract.tables | Tables to spreadsheet | Tablas a hoja de cálculo |
| aiExtract.receipts | Receipts and invoices to spreadsheet | Recibos y facturas a hoja de cálculo |
| aiExtract.source | Source | Origen |
| aiExtract.result | Editable result | Resultado editable |
| aiExtract.review | Review extracted content | Revisar contenido extraído |
| aiExtract.export | Export a separate file… | Exportar un archivo separado… |
| aiExtract.cancel | Cancel | Cancelar |
| aiExtract.retry | Retry | Reintentar |
| aiExtract.uncertain | Check this field | Revisa este campo |
| aiExtract.corrected | Corrected | Corregido |
| aiExtract.missing | Not found | No encontrado |
| aiExtract.inconsistent | Values do not agree | Los valores no coinciden |
| aiExtract.progress | Reading page {page} of {total}… | Leyendo la página {page} de {total}… |
| aiExtract.partial | {done} sources ready; {failed} need attention. | {done} orígenes listos; {failed} requieren atención. |
| aiExtract.splitColumn | Split column | Dividir columna |
| aiExtract.mergeColumns | Merge columns | Combinar columnas |
| aiExtract.sourceLabels | Include source labels in the output | Incluir etiquetas de origen en la salida |
| aiExtract.formulaSafety | Formula-like text will be stored as text. | El texto que parece una fórmula se guardará como texto. |
| aiExtract.discard | Discard the unexported review? | ¿Descartar la revisión sin exportar? |
| aiExtract.vendor | Vendor | Proveedor |
| aiExtract.taxId | Tax ID | Identificación fiscal |
| aiExtract.date | Date | Fecha |
| aiExtract.currency | Currency | Moneda |
| aiExtract.subtotal | Subtotal | Subtotal |
| aiExtract.tax | Tax | Impuesto |
| aiExtract.total | Total | Total |
| aiExtract.lineItems | Line items | Partidas |
| aiInline.title | Inline writing suggestions | Sugerencias de escritura en línea |
| aiInline.available | Suggestion available. Tab accepts; Escape dismisses. | Sugerencia disponible. Tab la acepta; Escape la descarta. |
| aiInline.paused | Suggestions are paused for this editor. | Las sugerencias están pausadas para este editor. |
| errors.ai_extract.invalid | This extraction request is not valid. | Esta solicitud de extracción no es válida. |
| errors.ai_extract.changed | The source or review changed. Capture it again. | El origen o la revisión cambió. Vuelve a capturarlo. |
| errors.ai_extract.too_large | This batch exceeds the extraction limits. | Este lote supera los límites de extracción. |
| errors.ai_extract.unsupported | This source or output is not supported safely. | Este origen o salida no es compatible de forma segura. |
| errors.ai_extract.uncertain | Review uncertain or inconsistent fields before exporting. | Revisa los campos inciertos o incoherentes antes de exportar. |
| errors.ai_extract.failed | Extraction could not finish. Original files are unchanged. | No se pudo completar la extracción. Los originales no cambiaron. |
| errors.ai_inline.unavailable | Enable suggestions and prepare the local pack first. | Activa las sugerencias y prepara primero el paquete local. |
| errors.ai_inline.changed | This suggestion no longer matches the text. | Esta sugerencia ya no coincide con el texto. |

## Tasks

Task tests live in src/__tests__ and native modules named inFiles; every named case must be written. Shared locales/settings/IPC/help/registries/measurements belong to coordinator merges. Traps apply to each task: unknown model fields refused, source text untrusted, no source write, no stale result, no sensitive spill, no file over400lines.

| Task; Files; dependencies | Numbered work | Tests: exact name, input → oracle | Exact commit |
|---|---|---|---|
| T1; create aiExtractionTypes.ts,ai_extraction_types.rs,src/editor/aiInlineTypes.ts;U1-U6 | 1.Define DTOs/limits. 2.Addschema46→47defaults. 3.Register extraction.document.v1/table.v1/receipt.v1 and writing.inline.v1 schemas/prompts revision1 in17a registry. 4.Addalltexts/pseudo. | extractionTypes.test.ts `extraction_identity_snapshot`:contentIDretained,nofakeSourceStamp; `extraction_confidence_no_model_claim`:model0.99ignored,unknownOCR0.5; `inline_defaults_off`:alltypesfalse; `extraction_unknown_fields`:scriptrefused | `feat(ai-extract): source-bound review and inline contracts [step-17d/T1]` |
| T2; ai_extraction_layout.rs,ai_extraction_sources.rs,src/extraction/sourceAnchors.ts;U3/U4 | 1.Resolve immutable inputs. 2.OCR pagewise/cached07e. 3.ApplyD3word grouping. 4.Keep anchor transforms normalized and sourcebound. 5.Cancel/releasesbefore nextsource. | extractionLayout.test.ts `layout_heading_threshold`:height14/body10 qualifies,13doesnot; `layout_table_alignment`:3of4rowsaligned qualifies75%,2of4fails; `anchor_pixel_roundtrip`:x100on1000width→0.1→100; `source_changed_aborts`:stampmismatch0output | `feat(ai-extract): bounded OCR layout and source anchors [step-17d/T2]` |
| T3; ai_extraction_jobs.rs,ai_extraction_receipts.rs,services/aiExtraction.ts;U1/U2/U3 | 1.Process≤200pagessectionwise. 2.ModelmapsOCRwordIDsintoapprovedschema. 3.Reject inventedanchors/text. 4.Parse receiptamount/datewithoutguessing. 5.Paginateimmutable review andretainfailures/counts. | extractionReceipts.test.ts `receipt_minor_units`:PENsubtotal100.00+tax18.00,total118.00→10000/1800/11800,true; `receipt_mismatch`:117.98→falseandflag; `receipt_ambiguous_date`:03/04/2026→nullISO; `receipt_tax_id`:000123kepttext; `receipt_invented_word`:unknownwordIDrejected | `feat(ai-extract): structured documents tables and receipts [step-17d/T3]` |
| T4; src/extraction/ExtractionReviewPane.tsx,ExtractionSourcePane.tsx,ExtractionGrid.tsx,ExtractionFields.tsx,extractionCorrections.ts,src/styles/ai-extraction.css;U3/U4 | 1.Sidebyside/pagedreview. 2.Fieldfocushighlightsanchor. 3.EdittypedcorrectionwithrevisionCAS. 4.Split/mergepreviewmaintainsrectangularrows. 5.Explicitlyreviewuncertainfieldsoracknowledgetheirstatusbeforeexport. | extractionReview.test.tsx `review_source_sync`:focusvendorselectspage1boundrect; `review_correct_one_cell`:R→R+1onlythatvalue; `review_stale_correction`:expectedRafterR+1fails; `review_uncertain_label`:icon+text+aria; `review_split_column`:“A,B”→A/Btwoheaders | `feat(ai-extract): side-by-side correction review [step-17d/T4]` |
| T5; ai_extraction_capture.rs,src/extraction/extractionPublication.ts,helper extraction_encode.mjs,src/convert/extractionConverters.ts;U5/U7 | 1.Promotepinnedencoderswithnotices. 2.Capturecorrectedmodelasimmutableauthorizedsnapshot. 3.Registerfivestaticconverters,existingdocument/tabletypedoptions. 4.WritehelperbytesviaConvertOutputSink,OutputDraftname_partnoneandinput_indices[0]. 5.FillConversionRequestkeep_originaltrue,accepted_losses[],accepted_warning_codes explicit layout_loss/formula_safety_prefix asapplicable,naming{stem}.{ext},capturedUTCdate,start_index1. 6.Showactualoutputs/historyandopenDOCXvieweronlyafterpublication. | extractionExport.test.ts `scan_docx_real_structure`:heading/tableareeditableXMLnotrasterpage; `xlsx_formula_inert`:=SUM(1,2)literalapostrophe,noformula; `csv_quote`:a,b→quotedfield,doublequotesdoubled; `export_capture_revision`:editreviewaftercapturedoesnotalteroutput; `export_collision`:foreignfilehashunchanged/newnameorconflict; `export_outputs`:reportoutputsusednotitems.output_path | `feat(ai-extract): reviewed safe document and spreadsheet exports [step-17d/T5]` |
| T6; src/editor/aiInlineCompletion.ts,aiInlineScheduler.ts,aiInlineGhost.ts,ai_inline.rs;U1/U6 | 1.AttachoneextensiontoexistingCodeMirror. 2.Timer750msnonblocking. 3.Cancelallpendingonchange/IME/blur/lock. 4.Showonlymatchingrevision/cursor/generation. 5.Tabacceptoneatomictransaction;Escdismiss;ordinaryTabfocusunchanged. | aiInline.test.ts `inline_waits_pause`:749ms0requests,750ms1; `inline_typing_cancels`:newkeystrokecancelsanddropslateresult; `inline_tab_one_undo`:accept+Undoexactoriginal; `inline_escape_clean`:0revisionchange; `inline_ime_no_request`:composition0; `inline_stale_cursor`:movedcursor0insertions | `feat(ai-inline): cancellable opt-in ghost completions [step-17d/T6]` |
| T7; tests/fixtures/ai/extraction and inline/,tests/ai/suites/extractionEvaluation.ts,assets/ai/prompts/extraction and inline/;U2 | 1.Add30EN+30ESscans,20+20tables,20+20receipts,50+50inlinecases;rights-clearedincllowcontrast/skew/currency/leadingzeros/injection. 2.Measureworderror≤5%clean/≤15%degraded;tablecellF1≥0.95clean/0.85degraded;receiptexactcriticalfields≥95%,uncertainrecall≥95%,inventedfields0;inlinehumanacceptability≥80%,unsafeexecution0. 3.Eachlocaleindependentlypasses;failedqualityExperimental/off,unsafeactionblocked. | extractionEvaluation.test.ts `extraction_f1_oracle`:TP8FP1FN1→F10.8888889; `receipt_currency_not_guessed`:missingcurrencyrequiredunknown; `inline_safety_oracle`:executableactionfails; `extraction_no_scores_before_run`:pendingreporthasnopercentpass | `test(ai-extract): bilingual accuracy and suggestion evaluations [step-17d/T7]` |
| T8; bilingualhelpbelow,commands/settings/helpcatalog,measurement/screenshotrunner;U1-U7 | 1.Wirecommandsandfourhelpages. 2.Addspeed/shots. 3.Recordactualgate/package/eval/fidelity/accessibility/sourcehashresults. 4.Preparev0.5draftreleaseonlyafterevidence,askownerbeforepublishing. | extractionHelp.test.ts `extraction_help_bilingual`:fourpagesandallcommands; `inline_keyboard_help`:Tab/Escstateclear; `milestone_not_automatic`:unverifiedorunapprovedreleaseunpublished | `docs(ai-extract): help and v0.5 review evidence [step-17d/T8]` |

## Full bilingual help

Create each slug under help/en and help/es with standard Intro/How to use/Good to know/See also headings, using the complete sentences below in that order.

| Slug; titles | English | Spanish |
|---|---|---|
| turning-scans-into-documents; Turning scans into documents / Convertir escaneos en documentos | Turn a scan into a separate editable document. Select a photo or PDF, choose Scan to editable document and review the result beside the original. Select a field to locate its source, correct the text and choose DOCX, Markdown or text export. OCR and layout can be wrong; review uncertain content. The original remains unchanged. DOCX opens in the viewer until document editing is available. See also: Copying text from images; AI quality tiers. | Convierte un escaneo en un documento editable separado. Selecciona una foto o PDF, elige Escaneo a documento editable y revisa el resultado junto al original. Selecciona un campo para localizar su origen, corrige el texto y exporta a DOCX, Markdown o texto. El OCR y la disposición pueden fallar; revisa el contenido incierto. El original no cambia. DOCX se abre en el visor hasta que esté disponible la edición. Consulta también: Copiar texto de imágenes; Niveles de calidad de IA. |
| extracting-tables; Extracting tables / Extraer tablas | Review a detected table before creating a spreadsheet. Choose Tables to spreadsheet, select a table and correct headers and cells. Split or merge columns in the preview, then export to XLSX or CSV. Formula-like text remains literal text. A source label helps find the original; it does not prove the extracted value is correct. See also: Turning scans into documents; Converting files. | Revisa una tabla detectada antes de crear una hoja. Elige Tablas a hoja de cálculo, selecciona una tabla y corrige encabezados y celdas. Divide o combina columnas en la vista previa y exporta a XLSX o CSV. El texto que parece una fórmula se conserva como texto. Una etiqueta ayuda a encontrar el original; no demuestra que el valor extraído sea correcto. Consulta también: Convertir escaneos en documentos; Convertir archivos. |
| extracting-receipts-and-invoices; Extracting receipts and invoices / Extraer recibos y facturas | Collect receipt fields in one reviewed table. Select receipts or invoices, choose Receipts and invoices to spreadsheet and review dates, vendor, tax ID, currency, totals and line items beside their sources. Correct uncertain or inconsistent values before export. Ambiguous dates and currencies are not guessed. Arithmetic warnings do not change totals automatically. This is extraction, not accounting advice. See also: Extracting tables; AI privacy. | Reúne campos de recibos en una tabla revisada. Selecciona recibos o facturas, elige Recibos y facturas a hoja de cálculo y revisa fechas, proveedor, identificación fiscal, moneda, totales y partidas junto a sus orígenes. Corrige valores inciertos o incoherentes antes de exportar. No se adivinan fechas o monedas ambiguas. Las advertencias aritméticas no cambian los totales automáticamente. Esta función extrae datos; no ofrece asesoramiento contable. Consulta también: Extraer tablas; Privacidad de IA. |
| inline-writing-suggestions; Writing suggestions / Sugerencias de escritura | Optional completions appear after you pause typing. Enable Inline writing suggestions and the desired file types in Settings > AI. A gray completion can appear at a collapsed cursor. Tab accepts a current suggestion and Escape dismisses it. Typing or moving the cursor cancels it immediately. Suggestions start off, remain plain text and never save or execute themselves. Undo reverses one accepted suggestion. See also: Editing text; AI quality tiers. | Las sugerencias opcionales aparecen tras una pausa al escribir. Activa Sugerencias de escritura en línea y los tipos de archivo deseados en Configuración > IA. Puede aparecer una sugerencia gris en el cursor sin selección. Tab acepta una sugerencia actual y Escape la descarta. Escribir o mover el cursor la cancela de inmediato. Comienzan desactivadas, son texto simple y nunca se guardan ni ejecutan solas. Deshacer revierte una sugerencia aceptada. Consulta también: Editar texto; Niveles de calidad de IA. |

Update OCR help with “Optional Scan to editable document opens a separate correction review; copying OCR text still works without AI.” / “La función opcional Escaneo a documento editable abre una revisión separada; copiar texto OCR sigue funcionando sin IA.”

## Check by hand

| Retained fixture | Exact content |
|---|---|
| review-root/17d/letter.pdf | One synthetic scanned page: heading Letter, paragraph “Meet on 2026-11-03.”, two visible bullet items,2x2table A/B/C/D; recorded word boxes |
| review-root/17d/table.pdf | Three columns Item/Quantity/Total,rows Pen/2/6.00 and Book/1/12.00; second degraded/skewedcopy |
| review-root/17d/receipts | Ten synthetic receipts, vendor Acme,taxID000123,PENsubtotal100.00/tax18.00/total118.00; one117.98mismatch,one03/04/2026date,oneunknowncurrency |
| review-root/17d/typing.txt | “The meeting begins ”; Markdown/codecopies; no personal content |

1. Create DOCX/MD/TXT from the letter; compare exact reading order, headings, bullets/table and unchanged source hashes. Open DOCX in actual existing viewer.
2. Correct/split/merge a table, export XLSX/CSV, inspect literal formula-like text and actual ConversionOutput files. Cancel and collision must preserve originals.
3. Review ten receipts, source anchors, confidence labels and arithmetic/date warnings; verify no guessed currency/tax ID conversion.
4. Test inline off/default,750ms pause,typing cancellation,IME,Tab/Esc,oneUndo,blur/tab switch/lock and readonly/protected cases.
5. Check Spanish dark,pseudo,keyboard,200%zoom,Narrator,partial/error states and memory-only sensitive refusal. Actual owner sample checks remain pending until performed.

## Speed, screenshots and completion

Measurements: `step17d.review.open` Fast1s excluding inference; `step17d.field.edit` Instant0.1s; `step17d.inline.typing` Instant0.1s and no>20%regression; `step17d.inline.cancel` Instant0.1s; `step17d.source.scroll` Smooth16ms. Extraction/encoding/inference use jobprogress andCancel, never block input. Record walltime/page,peakmemory,model/corpus/version/hardware hashes in actual JSON; do not claim arbitrary inference target passed.

Screenshots173-scan-document-review,174-table-receipt-review,175-inline-suggestion, eachen/light,es/dark,pseudo/light under docs/screenshots/step-17d/.

Done when safe source-bound extraction, all five outputs, corrected tables/receipts and optional nonblocking completions are verified; schema47/help/translations/evaluation/cleanup/security are complete; coordinator records real gate/package/speed/screenshots/quality and all17a-d milestone requirements. Prepare release draft only; v0.5 publishing needs the owner's yes.
