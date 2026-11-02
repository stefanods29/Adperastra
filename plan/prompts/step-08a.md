# Coding assignment: step 08a — Converter 1: Quick Convert, job queue, image formats

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-08a.md](../steps/step-08a.md). Guide SHA-256: `8f40b601eef53fa6c35011483468473635a9bf7c3c6c69b6c52988eb5e612950`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-08a-image-conversion |
| Tag | v0.0.27-step08a |
| Depends on | 03b jobs/Undo;06b versions;06e owned output;07a cache;07g optional image inputs |
| Written before | 07a was built |
| Interface revision | conversion-2;export-snapshot-2 |

Settings reservation: 15 -> 16; screenshot reservations: 79-81. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 07d producer guide](../steps/step-07d.md)
- [Step 07g producer guide](../steps/step-07g.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| Ref | Exact producer; canonical symbols | Contract |
|---|---|---|
| U1 | 06e fs-service.owned_io: PinnedDirectory,OwnedOutput,ClosedOutput,PinnedSource/SourceIdentity | Guard user source, own temporary output, flush and publish no-replace; no guessed staging cleanup |
| U2 | 06b versions.rs before_modify(app,path,reason)->Result<(),String> | Add ModifyReason::Convert with stored reason convert before any later approved in-place conversion; until09f no existing target modified |
| U3 | 06d jobs.rs/services/jobs.ts, JobsPanel/jobsTypes;07d helper.rs spawn_framed/FramedHelperProcess | Jobs/JobContext/spawn_job/runJob<T>/JobHandle<T>, trackJob; progress OpProgress; coordinator extends JobReasonArea with convert |
| U4 | 03b services/undo.ts/fileops.ts | UndoEntryInput/UndoStack.push and existing FileAction recycle/restore; use actualcompleted outputs only and current exact-effect/error handling; never reconvert a mutable source for Redo |
| U5 | 07a E1/E3/E5 | SourceStamp,CacheLease/CacheKey, cache/publication/release; preview kind thumbnail provider convert-preview version1 |
| U6 | 07g E7 | decode_special_image for supported RAW/codec input only; no assumed codec presence |
| U8 | 07d E8/E9 file_grant_backing.rs/pdf_snapshot_resolver.rs | GrantedBacking/Memory, PdfSnapshotRef/PdfSourceIdentity/PdfSnapshotResolver/ResolvedPdfSnapshot/PdfSnapshotRetention/PdfSnapshotResolvers; T2 installs the concrete snapshot resolver and native-only capture MIME allowlist, not a fake disk-path adapter |
| U7 | 06a handler types/useUnsavedChanges, current text/image state | Existing registerSave retained; new registerExport optional callback is additive and never a substitute for SaveHandle |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; exact commit | Files and ordered work | Named tests with exact expectations |
|---|---|---|
| T1; `deps: add pinned image conversion engines [step-08a/T1]` | Coordinator create/register crates/convert manifest exactdependencies/notices; core src/types.rs/error.rs/registry.rs; src/convert/types.ts/registry.ts. Add schema16 conversion fields. | duplicateconverterIDrefused; mismatchedtypedoptionsrefused; schema15es/dark/reading retained/defaultquality90; unsupportedAVIFoutputnotadvertised |
| T2; `feat(export): immutable bounded editor snapshots [step-08a/T2]` | export_snapshot_types.rs/export_snapshots.rs/export_upload.rs/snapshot_authorities.rs/pdf_export_snapshot_resolver.rs; services/exportSnapshots.ts; coordinator optionalregisterExport/protocolroute. D8/E4/E5/U8 exactlimits/chunkoffset/length/finalization/sourcepolicy and NativePdfSnapshotResolver registration. | unregisteredauthorityrefused; originalJPEG_authorizedPNG_capture_succeeds; originalDOCX_authorizedPDF_export_succeeds; UIcannotaddcaptureMIME; seventeenthMIMErefused; sensitiveauthoritycannotdowngradebyomittingsource; chunkoffsetgap/duplicate rejectedwithoutforeignwrite; byte257MiBrefused; sensitiveinputneverondisk; revision1snapshotstaysrevision1afteredit2; PDFsnapshotcontentid mismatchrefused; releasedsnapshotcannotnewopenbutlivePDFretainslease; cancellationremovesonlyownedinput |
| T3; `feat(convert): bounded image and SVG adapters [step-08a/T3]` | convert crate src/image_decode.rs/image_encode.rs/svg.rs/metadata.rs/options.rs; nativeconvert_helper.rs. D1-D6, renderpreviewandactualsameoptions. | 400x200resizewidth100->100x50; noupscale20x10to100->20x10; transparentJPEGrequires transparency_loss in accepted_warning_codes before sink.begin; animatedfirstframerequires animation_first_frame; GIFquantizationrequires palette_reduction; SVGhttpsresource0requests; WebPqualityhidden/losslesstrue; EXIForientation6outputorientation1correctpixels |
| T4; `feat(convert): safe cancellable conversion jobs [step-08a/T4]` | nativeconvert.rs/convert_jobs.rs/convert_publish.rs; services/convert.ts; coordinator IPC/jobsreasonareas. D3/D4/E2; guard/sourceandownedoutputs; actualperfileoutcomes; Retryusesonlyfailedinputindices. | cancelkeepssourceandforeignpartial; arrivingdestinationkeptandnumberednameused; partialbatchdone2failed1reports3exact; flushfailurepublishesnothing; pre-existingoutputneveroverwritten |
| T5; `feat(convert): versioned conversion previews [step-08a/T5]` | src/convert/useConversionPreview.ts/ConversionPreview.tsx/convertOptions.ts. E1-E3,latestrevision,cachelease,approximateestimates. | optionsrev2completionbefore1shows2;closecancels/releases; metadatafailedpreviewno Convertuntilresolved; estimateislabelledapproximate |
| T6; `feat(convert): Quick Convert and shared queue UI [step-08a/T6]` | QuickConvertDialog.tsx/ConversionOptions.tsx/useConversionQueue.ts/styles/convert.css; coordinatorregistry/context/filetabadapter. D7-9, exactlayoutkeys, boundedselectionintersection. | mixedselectionshowscommonformats; keyboarddestination/Convert/Cancel; alreadydoneitemnotretried; unsavedcapturecallbackusednotdisk; keeporiginaloffbackendrefused |
| T7; `feat(convert): exact completion and Undo handoff [step-08a/T7]` | src/convert/convertHistory.ts/useConversionActions.ts; coordinator existingUndo/Explorerrefreshhandoff, no replacementframework. Publishonlyactualcreatedpaths, onegroupUndo; reportknowninheritedhistorylimitationsand09frequirement. | faileditemnoUndooutput; canceledbatchcompletedoutputsremainundoable;historycursorunchangedonfailedUndo; Redorestorescreatedcontentratherthanrerunningmodifiedsource |
| T8; `docs(help): conversion and the job queue [step-08a/T8]` | Bilingualpagesbelow; coordinator key/pseudo/measurement/screenshotupdates. | en/eskey/ICUparity,commandhelp,losswarningkeyboard,errorsremainvisible,nomisleadingexecutedtestclaims |

Puretests crates/convert/tests/step08a_<topic>_tests.rs; nativeboundarytests inconvert/exportmodules; UItests src/__tests__/convertRegistry/convertOptions/convertPreview/quickConvert/convertHistory.test.ts(x). T7 must not claim current path-only restore binds an exact Recycle Bin object: if the existing result lacks exact IDs, coordinator adds a bounded result-to-history handoff before acceptance or retains a visible unresolved issue. Never weaken the approved Replace/Undo contract for this step.

## Coordinator commit labels (workers do not commit)

- deps: add pinned image conversion engines [step-08a/T1]
- feat(export): immutable bounded editor snapshots [step-08a/T2]
- feat(convert): bounded image and SVG adapters [step-08a/T3]
- feat(convert): safe cancellable conversion jobs [step-08a/T4]
- feat(convert): versioned conversion previews [step-08a/T5]
- feat(convert): Quick Convert and shared queue UI [step-08a/T6]
- feat(convert): exact completion and Undo handoff [step-08a/T7]
- docs(help): conversion and the job queue [step-08a/T8]

## Required handoff

Return `handoff/step-08a/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-08a/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
