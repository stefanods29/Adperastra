# Step 09j: Disk images and clipboard history

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 4/5 |
| Branch | step-09j-disk-clipboard |
| Tag | v0.1.10-step09j |
| Depends on | 09a foldertabs;09c content-transfer-1;09h DPAPI/localstorage |
| Written before | 07a was built |
| Interface revision | disk-mount-1; clipboard-history-1 |

Guide only. Workers author code/tests and return integration instructions, no executed tools beyond read/search. Coordinator performs native feature/API checks, compilation, tests and controlled mount/clipboard runtime fixtures.

## Goal / exclusions

Mount supported local disk images read-only, browse the drive and eject it safely. Recall app-copied files, text and images from bounded clipboard history, optionally observe Windows clipboard and optionally persist encrypted history. No writable mounting, arbitrary raw IMG parser, automatic elevation, drive formatting, cloud clipboard sync, AI or embedded terminal; Open in Terminal alreadyexists03a.

## Read first / uses

| ID | Producer/task and exact export | Consumption |
|---|---|---|
| U1 | 09a openFolderTab/FolderTabState andnormalfslisting | Mounteddriveopensanormalfoldertabafteractualmountresult;noimagepathmasqueradesasdrive |
| U2 | 03a services/explorer.ts listDrives/openInTerminal;native shellhelpers | RefreshThisPCafterattach/detach;terminalunchanged |
| U3 | 09c E1/E2 TransferEnvelope/Payload/TransferRegistry;08aExportSnapshots | ClipboarditembecomesauthorizedtransferonlyonexplicitPaste;imagesrawbytesviaadpfile/notJSON |
| U4 | 03b fileops.ts clipboardSetFiles/clipboardRead/clipboardText/clipboardImageFile;nativeclipboard.rs | Addcapturecallbacksonsuccessfulapp-copy only, passing its authoritative TransferEnvelope.transfer_id;donotchangetheOSclipboardformatsemantics |
| U5 | 09h native recovery_dpapi.rs | AddE8 protect_current_user(input:&[u8])->Result<Vec<u8>,String>,unprotect_current_user(input:&[u8])->Result<zeroize::Zeroizing<Vec<u8>>,String>,max64MiB;reuseforpersistenthistory,differentauthenticatedrecordmagic |
| U6 | 07aSourceStamp;nativehelper/job/ownedio;09cactivationsecurity | Diskidentityguard/main-onlycommands,one-operationelevatedbrokerauthority, noarbitraryprivilegedcommandchannel |

Mappedv109ddisk/clipboardparagraphs;Windows0.61.3local Vhdsource;currentClipboardDataandboundedimageencoder;helperflagdispatch;privacy/settingsrecipes. NewWindowsfeaturesWin32_Storage_Vhd/Win32_Foundation/Win32_Security/Win32_System_IOplusclipboardfeaturesverifiedbeforeinstall.

## Decisions and algorithms

1. SupportedISO, VHD, VHDX. `.img`onlyifvalidatedISO9660opticalsignature(e.g.CD001atsector16descriptor)orWindowsOpenVirtualDiskexplicitISOprovideracceptsafterboundedprobe; arbitraryrawIMGreturnsdisk.unsupported,extensionrenameisneveraconversion. DeviceIDsISO1,VHD2,VHDX3,Microsoftvirtualdiskprovider;noinventedrawIMGdeviceID.
2. OpenVirtualDisk withminimumreadonlyaccess, AttachVirtualDisk READ_ONLY; do not use writableattachflags. Holdsourceidentityandmountlifetimehandle, resolvephysicaldevice/volumesactualWindowsresult;up to10sforvolumearrivalwithprogressCancel. Do not inventdriveletterfromnextavailableletter.10concurrentappmountsmax. Sameimageexistingappmountreusesit;externalmountreportedexternal/notowned.
3. Mountrequestcomesonlyfromexplicitopen/Mountcommand. Neverautomountduringthumbnail/index/recentrestore. ISOfilehandler actionMountusesnormalconfirmroute;VHDwriteabilityneverenabled. Readonlymountedfilesnormalprotected/default-openingpipeline.
4. Ejectonlyapp-ownedmountmatchingfullSourceStampandmount_id;checkopenappdocumentgrantsunderthatvolume,askclose/dirtydecisionsfirst. IfWindowsreportsinuse,keepmountlistedandshow09gdialog/Retry; noforcedetach/forcedprogramclose. ExternalmountshowsWindows-managedlabel;guidedoesnotclaimownershiporallowejectwithoutverifiedcapability.
5. Ifattachneedsadmin,showexplicitone-operationconfirmationandthenWindowsUACusingShellExecuteExWverb runasforstatic--disk-brokerflag. ParentcreatescurrentSID/SYSTEM-onlyrandomnamedpipe,verifiesbrokerPID/starttime/SIDfromreturnedprocesshandleandpipepeer. Brokeracceptsexactoneauthorizedreadonlymountrequestwithsourcepath/stamp;nootherpath/command/opafterbindexceptejectthatmount/status. Rejectnetworkpaths/reparsepoints/protectedrootsforprivilegedrequest. Brokerholdsreadonlymountuntilparentdisconnect/eject;gracefuldetachandexit. Neverelevatewholeapporforwarduserargumentstrings. UACcancelreturnsdisk.cancelled.
6. Brokerprocesslifetime/payloadcap64KiB/timeout10s/challengeresponseboundtomountrequestUUID;authenticationisOSACL+peerprocessidentity,notsecretargumentsvisibleinprocesslist. Nativeprivilegedparserrevalidatessourceandmode;helperinvocationflaghandledbeforesingleinstance. Whensecurityproof/nativefixturefails,adminmountcapabilityfalseandindependentnormalmountworks;nosuccessstub.
7. ClipboardHistorySettings schema25 -> 26: enabled booltrue,capture_windows boolfalse,persist boolfalse,max_items u16100 range10-100,max_mib u1664 range8-64. Appcopysuccessrecordsfiles/text/image,nevercut-onlypermissionsasfuturepasteauthority. NoOSlisteneruntilcapture_windows enabled;disablingstopslistener/cancelsreads,keepshistoryonlyifuserchoosesretain/clear.
8. WindowscaptureusesAddClipboardFormatListener/WM_CLIPBOARDUPDATE/GetClipboardSequenceNumber;inspectprivacyregisteredformatsBEFOREreadingcontents. If ExcludeClipboardContentFromMonitorProcessing exists, orCanIncludeInClipboardHistoryDWORD0,orCanUploadToCloudClipboardDWORD0,skipentireitem. Markedprivateapp/sensitivesourcealwaysskip. Unknownformatsnotparsed: onlyCF_UNICODETEXT,validatedCF_HDROP andboundedbitmapviaexistingencoder;neverHTML/RTF/OLEobjects/scripts.
9. Read clipboardonworker,OpenClipboardfailure3retries50ms,neverUIthread;checksequencebefore/after,discardchangedgeneration. Text<=1MiUnicode/4MiB;files<=1000;images<=16MP/8MiBencodedPNG. Global100items/64MiBphysicalpayload;dropoldestunpinned, max20pinned;ifpinnedbudgetfullnewitemrefusedwithtranslatedmessage,neverdropspinnedquietly. Dedupbykind+contenthash+normalizedfilelist, moveexistingtotop.
10. Historymemoryonlydefault;persistoptinusesDPAPIenvelope/catalogunder<data>/clipboard-history,limit64MiBincludingstaging;rowsmetadataalsoencrypted,notplaintextfilepaths/textsnippets. Sensitiveitemsneverpersist. Startupvalidatesnewerschema/size/hash/ciphertextbeforeread;clearremovesonlyownedhistory,notOSclipboardunlessseparateClearcurrentclipboardbuttonconfirmed. NoSSDsecureeraseclaim.
11. UIselectionpreviewdoesnotpasteuntilPastebutton/Enteronexplicititemactivation;targetrevalidatesreadonly/capabilitiesthroughTransferRegistry. Filereferencesresolvenormal03bcopy/moveaction,notexecutesavedcutmode. Stale/missingfilesreported. Searchlocalonlymax256querychars,literalcasefoldedsubstring,first50virtualrows; nosearchindex/AI. Ctrl+Shift+Vcontext: apphistoryunlessfocusededitorusesPasteSpecial,theneditorPasteSpecialwinsandexposesHistorybuttonthere.

## Types and exports

Canonicalservices/diskImages.ts+native disk_image_types.rs;services/clipboardHistory.ts+nativeclipboard_history_types.rs.

| Type | Exact fields |
|---|---|
| DiskImageKind | iso/vhd/vhdx; opticalimgnormalizedisoafterprobe |
| MountRequest | path absolute string;expected optionalSourceStamp;readonly musttrue;allow_elevation boolfalseuntilconfirmed |
| MountedImage | mount_id UUID;source SourceStamp;kind DiskImageKind;volume_roots string[]max16;physical_path string<=32768;readonly true;owned bool;state mounting/mounted/ejecting/in_use/error;brokered bool |
| MountResult | mount MountedImage or null;requires_elevation bool;error_code optionalstring;nomountforfailedrequest |
| ClipboardHistoryKind | text/files/image |
| ClipboardHistoryItem | id UUID;kind;created_unix safeu64;source app/windows;source_label optionalstring<=128nosensitiveprocessdata;preview string<=512escaped;byte_len safeu64;pinned bool;missing bool;payload_token UUID optionalonlyinliveview;noimagebytes |
| ClipboardHistoryPage | items max50;next_cursor optionalUUID;complete bool;total u32;used_bytes safeu64;generation safeu64 |
| ClipboardHistoryPayload | text {text string};files {paths string[]};image {snapshot ExportSnapshot,width u32,height u32};sensitivitynativevalidated |
| ClipboardHistoryPatch | tagged pin {id UUID,pinned bool};remove {ids UUID[]};clear {include_pinned boolfalse};expected_generation safeu64 |

| ID | Exact export | Signature/consumer |
|---|---|---|
| E1 | diskImages.ts mountDiskImage/ejectDiskImage/listMountedImages | mount(request MountRequest)->Promise<JobHandle<MountResult>>;eject(mountId string)->Promise<JobHandle<{ejected:boolean}>>;list()->Promise<MountedImage[]>;native disk_mount_start/disk_eject_start/disk_mounts. NoautomaticallowElevationtrue |
| E2 | clipboardHistory.ts listClipboardHistory/patchClipboardHistory | list(query string,cursor optionalstring)->Promise<ClipboardHistoryPage>;patch(patch ClipboardHistoryPatch)->Promise<ClipboardHistoryPage>;native clipboard_history_list/patch |
| E3 | same resolveClipboardHistory/recordAppClipboard | resolve(id string,targetDocumentId optionalstring)->Promise<TransferEnvelope>;native clipboard_history_resolve(id,target_document_id);record(transferId string)->Promise<void> native clipboard_history_record(transfer_id);native resolves authoritative09c transfer registry, allowedkindstext/files/imageonly, derive source sensitive/private fromregisteredsource, never UIprovidedfalse flag. Resolveleasesreleasedvia09c |
| E4 | `src/clipboard/ClipboardHistoryPanel.tsx` | props targetId string|null,onPaste(envelope TransferEnvelope)->Promise<void>,onClose()->void,onOpenHelp(slug)->void;usesE2/E3throughservices, noinvoke |
| E5 | native disk_broker.rs run_disk_broker | (pipe_name:&str,parent_pid:u32,parent_start_ticks:&str)->Result<(),String>;afterverifiedpeeracceptoneMountRequest,authorizedejectonlysameID;notgeneralRPC. Thisisapphelper,nouserselectedprogram |

Allnativecommandsmain-onlyargument/ID/path/capchecks. Errorsdisk.unsupported/changed/in_use/denied/unavailable/cancelled/timeout;clipboard_history.invalid/too_large/full/changed/private/io/cancelled. Brokernevercallsmaincapabilities;noOSclipboardfilebytesinJSON.

## Texts / UI / commands

| Key | English | Spanish |
|---|---|---|
| disk.mount / disk.eject / disk.readOnly / disk.external / disk.elevate | Mount / Eject / Mounted read-only / Managed by Windows / Windows needs administrator permission to mount this image read-only. Continue for this operation only? | Montar / Expulsar / Montada en solo lectura / Administrada por Windows / Windows necesita permiso de administrador para montar esta imagen en solo lectura. ¿Continuar solo con esta operación? |
| clipboardHistory.title / clipboardHistory.search / clipboardHistory.paste / clipboardHistory.pin / clipboardHistory.unpin / clipboardHistory.clear / clipboardHistory.empty | Clipboard history / Search copied items… / Paste selected item / Pin item / Unpin item / Clear history / No copied items are available. | Historial del portapapeles / Buscar elementos copiados… / Pegar elemento seleccionado / Anclar elemento / Desanclar elemento / Borrar historial / No hay elementos copiados disponibles. |
| clipboardHistory.windows / clipboardHistory.persist / clipboardHistory.persistWarning / clipboardHistory.private | Include copies from Windows / Keep history after restart / History may contain private text or file names. Saved history is encrypted for this Windows account. / Private clipboard content was not recorded. | Incluir copias de Windows / Conservar historial tras reiniciar / El historial puede contener texto o nombres privados. Se cifra para esta cuenta de Windows. / No se registró el contenido privado del portapapeles. |
| clipboardHistory.clearConfirm / clipboardHistory.missing | Clear the selected history items? Their source files will stay where they are. / Some referenced files are no longer available. | ¿Borrar los elementos seleccionados del historial? Sus archivos de origen permanecerán donde están. / Algunos archivos referenciados ya no están disponibles. |
| errors.disk.unsupported / errors.disk.changed / errors.disk.in_use / errors.disk.denied / errors.disk.unavailable / errors.disk.cancelled / errors.disk.timeout | This disk image is not supported. / The disk image changed. / The mounted drive is in use. Close its files and retry. / Windows did not allow this mount. / Disk mounting is unavailable. / The disk action was cancelled. / Windows did not finish the disk action in time. | Esta imagen de disco no es compatible. / La imagen de disco cambió. / La unidad montada está en uso. Cierra sus archivos y reintenta. / Windows no permitió montar la imagen. / El montaje de discos no está disponible. / Se canceló la acción de disco. / Windows no terminó la acción a tiempo. |

Clipboarderrorpairs errors.clipboard_history.invalid “This history item is not valid.”/“Este elemento no es válido.”;too_large “This clipboard item exceeds the size limit.”/“Este elemento supera el límite de tamaño.”;full “Pinned clipboard items fill the history limit.”/“Los elementos anclados llenan el historial.”;changed “The clipboard changed. Copy the item again.”/“El portapapeles cambió. Copia el elemento de nuevo.”;private “Private clipboard content cannot be stored here.”/“El contenido privado no se puede guardar aquí.”;io “Clipboard history could not be saved.”/“No se pudo guardar el historial.”;cancelled “The clipboard action was cancelled.”/“Se canceló la acción del portapapeles.”

Historypanel480px wide/maxheightviewportminus32;SearchBox/virtualrows72px thumbnail64/preview2lines/time/source/pin;clear/pastefooters;rolelistboxoptions/keyboard/focusrestore. MountprogressDialog480px,readonlylabel/Cancel/Eject;navDriveentryexistingcomponentswithdiskiconnotbrandasset. Commands explorer.mountImage(Disk),explorer.ejectImage(LogOut),app.clipboardHistory(ClipboardList),labelsabove/helpsmounting-disk-images/clipboard-history;riskschange/read-onlyasappropriate;CtrlShiftVscopeD11. Allcolorscurrenttokens,noflashing.

## Tasks / named tests

| Task/commit | Files/imports/algorithm | Tests and exact oracle |
|---|---|---|
| T1 `deps: enable Windows virtual disk APIs [step-09j/T1]` | coordinatormanifestfeatures;disk_image_types.rs/diskImages.ts;U1/U6 | nativeinvalidpath/nonreadonlybeforeAPI;rawIMGunsupported;verifiedISOIMGnormalizesiso |
| T2 `feat(disks): guarded read-only mount lifecycle [step-09j/T2]` | disk_images.rs/disk_mounts.rs/disk_volumes.rs;U1/U2/U6 | sourcechangednomount;actualvolumerootused;10mountlimit;externalnotdetached;inusekeepsmount;cancelnoorphanhandle;defaultreadonlyflag |
| T3 `feat(disks): narrowly scoped elevated broker [step-09j/T3]` | disk_broker.rs/disk_broker_security.rs;coordinatorhelperentry;U6/E5 | wrongpeerPID/start/SIDdenied;extraop/pathafterbinddenied;UACcancelclean;sourcejunctionrefused;parentdisconnectreadonlymountdetached;realbrokersecurityfixturebycoordinator |
| T4 `feat(clipboard): private-aware bounded history [step-09j/T4]` | clipboard_history_types.rs/clipboard_history.rs/clipboard_history_listener.rs/clipboardHistory.ts;U3/U4 | privateformatcheckedbeforepayloadread;sequencechangediscard;3busyretrylimit;101evictsoldestunpinned;21stpinrefused;image16MP+1refused;sensitiveappskipped |
| T5 `feat(clipboard): encrypted optional history persistence [step-09j/T5]` | clipboard_history_store.rs/clipboard_history_payload.rs;schema26coordinator;U5 | defaultnodiskwrites;DPAPIwronguserfails;corruptrownotplaintextfallback;clearonlyownedhistory;foreignfileskept;nohistoryuploads |
| T6 `feat(ui): disk mount actions and clipboard history [step-09j/T6]` | MountedImageActions.tsx/ClipboardHistoryPanel.tsx/styles/clipboardHistory.css;U1-U4 | clipboardUi.test.tsx:selectionnopasteuntilaction;targetreadonlyfail;PasteSpecialscopewins;keyboardpin/search/clear;mountadminconfirmbeforeUAC |
| T7 `docs(help): disk images and clipboard history [step-09j/T7]` | fourhelpfilesbelow;coordinatorlocales/pseudo/measures/shots | bilingualeject/historyhelp;commandsunique;oldTerminaltestsunchanged |

## Full help

`mounting-disk-images.md`, English **Mounting disk images**: “Browse supported disk images as read-only drives.” How to use: “Choose **Mount** for an ISO, VHD, VHDX or supported optical IMG. Review any Windows permission request. Open the resulting drive in This PC. Close its files and choose **Eject** when finished.” Good to know: “The app never mounts images writable. Raw IMG files are not generally supported. Images mounted by another program remain managed by Windows. Only the requested mount operation can ask for administrator permission.” See also: “This PC” and “Files in use”. Spanish **Montar imágenes de disco**: “Explora imágenes compatibles como unidades de solo lectura.” Cómo usar: “Elige **Montar** para un ISO, VHD, VHDX o IMG óptico compatible. Revisa cualquier permiso de Windows. Abre la unidad resultante en Esta PC. Cierra sus archivos y elige **Expulsar** al terminar.” Para tener en cuenta: “La aplicación nunca monta imágenes con escritura. Los IMG sin formato óptico no son compatibles en general. Las imágenes montadas por otro programa siguen administradas por Windows. Solo la operación solicitada puede pedir permiso de administrador.” Consulta también: «Esta PC» y «Archivos en uso».

`clipboard-history.md`, English **Clipboard history**: “Reuse recent copies without changing their source files.” How to use: “Open **Clipboard history**, search or choose an item and select **Paste selected item**. Pin an item to keep it while the history fills. Clear references you no longer need.” Good to know: “History stays in memory by default. Windows-wide capture and encrypted persistence are separate choices. Items marked private are skipped. Clearing history does not delete source files or clear the current Windows clipboard.” See also: “Copying content between tabs” and “The shelf”. Spanish **Historial del portapapeles**: “Reutiliza copias recientes sin cambiar sus archivos de origen.” Cómo usar: “Abre **Historial del portapapeles**, busca o elige un elemento y selecciona **Pegar elemento seleccionado**. Ancla un elemento para conservarlo cuando se llene el historial. Borra las referencias que no necesites.” Para tener en cuenta: “Por defecto el historial permanece en memoria. Capturar desde Windows y conservarlo cifrado son opciones independientes. Se omiten los elementos privados. Borrar el historial no elimina archivos ni vacía el portapapeles actual de Windows.” Consulta también: «Copiar contenido entre pestañas» y «La bandeja».

## Reviewer fixtures / speed / screenshots / done

Retainsyntheticread-onlyISOsmalltextfile,VHD/VHDXwithknownhash,rawIMGunsupportedfixture;onlycoordinatorownedimagevolumes. Clipboardfixtureprivateflags/textUnicode/files/missing/image/oversize/sequencechange. Coordinatorchecksmount readonly/ejectinuse/UACcancel/brokerwrongpeer/cleanup;historydefaultnodisk/private/nohydrate/persistclear/pastecases;sourcehashesunchanged. Repeatesdark/pseudo/keyboard200%zoom.

Measure step09j.history.open/filter Instant<100ms;mountWaiting<=10swithCancel/progress;clipboardcapturebackgrounddoesnotdelaytyping. Shots110-mounted-image,111-clipboard-history,threevariants. Done: allcanonicalexports/wiringchecked,brokersecurityandOSprivacyfixturesrealexecuted,unsupportedrawIMGhonest,sensitivepayloadsnospill,coordinatorgate/package/speed/reportaccepted.
