# Step 07f: E-books, notebooks, email, subtitles, logs and SQLite

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-07f-extra-viewers |
| Tag | v0.0.25-step07f |
| Depends on | 04a/04b handlers/ribbon;07a cache;07b preview;07d isolated webview host |
| Written before | 07a was built |
| Interface revision | extra-viewers-1 |

Guide only. Workers implement the fixed files, data, algorithms, text and tests; coordinator owns shared edits, installation and executed checks. Six independently lazy-loaded handlers share the typed service below and existing helper/job/cache infrastructure.

## Goal and exclusions

Read EPUB/MOBI/AZW3, Jupyter notebooks, EML email, SRT/VTT subtitles, logs and read-only SQLite tables in tabs/quick preview. Never run notebook code, mail scripts, database functions/extensions or embedded macros. MSG/draw.io remain the user's chosen-app fallback because this step adopts no MSG parser or diagram editor. Fonts already exist in06f. No editing, sending mail, SQL console, DRM removal or remote assets.

## Read first

07a/07b/07d exports; v1 07c mapped formats; current text/table/JSON/archive handlers and data-views crate; strict markup rules; safe extraction/open-entry pattern; pinned foliate-js1.0.1 book parser interfaces, mail-parser0.11.9 source, rusqlite0.41.1 current source. Read model05a and all general recipes before shared wiring.

## Decisions

- D1. Pin foliate-js1.0.1, mail-parser0.11.9 and fflate0.8.2 (MIT); reuse rusqlite0.41 with bundled/hooks, serde_json and data-views.decode_text. No browser library ZIP decoder: EPUB loaders use the existing archive helper's bounded entry APIs. MOBI font/resource zlib uses fflate.Unzlib streaming only inside the bounded helper; unzlibSync is prohibited because it allocates unbounded output before checking. Import parser-only foliate modules, never its View module or bundled ZIP implementation. Coordinator records all dependencies/features/notices before adoption; no worker chooses a substitute.
- D2. **Do not use foliate View/renderers.** Its own README states renderer iframe permissions include allow-scripts/allow-same-origin, contrary to R-SEC-4. Use parser-only EPUB/MOBI objects inside07d E7 host. EPUB constructor receives loadText/loadBlob/getSize/sha1 loader; init returns sections/toc/metadata. MOBI receives an unzlib function and an input object whose size/name/slice(start,end).arrayBuffer reads bounded granted ranges. Never pass user strings to makeBook's URL-fetch path. DRM/encrypted unsupported book returns chosen-app action, not an attempted bypass.
- D3. Book pages are app-generated sanitized sections: paragraph/block boundaries retained, at most4,000Unicode characters or24block elements per page (whichever first); split an oversized paragraph at the last whitespace before4,000, otherwise exact scalar boundary. Images stand alone, max16MiB decoded/4MiB encoded; tables rendered as bounded sanitized tables. Fixed-layout pages keep their original viewport and scale-to-fit. Every displayed markup page is DOMPurify-cleaned in iframe sandbox empty, no scripts/same-origin, no remote CSS/fonts/links. Native iframe scrolling handles a long table; Next/Previous change the app's deterministic page chunks. Font size12-32px default18; line-height1.6; theme app/light/dark; settings schema15 `reading.font_px`, `reading.theme`.
- D4. Native parsing (mail, notebook JSON, subtitle, log, SQLite) runs in `--extra-viewer-helper`,512MiB memory,15s open timeout,5s page timeout; book parser uses separate07d host same bounds. Maximum8native sessions plus2book helpers; closing/inactive evicts leases/cancels work. No parser runs on main UI thread.
- D5. All sessions bind source stamp; stale/changed source errors require reopen. Page responses at most768KiB,256records normally; payload strings<=64KiB each. No whole-file JSON/EML/book content sent to UI. Attachments/resources use leased owned cache copies and normal open pipeline only after explicit user request.

## Uses from other steps

| Ref | Producer; canonical names | Exact use |
|---|---|---|
| U1 | 07a E1-E5; CacheKey/Lease/SourceStamp, CacheService, BackgroundPolicy | Cached first page/attachments, bounded leased protocol bytes, background reads skip cloud |
| U2 | 07b E3/E5; PreviewSurface, HandlerViewProps.previewOnly | Every handler is read-only and preview-safe; do not instantiate editor/save handles |
| U3 | 07d E7; webview_helper.rs start_webview_helper/WebviewHelperSession/config/input; services/helperBridge.ts | Book parser-only persistent WebviewHelperSession retained through extra view session; session.request handles open/page/contents and close destroys it. Static kind book, own entry book-helper.html, no main commands/capabilities |
| U4 | 06d/06e; archive helper/session/open-entry contracts; fs-service.owned_io | Safe EPUB entry ranges/resources and owned attachment extraction; no arbitrary zip member path writes |
| U5 | 06f; crates/data-views/src/decode.rs decode_text(bytes)->(String,TextEncodingId) | Subtitle/log/notebook text decoding; do not copy/create another encoding fallback |
| U6 | 04a/04b; Handler/HandlerViewProps/ViewerFrame; files.ts grants | Registry/lazy view/find/ribbon/status/normal open; all new handlers have editablefalse |

## Data shapes

Canonical Rust `src-tauri/src/extra_view_types.rs`, TypeScript `src/services/extraViews.ts`. Additional pure native parser types live in data-views new modules and are re-exported, not copied.

| Type | Exact fields/types/bounds |
|---|---|
| ExtraViewKind | book/notebook/email/subtitle/log/sqlite |
| ExtraViewSession | session_id UUID string; source SourceStamp; kind ExtraViewKind; title string<=512; item_count u32; partial bool; no parser/live-object serialization |
| BookContentsItem | id string<=128; label string<=512; section u32; children array,depth<=32,total<=5,000 |
| BookPage | section,page u32 zero-based; page_count u32; html string<=256KiB sanitized again at display; resource_refs CacheLease[] max32; contents BookContentsItem[] paged separately; direction ltr/rtl |
| NotebookCell | index u32; kind markdown/code/raw; source string<=64KiB chunk; language string<=64; outputs NotebookOutput[] max64; next_source_offset optional u32 |
| NotebookOutput | kind text/html/image/error; text optional string<=64KiB; image optional CacheLease; html optional sanitized string<=256KiB; never an execution callback |
| EmailSummary | subject string<=512; from/to/cc arrays of `EmailAddress` max100 each; date optional UTC ISO string; plain_text string<=64KiB chunk; html optional sanitized string<=256KiB; attachment_count u32<=1,000 |
| EmailAddress | name string<=256; address string<=512; display as escaped text, no automatic mailto action |
| EmailAttachment | id UUID; name string<=255; mime string<=128; byte_len u64/number safe integer; no raw bytes/path; extraction request source-bound |
| SubtitleCue | index u32; start_ms,end_ms u64/number safe integers; text string<=8,192; end>=start; no active markup |
| LogRecord | line u64 decimal string; byte_offset u64 decimal string; level trace/debug/info/warn/error/fatal/none; text string<=64KiB; truncated bool |
| SqliteTableInfo | name string<=1,024; columns SqliteColumn[] max2,000; kind table only, no view/virtual-table execution |
| SqliteColumn | name string<=1,024; declared_type string<=128; nullable bool; primary_key bool |
| SqliteCell | tagged kind null/text/integer/real/blob; value optional string (integers exact decimal, real roundtrip representation); blob_size optional decimal string; preview_hex optional string<=64; text truncated flag explicit |
| ExtraViewPage | session_id UUID; kind; payload tagged union: book has page BookPage; notebook has cells NotebookCell[]; email has message optional EmailSummary and attachments EmailAttachment[]; subtitle has cues SubtitleCue[]; log has lines LogRecord[]; sqlite has table SqliteTableInfo and rows SqliteRow[]. next_cursor optional UUID; complete bool; partial bool. SqliteRow is SqliteCell[] matching selected table columns |
| ExtraPageRequest | session_id UUID; cursor optional UUID; table optional validated schema name only for sqlite; section/page optional u32 only book; sort_column optional u32 and sort_direction asc/desc only sqlite; other-kind arguments refused |
| SafeMarkupFrameProps | html string bounded256KiB; resources readonly CacheLease[] max32; title translated string; className optional string. Component sanitizes with DOMPurify, permits only leased local resource URLs and mounts iframe sandbox empty; no scripts/same-origin/link navigation |
| ReadingSettings | Rust book_settings.rs and existing TS settings.ts: font_px u32/number12-32 default18; theme app/light/dark defaultapp; serde defaults, exact validation and schema15 migration |

Notebook: source<=64MiB,5,000cells,totaloutputs<=32MiB after base64 decode. Mail<=64MiB,1,000parts,depth32. EPUB/MOBI<=256MiB source,50,000archive entries,512MiB total decompressed,ratio500/depth64/path1024,individualsection<=4MiB. Subtitles<=32MiB/200,000cues. Logs<=1TiB ranged,initial1MiB,1,000lines per scan block,not all in memory. SQLite source<=4GiB,1,000schema objects; pages<=256rows/768KiB,statement time2s/step budget100,000 VM instructions.

## Algorithms by format

1. **Book:** inspect header; EPUB uses existing safe archive listing and validated internal relative resource names, reject external/parent escape/DOCTYPE; parser-only load section document, discard scripts/forms/remote URLs, split deterministic chunks D3; title/toc normalized to plain text. MOBI range adapter reads78-byte header and record offset table before requested records. Free section objects/resource leases on page change. Font/theme changes rebuild only page CSS and retain section/page offset; no input file writes.

MOBI supplies foliate's async unzlib callback through `src/book-helper/boundedUnzlib.ts`: boundedUnzlib(input:Uint8Array,budget:BookDecodeBudget)->Promise<Uint8Array>. BookDecodeBudget fields remaining_bytes:number0-536870912,cancelled:()->boolean; the shared book-session owner decrements remaining_bytes exactly once for accepted decoded output. Verified fflate0.8.2 Unzlib constructor takes callback(data:Uint8Array,final:boolean)->void; push(chunk:Uint8Array,final?:boolean)->void. Feed at most1024compressedbytes per push, check cancel between pushes, set final true only on last. Before retaining any callback chunk, checked-add emitted count and refuse above min(16MiB,500*input.byteLength,budget.remaining_bytes); abort by throwing extra_view.too_large and dropping stream/chunks. Reject zero/truncated/malformed input or missing final callback as extra_view.corrupt. Concatenate once only after final and budget validation; never let an oversized result exist then slice it. Per-book total remains512MiB, helper512MiB memory cap still applies; a decoder allocation failure is an explicit failed view, not a success with truncated bytes. PALMDOC/HUFFCDIC record decode and resources share total budget and check per-record4MiB/section4MiB caps. T3 tests compressed bomb refusing callback before retaining byte16MiB+1, ratio501 refusal, truncated final refusal and cancellation between push calls. Evidence: retained fflate0.8.2 esm/browser.d.ts Unzlib/FlateStreamHandler declarations; foliate mobi.js getFont awaits provided unzlib function.

2. **Notebook:** bounded helper serde JSON parse; validate nbformat4, cells array and explicit MIME allowlist. Code is text only. Outputs prefer text/plain, then sanitized text/html, then bounded image/png/jpeg; ignore JS/widget/application executable outputs with a visible unsupported-output note. Markdown html disabled then DOMPurify, iframe sandbox empty. ANSI escape sequences stripped from output/error text by bounded state machine.
3. **Email:** MessageParser parse fixed bytes in helper; normalize subject/headers/addresses/date; prefer sanitized HTML when present with plain-text toggle. Remove remote img/srcset/style URLs and active links/actions. CID images resolve only to message-local attachment IDs with decoded cap. List attachments without extracting; explicit Open creates owned cache copy under source stamp and asks normal file pipeline. Never send messages or open attachments automatically.
4. **Subtitles:** detect WEBVTT header otherwise SRT; parse optional cue index/identifier; timestamps accepted HH:MM:SS,mmm (SRT) or HH:MM:SS.mmm/MM:SS.mmm(VTT), minutes/seconds0-59,ms0-999; retain valid cues sorted by start then original index, flag malformed blocks and continue. Strip active markup, preserve plain text/newlines. Search highlights literal text; choosing a cue scrolls, does not execute player code. Later media adapters consume cue DTO.
5. **Logs:** incremental range read, carry incomplete UTF8/UTF16 sequence and partial line across chunks, use U5 encoding choices/BOM. Level from first standalone token after optional timestamp: TRACE/DEBUG/INFO/WARN/WARNING/ERROR/FATAL case-insensitive; WARNING=>warn. Strip ANSI CSI/OSC sequences with maximum4KiB escape span; unterminated span ends at chunk cap with explicit truncation. Keep stable byte-offset cursors; tail mode reads only new appended ranges, stops/reopens on truncate/source change.
6. **SQLite:** hold a source read guard denying concurrent write/delete for the session; if it cannot be obtained return read-only/in-use state without opening SQLite. Refuse an existing WAL sidecar rather than ignoring uncheckpointed data. Build an application-owned file URI by percent-encoding the validated path, append only fixed mode=ro/immutable=1 flags, and open with SQLITE_OPEN_READ_ONLY/SQLITE_OPEN_URI; this prevents journal/shm creation. Keep query_only true, trusted_schema false, extensions disabled; no SQL console. Enumerate physical tables from sqlite_schema, refuse virtual tables/views; escape identifiers by doubling each double quote and surrounding with double quotes. LIMIT/OFFSET values bounded integers from cursor, cell bytes bounded with explicit truncation. The hooks-feature progress handler interrupts after time/instruction budget. Selected column sorting uses validated schema column index, stable rowid tie only for rowid tables; WITHOUT ROWID uses primary-key sequence. New source stamp invalidates table/cursor; close releases the guard so another app can edit.

## Commands and exports for later steps

All commands ensure_main/validate native arguments and use existing jobs/helper. Prefix `extra_view`; errors `extra_view.bad_request`, `.unsupported`, `.too_large`, `.changed`, `.corrupt`, `.read_only`, `.unavailable`.

| Ref | Canonical export in services/extraViews.ts | Rust command; inputs -> output |
|---|---|---|
| E1 | ExtraViewKind/Session/Page/PageRequest and all DTOs above | Single canonical wire definitions, imported by every new handler and later subtitle/media/search adapters |
| E2 | openExtraView | extra_view_open_start(request_id,path,kind) ->unit; TS(path string,kind ExtraViewKind)->Promise<JobHandle<ExtraViewSession>> |
| E3 | extraViewPage | extra_view_page(request ExtraPageRequest)->ExtraViewPage; TS(request)->Promise<ExtraViewPage>; max64livecursors per session |
| E4 | closeExtraView | extra_view_close(session_id UUID)->idempotentunit; TS(sessionId)->Promise<void>; revoke/cancel/freeall session resources |
| E5 | openEmailAttachment | extra_view_attachment_start(request_id,session_id,attachment_id UUID)->owned opened-copy path; TS(sessionId,attachmentId)->Promise<JobHandle<string>>; no extraction unless explicit Open |
| E6 | subtitleCues | extra_view_subtitles(session_id,cursor optional UUID)->ExtraViewPage of SubtitleCue; TS->Promise<ExtraViewPage>; 15/19b import same cue times |
| E7 | bookContents | extra_view_book_contents(session_id,cursor optional UUID)->typed BookContentsPage (`items` BookContentsItem[],next_cursor optionalUUID,complete bool),max768KiB; same source-bound cursor |

Handler IDs book/notebook/email/subtitle/log/sqlite, extensions epub/mobi/azw3,ipynb,eml,srt/vtt,log,sqlite/sqlite3/db respectively. MIME claims must be validated by content; .db not SQLite magic falls back through normal chosen app. Each handler registered before generic text, lazy component named BookView/NotebookView/EmailView/SubtitleView/LogView/SqliteView under its own src/handlers/<id>/ directory; all ViewerFrame/read-only/find-capable, help slug corresponding below. Find executes bounded displayed/page searches, no regex/unbounded whole-file reads.

## UI, keys and styles

Existing viewer ribbon/dock/sidebar tokens, pane196px (min160,max320), content padding16px/gap8px. Book font18px/line1.6; other data tables row28px using density service; notebook cells collapsed output summary with explicit expand; email headers dl104px labels; subtitle/log/table rows virtualized. All focus outlines accent. Errors retain Open in chosen app and Retry; missing data never blank infinite skeleton. Loading100ms skeleton/1s words; any long scan has Cancel. Keyboard arrows/Home/End/Page,Ctrl+F; bookLeft/Right changes page unless text input; no global shortcut collision.

| Key | English | Spanish |
|---|---|---|
| handlers.book / handlers.notebook / handlers.email | E-book / Notebook / Email | Libro electrónico / Cuaderno / Correo electrónico |
| handlers.subtitle / handlers.log / handlers.sqlite | Subtitles / Log / SQLite database | Subtítulos / Registro / Base de datos SQLite |
| extra_view.previous / extra_view.next | Previous / Next | Anterior / Siguiente |
| extra_view.contents / extra_view.fontSize / extra_view.theme | Table of contents / Font size / Reading theme | Tabla de contenido / Tamaño de fuente / Tema de lectura |
| extra_view.source / extra_view.output | Source / Output | Código fuente / Resultado |
| extra_view.unsupportedOutput | This output cannot be displayed safely. | Este resultado no se puede mostrar de forma segura. |
| extra_view.from / extra_view.to / extra_view.subject | From / To / Subject | De / Para / Asunto |
| extra_view.attachments / extra_view.plainText | Attachments / Plain text | Archivos adjuntos / Texto sin formato |
| extra_view.remoteBlocked | Remote images are blocked. | Las imágenes remotas están bloqueadas. |
| extra_view.start / extra_view.end / extra_view.level | Start / End / Level | Inicio / Fin / Nivel |
| extra_view.tail / extra_view.tables / extra_view.columns | Follow new lines / Tables / Columns | Seguir líneas nuevas / Tablas / Columnas |
| extra_view.partial | Some content was skipped or shortened. | Se omitió o acortó parte del contenido. |
| extra_view.wal | Close the database in its other app or open a safe copy. | Cierra la base de datos en la otra aplicación o abre una copia segura. |
| errors.extra_view.bad_request / errors.extra_view.unsupported | This viewer request is not valid. / This format is not supported here. | La solicitud del visor no es válida. / Este formato no es compatible aquí. |
| errors.extra_view.too_large / errors.extra_view.changed | This file exceeds the viewing limits. / The file changed. Open it again. | Este archivo supera los límites del visor. / El archivo cambió. Vuelve a abrirlo. |
| errors.extra_view.corrupt / errors.extra_view.read_only / errors.extra_view.unavailable | This file could not be read. / This viewer cannot change the file. / This viewer is not available. | No se pudo leer este archivo. / Este visor no puede cambiar el archivo. / Este visor no está disponible. |

Slash-separated key rows mean individual exact key/value entries, same order on each side; never put slashes into actual labels or combine error sentences. Common labels Open/Close/Cancel/Retry/Find use verified existing keys. Book theme choice keys extra_view.themeApp/themeLight/themeDark = App/Light/Dark and Aplicación/Claro/Oscuro.

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

## Full help texts

Each pair below becomes `help/en/<slug>.md` / `help/es/<slug>.md`, with title, intro, How to use/Cómo usar, Good to know/Para tener en cuenta headings and final See also/Consulta también line. The text below is the complete body, not a request for workers to write copy.

| Slug; titles | English body | Spanish body |
|---|---|---|
| reading-e-books; Reading e-books / Leer libros electrónicos | Read local e-books in a tab. Open a supported book. Use Previous, Next or Table of contents to move through it. Change Font size or Reading theme for comfort. Books cannot run scripts or load remote images. Protected books may need another app. See also: "Quick preview" and "Opening files". | Lee libros electrónicos locales en una pestaña. Abre un libro compatible. Usa Anterior, Siguiente o Tabla de contenido para navegar. Cambia Tamaño de fuente o Tema de lectura para leer con comodidad. Los libros no pueden ejecutar scripts ni cargar imágenes remotas. Los libros protegidos pueden necesitar otra aplicación. Consulta también: «Vista previa rápida» y «Abrir archivos». |
| viewing-notebooks; Viewing notebooks / Ver cuadernos | Read notebook cells and saved outputs. Open a notebook, then expand the output you want to inspect. Use Find to search displayed text. Code is never run. Interactive or unsafe outputs are not displayed. See also: "Viewing text" and "Quick preview". | Lee las celdas y los resultados guardados de un cuaderno. Abre un cuaderno y expande el resultado que quieras revisar. Usa Buscar para encontrar texto visible. El código nunca se ejecuta. No se muestran los resultados interactivos o inseguros. Consulta también: «Ver texto» y «Vista previa rápida». |
| viewing-email; Viewing email files / Ver archivos de correo | Read a saved email without sending anything. Open an EML file. Review its headers and body, or choose Plain text. Open an attachment only when you trust it. Remote images are blocked and attachments never open automatically. See also: "Protected view" and "Opening files". | Lee un correo guardado sin enviar nada. Abre un archivo EML. Revisa los encabezados y el mensaje o elige Texto sin formato. Abre un archivo adjunto solo si confías en él. Las imágenes remotas están bloqueadas y los archivos adjuntos nunca se abren automáticamente. Consulta también: «Vista protegida» y «Abrir archivos». |
| viewing-subtitles; Viewing subtitles / Ver subtítulos | Inspect subtitle times and text. Open an SRT or VTT file. Choose a row or use Find to locate words. Invalid cues are reported; opening the file does not play or change a video. See also: "Playing audio and video" and "Viewing text". | Revisa los tiempos y el texto de los subtítulos. Abre un archivo SRT o VTT. Elige una fila o usa Buscar para encontrar palabras. Se informa de los subtítulos no válidos; abrir el archivo no reproduce ni cambia un video. Consulta también: «Reproducir audio y video» y «Ver texto». |
| viewing-logs; Viewing logs / Ver registros | Read large logs a page at a time. Open a log and use Find or Follow new lines. Level labels help distinguish messages without relying on color alone. Long lines may be shortened with a notice. The file is never changed. See also: "Viewing text" and "Quick preview". | Lee registros grandes por páginas. Abre un registro y usa Buscar o Seguir líneas nuevas. Las etiquetas de nivel distinguen los mensajes sin depender solo del color. Las líneas largas pueden acortarse con un aviso. El archivo nunca cambia. Consulta también: «Ver texto» y «Vista previa rápida». |
| viewing-sqlite; Viewing SQLite databases / Ver bases de datos SQLite | Inspect tables without changing a database. Open a SQLite file, choose a table, then browse or sort its rows. This viewer cannot run arbitrary SQL or edit data. A database active in another app may need to be closed or safely copied first. See also: "Viewing tables" and "Opening files". | Revisa tablas sin cambiar una base de datos. Abre un archivo SQLite, elige una tabla y revisa u ordena sus filas. Este visor no ejecuta SQL arbitrario ni edita datos. Es posible que debas cerrar la base en otra aplicación o abrir una copia segura. Consulta también: «Ver tablas» y «Abrir archivos». |

Split body sentences into intro/how-to/safety paragraphs in their stated order; preserve exact wording. Crosslinked existing help titles are verified/corrected centrally before promotion, not guessed by workers.

## Check by hand, speed and screenshots

Coordinator retains fixtures: tiny EPUB with2chapters/one localimage; MOBI/AZW3permissivegeneratedsample; notebook2code/2markdowncells with savedtext/PNG/unsafeoutput; EML plain+HTML+CID+oneattachment+remoteimage; SRT1250-2500ms cue; VTT equivalent; log with100,000lines/oneoversizedline/ANSI; SQLite physicaltable with Unicode/NULL/integer9007199254740993/BLOB and read-only/WALcase. Include malicious bookresource/HTML/JSON/DBfixtures; no private content or network downloads in app. Checkformatnavigation/find/theme/copy/attachments/selection/paging/noexecution/no sourcewrites, Spanishdark/pseudo/keyboard/200%zoom.

First view `step07f.open.<book|notebook|email|subtitle|log|sqlite>` Fast1s; nextpageFast1s; rowselection/controlsInstant0.1s; scrollingSmooth16ms. Over10sscanjobCancel. Reserve69-book,70-notebook,71-email,72-subtitle,73-log,74-sqlite withthree language/theme variants. Coordinator records actualtest/speed/securityevidence; workers onlywritecode/tests.

## Done when

- [ ] Six complete lazy handlers implement the defined limits/DTOs/algorithms; exactexports E1-E7 match later consumers.
- [ ] No code/macros/SQLextensions/scripts/remoteassets run; source hashes and sidecarinventory unchanged on read-only flows.
- [ ] Book renderer respects empty sandbox; boundedparser-onlylibraryintegration verified, not librarydefaultunsafeiframe.
- [ ] Format/adversarial/keyboard/cancellation tests executed bycoordinator; translations/help/pseudo/screenshots/speed/package/report complete; no unsupportedtype silently hijacked.
