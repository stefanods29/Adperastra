# Coding assignment: step 17b — Local AI actions

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-17b.md](../steps/step-17b.md). Guide SHA-256: `dcd710cb5d02c5d45e1d06019ebe464c12d4214b702ed85c6e2520270f7cba4e`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 4/5 |
| Branch | step-17b-ai-actions |
| Tag | v0.4.2-step17b |
| Depends on | 14c ai-runtime-1;17a assistant-schema-1/provider-1/eval-1;07e OCR;08a conversion;14b image editor;15 media;10f accessibility |
| Written before | 07a was built |
| Interface revision | ai-actions-1;speech-1 |

Settings reservation: 44 -> 45; screenshot reservations: 167-169. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07e producer guide](../steps/step-07e.md)
- [Step 08a producer guide](../steps/step-08a.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 11a producer guide](../steps/step-11a.md)
- [Step 12b producer guide](../steps/step-12b.md)
- [Step 13 producer guide](../steps/step-13.md)
- [Step 14b producer guide](../steps/step-14b.md)
- [Step 14c producer guide](../steps/step-14c.md)
- [Step 15 producer guide](../steps/step-15.md)
- [Step 17a producer guide](../steps/step-17a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| Ref | Producer/task/canonical file/revision | Exact consumption |
|---|---|---|
|U1|14c T2-T5/E1-E6 localAiRuntime.ts/localAiArtifacts.ts/upscale.ts;ai-runtime-1|nativeimage/speechartifacts/caps/leases/cancel;upscaleexistingdialog;CPU/GPUconfinement/sharedmemory |
|U2|17a T1/T2/T4/T8 E1-E3/E7/E9;assistant-schema/provider-1|typedregistry/schema/prompts/gateway;selectedtext/visionbackend/outboundconsent;evalfixtures/scorers;no remotespeechorimageeffects |
|U3|07e T3/T5/E1 ocr.ts;ocr-1|recognizeText/ocrPage/releaseOcr;Copyalltextonlyexplicitclipboard;missingWindowslanguageerror,nopack |
|U4|14b T1/T4/T6/E2/E6/E7 image-edit/{ImageDocument,transactions,tiles}.ts;image-document-1|sourcecapture/coordinatebrush/immutabletiles/onecommitImageTransaction;readonly/protectedrefused |
|U5|15 T1/T4/E1/E2/E6 media-edit/types.ts/MediaDocument.ts/subtitles.ts;media-edit-1|MediaSubtitleCue exactTimeUs/text;controller.apply(set_subtitles);SubtitleAccessibility10f;standaloneplayeradaptercoordinator |
|U6|12b T2/T3 E2/E3/E5 engineTypes.ts/mediaEngine.ts/EngineHost;engine-host-1|authorizedmediaPCMdecode/probe/TimeUs,confinedpipes/sourceidentity;no ffmpegrawfiltertext |
|U7|08a T1/T2/T4/E1-E7 convert/registry.ts/exportSnapshots.ts;conversion-2/export-snapshot-2|newcopyconverter/ConversionReport/acceptedlosses+warnings/snapshotauthority;version/Undocapabilitynotfaked |
|U8|09a docs/controller and07d PdfInput/PdfSourceIdentity/readPdfText;13Officeextractor;11a ContentExtractorRegistry|authorizedcurrentcapturedtext,page/timeprovenance;sensitiveRAM/OCRpermissions;no fakepath/nativechange |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; exact commit | Files and ordered work/imports | Tests: exact input -> oracle |
|---|---|---|
|T1;`feat(ai): typed actions and suggestion results [step-17b/T1]`|src/services/aiActionTypes.ts/aiActions.ts;src/ai-actions/registry.ts;nativeai_action_types.rs/ai_actions.rs/ai_action_results.rs;U1/U2/U7/E1/E2;typedcaps/leases/resulttabsproposal.|src-tauri/src/ai_actions_step17b_tests.rs:missingpack_disabled_reason;copytext_noAIpack;foreign_result_id_refused;result_close_revokes_new_reads;unknown_action_options_refused;resulttab_never_fake_path|
|T2;`feat(ai): local foreground and object erase previews [step-17b/T2]`|nativeai_foreground.rs/ai_inpaint.rs/ai_mask.rs;native/ai-host/foreground_adapter.cpp/inpaint_adapter.cpp;src/ai-actions/imageActions.ts/ImageEffectPreview.tsx/ImageMaskEditor.tsx;coordinatorrealpacksinventory;U1/U4/E5.|crates/ai-runtime/tests/step17b_images.rs:alpha255_mask128->alpha128;alpha128_mask128->alpha64;mask0keepssourceoutsidehole;empty_mask_refused;mask51percent_refused;inpaint16MPplus_refused;mask_source_revision_changed_refused;outside_hole_exact_bytes;CPU_GPU_modelparityfixtures. UIstep17b-images.test.tsx:rectanglekeyboard/oneApplyUndo/Cancelunchanged|
|T3;`feat(speech): standalone local transcription [step-17b/T3]`|src/services/speechTypes.ts/speech.ts;native speech_types.rs/speech.rs/speech_decode.rs/speech_transcripts.rs/speech_overlap.rs;native/ai-host/whisper_adapter.cpp;U1/U6/E3;30sboundeddecode/times/dedup/pages.|src-tauri/src/speech_step17b_tests.rs:whisper_tick123->1230000us;segment_endexclusive;overlap_identicalsuffixonce;nonmatchingoverlap_notdropped;silence_zero_segments;3601s_refused;page128KiBcap;sourcechanged_refused;cancel_noPCMspool;standalone_no_assistant_required|
|T4;`feat(speech): explicit microphone dictation sessions [step-17b/T4]`|native speech_microphone.rs/speech_dictation.rs;src/ai-actions/DictationDialog.tsx;U1/U8/E3. AudioGraph.CreateAsync/CreateDeviceInputNodeAsync(MediaCategory.Speech,encoding),CreateFrameOutputNode/getFrame;nativeownconsent,120sbudget,StoplocalASR/noinsert. Coordinatorverifieswindows0.61.3features/signaturesagainstlocalgeneratedsource.|src-tauri/src/speech_dictation_step17b_tests.rs:denied_no_device_open;fake_tool_start_refused;120s_float_mono_bytes7680000;tab_switch_cancels_and_zeroizes;stop_transcript_does_not_insert;changed_content_requiresnewreview;cancel_releasesdevice;device_lost_errorindicator. Realmicprivacytestcoordinatoronly |
|T5;`feat(media): local automatic captions and subtitle apply [step-17b/T5]`|src/ai-actions/AutomaticCaptions.tsx/useAutomaticCaptions.ts;native speech_captions.rs;src/ai-actions/transcriptSubtitles.ts;coordinator10f/15playerwiring;U3/U5/U6/E4;explicitactivewindows,seekgeneration,style/normalset_subtitles.|src/__tests__/step17b-captions.test.tsx:seek_generation2_ignores1;inactive_cancels;subtitlefile_overridesAuto;hearingpref_defaultoff;cue1s..2s->1000000..2000000TimeUs;apply_one_media_transaction;no_assistantpack_works;captions_noSRTautowrite |
|T6;`feat(ai): grounded document media and folder suggestions [step-17b/T6]`|src/ai-actions/sourceText.ts/documentActions.ts/mediaActions.ts/folderActions.ts;nativeai_action_sources.rs/ai_action_text.rs/ai_action_folder.rs;prompts/schemasabove;U2/U6/U8/E6;selectedgatewayandpayloadreview;exactbounds/citations.|src-tauri/src/ai_actions_text_step17b_tests.rs:API_transcript_no_consent_zero_network;filenameonly_folder_no_contents;deniedfolder_skipped_notread;compare_requires2;moment_outofduration_refused;translation_preserves120;OCR_existingtoolreused;paragraph33_refused_or_explicitpartial_notclaimwhole;source_text_injection_no_toolauthority |
|T7;`feat(ai): result tabs action menus and safe exports [step-17b/T7]`|src/ai-actions/AiResultView.tsx/AiActionMenu.tsx/AiTranscriptView.tsx/AiFolderReview.tsx;styles/ai-actions.css;nativeai_action_export.rs;coordinatorschema45/tabkind/menu/ribbon/command/IPC/locale/protocolwiring;U1-U8/E1-E6.|src/__tests__/step17b-ui.test.tsx:all17actions_incorrectcontexts_filtered;missingpack_storage_link;savecopy_newname_nooverwrite;result_close_releases;SRT0us_to1us->0ms..1ms;Spanishdark300percent_reachable;APIbackendnotice_ontextresults;ordinaryplayer_no_pack_unaffected |
|T8;`test(ai): bilingual actions and speech evaluation fixtures [step-17b/T8]`|tests/fixtures/ai/actions/ manifests/goldens;src/ai-actions/evaluation.ts;U2/E1-E6;exactperfeaturecorpora/rubricsabove,noreviewresultsinvented.|crates/ai-eval/tests/step17b_actions.rs:three_prompt_examples_eachlanguage_eachtemplate;outbound_violation_alwaysfails;missing_reference_audio_not_passing;outside_hole_singlepixel_change_fails;partial_notfullcoverage;worderrorrate_tenwords_twosubs_oneinsert->30percent |
|T9;`docs(help): AI actions transcription and captions [step-17b/T9]`|Sixbilingualhelpbelow;coordinatormeasures/shots/pseudo/licensepackrecords/report/KNOWN_ISSUES;U1-U8.|src/__tests__/step17b-help.test.ts:allactionhelppages_bilingual;allerrors_keys;schema44_defaults45;SRT_text_escaped_literal;dictation_help_mentionsreview;actualquality/security/packgatescoordinatorrequired |

For T4 official [AudioGraph input](https://learn.microsoft.com/en-us/uwp/api/windows.media.audio.audiograph.createdeviceinputnodeasync?view=winrt-26100) and [frame output](https://learn.microsoft.com/en-us/uwp/api/windows.media.audio.audiograph.createframeoutputnode?view=winrt-26100) support uncompressed PCM/float encodings. No backgroundrecordingcapability ispermissiontoignoreexplicitappconsent. Native secret/mic dialogs own actualhumaninput; model-originatedcommandsneverdisplayorapproveforuser.

## Coordinator commit labels (workers do not commit)

- feat(ai): typed actions and suggestion results [step-17b/T1]
- feat(ai): local foreground and object erase previews [step-17b/T2]
- feat(speech): standalone local transcription [step-17b/T3]
- feat(speech): explicit microphone dictation sessions [step-17b/T4]
- feat(media): local automatic captions and subtitle apply [step-17b/T5]
- feat(ai): grounded document media and folder suggestions [step-17b/T6]
- feat(ai): result tabs action menus and safe exports [step-17b/T7]
- test(ai): bilingual actions and speech evaluation fixtures [step-17b/T8]
- docs(help): AI actions transcription and captions [step-17b/T9]

## Required handoff

Return `handoff/step-17b/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-17b/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.

AI reminder: assistant text uses17a's selected Local/API gateway; Meta is the first API provider, Local the initial choice. No automatic cloud fallback. Keys stay native; file-derived payloads need exact one-use reviewed consent. Speech/image/embeddings remain local. Reading a file never authorizes uploading it. Do not call a real provider or download a model in this assignment.
