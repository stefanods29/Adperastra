# Coding assignment: step 19b — Video timeline: effects, audio, export

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-19b.md](../steps/step-19b.md). Guide SHA-256: `51c90a6ee1aaf5f7f20a539184a2254904e6fac349cfeb9c6aaaf679ee74fdfc`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

|Field|Value|
|---|---|
| State | guide; documentation reviewed; implementation not started |
|Difficulty|5/5|
|Branch|step-19b-timeline-export|
|Tag|v0.5.4-step19b|
|Depends on|19a timeline-project-1/timeline-render-1;12b engines-2;08a conversion;08b fonts/PDF|
|Written before|07a was built|
|Interface revision|timeline-effects-1;timeline-export-1|

Settings reservation: 49 -> 49; screenshot reservations: 182-183. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 08a producer guide](../steps/step-08a.md)
- [Step 08b producer guide](../steps/step-08b.md)
- [Step 12b producer guide](../steps/step-12b.md)
- [Step 14b producer guide](../steps/step-14b.md)
- [Step 15 producer guide](../steps/step-15.md)
- [Step 16 producer guide](../steps/step-16.md)
- [Step 19a producer guide](../steps/step-19a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses/types/exports

|Ref|Producer/task/file/revision|Exact use|
|---|---|---|
|U1|19a T1-T6 E1-E6;timeline/types.ts/renderPlan.ts/transactions.ts;timeline-project-1|TimelineProject/Clip/Effect/Transition/Title/RenderPlan,TimeUs,normalizeTimeline/commitTimelineTransaction/frameTime/clipSourceTime;canonicaldefinitionsnevercopied |
|U2|12b E1-E5;engineTypes.ts/mediaEngine.ts/engine_process.rs;engines-2|Capabilitylist,MediaInfo/probe,confinedEngineHostandprogress/cancel;actualbuildsupportrequired |
|U3|08a E2/E4-E7;convert/types.ts/exportSnapshots.ts;conversion-2/export-snapshot-2|ConversionRequest/Report/ConversionWarningCode, immutable snapshot content_id,ownedmulti-output/history; nativeexportfilesnotrawsnapshotpayload |
|U4|15 subtitletypes;08b fontassetmanifest;14b D5math|Samecue/time/coloralgorithms;licensedfontbytesonly,no guessedassetpath |

Canonical new `src/timeline/effectTypes.ts`, native `timeline_render_types.rs`;existingprojecteffecttypesremain19a/types.ts.

|Type|Fields|
|---|---|
|TimelineEffectOperation|set_effects(clip_id,effectsTimelineEffect[]<=64),set_transition(transitionTimelineTransition|null,left_id,right_id),set_title(titleTimelineTitle),remove_title(id),set_track_audio(id,gain,mute,solo),set_clip_audio(id,gain,mute,solo,fade_in_us,fade_out_us),set_subtitles(cuesMediaSubtitleCue[]);validatedatomic |
|FrameContribution|clip_id/source_idUUID;source_usTimeUs;opacityfinite0..1;crop/rotation;effectsreadonlyTimelineEffect[];z_orderu16;titleoptionalTimelineTitle |
|AudioContribution|clip_id/source_id;source_sampleu64safeinteger;gainfinite0..16;channels1/2;enabled bool |
|TimelineExportRequest|project_snapshot ExportSnapshot;dest_dir absolute;file_namevalidatedbasename;container webm/mkv/mp4/flac/wav/mp3;video_codec12btypedvalue;audio_codec12btypedvalue;width/heightpositive<=8192;frame_rateFrameRate;bitrate_kbpsoptional8..1000000;metadata_keeptrue;subtitle_modeoff/burn/sidecar;accepted_losses MetadataCategory[];accepted_warning_codes ConversionWarningCode[]required,unique,max64 |
|TimelineExportPreview|frame CacheLease;sample nullableCacheLease;duration_usTimeUs;estimated_bytesnullableu64;warnings ConversionWarningCode[]unique<=64;captured_revision/content_id |
|RenderNode|Discriminated union: source(id UUID,source_id UUID,stream_index u32);trim(id,input UUID,start_us,end_us);speed(id,input,rate PlaybackRate);geometry(id,input,crop nullableMediaCrop,rotation,output_width/output_height);color(id,input,effects TimelineEffect[]);transition(id,left/right UUID,transition TimelineTransition);title(id,input,title TimelineTitle);audio_gain(id,input,gain0..16,fade_in_us,fade_out_us);audio_mix(id,inputs UUID[]<=128);subtitle(id,input,cues MediaSubtitleCue[]);concat(id,inputs UUID[]<=10000);encode(id,video_input nullableUUID,audio_input nullableUUID,container/video_codec/audio_codec from TimelineExportRequest). Every reference points to an earlier node; no cycles or executable strings |
|ValidatedRenderGraph|nodes RenderNode[]<=100000;edges {from UUID,to UUID,port video/audio}[]<=200000;duration_us TimeUs. Constructor validates node/reference kinds, encoder capability and1MiB wire limit; no arbitrary JSON option maps |

|Ref|Exact export/signature|Consumers|
|---|---|---|
|E1|timeline/effects.ts applyTimelineEffect(documentId:string,expectedContentId:string,operation:TimelineEffectOperation)->Promise<void>|19bUI;delegates19aE4onecommit |
|E2|timeline/resolveFrame.ts resolveTimelineFrame(plan:Readonly<TimelineRenderPlan>,timeUs:TimeUs)->readonlyFrameContribution[]|Preview/exportsamepurefunction;timeoutsideprojectreturns[] |
|E3|timeline/audioMix.ts resolveAudioMix(plan:Readonly<TimelineRenderPlan>,timeUs:TimeUs)->readonlyAudioContribution[]|Previews/rendergainandmute/solosemanticsD5 |
|E4|services/timelineExport.ts previewTimelineExport(request:TimelineExportRequest)->Promise<JobHandle<TimelineExportPreview>>;exportTimeline(request)->Promise<JobHandle<ConversionReport>>|Native timeline_export_preview_start/timeline_export_start(request_id,request);validatesallfields/leasesandsharedreports |
|E5|timeline/graph.ts buildRenderGraph(plan:Readonly<TimelineRenderPlan>,request:TimelineExportRequest,capabilities:readonlyEngineCapability[])->ValidatedRenderGraph|Throws stable timeline_export errors on invalid/oversized graph; fixed RenderNode union above; trusted app graph builder, natively revalidated before process launch |

### E6: typed clipping warning and exact native timeline engine extension

19b T6 additively registers audio_clipping in canonical08a ConversionWarningCode in Rust/TS, preserving all08a/12b codes. Its text key is the existing timelineEffects.clipping row below, exactly “Some mixed audio may clip. Review levels before exporting.” / “Parte de la mezcla puede saturarse. Revisa los niveles antes de exportar.” It appears in TimelineExportPreview.warnings and accepted_warning_codes; absence when D5 requires it fails convert.warning_required before any output.begin. This is a fixed enum extension, not arbitrary diagnostic prose.

19b T5 owns `src-tauri/src/timeline_render_types.rs` and `timeline_engine.rs`. Native ValidatedRenderGraph/RenderNode mirror the exact TypeScript fields and limits above, with serde unknown-field refusal and a native validator that independently checks node kinds, ports, ranges, source/stream identities and earlier-node references. A native constructor is the only path to a validated graph; deserializing a struct named ValidatedRenderGraph alone is not proof of validation. TimelineEngineSource is native-only {source_id:Uuid,input:EngineInput}; source_id maps each19a source UUID to its authorized pinned disk input, never to a UI path. TimelineEngineRenderRequest is native-only {sources:Vec<TimelineEngineSource>1..10000,graph:ValidatedRenderGraph}; source IDs are unique and every source node must resolve exactly one matching input/probed stream.

At19b integration the coordinator additively extends12b EngineRequest with tagged render_timeline {request:TimelineEngineRenderRequest}, retaining its common request_id/timeout_ms/work_dir, and adds the single EngineHost dispatch branch.12b reserves this name but does not depend on the future19b module or advertise timeline rendering before this integration. Native `timeline_engine.rs` exports run_timeline_engine(host:&EngineHost,request:TimelineEngineRenderRequest,context:&JobContext)->Result<EngineResult,String>; it owns source leases through terminal state, validates the request (aggregate unique input bytes<=32GiB before any copy), prepares guarded owned source copies under12b policy and dispatches that exact render_timeline branch. The branch uses the audited media pack with a fixed typed RenderNode-to-filter translation, no user strings as filter expressions, shell command or process path. Unknown/unsupported node/filter/encoder returns engines.unsupported before engine launch. EngineHost applies the same confinement, one-heavy-job, resource, heartbeat and cancellation policy as12b. All19b sources are disk MediaSource records; sensitive input is refused before any spool under12b D3.

The engine returns exactly one verified owned primary media artifact through12b EngineResult; native timeline_export.rs independently probes duration/frame count/format/size/source identity and streams bytes plus verified OutputMetadata through the08a publication sink. Native sidecar SRT is a separate owned output, with actual successful paths reflected in08a ConversionReport, never an unreported file. No engine output publishes itself. If sidecar publication fails after primary publication, preserve/report the successful primary and truthful partial failure. Do not call12b run_engine_conversion with this graph or pretend ordinary media options encode tracks/transitions. Coordinator owns the EngineRequest/EngineHost shared edits; worker provides the exact additive branch proposal.

Errors timeline_export.bad_request/unsupported/changed/no_space/too_large/timeout/cancelled/failed/missing_glyph; allIPCensure_main/allowlist;rawrenderedbytesprotocolonly. Graphsourcesandoutputsareauthorizednativehandles/descriptors,notUI-selectedcommandpaths.

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## UI/text/commands/tasks

Existing19alayout;properties300pxaddsEffects/Audio/Titles/Subtitles,tabrow34;transitionhandles16pxminimumhittarget24;mixmetersnotcoloronly,numericgain/peaktext. ExportDialog760px,maxviewportminus32,leftpreviewmin320x180,righttypedoptions,warninglist/footerExport/Cancel;jobcardprogress/cancelindependentofdialog. `.adp-timeline-effect`padding12/gap8/tokenborder;titlecanvasselectionfocususesUItoken,documentcolorseparate. Keyboardnumerictransitionduration/titleposition,cueseditablegridrow28;noDragonlyrequiredaction.

|Keys|English|Spanish|
|---|---|---|
|timelineEffects.transitions / timelineEffects.crossfade / timelineEffects.dip / timelineEffects.wipe / timelineEffects.title|Transitions / Cross-fade / Dip to color / Wipe / Title|Transiciones / Fundido cruzado / Fundido a color / Barrido / Título|
|timelineEffects.color / timelineEffects.audio / timelineEffects.fadeIn / timelineEffects.fadeOut / timelineEffects.solo|Effects and color / Audio mix / Fade in / Fade out / Solo|Efectos y color / Mezcla de audio / Entrada gradual / Salida gradual / Solo|
|timelineEffects.subtitles / timelineEffects.export / timelineEffects.sample / timelineEffects.sidecar|Subtitles / Export timeline… / Preview sample / Separate subtitle file|Subtítulos / Exportar línea de tiempo… / Muestra de vista previa / Archivo de subtítulos independiente|
|timelineEffects.web / timelineEffects.phone / timelineEffects.high / timelineEffects.audioOnly|Web 1080p / Phone vertical / High quality / Audio only|Web 1080p / Vertical para teléfono / Alta calidad / Solo audio|
|timelineEffects.clipping / timelineEffects.captured / errors.timeline_export.failed|Some mixed audio may clip. Review levels before exporting. / Exporting captured revision {revision}. Later edits stay in the project. / This timeline export could not be completed.|Parte de la mezcla puede saturarse. Revisa los niveles antes de exportar. / Exportando la revisión capturada {revision}. Los cambios posteriores permanecen en el proyecto. / No se pudo completar esta exportación de línea de tiempo.|

Commands timeline.transition/title/effects/audio/subtitles/export,labelsabove,icons Blend/Type/SlidersHorizontal/Volume2/Captions/Download,no globalshortcut,helpbelow. Commoncancel/save/Undo reused;othererrorcodesmaptimeline_export.failedwithstablecode.

|Task;commit|Files/work;dependencies|Namedtests:input->oracle|
|---|---|---|
|T1;`feat(timeline): deterministic transitions and titles [step-19b/T1]`|effectTypes.ts,effects.ts,transitions.ts,titles.ts;U1/U4.|crossfade_midpoint_weights0.5/0.5;addD1s_shiftsright10sto9s;remove_restores10s;title_text_not_filtercode |
|T2;`feat(timeline): shared preview and export effects [step-19b/T2]`|resolveFrame.ts,colorEffects.ts,previewComposite.ts;U1/U2.|preview_export_same_source_time;unsupported_stabilize_refused;gamma1_identity;wipe_half_reveals_halfwidth |
|T3;`feat(timeline): exact audio mix and fades [step-19b/T3]`|audioMix.ts,audioRender.ts,AudioPanel.tsx;U1/U2.|mute_overrides_solo;solo_track_gatesothers;gain0.5xtrack0.5=>0.25;fade_midpoint0.5;mix2signals0.75=>clippingwarning |
|T4;`feat(timeline): plain subtitle editing and rendering [step-19b/T4]`|subtitleTimeline.ts,SubtitlePanel.tsx,subtitleFrames.ts;U4.|1000001us_start=>00:00:01,000;1000001us_end=>00:00:01,001;scripttext_notexecute;cueedit_oneUndo |
|T5;`feat(timeline): bounded render graph and native export [step-19b/T5]`|graph.ts,nativetimeline_export.rs,timeline_render_types.rs,timeline_engine.rs,services/timelineExport.ts;U2/U3/E6; coordinator exact EngineRequest render_timeline branch.|unknownnode_refused;sourcechanged_nopublish;cancel_preservesprioroutput;nativeoutput_over256MiB_notJSONsnapshot; graph_source_id_requires_authorized_input; unknown_filter_before_launch; timeline_variant_not_ordinary_media_convert; sidecar_failure_reports_primary |
|T6;`feat(timeline): reviewed presets and export dialog [step-19b/T6]`|ExportTimelineDialog.tsx,exportPresets.ts,effects.css;U1/U3/E4.|missingcodec_disabled_notfallback;captureR_latereditRplus1_exportR;export_notmarkprojectclean;metadata_default_keep; missing_required_warning_blocks_before_output_begin; conservative_gain_bound_requires_audio_clipping_ack; unaccepted_audio_clipping_zero_outputs |
|T7;`docs(help): timeline effects audio and export [step-19b/T7]`|Fourpagesbelow;coordinatorcanonicalClip.soloaddition/keys/wiring/renderQA.|project_roundtrip_effects_titles_cues;foregroundresponsive;alloptionskeyboard |

## Exact file and test allocation

Feature-owned roots: src/timeline/ effect/mix/render/export modules named in tasks; src/services/timelineExport.ts; src-tauri/src/timeline_{render_types,export,engine}.rs; src/styles/effects.css. Bare filenames in a task expand inside its feature root; native filenames mean src-tauri/src/ unless an explicit crate path is given. The coordinator owns shared App/Explorer/main, settings schemas, manifests/lockfiles, command/handler/IPC registries, generated locales and asset wiring; workers submit exact insertions rather than editing those shared files. Helpers use the producer's fixed entry/action registry through coordinator integration.

Place every named test in task Tn in the corresponding file below. Rust test modules with private feature access are attached by the owning native module; they are not a fictitious standalone src-tauri library. The listed assertions remain unchanged when split into smaller test files.

|Task|Exact test file|
|---|---|
|T1|src/__tests__/step19b-transitions.test.ts|
|T2|src/__tests__/step19b-effects.test.ts|
|T3|src/__tests__/step19b-audio.test.ts|
|T4|src/__tests__/step19b-subtitles.test.ts|
|T5|src-tauri/src/timeline_export_step19b_tests.rs|
|T6|src/__tests__/step19b-ui.test.tsx|
|T7|src/__tests__/step19b-help.test.ts|

Workers write these tests and fixtures but do not execute any command, install, compile, generate assets or claim results. Coordinator runs targeted checks, complete gate/package, real parser/process/file-safety tests and manual evidence. A mock is not evidence of native confinement, interoperability or performance.

## Coordinator commit labels (workers do not commit)

- feat(timeline): deterministic transitions and titles [step-19b/T1]
- feat(timeline): shared preview and export effects [step-19b/T2]
- feat(timeline): exact audio mix and fades [step-19b/T3]
- feat(timeline): plain subtitle editing and rendering [step-19b/T4]
- feat(timeline): bounded render graph and native export [step-19b/T5]
- feat(timeline): reviewed presets and export dialog [step-19b/T6]
- docs(help): timeline effects audio and export [step-19b/T7]

## Required handoff

Return `handoff/step-19b/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-19b/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
