# Step 07d: PDF viewer

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-07d-pdf-viewer |
| Tag | v0.0.23-step07d |
| Depends on | 07a cache/helper, 07b preview, 04b ribbon |
| Written before | 07a was built |
| Interface revision | pdf-reader-2, preview-foundation-1; helper-transport-1; file-backing-1 |

Guide only. Workers write implementation/tests; coordinator performs dependency installation, shared wiring, builds, tests, runtime review and commits. Use the exact import/export names below; do not substitute an imagined PDF API.

## Goal

Read PDFs in a tab, navigate pages/outline, select/search text, zoom/fit/rotate and print. First-page presentation loads before offscreen pages. Damaged PDFs cannot crash the Explorer process.

## Do not do

No annotation editing/forms/signing (14a), OCR (07e), conversion (08b), active PDF scripts/actions, remote resources, browser plugins or alternate PDF engine. Passwords stay in memory and are never saved to sessions/logs/cache keys.

## Read first

Full07a/07b exports; v1 07b; PDF measured design frame; handler/ribbon/ViewerFrame; helper/native grant protocol; tauri config/packaging; source-installed pdfjs-dist6.4.299 declarations and package metadata. Source research retained under `%TEMP%/adperastra-guide-research-20261101/pdfjs-dist-6.4.299` is reference, not a runtime dependency.

## Decisions

- D1. Pin pdfjs-dist6.4.299 (Apache-2.0). Its published package requires Node>=22.13 or>=24. Use its own bundled module/worker/assets at the same version. Do not install optional native canvas for the browser path. `getDocument`, loading task promise/destroy, document getPage/getOutline, page getViewport/render/getTextContent and render-task cancellation were checked in the pinned type declarations. Do not pass removed/unknown parameters such as an assumed isEvalSupported option.
- D2. Keep R-SEC-9: PDF.js runs in a **separate `Adperastra.exe --pdf-helper` process**, hosting its own hidden WebView2 and worker. A worker in the main app alone is insufficient isolation. Parent process uses the additive framed HelperProcess factory and existing job limits below; helper owns a separate nonpersistent browser-data subfolder under app data, one trusted built frontend entry `pdf-helper.html`, no main-app commands/capabilities. Main window and helper never share a document DOM.
- D3. Helper-only protocol serves its one guarded PDF through its own token and accepts bounded PNG result uploads from its trusted helper frontend. Raw bytes use protocol request bodies/streams, never JSON/base64; parent validates output/stamp/PNG before cache publication. Disk source path reaches the native child only in a kind1 framed control message; it opens/holds the same guarded file. Immutable snapshots use the native resolver E9 and memory/file backings below; their paths are never fabricated. No PDF-specified path/network URL is opened.
- D4. PDF init: local granted URL, rangeChunkSize65,536, disableStream true, disableAutoFetch true, useWorkerFetch false, useWasm false, useSystemFonts false, disableFontFace true, enableXfa false, maxImageSize100,000,000, canvasMaxAreaInBytes67,108,864; no scripting manager, JS evaluation or link launch integration. CMaps/standard fonts resolve only to packaged allowlisted assets. WASM is disabled to retain the current no-eval policy; unsupported decoder/font cases return pdf.unsupported_feature, not a silently blank successful page. Helper CSP exact directives: default-src self; script-src self; worker-src self; connect-src self http://adpfile.localhost; img-src self blob: http://adpfile.localhost; style-src self unsafe-inline; font-src self; frame-src none; object-src none; base-uri none. No unsafe-inline scripts, unsafe-eval or wasm-unsafe-eval. Existing root CSP is unchanged; bundling proves worker URL same origin.
- D5. At most two live helpers, each768MiB memory; source max512MiB, pages max10,000; one visible page render plus adjacent-page prefetch; render canvas max4,194,304pixels and8MiB PNG; page text max50,000runs/1MiB decoded per page, return pages in bounded chunks. First render15s wall timeout, subsequent renders10s; silent helper timeout3s after startup; cancellation kills within250ms. An evicted disk helper can restart only after source-stamp validation; a snapshot helper restarts only while its resolver lease remains valid. Releasing a snapshot session drops that lease.
- D6. Ordinary disk page/thumbnail results are cached by source stamp, provider pdfjs/6.4.299, page, normalized rotation and render bucket. Snapshot results use session-owned memory leases keyed by immutable identity; sensitive inputs and their results never enter disk cache. At most12 visible/adjacent image leases, release obsolete ones immediately. Zoom10-400%, default fit width; rotation0/90/180/270. Rendering buckets512/1024/2048 pixels longest edge; display scales cached image until latest render ready. Search runs sequential bounded text pages in helper, cancellable, results pages128matches max768KiB with continuation.
- D7. Text DTO coordinates are PDF points transformed by page viewport. UI text layer is escaped React text/positioned spans, never PDF HTML. Preserve per-run reading order/text selection and map search ranges to run offsets; no script/action/embedded-file execution. Outline max5,000nodes/depth32, labels512characters; unsupported external targets disabled.
- D8. Printing uses helper's trusted print view, user-selected range max100pages per print operation, images rendered sequentially at150dpi within pixel/memory bounds. Call verified WebviewWindow.print on helper, letting normal system print UI choose/confirm. Cancellation returns cleanly; no silent printing or source write. Larger documents can print ranges. Do not hold hundreds of page canvases in memory.
- D9. No settings schema bump. Per-tab view state is bounded below; restore through normal file-open/grant pipeline. Protected-view restrictions remain; PDF viewer has no editing commands.

## Uses from other steps

| Ref | Producer and canonical name | Exact use |
|---|---|---|
| U1 | 07a E1-E5: CacheStore/CacheKey/SourceStamp/CacheLease, CacheService.source_stamp/lease/release, releaseCacheLease | kind pdf_page; options page/rotation/render bucket; per-kind blob cap8MiB; no guessed token/path |
| U2 | 06d helper.rs/jobs.rs and services/jobs.ts | HelperProcess, DriveTimings, JobContext/spawn_job, runJob<T>/JobHandle<T>; result is on completion, not handle.result |
| U3 | 07b E5; handlers/types.ts | previewOnly optional boolean: no print/autoplay/dirty/save in quick preview; HandlerViewProps.active cancels offscreen render |
| U4 | 04b/05c; ribbon/ViewerFrame.tsx, ToolbarDock | Existing ribbon docking; type accent pdf; do not build fixed-position duplicate ribbon |
| U5 | 04a; files.ts/handler registry/openPipeline | Existing FileTypeInfo and normal token/grant lifecycle; handler ID pdf, MIME application/pdf, extension pdf, priority before text |

## Data shapes

Canonical wire types: `src/services/pdf.ts`, native mirror `src-tauri/src/pdf_types.rs`. PDF.js proxy/task types stay inside trusted helper frontend and are never mirrored as serializable fields.

| Type | Fields, types, defaults/validation |
|---|---|
| PdfInput | tagged kind file {path:absolute string<=32768 UTF-16units,expected:optional SourceStamp} or snapshot {reference:PdfSnapshotRef}; no rawbytes/path for snapshot |
| PdfSnapshotRef | snapshot_id UUID; document_id string1-128; revision safeu64/number; content_id UUID; allfour checked by native resolver |
| PdfSourceIdentity | tagged kind disk {stamp:SourceStamp} or snapshot {document_id:string1-128,revision:safeu64/number,content_id:UUID,sensitive:bool}; immutable identity used by every page/text/cursor |
| PdfSession | session_id UUID string; source PdfSourceIdentity; page_count u32/number1-10,000; password_required bool; permissions `can_copy`, `can_print` bool, default false until determined; respect document permission result |
| PdfPageInfo | page u32/number1-based; width_pt,height_pt finite positive f64/number <=144,000; rotation u16/number0/90/180/270 |
| PdfPageImage | info PdfPageInfo; image CacheLease; render_width,render_height u32/number; resolved_scale finite positivef64; rendered_rotation0/90/180/270; request_revision u32/number |
| PdfTextRun | text String/string <=4,096characters; x,y,width,height finite f64/number PDF points; direction ltr/rtl; font_size finite positive number; order u32; no font URL/HTML |
| PdfTextPage | page u32; runs Vec<PdfTextRun>/array max50,000; next_run optional u32; total run count bounded; complete bool; source PdfSourceIdentity |
| PdfOutlineNode | id UUID string; title String/string <=512characters; page optional u32; children Vec<PdfOutlineNode>/array; no arbitrary URL/action |
| PdfOutlinePage | nodes Vec<PdfOutlineNode>/array bounded by remaining5,000-node total and768KiB payload; next_cursor optional UUID; complete bool; cursor tied to session/source |
| PdfSearchMatch | page u32; run u32; offset,length u32 in Unicode scalar offsets; excerpt String/string <=256characters |
| PdfSearchPage | matches Vec<PdfSearchMatch>/array max128; next_cursor optional UUID string; complete bool; scanned_pages u32; total_pages u32 |
| PdfViewState | page u32 default1; zoom number10-400 default100; fit width/page/none defaultwidth; rotation0/90/180/270 default0; thumbnails_open bool true; outline_open bool false; no passwords/tokens |
| PdfRasterSpec | tagged kind bucket {edge:512/1024/2048} or dpi {value:u16/number72-600}. Native rejects unknownkind/fields |
| PdfRenderRequest | session_id UUID; page u32; raster PdfRasterSpec; rotation0/90/180/270; request_revision u32; all revalidated against live session |
| WebviewHelperKind | Rust enum/TS union pdf/book/notebook/model/psd/pdf_write/presentation; presentation reserved here, activated22a; compile-time provider registration only, never a user URL |
| WebviewHelperConfig | Rust-only kind WebviewHelperKind; entry &'static str packaged asset path; max_body_bytes usize bounded1-16MiB; max_output_bytes u64 <=1GiB exactproviderlimit; data_dir PathBuf resolved app data;placement HelperWindowPlacement defaultHidden; no arbitrary remote origin |
| HelperDisplayRect | native left/top i32 physicalpixels,width/height u32positive<=32768; rectangle must match one live monitor |
| HelperWindowPlacement | native enum Hidden or Audience {display_id:String1-128,rect:HelperDisplayRect}; Audience allowed onlyreserved kind presentation after22a activation. Parent validates explicit monitor choice; child native verifies matching live display before constructing fullscreen audience window; no user-selected window handle |
| HelperInputGrant | Rust-only grant_id uuid::Uuid; name String<=255; mime String<=128; source HelperInputSource; no browser-chosen paths |
| HelperInputSource | Disk {path:PathBuf,expected:SourceStamp,pinned:Arc<PinnedSource>} or Memory {data:Arc<zeroize::Zeroizing<Vec<u8>>>,document_id:String<=128,revision:u64,content_id:uuid::Uuid,sensitive:bool}. or Snapshot {backing:Arc<GrantedBacking>,document_id:String<=128,revision:u64,content_id:uuid::Uuid,sensitive:bool}. Snapshot always maps to a memory manifest/body, streaming a Disk backing from its pinned file in1MiBchunks or sharing Memory backing bytes; no path/stamp is fabricated. Raw memory/snapshot bytes use framedpipes, neverJSON |

Errors: pdf.bad_request, pdf.too_large, pdf.password_required, pdf.bad_password, pdf.permissions, pdf.changed, pdf.corrupt, pdf.unavailable,pdf.snapshot_unavailable,helper.sensitive_unsupported. Add errors.pdf.unsupported_feature = “This PDF feature cannot be rendered safely by this viewer.” / “Este visor no puede mostrar esta función PDF de forma segura.” Error text comes only from keys below. A stale session or mismatched source cannot grant another file.

## Exports for later steps

| Ref | Canonical definition | Parameters -> return; lifetime/consumers |
|---|---|---|
| E1 | services/pdf.ts: openPdfInput / openPdf / closePdf | openPdfInput(input:PdfInput,password?:string)->Promise<JobHandle<PdfSession>>; native pdf_open_input_start(request_id,input,password)->unit. Compatibility openPdf(path:string,password?:string)->Promise<JobHandle<PdfSession>> wraps file input; retain pdf_open_start(request_id,path,password) as same native path adapter. closePdf(sessionId:string)->Promise<void> via pdf_close(session_id), idempotent. Passwords are memory-only kind1 pipe fields.07e/08b/14a/09k |
| E2 | services/pdf.ts: renderPdfPage | request PdfRenderRequest ->Promise<JobHandle<PdfPageImage>>; pdf_render_start(request_id,request); same PdfSourceIdentity required; ordinary disk leases through07a, snapshot/sensitive memory leases throughE8; one releaseCacheLease API. 07e/08b/14a |
| E3 | services/pdf.ts: readPdfText | sessionId string,page number,afterRun optional number ->Promise<PdfTextPage>; command pdf_text_page(session_id,page,after_run). Result max768KiB serialized; continuation preserves run positions. 07e/11a/14a |
| E4 | services/pdf.ts: pdfOutline / searchPdf | pdfOutline(sessionId string,cursor optional UUID)->Promise<PdfOutlinePage>; searchPdf(sessionId,query string1-256,matchCase bool,cursor optional UUID)->Promise<JobHandle<PdfSearchPage>>. Commands pdf_outline(session_id,cursor) and pdf_search_start(request_id,session_id,query,match_case,cursor); cursors bound to session/query/source. 09i/11a |
| E5 | src/handlers/pdf/PdfView.tsx | default component HandlerViewProps; uses no new required root props. Export pure pdfViewportPoint(x,y,pageInfo,zoom,rotation)->point and inverse in src/handlers/pdf/pdfCoordinates.ts. 07e overlays/14a annotations |
| E6 | services/pdf.ts: printPdf | sessionId string,firstPage number,lastPage number ->Promise<JobHandle<void>>; pdf_print_start; range count<=100 and can_print true; unavailable in previewOnly |
| E7 | src-tauri/src/webview_helper.rs: WebviewHelperConfig/WebviewHelperKind/HelperInputGrant, `run_webview_helper` | start_webview_helper(config:WebviewHelperConfig,inputs:Vec<HelperInputGrant>,cancel:CancellationToken)->Result<WebviewHelperSession,String>; session.request(&mut self,request:WebviewHelperRequest,cancel:CancellationToken)->Result<WebviewHelperResult,String>;session.update_inputs(&mut self,inputs:Vec<HelperInputGrant>,cancel:CancellationToken)->Result<(),String> between requests only; session.close(&mut self)->Result<(),String> idempotent and Drop terminates child. run_webview_helper(config:WebviewHelperConfig,inputs:Vec<HelperInputGrant>,request:WebviewHelperRequest,cancel:CancellationToken)->Result<WebviewHelperResult,String> is one-shot start/request/close convenience. Parent owns child FramedHelperProcess. Static child entry serves guarded token ranges; result rawchunks return to parent-owned sink. No child/main capability sharing. 07f JS parsers,07g model/PSD,08b PDF writing reuse host, never copy parent app capabilities |

### Exact raster math and helper transport

For a rotated scale1 viewport(width_pt,height_pt), bucket scale=edge/max(width_pt,height_pt), DPI scale=value/72. Width/height=ceil(rotatedviewportdimension*scale). Reject a product above4,194,304 before allocating or silently lowering DPI; bounds apply to print/export too. Add tests72pt square at150DPI=>150x150,1000pt square600DPI=>too_large.07e chooses bucket2048;08b/print dpi; cached key records kind/value/rotation, not just oldedge.

E7 additionally fixes the transport types below. Native types live in `src-tauri/src/webview_helper_types.rs`; browser mirrors live in `src/services/helperBridge.ts`. A feature validates its own typed payload before parser work. Unknown payloads exist only at the deserialization boundary, never in feature service DTOs.

| Type | Exact fields/signatures |
|---|---|
| HelperAction | pdf.open/render/text/outline/search/print;book.open/page/contents;notebook.open/page;model.open/scene;psd.open/layers;pdf.write_images/write_blocks;privacy.xmp;presentation.frame/presentation.wait_intent/presentation.end. These are exact dotted wire values, with each slash-separated suffix expanded separately; unknown refused |
| WebviewHelperRequest | native request_id uuid::Uuid;action HelperAction;payload serde_json::Value with serialized<=768KiB;output_specs Vec<HelperOutputSpec>max256; producer serializes its named request type and declares required bounded output count before launch |
| HelperGrantDTO | browser-safe grant_id UUID;token_url string<=33792 from fileUrl of32lowercasehex token and percent-encoded name;name string<=255;mime string<=128;byte_len safeu64/number;sensitive bool. No native path/stamp/memory bytes |
| HelperRequestEnvelope<T> | protocol_version literal1;request_id UUID;action HelperAction;inputs readonly HelperGrantDTO[] max256;output_reservations readonly HelperOutputReservation[] max256;payload T; combined serialized<=768KiB |
| HelperOutputSpec | native mime String<=128;max_bytes u64>0 up to config.max_output_bytes. Parent sums/reserves specs before launch. Text/open/search-only actions use emptylist; page render oneimage/png spec8MiB; writers split outputs into requests ofmax256 ifneeded |
| HelperOutputReservation | output_id UUID;mime string<=128;token_url string formed from helper-output route;upload_token exactly32lowercasehex;max_bytes safeu64/number<=provider output cap;sensitive bool. Parent allocates before request; no caller-chosen output path |
| HelperOutputDTO | output_id UUID;mime string<=128;byte_len safeu64/number;sha256 string64lowerhex. Bytes use result protocol, not this DTO |
| HelperReplyEnvelope<T> | tagged status ok {protocol_version:1,request_id:UUID,payload:T,outputs:HelperOutputDTO[]max256} or error {protocol_version:1,request_id:UUID,error_code:string<=128}; success payload/output manifest is validated against named feature reply type and uploaded bodies |
| WebviewHelperResult | native request_id UUID;reply serde_json::Value<=768KiB;outputs Vec<HelperOutput>max256; built only after all bodies verified |
| HelperOutput | native output_id UUID;mime String<=128;byte_len u64;storage HelperOutputStorage; storage OwnedFile(OwnedOutput) or Memory(zeroize::Zeroizing<Vec<u8>>) |
| HelperControlFrame | native serde tagged kind start/ready/input_update/inputs_ready/request/reply. start contains protocol_version:1,kind:WebviewHelperKind,placement:HelperWindowPlacement,inputs:Vec<HelperInputManifest>; ready contains protocol_version:1,private_profile:bool after native private-profile preflight and public frontend listener initialization; input grants and bytes remain withheld until parent accepts this state; input_update contains update_id:UUID,inputs:Vec<HelperInputManifest>; inputs_ready contains update_id:UUID,inputs:Vec<HelperGrantDTO>,private_profile:bool; request contains browser HelperRequestEnvelope<serde_json::Value>; reply contains HelperReplyEnvelope<serde_json::Value>. Kind1 pipe frame only, never a line protocol |
| HelperInputManifest | native-only grant_id UUID;name String;mime String;source tagged disk {path:PathBuf,expected:SourceStamp} or memory {document_id:String<=128,revision:u64,content_id:UUID,sensitive:bool,byte_len:u64}; memory rawbytes arrive via kind2 frames. Parent keeps PinnedSource guard and child repins disk source |
| onHelperRequest<T> | (handler:(request:HelperRequestEnvelope<T>)->void)->Promise<UnlistenFn>; host emits helper-request only after its input grants are ready. A single active request per child; request ID/action checked before callback |
| sendHelperReply<T> | (reply:HelperReplyEnvelope<T>)->Promise<void>; service invokes helper_reply(reply) only. Native helper_reply(window,reply:HelperReplyEnvelope<serde_json::Value>)->Result<(),String> starts ensure_main, validates version/id/action state/caps and writes kind1 reply to parent stdout |

Inputs max256, aggregate1GiB, each memory<=256MiB; per-feature lower caps win. Any sensitive input forces all intermediate/results Memory and disables disk cache/browser-profile persistence. Unsupported memory route returns helper.sensitive_unsupported before launching.07f books/07g model/PSD/08b writing use multiple named grants. A resource URL cannot authorize another source.

Framed pipes are separate from archive/font's existing line transport: header kind u8 plus length u32 little-endian. Kind1 is serialized HelperControlFrame<=768KiB; kind2 input/3 output body is UUID16 rawbytes plus offset u64 little-endian plus chunk<=1MiB; kind4 body-end is UUID16 plus total length u64 little-endian plus SHA25632; kind5 error is UTF8 stablecode<=4096. The initial start control declares only input manifests; startup completes after ready within3s; a sensitive session requires ready.private_profile=true before any token/grant/body delivery. Before each session.request parent creates output reservations from request.output_specs and reserves aggregate output/memory budget; the kind1 request envelope includes these reservations; each memory input's body/end completes before browser request dispatch. Browser announces output manifest through its reply only after sequential protocol uploads complete. Offsets are contiguous; duplicate, trailing, unknown-ID, oversized and out-of-order frames terminate child. Parent verifies hash/length/format before accepting reply. Cancellation closes pipes, terminates child after250ms and disposes only owned outputs. Never call send_line/recv/helper::drive for this binary protocol; use the additive framed factory below, whose raw reader preserves byte values and uses the same process/job resource-limit facilities. No second launcher or user-chosen JS entry.

Helper GET ranges use adpfile tokens from E8, at most4MiB per response and allowlisted grant only; chunk larger ranges at callers. Result POST route is `http://adpfile.localhost/helper-output/<request_id>/<output_id>` with a separate32lowercasehex upload token in `X-Adp-Upload-Token`, contiguous `X-Adp-Offset` decimal offset, chunks<=1MiB; final empty POST carries exact `X-Adp-Final-Length` and `X-Adp-Sha256`. Parent-created output IDs/tokens are granted in HelperRequestEnvelope.output_reservations before upload; child cannot choose arbitrary IDs or paths. Reject wrong request/token/offset/length/hash before manifest acceptance; MIME/length must also match its reservation. Unused reservations are disposed at request completion. PDF/book native sessions retain WebviewHelperSession across open/page/text/contents calls and close it at session disposal; they do not use the one-shot convenience for persistent state. Request cancellation kills that child and makes later calls pdf.changed/extra_view.changed until normal reopen. This host route is separate from08a snapshot upload. Ordinary uploads use owned staging; sensitive uploads use bounded memory. No bytes/base64 in JSON.

Pin zeroize1.9.1 at07d for memory sinks, MIT OR Apache-2.0/Rust1.85. Also add direct Windows-only webview2-com exactly0.39.1 and dependency alias windows-core-webview for package windows-core exactly0.62.2, both default features, MIT OR Apache-2.0 for windows-core and MIT for webview2-com, both Rust1.82. These versions already occur in Cargo.lock; alias avoids confusing this Interface/BOOL with existing windows0.61.3/windows-core0.61.2 bindings. Coordinator records these direct dependency records/transitives/notices before adoption; no installation during guide authoring. Helpers use a nonpersistent WebView2 environment for sensitive grants and prohibit source screenshots/logging/clipboard/history/disk cache. Failure to prove no browser disk persistence disables sensitive-webview route before opening; it is not a safe fallback. Helpers register no main-app commands/capabilities. Static launch flags select configs; no input selects a script/entry path.

### Persistent input replacement (07d E7)

WebviewHelperSession.update_inputs(inputs:Vec<HelperInputGrant>,cancel:CancellationToken)->Result<(),String> replaces the complete allowlist atomically between feature requests; no active request/upload may coexist, otherwise helper.busy. The trusted caller supplies fresh grant IDs not present in the current allowlist; the parent validates their uniqueness and allocates fresh tokens, reserves aggregate old+new memory<=1GiB, then sends kind1 input_update followed by all required kind2 bodies/kind4 ends. Child pins/validates disk input or accepts bounded immutable memory, verifies hashes and counts, then sends kind1 inputs_ready with matching update_id and browser-safe grants only. Native parent commits replacement only on this reply; the next feature request envelope uses exactly the new grant list. Parent and child revoke old grants after their current HTTP range responses complete, never while serving bytes; in-flight Arc lifetime remains valid. Cancel/invalid body/death/2s update deadline kills the child and releases only owned new/old resources; no half-updated session may process another request. No browser invoke can call update_inputs or choose a source path.

Input updates retain max256grants/256MiB per memory source/1GiB aggregate and all lower feature limits. Tokens remain32lowercasehex. Sensitive classification is sticky for child lifetime: once sensitive, every later result is memory-only and no disk cache/profile permission is restored. A new sensitive update requires an already verified current private window before any new token/body/manifest is delivered; otherwise helper.sensitive_unsupported and close, with zero sensitive bytes delivered. Existing PrivateWebviewProof applies only to that unchanged child/window. Request completion must acknowledge that display/image loads for old input are settled before a presentation input replacement; a2s outstanding-read timeout closes child rather than guessing an old grant is unused.07d T2 implements this primitive even before22a activates its reserved helper kind.

Exact T2 tests in src-tauri/src/webview_helper_input_step07d_tests.rs: update_while_request_active_busy; complete_update_replaces_allowlist_once; malformed_update_kills_without_partial_registry; cancelled_update_releases_old_and_new_owned_inputs; in_flight_range_retains_old_arc; sensitive_update_before_private_proof_sends_zero_bytes; stale_update_id_refused; reused_grant_id_refused; aggregate_old_plus_new_memory_cap. Include helper.busy = “The viewer is still handling another request.” / “El visor todavía está atendiendo otra solicitud.” through errors.helper.busy; other update protocol errors map existing helper.failed/timeout/sensitive_unsupported.

### Required native private-profile proof

`src-tauri/src/webview_private.rs` defines require_private_webview(window:&tauri::WebviewWindow<tauri::Wry>)->Result<PrivateWebviewProof,String>. PrivateWebviewProof is native-only {window_label:String,process_id:u32,verified_at:std::time::Instant}; it contains no content/token/path and is retained only for that child window's lifetime. It is not a serde/IPC authorization object. The helper window is always built with WebviewWindowBuilder.incognito(true), hidden except an explicitly validated Audience placement, and initially loading only packaged app-owned bootstrap assets. No source token, input grant, source body, resource URL, output reservation or document payload is registered/delivered before proof. A public bootstrap listener is allowed; it receives no document data.

Call require_private_webview on a dedicated helper bootstrap blocking thread after Tauri's event loop is running; never block the UI/WebView thread. Allocate std::sync::mpsc::sync_channel capacity1, call window.with_webview with a Send+static closure, and let that closure execute only on the WebView/UI thread. In that closure use PlatformWebview.controller().CoreWebView2(), import windows_core_webview::Interface to cast to webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_13, call Profile(), then IsInPrivateModeEnabled with a pointer to a local windows_core_webview::BOOL initializedfalse. Return only Result<bool,String> through try_send; no COM pointer crosses the channel. All unsafe calls receive local valid output pointers/owned COM references and release those references on that same thread. Any scheduling/COM/query error, false result, closed channel, or recv_timeout at2seconds returns helper.sensitive_unsupported and closes that window. A late callback sees the dropped receiver and changes no host state. Successful true returns PrivateWebviewProof for the exact live window; replacing/recreating it invalidates proof and requires re-check.

Parent/startup gate withholds sensitive body frames and all tokens/grants until child native ready.private_profile=true; the child sends that true only after require_private_webview succeeds. On failure the child reports helper.sensitive_unsupported and exits before grant/bootstrap data handoff; ordinary non-sensitive viewing may use a newly created ordinary helper through its normal policy, but a sensitive source never retries there. Require the same gate for every later helper kind consuming sensitive input. Incognito request alone is insufficient: locked Wry0.57.1 source falls back to ordinary CreateCoreWebView2Controller when ICoreWebView2Environment10 is missing. Do not infer privacy from builder options or data-directory names.

Exact source evidence already on this PC: Cargo.lock tauri2.12.5/wry0.57.1/webview2-com0.39.1/windows-core0.62.2; tauri2.12.5 src/webview/webview_window.rs incognito/with_webview, src/webview/mod.rs PlatformWebview.controller; webview2-com-sys0.39.1 src/bindings.rs ICoreWebView2_13.Profile()->Result<ICoreWebView2Profile>, ICoreWebView2Profile.IsInPrivateModeEnabled(*mut windows_core::BOOL)->Result<()>; wry0.57.1 src/webview2/mod.rs init_controller Environment10 branch/fallback. T2 writes injectable preflight tests private_true_allows_grants,private_false_zero_grants,missing_profile_interface_zero_bytes,preflight_timeout_closes_window and stale_callback_cannot_authorize_new_window; coordinator additionally verifies no sensitive source bytes on disk under actual WebView2 while open/render/close/cancel/crash. Passing BOOL preflight proves actual private mode; runtime disk-leak evidence remains mandatory for enabling the sensitive route.

### Existing process launcher: exact additive binary transport

Current HelperProcess::spawn installs a capped line reader on stdout, so it cannot transport raw body frames unchanged.07d T2 adds the following in existing `src-tauri/src/helper.rs`, with frame parsing in new `src-tauri/src/helper_frames.rs`; coordinator owns the shared-file edit. No existing line method/caller changes semantics, and there is one process/resource-limit implementation.

| Export | Exact contract |
|---|---|
| HelperProcess::spawn_framed | (flag:&str,memory_limit:usize,max_frame_bytes:usize)->Result<FramedHelperProcess,String>; static compiled flag only,max_frame_bytes1-8388608. Same current_exe/arg/CREATE_NO_WINDOW/stdin+stdout piped/stderr null/JobObject assignment before request as existing spawn; on any failure kill+wait and release job |
| FramedHelperProcess | Native owner of child/stdin/framed stdout receiver/JobObject; no line receiver.07d passes max_frame_bytes1048600 (1MiB+24bytebodyprefix);08a convert helper may reuse with its own lower frame limits |
| send_frame | (&mut self,kind:u8,body:&[u8])->Result<(),String>; validates nonzero kind/body<=max_frame_bytes, writes kind+u32LElength+exactbytes and flushes; errors helper.failed |
| recv_frame | (&mut self,timeout:Duration)->Option<HelperFrameEvent>; None only timeout. HelperFrameEvent is Frame {kind:u8,body:Vec<u8>}, TooLarge,Closed,Malformed; native-only; EOF inside header/body is Malformed, EOF betweenframes Closed |
| kill | (&mut self)->unit; closes stdin, terminates child+waits, closes job; idempotent. Drop invokes kill, same cancellation cleanup as current helper |

The raw reader checks declared length before allocation, then reads exact body; bounded sync_channel capacity4 provides backpressure instead of unbounded queued raw frames. Each feature validates allowed kinds/body-specific caps/order/hash. Shared spawn setup reuses existing JobObject::create; no separately invented Windows job wrapper, shell launch or secret command argument. T2 tests bytes containing LF/CR/NUL/invalidUTF8 roundtrip unchanged, oversized length refused before allocation, truncated header/body malformed, full channel stays bounded, helper killed on Drop and existing archive/font line protocol tests unchanged. Helper errors start_failed/failed/timeout retain existing translations; malformed/too-large protocol maps to feature corrupt/too_large. The framed process is reusable by08a conversion and future native binary helpers; it is independent of the trusted WebView host.

### PDF helper payloads

Canonical private payload definitions live in `src/pdf-helper/types.ts`, mirrored native `src-tauri/src/pdf_helper_types.rs`; they are distinct from browser-facing PDF services and use07d E7 envelopes. One PDF is loaded per persistent child. No feature passes SourceStamp or path to browser JS; use its grant_id.

| Action | Request payload -> success payload |
|---|---|
| pdf.open | PdfHelperOpenRequest {grant_id:UUID,password:optionalstring<=1024} ->PdfHelperOpenReply {page_count:u32,can_copy:bool,can_print:bool}; named grant is application/pdf, source<=512MiB; parent constructs PdfSession identity and forces sensitive permissions |
| pdf.render | PdfHelperRenderRequest {page:u32,raster:PdfRasterSpec,rotation:0/90/180/270,request_revision:u32}->PdfHelperRenderReply {info:PdfPageInfo,render_width:u32,render_height:u32,resolved_scale:f64,rendered_rotation:0/90/180/270,request_revision:u32}; exactly one PNG output reservation/body, parent adds validated E8/cache lease |
| pdf.text | PdfHelperTextRequest {page:u32,after_run:optionalu32}->PdfHelperTextReply {page:u32,runs:PdfTextRun[],next_run:optionalu32,complete:bool}; parent adds PdfSourceIdentity; bound whole envelope768KiB and keep50,000total/page |
| pdf.outline | PdfHelperOutlineRequest {offset:u32 default0}->PdfHelperOutlineReply {nodes:PdfOutlineNode[],next_offset:optionalu32,complete:bool}; offset indexes preorder traversal; parent owns UUID cursor->offset/session identity map, never accepts arbitrary child state from UI |
| pdf.search | PdfHelperSearchRequest {query:string1-256,match_case:bool,page:u32,run:u32,offset:u32}->PdfHelperSearchReply {matches:PdfSearchMatch[]max128,next_position:optional{page:u32,run:u32,offset:u32},complete:bool,scanned_pages:u32}; parent cursor binds exact query/source and translates to this continuation. Unicode scalar offsets, same128matches/768KiBcap |
| pdf.print | PdfHelperPrintRequest {first_page:u32,last_page:u32,dpi:u16 fixed150}->PdfHelperPrintReply {completed:bool}; sequential trusted internal canvases/print DOM, range<=100, respect permissions; system print cancellation completedfalse, no source mutation |

Native parent checks helper request/reply page/revision/identity context, not only deserialization; stale/mismatched reply fails pdf.changed. Open/text/outline/search/print reserve no output bodies; render reserves one8MiB PNG. Print's canvases remain child-local and are disposed sequentially. Child reply error_code is restricted to PDF/host errors above; no exception string reaches UI.

### E8: early native file backings and memory result leases

These exports are implemented in07d T2, before08a/09a need them; no fs-service dependency on cache-store or Tauri is introduced.

| Export; canonical file | Exact contract |
|---|---|
| GrantedBacking; src-tauri/src/file_grant_backing.rs | Native-only enum Disk {source:Arc<PinnedSource>,length:u64} or Memory {bytes:Arc<zeroize::Zeroizing<Vec<u8>>>,length:u64,sensitive:bool}. Length must equal immutable actual bytes; memory<=256MiB/source and1GiB aggregate across grants/snapshots/helpers. No serde/debug dump of content |
| FileGrants additions; src-tauri/src/files.rs | grant_backing(&self,backing:Arc<GrantedBacking>)->Result<String,String>;resolve_backing(&self,token:&str)->Option<Arc<GrantedBacking>>. Existing grant(PathBuf),revoke(&str),path_for(&str) retain behavior; resolve_backing on an existing ordinary path grant lazily materializes a guarded Disk backing off UI thread through SourceIdentity::capture/PinnedSource::open, retains its original path_for value, and returns None on missing/changed/refused source; it does not make grant(PathBuf) itself open the file; path_for returns None for memory. Tokens remain exactly32lowercasehex, never hyphenatedUUID. Protocol validates range/length, holds Arc through response and sends Cache-Control no-store for memory; revoke blocks future reads while in-flight Arc remains valid |
| CacheService::lease_memory; src-tauri/src/cache.rs | (&self,bytes:Arc<zeroize::Zeroizing<Vec<u8>>>,name:&str,mime:&str,width:Option<u32>,height:Option<u32>,sensitive:bool)->Result<CacheLease,String>. Result cap8MiB for PDF PNG and256MiB general memory backing; reserves aggregate budget then grants backing, records lease_id to token/backing. Existing release(lease_id) and UI releaseCacheLease revoke either storage type idempotently. No CacheRecord/SourceStamp/disk cache entry is fabricated |
| CacheLease additive field;07a canonical cache types | sensitive bool defaultfalse on deserialization; ordinary leases unchanged. Session-close cancels requests and releases all page leases; last Arc drops zeroizing bytes. Every memory lease counts toward one shared aggregate budget |

T2 tests memory ranges/revocation/32hex tokens/no path_for/no disk writes and foreign grant rejection. T3 tests sensitive render uses lease_memory and zero cache publication. Underlying ordinary disk cache behavior is unchanged.

### E9: immutable PDF snapshot resolution

| Export; canonical file | Exact contract |
|---|---|
| PdfSnapshotResolver; src-tauri/src/pdf_snapshot_resolver.rs | Send+Sync trait resolve(&self,reference:&PdfSnapshotRef)->Result<ResolvedPdfSnapshot,String>; only a native static app registration may implement it |
| ResolvedPdfSnapshot | backing Arc<GrantedBacking>;identity PdfSourceIdentity, required snapshot variant;mime String exactly application/pdf;byte_len u64<=256MiB;retain Arc<dyn PdfSnapshotRetention>. PdfSnapshotRetention is a native Send+Sync marker trait; its implementor owns underlying snapshot lease until PDF session closes |
| PdfSnapshotResolvers | register(&self,resolver:Arc<dyn PdfSnapshotResolver>)->Result<(),String> rejects second registration;resolve(&self,reference:&PdfSnapshotRef)->Result<ResolvedPdfSnapshot,String>.07d creates empty registry; missing registration yields pdf.snapshot_unavailable, never a disk reload or success stub |

08a T2 implements NativePdfSnapshotResolver against its immutable snapshot registry and registers it once.07d implements real disk opening and resolver boundary/tests with injected bounded fixtures; it does not advertise unsaved capture until08a's producer exists. All four snapshot reference fields, native authorization, MIME and sensitive policy must agree before child launch. Resolver backing is passed as HelperInputSource::Snapshot, so ordinary snapshot owned-file bytes stream from PinnedSource.file() into child memory and sensitive snapshot remains memory throughout. Do not assume PinnedSource exposes a path() method; it does not. Sensitive permissions force can_copy/can_print false; text extraction may feed a native authorized editor but the PDF viewer never exposes clipboard/print for sensitive sessions. Snapshot render/text/outline/search validate immutable identity rather than path/stamp. No fake SourceStamp or container path is used.

All session/list maps bounded, max2active sessions plus8inactive descriptors; raw page bitmap uploads accepted only inside helper's one active request, max8MiB. JS invoke argument keys are camelCase, native parameters snake_case; nested requests keep snake_case. Outline paging uses the exact PdfOutlinePage shape above; it never returns an unbounded root array.

## Translation keys

| Key | English | Spanish |
|---|---|---|
| handlers.pdf | PDF document | Documento PDF |
| pdf.previous | Previous page | Página anterior |
| pdf.next | Next page | Página siguiente |
| pdf.page | Page {page} of {count} | Página {page} de {count} |
| pdf.pageNumber | Page number | Número de página |
| pdf.thumbnails | Thumbnails | Miniaturas |
| pdf.outline | Outline | Esquema |
| pdf.fitWidth | Fit width | Ajustar al ancho |
| pdf.fitPage | Fit page | Ajustar a la página |
| pdf.rotateLeft | Rotate left | Girar a la izquierda |
| pdf.rotateRight | Rotate right | Girar a la derecha |
| pdf.print | Print… | Imprimir… |
| pdf.printRange | Print pages | Imprimir páginas |
| pdf.password | Password | Contraseña |
| pdf.unlock | Open PDF | Abrir PDF |
| pdf.loading | Preparing PDF… | Preparando el PDF… |
| pdf.noText | This page has no selectable text. | Esta página no tiene texto seleccionable. |
| pdf.searching | Searching pages… | Buscando en las páginas… |
| pdf.noOutline | This PDF has no outline. | Este PDF no tiene esquema. |
| errors.pdf.bad_request | This PDF request is not valid. | La solicitud de PDF no es válida. |
| errors.pdf.too_large | This PDF exceeds the viewing limits. | Este PDF supera los límites del visor. |
| errors.pdf.password_required | Enter the password to open this PDF. | Escribe la contraseña para abrir este PDF. |
| errors.pdf.bad_password | That password did not open this PDF. | Esa contraseña no abrió este PDF. |
| errors.pdf.permissions | This PDF does not allow that action. | Este PDF no permite esa acción. |
| errors.pdf.changed | The PDF changed. Open it again. | El PDF cambió. Vuelve a abrirlo. |
| errors.pdf.corrupt | This PDF could not be read. | No se pudo leer este PDF. |
| errors.pdf.unavailable | The PDF viewer is not available. | El visor de PDF no está disponible. |
| errors.pdf.snapshot_unavailable | This unsaved PDF snapshot is not available. | Esta copia PDF sin guardar no está disponible. |
| errors.helper.sensitive_unsupported | This viewer cannot open sensitive content safely. | Este visor no puede abrir contenido confidencial de forma segura. |

Reuse existing ribbon zoom/find/close/cancel keys. All ribbon commands have IDs pdf.previous/pdf.next/pdf.fitWidth/pdf.fitPage/pdf.rotateLeft/pdf.rotateRight/pdf.thumbnails/pdf.outline/pdf.print, same-suffix label keys above, icons ChevronLeft/ChevronRight/Expand/Scan/RotateCcw/RotateCw/PanelLeft/List/Printer, no global shortcut except existing Ctrl+F routed to read-only find. F1 help viewing-pdfs. Escape closes find before preview/tab close.

## Tasks

### T1 — Pin assets and define PDF DTOs
**Files:** pdf_types.rs,pdf_snapshot_resolver.rs, services/pdf.ts; coordinator dependency records/manifests, helper assets packaging, new frontend entry. **Do:** exact data/export tables; confirm Node version before installation; bundle same-version worker/CMaps/fonts/wasm locally; no CDN/browser-native PDF embed. **Tests:** pdfContracts.test.ts: page0/NaN zoom/foreign UUID refused; DTOs roundtrip snake_case; pdf ViewState excludes password/token. **Uses:** U1/U5. **Commit:** `deps: add pdfjs-dist 6.4.299 (Apache-2.0) [step-07d/T1]`.

### T2 — Separate PDF helper host
**Files:** webview_helper.rs,webview_helper_types.rs,webview_helper_protocol.rs,webview_helper_inputs.rs,webview_private.rs,helper_frames.rs,file_grant_backing.rs,src/services/helperBridge.ts,pdf_helper.rs,pdf_helper_types.rs, pdf_helper_process.rs, pdf-helper.html, src/pdf-helper/main.ts, src/pdf-helper/types.ts,src/pdf-helper/load.ts. **Do:** implement E7/E8/E9 once; earlyflag before main app startup; isolated Tauri builder with helper-only command registration/capabilities, own data subfolder; restricted local input/output protocol; job ownership/memory/timeout/cancel; no root app state access from helper. **Tests:** helper death leaves parent usable; unapproved path/output body refused; no parent command in helper handler; second source request cannot reuse old token. **Uses:** U1/U2/E7-E9. **Commit:** `feat(pdf): isolated trusted PDF helper host [step-07d/T2]`.

### T3 — Bounded document/page/text adapters
**Files:** pdf_sessions.rs,pdf_snapshot_resolver.rs, pdf.rs, pdf_jobs.rs; src/pdf-helper/render.ts,text.ts. **Do:** E1-E3/E9, finite source/pages/pixel/text limits, guarded disk stamps or resolved immutable snapshots, password only memory; render visible page then adjacent, cancel late revisions; validate PNG+identity before ordinary disk cache or E8 memory lease; return text chunks without HTML or bytes in JSON. Native request.output_specs is empty for open/text/outline/search/print and one PNG<=8MiB for render; print keeps sequential canvases child-local. **Tests:** scripts/external-resource fixtures make zero network/action calls; PDF1000pages opens first without rendering1000; cancellation disposes render task/grants; 2^22+1pixels refused before allocation; snapshot revision1 remains revision1 after edit2; absent resolver fails without disk open; sensitive render writes zero disk/cache bytes. **Uses:** U1/U2/E1-E3. **Commit:** `feat(pdf): bounded page and text rendering [step-07d/T3]`.

### T4 — Viewer shell, pages and thumbnails
**Files:** handlers/pdf/index.ts, PdfView.tsx, PdfPages.tsx, PdfSidebar.tsx, pdfState.ts, styles/pdf.css; coordinator registry. **Do:** handler maxBytes512MiB, accentpdf, supportsFindtrue, editablefalse; ViewerFrame ribbon; sidebar196px resizable160-320; canvas surface token,24px padding; page image centered, text overlay exacttransform; sidebar row144px; virtualization overscan1page/4thumbnails; keyboard PageUp/Down and input Enter bounds. **Tests:** activefalse cancels offscreen work; virtual visible count bounded; page/thumbnail selection sync;400%zoom scrolls without breaking toolbar; protected preview no print. **Uses:** U3-U5/E1-E3/E5. **Commit:** `feat(pdf): accessible paged viewer [step-07d/T4]`.

### T5 — Outline/search/text selection and coordinate math
**Files:** PdfOutline.tsx,pdfCoordinates.ts,pdfSearch.ts,src/pdf-helper/search.ts. **Do:** implement E4; capped hierarchical outline with explicit missing-state; text selection/order/RTL; search cursor query-bound and cancellable; transform forward/inverse uses PDF viewport matrix once. **Tests:** page box(0,0,100,200), scale1, rotation90, default flipped viewport has matrix(0,1,1,0,0,0); point(10,20) ->(20,10), viewport200x100; inverse returns(10,20) within1e-6; query change clears oldmatches; outline5001st/depth33 yields explicit bounded partial/error, no UI freeze. **Uses:** E3-E5. **Commit:** `feat(pdf): text search and outline navigation [step-07d/T5]`.

### T6 — User-confirmed printing
**Files:** pdf_print.rs,src/pdf-helper/print.ts,src/handlers/pdf/PdfPrintDialog.tsx. **Do:** E6; validate permissions/range; generate bounded print view using controlled page images; helper system print UI; clean image leases and print DOM on completion/cancel. **Tests:** range101refused before render; no print without click; permissionfalse disables action in UI and Rust; cancel produces no file mutation. **Uses:** U2/E1/E2/E6. **Commit:** `feat(pdf): bounded user-confirmed printing [step-07d/T6]`.

### T7 — Help, fixtures and capture instructions
**Files:** help/en/es/viewing-pdfs.md; coordinator translations/pseudo/IPC/command tests, scripts. **Do:** full text below; ensure first page/search/sidebar sample corpus; reviewers only run tools. **Tests:** every command help exists; English/Spanish labels fit and keys/ICU agree; JS action fixtures remain inert. **Commit:** `docs(help): viewing PDFs [step-07d/T7]`.

## Help pages

English title **Viewing PDFs**. Intro: “Read PDFs without leaving the Explorer.” How to use: “Open a PDF. Use **Previous page**, **Next page**, or **Page number** to move around. Open **Thumbnails** or **Outline** for navigation. Choose **Fit width**, **Fit page**, or a zoom level. Select text to copy it, or use Find to search. Choose **Print…** and a range of up to 100 pages to open the print window.” Good to know: “PDF scripts and external resources do not run. Some scanned pages have no selectable text; text recognition is added separately. Passwords are kept only while the PDF is open. Very large or damaged PDFs may need another app. Preview mode cannot edit or print.” Last line: `See also: "Opening files" and "Quick preview".`

Spanish title **Ver PDF**. Intro: “Lee PDF sin salir del Explorador.” Cómo usar: “Abre un PDF. Usa **Página anterior**, **Página siguiente** o **Número de página** para navegar. Abre **Miniaturas** o **Esquema** para moverte por el documento. Elige **Ajustar al ancho**, **Ajustar a la página** o un nivel de zoom. Selecciona texto para copiarlo o usa Buscar. Elige **Imprimir…** y un intervalo de hasta 100 páginas para abrir la ventana de impresión.” Para tener en cuenta: “No se ejecutan scripts ni recursos externos del PDF. Algunas páginas escaneadas no tienen texto seleccionable; el reconocimiento de texto se agrega por separado. Las contraseñas se conservan solo mientras el PDF está abierto. Los PDF muy grandes o dañados pueden necesitar otra aplicación. La vista previa no permite editar ni imprimir.” Last line: `Consulta también: «Abrir archivos» y «Vista previa rápida».`

Store this full text as normal recipe-format Markdown with headings and paragraphs; use same filename in both languages.

## Check by hand

Retained fixtures: text-1.pdf one page Hello/Spanish accented text; text-100.pdf100numberedpages; text-1000.pdf1000pages; scan.pdf image-only synthetic page; outline.pdf3pages/nested outline; locked.pdf known synthetic password; hostile.pdf inert launch/JS/remote-link fixtures; corrupt.pdf text notPDF. Coordinator generates valid fixtures without overwriting user files. Check first page, scrolling/search/copy/RTL/zoom/rotation/thumbnails/outline, password/retry, helper crash/reload, source change, print cancel/range, preview restrictions and no network. Repeat es/dark,pseudo,keyboard and200%zoom; compare raster/text overlay against trusted baseline PDF output.

## Speed

`step07d.pdf.first-page.1`, `.100`, `.1000` Fast1s; cached page Instant0.1s; `step07d.pdf.page-next` Fast1s; scroll/zoom feedback Smooth16ms/frame; searching large PDFs background with progress/cancel. Report actual helper startup/memory and tier misses; no invented measurements.

## Screenshots

64-pdf-viewer,65-pdf-search,66-pdf-outline; en/light,es/dark,pseudo/light under step-07d. Capture text selection/focus where visible.

## Done when

- [ ] Coordinator verifies pinned dependency/assets, helper isolation/limits, all command validation/allowlists and source safety.
- [ ] All specified navigation/text/search/outline/print tests implemented and executed by reviewer; read-only/protected/preview behavior holds.
- [ ] PDF scripts/resources never run; pages/text/grants/caches/session maps bounded and cancellation releases resources.
- [ ] Export rows match OCR/conversion/PDF editor consumers; help/keys/pseudo/screenshots/speed/report checked. Guide review does not itself count as a tested implementation.
