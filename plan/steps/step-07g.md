# Step 07g: 3D models, RAW, HEIC/AVIF and PSD

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-07g-special-viewers |
| Tag | v0.0.26-step07g |
| Depends on | 07a image/cache;07b preview/metadata;07d isolated JS helper host |
| Written before | 07a was built |
| Interface revision | special-viewers-1 |

Guide only; workers write exact implementation/tests without executed tools. Coordinator installs dependencies, wires shared files and verifies. No inferred functions/fields from other steps are permitted.

## Goal and exclusions

Inspect STL/OBJ/glTF/GLB/3MF models, camera RAW previews, HEIC/HEIF/AVIF images through available Windows codecs, and PSD composites/layer names. No model editing, RAW development engine, Photoshop editing, AI enhancement or automatic codec download. Windows-codec absence is an explicit supported fallback state, not false successful rendering.

## Read first

Producing07a/07b/07d guides; v1 07c; existing image handler claims (it already includes AVIF); current image viewer/grants; pinned three0.186.1 loaders/OrbitControls and ag-psd34.1.0 types; local windows0.61.3 WIC GetPreview/GetThumbnail and decode helper. Registry priority/default-app test literals require coordinator changes.

## Decisions and algorithms

- D1. Pin three0.186.1 MIT and ag-psd34.1.0 MIT. Format parsing uses isolated07d host kind model/psd,768MiB/15s open/10s decode wall limits. Main view only consumes validated mesh arrays or leased PNG; no risky source-format parser runs there. Max2helpers combined with PDF/book active-cap accounting, not two per format without a global bound.
- D2. 3D: read supported headers/content; STLLoader.parse(ArrayBuffer), OBJLoader.parse(text), GLTFLoader.parse(data,base,onLoad,onError), ThreeMFLoader.parse(ArrayBuffer) inside helper. No Draco/KTX/network-dependent extension unless separately verified/registered; unsupported compression reported. LoadingManager URL resolver accepts only application-issued local-resource tokens rooted at model's parent or validated3MF archive; rejects http/https/file/data scripts, absolute paths, `..`, symlink escape and undeclared sibling requests. Texture permission is limited to relative resources the selected model actually names, not arbitrary UI paths.
- D3. Validate source<=256MiB; vertices<=2,000,000; triangles<=4,000,000; objects<=10,000/depth64; finite transforms/positions; textures<=32,16MPeach,total128MiBdecoded. 3MF archive<=10,000entries/512MiBexpanded,ratio500,path1024/depth64; reuse safe archive resource checks. Convert helper output to own binary SafeScene1: magic ADPSCN1, little-endian bounded section directory, typed positions/normals/uv/indices and whitelisted material parameters; no user shader/script strings. Directory byte ranges/alignment/counts/checksum validated before TypedArray views in UI. Arrays travel by leased blob URL, never JSON.
- D4. Scene UI builds BufferGeometry/BufferAttribute/Mesh with app-owned materials only. Orbit/zoom via pinned OrbitControls; wireframe toggles known material property; Fit uses finite bounding box; measurement selects two vertices, Euclidean distance in source units; unit selector none/mm/cm/m, default source-declared or none, never assume STL is millimeters. Render only on interaction/resize/load, at most RAF while moving and stop500ms after idle; activefalse stops immediately and disposes GPU buffers/textures on close.
- D5. RAW: extensions cr2/cr3/nef/arw/dng/raf/orf/rw2. WIC decoder first GetPreview/GetThumbnail where available; cache embedded preview before full decode. Only explicit zoom requiring more detail asks full RAW decode through installed local WIC codec; same process/memory/dimension limits as images, no silent external library/binary. Missing decoder returns codec_required with Open in chosen app and instructions, not an empty image. No hand-written CR3/TIFF raw decoder.
- D6. HEIC/HEIF/AVIF: test installed WIC decoder on actual source, not just file extension. Keep existing AVIF image-handler behavior where supported; add native-codec fallback capability without a competing automatic AVIF handler. HEIC/HEIF get a dedicated codecImage handler. No promise that every Windows codec is free; no purchase/install by app. Show optional Windows codec instructions and chosen-app action. Existing source/grants/metadata remain unchanged.
- D7. PSD: validate8BPS/version1/channel/dimensions before library call; source<=256MiB,100MP dimensions cap,layer<=1,000/depth32. `readPsd` with skipLayerImageData true, skipLinkedFilesData true, skipCompositeImageData false,useImageData true,totalMemoryLimit268,435,456; parser returns composite and names/visibility/opacity only. No linked smart-object load. A missing composite is explicit unsupported/empty-composite, not a fabricated flattening. Encode validated composite to PNG in helper; layer names escaped text. Version2PSB falls back chosen app.
- D8. All outputs use source stamps/cache keys/provider versions and released leases. First-frame model/image preview participates in07a thumbnails/07b preview through additive optional provider declarations; cloud sources never parsed in background. No settings schema bump; orbit/zoom/wireframe/unit/layer panel saved only in bounded handler view state.

## Uses from other steps

| Ref | Exact producer/export | Contract |
|---|---|---|
| U1 | 07a E1/E3/E5/E8 CacheStore,SourceStamp,CacheLease,CacheService,decode_pixels | Owned bounded images/geometry blobs, source validation and lease lifetime; thumbnails remain fallback on parser failure |
| U2 | 07b E3/E5 PreviewSurface/previewOnly, E1 MetadataInfo | Quick/Details/Column integration read-only, no duplicate metadata fields |
| U3 | 07d E7 WebviewHelperConfig/Kind/HelperInputGrant/run_webview_helper and helperBridge | Static model/psd entrypoints and safe transport; no parent commands or untrusted URL fetch |
| U4 | 06d/06e archive/owned_io | Validated3MF entry/resource reads; never generic unpack; inherited safe-size/path/reparse constraints |
| U5 | 04a image Handler and FileTypeInfo; registry.ts | Existing AVIF claim preserved; priority tie explicitly resolved by capability path, not duplicate broad MIME handler |

## Data shapes

Canonical `src-tauri/src/special_view_types.rs`, mirrored `src/services/specialViews.ts`; helper-only scene objects/library classes are not wire types.

| Type | Exact fields/types/bounds |
|---|---|
| SpecialKind | model/raw/codec_image/psd |
| SpecialSession | session_id UUID; source SourceStamp; kind SpecialKind; preview optional CacheLease; width,height optional u32; codec_required bool; partial bool |
| SceneInfo | session_id UUID; geometry CacheLease (application/x-adperastra-scene); object_count,vertex_count,triangle_count u32; bounds six finite f64 numbers[minx,miny,minz,maxx,maxy,maxz]; unit none/mm/cm/m; textures CacheLease[]max32; partial bool |
| SceneMaterial | id u32; rgba four finite numbers0-1; metallic/roughness0-1; texture_index optional u32; double_sided bool; no shader source |
| SceneSection | kind positions/normals/uv/indices/materials/primitives/nodes/strings with numeric IDs in exact binary table; byte_offset/byte_len u64decimal strings; countu32;strideu32; no high-bit mesh IDs |
| SceneNode | idu32;parent optionalu32;primitive_id optionalu32;matrix16finitef32column-majorlocalaffine;name UTF8<=512bytes. parent<id; nullsentinel0xFFFFFFFF. No mesh_section or pernode material field |
| ScenePrimitive | idu32;first_vertex/vertex_count/first_index/index_count/material_idu32;max10000;indicesabsoluteintoglobalvertexarrayandinprimitivevertexrange |
| SafeSceneData | positions Float32Array;normals optionalFloat32Array;uv optionalFloat32Array;indices Uint32Array;materials SceneMaterial[];primitives ScenePrimitive[];nodes SceneNode[] |
| PsdLayerInfo | id u32 stable traversal index; parent optional u32; name string<=512; visible bool; opacity finite number0-1; children_count u32; no pixel bytes in JSON |
| PsdInfo | session SpecialSession; layers PsdLayerInfo[] paged256/max768KiB; next_cursor optional UUID; complete bool |
| ModelViewState | yaw/pitch/distance finite numbers; target3finite numbers; wireframe bool false; unit none/mm/cm/m; camera_state absent=>fit bounds; distance>0 and<=1e9 |
| SpecialImageState | zoom10-400 default100; rotation0/90/180/270 default0; layers_open bool true; full_resolution bool false, resets false after restore to avoid background decode |

SafeScene1 exact format is written in `docs/formats/safe-scene-v1.md` byT2. All integers little-endian; float32IEEE754; checkedarithmetic, no native-layout structs. Header44bytes: ASCII ADPSCN1 bytes0..6;versionu8at7fixed1;section_countu32at8;BLAKE3 bytes12..43 overbytes44..EOF. Directoryat44,28bytes/entry: kindu32@0,offsetu64@4,lengthu64@12,countu32@20,strideu32@24. Exactlyonerequiredsectioneach1/4/5/6/7/8;2/3optional;unknown/duplicatekindrefused. Offset>=align4(44+28*N),4-aligned,nonoverlapping,length=count*stride;zeropaddingonly,total<=256MiB,no unexplainedtrailingbytes.

| Kind | Stride/count | Exact record |
|---|---|---|
|1positions |12/max2M |XYZf32@0/4/8 |
|2normals |12/samevertexcount |XYZf32@0/4/8 |
|3uv |8/samevertexcount |UVf32@0/4 |
|4indices |4/divisible3 |u32vertexindex<globalvertexcount |
|5materials |36/max4096 |idu32@0=recordindex;RGBAf32@4/8/12/16;metallicf32@20;roughnessf32@24;textureu32@28(FFFFFFFFnone);double_sidedu32@32(0/1) |
|6primitives |24/max10000 |idu32@0;first_vertex@4;vertex_count@8;first_index@12;index_count@16;material_id@20;indexrangecheckedandreferencedverticesinsideprimitivevertexrange |
|7nodes |84/max10000 |idu32@0;parentu32@4(FFFFFFFFroot,parent<id);primitive_idu32@8(FFFFFFFFnone);name_offsetu32@12relativetostrings;name_lenu32@16<=512UTF8bytes;matrix16f32@20column-major,lastrow0,0,0,1 |
|8strings |1/max4MiB |UTF8namepool;eachnodeoffset/lengthwithinpoolandonvalidUTF8boundaries |

Allfloatsfinite;RGBA/metallic/roughness0..1;primitiveindexcountmultiple3;aggregateinstancedtriangles<=4M. Rustparentverifieshashandallstructuralboundsbeforegrantingimmutablegeometryblob. JSdecodeSafeScenevalidatesstructural/numericboundsagainbutdoesnotneedanundeclaredJShashinglibrary. AppownedThreegeometryusesprimitivegroups/drawrangesandcomposedparentmatrices;doesnotcallformatloaders. Textureimagesmax32/64MiBaggregate,authorizedgrantsandboundedPNGonly;notnetworkURLs.

## Commands and exports for later steps

All native commands ensure_main and validate source/session/enum/bounds. Errors special_view.bad_request/unsupported/too_large/changed/codec_required/corrupt/unavailable, mapped from helper failures without leaking native display text.

| Ref | Canonical export | Native command and typed wrapper |
|---|---|---|
| E1 | services/specialViews.ts types above, openSpecialView | special_view_open_start(request_id,path,kind) ->unit; wrapper(path string,kind SpecialKind)->Promise<JobHandle<SpecialSession>> |
| E2 | modelScene | special_view_scene(session_id)->SceneInfo; wrapper(sessionId)->Promise<SceneInfo>; lease geometry/textures only while activeview owns them |
| E3 | fullRawPreview | special_view_raw_start(request_id,session_id,edge u32<=16384)->SpecialSession job result; wrapper(sessionId,edge)->Promise<JobHandle<SpecialSession>>; explicituser zoom only |
| E4 | psdLayers | special_view_layers(session_id,cursor optionalUUID)->PsdInfo; wrapper->Promise<PsdInfo>; source-bound cursor |
| E5 | closeSpecialView | special_view_close(session_id)->idempotentunit; wrapper->Promise<void> cancels/revokes/disposes |
| E6 | src/handlers/model/safeScene.ts: decodeSafeScene | bytes ArrayBuffer,maxVertices number,maxTriangles number ->validated SafeSceneData (`positions/normals/uv/indices` typed arrays,materials SceneMaterial[],primitives ScenePrimitive[],nodes SceneNode[]); throws special_view.corrupt/too_large; no arbitrary path/loader. Future model thumbnail provider reuses it |
| E7 | src-tauri/src/special_images.rs: decode_special_image | source File reference,kind raw/codec_image,edge u32,full_resolution bool ->Result<DecodedPixels,String>; native image/helper adapter only. 08a conversion may reuse with explicitcapabilitychecks;18b adds separate fullPSD-layer API later |

E8 canonical `src-tauri/src/psd_raster.rs`: rasterize_psd(input:HelperInputGrant,max_edge:u32,context:&JobContext)->Result<PreparedThumbnail,String>; max_edge64/128/256/2048, verifiedag-psdcompositein07dpsdhelper, boundedPNG result. Native decode_special_image neverpretendstodecodePSD;08aconversionselectsE8onlywhenactualadapterinstalled.07gT6 registers thumbnailproviderIDs model/special_psd/special_raw/special_codec through07aE11 anddimensions-onlymetadataproviders through07bE6. No invented provider-registration API. Modelthumbnail rendersvalidatedSafeSceneinitsisolatedtrustedhelper,256px/5s,notuntrustedThreeLoaderinmain.

CacheKind model_scene addedtocanonical07aunionasreservedID, activatedherewith256MiB/blobcap,metadatafieldsremainunchanged;texturesuseboundedthumbnailkind/privateproviderkey. Cachephysical512MiBglobalcapstillwins. T2testsfixtureoffsets/material/primitives/twoinstancedmeshes/hashmismatch/parentcycle and JS/Rust roundtrip withidenticalbytes; malformedbinaryneverallocatesbeyondstatedbudgets.

Handler IDs model/raw/codecImage/psd with separate lazy directories. model extensions stl/obj/gltf/glb/3mf; raw above; codecImage heic/heif; psd psd only. maxBytes256MiB,accent image,supportsFindfalse except PSDlayer-list searchthroughown UI, editablefalse. Exact MIME signatures documented by parser header checks; do not blindly claim octet-stream. Help slugs viewing-3d-models/viewing-raw-images/viewing-heic-and-avif/viewing-psd.

## UI and translation keys

3D canvas fills ViewerFrame, properties aside240px(maxviewportminus320),padding12/gap8; orbit with pointer and keyboard arrows, +/-zoom,F fit while canvasfocused; measurements list normal semantic text; wireframe button pressedstate. Images reuse existing imagecontrols and app tokens; PSDlayerpanel240px,row28density-aware. Missingcodec view keepsfiletitle, instructions/Openchosenapp; no spinnerforever.100ms skeleton/1s words; longdecodeCancel; focusvisibleaccent, no informationbycoloralone.

| Key | English | Spanish |
|---|---|---|
| handlers.model / handlers.raw / handlers.codecImage / handlers.psd | 3D model / Camera RAW image / HEIC image / Photoshop image | Modelo 3D / Imagen RAW de cámara / Imagen HEIC / Imagen de Photoshop |
| model.orbit / model.fit / model.wireframe / model.measure | Orbit / Fit model / Wireframe / Measure | Orbitar / Ajustar modelo / Malla de alambre / Medir |
| model.units / model.unitNone / model.unitMm / model.unitCm / model.unitM | Units / Source units / Millimeters / Centimeters / Meters | Unidades / Unidades del archivo / Milímetros / Centímetros / Metros |
| model.distance | Distance: {value} | Distancia: {value} |
| model.partial | Some model resources could not be displayed. | No se pudieron mostrar algunos recursos del modelo. |
| raw.fullResolution | Load full resolution | Cargar resolución completa |
| special_view.codec | A compatible Windows codec is needed for this file. | Este archivo necesita un códec de Windows compatible. |
| special_view.codecHelp | Check installed image codecs in Windows Settings, or open this file in another app. | Revisa los códecs de imágenes instalados en Configuración de Windows o abre el archivo en otra aplicación. |
| psd.layers / psd.noComposite | Layers / This file has no readable composite preview. | Capas / Este archivo no tiene una vista previa compuesta que se pueda leer. |
| errors.special_view.bad_request / errors.special_view.unsupported | This preview request is not valid. / This format is not supported here. | La solicitud de vista previa no es válida. / Este formato no es compatible aquí. |
| errors.special_view.too_large / errors.special_view.changed | This file exceeds the preview limits. / The file changed. Open it again. | Este archivo supera los límites de vista previa. / El archivo cambió. Vuelve a abrirlo. |
| errors.special_view.codec_required / errors.special_view.corrupt / errors.special_view.unavailable | A compatible codec is not installed. / This preview could not be read. / This preview is not available. | No hay un códec compatible instalado. / No se pudo leer esta vista previa. / Esta vista previa no está disponible. |

Slash-separated keys/values are independent entries in listed order. Icons Box/Focus/Network/Ruler/Maximize/Layers from verified lucide exports; if pinned package lacks one, coordinator fixes the named guide before dispatch, worker never chooses silently. Commands IDs model.fit/model.wireframe/model.measure/raw.fullResolution/psd.layers; labels match exact same-suffix keys above, help perhandler, no new global shortcuts.

## Tasks

| Task; commit | Files and ordered work | Tests with exact expectations |
|---|---|---|
| T1; `deps: add three and ag-psd preview engines [step-07g/T1]` | Coordinator exactdependencies/notices; create special_view_types.rs/specialViews.ts, fixedschemas/caps. Verify package loader exports and helper entry assets. | specialContracts.test.ts:unknownkind/nonfinitebound/referreroutsideparentrefused; source512MiBexceeds256MiB and neverparses |
| T2; `feat(model): isolated safe scene parsing [step-07g/T2]` | model-helper.html,src/model-helper/{main,loaders,resources,safeSceneWriter}.ts; native special_views.rs/jobs/session; SafeSceneformatdoc/decoder. D2/D3exact. | model_remote_texture_is_refused zeroHTTP; traversalrefused; vertex2,000,001refused; overlappingsectionoffsets corrupt; NaNtransformrefused; CRC/hashmismatchrefused |
| T3; `feat(model): bounded interactive model viewer [step-07g/T3]` | handlers/model/{index,ModelView,modelCamera,safeScene}.ts(x),styles/model.css. D4,disposeGPU/RAF. | distance(0,0,0)-(3,4,0)=5sourceunits; hidden_model_stops_render_loop; togglingwireframepreservesgeometry; fitvalidbounds; rendererreceivesnofileloader |
| T4; `feat(images): RAW and installed codec previews [step-07g/T4]` | special_images.rs/raw_helper.rs,raw/codecImage handlers; native AVIFfallbackadaptercoordinatorimagehandler. D5/D6, previewfirst/fullonlyexplicit. | raw_first_view_uses_embedded_preview; nofullreaduntilzoom; missingcodecdoesnotchangefile; AVIFexistinghandlernotduplicated; onlineonly0contentreads |
| T5; `feat(psd): composite and layer previews [step-07g/T5]` | psd-helper.html,src/psd-helper/{main,psdAdapter}.ts,handlers/psd/{index,PsdView,PsdLayers}.ts(x). D7exactoptions/headerbounds. | PSDzero/100,000,001pixelsrefusedbeforelibrary; linkedfilesneverrequested; missingcompositeexplained; layer1001/depth33bounded; escapedlayernameistext |
| T6; `feat(preview): register special thumbnail providers [step-07g/T6]` | Coordinator handler/default-app/provider/previewwiring; feature-specific thumbnails undereachhandler. D8,backgroundpolicy/sourcekeys/leases. | lateclosedpreviewignored; helpercrashkeepsExplorer; closeallreleasesleases/CPU; typefallbackpreserved; readonlypreviewdoesnotregistersave |
| T7; `docs(help): special image and model viewers [step-07g/T7]` | Fourbilingualhelppagesbelow; exactkeys; coordinatormeasures/pseudo/captures. | commandhelpandkeyscomplete,keyboardallcontrols,esdark/pseudo fit,nomodelunapprovedcapabilityclaim |

Native orchestration tests special_views.rs with injected helpers; binaryformatdecoder UItests specialScene.test.ts; perhandler tests step07g_<id>.test.tsx. Workers onlywrite; reviewersruntests/resource/network/fidelitychecks.

## Help pages

Write each full body with normal recipe headings; sentenceorder is intro, use, safety, finalreferences.

| Slug; English/Spanish titles | English body | Spanish body |
|---|---|---|
| viewing-3d-models; Viewing 3D models / Ver modelos 3D | Inspect a model from different angles. Open a supported model, then orbit or zoom. Choose Fit model to reset the view, Wireframe to inspect its structure, or Measure to select two points. Source units are not always physical units. Remote or unsafe resources are not loaded. The model is never changed. See also: "Quick preview" and "Opening files". | Revisa un modelo desde distintos ángulos. Abre un modelo compatible y gira la vista o acerca la imagen. Elige Ajustar modelo para volver a la vista inicial, Malla de alambre para revisar la estructura o Medir para seleccionar dos puntos. Las unidades del archivo no siempre son unidades físicas. No se cargan recursos remotos o inseguros. El modelo nunca cambia. Consulta también: «Vista previa rápida» y «Abrir archivos». |
| viewing-raw-images; Viewing RAW images / Ver imágenes RAW | View the preview stored in a camera RAW file. Open the image. Choose Load full resolution only when you need more detail and a compatible codec is installed. The RAW data is never developed or changed. A missing codec may require another app. See also: "Viewing images" and "File details". | Ve la vista previa guardada en un archivo RAW de cámara. Abre la imagen. Elige Cargar resolución completa solo si necesitas más detalle y tienes un códec compatible. Los datos RAW nunca se revelan ni cambian. Si falta un códec, puedes necesitar otra aplicación. Consulta también: «Ver imágenes» y «Detalles de archivos». |
| viewing-heic-and-avif; Viewing HEIC and AVIF images / Ver imágenes HEIC y AVIF | View supported modern image formats. Open the image normally. If a compatible codec is missing, review the Windows codec instructions or choose your usual image app. Adperastra does not buy or install codecs automatically. Your image stays unchanged. See also: "Viewing images" and "Default apps". | Ve imágenes en formatos modernos compatibles. Abre la imagen normalmente. Si falta un códec compatible, revisa las instrucciones de Windows o elige tu aplicación de imágenes habitual. Adperastra no compra ni instala códecs automáticamente. Tu imagen no cambia. Consulta también: «Ver imágenes» y «Aplicaciones predeterminadas». |
| viewing-psd; Viewing PSD images / Ver imágenes PSD | Inspect a saved composite and its layer names. Open a PSD file and use Layers to show its list. The composite is the preview saved by the file's author. Editing layers is not available here. Linked external content is not loaded. See also: "Viewing images" and "Quick preview". | Revisa la imagen compuesta guardada y los nombres de las capas. Abre un archivo PSD y usa Capas para mostrar la lista. La imagen compuesta es la vista previa guardada por quien creó el archivo. Aquí no puedes editar capas. No se carga contenido externo vinculado. Consulta también: «Ver imágenes» y «Vista previa rápida». |

## Check by hand, speed and screenshots

Retainedsyntheticsamples: STL/OBJunitcube; GLBtriangle withlocaltexture;3MFcube; maliciousgltfhttps/parenttexture; permissiveRAWsamplewithknownpreview; HEIC/AVIFknowncodecvariant; PSD2layers/composite; PSDmissingcomposite; oversizedheaders. Coordinator documentslegalprovenanceandgeneratesnativefixtureswherepossible, nevercommitslarge/privatecameraoriginals. Checkorbit/zoom/fit/wireframe/measurement,backgroundrenderpause, RAWpreview/full/missingcodec, PSDlayers/alpha,quickpreview/thumbs,nosourcewrites/nonetwork. Repeatkeyboard,esdark,pseudo,200%zoom; compareimages totrustedexport.

Measures `step07g.open.model/raw/codecImage/psd` Fast1s firstpreview;3DinteractionSmooth16ms;inactiveCPUidle; fullRAW Waitingwithfeedback/Cancel; existingbrowsingtiersunchanged. Reserve75-model,76-raw,77-codec-image,78-psd withenlight/esdark/pseudolight. Missingcodeccasesrecordunverifiedhardwareavailability,neverinventpass.

## Done when

- [ ] Allfourformatfamilies/ownedbinaryformat/helper/resourceboundsimplemented; reviewerchecksandmaliciousfixturespass.
- [ ] No mainUI riskyparsing,unapprovedremote/siblingresource,usershaderorbackgroundcloudread; readonlyoriginalsunchanged.
- [ ] ExistingAVIFprioritypreserved;codecabsenceexplicit;native/GPUresourcesandleasesreleasedwheninactive/closed.
- [ ] E1-E7/producerrowsagree,helplocalization/accessibility/screenshots/speed/packagereportverifiedbycoordinator.
