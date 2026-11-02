# Coding assignment: step 07e — Copy text from images and scans (OCR)

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-07e.md](../steps/step-07e.md). Guide SHA-256: `d74484b458cb653930b07254000e3458d5cd8e13eebcaddc41d31f68fbed15ad`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-07e-ocr |
| Tag | v0.0.24-step07e |
| Depends on | 07a E1/E3/E4/E8; 07d E1-E3/E5 |
| Written before | 07a was built |
| Interface revision | ocr-1 |

Settings reservation: 13 -> 14; screenshot reservations: 67-68. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 07b producer guide](../steps/step-07b.md)
- [Step 07d producer guide](../steps/step-07d.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| Ref | Exact producing export | Usage |
|---|---|---|
| U1 | 07a E8; thumbnail_decode.rs `DecodedPixels`, `decode_pixels(File reference,max_edge u32,max_pixels u64)` | Helper-only oriented RGBA; do not copy decoder or send raw pixels through JSON |
| U2 | 07a E1/E3/E4/E5 | CacheStore,SourceStamp,CacheKey/Lease,CacheService.source_stamp, BackgroundPolicy kind ocr; release leases on completion/cancel |
| U3 | 07d E1/E2/E3/E5; services/pdf.ts | PdfSession/PdfSourceIdentity/PdfPageInfo/PdfPageImage/PdfTextPage; renderPdfPage,readPdfText,pdfViewportPoint/inverse; page numbers1-based |
| U4 | 04b/06a/07b; handlers/types.ts | FindRequest and previewOnly; no dirty/save callbacks for OCR, selection-only preview allowed |
| U5 | 06d; jobs/helper and services/jobs.ts | runJob<T> returns JobHandle<T> asynchronously; completion carries result; helper cancellation/lifetime as specified |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

### T1 — Language/settings/types
**Files:** ocr_types.rs,ocr_languages.rs,services/ocr.ts; coordinator schema14/default/migration/Windows-feature/translation changes. **Do:** DTOs and language priority D2; no guessed locale fallback; add Settings label. **Uses:** U2/U5. **Tests:** installed en-US/es-ES,appes ->es-ES; appen installedonlyes ->language_missing; schema13 es/dark retains Gallery/background and adds auto/true; invalidtag rejected. **Commit:** `feat(ocr): languages and bounded contracts [step-07e/T1]`.

### T2 — Native recognition helper
**Files:** ocr_helper.rs,ocr_pixels.rs,ocr_windows.rs; coordinator helper dispatch. **Do:** WIC E8/downscale, compositing/SoftwareBitmap conversion, WinRT recognition; property/word limits, no scripts/no source write, cancellation/30s cap. **Uses:** U1/U2/U5/E4. **Tests:** input10000x5000 andmaxedge4096 ->4096x2048; zero/invaliddimensions rejected;500,001stcharacter yields explicit partial; timeout leaves no published result/source change. **Commit:** `feat(ocr): isolated Windows text recognition [step-07e/T2]`.

### T3 — Job/cache/PDF adapter
**Files:** ocr.rs,ocr_jobs.rs,ocr_cache.rs,ocr_pdf.rs; coordinator IPC. **Do:** commands/E1/E4; image capture guard/PDF sourceidentity; page renderlease ownership; cache language/config revisions; foreground/current-page versus policy-gated background; source change rejects; no online-only content. **Uses:** U1-U5. **Tests:** cache en/es differ; PDFpage2 cannotreusepage1; native text present avoidsautomaticOCR; releasedsessioncannotopenforeignblob; cancelling releases PDF image lease; snapshot identity passes unchanged; sensitive recognition creates no disk/cache writes and copy remains disabled. **Commit:** `feat(ocr): cached page recognition jobs [step-07e/T3]`.

### T4 — Overlay geometry and selection
**Files:** src/ocr/OcrOverlay.tsx,ocrCoordinates.ts,ocrSelection.ts,styles/ocr.css. **Do:** E2/E3; reading order, selectableescapedtext, scaledorientation, no per-word focus; forwardcoordinate conversiononce. **Tests:** recognized1000x500/original4000x2000 box(10,20,30,40)->(40,80,120,160);90degrotation through07d viewport mapscornerscorrectly; maliciousrecognizedmarkup appearsliteraltext; selectedwordsorderedline/order. **Uses:** U3/U4. **Commit:** `feat(ocr): selectable text overlays [step-07e/T4]`.

### T5 — Copy/search controls and feedback
**Files:** useOcr.ts,useOcrCommands.ts; coordinator image/PDF ribbon hooks. **Do:** exactIDs/labels; explicitcopyplain text; findmatchedwords mapsboxes; showlanguagehelp/noText/partial;100ms skeleton/1swords/cancel; previewOnly suppresses mutations but allows user copy for ordinary sources; sensitive PDF permissions disable clipboard/print while native authorized editor can consume bounded OCR data. **Tests:** recognition completion doesnotwriteclipboard; Copyall oncewritesexactrecognizedtext; selectingnewfile cancels/ignoresoldresult; missinglanguagepreservesimageview. **Uses:** U4/E1-E3. **Commit:** `feat(ocr): copy and search recognized text [step-07e/T5]`.

### T6 — Help, fixtures and reviewer plan
**Files:** bilingualhelp below; coordinator key/pseudo/tests/scripts. **Do:** exacttext, F1, measures/shots. **Tests:** ocrLanguages.test.ts,ocrCoordinates.test.ts,ocrOverlay.test.tsx,ocrCommands.test.tsx and native step07e_ocr_tests; expected values above plus cancellation/cloud/malformed-source cases. **Traps:** workers do not run recognition or tests. **Commit:** `docs(help): copying text from images and scans [step-07e/T6]`.

## Coordinator commit labels (workers do not commit)

- feat(ocr): languages and bounded contracts [step-07e/T1]
- feat(ocr): isolated Windows text recognition [step-07e/T2]
- feat(ocr): cached page recognition jobs [step-07e/T3]
- feat(ocr): selectable text overlays [step-07e/T4]
- feat(ocr): copy and search recognized text [step-07e/T5]
- docs(help): copying text from images and scans [step-07e/T6]

## Required handoff

Return `handoff/step-07e/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-07e/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
