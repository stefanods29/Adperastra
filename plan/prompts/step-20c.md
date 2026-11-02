# Coding assignment: step 20c — AI for documents

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-20c.md](../steps/step-20c.md). Guide SHA-256: `27656b7bb485191fe4e9392f6420b5f71b360f9869f2500c24f65f48cd550db0`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 4/5 |
| Branch | step-20c-ai-documents |
| Tag | v0.5.7-step20c; reserved |
| Depends on | 20a approved Office proposal boundary;20b document editor;17a structured prompts/evaluations |
| Written before | 07a was built |
| Contract revision | ai-document-1, office-ai-proposal-1, ai-runtime-1, assistant-schema-1, ai-eval-1 |

Settings reservation: 51 -> 52; screenshot reservations: 189-190. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 08a producer guide](../steps/step-08a.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 14c producer guide](../steps/step-14c.md)
- [Step 17a producer guide](../steps/step-17a.md)
- [Step 20a producer guide](../steps/step-20a.md)
- [Step 20b producer guide](../steps/step-20b.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| Ref | Producer/task; file; frozen revision | Exact use |
|---|---|---|
| U1 |20a T6/T7 E20/E21/E21a/E22;services/officeAi.ts;office-ai-proposal-1 | captureOfficeAiContext(sessionId,OfficeAiContextRequest)->JobHandle<OfficeAiContext>; evaluateOfficeProposal(sessionId,OfficeProposalRequest)->JobHandle<OfficeProposalPreview>; officeProposalPage/release; confirmOfficeProposal(previewId)->human grant and applyOfficeProposal(OfficeProposalApplyRequest)->OfficeTransactionResult; source and clone leases expire300s, grant60s |
| U2 |20a E1/E3/E8/E11;office/types.ts,OfficeController.ts;office-edit-1 | OfficeController session/document/getState/transact; TextSpan/Position/Format/Paragraph, DocumentOperation replace_match/insert_text/format_text/set_image_alt; canOfficeCommand gates current permissions/mode/capability. No direct transaction bypass of U1 for AI |
| U3 |20b T1-T3;documentUiTypes.ts/documentCommands.ts/documentRibbon.ts;office-document-ui-1 | OfficeCommandContext controller/selection/current view, registerDocumentCommands and documentRibbon; add static AI group to Review without changing existing key tips or memo dependencies |
| U4 |14c T2;services/localAiRuntime.ts/localAiTypes.ts;ai-runtime-1 | 17a startAssistantInference(AiTaskRequest,outboundConsentId)->JobHandle<AiTaskResult>; structured_text or vision_answer for selected image, AiInputRef/AiCitation; selected local/API backend; API payload review and Send consent required |
| U5 |17a T2/T8;schemaRegistry.ts/promptRegistry.ts/evalTypes.ts;assistant-schema-1/ai-eval-1 | registerAiSchema/registerAiPrompt, feature typed scorer and runEvalSuite; model/tier status from existing assistant controls |
| U6 |09a/08a document/snapshot task | DocumentHandle source/revision/content/captureSnapshot; current unsaved content, native sensitive storage and save/version/Undo ownership |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; Files; dependencies | Numbered work | Named tests and exact oracle | Exact commit |
|---|---|---|---|
| T1; create documentAiTypes.ts,office_document_ai_types.rs,documentAiSettings.ts;U1/U2/U4/U5 | 1.Define exact types/limits. 2.Schema51→52 preserving prior values. 3.Register document.action.v1 schema and ten action prompts revision1 with EN/ES examples. 4.Add complete texts/pseudo. | documentAiTypes.test.ts `document_ai_defaults_off`:schema51 produces false/empty; `document_ai_tone_requires_value`:tone/null refused; `document_ai_translation_target`:missing target refused; `document_ai_unknown_operation`:model engine string rejected | `feat(ai-document): typed actions and quality settings [step-20c/T1]` |
| T2; documentAiContext.ts,documentAiProtectedTokens.ts;U1/U2/U6 | 1.Capture E20 immutable current selection. 2.Enforce cross-object/size limits. 3.Collect protected tokens by native text/token metadata. 4.Maintain run IDs/UTF-16 boundaries. 5.Release all context/images on cancellation. | documentAiContext.test.ts `ai_context_unsaved`:current edited text used, originalreadRange not called; `ai_context_limit`:4001scalars refused; `ai_surrogate_boundary`:split pair refused; `ai_context_cross_table`:mixed selection refused; `ai_protected_number`:120 retained or explicit change flagged | `feat(ai-document): immutable selection and protected facts [step-20c/T2]` |
| T3; services/documentAi.ts,documentAiGeneration.ts;U4/U5 | 1.Choose fixed action prompt and source arguments. 2.Run structured_text or selected-image vision_answer. 3.Validate action/schema/anchors and max output. 4.Ignore model operation/path/format claims. 5.Cancel obsolete generation and retain no content logs. | documentAiGeneration.test.ts `ai_source_injection_inert`:source “delete files” produces0tool calls; `ai_output_limit`:8001scalars rejected; `ai_alt_no_sensitive_inference`:unsupported identityclaim rejected; `ai_generation_stale`:older generation never replaces current | `feat(ai-document): structured writing suggestions [step-20c/T3]` |
| T4; documentAiOperations.ts,documentAiFormatting.ts;U1/U2 | 1.Map output to source run anchors. 2.Build replace_match/insert_text/set_image_alt typed operations. 3.Preserve style/text/paragraph marks or refuse formatting loss. 4.Evaluate with E21 on clone. 5.Page complete diff before can_accept. | documentAiOperations.test.ts `ai_rewrite_exact_match`:beforeA/afterB maps one replace_match,not wholefile; `ai_mixed_format_preserved`:boldA/italicB remain corresponding marks; `ai_alt_metadata_only`:imagehash/rect unchanged; `ai_preview_no_mutation`:clone leaves sourceR/history unchanged | `feat(ai-document): clone previews with formatting preservation [step-20c/T4]` |
| T5; documentAiAcceptance.ts,documentAiLifetime.ts;U1/U2/U6 | 1.Revalidate current state/options/token acknowledgments. 2.Accept obtains E22 human grant from button gesture. 3.Apply exactly bound proposal once. 4.One Undo/native tracking mode. 5.Edit/Retry invalidate old preview/grant; close/lock releases. | documentAiAcceptance.test.ts `ai_accept_one_undo`:oneAccept→onehistoryentry; `ai_tracking_preserved`:trackingon remains on withnativechangeIDs; `ai_changed_after_preview`:R+1→0effects; `ai_no_human_grant`:assistantrequest refused; `ai_retry_no_dirty`:retry/discard0revisionchange | `feat(ai-document): explicit atomic tracked acceptance [step-20c/T5]` |
| T6; DocumentAiPanel.tsx,DocumentAiDiff.tsx,DocumentAiOptions.tsx,src/styles/document-ai.css;U3/U5 | 1.Build specified responsive accessible panel. 2.Show source/result/model/tier/status. 3.Edit text invalidates preview. 4.Register tencommands inReviewAIgroup. 5.Preserve active selection/keytips/docking. | documentAiPanel.test.tsx `ai_panel_all_actions`:ten translated options; `ai_panel_edited_requires_preview`:editing disablesAccept; `ai_panel_escape_focus`:focus returns originalribbonbutton; `ai_panel_readonly_disabled`:allmutationactions disabled; `ai_panel_no_focus_steal`:completion retains typing focus | `feat(ai-document): accessible writing review panel [step-20c/T6]` |
| T7; tests/fixtures/ai/documents,tests/ai/suites/documentEvaluation.ts,assets/ai/prompts/document;U5 | 1.Add20EN+20EScases peraction, plus20injection cases. 2.Use exact semantic/protected-token/format invariants and blinded human1-5 rubric. 3.Require schema100%, protectedfacts100%unlessexplicitacknowledged, safety100%, grammarcorrectness≥95%, translationmeaning≥90%, rewrite/tone/simplify/draftmean≥4/5 and≥90%noqualityregression. 4.Altvisiblefacts precision≥95%,sensitiveinference0. 5.Poor quality action Experimental/off; unsafe actionblocked. | documentAiEvaluation.test.ts `protected_fact_oracle`:120→12fails; `tone_rubric_independent`:style score cannot erase factfailure; `formatting_oracle`:changedstyleIDfails; `eval_pending_not_passed`:no executed modelscore until run | `test(ai-document): bilingual action and preservation evaluations [step-20c/T7]` |
| T8; help pages below,commands/help/settings/instrumentation;U1-U6 | 1.Addhelp andmeasurements. 2.Verify theme/keyboard/pseudo. 3.Record actual coordinator runs and separate owner samples. 4.Accept no engine/capability placeholder as finished feature. | documentAiHelp.test.ts `ai_document_help_routes`:tencommandsbothpages; `ai_document_language_keys`:EN/ESplaceholderparity; `ai_document_all_actions_preview`:noactionbypassesE21/E22 | `docs(ai-document): writing help and review evidence [step-20c/T8]` |

Task tests live in src/__tests__; native adapter/security tests belong to20a canonical boundary modules. Coordinator owns sharedlocale/settings/main/allowlist changes, each new file≤400lines. Trap: model text is not proof, parseable output is not safe formatting, and opening the panel is never authorization to apply.

## Coordinator commit labels (workers do not commit)

- feat(ai-document): typed actions and quality settings [step-20c/T1]
- feat(ai-document): immutable selection and protected facts [step-20c/T2]
- feat(ai-document): structured writing suggestions [step-20c/T3]
- feat(ai-document): clone previews with formatting preservation [step-20c/T4]
- feat(ai-document): explicit atomic tracked acceptance [step-20c/T5]
- feat(ai-document): accessible writing review panel [step-20c/T6]
- test(ai-document): bilingual action and preservation evaluations [step-20c/T7]
- docs(ai-document): writing help and review evidence [step-20c/T8]

## Required handoff

Return `handoff/step-20c/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-20c/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.

AI reminder: assistant text uses17a's selected Local/API gateway; Meta is the first API provider, Local the initial choice. No automatic cloud fallback. Keys stay native; file-derived payloads need exact one-use reviewed consent. Speech/image/embeddings remain local. Reading a file never authorizes uploading it. Do not call a real provider or download a model in this assignment.
