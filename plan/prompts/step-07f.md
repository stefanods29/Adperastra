# Coding assignment: step 07f — More previewers 1: e-books, notebooks, email, subtitles, logs, SQLite

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-07f.md](../steps/step-07f.md). Guide SHA-256: `0f3947ea317dc8fca8fe3e4298b168256838a0f15d699dd8f47ca9ff76458163`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-07f-extra-viewers |
| Tag | v0.0.25-step07f |
| Depends on | 04a/04b handlers/ribbon;07a cache;07b preview;07d isolated webview host |
| Written before | 07a was built |
| Interface revision | extra-viewers-1 |

Settings reservation: 14 -> 15; screenshot reservations: 69-74. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 07b producer guide](../steps/step-07b.md)
- [Step 07d producer guide](../steps/step-07d.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| Ref | Producer; canonical names | Exact use |
|---|---|---|
| U1 | 07a E1-E5; CacheKey/Lease/SourceStamp, CacheService, BackgroundPolicy | Cached first page/attachments, bounded leased protocol bytes, background reads skip cloud |
| U2 | 07b E3/E5; PreviewSurface, HandlerViewProps.previewOnly | Every handler is read-only and preview-safe; do not instantiate editor/save handles |
| U3 | 07d E7; webview_helper.rs start_webview_helper/WebviewHelperSession/config/input; services/helperBridge.ts | Book parser-only persistent WebviewHelperSession retained through extra view session; session.request handles open/page/contents and close destroys it. Static kind book, own entry book-helper.html, no main commands/capabilities |
| U4 | 06d/06e; archive helper/session/open-entry contracts; fs-service.owned_io | Safe EPUB entry ranges/resources and owned attachment extraction; no arbitrary zip member path writes |
| U5 | 06f; crates/data-views/src/decode.rs decode_text(bytes)->(String,TextEncodingId) | Subtitle/log/notebook text decoding; do not copy/create another encoding fallback |
| U6 | 04a/04b; Handler/HandlerViewProps/ViewerFrame; files.ts grants | Registry/lazy view/find/ribbon/status/normal open; all new handlers have editablefalse |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; exact commit | Files and ordered work | Required named tests: exact input -> expected |
|---|---|---|
| T1; `deps: add extra viewer parsers [step-07f/T1]` | Coordinator pinned parser dependencies/notices; create extra_view_types.rs/extraViews.ts and native limits. Add schema15 reading defaults/migration; no worker installs. | extraViewContracts.test.ts:unknownkind rejected; page>768KiB split with continuation; schema14 en/dark retained,reading18/app added |
| T2; `feat(viewers): bounded read-only helper sessions [step-07f/T2]` | Create extra_views.rs,extra_view_helper.rs,extra_view_sessions.rs; implement E1-E4, source stamps, caps,helpers,cancel/close; register through coordinator. | stale_session_cannot_read_replaced_source; closing_twice_succeeds; oversized_source_does_not_start_parser; online_only_background_read_count_is_zero |
| T3; `feat(book): safe paged e-book reading [step-07f/T3]` | book-helper.html; src/book-helper/{main,bookParser,bookPages,bookResources}.ts; book handler/styles. D2/D3 and book algorithm exactly; native archive loader. | ebook_resource_cannot_escape_book: ../secret refused; book_script_never_runs; paragraph4001scalars splits4000/1 without whitespace; parserdoesnotrequestwholeMOBIfile beforefirstsection |
| T4; `feat(viewers): notebooks and email without execution [step-07f/T4]` | data-views notebook/mail modules; notebook/email handler views plus safe markup component in src/components/SafeMarkupFrame.tsx. Create E5 attachment adapter. | notebook_code_is_inert; email_remote_image_makes_zero_requests; attachment_open_needs_explicit_action; malformedCIDcannotescape message;5001cellsrefused |
| T5; `feat(viewers): subtitles and streamed logs [step-07f/T5]` | data-views subtitle/log modules, respective handlers and virtual rows; E6. | SRT00:00:01,250->00:00:02,500 gives1250/2500ms; second59valid/60invalid; splitUTF8é retained; 70KiBlineexplicitlytruncated; appendupdatesonlynewrange |
| T6; `feat(sqlite): bounded read-only table browser [step-07f/T6]` | data-views/sqlite.rs and sqlite handler/schema/table views; read-only flags/progress handler; coordinator dependencyfeatures if needed. | sqlite_preview_never_writes_database exactsourcehash/sidecarinventoryunchanged; malicious tablename quoteescaped; VMbudgetinterrupts; integer9007199254740993 remains exactstring; invalid cursor rejected |
| T7; `feat(viewers): register safe extra file handlers [step-07f/T7]` | Coordinator registry/default-apps/preview/thumbnail optional-provider declarations; each handler index.ts; styles imports. No global fallback hijack. | unsupported MSG/drawio keptchosenapp; .dbwrongmagicnotSQLite; activefalsecancels; previewOnlyneverregisterssave; orderprioritytests updated preserving oldassertions |
| T8; `docs(help): extra read-only viewers [step-07f/T8]` | Bilingual pages below; exactkeys; coordinator pseudo/measures/shots. | allsixhandlershavehelp; en/eskeys/argumentsmatch; keyboardfind/page/tableopen, nohardcodedtext; no claims of executedchecksfromworker |

Native tests in crates/data-views/tests/step07f_<family>_tests.rs; orchestration in matching src-tauri modules; UI tests src/__tests__/step07f_<family>.test.tsx. Every malicious-input case must assert originals unchanged, no network and bounded/explicit errors.

## Coordinator commit labels (workers do not commit)

- deps: add extra viewer parsers [step-07f/T1]
- feat(viewers): bounded read-only helper sessions [step-07f/T2]
- feat(book): safe paged e-book reading [step-07f/T3]
- feat(viewers): notebooks and email without execution [step-07f/T4]
- feat(viewers): subtitles and streamed logs [step-07f/T5]
- feat(sqlite): bounded read-only table browser [step-07f/T6]
- feat(viewers): register safe extra file handlers [step-07f/T7]
- docs(help): extra read-only viewers [step-07f/T8]

## Required handoff

Return `handoff/step-07f/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-07f/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
