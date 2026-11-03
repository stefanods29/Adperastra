# Step 07a: Thumbnails, cache store, helper process and background work v1

| Field | Value |
|---|---|
| State | guide; implementation integrated, coordinator verification in progress |
| Difficulty | 3/5 |
| Branch | `step-07a-thumbnails` |
| Tag | `v0.0.20-step07a` (reserved; no tag is created by guide authoring) |
| Depends on | implemented 06f and committed KI-068/KI-079 repairs |
| Written before | 07a was built |
| Source baseline | `0154c69b3ea5afbfadc39ffa8ee2637733396348` |
| Shared interface revision | `preview-foundation-1` as defined below |

This is a guide step: the coordinator makes the decisions below; the coding agent writes the code and required tests. Workers do not compile, install dependencies, generate files, launch the app or run tests. The coordinator performs those actions and verifies the result. Read `plan/parallel/WORKER-PROMPT.md` for file ownership. Guide state does not mean implementation or runtime acceptance.

## Goal

Local pictures show thumbnails as their rows become visible. Browsing stays usable while pictures load. Background work can be paused or limited to idle time and AC power. Later features share one bounded cache and one background policy.

## Do not do in this step

- Quick preview, rich metadata and Column/Details preview are 07b; photo Gallery is 07c.
- PDF/OCR/special-format rendering is 07d-07g. Unsupported types keep existing file tiles; do not promise all Windows shell-extension thumbnail formats.
- Full App storage and quiet-hours/CPU controls are 12a. No new index, conversion, AI pack or network call.
- Do not alter existing archive/font/clipboard helper protocols or resolve unrelated open issues.

## Read first

Read STATUS/rules/conventions/pitfalls/contracts/libraries/ledger/speed/glossary/UI kit/design-spec; v1 step-07a; recipes for dependencies, settings, commands, translations and help. Read whole `src-tauri/src/helper.rs`, `jobs.rs`, `files.rs`, `bounded_stream.rs`; `clipboard.rs` image encoder section; `crates/fs-service/src/owned_io/`; `crates/version-store/src/coordination.rs`; `src/services/jobs.ts`, `files.ts`, settings; FileGrid, ItemView and current tests; SettingsView and section registry. Current code and repaired contracts override obsolete ledger references to predictable partial files.

## Decisions (already made)

- D1. Use existing rusqlite 0.41 (`bundled`), blake3 1.8, serde/serde_json and fs-service in new workspace crate `cache-store`. No image parser dependency is added. Use Windows WIC in an isolated helper for PNG, JPEG, GIF first frame, BMP, TIFF first frame, ICO and WebP when a local decoder supports it. No third-party shell extension is invoked.
- D2. WIC's factory/decoder/scaler/encoder APIs are verified in local windows 0.61.3 source. The decoder reads the guarded source handle, not a reopened user path. Decode first frame, respect EXIF orientation, bound dimensions before pixel allocation, fit inside the requested square and never upscale. Encode PNG with alpha through a bounded stream.
- D3. Cache root is `<data>/cache`, index `index.sqlite3`, blobs `blobs/<uuid>.png`, staging `pending/`; schema 1. Default total physical cap 512 MiB, 50,000 entries; cap includes index/WAL/pending/unreferenced retained blobs. Individual encoded result at most 4 MiB. One entry larger than the budget is refused.
- D4. Cache keys include normalized source path, stable source identity, size, full-precision modified time, handler ID/version, result kind and validated options. Same path/size/whole-second timestamp is insufficient. All native IDs/timestamps crossing IPC are decimal/hex strings, not lossy JS integers.
- D5. A single background scheduler, two active tasks, queue at most 256; visible requests precede overscan. At most two thumbnail helpers; each has 256 MiB memory and 5 s wall timeout. Cancelling the final consumer kills its helper after 250 ms. Existing helper consumers keep their current limits.
- D6. Idle means no input for 30 s; sample every 1 s using GetLastInputInfo. AC is GetSystemPowerStatus ACLineStatus = 1; unknown is ineligible under only-on-AC. Global pause cancels active background units and prevents new reads. Foreground user operations use existing jobs and do not wait behind cache work.
- D7. Before any background source open, check all online-only flags and reparse policy using attribute-only access. A placeholder produces cloud/fallback state and no content read. Disabled, failed or unsupported thumbnails retain the existing tile without an error toast per item.
- D8. UI thumbnail sizes are 64, 128 and 256 px; request the smallest bucket at least the visible tile's CSS size times devicePixelRatio, clamped to 256. Existing grid sizes, selection, event handlers and focus outline do not change.
- D9. Settings schema 12 adds `background` and `cache` below. Only coordinator changes canonical settings/migrations/translations/registries. Concurrent workers import the types specified here and return shared wiring instructions.
- D10. Cache operations are serialized by an OS file lock (`cache.lock`, never removed) on blocking worker threads. No lock is held while decoding. Blob leases retain an opened read-only file denying write/delete sharing; eviction skips a live lease across processes. Clear schedules leased blobs for later owned cleanup rather than breaking readers.

## Uses from other steps

| Ref | Producer; canonical definition | Exact dependency | Contract used |
|---|---|---|---|
| U1 | 06d; `src-tauri/src/helper.rs` | `HelperProcess::spawn/send_line/recv/kill`; free `helper::drive`; `DriveTimings` | Current line helper transport; helper::drive(io:&mut dyn HelperIo,token:&CancellationToken,timings:DriveTimings,on_line:&mut dyn FnMut(&str)->Result<bool,String>)->Result<DriveEnd,String>. It is a free function, not a HelperProcess method. Task-specific memory/wall/cancel limits above; preserve archive/font callers;07d adds a separate framed transport |
| U2 | 06d; `src-tauri/src/jobs.rs`, `src/services/jobs.ts` | `Jobs`, `JobContext`, `spawn_job`, `runJob<T>`, `JobHandle<T>` | Shared start/poll/cancel for requested long foreground work; thumbnail scheduling itself does not fill 32 user-job slots |
| U3 | 04a; `src-tauri/src/files.rs`, `src/services/files.ts` | `FileGrants::grant/revoke`, `fileUrl(token, name)` | Cache grants refer only to leased owned blob paths; bytes never in JSON |
| U4 | 06e; `crates/fs-service/src/owned_io/` | `SourceIdentity::capture`, `PinnedSource::open`, `PinnedDirectory::open`, `OwnedOutput` | SourceIdentity::capture(path:&Path)->OwnedIoResult<SourceIdentity>; PinnedSource::open(path:&Path,expected:&SourceIdentity)->OwnedIoResult<PinnedSource>; PinnedDirectory::open(path:&Path)->OwnedIoResult<PinnedDirectory>; OwnedOutput::create(directory:&PinnedDirectory,hint:&str)->OwnedIoResult<Self>; file_mut(&mut self)->&mut File; flush_sync(&mut self)->OwnedIoResult<()>; publish_name(&mut self,name:&str)->OwnedIoResult<PathBuf>; close(self)->ClosedOutput. ClosedOutput::publish_to(self,target:&Path)->OwnedIoResult<()>;dispose(self)->OwnedIoResult<()>. Do not copy private helpers |
| U5 | 05a/05d; `FileGrid.tsx`, `useItemInteractions.ts`, `appearance/density.ts` | `ItemViewProps`, `useItemInteractions`, `useRowSizes` | Preserve selection and density; replace only tile content with a dedicated component |
| U6 | 06c; Rust main/settings TS | `CURRENT_SCHEMA`, `SETTINGS_SCHEMA_VERSION`, `AppSettings` | Incoming schema 11; outgoing 12; keep all existing sections/defaults |
| U7 | 02; `src/services/explorer.ts` | `displayPath`, `samePath` | Display/comparison; source key normalization remains backend-owned |

Private locals in these files are not imports. U4's old SourceIdentity timestamp is seconds: add a separate high-precision source stamp in this step rather than silently changing that shared field's meaning.

## Data shapes

SourceStamp and FileIdentityKey are canonical in `crates/fs-service/src/source_stamp.rs`, reexported by fs-service and cache-store; FileIdentityKey wire mirror is services/fileIdentity.ts. Other cache data definitions live in `crates/cache-store/src/types.rs` (Rust) and `src/services/cache.ts` (wire mirrors). Wire structs derive Debug/Clone/Serialize/Deserialize, use snake_case and default additive optional fields. Store-only types need not serialize.

| Type/field | Rust; TS | Default, values and validation |
|---|---|---|
| `CacheKind` | enum; string union | `thumbnail`, `metadata`, `pdf_page`, `ocr`, `media_proxy`, reserved `model_scene` activated by07g; later steps use these IDs without renaming |
| `SourceStamp` | struct; interface | Fields: `path_key` String/string; `volume_id`, `file_id`, `modified_ticks` String/string; `size_bytes` u64/number. Path key at most 32,768 UTF-16 units; volume ID exactly8/file ID exactly16 lowercase hex; timestamp decimal Windows 100 ns ticks; size at most 2^53-1 on wire or refuse |
| `CacheKey` | struct; interface | `source` SourceStamp; `kind` CacheKind; `handler_id` String/string at most 64 ASCII letters/digits/dash; `handler_version` u32/number positive; `options_key` String/string at most 256 ASCII characters, determined by provider, not raw user JSON |
| `CacheRecord` | store-only struct | `key_hash` String; `blob_id` String UUID; `relative_name` String; `mime` String; `byte_len` u64; `width`, `height` Option<u32>; `used_unix` u64; `pending_delete` bool. No arbitrary path supplied by UI |
| `CacheLease` | wire struct/interface | `lease_id`, `token`, `name`, `mime` strings; `byte_len` number; `width`, `height` optional number. Lease ID UUID; token exactly32 lowercasehex from FileGrants; optional sensitive bool defaultsfalse, introduced additively by07d E8 for memory leases. No result bytes |
| `CacheUsage` | wire struct/interface | `disk_bytes`, `limit_bytes`, `entry_count`, `leased_count`, `pending_delete_bytes`: u64/number; all bounded safe integers; physical measurement includes SQLite sidecars/staging |
| `BackgroundTaskKind` | enum; union | `thumbnails`, `metadata`, `ocr`, `filename_index`, `content_index`, `folder_sizes`, `storage_scan`, `version_cleanup`, `pack_download`; unknown task refused, future additions additive |
| `BackgroundSettings` | struct; interface | `enabled`: bool true; `only_idle`: bool false; `only_ac`: bool false; `paused`: bool false; `tasks`: map kind to bool, defaults thumbnails/metadata/ocr/version_cleanup true; filename_index/content_index/folder_sizes/storage_scan/pack_download false until explicitly registered/enabled by their steps |
| `CacheSettings` | struct; interface | `max_mb`: u32/number, 128/256/512/1024/2048, default 512; schema-12 serde defaults apply; invalid import rejected without changing existing settings |
| `ThumbnailRequest` | struct; interface | `path` String/string absolute, max 32,768 UTF-16 units; `edge` u32/number one of 64/128/256; `consumer_id` String/string UUID; source stamp re-derived in Rust |
| `ThumbnailReply` | struct; interface | `state`: `ready`/`unsupported`/`online_only`/`paused`; `lease`: optional CacheLease, present only ready; current source revision checked before publication |
| `BackgroundStatus` | struct; interface | `paused`, `eligible`: bool; `reason`: `none`/`disabled`/`idle`/`ac`/`paused`; `running`, `queued`: u32/number; status is policy state, not an execution result |

Cache index tables: `meta` (schema_version integer); `entries` (key_hash primary text, serialized validated key text, record fields above); `pending` (owned blob UUID, source key hash, expected byte length, state staging/published). Paths are relative validated components. Do not deserialize untrusted disk rows into unchecked deletion paths. Index corruption disables/quarantines the cache without touching source files; rebuild only owned entries. Store limits remain in effect during rebuild.

| Tauri command; service export | Parameters and return | Errors |
|---|---|---|
| `thumbnail_request_start`; `requestThumbnail` | Rust `request_id`: String, `request`: ThumbnailRequest; TS keys requestId/request; async start returns unit; wrapper returns Promise of JobHandle<ThumbnailReply> | `thumbnail.bad_request`, `thumbnail.changed`, `thumbnail.too_large`, `thumbnail.failed`; shared jobs/helper errors |
| `thumbnail_release`; `releaseThumbnail` | `consumer_id`: String UUID; TS consumerId; returns unit/Promise<void>; idempotent unknown consumer | `thumbnail.bad_request` |
| `cache_release`; `releaseCacheLease` | `lease_id`: String UUID; TS leaseId; unit/Promise<void>; idempotent | `cache.bad_request` |
| `cache_usage`; `getCacheUsage` | no input; CacheUsage/Promise<CacheUsage> | `cache.unavailable` |
| `cache_clear`; `clearCache` | `kind`: optional CacheKind; returns CacheUsage | `cache.bad_request`, `cache.unavailable`; leased data retained/accounted |
| `background_status`; `getBackgroundStatus` | no input; BackgroundStatus | `background.unavailable` |

Every command starts with ensure_main, validates arguments and runs disk work off the UI thread. `thumbnail_request_start` is used only on cache misses; keep a JS request table to coalesce visible consumers before starting jobs, and scheduler queue bounds apply before source reads. The command awaits the shared scheduler permit before Jobs.begin and before resolving start, so runJob never polls an absent job. A queued caller can cancel using its consumer_id even before the JobHandle Promise resolves. Policy-ineligible thumbnails create an immediate terminal paused reply without reading the source; other providers use background.paused. Queue cancellation returns background.cancelled without Jobs.begin. Cache-hit lookup is an additive `thumbnail_lookup(request)` command returning optional ThumbnailReply without starting a job; its request/revalidation rules are identical. Service export is `lookupThumbnail` returning Promise of ThumbnailReply or null.

## Exports for later steps

| Ref | Canonical new definition | Exact public contract | Consumers |
|---|---|---|---|
| E1 | `crates/cache-store/src/lib.rs` | `CacheStore::open(root: Path reference, limit_bytes: u64)` returns Result<CacheStore, CacheError>; `lookup(key: CacheKey reference)` returns Result<Option<CacheRecord>, CacheError>; `publish(key: CacheKey reference, source: File reference, mime: str reference, width: optional u32, height: optional u32)` returns Result<CacheRecord, CacheError> | 07b-07g, 08a, 11a/c, 12a, 19a |
| E2 | same | `usage()` returns Result<CacheUsage, CacheError>; `clear(kind: optional CacheKind)` returns Result<CacheUsage, CacheError>; `trim()` returns Result<CacheUsage, CacheError>. CacheError variants BadRequest/Unavailable/TooLarge/Busy/Changed; callers map to their own error area | 12a; all result producers |
| E3 | `src-tauri/src/cache.rs` | `CacheService` managed type; `lease(record: CacheRecord reference)` returns Result<CacheLease, String>; `release(lease_id: str reference)` returns unit; `source_stamp(path: Path reference)` returns Result<SourceStamp, String> | 07b/e/d, 08a, 11a/c, 12a |
| E4 | `src-tauri/src/background.rs` | `BackgroundPolicy` managed type; `eligible(kind: BackgroundTaskKind, idle_ms: u64, ac: optional bool)` returns bool; `register(kind: BackgroundTaskKind, enabled_by_default: bool)` returns Result<unit, String>; `cancel_kind(kind)` returns unit; `set_paused(&self,paused:bool)` returns unit and updates the single shared pause authority/cancels active background units when true; `pause_all()` is the wrapper set_paused(true). Unpausing does not override enabled/idle/AC/task eligibility | 07b/e, 11a/c, 12a |
| E5 | `src/services/cache.ts` | CacheKind/CacheKey/SourceStamp/CacheLease/CacheUsage; `releaseCacheLease`, `getCacheUsage`, `clearCache` with signatures above | All UI cache consumers, 12a |
| E6 | `src/services/thumbnails.ts` | `lookupThumbnail(request)`; `requestThumbnail(request)`; `releaseThumbnail(consumerId)`; request/reply types above | 07c, shelf, tabs and custom backgrounds |
| E7 | `src/components/FileThumbnail.tsx` | component props `path`: string, `edge`: 64/128/256, `active`: boolean, `fallback`: ReactNode, `className` optional string; renders inert image or fallback, owns consumer and lease cleanup | 07c/09g and later preview surfaces |
| E8 | `src-tauri/src/thumbnail_decode.rs` | `DecodedPixels` Rust-only fields width/height/stride u32, rgba Vec<u8>, original_width/original_height u32, orientation u8; `decode_pixels(source: File reference, max_edge: u32, max_pixels: u64)` -> Result<DecodedPixels,String>. Positive caps; orientation applied before scaling; stride=width*4; checked buffer length=stride*height; helper-only, no raw-pixel JSON IPC | 07e image OCR, 08a image-preview adapter |

| Ref | Canonical definition | Exact public contract |
|---|---|---|
| E9 | crates/fs-service/src/source_stamp.rs; services/fileIdentity.ts | SourceStamp/FileIdentityKey reexports. Native capture_source_stamp(path:&Path)->OwnedIoResult<SourceStamp>;capture_file_identity(path:&Path)->OwnedIoResult<FileIdentityKey>; both use metadata/attribute-only handles, no content/cloud hydration. CacheService.source_stamp maps capture_source_stamp error to its existing String area; never duplicate stamp capture in consumers. FileIdentityKey {volume_id:string8hex,file_id:string16hex,path_key:string<=32768,stable:boolean}; zero IDs allowed only when stable=false. readFileIdentity(path:string)->Promise<FileIdentityKey>; native file_identity(path)->FileIdentityKey, metadata-only/no cloud hydration; all main-only path checks.10d/11a/11b |
| E10 | src-tauri/src/background_queue.rs | BackgroundScheduler.acquire(&self,kind:BackgroundTaskKind,consumer_id:uuid::Uuid,priority:BackgroundPriority,cancel:CancellationToken)->async Result<BackgroundPermit,BackgroundError>; cancel_consumer(&self,Uuid)->unit. Priority User/Visible/Overscan; User bypasses idle/AC background policy but not size/concurrency. Permit RAII, max2active/256waiting, FIFO perpriority; one shared permit for entire provider pipeline, no nested acquisition. BackgroundError Busy/Paused/Cancelled/Unavailable; no diskwork underqueue lock |
| E11 | src-tauri/src/thumbnail_providers.rs | ThumbnailProvider trait id(&self)->&'static str;version(&self)->u32;supports(&self,source:&PreviewSource)->bool;produce(&self,source:&PreviewSource,edge:u32,context:&JobContext)->Result<PreparedThumbnail,String>. PreviewSource {path:PathBuf,stamp:SourceStamp,mime:String,extension:String,pinned:Arc<PinnedSource>}; PreparedThumbnail {file:File,width:u32,height:u32,mime:String,source:SourceStamp}, PNG4MiB. Registry.register(provider:Arc<dyn ThumbnailProvider+Send+Sync>)->Result<(),String>; resolve(&self,source:&PreviewSource)->Option<Arc<dyn ThumbnailProvider+Send+Sync>>; fixed priority model/special_psd/special_raw/special_codec/wic, duplicate IDs refused.07g registers only its actual providers |

T1 creates source_stamp.rs/FileIdentityKey wire module and tests stable ID widths/volume distinction. T4 implements E10 and its cancellation-before-start acknowledgment tests. T3/T5 creates E11/defaultWIC provider and coalesces consumer leases in one JS table per cache key; last-consumer release cancels queued admission or active job, not another key's work. Queue/permit lifecycle tests use injected scheduler, while coordinator runs the real two-process saturation case.

Additional exact keys errors.background.paused = “Background preparation is paused.” / “La preparación en segundo plano está en pausa.”; errors.background.cancelled = “Background preparation was cancelled.” / “Se canceló la preparación en segundo plano.”; errors.background.busy = “The preparation queue is full. Try again.” / “La cola de preparación está llena. Vuelve a intentarlo.”; errors.thumbnail.busy uses same queue-full pair. Native maps preserve lowercase snake_case. `thumbnail_release` always calls scheduler.cancel_consumer, including before a job ID exists.

E1 publish reads a completed helper-owned result already bounded to 4 MiB for thumbnails; later producers specify their own finite per-kind blob cap before registration. It does not read arbitrary original user files. No duplicate exported type may be defined in another module.

## Translation keys

| Key | English | Spanish |
|---|---|---|
| `settings.background` | Background work | Trabajo en segundo plano |
| `settings.backgroundEnabled` | Enable background work | Habilitar el trabajo en segundo plano |
| `settings.backgroundThumbnails` | Create thumbnails | Crear miniaturas |
| `settings.backgroundIdle` | Only when idle | Solo en inactividad |
| `settings.backgroundAc` | Only on AC power | Solo con el cargador conectado |
| `settings.backgroundPaused` | Pause all background work | Pausar todo el trabajo en segundo plano |
| `settings.cacheLimit` | Preview cache limit | Límite de la caché de vistas previas |
| `settings.cacheLimitOption` | {size} MB | {size} MB |
| `background.waitingIdle` | Waiting for inactivity | Esperando inactividad |
| `background.waitingAc` | Waiting for AC power | Esperando el cargador |
| `errors.thumbnail.bad_request` | This thumbnail request is not valid. | La solicitud de miniatura no es válida. |
| `errors.thumbnail.changed` | The file changed. Try again. | El archivo cambió. Vuelve a intentarlo. |
| `errors.thumbnail.too_large` | This picture is too large to preview. | Esta imagen es demasiado grande para la vista previa. |
| `errors.thumbnail.failed` | This thumbnail could not be created. | No se pudo crear esta miniatura. |
| `errors.cache.bad_request` | This cache request is not valid. | La solicitud de caché no es válida. |
| `errors.cache.unavailable` | The preview cache is not available. | La caché de vistas previas no está disponible. |
| `errors.background.unavailable` | Background work is not available. | El trabajo en segundo plano no está disponible. |

Reuse common.cancel/common.close/existing online-only labels; verify exact existing keys before wiring. Errors from item thumbnails are fallback states, not one toast per file.

## Tasks

### T1 — Cache crate, types and dependencies
**Files:** create `crates/cache-store/Cargo.toml`, `src/lib.rs`, `src/types.rs`, `src/error.rs`; coordinator registers workspace/dependencies and notices.
**Do this:** declare E1/E2 and data tables; CacheError as listed; pin existing rusqlite/blake3 versions/features; do not install from worker. Keep storage operations initially unregistered until their real implementations exist. **Uses:** U4/U6. **Tests:** `step07a_key_tests.rs`: `cache_key_changes_with_file_revision`, same path/size at ticks 10 and 11 gives distinct hash; `ids_do_not_lose_precision`, file ID above 2^53 retains exact string. **Traps:** do not use whole-second mtime or hash a Rust debug string. **Commit:** `deps: add cache store workspace dependencies [step-07a/T1]`.

### T2 — Owned cache persistence and physical budgets
**Files:** create crate `src/store.rs`, `src/schema.rs`, `src/cleanup.rs`, `tests/step07a_store_tests.rs`.
**Do this:** validate root; acquire OS lock; create schema or refuse newer schema; key hash is BLAKE3 of canonical field order with length-prefixed UTF-8 values and fixed-width little-endian integers; lookup validates record/owned blob; publish stages, flushes, rechecks source stamp, publishes no-replace UUID blob, commits index, then evicts oldest unleased records by used_unix/key_hash. Account all physical files. Clear removes only verified owned blobs; do not delete foreign or uncertain entries. **Uses:** U4/E1. **Tests:** physical limit 2 MiB with two 1 MiB blobs evicts oldest unleased; lease oldest leaves it and refuses admission when remaining cap cannot fit; fixture inputs live outside the cache and total physical usage stays within the cap; foreign file remains unchanged after clear; interrupted publication is never a usable hit. **Traps:** SQLite metadata success is not proof a blob exists. **Commit:** `feat(cache): bounded owned cache persistence [step-07a/T2]`.

### T3 — Source stamp and lease service
**Files:** create `src-tauri/src/cache.rs`, `cache_leases.rs`, `cache_stamp.rs`; create service `src/services/cache.ts`; coordinator IPC wiring.
**Do this:** implement E3/E5 and cache commands; obtain identity/full FILETIME from an opened attribute handle; validate no recall/reparse before content opens; lease pins verified owned blob before granting URL; release revokes token then drops pin; cap active leases at 512, expire only after explicit release/process exit, never silently while displayed. **Uses:** U3/U4/E1/E2. **Tests:** `cache_lease_tests`: pin survives clear and usage includes its bytes; releasing twice succeeds; unknown/foreign UUID cannot revoke another grant; source stamp differs for subsecond changes. **Traps:** never trust an input blob path. **Commit:** `feat(cache): source revisions and leased file grants [step-07a/T3]`.

### T4 — Shared background policy
**Files:** create `src-tauri/src/background.rs`, `background_queue.rs`, `background_windows.rs`, `src/services/background.ts`; coordinator settings schema 12 and default/migration/test/measurement settings changes.
**Do this:** implement D5-D7/E4 with pure decision function and injected clock/power inputs; poll Windows on dedicated thread; bounded priority queue keyed by result request; coalesce consumers; pause cancels active tokens and drains no source reads; register only actual installed feature task kinds. Add Windows features `Win32_UI_Input_KeyboardAndMouse`, `Win32_System_Power`; GetLastInputInfo wrap-safe milliseconds relative to current system tick. **Uses:** U1/U6. **Tests:** idle 29,999 false/30,000 true; only-AC with unknown false; paused always false; queue 257th returns busy without read; two active tasks maximum. **Traps:** do not cancel foreground file transfers. **Commit:** `feat(background): common bounded background policy [step-07a/T4]`.

### T5 — WIC thumbnail helper
**Files:** create `src-tauri/src/thumbnail_helper.rs`, `thumbnail_decode.rs`, `thumbnail_encode.rs`; coordinator helper dispatch in main.
**Do this:** flag `--thumbnail-helper`; one request on stdin with source path, expected stamp, edge, owned output path; no secrets/paths on command line; helper rechecks source and holds guard; implement E8 as COM-balanced WIC decode from guarded handle, checks width/height 1-65,536 and product at most 100,000,000; orientation then scale, nearest rounded dimensions minimum 1; output PNG at most 4 MiB in owned staging; return only bounded metadata, no binary JSON. Parent validates child report, length, PNG signature/dimensions/source stamp before cache publish. **Uses:** U1/U4/E1/E3/E8. **Tests:** 400x200 edge128 ->128x64; 20x10 edge64 ->20x10; zero/oversized dimensions refused before pixel allocation; timeout/cancel retains no published entry and preserves original. **Traps:** release COM objects before source guard; never read clipboard for a file thumbnail. **Commit:** `feat(thumbnails): isolated bounded WIC rendering [step-07a/T5]`.

### T6 — Thumbnail request service and cancellation
**Files:** create `src-tauri/src/thumbnails.rs`, `thumbnail_jobs.rs`, `src/services/thumbnails.ts`, `src/__tests__/thumbnails.test.ts`; coordinator command registration/allowlist.
**Do this:** implement lookup/start/release wrappers and E6; capture validated source stamp before queueing; check again at dispatch/result; max path/edge/UUID/request-id validation; task uses helper only after policy eligibility; no duplicate work for equal key; remove consumer on unmount; only newest key can publish UI reply. **Uses:** U1-U4/E1-E4. **Tests:** 2 consumers same key produce one helper; releasing one preserves other; final release cancels; old stamp completion is rejected; online-only input causes zero decoder/source-content calls. **Traps:** JobHandle has completion, not result. **Commit:** `feat(thumbnails): coalesced revision-aware requests [step-07a/T6]`.

### T7 — Grid thumbnail component
**Files:** create `src/components/FileThumbnail.tsx`, `src/services/useThumbnail.ts`, `src/styles/thumbnails.css`, `src/__tests__/fileThumbnail.test.tsx`; coordinator edits FileGrid tile slot and main CSS import.
**Do this:** implement E7; hook owns consumer UUID/revision and releases exactly once; inactive/offscreen components cancel pending work; image is aria-hidden because row already names file; object-fit contain, background surface.pane, no changes to cell size/selection/focus/badges; use existing tile fallback. Add component only for file kinds and supported extension claims, never folders/drives. **Uses:** U5/E5/E6. **Tests:** stale promise cannot replace newer path; unmount releases pending consumer and ready lease; Cloud fallback remains; keyboard/double-click tests keep old behavior. **Traps:** do not remount the row or change its key for a thumbnail. **Commit:** `feat(explorer): lazy thumbnails in existing item grids [step-07a/T7]`.

### T8 — Settings, help and reviewer measurements
**Files:** create `src/views/settings/BackgroundSettings.tsx`; help pages below; coordinator SettingsView/section registry, translations/pseudo, scripts and report wiring.
**Do this:** settings section after Versions; on/off, thumbnails toggle, idle, AC, Pause all and cache limit; disabled/loading states from status; toggles persist one atomic settings update; label/status values from key table. Section class adp-settings-section; 8 px gaps; normal Switch; no new colors. Reserve shots 57-thumbnails and 58-background-work; measures named below. **Uses:** U6/E4-E7. **Tests:** `backgroundSettings.test.tsx`: paused toggle persists once; import schema11 keeps language/theme/templates and supplies new defaults; unsupported cache limit rejected without resetting other fields. **Traps:** worker writes tests but coordinator generates pseudo/runs checks. **Commit:** `docs(help): thumbnails and background work [step-07a/T8]`.

## Help pages

Create `help/en/thumbnails-and-views.md` with title **Thumbnails and views**. Intro: “Picture thumbnails help you recognize local files without opening each one.” How to use: “Choose an icon view from **View**. Pictures load as you scroll. Open **Settings > Background work** to pause thumbnail creation.” Good to know: “Online-only files keep their cloud icon. Unsupported or damaged pictures keep their file icon. Your original pictures are never changed.” Last line: `See also: "Views: icons, list, details, tiles, content and columns" and "Background work".`

Create matching Spanish page, title **Miniaturas y vistas**. Intro: “Las miniaturas te ayudan a reconocer las imágenes locales sin abrir cada archivo.” Cómo usar: “Elige una vista de iconos en **Ver**. Las imágenes cargan mientras te desplazas. Abre **Configuración > Trabajo en segundo plano** para pausar la creación de miniaturas.” Para tener en cuenta: “Los archivos solo en línea conservan el icono de nube. Las imágenes no compatibles o dañadas conservan su icono de archivo. Las imágenes originales nunca cambian.” Last line: `Consulta también: «Vistas: iconos, lista, detalles, mosaicos, contenido y columnas» y «Trabajo en segundo plano».`

Create `help/en/background-work.md`, title **Background work**. Intro: “Choose when Adperastra prepares previews in the background.” How to use: “Open **Settings > Background work**. Turn on **Only when idle** to wait until you have not used the computer for 30 seconds. Turn on **Only on AC power** to wait for the charger. **Pause all background work** stops preparation until you turn it off.” Good to know: “Opening and copying files still work while preparation is paused. The preview cache has a size limit and can be rebuilt. Background preparation never downloads online-only files.” Last line: `See also: "Thumbnails and views" and "Changing language and theme".`

Spanish page title **Trabajo en segundo plano**. Intro: “Elige cuándo Adperastra prepara las vistas previas en segundo plano.” Cómo usar: “Abre **Configuración > Trabajo en segundo plano**. Activa **Solo en inactividad** para esperar hasta que lleves 30 segundos sin usar el equipo. Activa **Solo con el cargador conectado** para esperar el cargador. **Pausar todo el trabajo en segundo plano** detiene la preparación hasta que lo desactives.” Para tener en cuenta: “Puedes abrir y copiar archivos aunque la preparación esté pausada. La caché de vistas previas tiene un límite y se puede volver a crear. La preparación en segundo plano nunca descarga archivos solo en línea.” Last line: `Consulta también: «Miniaturas y vistas» y «Cambiar idioma y tema».`

Use actual Markdown headings/paragraphs from this full text; no extra untranslated words. Existing view-modes help gains: “Local pictures can show thumbnails. See Thumbnails and views.” / “Las imágenes locales pueden mostrar miniaturas. Consulta Miniaturas y vistas.”

## Check by hand

| Retained synthetic fixture | Content |
|---|---|
| `<review-root>/step07a/landscape.png` | 400x200 pixels, left half blue/right half green, no personal metadata |
| `portrait.jpg` | 200x400 pixels with EXIF orientation 6 |
| `broken.png` | UTF-8 text `not a picture` |
| `notes.txt` | UTF-8 text `Thumbnail fallback` |
| `many/` | 1,000 synthetic copies of landscape.png with distinct names |

Coordinator creates fixtures without overwriting existing files. Check large/medium/small icons, scroll, selection/F2/context/drag/Undo unchanged; pause/idle/AC toggles; stale-request switch; unsupported/damaged fallback; restart and cache cap; no network; no source writes. Repeat Spanish dark, pseudo and keyboard-only. Online-only check requires a pre-existing placeholder supplied by owner; never create cloud integration or hydrate it for testing.

## Speed

Measurements: `step07a.thumbnail.first-visible` Fast 1 s; `step07a.thumbnail.cached` Instant 0.1 s; `step07a.background.pause` Instant 0.1 s; `step07a.grid.scroll` Smooth 16 ms/frame. Include existing browsing/selection/tab/startup rows and previous-step comparison. Reviewer measures release build, records medians/cold/warm distinction and actual cache usage; no invented results.

## Screenshots

Reserve `57-thumbnails`, `58-background-work`, each en/light, es/dark, pseudo/light under `docs/screenshots/step-07a/`. Coordinator adds capture actions; workers do not launch them.

## Done when

- [ ] T1-T8 code and specified tests are complete; coordinator checks/gate/package pass and results are recorded.
- [ ] Cache keys detect subsecond revisions; all storage is bounded, accounted and ownership-safe; live leases survive clear/eviction.
- [ ] Online-only sources cause no background content read; pause/idle/AC apply and foreground work stays usable.
- [ ] Existing helper consumers, grid selection/keyboard/rename/drag and settings survive unchanged except the specified additions.
- [ ] E1-E11 and all consumer guides agree exactly; no duplicate or guessed shared name.
- [ ] Bilingual help/keys, pseudo/screenshots/speed and known-issue/report updates are verified. No implementation or milestone acceptance is claimed from this guide alone.

## Integration amendments — 2026-11-02

- E1 adds `CacheStore::open_blob(&CacheRecord)->Result<File,CacheError>`. It verifies the indexed native object identity on the same read-only handle retained by a lease. Cleanup uses durable `owned_blobs` identity receipts and same-handle deletion; a UUID filename alone never establishes ownership. Cache hits defer bounded recency updates instead of scanning/fsyncing the entire cache per tile.
- U4 adds `PinnedSource::open_background(&Path,&SourceIdentity)->OwnedIoResult<PinnedSource>`. Background providers use no-recall opens and check online-only flags on that opened handle before reading. Existing `open` retains foreground behavior.
- Thumbnail helper output uses a parent-held delete-on-close staging guard and identity-checked child writer. The parent transfers lifetime to a read handle after validation; the kernel cleans staging after the final handle closes, including a process crash.
- E6 `requestThumbnail(request:ThumbnailRequest,sourceRevision?:object)` and E7/FileThumbnail `sourceRevision?:object` accept an optional listing revision. The wire request is unchanged. A refreshed listing invalidates the UI group so Rust checks full precision stamps even when the path and size are unchanged.
- `subscribeBackgroundEligible(listener:()=>void):()=>void` in services/background.ts shares one one-second status poll while paused previews wait. Hidden/unmounted views unsubscribe; eligibility retries the normal request and releases the previous consumer. Damaged pictures do not retry indefinitely.
- The original 100-byte cache test could not hold a SQLite index while satisfying the physical cap. T2 now uses the 2 MiB fixture above without weakening physical accounting. Additional tests cover foreign physical bytes, corrupt/oversized rows, unknown schemas, cache substitution, all eight EXIF orientations, cancel-before-admission, pause/resume, and crash cleanup.

- E1 adds `CacheStore::with_staging_budget<T>(&self,bytes:u64,create:impl FnOnce()->Result<T,CacheError>)->Result<T,CacheError>`. Operation/OS locks cover admission and callback. The callback exclusively creates a guarded file pre-sized to its maximum result length before returning; the store verifies total physical usage. WIC reserves 4 MiB before helper launch and shrinks only after the bounded write finishes. Other processes see the same reserved length, and process crashes reclaim it through delete-on-close. Reserved filenames are never treated as ownership evidence.
