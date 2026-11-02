# Coding assignment: step 12b — Converter 3 (media, documents), privacy cleaner 2

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-12b.md](../steps/step-12b.md). Guide SHA-256: `e702dcf4a75020b3305ddf89c62a73fe31e134957e2488b5aa06545ef6f4f6e8`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 4/5 |
| Branch | step-12b-engine-adapters |
| Tag | v0.2.5-step12b |
| Depends on | 08a conversion-2/export-snapshot-2;08c privacy-1;12a packs-1 |
| Written before | 07a was built |
| Interface revision | engines-2;media-probe-2;office-render-2;engine-session-1 |

Settings reservation: 37 -> 37; screenshot reservations: 144-146. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 08a producer guide](../steps/step-08a.md)
- [Step 08c producer guide](../steps/step-08c.md)
- [Step 12a producer guide](../steps/step-12a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Dependencies and exports

| Ref | Producer/task/canonical file/revision | Exact use |
|---|---|---|
| U1 | 08a E1/E2/E4-E7; convert/types.ts,registry.rs; conversion-2 | ConverterSpec/ConvertOptions/ConversionInput/ExportSnapshot/WorkItemResult/ConversionReport and shared runner; adapters never publish user files themselves |
| U2 | 08c E1/E2; privacy/types.rs,registry.rs; privacy-1 | PrivacyAdapter inspect/clean and explicit coverage/content flags; only extend registered categories |
| U3 | 12a T1-T3 E1/E2; packTypes.ts,packs.rs; packs-1 | Packs.acquire(id,capability)->PackLease; entrypoint resolves verified immutable version, retained through job |
| U4 | 07a E1/E3; cache.rs; preview-foundation-1 | SourceStamp/CacheLease, provider version includes engine and options; cache excludes sensitive inputs |
| U5 | 06d jobs/helpers; baseline | JobContext/CancellationToken/OpProgress; EngineHost adds confinement rather than equating job limits with security |

Canonical TS `src/services/engineTypes.ts`, Rust `src-tauri/src/engine_types.rs`; native-only process types `engine_process.rs`. TS fields snake_case. No executable paths or unbounded raw JSON returned to UI.

| Type | Exact fields |
|---|---|
| TimeUs / FrameRate | u64 safe integer >=0 / {num:u32,den:u32}, reduced positive rational |
| EngineId | media/office |
| EngineCapability | id string<=64; available bool; version string<=64; reason nullable packs_missing/unsafe_build/sandbox_failed/unsupported |
| MediaStream | indexu32; kind video/audio/subtitle; codec string<=64; width/height optionalu32; frame_rate optionalFrameRate; sample_rate optionalu32; channels optionalu8; language optionalBCP47string<=32 |
| MediaTag | key string<=128; value string<=4096; category MetadataCategory |
| DiskConversionInput | imported08a ConversionInput file variant only; native validates kind=file, absolute path/expectedstamp; snapshots refused engines.unsupported for probe/preview because MediaInfo reports disk SourceStamp |
| MediaInfo | source SourceStamp; duration_us TimeUs; streams MediaStream[]<=64; tags MediaTag[]<=512; format string<=64 |
| MediaPreview | lease CacheLease; duration_us TimeUs; mime string; source_revision safe integer fixed1 for these disk-only previews; no executable URL. UI generation IDs suppress superseded requests; SourceStamp cache identity still governs invalidation |
| OfficeFormat | docx/xlsx/pptx/odt/ods/odp/rtf/doc/xls/ppt/potx/otp; canonical here, imported by13/20a. potx/otp are reserved template-inspection inputs22a/22b only, not advertised editable/render handlers in12b/13 |
| OfficeRenderRequest | input ConversionInput; target pdf/html/txt; format OfficeFormat; include_comments bool true; include_notes bool false; ranges PageRange[]; no external_links/macros fields that can enable them |
| EngineInput | native input_index u32; original ConversionInput; stamp optionalSourceStamp; guarded source enum Disk(PinnedSource)/Snapshot(SnapshotLease); sensitive bool determined natively. Holds original authorization until the copied source and resulting output are validated; no lease is serialized into a UI request |
| EngineRequest | native tagged probe_media(inputs EngineInput[] exactly1),preview_media(inputs exactly1,options MediaConversionOptions),convert_media(inputs1..1000,converter_id ConverterId,output_format FormatId,options MediaConversionOptions),render_office(inputs exactly1,options OfficeRenderRequest); shared request_id UUID; timeout_ms u64 within D4; owned work_dir PinnedDirectory; no shell text |
| EngineOutput | native output_id UUID; relative_name validated basename; mime bounded128; byte_len u64; content_hash_sha25664hex; owned_output OwnedOutput. Never a UI-selected path; parent validates and publishes |
| EngineResult | native exit_code i32; outputs Vec<EngineOutput> <=256; bytes_written u64; metadata_lost Vec<MetadataCategory>; stderr_codes stable enum[]<=64 |
| OfficeRenderedArtifact | native output EngineOutput; section_id ASCII<=64; format pdf/html/txt; page_count u32<=10000. IDs document/sheet:<zero-based-index>/slide:<zero-based-index>; ordering follows source |
| RenderedOffice | native artifacts Vec<OfficeRenderedArtifact> <=1000; engine_version String<=64; source_revision u64 safe; revision is input snapshot revision or1 for an unedited disk source |

| Ref | Export; exact signature | Consumers |
|---|---|---|
| E1 | services/engines.ts engineCapabilities()->Promise<EngineCapability[]>; native engines_capabilities | Missing-pack UI13/15/19/20a |
| E2 | services/mediaEngine.ts probeMedia(input:DiskConversionInput)->Promise<JobHandle<MediaInfo>>; previewMedia(input:DiskConversionInput,options:MediaConversionOptions)->Promise<JobHandle<MediaPreview>> |15/19, Details; native media_probe_start/media_preview_start(request_id,input,options) |
| E3 | native engine_process.rs EngineHost.run(request:&EngineRequest,context:&JobContext)->Result<EngineResult,String> | One confined lifecycle for12b/13/15/19; pack lease/inputs/output owned until terminal state |
| E4 | native office_render.rs render_office(request:&OfficeRenderRequest,context:&JobContext)->Result<RenderedOffice,String>; RenderedOffice has owned PDF/HTML/text outputs,engine_version,source_revision |13 accurate read-only renderer; no editing commands |
| E5 | services/mediaEngine.ts TimeUs/FrameRate/MediaInfo/MediaPreview reexports |15/19 must import these exact types |

### E6: native conversion dispatch with the shared pure output sink

Canonical native `src-tauri/src/engine_conversion.rs` exports run_engine_conversion(host:&EngineHost,request:&ConversionRequest,inputs:Vec<EngineInput>,output:&mut dyn convert::ConvertOutputSink,context:&JobContext)->Result<convert::PreparedOutput,convert::ConvertError>. It borrows host/sink/context only for this synchronous blocking-worker invocation and owns inputs until source/output verification completes. At most1000 inputs per combine invocation; each mode follows08a. Source caps32GiB media/512MiB Office, output total32GiB media/1GiB Office, timeouts D4, cancellation inherited from JobContext. EngineHost adds no Tauri dependency to the pure convert crate.

The parent08a dispatcher resolves/guards authorized inputs once, then selects this native branch only for registered engine_id media/office; all other converters keep08a's pure helper route. The coordinator adds this one dispatch branch in native convert.rs; no UI component invokes engines. Request validation/naming/loss acknowledgement/report/history/publication remain08a's runner. This function calls EngineHost.run, validates each owned EngineOutput against expected format/hash/length and input association, rewinds OwnedOutput.file_mut() to byte0, then passes OutputDraft/name_part and1MiB chunks through the same borrowed ConvertOutputSink begin/write/finish/abort interface. It never calls publish_name/publish_to on EngineOutput and never writes the user's destination directly. Sink.finish performs common08a final warning/metadata/identity/no-replace checks before publication. Drop/dispose only engine-owned temporary outputs after copy or failure. A later failure preserves actual earlier sink outputs for08a's normal partial report; PreparedOutput counts only accepted finished outputs.

For12b registered media/office converter specs, input_mode is exactly each: one EngineInput and exactly one output per invocation; batch inputs are separate08a invocations in their original order. More or fewer engine artifacts fail before sink.begin. EngineSession.render_document is a separate read-only viewer API and does not change this conversion cardinality. Construct OutputDraft with name_hint=EngineOutput.relative_name (display only), name_part=none, mime=the independently detected expected output MIME and input_indices=[EngineInput.input_index]. Parent08a derives the actual final name; no engine path is trusted as a destination. Build OutputMetadata.byte_len/hash_sha256 from the verified owned file, width/height from independent image/video probe or None for documents/audio, metadata_lost from the independently verified source/output comparison, and warnings from the required typed warning analysis for that exact input/options. The latter must include every observed loss, match the preview/acknowledgements and refuse unexpected unaccepted changes before publication. One successful finished output returns PreparedOutput outputs_count1; totals and warning/loss unions come from that verified metadata. Missing/extra output, MIME mismatch or failed source/output inspection aborts the borrowed sink and never creates a success receipt. EngineResult metadata/stderr are evidence to check, not sufficient authority to declare preservation.

crates/convert/src/media_adapter.rs contains only media_converter_spec(id:ConverterId,available:bool,preserves:&[MetadataCategory])->Result<ConverterSpec,ConvertError> and validate_media_options(options:&MediaConversionOptions)->Result<(),ConvertError>. It imports pure08a types only; EngineCapability/EngineHost/EngineInput/OwnedOutput/JobContext remain native. Native code supplies audited availability and preservation lists. There is no convert-to-Tauri dependency, copied shared type or fictitious pure Converter implementation that secretly launches an engine.

The later19b E6 reserves the additive EngineRequest tag render_timeline and the native TimelineEngineRenderRequest/TimelineEngineSource/ValidatedRenderGraph types owned by19b.12b does not compile against future modules or offer that capability.19b integration extends this enum and EngineHost dispatch together through the coordinator; a graph cannot be smuggled into convert_media options. All existing engine variants and constraints remain unchanged.

### E7: fixed persistent confined Office read sessions

12b T2 implements the native actor/transport below in `src-tauri/src/engine_sessions.rs`, `engine_session_types.rs` and `engine_session_protocol.rs`;13 T3 implements the pack-owned C++ bridge for this exact protocol. Until a verified signed Office pack advertises capability/entrypoint `office_read_bridge`, start_session returns engines.pack_missing; never launch a placeholder or an unrestricted process. Office engine remains replaceable and out of the Rust core.20a editing is a separately approved engine binding, not access to a read-session mutation method.

| Native export/type | Exact fields/signature and lifetime |
|---|---|
| EngineSessionStart | protocol enum fixed office_read_v1;max_documents u8 fixed4;idle_seconds u16 fixed60;memory_bytes u64 fixed1073741824. Native trusted caller only; serialized pack wire does not accept paths/program arguments |
| EngineHost::start_session | (&self,start:EngineSessionStart,context:&JobContext)->Result<EngineSession,String>; off UI thread; acquire/retain12a PackLease office/office_read_bridge, same AppContainer/no-network/private-root policy D2.60s startup/30s heartbeat. One Office actor process tree globally, bounded32queued commands, serial per actor; no duplicate pool launcher |
| EngineSession | Native owner of confined child/job/PackLease/private work/profile directories, serialized pipe endpoints and document map. No Serialize/Clone;13 stores one Arc<Mutex<EngineSession>> and enqueues work outside UI/global locks; max4open readonly docs, keep input authorization/owned source copy until close_document |
| EngineReadSection | id ASCII1-64;name escapedString<=255;kind document/sheet/slide;index u32zero-based;page_count u32<=10000. IDs document/sheet:<zero-based-index>/slide:<zero-based-index> |
| EngineReadDocument | document_id UUID;format OfficeFormat;source_revision safeu64;source_content_id Option<Uuid> for snapshot;sections Vec<EngineReadSection>1-1000;engine_version String<=64. Source identity derives from native input, not bridge-selected timestamp |
| EngineSession::open_document | (&mut self,input:EngineInput,format:OfficeFormat,context:&JobContext)->Result<EngineReadDocument,String>; owns input; source copy/preflight D3/D7; refuses sensitive before any spool;60s deadline; refuses fifth live document as engines.busy without silently closing a retained document |
| OfficeSessionRenderRequest | document_id UUID;target pdf/html/txt;section_ids Vec<String>1-256 from EngineReadDocument; ranges Vec<PageRange>max1000;include_comments bool;include_notes bool fixedfalse for13 audience/ordinary view; no source/destination path |
| EngineSession::render_document | (&mut self,request:&OfficeSessionRenderRequest,context:&JobContext)->Result<RenderedOffice,String>;120s deadline,30s heartbeat,<=256artifacts/call and1GiBtotal output. Parent validates own temporary artifacts before exposing EngineOutput handles; subsequent calls may select remaining sections |
| EngineSession::close_document | (&mut self,document_id:Uuid,context:&JobContext)->Result<(),String>; idempotent unknown;5s deadline then terminate whole actor on hang. Close read-only UNO document, release that original EngineInput and owned source/output copies only |
| EngineSession::close | (&mut self)->Result<(),String>; idempotent, requests graceful close then kills process tree after250ms and waits; Drop invokes termination; releases PackLease only after child death. No user files removed |

The actor checks context cancellation/deadline before admission and between bounded units. Cancellation/death/invalid wire kills the actor within250ms, marks all its document handles unusable and returns engines.cancelled/changed/failed; retained cached read-only pages may remain visibly labeled, but new reads require normal reopen. Closing the final document starts60s idle expiry; reopening before expiry cancels that timer.13 may explicitly close a no-longer-leased oldest read-only document before a fifth open; never evict an active lease. Mutex ownership protects one call, not the UI; worker queue has explicit bounded admission and no global application lock across I/O.

Native pack protocol is framed kind u8+length u32LE, control JSON<=768KiB, no file bytes in JSON. Parent exclusively writes kinds1request/4cancel; child kinds2reply/3heartbeat, each stable exact envelope below. Unknown kind/ID/variant, duplicate reply, trailing bytes, cap violation, wrong document or absent heartbeat terminates actor. Existing EngineHost AppContainer launcher owns binary pipes; do not use ordinary HelperProcess as a sandbox. Child stdout is protocol only; bounded diagnostics on stderr are stable codes, not document text.

| Wire type | Exact serializable fields |
|---|---|
| EngineSessionRequest | protocol_version1;request_id UUID;command EngineSessionCommand |
| EngineSessionCommand | tagged open {document_id:UUID,input_name:validatedbasename<=255,format:OfficeFormat,source_revision:safeu64,source_content_id:optionalUUID}; render {request:OfficeSessionRenderRequest}; close_document {document_id:UUID}; close {}. input_name is a parent-owned private input copy, resolved under fixed job input root; child never receives user's source path |
| EngineSessionReply | protocol_version1;request_id UUID;result tagged opened {document:EngineReadDocument}, rendered {artifacts:Vec<EngineSessionArtifact>max256}, closed {} or error {code:fixed engines error}. Native parent checks IDs/format/source_revision/content_id against its retained input |
| EngineSessionArtifact | relative_name validatedbasename<=255 under fixed private output root;section_id ASCII<=64;format pdf/html/txt;page_count u32<=10000;mime String<=128;byte_len safeu64<=1GiB;sha256 String64lowerhex. Parent rejects reparse/hardlink/foreign identity and unexpected artifacts, copies only validated completed data into OwnedOutput, then constructs RenderedOffice; wire never contains OwnedOutput or a user destination |
| EngineSessionHeartbeat | protocol_version1;request_id UUID;completed_units safeu64;total_units optional safeu64>=completed_units; no text/source data |
| EngineSessionCancel | protocol_version1;request_id UUID; no document mutation semantics |

The13 pack bridge uses the pinned SDK and fixed UNO read operations from13 D3 only. Named pipe endpoint, if used between that bridge and LibreOffice, is private to the AppContainer SID/current process tree; no network socket, public listener or arbitrary UNO method from UI. Runtime pack version/hash/protocol support are checked before capability activation. Build/interop evidence belongs coordinator, not guide authoring.

### E8: typed media warning extension

This step extends canonical08a ConversionWarningCode with audio_loss and frame_rate_change, preserving all existing codes and limits. Matching locale keys convert.audioLoss = “Audio will not be included in this output.” / “El audio no se incluirá en este archivo.”; convert.frameRateChange = “The frame timing will change in this format.” / “El ritmo de los fotogramas cambiará en este formato.” Native/UI import the same enum. GIF requires audio_loss when an audio stream exists, palette_reduction when quantization changes colors, transparency_loss when nonbinary alpha cannot be preserved, and frame_rate_change when source timestamps cannot be represented exactly in GIF's10ms units. Include actual required codes in preview and request accepted_warning_codes; missing acknowledgement fails convert.warning_required before output.begin. Never treat MetadataCategory[] as consent for these visible/audible changes. T4 adds extension/translation wiring through coordinator and tests audio_without_ack_zero_output_begin, gif_fractional_alpha_requires_ack, gif_33333us_requires_frame_rate_change, gif_20000us_exact_timing and unknown_warning_refused.

Errors engines.bad_request/pack_missing/unsafe_build/sandbox_failed/sensitive_unsupported/busy/timeout/unsupported/changed/cancelled/failed; map capabilities to explicit reason. All native public commands ensure_main/validate/allowlist; runJob result is completion.

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; commit | Files/work in order; dependencies | Tests named: inputs -> oracle |
|---|---|---|
| T1; `docs(packs): freeze reviewed engine build inputs [step-12b/T1]` | Coordinator-only pack production recipes/inventory/catalog artifacts; worker writes manifest validation/tests and exact integration proposal; U3. | reject_gpl_build: enable-gpl -> unsafe_build; unknown_binary_hash: mismatch -> no process; missing_real_artifact: unavailable, no placeholder success |
| T2; `feat(engines): confined process lifecycle [step-12b/T2]` | engine_process.rs,engine_security.rs,engine_io.rs,engine_sessions.rs,engine_session_types.rs,engine_session_protocol.rs; E3/E7, private ACL roots/no network/bounded channels. | sandbox_canary_denied: outside file/network -> denied; argument_unicode_single_value; cancel_kills_descendants; stderr1MiBplus -> bounded failure |
| T3; `feat(media): bounded probe and sample previews [step-12b/T3]` | media_probe.rs,media_preview.rs,services/mediaEngine.ts; E2/E5. | probe65streams -> too_large; trim_samples: start1us/end1000001us at48000 -> samples1..48000 inclusive; stale_sample_revision_ignored |
| T4; `feat(convert): media engine adapters [step-12b/T4]` | crates/convert/src/media_adapter.rs,src-tauri/src/media_arguments.rs,engine_conversion.rs; U1/E3/E6/E8; coordinator single native08a dispatch branch. | options_never_become_shell; no_pack_no_conversion; cancelled_export_keeps_original_and_foreign_destination; metadata_default_keep |
| T5; `feat(convert): isolated Office render adapters [step-12b/T5]` | office_render.rs,office_profile.rs,office_preflight.rs; E4/E7/U1; one-shot render remains E4,13 warm actor consumes E7. | macros_never_execute; external_relationship_refused; source_hash_unchanged; exit0_without_pdf_fails; sensitive_snapshot_never_spooled |
| T6; `feat(privacy): selective Office media archive cleaning [step-12b/T6]` | privacy/office.rs,media.rs,archive.rs; U2; inspect/select/clean/reinspect. | comments_need_content_ack; tracked_insert_kept_deleted_text_removed; keep_unselected_author; unverified_vendor_tag_no_clean_claim |
| T7; `docs(help): media document conversion and privacy [step-12b/T7]` | Three help pages below, coordinator registry/keys/pseudo/IPC/license updates and executed acceptance. | media_missing_pack_card; conversion_uses_shared_registry; review_roundtrip_and_network_denial_corpus |

## Exact file and test allocation

Feature-owned roots: src-tauri/src/engine_*.rs,media_{probe,preview,arguments}.rs,office_{render,profile,preflight}.rs; src/services/{engineTypes,engines,mediaEngine}.ts; crates/convert/src/media_adapter.rs; crates/privacy/src/{office,media,archive}.rs. Bare filenames in a task expand inside its feature root; native filenames mean src-tauri/src/ unless an explicit crate path is given. The coordinator owns shared App/Explorer/main, settings schemas, manifests/lockfiles, command/handler/IPC registries, generated locales and asset wiring; workers submit exact insertions rather than editing those shared files. Helpers use the producer's fixed entry/action registry through coordinator integration.

Place every named test in task Tn in the corresponding file below. Rust test modules with private feature access are attached by the owning native module; they are not a fictitious standalone src-tauri library. The listed assertions remain unchanged when split into smaller test files.

|Task|Exact test file|
|---|---|
|T1|src-tauri/src/engine_build_step12b_tests.rs|
|T2|src-tauri/src/engine_security_step12b_tests.rs and engine_session_step12b_tests.rs|
|T3|src-tauri/src/media_probe_step12b_tests.rs|
|T4|crates/convert/tests/step12b_media.rs and src-tauri/src/engine_conversion_step12b_tests.rs|
|T5|src-tauri/src/office_render_step12b_tests.rs|
|T6|crates/privacy/tests/step12b_clean.rs|
|T7|src/__tests__/step12b-ui.test.tsx|

E7 exact tests in engine_session_step12b_tests.rs: four_documents_then_fifth_busy; retained_pack_blocks_remove; cancel_kills_actor_invalidates_all_documents; idle60s_after_last_close; unknown_wire_variant_terminates; copied_source_identity_checked; rendered_artifact_reparse_refused; source_path_never_on_pack_wire. E6 native tests: sink_receives_same_name_part_and_metadata; engine_each_two_artifacts_zero_sink_begin; engine_reported_preservation_independently_rechecked; engine_output_never_publishes_itself; failed_second_output_preserves_actual_first; missing_warning_zero_sink_begin; pure_convert_has_no_native_import. Workers write these tests and fixtures but do not execute any command, install, compile, generate assets or claim results. Coordinator runs targeted checks, complete gate/package, real parser/process/file-safety tests and manual evidence. A mock is not evidence of native confinement, interoperability or performance.

## Coordinator commit labels (workers do not commit)

- docs(packs): freeze reviewed engine build inputs [step-12b/T1]
- feat(engines): confined process lifecycle [step-12b/T2]
- feat(media): bounded probe and sample previews [step-12b/T3]
- feat(convert): media engine adapters [step-12b/T4]
- feat(convert): isolated Office render adapters [step-12b/T5]
- feat(privacy): selective Office media archive cleaning [step-12b/T6]
- docs(help): media document conversion and privacy [step-12b/T7]

## Required handoff

Return `handoff/step-12b/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-12b/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
