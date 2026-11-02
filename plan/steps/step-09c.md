# Step 09c: Cross-tab drops, content transfer and Windows activation

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 4/5 |
| Branch | step-09c-tab-transfer |
| Tag | v0.1.3-step09c |
| Depends on | 09a tabs-documents-1;09b tab-groups-1;03b file transfer |
| Written before | 07a was built |
| Interface revision | content-transfer-1; activation-1 |

Guide only. Workers write owned code/tests and integration instructions; coordinator performs all executed checks, installation, shared wiring and commits. No worker compilation, app launch, dependency install or tests.

## Goal and exclusions

Hover over tabs while dragging files, open drops in tabs/groups, and transfer compatible text, cells, pictures and PDF pages between editors. Files opened from Windows reach the running instance through the normal open pipeline. No association installer (16), split UI (09i), new editor (14-22), AI or arbitrary execution from clipboard data.

## Read first

v1 step09a drag/content/single-instance paragraphs; full09a/09b; `src/handlers/openPipeline.ts`, `src/services/fileops.ts`, drag functions in `src/services/fileops.ts` and `src-tauri/src/drag.rs`; handler/ribbon command contracts; current clipboard services; `src-tauri/src/main.rs` entry/helper-flag dispatch; Windows0.61.3 named-pipe/security APIs. Coordinator verifies feature gates from pinned source and records them before dispatch.

## Decisions

- D1. Distinguish tab reordering, external file drops and app content drags by separate MIME labels. A label is a hint, never authority. Internal content uses only an opaque UUID token resolved natively against current main-window session. Serialized HTML, arbitrary paths or source-provided command names cannot become editor operations.
- D2. Hover activation delay default600ms, setting `tabs.drag_hover_ms`200-2000, settings20->21. Start one timer per target, cancel on leave/drop/Esc/pointer cancellation or session end. Hover never mutates files. It preserves the drag payload while activating an eligible target; protected/disabled targets show a reason.
- D3. Folder drop delegates existing03b preview/conflict/queue pipeline with normal Ctrl copy/Shift move/default same-volume move rules. Bar drop opens via planOpen; group drop additionally assigns new tabs through09b. Never convert folder drop into an editor insertion silently. Unknown files keep normal Windows-default behavior.
- D4. File target advertises accepted payload kinds/actions only through E2. If one action is eligible, show that action before drop; if several, show a translated choice menu before mutation. No compatible target means no-drop. Same-document move is not implemented unless adapter advertises a single atomic edit transaction; otherwise copy only. Readonly/protected views cannot accept mutations.
- D5. Transfer is snapshot-based. Capture source revision once; later source edits never alter its payload. Text max1Mi Unicode scalar values; rich blocks max10,000/8MiB; cells max100,000/8MiB,2000columns; files max1000 validated sources; image/PDF byte data travels only through08a snapshots/adpfile. Total active transfer leases32, combined256MiB, TTL60s extended by target lease, max5min. Sensitive payloads remain memory-only and cannot enter OS clipboard/history or an ordinary target without explicit safe-copy disclosure.
- D6. Rich text is an allowlisted typed tree, never HTML: paragraphs/headings/list items with text runs and bounded marks, no script/link execution. Tables preserve typed cell values and supported formatting; formulas are inert text in content-transfer-1; no formula execution paste action is registered. Unsupported formatting is reported before insertion, not silently discarded.
- D7. PDF-page transfer references one immutable PDF snapshot and a sorted, deduplicated1-based page list max100. Targets can accept editable pages or rendered images as distinct actions. Image coordinates are source-oriented pixels after EXIF orientation, with optional alpha; referencemime is validated against snapshot bytes by target/helper.
- D8. One accepted insertion equals one target-document edit/history transaction and one revision increment. The target remains unchanged if validation, permission, materialization or commit fails. Transfer token is released after target commit/cancel; source edit state is never discarded by copying.
- D9. Single instance uses a named mutex and named pipe scoped to the current Windows user SID, not a TCP port. ACL permits current SID and SYSTEM only; reject remote clients and mismatched client SID. Pipe length-prefixed UTF8 request max768KiB,16queued requests,256paths/request; timeout3s; ack means queued, not opened. No file bytes/passwords/commands in the message. Main publishes ready only after listeners exist; initial and later activation use the same bounded queue.
- D10. Parse only absolute file arguments and the literal end-of-options delimiter; reject other switches rather than forwarding them to ShellExecute. Helper flags are handled before instance arbitration and cannot be supplied through the activation pipe. A second instance exits only after ack; on timeout it shows translated activation error, not a duplicate editing window.
- D11. Every path is revalidated in native code and opened through planOpen with protected view/defaults. Focus/foreground request obeys Windows restrictions; failure flashes taskbar rather than stealing arbitrary focus. No elevation, registration or installation here.

## Uses from other steps

| ID | Producer/task; canonical export | Exact consumption |
|---|---|---|
| U1 | 09a T2/E3/E4 `src/documents/types.ts`, DocumentRegistry | DocumentHandle id/source/info/getState/captureSnapshot, one09a controller binding owns the mutable edit model; document revision and sensitive policy remain authoritative |
| U2 | 08a T3/E4/E5 `src/services/exportSnapshots.ts`, native ExportSnapshots | ExportSnapshot snapshot_id/document_id/revision/mime/byte_len/source/storage_policy; hold native lease through insertion; release once. No current-source reread |
| U3 | 09a T3/E1/E2 and09b T2/E1/E2 | TabsState and exact group reducers; activation/reordering and group assignment are separate transactions from file copy |
| U4 | 03b `src/services/fileops.ts` transfer wrappers, existing drag service | Reuse conflict policy merge/skip/keepBoth, OpProgress/OpReport, main-window target validation. No Replace capability inferred |
| U5 | 04a `src/handlers/openPipeline.ts`: planOpen(path,registry,openWith)->Promise<OpenDecision> | All Windows/bar/group file opens and activation paths follow this decision, not direct handler invocation |
| U6 | 06a unsaved coordinator,09a TabHistory, existing command/ribbon registries | Mutation/close decisions await completion; duplicate views share document, each has independent selection |

## Types and exact exports

Canonical transfer DTOs `src/transfer/types.ts`, native mirror `src-tauri/src/transfer_types.rs`; registry `src/transfer/TransferRegistry.ts`. Tags use `kind`, fields snake_case except existing host APIs.

| Type | Exact fields and validation |
|---|---|
| TransferKind | text/rich_text/cells/image/pdf_pages/files |
| TransferMark | bold/italic/underline/strike/code plus optional foreground_rgba fouru8; no CSS/URLs |
| TransferTextRun | text string; marks TransferMark[]max8; totaltext limitD5 |
| TransferBlock | kind paragraph/heading/list_item; runs TransferTextRun[]max1000; level optional1-6; list_order optional ordered/unordered; depth integer0-8 |
| TransferCell | kind text/number/boolean/blank; text optionalstring<=32767UTF16; number optionalfinitef64; boolean optionalbool; format optional number_format string<=128,bold bool,italic bool,foreground_rgba/background_rgba fouru8. Exactly matching value field; no executable formulas |
| TransferPayload | tagged text {text}; rich_text {blocks}; cells {rows TransferCell[][],row_count,column_count}; image {snapshot ExportSnapshot,width u32,height u32}; pdf_pages {snapshot ExportSnapshot,pages u32[]}; files {sources DocumentRef[]}. Source info is envelope, not duplicated in each variant |
| TransferEnvelope | transfer_id UUID; source_document_id optionalUUID; source_revision optional safeu64; sensitive bool; payload TransferPayload; expires_unix safeu64; optional source_tab_id string<=128. Native registry verifies metadata, never trusts caller sensitive=false |
| TransferAction | id insert_text/insert_rich_text/insert_cells/insert_image/insert_pdf_pages/insert_page_images/add_layers/add_clips/attach_files/open_files/copy_files/move_files; label_key fulltranslationkey; losses string[] stable translated loss keys; mutates bool |
| TransferTarget | target_id string<=128; document_id optionalUUID; accepted_kinds readonly TransferKind[]; describe(envelope TransferEnvelope)->readonly TransferAction[]; accept(envelope,actionId string)->Promise<TransferReceipt> |
| TransferReceipt | transaction_id UUID; target_document_id optionalUUID; revision optional safeu64; inserted_count u32; losses string[]; complete booltrueonlyatomiccommit; no rawbytes |
| TransferChoiceProps | envelope TransferEnvelope; actions readonly TransferAction[]; onChoose(actionId)->Promise<void>; onCancel()->void; no mutation before onChoose |
| ActivationRequest | version integer1; request_id UUID; paths string[]1-256 absolute<=32768UTF16; working_directory omitted; sent_unix safeu64; no flags |
| ActivationAck | request_id UUID; accepted bool; error optional activation.invalid/activation.busy/activation.denied/activation.timeout |

| ID | Exact export | Signature/ownership/consumers |
|---|---|---|
| E1 | services/contentTransfer.ts createTransfer/getTransfer/releaseTransfer | createTransfer(sourceDocumentId string|null,payload TransferPayload)->Promise<TransferEnvelope>; getTransfer(id string)->Promise<TransferEnvelope>; releaseTransfer(id)->Promise<void> idempotent. Native transfer_create/get/release; source authorization and aggregate caps enforced natively |
| E2 | TransferRegistry | register(target TransferTarget)->unsubscribecallback; get(targetId)->TransferTarget|null; describe(targetId,envelope)->readonly TransferAction[]; accept(targetId,envelope,actionId)->Promise<TransferReceipt>. One registration/target, revalidate at accept; target disposed unregistration cancels pendingaccept |
| E3 | `src/transfer/useTabDropTarget.ts` useTabDropTarget | props target_id string,tab_id string,hover_ms number,active bool,onActivate(tabId)->void,onDropFiles(paths readonly string[])->Promise<void>; returns onDragEnter/onDragOver/onDragLeave/onDrop React drag handlers and hover state. No private App variable |
| E4 | services/activation.ts onOpenRequest/activationReady | onOpenRequest(listener(request ActivationRequest)->void)->Promise<UnlistenFn>; activationReady()->Promise<ActivationRequest[]> atomically installs ready/drains queue. Event activation-open; callers deduplicate request_id bounded256lastIDs/10min |
| E5 | `src/transfer/TransferChoiceDialog.tsx` | TransferChoiceProps;400px Dialog, role listbox/options, translated losses and explicit confirmation, cancel restores drag/copy source focus |
| E6 | native activation.rs validate_activation/process_activation | validate_activation(bytes &[u8])->Result<ActivationRequest,String>; process_activation(request,queue &ActivationQueue)->Result<ActivationAck,String>; no filesystem open in parser/pipe thread |

All Tauri commands use ensure_main and strict length/type/path validation; new IPC names transfer_create,transfer_get,transfer_release,activation_ready. Payload bytes stay protocol snapshots. Errors transfer.invalid,too_large,expired,unsupported,read_only,changed,sensitive,failed map to keys below. Add only exact verified Windows feature flags to shared manifest through coordinator.

## Texts and UI

| Key | English | Spanish |
|---|---|---|
| transfer.choose / transfer.dropHere / transfer.noTarget | Choose how to insert / Drop to insert / This tab cannot accept this content. | Elige cómo insertar / Suelta para insertar / Esta pestaña no puede aceptar este contenido. |
| transfer.insertText / transfer.insertRich / transfer.insertCells / transfer.insertImage | Insert text / Insert formatted text / Insert cells / Insert image | Insertar texto / Insertar texto con formato / Insertar celdas / Insertar imagen |
| transfer.insertPages / transfer.insertPageImages / transfer.layers / transfer.clips / transfer.attach | Insert PDF pages / Insert page images / Add as layers / Add as clips / Attach files | Insertar páginas PDF / Insertar imágenes de páginas / Agregar como capas / Agregar como clips / Adjuntar archivos |
| transfer.open / transfer.copy / transfer.move | Open files / Copy files / Move files | Abrir archivos / Copiar archivos / Mover archivos |
| transfer.lossFormatting / transfer.lossFormula | Some formatting will not be kept. / Formulas will be inserted as text. | No se conservará parte del formato. / Las fórmulas se insertarán como texto. |
| transfer.sensitiveCopy | This creates an unencrypted copy outside the locked folder. Continue? | Esto crea una copia sin cifrar fuera de la carpeta bloqueada. ¿Continuar? |
| settings.dragHover / settings.dragHoverMs | Switch tabs while dragging / Hover delay (milliseconds) | Cambiar pestañas al arrastrar / Demora al mantener el cursor (milisegundos) |
| errors.transfer.invalid / errors.transfer.too_large / errors.transfer.expired | This content transfer is not valid. / This content exceeds the transfer limit. / This copied content is no longer available. | Esta transferencia de contenido no es válida. / Este contenido supera el límite de transferencia. / Este contenido copiado ya no está disponible. |
| errors.transfer.unsupported / errors.transfer.read_only / errors.transfer.changed | This tab does not support that insertion. / Enable editing before inserting content. / The document changed. Try the insertion again. | Esta pestaña no admite esa inserción. / Habilita la edición antes de insertar contenido. / El documento cambió. Vuelve a intentar la inserción. |
| errors.transfer.sensitive / errors.transfer.failed | This route cannot protect locked-folder content. / The content could not be inserted. | Esta ruta no puede proteger el contenido de una carpeta bloqueada. / No se pudo insertar el contenido. |
| errors.activation.invalid / errors.activation.busy / errors.activation.denied / errors.activation.timeout | These file-opening arguments are not valid. / Too many files are waiting to open. / This opening request is not allowed. / The running app did not answer. Try again. | Estos argumentos para abrir archivos no son válidos. / Hay demasiados archivos esperando para abrirse. / Esta solicitud de apertura no está permitida. / La aplicación abierta no respondió. Vuelve a intentarlo. |

Transient drop overlay uses inset2px accent outline and label on pane token; pointer-events none; no timed animation/reduced-motion exception. Choice Dialog width400px, rows36px, named actions; Esc cancels; never traps native drag indefinitely. No new global shortcuts. Copy/paste uses existing editor focus scope; Ctrl+C/V must not steal text input or OS accessibility commands.

## Tasks

| Task/commit | Exact owned files and work; dependencies | Required tests and oracle |
|---|---|---|
| T1 `feat(transfer): bounded content payload contracts [step-09c/T1]` | transfer/types.ts,transferValidation.ts;transfer_types.rs,transfer_validation.rs. U1/U2; all DTO/limits; secret policy comes from native source | transferValidation.test.ts: `refuses_html_and_unknown_action`; `rejects_nonfinite_cells`; `snapshot_revision_is_immutable`; native `sensitive_cannot_be_downgraded` |
| T2 `feat(transfer): leased content registry [step-09c/T2]` | contentTransfer.ts,content_transfer.rs,transfer_leases.rs. U1/U2; TTL/aggregate budgets/cancel | `thirty_third_lease_refused`; `expired_token_rejected`; `last_release_drops_snapshot`; `cancel_keeps_source_and_target_unchanged`; native forgedtoken denied |
| T3 `feat(transfer): target negotiation and atomic insertion [step-09c/T3]` | TransferRegistry.ts,TransferChoiceDialog.tsx,useContentPaste.ts,styles/transfer.css. U1/U6/E1; static text/PDF viewer copy adapters, mutation onlyexistingtexteditor whereproven | transferRegistry.test.ts: readonly noactions; ambiguity asks; revisionchangefailswithoutedit; supportedrichpaste oneUndo/oneRevision; disposer cancels pendingaccept |
| T4 `feat(tabs): hover activation and typed drop routing [step-09c/T4]` | useTabDropTarget.ts,tabDropRouting.ts; coordinator TabStrip/groups/folders/shared schema21. U3/U4/U5 | tabDrop.test.tsx:599ms noactivate/600ms activate;leavecancel;barplanOpen;groupmembership;folderdelegatesfileops; malformedMIMEneverauthorizespath |
| T5 `feat(shell): user-scoped single instance activation [step-09c/T5]` | activation.rs,activation_pipe.rs,activation_security.rs,activation.ts; coordinator entrydispatch/eventwiring. U5 | native activation_tests: wrongSID/remote denied;768KiB+1 rejected;17thqueuedbusy;helperflagrejected;sameUUIDhandledonce;initialrequestbeforeUIreadyretained |
| T6 `docs(help): cross-tab content and Windows opening [step-09c/T6]` | sixhelppagesbelow; coordinator translations/commandhelp/measurements/shots. U1-U6 | bilingualkeys/help;copyintextinputunchanged;pendingclosedtargetnotcalled; usersensitivewarningrequired |

Tests go in `src/__tests__/{transferValidation,contentTransfer,transferRegistry,tabDrop,activation}.test.ts(x)` and native module tests; helper/read-path safety also requires coordinator-run integration fixtures, not mocks alone. No synthetic success stub for editors arriving later; they register E2 when implemented.

## Full help

`dragging-between-tabs.md`, English **Dragging between tabs**: “Move between views while holding a file drag.” How to use: “Hold files over a tab until it opens. Drop on a folder to use the normal copy or move action. Drop on the tab bar to open files, or on a group to open them there.” Good to know: “A file editor accepts only supported insertions. If several actions are possible, choose one before anything changes. Change the hover delay in Settings.” See also: “Copying content between tabs” and “Tab groups”. Spanish **Arrastrar entre pestañas**: “Cambia de vista mientras arrastras archivos.” Cómo usar: “Mantén los archivos sobre una pestaña hasta que se abra. Suéltalos en una carpeta para usar la copia o el movimiento normal. Suéltalos en la barra de pestañas para abrirlos o en un grupo para abrirlos allí.” Para tener en cuenta: “Un editor acepta solo inserciones compatibles. Si hay varias acciones posibles, elige una antes de cambiar el contenido. Cambia la demora en Configuración.” Consulta también: «Copiar contenido entre pestañas» y «Grupos de pestañas».

`copying-content-between-tabs.md`, English **Copying content between tabs**: “Reuse supported text, cells, images and pages in another editor.” How to use: “Copy or drag a selection, activate the destination and paste or drop it. Choose an insertion if asked. Review any formatting changes.” Good to know: “Copying captures the selected revision and does not change the source. Protected views cannot accept edits. Content from locked folders needs an explicit decision before an unencrypted copy can leave the folder.” See also: “Dragging between tabs” and “Locked folders”. Spanish **Copiar contenido entre pestañas**: “Reutiliza texto, celdas, imágenes y páginas compatibles en otro editor.” Cómo usar: “Copia o arrastra una selección, activa el destino y pégala o suéltala. Elige una inserción si se te pide. Revisa los cambios de formato.” Para tener en cuenta: “Copiar captura la revisión seleccionada y no cambia el origen. Las vistas protegidas no aceptan cambios. El contenido de carpetas bloqueadas necesita una decisión explícita antes de crear una copia sin cifrar fuera de la carpeta.” Consulta también: «Arrastrar entre pestañas» y «Carpetas bloqueadas».

`opening-files-from-windows.md`, English **Opening files from Windows**: “Open supported files in the Adperastra window already running.” How to use: “Choose Adperastra in Windows **Open with**. The app checks the files and opens tabs using your normal opening preferences.” Good to know: “This does not change your default apps. Registration options arrive with Windows integration. A refused or busy request does not change files.” See also: “Opening files” and “Default apps”. Spanish **Abrir archivos desde Windows**: “Abre archivos compatibles en la ventana de Adperastra que ya está abierta.” Cómo usar: “Elige Adperastra en **Abrir con** de Windows. La aplicación comprueba los archivos y abre pestañas con tus preferencias normales.” Para tener en cuenta: “Esto no cambia tus aplicaciones predeterminadas. Las opciones de registro llegan con la integración de Windows. Una solicitud rechazada u ocupada no modifica archivos.” Consulta también: «Abrir archivos» y «Aplicaciones predeterminadas».

## Reviewer fixtures, measurements and acceptance

Retain two folders containing UTF8a.txt “alpha”,b.txt “beta”;2x2RGBA PNG;2page syntheticPDF; cells with text0001,number1.5,blank,booleantrue and literal=1+1. Expected pasted text/formula inert, exactsourcehashes unchanged. Exercise realWindows secondinstance/pipewrongclient tests,600mshover,cancel/targetclose,sensitivepolicy and bilingualkeyboardroutes. No owner registration/install needed for plan authoring.

Measure step09c.drag.hover overhead Instant<100ms after configured delay; step09c.paste.small Instant; firstactivationview Fast<1s with skeleton. Screenshots: reserve95-tab-drop and96-content-choice, en/light/es/dark/pseudo. Done: exact typed payloads and lifetimes, no unknown editor APIs, no OS command injection or double opens; coordinator gate/package/security/UI/speed evidence recorded before promotion.
