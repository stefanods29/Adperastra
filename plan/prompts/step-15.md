# Coding assignment: step 15 — Audio and video basics

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-15.md](../steps/step-15.md). Guide SHA-256: `cbcfe358fc402c21d0e0c715127a486b3d2872a0bd939be2bc06799c41851e4c`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

|Field|Value|
|---|---|
| State | guide; documentation reviewed; implementation not started |
|Difficulty|4/5|
|Branch|step-15-media-editing|
|Tag|v0.3.4-step15|
|Depends on|12b engines-2/media-probe-2;08a conversion;09a document controller;09c transfer|
|Written before|07a was built|
|Interface revision|media-edit-1;media-time-1|

Settings reservation: 41 -> 42; screenshot reservations: 159-160. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07f producer guide](../steps/step-07f.md)
- [Step 08a producer guide](../steps/step-08a.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 12b producer guide](../steps/step-12b.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

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

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

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

## Coordinator commit labels (workers do not commit)

- feat(media): immutable recipe and timing [step-15/T1]
- feat(media): trim crop speed and gain controls [step-15/T2]
- feat(media): bounded waveforms and proxy preview [step-15/T3]
- feat(media): subtitles and safe recipe exports [step-15/T4]
- feat(media): saveable edit recipes [step-15/T5]
- docs(help): media editing and export [step-15/T6]

## Required handoff

Return `handoff/step-15/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-15/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
