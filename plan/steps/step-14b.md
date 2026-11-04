# Step 14b: Basic image editing and drawing

|Field|Value|
|---|---|
| State | guide; documentation reviewed; implementation not started |
|Difficulty|4/5|
|Branch|step-14b-image-editor|
|Tag|v0.3.2-step14b|
|Depends on|07a/07g decode;08a conversion/snapshots;09a document controller;09c transfers;09f safe save|
|Written before|07a was built|
|Interface revision|image-document-1;image-render-1|

Guide only. Workers write specified code/tests; coordinator runs dependencies/builds/tests/performance and final integration. No AI enlargement or object removal; Erase is a manual pixel tool.

## Goal and reading

Edit/Draw a shared image document: crop/rotate/flip/resize, adjustments/presets, markup, manual erase, drawing and metadata-preserving export. Layers/selections18a, editable projects/advanced brushes18b. Read v1 step14b, design PNG frames,07a E8/07g E7,08a image options/snapshots,09a controller binding,09c transfer and09f save. Use app-owned Canvas2D/WebGL2/OffscreenCanvas workers; no unverified Fabric/Konva/Pixi dependency. Reuse existing image viewer until editor ready.

## Decisions and algorithms

1. D1. One document-owned `ImageDocument` and worker per document_id. Decode orientation into canonical top-left oriented pixels once, remember original metadata separately. Max100MP,32768dimension,512MiB CPU tiles/256MiB GPU/256MiB history per active document and1GiB total CPU. Tiles256x256RGBA8 unpremultiplied sRGB; row-major, edge tiles retain actual sizes. Readonly original tile versions are immutable. Check multiplication and reserve before allocating. Sensitive documents use memory-only buffers/no cache or project spool.
2. D2. `ImageModel` is immutable metadata plus tile-version references; transactions clone only modified tiles, not full canvases. One committed gesture makes one history state/content_id and09a notifyContentChanged; previews/pointer-move/Compare never mark dirty. Undo/Redo restores tile refs and transforms. History cap1000transactions/256MiB, refuse a new edit that cannot retain required inverse rather than silently lose Undo. Max8open editors, inactive GPU textures released after30s; source/controller remains shared.
3. D3. Geometry order: original oriented pixels -> crop -> rotate/flip -> resize -> adjustments -> overlays. Crop coordinates integer sourcepixels, endexclusive; clip to source, width/height>=1. Presets Free/Original/1:1/16:9/4:3/3:2; dragged crop snaps nearestinteger and clamps inside source. Angle -45..45degrees in0.1increments, positive clockwise about cropcenter; output boundingbox ceil(abs(w cos a)+abs(h sin a)) by analogousheight; transparent corners. Quarter turns before angle; flips in output localaxes. Use explicit3x3affine matrices, never screen coordinates as stored pixels.
4. D4. Resize width/height1..32768 and100MP; lock aspect defaulttrue, derive other side round(source_other*new_primary/source_primary),min1. Percentage1..1000; enlargement requires explicit allow-upscale and no AI claim. Native image helper/Lanczos3 renders final output; worker preview uses same operations at scaledresolution, bounded2MP. Full work off UI thread, Cancel checked per tile. Source32-bit coordinate values not rounded through CSS pixels.
5. D5. Adjustment values: brightness/contrast/saturation/warmth[-1,1], sharpness[0,1], blur radius[0,64]pixels. Work on normalized RGB, clamp0..1 after each stage; alpha unchanged. Brightness adds b; contrast maps(v-0.5)*(1+c)+0.5; saturation uses luminanceY=0.2126R+0.7152G+0.0722B and Y+(v-Y)*(1+s); warmth adds0.1t toR/subtracts0.1t fromB. Sharpness blends original with3x3kernel center5/orthogonal-1; blur separable Gaussian sigma=max(radius/3,0.1), supportceil(radius), edgeclamp. No radius0 convolution.
6. D6. Presets replace adjustment values only, keeping geometry/markup: Original allzero; Vivid contrast0.15/saturation0.2; Warm warmth0.3; Cool warmth-0.3; B/W saturation-1; Sepia matrix rows(0.393,0.769,0.189),(0.349,0.686,0.168),(0.272,0.534,0.131) withclamp andalphaunchanged. Filter thumbnails use same algorithm revision. Compare pointer/button temporarily shows original oriented image fitted to same canvas without changing document state.
7. D7. Brush/pen/highlighter stamps or vector paths are document data, no SVG/HTML execution. Width1..512px,opacity0..1,hardness0..1,colorRGBA; spacing=max(0.5,0.25*width), linear interpolation along accumulateddistance, endpoint once. Coverage1 inside radius*hardness then linearly falls to0 at radius; opacity multiplied by coverage. Normal paint uses source-over in premultiplied math then stores unpremultiplied pixels. Highlighter opacitydefault0.3; Pen hardedge. Erase reduces alpha by factor1-coverage*opacity for transparent output; opaque target composites chosen background at export, never silently replaces transparency. JPEG backgrounddefaultwhite explicitly shown.
8. D8. Markup arrow/rectangle/ellipse/text/highlight are editable overlays until flatten export. Text max10000scalars, font licensed08b Inter, size1..512px, no system font upload without explicit license/authorization; arrow endpoint geometry, shapes bbox/line/fill validated. Draw mode lefttools brush/pen/highlighter/eraser/shapes/arrows/text; properties panel300px. Escape cancels unfinished gesture; pointercancel leaves last committed state, not a partial Undo transaction.
9. D9. Capture freezes the requested immutable model/revision/content_id, then encodes it to PNG unless a source-compatible encoder is explicitly selected; no raw400MiBRGBA snapshot through256MiB snapshot cap. Encoding streams tiles/helper output and fails snapshots.too_large before publishing if encodedbytes>256MiB. Save/SaveCopy use09a immutable content/revision/expected-source binding; export08a QuickConvertDialog takes capturedsnapshot, metadataKeep defaulttrue with exactlosswarning. Orientation normalized1/dimensionsupdated; ICC preserved when adaptercan; no defaultstrip. Schema39 -> 40 adds image_editor.default_mode edit/draw defaultedit,background_rgba[255,255,255,255],history_limit_mb256 fixed64..256.

## Dependencies and frozen exports

|Ref|Producer/task/file/revision|Exact use|
|---|---|---|
|U1|07a E8 thumbnail_decode.rs/07g E7 special_images.rs;preview-foundation-1|DecodedPixels oriented RGBA/dimensions; bounded decodehelper, no JSfullsourceparser|
|U2|08a E1-E7;convert/types.ts/exportSnapshots.ts;conversion-2/export-snapshot-2|ImageOptions/metadata policy/immutable encodedExportSnapshot/content_id/QuickConvertDialog; sharedoutputjobs |
|U3|09a T2;documents/controller.ts/types.ts;tabs-documents-1|DocumentControllerContext/Binding,factory,notifyContentChanged;readRange originalonly,capture currentmodel; shared dirty/savedcontent |
|U4|09c content-transfer-1;09f save capability|Authorized image/text/file offers; source-aware document commits/version hooks; no fake virtualpath |

Canonical `src/image-edit/types.ts`; rendering wire mirrored in `src/image-edit/workerTypes.ts` by imports, not duplicate fields. Native renderer `crates/image-edit/src/types.rs` uses same documented values.

|Type|Exact fields|
|---|---|
|ImageSize/Point/Rect|{width,height} positiveintegers / {x,y}finitenumbers / {x,y,width,height} withpositivewidth/height |
|Affine2D|a,b,c,d,e,f finite; point maps(ax+cy+e,bx+dy+f); determinant nonzero for committedtransforms|
|TileRef|id UUID;tile_x/tile_y nonnegativeinteger; width/height1..256; byte_len=width*height*4; generation positiveinteger; noOSpath|
|ImageAdjustments|brightness,contrast,saturation,warmth,sharpness,blur valuesD5; preset original/vivid/warm/cool/bw/sepia/custom|
|ImageGeometry|crop Rect;quarter_turns0..3;angle_degrees -45..45;flip_x/flip_y bool;output_size ImageSize|
|LayerBase|id UUID;name string1..128;visible booltrue;locked boolfalse;opacity finite0..1;blend normal/multiply/screen/overlay/darken/lighten/difference/add;transform Affine2D;mask_id nullableUUID. Only normal blend and no mask instantiated before18a |
|RasterLayer|LayerBase plus kind raster and tiles TileRef[];14b creates exactly one raster layer |
|TextLayer|LayerBase plus kind text;text string<=10000scalars;font_asset_id string<=128 fromlicensedmanifest;font_size1..512;colorRGBA4u8;bounds Rect;align left/center/right. Reserved strongly typed contract implemented18b |
|ShapeLayer|LayerBase plus kind shape;overlay ImageOverlay with kind arrow/rectangle/ellipse/highlight/stroke. Reserved contract implemented18b |
|AdjustmentLayer|LayerBase plus kind adjustment;adjustment ImageAdjustment. Reserved contract implemented18b |
|ImageAdjustment|tagged curves(points:{x,y}[]2..32 within0..1,strictlyincreasingx,endpoints0/1);levels(black0..1,white>black<=1,gamma0.1..10);hue_saturation(hue_degrees -180..180,saturation -1..1,lightness -1..1);color_balance(shadows/midtones/highlights each RGBshift[-1,1]);gaussian(radius0..64);unsharp(radius0..64,amount0..2);noise_reduce(radius1..8,strength0..1);artistic(mode posterize/emboss/pixelate,amount1..64). No untyped options map |
|ImageLayer|RasterLayer/TextLayer/ShapeLayer/AdjustmentLayer discriminated by kind;14b rejects creation of reserved kinds until18b renderer registered |
|MaskTileRef/ImageMask|MaskTileRef: TileRef fields except byte_len=width*height; alpha8. ImageMask:{idUUID,width,height,invertedboolfalse,tiles MaskTileRef[]}. Mask tools implemented18a |
|MetadataBlobRef|id UUID;category MetadataCategory;byte_len u64<=16MiB;sha25664lowercasehex. Image-local immutable binary blob; per-document metadata total<=16MiB. No OS path or UI JSON bytes |
|ImageOverlay|id UUID;kind stroke/arrow/rectangle/ellipse/text/highlight;points Point[]<=100000;bounds Rect;colorRGBA4u8;width1..512;opacity0..1;text optionalstring<=10000scalars;font_size optional1..512;fill optionalRGBA|
|ImageModel|schema_version1;document_id/content_id UUID;width/height positiveintegers;source_snapshot ExportSnapshot held by document lease;original_tiles TileRef[] preserving original oriented pixels;layers ImageLayer[] exactly1rasterbefore18a; masks ImageMask[]emptybefore18a;geometry ImageGeometry;adjustments ImageAdjustments;overlays ImageOverlay[]<=10000;metadata MetadataBlobRef[]<=16; noUIselection. Future layer types are fixed here for parallel consumers but unavailable until their implementing steps |
|ImageOperation|tagged set_geometry(geometry),set_adjustments(adjustments),add_overlay(overlay),update_overlay(id,replacement),remove_overlay(id),paint_stroke(layer_id,points,color,width,hardness,opacity,modepaint/erase); validatewholetransaction|

|Ref|Exact export/signature|Consumers|
|---|---|---|
|E1|image-edit/ImageDocument.ts acquireImageEditor(document:DocumentHandle)->Promise<ImageController>|14b/18a/b; onecontroller/document|
|E2|ImageController getModel()->Readonly<ImageModel>;subscribe(listener)->unsubscribe;apply(operation:ImageOperation)->Promise<void>;undo/redo()->Promise<void>;capture(revision:number,contentId:string)->Promise<ExportSnapshot>;release()->void|09a factorybinding, sharedmodel/encodedcapture|
|E3|image-edit/render.ts renderImage(model:Readonly<ImageModel>,options:{edge:number<=8192,region?:Rect,compare_original:boolean})->Promise<ImageRenderLease>|ImageRenderLease{idUUID,width,height,bitmapImageBitmap,release()->void}; runtimeonly, noJSON/session|
|E4|image-edit/coordinates.ts imageToViewport(point:Point,matrix:Affine2D)->Point;viewportToImage(point,matrix)->Point|18a/b tools; singularmatrix returnsimage_edit.bad_request|
|E5|image-edit/ImageEditor.tsx ImageEditor(props:VirtualViewProps)|Existing imagehandler upgradedwith editor, notduplicateMIMEclaim|
|E6|image-edit/transactions.ts commitImageTransaction(documentId:string,expectedContentId:string,transform:(current:Readonly<ImageModel>)->ImageModel)->Promise<void>|Trusted18a/b modules only; compare content_id,validate/reserve complete new model and inverse,assignnewcontentID/notify once; callback never crossesIPC |
|E7|image-edit/tiles.ts getImageTileStore(documentId:string)->ImageTileStore; ImageTileStore.read(id:string)->Promise<Uint8Array>;publish(width:number,height:number,rgba:Uint8Array)->Promise<TileRef>;publishMask(width,height,alpha:Uint8Array)->Promise<MaskTileRef>;pin(ids:readonlystring[])->()=>void|Returnsownedbytecopies; immutablepublishedtileIDs; validatesbytecount/budget; pinreleaseidempotent;18a/b workeronly, neverbytesinUIJSON |
|E8|image-edit/metadata.ts publishImageMetadata(documentId:string,category:MetadataCategory,bytes:Uint8Array)->Promise<MetadataBlobRef>;readImageMetadata(documentId:string,id:string)->Promise<Uint8Array>|Trusted worker/helper interface; validates supported format/category and16MiBtotal; returns owned copy; sensitive memory-only;18b project codec uses these exact methods |

Errors image_edit.bad_request/read_only/too_large/history_full/changed/failed; snapshots.too_large from08a. No new bypass-save command. Native helper image.edit.render/encode uses07d grant/memory host or nativebinaryframing08a; bytes neverUIJSON.

## UI/text/commands

Toprow40px Undo/Redo/Compare,Edit|Draw,zoom,Export/Savecopy/Save. Toolrail48pxleft; properties300pxright; canvasmin0overflowhidden;status28px. `.adp-image-editor` grid48px minmax(0,1fr)300px;`.adp-image-properties` padding16,gap12;`.adp-crop-overlay` rule-of-thirds at1/3and2/3, labels outsidecropboundsclampedviewport. Atwidth<900properties becomesFlyout. Canvas has focusable roleapplication onlywhiletoolactive and fulltexttoolinstructions; toolbar/keyboard alternatives for cropfields/rotation/size. All UItokens; imagecolors remaincontentdata.

|Keys|English|Spanish|
|---|---|---|
|imageEdit.edit / imageEdit.draw / imageEdit.compare / imageEdit.crop / imageEdit.size / imageEdit.adjust / imageEdit.filters / imageEdit.markup / imageEdit.erase|Edit / Draw / Compare / Crop / Size / Adjust / Filters / Markup / Erase|Editar / Dibujar / Comparar / Recortar / Tamaño / Ajustar / Filtros / Marcas / Borrar|
|imageEdit.free / imageEdit.original / imageEdit.rotateLeft / imageEdit.rotateRight / imageEdit.flipHorizontal / imageEdit.flipVertical|Free / Original / Rotate left / Rotate right / Flip horizontally / Flip vertically|Libre / Original / Girar a la izquierda / Girar a la derecha / Voltear horizontalmente / Voltear verticalmente|
|imageEdit.brightness / imageEdit.contrast / imageEdit.saturation / imageEdit.warmth / imageEdit.sharpness / imageEdit.blur|Brightness / Contrast / Saturation / Warmth / Sharpness / Blur|Brillo / Contraste / Saturación / Calidez / Nitidez / Desenfoque|
|imageEdit.vivid / imageEdit.warm / imageEdit.cool / imageEdit.bw / imageEdit.sepia|Vivid / Warm / Cool / B/W / Sepia|Vívido / Cálido / Frío / Blanco y negro / Sepia|
|imageEdit.brush / imageEdit.pen / imageEdit.highlighter / imageEdit.shapes / imageEdit.arrow / imageEdit.text|Brush / Pen / Highlighter / Shapes / Arrow / Text|Pincel / Pluma / Resaltador / Formas / Flecha / Texto|
|imageEdit.width / imageEdit.hardness / imageEdit.opacity / imageEdit.background / imageEdit.transparent|Size / Hardness / Opacity / Export background / Transparency|Tamaño / Dureza / Opacidad / Fondo de exportación / Transparencia|
|imageEdit.opaqueWarning|This format fills transparent pixels with the chosen background.|Este formato rellena los píxeles transparentes con el fondo elegido.|
|errors.image_edit.failed / errors.image_edit.history_full|This image edit could not be completed. / This edit exceeds the retained Undo limit.|No se pudo completar esta edición de imagen. / Esta edición supera el límite del historial de Deshacer.|

All dimensions/percentages useformat.ts; common.save/saveCopy/cancel reused. Commands image.edit/draw/compare/crop/size/adjust/filters/markup/erase,correspondingkeys,icons SlidersHorizontal/Pencil/Columns2/Crop/Scaling/SlidersHorizontal/Wand2/Shapes/Eraser;noAImeaning/shortcut;helppagesbelow. Errorsothercodesmapfailedwithstablecode.

## Tasks

|Task;commit|Files and ordered work;dependencies|Namedtests:input->oracle|
|---|---|---|
|T1;`feat(image): shared tiled document controller [step-14b/T1]`|image-edit/types.ts,ImageDocument.ts,tiles.ts,history.ts;U1/U3;decodeonce/reserve/mutabletransactioncommit.|two_views_share_tiles;100MPplus1_refused;undo_savedcontent_clean;compare_does_not_increase_revision|
|T2;`feat(image): crop transform resize [step-14b/T2]`|geometry.ts,coordinates.ts,CropOverlay.tsx;nativegeometry.rs;U1/E4.|rotate90_3x2_becomes2x3;resize400x200_width100=>100x50;crop_endexclusive_2x2;inverse_roundtrip_error<1e-6|
|T3;`feat(image): deterministic adjustments and presets [step-14b/T3]`|adjustments.ts,filters.ts,worker.ts;nativeadjustments.rs;U2/E3.|brightness0.1_on0.5=>0.6;contrast0_on0.3=>0.3;saturationminus1_givesYallchannels;alpha_unchanged;blur0_identity|
|T4;`feat(image): markup drawing and manual erase [step-14b/T4]`|brush.ts,overlays.ts,DrawTools.tsx;U3/U4.|erase_fullcoverage_alpha255=>0;halfopacity_alpha255=>128roundnearest;stroke_spacing_eventrate_independent;pointercancel_no_partialcommit|
|T5;`feat(image): edit and draw interface [step-14b/T5]`|ImageEditor.tsx,ImageProperties.tsx,image-edit.css;E1-E5.|keyboard_crop_fields_apply;inactive_view_no_pointercommands;200percent_controls_visible;compare_release_returnsedited|
|T6;`feat(image): encoded snapshot save and export [step-14b/T6]`|encode.ts,nativeimage_encode.rs;09a binding;U2/U3.|snapshot_encoded_not_RGBA;256MiBplus_refused_beforepublish;JPEG_alpha_background_explicit;ICC_keep_or_lossack;savecopy_notclean|
|T7;`docs(help): image editing and drawing [step-14b/T7]`|Sixpagesbelow,coordinator schema40/keys/factory/measure/report.|metadata_default_keep;protected_apply_refused;neweredits_dirty_after_oldsave;alltoolshelp|

## Exact file and test allocation

Feature-owned roots: src/image-edit/; crates/image-edit/src/; src-tauri/src/image_encode.rs; src/styles/image-edit.css. Bare filenames in a task expand inside its feature root; native filenames mean src-tauri/src/ unless an explicit crate path is given. The coordinator owns shared App/Explorer/main, settings schemas, manifests/lockfiles, command/handler/IPC registries, generated locales and asset wiring; workers submit exact insertions rather than editing those shared files. Helpers use the producer's fixed entry/action registry through coordinator integration.

Place every named test in task Tn in the corresponding file below. Rust test modules with private feature access are attached by the owning native module; they are not a fictitious standalone src-tauri library. The listed assertions remain unchanged when split into smaller test files.

|Task|Exact test file|
|---|---|
|T1|src/__tests__/step14b-model.test.ts|
|T2|src/__tests__/step14b-geometry.test.ts|
|T3|crates/image-edit/tests/step14b_adjustments.rs|
|T4|src/__tests__/step14b-drawing.test.ts|
|T5|src/__tests__/step14b-ui.test.tsx|
|T6|src-tauri/src/image_encode_step14b_tests.rs|
|T7|src/__tests__/step14b-help.test.ts|

Workers write these tests and fixtures but do not execute any command, install, compile, generate assets or claim results. Coordinator runs targeted checks, complete gate/package, real parser/process/file-safety tests and manual evidence. A mock is not evidence of native confinement, interoperability or performance.

## Full help

editing-images.md — English **Editing images**: “Open an image and choose Edit. Choose a tool, inspect its preview and apply the change. Undo or Redo changes your edit history; Compare shows the original without changing it. Save a copy keeps the original. Export chooses another format and explains metadata or transparency changes. See also: Cropping and resizing; Drawing on images.” Spanish **Editar imágenes**: “Abre una imagen y elige Editar. Selecciona una herramienta, revisa la vista previa y aplica el cambio. Deshacer y Rehacer recorren el historial; Comparar muestra el original sin cambiarlo. Guardar una copia conserva el original. Exportar elige otro formato y explica cambios de metadatos o transparencia. Consulta también: Recortar y cambiar el tamaño; Dibujar en imágenes.”

image-crop-resize.md — English **Cropping and resizing**: “Choose Crop and a ratio, drag the handles or enter the crop values, then rotate or flip if needed. Size changes pixels or percentage; keep proportions to avoid distortion. Enlargement does not invent new detail. Review transparent corners after rotation and export dimensions before saving. See also: Editing images.” Spanish **Recortar y cambiar el tamaño**: “Elige Recortar y una proporción, arrastra los controles o introduce los valores y gira o voltea si hace falta. Tamaño cambia píxeles o porcentaje; conserva las proporciones para evitar deformaciones. Ampliar no inventa detalles nuevos. Revisa las esquinas transparentes tras girar y las dimensiones de exportación antes de guardar. Consulta también: Editar imágenes.”

image-adjustments.md — English **Adjustments and filters**: “Choose Adjust to change brightness, contrast, saturation, warmth, sharpness or blur. Filters apply a named preset; Original resets adjustments while keeping your crop and marks. Compare checks the untouched source. Changes remain undoable until their history limit is reached. See also: Editing images.” Spanish **Ajustes y filtros**: “Elige Ajustar para cambiar brillo, contraste, saturación, calidez, nitidez o desenfoque. Filtros aplica un ajuste preestablecido; Original restablece los ajustes y conserva recortes y marcas. Comparar muestra el origen intacto. Los cambios se pueden deshacer dentro del límite del historial. Consulta también: Editar imágenes.”

image-markup.md — English **Image markup**: “Choose Markup and add an arrow, shape, text or highlight. Select the mark to change its color, size or position. Text stays editable in the open document; ordinary image export flattens marks into pixels. Use an editable project when that feature is available. See also: Drawing on images.” Spanish **Marcas en imágenes**: “Elige Marcas y agrega una flecha, forma, texto o resaltado. Selecciona la marca para cambiar color, tamaño o posición. El texto sigue editable en el documento abierto; la exportación a una imagen normal convierte las marcas en píxeles. Usa un proyecto editable cuando esa función esté disponible. Consulta también: Dibujar en imágenes.”

image-erasing.md — English **Erasing pixels**: “Choose Erase and set size, hardness and opacity. Brush over the pixels to remove; Undo restores a stroke. PNG and WebP can keep transparency. Formats without transparency use the chosen export background and show a warning. This tool removes pixels manually; it does not reconstruct an object or background. See also: Drawing on images.” Spanish **Borrar píxeles**: “Elige Borrar y configura tamaño, dureza y opacidad. Pasa el pincel sobre los píxeles que quieras quitar; Deshacer restaura una pincelada. PNG y WebP pueden conservar transparencia. Los formatos sin transparencia usan el fondo de exportación elegido y muestran un aviso. Esta herramienta quita píxeles manualmente; no reconstruye objetos ni fondos. Consulta también: Dibujar en imágenes.”

image-drawing.md — English **Drawing on images**: “Switch to Draw and choose Brush, Pen, Highlighter, Erase, a shape, arrow or text. Set color and size in the properties panel. Each completed stroke is one undoable change. Escape cancels the unfinished gesture. Save a copy or export when finished. See also: Image markup; Erasing pixels.” Spanish **Dibujar en imágenes**: “Cambia a Dibujar y elige Pincel, Pluma, Resaltador, Borrar, una forma, flecha o texto. Configura color y tamaño en el panel de propiedades. Cada pincelada terminada es un cambio que se puede deshacer. Esc cancela el gesto sin terminar. Guarda una copia o exporta al terminar. Consulta también: Marcas en imágenes; Borrar píxeles.”

## Fixtures, checks, speed, screenshots, completion

Retain synthetic RGBA4x3 with labeledcornercolors/alpha0and255, orientedJPEG2x3 withknownEXIF/ICC/GPS,24MPphoto licensedtestfixture,100MPboundary fixture. Coordinator checks everygeometry/filter/eraser/color/background/metadata/Undo/compare/protected/savecopy/concurrentview path and unchangedsource hashes. Sensitivepath mustcreatezero plaintextcachefiles. Spanishdark/pseudo/keyboard/200%zoom.

Measure step14b.edit.ready Fast1s, tool.apply Instant100ms, stroke/preview Smooth16ms; heavyfullrender job withprogressCancel. Reserve153-image-edit,154-image-draw,155-image-export inthreevariants. Done: deterministic geometry/color/alpha semantics, tiledboundedhistory/sharedrevisions, encodedsnapshots, metadata/transparencylossack, safe save and coordinator-run pixel/roundtrip/accessibility/performance evidence. No AI dependency.

AI image tools are additive providers, not replacements for these deterministic tools:14c Enlarge with AI and17b foreground/background/inpaint actions capture the current immutable image content_id/selection, show a crop/before-after preview and apply one14b commitImageTransaction only after user acceptance/revision match. Manual Erase stays its own control.17b owns exact AiActionRequest/preview/result fields; no remote API fallback for these local image engines. Missing pack opens12a App storage; optional AI result cannot silently replace pixels or lower the source/alpha/metadata safety rules.

## Encoded capture MIME registration

T1 native image-controller registration calls08a SnapshotAuthorityRegistry.permit_capture_mime(document_id,"image/png") before any PNG capture, including18a selectedPixels. It also registers image/jpeg and image/webp only when their actual source-compatible encoders and preservation/alpha policies are available; unsupported encoder MIME is not advertised. These are static trusted provider calls, not UI commands. The source MIME remains descriptive and the existing authority/source/sensitive policy is retained. D9 and T6 snapshot begin choose only one of these registered MIME values. Editing a JPEG and capturing PNG is valid without creating a second ordinary authority; an unknown MIME fails snapshot.bad_request. Capture returns the supplied captured revision/content_id even if a later edit occurs during encoding. T1/T6 add jpeg_source_png_capture_authorized, unavailable_encoder_mime_refused, sensitive_authority_not_downgraded and encodeR_editRplus1_preserves_captureR tests.
