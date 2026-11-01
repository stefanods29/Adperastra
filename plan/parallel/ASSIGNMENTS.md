# Code-worker assignments A-L

Use with README, INTERFACES, WORKER-PROMPT and REVIEW in this folder. All paths are repository-relative. Each stream writes implementation code and tests from full guides supplied by the coordinator, without executing compilation or tests. These are assignment briefs, not the complete per-step guides. No item below is a claim that the feature already works or is ready to dispatch.

Assignments A-F are below. Continue with [assignments G-L](ASSIGNMENTS-G-L.md) for customization, search, packs, editors and the included-step integration order. Both files form one assignment register.

## How to use an assignment

Read `AGENTS.md`, current STATUS/rules/conventions/pitfalls, contracts, libraries, speed, glossary, ledger, design-spec and UI kit. The coordinator reads the whole 05a model guide before authoring the full guides. Workers read their accepted step guides and every real source file they will change. Scope must trace each feature to a task or a named excluded/later step. Current contracts and owner decisions override obsolete v1 suggestions.

For each assigned step, the coordinator first delivers its complete guide and exact cross-step dependency/export tables. The worker then delivers its task/file map, implementation and written tests. The task slices below identify required work, not a license to choose missing design, text, types or algorithms. Workers report missing guide details to the coordinator and do not write their own replacements.

The test names below are proposed new behavioral requirements. Before adopting one, search for an existing equivalent and preserve it. Place new Rust tests in the owning crate's `tests/step<id>_<topic>_tests.rs`, UI tests in a feature-specific `src/__tests__/step<id>_<topic>.test.ts(x)`. The full guide must give exact fixtures, inputs and expected outcomes for each. Workers write these tests; only the coordinator runs them.

Tags come from STATUS. Canonical guide branches come from the accepted step guide. The workstream branch is an isolated drafting/coding workspace, not a replacement for per-step task commits.

## A — Preview foundations and Gallery

**Steps:** 07a, 07b, 07c. **References:** v1 07a; contracts 5, 10, 13, 15, 18, 21. **Interface ownership:** I1; preview/metadata provider in I2.

**Read code:** `src-tauri/src/helper.rs`, archive/font helpers, `jobs.rs`, `files.rs`; `crates/version-store` for SQLite/store conventions; handler types/registry; `src/views/explorer/views/FileGrid.tsx`, `ColumnPreview.tsx`, `DetailsPane.tsx`, `GalleryView.tsx`; settings sections.

**Owned modules:** new `crates/cache-store/`; new thumbnail, background-policy and metadata modules under `src-tauri/src/` and corresponding services; new Explorer preview/Gallery feature modules and CSS. Reserve exact filenames in the guide. Changes to existing helper/job/handler/shared view files go to the coordinator. `GalleryView.tsx` currently serves the developer components gallery; 07c must keep that separate from the photo Gallery location.

### 07a — Thumbnails, bounded cache and background policy

Task slices: bounded cache index/blob lifecycle; common background policy and priority; extend helper infrastructure preserving archive/font/clipboard consumers; lazy visible-item thumbnail requests; UI cache invalidation/cancellation; settings/help; written safety/interaction tests and measurement instructions.

Decide the full cache key, handler version, invalidation, single-flight requests, size/entry caps, atomic publication, ownership-safe cleanup, multi-process coordination and cache failure behavior. Keep blobs outside JSON IPC. Background requests skip online-only items before opening them. Foreground clicks must not queue behind a large thumbnail batch. Specify idle/AC/pause behavior and resource bounds; version cleanup also consumes the shared policy.

Required tests: `cache_key_changes_with_file_revision`; `cancelled_thumbnail_cannot_replace_newer_result`; `online_only_thumbnail_does_not_open_source`; `cache_eviction_keeps_pinned_blob`; `pause_stops_new_background_work`. Give deterministic clocks/fake policy inputs rather than timing sleeps.

**Exports needed by:** every previewer, Gallery, converter preview, index/storage and pack management. Freeze I1 first.

### 07b — Quick preview and rich file information

Task slices: helper-based metadata reads; normalized type-specific facts; quick-preview shell reusing handlers; arrow/Space/Escape behavior; Details and Column preview adapters; lifetime/focus/security tests; help and measurement plan.

Specify what opening a quick preview authorizes versus hover metadata. Revoke grants, cancel old reads and restore focus on close. Do not mount a second editor with unsaved mutations for a read-only preview. Metadata has partial/missing/error states and bounded result size; expensive codecs stay in helpers. Separate the lightweight file facts from late-loaded rich metadata.

Required tests: `preview_close_restores_origin_focus`; `preview_selection_change_ignores_stale_metadata`; `quick_preview_never_enables_editing`; `metadata_failure_keeps_basic_facts`.

### 07c — Photo Gallery

Task slices: chosen-folder persistence; bounded multi-folder discovery with no loops; date-taken/modified grouping; virtualized grid and navigation; normal image-tab opening; source editing/help; accessibility/cancellation tests.

Specify date fallback/time-zone grouping, duplicate source coverage, inaccessible folders and vanished drives. Reuse the cache and metadata providers; never crawl or hydrate cloud files because a Gallery source was selected. Preserve existing developer components access under a distinct translated name.

Required tests: `gallery_deduplicates_overlapping_roots`; `gallery_uses_modified_date_without_taken_date`; `removing_source_cancels_its_pending_items`; `gallery_opens_through_normal_pipeline`.

## B — PDF, OCR and additional viewers

**Steps:** 07d, 07e, 07f, 07g. **References:** v1 07b/07c; contracts 13, 15, 21, 22. **Consumes:** I1/I2; provides PDF/OCR surfaces for I3 and I7.

**Read code:** existing image/text/Markdown/font/table/JSON handlers, file grants/protocol, protected-view handling, ribbon/ViewerFrame and quick-preview contract. **Owned modules:** new handler directories for these formats, feature-specific Rust helper modules/services, OCR modules, viewer CSS/help/tests. Shared handler registration and protocol changes remain coordinator-owned.

### 07d — Read-only PDF viewer

Task slices: verify pinned `pdfjs-dist` APIs and worker assets; bounded file/range loading; first-page/sidebar/visible-page rendering; text layer and search; outline/page/zoom/rotate; print; thumbnail/quick-preview provider; help/tests.

Resolve the conflict between the old native-helper rendering wording and the locked PDF.js worker plan before implementation. Document which parsing runs in a worker or helper, how its failures are isolated and why it satisfies current rules. Do not add a native engine from a v1 suggestion without dependency review. Disable PDF scripting, external loads, launch actions and embedded code. Define encrypted/damaged/huge document behavior and bounded page/text caches.

Required tests: `pdf_scripts_and_remote_resources_are_disabled`; `pdf_renders_visible_pages_only`; `pdf_close_releases_document_and_grants`; `pdf_search_ignores_cancelled_document`.

### 07e — Windows OCR

Task slices: installed-language discovery and explicit failure cases; Windows.Media.Ocr helper flow; pixel-size/orientation/zoom coordinate mapping; text selection/copy/search overlay; scanned-PDF page adapter; cache/policy integration; bilingual help/tests.

Keep this step. It needs no local AI runtime or model pack. Define missing English/Spanish language behavior honestly. OCR reads only eligible local content, shares background controls and caches by content revision plus OCR configuration. Optional Tesseract languages belong to 12a's non-AI OCR pack work.

Required tests: `ocr_boxes_follow_rotated_scaled_page`; `ocr_cache_separates_language_and_source_revision`; `ocr_missing_language_explains_next_action`; `background_ocr_skips_online_only_source`.

### 07f — E-books, notebooks, email, subtitles, logs, SQLite

Task slices: shared safe rich-content adapter; one independently lazy handler per format family; e-book navigation/font/themes; notebook cells and inert output; email body/attachments; subtitle/log navigation; read-only database browser; fallback coverage; format-specific help/tests.

Verify `foliate-js`, `mail-parser` and `rusqlite` against the locked list. EPUB resources and attachments cannot escape the grant/root boundary. No notebook code, remote email images or active scripts. SQLite must not create journals or write source databases; cap rows/cells/query work and define WAL/locked/corrupt files. MSG support is conditional on a permitted parser proved by research; otherwise retain chosen-app fallback explicitly.

Required tests: `ebook_resource_cannot_escape_book`; `notebook_output_never_executes`; `email_blocks_remote_images`; `sqlite_preview_never_writes_database`; `sqlite_page_has_bounded_rows_and_cells`.

### 07g — 3D, camera RAW, HEIC/AVIF, PSD

Task slices: pinned Three/loaders/PSD investigation; file-only resource resolver; bounded 3D controls/measurements; embedded RAW preview then opt-in full resolution; Windows codec capability/error flow; PSD composite/layer list; thumbnails/quick-preview; per-format help/tests.

Map STL, OBJ, glTF/GLB and 3MF individually. No automatic network fetch of model textures; no arbitrary sibling-file access. Resolve extra codecs/RAW parser licenses and packaging before promising full RAW decode. Missing codecs get a precise translated action, without automatic downloads or paid dependencies. Fonts were completed in 06f and are not rebuilt here; draw.io remains chosen-app fallback.

Required tests: `model_remote_texture_is_refused`; `hidden_model_stops_render_loop`; `raw_first_view_uses_embedded_preview`; `missing_codec_keeps_file_unchanged`; `psd_dimensions_are_checked_before_allocation`.

## C — Conversion and privacy

**Steps:** 08a, 08b, 08c. **References:** v1 08a/08b; contracts 8, 10, 11, 19, 20, 23, 24. **Interface owner:** I3, consumes I1/I2.

**Read code:** archive create/extract/publish, owned output, versions, JobsPanel/trackJob, text/image handlers and ribbon. **Owned modules:** new `crates/convert/`, `crates/privacy/`, `src/convert/`, privacy feature directories/services/Rust modules/CSS/help/tests. Coordinate later changes to these with I stream; C retains ownership until explicit transfer.

### 08a — Image conversion and Quick Convert

Task slices: format/option registry; bounded helper adapter; image and SVG conversion; non-destructive preview; Quick Convert UI; shared queue adapter/Retry/Cancel; current unsaved-document export input; output naming/Undo; metadata preservation; help/tests.

Pin formats, quality semantics, dimensions and input/output caps for each engine. Verify image/resvg/little_exif APIs; report the actual AVIF decision. Estimates are labeled estimates. Preview generations cancel and cannot publish late UI results. Export uses immutable current-document data through the agreed adapter, never silently reloads stale disk bytes. Original retention is the default; Replace remains subject to I4.

Required tests: `conversion_default_preserves_original`; `preview_ignores_old_option_revision`; `conversion_cancel_cleans_only_owned_output`; `unsupported_metadata_is_disclosed`; `conversion_uses_unsaved_document_revision`.

### 08b — PDF/document/table/archive conversion and presets

Task slices: images-to-PDF and PDF-to-images; Markdown/HTML export with inert markup; print-to-PDF feasibility; CSV/XLSX reading/writing; zip/7z adapters; preset schema/persistence/apply; multi-file summary; help/tests.

Use 07d's agreed PDF interface, existing archive safety and approved calamine/rust_xlsxwriter/pdf-lib dependencies. Define page ranges, table type/formula policy, output ordering, preservation limits and archive passwords. No macros or formula execution. Presets persist validated options, not executable expressions or secrets; password fields never persist in presets. Tie unsaved input to the same I3 contract.

Required tests: `preset_round_trip_drops_secrets`; `invalid_page_range_creates_no_output`; `spreadsheet_conversion_does_not_execute_formula`; `archive_conversion_reports_skipped_entries`.

### 08c — Optional privacy cleaner

Task slices: inspect hidden information; selected-category removal for images/PDFs; preview/diff of removals; cleaned-copy writer; Details/context/convert entry points; keep/ask/remove settings; per-file batch results; help/tests.

Define precisely which metadata categories each format can remove without silently changing other content. Defaults keep everything and disable warnings. PDF attachments, annotations, forms and scripts need distinct choices. A failed verification must not publish a claimed-clean result. Preservation and removal have testable semantics, including selective GPS removal while keeping date/camera.

Required tests: `privacy_default_changes_nothing`; `remove_gps_keeps_date_and_camera`; `cleaner_writes_copy_by_default`; `partial_clean_is_reported_not_claimed_complete`.

## D — Release and accessibility acceptance

**Steps:** 08d, 10f, 16, partial 22b. **References:** v1 08c, 10c, 16, 22b; milestone rows. **Coordinates:** I8, plus style-library contract I9.

**Owned modules:** new accessibility feature modules/styles/help/tests and manual style-library data/UI after L's deck contract freeze. Existing release/packaging/workflow files, root accessibility integration and shared tokens are coordinator-owned; deliver exact changes as integration proposals. No worker publishes anything or signs releases.

### 08d — First-release preparation

Task slices: installer/portable requirements and workflow proposal; release artifact contents; checksums/attestations research; notes/What's new; per-user upgrade/uninstall data choices; opt-in update checks; Sandbox test matrix; unfinished-evidence/issue sweep.

Build instructions reference current repository packaging, not obsolete v1 step numbers. Specify data preservation and path ownership during uninstall; no recursive user-data deletion merely because a folder has a familiar name. Updates never auto-download/install. No signing certificate. Local-only authorization means prepare release material locally; any later remote draft/publish follows current owner authorization.

Required written checks: `release_artifacts_exclude_tests_and_private_data`; `update_check_is_off_by_default`; `uninstall_keep_data_preserves_versions`; install/upgrade/uninstall Sandbox cases. Reviewer executes these later.

### 10f — Accessibility and v0.2 acceptance

Task slices: Windows accessibility preferences; labeled/live-region/focus behavior; zoom up to 300%; contrast/palettes/spacing; Windows read-aloud; larger targets and alternate drag; simple mode; non-expiring focused confirmations; subtitle/visual feedback settings; full main-flow audit.

Accessibility belongs in every earlier worker's UI already; 10f verifies and extends it. Do not postpone keyboard access until this step. Preserve semantic names for Voice Access. Avoid keyboard conflicts already reserved by tabs/palette/tags. Dictation/captions requiring the excluded speech pack are explicitly deferred.

Required tests/checks: `focused_confirmation_does_not_expire`; `simple_mode_keeps_essential_commands_reachable`; `color_is_never_the_only_status`; 200%/300% layout, Narrator/NVDA, reduced motion and high contrast matrices. State which require a real app/owner hardware.

### 16 — Windows integration and release polish

Task slices: existing classic-shell menu reliability; optional supported Windows 11 shell integration; single-instance launch adapter; chosen associations; installer/offline variants; optional background/tray lifecycle; memory/idle unload behavior; opt-in update notes; help/tests.

Research the real shell mechanism and its install permissions before choosing it. Core app stays unelevated. Stay-in-background and startup registration are independently optional and off initially. No tray lifecycle may lose unsaved documents or silently enable background jobs. Keep excluded AI upscaling visible as absent in the milestone coverage report.

Required tests: `shell_open_uses_single_instance_pipeline`; `turning_off_background_mode_quits_idle_host`; `uninstall_removes_only_owned_integration`; `background_mode_does_not_enable_background_tasks`.

### 22b — Manual style library only; partial step

Task slices: eight style definitions and real layouts; fonts/colors/density rules; manual style picker/switching; importing styles from own templates; compatibility/accessibility checks; help; release-readiness report that states AI omissions.

Styles: Business pitch, Report/results, Class/education, Minimal, Creative/visual, Technical/engineering, Training/how-to, Personal/event. Reuse L's presentation master/theme/layout model; never fork a second slide model. Preserve slide content and report unsupported layout mappings. No model generation, suggested style, prompt sets, training or AI evaluation. Do not claim 22b or v1.0 complete.

Required tests: `manual_style_switch_preserves_slide_content`; `style_template_import_is_inert`; `all_eight_styles_have_usable_layouts`.

## E — Tabs, sessions, recovery and split view

**Steps:** 09a, 09b, 09c, 09h, 09i. **References:** v1 09a/09c/09d; contracts 6, 12, 13, 26, 37. **Interface owner:** I5; consumes editor I9.

**Read code:** tabs/session serializer, TabStrip/layout, openPipeline, useUnsavedChanges, recovery/drafts, drag and clipboard. **Owned modules:** new tab/session/group/recovery/split helpers and panels with tests/styles/help. Existing tab types/reducer, App, TabStrip and root drag integration are coordinator-owned; supply precise additive changes.

### 09a — More tabs and sessions

Task slices: closeable folder-tab model; pin/duplicate/reorder/reopen; Ctrl+Tab/digit routing; bounded versioned session schema; handler view-state restore; visible-first lazy reopening; missing-file states; settings/help/tests.

Keep the permanent Explorer exactly once. Retain unsaved prompts, protected view and normal grant/open flow on restart. Never persist tokens, passwords, live engine handles or unrestricted arbitrary handler objects. Validate every restored payload and cap tab/history/state sizes. Folder tabs need independent listing, selection and navigation, not several views sharing one Explorer state.

Required tests: `folder_tabs_have_independent_navigation`; `session_restore_never_restores_grant_token`; `restore_keeps_one_permanent_explorer`; `closing_dirty_tab_waits_for_decision`.

### 09b — Live and saved tab groups

Task slices: group model/actions; name/color/collapse and drag membership; context menus; close/save-and-close; saved-group persistence/update/import/export; navigation/+ entry points; visible-first reopen; help/tests.

Saved references to missing files become Locate-capable tabs without dropping the whole group. Group import is bounded/inert and excludes secrets. Group close is one explicit operation over per-tab dirty decisions, with cancellation semantics agreed with I5. No automatic opening of every saved group.

Required tests: `ungroup_keeps_tabs_open`; `saved_group_restore_keeps_missing_file_placeholder`; `cancelled_group_close_keeps_unsaved_tabs`; `group_import_rejects_invalid_references`.

### 09c — Cross-tab drag/content and Windows open requests

Task slices: typed inert transfer payloads; hover-to-activate delay; folder/group/tab-bar drop routing; editor content adapter; structured clipboard conversion; single-instance request validation/routing; file-association handling; help/tests.

File operations remain under the shared safety service. Content transfer preserves supported formatting and names unsupported loss; unsupported editors register no target. Do not pretend future editors exist. No path-built shell commands, executable clipboard markup or auto-execution from launch arguments.

Required tests: `hover_switch_cancel_does_not_activate_old_tab`; `folder_drop_uses_existing_file_operation_rules`; `unsupported_content_drop_changes_nothing`; `second_instance_request_is_validated`.

### 09h — Crash recovery and offline diagnostics

Task slices: recovery catalog/draft state; file-tab retry; session/unsaved recovery UI; crash-loop safe mode; local diagnostic selection/redaction/archive; review-before-save UI; issue-form opening; help/tests.

Preserve pending version and owned-staging recovery evidence; no cleanup on the assumption it is garbage. Crash counts need a defined successful-start reset. No automatic upload, secrets in logs or automatic attachment. Safe mode does not overwrite normal profile/settings. Diagnostics must not scoop up all user folders or private signing directories.

Required tests: `safe_mode_does_not_overwrite_normal_settings`; `diagnostics_masks_paths_and_usernames`; `recovery_keeps_unresolved_owned_output`; `report_problem_never_uploads_archive`.

### 09i — Split view

Task slices: bounded two-sided tab model; independent child lifetimes; orientation/divider/swap; active-side ribbon/focus; drop/paste adapters; compatible sync-scroll mapping; collapse-to-single; session/group restore; help/tests.

Reuse I5 state and I9 document ownership; a split must not duplicate dirty-document data or save an inactive wrong file. Synchronize by meaningful positions where adapters support them, not a universal pixel ratio. Do not turn this into backlog permanent dual-pane workspaces.

Required tests: `split_active_side_owns_commands`; `closing_split_side_preserves_other_state`; `split_session_restores_both_children`; `sync_scroll_avoids_feedback_loop`.

## F — Explorer actions and safe file workflows

**Steps:** 09d, 09e, 09f, 09g, 09j, 09k. **References:** v1 09a-09e; contracts 7-12, 19, 27. **Interface owner:** I4; consumes I2/I3/I5.

**Read code:** selection, commands/menus, file operations/conflict/history, owned output, transfer/history/Undo, clipboard, shell. **Owned modules:** new palette/rename/copy-conflict/shelf/lock/clipboard-history/disk-image feature modules and dedicated tests/styles/help. Existing file-operation services, shared Undo and filesystem primitives stay coordinator-owned.

### 09d — Explorer extras and command palette

Task slices: rubber-band selection; column chooser/resize/group state; bounded per-folder sort/group memory; palette sources/fuzzy ranking in English and app language; recent commands; enabled/disabled reasons; navigation/tab/settings/help adapters; help/tests.

No duplicate view framework or reimplementation of 05a/05b. Pin the search library only after research. Ctrl+K respects focused editor/search behavior. Palette executes registry commands with the current context, never command-like user text as a shell expression.

Required tests: `palette_respects_command_enabled_reason`; `palette_matches_english_and_app_language`; `rubber_band_keeps_keyboard_selection_consistent`; `column_preferences_preserve_required_name_column`.

### 09e — Bulk rename and batch actions

Task slices: deterministic rename transform/preset model; bounded regex and metadata/date substitution; live preview/exclusions; reserved-name/conflict checks; collision/cycle-safe execution plan; aggregate Undo/Redo; common batch summary; help/tests.

Define case-only renames, A-to-B/B-to-A cycles, mid-job races and partial failure before coding. Preview is not mutation authorization for a later changed object. Bounded operation records preserve exact executed effects and cannot overwrite a newly appearing target. Integrate saved conversion/privacy presets from C.

Required tests: `rename_cycle_keeps_both_contents`; `case_only_rename_is_undoable`; `changed_target_after_preview_is_not_overwritten`; `rename_summary_records_exact_partial_effects`.

### 09f — Copy queue and full conflict workflow

Task slices: pause/resume/skip/retry and per-drive queue; throughput/remaining-time; optional verified-copy hashing; conflict snapshots/previews/choices; durable approved-target recovery; exact Undo/Redo; save-as/version-copy integration; help/adversarial tests.

This is the owner of resolving KI-030/KI-087's Replace deferral, with KI-069 analyzed separately for in-place content saves. Follow the exact approved-object/recovery contract. A path stat followed by `trash::delete` is not proof of identity-bound recycling. First research a provable Windows mechanism; if unavailable, retain the safe disabled state and report the unmet feature. Do not weaken rules to make Replace appear complete.

Required tests: `replaced_target_must_match_approved_identity`; `destination_created_during_publish_survives`; `cancel_reports_all_completed_effects`; `recovery_at_each_durable_transition_keeps_recoverable_data`; `failed_undo_does_not_advance_cursor`.

### 09g — Files in use and shelf

Task slices: bounded Restart Manager lookup; request-normal-close/Retry with process protections; shelf reference store; thumbnail/staleness; drag/import/export-action routing; cross-tab/group operations; help/tests.

Shelf collection never moves original files. Store references, not file copies or secrets. Force-closing needs the separate confirmation in the source scope and must never touch protected/system processes. Close/retry operates on the selected file/action, not an unrelated active job.

Required tests: `shelf_collect_does_not_move_source`; `missing_shelf_item_keeps_original_reference`; `system_process_cannot_be_closed`; `retry_uses_original_failed_operation`.

### 09j — Disk images and clipboard history

Task slices: Windows mount/eject capabilities; isolated elevation only where needed; new-drive navigation; opt-in bounded clipboard capture; private-content exclusions; search/pin/paste/clear; optional persistence; help/tests.

No whole-app admin mode. Mounting permissions and write/read-only implications must be explicit. History defaults to memory only; respect Windows privacy flags before capture or persistence. Images and files use typed transfers, not active markup. Open in Terminal already exists and is not rebuilt.

Required tests: `private_clipboard_data_is_never_recorded`; `history_is_memory_only_by_default`; `eject_failure_keeps_drive_state_visible`; `mount_elevation_is_limited_to_one_operation`.

### 09k — Encrypted folders

Task slices: verified format/crypto/key-derivation decision; recovery keys; safe pack/unpack into bounded virtual references; unlock/edit/relock lifecycle; timeout/close; interruption journal; warnings/help; corruption/password/crash tests.

No custom cryptography and no promise of secure physical erasure on SSDs. Resolve the old “securely removed” wording with a provable plaintext lifetime policy. Recycle original source only after complete verified encrypted output and explicit approval. Unlocked editing must preserve crash recovery without leaking plaintext into generic thumbnails, version stores, indexes or diagnostics; agree that boundary in I4/I1/I9 first. This is a security review checkpoint, not permission to defer data-loss cases.

Required tests: `wrong_password_leaves_container_unchanged`; `interrupted_lock_preserves_original`; `corrupt_container_cannot_publish_plaintext`; `locked_content_is_excluded_from_generic_caches`; `relock_failure_preserves_recoverable_edits`.
