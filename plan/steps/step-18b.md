# Step 18b: Painting, adjustment layers and editable image projects

|Field|Value|
|---|---|
| State | guide; documentation reviewed; implementation not started |
|Difficulty|5/5|
|Branch|step-18b-image-projects|
|Tag|v0.5.2-step18b|
|Depends on|14b image-document-1;18a image-layers-1/selection-mask-1;07g PSD;08a/b export|
|Written before|07a was built|
|Interface revision|image-project-1;image-brush-1|

Guide only; workers write code/tests, coordinator executes verification. No model denoising/object removal/upscaling. All algorithms below are deterministic manual editing.

## Goal and reading

Paint with pressure, fill/gradient/clone, use editable text/shapes/adjustment layers, rulers/guides and a documented project that round-trips layers/masks. Read v1 step18b,14b types/E1-E7,18a compositing/selections,07g ag-psd34.1.0 source,06d guardedZIP,existingzstd0.14. No new rendering/archive library.

## Decisions

1. D1. Extend the same image controller, model and tile store. Enable TextLayer, ShapeLayer and AdjustmentLayer already declared in14b. Paint only the selected unlocked raster layer through selection coverage. Each completed gesture stores immutable before/after tile references and makes one Undo entry/content_id. Preview must match committed pixels within1u8; never copy the whole image on each pointer event.
2. D2. Brush settings: width1..2048px, hardness/opacity/flow0..1, spacing0.01..2 diameters; defaults20/0.8/1/1/0.25. Place stamps by accumulated arc length, interpolating position/pressure/tilt; emit identical endpoints regardless of event batching. Pen pressure is clamped0..1, mouse pressure is1. pressure_size=true uses max(1,width*sqrt(pressure)); pressure_opacity defaults false. Stamp alpha equals coverage*opacity*flow*selection/255. Painting uses source-over, erasing destination-out. No random jitter.
3. D3. Fill uses4-connected flood selection with18a tolerance and cancellation every4096 pixels, writing only changed tiles. Linear/radial gradients have2..32 ordered stops within0..1 and interpolate premultiplied linear RGB; coincident control points are refused. Clone requires an Alt-click anchor, keeps a fixed stroke offset and samples immutable pre-stroke pixels from the selected layer or composite. It never samples its own new paint. Eyedropper samples the current composite including alpha.
4. D4. Adjustment layers operate oncompositebelowthem,masked/opacityweighted; originaltilesunchanged. Curves piecewiselinear throughspecifiedpoints; levels outputclamp((v-black)/(white-black))^(1/gamma); hue_saturation HSLhuewrap/saturationandlightnessclamp; colorbalance weights shadows=max(0,1-2Y),highlights=max(0,2Y-1),midtones=1-shadows-highlights thenaddweightedRGBshifts; Gaussian/unsharp reuse14b,unsharp=original+amount*(original-blur). Non-AI noise_reduce blendsoriginalwithlocalchannelmedian bystrength. Artistic posterize rounds(v*(levels-1))/(levels-1),levels2..64;emboss uses3x3kernel(-2,-1,0;-1,1,1;0,1,2)+0.5,pixelate averagesblocksround(amount)1..64. Alphaunchangedexceptexplicitmask/paint.
5. D5. Text keeps Unicode content, licensed font asset, size, color, bounds and alignment. Shapes keep the14b typed overlay; no executable SVG. Explicitly converting basic overlays creates one editable layer per overlay in a single undoable action. Rulers support pixels/cm/inches using project DPI96 by default, allowed1..2400. At most1000 x/y guides; snap threshold6 CSS pixels converted by zoom. Guides never export. Zoom10..3200%; optional pixel grid appears from800%.
6. D6. `.adimage` is guardedZIP schema1: required `document.json`, tilepayloads `tiles/<UUID>.rgba.zst`, masks `masks/<UUID>.alpha.zst`, optionalvalidatedmetadata `metadata/<category>.bin`. Manifest fieldsbelow; entrynamesstrictallowlist,nostagingunpack,symlink/traversal/duplicate/unknownrequiredentryrefused. Archive<=256MiB,decodedtilebytes<=512MiB,totalentries<=100000,100MP/256layers/1000guides. ZIP stores already-compressed tile entries without a second compression layer; JSON/metadata ZIP expansion ratio<=1000. Zstd tiles use exact small dimensions/decoded-length and total-byte limits rather than a ratio cap, so a uniform transparent tile can round-trip despite high compression. EachpayloadhashSHA256,length/dimensionsverifiedbeforeallocation/decode; zstdstreamboundedbydeclaredrawlength andcancellation. PlainRGBAbyteorderrow-majorRGBA8andalpha8masks; noGPUformatpersisted.
7. D7. The durable manifest stores image content, never ExportSnapshot IDs, grants, passwords or runtime handles. original_tile_ids preserve Compare without the original photo path. Metadata is validated before copying. Optional namespaced extensions are opaque, non-executable and preserved byte-for-byte, <=1MiB each/16MiB total. An unknown required extension or newer schema refuses editing. Save uses an encoded ZIP snapshot and refuses compressed output above256MiB before publication; the central directory and validation must complete first.
8. D8. PSD import uses07g isolation and ag-psd only for proved raster layers, names, blend, opacity, visibility and masks. List unsupported smart objects/effects/text features before accepting a flattened copy. Never promise editable PSD round-trip or offer PSD Save. Export PNG/JPEG/WebP/TIFF through08a and PDF through08b, with flattening/metadata/transparency disclosures. Sensitive projects remain memory-only until an authorized provider save or explicit unprotected export decision.
9. D9. Keep settings schema48. Brush presets are app-owned schema1 data, max100, containing only names and bounded BrushSettings. No executable brushes, scripts or automatic downloads. Project handler image-project owns extension adimage, MIME application/vnd.adperastra.image-project+zip, image accent and image-projects help. The existing image handler keeps ordinary flattened formats.

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

## Full help

painting-tools.md — English **Painting tools**: “Choose Brush, Erase, Fill, Gradient or Clone stamp. Set size, hardness, opacity, flow and spacing; a pen can control size by pressure. Alt-click sets the clone source. Each completed stroke is one undoable change. Selection masks restrict affected pixels. These tools are deterministic and use no AI model. See also: Image selections.” Spanish **Herramientas de pintura**: “Elige Pincel, Borrar, Rellenar, Degradado o Tampón de clonar. Configura tamaño, dureza, opacidad, flujo y espaciado; un lápiz puede controlar el tamaño con presión. Alt-clic fija el origen de clonado. Cada pincelada terminada es un cambio que se puede deshacer. Las máscaras de selección limitan los píxeles afectados. Son herramientas deterministas sin modelos de IA. Consulta también: Selecciones de imagen.”

adjustment-layers.md — English **Adjustment layers and filters**: “Add an adjustment layer for curves, levels, color, blur, sharpening or noise reduction. Change its values, opacity or mask without rewriting the original pixels. Reorder it to change which layers it affects. Disable it to compare and Undo to reverse a change. Export uses the same adjustment math as the preview. See also: Image layers.” Spanish **Capas de ajuste y filtros**: “Agrega una capa de ajuste para curvas, niveles, color, desenfoque, nitidez o reducción de ruido. Cambia valores, opacidad o máscara sin reescribir los píxeles originales. Reordénala para cambiar las capas afectadas. Desactívala para comparar y usa Deshacer para revertir. La exportación usa los mismos cálculos que la vista previa. Consulta también: Capas de imagen.”

image-text-shapes.md — English **Editable text and shapes**: “Add a text or shape layer and edit its content or properties in the panel. Fonts come from the verified licensed inventory. Rulers and guides help align content but do not appear in exports. Ordinary image export flattens these layers; Save editable project keeps them editable. See also: Saving image projects.” Spanish **Texto y formas editables**: “Agrega una capa de texto o forma y edita su contenido o propiedades en el panel. Las fuentes proceden del inventario verificado con licencia. Las reglas y guías ayudan a alinear, pero no aparecen al exportar. La exportación normal aplana estas capas; Guardar proyecto editable las conserva editables. Consulta también: Guardar proyectos de imagen.”

image-projects.md — English **Saving image projects**: “Use Save editable project to create an .adimage file with layers, masks, adjustments, text and tile data. Reopen it to continue editing; it does not depend on the original photo path. Export PNG, JPEG, WebP, TIFF or PDF for a flattened copy. PSD import shows unsupported features before creating a copy; it does not promise editable PSD round-tripping. Keep the project as well as exported images. See also: Image layers.” Spanish **Guardar proyectos de imagen**: “Usa Guardar proyecto editable para crear un archivo .adimage con capas, máscaras, ajustes, texto y datos de píxeles. Ábrelo de nuevo para continuar; no depende de la ruta de la foto original. Exporta PNG, JPEG, WebP, TIFF o PDF para una copia aplanada. Importar PSD muestra funciones no compatibles antes de crear una copia; no promete guardar y reabrir PSD editable sin cambios. Conserva el proyecto además de las imágenes exportadas. Consulta también: Capas de imagen.”

## Checks/speed/screenshots/done

Retain4x4brush/gradient/clonefixtures,penrecordedpressures0/0.25/1,24MP3layerprojectwithmask/text/curves,PSDsmartobjectspecimen,malformedZIP/bomb/unknownextensions. Coordinatorchecksstrokeevent-rateinvariance,blend/pixels/projectsave-reopeneditableexactness/fontwarnings/exportalpha/metadata/Undo/cancel/sourcehashes/sensitivepolicy;Spanishdark/pseudo/keyboard/200%zoom. Measure step18b.brush Smooth16ms,toolInstant100ms,projectfirstviewFast1s withdeferredtiles,savejobfeedback. Reserve178-image-paint,179-image-project threevariants. Done:boundedtileprojectroundtrip,typedsharedmodel,deterministicnon-AIbrush/filters,exactmetadata/unknownextensionpolicyandreviewer-runframe/pixel/archive/securityevidence.

AI image tools are additive providers, not replacements for these deterministic tools:14c Enlarge with AI and17b foreground/background/inpaint actions capture the current immutable image content_id/selection, show a crop/before-after preview and apply one14b commitImageTransaction only after user acceptance/revision match. Manual Erase stays its own control.17b owns exact AiActionRequest/preview/result fields; no remote API fallback for these local image engines. Missing pack opens12a App storage; optional AI result cannot silently replace pixels or lower the source/alpha/metadata safety rules.
