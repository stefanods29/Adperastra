# Coding assignment: step 18b — Advanced image editor: painting, filters, project format

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-18b.md](../steps/step-18b.md). Guide SHA-256: `be69f94a163b670d8820b16c20643aa7bd769163f4e2758556bf0e9032f1a778`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

|Field|Value|
|---|---|
| State | guide; documentation reviewed; implementation not started |
|Difficulty|5/5|
|Branch|step-18b-image-projects|
|Tag|v0.5.2-step18b|
|Depends on|14b image-document-1;18a image-layers-1/selection-mask-1;07g PSD;08a/b export|
|Written before|07a was built|
|Interface revision|image-project-1;image-brush-1|

Settings reservation: 48 -> 48; screenshot reservations: 178-179. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07g producer guide](../steps/step-07g.md)
- [Step 08a producer guide](../steps/step-08a.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 14b producer guide](../steps/step-14b.md)
- [Step 18a producer guide](../steps/step-18a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses/data/exports

|Ref|Producer/task/file/revision|Exact use|
|---|---|---|
|U1|14b T1-T6 E1-E8;image-edit/types.ts,transactions.ts,tiles.ts,metadata.ts;image-document-1|ImageModel/ImageLayer/ImageAdjustment/TileStore/MetadataBlobRef,encodedcaptureandonecommit;readImageMetadata/publishImageMetadata preserve metadata without guessed blob paths;18bdoesnotcopytypes|
|U2|18a T2-T5 E1-E4;composite.ts/selections.ts;image-layers-1|SelectionMask,compositeRegion/selectedPixelsandblendequations;mask/paintconsistent |
|U3|07g TmodelPSD;ag-psdhelper;special-viewers-1|ReadPSDboundedisolateddata; no mainwebviewuntrustedparser |
|U4|06d guardedarchive;08a/bregistry/snapshot;09a controller|OwnedguardedZIP+zstd,metadata/flattenedexport,safesaveversion/revisions |

Canonical `src/image-edit/projectTypes.ts`,brushTypes.ts;nativeprojectvalidation `crates/image-edit/src/project.rs`. ImageLayer/Adjustment typesremain14bcanonical.

|Type|Fields|
|---|---|
|BrushSettings|width/hardness/opacity/flow/spacing D2;colorRGBA4u8;mode paint/erase/clone;pressure_size booltrue;pressure_opacity boolfalse;sample composite/layerdefaultlayer|
|BrushSample|x/yfinitecanvaspixels;pressure0..1;tilt_x/tilt_y -90..90;time_us safeinteger; samples<=100000perstroke |
|ProjectTile|idUUID;pathstrictrelative;kind rgba/alpha;width/height1..256;raw_bytes width*height*(4or1);compressed_bytes safeu64;sha25664lowerhex |
|ImageProjectManifest|schema_version1;project_idUUID;width/height;dpi1..2400;layers ImageLayer[];masks ImageMask[];geometry/adjustments/overlays14btypes;tiles ProjectTile[];original_tile_idsUUID[];guides{x_or_y:x/y,position:number}[];metadata_entries{category,path,byte_len,sha256}[];extensions{name,required:boolean,path,sha256}[];noDocumentHandle/ExportSnapshot/token |
|ImageProjectInfo|project_id,width,height,layer_count,unsupported_features stablecode[]<=128,editable bool |

|Ref|Exact export/signature|Consumers|
|---|---|---|
|E1|image-edit/brush.ts paintStroke(documentId:string,expectedContentId:string,layerId:string,samples:readonlyBrushSample[],settings:BrushSettings,selection:SelectionMask)->Promise<void>|One14bE6transaction;18bDraw |
|E2|services/imageProjects.ts openImageProject(input:ConversionInput)->Promise<JobHandle<ImageProjectInfo>>;captureImageProject(documentId:string,revision:number,contentId:string)->Promise<JobHandle<ExportSnapshot>>|native image_project_open_start(request_id,input)/image_project_capture_start(request_id,document_id,revision,content_id); capture wrapper returns Promise<JobHandle<ExportSnapshot>>, so E2 captureImageProject returns that fixed job type; E3 pure controller encoder returns Promise<ExportSnapshot> after awaiting job.completion;boundedhelpers;09a projectbinding |
|E3|image-edit/projectCodec.ts encodeImageProject(model:Readonly<ImageModel>,capturedRevision:number,guides:readonlyGuide[],dpi:number)->Promise<ExportSnapshot>;decodeImageProject(input:ConversionInput)->Promise<ImageModel>|capturedRevision safeinteger>=1 captured atomically with model/content_id by09a; no current-registry revision lookup after async encode. Native18b provider registers application/vnd.adperastra.image-project+zip capture MIME via08a permit_capture_mime; encoded ExportSnapshot uses that MIME/document_id/model.content_id/capturedRevision. Import/archiveparserhelperonly; noUIJSONfilebytes |
|E4|image-edit/adjustmentLayers.ts addAdjustmentLayer(documentId,expectedContentId,adjustment:ImageAdjustment,index:number)->Promise<void>|SamecanonicalImageLayerand18acomposite;14bExport |

Guide type Guide exactly{x_or_y:x/y,position:number};errorcodesimage_project.bad_request/unsupported_schema/unknown_required/too_large/corrupt/changed/failed;brushread-only/historylimitspropagate14b. Allnewcommandsensure_main/allowlist; noarbitraryfilesystementrypathfromUI.

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## UI/strings/commands/tasks

Advancedexistingtoolrail addsFill/Gradient/Clone/Picker;properties300pxwithwidth/hardness/opacity/flow/spacing/pressuretoggles. Adjustments opens320pxpopover,curveseditor256x160withkeyboardeditablepointtable;levels3numericinputs. Rulers20pxtop/left,guidehandlesfocusable;layertexteditingusesTextInputnotHTML. Brushcursorcirclecontent-safeoverlaypointer-eventsnone;tokenfocushandles. Projectsave/exportsameheader14b.

|Keys|English|Spanish|
|---|---|---|
|paint.fill / paint.gradient / paint.clone / paint.picker / paint.flow / paint.spacing / paint.pressure|Fill / Gradient / Clone stamp / Color picker / Flow / Spacing / Pen pressure|Rellenar / Degradado / Tampón de clonar / Selector de color / Flujo / Espaciado / Presión del lápiz|
|adjust.curves / adjust.levels / adjust.hue / adjust.balance / adjust.noise / adjust.artistic|Curves / Levels / Hue and saturation / Color balance / Noise reduction / Artistic filters|Curvas / Niveles / Tono y saturación / Balance de color / Reducción de ruido / Filtros artísticos|
|imageProject.title / imageProject.save / imageProject.rulers / imageProject.guides / imageProject.flattenExport|Image project / Save editable project / Rulers / Guides / Export combines the visible layers.|Proyecto de imagen / Guardar proyecto editable / Reglas / Guías / Exportar combina las capas visibles.|
|imageProject.psdWarning / errors.image_project.failed|Some PSD features cannot stay editable. Review the listed changes before importing a copy. / This image project could not be opened or saved.|Algunas funciones PSD no pueden permanecer editables. Revisa los cambios antes de importar una copia. / No se pudo abrir o guardar este proyecto de imagen.|

Commands image.fill/gradient/clone/picker/curves/levels/projectSave,labelsabove,icons PaintBucket/Blend/Copy/Pipette/Spline/SlidersHorizontal/Save,no globalshortcut,helpbelow;othererrorcodesmapprojectfailedwithstablecode. Shape/texttoolsreuse14bkeys.

|Task;commit|Files/work;dependencies|Namedtests:input->oracle|
|---|---|---|
|T1;`feat(paint): deterministic pressure brush engine [step-18b/T1]`|brushTypes.ts,brush.ts,strokeResampler.ts;U1/U2.|samepath_2vs200events_same_stamps;mousepressure1;penpressure0_minwidth1;flow0_nochange;stroke_oneUndo |
|T2;`feat(paint): fill gradient clone and picker [step-18b/T2]`|fill.ts,gradient.ts,clone.ts;U2.|fill_no_diagonalconnection;gradient_endpoints_exact;clone_samples_prestroke;selection0_untouched |
|T3;`feat(image): non-destructive adjustment layers [step-18b/T3]`|adjustmentLayers.ts,adjustmentWorker.ts,CurvesPanel.tsx;U1/U2.|levels_black0white1gamma1_identity;curves_identity_points;median_noise_deterministic;originaltiles_unchanged |
|T4;`feat(image): editable text shapes rulers guides [step-18b/T4]`|TextLayerEditor.tsx,ShapeLayerEditor.tsx,guides.ts;U1.|text_roundtripUnicode;shape_notSVGexecution;guides_notexported;basic_overlay_conversion_undoable |
|T5;`feat(project): guarded layered image format [step-18b/T5]`|projectTypes.ts,projectCodec.ts;nativeproject.rs/project_tiles.rs;U4.|roundtrip_layers_masks_text; captureR_editRplus1_encodesR;traversal_refused;zstdbomb_refused;unknownoptional_preserved;unknownrequired_noedit |
|T6;`feat(project): PSD import and flattened exports [step-18b/T6]`|psdImport.ts,services/imageProjects.ts,handlers/image-project/index.ts;U3/U4.|PSDunsupported_warningbeforecopy;sourcehash_unchanged;PNGexport_notproject;encoded256MiBcap |
|T7;`docs(help): painting adjustments and projects [step-18b/T7]`|Fourpagesbelow,paint.css;coordinatorwiring/keys/pseudo/performance.|curveskeyboard_points;projectsave_oldrevision_newdirty;sensitivecache_empty |

## Exact file and test allocation

Feature-owned roots: src/image-edit/ brush/project/adjustment/text/guide modules named in tasks; src/services/imageProjects.ts; crates/image-edit/src/project*.rs; src/handlers/image-project/; src/styles/paint.css. Bare filenames in a task expand inside its feature root; native filenames mean src-tauri/src/ unless an explicit crate path is given. The coordinator owns shared App/Explorer/main, settings schemas, manifests/lockfiles, command/handler/IPC registries, generated locales and asset wiring; workers submit exact insertions rather than editing those shared files. Helpers use the producer's fixed entry/action registry through coordinator integration.

Place every named test in task Tn in the corresponding file below. Rust test modules with private feature access are attached by the owning native module; they are not a fictitious standalone src-tauri library. The listed assertions remain unchanged when split into smaller test files.

|Task|Exact test file|
|---|---|
|T1|src/__tests__/step18b-brush.test.ts|
|T2|src/__tests__/step18b-paint.test.ts|
|T3|src/__tests__/step18b-adjustments.test.ts|
|T4|src/__tests__/step18b-text.test.tsx|
|T5|crates/image-edit/tests/step18b_project.rs|
|T6|src/__tests__/step18b-import-export.test.ts|
|T7|src/__tests__/step18b-help.test.ts|

Workers write these tests and fixtures but do not execute any command, install, compile, generate assets or claim results. Coordinator runs targeted checks, complete gate/package, real parser/process/file-safety tests and manual evidence. A mock is not evidence of native confinement, interoperability or performance.

## Coordinator commit labels (workers do not commit)

- feat(paint): deterministic pressure brush engine [step-18b/T1]
- feat(paint): fill gradient clone and picker [step-18b/T2]
- feat(image): non-destructive adjustment layers [step-18b/T3]
- feat(image): editable text shapes rulers guides [step-18b/T4]
- feat(project): guarded layered image format [step-18b/T5]
- feat(project): PSD import and flattened exports [step-18b/T6]
- docs(help): painting adjustments and projects [step-18b/T7]

## Required handoff

Return `handoff/step-18b/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-18b/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
