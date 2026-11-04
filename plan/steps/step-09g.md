# Step 09g: Files in use and the shelf

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-09g-locks-shelf |
| Tag | v0.1.7-step09g |
| Depends on | 09b saved-groups-1;09c content-transfer-1;09f transfer-jobs-1;07a thumbnails |
| Written before | 07a was built |
| Interface revision | file-locks-1; shelf-1 |

Workers write implementation/tests/help, no compilation or execution. Coordinator owns shared roots, dependency features, generated assets, checks and accepted commits.

## Goal / exclusions

Find programs holding a file, ask one eligible program to close normally and retry the operation. Collect references on a dockable shelf without moving files, keep the list after restart, and send a reviewed selection to existing actions. No forced termination, system-process control, recursive drive-wide lock scan, AI action, automatic upload/share or copying files merely because they are on the shelf.

## Read first / uses

Read mapped v1 09c lock/shelf paragraphs; full09b/c/f; existing native Windows helper/job pattern; `src/services/explorer.ts` shareItems/openItem; fileops clipboard/drag wrappers; layout05c guide and actual panel registry. All source locations are fixed below; shared layout integration is returned as coordinator instructions.

| ID | Producer/task; canonical export | Consumption |
|---|---|---|
| U1 | 09f E1/E2 transferJobs.ts startTransfer/controlTransfer | Copy/move shelf references through one queue; failures/missing items remain visible, no duplicated engine |
| U2 | 09e E6 batch/registry.ts resolveBatchAction;08b presets/08c PrivacyDialog;06e archive creation | Existing options/confirmations remain; shelf itself is not permission to modify, share or clean |
| U3 | 07a E7 FileThumbnail(path,edge,active,fallback,className?) |64px shelf thumbnail, cancel/release when hidden; cloudplaceholderneverbackgroundread |
| U4 | 09b E4/E6 saved groups;09a normalopen/DocumentRef | Open as group via exactdescriptors/GroupRestoreHost, no fabricatedfilepathsforvirtualentries |
| U5 | 09c E1/E2 transfer tokens/TransferRegistry; existingfileops clipboardSetFiles(paths,cut) andnativeOLEdrag | Onlyexplicitdrop/drag action; persistdiskrefs,nevertransfer tokens/bytes/decryptedvirtualnames |
| U6 | 09a E9 UiHistoryRegistry;03b UndoStack;05c layout | Shelfadd/remove/clear/move-order appstateundo; panevisibility/placement addedinsettingswithoutnewlayoutframework |

## Decisions and algorithms

1. Add Windows feature Win32_System_RestartManager to existing0.61.3. Use RmStartSession/RmRegisterResources/RmGetList/RmEndSession in an isolated --file-locks-helper process through existing HelperProcess,3s wall timeout/256inputfiles/1024processes. Folderquery examines folderitselfonly; clear note it is not a recursive lock list. Always end RM sessions via RAII on ordinary completion/errors. Timeout/cancel kills only that owned helper; do not abandon a blocked native thread. Normal-close confirmation happens before starting the separately scoped close helper.
2. Processidentity is PID plus processcreationFILETIME, neverPIDalone. Return boundeddisplayname/appname/sessionstatus. Closing isallowedonlysameuser,noncritical,non-system,non-elevatedcompatibleprocessverifiedatclicktime. DenyPID0/4/currentapp/criticalprocesses andunknownidentity. ProgramnotclosingornotregisteredinRMreportsreason, neverfallsbacktoTerminateProcess.
3. Normalclose uses a NEW RMsession registering only the exact chosen RM_UNIQUE_PROCESS; RmShutdown flags0, no RmForceShutdown. The original resourcesessioncouldincludeothers andmustnotbeusedforclosing. Show explicitunsaved-workwarningbeforeclose; retryoriginaloperation onlyafterfreshvalidation anduserRetry. Noautomaticretrywitholdtargetauthorization.
4. Shelf storesreferenceitems, max1000/2MiB,atomic<data>/shelf.json schema1revisioncounter. EntriesdeduplicatedusingfolderViewKey(path) fordiskrefs andexactprovidercontainer/entryID forvirtualruntimeonly. Persistonlydiskrefs; virtualsensitiveitemsstaymemoryandclearatlock/close with warning. Originalpathisnotrenamedbyeditingdisplaylabel.
5. Diskentries showname/origin/type/stateavailable/missing/changed/unavailable; refreshonshow/userRefreshandwatchsignals09a,8statsconcurrently/3seach. Do nothydratecloudfiles tocheckavailability. Externalrenamewithoutpairedwatchidentitymarksuncertain untilrefresh; donotclaimforever-followingpathreferences.
6. Addbydrop/selection;remove/clearremovesreferencesonly,neverfiles. Dragout usesnativeOLEforvalidateddiskitems; sensitivevirtualdragoutrequires09kexplicitunencryptedcopyroute, otherwiseunsupported. Toolbaractions copy/move/compress/share/convert/privacy/open-as-group alwayslaunchtheirnormalreviewUI, compatibleintersectiononly;onefaileditemnotdiscardedfromlist. Successfulmoveupdatesonlyactualcompletedpaths.
7. Shelfwidth320default,min240,max600;placementsleft/right/bottom,defaultbottomheight180,min120,max400. Use05cexistinglayoutpersistencepatterns, newpanelIDshelf; do notwrapitinaToolbarDockwhichisfortoolbars. Toggle titlebar/command app.shelf with Ctrl+Alt+S; Ctrl+Shift+S remainsSaveas. Schema23 -> 24 adds shelf.visible false,side bottom,size180;validationperplacement.

## Types and exports

Canonical `src/services/fileLocks.ts` mirrored `src-tauri/src/file_lock_types.rs`; `src/services/shelf.ts` mirrored `shelf_types.rs`.

| Type | Exact fields/validation |
|---|---|
| LockProcess | pid u32;start_ticks decimalstringWindows100ns;name string<=256;application string<=256;can_close bool;reason optional system/critical/other_user/elevated/unknown/self;session_id u32 |
| FileLockReport | paths string[]max256;processes LockProcess[]max1024;complete bool;folder_nonrecursive bool;error_code optionalstring |
| CloseLockProcessRequest | pid u32;start_ticks string;confirmed boolmusttrue;nativecomparesfreshidentityandeligibility |
| CloseLockProcessResult | status requested/already_closed/refused;reason optionalstring;neverpromisesuserprogramsaveddata |
| ShelfItem | id UUID;source DocumentRef;display_name string<=255;added_unix safeu64;state available/missing/changed/unavailable;last_checked_unix optional safeu64;runtime sensitive bool. Onlydisk source/display_name/added_unix persisted |
| ShelfCatalog | schema_version1;revision safeu64;items ShelfItem[]max1000; nativepersistvalidationrefusessensitive/virtualserialization |
| ShelfPatch | tagged add {sources DocumentRef[]max1000};remove {ids UUID[]};clear {};reorder {ids UUID[]exactpermutation};update_moved {moves CompletedItem[]projectedfromactual09fresults}. Nativevalidatesnormalpipelineandexpectedrevision |
| ShelfPanelProps | catalog ShelfCatalog;active bool;onPatch(patch ShelfPatch)->Promise<void>;onAction(id copy/move/compress/share/convert/privacy/open_group,ids readonlystring[])->Promise<void>;onOpen(id)->Promise<void>;onOpenHelp(slug)->void |

| ID | Exact canonical export | Signature and use |
|---|---|---|
| E1 | fileLocks.ts inspectFileLocks | (paths readonlystring[])->Promise<JobHandle<FileLockReport>>;native locks_inspect_start(request_id,paths); no mainthreadCOM/diskwork |
| E2 | same requestProcessClose | (request CloseLockProcessRequest)->Promise<JobHandle<CloseLockProcessResult>>;native locks_close_start(request_id,request).09ferrors/save/renameUIcanopenLocksDialog |
| E3 | `src/locks/FilesInUseDialog.tsx` | props paths readonlystring[],onRetry()->Promise<void>,onClose()->void,onOpenHelp(slug)->void; closeprocessrequiressecondDialogconfirmation,noforcebutton |
| E4 | shelf.ts getShelf/patchShelf/refreshShelf | get()->Promise<ShelfCatalog>;patch(patch ShelfPatch,expectedRevision number)->Promise<ShelfCatalog>;refresh(ids readonlystring[])->Promise<JobHandle<ShelfCatalog>>;native shelf_get/shelf_patch/shelf_refresh_start. Revisionconflict shelf.changed |
| E5 | `src/shelf/ShelfPanel.tsx` | ShelfPanelProps; `src/shelf/shelfActions.ts` runShelfAction(id,items,host ShelfActionHost)->Promise<void>; host exactmethods startTransfer(request)->Promise<void>,openBatch(inputs)->Promise<void>,openArchive(paths)->Promise<void>,share(paths)->Promise<void>,openGroup(descriptors)->Promise<void>,openPrivacy(inputs)->Promise<void>. Hostonlyopensreviewflows, no privateAppvariable |

Everycommandensure_main/validatespaths/UUIDs/enum/caps;displaynamesfromsystemaredata,nottranslationkeys;numericerrorsmapped locks.failed/timeout/denied/changed/cancelled,shelf.invalid/changed/limit/io. Existingglobaljobs/cancellationboundtimeoutsapply; pipesneverpasswords/logs.

## Texts, layout and commands

| Key | English | Spanish |
|---|---|---|
| locks.title / locks.inspect / locks.close / locks.retry / locks.none | Files in use / What is using this? / Ask program to close / Retry action / No programs were reported. | Archivos en uso / ¿Qué está usando esto? / Pedir al programa que cierre / Reintentar acción / No se informaron programas. |
| locks.confirm | Ask “{name}” to close? Save any work in that program first. | ¿Pedir a «{name}» que cierre? Guarda primero el trabajo en ese programa. |
| locks.folderNote / locks.protected / locks.requested | Folder checks are not recursive. / This program cannot be closed here. / The program was asked to close. Review it before retrying. | Las carpetas no se revisan de forma recursiva. / Este programa no se puede cerrar aquí. / Se pidió al programa que cierre. Revísalo antes de reintentar. |
| shelf.title / shelf.add / shelf.remove / shelf.clear / shelf.empty / shelf.refresh | Shelf / Add to shelf / Remove from shelf / Clear shelf / Drop files here to collect them without moving them. / Refresh shelf | Bandeja / Agregar a la bandeja / Quitar de la bandeja / Vaciar bandeja / Suelta archivos aquí para reunirlos sin moverlos. / Actualizar bandeja |
| shelf.missing / shelf.changed / shelf.openGroup / shelf.clearConfirm | File not found / Location changed / Open as tab group / Clear these references? Your files will stay where they are. | No se encontró el archivo / La ubicación cambió / Abrir como grupo de pestañas / ¿Vaciar estas referencias? Tus archivos permanecerán donde están. |
| shelf.sensitive | Locked-folder items stay only until the folder locks or the app closes. | Los elementos de carpetas bloqueadas permanecen solo hasta que la carpeta se bloquee o se cierre la aplicación. |
| errors.locks.failed / errors.locks.timeout / errors.locks.denied / errors.locks.changed / errors.locks.cancelled | Programs using this file could not be listed. / The lock check timed out. / This program cannot be closed here. / The program changed. Check the list again. / The lock check was cancelled. | No se pudieron listar los programas que usan este archivo. / Se agotó el tiempo de revisión. / Este programa no se puede cerrar aquí. / El programa cambió. Revisa la lista de nuevo. / Se canceló la revisión. |
| errors.shelf.invalid / errors.shelf.changed / errors.shelf.limit / errors.shelf.io | This shelf change is not valid. / The shelf changed. Reload it and try again. / The shelf can hold up to 1,000 items. / The shelf could not be saved. | Este cambio de bandeja no es válido. / La bandeja cambió. Cárgala de nuevo e inténtalo. / La bandeja admite hasta 1,000 elementos. / No se pudo guardar la bandeja. |

Commands explorer.fileLocks label locks.inspect iconSearchCheck helpslugfiles-in-use riskread-only;explorer.addToShelf labelshelf.add iconPanelBottom riskchange;app.shelf labelshelf.title iconPanelBottomOpen shortcutCtrl+Alt+S helptheshelf riskread-only. Shelfrows72px virtualized;checkboxselection;contextMenuactionsfromregistry; originlabeldisplayPath;missingicon+text;Skeleton>100ms/errorsinlineRetry;locksDialog600px processrows48px;normalclosebuttondisabledwithreason; Escfocusrestore;no rawcolors.

## Tasks and tests

| Task/commit | Files/imports/work | Named test/input -> expected |
|---|---|---|
| T1 `deps: enable Windows Restart Manager [step-09g/T1]` | coordinatorCargoWindowsfeature/license;create file_lock_types.rs/fileLocks.ts;U1/U3 | nativeDTOinvalidpid/startticks/pathlimitsrefusedbeforeRMsession;featuresverifiedagainstpinnedsource |
| T2 `feat(locks): bounded program inspection and normal close [step-09g/T2]` | file_locks.rs/restart_manager.rs/process_identity.rs;U1;D1-D3 | native `pid_reuse_refused`; `critical_self_other_user_denied`; `close_session_contains_only_selected_process`; `no_force_flags`; `session_ended_on_all_errors`;realfixtureopenhandleidentified |
| T3 `feat(shelf): persistent bounded file references [step-09g/T3]` | shelf_types.rs/shelf_store.rs/shelf.ts/shelfValidation.ts;U4/U6 | shelf.test.ts:nodupnormalizedpaths;1001refused;clearleavesdiskhashes;virtualneverpersisted;revisionraceoriginalkept |
| T4 `feat(shelf): shared action and drag routing [step-09g/T4]` | shelfActions.ts/shelfRefresh.ts/useShelfDrop.ts;U1-U5 | actionreviewrequired;missingitemreported;completedmoveonlyupdatesactualpaths;sensitiveexternaldragdeniedwithoutsafe-copy;refreshnohydrate |
| T5 `feat(ui): files in use and dockable shelf [step-09g/T5]` | FilesInUseDialog.tsx,CloseProgramDialog.tsx,ShelfPanel.tsx,styles/shelf.css/styles/fileLocks.css;coordinatorschema24/layout/routes | locksUi/shelfUi.test.tsx:warningbeforeclose;Escnocloseprocess;CtrlAltSonly;keyboardrows/menus;Saveasshortcutunchanged |
| T6 `docs(help): files in use and shelf [step-09g/T6]` | fourhelpfilesbelow;coordinatorlocales/pseudo/shots/measures | bilingualroutes/keyparity;hiddenpanelcancelsmetadata/leases;oldfileopsretained |

## Full help

`files-in-use.md`, English **Files in use**: “See which programs Windows reports as holding a file.” How to use: “Choose **What is using this?**. Review the program list. Save your work in a listed program before choosing **Ask program to close**, then confirm. Return and choose **Retry action**.” Good to know: “The app never forces a program to stop. Protected programs cannot be closed here. Folder checks do not inspect every file inside. An empty list does not prove the file can be changed.” See also: “Copying and conflicts” and “Saving files”. Spanish **Archivos en uso**: “Revisa qué programas informa Windows que mantienen abierto un archivo.” Cómo usar: “Elige **¿Qué está usando esto?**. Revisa la lista. Guarda el trabajo en un programa antes de elegir **Pedir al programa que cierre** y confirma. Vuelve y elige **Reintentar acción**.” Para tener en cuenta: “La aplicación nunca fuerza el cierre. Los programas protegidos no se pueden cerrar aquí. Revisar una carpeta no inspecciona todos sus archivos. Una lista vacía no demuestra que el archivo pueda cambiarse.” Consulta también: «Copias y conflictos» y «Guardar archivos».

`the-shelf.md`, English **The shelf**: “Collect references from several folders without moving the files.” How to use: “Open **Shelf** with Ctrl+Alt+S. Drop files there or choose **Add to shelf**. Select shelf items and choose copy, move, compress, share, convert, privacy cleaning or opening as a tab group. Each action opens its normal review.” Good to know: “Removing or clearing shelf references does not delete files. The list stays after restarting; moved or missing items may need Refresh. Locked-folder items remain in memory only.” See also: “Batch actions” and “Saved groups”. Spanish **La bandeja**: “Reúne referencias de varias carpetas sin mover sus archivos.” Cómo usar: “Abre **Bandeja** con Ctrl+Alt+S. Suelta archivos allí o elige **Agregar a la bandeja**. Selecciona elementos y elige copiar, mover, comprimir, compartir, convertir, limpiar privacidad o abrir como grupo de pestañas. Cada acción abre su revisión normal.” Para tener en cuenta: “Quitar o vaciar referencias no elimina archivos. La lista permanece tras reiniciar; los elementos movidos o ausentes pueden necesitar Actualizar. Los elementos de carpetas bloqueadas permanecen solo en memoria.” Consulta también: «Acciones en lote» y «Grupos guardados».

## Reviewer fixtures / speed / screenshots / done

Retainfileheldopenbyseparatetestprocess(PID/starttimeknown),reusedPIDadapterfixture,readonly/systemdenialfixture;twofoldersandmissingfileonshelf. Coordinatorchecksinspection/normalcloseonly/cancel/timeout/shelfrestoration/clearwithoutdelete/allroutes/cloudsensitivepolicy/keyboard/esdark/pseudo. Realnormalclosefixturemustbeacoordinatorownedprocesswithnoownerdata.

Measure step09g.shelf.toggle/select Instant<100ms;lockslistWaiting<=3swithfeedback/cancel;shelfvisiblefirstrowsFast<1s. Shots104-files-in-use,105-shelf inthreevariants. Done: E1-E5exact,sharedhistory/routesconsistent,noTermination/noautomaticmodification,allcheckscoordinatorrunandrecordedbeforepromotion.

09f result projection for ShelfPatch.update_moved: read all bounded report pages; only a transfer requested as move with item.status=done, item.to present and item.source_removed=true contributes CompletedItem {from:item.from,to:item.to}. Copy/skipped/failed/cancelled items do not change source references.09aidentityeffects handle provenexternalmigrationseparately. T4 tests each projection branch and multiple reportpages.
