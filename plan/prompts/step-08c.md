# Coding assignment: step 08c — Privacy cleaner

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-08c.md](../steps/step-08c.md). Guide SHA-256: `8270db8a28762a0e2af14238c6e898bd98b40e00aab0a9ecfa4055bd475c2e69`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-08c-privacy |
| Tag | v0.0.29-step08c |
| Depends on | 08a conversion/output/snapshot contracts;08b safe document adapters;06b versions |
| Written before | 07a was built |
| Interface revision | privacy-1 |

Settings reservation: 17 -> 18; screenshot reservations: 85-87. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07d producer guide](../steps/step-07d.md)
- [Step 08a producer guide](../steps/step-08a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| Ref | Producer/export | Exact use |
|---|---|---|
| U1 | 08a E2/E4/E5/E7 | ConversionInput/ExportSnapshot/MetadataCategory/WorkItemResult/ConversionReport,immutableinputs,ownedoutput/framing/report/Undo. Do not copy these types |
| U2 | 08a metadata/image modules;06e owned_io | Existingvalidatedmetadataextraction/guard/staging/no-replacepublication, not outputpathreopen |
| U3 | 06b versions.rs before_modify/ModifyReason | Add Clean=>storedreasonclean, defaulted/additive; errorprivacy.version_failed; no write ifhookfails |
| U4 | 07d E7 helper transport and08c E5 privacy_xmp.rs adapter defined here | ReuseisolatedtrustedwebviewhostforXMPonlyifneeded, no nativeappmarkupinjection; staticpdf_writeentry action namespaceprivacy.xmp |
| U5 | 03a DetailsPane,06dtrackJob,08a QuickConvertDialog | OptionalPrivacysection/command/selectedcategorycheckbox; nobackgroundfilemodification |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; commit | Exactfiles/work | Tests/oracles |
|---|---|---|
| T1; `deps: add bounded PDF privacy parser [step-08c/T1]` | privacycrate manifest/types/error/registry; coordinatorlopdf/notices/schema18privacydefaults; existinglittleExifreuse. | unknowncategoryrefused; schema17 es/dark/convertpresetsretained/allprivacyoff; everytypemirrorswire; redactedinputsecrets |
| T2; `feat(privacy): bounded metadata inspection [step-08c/T2]` | privacy inspect.rs/image_fields.rs/pdf_fields.rs; nativeprivacy_helper.rs/privacysessions; E1 inspect/pages/closure; privacy_xmp.rs,src/pdf-write-helper/privacyXmp.ts,services/xmp.ts implement E5. | GPS/date/cameracategoriesdistinct;sourcechangestalesid; 257fieldspagesratherthantruncates; image/PDFbombcapped; inspectwriteszero sourcebytes |
| T3; `feat(privacy): selective verified image cleaning [step-08c/T3]` | image_clean.rs/xmp_rules.rs/iptc.rs; isolatedXMLadapter;D4/D5verification. | remove_gps_keeps_date_and_camera exactfieldvaluesunchanged; removeauthorpreservesICC/pixels; unknownMakerNoteselectedfailsunverified; XMLprefixrenamingdoesnotbypassGPSremoval; DTDrefused |
| T4; `feat(privacy): fresh verified PDF cleaning [step-08c/T4]` | pdf_graph.rs/pdf_clean.rs/pdf_verify.rs;D6/D7boundedgraphandfreshsave. | removedauthornotinInfo/XMP/unreachableobjects; selectedattachmentgoneafterreopen/prune; JS/OpenActionremoved; forms/annotationsneedcontentack; selectedunknowncoveragepublishesnothing; sourcePDFhashunchanged |
| T5; `feat(privacy): safe cleaning jobs and policy [step-08c/T5]` | nativeprivacy.rs/privacy_jobs.rs;services/privacy.ts;privacy/policy.ts; coordinator08aconversion/ownedoutput/version/Undohandoff. | defaultsremove0fields; offwarningmakes0extra reads; cancelonlyownedstage; sourcechangeafterinspectrefused; newcopycollisionkeepsboth; successfulaftercount0withretainedfieldsverified |
| T6; `feat(privacy): reviewable cleaning dialog and entry points [step-08c/T6]` | PrivacyDialog.tsx/PrivacyFields.tsx/PrivacySettings.tsx/styles/privacy.css; coordinatorDetails/context/QuickConvertcheckbox. | noselectedcategoryClean disabled;signature/content/appearance acknowledgement and exact effective-category closure required;failedafterchecknevergreen“clean”;keyboardcategoryfocus/bilingualtext; matchingpolicysharedcomponent |
| T7; `docs(help): hidden information and privacy choices [step-08c/T7]` | Bilingualpagesbelow;coordinatorpseudo/scripts/report. | helpparity/existingcommandtests,sourceinvariants/falseclaimtests,settingsmodepreservation |

Puretests crates/privacy/tests/step08c_*; UIprivacyPolicy/privacyDialog/privacyFields.test.tsx. Reportactualverificationcoverage andallretainedartifacts; workers do notexecute.

## Coordinator commit labels (workers do not commit)

- deps: add bounded PDF privacy parser [step-08c/T1]
- feat(privacy): bounded metadata inspection [step-08c/T2]
- feat(privacy): selective verified image cleaning [step-08c/T3]
- feat(privacy): fresh verified PDF cleaning [step-08c/T4]
- feat(privacy): safe cleaning jobs and policy [step-08c/T5]
- feat(privacy): reviewable cleaning dialog and entry points [step-08c/T6]
- docs(help): hidden information and privacy choices [step-08c/T7]

## Required handoff

Return `handoff/step-08c/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-08c/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
