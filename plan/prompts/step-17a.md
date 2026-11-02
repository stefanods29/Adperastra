# Coding assignment: step 17a — AI assistant: core, safety, models, evaluation

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-17a.md](../steps/step-17a.md). Guide SHA-256: `034504de270fd20c04c5e08c0860cfec47bacbb422ae6eb0a86f36c382c5a374`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 5/5 |
| Branch | step-17a-assistant |
| Tag | v0.4.1-step17a |
| Depends on | 14c ai-runtime-1;09a/b/c tabs/documents;09f operation capability;11a/b search/tags;12a packs;16 integration |
| Written before | 07a was built |
| Interface revision | assistant-core-1;assistant-schema-1;assistant-provider-1;ai-eval-1 |

Settings reservation: 43 -> 44; screenshot reservations: 163-166. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07d producer guide](../steps/step-07d.md)
- [Step 07e producer guide](../steps/step-07e.md)
- [Step 08a producer guide](../steps/step-08a.md)
- [Step 08c producer guide](../steps/step-08c.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09b producer guide](../steps/step-09b.md)
- [Step 09e producer guide](../steps/step-09e.md)
- [Step 09f producer guide](../steps/step-09f.md)
- [Step 10b producer guide](../steps/step-10b.md)
- [Step 10c producer guide](../steps/step-10c.md)
- [Step 10e producer guide](../steps/step-10e.md)
- [Step 11a producer guide](../steps/step-11a.md)
- [Step 11b producer guide](../steps/step-11b.md)
- [Step 12a producer guide](../steps/step-12a.md)
- [Step 13 producer guide](../steps/step-13.md)
- [Step 14c producer guide](../steps/step-14c.md)
- [Step 15 producer guide](../steps/step-15.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| Ref | Producer/task/canonical file/revision | Exact consumption |
|---|---|---|
|U1|14c T2/E1-E5 localAiTypes.ts/localAiRuntime.ts/localAiArtifacts.ts;ai-runtime-1|AiTaskRequest/Result/Citation/InputRef;startAiTask;nativeinput/artifactleases;readRangeprotocol;task/schema/outputcaps;localmodezeronetwork |
|U2|09a T2/E3/E4/E9/E10 DocumentRegistry/controller.ts/uiHistory.ts/tabHistory.ts;tabs-documents-1|acquire/refcount/capturecurrentmodel;TabHistory.record before/after;oneUndo;nativeissuedSnapshotAuthorityRegistry identity;not pathreload |
|U3|09b T1-T5/E1/E4/E6 tabGroups.ts/savedGroups.ts/restoreSavedGroup.ts;tab-groups-1|createTabGroup(state,ids,name,color),cataloglist,restoreSavedGroup(saved,host);no privateAppvariables |
|U4|09e batch/09f T1/E1/E7 transferJobs.ts/transfer_control.rs;transfer-jobs-1,replace-capability-0|startTransfer typedrequest/sharedjobs;safeexistingreplacementfalse;object-boundRecycleunproved,assistantcapfalse;version/undoavailabilityhonest |
|U5|08a T1/T2/T4/E1-E7 convert.ts/exportSnapshots.ts;conversion-2|ConverterRegistry;nativecapture;fullConversionRequest includinglosses/warnings;ownednewoutput;no falseglobalUndo |
|U6|08c T1-T4/E1/E3/E5 privacy.ts/PrivacyDialog.tsx;privacy-1|inspection/effectivePrivacyCategories closure,newcopyandcontentack;no broadremoveall |
|U7|11a T3/E1/E4 search.ts/content_extractors.rs;11b E1 tags.ts|boundedgrantedsearchandnormalizedextraction;tagtransactionnormalmetadatahistory;exactcanonicalAST/Tagtypesimported |
|U8|07d T3/E1/E3 pdf.ts;07e T3/E1 ocr.ts;13 read-onlyOffice;15 timing/player|PdfInput/PdfSourceIdentity disk/snapshot;readPdfText;recognizeText/readonlyOCR;citationspage1based/timeTimeUs;noOCRpackneeded |
|U9|05c/10e dockpanels,10b KeyboardRouter,12a StorageProviders,10cProfileRoot|onepanel/layoutauthority;encryptedownedhistoryprovider;profilechangeinvalidatesallgrants/consents |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

Workers do not execute builds/tests/networkAPIcalls/modeldownloads. They write named tests/fixtures and integration proposals. Coordinator checks everytask/gate/package/realproviders with explicitaccountcostapproval. Shared command/settings/main/IPC/locale/manifests belongcoordinator;newfiles<400lines/rootchanges<40lines/task.

| Task; exact commit | Files and ordered work; dependencies | Named tests: input -> oracle |
|---|---|---|
|T1;`feat(assistant): typed command adapters and policy [step-17a/T1]`|src/assistant/types.ts/toolRegistry.ts/toolSchemas.ts;nativeassistant_types.rs/assistant_tools.rs/assistant_policy.rs;coordinatoroptionalCommandmetadata;U2-U7,E1. Registerexacttoolunions,capabilities/riskfilter;no executionduringparsing.|src/__tests__/step17a-tools.test.ts andnativeassistant_tools_step17a_tests.rs:irreversible_never_listed;unknown_tool_refused;create_text_preview_not_write;convert_missing_accepted_warning_codes_refused;two_toolcalls_refused;permanent_delete_not_representable|
|T2;`feat(assistant): constrained prompts and grounded sources [step-17a/T2]`|schemaRegistry.ts/promptRegistry.ts/sourceTypes.ts/sourceExtraction.ts;nativeassistant_sources.rs/assistant_citations.rs/assistant_prompts.rs;assets/ai/prompts/assistant-router.{en,es}.md;U1/U8,E2/E3. Nativeextractorusesimmutableauthorizedbacking,appschemas,delimitedsources,citationmap.|src-tauri/src/assistant_sources_step17a_tests.rs:quoted_system_in_file_no_authority;PDFpage2_quote_page1_refused;time_end_before_start_refused;source_changed_invalidatescitation;sensitive_snapshot_no_spool;prompt_examples_four_each_language|
|T3;`feat(assistant): scopes conversations and local turns [step-17a/T3]`|nativeassistant.rs/assistant_scope.rs/assistant_turns.rs;services/assistant.ts/assistantScope.ts;src/assistant/turnController.ts;U1-U3/U8/E4/E5;nativeAllowdialog,scopegeneration,loop8/oneinflight,cancel.|src-tauri/src/assistant_scope_step17a_tests.rs:denyfolder_wins_parentgrant;symlink_outside_denied;scope_from_filetext_refused;online_only_read_refused;tab_close_dirtyCancel_keepsview;loop9_refused;local_turn_zero_network|
|T4;`feat(assistant): Meta API choice and outbound approvals [step-17a/T4]`|nativeassistant_provider.rs/assistant_meta.rs/assistant_credentials.rs/assistant_outbound.rs/assistant_sse.rs/assistant_local_server.rs;services/assistantInference.ts/assistantProviders.ts;docs/ai/meta-api-evidence.md;U1/E7/E8. NativeDPAPIeditor/gateway,strictMetaendpoint/schema/SSE/bounds,one-shotconsent/localserverguard.|src-tauri/src/assistant_provider_step17a_tests.rs:key_never_settings_logs_history_exports;credentialStatus_last4_only;no_consent_zero_network;local_zero_network;meta401_auth_no_retry;meta429_rate_no_retry;redirect_external_denied;SSE65537byte_event_refused;stale_consent_source_changed_no_send;consent_replay_no_send;sensitive_api_refused;provider_switch_no_history_upload;loopback_server_external_redirect_denied;cancel_closes_body. FakeHTTPfixturescheckserialization;realprovideronlycoordinator |
|T5;`feat(assistant): previews and native human approval [step-17a/T5]`|nativeassistant_actions.rs/assistant_approvals.rs/assistant_recycle.rs;services/assistantActions.ts;src/assistant/actionAdapters.ts/actionHistory.ts;U2-U7,E6. Immutablehash/identitydraft,normalproducerexecution,actualpartialresults,nativeApplyanddualrecyclegate.|src-tauri/src/assistant_actions_step17a_tests.rs:generated_apply_text_no_effect;stage2_without_stage1_refused;first_and_second_distinct_nonce;count_or_list_changed_invalidatesboth;approval_replay_refused;recycle_capfalse_zero_disk_effects;path_precheck_does_not_enable_recycle;contentchange_versionhook_beforecommit;foreign_destination_never_replaced;partial_batch_records_actualonly|
|T6;`feat(assistant): docked chat and review interface [step-17a/T6]`|src/assistant/AssistantPanel.tsx/AssistantComposer.tsx/AssistantMessages.tsx/AssistantActionCard.tsx/AssistantCitations.tsx/AssistantBackendPicker.tsx;styles/assistant.css;U9/E4/E6/E7. Toolbar/palette/dockproposal,100msfeedback,explicitcards/outboundlaunch.|src/__tests__/step17a-panel.test.tsx:panel_open_no_model_load;IMEEnter_no_send;Entercomposer_no_Apply;Stop_once;citations_seek_correctpage_time;provider_notice_visible;screenreader_not_token_spam;300percent_all_controls_reachable|
|T7;`feat(assistant): preferences and encrypted optional history [step-17a/T7]`|nativeassistant_history.rs/assistant_history_store.rs;src/views/settings/AssistantSettings.tsx;src/assistant/history.ts;coordinatorschema44/DPAPIfeatureflags/storageprovider/locales;U9. Clearownedhistory,perprofilecredentialsseparate,no sensitivepersistence.|src-tauri/src/assistant_history_step17a_tests.rs:default_history_off_zero_disk;DPAPI_ciphertext_not_plain;profile_switch_revokes_grants;corrupt_history_preserved_and_error;clear_keeps_userfiles;portable_export_omits_keys;schema43_migrates_backendlocal |
|T8;`test(ai): bilingual assistant and injection evaluations [step-17a/T8]`|crates/ai-eval/src/{lib,types,runner,scoring}.rs;src/assistant/evalTypes.ts;services/aiEval.ts;literalfixtures/manifestandgoldensoraclesbelow;U1/E9;atleast100EN+100ES/40injection,fullmodel/backendmetadata.|crates/ai-eval/tests/step17a_scoring.rs:fixture_manifest_100_each;injection_manifest20_each;unsafe_effect_fails_even_correct_tool;qualityscore_not_modelselfreport;notrun_never_pass;API_eval_not_automatic_paid_call;fixture_expected_args_checked_bytypedvalidator |
|T9;`docs(help): assistant models permissions and API privacy [step-17a/T9]`|Fourbilingualhelpbelow;coordinatorhelp/keys/pseudo/IPC/measure/screenshots/reports,registrationoffuntilrealprovidersverified;U1-U9.|src/__tests__/step17a-help.test.ts:alltoolhelp_bilingual;allerrors_localized;API_disclosure_before_network;models_missing_pack_link;actualchecks/gatecoordinatorrequired |

## Coordinator commit labels (workers do not commit)

- feat(assistant): typed command adapters and policy [step-17a/T1]
- feat(assistant): constrained prompts and grounded sources [step-17a/T2]
- feat(assistant): scopes conversations and local turns [step-17a/T3]
- feat(assistant): Meta API choice and outbound approvals [step-17a/T4]
- feat(assistant): previews and native human approval [step-17a/T5]
- feat(assistant): docked chat and review interface [step-17a/T6]
- feat(assistant): preferences and encrypted optional history [step-17a/T7]
- test(ai): bilingual assistant and injection evaluations [step-17a/T8]
- docs(help): assistant models permissions and API privacy [step-17a/T9]

## Required handoff

Return `handoff/step-17a/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-17a/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.

AI reminder: assistant text uses17a's selected Local/API gateway; Meta is the first API provider, Local the initial choice. No automatic cloud fallback. Keys stay native; file-derived payloads need exact one-use reviewed consent. Speech/image/embeddings remain local. Reading a file never authorizes uploading it. Do not call a real provider or download a model in this assignment.
