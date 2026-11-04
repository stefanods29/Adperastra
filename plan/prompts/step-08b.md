# Coding assignment: step 08b — Converter 2: PDF, documents, sheets, archives, batch presets

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-08b.md](../steps/step-08b.md). Guide SHA-256: `266b914731696feecf89bd0a3951fc914879a4934af2b0fb55a57e01f32f2ab8`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-08b-more-conversions |
| Tag | v0.0.28-step08b |
| Depends on | 08a E1-E7;07d E1-E7;06d/06e archive service;06f data-views |
| Written before | 07a was built |
| Interface revision | conversion-2;export-snapshot-2;conversion-presets-1 |

Settings reservation: 16 -> 17; screenshot reservations: 82-84. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07d producer guide](../steps/step-07d.md)
- [Step 08a producer guide](../steps/step-08a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| Ref | Producer; exact canonical export | Contract |
|---|---|---|
| U1 | 08a E1/E2/E3/E6/E7 registry,ConverterSpec/ConvertOptions/ConversionInput/Report/MetadataCategory | Register adapter IDs above, matching option-kind; common queue/preview/publish/report, no duplicated types |
| U2 | 08a E4/E5 exportSnapshots/ExportSnapshots | Unsavedsource resolves immutable revision; release onjobclose; sensitive input staysmemoryonly |
| U3 | 07d E1/E2/E3/E7/E8/E9 services/pdf.ts,webview_helper.rs,pdf_snapshot_resolver.rs;pdf-reader-2/helper-transport-1 | openPdfInput(input:PdfInput,password?) returns JobHandle<PdfSession>; renderPdfPage(PdfRenderRequest) and readPdfText(sessionId,page,afterRun) preserve PdfSourceIdentity. PdfInput file carries the guarded path/optional expected SourceStamp; snapshot carries PdfSnapshotRef {snapshot_id,document_id,revision,content_id} from the immutable ExportSnapshot. Use raster {kind:dpi,value:options.dpi}; no topedge field or fake snapshot path. Snapshot leases remain retained until closePdf; release every returned CacheLease. |
| U4 | 06d/06e archive/create/read and owned_io | ExistingArchiveFormat/entry/path limits andcreate APIs fromthoseguides; use validatedstreamingentrydata, not sourcepathunpack |
| U5 | 06f data-views table/decode;05a/06c settings/format | decode_text/parse_table etc actualcanonicalexports; preserve identifiersandlocale; settings16->17 |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; commit | Files and algorithm | Exact tests/oracles |
|---|---|---|
| T1; `deps: add document and table conversion engines [step-08b/T1]` | Coordinator pdf-lib/fontkit/calamine/rust_xlsxwriterdeps/notices; create converteradapterstypes; schema17defaults/migration, source_passwordredaction. | knownoptionskindmustmatchadapter; unknownnewerschemafailwithoutmutation; passwordsabsentfromDebugandpresetserialization;16es/darkkeepquality90 |
| T2; `feat(convert): images and PDF page conversion [step-08b/T2]` | crates/convert/src/pdf.rs;src/pdf-write-helper/{main,pdfImages}.ts;nativePDFadapter; E1/E2/U3. | twoimagesorderpreserved;72ptat150DPI->150px using raster dpi150; snapshot source keeps document/revision/content identity and is released only after closePdf; namepart page2 plus pattern`{stem}-{index}.{ext}` givesphoto-page-002-001.png; pixel cap refuses requested DPI rather than downsampling; invalidrange0/last<firstrefusedbeforeoutput;1001imagecap; cancelreleasespageleases/originalunchanged |
| T3; `feat(convert): safe document HTML and PDF export [step-08b/T3]` | src/convert/documentTypes.ts;helperdocparser/layout,fontadapter; E6/E7. | script/remoteimgmakezeroexec/fetch; paragraphwrapmeasuredfontwidth; A4width595.28pt-margin2*(20*72/25.4) ->481.89417ptavailablewithin1e-4; unmappableglyphfailswithoutsilentdrop |
| T4; `feat(convert): safe CSV and workbook conversion [step-08b/T4]` | convert table_read.rs/table_write.rs/csv_output.rs; typedoptions/currentdataviewimports. | text000123remains000123; string=1+1writesstringnotformula; CSVa,quote,newlinequoted/doublequotes; missingcacheformulaexplicitwarning; formula_safety_prefix/formula_cached_value/sheet_selection acknowledgements required before output.begin; sheet Budget2026 plus pattern`{stem}-{index}.{ext}` givesbook-Budget2026-001.csv; selectingonesheetdoesnotclaimallconverted |
| T5; `feat(convert): guarded ZIP and 7z conversion [step-08b/T5]` | convertarchiveadapter andownintermediatelifecycle; nativearchive/passwordreuse. | traversalfails; malformed/passwordwrongpublishesnothing; noforeignintermediatecleanup; names/entryhashesroundtrip; metadataunsupportedreported |
| T6; `feat(convert): validated batch presets and naming [step-08b/T6]` | conversion_presets.rs/services/conversionPresets.ts,convert/naming.rs/ts; catalogatomicwriteanddialogs. | stemphoto/extjpg/index2/date2026-11-01,pattern`{stem}-{index}.{ext}` producesphoto-002.jpg; unknowntokenrefused;101presetsrefused; importneverpersistspassword/token/path |
| T7; `docs(help): batch conversions and presets [step-08b/T7]` | exactkeys/helpbelow; coordinatormenuregdock/pseudo/tests/measures/shots. | presetcompatibility/keyboard/lossack, bilingualhelp/keys; staleunsavedsnapshotnotreloaddisk; identicalregistrytypesacrossalladapters |

Namingpatternactualsyntaxusesbracedtokens: `{stem}-{index}.{ext}` ->photo-002.jpg; narrativetokenlistisnotliteralunbracedpattern. Everyhelper/outputuses08aownedpublish/report/Undo; workersnotruncommands. PureRusttests crates/convert/tests/step08b_*;UItests conversionPresets/documentConversion/conversionNaming.test.ts(x).

## Coordinator commit labels (workers do not commit)

- deps: add document and table conversion engines [step-08b/T1]
- feat(convert): images and PDF page conversion [step-08b/T2]
- feat(convert): safe document HTML and PDF export [step-08b/T3]
- feat(convert): safe CSV and workbook conversion [step-08b/T4]
- feat(convert): guarded ZIP and 7z conversion [step-08b/T5]
- feat(convert): validated batch presets and naming [step-08b/T6]
- docs(help): batch conversions and presets [step-08b/T7]

## Required handoff

Return `handoff/step-08b/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-08b/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
