# Step 16: Windows integration, background mode and release polish

|Field|Value|
|---|---|
| State | guide; documentation reviewed; implementation not started |
|Difficulty|4/5|
|Branch|step-16-windows-polish|
|Tag|v0.4.0 original milestone; AI-inclusive promise not fulfilled in this scope|
|Depends on|03a shell helper;08d release/update;09c activation-1;10c profile-root-1;12a packs-1|
|Written before|07a was built|
|Interface revision|windows-integration-1;resident-mode-1|

Guide only; workers write code/tests, coordinator executes builds/installer/Sandbox/runtime checks. No publishing, remote Git operations, certificate installation or private signing-key access.

## Goal, exclusions and reading

Provide optional file associations/classic Explorer actions, clean install/upgrade/uninstall/offline packs, optional tray residence and update notes. Modern Windows11 top-level menu requires a genuine identity/signing decision; it is not silently replaced by the classic menu while claiming completion. Read v1 step16,08d/09c/10c/12a,actual classic_menu/helper/updates/package scripts, Tauri2.12 tray source and windows0.61.3 process/registry APIs.

## Decisions and checkpoints

1. D1. **OWNER CHECKPOINT, modern menu only:** Microsoft documents IExplorerCommand plus package identity through windows.fileExplorerContextMenus; sparse-package registration is an option for unpackaged Win32 apps, but trusted signing/identity deployment conflicts with standing no-certificate distribution. Prepare concrete manifest/COM-handler design and unsigned test artifacts, but do not install a certificate/change Developer Mode/publish package or claim modern-menu acceptance. Owner chooses a compliant identity/distribution route after reviewer evidence. All independent tasks below proceed. Official mechanism: https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/integrate-packaged-app-with-file-explorer . No unsupported registry hack promoting classic entries into the modern menu.
2. D2. Classic per-user commands are explicitly labeled “Show more options integration”. Under HKCU Software/Classes register only app-owned Adperastra keys, keep a ledger of exact prior values; never overwrite UserChoice/default-handler hashes. Offer Open with Adperastra and Convert to…; validate absolute selected paths through09c single-instance activation. For conversion mode add separately validated startup verb open/convert, carried as fixed native activation intent, not an arbitrary executable command. Selection cap256 and total request<=768KiB; one request per invocation deduplicated.
3. D3. Extend09c ActivationRequest with optional intent open/convert defaultopen, schema stays1 additive; converter opens shared08a dialog and requires user review, never automatically converts files received from Windows. Existing paths-only requests behave unchanged. Command-line parser accepts only fixed --open/--convert plus literal file arguments; no URL launch, scripting or implicit directory change. Native pipe ACL/current-user checks remain authoritative. Coordinate this additive change centrally before coding.
4. D4. Associations are opt-in extension checkboxes in installer/Settings; register ProgID Adperastra.File.<family>, OpenWithProgids and app capabilities under owned keys, never force Windows default. “Choose defaults” opens Windows Settings supported UI; user makes default choice. Upgrade detects running instance/dirty edits and asks it to exit safely; no kill of unsaved app. Uninstall removes only ledger-owned registry values if they still match installed values; third-party replacements remain. Keep data default, remove requires exactownedroot confirmation and RecycleBin policy.
5. D5. Full offline installer contains selected signed12a artifacts with exactcataloghashes; missing artifact disables that pack choice, not an unsigned downloadfallback. Installer/portable/upgrade use10c ProfileRoot and08d PortableLocation; never copy private signing directory. Test fresh/installupgrade/uninstall bothlanguage choices in WindowsSandbox. Existing classic shell helper retains timeout/kill/fallback; do not run extension DLLs inside core to improve menu reliability.
6. D6. Schema42 -> 43 adds startup.stay_in_background false,start_with_windows false. Closing lastwindow first settles09a dirtydocuments; Cancel leavesvisible. If resident enabled, hide one mainWebView, destroy other viewwindows, releaseparsers/engines/GPU/readleases/proxies, retain minimal empty shell plus explicitly enabledbackgroundtasks. Never hide while an activeforegroundjob needs an unacknowledged choice; showtrayjobstatus. Tray icon always visible while resident, with Open,Turn off stay in background,Quit. Turningoff settlesforegroundwork thenexitsbackgroundcopy; Quit cannot discardunsavedchanges silently.
7. D7. StartwithWindows is separateexplicitopt-in HKCU Run ownedvalue, fixedquoted apppath plus --background; --background doesnotenabletasks/downloads/updatechecks. Native state machine Visible/ClosingDecision/Resident/Restoring/Quitting; transitions serialized. Incomingactivation fromResident showswindowfirst then normal09c pipeline; no duplicatewindow. Focusrestoresrequestedtab. Measure privateworking set using GetProcessMemoryInfo(PROCESS_MEMORY_COUNTERS_EX), every5s onlywhileSettingsvisible; label valueactual, neverhardcodedestimate.
8. D8. Tauri2 tray feature tray-icon; verified APIs TrayIconBuilder::with_id,on_menu_event,on_tray_icon_event andMenu/MenuItem. One trayownedbyapp, languagechangesreplaceitslabels; nosecondautostartplugin. Shared close/exit hookcoordinates09a/09h save/recovery and12a policy. Unexpectedengineexitcannotquitcore. Windows session-end persistsboundedrecoveryfirst, doesn'tdelayOSindefinitely.
9. D9. Update checks stayoffdefault. Fetch only08d validatedreleaseendpoint aftermanual/opt-in; notes max256KiB sanitizedmarkdown/noexternalimages, no automatic installer. What'snewcachedownedstore reportsto12a. Openreleasepage onlyvia08d checkedURL. v0.4originalincludesAI14c,excludedhere; releasecannotclaimtheoriginalpromisecompleteorpublishwithoutowner.

## Uses, data and public exports

|Ref|Producer/task/file/revision|Exact use|
|---|---|---|
|U1|09c E4/E6;activation.ts/activation.rs;activation-1|ActivationRequest/Ack,onOpenRequest/activationReady; optionalintentD3 additivecoordinatorchange,notprivateworkerfork|
|U2|08d E1-E6;updates.ts/portable.rs;release-1|UpdateInfo/checkForUpdates/openUpdatePage,PortableLocation/ArtifactRecord; noarbitraryURLs|
|U3|10c profile_root.rs;profile-root-1|ProfileRoot base_dir/profile_dir/shared_packs_dir/profile_id/portable; registryledgerprofile-independentinstallationstate|
|U4|09a documentclose;09h recovery;12a E2/E5|Awaitdirtydecision,releaseengines/packleases,retainonlyexplicitbackgroundpolicy;neverwriteuntestedhistorycontent|
|U5|03a classic_menu.rs/helper.rs;baseline|Existingisolatedshellmenuhost/timeout; noDLLloadinmain|

Canonical `src/services/windowsIntegration.ts`,native `windows_integration_types.rs`; registry mutation onlynativeledger.

|Type|Fields|
|---|---|
|IntegrationStatus|classic_enabled bool;modern state unavailable/awaiting_owner/available/enabled;associations string[]<=128;startup_enabled bool;reason_code nullablestring|
|RegistryOwnedValue|key fixedownedrelativepath;name string;installed_value bytes<=64KiB;previous_value optionalbytes;type enum;app_version SemVer;ledger_schema1|
|ResidentStatus|state visible/closing_decision/resident/restoring/quitting;enabled bool;start_with_windows bool;private_bytes safeu64;measured_unix safeu64;active_jobs u32|
|IntegrationRequest|classic_enabled bool;extensions lowercasealphanumeric[]<=128fromallowlist;start_with_windows bool;modern_requested boolfalseunlessapproved |

|Ref|Exact export/signature|Consumers|
|---|---|---|
|E1|services/windowsIntegration.ts integrationStatus()->Promise<IntegrationStatus>;applyWindowsIntegration(request:IntegrationRequest)->Promise<IntegrationStatus>|Settings/installer; native windows_integration_status/apply; userchoiceonly|
|E2|services/resident.ts residentStatus()->Promise<ResidentStatus>;setResidentMode(enabled:boolean,startWithWindows:boolean)->Promise<ResidentStatus>;showResidentWindow()->Promise<void>|startupSettings/tray; native resident_status/set/show; closeeventsmanagednative|
|E3|native resident.rs ResidentCoordinator.request_close()->Future<Result<CloseDecision,String>>;activate(request:ActivationRequest)->Future<Result<(),String>>|CloseDecision keep_visible/hide/exit;09a dirtyclose callback is supplied bycoordinator,notduplicated UI prompt|
|E4|native windows_integration.rs restore_owned_registration(ledger:&RegistryLedger)->Result<IntegrationStatus,String>|Uninstaller/disable;onlycurrentmatchingownedvaluesrestored|

Errors windows_integration.bad_request/denied/changed/identity_required/failed andresident.busy/failed. EveryIPCensure_main/allowlist/validation; no registrykey/commandlineacceptedfromUI.

## UI/text/tasks

StartupSettings existingsection adds twoSwitches plusactualmemorylabel; WindowsIntegrationSettings max960px uses classiccheckbox,modernstatus/learnmore,associationlistvirtualizedrow28,Choose defaultsButton. No default-selectiondarkpattern. `.adp-resident-memory` body12pxmutedtoken;`.adp-integration-status` gap8,border/radiustokens. Traymenusnativekeyboardaccessible; visiblecontextneverlostclosingcancel.

|Keys|English|Spanish|
|---|---|---|
|windowsIntegration.title / windowsIntegration.classic / windowsIntegration.modern / windowsIntegration.defaults|Windows integration / Add commands under Show more options / Windows 11 main menu / Choose default apps…|Integración con Windows / Agregar comandos en Mostrar más opciones / Menú principal de Windows 11 / Elegir aplicaciones predeterminadas…|
|windowsIntegration.identityRequired|The main Windows 11 menu needs an approved package identity and trusted deployment.|El menú principal de Windows 11 necesita una identidad de paquete y una distribución de confianza aprobadas.|
|resident.enable / resident.startWindows / resident.memory|Stay in background / Start with Windows / Current background memory: {size}|Permanecer en segundo plano / Iniciar con Windows / Memoria actual en segundo plano: {size}|
|resident.open / resident.disable / resident.quit|Open / Turn off stay in background / Quit|Abrir / Desactivar permanencia en segundo plano / Salir|
|resident.explain|Keeps a small idle window ready. Other background tasks keep their own settings.|Mantiene lista una ventana pequeña e inactiva. Las demás tareas conservan su propia configuración.|
|errors.windows_integration.failed / errors.resident.failed|Windows integration could not be changed. / Background mode could not be changed.|No se pudo cambiar la integración con Windows. / No se pudo cambiar el modo en segundo plano.|

Commands app.windowsIntegration/app.stayBackground,labelsabove,icons PanelsTopLeft/Moon,globalshortcutnone,helpwindows-integration/stay-in-background. Updatekeysreuse08d. Othererrorsmapfailedwithstablecode; identity_requiredusestextabove.

|Task;commit|Files/work;dependencies|Namedtests:input->oracle|
|---|---|---|
|T1;`feat(windows): owned optional registration ledger [step-16/T1]`|windows_integration_types.rs,registry_ledger.rs,services/windowsIntegration.ts;U1/U3.|userchoice_untouched;foreign_changed_key_preserved;disable_restores_exactpreviousvalue;selection257_refused|
|T2;`feat(windows): Explorer activation and association choices [step-16/T2]`|integration_commands.rs,WindowsIntegrationSettings.tsx;coordinator09cintentextension;U1.|convert_intent_opens_review_noautooutput;paths_quotes_singleargument;defaults_notforced;oldactivation_defaultsopen|
|T3;`feat(startup): dirty-safe resident state machine [step-16/T3]`|resident.rs,resident_state.rs,services/resident.ts;U4.|dirtycancel_keepsvisible;activation_resident_onewindow;turnoff_exits_after_safeclose;no_tasks_enabled_by_residence|
|T4;`feat(tray): localized background controls and memory [step-16/T4]`|tray.rs,resident_memory.rs,StartupResidentSettings.tsx;U4.|onetray_after_languagechange;memory_value_fromsample;engines_unload_whenresident;Quit_doesnotdiscarddirty|
|T5;`build(installer): clean upgrade uninstall and offline packs [step-16/T5]`|installerintegration/ledger/offlinecatalogspec;coordinatorpackage scripts;U2/U3.|offlinehash_verified;upgrade_dirty_exitcancel;uninstall_keepsdatadefault;foreignroot_neverremoved|
|T6;`docs(windows): modern-menu checkpoint evidence [step-16/T6]`|unsignedmodernpackage/COMregistrationplanandtradeoffreport;U1;noinstallation.|modern_status_not_claimedenabled;classic_label_truthful;ownercheckpoint_onlydependentpath|
|T7;`docs(help): Windows startup associations and updates [step-16/T7]`|Fourpagesbelow;coordinator schema43/keys/updatecache/report/evidence.|migration42_preservesprefs;updatesoff_nonetwork;classichelper_timeout_survives|

## Exact file and test allocation

Feature-owned roots: src-tauri/src/{windows_integration_types,registry_ledger,integration_commands,resident,resident_state,tray,resident_memory}.rs; src/services/{windowsIntegration,resident}.ts; src/views/settings/WindowsIntegrationSettings.tsx and StartupResidentSettings.tsx. Bare filenames in a task expand inside its feature root; native filenames mean src-tauri/src/ unless an explicit crate path is given. The coordinator owns shared App/Explorer/main, settings schemas, manifests/lockfiles, command/handler/IPC registries, generated locales and asset wiring; workers submit exact insertions rather than editing those shared files. Helpers use the producer's fixed entry/action registry through coordinator integration.

Place every named test in task Tn in the corresponding file below. Rust test modules with private feature access are attached by the owning native module; they are not a fictitious standalone src-tauri library. The listed assertions remain unchanged when split into smaller test files.

|Task|Exact test file|
|---|---|
|T1|src-tauri/src/windows_registry_step16_tests.rs|
|T2|src-tauri/src/windows_activation_step16_tests.rs|
|T3|src-tauri/src/resident_step16_tests.rs|
|T4|src/__tests__/step16-resident.test.tsx|
|T5|src-tauri/src/installer_step16_tests.rs|
|T6|src/__tests__/step16-modern-checkpoint.test.ts|
|T7|src/__tests__/step16-help.test.ts|

Workers write these tests and fixtures but do not execute any command, install, compile, generate assets or claim results. Coordinator runs targeted checks, complete gate/package, real parser/process/file-safety tests and manual evidence. A mock is not evidence of native confinement, interoperability or performance.

## Full help

windows-integration.md — English **Windows Explorer integration**: “Open Settings > Windows integration to add optional commands. Show more options integration uses Windows' classic menu. The main Windows11 menu needs a supported package identity and trusted deployment, so it is shown separately and may be unavailable. Convert to… opens Adperastra's review dialog; it does not change files immediately. Disable integration here to remove only Adperastra's own entries. See also: File associations.” Spanish **Integración con el Explorador de Windows**: “Abre Configuración > Integración con Windows para agregar comandos opcionales. La integración Mostrar más opciones usa el menú clásico. El menú principal de Windows11 necesita identidad de paquete y distribución de confianza compatibles; aparece por separado y puede no estar disponible. Convertir en… abre el diálogo de revisión de Adperastra; no cambia archivos inmediatamente. Desactiva la integración aquí para quitar solo sus entradas. Consulta también: Asociaciones de archivos.”

file-associations.md — English **File associations**: “Select the file families you want Adperastra to offer in Open with. Use Choose default apps to make your own choices in Windows Settings. Installing Adperastra never silently replaces your default apps. Uninstall removes matching app-owned entries and preserves choices changed by another program. See also: Windows Explorer integration.” Spanish **Asociaciones de archivos**: “Selecciona los tipos para los que quieras ofrecer Adperastra en Abrir con. Usa Elegir aplicaciones predeterminadas para decidir en Configuración de Windows. Instalar Adperastra nunca reemplaza silenciosamente tus aplicaciones predeterminadas. La desinstalación quita las entradas propias que coincidan y conserva las cambiadas por otro programa. Consulta también: Integración con el Explorador de Windows.”

stay-in-background.md — English **Stay in background**: “Enable Stay in background in Startup settings to keep an idle window ready after closing. A tray icon provides Open, Turn off stay in background and Quit. Start with Windows is a separate choice. Unsaved changes are settled before hiding or quitting; engines and large caches unload while idle. The shown memory figure is measured. Other background tasks and update checks keep their own switches. See also: Background work.” Spanish **Permanecer en segundo plano**: “Habilita Permanecer en segundo plano en Inicio para mantener lista una ventana inactiva al cerrar. Un icono de bandeja ofrece Abrir, Desactivar permanencia en segundo plano y Salir. Iniciar con Windows es una elección independiente. Los cambios sin guardar se resuelven antes de ocultar o salir; los motores y cachés grandes se descargan durante la inactividad. La memoria mostrada se mide. Las demás tareas y búsquedas de actualizaciones conservan sus propios controles. Consulta también: Trabajo en segundo plano.”

updating-adperastra.md — English **Updating Adperastra**: “Update checks are off unless you enable them or choose Check now. Read What's new and open the checked GitHub release page. Downloads and installation require your choice; no document or diagnostic data is uploaded. Keep a backup and close safely before upgrading. See also: App storage.” Spanish **Actualizar Adperastra**: “La búsqueda de actualizaciones está desactivada salvo que la habilites o elijas Buscar ahora. Lee Novedades y abre la página de versión verificada de GitHub. Descargar e instalar requiere tu elección; no se suben documentos ni diagnósticos. Conserva una copia de seguridad y cierra de forma segura antes de actualizar. Consulta también: Almacenamiento de la aplicación.”

## Checks/speed/screenshots/done

Coordinatorretainsinstallationfixturewithspaces/Unicodepath,registrybefore/after snapshots,dirtytextsource“Keep edits”,signedofflinepackfixture andupdate-notesfixturewithunsafeHTML. Run freshinstall/upgrade/uninstallinWindowsSandboxwithouttouchingownerassociations;testclassiccommands/residentclose/activation/tray/language/cancel/dataKeep/foreignregistrychange. Modernmenuonlyafterownercheckpointresolved; nofabricatedSandboxresults. Englishlight/Spanishdark/pseudo/keyboard/200%zoom.

Measure step16.resident.open Fast1s,targetInstant100ms whenpaintready;memoryreportedactual;classicmenuFast1s with existingtimeout;foregroundbaseline<=20%regression. Reserve161-windows-integration,162-resident-mode inthreevariants. Done:independentfeaturesverified,exactregistryownership/dirtysafeidle/notelemetry,modernidentitycheckpointhonestlyrecorded,noAIinclusivev0.4claim,andcoordinatorapprovalrequiredforreleasepublication.
