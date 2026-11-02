# Step 09a: More tabs, shared documents and sessions

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-09a-tabs-sessions |
| Tag | v0.1.1-step09a |
| Depends on | current04a tabs/open pipeline,06a unsaved state,08a snapshots;chronological08d acceptance independentfromwriting |
| Written before | 07a was built |
| Interface revision | tabs-documents-1;session-2 |

Guide only. Workers write code/tests against these exactcontracts; coordinator edits sharedroots/schemas and runs checks. Later groups/splits/locked folders/editors consume the same public names and serializedfields.

## Goal and exclusions

Open independent closeable folder tabs;pin/duplicate/reorder/reopenclosedtabs;restorefile/folderviewstateonrestartwhilekeepingonepermanentExplorer. Shareoneunderlyingdirtydocumentacrossmultipleviews. Groups09b,drag/contenttransfer09c,split09i,profiles10c;no detachedwindows/backlogworkspacesorAI.

## Read first

v1 09a mappedtabs/sessionsections; current services/tabs.ts/session Rustmain/TabStrip/App/FileTabView/useUnsavedChanges; allcurrenthandlerstatecodecs/04areadyrecipe andnewviewerstate07d/07g;08a ExportSnapshot/ExportHandle. CurrentSortSpec is key name/modified/size/kind and direction ascending/descending; do not invent type/type-date/asc shorthand for this existing type.

## Decisions

- D1. Add TabKind folder while preserving explorer/help/settings/gallery/file and alloldIDs. PermanentExplorer idexplorer exists exactlyonce,notcloseable/pinnable/duplicatable; otherfoldertabs canclose. Developer Components keepskindgallery. At most200tabs includingpermanent;20pinned;closedhistory50entries; folderpathabsolute/32,768UTF16units. Never allocateunboundedtabsfromsession/commandline.
- D2. Everyfoldertabownsitslisting,selection,history,columnroot,watchersandquickpreview. MountExplorerHome keyedbytabIDwithinitiallocation/state; donotshareoneglobalcurrentfolder. Active-sidecommand/status routingusesactiveTabID. Preservecomponentidentityduringreorder/docking. Inactivefolderwatcherspauseafter30s,retainboundedviewstate,releaseonclose.
- D3. Pinmovesintopinnedsegmentandusesicon/namewithaccessiblelabel; unpinmovesafterpinnedsegment. DuplicatecreatesnewviewIDwithsamevalidatedsource/viewstate butsharedDocumentRegistry forfilecontent. ReordercannotmovepermanentExplorerorcrosspinnedsegmentwithoutpin/unpinaction. Closeconfirmusescurrentunsavedcoordinator; cancelkeepsallstate. ReopenclosedrestoresnewviewIDthroughnormalopenpipeline,neveroldgrant/password/runtimehandles.
- D4. Ctrl+Tab/Ctrl+Shift+TabcycleMRUwithoutreorderingvisiblelist;Ctrl+1..8targetsvisibleorderedtabpositionsincludingpermanent,Ctrl+9last. IgnorewhenfocusedsearchownsCtrl+Tabmodecycling11a; remapping10bextendscontextrouting,notduelinglisteners. Middleclickclosescloseabletabafterdirtyconfirmation. Newfoldercommandexplorer.openInNewTab,plussplitmenufolder/Home/Help/Settings/Components.
- D5. PersistSessionState schema2 withtabdescriptors/viewstateandactivehistory,notlivecontent; settingsschema20 addsstartup.mode home/restore/folder defaulthome andstartup.folder empty. Writesdebounced500ms/atomic,flushoncleancloseafterdirtydecision. Restorevisiblefirst; lazyothers,nomorethan2opensconcurrently; noautoplay;normalprotectedview/defaultapp/grantchecks. MissingfilesgetplaceholderwithLocate/Close,notdroppedentiresession.
- D6. Serializeviewstateonlythroughhandlerregisteredvalidatedcodec(max64KiB/tab,depth8,64keys/object,strings8,192;allnumbersfinite);total session4MiB. Reject __proto__/constructor/prototype keys;no passwords/tokens/blobURLs/parserobjects. Existingimagecodec fields mode fit/manual,percentclamped,turns0-3;mediacodec speed/loop plusnewposition_ms default0 andautoplayfalse;textwrap/numbers/zoom/spellcheck plus cursor_line/column andscroll_top clamped,nevertextcontent;newPDF/3Dcodesuse their producingguiderows. Unknownhandler/codecversionpreservesrecoverableplaceholderwithoutinvokingit.
- D7. Add source-awareDocumentRegistrydescribedbelow. ExistingFileTypeInfo andpathfieldmeaningsdonotchange. DiskhandlerskeepHandlerViewProps;newdocumentpresenters/editoradaptersconsumeDocumentHandle. Virtualfilesintroduced09kusetheirownDocumentInfo/VirtualViewPropswithoutfabricatinganOSpathorpassingvirtualIDsintoexistingfilesystemcommands. SerializedvirtualrefscontainonlyopaqueentryID/containerpath,noplaintextinnerfilename/content/key.
- D8. OneDocumentRegistryentrypernormalizedsource;viewsacquirereferences;last view close runs E11 provider close policy then ordinary dirty decision once, then releases only if the entire close plan succeeds. Closingoneoftwoviewsdoesnotdiscardsharededits. Per-viewzoom/scrollremaindistinct. CaptureSnapshotalwaysimmutablecurrentrevisionthrough08a;documentcommitmustobeyprotectedview/version/approvedcontent-writecontract,neverrouteanexportoveroriginalbyaccident.
- D9. Diskcommitusesexistingtextsaveorregisteredformat-specificsafeadapter; sharednewdocumentSaveAscreatesnewnamesusingownedoutput. Existing-targetsave/replacementcapabilitymuststayfalsewhereplatformsafetyproofisnotavailable(KI-069/09f); donotclaimtheracefixedbyDocumentRegistry. NopersistedliveDocumentHandleorsnapshotID. Usermustunlockcontainersbeforevirtualrestoration.

## Uses from other steps

| Ref | Producer; exactsymbol/file | Contract |
|---|---|---|
| U1 | 04a services/tabs.ts TabState/TabsState/SessionData,openFileTab/activateTab/closeTab/setTabView/sessionFromTabs/tabsFromSession | Existingfieldskept; newoptionals/defaultsbelow,onlycoordinatormodifiescanonicalfile |
| U2 | 06a useUnsavedChanges.tsx UnsavedChanges.confirmClose(ids)->Promise<boolean>,SaveHandle | Awaitapproval; shareddocumentpromptdeduplicated; cancelneverclosesdirtyviews |
| U3 | 04a handlers/openPipeline.ts planOpen(path,registry,openWith)->Promise<OpenDecision> | Actualdiskfileopening/defaultapps/protectedview;nosession-grantreuse |
| U4 | 05c TabStrip/ToolbarDock/layout contexts | KeeponeTabStrip; currentpropslabel/onActivate/onClose,optionalnewactionssuppliedcoordinator; preserveallsides |
| U5 | 08a E4/E5 ExportSnapshot/ExportHandle/exportSnapshots;07d E8 GrantedBacking/FileGrants | DocumentHandle.captureSnapshotreturnsimmutableauthorizedsnapshot;sensitivestoragepolicyenforcedbackend |
| U6 | 02 services/explorer.ts SortSpec/ExplorerItem;05a ViewModeId;05b columnroot | ExactSortKey/directionabove; per-folderViewstateimportsactualtypes,notcopy |
| U7 | 07b QuickPreviewDialog;07c GalleryContent | Eachoriginviewhasownselection/activeflag;noquick-previewcross-tabstaleresults |

## Data shapes

Canonicaltabsinservices/tabs.ts;documenttypesin`src/documents/types.ts`,nativewiremirror`src-tauri/src/document_types.rs`;SessionTab/State nativeonesource innew`src-tauri/src/session.rs`movedbycoordinator preservingexistingpublicreexports/functions.

| Type | Exact fields/types/defaults |
|---|---|
| DocumentRef | tagged disk: pathabsoluteString/string; virtual: providerfixedlocked,container_pathabsoluteString,entry_idUUID; draft: draft_id UUID, native-created only and reserved until20a registers it. Futurevirtualproviderisnotadvertised/activeuntil09kregisters;unknownproviderrefused |
| DocumentInfo | document_idUUID; sourceDocumentRef; nameString<=255; extString<=32; mimeString<=128; sizeu64safewire; modified_unixu64; read_only/from_internet/sensitivebool; disk_pathoptionalStringpresentonlydisk. NotanaliasthatliesaboutFileTypeInfo.path |
| DocumentState | revision safeu64 starts1; saved_revision safeu64 starts1; content_id and saved_content_id UUID initially equal; dirty bool equals content_id != saved_content_id; ready boolfalse; editing_enabled boolfalse; can_save_existing boolfalse until adapter proven; can_save_copy bool; status_code optional stablecode; read_only_reason optional protected/permissions/unsupported/locked |
| DocumentHandle | TS id/source/info;getState()->DocumentState;subscribe(listener(DocumentState)->void)->unsubscribevoidcallback;readRange(offsetnumber,lengthnumber<=4MiB)->Promise<Uint8Array> of original authorized source bytes, never unsaved edits;captureSnapshot()->Promise<ExportSnapshot>;save()->Promise<boolean>;saveCopy(destPathstring)->Promise<boolean>;discard()->Promise<void>;release()->void;no rawarbitraryinvoke |
| DocumentProvider | TS id disk/locked/draft;open(refDocumentRef)->Promise<DocumentHandle>;supports(ref)->bool;registrationstaticnotcommunityplugin. Nativeproviderdoesauthorizedgrant/read/commit;JSprovidercannotauthorizefilesystempathsbyitself |
| VirtualViewProps | documentDocumentHandle;activebool;savedStateSerializableViewState|null;onStateChange(state)->void;onStatus(FileTabStatus)->void;findFindRequest;previewOnlybool;onOpenHelp(slug)->void;noFileTypeInfo/pathfabrication |
| SerializableViewState | JSONprimitive/null/arrays/plainobjectswithinD6caps; namedhandlercodecversionu32; noopaqueclassinstances/prototypekeys |
| FolderTabState | pathabsoluteString; view_modeViewModeId;sortSortSpec;group_byexistingGroupBy;column_rootoptionalabsoluteString;scroll_topfinite0-1e9;focus_pathoptionalabsoluteString; noselectedbulkcontent/listings |
| TabState additions | pinnedoptionalboolfalse;sourceoptionalDocumentRef;document_idoptionalUUIDruntimeonly;folderoptionalFolderTabStatekindfolderonly;missingoptional{reason:not_found/handler_missing/locked,original_pathoptionalString};viewexistingunknownvalidatedbeforepersist |
| SessionTab additions | sourceoptionalDocumentRef;folderoptionalFolderTabState;pinnedboolfalse;viewoptionalSerializableViewState;view_versionoptionalu32;existingid/kind/title/path/handlerretained. Forvirtualrefomitplaintexttitle/path/viewunlessencryptedinsideproviderstore |
| SessionState/SessionData additions | schema_versionu32default1onlegacyread,written2;historyStringID[]max200;existingtabs/active_tab/saved_unixretained;schema>2refusedandoriginalsessionretained,notwrittendown |
| StartupSettings | modehome/restore/folderdefaulthome;folderStringdefaultemptyonlyrequiredabsoluteifmodefolder |

DocumentInfo' disk_path isoptionalexplicitOSpath,oldFileTypeInfo.pathstillrequiredandcorrectinlegacydiskview. Add optional Handler.virtualView ComponentType<VirtualViewProps> and optional encodeViewState/decodeViewState codecs; newUIpresentersreusabledisplaylogic,notsecondhandlersystem. Existingunsupportedvirtualviewshowsopen-safe-copyactionownedby09k,neveropenscontainerasifitwereentrycontent.

## Exports for later steps

| Ref | Canonical export | Exactsignature/consumers |
|---|---|---|
| E1 | services/tabs.ts openFolderTab | (stateTabsState,folderFolderTabState,backgroundbool)->TabsState;newID,dedupnotforced;09b/c/i/10ctabsettings |
| E2 | same pinTab/duplicateTab/reorderTab/reopenClosedTab | pinTab(state,id,pinnedbool)->TabsState;duplicateTab(state,id)->TabsState;reorderTab(state,id,targetIndexnumber)->TabsState;reopenClosedTab(state,closedClosedTabDescriptor)->TabsState;purewithD1-D3guards |
| E3 | src/documents/DocumentRegistry.ts DocumentRegistry | acquire(sourceDocumentRef)->Promise<DocumentHandle>;get(idstring)->DocumentHandle|null;register(providerDocumentProvider)->void rejectsduplicate;release(id)->void; refcounted single authority. Last release disposes controller/runtime resources; it never implicitly invokes discardToSaved or writes a source.09b/c/i/k,all14-22editors |
| E4 | documents/types.ts allDocumentRef/Info/State/Handle/Provider/VirtualViewProps | Canonicalsharedinterfacesforeditors/conversion/contenttransfer; no privatecross-modulevariables |
| E5 | src/services/sessions.ts loadSession/saveSession | loadSession()->Promise<SessionData|null>;saveSession(dataSessionData)->Promise<void>;CREATE this service; move App.tsx direct invokes into it; native endpoints are get_session/save_session, not load_session |
| E6 | src/views/folders/FolderTabView.tsx | props tabIdstring,stateFolderTabState,activebool,onViewChange(state)->void,onOpenFile(path,background)->Promise<void>,onOpenHelp(slug)->void;independentExplorerHomeinstance |
| E7 | src/services/viewState.ts registerViewStateCodec | (handlerIdstring,codec{versionu32,encode(unknown)->SerializableViewState|null,decode(SerializableViewState)->unknown|null})->void;statictrustedregistrations;normalizersapplyboundsbeforecallbacks |

### Shared editing, capture and native commit: exact binding

One DocumentRegistry entry per normalized source owns one editable controller factory result. A second view must reuse that result, not construct an independent editing model. An incompatible second editable handler returns documents.editor_conflict; readonly alternate viewers may read original bytes. Controller factories are trusted app registrations, never loaded from file data. The text factory moves CodeMirror EditorState/history into one document-owned store and synchronizes every view through that store; view-specific selection/scroll stay outside its model. Later editors define their own strongly typed model registries keyed by the same document_id.

Canonical `src/documents/controller.ts` exports the following, all under tabs-documents-1:

| Export/type | Exact shape/signature |
|---|---|
| DocumentControllerContext | document_id UUID; source DocumentRef; info DocumentInfo; initial_source SourceStamp optional; initial_content_id UUID; notifyContentChanged(content_id UUID)->DocumentState; notifyReady(options {editing_enabled:boolean,can_save_existing:boolean,can_save_copy:boolean})->void |
| DocumentControllerBinding | handler_id string; capture(captured_revision number,content_id string)->Promise<ExportSnapshot>; discardToSaved(saved_content_id string)->Promise<void>; setEditingEnabled(enabled boolean)->Promise<void>; dispose()->Promise<void>. Binding owns actual mutable model/history, not metadata only |
| DocumentControllerFactory | (context DocumentControllerContext)->Promise<DocumentControllerBinding>; called once per editable document, factory Promise coalesced for simultaneous views |
| registerDocumentControllerFactory | (handlerId string,factory DocumentControllerFactory)->void; duplicate rejected; no untyped operation object crosses this interface |
| DocumentRegistry.acquireEditor | (source DocumentRef,handlerId string)->Promise<DocumentHandle>; acquires one controller then a view reference. Existing acquire(source) remains readonly until controller installed |
| notifyContentChanged semantics | Called once after successful model transaction including Undo/Redo; revision increments monotonically, supplied content_id is the immutable history-state identity. Undo to saved content restores saved_content_id, so dirty can become false while revision is newer than saved_revision |
| capture semantics | Lock only to capture immutable model revision/content_id; encode asynchronously from that immutable capture. ExportSnapshot now includes content_id UUID. No raw RGBA larger than cap: encode source-format bytes or fail snapshots.too_large; current encoded snapshot cap remains256MiB |

Saving captured revision R/content C while later revision R+1 exists updates only saved_revision=R/saved_content_id=C. Current revision/content_id remain untouched; dirty is recalculated from content identities. SaveCopy creates an independent file and does not mark the original clean or rebind its source. Rebinding Save as is not silently added. Native source-identity validation is independent of UI edit revision.

| Native command; TS service in services/documents.ts | Exact inputs -> outputs |
|---|---|
| document_open; openDocumentSource | source DocumentRef -> {document_id UUID,info DocumentInfo,token exactly32lowercasehex string,source_stamp SourceStamp optional}; readonly initial grant; native registers the same document_id/name/mime/source/sensitive in08a SnapshotAuthorityRegistry before returning |
| document_release; releaseDocumentSource | document_id UUID ->unit, idempotent |
| document_snapshot_begin; beginDocumentSnapshot | request {document_id UUID,captured_revision safeu64,content_id UUID,mime string<=128,byte_len safeu64<=256MiB} ->08a {snapshot_id,upload_token}; use same08a append/finish, no second upload protocol |
| document_commit_start; commitDocumentSnapshot | request DocumentCommitRequest ->DocumentCommitResult; bounded async shared job if provider requires work, fixed wrapper returns Promise<JobHandle<DocumentCommitResult>> via document_commit_start(request_id,request), not a variable return type |
| DocumentCommitRequest | document_id UUID;snapshot_id UUID;captured_revision safeu64;content_id UUID;expected_source SourceStamp optional;mode save/copy;dest_path optional absolute string required forcopy; no caller-chosen sensitive policy |
| DocumentCommitResult | saved_revision safeu64;content_id UUID;new_source SourceStamp;output_path absolute string;mode save/copy. Native checks snapshot document/revision/content/source and provider permission; no comparison against an imaginary native live editor revision. Locked source has can_save_existing=false and rejects mode save until its exact replacement proof exists;09k encrypted pending/recovery persistence is separate and never marks original saved |

Native `src-tauri/src/document_grants.rs` imports GrantedBacking and FileGrants.grant_backing/resolve_backing from07d E8; it never defines another enum or changes token format. Document providers return the existing Disk or Memory backing, with the same256MiB per-source/1GiB aggregate memory budget and Arc-held range lifetime. Existing grant(PathBuf),revoke(&str),path_for(&str) keep meanings; path_for remains None for memory. Source descriptors cannot turn a token into an OS path.09k supplies its authorized memory provider or returns documents.provider_missing. No fs-service/cache-store dependency cycle is added. T2 tests existing32hex tokens accepted, hyphenatedUUID tokens refused, memory grants have no path and releasing one view does not revoke another view's backing.

### Multiplexed directory watchers and UI history

| Export | Exact contract |
|---|---|
| E8 services/explorer.ts watchSubscribe/watchUnsubscribe | watchSubscribe(path string,listener(FsWatchEvent)->void,options optionalWatchOptions)->Promise<WatchSubscription>; watchUnsubscribe(subscriptionId string)->Promise<void> idempotent. WatchOptions {recursive:boolean defaultfalse}. Native watch_subscribe(path,options defaultedWatchOptions)->WatchSubscription,watch_unsubscribe(subscription_id)->unit; event fs-watch. Subscription {subscription_id UUID,root absolute string,generation safeu64}; event {subscription_id,root,generation,kind create/change/remove/rename/overflow/error,path optional absolute string,old_path optional absolute string,error_code optional string}. old_path only when paired, never assumed available |
| Watcher ownership | Native map max128 subscriptions, deduplicate same root handle with referencecounts; separate routing IDs per consumer. Batch<=1024 events/100ms/768KiB; overflow emits overflow and requests bounded rescan. Stop only requested subscription; legacy watchStart/watchStop wrap one legacy-owned subscription. Inactive folder views release after30s, reactivation subscribes/rescans; no global watchStop from one tab |
| E9 src/services/uiHistory.ts UiHistoryRegistry | registerAdapter(id string,adapter{validate(state SerializableViewState)->boolean;apply(state SerializableViewState)->Promise<void>})->void;record(adapterId string,before SerializableViewState,after SerializableViewState)->stringUUID;apply(id string,reverse boolean)->Promise<void>;releaseUnreferenced(ids readonlystring[])->void. Session-only100records/16MiB total, eachstate<=4MiB. Validate and reserve before mutation, fail ui_history.limit without dropping retained entries |
| FileAction addition | type uiState with id UUID/reverse boolean; executeFileAction dispatches UiHistoryRegistry.apply before confirming global cursor. Existing file actions unchanged; never serialize closures |
| E10 src/services/tabHistory.ts TabHistory | record(before SessionData,after SessionData,labelKey string,labelArgs optionalRecord<string,string|number>)->UndoEntryInput;apply(id string,reverse boolean)->Promise<void>;releaseUnreferenced(ids readonlystring[])->void; delegates E9 adapter tabs, validates/restores via normal09a host. Record descriptors only, never dirty contents/tokens. Failure leaves cursor unchanged |

T2 adds controller/binding/native snapshot/commit tests including savingRwhileeditingR+1, Undo-to-saved dirty=false, same editable model reused, incompatible factory refused, SaveCopy not clean. T4 creates watcherMultiplexer.ts/native watcher_sessions.rs and tests two roots routed independently, one unsubscribe retains other, overflow rescans and stale generation ignored. T3 adds uiHistory.ts/tabHistory.ts/global FileAction dispatch and tests retained capacity/failing restore. All new source modules stay under400 lines; coordinator edits App/Explorer roots at<=40lines/task. Translation additions: errors.documents.editor_conflict = “This document is already open in another editor.” / “Este documento ya está abierto en otro editor.”; errors.ui_history.limit = “The action history is full. Finish or clear retained actions before continuing.” / “El historial de acciones está lleno. Termina o borra las acciones retenidas antes de continuar.”; errors.watch.limit = “Too many folders are being watched. Refresh this view manually.” / “Se están supervisando demasiadas carpetas. Actualiza esta vista manualmente.”

### E11: provider-specific atomic close preparation

Canonical `src/documents/closePolicies.ts` fixes DocumentCloseReason as tab/group/split/app/lock, DocumentProviderId as disk/locked/draft, and DocumentClosePolicy with method prepareClose(documents:readonly DocumentHandle[],reason:DocumentCloseReason)->Promise<boolean>. registerDocumentClosePolicy(providerId:DocumentProviderId,policy:DocumentClosePolicy)->void registers once per provider and rejects a duplicate. It is a trusted app registration; no dynamic policy from file data. Disk has no default override and uses the ordinary unsaved dialog.09k installs the locked policy once when its native provider is registered, not once per tab or view.

prepareDocumentClose(documents:readonly DocumentHandle[],reason:DocumentCloseReason)->Promise<boolean> is the only host entry for app/group/split/tab/lock close preparation. Build the full proposed close set and deduplicate by document_id; only pass documents whose last live view would close. Snapshot their current revision/content_id and freeze the proposed view removals until preparation ends. Run registered policies grouped by provider, then collect generic dirty decisions only for unhandled disk documents. The coordinator updates the useUnsavedChanges bridge to collect Discard intent without calling discard/reset before all decisions pass; Save may complete safe persistence, but view/model disposal waits for whole-plan approval. A provider Discard choice likewise records intent only until commit. Never call the old sequential discard-then-prompt path for a multi-document close. A policy resolving true handles that provider's dirty decision for exactly the captured content identities; it does not change dirty or saved IDs. If any policy/dialog returns false, throws, persistence fails, or any prepared content_id changes before close, the entire close plan returns false: remove no tab, release no view/controller, discard no content and keep active/group/split state unchanged. Successfully persisted recovery/copy artifacts may remain as independent safe results after cancellation; they do not authorize a partial close. New edits during preparation require re-preparation rather than treating stale persisted content as current.

The locked policy offers only09k's explicit Keep encrypted recovery, Save encrypted copy, Discard and Cancel. It returns true only when each current captured content_id has been verified in encrypted persistence or the user explicitly chose Discard. SaveCopy never rebinds/marks clean. DocumentRegistry.release on successful last close only cancels/revokes/disposes the model; it never calls discardToSaved for a locked entry. An explicit user Discard still goes through the provider policy; do not turn generic Save into a fake encrypted original commit. All actual prompts/text/native encrypted jobs are defined in09k;09a supplies the typed policy registry/atomic host integration.

T2 creates closePolicies.ts and its registry/lifetime tests. T6 updates all close entry points/useUnsavedChanges bridge to E11, preserving normal disk Save/Don't save/Cancel semantics. Exact tests: duplicate_provider_close_policy_refused; closing_one_of_two_views_never_calls_policy; locked_policy_cancel_keeps_all_group_tabs_and_models; app_close_disk_cancel_after_locked_persist_removes_zero_tabs; content_changed_after_prepare_requires_new_policy; last_release_disposes_without_discard_to_saved; encrypted_copy_does_not_rebind_or_clear_dirty. Inject policy/dialog/persistence fakes; workers write tests and coordinator executes them.

## UI, commands and exact keys

ExistingTabStripheight40/status28/address56; foldertabsusefoldericon/filetabsretainaccents. TabmenuPin/Unpin/Duplicate/Reopen;plusOpenfoldertabbutton; tablistrole/tab/tabpanelwitharia-selectedandcontrolledfocus,closebuttonlabelcontainsfilenameviaICU. Missingplaceholdercenteredmax480px,Locate/CloseButtons. Inactivetabcontentnotannouncedasactiveanddoesnotconsumecommands.

| Key | English | Spanish |
|---|---|---|
| tabs.newFolder / tabs.pin / tabs.unpin / tabs.duplicate / tabs.reopen | New folder tab / Pin tab / Unpin tab / Duplicate tab / Reopen closed tab | Nueva pestaña de carpeta / Anclar pestaña / Desanclar pestaña / Duplicar pestaña / Volver a abrir pestaña cerrada |
| commands.openInNewTab | Open in new tab | Abrir en una pestaña nueva |
| tabs.closeNamed | Close {name} | Cerrar {name} |
| tabs.locate / tabs.missing / tabs.handlerMissing / tabs.locked | Locate… / This file could not be found. / This viewer is not available. / Unlock this folder to restore its file. | Buscar archivo… / No se encontró este archivo. / Este visor no está disponible. / Desbloquea esta carpeta para restaurar su archivo. |
| startup.title / startup.home / startup.restore / startup.folder | Startup / Open Home / Restore tabs / Open a folder | Inicio de la aplicación / Abrir Inicio / Restaurar pestañas / Abrir una carpeta |
| errors.tabs.limit / errors.tabs.invalid_state | Up to 200 tabs can be open. / This saved tab state is not valid. | Puedes abrir hasta 200 pestañas. / Este estado de pestaña guardado no es válido. |
| errors.documents.provider_missing / errors.documents.changed / errors.documents.read_only | This document source is not available. / The document changed. Try again. / This document cannot be changed here. | Esta fuente de documento no está disponible. / El documento cambió. Vuelve a intentarlo. / Este documento no se puede cambiar aquí. |

Eachslashrowindependentfullkeys. Commands tab.pin/tab.unpin/tab.duplicate/tab.reopenClosed andexplorer.openInNewTab;labelkeysabove,iconsPin/PinOff/Copy/Undo2/FolderPlus; Ctrl+Shift+T reopen, existingCtrl+Wclose,Ctrltab/digitsD4;contextscopedhelpworking-with-tabs/sessions. No shortcutsstolenfromtextediting.

## Tasks

| Task; commit | Files/work | Tests/exactoracles |
|---|---|---|
| T1; `feat(tabs): bounded folder and document descriptors [step-09a/T1]` | coordinatorcanonicaltabs/sessiontypes;newdocuments/types.ts,session.rs,folder-statehelpers. D1/D6/D7/E4. | duplicatepermanentExplorerfixedtoexactlyone;201strefused;virtualtitle/tokennotserialized;existinglegacyfiletabmigrateswithoutpathmeaningchange |
| T2; `feat(documents): shared revision and lifetime registry [step-09a/T2]` | DocumentRegistry.ts,documents/closePolicies.ts,services/documents.ts,nativedocuments.rs/document_grants.rs; native08a SnapshotAuthorityRegistry registration/revocation;D7-D9/E3/E4. | twoacquiresonesourceonedocument; closeoneviewretainsdirtysecond; lastreleasecancels/revokes; absentlockedproviderfailsexplicit; snapshotrevision1unchangedafteredit2 |
| T3; `feat(tabs): pin duplicate reorder and reopen [step-09a/T3]` | newtabActions.ts/tabHistory.ts pluscoordinatorcanonicalreducers. E1/E2,pinnedsegment/MRU/bounds. | permanentcannotclose/pin; pinnedcannotcrosssegmentonreorder;duplicatehasnewviewID/samedocID;closedhistory51keepsnewest50;MRUcyclekeepsvisibleorder |
| T4; `feat(explorer): independent folder tab views [step-09a/T4]` | FolderTabView.tsx/useFolderTabState.ts;coordinatorExplorerHomeinitialstate props/Appmount/key/status. | folderAselectiondoesnotchangeB;inactivewatcher30sreleased;reorderkeepscomponentidentity;onefolderpreviewdoesnotcontrolanother |
| T5; `feat(sessions): bounded view-state restore [step-09a/T5]` | services/viewState.ts/sessions.ts/sessionValidation.ts;coordinatorRustsave/load/schema20startupsettings/codecs. | imagefit/manualturnspreserved;mediaautoplayfalse; prototypekey/depth9/64KiB+1rejected;schemanewerretainednotdowngraded; activefirst/max2opens; missingfileplaceholderkeepsothers |
| T6; `feat(tabs): dirty-safe tab controls and keyboard routing [step-09a/T6]` | tabKeyRouting.ts/TabContextMenu.tsx;coordinatorTabStrip/App/useUnsavedChangesregistrybridge. | close awaits E11 atomic policy/dialog plan;cancel keeps every affected view/model;Ctrl+9last;searchfocusedCtrl+TabdoesnotactivateotherTab;sharedDocpromptonce;virtualnoDiskinvoke |
| T7; `docs(help): tabs and startup sessions [step-09a/T7]` | helppagesbelow;coordinatorkeys/pseudo/measures. | allcommandshelp; bilingualmissing/limit/close labels;startupmigration19keepsupdates/privacy; noexecutedtestclaimsfromworkers |

Tests newtabs/session/documents/folderTabs/tabKeyboard.test.ts(x), nativevalidationmoduleunitcaseswithinjectedproviders. Underlyingfile/snapshot/sourcepermissionsmustalsohavereviewer-runintegrationtests; no inventedclosedtabrestorewithoutnormalopen.

## Full help

`working-with-tabs.md`, English **Working with tabs**. Intro: “Keep several folders and files open while you work.” How to use: “Use **Open in new tab** for a folder or choose **New folder tab** from the plus menu. Right-click a tab to pin, duplicate or close it. Use Ctrl+Tab to switch and Ctrl+Shift+T to reopen a closed tab.” Good to know: “The permanent Explorer tab cannot close. Folder tabs keep independent views. Two views of one edited document share its changes, so closing one view does not throw away the other.” Last: `See also: "Sessions" and "Opening files".` Spanish **Trabajar con pestañas**: “Mantén abiertas varias carpetas y archivos mientras trabajas.” Cómo usar: “Usa **Abrir en una pestaña nueva** para una carpeta o elige **Nueva pestaña de carpeta** en el menú del signo más. Haz clic derecho en una pestaña para anclarla, duplicarla o cerrarla. Usa Ctrl+Tab para cambiar y Ctrl+Mayús+T para volver a abrir una pestaña cerrada.” Para tener en cuenta: “La pestaña permanente del Explorador no se puede cerrar. Las pestañas de carpetas conservan vistas independientes. Dos vistas de un documento editado comparten sus cambios; cerrar una no descarta la otra.” Last: `Consulta también: «Sesiones» y «Abrir archivos».`

`sessions.md`, English **Sessions**. Intro: “Choose whether to restore your tabs after restarting.” How to use: “Open **Settings > Startup** and choose **Restore tabs**. Close and reopen the app to restore folder locations and supported file positions. Use **Locate…** when a saved file moved.” Good to know: “Passwords, live access permissions and unsaved document contents are not stored in the session. Unsaved recovery is handled separately. Missing files do not prevent other tabs from opening. Locked folders must be unlocked again.” Last: `See also: "Working with tabs" and "Unsaved changes and recovery".` Spanish **Sesiones**: “Elige si quieres restaurar tus pestañas después de reiniciar.” Cómo usar: “Abre **Configuración > Inicio de la aplicación** y elige **Restaurar pestañas**. Cierra y vuelve a abrir la aplicación para restaurar carpetas y posiciones compatibles. Usa **Buscar archivo…** si un archivo guardado cambió de lugar.” Para tener en cuenta: “La sesión no guarda contraseñas, permisos de acceso activos ni contenido sin guardar. La recuperación de cambios es independiente. Los archivos que faltan no impiden abrir las demás pestañas. Las carpetas bloqueadas deben desbloquearse de nuevo.” Last: `Consulta también: «Trabajar con pestañas» y «Cambios sin guardar y recuperación».`

## Check by hand / speed / screenshots

RetainedfoldersA/Bwithdistinctfiles;localtext/PDF/imageatknownscroll/zoom;onefilemovedafterclose;legacy/newer/malformedsessionfixtures; dirtydocumenttwoviews. Coordinatorchecksalltabactions/restart/MRU/pin/dirty/missing/protected/noautoplay/independentviews,Spanishdark/pseudo/keyboard/200%zoom. Sourcefilesunchangedbyrestoringreadonlyviews.

Measures step09a.tab.switchInstant0.1s,folderfirstrowsFast1s,reopenfirstviewFast1s,sessionvisiblefirstFast1splusprogressforremaining; memoryboundedby200tabs/8mountedfileviews. Reserve91-folder-tabs,92-session-restore,threevariants. Recordactualrestorelatency/watchers/leaks,notassumedperformance.

## Done when

- [ ] ExactE1-E11 and DocumentRef/Handlecontractssharedwithalllatergroups/splits/virtual/editorguides; noAPIguessing/copytypes.
- [ ] Independentfolderstate,tabactions/keyboard/dirtysharing,normalopenandboundedhonestsessionrestoretestedbyreviewer.
- [ ] Nativevirtualproviderdoesnotexistyetandisnotfalselyadvertised; future09kregistrationcanextendwithoutpathfabrication.
- [ ] Coordinatorchecks/gate/package/help/locale/accessibility/screenshot/speed/reportdonebeforeimplementationacceptance.

### Native draft registration and explicit Save as new (E12/E13)

These are additive tabs-documents-1 producer contracts for20a/22a/b.09a reserves draft source parsing/types but does not advertise a successful draft producer before20a. Canonical native `src-tauri/src/document_drafts.rs` exposes register_document_draft(document_id:uuid::Uuid,draft_id:uuid::Uuid,name:&str,mime:&str,initial_backing:Arc<GrantedBacking>,handler_id:&str,sensitive:bool)->Result<NativeDocumentRegistration,DocumentError>. Only a trusted static native creator calls it; there is no browser command accepting a backing or sensitive=false. Validate native-issued IDs, registered controller handler, original backing classification, name1-255/mime1-128. NativeDocumentRegistration fields document_idUUID,infoDocumentInfo,token32lowerhex,sensitivebool,source_generationu64. It uses the existing Documents/authority tables, not a second document registry. Max32drafts/1GiB aggregate; grant/capture budgets remainlowerper-source. Resolve unregistered draftUUID as documents.provider_missing, never empty success.

DocumentRef includes kind draft {draft_id UUID}; DocumentProviderId includes draft. Draft metadata has no disk_path, no fabricated SourceStamp. A native approved blank encoder creates source-format memory bytes; initialrevision/saved_revision1,content_id/saved_content_id equal. A generated edit produces a newcontentidentity normally. Ordinary source policy is inherited from native-authorized creator context; sensitive source remains sensitive. Draftsessions contain only a recovery placeholder, not live draftgrant/backing bytes;09h Open recovered copy handles restart after an explicit userdecision. FileTypeInfo.path remains realOSpath forlegacydiskviews.

E12 canonical `src/services/documents.ts` saveDocumentAsNew(document:DocumentHandle,destPath:string)->Promise<JobHandle<DocumentRebindResult>>; native document_save_as_new_start(request_id,request:DocumentSaveAsNewRequest). Request fields document_idUUID,snapshot_idUUID,captured_revision safeu64,content_idUUID,expected_source_generation safeu64,dest_path absolute string. Wrapper captures one immutable encoded model using09a/08a, retains lease, then starts nativejob. DocumentRebindResult fields commit DocumentCommitResult,previous_source DocumentRef,new_source DocumentRef(disk),source_generation safeu64,reboundbool,output_pathstring. This is distinct from SaveCopy; SaveCopy does not rebind or mark original clean.

Algorithm: reserve one source-change operation/document; validate authority/current sourcegeneration/output MIME/target directory and ensure destination is not already bound to another live editable document. Sensitive documents refuse genericrebind with documents.sensitive_copy_required before any write; only an explicit separately authorized unencrypted-copy flow can create an ordinarycopy. Write captured bytes through owned output, flush/verify, publish no-replace. Revalidate current sourcegeneration, then atomically update native source-key/document authority mapping and allview/session descriptors for this documentID, preserving model/history/view IDs. Original file/container is untouched. Update saved_revision/contentidentity only to captured values; later edits remain dirty. Increment source_generation once. Concurrent rebind, foreign target appearance or authorization change fails without overwrite. If new file was published but mapping/persistence fails, retain file,return truthful rebound=false/output_path and keep originalsource/model dirty; never delete the user result as cleanup.

E13 adds `DocumentRegistry.applyRebind(result:DocumentRebindResult)->Promise<void>`: only after a verified native result, updates the existing shared handle's source/info and every same-document view atomically; no controller recreation and no arbitrary caller DocumentRef. Native-backed result ID must match the source generation; a stale/forged result does nothing.20a/20b/21a/22a route ordinary Save as onto this exactmethod. Locked Save encrypted copy remains its own non-rebinding09k route.

T2 creates draft/native-authority types and tests forged_draft_ref_refused,one_native_registration_per_document,source_sensitivity_not_downgraded,initial_revision_one. T5/T6 create documentSaveAsNew.ts/document_rebind.rs/coordinatorviewhost wiring and tests newpath_only_no_overwrite,all_shared_views_rebind_once,save_capture_R_with_edit_Rplus1_still_dirty,sensitive_rebind_refused_before_write,bound_destination_refused,postpublication_failure_keeps_actual_output,SaveCopy_no_rebind. Added exact errorpairs errors.documents.sensitive_copy_required = “Choose an explicit unencrypted copy before leaving the protected source.” / “Elige una copia explícita sin cifrar antes de salir del origen protegido.”; errors.documents.rebind_failed = “The new file was kept, but this document could not switch to it. Review the reported location.” / “Se conservó el archivo nuevo, pero el documento no pudo cambiar a él. Revisa la ubicación indicada.”

Native DocumentError canonicaldocument_types.rs variants Invalid/ProviderMissing/EditorConflict/ReadOnly/Changed/TooLarge/TooManyOpen/SensitiveCopyRequired/RebindFailed/Io; mapto documents.invalid/provider_missing/editor_conflict/read_only/changed/too_large/too_many_open/sensitive_copy_required/rebind_failed/io, neverreturnrawcredential/providerexceptiontext. Register_document_draft is a trusted native snake_case function, not a TauriIPCcommand.


### Snapshot output MIME registration

T2 registers each trusted document encoder output MIME with08a SnapshotAuthorityRegistry.permit_capture_mime(document_id,mime), retaining the native source classification. A capture upload begins only for a native-authorized output MIME, document/revision/content identity and registered encoder; the source MIME is descriptive and is not compared as though JPEG-to-PNG conversion were forbidden. The bounded16-entry allowlist is native-only. A browser request cannot add a MIME, grant an arbitrary output format or lower sensitive=true. T2 tests authorized_derived_mime_allowed, unregistered_capture_mime_refused and capture_mime_keeps_sensitive.
