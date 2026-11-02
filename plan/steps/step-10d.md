# Step 10d: Folder identity, colors, icons, backgrounds and column sets

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-10d-folder-customization |
| Tag | v0.1.15-step10d |
| Depends on | 07a/b previews/identity;09f identity effects;09d folder-presentation-1;10a contrast;10c profile-root-1 |
| Written before | 07a was built |
| Interface revision | file-identity-1; folder-customization-1 |

Guide only; workers write owned code/tests/help without compiling or running checks. Coordinator applies shared wiring and executes verification, generators, packaging and commits.

Type notation: safeu64 means Rust u64 serialized only in the JSON safe-integer range 0..9,007,199,254,740,991 and TypeScript number. UUID means a validated canonical UUID string. Optional fields are absent/null only where the table says optional. Enum spellings are literal serialized values; no worker invents alternate names.

## Goal, exclusions and read first

Customize folder color/icon/background throughout the app, optionally write Windows desktop.ini, and assign column sets manually. No automatic folder classification, remote images, arbitrary icon DLLs, AI or changes to user folders without explicit Windows-integration consent. Read mapped v1 step10b folder paragraphs;09d/10a/10c; actual folderViews.ts/FileList/ColumnView/Breadcrumb/NavItem/TabStrip/fileTile/native transfer history and owned_io, settings recipes.

| ID | Producer/task; canonical export | Dependency |
|---|---|---|
| U1 | 09d T1/E1 folderPresentation.ts FolderPresentation/ColumnSpec/ColumnId,get/setFolderPresentation | Extend existing column IDs additively; never duplicate sort/group/view DTOs |
| U2 | 07b T1/E1 metadata.ts MetadataField/Info/readMetadata/releaseMetadata | Additionalmusiccolumns are audio_title/audio_artist/audio_album already fixedmetadataIDs; selectingcolumnstartsboundedbackgroundrequestonly |
| U3 | 07a T2/T3/E1/E3/E5/E8 cache/leases/decode | Userimages max64MiB,owneddecodedcachePNG; no pathURL; release leaseswheninvisible |
| U4 | 10a T5/E4 themeMath.ts contrastRatio/resolveReadableAccent | Same4.5text/3nontext thresholds andalgorithm, no new approximatecontrastfunction |
| U5 | 10c T4/E5 ProfileRoot | Perprofilecatalog/assets underprofile_dir; sharedpacksuntouched |
| U6 | 09a T3/E9 UiHistoryRegistry;09f native exact completed effect identities | One appmetadataUndo; followmovesonlyauthoritativeIdentityEffect below,neverpathguess; unprovedidentityreceipt leavesrecordunmigratedanddiagnostic |

## Decisions and algorithm

1. Store `<profile>/folder-customization.sqlite` using existing rusqlite0.41.1 bundled. Max10,000customizedfolders,100columnsets,64MiBDBincludingWAL; imageassets256MiBphysical. Allschemawrites transactional; ownedassets published beforeDBreference, orphancleanuponlyappownedvalidatedUUIDs. Catalogcorruptionretain/quarantine,neverwriteuserfolders.
2. FileIdentityKey uses actualopenedWindowsvolume serial andfileindex, notpathalone. Nativeopensmetadata directoryhandles withBACKUP_SEMANTICS andno reparse traversal; IDstrings lowerhex8/16. Ifunstablefilesystem, stable=false and keyuses folderViewKey-normalizedpath; pathfallbackmaynotclaimexternalrenamefollowing. StableIDs followwatcherrescanbyID; same-drive move retainskey. Copy/crossvolumemove inherits onlyfromauthoritativecompletedreceiptwithbothidentities. Folderdisplaymetadata neverchanges OSfilename.
3. Icon is default,staticLucidefoldervariant ID folder/folderOpen/folderHeart/folderStar/folderLock,emoji onegrapheme<=16scalars,or ownedimageassetUUID. Imageinput explicitlychosen,decodecap16MP/4096edge; thumb256edgeRGBA. No SVG/ICO/DLL rawexecution; installedsystemicons existinghelperonly. Coloroptional #RRGGBB; accentsadjustedforcontrastwithwarning. Lists,ColumnView,nav,breadcrumbs,foldertabsallconsumeone FolderDecorationResolver; no duplicatedlookuplogic.
4. Background none/solid/gradient/image; offbydefaultglobal `explorer.folder_backgrounds`false. Solidcolorsopaque;gradient exactly2colorsandangle0-359;imagefit fit/fill/tile;opacity0-0.5default0.15,blur0-32default0;inherit false. Resolveclosestancestorrecordwithinherit=true,exactfolderrecordwins;depthcap256/reparseboundariesstop; no inheritedmetadatawrites. OverlayreadabilityusesU4; addpanetoken dimlayeruntilcontrastpasses,orhidebackgroundwithwarning. Neverblockfirstlistingonimageparse; cachedownedpreviewappearsafterrows.
5. Manualcolumnsets: defaultoff `explorer.column_sets_enabled`;regularcolumnsremain09ddefaultunlessexplicitassignmentapplies. SetIDsUUID,name1-60,columnscanonical ColumnSpec[],assignment exactfolder/subtree/type. Typeclassificationisuserchosen enumgeneral/photos/music/documents,notdetected. ExplicitSuggestonlycountsfilenameextensionsfromcurrentlisting;>=60%ofeligiblefilesandatleast5matching selectsphotos/music/documents,otherwisegeneral; previewrequiresApply. No automaticmetadatareadsforSuggestion.
6. Extend09dColumnId withaudio_title/audio_artist/audio_album anddimensions;dimensionsiswidth×heighttextfromsameMetadataInfo,notnewprovider. Photosdefaultname/date_taken/dimensions/camera_model;Musicname/audio_title/audio_artist/audio_album/duration_ms;Documentsname/author/page_count/modified;Namealwaysfirstrequired. Allnewwidths140pxand09dvalidation.
7. WindowsExplorerapplication isseparateuncheckedcheckbox, explicitperfolder/selection consent. Onlydesktop.iniwithinselectedrealwritablefolder; versionhookexistingcontentbeforechange,neveroverwriteunknownfileblindly. ParseexistingINIUTF16LEorUTF8 bounded64KiB, preserveunknownsections/keys/comments; editonly[.ShellClassInfo]IconResource/InfoTip entriesownedbyapp andoriginalstatejournal. User-selecteddesktop.ini conflictasksbeforechanges; safeexistingreplacementstillunavailable09f=>refusechangingexistingdesktop.iniunlessobject-boundprotocolproven. Newdesktop.iniownedno-replacewithUnicodeandproperattributes,iconresourceappownedfile,restoreoriginalattributesonUndo. No system/drive/network/reparsefolderchanges. Failureappdecorationstillworks, Windowsapplicationreportsnotapplied.
8. Batchcustomize max1000folders, showcount/scope; eachcatalogupdateatomiconeUndoandtoast. Resetremovesonlyapprecord/references; imagegarbagecollectionwaitsleasesandhistory. Neverdeleteuserimageoruserfolder. Schemas30->31 addglobalfields only;catalogschema1independent.

## Types and exports

Canonical identity `src/services/fileIdentity.ts`,native `crates/fs-service/src/source_stamp.rs`; decoration`src/services/folderCustomization.ts`,nativefolder_customization_types.rs; resolver`src/folders/FolderDecorationResolver.ts`.

| Type | Exact fields/defaults/bounds |
|---|---|
| FileIdentityKey | volume_id string8hex;file_id string16hex;path_key string<=32768UTF16;stablebool;stablekeyvolume:file,unstablekeypath;directoriessupported |
| IdentityEffect | operation_idUUID;kindcopy/move/rename;from_key/to_keyFileIdentityKey;from_path/to_pathabsoluteString;completeboolfixedtrue;onlynativecompletedguardedreceipt,notcallerpaths |
| FolderIcon | kinddefault/lucide/emoji/image;value optionalstringvalidatedD3 |
| FolderBackground | kindnone/solid/gradient/image;color optionalThemeColor;second_color optionalThemeColor;angle_degreesu16default0;asset_idoptionalUUID;fitfit/fill/tile;opacityf64default0.15;blur_px u8default0;inheritboolfalse |
| FolderCustomization | keyFileIdentityKey;display_pathstring;colornullor#RRGGBB;iconFolderIcon;backgroundFolderBackground;column_set_idoptionalUUID;scopeexact/subtree;modified_unixsafeu64 |
| ColumnSet | idUUID;name1-60;columnsColumnSpec[]1-15;folder_typeoptionalgeneral/photos/music/documents;version1 |
| FolderDecoration | coloroptionalstring;iconFolderIcon;backgroundoptionalFolderBackground;column_setoptionalColumnSet;inherited_fromoptionalstring;warning_codesstring[]max8 |
| FolderCustomizationPage | recordsFolderCustomization[]max256;next_cursoroptionalUUID;completebool;serialized<=768KiB |
| FolderCustomizeRequest | pathsstring[]1-1000;patch fieldscolor/icon/background/column_set_id/scope;expected_keysFileIdentityKey[]samecount;apply_windowsboolfalse;accepted_windows_changeboolfalse |
| FolderCustomizeResult | changed_countu32;windows_applied_countu32;failures{path,code}[]max256page;next_cursoroptionalUUID;history_idUUID;completebool |

| ID | Exact export | Parameters -> result/consumer |
|---|---|---|
| E1 | fileIdentity.ts readFileIdentity/subscribeIdentityEffects | readFileIdentity(path string)->Promise<FileIdentityKey>;nativefile_identity(path). subscribeIdentityEffects(listener(effectsreadonlyIdentityEvent[])->void)->Promise<UnlistenFn>;eventidentity-effects,256/768KiBbound.11b/11c |
| E2 | folderCustomization.ts getFolderDecorations/customizeFolders/resetFolders | get(pathsreadonlystring[]max256)->Promise<FolderDecoration[]>sameorder;customize(request)->Promise<JobHandle<FolderCustomizeResult>>;reset(paths,expectedKeys)->samejob. Nativefolder_decorations,folder_customize_start,folder_reset_start |
| E3 | same listColumnSets/saveColumnSet/removeColumnSet | list()->Promise<ColumnSet[]>max100;save(value)->Promise<ColumnSet>;remove(id)->Promise<void>;nativecolumn_sets_list/column_set_save/column_set_remove. Existingassignmentclearedatomicallyifsetremoved |
| E4 | FolderDecorationResolver | constructor(read(paths)->Promise<FolderDecoration[]>);resolve(pathsreadonlystring[])->Promise<readonlyFolderDecoration[]>;invalidate(keysreadonlyFileIdentityKey[])->void;dispose()->void;cachemax1000entries/5min,ignorestaleresults.10e/11b |
| E5 | folders/FolderCustomizeDialog.tsx | props pathsreadonlystring[],initialreadonlyFolderDecoration[],onApply(request)->Promise<void>,onReset()->Promise<void>,onClose,onOpenHelp;Dialog760px,tabsGeneral/Background/Columns,nochangebeforeApply |
| E6 | nativefolder_identity_effects.rs apply_identity_effects | (effects &[IdentityEffect],store &FolderCustomizationStore)->Result<(),String>;validateauthoritativeoperationregistryandidentitiesbeforemigration;sourcecopyretainsrecord,movedsourcechangeskeyonlyaftercompletedreceipt.11bregistersitsownstoreadapterwithsameeffectschema |

Allcommandsensure_main/strictabsolute paths/enums/countsandnativeidentityvalidationbeforewrite;maindiskworkspawn_blocking;errorsfolder_custom.invalid/changed/limit/io/unsupported/windows_unavailable. Noresponsecontainsimages/rawbytes. LongbatchsharedjobrunJobcompletion,notresult.

## Exact texts and UI

| Key | English | Spanish |
|---|---|---|
| folderCustom.title / folderCustom.color / folderCustom.icon / folderCustom.emoji / folderCustom.image / folderCustom.reset | Customize folder / Folder color / Folder icon / Emoji / Choose image… / Reset folder appearance | Personalizar carpeta / Color de carpeta / Icono de carpeta / Emoji / Elegir imagen… / Restablecer apariencia |
| folderCustom.background / folderCustom.inherit / folderCustom.global / folderCustom.windows / folderCustom.windowsWarning | Folder background / Apply to subfolders / Show folder backgrounds / Also apply to Windows Explorer / This writes desktop.ini in the selected folder. Existing files require safe replacement support. | Fondo de carpeta / Aplicar a subcarpetas / Mostrar fondos de carpeta / Aplicar también al Explorador de Windows / Esto escribe desktop.ini en la carpeta seleccionada. Los archivos existentes requieren reemplazo seguro. |
| folderCustom.columns / folderCustom.enableColumns / folderCustom.suggest / folderCustom.assign / folderCustom.exact / folderCustom.subtree | Column sets / Enable manual column sets / Suggest column set / Assign column set / This folder only / This folder and subfolders | Conjuntos de columnas / Activar conjuntos manuales / Sugerir conjunto / Asignar conjunto / Solo esta carpeta / Esta carpeta y subcarpetas |
| folderCustom.general / folderCustom.photos / folderCustom.music / folderCustom.documents / folderCustom.dimensions / folderCustom.audioTitle / folderCustom.artist / folderCustom.album | General / Photos / Music / Documents / Dimensions / Title / Artist / Album | General / Fotos / Música / Documentos / Dimensiones / Título / Artista / Álbum |
| folderCustom.unstable / folderCustom.dimmed / folderCustom.windowsNotApplied | This location cannot reliably follow external renames. / The background was dimmed for readable text. / The app appearance was saved; Windows appearance was not changed. | Esta ubicación no puede seguir con seguridad los cambios de nombre externos. / Se atenuó el fondo para mantener el texto legible. / Se guardó la apariencia de la aplicación; no se cambió la de Windows. |
| errors.folder_custom.invalid / errors.folder_custom.changed / errors.folder_custom.limit / errors.folder_custom.io / errors.folder_custom.unsupported / errors.folder_custom.windows_unavailable | These folder options are not valid. / The folder changed. Review it again. / The folder customization limit has been reached. / The folder appearance could not be saved. / This location does not support that option. / Existing Windows folder settings cannot be replaced safely here. | Estas opciones no son válidas. / La carpeta cambió. Vuelve a revisarla. / Se alcanzó el límite de personalizaciones. / No se pudo guardar la apariencia. / Esta ubicación no admite esa opción. / No se puede reemplazar de forma segura la configuración existente de Windows. |

Otherlabelsreuse10a exactbackground/fit/opacity/blur and09dcolumnchooserkeys. Commandexplorer.customizeFolder,label folderCustom.title,iconFolderCog,riskchange,no shortcut,help customizing-folders. Dialog760px,maxviewportminus32,form128pxlabels/controlsmin240,gap16,preview240x180;checkboxWindowsunchecked;Canceldefault. CSSadp-folder-customize/adp-folder-background/adp-folder-column-sets,tokenonly,logicalproperties,no color-onlystate. Windowsunavailabledoesnotdisableordinaryappcustomization.

## Tasks

| Task; commit | Files/work/dependencies | Named tests/oracles |
|---|---|---|
| T1 `feat(identity): shared stable file identity receipts [step-10d/T1]` | fileIdentity.ts,file_identity.rs,folder_identity_effects.rs;D2/E1/E6;coordinatornativeoperationreceiptbridge.U5/U6 | fileIdentity.test.ts/native:stablevolumefiledistinctacrossvolumes;unstablepathfallback;forgedUIeffectrefused;incompleteeffectnotmigrated;copyretainsoriginal |
| T2 `feat(folders): bounded customization catalog [step-10d/T2]` | folderCustomization.ts,folder_customization_types.rs/folder_customization_store.rs;U3/U5/U6 | folderCustomization.test.ts/native:10001refused;failedtransactionpreserves;assetsbeforeDB;Undooneentry;unknownassetneverdeleted |
| T3 `feat(folders): shared decoration and background resolver [step-10d/T3]` | FolderDecorationResolver.ts,FolderBackground.tsx,styles/folderCustomization.css;U1-U4/E2/E4;coordinatorallfolderentrypoints | folderDecoration.test.tsx:exactoverridewinsancestor;reparseinheritstops;globaloffdoesnotreadimage;stalegenerationignored;textcontrast>=4.5;firstrowsnotblocked |
| T4 `feat(folders): manual column sets and suggestions [step-10d/T4]` | ColumnSetEditor.tsx,columnSetSuggestion.ts,column_sets.rs;U1/U2/E3 | columnSets.test.ts:5of8photos=>photos;4of8=>general;4of4=>generalminimum5;Namecannotremove;disabledfeaturekeepsregularcolumns;metadatarequestedonlyvisible |
| T5 `feat(folders): explicit Windows appearance writes [step-10d/T5]` | folder_desktop_ini.rs,desktop_ini_data.rs,FolderCustomizeDialog.tsx;U3/U6/E5 | desktopIni.test.ts/native:newfileonlyownedpublish;existingfileunavailable0writes;unknownINIkeyspreserved;drive/system/reparse refused;Cancelretainsoriginalfolderattrs |
| T6 `docs(help): folder appearance and column sets [step-10d/T6]` | sixhelpfilesbelow;coordinator schema31/locales/pseudo/speedshots.U1-U6 | allkeys/help/commandregistration,allentrypointssameResolver,Spanishdark/pseudobounds |

## Full help

`customizing-folders.md`, English **Customizing folders**: “Give folders a local color or icon.” How to use: “Select folders and choose Customize folder. Pick a color, icon, emoji or image, then Apply. Reset removes the app appearance.” Good to know: “Files are not renamed. App records follow verified moves; some locations cannot follow external renames. Apply to Windows Explorer is separate and writes desktop.ini only after explicit consent.” See also: “Folder backgrounds” and “Column sets”. Spanish **Personalizar carpetas**: “Dale a las carpetas un color o icono local.” Cómo usar: “Selecciona carpetas y elige Personalizar carpeta. Elige color, icono, emoji o imagen y aplica. Restablecer quita la apariencia de la aplicación.” Para tener en cuenta: “No cambia nombres. Los registros siguen movimientos verificados; algunas ubicaciones no siguen cambios externos. Aplicar al Explorador de Windows es independiente y escribe desktop.ini solo con consentimiento explícito.” Consulta también: «Fondos de carpetas» y «Conjuntos de columnas».

`folder-backgrounds.md`, English **Folder backgrounds**: “Show an optional readable background behind folder items.” How to use: “Enable Show folder backgrounds in Settings. In Customize folder choose a solid color, gradient or image and adjust opacity or blur. Choose whether subfolders inherit it.” Good to know: “Backgrounds are off by default, cached locally and dimmed when text needs more contrast. Hiding them does not delete the original image.” See also: “Customizing folders”. Spanish **Fondos de carpetas**: “Muestra un fondo opcional y legible detrás de los elementos.” Cómo usar: “Activa Mostrar fondos de carpeta en Configuración. En Personalizar carpeta elige color, degradado o imagen y ajusta opacidad o desenfoque. Elige si se hereda a subcarpetas.” Para tener en cuenta: “Los fondos están desactivados al inicio, se guardan en caché local y se atenúan para mejorar el contraste. Ocultarlos no elimina la imagen original.” Consulta también: «Personalizar carpetas».

`column-sets.md`, English **Column sets**: “Assign useful metadata columns yourself.” How to use: “Enable manual column sets in Settings > Views. Create or edit a set and assign it to a folder, subtree or manually selected folder type. Suggest column set proposes a choice; Apply is still required.” Good to know: “Nothing is classified or changed automatically. Metadata loads in the background and online-only files are not downloaded.” See also: “Folder columns”. Spanish **Conjuntos de columnas**: “Asigna manualmente columnas de metadatos útiles.” Cómo usar: “Activa los conjuntos manuales en Configuración > Vistas. Crea o edita un conjunto y asígnalo a una carpeta, subárbol o tipo elegido manualmente. Sugerir conjunto propone una opción; aún debes aplicarla.” Para tener en cuenta: “Nada se clasifica ni cambia automáticamente. Los metadatos se cargan en segundo plano y no se descargan archivos solo en línea.” Consulta también: «Columnas de carpetas».

## Checks, measurements and acceptance

Retained fixtures:10ordinaryfolders,5photoextensionsamong8files,existingdesktop.iniwithunknownsection,2x2RGBAimage,cloudplaceholdermock,unstableIDfakeprovider. Coordinator exercisesbatch/reset/Undo/rename/copy/crossvolumeeffects,allfolderentrypoints,backgroundinheritance/off/contrast,manualcolumns,Windowscheckbox0writesonexistingunsupportedfile,Spanishdark/pseudo/keyboard200%zoom. Sourceimagehashunchanged.

Measures step10d.folder.decoration cachedInstant<100ms,backgroundfirstviewFast<1safterlisting,nometadatablocksrows;reserve122-folder-customize,123-column-sets inthreevariants. Done: canonicalidentities/resolver/columnDTOSmatch,nostaleIDclaim,nounapproveddesktop.iniwrite,coordinatorgate/package/accessibility/safety/speedreportcomplete.

Identity effect listeners consume09fE8 IdentityEvent taggedunion effect {effect:IdentityEffect} / overflow {last_sequence:safeu64}; onoverflow reconcile/rescan, never infer missingmoves. CanonicalsubscribeIdentityEffects takes readonlyIdentityEvent[] batches.
