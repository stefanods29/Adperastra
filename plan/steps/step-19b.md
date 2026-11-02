# Step 19b: Timeline effects, audio, subtitles and export

|Field|Value|
|---|---|
| State | guide; documentation reviewed; implementation not started |
|Difficulty|5/5|
|Branch|step-19b-timeline-export|
|Tag|v0.5.4-step19b|
|Depends on|19a timeline-project-1/timeline-render-1;12b engines-2;08a conversion;08b fonts/PDF|
|Written before|07a was built|
|Interface revision|timeline-effects-1;timeline-export-1|

Guide only; workers write code/tests, coordinator runs build/render/performance/output checks. No AI interpolation, generative effects, arbitrary filter graphs or unverified stabilization.

## Goal and reading

Add transitions/titles/color/crop/speed, mix audio, edit/import subtitles and export reviewed presets in a cancellable job. Read v1 step19b,19a complete frozenproject/types/timing,15 subtitle/waveform rules,12b capability/process/license policy,08a ownedmulti-outputreports/snapshots and08b licensedfontassetinventory. No newmediaUIengine.

## Decisions and algorithms

1. D1. Use19a canonical effect, transition and title types; enable operations only in this step. Each change delegates one commitTimelineTransaction with exact inverse/content_id. Preview and export both use normalizeTimeline followed by resolveTimelineFrame and resolveAudioMix. Unknown required effects refuse rendering/saving instead of disappearing.
2. D2. Transitions requiretwoadjacentclips onsameunlockedvideotrack, noexistingunrelatedoverlap. Durationpositive<=min(halfleftduration,halfrightduration,10s), andsumtransitionsononeclip<=clipduration. AddingdurationDmovesrightclipandlatertrackclipsearlierD,creatingDoverlap; changingDshiftsbydelta;removalrestoresgapfreeadjacencyandshift. Sourcein/outunchanged,lockedlinkedpartnersrefuseatomically. Titles/subtitleswithabsoluteprojecttimesdo notmoveimplicitly. Define transitioninterval[right.start,right.start+D),f=(time-right.start)/Dclamped0..1. Crossfade premultipliedlinearRGB left*(1-f)+right*f;dipleft->colorforf<0.5andcolor->rightafter;wipe revealsright fractionf fromchosendirection withpixelcenterthreshold,notrandomedge.
3. D3. Titles are text on a dedicated video track: <=1000 titles and10000 Unicode scalars each, with licensed font assets and validated19a style. No HTML/SVG. Animation is none/fade/slide. Fade alpha=min(1,elapsed/animation_us,remaining/animation_us), with0 meaning no animation. Slide moves linearly from off-screen left to the declared position during animation_us. Preview/export rasterize with the same font/version; missing glyphs fail. Text never becomes an executable filter expression.
4. D4. Apply ordered clip effects before transition composition. Brightness/contrast/saturation use14bD5; color maps each channel to v^(1/gamma). Crop/rotation use15 source coordinates. Speed changes19a source-time mapping rather than a pixel shader. Stabilization is enabled only after auditing a deterministic non-AI implementation/license in the actual pack; otherwise refuse projects requiring it. Optional noise reduction follows the same rule and never substitutes a model.
5. D5. Audio uses12b sample boundaries and the project48000Hz output rate. Gain=trackgain*clipgain*fadein*fadeout. Fades use clamp(elapsed/fade_us,0..1), with zero duration meaning1; combined fade lengths cannot exceed the clip. Mute always produces zero. If an unmuted track is soloed, only solo tracks qualify; if qualifying tracks contain an unmuted solo clip, only those clips qualify. Add TimelineClip.solo=false centrally. Sum float PCM then clamp[-1,1], showing a clipping warning; never normalize loudness silently. Require typed audio_clipping acknowledgement whenever a conservative enabled-gain bound exceeds1 for any overlapping interval, or independently sampled float PCM has abs(peak)>1. The bound sums abs(trackgain*clipgain) for all eligible overlapping clips and uses fade upper bound1; mute/solo eligibility remains exact. It may warn conservatively and never claims actual clipping from a bound alone. Preview/export share this exact rule.
6. D6. Import15 plain subtitle cues, ordered by start then ID, with start-inclusive/end-exclusive TimeUs. Overlaps are shown, not discarded. Limits100000 cues/4MiB/text8192 each. Each cue edit is one Undo. Burn app-rasterized text with licensed fonts; never run ASS commands or source resources. Optional SRT sidecar uses UTF-8/LF, numbered blocks, HH:MM:SS,mmm, start=floor(us/1000),end=ceil(us/1000). Publish it as an owned new output and report its actual path. No unapproved existing-file replacement.
7. D7. Presets: Web1080p=1920x1080 fit/pad VP9+Opus/WebM; Phone vertical=1080x1920 fit/pad VP9+Opus/WebM; High quality=project size verified VP9+FLAC/Matroska; Audio only=FLAC/WAV/verified MP3. Other codecs require actual12b capabilities; no silent format substitution. Preserve exact rational frame rate. Duration is the maximum end of clips/titles/cues, rounded up to an output frame. Keep metadata by default and disclose incompatible combinations. Required quality/audio/frame-rate/palette/layout warnings use08a ConversionWarningCode including12b additions audio_loss/frame_rate_change and19b audio_clipping, are listed and explicitly acknowledged in accepted_warning_codes before output.begin; unknown/unaccepted code fails convert.warning_required. Native export files may exceed256MiB; project snapshots remain <=16MiB.
8. D8. Export captures the immutable project revision/content_id, leases all source identities before starting and validates them again after reading. Build a bounded engine graph from the typed plan and fixed nodes/ports/constants. Limits:10000 clips,128 tracks,1MiB serialized graph,1GiB process memory,32 queued jobs and one heavy export. If the graph exceeds its byte/node budget, return timeline_export.too_large before launching or staging output; do not invent a lossy chunking strategy. Use12b EngineHost and08a owned output/progress/Cancel, then independently probe duration/frame counts before publication. Source changes/disappearance fail the affected output and preserve originals/prior outputs. Later edits do not change the captured export, and exporting does not mark the project clean.
9. D9. Keep settings schema49. Store effects, mix, cues and preset choice in19a project fields. Preserve its unknown-extension policy. Custom presets contain bounded typed options only, never executable filters, secrets or destination histories. Actual codec/build licenses must be reviewed before enabling features.

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

## Full help

timeline-transitions.md — English **Transitions and titles**: “Choose two adjacent clips and add Cross-fade, Dip to color or Wipe. Review its duration: overlapping clips shortens that track's timeline. Add a title with a licensed font and choose no animation, fade or slide. Preview uses the same timing as export. Undo reverses each completed edit. See also: Timeline effects and color.” Spanish **Transiciones y títulos**: “Elige dos clips contiguos y agrega Fundido cruzado, Fundido a color o Barrido. Revisa la duración: superponer clips acorta esa pista. Agrega un título con una fuente con licencia y elige sin animación, fundido o desplazamiento. La vista previa usa los mismos tiempos que la exportación. Deshacer revierte cada cambio terminado. Consulta también: Efectos y color de la línea de tiempo.”

timeline-effects.md — English **Timeline effects and color**: “Select a clip and adjust supported brightness, contrast, saturation, color, crop or speed. Only effects verified in the installed Media tools pack are enabled. Stabilization and noise reduction may be unavailable; no AI tool is substituted. Review the preview and keep the project before exporting. See also: Exporting a timeline.” Spanish **Efectos y color de la línea de tiempo**: “Selecciona un clip y ajusta brillo, contraste, saturación, color, recorte o velocidad compatibles. Solo se habilitan efectos verificados en Herramientas multimedia. La estabilización o reducción de ruido pueden no estar disponibles; no se sustituye una herramienta de IA. Revisa la vista previa y conserva el proyecto antes de exportar. Consulta también: Exportar una línea de tiempo.”

timeline-audio.md — English **Mixing timeline audio**: “Adjust clip and track gain, mute, solo and fades in Audio mix. Mute always wins; solo limits playback to the selected eligible tracks or clips. Watch clipping warnings and reduce levels rather than expecting automatic loudness correction. Add music as an ordinary audio clip. Imported subtitle text stays plain text and can be edited or burned into output. See also: Exporting a timeline.” Spanish **Mezclar audio en la línea de tiempo**: “Ajusta ganancia, silencio, solo y fundidos de clips y pistas en Mezcla de audio. Silenciar siempre prevalece; Solo limita la reproducción a las pistas o clips elegibles seleccionados. Revisa avisos de saturación y reduce niveles, sin esperar una corrección automática de volumen. Agrega música como un clip de audio normal. Los subtítulos importados siguen siendo texto y se pueden editar o incrustar. Consulta también: Exportar una línea de tiempo.”

timeline-export.md — English **Exporting a timeline**: “Choose Export timeline and a compatible preset. Review dimensions, frame rate, codecs, metadata, subtitles and a new destination. Preview sample checks the captured revision; later edits remain in the project. Start export and keep browsing while its job shows progress and Cancel. The original media and prior files are kept. Save the project separately to retain editable tracks and effects. See also: The timeline; App storage.” Spanish **Exportar una línea de tiempo**: “Elige Exportar línea de tiempo y un ajuste compatible. Revisa dimensiones, velocidad de fotogramas, códecs, metadatos, subtítulos y un destino nuevo. Muestra de vista previa revisa la revisión capturada; los cambios posteriores permanecen en el proyecto. Inicia la exportación y sigue explorando mientras la tarea muestra progreso y Cancelar. Se conservan los originales y archivos anteriores. Guarda el proyecto por separado para conservar pistas y efectos editables. Consulta también: La línea de tiempo; Almacenamiento de la aplicación.”

## Checks/speed/screenshots/done

Use19afiveclipproject,1stransition,color/typedtitle,48000Hzmusicwith0.5sgainfades,subtitle1000001..2000001us,sourcedisappearance/exportcancel. Coordinatorcomparespreview/exportpixel/time/audio-syncanddurations,allpresetcodecs/metadata/sidecar/progress/Cancel/foregroundresponsive/sourcehashes;Englishlight/Spanishdark/pseudo/keyboard/200%zoom. Measure step19b.effect.apply Instant100ms,previewSmooth16ms/video>=30fps,A/Vsync<=40ms,exportbackgroundwithCancel<=5s. Reserve182-timeline-effects,183-timeline-export threevariants. Done:exact19a/time/sharedgraphs,licensedavailableeffects/codecs,nooverwrite/clean-stateclaim,safeownoutputsandreviewer-runroundtrip/output/frame/audio/securityevidence.
