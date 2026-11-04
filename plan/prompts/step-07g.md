# Coding assignment: step 07g — More previewers 2: 3D models, camera RAW, HEIC/AVIF, PSD

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-07g.md](../steps/step-07g.md). Guide SHA-256: `d5015c82b7ae9342dfc4f41b8798f5416db06f04c359ffd210717609c790499a`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-07g-special-viewers |
| Tag | v0.0.26-step07g |
| Depends on | 07a image/cache;07b preview/metadata;07d isolated JS helper host |
| Written before | 07a was built |
| Interface revision | special-viewers-1 |

Settings reservation: 15 -> 15; screenshot reservations: 75-78. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 07b producer guide](../steps/step-07b.md)
- [Step 07d producer guide](../steps/step-07d.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| Ref | Exact producer/export | Contract |
|---|---|---|
| U1 | 07a E1/E3/E5/E8 CacheStore,SourceStamp,CacheLease,CacheService,decode_pixels | Owned bounded images/geometry blobs, source validation and lease lifetime; thumbnails remain fallback on parser failure |
| U2 | 07b E3/E5 PreviewSurface/previewOnly, E1 MetadataInfo | Quick/Details/Column integration read-only, no duplicate metadata fields |
| U3 | 07d E7 WebviewHelperConfig/Kind/HelperInputGrant/run_webview_helper and helperBridge | Static model/psd entrypoints and safe transport; no parent commands or untrusted URL fetch |
| U4 | 06d/06e archive/owned_io | Validated3MF entry/resource reads; never generic unpack; inherited safe-size/path/reparse constraints |
| U5 | 04a image Handler and FileTypeInfo; registry.ts | Existing AVIF claim preserved; priority tie explicitly resolved by capability path, not duplicate broad MIME handler |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

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

## Coordinator commit labels (workers do not commit)

- deps: add three and ag-psd preview engines [step-07g/T1]
- feat(model): isolated safe scene parsing [step-07g/T2]
- feat(model): bounded interactive model viewer [step-07g/T3]
- feat(images): RAW and installed codec previews [step-07g/T4]
- feat(psd): composite and layer previews [step-07g/T5]
- feat(preview): register special thumbnail providers [step-07g/T6]
- docs(help): special image and model viewers [step-07g/T7]

## Required handoff

Return `handoff/step-07g/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-07g/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
