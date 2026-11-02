# Coding assignment: step 14b — Basic image editor

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-14b.md](../steps/step-14b.md). Guide SHA-256: `9772db5a0a54249fe54bc0b2e232c78b97855a71d21b60ea303092319a6e77aa`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

|Field|Value|
|---|---|
| State | guide; documentation reviewed; implementation not started |
|Difficulty|4/5|
|Branch|step-14b-image-editor|
|Tag|v0.3.2-step14b|
|Depends on|07a/07g decode;08a conversion/snapshots;09a document controller;09c transfers;09f safe save|
|Written before|07a was built|
|Interface revision|image-document-1;image-render-1|

Settings reservation: 39 -> 40; screenshot reservations: 153-155. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 07g producer guide](../steps/step-07g.md)
- [Step 08a producer guide](../steps/step-08a.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09c producer guide](../steps/step-09c.md)
- [Step 09f producer guide](../steps/step-09f.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

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

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

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

## Coordinator commit labels (workers do not commit)

- feat(image): shared tiled document controller [step-14b/T1]
- feat(image): crop transform resize [step-14b/T2]
- feat(image): deterministic adjustments and presets [step-14b/T3]
- feat(image): markup drawing and manual erase [step-14b/T4]
- feat(image): edit and draw interface [step-14b/T5]
- feat(image): encoded snapshot save and export [step-14b/T6]
- docs(help): image editing and drawing [step-14b/T7]

## Required handoff

Return `handoff/step-14b/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-14b/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
