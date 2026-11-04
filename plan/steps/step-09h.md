# Step 09h: Recovery, safe mode and local diagnostics

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 4/5 |
| Branch | step-09h-recovery-diagnostics |
| Tag | v0.1.8-step09h |
| Depends on | 09a shared-document/session-2;09b groups;08a snapshots;06e archive output |
| Written before | 07a was built |
| Interface revision | recovery-1; diagnostics-1 |

Guide only. Workers write code/tests/help; coordinator runs all verification, forced-crash fixtures, packaging and measurements. No diagnostics are sent to anyone; the owner chooses whether to save/attach them later.

## Goal / exclusions

Keep Explorer running if one tab fails, recover eligible unsaved revisions after a crash, start safely after repeated startup failures and save a reviewed/redacted diagnostic ZIP. No crash telemetry/upload, automatic issue submission, plaintext locked-document recovery, private keys, credentials, full-memory dumps by default or silent replacement of originals.

## Read first / uses

| ID | Producer/task; exact canonical symbol | Contract |
|---|---|---|
| U1 | 09a T2 `documents/controller.ts` DocumentControllerBinding/Context and DocumentState | capture immutable encoded current revision/content_id; dirty is contentidentity-based; no originalbytesreadRange substitution |
| U2 | 08a E4/E5 exportSnapshots/ExportSnapshots | ExportSnapshot with content_id; boundedleases/storage_policy; sensitive snapshots never diskspool |
| U3 | 09a E5 loadSession/saveSession via native get_session/save_session;09b defaultedgroupmetadata;09i later defaultedsplitmetadata | Restore descriptors normally; revision/rootcodec validation; no restoration oflive tokens/passwords |
| U4 | 06e archive::create_spool; owned_io output; existing protocol | ZIP uses owned staging/no-replace; diagnostics files are app-owned synthetic entries, not arbitrary userpaths |
| U5 | 08d publicversion/release URLs; existinglogging | Diagnostics version info from build; fixed repository issue URL; no signing/private-keypathsread |
| U6 | 09e journal recovery metadata | Surface unfinished rename-journals as recovery_required; neverdelete/rename userintermediatesmerelybecausejournalexists |

Read v1 09c crash/report/safe-modeparagraphs; full09a; actualApp/FileTabView/errorhandling/bootstrap/settingsload/helper; addcommand/help/Windowsfeature recipes. Windows DPAPI CryptProtectData/CryptUnprotectData use existingwindows0.61.3 Win32_Security_Cryptography and Win32_Foundation,verifiedlocal source beforewiring; nohomemadeencryption.

## Decisions and algorithm

1. React error boundary per file/folder content view shows localized failure/Reload/Close; tabstrip/Explorerrootremainoutside. Reload disposes crashedviewresources and reopens throughnormalpipeline afterdirty/recoverydecision. Helperexit is a typedviewerror, notprocesscrash. Boundary logs a sanitizedcomponentcode/stackmax16KiB, notfilecontents.
2. Dirty ordinary documents register a recovery capture through U1; debounce2s afteredit, atmostonce10s/document, onecaptureglobally; cleanorunchangedcontentIDdoesnotrewrite. Max64MiB encoded snapshot/document,32documents,1GiB totalincludingpending; reserve beforecapture. Larger/currentlyunsupportedmodel shows translatedRecoveryunavailable warningwithmanualSavecopy, neverpretendsautosaved.
3. Recovery store `<data>/recovery/` is encrypted atrest by currentuserDPAPI, UI-forbidden CryptProtectData flag; versioned envelope below. Sensitive/unlocked-container documents never enter this store:09k encryptedprovider owns recovery ormemoryonly; appclearlysaysnotrecoverableafterprocessclose. Recovery UI decrypts only bounded authenticated metadata; listing never decrypts content payloads.
4. Capture creates immutablemetadata+encodedbytes, DPAPI protects separate metadata<=64KiB and content<=64MiB blobs, then ownedatomicappstatepublication of ciphertext andcatalogrow; flushciphertextbeforecatalog. Boundedhelper1GiB/30s forprotection/parsing, pipelineinputmemorystaysbounded. Delete/evictonlyowned recoveryrecordsafteruserDiscard orverifiedcleanmodelandretentionrules; unfinishedrecordcannotdisplaceothercurrentdirtyrecord. Seven-dayretentionforcleanclosedrecords; keepdirtypendinguserdecision.
5. Onuncleanexitstartup, showRecoverdialogbeforeopeningoriginals: listnames/originallocationsfromDPAPIprotectedmetadata, timestamp/revision,status. Actions Open recovered copy/Discard/Keep for later. Noautomaticoverwrite. Open recovered copy is explicitauthorization towrite a new app-owned plaintextcopyunder<data>/recovery-open/<UUID>/<validatedname> throughownedno-replace; setoriginalMOTW/protectedflags, thennormalopenpipeline. Showwhereitwaswritten; originalsremainunchanged. Storagecap1GiB; cleanup requiresclose+noactivegrants, noSSDsecure-deleteclaims.
6. Catalog stores only opaque IDs/times/lengths. Plain envelope ADPREC1/version1/recordUUID/metadata_cipher_lengthu32/content_cipher_lengthu64; two DPAPIblobs followexactlengths. Authenticatedmetadata repeatsversion/recordUUID/documentUUID/revision/content_id,originalpath/name/securityflags,encodedlengthandSHA256ofplaintextcontentANDciphertextcontent. Authenticatedcontentprefix repeatsrecordUUID/documentUUID/revision/content_id,length andhashbeforeexactencodedbytes. Matchbothpayloadidentities/hashesonOpen,notonUIlisting. Decryptonlymetadataforrecoverylist; contentonlyafterexplicitOpen. Refuse trailing/truncateddata/mismatchedIDs/newerschema. No customcipher/KDF. One successful Open doesnotdeleteencryptedoriginalrecord.

7. Startup marker records launchUUID/starttime/state starting/ready/clean; atomicwrites. Three unclean startswithin5min trigger safe mode; readyafter30sresponsiveUI, cleanonlyafterunsavedcloseaccepted. Safemodeusesdefaultsettingsinmemory, packs/backgroundautohelpersdisabled, originalsettings/session/catalogremainread-onlyuntiluserchoosesexplicitrestore/reset. Restart normallybuttondoesnotdeleteevidence. Repeatedcrashcounterneverhidesoriginaldata.
8. RecoverySettings schema24 -> 25: enabled booltrue,interval_seconds u1610default range10-300;max_mib u321024range128-4096, butperrecord64MiBfixed;diagnosticsinclude_dumps boolfalse. Nonrecoverablemodelsreportedperdocument; usersmayturnoffwithplainwarning, no testweakening.
9. Diagnostic sessions max4/5min/64MiBaggregate; gatheronlyappversion,Windowsversion,CPUmodel/RAMamount,loadedfeature/packversions,knownissuecodes,recentlogs<=512KiB,totalplainreports<=4MiB. Nohostname/usernames/serials/filecontents/preferencespathsbydefault. Dump omitted; optionalminidump inclusion requiresseparateexplicitconfirmationandboundedfile<=32MiBwithwarningitmaycontainsensitiveinformation. Neverreadprivate.adperastradirectory.
10. Redactpaths/usernamesfromallowedtextsbydefaultwithper-reportstabletokens `<path-1>`, `<user-1>`; parseWindowsdrive/UNCpathsandknownusernameprefixes, maskalsoescapedJSONstrings. Do notclaimredactionperfect: usercanpreview/edit/removeeachfilebeforeZIPsave. Editabletextmax1MiB/file; validationpreventsZIPpathtraversal. Finalsaveisnewno-replaceZIP, max64MiB, nosilentupload.
11. OpenGitHubissuepageonlyonexplicitbuttonafterreview; URLfixed https://github.com/stefanods29/Adperastra/issues/new withencodedtitle/bodyappversion+issuecodes<=2KiB, no diagnosticscontent/paths/dumplinks. Shellopenuseractiononly; savingZIPneveropensnetworkautomatically.

### Compatibility with the existing06a draft service

Baseline already has `src/services/recovery.ts` and `src-tauri/src/recovery.rs`; do not overwrite or leave a second plaintext writer active. T1 reads their actual exported types/functions and preserves legacy service entrypoints as delegating wrappers over the new store. T2 removes06a plaintext draft-write scheduling from all editors and routes one capture through E3. At startup detectlegacy records without openingcontentautomatically: offer explicit Import old recovery or Keep for later, then encryptverifiedlegacybytesasnewrecords before markingoldownedrecordmigrated. Do not delete or silently reinterpret oldrecords; corrupted/foreignfilesremain. A service-level regressiontest invokes everyoldsaveentrypoint and assertsitcannotwriteplaintext. Exact baseline aliases: Draft {schema_version:number,path:string,text:string,saved_unix:number,file_modified_unix:number}; writeDraft(path:string,text:string,fileModifiedUnix:number)->Promise<void>; readDraft(path:string)->Promise<Draft|null>; deleteDraft(path:string)->Promise<void>. Keep these TS signatures as compatibility facades. writeDraft uses UTF8 encoded08a snapshot upload, thenE1 encryptedstorage; readDraft obtains authorized token/metadata then decodes boundedadpfile bytes to construct Draft, not rawfilebytesJSON; deleteDraft resolves only its authorizedrecord thenE2discard. Native oldrecovery_write/read/delete entrypoints are removed from handler/allowlist after allsourcecallersmigrate inT2, with exact IPC tests updated; no active plaintextpath remains. Legacy plaintextdata imported onlyafterexplicituserchoice/verifiedbytesandownedrecordidentity; do notdeleteforeign/uncertainoldrecords.

## Data and exports

Canonical UI `src/services/recovery.ts`, `src/services/diagnostics.ts`; native mirrors recovery_types.rs/diagnostics_types.rs. Allcommandsensure_main,validateeverypath/ID/size/enum,sharedjobsforlongwork.

| Type | Exact fields |
|---|---|
| RecoveryMetadata | version1;record_id UUID;document_id UUID;source DocumentRef;source_stamp optionalSourceStamp;name<=255;mime<=128;handler_id<=64;captured_revision safeu64;content_id UUID;captured_unix safeu64;byte_len<=64MiB;from_internet bool; sensitive mustfalse |
| RecoveryCandidate | record_id UUID;name string<=255;source_path optionalstring;captured_unix safeu64;revision safeu64;byte_len safeu64;status available/unsupported/corrupt;error_code optionalstring. MetadataonlyafterDPAPIauthorizedread |
| RecoveryListPage | items RecoveryCandidate[]max100;next_cursor optionalUUID;complete bool;unclean_exit bool;safe_mode bool |
| RecoveryOpenResult | record_id UUID;copy_path string;from_internet bool;recordretaineduntiluserdiscard; no originalreplacement |
| DiagnosticsFile | id UUID;relative_name safesinglepath<=128;kind text/dump;bytes safeu64;included bool;redacted bool;preview optionalstring<=1MiB |
| DiagnosticsSession | id UUID;files DiagnosticsFile[]max32;expires_unix safeu64;include_paths boolfalse;include_dumps boolfalse;nointernalownedabsoluteoutputpaths |
| DiagnosticEdit | file_id UUID;included bool;text optionalstring<=1MiB; dumpbytesnevereditableastext |
| SafeModeStatus | active bool;reason repeated_startup_failure/manual/none;failed_starts u8;settings_read_only bool |

| ID | Exact export | Signature/consumers |
|---|---|---|
| E1 | recovery.ts saveRecoverySnapshot | (snapshot ExportSnapshot,metadata RecoveryMetadata)->Promise<JobHandle<{record_id:string,captured_revision:number}>>;native recovery_save_start(request_id,snapshot_id,metadata). Onlycontroller-boundmetadataaccepted;futureeditorsregistersamecapture |
| E2 | same listRecovery/openRecoveredCopy/discardRecovery | list(cursor optionalstring)->Promise<RecoveryListPage>;open(id)->Promise<JobHandle<RecoveryOpenResult>>;discard(ids readonlystring[])->Promise<void>;native recovery_list/recovery_open_start/recovery_discard. Discardonlyrecovery,notoriginal |
| E3 | `src/documents/useRecoveryCapture.ts` useRecoveryCapture | (document DocumentHandle,options{enabled:boolean,interval_seconds:number},onWarning(code:string)->void)->void; lifecyclehooksubscribesdocumentstate,leasescapture,cleanupcancelsandrelease. Notoneautosavetimerperduplicateview: registryowneroneperdocument |
| E4 | diagnostics.ts createDiagnostics/editDiagnostics/saveDiagnostics/closeDiagnostics | create(options{include_dumps:boolean})->Promise<JobHandle<DiagnosticsSession>>;edit(sessionId,edits readonlyDiagnosticEdit[])->Promise<DiagnosticsSession>;save(sessionId,destPath)->Promise<JobHandle<{path:string,bytes:number}>>;close(id)->Promise<void>;native diagnostics_create_start/edit/save_start/close |
| E5 | diagnostics.ts openProblemPage | (title string<=128,issueCodes readonlystring[]max32)->Promise<void>;native diagnostics_open_issue(title,issue_codes),fixedhost/path,nonetworkuntilclick |
| E6 | recovery.ts safeModeStatus/restartNormally | status()->Promise<SafeModeStatus>;restartNormally()->Promise<void> firstawaitdirtydecision/coordinatorclose;native safe_mode_status/restart_normal, noautorestartloop |
| E7 | `src/recovery/RecoveryDialog.tsx`, `src/diagnostics/DiagnosticsDialog.tsx` | Recoveryprops items/loading/errorCode?,onOpen(id)->Promise<void>,onDiscard(ids)->Promise<void>,onLater()->void,onOpenHelp(slug)->void. Diagnosticsprops session,onEdit(edits)->Promise<void>,onSave()->Promise<void>,onOpenIssue()->Promise<void>,onClose()->void,onOpenHelp(slug)->void |

Errors recovery.invalid/too_large/unsupported/locked/corrupt/io/changed/cancelled;diagnostics.invalid/too_large/io/cancelled. TTLcleanupneverremovesinusefilesorforeignpaths;DPAPIfailurekeepsciphertextforreview,doesnotfallbackplaintext.

## Texts and layout

| Key | English | Spanish |
|---|---|---|
| recovery.title / recovery.open / recovery.discard / recovery.later | Recover unsaved work / Open recovered copy / Discard recovery / Keep for later | Recuperar trabajo sin guardar / Abrir copia recuperada / Descartar recuperación / Conservar para después |
| recovery.available / recovery.unavailable / recovery.sensitive | A saved recovery revision is available. / Recovery is unavailable for this document. Save a copy manually. / Locked-folder contents are not written to ordinary recovery storage. | Hay una revisión de recuperación disponible. / La recuperación no está disponible para este documento. Guarda una copia manualmente. / El contenido de carpetas bloqueadas no se guarda en la recuperación normal. |
| recovery.copyLocation / recovery.discardConfirm | Recovered copy: {path} / Discard this recovery revision? The original file will stay where it is. | Copia recuperada: {path} / ¿Descartar esta revisión de recuperación? El archivo original permanecerá donde está. |
| recovery.tabFailed / recovery.reload | This tab stopped working. Your other tabs can continue. / Reload tab | Esta pestaña dejó de funcionar. Las demás pueden continuar. / Volver a cargar pestaña |
| safeMode.banner / safeMode.restart | Safe mode is using temporary default settings and no packs. Your saved settings are kept. / Restart normally | El modo seguro usa valores temporales y ningún paquete. Se conserva tu configuración guardada. / Reiniciar normalmente |
| diagnostics.title / diagnostics.redact / diagnostics.dumps / diagnostics.save / diagnostics.issue / diagnostics.review | Report a problem / Mask paths and user names / Include a crash dump / Save diagnostics ZIP… / Open issue page / Review and edit these files before saving. Nothing is uploaded. | Informar un problema / Ocultar rutas y nombres de usuario / Incluir un volcado de error / Guardar ZIP de diagnóstico… / Abrir página de incidencias / Revisa y edita estos archivos antes de guardarlos. No se sube nada. |
| diagnostics.dumpWarning | A crash dump may contain file contents or other private information. Include it only after reviewing this choice. | Un volcado puede contener archivos u otra información privada. Inclúyelo solo después de revisar esta opción. |
| recovery.enabled / recovery.interval | Keep recovery revisions / Recovery interval (seconds) | Conservar revisiones de recuperación / Intervalo de recuperación (segundos) |

For each errorcodeaboveadd errors.<code>: recovery.invalid “This recovery record is not valid.”/“Este registro de recuperación no es válido.”;too_large “This document exceeds the recovery limit.”/“Este documento supera el límite de recuperación.”;unsupported “This document cannot be recovered here.”/“Este documento no se puede recuperar aquí.”;locked “Unlock the folder to use its recovery.”/“Desbloquea la carpeta para usar su recuperación.”;corrupt “This recovery record is damaged. It was kept for review.”/“Este registro está dañado. Se conservó para revisión.”;io “Recovery could not finish.”/“No se pudo terminar la recuperación.”;changed “The recovery source changed. Review it again.”/“El origen cambió. Revísalo de nuevo.”;cancelled “Recovery was cancelled.”/“Se canceló la recuperación.” Diagnosticsinvalid/too_large/io/cancelled use “These diagnostic options are not valid.”/“Estas opciones de diagnóstico no son válidas.”,“The diagnostics exceed the size limit.”/“El diagnóstico supera el límite de tamaño.”,“The diagnostics could not be saved.”/“No se pudo guardar el diagnóstico.”,“Diagnostics were cancelled.”/“Se canceló el diagnóstico.”

RecoveryDialog720px/rows56px, explicitselectedactions;DiagnosticsDialog960px leftfilelist240px/righteditabletextmin400px,maxheightviewportminus32,includecheckboxes/size/redactionstatus;safe-modebannerpane+statuscautiontokens,buttonpersistent;boundaryerrorrolealertbutnostackshown. Helpbuttons/F1/keyboard/focus/outsideclickdonotdiscard. Commands app.reportProblem labeldiagnostics.title iconBug helpreporting-a-problem;app.recovery labelrecovery.title iconHistory helprecovering-after-a-crash;risksread-only, noshortcuts.

## Tasks and tests

| Task/commit | Files and dependencies | Exact test requirements |
|---|---|---|
| T1 `feat(recovery): encrypted bounded recovery records [step-09h/T1]` | recovery_types.rs/recovery_store.rs/recovery_dpapi.rs/recovery.ts;U1/U2 | native wronguserdecryptfails;truncated/hashmismatchcorruptkept;64MiB+1refused;catalogbeforedataneverpublished;DPAPIfailnoplainttextfallback |
| T2 `feat(recovery): immutable document capture scheduling [step-09h/T2]` | useRecoveryCapture.ts/recoveryScheduler.ts;coordinatorcontrollerownerhook/schema25;U1/U2 | recoveryCapture.test.ts:duplicateviewsonecature;neweditsdonotchangesnapshotR;2sdebounce/10smin;cleancontentIDnorewrite;sensitiverefused;capwarningvisible |
| T3 `feat(recovery): reviewed recovered copies and startup restore [step-09h/T3]` | recovery_open.rs/RecoveryDialog.tsx/recoveryRestore.ts;U3/U6 | originalhashunchanged;newownedcopypath/MOTWkept;Discardonlyrecord;missingoriginaldoesnotblockcopy;unfinishedrenamejournalnopathcleanup |
| T4 `feat(startup): crash markers and non-destructive safe mode [step-09h/T4]` | startup_health.rs/safe_mode.rs/safeMode.ts;coordinatorbootsettingsroot | threefailuresin5minsafe;twonot;readyafter30s;actualsettingsbytesunchanged;restartnormalawaitsdirtycancel;crashneverdropsrecovery |
| T5 `feat(diagnostics): local redacted diagnostic sessions [step-09h/T5]` | diagnostics_types.rs/diagnostics_collect.rs/diagnostics_redact.rs/diagnostics_archive.rs/diagnostics.ts;U4/U5 | redactdrive/UNC/escapedpath/user;secretfolderneverread;32MiBdumpcap;defaultnodump/nofilecontents;ZIPtraversalrefused;savecollisionforeignkept;issueURLnoattachmenttext |
| T6 `feat(ui): tab failure and diagnostics review [step-09h/T6]` | TabErrorBoundary.tsx/DiagnosticsDialog.tsx/SafeModeBanner.tsx/styles/recovery.css/styles/diagnostics.css;coordinatorviewhost | recoveryUi.test.tsx:oneviewthrowExplorerusable;Escdoesnotdiscard;edit/excludefilebeforeSave;networkonlyOpenissue;200%zoom/eslongtext |
| T7 `docs(help): recovery safe mode and diagnostics [step-09h/T7]` | sixhelpfilesbelow;coordinatorlocales/pseudo/measures/shots | everyerrorhaseneskey;helpers/disposalrealprocesscrashfixtureexecutedbycoordinator,workersnotclaimpass |

## Full help

`recovering-after-a-crash.md`, English **Recovering after a crash**: “Review saved recovery revisions after an unexpected exit.” How to use: “Choose a revision and select **Open recovered copy**. Review the copy before saving it to a location you choose. Use **Keep for later** to decide later, or **Discard recovery** to remove only that recovery record.” Good to know: “Original files are not replaced. Recovery is bounded and some large or locked documents cannot use the ordinary store. An opened recovered copy is a new file in app storage.” See also: “Sessions” and “Version history”. Spanish **Recuperar después de un cierre inesperado**: “Revisa las revisiones de recuperación tras una salida inesperada.” Cómo usar: “Elige una revisión y selecciona **Abrir copia recuperada**. Revísala antes de guardarla en una ubicación elegida. Usa **Conservar para después** o **Descartar recuperación** para quitar solo ese registro.” Para tener en cuenta: “No se reemplazan los originales. La recuperación tiene límites; algunos documentos grandes o bloqueados no usan el almacén normal. La copia abierta es un archivo nuevo en los datos de la aplicación.” Consulta también: «Sesiones» e «Historial de versiones».

`safe-mode.md`, English **Safe mode**: “Start with temporary defaults after repeated startup failures.” How to use: “Review the safe-mode banner. Packs and background features stay disabled. Save any work, then choose **Restart normally** when you are ready to try your saved configuration.” Good to know: “Safe mode keeps your original settings and files. Resetting settings is a separate explicit action.” See also: “Recovering after a crash” and “Reporting a problem”. Spanish **Modo seguro**: “Inicia con valores temporales después de varios errores de inicio.” Cómo usar: “Revisa el aviso del modo seguro. Los paquetes y las funciones en segundo plano quedan desactivados. Guarda el trabajo y elige **Reiniciar normalmente** cuando quieras probar tu configuración guardada.” Para tener en cuenta: “El modo seguro conserva tu configuración original y tus archivos. Restablecer valores es una acción explícita independiente.” Consulta también: «Recuperar después de un cierre inesperado» e «Informar un problema».

`reporting-a-problem.md`, English **Reporting a problem**: “Prepare a local diagnostic file you can review before sharing.” How to use: “Open **Report a problem**. Review the included files, edit or exclude text, and keep paths and user names masked. Choose **Save diagnostics ZIP…**. If you want to report it, choose **Open issue page** and attach the ZIP yourself.” Good to know: “Nothing uploads automatically. Masking may miss information, so review it. Crash dumps are excluded by default and can contain private data.” See also: “Safe mode” and “Recovering after a crash”. Spanish **Informar un problema**: “Prepara un diagnóstico local que puedes revisar antes de compartir.” Cómo usar: “Abre **Informar un problema**. Revisa los archivos incluidos, edita o excluye texto y mantén ocultas las rutas y los nombres. Elige **Guardar ZIP de diagnóstico…**. Si quieres informar el error, elige **Abrir página de incidencias** y adjunta el ZIP tú mismo.” Para tener en cuenta: “No se sube nada automáticamente. El ocultamiento puede omitir información; revísala. Los volcados están excluidos por defecto y pueden contener datos privados.” Consulta también: «Modo seguro» y «Recuperar después de un cierre inesperado».

## Reviewer fixtures, speed, screenshots, done

FixturesordinarydirtytextrevisionsA/B,closedduplicateview,64MiB+1encodedfixture,sensitiveproviderfixture,corruptciphertext,syntheticredactionlogdrive/UNC/username,threecontrolledstartupfailures andoneownedhelpercrash. Coordinatorcreatesretaineddata/forcedcrashprocessesonly,verifiesoriginalhashes/settingskept/DPAPInoplaintext/searchnodataupload/ZIPpreview/normalrestart. Do notcrashownerworkorincludeactualpersonaldata.

Measure step09h.recovery.list/diagnostics.open Fast<1s;capture/protectjobbackgrounddoesnotdelayeditingInstant;startupregression<=20%. Shots106-recovery and107-diagnostics inthreevariants. Done: exactcontrollers/leases/paths/DPAPIvalidation,alltestsandruntimeevidencecoordinatorrun,manualuncleanexit/safemodeobserved,nofalseautosaveorsharingclaim.

E8 native recovery_dpapi.rs protect_current_user(input:&[u8])->Result<Vec<u8>,String>,unprotect_current_user(input:&[u8])->Result<zeroize::Zeroizing<Vec<u8>>,String>; max64MiB, UI-forbiddenDPAPIflag,currentuseronly,errorsstable.09j imports theseexacthelpers; callerbindspayloadidentity/schema/hashes.
