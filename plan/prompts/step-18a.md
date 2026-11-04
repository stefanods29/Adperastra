# Coding assignment: step 18a — Advanced image editor: layers and selections

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-18a.md](../steps/step-18a.md). Guide SHA-256: `46754b2ee67e10b26dc6cb759fc65bf6aba70b0ee29f2dd2116d256267b28930`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

|Field|Value|
|---|---|
| State | guide; documentation reviewed; implementation not started |
|Difficulty|5/5|
|Branch|step-18a-image-layers|
|Tag|v0.5.1-step18a|
|Depends on|14b image-document-1/image-render-1;09a controller;09c content transfer|
|Written before|07a was built|
|Interface revision|image-layers-1;selection-mask-1|

Settings reservation: 47 -> 48; screenshot reservations: 176-177. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09c producer guide](../steps/step-09c.md)
- [Step 14b producer guide](../steps/step-14b.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

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

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

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

## Coordinator commit labels (workers do not commit)

- feat(image): immutable layer operations [step-18a/T1]
- feat(image): tiled alpha-correct compositing [step-18a/T2]
- feat(image): selection masks and set operations [step-18a/T3]
- feat(image): layer and selection transforms [step-18a/T4]
- feat(image): safe selected-content transfer [step-18a/T5]
- feat(image): Advanced layers and history panels [step-18a/T6]
- docs(help): layers selections and transforms [step-18a/T7]

## Required handoff

Return `handoff/step-18a/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-18a/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
