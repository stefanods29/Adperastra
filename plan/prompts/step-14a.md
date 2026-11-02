# Coding assignment: step 14a — PDF tools

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-14a.md](../steps/step-14a.md). Guide SHA-256: `7477809cb6b08400b92308e06a710c8a9f08ee73e224ca1035ebb973c7d562ee`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 4/5 |
| Branch | step-14a-pdf-tools |
| Tag | v0.3.1-step14a |
| Depends on |07d pdf-reader-2/helper-transport-1;08b PDF writer/font asset;09a document controller;09c content-transfer-1;09f approved save capability |
| Written before |07a was built |
| Interface revision |pdf-edit-1 |

Settings reservation: 38 -> 39; screenshot reservations: 150-152. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07d producer guide](../steps/step-07d.md)
- [Step 08a producer guide](../steps/step-08a.md)
- [Step 08b producer guide](../steps/step-08b.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09c producer guide](../steps/step-09c.md)
- [Step 09f producer guide](../steps/step-09f.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses and exports

| Ref | Producer/task/file/revision | Exact dependency |
|---|---|---|
|U1|07d E1-E9;services/pdf.ts,handlers/pdf/pdfCoordinates.ts,webview_helper.rs,pdf_snapshot_resolver.rs;pdf-reader-2/helper-transport-1|openPdfInput(PdfInput),PdfSourceIdentity,PdfRasterSpec/PdfRenderRequest/renderPdfPage/readPdfText and inverse coordinate transform; pdf_write host, native GrantedBacking and snapshot resolver retention |
|U2|08b T2/T3;pdf-write-helper;conversion-presets-1|pdf-lib1.17.1/fontkit1.1.1 and verified licensed Inter asset manifest; no assumed existing font path |
|U3|09a T2;documents/controller.ts;tabs-documents-1|DocumentControllerContext/Binding/factory,notifyContentChanged(content_id),immutable capture/saved_revision semantics |
|U4|09c T1-T3 E1/E2;src/transfer/types.ts,src/transfer/TransferRegistry.ts;content-transfer-1|TransferPayload/Envelope/Target/Action/Receipt;createTransfer/getTransfer/releaseTransfer andregister/describe/accept; validated immutable snapshot/page/image/text offers, never private DataTransfer JSON or guessed OS paths |
|U5|09f approved save;06b versions;08a snapshots/outputs|Version hook and identity-bound commit only when capability true; safe new-name copies/Undo otherwise |

U1 exact coordinate module is `src/handlers/pdf/pdfCoordinates.ts`, with pdfViewportPoint and its inverse as07d E5 specifies. Helper calls use07d E7 run_webview_helper(config,inputs,request,cancel) with multiple named grants and validated WebviewHelperResult outputs. Coordinator extends its fixed action allowlist with pdf.edit.serialize/pdf.edit.inspect in this step; unknown actions remain refused. Sensitive inputs require Memory results and the proved nonpersistent browser route, otherwise helper.sensitive_unsupported.

Canonical types `src/pdf-edit/types.ts`; helper mirror `src/pdf-write-helper/editTypes.ts` imports the same serializable definitions. TS model stays document-owned; no UI model enters session JSON.

| Type | Exact fields |
|---|---|
|PdfPoint/PdfRect|{x:number,y:number} finitepoints / {x:number,y:number,width:number,height:number} nonnegative withinpage |
|PdfPageState|id UUID; origin_source ExportSnapshot; origin_page positiveinteger; rotation0/90/180/270; crop PdfRect; annotation_ids UUID[]<=100000 |
|PdfAnnotation|id UUID;page_id UUID;kind highlight/ink/text/comment/signature;rect PdfRect;color4finite0..1;opacity finite0..1;author string<=128;created_unix safeinteger;text string<=8192;quads PdfPoint[][] optionalexact4each;strokes PdfPoint[][] optional;parent_id optionalUUID;image optionalExportSnapshot;font_size optional6..144 |
|PdfFormValue|field_id string<=512 fromenumeration;kind text/check/radio/choice;value string/bool/string[] matchingkind;readonly bool |
|PdfEditModel|schema_version1;document_id UUID;content_id UUID;pages PdfPageState[]1..10000;annotations PdfAnnotation[]<=100000;forms PdfFormValue[]<=10000;source_snapshot ExportSnapshot;history memorybounded128MiB/1000transactions |
|PdfEditOperation|tagged add_annotation(annotation),update_annotation(id,replacement),remove_annotation(id),set_form(field_id,value),reorder_pages(ids),rotate_pages(ids,quarter_turns integer),delete_pages(ids),insert_pages(after_id nullable,page descriptors[]); allvalidatedatomically |

|Ref|Public export/signature|Consumers|
|---|---|---|
|E1|pdf-edit/PdfEditRegistry.ts acquirePdfEditor(document:DocumentHandle)->Promise<PdfEditController>|14a views,09c page transfer; onecontroller/document |
|E2|PdfEditController getModel()->Readonly<PdfEditModel>;subscribe(listener)->unsubscribe;apply(operation:PdfEditOperation)->Promise<void>;undo/redo()->Promise<void>;capture(revision:number,contentId:string)->Promise<ExportSnapshot>;release()->void|Controller binds09a; no arbitrarytypepayload |
|E3|pdf-edit/serialize.ts serializePdfEdit(model:Readonly<PdfEditModel>,revision:number,contentId:string)->Promise<ExportSnapshot>|09a capture/08a conversion; no disk write |
|E4|pdf-edit/PdfEditor.tsx PdfEditor(props:VirtualViewProps)|Coordinator adds editable presenter to existing PDF handler, not second MIMEclaim |

No new PDF file-writing Tauri endpoint bypasses09a. Helper actions pdf.edit.serialize/pdf.edit.inspect in existing host; boundedtypedpayloaddescriptors, not filebytes. Errors pdf_edit.bad_request/read_only/unsupported/too_large/changed/missing_glyph/signature_change/failed; use errors.pdf_edit.failed for uncategorized display.

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

|Task;commit|Files and ordered work;Urefs|Tests named:input->oracle|
|---|---|---|
|T1;`feat(pdf): shared immutable edit model [step-14a/T1]`|pdf-edit/types.ts,model.ts,PdfEditRegistry.ts;U1/U3;validate/history/controller factory.|two_views_share_one_model;protected_apply_refused;undo_to_saved_clears_dirty;captureR_editRplus1_keeps_newer_dirty|
|T2;`feat(pdf): standard annotation appearances [step-14a/T2]`|pdf-write-helper/annotations.ts,appearances.ts,annotationInspect.ts;U2.|highlight_dictionary_Highlight_QuadPoints;ink_strokes_exact;freetext_unicode_escaped;existing_unknown_annotation_preserved|
|T3;`feat(pdf): comments replies and visual signatures [step-14a/T3]`|pdf-edit/comments.ts,SignatureDialog.tsx,signature.ts;U1/U2.|reply_IRT_points_parent;signature_Stamp_not_Sig;rotated_pointer_maps_original;signature_image_limit_refused|
|T4;`feat(pdf): bounded page operations [step-14a/T4]`|pdf-edit/pages.ts,PageToolsDialog.tsx;helperpageCopy.ts;U4/U5.|permutation_duplicate_refused;delete_last_refused;merge_pageorder_A1_B1;split_outputs_owned_noreplace|
|T5;`feat(pdf): safe supported form filling [step-14a/T5]`|pdf-edit/forms.ts,FormFields.tsx;helperformWriter.ts;U2.|checkbox_checked_reopens;richtext_refused;XFA_preserved_or_no_save;script_action_never_executed|
|T6;`feat(pdf): revision-safe capture and save controls [step-14a/T6]`|serialize.ts,PdfEditor.tsx,pdf-edit.css;U3/U5.|savecopy_does_not_clean_original;signature_change_requires_copy;failed_save_keeps_model;unsupported_structure_not_silently_dropped|
|T7;`docs(help): PDF tools and compatibility [step-14a/T7]`|Five pagesbelow;coordinator schema39/keys/handlerwiring/reviewerinterop.|annotations_reopen_other_reader;forms_reopen_independent;all_tools_keyboard_help|

## Exact file and test allocation

Feature-owned roots: src/pdf-edit/; src/pdf-write-helper/{editTypes,annotations,appearances,annotationInspect,pageCopy,formWriter}.ts; src/styles/pdf-edit.css. Bare filenames in a task expand inside its feature root; native filenames mean src-tauri/src/ unless an explicit crate path is given. The coordinator owns shared App/Explorer/main, settings schemas, manifests/lockfiles, command/handler/IPC registries, generated locales and asset wiring; workers submit exact insertions rather than editing those shared files. Helpers use the producer's fixed entry/action registry through coordinator integration.

Place every named test in task Tn in the corresponding file below. Rust test modules with private feature access are attached by the owning native module; they are not a fictitious standalone src-tauri library. The listed assertions remain unchanged when split into smaller test files.

|Task|Exact test file|
|---|---|
|T1|src/__tests__/step14a-model.test.ts|
|T2|src/__tests__/step14a-annotations.test.ts|
|T3|src/__tests__/step14a-comments.test.tsx|
|T4|src/__tests__/step14a-pages.test.ts|
|T5|src/__tests__/step14a-forms.test.tsx|
|T6|src/__tests__/step14a-save.test.tsx|
|T7|src/__tests__/step14a-help.test.ts|

Workers write these tests and fixtures but do not execute any command, install, compile, generate assets or claim results. Coordinator runs targeted checks, complete gate/package, real parser/process/file-safety tests and manual evidence. A mock is not evidence of native confinement, interoperability or performance.

## Coordinator commit labels (workers do not commit)

- feat(pdf): shared immutable edit model [step-14a/T1]
- feat(pdf): standard annotation appearances [step-14a/T2]
- feat(pdf): comments replies and visual signatures [step-14a/T3]
- feat(pdf): bounded page operations [step-14a/T4]
- feat(pdf): safe supported form filling [step-14a/T5]
- feat(pdf): revision-safe capture and save controls [step-14a/T6]
- docs(help): PDF tools and compatibility [step-14a/T7]

## Required handoff

Return `handoff/step-14a/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-14a/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
