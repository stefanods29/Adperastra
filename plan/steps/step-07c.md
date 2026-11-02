# Step 07c: Gallery

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 2/5 |
| Branch | `step-07c-gallery` |
| Tag | `v0.0.22-step07c` |
| Depends on | 07a cache/thumbnails, 07b metadata/preview, 05a selection/view conventions |
| Written before | 07a was built |
| Source baseline | `0154c69b3ea5afbfadc39ffa8ee2637733396348` |
| Shared interface revisions | preview-foundation-1; metadata-preview-1; gallery-source-1 |

This is a guide step, without implementation code. Workers implement the exact names, types, behavior, texts and tests below; the coordinator owns shared wiring and all executed checks. The dependency/export tables are normative.

## Goal

Gallery in the Explorer navigation shows pictures from folders the user chooses, grouped by date. It loads progressively, supports keyboard selection and quick preview, and opens pictures through the ordinary file-tab pipeline.

## Do not do

No AI/photo-content search, face grouping, cloud integration/downloads, automatic whole-drive scan, photo editing, duplicate cleanup, general smart folders or Timeline (11b). Do not replace the developer component gallery with photo data: retain it as Components.

## Read first

07a/07b complete guides and exports; v1 07a photo Gallery scope; current ExplorerHome location switch and nav; GalleryView.tsx developer page; ItemViewProps/useItemInteractions/FileGrid; source listings/watch and stable identity code; settings recipe/migrations; gallery placeholder tests and App tab-title translations.

## Decisions

- D1. Gallery is the existing Explorer location `gallery`, not a new permanent top-level tab kind. Developer TabKind `gallery` retains its identity/session compatibility but gets translated display name Components (`tabs.components`) and existing developer contents. No existing saved session loses that tab.
- D2. Start empty. User adds local absolute picture folders with existing folder picker; maximum32 sources, each path32,768 UTF-16 units. No default Pictures crawl before consent. Include subfolders is true per source; hidden/system follow existing settings. Refuse duplicate normalized roots; overlapping roots are allowed and deduplicated by stable file identity plus final path.
- D3. Picture eligibility: current image handler extensions plus later handlers explicitly declaring image gallery capability; do not classify every file by extension alone when byte type detection rejects it. Initial supported types match 07a. Cloud placeholders are visible as tiles based on attribute-only enumeration but never decoded or read for rich date metadata until opened normally.
- D4. Enumeration is a background job kind metadata, using existing directory listing semantics: exactly two directory workers maximum, queue256 folders, depth64, total250,000 discovered candidates. When a limit is reached, stop adding work, return partial with exact skipped count/reason. Never silently claim complete coverage. Follow no reparse directories; visited volume/file-ID set prevents loops.
- D5. Initial order is modified date descending, then normalized path ascending. Rich date_taken from07b may regroup items only after a scan generation completes or explicit Refresh; do not move items under an active pointer/keyboard selection. Group by local calendar month, newest first; undated group last. Store canonical UTC values, format labels with active locale. Display a date-source toggle Taken/Modified; Taken falls back to modified when absent.
- D6. Backend paging:256 rows maximum, cursor tied to immutable scan generation and sort/date-source. UI virtualizes rows with overscan4; do not send all250,000 objects in IPC. Source changes invalidate cursors and cancel prior scan. UI retains selected stable keys while objects update, removes only actually absent selected paths.
- D7. Grid uses 160px thumbnail, cell184x216px, gap12px, padding16px, group header32px. At width0 tests use960px. At narrow widths one column minimum. Thumbnail bucket selected through07a FileThumbnail; arrow/Home/End/Page keys follow05a grid semantics, Enter opens; Space uses07b modal. Details can show one selected picture with the same metadata service.
- D8. Settings schema13 adds gallery below; coordinator serializes only source paths/options/date mode, not result lists, grants or metadata. Remove source cancels its pending work and clears results that no remaining source covers, without deleting files or shared cache blobs immediately.
- D9. Watch only authorized source trees while Gallery active. Coalesce notifications250ms and refresh affected generation; retain selection/focus. Release watchers on last Gallery consumer close/inactive after30s. No background crawling while policy paused.

## Uses from other steps

| Ref | Producer; canonical export | Contract |
|---|---|---|
| U1 | 07a E6/E7; services/thumbnails.ts, FileThumbnail.tsx | request/lookup/releaseThumbnail and FileThumbnail(path,edge,active,fallback); no duplicate decoder |
| U2 | 07b E1; services/metadata.ts | MetadataInfo, MetadataFieldId date_taken, readMetadata/releaseMetadata; SourceStamp from07a; date field ISO UTC |
| U3 | 07b E4; preview/QuickPreviewDialog.tsx | QuickPreviewProps selection/onClose/onOpen/onOpenHelp; no editor mutation |
| U4 | 05a; views/useItemInteractions.ts, gridLayout.ts | ItemViewProps/useItemInteractions; selection paths and existing gridMove; maintain row role option and listbox keyboard semantics |
| U5 | 02; services/explorer.ts, Rust explorer/fs-service listings | ExplorerItem exactly current shape; basic listings are attribute-only for online-only entries; existing displayPath/format services |
| U6 | 06c; src-tauri/src/file_dialogs.rs | pick_folder_path(owner: isize, title: str reference) -> Result<Option<String>,String>; call on blocking thread; cancel is Ok(None), failure dialog.failed; title is translated Gallery add-folder label |
| U7 | 04a; App/openPipeline and ExplorerHome callback | Existing onOpenFile(path,background) callback returns Promise<void>; use normal detection/grants/protected-view flow |
| U8 | 07a E4; background.rs | BackgroundPolicy metadata registration/eligibility and cancellation, foreground browse remains usable |

U6's signature was checked against current source. Future tab workers use U7 rather than creating Gallery-specific open behavior.

## Data shapes

Canonical types in `src-tauri/src/gallery_types.rs`, mirrored in `src/services/gallery.ts`; store settings type in existing settings modules through coordinator. Public fields are snake_case, defaults as below.

| Type | Exact fields/validation |
|---|---|
| `GallerySource` | `id` String/string UUID; `path` String/string validated absolute max32,768 UTF-16 units; `recursive` bool/boolean default true |
| `GallerySettings` | `sources` Vec<GallerySource>/GallerySource[] default empty max32 unique IDs/normalized paths; `date_source` enum/string `taken` or `modified`, default taken |
| `GalleryItem` | `item` ExplorerItem; `identity` String/string volume/file ID; `taken_utc` optional String/string ISO UTC; `group_key` String/string `YYYY-MM` or `undated`; `source_ids` Vec<String>/string[] max32 UUIDs |
| `GalleryPage` | `generation` String/string UUID; `items` Vec<GalleryItem>/GalleryItem[] max256; `next_cursor` optional opaque String/string max128 chars; `complete` bool; `partial` bool; `skipped_count` u32/number; `limit_reason` optional `depth`/`items`/`folders`/`access`/`drive` |
| `GalleryStartRequest` | `request_id` String/string existing valid request ID; `sources` Vec<GallerySource> max32, revalidated in Rust; `date_source` as above; `show_hidden`, `show_system` booleans explicitly from current view settings |
| `GalleryCursor` | private backend generation+offset+view revision, HMAC not needed: random UUID lookup in bounded managed map, no UI-controlled file path; max64 cursors per scan, expiry10min |
| `GalleryContentProps` | `settings` GallerySettings; `active` boolean; `showExtensions` boolean; `onOpenFile` callback(path,background)->Promise<void>; `onSettingsChange` callback(GallerySettings)->Promise<void>; `onOpenHelp` callback(slug)->void |

Wire ExplorerItem is imported, not redeclared. All JSON page responses must remain below1MiB; additionally stop before768KiB serialized bytes even when fewer than256 rows fit. Cursors continue at the first omitted item; never truncate strings silently.

| Command/service | Arguments and result/errors |
|---|---|
| `gallery_start`; `startGallery` | request GalleryStartRequest -> unit; shared runJob wrapper returns Promise<JobHandle<GalleryPage>> for first page; errors gallery.bad_request/too_many/changed/unavailable |
| `gallery_page`; `galleryPage` | generation String UUID, cursor optional String -> GalleryPage; stale/foreign cursor gallery.changed; TS Promise<GalleryPage> |
| `gallery_close`; `closeGallery` | generation UUID -> unit/Promise<void>, idempotent, cancel all scan consumers/watchers |
| `gallery_pick_source`; `pickGallerySource` | no arbitrary title text; returns optional absolute path String; TS Promise<string or null>; dialog.failed |
| command `gallery.addFolder` | label gallery.addFolder, icon FolderPlus, no shortcut, help the-gallery |
| command `gallery.removeFolder` | label gallery.removeFolder, icon FolderMinus, enabled selected source only, help the-gallery |

## Exports for later steps

| Ref | File/export | Inputs/output; consumers |
|---|---|---|
| E1 | services/gallery.ts: GallerySource/Settings/Item/Page, startGallery/galleryPage/closeGallery | Types and wrappers above; future tabs and view-source adapters can reuse validated authorized sources |
| E2 | src/views/gallery/GalleryContent.tsx: GalleryContent | GalleryContentProps above; Explorer location mounts it; independent folder tabs later pass their own active state |
| E3 | src/views/gallery/galleryDates.ts: galleryMonthKey | UTC ISO string or null, fallback modified_unix number, dateSource taken/modified, timeZone string -> canonical YYYY-MM or undated; pure; 11b calendar/timeline may reuse rather than infer date rules |
| E4 | src-tauri/src/gallery.rs: GallerySessions | managed bounded map max4 scans, least-recent inactive scan cancelled before admission; no file grants persisted; 09a session restore starts a fresh scan |

## Translation keys

| Key | English | Spanish |
|---|---|---|
| tabs.components | Components | Componentes |
| gallery.title | Gallery | Galería |
| gallery.addFolder | Add picture folder… | Agregar carpeta de imágenes… |
| gallery.removeFolder | Remove folder from Gallery | Quitar carpeta de la Galería |
| gallery.sources | Picture folders | Carpetas de imágenes |
| gallery.empty | Choose a folder to see its pictures here. | Elige una carpeta para ver sus imágenes aquí. |
| gallery.noPictures | No pictures were found in these folders. | No se encontraron imágenes en estas carpetas. |
| gallery.recursive | Include subfolders | Incluir subcarpetas |
| gallery.dateSource | Group pictures by | Agrupar imágenes por |
| gallery.taken | Date taken | Fecha de captura |
| gallery.modified | Date modified | Fecha de modificación |
| gallery.undated | No date | Sin fecha |
| gallery.partial | Some pictures could not be listed. | No se pudieron mostrar algunas imágenes. |
| gallery.skipped | {count, plural, one {# item was skipped.} other {# items were skipped.}} | {count, plural, one {Se omitió # elemento.} other {Se omitieron # elementos.}} |
| gallery.loading | Looking for pictures… | Buscando imágenes… |
| errors.gallery.bad_request | These Gallery folders are not valid. | Estas carpetas de la Galería no son válidas. |
| errors.gallery.too_many | Gallery can use up to 32 folders. | La Galería puede usar hasta 32 carpetas. |
| errors.gallery.changed | Gallery changed. Refresh to continue. | La Galería cambió. Actualiza para continuar. |
| errors.gallery.unavailable | These pictures could not be listed. | No se pudieron mostrar estas imágenes. |

Month labels come from locale-aware Intl date formatting; do not translate numeric group keys. Reuse existing Refresh/Open/online-only/common keys.

## Tasks

### T1 — Sources/settings and data contracts
**Files:** create gallery_types.rs and services/gallery.ts types; coordinator schema13 migration, Rust/TS defaults/normalization, settings tests and measurement fixture settings. **Do this:** validate source count/IDs/absolute paths, normalize compare paths without losing display path, persist only settings fields; keep prior12 sections intact. **Uses:** U5/U6. **Tests:** schema12 es/dark retains existing background settings and adds empty Gallery; 33sources refused; duplicate path with case/long prefix refused; empty sources valid. **Commit:** `feat(gallery): validated picture sources [step-07c/T1]`.

### T2 — Bounded discovery and sessions
**Files:** create gallery_scan.rs, gallery_sessions.rs, gallery.rs; coordinator shared jobs/IPC. **Do this:** breadth-first scans authorized roots, visited identity set, max two workers, bounded queue/depth/items; no reparse descent or source hydration; preserve overlapping source_ids, skip hidden/system per flags; return first256 while continuing bounded job; snapshot generation for paging. **Uses:** U5/U8/E4. **Tests:** overlapping roots list one file with two source IDs; loop skipped; online-only candidate visible without content open; 250,001st returns partial reason items; access error preserves other root. **Commit:** `feat(gallery): bounded deduplicated discovery [step-07c/T2]`.

### T3 — Date grouping and stable pages
**Files:** create galleryDates.ts, gallery_order.rs, gallery_pages.rs and dedicated tests. **Do this:** apply D5/D6; immutable generation, bytes/row caps, oldest cursor expiry; rich taken date collected via07b only when permitted, stage regroup for scan completion/refresh; sort tie normalizedpath. **Uses:** U2/E3. **Tests:** taken2026-01-01T00:30Z, Lima UTC-5 ->2025-12; missing taken uses modified; zero dates undated; cursor from another scan rejected; page256 then remaining1 yields no duplicate. **Commit:** `feat(gallery): stable dated paging [step-07c/T3]`.

### T4 — Virtualized photo grid
**Files:** create src/views/gallery/GalleryContent.tsx, GalleryGrid.tsx, useGallery.ts, gallerySelection.ts, styles/gallery.css. **Do this:** exact cell/header sizes D7; listbox/option semantics; use current selection helpers; separate source controls; Add-folder empty state versus no-results state; skeleton100ms and text1s; partial notice with skipped count, retry Refresh; preserve key/focus. **Uses:** U1/U4/E1/E2. **Tests:** only viewport+overscan rows rendered; 960px width gives four184px cells with12px gaps within928px; arrow/focus/shift selection matches layout; current source removal does not select wrong file. **Commit:** `feat(gallery): virtualized picture grid [step-07c/T4]`.

### T5 — Preview/open and Explorer integration
**Files:** create useGalleryActions.ts; coordinator Explorer gallery location slot, nav command and App developer-title key. **Do this:** Enter and doubleclick U7, Space U3; selected picture Details U2; developer tab same kind/contents with Components title; no Gallery-specific grants persisted. **Uses:** U1-U4/U7. **Tests:** normal open callback receives exact path/background flag; preview is read-only; missing handler falls back safely; developer tab session preserved and renamed only in display. **Commit:** `feat(gallery): previews and ordinary file opening [step-07c/T5]`.

### T6 — Source changes, watchers and cancellation
**Files:** create gallery_watch.rs, useGallerySources.ts; coordinator settings callback. **Do this:** Add awaits picker and persisted settings success; Remove changes references only, cancels stale tasks/cursors, preserves files covered by other sources; watchers250ms coalesced, idle release30s; close clears generations; late results ignored. **Uses:** U2/U6/U8/E1/E4. **Tests:** remove one overlapping root keeps item; failed settings persistence keeps prior sources and shows error; inactive30s watcher release; old scan reply cannot replace new source state. **Commit:** `feat(gallery): source lifecycle and refresh [step-07c/T6]`.

### T7 — Help, translations and reviewer capture plan
**Files:** help pages below, coordinator key/command tests/pseudo/measurement scripts. **Do this:** full labels above, F1 the-gallery, resolve old placeholder tests to new user behavior; add measured interactions and screenshot. **Tests:** bilingual empty states/source controls; keyboard add/remove; no untranslated visible text; no source mutation. **Commit:** `docs(help): photo Gallery [step-07c/T7]`.

Task-specific Rust tests live in crate fs-service only for pure filesystem helper additions; Gallery orchestration tests in src-tauri gallery modules with injected listings/clocks. UI tests are `src/__tests__/gallery.test.tsx`, `galleryDates.test.ts`, `gallerySources.test.tsx`. Workers write but never run them.

## Help pages

Create `help/en/the-gallery.md`, title **The Gallery**. Intro: “See pictures from folders you choose in one place.” How to use: “Open **Gallery** in the navigation pane. Choose **Add picture folder…** and pick a folder. Keep **Include subfolders** on to include its folders. Choose **Date taken** or **Date modified** to group pictures. Open a picture with Enter or a double-click. Press Space for a quick preview.” Good to know: “Removing a folder from Gallery does not delete it or its pictures. Online-only pictures keep a cloud icon and are not downloaded in the background. Folders you did not choose are not scanned. Some details may be missing.” Last line: `See also: "Quick preview" and "Background work".`

Spanish page title **La Galería**. Intro: “Ve en un solo lugar las imágenes de las carpetas que elijas.” Cómo usar: “Abre **Galería** en el Panel de navegación. Elige **Agregar carpeta de imágenes…** y selecciona una carpeta. Deja activado **Incluir subcarpetas** para incluir sus carpetas. Elige **Fecha de captura** o **Fecha de modificación** para agrupar las imágenes. Abre una imagen con Entrar o doble clic. Presiona Espacio para una vista previa rápida.” Para tener en cuenta: “Quitar una carpeta de la Galería no elimina la carpeta ni sus imágenes. Las imágenes solo en línea conservan el icono de nube y no se descargan en segundo plano. Las carpetas que no elijas no se revisan. Algunos detalles pueden faltar.” Last line: `Consulta también: «Vista previa rápida» y «Trabajo en segundo plano».`

Use full Markdown title/section format. Existing browsing-folders/home-page help links the Gallery title in both languages without describing developer Components as the photo view.

## Check by hand

Retained fixture root step07c: A/photo-a.png synthetic400x200; A/sub/photo-b.jpg with taken2026-01-01T00:30Z; A/notes.txt text ignore; B empty; A/sub/broken.jpg text broken. Set modified times explicitly in reviewer fixture manifest. Add A then A/sub; dedup; group date fallback; browse/preview/open; remove sources without deleting any file; restart; pause background; vanished folder; keyboard/Spanish dark/pseudo/200% zoom. Reviewer may create an owned junction fixture for loop tests, never traverse personal locations.

## Speed

`step07c.gallery.first-grid` Fast1s for first local results; `step07c.gallery.open-cached` Fast1s; `step07c.gallery.selection` Instant0.1s; grid scroll Smooth16ms/frame; discovery over10s cancellable job. Compare all common interactions to prior JSON and report partial scans honestly.

## Screenshots

Reserve62-gallery-grid and63-gallery-sources, each en/light, es/dark, pseudo/light. Capture Components separately only if its title/session migration needs diagnosis; do not consume extra global numbers without coordinator ledger update.

## Done when

- [ ] Source authorization, bounded dedup discovery, dates, paging, virtualization and lifecycle tests implemented and reviewer checks pass.
- [ ] Removing sources never removes user files; cloud contents are not read in background; stale results cannot reappear.
- [ ] Keyboard/open/quick-preview/Details use existing contracts and keep focus; developer Components remains reachable.
- [ ] Schema13 migration, translations/help/pseudo, screenshots/speed/report and E1-E4 agreement verified by coordinator.
