# Coding assignment: step 13 — Accurate Office viewers (v0.3)

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-13.md](../steps/step-13.md). Guide SHA-256: `d64054e46ea74db67612c5388b75889b79562a23e72c1ee479a42d08da4e5425`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 4/5 |
| Branch | step-13-office-viewers |
| Tag | v0.3.0; acceptance evidence required |
| Depends on | 12a packs-1;12b engines-2/office-render-2/engine-session-1;07d pdf-reader-2;09a tabs-documents-1 |
| Written before | 07a was built |
| Interface revision | office-view-1 |

Settings reservation: 37 -> 38; screenshot reservations: 147-149. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 07d producer guide](../steps/step-07d.md)
- [Step 08a producer guide](../steps/step-08a.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 12a producer guide](../steps/step-12a.md)
- [Step 12b producer guide](../steps/step-12b.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| Ref | Producer/task/file/revision | Exact use |
|---|---|---|
| U1 |12b T2/T5 E1/E3/E4/E7;engineTypes.ts/engine_sessions.rs/engine_session_types.rs/office_render.rs;engines-2/engine-session-1|OfficeFormat,OfficeRenderRequest,EngineHost/render_office for one-shot conversions; accurate viewer pool imports EngineSessionStart/EngineSession/EngineReadDocument/EngineReadSection/OfficeSessionRenderRequest and exact start/open/render/close methods from12b E7, one confined lifecycle/security authority |
| U2 |12a T3 E2;packs.rs;packs-1|EngineHost.start_session acquires office/office_read_bridge and retains PackLease for actor lifetime;13 does not spawn a second engine or independently resolve a program path |
| U3 |07d E1-E7;services/pdf.ts,handlers/pdf/pdfCoordinates.ts;pdf-reader-2|PDF sessions/render/text/outline/cache page leases;1-based page numbers, original point coordinates |
| U4 |09a T2/E3/E4/E7;documents/types.ts,DocumentRegistry.ts,viewState.ts;tabs-documents-1|DocumentHandle/VirtualViewProps,readRange original bytes,captureSnapshot current encoded content; no virtual fake path |
| U5 |08a E4/E5/E7;exportSnapshots.ts;export-snapshot-2|ConversionInput/ExportSnapshot immutable revision; sensitive input refuses CLI route |
| U6 |07a cache;06d jobs;baseline|SourceStamp/CacheLease;runJob<T> completion/cancel; cached bytes via token protocol only |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; commit | Files/ordered algorithm/dependencies | Tests named: input -> oracle |
|---|---|---|
|T1;`feat(office): read-only session contracts [step-13/T1]`|office_view_types.rs,office_view_sessions.rs,services/officeViewTypes.ts;U1/U4/E1-E4; boundedregistry.|session9_refused:8live -> too_large; close_releases_pack; stale_revision_not_displayed|
|T2;`feat(office): bounded structural previews [step-13/T2]`|office_quick.rs,office_sheet.rs,office-quick-helper/main.ts;U5/U6.|external_rel_refused; formula_not_executed;100krows_virtualized:visible<=200cells+overscan;legacy_missing_pack_fallback|
|T3;`feat(office): warm confined render bridge [step-13/T3]`|tools/office-bridge/src/{main,protocol,read_document,render,sections}.cxx/hxx;nativeoffice_pool.rs/office_pool_leases.rs;U1/U2; packsource only,coordinatorSDKbuild.|read_only_source_hash_identical; macros_NEVER_EXECUTE; idle60s_closes_pool; keep_warm_false_closes_on_last_lease; idle_setting_accepts_only60; engine_death_isolated; private_pipe_external_join_denied|
|T4;`feat(office): sections pages and comments [step-13/T4]`|office_view.rs,services/officeView.ts,OfficePresenter.tsx,OfficeNavigation.tsx,OfficeComments.tsx;U3/E2/E3.|sheet2_selected_correct; reply_parent_preserved; page0_refused; comments_escaped_script_text|
|T5;`feat(office): handlers and presentation view [step-13/T5]`|handlers/office/{index,OfficeView,OfficeGrid}.tsx,OfficePresentation.tsx,office.css;E5.|presentation_notes_never_on_audience; protected_view_no_mutation; missing_pack_chosen_app; keyboard_panel_focus|
|T6;`docs(fonts): verified metric-compatible font inventory [step-13/T6]`|fontmanifest specification/font substitution map/tests;coordinatorpackassetprovisioning;U1.|font_hash_change_invalidates_cache; unlicensed_font_not_activated; missing_font_warning_not_silent|
|T7;`docs(help): Office viewing and fidelity [step-13/T7]`|Three help pagesbelow;coordinator schema38/keys/registries/measurements/corpus/report.|migration37_keeps_pack_policy; saved_view_no_tokens; all_three_handler_help_links|

## Exact file and test allocation

Feature-owned roots: src/handlers/office/; src/services/officeView*.ts; src-tauri/src/office_{view,pool,quick,sheet}*.rs; tools/office-bridge/src/; src/office-quick-helper/. Bare filenames in a task expand inside its feature root; native filenames mean src-tauri/src/ unless an explicit crate path is given. The coordinator owns shared App/Explorer/main, settings schemas, manifests/lockfiles, command/handler/IPC registries, generated locales and asset wiring; workers submit exact insertions rather than editing those shared files. Helpers use the producer's fixed entry/action registry through coordinator integration.

Place every named test in task Tn in the corresponding file below. Rust test modules with private feature access are attached by the owning native module; they are not a fictitious standalone src-tauri library. The listed assertions remain unchanged when split into smaller test files.

|Task|Exact test file|
|---|---|
|T1|src-tauri/src/office_session_step13_tests.rs|
|T2|src-tauri/src/office_quick_step13_tests.rs|
|T3|src-tauri/src/office_pool_step13_tests.rs|
|T4|src/__tests__/step13-sections.test.tsx|
|T5|src/__tests__/step13-view.test.tsx|
|T6|src-tauri/src/office_fonts_step13_tests.rs|
|T7|src/__tests__/step13-help.test.ts|

Workers write these tests and fixtures but do not execute any command, install, compile, generate assets or claim results. Coordinator runs targeted checks, complete gate/package, real parser/process/file-safety tests and manual evidence. A mock is not evidence of native confinement, interoperability or performance.

## Coordinator commit labels (workers do not commit)

- feat(office): read-only session contracts [step-13/T1]
- feat(office): bounded structural previews [step-13/T2]
- feat(office): warm confined render bridge [step-13/T3]
- feat(office): sections pages and comments [step-13/T4]
- feat(office): handlers and presentation view [step-13/T5]
- docs(fonts): verified metric-compatible font inventory [step-13/T6]
- docs(help): Office viewing and fidelity [step-13/T7]

## Required handoff

Return `handoff/step-13/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-13/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
