# Coding assignment: step 14c — Local AI runtime and AI upscaling

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-14c.md](../steps/step-14c.md). Guide SHA-256: `eb859a5a43e37379175538c9f2c5f4be5d7cbdbe27209cc747d50a49f3de904d`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 4/5 |
| Branch | step-14c-local-ai |
| Tag | v0.3.3-step14c |
| Depends on | 07a helpers/jobs; 08a snapshots/conversion; 09a documents; 09f safe output capabilities; 12a packs; 14b image document |
| Written before | 07a was built |
| Interface revision | ai-runtime-1; ai-upstream-1 |

Settings reservation: 40 -> 41; screenshot reservations: 156-158. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 08a producer guide](../steps/step-08a.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 12a producer guide](../steps/step-12a.md)
- [Step 12b producer guide](../steps/step-12b.md)
- [Step 14b producer guide](../steps/step-14b.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| Ref | Producer/task/file/revision | Exact consumption |
|---|---|---|
| U1 |12a T1-T3/E1/E2 services/packs.ts,packs.rs;packs-1|listPacks/installPack;Packs.acquire(id,capability)->PackLease;verifiedversion heldthroughchild/readers |
| U2 |06d jobs.rs/jobs.ts baselineec284e8;07a E10 scheduler;12b EngineHost|JobHandle<T>completion/cancel,sharedpoll100ms;confinednativehandles/no-network/boundedchild;noChannel |
| U3 |08a T2/E4/E5 exportSnapshots.ts/export_snapshots.rs;conversion-2/export-snapshot-2|ExportSnapshot/SnapshotLease,resolve(id,document_id,revision),finalizednativeauthority;capture requires native-issued authority ID; sensitiveRAM |
| U4 |09a T2 controller.ts/document_grants.rs;tabs-documents-1|GrantedBacking/sourceidentity;captureimmutablecontent_id/revision;documentIDdoesnotauthorizeunrelatedpaths/liveunsavedbytes |
| U5 |14b T1/T6/E2/E6/E7 ImageDocument.ts/transactions.ts/tiles.ts;image-document-1|capturedsnapshot,publish/pinimmutabletiles;commitImageTransaction(documentId,expectedContentId,transform)->Promise<void>;oneUndo |
| U6 |08a T1/T4/E1-E3 registry.ts/convert.ts;conversion-2/export-snapshot-2|image/ai-upscale adapter,sameQuickConvertDialog/ConversionRequest including accepted_losses/accepted_warning_codes;ownednewoutput |
| U7 |12a T4/E3 storage;07a/12a background-2|addai_artifacts category/ai_batchkind;providerownsafeleases;excludesensitivefromdisk |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

Workers write tests but do not execute compilers/tests/installers/generators. Sharedfiles/settings/registries/locales/manifests/measurements are coordinator proposals. Everynewsource<400lines;rootApp/main<40lines/task. Coordinatorruns gateaftereveryactualtask, nevercommitsfailure.

| Task; exact commit | Files/work/imports | Named tests: input -> oracle |
|---|---|---|
|T1;`deps: pin local AI helper and model sources [step-14c/T1]`|Create docs/ai/pack-build-inputs.md,native/ai-host/CMakeLists.txt,notices proposal;U1/evidence. Coordinator pins complete allowedtoolchain,converts/hashes/signsrealcatalog. Noactivationuntilparity/confinement/inventory.|src-tauri/src/local_ai_pack_step14c_tests.rs: upstream_metadata_is_not_binary_verification sourceLFSonly->unverified;modified_helper_hash_refused->nochild;unknown_model_operator_refused;missing_pack_no_network->pack_missing|
|T2;`feat(ai): typed bounded runtime and artifacts [step-14c/T2]`|Create crates/ai-runtime/src/{lib,types,validation,schema,artifacts,protocol}.rs;native local_ai_types.rs/local_ai.rs/local_ai_inputs.rs/local_ai_artifacts.rs;services/localAiTypes.ts/localAiRuntime.ts/localAiArtifacts.ts;U1-U4/U7,E1-E5;native schemaallowlist,no fakefutureproviders.|crates/ai-runtime/tests/step14c_contract.rs:options_task_mismatch_refused;output262145bytes_refused;foreign_profile_artifact_refused;expected_revision2_input1->source_changed;released_input_live_job_retains_then_drops;embeddings_nan_rejected|
|T3;`feat(ai): confined model host and cancellation [step-14c/T3]`|native/ai-host/{main,wire,llama_adapter,ort_adapter,whisper_adapter}.cpp/headers;native local_ai_host.rs/local_ai_limits.rs/local_ai_hardware.rs;U2,D1-D3/D6-D8;unregisteredtext/speechunavailable.|src-tauri/src/local_ai_security_step14c_tests.rs:real_host_network_denied;outside_handle_open_denied;gpu_start_failure_cpu_retry_once;explicit_gpu_no_silent_cpu;cancel_descendants_within2s;idle120s_unloads;header65537bytes_refused. Realcanariescoordinatorrequired|
|T4;`feat(ai): tiled image enlargement [step-14c/T4]`|crates/ai-runtime/src/upscale.rs/upscale_tiles.rs/image_alpha.rs;native/ai-host/upscale_adapter.cpp;native local_ai_upscale.rs;U3/U5/U6;halos,alpha/metadata,independentoutputvalidation.|crates/ai-runtime/tests/step14c_upscale.rs:1000x500_4x->4000x2000;2501x2500_4x->too_large(100040000pixels);5000x5000_2x->100000000accepted;transparent_alpha_zero_stayszero;solidRGB_tile_partition_equal;reference_tiled_seams maxchannelerror<=2/255,mean<=0.5/255 vsuntiled;failedparity_disablesmodel|
|T5;`feat(ai): crop comparison and image editor apply [step-14c/T5]`|src/ai/UpscaleDialog.tsx,UpscaleComparison.tsx,UpscaleControls.tsx,useUpscalePreview.ts,upscale.ts;src/styles/ai-upscale.css;U3/U5/E6;dirtycapture/oneApplytransaction.|src/__tests__/step14c-upscale-ui.test.tsx:optionrev2_before1_shows2;preview_never_dirty;apply_expectedcontent_mismatch_refused;keyboard_comparison_works;dialogclose_cancels_and_releases;missingpack_opens_storage_only|
|T6;`feat(convert): local AI enlargement adapter and settings [step-14c/T6]`|src/convert/aiUpscaleConverter.ts,native local_ai_convert.rs,src/views/settings/LocalAiSettings.tsx,src/ai/AiRuntimeCard.tsx;coordinatorschema41/enums/Size/registrywiring;U1/U6/U7.|src/__tests__/step14c-settings.test.tsx:schema40_default_all_disabled;disabling_cancels_unloads;quickconvert_keep_original;duplicate_click_one_job;batch1001_refused;missingGPUrecommendation_noclaimedVRAM|
|T7;`docs(help): AI enlargement and local packs [step-14c/T7]`|Helpbelow;coordinatorlocales/pseudo/help/IPC/inventory/measures/screenshots/report;U1-U7.|src/__tests__/step14c-help.test.ts:every_ai_command_help_bilingual;every_error_localized;locale_placeholders_match. Native sensitive_preview_no_diskwrites plus actualGPU/CPUquality/securityacceptance|

## Coordinator commit labels (workers do not commit)

- deps: pin local AI helper and model sources [step-14c/T1]
- feat(ai): typed bounded runtime and artifacts [step-14c/T2]
- feat(ai): confined model host and cancellation [step-14c/T3]
- feat(ai): tiled image enlargement [step-14c/T4]
- feat(ai): crop comparison and image editor apply [step-14c/T5]
- feat(convert): local AI enlargement adapter and settings [step-14c/T6]
- docs(help): AI enlargement and local packs [step-14c/T7]

## Required handoff

Return `handoff/step-14c/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-14c/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.

AI reminder: assistant text uses17a's selected Local/API gateway; Meta is the first API provider, Local the initial choice. No automatic cloud fallback. Keys stay native; file-derived payloads need exact one-use reviewed consent. Speech/image/embeddings remain local. Reading a file never authorizes uploading it. Do not call a real provider or download a model in this assignment.
