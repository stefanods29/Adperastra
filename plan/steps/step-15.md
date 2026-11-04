# Step 15: Non-destructive audio and video editing

|Field|Value|
|---|---|
| State | guide; documentation reviewed; implementation not started |
|Difficulty|4/5|
|Branch|step-15-media-editing|
|Tag|v0.3.4-step15|
|Depends on|12b engines-2/media-probe-2;08a conversion;09a document controller;09c transfer|
|Written before|07a was built|
|Interface revision|media-edit-1;media-time-1|

Guide only; workers write code/tests, coordinator executes all checks. Dependency is12b;14c AI runtime is a separate feature.17b supplies optional local transcription through the integration below; this step does not implement its models. Timeline tracks belong to19a; no unverified codec/filter.

## Goal and reading

Trim/cut/split clips, rotate/crop, change speed/volume, select/burn subtitles, inspect waveforms and export while browsing. Missing pack keeps the ordinary player. Read v1 step15,12b media timing/capabilities/security,08a output/snapshot rules,09a shared controller,existing media handler/MediaView/helpers/mediaSidecars. No wavesurfer/libmpv/libVLC dependency; app-owned Canvas waveform and existing HTML media player.

## Decisions and algorithms

1. D1. The source media is immutable. Editing creates a document-owned recipe; Save never overwrites the source merely because the original player tab is active. A small documented `.admedia` recipe snapshot saves resumable edits through09a; media export remains a separate08a owned-output job. This explicit recipe bridge is necessary for dirty-close/recovery, and19a can import it. Recipe max16MiB,source path/stamp only, no embedded media/grants/passwords. Opening an ordinary media file stays player-only until Edit; New recipe becomes its own document/title, sourcefile tab unchanged.
2. D2. Reuse12b TimeUs integer microseconds and FrameRate rational. All ranges startinclusive/endexclusive; source boundary matching follows12b frame/sample rules. Segments are ordered nonoverlapping source ranges,1..10000, duration sum of((end-start)/speed) rounded once at output sampling; keep rational intermediate products using checked128-bit native arithmetic. Cut removes selectedrange andjoinsremainingparts; split inserts boundary at playhead without discarding content. Empty result refused. Exact reencode by default; approximate streamcopy requires explicit keyframe warning.
3. D3. Crop integer sourcepixelrect after container orientation, withinbounds; rotation0/90/180/270; speed0.25..4,volume0..4,mute bool. Preview uses HTML playbackRate and matching geometry/gain; export uses typed engine graph with fixed filter allowlist crop/transpose/setpts/atempo/volume/concat plus subtitles overlay. No raw filtertext from recipe. Speedaudio uses atempo factors within supported range whose product equals chosen speed. Preview/export derive from same normalized recipe, with A/Vsync target<=40ms in reviewer test.
4. D4. Subtitle cues imported through07f subtitle parser; start/end TimeUs,textescaped,max100000cues/4MiB,external links/ASS commands not executed. User chooses off/select/burn. Burn uses app-rasterized licensedfont text frames/overlay path, not arbitrary subtitle scripts, unless a separately audited compatible build exposes a fixedsafe renderer. Requiredpackcapability records actualsupport; no fakeburnsuccess. Waveforms decodePCM in confinedengine,100min/maxbuckets/sec,splitperchannel<=8,cache128MiB/page512buckets; nofullaudioarrayinUI.
5. D5. Preview proxies512/960edge are optional user-requested/background-policy jobs, source-stamp/recipeversion keyed, neverhydratecloudinbackground. Scrub maps output playhead to source segment using exact cumulative durations. Pause when tabinactive; Cancel stalepreview, ignorelatejobgeneration. Proxy generation cannot block originalplayer fallback. No automatic audible playback onrestore.
6. D6. Export presets web1080p VP9/Opus,phonevertical1080x1920 withfit/pad,highqualitysource-size FLACaudio/VP9video,audioonly WAV/FLAC/MP3whenavailable. Options generated from verified12b capability list, metadataKeep defaulttrue. Newdestdefault `<stem> - Edited.<ext>` numberedcollision; nooriginaloverwrite. Exports may exceed256MiB because native engine output streams directly to08a owned publication, never an ExportSnapshot. The recipe snapshot stayssmall andauthorizesinputbySourceStamp.
7. D7. Schema41 -> 42 adds media_editor.preview_quality source/960/512 default960, waveform true, keep_pitch true. Recipe source root pathvalidatedandmissingfilegetsRelink; relinkrequirescompatibleprobe/duration validation,keepseditsandwarnsifchanged. Sensitivevirtualsource requiringCLI is refused, no plaintextspool. Recipereferencesarepersonaldata,nevercopiedtosetup/catalogdiagnosticsbydefault.

## Uses and exact exports

|Ref|Producer/task/file/revision|Contract|
|---|---|---|
|U1|12b T2-T4 E2/E3/E5;mediaEngine.ts/engineTypes.ts;media-probe-2|probeMedia/previewMedia,TimeUs/FrameRate/MediaInfo,EngineHostconfinedlifecycle; oneprocessexecutionauthority|
|U2|08a E1/E2/E4-E7;convert/types.ts;conversion-2/export-snapshot-2|Immutable recipeExportSnapshot andsharedlongjob/outputreport/Undo; no256MiBcapappliedtonativeexportfileincorrectly|
|U3|09a T2;documents/controller.ts;tabs-documents-1|RecipeDocumentControllerbinding/capture/content_id/saved_revision,dirtyclose/SaveCopysemantics|
|U4|07f T5/E1/E6;src/services/extraViews.ts;extra-viewers-1 plus09c src/transfer/types.ts|subtitleCues(sessionId:string,cursor?:string)->Promise<ExtraViewPage> with SubtitleCue{index,start_ms,end_ms,text}; checked multiply milliseconds by1000 into TimeUs;zero-duration cues are reported invalid, not silently burned; authorizedfileoffers only |
|U5|04c services/media.ts/handlers/media;baseline|mediaSidecars(path)->Promise<string[]>; existingplayer/FileTypeInfostillrealOSpath|

Canonical `src/media-edit/types.ts`,native `src-tauri/src/media_edit_types.rs` importsTimeUs/FrameRate from12b.

|Type|Fields|
|---|---|
|MediaSource|id UUID;path absolute<=32768UTF16;stamp SourceStamp;duration_us TimeUs;video_rate nullableFrameRate;audio_rate nullableu32; sensitive fixedfalseforCLI|
|MediaSegment|id UUID;source_id UUID;start_us/end_us TimeUs withend>start;speed finite0.25..4default1|
|MediaCrop|x/y nonnegativeu32;width/heightpositiveu32 withinorientedsource|
|MediaSubtitleCue|id UUID;start_us/end_us; text string<=8192; end>start|
|MediaRecipe|schema_version1;project_id/content_id UUID;sources MediaSource[]1..100;segments MediaSegment[]1..10000;crop nullableMediaCrop;rotation0/90/180/270;volume0..4;mute bool;keep_pitch booltrue;subtitles MediaSubtitleCue[];subtitle_mode off/select/burn;metadata_keep booltrue|
|WavePeak/WavePage|{min,max} finite-1..1 / {source_id,channelu8,first_bucketu32,buckets WavePeak[]<=512,total_bucketsu32}|
|MediaEditOperation|set_segments(segments),set_crop(crop),set_rotation(rotation),set_speed(segment_id,speed),set_gain(volume,mute),set_subtitles(cues,mode); atomicvalidatedtransaction|

|Ref|Exact export/signature|Consumers|
|---|---|---|
|E1|media-edit/MediaDocument.ts acquireMediaEditor(document:DocumentHandle)->Promise<MediaEditController>|.admediarecipehandler,19aimport|
|E2|MediaEditController getRecipe()->Readonly<MediaRecipe>;subscribe(listener)->unsubscribe;apply(operation:MediaEditOperation)->Promise<void>;undo/redo()->Promise<void>;capture(capturedRevision:number,contentId:string)->Promise<ExportSnapshot>;release()->void|09a documentbinding; captureMIME application/vnd.adperastra.media-edit+json|
|E3|services/mediaEdit.ts exportMediaRecipe(recipeSnapshot:ExportSnapshot,request:ConversionRequest)->Promise<JobHandle<ConversionReport>>|Native media_recipe_export_start(request_id,snapshot_id,request); validatesrecipe/format/sourceleasesbeforeengine;19ausesnormalizedsegments|
|E4|services/mediaEdit.ts waveformPage(source:MediaSource,channel:number,firstBucket:number)->Promise<WavePage>|native media_waveform_page; boundedsourceauthorization/cache;19awaveforms|
|E5|media-edit/timing.ts outputToSource(recipe:MediaRecipe,outputUs:TimeUs)->{segment_id:string,source_us:TimeUs}|Binarysearchcumulativeintervals; finaldurationclamp,lastsampleexclusive;19aexacttimebasis|
|E6|media-edit/subtitles.ts importMediaSubtitles(sessionId:string,cursor?:string)->Promise<{cues:MediaSubtitleCue[],next_cursor:string|null,invalid_indices:number[]}>|Maps07f E6 milliseconds to checked microseconds; cue id deterministic from session_id/index; aggregate4MiB/100000 bounds;19b imports canonical resulting cues |

Nativeerrors media_edit.bad_request/missing_source/changed/unsupported/too_large/read_only/failed;missingpackreuseengines.pack_missing. Allcommandsensure_main/allowlist/validaterecipeagain,noarbitrarygraph/arguments.

## UI, translations and tasks

MediaEditor toolbar48px withHome/Edit/Export Ribbon, lefttoolrail48, properties300, playerflexmin0,waveform/timeline160pxbottom,transport48,status28. `.adp-media-editor` grid minmax(0,1fr)300px;`.adp-media-waveform` canvasheight128andaccessible rangeinput; cropnumericfieldsandstart/endtextinputsprovidekeyboardalternative. Existingtokens/focus;maxviewportminus32dialogs;100msskeleton/1swords/jobCancel.

|Keys|English|Spanish|
|---|---|---|
|mediaEdit.edit / mediaEdit.trim / mediaEdit.cut / mediaEdit.split / mediaEdit.extract / mediaEdit.crop / mediaEdit.rotate|Edit media / Trim / Cut selection / Split at playhead / Extract audio / Crop / Rotate|Editar multimedia / Recortar duración / Cortar selección / Dividir en el cabezal / Extraer audio / Recortar imagen / Girar|
|mediaEdit.start / mediaEdit.end / mediaEdit.speed / mediaEdit.volume / mediaEdit.mute / mediaEdit.waveform|Start / End / Speed / Volume / Mute / Waveform|Inicio / Fin / Velocidad / Volumen / Silenciar / Forma de onda|
|mediaEdit.subtitles / mediaEdit.burn / mediaEdit.off / mediaEdit.keepPitch|Subtitles / Burn into video / Off / Keep audio pitch|Subtítulos / Incrustar en el video / Desactivados / Conservar el tono del audio|
|mediaEdit.saveRecipe / mediaEdit.export / mediaEdit.relink / mediaEdit.editedName|Save edit recipe / Export media… / Relink source… / {name} - Edited|Guardar receta de edición / Exportar multimedia… / Vincular origen… / {name} - Editado|
|mediaEdit.recipeNotice / errors.media_edit.failed|Saving the recipe keeps edit instructions; export creates playable media. / This media edit could not be completed.|Guardar la receta conserva las instrucciones; exportar crea contenido reproducible. / No se pudo completar esta edición multimedia.|

Commands media.trim/cut/split/extract/crop/rotate/export,keysabove,icons Scissors/Scissors/Split/Music/Crop/RotateCw/Download,no globalshortcut,helpbelow. All othererrorcodesmappedtoerrors.media_edit.failed,detailstablecodesonly.

|Task;commit|Files/work;dependencies|Named tests:input->oracle|
|---|---|---|
|T1;`feat(media): immutable recipe and timing [step-15/T1]`|media-edit/types.ts,timing.ts,MediaDocument.ts;U1/U3;validate/snapshotrecipe.|cut2s..4sfrom10s=>8s;split5s_preserves10s;speed2_4s=>2s;emptysegments_refused|
|T2;`feat(media): trim crop speed and gain controls [step-15/T2]`|operations.ts,MediaEditor.tsx,MediaProperties.tsx;U5/E2.|crop_bounds_refused;mute_no_sourcechange;sharedviews_same_recipe;undo_restores_segmentIDs|
|T3;`feat(media): bounded waveforms and proxy preview [step-15/T3]`|nativewaveforms.rs,proxy.rs;Waveform.tsx,useMediaPreview.ts;U1/U2/E4.|512bucketpagebound;sourcechanged_invalidatescache;inactivepauses;output6s_aftercut2..4_maps_source8s|
|T4;`feat(media): subtitles and safe recipe exports [step-15/T4]`|subtitles.ts,media_recipe_export.rs,media_arguments.rs;U1/U2/U4/E3.|subtitletext_not_filtercode;exportcancel_preservesforeigndest;metadata_default_keep;no_pack_player_works|
|T5;`feat(media): saveable edit recipes [step-15/T5]`|recipeCodec.ts,handlers/media-recipe/index.ts,services/mediaEdit.ts;U3.|recipe_roundtrip_exactTimeUs;SaveCopy_notclean;missing_relink_preservesedits;sensitiveCLI_refused|
|T6;`docs(help): media editing and export [step-15/T6]`|Fourpagesbelow,media-edit.css;coordinator schema42/keys/wiring/evidence.|migration41_keep_image_and_local_ai_prefs;keyboard_ranges;recipe_export_distinction_visible|

## Exact file and test allocation

Feature-owned roots: src/media-edit/; src/services/mediaEdit.ts; src/handlers/media-recipe/; src-tauri/src/{media_recipe_export,waveforms,proxy}.rs; src/styles/media-edit.css. Bare filenames in a task expand inside its feature root; native filenames mean src-tauri/src/ unless an explicit crate path is given. The coordinator owns shared App/Explorer/main, settings schemas, manifests/lockfiles, command/handler/IPC registries, generated locales and asset wiring; workers submit exact insertions rather than editing those shared files. Helpers use the producer's fixed entry/action registry through coordinator integration.

Place every named test in task Tn in the corresponding file below. Rust test modules with private feature access are attached by the owning native module; they are not a fictitious standalone src-tauri library. The listed assertions remain unchanged when split into smaller test files.

|Task|Exact test file|
|---|---|
|T1|src/__tests__/step15-timing.test.ts|
|T2|src/__tests__/step15-operations.test.tsx|
|T3|src-tauri/src/media_waveform_step15_tests.rs|
|T4|src-tauri/src/media_export_step15_tests.rs|
|T5|src/__tests__/step15-recipe.test.ts|
|T6|src/__tests__/step15-help.test.ts|

Workers write these tests and fixtures but do not execute any command, install, compile, generate assets or claim results. Coordinator runs targeted checks, complete gate/package, real parser/process/file-safety tests and manual evidence. A mock is not evidence of native confinement, interoperability or performance.

## Full help

media-trimming.md — English **Trimming and cutting media**: “Choose Edit media to create a recipe while keeping the original. Set Start and End to trim, Cut selection to remove a range, or Split at playhead to divide it. Undo restores a change. Save edit recipe keeps the instructions; Export media creates a playable file. See also: Exporting media.” Spanish **Recortar y cortar multimedia**: “Elige Editar multimedia para crear una receta y conservar el original. Configura Inicio y Fin para recortar la duración, Cortar selección para quitar un intervalo o Dividir en el cabezal para separarlo. Deshacer restaura un cambio. Guardar receta de edición conserva las instrucciones; Exportar multimedia crea un archivo reproducible. Consulta también: Exportar contenido multimedia.”

media-extract-audio.md — English **Extracting audio**: “Open a video recipe and choose Extract audio. Select a supported audio format and destination, review metadata changes and start export. The source video is kept. A missing codec remains unavailable until a verified pack supplies it. See also: Converting audio and video.” Spanish **Extraer audio**: “Abre una receta de video y elige Extraer audio. Selecciona un formato y destino compatibles, revisa los cambios de metadatos e inicia la exportación. Se conserva el video original. Un códec que falta sigue deshabilitado hasta que lo incluya un paquete verificado. Consulta también: Convertir audio y video.”

media-subtitles.md — English **Subtitles**: “Choose a supported subtitle file, inspect its timing and choose Off, display or Burn into video. Burned text becomes part of exported pixels and cannot be switched off there. Subtitle scripts and external links never run. Save the recipe to retain the choice. See also: Exporting media.” Spanish **Subtítulos**: “Elige un archivo compatible, revisa sus tiempos y selecciona Desactivados, mostrar o Incrustar en el video. El texto incrustado forma parte de los píxeles exportados y no se puede desactivar allí. Nunca se ejecutan scripts ni vínculos externos de subtítulos. Guarda la receta para conservar la elección. Consulta también: Exportar contenido multimedia.”

media-exporting.md — English **Exporting media**: “Choose Export media, a compatible preset and a new destination. Review size, time range, speed, audio, subtitles and metadata, then export. Progress and Cancel remain in the job card while you browse. The original is never overwritten by default. A saved recipe still needs its referenced source files. See also: Trimming and cutting media; App storage.” Spanish **Exportar contenido multimedia**: “Elige Exportar multimedia, un ajuste compatible y un destino nuevo. Revisa tamaño, intervalo, velocidad, audio, subtítulos y metadatos y exporta. El progreso y Cancelar permanecen en la tarjeta mientras exploras. El original nunca se reemplaza de forma predeterminada. Una receta guardada sigue necesitando sus archivos de origen. Consulta también: Recortar y cortar multimedia; Almacenamiento de la aplicación.”

## Fixtures/checks/speed/screenshots/done

Retain10s30fps video,10s48000Hz audio, cue1s..2s “Año”,changed/missing source and recipe. Coordinatorcheckscut2..4=>8s,split/crop/rotate/speed/gain/pitch/subtitles/extract/sourcehash/exportcancel/relink/recipe dirtysave;missingpack/sensitivefailclosed;Spanishdark/pseudo/keyboard/200%zoom. Measure step15.edit.ready Fast1s, control Instant100ms,scrub>=30fps,A/Vsync<=40ms,exportbackground. Reserve159-media-edit,160-media-export threevariants. Done:exactrecipe/time/contracts reused19a, noSourceSaveaccident, boundedproxies/waveforms, verified enginegraphs/output and reviewer-run evidence.

17b speech integration is included: user-requested automatic captions/transcription use startTranscription, transcriptPage/releaseTranscript and applyTranscriptToMedia(documentId,expectedContentId,transcriptId,mode select/burn). Import17b exact TranscriptionRequest/TranscriptInfo/TranscriptPage and E4 cue converter; source timebase and17b TranscriptSegment.start_us/end_us are already integer microseconds, so no unit conversion or inferred millisecond fields. No microphone capture from opening a video, no API fallback, no captions attached before source/content revision validation and user acceptance.

## Recipe capture authority

T1/T5 register the trusted native recipe provider's MIME application/vnd.adperastra.media-edit+json through08a SnapshotAuthorityRegistry.permit_capture_mime. Capture freezes the immutable recipe and its requested capturedRevision/contentId before async encoding, then verifies those exact values in the returned ExportSnapshot. A later edit cannot relabel old recipe bytes as a newer revision. This JSON contains only the documented recipe fields and authorized source stamps, never helper grants or an API credential. T5 tests recipe_capture_tuple_frozen and registered_recipe_mime_required. CLI media input remains ordinary disk-backed with SourceStamp validation; sensitive virtual media is refused rather than spilled to disk.
