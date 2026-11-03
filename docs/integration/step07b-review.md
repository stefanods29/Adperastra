# Step07b static implementation review

Scope: read-only review of handoff/step-07b, its shared-edit proposals, current07a cache/scheduler/helper/jobs/preview setup, existing handler/editor/shortcut contracts and selected tests. No source was adopted or changed. No compilation, tests, formatting, app execution, Git action or dependency installation was performed.07a is being revised concurrently; verify final public signatures after its batch passes before applying07b.

The handoff is useful source, but is not safe to copy and register unchanged. The following are concrete integration defects or missing behavior, not owner questions.

## Required producer/API reconciliation

###07b-01: Tauri state types disagree with the now-real07a setup

Current src-tauri/src/preview_setup.rs manages Arc<CacheService>, Arc<BackgroundPolicy>, Arc<BackgroundScheduler> and Arc<ThumbnailService>. metadata_jobs.rs::CacheServiceStamp calls app.state::<CacheService>(), and the proposal similarly asks for CacheStore as independent managed state. Tauri looks up the exact managed type; Arc wrapping is not transparent. These lookups would fail/panic rather than reach the canonical store.

Prefer injecting cloned Arc<CacheService>/Arc<BackgroundScheduler>/Arc<BackgroundPolicy> directly into the metadata service and adapters at preview_setup initialization, instead of recurring AppHandle state lookups. If a command uses managed MetadataService, use one consistent exact type for manage/state everywhere. Do not manage a second CacheStore or second scheduler. SourceStamp/CacheKind already derive equality in the current foundation; do not duplicate them.

The proposed SchedulerAdmission.cancel passes consumer:Uuid, while the real BackgroundScheduler.cancel_consumer currently takes &Uuid. Fix the call to the actual signature. acquire takes self:&Arc<Self>; retrieve/inject the Arc. register_background must use the one managed policy. No settings schema bump is needed:07b stays12→12.

###07b-02: metadata coalescing has the same cancellation/admission hazards repaired in07a

metadata_jobs.rs::start creates Jobs.begin before acquiring background admission. Group.token is the first request job's token; followers have separate Jobs tokens that are not observed. Cancelling the first consumer through job_cancel therefore cancels every joined consumer, while cancelling a follower alone does not withdraw its waiter. Release before start registration is not remembered, so a late start can resurrect a closed pane's work. Released waiter IDs also remain until group completion. Metadata can occupy the32 global user-job slots while waiting for background capacity.

Use the current07a coalescing design: a group-owned cancellation token independent of each waiter job; generation/consumer reservations established before pending start; admission before Jobs.begin and before acknowledging start; per-waiter cancel/release settles only that waiter; the helper stops only when the last waiter/consumer is gone. Final consumer cancellation must withdraw queued scheduler admission. Avoid holding the group-map lock while waiting, reading, invoking cancellation callbacks or touching disk.

The existing metadata_jobs_tests exercise join and execute_group directly and do not establish these real Jobs/admission lifetimes. Add tests for leader cancellation with a live follower, follower cancellation, release-before-start, replaced consumer generation, admission pause/cancel with no missing job ID, and a user job still reservable while metadata is queued.

###07b-03: implement a bounded cache adapter over validated open handles

Current CacheService exposes with_store/lookup/publish and CacheStore exposes lookup/open_blob, but there is no managed CacheStore/read_bytes service as assumed by the proposal. Add one internal bounded reader at the cache owner or a metadata adapter using with_store. Resolve a key to its current indexed CacheRecord, then use CacheStore.open_blob(record) to obtain the verified already-open read handle. Check record size before allocating, read at most cap+1, reject oversize/truncation and keep the handle alive through deserialization. Never build/open a blob filename from caller data, return an unpinned path, or reopen the path after verification. A lookup/open race with eviction is a cache miss, not a metadata failure.

Publish JSON through an owned anonymous/delete-on-close staging handle under the validated cache pending directory, flush before CacheService.publish, and clean up only that handle. Cache failure must leave successfully read metadata visible. No browser grant/lease is needed just to read native metadata JSON; do not mint a token or create a second disk cache. Keep store locks out of helper waits.

Add tests for a valid cache hit avoiding the helper, corrupt/missing/oversized/mismatched-source cache miss, eviction between lookup and open, foreign blob substitution, active pin preventing mutation, and cache-publish failure preserving the live result. Fix supplied SourceStamp test fixtures: volume_id is8 lowercase hex, not the16-digit value used by several07b tests.

## Native read safety and bounded metadata

###07b-04: stamps before/after do not pin the file the property parser opens

metadata_windows.rs::read_metadata_with captures a source stamp, then passes a path to SHGetPropertyStoreFromParsingName, then captures another path stamp. No PinnedSource is retained. An object can be swapped while the property store opens and swapped back before the final check. Reparse/online-only checks are also path observations separated from the content-opening call. metadata_jobs.rs::source_is_online_only converts attribute failure to false.

Prepare and retain a guarded read-only source plus applicable parent-chain guards for the full helper invocation, compare the full100ns handle stamp with the expected SourceStamp, and pass only the authorized source path/handle route. The held guard must deny write/delete sharing while the property parser reads. Refuse online-only/reparse/attribute errors before content access; do not interpret unknown eligibility as local-safe. Recheck the guarded object's full identity/revision after reading and before caching/result publication. Use the actual07a prepared-source contract rather than a second identity implementation. Add a swap-then-restore race test, online-only no-content-open test, attributes-fail no-helper test, and reparse-parent test.

Windows property handlers can parse content to obtain metadata; the helper comment saying it never reads content is too broad. The actual promise is read-only/local/no-placeholder hydration, with risky parsing isolated and bounded. Do not infer full filesystem/network confinement merely from the job's256MiB limit.

###07b-05:64KiB bound and missing-field information are not enforced end to end

MetadataInfo.finalize stops trimming when fields is empty even if source.path_key alone makes serialized JSON exceed64KiB. A legal long non-ASCII Windows path can have up to32768UTF16 units but roughly98KiB ofUTF8, before envelope overhead. parse_cached accepts up to256KiB and only tests the same256KiB after finalization, so this can reach the UI despite the64KiB metadata contract.

Validate SourceStamp, full MetadataInfo and native/helper envelopes at explicit byte limits. If the minimal valid result cannot fit, return metadata.too_large rather than success with an oversize source. Bound helper reply text before deserialization; the generic line transport's8MiB cap is not the metadata result limit. Validate Failed.code against the fixed metadata/background error allowlist before storing it in Jobs; never forward an arbitrary multi-megabyte error string.

finalize also resets self.missing to an empty local vector. The helper finalizes once, drive_metadata finalizes again, and parse_cached can finalize again: existing missing IDs disappear. Preserve/deduplicate validated missing IDs and make normalization idempotent. Native PropertySource::read returns Option, conflating absent fields with present-but-invalid/failed fields; invalid values dropped in the PROPVARIANT adapter never reach finalize and may produce partial=false. Distinguish absent from invalid/unreadable sufficiently to honor partial/missing. Lists truncated from17→16 entries should not silently claim full coverage.

Add long-Unicode-source/empty-fields oversize, double-finalize equality, cached missing-ID retention, wrong PROPVARIANT present→partial, list overflow coverage and oversized/malformed/unknown-error helper reply tests.

###07b-06: Windows value conversion has concrete correctness defects

metadata_properties.rs::read_value applies split_list_text to every VT_LPWSTR, not just artist/author lists. A title such as Budget; Review becomes Budget, and camera/video scalar strings can lose suffixes. Preserve scalar text in full; split semicolon lists only for the declared list fields.

filetime_to_iso8601 rejects all ticks before1970 even though valid FILETIME dates begin1601 and the validator/comment accepts1601–9999. Use checked signed date arithmetic for legitimate pre1970 metadata, while rejecting invalid/overflow dates. The existing test expecting FILETIME0→None should be reconciled with the guide's valid FILETIME rule and the explicit chosen zero/sentinel treatment; do not silently drop all1900–1969 dates. Test at least a valid1960 date,1970 boundary, leap dates and9999 limit.

The PWSTR conversion allocates/reads the entire string with pointer.to_string before applying the4096-character limit. Read a bounded NUL-terminated prefix appropriate to the declared limit so an oversized property cannot allocate arbitrarily before rejection; the helper memory limit remains defense in depth. Verify every PROPVARIANT union member and feature against the actual locked Windows crate while compiling. Its explicit VariantGuard cleanup is appropriate only if the binding has no competing ownership/drop; keep exactly one clear.

###07b-07: reserved metadata registry is not on the production path

metadata_providers.rs defines the fixed-priority registry and Windows fallback, but MetadataService.default_reader calls metadata::read_metadata directly. Merely registering07g special providers later will not affect reads. Prepare one real PreviewSource (including its pinned source), construct the background JobContext over the group token, and resolve the installed registry inside the one admitted pipeline. WindowsPropertiesProvider is the final native fallback, not an independent parallel reader. Providers must not acquire admission recursively or invent new field IDs. Keep registered providers in managed/shared service state so later registration has an explicit owner.

Add a production-path test showing a higher-priority installed provider is called, Windows fallback is used otherwise, and one request acquires exactly one permit. If retaining a direct reader port for testing, the concrete injected implementation must call that same registry path.

## Preview and UI safety

###07b-08: failed detection currently creates an authoritative-looking fallback and parses it

QuickPreviewDialog creates failedInfo with the original extension but size0, read_only=false and from_internet=false, then feeds it to PreviewSurface. previewTargetFor can select a handler by extension, request a file grant and parse content despite failed detection. This can lose protected-view classification and bypass the handler-size decision at the UI boundary.

A detection failure must render a tile/Open-only fallback without constructing FileTypeInfo for a handler, granting bytes or marking the source ordinary. Keep explicit Open on the normal pipeline. In browser/non-native mode, keep listing facts/tile and no synthetic metadata/grants rather than faking successful native information. Add tests that fileDetect rejection causes zero fileGrant/parser calls and never creates an unprotected view.

###07b-09: aria-modal does not make the background inert or disable global commands

QuickPreviewDialog claims the list is inert, but neither it nor shared-edits.md applies inert/background shortcut gating. src/ribbon/shortcuts.ts listens on window and will execute enabled Explorer commands when a dialog button/div receives Delete/F2/Ctrl commands that the dialog does not consume. This can mutate the selected background file while preview is open.

Disable the owning Explorer's background command/shortcut scope while the modal is open, keep the appropriate background subtree genuinely inert without making the dialog inert, and preserve accessibility focus trapping. The dialog key handler should honor event.defaultPrevented so a child editor/media control's handled keys do not also navigate/close the preview. Restore focus after removing inert/modal state, using the originating Explorer list reference rather than document.querySelector's first listbox, which may belong to a hidden tab.

Add integration tests with actual command listeners: Delete/F2/new-tab/etc do not dispatch from the modal; buttons retainSpace; CodeMirror/media handled arrows/Space do not navigate; Escape closes once; background click/focus is inert; focus returns to the originating tab/list.

###07b-10: metadata hook late-start cleanup and content freshness are incomplete

useMetadata cancels/release the previous consumer before an async readMetadata start returns. If the returned handle is stale, the branch calls cancel but never observes handle.completion; a rejection can become unhandled. Native release may already have happened before native registration. The constant UUID fallback also gives every unsupported-crypto consumer the same identity.

Always observe terminal completion for a stale handle, perform an idempotent consumer release after late acknowledgement as well as early cleanup, and match native generation/tombstone semantics. Generate collision-free fallback IDs or fail explicitly when secure UUID generation is unavailable. Path/enabled are the only hook dependencies; a file edited at the same path will leave old facts visible until selection changes. Pass an authoritative refresh/revision signal from the listing/watch lifecycle and suppress old-source responses, rather than assuming path implies unchanged content.

Add delayed-start-unmount, rejected stale completion/no unhandled rejection, two-consumer crypto fallback, same-path changed source, inactive/hidden pane cleanup and React StrictMode lifetime tests.

###07b-11: preview grant identity, child failure and local Find need completion

PreviewSurface.infoKey omits size/modified/content revision and handler/type changes; its child key is only path. A new revision at the same path can retain the old grant/view. Include authoritative revision/type identity, revoke/remount or reload when appropriate, and release when inactive if the view is no longer meant to read. Current grant epoch cleanup is a useful base, but the native grant must still respect source eligibility at acquisition, not just old info.online_only.

Suspense is not an error boundary. A lazy import/render error is not caught by the grant promise catch and can escape the preview; add a bounded preview error fallback that releases the grant. previewViewProps supplies a fixed empty find request and QuickPreview has no local Find controls, despite D8 saying Find is local to the preview. Implement a local read-only FindRequest/search row for supported handlers and suppress the background Explorer's search shortcut. Never add replace/save callbacks.

Navigation opened on an unsupported file currently gets previous=null,next=null because previewNeighbors only searches the filtered eligible array; decide nearest eligible neighbors around that original position, preserving no-wrap and online-only cloud entries. Test unsupported-start navigation and same-path refresh rather than only eligible starts.

## Shared wiring required after07a passes

1. Native features: Win32_UI_Shell_PropertiesSystem and Win32_System_Variant if absent; retain the locked windows version and existing COM features. Import required cache/fs-service types from their canonical crates.
2. New native metadata modules/tests; fixed --metadata-helper early dispatch before Tauri startup; one metadata service initialized from current preview_setup Arc services; register Metadata with the existing BackgroundPolicy; one provider registry/Windows fallback.
3. metadata_read_start and metadata_release registered in generate_handler and isolation allowlist. Validate main window, request ID/path/consumer before work. Release should be idempotent and should not block the UI/async dispatcher on disk.
4. Canonical cache bounded byte-reader/publisher and prepared-source port, with lease lifetime tests. Never follow the old proposal's independent managed CacheStore.
5. HandlerViewProps.previewOnly optional/defaultfalse; add preview ReadOnlyReason; forward through TextView/MarkdownView/useTextDocument and enforce no save/save-as/dirty registration/replace/mutation on every path. Audit archive/font/other handler actions separately rather than assuming omission of registerSave alone disables all disk mutations. Media starts paused, pauses on navigation/close and does not steal focus.
6. ItemViewProps.onPreview through every view; one focused-fileSpace action; command/menu entry and help slug; current Explorer owns preview modal, item display order, inactive scope/inert state and explicit normal Open callback. Do not rewrite selection or open unsupported files automatically.
7. DetailsPane single-file and ColumnPreview internal facts/preview additions, preserving baseline listing size/date/history/cloud/column_preview behavior. Hidden/multiple/folder/online-only cases must not start metadata/parser work.
8. Feature styles, supplied EN/ES keys, generated pseudo-locale, two new help pages plus existing details/view help amendments. Keep schema12 unchanged. Add exact metadata.online_only translation if that code can be surfaced; do not forward an untranslated unknown code.
9. Add the five measurement hooks and screenshots59–61 only to the coordinator's real measurement/package run. Record actual helper isolation/timeout/source-race behavior, Spanish dark/pseudo/layout/focus/manual evidence; no mocked component test proves parser safety or keyboard command scoping.

## Suggested adoption batches

A. Fix/wire metadata types/property helper/serialization/cache source pin and adapters; prove bounds and exact state/signatures. B. Implement coalesced metadata request lifetime/admission/Jobs and canonical registry fallback with cancellation tests. C. Adopt read-only handler guards and safe PreviewSurface before exposing an entry point. D. Add modal/Explorer/pane integration and meaningful lifecycle/shortcut tests, then help/locales/evidence hooks. Parent/coordinator runs format, focused checks and the complete gate for each accepted batch.

No owner approval is needed for these corrections. They preserve the guide's decisions and repair implementation/API gaps. This review does not accept07b, does not alter incoming source/tests, and does not claim the currently running07a batch passed.
