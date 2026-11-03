# Step 07g integration wiring and remaining checks

Feature files copied from preserved handoff into production; original submissions unchanged. No compilation/test execution performed by this worker.

## Shared wiring

- Declare native modules special_view_types, special_scene, special_3mf, special_model_resources, special_view_session, special_view_jobs, special_view_backend, special_views, special_images, raw_helper, psd_raster, special_thumbnails, special_metadata. special_scene owns its test submodule via path.
- Manage SpecialViews::default(). Commands: special_view_open_start, special_view_scene, special_view_raw_start, special_view_layers, special_view_close. Register these both in handler and isolation allowlist.
- Dispatch raw_helper::HELPER_FLAG before app startup using raw_helper::run_helper().
- CacheService remains managed Arc; no separate CacheStore state is needed. Feature publication now uses CacheService::publish_result and its owned staging budget.
- ThumbnailProviderRegistry and MetadataProviderRegistry are mutable producer registries; call register_special_providers/register_special_metadata during their construction, before wrapping in Arc. Their runtime key selection must use actual provider ID/version instead of fixed wic.
- Register model/raw/codecImage/psd handlers; preserve image AVIF ownership, use image/codecFallback only after existing image decode fails.
- Add model/specialImage/psd style imports; include model-helper.html/psd-helper.html Vite assets. Helper host kind entries already exist.
- Exact package/notice/locales/default-app changes are in original handoff proposals. Parent installed engines and @types/three; ag-psd has actual root index.d.ts.

## Worker fixes already applied

- Corrected helper host/type imports to webview_helper vs webview_helper_types.
- Corrected registry name and mutable registration signatures, metadata integer struct variants, ArcCacheService managed lookups, and actual psd_helper state field.
- Removed direct CacheStore managed-state assumption. Publication now creates OwnedOutput under bounded shared cache staging admission, publishes through canonical CacheService and drops owned staging; removed unsafe path-deleting temporary publication code.
- Corrected background source opens to open_background.
- RAW output now uses parent-held delete-on-close staging guard, identity-checked helper writer, bounded line reads/result reads and allowlisted errors. Production requests include full SourceStamp, not only whole-second timestamps.
- Fixed invalid JavaScript regex syntax accidentally present in native 3MF path validation.

## Remaining mandatory integration defects (not acceptance claims)

- special_thumbnails.rs still has legacy path-based temp_file/open_delete_on_close helper; replace with cache-owned, identity-pinned prepared output before acceptance.
- RAW helper staging now lives under resolve_data_dir/cache/pending, but it does not yet reserve full preview output bytes through cache admission. Pass canonical cache/budget context to this adapter; preserve kernel cleanup. RAW cancellation must use caller token rather than fixed recv timeout alone.
- Session refresh/layer commands still hold a per-session mutex while requesting helper work. Take/return owned helper state or use a per-session cancellation/operation protocol; close must cancel without waiting behind helper I/O.
- Model/PSD per-step helper counter in SpecialViews is not the shared PDF/book cap. Bind actual host admission once for all helper kinds.
- Check all producer method signatures against actual source when compiling. Worker did not compile; handoff includes older host-call shapes. Finalized SafeScene geometry must remain hash/shape checked.
- Model resource and 3MF texture fidelity, RAW orientation, complete PSD lifecycle and all malformed fixture tests require coordinator verification.
- No step completion, clean gate, screenshot or speed result is claimed by this wiring note.

## Coordinator resolution — 2026-11-03

The preceding worker remaining-defect list is historical. Coordinator verified canonical cache-owned staging and RAW budget/cancel paths, moved session helper work outside locks, added the shared two-process host admission, wired real producer keys/registries and corrected actual compiler/API/test errors. Fixed distinct texture slots and column-major world bounds. Full gate passed829Rust/777UI tests. Real packaged fidelity/codecs/resources/screenshots/speed remain unverified; do not treat static worker repairs or the implementation gate as that evidence.
