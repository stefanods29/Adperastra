# Step 07b: Quick preview and rich file information

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | `step-07b-preview-metadata` |
| Tag | `v0.0.21-step07b` |
| Depends on | 07a, handler/open pipeline 04a, protected view 04c |
| Written before | 07a was built |
| Source baseline | `0154c69b3ea5afbfadc39ffa8ee2637733396348` |
| Shared interface revision | `preview-foundation-1`, `metadata-preview-1` |

This is a guide step. The coordinator defines all behavior and interfaces here; workers write code and tests without compiling/running them. Shared edits and executed verification belong to the coordinator. Read the producing guide's export rows before using any dependency below.

## Goal

Space opens a read-only preview of the focused local file. Arrow keys move through eligible files; Space or Escape closes it and restores focus. The Details pane and Column preview show useful type-specific facts without slowing basic browsing.

## Do not do in this step

No new file format handler (07d-07g), Gallery (07c), editing, background content indexing (11a), metadata writing/privacy cleanup (08c), download/hydration on selection, automatic audio/video playback, or unrelated Explorer repairs.

## Read first

Full 07a guide and E1-E7; current handler types/registry/openPipeline and FileTabView; `src/views/explorer/DetailsPane.tsx`, `views/ColumnPreview.tsx`, useItemInteractions; `src/services/explorer.ts` and files; current image/media/text/Markdown handlers; common Dialog/focus behavior; all plan rules and v1 07a. Keep existing main-view source/selection ownership intact.

## Decisions (already made)

- D1. Quick preview is a modal dialog owned by the current Explorer tab, 960x720 CSS px maximum, max width viewport minus 32 px and max height viewport minus 32 px, with filename header, read-only content, previous/next, Open and Close. Background item list is inert while open; trap focus and restore the exact invoking element if still present, otherwise the originating list.
- D2. Selection/hover/Details/Column metadata and previews are background reads: no online-only hydration. Space is an explicit preview request but still does not download a cloud placeholder; show the cloud state and Open button. Open uses the normal explicit open pipeline and may then download through Windows.
- D3. Reuse the selected handler view with optional `previewOnly` true. Add this field to HandlerViewProps, default false, and honor it in existing editable handlers. Do not register SaveHandle/dirty changes or mutate the source from a preview. Protected view remains true when it was true before. Audio/video is paused initially and on every navigation/close.
- D4. Rich metadata comes from Windows property system in `--metadata-helper`, 256 MiB, 3 s wall timeout, per-field missing values tolerated. Source stamp checked before/after. Cache as kind metadata, provider `windows-properties`, version 1, options `schema=1`. No arbitrary property name supplied by UI.
- D5. Read the fixed property-name allowlist below via PSGetPropertyKeyFromName and read-only IPropertyStore/GetValue. Convert only expected PROPVARIANT kinds; no COM object activation from a returned property value. Maximum 32 fields, each text 4,096 characters, combined serialized payload 64 KiB. Free variants with the binding's RAII convention or explicit verified cleanup, never leak strings.
- D6. Metadata queue uses 07a background policy kind metadata. Repeated selection cancels old consumer; debounce Details/Column changes 150 ms. A basic listing fact appears instantly even if rich metadata fails. Cache errors never remove listing facts.
- D7. Only one quick-preview modal per Explorer tab; repeated Space closes it. Left/Right choose prior/next non-folder entry in current display order, skipping unsupported file handlers but retaining online-only items as cloud states. Never wrap from last to first. Inputs/editor text selection consume their own keys; ignore Space/arrows from editable targets.
- D8. A handler absent or ineligible for preview shows its existing file tile and Open button. No automatic Windows-app launch on Space, no automatic text/hex fallback. Preview URLs are per-file grants, released on navigation/close/error. Find is read-only and local to the preview.
- D9. No settings schema change. Existing `explorer.column_preview` still controls Column preview. Do not add persisted preview grants or last preview contents.

## Uses from other steps

| Ref | Producer, exact file/name | Inputs/output and requirement |
|---|---|---|
| U1 | 07a E1/E3; cache-store and `src-tauri/src/cache.rs` | CacheKey/SourceStamp/CacheService.source_stamp/lease and CacheLease exactly as 07a; kind metadata, schema/version/config key above |
| U2 | 07a E4; `src-tauri/src/background.rs` | BackgroundPolicy.register/eligible/cancel_kind for metadata; do not change pause semantics |
| U3 | 06d; helper.rs/jobs.rs and services/jobs.ts | HelperProcess, DriveTimings, Jobs/JobContext/spawn_job, runJob<T> returning Promise<JobHandle<T>>; cancel obsolete requests |
| U4 | 04a/06a; handlers/types.ts | HandlerViewProps.info/url/active/savedState/onStateChange/onStatus/find/protectedView and optional save callbacks; add previewOnly optional without changing meanings |
| U5 | 04a; services/files.ts | fileDetect(path) -> Promise<FileTypeInfo>; fileGrant(path) -> Promise<string>; fileRevoke(token) -> Promise<void>; fileUrl(token,name) -> string |
| U6 | 05b; views/ColumnPreview.tsx | ColumnPreviewProps item/width/showExtensions/typeLabel/onOpen; retain current props and change only internal preview/facts slots |
| U7 | 03a/06b; DetailsPane.tsx | DetailsPaneProps.selected/summary/folder and optional onShowHistory; preserve existing size/history actions |
| U8 | 02/05a; services/selection.ts and useItemInteractions.ts | Existing selection.focus is a path; current display order supplied by ItemView. Add optional callback `onPreview?: (item: ExplorerItem) => void` to ItemViewProps, no direct invoke |

U8 is an additive coordinator edit. Newer view modules import the same ItemViewProps; do not copy its interface. Row index is not stable file identity.

## Data shapes

Canonical wire definitions: `src-tauri/src/metadata_types.rs` and `src/services/metadata.ts`. Store cached validated DTO as UTF-8 bytes with MIME application/json; pass ordinary small metadata result as JSON but all file/media bytes remain on grants/protocol.

| Name | Fields, types, default/validation |
|---|---|
| `MetadataValue` | Tagged enum with `kind` text/integer/decimal/date/list; text `value` String/string; integer u64/number safe integer; decimal finite f64/number; date ISO8601 UTC string; list Vec<String>/string[] max16 entries. Unknown/incorrect type yields omitted field, not a coerced display string |
| `MetadataField` | `id` MetadataFieldId, `value` MetadataValue; canonical ID comes only from fixed table |
| `MetadataFieldId` | width/height/orientation/date_taken/camera_make/camera_model/duration_ms/video_codec/frame_rate/audio_title/audio_artist/audio_album/author/page_count/word_count |
| `MetadataInfo` | `source` SourceStamp; `fields` Vec<MetadataField>/MetadataField[] max16 sorted in table order; `partial` bool default false; `missing` Vec<MetadataFieldId> max16; no translated text |
| `MetadataRequest` | `path` absolute String/string max32,768 UTF-16 units; `consumer_id` UUID String/string; no source identity/property names accepted from UI |
| `PreviewSelection` | TS only: `items` readonly ExplorerItem[] current display order; `path` string; `origin` HTMLElement or null, never serialized |
| `QuickPreviewProps` | selection PreviewSelection; `onClose`: callback to void; `onOpen`: callback taking path string and returning Promise<void>; `onOpenHelp`: callback taking slug string to void |
| `PreviewSurfaceProps` | info FileTypeInfo; `active` boolean; `onOpen` callback returning Promise<void>; `onStatus` optional callback receiving FileTabStatus; `onOpenHelp` optional callback receiving slug; owns grant, never exposes raw path URLs |

| Field ID; label key suffix | Windows canonical property | Normalization |
|---|---|---|
| width; width | System.Image.HorizontalSize | positive u32 pixels |
| height; height | System.Image.VerticalSize | positive u32 pixels |
| orientation; orientation | System.Photo.Orientation | integers1-8 only |
| date_taken; dateTaken | System.Photo.DateTaken | valid FILETIME -> UTC ISO string; no guessed timezone for malformed values |
| camera_make; cameraMake | System.Photo.CameraManufacturer | trimmed text |
| camera_model; cameraModel | System.Photo.CameraModel | trimmed text |
| duration_ms; duration | System.Media.Duration | unsigned 100 ns ticks /10,000, floor to integer ms |
| video_codec; codec | System.Video.Compression | bounded string or known GUID string, no executable codec loading |
| frame_rate; frameRate | System.Video.FrameRate | finite positive integer units /1000 frames/s |
| audio_title; title | System.Title | trimmed text |
| audio_artist; artist | System.Music.Artist | list of trimmed distinct strings, max16 |
| audio_album; album | System.Music.AlbumTitle | trimmed text |
| author; author | System.Author | list max16 |
| page_count; pages | System.Document.PageCount | nonnegative u32 |
| word_count; words | System.Document.WordCount | nonnegative u32 |

Fields not applicable to the format may be missing. Do not infer page/word count from file size. Helpers do not write property stores.

| Command/service | Arguments, return, errors |
|---|---|
| `metadata_read_start`; `readMetadata` | Rust request_id String, request MetadataRequest; TS requestId/request; start returns unit, wrapper Promise<JobHandle<MetadataInfo>>. Errors metadata.bad_request/changed/too_large/failed plus shared helper/jobs errors |
| `metadata_release`; `releaseMetadata` | consumer_id UUID; TS consumerId; idempotent unit/Promise<void> |
| command `explorer.quickPreview` | label commands.quickPreview, icon Eye, shortcut Space in item-list context only, enabled one focused file; help quick-preview |

## Exports for later steps

| Ref | Canonical file/export | Exact contract and consumers |
|---|---|---|
| E1 | `src/services/metadata.ts`: MetadataFieldId/MetadataValue/MetadataField/MetadataInfo, readMetadata/releaseMetadata | Types/wrappers above; 07c date grouping, 09e rename metadata, 10d columns, 11a index, 11b views, 12b richer adapters |
| E2 | `src-tauri/src/metadata.rs`: `read_metadata` | path Path reference, expected SourceStamp reference, token CancellationToken reference -> Result<MetadataInfo,String>; helper process only; 11a/c and later adapters reuse DTO, not COM on main thread |
| E3 | `src/components/PreviewSurface.tsx`: PreviewSurface | PreviewSurfaceProps above; read-only lease/grant-owning surface; 07c, 09f conflict previews and tabs |
| E4 | `src/preview/QuickPreviewDialog.tsx`: QuickPreviewDialog | QuickPreviewProps above; E stream's later independent folder tabs own separate modal selection/origin |
| E5 | `src/handlers/types.ts`: `HandlerViewProps.previewOnly` | optional bool, default false; all later handlers/editors must suppress mutation/save/dirty/autoplay when true |

### Static metadata providers (metadata-preview-1)

E6 canonical `src-tauri/src/metadata_providers.rs`: MetadataProvider trait id(&self)->&'static str;supports(&self,source:&PreviewSource)->bool;read(&self,source:&PreviewSource,context:&JobContext)->Result<MetadataInfo,String>. PreviewSource is07a E11, not a copied source type. MetadataProviderRegistry.register(provider:Arc<dyn MetadataProvider+Send+Sync>)->Result<(),String>;resolve(source:&PreviewSource)->Option<Arc<dyn MetadataProvider+Send+Sync>>. Fixed priority special_psd/special_raw/special_codec/windows_properties; duplicate IDs refused. Providers may emit only existing MetadataField IDs and Value variants listed above; model counts/layer names remain their own viewer UI, not invented property IDs. Windows provider owns existing allowlisted property store helper.07g wrappers call isolated decoders and return dimensions/orientation only. Provider read obtains one07a E10 permit in the outer request, not recursively. T2 creates provider registry/default provider and typed selection tests. Explicit user inspection uses priorityUser; automatic details useVisible and policy; paused returns translated background.paused, not a fake empty metadata result.

## Translation keys

| Key | English | Spanish |
|---|---|---|
| commands.quickPreview | Quick preview | Vista previa rápida |
| preview.previous | Previous file | Archivo anterior |
| preview.next | Next file | Archivo siguiente |
| preview.open | Open | Abrir |
| preview.readOnly | Preview only | Solo vista previa |
| preview.unavailable | No preview is available for this file. | No hay una vista previa disponible para este archivo. |
| preview.onlineOnly | Open this online-only file to download it. | Abre este archivo solo en línea para descargarlo. |
| preview.loading | Preparing preview… | Preparando la vista previa… |
| metadata.width | Width | Ancho |
| metadata.height | Height | Alto |
| metadata.orientation | Orientation | Orientación |
| metadata.dateTaken | Date taken | Fecha de captura |
| metadata.cameraMake | Camera manufacturer | Fabricante de la cámara |
| metadata.cameraModel | Camera model | Modelo de cámara |
| metadata.duration | Duration | Duración |
| metadata.codec | Video codec | Códec de video |
| metadata.frameRate | Frame rate | Fotogramas por segundo |
| metadata.title | Title | Título |
| metadata.artist | Artist | Artista |
| metadata.album | Album | Álbum |
| metadata.author | Author | Autor |
| metadata.pages | Pages | Páginas |
| metadata.words | Words | Palabras |
| metadata.partial | Some details are not available. | Algunos detalles no están disponibles. |
| metadata.pixels | {count} px | {count} px |
| metadata.fps | {count} fps | {count} fps |
| errors.metadata.bad_request | This details request is not valid. | La solicitud de detalles no es válida. |
| errors.metadata.changed | The file changed. Select it again. | El archivo cambió. Vuelve a seleccionarlo. |
| errors.metadata.too_large | These details are too large to display. | Estos detalles son demasiado extensos para mostrarlos. |
| errors.metadata.failed | These file details could not be read. | No se pudieron leer los detalles del archivo. |

Reuse current keys for close/cancel/size/date/file errors and skeletons; add no text through Rust errors. Display values with locale services, ISO date converted at display, duration minutes/seconds using locale number formatting without sentence concatenation.

## Tasks

### T1 — Metadata DTO and helper dependency features
**Files:** create metadata_types.rs, metadata_properties.rs; coordinator adds windows feature Win32_UI_Shell_PropertiesSystem and common COM features only if missing. **Do this:** implement fixed ID/property/type mapping above; add none for arbitrary user-selected names; defaults/validation exactly table; lifetime-safe variant conversion. **Uses:** U1/U3. **Tests:** `metadata_types_tests`: duration ticks 12,345,678 ->1,234 ms; frame rate29,970 ->29.97; list17th trimmed; text4097 refused as partial; unknown property omitted. **Traps:** units and PROPVARIANT kinds differ. **Commit:** `feat(metadata): fixed bounded property data [step-07b/T1]`.

### T2 — Read-only property helper
**Files:** create metadata_helper.rs, metadata_windows.rs; coordinator helper dispatch main. **Do this:** flag --metadata-helper, read one request; check source flags/stamp; initialize COM; open property store read-only through GPS_DEFAULT with no write flags; fixed property list; enforce limits; poll cancellation between fields; recheck source; report partial missing values; parent kills after3s. **Uses:** U1-U3/E2. **Tests:** helper malformed request fails; online-only test has zero content-store opens; crash/timeout returns error while Explorer stays alive; property failure preserves available fields. **Traps:** no default-value zeros for unknown facts. **Commit:** `feat(metadata): isolate Windows property reads [step-07b/T2]`.

### T3 — Cached metadata jobs/services
**Files:** create metadata.rs, metadata_jobs.rs, src/services/metadata.ts; coordinator IPC and managed state. **Do this:** implement E1/E2 requests; max128 active consumers; coalesce equal stamp; use metadata background policy; cache cap256KiB per result and global budget; invalid/oversized cached data treated miss; release cancels final consumer; update source revision before returning. **Uses:** U1-U3. **Tests:** stale revision rejected; two same consumers one helper; paused policy no read; cache hit returns same normalized fields; malformed cache never reaches UI. **Traps:** cache SourceStamp/CacheKey imported unchanged. **Commit:** `feat(metadata): cancellable cached metadata service [step-07b/T3]`.

### T4 — Read-only handler preview contract
**Files:** create src/preview/previewHandler.ts, src/components/PreviewSurface.tsx; coordinator optional previewOnly field and existing handler guards. **Do this:** find handler through existing registry; grant/revoke source; all editor mutation paths disabled in previewOnly even if callbacks supplied; unsupported/cloud/error fallback; keep loading skeleton100ms/text1s; no OpenInWindows automatic action. **Uses:** U4/U5/E5. **Tests:** preview cannot save/change dirty state; protected file remains protected; media starts paused; path changes revoke old grant; unsupported file displays Open. **Traps:** calling a normal editable handler without the previewOnly guard is not read-only. **Commit:** `feat(preview): shared inert handler previews [step-07b/T4]`.

### T5 — Quick preview dialog and navigation
**Files:** create src/preview/QuickPreviewDialog.tsx, previewNavigation.ts, useQuickPreview.ts, src/styles/preview.css; coordinator item callback/command/menu wiring. **Do this:** implement D1/D7; snapshot invoking focus, derive next eligible path from current order, clamp boundaries; one modal per origin tab; Space/Esc close; Open closes preview then awaits normal open; main list inert; reject keys from editable descendants. **Uses:** U5/U8/E3/E4. **Tests:** first previous disabled; last next disabled; folders skipped; Escape restores original focus; deleted origin falls back list; repeated Space closes. **Traps:** no selection changes from stale async preview. **Commit:** `feat(preview): keyboard quick preview dialog [step-07b/T5]`.

### T6 — Rich facts and pane adapters
**Files:** create src/metadata/MetadataFacts.tsx, useMetadata.ts, src/styles/metadata.css; coordinator minimal DetailsPane and ColumnPreview edits. **Do this:** single-file only; preserve listing facts/history/Open;150ms debounce and cleanup; two-column dl, label104px/value remaining,8px row gap, wrap anywhere for text, max16rows; use existing tokens; details preview max160px height, Column max240px, contain; multi-select retains existing summary. **Uses:** U6/U7/E1/E3. **Tests:** 2 files show no mixed metadata; failed metadata leaves size/date/history; rapid A->B excludes A facts; Spanish labels wrap; background pause no spinner forever. **Traps:** hooks path revision dependencies, no same-folder navigation. **Commit:** `feat(details): rich facts and pane previews [step-07b/T6]`.

### T7 — Translations, help and review fixtures
**Files:** help pages below; coordinator translations/pseudo/command test expectations, measure scripts. **Do this:** add full key table; command help/F1; measurements/shots below. **Uses:** E1-E5. **Tests:** preview keyboard with English/Spanish text and dark classes; all new keys paired; orphan consumer release after tab close. **Traps:** no test execution from workers. **Commit:** `docs(help): quick preview and file details [step-07b/T7]`.

## Help pages

`help/en/quick-preview.md`, title **Quick preview**. Intro: “Look inside a file without opening another tab.” How to use: “Select a file and press **Space**. Use **Left** and **Right** to view nearby files. Press **Space** or **Escape** to close the preview. Choose **Open** to open the file normally.” Good to know: “Previews do not edit your files. Online-only files show a cloud notice until you choose Open. Some formats have no preview yet.” Last line: `See also: "Opening files" and "File details".`

Spanish title **Vista previa rápida**. Intro: “Mira un archivo sin abrir otra pestaña.” Cómo usar: “Selecciona un archivo y presiona **Espacio**. Usa **Izquierda** y **Derecha** para ver los archivos cercanos. Presiona **Espacio** o **Esc** para cerrar la vista previa. Elige **Abrir** para abrir el archivo normalmente.” Para tener en cuenta: “Las vistas previas no editan tus archivos. Los archivos solo en línea muestran un aviso de nube hasta que elijas Abrir. Algunos formatos todavía no tienen vista previa.” Last line: `Consulta también: «Abrir archivos» y «Detalles de archivos».`

`help/en/file-details.md`, title **File details**. Intro: “The Details pane can show picture, music, video and document information.” How to use: “Select one file. Open the **Details pane** to see its available information. In **Columns**, the preview column shows the same information.” Good to know: “Some files do not contain every detail. Missing information is left out. Details load in the background and do not change the file. Online-only file contents are not downloaded.” Last line: `See also: "Quick preview" and "Background work".`

Spanish title **Detalles de archivos**. Intro: “El Panel de detalles puede mostrar información de imágenes, música, videos y documentos.” Cómo usar: “Selecciona un archivo. Abre el **Panel de detalles** para ver la información disponible. En **Columnas**, la columna de vista previa muestra la misma información.” Para tener en cuenta: “Algunos archivos no contienen todos los detalles. La información que falta no se muestra. Los detalles cargan en segundo plano y no cambian el archivo. No se descarga el contenido de archivos solo en línea.” Last line: `Consulta también: «Vista previa rápida» y «Trabajo en segundo plano».`

Use full Markdown heading/section structure from add-help-page recipe. Existing details-pane/view-modes help adds one sentence linking the new titles, translated consistently.

## Check by hand

Fixtures in retained `<review-root>/step07b/`: a400x200 PNG; a JPEG with fixed camera/model/date; a2s generated WAV; a local text file `Preview stays read-only`; broken.png containing `broken`; empty folder. Coordinator creates synthetic fixtures and records expected metadata, never copies personal photo tags. Select/type/Space/arrows/Escape/Open; inspect Details and Columns; switch files while loading; cancel/close; fail helper; pause policy; cloud check with pre-existing placeholder. Repeat Spanish dark/pseudo/keyboard and200% zoom. No source bytes or timestamps change from previewing.

## Speed

`step07b.quick-preview.open` Fast1s first view; cached preview Instant0.1s; `step07b.preview.next` Fast1s; `step07b.details.basic` Instant0.1s, rich facts Fast1s when local supported cache warm. Slow property handler times out at3s with listing retained and feedback. Recheck existing common interactions/20% regression policy.

## Screenshots

Reserve59-quick-preview,60-rich-details,61-column-preview; each English light, Spanish dark, pseudo/light. Keep dialog bounds/focus visible and full value wrapping.

## Done when

- [ ] T1-T7 and named tests implemented; only coordinator executes gate/package/runtime checks.
- [ ] Space/navigation/close focus works; previews cannot edit/save/autoplay or bypass protected view.
- [ ] Metadata is fixed-allowlist, bounded, cached/cancelled/versioned and skipped for cloud content.
- [ ] Basic Details/Column information remains usable on failure; source files unchanged.
- [ ] E1-E6 exactly match consuming guides; English/es/help/pseudo/speed/screenshots/report evidence complete.
