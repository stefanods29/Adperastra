# Step 09i: Split views within tabs

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-09i-split-view |
| Tag | v0.1.9-step09i |
| Depends on | 09a tabs-documents-1/session-2;09b saved-groups-1;09c content-transfer-1 |
| Written before | 07a was built |
| Interface revision | split-view-1; scroll-sync-1 |

Guide only; no worker execution. Coordinator owns shared unions, roots, registries and all tests/build/package/runtime verification. Code writing can overlap with producers after exact contracts are frozen.

## Goal / exclusions

Show two files, or a file and a folder, inside one tab with a movable divider, active-side ribbon, swap/close controls and compatible sync scrolling. Restore splits through sessions and saved groups. No nested splits, detached windows, simultaneous edits to independent copies of one document, file modification merely from splitting or AI comparison.

## Read first / uses

Read mapped v1 09d split paragraph;full09a/b/c;currentTabStrip,FileTabView,ExplorerHome,ToolbarDock/ribbonhost/session/codecs. Existingcomponentlogicremainscoordinator-owned; newSplitView hostcomposesitthroughpublicpropsbelow.

| ID | Producer/task and exact export | Required use |
|---|---|---|
| U1 | 09a E3/E4 DocumentRegistry/DocumentHandle/DocumentRef/VirtualViewProps | Referencecount per leaf, shareactualcontrolleracrosstwo views, independentselection/scroll. Lastviewdirtycoordinationawaited |
| U2 | 09a E6 FolderTabView; E1/E2 tabsreducers;E5sessions | Eachfolderleafownslisting/watcher/state; compositeoutertabdoesnotcreateanotherExplorerstore |
| U3 | 09b SavedTabDescriptor/catalognormalizers | Extendalloweddescriptorunionwithsplitbelow, preservenestedsecretcaps; notunboundedrecursiveSessionTab |
| U4 | 09c TransferRegistry/useTabDropTarget/contentpayloads | Internal/externaldropactionsrouteactiveleaf; no assumededitabletargetbeforeitsadapterregisters |
| U5 | 04b/05c existingribbon/layout/context;09dpalette | Activeleafsuppliesonecommandcontext/ribbon/status/help; toolbarsstilldockwithToolbarDock |
| U6 | 09a E10TabHistory,06a confirmClose,documentregistrycontroller | Allsplit/unsplit/swap/close structuralhistoryusesdescriptorswithoutcontent; no duplicateunsavedprompt |

## Decisions

1. Add TabKind split; outertabcountsoneof200, leavesmax2. Files/folderseligible, permanentExplorer/singletonHelp/Settings/Componentsandpinnedtabsarenotconsumed. NormalOpeninsplitcreatesdestinationleafthroughnormalpipeline; tab-to-tabdragconsumesonlytwoeligibleunpinnedtabsafterdirty/reparentchecks, notclosesdocuments.
2. `vertical` means left/right divider; `horizontal` means top/bottom. Ratiofirstfraction0.2-0.8default0.5; leavesmin240pxwidth/180pxheight. BelowtotalminimumshowactiveleafandaccessibleSide1/Side2switcher,retainlayout/ratio,neverhidefocusedcontrolbehindclipping. Divider6pxhitarea,1pxvisiblebordertoken; pointercapture,RAFresize,Escrestore;keyboardArrows1%/Shift5%,Home50%.
3. Leafcontentisownedby stableview_id, separatefromoutertabID. Reparenting may safely remount a presentation view: capture validated per-view selection/scroll first, retain the document-owned controller/reference, then remount with the same view_id and restored state. Do not rely on React keys preserving a component moved to another parent. Dispose only presentation resources, never shared model/history. Constructonehostperleaf,neverduplicateactualeditingmodel. Closingoneleafawaitslast-viewdirtydecisionthenpromotessurvivortonormaloutertabwithsameouterIDandcontent_view_id=survivorview_id; releaseonlyclosedleaf.
4. Focusing/clickinginleafsetsactive_side first/second beforedispatchingcommands. Activeleafaccentbar2pxandtextualSide1/Side2indicator;outertabshowsbothnames,notMicrosoftbrandlabels. OneAppcommandrouterreadsactiveleaf,notlastmountededitor. Ctrl+Wcloseswholeoutertabafterbothleafdirtydecisions; explicitCloseSidebuttononlyclosesleaf. TabnavigationCtrl+Tabstilloutertabs; F6cyclesleaf1/leaf2/toolbaraccordingcurrentfocusrouting.
5. Swapexchangesleafpositionsandsetsactive_sidetoitspreviousdocument'snewposition; document/viewIDsandmodelsunchanged. Changesplitdirectionpreservesratio. EachstructuralactiononeTabHistoryentry; resizingcommitsoneentryonpointerup,notperpixel. Noappfilemodification.
6. Syncscrolloffdefault; enableonlywhenbothleavesregisterScrollSyncPort. Portsreportnormalizeddocumentprogress0..1; PDF formula ((page-1)+within_page_fraction)/page_count; text/documenttotalScrollableOffsetratio,zeroextent=>0. UsermotionapplieslatestprogressonceperRAFtootherportwithmonotonicgeneration/origin=sync; recipientmustnotreemitassourceuser. Nooscillationorreversedscroll; inactiveleafstillreceivesonlyifmounted/compatible.
7. Session2addsoptional split field, nestedleafdescriptorsexplicitlynonrecursive. Max64KiBviewstateperleafand4MiBglobalsession; lockedvirtualleafomitsplaintexttitle/view. Savedgroupsreuseexactsplitdescriptor. Unknownkind/providercreatesownmissingplaceholder; othersideopens. Max2totalconcurrentopensacrossnormalandsplitrestore, not2perleaf.
8. NoSettingsbump;incoming/outgoing25. Splitstateisper-tab/session,notglobaldefaults. Groupmembershipbelongsoutertabonly; leavescannotbelongindependentlytogroups.

## Data and exports

Canonical `src/services/splitViews.ts`, native sessionmirror `src-tauri/src/split_types.rs`; syncport `src/views/split/scrollSync.ts`.

| Type | Exact fields/validation |
|---|---|
| SplitSide | first/second |
| SplitLeaf | view_id string<=128;kind file/folder;source optionalDocumentRef requiredfile;handler optionalstring<=64 requiredfile;folder optionalFolderTabState requiredfolder;title optionalstring<=512 onlynonsensitive;view optionalSerializableViewState;view_version optionalu32;missing optional09aMissingDescriptor. No split/group/pinned/childrenfields |
| SplitState | first SplitLeaf;second SplitLeaf;direction vertical/horizontal;ratio finitef64[number]0.2-0.8;active_side SplitSide;sync_scroll boolfalse |
| TabState additions | kind split;split optionalSplitState requiredkindsplit;content_view_id optionalstring forpromotedsurvivor. Legacytabidremainsviewidentityifcontent_view_idabsent |
| SavedSplitDescriptor | kind split;split SplitState withserializedvalidatedview/source/folderonly;view_idfreshonrestore; no nativehandles/tokens/runtimeactiveflags |
| ScrollSyncState | progress finite0..1;origin user/sync;generation safeu64 |
| ScrollSyncPort | view_id string;kind pdf/text/document/version;getProgress()->number;setProgress(progress number,generation number)->void;subscribe(listener(ScrollSyncState)->void)->unsubscribe;dispose()->void |
| SplitViewProps | tab_id string;state SplitState;active bool;host SplitHost;onChange(state)->void;onCloseSide(side)->Promise<void>;onOpenHelp(slug)->void |
| SplitHost | renderLeaf(leaf SplitLeaf,active boolean,onFocus()->void)->ReactNode;getScrollPort(viewId)->ScrollSyncPort|null;dispatchToLeaf(viewId,commandId string,arg optionalstring)->void;beginClose(leaves readonlySplitLeaf[])->Promise<boolean>. Trustedappcomposition, notserializedfiledata |

| ID | Exact export | Signature/consumers |
|---|---|---|
| E1 | splitViews.ts createSplitTab/swapSplitSides/setSplitRatio/closeSplitSide | create(state TabsState,firstId string,secondId string,direction)->TabsState;swap(state,id)->TabsState;ratio(state,id,value)->TabsState;close(state,id,side)->TabsState afterhostconfirmation;purevalidation, invalidthrows splits.invalid.09c/09d/10c |
| E2 | splitViews.ts serializeSplit/restoreSplit | serialize(state SplitState)->SavedSplitDescriptor|null;restore(descriptor SavedSplitDescriptor)->SplitState validationwithfreshviewIDs; normalopenbelongshost,notpurefunction.09a/09b |
| E3 | scrollSync.ts registerScrollSyncPort/resolveScrollSyncPort | register(port ScrollSyncPort)->unsubscribe;resolve(viewId string)->ScrollSyncPort|null; duplicatesrejected,closedviewrevoked.07dPDF/06atext/13Office/20bregistertheirport |
| E4 | scrollSync.ts linkScrollPorts | (first ScrollSyncPort,second ScrollSyncPort)->disposecallback;oneRAFsubscriptionpair,initialalignmentfromactivesideprovidedbyhostbeforelink;disposecancelsRAF/unsubscribes |
| E5 | `src/views/split/SplitView.tsx` | SplitViewProps; `SplitDivider.tsx` propsdirection/ratio/min/max/onPreview/onCommit/onCancel; readfromstate,neverqueryothercomponentprivateDOM |

Everyserializednewfieldvalidatedinnativeget_session/save_sessionandcatalogimport; unknownprototype/deeprecursivevaluesrefused. Errorssplits.invalid/splits.unsupported/splits.limitmappedbelow; no newfilebytesIPC/nativefilecommandneeded.

## Exact texts / UI / commands

| Key | English | Spanish |
|---|---|---|
| splits.open / splits.title / splits.vertical / splits.horizontal | Open in split view / Split view / Side by side / Above and below | Abrir en vista dividida / Vista dividida / Lado a lado / Arriba y abajo |
| splits.swap / splits.sync / splits.closeSide | Swap sides / Sync scrolling / Close this side | Intercambiar lados / Sincronizar desplazamiento / Cerrar este lado |
| splits.first / splits.second / splits.active / splits.divider | Side 1 / Side 2 / Active side: {side} / Resize split | Lado 1 / Lado 2 / Lado activo: {side} / Ajustar división |
| splits.syncUnavailable / splits.compact | These views do not both support synchronized scrolling. / The window is too small for both sides. Choose a side to show. | Estas vistas no admiten ambas el desplazamiento sincronizado. / La ventana es demasiado pequeña para ambos lados. Elige el lado que se mostrará. |
| errors.splits.invalid / errors.splits.unsupported / errors.splits.limit | This split view is not valid. / These tabs cannot be combined in a split view. / A split view can contain only two sides. | Esta vista dividida no es válida. / Estas pestañas no se pueden combinar en una vista dividida. / Una vista dividida admite solo dos lados. |

Commandtab.openSplit (Columns2),tab.splitSwap(ArrowLeftRight),tab.splitVertical(Columns2),tab.splitHorizontal(Rows2),tab.splitSync(Link2);labelkeysabove,helpslugsplit-view,riskchangeappstate,noglobaldefaultshortcuts. ControlsreuseIconButton/Tooltip/formatShortcut. Rolesgroupperleafwithtranslatedsidelabel;dividerseparatororientationperaxis/aria-valuenowratio*100/min20/max80;activeoutline/focusvisibleuseaccenttoken;CSSadp-split-view/adp-split-leaf/adp-split-divider/adp-split-compact. Hiddencompactleafinert/aria-hidden,noactivekeyboardlistener.

## Tasks / exact tests

| Task/commit | Files/work/dependencies | Required tests and oracle |
|---|---|---|
| T1 `feat(splits): bounded leaf and session descriptors [step-09i/T1]` | splitViews.ts/splitValidation.ts/split_types.rs;coordinatorTabKind/session/catalogunions;U1-U3 | splitViews.test.ts:nestedsplitrefused;legacytabunchanged;virtualtitleomitted;ratioNaNrefused;missingonesidedoesnotdropother |
| T2 `feat(splits): identity-preserving split transactions [step-09i/T2]` | splitActions.ts/splitHost.ts;U1/U2/U6/E1 | splitActions.test.ts:twotabsconsumedoneouter;stableviewIDs/sharedmodelretainedacrosspresentationremount;swapactivefollowscontent;closelastsavedcancelpreservesboth;survivorsameouterID;oneUndo |
| T3 `feat(splits): accessible resizable leaf host [step-09i/T3]` | SplitView.tsx/SplitDivider.tsx/styles/splitView.css;coordinatorhost/ribbon/status | splitViewUi.test.tsx:keyboard1%/Shift5%;Home0.5;Escoriginalratio;minwidthcompactnotclip;activeleafcommands/F6;CtrlWwholeouter |
| T4 `feat(splits): bounded synchronized scroll ports [step-09i/T4]` | scrollSync.ts/useScrollSync.ts;coordinatorPDF/textpublicportbindings;U4/U5/E3/E4 | scrollSync.test.ts:PDF2of4within.5=>0.375;target2page=>page1within.75;syncnotreemit;disposecancelsRAF;extent0=>0;latestRAFwins |
| T5 `feat(splits): restore and transfer routing [step-09i/T5]` | splitRestore.ts/splitDropRouting.ts;coordinator09a/b/cpalette;U2-U5 | splitRestore.test.ts:global2openlimit;normalprotectedpipeline;dropsgoactiveleaf;groupbelongsouter;closingoneleafkeepssharedmodel |
| T6 `docs(help): split views and scrolling [step-09i/T6]` | twohelpfilesbelow;coordinatorlocales/pseudo/measures/shots | bilingualhelp/keyboard/commandIDsunique;oldtab/sessiontestsupdatedadditiveassertions,noskip |

## Full help

`split-view.md`, English **Split view**: “Keep two compatible views inside one tab.” How to use: “Choose **Open in split view**, or drag an eligible tab onto another tab's split target. Choose **Side by side** or **Above and below**. Drag the divider or focus it and use the arrow keys. Choose **Swap sides** to exchange positions.” Good to know: “Commands and the ribbon follow the active side. **Close this side** keeps the other view open. Ctrl+W closes the whole split tab after checking unsaved work. Sessions and saved groups keep supported split positions.” See also: “Working with tabs” and “Copying content between tabs”. Spanish **Vista dividida**: “Mantén dos vistas compatibles dentro de una pestaña.” Cómo usar: “Elige **Abrir en vista dividida** o arrastra una pestaña compatible al destino dividido de otra. Elige **Lado a lado** o **Arriba y abajo**. Arrastra el divisor o enfócalo y usa las flechas. Elige **Intercambiar lados** para cambiar sus posiciones.” Para tener en cuenta: “Los comandos y la cinta siguen al lado activo. **Cerrar este lado** mantiene abierta la otra vista. Ctrl+W cierra toda la pestaña tras comprobar cambios sin guardar. Las sesiones y los grupos guardados conservan las posiciones compatibles.” Consulta también: «Trabajar con pestañas» y «Copiar contenido entre pestañas».

AddtoexistingPDF/texthelpEnglish “In a split view, enable **Sync scrolling** to follow normalized document progress when both sides support it. Different page lengths may not line up exactly.” Spanish “En una vista dividida, activa **Sincronizar desplazamiento** para seguir el avance proporcional cuando ambos lados lo admiten. Las páginas de distinta longitud pueden no coincidir exactamente.” No claimsemanticcomparison.

## Reviewer fixtures / speed / screenshots / done

Retained2PDFs4pages/2pages,text100lines,folderA,dirtytexttwoviews,one missingdescriptor. Checkbothdirections/pointerkeyboard/swap/activecommands/copydrop/sharededits/closecancel/sessiongrouprestore/syncfeedbackloop/compactwindow. SourcehashesunchangedunlessexpliciteditorSave. Repeatesdark/pseudo/200%zoom/keyboard.

Measure step09i.split.create/swap/active/resize Instant<100ms;scrollsyncnextframe/nolongtask>50ms;initialleafviewFast<1swithskeleton. Shots108-split-pdf and109-split-folder-file,threevariants. Done: stableviewidentity/sharedmodel/lastviewprompts/session/groupcontractswork,coordinatorgate/package/accessibility/speed/runtimeevidenceaccepted,nonested/hiddencommandroutes.
