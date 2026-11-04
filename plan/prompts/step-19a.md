# Coding assignment: step 19a — Video timeline: tracks and clips

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-19a.md](../steps/step-19a.md). Guide SHA-256: `a163b97e27fbf56a7757ddfbb57dc1627ced7addffdcff174bb180dc88032e4d`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

|Field|Value|
|---|---|
| State | guide; documentation reviewed; implementation not started |
|Difficulty|5/5|
|Branch|step-19a-video-timeline|
|Tag|v0.5.3-step19a|
|Depends on|15 media-edit-1/media-time-1;12b engines-2;09a documents;09c transfers;09g shelf;07a cache|
|Written before|07a was built|
|Interface revision|timeline-project-1;timeline-render-1|

Settings reservation: 48 -> 49; screenshot reservations: 180-181. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09c producer guide](../steps/step-09c.md)
- [Step 09g producer guide](../steps/step-09g.md)
- [Step 12b producer guide](../steps/step-12b.md)
- [Step 15 producer guide](../steps/step-15.md)
- [Step 16 producer guide](../steps/step-16.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

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

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

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

## Coordinator commit labels (workers do not commit)

- feat(timeline): bounded project and exact timing [step-19a/T1]
- feat(timeline): track and clip transactions [step-19a/T2]
- feat(timeline): ripple snap and relink [step-19a/T3]
- feat(timeline): bounded proxies thumbnails waveforms [step-19a/T4]
- feat(timeline): virtualized editor and content drops [step-19a/T5]
- feat(timeline): saveable project snapshots [step-19a/T6]
- docs(help): timeline clips and proxies [step-19a/T7]

## Required handoff

Return `handoff/step-19a/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-19a/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
