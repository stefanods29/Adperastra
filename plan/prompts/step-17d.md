# Coding assignment: step 17d — AI for scans and PDFs, writing suggestions (v0.5)

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-17d.md](../steps/step-17d.md). Guide SHA-256: `05b0fd8d999c38d19d20fbe9abce7da4c626f9904a3c285feeea4286ffdaccc4`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 5/5 |
| Branch | step-17d-ai-scans-writing |
| Tag | v0.5.0; reserved milestone, requires real verification and owner publication approval |
| Depends on | 17a structured tasks/evaluation;07d PDF;07e OCR;08a snapshots/conversion;06a text editing;09a controllers;12a packs |
| Written before | 07a was built |
| Contract revision | ai-extraction-1; ai-inline-1; consumes ai-runtime-1/assistant-schema-1/ai-eval-1 |

Settings reservation: 46 -> 47; screenshot reservations: 173-175. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 07d producer guide](../steps/step-07d.md)
- [Step 07e producer guide](../steps/step-07e.md)
- [Step 08a producer guide](../steps/step-08a.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 12a producer guide](../steps/step-12a.md)
- [Step 14c producer guide](../steps/step-14c.md)
- [Step 15 producer guide](../steps/step-15.md)
- [Step 17a producer guide](../steps/step-17a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

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

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

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

## Coordinator commit labels (workers do not commit)

- feat(ai-extract): source-bound review and inline contracts [step-17d/T1]
- feat(ai-extract): bounded OCR layout and source anchors [step-17d/T2]
- feat(ai-extract): structured documents tables and receipts [step-17d/T3]
- feat(ai-extract): side-by-side correction review [step-17d/T4]
- feat(ai-extract): reviewed safe document and spreadsheet exports [step-17d/T5]
- feat(ai-inline): cancellable opt-in ghost completions [step-17d/T6]
- test(ai-extract): bilingual accuracy and suggestion evaluations [step-17d/T7]
- docs(ai-extract): help and v0.5 review evidence [step-17d/T8]

## Required handoff

Return `handoff/step-17d/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-17d/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.

AI reminder: assistant text uses17a's selected Local/API gateway; Meta is the first API provider, Local the initial choice. No automatic cloud fallback. Keys stay native; file-derived payloads need exact one-use reviewed consent. Speech/image/embeddings remain local. Reading a file never authorizes uploading it. Do not call a real provider or download a model in this assignment.
