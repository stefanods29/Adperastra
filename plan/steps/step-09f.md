# Step 09f: Transfer controls, conflict review and verification

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started; Replace remains gated |
| Difficulty | 5/5 |
| Branch | step-09f-transfer-controls |
| Tag | v0.1.6-step09f |
| Depends on | 03b fileops/history;06e owned_io;07a SourceStamp;09c folder drop routing |
| Written before | 07a was built |
| Interface revision | transfer-jobs-1; replace-capability-0 |

Workers write source/tests, never execute checks. Coordinator applies shared changes, runs real filesystem/race/cancel tests and all release checks. This guide deliberately fixes Replace as unavailable: no coding worker may invent a path-check workaround.

## Goal and boundary

Every copy/move uses one controlled queue with pause/resume, current-file skip/retry, speed/ETA, optional disk-readback verification, side-by-side conflicts and a paged report. Existing data is kept. Replace/Replace-if-newer stay disabled until an independently reviewed object-bound recycle-first protocol exists. This is a documented scope correction to v1, not completed Replace support; milestone acceptance must retain this limitation. Changing R-SAFE to permit another replacement protocol requires an owner decision, but independent work here continues.

## Read first / uses

| ID | Producer/task and exact file/symbol | Contract used |
|---|---|---|
| U1 | 03b `src/services/fileops.ts`: ConflictPolicy merge/skip/keepBoth;OpProgress,OpReport,RunningJob;startFileJob(kind,sources,options)->Promise<RunningJob> | RunningJob.completion resolves OpReport. Do not invent OpResult or silently add Replace to UI union |
| U2 | `crates/fs-service/src/ops.rs` and transfer.rs: TransferEffect/TransferKind/apply_transfer;native transfer_history.rs TransferHistory.reserve/finish | Existing effects store paths and source_removed/destination_created only, not object identity or immutable bytes. Extend receipt fields here, never claim current Redo is snapshot restoration |
| U3 | 06e owned_io: PinnedDirectory::open,PinnedSource::open/file/verify_after_read,OwnedOutput::create/file_mut/flush_sync/publish_name/close;ClosedOutput::publish_to/dispose | New destinations written to owned staging/no-replace, never predictable partials or pathcleanup. SourceIdentity seconds are not07a fullprecision SourceStamp |
| U4 | 07a E3 SourceStamp/CacheService.source_stamp;07bmetadata/thumbnail;07a FileThumbnail | Conflict previews are readonly/policybound, cancellation releasesleases; no backgroundcloudhydration |
| U5 | 06d jobs.rs/services/jobs.ts shared Jobs/runJob/JobHandle.completion | New transfer jobs use shared start/poll/cancel; legacy file_op_start/poll/cancel become compatibilitydelegates, not second executionengine |
| U6 | 09c U4/E3 folderdrops; existing copy/paste/keyboard/filedialogs/JobsPanel | All copy/move entrypoints route one coordinator; preserveexistingriskconfirmations/globalUndo |

Read mapped v1 09c copy/conflict paragraphs, R-SAFE/R-FS, fullowned_io/source/save, transfer_history, existing fileopsExecution/fileopsUndo tests. Native Windows feature additions verified against0.61.3 source before install; no new thirdparty runtime library besides existing blake3.

## Decisions and algorithms

1. Native TransferCoordinator owns max32 registered jobs, one executing per destination volume, at most2 global transfers. Queue FIFO within volume; job entry exists before start acknowledgment. Queued jobs show queued and reserve bounded history/report capacity before mutation. Network destination volume keys use canonical server/share; unknown identity gets exclusive fallback key, never parallel guesses.
2. Snapshot source list/attributes/fullstamp after explicit userrequest; max10,000top-level sources,500,000enumerated items/depth256, historybudgetexisting32MiB/plan128MiBtotal. Do not follow reparsepoints/loops. Cloudplaceholder policy: enumeration may inspect attributes, opening requested source may hydrate only after user confirmation listing affected files; background conflict preview neverhydrates.
3. Copy from PinnedSource guarded handle in1MiBchunks into exclusively owned staging. Check cancel/pause/skip between chunks at<=100ms; pause retains guardedhandles/staging and uses condvar wait, no busy-spin/no duplicatewrite. Resume continues same offsets after identity verification. Cancel disposes only owned incomplete output, retains/reportcompletedoutputs and sources. Same-volume move uses object-bound handle rename/no-replace; crossvolume removes exactsource only after complete size/hashverifiedcopy via existing verified_remove pattern audited by coordinator.
4. Verification defaultoff; setting transfers.verify_copies boolfalse, transfers.queue_per_volume booltrue fixed safetysetting (cannot turn off volume serialization), transfers.max_parallel u8/number1-2default2; schema22 -> 23. With verification, computeBLAKE3source duringcopy, flushoutput, seek/readback from ownedoutputhandle, comparefullhash andexactlength beforepublish. Add E6 readbackhelper instead of reopening an uncontrolled path. Move requires size verification regardlessofhashsetting.
5. Progress carriesitems/bytes including actualcopied bytes; speed EWMA from last5seconds excludingpaused/queuedtime, update4Hz; ETA ceil(remainingbytes/speed) onlyafter>=1second andpositiveknownrate; otherwise null. On skippeditem adjustremainingknownbytes andrecord; no negative progress/false100%. Completed files not recopied byretry.
6. Conflict records include source/targetSourceStamp,kind,size,modified and readonlythumbnailstatus. Decisions skip/keepBoth/merge;mergefolderonly, never replacechildfiles. Apply-to-all scoped sameconflictkind withinthisjob; revalidateeverycandidatebeforemutation. KeepBoth searchescurrent canonicalnamingrules atomicallyup to10,000; collisionrace choosesnextname without overwriting.
7. Replace capability fixedfalse; requesting replace or replace_if_newer returns ops.replace_unavailable beforeversionhook/recycle/stagingwrite. UI shows disabledactionswithreason. Comparingmtime alone neverauthorizesReplace. IFileOperation PostDeleteItem gives an exact recycled-item receipt but its DeleteItem does not establish handle-bound deletion; do not claim that it closes the race. Existing SaveasReplace/conversionover/cleaninplace remain unavailable.
8. Per-file read/access/inuse/ioerror pauses thatitem in awaiting_decision, offersRetry/Skip/Cancel. Other volume jobs maycontinue. Retry3attemptsmaximumperitem, userexplicit; newsourceidentityrequiresrepreview/reconsent, notresumeoldauthorization. Skipactive disposesits ownedpartial, continuesnext; directories withpartialchildrenstay andreportactualeffects.
9. Extend TransferEffect with optional before_source/after_destination SourceStamp and verified_hash hexstring; oldeffectsdefaultNone retainlegacybehaviorandarelabelledunverifiedhistory. New Undo revalidates exactobjects beforeinverse; samevolumemovereverse usesownedhandles. CopyUndo recycling is not made race-safe merely byprecheck: if object-bound recycling cannotbeproved, do notexecute it; return ops.undo_unavailable withunchangedfiles/cursor. Redo cannotreadmodifiedsourcepretendingoriginalbytes; changedsourcefails ops.source_changed. No falsepromiseallnewcopyhistorycanalwaysrun.
10. Reports paged200effects/768KiB; native effects/history storedindependentlyfromUIpage. Actualpartialchangesremainjournalled/reviewableaftercancel; neverdropanunpolledreport. Longpathreports truncate displayonly, notnativepaths. Validate alljobIDs/decisionIDs againstcurrentrequestgeneration.

## Types / exports

Canonical `src/services/transferJobs.ts`, native `src-tauri/src/transfer_job_types.rs`; orchestration `src-tauri/src/transfer_control.rs`; source/owned-I/O primitives stay in fs-service. Allnativewirefieldssnake_case.

| Type | Exact fields/defaults |
|---|---|
| TransferRequest | kind copy/move;sources string[];expected_sources optional SourceStamp[] aligned one-to-one with sources;dest_dir string;conflict skip/keepBoth/merge defaultskip;verify booldefaultsetting;allow_system boolfalse;priority normal/foreground defaultnormal |
| TransferState | job_id string;state queued/running/paused/awaiting_conflict/awaiting_error/cancelling/done;progress OpProgress;bytes_per_second optionalfinitef64>=0;eta_seconds optional safeu64;current_item_id optionalUUID;decision optional TransferDecisionRequest;generation safeu64 |
| TransferDecisionRequest | decision_id UUID;item_id UUID;kind conflict/error;source_path string;target_path optionalstring;source/target optionalSourceStamp;source_kind/target_kind file/folder optional;error_code optionalstring;attempt u8;allowed skip/keepBoth/merge/retry/cancel array;replace_available fixedfalse |
| TransferDecision | decision_id UUID;generation safeu64;action skip/keepBoth/merge/retry/cancel;apply_to_all boolfalse; no replacevariant |
| TransferItemResult | item_id UUID;from string;to optionalstring;status done/skipped/failed/cancelled;reason optionalcode;bytes_written safeu64;verified bool;source_removed bool;destination_created bool |
| TransferReport | report_id UUID;transfer_id optionalstring;items TransferItemResult[]max200;next_cursor optionalUUID;done/skipped/failed u32;cancelled bool;job_finished bool;complete boolpagination;replace_available fixedfalse |
| TransferControl | action pause/resume/skip_current/cancel;expected_generation safeu64 |

| ID | Exact export | Signature/errors/consumers |
|---|---|---|
| E1 | transferJobs.ts startTransfer | (request TransferRequest,onProgress optionalcallback(OpProgress))->Promise<JobHandle<TransferReport>>; native transfer_start(request_id,request),sharedjobtransport.09c/09g/11c |
| E2 | same getTransferState/controlTransfer/decideTransfer | get(id)->Promise<TransferState>;control(id,control TransferControl)->Promise<TransferState>;decide(id,decision)->Promise<TransferState>; native transfer_state/transfer_control/transfer_decide. Fixedreturntype, validationbeforestatechange |
| E3 | same transferReportPage | (cursor string)->Promise<TransferReport>;native transfer_report_page;cursorjobbound5min, historyretentionseparate |
| E4 | `src/transfers/TransferWindow.tsx` | props jobId string,onClose()->void,onOpenHelp(slug)->void; pollingstate100msvisible/1sbackground,completionviaJobHandle;closingpaneldoesnotcanceljob |
| E5 | `src/transfers/ConflictDialog.tsx` | props request TransferDecisionRequest,onDecision(decision)->Promise<void>,onClose()->void; no filesystemnativecallsfromcomponent;generationkeptuntilawaiteddecisionack |
| E6 | owned_io/output.rs read_back_hash | OwnedOutput method read_back_hash(&mut self,token:&CancellationToken)->OwnedIoResult<[u8;32]>; create handlewithread/writeaccess, preserve currentwriteoffsetafterreadback; flushfirst; capreadtoownedlength, cancelchecks1MiB. Do not addsourcepathnameargument |
| E7 | src-tauri/src/transfer_control.rs TransferCoordinator | enqueue(id &str,request TransferRequest)->Result<(),TransferError>;control(id &str,control)->Result<TransferState,TransferError>;decide(id &str,decision)->Result<TransferState,TransferError>;state(id &str)->Result<TransferState,TransferError>;cancel_all()->unit; no diskI/Owhilemaplockheld |

TransferError stablecodes ops.invalid_request/queue_full/changed/source_changed/in_use/verify_failed/decision_stale/replace_unavailable/undo_unavailable/io/no_space/cancelled. AdditivelegacyOpReportadapterpopulatescompleted/skipped/created/transfer_idfromactualreceipts, neverfrompreview. Nativecommandseveryensure_main,absolute path/bound/enum/jobownerchecks; serviceargumentcamelCase/nestedstructsnake_case.

E8 canonical `src/services/fileIdentity.ts` subscribeIdentityEffects(listener:(events:readonlyIdentityEvent[])->void)->Promise<UnlistenFn>; native event identity-effects. FileIdentityKey comes from07a E9. IdentityEffect {operation_id UUID,sequence safeu64,kind copy/move/rename,from_key FileIdentityKey,from_path string,to_key FileIdentityKey,to_path string,complete true}. Emitonlyafteractualguardedcompletedmutation andcapturebothIDsfromownedhandles; never fabricatefrompathalone. IdentityEvent is tagged kind effect {effect:IdentityEffect} or overflow {last_sequence:safeu64}. Batches<=256/768KiB,monotonicsequence; overflow event kind overflow tellsstoresrescan/reconcile ratherthaninfermissingmoves. Legacyunproveneffects emitno migration;09e T4 emitsrenamereceipts;10d/11b subscribers compareoldidentity andupdateonlyexactmatchingrecords. T1 defines canonical effecttypes andlistener;T5 wiresactualeffects andtestsfailed/cancelledpartial/nonstable-IDmigrationrefusal.

### Expected source identity for reviewed proposals

E1 accepts TransferRequest.expected_sources, imported unchanged from07a. When present its length must equal sources.length, each stamp.path_key must identify the corresponding source, and native checks the full stamp against guarded source objects after the queue wait and before any mutation. Any mismatch returns ops.source_changed with no effects; a source list cannot be silently reordered after approval. A malformed or incomplete array is ops.invalid_request.17c organization proposals must supply this array from their reviewed native preview. Legacy manual callers may omit it, in which case the transfer creates and validates its own fresh native preview before mutation; omission never authorizes a stale AI preview. T1 adds expected_sources_length_and_order; T3 adds queued_source_replaced_has_no_effect and expected_sources_match_guarded_handle.

## UI / texts

TransferWindow640pxDialog,maxviewportminus32;activeitem36px,progress/speed/ETArow,Pause/Resume/Skip/Cancel,collapsibleproblemsvirtualrows28px; jobsremainaccessiblewhenwindowclosed. ConflictDialog840px,twoequalcolumnswith128pxpreviewandname/size/date;disabledReplace/newerwithreason; Skip/Keepboth/Merge/Applyall. Focusonlyoneinitialsafeaction,EscclosesreviewnotimpliesReplace. Formultipleconflictsreusedialogwithgeneration-keyedstate.

| Key | English | Spanish |
|---|---|---|
| transferJobs.title / transferJobs.queued / transferJobs.pause / transferJobs.resume / transferJobs.skip / transferJobs.retry | File transfer / Queued / Pause / Resume / Skip file / Retry file | Transferencia de archivos / En cola / Pausar / Reanudar / Omitir archivo / Reintentar archivo |
| transferJobs.speed / transferJobs.eta / transferJobs.unknownEta | {speed} per second / About {time} remaining / Calculating remaining time… | {speed} por segundo / Queda aproximadamente {time} / Calculando el tiempo restante… |
| transferJobs.verify / transferJobs.verified / transferJobs.problems | Verify copied files / Copy verified / Problems | Verificar archivos copiados / Copia verificada / Problemas |
| conflicts.title / conflicts.source / conflicts.target / conflicts.skip / conflicts.keepBoth / conflicts.merge | A name is already in use / Source / Destination / Skip / Keep both / Merge folders | Ya se usa este nombre / Origen / Destino / Omitir / Conservar ambos / Combinar carpetas |
| conflicts.replace / conflicts.replaceNewer / conflicts.applyAll / conflicts.replaceReason | Replace / Replace if newer / Do this for remaining conflicts of this kind / Replacing files is unavailable until it can protect the exact existing file. | Reemplazar / Reemplazar si es más reciente / Hacer esto con los conflictos restantes de este tipo / Reemplazar no está disponible hasta que se pueda proteger el archivo existente exacto. |
| errors.ops.queue_full / errors.ops.verify_failed / errors.ops.decision_stale | The transfer queue is full. / The copy did not match the source. Nothing was published for this file. / This conflict changed. Review it again. | La cola de transferencias está llena. / La copia no coincide con el origen. No se creó un resultado para este archivo. / Este conflicto cambió. Vuelve a revisarlo. |
| errors.ops.replace_unavailable / errors.ops.undo_unavailable / errors.ops.source_changed | Replacing this file is not available safely. Choose Keep both or Skip. / This action cannot be reversed safely now. Its files were kept. / The source changed. Review the transfer again. | No se puede reemplazar este archivo de forma segura. Elige Conservar ambos u Omitir. / Ahora no se puede revertir esta acción de forma segura. Se conservaron sus archivos. / El archivo de origen cambió. Revisa la transferencia de nuevo. |

Reuseexistingerrors.ops invalid_request/changed/in_use/io/no_space/cancelled ifexactkeyexists; coordinatoradds missingpairs: “These transfer options are not valid.”/“Estas opciones de transferencia no son válidas.”;“An item changed. Review it again.”/“Un elemento cambió. Vuelve a revisarlo.”;“The file is in use.”/“El archivo está en uso.”;“The transfer could not finish.”/“No se pudo terminar la transferencia.”;“There is not enough space.”/“No hay espacio suficiente.”;“The transfer was cancelled.”/“Se canceló la transferencia.”

## Tasks

| Task/commit | Files/work/imports | Required tests with oracle |
|---|---|---|
| T1 `feat(transfers): controlled queue contracts [step-09f/T1]` | transfer_job_types.rs,src-tauri/src/transfer_control.rs,transferJobs.ts;U1/U2/U5;defineDTOandreservebeforeack | transferQueue.test.ts/native:33rdqueuefails;2global/1volume;jobexistsonack;nohistoryreservationnomutation |
| T2 `feat(transfers): pause resume skip and retry [step-09f/T2]` | transfer_copy.rs/transfer_move.rs/transfer_decisions.rs;U2/U3/U5 | step09f_control_tests.rs:pause1MiBboundarynoadditionalbytes;resumesexactoffset;cancelownedpartialonly;skipretainscompleted;3retriescap;sourcechangeforcesrepreview |
| T3 `feat(transfers): readback verification and rate estimates [step-09f/T3]` | owned_io/output.rs,E6;transfer_verify.rs/transfer_rates.rs;schema23coordinator | step09f_verify_tests.rs:corruptedreadbacknopublish/sourcekept;emptyhashknown;pauseexcludedfromETA;rate0ETAnull;overflowcountsrefused |
| T4 `feat(transfers): generation-bound conflict decisions [step-09f/T4]` | transfer_conflicts.rs/conflict_policy.rs;U3/U4 | step09f_conflict_tests.rs:newforeignfilekept;foldermergekeepssame-namedchild;staledecisionnoeffect;replace/newerrequestrejectedbeforewrite/recycle |
| T5 `fix(transfers): validate history object identities [step-09f/T5]` | coordinatortransfer_history/TransferEffect/FileActioncompatibility;new transfer_history_validation.rs | changedsourceRedofails;changedtargetUndoexercisesfailclosed;unavailableobjectboundrecyclenevercalled;historycursorunchanged;actualpartialreportretained |
| T6 `feat(transfers): accessible transfer and conflict windows [step-09f/T6]` | TransferWindow.tsx,ConflictDialog.tsx,useTransferState.ts,styles/transfers.css;U4/U6/E1-E5 | transferUi.test.tsx:pause/resumekeyboard;closepaneldoesnotcancel;disabledReplaceexplained;staleasyncresponsenotcurrentdialog;Spanishlonglabelsfit |
| T7 `docs(help): copy controls and safe conflicts [step-09f/T7]` | fourhelpfilesbelow;coordinatorallentrypoints/pseudo/measurement/shots | oldcopy/paste/dropcallercontracttestsupdatedtooneengine;readonlyversionhooknotcalled;reportcursorsbounded |

## Full help

`copying-and-conflicts.md`, English **Copying and conflicts**: “Copy or move files while keeping control of long tasks.” How to use: “Start a copy or move and open its transfer window. Use **Pause**, **Resume**, **Skip file** or **Cancel**. When a name is already in use, compare both items and choose **Skip**, **Keep both**, or **Merge folders** when offered.” Good to know: “Completed files remain if you cancel. Replacing existing files is unavailable until the exact existing file can be protected. Undo can refuse if an item changed outside the app; it keeps the files instead of guessing.” See also: “Files in use” and “The job queue”. Spanish **Copias y conflictos**: “Copia o mueve archivos manteniendo el control de las tareas largas.” Cómo usar: “Inicia una copia o movimiento y abre su ventana. Usa **Pausar**, **Reanudar**, **Omitir archivo** o **Cancelar**. Si ya se usa un nombre, compara ambos elementos y elige **Omitir**, **Conservar ambos** o **Combinar carpetas** cuando se ofrezca.” Para tener en cuenta: “Los archivos terminados permanecen si cancelas. Reemplazar no está disponible hasta poder proteger el archivo existente exacto. Deshacer puede rechazarse si un elemento cambió fuera de la aplicación; se conservan los archivos.” Consulta también: «Archivos en uso» y «La cola de tareas».

`verifying-copies.md`, English **Verifying copies**: “Check copied bytes before publishing each file.” How to use: “Enable **Verify copied files** in transfer settings, then start a copy. The app reads the completed staged copy and compares its full hash with the source.” Good to know: “Verification adds disk reading time. A mismatch keeps the original and does not publish that result. Cross-drive moves always check the copy size before removing the source.” See also: “Copying and conflicts” and “The job queue”. Spanish **Verificar copias**: “Comprueba los bytes copiados antes de publicar cada archivo.” Cómo usar: “Activa **Verificar archivos copiados** en las opciones de transferencia e inicia una copia. La aplicación lee la copia temporal completa y compara su hash con el origen.” Para tener en cuenta: “La verificación necesita tiempo adicional de lectura. Si no coincide, se conserva el original y no se crea ese resultado. Los movimientos entre unidades siempre comprueban el tamaño de la copia antes de quitar el origen.” Consulta también: «Copias y conflictos» y «La cola de tareas».

## Reviewer fixtures, speed, screenshots and done

Retain source/destinationfolderswithsame-namefilesdifferentknownbytes/dates,mergedsubfolders,emptyfile,synthetic256MiBfile,denied/inuse/disappearingdrivecases;corruptreadbackadapterfixture;concurrentforeignnamewriter. Checkpause/resume/hash/skip/retry/cancel/queue/conflicts/Undochangedobjects andunchangedforeignhashes;neverclaimReplacepassed. CoordinatorrunsrealWindowshandleguardtests,200%zoom/keyboard/esdark/pseudo.

Measures step09f.transfer.controls andconflict.open Instant<100ms;progress/cancelack<=250ms,exceptOSblockedI/Oexplicitreport; sustainedcopythroughput measuredvsbaselineand20%regressionrule. Shots101-copy-window,102-conflict-window,103-transfer-report,threevariants. Done: fullindependentfunctionalityverified,Replacecapabilityfalseandlimitationrecorded,allcross-stepconsumersexact;noBlocker/MajorhiddenbyUIcompletion. No releaseclaimincludesunimplementedReplace.
