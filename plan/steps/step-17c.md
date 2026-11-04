# Step 17c: AI search and organizing

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 5/5 |
| Branch | step-17c-ai-search-organizing |
| Tag | v0.4.3-step17c; reserved, not created by guide authoring |
| Depends on | 17a/17b; 11a search; 11b tags; 09e rename; 09f approved moves; 12a storage/background |
| Written before | 07a was built |
| Contract revision | ai-search-1, consuming ai-runtime-1 and assistant-core-1/assistant-schema-1/ai-eval-1 |

This is a **guide** step: every decision is below, but no implementation code. Workers write owned code and tests only. The coordinator performs installation, builds, executed checks and integration. No result or model score in this guide claims execution.

## Goal

Find opted-in local photos and documents by meaning, review a natural-language query as editable filters, and review proposed names and destinations before ordinary safe file operations. Embeddings always stay local; reasoning follows the selected assistant backend and explicit API payload consent.

## Do not do in this step

Do not build another AI runtime, downloader or assistant (14c/17a), duplicate bulk rename or move machinery (09e/09f), index unlocked sensitive content persistently (09k), recognize people or infer sensitive traits, train a model, move or rename automatically, or follow a file's instructions. Scan reconstruction belongs to 17d. Office authoring belongs to 20c/21b/22b.

## Read first

Read rules R-SAFE/R-FS/R-BG/R-AI, ai.md, the complete 14c/17a/17b, 11a/11b, 09e/09f, 12a guides and their canonical export tables, add-settings-field/add-help-page recipes, speed.md, design-spec.md, and the v1 17c reference. Read current search UI, command registry, settings codec and jobs service. Earlier guide exports, rather than nonexistent future implementation files, are the baseline.

## Decisions (already made)

1. **D1. Independent opt-ins.** Settings schema 45 becomes 46. Semantic text, photo indexing, query interpretation, rename assistance and destination suggestions default off separately. Embeddings have their own roots; an 11a content opt-in does not imply AI permission. Root removal cancels work and removes only that root's membership/vectors; files remain unchanged.
2. **D2. One runtime.** Consume 14c's embed_text/embed_image tasks; structured reasoning goes through17a selected-backend gateway. Text uses its pinned multilingual-e5-small 384-dimensional model; photo and photo-query embeddings use its pinned SigLIP2 768-dimensional adapter. Never compare dimensions or vectors from different model revisions. A missing pack shows the 12a install action and never downloads on search.
3. **D3. Bounded exact vector search.** Add no vector library. Store finite little-endian f32 vectors in the existing native search SQLite database, semantic schema 1. Exact dot products over L2-normalized vectors run on one low-priority Rust worker, checking cancellation every 256 rows. At most 50,000 text chunks and 25,000 images, 512 MiB embedding storage, and 64 MiB working memory beyond the shared model runtime. Return the best 100 results, deterministic ties by FileIdentityKey, then chunk ordinal. Do not claim million-file nearest-neighbor performance.
4. **D4. Background privacy.** Only explicit roots, maximum 32, are traversed through the 11a identity/watcher policy. No reparse traversal, cloud hydration, network root, archive entry or sensitive virtual source. Check online-only before every open. Battery/foreground pressure/pause policy is 07a/12a's, not a competing scheduler. One embedding task at a time; persist completion per item and resume after crash. Stamps, model revision and extraction revision form cache identity.
5. **D5. Text units.** Reuse 11a bounded extraction after AI-specific consent. Normalize line endings only, split into at most 64 chunks/file, each 384 Unicode scalars with 64-scalar overlap, never splitting surrogate pairs. Empty text has no vector. A file beyond 24,000 scalars is marked partial; exact original offsets remain available. Images use the runtime's oriented 224-pixel preprocessing, no OCR unless separately opted in.
6. **D6. Query preview.** Natural language returns a typed SearchQuery using only 11a SearchFilter variants; there is no separate QueryAST or FilterAST type. Interpret relative dates against captured UTC time and an explicit timezone. Display every root, field, operator, resolved date and sort before Search becomes enabled. Unsupported/ambiguous requests show clarification text and no executable query. The model never supplies SQL, regex, shell text or paths.
7. **D7. Suggestions only.** Names use 09e's native preview. Add an explicit_names RenameOperation, defined below, to the canonical 09e producer first. It changes no extension by default. Destinations are chosen only from up to 32 explicitly approved real folders. Move uses the normal 09f fresh conflict preview; the AI result is never a mutation grant.
8. **D8. Local choice history.** Destination ranking first uses counts of user-confirmed move receipts, grouped by extension and destination ID. Laplace score is (count + 1)/(all matching counts + destination count). Show only after at least 3 examples and score at least 0.6; tie by destination ID. AI can reorder eligible destinations using bounded content but cannot create one. Never records filenames, content, source URL or sensitive moves. Never for this kind disables that extension for this profile; reset is explicit and undoable app state.
9. **D9. Explicit sensitive one-shot.** A selected unlocked source may be compared only after the dedicated consent dialog, entirely in memory, without roots/history/log/cache writes. Candidate results still come only from ordinary opted-in indexed roots. Closing or locking destroys input/vector and cancels its job. Lack of memory-only runtime capability refuses the action.
10. **D10. Quality gates.** The feature evaluations below are new 17a harness suites. Model quality is measured, not implied by schema validity. A failing action stays Experimental and off by default; safety failures block it entirely. No telemetry or automatic learning beyond D8 counters.

## Data shapes

### Selected backend and outbound consent

17a E7, `src/services/assistantInference.ts`, revision assistant-provider-1 owns all query/name/content-ranking inference: prepareAssistantInference(request:AiTaskRequest)->Promise<AssistantOutboundPreview>; confirmAssistantOutbound(previewId:string)->Promise<{consent_id:string}> from explicit foreground Send; startAssistantInference(request,outboundConsentId:string|null)->Promise<JobHandle<AiTaskResult>>. AssistantOutboundPreview and AssistantProviderId are imported from17a canonical types, not copied. Local requires null consent and sends nothing; API requires exact payload/hash/provider/model/source-revision-bound one-shot consent, never inferred from enabling the feature. Natural queries disclose query text plus selected root labels/filter vocabulary, not file contents or the whole index. Name/content-sort actions disclose only their selected bounded excerpts/images. Sensitive one-shot comparison remains local; API sensitive/unlocked input is refused. Embeddings/vector traversal never uses API, and history-only destination ranking needs no model/network.

To make that review concrete, add `prepareAiSearchInference(request:AiSearchInferenceRequest)->Promise<AiSearchPreparedRequest>` in services/aiSearch.ts. AiSearchInferenceRequest is tagged query{request:NaturalQueryRequest}, names{inputs:AiInputRef[],pattern:AiNamingPattern}, or destination{input:AiInputRef}; AiSearchPreparedRequest has id UUID, request, outbound_preview AssistantOutboundPreview and expires_unix now+300. Extend previewNaturalQuery/suggestNames/suggestDestination below with final `preparedId:string,outboundConsentId:string|null` parameters; local also prepares but does not show a Send dialog. Native preparation binds actual source excerpts and request; changed payload/revision/provider/model requires a new preview. Search confirmation/rename/move remain separate from outbound Send. T4/T5/T6 implement this gateway; add tests `ai_search_api_payload_gate` (prepare0network; consented Send1), `ai_search_api_changed_source` (old consent rejected), `ai_embeddings_never_api` (API selected still0remote embedding requests), `ai_sensitive_api_refused` (0network), and `ai_search_no_fallback` (local error0API requests). Use17a outbound labels/dialog/error translations; help pages append “API reasoning sends only the displayed content after a separate one-time Send confirmation.” / “El razonamiento por API envía solo el contenido mostrado tras una confirmación de envío separada y de una sola vez.” The photo/meaning embedding help retains its truthful local-only statement.

Canonical wire files: `src/services/aiSearchTypes.ts` and `src-tauri/src/ai_search_types.rs`. Rust safe u64 mirrors TypeScript number with checked safe-integer range; UUID is a canonical string. Unknown fields/variants, nonfinite floats and oversized payloads fail before work. JSON responses stop at 768 KiB.

| Type | Exact fields, defaults and validation |
|---|---|
| AiSearchSettings | semantic_text/photo_index/natural_query/rename/sort booleans false; roots AiSemanticRoot[] empty, max32; destinations AiDestination[] empty,max32; disabled_sort_extensions string[] max100, canonical lowercase without dot; no content or tokens |
| AiSemanticRoot | root_id UUID referring to enabled 11a root; text bool false; photos bool false; at least one true; no copied path |
| AiDestination | id UUID; path absolute checked ordinary local directory; name string1-60; no source grants serialized |
| SemanticVectorRecord | native only: identity FileIdentityKey; source SourceStamp; root_ids UUID[]; model_id/model_revision; extractor_revision u32; kind text/image; chunk_index u16; start/end Unicode-scalar offsets for text; dimensions384/768; vector bytes exactly dimensions*4; partial bool |
| SemanticQuery | kind text/photo/similar_text/similar_image; text string1-1024 scalars for text/photo only; input nullable AiInputRef for similar only; root_ids UUID[]1-32; limit u16 1-100 default50; request_revision u32; sensitive_consent_id nullableUUID |
| SemanticHit | item SearchResult imported11a; score finite -1..1; chunk_index u16; source_revision safeu64; model_id/model_revision; snippet nullable string<=256; partial bool |
| SemanticPage | hits SemanticHit[]<=100; request_revision u32; index_generation safeu64; scanned/eligible/skipped u32; complete bool; coverage pending/partial/complete; no fake exact total |
| NaturalQueryRequest | text1-1024; root_ids UUID[]1-32; now_unix safeu64; timezone IANA string<=64; locale en/es; request_revision u32 |
| NaturalQueryPreview | id UUID; request_revision u32; status ready/clarify; query nullable SearchQuery; explanation string<=1024 plain text; unsupported string[]<=16; captured_now_unix; expires_unix now+300. Ready requires query nonnull and unsupported empty |
| AiNameSuggestion | source AiInputRef; source_stamp SourceStamp; proposed_stem string1-180; reason string<=512; confidence finite0..1; citations AiCitation[]<=8; no directory or extension field |
| AiNamingPattern | pattern string<=256; tokens exactly date/topic/company/type/month; locale en/es; date YYYY-MM-DD UTC; month YYYY-MM; unknown or unavailable token makes row unresolved, never empty substitution |
| AiSortSuggestion | id UUID; identity FileIdentityKey; source_stamp; destination_id UUID; score0..1; basis history/content; reason<=512; extension canonical<=32; expires_unix now+300 |
| SortHistory | schema_version1; revision safeu64; counts {extension,destination_id,count u32 capped100000}[]<=3200; disabled extensions<=100; atomic app state <=256KiB |

The additive canonical 09e RenameOperation variant is `explicit_names` with names array of {input_index u32,new_name string1-255}, at most 1000, exactly one row per included source; cannot coexist with another operation. Normal native Windows validation, collision/stamp preview and expiry still apply. All rename consumers import that type from09e; do not create AiRenamePlan.

| IPC; service export | Exact arguments and result |
|---|---|
| ai_semantic_search_start; searchSemantic | request_id JobRequestId ASCII1-64, query SemanticQuery -> shared JobHandle<SemanticPage>; TypeScript (query)->Promise<JobHandle<SemanticPage>> |
| ai_semantic_status; semanticStatus | ()->Promise<{generation:number,text_chunks:number,images:number,bytes:number,pending:number,skipped:number,paused:boolean,reason_code:string|null}> |
| ai_semantic_rebuild_start; rebuildSemantic | root_ids readonlyUUID[]->Promise<JobHandle<same status>>; no hidden opt-in |
| ai_query_preview_start; previewNaturalQuery | request NaturalQueryRequest->Promise<JobHandle<NaturalQueryPreview>> |
| ai_names_suggest_start; suggestNames | inputs readonlyAiInputRef[]1-100,pattern AiNamingPattern->Promise<JobHandle<AiNameSuggestion[]>> |
| ai_sort_suggest_start; suggestDestination | input AiInputRef->Promise<JobHandle<AiSortSuggestion|null>> |
| ai_sort_history_reset; resetSortHistory | expected_revision number->Promise<SortHistory>; app-state history transaction |

Every native entry validates ensure_main, native source grants, revisions, opt-ins and all limits. Errors `ai_search.invalid/unavailable/changed/too_large/denied/online_only/sensitive/ambiguous/failed` map only to translated text. Cancel is the shared JobHandle cancel. No file-operation IPC is added.

## Uses from other steps

| Ref | Producer task; canonical file; revision | Exact consumption and ownership |
|---|---|---|
| U1 |14c T2; services/localAiTypes.ts/localAiRuntime.ts;ai-runtime-1 | AiInputRef, AiTaskRequest/Result, AiCitation; startAiTask(request)->Promise<JobHandle<AiTaskResult>>. Use embed_text/embed_image only; structured reasoning uses17a E7 gateway; hold input/model leases until completion, release output artifacts idempotently |
| U2 |17a schema/evaluation tasks; assistant-core-1/assistant-schema-1/ai-eval-1 | App-owned schema/prompt registry and evaluation harness. Register only the IDs in T1/T7; no caller grammar or parallel inference engine |
| U3 |11a T1-T4;services/search.ts,crates/search-index/src/types.rs;search-index-1 | SearchQuery/SearchFilter/SearchResult/SearchPage, FileIdentityKey and bounded ContentExtractorRegistry; search(query)->Promise<JobHandle<SearchPage>> after explicit preview confirmation |
| U4 |09e T1/T3;services/bulkRename.ts;bulk-rename-1 plus explicit_names revision | previewRename(RenameRequest)->Promise<JobHandle<RenamePlanPage>>, executeRename(planId,requestRevision)->Promise<JobHandle<RenameReport>>. Exact native plan expiry/stamps; no source write by AI |
| U5 |09f T1-T3/E1-E2; src/services/transferJobs.ts; transfer-jobs-1 | startTransfer(request:TransferRequest,onProgress?)->Promise<JobHandle<TransferReport>>; TransferRequest kind move,sources string[],dest_dir string,conflict skip/keepBoth/merge,verify bool,allow_system false,priority normal/foreground, expected_sources optional SourceStamp[] exactly aligned with sources (required here). TransferCoordinator compares the held mutation source guards after any queue wait, failing changed before effects. Resolve captured approved source/destination natively again; ConflictDialog decisions use decideTransfer(jobId,TransferDecision)->Promise<TransferState>, no AI permission to replace |
| U6 |07a/12a background and storage tasks | Shared BackgroundPolicy and App storage usage provider; report actual SQLite/WAL bytes, hold one job slot, pause/resume by shared policy |
| U7 |09k sensitive-provider contract;09a DocumentHandle | AiInputRef native authorization from live selected document; one-shot memory grant destroyed on lock/release; no persistent source path |

Move uses startTransfer only after the explicit Move click and current native identity checks. The existing transfer window owns any subsequent conflict decisions.

## Exports for later steps

| ID | Producer; canonical file | Exact export |
|---|---|---|
| E1 |17c T1;services/aiSearchTypes.ts;ai-search-1 | All data shapes above; immutable source/revision binding and bounded pagination |
| E2 |17c T2/T3;services/aiSearch.ts | searchSemantic/semanticStatus/rebuildSemantic exact signatures above; no raw vector exposure to UI |
| E3 |17c T4;search/ai/naturalQuery.ts | confirmNaturalQuery(preview:NaturalQueryPreview,edited:SearchQuery)->Promise<JobHandle<SearchPage>>; validates edited typed query and current roots before11a search, requires explicit click/Enter |
| E4 |17c T5;rename/aiNameAdapter.ts | previewSuggestedNames(inputs:readonlyAiNameSuggestion[],editedStems:readonlystring[],requestRevision:number)->Promise<JobHandle<RenamePlanPage>>; revalidates stamps, preserves original extension, delegates09e |
| E5 |17c T6;organize/SortSuggestionChip.tsx | props suggestion AiSortSuggestion,onMove()->Promise<void>,onNotNow()->void,onNever()->Promise<void>,onOpenHelp(slug)->void; no implicit on-mount effect |

## UI, commands and complete texts

Search adds Meaning/Photos by content/Similar/Natural language after existing four modes. Prefixes ask:/photo:/similar: now select corresponding eligible mode; similar: requires a selected source and never treats text as a path. Ctrl+Tab cycles only available modes while searchbox focused. Search settings show independent opt-ins, indexed roots, coverage and actual storage. Semantic result items reuse normal Explorer views/open behavior; similarity is labeled relevance and never a probability.

| Selector/component | Structure, size and states |
|---|---|
| `.ai-search-panel` / AiSearchPanel | region with translated heading, 360px wide,max viewport minus32; padding16,gap12; --adp-color-surface/border/text and radius-md. At width<720 becomes full-width section. aria-busy only during current generation |
| `.ai-query-preview` / NaturalQueryPreviewPanel | dialog760px,max viewport minus32; heading, explanation, existing FilterBuilder chips, root list, resolved dates, Search/Cancel. Chip row wraps,gap8; no horizontal clipping at200%. Initial focus first chip, Esc cancels and restores searchbox |
| `.ai-name-review` / AiNameReview | existing bulk-rename dialog extension; old/proposed/editable stem/reason columns,min row40; fixed extension shown separately; rejected rows excluded. Native conflict statuses remain visible |
| `.ai-sort-chip` | inline group,min height32,gap8; destination text plus Move/Not now/Never for this kind buttons. No timer, no focus stealing, no appearance for sensitive/cloud items |

Loading skeleton by100ms, progress words at1s, cancel for pending jobs, failure retry only explicit. Empty roots opens settings explanation. Changed source disables Apply and retains editable proposal for copying; never silently reruns. All controls native buttons/inputs; status aria-live polite, errors role alert, one announcement per generation. Escape dismisses preview before editor keys; Enter Search only within a ready query dialog. Icons Search/Sparkles/Pencil/FolderInput use existing verified inventory; command registry controls icon verification, no new asset dependency.

Command IDs `search.semantic`, `search.photos`, `search.similar`, `search.natural`, `file.suggestName`, `folder.sortSuggestions`; labels are corresponding keys below; no global shortcuts; risks readonly until explicit ordinary rename/move command. Help slugs below.

| Key | English | Spanish |
|---|---|---|
| aiSearch.title | AI search and organizing | Búsqueda y organización con IA |
| aiSearch.meaning | Meaning | Significado |
| aiSearch.photos | Photos by content | Fotos por contenido |
| aiSearch.similar | Similar files | Archivos similares |
| aiSearch.natural | Natural language | Lenguaje natural |
| aiSearch.suggestName | Suggest a name | Sugerir un nombre |
| aiSearch.sort | Sort suggestions | Sugerencias de organización |
| aiSearch.textOptIn | Index text by meaning in these folders | Indexar texto por significado en estas carpetas |
| aiSearch.photoOptIn | Index photo content in these folders | Indexar el contenido de fotos en estas carpetas |
| aiSearch.preview | Review what the search understood | Revisa lo que entendió la búsqueda |
| aiSearch.search | Search | Buscar |
| aiSearch.cancel | Cancel | Cancelar |
| aiSearch.retry | Retry | Reintentar |
| aiSearch.empty | Choose folders before using this search. | Elige carpetas antes de usar esta búsqueda. |
| aiSearch.partial | Some files are not indexed. Results may be incomplete. | Algunos archivos no están indexados. Los resultados pueden estar incompletos. |
| aiSearch.progress | Preparing local suggestions… | Preparando sugerencias locales… |
| aiSearch.coverage | {done} indexed; {skipped} skipped | {done} indexados; {skipped} omitidos |
| aiSearch.relevance | Relevance | Relevancia |
| aiSearch.move | Move | Mover |
| aiSearch.notNow | Not now | Ahora no |
| aiSearch.never | Never for this kind | Nunca para este tipo |
| aiSearch.suggested | Suggested: {folder} | Sugerencia: {folder} |
| aiSearch.pattern | Naming pattern | Patrón de nombres |
| aiSearch.oldName | Current name | Nombre actual |
| aiSearch.newName | Proposed name | Nombre propuesto |
| aiSearch.reason | Reason | Motivo |
| aiSearch.reset | Reset destination history | Restablecer historial de destinos |
| aiSearch.sensitiveConsent | Compare this unlocked file once in memory? It will not be indexed. | ¿Comparar este archivo desbloqueado una vez en memoria? No se indexará. |
| errors.ai_search.invalid | This search request is not valid. | Esta solicitud de búsqueda no es válida. |
| errors.ai_search.unavailable | Enable this feature and its local pack first. | Activa primero esta función y su paquete local. |
| errors.ai_search.changed | The source changed. Review a new suggestion. | El origen cambió. Revisa una sugerencia nueva. |
| errors.ai_search.too_large | This request exceeds the AI search limits. | Esta solicitud supera los límites de búsqueda con IA. |
| errors.ai_search.denied | This folder is not approved for this action. | Esta carpeta no está aprobada para esta acción. |
| errors.ai_search.online_only | Download this file explicitly before using its content. | Descarga este archivo de forma explícita antes de usar su contenido. |
| errors.ai_search.sensitive | This source cannot be processed safely in memory. | Este origen no se puede procesar de forma segura en memoria. |
| errors.ai_search.ambiguous | Clarify the request before searching. | Aclara la solicitud antes de buscar. |
| errors.ai_search.failed | The local suggestion could not be prepared. | No se pudo preparar la sugerencia local. |

## Tasks

All UI tests below are in `src/__tests__/`; native tests are colocated in named new native modules. Every task has the listed tests written, never claimed run by workers. Coordinator owns locale merges, pseudo generation, settings schema, IPC registration/allowlist, help catalog and shared search UI edits. New files stay below400 lines.

### T1 — contracts and consent

**Files:** create aiSearchTypes.ts, ai_search_types.rs, `src/search/ai/aiSearchSettings.ts`; amend canonical09e explicit_names type and its validators through coordinator. Uses U1/U3/U4/U6.

**Do this:** 1. Add exact shapes/limits and schema45→46 defaults preserving unknown settings. 2. Register schema IDs `search.query.v1`, `search.names.v1`, `search.destination.v1` with17a registry and prompt IDs of same names revision1. 3. Define native settings validation and independent consent. 4. Add all locale keys above in same task; regenerate pseudo through coordinator.

**Tests:** aiSearchTypes.test.ts `ai_search_defaults_are_off`: schema45 upgrade gives all five false/empty roots; `ai_query_uses_search_filter`: unknown SQL field refused; `explicit_names_requires_unique_indices`: repeated index0 rejected; `sensitive_root_refused`: sensitive virtual root adds0 rows.

**Traps:** an existing content root is not AI consent; explicit_names cannot skip native rename validation. **Commit:** `feat(ai-search): typed contracts and independent consent [step-17c/T1]`.

### T2 — bounded semantic storage

**Files:** create `src-tauri/src/ai_semantic_store.rs`, ai_semantic_vectors.rs, ai_semantic_history.rs. Uses U1/U3/U6.

**Do this:** 1. Extend native index with semantic metadata/vector/root-membership tables, transactional migration. 2. Enforce exact model/dimension/stamp identity and quotas before insert. 3. On invalid vector or model revision change, invalidate that vector only and queue recomputation. 4. Root removal atomically removes unreferenced vectors, never files. 5. Register actual DB/WAL usage with12a.

**Tests:** ai_semantic_store native `semantic_vector_dimensions`:383 f32s for384 rejected; `semantic_nonfinite_rejected`:NaN/Infinity rejected; `semantic_root_membership`:removeA from[A,B] retainsB; `semantic_quota_pauses`:25,001st image refused with valid25,000 retained; `semantic_model_revision_isolation`:same file/different revision never mixed. **Traps:** do not log text or use similarity score as confidence. **Commit:** `feat(ai-search): bounded revisioned semantic index [step-17c/T2]`.

### T3 — indexing and semantic retrieval

**Files:** create ai_semantic_jobs.rs, ai_semantic_search.rs, `src/services/aiSearch.ts`, `src/search/ai/semanticAdapter.ts`. Uses U1/U3/U6/U7.

**Do this:** 1. Apply eligibility and background policy before every source lease. 2. Extract/split text and embed through shared runtime; bind results to captured stamps. 3. Resume by persisted completed identity, not ordinal in a changing folder. 4. Embed query with matching task/model and scan bounded vectors. 5. Deduplicate per file by maximum score; stable sort/tie rule D3. 6. Cancel superseded jobs and discard stale request_revision. 7. Implement explicit sensitive one-shot with zero disk/history writes.

**Tests:** aiSemanticSearch.test.ts `semantic_dot_product_order`:query[1,0],A[1,0],B[0,1] givesA1 thenB0; `semantic_chunks_overlap`:448 scalars gives chunks0..384 and320..448; `semantic_cloud_skip`:online-only source0opens; `semantic_cancel_stale`:R1 completion afterR2 not displayed; `semantic_sensitive_lock`:lock destroys lease and returns no results. **Commit:** `feat(ai-search): opted-in background embeddings and retrieval [step-17c/T3]`.

### T4 — natural language as editable filters

**Files:** create ai_query_preview.rs, `src/search/ai/naturalQuery.ts`, NaturalQueryPreviewPanel.tsx, AiSearchPanel.tsx, `src/styles/ai-search.css`; modify search modes via coordinator. Uses U1/U2/U3.

**Do this:** 1. Send bounded query/root-ID vocabulary as user data to fixed schema. 2. Reject unknown fields/operators and unsupported concepts. 3. Resolve units with MiB explicitly; date intervals half-open internally and convert to producer inclusive bounds once. 4. Show complete typed chips and roots. 5. On confirmation validate edited query again and call11a search. 6. Preserve ordinary saved-query contract; save interpreted SearchQuery only, never raw AI execution plan.

**Tests:** aiNaturalQuery.test.ts `natural_query_preview_precedes_search`:model completion makes0search calls,button1; `natural_query_last_month`:captured2026-11-02UTC,October resolves from1790812800 through1793491199; `natural_query_five_mib`:bigger than5MiB maps gte5242881; `natural_query_unsupported`:“email these files” yields clarify/null; `natural_query_roots_tamper`:unknownrootrefused. **Commit:** `feat(ai-search): reviewable natural-language filter previews [step-17c/T4]`.

### T5 — safe name suggestions

**Files:** create ai_name_suggestions.rs, `src/rename/aiNameAdapter.ts`, AiNameReview.tsx. Uses U1/U2/U4.

**Do this:** 1. Read at most100selected sources after explicit action, no background content reads. 2. Produce stem-only structured suggestions and source citations. 3. Normalize invalid characters to underscore visibly, trim trailing spaces/dots, reject empty/reserved stems. 4. Let each row edit/accept/exclude. 5. Build canonical explicit_names request with original extensions and fresh native preview. 6. Only existing Execute button executes current native plan.

**Tests:** aiNames.test.ts `ai_name_preserves_extension`:scan001.PDF +Invoice givesInvoice.PDF; `ai_name_reserved`:CON invalid; `ai_name_separator`:a/b proposesa_b visibly; `ai_name_preview_not_execute`:acceptsuggestion0execute calls; `ai_name_stale_stamp`:changedsourcefailsbeforepreview. **Commit:** `feat(ai-search): content-based names through safe rename preview [step-17c/T5]`.

### T6 — destination suggestions

**Files:** create ai_sort_suggestions.rs, ai_sort_history.rs, `src/organize/SortSuggestionChip.tsx`, sortSuggestionAdapter.ts. Uses U1/U5/U6.

**Do this:** 1. Update bounded counts only after successful explicit ordinary move receipts. 2. Compute D8score and optional content ranking among approved destinations. 3. Display chip without focus/timer mutation. 4. Move reruns ordinary fresh preview. 5. Not now dismisses identity for this session; Never records extension opt-out; Reset uses app-state history. 6. Do not learn from assistant output, failed moves or sensitive sources.

**Tests:** aiSort.test.ts `sort_history_score`:countsA4/B0 gives5/6,Ashown; `sort_history_minimum`:2receiptsnone; `sort_destination_deleted`:removeddestinationcannotmove; `sort_never_kind`:pdfoptoutleavesjpgeligible; `sort_no_automatic_move`:mount/watch completion0mutations. **Commit:** `feat(ai-search): explicit destination suggestions and local choices [step-17c/T6]`.

### T7 — feature evaluation

**Files:** create `tests/fixtures/ai/search/{queries,rename,sorting,relevance}.jsonl`, `tests/ai/suites/aiSearchEvaluation.ts`, versioned prompt examples under `assets/ai/prompts/search/`; register through17a harness. Uses U2.

**Do this:** 1. Add40EN+40ES query cases,30+30rename,30+30sort and50photo/text relevance queries per language over200rights-cleared synthetic/local assets. 2. Include accents, relative dates, unsupported terms, prompt injection, irrelevant photos and misspelled names. 3. Exact AST equivalence after normalization ≥95%; unsafe query/root mutation0. 4. Rename ≥95%validstems and ≥85%human relevance, extension changes0. 5. Sort precision@1≥90%among eligible≥3examplecases, automaticmoves0. 6. Text/photo nDCG@10≥0.80eachlanguage; Spanish drop≤0.05; show partial indexing honestly. 7. Save actual model/artifact/prompt/corpus hashes, latency and scores only when coordinator runs. Safety fails block action; quality fail Experimental/off.

**Tests:** aiSearchEvaluation.test.ts `relevance_hand_oracle`:one relevant item rank1nDCG1,rank2 1/log2(3); `query_ast_scoring_order`:allclauseorderirrelevant,operatorchangefails; `sort_unsafe_zero_tolerance`:onemutation fails suite. **Commit:** `test(ai-search): bilingual relevance and organizing evaluations [step-17c/T7]`.

### T8 — help, measurements and integration

**Files:** bilingual help below, help catalog, command registrations, settings section, scripts/measure-ui.mjs, screenshot runner. Uses U3-U7.

**Do this:** 1. Wire exact commands and complete help. 2. Add measurements/shots below. 3. Verify keyboard/localization, empty/error/partial states and model/tier indicator from17a. 4. Record coordinator-only runs separately from worker-written tests. **Tests:** aiSearchUi.test.tsx `ai_query_keyboard_confirm`:Esc0search,Enterready1; `ai_modes_respect_opt_in`:offshowsdisabledreason; `ai_sort_chip_no_focus_steal`:activeinputretainsfocus; `ai_search_pseudo_bounds`:wrappedchipsnohorizontaloverflow. **Commit:** `docs(ai-search): help and review instrumentation [step-17c/T8]`.

## Help pages

Each page has title, Intro, How to use, Good to know, and See also in the standard recipe. Exact bodies below are complete; split sentences in that order, without adding promises.

| Slug; title EN / ES | English | Spanish |
|---|---|---|
| searching-photos-by-content; Searching photos by content / Buscar fotos por contenido | Find local photos by describing their contents. Enable Photos by content and select indexed folders in Settings > AI. Choose Photos by content in Search, type a description and search. Results show relevance and indexing coverage. Online-only and sensitive files are excluded. No file is uploaded. See also: Similar files; Indexing and privacy. | Encuentra fotos locales describiendo su contenido. Activa Fotos por contenido y elige carpetas indexadas en Configuración > IA. Elige Fotos por contenido en Buscar, escribe una descripción y busca. Los resultados muestran relevancia y cobertura de indexación. Se excluyen archivos solo en línea y sensibles. No se suben archivos. Consulta también: Archivos similares; Indexación y privacidad. |
| similar-files; Similar files / Archivos similares | Find indexed files with related content. Select one photo or document, choose Similar files and review the results. Photos compare image content; documents compare opted-in extracted text. Similarity does not prove duplicate identity. An unlocked source requires separate one-time memory consent and is never indexed. See also: Searching photos by content; Duplicate finder. | Encuentra archivos indexados con contenido relacionado. Selecciona una foto o documento, elige Archivos similares y revisa los resultados. Las fotos comparan contenido visual; los documentos comparan texto extraído con permiso. La similitud no demuestra que sean duplicados. Un origen desbloqueado requiere permiso separado para una sola comparación en memoria y nunca se indexa. Consulta también: Buscar fotos por contenido; Buscar duplicados. |
| natural-language-search; Natural-language search / Buscar en lenguaje natural | Describe the file properties you want. Choose Natural language, enter a request and review every filter chip, folder and resolved date. Edit the chips, then choose Search. Ambiguous or unsupported requests require clarification. Nothing runs before confirmation. See also: Search filters; Indexing and privacy. | Describe las propiedades de los archivos que buscas. Elige Lenguaje natural, escribe la solicitud y revisa cada filtro, carpeta y fecha resuelta. Edita los filtros y elige Buscar. Las solicitudes ambiguas o no compatibles requieren aclaración. Nada se ejecuta antes de confirmar. Consulta también: Filtros de búsqueda; Indexación y privacidad. |
| rename-suggestions; Rename suggestions / Sugerencias de nombres | Suggest clearer names from selected file content. Choose Suggest a name, review the pattern and edit or exclude each proposed stem. Review the ordinary bulk-rename preview before executing. Extensions and source files remain unchanged until that explicit action. Content may be misunderstood. See also: Bulk rename; AI quality tiers. | Sugiere nombres más claros a partir de archivos seleccionados. Elige Sugerir un nombre, revisa el patrón y edita o excluye cada nombre propuesto. Revisa la vista previa normal de renombrado masivo antes de ejecutar. Las extensiones y los archivos no cambian hasta esa acción explícita. El contenido puede interpretarse mal. Consulta también: Renombrado masivo; Niveles de calidad de IA. |
| sort-suggestions; Sort suggestions / Sugerencias de organización | Review destinations without automatic moves. Choose approved destination folders in Settings > AI. A suggestion can offer Move, Not now or Never for this kind. Move opens the normal file-operation preview. Only confirmed ordinary moves contribute local extension counts; sensitive moves are excluded. Reset destination history in Settings. See also: Moving files; AI privacy. | Revisa destinos sin movimientos automáticos. Elige carpetas de destino aprobadas en Configuración > IA. Una sugerencia ofrece Mover, Ahora no o Nunca para este tipo. Mover abre la vista previa normal de operaciones. Solo los movimientos normales confirmados aportan recuentos locales por extensión; se excluyen los sensibles. Restablece el historial en Configuración. Consulta también: Mover archivos; Privacidad de IA. |

Update search-modes help: “Optional AI modes become available only after their separate opt-ins and local packs are ready.” / “Los modos opcionales de IA solo están disponibles tras activar cada permiso y preparar sus paquetes locales.”

## Check by hand

| Retained fixture | Exact content |
|---|---|
| review-root/17c/text/invoice.txt | Vendor: María. Invoice date: 2026-10-15. Total: 120 PEN. |
| review-root/17c/text/notes.txt | A dog plays on the beach. A whiteboard contains engineering diagrams. |
| review-root/17c/photos | Four rights-cleared synthetic images: dog/beach, cat/room, whiteboard/diagrams, empty blue field; recorded hashes and relevance labels |
| review-root/17c/roots | Two ordinary roots sharing one indexed file identity via approved membership fixture; online-only and denied-access mock entries; no actual personal files |
| review-root/17c/names | scan001.pdf and IMG_2034.jpg with captured stamps; existing destination Invoice.pdf for collision review |

1. Enable only photo indexing; prove text stays unindexed. Pause, resume, remove root and inspect actual App storage bytes without losing files.
2. Query EN/ES descriptions; compare Similar, partial coverage and irrelevant results. Never hydrate an online-only fixture.
3. Ask for María's October PDFs; inspect roots/date/unit chips, edit one and confirm. Cancel produces no search.
4. Edit proposed stems, inspect collisions, execute through09e and Undo. A changed source must require a fresh preview.
5. Verify sort chips do not move anything, Never opt-out and reset, normal conflict preview and Undo.
6. In Spanish dark, pseudo, keyboard and200%zoom inspect focus, wrapping, loading/error/empty states and sensitive-memory lock cancellation.

## Speed and screenshots

Add `step17c.query.preview.open` Instant0.1s excluding inference, `step17c.semantic.first100` Fast1s over25,000images/50,000chunks warm, `step17c.sort.chip` Instant0.1s, and typing/Explorer regression measurements. Inference/indexing remains cancellable background work, never counted as a click completing instantly. Save actual JSON under docs/benchmarks/ with model/hardware/corpus hashes.

Screenshots170-ai-search-results,171-ai-query-filter-preview,172-ai-name-sort-suggestions under docs/screenshots/step-17c/, each en/light, es/dark, pseudo/light. Use synthetic fixture content only.

## Done when

- All opted-in search modes, editable query chips, native rename previews and explicit destination choices work without automatic mutation.
- Producer contracts, settings46, translations/help, security/cancellation, sensitive-memory policy and storage quotas are integrated.
- Coordinator records actual gate/package, evaluation, speed, visual/accessibility and privacy evidence; no unrun result is labeled passed.
- Weak quality actions remain Experimental/off and every unsafe action is blocked. All dependency symbols match the frozen producer guides.
