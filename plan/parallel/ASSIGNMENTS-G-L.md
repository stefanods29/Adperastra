# Code-worker assignments G-L

Continue from [ASSIGNMENTS.md](ASSIGNMENTS.md). The common reading, ownership, no-compilation and full-guide requirements there apply to every assignment below.

## G — Customization and profiles

**Steps:** 10a, 10b, 10c, 10d, 10e. **References:** v1 10a/10b; contracts 2, 3, 7, 9, 17, 18, 26, 28, 37. **Interface owner:** I6; consumes I2/I5.

**Read code:** appearance/themes/contrast/tokens, layout and Settings, format/shortcuts, folder-view store, menu/command structures, Home/nav/status components. **Owned modules:** new feature-specific customization/profile/setup/theme-editor modules and tests/styles/help. Shared application, settings, tokens, formatting and registry changes go to coordinator.

### 10a — Theme authoring and automatic themes

Task slices: validated theme import/export/live preview; material/background/font/editor-scheme controls; safe custom-CSS feasibility; day/night scheduling; Windows follow mode; wallpaper palette; per-handler accents; help/tests.

Retain contrast constraints and all six theme token parity tests. Fix the v1 ambiguity: time zone alone cannot determine actual sunrise/sunset; choose an honest offline behavior or request an owner choice if location is required, and record it before code. Custom CSS must not fetch resources, execute or obscure safety confirmations; a safe restricted theme representation may be needed under existing rules.

Required tests: `theme_import_cannot_load_remote_resource`; `custom_theme_keeps_required_contrast`; `temporary_theme_override_ends_at_next_switch`; `theme_schedule_handles_clock_change`.

### 10b — Toolbar and keyboard customization

Task slices: command visibility/order and Quick Access/menu-bar modes; validated shortcut store; conflict resolution and non-US keys; Windows/Finder/Commander/Vim presets; export/reset; help/tests.

All presets go through one command-context resolver. Text inputs and document engines retain appropriate typing/Undo keys. Resolve Ctrl+digit tab versus tag shortcuts by focus/context without silent conflict. Docking remains the existing ToolbarDock system; no new general docking architecture.

Required tests: `shortcut_conflict_is_reported_before_apply`; `vim_navigation_does_not_steal_text_input`; `non_us_shortcut_uses_agreed_key_semantics`; `hidden_toolbar_command_remains_in_palette`.

### 10c — Tab behavior, formats, profiles and portable mode

Task slices: tab widths/close/open/activation/hover preferences; locale-aware date/time/size/name display; extension behavior; open/startup/confirmation behavior; profile switching; portable data-root migration; RTL/theme/translator docs; help/tests.

Preserve existing user settings through every schema change. Portable mode has a writable-root check and safe fallback decision; no copying private signing keys. Profile switches must settle dirty documents and isolate caches/history/session references. Date patterns require a defined bounded grammar; do not hand arbitrary user text to executable format engines.

Required tests: `profile_switch_waits_for_dirty_documents`; `portable_migration_preserves_existing_destination`; `size_format_distinguishes_decimal_and_binary`; `invalid_date_pattern_is_rejected_without_resetting_other_settings`.

### 10d — Folder appearance and column sets

Task slices: stable identity/path appearance store; color/icon/background selection; inheritance and global-off; optional desktop.ini action; manual column-set definitions/assignments/suggestion; metadata loading; move/copy integration; help/tests.

Defaults do not modify folder files or infer column types. Windows customization is an explicit separate disk write with version/Undo policy. Background images are bounded/local/cached and maintain contrast. Metadata columns cannot delay basic listing or start cloud hydration.

Required tests: `folder_customization_does_not_write_desktop_ini_by_default`; `appearance_follows_in_app_rename`; `column_set_is_never_auto_applied`; `missing_background_keeps_list_readable`.

### 10e — Menus, Home, navigation, status and setup exchange

Task slices: menu data editor/live preview/reset; Home section registration/layout; nav/status descriptors and preferences; versioned setup contents; preview/selective import; safe archive/image import; rollback/Undo; help/tests.

Home/navigation registration must support E's saved groups and H's future tags/views without either copying Home code. Saved setups exclude personal paths/history unless explicitly opted in and contain no executable content. Import cannot write outside its staging/data roots, overwrite a user file, import passwords or silently remove the only route to safety/help actions.

Required tests: `setup_import_cannot_escape_destination`; `setup_export_excludes_personal_data_by_default`; `setup_partial_import_keeps_unselected_sections`; `menu_reset_keeps_registered_commands_available`.

## H — Search, organization and storage

**Steps:** 11a, 11b, 11c. **References:** v1 11a/11b/11c; contracts 15, 18, 21, 29-31, 37. **Interface owner:** I7; consumes I1/I2/I6.

**Owned modules:** new index/search/tag/storage crates or modules specified by full guides; feature services/views/styles/help/tests. Shared sources, metadata/formatters and file-operation hooks need coordinator wiring.

### 11a — Ordinary search/index and speed work

Task slices: filename/watcher reconciliation; opt-in bounded text/metadata index; query/filter grammar; name/content/filter/regex modes; incremental paged results/cancel; saved-query representation; power/policy controls; speed-check instructions.

No embeddings, semantic or photo-content search. Existing OCR text may feed the opted-in content index; background reads never fetch cloud placeholders. Resolve the old OCR-everywhere backlog overlap explicitly in the scope trace. Bound regex cost and result/corpus growth. Optional admin NTFS acceleration cannot be required for basic search. Worker proposes speed changes from code analysis; only reviewer measures and approves performance claims.

Required tests: `cancelled_search_cannot_replace_newer_query`; `index_skips_online_only_content`; `content_index_requires_opt_in`; `watcher_reconcile_removes_stale_results`; `regex_query_has_bounded_work`.

### 11b — Tags, smart folders and virtual views

Task slices: stable Windows identity/path tag store; in-app cross-drive propagation; assign/manage/merge/import/export/Undo; saved-query smart folders; Timeline/Calendar/By kind/Recent activity; optional map; Home/nav/filter wiring; help/tests.

Tag metadata writes are off by default and use version/safety hooks when chosen. Views use paged sources, not fake disk paths passed to operations. Map is off by default; verify current tile-provider policy before enabling direct tile requests, show internet use and preserve attribution. No AI similarity implementation.

Required tests: `tags_survive_same_volume_rename`; `smart_folder_reuses_validated_query`; `tag_merge_is_undoable`; `virtual_view_cannot_masquerade_as_disk_destination`; `map_makes_no_requests_while_disabled`.

### 11c — Storage scan, duplicates and folder sizes

Task slices: bounded cancellation-aware scanner; logical/allocated/online-only size semantics; treemap/drill-down; duplicate size/partial/full hash stages; review-before-recycle; folder-size cache/watch invalidation; network defaults; help/tests.

Count reported cloud size without reading content. Hard links and reparse loops need explicit accounting to avoid invented storage totals. A duplicate result is stale if file identity/content changes; revalidate before recycling. Deletion always uses reviewed shared file-operation safety and exact Undo effects.

Required tests: `storage_counts_online_only_size_without_opening`; `scan_does_not_follow_reparse_loop`; `duplicate_candidate_is_revalidated_before_recycle`; `pending_folder_size_sorts_last`; `hard_links_follow_documented_accounting`.

## I — Packs, storage controls and Office viewing

**Steps:** 12a, 12b, 13. **References:** v1 12a/12b/13; contracts 1, 15, 19, 23, 24, 32, 33. **Interface owner:** I8 and Office view side of I9.

**Read code:** setup-core manifests/signatures/downloads, data-root/store code, jobs/helpers, C's conversion/privacy contract, B's PDF/preview capabilities. **Owned modules:** new pack/storage/engine-adapter modules and Office-view handler components. C owns converter/privacy core; I returns adapter additions without rewriting it. L owns later Office editing.

### 12a — Pack manager and complete storage/background controls

Task slices: signed bounded manifests/dependencies; user-started download/resume/checksum/signature; safe versioned install/rollback/removal; setup choices; storage size/cap/clear registry; background task policy expansion; help/tests.

Register non-AI media/Office/Tesseract capabilities. No model packs or AI indexes. Clarify partial download ownership, disk-full, dependency cycles, concurrent operations and active-engine uninstall leases. Every store has truthful physical accounting, including pending/open/version/spool folders; clear confirms actual effects and never removes arbitrary paths. Extend A's policy rather than adding an independent scheduler.

Required tests: `bad_signature_prevents_pack_activation`; `pack_archive_cannot_escape_install_root`; `remove_waits_for_active_engine_lease`; `clear_storage_removes_only_owned_category`; `pause_all_reaches_every_registered_background_task`.

### 12b — Media/document engines and privacy extensions

Task slices: replaceable LGPL media binaries/license inventory; bounded command adapter/progress/cancel; non-GPL codecs; short-sample previews; headless Office conversion; optional user-installed tools; Office/media/archive selective privacy cleaning; preservation/reporting; help/tests.

Workers research, not download/install or launch engines. The reviewer verifies actual binary build options and licenses. Do not assume a program named FFmpeg has an acceptable build. No network document engine, shell-built command line or unbounded external output. Office macros are disabled; per-job profiles/temp roots are isolated. Warnings distinguish metadata removal from content removal such as comments/tracked changes.

Required tests: `engine_arguments_keep_paths_as_single_arguments`; `gpl_codec_build_cannot_be_registered_as_bundled`; `office_macro_execution_is_disabled`; `pack_missing_returns_capability_unavailable`; `privacy_content_removal_requires_explicit_choice`.

### 13 — Accurate read-only Office viewers

Task slices: quick views by format; warm accurate engine/PDF output; document/sheet/slide navigation; comments/presentation mode; missing-pack fallback; open-font licensing/metrics; versioned preview cache; view-to-editor seam; corpus comparisons; help/tests.

Cover docx/xlsx/pptx, odt/ods/odp, rtf and legacy formats individually; no silent fidelity promise for unsupported types. Preview reads do not modify sources or execute formulas/macros. Define cold/warm memory/idle limits and engine failure isolation. Engine editing decisions remain 20a's checkpoint.

Required tests: `office_view_never_modifies_source`; `missing_office_pack_keeps_chosen_app_fallback`; `warm_engine_obeys_idle_and_memory_limits`; `office_preview_cache_changes_with_engine_version`. Reviewer performs fidelity screenshot comparisons and v0.3 acceptance.

## J — PDF and image editing

**Steps:** 14a, 14b, 18a, 18b. **References:** v1 14a/14b/18a/18b; contracts 13, 16, 17, 19. **Consumes:** I2/I3/I9, provides image/project adapter in I9.

**Owned modules:** new PDF/image editing modules and project crate/service as designed, tests/styles/help. B keeps ownership of read-only PDF/viewer internals; use its exports or negotiate a precise ownership transfer. Do not let two streams edit the same handler file.

### 14a — PDF annotations, pages and forms

Task slices: edit document state/standard annotation mapping; highlight/ink/text/comments/replies; visual signatures; page insert/merge/split/reorder/rotate/delete; fill forms; Undo; protected editing; safe save/copy; interoperable output; help/tests.

Freeze annotation/page/form representation with B. Preserve unsupported PDF structures or refuse a lossy save explicitly. Visual signatures must not be described as certified signatures. Scripts in a PDF never run. Saving and export use version/owned-output/dirty-state hooks and cannot bypass unresolved Replace safety.

Required tests: `pdf_annotations_reopen_as_standard_annotations`; `form_save_preserves_unsupported_content_or_refuses`; `protected_pdf_needs_enable_editing`; `page_delete_is_undoable`; `visual_signature_is_not_claimed_certified`.

### 14b — Basic image editing and drawing

Task slices: versioned in-memory document/compare; crop/rotate/flip/resize; deterministic adjustments/filters; markup/text; erase-to-alpha/background; draw tools; export metadata/quality; dirty/save/Undo; help/tests.

Use the measured image frame and a fully specified Draw layout. Preserve orientation/color/transparency/metadata semantics explicitly. Freeze a document basis that can extend to layers in 18a without rebuilding unrelated shared UI. No AI erase/upscale. Heavy image work stays off the UI thread and allocations are bounded.

Required tests: `crop_rotation_maps_to_original_pixels`; `erase_png_produces_transparency`; `jpeg_erase_uses_chosen_background`; `image_export_preserves_metadata_by_default`; `compare_does_not_change_document_revision`.

### 18a — Layers, masks and selections

Task slices: layered/tiled document state; layer lifecycle/opacity/blends/masks; rectangle/ellipse/lasso/polygon/wand/color selections and set operations; feather/invert; copy/cut/paste as layers; transforms; history; flatten export; help/tests.

Planning/implementation dependency is manual image editor 14b, not excluded 17d. Preserve chronological integration order among included steps. Bound texture/tile/history memory and offscreen work; avoid whole-image copies on every pointer move. Define exact blend/alpha/color and selection-space semantics before dependent painting work.

Required tests: `layer_reorder_changes_composite_not_source_pixels`; `selection_boolean_operations_match_expected_mask`; `masked_transform_is_undoable`; `hidden_layer_does_not_render`; reviewer measures 24 MP interactions.

### 18b — Painting, adjustments and editable projects

Task slices: brush spacing/flow/pressure/eraser; fill/gradient/clone; curves/levels and deterministic filters; adjustment/text/shape layers; rulers/guides; open documented project format; PSD-layer import where proved; reopen/export; help/tests.

Treat project files as untrusted archives with finite counts/dimensions. Preserve unknown supported extension data or explicitly refuse destructive rewriting. Pressure support here is in scope from the step even though broader touch/pen work is backlog. Do not add model denoising.

Required tests: `brush_spacing_is_independent_of_pointer_event_rate`; `project_round_trip_keeps_layers_masks_and_text`; `project_archive_rejects_traversal_and_oversized_tiles`; `adjustment_layer_keeps_original_pixels`; reviewer measures brush frame times.

## K — Media editing and timeline

**Steps:** 15, 19a, 19b. **References:** v1 15/19a/19b; media pack 12b. **Consumes:** I3/I5/I8/I9; owns media project/render adapter.

**Owned modules:** new media editing/timeline/project services/components/tests/styles/help. Existing media player stays under coordinator for shared modifications. I provides engine process lifecycle; K does not spawn a second unmanaged engine framework.

### 15 — Basic audio/video editing

Task slices: non-destructive trim/cut/split recipe; rotate/crop/speed/volume; subtitle select/burn; waveform; scrubbing/proxy requirements; export options and jobs; missing-pack fallback; help/tests.

Depends on 12b's media engine and ordinary player, not excluded AI 14c. Define time bases, frame rounding and audio resampling once for later timeline reuse. Editing never rewrites source media; exports default to new files and respect metadata/Undo policy.

Required tests: `trim_uses_documented_frame_rounding`; `media_edit_keeps_original_unchanged`; `missing_media_pack_keeps_player_working`; `cancel_export_keeps_existing_destination`; reviewer checks 30 fps scrubbing.

### 19a — Timeline tracks and clips

Task slices: versioned project/source references; track/clip model; move/trim/split/ripple/snap/slip; Explorer/shelf/tab insertion; thumbnail/waveform caches; proxies/playback clock; missing-source relink; open/save; help/tests.

Depends on 15; no need to invent a dependency on 18b image internals. Source references are validated paths, not executable engine arguments. Persist no transient grants or proxy tokens. Undo uses exact rational/frame positions and stable clip IDs.

Required tests: `ripple_delete_moves_only_affected_clips`; `timeline_round_trip_preserves_timebase`; `missing_source_can_be_relinked_without_dropping_edits`; `proxy_cache_invalidates_on_source_change`.

### 19b — Effects, audio, subtitles and render

Task slices: transition/title/effect model; supported color/crop/speed; track/clip volume/fades/mute/solo; subtitle edit/import; export presets; bounded engine graph translation; progress/Cancel; project compatibility; help/tests.

Only effects/codecs verified in the approved engine build are enabled. Stabilization/noise reduction remain conditional on approved non-AI algorithms/licenses; never silently substitute an AI pack. Frozen time base and preview/export semantics must match. Export failure cannot replace source or prior completed output.

Required tests: `preview_and_export_use_same_transition_timing`; `mute_and_solo_resolve_deterministically`; `subtitle_import_cannot_inject_engine_arguments`; `failed_render_keeps_prior_output`; reviewer checks audio/video sync and output fidelity.

## L — Office engine decision and ordinary editing

**Steps:** 20a, 20b, 21a, 22a. **References:** v1 20a/20b/21a/22a, 13; contracts 13, 16, 17, 19, 33. **Interface owner:** editing side of I9; coordinate with I and D.

**Owned modules:** new Office-edit adapters and document/spreadsheet/presentation feature modules/tests/styles/help. No engine download, prototype execution, compilation or editing another stream's viewer code. Integration proposals cover shared dirty/view/ribbon state.

### 20a — Engine investigation, checkpoint and adapter

Task slices: source-verified engine/license/Windows integration research; reproducible comparison protocol; common command/state/document adapter; unsupported-content preservation rules; warm-instance/process isolation; later engine-specific implementation plan; round-trip corpus/test definitions; help.

**OWNER CHECKPOINT:** the original step requires approval of the editing engine after executable spikes. Workers only research and write the comparison instructions; the coordinating reviewer performs executable spikes and reports results. Engine-specific editing waits for the owner's choice. Parallel work can proceed on engine-neutral state, UI and tests using the frozen adapter, but those are not proof of a working full editor.

Do not assume desktop embedding support, browser-host APIs or free Office I/O for Univer. Verify licensing and actual pinned integration surface. The source's fallback ladder must be represented honestly. Round-trip preservation is a release requirement, not a best-effort placeholder.

Required tests/protocols: `office_adapter_rejects_unsupported_destructive_save`; `engine_failure_keeps_recoverable_document`; `office_round_trip_preserves_unknown_supported_parts`; cold/warm fidelity/memory/install-size comparison protocol, not invented results.

### 20b — Document editing

Task slices: translated movable header/ribbon/backstage; command/state mapping; text/styles/layout; headings/rulers/status; track changes/comments/replies; PDF export; autosave/recovery; cross-tab transfers; save/protected-view; help/tests.

Expose correct live enabled/pressed values from the engine adapter. Disabled/loading engine commands must not look completed. Omit AI suggestions and excluded speech-pack dictation; keep non-AI spelling within approved support. Do not require 20c for ordinary document editing.

Required tests: `document_ribbon_reflects_engine_selection`; `document_autosave_failure_keeps_dirty_state`; `track_changes_round_trip_preserves_review_data`; `document_transfer_preserves_supported_formatting`.

### 21a — Spreadsheet editing

Task slices: ribbon/formula/name bars; sheet/row/column operations and freeze; number/conditional formats; validation; charts/pivots; localized formulas/separators; sort/filter/find/replace; 100,000-row virtualization; save/transfer; help/tests.

Depends on the accepted 20a adapter, not excluded 20c. Agree formula locale/canonical storage and precision with the chosen engine; never translate formula tokens by naïve text replacement. Freeze external-link/macro policy. Unsupported workbook features must survive or cause a clear refusal before destructive save.

Required tests: `formula_locale_round_trip_preserves_calculation`; `spreadsheet_sort_keeps_rows_and_references_consistent`; `unsupported_workbook_part_is_preserved_or_save_refused`; `large_sheet_renders_bounded_visible_cells`; reviewer runs formula-parity corpus.

### 22a — Presentation editing

Task slices: own ribbon/backstage; slide navigation/lifecycle; masters/layouts/themes; shapes/text/images/tables/charts; notes; transitions/animation preservation; slideshow/presenter second-screen support; PDF/image export; save/transfer; help/tests.

Depends on 20a and Office view support, not excluded 21b. Freeze the master/theme/layout interface early so D can write the manual style library concurrently. Preserve unsupported animations instead of silently flattening the deck. Validate imported media/fonts and keep the actual presentation content separate from editor chrome.

Required tests: `presentation_round_trip_keeps_masters_and_animations`; `presenter_view_keeps_notes_off_audience_screen`; `slide_reorder_preserves_references`; `presentation_export_keeps_original_deck`; reviewer tests a real second screen when available.

## Included-step integration order

Within the coordinator's accepted revision, integrate in original roadmap order, skipping excluded AI-only steps:

07a, 07b, 07c, 07d, 07e, 07f, 07g; 08a, 08b, 08c, 08d; 09a, 09b, 09c, 09d, 09e, 09f, 09g, 09h, 09i, 09j, 09k; 10a, 10b, 10c, 10d, 10e, 10f; 11a, 11b, 11c; 12a, 12b; 13; 14a, 14b; 15, 16; 18a, 18b; 19a, 19b; 20a, 20b; 21a; 22a; 22b (partial).

This order is for integration/acceptance. Code writing can overlap across every stream where the agreed interface is ready. A late-step module is held on its worker branch until its prerequisites and safety reviews pass; it is not inserted into an earlier step just to simplify a merge.
