# Step 18a: Image layers, masks, selections and transforms

|Field|Value|
|---|---|
| State | guide; documentation reviewed; implementation not started |
|Difficulty|5/5|
|Branch|step-18a-image-layers|
|Tag|v0.5.1-step18a|
|Depends on|14b image-document-1/image-render-1;09a controller;09c content transfer|
|Written before|07a was built|
|Interface revision|image-layers-1;selection-mask-1|

Guide only; code/tests written by workers, execution by coordinator. The deterministic layer/selection tools depend on14b.17d is included separately and is not a dependency of these tools. No AI selection/removal, project persistence18b or independent image-editor framework.

## Goal and reading

Combine images as layers, use masks/blends and precise selections/transforms, and export a flattened image while retaining Undo. Read v1 step18a,14b exactImageModel/LayerBase/RasterLayer/ImageMask/E1-E7,09a sharedcontroller,09c transfer. Use app-owned tiled WebGL2 worker, existing14b Canvas fallback and budgets; no new rendering library.

## Decisions

1. D1. Extend the existing14b ImageModel, controller and tile store. Layers are ordered bottom to top, with1..256 layers. This step creates raster layers only;18b enables text, shape and adjustment kinds. Advanced switches tools without changing document identity. Imports copy authorized captured pixels into owned immutable tiles; original files stay untouched. Basic overlays stay separate and render last until an explicit18b conversion.
2. D2. Support add, duplicate, delete, reorder, rename, visibility, lock, opacity, blend, masks, merge down and flatten. Keep at least one layer. Locked layers refuse painting, transforms and deletion; visibility may toggle. Duplicates share immutable tiles until editing. Merge down combines the selected layer and its immediate predecessor, preserving all other layers. Flatten requires confirmation. Each operation reserves its exact inverse before committing; refuse if Undo cannot fit.
3. D3. Layer transforms use Affine2D in canonical canvas pixels, positive clockwise rotation and a default pivot at the layer bounds center. Scale must be0.001..1000 and the matrix invertible. Preview is temporary; Apply commits once. Resample premultiplied linear RGB bilinearly, then unpremultiply; outside pixels are transparent. Selection masks use canvas coordinates. Linked masks transform atomically with their layer. Existing14b crop/geometry applies after layer composition.
4. D4. Composite bottom-up in linearRGB; decode sRGB via standardpiecewise transfer (v/12.92 below0.04045,otherwise((v+0.055)/1.055)^2.4). Effective sourcealpha=tilealpha*layeropacity*maskcoverage. Outputalpha=as+ab*(1-as). Premultiplied outputcolor=as*(1-ab)*Cs+as*ab*B(Cs,Cb)+(1-as)*ab*Cb. Divide byoutputalpha when>0,encode sRGB; alpha0 storesRGB0. Blend normal=Cs,multiply=CsCb,screen=Cs+Cb-CsCb,overlay=2CsCb whenCb<=0.5else1-2(1-Cs)(1-Cb),darken=min,lighten=max,difference=abs,add=min(1,Cs+Cb). SameCPU/GPUreferencevectors, roundingnearestu8.
5. D5. Selections are tiled alpha8 masks, with explicit empty/full states and bounds. Rectangle/ellipse test pixel centers; lasso/polygon uses even-odd fill, at least3 distinct vertices and at most100000. Magic wand uses4-connected flood fill and linear-RGB Euclidean distance divided by sqrt(3), accepted when <=tolerance/100. Transparent pixels match only a transparent seed. Select by color applies the same criterion globally. Workers check cancellation every4096 pixels; visited storage is bounded by100MP.
6. D6. Selection replace uses b; add uses max(a,b); subtract uses max(a-b,0); intersect uses min(a,b); invert uses255-a. Feather radius0..128 uses a separable Gaussian with sigma=max(radius/3,0.1), zero outside the canvas and nearest-integer alpha. Selection changes are view/tool state with local bounded Undo, not document content changes. Applying a selection to paint, cut or a mask is a document transaction. A new mask copies the current selection; no selection means full255 coverage.
7. D7. Copy explicitly captures the selected layer or the composite. Cut removes pixels only after the immutable transfer offer was created successfully, in one document transaction. Paste creates a raster layer. Use09c envelopes and native snapshot leases; never trust arbitrary drag JSON. Cross-document moves are copy-only unless09c proves atomic move. Sensitive copies leaving their provider require the explicit09c decision.
8. D8. The14b CPU512MiB, GPU256MiB and history256MiB budgets cover all layers and masks together. Render only viewport tiles plus one overscan ring. Ignore stale composition generations; release GPU leases after30s inactive or on close. Schema47 -> 48 adds image_editor.advanced=false, selection_tolerance=15 within0..100 and show_history=false. Sessions store tool/layer IDs/zoom only, never tiles.

## Dependencies/types/exports

|Ref|Producer/task/file/revision|Exact contract|
|---|---|---|
|U1|14b T1-T6 E1-E7;image-edit/types.ts,transactions.ts,tiles.ts;image-document-1|ImageModel/ImageLayer/LayerBase/RasterLayer/ImageMask/TileRef/Affine2D;acquireImageEditor/commitImageTransaction/getImageTileStore; no copied sharedtypes|
|U2|14b E3/E4;render.ts/coordinates.ts;image-render-1|renderImage and ImageRenderLease.release;viewportToImage/imageToViewport; same transform conventions |
|U3|09a T2;controller.ts;tabs-documents-1|content_id/revision/immutablecapture/dirty/savedstate,document-ownedhistory andsinglefactory |
|U4|09c content-transfer-1;contentTransfer.ts/TransferRegistry.ts|Validatedsnapshot/imagepayloads andleases;protectedtargetcannotaccept |

Canonical new `src/image-edit/layerTypes.ts`, selectionTypes.ts;14bcanonicaltypes imported. No changed meaning of14bfilepaths/fields.

|Type|Fields|
|---|---|
|SelectionMask|id UUID;width/heightcanvasdimensions;tiles MaskTileRef[];bounds Rectnullable;kind empty/full/tiles;generation positiveinteger; noOSpath |
|SelectionOperation|tag rectangle(rect),ellipse(rect),polygon(points),wand(seed,tolerance),color(seedColorRGBA,tolerance),invert,feather(radius),clear; eachhasmode replace/add/subtract/intersectexceptlastthree |
|LayerOperation|add(layer:RasterLayer,index0..count),duplicate(id),remove(idsUUID[]),reorder(idsfullpermutation),rename(id,name1..128),visibility(id,bool),lock(id,bool),opacity(id,0..1),blend(id,BlendMode),transform(ids,matrix,linked_maskbool),mask(id,ImageMask|null),merge_down(id),flatten |
|LayerSelectionState|active_layer_id UUID;selected_layer_ids UUID[]<=256;selection SelectionMask;tool rectangle/ellipse/lasso/polygon/wand/color/move/transform;viewonly |

|Ref|Export/signature|Consumers|
|---|---|---|
|E1|image-edit/layers.ts applyLayerOperation(documentId:string,expectedContentId:string,operation:LayerOperation)->Promise<void>|18b andLayerPanel; delegates14bE6singlecommit |
|E2|image-edit/selections.ts applySelection(current:SelectionMask,operation:SelectionOperation,source:Readonly<ImageModel>)->Promise<SelectionMask>|18b brush/fill/clone; sourcecapturedimmutable; workeronly |
|E3|image-edit/composite.ts compositeRegion(model:Readonly<ImageModel>,region:Rect)->Promise<ImageRenderLease>|18b export/eyedropper; same14brenderlifetime, noindependentcache |
|E4|image-edit/selectionPixels.ts selectedPixels(model:Readonly<ImageModel>,capturedRevision:number,selection:SelectionMask,layerId:string|null)->Promise<ExportSnapshot>|09c copy/paste; encodedPNG<=256MiB, document_id/content_id from immutable model;capturedRevision safeinteger>=1 captured atomically with model by09a controller; never read current revision after encoding; native authority permits image/png only through14b registration. nullmeanscomposite |
|E5|image-edit/LayersPanel.tsx props document:DocumentHandle,controller:ImageController,state:LayerSelectionState,onStateChange(state)->void|Panel300px;14bAdvancedpresentercomposesit, nosecondDocumentRegistry |

Errors image_layers.bad_request/locked/last_layer/too_large/history_full/changed/failed;14bhistory/memoryerrorspropagatewithoutweakenedlimits.

## UI and exact texts

Advanced besideEdit/Draw. LayersPanel300pxright; rows48pxthumbnail32x32,visibilitytoggle,name,lock; opacityslider/blendselecttop; actionsbottom32px. Historypanel optional196pxleft, selectionpropertiesinexistingpanel. `.adp-layer-row` grid24px32px minmax(0,1fr)24px,gap8,padding4;selectedsurface/focusfromtokens. No color-only visibility;accessiblelabelincludeslayername. KeyboardUp/Downselection,Spacevisibilitywhenrowfocused,F2rename,Alt+Up/Downreorder;documenttextinputskeepkeys. Numerictransformdialog520pxandselectionfieldsprovidekeyboardalternatives.

|Keys|English|Spanish|
|---|---|---|
|layers.advanced / layers.title / layers.add / layers.duplicate / layers.delete / layers.merge / layers.flatten|Advanced / Layers / Add layer / Duplicate layer / Delete layer / Merge down / Flatten image|Avanzado / Capas / Agregar capa / Duplicar capa / Eliminar capa / Combinar hacia abajo / Aplanar imagen|
|layers.visible / layers.locked / layers.opacity / layers.blend / layers.mask / layers.history|Visible / Locked / Opacity / Blend mode / Layer mask / History|Visible / Bloqueada / Opacidad / Modo de fusión / Máscara de capa / Historial|
|selection.rectangle / selection.ellipse / selection.lasso / selection.polygon / selection.wand / selection.color|Rectangle / Ellipse / Lasso / Polygon lasso / Magic wand / Select by color|Rectángulo / Elipse / Lazo / Lazo poligonal / Varita mágica / Seleccionar por color|
|selection.replace / selection.add / selection.subtract / selection.intersect / selection.invert / selection.feather|Replace selection / Add / Subtract / Intersect / Invert / Feather|Reemplazar selección / Agregar / Restar / Intersecar / Invertir / Suavizar borde|
|layers.flattenWarning / errors.image_layers.failed|Flattening combines the layers. You can undo before the history limit is reached. / This layer operation could not be completed.|Aplanar combina las capas. Puedes deshacer dentro del límite del historial. / No se pudo completar esta operación de capas.|

Blendlabels underlayers.blend.<mode> English Normal/Multiply/Screen/Overlay/Darken/Lighten/Difference/Add;Spanish Normal/Multiplicar/Trama/Superponer/Oscurecer/Aclarar/Diferencia/Sumar. Commands image.advanced/layer.add/duplicate/delete/merge/flatten/selection.invert,icons Layers/Plus/Copy/Trash2/Merge/Layers/FlipHorizontal,no globalshortcut,helpbelow. Othererrorsusefailedwithstablecode.

## Tasks

|Task;commit|Files/work;dependencies|Tests named:input->oracle|
|---|---|---|
|T1;`feat(image): immutable layer operations [step-18a/T1]`|layerTypes.ts,layers.ts,layerHistory.ts;U1/U3.|duplicate_shares_immutable_tiles;reorder_fullpermutation_only;locked_paint_refused;delete_last_refused;undo_restores_mask |
|T2;`feat(image): tiled alpha-correct compositing [step-18a/T2]`|composite.ts,blend.ts,compositeWorker.ts;U1/U2.|normal_opaque_red_over_blue=>red;multiply_white_identity;zero_alpha_rgb_zero;CPU_GPU_within1u8;hidden_layer_noeffect |
|T3;`feat(image): selection masks and set operations [step-18a/T3]`|selectionTypes.ts,selections.ts,selectionRaster.ts,flood.ts;U1/E2.|union64_128=>128;subtract200_80=>120;intersect200_80=>80;invert64=>191;wand_no_diagonal_connection |
|T4;`feat(image): layer and selection transforms [step-18a/T4]`|layerTransform.ts,TransformDialog.tsx;U2/E1.|matrix_inverse_roundtrip;linked_mask_moves_together;bilinear_transparent_edge_nohalo;cancel_preview_norevision |
|T5;`feat(image): safe selected-content transfer [step-18a/T5]`|selectionPixels.ts,layerTransfer.ts;U4/E4.|copy_encodedPNG; capturedR_latereditRplus1_snapshot_staysR;failedcopy_no_cut;paste_onelayer_oneUndo;sensitivecopy_requiresdecision |
|T6;`feat(image): Advanced layers and history panels [step-18a/T6]`|LayersPanel.tsx,SelectionTools.tsx,HistoryPanel.tsx,layers.css;U1/E5.|keyboard_reorder;twoviews_samemodel_independentselection;inactiveGPUreleased;budget_refuses_withoutmutation |
|T7;`docs(help): layers selections and transforms [step-18a/T7]`|Threepagesbelow;coordinator schema48/keys/wiring/pixeltests/speed.|migration42_preservesimageprefs;24MP_tools_budget;readonly_target_noactions |

## Exact file and test allocation

Feature-owned roots: src/image-edit/{layerTypes,selectionTypes,layers,layerHistory,composite,blend,compositeWorker,selections,selectionRaster,flood,layerTransform,selectionPixels,layerTransfer}.ts; src/image-edit/{LayersPanel,SelectionTools,HistoryPanel,TransformDialog}.tsx; src/styles/layers.css. Bare filenames in a task expand inside its feature root; native filenames mean src-tauri/src/ unless an explicit crate path is given. The coordinator owns shared App/Explorer/main, settings schemas, manifests/lockfiles, command/handler/IPC registries, generated locales and asset wiring; workers submit exact insertions rather than editing those shared files. Helpers use the producer's fixed entry/action registry through coordinator integration.

Place every named test in task Tn in the corresponding file below. Rust test modules with private feature access are attached by the owning native module; they are not a fictitious standalone src-tauri library. The listed assertions remain unchanged when split into smaller test files.

|Task|Exact test file|
|---|---|
|T1|src/__tests__/step18a-layers.test.ts|
|T2|src/__tests__/step18a-composite.test.ts|
|T3|src/__tests__/step18a-selections.test.ts|
|T4|src/__tests__/step18a-transform.test.ts|
|T5|src/__tests__/step18a-transfer.test.ts|
|T6|src/__tests__/step18a-ui.test.tsx|
|T7|src/__tests__/step18a-help.test.ts|

Workers write these tests and fixtures but do not execute any command, install, compile, generate assets or claim results. Coordinator runs targeted checks, complete gate/package, real parser/process/file-safety tests and manual evidence. A mock is not evidence of native confinement, interoperability or performance.

## Full help

image-layers.md — English **Image layers**: “Choose Advanced to combine images as layers. Add or duplicate a layer, change order, visibility, lock, opacity or blend mode in Layers. Masks hide pixels without deleting them. Merge down combines two layers; Flatten combines the image after confirmation. Undo restores supported changes within the history limit. Ordinary image export is flattened; editable projects are separate. See also: Image selections.” Spanish **Capas de imagen**: “Elige Avanzado para combinar imágenes en capas. Agrega o duplica una capa y cambia orden, visibilidad, bloqueo, opacidad o modo de fusión en Capas. Las máscaras ocultan píxeles sin eliminarlos. Combinar hacia abajo une dos capas; Aplanar combina la imagen tras confirmar. Deshacer restaura cambios dentro del límite del historial. La exportación normal se aplana; los proyectos editables son independientes. Consulta también: Selecciones de imagen.”

image-selections.md — English **Image selections**: “Choose a rectangle, ellipse, lasso, polygon, magic wand or color selection. Replace, add, subtract or intersect selections; use Invert or Feather when needed. The wand follows connected similar pixels; Select by color finds similar pixels across the image. Copy captures the chosen layer or composite; Paste makes a new layer. Cut changes pixels only after copying succeeds. See also: Transforming image content.” Spanish **Selecciones de imagen**: “Elige rectángulo, elipse, lazo, polígono, varita mágica o selección por color. Reemplaza, agrega, resta o interseca selecciones; usa Invertir o Suavizar borde cuando haga falta. La varita sigue píxeles similares conectados; Seleccionar por color busca en toda la imagen. Copiar captura la capa o composición elegida; Pegar crea una capa nueva. Cortar cambia píxeles solo después de copiar correctamente. Consulta también: Transformar contenido de imagen.”

image-transforming.md — English **Transforming image content**: “Select layers or pixels and choose Transform. Drag handles or enter position, scale and rotation. Linked masks move with their layer. Apply commits one change; Escape cancels the preview. Transforming never changes the referenced original photo. Check transparent edges and Undo before export. See also: Image layers.” Spanish **Transformar contenido de imagen**: “Selecciona capas o píxeles y elige Transformar. Arrastra los controles o introduce posición, escala y giro. Las máscaras vinculadas se mueven con la capa. Aplicar confirma un cambio; Esc cancela la vista previa. Transformar nunca cambia la foto original referenciada. Revisa bordes transparentes y Deshacer antes de exportar. Consulta también: Capas de imagen.”

## Checks/speed/screenshots/done

Retain2x2red/blue/transparentpixelimages,4x4diagonalwandfixture,3licensed24MPphotos,selectionmaskalphas64/128/200. Checkeverylayer/mask/blend/selectionoperation,transform/copycutpaste/Undo/readonly/sharedviews/sourcehashes, memorylimits/Cancel;Englishlight/Spanishdark/pseudo/keyboard/200%zoom. Measure step18a.layer.command Instant100ms,24MPpan/composite Smooth16ms,openAdvancedFast1s. Reserve176-image-layers,177-image-selections threevariants. Done:exact14bmodel/controllerreused,boundedtiledCPU/GPUequivalence,fullUndo/sourceprotection,typedtransfers,andcoordinator-run24MP/frame/pixel/evidencechecks.
