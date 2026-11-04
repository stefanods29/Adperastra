# Coding assignment: step 17c — AI search and organizing

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-17c.md](../steps/step-17c.md). Guide SHA-256: `1fbc9f91fef035b78f4838f743bc99ec1c8ed56c08301349f4d2cd443f58fa5a`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 5/5 |
| Branch | step-17c-ai-search-organizing |
| Tag | v0.4.3-step17c; reserved, not created by guide authoring |
| Depends on | 17a/17b; 11a search; 11b tags; 09e rename; 09f approved moves; 12a storage/background |
| Written before | 07a was built |
| Contract revision | ai-search-1, consuming ai-runtime-1 and assistant-core-1/assistant-schema-1/ai-eval-1 |

Settings reservation: 45 -> 46; screenshot reservations: 170-172. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09e producer guide](../steps/step-09e.md)
- [Step 09f producer guide](../steps/step-09f.md)
- [Step 09k producer guide](../steps/step-09k.md)
- [Step 11a producer guide](../steps/step-11a.md)
- [Step 12a producer guide](../steps/step-12a.md)
- [Step 14c producer guide](../steps/step-14c.md)
- [Step 17a producer guide](../steps/step-17a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

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

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

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

## Coordinator commit labels (workers do not commit)

- feat(ai-search): typed contracts and independent consent [step-17c/T1]
- feat(ai-search): bounded revisioned semantic index [step-17c/T2]
- feat(ai-search): opted-in background embeddings and retrieval [step-17c/T3]
- feat(ai-search): reviewable natural-language filter previews [step-17c/T4]
- feat(ai-search): content-based names through safe rename preview [step-17c/T5]
- feat(ai-search): explicit destination suggestions and local choices [step-17c/T6]
- test(ai-search): bilingual relevance and organizing evaluations [step-17c/T7]
- docs(ai-search): help and review instrumentation [step-17c/T8]

## Required handoff

Return `handoff/step-17c/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-17c/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.

AI reminder: assistant text uses17a's selected Local/API gateway; Meta is the first API provider, Local the initial choice. No automatic cloud fallback. Keys stay native; file-derived payloads need exact one-use reviewed consent. Speech/image/embeddings remain local. Reading a file never authorizes uploading it. Do not call a real provider or download a model in this assignment.
