# Step 13: Accurate read-only Office viewers

Local integration, 2026-11-04. The Writer producer in `office_accurate_source.rs` opens the verified 12b read actor, renders an owned PDF, closes the Office document, and passes bounded PDF bytes to the existing isolated PDF helper. PDF page leases are memory-backed and released with the viewer. The accurate producer receives the existing `OfficeWork` so rendering uses the caller's cancellation token. No verified Office read pack is provisioned yet, so this path remains unavailable in local builds. The pool currently closes its actor after the final document while warm-engine expiry integration remains pending. The owner selected the supplied horse photograph as the app icon on this date.

Coordinator SDK corrections, 2026-11-03: build the replaceable bridge with the official 26.8.2 Windows SDK and C++17. The verified SDK MSI SHA256 is `9aba3a945cacc3155db5396ae9fa1ec24ab2079b0c8d3b8365fd809aa254d4eb` (official download mirrorlist). Use `sheet::XSpreadsheetDocument::getSheets`, query `table::XColumnRowRange` for rows/columns and `text::XPageCursor` for pagination; `XSpreadsheetsSupplier`, `XSheetRows`, `XSheetColumns` and `uno/UNO_QUERY.hxx` are not SDK APIs. Encode OUString names through `rtl::OUStringToOString(..., RTL_TEXTENCODING_UTF8)`. Include windows.h before bcrypt.h with NOMINMAX. Reproducible build: scripts/build-office-read-bridge.ps1. Compilation alone does not activate a signed Office pack or prove confined rendering.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 4/5 |
| Branch | step-13-office-viewers |
| Tag | v0.3.0; acceptance evidence required |
| Depends on | 12a packs-1;12b engines-2/office-render-2/engine-session-1;07d pdf-reader-2;09a tabs-documents-1 |
| Written before | 07a was built |
| Interface revision | office-view-1 |

Guide only. Workers write owned code/tests without running them; coordinator performs dependency/build/security/fidelity/speed/package checks. No Office editing engine is chosen here.

## Goal and exclusions / Read first

Local integration follow-up, 2026-11-04: a verified `office_convert`
one-shot producer may supply the PDF-backed accurate view when the warm
`office_read_bridge` producer is unavailable. Both routes use the existing
12b EngineHost, signed pack lease, confined input/output and 07d PDF helper;
there is no independently resolved executable or unrestricted process.
Writer maps the complete PDF to its document section. Impress maps PDF pages
to slide sections in structural index order only when counts agree exactly;
a mismatch refuses accurate output rather than displaying the wrong slide.
The optional native Kit worker uses a root or `bin/libreoffice-kit.exe` entrypoint
and pack-root `program/program` resources. Its whole signed inventory is revalidated
before resource access. It supports whole-document PDF rendering only;
comments, notes, ranges and other targets return Unsupported. This adapter
does not approve redistribution, install an unsigned pack, or qualify editing.

Local owner-authorized installation uses a separate portable debug build.
The offline pack preparer pins the exact previously verified upstream
inventory and font hashes, builds and signs a catalog with a fresh in-memory
key, verifies the catalog and staged inventory, and activates it in that
portable profile. The matching public key is pinned at compile time and is
used only in portable debug mode. Release and normal installed builds keep
the existing trust key. There is no network catalog source in this build.
The native Kit launcher uses an owned undisplayed Windows desktop for graphics
initialization, with AppContainer rights limited to read/write objects,
create-window/menu and enumerate. It never switches desktops or grants hook,
journal, switch-desktop or ACL-control rights to the child.

View DOCX/XLSX/PPTX, ODT/ODS/ODP, RTF and legacy DOC/XLS/PPT without modifying them. Provide fast structural/cached previews and accurate engine rendering, sheets/slides/comments/presentation, fonts and chosen-app fallback. Editing is20a/b/21a/22a. Read v1 step13, roadmap v0.3,12b E1-E5,07d E1-E7,09a document/controller/view codecs,08a snapshots, actual handler/openPipeline/ribbon/layout interfaces and calamine0.37 source. No invented docx-preview/SheetJS dependency.

## Decisions and algorithms

1. D1. Add lazy `office-word`, `office-sheet`, `office-slide` handlers, accents word/excel/powerpoint; extensions/mime per family, max512MiB. Normal open pipeline owns protected view/grants. They expose read-only controls; downloaded content stays protected. File content never becomes editor chrome or executable HTML. Existing table/CSV handler is not replaced.
2. D2. First consult cache keyed by full SourceStamp, format, font inventory revision and engine version. Show cached first page immediately, clearly labeled. Otherwise helper generates bounded structural preview: OOXML/ODF text/paragraphs/slides or calamine sheet cells; scripts/formulas/macros never execute; external relationships refused. RTF/legacy binary without a proven quick parser show metadata/no-preview fallback plus chosen-app action while accurate engine starts if installed. This exception is explicit, not a false claim of an exact instant preview for every format.
3. D3. Accurate render uses12b confined Office engine with pack lease and read-only source copy. The12b E7 EngineSession fixed office_read_v1 protocol controls a trusted C++ UNO bridge in the replaceable Office pack, which owns one warm headless LibreOffice instance; no UNO linkage in Rust core, no document macro bridge, no network socket. Random private named-pipe endpoint is isolated to the app/container identity; deny external joins in coordinator security test. Methods: XComponentLoader.loadComponentFromURL, XStorable.storeToURL and XCloseable.close(true); load properties Hidden=true,ReadOnly=true,MacroExecutionMode=NEVER_EXECUTE(0),UpdateDocMode=NO_UPDATE(0), plus12b hardened profile. Interface source is LibreOffice26.8 SDK; https://api.libreoffice.org/docs/idl/ref/ . Engine editing20a remains separate.
4. D4. Warm pool owns one12b E7 EngineSession actor, serializes its bounded32-command queue, total memory1GiB, max4loaded documents, idle timeout60s after last lease, close oldest clean read-only document first. No documents or keys survive app exit. Killing a hung engine invalidates its sessions and returns office.engine_failed; other app tabs survive. Engine process confinement must pass before capability becomes available; unrestricted fallback forbidden.
5. D5. PDF render is accurate for layout, not a promise of Microsoft Office pixel identity. Writer sections one document, Impress one section per slide, Calc one section per sheet, each with paginated rendered output; preserve stable source section IDs independent of localized labels. Extract comments read-only from validated source/UNO structs, not scripts. Sheet quick grid virtualizes rows28px/columns96px, max200visible cells plus overscan2, paged500rows/768KiB. User explicitly switches to accurate page view; formulas shown as saved text/value with “not recalculated” status until safe engine render.
6. D6. All author/comment/outline strings escaped; comments<=10000total, perpage<=200/768KiB, text<=8192; outline<=10000/depth32; sections<=1000, renderedpages<=10000. No invisible source content dumped into DOM. Local clipboard copy uses09c validated transfer offers. Find searches normalized text/pages with cancellable bounded result pages, never runs Office expressions.
7. D7. Font inventory is a signed versioned part of the Office pack. Required metric-compatible families: Carlito, Caladea, Liberation Sans/Serif/Mono and Noto Sans fallback, all exact files/license/hash recorded before pack activation; reuse08b's provisioned Inter for app-authored export text. No assumption Inter already exists in repository. Font substitution shown when original family unavailable. Do not fetch fonts or read arbitrary web-font URLs from a document. Font files stay in pack, not committed binaries>50MiB.
8. D8. Presentation opens a separate app-owned audience window with rendered slides only, Escape exits, arrows/PageUp/Down navigate; comments/notes not shown on audience screen. Presenter notes and second-screen editing features belong22a. Session view codec stores section_id/page/zoom/scroll only, never document text, passwords, lease IDs or macro state.
9. D9. Schema37 -> 38 adds office_view.prefer_accurate true, show_comments false, keep_engine_warm true, idle_seconds60 fixed60 (reserved diagnostic value, not a numeric setting). This matches12b EngineSessionStart; no unsupported idle-time control is exposed. keep_engine_warm=false closes the actor immediately after its final document/render lease; true uses the fixed60s idle expiry. No automatic pack install. v0.3 requires the reviewer corpus, baseline Office-exported PDFs supplied by owner when available, screenshots and actual cold/warm timings; no approval/publication inferred from guide completion.

## Uses from other steps

| Ref | Producer/task/file/revision | Exact use |
|---|---|---|
| U1 |12b T2/T5 E1/E3/E4/E7;engineTypes.ts/engine_sessions.rs/engine_session_types.rs/office_render.rs;engines-2/engine-session-1|OfficeFormat,OfficeRenderRequest,EngineHost/render_office for one-shot conversions; accurate viewer pool imports EngineSessionStart/EngineSession/EngineReadDocument/EngineReadSection/OfficeSessionRenderRequest and exact start/open/render/close methods from12b E7, one confined lifecycle/security authority |
| U2 |12a T3 E2;packs.rs;packs-1|EngineHost.start_session acquires office/office_read_bridge and retains PackLease for actor lifetime;13 does not spawn a second engine or independently resolve a program path |
| U3 |07d E1-E7;services/pdf.ts,handlers/pdf/pdfCoordinates.ts;pdf-reader-2|PDF sessions/render/text/outline/cache page leases;1-based page numbers, original point coordinates |
| U4 |09a T2/E3/E4/E7;documents/types.ts,DocumentRegistry.ts,viewState.ts;tabs-documents-1|DocumentHandle/VirtualViewProps,readRange original bytes,captureSnapshot current encoded content; no virtual fake path |
| U5 |08a E4/E5/E7;exportSnapshots.ts;export-snapshot-2|ConversionInput/ExportSnapshot immutable revision; sensitive input refuses CLI route |
| U6 |07a cache;06d jobs;baseline|SourceStamp/CacheLease;runJob<T> completion/cancel; cached bytes via token protocol only |

## Data and exports

Canonical `src/services/officeViewTypes.ts`, native `src-tauri/src/office_view_types.rs`; OfficeFormat imported from12b, not duplicated. Optional nullable fields serialize consistently; counts/time safe integers.

| Type | Exact fields |
|---|---|
| OfficeSession | session_id UUID; format OfficeFormat; source_revision positive number; engine_version string<=64; quality quick/accurate; section_count number<=1000; read_only fixedtrue; capabilities {comments:boolean,presentation:boolean,exact_render:boolean} |
| OfficeSection | id ASCII string<=64; name escapedstring<=255; kind document/sheet/slide; index zero-basednumber; page_count positiveinteger<=10000; rows/columns optionalu32 onlysheet |
| OfficeSectionPage | items OfficeSection[]<=200; next_cursor nullableUUID; complete bool |
| OfficePage | section_id string; page positiveinteger; image CacheLease; width_pt/height_pt positivefinite numbers<=14400; quality quick/accurate; source_revision number |
| OfficeComment | id string<=128; section_id; page nullablepositiveinteger; author string<=255; text string<=8192; parent_id nullablestring; source_anchor {kind paragraph/cell/slide,index:number} |
| OfficeCommentPage | items OfficeComment[]<=200; next_cursor nullableUUID; complete bool |
| OfficeOutlineNode | id string<=128; title string<=512; section_id; page nullablepositiveinteger; depthu8<=32 |
| OfficeViewState | section_id string; page1default; zoom finite25..400default100; scroll_top finite0..1e9; mode quick/pages defaultpages |
| OfficeCell | row/column zero-basedu32; text string<=32767UTF16units; value_kind text/number/date/boolean/error/formula; formula nullabletext; cached bool |
| OfficeCellPage | section_id; row_start u32; column_start u32; rows OfficeCell[][]<=500 rows/<=200 columns each; total_rows/columns u32; column_count u32<=200; truncated bool; next_cursor nullablestring "row:column" (first withheld absolute cell, session/section-bound) |

| Ref | Exact export/signature | Consumers |
|---|---|---|
| E1 | services/officeView.ts openOfficeView(input:ConversionInput)->Promise<JobHandle<OfficeSession>> |13 viewer,20a view-now seam; native office_view_open_start(request_id,input) |
| E2 | same officeViewPage(sessionId:string,sectionId:string,page:number,scale:number)->Promise<JobHandle<OfficePage>> | page1-based,scale0.25..4; native office_view_page_start(request_id,session_id,section_id,page,scale) |
| E3 | same officeViewSections(sessionId,cursor?:string)->Promise<OfficeSectionPage>; officeViewComments(sessionId,sectionId,cursor?:string)->Promise<OfficeCommentPage>; officeViewCells(sessionId,sectionId,rowStart:number,rowCount:number,columnStart?:number,columnCount?:number)->Promise<OfficeCellPage> (columnStart default0, columnCount default<=200) | native office_view_sections/comments/cells; session-bound cursor invalid across sessions; cell cursor section-bound |
| E4 | same closeOfficeView(sessionId)->Promise<void>; native office_view_close | idempotent close cancels jobs/releases leases, no effect on shared dirty edit controller |
| E5 | handlers/office/OfficeView.tsx OfficeView(props:HandlerViewProps); VirtualOfficeView(props:VirtualViewProps) | Legacy disk adapter and source-aware view share OfficePresenter, no fabricated FileTypeInfo |
| E6 | officeViewTypes.ts all types above; OfficeFormat reexport fromengineTypes |20a/b/21a/22a read-only previews; no mutation methods |

`src/services/officeView.ts` reexports the E6 public types from officeViewTypes.ts so consumers can import the documented service types without inventing another definition. The single canonical OfficeFormat remains12b engineTypes.ts. OfficeSession source_revision is the captured ExportSnapshot revision, or1 for an unchanged disk preview; it is not inferred from file modification seconds.

### Exact warm-pool producer consumption

`src-tauri/src/office_pool.rs` imports12b E7 types rather than inventing a UNO/process interface. OfficeReadPool::open(&self,input:EngineInput,format:OfficeFormat,context:&JobContext)->Result<EngineReadDocument,String> serializes actor admission off UI thread, lazily calls EngineHost.start_session with fixed office_read_v1/4documents/60s/1GiB constants, then EngineSession.open_document. It owns the EngineReadDocument/document_id to viewer-session mapping; no engine handle crosses IPC. Source revision/content identity remain exactly from native input. OfficeReadPool::render(&self,request:&OfficeSessionRenderRequest,context:&JobContext)->Result<RenderedOffice,String> delegates same actor, no new subprocess. OfficeReadPool::close_document(&self,document_id:Uuid,context:&JobContext)->Result<(),String> is idempotent and drops that viewer's pool lease; closes the actor document only after its final viewer/render lease. Max4loaded documents; before fifth open, close oldest unleased clean read-only document, or return engines.busy if all four retained. Idle60s begins after final document close.13 never holds a global UI/application lock across these methods.

13 uses12b EngineReadSection fields to create OfficeSection view DTOs (same id/name/kind/index/page_count, optional sheet rows/columns from structural parser). Comments/cells/outline come from13's bounded guarded structural source parser, not invented EngineSession query methods; cached/permitted text remains escaped. EngineSession.render_document selects at most256known sections per call and produces owned artifacts;13 prepares only visible/requested sections instead of generating all1000 eagerly. Parent13 registers each accurate PDF artifact as an immutable08a authorized derived snapshot using one native readonly authority per EngineReadDocument.document_id, registered from its authorized EngineInput/source stamp before that input moves into the actor, with permit_capture_mime(application/pdf). Snapshot revision=EngineReadDocument.source_revision; content_id is source_content_id when present, otherwise one immutable UUID allocated at open and retained in that Office session, then calls07d openPdfInput with the snapshot reference/document/revision/content_id. Source Office stamp is never passed as a PDF disk stamp; no fake file path. Retain artifact/snapshot/PDF/helper leases until pages release; cancellation/source change disposes only owned results.13 refuses sensitive CLI rendering before spooling; its structural preview must obey native sensitive policy independently.

T3 owns the C++ bridge implementation for the12b fixed wire methods open/render/close_document/close and fixed response/heartbeat records. Source files tools/office-bridge/src/{main,protocol,read_document,render,sections}.cxx/hxx and native office_pool.rs/office_pool_leases.rs implement exact field/bounds rules. No arbitrary UNO method string from UI; fixed SDK calls D3 only. Viewer tasks import this pool seam rather than using EngineHost.run to pretend a one-shot process stays warm. Tests in src-tauri/src/office_pool_step13_tests.rs: warm_two_viewers_same_actor; pool_fifth_open_closes_only_unleased; all_four_leased_returns_busy; pool_cancel_invalidates_native_handles; derived_pdf_uses_snapshot_identity; derived_pdf_never_reuses_office_stamp; comments_use_guarded_structural_parser. Runtime pack/source/license/SDK/build proof remains coordinator acceptance.

Quick preview transport is explicit: add WebviewHelperKind.office_quick to07d E7 through coordinator wiring, static entry `src/office-quick-helper/main.ts`, actions office.quick.open/office.quick.page, flag --office-quick-helper,256MiB/5s. Parent guarded ZIP reader supplies at most256 approved XML grants, total128MiB, each XML<=16MiB; reject DTD/entity declarations before disconnected DOMParser use. Requests carry format/entry IDs/page parameters, never XML bytes in JSON. Spreadsheet calamine parsing runs native --office-sheet-helper with256MiB/5s. Both produce bounded OfficeCellPage/quick-preview records and token-backed page images; unsupported legacy formats return the D2 fallback. No source chooses a helper script or action name.

Errors office.bad_request/not_found/unsupported/too_large/changed/engine_failed/pack_missing/sensitive_unsupported/cancelled. All services invoke only fromservices; Rust validates main window, source authorization, session limits and page parameters. Max8sessions, idle10min, close on last view reference; late results cannot replace newer revision.

## UI/text/commands

Use ToolbarDock and View ribbon; header40px,tabrow34,body112; left navigation196px, comments300px toggle, central page canvas token background. Grid row28; thumbnails120x160. `.adp-office-preview` grid columns196px minmax(0,1fr) optional300px; `.adp-office-comments` overflowauto,padding12; at<900px panels become controlled flyouts. No document HTML in app DOM. Focus order navigation/document/comments; selected sheet/tab announced; page status polite. F5 presentation only in slide view, Escape exits; editable elements retain their keys.

| Key | English | Spanish |
|---|---|---|
| office.word / office.sheet / office.slide | Word document / Spreadsheet / Presentation | Documento de Word / Hoja de cálculo / Presentación |
| office.quick / office.accurate / office.loading | Quick preview / Accurate page view / Preparing accurate view… | Vista previa rápida / Vista de páginas precisa / Preparando la vista precisa… |
| office.comments / office.sheets / office.slides / office.present | Comments / Sheets / Slides / Present | Comentarios / Hojas / Diapositivas / Presentar |
| office.noPreview / office.fontSubstitution / office.notRecalculated | A preview is not available for this format without the Office pack. / Some fonts were substituted. Layout may differ. / Saved values; formulas have not been recalculated. | No hay vista previa para este formato sin el paquete de Office. / Se sustituyeron algunas fuentes. El diseño puede variar. / Valores guardados; no se han recalculado las fórmulas. |
| office.pageOf | Page {page} of {count} | Página {page} de {count} |
| office.readOnly / office.openChosen | Read-only view / Open in my chosen app | Vista de solo lectura / Abrir en mi aplicación elegida |
| errors.office.failed / errors.office.sensitive_unsupported | This Office file could not be displayed. / This viewer cannot send a locked document to a file-based engine. | No se pudo mostrar este archivo de Office. / Este visor no puede enviar un documento bloqueado a un motor que usa archivos. |

Other office errors use errors.office.failed plus stable diagnostic code. Commands office.showComments/office.present/office.quickView/office.pageView, label keys above, icons MessageSquare/Presentation/FileText/File, no shortcut except F5 scoped presentation; help viewing-office/presentation-mode/fonts-layout. Handler texts use exact keysabove. Shared translations/schema/registry/assets belong coordinator.

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

## Full help

viewing-office.md — English **Viewing Office files**: “Open a Word document, spreadsheet or presentation in a file tab. Adperastra shows a quick or cached preview while preparing the accurate page view. Choose a sheet or slide in the navigation pane. Use Comments to read supported comments. Install the Office engine from App storage for accurate rendering; otherwise use Open in my chosen app. Views never change the source or run macros. Some features and fonts can look different; inspect important output. See also: Presentation mode; Fonts and layout.” Spanish **Ver archivos de Office**: “Abre un documento de Word, una hoja de cálculo o una presentación en una pestaña. Adperastra muestra una vista rápida o guardada mientras prepara la vista de páginas precisa. Elige una hoja o diapositiva en el panel de navegación. Usa Comentarios para leer los comentarios compatibles. Instala el motor de Office desde Almacenamiento de la aplicación para el diseño preciso; si no, usa Abrir en mi aplicación elegida. Las vistas no cambian el original ni ejecutan macros. Algunas funciones y fuentes pueden verse distintas; revisa los resultados importantes. Consulta también: Modo de presentación; Fuentes y diseño.”

presentation-mode.md — English **Presentation mode**: “Open a presentation and choose Present, or press F5 while its viewer is active. Use arrows or Page Up/Page Down to change slides and Escape to return. The audience window shows slides only; notes and comments remain outside it. Presenter view and editing are added separately. See also: Viewing Office files.” Spanish **Modo de presentación**: “Abre una presentación y elige Presentar, o pulsa F5 con el visor activo. Usa las flechas o Re Pág/Av Pág para cambiar de diapositiva y Esc para volver. La ventana del público muestra solo diapositivas; las notas y comentarios quedan fuera. La vista del moderador y la edición se agregan por separado. Consulta también: Ver archivos de Office.”

fonts-layout.md — English **Fonts and layout**: “Office files may name fonts that are not installed. The Office pack includes licensed metric-compatible alternatives and shows a warning when it substitutes a font. Compare page breaks, tables and symbols in important files. The accurate view uses the installed engine and font inventory; it is not a promise that every Microsoft Office feature renders identically. Documents never download fonts automatically. See also: Viewing Office files; App storage.” Spanish **Fuentes y diseño**: “Los archivos de Office pueden usar fuentes que no están instaladas. El paquete incluye alternativas con licencia y métricas compatibles, y avisa cuando sustituye una fuente. Compara saltos de página, tablas y símbolos en los archivos importantes. La vista precisa usa el motor y las fuentes instalados; no garantiza que todas las funciones de Microsoft Office se vean idénticas. Los documentos nunca descargan fuentes automáticamente. Consulta también: Ver archivos de Office; Almacenamiento de la aplicación.”

## Check by hand / speed / screenshots / done

Fixtures retained: DOCX two pages/heading/table/comment; XLSX2sheets100000rows/formula cachedvalue3; PPTX3slides/comment/hiddennote; ODF counterparts; RTF paragraph; legacy files from licensed corpus; missing font; malformed ZIP/external link/macro canaries. Coordinator records exact fixture hashes and reference Microsoft-exported PDFs where available, compares cold/warm views/print/page counts/comments/unchanged source/missing pack/engine crash. Spanishdark/pseudo, keyboard,200%zoom and no autoplay.

Measures step13.quick.first_view Fast1s for supported structural/cachedpreview; accuratecold Waiting<=10s with feedback, warmfirstpage Fast1s; navigation Instant100ms; grid Smooth16ms. Legacy uncached exceptions must be measured/reported and resolved before claiming full milestone. Reserve147-office-word,148-office-sheet,149-office-slide three variants. Done: every format has explicit accurate/quick/fallback behavior, safe read-only confinement, real pack/font inventory, verified cache/lifetime and reviewer fidelity results; no fabricated owner approval or publication.
