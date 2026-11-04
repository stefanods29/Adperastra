# Step 14c: Local AI runtime and AI upscaling

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 4/5 |
| Branch | step-14c-local-ai |
| Tag | v0.3.3-step14c |
| Depends on | 07a helpers/jobs; 08a snapshots/conversion; 09a documents; 09f safe output capabilities; 12a packs; 14b image document |
| Written before | 07a was built |
| Interface revision | ai-runtime-1; ai-upstream-1 |

This is a **guide** step (AGENTS.md “Steps come in two kinds”): every decision is below, but no code. Write the code exactly as described: the names, files, types, numbers and texts given here, and nothing else. Workers write owned feature files/tests only; the coordinator owns shared wiring, dependency production and executed verification. This guide does not install a model or prove a pack safe.

## Goal

Enlarge an image two or four times with a crop preview, on GPU or CPU, while keeping its original. Install optional local processing packs and inspect their hardware needs. All later AI features use one confined, cancellable runtime.

## Do not do in this step

Assistant UI/tools are17a; transcription/masking/object removal17b; semantic indexes17c; writing/extraction17d/20c/21b/22b. Reserve their typed variants here and report unavailable until a provider and verified pack exist. No cloud inference, training, diffusion upscaler, Upscayl code, automatic download, external server, arbitrary model import or upstream agent/tools. Real-CUGAN/waifu2x/SwinIR/HAT require a later evaluation and plan change.

## Read first

Read rules R-SAFE/R-AI/R-SEC/R-BG/R-LIC, conventions, pitfalls P-01/P-10/P-11/P-28, contracts, ai.md, libraries, speed, glossary, design-spec, dependency/settings/help recipes, v1 step14c and roadmap. Read12a T1-T4/E1-E3;08a T2/T4/E1-E7;09a controller/native grants;09f capability limitations;14b E1-E8; actual jobs/helper/owned_io. Read [AI-API-EVIDENCE.md](../parallel/AI-API-EVIDENCE.md) for immutable sources and advertised LFS hashes. Baseline ec284e8; future interfaces are written-ahead contracts, not existing code claims.

## Decisions (already made)

1. D1. Use llama.cpp b12032 commit dde879bc4f954b809892fd0d660515f42536394a for text/vision, ONNX Runtime1.23.2 commit a83fc4d58cb48eb68890dd689f94f28288cf2278 for image/embedding tensors, whisper.cpp1.8.2 commit4979e04f5dcaccb36057e059bbaed8a2f5288315 for speech, all MIT. Compile app-owned adapters into a separate helper pack. Use exact upstream headers, no handwritten Rust ABI structs. ONNX uses verified DirectML thenCPU, llama Vulkan thenCPU, speech CPU independently. No bundled inference webserver.
2. D2. Coordinator builds AdperastraAiHost.exe from native/ai-host/ and inventories every executable/DLL/license/hash in12a signed catalog. No custom operators, Python, dynamic model code, remote URLs, built-in llama tools/agent/MCP/RPC/downloads. AppContainer/restricted token, private ACL/handle grants deny unrelated files and all network. GPU device access requires real confinement canaries; failure leaves CPU/unavailable, never unrestricted fallback. Job-object limits alone are not a security boundary.
3. D3. Add PackId ai_runtime,ai_upscale,ai_assistant_small,ai_assistant,ai_assistant_pro,ai_embeddings_text,ai_embeddings_vision,ai_speech,ai_foreground,ai_inpaint. Models depend on exact ai_runtime version; entrypoints runtime.llama/runtime.onnx/runtime.whisper identify fixed operations. Model capabilities ai.upscale,ai.structured_text,ai.vision_answer,ai.embed_text,ai.embed_image,ai.embed_siglip_text,ai.transcribe,ai.foreground_mask,ai.inpaint. Only upscaling is activated here. Source pins are ai-upstream-1; coordinator must produce real derivative artifact hashes before catalog activation.
4. D4. Upscale general=realesr-general-x4v3, photo=RealESRGAN_x4plus, drawing=RealESRGAN_x4plus_anime_6B, all BSD-3-Clause official releases from evidence file. Coordinator builds float32 ONNX opset17/eval/dynamic spatial dimensions, tensor names input/output, NCHW RGB0..1; general denoise strength1/no DNI blend. Validate parity with pinned source and record converter provenance. This selects v1's ONNX alternative: published ncnn recipes do not uniformly supply these models andCPU behavior.
5. D5. Orient and ICC-convert to sRGB through07a/14b once. Infer RGB; retain original alpha resized Lanczos3. Keep metadata unless normal export declares an acknowledged loss; orientation1/dimensionsupdated. Process row-major256x256 source cores with64px context eachside and reflect101 outer padding; crop model output to core. Both scales infer4x;2x downsamples completed4x pixels Lanczos3 with output-filter halo across core boundaries. Never resize isolated cores without filter taps from neighbors. Seam/parity fixtures must pass before shipping; do not lower thresholds to hide seams.
6. D6. Input/final edges<=32768 and pixels<=100,000,000; encoded input<=256MiB; checked arithmetic before allocation. Thus4x input<=6,250,000pixels;2x<=25,000,000. Helper CPU ceiling min(8GiB,floor(availableRAM*0.5)),512MiB minimum; GPU budget min(4GiB,floor(dedicatedVRAM*0.7)),256MiB minimum. Stream tiles to owned output. Sensitive inputs/artifacts memory-only within256MiB result/shared budget or fail sensitive_unsupported beforeprocessing; no cache/spool/log leakage.
7. D7. One active inference globally/queue8; one loaded model, unload120s idle or immediately ondisable/profile switch. Context8192tokens/output4096;request text128KiB/structured output256KiB/inputs128. CPU threads max(1,min(4,logicalcores-2)). Batch<=1000/sharedjobs, lowpriority and12a ai_batch policy; explicit foregroundactions not silentlypaused byidlepolicy. Pack/input leases outlive child andartifact readers. No unbounded inference result history.
8. D8. UI cancellation feedback<=100ms; helper cooperative checkpoint, terminate descendants<=2s ifneeded, terminaljob<=5s. Crop timeout30s/fullimage10min/perbatchfile10min; text first-token target10s/total120s; speech specified17b. Auto device OOM retriesonce onCPU after discarding incompleteoutput and showing notice; explicitgpu returnsunsupported. ETA only after>=3same-model/device tiles, movingmedian, labeledapproximate; otherwise Calculating time. Never invent an estimate.
9. D9. Preview selected source crop<=256x256, defaultcenter orwhole smallerimage, retainingoutsidecropcontext; output<=1024edge. Original/result sharefit/zoom, keyboardCompare slider andstaticpane alternatives. Key sourceidentity/capturedcontent_id/modelartifacthash/runtime/options/crop. Old option/revision result cannot display. Sensitivepreview RAM-only. Previewneverdirty;Applyrequiresunchangedcontent_id andone14b transaction. QuickConvertcreatesnewownedPNG, neveroriginalreplacement.
10. D10. Settings40->41 LocalAiSettings below, allopt-infalse. Hardware recommends small ifRAM<=8GiB, pro permitted ifRAM>=16GiB andVRAM>=8GiB, defaultotherwise; actualusabledevicequery, noguessedVRAM. Recommendation neverdownloads. Disabling cancels/unloads, noautomaticwarmup/networkdiscovery.

## Data shapes

Canonical TS src/services/localAiTypes.ts; native src-tauri/src/local_ai_types.rs reexports pure crates/ai-runtime/src/types.rs. Fields snake_case; wire counts/times nonnegative JS-safe integers; UUID strings. JobRequestId is the existing runJob/newRequestId ASCII string of at most64 characters, never a UUID requirement. The wrapper uses its generated request ID in both command and request. Unknown/extra fields fail ai.bad_request. Services alone call invoke.

| Type | Exact fields/defaults/validation |
|---|---|
| AiTaskKind | structured_text/vision_answer/embed_text/embed_image/transcribe/upscale/foreground_mask/inpaint; independently registered capabilities |
| LocalAiSettings | enabled false;device auto/cpu/gpu defaultauto;tier auto/small/default/pro defaultauto;idle_unload_seconds120 range30..600;memory_limit_mb4096 range512..8192 clippedD6;tasks map all8 kinds tofalse. Migration addsmissingkeys/preservesotherfields/futureschema |
| AiCapabilityStatus | task AiTaskKind;available bool;pack_id nullablePackId;model_id nullableASCII<=96;reason null/disabled/pack_missing/unverified/unsupported/memory_limit/sandbox_failed |
| AiHardwareInfo | ram_bytes/available_ram_bytes safeu64;logical_cores u16;gpu_name nullablestring<=256;dedicated_vram_bytes nullableu64;gpu_backend null/vulkan/directml;recommended_tier small/default/pro;no persistentdeviceID |
| AiInputRef | kind document/snapshot/artifact;idUUID;expected_revision safeu64>=1. Nativeissued/profilebound;document means opened originalbacking only;unsavedcontentmustusesnapshot |
| AiPromptArgument | nameASCII1..64;value string<=65536scalars;trust user/source. Sourcevalues escaped/delimited, never systeminstructions |
| AiPromptRequest | template_id ASCII1..96;template_revision positiveu32;arguments AiPromptArgument[]<=32;output_schema_id ASCII1..96. Onlyappregisteredtemplates/schemas |
| AiTaskRequest | request_id JobRequestId;task AiTaskKind;locale en/es;inputs AiInputRef[]<=128;prompt nullableAiPromptRequest;options AiTaskOptions matchingtask. Image tasks exactly1input; text mayhave0 |
| ImageRect | x/y nonnegativeu32;width/height positiveu32;checkedinsideorientedsource |
| AiCitation | input_idUUID;revision safeu64;location AiSourceLocation;quote string<=500scalars;source/revision/location authorized, quote matches capturedspan afterwhitespacenormalization |
| AiSourceLocation | text{start,end} scalaroffsets,endexclusive;page{pageu32>=1};time{start_us,end_us} TimeUs,end>start;sheet{sheet_id<=128,range<=64};slide{slide_id<=128};image{region nullableImageRect};noURL/OSpath |
| AiResultPayload | structured{schema_id,canonical_json string<=262144UTF8bytes};embeddings{artifact_idUUID,rowsu32<=128,dimensionsu16 384/768,normalization l2};transcript{artifact_id,duration_us TimeUs,segment_countu32<=100000};image{artifact_id,width,height,mime image/png};mask{artifact_id,width,height} |
| AiTaskResult | job_id JobRequestId;task;model_idASCII<=96;model_revisionASCII<=64;result AiResultPayload;citations AiCitation[]<=256;warnings AiWarningCode[]<=32 |
| AiWarningCode | cpu_fallback/approximate/truncated/experimental/metadata_loss; metadata_loss requires normalexportacknowledgment |
| AiTextPage | chunks{sequence safeu64,textstring}[]<=64/64KiBtotal;after_sequence safeu64;donebool. Strictlyincreasing,1MiBringbuffer;provisionalescapeddisplay,completionvalidatesauthority |
| AiArtifactInfo | idUUID;kind image/mask/embeddings/transcript;byte_len/expires_unix safeu64;sensitivebool |
| Native AiArtifactLease | immutablebytes/ownedbacking,typedmetadata,profile/sourceownership,input/packretention;notserde. Ordinarystore1GiB,sensitive256MiBsharedmemory;5minidleexpiry,noevictionwhileleased |

| AiTaskOptions discriminator | Exact additional fields |
|---|---|
| structured_text/vision_answer | max_output_tokensu32 1..4096 default1024;temperaturefinite0..1 default0;seed safeu64 default0. Vision<=16images,2048edge/4MPeach;video sampling outside runtime |
| embed_text | modequery/passage;model multilingual_e5_small/siglip2_base;truncate_tokensfixed512;warningontruncation |
| embed_image | model fixedsiglip2_base;oneimage |
| transcribe | languageauto/en/es;translate_to_englishboolfalse;start_usTimeUs;end_usnullableTimeUs>start;PCMfrom12b |
| upscale | scale2/4 default4;modelgeneral/photo/drawing defaultgeneral;preview_regionnullableImageRect;deviceauto/cpu/gpu defaultauto |
| foreground_mask | modelfixedbirefnet;thresholdfinite0..1 default0.5 |
| inpaint | modelfixedmigan;mask_artifact_idUUID,samedimensions/sourcerevision/profile |

`TimeUs` is imported from12b canonical `src/services/engineTypes.ts` and re-exported by `src/services/mediaEngine.ts`;14c does not define a second time unit.

Embedding binary artifact is little-endian float32 row-major in input order, allfinite, L2norm tolerance1e-5;zerovectorfails model_output. multilingual-e5-small384dims uses maskedmeanpooling/L2 and query prefix `query: ` or passage prefix `passage: ` forbothlanguages. SigLIP2 base projectedimage/text768dims/L2, internaltext64tokens despitecommon512guard. Exact pinned tokenizer/config/preprocessing assets in signed inventory. Transcript artifact segmentation is frozen17b, not arbitrary unboundedJSON.

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

## Exports for later steps

| Ref | Canonical export/signature | Consumers/ownership |
|---|---|---|
| E1 |localAiRuntime.ts aiCapabilities()->Promise<AiCapabilityStatus[]>;aiHardware()->Promise<AiHardwareInfo>;nativeai_capabilities/ai_hardware|allAI/settings;statusdoesnotload |
| E2 |localAiRuntime.ts startAiTask(request:AiTaskRequest)->Promise<JobHandle<AiTaskResult>>;pollAiText(jobId:string,afterSequence:number)->Promise<AiTextPage>;nativeai_task_start(request_id,request)->unit andai_text_page(job_id,after_sequence)|17a-d/20c/21b/22b;request IDs equal;sharedterminalcompletionauthority |
| E3 |localAiArtifacts.ts acquireAiInput(input:ConversionInput)->Promise<AiInputRef>;acquireAiDocumentInput(documentId:string)->Promise<AiInputRef>;releaseAiInput(id:string)->Promise<void>|nativeai_input_acquire/ai_document_input_acquire/ai_input_release;immutableauthorizedlease/sourceidentity;documentoriginalrevision1only;dirtysnapshotrequired;5minidle/profilebound |
| E4 |localAiArtifacts.ts describeAiArtifact(id:string)->Promise<AiArtifactInfo>;readAiArtifact(id,offset,length<=8MiB)->Promise<Uint8Array>;releaseAiArtifact(id)->Promise<void>|nativeai_artifact_describe/ai_artifact_release;readthroughadpfileopaquegrant/range,noJSONbytes;wrapper splits a requested8MiB range into at most two4MiB07d protocol reads, validates exact lengths and concatenates only under the public8MiB allocation bound;releaseidempotent/no newreaders,existingleasesfinish |
| E5 |native local_ai.rs LocalAiRuntime.run(request:&AiTaskRequest,context:&JobContext)->Result<AiTaskResult,String>;artifacts.rs AiArtifacts.resolve(id,expected_kind,profile_id)->Result<AiArtifactLease,String>|trustednative17b/c adapters;no privatebufferimports/authorizationbypass |
| E6 |ai/UpscaleDialog.tsx UpscaleDialog props{input:ConversionInput,documentId:string|null,expectedContentId:string|null,onClose:()->void,onOpenHelp:(slug:string)->void};ai/upscale.ts applyUpscale(documentId,expectedContentId,result:AiTaskResult)->Promise<void>|14b Size/17b reuse;revision/dimensionschecked,14btransaction;nocustomsave |

Nativecommands all ensure_main,validateprofile/IDs/bounds/source beforequeue/allowlist. Helperheader<=64KiB/payloadchunks1MiB and checkedtotalbudgets. No callerselectedexecutable/root. Errors ai.bad_request/disabled/pack_missing/unverified/unsupported/memory_limit/sandbox_failed/source_changed/expired/timeout/cancelled/model_output/schema_invalid/sensitive_unsupported/failed, translatedbelow;neverrawstderr.

## UI, commands and translations

Reuse Dialog/HelpButton/Skeleton/jobs/slider. image.aiUpscale labelai.upscale/iconScaling/no shortcut/helpai-upscaling;app.aiSettings labelai.settings/iconCpu/no shortcut/helpai-packs-hardware. Add Sizepanelbutton belowdeterministicresize;converteridimage/ai-upscale,PNGdefault. Allsurfacesuseexisting tokens;canonical tokens confirmed from generated tokens during integration, no invented colorvalues.

| Selector/component | Structure/layout |
|---|---|
| UpscaleDialog/.adp-ai-upscale |labelledrole dialog;width920maxviewportminus32;heightmaxviewportminus32;header40/contentminmax/footer48;padding16/gap12;newAIdimensions chosenbecause design hasnone |
| .adp-ai-upscale-controls |260pxaside,labelsmodel/scale/device,gridgap12;below800stackabovepreview |
| .adp-ai-comparison |twoequalminmaxcolumns,gap8;containimagesmaxheight480;cropx/y/w/hkeyboardfields;Compare0..100default50,arrows1/Shift10/Home/End;staticBefore/Afteralternatives |
| .adp-ai-runtime-card |max640,padding16,gap12;role status/politelive;hardware/tier/ETA/missingpack;noautomaticdownload |
| .adp-ai-progress |Skeletonwithin100ms/wordsat1s;labelledprogress/Cancel;errorrolealert;closecancels/releases/restoreslaunchfocus |

Use tokenwindow/pane surfaces,textprimary/secondary,border/radius/font,existingaccentfocusoutline. 300%zoomstacks/internal scroll. Repeatedclickreusesactivejob;optionchangeincrementsrevision/cancelsold;newinputreleasesold. No per-token live announcements.

| Key | English | Spanish |
|---|---|---|
|ai.settings / ai.upscale / ai.localOnly|Local AI / Enlarge with AI… / Runs on this computer.|IA local / Ampliar con IA… / Se ejecuta en este equipo.|
|ai.enabled / ai.model / ai.scale / ai.device / ai.tier|Enable local AI / Model / Scale / Processing device / Model size|Activar IA local / Modelo / Escala / Dispositivo de procesamiento / Tamaño del modelo|
|ai.general / ai.photo / ai.drawing / ai.auto / ai.cpu / ai.gpu|General images / Photos / Drawings / Automatic / CPU / GPU|Imágenes generales / Fotos / Dibujos / Automático / CPU / GPU|
|ai.small / ai.default / ai.pro / ai.recommended|Small / Standard / Pro / Recommended for this computer|Pequeño / Estándar / Pro / Recomendado para este equipo|
|ai.preview / ai.before / ai.after / ai.compare / ai.apply / ai.newCopy|Preview crop / Before / After / Compare / Apply suggestion / Save enlarged copy|Vista previa del recorte / Antes / Después / Comparar / Aplicar sugerencia / Guardar copia ampliada|
|ai.loading / ai.processing / ai.missing / ai.storage|Loading the local model… / Processing on this computer… / This action needs an optional pack. / Open App storage|Cargando el modelo local… / Procesando en este equipo… / Esta acción necesita un paquete opcional. / Abrir Almacenamiento de la aplicación|
|ai.cpuFallback / ai.calculating / ai.eta / ai.disabled|Using the CPU; this may take longer. / Calculating time… / About {time} remaining / Local AI is turned off.|Se usa la CPU; puede tardar más. / Calculando el tiempo… / Quedan aproximadamente {time} / La IA local está desactivada.|
|ai.outputSize / ai.idle / ai.memory / ai.experimental|Result: {width} × {height} / Unload after inactivity / Memory limit / Experimental|Resultado: {width} × {height} / Descargar tras la inactividad / Límite de memoria / Experimental|
|errors.ai.bad_request / errors.ai.disabled / errors.ai.pack_missing / errors.ai.unverified|This AI request is not valid. / Local AI is turned off. / The required AI pack is not installed. / This AI pack has not passed verification.|Esta solicitud de IA no es válida. / La IA local está desactivada. / No está instalado el paquete de IA necesario. / Este paquete de IA no pasó la verificación.|
|errors.ai.unsupported / errors.ai.memory_limit / errors.ai.sandbox_failed / errors.ai.source_changed|This AI action is not supported here. / This action exceeds the available memory. / Local processing could not start with the required restrictions. / The source changed. Preview it again.|Esta acción de IA no es compatible aquí. / Esta acción supera la memoria disponible. / El procesamiento local no pudo iniciarse con las restricciones necesarias. / El origen cambió. Vuelve a ver la vista previa.|
|errors.ai.expired / errors.ai.timeout / errors.ai.cancelled / errors.ai.model_output|This AI result has expired. / Local processing took too long. / Local processing was cancelled. / The model returned an invalid result.|Este resultado de IA venció. / El procesamiento local tardó demasiado. / Se canceló el procesamiento local. / El modelo devolvió un resultado no válido.|
|errors.ai.schema_invalid / errors.ai.sensitive_unsupported / errors.ai.failed|This suggestion did not pass validation. / This action cannot keep the locked file entirely in memory. / Local processing could not finish.|Esta sugerencia no pasó la validación. / Esta acción no puede mantener el archivo bloqueado solo en memoria. / No se pudo completar el procesamiento local.|

ReuseactualcommonCancel/Closekeys;scale2×/4×/CPU/GPU/modelnamesaredata. Do notformEnglishsentencesfromfragments.

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

## Help pages

Create recipe headings and fulltext below in bothlanguages;app links F1/panelHelpButton/commandhelpSlug.

help/en/ai-upscaling.md:
```markdown
# AI upscaling
Enlarge a picture on this computer with an optional pack.
## How to use it
Open an image, choose **Size**, then **Enlarge with AI…**. Choose **2×** or **4×** and a model. Use **Preview crop** and compare **Before** and **After**. Choose **Apply suggestion** to edit the open image, or **Save enlarged copy** in Convert to create a new file. **Cancel** stops processing.
## Good to know
The original stays unchanged until you use the normal Save action. AI can invent detail, so inspect important pictures. The CPU works without a supported GPU and may take longer. Output sizes are limited to protect memory. A missing pack opens App storage; it is never downloaded without your choice.
See also: "AI packs and hardware" and "Editing images".
```
help/es/ai-upscaling.md:
```markdown
# Ampliar imágenes con IA
Amplía una imagen en este equipo con un paquete opcional.
## Cómo usarlo
Abre una imagen, elige **Tamaño** y después **Ampliar con IA…**. Elige **2×** o **4×** y un modelo. Usa **Vista previa del recorte** y compara **Antes** y **Después**. Elige **Aplicar sugerencia** para editar la imagen abierta, o **Guardar copia ampliada** en Convertir para crear otro archivo. **Cancelar** detiene el procesamiento.
## Conviene saber
El original no cambia hasta que uses la acción normal de Guardar. La IA puede inventar detalles; revisa las imágenes importantes. La CPU funciona sin una GPU compatible y puede tardar más. Se limita el tamaño del resultado para proteger la memoria. Si falta un paquete, se abre Almacenamiento de la aplicación; nunca se descarga sin que lo elijas.
Consulta también: "Paquetes de IA y hardware" y "Editar imágenes".
```
help/en/ai-packs-hardware.md:
```markdown
# AI packs and hardware
Local AI packs add optional tools that run on this computer.
## How to use them
Open **Settings > Local AI** to enable a feature and inspect the recommended model size. Open **App storage** to install or remove its pack. Choose **Automatic**, **CPU** or **GPU** for processing. Installed models unload after inactivity.
## Good to know
Installing a pack uses the internet only for that download. Processing does not send your files online. Memory needs vary by task; larger models are not always faster or better. Turning local AI off stops its jobs. Locked files cannot use a task that needs an unencrypted temporary copy.
See also: "AI upscaling" and "Installing and removing packs".
```
help/es/ai-packs-hardware.md:
```markdown
# Paquetes de IA y hardware
Los paquetes de IA local agregan herramientas opcionales que se ejecutan en este equipo.
## Cómo usarlos
Abre **Configuración > IA local** para activar una función y revisar el tamaño de modelo recomendado. Abre **Almacenamiento de la aplicación** para instalar o quitar su paquete. Elige **Automático**, **CPU** o **GPU** para procesar. Los modelos se descargan de la memoria tras la inactividad.
## Conviene saber
Instalar un paquete usa internet solo para esa descarga. El procesamiento no envía tus archivos a internet. La memoria depende de la tarea; un modelo más grande no siempre es más rápido o mejor. Desactivar la IA local detiene sus tareas. Los archivos bloqueados no pueden usar una tarea que necesite una copia temporal sin cifrar.
Consulta también: "Ampliar imágenes con IA" e "Instalar y quitar paquetes".
```

Append AIupscaling bilingual Seealso links to14b editing-images and08a converting-images pages; no savebehaviorchange.

## Check by hand

Coordinatorcreates syntheticfixtures in%TEMP%/Adperastra-step14c/,notGit;recordgeneratorprovenance/hashes,nomodelweights/personalpictures.

| Path | Exact content |
|---|---|
|grid.png|1000x500RGBA;lefthalfred(255,0,0,255),rightblue(0,0,255,255);1pxwhitehorizontallines every50pixels|
|alpha.png|257x257RGBA;opaqugreen squarex/y64..192inclusive,otherRGBA0,0,0,0|
|large.png|2501x2500uniformRGB128;4xfails100MPbeforeinference|
|locked sample|gridinside09ktestcontainer;normalunlock;sensitiveartifactsRAMonly|

1. Withoutpack,buttonexplainsneed/opensstorage/no download. Enable/installverifiedpackthroughnormalUI.
2. Previewcenter/edge;CPU/GPU2x/4xdimensions,seams/alpha. Previewclean;ApplyoneUndo;editduringpreviewmakesApplyfailchanged.
3. Savecopy/batch100/cancel/removeinusepack/offline/GPUmissing. Sourcehash/foreignoutputunchanged;packremovalpendinguntiljobdone.
4. Spanishdark/pseudo,keyboard,Narrator,200%/300%zoom:labels/focus/noclip/Cancelreturnfocus/honestETA. Coordinatorrunsactualnetwork/outsidefilecanaries.

## Speed

Coordinatoradds scripts/measure-ui.mjs rows;seven-runmedians in docs/benchmarks/step14c-ai.json withmodelhash/device/machine/coldwarmseparate. Noresultsinvented. step14c.dialog-open Instant100ms;step14c.crop-preview Waiting<=10s aftermodelready,coldloadseparate;step14c.cancel-feedback Instant100ms;step14c.foreground-browse-during-upscale Fast1s and<=20%regression;step14c.full-upscale Background/progress/ETA/Cancel. CPUpreviewmiss is recordedissue, notsilentlyrelabeledpassing.

## Screenshots

156-ai-upscale-preview,157-ai-hardware-packs,158-ai-upscale-job under docs/screenshots/step-14c/,eachEnglishlight/Spanishdark/pseudo1200x900 plus300%layout. Actualpackagedviews only.

## Done when

- [ ] RealCPU/GPUhelper/signedinventories/cancel/idle/networkandfiledenial evidencepasses;nofakehash/placeholder.
- [ ] Two/fourfoldcrop/full/batch outputpreservessource/alpha/metadatapolicy;tiles/seamsbounded;revision/Apply/Undocorrect.
- [ ] Typedfuturecapabilitiesunavailablehonestly;schema41/storage/missingpack/bilingualhelp/accessibilitychecked.
- [ ] Coordinatorgate/package/benchmarks/report/KNOWN_ISSUESdone;unresolvedBlocker/Majorpreventsrelease. Guidecompletionisnotimplementationcompletion.
