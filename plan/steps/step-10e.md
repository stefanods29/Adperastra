# Step 10e: Menus, Home, navigation, status and shareable setups

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-10e-customizable-shell |
| Tag | v0.1.16-step10e |
| Depends on | 09b groups;09d palette;10a themes;10b command-layout;10c profiles;10d decorations |
| Written before | 07a was built |
| Interface revision | shell-sections-1; setup-file-1 |

Guide only. Workers write owned source/tests/help without execution; coordinator owns shared integration, installation, all builds/tests/generators, packaging, measurements and accepted commits.

Type notation: safeu64 means Rust u64 serialized only in the JSON safe-integer range 0..9,007,199,254,740,991 and TypeScript number. UUID means a validated canonical UUID string. Optional fields are absent/null only where the table says optional. Enum spellings are literal serialized values; no worker invents alternate names.

## Goal and exclusions

Visually edit file/folder/background/tab/group menus; arrange Home/navigation/status fields; share selected safe configuration in `.adperastra-setup`. No plugins, executable setup content, community download gallery, account sync, AI or automatic inclusion of personal paths/history.

## Read first and dependency contracts

Read v1 step10b menus/Home/navigation/status/setup paragraphs,all10a-dexports,09aUiHistory/09dpalette; actual commands/menus.ts MenuEntry union,HomePage.tsx,NavPane.tsx,FileTabStatus inhandlers/types.ts,settingsFile.ts,archiveguardedreader/zipwriter. Existing HomePage/NavPane props and FileTabStatus.items strings are legacy adapters, not imaginary registered section data.

| ID | Producer/task; exact symbol | Use |
|---|---|---|
| U1 | 02 commands/registry.ts CommandRegistry/Command;commands/menus.ts MenuEntry | Build resolvedMenuEntry from safe configuration. Runtimeicon/rendercallbacks neverpersist; enabled/visible rules stillchecked |
| U2 | 10b T1/E1 CommandLayoutRegistry,ToolbarCustomSettings andKeyboardMap/E2effectiveShortcut | Setup parts import canonical data, nevercopy/redefine; hiddenmenucommandsstaypaletteavailable |
| U3 | 10a T1/E1 CustomTheme/ThemeRef/read/save;10c E5 ProfileRoot | Safe theme data/assets andperprofileroot; noinstalledfontbytes orsourcepaths |
| U4 | 09b E4 savedgroups;09d E3 PaletteRegistry;10d E4FolderDecorationResolver | Home/nav load savedgroupsnormally;registeredviewitemsroutenormalopen; decorationusedonsamefolderentries |
| U5 | 09a T3/E9 UiHistoryRegistry and03bglobalUndo | OrdinaryshellconfigapplyoneUndo; setupapplyreservesallbefore/afterboundedstatesfirst |
| U6 | 06d/06e archive validatedentries,zip9.1writer;08aownedoutput;10csettingsFileimportpreview | Setupreadisboundedziphelper,nogenericunpack. PreviewbeforeApply;exportno-replace |

## Decisions and algorithms

1. Settingsschema31 -> 32 adds shell_custom containingmenus/home/navigation/status; eachrecordmax1MiB,allsettingsmax4MiB. ExistingFigmaHome/navigation/status aredefaults. Registriesarestatictrustedappcode,notcommunityplugins. UnknownregisteredIDstoredasdisabledplaceholder; neverexecuteimportedcodeorcommandarguments.
2. Menu targets file/folder/background/tab/group. Persist MenuNode unioncommand/separator/submenu withstableUUID,nodevisibility/direct-or-more. Max100nodes/menu,total500,depth3,submenuchildrenmax50; rejectcycles/duplicates/prototypekeys. Newsubmenulabelusertext1-60,nottranslationkeyinjection; builtinlabelkeysretained. No arbitraryShellExecute/customscriptitems. Normalizeleading/trailing/repeatedseparatorsonlyinrenderedcopy; preserveeditablemodel. MandatoryHelp/Settingsaccess staysoutsideuserhideablemenucontent.
3. Editor Settings>Menus: targetselector, tree/currentpreview sidebyside,widthmax960,min280each,row36px; show/hide,Moveup/down,Create submenu,Add separator,Move to More,Resetmenu; allkeyboardbuttons,dragoptional. Previewdoesnotexecutecommands. Applyvalidatesoneatomicsettingschange,Cancelleavesstate.
4. HomeSectionRegistry IDs quick_access,recent,favorites,saved_groups,storage_summary,pinned_searches,recent_conversions; later11btagged_filesaddedthroughregistry,notrootfork. Defaultquick_access/recent/favoritesvisible;newunsupportedprovidersdisableduntilrealimplementation. Persectionvisible/collapsed/order,size small/medium/large,limit1-100default12. Gridthreecolumnswide,onecolumnbelow720px; cardspan1/2/3for size; no visualreorderingdifferentfromDOMreadingorder. EditHomeprovidesmovearrows/resize/hidecontrols;headeralwaysreachable.
5. Nav registry IDs home/gallery/pinned/this_pc/network/saved_groups;later11bviews/tags. Customsectionsmax20,customitemsmax200;itemsfolderpathabsoluteanddisplaylabeloptional1-60,nevermoves/renamesOSfolder. Rowheight28-48default32,icons16/20/24default20,width160-480default240,autocollapseboolfalse. HiddenHomecanstillopenviaappcommand; Settingsalwaysreachable. MissingpathshowswarningandLocate,notautodelete.
6. Statusfieldsregisteredbyowner viewID; sources aretrustedlivegetters,notnewcopiesofeditorstate. Explorerdefaultitem_count,selection_count,selection_size,free_space,view_buttons;filelegacyadapterretainsFileTabStatus.items andzoomuntilneweditorregistersexplicitfields. Userorder/visibilityperkind explorer/text/pdf/image/media/office. Statusmayhideentirely; criticalsave/error/progressmessagesremainvisibleelsewhere. Nonewbackgrounddrivequeryjustfordisabledfield.
7. `.adperastra-setup`ZIPschema1 max32MiBcompressed/64MiBexpanded/256entries/depth4/ratio100. Entriesonlymanifest.json,data/<fixedpart>.json,assets/<UUID>.png; noabsolute,drive,UNC,traversal,symlink,duplicatecasefoldnames,encryptedentries,unknownexecutableformats. Validateallmanifestlengths/SHA256s beforepreview; fixedparttypedvalidationbeforeApply;imagehelpercapsfrom10a. No genericunpackoruntrustedstyleexecution.
8. PartIDs theme/layout/menus/toolbars/navigation/home/status/keyboard. ThemeusesCustomTheme;layoutLayoutSettings;menusMenuCustomization[];toolbarsToolbarCustomSettings;navigationNavigationCustomization;homeHomeCustomization;statusStatusCustomization;keyboardKeyboardMap. No arbitraryAppSettingsblob. Paths/historyexcludeddefault;optionalpersonal_paths selection includesonlyexplicitnavcustompaths andsavedgrouplocationswithseparatewarning; recent_historynotexportedinthisstep. Setupmanifestflagsstateactualincludedpersonaldata.
9. Importreadsintoboundedownedquarantine,producesimmutableSetupPreviewwithpartcounts/warnings;nothingapplied. UserselectspartIDs,explicitpersonalpathackifpresent. Applyvalidatesagainandreserveshistory,acquiresglobalsettings/configwritegate,stagesallappownednewfiles. Durablejournalstatesprepared/applying/committedstoresold/newhashesandownedbackups. Commitallknownpartadaptersinorder theme/layout/keyboard/toolbars/menus/navigation/home/status;onfailure rollbackreverseusingexpectedhashCAS,neveroverwriteexternallychangedconfig. Retainpendingjournalandshowrecoveryifrollbackunsafe. UIreceivesonecommittednewconfigafterallwrites;observerspauseduntilthen.
10. Setupconfigurationundo usesUiHistoryadaptersetup-importwithboundedbefore/aftertypedpartdata;rollbackandUndoapplysamevalidatedtransaction. FilesexportedbyuserarenotdeletedbyUndo. Cache/quarantinecleanupdeletesonlyownedUUIDentrieswithnoleases/historyreferences. Sharedprivatekeyfolderneverreadorpacked.

## Types and exact exports

Canonicaltypes`src/shell/types.ts`,`src/services/setups.ts`,nativemirror`src-tauri/src/setup_types.rs`. Runtimeproviderregistriesin`src/shell/registries.ts`.

| Type | Exact fields/validation |
|---|---|
| MenuNode | kindcommand{idUUID,command_idstring<=128,visiblebool,placementdirect/more};separator{idUUID};submenu{idUUID,labelstring1-60,childrenMenuNode[],visiblebool,placement};nodecap/depthD2 |
| MenuCustomization | targetfile/folder/background/tab/group;nodesMenuNode[] |
| HomeSectionLayout | idregisteredstring<=64;visiblebool;collapsedbool;size small/medium/large;limitinteger1-100 |
| HomeCustomization | sectionsHomeSectionLayout[]max32uniqueIDs;edit_mode notpersisted |
| ShellItem | idstring<=128;kindfile/folder/action/summary;labelstring<=512;detailoptionalstring<=512;target_idstring<=32768;icon_idstaticstring<=64;disabled_reason_keyoptionalstring; noHTML/callbacks |
| HomeSectionProvider | idstring;label_keystring;load(limitnumber,signalAbortSignal)->Promise<readonlyShellItem[]>;activate(itemShellItem)->Promise<void>;statictrustedruntime |
| NavigationItem | idUUIDorfixedbuiltin;kindbuiltin/folder;target_idstring;display_labeloptionalstring1-60;visiblebool;section_idstring |
| NavigationCustomization | sections{idstring,labeloptionalstring,visiblebool,itemsNavigationItem[]}[]max32;row_height_px32;icon_size_px20;width_px240;auto_collapseboolfalse |
| StatusValue | kindtext{textstring<=512};number{valuefinitenumber};size{bytes safenumber};position{line,columnpositiveintegers};zoom{percent,min,maxfinitenumbers}; nofunctions |
| StatusFieldProvider | idstring<=128;label_keystring;read()->StatusValue|null;activateoptional()->void;staticruntimegetter,owner-scoped |
| StatusCustomization | visiblebooltrue;ordersRecord<kind,{idstring,visiblebool}[]>max64fields/kind |
| SetupManifest | schema_version1;app_versionstring<=128;partsSetupPart[]unique;entries{namefixedrelative,byte_lensafeu64,sha25664hex}[];contains_personal_pathsbool;created_unixsafeu64 |
| SetupPreview | preview_idUUID;manifestSetupManifest;parts{idSetupPart,item_countu32,warning_codesstring[]}[];expires_unixsafeu64now+300; noappliedsettings |
| SetupApplyRequest | preview_idUUID;partsSetupPart[]nonempty;accept_personal_pathsboolfalse |
| SetupApplyResult | applied_partsSetupPart[];history_idUUID;restart_requiredboolfalse;pending_recoverybool;warning_codesstring[]max64 |

| ID | Exact export | Signature/consumer |
|---|---|---|
| E1 | shell/registries.ts HomeSectionRegistry | register(providerHomeSectionProvider)->unsubscribe;list()->readonlyHomeSectionProvider[];get(id)->HomeSectionProvider|null;duplicateIDrejected.11btagged_files |
| E2 | same NavigationRegistry | registerSection(idstring,labelKeystring,load(signal)->Promise<readonlyNavigationItem[]>)->unsubscribe;list()->readonly{id,labelKey}[];load(id,signal)->Promise<readonlyNavigationItem[]>;futureviews/tagsregister11b |
| E3 | same StatusFieldRegistry | register(ownerIdstring,providerStatusFieldProvider)->unsubscribe;read(ownerIdstring,orderedIdsreadonlystring[])->readonly{id,label_key,valueStatusValue}[];disposeOwner(ownerId)->void;alllatereditorsregisterexactlivefields |
| E4 | services/setups.ts previewSetup/applySetup/releaseSetupPreview/exportSetup | preview(pathstring)->Promise<JobHandle<SetupPreview>>;apply(request)->Promise<JobHandle<SetupApplyResult>>;release(id)->Promise<void>;export(destPathstring,partsreadonlySetupPart[],includePersonalPathsbool)->Promise<JobHandle<{path:string,bytes:number}>>. Native setup_preview_start/setup_apply_start/setup_release/setup_export_start;sharedjobs |
| E5 | shell/menuCustomization.ts resolveCustomMenu | (targetMenuTarget,customreadonlyMenuCustomization[],defaultsreadonlyMenuEntry[],registryCommandRegistry)->readonlyMenuEntry[];nochangedenabled/visiblemeaning.10bclassicmenusmayreuseonlycompatibletarget |
| E6 | shell/SetupPartRegistry.ts SetupPartRegistry | register(idSetupPart,adapter{read()->Promise<SerializableViewState>;validate(state)->boolean;stage(state,transactionIdstring)->Promise<void>;commit(transactionId)->Promise<void>;rollback(transactionId)->Promise<void>})->void;staticadapters,samecanonicaltypedvalidatorperpart;nativeauthoritativewritergate |
| E7 | shell/HomeEditor.tsx/MenuEditor.tsx/SetupImportDialog.tsx | HomeEditor props valueHomeCustomization,providersreadonlyHomeSectionProvider[],onApply(value)->Promise<void>,onCancel,onOpenHelp;MenuEditor samepatternwithtarget/value/defaults;SetupImportDialog props previewSetupPreview,onApply(request)->Promise<void>,onClose,onOpenHelp |

Allcommandsensure_main,validatepaths/IDs/versions/totalbytes,enforceprofileownership;errorssetup.invalid/too_large/unsupported_version/changed/io/recovery_required,catalog.invalid/catalog.limit. NativeDTOsreturncodesonly. Unknownpartcannotloadcode. Resolveformat/decorationthroughcanonicalproviders,notwindowprivatevariables.

## Exact texts and UI

| Key | English | Spanish |
|---|---|---|
| shellCustom.menus / shellCustom.home / shellCustom.navigation / shellCustom.status / shellCustom.preview / shellCustom.reset | Edit menus / Edit Home / Navigation pane / Status bar / Live preview / Reset to default | Editar menús / Editar Inicio / Panel de navegación / Barra de estado / Vista previa en vivo / Restablecer valores predeterminados |
| shellCustom.submenu / shellCustom.separator / shellCustom.more / shellCustom.hide / shellCustom.show / shellCustom.up / shellCustom.down | New submenu / Add separator / Move to More / Hide / Show / Move up / Move down | Nuevo submenú / Agregar separador / Mover a Más / Ocultar / Mostrar / Subir / Bajar |
| shellCustom.section / shellCustom.count / shellCustom.cardSize / shellCustom.displayName / shellCustom.rowHeight / shellCustom.iconSize / shellCustom.width / shellCustom.autoCollapse | Section / Item limit / Card size / Display name / Row height / Icon size / Pane width / Auto-collapse | Sección / Límite de elementos / Tamaño de tarjeta / Nombre visible / Alto de fila / Tamaño de icono / Ancho del panel / Contraer automáticamente |
| setups.title / setups.export / setups.import / setups.contents / setups.apply / setups.personal / setups.personalWarning / setups.noChanges | Shareable setups / Export setup… / Import setup… / Included parts / Apply selected parts / Include personal paths / This setup contains personal locations. Review them before applying. / Nothing has been applied yet. | Configuraciones compartibles / Exportar configuración… / Importar configuración… / Partes incluidas / Aplicar partes seleccionadas / Incluir rutas personales / Esta configuración contiene ubicaciones personales. Revísalas antes de aplicarla. / Todavía no se aplicó nada. |
| shellCustom.quickAccess / shellCustom.recent / shellCustom.favorites / shellCustom.savedGroups / shellCustom.storage / shellCustom.searches / shellCustom.conversions | Quick access / Recent / Favorites / Saved groups / Storage summary / Pinned searches / Recent conversions | Acceso rápido / Recientes / Favoritos / Grupos guardados / Resumen de almacenamiento / Búsquedas ancladas / Conversiones recientes |
| errors.setup.invalid / errors.setup.too_large / errors.setup.unsupported_version / errors.setup.changed / errors.setup.io / errors.setup.recovery_required / errors.catalog.invalid / errors.catalog.limit | This setup is not valid. / This setup exceeds the import limits. / This setup needs a newer app version. / Configuration changed. Review the import again. / The setup could not be saved or applied. / A partial setup change needs recovery; the original data was retained. / This customization is not valid. / The customization limit has been reached. | Esta configuración no es válida. / Esta configuración supera los límites de importación. / Esta configuración necesita una versión más reciente. / La configuración cambió. Revisa la importación. / No se pudo guardar o aplicar la configuración. / Un cambio parcial necesita recuperación; se conservaron los datos originales. / Esta personalización no es válida. / Se alcanzó el límite de personalización. |

Partlabelssetups.partTheme/Layout/Menus/Toolbars/Navigation/Home/Status/Keyboard useEnglishTheme/Layout/Menus/Toolbars/Navigation/Home/Status/Keyboard andSpanishTema/Distribución/Menús/Barras/Navegación/Inicio/Estado/Teclado. SizechoicesSmall/Medium/Large=>Pequeño/Mediano/Grande. Commandsapp.editMenus(Menu),app.editHome(LayoutDashboard),app.editNavigation(PanelLeft),app.editStatus(PanelBottom),app.shareSetup(Share2),app.importSetup(Download);labelkeysabove,no globalkeys,riskchange,helprelevantpagebelow. Dialogwidth760/maxviewportminus32;tree/listrows36px,Importcheckboxallpartsexceptpersonaldefaultchecked,Applydisableduntilvalidselection;Canceldefaultbeforecommit;nointeractiveexecuteinpreview. CSSlogicalselectorsadp-menu-editor/adp-home-editor/adp-navigation-editor/adp-status-editor/adp-setup-import useexistingpane/border/text/focus/radius tokens.

## Tasks

| Task; commit | Files/work/dependencies | Named tests/oracles |
|---|---|---|
| T1 `feat(shell): configurable section and menu data [step-10e/T1]` | shell/types.ts,registries.ts,menuCustomization.ts,shell_custom_types.rs;coordinator schema32. U1-U5 | shellData.test.ts:depth4refused;duplicateIDrefused;unknowncommanddisabled;custompathnotOSrename;defaultsretainFigmaorder |
| T2 `feat(menus): visual safe context menu editor [step-10e/T2]` | MenuEditor.tsx,MenuTree.tsx,styles/menuEditor.css;coordinatormenuentryresolution.U1/U2/E5 | menuEditor.test.tsx:previewdoesnotrun;removedcommandstillpalette;keyboardreorder;resetonetargetonly;separatorsnormalizeinrenderedcopy |
| T3 `feat(home): registered editable Home sections [step-10e/T3]` | HomeEditor.tsx,HomeSectionHost.tsx,homeProviders.ts,styles/homeEditor.css;coordinatorHomePage.U4/E1 | homeSections.test.tsx:futureproviderregisteredwithoutrootchange;staleloadcancelled;DOMorder=visualorder;hiddenproviderdoesnoload;limit100enforced |
| T4 `feat(shell): navigation and status customization [step-10e/T4]` | NavigationEditor.tsx,StatusEditor.tsx,StatusFieldHost.tsx;coordinatorNavPane/FileTabStatuslegacyadapter.U3/U4/E2/E3 | shellFields.test.tsx:displayrenameleavespath;missingLocate;disposeOwnerstopsgetter;hiddenfree-spacefielddoesnotquerydrive;criticalerrorsremainwhenstatushidden |
| T5 `feat(setup): bounded setup archive preview and export [step-10e/T5]` | setups.ts,setup_types.rs,setup_archive.rs,setup_validation.rs,SetupImportDialog.tsx;U2/U3/U6/E4 | setupArchive.test.ts/native:traversal/duplicate/symlink/executabledeny;ratio101refused;hashmismatchbeforepreview;personaldefaultabsent;exportcollisionnooverwrite |
| T6 `feat(setup): transactional application and recovery [step-10e/T6]` | SetupPartRegistry.ts,setup_transaction.rs,setup_journal.rs,setupHistory.ts;U5/E6 | setupTransaction.test.ts/native:failureaftereachpartrollsbackreverse;externallychangedconfigretainedwithrecovery;UIpublishesonceaftercommit;historylimitbeforewrite;crashprepared/applying/committedrecovery |
| T7 `docs(help): shell customization and setup files [step-10e/T7]` | helpfilesbelow;coordinatortranslations/pseudo/registries/measures/shots.U1-U6 | keys/ICU/helpconsistent;untrustedlabelrenderstext;allprovidersdispose;newsettingsfixturesupdated |

## Full help

`editing-menus.md`, English **Editing menus**: “Arrange registered commands without changing what they do.” How to use: “Open Settings > Edit menus. Choose a target, hide or reorder items, create submenus or separators and review the preview. Apply or reset that menu.” Good to know: “Preview does not run commands. Hidden menu commands remain in the command palette when available. Setups cannot add scripts.” See also: “Customizing toolbars”. Spanish **Editar menús**: “Organiza comandos registrados sin cambiar su función.” Cómo usar: “Abre Configuración > Editar menús. Elige un destino, oculta u ordena elementos, crea submenús o separadores y revisa la vista previa. Aplica o restablece ese menú.” Para tener en cuenta: “La vista previa no ejecuta comandos. Los comandos ocultos siguen en la paleta si están disponibles. Las configuraciones no agregan scripts.” Consulta también: «Personalizar barras de herramientas».

`customizing-home-navigation-status.md`, English **Customizing Home, navigation and status**: “Keep useful sections and fields close.” How to use: “Use Edit Home to show, move and resize sections. In Navigation pane choose rows, custom folder labels and width. In Status bar choose fields for Explorer and each file type.” Good to know: “A display label does not rename a folder. Hidden sections stop optional loading. Important errors remain visible even with the status bar hidden.” See also: “Saved groups” and “Shareable setups”. Spanish **Personalizar Inicio, navegación y estado**: “Mantén cerca secciones y campos útiles.” Cómo usar: “Usa Editar Inicio para mostrar, mover y cambiar tamaños. En Panel de navegación elige filas, nombres visibles y ancho. En Barra de estado elige campos del Explorador y de cada tipo.” Para tener en cuenta: “Un nombre visible no cambia el nombre de una carpeta. Las secciones ocultas dejan de cargar contenido opcional. Los errores importantes siguen visibles aunque ocultes la barra de estado.” Consulta también: «Grupos guardados» y «Configuraciones compartibles».

`shareable-setups.md`, English **Shareable setups**: “Export selected appearance and layout data to another PC.” How to use: “Choose Export setup and select the parts. Personal paths are excluded unless explicitly selected. Import setup first shows contents and warnings. Choose the parts to apply and confirm.” Good to know: “Setups contain data, not executable code. Imports do not apply before confirmation. Original settings are retained for Undo or recovery if a change fails.” See also: “Theme editor” and “Profiles and portable data”. Spanish **Configuraciones compartibles**: “Exporta partes de apariencia y distribución a otra PC.” Cómo usar: “Elige Exportar configuración y selecciona las partes. Las rutas personales se excluyen salvo selección explícita. Importar configuración muestra primero contenido y avisos. Elige las partes y confirma.” Para tener en cuenta: “Contienen datos, no código ejecutable. La importación no aplica nada antes de confirmar. Se conserva la configuración original para Deshacer o recuperar un cambio fallido.” Consulta también: «Editor de temas» y «Perfiles y datos portátiles».

## Reviewer checks, speed, screenshots and done

Retainvalidsetupwithallnonpersonalparts;setupwith1explicitpersonalnavpath;malformedZIPtraversal/hashmismatch/oversize;missingproviderstate;injectedfailureaftereverycommitstep. Coordinatorchecksmenusalltargets,Homeorder/resize/hide,navdisplayrename/statusgetterdisposal,importpreview0writes/selectiveapply/rollback/restart/Undo,Spanishdark/pseudo/keyboard200%zoom. No private/personaldatausedinfixtures.

Measures step10e.menu.resolve/home.edit/status.render Instant<100ms;setuppreview Fast<1sorjobfeedback;applying64MiBassetsBackgroundprogressCancelbeforecommit. Reserve124-menu-editor,125-home-editor,126-navigation-status,127-setup-import inthreevariants. Done: typedregistries/importformatsfullymatched,noexecutableassetsorimplicitpersonalexport,transactionfailure/casrecoverytestedbycoordinator,gate/package/accessibility/speedreportcomplete.
