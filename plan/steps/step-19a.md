# Step 19a: Timeline tracks, clips, proxies and projects

|Field|Value|
|---|---|
| State | guide; documentation reviewed; implementation not started |
|Difficulty|5/5|
|Branch|step-19a-video-timeline|
|Tag|v0.5.3-step19a|
|Depends on|15 media-edit-1/media-time-1;12b engines-2;09a documents;09c transfers;09g shelf;07a cache|
|Written before|07a was built|
|Interface revision|timeline-project-1;timeline-render-1|

Guide only. Workers write code/tests; coordinator runs builds/tests/media/frame and integration checks. No AI features; no dependency on18b image internals.

## Goal and reading

Build a non-destructive multi-track timeline with clip edits, thumbnails/waveforms/proxies and a documented project. Effects/mixing/export19b. Read v1 step19a,15 exacttime/recipe/media source contracts,12b process/probe,09c transfers,09g shelf,09a controller,07a cache. Use existingHTMLmedia/app-ownedCanvas/WebGL; no newmediaUIlibrary.

## Decisions

1. D1. The .adtimeline project is UTF-8 JSON schema1, <=16MiB, storing instructions and source references rather than media. Edit in timeline creates a new project tab with one source, a video track and linked audio when present. Import15 recipes without flattening. Limits:128 tracks,10000 clips,1000 sources,24h; source limits come from12b. Handler timeline-project owns adtimeline and MIME application/vnd.adperastra.timeline+json, accent powerpoint. Its controller is shared through09a.
2. D2. Import TimeUs and FrameRate from12b/15. Frame k occurs at floor(k*1000000*rate.den/rate.num) microseconds. All intervals are start-inclusive/end-exclusive. Speed is a reduced rational within0.25..4. Duration=ceil((source_out_us-source_in_us)*speed.den/speed.num). Source time=source_in_us+floor((timeline_us-start_us)*speed.num/speed.den), clamped below source_out_us. Use checked128-bit native intermediates, never accumulated floating FPS. Audio uses12b ceil-sample boundaries.
3. D3. Video tracks composite bottom to top; audio tracks mix independently. Before19b, same-track video overlap is refused. Clip/source IDs are stable UUIDs; linked audio/video share link_id. Edits include all linked partners or fail atomically if any is locked. Move keeps duration/source bounds. Trim stays within source duration and adjusts timeline start for left trim. Split at an interior point creates a new right ID with contiguous source ranges; boundary split is a no-op. Slip keeps timeline position/duration while shifting source bounds.
4. D4. Snap within8 CSS pixels converted to timeline time. Targets are playhead, clip edges and source frame grid; choose nearest, ties by earlier time then stable ID. Alt disables snapping. Ripple delete operates on one unlocked track: selected clips must include every clip inside their first-start/last-end interval. Remove that interval and shift later clips earlier by its duration; include compatible linked partners or refuse. Ordinary Delete leaves a gap. Each completed gesture is one Undo/revision; drag preview does not change the project.
5. D5. Source paths are validated absolute paths plus SourceStamp, never URLs or commands. Relink requires explicit file choice/probe and adequate duration/stream kind, preserving clip IDs and edits. Changed sources invalidate proxies/thumbnails/waveforms and require review. Persist no grants, tokens, passwords, parser objects or media bytes. Sensitive virtual sources requiring CLI/proxy files are refused before plaintext staging.
6. D6. Generate optional512/960-edge WebM proxies only through verified VP9/Opus capability and12b EngineHost. Cache kind media_proxy; key includes SourceStamp, stream, engine version and quality. Cap proxy512MiB within shared cache; never evict a live lease. Thumbnail windows return <=256 images,160x90 each. Waveforms use15E4 pages of512 buckets. Open the timeline UI without reading every source. Show skeleton100ms, words1s and cancellable proxy jobs.
7. D7. Use one monotonic clock in integer TimeUs, with audio master during playback. A seek generation invalidates older decode results. Map frames byD2, composite the top visible video tracks and display the latest requested scrub generation. Do not accumulate HTML currentTime deltas. Reviewer target is at least30fps scrubbing. Pause inactive/hidden tabs and restore without autoplay.
8. D8. Schema48 -> 49 adds timeline.preview_quality=960 (512/960/source), snap_enabled=true and proxy_enabled=false. Proxy generation needs explicit opt-in plus background policy. Project dimensions1..8192/100MP; default frame rate30/1, sample rate48000 and2 channels. Variable-frame-rate media uses timestamps.19b preview/export consumes the exact normalized plan.

## Uses, types and exports

|Ref|Producer/task/file/revision|Exact consumption|
|---|---|---|
|U1|15 T1/T3/E4/E5;media-edit/types.ts/timing.ts;media-edit-1|MediaSource/MediaRecipe/TimeUs/FrameRate/WavePage,exactsourcebounds/waveforms; importno copiedtimebasetype|
|U2|12b T2-T4 E2/E3;mediaEngine.ts/engine_process.rs;engines-2|probeMedia/EngineHost,verifiedcodecs,privateconfinedinput/proxyjobs;oneprocessauthority|
|U3|09a controller.ts;tabs-documents-1|DocumentControllerContext/Binding/immutablecontent_idcapture;projectSave/SaveCopyversion semantics|
|U4|09c T1-T3 E1/E2 src/transfer/types.ts/TransferRegistry.ts;09g T3/T4 E4 src/services/shelf.ts;shelf-1/content-transfer-1|getShelf()->Promise<ShelfCatalog>;refreshShelf(ids)->Promise<JobHandle<ShelfCatalog>>;ShelfItem.source isDocumentRef,notguaranteeddiskpath. TransferTarget describes add_clips forauthorizedfilesonly; virtualsensitiveCLIrefused. Validate sourcestamp againbeforeimport |
|U5|07a cache;preview-foundation-1|SourceStamp/CacheLease/pin/release/backgroundpolicy;nojoboutputsasrawJSON |

Canonical `src/timeline/types.ts`, native `src-tauri/src/timeline_types.rs`; runtimeviewstate `timelineViewTypes.ts` separatefromproject. Typesbelowreserve19bfeaturesupfront; before19b arrays/defaults remainempty andunavailablecapabilitiesnotadvertised.

|Type|Fields|
|---|---|
|PlaybackRate|num/den positiveu32 reduced;ratio0.25..4;default1/1 |
|Track|idUUID;kind video/audio;name1..128;lockedfalse;visibletrue;mute/solo false;gain0..4default1;indexu16;clips TimelineClip[] |
|TimelineClip|id/source_idUUID;link_idnullableUUID;start_usTimeUs;source_in_us/source_out_usTimeUs;speedPlaybackRate;gain0..4default1;mute boolfalse;fade_in_us/fade_out_usTimeUsdefault0;transform{cropnullableMediaCrop,rotation0/90/180/270};effects TimelineEffect[]defaultempty |
|TimelineEffect|tag brightness(value-1..1),contrast(value-1..1),saturation(value-1..1),color(gammaRGBthree0.1..10),crop(rectMediaCrop),stabilize(strength0..1). stabilizeavailableonlyauditednon-AIcapability19b |
|TimelineTransition|idUUID;track_id,left_clip_id,right_clip_idUUID;kind crossfade/dip/wipe;duration_uspositiveTimeUs;directionleft/right/up/down;rgba4u8;enabledtrue |
|TimelineTitle|idUUID;track_idUUID;start_us/end_us;stringtext<=10000;style{font_asset_idstring<=128,font_size1..512,rgba4u8,alignleft/center/right,x/yfinite0..1};animation none/fade/slide;animation_usTimeUs<=duration |
|TimelineProject|schema_version1;project_id/content_idUUID;sources MediaSource[];tracks Track[];width/height;frame_rateFrameRate;audio_rate48000;audio_channels1/2;transitions TimelineTransition[]<=10000; titles TimelineTitle[]<=1000;subtitles MediaSubtitleCue[]<=100000;extensions optionalnamespacedJSON<=1MiBpreservednonexecuted |
|TimelineOperation|add_track(track),remove_track(id),add_clip(track_id,clip),move_clip(id,track_id,start_us),trim_clip(id,in_us,out_us),split_clip(id,time_us),slip_clip(id,delta_usi64),delete_clips(ids,ripplebool),reorder_tracks(idsfullpermutation),relink_source(id,replacementMediaSource); allatomicvalidated |
|TimelineRenderPlan|project_id/content_id;duration_us;frame_rate,width,height,audio_rate,channels;orderedimmutabletracks/sources/transitions/titles/subtitles copies;source stamps andnoarbitrarygraphtext |

|Ref|Publicexport/signature|Consumers|
|---|---|---|
|E1|timeline/TimelineDocument.ts acquireTimeline(document:DocumentHandle)->Promise<TimelineController>|19a/bsharedprojectcontroller |
|E2|TimelineController getProject()->Readonly<TimelineProject>;subscribe(listener)->unsubscribe;apply(operation:TimelineOperation)->Promise<void>;undo/redo()->Promise<void>;capture(revision:number,contentId:string)->Promise<ExportSnapshot>;release()->void|09abinding;captureMIMEprojectJSON<=16MiB |
|E3|timeline/renderPlan.ts normalizeTimeline(project:Readonly<TimelineProject>)->TimelineRenderPlan|19bpreview/exportsameplan; validatesalloverlaps/timebounds/links |
|E4|timeline/transactions.ts commitTimelineTransaction(documentId:string,expectedContentId:string,transform:(current:Readonly<TimelineProject>)->TimelineProject)->Promise<void>|Trusted19boperations;onevalidation/history/content_idnotify |
|E5|services/timeline.ts openTimeline(input:ConversionInput)->Promise<JobHandle<TimelineProject>>;requestTimelineProxy(source:MediaSource,quality:512/960)->Promise<JobHandle<CacheLease>>;releaseTimelineProxy(leaseId)->Promise<void>|Native timeline_open_start/proxy_start/release; boundedvalidatedproject/source;19b |
|E6|timeline/timing.ts clipSourceTime(clip:TimelineClip,timelineUs:TimeUs)->TimeUs;frameTime(frame:number,rate:FrameRate)->TimeUs|19btest/render; timingD2 |

Errors timeline.bad_request/missing_source/changed/locked/overlap/too_large/history_full/unsupported/failed; allcommandsensure_main/allowlist;plainfilebytesvia08aprotocolnottheprojectsourcefileinJSONinvoke.

## UI/strings/tasks

TimelineEditor centralpreviewflexmin0,properties300pxright;timelinebottom280px,min160,max60%viewport;trackheader160px,videoheight72/audio56,ruler28,transport48,status28. Virtualizetimewindow+2soverscan/visibletracks+2,clipsnot10000DOMnodes. `.adp-timeline-track`positionrelative,tokensurfaces;selectedclipaccent/focusnotcoloronly. Range/start/in/outnumericfieldsandMoveEarlier/Laterkeyboardactionsprovided;Spaceplayonlyoutsideinputs,arrowsframe,Shiftarrows10frames,Escape canceldrag; noglobaleditorUndoconflict.

|Keys|English|Spanish|
|---|---|---|
|timeline.title / timeline.edit / timeline.new / timeline.addVideo / timeline.addAudio|Timeline / Edit in timeline / New timeline project / Add video track / Add audio track|Línea de tiempo / Editar en línea de tiempo / Nuevo proyecto de línea de tiempo / Agregar pista de video / Agregar pista de audio|
|timeline.trim / timeline.split / timeline.slip / timeline.ripple / timeline.snap / timeline.proxy|Trim clip / Split clip / Slip source / Ripple delete / Snap / Proxy preview|Recortar clip / Dividir clip / Desplazar origen / Eliminar y cerrar espacio / Ajustar / Vista previa por proxy|
|timeline.relink / timeline.missing / timeline.sourceChanged|Relink source… / Source media is missing. / This source changed. Review the affected clips.|Vincular origen… / Falta el archivo multimedia de origen. / Este origen cambió. Revisa los clips afectados.|
|timeline.projectNotice / errors.timeline.failed|Projects reference source files. Keep those files available. / This timeline operation could not be completed.|Los proyectos hacen referencia a archivos de origen. Conserva esos archivos disponibles. / No se pudo completar esta operación de línea de tiempo.|

Commands timeline.new/edit/addVideo/addAudio/split/ripple/snap,keysabove,icons Film/Clapperboard/Plus/Plus/Split/Scissors/Magnet,no globalshortcut,helpbelow. Othererrorsfailedwithstablecode; source pathsdisplayPath only.

|Task;commit|Files/work;dependencies|Namedtests:input->oracle|
|---|---|---|
|T1;`feat(timeline): bounded project and exact timing [step-19a/T1]`|types.ts,timing.ts,projectValidation.ts,TimelineDocument.ts;U1/U3.|frame30at30000/1001=>1001000us;clip4sat2x=>2s;unsafeinteger_refused;project_schema_newer_preserved |
|T2;`feat(timeline): track and clip transactions [step-19a/T2]`|operations.ts,transactions.ts,clipHistory.ts;U1/E2.|split_preserves_sourceinterval;slip_keepsduration;lockedlinkedpartner_refusesall;move_same_track_overlaprefused |
|T3;`feat(timeline): ripple snap and relink [step-19a/T3]`|ripple.ts,snap.ts,relink.ts;U1/U2.|ripple2..4_shiftslater6to4;unselectedclipinripple_range_refused;snap_tie_earliertime;relink_shortsource_nochange |
|T4;`feat(timeline): bounded proxies thumbnails waveforms [step-19a/T4]`|services/timeline.ts,nativetimeline_proxy.rs,ThumbnailStrip.tsx,WaveformTrack.tsx;U2/U5.|sourcechanged_cacheinvalid;stale_seekignored;inactivepauses;proxycancel_releasesleases |
|T5;`feat(timeline): virtualized editor and content drops [step-19a/T5]`|TimelineEditor.tsx,TrackList.tsx,ClipView.tsx,timelineTransfer.ts,timeline.css;U4.|10000clips_boundedDOM;drop_authorizedsourceonly;onegesture_oneUndo;keyboard_exactframe |
|T6;`feat(timeline): saveable project snapshots [step-19a/T6]`|projectCodec.ts,renderPlan.ts,handlers/timeline-project/index.ts;U3/E3.|project_roundtrip_exactIDs_timebase;no_grants_serialized;SaveCopy_notclean;missing_source_keepsclips |
|T7;`docs(help): timeline clips and proxies [step-19a/T7]`|Threepagesbelow;coordinator schema49/keys/wiring/performance.|15recipe_import_preservessegments;missingpack_fallback;sourcehashes_unchanged |

## Exact file and test allocation

Feature-owned roots: src/timeline/; src/services/timeline.ts; src-tauri/src/timeline_{types,proxy}.rs; src/handlers/timeline-project/; src/styles/timeline.css. Bare filenames in a task expand inside its feature root; native filenames mean src-tauri/src/ unless an explicit crate path is given. The coordinator owns shared App/Explorer/main, settings schemas, manifests/lockfiles, command/handler/IPC registries, generated locales and asset wiring; workers submit exact insertions rather than editing those shared files. Helpers use the producer's fixed entry/action registry through coordinator integration.

Place every named test in task Tn in the corresponding file below. Rust test modules with private feature access are attached by the owning native module; they are not a fictitious standalone src-tauri library. The listed assertions remain unchanged when split into smaller test files.

|Task|Exact test file|
|---|---|
|T1|src/__tests__/step19a-timing.test.ts|
|T2|src/__tests__/step19a-clips.test.ts|
|T3|src/__tests__/step19a-ripple.test.ts|
|T4|src-tauri/src/timeline_proxy_step19a_tests.rs|
|T5|src/__tests__/step19a-ui.test.tsx|
|T6|src/__tests__/step19a-codec.test.ts|
|T7|src/__tests__/step19a-help.test.ts|

Workers write these tests and fixtures but do not execute any command, install, compile, generate assets or claim results. Coordinator runs targeted checks, complete gate/package, real parser/process/file-safety tests and manual evidence. A mock is not evidence of native confinement, interoperability or performance.

## Full help

timeline.md — English **The timeline**: “Choose Edit in timeline from a video, or New timeline project. Add video and audio tracks, then drag supported files from Explorer, the shelf or other tabs. Save the .adtimeline project to keep editing instructions. Projects reference source media; keep those files available and use Relink source when they move. Ordinary project saving does not render a new video. See also: Working with timeline clips.” Spanish **La línea de tiempo**: “Elige Editar en línea de tiempo desde un video o Nuevo proyecto de línea de tiempo. Agrega pistas de video y audio y arrastra archivos compatibles desde el Explorador, la bandeja u otras pestañas. Guarda el proyecto .adtimeline para conservar instrucciones. Los proyectos hacen referencia al contenido de origen; conserva esos archivos y usa Vincular origen si se mueven. Guardar el proyecto no crea un video nuevo. Consulta también: Trabajar con clips.”

timeline-clips.md — English **Working with timeline clips**: “Move clips, trim their ends, Split at an interior position or Slip the source while keeping the clip's timeline position. Snap aligns edges; Alt temporarily disables it. Ripple delete removes the chosen interval and closes its gap on affected unlocked tracks; ambiguous or locked edits are refused. Undo reverses a completed gesture. See also: Proxies and playback.” Spanish **Trabajar con clips**: “Mueve clips, recorta sus extremos, divide una posición interior o desplaza el origen conservando la posición del clip. Ajustar alinea bordes; Alt lo desactiva temporalmente. Eliminar y cerrar espacio quita el intervalo elegido y cierra su hueco en las pistas desbloqueadas afectadas; las ediciones ambiguas o bloqueadas se rechazan. Deshacer revierte un gesto terminado. Consulta también: Proxies y reproducción.”

timeline-proxies.md — English **Proxies and playback**: “Enable proxy previews to prepare smaller copies for smooth editing. Originals remain unchanged. Proxy jobs show progress and Cancel, obey background settings and skip online-only files unless you explicitly open them. Changed sources invalidate their previews. Playback uses the latest requested position; missing or slow previews do not authorize changing source media. See also: The timeline; Background work.” Spanish **Proxies y reproducción**: “Habilita vistas por proxy para preparar copias pequeñas y editar con fluidez. Los originales no cambian. Las tareas muestran progreso y Cancelar, respetan la configuración de segundo plano y omiten archivos solo en línea salvo apertura explícita. Cambiar un origen invalida sus vistas. La reproducción usa la última posición solicitada; una vista ausente o lenta no autoriza cambiar el original. Consulta también: La línea de tiempo; Trabajo en segundo plano.”

## Checks/speed/screenshots/done

Retainfive2s30fpsclipswithdistinctcolor/visibleframecounter,48000Hzaudiotone,29.97fpsrationalfixture,missing/relinkedsource andtwotrackproject. Coordinatorchecksalloperations/frameboundaries/Undo/linklocks/relink/projectroundtrip/transfers/proxycancel/sourcehashes/sensitivefailclosed;Englishlight/Spanishdark/pseudo/keyboard/200%zoom. Measure step19a.project.open Fast1s,clipgestureInstant100ms,timelineSmooth16ms,scrub>=30fps,A/Vsync<=40ms;proxyjobsbackground. Reserve180-video-timeline,181-timeline-clips threevariants. Done:exactstableIDs/time/contracts,recoverableprojectandboundedproxy/sourceleases,sourceprotectionandreviewer-runfiveclip/twotrackperformanceevidence.
